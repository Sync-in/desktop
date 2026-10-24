import { Command } from 'commander'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerRunCommand } from './cmd-run'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  setLevelLogger: vi.fn()
}))

vi.mock('../../core/main', () => ({
  RunManager: class {
    run = mocks.run
  }
}))

vi.mock('../../core/components/handlers/loggers', () => ({
  setLevelLogger: mocks.setLevelLogger
}))

function createProgram(): Command {
  const program = new Command().exitOverride().configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined
  })
  registerRunCommand(program)
  return program
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('run command', () => {
  it('preserves undefined filters and false boolean defaults', async () => {
    await createProgram().parseAsync(['run'], { from: 'user' })

    expect(mocks.run).toHaveBeenCalledWith({ server: undefined, paths: undefined }, false, false)
  })

  it('parses names and numeric identifiers from a variadic path option', async () => {
    await createProgram().parseAsync(['run', '--server', '7', '--path', '1', 'photos', '2', '--report'], { from: 'user' })

    expect(mocks.run).toHaveBeenCalledWith({ server: 7, paths: [1, 'photos', 2] }, true, false)
  })

  it('accumulates repeated path options', async () => {
    await createProgram().parseAsync(['run', '-p', '1', 'photos', '-p', '2', 'documents'], { from: 'user' })

    expect(mocks.run).toHaveBeenCalledWith({ server: undefined, paths: [1, 'photos', 2, 'documents'] }, false, false)
  })

  it('enables debug logging before running asynchronously', async () => {
    await createProgram().parseAsync(['run', '--debug', '--async'], { from: 'user' })

    expect(mocks.setLevelLogger).toHaveBeenCalledWith('debug')
    expect(mocks.run).toHaveBeenCalledWith({ server: undefined, paths: undefined }, false, true)
  })
})
