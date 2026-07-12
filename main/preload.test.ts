import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_RENDERER, REMOTE_RENDERER, WEBVIEW_RENDERER_EVENTS, WRAPPER_RENDERER_EVENTS } from './constants/events'
import { exposeIpcRenderer } from './preload'

const electronMock = vi.hoisted(() => ({
  contextBridge: {
    exposeInMainWorld: vi.fn()
  },
  ipcRenderer: {
    send: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    invoke: vi.fn()
  },
  webUtils: {
    getPathForFile: vi.fn()
  }
}))

vi.mock('electron', () => electronMock)

interface ExposedIpcRenderer {
  send: (channel: string, ...args: any[]) => void
  on: (channel: string, listener: (event: any, ...args: any[]) => void) => void
  removeAllListeners: (channel: string) => void
  invoke: (channel: string, ...args: any[]) => Promise<any>
  showFilePath?: (file: File) => string
}

function exposeWrapper(): ExposedIpcRenderer {
  exposeIpcRenderer(WRAPPER_RENDERER_EVENTS)
  return exposedIpcRenderer()
}

function exposeWebview(): ExposedIpcRenderer {
  exposeIpcRenderer(WEBVIEW_RENDERER_EVENTS, { showFilePath: true })
  return exposedIpcRenderer()
}

function exposedIpcRenderer(): ExposedIpcRenderer {
  const call = electronMock.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'ipcRenderer')
  if (!call) {
    throw new Error('ipcRenderer was not exposed')
  }
  return call[1] as ExposedIpcRenderer
}

describe('preload ipcRenderer bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    electronMock.ipcRenderer.invoke.mockResolvedValue('invoke-result')
    electronMock.webUtils.getPathForFile.mockReturnValue('/tmp/file.txt')
  })

  it('forwards allowed wrapper send channels', () => {
    const ipcRenderer = exposeWrapper()

    ipcRenderer.send(LOCAL_RENDERER.WINDOW.MINIMIZE, 'payload')

    expect(electronMock.ipcRenderer.send).toHaveBeenCalledWith(LOCAL_RENDERER.WINDOW.MINIMIZE, 'payload')
  })

  it('blocks disallowed wrapper send channels', () => {
    const ipcRenderer = exposeWrapper()

    expect(() => ipcRenderer.send(REMOTE_RENDERER.MISC.URL_OPEN, 'https://sync-in.com')).toThrow(
      `Unauthorized ipcRenderer.send channel: ${REMOTE_RENDERER.MISC.URL_OPEN}`
    )
    expect(electronMock.ipcRenderer.send).not.toHaveBeenCalled()
  })

  it('forwards allowed webview invoke channels', async () => {
    const ipcRenderer = exposeWebview()

    await expect(ipcRenderer.invoke(REMOTE_RENDERER.SERVER.AUTHENTICATION)).resolves.toBe('invoke-result')

    expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(REMOTE_RENDERER.SERVER.AUTHENTICATION)
  })

  it('blocks disallowed webview invoke channels', () => {
    const ipcRenderer = exposeWebview()

    expect(() => ipcRenderer.invoke(LOCAL_RENDERER.SERVER.ACTION)).toThrow(`Unauthorized ipcRenderer.invoke channel: ${LOCAL_RENDERER.SERVER.ACTION}`)
    expect(electronMock.ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('wraps allowed listeners without exposing the raw ipcRenderer return value', () => {
    let registeredListener: (event: unknown, ...args: any[]) => void
    const listener = vi.fn()
    electronMock.ipcRenderer.on.mockImplementation((_channel, callback) => {
      registeredListener = callback
      return electronMock.ipcRenderer
    })
    const ipcRenderer = exposeWrapper()

    const result = ipcRenderer.on(LOCAL_RENDERER.SERVER.LIST, listener)
    registeredListener(null, 'servers')

    expect(result).toBeUndefined()
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(LOCAL_RENDERER.SERVER.LIST, expect.any(Function))
    expect(listener).toHaveBeenCalledWith(null, 'servers')
  })

  it('limits removeAllListeners to explicitly allowed webview channels', () => {
    const webviewIpcRenderer = exposeWebview()

    webviewIpcRenderer.removeAllListeners(REMOTE_RENDERER.SYNC.REPORT_TRANSFER)

    expect(electronMock.ipcRenderer.removeAllListeners).toHaveBeenCalledWith(REMOTE_RENDERER.SYNC.REPORT_TRANSFER)

    vi.clearAllMocks()
    const wrapperIpcRenderer = exposeWrapper()
    expect(() => wrapperIpcRenderer.removeAllListeners(REMOTE_RENDERER.SYNC.REPORT_TRANSFER)).toThrow(
      `Unauthorized ipcRenderer.removeAllListeners channel: ${REMOTE_RENDERER.SYNC.REPORT_TRANSFER}`
    )
    expect(electronMock.ipcRenderer.removeAllListeners).not.toHaveBeenCalled()
  })

  it('exposes showFilePath only for webview preloads', () => {
    const wrapperIpcRenderer = exposeWrapper()
    expect(wrapperIpcRenderer.showFilePath).toBeUndefined()

    vi.clearAllMocks()
    const webviewIpcRenderer = exposeWebview()
    const file = {} as File

    expect(webviewIpcRenderer.showFilePath?.(file)).toBe('/tmp/file.txt')
    expect(electronMock.webUtils.getPathForFile).toHaveBeenCalledWith(file)
  })
})
