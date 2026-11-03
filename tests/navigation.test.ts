import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findTrackedWorkout, loadNavigation, navigationStorageKey, saveNavigation } from '../src/lib/navigation.ts'
import type { NavigationState } from '../src/lib/navigation.ts'
import type { Workout } from '../src/types/workout.ts'

describe('restauration de navigation par onglet', () => {
  it('restaure seulement la section et l’identifiant stable du suivi', () => {
    let raw: string | null = null
    const storage = {
      getItem(key: string) { assert.equal(key, navigationStorageKey); return raw },
      setItem(key: string, value: string) { assert.equal(key, navigationStorageKey); raw = value },
    }
    assert.deepEqual(loadNavigation(storage), { section: 'sessions', trackingWorkoutId: null })
    for (const section of ['sessions', 'records', 'calculator', 'history'] as const) {
      const navigation: NavigationState = { section, trackingWorkoutId: 'workout-1' }
      saveNavigation(navigation, storage)
      assert.deepEqual(loadNavigation(storage), navigation)
      assert.deepEqual(Object.keys(JSON.parse(raw!)), ['section', 'trackingWorkoutId'])
    }
  })

  it('oublie le suivi après un retour volontaire à la liste', () => {
    let raw = JSON.stringify({ section: 'sessions', trackingWorkoutId: 'workout-1' })
    const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
    saveNavigation({ section: 'sessions', trackingWorkoutId: null }, storage)
    assert.deepEqual(loadNavigation(storage), { section: 'sessions', trackingWorkoutId: null })
  })

  it('se replie sur la liste pour des données malformées sans changer les séances', () => {
    for (const raw of ['{', 'null', '[]', '{}', '"sessions"',
      '{"section":"unknown","trackingWorkoutId":"workout-1"}',
      '{"section":"sessions","trackingWorkoutId":2}',
      '{"section":"sessions","trackingWorkoutId":" "}']) {
      const storage = { getItem: () => raw, setItem: () => assert.fail('Pas d’écriture pendant la lecture') }
      assert.deepEqual(loadNavigation(storage), { section: 'sessions', trackingWorkoutId: null })
    }
  })

  it('continue en mémoire si sessionStorage est inaccessible en lecture ou en écriture', () => {
    const storage = { getItem: () => { throw new Error('Denied') }, setItem: () => { throw new Error('Denied') } }
    assert.deepEqual(loadNavigation(storage), { section: 'sessions', trackingWorkoutId: null })
    assert.doesNotThrow(() => saveNavigation({ section: 'records', trackingWorkoutId: null }, storage))
  })

  it('ne restaure jamais une séance supprimée ou terminée', () => {
    const planned: Workout = { id: 'existing', title: 'TEST J6', date: '2026-11-03', status: 'planned',
      exercises: [], notes: { before: '', during: '', after: '' } }
    assert.equal(findTrackedWorkout([planned], 'existing'), planned)
    assert.equal(findTrackedWorkout([planned], 'deleted'), null)
    assert.equal(findTrackedWorkout([], 'existing'), null)
    assert.equal(findTrackedWorkout([{ ...planned, status: 'completed' }], 'existing'), null)
    assert.equal(findTrackedWorkout([planned], null), null)
  })
})
