import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createWorkoutDraft, createWorkoutExerciseDraft } from '../src/lib/workoutDraft.ts'
import {
  duplicateAppSetDraft, duplicateAppWorkoutDraft, newE2LoadDraft, recordSnapshot,
  updateAppSet, validateAppWorkoutDraft, workoutToAppDraft,
} from '../src/lib/workoutEditorDraft.ts'
import {
  appExecutionInputs, confirmAppSetExecution, hasPendingAppExecutionInputs, partialAppSetExecution,
  setExecutionFields, withSetExecution,
} from '../src/lib/workoutSetExecution.ts'
import { getWorkoutProgress } from '../src/lib/workoutExecution.ts'
import { plannedSetLoad } from '../src/lib/workoutPresentation.ts'
import { sameStoredSetExecution, storedWorkoutProgramSignature } from '../src/lib/workoutComparison.ts'
import { isAppWorkoutSet, isStoredWorkout, isWorkoutSetV2 } from '../src/lib/workoutSchema.ts'
import {
  completeWorkout, createWorkout, loadWorkouts, reopenWorkout, updateWorkout,
  updateWorkoutNotes, updateWorkoutSetExecution, workoutsStorageKey,
} from '../src/data/workouts.ts'
import { exportBackup, restoreBackup } from '../src/data/backup.ts'
import { recordsStorageKey } from '../src/data/personalRecords.ts'
import { validateBackup } from '../src/lib/dataBackup.ts'
import type { AppSetDraft, AppWorkout, AppWorkoutDraft, AppWorkoutSet } from '../src/types/workout.ts'

const record = { exerciseId: 'clean', oneRepMaxKg: 100 } as const
const emptyInputs = { reps: null, loadKg: null, durationSeconds: null }
class MemoryStorage {
  values = new Map<string, string>()
  writes = 0
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.writes++; this.values.set(key, value) }
  removeItem(key: string) { this.writes++; this.values.delete(key) }
}
function preparation(): AppWorkoutDraft {
  const block = createWorkoutExerciseDraft('clean-pull')
  const base = { ...block.sets[0], repsInput: '3' }
  const loaded: AppSetDraft = { ...base, e2: { ...newE2LoadDraft(base), intensityInput: '110',
    rounding: { mode: 'up', increment: 2.5 }, reference: recordSnapshot(record) } }
  return { ...createWorkoutDraft(), title: 'Trois suivis', notes: { before: 'Consigne', during: '', after: '' }, exercises: [{ ...block,
    sets: [loaded, { ...base, id: crypto.randomUUID(), kind: 'reps', repsOnlyInput: '15' },
      { ...base, id: crypto.randomUUID(), kind: 'duration', durationInput: '60' }] }] }
}
function saved(draft = preparation()): AppWorkout {
  const result = validateAppWorkoutDraft(draft, [record])
  assert.ok(result.valid, JSON.stringify(result.errors))
  return result.workout
}
function read(storage: MemoryStorage): AppWorkout {
  const result = loadWorkouts(storage)
  assert.ok(result.ok)
  return result.workouts[0]
}
function replaceSet(workout: AppWorkout, set: AppWorkoutSet): AppWorkout {
  return { ...workout, exercises: [{ ...workout.exercises[0], sets: [set] }] }
}

for (const kind of ['reps', 'duration'] as const) describe(`E2-C ${kind} de bout en bout`, () => {
  const index = kind === 'reps' ? 1 : 2
  const key = kind === 'reps' ? 'reps' : 'durationSeconds'
  const draftKey = kind === 'reps' ? 'repsOnlyInput' : 'durationInput'
  for (const value of [1, 30, 45, 60, 90, Number.MAX_SAFE_INTEGER]) it(`programme et relit ${value} sans champ étranger`, () => {
    const draft = preparation()
    draft.exercises[0].sets[index][draftKey] = String(value)
    const source = saved(draft), set = source.exercises[0].sets[index]
    assert.deepEqual(set, { schemaVersion: 2, id: set.id, kind, [key]: value })
    assert.equal(isAppWorkoutSet(set), true)
    assert.equal(plannedSetLoad(set), null)
    const storage = new MemoryStorage()
    assert.ok(createWorkout(source, storage).ok)
    assert.deepEqual(read(storage), source)
    assert.deepEqual(validateAppWorkoutDraft(workoutToAppDraft(source), []).workout, source)
  })
  for (const input of ['', '0', '-10', '1,5', '1.5', '2,', 'NaN', 'Infinity', '9007199254740992', '9007199254740991.1']) {
    it(`refuse la saisie ${JSON.stringify(input)} en conservant tous les brouillons`, () => {
      const draft = preparation(), block = draft.exercises[0]
      block.sets[index][draftKey] = input
      const before = structuredClone(draft)
      const result = validateAppWorkoutDraft(draft, [record])
      assert.equal(result.valid, false)
      assert.equal(result.workout, null)
      assert.ok(result.errors.blocks[block.id].fields[block.sets[index].id][kind === 'reps' ? 'reps' : 'duration'])
      assert.deepEqual(draft, before)
    })
  }
  for (const value of [0, -10, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) it(`refuse ${value} dans le contrat et la confirmation`, () => {
    const source = saved(), set = source.exercises[0].sets[index]
    assert.equal(isWorkoutSetV2({ ...set, [key]: value }), false)
    assert.equal(withSetExecution(set, { completed: true, [key]: value }), null)
    assert.equal(withSetExecution(set, { completed: false, [key]: value }), null)
  })
  for (const foreign of kind === 'reps' ? ['load', 'loadKg', 'loading', 'intensityPct', 'rounding', 'reference', 'durationSeconds']
    : ['reps', 'load', 'loadKg', 'loading', 'intensityPct', 'rounding', 'reference']) {
    it(`refuse le champ étranger ${foreign}, même undefined`, () => {
      const set = saved().exercises[0].sets[index]
      assert.equal(isAppWorkoutSet({ ...set, [foreign]: undefined }), false)
      assert.equal(withSetExecution(set, { completed: true, [key]: 12, [foreign]: undefined }), null)
    })
  }
  it('sauve la réalisation partielle, efface volontairement, recharge et confirme sans charge fictive', () => {
    const storage = new MemoryStorage(), source = saved(), block = source.exercises[0], set = block.sets[index]
    assert.ok(createWorkout(source, storage).ok)
    const partialInputs = { ...emptyInputs, [key]: '12' }
    const partial = partialAppSetExecution(set, partialInputs)
    assert.deepEqual(partial, { completed: false, [key]: 12 })
    assert.ok(updateWorkoutSetExecution(source, block.id, set.id, partial, storage).ok)
    let current = read(storage), currentSet = current.exercises[0].sets[index]
    assert.equal(getWorkoutProgress(current).completed, 0)
    assert.equal(appExecutionInputs(currentSet)[key], '12')
    assert.equal(hasPendingAppExecutionInputs(currentSet, partialInputs), false)
    const cleared = partialAppSetExecution(currentSet, { ...emptyInputs, [key]: '' })
    assert.deepEqual(cleared, { completed: false, [key]: null, cleared: { [key]: true } })
    assert.ok(updateWorkoutSetExecution(current, block.id, set.id, cleared, storage).ok)
    current = read(storage); currentSet = current.exercises[0].sets[index]
    assert.equal(appExecutionInputs(currentSet)[key], '')
    assert.equal(confirmAppSetExecution(currentSet, appExecutionInputs(currentSet)).execution, null)
    const adjusted = confirmAppSetExecution(currentSet, { ...emptyInputs, [key]: kind === 'reps' ? '12' : '48' })
    assert.deepEqual(adjusted.execution, { completed: true, [key]: kind === 'reps' ? 12 : 48 })
    assert.ok(adjusted.execution)
    assert.ok(updateWorkoutSetExecution(current, block.id, set.id, adjusted.execution, storage).ok)
    current = read(storage)
    assert.equal(getWorkoutProgress(current).completed, 1)
    assert.deepEqual({ ...current.exercises[0].sets[index], execution: undefined }, { ...set, execution: undefined })
    assert.ok(updateWorkoutSetExecution(current, block.id, set.id, { completed: false, [key]: 10 }, storage).ok)
    assert.equal(getWorkoutProgress(read(storage)).completed, 0)
  })
  it('confirme tel que prévu uniquement le champ applicable', () => {
    const set = saved().exercises[0].sets[index]
    const expected = kind === 'reps' ? 15 : 60
    assert.deepEqual(confirmAppSetExecution(set, emptyInputs), { execution: { completed: true, [key]: expected }, errors: {} })
    assert.deepEqual(setExecutionFields(set), [key])
  })
  it('ne remplace pas le dernier résultat valide par une saisie invalide', () => {
    const set = withSetExecution(saved().exercises[0].sets[index], { completed: false, [key]: 12 })
    assert.ok(set)
    const inputs = { ...emptyInputs, [key]: '2,' }
    assert.equal(hasPendingAppExecutionInputs(set, inputs), true)
    assert.deepEqual(partialAppSetExecution(set, inputs), { completed: false, [key]: 12 })
    assert.equal(confirmAppSetExecution(set, inputs).execution, null)
  })
  it('corrige après confirmation, conserve les notes, clôture et réouvre sans conversion', () => {
    const storage = new MemoryStorage(), set = saved().exercises[0].sets[index]
    const source = replaceSet(saved(), set), block = source.exercises[0]
    assert.ok(createWorkout(source, storage).ok)
    assert.ok(updateWorkoutSetExecution(source, block.id, set.id, { completed: true, [key]: 12 }, storage).ok)
    assert.ok(updateWorkoutNotes(source.id, { during: 'Note indépendante', after: 'Bilan' }, storage).ok)
    assert.ok(updateWorkoutSetExecution(read(storage), block.id, set.id, { completed: true, [key]: 11 }, storage).ok)
    const performed = read(storage)
    assert.ok(completeWorkout(performed, storage).ok)
    assert.deepEqual(read(storage), { ...performed, status: 'completed' })
    assert.equal(updateWorkoutSetExecution(read(storage), block.id, set.id, { completed: true, [key]: 10 }, storage).ok, false)
    assert.ok(reopenWorkout(read(storage), storage).ok)
    assert.deepEqual(read(storage), performed)
    assert.equal(updateWorkout({ ...performed, title: 'Autre programme' }, performed, storage).ok, false)
  })
  it('duplique la programmation avec nouveaux IDs et aucune réalisation', () => {
    const source = saved(), set = withSetExecution(source.exercises[0].sets[index], { completed: true, [key]: 12 })
    assert.ok(set)
    source.exercises[0].sets[index] = set
    const copy = duplicateAppWorkoutDraft(source, [record]), result = saved(copy)
    assert.notEqual(result.id, source.id)
    assert.notEqual(result.exercises[0].id, source.exercises[0].id)
    const copied = result.exercises[0].sets[index]
    const programmed = { ...set }
    delete programmed.execution
    assert.deepEqual({ ...copied, id: set.id }, programmed)
    assert.equal(copied.execution, undefined)
    const draftSet = workoutToAppDraft(source).exercises[0].sets[index]
    const duplicate = duplicateAppSetDraft(draftSet)
    assert.notEqual(duplicate.id, draftSet.id)
    assert.deepEqual({ ...duplicate, id: draftSet.id }, draftSet)
  })
  it('ne copie pas les caches inactifs d’une série simple dans une nouvelle programmation', () => {
    const draft = preparation(), base = draft.exercises[0].sets[0]
    const source: AppSetDraft = { ...base, kind, repsOnlyInput: '15', durationInput: '60' }
    const before = structuredClone(source)
    const copy = duplicateAppSetDraft(source, [{ ...record, oneRepMaxKg: 105 }])
    assert.equal(copy[draftKey], source[draftKey])
    assert.equal(copy.e2, undefined)
    assert.equal(copy.repsInput, '')
    assert.equal(copy[kind === 'reps' ? 'durationInput' : 'repsOnlyInput'], undefined)
    assert.deepEqual(source, before)
  })
})

describe('E2-C brouillons et séries mixtes', () => {
  it('retrouve les trois brouillons, références, arrondis, valeurs invalides et snapshots figés', () => {
    let draft = workoutToAppDraft(saved())
    const block = draft.exercises[0], set = block.sets[0]
    const initial = structuredClone(set)
    draft = updateAppSet(draft, block.id, set.id, { kind: 'reps', repsOnlyInput: '15' })
    draft = updateAppSet(draft, block.id, set.id, { kind: 'duration', durationInput: '60' })
    draft = updateAppSet(draft, block.id, set.id, { kind: 'load-reps' })
    assert.deepEqual(draft.exercises[0].sets[0].e2, initial.e2)
    assert.equal(draft.exercises[0].sets[0].repsInput, '3')
    assert.equal(saved(draft).exercises[0].sets[0].kind, 'load-reps')
    draft = updateAppSet(draft, block.id, set.id, { repsInput: '2,', kind: 'reps' })
    assert.equal(draft.exercises[0].sets[0].repsOnlyInput, '15')
    assert.deepEqual(saved(draft).exercises[0].sets[0], { schemaVersion: 2, kind: 'reps', id: set.id, reps: 15 })
    draft = updateAppSet(draft, block.id, set.id, { repsOnlyInput: '2,', kind: 'duration' })
    assert.equal(draft.exercises[0].sets[0].durationInput, '60')
    assert.deepEqual(saved(draft).exercises[0].sets[0], { schemaVersion: 2, kind: 'duration', id: set.id, durationSeconds: 60 })
    draft = updateAppSet(draft, block.id, set.id, { durationInput: '', kind: 'load-reps' })
    assert.equal(draft.exercises[0].sets[0].repsInput, '2,')
    assert.equal(validateAppWorkoutDraft(draft, [record]).valid, false)
    draft = updateAppSet(draft, block.id, set.id, { kind: 'reps' })
    assert.equal(draft.exercises[0].sets[0].repsOnlyInput, '2,')
    assert.equal(validateAppWorkoutDraft(draft, [record]).valid, false)
    draft = updateAppSet(draft, block.id, set.id, { kind: 'duration' })
    assert.equal(draft.exercises[0].sets[0].durationInput, '')
    assert.equal(validateAppWorkoutDraft(draft, [record]).valid, false)
    assert.deepEqual(draft.exercises[0].sets.slice(1), block.sets.slice(1))
    assert.equal(set.repsInput, '3')
  })
  it('ne convertit jamais répétitions en secondes ni valeurs d’un autre type', () => {
    for (const kind of ['reps', 'duration'] as const) {
      const draft = preparation(), block = draft.exercises[0], set = block.sets[0]
      const changed = updateAppSet(draft, block.id, set.id, { kind })
      assert.equal(validateAppWorkoutDraft(changed, [record]).valid, false)
      assert.equal(changed.exercises[0].sets[0][kind === 'reps' ? 'repsOnlyInput' : 'durationInput'], undefined)
    }
  })
  it('préserve les caches de type quand on duplique un brouillon historique', () => {
    const set: AppSetDraft = { id: 'set', repsInput: '3', intensityInput: '75', rounding: { mode: 'exact' },
      savedLoad: { exactKg: 60, selectedKg: 60 }, repsOnlyInput: '2,', durationInput: '' }
    const copy = duplicateAppSetDraft(set)
    assert.equal(copy.repsOnlyInput, '2,')
    assert.equal(copy.durationInput, '')
    assert.equal(copy.savedLoad, undefined)
  })
  it('ne sérialise jamais les branches inactives, même invalides, ni les caches de brouillon', () => {
    const draft = preparation()
    for (const set of draft.exercises[0].sets) {
      if (set.kind === 'duration') { set.repsOnlyInput = '2,'; set.repsInput = ''; set.e2 = newE2LoadDraft(set) }
      else if (set.kind === 'reps') { set.durationInput = 'NaN'; set.e2 = newE2LoadDraft(set) }
      else { set.durationInput = 'Infinity'; set.repsOnlyInput = '' }
    }
    const workout = saved(draft)
    assert.equal(isStoredWorkout(workout), true)
    for (const word of ['Input', 'savedPlan', 'savedLoad', 'NaN', 'Infinity']) assert.equal(JSON.stringify(workout).includes(word), false)
  })
  it('compte trois confirmations dans un même bloc et conserve le snapshot Clean 100', () => {
    const storage = new MemoryStorage(), original = saved()
    assert.ok(createWorkout(original, storage).ok)
    for (let index = 0; index < 3; index++) {
      const current = read(storage), block = current.exercises[0], set = block.sets[index]
      const result = confirmAppSetExecution(set, emptyInputs)
      assert.ok(result.execution)
      assert.ok(updateWorkoutSetExecution(current, block.id, set.id, result.execution, storage).ok)
      assert.equal(getWorkoutProgress(read(storage)).completed, index + 1)
    }
    const before = read(storage)
    assert.ok(completeWorkout(before, storage).ok)
    storage.values.set(recordsStorageKey, JSON.stringify([{ ...record, oneRepMaxKg: 105 }]))
    assert.deepEqual(read(storage).exercises, before.exercises)
    assert.equal(plannedSetLoad(read(storage).exercises[0].sets[0])?.selectedKg, 110)
  })
})

describe('E2-C conflits, lectures et écritures vérifiées', () => {
  for (const change of ['reps', 'duration', 'kind', 'execution-reps', 'execution-duration', 'confirmation', 'cleared']) {
    it(`détecte un changement concurrent ${change} sans écraser les autres données`, () => {
      const source = saved(), storage = new MemoryStorage()
      createWorkout(source, storage)
      const peer = structuredClone(source), block = peer.exercises[0]
      const index = change.includes('duration') ? 2 : 1, set = block.sets[index]
      if (change === 'kind') block.sets[index] = { schemaVersion: 2, id: set.id, kind: 'duration', durationSeconds: 15 }
      if (change === 'reps' && set.schemaVersion === 2 && set.kind === 'reps') set.reps = 16
      if (change === 'duration' && set.schemaVersion === 2 && set.kind === 'duration') set.durationSeconds = 61
      if (change.startsWith('execution') || change === 'confirmation' || change === 'cleared') {
        const execution = index === 1 ? { completed: change === 'confirmation', reps: change === 'cleared' ? null : 12,
          ...(change === 'cleared' ? { cleared: { reps: true } } : {}) } : { completed: false, durationSeconds: 48 }
        const changed = withSetExecution(set, execution)
        assert.ok(changed)
        block.sets[index] = changed
      }
      assert.equal(isStoredWorkout(peer), true)
      storage.values.set(workoutsStorageKey, JSON.stringify([peer]))
      const before = new Map(storage.values), writes = storage.writes
      const execution = confirmAppSetExecution(source.exercises[0].sets[index], emptyInputs).execution
      assert.ok(execution)
      assert.equal(updateWorkoutSetExecution(source, block.id, set.id, execution, storage).ok, false)
      assert.equal(completeWorkout(source, storage).ok, false)
      assert.deepEqual(storage.values, before)
      assert.equal(storage.writes, writes)
      assert.equal(storedWorkoutProgramSignature(source) === storedWorkoutProgramSignature(peer), !['reps', 'duration', 'kind'].includes(change))
      if (change.startsWith('execution')) assert.equal(sameStoredSetExecution(source.exercises[0].sets[index], block.sets[index]), false)
    })
  }
  it('fusionne les notes et les performances indépendantes, accepte une confirmation identique répétée', () => {
    const source = saved(), storage = new MemoryStorage(), block = source.exercises[0]
    createWorkout(source, storage)
    updateWorkoutNotes(source.id, { during: 'Autre onglet' }, storage)
    assert.ok(updateWorkoutSetExecution(source, block.id, block.sets[1].id, { completed: true, reps: 12 }, storage).ok)
    assert.ok(updateWorkoutSetExecution(source, block.id, block.sets[2].id, { completed: true, durationSeconds: 48 }, storage).ok)
    assert.ok(updateWorkoutSetExecution(source, block.id, block.sets[2].id, { completed: true, durationSeconds: 48 }, storage).ok)
    assert.equal(read(storage).notes.during, 'Autre onglet')
    assert.equal(getWorkoutProgress(read(storage)).completed, 2)
    assert.equal(read(storage).exercises[0].sets[1].execution?.completed, true)
  })
  for (const mode of ['throw', 'ignore', 'different', 'read-fails']) it(`n’annonce aucun succès après ${mode}`, () => {
    const storage = new MemoryStorage(), original = saved(), block = original.exercises[0]
    createWorkout(original, storage)
    let written = false
    const target = {
      getItem(key: string) { if (written && mode === 'read-fails') throw new Error('Read denied'); return storage.getItem(key) },
      setItem(key: string, value: string) {
        written = true
        if (mode === 'throw') throw new Error('Denied')
        if (mode !== 'ignore') storage.setItem(key, mode === 'different' ? '[]' : value)
      },
    }
    const before = structuredClone(original)
    const attempt = { completed: true, durationSeconds: 48 } as const
    assert.equal(updateWorkoutSetExecution(original, block.id, block.sets[2].id, attempt, target).ok, false)
    assert.deepEqual(original, before)
    assert.deepEqual(attempt, { completed: true, durationSeconds: 48 })
  })
})

describe('E2-C sauvegardes V1/V2 strictes', () => {
  for (const foreign of [{ kind: 'reps' }, { loading: null }, { durationSeconds: 60 }]) {
    it(`refuse un hybride sans schemaVersion : ${Object.keys(foreign)[0]}`, () => {
      const set = { id: 'legacy', reps: 3, intensityPct: 75, rounding: { mode: 'exact' }, load: null, ...foreign }
      assert.equal(isAppWorkoutSet(set), false)
      assert.equal(isAppWorkoutSet({ ...set, schemaVersion: undefined }), false)
    })
  }
  function envelope() {
    const source = saved()
    source.exercises[0].sets.push({ id: 'legacy-set', reps: 3, intensityPct: 75, rounding: { mode: 'exact' }, load: null })
    source.exercises[0].sets[1] = { schemaVersion: 2, id: source.exercises[0].sets[1].id, kind: 'reps', reps: 15, execution: { completed: true, reps: 12 } }
    source.exercises[0].sets[2] = { schemaVersion: 2, id: source.exercises[0].sets[2].id, kind: 'duration', durationSeconds: 60,
      execution: { completed: false, durationSeconds: null, cleared: { durationSeconds: true } } }
    return { format: 'liftboard.backup', version: 2, exportedAt: '2026-11-20T12:00:00.000Z', data: { records: [], workouts: [source] } }
  }
  it('exporte et restaure V2 mixte exactement, sans recalcul, conversion ni écriture à la lecture', () => {
    const backup = envelope(), source = new MemoryStorage(), target = new MemoryStorage()
    source.values.set(workoutsStorageKey, JSON.stringify(backup.data.workouts))
    const exported = exportBackup(source)
    assert.ok(exported.ok)
    assert.equal(exported.value.backup.version, 2)
    assert.deepEqual(exported.value.backup.data, backup.data)
    assert.ok(restoreBackup(exported.value.backup, target).ok)
    const before = new Map(target.values), writes = target.writes
    assert.deepEqual(read(target), backup.data.workouts[0])
    assert.deepEqual(loadWorkouts(target), { ok: true, workouts: backup.data.workouts })
    assert.deepEqual(exportBackup(target).ok, true)
    assert.deepEqual(target.values, before)
    assert.equal(target.writes, writes)
  })
  for (const patch of [
    { format: 'unknown' }, { version: 3 }, { version: 1 }, { durationSeconds: 0 }, { durationSeconds: 1.5 },
    { reps: 0 }, { reps: 1.5 }, { kind: 'unknown' }, { schemaVersion: 3 }, { extra: true },
    { execution: { completed: true, durationSeconds: 48, reps: 1 } },
    { execution: { completed: true, durationSeconds: null } }, { execution: { completed: true, durationSeconds: 0 } },
  ]) it(`refuse intégralement ${JSON.stringify(patch)} avant toute écriture`, () => {
    const backup = envelope(), target = new MemoryStorage()
    target.values.set(workoutsStorageKey, 'Données à préserver')
    const bad = 'format' in patch || 'version' in patch ? { ...backup, ...patch } : {
      ...backup, data: { ...backup.data, workouts: [...backup.data.workouts, {
        ...backup.data.workouts[0], id: 'invalid-workout', exercises: [{ id: 'invalid-block', exerciseId: 'glute-bridge',
          sets: [{ schemaVersion: 2, id: 'invalid-set', kind: 'duration', durationSeconds: 60, ...patch }] }],
      }] },
    }
    assert.equal(validateBackup(bad).ok, false)
    assert.equal(restoreBackup(bad, target).ok, false)
    assert.equal(target.writes, 0)
    assert.equal(target.getItem(workoutsStorageKey), 'Données à préserver')
  })
  for (const mode of ['ignore', 'throw', 'uncertain']) it(`préserve la récupération de restauration : ${mode}`, () => {
    const memory = new MemoryStorage()
    memory.values.set(workoutsStorageKey, 'Anciennes séances')
    memory.values.set(recordsStorageKey, 'Anciens Records')
    let writes = 0
    const target = {
      getItem: (key: string) => memory.getItem(key),
      setItem(key: string, value: string) {
        writes++
        if (mode === 'ignore') return
        if (writes === 2 || (mode === 'uncertain' && writes >= 2)) throw new Error('Denied')
        memory.setItem(key, value)
      },
      removeItem: (key: string) => memory.removeItem(key),
    }
    const result = restoreBackup(envelope(), target)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.recovery, mode === 'uncertain' ? 'uncertain' : 'rolled-back')
  })
})
