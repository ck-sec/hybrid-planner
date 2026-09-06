import catalog from './exercises-v1.json' with { type: 'json' }
import type {
  CustomExerciseProfileId, CustomExerciseSpec, Equipment, ExecutionProfile, Exercise, ExerciseProfile, TargetRPE,
} from './types.ts'

export interface CustomExerciseWorkloadProfile {
  version: 1
  id: CustomExerciseProfileId
  label: string
  template: NonNullable<Exercise['template']>
  pattern: Exercise['pattern']
  competesWithRunning: boolean
  profile: ExerciseProfile
  execution: ExecutionProfile
  sourceExerciseIds: readonly string[]
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function workload(
  id: CustomExerciseProfileId, label: string, template: NonNullable<Exercise['template']>,
  pattern: Exercise['pattern'], unit: 'reps' | 'seconds',
): CustomExerciseWorkloadProfile {
  const relevant = catalog.exercises.filter(exercise => exercise.template === template
    && !exercise.highSkill && exercise.profile.prescription.unit === unit)
  const controlled = relevant.filter(exercise =>
    !exercise.id.endsWith('-slow-lowering') && !exercise.id.endsWith('-fast-concentric'))
  // Reuse the largest existing estimate on each axis, and the smallest controlled
  // dose in that template. These are scheduling policies, not novel physiology.
  const schedulingEstimate = {
    systemic: Math.max(...relevant.map(exercise => exercise.coefficients.systemic)),
    structural: Math.max(...relevant.map(exercise => exercise.coefficients.structural)),
  }
  const sets = Math.min(...controlled.map(exercise => exercise.profile.prescription.sets))
  const prescription: ExerciseProfile['prescription'] = unit === 'reps'
    ? {
      unit, sets, reps: Math.min(...controlled.map(exercise => exercise.profile.prescription.reps!)),
      targetRPE: Math.min(...controlled.map(exercise => exercise.profile.prescription.targetRPE!)) as TargetRPE,
    }
    : { unit, sets, seconds: Math.min(...controlled.map(exercise => exercise.profile.prescription.seconds!)) }
  return freeze<CustomExerciseWorkloadProfile>({
    version: 1, id, label, template, pattern,
    competesWithRunning: relevant.some(exercise => exercise.competesWithRunning),
    profile: { version: 'scheduling-estimate-1', schedulingEstimate, prescription },
    execution: {
      style: 'controlled',
      label: unit === 'reps' ? 'Controlled repetitions'
        : template === 'carry' ? 'Controlled carry' : 'Comfortable controlled hold',
      ...(unit === 'reps' ? { eccentricSeconds: 2 } : {}),
      concentricIntent: unit === 'reps' ? 'controlled' : 'not_applicable',
      ballistic: false,
    },
    sourceExerciseIds: relevant.map(exercise => exercise.id).sort(),
  })
}

/** A closed, versioned workload menu. Names cannot make an arbitrary movement safe. */
export const CUSTOM_EXERCISE_PROFILES: Readonly<Record<CustomExerciseProfileId, CustomExerciseWorkloadProfile>> = freeze({
  controlled_squat: workload('controlled_squat', 'Controlled squat', 'squat', 'knee_dominant', 'reps'),
  controlled_hinge: workload('controlled_hinge', 'Controlled hinge', 'hinge', 'hip_dominant', 'reps'),
  controlled_push: workload('controlled_push', 'Controlled push', 'push', 'horizontal_push', 'reps'),
  controlled_pull: workload('controlled_pull', 'Controlled pull', 'pull', 'horizontal_pull', 'reps'),
  controlled_unilateral: workload('controlled_unilateral', 'Controlled unilateral', 'unilateral', 'unilateral_lower', 'reps'),
  controlled_core: workload('controlled_core', 'Controlled core', 'core', 'core', 'reps'),
  controlled_rotation: workload('controlled_rotation', 'Controlled rotation', 'rotation', 'rotational', 'reps'),
  timed_carry: workload('timed_carry', 'Controlled timed carry', 'carry', 'carry', 'seconds'),
  timed_mobility: workload('timed_mobility', 'Controlled timed mobility', 'mobility', 'core', 'seconds'),
})

export const CUSTOM_EXERCISE_PROFILE_LIST: readonly CustomExerciseWorkloadProfile[] =
  Object.freeze(Object.values(CUSTOM_EXERCISE_PROFILES))

/** Internal materializer: callers validate the spec and its confirmed resources first. */
export function materializeCustomExercise(spec: CustomExerciseSpec): Exercise {
  const workload = CUSTOM_EXERCISE_PROFILES[spec.profileId]
  const equipment = spec.requirements.filter((resource): resource is Equipment =>
    ['barbell', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'bands', 'none'].includes(resource))
  return {
    id: spec.id, name: spec.name, label: spec.name, pattern: workload.pattern,
    equipment: equipment.length ? equipment : ['none'],
    coefficients: { ...workload.profile.schedulingEstimate },
    competesWithRunning: workload.competesWithRunning, highSkill: false,
    requirements: [...spec.requirements], template: workload.template,
    profile: {
      version: workload.profile.version,
      schedulingEstimate: { ...workload.profile.schedulingEstimate },
      prescription: { ...workload.profile.prescription },
    },
    custom: { ...spec, requirements: [...spec.requirements] },
  }
}
