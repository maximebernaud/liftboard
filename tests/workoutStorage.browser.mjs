// E2-A : vérifier la conservation réelle du formulaire après une écriture non confirmée.
// Profil isolé, aucune capture et aucun accès aux dossiers de revue existants.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBrowser } from './helpers/browser.mjs'
import { exercisePickerActions } from './helpers/exercisePicker.mjs'

const artifacts = await mkdtemp(join(tmpdir(), 'liftboard-e2a-storage-'))
const browser = await startBrowser(process.argv[2] ?? 'http://127.0.0.1:5181', artifacts)
const { call, click, enter, reload, evaluate } = browser
const { addExercise } = exercisePickerActions(browser)
let passed = 0
try {
  for (const mode of ['ignore', 'different', 'read-fails']) {
    await call(() => {
      localStorage.clear()
      sessionStorage.clear()
      localStorage.setItem('liftboard.personal-records.v1', '[{"exerciseId":"snatch","oneRepMaxKg":100}]')
      localStorage.setItem('liftboard.workouts.v1', '[]')
    })
    await reload()
    await click('+ Nouvelle séance')
    await enter('#workout-title', `Brouillon E2-A ${mode}`)
    await addExercise('snatch')
    await enter('.workout-set input[id$="-reps"]', '003')
    await enter('.workout-set input[id$="-intensity"]', '75')
    await call(mode => {
      window.e2aGet = Storage.prototype.getItem
      window.e2aSet = Storage.prototype.setItem
      window.e2aWrites = 0
      window.e2aTitleInput = document.querySelector('#workout-title')
      Storage.prototype.setItem = function(key, value) {
        if (key !== 'liftboard.workouts.v1') return window.e2aSet.call(this, key, value)
        window.e2aWrites++
        if (mode !== 'ignore') return window.e2aSet.call(this, key, value)
      }
      Storage.prototype.getItem = function(key) {
        if (key === 'liftboard.workouts.v1' && window.e2aWrites > 0) {
          if (mode === 'read-fails') throw new Error('Vérification inaccessible')
          if (mode === 'different') return 'null'
        }
        return window.e2aGet.call(this, key)
      }
    }, mode)
    await click('Enregistrer la séance')
    assert.equal(await evaluate('window.e2aWrites'), 1)
    assert.equal(await evaluate('document.querySelector("#workout-title") === window.e2aTitleInput'), true)
    assert.equal(await evaluate('document.querySelector("#workout-title").value'), `Brouillon E2-A ${mode}`)
    assert.equal(await call(() => document.querySelector('.workout-set input[id$="-reps"]').value), '003')
    assert.match(await evaluate('document.querySelector(".workout-editor .record-error[role=alert]").textContent'),
      mode === 'read-fails' ? /vérification est impossible/ : /n’a pas pu être confirmé/)
    const actual = await evaluate('JSON.parse(window.e2aGet.call(localStorage, "liftboard.workouts.v1"))')
    assert.equal(actual.length, mode === 'ignore' ? 0 : 1)
    await call(() => {
      Storage.prototype.getItem = window.e2aGet
      Storage.prototype.setItem = window.e2aSet
    })
    await click('Enregistrer la séance')
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("liftboard.workouts.v1")).length'), 1)
    if (mode === 'ignore') {
      assert.equal(await evaluate('Boolean(document.querySelector("#workout-title"))'), false)
    } else {
      // L'écriture réelle est relue : la création n'est jamais répétée en doublon.
      assert.equal(await evaluate('document.querySelector("#workout-title").value'), `Brouillon E2-A ${mode}`)
      assert.match(await evaluate('document.querySelector(".workout-editor .record-error[role=alert]").textContent'), /existe déjà/)
    }
    passed++
    console.log(`OK : ${mode}, brouillon conservé, état relu et aucun doublon`)
  }
  assert.deepEqual(browser.errors, [])
  console.log(`${passed} parcours de vérification du stockage réussis, 0 échoué. Profil isolé : ${artifacts}`)
} finally {
  browser.close()
}
