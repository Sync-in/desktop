/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { app, Menu } from 'electron'
import { i18n } from './components/translate'
import { WindowManager } from './components/windows'
import { TrayManager } from './components/tray'
import { DownloadManager } from './components/downloads'
import { NotifyManager } from './components/notifications'
import { EventsManager } from './components/events'
import { UpdateManager } from './components/autoupdater'
import { ENVIRONMENT, IS_PROD_ENV, IS_WINDOWS } from '../core/constants'
import { createMenu } from './components/menus'
import { AppSettings } from './components/settings'

class MainManager {
  appSettings: AppSettings
  trayManager: TrayManager
  windowManager: WindowManager
  downloadManager: DownloadManager
  notifyManager: NotifyManager
  eventsManager: EventsManager
  updateManager: UpdateManager

  constructor() {
    // app.disableHardwareAcceleration()
    // app.commandLine.appendSwitch('log-file', MAIN_LOGS_FILE)
    // app.commandLine.appendSwitch('enable-logging')
    app.commandLine.appendSwitch('ignore-certificate-errors')
    app.whenReady().then(() => this.appIsReady())
    this.appSettings = new AppSettings()
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
    i18n.updateLanguage(app.getLocale())
    Menu.setApplicationMenu(createMenu(this.appSettings))
    this.trayManager = new TrayManager()
    this.windowManager = new WindowManager(this.appSettings.configuration.startHidden)
    this.eventsManager = new EventsManager(this.windowManager.viewsManager)
    this.notifyManager = new NotifyManager(this.windowManager.viewsManager)
    this.downloadManager = new DownloadManager(this.windowManager, this.notifyManager)
    this.updateManager = new UpdateManager()
    app.on('activate', () => this.windowManager.show())
    app.on('window-all-closed', () => console.log('all windows closed'))
    app.on('before-quit', (e: Event) => {
      e.preventDefault()
      this.eventsManager.runManager.exitGracefully()
      this.windowManager.setAppIsQuitting(true)
    })
    this.windowManager.setAppIsQuitting(false)
  }

  private checkStartUp() {
    if (!IS_PROD_ENV) return
    const loginItem = app.getLoginItemSettings()
    if (this.appSettings.configuration.launchAtStartup !== loginItem.openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: this.appSettings.configuration.launchAtStartup })
    }
    if (app.commandLine.hasSwitch('hidden') || process.env.SYNC_IN_HIDDEN === '1') {
      this.appSettings.configuration.startHidden = true
    }
  }
}

new MainManager()
