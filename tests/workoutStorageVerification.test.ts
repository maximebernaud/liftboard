import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  completeWorkout, createWorkout, deleteWorkout, loadWorkouts, reopenWorkout, updateWorkout,
  updateWorkoutNotes, updateWorkoutSetExecution, workoutsStorageKey, type WorkoutsResult,
} from '../src/data/workouts.ts'
import { validateWorkoutDraft, workoutToDraft } from '../src/lib/workoutDraft.ts'
import type { Workout } from '../src/types/workout.ts'

type StorageMode = 'normal' | 'throw' | 'ignore' | 'different' | 'read-fails'
class MemoryStorage {
  data = new Map<string, string>()
  mode: StorageMode = 'normal'
  writes = 0
  events: string[] = []
  getItem(key: string): string | null {
    this.events.push('read')
    if (this.writes && this.mode === 'read-fails') throw new Error('Vérification inaccessible')
    if (this.writes && this.mode === 'different') return 'null'
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.events.push('write')
    this.writes++
    if (this.mode === 'throw') throw new Error('Écriture refusée')
    if (this.mode !== 'ignore') this.data.set(key, value)
  }
}

function fixture(): Workout {
  return { id: 'workout', title: 'Séance', date: '2026-11-19', status: 'planned', notes: { before: '', during: '', after: '' },
    exercises: [{ id: 'block', exerciseId: 'snatch', sets: [
      { id: 'set', reps: 3, intensityPct: 75, rounding: { mode: 'exact' }, load: { exactKg: 60, selectedKg: 60 } },
    ] }] }
}

const mutationNames = ['create', 'update', 'delete', 'notes', 'execution', 'complete', 'reopen'] as const
type Mutation = typeof mutationNames[number]
function mutate(name: Mutation, source: Workout, storage: MemoryStorage): WorkoutsResult {
  switch (name) {
    case 'create': return createWorkout({ ...source, id: 'created' }, storage)
    case 'update': return updateWorkout({ ...source, title: 'Autre titre' }, source, storage)
    case 'delete': return deleteWorkout(source.id, storage)
    case 'notes': return updateWorkoutNotes(source.id, { during: 'Observation' }, storage, source.notes)
    case 'execution': return updateWorkoutSetExecution(source, 'block', 'set', { completed: true, reps: 3, loadKg: 57.5 }, storage)
    case 'complete': return completeWorkout(source, storage)
    case 'reopen': return reopenWorkout(source, storage)
  }
}

function seed(name: Mutation, mode: StorageMode = 'normal') {
  const source = fixture(), storage = new MemoryStorage()
  if (name === 'complete' || name === 'reopen') source.exercises[0].sets[0].execution = { completed: true, reps: 3, loadKg: 60 }
  if (name === 'reopen') source.status = 'completed'
  storage.data.set(workoutsStorageKey, JSON.stringify([source]))
  storage.mode = mode
  return { source, storage }
}

describe('vérification des écritures de toutes les mutations historiques', () => {
  it('confirme une seule écriture après relecture et laisse les objets appelants intacts', () => {
    for (const name of mutationNames) {
      const { source, storage } = seed(name), before = structuredClone(source)
      const result = mutate(name, source, storage)
      assert.ok(result.ok, name)
      assert.equal(storage.writes, 1, name)
      assert.deepEqual(storage.events, ['read', 'write', 'read'], name)
      assert.equal(storage.data.get(workoutsStorageKey), JSON.stringify(result.workouts), name)
      assert.deepEqual(source, before)
    }
  })

  for (const mode of ['throw', 'ignore', 'different', 'read-fails'] as const) {
    it(`ne donne aucun faux succès ni deuxième écriture : ${mode}`, () => {
      for (const name of mutationNames) {
        const { source, storage } = seed(name, mode), before = structuredClone(source)
        const raw = storage.data.get(workoutsStorageKey)
        const result = mutate(name, source, storage)
        assert.equal(result.ok, false, name)
        assert.equal(storage.writes, 1, name)
        assert.deepEqual(source, before)
        if (result.ok) throw new Error('Succès inattendu')
        if (mode === 'read-fails') {
          assert.match(result.error, /écriture a été effectuée.*vérification est impossible/i)
          assert.doesNotMatch(result.error, /aucune modification enregistrée/i)
        }
        if (mode === 'ignore' || mode === 'throw') assert.equal(storage.data.get(workoutsStorageKey), raw)
        assert.match(result.error, /mémoire/i)
      }
    })
  }

  it('conserve le brouillon brut et la tentative lorsque seule la confirmation échoue', () => {
    const { source, storage } = seed('update', 'read-fails')
    const draft = workoutToDraft(source)
    draft.title = 'Titre saisi'
    draft.exercises[0].sets[0].repsInput = '003'
    const before = structuredClone(draft)
    const validation = validateWorkoutDraft(draft)
    assert.ok(validation.valid)
    const attempted = structuredClone(validation.workout)
    assert.equal(updateWorkout(validation.workout, source, storage).ok, false)
    assert.deepEqual(draft, before)
    assert.deepEqual(validation.workout, attempted)
    storage.mode = 'normal'
    const persisted = loadWorkouts(storage)
    assert.ok(persisted.ok)
    assert.deepEqual(persisted.workouts[0], attempted)
    assert.equal(storage.writes, 1)
  })

  it('relit la version persistée avant tout réessai et conserve les conflits existants', () => {
    const { source, storage } = seed('execution', 'read-fails')
    assert.equal(mutate('execution', source, storage).ok, false)
    storage.mode = 'normal'
    const latest = loadWorkouts(storage)
    assert.ok(latest.ok)
    assert.equal(updateWorkoutSetExecution(latest.workouts[0], 'block', 'set', { completed: true, reps: 2, loadKg: 55 }, storage).ok, true)
    const raw = storage.data.get(workoutsStorageKey), writes = storage.writes
    assert.equal(mutate('execution', source, storage).ok, false)
    assert.equal(storage.writes, writes)
    assert.equal(storage.data.get(workoutsStorageKey), raw)
    assert.equal(storage.events.at(-1), 'read')
  })
})
