export interface StructuredMetricFieldDefinition {
  readonly key: string
  readonly aliases: readonly string[]
  readonly label: string
  readonly description: string
  readonly placeholder?: string
}

export interface StructuredMetricFieldState extends StructuredMetricFieldDefinition {
  readonly value: string
}

export interface StructuredMetricModel {
  readonly definitions: readonly StructuredMetricFieldDefinition[]
  readonly fields: readonly StructuredMetricFieldState[]
  readonly values: Readonly<Record<string, string>>
  readonly rawKeyByField: Readonly<Record<string, string | undefined>>
  readonly linePresentByField: Readonly<Record<string, boolean>>
  readonly primaryOrder: readonly string[]
  readonly advancedText: string
  readonly hasAdvancedContent: boolean
  readonly advancedLineCount: number
}

export const workoutActualMetricFields = [
  {
    key: 'durationMin',
    aliases: ['duration'],
    label: 'Total duration',
    description: 'Minutes for the full session.',
    placeholder: '45',
  },
  {
    key: 'movingTimeMin',
    aliases: ['movingtime'],
    label: 'Moving time',
    description: 'Minutes spent moving.',
    placeholder: '42',
  },
  {
    key: 'elapsedTimeMin',
    aliases: ['elapsedtime'],
    label: 'Elapsed time',
    description: 'Minutes including stops.',
    placeholder: '50',
  },
  {
    key: 'distanceMeters',
    aliases: ['distance'],
    label: 'Distance',
    description: 'Meters covered.',
    placeholder: '5000',
  },
  {
    key: 'paceSecondsPerKm',
    aliases: ['pace'],
    label: 'Average pace',
    description: 'Use M:SS/km or H:MM:SS/km.',
    placeholder: '5:15/km',
  },
  {
    key: 'averageHeartRate',
    aliases: ['heartrate', 'averagehr', 'hr'],
    label: 'Average heart rate',
    description: 'Average beats per minute.',
    placeholder: '148',
  },
] as const satisfies readonly StructuredMetricFieldDefinition[]

export const workoutStepActualFields = [
  {
    key: 'sets',
    aliases: [],
    label: 'Sets',
    description: 'Completed sets.',
    placeholder: '4',
  },
  {
    key: 'reps',
    aliases: [],
    label: 'Reps',
    description: 'Completed reps.',
    placeholder: '8',
  },
  {
    key: 'minutes',
    aliases: ['durationmin', 'durationminutes'],
    label: 'Duration in minutes',
    description: 'Minutes completed for this step.',
    placeholder: '20',
  },
  {
    key: 'seconds',
    aliases: ['durationseconds'],
    label: 'Duration in seconds',
    description: 'Seconds completed for this step.',
    placeholder: '90',
  },
  {
    key: 'distanceMeters',
    aliases: ['distance'],
    label: 'Distance',
    description: 'Meters completed for this step.',
    placeholder: '1600',
  },
  {
    key: 'paceSecondsPerKm',
    aliases: ['pace'],
    label: 'Pace',
    description: 'Use M:SS/km or H:MM:SS/km.',
    placeholder: '4:20/km',
  },
  {
    key: 'loadKg',
    aliases: ['load'],
    label: 'Load',
    description: 'Kilograms used.',
    placeholder: '24',
  },
] as const satisfies readonly StructuredMetricFieldDefinition[]

function normalizeStructuredKey(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

function splitLines(text: string): string[] {
  return text === '' ? [] : text.split(/\r?\n/)
}

function hasValue(value: string): boolean {
  return value.trim().length > 0
}

function formatLine(key: string, value: string): string {
  return value === '' ? `${key}:` : `${key}: ${value}`
}

export function parseStructuredMetricText(
  text: string,
  definitions: readonly StructuredMetricFieldDefinition[],
): StructuredMetricModel {
  const definitionByAlias = new Map<string, StructuredMetricFieldDefinition>()
  const values: Record<string, string> = {}
  const rawKeyByField: Record<string, string | undefined> = {}
  const linePresentByField: Record<string, boolean> = {}

  for (const definition of definitions) {
    definitionByAlias.set(normalizeStructuredKey(definition.key), definition)
    for (const alias of definition.aliases) definitionByAlias.set(normalizeStructuredKey(alias), definition)
    values[definition.key] = ''
    rawKeyByField[definition.key] = undefined
    linePresentByField[definition.key] = false
  }

  const primaryOrder: string[] = []
  const advancedLines: string[] = []

  for (const rawLine of splitLines(text)) {
    const separatorIndex = rawLine.indexOf(':')
    if (separatorIndex <= 0) {
      advancedLines.push(rawLine)
      continue
    }
    const rawKey = rawLine.slice(0, separatorIndex).trim()
    const definition = definitionByAlias.get(normalizeStructuredKey(rawKey))
    if (!definition || linePresentByField[definition.key]) {
      advancedLines.push(rawLine)
      continue
    }
    values[definition.key] = rawLine.slice(separatorIndex + 1).trim()
    rawKeyByField[definition.key] = rawKey
    linePresentByField[definition.key] = true
    primaryOrder.push(definition.key)
  }

  const advancedText = advancedLines.join('\n')
  return {
    definitions,
    fields: definitions.map(definition => ({
      ...definition,
      value: values[definition.key] ?? '',
    })),
    values,
    rawKeyByField,
    linePresentByField,
    primaryOrder,
    advancedText,
    hasAdvancedContent: advancedText !== '',
    advancedLineCount: splitLines(advancedText).filter(line => line.trim().length > 0).length,
  }
}

interface StructuredMetricSerializationOptions {
  readonly values?: Readonly<Partial<Record<string, string>>>
  readonly advancedText?: string
  readonly removeKeys?: readonly string[]
}

export function serializeStructuredMetricText(
  model: StructuredMetricModel,
  options: StructuredMetricSerializationOptions = {},
): string {
  const nextValues: Record<string, string> = {}
  for (const field of model.fields) {
    nextValues[field.key] = options.values?.[field.key] ?? model.values[field.key] ?? ''
  }

  const removed = new Set(options.removeKeys ?? [])
  const renderedKeys = new Set<string>()
  const lines: string[] = []

  const renderFieldLine = (key: string) => {
    if (renderedKeys.has(key) || removed.has(key)) return
    const value = nextValues[key] ?? ''
    const wasPresent = model.linePresentByField[key] ?? false
    if (!hasValue(value) && !wasPresent) return
    lines.push(formatLine(model.rawKeyByField[key] ?? key, value))
    renderedKeys.add(key)
  }

  for (const key of model.primaryOrder) renderFieldLine(key)
  for (const field of model.fields) renderFieldLine(field.key)

  return [...lines, ...splitLines(options.advancedText ?? model.advancedText)].join('\n')
}

export function updateStructuredMetricField(
  model: StructuredMetricModel,
  key: string,
  value: string,
): string {
  return serializeStructuredMetricText(model, {
    values: { [key]: value },
    removeKeys: value.trim() ? [] : [key],
  })
}

export function updateStructuredMetricAdvancedText(
  model: StructuredMetricModel,
  advancedText: string,
): string {
  return serializeStructuredMetricText(model, { advancedText })
}
