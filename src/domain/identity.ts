const STABLE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/

export type StableIdentity = string & { readonly __stableIdentity: unique symbol }

export function parseStableIdentity(value: unknown, label = 'id'): StableIdentity {
  if (typeof value !== 'string' || !STABLE_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a stable lowercase id using letters, numbers, and hyphens.`)
  }
  return value as StableIdentity
}

export function isStableIdentity(value: unknown): value is StableIdentity {
  try {
    parseStableIdentity(value)
    return true
  } catch {
    return false
  }
}

export function assertUniqueStableIdentities(
  ids: Iterable<string>,
  label: string,
): void {
  const seen = new Set<string>()
  for (const id of ids) {
    parseStableIdentity(id, `${label} id`)
    if (seen.has(id)) throw new Error(`${label} ids must be unique. Duplicate id "${id}" found.`)
    seen.add(id)
  }
}
