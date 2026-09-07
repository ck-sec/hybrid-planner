import {
  ANCHOR_RPE_RANGE, DELOAD_EVERY_N_WEEKS, DELOAD_VOLUME_FRACTION,
  ENGINE_VERSION, LEGACY_EXERCISE_IDS, LIBRARY_VERSION, LIMITS, NOVICE_MONTHS_THRESHOLD,
  NOVICE_RPE_MAX, POLICY_VERSION, PROGRAM_LIBRARY_VERSION, PROGRAM_POLICY_VERSION,
  RECOMMENDATION_POLICY, TAPER_WEEKS_DEFAULT,
} from './constants.ts'
import { dayNumber, dayOfWeek, parseISODate } from './dates.ts'
import type { AnchorAssignment, AthleteState, Block, ExerciseLibrary, Goal, Phase, PhaseKind, TargetRPE } from './types.ts'
import { recommendProgram } from './program.ts'
import { InputError, parseAthleteWithOptions, parseGoal, parseLibrary } from './validation.ts'
import type { ValidationOptions } from './validation.ts'

function identifier(text: string): string {
  let hash = 2166136261
  for (const character of text) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Advisory opt-in changes fact parsing only; templates remain the legacy scaffold, not an AI week. */
export function generateBlock(
  rawAthlete: AthleteState,
  rawGoal: Goal,
  startDate: string,
  rawLibrary: ExerciseLibrary,
  options: ValidationOptions = {},
): Block {
  const athlete = parseAthleteWithOptions(rawAthlete, options)
  if (options.policy === 'ai-advisory' && !athlete.program) {
    throw new InputError(['Advisory block scaffolding requires an opt-in program; legacy generation is unchanged.'])
  }
  const goal = parseGoal(rawGoal)
  const library = parseLibrary(rawLibrary, athlete.program, options)
  parseISODate(startDate)
  if (dayOfWeek(startDate) !== 0) throw new InputError(['Blocks must begin on a Monday (day 0).'])
  if (dayNumber(athlete.baseline.asOf) > dayNumber(startDate)) throw new InputError(['The baseline cannot be observed after the block begins.'])
  const totalWeeks = Math.floor((dayNumber(goal.peakDate) - dayNumber(startDate)) / 7) + 1
  if (totalWeeks < 1 || totalWeeks > LIMITS.maxWeeks) throw new InputError([`The goal must fall within ${LIMITS.maxWeeks} weeks of the block start.`])
  if (athlete.program) {
    if (library.version !== PROGRAM_LIBRARY_VERSION || athlete.program.libraryVersion !== PROGRAM_LIBRARY_VERSION) {
      throw new InputError(['Opt-in programming requires the extensible exercise library version.'])
    }
    if (athlete.program.goal === 'dodgeball' && athlete.program.comfortableThrowsPerPractice !== undefined
      && !goal.fixedCommitments.some(commitment =>
      commitment.discipline === 'sport' && commitment.modality === 'court_sport')) {
      throw new InputError(['Dodgeball programming requires an established fixed court practice; technique is never added as a separate session.'])
    }
  } else if (![LIBRARY_VERSION, PROGRAM_LIBRARY_VERSION].includes(library.version)) {
    throw new InputError(['The exercise library version is not supported.'])
  }
  const issues: string[] = []
  const anchors: AnchorAssignment[] = []
  if (athlete.program) {
    let recommendation
    try {
      recommendation = recommendProgram(
        athlete.program.resources, athlete.program.goal, library, athlete.program.selectedExerciseIds,
        athlete.program.includeMobility,
      )
    } catch (error) {
      throw new InputError([error instanceof Error ? error.message : 'Unable to build the selected program.'])
    }
    const program = { ...athlete.program, selectedExerciseIds: recommendation.exerciseIds }
    const phases = buildPhases(totalWeeks)
    return {
      id: `block-${startDate}-${identifier(JSON.stringify({ goal, program, workoutTemplates: recommendation.templates, phases }))}`,
      engineVersion: ENGINE_VERSION,
      policyVersion: PROGRAM_POLICY_VERSION,
      libraryVersion: PROGRAM_LIBRARY_VERSION,
      startDate,
      totalWeeks,
      goal,
      phases,
      anchors,
      program,
      workoutTemplates: recommendation.templates,
    }
  }
  const observations = [...athlete.baseline.exercises]
    .filter(item => !athlete.recommendedExerciseIds || athlete.recommendedExerciseIds.includes(item.exerciseId))
    .sort((a, b) => a.exerciseId < b.exerciseId ? -1 : 1)
  for (const observation of observations) {
    const exercise = library.exercises.find(item => item.id === observation.exerciseId
      && (library.version !== PROGRAM_LIBRARY_VERSION || (LEGACY_EXERCISE_IDS as readonly string[]).includes(item.id)))
    if (!exercise) { issues.push(`Unknown exercise: ${observation.exerciseId}.`); continue }
    if (exercise.highSkill) {
      if (goal.protectedExerciseIds.includes(exercise.id)) issues.push(`${exercise.name} can be logged and costed but is not prescribed by this engine.`)
      continue
    }
    if (exercise.equipment.some(item => !athlete.equipment.includes(item) && item !== 'none')) {
      issues.push(`Your equipment does not support ${exercise.name}.`)
      continue
    }
    const cap = observation.experienceMonths < NOVICE_MONTHS_THRESHOLD ? NOVICE_RPE_MAX : ANCHOR_RPE_RANGE[1]
    anchors.push({
      exerciseId: exercise.id,
      pattern: exercise.pattern,
      sets: observation.sets,
      reps: observation.reps,
      targetRPE: Math.min(observation.actualRPE, cap) as TargetRPE,
      role: goal.protectedExerciseIds.includes(exercise.id) || !['core', 'rotational', 'carry'].includes(exercise.pattern)
        ? 'anchor' : 'accessory',
    })
  }
  for (const id of athlete.recommendedExerciseIds ?? []) {
    if (observations.some(item => item.exerciseId === id)) continue
    const exercise = library.exercises.find(item => item.id === id)
    if (!exercise || exercise.highSkill || !(RECOMMENDATION_POLICY.supportedExerciseIds as readonly string[]).includes(id)) {
      issues.push(`Exercise ${id} is not supported by the first-exposure recommendation policy.`)
      continue
    }
    if (exercise.equipment.some(item => item !== 'none' && !athlete.equipment.includes(item))) {
      issues.push(`Your equipment does not support ${exercise.name}.`)
      continue
    }
    anchors.push({
      exerciseId: id, pattern: exercise.pattern,
      sets: RECOMMENDATION_POLICY.sets, reps: RECOMMENDATION_POLICY.reps, targetRPE: RECOMMENDATION_POLICY.targetRPE,
      role: goal.protectedExerciseIds.includes(id) || !['core', 'rotational', 'carry'].includes(exercise.pattern) ? 'anchor' : 'accessory',
      provenance: { kind: 'recommended', policyVersion: RECOMMENDATION_POLICY.version },
    })
  }
  if (athlete.recommendedExerciseIds) anchors.sort((a, b) => a.exerciseId < b.exerciseId ? -1 : a.exerciseId > b.exerciseId ? 1 : 0)
  for (const id of goal.protectedExerciseIds) {
    if (!anchors.some(anchor => anchor.exerciseId === id)) issues.push(`Protected exercise ${id} needs an eligible, established observation.`)
  }
  if (!anchors.length) issues.push(athlete.recommendedExerciseIds
    ? 'Choose at least one equipped, supported recommended exercise.'
    : 'At least one established, equipped, non-high-skill exercise is required. High-skill exercises are not prescribed.')
  if (issues.length) throw new InputError(issues)

  const phases = buildPhases(totalWeeks)
  return {
    id: `block-${startDate}-${identifier(JSON.stringify({ goal, anchors, phases }))}`,
    engineVersion: ENGINE_VERSION,
    policyVersion: POLICY_VERSION,
    libraryVersion: LIBRARY_VERSION,
    startDate,
    totalWeeks,
    goal,
    phases,
    anchors,
  }
}

function buildPhases(totalWeeks: number): Phase[] {
  const phases: Phase[] = []
  const taperStart = Math.max(1, totalWeeks - TAPER_WEEKS_DEFAULT)
  for (let week = 0; week < totalWeeks; week++) {
    let kind: PhaseKind = week < Math.ceil(taperStart / 2) ? 'base' : 'build'
    if (totalWeeks >= 4 && week >= taperStart) kind = 'taper'
    else if (totalWeeks >= 5 && week === taperStart - 1) kind = 'peak'
    else if ((week + 1) % DELOAD_EVERY_N_WEEKS === 0) kind = 'deload'
    const volumeFraction = kind === 'taper' || kind === 'deload' ? DELOAD_VOLUME_FRACTION : 1
    const last = phases.at(-1)
    if (last?.kind === kind) last.endWeekIndex = week
    else phases.push({ kind, startWeekIndex: week, endWeekIndex: week, volumeFraction })
  }
  return phases
}
