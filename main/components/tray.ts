/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import path from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import { i18n } from './translate'
import { CORE, coreEvents } from '../../core/components/handlers/events'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../constants/events'
import { appEvents } from './events'
import { ENVIRONMENT, IS_MACOS, IS_WINDOWS } from '../../core/constants'
import { ServersManager } from '../../core/components/handlers/servers'
import { SyncStatus } from '@sync-in-desktop/core/components/interfaces/sync-status.interface'

const enabledTrayIcon = nativeImage.createFromPath(path.join(__dirname, './assets/tray/enabled.png')).resize({ width: 22 })
const disabledTrayIcon = nativeImage.createFromPath(path.join(__dirname, './assets/tray/disabled.png')).resize({ width: 22 })
const inSyncTrayIcon = nativeImage.createFromPath(path.join(__dirname, './assets/tray/sync.png')).resize({ width: 22 })

const enabledServerIcon = nativeImage.createFromPath(path.join(__dirname, './assets/tray/states/ok.png')).resize({ width: 14 })
const failedServerIcon = nativeImage.createFromPath(path.join(__dirname, './assets/tray/states/failed.png')).resize({ width: 14 })

const enabledDockIcon = IS_MACOS ? nativeImage.createFromPath(path.join(__dirname, './assets/tray/dock/enabled.png')) : null
const disabledDockIcon = IS_MACOS ? nativeImage.createFromPath(path.join(__dirname, './assets/tray/dock/disabled.png')) : null
const inSyncDockIcon = IS_MACOS ? nativeImage.createFromPath(path.join(__dirname, './assets/tray/dock/sync.png')) : null

export class TrayManager {
  private tray: Tray
  private currentSyncs = 0
  private networkIsOnline = false

  constructor() {
    this.tray = new Tray(disabledTrayIcon)
    this.tray.setToolTip(ENVIRONMENT.appID)
    this.setSyncState(false)
    this.listeners()
  }

  private listeners() {
    if (IS_WINDOWS) {
      this.tray.on('right-click', () => this.tray.popUpContextMenu())
      this.tray.on('click', () => appEvents.emit(LOCAL_RENDERER.WINDOW.SHOW))
    }
    coreEvents.on(CORE.SAVE_SETTINGS, (reloadConf?: boolean) => {
      if (reloadConf) {
        this.setTrayMenu()
      }
    })
    coreEvents.on(CORE.SYNC_STATUS, (params: SyncStatus) => this.onSyncStatus(params))
    appEvents.on(REMOTE_RENDERER.MISC.NETWORK_IS_ONLINE, (state: boolean) => this.networkState(state))
  }

  private setTrayMenu() {
    this.tray.setContextMenu(Menu.buildFromTemplate(this.buildMenu()))
    if (IS_MACOS) {
      app.dock.setMenu(Menu.buildFromTemplate(this.buildMenu().slice(0, -1)))
    }
  }

  private buildMenu(): any[] {
    const mainMenu = [
      {
        label: `${i18n.tr('Open')} ${ENVIRONMENT.appID}`,
        type: 'normal',
        click: () => appEvents.emit(LOCAL_RENDERER.WINDOW.SHOW)
      },
      {
        type: 'separator'
      },
      {
        label: i18n.tr('Quit'),
        type: 'normal',
        role: 'quit'
      }
    ]
    const serversMenu = this.buildServersMenu()
    if (serversMenu.length) {
      mainMenu.splice(1, 0, ...serversMenu)
    }
    return mainMenu
  }

  private buildServersMenu(): any {
    const serversMenu = []
    for (const server of ServersManager.list) {
      const serverMenu = {
        label: server.name,
        icon: server.available ? enabledServerIcon : failedServerIcon,
        submenu: [
          {
            label: `${i18n.tr('Open')}`,
            srvid: server.id,
            click: (e) => this.activeServerView(e)
          }
        ]
      }
      if (server.syncPaths.length) {
        const syncMenu: any = {
          label: `${i18n.tr('Sync')}`,
          enabled: server.available,
          submenu: [
            {
              label: i18n.tr('All'),
              enabled: server.available,
              spid: null,
              srvid: server.id,
              click: (e) => this.startSync(e)
            }
          ]
        }
        if (server.syncPaths.length > 1) {
          syncMenu.submenu.push({ type: 'separator' })
        }
        for (const syncpath of server.syncPaths) {
          syncMenu.submenu.push({
            label: syncpath.name,
            enabled: server.available && syncpath.enabled,
            spid: [syncpath.id],
            srvid: server.id,
            click: (e) => this.startSync(e)
          })
        }
        serverMenu.submenu.push(syncMenu)
      }
      serversMenu.push(serverMenu)
    }
    if (serversMenu.length) {
      serversMenu.unshift({ type: 'separator' })
    }
    return serversMenu
  }

  private startSync(e: any) {
    coreEvents.emit(CORE.SYNC_START, { server: e.srvid, paths: e.spid }, false, true)
  }

  private activeServerView(e: any) {
    appEvents.emit(LOCAL_RENDERER.SERVER.SET_ACTIVE, e.srvid)
  }

  private setSyncState(state: boolean) {
    appEvents.emit(LOCAL_RENDERER.POWER.PREVENT_APP_SUSPENSION, state)
    this.tray.setImage(state ? inSyncTrayIcon : this.networkIsOnline ? enabledTrayIcon : disabledTrayIcon)
    if (IS_MACOS) {
      app.dock.setIcon(state ? inSyncDockIcon : this.networkIsOnline ? enabledDockIcon : disabledDockIcon)
    }
    this.setTrayMenu()
  }

  private onSyncStatus(sync: SyncStatus) {
    if (!sync.reportOnly) {
      if (sync.state) {
        this.currentSyncs++
      } else {
        this.currentSyncs--
      }
      this.setSyncState(!!this.currentSyncs)
    }
  }

  private networkState(state: boolean) {
    this.networkIsOnline = state
    this.setSyncState(false)
  }
}
