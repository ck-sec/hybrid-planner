import legacyData from './exercises.json' with { type: 'json' }
import defaultData from './exercises-v1.json' with { type: 'json' }
import { parseLibrary } from './validation.ts'
import type { ExerciseLibrary } from './types.ts'

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export const LEGACY_LIBRARY = freeze(parseLibrary(legacyData))
export const DEFAULT_LIBRARY = freeze(parseLibrary(defaultData))

const LIBRARIES: Readonly<Record<string, ExerciseLibrary>> = freeze({
  [LEGACY_LIBRARY.version]: LEGACY_LIBRARY,
  [DEFAULT_LIBRARY.version]: DEFAULT_LIBRARY,
})

/** Resolve an immutable built-in snapshot by its persisted identity. */
export function libraryForVersion(version: string): ExerciseLibrary {
  const library = LIBRARIES[version]
  if (!library) throw new Error(`Unsupported exercise library version: ${version}.`)
  return library
}
