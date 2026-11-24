import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { IS_WINDOWS } from '../../constants'
import { INTERNAL_TEMPORARY_DIRECTORY, SYNC_CHECKSUM_ALG } from '../constants/handlers'

const SYNC_CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DOWNLOAD_CHECKPOINT_SUFFIX_PATTERN = /^[0-9a-f]{64}\.part$/

export function getDownloadTmpDirectory(localRoot: string): string {
  return path.join(path.resolve(localRoot), INTERNAL_TEMPORARY_DIRECTORY)
}

export function getDownloadTmpPrefix(clientId: string, syncPathId: number): string {
  if (!SYNC_CLIENT_ID_PATTERN.test(clientId)) throw new Error('Invalid Sync client identifier')
  if (!Number.isSafeInteger(syncPathId) || syncPathId <= 0) throw new Error('Invalid Sync path identifier')
  return `desktop-${clientId.toLowerCase()}-sync-path-${syncPathId}-download-`
}

export function getDownloadTmpPath(localRoot: string, clientId: string, syncPathId: number, filePath: string): string {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Invalid download path')
  const transferId = crypto
    .createHash(SYNC_CHECKSUM_ALG)
    .update((IS_WINDOWS ? filePath.replaceAll('\\', '/') : filePath).normalize('NFC'))
    .digest('hex')
  return path.join(getDownloadTmpDirectory(localRoot), `${getDownloadTmpPrefix(clientId, syncPathId)}${transferId}.part`)
}

export function isDownloadTmpFileName(fileName: string, prefix: string): boolean {
  return fileName.startsWith(prefix) && DOWNLOAD_CHECKPOINT_SUFFIX_PATTERN.test(fileName.slice(prefix.length))
}

export async function cleanupDownloadTmpFiles(localRoot: string, clientId: string, syncPathId: number): Promise<void> {
  try {
    const temporaryDirectory = getDownloadTmpDirectory(localRoot)
    const temporaryPrefix = getDownloadTmpPrefix(clientId, syncPathId)
    const stats = await fs.lstat(temporaryDirectory)
    if (!stats.isDirectory() || stats.isSymbolicLink()) return
    const fileNames = await fs.readdir(temporaryDirectory)
    await Promise.all(
      fileNames
        .filter((fileName) => isDownloadTmpFileName(fileName, temporaryPrefix))
        .map((fileName) => fs.rm(path.join(temporaryDirectory, fileName), { force: true, recursive: true }).catch(() => undefined))
    )
  } catch {
    // Cleanup must never prevent removing a synchronization path or server.
  }
}

export async function ensureDownloadTmpDirectory(localRoot: string): Promise<string> {
  const temporaryDirectory = getDownloadTmpDirectory(localRoot)
  await fs.mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
  const stats = await fs.lstat(temporaryDirectory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Internal temporary location is not a directory: ${temporaryDirectory}`)
  }
  return temporaryDirectory
}
