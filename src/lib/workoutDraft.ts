import { exercises, type Exercise, type PersonalRecord } from '../data/personalRecords.ts'
import { calculateLoad, parseIntensity, roundingIncrements, roundLoadDirected } from './loadCalculator.ts'
import type {
  WorkoutDraft,
  Workout,
  WorkoutDraftErrors,
  WorkoutDraftValidation,
  WorkoutExercise,
  WorkoutExerciseDraft,
  WorkoutSet,
  WorkoutSetDraft,
  WorkoutSetRounding,
} from '../types/workout'

export function localDateString(date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isValidWorkoutDate(input: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return false
  const [year, month, day] = input.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]
}

export function createWorkoutDraft(date = new Date()): WorkoutDraft {
  return { id: crypto.randomUUID(), title: '', date: localDateString(date), exercises: [], notes: { before: '', during: '', after: '' } }
}

export function workoutToDraft(workout: Workout): WorkoutDraft {
  return {
    id: workout.id, title: workout.title, date: workout.date, notes: { ...workout.notes },
    exercises: workout.exercises.map((block) => ({
      ...block,
      sets: block.sets.map((set) => ({
        id: set.id, repsInput: String(set.reps), intensityInput: String(set.intensityPct),
        rounding: { ...set.rounding }, savedLoad: set.load ? { ...set.load } : null,
      })),
    })),
  }
}

export function createWorkoutSetDraft(previous?: WorkoutSetDraft): WorkoutSetDraft {
  const id = crypto.randomUUID()
  if (previous && parseRepetitions(previous.repsInput) !== null &&
    parseWorkoutIntensity(previous.intensityInput) !== null && isWorkoutSetRounding(previous.rounding)) {
    return { id, repsInput: previous.repsInput, intensityInput: previous.intensityInput, rounding: { ...previous.rounding } }
  }
  return { id, repsInput: '', intensityInput: '', rounding: { mode: 'exact' } }
}

/** Nouvelle préparation : aucune charge historique ni observation d'exécution. */
export function duplicateWorkoutDraft(source: Workout, date = new Date()): WorkoutDraft {
  return {
    ...createWorkoutDraft(date),
    title: `${source.title} — copie`,
    notes: { before: source.notes.before, during: '', after: '' },
    exercises: source.exercises.map((block) => ({
      id: crypto.randomUUID(), exerciseId: block.exerciseId,
      sets: block.sets.map((set) => createWorkoutSetDraft({
        id: set.id, repsInput: String(set.reps), intensityInput: String(set.intensityPct), rounding: set.rounding,
      })),
    })),
  }
}

export function createWorkoutExerciseDraft(
  exerciseId: Exercise['id'] = exercises[0].id,
): WorkoutExerciseDraft {
  return { id: crypto.randomUUID(), exerciseId, sets: [createWorkoutSetDraft()] }
}

export function parseRepetitions(input: string): number | null {
  if (!/^\d+$/.test(input.trim())) return null
  const value = Number(input.trim())
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export function parseWorkoutIntensity(input: string): number | null {
  // Dans l'éditeur, « 75, » reste une saisie incomplète, sans charge affichée.
  if (/[.,]$/.test(input.trim())) return null
  return parseIntensity(input)
}

export function isWorkoutSetRounding(value: unknown): value is WorkoutSetRounding {
  if (typeof value !== 'object' || value === null || !('mode' in value)) return false
  return value.mode === 'exact' || (
    (value.mode === 'down' || value.mode === 'up') &&
    'increment' in value && roundingIncrements.some((increment) => increment === value.increment)
  )
}

export function updateDraftExercise(
  draft: WorkoutDraft,
  blockId: string,
  update: (block: WorkoutExerciseDraft) => WorkoutExerciseDraft,
): WorkoutDraft {
  return {
    ...draft,
    exercises: draft.exercises.map((block) => block.id === blockId ? update(block) : block),
  }
}

export function updateDraftSet(
  draft: WorkoutDraft,
  blockId: string,
  setId: string,
  fields: Partial<Omit<WorkoutSetDraft, 'id'>>,
): WorkoutDraft {
  return updateDraftExercise(draft, blockId, (block) => ({
    ...block,
    sets: block.sets.map((set) => {
      if (set.id !== setId) return set
      const recalculate = ('intensityInput' in fields && fields.intensityInput !== set.intensityInput) ||
        ('rounding' in fields && JSON.stringify(fields.rounding) !== JSON.stringify(set.rounding))
      return { ...set, ...fields, ...(recalculate ? { savedLoad: undefined } : {}) }
    }),
  }))
}

export function changeDraftMovement(draft: WorkoutDraft, blockId: string, exerciseId: Exercise['id']): WorkoutDraft {
  return updateDraftExercise(draft, blockId, (block) => block.exerciseId === exerciseId ? block : ({
    ...block, exerciseId, sets: block.sets.map((set) => ({ ...set, savedLoad: undefined })),
  }))
}

/** Valide, transforme et fige les charges, sans modifier le brouillon. */
export function validateWorkoutDraft(draft: WorkoutDraft, records: PersonalRecord[] = []): WorkoutDraftValidation {
  const errors: WorkoutDraftErrors = { blocks: {} }
  if (!draft.title.trim()) errors.title = 'Renseignez un titre pour la séance.'
  if (!isValidWorkoutDate(draft.date)) errors.date = 'Renseignez une date réelle au format AAAA-MM-JJ.'
  if (draft.exercises.length === 0) errors.exercises = 'Ajoutez au moins un exercice.'

  let valid = !errors.title && !errors.date && !errors.exercises
  const validExercises: WorkoutExercise[] = draft.exercises.map((block) => {
    const blockErrors: WorkoutDraftErrors['blocks'][string] = { fields: {} }
    if (!exercises.some((exercise) => exercise.id === block.exerciseId)) {
      blockErrors.exercise = 'Choisissez un exercice du catalogue.'
      valid = false
    }
    if (block.sets.length === 0) {
      blockErrors.sets = 'Ajoutez au moins une série à cet exercice.'
      valid = false
    }

    const validSets: WorkoutSet[] = []
    for (const set of block.sets) {
      const reps = parseRepetitions(set.repsInput)
      const intensityPct = parseWorkoutIntensity(set.intensityInput)
      const validRounding = isWorkoutSetRounding(set.rounding)
      const fieldErrors: { reps?: string; intensity?: string; rounding?: string } = {}
      if (reps === null) fieldErrors.reps = 'Saisissez un entier supérieur à 0.'
      if (intensityPct === null) fieldErrors.intensity = 'Saisissez un nombre de 1 à 100 %, avec une virgule ou un point.'
      if (!validRounding) fieldErrors.rounding = 'Choisissez le mode exact ou un arrondi avec un pas de 1, 2,5 ou 5 kg.'
      if (reps === null || intensityPct === null || !validRounding) {
        valid = false
        blockErrors.fields[set.id] = fieldErrors
      } else {
        const record = records.find((item) => item.exerciseId === block.exerciseId)
        const load = getWorkoutSetLoad(set, record?.oneRepMaxKg)
        validSets.push({
          id: set.id, reps, intensityPct, rounding: { ...set.rounding },
          load: load.status === 'ready' ? { exactKg: load.exactKg, selectedKg: load.selectedKg } : null,
        })
      }
    }
    errors.blocks[block.id] = blockErrors
    return { id: block.id, exerciseId: block.exerciseId, sets: validSets }
  })

  return valid
    ? {
      valid: true,
      workout: {
        id: draft.id, title: draft.title.trim(), date: draft.date, status: 'planned',
        notes: { ...draft.notes }, exercises: validExercises,
      },
      errors,
    }
    : { valid: false, workout: null, errors }
}

export type WorkoutSetLoad =
  | { status: 'ready'; exactKg: number; selectedKg: number }
  | { status: 'invalid-input' | 'missing-record' | 'unavailable' }

export function getWorkoutSetLoad(
  set: WorkoutSetDraft,
  oneRepMaxKg: number | undefined,
): WorkoutSetLoad {
  const intensity = parseWorkoutIntensity(set.intensityInput)
  if (intensity === null || parseRepetitions(set.repsInput) === null || !isWorkoutSetRounding(set.rounding)) {
    return { status: 'invalid-input' }
  }
  if (set.savedLoad !== undefined) {
    return set.savedLoad === null ? { status: 'unavailable' } : { status: 'ready', ...set.savedLoad }
  }
  if (oneRepMaxKg === undefined) return { status: 'missing-record' }
  if (!Number.isFinite(oneRepMaxKg) || oneRepMaxKg <= 0) return { status: 'unavailable' }

  const { exactKg } = calculateLoad(oneRepMaxKg, intensity)
  // Une valeur hors de la précision représentable ne doit pas devenir un faux 0 kg.
  if (!Number.isFinite(exactKg) || exactKg <= 0) return { status: 'unavailable' }
  const selectedKg = set.rounding.mode === 'exact'
    ? exactKg
    : roundLoadDirected(exactKg, set.rounding.increment, set.rounding.mode)
  return Number.isFinite(selectedKg)
    ? { status: 'ready', exactKg, selectedKg }
    : { status: 'unavailable' }
}
