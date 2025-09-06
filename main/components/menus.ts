/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { ENVIRONMENT, IS_MACOS, IS_WINDOWS, MAIN_LOGS_FILE } from '../../core/constants'
import { i18n } from './translate'
import { app, Menu, MenuItem, MenuItemConstructorOptions, shell } from 'electron'
import { LOCAL_RENDERER } from '../constants/events'
import { appEvents } from './events'
import { AppSettings } from './settings'

export function createTemplate(settings: AppSettings) {
  const separatorItem: MenuItemConstructorOptions = {
    type: 'separator'
  }

  const template = []

  let platformAppMenu = []
  if (IS_MACOS) {
    platformAppMenu.push({
      label: `${i18n.tr('Support')} ${ENVIRONMENT.appID}`,
      click: () => shell.openExternal(ENVIRONMENT.appSupportPage)
    })
    platformAppMenu.push({
      label: i18n.tr('Check for Updates'),
      click: () => appEvents.emit(LOCAL_RENDERER.UPDATE.CHECK)
    })
    platformAppMenu.push(separatorItem)
  }

  platformAppMenu.push({
    label: i18n.tr('Connect to a server'),
    click: () => appEvents.emit(LOCAL_RENDERER.UI.MODAL_TOGGLE)
  })

  platformAppMenu.push({
    label: 'Options',
    submenu: [
      {
        label: i18n.tr('Launch at startup'),
        type: 'checkbox',
        checked: settings.configuration.launchAtStartup,
        click: () => {
          settings.configuration.launchAtStartup = !settings.configuration.launchAtStartup
          settings.writeSettings()
          app.setLoginItemSettings({ openAtLogin: settings.configuration.launchAtStartup })
        }
      },
      {
        label: i18n.tr('Start Hidden'),
        type: 'checkbox',
        checked: settings.configuration.startHidden,
        click: () => {
          settings.configuration.startHidden = !settings.configuration.startHidden
          settings.writeSettings()
        }
      }
    ]
  })

  if (IS_MACOS) {
    platformAppMenu = platformAppMenu.concat([
      separatorItem,
      {
        role: 'hide',
        label: `${i18n.tr('Hide')} ${ENVIRONMENT.appID}`
      },
      {
        role: 'hideOthers',
        label: i18n.tr('Hide Others')
      },
      {
        role: 'unhide',
        label: i18n.tr('Show All')
      },
      separatorItem,
      {
        role: 'quit',
        label: `${i18n.tr('Quit')} ${ENVIRONMENT.appID}`
      }
    ])
  } else {
    platformAppMenu = platformAppMenu.concat([
      separatorItem,
      {
        label: `${i18n.tr('Support')} ${ENVIRONMENT.appID}`,
        click: () => shell.openExternal(ENVIRONMENT.appSupportPage)
      },
      {
        label: i18n.tr('Check for Updates'),
        click: () => appEvents.emit(LOCAL_RENDERER.UPDATE.CHECK)
      },
      separatorItem,
      {
        role: 'quit',
        label: i18n.tr('Quit'),
        accelerator: 'CmdOrCtrl+Q'
      }
    ])
  }

  template.push({
    id: 'sync-in',
    label: ENVIRONMENT.appID,
    submenu: [...platformAppMenu]
  })
  template.push({
    id: 'edit',
    label: i18n.tr('&Edit'),
    submenu: [
      {
        role: 'undo',
        label: i18n.tr('Undo'),
        accelerator: 'CmdOrCtrl+Z'
      },
      {
        role: 'Redo',
        label: i18n.tr('Redo'),
        accelerator: 'CmdOrCtrl+SHIFT+Z'
      },
      separatorItem,
      {
        role: 'cut',
        label: i18n.tr('Cut'),
        accelerator: 'CmdOrCtrl+X'
      },
      {
        role: 'copy',
        label: i18n.tr('Copy'),
        accelerator: 'CmdOrCtrl+C'
      },
      {
        role: 'paste',
        label: i18n.tr('Paste'),
        accelerator: 'CmdOrCtrl+V'
      },
      {
        role: 'selectall',
        label: i18n.tr('Select All'),
        accelerator: 'CmdOrCtrl+A'
      }
    ]
  })

  const viewSubMenu = [
    {
      label: i18n.tr('Back'),
      accelerator: 'CmdOrCtrl+Left',
      click: () => appEvents.emit(LOCAL_RENDERER.UI.NAV_BACK)
    },
    {
      label: i18n.tr('Forward'),
      accelerator: 'CmdOrCtrl+Right',
      click: () => appEvents.emit(LOCAL_RENDERER.UI.NAV_FORWARD)
    },
    {
      label: i18n.tr('Reload'),
      accelerator: 'CmdOrCtrl+R',
      click: () => appEvents.emit(LOCAL_RENDERER.SERVER.RELOAD, false)
    },
    {
      label: i18n.tr('Clear Cache and Reload'),
      accelerator: 'Shift+CmdOrCtrl+R',
      click: () => appEvents.emit(LOCAL_RENDERER.SERVER.RELOAD, true)
    },
    {
      role: 'togglefullscreen',
      label: i18n.tr('Toggle Full Screen'),
      visible: false,
      accelerator: IS_MACOS ? 'Ctrl+Cmd+F' : 'F11'
    },
    separatorItem,
    {
      label: i18n.tr('Actual Size'),
      accelerator: 'CmdOrCtrl+0',
      click: () => appEvents.emit(LOCAL_RENDERER.WINDOW.ZOOM.RESET)
    },
    {
      label: i18n.tr('Zoom In'),
      accelerator: 'CmdOrCtrl+=',
      click: () => appEvents.emit(LOCAL_RENDERER.WINDOW.ZOOM.IN)
    },
    {
      label: i18n.tr('Zoom Out'),
      accelerator: 'CmdOrCtrl+-',
      click: () => appEvents.emit(LOCAL_RENDERER.WINDOW.ZOOM.OUT)
    },
    separatorItem,
    {
      label: i18n.tr('Developer Tools for Application Wrapper'),
      accelerator: (() => {
        if (process.platform === 'darwin') {
          return 'Alt+Command+I'
        }
        return 'Ctrl+Shift+I'
      })(),
      click: () => appEvents.emit(LOCAL_RENDERER.DEVTOOLS.SHOW_WRAPPER)
    },
    {
      label: i18n.tr('Developer Tools for Current Server'),
      click: () => appEvents.emit(LOCAL_RENDERER.DEVTOOLS.SHOW_SERVER)
    }
  ]

  template.push({
    id: 'view',
    label: i18n.tr('View'),
    submenu: viewSubMenu
  })

  const windowMenu = {
    id: 'window',
    label: i18n.tr('Window'),
    role: IS_MACOS ? 'windowMenu' : null,
    submenu: [
      {
        role: 'minimize',
        label: i18n.tr('Minimize'),
        // empty string removes shortcut on Windows; null will default by OS
        accelerator: IS_WINDOWS ? '' : null
      },
      ...(IS_MACOS
        ? [
            {
              role: 'zoom',
              label: i18n.tr('Zoom')
            },
            separatorItem
          ]
        : []),
      {
        role: 'close',
        label: IS_MACOS ? i18n.tr('Close Window') : i18n.tr('Close'),
        accelerator: 'CmdOrCtrl+W'
      },
      separatorItem,
      ...(IS_MACOS
        ? [
            separatorItem,
            {
              role: 'front',
              label: i18n.tr('Bring All to Front')
            }
          ]
        : [])
    ]
  }
  template.push(windowMenu)
  const helpMenu = []
  helpMenu.push({
    label: i18n.tr('Official Website'),
    click: () => shell.openExternal(ENVIRONMENT.appHomePage)
  })

  helpMenu.push({
    label: i18n.tr('Documentation'),
    click: () => shell.openExternal(`${ENVIRONMENT.appHomePage}/docs/`)
  })

  helpMenu.push({
    label: i18n.tr('Version history'),
    click: () => shell.openExternal(ENVIRONMENT.appReleasesPage)
  })

  helpMenu.push({
    label: `${i18n.tr('Version')} ${ENVIRONMENT.appVersion}`,
    role: 'about'
  })

  helpMenu.push(separatorItem)

  helpMenu.push({
    id: 'Show logs',
    label: i18n.tr('Show logs'),
    click: () => shell.showItemInFolder(MAIN_LOGS_FILE)
  })

  template.push({ id: 'help', label: i18n.tr('Help'), submenu: helpMenu })
  return template
}

export function createMenu(settings: AppSettings) {
  return Menu.buildFromTemplate(createTemplate(settings) as (MenuItemConstructorOptions | MenuItem)[])
}
