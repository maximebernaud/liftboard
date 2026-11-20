import type { AppSetExecution, AppWorkoutSet } from '../types/workout.ts'
import { isDurationExecution, isLoadRepsExecution, isRepsExecution } from './workoutSchema.ts'
import {
  confirmSetExecution, executionInputs, executionNumberInput, hasPendingExecutionInputs,
  isWorkoutSetExecution, isWritableExecution, parseExecutionLoad, parseExecutionReps,
  partialSetExecution, requiresExecutionCorrection,
} from './workoutExecution.ts'
import { plannedSetLoad } from './workoutPresentation.ts'
import { isPositiveSafeInteger } from './workoutProgramming.ts'

// Les champs inactifs ne servent qu'au formulaire ; les producteurs ci-dessous
// construisent explicitement le résultat de la seule branche déclarée.
export type SetExecutionInputs = { reps: string | null; loadKg: string | null; durationSeconds: string | null }
export type SetExecutionField = keyof SetExecutionInputs
export const parseSetExecutionField = (field: SetExecutionField, input: string): number | null =>
  field === 'loadKg' ? parseExecutionLoad(input) : parseExecutionReps(input)

export function setExecutionFields(set: AppWorkoutSet): readonly SetExecutionField[] {
  if (set.schemaVersion === 2 && set.kind === 'duration') return ['durationSeconds']
  if (set.schemaVersion === 2 && set.kind === 'reps') return ['reps']
  return ['reps', 'loadKg']
}

export function plannedExecutionValue(set: AppWorkoutSet, field: SetExecutionField): number | null {
  if (set.schemaVersion === 2 && set.kind === 'duration') return field === 'durationSeconds' ? set.durationSeconds : null
  if (field === 'reps') return set.reps
  return field === 'loadKg' ? plannedSetLoad(set)?.selectedKg ?? null : null
}

export function appExecutionInputs(set: AppWorkoutSet): SetExecutionInputs {
  const inputs: SetExecutionInputs = { reps: null, loadKg: null, durationSeconds: null }
  if (set.schemaVersion !== 2 || set.kind === 'load-reps') return { ...inputs, ...executionInputs(set.execution) }
  if (set.kind === 'duration') {
    const execution = set.execution
    inputs.durationSeconds = execution?.durationSeconds == null
      ? execution?.completed === false && execution.cleared?.durationSeconds ? '' : null
      : executionNumberInput(execution.durationSeconds)
  } else {
    const execution = set.execution
    inputs.reps = execution?.reps == null
      ? execution?.completed === false && execution.cleared?.reps ? '' : null
      : executionNumberInput(execution.reps)
  }
  return inputs
}

/** Valider contre le discriminant avant d'associer une exécution à une série. */
export function withSetExecution(set: AppWorkoutSet, execution: unknown, creating = false): AppWorkoutSet | null {
  if (set.schemaVersion !== 2) return isWorkoutSetExecution(execution) && isWritableExecution(execution, creating ? undefined : set.execution)
    ? { ...set, execution: structuredClone(execution) } : null
  switch (set.kind) {
    case 'load-reps': return isLoadRepsExecution(execution) ? { ...set, execution: structuredClone(execution) } : null
    case 'reps': return isRepsExecution(execution) ? { ...set, execution: structuredClone(execution) } : null
    case 'duration': return isDurationExecution(execution) ? { ...set, execution: structuredClone(execution) } : null
  }
}

export function requiresSetExecutionCorrection(set: AppWorkoutSet): boolean {
  if (set.schemaVersion !== 2 || set.kind === 'load-reps') return requiresExecutionCorrection(set.execution)
  return set.execution !== undefined && !(set.kind === 'reps' ? isRepsExecution(set.execution) : isDurationExecution(set.execution))
}

export function confirmAppSetExecution(set: AppWorkoutSet, inputs: SetExecutionInputs): {
  execution: AppSetExecution | null; errors: Partial<Record<SetExecutionField, string>>
} {
  if (set.schemaVersion !== 2 || set.kind === 'load-reps') return confirmSetExecution(set, inputs)
  if (set.kind === 'reps') {
    const reps = inputs.reps === null ? set.reps : parseExecutionReps(inputs.reps)
    return !isPositiveSafeInteger(reps)
      ? { execution: null, errors: { reps: 'Renseignez un nombre entier de répétitions strictement positif.' } }
      : { execution: { completed: true, reps }, errors: {} }
  }
  const durationSeconds = inputs.durationSeconds === null ? set.durationSeconds : parseExecutionReps(inputs.durationSeconds)
  return !isPositiveSafeInteger(durationSeconds)
    ? { execution: null, errors: { durationSeconds: 'Renseignez un nombre entier de secondes strictement positif.' } }
    : { execution: { completed: true, durationSeconds }, errors: {} }
}

/** Un texte invalide reste en mémoire ; aucune confirmation implicite. */
export function partialAppSetExecution(set: AppWorkoutSet, inputs: SetExecutionInputs): AppSetExecution {
  if (set.schemaVersion !== 2 || set.kind === 'load-reps') return partialSetExecution(inputs, set.execution)
  if (set.kind === 'reps') {
    const raw = inputs.reps, saved = set.execution
    const reps = raw === null ? saved?.reps ?? null : raw.trim() ? parseExecutionReps(raw) ?? saved?.reps ?? null : null
    const cleared = (raw !== null && !raw.trim()) || (reps === null && saved?.completed === false && saved.cleared?.reps)
    return { completed: false, reps, ...(cleared ? { cleared: { reps: true } } : {}) }
  }
  const raw = inputs.durationSeconds, saved = set.execution
  const durationSeconds = raw === null ? saved?.durationSeconds ?? null : raw.trim()
    ? parseExecutionReps(raw) ?? saved?.durationSeconds ?? null : null
  const cleared = (raw !== null && !raw.trim()) || (durationSeconds === null && saved?.completed === false && saved.cleared?.durationSeconds)
  return { completed: false, durationSeconds, ...(cleared ? { cleared: { durationSeconds: true } } : {}) }
}

export function hasPendingAppExecutionInputs(set: AppWorkoutSet, inputs: SetExecutionInputs): boolean {
  if (set.schemaVersion !== 2 || set.kind === 'load-reps') return hasPendingExecutionInputs(inputs, set.execution)
  const previous = appExecutionInputs(set)
  return setExecutionFields(set).some((field) => {
    const raw = inputs[field], saved = previous[field]
    if (raw === null || raw === '') return raw !== saved
    const parsed = parseExecutionReps(raw)
    return parsed === null || saved === null || saved === '' || parsed !== parseExecutionReps(saved)
  })
}
