/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { Argv, CommandModule } from 'yargs'
import { ServersManager } from '../../core/components/handlers/servers'
import { Server } from '../../core/components/models/server'
import type { SyncClientRegistration } from '@sync-in-desktop/core/components/interfaces/sync-client-auth.interface'

const serverLS: CommandModule = {
  command: 'list',
  aliases: ['ls'],
  describe: 'List all servers',
  handler: () => {
    for (const server of ServersManager.list) {
      console.log(server.toString())
    }
  }
}
const serverADD: CommandModule = {
  command: 'add',
  aliases: ['mk'],
  describe: 'Add and register a server',
  builder: {
    name: {
      alias: 'n',
      describe: 'Given name to identify the server',
      demandOption: true,
      type: 'string'
    },
    url: {
      alias: 'w',
      describe: 'Server URL',
      demandOption: true,
      type: 'string'
    },
    login: {
      alias: 'u',
      describe: 'Username or email',
      demandOption: true,
      type: 'string'
    },
    password: {
      alias: 'p',
      describe: 'User password',
      demandOption: true,
      type: 'string'
    },
    code: {
      alias: 'c',
      describe: '2FA authentication code (or recovery code)',
      demandOption: false,
      type: 'string'
    }
  },
  handler: async (argv: any) => {
    const server = new Server({ name: argv.name, url: argv.url })
    console.log('Adding the server')
    ServersManager.checkUpdatedProperties(server)
    const manager = new ServersManager(server, false)
    const [ok, msg] = await manager.add({ login: argv.login, password: argv.password, code: argv.code } satisfies SyncClientRegistration)
    if (ok) {
      console.log('Server authentication & registration OK')
      console.log(server.toString())
    } else {
      console.error(`The server was not registered: ${msg}`)
    }
  }
}
const serverAUTH: CommandModule = {
  command: 'auth',
  aliases: ['touch'],
  describe: 'Re-authenticate on a server',
  builder: {
    server: {
      alias: 's',
      describe: 'Given id or name to identify the server',
      demandOption: true,
      type: 'string'
    },
    login: {
      alias: 'u',
      describe: 'Username or email',
      demandOption: true,
      type: 'string'
    },
    password: {
      alias: 'p',
      describe: 'User password',
      demandOption: true,
      type: 'string'
    },
    code: {
      alias: 'c',
      describe: 'Two-Fa Authentication Code',
      demandOption: false,
      type: 'string'
    }
  },
  handler: async (argv: any) => {
    const server = ServersManager.find(argv.server)
    console.log(server.toString())
    const manager = new ServersManager(server, false)
    try {
      await manager.register(argv.login, argv.password, argv.code)
      ServersManager.saveSettings()
      console.log('The token has been updated')
    } catch (e) {
      console.log(`The token has not been updated: ${e}`)
    }
  }
}
const serverRM: CommandModule = {
  command: 'remove',
  aliases: ['rm'],
  describe: 'Remove a server',
  builder: {
    server: {
      alias: 's',
      describe: 'Given id or name to identify the server',
      demandOption: true
    }
  },
  handler: async (argv: any) => {
    const server = ServersManager.find(argv.server)
    console.log(server.toString())
    const status = await ServersManager.unregister(server)
    if (status.ok) {
      console.log('The server has been removed')
    } else {
      console.log(`The server has not been deleted : ${status.msg}`)
    }
  }
}

export function getServerCMD(yargs) {
  return {
    command: 'servers',
    describe: 'Manage servers',
    builder: (yargs): Argv[] => [
      yargs.command(serverLS).help(false).version(false),
      yargs.command(serverADD).help(false).version(false),
      yargs.command(serverAUTH).help(false).version(false),
      yargs.command(serverRM).help(false).version(false)
    ],
    handler: () => yargs.showHelp()
  }
}
