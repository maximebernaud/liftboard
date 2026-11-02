import type { Exercise } from '../data/personalRecords'
import type { RoundingIncrement } from '../lib/loadCalculator'

export type WorkoutSetRounding =
  | { mode: 'exact' }
  | { mode: 'down' | 'up'; increment: Exclude<RoundingIncrement, null> }

// Données métier sérialisables, indépendantes de React et du stockage.
export type WorkoutNotes = { before: string; during: string; after: string }
export type WorkoutNoteCategory = keyof WorkoutNotes
export type WorkoutLoad = { exactKg: number; selectedKg: number }

export type WorkoutSet = {
  id: string
  reps: number
  intensityPct: number
  rounding: WorkoutSetRounding
  load: WorkoutLoad | null
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
  status: 'planned' | 'completed'
  notes: WorkoutNotes
  exercises: WorkoutExercise[]
}

// Les champs contrôlés conservent la saisie brute, même vide ou invalide.
export type WorkoutSetDraft = {
  id: string
  repsInput: string
  intensityInput: string
  rounding: WorkoutSetRounding
  // undefined : calcul avec les Records actuels ; null : absence enregistrée.
  savedLoad?: WorkoutLoad | null
}

export type WorkoutExerciseDraft = Omit<WorkoutExercise, 'sets'> & {
  sets: WorkoutSetDraft[]
}

export type WorkoutDraft = Omit<Workout, 'exercises' | 'status'> & {
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
