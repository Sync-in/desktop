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

  for await (const [state, values] of new DiffParser(syncPath, parser).run()) {
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
})

describe('DiffParser bidirectional deletions', () => {
  const previous = [['file.txt', stats(4)]] as Entries

  it('keeps the existing deletion propagation when ignoreDelete is disabled', async () => {
    await expect(diffActions({ mode: SYNC_MODE.BOTH, local: previous, oldLocal: previous, oldRemote: previous })).resolves.toEqual({
      [SIDE_STATE.LOCAL_RM]: ['file.txt']
    })
    await expect(diffActions({ mode: SYNC_MODE.BOTH, remote: previous, oldLocal: previous, oldRemote: previous })).resolves.toEqual({
      [SIDE_STATE.REMOTE_RM]: ['file.txt']
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
