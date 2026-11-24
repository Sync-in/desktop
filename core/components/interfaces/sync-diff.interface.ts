import { F_SPECIAL_STAT } from '../constants/handlers'
import type { SIDE_STATE } from '../constants/diff'
import { NormalizedMap } from '../utils/normalizedMap'

export type SyncFileStats = [boolean, number, number, number, string | null, number?]

export type SyncFileSpecialStats = [F_SPECIAL_STAT, string | boolean]

export type SyncSnapShot = NormalizedMap<string, SyncFileStats>

export type SyncDiffBatch = [state: SIDE_STATE, filePaths: any[], taskCount: number]

export class SyncDiff {
  secureDiff: boolean
  firstSync: boolean
  defaultFilters: string[]
  pathFilters: string | null
  snapshot?: Record<string, SyncFileStats>
}
