import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createWorkout, loadWorkouts, workoutsStorageKey, type WorkoutStorage } from '../src/data/workouts.ts'
import {
  createWorkoutDraft, createWorkoutExerciseDraft, createWorkoutSetDraft, duplicateWorkoutDraft, duplicateWorkoutSetDraft,
  getWorkoutSetLoad, updateDraftSet, validateWorkoutDraft, workoutToDraft,
} from '../src/lib/workoutDraft.ts'
import type { Workout, WorkoutDraft, WorkoutSetDraft, WorkoutSetRounding } from '../src/types/workout.ts'

function sourceWorkout(): Workout {
  const draft = createWorkoutDraft(new Date(2026, 9, 22))
  draft.title = 'Programmation lundi'
  draft.notes = { before: '  Barre proche\nObjectif technique\n', during: 'Observation ancienne', after: 'Bilan ancien' }
  draft.exercises = [createWorkoutExerciseDraft('snatch'), createWorkoutExerciseDraft('clean-and-jerk')]
  draft.exercises = draft.exercises.map((block) => ({ ...block, sets: [0, 1].map(() => ({
    ...createWorkoutSetDraft(), repsInput: '3', intensityInput: '80', rounding: { mode: 'down', increment: 2.5 },
  })) }))
  return validate(draft, 100)
}

function validate(draft: WorkoutDraft, record?: number): Workout {
  const result = validateWorkoutDraft(draft, record === undefined ? [] : [
    { exerciseId: 'snatch', oneRepMaxKg: record }, { exerciseId: 'clean-and-jerk', oneRepMaxKg: record },
  ])
  assert.equal(result.valid, true)
  if (!result.valid) throw new Error('Fixture invalide')
  return result.workout
}

const allIds = (value: Workout | WorkoutDraft) => [value.id, ...value.exercises.flatMap((block) => [block.id, ...block.sets.map((set) => set.id)])]

describe('ajout vierge et duplication explicite d’une série', () => {
  it('produit cinq séries indépendantes avec paramètres et charges identiques', () => {
    const first: WorkoutSetDraft = { ...createWorkoutSetDraft(), repsInput: '3', intensityInput: '80', rounding: { mode: 'down', increment: 2.5 } }
    const sets = [first]
    for (let index = 0; index < 4; index++) sets.push(duplicateWorkoutSetDraft(sets.at(-1)!))
    assert.equal(new Set(sets.map((set) => set.id)).size, 5)
    for (const set of sets) {
      assert.equal(set.repsInput, '3')
      assert.equal(set.intensityInput, '80')
      assert.deepEqual(set.rounding, { mode: 'down', increment: 2.5 })
      assert.deepEqual(getWorkoutSetLoad(set, 120), { status: 'ready', exactKg: 96, selectedKg: 95 })
    }
    assert.notEqual(sets[1].rounding, first.rounding)
    sets[1].repsInput = '5'
    sets[1].intensityInput = '90'
    sets[1].rounding = { mode: 'up', increment: 5 }
    assert.equal(first.repsInput, '3')
    assert.equal(first.intensityInput, '80')
    assert.deepEqual(first.rounding, { mode: 'down', increment: 2.5 })
  })

  it('ajoute une série vierge après une programmation existante, sans charge ni résultat', () => {
    const source = validSource()
    const added = createWorkoutSetDraft()
    assert.notEqual(added.id, source.id)
    assert.deepEqual(added, { id: added.id, repsInput: '', intensityInput: '', rounding: { mode: 'exact' } })
    assert.deepEqual(getWorkoutSetLoad(added, 100), { status: 'invalid-input' })
    const draft = workoutToDraft(sourceWorkout())
    draft.exercises[0].sets.push(added)
    assert.equal(validateWorkoutDraft(draft).valid, false)
  })

  it('duplique les saisies incomplètes ou invalides sans contourner la validation', () => {
    const first: WorkoutSetDraft = { ...createWorkoutSetDraft(), repsInput: '3', intensityInput: '80', rounding: { mode: 'exact' } }
    for (const previous of [{ ...first, repsInput: '' }, { ...first, intensityInput: '75,' },
      { ...first, repsInput: '2.5' }, { ...first, intensityInput: '101' },
      { ...first, rounding: { mode: 'up', increment: 3 } as unknown as WorkoutSetRounding }]) {
      const copy = duplicateWorkoutSetDraft(previous)
      assert.notEqual(copy.id, previous.id)
      assert.equal(copy.repsInput, previous.repsInput)
      assert.equal(copy.intensityInput, previous.intensityInput)
      assert.deepEqual(copy.rounding, previous.rounding)
      assert.notEqual(copy.rounding, previous.rounding)
      assert.deepEqual(getWorkoutSetLoad(copy, 100), { status: 'invalid-input' })
      const draft = workoutToDraft(sourceWorkout())
      draft.exercises[0].sets.push(copy)
      assert.equal(validateWorkoutDraft(draft).valid, false)
    }
  })

  it('ne reprend pas la charge figée en édition : seule la nouvelle série suit le 1RM actuel', () => {
    const source = sourceWorkout()
    const draft = workoutToDraft(source)
    const block = draft.exercises[0]
    const previous = block.sets.at(-1)!
    const copy = duplicateWorkoutSetDraft(previous)
    assert.equal('savedLoad' in copy, false)
    block.sets.push(copy)
    const result = validate(draft, 120)
    assert.deepEqual(result.exercises[0].sets.slice(0, 2), source.exercises[0].sets)
    assert.deepEqual(result.exercises[0].sets[2].load, { exactKg: 96, selectedKg: 95 })
    assert.deepEqual(result.exercises[1], source.exercises[1])
    assert.deepEqual(getWorkoutSetLoad(copy, undefined), { status: 'missing-record' })
  })

  it('prend la dernière saisie valide, préserve virgule et point, sans copier une absence figée', () => {
    for (const intensityInput of ['73,3', '73.3']) {
      const previous = { ...createWorkoutSetDraft(), repsInput: '03', intensityInput, savedLoad: null }
      const copy = duplicateWorkoutSetDraft(previous)
      assert.equal(copy.repsInput, '03')
      assert.equal(copy.intensityInput, intensityInput)
      assert.deepEqual(getWorkoutSetLoad(copy, 100), { status: 'ready', exactKg: 73.3, selectedKg: 73.3 })
    }
  })

  it('exclut toute observation d’exécution et persiste les identités après enregistrement', () => {
    const previous = { ...validSource(), execution: { completed: true, reps: 2, loadKg: 70, cleared: { reps: true } } }
    const before = structuredClone(previous)
    const copy = duplicateWorkoutSetDraft(previous)
    assert.deepEqual(Object.keys(copy).sort(), ['id', 'intensityInput', 'repsInput', 'rounding'])
    assert.deepEqual(previous, before)
    const draft = workoutToDraft(sourceWorkout())
    draft.exercises[0].sets.splice(1, 0, copy)
    const saved = validate(draft, 100)
    let raw: string | null = null
    const storage: WorkoutStorage = { getItem: () => raw, setItem: (_, value) => { raw = value } }
    assert.equal(createWorkout(saved, storage).ok, true)
    assert.deepEqual(loadWorkouts(storage), { ok: true, workouts: [saved] })
    assert.equal(saved.exercises[0].sets[1].id, copy.id)
    assert.equal(saved.exercises[0].sets[1].execution, undefined)
  })

  it('conserve les résultats d’arrondi pour une charge exacte de 74,4 kg', () => {
    for (const [increment, down, up] of [[1, 74, 75], [2.5, 72.5, 75], [5, 70, 75]] as const) {
      for (const [mode, selectedKg] of [['down', down], ['up', up]] as const) {
        const copy = duplicateWorkoutSetDraft({ ...validSource(), intensityInput: '74,4', rounding: { mode, increment } })
        assert.deepEqual(getWorkoutSetLoad(copy, 100), { status: 'ready', exactKg: 74.4, selectedKg })
      }
    }
  })
})

function validSource(): WorkoutSetDraft {
  return { ...createWorkoutSetDraft(), repsInput: '03', intensityInput: '74,4', rounding: { mode: 'up', increment: 2.5 }, savedLoad: { exactKg: 60, selectedKg: 60 } }
}

describe('duplication d’une séance vers un brouillon', () => {
  it('copie les paramètres dans le même ordre, avec de nouvelles identités', () => {
    const source = sourceWorkout()
    const before = structuredClone(source)
    const draft = duplicateWorkoutDraft(source)
    assert.equal(draft.title, 'Programmation lundi — copie')
    assert.deepEqual(draft.exercises.map((block) => block.exerciseId), source.exercises.map((block) => block.exerciseId))
    assert.deepEqual(draft.exercises.map((block) => block.sets.map((set) => [set.repsInput, set.intensityInput, set.rounding])),
      source.exercises.map((block) => block.sets.map((set) => [String(set.reps), String(set.intensityPct), set.rounding])))
    const ids = [...allIds(source), ...allIds(draft), ...allIds(duplicateWorkoutDraft(source))]
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual(source, before)
  })

  it('utilise la date locale et ne copie que les consignes Avant', () => {
    const source = { ...sourceWorkout(), status: 'completed' as const }
    const today = new Date(2026, 10, 5, 0, 15)
    today.toISOString = () => { throw new Error('Pas de conversion UTC') }
    const draft = duplicateWorkoutDraft(source, today)
    assert.equal(draft.date, '2026-11-05')
    assert.deepEqual(draft.notes, { before: source.notes.before, during: '', after: '' })
    assert.notEqual(draft.notes, source.notes)
    assert.equal(validate(draft).status, 'planned')
  })

  it('recalcule les charges avec les Records actuels et reste sans charge si le record manque', () => {
    const source = sourceWorkout()
    const draft = duplicateWorkoutDraft(source)
    for (const block of draft.exercises) for (const set of block.sets) {
      assert.equal('savedLoad' in set, false)
      assert.deepEqual(getWorkoutSetLoad(set, 120), { status: 'ready', exactKg: 96, selectedKg: 95 })
      assert.deepEqual(getWorkoutSetLoad(set, undefined), { status: 'missing-record' })
    }
    assert.deepEqual(validate(draft, 120).exercises[0].sets[0].load, { exactKg: 96, selectedKg: 95 })
    assert.equal(validate(draft).exercises[0].sets[0].load, null)
    assert.deepEqual(source.exercises[0].sets[0].load, { exactKg: 80, selectedKg: 80 })
  })

  it('permet de modifier ou abandonner la copie sans altérer la source', () => {
    const source = sourceWorkout(), original = structuredClone(source)
    const draft = duplicateWorkoutDraft(source)
    draft.title = 'Jeudi'
    draft.notes.before = 'Autre consigne'
    draft.exercises[0].sets[0].rounding.mode = 'up'
    const changed = updateDraftSet(draft, draft.exercises[0].id, draft.exercises[0].sets[0].id, { repsInput: '5', intensityInput: '85' })
    changed.exercises.pop()
    assert.deepEqual(source, original)
    assert.notEqual(draft.exercises[0], source.exercises[0])
    assert.notEqual(draft.exercises[0].sets[0].rounding, source.exercises[0].sets[0].rounding)
  })

  it('n’écrit rien avant sauvegarde, puis crée une seule séance indépendante relisible', () => {
    let raw: string | null = null
    let writes = 0
    const storage: WorkoutStorage = {
      getItem(key) { assert.equal(key, workoutsStorageKey); return raw },
      setItem(key, value) { assert.equal(key, workoutsStorageKey); raw = value; writes++ },
    }
    const source = sourceWorkout()
    assert.equal(createWorkout(source, storage).ok, true)
    const draft = duplicateWorkoutDraft(source)
    assert.equal(writes, 1)
    assert.deepEqual(loadWorkouts(storage), { ok: true, workouts: [source] })
    const saved = validate(draft, 120)
    assert.equal(createWorkout(saved, storage).ok, true)
    assert.deepEqual(loadWorkouts(storage), { ok: true, workouts: [source, saved] })
    assert.equal(createWorkout(saved, storage).ok, false)
    assert.equal(writes, 2)
  })
})
