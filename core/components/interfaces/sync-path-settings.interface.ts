/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { CONFLICT_MODE, DIFF_MODE, SYNC_MODE } from '../constants/diff'

export interface SyncPathSettings {
  name: string
  localPath: string
  remotePath: string
  permissions: string
  mode: SYNC_MODE
  enabled: boolean
  diffMode: DIFF_MODE
  conflictMode: CONFLICT_MODE
  filters: string[]
  scheduler: { value: number; unit: string }
  timestamp: number
  lastSync: Date
}
