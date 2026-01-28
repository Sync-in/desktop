/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { partitionFor, RENDERER_FILE, TAB_BAR_HEIGHT, viewProps, WRAPPER_VIEW_OFFSET_HEIGHT } from '../constants/windows'
import {
  BrowserWindow,
  dialog,
  Event,
  ipcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  Menu,
  screen,
  session,
  shell,
  WebContentsView,
  WebContentsWillNavigateEventParams
} from 'electron'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../constants/events'
import { ServersManager } from '../../core/components/handlers/servers'
import { Server } from '../../core/components/models/server'
import { CORE, coreEvents } from '../../core/components/handlers/events'
import { appEvents } from './events'
import { AppWebContentsView } from '../interfaces/app-web-contents-view'

export class ViewsManager {
  mainWindow: BrowserWindow
  wrapperView: WebContentsView
  currentView: AppWebContentsView
  currentServer: Server = new Server({ name: 'No server configured', url: null, available: true })
  viewOptions: { extraHeaders: 'pragma: no-cache\n' }
  allViews: Record<string | number, AppWebContentsView> = {}
  showAtStartup = false
  isModalOpen = false
  isBooting = true
  countViewsOnBoot = 0

  constructor(mainWindow: BrowserWindow, showAtStartup: boolean) {
    this.showAtStartup = showAtStartup
    this.mainWindow = mainWindow
    this.initIPC()
    this.initWrapperView()
    this.initWebViews().catch(console.error)
  }

  resizeViews() {
    const content = this.mainWindow.getContentBounds()
    const display = screen.getDisplayMatching(this.mainWindow.getBounds())
    const scale = display?.scaleFactor || 1
    const width = Math.floor(content.width * scale) / scale
    const height = Math.floor(content.height * scale) / scale
    this.wrapperView.setBounds({ x: 0, y: 0, width, height })
    const top = TAB_BAR_HEIGHT
    const innerH = Math.max(0, height - WRAPPER_VIEW_OFFSET_HEIGHT)

    for (const webView of Object.values(this.allViews)) {
      webView.setBounds({ x: 0, y: top, width, height: innerH })
    }
  }

  sendToWrapperRenderer(channel: string, ...args: any[]) {
    this.wrapperView.webContents.send(channel, ...args)
  }

  sendToWebRenderer(id: number, channel: string, ...args: any[]) {
    const webView = this.allViews[id]
    if (webView) {
      webView.webContents.send(channel, ...args)
    } else {
      console.error(`unable to find webView with id: ${id}`)
    }
  }

  async createWebView(server: Server): Promise<AppWebContentsView> {
    const webView = new WebContentsView(viewProps(server.id)) as AppWebContentsView
    webView.webContents.serverName = server.name
    webView.webContents.serverId = server.id
    webView.webContents.on('will-navigate', (event: Event<WebContentsWillNavigateEventParams>) => {
      if (!event.url.startsWith(server.url)) {
        event.preventDefault()
        shell.openExternal(event.url).catch(console.error)
      }
    })
    this.mainWindow.contentView.addChildView(webView)
    this.addLoadURLListener(webView, server)
    webView.webContents
      .loadURL(server.url, this.viewOptions)
      .then(() => webView.webContents.setZoomFactor(1))
      .catch(console.error)
    return webView
  }

  checkView(server: Server, webView: AppWebContentsView, success = true) {
    if (this.isBooting) {
      server.available = success
      this.countViewsOnBoot += 1
      if (this.countViewsOnBoot === ServersManager.list.length) {
        this.isBooting = false
        this.enableView(server, webView, !success, this.showAtStartup)
        coreEvents.emit(CORE.SAVE_SETTINGS, true)
      }
    } else if (server.available !== success) {
      server.available = success
      this.enableView(server, webView, !success)
      coreEvents.emit(CORE.SAVE_SETTINGS, true)
    }
  }

  enableView(server: Server, webView: AppWebContentsView, toTopView = false, show = false) {
    this.currentView = webView
    this.currentServer = server
    this.switchViewFocus(toTopView)
    if (show) {
      // first show called when the app starts
      this.mainWindow.show()
    }
    this.resizeViews()
    this.sendServersUpdate()
  }

  switchViewFocus(toTopView: boolean) {
    if (toTopView) {
      this.mainWindow.contentView.addChildView(this.wrapperView)
      this.wrapperView.webContents.focus()
    } else {
      // Avoid losing focus on TopView if modal is open or the active server has no content
      if (this.isModalOpen || !this.currentServer.available) {
        return
      }
      this.mainWindow.contentView.addChildView(this.currentView)
      // this.mainWindow.setContentView(this.activeView)
      this.currentView.webContents.focus()
    }
  }

  reloadView(serverId?: number, clear = false) {
    const view = serverId ? this.allViews[serverId] : this.currentView
    if (clear) {
      session.defaultSession.clearCache().then(() => view.webContents.reloadIgnoringCache())
    } else {
      view.webContents.reload()
    }
  }

  async destroyView(server: Server) {
    const view = this.allViews[server.id]
    if (!view) return
    this.mainWindow.contentView.removeChildView(view)
    view.webContents.close()
    delete this.allViews[server.id]
    const s = session.fromPartition(partitionFor(server.id))
    await s.clearStorageData({ storages: ['cookies', 'localstorage', 'cachestorage', 'filesystem'] })
    await s.clearCache()
  }

  sendServersUpdate() {
    this.sendToWrapperRenderer(LOCAL_RENDERER.SERVER.LIST, ServersManager.list)
    this.sendToWrapperRenderer(LOCAL_RENDERER.SERVER.SET_ACTIVE, this.currentServer)
  }

  private initIPC() {
    ipcMain.on(LOCAL_RENDERER.UI.MODAL_TOGGLE, (_ev: IpcMainEvent, topToView: boolean) => this.onModalToggle(topToView))
    ipcMain.on(LOCAL_RENDERER.UI.TOP_VIEW_FOCUS, (_ev: IpcMainEvent, topToView: boolean) => this.switchViewFocus(topToView))
    ipcMain.handle(
      REMOTE_RENDERER.MISC.DIALOG_OPEN,
      async (_ev: IpcMainInvokeEvent, properties) => await dialog.showOpenDialog(this.mainWindow, properties)
    )
    ipcMain.on(REMOTE_RENDERER.MISC.FILE_OPEN, async (_ev: IpcMainEvent, fullPath: string) => shell.showItemInFolder(fullPath))
    ipcMain.on(REMOTE_RENDERER.MISC.URL_OPEN, async (_ev: IpcMainEvent, url: string) => shell.openExternal(url))
    ipcMain.on(LOCAL_RENDERER.UI.APP_MENU_OPEN, () => this.openAppMenu())
    appEvents.on(LOCAL_RENDERER.SERVER.RELOAD, (clear: boolean) => this.reloadView(null, clear))
    appEvents.on(LOCAL_RENDERER.UI.MODAL_TOGGLE, () => this.openModalToggle())
    appEvents.on(LOCAL_RENDERER.DEVTOOLS.SHOW_WRAPPER, () => this.openDevToolsWrapper())
    appEvents.on(LOCAL_RENDERER.DEVTOOLS.SHOW_SERVER, () => this.openDevToolsServer())
    appEvents.on(LOCAL_RENDERER.UI.NAV_FORWARD, () => this.navigationForward())
    appEvents.on(LOCAL_RENDERER.UI.NAV_BACK, () => this.navigationBack())
  }

  private initWrapperView() {
    this.mainWindow.on('resize', () => {
      if (this.mainWindow) {
        this.resizeViews()
      }
    })
    this.wrapperView = new WebContentsView(viewProps('wrapper'))
    this.mainWindow.contentView.addChildView(this.wrapperView)
    this.wrapperView.webContents.loadFile(RENDERER_FILE).then(() => {
      this.wrapperView.webContents.setZoomFactor(1)
      this.wrapperView.webContents.setVisualZoomLevelLimits(1, 1).catch(console.error)
      this.resizeViews()
    })
  }

  private async initWebViews(): Promise<void> {
    if (ServersManager.list.length) {
      for (const server of ServersManager.list) {
        this.createWebView(server)
          .then((view: AppWebContentsView) => {
            this.allViews[server.id] = view
          })
          .catch(console.error)
      }
    } else {
      // hook to avoid errors with ipc renderer events
      this.currentView = this.wrapperView
      // start wizard to log in
      this.mainWindow.once('ready-to-show', () => this.sendToWrapperRenderer(LOCAL_RENDERER.UI.MODAL_TOGGLE))
      this.mainWindow.show()
      this.resizeViews()
    }
  }

  private onModalToggle(toTopView: boolean) {
    this.isModalOpen = toTopView
    this.switchViewFocus(toTopView)
  }

  private openModalToggle() {
    this.mainWindow.show()
    this.onModalToggle(true)
    this.sendToWrapperRenderer(LOCAL_RENDERER.UI.MODAL_TOGGLE)
  }

  private openAppMenu() {
    const windowMenu = Menu.getApplicationMenu()
    if (windowMenu) {
      windowMenu.popup({ window: this.mainWindow, x: 18, y: 18 })
    } else {
      console.error('No application menu found')
    }
  }

  private openDevToolsWrapper() {
    this.wrapperView.webContents.openDevTools({ mode: 'detach' })
  }

  private openDevToolsServer() {
    this.currentView.webContents.openDevTools({ mode: 'detach' })
  }

  private navigationBack() {
    this.currentView.webContents.navigationHistory.goBack()
  }

  private navigationForward() {
    this.currentView.webContents.navigationHistory.goForward()
  }

  private addLoadURLListener(webView: AppWebContentsView, server: Server) {
    // catch HTTP error code (no error is thrown during loadURL
    if (!webView.webContents.listeners('did-navigate').length) {
      webView.webContents.on('did-navigate', (_e: Event, url, httpCode) => {
        if (httpCode == 200) {
          this.checkView(server, webView, true)
        } else {
          console.warn(`${server.name} (${url}) returns HTTP code ${httpCode}`)
          this.checkView(server, webView, false)
        }
      })
      if (!webView.webContents.listeners('did-fail-load').length) {
        webView.webContents.on('did-fail-load', () => {
          this.checkView(server, webView, false)
        })
      }
    }
  }
}
