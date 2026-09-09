import type { FormMessage, ImportIssue, JsonImportPreview } from './models.ts'
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
      previewPanel(props.preview, 'handoff-preview'),
    ],
    props.preview ? actionBar('handoff-approval', [
      h('p', { key: 'hint', className: 'app-hint' }, 'Happy with this plan? Save it, then start training.'),
      h('button', {
        key: 'apply', type: 'button', disabled: !props.canApply,
        className: 'json-handoff__action is-primary', onClick: props.onApplyImport,
      }, 'Looks good - take me to my week'),
    ], 'json-handoff__approval') : undefined,
    'json-handoff',
  )
}
import type { ReactNode } from 'react'
