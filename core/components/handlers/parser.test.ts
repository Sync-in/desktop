import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { RE2JS } from 're2js'
import { describe, expect, it, vi } from 'vitest'
import { LOCAL_RENDERER } from '../../../main/constants/events'
import { CONFLICT_MODE, DIFF_MODE, SYNC_MODE } from '../constants/diff'
import { SIDE, SYNC_DIFF_DONE } from '../constants/handlers'
import type { SyncFileStats } from '../interfaces/sync-diff.interface'
import { SyncPath } from '../models/syncpath'
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

const file: SyncFileStats = [false, 4, 10, 1, null]

function createParser(
  mode: SYNC_MODE,
  ignoreDelete: boolean,
  filters: string[] = [],
  post = vi.fn(),
  reportOnly = false,
  appEvents: EventEmitter | null = null
): FilesParser {
  const syncPath = new SyncPath({
    name: 'Media',
    localPath: '/local/media',
    remotePath: 'PERSONAL/media',
    permissions: 'add:modify:delete',
    mode,
    ignoreDelete,
    diffMode: DIFF_MODE.FAST,
    conflictMode: CONFLICT_MODE.RECENT,
    filters
  })
  const req = { server: { id: 1, name: 'server', identity: () => ({ id: 1, name: 'server' }) }, http: { post } }
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

describe('FilesParser path filters', () => {
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
