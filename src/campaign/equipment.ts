import { RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { recommendedExercises } from '../../engine/recommendations.ts'
import type { Equipment } from '../../engine/types.ts'

type ResourceGroup = 'strength' | 'cardio' | 'sport'

export const RESOURCE_CATALOG = [
  { id: 'dumbbell', label: 'Dumbbells', group: 'strength' },
  { id: 'barbell', label: 'Barbell & plates', group: 'strength' },
  { id: 'kettlebell', label: 'Kettlebells', group: 'strength' },
  { id: 'machine', label: 'Strength machines', group: 'strength' },
  { id: 'cable', label: 'Cable machine', group: 'strength' },
  { id: 'bands', label: 'Resistance bands', group: 'strength' },
  { id: 'rack', label: 'Squat rack', group: 'strength' },
  { id: 'bench', label: 'Bench', group: 'strength' },
  { id: 'pull_up_bar', label: 'Pull-up bar', group: 'strength' },
  { id: 'rower', label: 'Rower', group: 'cardio' },
  { id: 'ski_erg', label: 'SkiErg', group: 'cardio' },
  { id: 'bike', label: 'Bike', group: 'cardio' },
  { id: 'treadmill', label: 'Treadmill', group: 'cardio' },
  { id: 'dodgeballs', label: 'Dodgeballs', group: 'sport' },
  { id: 'cones', label: 'Cones', group: 'sport' },
  { id: 'wall', label: 'Wall', group: 'sport' },
  { id: 'court', label: 'Court', group: 'sport' },
  { id: 'partner', label: 'Training partner', group: 'sport' },
  { id: 'open_space', label: 'Open space', group: 'sport' },
] as const satisfies readonly { id: string; label: string; group: ResourceGroup }[]

export type ResourceId = (typeof RESOURCE_CATALOG)[number]['id']

export const RESOURCE_PRESETS = [
  { label: 'No kit', resources: [] },
  { label: 'Home', resources: ['bands', 'dumbbell'] },
  { label: 'Gym', resources: ['bands', 'barbell', 'cable', 'dumbbell', 'kettlebell', 'machine'] },
] as const satisfies readonly { label: string; resources: readonly ResourceId[] }[]

const resourceIds: readonly ResourceId[] = RESOURCE_CATALOG.map(resource => resource.id).sort()
const knownResourceIds: ReadonlySet<string> = new Set(resourceIds)
const labels = new Map<ResourceId, string>(RESOURCE_CATALOG.map(resource => [resource.id, resource.label]))
const strengthResources = [
  'bands', 'barbell', 'cable', 'dumbbell', 'kettlebell', 'machine',
] as const satisfies readonly (ResourceId & Equipment)[]
const specificRequirements = new Map<string, readonly ResourceId[]>([
  ['back-squat', ['rack']],
  ['bench-press', ['bench']],
  ['hip-thrust', ['bench']],
  ['pull-up', ['pull_up_bar']],
])

/** Bodyweight is implicit; persisted resources must contain only explicit, unique capabilities. */
export function parseResources(value: unknown): ResourceId[] {
  if (!Array.isArray(value) || value.length > resourceIds.length) {
    throw new Error(`Resources must be an array of at most ${resourceIds.length} resource IDs.`)
  }
  const seen = new Set<ResourceId>()
  for (const id of value) {
    if (typeof id !== 'string' || !knownResourceIds.has(id)) throw new Error('Choose only known resource IDs.')
    if (seen.has(id as ResourceId)) throw new Error('Resources must not contain duplicate IDs.')
    seen.add(id as ResourceId)
  }
  return resourceIds.filter(id => seen.has(id))
}

export function resourcesForEquipment(equipment: readonly Equipment[]): ResourceId[] {
  return strengthResources.filter(id => equipment.includes(id))
}

/** Cardio, spaces and supports do not add engine equipment or imply a training modality. */
export function equipmentForResources(resources: readonly ResourceId[]): Equipment[] {
  return ['bodyweight', ...strengthResources.filter(id => resources.includes(id))]
}

export function resourceLabels(resources: readonly ResourceId[]): string[] {
  return resourceIds.filter(id => resources.includes(id)).map(id => labels.get(id)!)
}

export function exerciseAvailable(exerciseId: string, resources: readonly ResourceId[]): boolean {
  const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === exerciseId)
  if (!exercise) return false
  const equipment = equipmentForResources(resources)
  return exercise.equipment.every(piece => piece === 'none' || equipment.includes(piece))
    && (specificRequirements.get(exerciseId) ?? []).every(id => resources.includes(id))
}

export function recommendForResources(resources: readonly ResourceId[]): string[] {
  const available = RECOMMENDATION_POLICY.supportedExerciseIds.flatMap(id => {
    const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === id)
    return exercise && !exercise.highSkill && exerciseAvailable(id, resources) ? [exercise] : []
  })

  // Keep the engine's routine and dose policy; replace missing kit only within a checked movement pattern.
  return recommendedExercises(equipmentForResources(resources)).flatMap(id => {
    const original = DEFAULT_LIBRARY.exercises.find(exercise => exercise.id === id)
    const choice = available.find(exercise => exercise.id === id)
      ?? available.find(exercise => exercise.pattern === original?.pattern)
    return choice ? [choice.id] : []
  })
}
