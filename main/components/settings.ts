import { loadJsonFile, writeToFileSync } from '@sync-in-desktop/core/components/utils/functions'
import { APP_CONF_FILE } from '../constants/settings'
import { AppConfiguration } from '../interfaces/settings.interface'

class AppSettings {
  public configuration: AppConfiguration = { launchAtStartup: true, startHidden: false, hideDockIcon: false }

  constructor() {
    this.loadSettings()
  }

  writeSettings() {
    try {
      writeToFileSync(APP_CONF_FILE, this.configuration)
    } catch (e) {
      console.error(`${APP_CONF_FILE} not written: ${e}`)
    }
  }

  private loadSettings() {
    this.configuration = loadJsonFile(APP_CONF_FILE, this.configuration)
  }
}

export const appSettings = new AppSettings()
