import { Component, inject, ViewChild } from '@angular/core'
import { AppService } from '../app.service'
import { BsDropdownDirective, BsDropdownMenuDirective, BsDropdownToggleDirective } from 'ngx-bootstrap/dropdown'
import { LOCAL_RENDERER } from '../../../../main/constants/events'
import { stopEventPropagation } from '../common/functions/utils'
import { TopBarButtonsComponent } from './top-bar-buttons.component'
import { L10nTranslateDirective } from 'angular-l10n'
import { faIcons } from '../common/icons'
import { FaIconComponent } from '@fortawesome/angular-fontawesome'
import { SyncServer } from '../../../../core/components/interfaces/server.interface'
import { ServerAppCounter } from '@sync-in-desktop/main/interfaces/counter.interface'
import { SERVER_ACTION } from '../../../../core/components/constants/server'
import { ModalServerComponent } from './modal-server.component'

@Component({
  selector: 'app-top-bar-component',
  templateUrl: './top-bar.component.html',
  imports: [TopBarButtonsComponent, BsDropdownDirective, BsDropdownToggleDirective, L10nTranslateDirective, BsDropdownMenuDirective, FaIconComponent],
  standalone: true
})
export class TopBarComponent {
  @ViewChild(BsDropdownDirective, { static: true }) dropDownServer: BsDropdownDirective
  protected readonly appService = inject(AppService)
  protected readonly icons = faIcons
  protected hoverIndex = null
  protected servers: SyncServer[] = []
  // [{'id': 1, 'name': 'test', 'applications': {'notifications': 2, 'tasks': 4, 'syncs': 1}}, ...]
  protected serversAppsCounter: ServerAppCounter[] = []
  protected activeServer = null
  protected updateDownloaded = null

  constructor() {
    this.appService.allServers.subscribe((servers: SyncServer[]) => (this.servers = servers))
    this.appService.activeServer.subscribe((server: SyncServer) => this.setActiveServer(server))
    this.appService.serversAppsCounter.subscribe((servers: ServerAppCounter[]) => this.setServersAppsCounter(servers))
    this.appService.updateDownloaded.subscribe((msg: string) => (this.updateDownloaded = msg))
  }

  onDropDownState(toTopView: boolean) {
    this.appService.ipcRenderer.send(LOCAL_RENDERER.UI.TOP_VIEW_FOCUS, toTopView)
  }

  onAppMenu() {
    this.appService.ipcRenderer.send(LOCAL_RENDERER.UI.APP_MENU_OPEN)
  }

  onActiveServer(_ev: Event, id: number) {
    if (id !== this.activeServer.id) {
      this.appService.setActiveServer(this.findServerByID(id))
      this.appService.ipcRenderer.send(LOCAL_RENDERER.SERVER.SET_ACTIVE, id)
    }
  }

  openAddServerModal(ev: Event) {
    stopEventPropagation(ev)
    this.dropDownServer.hide()
    this.appService.openDialog(ModalServerComponent, {
      initialState: { config: { type: SERVER_ACTION.ADD, server: null } } as ModalServerComponent
    })
  }

  openEditServerModal(ev: Event, server: SyncServer) {
    stopEventPropagation(ev)
    this.dropDownServer.hide()
    this.appService.openDialog(ModalServerComponent, {
      initialState: { config: { type: SERVER_ACTION.EDIT, server: server } } as ModalServerComponent
    })
  }

  openRemoveServerModal(ev: Event, server: SyncServer) {
    stopEventPropagation(ev)
    this.dropDownServer.hide()
    this.appService.openDialog(ModalServerComponent, {
      initialState: { config: { type: SERVER_ACTION.REMOVE, server: server } } as ModalServerComponent
    })
  }

  onReload(ev: Event, server: SyncServer) {
    stopEventPropagation(ev)
    this.appService.ipcRenderer.send(LOCAL_RENDERER.SERVER.RELOAD, server.id)
  }

  enterMenuItem(i: number) {
    this.hoverIndex = i
  }

  leaveMenuItem() {
    this.hoverIndex = null
  }

  onUpdate() {
    this.appService.updateApp()
  }

  private setActiveServer(server: SyncServer) {
    this.activeServer = server
    this.setServersAppsCounter(this.appService.serversAppsCounter.getValue())
  }

  private setServersAppsCounter(servers: ServerAppCounter[]) {
    const serversAppsCounter = []
    for (const server of servers) {
      if (server.id === this.activeServer.id) {
        continue
      }
      for (const count of Object.values<number>(server.applications)) {
        if (count > 0) {
          serversAppsCounter.push(server)
          break
        }
      }
    }
    this.serversAppsCounter = serversAppsCounter
  }

  private findServerByID(id: number): SyncServer {
    return this.servers.find((server) => server.id === id)
  }
}
