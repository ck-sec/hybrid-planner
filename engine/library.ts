import data from './exercises.json' with { type: 'json' }
import { parseLibrary } from './validation.ts'

export const DEFAULT_LIBRARY = parseLibrary(data)
