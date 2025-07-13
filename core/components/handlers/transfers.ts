/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { CORE, coreEvents } from './events'
import { F_ACTION, SIDE, SYMBOLS, TRANSFER_MIN_SIZE } from '../constants/handlers'
import { currentTimeStamp, fileBaseName, streamStdout, toHumanSize, toHumanTime } from '../utils/functions'
import { setTimeout } from 'timers/promises'
import { EventEmitter } from 'events'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../../../main/constants/events'
import { Logger } from 'winston'
import { getLogger, LOG_LEVEL_REPORT, LOG_LEVEL_SYNC, LOG_MODULE_REPORT, LOG_MODULE_SYNC } from './loggers'
import { setMimeType, throttleFunc } from '../../../main/components/utils'
import type { SyncTransfer, SyncTransferContext } from '../interfaces/sync-transfer.interface'

export class TransferProgress {
  tasks: { count: number; done: number }
  appEvent: EventEmitter
  ok = true
  file: string
  name: string
  isDir = false
  side: SIDE.LOCAL | SIDE.REMOTE
  action: F_ACTION
  mime?: string
  totalSize: number
  currentSize = 0
  transferredSize = 0
  startTime: number
  speed = 1
  percent: string
  humanTotalSize: string
  humanCurrentSize: string
  humanSpeed: string
  humanRemainingTime: string

  constructor(
    file: string,
    side: SIDE.LOCAL | SIDE.REMOTE,
    action: F_ACTION,
    totalSize: number,
    tasks: {
      count: number
      done: number
    },
    appEvent: EventEmitter = null
  ) {
    this.file = file
    this.name = fileBaseName(file)
    this.side = side
    this.action = action
    this.startTime = currentTimeStamp()
    this.totalSize = totalSize
    this.humanTotalSize = toHumanSize(totalSize)
    this.tasks = tasks
    this.appEvent = appEvent
  }

  updateStatus(): boolean {
    const done = this.calc()
    this.show()
    return done
  }

  update(chunkSize: number) {
    this.currentSize += chunkSize
    this.transferredSize += chunkSize
  }

  export() {
    return {
      ok: this.ok,
      side: this.side,
      action: this.action,
      file: this.file,
      name: this.name,
      isDir: this.isDir,
      progress: { currentSize: this.humanCurrentSize, totalSize: this.humanTotalSize, percent: this.percent }
    } satisfies SyncTransfer
  }

  private calc() {
    this.percent = (100 * (this.currentSize / this.totalSize)).toFixed(2)
    this.speed = (this.speed + this.transferredSize / (currentTimeStamp() - this.startTime)) / 2
    if (this.speed === Infinity || !Math.floor(this.speed)) this.speed = 1
    this.humanRemainingTime = toHumanTime(Math.floor((this.totalSize - this.currentSize) / this.speed))
    this.humanCurrentSize = toHumanSize(this.currentSize)
    this.humanSpeed = `${toHumanSize(this.speed)}/s`
    return this.currentSize === this.totalSize
  }

  private show() {
    if (this.appEvent) {
      this.appEvent.emit(REMOTE_RENDERER.SYNC.TRANSFER, this.export())
    }
    streamStdout(
      `[${this.tasks.done}/${this.tasks.count}]${SYMBOLS[this.side]} ${this.action} ${this.name} ` +
        `[${this.percent}%][${this.humanCurrentSize}/${this.humanTotalSize}][${this.humanSpeed}][${this.humanRemainingTime}]`
    )
  }
}

export class TransfersManager {
  private throttleTimer = 500
  private readonly logLevel: string
  private readonly reportOnly: boolean
  private readonly appEvents: EventEmitter
  public readonly logger: Logger
  private readonly sync: SyncTransferContext
  public tasks = { count: 0, done: 0 }
  private store: TransferProgress[] = []
  private watching = false
  private sendSyncEventDone: (...args) => void
  private sendTaskEventDone: () => void

  constructor(sync: SyncTransferContext, appEvents: EventEmitter = null, reportOnly = false) {
    this.sync = sync
    this.appEvents = appEvents
    this.reportOnly = reportOnly
    this.logLevel = reportOnly ? LOG_LEVEL_REPORT : LOG_LEVEL_SYNC
    this.logger = getLogger(this.reportOnly ? LOG_MODULE_REPORT : LOG_MODULE_SYNC, sync, !reportOnly && !!this.appEvents)
    this.listenersAndEmitters()
  }

  private listenersAndEmitters() {
    this.updateTaskCount = this.updateTaskCount.bind(this)
    coreEvents.on(CORE.TASKS_COUNT, this.updateTaskCount)
    if (this.appEvents) {
      this.sendSyncEventDone = throttleFunc(this, (tr: SyncTransfer) => this.appEvents.emit(REMOTE_RENDERER.SYNC.TRANSFER, tr), this.throttleTimer)
      this.sendTaskEventDone = throttleFunc(
        this,
        () =>
          this.appEvents.emit(REMOTE_RENDERER.SYNC.TASKS_COUNT, {
            serverId: this.sync.server.id,
            syncPathId: this.sync.path.id,
            nbTasks: this.tasks.count - this.tasks.done
          }),
        this.throttleTimer
      )
    }
  }

  private updateTaskCount(sync: { serverId: number; syncPathId: number }, count = 1) {
    if (this.sync.server.id === sync.serverId && this.sync.path.id === sync.syncPathId) {
      this.tasks.count += count
    }
  }

  private async start() {
    while (this.watching) {
      for (const tp of [...this.store]) {
        if (tp.updateStatus()) {
          this.store.splice(this.store.indexOf(tp), 1)
        }
      }
      await setTimeout(this.throttleTimer)
    }
  }

  stop() {
    if (this.appEvents && this.tasks.count) {
      // send empty transfer to renderer
      this.sendSyncEventDone(null)
    }
    this.watching = false
    this.removeListeners()
  }

  done(tr: SyncTransfer) {
    this.tasks.done++
    streamStdout()
    this.logger[tr.ok ? this.logLevel : 'error']({ tasks: this.tasks, tr: tr })
    this.sendEvent('tasks')
    this.sendEvent('sync', tr)
    if (this.tasks.count === this.tasks.done && tr.ok) {
      // send notification to app
      this.sendEvent('notification')
    }
  }

  add(filePath: string, side: SIDE.LOCAL | SIDE.REMOTE, action: F_ACTION, totalSize: number): TransferProgress {
    if (!this.watching) {
      this.watching = true
      this.start().then()
    }
    if (totalSize >= TRANSFER_MIN_SIZE) {
      const tp = new TransferProgress(filePath, side, action, totalSize, this.tasks, this.appEvents)
      this.store.push(tp)
      return tp
    }
    return null
  }

  private sendEvent(type: string, tr?: SyncTransfer) {
    if (this.appEvents) {
      if (type === 'tasks') {
        this.sendTaskEventDone()
      } else if (type === 'sync') {
        if (this.reportOnly) {
          this.appEvents.emit(REMOTE_RENDERER.SYNC.REPORT_TRANSFER, {
            serverId: this.sync.server.id,
            syncPathId: this.sync.path.id,
            nbTasks: this.tasks.done,
            ...setMimeType(tr)
          })
        } else if (!this.store.length) {
          this.sendSyncEventDone(tr)
        }
      } else if (type === 'notification' && !this.reportOnly) {
        this.appEvents.emit(LOCAL_RENDERER.SYNC.MSG, {
          title: `${this.sync.server.name} - ${this.sync.path.name}`,
          body: this.tasks.done === 1 ? 'element synchronized' : 'elements synchronized',
          nb: this.tasks.done
        })
      }
    }
  }

  private removeListeners() {
    coreEvents.removeListener(CORE.TASKS_COUNT, this.updateTaskCount)
  }
}
