/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

export enum DOWNLOAD_ACTION {
  OPEN = 'open',
  PAUSE = 'pause',
  CANCEL = 'cancel',
  RESUME = 'resume',
  REMOVE = 'remove'
}

export enum DOWNLOAD_STATE {
  PROGRESSING = 'progressing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  INTERRUPTED = 'interrupted',
  PAUSED = 'paused'
}
