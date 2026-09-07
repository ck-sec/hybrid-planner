import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { buildCampaign, exampleCampaign, logCampaignBlockAmount, logCampaignBlockSet, normalizeRecommendedDraft } from './model.ts'
import { enableTemplateProgramming, selectProgramExercises } from './programming.ts'
import { equipmentForResources } from './equipment.ts'

test('exercise guidance works offline and distinguishes explanation from prescribed execution', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('Exercise guidance must be available offline'))
  const directory = new URL('./', import.meta.url).href
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
    const { default: ExerciseGuide } = await import('./ExerciseGuide.tsx')
    const html = renderToStaticMarkup(createElement(ExerciseGuide, {
      name: 'A supported squat variant',
      guide: {
        description: 'Follow the supported movement and its displayed prescription.',
        focus: ['Maintain a balanced stance.', 'Use a comfortable range.'],
        why: 'A lower-body strength slot in this session.',
        execution: 'Controlled',
      },
    }))
    assert.match(html, /<details/)
    assert.match(html, /<summary aria-label="A supported squat variant: exercise guide">Exercise guide<\/summary>/)
    assert.match(html, /Description/)
    assert.match(html, /What to focus on/)
    assert.match(html, /Why this exercise/)
    assert.match(html, /Execution/)
    assert.match(html, /different execution style needs a supported variant/)
    assert.doesNotMatch(html, /<input|<textarea|type="password"/)
    await t.test('typed workout cards retain optional carry weight and their exact execution guidance', async () => {
      const { default: TemplateWorkout } = await import('./TemplateWorkout.tsx')
      const sample = exampleCampaign('2026-09-07')
      const resources = ['kettlebell', 'floor_space', 'carry_space'] as const
      const draft = selectProgramExercises(enableTemplateProgramming({
        ...sample.draft, resources: [...resources], equipment: equipmentForResources(resources),
      }), ['kettlebell-goblet-squat', 'kettlebell-deadlift', 'kettlebell-floor-press', 'kettlebell-suitcase-carry'])
      let state = buildCampaign({ ...sample, sample: false, draft: normalizeRecommendedDraft({ ...draft, confirmed: true }) })
      const session = state.weeks[0]!.plan.sessions.find(item => item.kind === 'workout' && item.blocks.some(block => block.unit === 'seconds'))
      assert.ok(session?.kind === 'workout')
      const index = session.blocks.findIndex(block => block.unit === 'seconds')
      state = logCampaignBlockAmount(state, session.id, index, '20', '12')
      const render = (readOnly: boolean) => renderToStaticMarkup(createElement(TemplateWorkout, {
        state, session, readOnly, update: () => assert.fail('Rendering must not mutate training'),
      }))
      const editable = render(false)
      const weightInput = editable.match(/Actual total carried weight \(kg, optional\)<input([^>]*)>/)
      assert.ok(weightInput)
      assert.doesNotMatch(weightInput[1]!, /required|disabled/)
      assert.match(weightInput[1]!, /value="12"/)
      assert.match(editable, /Actual total seconds across all bouts/)
      assert.match(editable, /Actual total seconds across all bouts<input[^>]*value="20"/)
      assert.match(editable, /What to focus on/)
      const archived = render(true)
      assert.match(archived, /Controlled carry/)
      assert.match(archived, /Actual total carried weight \(kg, optional\)<input[^>]*disabled/)
      assert.doesNotMatch(archived, /<input(?![^>]*disabled)[^>]*type="number"/)
      const repsIndex = session.blocks.findIndex(block => block.unit === 'reps')
      const reps = session.blocks[repsIndex]
      assert.ok(reps.unit === 'reps')
      for (let setIndex = 0; setIndex <= reps.sets; setIndex++) {
        state = logCampaignBlockSet(state, session.id, repsIndex, setIndex, {
          weight: '12', reps: String(reps.reps + 1), effort: '6',
        })
      }
      const overruns = render(false)
      assert.match(overruns, /Record extra actual set/)
      assert.match(overruns, /extra set already performed, not prescribed/)
      assert.match(overruns, /role="status"/)
      const exercise = state.weeks[0]!.input.library.exercises.find(item => item.id === reps.exerciseId)!
      assert.ok(overruns.includes(`${exercise.name} set ${reps.sets + 1} kilograms`))
    })
  } finally { hooks.deregister() }
})
