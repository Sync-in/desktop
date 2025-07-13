/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */
import { setTimeout } from 'timers/promises'
import { DiffParser } from './diff'
import { F_ACTION, F_STAT, SIDE, SYMBOLS } from '../constants/handlers'
import { TransfersManager } from './transfers'
import { EventEmitter } from 'events'
import { Logger } from 'winston'
import { SIDE_STATE } from '../constants/diff'

export class Report {
  public logger: Logger
  private readonly transfers: TransfersManager
  private readonly diff: DiffParser
  private nbMoveTasks = 0
  private mustStop = false

  constructor(diff: DiffParser, logger: Logger, appEvents: EventEmitter = null) {
    this.diff = diff
    this.logger = logger
    this.transfers = new TransfersManager({ server: this.diff.fParser.req.server.identity(), path: this.diff.syncPath.identity() }, appEvents, true)
  }

  async run(): Promise<void> {
    for await (const [state, filePaths] of this.diff.run()) {
      if (this.mustStop) {
        this.logger.warn('Aborted')
        break
      }
      await this.waitForMoves(state, filePaths)
      try {
        switch (state) {
          case SIDE_STATE.UPLOAD:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.REMOTE, this.diff.fParser.curSnap.local, filePaths)) {
              this.transfers.done({
                ok: ok,
                side: SIDE.REMOTE,
                action: F_ACTION.NEW,
                file: f,
                isDir: false,
                error: error
              })
            }
            break
          case SIDE_STATE.UPLOAD_DIFF:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.REMOTE, this.diff.fParser.curSnap.local, filePaths)) {
              this.transfers.done({
                ok: ok,
                side: SIDE.REMOTE,
                action: F_ACTION.DIFF,
                file: f,
                isDir: false,
                error: error
              })
            }
            break
          case SIDE_STATE.DOWNLOAD:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.LOCAL, this.diff.fParser.curSnap.remote, filePaths)) {
              this.transfers.done({
                ok: ok,
                side: SIDE.LOCAL,
                action: F_ACTION.NEW,
                file: f,
                isDir: false,
                error: error
              })
            }
            break
          case SIDE_STATE.DOWNLOAD_DIFF:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.LOCAL, this.diff.fParser.curSnap.remote, filePaths)) {
              this.transfers.done({
                ok: ok,
                side: SIDE.LOCAL,
                action: F_ACTION.DIFF,
                file: f,
                isDir: false,
                error: error
              })
            }
            break
          case SIDE_STATE.REMOTE_MOVE:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.REMOTE, this.diff.fParser.curSnap.remote, filePaths, 'src')) {
              this.transfers.done({
                ok: ok,
                side: SIDE.REMOTE,
                action: F_ACTION.MOVE,
                file: f.src,
                fileDst: f.dst,
                isDir: ok ? this.diff.fParser.curSnap.remote.get(f.src)[F_STAT.IS_DIR] : false,
                error: error
              })
            }
            break
          case SIDE_STATE.LOCAL_MOVE:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.LOCAL, this.diff.fParser.curSnap.local, filePaths, 'src')) {
              this.transfers.done({
                ok: ok,
                side: SIDE.LOCAL,
                action: F_ACTION.MOVE,
                file: f.src,
                fileDst: f.dst,
                isDir: ok ? this.diff.fParser.curSnap.local.get(f.src)[F_STAT.IS_DIR] : false,
                error: error
              })
            }
            break
          case SIDE_STATE.REMOTE_MK:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.REMOTE, this.diff.fParser.curSnap.local, filePaths, 'path')) {
              this.transfers.done({
                ok: ok,
                side: SIDE.REMOTE,
                action: `${f.isDir ? F_ACTION.MKDIR : F_ACTION.MKFILE}` as F_ACTION,
                file: f.path,
                isDir: ok ? this.diff.fParser.curSnap.local.get(f.path)[F_STAT.IS_DIR] : false,
                error: error
              })
            }
            break
          case SIDE_STATE.LOCAL_MK:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.LOCAL, this.diff.fParser.curSnap.remote, filePaths, 'path')) {
              this.transfers.done({
                ok: ok,
                side: SIDE.LOCAL,
                action: `${f.isDir ? F_ACTION.MKDIR : F_ACTION.MKFILE}` as F_ACTION,
                file: f.path,
                isDir: ok ? this.diff.fParser.curSnap.remote.get(f.path)[F_STAT.IS_DIR] : false,
                error: error
              })
            }
            break
          case SIDE_STATE.REMOTE_COPY:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.REMOTE, this.diff.fParser.curSnap.remote, filePaths, 'src')) {
              this.transfers.done({
                ok: ok,
                side: SIDE.REMOTE,
                action: F_ACTION.COPY,
                file: f.src,
                fileDst: f.dst,
                isDir: false,
                error: error
              })
            }
            break
          case SIDE_STATE.LOCAL_COPY:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.LOCAL, this.diff.fParser.curSnap.local, filePaths, 'src')) {
              this.transfers.done({
                ok: ok,
                side: SIDE.LOCAL,
                action: F_ACTION.COPY,
                file: f.src,
                fileDst: f.dst,
                isDir: false,
                error: error
              })
            }
            break
          case SIDE_STATE.REMOTE_RM:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.REMOTE, this.diff.fParser.curSnap.remote, filePaths)) {
              this.transfers.done({
                ok: ok,
                side: SIDE.REMOTE,
                action: F_ACTION.RM,
                file: f,
                isDir: ok ? this.diff.fParser.curSnap.remote.get(f)[F_STAT.IS_DIR] : false,
                error: error
              })
            }
            break
          case SIDE_STATE.LOCAL_RM:
            for (const [ok, f, error] of this.checkFilePaths(state, SIDE.LOCAL, this.diff.fParser.curSnap.local, filePaths)) {
              this.transfers.done({
                ok: ok,
                side: SIDE.LOCAL,
                action: F_ACTION.RM,
                file: f,
                isDir: ok ? this.diff.fParser.curSnap.local.get(f)[F_STAT.IS_DIR] : false,
                error: error
              })
            }
            break
          case SIDE_STATE.REMOTE_PROPS:
            for (const f of filePaths) {
              this.transfers.logger.debug(`${SYMBOLS[SIDE.REMOTE]} ${F_ACTION.PROPS} - ${f.path}`)
            }
            break
          case SIDE_STATE.LOCAL_PROPS:
            for (const f of filePaths) {
              this.transfers.logger.debug(`${SYMBOLS[SIDE.LOCAL]} ${F_ACTION.PROPS} - ${f.path}`)
            }
            break
          default:
            this.logger.error(`${state} function not implemented`)
        }
      } catch (e) {
        this.logger.error(`${state}:${JSON.stringify(filePaths)}: ${e}`)
      }
    }
    this.cleanOnExit()
  }

  private async waitForMoves(state: SIDE_STATE, filePaths) {
    // Move actions are fired first, wait for them to complete before processing other tasks
    if (state === SIDE_STATE.LOCAL_MOVE || state === SIDE_STATE.REMOTE_MOVE) {
      this.nbMoveTasks += filePaths.length
    } else if (this.nbMoveTasks > this.transfers.tasks.done) {
      while (this.nbMoveTasks > this.transfers.tasks.done) {
        await setTimeout(500)
        this.logger.debug(`wait for move actions: ${this.nbMoveTasks}/${this.transfers.tasks.done}`)
        if (this.mustStop) {
          break
        }
      }
    }
  }

  private *checkFilePaths(state, side, snapshot, filePaths, attr = null) {
    for (const f of filePaths) {
      if (snapshot.has(attr ? f[attr] : f)) {
        yield [true, f, null]
      } else {
        this.logger.warn(`${state}: unable to find %O from ${side} snapshot`, f)
        yield [false, f, `not found in ${side} snapshot`]
      }
    }
  }

  stop() {
    this.mustStop = true
  }

  cleanOnExit() {
    this.transfers.stop()
  }
}
