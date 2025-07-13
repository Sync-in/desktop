/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

// LOCAL RENDERER
export const LOCAL_RENDERER = {
  DEVTOOLS: {
    SHOW_WRAPPER: 'devtools-show-wrapper',
    SHOW_SERVER: 'devtools-show-server'
  },
  UI: {
    TOP_VIEW_FOCUS: 'top-view-focus',
    APP_MENU_OPEN: 'app-menu-open',
    MODAL_TOGGLE: 'modal-toggle',
    NAV_BACK: 'nav-back',
    NAV_FORWARD: 'nav-forward'
  },
  WINDOW: {
    SHOW: 'window-show',
    MAXIMIZE: 'window-maximize',
    MINIMIZE: 'window-minimize',
    UNMAXIMIZE: 'window-unmaximize',
    IS_MAXIMIZED: 'window-is-maximized',
    IS_FULLSCREEN: 'window-is-fullscreen',
    CLOSE: 'window-close'
  },
  UPDATE: {
    DOWNLOADED: 'update-available',
    RESTART: 'update-restart',
    CHECK: 'update-check'
  },
  DOWNLOAD: {
    GLOBAL_PROGRESS: 'download-global-progress',
    PROGRESS: 'download-progress',
    ACTION: 'download-action',
    LIST: 'downloads-list'
  },
  POWER: {
    PREVENT_APP_SUSPENSION: 'power-prevent-app-suspension',
    SUSPENSION_EVENT: 'power-suspension-event'
  },
  SERVER: {
    LIST: 'servers-list',
    SET_ACTIVE: 'server-set-active',
    ACTION: 'server-action',
    RETRY: 'server-retry',
    RELOAD: 'server-reload'
  },
  SYNC: {
    MSG: 'sync-msg'
  }
}
// REMOTE RENDERER
export const REMOTE_RENDERER = {
  // authentication
  SERVER: {
    AUTHENTICATION: 'server-authentication',
    AUTHENTICATION_FAILED: 'server-authentication-failed',
    AUTHENTICATION_TOKEN_UPDATE: 'server-authentication-token-update',
    AUTHENTICATION_TOKEN_EXPIRED: 'server-authentication-token-expired'
  },
  // sync
  SYNC: {
    PATH_OPERATION: 'sync-path-operation',
    TASKS_COUNT: 'sync-tasks-count',
    ERRORS: 'sync-errors',
    TRANSFER: 'sync-transfer',
    REPORT_TRANSFER: 'sync-report-transfer',
    TRANSFER_LOGS: 'sync-transfer-logs',
    SCHEDULER_STATE: 'sync-scheduler-state'
  },
  // tasks & notifications & chats
  APPLICATIONS: {
    MSG: 'applications-msg',
    COUNTER: 'applications-counter'
  },
  MISC: {
    DIALOG_OPEN: 'dialog-open',
    FILE_OPEN: 'file-open',
    SWITCH_THEME: 'switch-theme',
    NETWORK_IS_ONLINE: 'network-is-online'
  }
}
