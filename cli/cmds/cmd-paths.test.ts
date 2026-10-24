import path from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerPathCommands } from './cmd-paths'

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  add: vi.fn(),
  set: vi.fn(),
  printName: vi.fn(() => 'server'),
  repr: vi.fn(() => ({ id: 1 }))
}))

vi.mock('../../core/components/handlers/servers', () => ({
  ServersManager: class {
    static list = []
  }
}))

vi.mock('../../core/components/handlers/paths', () => ({
  PathsManager: class {
    server = { printName: mocks.printName }
    add = mocks.add
    set = mocks.set

    constructor(server: string | number) {
      mocks.construct(server)
    }
  }
}))

function createProgram(): Command {
  const program = new Command().exitOverride().configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined
  })
  registerPathCommands(program)
  return program
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.add.mockResolvedValue({ repr: mocks.repr })
  mocks.set.mockResolvedValue({ repr: mocks.repr })
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('paths commands', () => {
  it('maps kebab-case add options to typed camel-case values', async () => {
    const localPath = path.join('/tmp', 'folder', '..', 'files')

    await createProgram().parseAsync(
      ['paths', 'add', '--server', '7', '--local-path', localPath, '--remote-path', 'personal/files', '--mode', 'both', '--ignore-delete'],
      { from: 'user' }
    )

    expect(mocks.construct).toHaveBeenCalledWith(7)
    expect(mocks.add).toHaveBeenCalledWith({
      server: 7,
      localPath: path.normalize(localPath),
      remotePath: 'personal/files',
      mode: 'both',
      ignoreDelete: true,
      diffMode: 'fast',
      conflictMode: 'recent'
    })
  })

  it('parses optional set values without injecting defaults', async () => {
    await createProgram().parseAsync(['paths', 'set', '--server', 'production', '--path', '9', '--ignore-delete', 'false', '--diff-mode', 'secure'], {
      from: 'user'
    })

    expect(mocks.construct).toHaveBeenCalledWith('production')
    expect(mocks.set).toHaveBeenCalledWith({
      server: 'production',
      path: 9,
      ignoreDelete: false,
      diffMode: 'secure'
    })
  })

  it('rejects legacy camel-case option names', async () => {
    await expect(
      createProgram().parseAsync(
        [
          'paths',
          'add',
          '--server',
          '1',
          '--local-path',
          '/tmp/files',
          '--remote-path',
          'personal/files',
          '--mode',
          'both',
          '--localPath',
          '/tmp/legacy'
        ],
        { from: 'user' }
      )
    ).rejects.toMatchObject({ code: 'commander.unknownOption', exitCode: 1 })

    expect(mocks.add).not.toHaveBeenCalled()
  })
})
