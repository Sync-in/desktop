import { app, Menu } from 'electron'
import { i18n } from './translate'
import { WindowManager } from './windows'
import { TrayManager } from './tray'
import { DownloadManager } from './downloads'
import { NotifyManager } from './notifications'
import { EventsManager } from './events'
import { UpdateManager } from './autoupdater'
import { ENVIRONMENT, IS_MACOS, IS_PROD_ENV, IS_WINDOWS } from '../../core/constants'
import { createMenu } from './menus'
import { appSettings } from './settings'
import { LoopbackServer } from './loopback-server'

export class MainManager {
  trayManager: TrayManager
  windowManager: WindowManager
  downloadManager: DownloadManager
  notifyManager: NotifyManager
  eventsManager: EventsManager
  updateManager: UpdateManager

  start() {
    app.whenReady().then(() => this.appIsReady())
  }

  appIsReady() {
    if (!app.requestSingleInstanceLock()) {
      console.log('Sync-in App is already started')
      app.quit()
      return
    }
    if (IS_WINDOWS) {
      app.setAppUserModelId(ENVIRONMENT.appID)
    }
    this.checkStartUp()
    // `app.getLocale()` returns English by default if the language is not listed in `electronLanguages` in the main package.json
    i18n.updateLanguage(app.getLocale())
    Menu.setApplicationMenu(createMenu())
    this.trayManager = new TrayManager()
    this.windowManager = new WindowManager()
    this.eventsManager = new EventsManager(this.windowManager.viewsManager)
    this.notifyManager = new NotifyManager(this.windowManager.viewsManager)
    this.downloadManager = new DownloadManager(this.windowManager, this.notifyManager)
    this.updateManager = new UpdateManager()
    app.on('activate', () => this.windowManager.show())
    app.on('window-all-closed', () => console.log('all windows closed'))
    app.on('before-quit', (e: Event) => {
      e.preventDefault()
      LoopbackServer.cleanupLoopbackSessions()
      this.eventsManager.runManager.exitGracefully()
      this.windowManager.setAppIsQuitting(true)
    })
    this.windowManager.setAppIsQuitting(false)
  }

  private checkStartUp() {
    if (IS_MACOS && appSettings.configuration.hideDockIcon) {
      app.dock.hide()
    }
    if (!IS_PROD_ENV) return
    const loginItem = app.getLoginItemSettings()
    if (appSettings.configuration.launchAtStartup !== loginItem.openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: appSettings.configuration.launchAtStartup })
    }
    if (app.commandLine.hasSwitch('hidden') || process.env.SYNC_IN_HIDDEN === '1') {
      appSettings.configuration.startHidden = true
    }
  }
}
