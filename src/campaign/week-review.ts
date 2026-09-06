import type { BlockLog, Session, SessionLog, SetLog, SkipReason, WorkoutBlock } from '../../engine/types.ts'
import type { CampaignState } from './types.ts'

export interface WeekReviewSession {
  id: string
  date: string
  kind: Session['kind']
  discipline: Session['discipline']
  modality: Session['modality']
  label: string | null
  status: SessionLog['status'] | 'removed' | 'unlogged'
  skipReason: SkipReason | null
  plannedDurationMin: number
  actualDurationMin: number | null
  actualEffort: number | null
  durationOverrunMin: number | null
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
    partial: number
    skipped: number
    skippedTime: number
    skippedFatigue: number
    removed: number
    unlogged: number
    omitted: number
  }
  sessions: WeekReviewSession[]
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

function sessionReview(session: Session, log: SessionLog | undefined, removed: boolean): WeekReviewSession {
  const duration = log?.actualDurationMin ?? null
  return {
    id: session.id, date: session.date, kind: session.kind, discipline: session.discipline, modality: session.modality,
    label: 'label' in session ? session.label : null,
    status: log?.status ?? (removed ? 'removed' : 'unlogged'),
    skipReason: log?.skipReason ?? null,
    plannedDurationMin: session.durationMin,
    actualDurationMin: duration,
    actualEffort: log?.actualEffort ?? null,
    durationOverrunMin: duration === null ? null : Math.max(0, duration - session.durationMin),
    plannedBlocks: session.kind === 'workout' ? session.blocks.map(block => ({ ...block })) : null,
    plannedStrength: session.kind === 'strength' ? session.strengthPrescription.map(item => ({ ...item })) : null,
    sets: log?.sets === undefined ? null : log.sets.map(actualSet),
    blockLogs: log?.blockLogs === undefined ? null : log.blockLogs.map(actualBlock),
    ...(log?.painFlag === undefined ? {} : { painFlag: log.painFlag }),
    ...(log?.notes === undefined ? {} : { notes: log.notes }),
  }
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
    ...week.plan.sessions.map(session => sessionReview(session, week.logs[session.id], false)),
    ...week.removed.map(session => sessionReview(session, week.logs[session.id], true)),
  ].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const count = (status: WeekReviewSession['status']) => sessions.filter(session => session.status === status).length
  return {
    version: 1,
    weekIndex: week.plan.weekIndex,
    weekStart: week.plan.weekStart,
    counts: {
      completed: count('completed'), partial: count('partial'), skipped: count('skipped'),
      skippedTime: sessions.filter(session => session.status === 'skipped' && session.skipReason === 'life').length,
      skippedFatigue: sessions.filter(session => session.status === 'skipped' && session.skipReason === 'too_tired').length,
      removed: count('removed'), unlogged: count('unlogged'), omitted: week.plan.omitted.length,
    },
    sessions,
    omitted: week.plan.omitted.map(item => ({ sessionId: item.sessionId, reason: item.reason })),
  }
}
