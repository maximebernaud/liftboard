import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isPersonalRecords, recordsStorageKey } from '../src/data/personalRecords.ts'
import { exportBackup, restoreBackup } from '../src/data/backup.ts'
import { isWorkout, loadWorkouts, workoutsStorageKey } from '../src/data/workouts.ts'
import { validateBackup } from '../src/lib/dataBackup.ts'
import { workoutToDraft, validateWorkoutDraft } from '../src/lib/workoutDraft.ts'
import {
  isDurationExecution, isLegacyWorkoutSet, isLoadPlan, isLoadRepsExecution, isReferenceSnapshot,
  isRepsExecution, isStoredWorkout, isStoredWorkouts, isStoredWorkoutSet, isWorkoutSetV2,
} from '../src/lib/workoutSchema.ts'
import type { LegacyWorkoutSet, LoadPlan, StoredWorkout, StoredWorkoutSet, Workout, WorkoutSetV2 } from '../src/types/workout.ts'

function legacySet(): LegacyWorkoutSet {
  return { id: 'legacy-set', reps: 3, intensityPct: 75, rounding: { mode: 'exact' }, load: { exactKg: 60, selectedKg: 60 } }
}

function percentagePlan(): Extract<LoadPlan, { method: 'percentage' }> {
  return {
    method: 'percentage', intensityPct: 110, rounding: { mode: 'exact' },
    reference: { source: 'record', exerciseId: 'clean', exerciseName: 'Clean', oneRepMaxKg: 100 },
    load: { exactKg: 110, selectedKg: 110 },
  }
}

function loadedSet(): Extract<WorkoutSetV2, { kind: 'load-reps' }> {
  return { schemaVersion: 2, id: 'loaded-set', kind: 'load-reps', reps: 3, loading: percentagePlan() }
}

function stored(sets: StoredWorkoutSet[]): StoredWorkout {
  return {
    id: 'workout', title: 'Séance', date: '2026-11-19', status: 'planned',
    notes: { before: 'Consigne', during: '', after: '' },
    exercises: [{ id: 'block', exerciseId: 'clean-pull', sets }],
  }
}

function legacyWorkout(): Workout {
  return {
    id: 'workout', title: 'Séance historique', date: '2026-11-19', status: 'planned',
    notes: { before: 'Consigne', during: '', after: '' },
    exercises: [{ id: 'block', exerciseId: 'pull-up', sets: [legacySet()] }],
  }
}

describe('reconnaissance historique sans conversion ni durcissement rétroactif', () => {
  it('conserve charge figée, charge absente, états partiels, confirmations et effacements', () => {
    const source: Workout = legacyWorkout()
    const base = legacySet()
    source.exercises[0].sets = [base, { ...base, id: 'missing', load: null },
      { ...base, id: 'partial', execution: { completed: false, reps: 2, loadKg: null } },
      { ...base, id: 'cleared', execution: { completed: false, reps: null, loadKg: 60, cleared: { reps: true } } },
      { ...base, id: 'done', execution: { completed: true, reps: 3, loadKg: 57.5 } }]
    const raw = JSON.stringify(source)
    assert.equal(isWorkout(source), true)
    assert.equal(isStoredWorkout(source), true)
    assert.ok(source.exercises[0].sets.every(isLegacyWorkoutSet))
    assert.equal(JSON.stringify(source), raw)
    assert.equal('kind' in source.exercises[0].sets[0], false)
    assert.equal('schemaVersion' in source.exercises[0].sets[0], false)
    assert.equal(source.exercises[0].exerciseId, 'pull-up')
    const draft = workoutToDraft(source)
    assert.equal(draft.exercises[0].sets[1].savedLoad, null)
    assert.deepEqual(draft.exercises[0].sets[0].savedLoad, base.load)
  })

  it('préserve les anciennes exceptions numériques lisibles et les propriétés supplémentaires', () => {
    for (const loadKg of [0, Number.MAX_VALUE]) {
      const source = legacyWorkout()
      source.exercises[0].sets[0].execution = { completed: true, reps: 0, loadKg }
      const before = structuredClone(source)
      assert.equal(isWorkout(source), true)
      assert.equal(isStoredWorkout(source), true)
      assert.deepEqual(source, before)
    }
    const extra = { ...legacySet(), importedMetadata: 'conservée', rounding: { mode: 'exact', previous: true } }
    assert.equal(isLegacyWorkoutSet(extra), true)
    assert.equal(isLegacyWorkoutSet({ ...legacySet(), load: { exactKg: Number.MAX_VALUE, selectedKg: Number.MAX_VALUE } }), true)
    assert.equal(isLegacyWorkoutSet({ ...legacySet(), rounding: { mode: 'down', increment: 5 }, load: { exactKg: 1, selectedKg: 0 } }), true)
  })

  it('garde les anciennes séances terminées sans exécution lisibles', () => {
    const source = { ...legacyWorkout(), status: 'completed' }
    assert.equal(isWorkout(source), true)
    assert.equal(isStoredWorkout(source), true)
  })

  it('ne recalcule pas une ancienne charge lors de l’édition avec un autre Record', () => {
    const source = legacyWorkout()
    source.exercises[0].exerciseId = 'snatch'
    const result = validateWorkoutDraft(workoutToDraft(source), [{ exerciseId: 'snatch', oneRepMaxKg: 200 }])
    assert.ok(result.valid)
    assert.deepEqual(result.workout, source)
  })

  it('réserve toute présence de schemaVersion au contrat versionné, sans repli V1', () => {
    for (const schemaVersion of [undefined, null, 1, 2, 3, '2']) {
      const hybrid = { ...legacySet(), schemaVersion }
      assert.equal(isLegacyWorkoutSet(hybrid), false)
      assert.equal(isStoredWorkoutSet(hybrid), false)
      const source = legacyWorkout()
      source.exercises[0].sets[0] = hybrid
      assert.equal(isWorkout(source), false)
    }
    const hybrid = { ...legacySet(), ...loadedSet() }
    assert.equal(isStoredWorkoutSet(hybrid), false)
    assert.equal(isLegacyWorkoutSet(hybrid), false)
  })
})

describe('snapshot et méthodes de charge E2 stricts', () => {
  it('reconnaît Clean comme identité canonique sans supposer un Record public disponible', () => {
    const snapshot = percentagePlan().reference
    assert.equal(isReferenceSnapshot(snapshot), true)
    assert.equal(isPersonalRecords([{ exerciseId: 'clean', oneRepMaxKg: 100 }]), true)
  })

  it('refuse source, identité, nom, valeur ou propriétés de snapshot invalides', () => {
    for (const patch of [
      { source: 'temporary' }, { exerciseId: 'unknown' }, { exerciseName: '' }, { exerciseName: '  ' },
      { oneRepMaxKg: 0 }, { oneRepMaxKg: -1 }, { oneRepMaxKg: NaN }, { oneRepMaxKg: Infinity },
      { oneRepMaxKg: '100' }, { extra: true },
    ]) assert.equal(isReferenceSnapshot({ ...percentagePlan().reference, ...patch }), false)
  })

  it('valide une charge libre sans référence ni arrondi', () => {
    assert.equal(isLoadPlan({ method: 'manual', loadKg: 87.5 }), true)
    assert.equal(isLoadPlan({ method: 'manual', loadKg: Number.MAX_SAFE_INTEGER }), true)
    for (const loadKg of [0, -1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '87.5', null]) {
      assert.equal(isLoadPlan({ method: 'manual', loadKg }), false)
    }
  })

  it('refuse les charges hybrides et leurs champs supplémentaires même à undefined', () => {
    for (const patch of [{ intensityPct: 75 }, { reference: percentagePlan().reference },
      { rounding: { mode: 'exact' } }, { load: { exactKg: 80, selectedKg: 80 } }, { intensityPct: undefined }]) {
      assert.equal(isLoadPlan({ method: 'manual', loadKg: 80, ...patch }), false)
    }
    assert.equal(isLoadPlan({ ...percentagePlan(), loadKg: 80 }), false)
    assert.equal(isLoadPlan({ ...percentagePlan(), method: 'other' }), false)
  })

  it('vérifie la cohérence du pourcentage avec le snapshot et les trois modes d’arrondi', () => {
    assert.equal(isLoadPlan(percentagePlan()), true)
    const base = { ...percentagePlan(), intensityPct: 110.4 }
    for (const [mode, selectedKg] of [['exact', 110.4], ['down', 110], ['up', 112.5]] as const) {
      const rounding = mode === 'exact' ? { mode } : { mode, increment: 2.5 }
      assert.equal(isLoadPlan({ ...base, rounding, load: { exactKg: 110.4, selectedKg } }), true)
    }
    assert.equal(isLoadPlan({ ...percentagePlan(), load: { exactKg: 109, selectedKg: 109 } }), false)
    assert.equal(isLoadPlan({ ...percentagePlan(), load: { exactKg: 110, selectedKg: 112.5 } }), false)
    assert.equal(isLoadPlan({ ...percentagePlan(), rounding: { mode: 'exact', increment: 5 } }), false)
    assert.equal(isLoadPlan({ ...percentagePlan(), load: { exactKg: 110, selectedKg: 110, extra: true } }), false)
    assert.equal(isLoadPlan({ ...percentagePlan(), intensityPct: 300.1 }), false)
    assert.equal(isLoadPlan({ ...percentagePlan(), intensityPct: NaN }), false)
  })

  it('conserve un arrondi prévu à zéro sans autoriser une exécution à zéro', () => {
    const plan = { ...percentagePlan(), intensityPct: 1, rounding: { mode: 'down', increment: 5 }, load: { exactKg: 1, selectedKg: 0 } }
    assert.equal(isLoadPlan(plan), true)
    assert.equal(isWorkoutSetV2({ ...loadedSet(), loading: plan }), true)
    assert.equal(isLoadRepsExecution({ completed: true, reps: 1, loadKg: 0 }), false)
  })

  it('reste valide si le Record extérieur est modifié puis supprimé', () => {
    const records = [{ exerciseId: 'clean', oneRepMaxKg: 100 }]
    const set = loadedSet()
    const before = structuredClone(set)
    records[0].oneRepMaxKg = 105
    assert.equal(isWorkoutSetV2(set), true)
    records.splice(0)
    assert.equal(isWorkoutSetV2(set), true)
    assert.deepEqual(set, before)
  })
})

describe('séries et exécutions E2 selon leur type', () => {
  it('reconnaît les trois programmes, avec ou sans charge prévue', () => {
    for (const set of [loadedSet(), { ...loadedSet(), loading: null },
      { ...loadedSet(), loading: { method: 'manual', loadKg: 85 } },
      { schemaVersion: 2, id: 'reps', kind: 'reps', reps: 10 },
      { schemaVersion: 2, id: 'time', kind: 'duration', durationSeconds: 45 }]) {
      assert.equal(isWorkoutSetV2(set), true)
      assert.equal(isStoredWorkoutSet(set), true)
    }
  })

  it('refuse types inconnus, identités vides, répétitions et durées invalides', () => {
    for (const value of [undefined, null, [], {}, { ...loadedSet(), kind: 'other' }, { ...loadedSet(), id: '' },
      { ...loadedSet(), loading: undefined }, { ...loadedSet(), execution: undefined }]) {
      assert.equal(isWorkoutSetV2(value), false)
    }
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '45']) {
      assert.equal(isWorkoutSetV2({ ...loadedSet(), reps: value }), false)
      assert.equal(isWorkoutSetV2({ schemaVersion: 2, id: 'time', kind: 'duration', durationSeconds: value }), false)
    }
  })

  it('refuse chaque champ étranger au type, y compris sur un objet hybride V1/V2', () => {
    const reps = { schemaVersion: 2, id: 'reps', kind: 'reps', reps: 10 }
    const time = { schemaVersion: 2, id: 'time', kind: 'duration', durationSeconds: 45 }
    for (const patch of [{ loading: null }, { loadKg: 0 }, { intensityPct: 75 }, { load: null }, { durationSeconds: 45 }]) {
      assert.equal(isWorkoutSetV2({ ...reps, ...patch }), false)
    }
    for (const patch of [{ reps: 1 }, { loadKg: null }, { loading: null }]) assert.equal(isWorkoutSetV2({ ...time, ...patch }), false)
    assert.equal(isWorkoutSetV2({ ...loadedSet(), durationSeconds: 45 }), false)
    assert.equal(isWorkoutSetV2({ ...loadedSet(), extra: true }), false)
  })

  it('confirme les données adaptées sans champ artificiel', () => {
    assert.equal(isLoadRepsExecution({ completed: true, reps: 3, loadKg: 85 }), true)
    assert.equal(isRepsExecution({ completed: true, reps: 10 }), true)
    assert.equal(isDurationExecution({ completed: true, durationSeconds: 45 }), true)
    assert.equal(isWorkoutSetV2({ ...loadedSet(), loading: { method: 'manual', loadKg: 90 }, execution: { completed: true, reps: 3, loadKg: 87 } }), true)
    assert.equal(isWorkoutSetV2({ schemaVersion: 2, id: 'reps', kind: 'reps', reps: 10, execution: { completed: true, reps: 10 } }), true)
    assert.equal(isWorkoutSetV2({ schemaVersion: 2, id: 'time', kind: 'duration', durationSeconds: 45, execution: { completed: true, durationSeconds: 40 } }), true)
  })

  for (const [validate, fields, valid] of [
    [isLoadRepsExecution, ['reps', 'loadKg'], { reps: 3, loadKg: 85 }],
    [isRepsExecution, ['reps'], { reps: 10 }],
    [isDurationExecution, ['durationSeconds'], { durationSeconds: 45 }],
  ] as const) {
    it(`préserve les champs intacts et effacés pour ${fields.join('/')}`, () => {
      const untouched = Object.fromEntries(fields.map((field) => [field, null]))
      assert.equal(validate({ completed: false, ...untouched }), true)
      assert.equal(validate({ completed: false, ...valid }), true)
      assert.equal(validate({ completed: false, ...untouched, cleared: { [fields[0]]: true } }), true)
      assert.equal(validate({ completed: false, ...untouched, cleared: {} }), false)
      assert.equal(validate({ completed: false, ...untouched, cleared: { other: true } }), false)
      assert.equal(validate({ completed: false, ...untouched, cleared: { [fields[0]]: false } }), false)
      assert.equal(validate({ completed: false, ...valid, cleared: { [fields[0]]: true } }), false)
    })

    it(`refuse toute confirmation incomplète ou marquée effacée pour ${fields.join('/')}`, () => {
      for (const field of fields) for (const value of [null, undefined, 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(validate({ completed: true, ...valid, [field]: value }), false)
      }
      assert.equal(validate({ completed: true, ...valid, cleared: undefined }), false)
      assert.equal(validate({ completed: true, ...valid, cleared: {} }), false)
      assert.equal(validate({ completed: true, ...valid, extra: true }), false)
    })
  }

  it('refuse une exécution d’un autre type, même si ses nombres sont valides', () => {
    assert.equal(isRepsExecution({ completed: true, reps: 10, loadKg: 85 }), false)
    assert.equal(isDurationExecution({ completed: true, durationSeconds: 45, reps: 1 }), false)
    assert.equal(isWorkoutSetV2({ ...loadedSet(), execution: { completed: true, durationSeconds: 45 } }), false)
    assert.equal(isWorkoutSetV2({ schemaVersion: 2, id: 'time', kind: 'duration', durationSeconds: 45, execution: { completed: true, reps: 1 } }), false)
  })
})

describe('structures mixtes E2 et restrictions publiques E2-C', () => {
  it('reconnaît V1 et E2 chargée dans un même bloc, avec méthodes différentes', () => {
    const source = stored([legacySet(), loadedSet(), { ...loadedSet(), id: 'manual', loading: { method: 'manual', loadKg: 85 } as const }])
    const before = structuredClone(source)
    assert.equal(isStoredWorkout(source), true)
    assert.equal(isStoredWorkouts([source]), true)
    assert.deepEqual(source, before)
    assert.equal(isWorkout(source), true)
  })

  it('autorise les trois suivis dans des blocs séparés, sans types contradictoires dans un bloc', () => {
    const source = stored([loadedSet()])
    source.exercises.push({ id: 'reps-block', exerciseId: 'pull-up', sets: [{ schemaVersion: 2, id: 'reps', kind: 'reps', reps: 10 }] },
      { id: 'time-block', exerciseId: 'jerk-recovery', sets: [{ schemaVersion: 2, id: 'time', kind: 'duration', durationSeconds: 45 }] })
    assert.equal(isStoredWorkout(source), true)
    assert.equal(isStoredWorkout(stored([loadedSet(), { schemaVersion: 2, id: 'time', kind: 'duration', durationSeconds: 45 }])), false)
  })

  it('refuse une liste entière si une série ou une identité est invalide', () => {
    const source = stored([legacySet(), loadedSet()])
    assert.equal(isStoredWorkouts([source, source]), false)
    assert.equal(isStoredWorkout(stored([legacySet(), { ...loadedSet(), id: 'legacy-set' }])), false)
    assert.equal(isStoredWorkout(stored([{ ...loadedSet(), id: 'workout' }])), false)
    assert.equal(isStoredWorkouts([source, { ...source, id: 'other', date: '2026-02-30' }]), false)
    assert.equal(isStoredWorkouts([source, { ...source, id: 'other', exercises: [] }]), false)
  })

  it('ne touche jamais au navigateur pendant les validations pures', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', { configurable: true, get: () => { throw new Error('Accès navigateur interdit') } })
    try {
      assert.equal(isStoredWorkout(stored([legacySet(), loadedSet()])), true)
      assert.equal(isStoredWorkout(legacyWorkout()), true)
      assert.equal(isLoadPlan(percentagePlan()), true)
    } finally {
      if (previous) Object.defineProperty(globalThis, 'window', previous)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  })

  it('refuse les hybrides et les suivis E2-C en lecture/import/export sans toucher au stockage', () => {
    const values = new Map<string, string>()
    let writes = 0
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { writes++; values.set(key, value) },
      removeItem: (key: string) => { writes++; values.delete(key) },
    }
    for (const source of [stored([{ schemaVersion: 2, id: 'time', kind: 'duration', durationSeconds: 45 }]),
      stored([{ schemaVersion: 2, id: 'reps', kind: 'reps', reps: 10 }]), stored([{ ...legacySet(), ...loadedSet() }])]) {
      const raw = JSON.stringify([source])
      values.set(workoutsStorageKey, raw)
      assert.equal(loadWorkouts(storage).ok, false)
      assert.equal(exportBackup(storage).ok, false)
      for (const version of [1, 2]) {
        const backup = { format: 'liftboard.backup', version, exportedAt: '2026-11-19T12:00:00.000Z', data: { records: [], workouts: [source] } }
        assert.equal(validateBackup(backup).ok, false)
        assert.equal(restoreBackup(backup, storage).ok, false)
      }
      assert.equal(values.get(workoutsStorageKey), raw)
      assert.equal(writes, 0)
    }
  })

  it('conserve l’export V1 historique et passe en V2 avec un Record étendu', () => {
    const source = legacyWorkout()
    const values = new Map([[workoutsStorageKey, JSON.stringify([source])]])
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: () => { throw new Error('Écriture interdite') }, removeItem: () => { throw new Error('Écriture interdite') } }
    const result = exportBackup(storage)
    assert.ok(result.ok)
    assert.equal(result.value.backup.version, 1)
    assert.deepEqual(result.value.backup.data.workouts, [source])
    values.set(recordsStorageKey, '[{"exerciseId":"clean","oneRepMaxKg":100}]')
    const extended = exportBackup(storage)
    assert.ok(extended.ok)
    assert.equal(extended.value.backup.version, 2)
  })
})
