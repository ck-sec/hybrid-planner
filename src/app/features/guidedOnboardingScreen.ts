import type { ChangeEvent } from 'react'
import type { ChoiceOption, ClubSessionDraft, DayOfWeek, EquipmentMode, FormMessage, OnboardingDraft, OnboardingStepId, SelectOption } from './models.ts'
import { equipmentPresets } from './equipmentPresets.ts'
import { actionBar, dayLabels, h, messageList, optionalDayLabel, screenFrame, selectedLabels, textArea, textInput } from './ui.ts'

export interface OnboardingStepSummary {
  id: OnboardingStepId
  title: string
  description: string
  isAvailable: boolean
  isComplete: boolean
}

type Category = 'aerobic' | 'strength' | 'mobility'
type ClubSessionField = Exclude<keyof ClubSessionDraft, 'id'>

export interface GuidedOnboardingScreenProps {
  steps: readonly OnboardingStepSummary[]
  currentStep: OnboardingStepId
  draft: OnboardingDraft
  aerobicDayOptions: readonly ChoiceOption<DayOfWeek>[]
  strengthDayOptions: readonly ChoiceOption<DayOfWeek>[]
  mobilityDayOptions: readonly ChoiceOption<DayOfWeek>[]
  aerobicModalityOptions?: readonly ChoiceOption[]
  strengthOptions?: readonly ChoiceOption[]
  equipmentModeOptions: readonly ChoiceOption<EquipmentMode>[]
  equipmentItems?: readonly string[]
  clubCategoryOptions?: readonly SelectOption[]
  clubScopeOptions?: readonly SelectOption[]
  clubSessions: readonly ClubSessionDraft[]
  messages?: readonly FormMessage[]
  canGoBack?: boolean
  canGoNext?: boolean
  canFinish?: boolean
  onSelectStep: (stepId: OnboardingStepId) => void
  onGoalSummaryChange: (value: string) => void
  onTargetDateChange: (value: string) => void
  onGoalNotesChange: (value: string) => void
  onCategoryCountChange: (category: Category, value: string) => void
  onToggleCategoryDay: (category: Category, day: DayOfWeek) => void
  onToggleAerobicModality?: (id: string) => void
  onAerobicExercisesChange?: (value: string) => void
  onStrengthPreferenceChange?: (id: string) => void
  onEquipmentModeChange: (id: EquipmentMode) => void
  onEquipmentDetailsChange: (value: string) => void
  onToggleEquipmentItem?: (item: string) => void
  onClubSessionChange: (sessionId: string, field: ClubSessionField, value: string) => void
  onAddClubSession: () => void
  onRemoveClubSession: (sessionId: string) => void
  onReviewNotesChange: (value: string) => void
  onBack: () => void
  onNext: () => void
  onFinish: () => void
}

const categoryInfo: Record<Category, { title: string; hint: string; icon: string }> = {
  aerobic: { title: 'Aerobic', hint: 'Run, ride, swim...', icon: 'M4 17h16v3H4z M6 17l2-8 4 3 3 5 M8 9l3-4 4 3 4 1' },
  strength: { title: 'Strength', hint: 'Make room to lift', icon: 'M3 8v8 M6 5v14 M6 12h12 M18 5v14 M21 8v8' },
  mobility: { title: 'Mobility', hint: 'Move well, recover', icon: 'M12 3v3 M5 9l7 3 7-3 M12 12v4 M12 16l-5 5 M12 16l5 5' },
}
const categories = ['aerobic', 'strength', 'mobility'] as const
const stepLabels: Partial<Record<OnboardingStepId, string>> = { goal: 'Goal', schedule: 'Your week', equipment: 'Equipment', review: 'Ready' }

function icon(path: string) {
  return h('svg', { key: 'icon', width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: path }))
}

function countFor(props: GuidedOnboardingScreenProps, category: Category) {
  return props.draft[`${category}SessionCount`]
}

function daysFor(props: GuidedOnboardingScreenProps, category: Category) {
  return props[`${category}DayOptions`]
}

export function GuidedOnboardingScreen(props: GuidedOnboardingScreenProps) {
  const index = props.steps.findIndex(step => step.id === props.currentStep)
  const titles: Partial<Record<OnboardingStepId, string>> = {
    goal: 'Start with something worth training for.',
    schedule: 'A week that works for you.',
    equipment: 'Your space. Your equipment.',
    review: 'Looks like your kind of week.',
  }
  return screenFrame(
    titles[props.currentStep] ?? 'A week that works for you.',
    props.currentStep === 'goal' ? 'A few choices now. The detailed planning happens with your AI.' :
      props.currentStep === 'equipment' ? 'Choose a starting set, then adjust what you actually have.' :
        props.currentStep === 'review' ? 'Check the essentials. You can change things as you go.' : 'Tap what you train. Slide to set how often. Pick your days.',
    [
      h('nav', { key: 'progress', className: 'setup-progress guided-onboarding__progress', 'aria-label': 'Setup steps' }, [
        h('span', { key: 'count', className: 'setup-progress__count' }, `Step ${index + 1} of ${props.steps.length}`),
        h('ol', { key: 'steps' }, props.steps.map((step, stepIndex) =>
          h('li', { key: step.id }, h('button', {
            type: 'button', disabled: !step.isAvailable,
            'aria-current': step.id === props.currentStep ? 'step' : undefined,
            onClick: () => props.onSelectStep(step.id),
          }, [h('span', { key: 'number' }, String(stepIndex + 1)), h('span', { key: 'label' }, stepLabels[step.id] ?? step.title)])),
        )),
      ]),
      props.currentStep === 'goal' ? renderGoal(props) :
        props.currentStep === 'equipment' || props.currentStep === 'strength' ? renderEquipment(props) :
          props.currentStep === 'review' ? renderReview(props) : renderWeek(props),
      messageList(props.messages, 'onboarding-messages', 'Before you continue'),
    ],
    actionBar('onboarding-actions', [
      h('button', { key: 'back', type: 'button', disabled: !props.canGoBack, onClick: props.onBack }, 'Back'),
      h('button', { key: 'next', type: 'button', disabled: props.currentStep === 'review' ? !props.canFinish : !props.canGoNext, onClick: props.currentStep === 'review' ? props.onFinish : props.onNext },
        props.currentStep === 'review' ? 'Create my AI brief' : 'Continue'),
    ], 'setup-footer'),
    'guided-onboarding setup-wizard',
  )
}

function renderGoal(props: GuidedOnboardingScreenProps) {
  return h('section', { key: 'goal', className: 'setup-panel' }, [
    h('div', { key: 'ideas', className: 'setup-goalIdeas', 'aria-label': 'Goal ideas' }, [
      ['Run my first 10K', 'A race or event'],
      ['Get stronger and keep running', 'Strength + endurance'],
      ['Build a consistent training routine', 'A healthier routine'],
    ].map(([goal, label]) => h('button', { key: goal, type: 'button', 'aria-pressed': props.draft.goalSummary === goal, onClick: () => props.onGoalSummaryChange(goal!) }, label))),
    textInput({ id: 'goal-summary', label: 'Your goal', value: props.draft.goalSummary, onChange: props.onGoalSummaryChange, placeholder: 'e.g. Run a half marathon and keep getting stronger' }),
    textInput({ id: 'target-date', label: 'Target date (optional)', type: 'date', value: props.draft.targetDate, onChange: props.onTargetDateChange }),
    h('details', { key: 'context', className: 'feature-advanced' }, [
      h('summary', { key: 'summary' }, 'Anything else your AI should know?'),
      textArea({ id: 'goal-notes', label: 'A little context', value: props.draft.goalNotes, onChange: props.onGoalNotesChange, placeholder: 'Current fitness, a busy schedule, or limitations...', rows: 2 }),
    ]),
  ])
}

function renderWeek(props: GuidedOnboardingScreenProps) {
  return h('div', { key: 'week', className: 'setup-week' }, [
    h('div', { key: 'tiles', className: 'setup-trainingTiles', 'aria-label': 'Choose your training' }, [
      ...categories.map(category => h('button', {
        key: category, type: 'button', className: `setup-trainingTile is-${category}`,
        'aria-pressed': Number(countFor(props, category)) > 0,
        onClick: () => props.onCategoryCountChange(category, Number(countFor(props, category)) > 0 ? '0' : '1'),
      }, [icon(categoryInfo[category].icon), h('strong', { key: 'title' }, categoryInfo[category].title), h('span', { key: 'hint' }, categoryInfo[category].hint)])),
      h('button', { key: 'club', type: 'button', className: 'setup-trainingTile is-club', onClick: props.onAddClubSession }, [
        icon('M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M2 20v-3a6 6 0 0 1 12 0v3 M18 9v8 M14 13h8'),
        h('strong', { key: 'title' }, '+ Club training'), h('span', { key: 'hint' }, 'Optional'),
      ]),
    ]),
    ...categories.filter(category => Number(countFor(props, category)) > 0 || (countFor(props, category) !== '' && !/^\d+$/.test(countFor(props, category)))).map(category =>
      h('section', { key: category, className: `setup-trainingPanel is-${category}`, 'aria-labelledby': `setup-${category}` }, [
        h('div', { key: 'heading', className: 'setup-panelHeading' }, [
          h('h2', { key: 'title', id: `setup-${category}` }, categoryInfo[category].title),
          h('span', { key: 'count', className: 'setup-count', 'aria-live': 'polite' }, [h('strong', { key: 'number' }, countFor(props, category)), ' / week']),
        ]),
        h('label', { key: 'label', htmlFor: `${category}-sessions`, className: 'setup-sliderLabel' }, `${categoryInfo[category].title} sessions per week`),
        h('input', {
          key: 'slider', id: `${category}-sessions`, type: 'range', min: 0, max: 14, step: 1,
          value: countFor(props, category), className: 'setup-slider',
          onChange: (event: ChangeEvent<HTMLInputElement>) => props.onCategoryCountChange(category, event.target.value),
        }),
        h('div', { key: 'limits', className: 'setup-sliderLimits', 'aria-hidden': true }, [h('span', { key: 'min' }, '0'), h('span', { key: 'max' }, '14')]),
        dayPicker(`${category}-days`, `${categoryInfo[category].title} preferred days`, daysFor(props, category), day => props.onToggleCategoryDay(category, day)),
        category === 'aerobic' ? textInput({
          id: 'aerobic-exercises', label: 'What do you enjoy? (optional)',
          value: props.draft.aerobicExercises ?? selectedLabels(props.aerobicModalityOptions ?? []),
          onChange: value => props.onAerobicExercisesChange?.(value),
          placeholder: 'e.g. trail running, swimming, SkiErg',
          description: 'Any aerobic activities. Separate them with commas.',
        }) : null,
      ]),
    ),
    ...props.clubSessions.map((session, index) => h('section', { key: session.id, className: 'setup-trainingPanel is-club guided-onboarding__club-card', 'aria-labelledby': `${session.id}-title` }, [
      h('div', { key: 'heading', className: 'setup-panelHeading' }, [
        h('h2', { key: 'title', id: `${session.id}-title` }, `Club training ${index + 1}`),
        h('button', { key: 'remove', type: 'button', className: 'setup-remove', onClick: () => props.onRemoveClubSession(session.id), 'aria-label': `Remove club training ${index + 1}` }, 'Remove'),
      ]),
      dayPicker(`${session.id}-days`, 'Club training day', Object.entries(dayLabels).map(([day, label]) => ({ id: day as DayOfWeek, label, selected: session.day === day })), day => props.onClubSessionChange(session.id, 'day', day), true),
      textInput({ id: `${session.id}-time`, label: 'Time', type: 'time', value: session.startTime, onChange: value => props.onClubSessionChange(session.id, 'startTime', value) }),
      textInput({ id: `${session.id}-description`, label: 'Short description (optional)', value: session.activity === 'Club training' ? '' : session.activity, onChange: value => props.onClubSessionChange(session.id, 'activity', value), placeholder: 'e.g. Tuesday track club' }),
    ])),
    h('p', { key: 'hint', className: 'setup-quietHint' }, 'Keep it realistic. Your AI will help with the training details.'),
  ])
}

function dayPicker(id: string, label: string, options: readonly ChoiceOption<DayOfWeek>[], onSelect: (day: DayOfWeek) => void, single = false) {
  return h('fieldset', { key: id, className: 'setup-days' }, [
    h('legend', { key: 'legend' }, label),
    h('div', { key: 'days' }, options.map(option => h('label', { key: option.id, title: option.label }, [
      h('input', { key: 'input', type: single ? 'radio' : 'checkbox', name: id, checked: option.selected, onChange: () => onSelect(option.id), 'aria-label': option.label }),
      h('span', { key: 'label' }, option.label.slice(0, 3)),
    ]))),
  ])
}

function renderEquipment(props: GuidedOnboardingScreenProps) {
  const chosen = props.draft.equipmentMode
  const items = props.equipmentItems ?? []
  const available = chosen ? [...new Set([...equipmentPresets[chosen].items, ...items])] : []
  return h('div', { key: 'equipment', className: 'setup-equipment' }, [
    h('div', { key: 'presets', className: 'setup-equipmentTiles', role: 'group', 'aria-label': 'Equipment setup' }, (Object.keys(equipmentPresets) as EquipmentMode[]).map(mode => {
      const preset = equipmentPresets[mode]
      return h('button', { key: mode, type: 'button', 'aria-pressed': mode === chosen, onClick: () => props.onEquipmentModeChange(mode) }, [
        icon(mode === 'bodyweight' ? categoryInfo.mobility.icon : mode === 'home' ? 'M3 11l9-8 9 8 M5 10v11h14V10 M9 21v-8h6v8' : 'M4 21V3h16v18 M8 7h2 M14 7h2 M8 11h2 M14 11h2 M10 21v-6h4v6'),
        h('strong', { key: 'title' }, preset.title),
        h('span', { key: 'description', className: 'setup-equipmentDescription' }, preset.description),
        h('span', { key: 'includes', className: 'setup-equipmentIncludes' }, preset.items.join(' · ')),
      ])
    })),
    chosen ? h('section', { key: 'contents', className: 'setup-panel' }, [
      h('h2', { key: 'title' }, 'Make this set yours'),
      h('p', { key: 'hint', className: 'setup-quietHint' }, 'These are the starting inclusions. Uncheck anything you do not have.'),
      h('div', { key: 'items', className: 'setup-equipmentItems' }, available.map(item => h('label', { key: item }, [
        h('input', { key: 'input', type: 'checkbox', checked: items.includes(item), onChange: () => props.onToggleEquipmentItem?.(item) }),
        h('span', { key: 'label' }, item),
      ]))),
      textArea({ id: 'equipment-details', label: 'Anything else? (optional)', value: props.draft.equipmentDetails, onChange: props.onEquipmentDetailsChange, placeholder: 'e.g. pull-up bar, pool access, 16 kg kettlebell only', rows: 2 }),
    ]) : null,
  ])
}

function renderReview(props: GuidedOnboardingScreenProps) {
  return h('section', { key: 'review', className: 'setup-panel setup-review' }, [
    h('div', { key: 'goal', className: 'setup-reviewGoal' }, [
      h('span', { key: 'eyebrow', className: 'hc-eyebrow' }, 'YOUR GOAL'),
      h('h2', { key: 'title' }, props.draft.goalSummary),
      props.draft.targetDate ? h('p', { key: 'date' }, props.draft.targetDate) : null,
      h('button', { key: 'edit', type: 'button', onClick: () => props.onSelectStep('goal') }, 'Edit goal'),
    ]),
    h('div', { key: 'week', className: 'setup-reviewWeek' }, [
      h('h3', { key: 'title' }, 'Your week'),
      ...categories.filter(category => Number(countFor(props, category)) > 0).map(category =>
        h('div', { key: category, className: `setup-reviewRow is-${category}` }, [
          h('strong', { key: 'label' }, `${countFor(props, category)} ${categoryInfo[category].title.toLowerCase()}`),
          h('span', { key: 'days' }, selectedLabels(daysFor(props, category))),
        ]),
      ),
      Number(countFor(props, 'aerobic')) > 0 && props.draft.aerobicExercises ? h('p', { key: 'activities' }, props.draft.aerobicExercises) : null,
      ...props.clubSessions.map(session => h('div', { key: session.id, className: 'setup-reviewRow is-club' }, [
        h('strong', { key: 'label' }, session.activity || 'Club training'),
        h('span', { key: 'time' }, `${optionalDayLabel(session.day)} · ${session.startTime}`),
      ])),
      h('button', { key: 'edit', type: 'button', onClick: () => props.onSelectStep('schedule') }, 'Edit week'),
    ]),
    h('div', { key: 'equipment', className: 'setup-reviewEquipment' }, [
      h('h3', { key: 'title' }, props.draft.equipmentMode ? equipmentPresets[props.draft.equipmentMode].title : 'Equipment'),
      h('p', { key: 'items' }, [...(props.equipmentItems ?? []), props.draft.equipmentDetails].filter(Boolean).join(' · ')),
      h('button', { key: 'edit', type: 'button', onClick: () => props.onSelectStep('equipment') }, 'Edit equipment'),
    ]),
    h('details', { key: 'notes', className: 'feature-advanced' }, [
      h('summary', { key: 'summary' }, 'Add a final note (optional)'),
      textArea({ id: 'review-notes', label: 'Anything else for your AI?', value: props.draft.reviewNotes, onChange: props.onReviewNotesChange, rows: 2 }),
    ]),
  ])
}
