#!/usr/bin/env node
import process from 'node:process'
import _yargs from 'yargs/yargs'
import { hideBin } from 'yargs/helpers'
import { getLogger } from '../core/components/handlers/loggers'
import { getCMDS } from './cmds'

// Catch deprecated warnings
const originalEmitWarning = process.emitWarning.bind(process)
process.emitWarning = ((...args: string[]) => {
  if (args.indexOf('DEP0169') > -1) {
    // todo: remove this when fixed
    // https://github.com/axios/axios/issues/7228
    // DeprecationWarning: url.parse() used in proxy resolution → Node DEP0169
    return
  }
  return originalEmitWarning(...args)
}) as any

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
