/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { Component, inject } from '@angular/core'
import { stopEventPropagation } from '../common/functions/utils'
import { AppService } from '../app.service'
import { LOCAL_RENDERER } from '../../../../main/constants/events'
import { ProgressbarComponent } from 'ngx-bootstrap/progressbar'
import { BsDropdownDirective, BsDropdownMenuDirective, BsDropdownToggleDirective } from 'ngx-bootstrap/dropdown'
import { TimeDurationPipe } from '../common/pipes/time-duration.pipe'
import { FaIconComponent } from '@fortawesome/angular-fontawesome'
import { faIcons } from '../common/icons'
import { IDownload } from '../../../../main/interfaces/download.interface'
import { DOWNLOAD_ACTION, DOWNLOAD_STATE } from '../../../../main/constants/downloads'

@Component({
  selector: 'app-bottom-bar-downloads',
  templateUrl: 'bottom-bar-downloads.component.html',
  imports: [ProgressbarComponent, BsDropdownDirective, BsDropdownToggleDirective, TimeDurationPipe, BsDropdownMenuDirective, FaIconComponent],
  standalone: true
})
export class BottomBarDownloadsComponent {
  protected readonly appService = inject(AppService)
  protected readonly DOWNLOAD_STATE = DOWNLOAD_STATE
  protected readonly icons = faIcons
  protected downloads: IDownload[] = []
  protected dropdownView: any = {}
  protected activeDownloads: IDownload[] = []
  private globalProgress: IDownload

  constructor() {
    this.appService.ipcRenderer.invoke(LOCAL_RENDERER.DOWNLOAD.LIST).then((items: any[]) => this.setDownloads(items))
    this.appService.downloadGlobalProgress.subscribe((item: IDownload) => (this.globalProgress = item))
    this.appService.downloadProgress.subscribe((item: IDownload) => this.setDownloadProgress(item))
  }

  onDropDownState(toTopView: boolean) {
    this.appService.ipcRenderer.send(LOCAL_RENDERER.UI.TOP_VIEW_FOCUS, toTopView)
  }

  onPause(ev: Event, id: string) {
    stopEventPropagation(ev)
    this.appService.ipcRenderer.invoke(LOCAL_RENDERER.DOWNLOAD.ACTION, id, DOWNLOAD_ACTION.PAUSE).catch((e: Error) => console.error(e))
  }

  onCancel(ev: Event, id: string) {
    stopEventPropagation(ev)
    this.appService.ipcRenderer.invoke(LOCAL_RENDERER.DOWNLOAD.ACTION, id, DOWNLOAD_ACTION.CANCEL).catch((e: Error) => console.error(e))
  }

  onOpen(_ev: Event, id: string) {
    this.appService.ipcRenderer.invoke(LOCAL_RENDERER.DOWNLOAD.ACTION, id, DOWNLOAD_ACTION.OPEN).catch((e: Error) => console.error(e))
  }

  onRemove(ev: Event, id: string) {
    stopEventPropagation(ev)
    this.activeDownloads = this.activeDownloads.filter((d) => d.id !== id)
    if (this.dropdownView.id === id) {
      this.dropdownView = {}
    }
    this.appService.ipcRenderer
      .invoke(LOCAL_RENDERER.DOWNLOAD.ACTION, id, DOWNLOAD_ACTION.REMOVE)
      .then((items: IDownload[]) => {
        this.setDownloads(items)
        // fix focus when last element will be removed
        if (!this.downloads.length) {
          this.onDropDownState(false)
        }
      })
      .catch((e: Error) => console.error(e))
  }

  onResume(ev: Event, id: string) {
    stopEventPropagation(ev)
    this.appService.ipcRenderer.invoke(LOCAL_RENDERER.DOWNLOAD.ACTION, id, DOWNLOAD_ACTION.RESUME).catch((e: Error) => console.error(e))
  }

  private setDownloads(items: IDownload[]) {
    this.downloads = items
    this.setDropdownProgress()
  }

  private setDownloadProgress(item: IDownload) {
    // manage update
    let dl = this.downloads.find((dl) => dl.id === item.id)
    if (dl) {
      Object.assign(dl, item)
    } else {
      dl = item
      this.downloads.push(dl)
    }
    // if current dropdown view is the dl in progress
    if (this.dropdownView.id === undefined || this.dropdownView.id === dl.id) {
      Object.assign(this.dropdownView, dl)
    }
    this.setDropdownProgress()
  }

  private setDropdownProgress() {
    this.activeDownloads = this.downloads.filter((dl) => dl.state === this.DOWNLOAD_STATE.PROGRESSING)
    if (this.activeDownloads.length === 0) {
      this.globalProgress.id = '0'
      this.globalProgress.name = `${this.downloads.length}`
      this.globalProgress.state = this.DOWNLOAD_STATE.COMPLETED
      Object.assign(this.dropdownView, this.globalProgress)
    } else if (this.activeDownloads.length === 1) {
      if (this.dropdownView.id !== this.activeDownloads[0].id) {
        Object.assign(this.dropdownView, this.activeDownloads[0])
      }
    } else {
      // multi-downloads
      if (this.globalProgress.state === this.DOWNLOAD_STATE.PROGRESSING) {
        Object.assign(this.dropdownView, this.globalProgress)
      }
    }
  }
}
