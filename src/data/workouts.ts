import { exercises } from './personalRecords.ts'
import { isValidWorkoutDate, isWorkoutSetRounding } from '../lib/workoutDraft.ts'
import { roundLoadDirected } from '../lib/loadCalculator.ts'
import { hasWorkoutExecution, isWorkoutSetExecution, isWritableExecution, sameExecution, workoutProgramSignature } from '../lib/workoutExecution.ts'
import type { Workout, WorkoutNotes, WorkoutNoteCategory, WorkoutSetExecution } from '../types/workout.ts'

export const workoutsStorageKey = 'liftboard.workouts.v1'
export type WorkoutStorage = Pick<Storage, 'getItem' | 'setItem'>
export type WorkoutsResult = { ok: true; workouts: Workout[] } | { ok: false; error: string }

const invalidData = 'Les séances stockées sont illisibles ou incompatibles. Elles sont conservées ; les écritures sont bloquées pour les protéger.'
const conflict = 'Cette séance a changé depuis son ouverture. Vos saisies sont conservées. Revenez aux séances puis rouvrez la version actuelle avant de modifier à nouveau.'
const fail = (error: string): WorkoutsResult => ({ ok: false, error })
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const identifier = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function isWorkoutNotes(value: unknown): value is WorkoutNotes {
  return object(value) && typeof value.before === 'string' && typeof value.during === 'string' && typeof value.after === 'string'
}

export function isWorkout(value: unknown): value is Workout {
  if (!object(value) || !identifier(value.id) || typeof value.title !== 'string' || !value.title.trim() ||
    typeof value.date !== 'string' || !isValidWorkoutDate(value.date) ||
    (value.status !== 'planned' && value.status !== 'completed') || !isWorkoutNotes(value.notes) ||
    !Array.isArray(value.exercises) || !value.exercises.length) return false

  const ids = new Set<string>([value.id])
  function uniqueId(id: unknown): boolean {
    if (!identifier(id) || ids.has(id)) return false
    ids.add(id)
    return true
  }
  return value.exercises.every((block: unknown) => {
    if (!object(block) || !uniqueId(block.id) || !exercises.some((item) => item.id === block.exerciseId) ||
      !Array.isArray(block.sets) || !block.sets.length) return false
    return block.sets.every((set: unknown) => {
      if (!object(set) || !uniqueId(set.id) || typeof set.reps !== 'number' ||
        !Number.isSafeInteger(set.reps) || set.reps <= 0 || typeof set.intensityPct !== 'number' ||
        !Number.isFinite(set.intensityPct) || set.intensityPct < 1 || set.intensityPct > 100 ||
        !isWorkoutSetRounding(set.rounding) ||
        ('execution' in set && !isWorkoutSetExecution(set.execution))) return false
      if (set.load === null) return true
      if (!object(set.load) || typeof set.load.exactKg !== 'number' || !Number.isFinite(set.load.exactKg) ||
        set.load.exactKg <= 0 || typeof set.load.selectedKg !== 'number' || !Number.isFinite(set.load.selectedKg) ||
        set.load.selectedKg < 0) return false
      const selected = set.rounding.mode === 'exact' ? set.load.exactKg
        : roundLoadDirected(set.load.exactKg, set.rounding.increment, set.rounding.mode)
      return selected === set.load.selectedKg
    })
  })
}

export function loadWorkouts(storage?: WorkoutStorage): WorkoutsResult {
  try {
    const raw = (storage ?? window.localStorage).getItem(workoutsStorageKey)
    if (raw === null) return { ok: true, workouts: [] }
    let data: unknown
    try { data = JSON.parse(raw) } catch { return fail(invalidData) }
    if (!Array.isArray(data) || !data.every(isWorkout) || new Set(data.map((item) => item.id)).size !== data.length) {
      return fail(invalidData)
    }
    return { ok: true, workouts: data }
  } catch {
    return fail('Impossible de lire les séances sur ce navigateur. Les données existantes sont conservées. Réessayez.')
  }
}

function writeWorkouts(workouts: Workout[], storage?: WorkoutStorage): WorkoutsResult {
  try {
    (storage ?? window.localStorage).setItem(workoutsStorageKey, JSON.stringify(workouts))
    return { ok: true, workouts }
  } catch (error) {
    return fail(error instanceof Error && error.name === 'QuotaExceededError'
      ? 'Stockage local plein. Aucune modification enregistrée. Vos saisies restent en mémoire ; libérez de l’espace puis réessayez.'
      : 'Impossible d’écrire dans le stockage local. Aucune modification enregistrée. Vos saisies restent en mémoire ; réessayez.')
  }
}

export function createWorkout(workout: Workout, storage?: WorkoutStorage): WorkoutsResult {
  if (!isWorkout(workout) || workout.status !== 'planned' || workout.exercises.some((block) =>
    block.sets.some((set) => set.execution && !isWritableExecution(set.execution)))) return fail('La séance est invalide et n’a pas été enregistrée.')
  const current = loadWorkouts(storage)
  if (!current.ok) return current
  if (current.workouts.some((item) => item.id === workout.id)) return fail('Cette séance existe déjà. Aucun doublon créé.')
  return writeWorkouts([...current.workouts, workout], storage)
}

// Les notes inchangées dans le formulaire suivent la dernière version stockée.
// Un même champ modifié dans deux versions est refusé plutôt qu'écrasé.
export function updateWorkout(workout: Workout, original: Workout, storage?: WorkoutStorage): WorkoutsResult {
  if (!isWorkout(workout) || !isWorkout(original) || workout.id !== original.id) return fail('La séance est invalide et n’a pas été enregistrée.')
  const current = loadWorkouts(storage)
  if (!current.ok) return current
  const latest = current.workouts.find((item) => item.id === workout.id)
  if (!latest) return fail('Cette séance n’existe plus. Vos saisies sont conservées en mémoire.')
  if (hasWorkoutExecution(latest) || hasWorkoutExecution(original) || hasWorkoutExecution(workout)) {
    return fail('Le suivi de cette séance a commencé. Sa programmation est protégée pour conserver les résultats. Les notes restent modifiables ; dupliquez la séance pour préparer une autre programmation.')
  }
  const withoutNotes = (value: Workout) => ({ ...value, notes: undefined })
  if (JSON.stringify(withoutNotes(latest)) !== JSON.stringify(withoutNotes(original))) return fail(conflict)
  const notes = { ...latest.notes }
  for (const category of ['before', 'during', 'after'] as const) {
    if (workout.notes[category] === original.notes[category]) continue
    if (latest.notes[category] !== original.notes[category] && latest.notes[category] !== workout.notes[category]) return fail(conflict)
    notes[category] = workout.notes[category]
  }
  return writeWorkouts(current.workouts.map((item) => item.id === workout.id ? { ...workout, status: latest.status, notes } : item), storage)
}

export function deleteWorkout(id: string, storage?: WorkoutStorage): WorkoutsResult {
  if (!identifier(id)) return fail('Identifiant de séance invalide.')
  const current = loadWorkouts(storage)
  if (!current.ok) return current
  if (!current.workouts.some((item) => item.id === id)) return fail('Cette séance n’existe plus. Rechargez la liste.')
  return writeWorkouts(current.workouts.filter((item) => item.id !== id), storage)
}

export function updateWorkoutNotes(id: string, patch: Partial<WorkoutNotes>, storage?: WorkoutStorage): WorkoutsResult {
  const categories = Object.keys(patch)
  if (!identifier(id) || !categories.length || categories.some((key) =>
    !['before', 'during', 'after'].includes(key) || typeof patch[key as WorkoutNoteCategory] !== 'string')) {
    return fail('Note invalide. Aucune modification enregistrée.')
  }
  const current = loadWorkouts(storage)
  if (!current.ok) return current
  if (!current.workouts.some((item) => item.id === id)) return fail('Cette séance n’existe plus. La note reste uniquement en mémoire.')
  return writeWorkouts(current.workouts.map((item) => item.id === id ? { ...item, notes: { ...item.notes, ...patch } } : item), storage)
}

export function updateWorkoutNote(id: string, category: WorkoutNoteCategory, text: string, storage?: WorkoutStorage): WorkoutsResult {
  return updateWorkoutNotes(id, { [category]: text }, storage)
}

/** Écriture ciblée sur la version persistée, avec contrôle de la série ouverte. */
export function updateWorkoutSetExecution(
  original: Workout,
  blockId: string,
  setId: string,
  execution: WorkoutSetExecution,
  storage?: WorkoutStorage,
): WorkoutsResult {
  if (!isWorkout(original) || !identifier(blockId) || !identifier(setId) || !isWorkoutSetExecution(execution)) {
    return fail('Résultat invalide. Aucune modification enregistrée.')
  }
  const current = loadWorkouts(storage)
  if (!current.ok) return current
  const latest = current.workouts.find((item) => item.id === original.id)
  if (!latest) return fail('Cette séance n’existe plus. Les résultats restent uniquement en mémoire.')
  if (latest.status !== 'planned' || workoutProgramSignature(latest) !== workoutProgramSignature(original)) return fail(conflict)
  const previousSet = original.exercises.find((block) => block.id === blockId)?.sets.find((set) => set.id === setId)
  const latestSet = latest.exercises.find((block) => block.id === blockId)?.sets.find((set) => set.id === setId)
  if (!previousSet || !latestSet) return fail('Cette série n’existe plus. Vos saisies restent en mémoire.')
  if (!sameExecution(latestSet.execution, previousSet.execution) && !sameExecution(latestSet.execution, execution)) {
    return fail('Les résultats de cette série ont changé ailleurs. Vos saisies restent en mémoire. Revenez à la séance puis rouvrez le suivi pour consulter la version enregistrée avant de corriger.')
  }
  if (!isWritableExecution(execution, latestSet.execution)) {
    return fail('Résultat invalide : répétitions entières et charge strictement positives, dans les limites numériques sûres. Aucune modification enregistrée.')
  }
  const updated: Workout = {
    ...latest,
    exercises: latest.exercises.map((block) => block.id !== blockId ? block : ({
      ...block, sets: block.sets.map((set) => set.id !== setId ? set : { ...set, execution: { ...execution } }),
    })),
  }
  return writeWorkouts(current.workouts.map((item) => item.id === latest.id ? updated : item), storage)
}

export function sortWorkouts(workouts: Workout[]): Workout[] {
  // Le tri natif est stable : l'ordre d'enregistrement départage les dates égales.
  return [...workouts].sort((left, right) => right.date.localeCompare(left.date))
}
