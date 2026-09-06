import { parseResources, RESOURCE_CATALOG, RESOURCE_PRESETS, resourceLabels } from './equipment.ts'
import type { ResourceId } from './equipment.ts'
import './equipment.css'

export interface EquipmentPickerProps {
  value: readonly ResourceId[]
  onChange: (value: ResourceId[]) => void
  disabled?: boolean
}

const groups = [
  { id: 'strength', label: 'Strength equipment' },
  { id: 'cardio', label: 'Cardio equipment' },
  { id: 'sport', label: 'Sport, space & partners' },
] as const

export function EquipmentPicker({ value, onChange, disabled = false }: EquipmentPickerProps) {
  const selected = new Set(value)
  const selectedLabels = resourceLabels(value)
  const toggle = (id: ResourceId, checked: boolean) => {
    if (disabled) return
    const next = new Set(value)
    if (checked) next.add(id)
    else next.delete(id)
    onChange(parseResources([...next]))
  }

  return <fieldset className="cf-resource-picker" disabled={disabled}>
    <legend>What can you train with?</legend>
    <div className="cf-resource-presets">{RESOURCE_PRESETS.map(preset => {
      const active = selected.size === preset.resources.length && preset.resources.every(id => selected.has(id))
      return <button type="button" key={preset.label} disabled={disabled} aria-pressed={active} onClick={() => {
        if (!disabled && !active) onChange([...preset.resources])
      }}>
        <strong>{preset.label}</strong>
        <span>{preset.resources.length ? `${preset.resources.length} items` : 'Bodyweight'}</span>
      </button>
    })}</div>
    <p className="cf-resource-help">Presets replace your selection. Bodyweight is always included.</p>
    <p className="cf-resource-summary" role="status" aria-atomic="true">
      <strong>Selected:</strong> Bodyweight{selectedLabels.length ? ` · ${selectedLabels.join(' · ')}` : ' only'}
    </p>
    <details className="cf-resource-details">
      <summary>Choose individual equipment & spaces</summary>
      <p className="cf-resource-help">Tick only what you can use. Racks, benches, pull-up bars and cardio machines are separate choices.</p>
      <div className="cf-resource-groups">{groups.map(group => <fieldset key={group.id} className="cf-resource-group">
        <legend>{group.label}</legend>
        <div className="cf-resource-options">{RESOURCE_CATALOG.filter(resource => resource.group === group.id).map(resource =>
          <label key={resource.id} className="cf-resource-option">
            <input type="checkbox" value={resource.id} checked={selected.has(resource.id)} disabled={disabled}
              onChange={event => toggle(resource.id, event.currentTarget.checked)} />
            <span>{resource.label}</span>
          </label>)}</div>
      </fieldset>)}</div>
    </details>
  </fieldset>
}

export default EquipmentPicker
