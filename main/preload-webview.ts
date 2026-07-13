import { WEBVIEW_RENDERER_EVENTS } from './constants/events'
import { exposeIpcRenderer } from './preload'

exposeIpcRenderer(WEBVIEW_RENDERER_EVENTS, { showFilePath: true })
