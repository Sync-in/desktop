/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { AxiosRequestConfig } from 'axios'
import { ReadStream } from 'node:fs'

export interface AxiosExtendedRequestConfig extends AxiosRequestConfig {
  getData?: () => ReadStream
}
