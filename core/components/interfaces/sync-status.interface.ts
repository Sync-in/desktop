import type { SyncTransfer } from './sync-transfer.interface'

export interface SyncStatus {
  serverId?: number
  syncPathId: number
  state?: boolean
  reportOnly?: boolean
  mainError?: string
  lastErrors?: SyncTransfer[]
}
