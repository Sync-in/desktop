/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { MenuItemConstructorOptions, shell } from 'electron'
import { i18n } from '../components/translate'
import { ENVIRONMENT, IS_MACOS, MAIN_LOGS_FILE } from '@sync-in-desktop/core/constants'
import { appEvents } from '../components/events'
import { LOCAL_RENDERER } from './events'
import { appSettings } from '../components/settings'

export const separatorItem: MenuItemConstructorOptions = {
  type: 'separator'
}

export const checkUpdateMenu: () => MenuItemConstructorOptions = () => ({
  label: i18n.tr('Check for Updates'),
  click: () => appEvents.emit(LOCAL_RENDERER.UPDATE.CHECK)
})

export const supportMenu: (withAppName?: boolean) => MenuItemConstructorOptions = (withAppName = true) => ({
  label: `${i18n.tr('Support')}${withAppName ? ` ${ENVIRONMENT.appID} ` : ' '}💛`,
  click: () => shell.openExternal(`${ENVIRONMENT.appHomePage}${i18n.language === 'fr' ? '/fr' : ''}/support/`)
})

export const preferencesMenu: () => MenuItemConstructorOptions[] = () => [
  {
    label: i18n.tr('Launch at startup'),
    type: 'checkbox',
    checked: appSettings.configuration.launchAtStartup,
    click: () => appEvents.emit(LOCAL_RENDERER.SETTINGS.LAUNCH_AT_STARTUP)
  },
  {
    label: i18n.tr('Start Hidden'),
    type: 'checkbox',
    checked: appSettings.configuration.startHidden,
    click: () => appEvents.emit(LOCAL_RENDERER.SETTINGS.START_HIDDEN)
  },
  ...(IS_MACOS
    ? [
        {
          label: i18n.tr('Hide Dock Icon'),
          type: 'checkbox',
          checked: appSettings.configuration.hideDockIcon,
          click: () => appEvents.emit(LOCAL_RENDERER.SETTINGS.HIDE_DOCK_ICON)
        } satisfies MenuItemConstructorOptions
      ]
    : [])
]
export const helpMenu: (name?: string, withCheckUpdate?: boolean) => MenuItemConstructorOptions = (name = 'Help', withCheckUpdate = false) => ({
  label: i18n.tr(name),
  submenu: [
    supportMenu(),
    {
      label: i18n.tr('Documentation'),
      click: () => shell.openExternal(`${ENVIRONMENT.appHomePage}${i18n.language === 'fr' ? '/fr' : ''}/docs/`)
    },
    {
      label: i18n.tr('Version History'),
      click: () => shell.openExternal(ENVIRONMENT.appReleasesPage)
    },
    ...(withCheckUpdate ? [separatorItem] : []),
    {
      label: `${i18n.tr('Version')} ${ENVIRONMENT.appVersion}`,
      role: 'about'
    },
    ...(withCheckUpdate ? [checkUpdateMenu()] : []),
    separatorItem,
    {
      id: 'Show logs',
      label: i18n.tr('Show logs'),
      click: () => shell.showItemInFolder(MAIN_LOGS_FILE)
    }
  ]
})
