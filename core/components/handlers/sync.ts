import { setTimeout } from 'timers/promises'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createReadStream, ReadStream } from 'node:fs'
import { DiffParser } from './diff'
import { RequestsManager } from './requests'
import { DEFAULT_HIGH_WATER_MARK, F_ACTION, F_STAT, SIDE, SYMBOLS } from '../constants/handlers'
import {
  checkParentDir,
  downloadAndChecksum,
  downloadAndSize,
  getTmpPath,
  isPathExistsBool,
  limitConcurrency,
  streamStdout
} from '../utils/functions'
import { TasksManager } from './tasks'
import { TransfersManager } from './transfers'
import { EventEmitter } from 'events'
import { Logger } from 'winston'
import { API } from '../constants/requests'
import type { SyncTransfer } from '../interfaces/sync-transfer.interface'
import type { SyncFileStats } from '../interfaces/sync-diff.interface'
import { SIDE_STATE } from '../constants/diff'
import { AxiosExtendedRequestConfig } from '../interfaces/request.interface'

export class Sync {
  public logger: Logger
  public tasksManager: TasksManager
  public transfers: TransfersManager
  private readonly req: RequestsManager
  public readonly diff: DiffParser
  private readonly incTrackMinSize = 20 * 1024 ** 2 // 20MB
  private store: {
    lProperties: { files: { path: string; mtime: number }[]; tasked: boolean }
    rProperties: { files: { path: string; mtime: number }[]; tasked: boolean }
  } = {
    rProperties: { tasked: false, files: [] },
    lProperties: { tasked: false, files: [] }
  }
  private readonly appEvents: EventEmitter | any
  private nbMoveTasks = 0
  public wasAborted = false

  constructor(req: RequestsManager, diff: DiffParser, logger: Logger, appEvents: EventEmitter | any = null) {
    this.req = req
    this.diff = diff
    this.logger = logger
    this.appEvents = appEvents
    this.transfers = new TransfersManager(
      {
        server: this.req.server.identity(),
        path: this.diff.syncPath.identity()
      },
      appEvents
    )
    this.tasksManager = new TasksManager({ server: this.req.server.identity(), path: this.diff.syncPath.identity() })
  }

  async run() {
    await Promise.all([this.getTasks(), this.tasksManager.run()])
    this.cleanOnExit()
    streamStdout()
    if (this.wasAborted) {
      this.logger.warn('Aborted')
    } else {
      this.diff.syncPath.updateLastSync()
      this.logger.info('Done')
    }
  }

  stop() {
    // really used
    this.wasAborted = true
    this.cleanOnExit()
  }

  cleanOnExit() {
    this.tasksManager.stop()
    this.transfers.stop()
  }

  private async getTasks() {
    for await (const [state, filePaths] of this.diff.run()) {
      await this.waitForMoves(state, filePaths)
      try {
        switch (state) {
          case SIDE_STATE.UPLOAD:
            for (const f of filePaths) {
              const stats = this.diff.fParser.curSnap.local.get(f)
              if (!stats) this.logger.warn(`${state}: unable to find %O in snapshot`, f)
              this.tasksManager.add(async () => this.upload(f), stats ? stats[F_STAT.SIZE] : 1)
            }
            break
          case SIDE_STATE.UPLOAD_DIFF:
            for (const f of filePaths) {
              const stats = this.diff.fParser.curSnap.local.get(f)
              if (!stats) this.logger.warn(`${state}: unable to find %O in snapshot`, f)
              this.tasksManager.add(async () => this.upload(f, true), stats ? stats[F_STAT.SIZE] : 1)
            }
            break
          case SIDE_STATE.DOWNLOAD:
            for (const f of filePaths) {
              const stats = this.diff.fParser.curSnap.remote.get(f)
              if (!stats) this.logger.warn(`${state}: unable to find %O in snapshot`, f)
              this.tasksManager.add(async () => this.download(f), stats ? stats[F_STAT.SIZE] : 1)
            }
            break
          case SIDE_STATE.DOWNLOAD_DIFF:
            for (const f of filePaths) {
              const stats: SyncFileStats = this.diff.fParser.curSnap.remote.get(f)
              if (!stats) {
                this.logger.warn(`${state}: unable to find %O in snapshot`, f)
              }
              this.tasksManager.add(async () => this.download(f, true), stats ? stats[F_STAT.SIZE] : 1)
            }
            break
          case SIDE_STATE.REMOTE_MOVE:
            this.tasksManager.add(async () => this.remoteMove(filePaths), 0)
            break
          case SIDE_STATE.LOCAL_MOVE:
            this.tasksManager.add(async () => this.localMove(filePaths), 0)
            break
          case SIDE_STATE.REMOTE_MK:
            this.tasksManager.add(async () => this.remoteMk(filePaths), 0)
            break
          case SIDE_STATE.LOCAL_MK:
            this.tasksManager.add(async () => this.localMk(filePaths), 0)
            break
          case SIDE_STATE.REMOTE_COPY:
            this.tasksManager.addToEnd(async () => this.remoteCopy(filePaths))
            break
          case SIDE_STATE.LOCAL_COPY:
            this.tasksManager.addToEnd(async () => this.localCopy(filePaths))
            break
          case SIDE_STATE.REMOTE_RM:
            this.tasksManager.addToEnd(async () => this.remoteRemove(filePaths), true)
            break
          case SIDE_STATE.LOCAL_RM:
            this.tasksManager.addToEnd(async () => this.localRemove(filePaths), true)
            break
          case SIDE_STATE.REMOTE_PROPS:
            this.addRemoteProperties(filePaths)
            break
          case SIDE_STATE.LOCAL_PROPS:
            this.addLocalProperties(filePaths)
            break
          default:
            this.logger.error(`${state} function not implemented`)
        }
      } catch (e) {
        this.logger.error(`${state}:${JSON.stringify(filePaths)}: ${e}`)
      }
    }
    this.tasksManager.fillingDone()
  }

  private async waitForMoves(state: SIDE_STATE, filePaths: any[]) {
    // Move actions are fired first, wait for them to complete before processing other tasks
    if (state === SIDE_STATE.LOCAL_MOVE || state === SIDE_STATE.REMOTE_MOVE) {
      this.nbMoveTasks += filePaths.length
    } else if (this.nbMoveTasks > this.transfers.tasks.done) {
      while (this.nbMoveTasks > this.transfers.tasks.done) {
        await setTimeout(500)
        this.logger.debug(`wait for move actions: ${this.nbMoveTasks}/${this.transfers.tasks.done}`)
        if (this.wasAborted) {
          break
        }
      }
    }
  }

  private async download(filePath: string, diff = false) {
    const transfer: SyncTransfer = {
      ok: false,
      side: SIDE.LOCAL,
      action: diff ? F_ACTION.DIFF : F_ACTION.NEW,
      file: filePath,
      isDir: false
    }
    const realPath = this.diff.syncPath.localRealPathFrom(filePath)
    try {
      if ((await isPathExistsBool(realPath)) && (await fs.stat(realPath)).isDirectory()) {
        await this.localRemove([filePath])
      }
      const fileStats: SyncFileStats = [...this.diff.fParser.curSnap.remote.get(filePath)]
      const transferProgress = this.transfers.add(filePath, transfer.side, transfer.action, fileStats[F_STAT.SIZE])
      const realTmpPath = getTmpPath(realPath)
      const [tmpFilePath, hasRange] = await this.hasRange(SIDE.LOCAL, filePath, fileStats, realTmpPath)
      await checkParentDir(realTmpPath)
      const r = await this.req.http.get(this.diff.syncPath.apiFromPath(API.OPERATION, filePath), {
        responseType: 'stream',
        ...(hasRange ? { headers: { Range: `bytes=${hasRange}-` } } : {})
      })
      const check: any = this.diff.secureDiff
        ? { type: 'checksum', prop: F_STAT.CHECKSUM }
        : {
            type: 'size',
            prop: F_STAT.SIZE
          }
      const prop = this.diff.secureDiff
        ? await downloadAndChecksum(r.data, realTmpPath, hasRange, transferProgress)
        : await downloadAndSize(r.data, realTmpPath, hasRange, transferProgress)
      if (prop != fileStats[check.prop]) {
        this.diff.fParser.removeFile(SIDE.REMOTE, filePath)
        // remove incomplete file and from the incomplete snapshot
        await this.diff.fParser.removeIncomplete(SIDE.LOCAL, tmpFilePath, realTmpPath)
        this.setTransferState(transfer, `${check.type} does not match`)
        return
      }
      await checkParentDir(realPath)
      await fs.rename(realTmpPath, realPath)
      // update the file mtime
      this.addLocalProperties([{ path: filePath, mtime: fileStats[F_STAT.MTIME] }])
      // update ino
      fileStats[F_STAT.INO] = (await fs.stat(realPath)).ino
      // add file to current snapshot
      this.diff.fParser.addFile(SIDE.LOCAL, filePath, fileStats)
      // remove incomplete file and from the incomplete snapshot
      await this.diff.fParser.removeIncomplete(SIDE.LOCAL, tmpFilePath, null, true)
      this.setTransferState(transfer)
    } catch (e) {
      this.diff.fParser.removeFile(SIDE.REMOTE, filePath)
      this.setTransferState(transfer, await RequestsManager.handleHttpError(e, true))
    }
  }

  private async upload(filePath: string, diff = false) {
    const transfer: SyncTransfer = {
      ok: false,
      side: SIDE.REMOTE,
      action: diff ? F_ACTION.DIFF : F_ACTION.NEW,
      file: filePath,
      isDir: false
    }
    const realPath = this.diff.syncPath.localRealPathFrom(filePath)
    if (!(await isPathExistsBool(realPath))) {
      this.setTransferState(transfer, `does not exist on ${SIDE.LOCAL} side`)
      return
    }
    try {
      const fileStats: SyncFileStats = [...this.diff.fParser.curSnap.local.get(filePath)]
      if ((await fs.stat(realPath)).size !== fileStats[F_STAT.SIZE]) {
        this.diff.fParser.removeFile(SIDE.LOCAL, filePath)
        this.setTransferState(transfer, 'size has changed since parsing')
        return
      }
      const [tmpFilePath, hasRange] = await this.hasRange(SIDE.REMOTE, filePath, fileStats)
      const contentLength = hasRange ? fileStats[F_STAT.SIZE] - hasRange : fileStats[F_STAT.SIZE]
      const transferProgress = this.transfers.add(filePath, transfer.side, transfer.action, fileStats[F_STAT.SIZE])
      const getStream: () => ReadStream = () => {
        const stream = createReadStream(realPath, {
          start: hasRange || 0,
          highWaterMark: DEFAULT_HIGH_WATER_MARK
        })
        if (transferProgress) {
          transferProgress.currentSize = hasRange || 0
          stream.on('data', (chunk) => transferProgress.update(chunk.length))
        }
        return stream
      }
      const r = await this.req.http<{ ino: number }>({
        method: diff ? 'put' : 'post',
        url: this.diff.syncPath.apiFromPath(API.OPERATION, filePath),
        headers: {
          'Content-Length': `${contentLength}`,
          'Content-Type': 'application/octet-stream',
          ...(hasRange ? { 'Content-Range': `bytes ${hasRange}-${contentLength - 1}/${contentLength}` } : {})
        },
        params: {
          size: fileStats[F_STAT.SIZE],
          checksum: fileStats[F_STAT.CHECKSUM],
          mtime: fileStats[F_STAT.MTIME]
        },
        data: getStream(),
        getData: getStream
      } as AxiosExtendedRequestConfig)
      // update ino from response
      fileStats[F_STAT.INO] = r.data.ino
      this.diff.fParser.addFile(SIDE.REMOTE, filePath, fileStats)
      await this.diff.fParser.removeIncomplete(SIDE.REMOTE, tmpFilePath, null, true)
      this.setTransferState(transfer)
    } catch (e) {
      this.diff.fParser.removeFile(SIDE.LOCAL, filePath)
      this.setTransferState(transfer, await RequestsManager.handleHttpError(e, true))
    }
  }

  private async localProperties() {
    try {
      await limitConcurrency(
        this.store.lProperties.files,
        async (f) => {
          const realPath = this.diff.syncPath.localRealPathFrom(f.path)
          try {
            await fs.utimes(realPath, f.mtime, f.mtime)
            this.diff.fParser.propFile(SIDE.LOCAL, f.path, F_STAT.MTIME, f.mtime)
            this.transfers.logger.debug(`${SYMBOLS[SIDE.LOCAL]} ${F_ACTION.PROPS} - ${f.path}`)
          } catch (e) {
            this.transfers.logger.error(`${SYMBOLS[SIDE.LOCAL]} ${F_ACTION.PROPS} - ${f.path}: ${e}`)
          }
        },
        25
      )
    } catch (e) {
      this.logger.error(`${this.localProperties.name} : ${e}`)
    }
  }

  private async remoteProperties() {
    try {
      await limitConcurrency(
        this.store.rProperties.files,
        async (f) => {
          try {
            await this.req.http({
              method: 'proppatch',
              url: this.diff.syncPath.apiFromPath(API.OPERATION, f.path),
              data: { mtime: f.mtime }
            })

            this.diff.fParser.propFile(SIDE.REMOTE, f.path, F_STAT.MTIME, f.mtime)
            this.transfers.logger.debug(`${SYMBOLS[SIDE.REMOTE]} ${F_ACTION.PROPS} - ${f.path}`)
          } catch (e) {
            const errorMsg = await RequestsManager.handleHttpError(e, true)
            this.transfers.logger.error(`${SYMBOLS[SIDE.REMOTE]} ${F_ACTION.PROPS} - ${f.path}: ${errorMsg}`)
          }
        },
        25
      )
      this.transfers.logger.info('All remote properties updated successfully!')
    } catch (e) {
      this.logger.error(`${this.remoteProperties.name} : ${e}`)
    }
  }

  private async localRemove(filePaths: string[]) {
    const localProperties: { path: string; mtime: number }[] = []
    try {
      await limitConcurrency(
        filePaths,
        async (f) => {
          const realPath = this.diff.syncPath.localRealPathFrom(f)
          const isDir = this.diff.fParser.curSnap.local.get(f)[F_STAT.IS_DIR]
          const transfer: SyncTransfer = {
            ok: false,
            side: SIDE.LOCAL,
            action: isDir ? F_ACTION.RMDIR : F_ACTION.RM,
            file: f,
            isDir: isDir
          }
          try {
            if (await isPathExistsBool(realPath)) {
              if (this.appEvents) {
                await this.appEvents.trashItem(realPath)
              } else {
                await fs.rm(realPath, { recursive: isDir, force: true })
              }
            }
            this.diff.fParser.removeFile(SIDE.LOCAL, f)
            // local removing is modifying the local mtime on the parent file directory, we need to update it
            const parentDir = path.dirname(f)
            if (parentDir != '.') {
              localProperties.push({
                path: parentDir,
                mtime: this.diff.fParser.curSnap.remote.get(parentDir)[F_STAT.MTIME]
              })
            }
            this.setTransferState(transfer)
          } catch (e) {
            this.setTransferState(transfer, e)
          }
        },
        25
      )
    } catch (e) {
      this.logger.error(`${this.localRemove.name} : ${e}`)
    }
    this.addLocalProperties(localProperties)
  }

  private async remoteRemove(filePaths: string[]) {
    const remoteProperties: { path: string; mtime: number }[] = []
    try {
      await limitConcurrency(
        filePaths,
        async (f) => {
          const isDir = this.diff.fParser.curSnap.remote.get(f)[F_STAT.IS_DIR]
          const transfer: SyncTransfer = {
            ok: false,
            side: SIDE.REMOTE,
            action: isDir ? F_ACTION.RMDIR : F_ACTION.RM,
            file: f,
            isDir: isDir
          }
          try {
            await this.req.http.delete(this.diff.syncPath.apiFromPath(API.OPERATION, f))
            this.diff.fParser.removeFile(SIDE.REMOTE, f)
            // remote removing is modifying the remote mtime on the parent file directory, we need to update it
            const parentDir = path.dirname(f)
            if (parentDir != '.') {
              remoteProperties.push({
                path: parentDir,
                mtime: this.diff.fParser.curSnap.local.get(parentDir)[F_STAT.MTIME]
              })
            }
            this.setTransferState(transfer)
          } catch (e) {
            this.setTransferState(transfer, await RequestsManager.handleHttpError(e, true))
          }
        },
        25
      )
    } catch (e) {
      this.logger.error(`${this.remoteRemove.name} : ${e}`)
    }
    this.addRemoteProperties(remoteProperties)
  }

  private async localMk(filePaths: { path: string; isDir: boolean; mtime: number }[]) {
    try {
      await limitConcurrency(
        filePaths,
        async (f) => {
          const realPath = this.diff.syncPath.localRealPathFrom(f.path)
          const transfer: SyncTransfer = {
            ok: false,
            side: SIDE.LOCAL,
            action: f.isDir ? F_ACTION.MKDIR : F_ACTION.MKFILE,
            file: f.path,
            isDir: f.isDir
          }
          try {
            if ((await isPathExistsBool(realPath)) && f.isDir !== (await fs.stat(realPath)).isDirectory()) {
              await this.localRemove([f.path])
            }
            if (f.isDir) {
              await fs.mkdir(realPath, { recursive: true })
            } else {
              await fs.writeFile(realPath, '')
            }
            const fileStats = [...this.diff.fParser.curSnap.remote.get(f.path)]
            // update ino
            fileStats[F_STAT.INO] = (await fs.stat(realPath)).ino
            this.diff.fParser.addFile(SIDE.LOCAL, f.path, fileStats)
            this.addLocalProperties([f])
            this.setTransferState(transfer)
          } catch (e) {
            this.diff.fParser.removeFile(SIDE.REMOTE, f.path)
            this.setTransferState(transfer, e)
          }
        },
        25
      )
    } catch (e) {
      this.logger.error(`${this.localMk.name} : ${e}`)
    }
  }

  private async remoteMk(filePaths: { path: string; isDir: boolean; mtime: number }[]) {
    try {
      await limitConcurrency(
        filePaths,
        async (f) => {
          const transfer: SyncTransfer = {
            ok: false,
            side: SIDE.REMOTE,
            action: f.isDir ? F_ACTION.MKDIR : F_ACTION.MKFILE,
            file: f.path,
            isDir: f.isDir
          }
          try {
            const r = await this.req.http.post<{
              ino: number
            }>(this.diff.syncPath.apiFromPath(`${API.OPERATION}/${API.MAKE}`, f.path), {
              type: f.isDir ? 'directory' : 'file',
              mtime: f.mtime
            })
            const fileStats = [...this.diff.fParser.curSnap.local.get(f.path)]
            // update ino from remote infos
            fileStats[F_STAT.INO] = r.data.ino
            this.diff.fParser.addFile(SIDE.REMOTE, f.path, fileStats)
            if (f.isDir) {
              this.addRemoteProperties([f])
            }
            this.setTransferState(transfer)
          } catch (e) {
            this.diff.fParser.removeFile(SIDE.LOCAL, f.path)
            this.setTransferState(transfer, await RequestsManager.handleHttpError(e, true))
          }
        },
        25
      )
    } catch (e) {
      this.logger.error(`${this.remoteMk.name} : ${e}`)
    }
  }

  private async localCopy(filePaths: { src: string; dst: string; mtime: number }[]) {
    try {
      await limitConcurrency(
        filePaths,
        async (f) => {
          const transfer: SyncTransfer = {
            ok: false,
            side: SIDE.LOCAL,
            action: F_ACTION.COPY,
            file: f.src,
            fileDst: f.dst,
            isDir: false
          }
          const srcRealPath = this.diff.syncPath.localRealPathFrom(f.src)
          const dstRealPath = this.diff.syncPath.localRealPathFrom(f.dst)
          if ((await isPathExistsBool(dstRealPath)) && (await fs.stat(dstRealPath)).isDirectory()) {
            await this.localRemove([f.dst])
          }
          try {
            await checkParentDir(dstRealPath)
            await fs.copyFile(srcRealPath, dstRealPath)
            await fs.utimes(dstRealPath, f.mtime, f.mtime)
            this.diff.fParser.addFile(SIDE.LOCAL, f.dst, await this.diff.fParser.getStats(f.dst, dstRealPath, false))
            this.setTransferState(transfer)
          } catch (e) {
            this.diff.fParser.removeFile(SIDE.REMOTE, f.dst)
            this.setTransferState(transfer, e)
          }
        },
        25
      )
    } catch (e) {
      this.logger.error(`${this.localCopy.name} : ${e}`)
    }
  }

  private async remoteCopy(filePaths: { src: string; dst: string; mtime: number }[]) {
    try {
      await limitConcurrency(
        filePaths,
        async (f) => {
          const transfer: SyncTransfer = {
            ok: false,
            side: SIDE.REMOTE,
            action: F_ACTION.COPY,
            file: f.src,
            fileDst: f.dst,
            isDir: false
          }
          try {
            const r = await this.req.http<{
              ino: number
              mtime: number
            }>({
              method: 'copy',
              url: this.diff.syncPath.apiFromPath(API.OPERATION, f.src),
              data: { destination: path.posix.join(this.diff.syncPath.remotePath, f.dst), mtime: f.mtime }
            })
            // update ino from remote infos
            const fileStats = [...(this.diff.fParser.curSnap.local.get(f.src) || this.diff.fParser.curSnap.local.get(f.dst))]
            fileStats[F_STAT.INO] = r.data.ino
            fileStats[F_STAT.MTIME] = r.data.mtime
            this.diff.fParser.addFile(SIDE.REMOTE, f.dst, fileStats)
            this.setTransferState(transfer)
          } catch (e) {
            this.diff.fParser.removeFile(SIDE.LOCAL, f.dst)
            this.setTransferState(transfer, await RequestsManager.handleHttpError(e, true))
          }
        },
        25
      )
    } catch (e) {
      this.logger.error(`${this.remoteCopy.name} : ${e}`)
    }
  }

  private async localMove(filePaths: { src: string; dst: string }[]) {
    for (const f of filePaths) {
      const transfer: SyncTransfer = {
        ok: false,
        side: SIDE.LOCAL,
        action: F_ACTION.MOVE,
        file: f.src,
        fileDst: f.dst,
        isDir: this.diff.fParser.curSnap.local.get(f.src)[F_STAT.IS_DIR]
      }
      const srcRealPath = this.diff.syncPath.localRealPathFrom(f.src)
      const dstRealPath = this.diff.syncPath.localRealPathFrom(f.dst)
      try {
        await checkParentDir(dstRealPath)
        // todo: use fse.move for better fs support
        await fs.rename(srcRealPath, dstRealPath)
        this.diff.fParser.moveFile(SIDE.LOCAL, f.src, f.dst)
        this.setTransferState(transfer)
      } catch (e) {
        this.diff.fParser.removeFile(SIDE.REMOTE, f.dst)
        // this part allow to move the file again on the next sync, if omitted code will apply download and local remove methods
        this.diff.fParser.addFile(SIDE.LOCAL, f.src, this.diff.fParser.oldSnap.local.get(f.src))
        this.diff.fParser.addFile(SIDE.REMOTE, f.src, this.diff.fParser.oldSnap.local.get(f.src))
        this.setTransferState(transfer, e)
      }
    }
  }

  private async remoteMove(filePaths: { src: string; dst: string }[]) {
    for (const f of filePaths) {
      const transfer: SyncTransfer = {
        ok: false,
        side: SIDE.REMOTE,
        action: F_ACTION.MOVE,
        file: f.src,
        fileDst: f.dst,
        isDir: this.diff.fParser.curSnap.remote.get(f.src)[F_STAT.IS_DIR]
      }
      try {
        await this.req.http({
          method: 'move',
          url: this.diff.syncPath.apiFromPath(API.OPERATION, f.src),
          data: { destination: path.posix.join(this.diff.syncPath.remotePath, f.dst) }
        })
        this.diff.fParser.moveFile(SIDE.REMOTE, f.src, f.dst)
        this.setTransferState(transfer)
      } catch (e) {
        this.diff.fParser.removeFile(SIDE.LOCAL, f.dst)
        // this part allow to move the file again on the next sync, if omitted code will apply upload and remote remove methods
        this.diff.fParser.addFile(SIDE.LOCAL, f.src, this.diff.fParser.oldSnap.local.get(f.src))
        this.diff.fParser.addFile(SIDE.REMOTE, f.src, this.diff.fParser.oldSnap.local.get(f.src))
        this.setTransferState(transfer, await RequestsManager.handleHttpError(e, true))
      }
    }
  }

  private addLocalProperties(filePaths: { path: string; mtime: number }[]) {
    this.store.lProperties.files.push(...filePaths)
    if (!this.store.lProperties.tasked && this.store.lProperties.files.length) {
      this.tasksManager.addToProps(async () => this.localProperties())
      this.store.lProperties.tasked = true
    }
  }

  private addRemoteProperties(filePaths: { path: string; mtime: number }[]) {
    this.store.rProperties.files.push(...filePaths)
    if (!this.store.rProperties.tasked && this.store.rProperties.files.length) {
      this.tasksManager.addToProps(async () => this.remoteProperties())
      this.store.rProperties.tasked = true
    }
  }

  private async hasRange(side: string, filePath: string, fileStats: SyncFileStats, realTmpPath?: string): Promise<any[]> {
    // Check incomplete file
    const tmpFilePath = getTmpPath(filePath)
    if (fileStats[F_STAT.SIZE] < this.incTrackMinSize) {
      // only tracks the file to resume if his size is not too low
      return [tmpFilePath, null]
    }
    if ((side === SIDE.LOCAL && (await isPathExistsBool(realTmpPath))) || side === SIDE.REMOTE) {
      const snapStats: SyncFileStats = this.diff.fParser.curIncSnap[side].get(tmpFilePath)
      if (snapStats) {
        if (
          (this.diff.secureDiff && snapStats[F_STAT.CHECKSUM] === fileStats[F_STAT.CHECKSUM]) ||
          snapStats[F_STAT.SIZE] === fileStats[F_STAT.SIZE]
        ) {
          return [tmpFilePath, snapStats[F_STAT.INCOMPLETE_SIZE]]
        }
      }
    }
    this.diff.fParser.addIncomplete(side, tmpFilePath, [...fileStats, 0])
    return [tmpFilePath, 0]
  }

  private setTransferState(transfer: SyncTransfer, error: string = null) {
    if (error) {
      transfer.error = error
      this.diff.syncPath.lastErrors.push(transfer)
    } else {
      transfer.ok = true
    }
    this.transfers.done(transfer)
  }
}
