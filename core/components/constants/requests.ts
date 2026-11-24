const API_BASE = '/api/app/sync'
export const CSRF_COOKIE_NAME = 'sync-in-csrf'
export const CLIENT_MISSING_ERROR = 'Client must be registered'
export const SYNC_UPLOAD_SESSION_MIN_CHUNK_SIZE = 1_000_000
export const SYNC_UPLOAD_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const SYNC_UPLOAD_SESSION_HEADER = {
  CHECKSUM: 'upload-checksum',
  INO: 'upload-ino',
  LENGTH: 'upload-length',
  MTIME: 'upload-mtime',
  OFFSET: 'upload-offset',
  STATE: 'upload-state',
  VALIDATED_OFFSET: 'upload-validated-offset'
} as const

export const API = {
  HANDSHAKE: `${API_BASE}/handshake`,
  REGISTER: `${API_BASE}/register`,
  REGISTER_AUTH: `${API_BASE}/register/auth`,
  UNREGISTER: `${API_BASE}/unregister`,
  AUTH_COOKIE: `${API_BASE}/auth/cookie`,
  AUTH_TOKEN: `${API_BASE}/auth/token`,
  AUTH_TOKEN_REFRESH: '/api/auth/token/refresh',
  PATHS: `${API_BASE}/paths`,
  DIFF: `${API_BASE}/operation/diff`,
  OPERATION: `${API_BASE}/operation`,
  UPLOAD_SESSION: `${API_BASE}/upload-session`,
  APP_STORE: `${API_BASE}/app-store`,
  MAKE: 'make'
}
