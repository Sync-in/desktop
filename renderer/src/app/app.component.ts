/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { Component, inject, OnInit } from '@angular/core'
import { AppService } from './app.service'
import { LOCAL_RENDERER } from '../../../main/constants/events'
import { L10nTranslateDirective } from 'angular-l10n'
import { FaIconComponent } from '@fortawesome/angular-fontawesome'
import { TopBarComponent } from './components/top-bar.component'
import { BottomBarComponent } from './components/bottom-bar-component'
import { faIcons } from './common/icons'
import type { SyncServer } from '@sync-in-desktop/core/components/interfaces/server.interface'
import { ModalServerComponent } from './components/modal-server.component'
import { SERVER_ACTION } from '@sync-in-desktop/core/components/constants/server'

@Component({
  selector: 'app-root',
  imports: [TopBarComponent, BottomBarComponent, L10nTranslateDirective, FaIconComponent],
  templateUrl: './app.component.html',
  standalone: true
})
export class AppComponent implements OnInit {
  public activeServer = null
  public isRetrying = false
  protected readonly appService = inject(AppService)
  protected icons = faIcons

  constructor() {
    this.appService.activeServer.subscribe((server: SyncServer) => this.setActiveServer(server))
  }

  ngOnInit() {
    this.appService.updateServers()
  }

  retryLoad() {
    if (this.isRetrying) {
      return
    }
    this.isRetrying = true
    this.appService.ipcRenderer.invoke(LOCAL_RENDERER.SERVER.RETRY, this.activeServer.id).then((state: boolean) => {
      this.retryServer(state)
    })
  }

  reAuthenticateOnServer() {
    this.appService.openDialog(ModalServerComponent, {
      initialState: { config: { type: SERVER_ACTION.AUTHENTICATE, server: this.activeServer } } as ModalServerComponent
    })
  }

  private retryServer(state: boolean) {
    if (this.isRetrying) {
      this.isRetrying = false
      this.activeServer.available = state
    }
  }

  private setActiveServer(server: SyncServer) {
    this.activeServer = server
  }
}
