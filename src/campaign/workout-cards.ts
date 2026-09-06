import { RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { RESOURCE_CATALOG, parseResources } from './equipment.ts'
import type { ResourceId } from './equipment.ts'

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

export const WORKOUT_CARD_EXERCISES = Object.freeze(DEFAULT_LIBRARY.exercises.filter(exercise => !exercise.highSkill
  && (RECOMMENDATION_POLICY.supportedExerciseIds as readonly string[]).includes(exercise.id)))

const cardKeys = ['id', 'exerciseId', 'title', 'purpose', 'instructions', 'cues', 'resources', 'source', 'status'] as const
const forbiddenIds = new Set(['__proto__', 'constructor', 'prototype'])
const exerciseIds = new Set(WORKOUT_CARD_EXERCISES.map(exercise => exercise.id))

function plainText(value: unknown, field: 'title' | 'purpose' | 'instructions' | 'cues'): string {
  const max = WORKOUT_CARD_LIMITS[field]
  const controls = typeof value === 'string' && field !== 'title' ? value.replace(/[\r\n\t]/g, '') : value
  if (typeof value !== 'string' || value.length > max || (field === 'title' && !value.trim())
    || (typeof controls === 'string' && /[\p{Cc}\p{Cf}]/u.test(controls)) || /<[^>]*>/u.test(value)) {
    throw new Error(`Card ${field} must be plain text, ${field === 'title' ? '1' : '0'}–${max} characters, without control characters or HTML tags.`)
  }

  return value
}

export function moveWorkoutCard(cards: readonly WorkoutCard[], id: string, direction: -1 | 1): WorkoutCard[] {
  const result = parseWorkoutCards([...cards])
  const index = result.findIndex(card => card.id === id)
  if (index < 0 || index + direction < 0 || index + direction >= result.length) throw new Error('This note cannot move further in the notebook.')
  const original = result[index]
  result[index] = result[index + direction]
  result[index + direction] = original
  return result
}

export function saveWorkoutCard(cards: readonly WorkoutCard[], edited: WorkoutCard, original: WorkoutCard | null): WorkoutCard[] {
  const current = parseWorkoutCards([...cards])
  const next = parseWorkoutCards([edited])[0]
  const previous = current.find(card => card.id === next.id)
  const expected = original === null ? undefined : parseWorkoutCards([original])[0]
  if ((expected && expected.id !== next.id) || JSON.stringify(previous) !== JSON.stringify(expected)) {
    throw new Error('This note changed while the editor was open. Your saved changes are safe. Cancel and reopen the note before editing again.')
  }
  return parseWorkoutCards(previous ? current.map(card => card.id === next.id ? next : card) : [...current, next])
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

export function parseWorkoutCards(value: unknown): WorkoutCard[] {
  const ids = new Set<string>()
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
      resources: parseResources(arrayEntries(item.resources, RESOURCE_CATALOG.length, 'Card resources')),
      source: item.source,
      status: item.status,
    })
  }
  return cards
}
