/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { app, DownloadItem, ipcMain, IpcMainInvokeEvent, shell } from 'electron'
import path from 'node:path'
import { i18n } from './translate'
import { bytesToHuman, bytesToUnit, throttleFunc } from './utils'
import { LOCAL_RENDERER } from '../constants/events'
import fs from 'node:fs/promises'
import { NotifyManager } from './notifications'
import { WindowManager } from './windows'
import { appEvents } from './events'
import { DOWNLOAD_ACTION, DOWNLOAD_STATE } from '../constants/downloads'
import { IDownload } from '../interfaces/download.interface'

export class DownloadManager {
  throttledGlobalProgress: (...args: any) => void
  maxDownloads = 10
  downloadItems: (DownloadItem | any)[] = []
  notifyManager: NotifyManager
  windowManager: WindowManager

  constructor(windowManager: WindowManager, notifyManager: NotifyManager) {
    this.throttledGlobalProgress = throttleFunc(this, this.setGlobalProgress, 2000)
    this.notifyManager = notifyManager
    this.windowManager = windowManager
    this.windowManager.mainWindow.webContents.session.on('will-download', (ev: Event, item: DownloadItem) => this.onDownload(ev, item))
    ipcMain.handle(LOCAL_RENDERER.DOWNLOAD.LIST, () => this.sendAllItems())
    ipcMain.handle(LOCAL_RENDERER.DOWNLOAD.ACTION, async (_ev: IpcMainInvokeEvent, downloadId: string, action: DOWNLOAD_ACTION) =>
      this.actionDownload(downloadId, action)
    )
  }

  private onDownload(_ev: Event, item: DownloadItem) {
    appEvents.emit(LOCAL_RENDERER.POWER.PREVENT_APP_SUSPENSION, true)
    this.storeDownload(item).then(() => {
      item.on('updated', (ev: Event, state) => this.updated(item, ev, state))
      item.once('done', (ev: Event, state) => this.done(item, ev, state))
    })
  }

  private async storeDownload(item: DownloadItem | any) {
    const existingItem: any = this.downloadItems.find((dl) => dl.id === item.getETag())
    // reuse existing attributes if item already exists
    if (existingItem) {
      item.id = existingItem.id
      item.name = existingItem.name
      item.icon = existingItem.icon
      this.downloadItems = this.downloadItems.filter((dl) => dl.id !== item.id)
    } else {
      item.id = item.getETag().toString()
      item.name = item.getFilename()
      item.icon = await this.getFileIcon(item.name)
    }
    this.downloadItems.push(item)
    this.sendProgressItem(item, true)
    this.sendAllItems()
  }

  private updated(item: DownloadItem | any, _ev: Event, state: string) {
    item.state = item.isPaused() ? DOWNLOAD_STATE.PAUSED : state
    if (state === DOWNLOAD_STATE.INTERRUPTED) {
      item.pause()
      this.sendProgressItem(item)
    } else if (state === DOWNLOAD_STATE.PROGRESSING) {
      if (item.state !== DOWNLOAD_STATE.PAUSED) {
        this.setProgressItem(item)
      }
      this.sendProgressItem(item)
    }
    this.throttledGlobalProgress(item)
  }

  private done(item: DownloadItem | any, _ev: Event, state: string) {
    item.state = item.isPaused() ? DOWNLOAD_STATE.PAUSED : state
    this.sendProgressItem(item)
    if (item.state === DOWNLOAD_STATE.COMPLETED) {
      this.notifyManager.send(i18n.tr('Download complete'), item.name, () => this.openDownload(item.id))
    }
    this.throttledGlobalProgress(item)
  }

  private sendProgressItem(item: DownloadItem, withIcon = false) {
    this.windowManager.sendtoWrapperRenderer(LOCAL_RENDERER.DOWNLOAD.PROGRESS, this.exportItem(item, withIcon))
  }

  private sendGlobalProgress(item: IDownload) {
    this.windowManager.sendtoWrapperRenderer(LOCAL_RENDERER.DOWNLOAD.GLOBAL_PROGRESS, item)
  }

  private sendAllItems(): IDownload[] {
    if (this.downloadItems.length > this.maxDownloads) {
      // cleanup downloads one by one if limit is reached
      const firstItem = this.downloadItems.find((item) => [DOWNLOAD_STATE.COMPLETED, DOWNLOAD_STATE.CANCELLED].indexOf(item.state) > -1)
      if (firstItem) {
        this.downloadItems.splice(this.downloadItems.indexOf(firstItem), 1)
      }
    }
    const downloads = this.downloadItems.length > this.maxDownloads ? this.downloadItems.slice(0, this.maxDownloads) : this.downloadItems
    return downloads.map((item: DownloadItem): IDownload => this.exportItem(item, true))
  }

  private setProgressItem(item: DownloadItem | any) {
    const receivedBytes = item.getReceivedBytes()
    const totalBytes = item.getTotalBytes()
    const chunksPerTime = (receivedBytes - item.prevReceivedBytes) * 2 // tick is emitted every 500ms
    // Calculate the download speed per second
    item.speed = chunksPerTime
    item.humanSpeed = bytesToHuman(chunksPerTime, true, 2, true)
    const totalHumanSize = bytesToHuman(totalBytes)
    item.humanSize = { done: bytesToUnit(receivedBytes, totalHumanSize.unit), total: totalHumanSize.value, unit: totalHumanSize.unit }
    item.progress = receivedBytes / totalBytes
    item.prevReceivedBytes = receivedBytes
    // Calculate remaining time
    item.timeLeft = Math.round(totalBytes / chunksPerTime)
  }

  private setGlobalProgress(item: DownloadItem | any) {
    const count = this.countInProgress()
    if (count === 1) {
      this.windowManager.mainWindow.setProgressBar(item.progress)
    } else if (count > 1) {
      let receivedBytes = 0
      let totalBytes = 0
      let speed = 0
      let timeLeft = 0
      let progress = 0
      for (const item of this.downloadItems.filter((dl) => dl.state === DOWNLOAD_STATE.PROGRESSING)) {
        receivedBytes += item.getReceivedBytes()
        totalBytes += item.getTotalBytes()
        speed += item.speed
        timeLeft += item.timeLeft
        progress += item.progress
      }
      const totalHumanSize: { unit: string; value: number } = bytesToHuman(totalBytes)
      progress = progress / count
      this.sendGlobalProgress({
        id: '0',
        name: `${count} downloads in progress`,
        state: DOWNLOAD_STATE.PROGRESSING,
        progress: progress,
        humanSpeed: bytesToHuman(speed, true, 2, true),
        humanSize: { done: bytesToUnit(receivedBytes, totalHumanSize.unit), total: totalHumanSize.value, unit: totalHumanSize.unit },
        timeLeft: timeLeft / count
      } satisfies IDownload)
      this.windowManager.mainWindow.setProgressBar(progress)
    } else {
      appEvents.emit(LOCAL_RENDERER.POWER.PREVENT_APP_SUSPENSION, false)
      this.windowManager.mainWindow.setProgressBar(-1)
    }
  }

  private exportItem(item: DownloadItem | any, withIcon = false): IDownload {
    const exported: IDownload = {
      id: item.id,
      name: item.name,
      state: item.state,
      progress: item.progress,
      humanSpeed: item.humanSpeed,
      humanSize: item.humanSize,
      timeLeft: item.timeLeft
    }
    if (withIcon) {
      exported.icon = item.icon
    }
    return exported
  }

  private async actionDownload(downloadId: string, action: DOWNLOAD_ACTION) {
    switch (action) {
      case DOWNLOAD_ACTION.PAUSE:
        return await this.pauseDownload(downloadId)
      case DOWNLOAD_ACTION.CANCEL:
        return await this.cancelDownload(downloadId)
      case DOWNLOAD_ACTION.RESUME:
        return await this.resumeDownload(downloadId)
      case DOWNLOAD_ACTION.REMOVE:
        return await this.removeDownload(downloadId)
      case DOWNLOAD_ACTION.OPEN:
        return await this.openDownload(downloadId)
      default:
        console.error(`unknown action: ${action}`)
    }
  }

  private async openDownload(downloadId: string) {
    const item: DownloadItem = this.findItemByID(downloadId)
    if (item) {
      shell.showItemInFolder(item.getSavePath())
    }
  }

  private async cancelDownload(downloadId: string) {
    const item = this.findItemByID(downloadId)
    if (item) {
      item.cancel()
    }
  }

  private async pauseDownload(downloadId: string) {
    const item = this.findItemByID(downloadId)
    if (item) {
      item.pause()
    }
  }

  private async resumeDownload(downloadId: string) {
    const item = this.findItemByID(downloadId)
    if (item) {
      item.resume()
    }
  }

  private async removeDownload(downloadId: string) {
    const item = this.findItemByID(downloadId)
    if (item) {
      item.cancel()
    }
    this.downloadItems = this.downloadItems.filter((dl) => dl.id !== downloadId)
    return this.sendAllItems()
  }

  private async getFileIcon(fileName: string) {
    const tempFile = path.join(app.getPath('temp'), fileName)
    await fs.writeFile(tempFile, '')
    const icon = await app.getFileIcon(tempFile, { size: 'normal' })
    await fs.unlink(tempFile)
    return icon.toDataURL({ scaleFactor: 2.0 })
  }

  private findItemByID(downloadId: string): DownloadItem {
    return this.downloadItems.find((dl) => dl.id === downloadId)
  }

  private countInProgress(): number {
    return this.downloadItems.filter((dl) => dl.state === DOWNLOAD_STATE.PROGRESSING).length
  }
}
