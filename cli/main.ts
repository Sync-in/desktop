#!/usr/bin/env node
import process from 'node:process'
import _yargs from 'yargs/yargs'
import { hideBin } from 'yargs/helpers'
import { getLogger } from '../core/components/handlers/loggers'
import { ENVIRONMENT } from '../core/constants'
import { CliUpdateManager } from './components/update-manager'

const logger = getLogger('CommandLine')
const cliArguments = hideBin(process.argv)
const updateRequested = _yargs(cliArguments).help(false).version(false).exitProcess(false).boolean('update').parseSync().update === true

const yargs = _yargs(cliArguments).version(ENVIRONMENT.appVersion).option('update', {
  type: 'boolean',
  describe: 'Update the CLI to the latest stable version'
})
yargs.check((argv) => {
  if (argv.update && argv._.length) {
    throw new Error('--update cannot be combined with a command')
  }
  return true
})
yargs.fail((msg: string, e: Error | string) => {
  if (msg) {
    yargs.showHelp()
    logger.error(msg)
  } else if (typeof e === 'string' && e.includes('argument')) {
    // hook to show help when handler manages argv options
    yargs.showHelp()
    logger.error(e)
  } else {
    logger.error(e)
  }
  process.exit(1)
})
yargs.strict()

async function main(): Promise<void> {
  if (!updateRequested) {
    const { getCMDS } = await import(/* webpackMode: 'eager' */ './cmds')
    yargs.command(getCMDS(yargs) as any)
  }

  const argv = await yargs.parseAsync()
  if (!argv.update) return

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
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Sync-in CLI${updateRequested ? ' update' : ''} failed: ${message}`)
  logger.error(error)
  process.exitCode = 1
})
