import type { SyncClientAuthCookie } from '../../core/components/interfaces/sync-client-auth.interface'

export type OIDCCallbackParams = Record<string, string>

export interface ServerAuthenticationErrorResponse {
  error: string
}

export type ServerAuthenticationCookieResponse = SyncClientAuthCookie | ServerAuthenticationErrorResponse
