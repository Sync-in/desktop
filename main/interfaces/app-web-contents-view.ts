import { WebContents, WebContentsView } from 'electron'

export interface AppWebContentsView extends WebContentsView {
  webContents: WebContents & {
    serverId?: number
    serverName?: string
  }
}
