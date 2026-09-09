import type { FormMessage, ImportIssue, JsonImportPreview, ResetAction } from './models.ts'
import { actionBar, h, issueList, messageList, previewPanel, screenFrame, sectionCard, textArea } from './ui.ts'

export interface SettingsBackupScreenProps {
  profileContent?: ReactNode
  backupJson: string
  lastSavedAt?: string
  restoreJson: string
  preview: JsonImportPreview | null
  issues: readonly ImportIssue[]
  resetActions: readonly ResetAction[]
  messages?: readonly FormMessage[]
  canApplyRestore?: boolean
  onCopyBackup: () => void
  onDownloadBackup?: () => void
  onRestoreJsonChange: (value: string) => void
  onPreviewRestore: () => void
  onApplyRestore: () => void
  onReset: (actionId: string) => void
}

export function SettingsBackupScreen(props: SettingsBackupScreenProps) {
  return screenFrame(
    'Your profile. Your data.',
    'Keep your preferences up to date and your progress backed up.',
    [
      props.profileContent,
      sectionCard('settings-backup', 'Take your progress with you', 'Download a backup before clearing your browser or changing devices.', [
        props.onDownloadBackup ? h('button', { key: 'download', type: 'button', className: 'settings-backup__action is-primary', disabled: !props.backupJson, onClick: props.onDownloadBackup }, 'Download backup') : null,
        h('details', { key: 'backup-details', className: 'feature-advanced' }, [
        h('summary', { key: 'summary' }, 'View or copy backup JSON'),
        textArea({
          id: 'backup-json',
          label: 'Backup JSON',
          value: props.backupJson,
          onChange: () => undefined,
          rows: 8,
          readOnly: true,
          className: 'settings-backup__field',
        }),
        h('button', { key: 'copy-backup', type: 'button', className: 'settings-backup__action', onClick: props.onCopyBackup }, 'Copy backup'),
        ]),
      ], 'settings-backup__card'),
      sectionCard('settings-restore', 'Restore a backup', 'Returning on a new device? Paste your saved backup below. You will confirm before anything is replaced.', [
        h('details', { key: 'restore-details', className: 'feature-advanced' }, [
        h('summary', { key: 'summary' }, 'Import saved data'),
        textArea({
          id: 'restore-json',
          label: 'Restore JSON',
          value: props.restoreJson,
          onChange: props.onRestoreJsonChange,
          rows: 5,
          placeholder: 'Paste your Hybrid Coach backup JSON...',
          className: 'settings-backup__field',
        }),
        actionBar('restore-actions', [
          h('button', { key: 'preview', type: 'button', className: 'settings-backup__action', onClick: props.onPreviewRestore }, 'Preview restore'),
          h(
            'button',
            { key: 'apply', type: 'button', disabled: !props.canApplyRestore, className: 'settings-backup__action', onClick: props.onApplyRestore },
            'Restore backup',
          ),
        ], 'settings-backup__actions'),
        ]),
      ], 'settings-backup__card'),
      messageList(props.messages, 'settings-messages'),
      issueList(props.issues, 'settings-issues'),
      previewPanel(props.preview, 'settings-preview'),
      sectionCard('settings-reset', 'Start fresh', 'This removes training data from this browser. Export a backup first.', [
        h(
          'ul',
          { key: 'reset-list', className: 'settings-backup__reset-list' },
          props.resetActions.map(action =>
            h('li', { key: action.id, className: 'settings-backup__reset-item' }, [
              h('strong', { key: 'label', className: 'settings-backup__reset-label' }, action.label),
              h('div', { key: 'description', className: 'settings-backup__reset-description' }, action.description),
              h(
                'button',
                { key: 'button', type: 'button', className: 'settings-backup__action', onClick: () => props.onReset(action.id) },
                action.confirmationLabel,
              ),
            ]),
          ),
        ),
      ], 'settings-backup__card'),
    ],
    undefined,
    'settings-backup',
  )
}
import type { ReactNode } from 'react'
