import { DEFAULT_LIBRARY, LEGACY_LIBRARY, resolveProgramLibrary } from '../../engine/library.ts'
import { SUPPORTED_SPORT_DRILLS } from '../../engine/program.ts'
import type { ProgramConfigV1, Resource } from '../../engine/types.ts'
import {
  MAX_RESOURCES, RESOURCE_CATALOG, equipmentAvailable, exerciseAvailable, parseResources, programResourcesForResources,
} from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import { AI_PLANNING_OPTIONS } from './authored-policy.ts'

export interface WorkoutCard {
  id: string
  exerciseId: string | null
  title: string
  purpose: string
  instructions: string
  cues: string
  resources: ResourceId[]
  source: 'user' | 'ai'
  status: 'draft' | 'reference'
}

export const MAX_WORKOUT_CARDS = 24
export const WORKOUT_CARD_LIMITS = {
  id: 64,
  title: 100,
  purpose: 300,
  instructions: 2_000,
  cues: 1_000,
} as const

export interface WorkoutCardCatalogItem {
  id: string
  name: string
  kind: 'exercise' | 'sport_drill'
  requirements: readonly Resource[]
}

export const WORKOUT_CARD_EXERCISES: readonly WorkoutCardCatalogItem[] = Object.freeze([
  ...DEFAULT_LIBRARY.exercises
    .filter(exercise => !exercise.highSkill && exercise.template && exercise.profile && exercise.requirements)
    .map(exercise => Object.freeze({
      id: exercise.id,
      name: exercise.label ?? exercise.name,
      kind: 'exercise' as const,
      requirements: Object.freeze([...(exercise.requirements ?? [])]),
    })),
  ...SUPPORTED_SPORT_DRILLS.map(drill => Object.freeze({
    id: drill.id,
    name: drill.label,
    kind: 'sport_drill' as const,
    requirements: Object.freeze([...drill.requirements]),
  })),
])

const GENERIC_CARD_EXERCISES = Object.freeze(WORKOUT_CARD_EXERCISES.filter(item => item.kind === 'exercise'))

/** Includes unavailable historical definitions so their saved links stay readable. */
export function workoutCardCatalog(program?: ProgramConfigV1): readonly WorkoutCardCatalogItem[] {
  const library = resolveProgramLibrary(program, AI_PLANNING_OPTIONS)
  if (library === DEFAULT_LIBRARY && !program?.customSportDrills?.length) {
    return program?.goal === 'dodgeball' ? WORKOUT_CARD_EXERCISES : GENERIC_CARD_EXERCISES
  }
  return Object.freeze([
    ...library.exercises.filter(exercise => exercise.highSkill === false
      && exercise.template && exercise.profile && exercise.requirements)
      .map(exercise => Object.freeze({
        id: exercise.id, name: exercise.label ?? exercise.name, kind: 'exercise' as const,
        requirements: Object.freeze([...(exercise.requirements ?? [])]),
      })),
    ...(program?.goal === 'dodgeball' ? WORKOUT_CARD_EXERCISES.filter(item => item.kind === 'sport_drill') : []),
    ...(program?.customSportDrills ?? []).map(drill => Object.freeze({
      id: drill.id, name: drill.name, kind: 'sport_drill' as const,
      requirements: Object.freeze([...drill.requirements]),
    })),
  ])
}

export function workoutCardAvailable(
  id: string, resources: readonly ResourceId[], program?: ProgramConfigV1,
): boolean {
  const item = WORKOUT_CARD_EXERCISES.find(entry => entry.id === id)
    ?? workoutCardCatalog(program).find(entry => entry.id === id)
  if (!item) return false
  if (!program && LEGACY_LIBRARY.exercises.some(exercise => exercise.id === id)) {
    return exerciseAvailable(id, resources)
  }
  const exact = program?.resources ?? programResourcesForResources(resources)
  return equipmentAvailable(item.requirements, exact)
}

function resourceId(resource: Resource): ResourceId | null {
  if (resource === 'bodyweight' || resource === 'none') return null
  if (resource === 'dodgeball') return 'dodgeballs'
  if (resource === 'court_space') return 'court'
  return resource
}

export function workoutCardMissingResources(
  card: WorkoutCard, resources: readonly ResourceId[], program?: ProgramConfigV1,
): ResourceId[] {
  const missing = card.resources.filter(resource => !resources.includes(resource))
  const item = WORKOUT_CARD_EXERCISES.find(entry => entry.id === card.exerciseId)
    ?? workoutCardCatalog(program).find(entry => entry.id === card.exerciseId)
  if (item) {
    if (!program && LEGACY_LIBRARY.exercises.some(exercise => exercise.id === item.id)) {
      const candidates = item.requirements.flatMap(resource => {
        const id = resourceId(resource)
        return id === null ? [] : [id]
      })
      // Legacy notes use their original support guards, not newly inferred supports.
      missing.push(...candidates.filter(resource => !resources.includes(resource)
        && !exerciseAvailable(item.id, candidates.filter(id => id !== resource))))
    } else {
      const exact = program?.resources ?? programResourcesForResources(resources)
      for (const requirement of item.requirements) {
        const id = resourceId(requirement)
        if (id !== null && !exact.includes(requirement)) missing.push(id)
      }
    }
  }
  return [...new Set(missing)].sort()
}

/** Saved legacy resources remain editable without advertising them in fresh generic notes. */
export function workoutCardResourceOptions(
  resources: readonly ResourceId[], savedResources: readonly ResourceId[] = [],
): ResourceId[] {
  const available = parseResources(resources)
  const saved = parseResources(savedResources)
  return [...new Set([
    ...RESOURCE_CATALOG.map(resource => resource.id),
    ...available.filter(resource => resource.startsWith('custom:')),
    ...saved,
  ])].sort()
}

const cardKeys = ['id', 'exerciseId', 'title', 'purpose', 'instructions', 'cues', 'resources', 'source', 'status'] as const
const forbiddenIds = new Set(['__proto__', 'constructor', 'prototype'])

function plainText(value: unknown, field: 'title' | 'purpose' | 'instructions' | 'cues'): string {
  const max = WORKOUT_CARD_LIMITS[field]
  const controls = typeof value === 'string' && field !== 'title' ? value.replace(/[\r\n\t]/g, '') : value
  if (typeof value !== 'string' || value.length > max || (field === 'title' && !value.trim())
    || (typeof controls === 'string' && /[\p{Cc}\p{Cf}]/u.test(controls)) || /<[^>]*>/u.test(value)) {
    throw new Error(`Card ${field} must be plain text, ${field === 'title' ? '1' : '0'}–${max} characters, without control characters or HTML tags.`)
  }

  return value
}

export function moveWorkoutCard(
  cards: readonly WorkoutCard[], id: string, direction: -1 | 1, program?: ProgramConfigV1,
): WorkoutCard[] {
  const result = parseWorkoutCards([...cards], program)
  const index = result.findIndex(card => card.id === id)
  if (index < 0 || index + direction < 0 || index + direction >= result.length) throw new Error('This note cannot move further in the notebook.')
  const original = result[index]
  result[index] = result[index + direction]
  result[index + direction] = original
  return result
}

export function saveWorkoutCard(
  cards: readonly WorkoutCard[], edited: WorkoutCard, original: WorkoutCard | null, program?: ProgramConfigV1,
): WorkoutCard[] {
  const current = parseWorkoutCards([...cards], program)
  const next = parseWorkoutCards([edited], program)[0]
  const previous = current.find(card => card.id === next.id)
  const expected = original === null ? undefined : parseWorkoutCards([original], program)[0]
  if ((expected && expected.id !== next.id) || JSON.stringify(previous) !== JSON.stringify(expected)) {
    throw new Error('This note changed while the editor was open. Your saved changes are safe. Cancel and reopen the note before editing again.')
  }
  return parseWorkoutCards(previous ? current.map(card => card.id === next.id ? next : card) : [...current, next], program)
}

function cardRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Reflect.ownKeys(value).length !== cardKeys.length
    || cardKeys.some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return !descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable
    })) {
    throw new Error('A card must contain exactly id, exerciseId, title, purpose, instructions, cues, resources, source and status. Quantities, placement, costs and extra fields are not allowed.')
  }
  return value as Record<string, unknown>
}

function arrayEntries(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max
    || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new Error(`${label} must be an array of at most ${max} entries, without extra fields.`)
  }
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new Error(`${label} must contain only complete entries.`)
    }
    return descriptor.value
  })
}

export function parseWorkoutCards(value: unknown, program?: ProgramConfigV1): WorkoutCard[] {
  const ids = new Set<string>()
  const exerciseIds = new Set([...WORKOUT_CARD_EXERCISES, ...workoutCardCatalog(program)].map(exercise => exercise.id))
  const cards: WorkoutCard[] = []
  for (const entry of arrayEntries(value, MAX_WORKOUT_CARDS, 'The reference notebook')) {
    const item = cardRecord(entry)
    if (typeof item.id !== 'string' || item.id.length > WORKOUT_CARD_LIMITS.id
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || forbiddenIds.has(item.id)) {
      throw new Error(`A card ID must be a lowercase letter/number slug of at most ${WORKOUT_CARD_LIMITS.id} characters, with no reserved names.`)
    }
    if (ids.has(item.id)) throw new Error('Reference notebook card IDs must be unique.')
    ids.add(item.id)
    if (item.exerciseId !== null && (typeof item.exerciseId !== 'string'
      || !exerciseIds.has(item.exerciseId))) {
      throw new Error('Link a supported, non-high-skill catalog exercise, or use null for an unscheduled drill idea.')
    }
    if (item.source !== 'user' && item.source !== 'ai') throw new Error('Card source must be user or ai.')
    if (item.status !== 'draft' && item.status !== 'reference') throw new Error('Card status must be draft or reference.')
    // Schema checks cannot establish whether AI-authored training prose is safe.
    if (item.source === 'ai' && item.status !== 'draft') throw new Error('AI-authored cards must remain drafts; reference claims are not accepted.')
    cards.push({
      id: item.id,
      exerciseId: item.exerciseId,
      title: plainText(item.title, 'title'),
      purpose: plainText(item.purpose, 'purpose'),
      instructions: plainText(item.instructions, 'instructions'),
      cues: plainText(item.cues, 'cues'),
      resources: parseResources(arrayEntries(item.resources, MAX_RESOURCES, 'Card resources')),
      source: item.source,
      status: item.status,
    })
  }
  return cards
}
