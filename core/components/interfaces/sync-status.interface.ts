/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import type { SyncTransfer } from './sync-transfer.interface'

export interface SyncStatus {
  serverId?: number
  syncPathId: number
  state?: boolean
  reportOnly?: boolean
  mainError?: string
  lastErrors?: SyncTransfer[]
}
