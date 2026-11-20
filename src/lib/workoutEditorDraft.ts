import { exercises, isRecordExerciseId } from '../data/exercises.ts'
import type { PersonalRecord } from '../data/personalRecords.ts'
import {
  createWorkoutDraft, duplicateWorkoutSetDraft, getWorkoutSetLoad, parseRepetitions,
  validateWorkoutDraft,
} from './workoutDraft.ts'
import { calculateWorkoutLoad, parseWorkoutIntensityV2 } from './workoutProgramming.ts'
import { parseExecutionLoad } from './workoutExecution.ts'
import { isLoadPlan } from './workoutSchema.ts'
import type {
  AppDraftErrors, AppDraftValidation, AppExerciseDraft, AppSetDraft, AppWorkout, AppWorkoutDraft,
  AppWorkoutSet, E2LoadDraft, LoadPlan, ReferenceSnapshot,
} from '../types/workout.ts'

export function newE2LoadDraft(set: AppSetDraft): E2LoadDraft {
  return { method: 'percentage', manualInput: '', intensityInput: set.intensityInput,
    rounding: { ...set.rounding }, reference: null }
}

export function recordSnapshot(record: PersonalRecord): ReferenceSnapshot {
  return { source: 'record', exerciseId: record.exerciseId,
    exerciseName: exercises.find((exercise) => exercise.id === record.exerciseId)?.name ?? record.exerciseId,
    oneRepMaxKg: record.oneRepMaxKg }
}

function setToDraft(set: AppWorkoutSet): AppSetDraft {
  if (set.schemaVersion !== 2) return { id: set.id, repsInput: String(set.reps), intensityInput: String(set.intensityPct),
    rounding: { ...set.rounding }, savedLoad: set.load ? { ...set.load } : null }
  const draft: AppSetDraft = { id: set.id, repsInput: String(set.reps), intensityInput: '', rounding: { mode: 'exact' } }
  const e2 = newE2LoadDraft(draft)
  if (set.loading === null) e2.method = 'none'
  else if (set.loading.method === 'manual') { e2.method = 'manual'; e2.manualInput = String(set.loading.loadKg) }
  else {
    e2.intensityInput = String(set.loading.intensityPct)
    e2.rounding = { ...set.loading.rounding }
    e2.reference = { ...set.loading.reference }
    e2.savedPlan = structuredClone(set.loading)
  }
  return { ...draft, e2 }
}

export function workoutToAppDraft(workout: AppWorkout): AppWorkoutDraft {
  return { id: workout.id, title: workout.title, date: workout.date, notes: { ...workout.notes },
    exercises: workout.exercises.map((block) => ({ id: block.id, exerciseId: block.exerciseId, sets: block.sets.map(setToDraft) })) }
}

export function duplicateAppSetDraft(set: AppSetDraft, records: PersonalRecord[] = []): AppSetDraft {
  if (!set.e2 || set.e2.method === 'legacy') return duplicateWorkoutSetDraft(set)
  const copy = structuredClone(set)
  copy.id = crypto.randomUUID()
  if (copy.e2) {
    delete copy.e2.savedPlan
    const record = records.find((item) => item.exerciseId === copy.e2?.reference?.exerciseId)
    if (record) copy.e2.reference = recordSnapshot(record)
  }
  return copy
}

export function duplicateAppWorkoutDraft(workout: AppWorkout, records: PersonalRecord[] = []): AppWorkoutDraft {
  const draft = workoutToAppDraft(workout)
  return { ...createWorkoutDraft(), title: `${workout.title} — copie`, notes: { before: workout.notes.before, during: '', after: '' },
    exercises: draft.exercises.map((block) => ({ ...block, id: crypto.randomUUID(), sets: block.sets.map((set) => duplicateAppSetDraft(set, records)) })) }
}

export function updateAppExercise(draft: AppWorkoutDraft, id: string, update: (block: AppExerciseDraft) => AppExerciseDraft): AppWorkoutDraft {
  return { ...draft, exercises: draft.exercises.map((block) => block.id === id ? update(block) : block) }
}

export function updateAppSet(draft: AppWorkoutDraft, blockId: string, setId: string, fields: Partial<Omit<AppSetDraft, 'id'>>): AppWorkoutDraft {
  return updateAppExercise(draft, blockId, (block) => ({ ...block, sets: block.sets.map((set) => {
    if (set.id !== setId) return set
    const recalculate = ('intensityInput' in fields && fields.intensityInput !== set.intensityInput) ||
      ('rounding' in fields && JSON.stringify(fields.rounding) !== JSON.stringify(set.rounding))
    return { ...set, ...fields, ...(recalculate ? { savedLoad: undefined } : {}) }
  }) }))
}

export function changeAppMovement(draft: AppWorkoutDraft, blockId: string, exerciseId: AppExerciseDraft['exerciseId']): AppWorkoutDraft {
  return updateAppExercise(draft, blockId, (block) => block.exerciseId === exerciseId ? block : ({ ...block, exerciseId,
    sets: block.sets.map((set) => set.e2 && set.e2.method !== 'legacy' ? set : { ...set, savedLoad: undefined }) }))
}

type LoadResolution = { valid: true; plan: LoadPlan | null } | { valid: false; errors: { intensity?: string; rounding?: string; reference?: string; load?: string } }
export function resolveE2Load(e2: E2LoadDraft, records: PersonalRecord[] | null): LoadResolution {
  if (e2.method === 'none') return { valid: true, plan: null }
  if (e2.method === 'manual') {
    const loadKg = parseExecutionLoad(e2.manualInput)
    return loadKg === null ? { valid: false, errors: { load: 'Saisissez une charge strictement positive, avec une précision numérique sûre.' } }
      : { valid: true, plan: { method: 'manual', loadKg } }
  }
  const intensityPct = parseWorkoutIntensityV2(e2.intensityInput)
  if (intensityPct === null) return { valid: false, errors: { intensity: 'Saisissez une intensité de 1 à 300 %, avec une virgule ou un point.' } }
  const saved = e2.savedPlan
  const sameRounding = saved && e2.rounding.mode === saved.rounding.mode && (e2.rounding.mode === 'exact' ||
    (saved.rounding.mode !== 'exact' && e2.rounding.increment === saved.rounding.increment))
  if (saved && intensityPct === saved.intensityPct && sameRounding &&
    JSON.stringify(e2.reference) === JSON.stringify(saved.reference)) return { valid: true, plan: structuredClone(saved) }
  if (records === null) return { valid: false, errors: { reference: 'Records indisponibles. Relisez les Records avant un nouveau calcul.' } }
  if (!e2.reference) return { valid: false, errors: { reference: 'Choisissez explicitement un Record de référence, ou utilisez la charge libre.' } }
  const record = records.find((item) => item.exerciseId === e2.reference?.exerciseId)
  if (!record) return { valid: false, errors: { reference: 'Cette référence n’est plus disponible. Choisissez un Record ou la charge libre.' } }
  if (record.oneRepMaxKg !== e2.reference.oneRepMaxKg) return { valid: false, errors: { reference: 'Le Record a changé depuis votre choix. Actualisez explicitement la référence.' } }
  const result = calculateWorkoutLoad(record.oneRepMaxKg, intensityPct, e2.rounding)
  if (result.status !== 'ready') return { valid: false, errors: { load: 'Calcul indisponible. Vérifiez les valeurs et l’arrondi.' } }
  const plan: LoadPlan = { method: 'percentage', intensityPct, rounding: { ...e2.rounding }, reference: recordSnapshot(record), load: result.load }
  return isLoadPlan(plan) ? { valid: true, plan } : { valid: false, errors: { load: 'Programmation incohérente.' } }
}

export function getAppSetLoad(set: AppSetDraft, records: PersonalRecord[] | null, exerciseId: string) {
  if (!set.e2 || set.e2.method === 'legacy') {
    const record = isRecordExerciseId(exerciseId) ? records?.find((item) => item.exerciseId === exerciseId) : undefined
    return getWorkoutSetLoad(set, record?.oneRepMaxKg)
  }
  const result = resolveE2Load(set.e2, records)
  if (!result.valid || parseRepetitions(set.repsInput) === null) return { status: 'invalid-input' as const }
  const plan = result.plan
  return plan === null ? { status: 'unavailable' as const } : plan.method === 'manual'
    ? { status: 'ready' as const, exactKg: plan.loadKg, selectedKg: plan.loadKg }
    : { status: 'ready' as const, ...plan.load }
}

export function validateAppWorkoutDraft(draft: AppWorkoutDraft, records: PersonalRecord[] | null = []): AppDraftValidation {
  const projection = { ...draft, exercises: draft.exercises.map((block) => ({ ...block, sets: block.sets.map((set) => {
    if (!set.e2 || set.e2.method === 'legacy') return set
    return { id: set.id, repsInput: set.repsInput, intensityInput: '1', rounding: { mode: 'exact' as const }, savedLoad: null }
  }) })) }
  const base = validateWorkoutDraft(projection, records?.filter((record) => isRecordExerciseId(record.exerciseId)) ?? [])
  const errors: AppDraftErrors = base.errors
  let valid = base.valid
  const exercises = draft.exercises.map((block) => ({ id: block.id, exerciseId: block.exerciseId, sets: block.sets.flatMap((set): AppWorkoutSet[] => {
    if (!set.e2 || set.e2.method === 'legacy') {
      const found = base.workout?.exercises.find((item) => item.id === block.id)?.sets.find((item) => item.id === set.id)
      return found ? [found] : []
    }
    const result = resolveE2Load(set.e2, records)
    if (!result.valid) {
      valid = false
      errors.blocks[block.id].fields[set.id] = { ...errors.blocks[block.id].fields[set.id], ...result.errors }
      return []
    }
    const reps = parseRepetitions(set.repsInput)
    return reps === null ? [] : [{ schemaVersion: 2, kind: 'load-reps', id: set.id, reps, loading: result.plan }]
  }) }))
  return valid ? { valid: true, errors, workout: { id: draft.id, title: draft.title.trim(), date: draft.date,
    status: 'planned', notes: { ...draft.notes }, exercises } } : { valid: false, errors, workout: null }
}
