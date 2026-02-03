import { RequestsManager } from './handlers/requests'
import { SyncPath } from './models/syncpath'
import { Server } from './models/server'
import { FilesParser } from './handlers/parser'
import { DiffParser } from './handlers/diff'
import { Sync } from './handlers/sync'
import { Report } from './handlers/report'
import { EventEmitter } from 'events'
import { CORE, coreEvents } from './handlers/events'
import { getLogger } from './handlers/loggers'
import { SyncInstance } from './models/sync'
import { SyncStatus } from './interfaces/sync-status.interface'

export class SyncManager {
  private readonly server: Server
  private readonly appEvents: EventEmitter
  private syncs: SyncInstance[] = []
  private mustExit = false

  constructor(server: Server, appEvents: EventEmitter = null) {
    this.server = server
    this.appEvents = appEvents
    this.checkBeforeStop = this.checkBeforeStop.bind(this)
    this.listeners()
  }

  private listeners() {
    coreEvents.once(CORE.EXIT, this.checkBeforeStop)
    coreEvents.on(CORE.SYNC_STOP, this.checkBeforeStop)
  }

  async run(syncPaths: SyncPath[], reportOnly = false, async = false) {
    if (async) {
      await Promise.all(syncPaths.map((syncPath: SyncPath) => this.runSync(syncPath, reportOnly)))
    } else {
      for (const syncPath of syncPaths) {
        if (this.mustExit) {
          break
        }
        await this.runSync(syncPath, reportOnly)
      }
    }
    this.removeListeners()
  }

  async runSync(syncPath: SyncPath, reportOnly = false) {
    const logger = getLogger(reportOnly ? 'Report' : 'Sync', { server: this.server.identity(), path: syncPath.identity() })
    logger.info(`${syncPath.localPath} ${syncPath.symbol} ${syncPath.remotePath}`)
    logger.info(
      `{FirstSync: ${syncPath.firstSync}, DiffMode: ${syncPath.diffMode}, ConflictMode: ${syncPath.conflictMode}, ReportOnly: ${reportOnly}}`
    )
    const req = new RequestsManager(this.server)
    const syncInstance = new SyncInstance(syncPath.id, req, reportOnly)
    this.syncs.push(syncInstance)
    this.sendSyncEvent({ serverId: this.server.id, syncPathId: syncPath.id, state: true, reportOnly: reportOnly })
    try {
      await syncPath.checks()
      const parser = new FilesParser(syncPath, req, reportOnly, this.appEvents)
      syncInstance.instance = parser
      await parser.run()
      const diffParser = new DiffParser(syncPath, parser)
      if (reportOnly) {
        const report = new Report(diffParser, logger, this.appEvents)
        syncInstance.instance = report
        await report.run()
      } else {
        const sync = new Sync(req, diffParser, logger, this.appEvents)
        syncInstance.instance = sync
        await sync.run()
        await parser.saveSnapshots(sync.wasAborted)
      }
    } catch (e) {
      logger.error(e)
      syncPath.mainError = `${e}`
      if (typeof e !== 'string') {
        logger.error(e.stack)
      }
    } finally {
      req.cleanOnExit()
      this.syncs.splice(this.syncs.indexOf(syncInstance), 1)
      this.sendSyncEvent({
        serverId: this.server.id,
        syncPathId: syncPath.id,
        state: false,
        reportOnly: reportOnly,
        mainError: syncPath.mainError,
        lastErrors: syncPath.lastErrors
      })
    }
  }

  checkBeforeStop(sync: { server: number; paths: number[] } = null, reportOnly: boolean) {
    if (sync && sync.server === this.server.id) {
      // stop sync for specific server/path (or all paths)
      this.mustExit = !sync.paths.length
      for (const s of sync.paths.length
        ? this.syncs.filter((s: SyncInstance) => sync.paths.indexOf(s.syncPathId) > -1 && s.reportOnly === reportOnly)
        : this.syncs) {
        s.instance.logger.warn('Stop sync requested : %O', sync)
        s.instance.stop()
        s.req.cleanOnExit(true)
      }
    } else {
      // stop all syncs
      this.mustExit = true
      for (const s of this.syncs) {
        s.instance.logger.warn('Stop sync requested : %O', sync)
        s.instance.stop()
        s.req.cleanOnExit(true)
      }
      this.removeListeners()
    }
  }

  private sendSyncEvent(params: SyncStatus) {
    coreEvents.emit(CORE.SYNC_STATUS, params)
  }

  private removeListeners() {
    coreEvents.removeListener(CORE.SYNC_STOP, this.checkBeforeStop)
    coreEvents.removeListener(CORE.EXIT, this.checkBeforeStop)
  }
}
