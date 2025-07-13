/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

export type IpcMainEventServer = IpcMainEvent & { sender: IpcMainEvent['sender'] & { serverId: number } }

export type IpcMainInvokeEventServer = IpcMainInvokeEvent & { sender: IpcMainInvokeEvent['sender'] & { serverId: number } }
