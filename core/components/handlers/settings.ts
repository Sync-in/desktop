/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import fs from 'node:fs'
import { getLogger } from './loggers'
import { isPathExists, loadJsonFile, writeToFileSync } from '../utils/functions'
import { Server } from '../models/server'
import { CONF_PATH, SERVERS_SETTINGS, SNAPSHOTS_PATH, SYNC_LOGS_PATH } from '../../constants'
import { CORE, coreEvents } from './events'

const logger = getLogger('Settings')

class SettingsManager {
  public servers: Server[] = []

  constructor() {
    SettingsManager.checkDirectories()
    this.loadSettings()
    this.listeners()
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

  writeServersSettings(reloadConf = false, exit = false) {
    try {
      writeToFileSync(
        SERVERS_SETTINGS,
        this.servers.map((s: Server) => s.export())
      )
      logger.debug(`${SERVERS_SETTINGS} saved (reload: ${reloadConf}, exited: ${exit})`)
    } catch (e) {
      logger.error(e)
      throw e
    }
  }

  private listeners() {
    coreEvents.on(CORE.SAVE_SETTINGS, (reloadConf?: boolean, exit?: boolean) => this.writeServersSettings(reloadConf, exit))
  }

  private loadSettings() {
    this.servers = loadJsonFile(SERVERS_SETTINGS, []).map((data: Partial<Server>) => new Server(data))
  }
}

export const settingsManager: SettingsManager = new SettingsManager()
