import { PROGRAM_POLICY, RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { DEFAULT_LIBRARY, LEGACY_LIBRARY, resolveProgramLibrary } from '../../engine/library.ts'
import { availableExerciseMetadata, recommendProgram, SUPPORTED_SPORT_DRILLS } from '../../engine/program.ts'
import type { ExerciseMetadata } from '../../engine/program.ts'
import { recommendedExercises } from '../../engine/recommendations.ts'
import type { Equipment, ProgramConfigV1, ProgramGoal, Resource } from '../../engine/types.ts'

type ResourceGroup = 'strength' | 'cardio'

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
  { id: 'stable_step', label: 'Stable step', group: 'strength' },
  { id: 'floor_space', label: 'Floor space', group: 'strength' },
  { id: 'anchor_point', label: 'Secure band anchor', group: 'strength' },
  { id: 'carry_space', label: 'Clear carry space', group: 'strength' },
  { id: 'rower', label: 'Rower', group: 'cardio' },
  { id: 'ski_erg', label: 'SkiErg', group: 'cardio' },
  { id: 'bike', label: 'Bike', group: 'cardio' },
  { id: 'treadmill', label: 'Treadmill', group: 'cardio' },
] as const satisfies readonly { id: string; label: string; group: ResourceGroup }[]

const LEGACY_RESOURCE_LABELS = {
  dodgeballs: 'Ball (saved equipment)',
  cones: 'Cones',
  wall: 'Wall',
  court: 'Playing space (saved equipment)',
  partner: 'Training partner',
  open_space: 'Open space',
  safe_target: 'Practice target (saved equipment)',
} as const

export type ResourceId = (typeof RESOURCE_CATALOG)[number]['id'] | keyof typeof LEGACY_RESOURCE_LABELS | `custom:${string}`
export const MAX_CUSTOM_RESOURCES = 16
export const MAX_CUSTOM_RESOURCE_SLUG_LENGTH = 48
const customResourcePattern = /^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/

export const RESOURCE_PRESETS = [
  { label: 'No kit', resources: ['floor_space'] },
  { label: 'Home', resources: ['bands', 'dumbbell', 'floor_space'] },
  { label: 'Gym', resources: ['bands', 'barbell', 'cable', 'dumbbell', 'floor_space', 'kettlebell', 'machine'] },
] as const satisfies readonly { label: string; resources: readonly ResourceId[] }[]

const resourceIds: readonly ResourceId[] = [
  ...RESOURCE_CATALOG.map(resource => resource.id),
  ...Object.keys(LEGACY_RESOURCE_LABELS) as (keyof typeof LEGACY_RESOURCE_LABELS)[],
].sort()
export const MAX_RESOURCES = resourceIds.length + MAX_CUSTOM_RESOURCES
const knownResourceIds: ReadonlySet<string> = new Set(resourceIds)
const labels = new Map<ResourceId, string>([
  ...RESOURCE_CATALOG.map(resource => [resource.id, resource.label] as [ResourceId, string]),
  ...Object.entries(LEGACY_RESOURCE_LABELS) as [ResourceId, string][],
])
const strengthResources = [
  'bands', 'barbell', 'cable', 'dumbbell', 'kettlebell', 'machine',
] as const satisfies readonly (ResourceId & Equipment)[]
const specificRequirements = new Map<string, readonly ResourceId[]>([
  ['back-squat', ['rack']],
  ['bench-press', ['bench']],
  ['hip-thrust', ['bench']],
  ['pull-up', ['pull_up_bar']],
])
const PROGRAM_RESOURCE_IDS = new Set<Resource>([
  'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bands',
  'bench', 'rack', 'pull_up_bar', 'stable_step', 'floor_space', 'anchor_point',
  'carry_space', 'dodgeball', 'court_space', 'safe_target',
])

/** Bodyweight is implicit; persisted resources must contain only explicit, unique capabilities. */
export function parseResources(value: unknown): ResourceId[] {
  if (!Array.isArray(value) || value.length > MAX_RESOURCES) {
    throw new Error(`Resources must be an array of at most ${MAX_RESOURCES} resource IDs.`)
  }
  const seen = new Set<ResourceId>()
  let customCount = 0
  for (const id of value) {
    if (typeof id !== 'string') throw new Error('Choose valid resource IDs.')
    if (!knownResourceIds.has(id)) {
      if (!customResourcePattern.test(id) || id.slice(7).length > MAX_CUSTOM_RESOURCE_SLUG_LENGTH) {
        throw new Error('Custom resource IDs need a lowercase name of up to 48 letters, numbers and single hyphens.')
      }
      customCount += 1
      if (customCount > MAX_CUSTOM_RESOURCES) throw new Error('Choose at most 16 custom resources.')
    }
    if (seen.has(id as ResourceId)) throw new Error('Resources must not contain duplicate IDs.')
    seen.add(id as ResourceId)
  }
  return [...seen].sort()
}

/** Free-form gear names become portable IDs, never engine equipment aliases. */
export function customResourceId(value: string): `custom:${string}` {
  if (typeof value !== 'string' || value.length > 120 || !/^[a-zA-Z0-9 -]+$/.test(value)) {
    throw new Error('Use a short equipment name with letters, numbers, spaces or hyphens.')
  }
  const slug = value.trim().toLowerCase().replace(/[ -]+/g, '-')
  const id = `custom:${slug}` as const
  parseResources([id])
  return id
}

export function resourcesForEquipment(equipment: readonly Equipment[]): ResourceId[] {
  return strengthResources.filter(id => equipment.includes(id))
}

/** Cardio, spaces and supports do not add engine equipment or imply a training modality. */
export function equipmentForResources(resources: readonly ResourceId[]): Equipment[] {
  return ['bodyweight', ...strengthResources.filter(id => resources.includes(id))]
}

export function resourceLabels(resources: readonly ResourceId[]): string[] {
  return parseResources([...new Set(resources)]).map(id => labels.get(id)
    ?? id.slice(7).split('-').map(word => word[0]!.toUpperCase() + word.slice(1)).join(' '))
}

/** Convert app capabilities to the exact resources understood by the opt-in program engine. */
export function programResourcesForResources(resources: readonly ResourceId[]): Resource[] {
  const parsed = parseResources(resources)
  const projected = new Set<Resource>(['bodyweight'])
  for (const id of parsed) {
    if (id.startsWith('custom:') || PROGRAM_RESOURCE_IDS.has(id as Resource)) projected.add(id as Resource)
    else if (id === 'dodgeballs') projected.add('dodgeball')
    else if (id === 'court') projected.add('court_space')
  }
  return [...projected].sort()
}

export const programResources = programResourcesForResources

/** Exact metadata requirements; unlike legacy equipment checks this never infers a support or space. */
export function equipmentAvailable(requirements: readonly Resource[], resources: readonly Resource[]): boolean {
  const available = new Set(resources)
  return requirements.every(resource => available.has(resource))
}

type ProgramChoice = ProgramConfigV1 | ProgramGoal | true

function exactProgramResources(resources: readonly ResourceId[], program?: ProgramChoice): readonly Resource[] {
  return typeof program === 'object' ? program.resources : programResourcesForResources(resources)
}

export function exerciseAvailable(
  exerciseId: string, resources: readonly ResourceId[], program?: ProgramChoice,
): boolean {
  const legacy = LEGACY_LIBRARY.exercises.find(item => item.id === exerciseId)
  if (!program && legacy) {
    const equipment = equipmentForResources(resources)
    return legacy.equipment.every(piece => piece === 'none' || equipment.includes(piece))
      && (specificRequirements.get(exerciseId) ?? []).every(id => resources.includes(id))
  }
  const library = typeof program === 'object' ? resolveProgramLibrary(program) : DEFAULT_LIBRARY
  const exercise = library.exercises.find(item => item.id === exerciseId)
  const requirements = exercise?.highSkill === false
    ? exercise.requirements
    : SUPPORTED_SPORT_DRILLS.find(drill => drill.id === exerciseId)?.requirements
  return requirements !== undefined
    && equipmentAvailable(requirements, exactProgramResources(resources, program))
}

export function availableProgramExercises(
  resources: readonly ResourceId[], program?: ProgramConfigV1,
): readonly ExerciseMetadata[] {
  return availableExerciseMetadata(
    program ? program.resources : programResourcesForResources(resources),
    resolveProgramLibrary(program),
  )
}

export function maxExerciseSelection(program?: ProgramConfigV1): number {
  return program ? PROGRAM_POLICY.maxSelectedExercises : RECOMMENDATION_POLICY.maxExercises
}

export function recommendForResources(
  resources: readonly ResourceId[], program?: ProgramConfigV1 | ProgramGoal,
): string[] {
  if (program) {
    const goal = typeof program === 'string' ? program : program.goal
    const exactResources = typeof program === 'string' ? programResourcesForResources(resources) : program.resources
    return [...recommendProgram(
      exactResources, goal, typeof program === 'object' ? resolveProgramLibrary(program) : DEFAULT_LIBRARY,
      typeof program === 'object' ? program.selectedExerciseIds : undefined,
      typeof program === 'object' && program.includeMobility === true,
    ).exerciseIds]
  }
  const available = RECOMMENDATION_POLICY.supportedExerciseIds.flatMap(id => {
    const exercise = LEGACY_LIBRARY.exercises.find(item => item.id === id)
    return exercise && !exercise.highSkill && exerciseAvailable(id, resources) ? [exercise] : []
  })

  // Keep the engine's routine and dose policy; replace missing kit only within a checked movement pattern.
  return recommendedExercises(equipmentForResources(resources)).flatMap(id => {
    const original = LEGACY_LIBRARY.exercises.find(exercise => exercise.id === id)
    const choice = available.find(exercise => exercise.id === id)
      ?? available.find(exercise => exercise.pattern === original?.pattern)
    return choice ? [choice.id] : []
  })
}
