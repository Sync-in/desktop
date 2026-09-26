import { Component, inject, type OnDestroy } from '@angular/core'
import { AppService } from '../app.service'
import { ProgressbarComponent } from 'ngx-bootstrap/progressbar'
import type { LucideIcon } from '@lucide/angular'
import {
  LucideArrowDown,
  LucideArrowUp,
  LucideCircleAlert,
  LucideCopy,
  LucideDynamicIcon,
  LucideMove,
  LucidePencil,
  LucidePlus,
  LucideX
} from '@lucide/angular'
import type { SyncTransfer } from '@sync-in-desktop/core/components/interfaces/sync-transfer.interface'
import type { Subscription } from 'rxjs'

const sideIcon: Record<string, LucideIcon> = {
  local: LucideArrowDown,
  remote: LucideArrowUp
}

const sideIconClass: Record<string, string> = {
  local: 'circle-purple-icon',
  remote: 'circle-primary-icon'
}

const iconActions: Record<string, LucideIcon> = {
  NEW: LucidePlus,
  MKDIR: LucidePlus,
  MKFILE: LucidePlus,
  RM: LucideX,
  RMDIR: LucideX,
  DIFF: LucidePencil,
  COPY: LucideCopy,
  MOVE: LucideMove,
  ERROR: LucideCircleAlert
}

@Component({
  selector: 'app-bottom-bar-syncs',
  templateUrl: 'bottom-bar-syncs-component.html',
  imports: [ProgressbarComponent, LucideDynamicIcon],
  standalone: true
})
export class BottomBarSyncsComponent implements OnDestroy {
  public transfer: { name: string; sideIcon: LucideIcon; sideIconClass: string; actionIcon: LucideIcon; ok: boolean } = null
  public transferProgress: { currentSize: string; totalSize: string; percent: number } = null
  protected readonly appService = inject(AppService)
  private readonly syncTransferSubscription: Subscription
  private clearTransferTimer: ReturnType<typeof setTimeout> = null

  constructor() {
    this.syncTransferSubscription = this.appService.syncTransfer.subscribe((transfer: SyncTransfer | null) => this.setTransfer(transfer))
  }

  ngOnDestroy() {
    this.syncTransferSubscription.unsubscribe()
    this.cancelClearTransfer()
  }

  private setTransfer(tr: SyncTransfer | null) {
    if (tr) {
      this.cancelClearTransfer()
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
      } else {
        this.transferProgress = null
      }
    } else {
      this.cancelClearTransfer()
      this.clearTransferTimer = setTimeout(() => {
        this.transfer = null
        this.transferProgress = null
        this.clearTransferTimer = null
      }, 3000)
    }
  }

  private cancelClearTransfer() {
    if (this.clearTransferTimer) {
      clearTimeout(this.clearTransferTimer)
      this.clearTransferTimer = null
    }
  }
}
