import { WRAPPER_RENDERER_EVENTS } from './constants/events'
import { exposeIpcRenderer } from './preload'

exposeIpcRenderer(WRAPPER_RENDERER_EVENTS)
