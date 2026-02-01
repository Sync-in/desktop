import path from 'node:path'
import { BrowserWindowConstructorOptions, nativeTheme, WebContentsViewConstructorOptions } from 'electron'
import { THEME } from './themes'

// Renderer constants
const DEFAULT_WINDOW_WIDTH = 1128
const DEFAULT_WINDOW_HEIGHT = 650
const MINIMUM_WINDOW_WIDTH = 700
const MINIMUM_WINDOW_HEIGHT = 550

export const THEMES = { [THEME.LIGHT]: '#0b2640', [THEME.DARK]: '#222d32' }

export const TAB_BAR_HEIGHT = 40
export const WRAPPER_VIEW_OFFSET_HEIGHT = 80
export const RENDERER_FILE = './dist/renderer/index.html'
const PRELOAD_FILE = path.join(__dirname, 'preload.js')

export const defaultWindowProps: BrowserWindowConstructorOptions = {
  width: DEFAULT_WINDOW_WIDTH,
  height: DEFAULT_WINDOW_HEIGHT,
  minWidth: MINIMUM_WINDOW_WIDTH,
  minHeight: MINIMUM_WINDOW_HEIGHT,
  useContentSize: true,
  show: false, // don't start the window until it is ready and only if it isn't hidden
  paintWhenInitiallyHidden: true, // we want it to start painting to get info from the webapp
  frame: false,
  titleBarStyle: 'hidden',
  trafficLightPosition: { x: 12, y: 12 },
  backgroundColor: THEMES[nativeTheme.shouldUseDarkColors ? THEME.DARK : THEME.LIGHT]
}

export function partitionFor(id: number | string): string {
  return `persist:${id}`
}

export function viewProps(id: number | string): WebContentsViewConstructorOptions {
  return {
    webPreferences: {
      partition: partitionFor(id),
      // Disabled Node integration
      nodeIntegration: false,
      // protect against prototype pollution
      contextIsolation: true,
      preload: PRELOAD_FILE,
      transparent: true
    }
  }
}
