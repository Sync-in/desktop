import { app, ipcMain, Notification } from 'electron'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../constants/events'
import type { ViewsManager } from './views'
import { appEvents } from './events'
import { i18n } from './translate'
import type { ApplicationCounter, ServerAppCounter } from '../interfaces/counter.interface'
import type { IpcMainEventServer } from '../interfaces/ipc-main-event.interface'
import type { Server } from '../../core/components/models/server'
import { ServersManager } from '../../core/components/handlers/servers'
import type { SyncNotificationMessage } from '../interfaces/notification.interface'

export class NotifyManager {
  viewsManager: ViewsManager
  removeHtmlTags = /(<([^>]+)>)/gi
  notificationIsSupported = true
  serversAppsCounter: ServerAppCounter[] = [] // [{'id': 1, 'name': 'test', 'applications': {'notifications': 2, 'tasks': 4, 'syncs': 2}}, ...]
  private readonly systemNotificationsSettings = new WeakMap<Server, boolean>()

  constructor(viewsManager: ViewsManager) {
    this.viewsManager = viewsManager
    this.notificationIsSupported = Notification.isSupported()
    ipcMain.on(REMOTE_RENDERER.APPLICATIONS.MSG, (ev: IpcMainEventServer, msg: { title: string; body: string }) =>
      this.receivedMsgFromRenderer(ev, msg)
    )
    ipcMain.on(REMOTE_RENDERER.APPLICATIONS.COUNTER, (ev: IpcMainEventServer, application: ApplicationCounter, count: number) =>
      this.storeUnreadCounter(ev, application, count)
    )
    ipcMain.on(REMOTE_RENDERER.APPLICATIONS.SYSTEM_NOTIFICATIONS, (ev: IpcMainEventServer, useSystemNotifications: boolean) =>
      this.updateSystemNotificationsSettings(ev, useSystemNotifications)
    )
    appEvents.on(LOCAL_RENDERER.SYNC.MSG, (msg: SyncNotificationMessage) => this.receivedMsgFromSync(msg))
  }

  send(title: string, body: string, callback = null) {
    if (this.notificationIsSupported) {
      const notification = new Notification({ title: title, body: body, silent: true })
      if (callback) {
        notification.once('click', callback)
      }
      notification.show()
    }
  }

  private receivedMsgFromSync(msg: SyncNotificationMessage) {
    const server = ServersManager.list.find((server: Server) => server.id === msg.serverId)
    if (!server || !this.canUseSystemNotifications(server)) return
    if (msg.nb) {
      this.send(msg.title, `${msg.nb} ${i18n.tr(msg.body)}`)
    } else {
      this.send(msg.title, msg.body)
    }
  }

  private receivedMsgFromRenderer(ev: IpcMainEventServer, msg: { title: string; body: string }): void {
    const server = this.viewsManager.getServerFromVerifiedSender(ev, { throwOnError: false })
    if (!server || !this.canUseSystemNotifications(server)) return
    this.send(`${server.name} - ${msg.title}`, msg?.body?.replaceAll(this.removeHtmlTags, ''))
  }

  private updateSystemNotificationsSettings(ev: IpcMainEventServer, useSystemNotifications: boolean): void {
    const server = this.viewsManager.getServerFromVerifiedSender(ev, { throwOnError: false })
    if (!server) return
    this.systemNotificationsSettings.set(server, useSystemNotifications !== false)
  }

  private canUseSystemNotifications(server: Server): boolean {
    return this.systemNotificationsSettings.get(server) !== false
  }

  private storeUnreadCounter(ev: IpcMainEventServer, application: ApplicationCounter, count: number) {
    const server = this.viewsManager.getServerFromVerifiedSender(ev, { throwOnError: false })
    if (!server) return
    let globalCount = 0
    let serverFound = false
    for (const serverCounter of this.serversAppsCounter) {
      if (server.id === serverCounter.id) {
        serverCounter.applications[application] = count
        serverFound = true
      }
      for (const appCount of (Object as any).values(serverCounter.applications)) {
        globalCount += appCount
      }
    }
    if (!serverFound) {
      this.serversAppsCounter.push({
        id: server.id,
        name: server.name,
        applications: { [application]: count } as ServerAppCounter['applications']
      })
      globalCount += count
    }
    this.viewsManager.sendToWrapperRenderer(REMOTE_RENDERER.APPLICATIONS.COUNTER, this.serversAppsCounter)
    app.setBadgeCount(globalCount)
  }
}
