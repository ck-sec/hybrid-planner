import { PROGRAM_POLICY, RECOMMENDATION_POLICY } from '../../engine/constants.ts'
import { DEFAULT_LIBRARY, LEGACY_LIBRARY } from '../../engine/library.ts'
import { availableExerciseMetadata, recommendProgram, SUPPORTED_SPORT_DRILLS } from '../../engine/program.ts'
import type { ExerciseMetadata } from '../../engine/program.ts'
import { recommendedExercises } from '../../engine/recommendations.ts'
import type { Equipment, ProgramConfigV1, ProgramGoal, Resource } from '../../engine/types.ts'

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
  { id: 'stable_step', label: 'Stable step', group: 'strength' },
  { id: 'floor_space', label: 'Floor space', group: 'strength' },
  { id: 'anchor_point', label: 'Secure band anchor', group: 'strength' },
  { id: 'carry_space', label: 'Clear carry space', group: 'strength' },
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
  { id: 'safe_target', label: 'Safe throwing target', group: 'sport' },
] as const satisfies readonly { id: string; label: string; group: ResourceGroup }[]

export type ResourceId = (typeof RESOURCE_CATALOG)[number]['id']

export const RESOURCE_PRESETS = [
  { label: 'No kit', resources: ['floor_space'] },
  { label: 'Home', resources: ['bands', 'dumbbell', 'floor_space'] },
  { label: 'Gym', resources: ['bands', 'barbell', 'cable', 'dumbbell', 'floor_space', 'kettlebell', 'machine'] },
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
const PROGRAM_RESOURCE_IDS = new Set<Resource>([
  'barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bands',
  'bench', 'rack', 'pull_up_bar', 'stable_step', 'floor_space', 'anchor_point',
  'carry_space', 'dodgeball', 'court_space', 'safe_target',
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

/** Convert app capabilities to the exact resources understood by the opt-in program engine. */
export function programResourcesForResources(resources: readonly ResourceId[]): Resource[] {
  const parsed = parseResources(resources)
  const projected = new Set<Resource>(['bodyweight'])
  for (const id of parsed) {
    if (PROGRAM_RESOURCE_IDS.has(id as Resource)) projected.add(id as Resource)
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
  const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === exerciseId)
  const requirements = exercise?.highSkill === false
    ? exercise.requirements
    : SUPPORTED_SPORT_DRILLS.find(drill => drill.id === exerciseId)?.requirements
  return requirements !== undefined
    && equipmentAvailable(requirements, exactProgramResources(resources, program))
}

export function availableProgramExercises(
  resources: readonly ResourceId[], program?: ProgramConfigV1,
): readonly ExerciseMetadata[] {
  return availableExerciseMetadata(program ? program.resources : programResourcesForResources(resources))
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
      exactResources, goal, DEFAULT_LIBRARY, undefined,
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
