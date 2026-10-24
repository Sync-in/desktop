import { InvalidArgumentError } from 'commander'
import type { NameOrId } from '../interfaces/cli-options.interface'

const DECIMAL_ID_PATTERN = /^(?:0|[1-9]\d*)$/

export function parseNameOrId(value: string): NameOrId {
  if (!DECIMAL_ID_PATTERN.test(value)) return value

  const identifier = Number(value)
  return Number.isSafeInteger(identifier) ? identifier : value
}

export function parseBoolean(value: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new InvalidArgumentError('expected "true" or "false"')
}
