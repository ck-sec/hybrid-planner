import { generateBlock } from '../engine/block.ts'
import { ENGINE_VERSION, LIBRARY_VERSION, POLICY_VERSION } from '../engine/constants.ts'
import { DEFAULT_LIBRARY } from '../engine/library.ts'
import { planWeek } from '../engine/planner.ts'
import { checkSafety } from '../engine/safety.ts'
import type { AthleteState, Block, CompletedWeek, Goal, PlanWeekInput, PlanningContext, RecentSession, SafetyHold, Session, SessionLog, WeekPlan } from '../engine/types.ts'
import { parseAthlete, parseBlock, parseGoal, parsePlanWeekInput, parseSessionLog } from '../engine/validation.ts'
import { dayOfWeekDate, daysBetween, parseWeekStart } from './dates.ts'
import * as legacy from './state.ts'

export const MAX_BACKUP_BYTES = legacy.MAX_BACKUP_BYTES
export const MAX_WEEKS = legacy.MAX_WEEKS

export interface ModelWeek {
  input: PlanWeekInput
  logs: Record<string, SessionLog>
}

export interface AppState {
  schemaVersion: 2
  engineVersion: typeof ENGINE_VERSION
  legacy: legacy.AppState
  athlete: AthleteState | null
  activeBlock: Block | null
  blockHistory: Block[]
  modelWeeks: ModelWeek[]
}

const cache = new Map<string, WeekPlan>()

export function emptyState(): AppState {
  return { schemaVersion: 2, engineVersion: ENGINE_VERSION, legacy: legacy.emptyState(), athlete: null, activeBlock: null, blockHistory: [], modelWeeks: [] }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, names: readonly string[], label: string): void {
  if (names.some(name => !Object.hasOwn(value, name)) || Object.keys(value).some(name => !names.includes(name))) {
    throw new Error(`${label} has missing or unsupported fields.`)
  }
}

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b) }

export function weekStartFor(block: Block, weekIndex: number): string {
  return dayOfWeekDate(block.startDate, weekIndex * 7).toISOString().slice(0, 10)
}

export function modelWeekKey(input: PlanWeekInput): string { return `${input.block.id}:${input.weekIndex}` }

export function planForModelInput(input: PlanWeekInput): WeekPlan {
  const key = JSON.stringify(input)
  const existing = cache.get(key)
  if (existing) return existing
  const plan = planWeek(input)
  if (cache.size >= MAX_WEEKS + 8) cache.delete(cache.keys().next().value!)
  cache.set(key, plan)
  return plan
}

function versions(block: Block): void {
  if (block.engineVersion !== ENGINE_VERSION || block.policyVersion !== POLICY_VERSION || block.libraryVersion !== LIBRARY_VERSION) {
    throw new Error('Unsupported engine, policy or exercise library version. Historical model inputs cannot be reinterpreted.')
  }
}

function recordedSessions(state: AppState): RecentSession[] {
  return state.modelWeeks.flatMap(week => planForModelInput(week.input).sessions.map(session => ({
    session, log: week.logs[session.id] ?? null,
  })))
}

export function latestHold(state: AppState): SafetyHold | null {
  const holds: SafetyHold[] = []
  for (const { session, log } of recordedSessions(state)) {
    if (log?.painFlag || log?.skipReason === 'pain') holds.push({ since: session.date, reason: 'pain' })
    else if (log?.skipReason === 'illness') holds.push({ since: session.date, reason: 'illness' })
  }
  if (state.athlete?.safetyHold) holds.push(state.athlete.safetyHold)
  return holds.sort((a, b) => b.since.localeCompare(a.since))[0] ?? null
}

function completedWeeks(state: AppState, before: string): CompletedWeek[] {
  return state.modelWeeks.flatMap(week => {
    const plan = planForModelInput(week.input)
    if (daysBetween(plan.weekStart, before) < 7 || !plan.sessions.length) return []
    if (!plan.sessions.every(session => {
      const log = week.logs[session.id]
      return log && (log.status === 'skipped' || (log.status === 'completed' && log.actualDurationMin !== undefined))
    })) return []
    const healthDates = plan.sessions.filter(session => {
      const log = week.logs[session.id]
      return log?.painFlag || log?.skipReason === 'pain' || log?.skipReason === 'illness'
    }).map(session => session.date)
    if (week.input.athlete.safetyHold?.reason === 'return_from_break') healthDates.push(week.input.athlete.safetyHold.since)
    const baselineDate = state.athlete?.baseline.asOf
    // Resolved health weeks are neither a current hold nor a normal-volume reference.
    if (healthDates.length && baselineDate && healthDates.every(date => date < baselineDate)) return []
    return [{
      weekStart: plan.weekStart,
      runMinutes: plan.sessions.reduce((sum, session) => sum +
        (session.discipline === 'run' && week.logs[session.id]?.status === 'completed' ? week.logs[session.id].actualDurationMin! : 0), 0),
      plannedDeload: plan.weekIndex === 0 || plan.phase === 'deload' || plan.phase === 'taper',
      disrupted: healthDates.length > 0,
    }]
  }).sort((a, b) => a.weekStart.localeCompare(b.weekStart)).slice(-8)
}

export function contextForWeek(state: AppState, block: Block, weekIndex: number, pins: readonly Session[] = []): PlanningContext {
  const start = weekStartFor(block, weekIndex)
  const others = recordedSessions(state)
  return {
    recentSessions: others.filter(({ session }) => {
      const offset = daysBetween(start, session.date)
      return offset >= -14 && offset < 0
    }).sort((a, b) => a.session.date.localeCompare(b.session.date) || (a.session.startTime ?? '').localeCompare(b.session.startTime ?? '')),
    neighboringSessions: others.filter(({ session }) => {
      const offset = daysBetween(start, session.date)
      return offset >= -7 && offset <= 13 && (offset < 0 || offset > 6)
    }).map(item => item.session),
    completedWeeks: completedWeeks(state, start),
    pinnedSessions: pins,
    untimedStrengthDates: [...new Set(state.legacy.weeks.flatMap(week =>
      legacy.planForInput(week.input).sessions.filter(session => session.kind === 'lift')
        .map(session => dayOfWeekDate(week.weekStart, session.day).toISOString().slice(0, 10))))
      ].filter(date => {
        const offset = daysBetween(start, date)
        return offset >= -7 && offset <= 13
      }).sort(),
  }
}

function legacyBoundary(state: AppState, plan: WeekPlan): void {
  for (const week of state.legacy.weeks) {
    if (week.weekStart === plan.weekStart) throw new Error('This calendar week already exists in the version 0.1 archive. History cannot be replaced.')
    for (const old of legacy.planForInput(week.input).sessions) {
      if (old.kind !== 'lift') continue
      const date = dayOfWeekDate(week.weekStart, old.day).toISOString().slice(0, 10)
      if (plan.sessions.some(session => session.discipline === 'strength' && Math.abs(daysBetween(date, session.date)) <= 1)) {
        throw new Error('A version 0.1 full-body lift is on this or an adjacent date. Its time is unknown; keep a clear calendar day between it and new lifting.')
      }
    }
  }
}

export function previewForModelInput(state: AppState, input: PlanWeekInput): WeekPlan {
  const plan = planForModelInput(input)
  try {
    legacyBoundary(state, plan)
    return plan
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The archive boundary could not be checked.'
    return {
      ...plan,
      safety: { passed: false, violations: [...plan.safety.violations, { rule: 'legacyBoundary', sessionIds: [], message }] },
      feasibility: { ...plan.feasibility, fits: false, issues: [...plan.feasibility.issues, message] },
    }
  }
}

export function inputForWeek(state: AppState, weekIndex: number, athleteValue?: AthleteState, pins: readonly Session[] = []): PlanWeekInput {
  if (!state.activeBlock || !state.athlete) throw new Error('Save a confirmed baseline and block first.')
  const athlete = parseAthlete(athleteValue ?? state.athlete)
  const context = contextForWeek(state, state.activeBlock, weekIndex, pins)
  const start = weekStartFor(state.activeBlock, weekIndex)
  if (athlete.baseline.asOf > start) throw new Error('The current baseline observation must be on or before this week starts.')
  const hold = latestHold(state)
  const input = parsePlanWeekInput({
    athlete: {
      ...athlete,
      safetyHold: hold && hold.since >= athlete.baseline.asOf ? hold : athlete.safetyHold,
      residual: { asOfDate: context.recentSessions[0]?.session.date ?? start, asOfTime: '00:00', load: { systemic: 0, structural: 0 } },
    },
    block: state.activeBlock,
    weekIndex,
    library: DEFAULT_LIBRARY,
    context,
  })
  return input
}

function validateWeek(state: AppState, week: ModelWeek): void {
  const plan = planForModelInput(week.input)
  if (!plan.safety.passed) throw new Error(`Week ${plan.weekStart} failed safety checks: ${plan.safety.violations.map(item => item.message).join(' ')}`)
  const context = contextForWeek(state, week.input.block, week.input.weekIndex)
  const externalSafety = checkSafety({ ...week.input, context: {
    ...week.input.context, neighboringSessions: context.neighboringSessions, untimedStrengthDates: context.untimedStrengthDates,
  } }, plan.sessions)
  if (!externalSafety.passed) throw new Error(`Week ${plan.weekStart} conflicts with saved neighboring sessions: ${externalSafety.violations.map(item => item.message).join(' ')}`)
  legacyBoundary(state, plan)
}

export function parseAppState(value: unknown): AppState {
  const raw = object(value, 'Backup')
  if (raw.schemaVersion === 1) return { ...emptyState(), legacy: legacy.parseAppState(raw) }
  if (raw.schemaVersion !== 2) throw new Error('Unsupported backup schema version. Expected version 1 or 2.')
  if (raw.engineVersion !== ENGINE_VERSION) throw new Error(`Unsupported engine version. Expected ${ENGINE_VERSION}.`)
  keys(raw, ['schemaVersion', 'engineVersion', 'legacy', 'athlete', 'activeBlock', 'blockHistory', 'modelWeeks'], 'Backup')
  const archive = legacy.parseAppState(raw.legacy)
  const athlete = raw.athlete === null ? null : parseAthlete(raw.athlete)
  const activeBlock = raw.activeBlock === null ? null : parseBlock(raw.activeBlock)
  if (!Array.isArray(raw.blockHistory) || raw.blockHistory.length > MAX_WEEKS) throw new Error('Block history must contain at most 520 blocks.')
  const blockHistory = raw.blockHistory.map(item => parseBlock(item))
  const blockIds = new Map<string, Block>()
  for (const block of blockHistory) {
    versions(block)
    if (blockIds.has(block.id)) throw new Error('Duplicate block ID in history.')
    blockIds.set(block.id, block)
  }
  if ((athlete === null) !== (activeBlock === null)) throw new Error('An athlete and active block must be saved together.')
  if (activeBlock) {
    versions(activeBlock)
    if (!same(blockIds.get(activeBlock.id), activeBlock)) throw new Error('Active block is missing or differs from its immutable block history.')
  }
  if (!Array.isArray(raw.modelWeeks) || raw.modelWeeks.length + archive.weeks.length > MAX_WEEKS) throw new Error('Backups may contain at most 520 total weeks.')
  const seenDates = new Set(archive.weeks.map(week => week.weekStart))
  const modelWeeks: ModelWeek[] = raw.modelWeeks.map(value => {
    const item = object(value, 'Model week')
    keys(item, ['input', 'logs'], 'Model week')
    const input = parsePlanWeekInput(item.input)
    versions(input.block)
    if (!same(input.library, DEFAULT_LIBRARY)) throw new Error('Unsupported or modified exercise library. Estimates must match the recorded version.')
    if (!same(blockIds.get(input.block.id), input.block)) throw new Error('Saved week block differs from its immutable block history.')
    const plan = planForModelInput(input)
    if (seenDates.has(plan.weekStart)) throw new Error(`Duplicate calendar week ${plan.weekStart}. Historical weeks cannot be replaced.`)
    seenDates.add(plan.weekStart)
    const rawLogs = object(item.logs, 'Model session logs')
    const logs: Record<string, SessionLog> = {}
    for (const [id, rawLog] of Object.entries(rawLogs)) {
      const session = plan.sessions.find(session => session.id === id)
      const log = parseSessionLog(rawLog)
      if (!session || log.sessionId !== id) throw new Error('A model log must refer to its scheduled session.')
      if (log.sets?.some(set => session.kind !== 'strength' || !session.strengthPrescription.some(exercise => exercise.exerciseId === set.exerciseId))) {
        throw new Error('A set log must refer to an exercise prescribed in that session.')
      }
      Object.defineProperty(logs, id, { value: log, enumerable: true, configurable: true, writable: true })
    }
    return { input, logs }
  })
  const state: AppState = { schemaVersion: 2, engineVersion: ENGINE_VERSION, legacy: archive, athlete, activeBlock, blockHistory, modelWeeks }
  for (const week of modelWeeks) validateWeek(state, week)
  const hold = latestHold(state)
  if (hold && athlete && hold.since >= athlete.baseline.asOf &&
    (!athlete.safetyHold || athlete.safetyHold.since < hold.since)) throw new Error('A pain or illness log requires an active safety hold. Confirm a new baseline to resolve it.')
  return state
}

export function parseBackupText(text: string): AppState {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('This backup is too large. The limit is 5 MB.')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('This file is not valid JSON. Choose a Hybrid Planner backup.') }
  return parseAppState(value)
}

export function exportBackupText(state: AppState | legacy.AppState): string {
  const text = JSON.stringify(state, null, 2)
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('This backup exceeds the 5 MB limit.')
  return text
}

export function startBlock(state: AppState, athleteValue: unknown, goalValue: unknown, startDate: string, confirmed: boolean): AppState {
  if (!confirmed) throw new Error('Confirm a recent comfortable baseline and no current pain, illness or return from a break.')
  parseWeekStart(startDate)
  const athlete = parseAthlete(athleteValue)
  const goal: Goal = parseGoal(goalValue)
  if (athlete.baseline.asOf > startDate) throw new Error('Baseline observations must be on or before block start.')
  const hold = latestHold(state)
  if (hold && athlete.baseline.asOf <= hold.since) throw new Error(`To resolve the ${hold.reason} hold, confirm a new comfortable baseline dated after ${hold.since}. Historical logs stay unchanged.`)
  const resolved = { ...athlete, safetyHold: null }
  const block = generateBlock(resolved, goal, startDate, DEFAULT_LIBRARY)
  if (state.blockHistory.some(item => item.id === block.id)) throw new Error('This block is already saved. Use its next week or choose a different block start.')
  return parseAppState({ ...state, athlete: resolved, activeBlock: block, blockHistory: [...state.blockHistory, block] })
}

export function saveModelWeek(state: AppState, value: PlanWeekInput, acceptOmissions: boolean): AppState {
  const input = parsePlanWeekInput(value)
  if (!state.activeBlock || !same(input.block, state.activeBlock)) throw new Error('This preview belongs to a different block. Preview the current week again.')
  const fresh = inputForWeek(state, input.weekIndex, input.athlete, input.context.pinnedSessions)
  if (!same(fresh, input)) throw new Error('The baseline or saved context changed. Preview this week again before saving.')
  if (state.athlete?.safetyHold) throw new Error('Planning is on hold. Reconfirm a new baseline through block setup; a weekly confirmation cannot clear it.')
  const plan = planForModelInput(input)
  if (plan.omitted.length && !acceptOmissions) throw new Error('Explicitly acknowledge omitted sessions before saving this partial week.')
  const next = { ...state, athlete: { ...input.athlete, residual: state.athlete!.residual }, modelWeeks: [...state.modelWeeks, { input, logs: {} }] }
  return parseAppState(next)
}

export function updateModelLog(state: AppState, key: string, value: unknown): AppState {
  const log = parseSessionLog(value)
  const week = state.modelWeeks.find(item => modelWeekKey(item.input) === key)
  if (!week) throw new Error('The selected model week no longer exists.')
  const session = planForModelInput(week.input).sessions.find(item => item.id === log.sessionId)
  if (!session) throw new Error('Only scheduled model sessions can be logged.')
  const reason = log.painFlag || log.skipReason === 'pain' ? 'pain' : log.skipReason === 'illness' ? 'illness' : null
  const hold: SafetyHold | null = reason ? { since: session.date, reason } : state.athlete?.safetyHold ?? null
  const activeHold = hold && (!state.athlete?.safetyHold || hold.since >= state.athlete.safetyHold.since) ? hold : state.athlete?.safetyHold ?? null
  return parseAppState({
    ...state,
    athlete: state.athlete ? { ...state.athlete, safetyHold: activeHold } : null,
    modelWeeks: state.modelWeeks.map(item => item === week ? { ...item, logs: { ...item.logs, [log.sessionId]: log } } : item),
  })
}
