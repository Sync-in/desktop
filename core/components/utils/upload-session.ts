import { F_STAT } from '../constants/handlers'
import { SYNC_UPLOAD_SESSION_ID_PATTERN, SYNC_UPLOAD_SESSION_MIN_CHUNK_SIZE } from '../constants/requests'
import type { SyncTransfersCapability } from '../interfaces/sync-client-auth.interface'
import type { SyncFileStats } from '../interfaces/sync-diff.interface'
import type { SyncUploadSessionRecord } from '../interfaces/sync-upload-session.interface'

export function isUploadSessionId(value: unknown): value is string {
  return typeof value === 'string' && SYNC_UPLOAD_SESSION_ID_PATTERN.test(value)
}

export function isUploadSessionRecord(value: unknown): value is SyncUploadSessionRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const session = value as Partial<SyncUploadSessionRecord>
  return (
    (session.checksum === null || typeof session.checksum === 'string') &&
    typeof session.chunkSize === 'number' &&
    Number.isSafeInteger(session.chunkSize) &&
    session.chunkSize > 0 &&
    typeof session.ino === 'number' &&
    Number.isSafeInteger(session.ino) &&
    session.ino >= 0 &&
    (session.method === 'post' || session.method === 'put') &&
    typeof session.mtime === 'number' &&
    Number.isSafeInteger(session.mtime) &&
    typeof session.size === 'number' &&
    Number.isSafeInteger(session.size) &&
    session.size >= 0 &&
    isUploadSessionId(session.uploadId)
  )
}

export function uploadSessionMatchesFileStats(session: SyncUploadSessionRecord, stats: SyncFileStats, matchInode = false): boolean {
  return (
    (!matchInode || session.ino === stats[F_STAT.INO]) &&
    session.size === stats[F_STAT.SIZE] &&
    session.mtime === stats[F_STAT.MTIME] &&
    session.checksum === stats[F_STAT.CHECKSUM]
  )
}

export function parseTransfersCapability(value: unknown): SyncTransfersCapability | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const capability = value as Partial<SyncTransfersCapability>
  // Presence advertises upload sessions; only the operational chunk-size contract still needs validation.
  if (capability.maxChunkSize === null) return { maxChunkSize: null }
  if (
    typeof capability.maxChunkSize !== 'number' ||
    !Number.isSafeInteger(capability.maxChunkSize) ||
    capability.maxChunkSize < SYNC_UPLOAD_SESSION_MIN_CHUNK_SIZE
  ) {
    return undefined
  }
  return { maxChunkSize: capability.maxChunkSize }
}
