#!/usr/bin/env node
import _yargs from 'yargs/yargs'
import { hideBin } from 'yargs/helpers'
import { getLogger } from '../core/components/handlers/loggers'
import { getCMDS } from './cmds'

const logger = getLogger('CommandLine')

const yargs = _yargs(hideBin(process.argv))

yargs.command(getCMDS(yargs) as any)
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
  process.exit()
})
yargs.strict()
yargs.parse()
