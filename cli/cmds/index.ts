/*
 * Copyright (C) 2012-2025 Johan Legrand <johan.legrand@sync-in.com>
 * This file is part of Sync-in | The open source file sync and share solution
 * See the LICENSE file for licensing details
 */

import { getRunCMD } from './cmd-run'
import { getServerCMD } from './cmd-servers'
import { getPathsCMD } from './cmd-paths'

export function getCMDS(yargs): any[] {
  return [getRunCMD(), getServerCMD(yargs), getPathsCMD(yargs)]
}
