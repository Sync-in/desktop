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
