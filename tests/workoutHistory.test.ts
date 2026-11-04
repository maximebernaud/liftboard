import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  completeWorkout, createWorkout, deleteWorkout, loadWorkouts, reopenWorkout, sortWorkouts,
  updateWorkout, updateWorkoutNotes, updateWorkoutSetExecution, workoutsStorageKey,
} from '../src/data/workouts.ts'
import { getWorkoutProgress } from '../src/lib/workoutExecution.ts'
import { filterWorkoutHistory, formatWorkoutDate, historyFiltersForWorkout, workoutCompletionError, workoutCompletionMessage } from '../src/lib/workoutHistory.ts'
import type { Workout } from '../src/types/workout.ts'

class MemoryStorage {
  raw: string | null = null
  failRead = false
  failWrite = false
  quota = false
  writes = 0
  getItem(key: string) {
    assert.equal(key, workoutsStorageKey)
    if (this.failRead) throw new Error('Denied')
    return this.raw
  }
  setItem(key: string, value: string) {
    assert.equal(key, workoutsStorageKey)
    if (this.quota) throw new DOMException('Full', 'QuotaExceededError')
    if (this.failWrite) throw new Error('Denied')
    this.raw = value
    this.writes++
  }
}

function fixture(): Workout {
  return {
    id: crypto.randomUUID(), title: 'Clôture J6-B', date: '2026-11-03', status: 'planned',
    notes: { before: 'Consignes\n', during: 'Observation', after: 'Bilan' },
    exercises: [{ id: 'block', exerciseId: 'snatch', sets: Array.from({ length: 5 }, (_, index) => ({
      id: `set-${index}`, reps: 3, intensityPct: 80, rounding: { mode: 'exact' as const },
      load: { exactKg: 80, selectedKg: 80 },
      ...(index < 3 ? { execution: { completed: true as const, reps: 2, loadKg: 77.5 } } : {}),
    })) }],
  }
}

function setup(source = fixture()) {
  const storage = new MemoryStorage()
  assert.equal(createWorkout(source, storage).ok, true)
  return { source, storage }
}

function read(storage: MemoryStorage): Workout[] {
  const result = loadWorkouts(storage)
  assert.ok(result.ok)
  return result.workouts
}

describe('clôture ciblée', () => {
  it('termine 3/5 sans modifier notes, programmation, résultats, ordre, date ni autres séances', () => {
    const { source, storage } = setup(), other = fixture()
    createWorkout(other, storage)
    const before = structuredClone(source)
    assert.equal(completeWorkout(source, storage).ok, true)
    assert.deepEqual(read(storage), [{ ...source, status: 'completed' }, other])
    assert.deepEqual(source, before)
    assert.deepEqual(getWorkoutProgress(read(storage)[0]), { completed: 3, total: 5 })
    assert.equal(read(storage)[0].exercises[0].sets[3].execution, undefined)
    assert.deepEqual(Object.keys(read(storage)[0]), Object.keys(source))
  })

  it('termine une séance entièrement réalisée sans nouvelle performance', () => {
    const source = fixture()
    source.exercises[0].sets = source.exercises[0].sets.slice(0, 3)
    const { storage } = setup(source)
    assert.equal(completeWorkout(source, storage).ok, true)
    assert.deepEqual(getWorkoutProgress(read(storage)[0]), { completed: 3, total: 3 })
  })

  it('refuse zéro confirmation, même avec des saisies complètes persistées', () => {
    const source = fixture()
    source.exercises[0].sets.forEach((set) => { set.execution = { completed: false, reps: 2, loadKg: 77.5 } })
    const { storage } = setup(source), before = storage.raw
    assert.match(workoutCompletionError(source)!, /Aucune performance confirmée/)
    assert.equal(completeWorkout(source, storage).ok, false)
    assert.equal(storage.raw, before)
  })

  it('conserve les saisies partielles et annulées sans les confirmer', () => {
    const source = fixture()
    source.exercises[0].sets[3].execution = { completed: false, reps: 2, loadKg: null, cleared: { loadKg: true } }
    source.exercises[0].sets[4].execution = { completed: false, reps: 1, loadKg: 70 }
    const { storage } = setup(source)
    assert.equal(completeWorkout(source, storage).ok, true)
    assert.deepEqual(read(storage)[0].exercises, source.exercises)
    assert.deepEqual(getWorkoutProgress(read(storage)[0]), { completed: 3, total: 5 })
  })

  it('signale le bloc et la série héritée invalide sans bloquer une autre séance', () => {
    const source = fixture(), { storage, source: other } = setup()
    source.exercises[0].sets[1].execution = { completed: true, reps: 0, loadKg: 0 }
    storage.raw = JSON.stringify([source, other])
    const result = completeWorkout(source, storage)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /Exercice 1 \(Snatch\), série 2/)
    assert.deepEqual(read(storage)[0], source)
    assert.equal(completeWorkout(other, storage).ok, true)
    assert.equal(updateWorkoutSetExecution(source, 'block', 'set-1', { completed: true, reps: 2, loadKg: 75 }, storage).ok, true)
    assert.equal(completeWorkout(read(storage)[0], storage).ok, true)
  })

  it('refuse aussi une ancienne charge au-delà des limites numériques sûres', () => {
    const source = fixture(), storage = new MemoryStorage()
    source.exercises[0].sets[0].execution = { completed: true, reps: 2, loadKg: Number.MAX_VALUE }
    storage.raw = JSON.stringify([source])
    assert.equal(completeWorkout(source, storage).ok, false)
    assert.deepEqual(read(storage), [source])
  })

  it('préserve les notes ajoutées après ouverture de la confirmation', () => {
    const { source, storage } = setup()
    updateWorkoutNotes(source.id, { after: 'Dernier bilan' }, storage)
    assert.equal(completeWorkout(source, storage).ok, true)
    assert.deepEqual(read(storage)[0], { ...source, status: 'completed', notes: { ...source.notes, after: 'Dernier bilan' } })
  })

  it('refuse une répétition et une confirmation provenant du mauvais statut sans écrire', () => {
    const { source, storage } = setup()
    assert.equal(reopenWorkout(source, storage).ok, false)
    assert.equal(completeWorkout(source, storage).ok, true)
    const before = storage.raw, writes = storage.writes
    assert.equal(completeWorkout(source, storage).ok, false)
    assert.equal(completeWorkout(read(storage)[0], storage).ok, false)
    assert.equal(storage.raw, before)
    assert.equal(storage.writes, writes)
  })
})

describe('transitions obsolètes et stockage en échec', () => {
  for (const operation of [completeWorkout, reopenWorkout]) {
    it(`${operation.name} refuse suppression, changement de programmation et de performance`, () => {
      for (const change of [
        (workout: Workout) => { workout.title = 'Titre récent' },
        (workout: Workout) => { workout.exercises[0].sets.reverse() },
        (workout: Workout) => { workout.exercises[0].sets.pop() },
        (workout: Workout) => { workout.exercises[0].sets[0].load = { exactKg: 90, selectedKg: 90 } },
        (workout: Workout) => { workout.exercises[0].sets[0].execution = { completed: true, reps: 1, loadKg: 70 } },
        (workout: Workout) => { workout.exercises[0].sets[4].execution = { completed: false, reps: 2, loadKg: null } },
      ]) {
        const { source, storage } = setup()
        if (operation === reopenWorkout) { completeWorkout(source, storage); source.status = 'completed' }
        const latest = structuredClone(source)
        change(latest)
        storage.raw = JSON.stringify([latest])
        const before = storage.raw
        assert.equal(operation(source, storage).ok, false)
        assert.equal(storage.raw, before)
        deleteWorkout(source.id, storage)
        assert.equal(operation(source, storage).ok, false)
        assert.deepEqual(read(storage), [])
      }
    })

    it(`${operation.name} protège les données corrompues ou inaccessibles`, () => {
      const { source, storage } = setup()
      if (operation === reopenWorkout) { completeWorkout(source, storage); source.status = 'completed' }
      for (const raw of ['{corrompu', '[{}]']) {
        storage.raw = raw
        assert.equal(operation(source, storage).ok, false)
        assert.equal(storage.raw, raw)
      }
      storage.raw = JSON.stringify([source])
      storage.failRead = true
      assert.equal(operation(source, storage).ok, false)
      assert.equal(storage.raw, JSON.stringify([source]))
    })

    it(`${operation.name} ne signale aucun succès en cas d’échec d’écriture et permet de réessayer`, () => {
      const { source, storage } = setup()
      if (operation === reopenWorkout) { completeWorkout(source, storage); source.status = 'completed' }
      const before = storage.raw
      for (const failure of ['failWrite', 'quota'] as const) {
        storage[failure] = true
        const result = operation(source, storage)
        assert.equal(result.ok, false)
        if (!result.ok) assert.match(result.error, failure === 'quota' ? /plein/ : /Impossible/)
        assert.equal(storage.raw, before)
        storage[failure] = false
      }
      assert.equal(operation(source, storage).ok, true)
    })
  }
})

describe('réouverture et notes historiques', () => {
  it('réouvre sans réinitialiser, puis autorise à nouveau les corrections du suivi', () => {
    const { source, storage } = setup()
    completeWorkout(source, storage)
    const completed = read(storage)[0]
    assert.equal(updateWorkoutSetExecution(completed, 'block', 'set-0', { completed: true, reps: 1, loadKg: 60 }, storage).ok, false)
    assert.equal(reopenWorkout(completed, storage).ok, true)
    assert.deepEqual(read(storage), [source])
    assert.equal(reopenWorkout(completed, storage).ok, false)
    assert.equal(updateWorkoutSetExecution(read(storage)[0], 'block', 'set-0', { completed: true, reps: 1, loadKg: 60 }, storage).ok, true)
  })

  it('préserve les notes récentes à la réouverture et retire la séance des filtres historiques', () => {
    const { source, storage } = setup()
    completeWorkout(source, storage)
    const completed = read(storage)[0]
    updateWorkoutNotes(source.id, { after: 'Après clôture' }, storage, completed.notes)
    assert.equal(reopenWorkout(completed, storage).ok, true)
    assert.equal(read(storage)[0].notes.after, 'Après clôture')
    assert.deepEqual(filterWorkoutHistory(read(storage), { exerciseId: '', date: '' }), [])
  })

  it('sauve les trois notes historiques sans modifier le statut ni aucune autre donnée', () => {
    const { source, storage } = setup()
    completeWorkout(source, storage)
    const completed = read(storage)[0]
    const patch = { before: '', during: 'Observations\n', after: '  Bilan final\n' }
    assert.equal(updateWorkoutNotes(source.id, patch, storage, completed.notes).ok, true)
    assert.deepEqual(read(storage), [{ ...completed, notes: patch }])
  })

  it('refuse le conflit sur la même note, fusionne les autres catégories et ne restaure pas une cible supprimée', () => {
    const { source, storage } = setup()
    completeWorkout(source, storage)
    updateWorkoutNotes(source.id, { after: 'Bilan récent' }, storage)
    const before = storage.raw
    assert.equal(updateWorkoutNotes(source.id, { after: 'Ancien bilan' }, storage, source.notes).ok, false)
    assert.equal(storage.raw, before)
    assert.equal(updateWorkoutNotes(source.id, { during: 'Nouvelle observation' }, storage, source.notes).ok, true)
    assert.equal(read(storage)[0].notes.after, 'Bilan récent')
    deleteWorkout(source.id, storage)
    assert.equal(updateWorkoutNotes(source.id, { after: 'Bilan' }, storage, source.notes).ok, false)
    assert.deepEqual(read(storage), [])
  })

  it('protège aussi la programmation des anciennes séances terminées sans exécution', () => {
    const source = fixture(), storage = new MemoryStorage()
    source.status = 'completed'
    source.exercises[0].sets.forEach((set) => { delete set.execution })
    storage.raw = JSON.stringify([source])
    assert.equal(updateWorkout({ ...source, title: 'Modification' }, source, storage).ok, false)
    assert.equal(updateWorkoutNotes(source.id, { after: 'Note' }, storage, source.notes).ok, true)
  })
})

describe('filtres de l’historique', () => {
  const a = { ...fixture(), id: 'a', status: 'completed' as const, date: '2026-10-25' }
  const b = { ...fixture(), id: 'b', status: 'completed' as const, date: '2026-10-25' }
  b.exercises[0].exerciseId = 'front-squat'
  const c = { ...fixture(), id: 'c', status: 'completed' as const, date: '2026-11-03' }
  c.exercises.push({ ...structuredClone(b.exercises[0]), id: 'other-block' })
  const planned = fixture()
  const workouts = [a, b, c, planned]

  it('exclut les séances planifiées et garde le tri stable à dates égales sans mutation', () => {
    const before = structuredClone(workouts)
    assert.deepEqual(sortWorkouts(filterWorkoutHistory(workouts, { exerciseId: '', date: '' })), [c, a, b])
    assert.deepEqual(workouts, before)
  })
  it('filtre par exercice présent dans n’importe quel bloc', () => {
    assert.deepEqual(filterWorkoutHistory(workouts, { exerciseId: 'front-squat', date: '' }), [b, c])
    assert.deepEqual(filterWorkoutHistory(workouts, { exerciseId: 'clean-and-jerk', date: '' }), [])
  })
  it('filtre par date locale exacte, y compris près du changement d’heure', () => {
    assert.deepEqual(filterWorkoutHistory(workouts, { exerciseId: '', date: '2026-10-25' }), [a, b])
    assert.equal(formatWorkoutDate('2026-10-25'), '25/10/2026')
  })
  it('combine exercice ET date, puis réinitialise les deux critères', () => {
    assert.deepEqual(filterWorkoutHistory(workouts, { exerciseId: 'snatch', date: '2026-10-25' }), [a])
    assert.deepEqual(filterWorkoutHistory(workouts, { exerciseId: 'back-squat', date: '2026-11-03' }), [])
    assert.deepEqual(filterWorkoutHistory(workouts, { exerciseId: '', date: '' }), [a, b, c])
  })
})

describe('présentation après clôture', () => {
  it('conserve les filtres compatibles avec la séance terminée', () => {
    const source = fixture()
    const filters = { exerciseId: 'snatch' as const, date: source.date }
    assert.deepEqual(historyFiltersForWorkout(filters, source), filters)
  })

  it('retire seulement les critères qui masqueraient la séance terminée', () => {
    const source = fixture()
    assert.deepEqual(historyFiltersForWorkout({ exerciseId: 'front-squat', date: source.date }, source), { exerciseId: '', date: source.date })
    assert.deepEqual(historyFiltersForWorkout({ exerciseId: 'snatch', date: '2026-10-25' }, source), { exerciseId: 'snatch', date: '' })
    assert.deepEqual(historyFiltersForWorkout({ exerciseId: 'back-squat', date: '2026-10-25' }, source), { exerciseId: '', date: '' })
  })

  it('ne modifie ni les filtres reçus ni la séance lors de l’ajustement', () => {
    const source = fixture(), filters = { exerciseId: 'front-squat' as const, date: '2026-10-25' }
    const before = structuredClone({ source, filters })
    const next = historyFiltersForWorkout(filters, source)
    assert.deepEqual(filterWorkoutHistory([{ ...source, status: 'completed' }], next), [{ ...source, status: 'completed' }])
    assert.deepEqual({ source, filters }, before)
  })

  it('accorde une clôture complète de plusieurs séries', () => {
    const source = fixture()
    source.exercises[0].sets = source.exercises[0].sets.slice(0, 3)
    assert.equal(workoutCompletionMessage(source), 'Vous avez réalisé les 3 séries de cette séance. La terminer et l’enregistrer dans l’historique ?')
  })

  it('accorde une clôture complète d’une seule série', () => {
    const source = fixture()
    source.exercises[0].sets = source.exercises[0].sets.slice(0, 1)
    assert.equal(workoutCompletionMessage(source), 'Vous avez réalisé la série de cette séance. La terminer et l’enregistrer dans l’historique ?')
  })

  it('accorde une seule série restante', () => {
    const source = fixture()
    source.exercises[0].sets = source.exercises[0].sets.slice(0, 4)
    assert.equal(workoutCompletionMessage(source), 'Vous avez réalisé 3 séries sur 4. La dernière série sera considérée comme non effectuée. Vos résultats et vos notes seront conservés.')
  })

  it('accorde plusieurs séries restantes et une seule série effectuée', () => {
    const source = fixture()
    assert.match(workoutCompletionMessage(source), /3 séries sur 5\. Les 2 autres séries seront considérées comme non effectuées/)
    delete source.exercises[0].sets[1].execution
    delete source.exercises[0].sets[2].execution
    assert.match(workoutCompletionMessage(source), /1 série sur 5\. Les 4 autres séries/)
  })
})
