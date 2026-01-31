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
  SETTINGS: {
    LAUNCH_AT_STARTUP: 'launch-at-startup',
    START_HIDDEN: 'start-hidden',
    HIDE_DOCK_ICON: 'hide-dock-icon'
  },
  WINDOW: {
    SHOW: 'window-show',
    MAXIMIZE: 'window-maximize',
    MINIMIZE: 'window-minimize',
    UNMAXIMIZE: 'window-unmaximize',
    IS_MAXIMIZED: 'window-is-maximized',
    IS_FULLSCREEN: 'window-is-fullscreen',
    CLOSE: 'window-close',
    ZOOM: { IN: 'window-zoom-in', OUT: 'window-zoom-out', RESET: 'window-zoom-reset' }
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
  // server
  SERVER: {
    REGISTRATION: 'server-registration',
    AUTHENTICATION: 'server-authentication',
    AUTHENTICATION_FAILED: 'server-authentication-failed',
    AUTHENTICATION_TOKEN_UPDATE: 'server-authentication-token-update',
    AUTHENTICATION_TOKEN_EXPIRED: 'server-authentication-token-expired',
    SET_ACTIVE_AND_SHOW: 'server-set-active-and-show'
  },
  OIDC: {
    START_LOOPBACK: 'oidc-start-loopback',
    WAIT_CALLBACK: 'oidc-wait-callback'
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
    URL_OPEN: 'url-open',
    FILE_OPEN: 'file-open',
    SWITCH_THEME: 'switch-theme',
    NETWORK_IS_ONLINE: 'network-is-online'
  }
}
