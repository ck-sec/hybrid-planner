import { useState } from 'react'
import { customResourceId, MAX_CUSTOM_RESOURCES, parseResources, RESOURCE_CATALOG, RESOURCE_PRESETS, resourceLabels } from './equipment.ts'
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
] as const

function CustomEquipment({ value, onChange, disabled }: EquipmentPickerProps) {
  const [name, setName] = useState('')
  const [issue, setIssue] = useState('')
  const atLimit = value.filter(id => id.startsWith('custom:')).length >= MAX_CUSTOM_RESOURCES
  const add = () => {
    if (disabled || atLimit) return
    try {
      const id = customResourceId(name)
      if (value.includes(id)) throw new Error('That equipment is already selected.')
      onChange(parseResources([...value, id]))
      setName('')
      setIssue('')
    } catch (error) {
      setIssue(error instanceof Error ? error.message : 'Check the equipment name.')
    }
  }
  return <details className="cf-resource-details">
    <summary>Add other gear (optional)</summary>
    <div className="cf-custom-resource">
      <p className="cf-resource-help">Name any other equipment or space, such as a ball or mat. This records what you have; it does not add training or assume a safe exercise dose.</p>
      <label className="cf-field">Equipment name
        <input type="text" maxLength={120} value={name} placeholder="e.g. Ball or mat" disabled={disabled || atLimit}
          onChange={event => { setName(event.target.value); setIssue('') }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add() } }} />
      </label>
      <button className="cf-button cf-secondary" type="button" disabled={disabled || atLimit} onClick={add}>Add equipment</button>
      {atLimit && <p className="cf-resource-help" role="status">Up to {MAX_CUSTOM_RESOURCES} custom items. Remove one before adding another.</p>}
      {issue && <p className="cf-error" role="alert">{issue}</p>}
    </div>
  </details>
}

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
      <summary>Adjust strength &amp; cardio equipment (optional)</summary>
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
    <CustomEquipment value={value} onChange={onChange} disabled={disabled} />
    {value.some(id => !RESOURCE_CATALOG.some(resource => resource.id === id)) && <div className="cf-custom-resource-selected">
      {value.filter(id => !RESOURCE_CATALOG.some(resource => resource.id === id)).map(id => <div key={id}>
        <span>{resourceLabels([id])[0]}</span>
        <button type="button" className="cf-text-button" disabled={disabled} aria-label={`Remove ${resourceLabels([id])[0]}`}
          onClick={() => toggle(id, false)}>Remove</button>
      </div>)}
    </div>}
  </fieldset>
}

export default EquipmentPicker
