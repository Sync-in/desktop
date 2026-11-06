import { inject, Injectable, signal } from '@angular/core'
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../../../main/constants/events'
import { BehaviorSubject, fromEvent, map, mergeWith, Observable, Subject } from 'rxjs'
import { L10nTranslationService } from 'angular-l10n'
import { getTheme } from './common/functions/utils'
import type { ElectronIpcRenderer } from './common/interfaces/electron'
import type { SyncServer } from '../../../core/components/interfaces/server.interface'
import { IDownload } from '../../../main/interfaces/download.interface'
import type { SyncTransfer } from '@sync-in-desktop/core/components/interfaces/sync-transfer.interface'
import type { ServerAppCounter } from '@sync-in-desktop/main/interfaces/counter.interface'
import { THEME } from '../../../main/constants/themes'
import { ModalServerComponent } from './components/modal-server.component'
import { SERVER_ACTION } from '@sync-in-desktop/core/components/constants/server'
import { setTheme } from 'ngx-bootstrap/utils'

declare global {
  interface Window {
    ipcRenderer: ElectronIpcRenderer
  }
}

@Injectable({ providedIn: 'root' })
export class AppService {
  public ipcRenderer = window.ipcRenderer
  public isMacOS = window.process.platform === 'darwin'
  // Observables Windows
  public readonly themeMode = signal(getTheme())
  public readonly isMaximized = signal(false)
  public readonly isFullScreen = signal(false)
  // Signals Servers
  public readonly allServers = signal<SyncServer[]>([])
  // Observables Downloads
  public readonly downloadProgress = new Subject<IDownload>()
  public readonly downloadGlobalProgress = new Subject<IDownload>()
  // Observables Syncs
  public readonly syncTransfer = new Subject<SyncTransfer | null>()
  // Signals Servers Applications Notifications/Counters
  public readonly serversAppsCounter = signal<ServerAppCounter[]>([])
  // Signal AutoUpdate
  public readonly updateDownloaded = signal<string | null>(null)
  private readonly translation = inject(L10nTranslationService)
  public readonly activeServer = signal<SyncServer>({
    id: 0,
    name: this.translation.translate('No server configured'),
    url: null,
    available: true,
    allowInvalidCertificate: false,
    authTokenExpired: false
  })
  private readonly bsModal = inject(BsModalService)
  private modalRef: BsModalRef = null
  private readonly modalConfig = { animated: true, keyboard: true, backdrop: true, ignoreBackdropClick: true }
  private readonly modalBaseClass = 'modal-md modal-primary modal-dialog-centered'
  private readonly topViewFocusSources = new Set<symbol>()
  private topViewFocusUpdateQueued = false
  // Observable Network
  private _networkIsOnline = new BehaviorSubject<boolean>(navigator.onLine)
  public networkIsOnline: Observable<boolean> = this._networkIsOnline
    .asObservable()
    .pipe(mergeWith(fromEvent(window, 'online').pipe(map(() => true)), fromEvent(window, 'offline').pipe(map(() => false))))

  constructor() {
    setTheme('bs5')
    this.networkIsOnline.subscribe((state: boolean) => this.ipcRenderer.send(REMOTE_RENDERER.MISC.NETWORK_IS_ONLINE, state))
    this.ipcRenderer.on(REMOTE_RENDERER.MISC.SWITCH_THEME, (_e: Event, theme: THEME) => this.themeMode.set(theme))
    this.ipcRenderer.on(LOCAL_RENDERER.SERVER.LIST, (_e: Event, servers: SyncServer[]) => this.allServers.set(servers))
    this.ipcRenderer.on(LOCAL_RENDERER.SERVER.SET_ACTIVE, (_e: Event, server: SyncServer) => this.activeServer.set(server))
    this.ipcRenderer.on(LOCAL_RENDERER.WINDOW.IS_MAXIMIZED, (_e: Event, state) => this.isMaximized.set(state))
    this.ipcRenderer.on(LOCAL_RENDERER.WINDOW.IS_FULLSCREEN, (_e: Event, state) => this.isFullScreen.set(state))
    this.ipcRenderer.on(LOCAL_RENDERER.DOWNLOAD.PROGRESS, (_e: Event, item: IDownload) => this.downloadProgress.next(item))
    this.ipcRenderer.on(LOCAL_RENDERER.DOWNLOAD.GLOBAL_PROGRESS, (_e: Event, item: IDownload) => this.downloadGlobalProgress.next(item))
    this.ipcRenderer.on(REMOTE_RENDERER.APPLICATIONS.COUNTER, (_e: Event, counter: ServerAppCounter[]) => this.serversAppsCounter.set(counter))
    this.ipcRenderer.on(REMOTE_RENDERER.SYNC.TRANSFER, (_e: Event, transfer: SyncTransfer | null) => this.syncTransfer.next(transfer))
    this.ipcRenderer.on(LOCAL_RENDERER.UPDATE.DOWNLOADED, (_e: Event, msg: string) => this.updateDownloaded.set(msg))
    this.ipcRenderer.on(LOCAL_RENDERER.UI.MODAL_TOGGLE, () => this.openDialog())
    this.bsModal.onHide.subscribe(() => this.onHide())
  }

  openDialog(dialog?: any, componentStates: any = {}) {
    if (this.modalRef !== null) {
      return
    }
    if (dialog) {
      this.ipcRenderer.send(LOCAL_RENDERER.UI.MODAL_TOGGLE, true)
      this.modalRef = this.bsModal.show(dialog, Object.assign(componentStates, this.modalConfig, { class: this.getModalClass() }))
    } else {
      this.modalRef = this.bsModal.show(
        ModalServerComponent,
        Object.assign(
          {
            initialState: { config: { type: SERVER_ACTION.ADD, server: null } } as ModalServerComponent
          },
          this.modalConfig,
          { class: this.getModalClass() }
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
    this.activeServer.set(server)
  }

  setTopViewFocus(source: symbol, enabled: boolean) {
    if (enabled) {
      this.topViewFocusSources.add(source)
    } else {
      this.topViewFocusSources.delete(source)
    }

    if (this.topViewFocusUpdateQueued) {
      return
    }

    this.topViewFocusUpdateQueued = true
    queueMicrotask(() => {
      this.topViewFocusUpdateQueued = false
      this.ipcRenderer.send(LOCAL_RENDERER.UI.TOP_VIEW_FOCUS, this.topViewFocusSources.size > 0)
    })
  }

  updateApp() {
    this.ipcRenderer.send(LOCAL_RENDERER.UPDATE.RESTART)
  }

  onHide() {
    this.modalRef = null
    this.ipcRenderer.send(LOCAL_RENDERER.UI.MODAL_TOGGLE, false)
  }

  private getModalClass() {
    return `${this.modalBaseClass} ${this.themeMode()}`
  }
}
