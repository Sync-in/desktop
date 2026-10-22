import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { TextReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliBinaryRename, CliBinaryWrite } from './interfaces/update-manifest.interface'
import { CliUpdateManager, compareVersions, replaceCliBinary } from './update-manager'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })))
  vi.restoreAllMocks()
})

describe('CLI update versions', () => {
  it('compares stable semantic versions numerically', () => {
    expect(compareVersions('2.2.1', '2.2.1')).toBe(0)
    expect(compareVersions('2.2.1', '2.10.0')).toBe(-1)
    expect(compareVersions('3.0.0', '2.10.0')).toBe(1)
  })

  it('rejects non-stable versions', () => {
    expect(() => compareVersions('2.2.1-beta.1', '2.2.1')).toThrow('Invalid current CLI version')
  })
})

describe('CliUpdateManager', () => {
  it('follows HTTPS redirects and cancels their response bodies', async () => {
    const cancel = vi.fn()
    const redirect = new Response(new ReadableStream<Uint8Array>({ cancel }), {
      status: 302,
      headers: { location: 'https://example.test/latest.json' }
    })
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirect)
      .mockResolvedValueOnce(new Response(releaseManifest('2.2.1', Buffer.from('unused archive')).toString('utf8')))
    const manager = new CliUpdateManager({ binaryPath: '/unused/sync-in-cli.js', currentVersion: '2.2.1' })

    await expect(manager.update()).resolves.toMatchObject({ status: 'up-to-date', latestVersion: '2.2.1' })
    expect(fetch.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://github.com/Sync-in/desktop/releases/latest/download/latest.json',
      'https://example.test/latest.json'
    ])
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('refuses non-HTTPS redirects before requesting their target', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://example.test/update' } }))
    const manager = new CliUpdateManager({ binaryPath: '/unused/sync-in-cli.js', currentVersion: '2.2.1' })

    await expect(manager.update()).rejects.toThrow('Refusing a non-HTTPS update')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('refuses more than five redirects', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(null, { status: 302, headers: { location: '/redirect' } }))
    const manager = new CliUpdateManager({ binaryPath: '/unused/sync-in-cli.js', currentVersion: '2.2.1' })

    await expect(manager.update()).rejects.toThrow('exceeded 5 redirects')
    expect(fetch).toHaveBeenCalledTimes(6)
  })

  it('limits the received manifest size without a content-length header', async () => {
    const cancel = vi.fn()
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024 + 1))
        },
        cancel
      })
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)
    const manager = new CliUpdateManager({ binaryPath: '/unused/sync-in-cli.js', currentVersion: '2.2.1' })

    await expect(manager.update()).rejects.toThrow('1048576-byte limit')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('propagates response body read errors', async () => {
    const responseError = new Error('simulated download failure')
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(responseError)
        }
      })
    )
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    const manager = new CliUpdateManager({ binaryPath: '/unused/sync-in-cli.js', currentVersion: '2.2.1' })

    await expect(manager.update()).rejects.toThrow(responseError.message)
  })

  it('does not download a package when the current version is up to date', async () => {
    const archive = Buffer.from('unused archive')
    const download = vi.fn(async () => releaseManifest('2.2.1', archive))
    const manager = new CliUpdateManager({ binaryPath: '/unused/sync-in-cli.js', currentVersion: '2.2.1', download })

    await expect(manager.update()).resolves.toMatchObject({ status: 'up-to-date', latestVersion: '2.2.1' })
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('does not downgrade a version newer than the latest stable release', async () => {
    const archive = Buffer.from('unused archive')
    const download = vi.fn(async () => releaseManifest('2.2.1', archive))
    const manager = new CliUpdateManager({ binaryPath: '/unused/sync-in-cli.js', currentVersion: '2.3.0', download })

    await expect(manager.update()).resolves.toMatchObject({ status: 'local-newer', latestVersion: '2.2.1' })
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('replaces the current CLI at the exact same path and preserves its mode', async () => {
    const oldContent = '#!/usr/bin/env node\nconsole.log("old")\n'
    const newContent = '#!/usr/bin/env node\nconsole.log("new")\n'
    const binaryPath = await createInstalledCli(oldContent)
    const archive = await createArchive('2.3.0', newContent)
    const download = createDownloader('2.3.0', archive)
    const manager = new CliUpdateManager({ binaryPath, currentVersion: '2.2.1', download })

    await expect(manager.update()).resolves.toMatchObject({ status: 'updated', binaryPath })
    expect(await fs.readFile(binaryPath, 'utf8')).toBe(newContent)
    if (process.platform !== 'win32') {
      expect((await fs.stat(binaryPath)).mode & 0o777).toBe(0o755)
    }
    expect(await fs.readdir(path.dirname(binaryPath))).toEqual([path.basename(binaryPath)])
    expect(download.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://github.com/Sync-in/desktop/releases/latest/download/latest.json',
      'https://github.com/Sync-in/desktop/releases/download/v2.3.0/sync-in-cli-2.3.0.js.zip'
    ])
  })

  it.skipIf(process.platform === 'win32')('replaces an invoked symbolic link instead of resolving its target', async () => {
    const oldContent = '#!/usr/bin/env node\nconsole.log("old")\n'
    const newContent = '#!/usr/bin/env node\nconsole.log("new")\n'
    const directory = await createTemporaryDirectory()
    const targetPath = path.join(directory, 'installed-cli.js')
    const binaryPath = path.join(directory, 'sync-in-cli.js')
    await fs.writeFile(targetPath, oldContent, { mode: 0o555 })
    await fs.chmod(targetPath, 0o555)
    await fs.symlink(targetPath, binaryPath)

    const archive = await createArchive('2.3.0', newContent)
    const manager = new CliUpdateManager({ binaryPath, currentVersion: '2.2.1', download: createDownloader('2.3.0', archive) })

    await expect(manager.update()).resolves.toMatchObject({ status: 'updated', binaryPath })
    expect((await fs.lstat(binaryPath)).isSymbolicLink()).toBe(false)
    expect(await fs.readFile(binaryPath, 'utf8')).toBe(newContent)
    expect(await fs.readFile(targetPath, 'utf8')).toBe(oldContent)
  })

  it('keeps the current CLI when SHA-512 verification fails', async () => {
    const oldContent = '#!/usr/bin/env node\nconsole.log("old")\n'
    const binaryPath = await createInstalledCli(oldContent)
    const archive = await createArchive('2.3.0', '#!/usr/bin/env node\nconsole.log("new")\n')
    const manifest = JSON.parse(releaseManifest('2.3.0', archive).toString('utf8'))
    manifest.platform.node[0].sha512 = crypto.createHash('sha512').update('different content').digest('base64')
    const download = vi.fn(async (url: URL) => (url.pathname.endsWith('/latest.json') ? Buffer.from(JSON.stringify(manifest)) : archive))
    const manager = new CliUpdateManager({ binaryPath, currentVersion: '2.2.1', download })

    await expect(manager.update()).rejects.toThrow('SHA-512 verification')
    expect(await fs.readFile(binaryPath, 'utf8')).toBe(oldContent)
  })

  it('keeps the current CLI when the archive contains an unexpected entry', async () => {
    const oldContent = '#!/usr/bin/env node\nconsole.log("old")\n'
    const binaryPath = await createInstalledCli(oldContent)
    const archive = await createArchive('2.3.0', '#!/usr/bin/env node\nconsole.log("new")\n', 'unexpected.js')
    const manager = new CliUpdateManager({ binaryPath, currentVersion: '2.2.1', download: createDownloader('2.3.0', archive) })

    await expect(manager.update()).rejects.toThrow('must contain only sync-in-cli-2.3.0.js')
    expect(await fs.readFile(binaryPath, 'utf8')).toBe(oldContent)
  })
})

describe('replaceCliBinary', () => {
  it.skipIf(process.platform === 'win32')('replaces a read-only CLI when its directory is writable', async () => {
    const binaryPath = await createInstalledCli('#!/usr/bin/env node\nconsole.log("old")\n')
    const newContent = '#!/usr/bin/env node\nconsole.log("new")\n'
    await fs.chmod(binaryPath, 0o555)

    await expect(replaceCliBinary(binaryPath, Buffer.from(newContent))).resolves.toBeUndefined()
    expect(await fs.readFile(binaryPath, 'utf8')).toBe(newContent)
    expect((await fs.stat(binaryPath)).mode & 0o777).toBe(0o555)
  })

  it('keeps the current CLI in place when the atomic replacement fails', async () => {
    const oldContent = '#!/usr/bin/env node\nconsole.log("old")\n'
    const binaryPath = await createInstalledCli(oldContent)
    const rename: CliBinaryRename = async (source, destination) => {
      expect(source).toMatch(/\.update$/)
      expect(destination).toBe(binaryPath)
      expect(await fs.readFile(binaryPath, 'utf8')).toBe(oldContent)
      throw new Error('simulated install failure')
    }

    await expect(replaceCliBinary(binaryPath, Buffer.from('#!/usr/bin/env node\nconsole.log("new")\n'), rename)).rejects.toThrow(
      'simulated install failure'
    )
    expect(await fs.readFile(binaryPath, 'utf8')).toBe(oldContent)
    expect(await fs.readdir(path.dirname(binaryPath))).toEqual([path.basename(binaryPath)])
  })

  it('removes a partially written staging file', async () => {
    const oldContent = '#!/usr/bin/env node\nconsole.log("old")\n'
    const binaryPath = await createInstalledCli(oldContent)
    const write: CliBinaryWrite = async (file) => {
      await file.writeFile(Buffer.from('#!/usr/bin/env node\npartial'))
      throw new Error('simulated write failure')
    }

    await expect(replaceCliBinary(binaryPath, Buffer.from('#!/usr/bin/env node\nconsole.log("new")\n'), undefined, write)).rejects.toThrow(
      'simulated write failure'
    )
    expect(await fs.readFile(binaryPath, 'utf8')).toBe(oldContent)
    expect(await fs.readdir(path.dirname(binaryPath))).toEqual([path.basename(binaryPath)])
  })
})

async function createInstalledCli(content: string): Promise<string> {
  const directory = await createTemporaryDirectory()
  const binaryPath = path.join(directory, 'sync-in-cli.js')
  await fs.writeFile(binaryPath, content, { mode: 0o755 })
  await fs.chmod(binaryPath, 0o755)
  return binaryPath
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-in-cli-update-'))
  temporaryDirectories.push(directory)
  return directory
}

async function createArchive(version: string, content: string, filename = `sync-in-cli-${version}.js`): Promise<Buffer> {
  const writer = new Uint8ArrayWriter()
  const zip = new ZipWriter(writer)
  await zip.add(filename, new TextReader(content))
  return Buffer.from(await zip.close())
}

function createDownloader(version: string, archive: Buffer) {
  const manifest = releaseManifest(version, archive)
  return vi.fn(async (url: URL) => (url.pathname.endsWith('/latest.json') ? manifest : archive))
}

function releaseManifest(version: string, archive: Buffer): Buffer {
  return Buffer.from(
    JSON.stringify({
      version,
      platform: {
        node: [
          {
            package: `sync-in-cli-${version}.js.zip`,
            ext: 'zip',
            size: archive.length,
            sha512: crypto.createHash('sha512').update(archive).digest('base64')
          }
        ]
      }
    })
  )
}
