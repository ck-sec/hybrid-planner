import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { InputError } from '../engine/legacy/validation.ts'
import type { Baseline } from '../engine/legacy/types.ts'
import BaselineForm from './BaselineForm.tsx'
import WeekView from './WeekView.tsx'
import ModelWorkflow from './ModelWorkflow.tsx'
import BrandMark from './BrandMark.tsx'
import { formatWeek } from './dates.ts'
import { addWeek, planForInput, updateLog } from './state.ts'
import type { SessionLog } from './state.ts'
import { exportBackupText, MAX_BACKUP_BYTES, parseBackupText } from './model-state.ts'
import type { AppState } from './model-state.ts'
import { loadSnapshot, restoreSnapshot, saveSnapshot } from './storage.ts'
import type { StoredSnapshot } from './storage.ts'
import { observeOfflineWorker } from './offline.ts'
import type { OfflineStatus } from './offline.ts'
import './App.css'

type Busy = 'loading' | 'saving' | 'validating' | null

function messageFor(error: unknown): string {
  if (error instanceof InputError) return error.issues.join(' ')
  return error instanceof Error ? error.message : 'Something went wrong. Your saved data has not been changed.'
}

function weekCount(state: AppState): number { return state.legacy.weeks.length + state.modelWeeks.length }
function logCount(state: AppState): number {
  return [...state.legacy.weeks, ...state.modelWeeks].reduce((count, week) => count + Object.keys(week.logs).length, 0)
}

function App() {
  const [snapshot, setSnapshot] = useState<StoredSnapshot | null>(null)
  const [busy, setBusy] = useState<Busy>('loading')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selectedDate, setSelectedDate] = useState('')
  const [formEpoch, setFormEpoch] = useState(0)
  const [pendingImport, setPendingImport] = useState<AppState | null>(null)
  const [offline, setOffline] = useState<OfflineStatus>({ kind: 'checking', message: 'Checking offline app availability…' })
  const operation = useRef(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const importHeading = useRef<HTMLHeadingElement>(null)
  const feedback = useRef<HTMLDivElement>(null)
  const state = snapshot?.state
  const weeks = useMemo(() => [...(state?.legacy.weeks ?? [])].sort((a, b) => b.weekStart.localeCompare(a.weekStart)), [state?.legacy.weeks])
  const selectedWeek = weeks.find(week => week.weekStart === selectedDate) ?? weeks[0]
  const plan = selectedWeek ? planForInput(selectedWeek.input) : null
  const disabled = busy !== null || snapshot === null || pendingImport !== null

  useEffect(() => observeOfflineWorker(
    document.querySelector<HTMLMetaElement>('meta[name="offline-worker"]')?.content ?? null,
    document.baseURI,
    navigator.serviceWorker,
    setOffline,
  ), [])

  useEffect(() => {
    let cancelled = false
    void loadSnapshot().then(loaded => {
      if (cancelled) return
      setSnapshot(loaded)
      setFormEpoch(value => value + 1)
    }).catch(error => {
      if (!cancelled) setError(messageFor(error))
    }).finally(() => {
      if (!cancelled) { setBusy(null); operation.current = false }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (pendingImport) importHeading.current?.focus()
  }, [pendingImport])

  async function reload() {
    if (operation.current) return
    operation.current = true
    setBusy('loading')
    setError('')
    setNotice('')
    try {
      const loaded = await loadSnapshot()
      setSnapshot(loaded)
      setFormEpoch(value => value + 1)
      setPendingImport(null)
      setNotice('Saved data reloaded. Unsaved form edits have been reset.')
    } catch (error) {
      setError(messageFor(error))
    } finally {
      operation.current = false
      setBusy(null)
    }
  }

  async function commit(build: (current: AppState) => AppState, success: string, onSuccess?: () => void): Promise<boolean> {
    if (operation.current || !snapshot) return false
    operation.current = true
    setBusy('saving')
    setError('')
    setNotice('')
    try {
      const next = build(snapshot.state)
      const saved = await saveSnapshot(next, snapshot.revision)
      setSnapshot(saved)
      setNotice(success)
      onSuccess?.()
      return true
    } catch (error) {
      setError(messageFor(error))
      feedback.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
      return false
    } finally {
      operation.current = false
      setBusy(null)
    }
  }

  function generate(weekStart: string, baseline: Baseline) {
    return commit(current => {
      if (current.athlete?.safetyHold) throw new Error('Planning is on hold. Reconfirm a new comfortable baseline in the current model before creating more training.')
      return { ...current, legacy: addWeek(current.legacy, weekStart, baseline) }
    }, 'Archive maintenance week and baseline saved. Existing model weeks and logs are unchanged.', () => {
      setSelectedDate(weekStart)
      document.getElementById('week-heading')?.focus()
    })
  }

  function saveLog(sessionId: string, log: SessionLog) {
    if (!selectedWeek) return Promise.resolve(false)
    return commit(current => ({ ...current, legacy: updateLog(current.legacy, selectedWeek.weekStart, sessionId, log) }), 'Archive session log saved. Your plan and other logs are unchanged.')
  }

  async function chooseImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || operation.current) return
    operation.current = true
    setBusy('validating')
    setError('')
    setNotice('')
    setPendingImport(null)
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('This file is too large. Choose a backup smaller than 5 MB.')
      const imported = parseBackupText(await file.text())
      setPendingImport(imported)
    } catch (error) {
      setError(`Import rejected. ${messageFor(error)} Your existing data is unchanged.`)
    } finally {
      operation.current = false
      setBusy(null)
    }
  }

  async function replaceWithImport() {
    if (!pendingImport || operation.current) return
    const finishImport = () => {
      setPendingImport(null)
      setSelectedDate('')
      setFormEpoch(value => value + 1)
    }
    if (snapshot) {
      await commit(() => pendingImport, 'Backup imported and saved on this browser.', finishImport)
      return
    }
    operation.current = true
    setBusy('saving')
    setError('')
    setNotice('')
    try {
      const restored = await restoreSnapshot(pendingImport)
      setSnapshot(restored)
      setNotice('Backup restored and saved on this browser.')
      finishImport()
    } catch (error) {
      setError(messageFor(error))
    } finally {
      operation.current = false
      setBusy(null)
    }
  }

  function exportData() {
    if (!snapshot || operation.current) return
    setError('')
    setNotice('')
    try {
      const blob = new Blob([exportBackupText(snapshot.state)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'hybrid-planner-backup.json'
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('Backup download requested. Check that the file finished downloading and keep it somewhere safe.')
    } catch (error) {
      setError(messageFor(error))
    }
  }

  return (
    <>
      <a className="skip-link" href="#main">Skip to planner</a>
      <header className="site-header">
        <a className="brand" href="#main" aria-label="Hybrid Coach home"><BrandMark className="brand-mark" /><span>Hybrid<span className="brand-suffix">Coach</span></span></a>
        <nav aria-label="Main navigation"><a href="#model">Your block</a><a href="#your-data">Your data</a></nav>
        <span className="local-label"><span aria-hidden="true">◌</span> Local by design</span>
      </header>

      <main id="main" className="app-shell">
        <section className="intro" aria-labelledby="intro-heading">
          <div><p className="eyebrow">Running + lifting. Room to recover.</p><h1 id="intro-heading">A steady week.<br /><span>Not a harder one.</span></h1><p className="intro-copy">A stable block. One considered week at a time.<br className="desktop-break" /> Your established training, with room for rest.</p></div>
          <div className="intro-note"><span className="note-line" aria-hidden="true" /><p>Maintenance, not momentum.</p><span>No automatic increases.<br />No catching up. No pressure.</span></div>
        </section>

        <div ref={feedback} className="feedback" aria-live="polite" aria-atomic="true">
          {busy && <p className="notice notice-busy" role="status"><span className="busy-dot" aria-hidden="true" />{busy === 'loading' ? 'Loading saved data…' : busy === 'saving' ? 'Saving to this browser. Waiting for storage confirmation…' : 'Validating backup, logs and neighboring weeks…'}</p>}
          {!busy && notice && <p className="notice notice-success" role="status">{notice}</p>}
        </div>
        {error && <div className="notice notice-error" role="alert"><strong>{snapshot ? 'No saved data was changed.' : 'Saved data could not be loaded.'}</strong><p>{error}</p><p className="field-hint">{snapshot ? 'The page still shows the last successfully loaded or saved data.' : 'Planning is unavailable until storage loads successfully. Retry loading, or explicitly restore a validated backup under Your data. Corrupted data is never replaced automatically.'}</p><button className="text-button" type="button" disabled={busy !== null} onClick={() => { void reload() }}>Reload saved data</button></div>}

        {state && <ModelWorkflow key={formEpoch} state={state} disabled={disabled} commit={commit} />}
        {!state && <section className="panel storage-placeholder"><h2>Your saved data comes first.</h2><p>The planner is available once browser storage loads. No migration, reset or overwrite happens automatically.</p></section>}

        <details className="archive-disclosure" id="archive">
          <summary>Version 0.1 archive / maintenance · {weeks.length} saved weeks</summary>
          <p className="model-intro">Original baseline maintenance tool and logs. Schema 1 inputs, Monday-based days, plans and notes are preserved without reinterpreting them as model observations. Loading upgrades only in memory; a storage write requires an explicit save or import.</p>
          <div className="workspace">
          <div className="week-column">
            <section className="week-section" aria-labelledby="week-heading" aria-busy={busy === 'loading'}>
              <div className="week-heading-row">
                <div><p className="eyebrow">The week, simply</p><h2 id="week-heading" tabIndex={-1}>Your training, with space.</h2></div>
                {weeks.length > 0 && <div className="history-select"><label htmlFor="week-history">Saved weeks · {weeks.length}</label><select id="week-history" value={selectedWeek?.weekStart ?? ''} onChange={event => setSelectedDate(event.target.value)} disabled={disabled}>{weeks.map(week => <option key={week.weekStart} value={week.weekStart}>{formatWeek(week.weekStart)}</option>)}</select></div>}
              </div>
              {selectedWeek && plan ? <WeekView key={`${formEpoch}-${selectedWeek.weekStart}`} week={selectedWeek} plan={plan} disabled={disabled} onSaveLog={saveLog} /> : <div className="empty-week">
                <div className="empty-calendar" aria-hidden="true">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => <span key={index}>{day}<i /></span>)}</div>
                <h3>{busy === 'loading' ? 'Finding your saved weeks…' : snapshot ? 'Your week starts with your baseline.' : 'Your saved data comes first.'}</h3>
                <p>{snapshot ? 'Tell us what you already do comfortably. We’ll arrange it around your available days, without adding more.' : 'We need working browser storage before creating a plan. Nothing is saved or replaced during startup.'}</p>
                {snapshot && <a className="button button-secondary" href="#baseline">Set your baseline <span aria-hidden="true">↗</span></a>}
                <span className="empty-footnote">No example loads. No invented starting point.</span>
              </div>}
            </section>

            <section className="rules-panel" aria-labelledby="rules-heading">
              <div className="panel-heading"><div><p className="eyebrow">The guardrails</p><h2 id="rules-heading">Less guesswork. Clear limits.</h2></div><span aria-hidden="true" className="rules-symbol">↳</span></div>
              <ol className="rules-list">
                <li><span>01</span><div><h3>Arrange. Don’t increase.</h3><p>Easy running stays within your established minutes. Lifts repeat your exact full-body template, including the loads you enter.</p></div></li>
                <li><span>02</span><div><h3>Protect the spaces between.</h3><p>One session per day. At least one rest day. Never full-body lifts on adjacent days, including Sunday–Monday in a repeating week and across saved neighbors. This is a calendar-day gap, not a guarantee of 48 hours between sessions.</p></div></li>
                <li><span>03</span><div><h3>Leave out what doesn’t fit.</h3><p>Unscheduled work is listed openly. It is never redistributed. A skipped session stays skipped; logs do not change the plan.</p></div></li>
              </ol>
              <div className="scope-note"><strong>For an established baseline only.</strong><p>This is not injury rehabilitation or a return-after-illness plan. If you are unwell, in pain, returning from a break, or unsure about your baseline, do not use this to choose training loads. Rest is allowed; seek appropriate professional guidance.</p></div>
            </section>

          </div>
          <aside className="baseline-column" aria-label="Archived baseline maintenance">
            {snapshot ? <BaselineForm key={formEpoch} baseline={state?.legacy.baseline ?? null} savedDates={weeks.map(week => week.weekStart)} disabled={disabled} onGenerate={generate} /> : <section className="panel storage-placeholder"><h2>Archive baseline setup</h2><p>Available once saved data has loaded.</p></section>}
          </aside>
          </div>
        </details>

            <section className="panel data-panel" id="your-data" aria-labelledby="data-heading">
              <div className="panel-heading"><div><p className="eyebrow">No account. No server.</p><h2 id="data-heading">Yours, on this browser.</h2></div><span className="small-tag">JSON backup</span></div>
              <p>Your baseline, saved weeks and logs stay in this browser’s IndexedDB, on this site’s origin. They are not synced or encrypted by this app. Anyone with access to this browser profile may read them.</p>
              <p className="muted">Clearing site data, switching browsers or addresses, private browsing, or browser storage eviction can remove access to your history. <strong>Export backups regularly.</strong> A downloaded backup is plain text, not encryption.</p>
              <div className={`offline-state${offline.kind === 'failed' ? ' offline-failed' : ''}`} role="status" aria-live="polite">
                <strong>Offline app</strong>
                <p>{offline.message}</p>
                <p className="field-hint">The app cache can also be evicted. Offline access does not replace backups of your baseline and logs.</p>
              </div>
              <div className="button-row data-actions">
                <button className="button button-primary" type="button" disabled={busy !== null || !snapshot} onClick={exportData}>Export backup <span aria-hidden="true">↓</span></button>
                <button className="button button-secondary" type="button" disabled={busy !== null || pendingImport !== null} onClick={() => fileInput.current?.click()}>Import backup <span aria-hidden="true">↑</span></button>
                <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Choose JSON backup" onChange={event => { void chooseImport(event) }} />
              </div>
              <p className="field-hint">Up to 5 MB / 520 total weeks. Schema 1 and 2 backups are validated before replacement, including versions, recomputed plans, logs and neighboring-week safety. Existing historical planning inputs are never silently rewritten.</p>
              {pendingImport && <section className="import-confirm" aria-labelledby="import-heading">
                <h3 id="import-heading" ref={importHeading} tabIndex={-1}>Replace all local data?</h3>
                <p>This validated backup contains <strong>{weekCount(pendingImport)} saved weeks</strong>, <strong>{pendingImport.blockHistory.length} model blocks</strong> and <strong>{logCount(pendingImport)} session logs</strong>.</p>
                {state ? <p>Import will replace your current baseline, all {weekCount(state)} saved weeks, all blocks and every local log. It will not merge them. Export your current data first if you want to keep it.</p>
                  : <p>Your current local data could not be loaded, so its contents are unknown and cannot be exported here. Restoring this backup will replace all unreadable local data. Anything absent from the backup will be lost. This cannot be undone. If another tab has restored readable data, this replacement will be refused.</p>}
                <div className="button-row"><button className="button button-danger" type="button" disabled={busy !== null} onClick={() => { void replaceWithImport() }}>Replace all local data</button><button className="button button-secondary" type="button" disabled={busy !== null} onClick={() => { setPendingImport(null); setNotice('Import cancelled. Your data is unchanged.') }}>Cancel import</button></div>
              </section>}
              <details className="storage-details"><summary>Working in more than one tab?</summary><p>A revision check prevents one tab from silently overwriting another. If a save conflicts, export or copy any unsaved notes, then reload the saved data. Reloading resets unsaved form edits.</p><button className="text-button" type="button" disabled={disabled} onClick={() => { void reload() }}>Reload saved data</button></details>
            </section>
        <footer className="site-footer"><span>Hybrid Coach <span className="muted">/ 0.2.0</span></span><p>Consistent does not mean constant.</p><span className="muted">Deterministic. Local. Yours.</span></footer>
      </main>
    </>
  )
}

export default App
