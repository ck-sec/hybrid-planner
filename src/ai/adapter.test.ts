/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildWeekContractExample,
  createPastedPlanAdapter,
  formatValidationIssues,
  parseAndValidatePastedPlan,
} from './index.ts'
import type { FixedClubSession } from './index.ts'

const fixedClubSessions: readonly FixedClubSession[] = [{
  sessionId: 'club-tue',
  label: 'Club practice',
  date: '2026-09-16',
  startTime: '19:00',
  durationMin: 90,
  category: 'aerobic' as const,
  modality: 'dodgeball',
}]

test('parser accepts fenced JSON, exact target week dates, and fixed club workouts', () => {
  const example = buildWeekContractExample('initial', '2026-09-14', fixedClubSessions)
  const result = parseAndValidatePastedPlan(`\`\`\`json\n${JSON.stringify(example)}\n\`\`\``, {
    expectedWeekType: 'initial',
    expectedTargetWeekStartDate: '2026-09-14',
    expectedTargetWeekDates: example.targetWeek.dates,
    expectedFixedClubSessions: fixedClubSessions,
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.contract.targetWeek.endDate, '2026-09-20')
  assert.equal(result.contract.workouts[0]?.source.kind, 'fixed_club')
  assert.equal(result.contract.workouts[1]?.category, 'aerobic')
})

test('external JSON workouts still require explicit category and duration', () => {
  const example = buildWeekContractExample('initial', '2026-09-14')
  for (const field of ['category', 'expectedDuration']) {
    const result = parseAndValidatePastedPlan(JSON.stringify({
      ...example,
      workouts: example.workouts.map((workout, index) => index === 0 ? { ...workout, [field]: undefined } : workout),
    }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.issues.some(issue => issue.path === `workouts[0].${field}`))
  }
})

test('rich fixed club duration remains required and immutable in external JSON', () => {
  const example = buildWeekContractExample('initial', '2026-09-14', fixedClubSessions)
  for (const durationMin of [undefined, 60]) {
    const result = parseAndValidatePastedPlan(JSON.stringify({
      ...example,
      workouts: example.workouts.map(workout => workout.source.kind === 'fixed_club'
        ? {
          ...workout,
          expectedDuration: durationMin,
          source: {
            ...workout.source,
            fixedClub: { ...workout.source.fixedClub, durationMin },
          },
        }
        : workout),
    }), { expectedFixedClubSessions: fixedClubSessions })
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.formattedIssues, /duration/i)
  }
})

test('parser reports actionable issues for wrong category, missing aerobic modality, empty AI warm-up, and missing fixed club workout', () => {
  const example = buildWeekContractExample('initial', '2026-09-14', fixedClubSessions)
  const broken = {
    ...example,
    workouts: [
      {
        ...example.workouts[1],
        category: 'run',
      },
      {
        ...example.workouts[1],
        id: 'aerobic-2',
        modality: undefined,
        warmup: [],
      },
    ],
  }
  const result = parseAndValidatePastedPlan(JSON.stringify(broken), {
    expectedWeekType: 'initial',
    expectedTargetWeekStartDate: '2026-09-14',
    expectedFixedClubSessions: fixedClubSessions,
  })

  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.formattedIssues, /workouts\[0\]\.category: workouts\[\]\.category must be one of aerobic, strength, mobility\./)
  assert.match(result.formattedIssues, /workouts\[1\]\.modality: Aerobic workouts must include a modality field\./)
  assert.match(result.formattedIssues, /workouts\[1\]\.warmup: workouts\[1\]\.warmup must contain at least 1 structured step/)
  assert.match(result.formattedIssues, /workouts: Missing fixed club workout for session "club-tue"\./)
})

test('domain validators can transform successful imports and block invalid ones without partial import', () => {
  const continuationFixedSessions: readonly FixedClubSession[] = [{
    ...fixedClubSessions[0]!,
    date: '2026-09-23',
  }]
  const example = buildWeekContractExample('continuation', '2026-09-21', continuationFixedSessions)
  const adapter = createPastedPlanAdapter<{ acceptedIds: string[] }>({
    domainValidators: [{
      safeParse(value) {
        if (value.workouts.some(workout => workout.category === 'mobility')) {
          return {
            success: false,
            issues: [{ path: ['workouts', 3, 'category'], message: 'Mobility must stay local until the domain layer is ready.' }],
          }
        }
        return { success: true, data: { acceptedIds: value.workouts.map(workout => workout.id) } }
      },
    }],
  })

  const failed = adapter(JSON.stringify(example), {
    expectedWeekType: 'continuation',
    expectedTargetWeekStartDate: '2026-09-21',
    expectedFixedClubSessions: continuationFixedSessions,
  })
  assert.equal(failed.ok, false)
  if (!failed.ok) assert.match(failed.formattedIssues, /workouts\[3\]\.category: Mobility must stay local until the domain layer is ready\./)

  const withoutMobility = { ...example, workouts: example.workouts.filter(workout => workout.category !== 'mobility') }
  const passed = adapter(JSON.stringify(withoutMobility), {
    expectedWeekType: 'continuation',
    expectedTargetWeekStartDate: '2026-09-21',
    expectedFixedClubSessions: continuationFixedSessions,
  })
  assert.equal(passed.ok, true)
  if (!passed.ok) return
  assert.deepEqual(passed.data, { acceptedIds: ['fixed-club-workout-1', 'aerobic-1', 'strength-1'] })
})

test('domain-style parse hooks can map the validated contract into a downstream workout shape', () => {
  const example = buildWeekContractExample('initial', '2026-09-14', fixedClubSessions)
  const result = parseAndValidatePastedPlan<{
    version: 1
    weekStart: string
    summary: string
    workouts: Array<{
      scheduledDate: string
      startTime: string
      category: string
      purpose: string
      warmupCount: number
      fixed: boolean
    }>
  }>(JSON.stringify(example), {
    expectedWeekType: 'initial',
    expectedTargetWeekStartDate: '2026-09-14',
    expectedFixedClubSessions: fixedClubSessions,
    domainValidator: {
      parse(value) {
        return {
          version: 1,
          weekStart: value.targetWeek.startDate,
          summary: value.summary,
          workouts: value.workouts.map(workout => ({
            scheduledDate: workout.date,
            startTime: workout.startTime,
            category: workout.category,
            purpose: workout.purpose,
            warmupCount: workout.warmup.length,
            fixed: workout.source.kind === 'fixed_club',
          })),
        }
      },
    },
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.data.weekStart, '2026-09-14')
  assert.equal(result.data.workouts[0]?.fixed, true)
  assert.equal(result.data.workouts[1]?.category, 'aerobic')
})

test('duplicate keys and malformed JSON produce actionable failures', () => {
  const duplicateKeys = '{"format":"hybrid-coach-week","format":"hybrid-coach-week"}'
  const duplicate = parseAndValidatePastedPlan(duplicateKeys)
  assert.equal(duplicate.ok, false)
  if (!duplicate.ok) assert.match(formatValidationIssues(duplicate.issues), /repeats a field name/)

  const malformed = parseAndValidatePastedPlan('not json')
  assert.equal(malformed.ok, false)
  if (!malformed.ok) assert.match(malformed.formattedIssues, /not valid JSON/)
})
