import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { RE2JS } from 're2js'
import { describe, expect, it, vi } from 'vitest'
import { LOCAL_RENDERER } from '../../../main/constants/events'
import { CONFLICT_MODE, DIFF_MODE, SYNC_MODE } from '../constants/diff'
import { F_STAT, INCOMPLETE_RETENTION, SIDE, SYNC_DIFF_DONE } from '../constants/handlers'
import type { SyncFileStats } from '../interfaces/sync-diff.interface'
import type { SyncUploadSessionRecord } from '../interfaces/sync-upload-session.interface'
import { SyncPath } from '../models/syncpath'
import { checksumFile, checksumFileWithChunks } from '../utils/functions'
import { getDownloadTmpPath, getDownloadTmpPrefix } from '../utils/download-checkpoints'
import { isUploadSessionRecord, uploadSessionMatchesFileStats } from '../utils/upload-session'
import { NormalizedMap } from '../utils/normalizedMap'
import { SYNC_MAX_PATH_FILTER_WARNINGS } from '../utils/path-filters/constants'
import { FilesParser } from './parser'

vi.mock('./loggers', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    silly: vi.fn()
  })
}))

vi.mock('../utils/functions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/functions')>()
  return {
    ...actual,
    checksumFile: vi.fn(),
    checksumFileWithChunks: vi.fn()
  }
})

const file: SyncFileStats = [false, 4, 10, 1, null]
const clientId = '00000000-0000-4000-8000-000000000001'
const syncPathId = 17

function createParser(
  mode: SYNC_MODE,
  ignoreDelete: boolean,
  filters: string[] = [],
  post = vi.fn(),
  reportOnly = false,
  appEvents: EventEmitter | null = null,
  localPath = '/local/media'
): FilesParser {
  const syncPath = new SyncPath({
    id: syncPathId,
    name: 'Media',
    localPath,
    remotePath: 'PERSONAL/media',
    permissions: 'add:modify:delete',
    mode,
    ignoreDelete,
    diffMode: DIFF_MODE.FAST,
    conflictMode: CONFLICT_MODE.RECENT,
    filters
  })
  const req = { server: { id: 1, name: 'server', authID: clientId, identity: () => ({ id: 1, name: 'server' }) }, http: { post } }
  return new FilesParser(syncPath, req as any, reportOnly, appEvents)
}

function firstSyncError(parser: FilesParser): unknown {
  try {
    ;(parser as any).checkOnFirstSync()
  } catch (error) {
    return error
  }
  return undefined
}

describe('FilesParser first synchronization guard', () => {
  it.each([
    { mode: SYNC_MODE.UPLOAD, populatedSide: 'remote' },
    { mode: SYNC_MODE.DOWNLOAD, populatedSide: 'local' }
  ])('keeps the destructive empty-source guard in $mode mode', ({ mode, populatedSide }) => {
    const parser = createParser(mode, false)
    parser.curSnap[populatedSide as 'local' | 'remote'] = new NormalizedMap<string, SyncFileStats>([['file.txt', file]])

    expect(firstSyncError(parser)).toEqual(expect.stringContaining('will be deleted'))
    expect(parser.wasAborted).toBe(true)
  })

  it.each([
    { mode: SYNC_MODE.UPLOAD, populatedSide: 'remote' },
    { mode: SYNC_MODE.DOWNLOAD, populatedSide: 'local' }
  ])('does not block an empty source when deletions are ignored in $mode mode', ({ mode, populatedSide }) => {
    const parser = createParser(mode, true)
    parser.curSnap[populatedSide as 'local' | 'remote'] = new NormalizedMap<string, SyncFileStats>([['file.txt', file]])

    expect(firstSyncError(parser)).toBeUndefined()
    expect(parser.wasAborted).toBe(false)
  })
})

describe('FilesParser upload checksums', () => {
  it('calculates only the global checksum for a download-only path', async () => {
    const parser = createParser(SYNC_MODE.DOWNLOAD, false)
    ;(parser as any).req.server.transfers = { maxChunkSize: 4 }
    vi.mocked(checksumFile).mockResolvedValue('global-checksum')
    vi.mocked(checksumFileWithChunks).mockResolvedValue({ checksum: 'chunked-checksum', chunks: ['chunk'] })

    await expect((parser as any).getChecksumFile('file.bin', '/local/media/file.bin', 8, 1, 10)).resolves.toBe('global-checksum')

    expect(checksumFile).toHaveBeenCalledWith('/local/media/file.bin')
    expect(checksumFileWithChunks).not.toHaveBeenCalled()
  })

  it('reuses the global checksum for a file that fits in one upload chunk', async () => {
    const parser = createParser(SYNC_MODE.UPLOAD, false)
    ;(parser as any).req.server.transfers = { maxChunkSize: 4 }
    vi.mocked(checksumFile).mockResolvedValue('global-checksum')

    const globalChecksum = await (parser as any).getChecksumFile('file.bin', '/local/media/file.bin', 4, 1, 10)
    const chunks = await parser.getUploadChunkChecksums('file.bin', '/local/media/file.bin', [false, 4, 10, 1, globalChecksum], 4)

    expect(chunks).toEqual(['global-checksum'])
    expect(checksumFile).toHaveBeenCalledWith('/local/media/file.bin')
    expect(checksumFileWithChunks).not.toHaveBeenCalled()
  })
})

describe('FilesParser upload session records', () => {
  const session: SyncUploadSessionRecord = {
    checksum: null,
    chunkSize: 4,
    ino: 1,
    method: 'put',
    mtime: 10,
    size: 4,
    uploadId: '00000000-0000-4000-8000-000000000001'
  }

  it('requires a persisted local inode', () => {
    expect(isUploadSessionRecord(session)).toBe(true)
    expect(isUploadSessionRecord({ ...session, ino: undefined })).toBe(false)
  })

  it('matches the inode locally but not when reconciling the published remote file', () => {
    const localStats: SyncFileStats = [false, 4, 10, 1, null]
    const replacedLocalStats: SyncFileStats = [false, 4, 10, 2, null]

    expect(uploadSessionMatchesFileStats(session, localStats, true)).toBe(true)
    expect(uploadSessionMatchesFileStats(session, replacedLocalStats, true)).toBe(false)
    expect(uploadSessionMatchesFileStats(session, replacedLocalStats)).toBe(true)
  })

  it('removes a completed session record when the published remote inode differs', async () => {
    const parser = createParser(SYNC_MODE.BOTH, false)
    const localStats: SyncFileStats = [false, 4, 10, 1, null]
    const remoteStats: SyncFileStats = [false, 4, 10, 99, null]
    const remove = vi.fn().mockResolvedValue(undefined)
    ;(parser as any).req.server.transfers = { maxChunkSize: 4 }
    ;(parser as any).req.http.delete = remove
    ;(parser as any).queueIncompleteSnapshotSave = vi.fn().mockResolvedValue(undefined)
    parser.curSnap.local.set('published.bin', localStats)
    parser.curSnap.remote.set('published.bin', remoteStats)
    parser.uploadSessions.set('published.bin', session)

    await (parser as any).reconcileUploadSessions()

    expect(parser.uploadSessions.has('published.bin')).toBe(false)
    expect(remove).toHaveBeenCalledOnce()
  })

  it('persists only eager session additions and batches completed-session removal', async () => {
    const parser = createParser(SYNC_MODE.BOTH, false)
    const save = vi.fn().mockResolvedValue(undefined)
    ;(parser as any).queueIncompleteSnapshotSave = save

    await parser.setUploadSession('small.bin', session, false)
    await parser.removeUploadSession('small.bin')
    await parser.setUploadSession('large.bin', session)

    expect(save).toHaveBeenCalledOnce()
  })
})

describe('FilesParser path filters', () => {
  it('reserves only the exact internal temporary directory name', () => {
    const parser = createParser(SYNC_MODE.BOTH, false)

    expect((parser as any).isFiltered(SIDE.LOCAL, '.sync-in-tmp', '.sync-in-tmp', true)).toBe(true)
    expect((parser as any).isFiltered(SIDE.LOCAL, '.SYNC-IN-TMP', '.SYNC-IN-TMP', true)).toBe(true)
    expect((parser as any).isFiltered(SIDE.LOCAL, '.sync-in-tmp-user', '.sync-in-tmp-user', true)).toBe(false)
    expect((parser as any).isFiltered(SIDE.LOCAL, '.sync-in.document', '.sync-in.document', false)).toBe(false)
  })

  it('scans ordinary .sync-in files but not the internal temporary directory', async () => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-parser-filter-'))
    const parser = createParser(SYNC_MODE.BOTH, false, [], vi.fn(), false, null, localPath)
    await fs.writeFile(path.join(localPath, '.sync-in.document'), 'user data')
    await fs.mkdir(path.join(localPath, '.sync-in-tmp'))
    await fs.writeFile(path.join(localPath, '.sync-in-tmp', 'internal.part'), 'internal data')

    try {
      const files = []
      for await (const [filePath] of (parser as any).getLocalFiles(localPath)) files.push(filePath)

      expect(files).toEqual(['.sync-in.document'])
    } finally {
      await fs.rm(localPath, { force: true, recursive: true })
    }
  })

  it('keeps ordinary remote .sync-in files visible', async () => {
    const filePath = '.sync-in.remote.bin'
    const stats: SyncFileStats = [false, 4, 10, 1, null]
    const post = vi.fn().mockResolvedValue({ data: Readable.from([`${JSON.stringify({ [filePath]: stats })}\n${SYNC_DIFF_DONE}\n`]) })
    const parser = createParser(SYNC_MODE.BOTH, false, [], post)
    const files = []

    for await (const entry of (parser as any).getRemoteFiles()) files.push(entry)

    expect(files).toEqual([[filePath, stats]])
  })

  it('filters locally with RE2JS and warns about an ignored alternative', () => {
    const post = vi.fn()
    const parser = createParser(SYNC_MODE.BOTH, false, ['(?=cache)', 'documents/.+\\.pdf$'], post)

    expect((parser as any).syncPathFilters).toBeInstanceOf(RE2JS)
    expect((parser as any).isFiltered(SIDE.LOCAL, 'report.PDF', 'DOCUMENTS/report.PDF', false)).toBe(true)
    expect((parser as any).isFiltered(SIDE.LOCAL, 'report.txt', 'DOCUMENTS/report.txt', false)).toBe(false)
    expect(parser.logger.warn).toHaveBeenCalledOnce()
    expect(vi.mocked(parser.logger.warn).mock.calls[0][0]).toContain('Invalid or unsupported path filter pattern')
    expect(post).not.toHaveBeenCalled()
  })

  it.each([
    { case: 'partially supported alternatives', filters: ['(?=cache)', '\\.tmp$'], expected: '(?=cache)|\\.tmp$' },
    { case: 'no filters', filters: [], expected: null }
  ])('sends the original string source for $case', async ({ filters, expected }) => {
    const post = vi.fn().mockResolvedValue({ data: Readable.from([SYNC_DIFF_DONE + '\n']) })
    const parser = createParser(SYNC_MODE.BOTH, false, filters, post)
    const files = []

    for await (const entry of (parser as any).getRemoteFiles()) {
      files.push(entry)
    }

    expect(files).toEqual([])
    expect(post).toHaveBeenCalledOnce()
    expect(post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ pathFilters: expected }), { responseType: 'stream' })
  })

  it('uses no matcher and notifies once when every alternative is ignored', () => {
    const appEvents = new EventEmitter()
    const notification = vi.fn()
    const post = vi.fn()
    appEvents.on(LOCAL_RENDERER.SYNC.MSG, notification)

    const parser = createParser(SYNC_MODE.BOTH, false, ['(?=cache)', '(?=documents)'], post, false, appEvents)

    expect((parser as any).syncPathFilters).toBeNull()
    expect((parser as any).isFiltered(SIDE.LOCAL, 'report.txt', 'documents/report.txt', false)).toBe(false)
    expect(parser.logger.warn).toHaveBeenCalledTimes(2)
    expect(notification).toHaveBeenCalledOnce()
    expect(notification).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: 1, title: expect.stringContaining('Media'), body: expect.stringContaining('2 path filter') })
    )
    expect(post).not.toHaveBeenCalled()
  })

  it('caps rejection logs while notifying about every ignored alternative', () => {
    const appEvents = new EventEmitter()
    const notification = vi.fn()
    const count = SYNC_MAX_PATH_FILTER_WARNINGS + 2
    const source = Array(count).fill('(?=x)').join('|')
    appEvents.on(LOCAL_RENDERER.SYNC.MSG, notification)

    const parser = createParser(SYNC_MODE.BOTH, false, [source], vi.fn(), false, appEvents)

    expect(parser.logger.warn).toHaveBeenCalledTimes(SYNC_MAX_PATH_FILTER_WARNINGS + 1)
    expect(vi.mocked(parser.logger.warn).mock.calls[SYNC_MAX_PATH_FILTER_WARNINGS][0]).toContain('2 additional path filter alternatives')
    expect(notification).toHaveBeenCalledOnce()
    expect(notification).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining(`${count} path filter`) }))
  })
})

describe('FilesParser download checkpoints', () => {
  it('restores a tracked staging file without scanning the internal directory', async () => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-parser-download-'))
    const parser = createParser(SYNC_MODE.BOTH, false, [], vi.fn(), false, null, localPath)
    const filePath = 'documents/download.bin'
    const realTmpPath = getDownloadTmpPath(localPath, clientId, syncPathId, filePath)
    parser.oldIncSnap.local.set(filePath, [false, 100, 10, 1, null, 4])
    await fs.mkdir(path.dirname(realTmpPath))
    await fs.writeFile(realTmpPath, Buffer.alloc(12))
    await fs.utimes(realTmpPath, new Date(0), new Date(0))

    try {
      await (parser as any).restoreDownloadCheckpoints()

      expect(parser.curIncSnap.local.get(filePath)?.[F_STAT.INCOMPLETE_SIZE]).toBe(12)
    } finally {
      await fs.rm(localPath, { force: true, recursive: true })
    }
  })

  it('removes an expired tracked staging file', async () => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-parser-download-'))
    const parser = createParser(SYNC_MODE.BOTH, false, [], vi.fn(), false, null, localPath)
    const filePath = 'documents/download.bin'
    const realTmpPath = getDownloadTmpPath(localPath, clientId, syncPathId, filePath)
    parser.oldIncSnap.local.set(filePath, [false, 100, 10, 1, null, 4])
    await fs.mkdir(path.dirname(realTmpPath))
    await fs.writeFile(realTmpPath, Buffer.alloc(12))
    const temporaryStats = await fs.lstat(realTmpPath)
    const now = vi.spyOn(Date, 'now').mockReturnValue(temporaryStats.ctimeMs + (INCOMPLETE_RETENTION + 1) * 1000)

    try {
      await (parser as any).restoreDownloadCheckpoints()

      expect(parser.curIncSnap.local.has(filePath)).toBe(false)
      await expect(fs.stat(realTmpPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      now.mockRestore()
      await fs.rm(localPath, { force: true, recursive: true })
    }
  })

  it('removes a tracked staging entry that is not a regular file', async () => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-parser-download-'))
    const parser = createParser(SYNC_MODE.BOTH, false, [], vi.fn(), false, null, localPath)
    const filePath = 'documents/download.bin'
    const realTmpPath = getDownloadTmpPath(localPath, clientId, syncPathId, filePath)
    parser.oldIncSnap.local.set(filePath, [false, 100, 10, 1, null, 4])
    await fs.mkdir(realTmpPath, { recursive: true })

    try {
      await (parser as any).restoreDownloadCheckpoints()

      expect(parser.curIncSnap.local.has(filePath)).toBe(false)
      await expect(fs.stat(realTmpPath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await fs.rm(localPath, { force: true, recursive: true })
    }
  })

  it('cleans only expired orphan files owned by the current client and sync path', async () => {
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-parser-download-'))
    const parser = createParser(SYNC_MODE.BOTH, false, [], vi.fn(), false, null, localPath)
    const temporaryDirectory = path.join(localPath, '.sync-in-tmp')
    const ownedName = `${getDownloadTmpPrefix(clientId, syncPathId)}${'a'.repeat(64)}.part`
    const invalidOwnedName = `${getDownloadTmpPrefix(clientId, syncPathId)}${'e'.repeat(64)}.part`
    const foreignNames = [
      `desktop-00000000-0000-4000-8000-000000000002-sync-path-${syncPathId}-download-${'b'.repeat(64)}.part`,
      `desktop-${clientId}-sync-path-${syncPathId + 1}-download-${'c'.repeat(64)}.part`,
      `server-user-42-download-${'d'.repeat(64)}.part`,
      'unknown.part'
    ]
    await fs.mkdir(temporaryDirectory)
    await fs.mkdir(path.join(temporaryDirectory, invalidOwnedName))
    await Promise.all([ownedName, ...foreignNames].map((name) => fs.writeFile(path.join(temporaryDirectory, name), name)))
    await Promise.all([ownedName, ...foreignNames].map((name) => fs.utimes(path.join(temporaryDirectory, name), new Date(0), new Date(0))))
    const temporaryStats = await fs.lstat(path.join(temporaryDirectory, ownedName))
    const now = vi.spyOn(Date, 'now').mockReturnValue(temporaryStats.ctimeMs + (INCOMPLETE_RETENTION + 1) * 1000)

    try {
      await (parser as any).restoreDownloadCheckpoints()

      await expect(fs.readdir(temporaryDirectory).then((entries) => entries.sort())).resolves.toEqual(foreignNames.sort())
    } finally {
      now.mockRestore()
      await fs.rm(localPath, { force: true, recursive: true })
    }
  })
})
