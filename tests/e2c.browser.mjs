// E2-C : données fictives, profils explicites, TEMP/TMP et CWD isolés.
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBrowser } from './helpers/browser.mjs'
import { exercisePickerActions } from './helpers/exercisePicker.mjs'

assert.equal(realpathSync(process.cwd()), realpathSync(tmpdir()), 'Isoler CWD, TEMP et TMP avant cette recette')
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5186'
const artifacts = await mkdtemp(join(tmpdir(), 'liftboard-e2c-parcours-'))
console.log(`Captures, rapports et profils E2-C : ${artifacts}`)
const browser = await startBrowser(baseUrl, artifacts)
const { call, click, enter, reload, settle, viewport, capture, command } = browser
const { addExercise } = exercisePickerActions(browser)
const checks = [], layouts = []
const restores = []
const check = async (name, action) => { await action(); checks.push(name); console.log(`OK : ${name}`) }
const raw = (target = browser) => target.call(() => ({ records: JSON.parse(localStorage.getItem('liftboard.personal-records.v1') ?? '[]'),
  workouts: JSON.parse(localStorage.getItem('liftboard.workouts.v1') ?? '[]') }))
const row = number => `.workout-set:nth-child(${number})`
const field = (number, suffix) => `${row(number)} [id$="-${suffix}"]`
const executionRow = number => `.workout-execution-set:nth-of-type(${number})`
const value = selector => call(selector => document.querySelector(selector)?.value, selector)
async function select(selector, value) {
  assert.equal(await call((selector, value) => {
    const control = document.querySelector(selector)
    if (!control?.getClientRects().length) return false
    control.value = value
    control.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, selector, value), true, selector)
  await settle()
}
async function seed(workouts = [], records = []) {
  await call((workouts, records) => {
    localStorage.clear(); sessionStorage.clear()
    localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts))
    localStorage.setItem('liftboard.personal-records.v1', JSON.stringify(records))
  }, workouts, records)
  await reload()
}
async function text(selector = 'body') { return call(selector => document.querySelector(selector).textContent, selector) }
async function waitFor(predicate, target = browser) {
  for (let count = 0; count < 100; count++) {
    if (await target.call(predicate)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Attente dépassée : ${predicate}`)
}
async function openTracking() {
  await click('Ouvrir', '.workout-session-list')
  await click('Démarrer le suivi')
}
async function finish() {
  await click('Terminer la séance')
  await click('Terminer la séance', 'dialog[open]')
  await waitFor(() => Boolean(document.querySelector('.workout-history .workout-detail')))
}
async function edit() {
  await click('Ouvrir', '.workout-session-list')
  await click('Modifier', '.workout-detail')
}
async function expand(number) {
  if (await call(selector => document.querySelector(selector).hidden, `${row(number)} .workout-set-editor`)) {
    await click(`Modifier la série ${number} de l’exercice 1`)
  }
}
async function scaleText(scale) {
  await call(scale => {
    if (scale === 1) {
      for (const entry of window.e2cScaled ?? []) if (entry.element.isConnected) {
        entry.element.style.fontSize = entry.fontSize; entry.element.style.lineHeight = entry.lineHeight
      }
      window.e2cScaled = []
      return
    }
    const entries = [...document.querySelectorAll('body,body *')].filter(element => element instanceof HTMLElement)
      .map(element => ({ element, fontSize: element.style.fontSize, lineHeight: element.style.lineHeight,
        font: parseFloat(getComputedStyle(element).fontSize), line: parseFloat(getComputedStyle(element).lineHeight) }))
    for (const entry of entries) {
      entry.element.style.fontSize = `${entry.font * scale}px`
      if (Number.isFinite(entry.line)) entry.element.style.lineHeight = `${entry.line * scale}px`
    }
    window.e2cScaled = entries
  }, scale)
  await settle()
}
async function responsive(name, focusSelector) {
  for (const width of [320, 375, 412, 768, 1024, 1440]) for (const scale of [1, 2]) {
    await viewport(width)
    await scaleText(scale)
    const measure = await call(() => {
      const controls = [...document.querySelectorAll('button,input,select,textarea')].filter(element => element.getClientRects().length)
      return {
        width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        small: controls.filter(element => element.getBoundingClientRect().width < 43 || element.getBoundingClientRect().height < 43).map(element => element.id || element.textContent),
        labels: controls.filter(element => element.matches('input,select,textarea') && !element.labels?.length && !element.getAttribute('aria-label')).map(element => element.id),
        nested: document.querySelectorAll('button button, button input, button select, button a, a button').length,
      }
    })
    assert.ok(measure.documentWidth <= width + 1, `${name}/${width}/${scale} : ${JSON.stringify(measure)}`)
    assert.deepEqual(measure.labels, [])
    assert.deepEqual(measure.small, [])
    assert.equal(measure.nested, 0)
    if (focusSelector) {
      await call(selector => { const element = document.querySelector(selector); element.focus(); element.scrollIntoView({ block: 'center' }) }, focusSelector)
      await settle()
      const focus = await call(() => {
        const rect = document.activeElement.getBoundingClientRect(), nav = document.querySelector('.primary-nav').getBoundingClientRect()
        const style = getComputedStyle(document.activeElement)
        return { top: rect.top, bottom: rect.bottom, limit: innerWidth < 960 ? nav.top : innerHeight,
          outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) }
      })
      assert.ok(focus.top >= 0 && focus.bottom <= focus.limit + 1, `Champ masqué : ${JSON.stringify(focus)}`)
      // Le focus clavier est contrôlé séparément ; focus() programmatique n'impose pas :focus-visible.
    } else {
      await call(() => document.querySelector('.workout-history .workout-set-summary:last-child')?.scrollIntoView({ block: 'start' }))
      await settle()
    }
    if ([320, 375, 1440].includes(width)) await capture(`${name}-${width}-texte-${scale * 100}`)
    layouts.push({ name, scale, ...measure })
    checks.push(`${name} ${width}px texte ${scale * 100}%`)
    await scaleText(1)
  }
  await viewport(1440)
}
async function peerWrite(expression) {
  const { targetId } = await command('Target.createTarget', { url: baseUrl })
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: false })
  await new Promise(resolve => setTimeout(resolve, 500))
  await command('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression } }) })
  await new Promise(resolve => setTimeout(resolve, 200))
  await command('Target.closeTarget', { targetId })
  await settle()
}
async function importFile(target, path) {
  await target.command('Page.setInterceptFileChooserDialog', { enabled: true })
  await target.click('Récupérer mes données', '.data-backup')
  const { root } = await target.command('DOM.getDocument')
  const { nodeId } = await target.command('DOM.querySelector', { nodeId: root.nodeId, selector: '.data-backup input[type=file]' })
  await target.command('DOM.setFileInputFiles', { nodeId, files: [path] })
  await waitFor(() => Boolean(document.querySelector('.data-backup dialog[open]') || document.querySelector('.data-backup > .record-error')), target)
}
let mixed, completedMixed
const programs = {}
try {
  await viewport(1440)
  // Pompes et Gainage ne figurent pas au catalogue actuel. Aucun ajout de mouvement :
  // Pull-up pour les répétitions et maintien Glute Bridge pour la durée, choisis explicitement.
  for (const [kind, exerciseId, planned, actual] of [['reps', 'pull-up', 15, 12], ['duration', 'glute-bridge', 60, 48]]) {
    const suffix = kind === 'reps' ? 'reps-only' : 'duration', key = kind === 'reps' ? 'reps' : 'durationSeconds'
    await check(`${kind} : création explicite, champs applicables et refus des valeurs invalides`, async () => {
      await seed()
      await click('+ Nouvelle séance')
      await enter('#workout-title', `E2-C ${kind}`)
      await addExercise(exerciseId)
      assert.equal(await value(field(1, 'kind')), 'load-reps')
      await select(field(1, 'kind'), kind)
      assert.equal(await value(field(1, suffix)), '')
      assert.deepEqual(await call(selector => [...document.querySelector(selector).querySelectorAll('input,select')].map(element => element.id.split('-').at(-1)), row(1)),
        kind === 'reps' ? ['kind', 'only'] : ['kind', 'duration'])
      for (const invalid of ['0', '-10', '1,5', 'NaN', 'Infinity', '9007199254740992', '']) {
        await enter(field(1, suffix), invalid)
        await click('Enregistrer la séance')
        assert.deepEqual((await raw()).workouts, [])
        assert.equal(await value(field(1, suffix)), invalid)
        assert.equal(await call(selector => {
          const input = document.querySelector(selector)
          return input.getAttribute('aria-invalid') === 'true' && Boolean(document.getElementById(input.getAttribute('aria-describedby')))
        }, field(1, suffix)), true)
      }
      await enter(field(1, suffix), String(planned))
      await capture(`01-editeur-${kind}`)
      await click('Enregistrer la séance')
      programs[kind] = (await raw()).workouts[0]
      const set = programs[kind].exercises[0].sets[0]
      assert.deepEqual(set, { schemaVersion: 2, id: set.id, kind, [key]: planned })
      await reload()
      assert.deepEqual((await raw()).workouts, [programs[kind]])
      await edit()
      assert.equal(await value(field(1, suffix)), String(planned))
      await click('Enregistrer les modifications')
      assert.deepEqual((await raw()).workouts, [programs[kind]])
    })
    await check(`${kind} : saisie partielle, effacement, rechargement, ajustement et confirmation`, async () => {
      await openTracking()
      await click('Ajuster la série 1')
      const selector = `${executionRow(1)} input[id$="-${key}"]`
      assert.equal(await call(scope => document.querySelector(scope).querySelectorAll('input').length, executionRow(1)), 1)
      await enter(selector, '2,')
      assert.equal((await raw()).workouts[0].exercises[0].sets[0].execution, undefined)
      await click('Série réalisée')
      assert.equal(await value(selector), '2,')
      assert.equal((await raw()).workouts[0].exercises[0].sets[0].execution, undefined)
      await enter(selector, String(actual))
      assert.deepEqual((await raw()).workouts[0].exercises[0].sets[0].execution, { completed: false, [key]: actual })
      assert.match(await text('.workout-execution-progress'), /0 \/ 1/)
      await enter(selector, '')
      assert.deepEqual((await raw()).workouts[0].exercises[0].sets[0].execution, { completed: false, [key]: null, cleared: { [key]: true } })
      await reload()
      assert.equal(await value(selector), '')
      await enter(selector, String(actual))
      await reload()
      assert.equal(await value(selector), String(actual))
      await click('Série réalisée')
      assert.deepEqual((await raw()).workouts[0].exercises[0].sets[0].execution, { completed: true, [key]: actual })
      assert.match(await text('.workout-execution-progress'), /1 \/ 1/)
      assert.doesNotMatch(await text(executionRow(1)), kind === 'reps' ? /kg|%|seconde/i : /kg|%|répétition/i)
      await capture(`02-suivi-${kind}`)
      await click('Modifier la série 1')
      await enter(selector, String(actual - 1))
      assert.equal((await raw()).workouts[0].exercises[0].sets[0].execution[key], actual)
      await click('Enregistrer la correction')
      assert.equal((await raw()).workouts[0].exercises[0].sets[0].execution[key], actual - 1)
      await click('Modifier la série 1')
      await click('Annuler l’état réalisé')
      assert.match(await text('.workout-execution-progress'), /0 \/ 1/)
      await enter(selector, String(actual))
      await click('Série réalisée')
    })
    await check(`${kind} : clôture, Historique ${planned}/${actual}, rechargement et réouverture`, async () => {
      await finish()
      const summary = await text('.workout-set-summary')
      assert.match(summary, new RegExp(`${planned} ${kind === 'reps' ? 'répétitions' : 'secondes'}`))
      assert.match(summary, new RegExp(`${actual} ${kind === 'reps' ? 'répétitions' : 'secondes'}`))
      assert.doesNotMatch(summary, kind === 'reps' ? /kg|%|seconde/i : /kg|%|répétition/i)
      await capture(`03-historique-${kind}`)
      await reload()
      assert.equal((await raw()).workouts[0].status, 'completed')
      // La navigation existante mémorise la section, pas le détail Historique.
      await click('Consulter', '.history-journal')
      assert.equal(await text('.workout-set-summary'), summary)
      await click('Réouvrir la séance')
      await click('Annuler', 'dialog[open]')
      assert.equal(await call(() => document.activeElement.textContent.trim()), 'Réouvrir la séance')
      await click('Réouvrir la séance')
      await click('Réouvrir la séance', 'dialog[open]')
      assert.equal((await raw()).workouts[0].status, 'planned')
      assert.equal(await call(() => document.querySelector('.workout-detail button[aria-describedby="workout-program-protection"]').disabled), true)
      await click('Reprendre le suivi')
      assert.match(await text('.workout-execution-progress'), /1 \/ 1/)
    })
  }
  await check('Brouillons : trois branches, pourcentage 110 % Clean, arrondi et saisies incomplètes retrouvés', async () => {
    await seed([], [{ exerciseId: 'clean', oneRepMaxKg: 100 }])
    await click('+ Nouvelle séance')
    await enter('#workout-title', 'E2-C trois types')
    await addExercise('clean-pull')
    await enter(field(1, 'reps'), '3')
    await select(field(1, 'method'), 'percentage')
    await select(field(1, 'reference'), 'clean')
    await enter(field(1, 'intensity'), '110')
    await select(field(1, 'rounding'), 'up-2.5')
    await select(field(1, 'kind'), 'reps')
    assert.equal(await value(field(1, 'reps-only')), '')
    await enter(field(1, 'reps-only'), '15')
    await select(field(1, 'kind'), 'duration')
    assert.equal(await value(field(1, 'duration')), '')
    await enter(field(1, 'duration'), '60')
    await select(field(1, 'kind'), 'load-reps')
    assert.equal(await value(field(1, 'reps')), '3')
    assert.equal(await value(field(1, 'intensity')), '110')
    assert.equal(await value(field(1, 'reference')), 'clean')
    assert.equal(await value(field(1, 'rounding')), 'up-2.5')
    assert.match(await text(`${row(1)} .workout-load`), /110 kg/)
    await enter(field(1, 'reps'), '2,')
    await select(field(1, 'kind'), 'reps')
    assert.equal(await value(field(1, 'reps-only')), '15')
    await enter(field(1, 'reps-only'), '2,')
    await select(field(1, 'kind'), 'duration')
    assert.equal(await value(field(1, 'duration')), '60')
    await enter(field(1, 'duration'), '')
    await select(field(1, 'kind'), 'load-reps')
    assert.equal(await value(field(1, 'reps')), '2,')
    await enter(field(1, 'reps'), '3')
    await select(field(1, 'kind'), 'reps')
    assert.equal(await value(field(1, 'reps-only')), '2,')
    await enter(field(1, 'reps-only'), '15')
    await select(field(1, 'kind'), 'duration')
    assert.equal(await value(field(1, 'duration')), '')
    await enter(field(1, 'duration'), '60')
    await select(field(1, 'kind'), 'load-reps')
    await click('Annuler')
    await click('Annuler', 'dialog[open]')
    assert.equal(await value(field(1, 'reference')), 'clean')
    await select(field(1, 'kind'), 'reps')
    assert.equal(await value(field(1, 'reps-only')), '15')
    await select(field(1, 'kind'), 'duration')
    assert.equal(await value(field(1, 'duration')), '60')
    await select(field(1, 'kind'), 'load-reps')
  })
  await check('Un bloc mixte : ajout historique par défaut, duplication ciblée et IDs distincts', async () => {
    await click('+ Ajouter une série')
    assert.equal(await value(field(2, 'kind')), 'load-reps')
    await select(field(2, 'kind'), 'reps')
    await enter(field(2, 'reps-only'), '15')
    await click('Dupliquer la série 2 de l’exercice 1')
    assert.equal(await value(field(3, 'kind')), 'reps')
    assert.equal(await value(field(3, 'reps-only')), '15')
    await select(field(3, 'kind'), 'duration')
    assert.equal(await value(field(3, 'duration')), '')
    await enter(field(3, 'duration'), '60')
    // Révéler simultanément les trois séries pour une capture vérifiable.
    await expand(1)
    await enter(field(1, 'reps'), '2,')
    await expand(2)
    await enter(field(2, 'reps-only'), '2,')
    await expand(3)
    await capture('04-editeur-trois-types-brouillons')
    await enter(field(1, 'reps'), '3')
    await expand(2)
    await enter(field(2, 'reps-only'), '15')
    await expand(3)
    await responsive('05-editeur-mixte', field(3, 'duration'))
    await click('Enregistrer la séance')
    mixed = (await raw()).workouts[0]
    const sets = mixed.exercises[0].sets
    assert.deepEqual(sets.map(set => set.kind), ['load-reps', 'reps', 'duration'])
    assert.equal(new Set(sets.map(set => set.id)).size, 3)
    assert.deepEqual(sets[1], { schemaVersion: 2, id: sets[1].id, kind: 'reps', reps: 15 })
    assert.deepEqual(sets[2], { schemaVersion: 2, id: sets[2].id, kind: 'duration', durationSeconds: 60 })
    await reload()
    assert.deepEqual((await raw()).workouts, [mixed])
  })
  await check('Suivi mixte : trois confirmations, compteur 3/3 et prévu distinct du réalisé', async () => {
    await openTracking()
    await click('Confirmer tel que prévu : série 1')
    await click('Confirmer tel que prévu : série 2')
    await click('Confirmer tel que prévu : série 3')
    assert.match(await text('.workout-execution-progress'), /3 \/ 3/)
    assert.deepEqual((await raw()).workouts[0].exercises[0].sets.map(set => set.execution), [
      { completed: true, reps: 3, loadKg: 110 }, { completed: true, reps: 15 }, { completed: true, durationSeconds: 60 },
    ])
    await click('Modifier la série 2')
    await enter(`${executionRow(2)} input[id$="-reps"]`, '12')
    await click('Enregistrer la correction', executionRow(2))
    await click('Modifier la série 3')
    await enter(`${executionRow(3)} input[id$="-durationSeconds"]`, '48')
    await click('Enregistrer la correction', executionRow(3))
    await capture('06-suivi-mixte')
    await click('Modifier la série 3')
    await responsive('07-suivi-duree', `${executionRow(3)} input`)
    await click('Fermer l’édition', executionRow(3))
    await reload()
    assert.match(await text('.workout-execution-progress'), /3 \/ 3/)
    await finish()
    completedMixed = (await raw()).workouts[0]
    assert.deepEqual(completedMixed.exercises[0].sets.map(({ execution, ...set }) => set), mixed.exercises[0].sets)
    assert.match(await text('.workout-set-summary:nth-child(2)'), /15 répétitions.*12 répétitions/s)
    assert.match(await text('.workout-set-summary:nth-child(3)'), /60 secondes.*48 secondes/s)
    await capture('08-historique-mixte')
    await responsive('09-historique-mixte')
  })
  await check('Duplication mixte après suivi : nouveaux IDs, programmation seule et aucune exécution', async () => {
    await click('Réouvrir la séance')
    await click('Réouvrir la séance', 'dialog[open]')
    await click('← Retour aux séances')
    await click('Dupliquer', '.workout-session-list')
    await click('Enregistrer la séance')
    const [original, copy] = (await raw()).workouts
    assert.notEqual(copy.id, original.id)
    assert.notEqual(copy.exercises[0].id, original.exercises[0].id)
    copy.exercises[0].sets.forEach((set, index) => {
      assert.notEqual(set.id, original.exercises[0].sets[index].id)
      assert.equal(set.execution, undefined)
      const { execution, ...expected } = original.exercises[0].sets[index]
      assert.deepEqual({ ...set, id: expected.id }, expected)
    })
  })
  let backup, backupPath
  await check('Export JSON V2 téléchargé et restauration exacte dans un autre profil isolé', async () => {
    const downloads = join(artifacts, 'downloads')
    await mkdir(downloads)
    await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
    await click('Télécharger ma sauvegarde', '.data-backup')
    let files = []
    for (let attempt = 0; attempt < 100; attempt++) {
      files = (await readdir(downloads)).filter(name => name.endsWith('.json'))
      if (files.length) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(files.length, 1)
    backupPath = join(downloads, files[0])
    backup = JSON.parse(await readFile(backupPath, 'utf8'))
    assert.equal(backup.version, 2)
    assert.deepEqual(backup.data, await raw())
    const restoreDir = join(artifacts, 'restoration')
    await mkdir(restoreDir)
    const target = await startBrowser(baseUrl, restoreDir)
    restores.push(target)
    await importFile(target, backupPath)
    assert.deepEqual((await raw(target)).workouts, [])
    await target.click('Annuler', '.data-backup dialog[open]')
    assert.deepEqual((await raw(target)).workouts, [])
    await importFile(target, backupPath)
    await target.click('Restaurer mes données', '.data-backup dialog[open]')
    await target.reload()
    assert.deepEqual(await raw(target), backup.data)
    assert.deepEqual(target.errors, [])
  })
  await check('Imports invalides : hybrides, version future, durée/répétitions et exécutions refusés intégralement', async () => {
    const target = restores[0], before = await raw(target)
    const invalidSets = [
      { schemaVersion: 2, id: 'bad', kind: 'duration', durationSeconds: 0 },
      { schemaVersion: 2, id: 'bad', kind: 'duration', durationSeconds: 1.5 },
      { schemaVersion: 2, id: 'bad', kind: 'reps', reps: 0 },
      { schemaVersion: 2, id: 'bad', kind: 'reps', reps: 15, loading: null },
      { schemaVersion: 2, id: 'bad', kind: 'duration', durationSeconds: 60, execution: { completed: true, reps: 12 } },
    ]
    for (let index = 0; index < invalidSets.length + 2; index++) {
      const bad = structuredClone(backup)
      if (index === invalidSets.length) bad.version = 3
      else if (index === invalidSets.length + 1) bad.version = 1
      else bad.data.workouts[1].exercises[0].sets[0] = invalidSets[index]
      const path = join(artifacts, `invalid-${index}.json`)
      await writeFile(path, JSON.stringify(bad))
      await importFile(target, path)
      assert.equal(await target.call(() => Boolean(document.querySelector('.data-backup dialog[open]'))), false)
      assert.deepEqual(await raw(target), before)
    }
  })
  for (const [kind, key] of [['reps', 'reps'], ['duration', 'durationSeconds']]) {
    await check(`${kind} : conflit réel entre onglets sur la réalisation, saisie locale conservée`, async () => {
      await seed([programs[kind]])
      await openTracking()
      await click('Ajuster la série 1')
      const selector = `${executionRow(1)} input[id$="-${key}"]`
      await enter(selector, '12')
      await click('Série réalisée')
      await click('Modifier la série 1')
      await enter(selector, '11')
      await peerWrite(`(() => { const data = JSON.parse(localStorage.getItem('liftboard.workouts.v1')); data[0].exercises[0].sets[0].execution.${key} = 13; localStorage.setItem('liftboard.workouts.v1', JSON.stringify(data)); })()`)
      await click('Enregistrer la correction')
      assert.match(await text('.workout-notes-error'), /changé ailleurs/)
      assert.equal(await value(selector), '11')
      assert.equal((await raw()).workouts[0].exercises[0].sets[0].execution[key], 13)
    })
    for (const mode of ['throw', 'ignore', 'different', 'read-fails']) await check(`${kind} : erreur de stockage ${mode}, aucun faux succès`, async () => {
      await seed([programs[kind]])
      await openTracking()
      await click('Ajuster la série 1')
      await call(mode => {
        window.e2cGet = Storage.prototype.getItem; window.e2cSet = Storage.prototype.setItem; window.e2cWrote = false
        Storage.prototype.getItem = function (key) {
          if (key === 'liftboard.workouts.v1' && window.e2cWrote && mode === 'read-fails') throw new Error('Lecture fictive refusée')
          return window.e2cGet.call(this, key)
        }
        Storage.prototype.setItem = function (key, value) {
          if (key !== 'liftboard.workouts.v1') return window.e2cSet.call(this, key, value)
          window.e2cWrote = true
          if (mode === 'throw') throw new DOMException('Quota fictif', 'QuotaExceededError')
          if (mode !== 'ignore') window.e2cSet.call(this, key, mode === 'different' ? '[]' : value)
        }
      }, mode)
      const selector = `${executionRow(1)} input[id$="-${key}"]`
      await enter(selector, '11')
      assert.match(await text('.workout-notes-error'), /Non enregistré/)
      assert.equal(await value(selector), '11')
      assert.match(await text('.workout-execution-progress'), /0 \/ 1/)
      await call(() => { Storage.prototype.getItem = window.e2cGet; Storage.prototype.setItem = window.e2cSet })
      const persisted = (await raw()).workouts
      if (mode === 'throw' || mode === 'ignore') assert.deepEqual(persisted, [programs[kind]])
      else if (mode === 'different') assert.deepEqual(persisted, [])
      else assert.equal(persisted[0].exercises[0].sets[0].execution[key], 11)
      await capture(`10-stockage-${kind}-${mode}`)
    })
  }
  await check('Clavier : choix de type, focus visible et retour de dialogue sans effacer les brouillons', async () => {
    await seed()
    await click('+ Nouvelle séance')
    await enter('#workout-title', 'Clavier E2-C')
    await addExercise('pull-up')
    await call(selector => document.querySelector(selector).focus(), field(1, 'kind'))
    await browser.key('ArrowDown', 40)
    // Chrome peut ouvrir le sélecteur natif ; Échap referme sans dépendre du système.
    await browser.key('Escape', 27)
    await select(field(1, 'kind'), 'reps')
    await enter(field(1, 'reps-only'), '15')
    await call(selector => document.querySelector(selector).focus(), field(1, 'kind'))
    await browser.key('Tab', 9)
    assert.equal(await call(() => document.activeElement.id.endsWith('-reps-only')), true)
    assert.equal(await call(() => getComputedStyle(document.activeElement).outlineStyle), 'solid')
    await click('+ Ajouter un exercice')
    await browser.key('Escape', 27)
    assert.equal(await call(() => document.activeElement.textContent.trim()), '+ Ajouter un exercice')
    assert.equal(await value(field(1, 'reps-only')), '15')
  })
  assert.deepEqual(browser.errors, [])
  for (const target of restores) assert.deepEqual(target.errors, [])
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ passed: checks.length, failed: 0, checks, layouts,
    catalogueSubstitutions: { reps: 'Pull-up (Pompes absent)', duration: 'Glute Bridge (Gainage absent)' } }, null, 2))
  console.log(`${checks.length} contrôles E2-C réussis, 0 échoué. Captures et rapport : ${artifacts}`)
} catch (error) {
  await capture('ECHEC').catch(() => {})
  await writeFile(join(artifacts, 'failure.json'), JSON.stringify({ passed: checks.length, checks, error: String(error), layouts }, null, 2))
  console.error(`${checks.length} contrôles E2-C réussis avant échec.`)
  throw error
} finally {
  for (const target of restores) target.close()
  browser.close()
}
