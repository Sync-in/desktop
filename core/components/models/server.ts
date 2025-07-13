/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { SyncPath } from './syncpath'
import type { SyncServer } from '../interfaces/server.interface'
import { SERVER_SCHEDULER_STATE } from '../constants/server'

export class Server implements SyncServer {
  public id: number = 0
  public name: string
  public url: string
  public available: boolean
  public authID: string
  public authToken: string
  public authTokenExpired: boolean
  public syncScheduler: SERVER_SCHEDULER_STATE = SERVER_SCHEDULER_STATE.ASYNC
  public syncPaths: SyncPath[] = []
  // tokens
  public accessToken: string = null
  public refreshToken: string = null
  public refreshTokenExpiration = 0

  constructor(data: any) {
    this.id = data.id || this.id
    this.name = data.name
    this.url = data.url?.trim().replace(/\/+$/, '').toLowerCase()
    this.available = data.available || false
    this.authID = data.authID || undefined
    this.authToken = data.authToken || undefined
    this.authTokenExpired = data.authTokenExpired || false
    this.syncScheduler = data.syncScheduler || this.syncScheduler
    if (data.syncPaths) {
      this.syncPaths = data.syncPaths.map((data: Partial<SyncPath>) => new SyncPath(data))
    }
  }

  toString() {
    return { id: this.id, name: this.name, url: this.url }
  }

  identity() {
    return { id: this.id, name: this.name }
  }

  export() {
    return {
      id: this.id,
      name: this.name,
      url: this.url,
      available: this.available,
      authID: this.authID,
      authToken: this.authToken,
      authTokenExpired: this.authTokenExpired,
      syncScheduler: this.syncScheduler,
      syncPaths: this.syncPaths
    }
  }

  printName() {
    return `${'*'.repeat(5)} Server: ${this.name} (${this.id}) ${this.url} ${'*'.repeat(5)}`
  }

  addSync(sync: SyncPath) {
    if (this.syncPaths.map((s) => s.id).indexOf(sync.id) > -1) {
      throw 'Sync already exists'
    }
    this.syncPaths.push(sync)
  }
}
