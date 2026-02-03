import { createLogger, format, transports } from 'winston'
import { HAS_TTY, IS_DEV_ENV, IS_PROD_ENV, MAIN_LOGS_FILE, SYNC_LOGS_PATH } from '../../constants'
import path from 'node:path'
import { SYMBOLS } from '../constants/handlers'
import type { SyncTransferContext } from '../interfaces/sync-transfer.interface'

export const LOG_MODULE_SYNC = 'Transfer'
export const LOG_MODULE_REPORT = 'Report'
export const LOG_LEVEL_SYNC = 'sync'
export const LOG_LEVEL_REPORT = 'report'

const levels = {
  levels: {
    error: 0,
    warn: 1,
    sync: 2,
    info: 3,
    report: 4,
    debug: 5,
    silly: 6
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    sync: 'blue',
    report: 'green',
    info: 'cyan',
    debug: 'magenta',
    silly: 'gray'
  }
}

const dateFormat = { format: 'YYYY-MM-DD HH:mm:ss' }

const checkTransfer = format((info: any) => {
  if (info.message.tasks) {
    const i = info.message
    info.message =
      `[${i.tasks.done}/${i.tasks.count}]${SYMBOLS[i.tr.side]} ${i.tr.action} - ` +
      `${i.tr.file}${i.tr.fileDst ? ` -> ${i.tr.fileDst}` : ''}` +
      `${i.tr.error ? `: ${i.tr.error}` : ''}`
  }
  return info
})

function formatInfo(info: any) {
  return `${info.timestamp} [${info.level}] [${info.module}] ${info.sync ? `[${info.sync.server.name}:${info.sync.path.name}]` : ''} ${info.message}`
}

const consoleFormat = format.combine(
  checkTransfer(),
  format.timestamp(dateFormat),
  format.colorize({ all: true, colors: levels.colors }),
  format.splat(),
  format.align(),
  format.printf((info) => formatInfo(info))
)

const cmdFileFormat = format.combine(
  checkTransfer(),
  format.timestamp(dateFormat),
  format.splat(),
  format.printf((info) => formatInfo(info))
)

const transfersFileFormat = format.combine(
  format.timestamp(dateFormat),
  format.splat(),
  format.printf((info: any) => JSON.stringify({ timestamp: info.timestamp, ...info.message.tr }))
)

const handlers: any = {
  console: HAS_TTY ? new transports.Console({ level: 'report', format: consoleFormat }) : null,
  file: IS_PROD_ENV
    ? new transports.File({ level: 'info', filename: MAIN_LOGS_FILE, maxsize: 10485760, tailable: true, maxFiles: 1, format: cmdFileFormat })
    : null
}

const logger = createLogger({ levels: levels.levels, transports: Object.values(handlers).filter((h) => h !== null) as any })

function getSyncLogger(sync: SyncTransferContext) {
  return createLogger({
    defaultMeta: { module: LOG_MODULE_SYNC, sync: sync },
    levels: levels.levels,
    transports: [
      HAS_TTY ? new transports.Console({ level: 'info', format: consoleFormat }) : null,
      new transports.File({
        level: LOG_LEVEL_SYNC,
        filename: `${path.join(SYNC_LOGS_PATH, `${sync.server.id}_${sync.path.id}.log`)}`,
        maxsize: 10485760,
        tailable: true,
        maxFiles: 1,
        format: transfersFileFormat
      })
    ].filter((t) => t !== null)
  })
}

export function getLogger(module: string, sync: SyncTransferContext = null, storeTransfersLogs = false) {
  if (storeTransfersLogs) {
    return getSyncLogger(sync)
  }
  return logger.child({ module, sync })
}

export function setLevelLogger(level) {
  for (const handler of Object.values(handlers).filter((h) => h !== null) as any) {
    handler.level = level
  }
}

if (IS_DEV_ENV) {
  setLevelLogger('debug')
}
