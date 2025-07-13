/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */
import { ServersManager } from './servers'
import { Logger } from 'winston'
import { getLogger } from './loggers'
import { SyncPath } from '../models/syncpath'
import { Server } from '../models/server'
import { EventEmitter } from 'events'
import { CORE, coreEvents } from './events'
import { LOCAL_RENDERER } from '../../../main/constants/events'
import { SyncStatus } from '../interfaces/sync-status.interface'
import { SERVER_SCHEDULER_STATE } from '../constants/server'

export class Scheduler {
  private readonly checkQueueInterval = 60000 // ms
  private readonly timeValues = { second: 1, minute: 60, hour: 3600, day: 86400 }
  private readonly appEvents: EventEmitter
  private jobs: Record<number, { id: number; name: string; unit: string; value: number; interval: any }[]> = {} // key => Server.id
  private queue: Record<number, number[]> = {} // key => Server.id
  private active: Record<number, number[]> = {}
  private runner = null
  private logger: Logger
  private bootIsDone = false

  constructor(appEvents: EventEmitter = null) {
    this.appEvents = appEvents
    this.logger = getLogger('Scheduler')
    this.listeners()
    this.logger.info('scheduler loaded')
  }

  private listeners() {
    // manage power suspension
    if (this.appEvents) {
      this.appEvents.on(LOCAL_RENDERER.POWER.SUSPENSION_EVENT, (state: boolean) => this.powerSuspension(state))
    }
    coreEvents.on(CORE.SYNC_STATUS, (params: SyncStatus) => this.onSync(params.serverId, params.syncPathId, params.state))
    coreEvents.on(CORE.SAVE_SETTINGS, (reloadConf?: boolean, exit?: boolean) => {
      if (reloadConf) {
        if (this.bootIsDone) {
          this.logger.debug('restart (settings has been saved)')
          this.stop()
        } else {
          this.bootIsDone = true
          this.logger.debug('start (settings has been saved)')
        }
        this.start()
      } else if (exit) {
        this.stop()
      }
    })
  }

  private start() {
    this.clearRunnerInterval()
    const hasJobs = this.loadJobs()
    if (hasJobs) {
      this.runner = setInterval(this.run.bind(this), this.checkQueueInterval)
      this.logger.info('started')
    }
  }

  private stop() {
    this.clearRunnerInterval()
    this.removeAllJobs()
    this.logger.info('stopped')
  }

  private run() {
    for (const [serverId, syncPathIdS] of Object.entries(this.queue).filter(([, pathIDS]) => pathIDS.length)) {
      // do not start sync for running syncs
      const ids = this.active[serverId] ? syncPathIdS.filter((id) => this.active[serverId].indexOf(id) === -1) : syncPathIdS
      if (ids.length) {
        try {
          const server = ServersManager.find(parseInt(serverId))
          this.logger.info(`run - ${server.name}:${ids}`)
          coreEvents.emit(
            CORE.SYNC_START,
            { server: server.id, paths: [...new Set(ids)] },
            false,
            server.syncScheduler === SERVER_SCHEDULER_STATE.ASYNC
          )
        } catch (e) {
          this.logger.error(`unable to find server with id: ${serverId} : ${e}`)
        }
      }
    }
  }

  private setJobInterval(serverId: number, syncPathId: number, interval: number) {
    return setInterval(this.addToQueue.bind(this), interval - 1000, serverId, syncPathId)
  }

  private addToQueue(serverId: number, syncPathId: number) {
    this.logger.info(`add to queue - ${serverId}:${syncPathId}`)
    if (this.queue[serverId]) {
      if (this.queue[serverId].indexOf(syncPathId) === -1) {
        this.queue[serverId].push(syncPathId)
      }
    } else {
      this.queue[serverId] = [syncPathId]
    }
  }

  private removeFromQueue(serverId: number, syncPathId: number) {
    if (this.queue[serverId]) {
      this.logger.info(`remove from queue - ${serverId}:${syncPathId}`)
      this.queue[serverId] = this.queue[serverId].filter((sid: number) => sid !== syncPathId)
    }
  }

  private loadJobs(): boolean {
    let hasJobs = false
    for (const server of ServersManager.list.filter(
      (s) => !s.authTokenExpired && s.available && s.syncScheduler !== SERVER_SCHEDULER_STATE.DISABLED
    )) {
      const syncPaths = server.syncPaths.filter((sp) => sp.enabled && sp.scheduler.unit !== 'disabled')
      if (syncPaths.length) {
        this.addJob(server, syncPaths)
        hasJobs = true
      }
    }
    return hasJobs
  }

  private addJob(server: Server, syncPaths: SyncPath[]) {
    for (const syncPath of syncPaths) {
      this.logger.info(`add job - ${server.name}:${syncPath.name} - %O`, syncPath.scheduler)
      const interval = this.timeValues[syncPath.scheduler.unit] * syncPath.scheduler.value * 1000
      const job = {
        id: syncPath.id,
        name: syncPath.name,
        unit: syncPath.scheduler.unit,
        value: syncPath.scheduler.value,
        interval: this.setJobInterval(server.id, syncPath.id, interval)
      }
      if (this.jobs[server.id]) {
        this.jobs[server.id].push(job)
      } else {
        this.jobs[server.id] = [job]
      }
      if (syncPath.lastSync) {
        const sDate = new Date(syncPath.lastSync)
        sDate.setSeconds(sDate.getSeconds() + interval / 1000)
        if (sDate < new Date()) {
          this.addToQueue(server.id, syncPath.id)
        }
      } else {
        this.addToQueue(server.id, syncPath.id)
      }
    }
  }

  private onSync(serverId: number, syncPathId: number, state: boolean) {
    if (state) {
      this.logger.info(`add to active - ${serverId}:${syncPathId}`)
      if (this.active[serverId]) {
        if (this.active[serverId].indexOf(syncPathId) === -1) {
          this.active[serverId].push(syncPathId)
        }
      } else {
        this.active[serverId] = [syncPathId]
      }
    } else if (this.active[serverId]) {
      this.logger.info(`remove from active - ${serverId}:${syncPathId}`)
      this.active[serverId] = this.active[serverId].filter((id) => id !== syncPathId)
      this.removeFromQueue(serverId, syncPathId)
    }
  }

  private removeAllJobs() {
    for (const [serverId, jobs] of Object.entries(this.jobs)) {
      for (const job of jobs) {
        this.logger.info(`remove job - ${serverId}:${job.name} (${job.id})`)
        clearInterval(job.interval)
      }
      this.jobs[serverId] = []
    }
    this.queue = {}
  }

  private powerSuspension(state: boolean) {
    if (state) {
      this.stop()
    } else {
      this.start()
    }
  }

  private clearRunnerInterval() {
    clearInterval(this.runner)
    this.runner = null
  }
}
