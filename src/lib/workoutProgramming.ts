import { calculateExactPercentageLoad, decimalParts, roundLoadDirected } from './loadCalculator.ts'
import { isWorkoutSetRounding } from './workoutDraft.ts'
import { parseExecutionLoad } from './workoutExecution.ts'
import type { WorkoutLoad, WorkoutSetRounding } from '../types/workout.ts'

// Politique E2 uniquement : ni le Calculateur ni les séries historiques ne l'utilisent.
export const maxWorkoutIntensityPct = 300
export type DurationUnit = 'seconds' | 'minutes'
export type WorkoutLoadCalculation =
  | { status: 'ready'; load: WorkoutLoad }
  | { status: 'invalid-input' | 'missing-record' | 'unavailable' }

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function isPositiveSafeLoad(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER
}

export function isWorkoutIntensityV2(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= maxWorkoutIntensityPct
}

export function parseWorkoutIntensityV2(input: string): number | null {
  // Le parseur de kg vérifie déjà la syntaxe décimale et l'absence de perte de chiffres.
  const value = parseExecutionLoad(input)
  return isWorkoutIntensityV2(value) ? value : null
}

/** Calcule une nouvelle charge ; ne relit aucun Record et ne modifie aucun snapshot. */
export function calculateWorkoutLoad(
  oneRepMaxKg: number | undefined,
  intensityPct: number,
  rounding: WorkoutSetRounding,
): WorkoutLoadCalculation {
  if (!isWorkoutIntensityV2(intensityPct) || !isWorkoutSetRounding(rounding)) return { status: 'invalid-input' }
  if (oneRepMaxKg === undefined) return { status: 'missing-record' }
  if (!Number.isFinite(oneRepMaxKg) || oneRepMaxKg <= 0) return { status: 'unavailable' }
  const exactKg = calculateExactPercentageLoad(oneRepMaxKg, intensityPct)
  if (!isPositiveSafeLoad(exactKg)) return { status: 'unavailable' }
  const selectedKg = rounding.mode === 'exact' ? exactKg : roundLoadDirected(exactKg, rounding.increment, rounding.mode)
  return Number.isFinite(selectedKg) && selectedKg >= 0 && selectedKg <= Number.MAX_SAFE_INTEGER
    ? { status: 'ready', load: { exactKg, selectedKg } }
    : { status: 'unavailable' }
}

function wholeSeconds(coefficient: bigint, scale: number, unit: DurationUnit): number | null {
  if (unit !== 'seconds' && unit !== 'minutes') return null
  const numerator = coefficient * (unit === 'minutes' ? 60n : 1n)
  const denominator = 10n ** BigInt(scale)
  if (numerator <= 0n || numerator % denominator !== 0n) return null
  const seconds = numerator / denominator
  return seconds <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(seconds) : null
}

export function durationToSeconds(value: number, unit: DurationUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  const { coefficient, scale } = decimalParts(value)
  return wholeSeconds(coefficient, scale, unit)
}

/** Convertir le texte avant Number empêche une fraction d'être arrondie en seconde entière. */
export function parseDurationSeconds(input: string, unit: DurationUnit): number | null {
  const trimmed = input.trim()
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(trimmed)) return null
  const [integer, fraction = ''] = trimmed.split(/[.,]/)
  return wholeSeconds(BigInt(integer + fraction), fraction.length, unit)
}
