import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoopbackServer } from './loopback-server'

vi.mock('@sync-in-desktop/core/components/handlers/loggers', () => ({
  getLogger: () => ({
    error: vi.fn(),
    info: vi.fn()
  })
}))

describe.sequential('LoopbackServer', () => {
  afterEach(async () => {
    const sessions = [...LoopbackServer.sessions.values()]
    await Promise.all(sessions.map((session) => session.stop()))
    LoopbackServer.sessions.clear()
  })

  it('reuses an existing session for the same server', () => {
    const first = LoopbackServer.getOrCreateLoopbackSession(1)
    const second = LoopbackServer.getOrCreateLoopbackSession(1)

    expect(second).toBe(first)
    expect(LoopbackServer.sessions.get(1)).toBe(first)
  })

  it('requires start before waiting for a callback', async () => {
    const session = LoopbackServer.getOrCreateLoopbackSession(2)

    await expect(session.waitForCallback()).rejects.toThrow('Loopback server is not started')
  })

  it('resolves callback params and stops after the first valid callback', async () => {
    const session = LoopbackServer.getOrCreateLoopbackSession(3)
    const { redirectPort } = await session.start()
    const callback = session.waitForCallback()

    const response = await request(redirectPort, '/oidc/callback?code=abc&state=xyz')

    await expect(callback).resolves.toEqual({ code: 'abc', state: 'xyz' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('authentication completed')
    await vi.waitFor(() => expect(LoopbackServer.sessions.has(3)).toBe(false))
  })

  it('returns 404 for non-callback paths without resolving the callback', async () => {
    const session = LoopbackServer.getOrCreateLoopbackSession(4)
    const { redirectPort } = await session.start()
    const callback = session.waitForCallback()

    const response = await request(redirectPort, '/not-callback?code=abc')

    expect(response.statusCode).toBe(404)
    await session.stop()
    await expect(callback).rejects.toThrow('OIDC loopback server stopped')
  })

  it('returns the same port when started twice', async () => {
    const session = LoopbackServer.getOrCreateLoopbackSession(5)
    const first = await session.start()
    const second = await session.start()

    expect(second).toEqual(first)
  })
})

function request(port: number, path: string): Promise<{ body: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', path, port }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        resolve({ body, statusCode: res.statusCode ?? 0 })
      })
    })
    req.on('error', reject)
  })
}
