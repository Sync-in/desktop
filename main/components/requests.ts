import { session } from 'electron'
import { API, CLIENT_MISSING_ERROR, CSRF_COOKIE_NAME } from '../../core/components/constants/requests'
import { CLIENT_TOKEN_EXPIRED_ERROR } from '../../core/components/constants/auth'
import { CORE, coreEvents } from '../../core/components/handlers/events'
import { getLogger } from '../../core/components/handlers/loggers'
import type { SyncClientAuthCookie, SyncClientAuthRegistration } from '../../core/components/interfaces/sync-client-auth.interface'
import type { Server } from '../../core/components/models/server'
import { genClientInfos } from '../../core/components/utils/functions'
import { partitionFor } from '../constants/windows'
import { decodeCookieValue, nonEmptyString } from './utils'

export type SyncClientAuthenticatedRegistration = Pick<SyncClientAuthRegistration, 'clientId'>

export class MainRequestsManager {
  private readonly logger = getLogger('MainRequests')

  constructor(private readonly server: Server) {}

  async authenticateWithCookie(): Promise<SyncClientAuthCookie> {
    if (!this.server.authID || !this.server.authToken) {
      this.debug('missing desktop client credentials')
      throw new Error(CLIENT_MISSING_ERROR)
    }
    if (this.server.authTokenExpired) {
      this.debug('desktop client token is marked as expired')
      throw new Error(CLIENT_TOKEN_EXPIRED_ERROR)
    }
    this.debug('authenticating server session with desktop client credentials')
    const auth = await this.postJson<SyncClientAuthCookie>(API.AUTH_COOKIE, {
      clientId: this.server.authID,
      token: this.server.authToken,
      info: genClientInfos()
    })
    if (auth.client_token_update) {
      this.debug('server returned a renewed desktop client token')
      this.updateClientToken(auth.client_token_update)
      delete auth.client_token_update
    }
    this.debug('server session authenticated')
    return auth
  }

  async registerWithAuthenticatedSession(): Promise<SyncClientAuthenticatedRegistration> {
    this.debug('registering desktop client from authenticated server session')
    const registration = this.validateRegistration(
      await this.postJson<SyncClientAuthRegistration>(
        API.REGISTER_AUTH,
        {
          clientId: this.server.authID,
          info: genClientInfos()
        },
        true
      )
    )
    this.server.authID = registration.clientId
    this.server.authToken = registration.clientToken
    this.server.authTokenExpired = false
    coreEvents.emit(CORE.SAVE_SETTINGS)
    this.debug('desktop client registration stored')
    return { clientId: registration.clientId }
  }

  private updateClientToken(token: string) {
    this.server.authToken = token
    this.server.authTokenExpired = false
    this.logger.info(`Client token was renewed for server *${this.server.name}* (${this.server.id})`)
    coreEvents.emit(CORE.SAVE_SETTINGS)
  }

  private validateRegistration(registration: SyncClientAuthRegistration): SyncClientAuthRegistration {
    if (!nonEmptyString(registration?.clientId) || !nonEmptyString(registration?.clientToken)) {
      throw new Error('Invalid desktop client registration response')
    }
    return registration
  }

  private async postJson<T>(path: string, body: Record<string, any>, withCsrf = false): Promise<T> {
    const serverSession = session.fromPartition(partitionFor(this.server.id))
    const requestUrl = new URL(path, this.server.url).toString()
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    }
    if (withCsrf) {
      const [csrfCookie] = await serverSession.cookies.get({ url: requestUrl, name: CSRF_COOKIE_NAME })
      if (csrfCookie?.value) {
        headers[CSRF_COOKIE_NAME] = decodeCookieValue(csrfCookie.value)
      }
    }
    this.debug(`POST ${path}${withCsrf ? ' with CSRF' : ''}`)
    const response = await serverSession.fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include'
    })
    return await this.parseJson<T>(response)
  }

  private async parseJson<T>(response: Response): Promise<T> {
    const raw = await response.text()
    let data: any = null
    if (raw) {
      try {
        data = JSON.parse(raw)
      } catch {
        data = { message: raw }
      }
    }
    if (!response.ok) {
      this.debug(`server responded with ${response.status}`)
      const message = Array.isArray(data?.message) ? data.message.join(', ') : data?.message || data?.error || response.statusText
      const error = new Error(message || `HTTP ${response.status}`)
      Object.assign(error, { status: response.status, data })
      throw error
    }
    this.debug(`server responded with ${response.status}`)
    return data as T
  }

  private debug(message: string) {
    this.logger.debug(`[server:${this.server.id}] ${message}`)
  }
}
