import type { Command } from 'commander'
import { registerRunCommand } from './cmd-run'
import { registerServerCommands } from './cmd-servers'
import { registerPathCommands } from './cmd-paths'

export function registerCommands(program: Command): void {
  registerRunCommand(program)
  registerServerCommands(program)
  registerPathCommands(program)
}
