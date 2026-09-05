import { generateWeek, safetyViolations } from '../engine/legacy/planner.ts'
import { ENGINE_VERSION } from '../engine/legacy/types.ts'
import type { Baseline, PlannerInput, WeekBoundary, WeekPlan } from '../engine/legacy/types.ts'
import { parseBaseline, parsePlannerInput } from '../engine/legacy/validation.ts'
import { daysBetween, parseWeekStart } from './dates.ts'

export const MAX_BACKUP_BYTES = 5 * 1024 * 1024
export const MAX_WEEKS = 520
export const MAX_NOTES_LENGTH = 2000
const planCache = new Map<string, WeekPlan>()

export interface SessionLog {
  status: 'completed' | 'skipped'
  notes: string
}

export interface SavedWeek {
  weekStart: string
  input: PlannerInput
  logs: Record<string, SessionLog>
}

export interface AppState {
  schemaVersion: 1
  engineVersion: typeof ENGINE_VERSION
  baseline: Baseline | null
  weeks: SavedWeek[]
}

export function emptyState(): AppState {
  return { schemaVersion: 1, engineVersion: ENGINE_VERSION, baseline: null, weeks: [] }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label} has missing or unsupported fields.`)
  }
}

function parseLog(value: unknown): SessionLog {
  const log = record(value, 'Session log')
  exactKeys(log, ['status', 'notes'], 'Session log')
  if (log.status !== 'completed' && log.status !== 'skipped') {
    throw new Error('A log status must be completed or skipped.')
  }
  if (typeof log.notes !== 'string' || log.notes.length > MAX_NOTES_LENGTH) {
    throw new Error(`Log notes must be text of at most ${MAX_NOTES_LENGTH} characters.`)
  }
  return { status: log.status, notes: log.notes }
}

export function plansForWeeks(weeks: readonly SavedWeek[]): Map<string, WeekPlan> {
  return new Map(weeks.map(week => [week.weekStart, planForInput(week.input)]))
}

export function planForInput(input: PlannerInput): WeekPlan {
  const key = JSON.stringify(input)
  const cached = planCache.get(key)
  if (cached) return cached
  const plan = generateWeek(input)
  if (planCache.size >= MAX_WEEKS + 8) {
    const oldest = planCache.keys().next().value
    if (oldest !== undefined) planCache.delete(oldest)
  }
  planCache.set(key, plan)
  return plan
}

export function boundaryForWeek(
  weekStart: string,
  weeks: readonly SavedWeek[],
  plans: ReadonlyMap<string, WeekPlan> = plansForWeeks(weeks),
): WeekBoundary {
  parseWeekStart(weekStart)
  let previousSundayLift = false
  let nextMondayLift = false
  for (const week of weeks) {
    const difference = daysBetween(weekStart, week.weekStart)
    if (difference !== -7 && difference !== 7) continue
    const plan = plans.get(week.weekStart)
    if (!plan) throw new Error(`The saved plan for ${week.weekStart} is unavailable.`)
    if (difference === -7) previousSundayLift = plan.sessions.some(session => session.day === 6 && session.kind === 'lift')
    if (difference === 7) nextMondayLift = plan.sessions.some(session => session.day === 0 && session.kind === 'lift')
  }
  return { previousSundayLift, nextMondayLift }
}

function checkSafety(week: SavedWeek, plan: WeekPlan, boundary: WeekBoundary): void {
  const issues = safetyViolations({ ...week.input, boundary }, plan.sessions)
  if (issues.length) throw new Error(`Week ${week.weekStart} is unsafe: ${issues.join(' ')}`)
}

export function parseAppState(value: unknown): AppState {
  const state = record(value, 'Backup')
  if (state.schemaVersion !== 1) throw new Error('Unsupported backup schema version. Expected version 1.')
  if (state.engineVersion !== ENGINE_VERSION) throw new Error(`Unsupported engine version. Expected ${ENGINE_VERSION}.`)
  exactKeys(state, ['schemaVersion', 'engineVersion', 'baseline', 'weeks'], 'Backup')
  const baseline = state.baseline === null ? null : parseBaseline(state.baseline)
  if (!Array.isArray(state.weeks) || state.weeks.length > MAX_WEEKS) {
    throw new Error(`Backup weeks must be an array with at most ${MAX_WEEKS} entries.`)
  }
  const seen = new Set<string>()
  const plans = new Map<string, WeekPlan>()
  const weeks: SavedWeek[] = state.weeks.map((value: unknown) => {
    const item = record(value, 'Saved week')
    exactKeys(item, ['weekStart', 'input', 'logs'], 'Saved week')
    const weekStart = parseWeekStart(item.weekStart)
    if (seen.has(weekStart)) throw new Error(`Duplicate week ${weekStart}. Existing weeks cannot be overwritten.`)
    seen.add(weekStart)
    const input = parsePlannerInput(item.input)
    const plan = planForInput(input)
    plans.set(weekStart, plan)
    const rawLogs = record(item.logs, `Logs for ${weekStart}`)
    const ids = new Set(plan.sessions.map(session => session.id))
    const logs: Record<string, SessionLog> = {}
    for (const [id, rawLog] of Object.entries(rawLogs)) {
      if (!ids.has(id)) throw new Error(`Log "${id}" in ${weekStart} does not refer to a scheduled session.`)
      Object.defineProperty(logs, id, { value: parseLog(rawLog), enumerable: true, configurable: true, writable: true })
    }
    const week = { weekStart, input, logs }
    checkSafety(week, plan, input.boundary)
    return week
  })
  for (const week of weeks) {
    const plan = plans.get(week.weekStart)
    if (plan) checkSafety(week, plan, boundaryForWeek(week.weekStart, weeks, plans))
  }
  return { schemaVersion: 1, engineVersion: ENGINE_VERSION, baseline, weeks }
}

export function parseBackupText(text: string): AppState {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('This backup is too large. The limit is 5 MB.')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON. Choose a Hybrid Planner backup.')
  }
  return parseAppState(value)
}

export function exportBackupText(state: AppState): string {
  const text = JSON.stringify(state, null, 2)
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('This backup exceeds the 5 MB limit. Shorten some log notes before exporting.')
  }
  return text
}

export function addWeek(state: AppState, weekStart: string, baseline: unknown): AppState {
  parseWeekStart(weekStart)
  if (state.weeks.some(week => week.weekStart === weekStart)) {
    throw new Error('This week is already saved. Select it from history; its plan and logs will not be overwritten.')
  }
  if (state.weeks.length >= MAX_WEEKS) throw new Error(`The ${MAX_WEEKS}-week limit has been reached. Export a backup to keep your history.`)
  const parsedBaseline = parseBaseline(baseline)
  const plans = plansForWeeks(state.weeks)
  const input = parsePlannerInput({ baseline: parsedBaseline, boundary: boundaryForWeek(weekStart, state.weeks, plans) })
  const week: SavedWeek = { weekStart, input, logs: {} }
  const plan = planForInput(input)
  plans.set(weekStart, plan)
  const weeks = [...state.weeks, week]
  for (const saved of weeks) {
    const savedPlan = plans.get(saved.weekStart)
    if (savedPlan) checkSafety(saved, savedPlan, boundaryForWeek(saved.weekStart, weeks, plans))
  }
  const next: AppState = { ...state, baseline: parsedBaseline, weeks }
  exportBackupText(next)
  return next
}

export function updateLog(state: AppState, weekStart: string, sessionId: string, value: unknown): AppState {
  const week = state.weeks.find(item => item.weekStart === weekStart)
  if (!week) throw new Error('The selected week no longer exists. Reload saved data.')
  if (!planForInput(week.input).sessions.some(session => session.id === sessionId)) {
    throw new Error('Only scheduled sessions can be logged.')
  }
  const log = parseLog(value)
  const next: AppState = {
    ...state,
    weeks: state.weeks.map(item => item === week ? { ...item, logs: { ...item.logs, [sessionId]: log } } : item),
  }
  exportBackupText(next)
  return next
}
