/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { SIDE } from './handlers'

export enum SYNC_MODE {
  DOWNLOAD = 'download',
  UPLOAD = 'upload',
  BOTH = 'both'
}

export enum CONFLICT_MODE {
  RECENT = 'recent',
  LOCAL = 'local',
  REMOTE = 'remote'
}

export enum DIFF_MODE {
  FAST = 'fast',
  SECURE = 'secure'
}

export enum SIDE_STATE {
  UPLOAD = 'upload',
  UPLOAD_DIFF = 'uploadDiff',
  DOWNLOAD = 'download',
  DOWNLOAD_DIFF = 'downloadDiff',
  LOCAL_MOVE = 'localMove',
  REMOTE_MOVE = 'remoteMove',
  LOCAL_MK = 'localMk',
  REMOTE_MK = 'remoteMk',
  LOCAL_COPY = 'localCopy',
  REMOTE_COPY = 'remoteCopy',
  LOCAL_RM = 'localRemove',
  REMOTE_RM = 'remoteRemove',
  LOCAL_PROPS = 'localProperties',
  REMOTE_PROPS = 'remoteProperties'
}

export const DOWNLOAD_MODE = {
  added: SIDE_STATE.LOCAL_RM,
  changed: SIDE_STATE.DOWNLOAD_DIFF,
  removed: SIDE_STATE.DOWNLOAD,
  properties: SIDE_STATE.LOCAL_PROPS
} as const

export const UPLOAD_MODE = {
  added: SIDE_STATE.UPLOAD,
  changed: SIDE_STATE.UPLOAD_DIFF,
  removed: SIDE_STATE.REMOTE_RM,
  properties: SIDE_STATE.REMOTE_PROPS
} as const

export const BOTH_MODE = {
  localAdded: SIDE_STATE.UPLOAD,
  remoteAdded: SIDE_STATE.DOWNLOAD,
  localChanged: SIDE_STATE.UPLOAD_DIFF,
  remoteChanged: SIDE_STATE.DOWNLOAD_DIFF,
  localRemoved: SIDE_STATE.REMOTE_RM,
  remoteRemoved: SIDE_STATE.LOCAL_RM,
  localProperties: SIDE_STATE.REMOTE_PROPS,
  remoteProperties: SIDE_STATE.LOCAL_PROPS
} as const

export const ALL_MODES: Record<SIDE.LOCAL | SIDE.REMOTE, SIDE_STATE[]> = {
  [SIDE.LOCAL]: [...Object.values(DOWNLOAD_MODE), SIDE_STATE.LOCAL_MOVE, SIDE_STATE.LOCAL_MK, SIDE_STATE.LOCAL_COPY],
  [SIDE.REMOTE]: [...Object.values(UPLOAD_MODE), SIDE_STATE.REMOTE_MOVE, SIDE_STATE.REMOTE_MK, SIDE_STATE.REMOTE_COPY]
}
