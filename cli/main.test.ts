import process from 'node:process'
import type { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalArguments = [...process.argv]
const originalExitCode = process.exitCode

afterEach(() => {
  process.argv = [...originalArguments]
  process.exitCode = originalExitCode
  vi.doUnmock('./cmds')
  vi.doUnmock('./components/update-manager')
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('CLI bootstrap', () => {
  it('shows root help without failing when no command is provided', async () => {
    process.argv = ['node', '/tmp/sync-in-cli.js']
    const registerCommands = vi.fn()
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.doMock('./cmds', () => ({ registerCommands }))

    await import('./main')
    await vi.waitFor(() => expect(write).toHaveBeenCalled())
    expect(registerCommands).toHaveBeenCalledOnce()
    expect(process.exitCode).toBe(originalExitCode)
  })

  it('loads commands when no update is requested', async () => {
    process.argv = ['node', '/tmp/sync-in-cli.js', 'servers', 'list']
    const update = vi.fn()
    const handler = vi.fn()
    const registerCommands = vi.fn((program: Command) => {
      program.command('servers').command('list').action(handler)
    })
    vi.doMock('./components/update-manager', () => ({
      CliUpdateManager: class {
        update = update
      }
    }))
    vi.doMock('./cmds', () => ({ registerCommands }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await import('./main')
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())
    expect(registerCommands).toHaveBeenCalledOnce()
    expect(update).not.toHaveBeenCalled()
  })

  it('runs the updater without loading command modules', async () => {
    process.argv = ['node', '/tmp/sync-in-cli.js', '--update']
    const update = vi.fn(async () => ({
      status: 'up-to-date' as const,
      currentVersion: '2.2.1',
      latestVersion: '2.2.1',
      binaryPath: '/tmp/sync-in-cli.js'
    }))
    const loadCommands = vi.fn(() => {
      throw new Error('command modules must not be loaded')
    })
    vi.doMock('./components/update-manager', () => ({
      CliUpdateManager: class {
        update = update
      }
    }))
    vi.doMock('./cmds', loadCommands)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await import('./main')
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(loadCommands).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(originalExitCode)
  })

  it.each([
    { flags: ['--update=true'], loadsCommands: true },
    { flags: ['--update', 'false'], loadsCommands: false },
    { flags: ['--no-update'], loadsCommands: true },
    { flags: ['--update', 'servers', 'list'], loadsCommands: false }
  ])('rejects the legacy or combined update syntax $flags', async ({ flags, loadsCommands }) => {
    process.argv = ['node', '/tmp/sync-in-cli.js', ...flags]
    process.exitCode = undefined
    const update = vi.fn()
    const registerCommands = vi.fn()
    const loadCommands = vi.fn(() => ({ registerCommands }))
    vi.doMock('./components/update-manager', () => ({
      CliUpdateManager: class {
        update = update
      }
    }))
    vi.doMock('./cmds', loadCommands)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const writeError = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await import('./main')
    await vi.waitFor(() => expect(process.exitCode).toBe(1))
    expect(update).not.toHaveBeenCalled()
    expect(loadCommands).toHaveBeenCalledTimes(loadsCommands ? 1 : 0)
    expect(writeError).toHaveBeenCalled()
  })
})
