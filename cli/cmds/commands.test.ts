import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import { registerCommands } from './index'

vi.mock('../../core/main', () => ({ RunManager: class {} }))
vi.mock('../../core/components/handlers/loggers', () => ({ setLevelLogger: vi.fn() }))
vi.mock('../../core/components/handlers/servers', () => ({ ServersManager: class {} }))
vi.mock('../../core/components/handlers/paths', () => ({ PathsManager: class {} }))
vi.mock('../../core/components/models/server', () => ({ Server: class {} }))

function createProgram(): Command {
  const program = new Command().exitOverride().configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined
  })
  registerCommands(program)
  return program
}

function getCommand(parent: Command, name: string): Command {
  const command = parent.commands.find((candidate) => candidate.name() === name)
  expect(command, `command ${name}`).toBeDefined()
  return command as Command
}

describe('CLI command configuration', () => {
  it('registers every command and alias', () => {
    const program = createProgram()
    const servers = getCommand(program, 'servers')
    const paths = getCommand(program, 'paths')

    expect(program.commands.map((command) => command.name())).toEqual(['run', 'servers', 'paths'])
    expect(servers.commands.map((command) => [command.name(), command.aliases()])).toEqual([
      ['list', ['ls']],
      ['add', ['mk']],
      ['auth', ['touch']],
      ['remove', ['rm']]
    ])
    expect(paths.commands.map((command) => [command.name(), command.aliases()])).toEqual([
      ['list', ['ls']],
      ['add', ['mk']],
      ['remove', ['rm']],
      ['set', ['vi']],
      ['update', ['up']],
      ['flush', ['reset']]
    ])
  })

  it('uses kebab-case options with camel-case attributes', () => {
    const pathsAdd = getCommand(getCommand(createProgram(), 'paths'), 'add')
    const longOptions = pathsAdd.options.map((option) => option.long)

    expect(longOptions).toContain('--local-path')
    expect(longOptions).toContain('--remote-path')
    expect(longOptions).toContain('--ignore-delete')
    expect(longOptions).toContain('--diff-mode')
    expect(longOptions).toContain('--conflict-mode')
    expect(longOptions).not.toContain('--localPath')
    expect(pathsAdd.options.find((option) => option.long === '--local-path')?.attributeName()).toBe('localPath')
  })

  it('keeps required options, choices and defaults on paths add', () => {
    const pathsAdd = getCommand(getCommand(createProgram(), 'paths'), 'add')
    const option = (longName: string) => pathsAdd.options.find((candidate) => candidate.long === longName)

    expect(option('--server')?.mandatory).toBe(true)
    expect(option('--local-path')?.mandatory).toBe(true)
    expect(option('--remote-path')?.mandatory).toBe(true)
    expect(option('--mode')?.mandatory).toBe(true)
    expect(option('--mode')?.argChoices).toEqual(['download', 'upload', 'both'])
    expect(option('--diff-mode')?.defaultValue).toBe('fast')
    expect(option('--conflict-mode')?.defaultValue).toBe('recent')
    expect(option('--ignore-delete')?.defaultValue).toBe(false)
  })

  it('rejects an invalid mode before executing a handler', async () => {
    const program = createProgram()

    await expect(
      program.parseAsync(['paths', 'add', '--server', '1', '--local-path', '/tmp/files', '--remote-path', 'personal/files', '--mode', 'invalid'], {
        from: 'user'
      })
    ).rejects.toMatchObject({ code: 'commander.invalidArgument', exitCode: 1 })
  })
})
