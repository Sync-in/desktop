import type { CONFLICT_MODE, DIFF_MODE, SYNC_MODE } from '../../core/components/constants/diff'

export type NameOrId = string | number

export interface GlobalCommandOptions {
  update: boolean
}

export interface RunCommandOptions {
  report: boolean
  debug: boolean
  async: boolean
  server?: NameOrId
  path?: string[]
}

export interface ServerAddCommandOptions {
  name: string
  url: string
  login: string
  password: string
  code?: string
  allowInvalidCertificate: boolean
}

export interface ServerAuthCommandOptions {
  server: NameOrId
  login: string
  password: string
  code?: string
}

export interface ServerTargetCommandOptions {
  server: NameOrId
}

export interface PathTargetCommandOptions extends ServerTargetCommandOptions {
  path: NameOrId
}

export interface PathAddCommandOptions extends ServerTargetCommandOptions {
  localPath: string
  remotePath: string
  name?: string
  mode: SYNC_MODE
  ignoreDelete: boolean
  diffMode: DIFF_MODE
  conflictMode: CONFLICT_MODE
}

export interface PathSetCommandOptions extends PathTargetCommandOptions {
  name?: string
  mode?: SYNC_MODE
  ignoreDelete?: boolean
  diffMode?: DIFF_MODE
  conflictMode?: CONFLICT_MODE
}
