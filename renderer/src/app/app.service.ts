/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */
import { Injectable, NgZone, signal, WritableSignal } from '@angular/core'
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../../../main/constants/events'
import { BehaviorSubject, fromEvent, map, mergeWith, Observable, Subject } from 'rxjs'
import { getBrowserLanguage, L10nTranslationService } from 'angular-l10n'
import { BsLocaleService } from 'ngx-bootstrap/datepicker'
import { getTheme } from './common/functions/utils'
import { dJs } from './common/functions/time'
import type { ElectronIpcRenderer } from './common/interfaces/electron'
import type { SyncServer } from '../../../core/components/interfaces/server.interface'
import { IDownload } from '../../../main/interfaces/download.interface'
import type { SyncTransfer } from '@sync-in-desktop/core/components/interfaces/sync-transfer.interface'
import { THEME } from '../../../main/constants/themes'
import { ModalServerComponent } from './components/modal-server.component'
import { SERVER_ACTION } from '@sync-in-desktop/core/components/constants/server'

declare global {
  interface Window {
    ipcRenderer: ElectronIpcRenderer
  }
}

@Injectable({ providedIn: 'root' })
export class AppService {
  private modalRef: BsModalRef = null
  private readonly modalConfig = { animated: true, keyboard: true, backdrop: true, ignoreBackdropClick: true }
  private readonly modalClass = 'modal-lg modal-primary modal-dialog-centered'
  public ipcRenderer = window.ipcRenderer
  public isMacOS = window.process.platform === 'darwin'
  // Observable Network
  private _networkIsOnline = new BehaviorSubject<boolean>(navigator.onLine)
  public networkIsOnline: Observable<boolean> = this._networkIsOnline
    .asObservable()
    .pipe(mergeWith(fromEvent(window, 'online').pipe(map(() => true)), fromEvent(window, 'offline').pipe(map(() => false))))
  // Observables Windows
  public themeMode: WritableSignal<THEME> = signal(getTheme())
  public isMaximized: WritableSignal<boolean> = signal(false)
  public isFullScreen: WritableSignal<boolean> = signal(false)
  // Observables Servers
  public allServers = new BehaviorSubject<SyncServer[]>([])
  public activeServer = new BehaviorSubject<SyncServer>({
    id: 0,
    name: this.translation.translate('No server configured'),
    url: null,
    available: true,
    authTokenExpired: false
  })
  // Observables Downloads
  public downloadProgress = new BehaviorSubject<any>({})
  public downloadGlobalProgress = new BehaviorSubject<any>({})
  // Observables Syncs
  public syncTransfer = new Subject<SyncTransfer>()
  // Observables Servers Applications Notifications/Counters
  public serversAppsCounter = new BehaviorSubject<any[]>([])
  // Observable AutoUpdate
  public updateDownloaded: Subject<string> = new Subject<string>()

  constructor(
    private readonly ngZone: NgZone,
    private readonly translation: L10nTranslationService,
    private readonly bsLocale: BsLocaleService,
    private readonly bsModal: BsModalService
  ) {
    this.setLanguage()
    this.networkIsOnline.subscribe((state: boolean) => this.ipcRenderer.send(REMOTE_RENDERER.MISC.NETWORK_IS_ONLINE, state))
    this.ipcRenderer.on(REMOTE_RENDERER.MISC.SWITCH_THEME, (_e: Event, theme: THEME) => this.themeMode.set(theme))
    this.ipcRenderer.on(LOCAL_RENDERER.SERVER.LIST, (_e: Event, servers: SyncServer[]) => this.ngZone.run(() => this.allServers.next(servers)))
    this.ipcRenderer.on(LOCAL_RENDERER.SERVER.SET_ACTIVE, (_e: Event, server: SyncServer) => this.ngZone.run(() => this.activeServer.next(server)))
    this.ipcRenderer.on(LOCAL_RENDERER.WINDOW.IS_MAXIMIZED, (_e: Event, state) => this.isMaximized.set(state))
    this.ipcRenderer.on(LOCAL_RENDERER.WINDOW.IS_FULLSCREEN, (_e: Event, state) => this.isFullScreen.set(state))
    this.ipcRenderer.on(LOCAL_RENDERER.DOWNLOAD.PROGRESS, (_e: Event, item: IDownload) => this.ngZone.run(() => this.downloadProgress.next(item)))
    this.ipcRenderer.on(LOCAL_RENDERER.DOWNLOAD.GLOBAL_PROGRESS, (_e: Event, item) => this.ngZone.run(() => this.downloadGlobalProgress.next(item)))
    this.ipcRenderer.on(REMOTE_RENDERER.APPLICATIONS.COUNTER, (_e: Event, counter) => this.ngZone.run(() => this.serversAppsCounter.next(counter)))
    this.ipcRenderer.on(REMOTE_RENDERER.SYNC.TRANSFER, (_e: Event, transfer: SyncTransfer) => this.ngZone.run(() => this.syncTransfer.next(transfer)))
    this.ipcRenderer.on(LOCAL_RENDERER.UPDATE.DOWNLOADED, (_e: Event, msg: string) => this.ngZone.run(() => this.updateDownloaded.next(msg)))
    this.ipcRenderer.on(LOCAL_RENDERER.UI.MODAL_TOGGLE, () => this.ngZone.run(() => this.openDialog()))
    this.bsModal.onHide.subscribe(() => this.onHide())
  }

  setLanguage(language?: string) {
    if (!language) {
      language = getBrowserLanguage('language') || ''
      language = language.split('-')[0]
    }
    if (language && language !== this.translation.getLocale().language) {
      this.translation.setLocale({ language }).then(() => {
        dJs.locale(language)
        this.bsLocale.use(language)
      })
    }
  }

  openDialog(dialog?: any, componentStates: any = {}) {
    if (this.modalRef !== null) {
      return
    }
    if (dialog) {
      this.ipcRenderer.send(LOCAL_RENDERER.UI.MODAL_TOGGLE, true)
      this.modalRef = this.bsModal.show(dialog, Object.assign(componentStates, this.modalConfig, { class: this.modalClass }))
    } else {
      this.modalRef = this.bsModal.show(
        ModalServerComponent,
        Object.assign(
          {
            initialState: { config: { type: SERVER_ACTION.ADD, server: null } } as ModalServerComponent
          },
          this.modalConfig,
          { class: this.modalClass }
        )
      )
    }
  }

  closeDialog() {
    this.modalRef?.hide()
  }

  updateServers() {
    this.ipcRenderer.send(LOCAL_RENDERER.SERVER.LIST)
  }

  setActiveServer(server: SyncServer) {
    this.activeServer.next(server)
  }

  updateApp() {
    this.ipcRenderer.send(LOCAL_RENDERER.UPDATE.RESTART)
  }

  onHide() {
    this.modalRef = null
    this.ipcRenderer.send(LOCAL_RENDERER.UI.MODAL_TOGGLE, false)
  }
}
