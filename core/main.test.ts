import { describe, expect, it, vi } from 'vitest'
import { SYNC_MODE } from './components/constants/diff'
import { CORE, coreEvents } from './components/handlers/events'
import { RequestsManager } from './components/handlers/requests'
import { TransfersManager } from './components/handlers/transfers'
import { SyncManager } from './components/main'
import { Server } from './components/models/server'
import { SyncPath } from './components/models/syncpath'
import { RunManager } from './main'

function listenerSnapshot() {
  return {
    exit: coreEvents.listeners(CORE.EXIT),
    sigint: process.listeners('SIGINT'),
    sigterm: process.listeners('SIGTERM'),
    syncStop: coreEvents.listeners(CORE.SYNC_STOP)
  }
}

function coreListenerCount() {
  return coreEvents.eventNames().reduce((count, eventName) => count + coreEvents.listenerCount(eventName), 0)
}

function restoreListeners(snapshot: ReturnType<typeof listenerSnapshot>) {
  for (const listener of coreEvents.listeners(CORE.EXIT).filter((listener) => !snapshot.exit.includes(listener))) {
    coreEvents.removeListener(CORE.EXIT, listener as () => void)
  }
  for (const listener of coreEvents.listeners(CORE.SYNC_STOP).filter((listener) => !snapshot.syncStop.includes(listener))) {
    coreEvents.removeListener(CORE.SYNC_STOP, listener as () => void)
  }
  for (const listener of process.listeners('SIGINT').filter((listener) => !snapshot.sigint.includes(listener))) {
    process.removeListener('SIGINT', listener as () => void)
  }
  for (const listener of process.listeners('SIGTERM').filter((listener) => !snapshot.sigterm.includes(listener))) {
    process.removeListener('SIGTERM', listener as () => void)
  }
}

function activeSyncManager(serverId: number, syncPathId: number) {
  const stop = vi.fn()
  const cleanOnExit = vi.fn()
  const manager = new SyncManager(new Server({ id: serverId, name: `server-${serverId}` }))
  Object.assign(manager, {
    syncs: [
      {
        instance: { logger: { warn: vi.fn() }, stop },
        reportOnly: false,
        req: { cleanOnExit },
        syncPathId
      }
    ]
  })
  return { cleanOnExit, manager, stop }
}

describe('RunManager lifecycle events', () => {
  it('keeps global listener counts constant with more than ten active synchronizations', () => {
    const snapshot = listenerSnapshot()
    const transfers: TransfersManager[] = []
    try {
      const runManager = new RunManager()
      const listenerCount = coreListenerCount()
      const syncManagers = (runManager as any).syncManagers as Set<SyncManager>

      for (let index = 0; index < 12; index++) {
        syncManagers.add(new SyncManager(new Server({ id: index + 1, name: `server-${index + 1}` })))
        transfers.push(
          new TransfersManager({
            server: { id: index + 1, name: `server-${index + 1}` },
            path: { id: index + 1, name: `path-${index + 1}` }
          })
        )
      }

      expect(coreListenerCount()).toBe(listenerCount)
    } finally {
      for (const transfer of transfers) {
        transfer.stop()
      }
      restoreListeners(snapshot)
    }
  })

  it('routes SYNC_STOP to the matching manager and EXIT to every active manager', () => {
    const snapshot = listenerSnapshot()
    try {
      const runManager = new RunManager()
      const first = activeSyncManager(1, 10)
      const second = activeSyncManager(2, 20)
      const syncManagers = (runManager as any).syncManagers as Set<SyncManager>
      syncManagers.add(first.manager)
      syncManagers.add(second.manager)

      coreEvents.emit(CORE.SYNC_STOP, { server: 1, paths: [10] }, false)

      expect(first.stop).toHaveBeenCalledOnce()
      expect(first.cleanOnExit).toHaveBeenCalledOnce()
      expect(second.stop).not.toHaveBeenCalled()
      expect(second.cleanOnExit).not.toHaveBeenCalled()

      coreEvents.emit(CORE.EXIT)

      expect(first.stop).toHaveBeenCalledTimes(2)
      expect(second.stop).toHaveBeenCalledOnce()
      expect(second.cleanOnExit).toHaveBeenCalledOnce()
    } finally {
      restoreListeners(snapshot)
    }
  })

  it.each([
    { failure: null, label: 'success' },
    { failure: new Error('sync failed'), label: 'error' }
  ])('removes completed managers from the active registry after $label', async ({ failure }) => {
    const snapshot = listenerSnapshot()
    try {
      const syncPath = new SyncPath({
        id: 10,
        name: 'path',
        localPath: '/tmp/path',
        remotePath: 'remote',
        mode: SYNC_MODE.UPLOAD
      })
      const server = new Server({ id: 1, name: 'server', syncPaths: [] })
      server.syncPaths = [syncPath]
      const runManager = new RunManager()
      Object.assign(runManager, {
        getServers: () => [server],
        updatePaths: vi.fn().mockResolvedValue(undefined)
      })
      vi.spyOn(RequestsManager, 'checkConnection').mockResolvedValue(true)
      vi.spyOn(SyncManager.prototype, 'run').mockImplementation(async function () {
        expect((runManager as any).syncManagers.has(this)).toBe(true)
        expect((runManager as any).currentSyncs).toHaveLength(1)
        if (failure) {
          throw failure
        }
      })

      if (failure) {
        await expect(runManager.run({ server: 1, paths: [10] }, true)).rejects.toBe(failure)
      } else {
        await expect(runManager.run({ server: 1, paths: [10] }, true)).resolves.toBeUndefined()
      }

      expect((runManager as any).syncManagers.size).toBe(0)
      expect((runManager as any).currentSyncs).toEqual([])
    } finally {
      restoreListeners(snapshot)
    }
  })
})
