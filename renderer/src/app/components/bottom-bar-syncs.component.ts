import { Component, inject, type OnDestroy, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { AppService } from '../app.service'
import { ProgressbarComponent } from 'ngx-bootstrap/progressbar'
import type { LucideIcon } from '@lucide/angular'
import {
  LucideArrowDown,
  LucideArrowUp,
  LucideCircleExclamationPoint,
  LucideCopy,
  LucideDynamicIcon,
  LucideMove,
  LucidePencil,
  LucidePlus,
  LucideX
} from '@lucide/angular'
import type { SyncTransfer } from '@sync-in-desktop/core/components/interfaces/sync-transfer.interface'

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
  ERROR: LucideCircleExclamationPoint
}

@Component({
  selector: 'app-bottom-bar-syncs',
  templateUrl: 'bottom-bar-syncs-component.html',
  imports: [ProgressbarComponent, LucideDynamicIcon],
  standalone: true
})
export class BottomBarSyncsComponent implements OnDestroy {
  public readonly transfer = signal<{ name: string; sideIcon: LucideIcon; sideIconClass: string; actionIcon: LucideIcon; ok: boolean } | null>(null)
  public readonly transferProgress = signal<{ currentSize: string; totalSize: string; percent: number } | null>(null)
  protected readonly appService = inject(AppService)
  private clearTransferTimer: ReturnType<typeof setTimeout> = null

  constructor() {
    this.appService.syncTransfer.pipe(takeUntilDestroyed()).subscribe((transfer: SyncTransfer | null) => this.setTransfer(transfer))
  }

  ngOnDestroy() {
    this.cancelClearTransfer()
  }

  private setTransfer(tr: SyncTransfer | null) {
    if (tr) {
      this.cancelClearTransfer()
      this.transfer.set({
        ok: tr.ok,
        name: (tr.fileDst ? tr.fileDst : tr.file).split('/').pop(),
        sideIcon: sideIcon[tr.side],
        sideIconClass: sideIconClass[tr.side],
        actionIcon: tr.ok ? iconActions[tr.action] : iconActions.ERROR
      })
      if (tr.progress) {
        const percent = parseInt(tr.progress.percent)
        if (percent === 100) {
          this.transferProgress.set(null)
          return
        }
        this.transferProgress.set({ currentSize: tr.progress.currentSize, totalSize: tr.progress.totalSize, percent: percent })
      } else {
        this.transferProgress.set(null)
      }
    } else {
      this.cancelClearTransfer()
      this.clearTransferTimer = setTimeout(() => {
        this.transfer.set(null)
        this.transferProgress.set(null)
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
