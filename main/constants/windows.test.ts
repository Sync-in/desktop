import { describe, expect, it, vi } from 'vitest'
import { partitionFor, viewProps } from './windows'

vi.mock('electron', () => ({
  nativeTheme: {
    shouldUseDarkColors: false
  }
}))

describe('window view props', () => {
  it('uses stable persistent partitions', () => {
    expect(partitionFor('wrapper')).toBe('persist:wrapper')
    expect(partitionFor(42)).toBe('persist:42')
  })

  it('uses the wrapper preload for the local wrapper view', () => {
    const props = viewProps('wrapper')

    expect(props.webPreferences?.partition).toBe('persist:wrapper')
    expect(props.webPreferences?.preload).toMatch(/preload-wrapper\.js$/)
  })

  it('uses the webview preload for server views', () => {
    const props = viewProps(12)

    expect(props.webPreferences?.partition).toBe('persist:12')
    expect(props.webPreferences?.preload).toMatch(/preload-webview\.js$/)
  })

  it('keeps renderer isolation options enabled', () => {
    const props = viewProps(12)

    expect(props.webPreferences?.nodeIntegration).toBe(false)
    expect(props.webPreferences?.contextIsolation).toBe(true)
    expect(props.webPreferences?.sandbox).toBe(true)
  })
})
