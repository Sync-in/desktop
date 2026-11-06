import { Component, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { stopEventPropagation } from '../common/functions/utils'
import { AppService } from '../app.service'
import { LOCAL_RENDERER } from '../../../../main/constants/events'
import { ProgressbarComponent } from 'ngx-bootstrap/progressbar'
import { BsDropdownDirective, BsDropdownMenuDirective, BsDropdownToggleDirective } from 'ngx-bootstrap/dropdown'
import { TimeDurationPipe } from '../common/pipes/time-duration.pipe'
import { LucideDownload, LucideDynamicIcon, LucideFolderOpen, LucidePause, LucidePlay, LucideSquare, LucideX } from '@lucide/angular'
import { IDownload } from '../../../../main/interfaces/download.interface'
import { DOWNLOAD_ACTION, DOWNLOAD_STATE } from '../../../../main/constants/downloads'

@Component({
  selector: 'app-bottom-bar-downloads',
  templateUrl: 'bottom-bar-downloads.component.html',
  imports: [ProgressbarComponent, BsDropdownDirective, BsDropdownToggleDirective, TimeDurationPipe, BsDropdownMenuDirective, LucideDynamicIcon],
  standalone: true
})
export class BottomBarDownloadsComponent {
  protected readonly appService = inject(AppService)
  protected readonly DOWNLOAD_STATE = DOWNLOAD_STATE
  protected readonly icons = { LucideDownload, LucideFolderOpen, LucidePause, LucidePlay, LucideSquare, LucideX }
  protected readonly downloads = signal<IDownload[]>([])
  protected readonly dropdownView = signal<Partial<IDownload>>({})
  protected readonly activeDownloads = signal<IDownload[]>([])
  private readonly topViewFocusSource = Symbol('downloads-dropdown')
  private readonly globalProgress = signal<Partial<IDownload>>({})

  constructor() {
    this.appService.ipcRenderer.invoke(LOCAL_RENDERER.DOWNLOAD.LIST).then((items: IDownload[]) => this.setDownloads(items))
    this.appService.downloadGlobalProgress.pipe(takeUntilDestroyed()).subscribe((item: IDownload) => this.globalProgress.set(item))
    this.appService.downloadProgress.pipe(takeUntilDestroyed()).subscribe((item: IDownload) => this.setDownloadProgress(item))
  }

  onDropDownState(toTopView: boolean) {
    this.appService.setTopViewFocus(this.topViewFocusSource, toTopView)
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
    this.activeDownloads.update((downloads) => downloads.filter((download) => download.id !== id))
    if (this.dropdownView().id === id) {
      this.dropdownView.set({})
    }
    this.appService.ipcRenderer
      .invoke(LOCAL_RENDERER.DOWNLOAD.ACTION, id, DOWNLOAD_ACTION.REMOVE)
      .then((items: IDownload[]) => {
        this.setDownloads(items)
        // fix focus when last element will be removed
        if (!this.downloads().length) {
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
    this.downloads.set(items)
    this.setDropdownProgress()
  }

  private setDownloadProgress(item: IDownload) {
    if (item?.id === undefined) {
      return
    }

    // manage update
    const currentDownloads = this.downloads()
    const existingDownload = currentDownloads.find((download) => download.id === item.id)
    const download = existingDownload ? { ...existingDownload, ...item } : item
    this.downloads.set(
      existingDownload
        ? currentDownloads.map((currentDownload) => (currentDownload.id === download.id ? download : currentDownload))
        : [...currentDownloads, download]
    )
    // if current dropdown view is the dl in progress
    if (this.dropdownView().id === undefined || this.dropdownView().id === download.id) {
      this.dropdownView.update((currentDownload) => ({ ...currentDownload, ...download }))
    }
    this.setDropdownProgress()
  }

  private setDropdownProgress() {
    const downloads = this.downloads()
    const activeDownloads = downloads.filter((download) => download.state === this.DOWNLOAD_STATE.PROGRESSING)
    this.activeDownloads.set(activeDownloads)
    if (activeDownloads.length === 0) {
      const globalProgress = {
        ...this.globalProgress(),
        id: '0',
        name: `${downloads.length}`,
        state: this.DOWNLOAD_STATE.COMPLETED
      }
      this.globalProgress.set(globalProgress)
      this.dropdownView.update((currentDownload) => ({ ...currentDownload, ...globalProgress }))
    } else if (activeDownloads.length === 1) {
      if (this.dropdownView().id !== activeDownloads[0].id) {
        this.dropdownView.set({ ...activeDownloads[0] })
      }
    } else {
      // multi-downloads
      if (this.globalProgress().state === this.DOWNLOAD_STATE.PROGRESSING) {
        this.dropdownView.update((currentDownload) => ({ ...currentDownload, ...this.globalProgress() }))
      }
    }
  }
}
