import { Component, computed, inject, ViewChild } from '@angular/core'
import { AppService } from '../app.service'
import { BsDropdownDirective, BsDropdownMenuDirective, BsDropdownToggleDirective } from 'ngx-bootstrap/dropdown'
import { LOCAL_RENDERER } from '../../../../main/constants/events'
import { stopEventPropagation } from '../common/functions/utils'
import { TopBarButtonsComponent } from './top-bar-buttons.component'
import { L10nTranslateDirective } from 'angular-l10n'
import {
  LucideBell,
  LucideChevronDown,
  LucideCircle,
  LucideDynamicIcon,
  LucideEllipsisVertical,
  LucideFlag,
  LucidePencil,
  LucidePlus,
  LucideRefreshCw,
  LucideRotateCw,
  LucideRss,
  LucideServer,
  LucideTrash,
  LucideTriangleExclamationPoint
} from '@lucide/angular'
import { SyncServer } from '../../../../core/components/interfaces/server.interface'
import { SERVER_ACTION } from '../../../../core/components/constants/server'
import { ModalServerComponent } from './modal-server.component'

@Component({
  selector: 'app-top-bar-component',
  templateUrl: './top-bar.component.html',
  imports: [
    TopBarButtonsComponent,
    BsDropdownDirective,
    BsDropdownToggleDirective,
    L10nTranslateDirective,
    BsDropdownMenuDirective,
    LucideDynamicIcon
  ],
  standalone: true
})
export class TopBarComponent {
  @ViewChild(BsDropdownDirective, { static: true }) dropDownServer: BsDropdownDirective
  protected readonly appService = inject(AppService)
  protected readonly icons = {
    LucideBell,
    LucideChevronDown,
    LucideCircle,
    LucideEllipsisVertical,
    LucideFlag,
    LucidePencil,
    LucidePlus,
    LucideRefreshCw,
    LucideRotateCw,
    LucideRss,
    LucideServer,
    LucideTrash,
    LucideTriangleExclamationPoint
  }
  protected hoverIndex = null
  protected readonly serversAppsCounter = computed(() =>
    this.appService
      .serversAppsCounter()
      .filter((server) => server.id !== this.appService.activeServer().id && Object.values<number>(server.applications).some((count) => count > 0))
  )
  private readonly appMenuFocusSource = Symbol('app-menu')
  private readonly serverDropdownFocusSource = Symbol('server-dropdown')

  onDropDownState(toTopView: boolean) {
    this.appService.setTopViewFocus(this.serverDropdownFocusSource, toTopView)
  }

  onAppMenuFocus(toTopView: boolean) {
    this.appService.setTopViewFocus(this.appMenuFocusSource, toTopView)
  }

  onAppMenu() {
    this.appService.ipcRenderer.send(LOCAL_RENDERER.UI.APP_MENU_OPEN)
  }

  onActiveServer(_ev: Event, id: number) {
    if (id !== this.appService.activeServer().id) {
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

  protected serverStatusClass(server: SyncServer & { authToken?: string }) {
    if (!server.available) {
      return 'text-danger'
    }
    if (server.authTokenExpired || !server.authToken) {
      return 'text-warning'
    }
    return 'text-primary'
  }

  private findServerByID(id: number): SyncServer {
    return this.appService.allServers().find((server) => server.id === id)
  }
}
