import { describe, expect, it } from 'vitest'
import { CONFLICT_MODE, DIFF_MODE, SYNC_MODE } from '../constants/diff'
import { SyncPath } from './syncpath'

function createSyncPath(overrides: Record<string, unknown> = {}) {
  return new SyncPath({
    name: 'Media',
    localPath: '/local/media',
    remotePath: 'PERSONAL/media',
    permissions: 'add:modify:delete',
    mode: SYNC_MODE.UPLOAD,
    diffMode: DIFF_MODE.FAST,
    conflictMode: CONFLICT_MODE.RECENT,
    filters: [],
    enabled: true,
    ...overrides
  })
}

describe('SyncPath ignoreDelete setting', () => {
  it('defaults to false when the setting is absent', () => {
    expect(createSyncPath().ignoreDelete).toBe(false)
  })

  it('is enabled only by the boolean value true', () => {
    expect(createSyncPath({ ignoreDelete: true }).ignoreDelete).toBe(true)
    expect(createSyncPath({ ignoreDelete: 'true' }).ignoreDelete).toBe(false)
    expect(createSyncPath({ ignoreDelete: 1 }).ignoreDelete).toBe(false)
  })

  it('is exposed in representations and persisted settings', () => {
    const syncPath = createSyncPath({ ignoreDelete: true })

    expect(syncPath.repr()).toMatchObject({ ignoreDelete: true })
    expect(syncPath.settings()).toMatchObject({ ignoreDelete: true })
    expect(syncPath.settingsList()).toContain('ignoreDelete')
  })
})
