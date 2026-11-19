import { sameExecution } from './workoutExecution.ts'
import type { StoredWorkout, StoredWorkoutSet } from '../types/workout.ts'

/** Comparer les résultats selon leur série, sans les confondre avec la programmation. */
export function sameStoredSetExecution(left: StoredWorkoutSet, right: StoredWorkoutSet): boolean {
  if (left.schemaVersion !== right.schemaVersion) return false
  if (left.schemaVersion !== 2 && right.schemaVersion !== 2) return sameExecution(left.execution, right.execution)
  if (left.schemaVersion !== 2 || right.schemaVersion !== 2 || left.kind !== right.kind) return false
  if (!left.execution || !right.execution) return left.execution === right.execution
  if (left.execution.completed !== right.execution.completed) return false
  if (left.kind === 'load-reps' && right.kind === 'load-reps') {
    const leftCleared = left.execution.completed === false ? left.execution.cleared : undefined
    const rightCleared = right.execution.completed === false ? right.execution.cleared : undefined
    return left.execution.reps === right.execution.reps && left.execution.loadKg === right.execution.loadKg &&
      leftCleared?.reps === rightCleared?.reps && leftCleared?.loadKg === rightCleared?.loadKg
  }
  if (left.kind === 'reps' && right.kind === 'reps') {
    const leftCleared = left.execution.completed === false ? left.execution.cleared : undefined
    const rightCleared = right.execution.completed === false ? right.execution.cleared : undefined
    return left.execution.reps === right.execution.reps && leftCleared?.reps === rightCleared?.reps
  }
  if (left.kind === 'duration' && right.kind === 'duration') {
    const leftCleared = left.execution.completed === false ? left.execution.cleared : undefined
    const rightCleared = right.execution.completed === false ? right.execution.cleared : undefined
    return left.execution.durationSeconds === right.execution.durationSeconds &&
      leftCleared?.durationSeconds === rightCleared?.durationSeconds
  }
  return false
}

function setProgram(set: StoredWorkoutSet): unknown[] {
  if (set.schemaVersion !== 2) return [
    set.id, set.reps, set.intensityPct, set.rounding.mode,
    set.rounding.mode === 'exact' ? null : set.rounding.increment,
    set.load?.exactKg ?? null, set.load?.selectedKg ?? null,
  ]
  if (set.kind === 'duration') return [2, set.kind, set.id, set.durationSeconds]
  if (set.kind === 'reps') return [2, set.kind, set.id, set.reps]
  const plan = set.loading
  const loading = plan === null ? null : plan.method === 'manual' ? ['manual', plan.loadKg] : [
    'percentage', plan.intensityPct, plan.rounding.mode,
    plan.rounding.mode === 'exact' ? null : plan.rounding.increment,
    plan.reference.source, plan.reference.exerciseId, plan.reference.exerciseName, plan.reference.oneRepMaxKg,
    plan.load.exactKg, plan.load.selectedKg,
  ]
  return [2, set.kind, set.id, set.reps, loading]
}

/** Même signature que V1 pour une séance historique ; aucune note ni performance. */
export function storedWorkoutProgramSignature(workout: StoredWorkout): string {
  return JSON.stringify([
    workout.id, workout.title, workout.date, workout.status,
    workout.exercises.map((block) => [block.id, block.exerciseId, block.sets.map(setProgram)]),
  ])
}

export function hasStoredWorkoutExecution(workout: StoredWorkout): boolean {
  return workout.exercises.some((block) => block.sets.some((set) => set.execution !== undefined))
}
