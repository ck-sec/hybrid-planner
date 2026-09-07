import type { AthleteState, BlockLog, Session, SessionLog, SetLog, SkipReason, WorkoutBlock } from '../../engine/types.ts'
import type { CampaignState } from './types.ts'
import { parseSessionFeedback, sessionPaceMinPerKm } from './training-feedback.ts'
import type { SessionFeedback } from './training-feedback.ts'

export interface WeekReviewSession {
  id: string
  date: string
  kind: Session['kind']
  discipline: Session['discipline']
  modality: Session['modality']
  label: string | null
  status: SessionLog['status'] | 'finished_early' | 'removed' | 'unlogged'
  skipReason: SkipReason | null
  plannedDurationMin: number
  actualDurationMin: number | null
  actualEffort: number | null
  feedback: SessionFeedback | null
  actualPaceMinPerKm: number | null
  durationOverrunMin: number | null
  plannedEndurance: Extract<Session, { kind: 'run' }>['endurancePrescription'] | null
  plannedBlocks: readonly WorkoutBlock[] | null
  plannedStrength: Extract<Session, { kind: 'strength' }>['strengthPrescription'] | null
  sets: readonly SetLog[] | null
  blockLogs: readonly WeekReviewBlock[] | null
  painFlag?: boolean
  notes?: string
}

export type WeekReviewBlock = Exclude<BlockLog, { unit: 'seconds' }> | {
  unit: 'seconds'
  blockIndex: number
  exerciseId: string
  seconds: number
  weightKg: number | null
}

export interface WeekReview {
  version: 1
  weekIndex: number
  weekStart: string
  counts: {
    completed: number
    finishedEarly: number
    partial: number
    skipped: number
    skippedTime: number
    skippedFatigue: number
    removed: number
    unlogged: number
    omitted: number
  }
  sessions: WeekReviewSession[]
  observations: string[]
  healthHold?: AthleteState['safetyHold']
  changes?: Array<{ id: string; message: string }>
  omitted: Array<{ sessionId: string; reason: string }>
}

function actualSet(set: SetLog): SetLog {
  return { exerciseId: set.exerciseId, weightKg: set.weightKg, reps: set.reps, actualRPE: set.actualRPE }
}

function actualBlock(block: BlockLog): WeekReviewBlock {
  if (block.unit === 'reps') return {
    unit: block.unit, blockIndex: block.blockIndex, exerciseId: block.exerciseId, sets: block.sets.map(actualSet),
  }
  if (block.unit === 'seconds') return {
    unit: block.unit, blockIndex: block.blockIndex, exerciseId: block.exerciseId, seconds: block.seconds,
    weightKg: block.weightKg ?? null,
  }
  return { unit: block.unit, blockIndex: block.blockIndex, drillId: block.drillId, throws: block.throws }
}

function sessionReview(session: Session, log: SessionLog | undefined, removed: boolean, feedback?: SessionFeedback): WeekReviewSession {
  const duration = log?.actualDurationMin ?? null
  const submitted = feedback === undefined ? null : parseSessionFeedback(feedback)
  return {
    id: session.id, date: session.date, kind: session.kind, discipline: session.discipline, modality: session.modality,
    label: 'label' in session ? session.label : null,
    status: log?.status === 'completed' && submitted?.outcome === 'finished_early' ? 'finished_early'
      : log?.status ?? (removed ? 'removed' : 'unlogged'),
    skipReason: log?.skipReason ?? null,
    plannedDurationMin: session.durationMin,
    actualDurationMin: duration,
    actualEffort: log?.actualEffort ?? null,
    feedback: submitted,
    actualPaceMinPerKm: sessionPaceMinPerKm(duration, submitted?.distanceKm),
    durationOverrunMin: duration === null ? null : Math.max(0, duration - session.durationMin),
    plannedEndurance: session.kind === 'run' ? { ...session.endurancePrescription }
      : session.kind === 'conditioning' ? { ...session.conditioningPrescription } : null,
    plannedBlocks: session.kind === 'workout' ? session.blocks.map(block => ({ ...block })) : null,
    plannedStrength: session.kind === 'strength' ? session.strengthPrescription.map(item => ({ ...item })) : null,
    sets: log?.sets === undefined ? null : log.sets.map(actualSet),
    blockLogs: log?.blockLogs === undefined ? null : log.blockLogs.map(actualBlock),
    ...(log?.painFlag === undefined ? {} : { painFlag: log.painFlag }),
    ...(log?.notes === undefined ? {} : { notes: log.notes }),
  }
}

function feedbackObservations(sessions: readonly WeekReviewSession[]): string[] {
  const observations = [
    'Planned work is context, not performed work. Missing actuals and feedback remain unknown; completion does not fill missing sets or metrics.',
    'Session feeling is a comparison with expectations, not RPE or readiness. Easier or harder feedback does not authorize progression.',
    'Pace is recorded duration divided by reported distance, not a moving-pace measurement. Missing heart rate is not a problem and must not be estimated.',
  ]
  for (const session of sessions) {
    const context = `${session.date} · ${session.label ?? session.kind} (${session.id})`
    if (session.status === 'skipped') {
      observations.push(`${context}: ${session.skipReason === 'life' ? 'Skipped for time/life, not evidence of fatigue.'
        : session.skipReason === 'too_tired' ? 'Skipped for reported fatigue; do not add catch-up work.'
          : `Skipped; reason ${session.skipReason ?? 'unknown'}. Do not infer fatigue.`}`)
    } else if (session.status === 'finished_early') {
      observations.push(`${context}: Stopped early, not full completion. The reason is unknown unless explicitly reported; do not infer fatigue from duration or outcome.`)
    }
    if (session.actualDurationMin !== null) {
      observations.push(`${context}: ${session.plannedDurationMin} min planned; ${session.actualDurationMin} min recorded${session.feedback?.feeling ? `; felt ${session.feedback.feeling.replaceAll('_', ' ')}` : '; feeling unknown'}.`)
    }
    if (session.painFlag) observations.push(`${context}: Pain was reported. Keep health holds; feedback is not clearance to resume or progress.`)
  }
  return observations
}

/** One recorded week only. Missing actuals stay unknown, even on a completed session. */
export function buildWeekReview(state: CampaignState, weekIndex?: number): WeekReview | undefined {
  const week = weekIndex === undefined ? state.weeks.at(-1)
    : state.weeks.find(item => item.plan.weekIndex === weekIndex)
  if (!week) {
    if (weekIndex !== undefined) throw new Error('Choose an existing week for the training review.')
    return undefined
  }
  const sessions = [
    ...week.plan.sessions.map(session => sessionReview(session, week.logs[session.id], false, week.feedback?.[session.id])),
    ...week.removed.map(session => sessionReview(session, week.logs[session.id], true, week.feedback?.[session.id])),
  ].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const count = (status: WeekReviewSession['status']) => sessions.filter(session => session.status === status).length
  return {
    version: 1,
    weekIndex: week.plan.weekIndex,
    weekStart: week.plan.weekStart,
    counts: {
      completed: count('completed'), finishedEarly: count('finished_early'), partial: count('partial'), skipped: count('skipped'),
      skippedTime: sessions.filter(session => session.status === 'skipped' && session.skipReason === 'life').length,
      skippedFatigue: sessions.filter(session => session.status === 'skipped' && session.skipReason === 'too_tired').length,
      removed: count('removed'), unlogged: count('unlogged'), omitted: week.plan.omitted.length,
    },
    sessions,
    observations: feedbackObservations(sessions),
    ...(week.input.athlete.safetyHold ? { healthHold: structuredClone(week.input.athlete.safetyHold) } : {}),
    changes: week.changes.map(change => ({ id: change.id, message: change.message })),
    omitted: week.plan.omitted.map(item => ({ sessionId: item.sessionId, reason: item.reason })),
  }
}
