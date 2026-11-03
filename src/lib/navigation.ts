import type { Workout } from '../types/workout.ts'

export type SectionId = 'sessions' | 'records' | 'calculator' | 'history'
export type NavigationState = { section: SectionId; trackingWorkoutId: string | null }
type NavigationStorage = Pick<Storage, 'getItem' | 'setItem'>
export const navigationStorageKey = 'liftboard.navigation.v1'
const defaultNavigation = (): NavigationState => ({ section: 'sessions', trackingWorkoutId: null })

export function loadNavigation(storage?: NavigationStorage): NavigationState {
  try {
    const raw = (storage ?? window.sessionStorage).getItem(navigationStorageKey)
    if (raw === null) return defaultNavigation()
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return defaultNavigation()
    const { section, trackingWorkoutId } = data as Record<string, unknown>
    if (!['sessions', 'records', 'calculator', 'history'].includes(section as string) ||
      !(trackingWorkoutId === null || (typeof trackingWorkoutId === 'string' && trackingWorkoutId.trim().length > 0))) return defaultNavigation()
    return { section: section as SectionId, trackingWorkoutId }
  } catch {
    // La navigation reste utilisable si le stockage de l'onglet est indisponible.
    return defaultNavigation()
  }
}

export function saveNavigation(navigation: NavigationState, storage?: NavigationStorage): void {
  try { (storage ?? window.sessionStorage).setItem(navigationStorageKey, JSON.stringify(navigation)) } catch { /* Repli en mémoire. */ }
}

export function findTrackedWorkout(workouts: Workout[], id: string | null): Workout | null {
  return workouts.find((workout) => workout.id === id && workout.status === 'planned') ?? null
}
