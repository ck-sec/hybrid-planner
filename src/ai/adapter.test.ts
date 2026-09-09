/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildWeekContractExample,
  createPastedPlanAdapter,
  formatValidationIssues,
  parseAndValidatePastedPlan,
  validatePastedPlan,
} from './index.ts'
import type { AiWeekCopyPasteContractV1, FixedClubSession, WorkoutStepContract } from './index.ts'

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
  assert.equal(result.contract.version, 2)
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

const legacyV1: AiWeekCopyPasteContractV1 = {
  format: 'hybrid-coach-week',
  version: 1,
  weekType: 'initial',
  targetWeek: {
    startDate: '2026-09-14',
    endDate: '2026-09-20',
    dates: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'],
  },
  summary: 'An existing version 1 plan.',
  workouts: [{
    id: 'legacy-strength',
    date: '2026-09-14',
    startTime: '18:00',
    category: 'strength',
    title: 'Strength practice',
    purpose: 'Controlled lifting.',
    expectedDuration: 30,
    warmup: [{ id: 'legacy-warmup', instruction: 'Warm up for the lift.', durationMin: 5 }],
    main: [{ id: 'legacy-lift', instruction: 'Perform the lift.', sets: 3, reps: 8, loadKg: 30, restSeconds: 90 }],
    cooldown: [],
    source: { kind: 'ai' },
  }],
}

test('unchanged v1 imports retain their version and accept legacy loads without basis or estimates', () => {
  const result = parseAndValidatePastedPlan(JSON.stringify(legacyV1))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.contract, legacyV1)
  assert.equal(result.contract.version, 1)
  assert.equal(Object.hasOwn(result.contract, 'athleteContext'), false)
  assert.equal(Object.hasOwn(result.contract, 'goalAssessment'), false)
})

test('v1 club imports preserve omitted optional source and workout context without filling defaults', () => {
  const session = {
    sessionId: 'legacy-club',
    label: 'Club strength',
    date: '2026-09-14',
    startTime: '18:00',
    durationMin: 45,
  }
  const optionalContext = { category: 'strength' as const, modality: 'lifting', notes: 'Meet by the gate.\nBring indoor shoes.' }
  for (const sourceContext of [{}, { category: optionalContext.category }, { modality: optionalContext.modality }, { notes: optionalContext.notes }, optionalContext]) {
    const plan: AiWeekCopyPasteContractV1 = {
      ...legacyV1,
      workouts: [{
        id: 'legacy-club-workout',
        date: session.date,
        startTime: session.startTime,
        category: 'strength',
        title: session.label,
        purpose: 'Attend the scheduled club.',
        expectedDuration: session.durationMin,
        warmup: [],
        main: [{ id: 'legacy-club-main', instruction: 'Follow the coach.', durationMin: 45 }],
        cooldown: [],
        source: { kind: 'fixed_club', fixedClub: { ...session, ...sourceContext } },
      }],
    }
    const result = parseAndValidatePastedPlan(JSON.stringify(plan), { expectedFixedClubSessions: [{ ...session, ...optionalContext }] })
    assert.equal(result.ok, true, result.ok ? '' : result.formattedIssues)
    if (result.ok) assert.deepEqual(result.contract, plan)
  }
})

test('v1 club imports reject explicitly conflicting optional context even when other fields are omitted', () => {
  const session = {
    sessionId: 'legacy-club',
    label: 'Club strength',
    date: '2026-09-14',
    startTime: '18:00',
    durationMin: 45,
  }
  const optionalContext = { category: 'strength' as const, modality: 'lifting', notes: 'Meet by the gate.' }
  for (const conflict of [{ category: 'mobility' }, { modality: 'yoga' }, { notes: 'Meet indoors.' }]) {
    for (const location of ['source', 'workout']) {
      const plan = {
        ...legacyV1,
        workouts: [{
          id: 'legacy-club-workout',
          date: session.date,
          startTime: session.startTime,
          category: 'strength',
          title: session.label,
          purpose: 'Attend the scheduled club.',
          expectedDuration: session.durationMin,
          warmup: [],
          main: [{ id: 'legacy-club-main', instruction: 'Follow the coach.', durationMin: 45 }],
          cooldown: [],
          ...(location === 'workout' ? conflict : {}),
          source: { kind: 'fixed_club', fixedClub: { ...session, ...(location === 'source' ? conflict : {}) } },
        }],
      }
      const result = parseAndValidatePastedPlan(JSON.stringify(plan), { expectedFixedClubSessions: [{ ...session, ...optionalContext }] })
      assert.equal(result.ok, false)
      if (!result.ok) assert.ok(result.issues.some(issue => issue.code === 'mismatched_fixed_club'))
    }
  }
})

test('AI imports require at least one workout in both versions even though manual weeks may be empty', () => {
  for (const plan of [legacyV1, buildWeekContractExample('initial', '2026-09-14')]) {
    let domainValidatorCalled = false
    const result = parseAndValidatePastedPlan(JSON.stringify({ ...plan, workouts: [] }), {
      domainValidator() { domainValidatorCalled = true; return true },
    })
    assert.equal(result.ok, false)
    assert.equal(domainValidatorCalled, false)
    if (!result.ok) assert.ok(result.issues.some(issue => issue.path === 'workouts' && issue.code === 'invalid_length'))
  }
})

test('v1 remains strict at the root and does not silently accept v2 step fields', () => {
  for (const extra of [
    { athleteContext: { asOf: '2026-09-09' } },
    { goalAssessment: buildWeekContractExample('initial', '2026-09-14').goalAssessment },
  ]) {
    const result = parseAndValidatePastedPlan(JSON.stringify({ ...legacyV1, ...extra }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.issues.some(issue => issue.code === 'unexpected_field'))
  }
  for (const extra of [{ estimatedTotalMin: 5 }, { loadBasis: 'total' }, { repBasis: 'total' }]) {
    const result = parseAndValidatePastedPlan(JSON.stringify({
      ...legacyV1,
      workouts: legacyV1.workouts.map(workout => ({ ...workout, main: workout.main.map(step => ({ ...step, ...extra })) })),
    }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.issues.some(issue => issue.code === 'unexpected_field'))
  }
})

test('v2 example contains timing estimates and an unassessed goal, but no fictional athlete baseline', () => {
  const example = buildWeekContractExample('initial', '2026-09-14', fixedClubSessions)
  assert.equal(example.version, 2)
  assert.equal(example.goalAssessment.status, 'unassessed')
  assert.equal(Object.hasOwn(example, 'athleteContext'), false)
  for (const workout of example.workouts) {
    const steps = [...workout.warmup, ...workout.main, ...workout.cooldown]
    assert.ok(steps.every(step => typeof step.estimatedTotalMin === 'number' && step.estimatedTotalMin > 0))
    assert.equal(Math.ceil(steps.reduce((total, step) => total + step.estimatedTotalMin!, 0)), workout.expectedDuration)
  }
  assert.deepEqual(validatePastedPlan(example), [])
})

test('v2 preserves the complete confirmed context, goal assessment, and explicit load and rep bases', () => {
  const example = buildWeekContractExample('continuation', '2026-09-14')
  const athleteContext = {
    asOf: '2026-09-09',
    event: 'HYROX doubles open',
    benchmarks: ['No recent timed run.'],
    limitations: ['Avoid painful overhead movement.'],
    recentTraining: {
      weeks: 4,
      aerobicMinutes: 90,
      strengthMinutes: 70,
      mobilityMinutes: 0,
      clubMinutes: 60,
      aerobicSessions: 2,
      strengthSessions: 2,
      summary: 'Average weekly actual training, excluding club work from the other categories.',
    },
    sessionLimits: [{ dayOfWeek: 1, maxMinutes: 45 }],
    weeklyTimeLimitMin: 300,
    clubLoads: [{ sessionId: 'club-social', durationMin: 60, effortRating: 5 }],
  }
  const plan = {
    ...example,
    athleteContext,
    goalAssessment: {
      status: 'conditional',
      rationale: 'Progress depends on event-specific practice and recovery.',
      unknowns: ['Current running benchmark.'],
      nextMilestone: 'Review a conversational run and club recovery after one week.',
    },
    workouts: example.workouts.map(workout => workout.category === 'strength'
      ? { ...workout, main: workout.main.map(step => ({ ...step, loadKg: 12, loadBasis: 'per_implement', reps: 8, repBasis: 'per_side', estimatedTotalMin: 20.5 })) }
      : workout),
  }
  let validatedVersion: number | undefined
  const result = parseAndValidatePastedPlan(JSON.stringify(plan), {
    domainValidator: value => { validatedVersion = value.version; return true },
  })
  assert.equal(result.ok, true)
  if (!result.ok || result.contract.version !== 2) return
  assert.equal(validatedVersion, 2)
  assert.deepEqual(result.contract, plan)
  assert.deepEqual(result.contract.athleteContext, athleteContext)
  assert.equal(result.contract.workouts[1]?.main[0]?.durationMin, undefined)
})

test('v2 goal assessment is required, strict, and supports only the documented statuses', () => {
  const example = buildWeekContractExample('initial', '2026-09-14')
  for (const goalAssessment of [
    undefined,
    null,
    {},
    { ...example.goalAssessment, status: 'guaranteed' },
    { ...example.goalAssessment, rationale: '' },
    { ...example.goalAssessment, unknowns: 'Unknown.' },
    { ...example.goalAssessment, nextMilestone: null },
    { ...example.goalAssessment, probability: 0.95 },
  ]) {
    const result = parseAndValidatePastedPlan(JSON.stringify({ ...example, goalAssessment }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.issues.some(issue => issue.path.startsWith('goalAssessment')))
  }
  for (const status of ['unassessed', 'conditional', 'not_supported']) {
    const result = parseAndValidatePastedPlan(JSON.stringify({ ...example, goalAssessment: { ...example.goalAssessment, status } }))
    assert.equal(result.ok, true)
  }
})

test('v2 athlete context uses shared strict validation and reports nested issue paths', () => {
  const example = buildWeekContractExample('initial', '2026-09-14')
  for (const [athleteContext, path] of [
    [null, 'athleteContext'],
    [{ event: '10k' }, 'athleteContext.asOf'],
    [{ asOf: '2026-02-30' }, 'athleteContext.asOf'],
    [{ asOf: '2026-09-09', recentTraining: { weeks: 4, aerobicMinutes: -1 } }, 'athleteContext.recentTraining.aerobicMinutes'],
    [{ asOf: '2026-09-09', sessionLimits: [{ dayOfWeek: 7, maxMinutes: 30 }] }, 'athleteContext.sessionLimits[0].dayOfWeek'],
    [{ asOf: '2026-09-09', clubLoads: [{ sessionId: 'club-1', effortRating: 11 }] }, 'athleteContext.clubLoads[0].effortRating'],
    [{ asOf: '2026-09-09', equipment: ['invented sled'] }, 'athleteContext.equipment'],
  ] as const) {
    const result = parseAndValidatePastedPlan(JSON.stringify({ ...example, athleteContext }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.issues.some(issue => issue.path === path), result.formattedIssues)
  }
  const result = parseAndValidatePastedPlan(JSON.stringify({ ...example, athleteContext: { asOf: '2026-09-09', event: '10k' } }))
  assert.equal(result.ok, true)
  if (result.ok && result.contract.version === 2) {
    assert.deepEqual(result.contract.athleteContext, { asOf: '2026-09-09', event: '10k' })
  }
})

test('every v2 step requires a finite positive total estimate, distinct from work duration', () => {
  const example = buildWeekContractExample('initial', '2026-09-14', fixedClubSessions)
  for (const [workoutIndex, section] of [[0, 'main'], [1, 'warmup'], [1, 'main'], [1, 'cooldown']] as const) {
    for (const estimatedTotalMin of [undefined, null, 0, -1, '15', 1441]) {
      const result = parseAndValidatePastedPlan(JSON.stringify({
        ...example,
        workouts: example.workouts.map((workout, index) => index === workoutIndex
          ? { ...workout, [section]: workout[section].map(step => ({ ...step, estimatedTotalMin })) }
          : workout),
      }))
      assert.equal(result.ok, false)
      if (!result.ok) assert.ok(result.issues.some(issue => issue.path === `workouts[${workoutIndex}].${section}[0].estimatedTotalMin`))
    }
  }
  for (const estimatedTotalMin of [NaN, Infinity]) {
    assert.ok(validatePastedPlan({
      ...example,
      workouts: [{ ...example.workouts[1], main: [{ id: 'invalid-estimate', instruction: 'Run easily.', estimatedTotalMin }] }],
    }).some(issue => issue.path === 'workouts[0].main[0].estimatedTotalMin'))
  }
})

test('v2 numeric prescriptions require a valid load basis, including zero load, and validate rep basis', () => {
  const example = buildWeekContractExample('initial', '2026-09-14')
  for (const extra of [
    { loadKg: 0 },
    { loadKg: 12 },
    { loadKg: 12, loadBasis: 'each' },
    { loadKg: 12, loadBasis: null },
    { repBasis: 'each' },
    { repBasis: null },
  ]) {
    const result = parseAndValidatePastedPlan(JSON.stringify({
      ...example,
      workouts: example.workouts.map(workout => ({ ...workout, main: workout.main.map(step => ({ ...step, ...extra })) })),
    }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.issues.some(issue => /\.(loadBasis|repBasis)$/.test(issue.path)))
  }
  for (const loadBasis of ['total', 'per_implement', 'added', 'assistance']) {
    const result = parseAndValidatePastedPlan(JSON.stringify({
      ...example,
      workouts: example.workouts.map(workout => ({ ...workout, main: workout.main.map(step => ({ ...step, loadKg: 0, loadBasis, reps: 8, repBasis: 'total' })) })),
    }))
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(result.contract.workouts[0]?.main[0]?.loadBasis, loadBasis)
  }
})

test('v1 and v2 preserve app-style multiline notes and instructions in every workout section', () => {
  for (const example of [legacyV1, buildWeekContractExample('continuation', '2026-09-14')]) {
    for (const lineBreak of ['\n', '\r\n', '\r']) {
      const notes = `AI metadata:${lineBreak}Modality: running`
      const instruction = `Start at conversational effort.${lineBreak}Keep the movement controlled.`
      const withProse = (steps: readonly WorkoutStepContract[]) => steps.map(step => ({ ...step, instruction, notes, purpose: notes }))
      const plan = {
        ...example,
        summary: notes,
        workouts: example.workouts.map(workout => ({
          ...workout,
          notes,
          purpose: notes,
          warmup: withProse(workout.warmup),
          main: withProse(workout.main),
          cooldown: withProse(workout.cooldown),
        })),
      }
      const result = parseAndValidatePastedPlan(JSON.stringify(plan))
      assert.equal(result.ok, true, result.ok ? '' : result.formattedIssues)
      if (result.ok) assert.deepEqual(result.contract, plan)
    }
  }
})

test('multiline prose still rejects HTML and genuine control characters before normalization in both versions', () => {
  for (const example of [legacyV1, buildWeekContractExample('initial', '2026-09-14')]) {
    for (const invalid of ['\t', '\u0000', '\u000B', '\u001B', '\u007F', '\u0085', '\u200B', '\uFEFF', '\u202E', '<b>text</b>', '<b\n>text</b>']) {
      const text = `${invalid}AI metadata:\r\nModality: running`
      const result = parseAndValidatePastedPlan(JSON.stringify({
        ...example,
        summary: text,
        workouts: example.workouts.map(workout => ({
          ...workout,
          notes: text,
          purpose: text,
          main: workout.main.map(step => ({ ...step, instruction: text, notes: text, purpose: text })),
        })),
      }))
      assert.equal(result.ok, false)
      if (!result.ok) {
        for (const path of ['summary', 'workouts[0].notes', 'workouts[0].purpose', 'workouts[0].main[0].instruction', 'workouts[0].main[0].notes', 'workouts[0].main[0].purpose']) {
          assert.ok(result.issues.some(issue => issue.path === path && issue.code === 'invalid_text'), `${example.version}: ${path}`)
        }
      }
    }
  }
})

test('line breaks remain invalid in workout and step identifiers, dates, and clocks', () => {
  for (const example of [legacyV1, buildWeekContractExample('initial', '2026-09-14')]) {
    for (const lineBreak of ['\n', '\r', '\r\n']) {
      const first = example.workouts[0]!
      for (const field of ['id', 'date', 'startTime'] as const) {
        const result = parseAndValidatePastedPlan(JSON.stringify({
          ...example,
          workouts: [{ ...first, [field]: `${first[field]}${lineBreak}` }],
        }))
        assert.equal(result.ok, false)
        if (!result.ok) assert.ok(result.issues.some(issue => issue.path === `workouts[0].${field}`))
      }
      const result = parseAndValidatePastedPlan(JSON.stringify({
        ...example,
        targetWeek: { ...example.targetWeek, startDate: `${example.targetWeek.startDate}${lineBreak}` },
        workouts: [{ ...first, main: first.main.map(step => ({ ...step, id: `${step.id}${lineBreak}` })) }],
      }))
      assert.equal(result.ok, false)
      if (!result.ok) {
        assert.ok(result.issues.some(issue => issue.path === 'targetWeek.startDate'))
        assert.ok(result.issues.some(issue => issue.path === 'workouts[0].main[0].id'))
      }
    }
  }
})

test('v2 shared prose permits line breaks without loosening context identifiers or discriminants', () => {
  const example = buildWeekContractExample('initial', '2026-09-14')
  const plan = {
    ...example,
    athleteContext: {
      asOf: '2026-09-09',
      event: 'HYROX\nOpen doubles.',
      benchmarks: ['Recent 5k:\r\nNot measured.'],
      limitations: ['Athlete notes:\nLimited overhead range.'],
      recentTraining: { weeks: 4, summary: 'Weekly averages:\nNot recorded.' },
    },
    goalAssessment: {
      ...example.goalAssessment,
      rationale: 'Current evidence:\nInsufficient.',
      unknowns: ['Recent running benchmark:\r\nNot measured.'],
      nextMilestone: 'Calibration week:\nReview actuals before progression.',
    },
  }
  const valid = parseAndValidatePastedPlan(JSON.stringify(plan))
  assert.equal(valid.ok, true, valid.ok ? '' : valid.formattedIssues)
  if (valid.ok) assert.deepEqual(valid.contract, plan)
  for (const [extra, path] of [
    [{ athleteContext: { asOf: '2026-09-09\n' } }, 'athleteContext.asOf'],
    [{ athleteContext: { asOf: '2026-09-09', clubLoads: [{ sessionId: 'club-1\n' }] } }, 'athleteContext.clubLoads[0].sessionId'],
    [{ goalAssessment: { ...example.goalAssessment, status: 'unassessed\n' } }, 'goalAssessment.status'],
  ] as const) {
    const result = parseAndValidatePastedPlan(JSON.stringify({ ...example, ...extra }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.issues.some(issue => issue.path === path))
  }
})

test('v2 context and goal text reject markup and nonprinting control characters before normalization', () => {
  const example = buildWeekContractExample('initial', '2026-09-14')
  for (const text of ['Benchmark\t', '\uFEFFBenchmark', 'Bench\u200Bmark', '<b>Benchmark</b>']) {
    for (const extra of [
      { athleteContext: { asOf: '2026-09-09', benchmarks: [text] } },
      { goalAssessment: { ...example.goalAssessment, rationale: text } },
    ]) {
      const result = parseAndValidatePastedPlan(JSON.stringify({ ...example, ...extra }))
      assert.equal(result.ok, false)
      if (!result.ok) assert.ok(result.issues.some(issue => issue.code === 'invalid_text'))
    }
  }
})

test('supplied club notes, modality, and category cannot be dropped or rewritten', () => {
  const sessions = fixedClubSessions.map(session => ({ ...session, notes: 'Meet by the gate.\r\nBring indoor shoes.' }))
  const example = buildWeekContractExample('initial', '2026-09-14', sessions)
  const valid = parseAndValidatePastedPlan(JSON.stringify(example), { expectedFixedClubSessions: sessions })
  assert.equal(valid.ok, true)
  if (valid.ok) assert.equal(valid.contract.workouts[0]?.notes, 'Meet by the gate.\r\nBring indoor shoes.')
  for (const [field, replacement] of [['notes', 'Meet indoors.'], ['modality', 'running'], ['category', 'strength']] as const) {
    for (const changedValue of [undefined, replacement]) {
      for (const change of ['workout', 'source', 'both']) {
        const result = parseAndValidatePastedPlan(JSON.stringify({
          ...example,
          workouts: example.workouts.map(workout => workout.source.kind === 'fixed_club'
            ? {
              ...workout,
              ...(change === 'source' ? {} : { [field]: changedValue }),
              source: {
                ...workout.source,
                fixedClub: { ...workout.source.fixedClub, ...(change === 'workout' ? {} : { [field]: changedValue }) },
              },
            }
            : workout),
        }), { expectedFixedClubSessions: sessions })
        assert.equal(result.ok, false, `${field} ${change}`)
        if (!result.ok) assert.match(result.formattedIssues, /fixed club/i)
      }
    }
  }
})

test('fixed club notes allow CR/LF but not HTML or hidden controls, and metadata stays single-line', () => {
  const session = fixedClubSessions[0]!
  const example = buildWeekContractExample('initial', '2026-09-14', fixedClubSessions)
  for (const notes of ['Meet by the gate.\n\u0000Bring shoes.', '\uFEFFMeet by the gate.', 'Meet by the gate.\r\n<b>Bring shoes.</b>']) {
    const result = parseAndValidatePastedPlan(JSON.stringify({
      ...example,
      workouts: example.workouts.map(workout => workout.source.kind === 'fixed_club'
        ? { ...workout, notes, source: { ...workout.source, fixedClub: { ...workout.source.fixedClub, notes } } }
        : workout),
    }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.issues.some(issue => issue.path === 'workouts[0].source.fixedClub.notes' && issue.code === 'invalid_text'))
  }
  for (const field of ['sessionId', 'date', 'startTime'] as const) {
    const result = parseAndValidatePastedPlan(JSON.stringify({
      ...example,
      workouts: example.workouts.map(workout => workout.source.kind === 'fixed_club'
        ? { ...workout, source: { ...workout.source, fixedClub: { ...workout.source.fixedClub, [field]: `${session[field]}\n` } } }
        : workout),
    }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.issues.some(issue => issue.path === `workouts[0].source.fixedClub.${field}`))
  }
})

test('only known versions are accepted and v2 still rejects unsupported root fields', () => {
  const example = buildWeekContractExample('initial', '2026-09-14')
  for (const version of [0, 3, '2', null]) {
    const result = parseAndValidatePastedPlan(JSON.stringify({ ...example, version }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.ok(result.issues.some(issue => issue.path === 'version'))
  }
  const result = parseAndValidatePastedPlan(JSON.stringify({ ...example, revisedEquipment: ['sled'] }))
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.issues.some(issue => issue.path === 'revisedEquipment' && issue.code === 'unexpected_field'))
})
