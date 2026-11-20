import type { Exercise, ExerciseId } from '../data/exercises'
import type { RoundingIncrement } from '../lib/loadCalculator'

export type WorkoutSetRounding =
  | { mode: 'exact' }
  | { mode: 'down' | 'up'; increment: Exclude<RoundingIncrement, null> }

// Données métier sérialisables, indépendantes de React et du stockage.
export type WorkoutNotes = { before: string; during: string; after: string }
export type WorkoutNoteCategory = keyof WorkoutNotes
export type WorkoutLoad = { exactKg: number; selectedKg: number }

// Une saisie partielle n'est jamais une confirmation de réalisation.
export type WorkoutSetExecution = (
  | { completed: false; reps: number | null; loadKg: number | null }
  | { completed: true; reps: number; loadKg: number }
) & {
  // Facultatif pour J6-A existant : distinguer un effacement d'un champ intact.
  cleared?: Partial<Record<'reps' | 'loadKg', true>>
}

export type WorkoutSet = {
  id: string
  reps: number
  intensityPct: number
  rounding: WorkoutSetRounding
  load: WorkoutLoad | null
  execution?: WorkoutSetExecution
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

// Contrats E2 : discriminants stricts, sans migration des séries historiques.
export type LegacyWorkoutSet = WorkoutSet & { schemaVersion?: never }
export type TrackingKind = 'load-reps' | 'reps' | 'duration'

export type ReferenceSnapshot = Readonly<{
  source: 'record'
  exerciseId: ExerciseId
  exerciseName: string
  oneRepMaxKg: number
}>

export type LoadPlan =
  | { method: 'manual'; loadKg: number }
  | {
      method: 'percentage'
      intensityPct: number
      rounding: WorkoutSetRounding
      reference: ReferenceSnapshot
      load: WorkoutLoad
    }

export type LoadRepsExecution =
  | {
      completed: false
      reps: number | null
      loadKg: number | null
      cleared?: Partial<Record<'reps' | 'loadKg', true>>
    }
  | { completed: true; reps: number; loadKg: number }

export type RepsExecution =
  | { completed: false; reps: number | null; cleared?: Partial<Record<'reps', true>> }
  | { completed: true; reps: number }

export type DurationExecution =
  | {
      completed: false
      durationSeconds: number | null
      cleared?: Partial<Record<'durationSeconds', true>>
    }
  | { completed: true; durationSeconds: number }

export type WorkoutSetV2 = { schemaVersion: 2; id: string } & (
  | { kind: 'load-reps'; reps: number; loading: LoadPlan | null; execution?: LoadRepsExecution }
  | { kind: 'reps'; reps: number; execution?: RepsExecution }
  | { kind: 'duration'; durationSeconds: number; execution?: DurationExecution }
)

export type StoredWorkoutSet = LegacyWorkoutSet | WorkoutSetV2
export type StoredWorkoutExercise = Omit<WorkoutExercise, 'sets'> & { sets: StoredWorkoutSet[] }
// E2-B : une sauvegarde V2 sera nécessaire pour une série E2 OU un Record étendu.
// Les données entièrement historiques pourront garder l'enveloppe V1.
export type StoredWorkout = Omit<Workout, 'exercises'> & { exercises: StoredWorkoutExercise[] }

export type LoadedWorkoutSetV2 = Extract<WorkoutSetV2, { kind: 'load-reps' }>
export type AppWorkoutSet = StoredWorkoutSet
export type AppSetExecution = NonNullable<AppWorkoutSet['execution']>
export type AppWorkoutExercise = Omit<WorkoutExercise, 'sets'> & { sets: AppWorkoutSet[] }
export type AppWorkout = Omit<Workout, 'exercises'> & { exercises: AppWorkoutExercise[] }

export type E2LoadDraft = {
  method: 'legacy' | 'percentage' | 'manual' | 'none'
  manualInput: string
  intensityInput: string
  rounding: WorkoutSetRounding
  reference: ReferenceSnapshot | null
  savedPlan?: Extract<LoadPlan, { method: 'percentage' }>
}
// Les branches inactives restent uniquement dans le formulaire React.
// repsInput et e2 conservent le brouillon chargé ; aucune conversion d'unités.
export type AppSetDraft = WorkoutSetDraft & {
  e2?: E2LoadDraft
  kind?: TrackingKind
  repsOnlyInput?: string
  durationInput?: string
}
export type AppExerciseDraft = Omit<WorkoutExerciseDraft, 'sets'> & { sets: AppSetDraft[] }
export type AppWorkoutDraft = Omit<WorkoutDraft, 'exercises'> & { exercises: AppExerciseDraft[] }
export type AppDraftErrors = Omit<WorkoutDraftErrors, 'blocks'> & {
  blocks: Record<string, { exercise?: string; sets?: string; fields: Record<string, {
    reps?: string; duration?: string; intensity?: string; rounding?: string; reference?: string; load?: string
  }> }>
}
export type AppDraftValidation =
  | { valid: true; workout: AppWorkout; errors: AppDraftErrors }
  | { valid: false; workout: null; errors: AppDraftErrors }
