import { exercisePickerActions } from './helpers/exercisePicker.mjs'
// Lots B et C : interactions de présentation, audit responsive et captures réelles.
// node tests/sessions.browser.mjs http://127.0.0.1:5176
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5176'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname))
const artifactDirectory = await mkdtemp(join(tmpdir(), 'liftboard-sessions-'))
console.log(`Captures et profil isolé : ${artifactDirectory}`)
const browser = spawn(process.env.LIFTBOARD_TEST_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${join(artifactDirectory, 'profile')}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
let socket
let nextId = 0
let passed = 0
const pending = new Map()
const browserErrors = []
const observations = []
const screenshots = []
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Délai : ${method}`)) }, 12000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const call = (fn, ...args) => evaluate(`(${fn.toString()})(${args.map(value => JSON.stringify(value)).join(',')})`)
const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
const { addExercise, changeExercise } = exercisePickerActions({ call, click, settle })
async function check(label, action) {
  try { await action() } catch (error) {
    console.error(`${passed} contrôles réussis ; échec : ${label}`)
    await capture('failure').catch(() => {})
    throw error
  }
  passed++
  console.log(`✓ ${label}`)
}
async function click(label, scope = '.workout-sessions-forge') {
  assert.ok(await call((label, scope) => {
    const root = document.querySelector(scope)
    const control = [...root.querySelectorAll('button,summary')].find(item => item.getClientRects().length && item.textContent.trim() === label)
    if (!control || control.disabled) return false
    control.focus({ preventScroll: true })
    control.click()
    return true
  }, label, scope), `Contrôle visible et actif : ${label}`)
  await settle()
}
async function enter(selector, value) {
  await call((selector, value) => {
    const field = document.querySelector(selector)
    if (!field?.getClientRects().length) throw new Error(`Champ masqué : ${selector}`)
    const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }, selector, value)
  await settle()
}
async function select(selector, value) {
  await call((selector, value) => {
    const field = document.querySelector(selector)
    if (!field?.getClientRects().length) throw new Error(`Sélecteur masqué : ${selector}`)
    field.value = value
    field.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector, value)
  await settle()
}
async function viewport(width, height = 960) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 960 })
  await settle()
}
async function capture(name, fullPage = false) {
  await evaluate('document.fonts.ready.then(() => true)')
  const image = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage })
  await writeFile(join(artifactDirectory, `${name}.png`), Buffer.from(image.data, 'base64'))
}
async function captureScreen(name) {
  for (const width of [1440, 375]) {
    await viewport(width)
    await call(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }) })
    const height = await evaluate('Math.max(960, document.documentElement.scrollHeight)')
    // Repositionner aussi la navigation fixe au pied de la capture complète.
    await viewport(width, height)
    const file = `${name}-${width}`
    await capture(file)
    screenshots.push({ name, width, file: `${file}.png` })
  }
  await viewport(375)
}
async function scaleText(scale) {
  await call(scale => {
    if (scale === 1) {
      for (const [element, style] of window.lotBOriginalStyles ?? []) {
        if (style === null) element.removeAttribute('style')
        else element.setAttribute('style', style)
      }
      window.lotBOriginalStyles = []
      return
    }
    const elements = [...document.querySelectorAll('.workout-sessions-forge, .workout-sessions-forge *, .primary-nav, .primary-nav *')]
    const values = elements.map(element => ({ element, style: element.getAttribute('style'), size: parseFloat(getComputedStyle(element).fontSize), line: parseFloat(getComputedStyle(element).lineHeight) }))
    window.lotBOriginalStyles = values.map(({ element, style }) => [element, style])
    for (const { element, size, line } of values) {
      element.style.setProperty('font-size', `${size * scale}px`, 'important')
      if (Number.isFinite(line)) element.style.setProperty('line-height', `${line * scale}px`, 'important')
    }
  }, scale)
  await settle()
}
async function inspect() {
  return call(() => {
    const root = document.querySelector('.workout-sessions-forge')
    const visible = [...root.querySelectorAll('*')].filter(item => item.getClientRects().length && getComputedStyle(item).visibility !== 'hidden')
    const controls = visible.filter(item => item.matches('button,input,select,textarea,summary'))
    const small = controls.map(item => ({ label: item.textContent.trim() || item.id, width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height })).filter(item => item.width < 43.5 || item.height < 43.5)
    const clipped = visible.filter(item => item.matches('h1,h2,h3,p,label,button,summary') && item.clientWidth && item.scrollWidth > item.clientWidth + 2).map(item => item.textContent.trim())
    const missingLabels = controls.filter(item => item.matches('input,select,textarea') && !item.labels?.length && !item.getAttribute('aria-label')).map(item => item.id)
    const brokenWords = []
    for (const item of controls.filter(item => item.matches('button,summary'))) {
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const word of node.textContent.matchAll(/\S+/g)) {
          const range = document.createRange()
          range.setStart(node, word.index)
          range.setEnd(node, word.index + word[0].length)
          if (new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top))).size > 1) brokenWords.push(word[0])
        }
      }
    }
    const nav = document.querySelector('.primary-nav'), navBox = nav.getBoundingClientRect()
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, small, clipped, brokenWords, missingLabels,
      navFixed: getComputedStyle(nav).position === 'fixed', navBottom: navBox.bottom,
      navLabels: [...nav.querySelectorAll('button')].map(button => button.textContent.trim()),
    }
  })
}
async function sweep(name) {
  for (const width of [320, 375, 412, 768, 1024, 1440]) {
    await viewport(width)
    for (const scale of [1, 2]) {
      await scaleText(scale)
      await check(`${name} · ${width} px · texte ${scale * 100} %`, async () => {
        const layout = await inspect()
        observations.push({ name, scale, ...layout })
        assert.ok(layout.scrollWidth <= width, 'Aucun défilement horizontal')
        assert.deepEqual(layout.small, [], 'Cibles tactiles de 44 px')
        assert.deepEqual(layout.clipped, [], 'Aucun texte tronqué')
        assert.deepEqual(layout.brokenWords, [], 'Mots des commandes conservés entiers')
        assert.deepEqual(layout.missingLabels, [], 'Labels associés')
        assert.deepEqual(layout.navLabels, ['Séances', 'Records', 'Calculer', 'Historique'])
        assert.equal(layout.navFixed, width < 960)
        if (width < 960) assert.equal(layout.navBottom, 960)
      })
      if (width === 320 && scale === 2) await capture(`${name}-320-text-200`, true)
      await scaleText(1)
    }
  }
  await viewport(375)
}
const records = [
  { exerciseId: 'snatch', oneRepMaxKg: 100 }, { exerciseId: 'clean-and-jerk', oneRepMaxKg: 120 },
  { exerciseId: 'front-squat', oneRepMaxKg: 140 }, { exerciseId: 'back-squat', oneRepMaxKg: 165 },
]
const fixture = {
  id: 'lot-b-demo', title: 'Technique olympique', date: '2026-11-18', status: 'planned',
  notes: { before: 'Mobilité et positions de départ.', during: '', after: '' },
  exercises: [{ id: 'lot-b-snatch', exerciseId: 'snatch', sets: [
    { id: 'lot-b-s1', reps: 2, intensityPct: 75, rounding: { mode: 'exact' }, load: { exactKg: 75, selectedKg: 75 } },
    { id: 'lot-b-s2', reps: 3, intensityPct: 80, rounding: { mode: 'exact' }, load: { exactKg: 80, selectedKg: 80 } },
  ] }, { id: 'lot-b-clean', exerciseId: 'clean-and-jerk', sets: [
    { id: 'lot-b-s3', reps: 2, intensityPct: 75, rounding: { mode: 'exact' }, load: { exactKg: 90, selectedKg: 90 } },
  ] }],
}
const storedWorkouts = () => evaluate('JSON.parse(localStorage.getItem("liftboard.workouts.v1"))')
let firstSetId
let firstExecution
try {
  const address = await new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`Chrome : ${output.slice(-1000)}`)), 12000)
    browser.once('error', error => { clearTimeout(timeout); reject(error) })
    browser.stderr.on('data', chunk => {
      output += chunk.toString()
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
  })
  const origin = new URL(address).origin.replace('ws:', 'http:')
  const target = await (await fetch(`${origin}/json/new?${encodeURIComponent(baseUrl)}`, { method: 'PUT' })).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timeout)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  await command('Page.enable')
  await command('Runtime.enable')
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate('Boolean(document.querySelector("#workout-page-title"))')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await call((records, fixture) => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('liftboard.personal-records.v1', JSON.stringify(records))
    localStorage.setItem('liftboard.workouts.v1', JSON.stringify([fixture,
      { ...fixture, id: 'lot-b-force', title: 'Force — squats', date: '2026-11-16' },
      { ...fixture, id: 'lot-b-stabilite', title: 'Snatch & stabilité', date: '2026-11-14' },
    ]))
  }, records, fixture)
  await command('Page.reload')
  await new Promise(resolve => setTimeout(resolve, 250))
  await settle()
  await viewport(375)
  const initialStorage = await storedWorkouts()
  await check('Liste : brouillon temporaire, reprise et aucune écriture implicite', async () => {
    await click('+ Nouvelle séance')
    await enter('#workout-title', 'Préparation technique')
    await click('← Retour aux séances')
    assert.match(await evaluate('document.querySelector(".workout-resume").textContent'), /en mémoire uniquement/)
    assert.equal(await evaluate('document.querySelectorAll(".workout-session-list > li").length'), 3)
    assert.deepEqual(await storedWorkouts(), initialStorage)
  })
  await captureScreen('01-seances')
  await sweep('01-seances')
  await check('Éditeur : champs et calculs issus des Records', async () => {
    await click('Reprendre le brouillon')
    await enter('#workout-date', '2026-11-18')
    await addExercise('snatch')
    firstSetId = await evaluate('document.querySelector(".workout-set input").id.replace(/-reps$/, "")')
    await enter(`#${firstSetId}-reps`, '2')
    await enter(`#${firstSetId}-intensity`, '75')
    await click('+ Ajouter une série')
    assert.equal(await evaluate('document.querySelectorAll(".workout-set input[id$=reps]")[1].value'), '')
    assert.equal(await evaluate('document.querySelectorAll(".workout-set input[id$=intensity]")[1].value'), '')
    assert.equal(await evaluate('document.querySelectorAll(".workout-set select")[1].value'), 'exact')
    assert.equal(await evaluate('document.querySelectorAll(".workout-load strong")[1].textContent'), '—')
    assert.equal(await evaluate('document.activeElement.matches("input,select,textarea")'), false)
    await captureScreen('lot-c-01-serie-vierge')
    await enter('.workout-set:nth-child(2) input[id$=reps]', '2')
    const secondSetId = await evaluate('document.querySelectorAll(".workout-set input[id$=intensity]")[1].id')
    await enter(`#${secondSetId}`, '80')
    await addExercise('snatch')
    await changeExercise('clean-and-jerk', '.workout-exercise:last-child')
    await enter('.workout-exercise:last-child input[id$=reps]', '2')
    await enter('.workout-exercise:last-child input[id$=intensity]', '75')
    assert.equal(await evaluate('document.querySelectorAll(".workout-record-context input").length'), 0)
    await click('Replier', '.workout-exercise:last-child .workout-set')
    await click('Modifier', `#${firstSetId}-title + .workout-set-layout`)
    await click('Notes de séance (facultatif)')
    await enter('textarea', 'Mobilité et trajectoire, puis montée progressive.')
  })
  await captureScreen('02-nouvelle-seance')
  await sweep('02-nouvelle-seance')
  await check('Repli : même champ DOM, valeurs et arrondi conservés sans sauvegarde', async () => {
    await select(`#${firstSetId}-rounding`, 'down-2.5')
    await call(id => { window.lotBField = document.querySelector(`#${id}-intensity`) }, firstSetId)
    await click('Replier', `#${firstSetId}-title + .workout-set-layout`)
    assert.equal(await call(id => document.querySelector(`#${id}-editor`).hidden, firstSetId), true)
    await click('Modifier', `#${firstSetId}-title + .workout-set-layout`)
    assert.equal(await call(id => document.querySelector(`#${id}-intensity`) === window.lotBField, firstSetId), true)
    assert.equal(await call(id => document.querySelector(`#${id}-intensity`).value, firstSetId), '75')
    assert.equal(await call(id => document.querySelector(`#${id}-rounding`).value, firstSetId), 'down-2.5')
    assert.deepEqual(await storedWorkouts(), initialStorage)
  })
  await check('Lot C : dupliquer une série compacte insère une copie indépendante juste après', async () => {
    const ids = await evaluate('[...document.querySelectorAll(".workout-exercise:first-of-type .workout-set legend")].map(item => item.id)')
    await click('Replier', '.workout-exercise:first-of-type .workout-set:first-child')
    await click('Dupliquer la série', '.workout-exercise:first-of-type .workout-set:first-child')
    const sets = await evaluate('[...document.querySelectorAll(".workout-exercise:first-of-type .workout-set")].map(item => ({ id: item.querySelector("legend").id, reps: item.querySelector("input[id$=reps]").value, intensity: item.querySelector("input[id$=intensity]").value, rounding: item.querySelector("select").value }))')
    assert.equal(sets.length, 3)
    assert.equal(sets[0].id, ids[0])
    assert.equal(sets[2].id, ids[1])
    assert.ok(!ids.includes(sets[1].id))
    assert.deepEqual([sets[1].reps, sets[1].intensity, sets[1].rounding], ['2', '75', 'down-2.5'])
    await captureScreen('lot-c-02-serie-dupliquee')
    await enter('.workout-exercise:first-of-type .workout-set:nth-child(2) input[id$=intensity]', '74,4')
    assert.equal(await call(id => document.querySelector(`#${id}-intensity`).value, firstSetId), '75')
    await click('Retirer la série', '.workout-exercise:first-of-type .workout-set:nth-child(2)')
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".workout-exercise:first-of-type .workout-set legend")].map(item => item.id)'), ids)
    await click('Modifier', '.workout-exercise:first-of-type .workout-set:first-child')
    assert.deepEqual(await storedWorkouts(), initialStorage)
  })
  await check('Lot C : copie incomplète, saisie brute préservée et sauvegarde bloquée', async () => {
    await enter(`#${firstSetId}-intensity`, '75,')
    await click('Dupliquer la série', '.workout-exercise:first-of-type .workout-set:first-child')
    assert.equal(await evaluate('document.querySelector(".workout-exercise:first-of-type .workout-set:nth-child(2) input[id$=intensity]").value'), '75,')
    assert.equal(await evaluate('document.querySelector(".workout-exercise:first-of-type .workout-set:nth-child(2) .workout-load strong").textContent'), '—')
    await click('Enregistrer la séance')
    assert.deepEqual(await storedWorkouts(), initialStorage)
    assert.equal(await evaluate('document.querySelector(".workout-exercise:first-of-type .workout-set:nth-child(2) input[id$=intensity]").getAttribute("aria-invalid")'), 'true')
    await click('Retirer la série', '.workout-exercise:first-of-type .workout-set:nth-child(2)')
    await enter(`#${firstSetId}-intensity`, '75')
    await click('Modifier', '.workout-exercise:first-of-type .workout-set:first-child')
  })
  await check('Validation : une erreur reste ouverte et reçoit le focus', async () => {
    await enter(`#${firstSetId}-intensity`, '75,')
    await click('Modifier', '.workout-exercise:first-of-type .workout-set:nth-child(2)')
    assert.equal(await call(id => document.querySelector(`#${id}-editor`).hidden, firstSetId), false)
    await click('Enregistrer la séance')
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-invalid")'), 'true')
    assert.equal(await call(id => document.querySelector(`#${id}-intensity`).value, firstSetId), '75,')
    await enter(`#${firstSetId}-intensity`, '75')
  })
  await check('Lot C : ordre des sept arrondis et résultats inchangés pour 74,4 kg', async () => {
    await click('Modifier', '.workout-exercise:first-of-type .workout-set:first-child')
    assert.deepEqual(await call(id => [...document.querySelector(`#${id}-rounding`).options].map(item => item.value), firstSetId),
      ['exact', 'up-1', 'up-2.5', 'up-5', 'down-1', 'down-2.5', 'down-5'])
    await enter(`#${firstSetId}-intensity`, '74,4')
    for (const [rounding, load] of [['exact', '74,4 kg'], ['up-1', '75 kg'], ['up-2.5', '75 kg'], ['up-5', '75 kg'], ['down-1', '74 kg'], ['down-2.5', '72,5 kg'], ['down-5', '70 kg']]) {
      await select(`#${firstSetId}-rounding`, rounding)
      assert.equal(await call(id => document.querySelector(`#${id}-title`).parentElement.querySelector('.workout-load strong').textContent, firstSetId), load)
    }
    await enter(`#${firstSetId}-intensity`, '75')
    await select(`#${firstSetId}-rounding`, 'down-2.5')
    assert.deepEqual(await storedWorkouts(), initialStorage)
  })
  await check('Ajout : série visible, identifiants stables et aucun focus sur un champ', async () => {
    const ids = await evaluate('[...document.querySelectorAll(".workout-set legend")].map(item => item.id)')
    await click('+ Ajouter une série', '.workout-exercise:first-of-type')
    assert.equal(await evaluate('document.activeElement.matches("input,textarea,select")'), false)
    assert.equal(await evaluate('document.querySelector(".workout-exercise:first-of-type .workout-set:last-child .workout-set-editor").hidden'), false)
    assert.equal(await evaluate('document.querySelector(".workout-exercise:first-of-type .workout-set:last-child legend").getBoundingClientRect().top >= 0'), true)
    await click('Retirer la série', '.workout-exercise:first-of-type .workout-set:last-child')
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".workout-set legend")].map(item => item.id)'), ids)
  })
  await check('Enregistrement : nouvelle séance planifiée, trois charges figées', async () => {
    await click('Enregistrer la séance')
    const saved = (await storedWorkouts()).find(item => item.title === 'Préparation technique')
    assert.equal(saved.status, 'planned')
    assert.deepEqual(saved.exercises.flatMap(block => block.sets.map(set => set.load.selectedKg)), [75, 80, 90])
    await click('Ouvrir', `article[aria-labelledby="card-${saved.id}"]`)
  })
  await captureScreen('03-detail')
  await sweep('03-detail')
  await check('Suivi : mode prévu distinct du formulaire d’ajustement', async () => {
    await click('Démarrer le suivi')
    firstExecution = await evaluate('document.querySelector(".workout-execution-set").id')
    assert.equal(await evaluate('document.querySelectorAll(".workout-execution-set-ready").length'), 1)
    assert.equal(await call(id => [...document.querySelector(`#${id}`).querySelectorAll('input')].filter(input => input.getClientRects().length).length, firstExecution), 0)
    assert.equal(await call(id => document.querySelector(`#${id} .workout-execution-confirm-planned`).getClientRects().length > 0, firstExecution), true)
  })
  await captureScreen('04-suivi-prevu')
  await sweep('04-suivi-prevu')
  await check('Ajuster : confirmation directe masquée, valeurs prévues disponibles', async () => {
    await click('Ajuster', `#${firstExecution}`)
    assert.equal(await call(id => document.querySelector(`#${id} .workout-execution-editor`).hidden, firstExecution), false)
    assert.equal(await call(id => document.querySelector(`#${id} .workout-execution-confirm-planned`)?.getClientRects().length ?? 0, firstExecution), 0)
    assert.equal(await call(id => document.querySelector(`#${id} input[id$=loadKg]`).placeholder, firstExecution), '75')
  })
  await captureScreen('05-suivi-ajustement')
  await sweep('05-suivi-ajustement')
  await check('Réalisation : résultat réel compact et prévu conservé', async () => {
    await enter(`#${firstExecution} input[id$=loadKg]`, '72,5')
    await enter(`#${firstExecution} input[id$=reps]`, '3')
    await click('Série réalisée', `#${firstExecution}`)
    assert.match(await call(id => document.querySelector(`#${id} .workout-execution-result`).textContent, firstExecution), /72,5 kg.*× 3 répétitions/)
    assert.match(await call(id => document.querySelector(`#${id} .workout-execution-compact-planned`).textContent, firstExecution), /75 kg.*× 2 répétitions/)
    const set = (await storedWorkouts()).find(item => item.title === 'Préparation technique').exercises[0].sets[0]
    assert.deepEqual(set.execution, { completed: true, reps: 3, loadKg: 72.5 })
    assert.equal(set.load.selectedKg, 75)
  })
  await captureScreen('06-suivi-realise')
  await sweep('06-suivi-realise')
  await check('Correction : échec explicite, saisie conservée et réessai', async () => {
    await click('Modifier', `#${firstExecution}`)
    await enter(`#${firstExecution} input[id$=loadKg]`, '77,5')
    await call(() => { window.lotBSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'liftboard.workouts.v1') throw new DOMException('Test', 'QuotaExceededError'); return window.lotBSetItem.call(this, key, value) } })
    await click('Enregistrer la correction', `#${firstExecution}`)
    assert.match(await call(id => document.querySelector(`#${id} [role=alert]`).textContent, firstExecution), /Non enregistré/)
    assert.equal(await call(id => document.querySelector(`#${id} input[id$=loadKg]`).value, firstExecution), '77,5')
    assert.equal(await call(id => document.querySelector(`#${id} .workout-execution-close`).disabled, firstExecution), true)
    await call(() => { Storage.prototype.setItem = window.lotBSetItem })
    await click('Réessayer', `#${firstExecution}`)
    assert.match(await call(id => document.querySelector(`#${id} .workout-execution-result`).textContent, firstExecution), /77,5 kg/)
  })
  await check('Notes : sauvegarde automatique et retour contextuel au suivi', async () => {
    await click('Notes de séance')
    await enter('textarea', 'Trajectoire stable. Poursuivre la montée progressive.')
    assert.equal((await storedWorkouts()).find(item => item.title === 'Préparation technique').notes.during, 'Trajectoire stable. Poursuivre la montée progressive.')
    assert.equal(await evaluate('document.querySelector(".workout-notes-back").textContent.trim()'), '← Retour au suivi')
  })
  await captureScreen('07-notes')
  await sweep('07-notes')
  await check('Clôture : confirmation après une seule série, performances et notes intactes', async () => {
    await click('← Retour au suivi')
    await click('Terminer la séance')
    await click('Terminer la séance', 'dialog[open]')
    const completed = (await storedWorkouts()).find(item => item.title === 'Préparation technique')
    assert.equal(completed.status, 'completed')
    assert.equal(completed.exercises[0].sets[0].execution.loadKg, 77.5)
    assert.equal(completed.notes.during, 'Trajectoire stable. Poursuivre la montée progressive.')
    assert.equal(completed.exercises[0].sets[1].execution, undefined)
    assert.equal(await evaluate('document.querySelector(".nav-button[aria-current=page]").textContent.trim()'), 'Historique')
  })
  await check('Lot C : succès aligné avec le retour, le titre et le contenu', async () => {
    for (const width of [320, 375, 412, 768, 1024, 1440]) {
      await viewport(width)
      const axes = await evaluate('[".workout-notice", ".workout-history > .workout-back", "#history-page-title", ".workout-history .workout-detail"].map(selector => document.querySelector(selector).getBoundingClientRect().left)')
      assert.ok(axes.every(left => Math.abs(left - axes[0]) < 1), `Axes à ${width} px : ${axes}`)
    }
    assert.match(await evaluate('document.querySelector(".workout-notice").textContent'), /Séance terminée.*Tes performances ont été enregistrées/)
  })
  await captureScreen('lot-c-07-message-cloture')
  await check('Lot C : consultation ultérieure sans message et performances dominantes', async () => {
    await click('← Retour à l’historique', '.workout-history')
    await click('Consulter', '.workout-history')
    assert.equal(await evaluate('document.querySelector(".workout-notice")'), null)
    await viewport(1440)
    const sizes = await evaluate('({ width: document.querySelector(".workout-history-detail").getBoundingClientRect().width, loads: [...document.querySelector(".workout-set-summary").querySelectorAll(".workout-comparison-load")].map(item => parseFloat(getComputedStyle(item).fontSize)) })')
    assert.ok(sizes.width >= 900 && sizes.width <= 1000)
    assert.ok(sizes.loads[1] > sizes.loads[0])
    assert.equal(await evaluate('document.querySelectorAll(".workout-history .workout-set-duplicate").length'), 0)
  })
  await captureScreen('lot-c-05-06-historique-detail')
  await sweep('lot-c-historique-detail')
  assert.deepEqual(browserErrors, [])
  await writeFile(join(artifactDirectory, 'audit.json'), JSON.stringify({ passed, observations, screenshots, browserErrors }, null, 2))
  await writeFile(join(artifactDirectory, 'index.html'), `<!doctype html><html lang="fr"><meta charset="utf-8"><title>LiftBoard — Lot B</title><style>body{font:16px system-ui;background:#0f1112;color:#f3f0e8;margin:24px}section{margin-block:40px}img{max-width:100%;border:1px solid #353a3a}a{color:#facc15}</style><h1>Lot B — Captures de l’application</h1><p>Données fictives, profil isolé. ${passed} contrôles réussis. <a href="audit.json">Mesures</a></p>${screenshots.map(item => `<section><h2>${item.name} · ${item.width} px</h2><a href="${item.file}"><img src="${item.file}" loading="lazy" alt="${item.name}, largeur ${item.width} pixels"></a></section>`).join('')}</html>`)
  console.log(`${passed} contrôles Séances réussis, 0 échoué. Captures : ${artifactDirectory}`)
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await command('Browser.close').catch(() => {}); socket.close() }
  browser.kill()
}
