import { AppHeader } from '../AppHeader.tsx'
import { ProgressIndicator } from '../ProgressIndicator.tsx'
import { SessionCard } from '../SessionCard.tsx'
import { StartScreen } from '../StartScreen.tsx'
import { EmptyState, ErrorState, LoadingState } from '../States.tsx'
import { ModalSurface, SheetSurface } from '../Surfaces.tsx'
import { WeekBoard } from '../WeekBoard.tsx'
import { HybridCoachShell } from '../../shell/HybridCoachShell.tsx'

export function ShellContracts() {
  return (
    <>
      <AppHeader
        brandHref="/app/"
        navItems={[
          { id: 'today', label: 'Today', href: '#today', current: true },
          { id: 'plan', label: 'Plan', href: '#plan' },
          { id: 'library', label: 'Library', href: '#library' },
        ]}
        primaryAction={{ label: 'Review week', href: '#review' }}
        secondaryAction={{ label: 'Settings', href: '#settings', tone: 'ghost' }}
        statusLabel="MVP preview"
        subtitle="Plan locally. Share only when you choose."
      />
      <StartScreen
        aiPath={{
          id: 'ai',
          title: 'Plan with AI',
          summary: 'Copy a compact brief, talk to your preferred coach chat, then review the reply here.',
          eyebrow: 'Optional',
          featured: true,
          action: { label: 'Open AI planning', href: '#ai' },
        }}
        continuePath={{
          id: 'continue',
          title: 'Continue',
          summary: 'Resume the saved week and your latest review notes.',
          badgeLabel: 'Saved data',
          action: { label: 'Resume week', href: '#resume', tone: 'secondary' },
        }}
        intro="Choose a manual setup or an AI-assisted start. Either path stays local until you explicitly share a brief."
        manualPath={{
          id: 'manual',
          title: 'Start manually',
          summary: 'Build the week yourself with clear cards, fixed sessions, and room for real life.',
          action: { label: 'Build manually', href: '#manual', tone: 'secondary' },
        }}
        savedStateSummary="Last update: 3 planned sessions, 1 fixed club practice."
        title="Start your next training week"
      />
      <ProgressIndicator
        steps={[
          { id: 'goal', label: 'Goal', description: 'Define the next block.', status: 'complete' },
          { id: 'routine', label: 'Routine', description: 'Set time, equipment, and fixed work.', status: 'current' },
          { id: 'review', label: 'Review', description: 'Approve a checked week.', status: 'upcoming' },
        ]}
      />
      <SessionCard
        action={{ label: 'View details', href: '#session', tone: 'ghost' }}
        clubBadgeLabel="Fixed club"
        fixed
        kind="strength"
        metrics={[
          { label: 'Focus', value: 'Squat + press' },
          { label: 'Duration', value: '55 min' },
        ]}
        note="Keep rest generous between the heavy sets."
        summary="Full body session with room for an easy run later."
        timeLabel="Tue · 18:30"
        title="Club lift"
      />
      <WeekBoard
        days={[
          {
            id: 'mon',
            label: 'Mon',
            dateLabel: '8 Sep',
            summary: 'Easy day',
            cards: [
              {
                id: 'mon-run',
                kind: 'aerobic',
                title: 'Easy run',
                timeLabel: '35 min',
                summary: 'Relaxed aerobic work with optional strides.',
              },
            ],
          },
          {
            id: 'tue',
            label: 'Tue',
            dateLabel: '9 Sep',
            cards: [
              {
                id: 'tue-lift',
                kind: 'strength',
                title: 'Lower + push',
                clubBadgeLabel: 'Fixed club',
                fixed: true,
                timeLabel: '18:30',
              },
            ],
          },
          { id: 'wed', label: 'Wed', dateLabel: '10 Sep', emptyLabel: 'Recovery focus.' },
          { id: 'thu', label: 'Thu', dateLabel: '11 Sep', emptyLabel: 'Add a session or keep open.' },
          { id: 'fri', label: 'Fri', dateLabel: '12 Sep', emptyLabel: 'Add a session or keep open.' },
          { id: 'sat', label: 'Sat', dateLabel: '13 Sep', emptyLabel: 'Add a session or keep open.' },
          { id: 'sun', label: 'Sun', dateLabel: '14 Sep', emptyLabel: 'Add a session or keep open.' },
        ]}
        description="Seven-day board on desktop, stacked day cards on mobile."
        title="Approved week"
      />
      <EmptyState
        action={{ label: 'Create your first session', href: '#create' }}
        message="Start with one run, one lift, or a mobility block and let the week grow around it."
        title="No sessions yet"
      />
      <ErrorState
        action={{ label: 'Try again', href: '#retry' }}
        message="We could not load the saved week preview."
        recoveryHint="Keep the current page open and retry after the local data finishes loading."
        title="Week preview unavailable"
      />
      <LoadingState
        message="Checking saved plan data and preparing your week."
        title="Loading planner"
      />
      <ModalSurface
        description="Keep the current plan in history and start a new setup with your routine prefilled."
        dismissAction={{ label: 'Close', href: '#close', tone: 'ghost' }}
        open
        primaryAction={{ label: 'Start a new plan', href: '#start' }}
        secondaryAction={{ label: 'Back up first', href: '#backup', tone: 'secondary' }}
        title="Start a new plan"
      >
        <p className="hc-bodyCopy">Previous logged sessions stay read-only and visible in the old plan.</p>
      </ModalSurface>
      <SheetSurface
        description="Adjust one card without leaving the week board."
        dismissAction={{ label: 'Done', href: '#done', tone: 'ghost' }}
        open
        primaryAction={{ label: 'Save changes', href: '#save' }}
        title="Quick edit"
      >
        <p className="hc-bodyCopy">Swap the session time, move it, or leave a short note.</p>
      </SheetSurface>
      <HybridCoachShell
        header={{
          navItems: [
            { id: 'start', label: 'Start', href: '#start', current: true },
            { id: 'week', label: 'Week', href: '#week' },
            { id: 'review', label: 'Review', href: '#review' },
          ],
          primaryAction: { label: 'Settings', href: '#settings', tone: 'secondary' },
          statusLabel: 'Prototype shell',
          subtitle: 'Mobile-first with room for fixed club sessions.',
        }}
        overlays={
          <ModalSurface
            description="Approve explicit resets before clearing the active calendar."
            dismissAction={{ label: 'Close', href: '#dismiss', tone: 'ghost' }}
            open
            primaryAction={{ label: 'Confirm', href: '#confirm' }}
            title="Confirm action"
          />
        }
        progress={{
          steps: [
            { id: 'goal', label: 'Goal', status: 'complete' },
            { id: 'routine', label: 'Routine', status: 'current' },
            { id: 'week', label: 'Week', status: 'upcoming' },
          ],
        }}
        startScreen={{
          aiPath: {
            id: 'ai-shell',
            title: 'Plan with AI',
            summary: 'Review an explicit AI proposal before approval.',
            featured: true,
            action: { label: 'Open AI path', href: '#ai-shell' },
          },
          intro: 'The shell keeps manual and AI-first routes side by side.',
          manualPath: {
            id: 'manual-shell',
            title: 'Start manually',
            summary: 'Add cards yourself and keep fixed sessions visible.',
            action: { label: 'Open manual path', href: '#manual-shell', tone: 'secondary' },
          },
          savedStateSummary: 'Continue appears only when local plan data exists.',
          title: 'Choose your start',
        }}
        utilityPanels={
          <>
            <LoadingState message="Preparing your preview board." title="Loading" />
            <EmptyState message="New workouts will appear here." title="Notes" />
          </>
        }
        weekBoard={{
          days: [
            { id: 'one', label: 'Day 1', dateLabel: 'Mon', emptyLabel: 'Open space.' },
            { id: 'two', label: 'Day 2', dateLabel: 'Tue', emptyLabel: 'Open space.' },
            { id: 'three', label: 'Day 3', dateLabel: 'Wed', emptyLabel: 'Open space.' },
            { id: 'four', label: 'Day 4', dateLabel: 'Thu', emptyLabel: 'Open space.' },
            { id: 'five', label: 'Day 5', dateLabel: 'Fri', emptyLabel: 'Open space.' },
            { id: 'six', label: 'Day 6', dateLabel: 'Sat', emptyLabel: 'Open space.' },
            { id: 'seven', label: 'Day 7', dateLabel: 'Sun', emptyLabel: 'Open space.' },
          ],
          title: 'Week shell',
        }}
      />
    </>
  )
}
