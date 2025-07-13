/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import fs from 'node:fs'
import { getLogger } from './loggers'
import { isPathExists } from '../utils/functions'
import { Server } from '../models/server'
import { CONF_PATH, SERVERS_SETTINGS, SNAPSHOTS_PATH, SYNC_LOGS_PATH } from '../../constants'
import { CORE, coreEvents } from './events'

const logger = getLogger('Settings')

class SettingsManager {
  // configurations
  public servers: Server[] = []

  constructor() {
    SettingsManager.checkDirectories()
    this.loadSettings()
    this.listeners()
  }

  private listeners() {
    coreEvents.on(CORE.SAVE_SETTINGS, (reloadConf?: boolean, exit?: boolean) => this.writeServersSettings(reloadConf, exit))
  }

  writeServersSettings(reloadConf = false, exit = false) {
    SettingsManager.writeToFile(
      SERVERS_SETTINGS,
      this.servers.map((s: Server) => s.export()),
      4
    )
    logger.debug(`${SERVERS_SETTINGS} saved (reload: ${reloadConf}, exited: ${exit})`)
  }

  private loadSettings() {
    this.servers = SettingsManager.loadFromFile(SERVERS_SETTINGS, []).map((data: any) => new Server(data))
  }

  private static writeToFile(filePath: string, settings: any, indent = null) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(settings, null, indent))
    } catch (e) {
      logger.error(e)
      throw e
    }
  }

  private static loadFromFile(filePath: string, defaultValue: any = {}): any[] {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } else {
      return defaultValue
    }
  }

  private static checkDirectories() {
    for (const path of [CONF_PATH, SNAPSHOTS_PATH, SYNC_LOGS_PATH]) {
      isPathExists(path).catch((e) => {
        logger.warn(e)
        fs.mkdirSync(path)
        logger.debug(`${path} created`)
      })
    }
  }
}

export const settingsManager: SettingsManager = new SettingsManager()
