import { describe, expect, it } from 'vitest'
import { parseBoolean, parseNameOrId } from './argument-parsers'

describe('CLI argument parsers', () => {
  it.each([
    ['0', 0],
    ['1', 1],
    ['42', 42],
    [`${Number.MAX_SAFE_INTEGER}`, Number.MAX_SAFE_INTEGER]
  ])('converts the safe decimal identifier %s to a number', (value, expected) => {
    expect(parseNameOrId(value)).toBe(expected)
  })

  it.each(['production', 'server-42', '0042', '1.5', '12x', `${Number.MAX_SAFE_INTEGER + 1}`])('keeps the ambiguous name %s as a string', (value) => {
    expect(parseNameOrId(value)).toBe(value)
  })

  it.each([
    ['true', true],
    ['false', false]
  ])('parses the boolean %s', (value, expected) => {
    expect(parseBoolean(value)).toBe(expected)
  })

  it('rejects an invalid boolean', () => {
    expect(() => parseBoolean('yes')).toThrow('expected "true" or "false"')
  })
})
