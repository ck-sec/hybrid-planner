/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { Children, createElement, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JsonHandoffScreen, type JsonHandoffScreenProps } from './jsonHandoffScreen.ts'
import type { JsonImportPreview, PlanQualitySummary } from './models.ts'

function quality(overrides: Partial<PlanQualitySummary> = {}): PlanQualitySummary {
  return {
    knownMinutes: 210,
    clubMinutes: 75,
    unknownClubCount: 1,
    baselineMinutes: 120,
    baselineComplete: false,
    comparisons: [
      { label: 'Aerobic', value: 'Planned: 135 min · Recent: 80 min (partial)' },
      { label: 'Strength', value: 'Planned: 75 min · Recent: 40 min' },
    ],
    proposedFacts: [{ label: 'Recent training', value: 'Two easy runs each week' }],
    goal: {
      status: 'conditional',
      rationale: 'Build consistency before increasing the long run.',
      unknowns: ['Comfortable running distance'],
      nextMilestone: 'Complete two consistent weeks.',
    },
    ...overrides,
  }
}

function preview(summary?: PlanQualitySummary): JsonImportPreview {
  return {
    title: 'Your proposed week',
    summary: ['Three sessions'],
    groups: [{ id: 'monday', title: 'Monday', items: [{ label: 'Session', value: 'Easy run' }] }],
    quality: summary,
  }
}

function props(overrides: Partial<JsonHandoffScreenProps> = {}): JsonHandoffScreenProps {
  return {
    jsonText: '{}',
    preview: preview(quality()),
    issues: [],
    canApply: true,
    onJsonTextChange() {},
    onCopyTemplate() {},
    onPreviewImport() {},
    onApplyImport() {},
    onClear() {},
    ...overrides,
  }
}

function render(overrides: Partial<JsonHandoffScreenProps> = {}) {
  return renderToStaticMarkup(createElement(JsonHandoffScreen, props(overrides)))
}

test('quality card distinguishes known time, club time, partial history, and AI assessment', () => {
  const html = render()
  for (const text of [
    'Check your proposed week',
    'Format and time checks — not coaching certification.',
    'AI goal assessment',
    'Conditional',
    'Build consistency before increasing the long run.',
    'Next milestone:',
    'Complete two consistent weeks.',
    'Still unknown:',
    'Comfortable running distance',
    'Known weekly minutes',
    '210 min',
    'Includes 75 min of club sessions.',
    '1 club session has unknown duration; not included.',
    'Recent weekly total (partial)',
    '120 min',
    'Partial records; missing time is not zero.',
    'By category',
    'Planned: 135 min · Recent: 80 min (partial)',
  ]) assert.ok(html.includes(text), `Missing ${text}`)
  assert.match(html, /<h2[^>]*>Your proposed week<\/h2>/)
  assert.match(html, /Easy run/)
})

test('complete zero-minute history is not mistaken for unavailable history', () => {
  const html = render({ preview: preview(quality({ baselineMinutes: 0, baselineComplete: true, unknownClubCount: 0 })) })
  assert.match(html, /Recent weekly total<\/dt><dd>0 min<\/dd>/)
  assert.doesNotMatch(html, /Recent weekly total \(partial\)|Not available|missing time is not zero/)
  assert.match(html, /0 club sessions have unknown duration/)
})

test('missing history and multiple unknown club sessions remain explicit', () => {
  const html = render({ preview: preview(quality({ baselineMinutes: undefined, unknownClubCount: 2 })) })
  assert.match(html, /Recent weekly total \(partial\)<\/dt><dd>Not available<\/dd>/)
  assert.match(html, /2 club sessions have unknown duration; not included/)
})

test('proposed context is collapsed, escaped, and clearly part of local approval', () => {
  const suppliedQuality = {
    ...quality({ proposedFacts: [{ label: 'Equipment', value: '<script>example</script>' }] }),
    rawJSONmetadata: { privatePayload: 'DO_NOT_DISPLAY_METADATA' },
  }
  const html = render({ preview: preview(suppliedQuality) })
  assert.match(html, /<details class="json-handoff__context"><summary>Confirm athlete context<\/summary>/)
  assert.match(html, /Approving saves them with your plan locally/)
  assert.match(html, /Approving saves this plan and the proposed athlete context locally/)
  assert.match(html, /<dt>Equipment<\/dt><dd>&lt;script&gt;example&lt;\/script&gt;<\/dd>/)
  assert.doesNotMatch(html, /DO_NOT_DISPLAY_METADATA|privatePayload|rawJSONmetadata|<script>/)
})

test('optional quality data supports empty context and an absent goal without inventing an assessment', () => {
  const html = render({ preview: preview(quality({ goal: undefined, comparisons: [], proposedFacts: [] })) })
  assert.match(html, /AI goal assessment/)
  assert.match(html, /Not provided/)
  assert.match(html, /No new athlete context proposed. Approving saves your plan locally./)
  assert.doesNotMatch(html, /Next milestone:|By category|Conditional/)
})

for (const [status, label] of [['unassessed', 'Not yet assessed'], ['not_supported', 'Not supported']] as const) {
  test(`goal status ${status} remains an attributed AI assessment`, () => {
    const goal = { status, rationale: 'More context needed.', unknowns: [], nextMilestone: 'Review the next week.' }
    const html = render({ preview: preview(quality({ goal })) })
    assert.match(html, /AI goal assessment/)
    assert.ok(html.includes(label))
    assert.doesNotMatch(html, /Still unknown:/)
  })
}

test('legacy previews retain approval and global issues without requiring quality data', () => {
  const html = render({
    preview: preview(),
    canApply: false,
    issues: [{ id: 'duration', severity: 'warning', message: 'Session time needs review.' }],
  })
  assert.match(html, /Looks good - take me to my week/)
  assert.match(html, /<button[^>]*disabled=""[^>]*>Looks good - take me to my week<\/button>/)
  assert.equal(html.split('Session time needs review.').length - 1, 1)
  assert.doesNotMatch(html, /handoff-quality|Confirm athlete context/)
})

test('revision request is secondary and requires both a callback and a preview', () => {
  const onCopyRevisionRequest = () => {}
  const html = render({ onCopyRevisionRequest, canApply: false })
  assert.match(html, /<button type="button" class="json-handoff__action is-secondary">Copy revision request for AI<\/button>/)
  assert.doesNotMatch(render(), /Copy revision request for AI/)
  const noPreview = render({ preview: null, onCopyRevisionRequest })
  assert.doesNotMatch(noPreview, /Copy revision request for AI|Looks good - take me to my week|handoff-quality/)
})

function findButton(node: ReactNode, label: string): (() => void) | undefined {
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return undefined
  if (node.type === 'button' && node.props.children === label) return node.props.onClick
  for (const child of Children.toArray(node.props.children)) {
    const callback = findButton(child, label)
    if (callback) return callback
  }
  return undefined
}

test('copy revision and approval preserve their separate callbacks', () => {
  let copies = 0
  let approvals = 0
  const tree = JsonHandoffScreen(props({
    onCopyRevisionRequest: () => { copies += 1 },
    onApplyImport: () => { approvals += 1 },
  }))
  const copy = findButton(tree, 'Copy revision request for AI')
  const approve = findButton(tree, 'Looks good - take me to my week')
  assert.ok(copy)
  assert.ok(approve)
  copy()
  assert.equal(copies, 1)
  assert.equal(approvals, 0)
  approve()
  assert.equal(approvals, 1)
})
