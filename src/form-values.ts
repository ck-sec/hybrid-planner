export function numberFrom(form: FormData, key: string): number {
  const raw = form.get(key)
  if (typeof raw !== 'string' || !raw.trim()) throw new Error(`Enter your own value for ${key.replaceAll('_', ' ')}. Blank does not mean zero.`)
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`Enter a finite number for ${key.replaceAll('_', ' ')}.`)
  return value
}
