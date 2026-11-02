import { exercises, type Exercise } from '../data/personalRecords.ts'
import { calculateLoad, parseIntensity, roundingIncrements, roundLoadDirected } from './loadCalculator.ts'
import type {
  WorkoutDraft,
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
  return { id: crypto.randomUUID(), title: '', date: localDateString(date), exercises: [] }
}

export function createWorkoutSetDraft(): WorkoutSetDraft {
  return { id: crypto.randomUUID(), repsInput: '', intensityInput: '', rounding: { mode: 'exact' } }
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

function isWorkoutSetRounding(value: unknown): value is WorkoutSetRounding {
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
  fields: Partial<Pick<WorkoutSetDraft, 'repsInput' | 'intensityInput' | 'rounding'>>,
): WorkoutDraft {
  return updateDraftExercise(draft, blockId, (block) => ({
    ...block,
    sets: block.sets.map((set) => set.id === setId ? { ...set, ...fields } : set),
  }))
}

/** Valide et transforme sans modifier le brouillon ni exiger un record 1RM.
 * J5 pourra utiliser workout uniquement lorsque valid vaut true.
 */
export function validateWorkoutDraft(draft: WorkoutDraft): WorkoutDraftValidation {
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
        validSets.push({ id: set.id, reps, intensityPct, rounding: { ...set.rounding } })
      }
    }
    errors.blocks[block.id] = blockErrors
    return { id: block.id, exerciseId: block.exerciseId, sets: validSets }
  })

  return valid
    ? {
      valid: true,
      workout: { id: draft.id, title: draft.title.trim(), date: draft.date, exercises: validExercises },
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
