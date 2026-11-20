import { isAppWorkout } from '../lib/workoutSchema.ts'
import { hasWorkoutExecution } from '../lib/workoutExecution.ts'
import { withSetExecution } from '../lib/workoutSetExecution.ts'
import { storedWorkoutProgramSignature as workoutProgramSignature, sameStoredSetExecution } from '../lib/workoutComparison.ts'
import { workoutCompletionError } from '../lib/workoutHistory.ts'
import type { AppWorkout as Workout, AppSetExecution, WorkoutNotes, WorkoutNoteCategory } from '../types/workout.ts'

export const workoutsStorageKey = 'liftboard.workouts.v1'
export type WorkoutStorage = Pick<Storage, 'getItem' | 'setItem'>
export type WorkoutsResult = { ok: true; workouts: Workout[] } | { ok: false; error: string }

const invalidData = 'Les séances stockées sont illisibles ou incompatibles. Elles sont conservées ; les écritures sont bloquées pour les protéger.'
const conflict = 'Cette séance a changé depuis son ouverture. Vos saisies sont conservées. Revenez aux séances puis rouvrez la version actuelle avant de modifier à nouveau.'
const fail = (error: string): WorkoutsResult => ({ ok: false, error })
const identifier = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export { isWorkoutNotes } from '../lib/workoutSchema.ts'

export function isWorkout(value: unknown): value is Workout {
  return isAppWorkout(value)
}

export function isWorkouts(value: unknown): value is Workout[] {
  return Array.isArray(value) && value.every(isWorkout) &&
    new Set(value.map((item) => item.id)).size === value.length
}

export function loadWorkouts(storage?: WorkoutStorage): WorkoutsResult {
  try {
    const raw = (storage ?? window.localStorage).getItem(workoutsStorageKey)
    if (raw === null) return { ok: true, workouts: [] }
    let data: unknown
    try { data = JSON.parse(raw) } catch { return fail(invalidData) }
    if (!isWorkouts(data)) {
      return fail(invalidData)
    }
    return { ok: true, workouts: data }
  } catch {
    return fail('Impossible de lire les séances sur ce navigateur. Les données existantes sont conservées. Réessayez.')
  }
}

function writeWorkouts(workouts: Workout[], storage?: WorkoutStorage): WorkoutsResult {
  let verifying = false
  try {
    const target = storage ?? window.localStorage
    const serialized = JSON.stringify(workouts)
    target.setItem(workoutsStorageKey, serialized)
    verifying = true
    if (target.getItem(workoutsStorageKey) !== serialized) {
      return fail('L’enregistrement des séances n’a pas pu être confirmé. Vos saisies restent en mémoire. Vérifiez les données persistées avant de réessayer.')
    }
    return { ok: true, workouts }
  } catch (error) {
    if (verifying) return fail('L’écriture a été effectuée, mais sa vérification est impossible. Vos saisies restent en mémoire ; l’état persistant doit être vérifié avant de réessayer.')
    return fail(error instanceof Error && error.name === 'QuotaExceededError'
      ? 'Stockage local plein. Aucune modification enregistrée. Vos saisies restent en mémoire ; libérez de l’espace puis réessayez.'
      : 'Impossible d’écrire dans le stockage local. Aucune modification enregistrée. Vos saisies restent en mémoire ; réessayez.')
  }
}

export function createWorkout(workout: Workout, storage?: WorkoutStorage): WorkoutsResult {
  if (!isWorkout(workout) || workout.status !== 'planned' || workout.exercises.some((block) =>
    block.sets.some((set) => set.execution && !withSetExecution(set, set.execution, true)))) return fail('La séance est invalide et n’a pas été enregistrée.')
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
  if (latest.status !== 'planned' || original.status !== 'planned') return fail('Cette séance est terminée. Réouvrez-la depuis l’Historique avant de modifier sa programmation.')
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

export function updateWorkoutNotes(id: string, patch: Partial<WorkoutNotes>, storage?: WorkoutStorage, originalNotes?: WorkoutNotes): WorkoutsResult {
  const categories = Object.keys(patch)
  if (!identifier(id) || !categories.length || categories.some((key) =>
    !['before', 'during', 'after'].includes(key) || typeof patch[key as WorkoutNoteCategory] !== 'string')) {
    return fail('Note invalide. Aucune modification enregistrée.')
  }
  const current = loadWorkouts(storage)
  if (!current.ok) return current
  const latest = current.workouts.find((item) => item.id === id)
  if (!latest) return fail('Cette séance n’existe plus. La note reste uniquement en mémoire.')
  if (originalNotes && categories.some((key) => {
    const category = key as WorkoutNoteCategory
    return latest.notes[category] !== originalNotes[category] && latest.notes[category] !== patch[category]
  })) return fail('Cette note a changé ailleurs. Votre saisie reste en mémoire. Revenez à la séance puis rouvrez les notes pour consulter la version enregistrée.')
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
  execution: AppSetExecution,
  storage?: WorkoutStorage,
): WorkoutsResult {
  if (!isWorkout(original) || !identifier(blockId) || !identifier(setId)) {
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
  const candidate = withSetExecution(latestSet, execution)
  if (!candidate) return fail('Résultat invalide : renseignez uniquement les valeurs du type de suivi, strictement positives et dans les limites numériques sûres. Aucune modification enregistrée.')
  if (!sameStoredSetExecution(latestSet, previousSet) && !sameStoredSetExecution(latestSet, candidate)) {
    return fail('Les résultats de cette série ont changé ailleurs. Vos saisies restent en mémoire. Revenez à la séance puis rouvrez le suivi pour consulter la version enregistrée avant de corriger.')
  }
  const updated: Workout = {
    ...latest,
    exercises: latest.exercises.map((block) => block.id !== blockId ? block : ({
      ...block, sets: block.sets.map((set) => set.id !== setId ? set : candidate),
    })),
  }
  return writeWorkouts(current.workouts.map((item) => item.id === latest.id ? updated : item), storage)
}

export function sortWorkouts(workouts: Workout[]): Workout[] {
  // Le tri natif est stable : l'ordre d'enregistrement départage les dates égales.
  return [...workouts].sort((left, right) => right.date.localeCompare(left.date))
}

/** Changer uniquement le statut de la version relue, sans écraser les notes récentes. */
function transitionWorkoutStatus(original: Workout, status: Workout['status'], storage?: WorkoutStorage): WorkoutsResult {
  if (!isWorkout(original)) return fail('Séance invalide. Aucun changement de statut enregistré.')
  const expected = status === 'completed' ? 'planned' : 'completed'
  const current = loadWorkouts(storage)
  if (!current.ok) return current
  const latest = current.workouts.find((item) => item.id === original.id)
  if (!latest) return fail('Cette séance n’existe plus. Aucun changement de statut enregistré.')
  if (original.status !== expected || latest.status !== expected) {
    return fail('Le statut de cette séance a changé. Revenez à la liste pour consulter la version actuelle. Aucun changement enregistré.')
  }
  if (workoutProgramSignature(latest) !== workoutProgramSignature(original) ||
    latest.exercises.some((block, index) => block.sets.some((set, number) =>
      !sameStoredSetExecution(set, original.exercises[index].sets[number])))) {
    return fail('La programmation ou les performances de cette séance ont changé. Revenez à la liste puis consultez la version actuelle avant de confirmer à nouveau.')
  }
  if (status === 'completed') {
    const error = workoutCompletionError(latest)
    if (error) return fail(error)
  }
  return writeWorkouts(current.workouts.map((item) => item.id === latest.id ? { ...item, status } : item), storage)
}

export function completeWorkout(original: Workout, storage?: WorkoutStorage): WorkoutsResult {
  return transitionWorkoutStatus(original, 'completed', storage)
}

export function reopenWorkout(original: Workout, storage?: WorkoutStorage): WorkoutsResult {
  return transitionWorkoutStatus(original, 'planned', storage)
}
