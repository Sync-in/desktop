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
    STATUS: 'core-sync-status',
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

export interface RendererEventAllowlist {
  SEND: ReadonlySet<string>
  INVOKE: ReadonlySet<string>
  ON: ReadonlySet<string>
  REMOVE_ALL_LISTENERS: ReadonlySet<string>
}

export const WRAPPER_RENDERER_EVENTS: RendererEventAllowlist = {
  SEND: new Set([
    LOCAL_RENDERER.UI.TOP_VIEW_FOCUS,
    LOCAL_RENDERER.UI.APP_MENU_OPEN,
    LOCAL_RENDERER.UI.MODAL_TOGGLE,
    LOCAL_RENDERER.WINDOW.MAXIMIZE,
    LOCAL_RENDERER.WINDOW.MINIMIZE,
    LOCAL_RENDERER.WINDOW.UNMAXIMIZE,
    LOCAL_RENDERER.WINDOW.CLOSE,
    LOCAL_RENDERER.UPDATE.RESTART,
    LOCAL_RENDERER.SERVER.LIST,
    LOCAL_RENDERER.SERVER.SET_ACTIVE,
    LOCAL_RENDERER.SERVER.RELOAD,
    REMOTE_RENDERER.MISC.NETWORK_IS_ONLINE
  ]),
  INVOKE: new Set([LOCAL_RENDERER.DOWNLOAD.LIST, LOCAL_RENDERER.DOWNLOAD.ACTION, LOCAL_RENDERER.SERVER.ACTION, LOCAL_RENDERER.SERVER.RETRY]),
  ON: new Set([
    LOCAL_RENDERER.UI.MODAL_TOGGLE,
    LOCAL_RENDERER.WINDOW.IS_MAXIMIZED,
    LOCAL_RENDERER.WINDOW.IS_FULLSCREEN,
    LOCAL_RENDERER.UPDATE.DOWNLOADED,
    LOCAL_RENDERER.DOWNLOAD.GLOBAL_PROGRESS,
    LOCAL_RENDERER.DOWNLOAD.PROGRESS,
    LOCAL_RENDERER.SERVER.LIST,
    LOCAL_RENDERER.SERVER.SET_ACTIVE,
    REMOTE_RENDERER.APPLICATIONS.COUNTER,
    REMOTE_RENDERER.MISC.SWITCH_THEME,
    REMOTE_RENDERER.SYNC.TRANSFER
  ]),
  REMOVE_ALL_LISTENERS: new Set()
}

export const WEBVIEW_RENDERER_EVENTS: RendererEventAllowlist = {
  SEND: new Set([
    REMOTE_RENDERER.APPLICATIONS.COUNTER,
    REMOTE_RENDERER.APPLICATIONS.MSG,
    REMOTE_RENDERER.MISC.FILE_OPEN,
    REMOTE_RENDERER.MISC.SWITCH_THEME,
    REMOTE_RENDERER.MISC.URL_OPEN,
    REMOTE_RENDERER.SERVER.AUTHENTICATION_FAILED,
    REMOTE_RENDERER.SERVER.AUTHENTICATION_TOKEN_EXPIRED,
    REMOTE_RENDERER.SERVER.AUTHENTICATION_TOKEN_UPDATE,
    REMOTE_RENDERER.SERVER.SET_ACTIVE_AND_SHOW,
    REMOTE_RENDERER.SYNC.SCHEDULER_STATE
  ]),
  INVOKE: new Set([
    REMOTE_RENDERER.MISC.DIALOG_OPEN,
    REMOTE_RENDERER.OIDC.START_LOOPBACK,
    REMOTE_RENDERER.OIDC.WAIT_CALLBACK,
    REMOTE_RENDERER.SERVER.AUTHENTICATION,
    REMOTE_RENDERER.SERVER.REGISTRATION,
    REMOTE_RENDERER.SYNC.ERRORS,
    REMOTE_RENDERER.SYNC.PATH_OPERATION,
    REMOTE_RENDERER.SYNC.TRANSFER_LOGS
  ]),
  ON: new Set([
    REMOTE_RENDERER.MISC.SWITCH_THEME,
    REMOTE_RENDERER.SYNC.REPORT_TRANSFER,
    REMOTE_RENDERER.SYNC.SCHEDULER_STATE,
    REMOTE_RENDERER.SYNC.STATUS,
    REMOTE_RENDERER.SYNC.TASKS_COUNT
  ]),
  REMOVE_ALL_LISTENERS: new Set([REMOTE_RENDERER.SYNC.REPORT_TRANSFER])
}
