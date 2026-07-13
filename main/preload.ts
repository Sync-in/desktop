import type { IpcRendererEvent } from 'electron'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { RendererEventAllowlist } from './constants/events'

function assertAllowed(channel: string, allowedChannels: ReadonlySet<string>, method: string): void {
  if (!allowedChannels.has(channel)) {
    throw new Error(`Unauthorized ipcRenderer.${method} channel: ${channel}`)
  }
}

export function exposeIpcRenderer(allowlist: RendererEventAllowlist, options: { showFilePath?: boolean } = {}): void {
  const exposed = {
    send: (channel: string, ...args: any[]): void => {
      assertAllowed(channel, allowlist.SEND, 'send')
      ipcRenderer.send(channel, ...args)
    },
    on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void => {
      assertAllowed(channel, allowlist.ON, 'on')
      ipcRenderer.on(channel, (_, ...args) => listener(null, ...args))
    },
    removeAllListeners: (channel: string): void => {
      assertAllowed(channel, allowlist.REMOVE_ALL_LISTENERS, 'removeAllListeners')
      ipcRenderer.removeAllListeners(channel)
    },
    invoke: (channel: string, ...args: any[]): Promise<any> => {
      assertAllowed(channel, allowlist.INVOKE, 'invoke')
      return ipcRenderer.invoke(channel, ...args)
    }
  } as {
    send: (channel: string, ...args: any[]) => void
    on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void) => void
    removeAllListeners: (channel: string) => void
    invoke: (channel: string, ...args: any[]) => Promise<any>
    showFilePath?: (file: File) => string
  }

  if (options.showFilePath) {
    exposed.showFilePath = (file: File) => webUtils.getPathForFile(file)
  }

  contextBridge.exposeInMainWorld('ipcRenderer', exposed)
  contextBridge.exposeInMainWorld('process', { platform: process.platform })
}
