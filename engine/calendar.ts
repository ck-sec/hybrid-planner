import { CAMPAIGN_POLICY, DAY_NAMES, LIMITS, SAFETY } from './constants.ts'
import { addDays, dayNumber, dayOfWeek, parseISODate, sessionStartMinutes, timeMinutes } from './dates.ts'
import { predictSessionLoad, residualBefore } from './load.ts'
import { fixedSessions } from './planner.ts'
import { checkSafety } from './safety.ts'
import { scoreSessions } from './scoring.ts'
import type {
  CompletedWeek, PlanWeekInput, RecentSession, SafetyFloorResult, Session, SessionLog, WeekPlan,
} from './types.ts'
import { parsePlanWeekInput } from './validation.ts'

export interface CalendarWeek {
  input: PlanWeekInput
  plan: WeekPlan
  logs: Record<string, SessionLog>
  removed: Session[]
  changes: { id: string; message: string }[]
}

export type CalendarEdit =
  | { type: 'move'; sessionId: string; date: string; startTime: string }
  | { type: 'skip'; sessionId: string; reason: 'too_tired' | 'life' }
  | { type: 'delete'; sessionId: string }

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const position = (session: Session): string => `${session.date}|${session.startTime ?? '00:00'}`
const sortSessions = (sessions: readonly Session[]): Session[] =>
  [...sessions].sort((a, b) => compare(`${position(a)}|${a.id}`, `${position(b)}|${b.id}`))
const logged = (log: SessionLog | undefined): boolean => log?.status === 'completed' || log?.status === 'partial'

export function calendarSessionLabel(session: Session): string {
  const name = session.kind === 'commitment' ? session.label : session.kind === 'strength' ? 'strength session'
    : session.endurancePrescription.intent === 'long' ? 'long run' : 'easy run'
  return `${DAY_NAMES[dayOfWeek(session.date)]}'s ${name} (${session.date})`
}

function interval(session: Session): readonly [number, number] {
  const start = sessionStartMinutes(session) ?? dayNumber(session.date) * 1440
  return [start, start + (session.startTime === null ? 1440 : session.durationMin)]
}

function overlapsSkippedTime(week: CalendarWeek, session: Session): boolean {
  const [start, end] = interval(session)
  return week.removed.some(removed => {
    if (week.logs[removed.id]?.status !== 'skipped') return false
    const [blockedStart, blockedEnd] = interval(removed)
    return start < blockedEnd && blockedStart < end
  })
}

/**
 * A calendar edit explicitly supersedes this week's recurring placements, not the
 * block's recurring template. Keep their stable IDs as exact pins for the safety
 * check; deleting one must not renumber the other commitments or future weeks.
 */
export function calendarSafety(
  input: PlanWeekInput, sessions: readonly Session[], logs: Record<string, SessionLog> = {},
): SafetyFloorResult {
  const safety = checkSafety({
    ...input,
    block: { ...input.block, goal: { ...input.block.goal, fixedCommitments: [] } },
    context: { ...input.context, pinnedSessions: sessions.filter(session => session.pinned) },
  }, sessions)
  const painDates = sessions.filter(session => logs[session.id]?.painFlag).map(position).sort()
  const cutoff = painDates[0]
  const held = cutoff === undefined ? [] : sessions.filter(session =>
    logs[session.id]?.status !== 'completed' && position(session) >= cutoff)
  const violations = [...safety.violations]
  if (held.length) violations.push({
    rule: 'calendarPainHold', sessionIds: held.map(session => session.id),
    message: 'Pain was logged. Future training is on hold; preserved commitments, pins and partial records are shown as conflicts, not actionable training recommendations.',
  })
  return { passed: violations.length === 0, violations }
}

export function assessCalendarPlan(
  input: PlanWeekInput, previous: WeekPlan, sessions: readonly Session[],
  logs: Record<string, SessionLog>, omitted = previous.omitted,
  audit = { candidatesScored: 1, rejectedBySafety: 0 },
): WeekPlan {
  const ordered = sortSessions(sessions)
  const penalties = scoreSessions(input, ordered)
  const totalScore = penalties.reduce((sum, penalty) => sum + penalty.score, 0)
  if (!Number.isFinite(totalScore)) throw new Error('Calendar scoring did not produce a finite result.')
  const safety = calendarSafety(input, ordered, logs)
  const issues = [...safety.violations.map(item => item.message), ...omitted.map(item => item.reason)]
  return {
    ...previous, sessions: ordered, penalties, totalScore, safety, omitted, audit,
    warnings: [...new Set([
      ...previous.warnings,
      ...(!safety.passed ? ['This calendar has an unresolved safety conflict. It is not a usable training recommendation.'] : []),
      ...(omitted.length ? ['Some work is omitted. Skips and deletions create no catch-up debt. Review the feasibility details.'] : []),
    ])],
    feasibility: {
      fits: safety.passed && omitted.length === 0, issues,
      suggestions: issues.length ? ['Review availability, fixed commitments and any health hold; never add work to compensate for a missed session.'] : [],
    },
  }
}

function reduced(session: Session, input: PlanWeekInput): Session | null {
  if (session.kind === 'commitment') return session
  const durationMin = Math.floor(session.durationMin * CAMPAIGN_POLICY.fatigueVolumeFraction)
  if (durationMin < 1) return null
  let result: Session = { ...session, durationMin }
  if (session.kind === 'strength') {
    const strengthPrescription = session.strengthPrescription.map(item => ({
      ...item, sets: Math.max(1, Math.floor(item.sets * CAMPAIGN_POLICY.fatigueVolumeFraction)),
    }))
    // Shortening the clock without reducing any sets is not less strength work.
    if (strengthPrescription.every((item, index) => item.sets === session.strengthPrescription[index]!.sets)) return null
    result = { ...session, durationMin, strengthPrescription }
  }
  return {
    ...result, predictedLoad: predictSessionLoad(result, input.athlete, input.library),
    reason: `${session.reason} Reduced after a fatigue skip; no missed work is redistributed.`,
  }
}

function rearrange(
  week: CalendarWeek, sessions: readonly Session[], cutoff: string,
): { plan: WeekPlan; additionallyRemoved: Session[] } {
  const { input, logs } = week
  const mandatory = sessions.filter(session =>
    session.pinned || session.kind === 'commitment' || logged(logs[session.id]) || position(session) < cutoff)
  const mandatoryIds = new Set(mandatory.map(session => session.id))
  const movable = sortSessions(sessions.filter(session => !mandatoryIds.has(session.id)))
  const start = week.plan.weekStart
  const days = [...input.athlete.availableDays].sort((a, b) => a - b)
    .map(day => addDays(start, day))
    .filter(date => date <= input.block.goal.peakDate)
  let candidatesScored = 0
  let rejectedBySafety = 0
  let exhausted = false
  let best: { sessions: Session[]; score: number; key: string } | undefined
  for (let count = movable.length; count >= 0 && !best && !exhausted; count--) {
    const current = [...mandatory]
    const usedDays = new Set(mandatory.filter(session => session.kind !== 'commitment').map(session => session.date))
    const visit = (index: number, retained: number): void => {
      if (exhausted) return
      if (retained === count) {
        if (candidatesScored >= LIMITS.maxCandidates) { exhausted = true; return }
        candidatesScored++
        const score = scoreSessions(input, current).reduce((sum, item) => sum + item.score, 0)
        if (!Number.isFinite(score)) throw new Error('Calendar score must be finite.')
        // Feasibility is never a weighted term or something a lower score can buy.
        if (!calendarSafety(input, current, logs).passed) { rejectedBySafety++; return }
        const ordered = sortSessions(current)
        const key = ordered.map(session => `${position(session)}|${session.id}`).join(';')
        if (!best || score < best.score || (score === best.score && key < best.key)) best = { sessions: ordered, score, key }
        return
      }
      if (index >= movable.length || movable.length - index < count - retained) return
      const session = movable[index]!
      for (const date of days) {
        if (usedDays.has(date) || `${date}|${session.startTime ?? '00:00'}` < cutoff) continue
        const placed = { ...session, date }
        if (overlapsSkippedTime(week, placed)) continue
        usedDays.add(date)
        current.push(placed)
        visit(index + 1, retained + 1)
        current.pop()
        usedDays.delete(date)
      }
      visit(index + 1, retained)
    }
    visit(0, 0)
  }
  const selected: Session[] = best ? (best as { sessions: Session[] }).sessions : mandatory
  const additionallyRemoved = sessions.filter(session => !selected.some(item => item.id === session.id))
  const omitted = [...week.plan.omitted]
  for (const session of additionallyRemoved) {
    if (!omitted.some(item => item.sessionId === session.id)) omitted.push({
      sessionId: session.id, reason: `${calendarSessionLabel(session)} was left out because no safe placement remained. No catch-up work was added.`,
    })
  }
  let plan = assessCalendarPlan(input, week.plan, selected, logs, omitted, { candidatesScored, rejectedBySafety })
  plan = { ...plan, sessions: plan.sessions.map(session => mandatoryIds.has(session.id) ? session : {
    ...session,
    reason: [
      'Rescored within the remaining calendar after an explicit edit, then independently checked for safety. No workload was increased and no missed work creates debt.',
      ...new Set(plan.penalties.filter(penalty => penalty.affectedSessionIds.includes(session.id)).map(penalty => penalty.explanation)),
    ].join(' '),
  }) }
  if (exhausted) plan = { ...plan, warnings: [...plan.warnings, 'The bounded calendar search stopped at its deterministic limit; only checked placements are shown.'] }
  return { plan, additionallyRemoved }
}

export function adaptCalendarWeek(
  week: CalendarWeek, action: CalendarEdit, notBeforeDate = week.plan.weekStart,
): CalendarWeek {
  parsePlanWeekInput(week.input)
  parseISODate(notBeforeDate)
  if (!['move', 'skip', 'delete'].includes(action.type)) throw new Error('Unknown calendar action.')
  const target = week.plan.sessions.find(session => session.id === action.sessionId)
  if (!target) throw new Error('That session is not on the active calendar. Removed work cannot be reintroduced.')
  if (logged(week.logs[target.id])) throw new Error('Completed or partially logged sessions cannot be moved, skipped or deleted.')
  if (target.date < notBeforeDate) throw new Error(`Past sessions before ${notBeforeDate} cannot be moved, skipped or deleted.`)
  const boundary = `${notBeforeDate < week.plan.weekStart ? week.plan.weekStart : notBeforeDate}|00:00`
  const cutoff = action.type === 'move' ? boundary : position(target) > boundary ? position(target) : boundary
  let sessions = [...week.plan.sessions]
  const logs = { ...week.logs }
  const removed = [...week.removed]
  let message: string
  let omitted = [...week.plan.omitted]
  if (action.type === 'move') {
    parseISODate(action.date)
    timeMinutes(action.startTime)
    if (action.date < week.plan.weekStart || action.date > addDays(week.plan.weekStart, 6)) throw new Error('Move must stay inside the selected week.')
    if (action.date < notBeforeDate) throw new Error(`A move cannot cross the past-date boundary ${notBeforeDate}.`)
    if (target.kind !== 'commitment' && overlapsSkippedTime(week, { ...target, date: action.date, startTime: action.startTime })) {
      throw new Error('That time was marked unavailable by a skipped session. Choose another time; skipped work is not replaced.')
    }
    sessions = sessions.map(session => session.id === target.id ? { ...session, date: action.date, startTime: action.startTime, pinned: true } : session)
    message = `Moved ${calendarSessionLabel(target)} to ${DAY_NAMES[dayOfWeek(action.date)]}, ${action.date} at ${action.startTime}. Its new time is pinned; past sessions, logged work and other pinned sessions are unchanged.`
  } else {
    sessions = sessions.filter(session => session.id !== target.id)
    removed.push(target)
    const fatigue = action.type === 'skip' && action.reason === 'too_tired'
    if (action.type === 'skip') {
      if (action.reason !== 'life' && action.reason !== 'too_tired') throw new Error('Choose a time or fatigue skip reason.')
      logs[target.id] = { sessionId: target.id, status: 'skipped', skipReason: action.reason, painFlag: false, notes: '', actualDurationMin: 0 }
    }
    omitted.push({ sessionId: target.id, reason: action.type === 'delete'
      ? `${calendarSessionLabel(target)} was removed. Record retained; no catch-up.`
      : `${calendarSessionLabel(target)} was skipped ${fatigue ? 'for fatigue' : 'for lack of time'}. Record retained; no catch-up.` })
    if (fatigue) {
      sessions = sessions.flatMap(session => {
        if (position(session) < cutoff || session.pinned || session.kind === 'commitment' || logged(logs[session.id])) return [session]
        const lighter = reduced(session, week.input)
        if (lighter) return [lighter]
        removed.push(session)
        omitted.push({ sessionId: session.id, reason: `${calendarSessionLabel(session)} was left out to reduce workload rather than rush the same sets. No catch-up.` })
        return []
      })
    }
    message = action.type === 'delete'
      ? `Removed ${calendarSessionLabel(target)}. Record retained. Only remaining optional work was rearranged; no catch-up.`
      : fatigue
        ? `Skipped ${calendarSessionLabel(target)} for fatigue. Reduced upcoming optional work; no catch-up. Record retained. The lighter workload continues until a new baseline.`
        : `Skipped ${calendarSessionLabel(target)} for lack of time. Rearranged remaining optional work; no catch-up or fatigue assumed. Record retained.`
  }
  const working = { ...week, logs, removed, plan: { ...week.plan, omitted } }
  const result = rearrange(working, sessions, cutoff)
  if (action.type === 'move' && !result.plan.safety.passed) {
    throw new Error(`Move rejected: ${result.plan.safety.violations.map(item => item.message).join(' ')}`)
  }
  return {
    ...working, plan: result.plan, removed: [...removed, ...result.additionallyRemoved],
    changes: [...week.changes, { id: `change-${week.plan.weekIndex}-${week.changes.length + 1}`,
      message: message + (result.additionallyRemoved.length
        ? ` ${result.additionallyRemoved.length === 1 ? 'One additional session was' : `${result.additionallyRemoved.length} additional sessions were`} left out to keep the remaining week safe and manageable.` : '') }],
  }
}

/** Logged work remains historical fact; unlogged optional work cannot bypass a pain report. */
export function applyCalendarPainHold(week: CalendarWeek, sessionId: string): CalendarWeek {
  const target = week.plan.sessions.find(session => session.id === sessionId)
  if (!target || !week.logs[sessionId]?.painFlag) return week
  const result = rearrange(week, week.plan.sessions, position(target))
  return {
    ...week, plan: result.plan, removed: [...week.removed, ...result.additionallyRemoved],
    changes: [...week.changes, { id: `change-${week.plan.weekIndex}-${week.changes.length + 1}`,
      message: 'Pain logged: future optional work is on hold. Completed/partial work and exact pins are retained. Seek appropriate professional advice; no rehabilitation is inferred.' }],
  }
}

/** Known recurring commitments provide a future boundary without inventing completed work. */
export function followingCommitments(input: PlanWeekInput): Session[] {
  if (input.weekIndex + 1 >= input.block.totalWeeks) return []
  return fixedSessions({ ...input, weekIndex: input.weekIndex + 1 })
}

export function nextCalendarInput(weeks: readonly CalendarWeek[]): PlanWeekInput {
  const previous = weeks.at(-1)
  if (!previous) throw new Error('Build the first week before advancing.')
  const weekIndex = previous.input.weekIndex + 1
  if (weekIndex >= previous.input.block.totalWeeks) throw new Error('The event week is already reached. Start a newly confirmed campaign for a new goal.')
  const start = addDays(previous.input.block.startDate, weekIndex * 7)
  const records = new Map<string, RecentSession>()
  for (const record of previous.input.context.recentSessions) records.set(record.session.id, record)
  for (const week of weeks) {
    for (const session of [...week.plan.sessions, ...week.removed]) {
      if (session.date < start && (week.plan.sessions.some(item => item.id === session.id) || week.logs[session.id])) {
        records.set(session.id, { session, log: week.logs[session.id] ?? null })
      }
    }
  }
  const allHistory = [...records.values()].sort((a, b) => compare(`${position(a.session)}|${a.session.id}`, `${position(b.session)}|${b.session.id}`))
  const baselineDate = previous.input.athlete.baseline.asOf
  const fatigueCount = allHistory.filter(record => record.session.date >= baselineDate && record.log?.skipReason === 'too_tired').length
  const ceiling = SAFETY.calibrationWeekVolumeFraction
    * CAMPAIGN_POLICY.fatigueVolumeFraction ** Math.min(fatigueCount, CAMPAIGN_POLICY.maxCompoundedFatigueSkips)
  const completedWeeks = new Map<string, CompletedWeek>(previous.input.context.completedWeeks.map(week => [week.weekStart, week]))
  for (const week of weeks) {
    const actual = [...week.plan.sessions, ...week.removed.filter(session => week.logs[session.id]?.status === 'skipped')]
    if (!actual.length || !actual.every(session => {
      const log = week.logs[session.id]
      return log?.status === 'skipped' || (log?.status === 'completed' && log.actualDurationMin !== undefined)
    })) continue
    completedWeeks.set(week.plan.weekStart, {
      weekStart: week.plan.weekStart,
      runMinutes: actual.reduce((sum, session) => sum + (session.discipline === 'run' && week.logs[session.id]?.status === 'completed'
        ? week.logs[session.id]!.actualDurationMin! : 0), 0),
      plannedDeload: week.plan.weekIndex === 0 || ['deload', 'taper'].includes(week.plan.phase),
      disrupted: actual.some(session => week.logs[session.id]?.painFlag || ['pain', 'illness'].includes(week.logs[session.id]?.skipReason ?? '')),
    })
  }
  const health = allHistory.filter(record => record.session.date >= baselineDate &&
    (record.log?.painFlag || record.log?.skipReason === 'pain' || record.log?.skipReason === 'illness')).at(-1)
  let input: PlanWeekInput = {
    ...previous.input, weekIndex,
    block: { ...previous.input.block, phases: previous.input.block.phases.map(phase => ({
      ...phase, volumeFraction: Math.min(phase.volumeFraction, ceiling),
    })) },
    athlete: { ...previous.input.athlete,
      safetyHold: health ? { reason: health.log?.skipReason === 'illness' ? 'illness' : 'pain', since: health.session.date } : previous.input.athlete.safetyHold },
    context: {
      recentSessions: allHistory.slice(-LIMITS.maxHistorySessions),
      completedWeeks: [...completedWeeks.values()].sort((a, b) => compare(a.weekStart, b.weekStart)),
      pinnedSessions: [],
      neighboringSessions: allHistory.filter(record => dayNumber(record.session.date) >= dayNumber(start) - 7 && record.log?.status !== 'skipped').map(record => record.session),
      ...(previous.input.context.untimedStrengthDates ? {
        untimedStrengthDates: previous.input.context.untimedStrengthDates.filter(date => Math.abs(dayNumber(date) - dayNumber(start)) <= 7),
      } : {}),
    },
  }
  // Carry the old snapshot plus actual logs forward exactly once, never a zero reset.
  const probe = previous.plan.sessions[0] ?? previous.removed[0]
  if (probe) {
    const load = residualBefore({ ...probe, id: 'calendar-residual-probe', date: start, startTime: '00:00' },
      { ...input, context: { ...input.context, recentSessions: allHistory } }, [])
    input = { ...input, athlete: { ...input.athlete, residual: { asOfDate: start, asOfTime: '00:00', load } } }
  }
  input = { ...input, context: { ...input.context, neighboringSessions: [...input.context.neighboringSessions, ...followingCommitments(input)] } }
  return parsePlanWeekInput(input)
}
