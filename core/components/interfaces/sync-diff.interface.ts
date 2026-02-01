import { F_SPECIAL_STAT } from '../constants/handlers'
import { NormalizedMap } from '../utils/normalizedMap'

export type SyncFileStats = [boolean, number, number, number, string | null, number?]

export type SyncFileSpecialStats = [F_SPECIAL_STAT, string | boolean]

export type SyncSnapShot = NormalizedMap<string, SyncFileStats>

export class SyncDiff {
  secureDiff: boolean
  firstSync: boolean
  defaultFilters: string[]
  pathFilters: string
  snapshot?: Record<string, SyncFileStats>
}
