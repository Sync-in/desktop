import path from 'node:path'
import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import zlib from 'node:zlib'
import readline from 'node:readline'
import { getLogger } from './loggers'
import { snapshotSides, SyncPath } from '../models/syncpath'
import { IS_WINDOWS } from '../../constants'
import {
  checksumFile,
  checksumFileWithChunks,
  convertJSONToMap,
  convertMapToJSON,
  fileBaseName,
  isPathExistsBool,
  regExpPathPattern
} from '../utils/functions'
import { getDownloadTmpDirectory, getDownloadTmpPath, getDownloadTmpPrefix, isDownloadTmpFileName } from '../utils/download-checkpoints'
import { RequestsManager } from './requests'
import {
  DEFAULT_FILTERS,
  F_ACTION,
  F_SPECIAL_STAT,
  F_STAT,
  INCOMPLETE_RETENTION,
  INTERNAL_TEMPORARY_DIRECTORY,
  SIDE,
  SYNC_DIFF_DONE
} from '../constants/handlers'
import { Logger } from 'winston'
import { EventEmitter } from 'events'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../../../main/constants/events'
import { API } from '../constants/requests'
import type { AxiosExtendedRequestConfig } from '../interfaces/request.interface'
import type { SyncTransfer } from '../interfaces/sync-transfer.interface'
import type { SyncDiff, SyncFileSpecialStats, SyncFileStats, SyncSnapShot } from '../interfaces/sync-diff.interface'
import type { SyncUploadChunkChecksumCache, SyncUploadSessionRecord } from '../interfaces/sync-upload-session.interface'
import { NormalizedMap } from '../utils/normalizedMap'
import { Readable } from 'node:stream'
import { buildPathFilterSource, compilePathFilters } from '../utils/path-filters/path-filter-compiler'
import { SYNC_MAX_PATH_FILTER_LENGTH, SYNC_MAX_PATH_FILTER_WARNINGS } from '../utils/path-filters/constants'
import type { SyncPathFilterMatcher } from '../utils/path-filters/path-filter-compiler.interface'
import { isUploadSessionRecord, uploadSessionMatchesFileStats } from '../utils/upload-session'

export class FilesParser {
  public logger: Logger
  public req: RequestsManager
  public wasAborted = false
  // current snapshots
  public curSnap: {
    local: SyncSnapShot
    remote: SyncSnapShot
  } = { local: new NormalizedMap<string, SyncFileStats>(), remote: new NormalizedMap<string, SyncFileStats>() }
  // stored snapshots
  public oldSnap: {
    local: SyncSnapShot
    remote: SyncSnapShot
  } = { local: new NormalizedMap<string, SyncFileStats>(), remote: new NormalizedMap<string, SyncFileStats>() }
  // stored incomplete snapshots
  public oldIncSnap: {
    local: SyncSnapShot
    remote: SyncSnapShot
  } = { local: new NormalizedMap<string, SyncFileStats>(), remote: new NormalizedMap<string, SyncFileStats>() }
  // current incomplete snapshots
  public curIncSnap: {
    local: SyncSnapShot
    remote: SyncSnapShot
  } = { local: new NormalizedMap<string, SyncFileStats>(), remote: new NormalizedMap<string, SyncFileStats>() }
  public uploadSessions = new NormalizedMap<string, SyncUploadSessionRecord>()
  private readonly uploadChunkChecksums = new NormalizedMap<string, SyncUploadChunkChecksumCache>()
  // parsing errors
  public errors = { local: new NormalizedMap<string, string>(), remote: new NormalizedMap<string, string>() }
  // constants
  private readonly reportOnly: boolean
  private readonly appEvents: EventEmitter
  private readonly lPath: string
  private readonly rPath: string
  private readonly iPath: string
  private readonly secureDiff: boolean
  private readonly regexPath: RegExp
  private readonly syncPathFilterSource: string | null
  private readonly syncPathFilters: SyncPathFilterMatcher | null
  private nbFiltered = 0
  private syncPath: SyncPath
  private incompleteSnapshotSave: Promise<void> = Promise.resolve()

  constructor(syncPath: SyncPath, req: RequestsManager, reportOnly = false, appEvents: EventEmitter = null) {
    this.syncPath = syncPath
    this.req = req
    this.reportOnly = reportOnly
    this.appEvents = appEvents
    this.logger = getLogger('Parser', { server: this.req.server.identity(), path: this.syncPath.identity() })
    this.secureDiff = this.syncPath.secureDiff
    this.regexPath = regExpPathPattern(this.syncPath.localPath)
    this.syncPathFilterSource = buildPathFilterSource(this.syncPath.filters)
    const pathFilters = compilePathFilters(this.syncPathFilterSource)
    this.syncPathFilters = pathFilters.matcher
    for (const rejection of pathFilters.rejected.slice(0, SYNC_MAX_PATH_FILTER_WARNINGS)) {
      this.logger.warn(
        `Ignoring path filter alternative #${rejection.index + 1} ${JSON.stringify(rejection.pattern.slice(0, SYNC_MAX_PATH_FILTER_LENGTH))}: ${rejection.reason}`
      )
    }
    if (pathFilters.rejected.length > SYNC_MAX_PATH_FILTER_WARNINGS) {
      this.logger.warn(`Ignoring ${pathFilters.rejected.length - SYNC_MAX_PATH_FILTER_WARNINGS} additional path filter alternatives`)
    }
    if (pathFilters.rejected.length) {
      this.appEvents?.emit(LOCAL_RENDERER.SYNC.MSG, {
        serverId: this.req.server.id,
        title: `${this.req.server.identity().name} - ${this.syncPath.name}`,
        body: `${pathFilters.rejected.length} path filter alternative(s) ignored. See synchronization logs for details.`
      })
    }
    for (const [side, path] of snapshotSides.map((side) => [side, syncPath.getSnapshotPath(side, this.req.server.id)])) {
      this[`${side}Path`] = path
    }
  }

  async run() {
    await this.loadSnapShots()
    await this.restoreDownloadCheckpoints()
    await Promise.all([this.runRemote(), this.runLocal()])
    this.checkOnFirstSync()
    await this.reconcileUploadSessions()
    this.ignoreSnapshotErrors()
  }

  stop() {
    this.wasAborted = true
  }

  async getStats(filePath: string, realPath: string, isDir: boolean): Promise<SyncFileStats> {
    const stats = await fs.stat(realPath)
    const mtime = Math.floor(stats.mtime.getTime() / 1000)
    return [
      isDir,
      isDir ? 0 : stats.size,
      mtime,
      stats.ino,
      !isDir && this.secureDiff ? await this.getChecksumFile(filePath, realPath, stats.size, stats.ino, mtime) : null
    ]
  }

  propFile(side: string, filePath: string, property: number, value: any) {
    try {
      this.curSnap[side].get(filePath)[property] = value
      this.logger.debug(`${side}Properties: ${filePath}`)
    } catch (e) {
      this.logger.warn(`${side}Properties: ${filePath}: ${e}`)
    }
  }

  addFile(side: string, filePath: string, properties: any[]) {
    this.curSnap[side].set(filePath, properties)
    this.logger.debug(`${side}Added: ${filePath}`)
  }

  removeFile(side: string, filePath: string, parsingError = false) {
    try {
      if (parsingError || this.curSnap[side].get(filePath)[F_STAT.IS_DIR]) {
        const isChild = regExpPathPattern(filePath)
        for (const f of this.curSnap[side].keys()) {
          if (isChild.test(f)) {
            this.curSnap[side].delete(f)
            this.logger.debug(`${side}Remove child: ${f}`)
          }
        }
      }
      this.curSnap[side].delete(filePath)
      this.logger.debug(`${side}Remove: ${filePath}`)
    } catch (e) {
      this.logger.warn(`${side}Remove: ${filePath} : ${e}`)
    }
  }

  moveFile(side: string, srcPath: string, dstPath: string) {
    try {
      if (this.curSnap[side].get(srcPath)[F_STAT.IS_DIR]) {
        const isChild = regExpPathPattern(srcPath)
        for (const f of this.curSnap[side].keys()) {
          if (isChild.test(f)) {
            const d = f.replace(srcPath, dstPath)
            this.curSnap[side].set(d, this.curSnap[side].get(f))
            this.curSnap[side].delete(f)
            this.logger.debug(`${side}Move child: ${f} -> ${d}`)
          }
        }
      }
      this.curSnap[side].set(dstPath, this.curSnap[side].get(srcPath))
      this.curSnap[side].delete(srcPath)
      this.logger.debug(`${side}Move: ${srcPath} -> ${dstPath}`)
    } catch (e) {
      this.logger.warn(`${side}Move: ${srcPath} -> ${dstPath}: ${e}`)
    }
  }

  addIncomplete(side: string, filePath: string, properties: any[]) {
    this.curIncSnap[side].set(filePath, properties)
    this.logger.debug(`Incomplete ${side}Added: ${filePath}`)
  }

  getUploadSession(filePath: string): SyncUploadSessionRecord | undefined {
    return this.uploadSessions.get(filePath)
  }

  async setUploadSession(filePath: string, session: SyncUploadSessionRecord, persist = true): Promise<void> {
    this.uploadSessions.set(filePath, session)
    if (persist) await this.queueIncompleteSnapshotSave()
  }

  async removeUploadSession(filePath: string): Promise<void> {
    this.uploadSessions.delete(filePath)
  }

  private async reconcileUploadSessions(): Promise<void> {
    if (this.reportOnly || this.uploadSessions.size === 0) return

    let changed = false
    for (const [filePath, session] of this.uploadSessions) {
      if (this.hasParsingError(filePath)) continue

      const localStats = this.curSnap.local.get(filePath)
      const remoteStats = this.curSnap.remote.get(filePath)
      const validSession = isUploadSessionRecord(session)
      // A matching remote file means publication succeeded even if its final response was lost.
      const publishedRemoteFile = validSession && remoteStats && !remoteStats[F_STAT.IS_DIR] && uploadSessionMatchesFileStats(session, remoteStats)
      if (
        !this.req.server.transfers ||
        !validSession ||
        !localStats ||
        localStats[F_STAT.IS_DIR] ||
        !uploadSessionMatchesFileStats(session, localStats, true) ||
        publishedRemoteFile
      ) {
        if (this.req.server.transfers && validSession) {
          await this.req.http
            .delete(this.syncPath.apiFromPath(`${API.UPLOAD_SESSION}/${session.uploadId}`, filePath), {
              skipConnectionRetry: true
            } as AxiosExtendedRequestConfig)
            .catch(() => undefined)
        }
        this.uploadSessions.delete(filePath)
        changed = true
      }
    }

    if (changed) await this.queueIncompleteSnapshotSave()
  }

  private hasParsingError(filePath: string): boolean {
    for (const errors of Object.values(this.errors)) {
      for (const errorPath of errors.keys()) {
        if (filePath === errorPath || filePath.startsWith(`${errorPath}/`)) return true
      }
    }
    return false
  }

  async removeIncomplete(side: string, filePath: string, realPath?: string, onlySnap = false) {
    this.curIncSnap[side].delete(filePath)
    if (onlySnap) {
      this.logger.debug(`Incomplete ${side} removed: ${filePath}`)
      return
    }
    try {
      if (side === SIDE.LOCAL) {
        if (await isPathExistsBool(realPath)) {
          await fs.rm(realPath, { force: true, recursive: true })
        }
      } else {
        await this.req.http.delete(this.syncPath.apiFromPath(API.OPERATION, filePath))
      }
      this.logger.debug(`Incomplete ${side} removed: ${filePath}`)
    } catch (e) {
      this.logger.warn(`Incomplete ${side} not removed: ${filePath}: ${e}`)
    }
  }

  async saveSnapshots(wasStopped = false): Promise<void> {
    if (wasStopped) {
      await this.queueIncompleteSnapshotSave()
    } else {
      await Promise.all([this.saveLocalSnapshot(), this.saveRemoteSnapshot(), this.queueIncompleteSnapshotSave()])
    }
  }

  private checkOnFirstSync() {
    // An empty source is safe with ignoreDelete because destination-only content
    // is preserved; otherwise stop before the first sync can erase the destination.
    if (this.syncPath.firstSync && !this.syncPath.ignoreDelete) {
      if (
        (this.syncPath.isDownloadMode && this.curSnap.remote.size === 0 && this.curSnap.local.size > 0) ||
        (this.syncPath.isUploadMode && this.curSnap.local.size === 0 && this.curSnap.remote.size > 0)
      ) {
        this.stop()
        const sides = [this.syncPath.isDownloadMode ? SIDE.REMOTE : SIDE.LOCAL, this.syncPath.isDownloadMode ? SIDE.LOCAL : SIDE.REMOTE]
        throw `The ${sides[0]} folder is empty, the contents of the ${sides[1]} folder will be deleted, add file in ${sides[1]} folder to confirm and sync changes`
      }
    }
  }

  private async runLocal(): Promise<void> {
    this.logger.debug(`Local parsing: ${this.syncPath.localPath}`)
    for await (const [filePath, fileStats] of this.getLocalFiles(this.syncPath.localPath)) {
      if (this.wasAborted) {
        throw 'aborted'
      }
      if (fileStats.length !== 2) {
        // if no error, store file in current snapshot
        this.curSnap.local.set(filePath, fileStats)
      } else if (fileStats[0] === F_SPECIAL_STAT.ERROR) {
        // file was on error on local side:  {'/a/b': ['error', 'description' as string]}
        this.errors.local.set(filePath, fileStats[1] as string)
      } else {
        this.logger.error(`Local file stats have an unknown state : ${fileStats[0]}`)
        throw `Local file stats has an unknown state : ${fileStats[0]}}`
      }
    }
    this.logger.info(`Local parsing done (${this.curSnap.local.size} files)`)
  }

  private async runRemote(): Promise<void> {
    this.logger.debug(`Remote parsing: ${this.syncPath.remotePath}`)
    for await (const [filePath, fileStats] of this.getRemoteFiles()) {
      if (this.wasAborted) {
        throw 'aborted'
      }
      if (fileStats.length !== 2) {
        // if no error, store file in current snapshot
        this.curSnap.remote.set(filePath, fileStats)
      } else if (fileStats[0] === F_SPECIAL_STAT.ERROR) {
        // file was on error on remote side:  {'/a/b': ['error', 'description' as string]}
        this.errors.remote.set(filePath, fileStats[1] as string)
      } else if (fileStats[0] === F_SPECIAL_STAT.FILTERED) {
        // file was filtered on remote side:  {'/a/b': ['filtered', isDir as boolean]}
        this.isFiltered(SIDE.REMOTE, fileBaseName(filePath), filePath, fileStats[1] as boolean, true)
      } else {
        this.logger.error(`Remote file stats have an unknown state : ${fileStats[0]}`)
        throw `Remote file stats has an unknown state : ${fileStats[0]}}`
      }
    }
  }

  private async *getLocalFiles(dir: string): AsyncGenerator<[string, SyncFileStats | SyncFileSpecialStats]> {
    try {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const realPath = path.join(entry.parentPath, entry.name)
        if (!entry.isDirectory() && !entry.isFile()) {
          this.logger.info(`Ignore special file: ${realPath}`)
          continue
        }
        let filePath = realPath.replace(this.regexPath, '')
        if (IS_WINDOWS) {
          filePath = filePath.replaceAll('\\', '/')
        }

        // default filters
        if (this.isFiltered(SIDE.LOCAL, entry.name, filePath, entry.isDirectory())) {
          continue
        }
        try {
          if (entry.isDirectory()) {
            yield [filePath, await this.getStats(filePath, realPath, entry.isDirectory())]
            yield* this.getLocalFiles(realPath)
          } else {
            const fileStats = await this.getStats(filePath, realPath, entry.isDirectory())
            yield [filePath, fileStats]
          }
        } catch (e) {
          yield [filePath, [F_SPECIAL_STAT.ERROR, e.toString()]]
        }
      }
    } catch (e) {
      this.logger.error(`Unable to parse: ${dir} (${e})`)
      if (dir === this.syncPath.localPath) {
        throw new Error('Abort parsing', { cause: e })
      }
      yield [dir.replace(this.regexPath, ''), [F_SPECIAL_STAT.ERROR, e.toString()]]
    }
  }

  private async *getRemoteFiles(): AsyncGenerator<[string, SyncFileStats | SyncFileSpecialStats]> {
    let done = false
    let lastLine: string
    const [config, data] = this.processDiffParams({ responseType: 'stream' }, {
      secureDiff: this.syncPath.secureDiff,
      firstSync: this.syncPath.firstSync,
      defaultFilters: [...DEFAULT_FILTERS],
      pathFilters: this.syncPathFilterSource
    } satisfies SyncDiff)
    let stream: Readable | undefined
    let rl: readline.Interface | undefined
    try {
      const r = await this.req.http.post(`${API.DIFF}/${this.syncPath.id}`, data, config)
      stream = r.data.setEncoding('utf8')
      rl = readline.createInterface({
        input: stream,
        terminal: false,
        crlfDelay: Infinity
      })
      for await (const line of rl) {
        if (line === SYNC_DIFF_DONE) {
          done = true
          break
        }
        lastLine = line

        const [filePath, fileStats] = Object.entries(JSON.parse(line))[0] as [string, SyncFileStats | SyncFileSpecialStats]

        yield [filePath, fileStats]
      }
    } catch (e) {
      if (lastLine) {
        this.logger.error(`Local: ${e}`)
        this.logger.error(`Remote: ${lastLine}`)
      } else if (e.response?.status === 404) {
        throw 'Location not found'
      } else {
        this.logger.error(e)
        throw await RequestsManager.handleHttpError(e, true)
      }
    } finally {
      rl?.close()
      if (stream && !stream.destroyed && !stream.readableEnded) {
        stream.destroy()
      }
    }
    if (done) {
      this.logger.info(`Remote parsing done (${this.curSnap.remote.size} files)`)
    } else {
      throw `Incomplete remote parsing (${this.curSnap.remote.size} files)`
    }
  }

  private processDiffParams(config: any, data: SyncDiff): [any, SyncDiff | Buffer<ArrayBufferLike>] {
    if (this.syncPath.firstSync || !this.syncPath.secureDiff) {
      return [config, data]
    } else {
      data.snapshot = Object.fromEntries(this.oldSnap.remote)
      try {
        const compressed: Buffer<ArrayBufferLike> = zlib.gzipSync(JSON.stringify(data))
        config.headers = { 'Content-Encoding': 'gzip', 'Content-Type': 'application/octet-stream' }
        return [config, compressed]
      } catch (e) {
        this.logger.error(e)
        return [config, data]
      }
    }
  }

  private async getChecksumFile(filePath: string, realPath: string, size: number, ino: number, mtime: number): Promise<string> {
    if (!this.syncPath.firstSync && this.oldSnap.local.has(filePath)) {
      const fileStats = this.oldSnap.local.get(filePath)
      if (
        fileStats[F_STAT.CHECKSUM] !== null &&
        fileStats[F_STAT.MTIME] === mtime &&
        fileStats[F_STAT.SIZE] === size &&
        fileStats[F_STAT.INO] === ino
      ) {
        return fileStats[F_STAT.CHECKSUM]
      }
    }
    if (this.reportOnly || !this.req.server.transfers || this.syncPath.isDownloadMode) return await checksumFile(realPath)
    const chunkSize = this.req.server.transfers.maxChunkSize ?? Math.max(size, 1)
    if (size <= chunkSize) return await checksumFile(realPath)
    const checksums = await checksumFileWithChunks(realPath, chunkSize)
    this.uploadChunkChecksums.set(filePath, { ...checksums, chunkSize, ino, mtime, size })
    return checksums.checksum
  }

  async getUploadChunkChecksums(filePath: string, realPath: string, fileStats: SyncFileStats, chunkSize: number): Promise<string[]> {
    if (fileStats[F_STAT.SIZE] === 0) return []
    if (fileStats[F_STAT.SIZE] <= chunkSize && fileStats[F_STAT.CHECKSUM]) return [fileStats[F_STAT.CHECKSUM]]
    const cached = this.uploadChunkChecksums.get(filePath)
    if (
      cached?.checksum === fileStats[F_STAT.CHECKSUM] &&
      cached.chunkSize === chunkSize &&
      cached.ino === fileStats[F_STAT.INO] &&
      cached.mtime === fileStats[F_STAT.MTIME] &&
      cached.size === fileStats[F_STAT.SIZE]
    ) {
      return cached.chunks
    }
    const checksums = await checksumFileWithChunks(realPath, chunkSize)
    if (checksums.checksum !== fileStats[F_STAT.CHECKSUM]) throw new Error('checksum has changed since parsing')
    this.uploadChunkChecksums.set(filePath, {
      ...checksums,
      chunkSize,
      ino: fileStats[F_STAT.INO],
      mtime: fileStats[F_STAT.MTIME],
      size: fileStats[F_STAT.SIZE]
    })
    return checksums.chunks
  }

  private async restoreDownloadCheckpoints(): Promise<void> {
    let temporaryDirectory: string
    let temporaryPrefix: string
    try {
      temporaryDirectory = getDownloadTmpDirectory(this.syncPath.localPath)
      temporaryPrefix = getDownloadTmpPrefix(this.req.server.authID, this.syncPath.id)
    } catch (error) {
      this.logger.warn(`Unable to resolve download checkpoints: ${error}`)
      return
    }

    let entries: Dirent[]
    try {
      const directoryStats = await fs.lstat(temporaryDirectory)
      if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
        this.logger.warn(`Ignore invalid internal temporary location: ${temporaryDirectory}`)
        return
      }
      entries = await fs.readdir(temporaryDirectory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Unable to browse download checkpoints: ${temporaryDirectory}: ${error}`)
      }
      return
    }

    const trackedNames = new Set<string>()
    // Snapshot metadata identifies the transfer; the current staging-file size is authoritative for resumption.
    for (const [filePath, fileStats] of this.oldIncSnap.local) {
      let realTmpPath: string
      try {
        realTmpPath = getDownloadTmpPath(this.syncPath.localPath, this.req.server.authID, this.syncPath.id, filePath)
      } catch {
        continue
      }
      trackedNames.add(path.basename(realTmpPath))
      try {
        const stats = await fs.lstat(realTmpPath)
        if (!stats.isFile() || stats.isSymbolicLink()) {
          await fs.rm(realTmpPath, { force: true, recursive: true })
          continue
        }
        if (Date.now() - stats.ctimeMs > INCOMPLETE_RETENTION * 1000 || stats.size > fileStats[F_STAT.SIZE]) {
          await fs.rm(realTmpPath, { force: true })
          continue
        }
        const checkpoint: SyncFileStats = [...fileStats]
        checkpoint[F_STAT.INCOMPLETE_SIZE] = stats.size
        this.curIncSnap.local.set(filePath, checkpoint)
        this.logger.debug(`Incomplete ${SIDE.LOCAL}: ${filePath}`)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Unable to restore download checkpoint: ${realTmpPath}: ${error}`)
        }
      }
    }

    // Clean only expired or invalid orphans owned by this exact client and sync path.
    for (const entry of entries) {
      if (!isDownloadTmpFileName(entry.name, temporaryPrefix) || trackedNames.has(entry.name)) {
        continue
      }
      const realTmpPath = path.join(temporaryDirectory, entry.name)
      try {
        const stats = await fs.lstat(realTmpPath)
        if (!stats.isFile() || stats.isSymbolicLink()) {
          await fs.rm(realTmpPath, { force: true, recursive: true })
          continue
        }
        if (Date.now() - stats.ctimeMs > INCOMPLETE_RETENTION * 1000) await fs.rm(realTmpPath, { force: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(`Unable to clean download checkpoint: ${realTmpPath}: ${error}`)
        }
      }
    }
  }

  private isFiltered(side: SIDE.LOCAL | SIDE.REMOTE, fileName: string, filePath: string, isDir: boolean, alreadyChecked = false): boolean {
    if (!alreadyChecked && (DEFAULT_FILTERS.has(fileName) || fileName.toLowerCase() === INTERNAL_TEMPORARY_DIRECTORY)) {
      this.logger.silly(`Default Filters ${side}: ${filePath}`)
      return true
    } else if (alreadyChecked || (this.syncPathFilters && this.syncPathFilters.test(filePath))) {
      this.logger.debug(`Filters ${side}: ${filePath}`)
      if (this.reportOnly && this.appEvents) {
        this.nbFiltered--
        const tr: SyncTransfer = { ok: true, side: side, action: F_ACTION.FILTERED, file: filePath, isDir: isDir }
        this.appEvents.emit(REMOTE_RENDERER.SYNC.REPORT_TRANSFER, {
          serverId: this.req.server.id,
          syncPathId: this.syncPath.id,
          nbTasks: this.nbFiltered,
          ...tr
        })
      }
      return true
    }
    return false
  }

  private ignoreSnapshotErrors() {
    for (const [side, errors] of Object.entries(this.errors)) {
      for (const [path, error] of errors) {
        this.logger.warn(`${side} parsing ignore: ${path} - ${error}`)
        if (side === SIDE.LOCAL) {
          this.removeFile(SIDE.REMOTE, path, true)
        } else {
          this.removeFile(SIDE.LOCAL, path, true)
        }
      }
    }
  }

  private async saveLocalSnapshot() {
    await this.saveSnapshot(this.lPath, convertMapToJSON(this.curSnap.local))
  }

  private async saveRemoteSnapshot() {
    await this.saveSnapshot(this.rPath, convertMapToJSON(this.curSnap.remote))
  }

  private async saveIncompleteSnapshot() {
    await this.saveSnapshot(
      this.iPath,
      JSON.stringify({
        local: [...this.curIncSnap.local],
        remote: [...this.curIncSnap.remote],
        uploads: [...this.uploadSessions]
      })
    )
  }

  private queueIncompleteSnapshotSave(): Promise<void> {
    const save = this.incompleteSnapshotSave.catch(() => undefined).then(() => this.saveIncompleteSnapshot())
    this.incompleteSnapshotSave = save
    return save
  }

  private async loadSnapShots(): Promise<any> {
    // files snapshot
    try {
      this.oldSnap.local = convertJSONToMap(await fs.readFile(this.lPath, 'utf8'))
      this.oldSnap.remote = convertJSONToMap(await fs.readFile(this.rPath, 'utf8'))
      this.syncPath.firstSync = false
    } catch (e) {
      this.logger.debug(`Loading files snapshots: ${e}`)
      this.syncPath.firstSync = true
      this.oldSnap.local.clear()
      this.oldSnap.remote.clear()
      this.logger.debug('FirstSync mode')
    }
    // incomplete snapshot
    try {
      const oldIncSnap = JSON.parse(await fs.readFile(this.iPath, 'utf8'))
      this.oldIncSnap.local = new NormalizedMap(oldIncSnap.local)
      this.oldIncSnap.remote = new NormalizedMap(oldIncSnap.remote)
      this.uploadSessions = new NormalizedMap(oldIncSnap.uploads || [])
    } catch (e) {
      this.oldIncSnap.local.clear()
      this.oldIncSnap.remote.clear()
      this.uploadSessions.clear()
      this.logger.debug(`Loading incomplete snapshot: ${e}`)
    }
  }

  private async saveSnapshot(snapshotPath: string, content: string): Promise<void> {
    const temporaryPath = `${snapshotPath}.tmp`
    try {
      await fs.writeFile(temporaryPath, content)
      await fs.rename(temporaryPath, snapshotPath)
      this.logger.debug(`${fileBaseName(snapshotPath)} saved`)
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
