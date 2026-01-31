/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ENVIRONMENT, HAS_TTY, IS_WINDOWS } from '../../constants'
import { DEFAULT_HIGH_WATER_MARK, INCOMPLETE_PREFIX, SYNC_CHECKSUM_ALG } from '../constants/handlers'
import { TransferProgress } from '../handlers/transfers'
import { SyncClientInfo } from '../interfaces/sync-client-info.interface'
import crypto from 'node:crypto'
import { SyncFileStats } from '../interfaces/sync-diff.interface'
import { NormalizedMap } from './normalizedMap'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
export const stdoutColors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  crimson: '\x1b[38m'
}

export const regexSlash = new RegExp('/', 'g')
export const regexpEscape = /[.*+?^${}()|[\]\\]/g
export const reservedUrlChars = new Map([
  ['#', '%23'],
  ['?', '%3F'],
  ['%', '%25'],
  [' ', '%20']
])

function encodeReservedUrlChars(url: string): string {
  const buffer: string[] = []
  for (const char of url) {
    buffer.push(reservedUrlChars.get(char) || char)
  }
  return buffer.join('')
}

export function checkReservedUrlChars(url: string): string {
  for (const char of reservedUrlChars.keys()) {
    if (url.indexOf(char) > -1) {
      return encodeReservedUrlChars(url)
    }
  }
  return url
}

function regExpEscape(content: string): string {
  return content.replace(regexpEscape, '\\$&')
}

export function toHumanSize(bytes: number, precision = 2): string {
  if (bytes === 0) {
    return '0KB'
  }
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = (bytes / Math.pow(1024, Math.floor(exponent))).toFixed(precision)
  return `${value} ${units[exponent]}`
}

export function toHumanTime(seconds: number): string {
  const date = new Date(null)
  date.setSeconds(seconds)
  return date.toISOString().substring(11, 19)
}

export function genUUID(): string {
  return crypto.randomUUID()
}

export function genClientInfos(): SyncClientInfo {
  return {
    node: os.hostname(),
    os: os.platform(),
    osRelease: os.release(),
    user: os.userInfo().username,
    type: ENVIRONMENT.appName,
    version: ENVIRONMENT.appVersion
  } satisfies SyncClientInfo
}

export function convertMapToJSON(map: NormalizedMap<string, any[]>): string {
  return JSON.stringify([...map])
}

export function convertJSONToMap(json: string): NormalizedMap<string, SyncFileStats> {
  return new NormalizedMap(JSON.parse(json))
}

export function streamStdout(content = '', color = 'green') {
  if (!HAS_TTY) return
  process.stdout.clearLine(0)
  process.stdout.cursorTo(0)
  if (content) {
    process.stdout.write(`${stdoutColors[color]}${content}${stdoutColors['reset']}`)
  }
}

export async function isPathExists(path: string): Promise<void> {
  await fs.access(path)
}

export async function isPathExistsBool(path: string): Promise<boolean> {
  try {
    await isPathExists(path)
    return true
  } catch {
    return false
  }
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function fileBaseName(filePath: string): string {
  if (IS_WINDOWS) {
    return path.win32.basename(filePath)
  } else {
    return path.posix.basename(filePath)
  }
}

export async function checkParentDir(realPath: string) {
  const parentDir = path.dirname(realPath)
  if (await isPathExistsBool(parentDir)) {
    if ((await fs.stat(parentDir)).isFile()) {
      await fs.rm(parentDir, { force: true })
      await fs.mkdir(parentDir, { recursive: true })
    }
  } else {
    await fs.mkdir(parentDir, { recursive: true })
  }
}

export function getTmpPath(aPath: string) {
  const dir = path.dirname(aPath)
  const name = fileBaseName(aPath)
  return path.join(dir, `${INCOMPLETE_PREFIX}${name}`)
}

export function findByNameOrID<T extends { id: number; name: string }>(nameOrID: string | number, store: T[]): T {
  let e: T
  if (typeof nameOrID === 'string') {
    e = store.find((s) => nameOrID.toLowerCase() === s.name.toLowerCase())
  } else {
    e = store.find((s) => nameOrID === s.id)
  }
  return e
}

export function currentTimeStamp(): number {
  return Math.floor(new Date().getTime() / 1000)
}

export async function checksumFile(filePath: string, alg = SYNC_CHECKSUM_ALG): Promise<string> {
  const hash = crypto.createHash(alg)
  const stream = createReadStream(filePath, { highWaterMark: DEFAULT_HIGH_WATER_MARK })
  await pipeline(stream, hash)
  return hash.digest('hex')
}

export function regExpPathPattern(path: string): RegExp {
  if (IS_WINDOWS) {
    //eslint-disable-next-line
    return new RegExp(`^[\W]{0,4}${regExpEscape(path)}[/\\\\]`)
  }
  return new RegExp(`^${regExpEscape(path)}[/\\\\]`)
}

export async function downloadAndSize(stream: Readable, realPath: string, hasRange: number, transferProgress: TransferProgress): Promise<number> {
  let size = hasRange || 0
  if (transferProgress) {
    transferProgress.currentSize = size
  }
  const dst = createWriteStream(realPath, { flags: hasRange ? 'a' : 'w', highWaterMark: DEFAULT_HIGH_WATER_MARK })
  await pipeline(
    stream,
    async function* (source) {
      for await (const chunk of source) {
        size += chunk.length
        if (transferProgress) {
          transferProgress.update(chunk.length)
        }
        yield chunk
      }
    },
    dst
  )
  return size
}

export async function downloadAndChecksum(stream: Readable, realPath: string, hasRange: number, transferProgress: TransferProgress): Promise<string> {
  const hash = crypto.createHash(SYNC_CHECKSUM_ALG)
  if (hasRange) {
    const src = createReadStream(realPath, { highWaterMark: DEFAULT_HIGH_WATER_MARK })
    await pipeline(src, async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk)
        if (transferProgress) {
          transferProgress.currentSize += chunk.length
        }
        yield chunk
      }
    })
  }
  const dst = createWriteStream(realPath, { flags: hasRange ? 'a' : 'w', highWaterMark: DEFAULT_HIGH_WATER_MARK })
  await pipeline(
    stream,
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk)
        if (transferProgress) {
          transferProgress.update(chunk.length)
        }
        yield chunk
      }
    },
    dst
  )
  hash.end()
  return hash.digest('hex')
}

export async function limitConcurrency<T, R>(items: T[], fn: (item: T) => Promise<R>, limit: number = 5): Promise<R[]> {
  const results: Promise<R>[] = []
  const executing: Promise<R>[] = []
  for (const item of items) {
    const p = fn(item).then((result) => {
      executing.splice(executing.indexOf(p), 1)
      return result
    })
    results.push(p)
    executing.push(p)
    if (executing.length >= limit) {
      await Promise.race(executing)
    }
  }
  return Promise.all(results)
}

export function writeToFileSync(filePath: string, settings: any, indent = 4) {
  writeFileSync(filePath, JSON.stringify(settings, null, indent))
}

export function loadJsonFile<T>(filePath: string, defaultValue: T): T {
  if (existsSync(filePath)) {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } else {
    return defaultValue
  }
}
