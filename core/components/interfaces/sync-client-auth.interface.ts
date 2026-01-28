/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import type { SyncClientInfo } from './sync-client-info.interface'

export class SyncClientAuth {
  clientId: string
  token: string
  tokenHasExpired: boolean
  info: SyncClientInfo
}

export interface SyncClientRegistration {
  login: string
  password: string
  code?: string
}

export interface SyncClientAuthRegistration {
  clientId: string
  clientToken: string
}
