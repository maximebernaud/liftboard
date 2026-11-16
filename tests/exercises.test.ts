import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { exercises, exerciseFamilies, isExerciseId, isRecordExerciseId, recordExercises, type ExerciseId, type RecordExerciseId } from '../src/data/exercises.ts'
import { exercises as recordsView, isPersonalRecords, mutatePersonalRecord } from '../src/data/personalRecords.ts'
import { exerciseFavoritesStorageKey, loadExerciseFavorites, setExerciseFavorite } from '../src/data/exerciseFavorites.ts'
import { normalizeExerciseSearch, recentExercises, searchExercises } from '../src/lib/exerciseSearch.ts'
import { changeDraftMovement, createWorkoutDraft, createWorkoutExerciseDraft, duplicateWorkoutDraft, validateWorkoutDraft, workoutToDraft } from '../src/lib/workoutDraft.ts'
import { createWorkout, isWorkout, loadWorkouts, updateWorkout, workoutsStorageKey } from '../src/data/workouts.ts'
import { exportBackup, restoreBackup } from '../src/data/backup.ts'
import { parseBackup } from '../src/lib/dataBackup.ts'
import { filterWorkoutHistory, historyExercises } from '../src/lib/workoutHistory.ts'
import type { Workout, WorkoutExercise } from '../src/types/workout.ts'

type Assert<T extends true> = T
type CatalogueIncludesVariants = Assert<'power-snatch' extends ExerciseId ? true : false>
type WorkoutIncludesVariants = Assert<'power-snatch' extends WorkoutExercise['exerciseId'] ? true : false>
type RecordsExcludeVariants = Assert<'power-snatch' extends RecordExerciseId ? false : true>
const typesCompatible: CatalogueIncludesVariants & WorkoutIncludesVariants & RecordsExcludeVariants = true

function memory(raw: string | null = null) {
  const values = new Map<string, string>()
  if (raw !== null) values.set(exerciseFavoritesStorageKey, raw)
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

function workout(id: string, exerciseIds: ExerciseId[], date = '2026-11-16'): Workout {
  const draft = { ...createWorkoutDraft(), id, title: id, date, exercises: exerciseIds.map((exerciseId) => {
    const block = createWorkoutExerciseDraft(exerciseId)
    return { ...block, sets: block.sets.map((set) => ({ ...set, repsInput: '3', intensityInput: '75' })) }
  }) }
  const result = validateWorkoutDraft(draft, [{ exerciseId: 'snatch', oneRepMaxKg: 100 }])
  assert.ok(result.valid)
  return result.workout
}
const ids = (query: string) => searchExercises(query).map((exercise) => exercise.id)

describe('catalogue canonique E1', () => {
  it('contient 120 à 150 mouvements distincts, aux identifiants stables et métadonnées valides', () => {
    assert.ok(exercises.length >= 120 && exercises.length <= 150, String(exercises.length))
    assert.equal(new Set(exercises.map((exercise) => exercise.id)).size, exercises.length)
    assert.equal(new Set(exercises.map((exercise) => normalizeExerciseSearch(exercise.name))).size, exercises.length)
    for (const exercise of exercises) {
      assert.match(exercise.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      assert.ok(exerciseFamilies.some((family) => family.id === exercise.family))
      for (const value of [exercise.name, ...exercise.aliases, ...exercise.tags]) {
        assert.ok(value.trim() && value === value.trim())
      }
      assert.ok(exercise.aliases.length > 0 && exercise.tags.length > 0)
      assert.equal(isExerciseId(exercise.id), true)
    }
    assert.equal(exerciseFamilies.length, 8)
    assert.equal(isExerciseId('inconnu'), false)
    assert.equal(isExerciseId(null), false)
  })

  it('conserve les quatre noms et IDs historiques et une vue Records des mêmes objets', () => {
    assert.deepEqual(recordExercises.map(({ id, name }) => ({ id, name })), [
      { id: 'snatch', name: 'Snatch' }, { id: 'clean-and-jerk', name: 'Clean & Jerk' },
      { id: 'front-squat', name: 'Front Squat' }, { id: 'back-squat', name: 'Back Squat' },
    ])
    assert.equal(recordsView, recordExercises)
    for (const exercise of recordExercises) assert.equal(exercises.find((item) => item.id === exercise.id), exercise)
    assert.equal(isRecordExerciseId('power-snatch'), false)
    assert.equal(isRecordExerciseId('snatch'), true)
  })

  it('couvre les mouvements majeurs sans dupliquer Power / Push Jerk ni Overhead Squat', () => {
    for (const name of ['Snatch', 'Clean & Jerk', 'Power Snatch', 'Hang Snatch', 'High Hang Snatch', 'Muscle Snatch', 'Block Snatch', 'Snatch Balance', 'Drop Snatch', 'Clean', 'Power Clean', 'Hang Clean', 'High Hang Clean', 'Block Clean', 'Tall Clean', 'Muscle Clean', 'Split Jerk', 'Power Jerk', 'Squat Jerk', 'Jerk Balance', 'Jerk from Blocks', 'Snatch Pull', 'Clean Pull', 'Snatch Deadlift', 'Clean Deadlift', 'Romanian Deadlift', 'High Pull', 'Front Squat', 'Back Squat', 'Pause Squat', 'Tempo Squat', 'Overhead Squat', 'Split Squat', 'Push Press', 'Strict Press', 'Bench Press', 'Deadlift', 'Good Morning', 'Pendlay Row', 'Pull-up', 'Chin-up', 'Dumbbell Row', 'Lunges', 'Back Extension']) {
      assert.ok(exercises.some((exercise) => exercise.name === name), name)
    }
    assert.equal(ids('Push Jerk')[0], 'power-jerk')
    assert.equal(exercises.filter((exercise) => exercise.id === 'overhead-squat').length, 1)
    assert.equal(isExerciseId('farmer-carry'), false, 'La distance est hors E1')
  })

  it('reconnaît chaque ID dans les séances sans élargir les Records ou leurs mutations', () => {
    assert.equal(typesCompatible, true)
    const source = workout('tous', exercises.map((exercise) => exercise.id))
    assert.equal(isWorkout(source), true)
    assert.equal(isPersonalRecords([{ exerciseId: 'power-snatch', oneRepMaxKg: 80 }]), false)
    const storage = memory()
    const result = mutatePersonalRecord({ exerciseId: 'power-snatch' as 'snatch', original: null, oneRepMaxKg: 80 }, storage)
    assert.equal(result.ok, false)
    assert.equal(storage.values.size, 0)
  })
})

describe('recherche FR / EN et classement', () => {
  it('normalise accents, casse, espaces, ponctuation et séparateurs', () => {
    assert.deepEqual(ids('ARRACHÉ'), ids('arrache'))
    assert.deepEqual(ids('épaulé'), ids('epaule'))
    assert.deepEqual(ids('  PoWeR   SnAtCh  '), ids('power-snatch'))
    assert.deepEqual(ids('clean & jerk'), ids('clean-and-jerk'))
    assert.deepEqual(ids('front_squat'), ids('front/squat'))
  })

  it('place noms exacts et alias exacts avant variantes et noms partiels', () => {
    for (const [query, expected] of [['snatch', 'snatch'], ['power snatch', 'power-snatch'], ['arraché', 'snatch'], ['épaulé', 'clean'], ['c&j', 'clean-and-jerk'], ['front squat', 'front-squat'], ['rdl', 'romanian-deadlift']]) {
      assert.equal(ids(query)[0], expected, query)
    }
    const rank = ids('snatch')
    assert.ok(rank.indexOf('snatch-pull') < rank.indexOf('power-snatch'), 'Préfixe du nom avant correspondance partielle')
    assert.ok(rank.includes('overhead-squat'), 'Tags techniques')
  })

  it('retrouve alias et tags FR/EN, suspension, tirages et mots techniques combinés', () => {
    assert.ok(ids('tirage').includes('clean-pull'))
    assert.ok(ids('hang').includes('hang-snatch'))
    assert.ok(ids('suspension').includes('hang-clean'))
    assert.ok(ids('pieds fixes').includes('no-foot-snatch'))
    assert.ok(ids('unilateral ischios').includes('single-leg-romanian-deadlift'))
  })

  it('combine famille et recherche, accepte zéro résultat et garde un ordre déterministe sans doublon', () => {
    const result = searchExercises('hang', 'clean')
    assert.ok(result.length > 0 && result.every((exercise) => exercise.family === 'clean'))
    assert.deepEqual(searchExercises('c&j', 'squats'), [])
    assert.deepEqual(searchExercises('zzintrouvable'), [])
    assert.deepEqual(searchExercises(''), [...exercises])
    for (const query of ['', 'snatch', 'epaule', 'hang', 'tirage']) {
      const first = ids(query)
      assert.deepEqual(first, ids(query))
      assert.equal(new Set(first).size, first.length)
    }
    assert.deepEqual(searchExercises('hang').filter((exercise) => exercise.family === 'clean'), result)
  })
})

describe('récents sans nouvelle persistance', () => {
  it('déduit au plus six mouvements uniques dans l’ordre d’enregistrement, sans utiliser les dates programmées', () => {
    const oldest = workout('ancien', ['snatch', 'clean-and-jerk'], '2099-01-01')
    const latest = workout('nouveau', ['power-snatch', 'snatch', 'front-squat', 'back-squat', 'clean-pull', 'clean'], '2000-01-01')
    const before = structuredClone([oldest, latest])
    assert.deepEqual(recentExercises([oldest, latest]).map((exercise) => exercise.id), ['power-snatch', 'snatch', 'front-squat', 'back-squat', 'clean-pull', 'clean'])
    assert.deepEqual([oldest, latest], before)
    assert.equal(recentExercises([oldest, latest], 8).length, 7)
  })

  it('ignore inconnus, doublons et absence de séances', () => {
    assert.deepEqual(recentExercises([]), [])
    const source = workout('récent', ['snatch', 'snatch', 'clean'])
    source.exercises[0].exerciseId = 'inconnu' as ExerciseId
    assert.deepEqual(recentExercises([source]).map((exercise) => exercise.id), ['snatch', 'clean'])
    assert.deepEqual(recentExercises([source], 0), [])
  })
})

describe('favoris et protections de stockage', () => {
  it('lit un stockage vierge sans écrire et nettoie doublons / inconnus seulement en mémoire', () => {
    const storage = memory()
    assert.deepEqual(loadExerciseFavorites(storage), { ok: true, ids: [] })
    assert.equal(storage.values.size, 0)
    const raw = '["snatch","snatch","inconnu",1,null,"power-clean"]'
    storage.setItem(exerciseFavoritesStorageKey, raw)
    assert.deepEqual(loadExerciseFavorites(storage), { ok: true, ids: ['snatch', 'power-clean'] })
    assert.equal(storage.getItem(exerciseFavoritesStorageKey), raw)
  })

  it('ajoute et retire explicitement, persiste uniquement des IDs connus et préserve les autres clés', () => {
    const storage = memory()
    storage.setItem(workoutsStorageKey, 'séances inchangées')
    assert.deepEqual(setExerciseFavorite('snatch', true, storage), { ok: true, ids: ['snatch'] })
    assert.deepEqual(setExerciseFavorite('snatch', true, storage), { ok: true, ids: ['snatch'] })
    assert.deepEqual(setExerciseFavorite('power-clean', true, storage), { ok: true, ids: ['snatch', 'power-clean'] })
    assert.deepEqual(setExerciseFavorite('snatch', false, storage), { ok: true, ids: ['power-clean'] })
    assert.deepEqual(loadExerciseFavorites(storage), { ok: true, ids: ['power-clean'] })
    assert.equal(storage.getItem(workoutsStorageKey), 'séances inchangées')
    assert.equal(setExerciseFavorite('inconnu' as ExerciseId, true, storage).ok, false)
  })

  it('relit les préférences actuelles avant une mutation ciblée entre onglets', () => {
    const storage = memory('["snatch"]')
    loadExerciseFavorites(storage)
    storage.setItem(exerciseFavoritesStorageKey, '["snatch","clean"]')
    assert.deepEqual(setExerciseFavorite('snatch', false, storage), { ok: true, ids: ['clean'] })
  })

  it('préserve octet pour octet les JSON malformés et formats incompatibles, sans écriture', () => {
    for (const raw of ['{cassé', '{}', 'null', '1', '"snatch"']) {
      const storage = memory(raw)
      assert.equal(loadExerciseFavorites(storage).ok, false)
      assert.equal(setExerciseFavorite('snatch', true, storage).ok, false)
      assert.equal(storage.getItem(exerciseFavoritesStorageKey), raw)
    }
  })

  it('résiste aux lectures indisponibles et aux écritures refusées ou au quota sans perte', () => {
    const raw = '["snatch"]'
    const original = memory(raw)
    const unreadable = { ...original, getItem: () => { throw new Error('indisponible') } }
    assert.equal(loadExerciseFavorites(unreadable).ok, false)
    assert.equal(setExerciseFavorite('clean', true, unreadable).ok, false)
    for (const name of ['Error', 'QuotaExceededError']) {
      const storage = { ...original, setItem: () => { const error = new Error('refusé'); error.name = name; throw error } }
      const result = setExerciseFavorite('clean', true, storage)
      assert.equal(result.ok, false)
      if (!result.ok && name === 'QuotaExceededError') assert.match(result.error, /plein/)
      assert.equal(original.getItem(exerciseFavoritesStorageKey), raw)
    }
  })

  it('ne confirme pas une écriture silencieuse ou une relecture en échec', () => {
    const storage = memory('["snatch"]')
    assert.equal(setExerciseFavorite('clean', true, { ...storage, setItem: () => {} }).ok, false)
    let writes = 0
    const result = setExerciseFavorite('clean', true, { ...storage, getItem: (key) => { if (writes) throw new Error('lecture'); return storage.getItem(key) }, setItem: (key, value) => { storage.setItem(key, value); writes++ } })
    assert.equal(result.ok, false)
  })
})

describe('intégration séances, historique et sauvegardes E1', () => {
  it('sauvegarde et relit de nouveaux IDs sans emprunter de record ou fabriquer 0 kg', () => {
    const source = workout('E1', ['snatch', 'power-snatch', 'clean-pull', 'pull-up', 'power-snatch'])
    assert.deepEqual(source.exercises.map((block) => block.sets[0].load), [{ exactKg: 75, selectedKg: 75 }, null, null, null, null])
    const storage = memory()
    assert.equal(createWorkout(source, storage).ok, true)
    assert.deepEqual(loadWorkouts(storage), { ok: true, workouts: [source] })
    const copy = validateWorkoutDraft(duplicateWorkoutDraft(source), [{ exerciseId: 'snatch', oneRepMaxKg: 120 }])
    assert.ok(copy.valid)
    assert.deepEqual(copy.workout.exercises[1].sets[0].load, null)
    assert.deepEqual(copy.workout.exercises[0].sets[0].load, { exactKg: 90, selectedKg: 90 })
  })

  it('change le mouvement via la logique existante, préserve séries et arrondis, puis recalcule seulement le bloc ciblé', () => {
    const source = workout('changement', ['snatch', 'front-squat'])
    const draft = workoutToDraft(source)
    draft.exercises[0].sets[0].rounding = { mode: 'up', increment: 2.5 }
    const before = structuredClone(draft)
    const changed = changeDraftMovement(draft, draft.exercises[0].id, 'power-snatch')
    assert.equal(changed.exercises[0].sets.length, draft.exercises[0].sets.length)
    assert.deepEqual(changed.exercises[0].sets[0], { ...draft.exercises[0].sets[0], savedLoad: undefined })
    assert.equal(changed.exercises[1], draft.exercises[1])
    assert.deepEqual(draft, before)
    const result = validateWorkoutDraft(changed, [{ exerciseId: 'snatch', oneRepMaxKg: 100 }])
    assert.ok(result.valid)
    assert.equal(result.workout.exercises[0].sets[0].load, null)
    assert.equal(changeDraftMovement(draft, draft.exercises[0].id, 'snatch').exercises[0], draft.exercises[0])
  })

  it('maintient les protections du suivi et des conflits avec les nouveaux mouvements', () => {
    const source = workout('protégé', ['power-clean'])
    const storage = memory()
    createWorkout(source, storage)
    const tracked = structuredClone(source)
    tracked.exercises[0].sets[0].execution = { completed: false, reps: 3, loadKg: null }
    storage.setItem(workoutsStorageKey, JSON.stringify([tracked]))
    assert.equal(updateWorkout({ ...source, title: 'modifié' }, source, storage).ok, false)
    assert.deepEqual(loadWorkouts(storage), { ok: true, workouts: [tracked] })
  })

  it('limite le filtre Historique aux mouvements présents dans les séances terminées', () => {
    const completed = { ...workout('terminée', ['power-snatch', 'snatch', 'snatch']), status: 'completed' as const }
    const planned = workout('planifiée', ['clean'])
    assert.deepEqual(historyExercises([completed, planned]).map((exercise) => exercise.id), ['snatch', 'power-snatch'])
    assert.deepEqual(filterWorkoutHistory([completed, planned], { exerciseId: 'power-snatch', date: '' }), [completed])
    assert.deepEqual(historyExercises([]), [])
  })

  it('exporte et réimporte anciens et nouveaux exercices en version 1 sans catalogue ni favoris', () => {
    const source = workout('export', ['snatch', 'clean-and-jerk', 'front-squat', 'back-squat', 'power-clean', 'dumbbell-row'])
    const storage = memory('["power-clean"]')
    createWorkout(source, storage)
    const exported = exportBackup(storage)
    assert.ok(exported.ok)
    assert.equal(exported.value.backup.version, 1)
    assert.deepEqual(Object.keys(exported.value.backup.data), ['records', 'workouts'])
    const parsed = parseBackup(exported.value.json)
    assert.ok(parsed.ok)
    const restored = memory('["snatch"]')
    assert.equal(restoreBackup(parsed.value, restored).ok, true)
    assert.deepEqual(loadWorkouts(restored), { ok: true, workouts: [source] })
    assert.equal(restored.getItem(exerciseFavoritesStorageKey), '["snatch"]')
  })
})
