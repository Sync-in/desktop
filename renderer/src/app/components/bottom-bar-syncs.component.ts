/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { Component } from '@angular/core'
import { AppService } from '../app.service'
import { ProgressbarComponent } from 'ngx-bootstrap/progressbar'
import { faIcons } from '../common/icons'
import { FaIconComponent, IconDefinition } from '@fortawesome/angular-fontawesome'
import type { SyncTransfer } from '@sync-in-desktop/core/components/interfaces/sync-transfer.interface'

const sideIcon: Record<string, IconDefinition> = {
  local: faIcons.faArrowDown,
  remote: faIcons.faArrowUp
}

const sideIconClass: Record<string, string> = {
  local: 'circle-purple-icon',
  remote: 'circle-primary-icon'
}

const iconActions: Record<string, IconDefinition> = {
  NEW: faIcons.faPlus,
  MKDIR: faIcons.faPlus,
  MKFILE: faIcons.faPlus,
  RM: faIcons.faXmark,
  RMDIR: faIcons.faXmark,
  DIFF: faIcons.faPencil,
  COPY: faIcons.faCopy,
  MOVE: faIcons.faUpDownLeftRight,
  ERROR: faIcons.faCircleExclamation
}

@Component({
  selector: 'app-bottom-bar-syncs',
  templateUrl: 'bottom-bar-syncs-component.html',
  imports: [ProgressbarComponent, FaIconComponent],
  standalone: true
})
export class BottomBarSyncsComponent {
  public transfer: { name: string; sideIcon: IconDefinition; sideIconClass: string; actionIcon: IconDefinition; ok: boolean } = null
  public transferProgress: { currentSize: string; totalSize: string; percent: number } = null

  constructor(private appService: AppService) {
    this.appService.syncTransfer.subscribe((transfer: SyncTransfer) => this.setTransfer(transfer))
  }

  private setTransfer(tr: SyncTransfer) {
    if (tr) {
      this.transfer = {
        ok: tr.ok,
        name: (tr.fileDst ? tr.fileDst : tr.file).split('/').pop(),
        sideIcon: sideIcon[tr.side],
        sideIconClass: sideIconClass[tr.side],
        actionIcon: tr.ok ? iconActions[tr.action] : iconActions.ERROR
      }
      if (tr.progress) {
        const percent = parseInt(tr.progress.percent)
        if (percent === 100) {
          this.transferProgress = null
          return
        }
        this.transferProgress = { currentSize: tr.progress.currentSize, totalSize: tr.progress.totalSize, percent: percent }
      }
    } else {
      setTimeout(() => (this.transfer = null), 3000)
    }
  }
}
