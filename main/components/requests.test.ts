import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_TOKEN_EXPIRED_ERROR } from '../../core/components/constants/auth'
import { API, CLIENT_MISSING_ERROR, CSRF_COOKIE_NAME } from '../../core/components/constants/requests'
import { CORE, coreEvents } from '../../core/components/handlers/events'
import type { Server } from '../../core/components/models/server'
import { partitionFor } from '../constants/windows'
import { MainRequestsManager } from './requests'

const electronMock = vi.hoisted(() => {
  const cookiesGet = vi.fn()
  const fetch = vi.fn()
  const fromPartition = vi.fn(() => ({
    cookies: { get: cookiesGet },
    fetch
  }))

  return {
    cookiesGet,
    fetch,
    nativeTheme: { shouldUseDarkColors: false },
    session: { fromPartition }
  }
})

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn()
}))

vi.mock('electron', () => ({
  nativeTheme: electronMock.nativeTheme,
  session: electronMock.session
}))

vi.mock('../../core/components/handlers/loggers', () => ({
  getLogger: vi.fn(() => loggerMock)
}))

vi.mock('../../core/components/utils/functions', () => ({
  genClientInfos: vi.fn(() => ({ platform: 'test' }))
}))

describe('MainRequestsManager', () => {
  let server: Server

  beforeEach(() => {
    vi.clearAllMocks()
    server = serverFixture()
    electronMock.cookiesGet.mockResolvedValue([])
    vi.spyOn(coreEvents, 'emit')
  })

  it('authenticates the server session in the main process and renews the client token locally', async () => {
    electronMock.fetch.mockResolvedValue(
      jsonResponse({
        server: { id: 1 },
        user: { login: 'user' },
        token: { access_expiration: 10, refresh_expiration: 20 },
        client_token_update: 'renewed-token'
      })
    )

    const result = await new MainRequestsManager(server).authenticateWithCookie()

    expect(electronMock.session.fromPartition).toHaveBeenCalledWith(partitionFor(server.id))
    expect(electronMock.fetch).toHaveBeenCalledWith(new URL(API.AUTH_COOKIE, server.url).toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clientId: 'client-id',
        token: 'client-token',
        info: { platform: 'test' }
      }),
      credentials: 'include'
    })
    expect(result).toEqual({
      server: { id: 1 },
      user: { login: 'user' },
      token: { access_expiration: 10, refresh_expiration: 20 }
    })
    expect(server.authToken).toBe('renewed-token')
    expect(server.authTokenExpired).toBe(false)
    expect(coreEvents.emit).toHaveBeenCalledWith(CORE.SAVE_SETTINGS)
  })

  it('rejects authentication before making a request when the client is not registered', async () => {
    server.authID = undefined

    await expect(new MainRequestsManager(server).authenticateWithCookie()).rejects.toThrow(CLIENT_MISSING_ERROR)

    expect(electronMock.fetch).not.toHaveBeenCalled()
  })

  it('rejects authentication before making a request when the client token is expired', async () => {
    server.authTokenExpired = true

    await expect(new MainRequestsManager(server).authenticateWithCookie()).rejects.toThrow(CLIENT_TOKEN_EXPIRED_ERROR)

    expect(electronMock.fetch).not.toHaveBeenCalled()
  })

  it('registers with the authenticated server session without returning the client token', async () => {
    electronMock.cookiesGet.mockResolvedValue([{ value: encodeURIComponent('signed-csrf-cookie') }])
    electronMock.fetch.mockResolvedValue(
      jsonResponse({
        clientId: 'registered-client',
        clientToken: 'registered-token'
      })
    )

    const result = await new MainRequestsManager(server).registerWithAuthenticatedSession()

    expect(electronMock.cookiesGet).toHaveBeenCalledWith({
      url: new URL(API.REGISTER_AUTH, server.url).toString(),
      name: CSRF_COOKIE_NAME
    })
    expect(electronMock.fetch).toHaveBeenCalledWith(new URL(API.REGISTER_AUTH, server.url).toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [CSRF_COOKIE_NAME]: 'signed-csrf-cookie'
      },
      body: JSON.stringify({
        clientId: 'client-id',
        info: { platform: 'test' }
      }),
      credentials: 'include'
    })
    expect(result).toEqual({ clientId: 'registered-client' })
    expect(result).not.toHaveProperty('clientToken')
    expect(server.authID).toBe('registered-client')
    expect(server.authToken).toBe('registered-token')
    expect(server.authTokenExpired).toBe(false)
    expect(coreEvents.emit).toHaveBeenCalledWith(CORE.SAVE_SETTINGS)
  })

  it('rejects invalid registration responses before updating stored credentials', async () => {
    electronMock.cookiesGet.mockResolvedValue([{ value: encodeURIComponent('signed-csrf-cookie') }])
    electronMock.fetch.mockResolvedValue(
      jsonResponse({
        clientId: 'registered-client'
      })
    )

    await expect(new MainRequestsManager(server).registerWithAuthenticatedSession()).rejects.toThrow('Invalid desktop client registration response')

    expect(server.authID).toBe('client-id')
    expect(server.authToken).toBe('client-token')
    expect(server.authTokenExpired).toBe(false)
    expect(coreEvents.emit).not.toHaveBeenCalledWith(CORE.SAVE_SETTINGS)
  })
})

function serverFixture(): Server {
  return {
    id: 1,
    name: 'Server',
    url: 'https://sync-in.example',
    authID: 'client-id',
    authToken: 'client-token',
    authTokenExpired: false
  } as Server
}

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: vi.fn().mockResolvedValue(JSON.stringify(data))
  } as unknown as Response
}
