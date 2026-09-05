import { DAY_NAMES } from '../../engine/constants.ts'
import type { Day } from '../../engine/types.ts'

export function NumberField({ label, value, onChange, min = 0, max = 10000, step = 1, suffix, required = true }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number | 'any'; suffix?: string; required?: boolean }) {
  return <label className="cf-field"><span>{label}</span><div className="cf-number"><input type="number" inputMode={step === 'any' || step < 1 ? 'decimal' : 'numeric'} min={min} max={max} step={step} value={value === 0 && min > 0 ? '' : value} onChange={event => onChange(event.target.value === '' ? 0 : Number(event.target.value))} required={required} />{suffix && <span>{suffix}</span>}</div></label>
}

export function DayPicker({ value, onChange, label }: { value: Day[]; onChange: (days: Day[]) => void; label: string }) {
  return <fieldset className="cf-day-picker"><legend>{label}</legend><div>{DAY_NAMES.map((name, index) => {
    const day = index as Day
    return <button type="button" key={name} aria-pressed={value.includes(day)} aria-label={name} onClick={() => onChange(value.includes(day) ? value.filter(item => item !== day) : [...value, day].sort())}>{name.slice(0, 1)}</button>
  })}</div></fieldset>
}

export function CourtArt() {
  return <div className="cf-court-art" aria-hidden="true">
    <svg viewBox="0 0 560 420" fill="none">
      <defs><pattern id="court-grain" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="currentColor" opacity=".15" /></pattern></defs>
      <rect width="560" height="420" fill="url(#court-grain)" />
      <g className="cf-art-court" transform="translate(65 45) rotate(-16 215 160)" stroke="currentColor" strokeWidth="1.5">
        <rect x="5" y="5" width="420" height="290" />
        <path d="M215 5v290M5 150h420M50 5v290M380 5v290" />
        <circle cx="215" cy="150" r="64" />
        <circle cx="215" cy="150" r="7" />
        <path d="m140 218 75-68 93-48" strokeDasharray="6 8" />
        <circle className="cf-art-lift" cx="140" cy="218" r="17" />
        <circle className="cf-art-run" cx="308" cy="102" r="13" />
        <path className="cf-art-direction" d="m303 108 7-6-7-6" />
      </g>
    </svg>
    <span className="cf-art-label">BUILT AROUND<br />YOUR REAL LIFE.</span>
    <span className="cf-art-coordinate">RUN / LIFT / PLAY</span>
  </div>
}
