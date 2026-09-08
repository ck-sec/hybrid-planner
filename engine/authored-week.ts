import {
  AI_ADVISORY_CONDITIONING_RESOURCES, AI_ADVISORY_LIMITS, AI_ADVISORY_POLICY_VERSION, CONTROLLED_TARGET_THROW_PROFILE, ENGINE_VERSION, HARD_SESSION_STRUCTURAL_THRESHOLD, HARD_SESSION_SYSTEMIC_THRESHOLD,
  LIMITS, PROGRAM_LIBRARY_VERSION, PROGRAM_POLICY, SAFETY,
} from './constants.ts'
import { addDays, dateForWeekday, dayNumber, dayOfWeek, sessionStartMinutes } from './dates.ts'
import { observedSessionWork, predictSessionLoad } from './load.ts'
import { hasCleanBlockObservation, hasCleanThrowObservation, latestPerformance } from './observations.ts'
import { availableSportDrills, exerciseMetadata, resolvedConditioningBaselines } from './program.ts'
import { checkSafety } from './safety.ts'
import { scoreSessions } from './scoring.ts'
import type {
  ConditioningModality, Load, PlanWeekInput, SafetyFloorResult, SafetyViolation, Session, SessionLog, TargetRPE, WeekPlan,
  WorkoutBlock, WorkoutSession,
} from './types.ts'
import { InputError, parsePlanWeekInputWithOptions, parsePlanningContextWithOptions, Validator } from './validation.ts'
import type { ValidationOptions } from './validation.ts'

export type AuthoredPolicyOptions = ValidationOptions

export interface AuthoredSessionValidationResult extends SafetyFloorResult {
  /** Present only for explicitly opted-in advisory validation; never hard failures. */
  advisories?: SafetyViolation[]
}

export const AUTHORED_WEEK_POLICY = Object.freeze({
  version: 'authored-baseline-bounded-1',
  maxSessions: 12,
  maxDistinctExercises: 32,
  maxBlocksPerSession: LIMITS.maxWorkoutBlocks,
  maxSessionWorkUnits: PROGRAM_POLICY.maxSessionWorkUnits,
  maxSessionRepetitions: PROGRAM_POLICY.maxSessionRepetitions,
})

interface AuthoredSessionBase {
  id: string
  date: string
  startTime: string
  durationMin: number
  label: string
}
export type AuthoredWorkoutBlock =
  | { unit: 'reps'; exerciseId: string; sets: number; reps: number; targetRPE: TargetRPE }
  | { unit: 'seconds'; exerciseId: string; sets: number; seconds: number }
  | { unit: 'throws'; drillId: string; throws: number }

export type AuthoredSessionProposal =
  | (AuthoredSessionBase & { kind: 'run'; modality: 'run_road' | 'run_trail'; intent: 'easy' | 'long' })
  | (AuthoredSessionBase & { kind: 'conditioning'; modality: ConditioningModality })
  | (AuthoredSessionBase & { kind: 'workout'; blocks: readonly AuthoredWorkoutBlock[]; sourceCommitmentId?: string })

/** Doses and dates are proposals, never approvals, costs, profiles, or baseline evidence. */
export interface AuthoredWeekProposal {
  version: 1
  weekStart: string
  sessions: readonly AuthoredSessionProposal[]
}

export function parseAuthoredWeekProposal(value: unknown, options: AuthoredPolicyOptions = {}): AuthoredWeekProposal {
  const v = new Validator(options)
  const data = v.object(value, 'proposal', ['version', 'weekStart', 'sessions'])
  if (data.version !== 1) v.issue('proposal.version', 'must be 1')
  const weekStart = v.date(data.weekStart, 'proposal.weekStart')
  const sessions = v.array(data.sessions, 'proposal.sessions', 0,
    v.aiAdvisory ? AI_ADVISORY_LIMITS.maxSessions : AUTHORED_WEEK_POLICY.maxSessions)
    .map((value, index): AuthoredSessionProposal => {
      const path = `proposal.sessions[${index}]`
      const fields = ['id', 'date', 'startTime', 'durationMin', 'label', 'kind']
      const tag = v.object(value, path, [...fields, 'modality', 'intent', 'blocks', 'sourceCommitmentId'])
      const kind = v.enum(tag.kind, `${path}.kind`, ['run', 'conditioning', 'workout'] as const)
      const item = v.object(tag, path, [...fields, ...(kind === 'workout' ? ['blocks', 'sourceCommitmentId']
        : kind === 'run' ? ['modality', 'intent'] : ['modality'])])
      const base = {
        id: v.id(item.id, `${path}.id`), date: v.date(item.date, `${path}.date`),
        startTime: v.time(item.startTime, `${path}.startTime`),
        durationMin: v.number(item.durationMin, `${path}.durationMin`, 1, 1440, true),
        label: v.plainText(item.label, `${path}.label`, 80),
      }
      if (kind === 'run') return {
        ...base, kind, modality: v.enum(item.modality, `${path}.modality`, ['run_road', 'run_trail']),
        intent: v.enum(item.intent, `${path}.intent`, ['easy', 'long']),
      }
      if (kind === 'conditioning') return {
        ...base, kind, modality: v.enum(item.modality, `${path}.modality`,
          ['run_road', 'run_trail', 'bike_road', 'bike_gravel', 'row', 'ski_erg']),
      }
      const blocks = v.array(item.blocks, `${path}.blocks`, 1, AUTHORED_WEEK_POLICY.maxBlocksPerSession)
        .map((value, index): AuthoredWorkoutBlock => {
          const p = `${path}.blocks[${index}]`
          const tag = v.object(value, p, ['unit', 'exerciseId', 'sets', 'reps', 'targetRPE', 'seconds', 'drillId', 'throws'])
          const unit = v.enum(tag.unit, `${p}.unit`, ['reps', 'seconds', 'throws'] as const)
          const block = v.object(tag, p, unit === 'throws' ? ['unit', 'drillId', 'throws']
            : unit === 'reps' ? ['unit', 'exerciseId', 'sets', 'reps', 'targetRPE']
              : ['unit', 'exerciseId', 'sets', 'seconds'])
          if (unit === 'throws') return {
            unit, drillId: v.sportDrillId(block.drillId, `${p}.drillId`),
            throws: v.number(block.throws, `${p}.throws`, CONTROLLED_TARGET_THROW_PROFILE.minThrowsPerPractice,
              v.aiAdvisory ? AI_ADVISORY_LIMITS.maxThrowsPerBlock : CONTROLLED_TARGET_THROW_PROFILE.maxThrowsPerPractice, true),
          }
          const dose = {
            exerciseId: v.id(block.exerciseId, `${p}.exerciseId`),
            sets: v.number(block.sets, `${p}.sets`, 1, v.aiAdvisory ? AI_ADVISORY_LIMITS.maxSetsPerBlock : 4, true),
          }
          return unit === 'reps' ? {
            ...dose, unit, reps: v.number(block.reps, `${p}.reps`, 1, v.aiAdvisory ? AI_ADVISORY_LIMITS.maxRepsPerSet : 20, true),
            targetRPE: v.rpe(block.targetRPE, `${p}.targetRPE`),
          } : { ...dose, unit, seconds: v.number(block.seconds, `${p}.seconds`, v.aiAdvisory ? 1 : 5,
            v.aiAdvisory ? AI_ADVISORY_LIMITS.maxTimedSecondsPerBlock : 300, true) }
        })
      v.unique(blocks, block => block.unit === 'throws' ? block.drillId : block.exerciseId, `${path}.blocks`)
      const sourceCommitmentId = Object.hasOwn(item, 'sourceCommitmentId')
        ? v.id(item.sourceCommitmentId, `${path}.sourceCommitmentId`) : undefined
      if (blocks.some(block => (block.unit === 'throws') !== (sourceCommitmentId !== undefined))) {
        v.issue(`${path}.blocks`, 'throws require a source commitment and cannot be mixed with strength work')
      }
      return { ...base, kind, blocks, ...(sourceCommitmentId === undefined ? {} : { sourceCommitmentId }) }
    })
  v.unique(sessions, session => session.id, 'proposal.sessions')
  return v.finish({ version: 1, weekStart, sessions })
}

/**
 * Project typed session definitions into an unapproved proposal. This never
 * changes baseline evidence or doses. Build against the same fixed-commitment
 * input; ordinary fixed records are reinjected there, not authored here.
 */
export function authoredProposalFromSessions(
  weekStart: string,
  values: readonly Session[],
  options: AuthoredPolicyOptions & { preservedSessionIds?: readonly string[] } = {},
): AuthoredWeekProposal {
  const configuration = new Validator()
  const data = configuration.finish(configuration.object(options, 'options', ['preservedSessionIds', 'policy']))
  const policyOptions: AuthoredPolicyOptions = Object.hasOwn(data, 'policy') ? { policy: data.policy as AuthoredPolicyOptions['policy'] } : {}
  const v = new Validator(policyOptions)
  const start = v.date(weekStart, 'weekStart')
  const preserved = Object.hasOwn(data, 'preservedSessionIds')
    ? v.array(data.preservedSessionIds, 'options.preservedSessionIds', 0, LIMITS.maxHistorySessions)
      .map((id, index) => v.id(id, `options.preservedSessionIds[${index}]`)) : []
  v.unique(preserved, id => id, 'options.preservedSessionIds')
  const sessions = v.array(values, 'sessions', 0, LIMITS.maxHistorySessions)
    .map((session, index) => v.session(session, `sessions[${index}]`))
  v.unique(sessions, session => session.id, 'sessions')
  v.finish(undefined)
  for (const id of preserved) {
    const session = sessions.find(session => session.id === id)
    if (!session?.pinned) error(`Preserved session ${id} must be present and pinned; conversion cannot silently discard unperformed work.`)
  }
  const proposals: AuthoredSessionProposal[] = []
  for (const session of sessions) {
    if (preserved.includes(session.id)) continue
    if (session.kind === 'commitment') {
      if (!session.pinned || !new RegExp(`^fixed-[1-9]\\d*-${start}$`).test(session.id)) {
        error(`Commitment ${session.id} is not a recurring fixed record; pass its authoritative preservedSessionId rather than silently dropping it.`)
      }
      continue
    }
    if (session.pinned && !(session.kind === 'workout' && session.sourceCommitmentId)) {
      error(`Pinned session ${session.id} requires an explicit preservedSessionId; it cannot be rewritten as new authored work.`)
    }
    if (session.startTime === null) error(`Unperformed session ${session.id} has unknown timing; conversion cannot invent a start time.`)
    const base = {
      id: session.id, date: session.date, startTime: session.startTime, durationMin: session.durationMin,
    }
    if (session.kind === 'strength') {
      error('Legacy strength prescriptions cannot be implicitly converted to reviewed workout profiles; use the opt-in program planner.')
    }
    if (session.kind === 'run') {
      proposals.push({
        ...base, kind: 'run', label: session.endurancePrescription.intent === 'long' ? 'Long conversational run' : 'Easy conversational run',
        modality: session.modality, intent: session.endurancePrescription.intent,
      })
    } else if (session.kind === 'conditioning') {
      proposals.push({
        ...base, kind: 'conditioning', label: `Easy ${session.modality.replaceAll('_', ' ')}`, modality: session.modality,
      })
    } else {
      proposals.push({
        ...base, kind: 'workout', label: session.label,
        blocks: session.blocks.map((block): AuthoredWorkoutBlock => {
          if (block.unit === 'throws') return { unit: 'throws', drillId: block.drillId, throws: block.throws }
          if (block.unit === 'seconds') return { unit: 'seconds', exerciseId: block.exerciseId, sets: block.sets, seconds: block.seconds }
          return { unit: 'reps', exerciseId: block.exerciseId, sets: block.sets, reps: block.reps, targetRPE: block.targetRPE }
        }),
        ...(session.sourceCommitmentId ? { sourceCommitmentId: session.sourceCommitmentId } : {}),
      })
    }
  }
  return parseAuthoredWeekProposal({ version: 1, weekStart: start, sessions: proposals }, policyOptions)
}

function error(message: string): never { throw new InputError([message]) }

/**
 * Only this entry point accepts same-week actuals, and only for immutable pins.
 * The deterministic planner's historical input contract is unchanged.
 */
export function parseAuthoredPlanWeekInput(value: unknown, options: AuthoredPolicyOptions = {}): PlanWeekInput {
  const v = new Validator(options)
  const data = v.finish(v.object(value, 'input', ['athlete', 'block', 'weekIndex', 'library', 'context']))
  const context = parsePlanningContextWithOptions(data.context, options)
  const block = v.finish(v.block(data.block, 'input.block'))
  const weekIndex = v.finish(v.number(data.weekIndex, 'input.weekIndex', 0, block.totalWeeks - 1, true))
  const weekStart = addDays(block.startDate, weekIndex * 7)
  const current = context.recentSessions.filter(record => record.session.date >= weekStart)
  for (const record of current) {
    if (record.session.date > addDays(weekStart, 6) || !record.log
      || !context.pinnedSessions.some(pin => pin.id === record.session.id)) {
      error('Same-week actual work must have a log and an identical immutable pinned session in the requested week.')
    }
  }
  const input = parsePlanWeekInputWithOptions({
    ...data, context: { ...context, recentSessions: context.recentSessions.filter(record => record.session.date < weekStart) },
  }, options)
  if (!input.block.program || !input.athlete.program || input.library.version !== PROGRAM_LIBRARY_VERSION) {
    error('Authored weeks require an opt-in program and its immutable exercise-profiles-1 library.')
  }
  return { ...input, context: { ...input.context, recentSessions: [...input.context.recentSessions, ...current] } }
}

function cleanThrow(input: PlanWeekInput, sourceId: string, drillId: string): boolean {
  const weekStart = addDays(input.block.startDate, input.weekIndex * 7)
  return hasCleanThrowObservation({
    ...input, context: { ...input.context,
      recentSessions: input.context.recentSessions.filter(record => record.session.date < weekStart) },
  }, sourceId, drillId)
}

function materialize(input: PlanWeekInput, item: AuthoredSessionProposal, options: AuthoredPolicyOptions): Session {
  const base = {
    id: item.id, date: item.date, startTime: item.startTime, durationMin: item.durationMin,
    reason: options.policy === 'ai-advisory'
      ? `${item.label}. AI-authored proposal; supported profiles and data integrity checked, training rules advisory.`
      : `${item.label}. Authored proposal; deterministically validated against confirmed baseline and supported profiles.`,
    predictedLoad: { systemic: 0, structural: 0 }, pinned: false, isCalibration: input.weekIndex === 0,
  }
  let session: Session
  if (item.kind === 'run') {
    session = {
      ...base, kind: 'run', discipline: 'run', modality: item.modality,
      endurancePrescription: { intent: item.intent, effort: 'conversational' },
    }
  } else if (item.kind === 'conditioning') {
    session = {
      ...base, kind: 'conditioning', modality: item.modality,
      discipline: item.modality.startsWith('run_') ? 'run' : item.modality.startsWith('bike_') ? 'bike' : 'sport',
      conditioningPrescription: { intent: 'easy', effort: 'conversational' },
    }
  } else {
    const blocks = item.blocks.map((block, index): WorkoutBlock => {
      if (block.unit === 'throws') return { ...block, intent: 'controlled_technique', embedded: true }
      const exercise = input.library.exercises.find(exercise => exercise.id === block.exerciseId)
      if (!exercise?.profile || exercise.highSkill) error(`Unsupported exercise profile: ${block.exerciseId}.`)
      const metadata = exerciseMetadata(exercise.id, input.library)
      if (metadata.unit !== block.unit || metadata.execution.ballistic) {
        error(`Exercise ${block.exerciseId} must use its supported ${metadata.unit} unit and nonballistic execution profile.`)
      }
      if (block.unit === 'seconds') return {
        ...block, role: metadata.template === 'mobility' ? 'mobility' : 'carry', executionStyle: 'controlled',
      }
      if (metadata.execution.style === 'ballistic_logging_only') error('Ballistic work is not supported in authored proposals.')
      const observed = input.athlete.baseline.exercises.find(observation => observation.exerciseId === block.exerciseId)
      const latest = latestPerformance(input, block.exerciseId)
      return {
        ...block, role: index === 0 ? 'anchor' : 'accessory', executionStyle: metadata.execution.style,
        ...(observed && observed.reps === block.reps && observed.actualRPE === block.targetRPE
          && latest?.weightKg === observed.weightKg && latest.reps === block.reps && latest.actualRPE === block.targetRPE
          ? { suggestedWeightKg: observed.weightKg } : {}),
      }
    })
    session = {
      ...base, kind: 'workout', discipline: item.sourceCommitmentId ? 'sport' : 'strength',
      modality: item.sourceCommitmentId ? 'court_sport' : 'lifting', label: item.label, blocks,
      ...(item.sourceCommitmentId ? { sourceCommitmentId: item.sourceCommitmentId } : {}),
      isCalibration: blocks.some(block => block.unit === 'throws'
        ? !cleanThrow(input, item.sourceCommitmentId!, block.drillId)
        : !hasCleanBlockObservation(input, block.exerciseId, block.unit)),
    }
    if (item.sourceCommitmentId) {
      const fixed = input.block.goal.fixedCommitments.find(commitment => commitment.id === item.sourceCommitmentId)
      if (!fixed || fixed.discipline !== 'sport' || fixed.modality !== 'court_sport') {
        error('Authored throwing must be inside an existing fixed court-sport practice; no new exposure is inferred.')
      }
      session.pinned = true
      session.predictedLoad = { ...fixed.estimatedLoad }
    }
  }
  session.predictedLoad = predictSessionLoad(session, input.athlete, input.library)
  return session
}

/** Resolve a fixed source's canonical ID for a parsed target input, without generating any training dose. */
export function authoredCommitmentSessionId(input: PlanWeekInput, sourceCommitmentId: string): string {
  const v = new Validator()
  const source = v.id(sourceCommitmentId, 'sourceCommitmentId')
  const start = v.date(input.block.startDate, 'input.block.startDate')
  const totalWeeks = v.number(input.block.totalWeeks, 'input.block.totalWeeks', 1, LIMITS.maxWeeks, true)
  const weekIndex = v.number(input.weekIndex, 'input.weekIndex', 0, totalWeeks - 1, true)
  const commitments = v.array(input.block.goal.fixedCommitments, 'input.block.goal.fixedCommitments', 0, LIMITS.maxCommitments)
    .map((item, index) => v.commitment(item, `input.block.goal.fixedCommitments[${index}]`))
  v.unique(commitments, commitment => commitment.id, 'input.block.goal.fixedCommitments')
  v.finish(undefined)
  const index = commitments.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .findIndex(commitment => commitment.id === source)
  if (index < 0) error(`Unknown fixed source commitment ${source}; no identity or exposure can be inferred.`)
  return `fixed-${index + 1}-${addDays(start, weekIndex * 7)}`
}

function assemble(input: PlanWeekInput, proposal: AuthoredWeekProposal, options: AuthoredPolicyOptions): Session[] {
  const fixed = [...input.block.goal.fixedCommitments].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map((commitment): Session => ({
      id: authoredCommitmentSessionId(input, commitment.id), kind: 'commitment',
      date: dateForWeekday(proposal.weekStart, commitment.dayOfWeek), startTime: commitment.startTime,
      durationMin: commitment.durationMin, discipline: commitment.discipline, modality: commitment.modality,
      label: commitment.label, predictedLoad: { ...commitment.estimatedLoad },
      reason: 'Established commitment; its time and workload are immutable.',
      pinned: true, isCalibration: false,
    }))
  const sessions = new Map(fixed.map(session => [session.id, session]))
  for (const pin of input.context.pinnedSessions) sessions.set(pin.id, pin)
  for (const item of proposal.sessions) {
    if (input.context.pinnedSessions.some(pin => pin.id === item.id)) {
      error(`Proposal must not replace pinned session ${item.id}; omit it from proposal.sessions, it is preserved automatically.`)
    }
    if (input.context.recentSessions.some(record => record.session.id === item.id)
      || input.context.neighboringSessions.some(session => session.id === item.id)) {
      error(`Proposal session ID ${item.id} already identifies historical or neighboring work; stable identities cannot be reused.`)
    }
    const existing = sessions.get(item.id)
    if (existing && !(item.kind === 'workout' && item.sourceCommitmentId && existing.kind === 'commitment')) {
      error(`Proposal session ${item.id} collides with an immutable fixed commitment.`)
    }
    sessions.set(item.id, materialize(input, item, options))
  }
  return [...sessions.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1
      : (a.startTime ?? '') < (b.startTime ?? '') ? -1 : (a.startTime ?? '') > (b.startTime ?? '') ? 1
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// Replace only generated-template policy, not independent safety or identity rules.
const REPLACED_TEMPLATE_RULES = new Set([
  'frozenWorkoutTemplate', 'programDose', 'programSessionKinds', 'throwingExposure',
])

// Explicit classification keeps unknown integrity/profile failures hard.
const ADVISORY_TRAINING_MESSAGES: Readonly<Record<string, string>> = {
  goalDateBoundary: 'Some proposed training falls after the supplied goal date.',
  availableDays: 'Some sessions fall outside the supplied available days.',
  untimedStrengthBoundary: 'Nearby imported lifting has unknown timing; its recovery interval is uncertain.',
  weeklyTimeBudget: 'Visible sessions total more minutes than the supplied weekly time budget.',
  sessionsPerDay: 'More than two sessions share a day; review the daily workload and spacing.',
  restDay: 'This week has no session-free calendar day; consider recovery.',
  safetyHold: 'Recorded pain, illness, return-from-break or disrupted-week information remains present; no clearance is inferred.',
  runFrequency: 'Running frequency is above the confirmed baseline or legacy generation reference.',
  liftFrequency: 'Lifting frequency is above the confirmed baseline or legacy generation reference.',
  longestRun: 'A run is longer than the confirmed longest run or the legacy duration reference.',
  weeklyRunVolume: 'Running minutes are above the baseline or comparable-week progression reference.',
  conditioningFrequency: 'Conditioning frequency is above its modality-specific confirmed baseline.',
  conditioningVolume: 'Conditioning minutes are above their modality-specific confirmed baseline.',
  conditioningLongest: 'A conditioning session is longer than its modality-specific confirmed longest duration.',
  conditioningBaseline: 'This conditioning modality has no confirmed baseline; no capacity is inferred from another modality.',
  liftDuration: 'A lifting session is longer than the confirmed lifting duration.',
  recommendedSessionWork: 'Strength work is above the legacy first-exposure quantity reference.',
  recommendedCalibration: 'A first-exposure label differs from the available matching exercise observations.',
  programCalibration: 'A first-exposure label differs from the available matching exercise/unit observations.',
  programSessionWork: 'Workout quantities are above the legacy first-exposure reference of 8 work units or 64 repetitions.',
  throwingHealthHold: 'Recorded health-hold information remains present alongside throwing work; no clearance is inferred.',
  dailyThrowingExposure: 'Daily throws are above the summed confirmed comfortable practice counts.',
  weeklyThrowingExposure: 'Weekly throws are above the summed confirmed comfortable practice counts.',
  unknownSameDayTime: 'Unknown same-day timing leaves overlap and spacing uncertain.',
  minimumLiftGap: 'Lower-body lifting is closer than the 24-hour end-to-start recovery reference, or timing is uncertain.',
  overlappingSessions: 'Known session intervals overlap, potentially across midnight.',
  consecutiveHardDays: 'More than two consecutive days meet the estimated hard-day reference; AU is not measured recovery.',
  authoredConditioningBaseline: 'This modality has no confirmed baseline; the proposal does not establish one.',
  authoredThrowDose: 'Throwing exceeds the confirmed practice count or first-identity calibration reference.',
  authoredThrowCalibration: 'This drill identity lacks a clean calibration observation despite its supplied calibration label.',
  authoredDoseCeiling: 'An exercise dose exceeds its default profile dose or confirmed same-exercise dose; neither is being raised as an observation.',
  authoredSessionQuantity: 'Strength quantities exceed the legacy reference of 8 work units or 64 repetitions.',
  authoredPracticeExposure: 'The combined drill counts exceed this practice’s confirmed exposure or calibration reference.',
  authoredWeeklyQuantity: 'Weekly work units, repetitions or timed work are above the confirmed lifting-frequency/duration reference.',
  authoredWeeklyThrows: 'Weekly throws are above the summed confirmed practice counts.',
  authoredBaselineProgression: 'Conditioning frequency, weekly minutes or longest duration exceeds the confirmed modality baseline.',
  authoredRunBaseline: 'Combined running exceeds confirmed weekly minutes or frequency; the observed baseline remains unchanged.',
  authoredLiftBaseline: 'Lifting minutes exceed confirmed per-session or weekly lifting time; the observed baseline remains unchanged.',
  authoredHealthHold: 'Logged pain or illness remains present alongside proposed work; advisory acceptance is not clearance.',
  authoredUnknownActualTime: 'Unknown timing leaves spacing from actual or pinned work uncertain.',
  authoredActualLiftGap: 'Actual durations or uncertain timing put lifting closer than the 24-hour recovery reference.',
  authoredActualOverlap: 'Session intervals overlap actual or pinned work, including recorded duration overruns.',
  authoredActualHardDays: 'Planned and actual workload estimates produce more than two consecutive estimated hard days.',
  authoredOccupiedAvailability: 'Overnight or unknown-time work occupies a day outside the supplied availability.',
  authoredOccupiedRestDay: 'No full calendar day is free of work after accounting for overnight and unknown-time sessions.',
  authoredOccupiedSessionsPerDay: 'More than two session intervals occupy a day, including overnight actual work.',
  authoredActualTimeBudget: 'Planned work plus recorded duration overruns exceeds the supplied weekly time budget.',
  authoredActualRunVolume: 'Run durations, including actual overruns, exceed confirmed weekly or longest-run minutes.',
  authoredActualLiftVolume: 'Lifting durations, including actual overruns, exceed confirmed per-session or weekly minutes.',
  authoredActualSessionQuantity: 'Actual work plus remaining prescriptions exceeds the legacy session-quantity or duration reference.',
  authoredActualThrowExposure: 'Recorded throwing exceeds the confirmed practice count; smaller proposed cards do not erase that work.',
  authoredActualWeeklyQuantity: 'Actual work plus remaining prescriptions exceeds the legacy weekly-quantity reference.',
  authoredActualConditioningVolume: 'Conditioning durations, including actual overruns, exceed their confirmed modality-specific baseline.',
}
const ADVISORY_TRAINING_RULES = new Set(Object.keys(ADVISORY_TRAINING_MESSAGES))

function advisoryResult(
  input: PlanWeekInput, violations: SafetyViolation[], options: AuthoredPolicyOptions,
): AuthoredSessionValidationResult {
  if (options.policy !== 'ai-advisory') return { passed: violations.length === 0, violations }
  const hard = violations.filter(violation => !ADVISORY_TRAINING_RULES.has(violation.rule))
  const advisories = violations.filter(violation => ADVISORY_TRAINING_RULES.has(violation.rule))
    .map(violation => ({ ...violation, message: `Advisory only: ${ADVISORY_TRAINING_MESSAGES[violation.rule]}` }))
  if (input.athlete.safetyHold) {
    const hold = input.athlete.safetyHold
    advisories.push({ rule: 'authoredRecordedHealth', sessionIds: [],
      message: `Recorded ${hold.reason} hold since ${hold.since} remains present. Advisory validation is not recovery or medical clearance.` })
  }
  for (const { session, log } of input.context.recentSessions) {
    if (!log) continue
    if (log.painFlag || log.skipReason === 'pain' || log.skipReason === 'illness') {
      advisories.push({ rule: 'authoredRecordedHealth', sessionIds: [session.id],
        message: `Recorded ${log.painFlag || log.skipReason === 'pain' ? 'pain' : 'illness'} on ${session.date} remains unchanged; no clearance is inferred.` })
    }
    const overrun = (log.actualDurationMin ?? 0) > session.durationMin
      || (session.kind === 'workout' && log.blockLogs?.some(actual => {
        const block = session.blocks[actual.blockIndex]
        if (block?.unit === 'reps' && actual.unit === 'reps') return actual.sets.length > block.sets
          || actual.sets.some(set => set.reps > block.reps || set.actualRPE > block.targetRPE)
        if (block?.unit === 'seconds' && actual.unit === 'seconds') return actual.seconds > block.sets * block.seconds
        return block?.unit === 'throws' && actual.unit === 'throws' && actual.throws > block.throws
      }))
    if (overrun) advisories.push({ rule: 'authoredRecordedOverrun', sessionIds: [session.id],
      message: `Actual duration or block work on ${session.date} exceeded its recorded prescription. Actuals remain unchanged and count in workload/recovery advisories; a smaller proposal is not clearance.` })
  }
  return { passed: hard.length === 0, violations: hard, advisories }
}

interface AuthoredSafetyOptions {
  advisory?: boolean
  partialAmendments?: ReadonlySet<string>
  accountPartialSets?: boolean
  preservedWeightBlocks?: ReadonlyMap<string, ReadonlySet<number>>
}

function authoredSafety(
  input: PlanWeekInput, sessions: readonly Session[], options: AuthoredSafetyOptions = {},
): SafetyViolation[] {
  const violations = checkSafety(input, sessions).violations.filter(violation =>
    !REPLACED_TEMPLATE_RULES.has(violation.rule)
    && !(violation.rule === 'pinnedSessionPreserved' && violation.sessionIds.length === 1
      && options.partialAmendments?.has(violation.sessionIds[0]!))
    && !(violation.rule === 'observedWeightOnly' && violation.sessionIds.length === 1
      && options.preservedWeightBlocks?.has(violation.sessionIds[0]!)))
  const fail = (rule: string, items: readonly Session[], message: string): void => {
    violations.push({ rule, sessionIds: items.map(session => session.id), message })
  }
  const program = input.block.program!
  const baseline = input.athlete.baseline
  const weekStart = addDays(input.block.startDate, input.weekIndex * 7)
  const historyInput = { ...input, context: { ...input.context,
    recentSessions: input.context.recentSessions.filter(record => record.session.date < weekStart) } }
  const identities = new Set<string>()
  let weeklySets = 0
  let weeklyReps = 0
  let weeklyTimedSeconds = 0
  let weeklyThrowCount = 0
  const practiceSources = new Set<string>()
  const configured = resolvedConditioningBaselines(input.athlete)
  const pinnedIds = new Set(input.context.pinnedSessions.map(session => session.id))
  for (const session of sessions) {
    const fixedWork = session.kind === 'commitment' || (session.kind === 'workout' && session.sourceCommitmentId)
    if (!pinnedIds.has(session.id) && !fixedWork) {
      if (session.kind === 'strength') {
        fail('authoredSessionKind', [session], 'New authored strength work must use typed workout blocks, not legacy strength prescriptions.')
      }
      if (session.startTime === null) {
        fail('authoredSessionTime', [session], 'Unperformed authored work requires an explicit start time.')
      }
      if (session.pinned) {
        fail('authoredPinAuthority', [session], 'A candidate cannot declare itself immutable; only supplied original pins or fixed commitments provide that authority.')
      }
    }
    if (input.context.recentSessions.some(record => record.session.id === session.id && record.session.date < weekStart)
      || input.context.neighboringSessions.some(neighbor => neighbor.id === session.id)) {
      fail('authoredSessionIdentity', [session], 'A candidate session cannot reuse an existing historical or neighboring identity.')
    }
    if (session.kind === 'run' || session.kind === 'conditioning') {
      if (options.advisory) {
        const missing = AI_ADVISORY_CONDITIONING_RESOURCES[session.modality]
          .filter(resource => !program.resources.includes(resource))
        if (missing.length) fail('authoredConditioningEquipment', [session],
          `${session.modality} requires confirmed equipment resources: ${missing.join(', ')}. A baseline or generic machine does not establish device availability.`)
      }
      if (!configured.some(baseline => baseline.modality === session.modality)) {
        fail('authoredConditioningBaseline', [session], `No confirmed ${session.modality} baseline; modality exposure cannot be borrowed.`)
      }
    }
    if (session.kind !== 'workout') continue
    const blockIds = session.blocks.map(block => block.unit === 'throws' ? block.drillId : block.exerciseId)
    if (new Set(blockIds).size !== blockIds.length) {
      fail('authoredBlockIdentity', [session], 'Every exercise or drill identity must appear at most once in a workout.')
    }
    let sets = 0
    let reps = 0
    let minimumSeconds = 0
    let sessionThrows = 0
    for (const block of session.blocks) {
      if (block.unit === 'throws') {
        identities.add(block.drillId)
        const drill = availableSportDrills(program.resources, program.customSportDrills)
          .find(drill => drill.id === block.drillId)
        const calibrated = cleanThrow(historyInput, session.sourceCommitmentId ?? '', block.drillId)
        const comfortable = program.comfortableThrowsPerPractice
        const ceiling = comfortable === undefined ? 0 : calibrated ? comfortable
          : Math.max(1, Math.floor(comfortable * PROGRAM_POLICY.throwingCalibrationFraction))
        sessionThrows += block.throws
        if (!drill || program.goal !== 'dodgeball' || !session.sourceCommitmentId
          || !block.embedded || block.intent !== 'controlled_technique') {
          fail('authoredThrowProfile', [session], 'Throwing requires an immutable supported controlled-target-throw identity, confirmed resources and an established practice.')
        }
        if (block.throws > ceiling) {
          fail('authoredThrowDose', [session], `Throw dose exceeds the confirmed practice exposure or first-identity calibration ceiling of ${ceiling}; v1 does not infer progression.`)
        }
        if (!calibrated && !session.isCalibration) {
          fail('authoredThrowCalibration', [session], 'A new drill identity requires its own clean calibration observation; another drill cannot supply it.')
        }
        continue
      }
      identities.add(block.exerciseId)
      const exercise = input.library.exercises.find(exercise => exercise.id === block.exerciseId)
      if (!exercise?.profile) {
        fail('authoredExerciseProfile', [session], `No immutable supported profile for ${block.exerciseId}.`)
        continue
      }
      if (exercise.equipment.some(equipment => equipment !== 'none' && !input.athlete.equipment.includes(equipment))) {
        fail('authoredEquipment', [session], `Exercise ${block.exerciseId} requires unavailable equipment; no equipment is inferred.`)
      }
      const dose = exercise.profile.prescription
      const observed = baseline.exercises.find(observation => observation.exerciseId === block.exerciseId)
      const metadata = exerciseMetadata(exercise.id, input.library)
      sets += block.sets
      if (block.unit === 'reps' && dose.unit === 'reps') {
        reps += block.sets * block.reps
        minimumSeconds += block.sets * block.reps * (metadata.execution.eccentricSeconds ?? 0)
        if (block.sets > Math.min(dose.sets, observed?.sets ?? dose.sets)
          || block.reps > Math.min(dose.reps, observed?.reps ?? dose.reps)
          || block.targetRPE > Math.min(dose.targetRPE, observed?.actualRPE ?? dose.targetRPE)) {
          fail('authoredDoseCeiling', [session],
            `Exercise ${block.exerciseId} exceeds its supported profile or confirmed same-exercise dose. Automatic progression beyond confirmed baseline is unsupported in v1.`)
        }
        const preservedWeight = options.preservedWeightBlocks?.get(session.id)?.has(session.blocks.indexOf(block))
        if (block.suggestedWeightKg !== undefined && !preservedWeight && (!observed
          || block.suggestedWeightKg !== observed.weightKg || block.reps !== observed.reps || block.targetRPE !== observed.actualRPE)) {
          fail('authoredObservedWeightOnly', [session], 'Weights must match confirmed same-exercise baseline repetitions and RPE; never borrowed or progressed.')
        }
        if (block.suggestedWeightKg !== undefined && !preservedWeight && options.preservedWeightBlocks?.has(session.id)) {
          const performance = latestPerformance(input, block.exerciseId)
          if (!performance || performance.weightKg !== block.suggestedWeightKg
            || performance.reps !== block.reps || performance.actualRPE !== block.targetRPE) {
            fail('observedWeightOnly', [session], 'A non-preserved weight must exactly match the latest eligible same-exercise repetitions and RPE.')
          }
        }
        if (block.role !== (session.blocks.indexOf(block) === 0 ? 'anchor' : 'accessory')) {
          fail('authoredBlockRole', [session], 'Repetition block roles are engine-derived: first block anchor, subsequent blocks accessory.')
        }
      } else if (block.unit === 'seconds' && dose.unit === 'seconds') {
        minimumSeconds += block.sets * block.seconds
        weeklyTimedSeconds += block.sets * block.seconds
        if (block.sets > dose.sets || block.seconds > dose.seconds) {
          fail('authoredDoseCeiling', [session], `Exercise ${block.exerciseId} exceeds its supported timed profile; automatic progression is unsupported in v1.`)
        }
        if (block.role !== (exercise.template === 'mobility' ? 'mobility' : 'carry')) {
          fail('authoredBlockRole', [session], 'Timed block roles must retain the engine-owned carry or mobility profile.')
        }
      }
    }
    weeklySets += sets
    weeklyReps += reps
    weeklyThrowCount += sessionThrows
    if (sets > AUTHORED_WEEK_POLICY.maxSessionWorkUnits || reps > AUTHORED_WEEK_POLICY.maxSessionRepetitions) {
      fail('authoredSessionQuantity', [session], 'A strength workout is limited to 8 work units and 64 repetitions, irrespective of exercise variety.')
    }
    if (minimumSeconds > session.durationMin * 60) {
      fail('authoredDurationQuantity', [session], 'The prescribed timed work and explicit lowering phases cannot fit inside the supplied duration, even before rest.')
    }
    if (session.sourceCommitmentId) {
      if (practiceSources.has(session.sourceCommitmentId)) {
        fail('authoredPracticeIdentity', [session], 'One existing practice cannot be counted twice or split into extra exposure.')
      }
      practiceSources.add(session.sourceCommitmentId)
      const allCalibrated = session.blocks.every(block => block.unit === 'throws'
        && cleanThrow(historyInput, session.sourceCommitmentId!, block.drillId))
      const comfortable = program.comfortableThrowsPerPractice ?? 0
      const cap = allCalibrated ? comfortable : Math.max(comfortable > 0 ? 1 : 0,
        Math.floor(comfortable * PROGRAM_POLICY.throwingCalibrationFraction))
      if (sessionThrows > cap) {
        fail('authoredPracticeExposure', [session], 'All drill cards share one confirmed practice exposure cap; splitting identities cannot multiply allowed throws.')
      }
    }
  }
  if (identities.size > AUTHORED_WEEK_POLICY.maxDistinctExercises) {
    fail('authoredIdentityLimit', sessions, 'At most 32 distinct exercise and drill identities may be authored in one week.')
  }
  const liftCount = Math.min(baseline.liftsPerWeek, LIMITS.maxLifts)
  if (weeklySets > liftCount * AUTHORED_WEEK_POLICY.maxSessionWorkUnits
    || weeklyReps > liftCount * AUTHORED_WEEK_POLICY.maxSessionRepetitions
    || weeklyTimedSeconds > liftCount * baseline.liftDurationMin * 60) {
    fail('authoredWeeklyQuantity', sessions, 'Weekly work units, repetitions and timed work must fit the confirmed lift frequency and duration, not the size of the exercise library.')
  }
  if (weeklyThrowCount > practiceSources.size * (program.comfortableThrowsPerPractice ?? 0)) {
    fail('authoredWeeklyThrows', sessions, 'Weekly throws exceed the summed confirmed practice exposure; this administrative cap is not a validated injury-safe threshold.')
  }
  for (const modality of configured) {
    const matching = sessions.filter(session => session.modality === modality.modality)
    if (matching.length > modality.sessionsPerWeek
      || matching.reduce((sum, session) => sum + session.durationMin, 0) > modality.weeklyMinutes
      || matching.some(session => session.durationMin > modality.longestSessionMinutes)) {
      fail('authoredBaselineProgression', matching,
        `${modality.modality} exceeds confirmed frequency, weekly minutes or longest duration. Automatic progression beyond baseline is unsupported in v1.`)
    }
  }
  const running = sessions.filter(session => session.discipline === 'run')
  if (running.length > baseline.runsPerWeek
    || running.reduce((sum, session) => sum + session.durationMin, 0) > baseline.weeklyRunMinutes) {
    fail('authoredRunBaseline', running, 'Combined running exceeds confirmed weekly volume or frequency; run kinds and modalities share the same cap.')
  }
  const lifts = sessions.filter(session => session.discipline === 'strength')
  if (lifts.some(session => session.durationMin > baseline.liftDurationMin)
    || lifts.reduce((sum, session) => sum + session.durationMin, 0) > baseline.liftsPerWeek * baseline.liftDurationMin) {
    fail('authoredLiftBaseline', lifts, 'Lifting minutes exceed confirmed per-session or weekly lifting duration; automatic progression is unsupported in v1.')
  }
  if (input.context.recentSessions.some(record => record.session.date >= baseline.asOf && record.log
    && (record.log.painFlag || record.log.skipReason === 'pain' || record.log.skipReason === 'illness'))) {
    const proposed = sessions.filter(session => (!input.context.pinnedSessions.some(pin => pin.id === session.id)
      || options.partialAmendments?.has(session.id))
      && (session.kind !== 'commitment'))
    if (proposed.length) fail('authoredHealthHold', proposed, 'Unresolved pain or illness, including same-week logged work, blocks new prescriptions.')
  }
  checkActualRecovery(input, sessions, fail, options.accountPartialSets)
  return violations
}

/** Project remaining work plus per-set overruns; the original actual record is never rewritten. */
function projectedPartialWork(session: WorkoutSession, log: SessionLog, input: PlanWeekInput): { load: Load; duration: number } {
  const planned = predictSessionLoad(session, input.athlete, input.library)
  const duration = log.actualDurationMin ?? session.durationMin
  const load = { ...planned }
  const addExcess = (actual: Load, covered: Load): void => {
    load.systemic += Math.max(0, actual.systemic - covered.systemic)
    load.structural += Math.max(0, actual.structural - covered.structural)
  }
  const blockCost = (block: Exclude<WorkoutBlock, { unit: 'throws' }>): Load =>
    predictSessionLoad({ ...session, blocks: [block] }, input.athlete, input.library)
  if (!session.sourceCommitmentId) for (const actual of log.blockLogs ?? []) {
    const block = session.blocks[actual.blockIndex]
    if (block?.unit === 'reps' && actual.unit === 'reps' && block.exerciseId === actual.exerciseId) {
      const onePlannedSet = blockCost({ ...block, sets: 1 })
      for (const [index, set] of actual.sets.entries()) {
        addExcess(blockCost({ ...block, sets: 1, reps: set.reps, targetRPE: set.actualRPE }),
          index < block.sets ? onePlannedSet : { systemic: 0, structural: 0 })
      }
    } else if (block?.unit === 'seconds' && actual.unit === 'seconds' && block.exerciseId === actual.exerciseId && actual.seconds > 0) {
      addExcess(blockCost({ ...block, sets: 1, seconds: actual.seconds }), blockCost(block))
    }
  }
  const durationFactor = Math.max(1, duration / session.durationMin)
  return { duration, load: {
    systemic: Math.max(load.systemic, planned.systemic * durationFactor),
    structural: Math.max(load.structural, planned.structural * durationFactor),
  } }
}

function checkActualRecovery(
  input: PlanWeekInput, sessions: readonly Session[],
  fail: (rule: string, items: readonly Session[], message: string) => void,
  accountPartialSets = false,
): void {
  const start = dayNumber(addDays(input.block.startDate, input.weekIndex * 7))
  const ids = new Set(sessions.map(session => session.id))
  // Recent actuals are included even if a caller forgot to duplicate them in neighbors.
  const all = new Map([...input.context.neighboringSessions,
    ...input.context.recentSessions.filter(record => record.log && record.log.status !== 'skipped').map(record => record.session),
    ...sessions].map(session => [session.id, session]))
  const active = [...all.values()].filter(session => {
    const day = dayNumber(session.date)
    const record = input.context.recentSessions.find(record => record.session.id === session.id)
    return day >= start - 7 && day <= start + 13 && record?.log?.status !== 'skipped'
      && record?.log?.actualDurationMin !== 0
  })
  const duration = (session: Session): number => {
    const record = input.context.recentSessions.find(record => record.session.id === session.id)
    return record?.log ? Math.max(session.durationMin, observedSessionWork(record, input)?.duration ?? 0) : session.durationMin
  }
  const lower = (session: Session): boolean => session.discipline === 'strength' && (session.kind === 'commitment'
    || (session.kind === 'strength' && session.strengthPrescription.some(block =>
      input.library.exercises.find(exercise => exercise.id === block.exerciseId)?.competesWithRunning))
    || (session.kind === 'workout' && session.blocks.some(block => block.unit !== 'throws'
      && input.library.exercises.find(exercise => exercise.id === block.exerciseId)?.competesWithRunning)))
  const hardDays = new Map<number, Session[]>()
  for (const session of active) {
    const record = input.context.recentSessions.find(record => record.session.id === session.id)
    const actual = record?.log
      ? accountPartialSets && record.log.status === 'partial' && session.kind === 'workout'
        ? projectedPartialWork(session, record.log, input) : observedSessionWork(record, input)
      : null
    const planned = predictSessionLoad(session, input.athlete, input.library)
    if (Math.max(planned.systemic, actual?.load.systemic ?? 0) >= HARD_SESSION_SYSTEMIC_THRESHOLD
      || Math.max(planned.structural, actual?.load.structural ?? 0) >= HARD_SESSION_STRUCTURAL_THRESHOLD) {
      const day = dayNumber(session.date)
      hardDays.set(day, [...(hardDays.get(day) ?? []), session])
    }
  }
  for (let a = 0; a < active.length; a++) {
    const left = active[a]!
    for (const right of active.slice(a + 1)) {
      if (!ids.has(left.id) && !ids.has(right.id)) continue
      const l = sessionStartMinutes(left)
      const r = sessionStartMinutes(right)
      if (l === null || r === null) {
        if (left.date === right.date) fail('authoredUnknownActualTime', [left, right], 'Unknown timing cannot establish separation from actual or pinned work.')
        if (lower(left) && lower(right)) {
          const [previous, next] = left.date <= right.date ? [left, right] : [right, left]
          const latest = sessionStartMinutes(previous) ?? (dayNumber(previous.date) + 1) * 1440
          const earliest = sessionStartMinutes(next) ?? dayNumber(next.date) * 1440
          if (earliest - latest - duration(previous) < SAFETY.minimumLiftGapHours * 60) {
            fail('authoredActualLiftGap', [left, right], 'Unknown actual timing cannot prove 24-hour end-to-start lower-body lifting recovery.')
          }
        }
      } else {
        if (l < r + duration(right) && r < l + duration(left)) {
          fail('authoredActualOverlap', [left, right], 'Session intervals overlap actual or pinned work, including duration overruns and overnight finishes.')
        }
        const gap = l <= r ? r - l - duration(left) : l - r - duration(right)
        if (lower(left) && lower(right) && gap < SAFETY.minimumLiftGapHours * 60) {
          fail('authoredActualLiftGap', [left, right], 'Lower-body lifting needs 24-hour end-to-start separation, including actual duration overruns.')
        }
      }
    }
  }
  let chain: number[] = []
  for (const day of [...hardDays.keys()].sort((a, b) => a - b)) {
    chain = chain.length && day === chain[chain.length - 1]! + 1 ? [...chain, day] : [day]
    if (chain.length > SAFETY.maxConsecutiveHardDays && chain.some(day => day >= start && day <= start + 6)) {
      fail('authoredActualHardDays', chain.flatMap(day => hardDays.get(day) ?? []), 'More than two consecutive estimated hard days, including actual logged overruns and pinned work.')
    }
  }
  const weekly = active.filter(session => ids.has(session.id))
  const occupied = new Map<number, Session[]>()
  for (const session of active) {
    const timestamp = sessionStartMinutes(session)
    const first = dayNumber(session.date)
    const last = timestamp === null ? first + Math.ceil(duration(session) / 1440)
      : Math.ceil((timestamp + duration(session)) / 1440) - 1
    for (let day = Math.max(first, start); day <= Math.min(last, start + 6); day++) {
      occupied.set(day, [...(occupied.get(day) ?? []), session])
      if (ids.has(session.id) && !input.athlete.availableDays.includes(dayOfWeek(addDays(session.date, day - first)))) {
        fail('authoredOccupiedAvailability', [session], 'An overnight or unknown-time session occupies an unavailable calendar day.')
      }
    }
  }
  if (occupied.size > 7 - SAFETY.minRestDaysPerWeek) {
    fail('authoredOccupiedRestDay', weekly, 'At least one full calendar day must remain free, including overnight or unknown-time work.')
  }
  for (const daily of occupied.values()) {
    if (daily.length > SAFETY.maxSessionsPerDay) {
      fail('authoredOccupiedSessionsPerDay', daily, 'More than two session intervals occupy one day, including overnight actual work.')
    }
  }
  if (weekly.reduce((sum, session) => sum + duration(session), 0) > input.athlete.weeklyTimeBudgetMin) {
    fail('authoredActualTimeBudget', weekly, 'Visible planned work plus actual duration overruns exceeds the weekly time budget.')
  }
  const baseline = input.athlete.baseline
  const runs = weekly.filter(session => session.discipline === 'run')
  if (runs.reduce((sum, session) => sum + duration(session), 0) > baseline.weeklyRunMinutes
    || runs.some(session => duration(session) > baseline.longestRunMinutes)) {
    fail('authoredActualRunVolume', runs, 'Actual run duration overruns leave insufficient confirmed baseline volume for this proposal.')
  }
  const lifts = weekly.filter(session => session.discipline === 'strength')
  if (lifts.some(session => duration(session) > baseline.liftDurationMin)
    || lifts.reduce((sum, session) => sum + duration(session), 0) > baseline.liftsPerWeek * baseline.liftDurationMin) {
    fail('authoredActualLiftVolume', lifts, 'Actual lifting duration overruns count against confirmed per-session and weekly lifting time.')
  }
  let weeklySets = 0
  let weeklyReps = 0
  let weeklyTimed = 0
  for (const session of weekly) {
    if (session.kind !== 'workout') continue
    const log = input.context.recentSessions.find(record => record.session.id === session.id)?.log
    let sets = 0
    let reps = 0
    let timed = 0
    let throws = 0
    for (const [index, block] of session.blocks.entries()) {
      const actual = log?.blockLogs?.find(item => item.blockIndex === index)
      if (block.unit === 'reps') {
        sets += Math.max(block.sets, actual?.unit === 'reps' ? actual.sets.length : 0)
        reps += accountPartialSets && log?.status === 'partial' && actual?.unit === 'reps'
          ? Math.max(0, block.sets - actual.sets.length) * block.reps
            + actual.sets.reduce((sum, set) => sum + Math.max(block.reps, set.reps), 0)
          : Math.max(block.sets * block.reps, actual?.unit === 'reps'
            ? actual.sets.reduce((sum, set) => sum + set.reps, 0) : 0)
      } else if (block.unit === 'seconds') {
        sets += block.sets
        timed += Math.max(block.sets * block.seconds, actual?.unit === 'seconds' ? actual.seconds : 0)
      } else {
        throws += Math.max(block.throws, actual?.unit === 'throws' ? actual.throws : 0)
      }
    }
    weeklySets += sets
    weeklyReps += reps
    weeklyTimed += timed
    if (sets > AUTHORED_WEEK_POLICY.maxSessionWorkUnits || reps > AUTHORED_WEEK_POLICY.maxSessionRepetitions
      || timed > duration(session) * 60) {
      fail('authoredActualSessionQuantity', [session], 'Truthful actual block overruns count against per-session work-unit, repetition and timed-work ceilings.')
    }
    if (throws > (input.block.program?.comfortableThrowsPerPractice ?? 0)) {
      fail('authoredActualThrowExposure', [session], 'Actual throwing overruns exceed the confirmed practice exposure; they cannot be hidden by smaller proposed cards.')
    }
  }
  if (weeklySets > baseline.liftsPerWeek * AUTHORED_WEEK_POLICY.maxSessionWorkUnits
    || weeklyReps > baseline.liftsPerWeek * AUTHORED_WEEK_POLICY.maxSessionRepetitions
    || weeklyTimed > baseline.liftsPerWeek * baseline.liftDurationMin * 60) {
    fail('authoredActualWeeklyQuantity', weekly, 'Actual block overruns plus proposed work exceed the baseline-bounded weekly quantity ceilings.')
  }
  for (const baseline of resolvedConditioningBaselines(input.athlete)) {
    const matching = weekly.filter(session => session.modality === baseline.modality)
    if (matching.reduce((sum, session) => sum + duration(session), 0) > baseline.weeklyMinutes
      || matching.some(session => duration(session) > baseline.longestSessionMinutes)) {
      fail('authoredActualConditioningVolume', matching, 'Actual conditioning overruns count against the same modality-specific baseline, never another modality.')
    }
  }
}

export interface AuthoredSessionValidationOptions extends AuthoredPolicyOptions {
  /**
   * Allow only proved unperformed block changes. Historical weight metadata on
   * unchanged recorded pins is validated independently of this option.
   */
  allowPartialWorkoutAmendments?: boolean
}

function samePreservedSession(left: Session, right: Session): boolean {
  const { reason: leftReason, ...leftFields } = left
  const { reason: rightReason, ...rightFields } = right
  void leftReason
  void rightReason
  return JSON.stringify(leftFields) === JSON.stringify(rightFields)
}

function partialAmendmentIssue(original: WorkoutSession, candidate: Session, log: SessionLog): string | null {
  if (candidate.kind !== 'workout') return 'A partial workout cannot change session kind.'
  const sessionFields = (session: WorkoutSession) => {
    const { blocks, predictedLoad, reason, isCalibration, ...fields } = session
    void blocks
    void predictedLoad
    void reason
    void isCalibration
    return fields
  }
  if (JSON.stringify(sessionFields(original)) !== JSON.stringify(sessionFields(candidate))) {
    return 'Partial amendments must preserve session identity, date, time, duration, discipline, modality, label, source commitment and pinned status.'
  }
  if (!log.blockLogs?.length) {
    return 'A partial workout without block-level actuals cannot establish which work remains unperformed.'
  }
  for (const actual of log.blockLogs) {
    const before = original.blocks[actual.blockIndex]
    const after = candidate.blocks[actual.blockIndex]
    if (!before || !after) return 'Every logged block must remain at its original index.'
    if (before.unit === 'reps' && after.unit === 'reps' && actual.unit === 'reps') {
      const { sets: beforeSets, ...beforePrescription } = before
      const { sets: afterSets, ...afterPrescription } = after
      // Actual overruns do not require rewriting an unchanged prescription.
      if (JSON.stringify(beforePrescription) !== JSON.stringify(afterPrescription)
        || afterSets > beforeSets || (afterSets < beforeSets && afterSets < actual.sets.length)) {
        return 'Logged repetition blocks must retain every prescription field and identity; only sets may reduce, never below the logged set count.'
      }
    } else if (JSON.stringify(before) !== JSON.stringify(after)) {
      return 'Logged timed or throwing blocks must retain their complete original prescriptions; an aggregate amount cannot be split into invented sets.'
    }
  }
  return null
}

function preservedHistoricalWeights(
  input: PlanWeekInput, sessions: readonly Session[], partialAmendments: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlySet<number>> {
  const weekStart = addDays(input.block.startDate, input.weekIndex * 7)
  const sourceInput = { ...input, context: { ...input.context,
    recentSessions: input.context.recentSessions.filter(record => record.session.date < weekStart) } }
  const result = new Map<string, ReadonlySet<number>>()
  for (const original of input.context.pinnedSessions) {
    const candidate = sessions.find(session => session.id === original.id)
    const log = input.context.recentSessions.find(record => record.session.id === original.id)?.log
    if (original.kind !== 'workout' || candidate?.kind !== 'workout'
      || (log?.status !== 'partial' && log?.status !== 'completed')) continue
    const exact = samePreservedSession(original, candidate)
    if (!exact && !partialAmendments.has(original.id)) continue
    const allowed = new Set<number>()
    for (const [index, before] of original.blocks.entries()) {
      const after = candidate.blocks[index]
      if (before.unit !== 'reps' || after?.unit !== 'reps' || before.suggestedWeightKg === undefined) continue
      // An exact recorded snapshot is immutable in full. Through an amendment,
      // only logged blocks may carry their original weight metadata forward.
      if (!exact && log.status === 'partial'
        && !log.blockLogs?.some(block => block.unit === 'reps' && block.blockIndex === index)) continue
      const { sets: beforeSets, ...beforeFields } = before
      const { sets: afterSets, ...afterFields } = after
      void beforeSets
      void afterSets
      if (JSON.stringify(beforeFields) !== JSON.stringify(afterFields)) continue
      const evidence = latestPerformance(sourceInput, before.exerciseId)
      if (evidence?.weightKg === before.suggestedWeightKg && evidence.reps === before.reps && evidence.actualRPE === before.targetRPE) {
        allowed.add(index)
      }
    }
    if (allowed.size) result.set(original.id, allowed)
  }
  return result
}

/**
 * Safety-only adaptation boundary; callers retain approval/edit provenance.
 * Optional active-week logs attach only to original context pins, never to edited
 * candidate definitions. Pins are exact by default. The explicit partial-workout
 * option permits only proved unperformed amendments. Advisory policy relaxes
 * training references, never supported-profile, resource or recorded-work checks.
 * Unchanged recorded pins may retain independently proved pre-week weight metadata;
 * this preservation is not permission to author new weight prescriptions.
 */
export function validateAuthoredSessions(
  value: PlanWeekInput,
  proposedSessions: readonly Session[],
  logs: Readonly<Record<string, SessionLog>> = {},
  options: AuthoredSessionValidationOptions = {},
): AuthoredSessionValidationResult {
  try {
    const configurationValidator = new Validator()
    const configuration = configurationValidator.finish(configurationValidator.object(
      options, 'options', ['allowPartialWorkoutAmendments', 'policy']))
    const policyOptions: AuthoredPolicyOptions = Object.hasOwn(configuration, 'policy')
      ? { policy: configuration.policy as AuthoredPolicyOptions['policy'] } : {}
    const input = parseAuthoredPlanWeekInput(value, policyOptions)
    const v = new Validator(policyOptions)
    const allowPartial = Object.hasOwn(configuration, 'allowPartialWorkoutAmendments')
      ? v.boolean(configuration.allowPartialWorkoutAmendments, 'options.allowPartialWorkoutAmendments') : false
    const sessions = v.array(proposedSessions, 'sessions', 0,
      v.aiAdvisory ? AI_ADVISORY_LIMITS.maxSessions : LIMITS.maxHistorySessions)
      .map((session, index) => v.session(session, `sessions[${index}]`))
    v.unique(sessions, session => session.id, 'sessions')
    const pins = new Map(input.context.pinnedSessions.map(pin => [pin.id, pin]))
    const logData = v.object(logs, 'logs', [...new Set([...sessions.map(session => session.id), ...pins.keys()])])
    const recent = [...input.context.recentSessions]
    for (const [id, data] of Object.entries(logData)) {
      const log = v.log(data, `logs.${id}`)
      const pin = pins.get(id)
      if (!pin) {
        v.issue(`logs.${id}`, 'requires the original session in input.context.pinnedSessions; completed work cannot be defined by an edited candidate')
        continue
      }
      if (log.sessionId !== id) v.issue(`logs.${id}.sessionId`, 'must match its log-map key')
      v.associate(pin, log, `logs.${id}`)
      const previous = recent.find(record => record.session.id === id)
      if (previous) {
        if (JSON.stringify(previous.log) !== JSON.stringify(log)) {
          v.issue(`logs.${id}`, 'conflicts with the immutable actual already supplied in context.recentSessions')
        }
      } else {
        recent.push({ session: pin, log })
      }
    }
    v.finish(undefined)
    const withLogs = parseAuthoredPlanWeekInput({
      ...input, context: { ...input.context, recentSessions: recent },
    }, policyOptions)
    const partialAmendments = new Set<string>()
    const amendmentViolations: SafetyViolation[] = []
    if (allowPartial) for (const original of withLogs.context.pinnedSessions) {
      const candidate = sessions.find(session => session.id === original.id)
      const log = withLogs.context.recentSessions.find(record => record.session.id === original.id)?.log
      if (!candidate || samePreservedSession(original, candidate) || original.kind !== 'workout' || log?.status !== 'partial') continue
      const issue = partialAmendmentIssue(original, candidate, log)
      if (issue) amendmentViolations.push({ rule: 'authoredPartialAmendment', sessionIds: [original.id], message: issue })
      else partialAmendments.add(original.id)
    }
    const violations = [...amendmentViolations, ...authoredSafety(withLogs, sessions, {
      advisory: v.aiAdvisory, partialAmendments, accountPartialSets: allowPartial || v.aiAdvisory,
      preservedWeightBlocks: preservedHistoricalWeights(withLogs, sessions, partialAmendments),
    })]
    return advisoryResult(withLogs, violations, policyOptions)
  } catch (cause) {
    if (!(cause instanceof InputError) && !(cause instanceof RangeError)) throw cause
    return { passed: false, violations: [{
      rule: 'invalidAuthoredSafetyInput', sessionIds: [],
      message: `Authored safety could not be established: ${cause instanceof Error ? cause.message : 'invalid input'}.`,
    }] }
  }
}

/** No search, omissions, rescheduling, baseline changes or approval. Policy opt-in is explicit. */
export function buildAuthoredWeek(
  value: PlanWeekInput, proposed: AuthoredWeekProposal, options: AuthoredPolicyOptions = {},
): WeekPlan {
  const input = parseAuthoredPlanWeekInput(value, options)
  const proposal = parseAuthoredWeekProposal(proposed, options)
  const weekStart = addDays(input.block.startDate, input.weekIndex * 7)
  if (proposal.weekStart !== weekStart) error(`Proposal weekStart must equal requested week ${weekStart}.`)
  const sessions = assemble(input, proposal, options)
  const advisory = options.policy === 'ai-advisory'
  if (advisory) {
    const v = new Validator(options)
    v.array(sessions, 'sessions', 0, AI_ADVISORY_LIMITS.maxSessions)
      .forEach((session, index) => v.session(session, `sessions[${index}]`))
    v.finish(undefined)
  }
  const violations = authoredSafety(input, sessions, advisory ? {
    advisory: true,
    accountPartialSets: true,
    preservedWeightBlocks: preservedHistoricalWeights(input, sessions, new Set()),
  } : {})
  let penalties: WeekPlan['penalties'] = []
  try {
    penalties = scoreSessions(input, sessions)
    if (advisory) penalties = penalties.map(penalty => penalty.rule === 'hardDaysAdjacent' ? {
      ...penalty,
      explanation: 'Consecutive days meet estimated hard-session AU. This is an advisory scheduling reference, not a training veto or measured recovery.',
    } : penalty)
  } catch (cause) {
    if (!(cause instanceof InputError) && !(cause instanceof RangeError)) throw cause
    violations.push({ rule: 'authoredScoringInput', sessionIds: [],
      message: `Scheduling estimates could not be established: ${cause instanceof Error ? cause.message : 'invalid input'}.` })
  }
  const safety = advisoryResult(input, violations, options)
  const { passed } = safety
  const phase = input.block.phases.find(phase => phase.startWeekIndex <= input.weekIndex && phase.endWeekIndex >= input.weekIndex)!
  return {
    engineVersion: ENGINE_VERSION, policyVersion: advisory ? AI_ADVISORY_POLICY_VERSION : AUTHORED_WEEK_POLICY.version,
    libraryVersion: input.library.version, weekIndex: input.weekIndex, weekStart, phase: phase.kind,
    intent: advisory
      ? 'AI-authored whole-week proposal; training rules advisory, human approval remains required.'
      : 'Authored whole-week proposal within confirmed baseline; human approval remains required.',
    sessions, totalScore: penalties.reduce((sum, penalty) => sum + penalty.score, 0), penalties,
    warnings: advisory ? [
      'Training rules are advisory: frequency, rest, recovery, baseline comparisons and administrative dose references do not veto this AI-authored plan.',
      'Finite schema bounds are representation limits, not medically safe ranges. Only supported movement units, identities and confirmed resources are represented.',
      'Confirmed baselines and recorded pain, illness and actual overruns remain factual. Passing integrity checks is not training safety, recovery clearance or human approval.',
      'Scheduling AU and residual estimates are not measured physiology. No baseline capacity or weight observation is inferred.',
      ...(safety.advisories ?? []).map(item => `[${item.rule}] ${item.sessionIds.length ? `${item.sessionIds.join(', ')}: ` : ''}${item.message}`),
    ] : [
      'Authored v1 never increases confirmed baseline or changes fixed/pinned work. Exercise profile ceilings are administrative policies, not validated injury-safe thresholds.',
      'Only conversational conditioning and supported controlled exercise profiles are prescribed. Custom throws share existing confirmed practice exposure.',
      'Scheduling AU and residual estimates are not measured physiology. Passing validation is not human approval.',
    ],
    omitted: [], feasibility: { fits: passed, issues: safety.violations.map(violation => violation.message),
      suggestions: passed ? [] : [advisory
        ? 'Correct invalid data, unsupported identities/resources or changes to immutable recorded/fixed work; training advisories alone do not require revision.'
        : 'Revise the proposal or explicitly reconfirm baseline outside the AI proposal; the deterministic planner remains available.'] },
    safety: { passed, violations: safety.violations }, audit: { candidatesScored: 1, rejectedBySafety: passed ? 0 : 1 },
  }
}
