import { parseStableIdentity, type StableIdentity } from '../../domain/identity.ts'

let sequence = 0

function randomSegment(): string {
  const random = Math.floor(Math.random() * 0x7fffffff).toString(36)
  sequence = (sequence + 1) % 0xffff
  return `${Date.now().toString(36)}${random}${sequence.toString(36)}`
}

function sanitize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Creates a stable, storage-safe identity for records created inside the browser session. */
export function createControllerId(prefix: string): StableIdentity {
  const safePrefix = sanitize(prefix) || 'record'
  const candidate = `${safePrefix}-${sanitize(randomSegment())}`.slice(0, 80).replace(/-+$/, '')
  return parseStableIdentity(candidate, `${safePrefix} id`)
}
