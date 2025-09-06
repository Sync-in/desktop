/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { loadJsonFile, writeToFileSync } from '@sync-in-desktop/core/components/utils/functions'
import { APP_CONF_FILE } from '../constants/settings'
import { AppConfiguration } from '../interfaces/settings.interface'

export class AppSettings {
  public configuration: AppConfiguration = { launchAtStartup: true, startHidden: false }

  constructor() {
    this.loadSettings()
  }

  writeSettings() {
    try {
      writeToFileSync(APP_CONF_FILE, this.configuration)
      console.debug(`${APP_CONF_FILE} written`)
    } catch (e) {
      console.error(`${APP_CONF_FILE} not written: ${e}`)
    }
  }

  private loadSettings() {
    this.configuration = loadJsonFile(APP_CONF_FILE, this.configuration)
  }
}
