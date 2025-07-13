/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

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
