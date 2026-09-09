import type { ReactNode } from 'react'
import { AppHeader, type AppHeaderProps } from '../components/AppHeader.tsx'
import { ProgressIndicator, type ProgressIndicatorProps } from '../components/ProgressIndicator.tsx'
import { StartScreen, type StartScreenProps } from '../components/StartScreen.tsx'
import { WeekBoard, type WeekBoardProps } from '../components/WeekBoard.tsx'

export interface HybridCoachShellProps {
  header: AppHeaderProps
  startScreen: StartScreenProps
  progress: ProgressIndicatorProps
  weekBoard: WeekBoardProps
  utilityPanels?: ReactNode
  overlays?: ReactNode
  mainId?: string
}

export function HybridCoachShell({
  header,
  startScreen,
  progress,
  weekBoard,
  utilityPanels,
  overlays,
  mainId = 'main',
}: HybridCoachShellProps) {
  return (
    <div className="hc-shell">
      <a className="hc-skipLink" href={`#${mainId}`}>
        Skip to planner
      </a>
      <AppHeader {...header} />
      <main className="hc-main" id={mainId} tabIndex={-1}>
        <div className="hc-mainStack">
          <StartScreen {...startScreen} />
          <ProgressIndicator {...progress} />
          <WeekBoard {...weekBoard} />
        </div>
        {utilityPanels ? <aside className="hc-utilityRail">{utilityPanels}</aside> : null}
      </main>
      {overlays}
    </div>
  )
}
