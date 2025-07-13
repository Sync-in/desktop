/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { app, globalShortcut, Menu } from 'electron'
import { i18n } from './components/translate'

import { WindowManager } from './components/windows'
import { TrayManager } from './components/tray'
import { DownloadManager } from './components/downloads'
import { NotifyManager } from './components/notifications'
import { appEvents, EventsManager } from './components/events'
import { UpdateManager } from './components/autoupdater'
import { ENVIRONMENT, IS_PROD_ENV, IS_WINDOWS } from '../core/constants'
import { createMenu } from './components/menus'
import { LOCAL_RENDERER } from './constants/events'

class MainManager {
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
  }

  appIsReady() {
    if (!app.requestSingleInstanceLock()) {
      console.log('App already started')
      app.quit()
      return
    }
    if (IS_WINDOWS) {
      app.setAppUserModelId(ENVIRONMENT.appID)
    }
    if (IS_PROD_ENV && !app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: true })
    }
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
      this.eventsManager.runManager.exitGracefully()
      this.windowManager.setAppIsQuitting(true)
    })
    this.windowManager.setAppIsQuitting(false)
    globalShortcut.register('CmdOrCtrl+Left', () => appEvents.emit(LOCAL_RENDERER.UI.NAV_BACK))
    globalShortcut.register('CmdOrCtrl+Right', () => appEvents.emit(LOCAL_RENDERER.UI.NAV_FORWARD))
  }
}

new MainManager()
