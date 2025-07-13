/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import zlib from 'node:zlib'
import readline from 'node:readline'
import { getLogger } from './loggers'
import { snapshotSides, SyncPath } from '../models/syncpath'
import { IS_WINDOWS } from '../../constants'
import {
  checksumFile,
  convertJSONToMap,
  convertMapToJSON,
  currentTimeStamp,
  fileBaseName,
  isPathExistsBool,
  regExpPathPattern
} from '../utils/functions'
import { RequestsManager } from './requests'
import {
  DEFAULT_FILTERS,
  F_ACTION,
  F_SPECIAL_STAT,
  F_STAT,
  INCOMPLETE_REGEXP,
  INCOMPLETE_RETENTION,
  SIDE,
  SYNC_DIFF_DONE
} from '../constants/handlers'
import { Logger } from 'winston'
import { EventEmitter } from 'events'
import { REMOTE_RENDERER } from '../../../main/constants/events'
import { setMimeType } from '../../../main/components/utils'
import { API } from '../constants/requests'
import type { SyncTransfer } from '../interfaces/sync-transfer.interface'
import type { SyncDiff, SyncFileSpecialStats, SyncFileStats, SyncSnapShot } from '../interfaces/sync-diff.interface'
import { NormalizedMap } from '../utils/normalizedMap'

export class FilesParser {
  // constants
  private readonly reportOnly: boolean
  private readonly appEvents: EventEmitter
  private readonly lPath: string
  private readonly rPath: string
  private readonly iPath: string
  private readonly secureDiff: boolean
  private readonly regexPath: RegExp
  private readonly syncPathFilters: RegExp
  private nbFiltered = 0
  private syncPath: SyncPath
  public logger: Logger
  public req: RequestsManager
  public wasAborted = false
  // current snapshots
  public curSnap: {
    local: SyncSnapShot
    remote: SyncSnapShot
  } = { local: new NormalizedMap<string, SyncFileStats>(), remote: new NormalizedMap<string, SyncFileStats>() }
  // stored snapshots
  public oldSnap: {
    local: SyncSnapShot
    remote: SyncSnapShot
  } = { local: new NormalizedMap<string, SyncFileStats>(), remote: new NormalizedMap<string, SyncFileStats>() }
  // stored incomplete snapshots
  public oldIncSnap: {
    local: SyncSnapShot
    remote: SyncSnapShot
  } = { local: new NormalizedMap<string, SyncFileStats>(), remote: new NormalizedMap<string, SyncFileStats>() }
  // current incomplete snapshots
  public curIncSnap: {
    local: SyncSnapShot
    remote: SyncSnapShot
  } = { local: new NormalizedMap<string, SyncFileStats>(), remote: new NormalizedMap<string, SyncFileStats>() }
  // parsing errors
  public errors = { local: new NormalizedMap<string, string>(), remote: new NormalizedMap<string, string>() }

  constructor(syncPath: SyncPath, req: RequestsManager, reportOnly = false, appEvents: EventEmitter = null) {
    this.syncPath = syncPath
    this.req = req
    this.reportOnly = reportOnly
    this.appEvents = appEvents
    this.logger = getLogger('Parser', { server: this.req.server.identity(), path: this.syncPath.identity() })
    this.secureDiff = this.syncPath.secureDiff
    this.regexPath = regExpPathPattern(this.syncPath.localPath)
    this.syncPathFilters = this.syncPath.filters.length ? new RegExp(this.syncPath.filters.join('|')) : undefined
    for (const [side, path] of snapshotSides.map((side) => [side, syncPath.getSnapshotPath(side, this.req.server.id)])) {
      this[`${side}Path`] = path
    }
  }

  async run() {
    await this.loadSnapShots()
    await Promise.all([this.runRemote(), this.runLocal()])
    this.checkOnFirstSync()
    this.ignoreSnapshotErrors()
  }

  stop() {
    this.wasAborted = true
  }

  private checkOnFirstSync() {
    if (this.syncPath.firstSync) {
      // a guard to avoid delete data on a first sync
      if (
        (this.syncPath.isDownloadMode && this.curSnap.remote.size === 0 && this.curSnap.local.size > 0) ||
        (this.syncPath.isUploadMode && this.curSnap.local.size === 0 && this.curSnap.remote.size > 0)
      ) {
        this.stop()
        const sides = [this.syncPath.isDownloadMode ? SIDE.REMOTE : SIDE.LOCAL, this.syncPath.isDownloadMode ? SIDE.LOCAL : SIDE.REMOTE]
        throw `The ${sides[0]} folder is empty, the contents of the ${sides[1]} folder will be deleted, add file in ${sides[1]} folder to confirm and sync changes`
      }
    }
  }

  private async runLocal(): Promise<void> {
    this.logger.debug(`Local parsing: ${this.syncPath.localPath}`)
    for await (const [filePath, fileStats] of this.getLocalFiles(this.syncPath.localPath)) {
      if (this.wasAborted) {
        throw 'aborted'
      }
      if (fileStats.length !== 2) {
        // if no error, store file in current snapshot
        this.curSnap.local.set(filePath, fileStats)
      } else if (fileStats[0] === F_SPECIAL_STAT.ERROR) {
        // file was on error on local side:  {'/a/b': ['error', 'description' as string]}
        this.errors.local.set(filePath, fileStats[1] as string)
      } else {
        this.logger.error(`Local file stats have an unknown state : ${fileStats[0]}`)
        throw `Local file stats has an unknown state : ${fileStats[0]}}`
      }
    }
    this.logger.info(`Local parsing done (${this.curSnap.local.size} files)`)
  }

  private async runRemote(): Promise<void> {
    this.logger.debug(`Remote parsing: ${this.syncPath.remotePath}`)
    for await (const [filePath, fileStats] of this.getRemoteFiles()) {
      if (this.wasAborted) {
        throw 'aborted'
      }
      if (fileStats.length !== 2) {
        // if no error, store file in current snapshot
        this.curSnap.remote.set(filePath, fileStats)
      } else if (fileStats[0] === F_SPECIAL_STAT.ERROR) {
        // file was on error on remote side:  {'/a/b': ['error', 'description' as string]}
        this.errors.remote.set(filePath, fileStats[1] as string)
      } else if (fileStats[0] === F_SPECIAL_STAT.FILTERED) {
        // file was filtered on remote side:  {'/a/b': ['filtered', isDir as boolean]}
        this.isFiltered(SIDE.REMOTE, fileBaseName(filePath), filePath, fileStats[1] as boolean, true)
      } else {
        this.logger.error(`Remote file stats have an unknown state : ${fileStats[0]}`)
        throw `Remote file stats has an unknown state : ${fileStats[0]}}`
      }
    }
  }

  private async *getLocalFiles(dir: string): AsyncGenerator<[string, SyncFileStats | SyncFileSpecialStats]> {
    try {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const realPath = path.join(entry.parentPath, entry.name)
        if (!entry.isDirectory() && !entry.isFile()) {
          this.logger.info(`Ignore special file: ${realPath}`)
          continue
        }
        let filePath = realPath.replace(this.regexPath, '')
        if (IS_WINDOWS) {
          filePath = filePath.replaceAll('\\', '/')
        }

        // default filters
        if (this.isFiltered(SIDE.LOCAL, entry.name, filePath, entry.isDirectory())) {
          continue
        }
        try {
          if (entry.isDirectory()) {
            yield [filePath, await this.getStats(filePath, realPath, entry.isDirectory())]
            yield* this.getLocalFiles(realPath)
          } else {
            const fileStats = await this.getStats(filePath, realPath, entry.isDirectory())
            if (await this.checkIncomplete(SIDE.LOCAL, entry.name, filePath, fileStats, realPath)) {
              continue
            }
            yield [filePath, fileStats]
          }
        } catch (e) {
          yield [filePath, [F_SPECIAL_STAT.ERROR, e.toString()]]
        }
      }
    } catch (e) {
      this.logger.error(`Unable to parse: ${dir} (${e})`)
      if (dir === this.syncPath.localPath) {
        throw new Error('Abort parsing')
      }
      yield [dir.replace(this.regexPath, ''), [F_SPECIAL_STAT.ERROR, e.toString()]]
    }
  }

  private async *getRemoteFiles(): AsyncGenerator<[string, SyncFileStats | SyncFileSpecialStats]> {
    let done = false
    let lastLine: string
    const [config, data] = this.processDiffParams({ responseType: 'stream' }, {
      secureDiff: this.syncPath.secureDiff,
      firstSync: this.syncPath.firstSync,
      defaultFilters: [...DEFAULT_FILTERS],
      pathFilters: this.syncPathFilters ? this.syncPathFilters.toString().slice(1, -1) : null
    } satisfies SyncDiff)
    try {
      const r = await this.req.http.post(`${API.DIFF}/${this.syncPath.id}`, data, config)
      const stream = r.data.setEncoding('utf8')
      const rl = readline.createInterface({
        input: stream,
        terminal: false,
        crlfDelay: Infinity
      })
      for await (const line of rl) {
        if (line === SYNC_DIFF_DONE) {
          done = true
          break
        }
        lastLine = line

        const [filePath, fileStats] = Object.entries(JSON.parse(line))[0] as [string, SyncFileStats | SyncFileSpecialStats]

        if (
          fileStats.length !== 2 && // filter SyncFileSpecialStats
          !fileStats[F_STAT.IS_DIR] &&
          (await this.checkIncomplete(SIDE.REMOTE, fileBaseName(filePath), filePath, fileStats as SyncFileStats))
        ) {
          continue
        }
        yield [filePath, fileStats]
      }
    } catch (e) {
      if (lastLine) {
        this.logger.error(`Local: ${e}`)
        this.logger.error(`Remote: ${lastLine}`)
      } else if (e.response?.status === 404) {
        throw 'Location not found'
      } else {
        this.logger.error(e)
        throw await RequestsManager.handleHttpError(e, true)
      }
    }
    if (done) {
      this.logger.info(`Remote parsing done (${this.curSnap.remote.size} files)`)
    } else {
      throw `Incomplete remote parsing (${this.curSnap.remote.size} files)`
    }
  }

  private processDiffParams(config: any, data: SyncDiff): [any, SyncDiff | Buffer<ArrayBufferLike>] {
    if (this.syncPath.firstSync || !this.syncPath.secureDiff) {
      return [config, data]
    } else {
      data.snapshot = Object.fromEntries(this.oldSnap.remote)
      try {
        const compressed: Buffer<ArrayBufferLike> = zlib.gzipSync(JSON.stringify(data))
        config.headers = { 'Content-Encoding': 'gzip', 'Content-Type': 'application/octet-stream' }
        return [config, compressed]
      } catch (e) {
        this.logger.error(e)
        return [config, data]
      }
    }
  }

  private async getChecksumFile(filePath: string, realPath: string, size: number, ino: number, mtime: number): Promise<string> {
    if (!this.syncPath.firstSync && this.oldSnap.local.has(filePath)) {
      const fileStats = this.oldSnap.local.get(filePath)
      if (
        fileStats[F_STAT.CHECKSUM] !== null &&
        fileStats[F_STAT.MTIME] === mtime &&
        fileStats[F_STAT.SIZE] === size &&
        fileStats[F_STAT.INO] === ino
      ) {
        return fileStats[F_STAT.CHECKSUM]
      }
    }
    return await checksumFile(realPath)
  }

  async getStats(filePath: string, realPath: string, isDir: boolean): Promise<SyncFileStats> {
    const stats = await fs.stat(realPath)
    const mtime = Math.floor(stats.mtime.getTime() / 1000)
    return [
      isDir,
      isDir ? 0 : stats.size,
      mtime,
      stats.ino,
      !isDir && this.secureDiff ? await this.getChecksumFile(filePath, realPath, stats.size, stats.ino, mtime) : null
    ]
  }

  propFile(side: string, filePath: string, property: number, value: any) {
    try {
      this.curSnap[side].get(filePath)[property] = value
      this.logger.debug(`${side}Properties: ${filePath}`)
    } catch (e) {
      this.logger.warn(`${side}Properties: ${filePath}: ${e}`)
    }
  }

  addFile(side: string, filePath: string, properties: any[]) {
    this.curSnap[side].set(filePath, properties)
    this.logger.debug(`${side}Added: ${filePath}`)
  }

  removeFile(side: string, filePath: string, parsingError = false) {
    try {
      if (parsingError || this.curSnap[side].get(filePath)[F_STAT.IS_DIR]) {
        const isChild = regExpPathPattern(filePath)
        for (const f of this.curSnap[side].keys()) {
          if (isChild.test(f)) {
            this.curSnap[side].delete(f)
            this.logger.debug(`${side}Remove child: ${f}`)
          }
        }
      }
      this.curSnap[side].delete(filePath)
      this.logger.debug(`${side}Remove: ${filePath}`)
    } catch (e) {
      this.logger.warn(`${side}Remove: ${filePath} : ${e}`)
    }
  }

  moveFile(side: string, srcPath: string, dstPath: string) {
    try {
      if (this.curSnap[side].get(srcPath)[F_STAT.IS_DIR]) {
        const isChild = regExpPathPattern(srcPath)
        for (const f of this.curSnap[side].keys()) {
          if (isChild.test(f)) {
            const d = f.replace(srcPath, dstPath)
            this.curSnap[side].set(d, this.curSnap[side].get(f))
            this.curSnap[side].delete(f)
            this.logger.debug(`${side}Move child: ${f} -> ${d}`)
          }
        }
      }
      this.curSnap[side].set(dstPath, this.curSnap[side].get(srcPath))
      this.curSnap[side].delete(srcPath)
      this.logger.debug(`${side}Move: ${srcPath} -> ${dstPath}`)
    } catch (e) {
      this.logger.warn(`${side}Move: ${srcPath} -> ${dstPath}: ${e}`)
    }
  }

  addIncomplete(side: string, filePath: string, properties: any[]) {
    this.curIncSnap[side].set(filePath, properties)
    this.logger.debug(`Incomplete ${side}Added: ${filePath}`)
  }

  private async checkIncomplete(side: string, fileName: string, filePath: string, fileStats: SyncFileStats, realPath?: string) {
    // check if it is an incomplete file
    if (!INCOMPLETE_REGEXP.test(fileName)) {
      return false
    }
    // do not delete the incomplete file if it is not referenced in the snapshot, it may belong to another client
    if (currentTimeStamp() - fileStats[F_STAT.MTIME] > INCOMPLETE_RETENTION) {
      // if incomplete is outdated, remove it
      await this.removeIncomplete(side, filePath, realPath)
    } else if (this.oldIncSnap[side].has(filePath)) {
      // add file to the current snapshot based on the stored snapshot, this allows to not keep entries that no longer exist
      // update the incomplete size based on the current parsing
      const fStats: SyncFileStats = this.oldIncSnap[side].get(filePath)
      fStats[F_STAT.INCOMPLETE_SIZE] = fileStats[F_STAT.SIZE]
      // store to the current snapshot
      this.curIncSnap[side].set(filePath, fStats)
      this.logger.debug(`Incomplete ${side}: ${filePath}`)
    }
    return true
  }

  async removeIncomplete(side: string, filePath: string, realPath?: string, onlySnap = false) {
    this.curIncSnap[side].delete(filePath)
    if (onlySnap) {
      this.logger.debug(`Incomplete ${side} removed: ${filePath}`)
      return
    }
    try {
      if (side === SIDE.LOCAL) {
        if (await isPathExistsBool(realPath)) {
          await fs.rm(realPath, { force: true })
        }
      } else {
        await this.req.http.delete(this.syncPath.apiFromPath(API.OPERATION, filePath))
      }
      this.logger.debug(`Incomplete ${side} removed: ${filePath}`)
    } catch (e) {
      this.logger.warn(`Incomplete ${side} not removed: ${filePath}: ${e}`)
    }
  }

  async saveSnapshots(wasStopped = false): Promise<void> {
    if (wasStopped) {
      await this.saveIncompleteSnapshot()
    } else {
      await Promise.all([this.saveLocalSnapshot(), this.saveRemoteSnapshot(), this.saveIncompleteSnapshot()])
    }
  }

  private isFiltered(side: SIDE.LOCAL | SIDE.REMOTE, fileName: string, filePath: string, isDir: boolean, alreadyChecked = false): boolean {
    if (!alreadyChecked && DEFAULT_FILTERS.has(fileName)) {
      this.logger.silly(`Default Filters ${side}: ${filePath}`)
      return true
    } else if (alreadyChecked || (this.syncPathFilters && this.syncPathFilters.test(filePath))) {
      this.logger.debug(`Filters ${side}: ${filePath}`)
      if (this.reportOnly && this.appEvents) {
        this.nbFiltered--
        const tr: SyncTransfer = { ok: true, side: side, action: F_ACTION.FILTERED, file: filePath, isDir: isDir }
        this.appEvents.emit(REMOTE_RENDERER.SYNC.REPORT_TRANSFER, {
          serverId: this.req.server.id,
          syncPathId: this.syncPath.id,
          nbTasks: this.nbFiltered,
          ...setMimeType(tr)
        })
      }
      return true
    }
    return false
  }

  private ignoreSnapshotErrors() {
    for (const [side, errors] of Object.entries(this.errors)) {
      for (const [path, error] of errors) {
        this.logger.warn(`${side} parsing ignore: ${path} - ${error}`)
        if (side === SIDE.LOCAL) {
          this.removeFile(SIDE.REMOTE, path, true)
        } else {
          this.removeFile(SIDE.LOCAL, path, true)
        }
      }
    }
  }

  private async saveLocalSnapshot() {
    await this.saveSnapshot(this.lPath, convertMapToJSON(this.curSnap.local))
  }

  private async saveRemoteSnapshot() {
    await this.saveSnapshot(this.rPath, convertMapToJSON(this.curSnap.remote))
  }

  private async saveIncompleteSnapshot() {
    await this.saveSnapshot(
      this.iPath,
      JSON.stringify({
        local: [...this.curIncSnap.local],
        remote: [...this.curIncSnap.remote]
      })
    )
  }

  private async loadSnapShots(): Promise<any> {
    // files snapshot
    try {
      this.oldSnap.local = convertJSONToMap(await fs.readFile(this.lPath, 'utf8'))
      this.oldSnap.remote = convertJSONToMap(await fs.readFile(this.rPath, 'utf8'))
      this.syncPath.firstSync = false
    } catch (e) {
      this.logger.debug(`Loading files snapshots: ${e}`)
      this.syncPath.firstSync = true
      this.oldSnap.local.clear()
      this.oldSnap.remote.clear()
      this.logger.debug('FirstSync mode')
    }
    // incomplete snapshot
    try {
      const oldIncSnap = JSON.parse(await fs.readFile(this.iPath, 'utf8'))
      this.oldIncSnap.local = new NormalizedMap(oldIncSnap.local)
      this.oldIncSnap.remote = new NormalizedMap(oldIncSnap.remote)
    } catch (e) {
      this.oldIncSnap.local.clear()
      this.oldIncSnap.remote.clear()
      this.logger.debug(`Loading incomplete snapshot: ${e}`)
    }
  }

  private async saveSnapshot(snapshotPath: string, content: string): Promise<void> {
    await fs.writeFile(snapshotPath, content)
    this.logger.debug(`${fileBaseName(snapshotPath)} saved`)
  }
}
