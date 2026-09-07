import { useMemo, useRef, useState } from 'react'
import {
  MAX_GARMIN_CSV_BYTES, mergeTrainingHistory, parseGarminCsv, parseTrainingHistory,
  runPaceMinPerKm, summarizeTrainingHistory,
} from './garmin-import.ts'
import type { GarminActivityType, GarminImportResult, GarminUnits, TrainingHistory, TrainingHistorySummary } from './garmin-import.ts'

export interface TrainingHistoryImportProps {
  value?: TrainingHistory
  asOfDate: string
  onChange: (history: TrainingHistory | undefined) => void
}

const LABELS: Record<GarminActivityType, string> = {
  running: 'Running', treadmill: 'Treadmill running', lifting: 'Lifting',
  cycling: 'Cycling', indoor_cycling: 'Indoor cycling', walking: 'Walking',
  hiking: 'Hiking', yoga: 'Yoga', pilates: 'Pilates', other: 'Other',
}
const PAGE_SIZE = 50
const CONFIRMATION = 'These records represent the period shown; any missing training still needs discussion'
const message = (error: unknown) => error instanceof Error ? error.message : 'The training history could not be processed. Review the CSV and try again.'
const minutes = (value: number) => `${Number(value.toFixed(2))} min`

function HistorySummary({ summary }: { summary: TrainingHistorySummary }) {
  return <div className="cf-stack">
    <p><strong>Recorded period: {summary.dateRange.start} through {summary.dateRange.end}</strong><br />
      Garmin CSV · {summary.units} source units · {summary.count} activities · {minutes(summary.durationMin)} timer time
    </p>
    <ul>{Object.entries(summary.byType).map(([type, totals]) =>
      <li key={type}>{LABELS[type as GarminActivityType]}: {totals.count} activities, {minutes(totals.durationMin)}</li>)}</ul>
    <details className="cf-details"><summary>Recorded weeks</summary>
      <ul>{summary.weeks.map(week => <li key={week.weekStart}>
        {week.weekStart} through {week.weekEnd}: {week.count} activities, {minutes(week.durationMin)}
        {week.partialPeriod && ' — boundary / partial period'}
      </li>)}</ul>
      <p>Only weeks containing imported records are listed. Missing days and weeks remain unknown, not zero training.</p>
    </details>
  </div>
}

export default function TrainingHistoryImport({ value, asOfDate, onChange }: TrainingHistoryImportProps) {
  const [units, setUnits] = useState<GarminUnits | ''>('')
  const [imported, setImported] = useState<GarminImportResult>()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [reviewed, setReviewed] = useState<string>()
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)
  const [issue, setIssue] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const readVersion = useRef(0)

  const preview = useMemo(() => {
    try {
      const saved = value === undefined ? undefined : parseTrainingHistory(value)
      let history = saved
      let existingDuplicateCount = 0
      if (imported && units) {
        const activities = imported.activities.filter((_, index) => selected.has(index))
        if (!activities.length) {
          return { issue: 'Select at least one activity to save. Existing history has not changed.' }
        }
        history = mergeTrainingHistory(saved, { ...imported, activities }, units)
        existingDuplicateCount = (saved?.activities.length ?? 0) + activities.length - history.activities.length
      }
      return {
        history, existingDuplicateCount,
        summary: history ? summarizeTrainingHistory(history, asOfDate) : undefined,
      }
    } catch (error) { return { issue: message(error) } }
  }, [value, asOfDate, imported, units, selected])

  const reviewKey = preview.history ? JSON.stringify([asOfDate, preview.history]) : ''
  const isReviewed = !!reviewKey && reviewed === reviewKey
  const canSave = !!preview.history && (!!imported || !preview.history.confirmed) && !preview.issue && !busy
  const hasPendingHistory = !!imported || !!(preview.history && !preview.history.confirmed)
  const warnings = [...new Set([...(imported?.warnings ?? []), ...(preview.summary?.warnings ?? [])])]

  function clearPreview() {
    readVersion.current++
    setImported(undefined)
    setSelected(new Set())
    setReviewed(undefined)
    setPage(0)
    setBusy(false)
    setIssue('')
    if (fileInput.current) fileInput.current.value = ''
  }

  async function readFile(file: File | undefined) {
    const version = ++readVersion.current
    setImported(undefined)
    setSelected(new Set())
    setReviewed(undefined)
    setPage(0)
    setIssue('')
    if (!file) { setBusy(false); return }
    setBusy(true)
    try {
      if (!units) throw new Error('Choose the units used in the Garmin export before selecting a file.')
      if (!/\.csv$/i.test(file.name)) throw new Error('Choose the Garmin activities CSV export, not an XLS spreadsheet.')
      if (file.size > MAX_GARMIN_CSV_BYTES) throw new Error('The CSV is larger than 5 MiB. Export a smaller period.')
      const bytes = await file.arrayBuffer()
      if (version !== readVersion.current) return
      const result = parseGarminCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes), units)
      setImported(result)
      setSelected(new Set(result.activities.map((_, index) => index)))
    } catch (error) {
      if (version === readVersion.current) setIssue(message(error))
    } finally {
      if (version === readVersion.current) {
        setBusy(false)
        if (fileInput.current) fileInput.current.value = ''
      }
    }
  }

  return <section className="cf-card cf-stack" aria-label="Import training history">
    <h3>Import training history</h3>
    <p className="cf-small">Optional Garmin CSV, read on this device—not uploaded. Titles and locations are removed.
      It does not set your baseline or mark workouts complete.</p>
    <details className="cf-details"><summary>CSV help</summary>
      <p className="cf-small">
        In <a href="https://connect.garmin.com/modern/activities" target="_blank" rel="noreferrer">Garmin Connect activities</a>,
        export the activities list as CSV (not XLS). <a href="https://support.garmin.com/en-US/?faq=W1TvTPW8JZ6LfJSfK512Q8" target="_blank" rel="noreferrer">Garmin export instructions</a>.
        {' '}German and English exports are supported. Limits: 5 MiB, 5,000 activity rows.
      </p>
      <p className="cf-small">Stored distances are always kilometres. A lone dot or comma is read as a decimal separator, not a thousands separator.</p>
    </details>
    <label className="cf-field">CSV export units
      <select value={units} onChange={event => {
        const next = event.target.value
        clearPreview()
        setUnits(next === 'metric' || next === 'imperial' ? next : '')
      }}>
        <option value="">Choose export units first</option>
        <option value="metric">Metric — distance in kilometres</option>
        <option value="imperial">Imperial — distance in miles</option>
      </select>
    </label>
    <p className="cf-small">Use the export setting, not your preferred display units.
      {value && ' New records must use the same export units as saved history.'}</p>
    <label className="cf-field">Garmin activities CSV
      <input ref={fileInput} type="file" accept=".csv,text/csv" disabled={!units}
        onChange={event => { void readFile(event.target.files?.[0]) }} />
    </label>
    {busy && <p role="status">Reading CSV locally…</p>}
    {issue && <p role="alert" className="cf-error">{issue}</p>}

    {imported && <div className="cf-stack">
      <p role="status">CSV source period: {imported.activities[0].localTimestamp.slice(0, 10)} through{' '}
        {imported.activities[imported.activities.length - 1].localTimestamp.slice(0, 10)}.
        {' '}{imported.activities.length} unique activities; {selected.size} selected.
        {' '}{imported.activities.length - selected.size} intentionally excluded.
      </p>
      <p>Exact duplicates skipped: {imported.duplicateCount + (preview.existingDuplicateCount ?? 0)}
        {' '}({imported.duplicateCount} within the CSV; {preview.existingDuplicateCount ?? 0} already saved).
        {preview.issue && ' Saved-history duplicates cannot be fully checked until the review issue is resolved.'}
      </p>
      <details className="cf-details"><summary>Review and select individual records</summary>
        <p>Timer duration is the main recorded duration. Moving and elapsed times are separate.
          Timer-based run pace is calculated from duration and distance, never from the exported Pace column, which can contain cycling speed.
          Missing values remain unknown.</p>
        <div className="cf-inline">
          <button type="button" className="cf-text-button" onClick={() => {
            setSelected(new Set(imported.activities.map((_, index) => index))); setReviewed(undefined)
          }}>Select all records</button>
          <button type="button" className="cf-text-button" onClick={() => {
            setSelected(new Set()); setReviewed(undefined)
          }}>Deselect all records</button>
        </div>
        {imported.activities.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((activity, offset) => {
          const index = page * PAGE_SIZE + offset
          const pace = runPaceMinPerKm(activity)
          return <label className="cf-check" key={`${activity.type}:${activity.localTimestamp}`}>
            <input type="checkbox" checked={selected.has(index)} onChange={event => {
              const next = new Set(selected)
              if (event.target.checked) next.add(index)
              else next.delete(index)
              setSelected(next); setReviewed(undefined)
            }} />
            <span><strong>{activity.localTimestamp.replace('T', ' ')} · {LABELS[activity.type]}</strong><br />
              Timer {minutes(activity.durationMin)} · Distance {activity.distanceKm === undefined ? 'unknown' : `${Number(activity.distanceKm.toFixed(3))} km`}
              {' '}· Average HR {activity.averageHr === undefined ? 'unknown' : `${activity.averageHr} bpm`}<br />
              Moving {activity.movingDurationMin === undefined ? 'unknown' : minutes(activity.movingDurationMin)}
              {' '}· Elapsed {activity.elapsedDurationMin === undefined ? 'unknown' : minutes(activity.elapsedDurationMin)}
              {pace !== undefined && <> · Timer-based run pace {Number(pace.toFixed(2))} min/km</>}
            </span>
          </label>
        })}
        {imported.activities.length > PAGE_SIZE && <div className="cf-inline">
          <button type="button" className="cf-text-button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous records</button>
          <span>Page {page + 1} of {Math.ceil(imported.activities.length / PAGE_SIZE)}</span>
          <button type="button" className="cf-text-button" disabled={(page + 1) * PAGE_SIZE >= imported.activities.length} onClick={() => setPage(page + 1)}>Next records</button>
        </div>}
      </details>
      <button type="button" className="cf-text-button" onClick={clearPreview}>Discard preview</button>
    </div>}

    {preview.issue && <p role="alert" className="cf-error">{preview.issue}</p>}
    {preview.summary && <HistorySummary summary={preview.summary} />}
    {warnings.length > 0 && <div className="cf-small" aria-label="Training history warnings">
      <strong>Review notes</strong><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
    </div>}
    {canSave && <label className="cf-check">
      <input type="checkbox" required checked={isReviewed} onChange={event => setReviewed(event.target.checked ? reviewKey : undefined)} />
      <span>{CONFIRMATION}</span>
    </label>}
    {!imported && preview.history?.confirmed && <p className="cf-small">Saved and reviewed for the period shown. Missing training remains unknown.</p>}
    {(hasPendingHistory || value !== undefined) && <div className="cf-inline">
      {hasPendingHistory && <button type="button" className="cf-button cf-secondary" disabled={!canSave || !isReviewed} onClick={() => {
        if (!canSave || !isReviewed || !preview.history) return
        try {
          onChange(parseTrainingHistory({ ...preview.history, confirmed: true }))
          clearPreview()
        } catch (error) { setIssue(message(error)) }
      }}>Save training history</button>}
      {value !== undefined && <button type="button" className="cf-text-button" onClick={() => {
        try { onChange(undefined); clearPreview() } catch (error) { setIssue(message(error)) }
      }}>Remove imported history</button>}
    </div>}
  </section>
}
