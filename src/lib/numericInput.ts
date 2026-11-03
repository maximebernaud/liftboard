import { parseOneRepMax } from '../data/personalRecords.ts'
import { decimalParts, parseIntensity } from './loadCalculator.ts'
import { parseRepetitions } from './workoutDraft.ts'
import { parseExecutionLoad, parseExecutionReps } from './workoutExecution.ts'

export type NumericField = 'record' | 'intensity' | 'reps' | 'execution-reps' | 'execution-load'
const parsers = {
  record: parseOneRepMax, intensity: parseIntensity, reps: parseRepetitions,
  'execution-reps': parseExecutionReps, 'execution-load': parseExecutionLoad,
}

/** null : saisie incomplète/invalide ; valeur inchangée : borne atteinte. */
export function stepNumericInput(input: string, field: NumericField, direction: 1 | -1): string | null {
  if (/[.,]$/.test(input.trim())) return null
  const value = parsers[field](input)
  if (value === null) return null

  // Réutiliser les décimales entières du calculateur évite 70,1 + 0,5 = 70,599…
  const { coefficient, scale } = decimalParts(value)
  const precision = Math.max(scale, 1)
  const units = coefficient * 10n ** BigInt(precision - scale)
  const integerField = field === 'reps' || field === 'execution-reps'
  const step = integerField ? 10n ** BigInt(precision) : 5n * 10n ** BigInt(precision - 1)
  const nextUnits = units + BigInt(direction) * step
  if (field === 'execution-load' && nextUnits > BigInt(Number.MAX_SAFE_INTEGER) * 10n ** BigInt(precision)) return input
  let next = Number(`${nextUnits}e-${precision}`)
  if (field === 'execution-load' && Number.isFinite(next) && next > 0) {
    const decimal = decimalParts(next)
    if (decimal.coefficient * 10n ** BigInt(precision) !== nextUnits * 10n ** BigInt(decimal.scale)) return input
  }
  if (field === 'intensity') next = Math.min(100, Math.max(1, next))
  // Pas de minimum artificiel pour un 1RM, ni de dépassement de la précision JS.
  if (!Number.isFinite(next) || next <= 0 || (integerField && !Number.isSafeInteger(next)) || next === value) return input
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
