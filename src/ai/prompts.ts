import {
  AI_COPY_PASTE_FORMAT,
  AI_COPY_PASTE_VERSION,
  DEFAULT_WARMUP_REQUIREMENT,
  WORKOUT_CATEGORIES,
  buildTargetWeek,
  buildWeekContractExample,
  normalizeFixedClubSessions,
} from './contract.ts'
import type {
  AiPromptPackage,
  BaseWeekPromptInput,
  ContinuationWeekPromptInput,
  InitialWeekPromptInput,
  WeekPromptKind,
} from './types.ts'

function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function buildPrompt(kind: WeekPromptKind, input: BaseWeekPromptInput, continuationContext?: ContinuationWeekPromptInput['previousWeek']): AiPromptPackage {
  const targetWeek = buildTargetWeek(input.targetWeekStartDate)
  const fixedClubSessions = normalizeFixedClubSessions(input.fixedClubSessions)
  const warmupRequirement = input.warmupRequirement?.trim() || DEFAULT_WARMUP_REQUIREMENT
  const example = buildWeekContractExample(kind, targetWeek.startDate, input.fixedClubSessions)
  const contract: AiPromptPackage['contract'] = {
    format: AI_COPY_PASTE_FORMAT,
    version: AI_COPY_PASTE_VERSION,
    categories: WORKOUT_CATEGORIES,
    requiresStructuredWarmupSteps: true,
  }
  const contractJson = JSON.stringify({
    format: contract.format,
    version: contract.version,
    weekType: kind,
    targetWeek,
    summary: 'short plain-text rationale',
    workouts: [{
      id: 'unique-workout-slug',
      date: targetWeek.dates[0]!,
      startTime: '07:00',
      category: 'aerobic|strength|mobility',
      modality: 'running',
      title: 'short title',
      purpose: 'short reason',
      expectedDuration: 45,
      warmup: [{ id: 'warmup-step', instruction: 'brief structured warm-up step', durationMin: 8 }],
      main: [{ id: 'main-step', instruction: 'main step instruction', durationMin: 30, effort: 'easy' }],
      cooldown: [{ id: 'cooldown-step', instruction: 'cooldown instruction', durationMin: 7 }],
      source: { kind: 'ai' },
    }],
  })
  const context = {
    profile: input.profile,
    equipment: input.equipment,
    preferences: input.preferences,
    fixedClubSessions,
    clubTimetableCommitments: input.clubTimetableCommitments ?? [],
    targetWeek,
    warmupRequirement,
    ...(continuationContext === undefined ? {} : { previousWeek: continuationContext }),
  }
  const system = [
    'You are helping Hybrid Coach create one reviewable training week.',
    'Discuss unresolved training choices with the athlete before generating the final proposal. When ready, return only one final JSON object. No Markdown, no code fences, and no extra commentary in that final response.',
    `Use the exact target week dates from ${targetWeek.startDate} through ${targetWeek.endDate}.`,
    `Workout category must be exactly one of: ${WORKOUT_CATEGORIES.join(', ')}.`,
    'Aerobic modality is a separate flexible field. Use it to state running, cycling, swimming, rowing, ski-erg, or another aerobic modality when relevant.',
    `${warmupRequirement} Every AI-authored workout must include at least one structured warmup step. A fixed club workout may leave warmup empty only when that is explicitly appropriate.`,
    'Each workout must carry startTime, purpose, expectedDuration, warmup, main, cooldown, and source metadata.',
    'Each structured step must include instruction and may also include purpose, sets, reps, loadKg, distanceMeters, durationMin, pace, effort, restSeconds, modality, and notes.',
    'Return every fixed club session as a workout with source.kind:"fixed_club" and source.fixedClub matching the supplied sessionId, label, date, startTime, durationMin, and any supplied notes or category context. Do not omit, rename, move, or duplicate fixed club sessions.',
    'clubTimetableCommitments are immutable timetable commitments, not fully specified workouts. Respect and reserve each supplied dayOfWeek (0 = Sunday), date, startTime, and title, and preserve its notes and any supplied details. Do not omit, rename, or move these commitments.',
    'Discuss unspecified club duration and intensity with the athlete so other training can be scheduled around these commitments. Do not fabricate missing scope, category, duration, intensity, or exercises, and do not add or duplicate timetable commitments in the workouts array or turn them into fixed_club workouts.',
    'Strength programming is for the AI conversation: discuss strength goals, frequency, split, and exercises with the athlete rather than inventing a strength preference. A supplied legacy strengthPreference is prior context to confirm, not a required selection. The compact example is a format illustration, not an athlete prescription.',
    'Use only explicitly listed equipment. Venue labels such as home gym or commercial gym do not imply unlisted equipment. Clarify any uncertainty with the athlete.',
    'The workout arrays should map cleanly to a future domain workout contract with original scheduling and logged-step detail preserved.',
    `Return the compact versioned contract exactly as format "${AI_COPY_PASTE_FORMAT}" version ${AI_COPY_PASTE_VERSION}.`,
    `Compact contract: ${contractJson}`,
    `Compact example: ${JSON.stringify(example)}`,
    ...(kind === 'initial'
      ? ['This is the initial week. Use the profile, equipment, preferences, fixed club sessions, and club timetable commitments to produce the first seven-day proposal after clarifying unresolved choices.']
      : [
        'This is a continuation week.',
        'Use the previousWeek context, including original prescriptions, actual logs, completionStatus, moved or added or deleted changes, effort, and notes.',
        'Use recorded exercise weights, reps, sets, effort, and comments as feedback tied to their step IDs. Compare actuals with original targets. Blank values and unrecorded step statuses are unknown, not completed or skipped work.',
        'Preserve what worked, adjust what did not, and keep the fixed club sessions deterministic.',
      ]),
  ].join('\n')
  const user = [
    'Plan context JSON:',
    renderJson(context),
    'Clarify unresolved choices in conversation first; when the plan is ready, return only one JSON object that matches the contract.',
  ].join('\n')
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ] as const
  return {
    kind,
    targetWeek,
    contract,
    example,
    contractJson,
    exampleJson: JSON.stringify(example),
    messages,
    prompt: `${system}\n\n${user}`,
  }
}

export function buildInitialWeekPrompt(input: InitialWeekPromptInput): AiPromptPackage {
  return buildPrompt('initial', input)
}

export function buildContinuationWeekPrompt(input: ContinuationWeekPromptInput): AiPromptPackage {
  return buildPrompt('continuation', input, input.previousWeek)
}
