/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { RequestsManager } from '../handlers/requests'
import { Sync } from '../handlers/sync'
import { FilesParser } from '../handlers/parser'
import { Report } from '../handlers/report'

export class SyncInstance {
  syncPathId: number
  req: RequestsManager
  instance: Sync | FilesParser | Report
  reportOnly = false

  constructor(syncPathId: number, req: RequestsManager, reportOnly = false) {
    this.syncPathId = syncPathId
    this.req = req
    this.reportOnly = reportOnly
  }
}
