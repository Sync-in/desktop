export interface SyncServer {
  id: number
  name: string
  url: string
  available: boolean
  authTokenExpired: boolean
}

export interface SyncServerEvent {
  ok: boolean
  msg?: string
}
