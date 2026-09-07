import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { adaptCampaign, buildCampaign, completeCampaignSession, confirmSetupEquipment, exampleCampaign, nextCampaignWeek } from './model.ts'
import { proposalForSessions } from './authored-calendar.ts'

test('workout and week screens disclose optional actions without changing training', async t => {
  const directory = new URL('../', import.meta.url).href
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      if (!url.startsWith(directory)) return nextLoad(url, context)
      if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: '' }
      if (!url.endsWith('.tsx')) return nextLoad(url, context)
      return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      }).outputText }
    },
  })
  try {
    const { CalendarHome, PlanOverview, Workout, WorkoutFeedbackForm } = await import('./CampaignApp.tsx')
    const { default: ProgrammingRevision } = await import('./ProgrammingRevision.tsx')
    const initial = confirmSetupEquipment(exampleCampaign('2026-09-07'), ['dumbbell', 'floor_space', 'bench'])
    const state = buildCampaign({ ...initial, draft: { ...initial.draft, confirmed: true } })
    const before = structuredClone(state)
    const noChange = () => assert.fail('Rendering cannot change training or open an action')
    const actions = { update: noChange, onSession: noChange, onAction: noChange, onAI: noChange, onNext: noChange }

    await t.test('calendar has one optional AI action and only explains moving when it is possible', () => {
      const render = (candidate = state) => renderToStaticMarkup(createElement(CalendarHome, { state: candidate, ...actions }))
      const html = render()
      assert.equal(html.match(/Ask AI \(optional\)/g)?.length, 1)
      assert.match(html, /aria-label="Review next week"/)
      assert.match(html, /Session options → Move/)
      assert.match(html, /Rest day/)
      assert.doesNotMatch(html, /No catch-up needed|Room to adapt|cf-ai-teaser|The plan serves you/)
      const archived = { ...nextCampaignWeek(state), selectedWeek: 0 }
      const archive = render(archived)
      assert.match(archive, /Past week · read-only/)
      assert.match(archive, /aria-label="Next saved week"/)
      assert.doesNotMatch(archive, /cf-calendar-help|cf-drag-handle|draggable="true"/)
      const held = structuredClone(state)
      held.weeks[0].input.athlete.safetyHold = { reason: 'pain', since: held.weeks[0].plan.weekStart }
      assert.doesNotMatch(render(held), /cf-calendar-help|cf-drag-handle|draggable="true"/)
      const recorded = structuredClone(state)
      for (const session of recorded.weeks[0].plan.sessions) recorded.weeks[0].logs[session.id] = {
        sessionId: session.id, status: 'completed', painFlag: false, notes: '',
      }
      assert.doesNotMatch(render(recorded), /cf-calendar-help|cf-drag-handle|draggable="true"/)
    })

    await t.test('session options start collapsed; archived workouts keep notes but no editing or logging prompts', () => {
      const session = state.weeks[0].plan.sessions.find(item => item.kind === 'workout' && item.discipline === 'strength')!
      assert.ok(session)
      const render = (candidate = state) => renderToStaticMarkup(createElement(Workout, {
        state: candidate, session, ...actions, onBack: noChange,
      }))
      const html = render()
      assert.match(html, /<details class="cf-details"><summary>Session options<\/summary><div class="cf-session-actions">/)
      assert.match(html, /aria-expanded="false"[^>]*>[^]*?Remove from week/)
      assert.match(html, />Finish early<\/button>/)
      assert.match(html, />Finish workout /)
      assert.equal(html.match(/Suggestions and filled rows stay unlogged until you press Log/g)?.length, 1)
      assert.equal(html.match(/Ask AI \(optional\)/g)?.length, 1)
      const archive = render({ ...nextCampaignWeek(state), selectedWeek: 0 })
      assert.match(archive, /Past week · read-only/)
      assert.match(archive, /Exercise notes/)
      assert.match(archive, /All notes/)
      assert.doesNotMatch(archive, /Session options|>Finish early|>Finish workout|Suggestions and filled rows|Last logged:/)
    })

    await t.test('finish confirmation retains separate outcomes and cancellation without duplicate initiating controls', () => {
      const session = state.weeks[0].plan.sessions.find(item => item.discipline === 'run')!
      for (const outcome of ['finished', 'finished_early'] as const) {
        const html = renderToStaticMarkup(createElement(WorkoutFeedbackForm, {
          session, outcome, onFinish: noChange, onCancel: noChange,
        }))
        assert.match(html, outcome === 'finished' ? /Confirm completion/ : /Confirm stopped early/)
        assert.match(html, /Keep logging/)
        assert.match(html, /Actual duration \(minutes\)<input[^>]*required=""[^>]*value=""/)
        assert.match(html, /Whole-session effort \(0–10\)<input[^>]*required=""[^>]*value=""/)
        assert.match(html, /I experienced pain during or after this workout/)
        assert.doesNotMatch(html, />Finish early<\/button>/)
      }
      const source = readFileSync(new URL('./CampaignApp.tsx', import.meta.url), 'utf8')
      assert.match(source, /\{!readOnly \? !finishOutcome && <div className="cf-inline">/)
      assert.match(source, /\{finishOutcome && !readOnly && <WorkoutFeedbackForm session=\{session\} outcome=\{finishOutcome\} onCancel=\{\(\) => setFinishOutcome\(null\)\}/)
      assert.doesNotMatch(source, /<WorkoutFeedbackForm[^>]*\bkey=/)
    })

    await t.test('plan repeats no phase disclaimers and revision still requires preview before approval', () => {
      const plan = renderToStaticMarkup(createElement(PlanOverview, { state, ...actions }))
      assert.equal(plan.match(/No automatic training increases/g)?.length, 1)
      assert.match(plan, /Review next week/)
      assert.equal(plan.match(/Ask AI \(optional\)/g)?.length, 1)
      for (const phase of state.weeks[0].input.block.phases) {
        assert.ok(plan.includes(`<h3>${phase.kind.charAt(0).toUpperCase() + phase.kind.slice(1)}</h3>`))
      }
      const revision = renderToStaticMarkup(createElement(ProgrammingRevision, {
        state, onConnect: noChange, onApply: noChange, onClose: noChange,
      }))
      assert.match(revision, /<h2>Review next week<\/h2>/)
      assert.match(revision, /Preview next week/)
      assert.match(revision, /baseline and health holds carry forward/)
      assert.match(revision, /Unlogged work stays unknown/)
      assert.doesNotMatch(revision, /Approve next week/)
      const source = readFileSync(new URL('./ProgrammingRevision.tsx', import.meta.url), 'utf8')
      assert.match(source, /\{preview && <div/)
      assert.match(source, /Approving makes the previous week read-only/)
      assert.match(source, /if \(onApply\(preview\)\) onClose\(\) \}\}>Approve next week/)
    })
    await t.test('advisory weeks display health reports without a hidden calendar or actual-logging hold', () => {
      const pendingWeek = proposalForSessions(state.weeks[0]!.plan.weekStart, state.weeks[0]!.plan.sessions)
      let advisory = buildCampaign({ ...initial, draft: { ...initial.draft, confirmed: true }, pendingWeek })
      const recorded = advisory.weeks[0]!.plan.sessions[0]!
      advisory = completeCampaignSession(advisory, recorded.id, recorded.durationMin, 5, true)
      const session = advisory.weeks[0]!.plan.sessions.find(item => item.id !== recorded.id)!
      const calendar = renderToStaticMarkup(createElement(CalendarHome, { state: advisory, ...actions }))
      assert.match(calendar, /Pain or a health concern remains recorded/)
      assert.match(calendar, /Plan approval is not medical clearance/)
      assert.match(calendar, /cf-drag-handle/)
      const workout = renderToStaticMarkup(createElement(Workout, { state: advisory, session, ...actions, onBack: noChange }))
      assert.match(workout, /Logging actual work does not clear it/)
      assert.match(workout, />Finish workout/)
      assert.doesNotMatch(workout, /has paused this workout/)
      const plan = renderToStaticMarkup(createElement(PlanOverview, { state: advisory, ...actions }))
      assert.match(plan, /You and AI decide the training/)
      assert.doesNotMatch(plan, /Pain blocks further planning/)
      const revision = renderToStaticMarkup(createElement(ProgrammingRevision, {
        state: advisory, onConnect: noChange, onApply: noChange, onClose: noChange,
      }))
      assert.match(revision, /No new AI reply needed/)
      assert.match(revision, /originally approved weekly pattern, not the built-in plan/)
      assert.match(revision, /Preview next week/)
      assert.doesNotMatch(revision, />Approve next week</)
      const skipped = adaptCampaign(advisory, { type: 'skip', sessionId: session.id, reason: 'too_tired' })
      const removed = renderToStaticMarkup(createElement(Workout, { state: skipped, session, ...actions, onBack: noChange }))
      assert.match(removed, /Other prescriptions are unchanged/)
      assert.doesNotMatch(removed, /remaining plan was adapted conservatively/)
    })
    assert.deepEqual(state, before)
  } finally { hooks.deregister() }
})
