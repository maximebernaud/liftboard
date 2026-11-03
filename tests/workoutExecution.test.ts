import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createWorkout, deleteWorkout, isWorkout, loadWorkouts, updateWorkout,
  updateWorkoutNote, updateWorkoutSetExecution, workoutsStorageKey,
} from '../src/data/workouts.ts'
import { duplicateWorkoutDraft, validateWorkoutDraft, workoutToDraft } from '../src/lib/workoutDraft.ts'
import {
  confirmSetExecution, executionInputs, executionNumberInput, getWorkoutProgress, hasWorkoutExecution,
  hasPendingExecutionInputs, isWorkoutSetExecution, isWritableExecution, parseExecutionLoad,
  parseExecutionReps, partialSetExecution, requiresExecutionCorrection,
} from '../src/lib/workoutExecution.ts'
import type { Workout, WorkoutSetExecution } from '../src/types/workout.ts'

class MemoryStorage {
  data = new Map<string, string>()
  failRead = false
  failWrite = false
  quota = false
  writes = 0
  getItem(key: string) {
    if (this.failRead) throw new Error('Unavailable')
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.quota) throw new DOMException('Full', 'QuotaExceededError')
    if (this.failWrite) throw new Error('Unavailable')
    this.writes++
    this.data.set(key, value)
  }
}

function fixture(): Workout {
  return {
    id: crypto.randomUUID(), title: 'Séance J5', date: '2026-11-03', status: 'planned',
    notes: { before: 'Consignes', during: '', after: '' },
    exercises: ['snatch', 'front-squat'].map((exerciseId, index) => ({
      id: `exercise-${index}`, exerciseId: exerciseId as 'snatch' | 'front-squat',
      sets: Array.from({ length: index === 0 ? 3 : 2 }, (_, number) => ({
        id: `set-${index}-${number}`, reps: 3, intensityPct: 80,
        rounding: { mode: 'exact' as const }, load: { exactKg: 80, selectedKg: 80 },
      })),
    })),
  }
}

function read(storage: MemoryStorage): Workout[] {
  const result = loadWorkouts(storage)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error)
  return result.workouts
}

function save(source: Workout, execution: WorkoutSetExecution, storage: MemoryStorage, index = 0) {
  const block = source.exercises[0]
  return updateWorkoutSetExecution(source, block.id, block.sets[index].id, execution, storage)
}

const performed: WorkoutSetExecution = { completed: true, reps: 2, loadKg: 77.5 }

describe('modèle d’exécution rétrocompatible', () => {
  it('relit J5 sans migration, sans écriture et avec une progression nulle', () => {
    const source = fixture(), storage = new MemoryStorage()
    const raw = JSON.stringify([source])
    storage.data.set(workoutsStorageKey, raw)
    assert.equal(isWorkout(source), true)
    assert.deepEqual(read(storage), [source])
    assert.deepEqual(getWorkoutProgress(source), { completed: 0, total: 5 })
    assert.equal(hasWorkoutExecution(source), false)
    assert.equal(storage.writes, 0)
    assert.equal(storage.getItem(workoutsStorageKey), raw)
  })

  it('accepte en lecture une réalisation, une saisie partielle et les anciens zéros', () => {
    for (const execution of [performed, { completed: false, reps: 2, loadKg: null },
      { completed: false, reps: null, loadKg: 77.5 }, { completed: false, reps: null, loadKg: null },
      { completed: true, reps: 0, loadKg: 0 }] as const) {
      const source = fixture()
      source.exercises[0].sets[0].execution = execution
      assert.equal(isWorkout(source), true)
      assert.equal(isWorkoutSetExecution(execution), true)
    }
  })

  it('refuse les structures corrompues, les nombres non finis et les réalisations incomplètes', () => {
    for (const execution of [undefined, null, [], {}, true, { reps: 2, loadKg: 77.5 },
      { completed: 'true', reps: 2, loadKg: 77.5 }, { completed: true, reps: null, loadKg: 77.5 },
      { completed: true, reps: 2, loadKg: null }, { completed: false, reps: 2 },
      { ...performed, reps: -1 }, { ...performed, reps: 2.5 }, { ...performed, reps: Number.MAX_SAFE_INTEGER + 1 },
      { ...performed, loadKg: -1 }, { ...performed, loadKg: '77,5' }, { ...performed, extra: 1 },
      ...[NaN, Infinity, -Infinity].flatMap((value) => [{ ...performed, reps: value }, { ...performed, loadKg: value }])]) {
      const source = fixture()
      source.exercises[0].sets[0].execution = execution as WorkoutSetExecution
      assert.equal(isWorkout(source), false, JSON.stringify(execution))
    }
  })

  it('conserve les formats invalides dans la saisie, sans conversion en faux résultats', () => {
    assert.equal(parseExecutionReps('0'), null)
    assert.equal(parseExecutionReps(' 002 '), 2)
    for (const input of ['', ' ', '-1', '2.5', '2,5', 'NaN', 'Infinity', '1e2', '9007199254740993']) {
      assert.equal(parseExecutionReps(input), null, input)
    }
    assert.equal(parseExecutionLoad('77,5'), 77.5)
    assert.equal(parseExecutionLoad('77.5'), 77.5)
    assert.equal(parseExecutionLoad('0'), null)
    for (const input of ['', ' ', '77,', '77.', 'abc', '-1', 'NaN', 'Infinity', '1e2', '0x10', '1'.repeat(400), `0.${'0'.repeat(400)}1`]) {
      assert.equal(parseExecutionLoad(input), null, input)
    }
    for (const value of [77.5, 1e-7, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER]) {
      assert.equal(parseExecutionLoad(executionNumberInput(value)), value)
    }
    assert.equal(Number(executionNumberInput(Number.MAX_VALUE).replace(',', '.')), Number.MAX_VALUE)
    assert.equal(parseExecutionLoad(executionNumberInput(Number.MAX_VALUE)), null)
  })
})

describe('confirmation et progression', () => {
  it('distingue un champ intact, modifié, effacé ou invalide sans ressaisie du prévu', () => {
    const set = fixture().exercises[0].sets[0]
    assert.deepEqual(executionInputs(undefined), { reps: null, loadKg: null })
    assert.deepEqual(confirmSetExecution(set, { reps: '2', loadKg: null }).execution, { completed: true, reps: 2, loadKg: 80 })
    assert.deepEqual(confirmSetExecution(set, { reps: null, loadKg: '77.5' }).execution, { completed: true, reps: 3, loadKg: 77.5 })
    for (const inputs of [{ reps: '', loadKg: null }, { reps: null, loadKg: '' }, { reps: 'abc', loadKg: null }, { reps: null, loadKg: '77,' }]) {
      assert.equal(confirmSetExecution(set, inputs).execution, null)
      assert.equal(hasPendingExecutionInputs(inputs, undefined), true)
    }
  })

  it('mémorise un effacement explicite après relecture sans remplacer le champ par le prévu', () => {
    const source = fixture(), storage = new MemoryStorage()
    createWorkout(source, storage)
    const inputs = { reps: '2', loadKg: '' }
    const partial = partialSetExecution(inputs, undefined)
    assert.deepEqual(partial, { completed: false, reps: 2, loadKg: null, cleared: { loadKg: true } })
    assert.equal(save(source, partial, storage).ok, true)
    const saved = read(storage)[0].exercises[0].sets[0].execution
    assert.equal(hasPendingExecutionInputs(inputs, saved), false)
    assert.deepEqual(executionInputs(saved), inputs)
    assert.equal(confirmSetExecution(source.exercises[0].sets[0], executionInputs(saved)).execution, null)
  })

  it('conserve le dernier résultat valide d’un champ invalide pendant la saisie de l’autre', () => {
    const saved = { completed: false, reps: 2, loadKg: 75 } as const
    const inputs = { reps: '1', loadKg: '77,' }
    assert.deepEqual(partialSetExecution(inputs, saved), { completed: false, reps: 1, loadKg: 75 })
    assert.equal(hasPendingExecutionInputs(inputs, { ...saved, reps: 1 }), true)
    assert.deepEqual(inputs, { reps: '1', loadKg: '77,' })
  })

  it('refuse zéro et les dépassements numériques, y compris un zéro prévu par arrondi', () => {
    const set = fixture().exercises[0].sets[0]
    for (const inputs of [
      { reps: '0', loadKg: '80' }, { reps: '3', loadKg: '0' }, { reps: '-1', loadKg: '80' },
      { reps: '3', loadKg: '-1' }, { reps: 'Infinity', loadKg: '80' }, { reps: '3', loadKg: 'NaN' },
      { reps: '9007199254740992', loadKg: '80' }, { reps: '3', loadKg: '9007199254740992' },
      { reps: '3', loadKg: '9007199254740991.1' },
      { reps: '3', loadKg: '9007199254740990.5' }, { reps: '3', loadKg: '77.1234567890123456789' },
    ]) assert.equal(confirmSetExecution(set, inputs).execution, null)
    assert.equal(confirmSetExecution({ ...set, load: { exactKg: 1, selectedKg: 0 } }, { reps: null, loadKg: null }).execution, null)
  })

  it('confirme les valeurs prévues seulement sur action explicite et ne modifie pas le programme', () => {
    const source = fixture(), before = structuredClone(source), storage = new MemoryStorage()
    createWorkout(source, storage)
    const result = confirmSetExecution(source.exercises[0].sets[0], { reps: null, loadKg: null })
    assert.deepEqual(result, { execution: { completed: true, reps: 3, loadKg: 80 }, errors: {} })
    assert.ok(result.execution)
    assert.equal(save(source, result.execution, storage).ok, true)
    const current = read(storage)[0]
    assert.deepEqual(current.exercises[0].sets[0], { ...source.exercises[0].sets[0], execution: result.execution })
    assert.deepEqual(source, before)
    assert.equal(current.status, 'planned')
  })

  it('valide un résultat différent et garde les quatre valeurs après relecture', () => {
    const source = fixture(), storage = new MemoryStorage()
    createWorkout(source, storage)
    const result = confirmSetExecution(source.exercises[0].sets[0], { reps: '2', loadKg: '77,5' })
    assert.deepEqual(result.execution, performed)
    assert.ok(result.execution)
    assert.equal(save(source, result.execution, storage).ok, true)
    const set = read(storage)[0].exercises[0].sets[0]
    assert.equal(set.reps, 3)
    assert.equal(set.load?.selectedKg, 80)
    assert.deepEqual(set.execution, performed)
  })

  it('ne remplace jamais une saisie invalide ou effacée par la programmation', () => {
    const set = fixture().exercises[0].sets[0]
    for (const inputs of [{ reps: 'abc', loadKg: '80' }, { reps: '2', loadKg: '77,' }, { reps: '', loadKg: '' }]) {
      assert.equal(confirmSetExecution(set, inputs).execution, null)
    }
  })

  it('demande une charge réelle si aucune charge n’avait été programmée', () => {
    const source = fixture(), storage = new MemoryStorage()
    const set = source.exercises[0].sets[0]
    set.load = null
    createWorkout(source, storage)
    const missing = confirmSetExecution(set, { reps: null, loadKg: null })
    assert.equal(missing.execution, null)
    assert.ok(missing.errors.loadKg)
    const filled = confirmSetExecution(set, { reps: null, loadKg: '20' })
    assert.deepEqual(filled.execution, { completed: true, reps: 3, loadKg: 20 })
    assert.ok(filled.execution)
    assert.equal(save(source, filled.execution, storage).ok, true)
    assert.equal(read(storage)[0].exercises[0].sets[0].load, null)
  })

  it('persiste une saisie partielle ou complète sans la compter comme réalisée', () => {
    const source = fixture(), storage = new MemoryStorage()
    createWorkout(source, storage)
    for (const execution of [{ completed: false, reps: 2, loadKg: null }, { completed: false, reps: 2, loadKg: 77.5 }] as const) {
      assert.equal(save(read(storage)[0], execution, storage).ok, true)
      assert.deepEqual(read(storage)[0].exercises[0].sets[0].execution, execution)
      assert.deepEqual(getWorkoutProgress(read(storage)[0]), { completed: 0, total: 5 })
    }
  })

  it('corrige une réalisation puis annule son état en conservant les résultats', () => {
    const source = fixture(), storage = new MemoryStorage()
    createWorkout(source, storage)
    save(source, performed, storage)
    const corrected = { completed: true, reps: 1, loadKg: 75 } as const
    assert.equal(save(read(storage)[0], corrected, storage).ok, true)
    assert.deepEqual(read(storage)[0].exercises[0].sets[0].execution, corrected)
    assert.equal(save(read(storage)[0], { ...corrected, completed: false }, storage).ok, true)
    assert.deepEqual(read(storage)[0].exercises[0].sets[0].execution, { ...corrected, completed: false })
    assert.deepEqual(getWorkoutProgress(read(storage)[0]), { completed: 0, total: 5 })
  })

  it('compte 2/5 puis 5/5, en gardant le statut planned', () => {
    const source = fixture(), storage = new MemoryStorage()
    createWorkout(source, storage)
    save(source, performed, storage)
    save(source, performed, storage, 1)
    assert.deepEqual(getWorkoutProgress(read(storage)[0]), { completed: 2, total: 5 })
    for (const block of source.exercises) for (const set of block.sets) {
      assert.equal(updateWorkoutSetExecution(read(storage)[0], block.id, set.id, performed, storage).ok, true)
    }
    assert.deepEqual(getWorkoutProgress(read(storage)[0]), { completed: 5, total: 5 })
    assert.equal(read(storage)[0].status, 'planned')
  })
})

describe('écritures ciblées et protection des données', () => {
  it('lit les anciens zéros sans écrire et autorise notes, autres séances puis correction ciblée', () => {
    const source = fixture(), other = fixture(), storage = new MemoryStorage()
    source.exercises[0].sets[0].execution = { completed: true, reps: 0, loadKg: 0 }
    const raw = JSON.stringify([source])
    storage.data.set(workoutsStorageKey, raw)
    assert.deepEqual(read(storage), [source])
    assert.equal(storage.writes, 0)
    assert.equal(storage.getItem(workoutsStorageKey), raw)
    assert.equal(requiresExecutionCorrection(source.exercises[0].sets[0].execution), true)
    assert.equal(hasPendingExecutionInputs(executionInputs(source.exercises[0].sets[0].execution), source.exercises[0].sets[0].execution), false)
    assert.equal(updateWorkoutNote(source.id, 'during', 'Note toujours accessible', storage).ok, true)
    assert.equal(createWorkout(other, storage).ok, true)
    assert.equal(save(source, performed, storage, 1).ok, true)
    assert.deepEqual(read(storage)[0].exercises[0].sets[0].execution, { completed: true, reps: 0, loadKg: 0 })
    assert.equal(save(source, performed, storage).ok, true)
    const current = read(storage)
    assert.deepEqual(current[0].exercises[0].sets[0].execution, performed)
    assert.deepEqual(current[0].exercises[0].sets[0].load, source.exercises[0].sets[0].load)
    assert.equal(current[0].notes.during, 'Note toujours accessible')
    assert.deepEqual(current[0].exercises[0].sets[1].execution, performed)
    assert.deepEqual(current[1], other)
  })

  it('refuse toute nouvelle écriture à zéro sans rendre les anciennes valeurs illisibles', () => {
    const source = fixture(), storage = new MemoryStorage()
    createWorkout(source, storage)
    const before = storage.getItem(workoutsStorageKey)
    for (const execution of [
      { completed: true, reps: 0, loadKg: 80 }, { completed: true, reps: 3, loadKg: 0 },
      { completed: false, reps: 0, loadKg: null }, { completed: false, reps: null, loadKg: 0 },
      { completed: true, reps: 2, loadKg: Number.MAX_SAFE_INTEGER + 1 },
    ] as const) {
      assert.equal(isWritableExecution(execution), false)
      assert.equal(save(source, execution, storage).ok, false)
      const newWorkout = fixture()
      newWorkout.exercises[0].sets[0].execution = execution
      assert.equal(createWorkout(newWorkout, storage).ok, false)
    }
    assert.equal(storage.getItem(workoutsStorageKey), before)
    const legacy = { completed: true, reps: 0, loadKg: 0 } as const
    source.exercises[0].sets[0].execution = legacy
    storage.data.set(workoutsStorageKey, JSON.stringify([source]))
    assert.equal(save(source, legacy, storage).ok, false)
    assert.deepEqual(read(storage), [source])
  })

  it('annule un ancien état réalisé sans effacer ses zéros, puis permet leur correction', () => {
    const source = fixture(), storage = new MemoryStorage()
    source.exercises[0].sets[0].execution = { completed: true, reps: 0, loadKg: 0 }
    storage.data.set(workoutsStorageKey, JSON.stringify([source]))
    assert.equal(save(source, { completed: false, reps: 0, loadKg: 0 }, storage).ok, true)
    assert.deepEqual(read(storage)[0].exercises[0].sets[0].execution, { completed: false, reps: 0, loadKg: 0 })
    assert.equal(save(read(storage)[0], { completed: false, reps: 2, loadKg: 0 }, storage).ok, true)
    assert.equal(save(read(storage)[0], performed, storage).ok, true)
  })

  it('valide strictement les marqueurs d’effacement sans accepter de données corrompues', () => {
    for (const cleared of [null, [], {}, { reps: false }, { other: true }, { reps: true }]) {
      assert.equal(isWorkoutSetExecution({ ...performed, cleared }), false)
    }
    assert.equal(isWorkoutSetExecution({ completed: false, reps: null, loadKg: 80, cleared: { reps: true } }), true)
  })

  it('préserve les notes récentes, les autres résultats, les autres séances et les Records', () => {
    const source = fixture(), other = fixture(), storage = new MemoryStorage()
    storage.data.set('liftboard.personal-records.v1', '[{"exerciseId":"snatch","oneRepMaxKg":100}]')
    createWorkout(source, storage)
    createWorkout(other, storage)
    updateWorkoutNote(source.id, 'during', 'Note récente', storage)
    save(source, { completed: false, reps: 4, loadKg: 60 }, storage, 1)
    assert.equal(save(source, performed, storage).ok, true)
    const current = read(storage)
    assert.equal(current[0].notes.during, 'Note récente')
    assert.deepEqual(current[0].exercises[0].sets[1].execution, { completed: false, reps: 4, loadKg: 60 })
    assert.deepEqual(current[0].exercises[1], source.exercises[1])
    assert.deepEqual(current[1], other)
    assert.equal(storage.getItem('liftboard.personal-records.v1'), '[{"exerciseId":"snatch","oneRepMaxKg":100}]')
    updateWorkoutNote(source.id, 'after', 'Bilan', storage)
    assert.deepEqual(read(storage)[0].exercises, current[0].exercises)
  })

  it('refuse un conflit sur la même série et accepte une répétition identique sans perdre de données', () => {
    const source = fixture(), storage = new MemoryStorage()
    createWorkout(source, storage)
    save(source, performed, storage)
    const before = storage.getItem(workoutsStorageKey)
    assert.equal(save(source, { ...performed, loadKg: 90 }, storage).ok, false)
    assert.equal(storage.getItem(workoutsStorageKey), before)
    assert.equal(save(source, performed, storage).ok, true)
  })

  it('refuse une programmation obsolète : séries, mouvement, ordre ou charges changés', () => {
    for (const change of [
      (item: Workout) => { item.exercises[0].sets.pop() },
      (item: Workout) => { item.exercises[0].exerciseId = 'clean-and-jerk' },
      (item: Workout) => { item.exercises.reverse() },
      (item: Workout) => { item.exercises[0].sets[0].load = { exactKg: 90, selectedKg: 90 } },
    ]) {
      const source = fixture(), changed = structuredClone(source), storage = new MemoryStorage()
      createWorkout(source, storage)
      change(changed)
      assert.equal(updateWorkout(changed, source, storage).ok, true)
      assert.equal(save(source, performed, storage).ok, false)
      assert.deepEqual(read(storage), [changed])
    }
  })

  it('refuse une cible absente ou supprimée sans la restaurer', () => {
    const source = fixture(), storage = new MemoryStorage()
    createWorkout(source, storage)
    assert.equal(updateWorkoutSetExecution(source, 'absent', 'absent', performed, storage).ok, false)
    deleteWorkout(source.id, storage)
    assert.equal(save(source, performed, storage).ok, false)
    assert.deepEqual(read(storage), [])
  })

  it('bloque les anciens éditeurs et toute édition de programmation dès une saisie partielle', () => {
    const source = fixture(), storage = new MemoryStorage()
    createWorkout(source, storage)
    save(source, { completed: false, reps: 2, loadKg: null }, storage)
    const latest = read(storage)[0]
    const oldForm = validateWorkoutDraft(workoutToDraft(source))
    assert.ok(oldForm.valid)
    assert.equal(updateWorkout(oldForm.workout, source, storage).ok, false)
    const changed = structuredClone(latest)
    changed.exercises[0].sets = changed.exercises[0].sets.slice(1)
    assert.equal(updateWorkout(changed, latest, storage).ok, false)
    assert.deepEqual(read(storage), [latest])
    assert.equal(updateWorkoutNote(source.id, 'during', 'Toujours accessible', storage).ok, true)
  })

  it('duplique uniquement la préparation avec de nouveaux IDs et les Records actuels', () => {
    const source = fixture(), storage = new MemoryStorage()
    source.notes = { before: 'Consigne', during: 'Observation', after: 'Bilan' }
    source.exercises[0].sets[0].execution = performed
    source.exercises[0].sets[1].execution = { completed: false, reps: 2, loadKg: null }
    createWorkout(source, storage)
    const draft = duplicateWorkoutDraft(source)
    assert.ok(draft.exercises.every((block) => block.sets.every((set) => !('execution' in set))))
    const result = validateWorkoutDraft(draft, [{ exerciseId: 'snatch', oneRepMaxKg: 120 }])
    assert.ok(result.valid)
    assert.equal(result.workout.status, 'planned')
    assert.equal(hasWorkoutExecution(result.workout), false)
    assert.equal(result.workout.exercises[0].sets[0].load?.selectedKg, 96)
    assert.equal(result.workout.exercises[1].sets[0].load, null)
    assert.notEqual(result.workout.exercises[0].sets[0].id, source.exercises[0].sets[0].id)
    assert.deepEqual(result.workout.notes, { before: 'Consigne', during: '', after: '' })
    assert.equal(createWorkout(result.workout, storage).ok, true)
    assert.deepEqual(read(storage)[0], source)
  })

  it('refuse un résultat invalide sans écrire ni modifier les objets fournis', () => {
    const source = fixture(), storage = new MemoryStorage()
    createWorkout(source, storage)
    const invalid = { completed: true, reps: 2, loadKg: NaN } as const
    const before = structuredClone(source)
    const writes = storage.writes
    assert.equal(save(source, invalid, storage).ok, false)
    assert.equal(storage.writes, writes)
    assert.deepEqual(source, before)
    assert.ok(Number.isNaN(invalid.loadKg))
    assert.deepEqual(read(storage), [source])
  })

  it('conserve le stockage corrompu et bloque toute nouvelle écriture', () => {
    const source = fixture(), corrupted = structuredClone(source), storage = new MemoryStorage()
    corrupted.exercises[0].sets[0].execution = { completed: true, reps: null, loadKg: 80 } as unknown as WorkoutSetExecution
    for (const raw of ['{corrompu', JSON.stringify([corrupted])]) {
      storage.data.set(workoutsStorageKey, raw)
      for (const result of [save(source, performed, storage), createWorkout(source, storage),
        updateWorkout(source, source, storage), deleteWorkout(source.id, storage), updateWorkoutNote(source.id, 'during', 'Texte', storage)]) {
        assert.equal(result.ok, false)
      }
      assert.equal(storage.writes, 0)
      assert.equal(storage.getItem(workoutsStorageKey), raw)
    }
  })

  it('signale lecture indisponible, écriture en échec et quota, puis permet de réessayer', () => {
    const source = fixture(), storage = new MemoryStorage()
    createWorkout(source, storage)
    const before = structuredClone(source)
    storage.failRead = true
    assert.equal(save(source, performed, storage).ok, false)
    storage.failRead = false
    for (const property of ['failWrite', 'quota'] as const) {
      storage[property] = true
      const result = save(source, performed, storage)
      assert.equal(result.ok, false)
      if (!result.ok) assert.match(result.error, property === 'quota' ? /plein/ : /Impossible/)
      assert.deepEqual(read(storage), [source])
      assert.deepEqual(source, before)
      assert.deepEqual(performed, { completed: true, reps: 2, loadKg: 77.5 })
      storage[property] = false
    }
    assert.equal(save(source, performed, storage).ok, true)
    assert.deepEqual(read(storage)[0].exercises[0].sets[0].execution, performed)
  })
})
