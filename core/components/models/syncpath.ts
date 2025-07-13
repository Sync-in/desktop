/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { checkReservedUrlChars, currentTimeStamp, fileBaseName, isPathExists } from '../utils/functions'
import { SIDE, SYMBOLS } from '../constants/handlers'
import path from 'node:path'
import { SNAPSHOTS_PATH, SYNC_LOGS_PATH } from '../../constants'
import fs from 'node:fs/promises'
import { SyncPathSettings } from '../interfaces/sync-path-settings.interface'
import { SYNC_PATH_PERMISSION } from '../constants/permissions'
import type { SyncTransfer } from '../interfaces/sync-transfer.interface'
import { CONFLICT_MODE, DIFF_MODE, SYNC_MODE } from '../constants/diff'

export const snapshotSides = ['l', 'r', 'i']

export class SyncPath {
  id = 0
  name: string
  localPath: string
  remotePath: string
  mode: SYNC_MODE
  enabled: boolean
  firstSync = true
  lastSync: Date = null
  lastErrors: SyncTransfer[] = []
  mainError: string = null
  timestamp = 0
  permissions: string
  scheduler: { unit: 'minute' | 'hour' | 'day' | 'disabled'; value: 15 } = null
  diffMode: DIFF_MODE
  conflictMode: CONFLICT_MODE // only needed with mode 'both'
  filters: string[]

  constructor(data: any, add = false) {
    this.id = data.id || this.id
    this.name = data.name || this.name
    this.localPath = data.localPath
    this.remotePath = data.remotePath
    this.mode = data.mode
    this.enabled = data.enabled == null ? true : data.enabled
    this.lastSync = data.lastSync || this.lastSync
    this.lastErrors = data.lastErrors || this.lastErrors
    this.mainError = data.mainError || this.mainError
    this.timestamp = data.timestamp || this.timestamp
    this.firstSync = data.firstSync == null ? true : data.firstSync
    this.permissions = data.permissions || ''
    this.diffMode = data.diffMode || 'fast'
    this.conflictMode = data.conflictMode || CONFLICT_MODE.RECENT
    this.filters = data.filters || []
    this.setScheduler(data.scheduler || undefined)
    if (add) {
      if (!this.timestamp) {
        this.updateTimestamp()
      }
      if (!this.name) {
        this.name = fileBaseName(this.localPath)
      }
    }
  }

  repr() {
    return {
      id: this.id,
      name: this.name,
      localPath: this.localPath,
      remotePath: this.remotePath,
      permissions: this.permissions,
      mode: this.mode,
      diffMode: this.diffMode,
      conflictMode: this.conflictMode,
      lastSync: this.lastSync,
      lastErrors: this.lastErrors,
      mainError: this.mainError
    }
  }

  identity() {
    return { id: this.id, name: this.name }
  }

  async checks() {
    // flush errors
    this.lastErrors = []
    this.mainError = null
    // check properties
    await isPathExists(this.localPath)
    if (!this.isWriteable) {
      this.mode = SYNC_MODE.DOWNLOAD
    }
  }

  get isDownloadMode(): boolean {
    return this.mode === 'download'
  }

  get isUploadMode(): boolean {
    return this.mode === 'upload'
  }

  get isBothMode(): boolean {
    return this.mode === SYNC_MODE.BOTH
  }

  get secureDiff(): boolean {
    return this.diffMode === DIFF_MODE.SECURE
  }

  get isWriteable(): boolean {
    if (this.permissions) {
      return (
        this.permissions.includes(SYNC_PATH_PERMISSION.MODIFY) &&
        this.permissions.includes(SYNC_PATH_PERMISSION.DELETE) &&
        this.permissions.includes(SYNC_PATH_PERMISSION.ADD)
      )
    }
    return false
  }

  get symbol(): string {
    if (this.isBothMode) {
      return SYMBOLS[SIDE.BOTH]
    } else if (this.isDownloadMode) {
      return SYMBOLS[SIDE.LOCAL]
    }
    return SYMBOLS[SIDE.REMOTE]
  }

  getSnapshotPath(side: string, serverId: number): string {
    return path.join(SNAPSHOTS_PATH, `${side}_${serverId}_${this.id}.json`)
  }

  localRealPathFrom(filePath: string): string {
    return path.join(this.localPath, filePath)
  }

  apiFromPath(api: string, filePath: string): string {
    return checkReservedUrlChars(path.posix.join(api, this.remotePath, filePath))
  }

  async removeSnapShots(serverId: number) {
    for (const snapshotPath of snapshotSides.map((side) => this.getSnapshotPath(side, serverId))) {
      await fs.rm(snapshotPath, { force: true })
    }
  }

  getLogsPath(serverId: number): string {
    return path.join(SYNC_LOGS_PATH, `${serverId}_${this.id}.log`)
  }

  async removeLogs(serverId: number) {
    await fs.rm(this.getLogsPath(serverId), { force: true })
  }

  private setScheduler(scheduler: any) {
    if (scheduler) {
      this.scheduler = { value: scheduler.value, unit: scheduler.unit }
    }
  }

  updateTimestamp() {
    this.timestamp = currentTimeStamp()
  }

  updateLastSync() {
    this.lastSync = new Date()
  }

  settingsList() {
    return ['mode', 'diffMode', 'conflictMode', 'filters', 'enabled', 'scheduler', 'timestamp', 'localPath', 'remotePath', 'permissions']
  }

  update(data: any) {
    for (const [k, v] of Object.entries(data)) {
      this[k] = v
    }
  }

  settings(): SyncPathSettings {
    return {
      name: this.name,
      localPath: this.localPath,
      remotePath: this.remotePath,
      permissions: this.permissions,
      mode: this.mode,
      diffMode: this.diffMode,
      conflictMode: this.conflictMode,
      filters: this.filters,
      scheduler: this.scheduler,
      timestamp: this.timestamp,
      enabled: this.enabled,
      lastSync: this.lastSync
    }
  }
}
