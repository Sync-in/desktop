/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { setTimeout } from 'timers/promises'
import http from 'http'
import https from 'https'
import { genClientInfos } from '../utils/functions'
import { getLogger } from './loggers'
import { Server } from '../models/server'
import { USER_AGENT } from '../../constants'
import { CORE, coreEvents } from './events'
import { API, TOKEN_RESPONSE } from '../constants/requests'
import { Readable } from 'stream'
import { buffer } from 'node:stream/consumers'
import { AxiosExtendedRequestConfig } from '../interfaces/request.interface'
import { CONNECTION_ERRORS } from '../constants/errors'

const logger = getLogger('Http')

export class RequestsManager {
  // instance
  public http: AxiosInstance
  // auth token state
  private authorizing: Promise<void> | null = null
  private maxFailedTokenReq = 3
  private countFailedTokenReq = 0
  // retry state
  private countReqsRetry = 0
  private countRetry = 0
  private maxRetry = 3
  private retryDelay = 2000
  // config
  public server: Server
  private httpController = new AbortController()
  private httpAgent = new http.Agent({ keepAlive: true, maxSockets: 25 })
  private httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 25, rejectUnauthorized: false })
  private httpConfig: AxiosRequestConfig = {
    baseURL: '',
    headers: { 'User-Agent': USER_AGENT, Connection: 'Keep-Alive' },
    // keepAlive pools and reuses TCP connections, so it's faster
    httpAgent: this.httpAgent,
    httpsAgent: this.httpsAgent,
    signal: this.httpController.signal,
    maxRedirects: 0
  }

  constructor(server: Server, checkToken = true) {
    this.server = server
    this.httpConfig.baseURL = this.server.url
    this.http = axios.create(this.httpConfig)
    if (checkToken && !this.server.authToken) {
      throw `Authentication Token is missing for server: ${this.server.name} ${this.server.url}`
    }
    this.setToken()
    this.initInterceptor()
  }

  cleanOnExit(exited = false) {
    if (exited) {
      this.httpController.abort()
    }
    this.httpAgent.destroy()
    this.httpsAgent.destroy()
    logger.debug(`Cleanup done (exited: ${exited})`)
  }

  private initInterceptor() {
    this.http.interceptors.response.use(undefined, async (error: AxiosError) => {
      if (error.response?.status === 401 && [API.AUTH_TOKEN, API.REGISTER].indexOf(error.config.url) === -1) {
        if (this.countFailedTokenReq >= this.maxFailedTokenReq) {
          logger.warn('Too many authentication failures')
          coreEvents.emit(CORE.SYNC_STOP, { server: this.server.id, paths: [] })
          throw error
        }
        const req: AxiosExtendedRequestConfig = error.config
        logger.debug(`Intercepting [401] [${req.url}] [${this.countFailedTokenReq + 1}/${this.maxFailedTokenReq}]`)
        this.authorizing ??= this.isRefreshTokenIsExpired() ? this.getToken() : this.refreshToken()
        return this.authorizing
          .then(() => {
            delete req.headers['Authorization']
            // if exists, recreate read stream
            if (typeof req.getData === 'function') {
              req.data = req.getData()
            }
            return this.http.request(req)
          })
          .catch((e) => Promise.reject(e))
          .finally(() => (this.authorizing = null))
      } else if (CONNECTION_ERRORS.has(error.code)) {
        // break point to stop all pending requests
        if (this.countRetry >= this.maxRetry) {
          logger.warn('Too many connections refused')
          coreEvents.emit(CORE.SYNC_STOP, { server: this.server.id, paths: [] })
          throw error
        }
        const req: InternalAxiosRequestConfig = error.config
        this.countReqsRetry += 1
        // incremental timeout to wait for server
        return setTimeout((this.countReqsRetry || 1) * this.retryDelay).then(() => {
          this.countRetry += 1
          logger.debug(`Intercepting [${error.code}] [${req.url}] [${this.countRetry}/${this.maxRetry}]`)
          // infinite request return
          return this.http.request(req).then(() => {
            this.countRetry = 0
            this.countReqsRetry = 0
          })
        })
      }
      throw error
    })
  }

  private async refreshToken(): Promise<void> {
    logger.debug('Updating Access Token')
    try {
      const r: AxiosResponse = await this.http.post<TOKEN_RESPONSE>(API.AUTH_TOKEN_REFRESH, null, {
        headers: { Authorization: `Bearer ${this.server.refreshToken}` }
      })
      this.setToken(r.data)
      logger.debug('Access Token OK')
    } catch (e) {
      logger.warn(`Access Token KO : ${await RequestsManager.handleHttpError(e)}`)
      throw e
    }
  }

  private async getToken(): Promise<void> {
    logger.debug('Getting Access & Refresh Tokens')
    try {
      const r: AxiosResponse = await this.http.post<TOKEN_RESPONSE>(API.AUTH_TOKEN, {
        clientId: this.server.authID,
        token: this.server.authToken,
        info: genClientInfos()
      })
      this.setToken(r.data)
      this.countFailedTokenReq = 0
      logger.debug('Access & Refresh Tokens OK')
    } catch (e) {
      this.countFailedTokenReq += 1
      logger.warn('Access & Refresh Tokens KO')
      logger.warn(await RequestsManager.handleHttpError(e))
      throw e
    }
  }

  static async checkConnection(server: Server) {
    try {
      const r = await axios({
        method: 'get',
        url: server.url,
        headers: { 'User-Agent': USER_AGENT },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 3000
      })
      if (r.status !== 200) {
        logger.warn(`Connection ${server.url} ${r.statusText} ${r.status}`)
        return false
      }
      return true
    } catch (e) {
      logger.warn(`Connection ${e}`)
      return false
    }
  }

  static async handleHttpError(error: AxiosError | Error, simple = false): Promise<any> {
    if (axios.isAxiosError(error)) {
      const res = error.response

      if (!res) {
        if (simple) {
          return Array.isArray(error.message) ? error.message.join(', ') : error.message
        }
        return error.toJSON()
      }

      const info = { status: res.status, message: '', error: res.data?.error }

      if (res.data) {
        if (typeof res.data === 'object' && !(res.data instanceof Readable)) {
          // json error
          info.message = res.data.message
          info.error = res.data.error
        } else if (typeof res.data.pipe === 'function') {
          // streamed error
          try {
            const stringBuffer = (await buffer(res.data)).toString('utf8')
            const parsed: { statusCode: number; message: string } = JSON.parse(stringBuffer)
            info.message = parsed.message
          } catch (e) {
            console.error(`Unable to parse stream error : ${e}`)
          }
        }
      }

      const e: string[] | string = info.message || info.error
      if (simple) {
        return Array.isArray(e) ? e.join(', ') : e
      } else {
        return `[${info.status}] [${error.config.url}] ${e}`
      }
    }
    return error.message
  }

  private setToken(r?: TOKEN_RESPONSE) {
    if (r) {
      this.server.accessToken = r.access
      this.server.refreshTokenExpiration = r.refresh_expiration
      this.server.refreshToken = r.refresh
      if (r?.client_token_update) {
        logger.info(`Client token was renewed for server *${this.server.name}* (${this.server.id})`)
        this.server.authToken = r.client_token_update
        coreEvents.emit(CORE.SAVE_SETTINGS)
      }
    }
    if (this.server.accessToken) {
      this.http.defaults.headers.common = { Authorization: `Bearer ${this.server.accessToken}` }
    }
  }

  private isRefreshTokenIsExpired(): boolean {
    if (this.server.refreshTokenExpiration <= Math.floor(new Date().getTime() / 1000)) {
      logger.debug('Tokens are expired')
      this.server.accessToken = null
      this.server.refreshToken = null
      return true
    }
    return false
  }
}
