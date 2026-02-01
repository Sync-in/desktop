import { findByNameOrID, isPathExistsBool, regexSlash } from '../utils/functions'
import { RequestsManager } from './requests'
import { getLogger } from './loggers'
import { Server } from '../models/server'
import { SyncPath } from '../models/syncpath'
import { IS_WINDOWS } from '../../constants'
import { ServersManager } from './servers'
import fs from 'node:fs/promises'
import { CORE, coreEvents } from './events'
import { API } from '../constants/requests'
import { SyncPathSettings } from '../interfaces/sync-path-settings.interface'
import { AxiosResponse } from 'axios'
import { DIFF_MODE, SYNC_MODE } from '../constants/diff'
import { SYNC_PATH_REPOSITORY } from '../constants/paths'

const logger = getLogger('Paths')

export class PathsManager {
  server: Server
  req: RequestsManager

  constructor(server: string | number, req?: RequestsManager) {
    this.server = ServersManager.find(server)
    this.req = req || new RequestsManager(this.server)
  }

  public async add(data: any): Promise<SyncPath> {
    const syncPath = new SyncPath(data, true)
    await this.checkPaths(syncPath)
    try {
      const r = await this.req.http.post<{ id: number; permissions: string }>(`${API.PATHS}/${syncPath.remotePath}`, syncPath.settings())
      if (!r.data?.id || !(typeof r.data?.permissions === 'string')) {
        throw new Error('Path id or permissions were not provided in server response')
      }
      syncPath.id = r.data.id
      syncPath.permissions = r.data.permissions
      if (!syncPath.isWriteable) {
        logger.warn('You are not allowed to write on this path, "download" mode is selected by default')
        syncPath.mode = SYNC_MODE.DOWNLOAD
      }
      this.server.addSync(syncPath)
      coreEvents.emit(CORE.SAVE_SETTINGS, true)
      return syncPath
    } catch (e) {
      throw new Error(await RequestsManager.handleHttpError(e, true))
    }
  }

  public async remove(pathNameOrID: string | number, doOnServer = true): Promise<SyncPath> {
    const syncPath: SyncPath = this.findSyncPath(pathNameOrID)
    if (doOnServer) {
      try {
        await this.req.http.delete(`${API.PATHS}/${syncPath.id}`)
      } catch (e) {
        throw new Error(await RequestsManager.handleHttpError(e, true))
      }
    }
    await syncPath.removeSnapShots(this.req.server.id)
    await syncPath.removeLogs(this.req.server.id)
    this.server.syncPaths = this.server.syncPaths.filter((p: SyncPath) => p.id !== syncPath.id)
    coreEvents.emit(CORE.SAVE_SETTINGS, true)
    logger.warn(`Path ${syncPath.name} (${syncPath.id}) was removed`)
    return syncPath
  }

  public async update(): Promise<boolean> {
    const syncPaths: Partial<SyncPathSettings>[] = this.server.syncPaths.map((syncPath: SyncPath) => ({ ...syncPath.settings(), id: syncPath.id }))
    let r: AxiosResponse<
      {
        add: SyncPath[]
        delete: number[]
        update: Partial<Record<keyof SyncPathSettings, any>>[]
      },
      unknown
    >
    try {
      r = await this.req.http.put(API.PATHS, syncPaths)
    } catch (e) {
      throw new Error(await RequestsManager.handleHttpError(e, true))
    }
    let hasChanges = false
    for (const path of r.data.update) {
      hasChanges = true
      try {
        await this.set(path, false)
      } catch (e) {
        logger.error(e)
      }
    }
    for (const id of r.data.delete) {
      hasChanges = true
      try {
        await this.remove(id, false)
      } catch (e) {
        logger.error(e)
      }
    }
    for (const path of r.data.add) {
      hasChanges = true
      let syncPath = findByNameOrID(path.id, this.server.syncPaths)
      if (syncPath) {
        syncPath.update(path)
        logger.warn(`Path ${syncPath.name} (${syncPath.id}) already exists, just update configuration`)
      } else {
        syncPath = new SyncPath(path, true)
        syncPath.id = path.id
        try {
          await this.checkPaths(syncPath)
          this.server.addSync(syncPath)
          logger.warn(`Path ${syncPath.name} (${syncPath.id}) was added`)
        } catch (e) {
          logger.warn(`Path ${syncPath.name} (${syncPath.id}) could not be added - ${e}`)
        }
      }
    }
    if (hasChanges) {
      coreEvents.emit(CORE.SAVE_SETTINGS, true)
    }
    return hasChanges
  }

  public async set(data: Partial<SyncPath> | any, doOnServer = true): Promise<SyncPath> {
    logger.info(`Update : ${JSON.stringify(data)}`)
    const syncPath: SyncPath = this.findSyncPath(data.id || data.path)
    if (data.name) {
      if (syncPath.name.toLowerCase() === data.name.toLowerCase()) {
        syncPath.name = data.name
      } else if (!findByNameOrID(data.name, this.server.syncPaths)) {
        syncPath.name = data.name
      }
    }
    for (const attr of syncPath.settingsList().filter((at) => at in data)) {
      if (attr === 'diffMode' && data[attr] === DIFF_MODE.SECURE && syncPath.diffMode === DIFF_MODE.FAST) {
        await syncPath.removeSnapShots(this.req.server.id)
      }
      syncPath[attr] = data[attr]
    }
    let hasBeenSaved = false
    if (doOnServer) {
      syncPath.updateTimestamp()
      hasBeenSaved = await this.update()
    }
    if (!hasBeenSaved) {
      coreEvents.emit(CORE.SAVE_SETTINGS, true)
    }
    return syncPath
  }

  public async flush(pathNameOrID: string | number): Promise<SyncPath> {
    const syncPath = this.findSyncPath(pathNameOrID)
    await syncPath.removeSnapShots(this.req.server.id)
    return syncPath
  }

  private findSyncPath(pathNameOrID: string | number): SyncPath {
    const syncPath: SyncPath = findByNameOrID(pathNameOrID, this.server.syncPaths)
    if (!syncPath) {
      throw `Path ${pathNameOrID} not found`
    }
    return syncPath
  }

  private isAlreadyExists(localPath: string, remotePath: string) {
    for (const syncPath of this.server.syncPaths) {
      if (syncPath.localPath === localPath) {
        throw 'Local path is already synced'
      } else if (syncPath.remotePath === remotePath) {
        throw 'Remote path is already synced'
      }
    }
  }

  private async checkPaths(syncPath: SyncPath) {
    if (IS_WINDOWS) {
      syncPath.localPath = syncPath.localPath.replace(regexSlash, '\\')
    }
    // Remove trailing slashes from localPath (Windows or POSIX)
    syncPath.localPath = syncPath.localPath.replace(/[\\/]+$/, '')

    // Normalize remotePath by stripping leading and trailing '/' (Linux / POSIX path)
    syncPath.remotePath = syncPath.remotePath.replace(/^\/+|\/+$/g, '')

    const remoteParts = syncPath.remotePath.split('/')
    const repository = remoteParts[0] as SYNC_PATH_REPOSITORY

    // Check if the repository is known
    if (!Object.values(SYNC_PATH_REPOSITORY).includes(repository)) {
      throw `Unknown remote path repository type: ${repository}`
    }

    // Enforce subdirectory rules
    switch (repository) {
      case SYNC_PATH_REPOSITORY.PERSONAL:
      case SYNC_PATH_REPOSITORY.SHARES:
        if (remoteParts.length < 2) {
          throw 'Syncing the root of personal files or shares is not supported. Please select a subdirectory.'
        }
        break
      case SYNC_PATH_REPOSITORY.SPACES:
        if (remoteParts.length < 3) {
          throw 'Syncing the root of a space is not supported. Please select a subdirectory.'
        }
        break
    }

    this.isAlreadyExists(syncPath.localPath, syncPath.remotePath)

    if (await isPathExistsBool(syncPath.localPath)) {
      if ((await fs.stat(syncPath.localPath)).isFile()) {
        throw 'Local path must be a directory'
      }
    } else {
      await fs.mkdir(syncPath.localPath)
      logger.info(`Local path created: ${syncPath.localPath}`)
    }
  }
}
