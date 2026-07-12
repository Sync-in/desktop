import { partitionFor, RENDERER_FILE, TAB_BAR_HEIGHT, viewProps, WRAPPER_VIEW_OFFSET_HEIGHT } from '../constants/windows'
import {
  BrowserWindow,
  dialog,
  Event,
  ipcMain,
  IpcMainEvent,
  Menu,
  screen,
  session,
  WebContentsView,
  WebContentsWillNavigateEventParams,
  WebContentsWillRedirectEventParams
} from 'electron'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../constants/events'
import { ServersManager } from '../../core/components/handlers/servers'
import { Server } from '../../core/components/models/server'
import { CORE, coreEvents } from '../../core/components/handlers/events'
import { appEvents } from './events'
import { AppWebContentsView } from '../interfaces/app-web-contents-view'
import { IpcMainEventServer, IpcMainInvokeEventServer, VerifiedSenderOptions } from '../interfaces/ipc-main-event.interface'
import { openExternal, showItemInFolder } from './utils'

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

  getServerFromVerifiedSender(ev: IpcMainEventServer | IpcMainInvokeEventServer): Server
  getServerFromVerifiedSender(ev: IpcMainEventServer | IpcMainInvokeEventServer, options: { throwOnError: false }): Server | null
  getServerFromVerifiedSender(ev: IpcMainEventServer | IpcMainInvokeEventServer, options: VerifiedSenderOptions = {}): Server | null {
    const throwOnError = options.throwOnError !== false
    const serverId = ev.sender.serverId
    const webView = this.allViews[serverId]
    // serverId is app metadata; also match Electron's WebContents id to authenticate the sender.
    if (!webView || webView.webContents.id !== ev.sender.id) {
      if (throwOnError) {
        throw new Error('Unauthorized server WebContents')
      }
      return null
    }
    try {
      return ServersManager.find(serverId)
    } catch (e) {
      if (throwOnError) {
        throw e
      }
      return null
    }
  }

  async createWebView(server: Server): Promise<AppWebContentsView> {
    const webView = new WebContentsView(viewProps(server.id)) as AppWebContentsView
    await this.configureServerCertificateVerification(server)
    webView.webContents.serverName = server.name
    webView.webContents.serverId = server.id
    webView.webContents.on('will-navigate', (ev: Event<WebContentsWillNavigateEventParams>) => {
      if (!this.isUrlWithinServerScope(ev.url, server)) {
        ev.preventDefault()
        openExternal(ev.url).catch(console.error)
      }
    })
    webView.webContents.on('will-redirect', (ev: Event<WebContentsWillRedirectEventParams>) => {
      // OIDC can redirect to an external identity provider before returning to the server.
      // Keep server-scoped redirects in the view and open external redirects outside the app.
      if (!this.isUrlWithinServerScope(ev.url, server)) {
        ev.preventDefault()
        openExternal(ev.url).catch(console.error)
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
      view.webContents.session.clearCache().then(() => view.webContents.reloadIgnoringCache())
    } else {
      view.webContents.reload()
    }
  }

  async configureServerCertificateVerification(server: Server): Promise<void> {
    const serverSession = session.fromPartition(partitionFor(server.id))
    if (!server.allowInvalidCertificate) {
      // Restore Electron's default certificate validation for this server session.
      serverSession.setCertificateVerifyProc(null)
    } else {
      const expectedHost = new URL(server.url).hostname.toLowerCase()
      serverSession.setCertificateVerifyProc((request, callback) => {
        // Keep normal validation for valid certificates and only bypass failures for this server's host.
        if (request.verificationResult === 'OK' || request.hostname.toLowerCase() === expectedHost) {
          callback(0)
        } else {
          // Reject invalid certificates for every other host (-2).
          callback(-2)
        }
      })
    }
    // Certificate verification results can be cached by Electron's network service.
    await serverSession.closeAllConnections()
  }

  async destroyView(server: Server) {
    const view = this.allViews[server.id]
    if (!view) return
    this.mainWindow.contentView.removeChildView(view)
    view.webContents.close()
    // Force destruction to ensure all connections are closed
    ;(view.webContents as any).destroy?.()
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
    ipcMain.handle(REMOTE_RENDERER.MISC.DIALOG_OPEN, async (ev: IpcMainInvokeEventServer, properties) => {
      this.getServerFromVerifiedSender(ev)
      return await dialog.showOpenDialog(this.mainWindow, properties)
    })
    ipcMain.on(REMOTE_RENDERER.MISC.FILE_OPEN, async (ev: IpcMainEventServer, fullPath: string) => {
      const server = this.getServerFromVerifiedSender(ev, { throwOnError: false })
      if (!server) return
      showItemInFolder(fullPath, server)
    })
    ipcMain.on(REMOTE_RENDERER.MISC.URL_OPEN, async (ev: IpcMainEventServer, url: string) => {
      const server = this.getServerFromVerifiedSender(ev, { throwOnError: false })
      if (!server) return
      openExternal(url).catch(console.error)
    })
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

  private isUrlWithinServerScope(url: string, server: Server): boolean {
    try {
      const target = new URL(url)
      const expected = new URL(server.url)
      const expectedPath = expected.pathname.endsWith('/') ? expected.pathname : `${expected.pathname}/`
      const targetPath = target.pathname.endsWith('/') ? target.pathname : `${target.pathname}/`
      return target.origin === expected.origin && targetPath.startsWith(expectedPath)
    } catch {
      return false
    }
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
