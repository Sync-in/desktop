import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'
import fse from 'fs-extra'
import { describe, expect, it, vi } from 'vitest'
import { F_STAT, SIDE, SYNC_CHECKSUM_ALG } from '../constants/handlers'
import type { SyncFileStats } from '../interfaces/sync-diff.interface'
import type { SyncUploadSessionRecord, SyncUploadSessionState } from '../interfaces/sync-upload-session.interface'
import { getDownloadTmpPath } from '../utils/download-checkpoints'
import { Sync } from './sync'
import { UploadSessionManager } from './upload-session'

const globalChecksum = 'a'.repeat(64)
const downloadClientId = '00000000-0000-4000-8000-000000000001'
const downloadSyncPathId = 17

function uploadResponse(size: number, state: SyncUploadSessionState, ino?: number, offset = size, validatedOffset = offset) {
  return {
    headers: {
      'upload-length': String(size),
      'upload-offset': String(offset),
      'upload-state': state,
      'upload-validated-offset': String(validatedOffset),
      ...(ino === undefined ? {} : { 'upload-ino': String(ino) })
    }
  }
}

function uploadError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { headers, status } })
}

function fileStats(size: number, checksum: string | null, ino = 1, mtime = 10): SyncFileStats {
  return [false, size, mtime, ino, checksum]
}

async function createUploadSource(content: Buffer | string, checksum: string | null) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-upload-session-'))
  const realPath = path.join(tmpDir, 'source.bin')
  await fs.writeFile(realPath, content)
  const stats = await fs.stat(realPath)
  return {
    fileStats: fileStats(stats.size, checksum, stats.ino, Math.floor(stats.mtime.getTime() / 1000)),
    realPath,
    tmpDir
  }
}

async function consumeUploadData(data: Buffer | Readable): Promise<Buffer> {
  return Buffer.isBuffer(data) ? data : buffer(data)
}

function createUploadHarness(session?: SyncUploadSessionRecord, chunks: string[] = []) {
  const http = Object.assign(vi.fn(), { delete: vi.fn().mockResolvedValue(undefined), head: vi.fn() })
  const fParser = {
    getUploadChunkChecksums: vi.fn().mockResolvedValue(chunks),
    getUploadSession: vi.fn().mockReturnValue(session),
    removeUploadSession: vi.fn().mockResolvedValue(undefined),
    setUploadSession: vi.fn().mockResolvedValue(undefined)
  }
  const req = {
    http,
    server: {
      identity: () => ({ id: 1, name: 'server' }),
      transfers: { maxChunkSize: 4 }
    }
  }
  const diff = {
    fParser,
    syncPath: {
      apiFromPath: (route: string, filePath: string) => `${route}/${filePath}`,
      identity: () => ({ id: 1, name: 'sync' })
    }
  }
  const uploadSessionManager = new UploadSessionManager(req as any, fParser as any, diff.syncPath as any, { warn: vi.fn() } as any, 20 * 1024 ** 2)
  return { fParser, http, uploadSessionManager }
}

function createDownloadHarness(
  localPath: string,
  filePath: string,
  remoteStats: SyncFileStats,
  incompleteSize: number,
  response: Buffer,
  secureDiff = false
) {
  const incompleteStats: SyncFileStats = [...remoteStats]
  incompleteStats[F_STAT.INCOMPLETE_SIZE] = incompleteSize
  const currentIncomplete = new Map<string, SyncFileStats>([[filePath, incompleteStats]])
  const removeIncomplete = vi.fn(async (_side: string, incompletePath: string, stagingPath?: string, onlySnap = false) => {
    currentIncomplete.delete(incompletePath)
    if (!onlySnap && stagingPath) await fs.rm(stagingPath, { force: true })
  })
  const addFile = vi.fn()
  const get = vi.fn().mockResolvedValue({ data: Readable.from([response]) })
  const fParser = {
    addFile,
    addIncomplete: vi.fn((side: string, incompletePath: string, stats: SyncFileStats) => {
      if (side === SIDE.LOCAL) currentIncomplete.set(incompletePath, stats)
    }),
    curIncSnap: { local: currentIncomplete },
    curSnap: { remote: new Map([[filePath, remoteStats]]) },
    removeFile: vi.fn(),
    removeIncomplete
  }
  const transfers = { add: vi.fn(), done: vi.fn() }
  const sync = Object.create(Sync.prototype) as Sync
  Object.assign(sync, {
    diff: {
      fParser,
      secureDiff,
      syncPath: {
        apiFromPath: (route: string, remoteFilePath: string) => `${route}/${remoteFilePath}`,
        id: downloadSyncPathId,
        lastErrors: [],
        localPath,
        localRealPathFrom: (localFilePath: string) => path.join(localPath, localFilePath)
      }
    },
    incTrackMinSize: 1,
    req: { http: { get }, server: { authID: downloadClientId } },
    transfers
  })
  return { addFile, get, removeIncomplete, sync, transfers }
}

describe('Sync downloads', () => {
  it('resumes from its namespaced staging file without touching the former .sync-in file name', async () => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-download-'))
    const filePath = 'download.bin'
    const realPath = path.join(localPath, filePath)
    const formerTemporaryPath = path.join(localPath, `.sync-in.${filePath}`)
    const realTmpPath = getDownloadTmpPath(localPath, downloadClientId, downloadSyncPathId, filePath)
    const remoteStats = fileStats(8, null)
    const { addFile, get, removeIncomplete, sync, transfers } = createDownloadHarness(localPath, filePath, remoteStats, 4, Buffer.from('efgh'))
    await fs.mkdir(path.dirname(realTmpPath), { recursive: true })
    await fs.writeFile(realTmpPath, 'abcd')
    await fs.writeFile(formerTemporaryPath, 'user data')

    try {
      await (sync as any).download(filePath)

      expect(get).toHaveBeenCalledWith(expect.any(String), { headers: { Range: 'bytes=4-' }, responseType: 'stream' })
      await expect(fs.readFile(realPath, 'utf8')).resolves.toBe('abcdefgh')
      await expect(fs.readFile(formerTemporaryPath, 'utf8')).resolves.toBe('user data')
      await expect(fs.stat(realTmpPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(removeIncomplete).toHaveBeenCalledWith(SIDE.LOCAL, filePath, null, true)
      expect(addFile).toHaveBeenCalledWith(SIDE.LOCAL, filePath, expect.any(Array))
      expect(transfers.done).toHaveBeenCalledWith(expect.objectContaining({ file: filePath, ok: true }))
    } finally {
      await fs.rm(localPath, { force: true, recursive: true })
    }
  })

  it('publishes a complete secure staging file without requesting an EOF range', async () => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-download-'))
    const filePath = 'complete.bin'
    const content = Buffer.from('abcdefgh')
    const remoteStats = fileStats(content.length, crypto.createHash(SYNC_CHECKSUM_ALG).update(content).digest('hex'))
    const realTmpPath = getDownloadTmpPath(localPath, downloadClientId, downloadSyncPathId, filePath)
    const { get, sync, transfers } = createDownloadHarness(localPath, filePath, remoteStats, content.length, Buffer.alloc(0), true)
    await fs.mkdir(path.dirname(realTmpPath), { recursive: true })
    await fs.writeFile(realTmpPath, content)

    try {
      await (sync as any).download(filePath)

      expect(get).not.toHaveBeenCalled()
      await expect(fs.readFile(path.join(localPath, filePath))).resolves.toEqual(content)
      await expect(fs.stat(realTmpPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(transfers.done).toHaveBeenCalledWith(expect.objectContaining({ file: filePath, ok: true }))
    } finally {
      await fs.rm(localPath, { force: true, recursive: true })
    }
  })

  it.each([
    { diff: false, label: 'creation', overwrite: false },
    { diff: true, label: 'replacement', overwrite: true }
  ])('publishes a $label through moveFiles and restores the remote mtime', async ({ diff, overwrite }) => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-download-'))
    const filePath = 'mounted/download.bin'
    const content = Buffer.from('abcdefgh')
    const remoteMtime = 1_700_000_000
    const remoteStats = fileStats(content.length, null, 1, remoteMtime)
    const realPath = path.join(localPath, filePath)
    const realTmpPath = getDownloadTmpPath(localPath, downloadClientId, downloadSyncPathId, filePath)
    const { sync, transfers } = createDownloadHarness(localPath, filePath, remoteStats, content.length, Buffer.alloc(0))
    const move = vi.spyOn(fse, 'move').mockImplementationOnce(async (source, destination) => {
      await fs.copyFile(source, destination)
      await fs.rm(source)
    })
    await fs.mkdir(path.dirname(realTmpPath), { recursive: true })
    await fs.mkdir(path.dirname(realPath), { recursive: true })
    await fs.writeFile(realTmpPath, content)
    if (diff) await fs.writeFile(realPath, 'old data')

    try {
      await (sync as any).download(filePath, diff)

      expect(move).toHaveBeenCalledWith(realTmpPath, realPath, { overwrite })
      await expect(fs.readFile(realPath)).resolves.toEqual(content)
      await expect(fs.stat(realTmpPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(Math.floor((await fs.stat(realPath)).mtimeMs / 1000)).toBe(remoteMtime)
      expect(transfers.done).toHaveBeenCalledWith(expect.objectContaining({ file: filePath, ok: true }))
    } finally {
      move.mockRestore()
      await fs.rm(localPath, { force: true, recursive: true })
    }
  })

  it('uses the current staging size when the stored offset is stale', async () => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-download-'))
    const filePath = 'stale-offset.bin'
    const remoteStats = fileStats(8, null)
    const realTmpPath = getDownloadTmpPath(localPath, downloadClientId, downloadSyncPathId, filePath)
    const { get, sync } = createDownloadHarness(localPath, filePath, remoteStats, remoteStats[F_STAT.SIZE], Buffer.from('efgh'))
    await fs.mkdir(path.dirname(realTmpPath), { recursive: true })
    await fs.writeFile(realTmpPath, 'abcd')

    try {
      await (sync as any).download(filePath)

      expect(get).toHaveBeenCalledWith(expect.any(String), { headers: { Range: 'bytes=4-' }, responseType: 'stream' })
      await expect(fs.readFile(path.join(localPath, filePath), 'utf8')).resolves.toBe('abcdefgh')
    } finally {
      await fs.rm(localPath, { force: true, recursive: true })
    }
  })

  it('restarts a fast download when the remote mtime changed at the same size', async () => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-download-'))
    const filePath = 'replaced.bin'
    const remoteStats = fileStats(8, null, 1, 20)
    const realTmpPath = getDownloadTmpPath(localPath, downloadClientId, downloadSyncPathId, filePath)
    const { get, sync } = createDownloadHarness(localPath, filePath, remoteStats, 4, Buffer.from('WXYZ1234'))
    ;(sync as any).diff.fParser.curIncSnap.local.set(filePath, fileStats(8, null, 1, 10))
    await fs.mkdir(path.dirname(realTmpPath), { recursive: true })
    await fs.writeFile(realTmpPath, 'abcd')

    try {
      await (sync as any).download(filePath)

      expect(get).toHaveBeenCalledWith(expect.any(String), { responseType: 'stream' })
      await expect(fs.readFile(path.join(localPath, filePath), 'utf8')).resolves.toBe('WXYZ1234')
    } finally {
      await fs.rm(localPath, { force: true, recursive: true })
    }
  })
})

describe('Sync legacy ranges', () => {
  it('does not delete the remote destination when initializing an upload checkpoint', async () => {
    const addIncomplete = vi.fn()
    const removeIncomplete = vi.fn()
    const sync = Object.create(Sync.prototype) as Sync
    Object.assign(sync, {
      diff: {
        fParser: {
          addIncomplete,
          curIncSnap: { remote: new Map<string, SyncFileStats>() },
          removeIncomplete
        },
        secureDiff: false
      },
      incTrackMinSize: 1
    })
    const stats = fileStats(8, null)

    await expect((sync as any).hasRange(SIDE.REMOTE, 'upload.bin', stats)).resolves.toBe(0)

    expect(removeIncomplete).not.toHaveBeenCalled()
    expect(addIncomplete).toHaveBeenCalledWith(SIDE.REMOTE, 'upload.bin', [...stats, 0])
  })
})

describe('Sync lifecycle', () => {
  it('stops upload-session recovery with the synchronization', () => {
    const uploadSessionManager = { stop: vi.fn() }
    const sync = Object.create(Sync.prototype) as Sync
    Object.assign(sync, {
      tasksManager: { stop: vi.fn() },
      transfers: { stop: vi.fn() },
      uploadSessionManager
    })

    sync.stop()

    expect(uploadSessionManager.stop).toHaveBeenCalledOnce()
    expect(sync.wasAborted).toBe(true)
  })
})

describe('Sync local moves', () => {
  it('uses the cross-filesystem move fallback without overwriting the destination', async () => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-local-move-'))
    const sourcePath = 'source.bin'
    const destinationPath = 'mounted/destination.bin'
    const sourceRealPath = path.join(localPath, sourcePath)
    const destinationRealPath = path.join(localPath, destinationPath)
    const stats = fileStats(4, null)
    const moveFile = vi.fn()
    const done = vi.fn()
    const move = vi.spyOn(fse, 'move').mockImplementationOnce(async (source, destination) => {
      await fs.copyFile(source, destination)
      await fs.rm(source)
    })
    const sync = Object.create(Sync.prototype) as Sync
    Object.assign(sync, {
      diff: {
        fParser: {
          addFile: vi.fn(),
          curSnap: { local: new Map([[sourcePath, stats]]) },
          moveFile,
          oldSnap: { local: new Map([[sourcePath, stats]]) },
          removeFile: vi.fn()
        },
        syncPath: {
          lastErrors: [],
          localRealPathFrom: (filePath: string) => path.join(localPath, filePath)
        }
      },
      transfers: { done }
    })
    await fs.writeFile(sourceRealPath, 'data')

    try {
      await (sync as any).localMove([{ src: sourcePath, dst: destinationPath }])

      expect(move).toHaveBeenCalledWith(sourceRealPath, destinationRealPath, { overwrite: false })
      await expect(fs.readFile(destinationRealPath, 'utf8')).resolves.toBe('data')
      await expect(fs.stat(sourceRealPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(moveFile).toHaveBeenCalledWith(SIDE.LOCAL, sourcePath, destinationPath)
      expect(done).toHaveBeenCalledWith(expect.objectContaining({ file: sourcePath, fileDst: destinationPath, ok: true }))
    } finally {
      move.mockRestore()
      await fs.rm(localPath, { force: true, recursive: true })
    }
  })
})

describe('UploadSessionManager', () => {
  it('reads repeated ranges without creating streams on the pinned file handle', async () => {
    const content = Buffer.from('abcdefghijkl')
    const source = await createUploadSource(content, null)
    const sourceHandle = await fs.open(source.realPath, 'r')
    const createReadStream = vi.spyOn(sourceHandle, 'createReadStream').mockImplementation(() => {
      throw new Error('FileHandle.createReadStream must not be used for upload chunks')
    })
    const { uploadSessionManager } = createUploadHarness()
    const chunks: Buffer[] = []

    try {
      for (let offset = 0; offset < content.length; offset += 1) {
        chunks.push(await consumeUploadData((uploadSessionManager as any).uploadSessionChunkStream(sourceHandle, offset, offset + 1, undefined)))
      }

      expect(Buffer.concat(chunks)).toEqual(content)
      expect(createReadStream).not.toHaveBeenCalled()
    } finally {
      createReadStream.mockRestore()
      await sourceHandle.close()
      await fs.rm(source.tmpDir, { force: true, recursive: true })
    }
  })

  it('publishes an empty secure file without a chunk checksum', async () => {
    const source = await createUploadSource(Buffer.alloc(0), globalChecksum)
    const { fParser, http, uploadSessionManager } = createUploadHarness(undefined, [])
    http.mockResolvedValue(uploadResponse(0, 'complete', 41))

    try {
      await expect(uploadSessionManager.upload('empty.bin', source.realPath, source.fileStats, 'post')).resolves.toBe(41)

      expect(fParser.getUploadChunkChecksums).not.toHaveBeenCalled()
      expect(fParser.setUploadSession).toHaveBeenCalledWith('empty.bin', expect.any(Object), false)
      const request = http.mock.calls[0][0]
      expect(request.method).toBe('post')
      expect(request.headers).toMatchObject({
        'Content-Length': '0',
        'upload-checksum': globalChecksum,
        'upload-length': '0',
        'upload-offset': '0'
      })
      expect(Buffer.isBuffer(request.data)).toBe(true)
      expect(request.data).toHaveLength(0)
    } finally {
      await fs.rm(source.tmpDir, { force: true, recursive: true })
    }
  })

  it('publishes a ready secure session with an empty PATCH', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-upload-session-'))
    const realPath = path.join(tmpDir, 'ready.bin')
    await fs.writeFile(realPath, 'data')
    const stats = await fs.stat(realPath)
    const sourceChecksum = crypto.createHash(SYNC_CHECKSUM_ALG).update('data').digest('hex')
    const sourceStats = fileStats(4, sourceChecksum, stats.ino, Math.floor(stats.mtime.getTime() / 1000))
    const session: SyncUploadSessionRecord = {
      checksum: sourceChecksum,
      chunkSize: 4,
      ino: sourceStats[F_STAT.INO],
      method: 'put',
      mtime: sourceStats[F_STAT.MTIME],
      size: 4,
      uploadId: '00000000-0000-4000-8000-000000000001'
    }
    const { fParser, http, uploadSessionManager } = createUploadHarness(session, ['b'.repeat(64)])
    http.head.mockResolvedValue(uploadResponse(4, 'ready'))
    http.mockResolvedValue(uploadResponse(4, 'complete', 42))

    try {
      await expect(uploadSessionManager.upload('ready.bin', realPath, sourceStats, 'put')).resolves.toBe(42)

      expect(http.head).toHaveBeenCalledOnce()
      expect(fParser.getUploadChunkChecksums).not.toHaveBeenCalled()
      const request = http.mock.calls[0][0]
      expect(request.method).toBe('patch')
      expect(request.headers).toMatchObject({ 'Content-Length': '0', 'upload-length': '4', 'upload-offset': '4' })
      expect(request.headers).not.toHaveProperty('upload-checksum')
      expect(Buffer.isBuffer(request.data)).toBe(true)
      expect(request.data).toHaveLength(0)
    } finally {
      await fs.rm(tmpDir, { force: true, recursive: true })
    }
  })

  it('cancels a ready session when the source identity changed since parsing', async () => {
    const source = await createUploadSource('data', globalChecksum)
    const session: SyncUploadSessionRecord = {
      checksum: globalChecksum,
      chunkSize: 4,
      ino: source.fileStats[F_STAT.INO],
      method: 'put',
      mtime: source.fileStats[F_STAT.MTIME],
      size: 4,
      uploadId: '00000000-0000-4000-8000-000000000004'
    }
    const { fParser, http, uploadSessionManager } = createUploadHarness(session, ['b'.repeat(64)])
    http.head.mockResolvedValue(uploadResponse(4, 'ready'))
    await fs.rename(source.realPath, path.join(source.tmpDir, 'parsed-source.bin'))
    await fs.writeFile(source.realPath, 'data')

    try {
      await expect(uploadSessionManager.upload('changed.bin', source.realPath, source.fileStats, 'put')).rejects.toThrow(
        'source has changed since parsing'
      )

      expect(fParser.getUploadChunkChecksums).not.toHaveBeenCalled()
      expect(http).not.toHaveBeenCalled()
      expect(http.delete).toHaveBeenCalledOnce()
      expect(fParser.removeUploadSession).toHaveBeenCalledWith('changed.bin')
    } finally {
      await fs.rm(source.tmpDir, { force: true, recursive: true })
    }
  })

  it('keeps the opened fast source when its path is replaced between chunks', async () => {
    const source = await createUploadSource('abcdefgh', null)
    const { fParser, http, uploadSessionManager } = createUploadHarness()
    const uploadedChunks: Buffer[] = []
    http.mockImplementation(async (request) => {
      uploadedChunks.push(await consumeUploadData(request.data))
      if (uploadedChunks.length === 1) {
        await fs.rename(source.realPath, path.join(source.tmpDir, 'opened-source.bin'))
        await fs.writeFile(source.realPath, 'WXYZ1234')
        return uploadResponse(8, 'uploading', undefined, 4, 4)
      }
      return uploadResponse(8, 'complete', 43)
    })

    try {
      await expect(uploadSessionManager.upload('fast.bin', source.realPath, source.fileStats, 'post')).resolves.toBe(43)

      expect(fParser.getUploadChunkChecksums).not.toHaveBeenCalled()
      expect(fParser.setUploadSession).toHaveBeenCalledWith('fast.bin', expect.objectContaining({ ino: source.fileStats[F_STAT.INO] }), true)
      expect(http).toHaveBeenCalledTimes(2)
      expect(http.mock.calls[0][0].method).toBe('post')
      expect(http.mock.calls[0][0].headers).toMatchObject({ 'Content-Length': '4', 'upload-length': '8', 'upload-offset': '0' })
      expect(http.mock.calls[0][0].headers).not.toHaveProperty('upload-checksum')
      expect(http.mock.calls[1][0].method).toBe('patch')
      expect(http.mock.calls[1][0].headers).toMatchObject({ 'Content-Length': '4', 'upload-length': '8', 'upload-offset': '4' })
      expect(uploadedChunks).toEqual([Buffer.from('abcd'), Buffer.from('efgh')])
      await expect(fs.readFile(source.realPath, 'utf8')).resolves.toBe('WXYZ1234')
    } finally {
      await fs.rm(source.tmpDir, { force: true, recursive: true })
    }
  })

  it('resumes a partial secure chunk from the staged offset with the complete chunk checksum', async () => {
    const content = Buffer.from('abcdefgh')
    const chunkChecksum = crypto.createHash(SYNC_CHECKSUM_ALG).update(content.subarray(4)).digest('hex')
    const source = await createUploadSource(content, globalChecksum)
    const session: SyncUploadSessionRecord = {
      checksum: globalChecksum,
      chunkSize: 4,
      ino: source.fileStats[F_STAT.INO],
      method: 'put',
      mtime: source.fileStats[F_STAT.MTIME],
      size: content.length,
      uploadId: '00000000-0000-4000-8000-000000000002'
    }
    const { fParser, http, uploadSessionManager } = createUploadHarness(session, ['b'.repeat(64), chunkChecksum])
    http.head.mockResolvedValue(uploadResponse(content.length, 'uploading', undefined, 6, 4))
    let uploadedChunk: Buffer | undefined
    http.mockImplementation(async (request) => {
      uploadedChunk = await consumeUploadData(request.data)
      return uploadResponse(content.length, 'complete', 44)
    })

    try {
      await expect(uploadSessionManager.upload('partial.bin', source.realPath, source.fileStats, 'put')).resolves.toBe(44)

      expect(http.head).toHaveBeenCalledOnce()
      expect(fParser.getUploadChunkChecksums).toHaveBeenCalledOnce()
      const request = http.mock.calls[0][0]
      expect(request.method).toBe('patch')
      expect(request.headers).toMatchObject({ 'Content-Length': '34', 'upload-length': '8', 'upload-offset': '6' })
      expect(uploadedChunk).toEqual(Buffer.concat([content.subarray(6), Buffer.from(chunkChecksum, 'hex')]))
    } finally {
      await fs.rm(source.tmpDir, { force: true, recursive: true })
    }
  })

  it('reconciles a 409 response through HEAD before resuming the secure upload', async () => {
    const conflict = uploadError(409)
    const source = await createUploadSource('abcdefgh', globalChecksum)
    const { http, uploadSessionManager } = createUploadHarness(undefined, ['b'.repeat(64), 'c'.repeat(64)])
    const waitForRetry = vi.fn().mockResolvedValue(undefined)
    ;(uploadSessionManager as any).waitForUploadSessionRetry = waitForRetry
    let uploadAttempt = 0
    http.mockImplementation(async (request) => {
      await consumeUploadData(request.data)
      if (uploadAttempt++ === 0) throw conflict
      return uploadResponse(8, 'complete', 45)
    })
    http.head.mockResolvedValue(uploadResponse(8, 'uploading', undefined, 4, 4))

    try {
      await expect(uploadSessionManager.upload('conflict.bin', source.realPath, source.fileStats, 'post')).resolves.toBe(45)

      expect(waitForRetry).toHaveBeenCalledExactlyOnceWith(conflict, 1)
      expect(http.head).toHaveBeenCalledOnce()
      expect(http).toHaveBeenCalledTimes(2)
      expect(http.mock.calls[0][0].method).toBe('post')
      expect(http.mock.calls[1][0].method).toBe('patch')
      expect(http.mock.calls[1][0].headers).toMatchObject({ 'Content-Length': '36', 'upload-offset': '4' })
    } finally {
      await fs.rm(source.tmpDir, { force: true, recursive: true })
    }
  })

  it('bounds 423 recovery attempts while preserving the session', async () => {
    const source = await createUploadSource('data', globalChecksum)
    const session: SyncUploadSessionRecord = {
      checksum: globalChecksum,
      chunkSize: 4,
      ino: source.fileStats[F_STAT.INO],
      method: 'put',
      mtime: source.fileStats[F_STAT.MTIME],
      size: 4,
      uploadId: '00000000-0000-4000-8000-000000000003'
    }
    const locked = uploadError(423, { 'retry-after': '7' })
    const { fParser, http, uploadSessionManager } = createUploadHarness(session, ['b'.repeat(64)])
    const waitForRetry = vi.fn().mockResolvedValue(undefined)
    ;(uploadSessionManager as any).waitForUploadSessionRetry = waitForRetry
    http.head.mockResolvedValue(uploadResponse(4, 'uploading', undefined, 0, 0))
    http.mockImplementation(async (request) => {
      await consumeUploadData(request.data)
      throw locked
    })

    try {
      await expect(uploadSessionManager.upload('locked.bin', source.realPath, source.fileStats, 'put')).rejects.toBe(locked)

      expect(http).toHaveBeenCalledTimes(4)
      expect(http.head).toHaveBeenCalledTimes(4)
      expect(waitForRetry).toHaveBeenCalledTimes(3)
      expect(waitForRetry).toHaveBeenLastCalledWith(locked, 3)
      expect(fParser.removeUploadSession).not.toHaveBeenCalled()
      expect(http.delete).not.toHaveBeenCalled()
    } finally {
      await fs.rm(source.tmpDir, { force: true, recursive: true })
    }
  })

  it('interrupts a 423 retry wait on stop while preserving the error and session', async () => {
    const source = await createUploadSource('data', globalChecksum)
    const session: SyncUploadSessionRecord = {
      checksum: globalChecksum,
      chunkSize: 4,
      ino: source.fileStats[F_STAT.INO],
      method: 'put',
      mtime: source.fileStats[F_STAT.MTIME],
      size: 4,
      uploadId: '00000000-0000-4000-8000-000000000005'
    }
    const locked = uploadError(423, { 'retry-after': '30' })
    const { fParser, http, uploadSessionManager } = createUploadHarness(session, ['b'.repeat(64)])
    let notifyRequest: () => void = () => undefined
    const requestReceived = new Promise<void>((resolve) => {
      notifyRequest = () => resolve()
    })
    http.head.mockResolvedValue(uploadResponse(4, 'uploading', undefined, 0, 0))
    http.mockImplementation(async (request) => {
      await consumeUploadData(request.data)
      notifyRequest()
      throw locked
    })
    const upload = uploadSessionManager.upload('locked.bin', source.realPath, source.fileStats, 'put')

    try {
      await requestReceived
      await new Promise<void>((resolve) => setImmediate(resolve))
      uploadSessionManager.stop()

      await expect(upload).rejects.toBe(locked)
      expect(http).toHaveBeenCalledOnce()
      expect(http.head).toHaveBeenCalledOnce()
      expect(fParser.removeUploadSession).not.toHaveBeenCalled()
      expect(http.delete).not.toHaveBeenCalled()
    } finally {
      uploadSessionManager.stop()
      await upload.catch(() => undefined)
      await fs.rm(source.tmpDir, { force: true, recursive: true })
    }
  })
})
