/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { Argv, CommandModule } from 'yargs'
import { ServersManager } from '../../core/components/handlers/servers'
import { PathsManager } from '../../core/components/handlers/paths'
import { CONFLICT_MODE, DIFF_MODE, SYNC_MODE } from '../../core/components/constants/diff'
import { SYNC_PATH_REPOSITORY } from '@sync-in-desktop/core/components/constants/paths'

const pathLS: CommandModule = {
  command: 'list',
  aliases: ['ls'],
  describe: 'List all synced paths',
  handler: () => {
    for (const server of ServersManager.list) {
      if (server.syncPaths.length) {
        console.log(server.printName())
        for (const sync of server.syncPaths) {
          console.log(sync.repr())
        }
      }
    }
  }
}
const pathADD: CommandModule = {
  command: 'add',
  aliases: ['mk'],
  describe: 'Add a path to synchronize',
  builder: {
    server: {
      alias: 's',
      describe: 'Given id or name to identify the server',
      demandOption: true
    },
    localPath: {
      alias: 'l',
      describe: 'Path to a folder or a file on your computer',
      type: 'string',
      normalize: true,
      demandOption: true
    },
    remotePath: {
      alias: 'r',
      describe: `Path to a folder or a file on your server, path must start with "${SYNC_PATH_REPOSITORY.PERSONAL}" | "${SYNC_PATH_REPOSITORY.SPACES}" | "${SYNC_PATH_REPOSITORY.SHARES}" to identify the location`,
      type: 'string',
      demandOption: true
    },
    name: {
      alias: 'n',
      describe: 'Defines the sync name',
      default: undefined,
      type: 'string'
    },
    mode: {
      alias: 'm',
      describe: 'Defines the sync mode',
      choices: [SYNC_MODE.DOWNLOAD, SYNC_MODE.UPLOAD, SYNC_MODE.BOTH],
      type: 'string',
      demandOption: true
    },
    diffMode: {
      alias: 'd',
      describe: 'Defines how differences are analyzed',
      choices: [DIFF_MODE.FAST, DIFF_MODE.SECURE],
      default: DIFF_MODE.FAST,
      type: 'string'
    },
    conflictMode: {
      alias: 'c',
      describe: `Defines how conflicts are resolved when diffMode is "${SYNC_MODE.BOTH}"`,
      choices: [CONFLICT_MODE.RECENT, CONFLICT_MODE.LOCAL, CONFLICT_MODE.REMOTE],
      default: CONFLICT_MODE.RECENT,
      type: 'string'
    }
  },
  handler: async (argv: any) => {
    try {
      const manager = new PathsManager(argv.server)
      const syncPath = await manager.add(argv)
      console.log(manager.server.printName())
      console.log(syncPath.repr())
      console.log('The path has been added')
    } catch (e) {
      console.error(e)
    }
  }
}
const pathRM: CommandModule = {
  command: 'remove',
  aliases: ['rm'],
  describe: 'Remove a synced path',
  builder: {
    server: {
      alias: 's',
      describe: 'Given id or name to identify the server',
      demandOption: true
    },
    path: {
      alias: 'p',
      describe: 'Given id or name to identify the synced path',
      demandOption: true
    }
  },
  handler: async (argv: any) => {
    try {
      const manager = new PathsManager(argv.server)
      const syncPath = await manager.remove(argv.path)
      console.log(manager.server.printName())
      console.log(syncPath.repr())
      console.log('The path has been removed')
    } catch (e) {
      console.error(e)
    }
  }
}
const pathSET: CommandModule = {
  command: 'set',
  aliases: ['vi'],
  describe: 'Set options to a synced path',
  builder: {
    server: {
      alias: 's',
      describe: 'Given id or name to identify the server',
      demandOption: true
    },
    path: {
      alias: 'p',
      describe: 'Given id or name to identify the synced path',
      demandOption: true
    },
    name: {
      alias: 'n',
      describe: 'Defines the sync name',
      type: 'string'
    },
    mode: {
      alias: 'm',
      describe: 'Defines the sync mode',
      choices: [SYNC_MODE.DOWNLOAD, SYNC_MODE.UPLOAD, SYNC_MODE.BOTH],
      type: 'string'
    },
    diffMode: {
      alias: 'd',
      describe: 'Defines how differences are analyzed',
      choices: [DIFF_MODE.FAST, DIFF_MODE.SECURE],
      type: 'string'
    },
    conflictMode: {
      alias: 'c',
      describe: `Defines how conflicts are resolved when diffMode is "${SYNC_MODE.BOTH}"`,
      choices: [CONFLICT_MODE.RECENT, CONFLICT_MODE.LOCAL, CONFLICT_MODE.REMOTE],
      type: 'string'
    }
  },
  handler: async (argv: any) => {
    try {
      const manager = new PathsManager(argv.server)
      const syncPath = await manager.set(argv)
      console.log(manager.server.printName())
      console.log(syncPath.repr())
      console.log('The path has been modified')
    } catch (e) {
      console.error(e)
    }
  }
}
const pathUPDATE: CommandModule = {
  command: 'update',
  aliases: ['up'],
  builder: {
    server: {
      alias: 's',
      describe: 'Given id or name to identify the server',
      demandOption: true
    }
  },
  describe: 'update all synced path settings from server',
  handler: async (argv: any) => {
    try {
      const manager = new PathsManager(argv.server)
      await manager.update()
      console.log('The paths have been updated')
    } catch (e) {
      console.error(e)
    }
  }
}
const pathFLUSH: CommandModule = {
  command: 'flush',
  aliases: ['reset'],
  describe: 'Flush snapshots from a synced path',
  builder: {
    server: {
      alias: 's',
      describe: 'Given id or name to identify the server',
      demandOption: true
    },
    path: {
      alias: 'p',
      describe: 'Given id or name to identify the synced path',
      demandOption: true
    }
  },
  handler: async (argv: any) => {
    try {
      const manager = new PathsManager(argv.server)
      const syncPath = await manager.flush(argv.path)
      console.log(manager.server.printName())
      console.log(syncPath.repr())
      console.log('The snapshots have been flushed')
    } catch (e) {
      console.error(e)
    }
  }
}

export function getPathsCMD(yargs) {
  return {
    command: 'paths',
    describe: 'Manage synced paths',
    builder: (yargs): Argv[] => [
      yargs.command(pathLS).help(false).version(false),
      yargs.command(pathADD).help(false).version(false),
      yargs.command(pathRM).help(false).version(false),
      yargs.command(pathSET).help(false).version(false),
      yargs.command(pathUPDATE).help(false).version(false),
      yargs.command(pathFLUSH).help(false).version(false)
    ],
    handler: () => yargs.showHelp()
  }
}
