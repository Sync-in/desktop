import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

export type IpcMainEventServer = IpcMainEvent & { sender: IpcMainEvent['sender'] & { serverId: number } }

export type IpcMainInvokeEventServer = IpcMainInvokeEvent & { sender: IpcMainInvokeEvent['sender'] & { serverId: number } }
