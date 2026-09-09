import assert from 'node:assert/strict'
import test from 'node:test'
import { parseAthleteProfile, parseWeekPlan } from '../../domain/contracts.ts'
import { buildPlanRevisionRequest, reviewPlanQuality } from './plan-quality.ts'

function athlete() {
  return parseAthleteProfile({
    version: 1, id: 'quality-athlete', name: 'Synthetic athlete', createdOn: '2026-09-09', updatedOn: '2026-09-09',
    goal: 'Prepare for dodgeball trials', sports: ['dodgeball'], constraints: [], equipmentDetails: [],
    preferredWeeklyStructure: [{ dayOfWeek: 1, modalities: ['strength'] }, { dayOfWeek: 5, modalities: ['strength'] }, { dayOfWeek: 6, modalities: ['aerobic'] }],
    clubSessions: [{ id: 'club-tue', title: 'Tuesday club', dayOfWeek: 2, startTime: '19:00' }, { id: 'club-thu', title: 'Thursday club', dayOfWeek: 4, startTime: '19:00' }],
    planningContext: {
      asOf: '2026-09-09', event: 'Foam club player', benchmarks: ['Recent strength session: 35 min'],
      recentTraining: { weeks: 6, aerobicMinutes: 25, strengthMinutes: 35, mobilityMinutes: 0, clubMinutes: 180, strengthSessions: 1 },
      clubLoads: [{ sessionId: 'club-tue', durationMin: 90 }, { sessionId: 'club-thu', durationMin: 90 }],
      sessionLimits: [{ dayOfWeek: 1, maxMinutes: 45 }, { dayOfWeek: 5, maxMinutes: 45 }, { dayOfWeek: 6, maxMinutes: 40 }],
    },
  })
}

function week() {
  return parseWeekPlan({
    version: 1, id: 'quality-week', athleteId: 'quality-athlete', weekStart: '2026-09-14', title: 'Test week', goal: 'Support club',
    goalAssessment: { status: 'conditional', rationale: 'Support the team.', unknowns: ['Selection'], nextMilestone: 'Ask the coach about trials.' },
    workouts: [
      ['strength-a', '2026-09-14', 'strength', 45],
      ['strength-b', '2026-09-18', 'strength', 45],
      ['run', '2026-09-19', 'aerobic', 40],
    ].map(([id, date, category, minutes]) => ({
      version: 1, id, athleteId: 'quality-athlete', weekPlanId: 'quality-week', scheduledDate: date, category,
      title: id, purpose: 'Test', source: 'ai', startTime: '18:00', expectedDurationMin: minutes,
      warmup: [{ id: `${id}-warm`, title: 'Warm up', target: { minutes: 5 } }],
      main: [{ id: `${id}-main`, title: 'Main work', target: { minutes: Number(minutes) - 10 } }],
      cooldown: [{ id: `${id}-cool`, title: 'Cool down', target: { minutes: 5 } }],
    })),
  })
}

test('quality review counts club minutes and exposes actual progression without trusting the AI rationale', () => {
  const result = reviewPlanQuality(week(), athlete())
  assert.equal(result.quality.knownMinutes, 310)
  assert.equal(result.quality.clubMinutes, 180)
  assert.equal(result.quality.baselineMinutes, 240)
  assert.equal(result.quality.baselineComplete, true)
  assert.match(result.quality.comparisons.find(item => item.label === 'Strength')!.value, /35 -> 90 min \(\+55\)/)
  assert.ok(result.issues.some(issue => issue.id === 'new-frequency-strength'))
  assert.ok(result.issues.every(issue => issue.severity === 'warning'))
})

test('missing club time and partial baseline are not treated as zero or certified complete', () => {
  const profile = athlete()
  profile.planningContext = { asOf: '2026-09-09', recentTraining: { weeks: 4, strengthMinutes: 35 } }
  const result = reviewPlanQuality(week(), profile)
  assert.equal(result.quality.knownMinutes, 130)
  assert.equal(result.quality.unknownClubCount, 2)
  assert.equal(result.quality.baselineMinutes, 35)
  assert.equal(result.quality.baselineComplete, false)
  assert.ok(result.issues.some(issue => issue.id === 'club-duration-unknown'))
})

test('session frequency uses the selected count rather than counting preferred days', () => {
  const profile = athlete()
  profile.notes = '@guided-onboarding ' + JSON.stringify({ version: 1, currentStep: 'review', counts: { aerobic: '1', strength: '2', mobility: '0' } })
  profile.preferredWeeklyStructure = [{ dayOfWeek: 1, modalities: ['strength'] }, { dayOfWeek: 6, modalities: ['aerobic'] }]
  const plan = week()
  plan.workouts[1]!.scheduledDate = plan.workouts[0]!.scheduledDate
  plan.workouts[1]!.startTime = '07:00'
  const result = reviewPlanQuality(plan, profile)
  assert.equal(result.issues.some(issue => issue.id === 'frequency-strength'), false)
  assert.equal(result.issues.some(issue => issue.id === 'frequency-unknown'), false)
  profile.notes = profile.notes.replace('"strength":"2"', '"strength":"1"')
  assert.ok(reviewPlanQuality(plan, profile).issues.some(issue => issue.id === 'frequency-strength'))
})

test('review flags forty timed minutes inside a thirty-minute session and inconsistent set estimates', () => {
  const plan = week()
  plan.workouts[0]!.expectedDurationMin = 30
  plan.workouts[0]!.main[0]!.target = { minutes: 30 }
  plan.workouts[1]!.main[0]!.target = { sets: 3, minutes: 2 }
  plan.workouts[1]!.main[0]!.estimatedTotalMin = 5
  const result = reviewPlanQuality(plan, athlete())
  assert.match(result.issues.find(issue => issue.id === 'clock-strength-a')!.message, /40 min.*30 min/)
  assert.ok(result.issues.some(issue => issue.id === 'block-strength-b-strength-b-main'))
})

test('review flags confirmed caps and overlapping commitments without changing the plan', () => {
  const profile = athlete()
  profile.clubSessions[0]!.dayOfWeek = 1
  profile.clubSessions[0]!.startTime = '18:30'
  profile.planningContext!.weeklyTimeLimitMin = 250
  const plan = week()
  plan.workouts[0]!.expectedDurationMin = 60
  const before = JSON.stringify(plan)
  const result = reviewPlanQuality(plan, profile)
  assert.ok(result.issues.some(issue => issue.id === 'cap-strength-a'))
  assert.ok(result.issues.some(issue => issue.id === 'weekly-time-limit'))
  assert.ok(result.issues.some(issue => issue.id.startsWith('overlap-')))
  assert.equal(JSON.stringify(plan), before)
})

test('fixed club workouts are not counted twice and proposed facts are reviewable', () => {
  const profile = athlete()
  const plan = week()
  profile.clubSessions[0] = { ...profile.clubSessions[0]!, durationMin: 90, category: 'aerobic', scope: 'Team practice' }
  const withFixedClub = parseWeekPlan({
    ...plan,
    workouts: [...plan.workouts, {
      ...plan.workouts[0]!, id: 'fixed-tue', scheduledDate: '2026-09-15', startTime: '19:00',
      category: 'aerobic', source: 'club', expectedDurationMin: 90,
      fixedClubSession: { recurringSessionId: 'club-tue', title: 'Tuesday club', scope: 'Team practice', category: 'aerobic', dayOfWeek: 2, startTime: '19:00', durationMin: 90 },
    }],
  })
  const result = reviewPlanQuality(withFixedClub, profile, profile.planningContext)
  assert.equal(result.quality.knownMinutes, 310)
  assert.ok(result.quality.proposedFacts.some(fact => fact.label === 'Tuesday club' && fact.value.includes('90 min')))
  assert.ok(result.quality.proposedFacts.some(fact => fact.label === 'Mobility' && fact.value === '0 min/week'))
  const revision = buildPlanRevisionRequest('Original athlete facts', '{"draft":true}', result.issues)
  assert.match(revision, /Original athlete facts/)
  assert.match(revision, /"draft":true/)
  assert.match(revision, /frequency rises/)
})
