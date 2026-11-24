import { AxiosError } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { SYNC_UPLOAD_SESSION_MIN_CHUNK_SIZE } from '../constants/requests'
import { parseTransfersCapability } from '../utils/upload-session'
import { RequestsManager } from './requests'

describe('RequestsManager transfer capability negotiation', () => {
  it('uses the legacy transfer path when the server advertises no capability', () => {
    expect(parseTransfersCapability(undefined)).toBeUndefined()
  })

  it.each([0, -1, 1.5, 999_999, Number.MAX_SAFE_INTEGER + 1, '1000000'])('ignores invalid maxChunkSize value %j', (maxChunkSize) => {
    expect(parseTransfersCapability({ maxChunkSize })).toBeUndefined()
  })

  it('accepts an unbounded chunk size', () => {
    const capability = { maxChunkSize: null }

    expect(parseTransfersCapability(capability)).toEqual(capability)
  })

  it('accepts the minimum supported chunk size', () => {
    const capability = { maxChunkSize: SYNC_UPLOAD_SESSION_MIN_CHUNK_SIZE }

    expect(parseTransfersCapability(capability)).toEqual(capability)
  })
})

describe('RequestsManager access-token initialization', () => {
  it('authenticates before synchronization when no access token exists', async () => {
    const requests = Object.create(RequestsManager.prototype) as RequestsManager
    requests.server = { accessToken: null, authentication: null } as any
    ;(requests as any).httpController = new AbortController()
    const getToken = vi.spyOn(requests as any, 'getToken').mockResolvedValue(undefined)
    const setToken = vi.spyOn(requests as any, 'setToken').mockReturnValue(undefined)

    await requests.ensureAccessToken()

    expect(getToken).toHaveBeenCalledOnce()
    expect(setToken).toHaveBeenCalledOnce()
  })

  it('shares one authentication between parallel syncs and applies its token to both clients', async () => {
    const server = { accessToken: null, authentication: null } as any
    const first = Object.create(RequestsManager.prototype) as RequestsManager
    const second = Object.create(RequestsManager.prototype) as RequestsManager
    first.server = server
    second.server = server
    first.http = { defaults: { headers: {} } } as any
    second.http = { defaults: { headers: {} } } as any
    ;(first as any).httpController = new AbortController()
    ;(second as any).httpController = new AbortController()
    let releaseAuthentication!: () => void
    const authenticationPending = new Promise<void>((resolve) => (releaseAuthentication = resolve))
    const firstGetToken = vi.spyOn(first as any, 'getToken').mockImplementation(async () => {
      await authenticationPending
      server.accessToken = 'access-token'
    })
    const secondGetToken = vi.spyOn(second as any, 'getToken').mockResolvedValue(undefined)

    const firstAuthentication = first.ensureAccessToken()
    const secondAuthentication = second.ensureAccessToken()
    releaseAuthentication()
    await Promise.all([firstAuthentication, secondAuthentication])

    expect(firstGetToken).toHaveBeenCalledOnce()
    expect(secondGetToken).not.toHaveBeenCalled()
    expect(first.http.defaults.headers.common).toEqual({ Authorization: 'Bearer access-token' })
    expect(second.http.defaults.headers.common).toEqual({ Authorization: 'Bearer access-token' })
  })

  it('lets an active waiter resume authentication when the leading sync is canceled', async () => {
    const server = { accessToken: null, authentication: null } as any
    const first = Object.create(RequestsManager.prototype) as RequestsManager
    const second = Object.create(RequestsManager.prototype) as RequestsManager
    first.server = server
    second.server = server
    first.http = { defaults: { headers: {} } } as any
    second.http = { defaults: { headers: {} } } as any
    ;(first as any).httpController = new AbortController()
    ;(second as any).httpController = new AbortController()
    let rejectAuthentication!: (error: Error) => void
    const authenticationPending = new Promise<void>((_resolve, reject) => (rejectAuthentication = reject))
    const canceled = new AxiosError('canceled', 'ERR_CANCELED')
    vi.spyOn(first as any, 'getToken').mockReturnValue(authenticationPending)
    const secondGetToken = vi.spyOn(second as any, 'getToken').mockImplementation(async () => {
      server.accessToken = 'replacement-access-token'
    })

    const firstAuthentication = first.ensureAccessToken().catch((error) => error)
    const secondAuthentication = second.ensureAccessToken()
    ;(first as any).httpController.abort()
    rejectAuthentication(canceled)

    await expect(secondAuthentication).resolves.toBeUndefined()
    await expect(firstAuthentication).resolves.toMatchObject({ code: 'ERR_CANCELED', message: 'canceled' })
    expect(secondGetToken).toHaveBeenCalledOnce()
    expect(second.http.defaults.headers.common).toEqual({ Authorization: 'Bearer replacement-access-token' })
  })

  it('lets a canceled waiter leave without interrupting the leading authentication', async () => {
    const server = { accessToken: null, authentication: null } as any
    const first = Object.create(RequestsManager.prototype) as RequestsManager
    const second = Object.create(RequestsManager.prototype) as RequestsManager
    first.server = server
    second.server = server
    first.http = { defaults: { headers: {} } } as any
    second.http = { defaults: { headers: {} } } as any
    ;(first as any).httpController = new AbortController()
    ;(second as any).httpController = new AbortController()
    let releaseAuthentication!: () => void
    const authenticationPending = new Promise<void>((resolve) => (releaseAuthentication = resolve))
    const firstGetToken = vi.spyOn(first as any, 'getToken').mockImplementation(async () => {
      await authenticationPending
      server.accessToken = 'access-token'
    })
    const secondGetToken = vi.spyOn(second as any, 'getToken').mockResolvedValue(undefined)

    const firstAuthentication = first.ensureAccessToken()
    const secondAuthentication = second.ensureAccessToken().catch((error) => error)
    ;(second as any).httpController.abort()

    await expect(secondAuthentication).resolves.toMatchObject({ code: 'ERR_CANCELED' })
    expect(server.authentication).not.toBeNull()
    releaseAuthentication()
    await expect(firstAuthentication).resolves.toBeUndefined()
    expect(firstGetToken).toHaveBeenCalledOnce()
    expect(secondGetToken).not.toHaveBeenCalled()
    expect(first.http.defaults.headers.common).toEqual({ Authorization: 'Bearer access-token' })
    expect(second.http.defaults.headers.common).toBeUndefined()
  })

  it('does not start authentication for a sync that was already canceled', async () => {
    const requests = Object.create(RequestsManager.prototype) as RequestsManager
    requests.server = { accessToken: null, authentication: null } as any
    ;(requests as any).httpController = new AbortController()
    ;(requests as any).httpController.abort()
    const getToken = vi.spyOn(requests as any, 'getToken').mockRejectedValue(new Error('must not start'))

    await expect(requests.ensureAccessToken()).rejects.toMatchObject({ code: 'ERR_CANCELED' })

    expect(getToken).not.toHaveBeenCalled()
    expect(requests.server.authentication).toBeNull()
  })
})
