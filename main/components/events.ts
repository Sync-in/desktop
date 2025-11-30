/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { app, ipcMain, nativeTheme, powerMonitor, powerSaveBlocker, shell } from 'electron'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../constants/events'
import { ServersManager } from '../../core/components/handlers/servers'
import { ViewsManager } from './views'
import { Server } from '../../core/components/models/server'
import { PathsManager } from '../../core/components/handlers/paths'
import { RunManager } from '../../core/main'
import EventEmitter from 'events'
import { CORE, coreEvents } from '../../core/components/handlers/events'
import { Scheduler } from '../../core/components/handlers/scheduler'
import { SyncPath } from '../../core/components/models/syncpath'
import { TransfersLogs } from './transfers'
import { Logger } from 'winston'
import { getLogger } from '../../core/components/handlers/loggers'
import { genClientInfos } from '../../core/components/utils/functions'
import { THEMES } from '../constants/windows'
import { SyncClientAuth } from '../../core/components/interfaces/sync-client-auth.interface'
import { SyncTransfer } from '@sync-in-desktop/core/components/interfaces/sync-transfer.interface'
import { IpcMainEventServer, IpcMainInvokeEventServer } from '../interfaces/ipc-main-event.interface'
import { THEME } from '../constants/themes'
import { SERVER_ACTION, SERVER_SCHEDULER_STATE } from '../../core/components/constants/server'
import { PATH_ACTION } from '../constants/paths'
import { SyncStatus } from '@sync-in-desktop/core/components/interfaces/sync-status.interface'
import { appSettings } from './settings'
import { IS_MACOS } from '@sync-in-desktop/core/constants'

export const appEvents: any = new EventEmitter()
// hook to delete to trash bin during sync
appEvents.trashItem = shell.trashItem

export class EventsManager {
  viewsManager: ViewsManager
  runManager: RunManager
  scheduler: Scheduler
  logger: Logger
  appPreventSuspension = null

  constructor(viewsManager: ViewsManager) {
    this.viewsManager = viewsManager
    this.runManager = new RunManager(appEvents)
    this.scheduler = new Scheduler(appEvents)
    this.logger = getLogger('Events')
    this.initIPC()
  }

  async checkNativeTheme() {
    await this.switchTheme(nativeTheme.shouldUseDarkColors ? THEME.DARK : THEME.LIGHT)
  }

  private initIPC() {
    powerMonitor.on('suspend', () => this.managePowerSuspension(true))
    powerMonitor.on('resume', () => this.managePowerSuspension(false))
    nativeTheme.on('updated', async () => this.checkNativeTheme())
    ipcMain.handle(REMOTE_RENDERER.SERVER.AUTHENTICATION, (ev) => this.serverAuthentication(ev))
    ipcMain.on(REMOTE_RENDERER.SERVER.AUTHENTICATION_FAILED, (ev) => this.serverAuthFailed(ev))
    ipcMain.on(REMOTE_RENDERER.SERVER.AUTHENTICATION_TOKEN_UPDATE, (ev, token: string) => this.serverAuthTokenUpdate(ev, token))
    ipcMain.on(REMOTE_RENDERER.SERVER.AUTHENTICATION_TOKEN_EXPIRED, (ev) => this.serverAuthTokenExpired(ev))
    ipcMain.handle(LOCAL_RENDERER.SERVER.RETRY, (_ev, id: number) => this.serverOnRetry(id))
    ipcMain.on(LOCAL_RENDERER.SERVER.RELOAD, (_ev, id: number) => this.serverReload(id))
    ipcMain.handle(
      LOCAL_RENDERER.SERVER.ACTION,
      (
        _ev,
        action: SERVER_ACTION,
        server: Server,
        auth: {
          login: string
          password: string
        }
      ) => this.serverOnAction(action, server, auth)
    )
    ipcMain.on(LOCAL_RENDERER.SERVER.SET_ACTIVE, (_ev, id: number) => this.serverOnActiveView(id))
    appEvents.on(LOCAL_RENDERER.SERVER.SET_ACTIVE, (id: number) => this.serverOnActiveView(id, true))
    ipcMain.on(LOCAL_RENDERER.SERVER.LIST, () => this.viewsManager.sendServersUpdate())
    ipcMain.handle(REMOTE_RENDERER.SYNC.PATH_OPERATION, async (ev: IpcMainEventServer, action: PATH_ACTION, params) =>
      this.syncPathAction(ev, action, params)
    )
    ipcMain.on(REMOTE_RENDERER.MISC.NETWORK_IS_ONLINE, async (_ev, state: boolean) => await this.networkIsOnline(state))
    ipcMain.on(REMOTE_RENDERER.MISC.SWITCH_THEME, async (_ev, theme: string) => await this.switchTheme(theme))
    ipcMain.on(
      REMOTE_RENDERER.SYNC.SCHEDULER_STATE,
      (ev: IpcMainEventServer, action: string, state: SERVER_SCHEDULER_STATE = SERVER_SCHEDULER_STATE.SEQ) =>
        this.syncSchedulerOnAction(ev, action, state)
    )
    ipcMain.handle(REMOTE_RENDERER.SYNC.ERRORS, (ev: IpcMainEventServer) => this.listSyncsWithErrors(ev))
    coreEvents.on(CORE.SYNC_STATUS, (params: SyncStatus) => this.viewsManager.sendToWebRenderer(params.serverId, CORE.SYNC_STATUS, params))
    appEvents.on(REMOTE_RENDERER.SYNC.TASKS_COUNT, (params) =>
      this.viewsManager.sendToWebRenderer(params.serverId, REMOTE_RENDERER.SYNC.TASKS_COUNT, params)
    )
    appEvents.on(REMOTE_RENDERER.SYNC.TRANSFER, (tr: SyncTransfer) => this.viewsManager.sendToWrapperRenderer(REMOTE_RENDERER.SYNC.TRANSFER, tr))
    appEvents.on(REMOTE_RENDERER.SYNC.REPORT_TRANSFER, (tr: SyncTransfer) =>
      this.viewsManager.sendToWebRenderer(tr.serverId, REMOTE_RENDERER.SYNC.REPORT_TRANSFER, tr)
    )
    ipcMain.handle(REMOTE_RENDERER.SYNC.TRANSFER_LOGS, async (ev: IpcMainInvokeEventServer, action: string, syncPathId: number, query: string) =>
      this.onSyncTransferLogs(ev, action, syncPathId, query)
    )
    appEvents.on(LOCAL_RENDERER.WINDOW.ZOOM.IN, () => this.windowZoomIn())
    appEvents.on(LOCAL_RENDERER.WINDOW.ZOOM.OUT, () => this.windowZoomOut())
    appEvents.on(LOCAL_RENDERER.WINDOW.ZOOM.RESET, () => this.windowZoomReset())
    appEvents.on(LOCAL_RENDERER.UPDATE.DOWNLOADED, (msg: string) => this.viewsManager.sendToWrapperRenderer(LOCAL_RENDERER.UPDATE.DOWNLOADED, msg))
    appEvents.on(LOCAL_RENDERER.POWER.PREVENT_APP_SUSPENSION, (state: boolean) => this.manageAppPreventSuspension(state))
    appEvents.on(LOCAL_RENDERER.SETTINGS.HIDE_DOCK_ICON, () => this.hideDockIcon())
    appEvents.on(LOCAL_RENDERER.SETTINGS.LAUNCH_AT_STARTUP, () => this.launchAtStartup())
    appEvents.on(LOCAL_RENDERER.SETTINGS.START_HIDDEN, () => this.startHidden())
  }

  private async networkIsOnline(state: boolean) {
    if (state) {
      for (const server of ServersManager.list.filter((s: Server) => !s.available)) {
        await this.serverOnRetry(server.id)
      }
    }
    appEvents.emit(REMOTE_RENDERER.MISC.NETWORK_IS_ONLINE, state)
    await this.checkNativeTheme()
  }

  private async switchTheme(theme: string) {
    this.viewsManager.mainWindow.setBackgroundColor(THEMES[theme])
    this.viewsManager.sendToWrapperRenderer(REMOTE_RENDERER.MISC.SWITCH_THEME, theme)
    for (const serverId of ServersManager.list.map((s: Server) => s.id)) {
      this.viewsManager.sendToWebRenderer(serverId, REMOTE_RENDERER.MISC.SWITCH_THEME, theme)
    }
  }

  private serverAuthentication(ev: any): SyncClientAuth {
    const server = ServersManager.find(ev.sender.serverId)
    return { clientId: server.authID, token: server.authToken, info: genClientInfos() }
  }

  private serverAuthTokenUpdate(ev: any, token: string) {
    const server = ServersManager.find(ev.sender.serverId)
    server.authToken = token
    this.logger.info(`Client token was renewed for server *${server.name}* (${server.id})`)
    coreEvents.emit(CORE.SAVE_SETTINGS)
  }

  private serverAuthTokenExpired(ev: any) {
    const server = ServersManager.find(ev.sender.serverId)
    server.available = true
    if (server.authTokenExpired) {
      return
    }
    server.authTokenExpired = true
    this.viewsManager.switchViewFocus(true)
    this.viewsManager.sendServersUpdate()
  }

  private serverAuthFailed(ev: any) {
    const server = ServersManager.find(ev.sender.serverId)
    server.available = false
    this.viewsManager.switchViewFocus(true)
    this.viewsManager.sendServersUpdate()
  }

  private serverReload(id: number) {
    this.viewsManager.reloadView(id, true)
  }

  private async serverOnRetry(id: number): Promise<boolean> {
    const webView = this.viewsManager.allViews[id]
    const server = ServersManager.find(id)
    try {
      await webView.webContents.loadURL(server.url, this.viewsManager.viewOptions)
      return true
    } catch {
      return false
    }
  }

  private async serverOnAction(
    action: SERVER_ACTION,
    server: Server,
    auth: { login: string; password: string; code?: string }
  ): Promise<{
    ok: boolean
    msg?: string
  }> {
    switch (action) {
      case SERVER_ACTION.ADD:
        server = new Server(server)
        try {
          const manager = new ServersManager(server, false)
          const [ok, msg] = await manager.add(auth.login, auth.password, auth.code)
          if (!ok) {
            return { ok: false, msg: msg }
          }
          const webView = await this.viewsManager.createWebView(server)
          this.viewsManager.allViews[server.id] = webView
          // fix for windows & linux, webview is not painting if view is not resized
          webView.webContents.once('did-finish-load', () => this.viewsManager.resizeViews())
          coreEvents.emit(CORE.SAVE_SETTINGS)
          return { ok: true }
        } catch (e) {
          return { ok: false, msg: e }
        }
      case SERVER_ACTION.EDIT:
        try {
          const manager = new ServersManager(ServersManager.find(server.id))
          await manager.checkUpdatedProperties(server)
          coreEvents.emit(CORE.SAVE_SETTINGS)
          this.viewsManager.sendServersUpdate()
          return { ok: true }
        } catch (e) {
          return { ok: false, msg: e }
        }
      case SERVER_ACTION.AUTHENTICATE:
        try {
          const manager = new ServersManager(ServersManager.find(server.id), false)
          await manager.register(auth.login, auth.password, auth.code)
          this.viewsManager.sendServersUpdate()
          coreEvents.emit(CORE.SAVE_SETTINGS, true)
          this.viewsManager.reloadView(server.id)
          return { ok: true }
        } catch (e) {
          return { ok: false, msg: e }
        }
      case SERVER_ACTION.REMOVE:
        try {
          const status = await ServersManager.unregister(server)
          if (!status.ok) {
            return status
          }
          this.viewsManager.mainWindow.contentView.removeChildView(this.viewsManager.allViews[server.id])
          delete this.viewsManager.allViews[server.id]
          if (this.viewsManager.currentServer.id === server.id) {
            const firstLoadedServer = ServersManager.list.find((srv) => srv.id !== 0 && srv.available)
            if (firstLoadedServer) {
              this.serverOnActiveView(firstLoadedServer.id)
            } else if (ServersManager.list.length) {
              this.serverOnActiveView(ServersManager.list[0].id)
            } else {
              this.viewsManager.currentServer = new Server({ name: 'No server configured', url: null, available: true })
              this.viewsManager.currentView = this.viewsManager.wrapperView
            }
          }
          this.viewsManager.sendServersUpdate()
          return { ok: true }
        } catch (e) {
          return { ok: false, msg: e }
        }
      default:
        return { ok: false, msg: 'Unknown server action' }
    }
  }

  private serverOnActiveView(id: number, show = false) {
    const server = ServersManager.find(id)
    const webView = this.viewsManager.allViews[id]
    this.viewsManager.enableView(server, webView, !server.available, show)
  }

  private async syncPathAction(ev: IpcMainEventServer, action: PATH_ACTION, params: any) {
    if (action === PATH_ACTION.LIST) {
      return ServersManager.find(ev.sender.serverId).syncPaths
    }
    if (action === PATH_ACTION.SYNC) {
      if (params.state) {
        coreEvents.emit(CORE.SYNC_START, { server: ev.sender.serverId, paths: params.paths }, params.reportOnly, params.async)
      } else {
        coreEvents.emit(CORE.SYNC_STOP, { server: ev.sender.serverId, paths: params.paths }, params.reportOnly)
      }
      return
    }
    const manager = new PathsManager(ev.sender.serverId)
    if (action === PATH_ACTION.ADD) {
      try {
        return await manager.add(params)
      } catch (e) {
        return e
      }
    } else if (action === PATH_ACTION.FLUSH) {
      return await manager.flush(params)
    } else if (action === PATH_ACTION.SET) {
      return await manager.set(params)
    } else if (action === PATH_ACTION.REMOVE) {
      return await manager.remove(params)
    }
  }

  private async syncSchedulerOnAction(ev: IpcMainEventServer, action: string, state: SERVER_SCHEDULER_STATE = SERVER_SCHEDULER_STATE.SEQ) {
    const server = ServersManager.find(ev.sender.serverId)
    if (action === 'update') {
      const reloadConf = [state, server.syncScheduler].indexOf(SERVER_SCHEDULER_STATE.DISABLED) > -1
      server.syncScheduler = state
      coreEvents.emit(CORE.SAVE_SETTINGS, reloadConf)
    }
    this.viewsManager.sendToWebRenderer(server.id, REMOTE_RENDERER.SYNC.SCHEDULER_STATE, server.syncScheduler)
  }

  private listSyncsWithErrors(ev: IpcMainEventServer): SyncStatus[] {
    return ServersManager.find(ev.sender.serverId)
      .syncPaths.filter((s: SyncPath) => s.lastErrors.length || s.mainError)
      .map((s: SyncPath) => ({ syncPathId: s.id, lastErrors: s.lastErrors, mainError: s.mainError }))
  }

  private async onSyncTransferLogs(ev: IpcMainInvokeEventServer, action: string, syncPathId: number, query: string): Promise<SyncTransfer[] | void> {
    const transfersLogs: TransfersLogs = new TransfersLogs(ev.sender.serverId, syncPathId, query)
    if (action === 'get') {
      return await transfersLogs.get()
    } else if (action === 'delete') {
      return await transfersLogs.delete()
    }
  }

  private manageAppPreventSuspension(state: boolean) {
    if (state !== !!this.appPreventSuspension) {
      if (state) {
        // the returned id can have the value 0. To avoid problem with previous check, add + 1
        this.appPreventSuspension = powerSaveBlocker.start('prevent-app-suspension') + 1
      } else {
        powerSaveBlocker.stop(this.appPreventSuspension - 1)
        this.appPreventSuspension = null
      }
    }
  }

  private managePowerSuspension(state: boolean) {
    if (state) {
      this.logger.info('power is off')
      for (const server of ServersManager.list) {
        coreEvents.emit(CORE.SYNC_STOP, { server: server.id, paths: [] }, false)
      }
    } else {
      this.logger.info('power is on')
    }
    appEvents.emit(LOCAL_RENDERER.POWER.SUSPENSION_EVENT, state)
  }

  private windowZoomIn() {
    if (!this.viewsManager.currentView) return
    const zFactor = this.viewsManager.currentView.webContents.getZoomFactor()
    this.viewsManager.currentView.webContents.setZoomFactor(zFactor + 0.1)
  }

  private windowZoomOut() {
    if (!this.viewsManager.currentView) return
    const zFactor = this.viewsManager.currentView.webContents.getZoomFactor()
    this.viewsManager.currentView.webContents.setZoomFactor(zFactor - 0.1)
  }

  private windowZoomReset() {
    if (!this.viewsManager.currentView) return
    this.viewsManager.currentView.webContents.setZoomFactor(1)
  }

  private hideDockIcon() {
    if (!IS_MACOS) return
    appSettings.configuration.hideDockIcon = !appSettings.configuration.hideDockIcon
    appSettings.writeSettings()
    if (appSettings.configuration.hideDockIcon) {
      app.dock.hide()
    } else {
      app.dock.show().catch(console.error)
    }
  }

  private launchAtStartup() {
    appSettings.configuration.launchAtStartup = !appSettings.configuration.launchAtStartup
    appSettings.writeSettings()
    app.setLoginItemSettings({ openAtLogin: appSettings.configuration.launchAtStartup })
  }

  private startHidden() {
    appSettings.configuration.startHidden = !appSettings.configuration.startHidden
    appSettings.writeSettings()
  }
}
