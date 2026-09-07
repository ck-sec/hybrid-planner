import { completeCampaignSession } from './model.ts'
import type { SetLog, WorkoutSession } from '../../engine/types.ts'
import type { CampaignState } from './types.ts'

export interface SessionFeedback {
  version: 1
  feeling: 'easier' | 'as_expected' | 'harder' | null
  outcome: 'finished' | 'finished_early'
  distanceKm?: number
  averageHr?: number
  note?: string
}

export const SESSION_FEELING_LABELS = {
  easier: 'Easier than expected',
  as_expected: 'As expected',
  harder: 'Harder than expected',
} as const

export function parseSessionFeedback(value: unknown): SessionFeedback {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('Session feedback must be a plain object.')
  }
  const allowed = ['version', 'feeling', 'outcome', 'distanceKm', 'averageHr', 'note']
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new Error('Session feedback contains an unsupported field or property.')
    }
  }
  const raw = value as Record<string, unknown>
  if (['version', 'feeling', 'outcome'].some(key => !Object.hasOwn(raw, key))) {
    throw new Error('Session feedback requires version, feeling and outcome fields.')
  }
  if (raw.version !== 1) throw new Error('Session feedback version must be 1.')
  if (raw.feeling !== null && raw.feeling !== 'easier' && raw.feeling !== 'as_expected' && raw.feeling !== 'harder') {
    throw new Error('Choose easier, as expected, harder, or leave the feeling unknown.')
  }
  if (raw.outcome !== 'finished' && raw.outcome !== 'finished_early') {
    throw new Error('Session feedback needs an explicit finished or finished_early outcome.')
  }
  const feedback: SessionFeedback = { version: 1, feeling: raw.feeling, outcome: raw.outcome }
  if (Object.hasOwn(raw, 'distanceKm')) {
    if (typeof raw.distanceKm !== 'number' || !Number.isFinite(raw.distanceKm) || raw.distanceKm <= 0) {
      throw new Error('Recorded distance must be a finite number greater than zero, in kilometres.')
    }
    feedback.distanceKm = raw.distanceKm
  }
  if (Object.hasOwn(raw, 'averageHr')) {
    if (typeof raw.averageHr !== 'number' || !Number.isFinite(raw.averageHr) || raw.averageHr <= 0 || raw.averageHr > 300) {
      throw new Error('Average heart rate must be a finite number greater than zero and at most 300 bpm.')
    }
    feedback.averageHr = raw.averageHr
  }
  if (Object.hasOwn(raw, 'note')) {
    if (typeof raw.note !== 'string' || raw.note.length > 500) throw new Error('Feedback note must be text of at most 500 characters.')
    feedback.note = raw.note
  }
  return feedback
}

/** A duration/distance ratio, not a target pace or a measurement of moving time. */
export function sessionPaceMinPerKm(durationMin: number | null | undefined, distanceKm: number | undefined): number | null {
  if (durationMin === null || durationMin === undefined || distanceKm === undefined
    || !Number.isFinite(durationMin) || durationMin < 0 || !Number.isFinite(distanceKm) || distanceKm <= 0) return null
  const pace = durationMin / distanceKm
  return Number.isFinite(pace) ? pace : null
}

export function formatSessionPace(durationMin: number | null | undefined, distanceKm: number | undefined): string | null {
  const pace = sessionPaceMinPerKm(durationMin, distanceKm)
  if (pace === null) return null
  const seconds = Math.round(pace * 60)
  if (!Number.isSafeInteger(seconds)) return null
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} min/km`
}

export function lastRecordedBlockSet(state: CampaignState, session: WorkoutSession, blockIndex: number): SetLog | undefined {
  const week = state.weeks[state.selectedWeek]
  const block = session.blocks[blockIndex]
  if (!block || block.unit !== 'reps') return undefined
  const own = week.logs[session.id]
  const ownBlock = own?.blockLogs?.find(item => item.blockIndex === blockIndex && item.unit === 'reps' && item.exerciseId === block.exerciseId)
  if (!own?.painFlag && ownBlock?.unit === 'reps' && ownBlock.sets.length) return { ...ownBlock.sets.at(-1)! }
  const exercise = week.input.library.exercises.find(item => item.id === block.exerciseId)
  const custom = week.input.athlete.program?.customExercises?.find(item => item.id === block.exerciseId)
  const beforeSession = `${session.date}|${session.startTime ?? '00:00'}`
  const candidates = state.weeks.slice(0, state.selectedWeek + 1).flatMap(previousWeek => {
    if (previousWeek.input.library.version !== week.input.library.version
      || JSON.stringify(previousWeek.input.library.exercises.find(item => item.id === block.exerciseId)) !== JSON.stringify(exercise)
      || JSON.stringify(previousWeek.input.athlete.program?.customExercises?.find(item => item.id === block.exerciseId)) !== JSON.stringify(custom)) return []
    return previousWeek.plan.sessions.flatMap(previousSession => {
      const position = `${previousSession.date}|${previousSession.startTime ?? '00:00'}`
      const previousLog = previousWeek.logs[previousSession.id]
      if ((previousWeek === week && previousSession.id === session.id) || position >= beforeSession
        || (previousSession.date === session.date && (!previousSession.startTime || !session.startTime))
        || !previousLog || previousLog.painFlag || previousLog.status === 'skipped') return []
      const sets = previousSession.kind === 'workout' ? (previousLog.blockLogs ?? []).flatMap(record => {
        const prescribed = previousSession.blocks[record.blockIndex]
        return record.unit === 'reps' && record.exerciseId === block.exerciseId
          && prescribed?.unit === 'reps' && prescribed.exerciseId === block.exerciseId && prescribed.executionStyle === block.executionStyle ? record.sets : []
      }) : previousSession.kind === 'strength' ? previousLog.sets?.filter(set => set.exerciseId === block.exerciseId) ?? [] : []
      return sets.length ? [{ position, id: previousSession.id, set: sets.at(-1)! }] : []
    })
  }).sort((a, b) => a.position.localeCompare(b.position) || a.id.localeCompare(b.id))
  const last = candidates.at(-1)?.set
  return last ? { ...last } : undefined
}

export function finishWithFeedback(
  state: CampaignState, sessionId: string, actualDuration: number, effort: number, pain: boolean, feedback: SessionFeedback,
): CampaignState {
  const parsed = parseSessionFeedback(feedback)
  const selected = state.weeks[state.selectedWeek]
  const session = selected?.plan.sessions.find(item => item.id === sessionId)
  if ((parsed.distanceKm !== undefined || parsed.averageHr !== undefined) && session?.discipline !== 'run') {
    throw new Error('Distance and average heart rate feedback are available for running sessions only.')
  }
  const finished = completeCampaignSession(state, sessionId, actualDuration, effort, pain)
  return {
    ...finished,
    weeks: finished.weeks.map((week, index) => index !== state.selectedWeek ? week : {
      ...week,
      feedback: { ...week.feedback, [sessionId]: parsed },
      // The engine's terminal status stays completed; the explicit outcome distinguishes stopped work.
      changes: parsed.outcome === 'finished_early' ? week.changes.map((change, changeIndex) =>
        changeIndex === selected.changes.length ? { ...change, message: change.message.replace(/^Completed /, 'Stopped early: ') } : change,
      ) : week.changes,
    }),
  }
}
