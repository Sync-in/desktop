import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from '@sync-in-desktop/core/components/models/server'
import { isUrlWithinServerScope, openExternal, showItemInFolder } from './utils'

const electronMock = vi.hoisted(() => ({
  shell: {
    openExternal: vi.fn(),
    showItemInFolder: vi.fn()
  }
}))

vi.mock('electron', () => electronMock)

describe('main utils external access guards', () => {
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-in-desktop-utils-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true })
  })

  it('opens only http and https URLs externally', async () => {
    await openExternal('https://sync-in.com/docs?x=1#top')
    await openExternal('http://localhost:3000/path')

    expect(electronMock.shell.openExternal).toHaveBeenNthCalledWith(1, 'https://sync-in.com/docs?x=1#top')
    expect(electronMock.shell.openExternal).toHaveBeenNthCalledWith(2, 'http://localhost:3000/path')
  })

  it('rejects unsupported external URL protocols', async () => {
    await expect(openExternal('file:///tmp/token')).rejects.toThrow('Unsupported external URL protocol: file:')
    await expect(openExternal('javascript:alert(1)')).rejects.toThrow('Unsupported external URL protocol: javascript:')

    expect(electronMock.shell.openExternal).not.toHaveBeenCalled()
  })

  it('shows only files inside configured sync roots', () => {
    const syncRoot = path.join(tmpDir, 'sync-root')
    const filePath = path.join(syncRoot, 'nested', 'file.txt')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, 'content')

    showItemInFolder(filePath, serverWithPaths([syncRoot]))

    expect(electronMock.shell.showItemInFolder).toHaveBeenCalledWith(fs.realpathSync(filePath))
  })

  it('ignores relative and outside paths', () => {
    const syncRoot = path.join(tmpDir, 'sync-root')
    const outsideRoot = path.join(tmpDir, 'outside')
    const outsideFile = path.join(outsideRoot, 'file.txt')
    fs.mkdirSync(syncRoot, { recursive: true })
    fs.mkdirSync(outsideRoot, { recursive: true })
    fs.writeFileSync(outsideFile, 'content')

    showItemInFolder('relative/file.txt', serverWithPaths([syncRoot]))
    showItemInFolder(outsideFile, serverWithPaths([syncRoot]))

    expect(electronMock.shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('resolves traversal before checking sync roots', () => {
    const syncRoot = path.join(tmpDir, 'sync-root')
    const outsideRoot = path.join(tmpDir, 'outside')
    const outsideFile = path.join(outsideRoot, 'file.txt')
    fs.mkdirSync(syncRoot, { recursive: true })
    fs.mkdirSync(outsideRoot, { recursive: true })
    fs.writeFileSync(outsideFile, 'content')

    showItemInFolder(path.join(syncRoot, '..', 'outside', 'file.txt'), serverWithPaths([syncRoot]))

    expect(electronMock.shell.showItemInFolder).not.toHaveBeenCalled()
  })

  it('ignores sync roots that cannot be resolved', () => {
    const syncRoot = path.join(tmpDir, 'sync-root')
    const filePath = path.join(syncRoot, 'file.txt')
    fs.mkdirSync(syncRoot, { recursive: true })
    fs.writeFileSync(filePath, 'content')

    showItemInFolder(filePath, serverWithPaths([path.join(tmpDir, 'missing-root')]))

    expect(electronMock.shell.showItemInFolder).not.toHaveBeenCalled()
  })
})

describe('main utils webview URL scope', () => {
  it('accepts URLs inside the same origin and path scope', () => {
    expect(isUrlWithinServerScope('https://sync-in.example/app', 'https://sync-in.example/app')).toBe(true)
    expect(isUrlWithinServerScope('https://sync-in.example/app/files', 'https://sync-in.example/app')).toBe(true)
    expect(isUrlWithinServerScope('https://sync-in.example/app/files?sort=name#top', 'https://sync-in.example/app')).toBe(true)
  })

  it('accepts any path when the server scope is the origin root', () => {
    expect(isUrlWithinServerScope('https://sync-in.example/files', 'https://sync-in.example/')).toBe(true)
  })

  it('rejects sibling paths that only share a prefix', () => {
    expect(isUrlWithinServerScope('https://sync-in.example/application', 'https://sync-in.example/app')).toBe(false)
    expect(isUrlWithinServerScope('https://sync-in.example/app2', 'https://sync-in.example/app')).toBe(false)
  })

  it('rejects different origins', () => {
    expect(isUrlWithinServerScope('http://sync-in.example/app', 'https://sync-in.example/app')).toBe(false)
    expect(isUrlWithinServerScope('https://other.example/app', 'https://sync-in.example/app')).toBe(false)
    expect(isUrlWithinServerScope('https://sync-in.example:8443/app', 'https://sync-in.example/app')).toBe(false)
  })

  it('rejects invalid URLs', () => {
    expect(isUrlWithinServerScope('not-a-url', 'https://sync-in.example/app')).toBe(false)
    expect(isUrlWithinServerScope('https://sync-in.example/app', 'not-a-url')).toBe(false)
  })
})

function serverWithPaths(localPaths: string[]): Server {
  return {
    syncPaths: localPaths.map((localPath) => ({ localPath }))
  } as Server
}
