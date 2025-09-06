/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { RequestsManager } from './requests'
import { settingsManager } from './settings'
import { findByNameOrID, genClientInfos, genUUID } from '../utils/functions'
import { AxiosResponse } from 'axios'
import { Server } from '../models/server'
import { API } from '../constants/requests'
import { SYNC_SERVER } from '../constants/auth'

export class ServersManager {
  // constants
  server: Server
  req: RequestsManager

  constructor(server: Server, checkToken = true) {
    this.server = server
    this.req = new RequestsManager(server, checkToken)
  }

  static get list(): Server[] {
    return settingsManager.servers
  }

  static find(serverNameOrID: string | number): Server {
    const server: Server = findByNameOrID(serverNameOrID, ServersManager.list)
    if (!server) {
      throw `Server ${serverNameOrID} not found`
    }
    return server
  }

  static async unregister(s: Server): Promise<{ ok: boolean; msg?: string }> {
    const server = ServersManager.find(s.id)
    if (server.authToken) {
      const req = new RequestsManager(server)
      try {
        await req.http.post(API.UNREGISTER)
      } catch (e) {
        console.error(await RequestsManager.handleHttpError(e))
      }
    }
    if (server.syncPaths && server.syncPaths.length) {
      for (const syncPath of server.syncPaths) {
        await syncPath.removeSnapShots(server.id)
      }
    }
    settingsManager.servers = settingsManager.servers.filter((srv) => srv.id !== server.id)
    ServersManager.saveSettings()
    return { ok: true }
  }

  async checkUpdatedProperties(server?: Server) {
    if (!server) {
      server = this.server
    }
    for (const s of ServersManager.list.filter((s: Server) => s.id !== server.id)) {
      if (server.url && s.url.toLowerCase() === server.url.toLowerCase()) {
        throw 'URL is already used'
      }
      if (s.name.toLowerCase() === server.name.toLowerCase()) {
        throw 'Name is already used'
      }
    }
    // update server name
    this.server.name = server.name
  }

  async check(): Promise<[boolean, string]> {
    try {
      const r: AxiosResponse = await this.req.http.get(API.HANDSHAKE)
      if (r.data.server === SYNC_SERVER) {
        return [true, null]
      }
      return [false, 'Server not found']
    } catch (e) {
      if (e.response) {
        switch (e.response.status) {
          case 404:
            return [false, 'Server not found']
          case 502:
            return [false, 'Server not reachable']
        }
      }
      return [false, await RequestsManager.handleHttpError(e, true)]
    }
  }

  async add(login: string, password: string): Promise<[boolean, string]> {
    try {
      const [ok, msg] = await this.check()
      if (!ok) {
        return [false, msg]
      }
    } catch (e) {
      return [false, e.message]
    }
    let lastID = 0
    for (const srv of settingsManager.servers) {
      if (srv.name.toLowerCase() === this.server.name.toLowerCase()) {
        return [false, 'Name is already used']
      }
      if (srv.url === this.server.url) {
        return [false, 'URL is already used']
      }
      lastID = Math.max(lastID, srv.id)
    }
    this.server.id = lastID + 1
    try {
      await this.register(login, password)
    } catch (e) {
      return [false, e]
    }
    settingsManager.servers.push(this.server)
    ServersManager.saveSettings()
    return [true, null]
  }

  async register(login: string, password: string): Promise<void> {
    if (!this.server.authID) {
      this.server.authID = genUUID()
    }
    let r: AxiosResponse
    try {
      r = await this.req.http.post<{ clientToken: string }>(API.REGISTER, { login, password, clientId: this.server.authID, info: genClientInfos() })
    } catch (e) {
      switch (e.response?.status) {
        case 401:
          throw 'Wrong login or password'
        case 403:
          throw 'Account suspended or not authorized'
        default:
          throw await RequestsManager.handleHttpError(e, true)
      }
    }
    if ('clientToken' in r.data) {
      this.server.authToken = r.data.clientToken
      this.server.authTokenExpired = false
    } else {
      throw 'Client token is missing'
    }
  }

  static saveSettings() {
    settingsManager.writeServersSettings()
  }
}
