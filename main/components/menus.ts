import { ENVIRONMENT, IS_MACOS, IS_WINDOWS } from '../../core/constants'
import { i18n } from './translate'
import { Menu, MenuItem, MenuItemConstructorOptions } from 'electron'
import { LOCAL_RENDERER } from '../constants/events'
import { appEvents } from './events'
import { checkUpdateMenu, helpMenu, preferencesMenu, separatorItem, supportMenu } from '../constants/menus'

export function createTemplate() {
  const template = []
  let platformAppMenu = []

  if (IS_MACOS) {
    platformAppMenu.push(supportMenu())
    platformAppMenu.push(checkUpdateMenu())
    platformAppMenu.push(separatorItem)
  }

  platformAppMenu.push({
    label: i18n.tr('Connect to a server'),
    click: () => appEvents.emit(LOCAL_RENDERER.UI.MODAL_TOGGLE)
  })

  platformAppMenu.push({ label: 'Preferences', submenu: preferencesMenu() })

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
      supportMenu(),
      checkUpdateMenu(),
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
  template.push({ ...helpMenu(), id: 'help' })
  return template
}

export function createMenu() {
  return Menu.buildFromTemplate(createTemplate() as (MenuItemConstructorOptions | MenuItem)[])
}
