export default function BrandMark({ className }: { className?: string }) {
  return <svg className={className} width="36" height="36" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <rect width="48" height="48" rx="12" fill="currentColor" />
    <path d="M14 12v24M34 12v24M14 28h4c6 0 6-8 12-8h4" fill="none" stroke="var(--brand-cream)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}
