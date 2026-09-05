import {
  AGGRESSIVENESS_VOLUME_FRACTION, ENGINE_VERSION, LIMITS, POLICY_VERSION, RECOMMENDATION_POLICY, SAFETY,
} from './constants.ts'
import { addDays, dayNumber } from './dates.ts'
import { predictSessionLoad } from './load.ts'
import { latestPerformance } from './observations.ts'
import { scoreSessions } from './scoring.ts'
import { checkSafety } from './safety.ts'
import type {
  CommitmentSession, PlanWeekInput, Session, StrengthPrescription, WeekPlan,
} from './types.ts'
import { InputError, parsePlanWeekInput } from './validation.ts'

/** Templates ask for block-frozen pattern assignments, never a hardcoded exercise name. */
export function requestedSessions(input: PlanWeekInput): Session[] {
  const { athlete, block, weekIndex, library } = input
  const baseline = athlete.baseline
  const weekStart = addDays(block.startDate, weekIndex * 7)
  const phase = block.phases.find(item => item.startWeekIndex <= weekIndex && item.endWeekIndex >= weekIndex)
  if (!phase) throw new InputError(['No phase covers the requested week.'])
  const fraction = Math.min(
    phase.volumeFraction,
    AGGRESSIVENESS_VOLUME_FRACTION[athlete.aggressiveness],
    weekIndex === 0 ? SAFETY.calibrationWeekVolumeFraction : 1,
  )
  const totalMinutes = Math.floor(baseline.weeklyRunMinutes * fraction)
  const sessions: Session[] = []
  for (let index = 0; index < baseline.runsPerWeek; index++) {
    const minutes = Math.min(
      baseline.longestRunMinutes,
      Math.floor(totalMinutes / baseline.runsPerWeek) + (index < totalMinutes % baseline.runsPerWeek ? 1 : 0),
    )
    if (minutes < 1) continue
    const session: Session = {
      id: `run-${index + 1}-${weekStart}`,
      kind: 'run', discipline: 'run', modality: 'run_road', date: weekStart,
      startTime: athlete.defaultStartTime, durationMin: minutes,
      predictedLoad: { systemic: 0, structural: 0 },
      endurancePrescription: { intent: 'easy', effort: 'conversational' },
      pinned: false, isCalibration: weekIndex === 0, reason: '',
    }
    session.predictedLoad = predictSessionLoad(session, athlete, library)
    sessions.push(session)
  }
  const prescriptions: StrengthPrescription[] = block.anchors.map(anchor => {
    const observation = baseline.exercises.find(item => item.exerciseId === anchor.exerciseId)
    if (!observation && !anchor.provenance) throw new InputError([`Anchor ${anchor.exerciseId} has no same-exercise observation.`])
    const prescription: StrengthPrescription = {
      exerciseId: anchor.exerciseId,
      sets: Math.max(1, Math.floor(Math.min(anchor.sets, observation?.sets ?? anchor.sets) * fraction)),
      reps: Math.min(anchor.reps, observation?.reps ?? anchor.reps),
      targetRPE: anchor.targetRPE,
      role: anchor.role,
    }
    const latest = latestPerformance(input, anchor.exerciseId)
    if (latest && latest.reps === prescription.reps && latest.actualRPE === prescription.targetRPE) {
      prescription.suggestedWeightKg = latest.weightKg
    }
    return prescription
  })
  if (athlete.recommendedExerciseIds) {
    let totalSets = prescriptions.reduce((sum, item) => sum + item.sets, 0)
    let totalReps = prescriptions.reduce((sum, item) => sum + item.sets * item.reps, 0)
    while (totalSets > RECOMMENDATION_POLICY.maxSessionSets || totalReps > RECOMMENDATION_POLICY.maxSessionReps) {
      const item = [...prescriptions].reverse().find(item => item.sets > 1)
      if (!item) break
      item.sets--
      totalSets--
      totalReps -= item.reps
    }
  }
  for (let index = 0; index < baseline.liftsPerWeek; index++) {
    const session: Session = {
      id: `strength-${index + 1}-${weekStart}`, kind: 'strength', discipline: 'strength', modality: 'lifting',
      date: weekStart, startTime: athlete.defaultStartTime,
      durationMin: Math.max(1, Math.floor(baseline.liftDurationMin * fraction)),
      strengthPrescription: prescriptions.map(item => ({ ...item })),
      predictedLoad: { systemic: 0, structural: 0 }, pinned: false,
      isCalibration: weekIndex === 0 || block.anchors.some(anchor =>
        anchor.provenance?.kind === 'recommended' && latestPerformance(input, anchor.exerciseId) === null), reason: '',
    }
    session.predictedLoad = predictSessionLoad(session, athlete, library)
    sessions.push(session)
  }
  return sessions
}

export function fixedSessions(input: PlanWeekInput): CommitmentSession[] {
  const weekStart = addDays(input.block.startDate, input.weekIndex * 7)
  return [...input.block.goal.fixedCommitments]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map((commitment, index) => ({
      id: `fixed-${index + 1}-${weekStart}`,
      kind: 'commitment', discipline: commitment.discipline, modality: commitment.modality,
      date: addDays(weekStart, commitment.dayOfWeek), startTime: commitment.startTime,
      durationMin: commitment.durationMin, predictedLoad: { ...commitment.estimatedLoad },
      label: commitment.label, pinned: true, isCalibration: false,
      reason: 'An established commitment. Its time and workload are not changed by the optimizer.',
    }))
}

function samePrescription(a: Session, b: Session): boolean {
  if (a.id !== b.id || a.kind !== b.kind || a.discipline !== b.discipline || a.modality !== b.modality
    || a.durationMin !== b.durationMin || a.isCalibration !== b.isCalibration
    || a.predictedLoad.systemic !== b.predictedLoad.systemic || a.predictedLoad.structural !== b.predictedLoad.structural) return false
  if (a.kind === 'run' && b.kind === 'run') {
    return a.endurancePrescription.intent === b.endurancePrescription.intent
      && a.endurancePrescription.effort === b.endurancePrescription.effort
  }
  if (a.kind === 'strength' && b.kind === 'strength') {
    return a.strengthPrescription.length === b.strengthPrescription.length
      && a.strengthPrescription.every((item, index) => {
        const other = b.strengthPrescription[index]
        return item.exerciseId === other.exerciseId && item.sets === other.sets && item.reps === other.reps
          && item.targetRPE === other.targetRPE && item.suggestedWeightKg === other.suggestedWeightKg && item.role === other.role
      })
  }
  return a.kind === 'commitment' && b.kind === 'commitment' && a.label === b.label
}

function keyFor(sessions: readonly Session[]): string {
  return [...sessions].sort(compareSessions).map(session => `${session.date}|${session.startTime ?? '??:??'}|${session.id}`).join(';')
}

function compareSessions(a: Session, b: Session): number {
  const keyA = `${a.date}|${a.startTime ?? '??:??'}|${a.id}`
  const keyB = `${b.date}|${b.startTime ?? '??:??'}|${b.id}`
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
}

interface RankedCandidate { sessions: Session[]; score: number; key: string }

export function planWeek(rawInput: PlanWeekInput): WeekPlan {
  const input = parsePlanWeekInput(rawInput)
  const weekStart = addDays(input.block.startDate, input.weekIndex * 7)
  const phase = input.block.phases.find(item => item.startWeekIndex <= input.weekIndex && item.endWeekIndex >= input.weekIndex)
  if (!phase) throw new InputError(['No phase covers the requested week.'])
  const requested = requestedSessions(input)
  const fixed = fixedSessions(input)
  const pinned = [...input.context.pinnedSessions]
  const issues: string[] = []
  for (const pin of pinned) {
    const original = requested.find(session => session.id === pin.id)
    if (!original || !pin.pinned || !samePrescription(pin, original)) {
      issues.push(`Pin ${pin.id} must preserve a requested session's workload and prescription; only its date and time may change.`)
    }
  }
  if (issues.length) throw new InputError(issues)
  const movable = requested.filter(session => !pinned.some(pin => pin.id === session.id))
  const mandatory: Session[] = [...fixed, ...pinned]
  const days = [...input.athlete.availableDays]
    .filter(day => dayNumber(addDays(weekStart, day)) <= dayNumber(input.block.goal.peakDate))
    .sort((a, b) => a - b)
  let candidatesScored = 0
  let rejectedBySafety = 0
  let exhausted = false
  const rejectedReasons = new Set<string>()
  let chosen: RankedCandidate | null = null
  const mandatorySafety = checkSafety(input, mandatory)
  const warnings: string[] = [
    'Systemic and structural values are estimated scheduling costs in arbitrary units, not measurements, readiness scores, or injury predictions.',
    'This version reduces or maintains established workloads. Base/build/peak labels describe the block arc; they do not add intensity or promise a performance peak.',
    'RPE 8 means approximately 2 repetitions in reserve; RPE 9 means approximately 1. Starting kilograms are suggested only from a matching observation of that same exercise.',
    'Times use one planning-local calendar; daylight-saving changes are not modeled. Check real elapsed recovery around clock changes.',
    'Recovery half-lives are fixed estimates. Logged session effort is kept separate; the app does not fit physiological recovery from it.',
  ]
  const highSkill = input.athlete.baseline.exercises.filter(observation =>
    input.library.exercises.some(exercise => exercise.id === observation.exerciseId && exercise.highSkill))
  if (highSkill.length) warnings.push(`High-skill observations are retained for history but not prescribed: ${highSkill.map(item => item.exerciseId).join(', ')}.`)
  if (input.weekIndex === 0) warnings.push('Calibration week: optional work starts at 60% of the established baseline, with at least one set per selected exercise. It is excluded from model learning.')
  if (input.athlete.recommendedExerciseIds) warnings.push(
    'Selected exercises without observations use the versioned first-exposure policy, not invented lifting history. Initial sets may be reduced; starting kilograms require your own completed matching set log.',
    `Recommended strength sessions are independently limited to ${RECOMMENDATION_POLICY.maxSessionSets} working sets and ${RECOMMENDATION_POLICY.maxSessionReps} repetitions in total; adding cards never bypasses that cap.`,
  )

  // Missing mandatory work is never an optimizer option. If it already fails
  // the floor, more sessions cannot repair that conflict.
  if (mandatorySafety.passed) {
    for (let count = movable.length; count >= 0 && !chosen && !exhausted; count--) {
      const current: Session[] = [...mandatory]
      const optionalDays = new Set(pinned.map(pin => pin.date))
      const best: { value: RankedCandidate | null } = { value: null }
      function visit(index: number, retained: number): void {
        if (exhausted) return
        if (retained === count) {
          if (candidatesScored >= LIMITS.maxCandidates) { exhausted = true; return }
          candidatesScored++
          const penalties = scoreSessions(input, current)
          const score = penalties.reduce((sum, penalty) => sum + penalty.score, 0)
          if (!Number.isFinite(score)) throw new Error('A scoring rule returned a non-finite total.')
          const safety = checkSafety(input, current)
          if (!safety.passed) {
            rejectedBySafety++
            safety.violations.forEach(violation => rejectedReasons.add(violation.message))
            return
          }
          const key = keyFor(current)
          if (!best.value || score < best.value.score || (score === best.value.score && key < best.value.key)) {
            best.value = { sessions: [...current].sort(compareSessions), score, key }
          }
          return
        }
        if (index >= movable.length || movable.length - index < count - retained) return
        const session = movable[index]
        // Equal-work sessions are interchangeable. Keep their IDs in date order
        // rather than enumerating factorially many copies of the same week.
        const priorEquivalent = current.slice(mandatory.length).filter(previous =>
          samePrescription({ ...previous, id: session.id }, session)).at(-1)
        for (const day of days) {
          const date = addDays(weekStart, day)
          if (optionalDays.has(date) || (priorEquivalent && date <= priorEquivalent.date)) continue
          optionalDays.add(date)
          current.push({ ...session, date })
          visit(index + 1, retained + 1)
          current.pop()
          optionalDays.delete(date)
        }
        visit(index + 1, retained)
      }
      visit(0, 0)
      chosen = best.value
    }
  } else {
    mandatorySafety.violations.forEach(violation => rejectedReasons.add(violation.message))
  }

  const selected = chosen ? chosen.sessions : mandatory
  const penalties = scoreSessions(input, selected)
  const totalScore = penalties.reduce((sum, penalty) => sum + penalty.score, 0)
  const safety = checkSafety(input, selected)
  const selectedIds = new Set(selected.map(session => session.id))
  const omitted = requested.filter(session => !selectedIds.has(session.id))
    .map(session => ({
      sessionId: session.id,
      reason: 'Not scheduled: it could not be retained within availability, time, and the independent safety floor. No work is redistributed.',
    }))
  if (exhausted) warnings.push('The deterministic search limit was reached. The best checked safe arrangement is shown, not a claim of global optimality.')
  if (!safety.passed) warnings.push('No usable week is available. Fixed/pinned commitments are shown only to explain the conflict, not as a training recommendation.')
  if (omitted.length) warnings.push(...[...rejectedReasons].sort())
  const sessions = selected.map(session => ({
    ...session,
    reason: [
      session.pinned ? 'Time pinned: the optimizer cannot move this session.' : 'Placed by deterministic finite scoring, then independently checked against the safety floor.',
      ...(penalties.filter(penalty => penalty.affectedSessionIds.includes(session.id)).map(penalty => penalty.explanation)),
      session.kind === 'commitment' ? 'Existing commitment; the engine did not prescribe this activity.'
        : session.kind === 'strength' && input.athlete.recommendedExerciseIds
          ? 'Selected new exercises use the versioned first-exposure dose, within your established session time. Skipped work creates no debt.'
          : 'Work stays within the established baseline. Skipped work creates no debt.',
    ].join(' '),
  }))
  return {
    engineVersion: ENGINE_VERSION, policyVersion: POLICY_VERSION, libraryVersion: input.library.version,
    weekIndex: input.weekIndex, weekStart, phase: phase.kind,
    intent: `${phase.kind} week ${input.weekIndex + 1} of ${input.block.totalWeeks}: established workload bounded; no automatic increases.`,
    sessions, totalScore, penalties, warnings, omitted, safety,
    feasibility: {
      fits: safety.passed && omitted.length === 0,
      issues: [...safety.violations.map(violation => violation.message), ...omitted.map(item => `${item.sessionId}: ${item.reason}`)],
      suggestions: safety.passed && !omitted.length ? [] : [
        'Review available days and the time budget without increasing your established workload.',
        'Review conflicting fixed commitments or pins explicitly; the engine will not move them for you.',
        'If pain, illness, or a break has interrupted training, establish an appropriate new baseline before planning again.',
      ],
    },
    audit: { candidatesScored, rejectedBySafety },
  }
}
