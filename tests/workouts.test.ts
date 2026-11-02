import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createWorkout, deleteWorkout, isWorkout, loadWorkouts, sortWorkouts,
  updateWorkout, updateWorkoutNote, updateWorkoutNotes, workoutsStorageKey,
} from '../src/data/workouts.ts'
import {
  changeDraftMovement, createWorkoutDraft, createWorkoutExerciseDraft, getWorkoutSetLoad,
  updateDraftSet, validateWorkoutDraft, workoutToDraft,
} from '../src/lib/workoutDraft.ts'
import type { Workout, WorkoutDraft } from '../src/types/workout.ts'

class MemoryStorage {
  data = new Map<string, string>()
  failRead = false
  failWrite = false
  quota = false
  writes = 0
  getItem(key: string) {
    if (this.failRead) throw new Error('Storage unavailable')
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.quota) throw new DOMException('Full', 'QuotaExceededError')
    if (this.failWrite) throw new Error('Write failed')
    this.writes++
    this.data.set(key, value)
  }
}

function draft(): WorkoutDraft {
  const block = createWorkoutExerciseDraft('snatch')
  const set = { ...block.sets[0], repsInput: '3', intensityInput: '73,3', rounding: { mode: 'up' as const, increment: 2.5 as const } }
  return {
    ...createWorkoutDraft(new Date(2026, 10, 2)), title: 'Technique',
    exercises: [{ ...block, sets: [set, { ...set, id: crypto.randomUUID() }] }],
  }
}

function workout(source = draft(), record: number | undefined = 82.5): Workout {
  const result = validateWorkoutDraft(source, record === undefined ? [] : [{ exerciseId: 'snatch', oneRepMaxKg: record }])
  assert.equal(result.valid, true)
  if (!result.valid) throw new Error('Invalid fixture')
  return result.workout
}

function read(storage: MemoryStorage): Workout[] {
  const result = loadWorkouts(storage)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error)
  return result.workouts
}

describe('séances persistées', () => {
  it('part d’une liste vide sans créer de données fictives', () => {
    const storage = new MemoryStorage()
    assert.deepEqual(read(storage), [])
    assert.equal(storage.writes, 0)
  })

  it('crée, relit depuis un autre état et conserve ordre, identités, arrondis, charges et notes', () => {
    const storage = new MemoryStorage()
    const source = draft()
    source.notes.before = '  Consignes\nDeuxième ligne\n'
    const saved = workout(source)
    assert.equal(createWorkout(saved, storage).ok, true)
    assert.deepEqual(read(storage), [saved])
    assert.equal(saved.id, source.id)
    assert.equal(saved.status, 'planned')
    assert.equal(saved.exercises[0].id, source.exercises[0].id)
    assert.equal(saved.exercises[0].sets[0].id, source.exercises[0].sets[0].id)
    assert.deepEqual(saved.exercises[0].sets[0].load, { exactKg: 60.4725, selectedKg: 62.5 })
    assert.deepEqual(saved.exercises[0].sets[0].rounding, { mode: 'up', increment: 2.5 })
    assert.equal(createWorkout(saved, storage).ok, false)
    assert.equal(read(storage).length, 1)
  })

  it('refuse une saisie invalide sans effacer le brouillon ni écrire', () => {
    const storage = new MemoryStorage()
    const source = draft()
    source.exercises[0].sets[0].intensityInput = '75,'
    const before = structuredClone(source)
    assert.equal(validateWorkoutDraft(source).valid, false)
    assert.deepEqual(source, before)
    assert.equal(createWorkout({ ...workout(), title: '' }, storage).ok, false)
    assert.equal(storage.writes, 0)
  })

  it('modifie sans doublon et permet d’abandonner un brouillon sans toucher aux données', () => {
    const storage = new MemoryStorage()
    const original = workout()
    createWorkout(original, storage)
    const editing = workoutToDraft(read(storage)[0])
    editing.title = 'Autre titre'
    editing.notes.during = 'Non sauvegardé'
    editing.exercises[0].sets[0].repsInput = '5'
    assert.deepEqual(read(storage), [original])
    assert.equal(updateWorkout(workout(editing, 120), original, storage).ok, true)
    const saved = read(storage)
    assert.equal(saved.length, 1)
    assert.equal(saved[0].id, original.id)
    assert.equal(saved[0].title, 'Autre titre')
    assert.equal(saved[0].exercises[0].sets[0].reps, 5)
    assert.deepEqual(saved[0].exercises[0].sets[0].load, original.exercises[0].sets[0].load)
  })

  it('supprime uniquement la cible après l’action explicite', () => {
    const storage = new MemoryStorage()
    const first = workout(), second = workout()
    createWorkout(first, storage)
    createWorkout(second, storage)
    const before = storage.getItem(workoutsStorageKey)
    assert.deepEqual(read(storage), [first, second]) // Annuler n'appelle aucune mutation.
    assert.equal(storage.getItem(workoutsStorageKey), before)
    assert.equal(deleteWorkout(first.id, storage).ok, true)
    assert.deepEqual(read(storage), [second])
    assert.equal(deleteWorkout('absent', storage).ok, false)
  })

  it('trie les dates décroissantes avec ordre stable à date égale sans muter la liste', () => {
    const a = workout(), b = workout(), c = { ...workout(), date: '2027-01-01' }
    const source = [a, b, c]
    assert.deepEqual(sortWorkouts(source), [c, a, b])
    assert.deepEqual(source, [a, b, c])
  })
})

describe('charges enregistrées', () => {
  it('ne recalcule pas après nouveau 1RM, titre, date, répétitions ou notes modifiés', () => {
    const original = workout()
    const editing = workoutToDraft(original)
    const set = editing.exercises[0].sets[0]
    assert.deepEqual(getWorkoutSetLoad(set, 200), { status: 'ready', ...original.exercises[0].sets[0].load })
    editing.title = 'Nouveau titre'
    editing.date = '2027-01-01'
    editing.notes.after = 'Bilan'
    const changed = updateDraftSet(editing, editing.exercises[0].id, set.id, { repsInput: '8' })
    assert.deepEqual(workout(changed, 200).exercises, original.exercises.map((block) => ({
      ...block, sets: block.sets.map((item, index) => index === 0 ? { ...item, reps: 8 } : item),
    })))
  })

  it('recalcule uniquement la série dont l’intensité ou l’arrondi change', () => {
    const original = workout()
    const editing = workoutToDraft(original)
    const block = editing.exercises[0], set = block.sets[0]
    for (const fields of [{ intensityInput: '80' }, { rounding: { mode: 'exact' as const } }]) {
      const changed = workout(updateDraftSet(editing, block.id, set.id, fields), 100)
      assert.notDeepEqual(changed.exercises[0].sets[0].load, original.exercises[0].sets[0].load)
      assert.deepEqual(changed.exercises[0].sets[1], original.exercises[0].sets[1])
    }
    assert.deepEqual(workout(editing, 200), original)
  })

  it('recalcule les seules séries du mouvement explicitement changé', () => {
    const original = workout()
    const editing = workoutToDraft(original)
    editing.exercises.push({ ...structuredClone(editing.exercises[0]), id: crypto.randomUUID(),
      sets: editing.exercises[0].sets.map((set) => ({ ...set, id: crypto.randomUUID() })) })
    const changed = changeDraftMovement(editing, editing.exercises[0].id, 'front-squat')
    const result = validateWorkoutDraft(changed, [{ exerciseId: 'front-squat', oneRepMaxKg: 100 }])
    assert.equal(result.valid, true)
    if (!result.valid) return
    assert.deepEqual(result.workout.exercises[0].sets[0].load, { exactKg: 73.3, selectedKg: 75 })
    assert.deepEqual(result.workout.exercises[1].sets[0].load, original.exercises[0].sets[0].load)
  })

  it('conserve une charge absente après ajout du record, jusqu’au calcul explicite', () => {
    const result = validateWorkoutDraft(draft())
    assert.equal(result.valid, true)
    if (!result.valid) return
    assert.equal(result.workout.exercises[0].sets[0].load, null)
    const editing = workoutToDraft(result.workout)
    assert.equal(workout(editing, 100).exercises[0].sets[0].load, null)
    const block = editing.exercises[0]
    const changed = updateDraftSet(editing, block.id, block.sets[0].id, { savedLoad: undefined })
    assert.deepEqual(workout(changed, 100).exercises[0].sets[0].load, { exactKg: 73.3, selectedKg: 75 })
    assert.equal(workout(changed, 100).exercises[0].sets[1].load, null)
  })

  it('refuse NaN, Infinity, faux zéro et identités dupliquées', () => {
    for (const number of [NaN, Infinity, -1, 0]) {
      const item = workout()
      item.exercises[0].sets[0].load = { exactKg: number, selectedKg: number }
      assert.equal(isWorkout(item), false)
    }
    const item = workout()
    item.exercises[0].sets[1].id = item.exercises[0].sets[0].id
    assert.equal(isWorkout(item), false)
  })
})

describe('stockage protégé', () => {
  it('bloque toutes les écritures sur JSON malformé ou structure incompatible', () => {
    for (const raw of ['{', '{}', 'null', '[{}]', JSON.stringify([workout(), { id: 'x' }])]) {
      const storage = new MemoryStorage()
      storage.data.set(workoutsStorageKey, raw)
      assert.equal(loadWorkouts(storage).ok, false)
      const item = workout()
      for (const result of [createWorkout(item, storage), updateWorkout(item, item, storage),
        deleteWorkout(item.id, storage), updateWorkoutNote(item.id, 'during', 'Texte', storage)]) {
        assert.equal(result.ok, false)
      }
      assert.equal(storage.writes, 0)
      assert.equal(storage.getItem(workoutsStorageKey), raw)
    }
  })

  it('signale lecture inaccessible, échec d’écriture et quota sans annoncer de succès', () => {
    const storage = new MemoryStorage(), item = workout()
    storage.failRead = true
    assert.equal(createWorkout(item, storage).ok, false)
    storage.failRead = false
    storage.failWrite = true
    assert.equal(createWorkout(item, storage).ok, false)
    assert.deepEqual(read(storage), [])
    storage.failWrite = false
    storage.quota = true
    const result = createWorkout(item, storage)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /plein/)
    storage.quota = false
    assert.equal(createWorkout(item, storage).ok, true)
    storage.failWrite = true
    assert.equal(deleteWorkout(item.id, storage).ok, false)
    assert.deepEqual(read(storage), [item])
    assert.equal(updateWorkout({ ...item, title: 'Changement' }, item, storage).ok, false)
    assert.deepEqual(read(storage), [item])
  })

  it('ne touche jamais à la clé des Records', () => {
    const storage = new MemoryStorage(), item = workout()
    const recordsKey = 'liftboard.personal-records.v1'
    storage.data.set(recordsKey, 'records inchangés')
    createWorkout(item, storage)
    updateWorkoutNote(item.id, 'during', 'Note', storage)
    deleteWorkout(item.id, storage)
    assert.equal(storage.getItem(recordsKey), 'records inchangés')
  })
})

describe('notes et éditions concurrentes', () => {
  it('autorise les notes vides et préserve la saisie originale des trois catégories', () => {
    const storage = new MemoryStorage(), first = workout(), second = workout()
    createWorkout(first, storage)
    createWorkout(second, storage)
    for (const category of ['before', 'during', 'after'] as const) {
      const text = `  ${category}\nRéception instable sur la deuxième série\n`
      assert.equal(updateWorkoutNote(first.id, category, text, storage).ok, true)
      assert.equal(read(storage)[0].notes[category], text) // Relisible immédiatement après la frappe / fermeture.
    }
    assert.deepEqual(read(storage)[0].exercises, first.exercises)
    assert.deepEqual(read(storage)[1], second)
    assert.equal(updateWorkoutNote(first.id, 'during', '', storage).ok, true)
    assert.equal(read(storage)[0].notes.during, '')
    assert.notEqual(read(storage)[0].notes.before, '')
  })

  it('réessaie plusieurs catégories après échec sans altérer les données sauvegardées', () => {
    const storage = new MemoryStorage(), item = workout()
    createWorkout(item, storage)
    storage.failWrite = true
    const pending = { before: 'Consignes\n', during: 'Observations' }
    assert.equal(updateWorkoutNotes(item.id, pending, storage).ok, false)
    assert.deepEqual(read(storage), [item])
    storage.failWrite = false
    assert.equal(updateWorkoutNotes(item.id, pending, storage).ok, true)
    assert.deepEqual(read(storage)[0], { ...item, notes: { ...item.notes, ...pending } })
  })

  it('fusionne les dernières notes au lieu de les écraser avec un ancien formulaire', () => {
    const storage = new MemoryStorage(), item = workout()
    createWorkout(item, storage)
    const oldForm = workoutToDraft(item)
    oldForm.title = 'Titre modifié'
    oldForm.notes.before = 'Nouvelle consigne'
    updateWorkoutNote(item.id, 'during', 'Note rapide récente', storage)
    assert.equal(updateWorkout(workout(oldForm), item, storage).ok, true)
    assert.deepEqual(read(storage)[0].notes, { before: 'Nouvelle consigne', during: 'Note rapide récente', after: '' })
  })

  it('refuse un conflit sur une même note et une ancienne version des exercices', () => {
    const storage = new MemoryStorage(), item = workout()
    createWorkout(item, storage)
    updateWorkoutNote(item.id, 'during', 'Note récente', storage)
    const stale = { ...item, notes: { ...item.notes, during: 'Ancienne édition' } }
    assert.equal(updateWorkout(stale, item, storage).ok, false)
    assert.equal(read(storage)[0].notes.during, 'Note récente')
    const current = read(storage)[0]
    updateWorkout({ ...current, title: 'Autre version' }, current, storage)
    assert.equal(updateWorkout({ ...item, title: 'Titre périmé' }, item, storage).ok, false)
    assert.equal(read(storage)[0].title, 'Autre version')
  })

  it('relit la version actuelle pour chaque note et refuse une cible supprimée', () => {
    const storage = new MemoryStorage(), item = workout()
    createWorkout(item, storage)
    updateWorkout({ ...item, title: 'Version actuelle' }, item, storage)
    updateWorkoutNote(item.id, 'after', 'Bilan', storage)
    assert.equal(read(storage)[0].title, 'Version actuelle')
    deleteWorkout(item.id, storage)
    assert.equal(updateWorkoutNote(item.id, 'during', 'Encore une note', storage).ok, false)
    assert.deepEqual(read(storage), [])
  })
})
