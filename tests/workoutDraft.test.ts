import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createWorkoutDraft,
  createWorkoutExerciseDraft,
  createWorkoutSetDraft,
  getWorkoutSetLoad,
  hasWorkoutExerciseData,
  isValidWorkoutDate,
  localDateString,
  parseRepetitions,
  parseWorkoutIntensity,
  updateDraftExercise,
  updateDraftSet,
  validateWorkoutDraft,
} from '../src/lib/workoutDraft.ts'
import type { WorkoutDraft, WorkoutSetRounding } from '../src/types/workout.ts'

function validDraft(): WorkoutDraft {
  const block = createWorkoutExerciseDraft('snatch')
  return {
    ...createWorkoutDraft(new Date(2026, 10, 2)),
    title: '  Technique  ',
    exercises: [{ ...block, sets: [{ ...block.sets[0], repsInput: '3', intensityInput: '73,3' }] }],
  }
}

describe('dates des séances', () => {
  it('construit la date depuis les composantes locales, sans conversion UTC', () => {
    const date = new Date(2026, 0, 2, 0, 15)
    date.toISOString = () => { throw new Error('Ne pas convertir en UTC') }
    assert.equal(localDateString(date), '2026-01-02')
    assert.equal(createWorkoutDraft(date).date, '2026-01-02')
    assert.equal(localDateString(new Date(2026, 11, 31, 23, 59)), '2026-12-31')
  })

  it('valide les vraies dates, y compris les années bissextiles et les dates libres', () => {
    for (const date of ['0001-01-01', '2000-02-29', '2024-02-29', '2020-01-01', '2099-12-31']) {
      assert.equal(isValidWorkoutDate(date), true, date)
    }
    for (const date of ['', ' ', '2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '0000-01-01', '2026-1-02', '02/11/2026', '2026-11-02T00:00:00Z']) {
      assert.equal(isValidWorkoutDate(date), false, date)
    }
  })
})

describe('saisies des séries', () => {
  it('accepte uniquement des répétitions entières positives représentables exactement', () => {
    assert.equal(parseRepetitions(' 003 '), 3)
    for (const input of ['', ' ', '0', '-1', '2.5', '2,5', '3.', '1e2', '0x10', 'NaN', 'Infinity', '9007199254740993']) {
      assert.equal(parseRepetitions(input), null, input)
    }
  })

  it('réutilise les bornes d’intensité et accepte virgule ou point sans valider une saisie incomplète', () => {
    for (const [input, expected] of [['1', 1], ['100', 100], ['73,3', 73.3], ['73.3', 73.3], [' 75 ', 75]] as const) {
      assert.equal(parseWorkoutIntensity(input), expected)
    }
    for (const input of ['', ' ', '75,', '75.', ',', '.', '0', '0,99', '100,1', '100.000000000000001', '-1', 'Infinity', 'NaN', '1e2', 'a']) {
      assert.equal(parseWorkoutIntensity(input), null, input)
    }
  })
})

describe('brouillon et transformation métier', () => {
  it('distingue un bloc vierge des saisies ou paramètres à protéger avant retrait', () => {
    const empty = createWorkoutExerciseDraft()
    assert.equal(hasWorkoutExerciseData(empty), false)
    assert.equal(hasWorkoutExerciseData({ ...empty, sets: [] }), false)
    assert.equal(hasWorkoutExerciseData(createWorkoutExerciseDraft('clean-and-jerk')), true)
    assert.equal(hasWorkoutExerciseData({ ...empty, sets: [...empty.sets, createWorkoutSetDraft()] }), true)
    for (const fields of [
      { repsInput: '0' }, { repsInput: ' ' }, { intensityInput: '75,' },
      { rounding: { mode: 'up', increment: 2.5 } as const }, { savedLoad: null },
    ]) {
      assert.equal(hasWorkoutExerciseData({ ...empty, sets: [{ ...empty.sets[0], ...fields }] }), true)
    }
    assert.equal(hasWorkoutExerciseData(validDraft().exercises[0]), true)
  })

  it('initialise un brouillon et des séries sans recommandations de répétitions ou d’intensité', () => {
    const draft = createWorkoutDraft()
    const block = createWorkoutExerciseDraft()
    assert.equal(draft.title, '')
    assert.deepEqual(draft.exercises, [])
    assert.equal(block.sets[0].repsInput, '')
    assert.equal(block.sets[0].intensityInput, '')
    assert.deepEqual(block.sets[0].rounding, { mode: 'exact' })
  })

  it('autorise les doublons de mouvement avec des identifiants distincts pour chaque bloc et série', () => {
    const draft = validDraft()
    draft.exercises.push(createWorkoutExerciseDraft('snatch'))
    const ids = draft.exercises.flatMap((block) => [block.id, ...block.sets.map((set) => set.id)])
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(draft.exercises[0].exerciseId, draft.exercises[1].exerciseId)
  })

  it('met à jour immuablement les seules séries ciblées et préserve toutes les identités', () => {
    const draft = validDraft()
    const extraSet = createWorkoutSetDraft()
    draft.exercises[0].sets.push(extraSet)
    draft.exercises.push(createWorkoutExerciseDraft('snatch'))
    const original = structuredClone(draft)
    const block = draft.exercises[0]
    const set = block.sets[0]
    const next = updateDraftSet(draft, block.id, set.id, { intensityInput: '75,' })
    assert.deepEqual(draft, original)
    assert.notEqual(next, draft)
    assert.notEqual(next.exercises[0], block)
    assert.notEqual(next.exercises[0].sets[0], set)
    assert.equal(next.exercises[0].sets[0].id, set.id)
    assert.equal(next.exercises[0].sets[0].intensityInput, '75,')
    assert.equal(next.exercises[0].sets[1], extraSet)
    assert.equal(next.exercises[1], draft.exercises[1])
    const changed = updateDraftExercise(next, block.id, (current) => ({ ...current, exerciseId: 'front-squat' }))
    assert.equal(changed.exercises[0].id, block.id)
    assert.equal(changed.exercises[0].sets, next.exercises[0].sets)
  })

  it('associe les erreurs aux identifiants et conserve toutes les saisies invalides', () => {
    const draft = validDraft()
    draft.title = '   '
    draft.date = '2026-02-30'
    const block = draft.exercises[0]
    block.sets[0].repsInput = ''
    block.sets[0].intensityInput = '75,'
    const before = structuredClone(draft)
    const result = validateWorkoutDraft(draft)
    assert.equal(result.valid, false)
    assert.equal(result.workout, null)
    assert.ok(result.errors.title)
    assert.ok(result.errors.date)
    assert.ok(result.errors.blocks[block.id].fields[block.sets[0].id].reps)
    assert.ok(result.errors.blocks[block.id].fields[block.sets[0].id].intensity)
    assert.deepEqual(draft, before)
  })

  it('accepte l’édition sans exercice ou série mais refuse leur transformation métier', () => {
    const draft = validDraft()
    draft.exercises[0].sets = []
    assert.ok(validateWorkoutDraft(draft).errors.blocks[draft.exercises[0].id].sets)
    draft.exercises = []
    assert.ok(validateWorkoutDraft(draft).errors.exercises)
  })

  it('produit un modèle numérique sérialisable sans dépendance aux records ni mutation du titre', () => {
    const draft = validDraft()
    const result = validateWorkoutDraft(draft)
    assert.equal(result.valid, true)
    if (!result.valid) return
    assert.equal(result.workout.title, 'Technique')
    assert.equal(draft.title, '  Technique  ')
    assert.deepEqual(result.workout.exercises[0].sets[0], {
      id: draft.exercises[0].sets[0].id, reps: 3, intensityPct: 73.3, rounding: { mode: 'exact' }, load: null,
    })
    assert.deepEqual(JSON.parse(JSON.stringify(result.workout)), result.workout)
  })
})

describe('charges dérivées du brouillon', () => {
  it('calcule la charge exacte avec le calculateur existant, et réagit au nouveau record', () => {
    const set = validDraft().exercises[0].sets[0]
    assert.deepEqual(getWorkoutSetLoad(set, 82.5), { status: 'ready', exactKg: 60.4725, selectedKg: 60.4725 })
    assert.deepEqual(getWorkoutSetLoad(set, 100), { status: 'ready', exactKg: 73.3, selectedKg: 73.3 })
    assert.deepEqual(getWorkoutSetLoad({ ...set, intensityInput: '100' }, 100), { status: 'ready', exactKg: 100, selectedKg: 100 })
  })

  it('distingue record manquant, saisie invalide et calcul indisponible, sans faux 0 kg', () => {
    const set = validDraft().exercises[0].sets[0]
    assert.deepEqual(getWorkoutSetLoad(set, undefined), { status: 'missing-record' })
    for (const oneRepMax of [0, -1, Infinity, NaN]) {
      assert.deepEqual(getWorkoutSetLoad(set, oneRepMax), { status: 'unavailable' })
    }
    assert.deepEqual(getWorkoutSetLoad({ ...set, intensityInput: '1' }, Number.MIN_VALUE), { status: 'unavailable' })
    for (const fields of [{ repsInput: '' }, { repsInput: '2.5' }, { intensityInput: '' }, { intensityInput: '75,' }, { intensityInput: '101' }]) {
      assert.deepEqual(getWorkoutSetLoad({ ...set, ...fields }, 100), { status: 'invalid-input' })
    }
  })

  it('conserve la charge exacte et recalcule la charge choisie quand le record change', () => {
    const base = { ...validDraft().exercises[0].sets[0], intensityInput: '85' }
    for (const [increment, down, up] of [[1, 9, 10], [2.5, 7.5, 10], [5, 5, 10]] as const) {
      assert.deepEqual(getWorkoutSetLoad({ ...base, rounding: { mode: 'down', increment } }, 11), {
        status: 'ready', exactKg: 9.35, selectedKg: down,
      })
      assert.deepEqual(getWorkoutSetLoad({ ...base, rounding: { mode: 'up', increment } }, 11), {
        status: 'ready', exactKg: 9.35, selectedKg: up,
      })
    }
    const set = { ...base, rounding: { mode: 'down', increment: 2.5 } as const }
    assert.deepEqual(getWorkoutSetLoad(set, 14), { status: 'ready', exactKg: 11.9, selectedKg: 10 })
    assert.deepEqual(getWorkoutSetLoad({ ...set, rounding: { mode: 'exact' } }, 11), {
      status: 'ready', exactKg: 9.35, selectedKg: 9.35,
    })
    assert.deepEqual(getWorkoutSetLoad(set, undefined), { status: 'missing-record' })
  })

  it('ne confond pas un arrondi inférieur choisi à zéro avec un record manquant', () => {
    const set = { ...validDraft().exercises[0].sets[0], intensityInput: '1', rounding: { mode: 'down', increment: 5 } as const }
    assert.deepEqual(getWorkoutSetLoad(set, 100), { status: 'ready', exactKg: 1, selectedKg: 0 })
    assert.deepEqual(getWorkoutSetLoad(set, undefined), { status: 'missing-record' })
  })

  it('préserve le choix indépendant de chaque série et représente la charge manquante explicitement', () => {
    const draft = validDraft()
    const block = draft.exercises[0]
    block.sets.push({ ...block.sets[0], id: crypto.randomUUID() })
    const next = updateDraftSet(draft, block.id, block.sets[0].id, { rounding: { mode: 'up', increment: 2.5 } })
    assert.deepEqual(draft.exercises[0].sets[0].rounding, { mode: 'exact' })
    assert.equal(next.exercises[0].sets[1], block.sets[1])
    assert.deepEqual(next.exercises[0].sets[1].rounding, { mode: 'exact' })
    const result = validateWorkoutDraft(next)
    assert.equal(result.valid, true)
    if (!result.valid) return
    assert.deepEqual(result.workout.exercises[0].sets[0].rounding, { mode: 'up', increment: 2.5 })
    assert.deepEqual(result.workout.exercises[0].sets[1].rounding, { mode: 'exact' })
    assert.notEqual(result.workout.exercises[0].sets[0].rounding, next.exercises[0].sets[0].rounding)
    assert.deepEqual(JSON.parse(JSON.stringify(result.workout)), result.workout)
    assert.equal('selectedKg' in result.workout.exercises[0].sets[0], false)
    assert.equal(result.workout.exercises[0].sets[0].load, null)
  })

  it('refuse une configuration d’arrondi mal formée sans afficher une charge', () => {
    for (const rounding of [undefined, null, 'exact', { mode: 'nearest', increment: 1 }, { mode: 'down' }, { mode: 'up', increment: 3 }, { mode: 'down', increment: NaN }]) {
      const draft = validDraft()
      const block = draft.exercises[0]
      block.sets[0].rounding = rounding as WorkoutSetRounding
      const result = validateWorkoutDraft(draft)
      assert.equal(result.valid, false)
      assert.ok(result.errors.blocks[block.id].fields[block.sets[0].id].rounding)
      assert.deepEqual(getWorkoutSetLoad(block.sets[0], 100), { status: 'invalid-input' })
    }
  })
})
