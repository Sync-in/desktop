import type { DOWNLOAD_STATE } from '../constants/downloads'

export interface IDownload {
  id: string
  name: string
  state: DOWNLOAD_STATE
  progress: number
  humanSpeed: { value: number; unit: string }
  humanSize: { done: number; total: number; unit: string }
  timeLeft: number
  icon?: any
}
