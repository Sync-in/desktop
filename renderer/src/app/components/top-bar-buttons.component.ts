/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { Component, inject } from '@angular/core'
import { AppService } from '../app.service'
import { LOCAL_RENDERER } from '../../../../main/constants/events'

@Component({
  selector: 'app-top-bar-buttons',
  template: `@if (!appService.isMacOS) {
    <div>
      <div class="topBar-buttons">
        <div class="button min-button" (click)="onMinimize()"><img src="assets/top-bar/chrome-minimize.svg" alt="" /></div>
        @if (appService.isMaximized() || appService.isFullScreen()) {
          <div class="button restore-button" (click)="onUnMaximize()"><img src="assets/top-bar/chrome-restore.svg" alt="" /></div>
        } @else {
          <div class="button max-button" (click)="onMaximize()"><img src="assets/top-bar/chrome-maximize.svg" alt="" /></div>
        }
        <div class="button close-button" (click)="onClose()"><img src="assets/top-bar/chrome-close.svg" alt="" /></div>
      </div>
    </div>
  }`,
  standalone: true
})
export class TopBarButtonsComponent {
  protected readonly appService = inject(AppService)

  onMinimize() {
    this.appService.ipcRenderer.send(LOCAL_RENDERER.WINDOW.MINIMIZE)
  }

  onMaximize() {
    this.appService.ipcRenderer.send(LOCAL_RENDERER.WINDOW.MAXIMIZE)
  }

  onUnMaximize() {
    this.appService.ipcRenderer.send(LOCAL_RENDERER.WINDOW.UNMAXIMIZE)
  }

  onClose() {
    this.appService.ipcRenderer.send(LOCAL_RENDERER.WINDOW.CLOSE)
  }
}
