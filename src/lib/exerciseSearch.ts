import { exercises, isExerciseId, type Exercise, type ExerciseFamily } from '../data/exercises.ts'
import type { AppWorkout as Workout } from '../types/workout.ts'

export type ExerciseFamilyFilter = ExerciseFamily | 'all'

export function normalizeExerciseSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

const index = exercises.map((exercise) => ({
  exercise,
  name: normalizeExerciseSearch(exercise.name),
  aliases: exercise.aliases.map(normalizeExerciseSearch),
  tags: exercise.tags.map(normalizeExerciseSearch),
}))

/** Six niveaux de pertinence ; l'index canonique départage toutes les égalités. */
export function searchExercises(query: string, family: ExerciseFamilyFilter = 'all'): Exercise[] {
  const normalized = normalizeExerciseSearch(query)
  const tokens = normalized.split(' ')
  return index.flatMap(({ exercise, name, aliases, tags }, order) => {
    if (family !== 'all' && exercise.family !== family) return []
    const rank = !normalized || name === normalized ? 0
      : aliases.includes(normalized) ? 1
      : name.startsWith(normalized) ? 2
      : aliases.some((alias) => alias.startsWith(normalized)) ? 3
      : name.includes(normalized) ? 4
      : [...aliases, ...tags].some((value) => value.includes(normalized)) ||
        tokens.every((token) => [name, ...aliases, ...tags].some((value) => value.includes(token))) ? 5
      : -1
    return rank < 0 ? [] : [{ exercise, rank, order }]
  }).sort((left, right) => left.rank - right.rank || left.order - right.order)
    .map(({ exercise }) => exercise)
}

/** Pas de date d'utilisation dans le modèle V1 : dernier enregistrement d'abord.
 * La date programmée ne sert jamais à inventer une chronologie d'exécution.
 */
export function recentExercises(workouts: readonly Workout[], limit = 6): Exercise[] {
  const ids = new Set<string>()
  for (const workout of [...workouts].reverse()) {
    for (const block of workout.exercises) {
      if (isExerciseId(block.exerciseId)) ids.add(block.exerciseId)
    }
  }
  return [...ids].slice(0, Math.max(0, limit))
    .flatMap((id) => exercises.filter((exercise) => exercise.id === id))
}
