import { describe, expect, it } from 'vitest'
import { LOCAL_RENDERER, REMOTE_RENDERER, WEBVIEW_RENDERER_EVENTS, WRAPPER_RENDERER_EVENTS } from './events'

function collectChannels(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (!value || typeof value !== 'object') {
    return []
  }
  return Object.values(value).flatMap((v) => collectChannels(v))
}

describe('renderer event allowlists', () => {
  it('keeps local window controls out of webview callable channels', () => {
    const webviewCallableChannels = new Set([...WEBVIEW_RENDERER_EVENTS.SEND, ...WEBVIEW_RENDERER_EVENTS.INVOKE])

    for (const channel of collectChannels(LOCAL_RENDERER.WINDOW)) {
      expect(webviewCallableChannels.has(channel)).toBe(false)
    }
  })

  it('keeps local server mutations out of webview callable channels', () => {
    const webviewCallableChannels = new Set([...WEBVIEW_RENDERER_EVENTS.SEND, ...WEBVIEW_RENDERER_EVENTS.INVOKE])

    expect(webviewCallableChannels.has(LOCAL_RENDERER.SERVER.ACTION)).toBe(false)
    expect(webviewCallableChannels.has(LOCAL_RENDERER.SERVER.RELOAD)).toBe(false)
    expect(webviewCallableChannels.has(LOCAL_RENDERER.SERVER.SET_ACTIVE)).toBe(false)
  })

  it('allows webviews to listen to server sync status from the core event channel', () => {
    expect(REMOTE_RENDERER.SYNC.STATUS).toBe('core-sync-status')
    expect(WEBVIEW_RENDERER_EVENTS.ON.has(REMOTE_RENDERER.SYNC.STATUS)).toBe(true)
  })

  it('limits listener cleanup to report transfer on webviews', () => {
    expect([...WRAPPER_RENDERER_EVENTS.REMOVE_ALL_LISTENERS]).toEqual([])
    expect([...WEBVIEW_RENDERER_EVENTS.REMOVE_ALL_LISTENERS]).toEqual([REMOTE_RENDERER.SYNC.REPORT_TRANSFER])
  })
})
