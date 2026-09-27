import { describe, expect, it } from 'vitest'
import { CONFLICT_MODE, DIFF_MODE, SYNC_MODE } from '../constants/diff'
import type { SyncFileStats } from '../interfaces/sync-diff.interface'
import { SyncPath } from '../models/syncpath'
import { NormalizedMap } from '../utils/normalizedMap'
import { FilesParser } from './parser'

const file: SyncFileStats = [false, 4, 10, 1, null]

function createParser(mode: SYNC_MODE, ignoreDelete: boolean): FilesParser {
  const syncPath = new SyncPath({
    name: 'Media',
    localPath: '/local/media',
    remotePath: 'PERSONAL/media',
    permissions: 'add:modify:delete',
    mode,
    ignoreDelete,
    diffMode: DIFF_MODE.FAST,
    conflictMode: CONFLICT_MODE.RECENT,
    filters: []
  })
  const req = { server: { id: 1, identity: () => ({ id: 1, name: 'server' }) } }
  return new FilesParser(syncPath, req as any)
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
