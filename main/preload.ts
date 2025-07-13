/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

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
