import type { Command } from 'commander'
import { ServersManager } from '../../core/components/handlers/servers'
import { Server } from '../../core/components/models/server'
import type { SyncClientRegistration } from '@sync-in-desktop/core/components/interfaces/sync-client-auth.interface'
import { parseNameOrId } from '../components/argument-parsers'
import type { ServerAddCommandOptions, ServerAuthCommandOptions, ServerTargetCommandOptions } from '../interfaces/cli-options.interface'

export function registerServerCommands(program: Command): void {
  const servers = program.command('servers').description('Manage servers')

  servers
    .command('list')
    .alias('ls')
    .description('List all servers')
    .action(() => {
      for (const server of ServersManager.list) {
        console.log(server.toString())
      }
    })

  servers
    .command('add')
    .alias('mk')
    .description('Add and register a server')
    .requiredOption('-n, --name <name>', 'Given name to identify the server')
    .requiredOption('-w, --url <url>', 'Server URL')
    .requiredOption('-u, --login <login>', 'Username or email')
    .requiredOption('-p, --password <password>', 'User password')
    .option('-c, --code <code>', '2FA authentication code (or recovery code)')
    .option('--allow-invalid-certificate', 'Allow unrecognized TLS certificate', false)
    .action(async (options: ServerAddCommandOptions) => {
      const server = new Server({
        name: options.name,
        url: options.url,
        allowInvalidCertificate: options.allowInvalidCertificate === true
      })
      console.log('Adding the server')
      ServersManager.checkUpdatedProperties(server)
      const manager = new ServersManager(server, false)
      const [ok, msg] = await manager.add({
        login: options.login,
        password: options.password,
        code: options.code
      } satisfies SyncClientRegistration)
      if (ok) {
        console.log('Server authentication & registration OK')
        console.log(server.toString())
      } else {
        console.error(`The server was not registered: ${msg}`)
      }
    })

  servers
    .command('auth')
    .alias('touch')
    .description('Re-authenticate on a server')
    .requiredOption('-s, --server <server>', 'Given id or name to identify the server', parseNameOrId)
    .requiredOption('-u, --login <login>', 'Username or email')
    .requiredOption('-p, --password <password>', 'User password')
    .option('-c, --code <code>', 'Two-Fa Authentication Code')
    .action(async (options: ServerAuthCommandOptions) => {
      const server = ServersManager.find(options.server)
      console.log(server.toString())
      const manager = new ServersManager(server, false)
      try {
        await manager.register(options.login, options.password, options.code)
        ServersManager.saveSettings()
        console.log('The token has been updated')
      } catch (error) {
        console.log(`The token has not been updated: ${error}`)
      }
    })

  servers
    .command('remove')
    .alias('rm')
    .description('Remove a server')
    .requiredOption('-s, --server <server>', 'Given id or name to identify the server', parseNameOrId)
    .action(async (options: ServerTargetCommandOptions) => {
      const server = ServersManager.find(options.server)
      console.log(server.toString())
      const status = await ServersManager.unregister(server)
      if (status.ok) {
        console.log('The server has been removed')
      } else {
        console.log(`The server has not been deleted : ${status.msg}`)
      }
    })

  servers.action(() => servers.outputHelp())
}
