import { LIMITS, PROGRAM_LIBRARY_VERSION, PROGRAM_POLICY } from '../../engine/constants.ts'
import { DEFAULT_LIBRARY } from '../../engine/library.ts'
import { availableExerciseMetadata, exerciseMetadata, recommendProgram } from '../../engine/program.ts'
import type { ProgramGoal } from '../../engine/types.ts'
import { equipmentForResources, parseResources, programResources, resourcesForEquipment } from './equipment.ts'
import type { ExerciseChoice } from './ExercisePoolEditor.tsx'
import type { CampaignDraft, GoalKind } from './types.ts'

const VARIANT_FAMILIES: Readonly<Record<string, string>> = {
  'back-squat-slow-lowering': 'back-squat',
  'split-squat-slow-lowering': 'split-squat',
  'goblet-squat-fast-concentric': 'goblet-squat',
  'dumbbell-bench-press-fast-concentric': 'dumbbell-bench-press',
}

export const PROGRAM_GOAL_LABELS: Readonly<Record<ProgramGoal, string>> = {
  balanced: 'Balanced run + lift',
  strength: 'Strength-led',
  endurance: 'Running support',
  dodgeball: 'Dodgeball support',
}

export function programGoalForKind(kind: GoalKind): ProgramGoal {
  return kind === 'dodgeball' ? 'dodgeball' : kind === 'running' ? 'endurance' : 'balanced'
}

export function enableTemplateProgramming(draft: CampaignDraft): CampaignDraft {
  if (!draft.recommendedSetup) throw new Error('Set up a recommended exercise selection before enabling templates.')
  const resources = parseResources(draft.resources ?? resourcesForEquipment(draft.equipment))
  const capabilities = programResources(resources)
  const goal = programGoalForKind(draft.goalKind)
  const recommendation = recommendProgram(capabilities, goal)
  return {
    ...draft, resources: [...resources], equipment: equipmentForResources(resources), confirmed: false,
    program: {
      version: 1, libraryVersion: PROGRAM_LIBRARY_VERSION, goal, resources: capabilities,
      conditioningBaselines: [], selectedExerciseIds: [...recommendation.exerciseIds],
    },
    recommendedSetup: { ...draft.recommendedSetup, exerciseIds: [...recommendation.exerciseIds] },
  }
}

export function programmingChoices(draft: CampaignDraft): ExerciseChoice[] {
  if (!draft.program) throw new Error('Enable template programming before editing its exercise pool.')
  return availableExerciseMetadata(programResources(draft.resources ?? resourcesForEquipment(draft.equipment))).map(metadata => {
    const exercise = DEFAULT_LIBRARY.exercises.find(item => item.id === metadata.id)
    if (!exercise) throw new Error('Template metadata is missing its canonical exercise.')
    const dose = metadata.profile.prescription
    const tempo = metadata.execution.eccentricSeconds === undefined ? '' : `; lower for ${metadata.execution.eccentricSeconds} seconds`
    return {
      exercise,
      family: VARIANT_FAMILIES[metadata.id] ?? metadata.id,
      execution: metadata.execution.label,
      prescription: dose.unit === 'reps'
        ? `Up to ${dose.sets} sets x ${dose.reps} reps at RPE ${dose.targetRPE}${tempo}`
        : `Up to ${dose.sets} bouts x ${dose.seconds} seconds; controlled, no RIR target`,
    }
  })
}

export function selectProgramExercises(draft: CampaignDraft, ids: readonly string[]): CampaignDraft {
  if (!draft.program || !draft.recommendedSetup) throw new Error('Enable templates before selecting a program exercise.')
  if (ids.length < PROGRAM_POLICY.minSelectedExercises || ids.length > LIMITS.maxProgramExercises || new Set(ids).size !== ids.length) {
    throw new Error(`Choose ${PROGRAM_POLICY.minSelectedExercises} to ${LIMITS.maxProgramExercises} distinct supported movements.`)
  }
  const choices = new Set(programmingChoices(draft).map(item => item.exercise.id))
  if (ids.some(id => !choices.has(id))) throw new Error('Each selected movement needs its stated equipment and execution template.')
  for (const id of ids) exerciseMetadata(id)
  return {
    ...draft, confirmed: false,
    program: { ...draft.program, selectedExerciseIds: [...ids] },
    recommendedSetup: { ...draft.recommendedSetup, exerciseIds: [...ids] },
  }
}
