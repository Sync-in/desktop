/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { getLogger } from './components/handlers/loggers'
import { ServersManager } from './components/handlers/servers'
import { SyncManager } from './components/main'
import { CORE, coreEvents } from './components/handlers/events'
import { Server } from './components/models/server'
import { findByNameOrID } from './components/utils/functions'
import { SyncPath } from './components/models/syncpath'
import { EventEmitter } from 'events'
import { PathsManager } from './components/handlers/paths'
import { RequestsManager } from './components/handlers/requests'
import { CLIENT_TOKEN_EXPIRED_ERROR, SYNC_CLIENT_TYPE } from './components/constants/auth'

const mainLogger = getLogger('Runner')

export class RunManager {
  private mustExit = false
  private currentSyncs: { serverId: number; serverName: string; syncPathIds: number[] }[] = []
  // only used for desktop app
  private readonly appEvents: EventEmitter

  constructor(appEvents: EventEmitter = null) {
    this.appEvents = appEvents
    this.listeners()
  }

  private listeners() {
    if (this.appEvents) {
      // only used for desktop app
      coreEvents.on(CORE.SYNC_START, async (filter, reportOnly, async) => await this.run(filter, reportOnly, async))
    }
    ;['SIGTERM', 'SIGINT'].forEach((eventType) => {
      process.on(eventType, async (eventType) => {
        mainLogger.warn(`${eventType} signal received`)
        this.exitGracefully()
      })
    })
  }

  async run(filter = { server: undefined, paths: undefined }, reportOnly = false, async = true) {
    for (const server of this.getServers(filter.server)) {
      if (this.mustExit) {
        break
      }
      const syncPaths: SyncPath[] = this.checkCurrentSyncs(server.id, this.getPaths(server, filter.paths))
      if (!syncPaths.length) {
        continue
      }
      if (!(await RequestsManager.checkConnection(server))) {
        continue
      }
      if (!reportOnly) {
        for (const syncPath of syncPaths) {
          syncPath.updateLastSync()
        }
      }
      try {
        await this.updatePaths(server)
      } catch (e) {
        // client token is expired
        mainLogger.error(e.message)
        if (!this.appEvents) {
          mainLogger.error(`Use the command './${SYNC_CLIENT_TYPE.CLI}.js servers auth -s ${server.id} -u login -p password' to re-authenticate`)
        }
        continue
      }
      this.currentSyncs.push({ serverId: server.id, serverName: server.name, syncPathIds: syncPaths.map((s) => s.id) })
      const syncManager = new SyncManager(server, this.appEvents)
      await syncManager.run(syncPaths, reportOnly, async)
      this.currentSyncs = this.currentSyncs.filter(
        (s) => s.serverId != server.id && JSON.stringify(s.syncPathIds) === JSON.stringify(syncPaths.map((s) => s.id))
      )
    }
    if (this.appEvents) {
      if (this.mustExit && !this.currentSyncs.length) {
        process.exit()
      }
    } else if (!reportOnly) {
      // save conf in cmd mode
      coreEvents.emit(CORE.SAVE_SETTINGS, false, this.mustExit)
    }
  }

  private checkCurrentSyncs(serverId: number, syncPaths: SyncPath[]) {
    for (const inSync of this.currentSyncs) {
      if (inSync.serverId === serverId) {
        for (const syncPath of syncPaths) {
          if (inSync.syncPathIds.indexOf(syncPath.id) > -1) {
            syncPaths = syncPaths.filter((s) => s !== syncPath)
            mainLogger.warn(`[${inSync.serverName}:${syncPath.name}] is already in sync`)
          }
        }
      }
    }
    return syncPaths
  }

  private async updatePaths(server: Server) {
    const manager = new PathsManager(server.id)
    try {
      await manager.update()
    } catch (e) {
      if (e.message === CLIENT_TOKEN_EXPIRED_ERROR) {
        server.authTokenExpired = true
        throw new Error(`${CLIENT_TOKEN_EXPIRED_ERROR} for server ${server.name} (${server.id})`)
      } else {
        mainLogger.error(`Update Paths ${server.name}: ${e.message}`)
      }
    }
  }

  exitGracefully() {
    if (!this.mustExit) {
      this.mustExit = true
      coreEvents.emit(CORE.SAVE_SETTINGS, false, this.mustExit)
      if (this.appEvents && !this.currentSyncs.length) {
        process.exit()
      } else {
        coreEvents.emit(CORE.EXIT)
      }
    }
  }

  private getServers(filterServer?: number | string): Server[] {
    if (filterServer) {
      const server = findByNameOrID(filterServer, ServersManager.list)
      if (server) {
        return [server]
      } else {
        mainLogger.warn(`unable to find server: ${filterServer}`)
        return []
      }
    } else {
      return ServersManager.list
    }
  }

  private getPaths(server: Server, filterPaths?: (number | string)[]): SyncPath[] {
    if (filterPaths) {
      const syncPaths: SyncPath[] = filterPaths.map((sp) => findByNameOrID(sp, server.syncPaths)).filter(Boolean)
      if (syncPaths.length) {
        return syncPaths.filter((sp) => sp.enabled)
      } else {
        mainLogger.warn(`unable to find path: ${filterPaths}`)
        return []
      }
    } else {
      return server.syncPaths.filter((s: SyncPath) => s.enabled)
    }
  }
}
