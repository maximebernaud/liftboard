import { parseOneRepMax } from '../data/personalRecords.ts'
import { decimalParts, parseIntensity } from './loadCalculator.ts'
import { parseRepetitions } from './workoutDraft.ts'

export type NumericField = 'record' | 'intensity' | 'reps'
const parsers = { record: parseOneRepMax, intensity: parseIntensity, reps: parseRepetitions }

/** null : saisie incomplète/invalide ; valeur inchangée : borne atteinte. */
export function stepNumericInput(input: string, field: NumericField, direction: 1 | -1): string | null {
  if (/[.,]$/.test(input.trim())) return null
  const value = parsers[field](input)
  if (value === null) return null

  // Réutiliser les décimales entières du calculateur évite 70,1 + 0,5 = 70,599…
  const { coefficient, scale } = decimalParts(value)
  const precision = Math.max(scale, 1)
  const units = coefficient * 10n ** BigInt(precision - scale)
  const step = field === 'reps' ? 10n ** BigInt(precision) : 5n * 10n ** BigInt(precision - 1)
  let next = Number(`${units + BigInt(direction) * step}e-${precision}`)
  if (field === 'intensity') next = Math.min(100, Math.max(1, next))
  // Pas de minimum artificiel pour un 1RM, ni de dépassement de la précision JS.
  if (!Number.isFinite(next) || next <= 0 || (field === 'reps' && !Number.isSafeInteger(next)) || next === value) return input
  return String(next).replace('.', input.includes('.') ? '.' : ',')
}

type ArrowEvent = Pick<KeyboardEvent, 'key' | 'preventDefault'> &
  Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'defaultPrevented'>>

export function handleNumericArrow(event: ArrowEvent, input: string, field: NumericField, onChange: (value: string) => void): void {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
    (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
  const next = stepNumericInput(input, field, event.key === 'ArrowUp' ? 1 : -1)
  if (next === null) return
  event.preventDefault()
  if (next !== input) onChange(next)
}
