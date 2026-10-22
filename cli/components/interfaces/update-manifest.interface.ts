import type { FileHandle } from 'node:fs/promises'

export interface CliReleaseAsset {
  package: string
  size: number
  sha512: string
}

export interface CliRelease {
  version: string
  asset: CliReleaseAsset
}

export type CliUpdateStatus = 'updated' | 'up-to-date' | 'local-newer'

export interface CliUpdateResult {
  status: CliUpdateStatus
  currentVersion: string
  latestVersion: string
  binaryPath: string
}

export type CliUpdateDownloader = (url: URL, maximumBytes: number) => Promise<Buffer>

export type CliBinaryRename = (source: string, destination: string) => Promise<void>

export type CliBinaryWrite = (file: FileHandle, content: Buffer) => Promise<void>

export interface CliUpdateManagerOptions {
  currentVersion?: string
  binaryPath?: string
  download?: CliUpdateDownloader
}
