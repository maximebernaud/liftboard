// Recette E1 sans dépendance : interactions réelles Chrome/CDP et profil isolé.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { exercises, exerciseFamilies } from '../src/data/exercises.ts'
import { startBrowser } from './helpers/browser.mjs'
import { exercisePickerActions } from './helpers/exercisePicker.mjs'

const artifacts = resolve('.lot-e1-review.local/screenshots')
await mkdir(artifacts, { recursive: true })
const browser = await startBrowser(process.argv[2] ?? 'http://127.0.0.1:5178', artifacts)
const { call, evaluate, click, enter, key, settle, viewport, capture, reload } = browser
const { addExercise, changeExercise } = exercisePickerActions({ call, click, settle })
const picker = '.exercise-picker[open]'
const search = `${picker} input[type=search]`
const records = ['snatch', 'clean-and-jerk', 'front-squat', 'back-squat'].map(exerciseId => ({ exerciseId, oneRepMaxKg: 100 }))
const favoriteKey = 'liftboard.exercise-favorites.v1'
const workoutKey = 'liftboard.workouts.v1'
const seedWorkout = (id, ids, status = 'planned', date = '2026-11-16') => ({
  id, title: id, date, status, notes: { before: '', during: '', after: '' },
  exercises: ids.map((exerciseId, index) => ({ id: `${id}-block-${index}`, exerciseId, sets: [{
    id: `${id}-set-${index}`, reps: 3, intensityPct: 75, rounding: { mode: 'exact' }, load: null,
    ...(status === 'completed' ? { execution: { completed: true, reps: 3, loadKg: 50 } } : {}),
  }] })),
})
const storage = () => evaluate(`({records: localStorage.getItem('liftboard.personal-records.v1'), workouts: localStorage.getItem('${workoutKey}')})`)
const blocks = () => call(() => [...document.querySelectorAll('.workout-exercise')].map(block => ({
  name: block.querySelector('h3').textContent,
  fields: [...block.querySelectorAll('input,select')].map(field => ({ id: field.id, value: field.value })),
})))
const visibleIds = () => evaluate(`[...document.querySelectorAll('${picker} [data-exercise-id]')].map(button => button.dataset.exerciseId)`)
const closePicker = () => click('Annuler', picker)
async function favorite(id) {
  await call(id => {
    const button = document.querySelector(`.exercise-picker[open] [data-favorite-id="${id}"]`)
    button.focus({ preventScroll: true })
    button.click()
  }, id)
  await settle()
}
async function family(id) {
  await call(id => {
    const select = document.querySelector('.exercise-picker-family-select')
    select.value = id
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }, id)
  await settle()
}
async function seed(workouts = [], favorites = null) {
  await call((records, workouts, favorites, favoriteKey, workoutKey) => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('liftboard.personal-records.v1', JSON.stringify(records))
    localStorage.setItem(workoutKey, JSON.stringify(workouts))
    if (favorites !== null) localStorage.setItem(favoriteKey, favorites)
  }, records, workouts, favorites, favoriteKey, workoutKey)
  await reload()
}
let passed = 0
const checks = []
async function check(name, action) {
  await action()
  checks.push(name)
  passed++
  console.log(`✓ ${name}`)
}
async function scaleText(scale) {
  await call(scale => {
    if (scale === 1) {
      for (const [element, style] of window.e1OriginalStyles ?? []) {
        if (style === null) element.removeAttribute('style')
        else element.setAttribute('style', style)
      }
      window.e1OriginalStyles = []
      return
    }
    const values = [...document.querySelectorAll('.exercise-picker, .exercise-picker *')].map(element => ({
      element, style: element.getAttribute('style'), size: parseFloat(getComputedStyle(element).fontSize), line: parseFloat(getComputedStyle(element).lineHeight),
    }))
    window.e1OriginalStyles = values.map(({ element, style }) => [element, style])
    for (const { element, size, line } of values) {
      element.style.setProperty('font-size', `${size * scale}px`, 'important')
      if (Number.isFinite(line)) element.style.setProperty('line-height', `${line * scale}px`, 'important')
    }
  }, scale)
  await settle()
}

async function inspectLayout(width) {
  const layout = await call(() => {
    const dialog = document.querySelector('.exercise-picker')
    const box = dialog.getBoundingClientRect()
    const visible = [...dialog.querySelectorAll('*')].filter(element => element.getClientRects().length)
    const small = visible.filter(element => element.matches('button,input,select')).filter(element => { const rect = element.getBoundingClientRect(); return rect.width < 43.5 || rect.height < 43.5 }).map(element => element.textContent || element.id)
    const clipped = visible.filter(element => element.matches('button,label,h2,h3,p') && element.clientWidth && element.scrollWidth > element.clientWidth + 2).map(element => element.textContent)
    const scroll = dialog.querySelector('.exercise-picker-scroll')
    return { left: box.left, right: box.right, viewportOverflow: document.documentElement.scrollWidth > innerWidth, horizontalOverflow: dialog.scrollWidth > dialog.clientWidth, small, clipped, scrollable: scroll.scrollHeight > scroll.clientHeight, scrollHeight: scroll.clientHeight }
  })
  assert.ok(layout.left >= 0 && layout.right <= width + 1, JSON.stringify(layout))
  assert.equal(layout.viewportOverflow, false)
  assert.equal(layout.horizontalOverflow, false)
  assert.deepEqual(layout.small, [])
  assert.deepEqual(layout.clipped, [])
  return layout
}

try {
  await seed()
  await viewport(1440)
  await check('Ouvrir / annuler / Échap ne créent aucun bloc, aucune écriture et aucune modification à abandonner', async () => {
    await click('+ Nouvelle séance')
    const before = await storage()
    await click('+ Ajouter un exercice')
    assert.equal(await evaluate('document.activeElement.type'), 'search')
    assert.equal(await evaluate('document.body.style.overflow'), 'hidden')
    assert.equal((await blocks()).length, 0)
    assert.equal((await visibleIds()).length, exercises.length)
    assert.equal(await evaluate(`document.querySelector('${picker}').textContent.includes('Dans tes dernières séances')`), false)
    await enter(search, 'power snatch')
    await key('Enter', 13)
    assert.equal((await blocks()).length, 0)
    await key('Escape', 27)
    assert.equal(await evaluate('Boolean(document.querySelector(".exercise-picker[open]"))'), false)
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), '+ Ajouter un exercice')
    assert.equal(await evaluate('document.body.style.overflow'), '')
    await click('+ Ajouter un exercice')
    await click('Fermer le sélecteur d’exercices', picker)
    assert.deepEqual(await storage(), before)
    await click('Annuler', 'form.workout-editor')
    assert.equal(await evaluate('Boolean(document.querySelector("dialog[open]"))'), false)
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Mes séances')
  })

  await click('+ Nouvelle séance')
  await enter('#workout-title', 'Bibliothèque E1')
  await enter('#workout-date', '2026-11-16')
  await click('+ Ajouter un exercice')
  await capture('01-selecteur-desktop')
  await check('Dialogue natif : clavier, focus initial, boucle Tab / Maj-Tab et absence de boutons imbriqués', async () => {
    assert.equal(await evaluate(`document.querySelector('${picker}').getAttribute('aria-modal')`), 'true')
    assert.equal(await evaluate(`document.querySelectorAll('${picker} button button').length`), 0)
    await call(() => document.querySelector('.exercise-picker-footer button').focus())
    await key('Tab', 9)
    assert.equal(await evaluate('Boolean(document.activeElement.closest(".exercise-picker"))'), true)
    await call(() => document.querySelector('.exercise-picker-close').focus())
    await key('Tab', 9, 8)
    assert.equal(await evaluate('Boolean(document.activeElement.closest(".exercise-picker"))'), true)
    await call(() => document.querySelector('.exercise-picker input').focus())
  })

  await check('Recherche FR / EN, priorité exacte, filtre conservé, zéro résultat et réinitialisation', async () => {
    await enter(search, 'snatch')
    assert.equal((await visibleIds())[0], 'snatch')
    await capture('02-recherche-snatch')
    await click('Arraché / Snatch', '.exercise-picker-chips')
    assert.ok((await visibleIds()).every(id => exercises.find(exercise => exercise.id === id).family === 'snatch'))
    await capture('03-categorie-arrache')
    await enter(search, 'front squat')
    assert.equal(await evaluate('document.querySelector(".exercise-picker-family-select").value'), 'snatch')
    assert.deepEqual(await visibleIds(), [])
    assert.match(await evaluate('document.querySelector(".exercise-picker-empty").textContent'), /Aucun exercice trouvé/)
    await capture('08-aucun-resultat')
    await click('Effacer la recherche', '.exercise-picker-empty')
    assert.equal((await visibleIds()).length, exercises.filter(exercise => exercise.family === 'snatch').length)
    await click('Tout réinitialiser', '.exercise-picker-toolbar')
    await enter(search, '  ARRACHÉ  ')
    assert.equal((await visibleIds())[0], 'snatch')
    await enter(search, 'c&j')
    assert.equal((await visibleIds())[0], 'clean-and-jerk')
    await click('Effacer la recherche', '.exercise-picker-search')
  })

  await check('Favoris indépendants du choix : état vide, ajout, filtre, retrait et persistance sans séance modifiée', async () => {
    const before = await storage()
    await click('☆ Favoris (0)', '.exercise-picker-toolbar')
    assert.match(await evaluate('document.querySelector(".exercise-picker-empty").textContent'), /Aucun favori/)
    await click('Afficher tous les exercices', picker)
    await favorite('power-snatch')
    assert.equal((await blocks()).length, 0)
    assert.equal(await evaluate('Boolean(document.activeElement.matches("[data-favorite-id=power-snatch]"))'), true)
    assert.deepEqual(JSON.parse(await evaluate(`localStorage.getItem('${favoriteKey}')`)), ['power-snatch'])
    const ids = await visibleIds()
    assert.equal(new Set(ids).size, ids.length)
    await click('☆ Favoris (1)', '.exercise-picker-toolbar')
    assert.deepEqual(await visibleIds(), ['power-snatch'])
    await capture('04-favoris')
    await favorite('power-snatch')
    assert.equal(await evaluate('document.activeElement.type'), 'search')
    assert.deepEqual(await visibleIds(), [])
    await click('Afficher tous les exercices', picker)
    await favorite('power-snatch')
    await closePicker()
    await click('+ Ajouter un exercice')
    assert.equal(await evaluate('document.querySelector("[data-favorite-id=power-snatch]").getAttribute("aria-pressed")'), 'true')
    assert.deepEqual(await storage(), before)
  })

  await check('Ajout après choix seulement, bon mouvement, focus dans la première série et absence de faux Record', async () => {
    await enter(search, 'power snatch')
    await call(() => document.querySelector('.exercise-picker [data-exercise-id="power-snatch"]').focus())
    await key('Enter', 13)
    assert.equal((await blocks()).length, 1)
    assert.match((await blocks())[0].name, /Power Snatch/)
    assert.equal(await evaluate('document.activeElement.id.endsWith("-reps")'), true)
    assert.equal(await evaluate('document.querySelectorAll(".workout-record-context button").length'), 0)
    assert.match(await evaluate('document.querySelector(".workout-record-context").textContent'), /Aucun Record disponible/)
    await enter('.workout-exercise input[id$=reps]', '3')
    await enter('.workout-exercise input[id$=intensity]', '75')
    assert.equal(await evaluate('document.querySelector(".workout-load strong").textContent'), '—')
    await viewport(375)
    await call(() => document.querySelector('.workout-exercise').scrollIntoView({ block: 'start' }))
    await capture('07-editeur-apres-selection')
    await viewport(1440)
    await capture('07b-editeur-desktop')
    await viewport(375)
  })

  await check('Changer / annuler préserve les séries, puis la logique métier recalcule uniquement le mouvement choisi', async () => {
    const before = await blocks()
    await click('Changer le mouvement de l’exercice 1 : Power Snatch')
    await enter(search, 'front squat')
    await closePicker()
    assert.deepEqual(await blocks(), before)
    assert.match(await evaluate('document.activeElement.className'), /workout-movement-button/)
    await changeExercise('front-squat')
    assert.deepEqual((await blocks())[0].fields, before[0].fields)
    assert.match(await evaluate('document.querySelector(".workout-load strong").textContent'), /75 kg/)
    await changeExercise('power-snatch')
    assert.deepEqual((await blocks())[0].fields, before[0].fields)
    assert.equal(await evaluate('document.querySelector(".workout-load strong").textContent'), '—')
    await addExercise('power-snatch')
    assert.equal((await blocks()).length, 2)
    assert.equal(await evaluate('document.activeElement.id === document.querySelector(".workout-exercise:last-child input").id'), true)
    await enter('.workout-exercise:last-child input[id$=reps]', '2')
    await enter('.workout-exercise:last-child input[id$=intensity]', '80')
    await click('Enregistrer la séance')
    const saved = JSON.parse((await storage()).workouts)[0]
    assert.deepEqual(saved.exercises.map(block => block.exerciseId), ['power-snatch', 'power-snatch'])
    assert.ok(saved.exercises.every(block => block.sets[0].load === null))
    const allIds = [saved.id, ...saved.exercises.flatMap(block => [block.id, ...block.sets.map(set => set.id)])]
    assert.equal(new Set(allIds).size, allIds.length)
    await reload()
    await click('Ouvrir', '.workout-session-list')
    assert.match(await evaluate('document.querySelector(".workout-detail").textContent'), /Power Snatch/)
  })

  await check('Nouvel ID : édition avec charges figées, duplication indépendante, suivi protégé et filtre Historique', async () => {
    await click('Modifier', '.workout-detail')
    const before = await blocks()
    await changeExercise('power-snatch')
    assert.match(await evaluate('document.querySelector(".workout-draft-state").textContent'), /Édition de la séance enregistrée/)
    assert.deepEqual(await blocks(), before)
    await click('Changer le mouvement de l’exercice 1 : Power Snatch')
    await key('Escape', 27)
    assert.deepEqual(await blocks(), before)
    await changeExercise('clean-pull')
    assert.deepEqual((await blocks())[0].fields, before[0].fields)
    await click('Enregistrer les modifications')
    const source = JSON.parse((await storage()).workouts)[0]
    assert.equal(source.exercises[0].exerciseId, 'clean-pull')
    assert.equal(source.exercises[0].sets[0].load, null)
    await click('Dupliquer', '.workout-session-list')
    assert.match(await evaluate('document.querySelector(".workout-movement-button").textContent'), /Clean Pull/)
    await click('Enregistrer la séance')
    const saved = JSON.parse((await storage()).workouts)
    assert.equal(saved.length, 2)
    assert.deepEqual(saved[0], source)
    assert.equal(saved[1].exercises[0].exerciseId, 'clean-pull')
    assert.notEqual(saved[1].exercises[0].id, source.exercises[0].id)
    assert.equal(saved[1].exercises[0].sets[0].load, null)
    await call(workoutKey => {
      const workouts = JSON.parse(localStorage.getItem(workoutKey))
      workouts[0].exercises[0].sets[0].execution = { completed: false, reps: 2, loadKg: 50 }
      workouts[1].status = 'completed'
      workouts[1].exercises[0].sets[0].execution = { completed: true, reps: 2, loadKg: 55 }
      localStorage.setItem(workoutKey, JSON.stringify(workouts))
    }, workoutKey)
    await reload()
    await click('Ouvrir', '.workout-session-list')
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-detail button")].find(button => button.textContent === "Modifier").disabled'), true)
    await click('Reprendre le suivi', '.workout-detail')
    assert.match(await evaluate('document.querySelector(".workout-execution-content").textContent'), /Clean Pull/)
    await click('Historique', '.primary-nav')
    assert.deepEqual(await evaluate('[...document.querySelector("#history-exercise").options].map(option => option.value)'), ['', 'power-snatch', 'clean-pull'])
    await call(() => {
      const select = document.querySelector('#history-exercise')
      select.value = 'clean-pull'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await settle()
    await click('Consulter', '.history-journal')
    assert.match(await evaluate('document.querySelector(".workout-history .workout-detail").textContent'), /Clean Pull/)
  })

  await check('Récents déduits des séances enregistrées, ordre déterministe et aucune suggestion en double', async () => {
    await seed([
      seedWorkout('enregistrée avant', ['snatch', 'clean-and-jerk'], 'completed', '2099-01-01'),
      seedWorkout('enregistrée après', ['power-clean', 'snatch', 'front-squat', 'clean-pull', 'back-squat', 'pull-up'], 'planned', '2000-01-01'),
    ], '["snatch"]')
    const before = await storage()
    await click('+ Nouvelle séance')
    await click('+ Ajouter un exercice')
    assert.match(await evaluate(`document.querySelector('${picker}').textContent`), /Dans tes dernières séances/)
    const recent = await evaluate('[...document.querySelectorAll(".exercise-picker section")].find(section => section.textContent.includes("Dans tes dernières séances"))?.querySelectorAll("[data-exercise-id]") && [...[...document.querySelectorAll(".exercise-picker section")].find(section => section.textContent.includes("Dans tes dernières séances")).querySelectorAll("[data-exercise-id]")].map(button => button.dataset.exerciseId)')
    assert.deepEqual(recent, ['power-clean', 'front-squat', 'clean-pull', 'back-squat', 'pull-up', 'clean-and-jerk'])
    const ids = await visibleIds()
    assert.equal(ids.length, exercises.length)
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual(await storage(), before)
    await closePicker()
  })

  await check('Favoris illisibles, lecture indisponible, quota et écriture refusée : catalogue utilisable sans écrasement', async () => {
    for (const mode of ['malformed', 'read', 'write', 'quota']) {
      await call((mode, favoriteKey) => {
        localStorage.setItem(favoriteKey, mode === 'malformed' ? '{cassé' : '["snatch"]')
        window.e1Get = Storage.prototype.getItem
        window.e1Set = Storage.prototype.setItem
        if (mode === 'read') Storage.prototype.getItem = function(key) { if (key === favoriteKey) throw new DOMException('refusé', 'SecurityError'); return window.e1Get.call(this, key) }
        if (mode === 'write' || mode === 'quota') Storage.prototype.setItem = function(key, value) { if (key === favoriteKey) throw new DOMException('refusé', mode === 'quota' ? 'QuotaExceededError' : 'SecurityError'); return window.e1Set.call(this, key, value) }
      }, mode, favoriteKey)
      const before = await storage()
      await click('+ Ajouter un exercice')
      await favorite('power-clean')
      assert.equal((await blocks()).length, 0)
      assert.match(await evaluate('document.querySelector(".exercise-picker [role=alert]").textContent'), /favori|préférence|plein/)
      assert.equal((await visibleIds()).length, exercises.length)
      await closePicker()
      await call(() => { Storage.prototype.getItem = window.e1Get; Storage.prototype.setItem = window.e1Set })
      assert.equal(await evaluate(`localStorage.getItem('${favoriteKey}')`), mode === 'malformed' ? '{cassé' : '["snatch"]')
      assert.deepEqual(await storage(), before)
    }
  })

  for (const mode of ['malformed', 'read']) await check(`Séances ${mode} : récents masqués, aucune écriture de réparation`, async () => {
    await call((mode, workoutKey) => {
      if (mode === 'malformed') localStorage.setItem(workoutKey, '{séances cassées')
      window.e1WorkoutGet = Storage.prototype.getItem
      if (mode === 'read') Storage.prototype.getItem = function(key) { if (key === workoutKey) throw new Error('refusé'); return window.e1WorkoutGet.call(this, key) }
    }, mode, workoutKey)
    await click('+ Ajouter un exercice')
    assert.equal(await evaluate(`document.querySelector('${picker}').textContent.includes('Dans tes dernières séances')`), false)
    await closePicker()
    await call(() => { Storage.prototype.getItem = window.e1WorkoutGet })
    assert.equal(await evaluate(`localStorage.getItem('${workoutKey}')`), '{séances cassées')
  })

  await seed([], '["power-snatch"]')
  await click('+ Nouvelle séance')
  await click('+ Ajouter un exercice')
  for (const width of [320, 375, 412, 768, 1024, 1440]) {
    await viewport(width)
    for (const scale of [1, 2]) await check(`Sélecteur ${width} px, texte ${scale * 100} % : largeur, contrôles, défilement et focus`, async () => {
      await scaleText(scale)
      const layout = await inspectLayout(width)
      assert.ok(layout.scrollable && layout.scrollHeight > 44)
      if (width === 375 && scale === 1) await capture('05-selecteur-mobile')
      if (scale === 2) await capture(`texte-200-${width}`)
      await scaleText(1)
      for (const query of ['snatch', 'zzintrouvable']) {
        await enter(search, query)
        await scaleText(scale)
        await inspectLayout(width)
        if (query === 'snatch' && width === 375 && scale === 1) await capture('06-recherche-mobile')
        if (query === 'zzintrouvable') assert.match(await evaluate('document.querySelector(".exercise-picker-empty").textContent'), /Aucun exercice trouvé/)
        await scaleText(1)
      }
      await enter(search, '')
    })
  }
  await check('Hauteur mobile réduite pour clavier virtuel et navigation basse restaurée à la fermeture', async () => {
    await viewport(375, 480)
    await family('snatch')
    await enter(search, 'power snatch')
    assert.equal((await visibleIds())[0], 'power-snatch')
    assert.ok(await evaluate('document.querySelector(".exercise-picker-scroll").clientHeight > 44'))
    await scaleText(2)
    await inspectLayout(375)
    assert.ok(await evaluate('document.querySelector(".exercise-picker").scrollHeight > document.querySelector(".exercise-picker").clientHeight'))
    await call(() => {
      const choice = document.querySelector('.exercise-picker [data-exercise-id="power-snatch"]')
      choice.focus()
      choice.scrollIntoView({ block: 'nearest' })
    })
    assert.ok(await evaluate('document.activeElement.getBoundingClientRect().bottom <= innerHeight'))
    await capture('12-mobile-hauteur-reduite-texte-200')
    await scaleText(1)
    await closePicker()
    assert.equal(await evaluate('document.body.style.overflow'), '')
    await click('Records', '.primary-nav')
    assert.equal(await evaluate('document.querySelectorAll(".exercise-card").length'), 4)
  })
  await viewport(1440)
  await capture('09-records-desktop')
  await viewport(375)
  await capture('09b-records-mobile')
  await viewport(1440)
  await click('Calculer', '.primary-nav')
  await check('Records et Calculer conservent exactement quatre mouvements et le calcul officiel / temporaire', async () => {
    assert.equal(await evaluate('document.querySelector("#calculator-exercise").options.length'), 4)
    assert.match(await evaluate('document.querySelector(".calculator-result-value").textContent'), /75 kg/)
    await click('Tester une autre charge de référence')
    await enter('#calculator-temporary-reference', '120')
    assert.match(await evaluate('document.querySelector(".calculator-result-value").textContent'), /90 kg/)
    assert.deepEqual(JSON.parse((await storage()).records), records)
    await click('Utiliser mon record enregistré')
  })
  await capture('10-calculer-desktop')
  await viewport(375)
  await capture('11-calculer-mobile')
  assert.deepEqual(browser.errors, [])
  await writeFile(resolve('.lot-e1-review.local/e1-results.json'), JSON.stringify({ passed, catalogue: exercises.length, families: exerciseFamilies.map(family => ({ ...family, count: exercises.filter(exercise => exercise.family === family.id).length })), checks }, null, 2))
  console.log(`${passed} contrôles E1 réussis, 0 échoué. Captures : ${artifacts}`)
} catch (error) {
  await capture('ECHEC').catch(() => {})
  console.error(`${passed} contrôles E1 réussis avant échec.`)
  throw error
} finally {
  browser.close()
}
