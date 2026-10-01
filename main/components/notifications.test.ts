import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../constants/events'
import { NotifyManager } from './notifications'

const electronMock = vi.hoisted(() => {
  const ipcHandlers = new Map<string, (...args: any[]) => void>()

  class NotificationMock {
    static instances: NotificationMock[] = []
    static isSupported = vi.fn(() => true)
    once = vi.fn()
    show = vi.fn()

    constructor(public readonly options: { title: string; body: string; silent: boolean }) {
      NotificationMock.instances.push(this)
    }
  }

  return {
    app: { setBadgeCount: vi.fn() },
    ipcHandlers,
    ipcMain: {
      on: vi.fn((channel: string, listener: (...args: any[]) => void) => {
        ipcHandlers.set(channel, listener)
      })
    },
    Notification: NotificationMock
  }
})

const appEventsMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => void>()
  return {
    handlers,
    on: vi.fn((channel: string, listener: (...args: any[]) => void) => handlers.set(channel, listener)),
    emit: (channel: string, ...args: any[]) => handlers.get(channel)?.(...args)
  }
})

const serversMock = vi.hoisted(() => ({ list: [] as any[] }))

vi.mock('electron', () => electronMock)
vi.mock('./events', () => ({ appEvents: appEventsMock }))
vi.mock('./translate', () => ({ i18n: { tr: (value: string) => value } }))
vi.mock('../../core/components/handlers/servers', () => ({ ServersManager: serversMock }))

describe('NotifyManager system notification settings', () => {
  const serverOne = { id: 1, name: 'Server one' }
  const serverTwo = { id: 2, name: 'Server two' }
  const eventFor = (serverId: number) => ({ sender: { serverId } }) as any

  beforeEach(() => {
    vi.clearAllMocks()
    electronMock.ipcHandlers.clear()
    electronMock.Notification.instances = []
    appEventsMock.handlers.clear()
    serversMock.list = [serverOne, serverTwo]
  })

  function createManager(): NotifyManager {
    const viewsManager = {
      getServerFromVerifiedSender: vi.fn((event) => serversMock.list.find((server) => server.id === event.sender.serverId) ?? null),
      sendToWrapperRenderer: vi.fn()
    }
    return new NotifyManager(viewsManager as any)
  }

  function updateSettings(serverId: number, useSystemNotifications?: boolean): void {
    electronMock.ipcHandlers.get(REMOTE_RENDERER.APPLICATIONS.SYSTEM_NOTIFICATIONS)?.(eventFor(serverId), useSystemNotifications)
  }

  function emitSyncNotification(serverId: number): void {
    appEventsMock.emit(LOCAL_RENDERER.SYNC.MSG, {
      serverId,
      title: 'Synchronization',
      body: 'elements synchronized',
      nb: 2
    })
  }

  it('keeps notifications enabled when the remote does not publish the setting', () => {
    createManager()

    emitSyncNotification(serverOne.id)

    expect(electronMock.Notification.instances).toHaveLength(1)
    expect(electronMock.Notification.instances[0].options.body).toBe('2 elements synchronized')
  })

  it('disables notifications only for the server that explicitly publishes false', () => {
    createManager()
    updateSettings(serverOne.id, false)

    emitSyncNotification(serverOne.id)
    emitSyncNotification(serverTwo.id)
    electronMock.ipcHandlers.get(REMOTE_RENDERER.APPLICATIONS.MSG)?.(eventFor(serverOne.id), { title: 'Hidden', body: 'Hidden' })
    electronMock.ipcHandlers.get(REMOTE_RENDERER.APPLICATIONS.MSG)?.(eventFor(serverTwo.id), { title: 'Visible', body: 'Visible' })

    expect(electronMock.Notification.instances).toHaveLength(2)
    expect(electronMock.Notification.instances.map(({ options }) => options.title)).toEqual(['Synchronization', 'Server two - Visible'])
  })

  it('reactivates notifications immediately and ignores settings from an unknown sender', () => {
    createManager()
    updateSettings(serverOne.id, false)
    updateSettings(999, false)
    updateSettings(serverOne.id, true)

    emitSyncNotification(serverOne.id)
    emitSyncNotification(serverTwo.id)

    expect(electronMock.Notification.instances).toHaveLength(2)
  })
})
