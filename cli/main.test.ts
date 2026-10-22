import process from 'node:process'
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
  it.each([{ flags: ['--update', 'false'] }, { flags: ['--update=false'] }, { flags: ['--no-update'] }, { flags: ['--update', '--update=false'] }])(
    'loads commands when update is disabled with $flags',
    async ({ flags }) => {
      process.argv = ['node', '/tmp/sync-in-cli.js', ...flags, 'servers', 'list']
      const update = vi.fn()
      const handler = vi.fn()
      const getCMDS = vi.fn(() => [{ command: 'servers list', handler }])
      vi.doMock('./components/update-manager', () => ({
        CliUpdateManager: class {
          update = update
        }
      }))
      vi.doMock('./cmds', () => ({ getCMDS }))
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)

      await import('./main')
      await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce())
      expect(getCMDS).toHaveBeenCalledOnce()
      expect(update).not.toHaveBeenCalled()
    }
  )

  it.each([{ flags: ['--update'] }, { flags: ['--update', 'true'] }, { flags: ['--update=true'] }, { flags: ['--no-update', '--update'] }])(
    'runs the updater without loading command modules with $flags',
    async ({ flags }) => {
      process.argv = ['node', '/tmp/sync-in-cli.js', ...flags]
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
    }
  )
})
