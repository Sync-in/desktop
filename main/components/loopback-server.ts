/*
 * Copyright (C) 2012-2026 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import http from 'node:http'
import { Logger } from 'winston'
import { getLogger } from '@sync-in-desktop/core/components/handlers/loggers'
import { SYNC_SERVER } from '@sync-in-desktop/core/components/constants/auth'
import { capitalize } from '@sync-in-desktop/core/components/utils/functions'

export type OIDCCallbackParams = Record<string, string>

export class LoopbackServer {
  static sessions = new Map<number, LoopbackServer>()
  private logger: Logger = getLogger('LoopbackServer')
  private readonly serverId: number
  private readonly host = '127.0.0.1'
  private readonly callbackPath = '/oidc/callback' as const
  private readonly availablePorts = [49152, 49153, 49154] as const
  private readonly timeoutMs = 2 * 60 * 1000
  private server?: http.Server
  private port?: number
  private callbackPromise?: Promise<OIDCCallbackParams>
  private resolveCallback?: (params: OIDCCallbackParams) => void
  private rejectCallback?: (err: unknown) => void
  private timeoutHandle?: NodeJS.Timeout

  constructor(serverId: number) {
    this.serverId = serverId
    LoopbackServer.sessions.set(serverId, this)
  }

  static getOrCreateLoopbackSession(serverId: number): LoopbackServer {
    return LoopbackServer.sessions.get(serverId) ?? new LoopbackServer(serverId)
  }

  static cleanupLoopbackSessions() {
    for (const s of LoopbackServer.sessions.values()) {
      s.stop().catch(console.error)
    }
    LoopbackServer.sessions.clear()
  }

  /**
   * Starts the loopback server on the first available port from a fixed pool.
   * Returns the redirectUri to use in the OIDC authorize request.
   */
  async start(): Promise<{ redirectPort: number }> {
    // Reuse if already running
    if (this.server && this.port) {
      return { redirectPort: this.port }
    }

    this.callbackPromise = new Promise<OIDCCallbackParams>((resolve, reject) => {
      this.resolveCallback = resolve
      this.rejectCallback = reject
    })

    // Prevent unhandled rejection if nobody awaits waitForCallback()
    this.callbackPromise.catch((e) => this.logger.error(`for server ${this.serverId}: ${e}`))

    this.server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      this.handleRequest(req, res)
    })

    // Try fixed ports in order
    this.port = await this.listenOnFirstAvailablePort()

    this.logger.info(`started loopback server ${this.serverId} on port ${this.port}`)

    // Safety timeout
    this.timeoutHandle = setTimeout(() => {
      this.rejectOnce(new Error('OIDC loopback callback timed out'))
      void this.stop()
    }, this.timeoutMs)

    return { redirectPort: this.port }
  }

  /**
   * Resolves with the first callback query params received on callbackPath.
   * The server stops automatically after the first successful callback.
   */
  async waitForCallback(): Promise<OIDCCallbackParams> {
    if (!this.callbackPromise) {
      throw new Error(`Loopback server is not started. Call start() first.`)
    }
    return this.callbackPromise
  }

  /**
   * Stops the server and clears internal state.
   */
  async stop(): Promise<void> {
    // Remove from sessions map first
    LoopbackServer.sessions.delete(this.serverId)

    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle)
      this.timeoutHandle = undefined
    }

    this.logger.info(`stopped for server ${this.serverId} (port ${this.port ?? 'n/a'})`)

    const srv = this.server
    this.server = undefined
    this.port = undefined

    // Prevent waiting promises from hanging forever (only reject if not already resolved/rejected)
    this.rejectOnce(new Error('OIDC loopback server stopped'))

    if (!srv) return

    await new Promise<void>((resolve) => {
      try {
        srv.close(() => resolve())
      } catch {
        resolve()
      }
    })
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    try {
      const url = new URL(req.url ?? '/', `http://${this.host}`)

      if (url.pathname !== this.callbackPath) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }

      const params: OIDCCallbackParams = Object.fromEntries(url.searchParams.entries())

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<h3>${capitalize(SYNC_SERVER)} authentication completed</h3><p>You may now close this window.</p>`)

      this.resolveOnce(params)

      // One-shot: stop after first callback
      void this.stop()
    } catch (err) {
      try {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Server error')
      } catch (e) {
        this.logger.error(`error handling request: ${e}`)
      }

      this.rejectOnce(err)
      void this.stop()
    }
  }

  private resolveOnce(params: OIDCCallbackParams): void {
    if (!this.resolveCallback) return
    const resolve = this.resolveCallback
    this.resolveCallback = undefined
    this.rejectCallback = undefined
    resolve(params)
  }

  private rejectOnce(err: unknown): void {
    if (!this.rejectCallback) return
    const reject = this.rejectCallback
    this.resolveCallback = undefined
    this.rejectCallback = undefined
    reject(err)
  }

  private async listenOnFirstAvailablePort(): Promise<number> {
    const srv = this.server
    if (!srv) throw new Error('Server not initialized')

    for (const port of this.availablePorts) {
      try {
        await this.listenOnce(srv, port)
        return port
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code !== 'EADDRINUSE') {
          throw err
        }
      }
    }

    throw new Error(`No available loopback port found in pool: ${this.availablePorts.join(', ')}`)
  }

  private listenOnce(srv: http.Server, port: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError = (err: unknown) => {
        srv.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        srv.removeListener('error', onError)
        resolve()
      }

      srv.once('error', onError)
      srv.once('listening', onListening)
      srv.listen(port, this.host)
    })
  }
}
