import { RequestsManager } from './requests'
import { settingsManager } from './settings'
import { findByNameOrID, genClientInfos, genUUID } from '../utils/functions'
import { AxiosResponse } from 'axios'
import { Server } from '../models/server'
import { API } from '../constants/requests'
import { SYNC_SERVER } from '../constants/auth'
import type { SyncServerEvent } from '../interfaces/server.interface'
import { NAME_ALREADY_USED, URL_ALREADY_USED } from '../constants/errors'
import type { SyncClientAuthRegistration, SyncClientRegistration } from '../interfaces/sync-client-auth.interface'

export class ServersManager {
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

  static async unregister(s: Server): Promise<SyncServerEvent> {
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

  static saveSettings() {
    settingsManager.writeServersSettings()
  }

  static checkUpdatedProperties(serverProps: Partial<Server>, existingServer?: Server) {
    for (const s of ServersManager.list.filter((s: Server) => s.id !== serverProps.id)) {
      if (serverProps.url && s.url.toLowerCase() === serverProps.url.toLowerCase()) {
        throw URL_ALREADY_USED
      }
      if (s.name.toLowerCase() === serverProps.name.toLowerCase()) {
        throw NAME_ALREADY_USED
      }
    }
    // update server name
    if (existingServer) {
      existingServer.name = serverProps.name
    }
  }

  async check(): Promise<[boolean, string]> {
    try {
      const r: AxiosResponse = await this.req.http.get(API.HANDSHAKE)
      if (r.data.server === SYNC_SERVER) {
        return [true, null]
      }
      return [false, 'Server not found']
    } catch (e) {
      if (e.code === 'EPROTO') {
        return [false, 'Check server protocol (http/https)']
      } else if (e.response) {
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

  async add(auth?: SyncClientRegistration): Promise<[boolean, string]> {
    // `auth` is null only when adding a server in the desktop app.
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
        return [false, NAME_ALREADY_USED]
      }
      if (srv.url === this.server.url) {
        return [false, URL_ALREADY_USED]
      }
      lastID = Math.max(lastID, srv.id)
    }
    this.server.id = lastID + 1
    if (auth) {
      try {
        await this.register(auth.login, auth.password, auth.code)
      } catch (e) {
        return [false, e]
      }
    }
    settingsManager.servers.push(this.server)
    ServersManager.saveSettings()
    return [true, null]
  }

  async register(login: string, password: string, code?: string): Promise<void> {
    if (!this.server.authID) {
      this.server.authID = genUUID()
    }
    let r: AxiosResponse
    try {
      r = await this.req.http.post<SyncClientAuthRegistration>(API.REGISTER, {
        login,
        password,
        code,
        clientId: this.server.authID,
        info: genClientInfos()
      })
    } catch (e) {
      switch (e.response?.status) {
        case 401:
          throw e.response.data?.message || 'Wrong login or password'
        case 403:
          throw e.response.data?.message || 'Account suspended or not authorized'
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
}
