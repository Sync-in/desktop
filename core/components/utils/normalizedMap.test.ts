import { describe, expect, it } from 'vitest'
import { NormalizedMap } from './normalizedMap'

describe('NormalizedMap', () => {
  const composed = 'données/café.txt'
  const decomposed = composed.normalize('NFD')

  it('finds an NFD file path indexed through the constructor with an NFC path', () => {
    const file = { size: 42 }
    const files = new NormalizedMap([[decomposed, file]])

    expect(decomposed).not.toBe(composed)
    expect(files.get(composed)).toBe(file)
    expect(files.has(composed)).toBe(true)
    expect(files.getResolvedKey(composed)).toBe(decomposed)
    expect([...files.keys()]).toEqual([decomposed])
  })

  it('finds an NFC file path with an NFD lookup', () => {
    const files = new NormalizedMap<string, number>()
    files.set(composed, 42)

    expect(files.get(decomposed)).toBe(42)
    expect(files.has(decomposed)).toBe(true)
    expect(files.getResolvedKey(decomposed)).toBe(composed)
  })

  it('matches paths whose directory and filename use different Unicode forms', () => {
    const indexedPath = 'donne\u0301es/café.txt'
    const lookupPath = 'données/cafe\u0301.txt'
    const files = new NormalizedMap([[indexedPath, 42]])

    expect(files.get(lookupPath)).toBe(42)
    expect(files.getResolvedKey(lookupPath)).toBe(indexedPath)
  })

  it('replaces a canonically equivalent key without leaving a duplicate', () => {
    const files = new NormalizedMap<string, number>([[composed, 1]])
    files.set(decomposed, 2)

    expect(files.size).toBe(1)
    expect([...files.entries()]).toEqual([[decomposed, 2]])
    expect(files.get(composed)).toBe(2)
    expect(files.getResolvedKey(composed)).toBe(decomposed)
  })

  it('removes the indexed file through an equivalent Unicode path', () => {
    const files = new NormalizedMap([[decomposed, 1]])

    expect(files.delete(composed)).toBe(true)
    expect(files.size).toBe(0)
    expect(files.get(decomposed)).toBeUndefined()
    expect(files.has(composed)).toBe(false)
    expect(files.getResolvedKey(composed)).toBeUndefined()

    files.set(composed, 2)
    expect(files.get(decomposed)).toBe(2)
  })

  it('clears the Unicode index along with the map', () => {
    const files = new NormalizedMap([[decomposed, 1]])
    files.clear()

    expect(files.get(composed)).toBeUndefined()
    expect(files.has(composed)).toBe(false)
    expect(files.getResolvedKey(composed)).toBeUndefined()
    expect(files.size).toBe(0)
  })

  it('keeps distinct paths separate when they are not canonically equivalent', () => {
    const files = new NormalizedMap([
      ['cafe.txt', 1],
      ['café.txt', 2],
      ['Café.txt', 3]
    ])

    expect(files.size).toBe(3)
    expect(files.get('cafe.txt')).toBe(1)
    expect(files.get('cafe\u0301.txt')).toBe(2)
    expect(files.get('Cafe\u0301.txt')).toBe(3)
    expect(files.has('missing.txt')).toBe(false)
  })
})
