export type SyncUploadSessionMethod = 'post' | 'put'
export type SyncUploadSessionState = 'complete' | 'ready' | 'uploading'

export interface SyncUploadSessionRecord {
  checksum: string | null
  chunkSize: number
  ino: number
  method: SyncUploadSessionMethod
  mtime: number
  size: number
  uploadId: string
}

export interface SyncUploadSessionStatus {
  ino?: number
  offset: number
  size: number
  state: SyncUploadSessionState
  validatedOffset: number
}

export interface SyncFileChunkChecksums {
  checksum: string
  chunks: string[]
}

export interface SyncUploadChunkChecksumCache extends SyncFileChunkChecksums {
  chunkSize: number
  ino: number
  mtime: number
  size: number
}
