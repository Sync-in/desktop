import { contextBridge, ipcRenderer, IpcRenderer, IpcRendererEvent, webUtils } from 'electron'

//exposing ipcRenderer to the window in renderer process
contextBridge.exposeInMainWorld('ipcRenderer', {
  send: ipcRenderer.send,
  on: (channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): IpcRenderer =>
    ipcRenderer.on(channel, (_, ...args) => listener(null, ...args)),
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel),
  invoke: ipcRenderer.invoke,
  showFilePath: (file: File) => webUtils.getPathForFile(file)
})

contextBridge.exposeInMainWorld('process', { platform: process.platform })
