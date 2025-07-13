/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { WebContents, WebContentsView } from 'electron'

export interface AppWebContentsView extends WebContentsView {
  webContents: WebContents & {
    serverId?: number
    serverName?: string
  }
}
