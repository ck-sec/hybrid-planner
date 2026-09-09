import type {
  AiWeekCopyPasteContract,
  FixedClubSession,
  NormalizedFixedClubSession,
  WorkoutCategory,
  WeekPromptKind,
} from './types.ts'

export const AI_COPY_PASTE_FORMAT = 'hybrid-coach-week'
export const AI_COPY_PASTE_VERSION = 1
export const WORKOUT_CATEGORIES = ['aerobic', 'strength', 'mobility'] as const satisfies readonly WorkoutCategory[]
export const DEFAULT_WARMUP_REQUIREMENT = 'Make every warm-up specific to the session and the available equipment.'

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

function assertIsoDate(value: string, label: string): void {
  if (!ISO_DATE_PATTERN.test(value)) throw new Error(`${label} must use YYYY-MM-DD.`)
  const [year, month, day] = value.split('-').map(Number)
  const candidate = new Date(Date.UTC(year!, month! - 1, day!))
  if (formatUtcDate(candidate) !== value) throw new Error(`${label} must be a real calendar date.`)
}

function formatUtcDate(value: Date): string {
  const year = value.getUTCFullYear()
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${value.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addUtcDays(value: string, days: number): string {
  assertIsoDate(value, 'Target week start date')
  const [year, month, day] = value.split('-').map(Number)
  return formatUtcDate(new Date(Date.UTC(year!, month! - 1, day!) + days * DAY_MS))
}

export function normalizeFixedClubSession(session: FixedClubSession, index: number): NormalizedFixedClubSession {
  return {
    sessionId: session.sessionId?.trim() || `fixed-club-${index + 1}`,
    label: session.label.trim(),
    date: session.date,
    startTime: session.startTime,
    durationMin: session.durationMin,
    ...(session.category === undefined ? {} : { category: session.category }),
    ...(session.modality === undefined ? {} : { modality: session.modality.trim() }),
    ...(session.notes === undefined ? {} : { notes: session.notes.trim() }),
  }
}

export function normalizeFixedClubSessions(sessions: readonly FixedClubSession[]): readonly NormalizedFixedClubSession[] {
  return sessions.map(normalizeFixedClubSession)
}

export function buildTargetWeek(targetWeekStartDate: string) {
  assertIsoDate(targetWeekStartDate, 'Target week start date')
  const dates = Array.from({ length: 7 }, (_, index) => addUtcDays(targetWeekStartDate, index))
  return {
    startDate: targetWeekStartDate,
    endDate: dates[6]!,
    dates,
  }
}

export function buildWeekContractExample(
  kind: WeekPromptKind,
  targetWeekStartDate: string,
  fixedClubSessions: readonly FixedClubSession[] = [],
): AiWeekCopyPasteContract {
  const targetWeek = buildTargetWeek(targetWeekStartDate)
  const fixedClub = normalizeFixedClubSessions(fixedClubSessions)
  const fixedWorkouts = fixedClub.map((session, index) => ({
    id: `fixed-club-workout-${index + 1}`,
    date: session.date,
    startTime: session.startTime,
    category: session.category ?? 'aerobic',
    ...(session.modality === undefined ? {} : { modality: session.modality }),
    title: session.label,
    purpose: 'Fixed club session kept exactly as scheduled.',
    expectedDuration: session.durationMin,
    warmup: [],
    main: [{
      id: `fixed-club-workout-${index + 1}-main`,
      instruction: 'Attend the fixed club session as scheduled.',
      ...(session.modality === undefined ? {} : { modality: session.modality }),
    }],
    cooldown: [],
    source: {
      kind: 'fixed_club' as const,
      fixedClub: session,
    },
    ...(session.notes === undefined ? {} : { notes: session.notes }),
  }))

  return {
    format: AI_COPY_PASTE_FORMAT,
    version: AI_COPY_PASTE_VERSION,
    weekType: kind,
    targetWeek,
    summary: kind === 'initial'
      ? 'Builds a balanced first week around the fixed club sessions.'
      : 'Carries forward what worked, adjusts what did not, and preserves the fixed club sessions.',
    workouts: [
      ...fixedWorkouts,
      {
        id: 'aerobic-1',
        date: targetWeek.dates[0]!,
        startTime: '07:00',
        category: 'aerobic',
        modality: 'running',
        title: 'Easy aerobic session',
        purpose: 'Build consistency without crowding the fixed club work.',
        expectedDuration: 40,
        warmup: [{
          id: 'aerobic-1-warmup',
          instruction: 'Walk or jog easily to prepare for the session.',
          durationMin: 8,
          modality: 'running',
        }],
        main: [{
          id: 'aerobic-1-main',
          instruction: 'Run at conversational effort.',
          durationMin: 28,
          effort: 'easy',
          modality: 'running',
        }],
        cooldown: [{
          id: 'aerobic-1-cooldown',
          instruction: 'Walk until breathing settles.',
          durationMin: 4,
          modality: 'running',
        }],
        source: { kind: 'ai' },
      },
      {
        id: 'strength-1',
        date: targetWeek.dates[2]!,
        startTime: '18:00',
        category: 'strength',
        title: 'Strength session',
        purpose: 'Support the hybrid week with simple controlled lifting.',
        expectedDuration: 50,
        warmup: [{
          id: 'strength-1-warmup',
          instruction: 'Do a short dynamic warm-up and one easy preparation set.',
          durationMin: 10,
        }],
        main: [{
          id: 'strength-1-main',
          instruction: 'Perform the main strength lift with controlled repetitions.',
          sets: 4,
          reps: 5,
          effort: 'steady',
          restSeconds: 120,
        }],
        cooldown: [{
          id: 'strength-1-cooldown',
          instruction: 'Walk and loosen up after the lifting work.',
          durationMin: 5,
        }],
        source: { kind: 'ai' },
      },
      {
        id: 'mobility-1',
        date: targetWeek.dates[4]!,
        startTime: '20:00',
        category: 'mobility',
        title: 'Mobility session',
        purpose: 'Keep range of motion and recovery work visible in the plan.',
        expectedDuration: 20,
        warmup: [{
          id: 'mobility-1-warmup',
          instruction: 'Start with gentle movement before deeper mobility work.',
          durationMin: 5,
        }],
        main: [{
          id: 'mobility-1-main',
          instruction: 'Move through smooth controlled mobility drills.',
          durationMin: 12,
        }],
        cooldown: [{
          id: 'mobility-1-cooldown',
          instruction: 'Finish with easy breathing and relaxed positions.',
          durationMin: 3,
        }],
        source: { kind: 'ai' },
      },
    ],
  }
}
