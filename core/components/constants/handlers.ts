/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { IS_WINDOWS } from '../../constants'

export enum SIDE {
  LOCAL = 'local',
  REMOTE = 'remote',
  BOTH = 'both'
}

export const INVERSE_SIDE = { [SIDE.LOCAL]: SIDE.REMOTE, [SIDE.REMOTE]: SIDE.LOCAL }

// symbols
export const SYMBOLS = IS_WINDOWS
  ? { [SIDE.LOCAL]: '↓', [SIDE.REMOTE]: '↑', [SIDE.BOTH]: '↓↑' }
  : { [SIDE.LOCAL]: '⬇', [SIDE.REMOTE]: '⬆', [SIDE.BOTH]: '⬇⬆' }

// data index of the value array of a file
export enum F_STAT {
  IS_DIR = 0,
  SIZE = 1,
  MTIME = 2,
  INO = 3,
  CHECKSUM = 4,
  INCOMPLETE_SIZE = 5
}

export enum F_SPECIAL_STAT {
  FILTERED = 'filtered',
  ERROR = 'error'
}

// actions on files
export enum F_ACTION {
  NEW = 'NEW',
  DIFF = 'DIFF',
  RM = 'RM',
  RMDIR = 'RMDIR',
  MOVE = 'MOVE',
  COPY = 'COPY',
  MKDIR = 'MKDIR',
  MKFILE = 'MKFILE',
  PROPS = 'PROPS',
  FILTERED = 'FILTERED'
}

export const SYNC_CHECKSUM_ALG = 'sha512-256'
export const DEFAULT_HIGH_WATER_MARK = 512 * 1024
// min size to track progress and put the task in slow queue
export const TRANSFER_MIN_SIZE = 10 * 1024 ** 2 // 10MB
// parsers filters
export const SYNC_DIFF_DONE = 'done'
export const INCOMPLETE_PREFIX = '.sync-in.'
export const INCOMPLETE_REGEXP = new RegExp(`^${INCOMPLETE_PREFIX}`)
export const INCOMPLETE_RETENTION = 172800 // 48 hours in seconds
export const DEFAULT_FILTERS = new Set([
  '.DS_Store',
  '.swp',
  '.AppleDouble',
  '.AppleDesktop',
  'Thumbs.db',
  '.Spotlight-V100',
  '.DocumentRevisions-V100',
  '.fseventsd',
  '.MobileBackups',
  'Icon?',
  '__MACOSX',
  '.thumbnails',
  '.DAV',
  '.desktop',
  'desktop.ini',
  '.TemporaryItems',
  '.localized',
  '__pycache__'
])
