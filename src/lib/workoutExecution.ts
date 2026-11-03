import { decimalParts } from './loadCalculator.ts'
import type { Workout, WorkoutSet, WorkoutSetExecution } from '../types/workout.ts'

// null = champ intact, '' = effacement volontaire, autre texte = saisie réelle.
export type ExecutionInputs = { reps: string | null; loadKg: string | null }

export function executionNumberInput(value: number | null | undefined): string {
  if (value == null) return ''
  const { coefficient, scale } = decimalParts(value)
  const digits = String(coefficient).padStart(scale + 1, '0')
  return scale === 0 ? digits : `${digits.slice(0, -scale)},${digits.slice(-scale)}`
}

export function executionInputs(execution: WorkoutSetExecution | undefined): ExecutionInputs {
  const field = (key: keyof ExecutionInputs) => execution?.[key] == null
    ? execution?.cleared?.[key] ? '' : null
    : executionNumberInput(execution[key])
  return { reps: field('reps'), loadKg: field('loadKg') }
}

// Compatibilité de lecture : les anciens zéros restent accessibles et corrigeables.
const readableReps = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const readableLoad = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
const validReps = (value: unknown): value is number => readableReps(value) && value > 0
const validLoad = (value: unknown): value is number => readableLoad(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER

export function isWorkoutSetExecution(value: unknown): value is WorkoutSetExecution {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  if (Object.keys(data).some((key) => !['completed', 'reps', 'loadKg', 'cleared'].includes(key))) return false
  if ('cleared' in data) {
    if (typeof data.cleared !== 'object' || data.cleared === null || Array.isArray(data.cleared)) return false
    const cleared = data.cleared as Record<string, unknown>
    if (!Object.keys(cleared).length || Object.keys(cleared).some((key) =>
      !['reps', 'loadKg'].includes(key) || cleared[key] !== true || data[key] !== null)) return false
  }
  if (data.completed === true) return readableReps(data.reps) && readableLoad(data.loadKg)
  return data.completed === false && (data.reps === null || readableReps(data.reps)) &&
    (data.loadKg === null || readableLoad(data.loadKg))
}

export function requiresExecutionCorrection(execution: WorkoutSetExecution | undefined): boolean {
  return Boolean(execution && ((execution.reps !== null && !validReps(execution.reps)) ||
    (execution.loadKg !== null && !validLoad(execution.loadKg))))
}

export function isWritableExecution(value: WorkoutSetExecution, previous?: WorkoutSetExecution): boolean {
  if (!isWorkoutSetExecution(value)) return false
  if (value.completed) return validReps(value.reps) && validLoad(value.loadKg)
  // Une annulation ou une saisie partielle peut conserver un ancien zéro inchangé.
  return (value.reps === null || validReps(value.reps) || value.reps === previous?.reps) &&
    (value.loadKg === null || validLoad(value.loadKg) || value.loadKg === previous?.loadKg)
}

export function parseExecutionReps(input: string): number | null {
  if (!/^\d+$/.test(input.trim())) return null
  const value = Number(input.trim())
  return validReps(value) ? value : null
}

export function parseExecutionLoad(input: string): number | null {
  if (!/^\d+(?:[.,]\d+)?$/.test(input.trim())) return null
  const [integer, fraction = ''] = input.trim().split(/[.,]/)
  const maximum = BigInt(Number.MAX_SAFE_INTEGER)
  if (BigInt(integer) > maximum || (BigInt(integer) === maximum && /[1-9]/.test(fraction))) return null
  const value = Number(input.trim().replace(',', '.'))
  if (!validLoad(value)) return null
  const decimal = decimalParts(value)
  // La saisie doit garder ses décimales après conversion vers un nombre JS.
  return BigInt(integer + fraction) * 10n ** BigInt(decimal.scale) ===
    decimal.coefficient * 10n ** BigInt(fraction.length) ? value : null
}

export function confirmSetExecution(
  set: WorkoutSet,
  inputs: ExecutionInputs,
): { execution: WorkoutSetExecution | null; errors: Partial<Record<keyof ExecutionInputs, string>> } {
  const reps = inputs.reps === null ? set.reps : parseExecutionReps(inputs.reps)
  const loadKg = inputs.loadKg === null ? set.load?.selectedKg ?? null : parseExecutionLoad(inputs.loadKg)
  const errors: Partial<Record<keyof ExecutionInputs, string>> = {}
  if (!validReps(reps)) errors.reps = 'Renseignez un nombre entier de répétitions strictement positif.'
  if (!validLoad(loadKg)) errors.loadKg = 'Renseignez la charge réellement soulevée, strictement positive et dans les limites numériques sûres.'
  return { execution: validReps(reps) && validLoad(loadKg) ? { completed: true, reps, loadKg } : null, errors }
}

/** Sauver les champs valides sans convertir le texte invalide en résultat. */
export function partialSetExecution(inputs: ExecutionInputs, saved: WorkoutSetExecution | undefined): WorkoutSetExecution {
  const execution: WorkoutSetExecution = { completed: false, reps: null, loadKg: null }
  const cleared: NonNullable<WorkoutSetExecution['cleared']> = {}
  for (const field of ['reps', 'loadKg'] as const) {
    const raw = inputs[field]
    const parse = field === 'reps' ? parseExecutionReps : parseExecutionLoad
    if (raw !== null && !raw.trim()) {
      cleared[field] = true
    } else {
      execution[field] = raw === null ? saved?.[field] ?? null : parse(raw) ?? saved?.[field] ?? null
      if (execution[field] === null && saved?.cleared?.[field]) cleared[field] = true
    }
  }
  if (Object.keys(cleared).length) execution.cleared = cleared
  return execution
}

export function hasPendingExecutionInputs(inputs: ExecutionInputs, saved: WorkoutSetExecution | undefined): boolean {
  return (['reps', 'loadKg'] as const).some((field) => {
    const raw = inputs[field]
    const previous = saved?.[field] ?? null
    if (raw === null) return previous !== null
    if (!raw.trim()) return previous !== null || !saved?.cleared?.[field]
    const parsed = field === 'reps' ? parseExecutionReps(raw) : parseExecutionLoad(raw)
    // Un ancien zéro affiché n'est pas une nouvelle saisie non enregistrée.
    return parsed === null ? raw !== executionNumberInput(previous) : parsed !== previous
  })
}

export function hasWorkoutExecution(workout: Workout): boolean {
  return workout.exercises.some((block) => block.sets.some((set) => set.execution !== undefined))
}

export function getWorkoutProgress(workout: Workout): { completed: number; total: number } {
  const sets = workout.exercises.flatMap((block) => block.sets)
  return { completed: sets.filter((set) => set.execution?.completed === true).length, total: sets.length }
}

export function sameExecution(left: WorkoutSetExecution | undefined, right: WorkoutSetExecution | undefined): boolean {
  return left?.completed === right?.completed && left?.reps === right?.reps && left?.loadKg === right?.loadKg &&
    left?.cleared?.reps === right?.cleared?.reps && left?.cleared?.loadKg === right?.cleared?.loadKg
}

// Ignorer les notes et les autres résultats ; comparer toute la programmation.
export function workoutProgramSignature(workout: Workout): string {
  return JSON.stringify([
    workout.id, workout.title, workout.date, workout.status,
    workout.exercises.map((block) => [block.id, block.exerciseId, block.sets.map((set) => [
      set.id, set.reps, set.intensityPct, set.rounding.mode,
      set.rounding.mode === 'exact' ? null : set.rounding.increment,
      set.load?.exactKg ?? null, set.load?.selectedKg ?? null,
    ])]),
  ])
}
