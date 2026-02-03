import path from 'node:path'
import { FilesParser } from './parser'
import { getLogger } from './loggers'
import { SyncPath } from '../models/syncpath'
import { F_STAT, INVERSE_SIDE, SIDE } from '../constants/handlers'
import { regExpPathPattern } from '../utils/functions'
import { CORE, coreEvents } from './events'
import { Logger } from 'winston'
import { NormalizedMap } from '../utils/normalizedMap'
import { ALL_MODES, BOTH_MODE, CONFLICT_MODE, DOWNLOAD_MODE, SIDE_STATE, UPLOAD_MODE } from '../constants/diff'
import { SyncFileStats, SyncSnapShot } from '../interfaces/sync-diff.interface'

export class DiffParser {
  public syncPath: SyncPath
  public fParser: FilesParser
  public readonly secureDiff: boolean
  private readonly isSyncBothMode: boolean
  private logger: Logger

  constructor(syncPath: SyncPath, fParser: FilesParser) {
    this.syncPath = syncPath
    this.isSyncBothMode = this.syncPath.isBothMode
    this.secureDiff = this.syncPath.secureDiff
    this.fParser = fParser
    this.logger = getLogger('Diff', { server: this.fParser.req.server.identity(), path: this.syncPath.identity() })
  }

  async *run(): AsyncGenerator<any[]> {
    try {
      yield* this.sort()
    } catch (e) {
      this.logger.error(e.stack)
    }
    this.logger.debug('Parsing diff done')
  }

  private async *sort() {
    const firstActions: {
      [SIDE_STATE.DOWNLOAD]: string[]
      [SIDE_STATE.DOWNLOAD_DIFF]: string[]
      [SIDE_STATE.LOCAL_COPY]: { src: string; dst: string; mtime: number }[]
      [SIDE_STATE.LOCAL_MK]: { path: string; isDir: boolean; mtime: number }[]
      [SIDE_STATE.LOCAL_MOVE]: { src: string; dst: string }[]
      [SIDE_STATE.REMOTE_COPY]: { src: string; dst: string; mtime: number }[]
      [SIDE_STATE.REMOTE_MK]: { path: string; isDir: boolean; mtime: number }[]
      [SIDE_STATE.REMOTE_MOVE]: { src: string; dst: string }[]
      [SIDE_STATE.UPLOAD]: string[]
      [SIDE_STATE.UPLOAD_DIFF]: string[]
    } = {
      [SIDE_STATE.REMOTE_MOVE]: [],
      [SIDE_STATE.LOCAL_MOVE]: [],
      [SIDE_STATE.REMOTE_MK]: [],
      [SIDE_STATE.LOCAL_MK]: [],
      [SIDE_STATE.UPLOAD]: [],
      [SIDE_STATE.DOWNLOAD]: [],
      [SIDE_STATE.UPLOAD_DIFF]: [],
      [SIDE_STATE.DOWNLOAD_DIFF]: [],
      [SIDE_STATE.REMOTE_COPY]: [],
      [SIDE_STATE.LOCAL_COPY]: []
    }
    const lastActions: {
      [SIDE_STATE.LOCAL_PROPS]: { path: string; mtime: number }[]
      [SIDE_STATE.LOCAL_RM]: string[]
      [SIDE_STATE.REMOTE_PROPS]: { path: string; mtime: number }[]
      [SIDE_STATE.REMOTE_RM]: string[]
    } = { [SIDE_STATE.REMOTE_RM]: [], [SIDE_STATE.LOCAL_RM]: [], [SIDE_STATE.REMOTE_PROPS]: [], [SIDE_STATE.LOCAL_PROPS]: [] }
    await this.reduce(firstActions, lastActions)
    /* Start to return the first ordered actions */
    for (const [state, filePaths] of Object.entries(firstActions).filter(([, filePaths]) => filePaths.length)) {
      coreEvents.emit(CORE.TASKS_COUNT, { serverId: this.fParser.req.server.id, syncPathId: this.syncPath.id }, filePaths.length)
      yield [state, filePaths]
    }
    /* Start to return the last ordered actions */
    for (const [state, filePaths] of Object.entries(lastActions).filter(([, filePaths]) => filePaths.length)) {
      if (!state.endsWith('Properties')) {
        // ignore properties in tasks count
        coreEvents.emit(CORE.TASKS_COUNT, { serverId: this.fParser.req.server.id, syncPathId: this.syncPath.id }, filePaths.length)
      }
      // remove properties update on the parent directory because it's already done after a remove
      for (const side of [SIDE.LOCAL, SIDE.REMOTE]) {
        if (state === `${side}Remove` && lastActions[`${side}Properties`].length) {
          for (const f of filePaths
            .map((f) => lastActions[`${side}Properties`].find((p) => p.path === path.dirname(f)))
            .filter((index) => index !== undefined)) {
            lastActions[`${side}Properties`].splice(lastActions[`${side}Properties`].indexOf(f), 1)
          }
        }
      }
      yield [state, filePaths]
    }
  }

  private async *differential(): AsyncGenerator<[string, string]> {
    let states: AsyncGenerator<[keyof typeof BOTH_MODE | keyof typeof DOWNLOAD_MODE, string]>
    let stateMod: typeof BOTH_MODE | typeof DOWNLOAD_MODE | typeof UPLOAD_MODE
    if (this.isSyncBothMode) {
      stateMod = BOTH_MODE
      states = this.bidirectional(this.fParser.curSnap.local, this.fParser.curSnap.remote)
    } else {
      stateMod = this.syncPath.isUploadMode ? UPLOAD_MODE : DOWNLOAD_MODE
      states = this.unidirectional(this.fParser.curSnap.local, this.fParser.curSnap.remote)
    }
    for await (const [state, filePath] of states) {
      yield [stateMod[state], filePath]
    }
  }

  private async reduce(firstActions, lastActions): Promise<void> {
    // used to reduce actions
    const localDirsRemoved: RegExp[] = []
    const remoteDirsRemoved: RegExp[] = []
    const localDirsMoved: [RegExp, RegExp][] = []
    const remoteDirsMoved: [RegExp, RegExp][] = []
    const ignoreRemoved: { local: string[]; remote: string[] } = { local: [], remote: [] }
    for await (const [state, filePath] of this.differential()) {
      if (state === SIDE_STATE.LOCAL_RM || state === SIDE_STATE.REMOTE_RM) {
        const settings: [SIDE, RegExp[]] = state === SIDE_STATE.LOCAL_RM ? [SIDE.LOCAL, localDirsRemoved] : [SIDE.REMOTE, remoteDirsRemoved]
        this.reduceRemoved(state, filePath, ignoreRemoved, lastActions, settings)
        continue
      } else if (!this.syncPath.firstSync && (state === SIDE_STATE.DOWNLOAD || state === SIDE_STATE.UPLOAD)) {
        const settings: [SIDE, [RegExp, RegExp][], SyncSnapShot, SyncSnapShot, SyncSnapShot, SyncSnapShot] =
          state === SIDE_STATE.DOWNLOAD
            ? [
                SIDE.LOCAL,
                localDirsMoved,
                this.fParser.curSnap.remote,
                this.fParser.oldSnap.remote,
                this.fParser.curSnap.local,
                this.fParser.oldSnap.local
              ]
            : [
                SIDE.REMOTE,
                remoteDirsMoved,
                this.fParser.curSnap.local,
                this.fParser.oldSnap.local,
                this.fParser.curSnap.remote,
                this.fParser.oldSnap.remote
              ]
        if (this.reduceMoved(filePath, ignoreRemoved, firstActions, lastActions, settings)) {
          continue
        }
      } else if (state === SIDE_STATE.LOCAL_PROPS || state === SIDE_STATE.REMOTE_PROPS) {
        const snap = state === SIDE_STATE.LOCAL_PROPS ? this.fParser.curSnap.remote : this.fParser.curSnap.local
        lastActions[state].push({ path: filePath, mtime: snap.get(filePath)[F_STAT.MTIME] })
        continue
      }
      if (state === SIDE_STATE.DOWNLOAD || state === SIDE_STATE.UPLOAD || state === SIDE_STATE.DOWNLOAD_DIFF || state === SIDE_STATE.UPLOAD_DIFF) {
        const [side, snap, refSnap] = state.startsWith(SIDE_STATE.DOWNLOAD)
          ? [SIDE.LOCAL, this.fParser.curSnap.local, this.fParser.curSnap.remote]
          : [SIDE.REMOTE, this.fParser.curSnap.remote, this.fParser.curSnap.local]
        if (this.syncPath.secureDiff && this.findCopies(filePath, firstActions, [side, snap, refSnap])) {
          continue
        }
        if (this.findMK(filePath, firstActions, [side, refSnap])) {
          continue
        }
      }
      // store action if not matching the above rules
      firstActions[state].push(filePath)
    }
    this.findRemovedAndDiffFromMoved(firstActions, lastActions, ignoreRemoved)
    this.fixMoveCoherence(firstActions)
  }

  private async *unidirectional(
    source: NormalizedMap<string, any[]>,
    destination: NormalizedMap<string, any[]>
  ): AsyncGenerator<[keyof typeof DOWNLOAD_MODE | keyof typeof BOTH_MODE, string]> {
    // we have to order the deleted items, in DownloadMode deleted items become added items
    function* removed(): Generator<[keyof typeof DOWNLOAD_MODE, string]> {
      for (const dstPath of destination.keys()) {
        if (!source.has(dstPath)) {
          yield ['removed', dstPath]
        }
      }
    }

    if (!this.syncPath.isDownloadMode) {
      yield* removed()
    }
    for (const [srcPath, srcStats] of source) {
      const dstStats = destination.get(srcPath)
      if (dstStats === undefined) {
        yield ['added', srcPath]
      } else {
        // get the right dstPath (normalized as the local or remote source)
        const dstPath = destination.getResolvedKey(srcPath)
        yield* this.hasChanged(srcPath, dstPath, srcStats, dstStats)
      }
    }
    if (this.syncPath.isDownloadMode) {
      yield* removed()
    }
  }

  private async *bidirectional(
    source: NormalizedMap<string, any[]>,
    destination: NormalizedMap<string, any[]>
  ): AsyncGenerator<[keyof typeof BOTH_MODE | keyof typeof DOWNLOAD_MODE, string]> {
    /*
    added: only exists on local side
    changed: difference between local / remote
    removed: only exists on remote side
    */
    // it is necessary to delay these actions to detect moves (with removed files)
    const delayActions = { localAdded: [], remoteAdded: [] }
    for await (const [state, filePath] of this.unidirectional(source, destination)) {
      if (state === 'added') {
        // no snapshots found, we use no destructive actions
        if (this.syncPath.firstSync) {
          delayActions.localAdded.push(filePath)
        } else if (this.fParser.oldSnap.local.has(filePath)) {
          // the file was removed from the remote side because found on the last snapshot
          yield ['remoteRemoved', filePath]
        } else {
          // the file doesn't exist on last snapshot, it's a new file
          delayActions.localAdded.push(filePath)
        }
      } else if (state === 'removed') {
        // no snapshots found, we use no destructive actions
        if (this.syncPath.firstSync) {
          delayActions.remoteAdded.push(filePath)
        } else if (this.fParser.oldSnap.remote.has(filePath)) {
          // the file was removed from the local side because found on the last snapshot
          yield ['localRemoved', filePath]
        } else {
          // the file doesn't exist on last snapshot, it's a new file
          delayActions.remoteAdded.push(filePath)
        }
      } else {
        yield [state, filePath]
      }
    }
    for (const [state, filePaths] of Object.entries(delayActions).filter(([, filePaths]) => filePaths.length)) {
      for (const filePath of filePaths) {
        yield [state as keyof typeof BOTH_MODE, filePath]
      }
    }
  }

  private *hasChanged(
    srcPath: string,
    dstPath: string,
    srcStats: any[],
    dstStats: any[]
  ): Generator<[keyof typeof DOWNLOAD_MODE | keyof typeof BOTH_MODE, string]> {
    if ((this.secureDiff && srcStats[F_STAT.CHECKSUM] !== dstStats[F_STAT.CHECKSUM]) || srcStats[F_STAT.SIZE] !== dstStats[F_STAT.SIZE]) {
      // if the file has been replaced by a folder or vice versa, it will be detected because the directories size is 0
      if (this.isSyncBothMode) {
        yield this.conflictResolver('Changed', srcPath, dstPath, srcStats, dstStats)
      } else {
        yield ['changed', this.syncPath.isUploadMode ? dstPath : srcPath]
      }
    } else if (srcStats[F_STAT.MTIME] !== dstStats[F_STAT.MTIME]) {
      if (this.isSyncBothMode) {
        yield this.conflictResolver('Properties', srcPath, dstPath, srcStats, dstStats)
      } else {
        yield ['properties', this.syncPath.isUploadMode ? dstPath : srcPath]
      }
    }
  }

  private conflictResolver(suffix: string, srcPath: string, dstPath: string, srcStats: any[], dstStats: any[]): [keyof typeof BOTH_MODE, string] {
    if (this.syncPath.conflictMode === CONFLICT_MODE.RECENT) {
      if (srcStats[F_STAT.MTIME] === dstStats[F_STAT.MTIME]) {
        const srcIsNewer = srcStats[F_STAT.SIZE] >= dstStats[F_STAT.SIZE]
        return [`${srcIsNewer ? SIDE.LOCAL : SIDE.REMOTE}${suffix}` as keyof typeof BOTH_MODE, srcIsNewer ? dstPath : srcPath]
      } else {
        const srcIsNewer = srcStats[F_STAT.MTIME] >= dstStats[F_STAT.MTIME]
        return [`${srcIsNewer ? SIDE.LOCAL : SIDE.REMOTE}${suffix}` as keyof typeof BOTH_MODE, srcIsNewer ? dstPath : srcPath]
      }
    } else {
      // local or remote mode
      return [
        `${this.syncPath.conflictMode}${suffix}` as keyof typeof BOTH_MODE,
        this.syncPath.conflictMode === CONFLICT_MODE.LOCAL ? dstPath : srcPath
      ]
    }
  }

  private reduceRemoved(
    state: SIDE_STATE.LOCAL_RM | SIDE_STATE.REMOTE_RM,
    filePath: string,
    ignoreRemoved: any,
    lastActions: any,
    settings: [SIDE, RegExp[]]
  ) {
    // remove children files when a dir is removed
    const [side, dirsRemoved] = settings
    if (dirsRemoved.length && dirsRemoved.find((rx) => rx.test(filePath))) {
      // these files and directories matches with one dir which has been removed
      ignoreRemoved[side].push(filePath)
      this.logger.debug(`reduceRemoved: Ignore ${state} child: ${filePath}`)
      return
    } else if (this.fParser.curSnap[side].get(filePath)[F_STAT.IS_DIR]) {
      // if current directory not matching and current file is a directory, we generate a directory pattern to match the next files
      dirsRemoved.unshift(regExpPathPattern(filePath))
    }
    lastActions[state].push(filePath)
  }

  private reduceMoved(
    filePath: string,
    ignoreRemoved: {
      local: string[]
      remote: string[]
    },
    firstActions: any,
    lastActions: any,
    settings: [SIDE, [RegExp, RegExp][], SyncSnapShot, SyncSnapShot, SyncSnapShot, SyncSnapShot]
  ): boolean {
    // remove children files when a dir is moved
    const [side, dirsMoved, snap, oldSnap, invSnap, invOldSnap] = settings
    // try to find the matches in the removed items with inodes and checksums
    const matches = []
    for (const f of [...lastActions[`${side}Remove`], ...ignoreRemoved[side]]) {
      let curSnap: SyncSnapShot
      let curOldSnap: SyncSnapShot
      if (oldSnap.has(f)) {
        // works in bidirectional mode and partially with unidirectional sync (only for movement actions that follow the direction of synchronization)
        // e.g: we rename/move a remote file for a sync in download mode, this is working
        // e.g: we rename/move a local file for a sync in download mode, in this case we don't found the file in the last snapshot
        curSnap = snap
        curOldSnap = oldSnap
      } else if (!this.syncPath.isBothMode && invOldSnap.has(filePath) && invSnap.has(f)) {
        // fix the unidirectional behaviour described above
        curSnap = invOldSnap
        curOldSnap = invSnap
      } else {
        continue
      }
      if (
        (curSnap.get(filePath)[F_STAT.INO] === curOldSnap.get(f)[F_STAT.INO] &&
          curSnap.get(filePath)[F_STAT.SIZE] === curOldSnap.get(f)[F_STAT.SIZE]) ||
        (this.syncPath.secureDiff &&
          !curSnap.get(filePath)[F_STAT.IS_DIR] &&
          curSnap.get(filePath)[F_STAT.CHECKSUM] === curOldSnap.get(f)[F_STAT.CHECKSUM])
      ) {
        matches.push(f)
      }
    }
    if (matches.length) {
      let srcPath: string
      let alreadyChecked = false
      let alreadyMatched = false
      if (matches.length > 1 && dirsMoved.length) {
        // multiple matches, find the one that matches the source and the destination
        srcPath = matches.find((src) =>
          dirsMoved.find((r) => r[0].test(src) && r[1].test(filePath) && src.replace(r[0], '') === filePath.replace(r[1], ''))
        )
        alreadyChecked = true
        alreadyMatched = !!srcPath
      }
      if (srcPath === undefined) {
        srcPath = matches[0]
      }
      // delete remove action, replace it with a move
      lastActions[`${side}Remove`] = lastActions[`${side}Remove`].filter((f) => f != srcPath)
      // avoid reusing file in another move
      ignoreRemoved[side] = ignoreRemoved[side].filter((f) => f != srcPath)
      if (
        alreadyMatched ||
        (!alreadyChecked &&
          dirsMoved.find((r) => r[0].test(srcPath) && r[1].test(filePath) && srcPath.replace(r[0], '') === filePath.replace(r[1], '')))
      ) {
        // these files and directories matches with previous dir which has been removed
        this.logger.debug(`reduceMoved: Ignore ${side}Move child: ${filePath}`)
        return true
      } else if (dirsMoved.find((r) => r[0].test(srcPath))) {
        // if source path will be the same but destination differs we have to push the move action on top
        firstActions[`${side}Move`].unshift({ src: srcPath, dst: filePath })
      } else {
        firstActions[`${side}Move`].push({ src: srcPath, dst: filePath })
      }
      if (snap.get(filePath)[F_STAT.IS_DIR]) {
        // if element is a directory, we generate the regexp patterns to match the next files
        dirsMoved.unshift([regExpPathPattern(srcPath), regExpPathPattern(filePath)])
      }
      return true
    }
    return false
  }

  private findCopies(filePath: string, firstActions: any, settings: [SIDE, SyncSnapShot, SyncSnapShot]): boolean {
    // try to find copies if secureDiff is enabled
    const [side, snap, refSnap] = settings
    const fileStats: SyncFileStats = refSnap.get(filePath)
    if (!fileStats[F_STAT.IS_DIR] && fileStats[F_STAT.SIZE] !== 0) {
      for (const [fPath, fStats] of snap) {
        if (fPath != filePath && fStats[F_STAT.CHECKSUM] === fileStats[F_STAT.CHECKSUM]) {
          firstActions[`${side}Copy`].push({ src: fPath, dst: filePath, mtime: fileStats[F_STAT.MTIME] })
          return true
        }
      }
    }
    return false
  }

  private findMK(filePath: string, firstActions: any, settings: [SIDE, SyncSnapShot]): boolean {
    // check if path are dir or an empty file
    const [side, snap] = settings
    const fileStats = snap.get(filePath)
    if (fileStats[F_STAT.IS_DIR]) {
      firstActions[`${side}Mk`].unshift({ path: filePath, isDir: true, mtime: fileStats[F_STAT.MTIME] })
      return true
    } else if (fileStats[F_STAT.SIZE] === 0) {
      firstActions[`${side}Mk`].push({ path: filePath, isDir: false, mtime: fileStats[F_STAT.MTIME] })
      return true
    }
    return false
  }

  private findRemovedAndDiffFromMoved(firstActions: any, lastActions: any, ignoreRemoved: { local: string[]; remote: string[] }) {
    // sometimes a file has been added/deleted/modified and considered as a moved child (because we reduce the removes)
    // if its directory was moved, we have to restore the action
    for (const side of [SIDE.LOCAL, SIDE.REMOTE]) {
      for (const srcPath of ignoreRemoved[side]) {
        for (const [src, dst] of firstActions[`${side}Move`].map((m) => [m.src, m.dst])) {
          if (path.dirname(srcPath) === src) {
            const dstPath = srcPath.replace(regExpPathPattern(src), `${dst}/`)
            if (this.fParser.curSnap[INVERSE_SIDE[side]].has(dstPath)) {
              // check if file is really missing from the source side, if not continue
              const checkAction = side === SIDE.REMOTE ? SIDE_STATE.UPLOAD : SIDE_STATE.DOWNLOAD
              if (this.fParser.curSnap[side].has(srcPath) && firstActions[checkAction].indexOf(dstPath) > -1) {
                // the file could be parsed as a new file because it has been moved, if it has been modified it should be tagged as a diff
                const srcStats = this.fParser.curSnap[side].get(srcPath)
                const dstStats = this.fParser.curSnap[INVERSE_SIDE[side]].get(dstPath)
                if ((this.secureDiff && srcStats[F_STAT.CHECKSUM] !== dstStats[F_STAT.CHECKSUM]) || srcStats[F_STAT.SIZE] !== dstStats[F_STAT.SIZE]) {
                  firstActions[`${checkAction}Diff`].push(...firstActions[checkAction].splice(firstActions[checkAction].indexOf(dstPath), 1))
                  this.logger.debug(`Found ${checkAction}Diff from ${side}Move: ${srcPath} -> ${dstPath}`)
                }
              }
              continue
            }
            ignoreRemoved[side] = ignoreRemoved[side].filter((i: string) => i !== srcPath)
            lastActions[`${side}Remove`].push(dstPath)
            // store dst to avoid error later during sync
            this.fParser.curSnap[side].set(dstPath, this.fParser.curSnap[side].get(srcPath))
            this.logger.debug(`Found ${side}IgnoreRemoved from ${side}Move: ${srcPath} -> ${dstPath}`)
            break
          }
        }
      }
    }
  }

  private fixMoveCoherence(firstActions: any) {
    for (const side of [SIDE.LOCAL, SIDE.REMOTE]) {
      for (const file of [...firstActions[`${side}Move`]]) {
        /* fixes this potential conflict for which actions are not correctly ordered
           == example 1 ==
           ** file **
           moved file: { src: 'a/kill', dst: 'b/bill' } ==> 'b/bill' should be 'a/bill'
           ** others **
           other moved file: { src: 'a', dst: 'b' }

           == example 2 ==
           ** file ** { src: 'a', dst: 'b' }
           moved file:
           ** others **
           other moved file: { src: 'a/kill/pid/1', dst: 'b/1' } ==> 'a/kill/pid/1' should be 'b/kill/pid/1'
        */
        for (const other of [...firstActions[`${side}Move`]]) {
          if (file.src === other.src && file.dst === other.dst) {
            // skip if it's the same file
            continue
          }
          if (regExpPathPattern(file.src).test(other.src) && regExpPathPattern(file.dst).test(other.dst)) {
            if (firstActions[`${side}Move`].indexOf(file) > firstActions[`${side}Move`].indexOf(other)) {
              // if the parent will be moved after the child (example 1)
              const dst = other.dst.replace(file.dst, file.src)
              this.logger.debug(`fixMoveCoherence (1) - ${side}Move destination: ${other.dst} -> ${dst}`)
              other.dst = dst
            } else {
              // if the parent will be moved before the child (example 2)
              const src = other.src.replace(file.src, file.dst)
              this.logger.debug(`fixMoveCoherence (2) - ${side}Move source: ${other.src} -> ${src}`)
              // store src to avoid error later during sync
              this.fParser.curSnap[side].set(src, this.fParser.curSnap[side].get(other.src))
              other.src = src
            }
          }
        }
        /* fixes this potential conflict for which the remote directory  has changed to 'b/bill'
           ** file **
           local move file: { src: 'a/kill', dst: 'b/bill' }
           ** others **
           remote add/diff file: 'a/kill/me' should be 'b/bill/me'
           remote move/copy file: {src: 'c/kill', dst: 'a/kill/toto'} where dst should be 'b/bill/toto'
        */
        if (this.isSyncBothMode && this.fParser.curSnap[side].get(file.src)[F_STAT.IS_DIR]) {
          const matchFile = regExpPathPattern(file.src)
          for (const action of ALL_MODES[INVERSE_SIDE[side]].filter((action: SIDE_STATE) => firstActions[action] && firstActions[action].length)) {
            for (const other of [...firstActions[action]]) {
              if (matchFile.test(other.dst || other.path || other)) {
                if (action.endsWith('Move') || action.endsWith('Copy')) {
                  const dst = other.dst.replace(file.src, file.dst)
                  this.logger.debug(
                    `fixMoveCoherence (3) - ${action} destination: (${other.src} -> ${other.dst}) due to ${side}Move: (${file.src} -> ${file.dst}) to (${other.dst} -> ${dst})`
                  )
                  other.dst = dst
                } else {
                  const src = other.path || other
                  const dst = src.replace(file.src, file.dst)
                  this.logger.debug(`fixMoveCoherence (4) - ${action}: ${src} -> ${dst}`)
                  // store dst to avoid error later during sync
                  this.fParser.curSnap[side].set(dst, this.fParser.curSnap[side].get(src))
                  if (other.path) {
                    // other = object form
                    other.path = dst
                  } else {
                    // other = string form
                    firstActions[action] = [...firstActions[action].filter((o) => o !== src), dst]
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
