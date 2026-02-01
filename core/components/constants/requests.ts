const API_BASE = '/api/app/sync'
export const API = {
  HANDSHAKE: `${API_BASE}/handshake`,
  REGISTER: `${API_BASE}/register`,
  UNREGISTER: `${API_BASE}/unregister`,
  AUTH_TOKEN: `${API_BASE}/auth/token`,
  AUTH_TOKEN_REFRESH: '/api/auth/token/refresh',
  PATHS: `${API_BASE}/paths`,
  DIFF: `${API_BASE}/operation/diff`,
  OPERATION: `${API_BASE}/operation`,
  APP_STORE: `${API_BASE}/app-store`,
  MAKE: 'make'
}

export interface TOKEN_RESPONSE {
  access: string
  refresh: string
  refresh_expiration: number
  client_token_update?: string
}
