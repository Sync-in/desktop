import { F_ACTION, SIDE } from '../constants/handlers'

export interface SyncTransfer {
  ok?: boolean
  name?: string
  side: SIDE.LOCAL | SIDE.REMOTE
  action: F_ACTION
  file: string
  isDir: boolean
  fileDst?: string
  mime?: string
  error?: string
  serverId?: number
  syncPathId?: number
  progress?: { currentSize: string; totalSize: string; percent: string }
}

export interface SyncTransferContext {
  server: { id: number; name: string }
  path: { id: number; name: string }
}
