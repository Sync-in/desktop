import { app, ipcMain, Notification } from 'electron'
import { LOCAL_RENDERER, REMOTE_RENDERER } from '../constants/events'
import { ViewsManager } from './views'
import { appEvents } from './events'
import { i18n } from './translate'
import { ApplicationCounter, ServerAppCounter } from '../interfaces/counter.interface'

export class NotifyManager {
  viewsManager: ViewsManager
  removeHtmlTags = /(<([^>]+)>)/gi
  notificationIsSupported = true
  serversAppsCounter: ServerAppCounter[] = [] // [{'id': 1, 'name': 'test', 'applications': {'notifications': 2, 'tasks': 4, 'syncs': 2}}, ...]

  constructor(viewsManager: ViewsManager) {
    this.viewsManager = viewsManager
    this.notificationIsSupported = Notification.isSupported()
    ipcMain.on(REMOTE_RENDERER.APPLICATIONS.MSG, (ev, msg: { title: string; body: string }) => this.receivedMsgFromRenderer(ev, msg))
    ipcMain.on(REMOTE_RENDERER.APPLICATIONS.COUNTER, (ev, application: ApplicationCounter, count: number) =>
      this.storeUnreadCounter(ev, application, count)
    )
    appEvents.on(LOCAL_RENDERER.SYNC.MSG, (msg: { title: string; body: string; nb?: number }) => this.receivedMsgFromSync(msg))
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

  private receivedMsgFromSync(msg: { title: string; body: string; nb?: number }) {
    if (msg.nb) {
      this.send(msg.title, `${msg.nb} ${i18n.tr(msg.body)}`)
    } else {
      this.send(msg.title, msg.body)
    }
  }

  private receivedMsgFromRenderer(ev: any, msg: { title: string; body: string }): void {
    this.send(`${ev.sender.serverName} - ${msg.title}`, msg?.body?.replaceAll(this.removeHtmlTags, ''))
  }

  private storeUnreadCounter(ev: any, application: ApplicationCounter, count: number) {
    let globalCount = 0
    let serverFound = false
    for (const server of this.serversAppsCounter) {
      if (ev.sender.serverId === server.id) {
        server.applications[application] = count
        serverFound = true
      }
      for (const appCount of (Object as any).values(server.applications)) {
        globalCount += appCount
      }
    }
    if (!serverFound) {
      this.serversAppsCounter.push({
        id: ev.sender.serverId,
        name: ev.sender.serverName,
        applications: { [application]: count } as ServerAppCounter['applications']
      })
      globalCount += count
    }
    this.viewsManager.sendToWrapperRenderer(REMOTE_RENDERER.APPLICATIONS.COUNTER, this.serversAppsCounter)
    app.setBadgeCount(globalCount)
  }
}
