import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasStoredWorkoutExecution, sameStoredSetExecution, storedWorkoutProgramSignature } from '../src/lib/workoutComparison.ts'
import { hasWorkoutExecution, sameExecution, workoutProgramSignature } from '../src/lib/workoutExecution.ts'
import type { LegacyWorkoutSet, StoredWorkout, StoredWorkoutSet, Workout, WorkoutSetV2 } from '../src/types/workout.ts'

function legacySet(): LegacyWorkoutSet {
  return { id: 'legacy', reps: 3, intensityPct: 75, rounding: { mode: 'exact' }, load: { exactKg: 60, selectedKg: 60 } }
}

function percentageSet(): Extract<WorkoutSetV2, { kind: 'load-reps' }> {
  return { schemaVersion: 2, id: 'loaded', kind: 'load-reps', reps: 3, loading: {
    method: 'percentage', intensityPct: 110, rounding: { mode: 'exact' },
    reference: { source: 'record', exerciseId: 'clean', exerciseName: 'Clean', oneRepMaxKg: 100 },
    load: { exactKg: 110, selectedKg: 110 },
  } }
}

function workout(sets: StoredWorkoutSet[]): StoredWorkout {
  return { id: 'workout', title: 'Technique', date: '2026-11-19', status: 'planned',
    notes: { before: '', during: '', after: '' }, exercises: [{ id: 'block', exerciseId: 'clean-pull', sets }] }
}

describe('signatures et comparaisons historiques préservées', () => {
  it('produit exactement la signature historique et la même détection de suivi', () => {
    const source: Workout = { id: 'workout', title: 'Technique', date: '2026-11-19', status: 'planned',
      notes: { before: '', during: '', after: '' }, exercises: [{ id: 'block', exerciseId: 'snatch', sets: [legacySet()] }] }
    assert.equal(storedWorkoutProgramSignature(source), workoutProgramSignature(source))
    assert.equal(hasStoredWorkoutExecution(source), hasWorkoutExecution(source))
    source.exercises[0].sets[0].execution = { completed: false, reps: null, loadKg: null }
    assert.equal(storedWorkoutProgramSignature(source), workoutProgramSignature(source))
    assert.equal(hasStoredWorkoutExecution(source), true)
  })

  it('conserve toutes les comparaisons V1, y compris anciens zéros et effacements', () => {
    const executions = [undefined,
      { completed: false, reps: null, loadKg: null },
      { completed: false, reps: null, loadKg: null, cleared: { loadKg: true } },
      { completed: true, reps: 0, loadKg: 0 },
      { completed: true, reps: 2, loadKg: Number.MAX_VALUE },
    ] as const
    for (const left of executions) for (const right of executions) {
      assert.equal(sameStoredSetExecution({ ...legacySet(), execution: left }, { ...legacySet(), execution: right }), sameExecution(left, right))
    }
  })
})

describe('signature future de toute la programmation', () => {
  it('détecte une référence différente, même avec le même 1RM et les mêmes kg', () => {
    const set = percentageSet()
    if (set.loading?.method !== 'percentage') throw new Error('Fixture incorrecte')
    const changed = { ...set, loading: { ...set.loading, reference: { ...set.loading.reference, exerciseId: 'snatch' as const } } }
    assert.notEqual(storedWorkoutProgramSignature(workout([changed])), storedWorkoutProgramSignature(workout([set])))
  })

  it('détecte la valeur du snapshot et le nom sauvegardé indépendamment du reste', () => {
    const set = percentageSet()
    if (set.loading?.method !== 'percentage') throw new Error('Fixture incorrecte')
    for (const patch of [{ oneRepMaxKg: 105 }, { exerciseName: 'Épaulé' }]) {
      const changed = { ...set, loading: { ...set.loading, reference: { ...set.loading.reference, ...patch } } }
      assert.notEqual(storedWorkoutProgramSignature(workout([changed])), storedWorkoutProgramSignature(workout([set])))
    }
  })

  it('détecte méthode, intensité, arrondi, charges exacte et sélectionnée', () => {
    const set = percentageSet()
    if (set.loading?.method !== 'percentage') throw new Error('Fixture incorrecte')
    const variants: StoredWorkoutSet[] = [
      { ...set, loading: null },
      { ...set, loading: { method: 'manual', loadKg: 110 } as const },
      { ...set, loading: { ...set.loading, intensityPct: 111 } },
      { ...set, loading: { ...set.loading, rounding: { mode: 'up', increment: 2.5 } as const } },
      { ...set, loading: { ...set.loading, load: { exactKg: 110.1, selectedKg: 110 } } },
      { ...set, loading: { ...set.loading, load: { exactKg: 110, selectedKg: 112.5 } } },
    ]
    for (const changed of variants) assert.notEqual(storedWorkoutProgramSignature(workout([changed])), storedWorkoutProgramSignature(workout([set])))
    assert.notEqual(storedWorkoutProgramSignature(workout([{ ...set, loading: { method: 'manual', loadKg: 85 } as const }])),
      storedWorkoutProgramSignature(workout([{ ...set, loading: { method: 'manual', loadKg: 87 } as const }])))
  })

  it('détecte durée, répétitions, type, version, identifiants, mouvement et ordre', () => {
    const time: WorkoutSetV2 = { schemaVersion: 2, id: 'time', kind: 'duration', durationSeconds: 45 }
    assert.notEqual(storedWorkoutProgramSignature(workout([time])), storedWorkoutProgramSignature(workout([{ ...time, durationSeconds: 46 }])))
    const reps: WorkoutSetV2 = { schemaVersion: 2, id: 'reps', kind: 'reps', reps: 10 }
    assert.notEqual(storedWorkoutProgramSignature(workout([reps])), storedWorkoutProgramSignature(workout([{ ...reps, reps: 11 }])))
    assert.notEqual(storedWorkoutProgramSignature(workout([reps])), storedWorkoutProgramSignature(workout([
      { schemaVersion: 2, id: reps.id, kind: 'load-reps', reps: reps.reps, loading: null },
    ])))
    const source = workout([legacySet(), percentageSet()])
    const variants: StoredWorkout[] = [
      { ...source, id: 'other' }, { ...source, title: 'Autre titre' }, { ...source, date: '2026-11-20' }, { ...source, status: 'completed' },
      { ...source, exercises: [{ ...source.exercises[0], id: 'other-block' }] },
      { ...source, exercises: [{ ...source.exercises[0], exerciseId: 'snatch' }] },
      workout([...source.exercises[0].sets].reverse()), workout([{ ...legacySet(), id: 'other-set' }, percentageSet()]),
      workout([legacySet()]),
    ]
    for (const changed of variants) assert.notEqual(storedWorkoutProgramSignature(changed), storedWorkoutProgramSignature(source))
    assert.notEqual(storedWorkoutProgramSignature(workout([legacySet()])),
      storedWorkoutProgramSignature(workout([{ ...percentageSet(), id: 'legacy', loading: null }])))
    const blocks = { ...source, exercises: [...source.exercises, { id: 'second', exerciseId: 'snatch' as const, sets: [{ ...legacySet(), id: 'second-set' }] }] }
    assert.notEqual(storedWorkoutProgramSignature(blocks), storedWorkoutProgramSignature({ ...blocks, exercises: [...blocks.exercises].reverse() }))
  })

  it('ignore notes et performances et ne modifie pas les objets fournis', () => {
    const source = workout([percentageSet()]), before = structuredClone(source)
    const changed = structuredClone(source)
    changed.notes = { before: 'Avant', during: 'Pendant', after: 'Après' }
    const set = changed.exercises[0].sets[0]
    if (set.schemaVersion !== 2 || set.kind !== 'load-reps') throw new Error('Fixture incorrecte')
    set.execution = { completed: true, reps: 3, loadKg: 87 }
    assert.equal(storedWorkoutProgramSignature(changed), storedWorkoutProgramSignature(source))
    assert.equal(sameStoredSetExecution(source.exercises[0].sets[0], set), false)
    assert.deepEqual(source, before)
  })
})

describe('comparaison future des résultats et effacements', () => {
  it('détecte une modification de durée seule, sans toucher au programme', () => {
    const left: WorkoutSetV2 = { schemaVersion: 2, id: 'time', kind: 'duration', durationSeconds: 45, execution: { completed: true, durationSeconds: 45 } }
    const right = { ...left, execution: { completed: true as const, durationSeconds: 40 } }
    assert.equal(sameStoredSetExecution(left, structuredClone(left)), true)
    assert.equal(sameStoredSetExecution(left, right), false)
    assert.equal(storedWorkoutProgramSignature(workout([left])), storedWorkoutProgramSignature(workout([right])))
  })

  it('compare répétitions, kg et confirmations selon leur variante', () => {
    const loaded = { ...percentageSet(), execution: { completed: true as const, reps: 3, loadKg: 85 } }
    for (const execution of [{ completed: true, reps: 2, loadKg: 85 }, { completed: true, reps: 3, loadKg: 87 },
      { completed: false, reps: 3, loadKg: 85 }] as const) {
      assert.equal(sameStoredSetExecution(loaded, { ...loaded, execution }), false)
    }
    const reps: WorkoutSetV2 = { schemaVersion: 2, id: 'reps', kind: 'reps', reps: 10, execution: { completed: true, reps: 10 } }
    assert.equal(sameStoredSetExecution(reps, { ...reps, execution: { completed: true, reps: 9 } }), false)
    assert.equal(sameStoredSetExecution(reps, { ...reps, execution: { completed: false, reps: 10 } }), false)
  })

  it('distingue résultat absent, champ intact et effacement explicite pour les trois variantes', () => {
    const cases: WorkoutSetV2[] = [
      { ...percentageSet(), execution: { completed: false, reps: null, loadKg: null } },
      { schemaVersion: 2, id: 'reps', kind: 'reps', reps: 10, execution: { completed: false, reps: null } },
      { schemaVersion: 2, id: 'time', kind: 'duration', durationSeconds: 45, execution: { completed: false, durationSeconds: null } },
    ]
    for (const set of cases) {
      assert.equal(sameStoredSetExecution(set, structuredClone(set)), true)
      const unstarted = { ...set }
      delete unstarted.execution
      assert.equal(sameStoredSetExecution(set, unstarted), false)
      assert.equal(hasStoredWorkoutExecution(workout([set])), true)
      assert.equal(hasStoredWorkoutExecution(workout([unstarted])), false)
    }
    const loaded = cases[0]
    if (loaded.kind !== 'load-reps') throw new Error('Fixture incorrecte')
    for (const field of ['reps', 'loadKg'] as const) assert.equal(sameStoredSetExecution(loaded, {
      ...loaded, execution: { completed: false, reps: null, loadKg: null, cleared: { [field]: true } },
    }), false)
    const reps = cases[1]
    if (reps.kind !== 'reps') throw new Error('Fixture incorrecte')
    assert.equal(sameStoredSetExecution(reps, { ...reps, execution: { completed: false, reps: null, cleared: { reps: true } } }), false)
    const time = cases[2]
    if (time.kind !== 'duration') throw new Error('Fixture incorrecte')
    assert.equal(sameStoredSetExecution(time, { ...time, execution: { completed: false, durationSeconds: null, cleared: { durationSeconds: true } as const } }), false)
  })

  it('ne confond pas deux types de suivi ni deux formats sans résultat', () => {
    assert.equal(sameStoredSetExecution(legacySet(), percentageSet()), false)
    assert.equal(sameStoredSetExecution(percentageSet(), { schemaVersion: 2, id: 'reps', kind: 'reps', reps: 3 }), false)
  })
})
