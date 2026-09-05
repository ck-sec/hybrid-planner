export type IconName = 'arrow' | 'back' | 'calendar' | 'check' | 'close' | 'dumbbell' | 'run' | 'court' | 'spark' | 'history' | 'settings' | 'plus' | 'move' | 'leaf' | 'download' | 'lock' | 'chevron'

const paths: Record<IconName, string> = {
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  back: 'M20 12H5m6-6-6 6 6 6',
  calendar: 'M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1ZM8 3v4m8-4v4M4 10h16M8 14h2m4 0h2m-8 3h2',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  dumbbell: 'm7 7 10 10M4 10l6-6M2 8l6-6m6 18 6-6m-4 8 6-6',
  run: 'm14 4 1-1 1 1-1 1-1-1Zm-3 5 3-2 3 4h3M4 11l5-3 4 6-4 7m4-7 5 2 2 5',
  court: 'M3 5h18v14H3ZM12 5v14M3 12h18m-11 0a4 4 0 0 1 8 0 4 4 0 0 1-8 0',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7 0v4m-2-2h4',
  history: 'M4 8a9 9 0 1 1-1 7M3 3v6h6m3-2v6l4 2',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  plus: 'M12 5v14M5 12h14',
  move: 'M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3',
  leaf: 'M5 19C-1 8 9 3 20 4c1 12-3 18-12 15M5 21 16 9',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5Zm7 4v3',
  chevron: 'm9 5 7 7-7 7',
}

export default function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}
