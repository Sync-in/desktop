import { getRunCMD } from './cmd-run'
import { getServerCMD } from './cmd-servers'
import { getPathsCMD } from './cmd-paths'

export function getCMDS(yargs): any[] {
  return [getRunCMD(), getServerCMD(yargs), getPathsCMD(yargs)]
}
