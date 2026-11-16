import { isExerciseId, type ExerciseId } from './exercises.ts'

export const exerciseFavoritesStorageKey = 'liftboard.exercise-favorites.v1'
type FavoritesStorage = Pick<Storage, 'getItem' | 'setItem'>
export type FavoritesResult = { ok: true; ids: ExerciseId[] } | { ok: false; error: string }

export function loadExerciseFavorites(storage?: Pick<Storage, 'getItem'>): FavoritesResult {
  try {
    const raw = (storage ?? window.localStorage).getItem(exerciseFavoritesStorageKey)
    if (raw === null) return { ok: true, ids: [] }
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return { ok: false, error: 'Favoris illisibles. Les préférences existantes sont conservées.' }
    // Nettoyage en mémoire uniquement : aucune écriture au chargement.
    return { ok: true, ids: [...new Set(value.filter(isExerciseId))] }
  } catch {
    return { ok: false, error: 'Impossible de lire les favoris. Les préférences existantes sont conservées.' }
  }
}

/** Relire avant l'action ciblée pour préserver les autres favoris d'un autre onglet. */
export function setExerciseFavorite(id: ExerciseId, favorite: boolean, storage?: FavoritesStorage): FavoritesResult {
  if (!isExerciseId(id)) return { ok: false, error: 'Exercice inconnu. Aucun favori modifié.' }
  try {
    const target = storage ?? window.localStorage
    const current = loadExerciseFavorites(target)
    if (!current.ok) return current
    const ids = current.ids.filter((item) => item !== id)
    if (favorite) ids.push(id)
    const serialized = JSON.stringify(ids)
    target.setItem(exerciseFavoritesStorageKey, serialized)
    if (target.getItem(exerciseFavoritesStorageKey) !== serialized) {
      return { ok: false, error: 'Enregistrement des favoris non confirmé. Relisez les préférences avant de réessayer.' }
    }
    return { ok: true, ids }
  } catch (error) {
    return { ok: false, error: error instanceof Error && error.name === 'QuotaExceededError'
      ? 'Stockage local plein. Le changement de favori n’a pas été enregistré.'
      : 'Impossible d’enregistrer les favoris. Le changement n’est pas confirmé ; les préférences affichées sont conservées.' }
  }
}
