import { RECOMMENDATION_POLICY } from './constants.ts'
import { LEGACY_LIBRARY } from './library.ts'
import type { Equipment, TargetRPE } from './types.ts'

export function recommendedExercises(equipment: readonly Equipment[]): readonly string[] {
  const available: readonly Equipment[] = equipment.length ? equipment : ['bodyweight']
  const routine = available.includes('barbell') ? RECOMMENDATION_POLICY.gymRoutine
    : available.includes('dumbbell') ? RECOMMENDATION_POLICY.dumbbellRoutine : RECOMMENDATION_POLICY.bodyweightRoutine
  return routine.filter(id => {
    const exercise = LEGACY_LIBRARY.exercises.find(item => item.id === id)
    return exercise && !exercise.highSkill && exercise.equipment.every(item => item === 'none' || available.includes(item))
  })
}

/** A policy ceiling for a new exercise; calendar reductions can prescribe fewer sets. */
export function recommendationForExercise(exerciseId: string): { sets: number; reps: number; targetRPE: TargetRPE } {
  const exercise = LEGACY_LIBRARY.exercises.find(item => item.id === exerciseId)
  if (!exercise || exercise.highSkill || !(RECOMMENDATION_POLICY.supportedExerciseIds as readonly string[]).includes(exerciseId)) {
    throw new Error('Choose a supported, non-high-skill exercise from the recommended catalog.')
  }
  return { sets: RECOMMENDATION_POLICY.sets, reps: RECOMMENDATION_POLICY.reps, targetRPE: RECOMMENDATION_POLICY.targetRPE }
}

export {
  availableExerciseMetadata, availableSportDrills, exerciseDefaultPrescription, exerciseMetadata,
  EXERCISE_METADATA, recommendProgram, resolvedConditioningBaselines, SUPPORTED_SPORT_DRILLS,
} from './program.ts'
