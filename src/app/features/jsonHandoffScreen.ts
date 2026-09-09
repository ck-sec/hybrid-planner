import type { ReactNode } from 'react'
import type { FormMessage, ImportIssue, JsonImportPreview, JsonPreviewItem, PlanQualitySummary } from './models.ts'
import { actionBar, h, issueList, messageList, previewPanel, screenFrame, sectionCard, textArea } from './ui.ts'

export interface JsonHandoffScreenProps {
  promptContent?: ReactNode
  jsonText: string
  templateJson?: string
  preview: JsonImportPreview | null
  issues: readonly ImportIssue[]
  messages?: readonly FormMessage[]
  canApply?: boolean
  onJsonTextChange: (value: string) => void
  onCopyTemplate: () => void
  onPreviewImport: () => void
  onApplyImport: () => void
  onCopyRevisionRequest?: () => void
  onClear: () => void
}

export function JsonHandoffScreen(props: JsonHandoffScreenProps) {
  return screenFrame(
    'Your AI planning companion.',
    'You and your AI do the thinking. Keep the plan here. Nothing is shared until you copy it.',
    [
      props.promptContent,
      sectionCard('handoff-entry', '03 / Bring your week back', 'Paste the JSON from your chat. You can review every session before adding it to your planner.', [
        textArea({
          id: 'handoff-json',
          label: 'Your AI response (JSON)',
          value: props.jsonText,
          onChange: props.onJsonTextChange,
          placeholder: 'Paste the final JSON response from your AI chat here...',
          rows: 6,
          className: 'json-handoff__field',
        }),
        props.templateJson
          ? h('details', { key: 'template' }, [
              h('summary', { key: 'title' }, 'Example response'),
              h('pre', { key: 'payload' }, props.templateJson),
            ])
          : null,
        actionBar('handoff-buttons', [
          props.templateJson ? h('button', { key: 'copy', type: 'button', className: 'json-handoff__action', onClick: props.onCopyTemplate }, 'Copy example') : null,
          h('button', { key: 'preview', type: 'button', className: 'json-handoff__action is-primary', disabled: !props.jsonText.trim(), onClick: props.onPreviewImport }, 'Preview my week'),
          h('button', { key: 'clear', type: 'button', className: 'json-handoff__action', onClick: props.onClear }, 'Clear'),
        ], 'json-handoff__actions'),
      ], 'json-handoff__card'),
      messageList(props.messages, 'handoff-messages'),
      issueList(props.issues, 'handoff-issues'),
      props.preview?.quality ? qualityCard(props.preview.quality) : null,
      previewPanel(props.preview, 'handoff-preview'),
    ],
    props.preview ? actionBar('handoff-approval', [
      h('p', { key: 'hint', className: 'app-hint' }, props.preview.quality?.proposedFacts.length
        ? 'Approving saves this plan and the proposed athlete context locally.'
        : 'Happy with this plan? Save it locally, then start training.'),
      h('button', {
        key: 'apply', type: 'button', disabled: !props.canApply,
        className: 'json-handoff__action is-primary', onClick: props.onApplyImport,
      }, 'Looks good - take me to my week'),
      props.onCopyRevisionRequest ? h('button', {
        key: 'revise', type: 'button', className: 'json-handoff__action is-secondary',
        onClick: props.onCopyRevisionRequest,
      }, 'Copy revision request for AI') : null,
    ], 'json-handoff__approval') : undefined,
    'json-handoff',
  )
}

const goalStatusLabels = {
  unassessed: 'Not yet assessed',
  conditional: 'Conditional',
  not_supported: 'Not supported',
} as const

function qualityCard(quality: PlanQualitySummary) {
  const goal = quality.goal
  const unknownClubLabel = quality.unknownClubCount === 1 ? 'club session has' : 'club sessions have'
  return sectionCard(
    'handoff-quality',
    'Check your proposed week',
    'Format and time checks — not coaching certification.',
    [
      h('section', { key: 'goal', 'aria-labelledby': 'handoff-goal-title', className: 'json-handoff__goal' }, [
        h('h3', { key: 'title', id: 'handoff-goal-title' }, 'AI goal assessment'),
        h('p', { key: 'status', className: 'json-handoff__goal-status' }, goal ? goalStatusLabels[goal.status] : 'Not provided'),
        goal ? h('p', { key: 'rationale' }, goal.rationale) : null,
        goal ? h('p', { key: 'milestone' }, [
          h('strong', { key: 'label' }, 'Next milestone: '), goal.nextMilestone,
        ]) : null,
        goal?.unknowns.length ? h('p', { key: 'unknowns', className: 'app-hint' }, [
          h('strong', { key: 'label' }, 'Still unknown: '), goal.unknowns.join('; '),
        ]) : null,
      ]),
      h('dl', { key: 'minutes', className: 'json-handoff__quality-metrics' }, [
        h('div', { key: 'proposed' }, [
          h('dt', { key: 'label' }, 'Known weekly minutes'),
          h('dd', { key: 'value' }, `${quality.knownMinutes} min`),
          h('dd', { key: 'club', className: 'json-handoff__metric-note' }, `Includes ${quality.clubMinutes} min of club sessions.`),
          h('dd', { key: 'unknown', className: 'json-handoff__metric-note' }, `${quality.unknownClubCount} ${unknownClubLabel} unknown duration; not included.`),
        ]),
        h('div', { key: 'recent' }, [
          h('dt', { key: 'label' }, `Recent weekly total${quality.baselineComplete ? '' : ' (partial)'}`),
          h('dd', { key: 'value' }, quality.baselineMinutes === undefined ? 'Not available' : `${quality.baselineMinutes} min`),
          !quality.baselineComplete ? h('dd', { key: 'partial', className: 'json-handoff__metric-note' }, 'Partial records; missing time is not zero.') : null,
        ]),
      ]),
      quality.comparisons.length ? h('section', { key: 'comparisons', 'aria-labelledby': 'handoff-comparisons-title' }, [
        h('h3', { key: 'title', id: 'handoff-comparisons-title' }, 'By category'),
        qualityPairs(quality.comparisons, 'comparisons'),
      ]) : null,
      h('details', { key: 'context', className: 'json-handoff__context' }, [
        h('summary', { key: 'title' }, 'Confirm athlete context'),
        h('div', { key: 'content', className: 'json-handoff__context-content' }, quality.proposedFacts.length ? [
          h('p', { key: 'hint', className: 'app-hint' }, 'Check these proposed facts. Approving saves them with your plan locally. Request a revision if anything is wrong.'),
          qualityPairs(quality.proposedFacts, 'facts'),
        ] : [
          h('p', { key: 'empty', className: 'app-hint' }, 'No new athlete context proposed. Approving saves your plan locally.'),
        ]),
      ]),
    ],
    'json-handoff__quality',
  )
}

function qualityPairs(items: readonly JsonPreviewItem[], key: string) {
  return h('dl', { key, className: 'json-handoff__quality-pairs' }, items.map((item, index) =>
    h('div', { key: `${key}-${index}` }, [
      h('dt', { key: 'label' }, item.label),
      h('dd', { key: 'value' }, item.value),
    ]),
  ))
}
