/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { ENVIRONMENT, IS_MACOS, IS_WINDOWS, MAIN_LOGS_FILE } from '../../core/constants'
import { i18n } from './translate'
import { Menu, MenuItem, MenuItemConstructorOptions, shell } from 'electron'
import { LOCAL_RENDERER } from '../constants/events'
import { appEvents } from './events'

export function createTemplate() {
  const separatorItem: MenuItemConstructorOptions = {
    type: 'separator'
  }

  const template = []

  let platformAppMenu = []
  if (IS_MACOS) {
    platformAppMenu.push({
      label: `${i18n.tr('About')} ${ENVIRONMENT.appID}`,
      role: 'about'
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
      accelerator: 'CmdOrCtrl+[',
      click: () => appEvents.emit(LOCAL_RENDERER.UI.NAV_BACK)
    },
    {
      label: i18n.tr('Forward'),
      accelerator: 'CmdOrCtrl+]',
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
      role: 'resetZoom',
      accelerator: 'CmdOrCtrl+0'
    },
    {
      role: 'zoomIn',
      label: i18n.tr('Zoom In'),
      accelerator: 'CmdOrCtrl+='
    },
    {
      role: 'zoomIn',
      visible: false,
      accelerator: 'CmdOrCtrl+Shift+='
    },
    {
      role: 'zoomOut',
      label: i18n.tr('Zoom Out'),
      accelerator: 'CmdOrCtrl+-'
    },
    {
      role: 'zoomOut',
      visible: false,
      accelerator: 'CmdOrCtrl+Shift+-'
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
  if (!IS_MACOS) {
    helpMenu.push({
      label: i18n.tr('Check for Updates'),
      click: () => appEvents.emit(LOCAL_RENDERER.UPDATE.CHECK)
    })
  }
  helpMenu.push({
    label: i18n.tr('Learn More...'),
    click: () => shell.openExternal(ENVIRONMENT.appHomePage)
  })

  helpMenu.push({
    id: 'Show logs',
    label: i18n.tr('Show logs'),
    click: () => shell.showItemInFolder(MAIN_LOGS_FILE)
  })
  helpMenu.push(separatorItem)

  helpMenu.push({
    label: `${i18n.tr('Version')} ${ENVIRONMENT.appVersion}`
  })

  template.push({ id: 'help', label: i18n.tr('Help'), submenu: helpMenu })
  return template
}

export function createMenu() {
  return Menu.buildFromTemplate(createTemplate() as (MenuItemConstructorOptions | MenuItem)[])
}
