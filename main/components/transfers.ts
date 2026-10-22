import { ServersManager } from '../../core/components/handlers/servers'
import fs from 'node:fs/promises'
import readline from 'node:readline'
import { setMimeType, sortObjsByDate } from './utils'
import { createReadStream, existsSync } from 'node:fs'
import type { SyncTransfer } from '@sync-in-desktop/core/components/interfaces/sync-transfer.interface'
import { DEFAULT_HIGH_WATER_MARK } from '@sync-in-desktop/core/components/constants/handlers'

export class TransfersLogs {
  private maxLines = 1000
  private readonly search: RegExp
  private syncPaths: any[] = []
  private logs: any[] = []

  constructor(serverId: number, syncPathId: number, query: string) {
    this.search = query ? new RegExp(query, 'i') : null
    const server = ServersManager.find(serverId)
    if (syncPathId) {
      const syncPath = server.syncPaths.find((s) => s.id === syncPathId)
      this.syncPaths.push({ id: syncPath.id, name: syncPath.name, log: syncPath.getLogsPath(server.id) })
    } else {
      this.syncPaths = server.syncPaths.map((s) => ({ id: s.id, name: s.name, log: s.getLogsPath(server.id) }))
    }
  }

  async get(): Promise<SyncTransfer[]> {
    this.syncPaths = this.syncPaths.filter((syncPath: any) => existsSync(syncPath.log))
    if (!this.syncPaths.length) {
      return this.logs
    }
    const logs: SyncTransfer[] = []
    for (const arrayOfLogs of await Promise.all(this.syncPaths.map((logFile: string) => this.readLogs(logFile)))) {
      logs.push(...arrayOfLogs)
    }
    sortObjsByDate(logs, 'timestamp')
    if (logs.length > this.maxLines) {
      logs.splice(-(logs.length - this.maxLines))
    }
    return logs.map((l: SyncTransfer) => setMimeType(l))
  }

  async delete() {
    for (const syncPath of this.syncPaths) {
      await fs.truncate(syncPath.log, 0)
    }
  }

  private async readLogs(syncPath: any): Promise<SyncTransfer[]> {
    let nbLines = 0
    let counter = 0
    const lines = []
    const rl = readline.createInterface({
      input: createReadStream(syncPath.log, { encoding: 'utf-8', highWaterMark: DEFAULT_HIGH_WATER_MARK }),
      terminal: false,
      crlfDelay: Infinity
    })
    for await (const line of rl) {
      nbLines++
      if (line.includes('file') && (!this.search || this.search.test(line))) {
        lines.unshift([`${syncPath.id}${nbLines}`, line])
        counter++
        if (counter > this.maxLines * 2) {
          lines.splice(-this.maxLines)
          counter = lines.length
        }
      }
    }
    if (lines.length > this.maxLines) {
      lines.splice(-(lines.length - this.maxLines))
    }
    return lines.map(([id, line]) => ({ ...{ id: Number(id), syncPathName: syncPath.name }, ...JSON.parse(line) }))
  }
}
