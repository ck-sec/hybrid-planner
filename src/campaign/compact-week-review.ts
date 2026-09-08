import type { SetLog } from '../../engine/types.ts'
import type { WeekReview, WeekReviewSession } from './week-review.ts'

export interface CompactWeekReview {
  version: 1
  weekIndex: number
  weekStart: string
  detail: 'normal' | 'minimal'
  sessionCount: number
  counts: WeekReview['counts']
  planned: string
  actual: string
  feedback: string
  health: string
  byDiscipline: string[]
  sessions?: string[]
  exercises?: string[]
  notes?: string[]
  changes?: string[]
  omissions: {
    sessions: number
    exercises: number
    notes: number
    noteChars: number
    changes: number
    changeChars: number
    observations: number
    plannedOmissions: number
    modalityRows: number
    painDates: number
  }
  summarized: string
}

interface Measure {
  n: number
  sum: number
  min: number
  max: number
}

interface Volume {
  min: number
  sets: number
  reps: number
  mobility: number
  carry: number
  throws: number
}

interface Actual {
  duration: Measure
  effort: Measure
  distance: Measure
  hr: Measure
  sets: number
  reps: Measure
  kg: Measure
  rpe: Measure
  mobility: Measure
  carry: Measure
  unmatched: Measure
  timedKg: Measure
  throws: Measure
}

const measure = (): Measure => ({ n: 0, sum: 0, min: Infinity, max: -Infinity })
const volume = (): Volume => ({ min: 0, sets: 0, reps: 0, mobility: 0, carry: 0, throws: 0 })
const actual = (): Actual => ({
  duration: measure(), effort: measure(), distance: measure(), hr: measure(),
  sets: 0, reps: measure(), kg: measure(), rpe: measure(),
  mobility: measure(), carry: measure(), unmatched: measure(), timedKg: measure(), throws: measure(),
})
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const sum = (value: Measure) => value.n ? String(value.sum) : '?'
const range = (value: Measure) => value.n ? value.min === value.max ? String(value.min) : `${value.min}..${value.max}` : '?'
const observed = (value: Measure) => `${sum(value)}/${value.n}`
const rated = (value: Measure) => `${range(value)}/${value.n}`

function record(value: Measure, observation: number | null | undefined): void {
  if (observation === null || observation === undefined) return
  value.n++
  value.sum += observation
  value.min = Math.min(value.min, observation)
  value.max = Math.max(value.max, observation)
}

function recordSets(target: Actual, sets: readonly SetLog[]): void {
  target.sets += sets.length
  for (const set of sets) {
    record(target.reps, set.reps)
    record(target.kg, set.weightKg)
    record(target.rpe, set.actualRPE)
  }
}

function liftSummary(value: Actual): string {
  return `setRows=${value.sets} reps=${sum(value.reps)}[${range(value.reps)}] kg=${range(value.kg)} RPE=${range(value.rpe)}`
}

function excerpt(text: string, chars: number): { text: string; omitted: number } {
  if (text.length <= chars) return { text, omitted: 0 }
  const head = Math.ceil(chars * 0.6)
  return {
    text: `${text.slice(0, head)}...[${text.length - chars} chars omitted]...${text.slice(-(chars - head))}`,
    omitted: text.length - chars,
  }
}

/** A lossy outgoing summary only. The review and its local source logs remain unchanged. */
export function compactWeekReview(review: WeekReview, detail: 'normal' | 'minimal'): CompactWeekReview {
  const ordered = [...review.sessions].sort((a, b) => compare(a.date, b.date) || compare(a.id, b.id))
  const planned = volume()
  const performed = actual()
  const groups = new Map<string, { n: number; planned: Volume; actual: Actual }>()
  const exercises = new Map<string, { planned: Volume; actual: Actual }>()
  const painDates = new Map<string, number>()
  const feelings = { easier: 0, as_expected: 0, harder: 0, unknown: 0 }
  const skips = { life: 0, too_tired: 0, pain: 0, illness: 0, weather: 0, other: 0, unknown: 0 }
  const counts: WeekReview['counts'] = {
    completed: 0, finishedEarly: 0, partial: 0, skipped: 0,
    skippedTime: 0, skippedFatigue: 0, removed: 0, unlogged: 0, omitted: review.omitted.length,
  }
  const notes: Array<{ label: string; text: string }> = []
  let pain = 0
  let noPain = 0
  let unknownPain = 0
  let plannedRows = 0
  let actualRows = 0
  let missingWork = 0

  const exercise = (id: string) => {
    let item = exercises.get(id)
    if (!item) {
      item = { planned: volume(), actual: actual() }
      exercises.set(id, item)
    }
    return item
  }

  for (const [index, session] of ordered.entries()) {
    if (session.status === 'finished_early') counts.finishedEarly++
    else counts[session.status]++
    const key = `${session.discipline}/${session.modality}`
    let group = groups.get(key)
    if (!group) {
      group = { n: 0, planned: volume(), actual: actual() }
      groups.set(key, group)
    }
    group.n++
    for (const target of [planned, group.planned]) target.min += session.plannedDurationMin
    for (const target of [performed, group.actual]) {
      record(target.duration, session.actualDurationMin)
      record(target.effort, session.actualEffort)
      record(target.distance, session.feedback?.distanceKm)
      record(target.hr, session.feedback?.averageHr)
    }
    for (const item of session.plannedStrength ?? []) {
      plannedRows++
      for (const target of [planned, group.planned, exercise(item.exerciseId).planned]) {
        target.sets += item.sets
        target.reps += item.sets * item.reps
      }
    }
    for (const block of session.plannedBlocks ?? []) {
      plannedRows++
      const id = block.unit === 'throws' ? block.drillId : block.exerciseId
      for (const target of [planned, group.planned, exercise(id).planned]) {
        if (block.unit === 'reps') {
          target.sets += block.sets
          target.reps += block.sets * block.reps
        } else if (block.unit === 'seconds') target[block.role] += block.sets * block.seconds
        else target.throws += block.throws
      }
    }
    const sets = session.sets ?? []
    for (const target of [performed, group.actual]) recordSets(target, sets)
    for (const set of sets) recordSets(exercise(set.exerciseId).actual, [set])
    actualRows += sets.length
    if ((session.plannedBlocks?.length || session.plannedStrength?.length)
      && session.sets === null && session.blockLogs === null) missingWork++
    for (const block of session.blockLogs ?? []) {
      const id = block.unit === 'throws' ? block.drillId : block.exerciseId
      const targets = [performed, group.actual, exercise(id).actual]
      if (block.unit === 'reps') {
        for (const target of targets) recordSets(target, block.sets)
        actualRows += block.sets.length
      } else if (block.unit === 'seconds') {
        // Only a matching prescription identifies mobility versus carries.
        const prescribed = session.plannedBlocks?.[block.blockIndex]
        const role = prescribed?.unit === 'seconds' && prescribed.exerciseId === block.exerciseId ? prescribed.role : 'unmatched'
        for (const target of targets) {
          record(target[role], block.seconds)
          record(target.timedKg, block.weightKg)
        }
        actualRows++
      } else {
        for (const target of targets) record(target.throws, block.throws)
        actualRows++
      }
    }
    feelings[session.feedback?.feeling ?? 'unknown']++
    if (session.status === 'skipped') skips[session.skipReason ?? 'unknown']++
    if (session.painFlag === true) pain++
    else if (session.painFlag === false) noPain++
    else unknownPain++
    if (session.painFlag || (session.status === 'skipped' && session.skipReason === 'pain')) {
      painDates.set(session.date, (painDates.get(session.date) ?? 0) + 1)
    }
    const label = `s${index + 1} ${session.date} ${key}`
    if (session.notes?.length) notes.push({ label: `${label} log`, text: session.notes })
    if (session.feedback?.note?.length) notes.push({ label: `${label} feedback`, text: session.feedback.note })
  }

  const changes = (review.changes ?? []).map((item, index) => ({ label: `c${index + 1}`, text: item.message }))
    .sort((a, b) => Number(/prefer|future|swap|replacement|->/i.test(b.text)) - Number(/prefer|future|swap|replacement|->/i.test(a.text)))
  const knownPainDates = [...painDates].sort(([a], [b]) => compare(a, b))
  counts.skippedTime = skips.life
  counts.skippedFatigue = skips.too_tired
  const recounted = (Object.keys(counts) as Array<keyof WeekReview['counts']>)
    .some(key => counts[key] !== review.counts[key])
  const hold = review.healthHold ? `${review.healthHold.reason} since ${review.healthHold.since}` : 'not recorded; not clearance'
  const skipText = Object.entries(skips).filter(([, n]) => n).map(([key, n]) => `${key}=${n}`).join(',') || 'none recorded'
  const result: CompactWeekReview = {
    version: 1, weekIndex: review.weekIndex, weekStart: review.weekStart, detail,
    sessionCount: ordered.length, counts,
    planned: `min=${planned.min}; lift sets=${planned.sets} reps=${planned.reps}; seconds mobility=${planned.mobility} carry=${planned.carry}; throws=${planned.throws}`,
    actual: `min=${observed(performed.duration)}; lift ${liftSummary(performed)}; seconds mobility=${observed(performed.mobility)} carry=${observed(performed.carry)} unmatched=${observed(performed.unmatched)} timedKg=${rated(performed.timedKg)}; throws=${observed(performed.throws)}`,
    feedback: `feeling easier=${feelings.easier} as_expected=${feelings.as_expected} harder=${feelings.harder} unknown=${feelings.unknown}; effort=${rated(performed.effort)}; km=${observed(performed.distance)}; HR=${rated(performed.hr)}; skips ${skipText}`,
    health: `painFlag yes=${pain} no=${noPain} unknown=${unknownPain}; knownPain=${knownPainDates.reduce((n, [, count]) => n + count, 0)}; dates=${knownPainDates.slice(0, 7).map(([date, count]) => `${date}:${count}`).join(',') || 'none recorded'}; hold=${hold}`,
    byDiscipline: [],
    omissions: {
      sessions: ordered.length, exercises: exercises.size,
      notes: notes.length, noteChars: notes.reduce((n, item) => n + item.text.length, 0),
      changes: changes.length, changeChars: changes.reduce((n, item) => n + item.text.length, 0),
      observations: review.observations.length, plannedOmissions: review.omitted.length,
      modalityRows: groups.size, painDates: Math.max(0, knownPainDates.length - 7),
    },
    summarized: `?=unknown; /n=record count; [a..b]=range. Planned includes removed/skipped/unlogged, not actual. Recorded sums only; missing remainder unknown (${missingWork} sessions lack work logs). ${plannedRows} planned rows/${actualRows} actual rows aggregated; observations replaced. Session/change IDs, labels, prescriptions, pace/overrun detail omitted. Feelings are not RPE; no catch-up or health clearance. Exact details remain saved locally.${recounted ? ' Counts reconciled from sessions/omitted entries.' : ''}`,
  }

  const limit = detail === 'normal' ? 6_000 : 2_200
  const fits = () => JSON.stringify(result, null, 2).length <= limit
  function addRow(field: 'sessions' | 'exercises' | 'byDiscipline', text: string): boolean {
    const rows = result[field] ?? []
    rows.push(text)
    result[field] = rows
    const counter = field === 'byDiscipline' ? 'modalityRows' : field
    result.omissions[counter]--
    if (fits()) return true
    result.omissions[counter]++
    rows.pop()
    if (!rows.length && field !== 'byDiscipline') delete result[field]
    return false
  }
  function addText(field: 'notes' | 'changes', item: { label: string; text: string }, chars: number): boolean {
    const value = excerpt(item.text, chars)
    const rows = result[field] ?? []
    rows.push(`${item.label}: ${value.text}`)
    result[field] = rows
    const charCounter = field === 'notes' ? 'noteChars' : 'changeChars'
    result.omissions[field]--
    result.omissions[charCounter] -= item.text.length - value.omitted
    if (fits()) return true
    result.omissions[field]++
    result.omissions[charCounter] += item.text.length - value.omitted
    rows.pop()
    if (!rows.length) delete result[field]
    return false
  }

  for (const [key, group] of [...groups].sort(([a], [b]) => compare(a, b))) {
    const timed = detail === 'normal' && (group.actual.mobility.n || group.actual.carry.n || group.actual.unmatched.n)
      ? ` sec mobility=${sum(group.actual.mobility)} carry=${sum(group.actual.carry)} unmatched=${sum(group.actual.unmatched)}` : ''
    addRow('byDiscipline', `${key} n=${group.n} min P=${group.planned.min} A=${observed(group.actual.duration)}${timed}`)
  }
  for (let index = 0; index < (detail === 'normal' ? 2 : 1); index++) {
    if (notes[index]) addText('notes', notes[index], detail === 'normal' ? 100 : 48)
    if (changes[index]) addText('changes', changes[index], detail === 'normal' ? 140 : 64)
  }
  if (detail === 'normal') {
    const exerciseRows = [...exercises].sort(([a], [b]) => compare(a, b))
    for (let index = 0; index < 56; index++) {
      const session: WeekReviewSession | undefined = ordered[index]
      if (session) {
        addRow('sessions', `s${index + 1} ${session.date} ${session.discipline}/${session.modality} ${session.status}${session.skipReason ? `:${session.skipReason}` : ''} min P=${session.plannedDurationMin} A=${session.actualDurationMin ?? '?'} effort=${session.actualEffort ?? '?'} feeling=${session.feedback?.feeling ?? '?'} pain=${session.painFlag ?? '?'}`)
      }
      const item = index < 32 ? exerciseRows[index] : undefined
      if (item) {
        const [id, { planned: p, actual: a }] = item
        const lifting = p.sets || a.sets ? ` P sets=${p.sets} reps=${p.reps}; A ${liftSummary(a)}` : ''
        const timed = p.mobility || p.carry || a.mobility.n || a.carry.n || a.unmatched.n
          ? ` sec P mobility=${p.mobility} carry=${p.carry}; A mobility=${sum(a.mobility)} carry=${sum(a.carry)} unmatched=${sum(a.unmatched)} kg=${range(a.timedKg)}` : ''
        const throws = p.throws || a.throws.n ? ` throws P=${p.throws} A=${sum(a.throws)}` : ''
        addRow('exercises', `e${index + 1} ${excerpt(id, 48).text}:${lifting}${timed}${throws}`)
      }
    }
  }
  return result
}
