/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { setLevelLogger } from '../../core/components/handlers/loggers'
import { CommandModule } from 'yargs'
import { RunManager } from '../../core/main'

const runCMD: CommandModule = {
  command: 'run',
  describe: 'Synchronize (help for options)',
  builder: {
    report: {
      alias: 'r',
      describe: 'Only report (dry run)',
      default: false,
      boolean: true,
      type: 'boolean'
    },
    debug: {
      alias: 'd',
      describe: 'Enable debug mode',
      default: false,
      boolean: true,
      type: 'boolean'
    },
    async: {
      alias: 'a',
      describe: 'Run syncs in parallel',
      default: false,
      boolean: true,
      type: 'boolean'
    },
    server: {
      alias: 's',
      describe: 'Given id or name to sync the target server'
    },
    path: {
      alias: 'p',
      array: true,
      describe: 'Given id or name to sync the target path, "server" must be specified'
    }
  },
  handler: async (argv: any) => {
    try {
      if (argv.debug) {
        setLevelLogger('debug')
      }
      await new RunManager().run({ server: argv.server, paths: argv.path }, argv.report, argv.async)
    } catch (e) {
      console.error(e)
    }
  }
}

export function getRunCMD() {
  return runCMD
}
