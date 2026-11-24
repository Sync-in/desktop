import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SYNC_CHECKSUM_ALG } from '../constants/handlers'
import { checksumFileWithChunks } from './functions'
import { cleanupDownloadTmpFiles, ensureDownloadTmpDirectory, getDownloadTmpPath, getDownloadTmpPrefix } from './download-checkpoints'

const checksum = (content: Buffer | string): string => crypto.createHash(SYNC_CHECKSUM_ALG).update(content).digest('hex')

describe(checksumFileWithChunks.name, () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-checksums-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { force: true, recursive: true })
  })

  it('returns no chunk checksum for an empty file', async () => {
    const filePath = path.join(tmpDir, 'empty.bin')
    await fs.writeFile(filePath, '')

    await expect(checksumFileWithChunks(filePath, 4)).resolves.toEqual({ checksum: checksum(''), chunks: [] })
  })

  it('returns the global checksum as the checksum of a single chunk', async () => {
    const content = Buffer.from('single chunk')
    const filePath = path.join(tmpDir, 'single.bin')
    await fs.writeFile(filePath, content)

    await expect(checksumFileWithChunks(filePath, content.length + 1)).resolves.toEqual({
      checksum: checksum(content),
      chunks: [checksum(content)]
    })
  })

  it('calculates fixed-boundary checksums including a partial final chunk', async () => {
    const content = Buffer.from('abcdefghij')
    const filePath = path.join(tmpDir, 'multiple.bin')
    await fs.writeFile(filePath, content)

    await expect(checksumFileWithChunks(filePath, 4)).resolves.toEqual({
      checksum: checksum(content),
      chunks: [checksum(content.subarray(0, 4)), checksum(content.subarray(4, 8)), checksum(content.subarray(8))]
    })
  })
})

describe(getDownloadTmpPath.name, () => {
  const clientId = '00000000-0000-4000-8000-000000000001'

  it('uses a stable flat name inside the reserved root directory', () => {
    const localRoot = path.join(path.sep, 'local', 'media')
    const filePath = 'documents/report.pdf'
    const transferId = checksum(filePath)

    expect(getDownloadTmpPath(localRoot, clientId, 17, filePath)).toBe(
      path.join(localRoot, '.sync-in-tmp', `${getDownloadTmpPrefix(clientId, 17)}${transferId}.part`)
    )
  })

  it('rejects invalid client and path identifiers', () => {
    expect(() => getDownloadTmpPrefix('client/id', 17)).toThrow('Invalid Sync client identifier')
    expect(() => getDownloadTmpPrefix(clientId, 0)).toThrow('Invalid Sync path identifier')
  })

  it('uses the same checkpoint for canonically equivalent Unicode paths', () => {
    expect(getDownloadTmpPath('/local/media', clientId, 17, 'documents/cafe\u0301.txt')).toBe(
      getDownloadTmpPath('/local/media', clientId, 17, 'documents/caf\u00e9.txt')
    )
  })

  it('cleans only the exact client and synchronization-path namespace', async () => {
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-download-root-'))
    const temporaryDirectory = path.join(localRoot, '.sync-in-tmp')
    const temporaryPrefix = getDownloadTmpPrefix(clientId, 17)
    const ownedFile = `${temporaryPrefix}${'a'.repeat(64)}.part`
    const ownedDirectory = `${temporaryPrefix}${'b'.repeat(64)}.part`
    const preservedNames = [
      `${temporaryPrefix}${'c'.repeat(63)}.part`,
      `${getDownloadTmpPrefix(clientId, 18)}${'d'.repeat(64)}.part`,
      `${getDownloadTmpPrefix('00000000-0000-4000-8000-000000000002', 17)}${'e'.repeat(64)}.part`,
      `server-user-42-download-${'f'.repeat(64)}.part`
    ]
    await fs.mkdir(path.join(temporaryDirectory, ownedDirectory), { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(temporaryDirectory, ownedFile), 'checkpoint'),
      fs.writeFile(path.join(temporaryDirectory, ownedDirectory, 'nested'), 'checkpoint'),
      ...preservedNames.map((fileName) => fs.writeFile(path.join(temporaryDirectory, fileName), 'preserved'))
    ])

    try {
      await cleanupDownloadTmpFiles(localRoot, clientId, 17)

      await expect(fs.readdir(temporaryDirectory).then((entries) => entries.sort())).resolves.toEqual([...preservedNames].sort())
    } finally {
      await fs.rm(localRoot, { force: true, recursive: true })
    }
  })

  it.skipIf(process.platform === 'win32')('keeps POSIX paths containing a backslash distinct from nested paths', () => {
    expect(getDownloadTmpPath('/local/media', clientId, 17, 'a\\b')).not.toBe(getDownloadTmpPath('/local/media', clientId, 17, 'a/b'))
  })

  it('never replaces a regular file used as the reserved temporary location', async () => {
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-download-root-'))
    const reservedPath = path.join(localRoot, '.sync-in-tmp')
    await fs.writeFile(reservedPath, 'user data')

    try {
      await expect(ensureDownloadTmpDirectory(localRoot)).rejects.toBeDefined()
      await expect(fs.readFile(reservedPath, 'utf8')).resolves.toBe('user data')
    } finally {
      await fs.rm(localRoot, { force: true, recursive: true })
    }
  })

  it.skipIf(process.platform === 'win32')('never follows a symlink used as the reserved temporary location', async () => {
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-download-root-'))
    const externalDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-download-external-'))
    const reservedPath = path.join(localRoot, '.sync-in-tmp')
    const externalFile = path.join(externalDirectory, 'user-data.txt')
    await fs.writeFile(externalFile, 'user data')
    await fs.symlink(externalDirectory, reservedPath, 'dir')

    try {
      await expect(ensureDownloadTmpDirectory(localRoot)).rejects.toThrow('Internal temporary location is not a directory')
      await expect(fs.readFile(externalFile, 'utf8')).resolves.toBe('user data')
      await expect(fs.lstat(reservedPath).then((stats) => stats.isSymbolicLink())).resolves.toBe(true)
    } finally {
      await fs.rm(localRoot, { force: true, recursive: true })
      await fs.rm(externalDirectory, { force: true, recursive: true })
    }
  })
})
