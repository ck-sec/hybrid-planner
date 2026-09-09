import { createElement } from 'react'
import type { ChangeEvent, ReactElement, ReactNode } from 'react'
import type { ChoiceOption, DayOfWeek, FormMessage, ImportIssue, JsonImportPreview, SelectOption } from './models.ts'

export const h = createElement

type TextControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

const tonePrefix: Record<FormMessage['tone'], string> = {
  error: 'Error',
  info: 'Note',
  success: 'Ready',
}

const severityPrefix: Record<ImportIssue['severity'], string> = {
  error: 'Error',
  warning: 'Warning',
}

export const dayLabels: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

function textValueHandler(onChange: (value: string) => void) {
  return (event: ChangeEvent<TextControl>) => {
    const element = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    onChange(element.value)
  }
}

export function screenFrame(title: string, intro: string, children: readonly ReactNode[], footer?: ReactNode, className?: string) {
  return h('main', { 'aria-label': title, className: joinClasses('feature-screen', className) }, [
    h('header', { key: 'header', className: 'feature-screen__header' }, [
      h('h1', { key: 'title', className: 'feature-screen__title' }, title),
      h('p', { key: 'intro', className: 'feature-screen__intro' }, intro),
    ]),
    ...children,
    footer ? h('footer', { key: 'footer', className: 'feature-screen__footer' }, footer) : null,
  ])
}

export function sectionCard(key: string, title: string, description: string, children: readonly ReactNode[], className?: string) {
  return h('section', { key, 'aria-labelledby': `${key}-title`, className: joinClasses('feature-card', className) }, [
    h('h2', { id: `${key}-title`, key: 'title', className: 'feature-card__title' }, title),
    h('p', { key: 'description', className: 'feature-card__description' }, description),
    ...children,
  ])
}

export function actionBar(key: string, children: readonly ReactNode[], className?: string) {
  return h('div', { key, className: joinClasses('feature-actions', className) }, children)
}

export function messageList(messages: readonly FormMessage[] | undefined, key: string, title = 'Guidance') {
  if (!messages?.length) return null
  return h('section', { key, 'aria-labelledby': `${key}-title`, className: 'feature-messages' }, [
    h('h2', { id: `${key}-title`, key: 'title', className: 'feature-messages__title' }, title),
    h(
      'ul',
      { key: 'list', className: 'feature-messages__list' },
      messages.map(message =>
        h(
          'li',
          { key: message.id, className: `feature-messages__item feature-messages__item--${message.tone}` },
          `${tonePrefix[message.tone]}: ${message.text}`,
        ),
      ),
    ),
  ])
}

export function issueList(issues: readonly ImportIssue[], key: string, title = 'Actionable issues') {
  if (!issues.length) return null
  return h('section', { key, 'aria-labelledby': `${key}-title`, className: 'feature-issues' }, [
    h('h2', { id: `${key}-title`, key: 'title', className: 'feature-issues__title' }, title),
    h(
      'ul',
      { key: 'list', className: 'feature-issues__list' },
      issues.map(issue =>
        h('li', { key: issue.id, className: `feature-issues__item feature-issues__item--${issue.severity}` }, [
          h('strong', { key: 'label', className: 'feature-issues__label' }, `${severityPrefix[issue.severity]}:`),
          ` ${issue.message}`,
          issue.path ? h('div', { key: 'path', className: 'feature-issues__path' }, `Path: ${issue.path}`) : null,
          issue.suggestion ? h('div', { key: 'suggestion', className: 'feature-issues__suggestion' }, `Try: ${issue.suggestion}`) : null,
        ]),
      ),
    ),
  ])
}

export function previewPanel(preview: JsonImportPreview | null, key: string) {
  if (!preview) return null
  return h('section', { key, 'aria-labelledby': `${key}-title`, className: 'feature-preview' }, [
    h('h2', { id: `${key}-title`, key: 'title', className: 'feature-preview__title' }, preview.title),
    preview.summary.length
      ? h(
          'ul',
          { key: 'summary', className: 'feature-preview__summary' },
          preview.summary.map((item, index) => h('li', { key: `${key}-summary-${index}`, className: 'feature-preview__summary-item' }, item)),
        )
      : null,
    ...preview.groups.map(group =>
      h('section', { key: group.id, 'aria-labelledby': `${group.id}-title`, className: 'feature-preview__group' }, [
        h('h3', { id: `${group.id}-title`, key: 'title', className: 'feature-preview__group-title' }, group.title),
        h(
          'dl',
          { key: 'list', className: 'feature-definition-list feature-preview__definition-list' },
          group.items.flatMap(item => [
            h('dt', { key: `${group.id}-${item.label}-term`, className: 'feature-definition-list__term' }, item.label),
            h('dd', { key: `${group.id}-${item.label}-value`, className: 'feature-definition-list__value' }, item.value),
          ]),
        ),
      ]),
    ),
  ])
}

export function definitionPairs(items: readonly { key: string; label: string; value: string }[], key: string, title: string) {
  return h('section', { key, 'aria-labelledby': `${key}-title`, className: 'feature-summary' }, [
    h('h2', { id: `${key}-title`, key: 'title', className: 'feature-summary__title' }, title),
    h(
      'dl',
      { key: 'list', className: 'feature-definition-list feature-summary__definition-list' },
      items.flatMap(item => [
        h('dt', { key: `${item.key}-term`, className: 'feature-definition-list__term' }, item.label),
        h('dd', { key: `${item.key}-value`, className: 'feature-definition-list__value' }, item.value),
      ]),
    ),
  ])
}

interface TextInputProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'date' | 'number' | 'text' | 'time'
  inputMode?: 'text' | 'decimal' | 'numeric'
  description?: string
  placeholder?: string
  min?: string
  readOnly?: boolean
  className?: string
}

export function textInput(props: TextInputProps): ReactElement {
  const hintId = props.description ? `${props.id}-hint` : undefined
  return h('div', { key: props.id, className: joinClasses('feature-field feature-field--text', props.className) }, [
    h('label', { htmlFor: props.id, key: 'label', className: 'feature-field__label' }, props.label),
    props.description ? h('p', { id: hintId, key: 'description', className: 'feature-field__description' }, props.description) : null,
    h('input', {
      id: props.id,
      key: 'input',
      type: props.type ?? 'text',
      inputMode: props.inputMode,
      value: props.value,
      placeholder: props.placeholder,
      readOnly: props.readOnly,
      min: props.min,
      'aria-describedby': hintId,
      className: 'feature-field__input',
      onChange: textValueHandler(props.onChange),
    }),
  ])
}

interface TextAreaProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  description?: string
  placeholder?: string
  rows?: number
  readOnly?: boolean
  className?: string
}

export function textArea(props: TextAreaProps): ReactElement {
  const hintId = props.description ? `${props.id}-hint` : undefined
  return h('div', { key: props.id, className: joinClasses('feature-field feature-field--textarea', props.className) }, [
    h('label', { htmlFor: props.id, key: 'label', className: 'feature-field__label' }, props.label),
    props.description ? h('p', { id: hintId, key: 'description', className: 'feature-field__description' }, props.description) : null,
    h('textarea', {
      id: props.id,
      key: 'input',
      value: props.value,
      placeholder: props.placeholder,
      rows: props.rows ?? 4,
      readOnly: props.readOnly,
      'aria-describedby': hintId,
      className: 'feature-field__input',
      onChange: textValueHandler(props.onChange),
    }),
  ])
}

interface SelectInputProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly SelectOption[]
  description?: string
  className?: string
}

export function selectInput(props: SelectInputProps): ReactElement {
  const hintId = props.description ? `${props.id}-hint` : undefined
  return h('div', { key: props.id, className: joinClasses('feature-field feature-field--select', props.className) }, [
    h('label', { htmlFor: props.id, key: 'label', className: 'feature-field__label' }, props.label),
    props.description ? h('p', { id: hintId, key: 'description', className: 'feature-field__description' }, props.description) : null,
    h(
      'select',
      {
        id: props.id,
        key: 'input',
        value: props.value,
        'aria-describedby': hintId,
        className: 'feature-field__input',
        onChange: textValueHandler(props.onChange),
      },
      props.options.map(option =>
        h('option', { key: option.value || 'blank', value: option.value }, option.label),
      ),
    ),
  ])
}

interface ToggleListProps<T extends string> {
  id: string
  legend: string
  description: string
  options: readonly ChoiceOption<T>[]
  onToggle: (id: T) => void
  className?: string
}

export function checkboxList<T extends string>(props: ToggleListProps<T>) {
  return h('fieldset', { key: props.id, className: joinClasses('feature-toggle-list feature-toggle-list--checkbox', props.className) }, [
    h('legend', { key: 'legend', className: 'feature-toggle-list__legend' }, props.legend),
    h('p', { key: 'description', className: 'feature-toggle-list__description' }, props.description),
    h(
      'ul',
      { key: 'list', className: 'feature-toggle-list__items' },
      props.options.map(option =>
        h('li', { key: option.id, className: 'feature-toggle-list__item' }, [
          h('label', { htmlFor: `${props.id}-${option.id}`, key: 'label', className: 'feature-toggle-list__label' }, [
            h('input', {
              id: `${props.id}-${option.id}`,
              key: 'input',
              type: 'checkbox',
              checked: option.selected,
              disabled: option.disabled,
              className: 'feature-toggle-list__input',
              onChange: () => props.onToggle(option.id),
            }),
            ` ${option.label}`,
          ]),
          option.description ? h('div', { key: 'description', className: 'feature-toggle-list__item-description' }, option.description) : null,
        ]),
      ),
    ),
  ])
}

interface RadioListProps<T extends string> {
  id: string
  legend: string
  description: string
  options: readonly ChoiceOption<T>[]
  onSelect: (id: T) => void
  className?: string
}

export function radioList<T extends string>(props: RadioListProps<T>) {
  return h('fieldset', { key: props.id, className: joinClasses('feature-toggle-list feature-toggle-list--radio', props.className) }, [
    h('legend', { key: 'legend', className: 'feature-toggle-list__legend' }, props.legend),
    h('p', { key: 'description', className: 'feature-toggle-list__description' }, props.description),
    h(
      'ul',
      { key: 'list', className: 'feature-toggle-list__items' },
      props.options.map(option =>
        h('li', { key: option.id, className: 'feature-toggle-list__item' }, [
          h('label', { htmlFor: `${props.id}-${option.id}`, key: 'label', className: 'feature-toggle-list__label' }, [
            h('input', {
              id: `${props.id}-${option.id}`,
              key: 'input',
              type: 'radio',
              name: props.id,
              checked: option.selected,
              disabled: option.disabled,
              className: 'feature-toggle-list__input',
              onChange: () => props.onSelect(option.id),
            }),
            ` ${option.label}`,
          ]),
          option.description ? h('div', { key: 'description', className: 'feature-toggle-list__item-description' }, option.description) : null,
        ]),
      ),
    ),
  ])
}

export function selectedLabels(options: readonly ChoiceOption[]) {
  const labels = options.filter(option => option.selected).map(option => option.label)
  return labels.length ? labels.join(', ') : 'Not set'
}

export function optionalDayLabel(value: DayOfWeek | '') {
  return value ? dayLabels[value] : 'Not set'
}

function joinClasses(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(' ')
}
