#!/usr/bin/env node
import process from 'node:process'
import { Command, CommanderError } from 'commander'
import { getLogger } from '../core/components/handlers/loggers'
import { ENVIRONMENT } from '../core/constants'
import { CliUpdateManager } from './components/update-manager'
import type { GlobalCommandOptions } from './interfaces/cli-options.interface'

const logger = getLogger('CommandLine')
const cliArguments = process.argv.slice(2)
const updateRequested = hasUpdateFlag(cliArguments)

function hasUpdateFlag(args: readonly string[]): boolean {
  const optionTerminatorIndex = args.indexOf('--')
  const options = optionTerminatorIndex === -1 ? args : args.slice(0, optionTerminatorIndex)
  return options.includes('--update')
}

function createProgram(): Command {
  const program = new Command()
    .name('sync-in-cli')
    .description('Sync-in command line interface')
    .version(ENVIRONMENT.appVersion, '-v, --version', 'output the version number')
    .option('--update', 'Update the CLI to the latest stable version', false)
    .allowExcessArguments(false)
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      outputError: (message) => logger.error(message.trimEnd())
    })

  program.action(() => {
    if (!program.opts<GlobalCommandOptions>().update) {
      program.outputHelp()
    }
  })

  return program
}

async function main(): Promise<void> {
  const program = createProgram()

  if (!updateRequested) {
    const { registerCommands } = await import(/* webpackMode: 'eager' */ './cmds')
    registerCommands(program)
  }

  await program.parseAsync(cliArguments, { from: 'user' })
  if (!program.opts<GlobalCommandOptions>().update) return

  const result = await new CliUpdateManager().update()
  switch (result.status) {
    case 'updated':
      console.log(`Sync-in CLI was updated from ${result.currentVersion} to ${result.latestVersion} at ${result.binaryPath}`)
      break
    case 'up-to-date':
      console.log(`Sync-in CLI ${result.currentVersion} is already up to date`)
      break
    case 'local-newer':
      console.log(`Sync-in CLI ${result.currentVersion} is newer than the latest stable release ${result.latestVersion}`)
      break
  }
}

void main().catch((error) => {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode
    return
  }

  const message = error instanceof Error ? error.message : String(error)
  console.error(`Sync-in CLI${updateRequested ? ' update' : ''} failed: ${message}`)
  logger.error(error)
  process.exitCode = 1
})
