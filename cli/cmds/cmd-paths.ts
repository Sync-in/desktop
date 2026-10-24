import path from 'node:path'
import { type Command, Option } from 'commander'
import { ServersManager } from '../../core/components/handlers/servers'
import { PathsManager } from '../../core/components/handlers/paths'
import { CONFLICT_MODE, DIFF_MODE, SYNC_MODE } from '../../core/components/constants/diff'
import { SYNC_PATH_REPOSITORY } from '@sync-in-desktop/core/components/constants/paths'
import { parseBoolean, parseNameOrId } from '../components/argument-parsers'
import type {
  PathAddCommandOptions,
  PathSetCommandOptions,
  PathTargetCommandOptions,
  ServerTargetCommandOptions
} from '../interfaces/cli-options.interface'

export function registerPathCommands(program: Command): void {
  const paths = program.command('paths').description('Manage synced paths')

  paths
    .command('list')
    .alias('ls')
    .description('List all synced paths')
    .action(() => {
      for (const server of ServersManager.list) {
        if (server.syncPaths.length) {
          console.log(server.printName())
          for (const sync of server.syncPaths) {
            console.log(sync.repr())
          }
        }
      }
    })

  paths
    .command('add')
    .alias('mk')
    .description('Add a path to synchronize')
    .requiredOption('-s, --server <server>', 'Given id or name to identify the server', parseNameOrId)
    .requiredOption('-l, --local-path <path>', 'Path to a folder or a file on your computer', path.normalize)
    .requiredOption(
      '-r, --remote-path <path>',
      `Path to a folder or a file on your server, path must start with "${SYNC_PATH_REPOSITORY.PERSONAL}" | "${SYNC_PATH_REPOSITORY.SPACES}" | "${SYNC_PATH_REPOSITORY.SHARES}" to identify the location`
    )
    .option('-n, --name <name>', 'Defines the sync name')
    .addOption(new Option('-m, --mode <mode>', 'Defines the sync mode').choices(Object.values(SYNC_MODE)).makeOptionMandatory())
    .option('--ignore-delete', 'Do not synchronize deletions', false)
    .addOption(new Option('-d, --diff-mode <mode>', 'Defines how differences are analyzed').choices(Object.values(DIFF_MODE)).default(DIFF_MODE.FAST))
    .addOption(
      new Option('-c, --conflict-mode <mode>', `Defines how conflicts are resolved when mode is "${SYNC_MODE.BOTH}"`)
        .choices(Object.values(CONFLICT_MODE))
        .default(CONFLICT_MODE.RECENT)
    )
    .action(async (options: PathAddCommandOptions) => {
      try {
        const manager = new PathsManager(options.server)
        const syncPath = await manager.add(options)
        console.log(manager.server.printName())
        console.log(syncPath.repr())
        console.log('The path has been added')
      } catch (error) {
        console.error(error)
      }
    })

  paths
    .command('remove')
    .alias('rm')
    .description('Remove a synced path')
    .requiredOption('-s, --server <server>', 'Given id or name to identify the server', parseNameOrId)
    .requiredOption('-p, --path <path>', 'Given id or name to identify the synced path', parseNameOrId)
    .action(async (options: PathTargetCommandOptions) => {
      try {
        const manager = new PathsManager(options.server)
        const syncPath = await manager.remove(options.path)
        console.log(manager.server.printName())
        console.log(syncPath.repr())
        console.log('The path has been removed')
      } catch (error) {
        console.error(error)
      }
    })

  paths
    .command('set')
    .alias('vi')
    .description('Set options to a synced path')
    .requiredOption('-s, --server <server>', 'Given id or name to identify the server', parseNameOrId)
    .requiredOption('-p, --path <path>', 'Given id or name to identify the synced path', parseNameOrId)
    .option('-n, --name <name>', 'Defines the sync name')
    .addOption(new Option('-m, --mode <mode>', 'Defines the sync mode').choices(Object.values(SYNC_MODE)))
    .addOption(new Option('--ignore-delete <boolean>', 'Enable or disable deletion synchronization').argParser(parseBoolean))
    .addOption(new Option('-d, --diff-mode <mode>', 'Defines how differences are analyzed').choices(Object.values(DIFF_MODE)))
    .addOption(
      new Option('-c, --conflict-mode <mode>', `Defines how conflicts are resolved when mode is "${SYNC_MODE.BOTH}"`).choices(
        Object.values(CONFLICT_MODE)
      )
    )
    .action(async (options: PathSetCommandOptions) => {
      try {
        const manager = new PathsManager(options.server)
        const syncPath = await manager.set(options)
        console.log(manager.server.printName())
        console.log(syncPath.repr())
        console.log('The path has been modified')
      } catch (error) {
        console.error(error)
      }
    })

  paths
    .command('update')
    .alias('up')
    .description('Update all synced path settings from server')
    .requiredOption('-s, --server <server>', 'Given id or name to identify the server', parseNameOrId)
    .action(async (options: ServerTargetCommandOptions) => {
      try {
        const manager = new PathsManager(options.server)
        await manager.update()
        console.log('The paths have been updated')
      } catch (error) {
        console.error(error)
      }
    })

  paths
    .command('flush')
    .alias('reset')
    .description('Flush snapshots from a synced path')
    .requiredOption('-s, --server <server>', 'Given id or name to identify the server', parseNameOrId)
    .requiredOption('-p, --path <path>', 'Given id or name to identify the synced path', parseNameOrId)
    .action(async (options: PathTargetCommandOptions) => {
      try {
        const manager = new PathsManager(options.server)
        const syncPath = await manager.flush(options.path)
        console.log(manager.server.printName())
        console.log(syncPath.repr())
        console.log('The snapshots have been flushed')
      } catch (error) {
        console.error(error)
      }
    })

  paths.action(() => paths.outputHelp())
}
