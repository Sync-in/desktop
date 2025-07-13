/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import EventEmitter from 'events'

// constants
export const CORE = {
  TASKS_COUNT: 'core-tasks-count',
  SYNC_STATUS: 'core-sync-status',
  SYNC_START: 'core-sync-start',
  SYNC_STOP: 'core-sync-stop',
  SAVE_SETTINGS: 'core-save-settings',
  EXIT: 'core-exit'
}

export const coreEvents = new EventEmitter()
