import axios, { AxiosError, AxiosResponse } from 'axios'
import type { FileHandle } from 'node:fs/promises'
import fs from 'node:fs/promises'
import { Readable } from 'node:stream'
import { setTimeout } from 'node:timers/promises'
import { DEFAULT_HIGH_WATER_MARK, F_STAT, SYNC_CHECKSUM_SIZE } from '../constants/handlers'
import { API, SYNC_UPLOAD_SESSION_HEADER } from '../constants/requests'
import type { AxiosExtendedRequestConfig } from '../interfaces/request.interface'
import type { SyncFileStats } from '../interfaces/sync-diff.interface'
import type {
  SyncUploadSessionMethod,
  SyncUploadSessionRecord,
  SyncUploadSessionState,
  SyncUploadSessionStatus
} from '../interfaces/sync-upload-session.interface'
import type { SyncPath } from '../models/syncpath'
import { genUUID } from '../utils/functions'
import { isUploadSessionId, uploadSessionMatchesFileStats } from '../utils/upload-session'
import type { Logger } from 'winston'
import type { FilesParser } from './parser'
import type { RequestsManager } from './requests'
import type { TransferProgress } from './transfers'

const UPLOAD_SESSION_RETRY_COUNT = 3
const UPLOAD_SESSION_RETRY_WAIT = 2000
const UPLOAD_SESSION_RETRY_MAX_WAIT = 30000

export class UploadSessionManager {
  private wasAborted = false
  private readonly retryController = new AbortController()

  constructor(
    private readonly req: RequestsManager,
    private readonly filesParser: FilesParser,
    private readonly syncPath: SyncPath,
    private readonly logger: Logger,
    private readonly incompleteTrackMinSize: number
  ) {}

  stop(): void {
    this.wasAborted = true
    this.retryController.abort()
  }

  async upload(
    filePath: string,
    realPath: string,
    fileStats: SyncFileStats,
    method: SyncUploadSessionMethod,
    transferProgress?: TransferProgress
  ): Promise<number> {
    let session = this.filesParser.getUploadSession(filePath)
    if (session && !this.uploadSessionMatches(session, fileStats, method)) {
      if (isUploadSessionId(session.uploadId)) await this.cancelUploadSession(filePath, session.uploadId)
      await this.filesParser.removeUploadSession(filePath)
      session = undefined
    }

    let offset = 0
    let validatedOffset = 0
    let sessionCreated = false
    if (session) {
      try {
        // Persisted records contain identity only; the server remains authoritative for both offsets.
        const status = await this.retryUploadSessionStatus(this.uploadSessionUrl(filePath, session.uploadId), fileStats[F_STAT.SIZE])
        offset = status.offset
        validatedOffset = status.validatedOffset
        sessionCreated = true
        if (transferProgress) transferProgress.currentSize = offset
        if (status.state === 'complete') return this.completeUploadSession(filePath, status)
      } catch (error) {
        if (!this.isUploadSessionNotFoundError(error) && !this.isUploadSessionStaleStatusError(error)) throw error
        if (this.isUploadSessionStaleStatusError(error)) await this.cancelUploadSession(filePath, session.uploadId)
        await this.filesParser.removeUploadSession(filePath)
        session = undefined
      }
    }

    if (!session) {
      session = {
        checksum: fileStats[F_STAT.CHECKSUM],
        chunkSize: this.req.server.transfers?.maxChunkSize ?? Math.max(fileStats[F_STAT.SIZE], 1),
        ino: fileStats[F_STAT.INO],
        method,
        mtime: fileStats[F_STAT.MTIME],
        size: fileStats[F_STAT.SIZE],
        uploadId: genUUID()
      }
      // Avoid per-file snapshot I/O for small single-chunk uploads; the end-of-run snapshot remains the fallback.
      await this.filesParser.setUploadSession(filePath, session, session.size >= this.incompleteTrackMinSize || session.size > session.chunkSize)
    }

    const sessionUrl = this.uploadSessionUrl(filePath, session.uploadId)
    const chunkSize = session.chunkSize
    let reconcileSession = false
    let recoveryAttempts = 0
    let source: FileHandle | undefined

    try {
      // Pin one file handle across all chunks so replacing the path cannot combine bytes from two files.
      source = await fs.open(realPath, 'r')
      const secure = typeof fileStats[F_STAT.CHECKSUM] === 'string'
      let chunkChecksums: string[] | undefined
      while (true) {
        if (reconcileSession) {
          // An ambiguous failed request may still have advanced the server, so reconcile before retransmitting.
          try {
            const status = await this.getUploadSessionStatus(sessionUrl, fileStats[F_STAT.SIZE])
            if (status.offset > offset || status.validatedOffset > validatedOffset) recoveryAttempts = 0
            offset = status.offset
            validatedOffset = status.validatedOffset
            sessionCreated = true
            if (transferProgress) transferProgress.currentSize = offset
            reconcileSession = false
            if (status.state === 'complete') return this.completeUploadSession(filePath, status)
          } catch (error) {
            if (!sessionCreated && this.isUploadSessionNotFoundError(error)) {
              reconcileSession = false
              continue
            }
            if (this.isUploadSessionStaleStatusError(error)) {
              await this.cancelUploadSession(filePath, session.uploadId)
              await this.filesParser.removeUploadSession(filePath)
              throw error
            }
            if (!this.isUploadSessionRetryableError(error) || recoveryAttempts >= UPLOAD_SESSION_RETRY_COUNT) throw error
            recoveryAttempts += 1
            await this.waitForUploadSessionRetry(error, recoveryAttempts)
            continue
          }
        }

        if (!secure && validatedOffset !== offset) throw new Error('Invalid fast upload session validated offset')
        // Secure uploads may stage part of one chunk ahead of validation; only validatedOffset defines chunk boundaries.
        if (secure && validatedOffset !== fileStats[F_STAT.SIZE] && validatedOffset % chunkSize !== 0) {
          throw new Error('Invalid upload session chunk boundary')
        }
        const chunkEnd = Math.min((secure ? validatedOffset : offset) + chunkSize, fileStats[F_STAT.SIZE])
        if (offset > chunkEnd) throw new Error('Invalid upload session validated offset')
        await this.assertUploadSessionSourceIdentity(source, fileStats)
        if (secure && validatedOffset < fileStats[F_STAT.SIZE]) {
          // Chunk digests are memory-only and are rebuilt lazily after restart, with the full checksum revalidated.
          chunkChecksums ??= await this.filesParser.getUploadChunkChecksums(filePath, realPath, fileStats, chunkSize)
        }
        const chunkChecksum =
          secure && validatedOffset < fileStats[F_STAT.SIZE] ? chunkChecksums?.[Math.floor(validatedOffset / chunkSize)] : undefined
        if (secure && validatedOffset < fileStats[F_STAT.SIZE] && !chunkChecksum) {
          throw new Error('Upload session chunk checksum is missing')
        }
        try {
          const status = await this.uploadSessionChunk(
            sessionUrl,
            source,
            fileStats,
            secure,
            validatedOffset,
            offset,
            chunkEnd,
            chunkChecksum,
            sessionCreated ? 'patch' : method,
            transferProgress
          )
          sessionCreated = true
          if (status.offset !== chunkEnd || status.validatedOffset !== chunkEnd) throw new Error('Invalid upload offset response')
          offset = status.offset
          validatedOffset = status.validatedOffset
          recoveryAttempts = 0
          if (transferProgress) transferProgress.currentSize = offset
          if (status.state === 'complete') return this.completeUploadSession(filePath, status)
        } catch (error) {
          if (!this.isUploadSessionTransferRecoveryError(error) || recoveryAttempts >= UPLOAD_SESSION_RETRY_COUNT) throw error
          recoveryAttempts += 1
          await this.waitForUploadSessionRetry(error, recoveryAttempts)
          reconcileSession = true
        }
      }
    } catch (error) {
      if (this.isUploadSessionPermanentError(error)) {
        await this.cancelUploadSession(filePath, session.uploadId)
        await this.filesParser
          .removeUploadSession(filePath)
          .catch((snapshotError) => this.logger.warn(`Unable to remove failed upload session from snapshot: ${snapshotError}`))
      }
      throw error
    } finally {
      if (source) {
        await source.close().catch((error) => this.logger.warn(`Unable to close upload source: ${error}`))
      }
    }
  }

  private uploadSessionChunk(
    sessionUrl: string,
    source: FileHandle,
    fileStats: SyncFileStats,
    secure: boolean,
    validatedOffset: number,
    offset: number,
    chunkEnd: number,
    chunkChecksum: string | undefined,
    method: SyncUploadSessionMethod | 'patch',
    transferProgress?: TransferProgress
  ): Promise<SyncUploadSessionStatus> {
    const hasBody = secure ? validatedOffset < chunkEnd : offset < chunkEnd
    const getData = (): Readable | Buffer =>
      hasBody ? this.uploadSessionChunkStream(source, offset, chunkEnd, chunkChecksum, transferProgress) : Buffer.alloc(0)
    return this.req
      .http<void>({
        data: getData(),
        getData,
        headers: {
          'Content-Length': String(hasBody ? chunkEnd - offset + (secure ? SYNC_CHECKSUM_SIZE : 0) : 0),
          'Content-Type': 'application/octet-stream',
          [SYNC_UPLOAD_SESSION_HEADER.LENGTH]: String(fileStats[F_STAT.SIZE]),
          [SYNC_UPLOAD_SESSION_HEADER.OFFSET]: String(offset),
          ...(method !== 'patch' && fileStats[F_STAT.CHECKSUM] ? { [SYNC_UPLOAD_SESSION_HEADER.CHECKSUM]: fileStats[F_STAT.CHECKSUM] } : {}),
          ...(method !== 'patch' ? { [SYNC_UPLOAD_SESSION_HEADER.MTIME]: String(fileStats[F_STAT.MTIME]) } : {})
        },
        method,
        skipConnectionRetry: true,
        url: sessionUrl
      } as AxiosExtendedRequestConfig)
      .then((response) => this.parseUploadSessionStatus(response, fileStats[F_STAT.SIZE]))
  }

  private uploadSessionChunkStream(
    sourceHandle: FileHandle,
    offset: number,
    chunkEnd: number,
    expectedChecksum: string | undefined,
    transferProgress?: TransferProgress
  ): Readable {
    const source = async function* () {
      if (offset < chunkEnd) {
        if (transferProgress) transferProgress.currentSize = offset
        for await (const chunk of sourceHandle.createReadStream({
          autoClose: false,
          end: chunkEnd - 1,
          highWaterMark: DEFAULT_HIGH_WATER_MARK,
          start: offset
        })) {
          transferProgress?.update(chunk.length)
          yield chunk
        }
      }
      if (expectedChecksum) yield Buffer.from(expectedChecksum, 'hex')
    }
    return Readable.from(source())
  }

  private async retryUploadSessionStatus(sessionUrl: string, expectedSize: number): Promise<SyncUploadSessionStatus> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.getUploadSessionStatus(sessionUrl, expectedSize)
      } catch (error) {
        if (!this.isUploadSessionRetryableError(error) || attempt >= UPLOAD_SESSION_RETRY_COUNT) throw error
        await this.waitForUploadSessionRetry(error, attempt + 1)
      }
    }
  }

  private getUploadSessionStatus(sessionUrl: string, expectedSize: number): Promise<SyncUploadSessionStatus> {
    return this.req.http
      .head<void>(sessionUrl, { skipConnectionRetry: true } as AxiosExtendedRequestConfig)
      .then((response) => this.parseUploadSessionStatus(response, expectedSize))
  }

  private parseUploadSessionStatus(response: AxiosResponse, expectedSize: number): SyncUploadSessionStatus {
    const offset = this.parseUploadSessionIntegerHeader(response, SYNC_UPLOAD_SESSION_HEADER.OFFSET)
    const validatedOffset = this.parseUploadSessionIntegerHeader(response, SYNC_UPLOAD_SESSION_HEADER.VALIDATED_OFFSET)
    const size = this.parseUploadSessionIntegerHeader(response, SYNC_UPLOAD_SESSION_HEADER.LENGTH)
    const state = this.uploadSessionHeader(response, SYNC_UPLOAD_SESSION_HEADER.STATE) as SyncUploadSessionState
    const ino = state === 'complete' ? this.parseUploadSessionIntegerHeader(response, SYNC_UPLOAD_SESSION_HEADER.INO) : undefined
    // Only an uploading session may be partial; ready and complete sessions must be fully staged and validated.
    if (
      size !== expectedSize ||
      validatedOffset > offset ||
      offset > size ||
      !['complete', 'ready', 'uploading'].includes(state) ||
      (state === 'uploading' ? validatedOffset >= size : offset !== size || validatedOffset !== size)
    ) {
      throw new Error('Invalid upload session status response')
    }
    return { offset, size, state, validatedOffset, ...(ino !== undefined && { ino }) }
  }

  private parseUploadSessionIntegerHeader(response: AxiosResponse, header: string): number {
    const value = this.uploadSessionHeader(response, header)
    if (!/^\d+$/.test(value)) throw new Error(`Invalid ${header} response header`)
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid ${header} response header`)
    return parsed
  }

  private uploadSessionHeader(response: AxiosResponse, header: string): string {
    const value = response.headers[header]
    if (value === undefined || value === null || Array.isArray(value)) throw new Error(`Invalid ${header} response header`)
    return String(value)
  }

  private uploadSessionMatches(session: SyncUploadSessionRecord, fileStats: SyncFileStats, method: SyncUploadSessionMethod): boolean {
    const maxChunkSize = this.req.server.transfers?.maxChunkSize
    return (
      isUploadSessionId(session.uploadId) &&
      Number.isSafeInteger(session.chunkSize) &&
      session.chunkSize > 0 &&
      (maxChunkSize === null || maxChunkSize === undefined || session.chunkSize <= maxChunkSize) &&
      session.method === method &&
      uploadSessionMatchesFileStats(session, fileStats, true)
    )
  }

  private async assertUploadSessionSourceIdentity(source: FileHandle, fileStats: SyncFileStats): Promise<void> {
    const stats = await source.stat()
    if (
      !stats.isFile() ||
      stats.ino !== fileStats[F_STAT.INO] ||
      stats.size !== fileStats[F_STAT.SIZE] ||
      Math.floor(stats.mtime.getTime() / 1000) !== fileStats[F_STAT.MTIME]
    ) {
      throw new Error('source has changed since parsing')
    }
  }

  private uploadSessionUrl(filePath: string, uploadId: string): string {
    return this.syncPath.apiFromPath(`${API.UPLOAD_SESSION}/${uploadId}`, filePath)
  }

  private async completeUploadSession(filePath: string, status: SyncUploadSessionStatus): Promise<number> {
    if (status.ino === undefined) throw new Error(`${SYNC_UPLOAD_SESSION_HEADER.INO} response header is missing`)
    await this.filesParser
      .removeUploadSession(filePath)
      .catch((error) => this.logger.warn(`Unable to remove completed upload session from snapshot: ${error}`))
    return status.ino
  }

  private cancelUploadSession(filePath: string, uploadId: string): Promise<void> {
    return this.req.http
      .delete(this.uploadSessionUrl(filePath, uploadId), { skipConnectionRetry: true } as AxiosExtendedRequestConfig)
      .then(() => undefined)
      .catch(() => undefined)
  }

  private isUploadSessionNotFoundError(error: unknown): error is AxiosError {
    return axios.isAxiosError(error) && error.response?.status === 404
  }

  private isUploadSessionRetryableError(error: unknown): error is AxiosError {
    if (!axios.isAxiosError(error) || this.wasAborted || error.code === 'ERR_CANCELED') return false
    const status = error.response?.status
    return status === undefined || status === 423 || (status >= 500 && status < 600 && status !== 507)
  }

  private isUploadSessionTransferRecoveryError(error: unknown): error is AxiosError {
    return (axios.isAxiosError(error) && error.response?.status === 409) || this.isUploadSessionRetryableError(error)
  }

  private isUploadSessionStaleStatusError(error: unknown): boolean {
    return (axios.isAxiosError(error) && error.response?.status === 409) || (!axios.isAxiosError(error) && error instanceof Error)
  }

  private isUploadSessionPermanentError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) return error instanceof Error
    if (error.response?.status === undefined) return false
    return [400, 405, 410, 413, 415, 422].includes(error.response.status)
  }

  private async waitForUploadSessionRetry(error: AxiosError, attempt: number): Promise<void> {
    if (this.wasAborted) throw error
    const retryAfterSeconds = Number(error.response?.headers?.['retry-after'] ?? NaN)
    const retryAfterDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds * 1000 : 0
    const backoffDelay = Math.min(UPLOAD_SESSION_RETRY_WAIT * 2 ** Math.max(0, attempt - 1), UPLOAD_SESSION_RETRY_MAX_WAIT)
    try {
      await setTimeout(Math.min(Math.max(retryAfterDelay, backoffDelay), UPLOAD_SESSION_RETRY_MAX_WAIT), undefined, {
        signal: this.retryController.signal
      })
    } catch (waitError) {
      // Stopping recovery must preserve the transport error that made the upload resumable.
      if (this.retryController.signal.aborted) throw error
      throw waitError
    }
    if (this.wasAborted) throw error
  }
}
