import type { AppHeaderNavItem, AppHeaderProps } from '../components/AppHeader.tsx'
import type { ProgressStep } from '../components/ProgressIndicator.tsx'
import type { StartScreenProps } from '../components/StartScreen.tsx'
import type { SelectOption } from '../features/models.ts'
import type { PlannerState } from '../state/planner.ts'
import { formatDayLabel, formatWeekRange, listWeekDates } from './dates.ts'
import type { AppRoute, AppState } from './state.ts'

export interface NavHandlers {
  readonly onNavigate: (route: AppRoute) => void
}

export interface StartHandlers {
  readonly onContinue: () => void
  readonly onGuidedStart: () => void
  readonly onManualStart: () => void
  readonly onResumeDraft: () => void
}

const ROUTE_LABELS: Record<AppRoute, string> = {
  start: 'Overview',
  onboarding: 'Setup',
  planner: 'Week',
  ai: 'AI planner',
  log: 'Log',
  review: 'Review',
  settings: 'Profile',
}

export function routeLabel(route: AppRoute): string {
  return ROUTE_LABELS[route]
}

export function countPlannedWorkouts(planner: PlannerState | undefined): number {
  return planner?.present.week.workouts.length ?? 0
}

export function describeSavedState(state: AppState): string {
  if (!state.athlete) return 'No local data is saved in this browser yet.'
  const planned = countPlannedWorkouts(state.planner)
  const weekLabel = state.planner ? formatWeekRange(state.planner.present.week.weekStart) : 'no week yet'
  const logged = state.logs.length
  const savedLabel = state.unsavedWeek ? 'not saved yet' : state.savedWeek ? 'saved locally' : 'not saved yet'
  return `${state.athlete.name}: ${planned} planned session${planned === 1 ? '' : 's'} for ${weekLabel} (${savedLabel}), ${logged} saved log${logged === 1 ? '' : 's'}.`
}

export function buildNavItems(state: AppState, handlers: NavHandlers): readonly AppHeaderNavItem[] {
  const hasPlanner = Boolean(state.planner)
  const hasAthlete = Boolean(state.athlete)
  const routes: readonly { route: AppRoute; disabled?: boolean }[] = [
    { route: 'start' },
    { route: 'planner', disabled: !hasPlanner },
    { route: 'ai', disabled: !hasAthlete },
    { route: 'review', disabled: !hasPlanner || countPlannedWorkouts(state.planner) === 0 },
    { route: 'settings', disabled: !hasAthlete },
  ]

  return routes.map(entry => ({
    id: `nav-${entry.route}`,
    label: ROUTE_LABELS[entry.route],
    current: state.route === entry.route || (entry.route === 'planner' && state.route === 'log') || (entry.route === 'ai' && state.route === 'onboarding'),
    disabled: entry.disabled ?? false,
    onSelect: () => handlers.onNavigate(entry.route),
  }))
}

export function buildProgressSteps(state: AppState): readonly ProgressStep[] {
  const planned = countPlannedWorkouts(state.planner)
  const logged = state.logs.length
  return [
    {
      id: 'progress-profile',
      label: 'Profile',
      description: state.athlete ? state.athlete.goal : 'Set a goal manually or with guided setup.',
      status: state.athlete ? 'complete' : state.route === 'onboarding' ? 'current' : 'upcoming',
    },
    {
      id: 'progress-week',
      label: 'Week',
      description: planned ? `${planned} planned session${planned === 1 ? '' : 's'}.` : 'Add the first session.',
      status: planned ? 'complete' : state.planner ? 'current' : 'upcoming',
    },
    {
      id: 'progress-log',
      label: 'Log',
      description: logged ? `${logged} saved log${logged === 1 ? '' : 's'}.` : 'Record what actually happened.',
      status: logged ? 'complete' : state.route === 'log' ? 'current' : 'upcoming',
    },
    {
      id: 'progress-review',
      label: 'Review',
      description: 'Close the week and build the next prompt.',
      status: state.route === 'review' ? 'current' : 'upcoming',
    },
  ]
}

export function buildStatusLabel(state: AppState): string {
  if (state.busy) return 'Working…'
  if (state.unsavedWeek) return 'Unsaved week'
  if (state.savedWeek) return 'Saved locally'
  return 'Local only'
}

export function buildHeaderProps(
  state: AppState,
  handlers: NavHandlers & { readonly onSettings: () => void; readonly onReview: () => void },
): AppHeaderProps {
  return {
    brandHref: '../',
    title: 'Hybrid Coach',
    subtitle: 'COACH',
    statusLabel: state.route === 'onboarding' ? undefined : buildStatusLabel(state),
    navItems: state.route === 'onboarding' ? [] : buildNavItems(state, handlers),
    ...(state.route === 'onboarding' ? { secondaryAction: { label: 'Exit setup', tone: 'ghost' as const, onClick: () => handlers.onNavigate('start') } } : {}),
  }
}

export function buildStartScreenProps(state: AppState, handlers: StartHandlers): StartScreenProps {
  const planned = countPlannedWorkouts(state.planner)
  const continueSummary = state.planner
    ? `Resume ${formatWeekRange(state.planner.present.week.weekStart)} with ${planned} planned session${planned === 1 ? '' : 's'}.`
    : state.resumableDraft
      ? 'Resume the saved guided setup draft.'
      : ''

  return {
    title: state.planner ? 'Your week. Your next step.' : 'Your training. Your way.',
    intro: 'Running, lifting, and everything in between. Build a week that fits your life, then make it your own.',
    savedStateSummary: state.planner ? `${planned} session${planned === 1 ? '' : 's'} planned for ${formatWeekRange(state.planner.present.week.weekStart)}.` : undefined,
    ...(state.planner || state.resumableDraft
      ? {
        continuePath: {
          id: 'start-continue',
          title: state.planner ? 'Continue' : 'Resume setup',
          eyebrow: 'Pick up where you left off',
          summary: continueSummary,
          badgeLabel: 'Saved data',
          action: {
            label: state.planner ? 'Open my week' : 'Resume setup',
            onClick: () => (state.planner ? handlers.onContinue() : handlers.onResumeDraft()),
            tone: 'secondary',
          },
        },
      }
      : {}),
    aiPath: {
      id: 'start-guided',
      title: state.resumableDraft ? 'Resume AI setup' : 'Plan with AI',
      eyebrow: 'A little guidance',
      summary: state.resumableDraft
        ? 'Pick up where you left off. Your answers are saved here.'
        : 'Share your goal and ideal week. Take your brief to any AI chat, then bring your plan back here.',
      featured: true,
      action: {
        label: state.resumableDraft ? 'Continue AI setup' : 'Plan with AI',
        onClick: () => handlers.onGuidedStart(),
      },
    },
    manualPath: {
      id: 'start-manual',
      title: 'Build it yourself',
      eyebrow: 'Make it your own',
      summary: 'Already know what works for you? Start with an open week and add your own sessions.',
      action: { label: 'Start a blank week', onClick: () => handlers.onManualStart(), tone: 'secondary' },
    },
    secondaryHint: 'No account. No subscription. Saved in your browser.',
  }
}

export function buildDayOptions(planner: PlannerState): readonly SelectOption[] {
  return listWeekDates(planner.present.week.weekStart).map(date => ({
    value: date,
    label: formatDayLabel(date),
  }))
}
