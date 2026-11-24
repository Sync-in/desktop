import type { SyncClientInfo } from './sync-client-info.interface'

export class SyncClientAuth {
  clientId: string
  token: string
  tokenHasExpired: boolean
  info: SyncClientInfo
}

export interface SyncClientAuthCookie {
  server: any
  user: any
  token: {
    access_expiration: number
    refresh_expiration: number
    [key: string]: any
  }
  client_token_update?: string
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

export interface SyncTransfersCapability {
  maxChunkSize: number | null
}

export interface SyncClientTokenResponse {
  access: string
  refresh: string
  refresh_expiration: number
  capabilities?: {
    transfers?: SyncTransfersCapability
  }
  client_token_update?: string
}
