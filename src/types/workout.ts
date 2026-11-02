import type { Exercise } from '../data/personalRecords'
import type { RoundingIncrement } from '../lib/loadCalculator'

export type WorkoutSetRounding =
  | { mode: 'exact' }
  | { mode: 'down' | 'up'; increment: Exclude<RoundingIncrement, null> }

// Données métier sérialisables, indépendantes de React et du stockage.
// Les charges restent dérivées pendant l'édition ; leur gel historique relève de J5/J6.
export type WorkoutSet = {
  id: string
  reps: number
  intensityPct: number
  rounding: WorkoutSetRounding
}

export type WorkoutExercise = {
  id: string
  exerciseId: Exercise['id']
  sets: WorkoutSet[]
}

export type Workout = {
  id: string
  title: string
  date: string
  exercises: WorkoutExercise[]
}

// Les champs contrôlés conservent la saisie brute, même vide ou invalide.
export type WorkoutSetDraft = {
  id: string
  repsInput: string
  intensityInput: string
  rounding: WorkoutSetRounding
}

export type WorkoutExerciseDraft = Omit<WorkoutExercise, 'sets'> & {
  sets: WorkoutSetDraft[]
}

export type WorkoutDraft = Omit<Workout, 'exercises'> & {
  exercises: WorkoutExerciseDraft[]
}

export type WorkoutDraftErrors = {
  title?: string
  date?: string
  exercises?: string
  blocks: Record<string, {
    exercise?: string
    sets?: string
    fields: Record<string, { reps?: string; intensity?: string; rounding?: string }>
  }>
}

export type WorkoutDraftValidation =
  | { valid: true; workout: Workout; errors: WorkoutDraftErrors }
  | { valid: false; workout: null; errors: WorkoutDraftErrors }
