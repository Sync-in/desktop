/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import path from 'node:path'
import { SYNC_CLIENT_TYPE } from './components/constants/auth'
import packageJson from '../package.json'

export const ENVIRONMENT = {
  appVersion: packageJson.version,
  appName: process.versions.electron ? SYNC_CLIENT_TYPE.DESKTOP : SYNC_CLIENT_TYPE.CLI,
  appID: packageJson.productName || null,
  appHomePage: packageJson.homepage
}
export const USER_AGENT = `${ENVIRONMENT.appName}/${ENVIRONMENT.appVersion}`
export const IS_MACOS = process.platform === 'darwin'
export const IS_WINDOWS = process.platform === 'win32'
export const IS_PROD_ENV = process.env.NODE_ENV === 'production'
export const IS_DEV_ENV = process.env.NODE_ENV === 'development'
export const HAS_TTY = (IS_WINDOWS && IS_DEV_ENV) || Boolean(process.stdout.isTTY)
export const CONF_PATH = path.join(...(IS_WINDOWS ? [process.env['APPDATA'], 'Sync-in-Profile'] : [process.env['HOME'], '.sync-in']))
export const SNAPSHOTS_PATH = path.join(CONF_PATH, 'snapshots')
export const SERVERS_SETTINGS = path.join(CONF_PATH, 'servers.json')
export const MAIN_LOGS_FILE = path.join(CONF_PATH, 'sync.log')
export const SYNC_LOGS_PATH = path.join(CONF_PATH, 'logs')
