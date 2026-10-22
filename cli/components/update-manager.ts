import crypto from 'node:crypto'
import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { configure, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js'
import { ENVIRONMENT, USER_AGENT } from '../../core/constants'
import type {
  CliBinaryRename,
  CliBinaryWrite,
  CliRelease,
  CliReleaseAsset,
  CliUpdateDownloader,
  CliUpdateManagerOptions,
  CliUpdateResult
} from './interfaces/update-manifest.interface'

const RELEASES_URL = new URL(`${ENVIRONMENT.appReleasesPage}/`)
const LATEST_MANIFEST_URL = new URL('latest/download/latest.json', RELEASES_URL)
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const SHA512_BASE64_PATTERN = /^[A-Za-z0-9+/]{86}==$/
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
const MAX_BINARY_BYTES = 50 * 1024 * 1024
const MAX_REDIRECTS = 5
const REQUEST_TIMEOUT_MS = 30_000
const NODE_SHEBANG = Buffer.from('#!/usr/bin/env node')
const writeCliBinary: CliBinaryWrite = (file, content) => file.writeFile(content)

configure({ useWebWorkers: false })

export class CliUpdateManager {
  private readonly binaryPath: string
  private readonly currentVersion: string
  private readonly download: CliUpdateDownloader

  constructor(options: CliUpdateManagerOptions = {}) {
    const binaryPath = options.binaryPath ?? process.argv[1]
    if (!binaryPath) {
      throw new Error('Unable to determine the current CLI path')
    }

    this.binaryPath = path.resolve(binaryPath)
    this.currentVersion = options.currentVersion ?? ENVIRONMENT.appVersion
    this.download = options.download ?? downloadHttps
  }

  async update(): Promise<CliUpdateResult> {
    const manifestContent = await this.download(LATEST_MANIFEST_URL, MAX_MANIFEST_BYTES)
    const release = parseCliReleaseManifest(manifestContent)
    const comparison = compareVersions(this.currentVersion, release.version)

    if (comparison === 0) {
      return this.result('up-to-date', release.version)
    }
    if (comparison > 0) {
      return this.result('local-newer', release.version)
    }

    const archiveUrl = new URL(`download/v${release.version}/${encodeURIComponent(release.asset.package)}`, RELEASES_URL)
    const archive = await this.download(archiveUrl, release.asset.size)
    verifyArchive(archive, release.asset)

    const binary = await extractCliBinary(archive, release.version)
    try {
      await replaceCliBinary(this.binaryPath, binary)
    } catch (error) {
      throw new Error(`Unable to replace the CLI at ${this.binaryPath}: ${errorMessage(error)}`, { cause: error })
    }

    return this.result('updated', release.version)
  }

  private result(status: CliUpdateResult['status'], latestVersion: string): CliUpdateResult {
    return {
      status,
      currentVersion: this.currentVersion,
      latestVersion,
      binaryPath: this.binaryPath
    }
  }
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left, 'current CLI')
  const rightParts = parseVersion(right, 'release')

  for (let index = 0; index < leftParts.length; index++) {
    if (leftParts[index] < rightParts[index]) return -1
    if (leftParts[index] > rightParts[index]) return 1
  }
  return 0
}

function parseCliReleaseManifest(content: Buffer): CliRelease {
  let manifest: unknown
  try {
    manifest = JSON.parse(content.toString('utf8'))
  } catch (error) {
    throw new Error(`The GitHub release manifest is not valid JSON: ${errorMessage(error)}`, { cause: error })
  }

  if (!isRecord(manifest) || typeof manifest.version !== 'string') {
    throw new Error('The GitHub release manifest contains an invalid stable version')
  }
  try {
    parseVersion(manifest.version, 'release')
  } catch {
    throw new Error('The GitHub release manifest contains an invalid stable version')
  }
  if (!isRecord(manifest.platform) || !Array.isArray(manifest.platform.node)) {
    throw new Error('The GitHub release manifest does not contain CLI packages')
  }

  const expectedPackage = `sync-in-cli-${manifest.version}.js.zip`
  const candidates = manifest.platform.node.filter(
    (asset): asset is Record<string, unknown> => isRecord(asset) && asset.package === expectedPackage && asset.ext === 'zip'
  )
  if (candidates.length !== 1) {
    throw new Error(`The GitHub release manifest must contain exactly one ${expectedPackage} package`)
  }

  const candidate = candidates[0]
  if (typeof candidate.size !== 'number' || !Number.isSafeInteger(candidate.size) || candidate.size <= 0 || candidate.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`The GitHub release manifest contains an invalid size for ${expectedPackage}`)
  }
  if (typeof candidate.sha512 !== 'string' || !SHA512_BASE64_PATTERN.test(candidate.sha512)) {
    throw new Error(`The GitHub release manifest contains an invalid SHA-512 for ${expectedPackage}`)
  }

  return {
    version: manifest.version,
    asset: {
      package: expectedPackage,
      size: candidate.size,
      sha512: candidate.sha512
    }
  }
}

async function extractCliBinary(archive: Buffer, version: string): Promise<Buffer> {
  const expectedFile = `sync-in-cli-${version}.js`
  const reader = new ZipReader(new Uint8ArrayReader(archive), { checkCrc32: true, strictness: 'strict' })

  try {
    const entries = await reader.getEntries()
    if (entries.length !== 1) {
      throw new Error(`The CLI archive must contain only ${expectedFile}`)
    }

    const entry = entries[0]
    if (entry.directory || !('getData' in entry) || entry.symlink || entry.filename !== expectedFile) {
      throw new Error(`The CLI archive must contain only ${expectedFile}`)
    }
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize <= 0 || entry.uncompressedSize > MAX_BINARY_BYTES) {
      throw new Error(`The extracted CLI size is invalid for ${expectedFile}`)
    }

    const extracted = Buffer.from(await entry.getData(new Uint8ArrayWriter()))
    if (extracted.length !== entry.uncompressedSize || !extracted.subarray(0, NODE_SHEBANG.length).equals(NODE_SHEBANG)) {
      throw new Error(`The extracted CLI is invalid for ${expectedFile}`)
    }
    return extracted
  } finally {
    await reader.close()
  }
}

export async function replaceCliBinary(
  binaryPath: string,
  content: Buffer,
  rename: CliBinaryRename = fs.rename,
  write: CliBinaryWrite = writeCliBinary
): Promise<void> {
  const directory = path.dirname(binaryPath)
  let stats: Stats
  try {
    stats = await fs.stat(binaryPath)
    if (!stats.isFile()) {
      throw new Error('the current CLI path is not a regular file')
    }
  } catch (error) {
    throw new Error(`The CLI cannot update ${binaryPath}; rerun it with sufficient permissions: ${errorMessage(error)}`, { cause: error })
  }

  const suffix = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`
  const stagingPath = path.join(directory, `.${path.basename(binaryPath)}.${suffix}.update`)
  let stagingHandle: Awaited<ReturnType<typeof fs.open>> | undefined
  let stagingCreated = false

  try {
    stagingHandle = await fs.open(stagingPath, 'wx', stats.mode)
    stagingCreated = true
    await write(stagingHandle, content)
    await stagingHandle.chmod(stats.mode)
    await stagingHandle.sync()
    await stagingHandle.close()
    stagingHandle = undefined

    await rename(stagingPath, binaryPath)
    stagingCreated = false
  } finally {
    await stagingHandle?.close().catch(() => undefined)
    if (stagingCreated) {
      await fs.rm(stagingPath, { force: true }).catch(() => undefined)
    }
  }
}

async function downloadHttps(url: URL, maximumBytes: number): Promise<Buffer> {
  if (url.protocol !== 'https:') {
    throw new Error(`Refusing a non-HTTPS update URL: ${url}`)
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error('Invalid maximum download size')
  }

  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetch(url, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal
    })
    const reader = response.body?.getReader()

    try {
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) {
          throw new Error(`Update download returned HTTP ${response.status} without a redirect location`)
        }
        if (redirects >= MAX_REDIRECTS) {
          throw new Error(`Update download exceeded ${MAX_REDIRECTS} redirects`)
        }

        let redirectUrl: URL
        try {
          redirectUrl = new URL(location, url)
        } catch (error) {
          throw new Error(`Update download returned an invalid redirect URL: ${errorMessage(error)}`, { cause: error })
        }
        if (redirectUrl.protocol !== 'https:') {
          throw new Error(`Refusing a non-HTTPS update redirect: ${redirectUrl}`)
        }
        url = redirectUrl
        continue
      }

      if (response.status !== 200) {
        throw new Error(`Update download failed with HTTP ${response.status}`)
      }
      const contentLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
        throw new Error(`Update download exceeds the ${maximumBytes}-byte limit`)
      }
      if (!reader) {
        throw new Error('Update download returned an empty response')
      }

      const chunks: Uint8Array[] = []
      let receivedBytes = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        receivedBytes += value.length
        if (receivedBytes > maximumBytes) {
          throw new Error(`Update download exceeds the ${maximumBytes}-byte limit`)
        }
        chunks.push(value)
      }
      return Buffer.concat(chunks, receivedBytes)
    } finally {
      await reader?.cancel().catch(() => undefined)
    }
  }
}

function verifyArchive(archive: Buffer, asset: CliReleaseAsset): void {
  if (archive.length !== asset.size) {
    throw new Error(`The downloaded CLI archive has size ${archive.length}, expected ${asset.size}`)
  }

  const actualHash = crypto.createHash('sha512').update(archive).digest('base64')
  if (actualHash !== asset.sha512) {
    throw new Error('The downloaded CLI archive failed SHA-512 verification')
  }
}

function parseVersion(version: string, label: string): number[] {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid ${label} version: ${version}`)
  }
  const parts = version.split('.').map(Number)
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Invalid ${label} version: ${version}`)
  }
  return parts
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
