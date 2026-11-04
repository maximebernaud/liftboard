import { exercises, type Exercise } from '../data/personalRecords.ts'
import { getWorkoutProgress, requiresExecutionCorrection } from './workoutExecution.ts'
import type { Workout } from '../types/workout.ts'

export type HistoryFilters = { exerciseId: Exercise['id'] | ''; date: string }

// Ajustement uniquement après une clôture réussie ; les critères compatibles restent actifs.
export function historyFiltersForWorkout(filters: HistoryFilters, workout: Workout): HistoryFilters {
  return {
    exerciseId: workout.exercises.some((block) => block.exerciseId === filters.exerciseId) ? filters.exerciseId : '',
    date: filters.date === workout.date ? filters.date : '',
  }
}

export function workoutCompletionMessage(workout: Workout): string {
  const { completed, total } = getWorkoutProgress(workout)
  if (completed === total) {
    return `Vous avez réalisé ${total === 1 ? 'la série' : `les ${total} séries`} de cette séance. La terminer et l’enregistrer dans l’historique ?`
  }
  const remaining = total - completed
  return `Vous avez réalisé ${completed} série${completed > 1 ? 's' : ''} sur ${total}. ${remaining === 1
    ? 'La dernière série sera considérée comme non effectuée.'
    : `Les ${remaining} autres séries seront considérées comme non effectuées.`} Vos résultats et vos notes seront conservés.`
}

/** La clôture ne compte que les confirmations ; aucune série n'est complétée ici. */
export function workoutCompletionError(workout: Workout): string | null {
  for (const [blockIndex, block] of workout.exercises.entries()) {
    for (const [setIndex, set] of block.sets.entries()) {
      if (set.execution?.completed && requiresExecutionCorrection(set.execution)) {
        const name = exercises.find((item) => item.id === block.exerciseId)?.name
        return `Exercice ${blockIndex + 1} (${name}), série ${setIndex + 1} : ancien résultat invalide. Corrigez les répétitions et la charge dans le suivi avant de terminer la séance.`
      }
    }
  }
  return getWorkoutProgress(workout).completed === 0
    ? 'Aucune performance confirmée : réalisez et confirmez au moins une série valide avant de terminer la séance.'
    : null
}

export function filterWorkoutHistory(workouts: Workout[], filters: HistoryFilters): Workout[] {
  // Comparaison des dates locales enregistrées, sans conversion UTC.
  return workouts.filter((workout) => workout.status === 'completed' &&
    (!filters.date || workout.date === filters.date) &&
    (!filters.exerciseId || workout.exercises.some((block) => block.exerciseId === filters.exerciseId)))
}

export function formatWorkoutDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}
