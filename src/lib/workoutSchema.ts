import { isExerciseId } from '../data/exercises.ts'
import { roundLoadDirected } from './loadCalculator.ts'
import { isValidWorkoutDate, isWorkoutSetRounding } from './workoutDraft.ts'
import { isWorkoutSetExecution } from './workoutExecution.ts'
import { calculateWorkoutLoad, isPositiveSafeInteger, isPositiveSafeLoad } from './workoutProgramming.ts'
import type {
  DurationExecution, LegacyWorkoutSet, LoadPlan, LoadRepsExecution, ReferenceSnapshot, RepsExecution,
  StoredWorkout, Workout, WorkoutNotes, WorkoutSetV2, AppWorkout, AppWorkoutSet,
} from '../types/workout.ts'

// La structure V1 garde sa tolérance historique aux propriétés supplémentaires.
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const identifier = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const strictObject = (value: unknown): value is Record<string, unknown> => object(value) && !Array.isArray(value)
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key))

export function isWorkoutNotes(value: unknown): value is WorkoutNotes {
  return object(value) && typeof value.before === 'string' && typeof value.during === 'string' && typeof value.after === 'string'
}

export function isLegacyWorkoutSet(value: unknown): value is LegacyWorkoutSet {
  // Les discriminants/champs E2 ne peuvent pas contourner leur contrat en omettant
  // schemaVersion. Les métadonnées historiques étrangères restent tolérées.
  if (!object(value) || 'schemaVersion' in value || 'kind' in value || 'loading' in value || 'durationSeconds' in value ||
    !identifier(value.id) || typeof value.reps !== 'number' ||
    !Number.isSafeInteger(value.reps) || value.reps <= 0 || typeof value.intensityPct !== 'number' ||
    !Number.isFinite(value.intensityPct) || value.intensityPct < 1 || value.intensityPct > 100 ||
    !isWorkoutSetRounding(value.rounding) ||
    ('execution' in value && !isWorkoutSetExecution(value.execution))) return false
  if (value.load === null) return true
  if (!object(value.load) || typeof value.load.exactKg !== 'number' || !Number.isFinite(value.load.exactKg) ||
    value.load.exactKg <= 0 || typeof value.load.selectedKg !== 'number' || !Number.isFinite(value.load.selectedKg) ||
    value.load.selectedKg < 0) return false
  const selected = value.rounding.mode === 'exact' ? value.load.exactKg
    : roundLoadDirected(value.load.exactKg, value.rounding.increment, value.rounding.mode)
  return selected === value.load.selectedKg
}

export function isReferenceSnapshot(value: unknown): value is ReferenceSnapshot {
  return strictObject(value) && onlyKeys(value, ['source', 'exerciseId', 'exerciseName', 'oneRepMaxKg']) &&
    value.source === 'record' && isExerciseId(value.exerciseId) && identifier(value.exerciseName) &&
    typeof value.oneRepMaxKg === 'number' && Number.isFinite(value.oneRepMaxKg) && value.oneRepMaxKg > 0
}

export function isLoadPlan(value: unknown): value is LoadPlan {
  if (!strictObject(value)) return false
  if (value.method === 'manual') return onlyKeys(value, ['method', 'loadKg']) && isPositiveSafeLoad(value.loadKg)
  if (value.method !== 'percentage' || !onlyKeys(value, ['method', 'intensityPct', 'rounding', 'reference', 'load']) ||
    typeof value.intensityPct !== 'number' || !isReferenceSnapshot(value.reference) ||
    !strictObject(value.rounding) || !isWorkoutSetRounding(value.rounding) ||
    !onlyKeys(value.rounding, value.rounding.mode === 'exact' ? ['mode'] : ['mode', 'increment']) ||
    !strictObject(value.load) || !onlyKeys(value.load, ['exactKg', 'selectedKg'])) return false
  const result = calculateWorkoutLoad(value.reference.oneRepMaxKg, value.intensityPct, value.rounding)
  return result.status === 'ready' && value.load.exactKg === result.load.exactKg && value.load.selectedKg === result.load.selectedKg
}

function isExecution(value: unknown, fields: readonly string[]): boolean {
  if (!strictObject(value) || !onlyKeys(value, ['completed', ...fields, 'cleared'])) return false
  const valid = (field: string) => field === 'loadKg' ? isPositiveSafeLoad(value[field]) : isPositiveSafeInteger(value[field])
  if (value.completed === true) return !('cleared' in value) && fields.every(valid)
  if (value.completed !== false || !fields.every((field) => value[field] === null || valid(field))) return false
  if (!('cleared' in value)) return true
  const cleared = value.cleared
  return strictObject(cleared) && Object.keys(cleared).length > 0 &&
    onlyKeys(cleared, fields) && Object.keys(cleared).every((field) => cleared[field] === true && value[field] === null)
}

export function isLoadRepsExecution(value: unknown): value is LoadRepsExecution {
  return isExecution(value, ['reps', 'loadKg'])
}

export function isRepsExecution(value: unknown): value is RepsExecution {
  return isExecution(value, ['reps'])
}

export function isDurationExecution(value: unknown): value is DurationExecution {
  return isExecution(value, ['durationSeconds'])
}

export function isWorkoutSetV2(value: unknown): value is WorkoutSetV2 {
  if (!strictObject(value) || value.schemaVersion !== 2 || !identifier(value.id)) return false
  const common = ['schemaVersion', 'id', 'kind', 'execution']
  switch (value.kind) {
    case 'load-reps': return onlyKeys(value, [...common, 'reps', 'loading']) && isPositiveSafeInteger(value.reps) &&
      (value.loading === null || isLoadPlan(value.loading)) &&
      (!('execution' in value) || isLoadRepsExecution(value.execution))
    case 'reps': return onlyKeys(value, [...common, 'reps']) && isPositiveSafeInteger(value.reps) &&
      (!('execution' in value) || isRepsExecution(value.execution))
    case 'duration': return onlyKeys(value, [...common, 'durationSeconds']) && isPositiveSafeInteger(value.durationSeconds) &&
      (!('execution' in value) || isDurationExecution(value.execution))
    default: return false
  }
}

export function isStoredWorkoutSet(value: unknown): value is LegacyWorkoutSet | WorkoutSetV2 {
  return object(value) && ('schemaVersion' in value ? isWorkoutSetV2(value) : isLegacyWorkoutSet(value))
}

function workoutStructure(value: unknown, validSet: (set: unknown) => boolean): boolean {
  if (!object(value) || !identifier(value.id) || typeof value.title !== 'string' || !value.title.trim() ||
    typeof value.date !== 'string' || !isValidWorkoutDate(value.date) ||
    (value.status !== 'planned' && value.status !== 'completed') || !isWorkoutNotes(value.notes) ||
    !Array.isArray(value.exercises) || !value.exercises.length) return false
  const ids = new Set<string>([value.id])
  const uniqueId = (id: unknown): boolean => {
    if (!identifier(id) || ids.has(id)) return false
    ids.add(id)
    return true
  }
  return value.exercises.every((block: unknown) => {
    if (!object(block) || !uniqueId(block.id) || !isExerciseId(block.exerciseId) ||
      !Array.isArray(block.sets) || !block.sets.length) return false
    return block.sets.every((set: unknown) => {
      if (!object(set) || !uniqueId(set.id) || !validSet(set)) return false
      return true
    })
  })
}

export function isLegacyWorkout(value: unknown): value is Workout {
  return workoutStructure(value, isLegacyWorkoutSet)
}

/** Les trois suivis peuvent coexister dans un même bloc. */
export function isStoredWorkout(value: unknown): value is StoredWorkout {
  return workoutStructure(value, isStoredWorkoutSet)
}

export function isStoredWorkouts(value: unknown): value is StoredWorkout[] {
  return Array.isArray(value) && value.every(isStoredWorkout) && new Set(value.map((item) => item.id)).size === value.length
}

export function isAppWorkoutSet(value: unknown): value is AppWorkoutSet {
  return isStoredWorkoutSet(value)
}

export function isAppWorkout(value: unknown): value is AppWorkout {
  return workoutStructure(value, isAppWorkoutSet)
}
