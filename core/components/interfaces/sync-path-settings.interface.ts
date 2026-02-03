import { CONFLICT_MODE, DIFF_MODE, SYNC_MODE } from '../constants/diff'

export interface SyncPathSettings {
  name: string
  localPath: string
  remotePath: string
  permissions: string
  mode: SYNC_MODE
  enabled: boolean
  diffMode: DIFF_MODE
  conflictMode: CONFLICT_MODE
  filters: string[]
  scheduler: { value: number; unit: string }
  timestamp: number
  lastSync: Date
}
