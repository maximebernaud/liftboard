import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createWorkoutDraft, createWorkoutExerciseDraft } from '../src/lib/workoutDraft.ts'
import {
  changeAppMovement, duplicateAppSetDraft, duplicateAppWorkoutDraft, getAppSetLoad, newE2LoadDraft,
  recordSnapshot, resolveE2Load, updateAppSet, validateAppWorkoutDraft, workoutToAppDraft,
} from '../src/lib/workoutEditorDraft.ts'
import { isPersonalRecords, mutatePersonalRecord, recordsStorageKey, type PersonalRecord } from '../src/data/personalRecords.ts'
import { createWorkout, completeWorkout, deleteWorkout, isWorkout, loadWorkouts, reopenWorkout,
  updateWorkout, updateWorkoutNotes, updateWorkoutSetExecution, workoutsStorageKey } from '../src/data/workouts.ts'
import { exportBackup, restoreBackup } from '../src/data/backup.ts'
import { validateBackup } from '../src/lib/dataBackup.ts'
import { confirmSetExecution, executionInputs, partialSetExecution } from '../src/lib/workoutExecution.ts'
import { plannedSetLoad, setPrescription } from '../src/lib/workoutPresentation.ts'
import { stepNumericInput } from '../src/lib/numericInput.ts'
import type { AppSetDraft, AppWorkout, AppWorkoutDraft } from '../src/types/workout.ts'

const clean = { exerciseId: 'clean', oneRepMaxKg: 100 } as const
const records = [clean]
class MemoryStorage {
  values = new Map<string, string>()
  writes = 0
  fail = false
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.writes++; if (this.fail) throw new Error('Denied'); this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
function draft(): AppWorkoutDraft {
  const block = createWorkoutExerciseDraft('clean-pull')
  const base = { ...block.sets[0], repsInput: '3' }
  const set: AppSetDraft = { ...base, e2: { ...newE2LoadDraft(base), intensityInput: '110', reference: recordSnapshot(clean) } }
  return { ...createWorkoutDraft(), title: 'Tirages', exercises: [{ ...block, sets: [set,
    { ...base, id: crypto.randomUUID(), e2: { ...newE2LoadDraft(base), method: 'manual', manualInput: '90' } }] }] }
}
function saved(source = draft(), current: PersonalRecord[] = records): AppWorkout {
  const result = validateAppWorkoutDraft(source, current)
  assert.ok(result.valid, JSON.stringify(result.errors))
  return result.workout
}
function read(storage: MemoryStorage): AppWorkout {
  const result = loadWorkouts(storage)
  assert.ok(result.ok)
  return result.workouts[0]
}

describe('Records étendus sans modification du Calculateur', () => {
  it('crée un vrai Record Clean, le modifie et l’efface de manière ciblée', () => {
    const storage = new MemoryStorage()
    assert.equal(mutatePersonalRecord({ exerciseId: 'clean', original: null, oneRepMaxKg: 100 }, storage).ok, true)
    assert.equal(isPersonalRecords(JSON.parse(storage.getItem(recordsStorageKey)!)), true)
    assert.equal(mutatePersonalRecord({ exerciseId: 'clean', original: clean, oneRepMaxKg: 105 }, storage).ok, true)
    assert.equal(mutatePersonalRecord({ exerciseId: 'clean', original: { ...clean, oneRepMaxKg: 105 }, oneRepMaxKg: null }, storage).ok, true)
    assert.deepEqual(JSON.parse(storage.getItem(recordsStorageKey)!), [])
  })
  it('refuse doublons, identifiants inconnus et création ou suppression concurrente', () => {
    const storage = new MemoryStorage()
    storage.values.set(recordsStorageKey, JSON.stringify(records))
    assert.equal(isPersonalRecords([clean, clean]), false)
    assert.equal(isPersonalRecords([{ ...clean, exerciseId: 'inconnu' }]), false)
    assert.equal(mutatePersonalRecord({ exerciseId: 'clean', original: null, oneRepMaxKg: 105 }, storage).ok, false)
    storage.values.set(recordsStorageKey, '[]')
    assert.equal(mutatePersonalRecord({ exerciseId: 'clean', original: clean, oneRepMaxKg: null }, storage).ok, false)
    assert.equal(storage.writes, 0)
  })
})

describe('programmation E2-B et caches de formulaire', () => {
  it('programme 110 % de Clean et 90 kg libres dans le même Clean Pull', () => {
    const workout = saved()
    assert.ok(isWorkout(workout))
    const [percentage, manual] = workout.exercises[0].sets
    assert.deepEqual(plannedSetLoad(percentage), { exactKg: 110, selectedKg: 110 })
    assert.deepEqual(plannedSetLoad(manual), { exactKg: 90, selectedKg: 90 })
    assert.match(setPrescription(percentage), /110 % de Clean.*100 kg/)
    assert.equal(setPrescription(manual), 'Charge libre')
    assert.ok(manual.schemaVersion === 2)
    assert.deepEqual(manual.loading, { method: 'manual', loadKg: 90 })
    assert.equal(JSON.stringify(workout).includes('manualInput'), false)
    assert.equal(JSON.stringify(workout).includes('savedPlan'), false)
  })
  it('n’associe jamais automatiquement le mouvement effectué à une référence', () => {
    const source = draft(), set = source.exercises[0].sets[0]
    assert.ok(set.e2)
    set.e2.reference = null
    const result = validateAppWorkoutDraft(source, records)
    assert.equal(result.valid, false)
    assert.match(result.errors.blocks[source.exercises[0].id].fields[set.id].reference!, /explicitement/)
  })
  it('distingue absence de Records, lecture impossible, référence supprimée et valeur obsolète', () => {
    const e2 = draft().exercises[0].sets[0].e2!
    for (const [current, pattern] of [[null, /indisponibles/], [[], /plus disponible/], [[{ ...clean, oneRepMaxKg: 105 }], /changé/]] as const) {
      const result = resolveE2Load(e2, current === null ? null : [...current])
      assert.equal(result.valid, false)
      if (!result.valid) assert.match(result.errors.reference!, pattern)
    }
  })
  it('autorise une référence du même exercice uniquement si sélectionnée', () => {
    const source = draft()
    source.exercises[0].exerciseId = 'clean'
    assert.ok(validateAppWorkoutDraft(source, records).valid)
  })
  it('accepte 300 %, refuse le dépassement et les kg libres invalides', () => {
    const source = draft(), e2 = source.exercises[0].sets[0].e2!
    e2.intensityInput = '300'
    assert.equal(plannedSetLoad(saved(source).exercises[0].sets[0])?.selectedKg, 300)
    e2.intensityInput = '300,1'
    assert.equal(validateAppWorkoutDraft(source, records).valid, false)
    for (const input of ['0', '-1', 'NaN', 'Infinity', '9007199254740992', '77,', '77.1234567890123456789']) {
      const manual = draft()
      manual.exercises[0].sets[1].e2!.manualInput = input
      assert.equal(validateAppWorkoutDraft(manual, records).valid, false, input)
    }
  })
  it('borne les flèches E2 à 300 % en préservant la limite du Calculateur à 100 %', () => {
    assert.equal(stepNumericInput('110', 'workout-intensity', 1), '110,5')
    assert.equal(stepNumericInput('299,8', 'workout-intensity', 1), '300')
    assert.equal(stepNumericInput('300', 'workout-intensity', 1), '300')
    assert.equal(stepNumericInput('1', 'workout-intensity', -1), '1')
    for (const input of ['301', '110,', 'NaN', 'Infinity']) assert.equal(stepNumericInput(input, 'workout-intensity', 1), null)
    assert.equal(stepNumericInput('100', 'intensity', 1), '100')
    assert.equal(stepNumericInput('110', 'intensity', 1), null)
  })
  it('conserve une saisie inactive, même invalide, sans la sérialiser', () => {
    const source = draft(), block = source.exercises[0], set = block.sets[0], e2 = set.e2!
    const before = structuredClone(source)
    const switched = updateAppSet(source, block.id, set.id, { e2: { ...e2, method: 'manual', manualInput: '87,5', intensityInput: '110,' } })
    const manual = saved(switched).exercises[0].sets[0]
    assert.ok(manual.schemaVersion === 2)
    assert.deepEqual(manual.loading, { method: 'manual', loadKg: 87.5 })
    const back = updateAppSet(switched, block.id, set.id, { e2: { ...switched.exercises[0].sets[0].e2!, method: 'percentage' } })
    assert.equal(back.exercises[0].sets[0].e2!.intensityInput, '110,')
    assert.equal(validateAppWorkoutDraft(back, records).valid, false)
    assert.deepEqual(source, before)
  })
  it('préserve snapshot et charge figés malgré modification/suppression du Record', () => {
    const workout = saved(), editing = workoutToAppDraft(workout)
    editing.title = 'Titre modifié'
    editing.exercises[0].sets[0].repsInput = '5'
    for (const current of [[], [{ ...clean, oneRepMaxKg: 105 }]]) {
      const result = validateAppWorkoutDraft(editing, current)
      assert.ok(result.valid)
      assert.deepEqual(plannedSetLoad(result.workout.exercises[0].sets[0]), { exactKg: 110, selectedKg: 110 })
      const set = result.workout.exercises[0].sets[0]
      assert.ok(set.schemaVersion === 2 && set.loading?.method === 'percentage')
      assert.equal(set.loading.reference.oneRepMaxKg, 100)
    }
  })
  it('exige une actualisation explicite pour un nouveau calcul après changement de Record', () => {
    const editing = workoutToAppDraft(saved()), e2 = editing.exercises[0].sets[0].e2!
    e2.intensityInput = '120'
    const current = [{ ...clean, oneRepMaxKg: 105 }]
    assert.equal(validateAppWorkoutDraft(editing, current).valid, false)
    e2.reference = recordSnapshot(current[0])
    assert.equal(plannedSetLoad(saved(editing, current).exercises[0].sets[0])?.selectedKg, 126)
  })
  it('restaure une programmation inchangée sans recalcul après aller-retour entre méthodes', () => {
    const editing = workoutToAppDraft(saved()), set = editing.exercises[0].sets[0], original = structuredClone(set.e2!)
    set.e2 = { ...original, method: 'manual', manualInput: '999' }
    set.e2 = { ...set.e2, method: 'percentage' }
    const workout = saved(editing, [])
    assert.equal(plannedSetLoad(workout.exercises[0].sets[0])?.selectedKg, 110)
  })
  it('duplique les paramètres avec nouveaux IDs, Records actuels et aucune exécution', () => {
    const original = saved(), first = original.exercises[0].sets[0]
    first.execution = { completed: true, reps: 3, loadKg: 107 }
    const copy = duplicateAppWorkoutDraft(original, [{ ...clean, oneRepMaxKg: 105 }])
    const workout = saved(copy, [{ ...clean, oneRepMaxKg: 105 }])
    assert.notEqual(workout.id, original.id)
    assert.notEqual(workout.exercises[0].sets[0].id, first.id)
    assert.equal(workout.exercises[0].sets[0].execution, undefined)
    assert.equal(plannedSetLoad(workout.exercises[0].sets[0])?.selectedKg, 115.5)
    assert.equal(plannedSetLoad(workout.exercises[0].sets[1])?.selectedKg, 90)
    assert.equal(plannedSetLoad(first)?.selectedKg, 110)
  })
  it('conserve le choix du brouillon dupliqué sans réutiliser un snapshot disparu', () => {
    const copy = duplicateAppWorkoutDraft(saved(), [])
    assert.equal(copy.exercises[0].sets[0].e2?.reference?.exerciseId, 'clean')
    assert.equal(copy.exercises[0].sets[0].e2?.savedPlan, undefined)
    assert.equal(validateAppWorkoutDraft(copy, []).valid, false)
    const duplicatedSet = duplicateAppSetDraft(workoutToAppDraft(saved()).exercises[0].sets[0], [])
    assert.equal(getAppSetLoad(duplicatedSet, [], 'clean-pull').status, 'invalid-input')
  })
  it('préserve les références et kg E2 lorsqu’on change explicitement le mouvement effectué', () => {
    const original = workoutToAppDraft(saved()), block = original.exercises[0]
    const changed = changeAppMovement(original, block.id, 'snatch')
    assert.deepEqual(changed.exercises[0].sets, block.sets)
    assert.equal(plannedSetLoad(saved(changed, []).exercises[0].sets[0])?.selectedKg, 110)
  })
  it('autorise une série chargée sans charge prévue mais exige des kg pour sa réalisation', () => {
    const source = draft()
    source.exercises[0].sets[0].e2!.method = 'none'
    const set = saved(source).exercises[0].sets[0]
    assert.equal(plannedSetLoad(set), null)
    assert.equal(confirmSetExecution(set, { reps: null, loadKg: null }).execution, null)
    assert.deepEqual(confirmSetExecution(set, { reps: null, loadKg: '85' }).execution, { completed: true, reps: 3, loadKg: 85 })
  })
})

describe('suivi, historique et concurrence E2-B', () => {
  it('conserve prévu 90 / réalisé 87, effacement, correction, clôture et réouverture', () => {
    const storage = new MemoryStorage(), original = saved(), block = original.exercises[0], manual = block.sets[1]
    assert.ok(createWorkout(original, storage).ok)
    const partial = partialSetExecution({ reps: '3', loadKg: '' }, undefined)
    assert.ok(updateWorkoutSetExecution(original, block.id, manual.id, partial, storage).ok)
    assert.deepEqual(executionInputs(read(storage).exercises[0].sets[1].execution), { reps: '3', loadKg: '' })
    assert.equal(updateWorkout({ ...original, title: 'Interdit' }, original, storage).ok, false)
    const performed = confirmSetExecution(manual, { reps: '3', loadKg: '87' }).execution
    assert.ok(performed)
    assert.ok(updateWorkoutSetExecution(read(storage), block.id, manual.id, performed, storage).ok)
    assert.equal(plannedSetLoad(read(storage).exercises[0].sets[1])?.selectedKg, 90)
    assert.ok(updateWorkoutNotes(original.id, { after: 'Bilan indépendant' }, storage).ok)
    assert.ok(completeWorkout(read(storage), storage).ok)
    const completed = read(storage)
    assert.equal(updateWorkoutSetExecution(completed, block.id, manual.id, performed, storage).ok, false)
    assert.ok(reopenWorkout(completed, storage).ok)
    assert.deepEqual(read(storage).exercises, completed.exercises)
    assert.equal(read(storage).notes.after, 'Bilan indépendant')
    assert.ok(updateWorkoutSetExecution(read(storage), block.id, manual.id, { ...performed, loadKg: 86 }, storage).ok)
  })
  for (const change of ['method', 'reference', 'snapshot', 'intensity', 'rounding', 'manual'] as const) {
    it(`détecte un programme changé ailleurs : ${change}`, () => {
      const original = saved(), changed = structuredClone(original), storage = new MemoryStorage()
      assert.ok(createWorkout(original, storage).ok)
      const set = changed.exercises[0].sets[0]
      assert.ok(set.schemaVersion === 2 && set.loading?.method === 'percentage')
      if (change === 'method') set.loading = { method: 'manual', loadKg: 110 }
      else if (change === 'manual') changed.exercises[0].sets[1] = { schemaVersion: 2, kind: 'load-reps', id: original.exercises[0].sets[1].id, reps: 3, loading: { method: 'manual', loadKg: 91 } }
      else {
        const plan = set.loading
        if (change === 'reference') plan.reference = { ...plan.reference, exerciseId: 'snatch', exerciseName: 'Snatch' }
        if (change === 'snapshot') { plan.reference = { ...plan.reference, oneRepMaxKg: 105 }; plan.load = { exactKg: 115.5, selectedKg: 115.5 } }
        if (change === 'intensity') { plan.intensityPct = 120; plan.load = { exactKg: 120, selectedKg: 120 } }
        if (change === 'rounding') plan.rounding = { mode: 'up', increment: 5 }
      }
      assert.ok(updateWorkout(changed, original, storage).ok)
      const raw = storage.getItem(workoutsStorageKey)
      assert.equal(updateWorkoutSetExecution(original, original.exercises[0].id, set.id, { completed: true, reps: 3, loadKg: 110 }, storage).ok, false)
      assert.equal(storage.getItem(workoutsStorageKey), raw)
    })
  }
  it('détecte un conflit de performances et conserve la tentative en cas d’erreur', () => {
    const storage = new MemoryStorage(), original = saved(), block = original.exercises[0], set = block.sets[0]
    createWorkout(original, storage)
    const attempt = { completed: true, reps: 3, loadKg: 107 } as const
    storage.fail = true
    assert.equal(updateWorkoutSetExecution(original, block.id, set.id, attempt, storage).ok, false)
    assert.deepEqual(attempt, { completed: true, reps: 3, loadKg: 107 })
    storage.fail = false
    assert.ok(updateWorkoutSetExecution(original, block.id, set.id, attempt, storage).ok)
    assert.equal(updateWorkoutSetExecution(original, block.id, set.id, { ...attempt, loadKg: 105 }, storage).ok, false)
    assert.ok(deleteWorkout(original.id, storage).ok)
    assert.equal(updateWorkoutSetExecution(original, block.id, set.id, attempt, storage).ok, false)
  })
})

describe('sauvegardes V1/V2 E2-B', () => {
  it('exporte en V2 avec un Record étendu seul', () => {
    const storage = new MemoryStorage()
    storage.values.set(recordsStorageKey, JSON.stringify(records))
    const result = exportBackup(storage)
    assert.ok(result.ok)
    assert.equal(result.value.backup.version, 2)
  })
  it('exporte, restaure et relit des séries mixtes sans Record courant et sans recalcul', () => {
    const source = saved(), storage = new MemoryStorage()
    source.exercises[0].sets.push({ id: 'legacy', reps: 2, intensityPct: 75, rounding: { mode: 'exact' }, load: null,
      execution: { completed: true, reps: 0, loadKg: 0 } })
    assert.ok(createWorkout(saved(), storage).ok)
    storage.values.set(workoutsStorageKey, JSON.stringify([source]))
    const backup = exportBackup(storage)
    assert.ok(backup.ok)
    assert.equal(backup.value.backup.version, 2)
    const destination = new MemoryStorage()
    assert.ok(restoreBackup(backup.value.backup, destination).ok)
    assert.deepEqual(read(destination), source)
    const before = new Map(destination.values)
    exportBackup(destination)
    loadWorkouts(destination)
    assert.deepEqual(destination.values, before)
  })
  it('refuse V1 avec contenu E2, versions futures et imports partiellement invalides', () => {
    const backup = { format: 'liftboard.backup', version: 2, exportedAt: '2026-11-20T12:00:00.000Z', data: { records, workouts: [saved()] } }
    assert.ok(validateBackup(backup).ok)
    assert.equal(validateBackup({ ...backup, version: 1 }).ok, false)
    assert.equal(validateBackup({ ...backup, version: 3 }).ok, false)
    const storage = new MemoryStorage()
    storage.values.set(workoutsStorageKey, 'données initiales')
    for (const kind of ['duration', 'reps']) {
      const invalid = { ...backup, data: { ...backup.data, workouts: [...backup.data.workouts, { ...backup.data.workouts[0], id: 'future', exercises: [{ id: 'future-block', exerciseId: 'pull-up', sets: [{ schemaVersion: 2, id: 'future-set', kind, reps: 10, durationSeconds: 45 }] }] }] } }
      assert.equal(restoreBackup(invalid, storage).ok, false)
      assert.equal(storage.writes, 0)
      assert.equal(storage.getItem(workoutsStorageKey), 'données initiales')
    }
  })
})
