/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */
import { autoUpdater } from 'electron-updater'
import { app, ipcMain, Notification } from 'electron'
import { appEvents } from './events'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../constants/events'
import { Logger } from 'winston'
import { getLogger } from '../../core/components/handlers/loggers'
import { F_ACTION, SIDE } from '../../core/components/constants/handlers'
import { i18n } from './translate'
import { ENVIRONMENT, USER_AGENT } from '../../core/constants'
import { toHumanSize } from '../../core/components/utils/functions'
import { ServersManager } from '@sync-in-desktop/core/components/handlers/servers'
import { RequestsManager } from '@sync-in-desktop/core/components/handlers/requests'
import { API } from '@sync-in-desktop/core/components/constants/requests'
import { APP_STORE_RELEASES_URL, APP_STORE_REPOSITORY } from '../constants/autoupdater'
import { findOldestVersion, getReleaseOS } from './utils'
import { SYNC_CLIENT_TYPE } from '@sync-in-desktop/core/components/constants/auth'

export class UpdateManager {
  private customFeedUrlWasChecked = false
  private networkIsOnline = true
  private logger: Logger = getLogger('UpdateManager')
  private checkInterval = 3600 * 8 * 1000 // 8 hours

  constructor() {
    autoUpdater.requestHeaders = { 'User-Agent': USER_AGENT }
    autoUpdater.autoRunAppAfterInstall = true
    autoUpdater.autoInstallOnAppQuit = true
    if (autoUpdater.isUpdaterActive()) {
      this.listeners()
    } else {
      this.logger.info('skip checkForUpdates for no packaged or portable app')
    }
  }

  private listeners() {
    appEvents.on(REMOTE_RENDERER.MISC.NETWORK_IS_ONLINE, (state: boolean) => (this.networkIsOnline = state))
    appEvents.on(LOCAL_RENDERER.UPDATE.CHECK, async () => await this.checkForUpdates(true))
    ipcMain.on(LOCAL_RENDERER.UPDATE.RESTART, () => this.quitAndInstall())
    autoUpdater.on('checking-for-update', () => this.logger.info('checking for update'))
    autoUpdater.on('update-available', () => this.logger.info('update available'))
    autoUpdater.on('update-downloaded', () => this.updateDownloaded())
    autoUpdater.on('download-progress', (progress) => this.downloadProgress(progress))
    autoUpdater.on('error', (error) => this.logger.error(error))
    setTimeout(async () => await this.checkForUpdates(), 30000)
    setInterval(async () => await this.checkForUpdates(), this.checkInterval)
  }

  private async checkForUpdates(userCheck = false) {
    if (this.networkIsOnline) {
      if (!this.customFeedUrlWasChecked) {
        await this.checkAndSetFeedUrl()
      }
      try {
        const r = await autoUpdater.checkForUpdatesAndNotify({
          title: i18n.tr('A new update is ready !'),
          body: `${ENVIRONMENT.appID} {version} ` + i18n.tr('will be automatically installed on application exit')
        })
        if (userCheck && (!r || !r.downloadPromise)) {
          new Notification({ title: i18n.tr('No new version is available'), body: i18n.tr('You have the latest version'), silent: true }).show()
        }
      } catch (e) {
        this.logger.error(e)
      }
    }
  }

  private downloadProgress(infos: any) {
    appEvents.emit(REMOTE_RENDERER.SYNC.TRANSFER, {
      ok: true,
      side: SIDE.LOCAL,
      action: F_ACTION.NEW,
      file: `/${i18n.tr('Downloading the update')}`,
      progress: { currentSize: toHumanSize(infos.transferred), totalSize: toHumanSize(infos.total), percent: infos.percent }
    })
  }

  private updateDownloaded() {
    this.logger.info('update downloaded')
    appEvents.emit(LOCAL_RENDERER.UPDATE.DOWNLOADED, i18n.tr('Do update'))
  }

  private quitAndInstall() {
    this.logger.info('quit and install')
    appEvents.emit(LOCAL_RENDERER.UPDATE.RESTART)
    setImmediate(() => {
      app.removeAllListeners('window-all-closed')
      autoUpdater.quitAndInstall()
    })
  }

  private async checkAndSetFeedUrl() {
    // check for override the autoupdate feed url
    this.customFeedUrlWasChecked = true
    const serverRepositories: { url: string; version: string }[] = []
    for (const s of ServersManager.list.filter((s) => s.available)) {
      const req = new RequestsManager(s, false)
      try {
        const r = await req.http.get<{ repository: APP_STORE_REPOSITORY; version: string }>(API.APP_STORE)
        if (r.data?.repository === APP_STORE_REPOSITORY.LOCAL) {
          serverRepositories.push({ url: s.url, version: r.data.version })
        }
      } catch (e) {
        this.logger.error(await RequestsManager.handleHttpError(e))
      }
    }
    /*
    In some cases, servers don't have internet access; they may have a local release repository.
    This should be avoided because in case of multiple servers and different client versions it can lead to incompatibilities.
    In this case, it's best to use the oldest version of the repository.
     */
    if (serverRepositories.length) {
      try {
        let serverUrl: string
        if (serverRepositories.length === 1) {
          serverUrl = serverRepositories[0].url
        } else {
          const oldestVersion = findOldestVersion(serverRepositories.map((s) => s.version))
          serverUrl = serverRepositories.find((s) => s.version === oldestVersion).url
        }
        if (serverUrl) {
          const feedUrl = `${serverUrl}/${APP_STORE_RELEASES_URL}/${SYNC_CLIENT_TYPE.DESKTOP}/${getReleaseOS()}`
          this.logger.info(`using server releases repository: ${feedUrl}`)
          autoUpdater.setFeedURL({
            provider: 'generic',
            url: feedUrl
          })
        }
      } catch (e) {
        this.logger.error(e)
      }
    }
  }

  private async debug() {
    // testing checking updates
    await this.checkAndSetFeedUrl()
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.allowPrerelease = true
    autoUpdater.autoDownload = false
    autoUpdater.checkForUpdates().then((r) => console.log(r))
  }
}
