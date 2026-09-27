import { describe, expect, it } from 'vitest'
import { CONFLICT_MODE, DIFF_MODE, SIDE_STATE, SYNC_MODE } from '../constants/diff'
import type { SyncFileStats } from '../interfaces/sync-diff.interface'
import { SyncPath } from '../models/syncpath'
import { NormalizedMap } from '../utils/normalizedMap'
import { DiffParser } from './diff'
import type { FilesParser } from './parser'

type Entries = [string, SyncFileStats][]
type Actions = Partial<Record<SIDE_STATE, any[]>>

const stats = (size: number, mtime = 10, ino = 1, checksum: string | null = null, isDir = false): SyncFileStats => [isDir, size, mtime, ino, checksum]

const directory = (mtime = 10, ino = 1): SyncFileStats => stats(0, mtime, ino, null, true)

async function diffActions({
  mode,
  ignoreDelete = false,
  diffMode = DIFF_MODE.FAST,
  conflictMode = CONFLICT_MODE.RECENT,
  firstSync = false,
  local = [],
  remote = [],
  oldLocal = [],
  oldRemote = []
}: {
  mode: SYNC_MODE
  ignoreDelete?: boolean
  diffMode?: DIFF_MODE
  conflictMode?: CONFLICT_MODE
  firstSync?: boolean
  local?: Entries
  remote?: Entries
  oldLocal?: Entries
  oldRemote?: Entries
}): Promise<Actions> {
  const syncPath = new SyncPath({
    id: 7,
    name: 'Media',
    localPath: '/local/media',
    remotePath: 'PERSONAL/media',
    permissions: 'add:modify:delete',
    mode,
    ignoreDelete,
    diffMode,
    conflictMode,
    filters: [],
    firstSync
  })
  const parser = {
    req: { server: { id: 1, identity: () => ({ id: 1, name: 'server' }) } },
    curSnap: {
      local: new NormalizedMap<string, SyncFileStats>(local),
      remote: new NormalizedMap<string, SyncFileStats>(remote)
    },
    oldSnap: {
      local: new NormalizedMap<string, SyncFileStats>(oldLocal),
      remote: new NormalizedMap<string, SyncFileStats>(oldRemote)
    }
  } as unknown as FilesParser
  const actions: Actions = {}
  const diff = new DiffParser(syncPath, parser)
  Object.assign(diff, {
    logger: {
      debug: () => undefined,
      error: (error: unknown) => {
        throw error
      }
    }
  })

  for await (const [state, values] of diff.run()) {
    actions[state] = values
  }
  return actions
}

describe('DiffParser unidirectional deletions', () => {
  it('propagates source deletions with the existing default behavior', async () => {
    await expect(diffActions({ mode: SYNC_MODE.UPLOAD, remote: [['remote.txt', stats(4)]] })).resolves.toEqual({
      [SIDE_STATE.REMOTE_RM]: ['remote.txt']
    })
    await expect(diffActions({ mode: SYNC_MODE.DOWNLOAD, local: [['local.txt', stats(4)]] })).resolves.toEqual({
      [SIDE_STATE.LOCAL_RM]: ['local.txt']
    })
  })

  it('preserves destination-only content when deletions are ignored', async () => {
    await expect(diffActions({ mode: SYNC_MODE.UPLOAD, ignoreDelete: true, remote: [['remote.txt', stats(4)]] })).resolves.toEqual({})
    await expect(diffActions({ mode: SYNC_MODE.DOWNLOAD, ignoreDelete: true, local: [['local.txt', stats(4)]] })).resolves.toEqual({})
  })

  it('reduces a removed directory tree to one removal action', async () => {
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      remote: [
        ['folder', directory()],
        ['folder/file.txt', stats(4)]
      ]
    })

    expect(actions).toEqual({ [SIDE_STATE.REMOTE_RM]: ['folder'] })
  })

  it('drops a redundant parent properties update after removing a child', async () => {
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [['folder', directory(20)]],
      remote: [
        ['folder', directory(10)],
        ['folder/deleted.txt', stats(4)]
      ]
    })

    expect(actions[SIDE_STATE.REMOTE_RM]).toEqual(['folder/deleted.txt'])
    expect(actions[SIDE_STATE.REMOTE_PROPS] ?? []).toEqual([])
  })
})

describe('DiffParser execution', () => {
  it('propagates a sorting error after logging it', async () => {
    const failure = new Error('sorting failed')
    const errors: string[] = []
    const messages: string[] = []
    const diff = Object.create(DiffParser.prototype) as DiffParser
    Object.assign(diff, {
      sort: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            throw failure
          }
        })
      }),
      logger: {
        error: (stack: string) => errors.push(stack),
        debug: (message: string) => messages.push(message)
      }
    })

    const actions = []
    await expect(
      (async () => {
        for await (const action of diff.run()) {
          actions.push(action)
        }
      })()
    ).rejects.toBe(failure)

    expect(actions).toEqual([])
    expect(errors).toEqual([failure.stack])
    expect(messages).toEqual([])
  })

  it('retains an action that has no dedicated reduction rule', async () => {
    const copy = { src: 'source.txt', dst: 'copy.txt', mtime: 20 }
    const diff = Object.create(DiffParser.prototype) as DiffParser
    Object.assign(diff, {
      syncPath: { id: 7, firstSync: false },
      fParser: { req: { server: { id: 1 } } },
      differential: async function* () {
        yield [SIDE_STATE.REMOTE_COPY, copy]
      },
      logger: {
        debug: () => undefined,
        error: (error: unknown) => {
          throw error
        }
      }
    })

    const actions: Actions = {}
    for await (const [state, values] of diff.run()) {
      actions[state] = values
    }

    expect(actions).toEqual({ [SIDE_STATE.REMOTE_COPY]: [copy] })
  })
})

describe('DiffParser bidirectional deletions', () => {
  const previous = [['file.txt', stats(4)]] as Entries

  it('treats one-sided files as additions on the first sync', async () => {
    await expect(diffActions({ mode: SYNC_MODE.BOTH, firstSync: true, local: previous })).resolves.toEqual({
      [SIDE_STATE.UPLOAD]: ['file.txt']
    })
    await expect(diffActions({ mode: SYNC_MODE.BOTH, firstSync: true, remote: previous })).resolves.toEqual({
      [SIDE_STATE.DOWNLOAD]: ['file.txt']
    })
  })

  it('keeps the existing deletion propagation when ignoreDelete is disabled', async () => {
    await expect(diffActions({ mode: SYNC_MODE.BOTH, local: previous, oldLocal: previous, oldRemote: previous })).resolves.toEqual({
      [SIDE_STATE.LOCAL_RM]: ['file.txt']
    })
    await expect(diffActions({ mode: SYNC_MODE.BOTH, remote: previous, oldLocal: previous, oldRemote: previous })).resolves.toEqual({
      [SIDE_STATE.REMOTE_RM]: ['file.txt']
    })
  })

  it('restores a file that was never present on the missing side', async () => {
    await expect(diffActions({ mode: SYNC_MODE.BOTH, local: previous, oldLocal: previous })).resolves.toEqual({
      [SIDE_STATE.UPLOAD]: ['file.txt']
    })
    await expect(diffActions({ mode: SYNC_MODE.BOTH, remote: previous, oldRemote: previous })).resolves.toEqual({
      [SIDE_STATE.DOWNLOAD]: ['file.txt']
    })
  })

  it('preserves a modification made concurrently with a deletion', async () => {
    const changed: Entries = [['file.txt', stats(8, 20)]]

    await expect(diffActions({ mode: SYNC_MODE.BOTH, local: changed, oldLocal: previous, oldRemote: previous })).resolves.toEqual({
      [SIDE_STATE.UPLOAD]: ['file.txt']
    })
    await expect(diffActions({ mode: SYNC_MODE.BOTH, remote: changed, oldLocal: previous, oldRemote: previous })).resolves.toEqual({
      [SIDE_STATE.DOWNLOAD]: ['file.txt']
    })
  })

  it('restores a file from the side where it still exists when deletions are ignored', async () => {
    await expect(
      diffActions({ mode: SYNC_MODE.BOTH, ignoreDelete: true, local: previous, oldLocal: previous, oldRemote: previous })
    ).resolves.toEqual({ [SIDE_STATE.UPLOAD]: ['file.txt'] })
    await expect(
      diffActions({ mode: SYNC_MODE.BOTH, ignoreDelete: true, remote: previous, oldLocal: previous, oldRemote: previous })
    ).resolves.toEqual({ [SIDE_STATE.DOWNLOAD]: ['file.txt'] })
  })
})

describe('DiffParser moves', () => {
  const oldFile = stats(4, 10, 99, 'same')

  it('detects a move in the synchronization direction by default', async () => {
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [['new.txt', oldFile]],
      remote: [['old.txt', oldFile]],
      oldLocal: [['old.txt', oldFile]],
      oldRemote: [['old.txt', oldFile]]
    })

    expect(actions).toEqual({ [SIDE_STATE.REMOTE_MOVE]: [{ src: 'old.txt', dst: 'new.txt' }] })
  })

  it('keeps independent directory moves separate', async () => {
    const previous: Entries = [
      ['a', directory(10, 1)],
      ['c', directory(10, 2)]
    ]
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [
        ['b', previous[0][1]],
        ['d', previous[1][1]]
      ],
      remote: previous,
      oldLocal: previous,
      oldRemote: previous
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [
        { src: 'a', dst: 'b' },
        { src: 'c', dst: 'd' }
      ]
    })
  })

  it.each([
    { mode: SYNC_MODE.DOWNLOAD, local: [['old.txt', oldFile]] as Entries, remote: [['new.txt', oldFile]] as Entries, state: SIDE_STATE.LOCAL_MOVE },
    { mode: SYNC_MODE.BOTH, local: [['new.txt', oldFile]] as Entries, remote: [['old.txt', oldFile]] as Entries, state: SIDE_STATE.REMOTE_MOVE },
    { mode: SYNC_MODE.BOTH, local: [['old.txt', oldFile]] as Entries, remote: [['new.txt', oldFile]] as Entries, state: SIDE_STATE.LOCAL_MOVE }
  ])('detects a move in $mode toward $state', async ({ mode, local, remote, state }) => {
    const actions = await diffActions({
      mode,
      local,
      remote,
      oldLocal: [['old.txt', oldFile]],
      oldRemote: [['old.txt', oldFile]]
    })

    expect(actions).toEqual({ [state]: [{ src: 'old.txt', dst: 'new.txt' }] })
  })

  it.each([
    { mode: SYNC_MODE.UPLOAD, local: [['new.txt', oldFile]] as Entries, remote: [['old.txt', oldFile]] as Entries, state: SIDE_STATE.REMOTE_MOVE },
    { mode: SYNC_MODE.DOWNLOAD, local: [['old.txt', oldFile]] as Entries, remote: [['new.txt', oldFile]] as Entries, state: SIDE_STATE.LOCAL_MOVE }
  ])('uses the inverse snapshot when the destination moved against $mode', async ({ mode, local, remote, state }) => {
    const actions = await diffActions({
      mode,
      local,
      remote,
      oldLocal: [['new.txt', oldFile]],
      oldRemote: [['new.txt', oldFile]]
    })

    expect(actions).toEqual({ [state]: [{ src: 'old.txt', dst: 'new.txt' }] })
  })

  it('matches a moved file by checksum in secure mode when its inode changed', async () => {
    const previous = stats(4, 10, 1, 'same')
    const current = stats(4, 10, 2, 'same')
    const options = {
      mode: SYNC_MODE.UPLOAD,
      local: [['new.txt', current]] as Entries,
      remote: [['old.txt', previous]] as Entries,
      oldLocal: [['old.txt', previous]] as Entries,
      oldRemote: [['old.txt', previous]] as Entries
    }

    await expect(diffActions({ ...options, diffMode: DIFF_MODE.FAST })).resolves.toEqual({
      [SIDE_STATE.UPLOAD]: ['new.txt'],
      [SIDE_STATE.REMOTE_RM]: ['old.txt']
    })
    await expect(diffActions({ ...options, diffMode: DIFF_MODE.SECURE })).resolves.toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'old.txt', dst: 'new.txt' }]
    })
  })

  it('does not mistake a reused inode for a move when checksums differ', async () => {
    const previous = stats(4, 10, 1, 'old')
    const current = stats(4, 20, 1, 'new')
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      diffMode: DIFF_MODE.SECURE,
      local: [['new.txt', current]],
      remote: [['old.txt', previous]],
      oldLocal: [['old.txt', previous]],
      oldRemote: [['old.txt', previous]]
    })

    expect(actions).toEqual({ [SIDE_STATE.UPLOAD]: ['new.txt'], [SIDE_STATE.REMOTE_RM]: ['old.txt'] })
  })

  it.each([
    { mode: SYNC_MODE.DOWNLOAD, moveLocal: true, state: SIDE_STATE.LOCAL_MOVE },
    { mode: SYNC_MODE.BOTH, moveLocal: false, state: SIDE_STATE.REMOTE_MOVE }
  ])('matches a checksum-based move in $mode', async ({ mode, moveLocal, state }) => {
    const previous = stats(4, 10, 1, 'same')
    const current = stats(4, 10, 2, 'same')
    const actions = await diffActions({
      mode,
      diffMode: DIFF_MODE.SECURE,
      local: [[moveLocal ? 'old.txt' : 'new.txt', moveLocal ? previous : current]],
      remote: [[moveLocal ? 'new.txt' : 'old.txt', moveLocal ? current : previous]],
      oldLocal: [['old.txt', previous]],
      oldRemote: [['old.txt', previous]]
    })

    expect(actions).toEqual({ [state]: [{ src: 'old.txt', dst: 'new.txt' }] })
  })

  it('matches canonically equivalent Unicode paths in the old snapshot', async () => {
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [['new.txt', oldFile]],
      remote: [['caf\u00e9.txt', oldFile]],
      oldLocal: [['cafe\u0301.txt', oldFile]],
      oldRemote: [['caf\u00e9.txt', oldFile]]
    })

    expect(actions).toEqual({ [SIDE_STATE.REMOTE_MOVE]: [{ src: 'caf\u00e9.txt', dst: 'new.txt' }] })
  })

  it('consumes only the first matching removal when files share an inode and size', async () => {
    const previous: Entries = [
      ['first.txt', oldFile],
      ['second.txt', oldFile]
    ]
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [['new.txt', oldFile]],
      remote: previous,
      oldLocal: previous,
      oldRemote: previous
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'first.txt', dst: 'new.txt' }],
      [SIDE_STATE.REMOTE_RM]: ['second.txt']
    })
  })

  it('keeps an unmatched addition and removal when neither old snapshot identifies a move', async () => {
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [['new.txt', oldFile]],
      remote: [['old.txt', oldFile]]
    })

    expect(actions).toEqual({
      [SIDE_STATE.UPLOAD]: ['new.txt'],
      [SIDE_STATE.REMOTE_RM]: ['old.txt']
    })
  })

  it('prefers the matching moved-directory child when another removal has the same inode', async () => {
    const oldDir = directory(10, 1)
    const previous: Entries = [
      ['other.txt', oldFile],
      ['a', oldDir],
      ['a/file.txt', oldFile]
    ]
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [
        ['b', oldDir],
        ['b/file.txt', oldFile]
      ],
      remote: previous,
      oldLocal: previous,
      oldRemote: previous
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'a', dst: 'b' }],
      [SIDE_STATE.REMOTE_RM]: ['other.txt']
    })
  })

  it('turns an upload below a moved directory into a content diff when the child changed', async () => {
    const oldDir = directory(10, 1)
    const previous: Entries = [
      ['a', oldDir],
      ['a/file.txt', stats(4, 10, 2)]
    ]
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [
        ['b', oldDir],
        ['b/file.txt', stats(8, 20, 3)]
      ],
      remote: previous,
      oldLocal: previous,
      oldRemote: previous
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'a', dst: 'b' }],
      [SIDE_STATE.UPLOAD_DIFF]: ['b/file.txt']
    })
  })

  it('turns a download below a moved directory into a content diff when the child changed', async () => {
    const oldDir = directory(10, 1)
    const previous: Entries = [
      ['a', oldDir],
      ['a/file.txt', stats(4, 10, 2)]
    ]
    const actions = await diffActions({
      mode: SYNC_MODE.DOWNLOAD,
      local: previous,
      remote: [
        ['b', oldDir],
        ['b/file.txt', stats(8, 20, 3)]
      ],
      oldLocal: previous,
      oldRemote: previous
    })

    expect(actions).toEqual({
      [SIDE_STATE.LOCAL_MOVE]: [{ src: 'a', dst: 'b' }],
      [SIDE_STATE.DOWNLOAD_DIFF]: ['b/file.txt']
    })
  })

  it('keeps a new empty child as a creation after moving its parent directory', async () => {
    const oldDir = directory(10, 1)
    const previous: Entries = [
      ['a', oldDir],
      ['a/file.txt', stats(4, 10, 2)]
    ]
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [
        ['b', oldDir],
        ['b/file.txt', stats(0, 20, 3)]
      ],
      remote: previous,
      oldLocal: previous,
      oldRemote: previous
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'a', dst: 'b' }],
      [SIDE_STATE.REMOTE_MK]: [{ path: 'b/file.txt', isDir: false, mtime: 20 }]
    })
  })

  it.each([
    { diffMode: DIFF_MODE.FAST, state: SIDE_STATE.UPLOAD },
    { diffMode: DIFF_MODE.SECURE, state: SIDE_STATE.UPLOAD_DIFF }
  ])('classifies an equal-size changed child after a parent move in $diffMode mode', async ({ diffMode, state }) => {
    const oldDir = directory(10, 1)
    const previous: Entries = [
      ['a', oldDir],
      ['a/file.txt', stats(4, 10, 2, 'old')]
    ]
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      diffMode,
      local: [
        ['b', oldDir],
        ['b/file.txt', stats(4, 20, 3, 'new')]
      ],
      remote: previous,
      oldLocal: previous,
      oldRemote: previous
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'a', dst: 'b' }],
      [state]: ['b/file.txt']
    })
  })

  it('lets a parent move cover descendants of a removed nested directory', async () => {
    const oldDir = directory(10, 1)
    const previous: Entries = [
      ['a', oldDir],
      ['a/nested', directory(10, 2)],
      ['a/nested/file.txt', stats(4, 10, 3)]
    ]
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [['b', oldDir]],
      remote: previous,
      oldLocal: previous,
      oldRemote: previous
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'a', dst: 'b' }],
      [SIDE_STATE.REMOTE_RM]: ['b/nested']
    })
  })

  it('moves a renamed child before its parent directory', async () => {
    const previous: Entries = [
      ['a', directory(10, 1)],
      ['a/foo', stats(4, 10, 2)]
    ]
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [
        ['b', previous[0][1]],
        ['b/bar', previous[1][1]]
      ],
      remote: previous,
      oldLocal: previous,
      oldRemote: previous
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [
        { src: 'a/foo', dst: 'a/bar' },
        { src: 'a', dst: 'b' }
      ]
    })
  })

  it('rewrites a child move source when its parent move is already ordered first', () => {
    const childStats = stats(4, 10, 2)
    const remote = new NormalizedMap<string, SyncFileStats>([['a/child.txt', childStats]])
    const moves = [
      { src: 'a', dst: 'b' },
      { src: 'a/child.txt', dst: 'b/renamed.txt' }
    ]
    const diff = Object.create(DiffParser.prototype) as DiffParser
    Object.assign(diff, {
      isSyncBothMode: false,
      fParser: { curSnap: { remote } },
      logger: { debug: () => undefined }
    })

    const fixMoveCoherence = Reflect.get(diff, 'fixMoveCoherence') as (actions: Actions) => void
    fixMoveCoherence.call(diff, { [SIDE_STATE.LOCAL_MOVE]: [], [SIDE_STATE.REMOTE_MOVE]: moves })

    expect(moves).toEqual([
      { src: 'a', dst: 'b' },
      { src: 'b/child.txt', dst: 'b/renamed.txt' }
    ])
    expect(remote.get('b/child.txt')).toEqual(childStats)
  })

  it('removes a deleted child after moving its parent directory', async () => {
    const previous: Entries = [
      ['a', directory(10, 1)],
      ['a/deleted.txt', stats(4, 10, 2)]
    ]
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [['b', previous[0][1]]],
      remote: previous,
      oldLocal: previous,
      oldRemote: previous
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'a', dst: 'b' }],
      [SIDE_STATE.REMOTE_RM]: ['b/deleted.txt']
    })
  })

  it('rewrites an opposite-side addition below a moved directory in both mode', async () => {
    const oldDir = directory(10, 1)
    const actions = await diffActions({
      mode: SYNC_MODE.BOTH,
      local: [['b', oldDir]],
      remote: [
        ['a', oldDir],
        ['a/remote.txt', stats(4, 10, 2)]
      ],
      oldLocal: [['a', oldDir]],
      oldRemote: [['a', oldDir]]
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'a', dst: 'b' }],
      [SIDE_STATE.DOWNLOAD]: ['b/remote.txt']
    })
  })

  it('leaves an opposite-side addition outside a moved directory untouched', async () => {
    const oldDir = directory(10, 1)
    const actions = await diffActions({
      mode: SYNC_MODE.BOTH,
      local: [['b', oldDir]],
      remote: [
        ['a', oldDir],
        ['outside.txt', stats(4, 10, 2)]
      ],
      oldLocal: [['a', oldDir]],
      oldRemote: [['a', oldDir]]
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'a', dst: 'b' }],
      [SIDE_STATE.DOWNLOAD]: ['outside.txt']
    })
  })

  it('rewrites an opposite-side empty file creation below a moved directory', async () => {
    const oldDir = directory(10, 1)
    const actions = await diffActions({
      mode: SYNC_MODE.BOTH,
      local: [['b', oldDir]],
      remote: [
        ['a', oldDir],
        ['a/empty.txt', stats(0, 20, 2)]
      ],
      oldLocal: [['a', oldDir]],
      oldRemote: [['a', oldDir]]
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'a', dst: 'b' }],
      [SIDE_STATE.LOCAL_MK]: [{ path: 'b/empty.txt', isDir: false, mtime: 20 }]
    })
  })

  it('rewrites an opposite-side move destination below a moved directory', async () => {
    const oldDir = directory(10, 1)
    const oldChild = stats(4, 10, 2)
    const actions = await diffActions({
      mode: SYNC_MODE.BOTH,
      local: [
        ['b', oldDir],
        ['other/file.txt', oldChild]
      ],
      remote: [
        ['a', oldDir],
        ['a/file.txt', oldChild]
      ],
      oldLocal: [
        ['a', oldDir],
        ['other/file.txt', oldChild]
      ],
      oldRemote: [
        ['a', oldDir],
        ['other/file.txt', oldChild]
      ]
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'a', dst: 'b' }],
      [SIDE_STATE.LOCAL_MOVE]: [{ src: 'other/file.txt', dst: 'b/file.txt' }]
    })
  })

  it('copies the new path and preserves the old destination path when deletions are ignored', async () => {
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      ignoreDelete: true,
      local: [['new.txt', oldFile]],
      remote: [['old.txt', oldFile]],
      oldLocal: [['old.txt', oldFile]],
      oldRemote: [['old.txt', oldFile]]
    })

    expect(actions).toEqual({ [SIDE_STATE.UPLOAD]: ['new.txt'] })
  })

  it('restores the old path and copies the new path in bidirectional mode', async () => {
    const actions = await diffActions({
      mode: SYNC_MODE.BOTH,
      ignoreDelete: true,
      local: [['new.txt', oldFile]],
      remote: [['old.txt', oldFile]],
      oldLocal: [['old.txt', oldFile]],
      oldRemote: [['old.txt', oldFile]]
    })

    expect(actions).toEqual({ [SIDE_STATE.UPLOAD]: ['new.txt'], [SIDE_STATE.DOWNLOAD]: ['old.txt'] })
  })
})

describe('DiffParser changes and conflicts', () => {
  it('uses checksums only in secure diff mode', async () => {
    const local: Entries = [['file.txt', stats(4, 10, 1, 'local')]]
    const remote: Entries = [['file.txt', stats(4, 10, 2, 'remote')]]

    await expect(diffActions({ mode: SYNC_MODE.UPLOAD, local, remote })).resolves.toEqual({})
    await expect(diffActions({ mode: SYNC_MODE.UPLOAD, diffMode: DIFF_MODE.SECURE, local, remote })).resolves.toEqual({
      [SIDE_STATE.UPLOAD_DIFF]: ['file.txt']
    })
  })

  it('updates properties when only the modification time differs', async () => {
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      local: [['file.txt', stats(4, 20)]],
      remote: [['file.txt', stats(4, 10)]]
    })

    expect(actions).toEqual({ [SIDE_STATE.REMOTE_PROPS]: [{ path: 'file.txt', mtime: 20 }] })
  })

  it('updates local properties when only the remote modification time differs', async () => {
    const actions = await diffActions({
      mode: SYNC_MODE.DOWNLOAD,
      local: [['file.txt', stats(4, 10)]],
      remote: [['file.txt', stats(4, 20)]]
    })

    expect(actions).toEqual({ [SIDE_STATE.LOCAL_PROPS]: [{ path: 'file.txt', mtime: 20 }] })
  })

  it.each([
    { localMtime: 20, remoteMtime: 10, state: SIDE_STATE.REMOTE_PROPS },
    { localMtime: 10, remoteMtime: 20, state: SIDE_STATE.LOCAL_PROPS }
  ])('updates properties in both mode toward $state', async ({ localMtime, remoteMtime, state }) => {
    const actions = await diffActions({
      mode: SYNC_MODE.BOTH,
      local: [['file.txt', stats(4, localMtime)]],
      remote: [['file.txt', stats(4, remoteMtime)]]
    })

    expect(actions).toEqual({ [state]: [{ path: 'file.txt', mtime: 20 }] })
  })

  it.each([
    { conflictMode: CONFLICT_MODE.LOCAL, localMtime: 10, remoteMtime: 20, state: SIDE_STATE.UPLOAD_DIFF },
    { conflictMode: CONFLICT_MODE.REMOTE, localMtime: 20, remoteMtime: 10, state: SIDE_STATE.DOWNLOAD_DIFF },
    { conflictMode: CONFLICT_MODE.RECENT, localMtime: 20, remoteMtime: 10, state: SIDE_STATE.UPLOAD_DIFF },
    { conflictMode: CONFLICT_MODE.RECENT, localMtime: 10, remoteMtime: 20, state: SIDE_STATE.DOWNLOAD_DIFF }
  ])('resolves content conflicts with $conflictMode toward $state', async ({ conflictMode, localMtime, remoteMtime, state }) => {
    const actions = await diffActions({
      mode: SYNC_MODE.BOTH,
      conflictMode,
      local: [['file.txt', stats(4, localMtime)]],
      remote: [['file.txt', stats(8, remoteMtime)]]
    })

    expect(actions).toEqual({ [state]: ['file.txt'] })
  })

  it.each([
    { localSize: 8, remoteSize: 4, state: SIDE_STATE.UPLOAD_DIFF },
    { localSize: 4, remoteSize: 8, state: SIDE_STATE.DOWNLOAD_DIFF }
  ])('breaks an equal-mtime conflict by size toward $state', async ({ localSize, remoteSize, state }) => {
    const actions = await diffActions({
      mode: SYNC_MODE.BOTH,
      local: [['file.txt', stats(localSize)]],
      remote: [['file.txt', stats(remoteSize)]]
    })

    expect(actions).toEqual({ [state]: ['file.txt'] })
  })

  it('reuses a destination file with the same checksum in secure mode', async () => {
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      ignoreDelete: true,
      diffMode: DIFF_MODE.SECURE,
      local: [['copy.txt', stats(4, 20, 1, 'same')]],
      remote: [['existing.txt', stats(4, 10, 2, 'same')]]
    })

    expect(actions).toEqual({ [SIDE_STATE.REMOTE_COPY]: [{ src: 'existing.txt', dst: 'copy.txt', mtime: 20 }] })
  })

  it('copies from a file that is unchanged on both sides', async () => {
    const existing = stats(4, 10, 1, 'same')
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      diffMode: DIFF_MODE.SECURE,
      local: [
        ['existing.txt', existing],
        ['copy.txt', stats(4, 20, 2, 'same')]
      ],
      remote: [['existing.txt', existing]]
    })

    expect(actions).toEqual({ [SIDE_STATE.REMOTE_COPY]: [{ src: 'existing.txt', dst: 'copy.txt', mtime: 20 }] })
  })

  it('does not copy from a file scheduled to be removed', async () => {
    const existing = stats(4, 10, 1, 'same')
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      diffMode: DIFF_MODE.SECURE,
      local: [['copy.txt', stats(4, 20, 2, 'same')]],
      remote: [['existing.txt', existing]]
    })

    expect(actions).toEqual({ [SIDE_STATE.UPLOAD]: ['copy.txt'], [SIDE_STATE.REMOTE_RM]: ['existing.txt'] })
  })

  it('does not copy from a file scheduled to move', async () => {
    const previous = stats(4, 10, 1, 'same')
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      diffMode: DIFF_MODE.SECURE,
      local: [
        ['moved.txt', previous],
        ['copy.txt', stats(4, 20, 2, 'same')]
      ],
      remote: [['old.txt', previous]],
      oldLocal: [['old.txt', previous]],
      oldRemote: [['old.txt', previous]]
    })

    expect(actions).toEqual({
      [SIDE_STATE.REMOTE_MOVE]: [{ src: 'old.txt', dst: 'moved.txt' }],
      [SIDE_STATE.UPLOAD]: ['copy.txt']
    })
  })

  it('does not copy from a file scheduled to be overwritten', async () => {
    const previous = stats(4, 10, 1, 'old')
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      diffMode: DIFF_MODE.SECURE,
      local: [
        ['existing.txt', stats(4, 20, 1, 'new')],
        ['copy.txt', stats(4, 20, 2, 'old')]
      ],
      remote: [['existing.txt', previous]],
      oldLocal: [['existing.txt', previous]],
      oldRemote: [['existing.txt', previous]]
    })

    expect(actions).toEqual({ [SIDE_STATE.UPLOAD]: ['copy.txt'], [SIDE_STATE.UPLOAD_DIFF]: ['existing.txt'] })
  })

  it('creates a new empty file instead of copying another empty file in secure mode', async () => {
    const emptyFile = stats(0, 20, 1, 'empty')
    const existingFile = stats(0, 10, 2, 'empty')

    await expect(
      diffActions({
        mode: SYNC_MODE.UPLOAD,
        ignoreDelete: true,
        diffMode: DIFF_MODE.SECURE,
        local: [['empty.txt', emptyFile]],
        remote: [['existing.txt', existingFile]]
      })
    ).resolves.toEqual({ [SIDE_STATE.REMOTE_MK]: [{ path: 'empty.txt', isDir: false, mtime: 20 }] })
    await expect(
      diffActions({
        mode: SYNC_MODE.DOWNLOAD,
        ignoreDelete: true,
        diffMode: DIFF_MODE.SECURE,
        local: [['existing.txt', existingFile]],
        remote: [['empty.txt', emptyFile]]
      })
    ).resolves.toEqual({ [SIDE_STATE.LOCAL_MK]: [{ path: 'empty.txt', isDir: false, mtime: 20 }] })
  })
})

describe('DiffParser file and directory conflicts', () => {
  it.each([false, true])('lets the upload direction replace a remote file with a local directory (ignoreDelete=%s)', async (ignoreDelete) => {
    const actions = await diffActions({
      mode: SYNC_MODE.UPLOAD,
      ignoreDelete,
      local: [['entry', directory(20)]],
      remote: [['entry', stats(0, 10)]]
    })

    expect(actions).toEqual({ [SIDE_STATE.REMOTE_MK]: [{ path: 'entry', isDir: true, mtime: 20 }] })
  })

  it.each([false, true])('lets the download direction replace a local file with a remote directory (ignoreDelete=%s)', async (ignoreDelete) => {
    const actions = await diffActions({
      mode: SYNC_MODE.DOWNLOAD,
      ignoreDelete,
      local: [['entry', stats(0, 10)]],
      remote: [['entry', directory(20)]]
    })

    expect(actions).toEqual({ [SIDE_STATE.LOCAL_MK]: [{ path: 'entry', isDir: true, mtime: 20 }] })
  })

  it('uses the configured conflict winner for a bidirectional type replacement', async () => {
    const localWins = await diffActions({
      mode: SYNC_MODE.BOTH,
      ignoreDelete: true,
      conflictMode: CONFLICT_MODE.LOCAL,
      local: [['entry', directory(20)]],
      remote: [['entry', stats(0, 10)]]
    })
    const remoteWins = await diffActions({
      mode: SYNC_MODE.BOTH,
      ignoreDelete: true,
      conflictMode: CONFLICT_MODE.REMOTE,
      local: [['entry', directory(20)]],
      remote: [['entry', stats(0, 10)]]
    })

    expect(localWins).toEqual({ [SIDE_STATE.REMOTE_MK]: [{ path: 'entry', isDir: true, mtime: 20 }] })
    expect(remoteWins).toEqual({ [SIDE_STATE.LOCAL_MK]: [{ path: 'entry', isDir: false, mtime: 10 }] })
  })
})
