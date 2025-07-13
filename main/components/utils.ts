/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */
import mime from 'mime-types'

import type { SyncTransfer } from '@sync-in-desktop/core/components/interfaces/sync-transfer.interface'

const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

export const throttleFunc = (context: any, func: (args?) => void, delay: number) => {
  let lastFunc
  let lastRan
  return (...args) => {
    if (!lastRan) {
      func.apply(context, args)
      lastRan = Date.now()
    } else {
      clearTimeout(lastFunc)
      lastFunc = setTimeout(
        function () {
          if (Date.now() - lastRan >= delay) {
            func.apply(context, args)
            lastRan = Date.now()
          }
        },
        delay - (Date.now() - lastRan)
      )
    }
  }
}

export function bytesToHuman(bytes: number, asDict: true, precision?: number, perSecond?: boolean): { value: number; unit: string }
export function bytesToHuman(bytes: number, asDict: false, precision?: number, perSecond?: boolean): string
export function bytesToHuman(bytes: number, asDict?: boolean, precision?: number, perSecond?: boolean): { value: number; unit: string }
export function bytesToHuman(
  bytes: number,
  asDict: boolean = true,
  precision: number = 2,
  perSecond: boolean = false
):
  | {
      value: number
      unit: string
    }
  | string {
  let value: number
  let unit: string
  if (bytes === 0) {
    value = 0
    unit = 'B'
  } else {
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    value = parseFloat((bytes / Math.pow(1024, Math.floor(exponent))).toFixed(precision))
    unit = units[exponent]
  }
  if (perSecond) {
    unit = `${unit}/s`
  }
  if (asDict) {
    return { value, unit }
  }
  return `${value} ${unit}`
}

export function bytesToUnit(bytes: number, unit: string, precision = 2): number {
  const exponent = units.indexOf(unit)
  return parseFloat((bytes / Math.pow(1024, Math.floor(exponent))).toFixed(precision))
}

export function setMimeType(tr: SyncTransfer): SyncTransfer {
  if (tr.isDir) {
    tr.mime = 'directory'
  } else {
    tr.mime = mime.lookup(tr.file) || 'file'
    if (tr.mime !== 'file') {
      tr.mime = tr.mime.replace('/', '-')
    }
  }
  return tr
}

export function sortObjsByDate(objs: any[], property: string, asc = false) {
  objs.sort((a, b) => {
    const dA = new Date(a[property]).getTime()
    const dB = new Date(b[property]).getTime()
    if (isNaN(dA)) {
      return 1
    } else if (isNaN(dB)) {
      return -1
    } else if (dA === dB) {
      return 0
    }
    if (asc) {
      return dA > dB ? 1 : -1
    } else {
      return dB > dA ? 1 : -1
    }
  })
}

export function compareVersions(v1: string, v2: string): number {
  const v1Parts: number[] = v1.split('.').map(Number)
  const v2Parts: number[] = v2.split('.').map(Number)

  for (let i = 0; i < 3; i++) {
    if (v1Parts[i] < v2Parts[i]) return -1
    if (v1Parts[i] > v2Parts[i]) return 1
  }
  return 0
}

export function findOldestVersion(versions: string[]): string {
  return versions.reduce((oldest, current) => {
    return compareVersions(oldest, current) <= 0 ? oldest : current
  })
}

export function getReleaseOS(): 'mac' | 'linux' | 'win' {
  switch (process.platform) {
    case 'darwin':
      return 'mac'
    case 'win32':
      return 'win'
    case 'linux':
      return 'linux'
    default:
      throw new Error(`Unable to determine release os : ${process.platform}`)
  }
}
