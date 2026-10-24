import type { Command } from 'commander'
import { setLevelLogger } from '../../core/components/handlers/loggers'
import { RunManager } from '../../core/main'
import { parseNameOrId } from '../components/argument-parsers'
import type { RunCommandOptions } from '../interfaces/cli-options.interface'

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Synchronize (help for options)')
    .option('-r, --report', 'Only report (dry run)', false)
    .option('-d, --debug', 'Enable debug mode', false)
    .option('-a, --async', 'Run syncs in parallel', false)
    .option('-s, --server <server>', 'Given id or name to sync the target server', parseNameOrId)
    .option('-p, --path <paths...>', 'Given id or name to sync the target path, "server" must be specified')
    .action(async (options: RunCommandOptions) => {
      try {
        if (options.debug) {
          setLevelLogger('debug')
        }
        await new RunManager().run(
          { server: options.server, paths: options.path?.map((value) => parseNameOrId(value)) },
          options.report,
          options.async
        )
      } catch (error) {
        console.error(error)
      }
    })
}
