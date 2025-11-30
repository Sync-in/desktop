/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { BrowserWindow, ipcMain } from 'electron'
import { defaultWindowProps } from '../constants/windows'
import { ViewsManager } from './views'
import { LOCAL_RENDERER } from '../constants/events'
import { appEvents } from './events'
import { ENVIRONMENT, IS_MACOS } from '../../core/constants'
import { appSettings } from './settings'

export class WindowManager {
  appIsQuitting = false
  mainWindow: BrowserWindow
  viewsManager: ViewsManager

  constructor() {
    this.mainWindow = new BrowserWindow(defaultWindowProps)
    this.mainWindow.setTitle(ENVIRONMENT.appID)
    this.mainWindow.setMenuBarVisibility(false)
    this.viewsManager = new ViewsManager(this.mainWindow, !appSettings.configuration.startHidden)
    this.mainWindow.on('close', (e: Event) => this.close(e))
    this.mainWindow.on('maximize', () => this.viewsManager.sendToWrapperRenderer(LOCAL_RENDERER.WINDOW.IS_MAXIMIZED, true))
    this.mainWindow.on('unmaximize', () => this.viewsManager.sendToWrapperRenderer(LOCAL_RENDERER.WINDOW.IS_MAXIMIZED, false))
    this.mainWindow.on('enter-full-screen', () => this.viewsManager.sendToWrapperRenderer(LOCAL_RENDERER.WINDOW.IS_FULLSCREEN, true))
    this.mainWindow.on('leave-full-screen', () => this.viewsManager.sendToWrapperRenderer(LOCAL_RENDERER.WINDOW.IS_FULLSCREEN, false))
    this.mainWindow.on('resize', () => this.viewsManager.resizeViews())
    this.initIPC()
  }

  private initIPC() {
    appEvents.on(LOCAL_RENDERER.WINDOW.SHOW, () => this.mainWindow.show())
    appEvents.on(LOCAL_RENDERER.UPDATE.RESTART, () => this.setAppIsQuitting(true))
    ipcMain.on(LOCAL_RENDERER.WINDOW.CLOSE, () => this.close())
    ipcMain.on(LOCAL_RENDERER.WINDOW.MINIMIZE, () => this.mainWindow.minimize())
    ipcMain.on(LOCAL_RENDERER.WINDOW.MAXIMIZE, () => this.mainWindow.maximize())
    ipcMain.on(LOCAL_RENDERER.WINDOW.UNMAXIMIZE, () => this.unmaximize())
  }

  sendToWrapperRenderer(channel: string, ...args: any[]) {
    this.viewsManager.sendToWrapperRenderer(channel, ...args)
  }

  private close(e?: Event) {
    if (this.appIsQuitting) {
      this.mainWindow = null
    } else {
      e?.preventDefault()
      if (IS_MACOS) {
        if (this.mainWindow.isFullScreen()) {
          this.mainWindow.once('leave-full-screen', this.hide)
          this.mainWindow.setFullScreen(false)
          return
        }
      }
      this.hide()
    }
  }

  show() {
    if (this.mainWindow.isVisible()) {
      this.mainWindow.focus()
    } else {
      this.mainWindow.show()
    }
  }

  private unmaximize() {
    if (IS_MACOS) {
      if (this.mainWindow.isFullScreen()) {
        this.mainWindow.once('leave-full-screen', this.mainWindow.unmaximize)
        this.mainWindow.setFullScreen(false)
        return
      }
    }
    this.mainWindow.unmaximize()
  }

  private hide() {
    this.mainWindow?.blur()
    this.mainWindow?.hide()
  }

  setAppIsQuitting(status: boolean) {
    this.appIsQuitting = status
  }
}
