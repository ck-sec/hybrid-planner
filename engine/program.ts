import { PROGRAM_LIBRARY_VERSION, PROGRAM_POLICY } from './constants.ts'
import { DEFAULT_LIBRARY } from './library.ts'
import { CUSTOM_EXERCISE_PROFILES } from './custom-exercise-profiles.ts'
import type {
  AthleteState, ConditioningBaseline, CustomExerciseSpec, ExecutionProfile, Exercise, ExerciseLibrary, ExerciseProfile,
  FrozenWorkoutTemplate, ProgramGoal, Resource, SportDrillMetadata,
} from './types.ts'

const GOAL_ORDER: Readonly<Record<ProgramGoal, readonly string[]>> = {
  balanced: [
    'goblet-squat', 'kettlebell-goblet-squat', 'bodyweight-squat', 'back-squat', 'leg-press',
    'romanian-deadlift', 'dumbbell-romanian-deadlift', 'kettlebell-deadlift',
    'push-up', 'dumbbell-bench-press', 'kettlebell-floor-press', 'bench-press', 'machine-chest-press',
    'dumbbell-row', 'kettlebell-row', 'band-row', 'cable-row', 'machine-row',
    'bodyweight-split-squat', 'split-squat', 'dead-bug', 'front-plank',
    'dumbbell-farmer-carry', 'kettlebell-suitcase-carry',
  ],
  endurance: [
    'bodyweight-split-squat', 'split-squat', 'step-up', 'calf-raise',
    'dumbbell-romanian-deadlift', 'kettlebell-deadlift', 'romanian-deadlift',
    'push-up', 'band-row', 'dumbbell-row', 'kettlebell-row',
    'dead-bug', 'bird-dog', 'front-plank', 'dumbbell-farmer-carry', 'kettlebell-suitcase-carry',
  ],
  strength: [
    'back-squat', 'front-squat', 'leg-press', 'goblet-squat', 'kettlebell-goblet-squat',
    'deadlift', 'romanian-deadlift', 'dumbbell-romanian-deadlift', 'kettlebell-deadlift',
    'bench-press', 'dumbbell-bench-press', 'kettlebell-floor-press', 'overhead-press',
    'dumbbell-row', 'kettlebell-row', 'cable-row', 'pull-up', 'lat-pulldown',
  ],
  dodgeball: [
    'bodyweight-split-squat', 'split-squat', 'goblet-squat', 'kettlebell-goblet-squat',
    'dumbbell-romanian-deadlift', 'kettlebell-deadlift',
    'push-up', 'dumbbell-bench-press', 'kettlebell-floor-press',
    'dumbbell-row', 'kettlebell-row', 'band-row', 'cable-row',
    'band-face-pull', 'cable-face-pull', 'band-pallof-press', 'pallof-press',
    'dead-bug', 'dumbbell-farmer-carry', 'kettlebell-suitcase-carry',
  ],
}

function supports(exercise: Exercise, resources: ReadonlySet<Resource>): boolean {
  return exercise.highSkill === false && exercise.profile !== undefined && exercise.requirements !== undefined
    && exercise.requirements.every(resource => resources.has(resource))
}

function pick(
  exercises: readonly Exercise[], used: Set<string>, templates: readonly Exercise['template'][],
): Exercise | undefined {
  return exercises.find(exercise => !used.has(exercise.id) && templates.includes(exercise.template))
}

function template(label: FrozenWorkoutTemplate['label'], exercises: readonly Exercise[]): FrozenWorkoutTemplate {
  return { label, exerciseIds: exercises.map(exercise => exercise.id) }
}

export interface ProgramRecommendation {
  libraryVersion: typeof PROGRAM_LIBRARY_VERSION
  exerciseIds: readonly string[]
  templates: readonly FrozenWorkoutTemplate[]
}

/** Canonical conditioning union used by both planning and the independent safety floor. */
export function resolvedConditioningBaselines(athlete: AthleteState): readonly ConditioningBaseline[] {
  if (!athlete.program) return []
  const explicitRuns = athlete.program.conditioningBaselines.filter(item =>
    item.modality === 'run_road' || item.modality === 'run_trail')
  const running: readonly ConditioningBaseline[] = explicitRuns.length ? explicitRuns : [{
    modality: 'run_road',
    weeklyMinutes: athlete.baseline.weeklyRunMinutes,
    longestSessionMinutes: athlete.baseline.longestRunMinutes,
    sessionsPerWeek: athlete.baseline.runsPerWeek,
  }]
  return [...running, ...athlete.program.conditioningBaselines.filter(item =>
    item.modality !== 'run_road' && item.modality !== 'run_trail')]
}

/** Deterministic, curated selection. Resources and goal are data, never AI-assigned profiles. */
export function recommendProgram(
  resources: readonly Resource[],
  goal: ProgramGoal,
  library: ExerciseLibrary = DEFAULT_LIBRARY,
  selectedExerciseIds?: readonly string[],
  includeMobility = false,
): ProgramRecommendation {
  if (library.version !== PROGRAM_LIBRARY_VERSION) throw new Error('Program recommendations require the extensible exercise library.')
  const available = new Set(resources)
  const byId = new Map(library.exercises.map(exercise => [exercise.id, exercise]))
  const requested = selectedExerciseIds ?? GOAL_ORDER[goal]
  const ordered = requested.map(id => byId.get(id)).filter((exercise): exercise is Exercise =>
    exercise !== undefined && supports(exercise, available))
  if (selectedExerciseIds && ordered.length !== selectedExerciseIds.length) {
    throw new Error('Every selected exercise must exist, have a reviewed profile, and match the supplied resources.')
  }
  if (selectedExerciseIds && (selectedExerciseIds.length < PROGRAM_POLICY.minSelectedExercises
    || selectedExerciseIds.length > PROGRAM_POLICY.maxSelectedExercises)) {
    throw new Error(`Select ${PROGRAM_POLICY.minSelectedExercises} to ${PROGRAM_POLICY.maxSelectedExercises} exercises for the frozen A/B templates; no selected exercise is silently omitted.`)
  }
  if (selectedExerciseIds && new Set(selectedExerciseIds).size !== selectedExerciseIds.length) {
    throw new Error('Selected exercises must have unique IDs; no duplicate selection is silently omitted.')
  }
  const selected: Exercise[] = []
  const add = (exercise: Exercise | undefined): void => {
    if (exercise && !selected.some(item => item.id === exercise.id)
      && selected.length < PROGRAM_POLICY.maxSelectedExercises) selected.push(exercise)
  }
  if (selectedExerciseIds) {
    for (const exercise of ordered) add(exercise)
  } else {
    for (const slots of [
      ['squat', 'unilateral'], ['hinge'], ['push'], ['pull'], ['core', 'rotation'], ['carry'],
    ] as const) add(pick(ordered, new Set(selected.map(item => item.id)), slots))
    const automaticLimit = includeMobility ? PROGRAM_POLICY.maxSelectedExercises - 1 : PROGRAM_POLICY.maxSelectedExercises
    for (const exercise of ordered) {
      if (selected.length >= automaticLimit) break
      add(exercise)
    }
  }
  if (includeMobility) {
    const mobility = selected.find(exercise => exercise.template === 'mobility')
      ?? library.exercises.find(exercise => exercise.template === 'mobility' && supports(exercise, available))
    if (!mobility) throw new Error('Optional mobility requires an equipped, reviewed mobility exercise.')
    if (!selected.some(exercise => exercise.id === mobility.id)
      && selected.length >= PROGRAM_POLICY.maxSelectedExercises) {
      throw new Error(`Optional mobility leaves room for at most ${PROGRAM_POLICY.maxSelectedExercises - 1} other selected exercises; no selection is silently omitted.`)
    }
    add(mobility)
  }
  if (selected.length < PROGRAM_POLICY.minSelectedExercises) {
    throw new Error(`Resources must support at least ${PROGRAM_POLICY.minSelectedExercises} selected movements for differentiated A/B templates.`)
  }

  const anchor = pick(selected, new Set(), ['squat', 'unilateral', 'hinge']) ?? selected[0]!
  const a: Exercise[] = [anchor]
  const b: Exercise[] = [anchor]
  selected.filter(exercise => exercise.id !== anchor.id).forEach((exercise, index) => {
    (index % 2 === 0 ? a : b).push(exercise)
  })
  for (const target of [a, b]) {
    for (const exercise of selected) {
      if (target.length >= 3) break
      if (!target.some(item => item.id === exercise.id)) target.push(exercise)
    }
  }

  const frozenPool = [...new Set([...a, ...b].map(exercise => exercise.id))]
  if (frozenPool.length !== selected.length) {
    throw new Error('The selected exercise pool does not fit the bounded A/B templates; no selected exercise is silently omitted.')
  }
  return {
    libraryVersion: PROGRAM_LIBRARY_VERSION,
    exerciseIds: frozenPool,
    templates: [template('Strength A', a), template('Strength B', b)],
  }
}

export const SUPPORTED_SPORT_DRILLS: readonly SportDrillMetadata[] = Object.freeze([Object.freeze({
  id: 'dodgeball-controlled-target-throw',
  label: 'Controlled target throws',
  sport: 'dodgeball',
  unit: 'throws',
  requirements: Object.freeze(['dodgeball', 'court_space', 'safe_target'] as Resource[]),
  intent: 'controlled_technique',
})])

export function availableSportDrills(resources: readonly Resource[]): readonly SportDrillMetadata[] {
  return SUPPORTED_SPORT_DRILLS.filter(drill => drill.requirements.every(resource => resources.includes(resource)))
}

export interface ExerciseMetadata {
  id: string
  label: string
  unit: ExerciseProfile['prescription']['unit']
  requirements: readonly Resource[]
  template: NonNullable<Exercise['template']>
  profile: ExerciseProfile
  description: string
  focusCues: readonly string[]
  purpose: string
  execution: ExecutionProfile
  custom?: CustomExerciseSpec
}

const CONTENT: Readonly<Record<NonNullable<Exercise['template']>, {
  description: string
  focusCues: readonly string[]
  purpose: string
}>> = {
  squat: {
    description: 'A squat-pattern strength movement performed through a controlled, repeatable range.',
    focusCues: ['Keep the whole foot supported.', 'Track the knees in line with the feet.', 'Stop before position or speed degrades.'],
    purpose: 'Builds a dependable knee-dominant strength base for mixed training.',
  },
  hinge: {
    description: 'A hip-hinge strength movement with a braced trunk and controlled load path.',
    focusCues: ['Brace before moving.', 'Send the hips back while keeping the load close.', 'Finish tall without leaning back.'],
    purpose: 'Develops posterior-chain strength with an auditable, submaximal dose.',
  },
  push: {
    description: 'An upper-body pressing movement performed with stable joints and repeatable control.',
    focusCues: ['Set the shoulder blades and trunk.', 'Use a comfortable range.', 'Stop before technique changes.'],
    purpose: 'Builds general pressing capacity that complements running or field sport.',
  },
  pull: {
    description: 'An upper-body pulling movement performed without momentum or shortened range.',
    focusCues: ['Keep the torso stable.', 'Lead with the elbows.', 'Return under control.'],
    purpose: 'Builds upper-back pulling capacity and balances pressing work.',
  },
  unilateral: {
    description: 'A single-leg strength movement performed with stable foot, knee, and pelvis positions.',
    focusCues: ['Keep the working foot supported.', 'Control knee tracking.', 'Use support when balance limits the target muscles.'],
    purpose: 'Builds unilateral lower-body capacity without adding ballistic contacts.',
  },
  carry: {
    description: 'A loaded carry prescribed by working seconds rather than repetitions.',
    focusCues: ['Stand tall and keep ribs stacked.', 'Walk with controlled steps.', 'Stop if grip changes posture.'],
    purpose: 'Builds trunk and grip endurance while preserving the correct timed unit.',
  },
  core: {
    description: 'A controlled trunk exercise using repeatable positions rather than maximal effort.',
    focusCues: ['Breathe without losing position.', 'Move only through a controlled range.', 'Stop before compensation.'],
    purpose: 'Builds trunk control that supports lifting and sport practice.',
  },
  rotation: {
    description: 'A controlled rotation or anti-rotation exercise with a stable lower body.',
    focusCues: ['Set the pelvis before moving.', 'Use the trunk rather than arm momentum.', 'Return under control.'],
    purpose: 'Builds controlled trunk force transfer without prescribing throwing volume.',
  },
  mobility: {
    description: 'A low-load mobility position prescribed by seconds, not repetitions or RPE.',
    focusCues: ['Use a comfortable range.', 'Breathe normally.', 'Do not force end range.'],
    purpose: 'Provides optional movement practice inside the existing session time.',
  },
}

function executionFor(exercise: Exercise): ExecutionProfile {
  if (exercise.custom) return { ...CUSTOM_EXERCISE_PROFILES[exercise.custom.profileId].execution }
  if (exercise.highSkill) {
    return {
      style: 'ballistic_logging_only', label: 'Ballistic — logging only',
      concentricIntent: 'fast', ballistic: true,
    }
  }
  if (exercise.id.endsWith('-slow-lowering')) {
    return {
      style: 'slow_lowering', label: '3-second lowering; controlled lift',
      eccentricSeconds: 3, concentricIntent: 'controlled', ballistic: false,
    }
  }
  if (exercise.id.endsWith('-fast-concentric')) {
    return {
      style: 'fast_concentric_intent', label: 'Controlled lowering; fast concentric intent',
      eccentricSeconds: 2, concentricIntent: 'fast', ballistic: false,
    }
  }
  return {
    style: 'controlled', label: exercise.template === 'mobility' ? 'Comfortable controlled hold'
      : exercise.template === 'carry' ? 'Controlled carry'
        : exercise.profile?.prescription.unit === 'seconds' ? 'Controlled hold' : 'Controlled repetitions',
    ...(exercise.profile?.prescription.unit === 'reps' ? { eccentricSeconds: 2 as const } : {}),
    concentricIntent: exercise.profile?.prescription.unit === 'seconds' ? 'not_applicable' : 'controlled',
    ballistic: false,
  }
}

function metadataFor(exercise: Exercise): ExerciseMetadata {
  if (!exercise.profile || !exercise.requirements || !exercise.template || !exercise.label) {
    throw new Error(`Exercise ${exercise.id} has no complete extensible metadata.`)
  }
  const content = CONTENT[exercise.template]
  const execution = executionFor(exercise)
  const variant = execution.style === 'slow_lowering'
    ? ' This canonical variant uses a fixed three-second lowering phase and has its own history and cost profile. It assumes neither a universal optimal tempo nor transferable loading from the conventional variant.'
    : execution.style === 'fast_concentric_intent'
      ? ' This canonical variant uses fast intent against load while staying controlled; intent does not prove bar speed, and it is not a jump or ballistic repetition.'
      : ''
  return {
    id: exercise.id, label: exercise.label, unit: exercise.profile.prescription.unit,
    requirements: [...exercise.requirements], template: exercise.template,
    profile: cloneProfile(exercise.profile),
    description: exercise.custom?.description ?? content.description + variant,
    focusCues: exercise.custom ? [exercise.custom.focus] : execution.style === 'slow_lowering'
      ? ['Lower for the full three seconds.', ...content.focusCues]
      : execution.style === 'fast_concentric_intent'
        ? ['Keep the lowering phase controlled.', 'Drive up with fast intent without leaving the support surface.', ...content.focusCues]
        : [...content.focusCues],
    purpose: exercise.custom?.why ?? content.purpose,
    execution,
    ...(exercise.custom ? { custom: { ...exercise.custom, requirements: [...exercise.custom.requirements] } } : {}),
  }
}

export const EXERCISE_METADATA: Readonly<Record<string, ExerciseMetadata>> = Object.freeze(
  Object.fromEntries(DEFAULT_LIBRARY.exercises.map(exercise => {
    const metadata = metadataFor(exercise)
    Object.freeze(metadata.requirements)
    Object.freeze(metadata.focusCues)
    Object.freeze(metadata.profile.schedulingEstimate)
    Object.freeze(metadata.profile.prescription)
    Object.freeze(metadata.profile)
    Object.freeze(metadata.execution)
    return [exercise.id, Object.freeze(metadata)]
  })),
)

export function availableExerciseMetadata(
  resources: readonly Resource[], library: ExerciseLibrary = DEFAULT_LIBRARY,
): readonly ExerciseMetadata[] {
  const available = new Set(resources)
  return library.exercises.filter(exercise => supports(exercise, available)).map(exercise => {
    const metadata = library === DEFAULT_LIBRARY ? EXERCISE_METADATA[exercise.id] : metadataFor(exercise)
    if (!metadata) throw new Error(`Exercise ${exercise.id} has no authored metadata.`)
    return metadata
  })
}

export function exerciseMetadata(exerciseId: string, library: ExerciseLibrary = DEFAULT_LIBRARY): ExerciseMetadata {
  if (library !== DEFAULT_LIBRARY) {
    const exercise = library.exercises.find(item => item.id === exerciseId)
    if (!exercise) throw new Error('Exercise has no supported program metadata.')
    return metadataFor(exercise)
  }
  const metadata = EXERCISE_METADATA[exerciseId]
  if (!metadata) throw new Error('Exercise has no supported built-in metadata.')
  return metadata
}

export function exerciseDefaultPrescription(
  exerciseId: string, library: ExerciseLibrary = DEFAULT_LIBRARY,
): ExerciseProfile {
  const exercise = library.exercises.find(item => item.id === exerciseId)
  if (!exercise?.profile || exercise.highSkill) throw new Error('Exercise has no supported prescription profile.')
  return cloneProfile(exercise.profile)
}

function cloneProfile(profile: ExerciseProfile): ExerciseProfile {
  return {
    version: profile.version,
    schedulingEstimate: { ...profile.schedulingEstimate },
    prescription: { ...profile.prescription },
  }
}
