import { shell } from 'electron'
import path from 'node:path'
import { realpathSync } from 'node:fs'
import { isPathInsideRoot, units } from '@sync-in-desktop/core/components/utils/functions'
import type { Server } from '@sync-in-desktop/core/components/models/server'

const EXTERNAL_URL_PROTOCOLS = new Set(['http:', 'https:'])

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

export async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url)
  if (!EXTERNAL_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Unsupported external URL protocol: ${parsed.protocol}`)
  }
  await shell.openExternal(parsed.toString())
}

export function isUrlWithinServerScope(url: string, serverUrl: string): boolean {
  try {
    const target = new URL(url)
    const expected = new URL(serverUrl)
    const expectedPath = expected.pathname.endsWith('/') ? expected.pathname : `${expected.pathname}/`
    const targetPath = target.pathname.endsWith('/') ? target.pathname : `${target.pathname}/`
    return target.origin === expected.origin && targetPath.startsWith(expectedPath)
  } catch {
    return false
  }
}

export function showItemInFolder(fullPath: string, server: Server): void {
  if (typeof fullPath !== 'string' || !path.isAbsolute(fullPath)) {
    return
  }

  try {
    const realPath = realpathSync(fullPath)
    if (
      server.syncPaths.some(({ localPath }) => {
        if (!localPath) return false
        try {
          return isPathInsideRoot(realpathSync(localPath), realPath)
        } catch {
          return false
        }
      })
    ) {
      shell.showItemInFolder(realPath)
    }
  } catch {
    return
  }
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
