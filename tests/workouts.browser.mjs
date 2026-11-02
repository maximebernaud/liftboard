// Test réel de React sans dépendance : Chrome headless + protocole DevTools.
// Le profil est créé dans un dossier temporaire distinct du navigateur habituel.
// Démarrer Vite, puis : node tests/workouts.browser.mjs http://127.0.0.1:5173
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname), 'Utiliser uniquement un serveur local de test')
const chromePath = process.env.LIFTBOARD_TEST_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const artifactDirectory = await mkdtemp(join(tmpdir(), 'liftboard-j5-test-'))
const browser = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
  `--user-data-dir=${join(artifactDirectory, 'profile')}`, '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', 'about:blank',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })

let socket
let nextId = 0
const pending = new Map()
const browserErrors = []
let passed = 0

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Délai dépassé : ${method}`)) }, 10000)
    pending.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

const call = (fn, ...args) => evaluate(`(${fn.toString()})(${args.map((value) => JSON.stringify(value)).join(',')})`)
const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')

async function click(text, scope = 'body') {
  const found = await call((text, scope) => {
    const element = [...document.querySelector(scope).querySelectorAll('button, summary')]
      .find((item) => item.getClientRects().length && item.textContent.trim() === text)
    if (!element) return false
    element.click()
    return true
  }, text, scope)
  assert.ok(found, `Contrôle introuvable : ${text}`)
  await settle()
}

async function enter(selector, text) {
  await call((selector, text) => {
    const field = document.querySelector(selector)
    if (!field) throw new Error(`Champ introuvable : ${selector}`)
    const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, text)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }, selector, text)
  await settle()
}

async function select(selector, value) {
  await call((selector, value) => {
    const field = document.querySelector(selector)
    field.value = value
    field.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector, value)
  await settle()
}

async function arrow(selector, key, count = 1) {
  await call((selector) => document.querySelector(selector).focus({ preventScroll: true }), selector)
  for (let index = 0; index < count; index++) {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: key === 'ArrowUp' ? 38 : 40, autoRepeat: index > 0 })
  }
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'ArrowUp' ? 38 : 40 })
  await settle()
  assert.equal(await call((selector) => document.activeElement === document.querySelector(selector), selector), true)
  return call((selector) => document.querySelector(selector).value, selector)
}

async function waitForApp() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate('Boolean(document.querySelector("#workout-page-title"))')) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('LiftBoard ne s’affiche pas')
}

async function reload() {
  await command('Page.reload')
  await new Promise((resolve) => setTimeout(resolve, 200))
  await waitForApp()
  await settle()
}

const storedWorkouts = () => evaluate('JSON.parse(localStorage.getItem("liftboard.workouts.v1") ?? "[]")')
const guardActive = () => evaluate('!window.dispatchEvent(new Event("beforeunload", { cancelable: true }))')

async function check(label, action) {
  await action()
  passed++
  console.log(`✓ ${label}`)
}

async function viewport(width, name, screenshot = false) {
  await command('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 960 })
  await settle()
  const size = await evaluate(`({ width: innerWidth, document: document.documentElement.scrollWidth,
    buttons: [...document.querySelectorAll('.workout-sessions button')].filter(b => b.getClientRects().length)
      .map(b => ({ text: b.textContent, width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height })),
    textarea: document.querySelector('textarea') && getComputedStyle(document.querySelector('textarea')).fontSize })`)
  assert.ok(size.document <= width && size.width === width, `${name} à ${width}px : débordement ${JSON.stringify(size)}`)
  assert.ok(size.buttons.every((button) => button.width >= 44 && button.height >= 44), `Cibles tactiles : ${JSON.stringify(size.buttons)}`)
  if (size.textarea) assert.ok(parseFloat(size.textarea) >= 16)
  if (width >= 960) {
    const centered = await evaluate(`(() => {
      const panel = document.querySelector('.workout-sessions').getBoundingClientRect();
      const main = document.querySelector('main').getBoundingClientRect();
      return panel.width <= 680 && Math.abs((panel.left + panel.right) - (main.left + main.right)) <= 2
    })()`)
    assert.ok(centered, 'Éditeur centré avec largeur maximale conservée')
  }
  if (screenshot) {
    const image = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(join(artifactDirectory, `${name}-${width}.png`), Buffer.from(image.data, 'base64'))
  }
}

try {
  const address = await new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`Chrome ne démarre pas : ${output.slice(-1000)}`)), 12000)
    browser.once('error', (error) => { clearTimeout(timeout); reject(error) })
    browser.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Chrome arrêté : ${code}`)) })
    browser.stderr.on('data', (chunk) => {
      output += chunk.toString()
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timeout); resolve(match[1]) }
    })
  })
  const debugOrigin = new URL(address).origin.replace('ws:', 'http:')
  const target = await (await fetch(`${debugOrigin}/json/new?${encodeURIComponent(baseUrl)}`, { method: 'PUT' })).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails)
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timeout)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  await command('Page.enable')
  await command('Runtime.enable')
  await waitForApp()

  await check('état vide, navigation et record 1RM', async () => {
    assert.deepEqual(await storedWorkouts(), [])
    await click('Records', '.primary-nav')
    await click('Ajouter un record', '.exercise-card')
    await enter('#record-snatch', '82,5')
    await click('Enregistrer', '.exercise-card')
    await click('Calculer', '.primary-nav')
    assert.equal(await evaluate('document.querySelector("#page-title").textContent'), 'Calculer')
    await click('Historique', '.primary-nav')
    assert.match(await evaluate('[...document.querySelectorAll(".empty-state")].find(item => item.getClientRects().length).textContent'), /Aucune séance terminée/)
    await click('Séances', '.primary-nav')
    assert.equal(await guardActive(), false)
  })

  await check('validation accessible et conservation du brouillon entre onglets', async () => {
    await click('+ Nouvelle séance')
    await click('Enregistrer la séance')
    assert.equal(await evaluate('document.querySelector("#workout-title").getAttribute("aria-invalid")'), 'true')
    assert.deepEqual(await storedWorkouts(), [])
    await enter('#workout-title', 'Technique A')
    await enter('#workout-date', '2026-11-02')
    await click('+ Ajouter un exercice')
    await enter('.workout-exercise input', '3')
    await enter('.workout-exercise input[id$="-intensity"]', '75,')
    await click('Enregistrer la séance')
    assert.equal(await call((selector) => document.querySelector(selector).value, 'input[id$="-intensity"]'), '75,')
    await click('Records', '.primary-nav')
    await click('Séances', '.primary-nav')
    assert.equal(await evaluate('document.querySelector("#workout-title").value'), 'Technique A')
    await enter('.workout-exercise input[id$="-intensity"]', '73,3')
    await select('.workout-exercise select[id$="-rounding"]', 'up-2.5')
    await click('+ Ajouter une série')
    await enter('.workout-set:nth-child(2) input[id$="-reps"]', '2')
    await enter('.workout-set:nth-child(2) input[id$="-intensity"]', '80')
    assert.equal(await guardActive(), true)
    for (const width of [320, 393, 430]) await viewport(width, 'editor', width === 320)
  })

  await check('notes du formulaire, création et rechargement fidèle', async () => {
    await click('Notes de séance (facultatif)')
    await enter('.workout-notes-section textarea', '  Consignes Avant\nGarder la barre proche\n')
    await click('Pendant', '.workout-notes-section')
    await enter('.workout-notes-section textarea', 'Première observation')
    await click('Après', '.workout-notes-section')
    await enter('.workout-notes-section textarea', 'Bilan initial')
    assert.deepEqual(await storedWorkouts(), [])
    await click('Enregistrer la séance')
    const [saved] = await storedWorkouts()
    assert.equal(saved.status, 'planned')
    assert.deepEqual(saved.exercises[0].sets[0].load, { exactKg: 60.4725, selectedKg: 62.5 })
    assert.equal(saved.notes.before, '  Consignes Avant\nGarder la barre proche\n')
    assert.equal(await guardActive(), false)
    await reload()
    assert.deepEqual(await storedWorkouts(), [saved])
    assert.match(await evaluate('document.querySelector(".workout-session-list").textContent'), /Technique A/)
    for (const width of [320, 393, 430]) await viewport(width, 'list')
  })

  await check('notes rapides : focus, curseur, fermeture immédiate et rechargement', async () => {
    await click('Notes', '.workout-session-list')
    assert.equal(await evaluate('document.activeElement.tagName'), 'TEXTAREA')
    assert.equal(await evaluate('document.querySelector("[aria-pressed=true]").textContent.trim()'), 'Pendant')
    await enter('textarea', '')
    await command('Input.insertText', { text: 'Réception instable sur la deuxième série' })
    await click('← Retour aux séances')
    assert.equal((await storedWorkouts())[0].notes.during, 'Réception instable sur la deuxième série')
    await click('Notes', '.workout-session-list')
    await evaluate('window.noteField = document.querySelector("textarea"); noteField.focus(); noteField.setSelectionRange(9, 9)')
    await command('Input.insertText', { text: ' très' })
    assert.equal(await evaluate('document.activeElement === window.noteField && noteField.selectionStart === 14'), true)
    await click('Avant')
    assert.equal(await evaluate('document.querySelector("textarea").value'), '  Consignes Avant\nGarder la barre proche\n')
    await click('Après')
    assert.equal(await evaluate('document.querySelector("textarea").value'), 'Bilan initial')
    for (const width of [320, 393, 430]) await viewport(width, 'notes', width === 320)
    await click('← Retour aux séances')
    const saved = await storedWorkouts()
    await reload()
    assert.deepEqual(await storedWorkouts(), saved)
  })

  await check('nouveau record sans modification des charges historiques', async () => {
    const before = (await storedWorkouts())[0]
    await click('Records', '.primary-nav')
    await click('Modifier le record', '.exercise-card')
    await enter('#record-snatch', '100')
    await click('Enregistrer', '.exercise-card')
    await click('Séances', '.primary-nav')
    await click('Ouvrir', '.workout-session-list')
    assert.match(await evaluate('document.querySelector(".workout-detail-sets").textContent'), /62,5 kg/)
    await click('Modifier')
    assert.equal(await evaluate('document.querySelector(".workout-load strong").textContent.trim()'), '62,5 kg')
    await enter('#workout-title', 'Technique A modifiée')
    await enter('.workout-exercise input[id$="-reps"]', '5')
    await click('Enregistrer les modifications')
    const saved = (await storedWorkouts())[0]
    assert.equal(saved.id, before.id)
    assert.equal(saved.exercises[0].sets[0].id, before.exercises[0].sets[0].id)
    assert.deepEqual(saved.exercises[0].sets[0].load, before.exercises[0].sets[0].load)
    assert.equal(await guardActive(), false)
  })

  await check('édition ancienne : fusion des notes récentes, annulation et conflit explicite', async () => {
    await click('Ouvrir', '.workout-session-list')
    await click('Modifier')
    await enter('#workout-title', 'Technique A finale')
    await click('← Retour aux séances')
    await click('Notes', '.workout-session-list')
    await enter('textarea', 'Note rapide plus récente\n')
    await click('← Retour aux séances')
    await click('Reprendre la modification')
    await click('Enregistrer les modifications')
    assert.equal((await storedWorkouts())[0].notes.during, 'Note rapide plus récente\n')
    assert.equal((await storedWorkouts())[0].title, 'Technique A finale')
    await click('Ouvrir', '.workout-session-list')
    await click('Modifier')
    await click('Notes de séance (facultatif)')
    await click('Pendant', '.workout-notes-section')
    await enter('textarea', 'Ancienne édition')
    await click('← Retour aux séances')
    await click('Notes', '.workout-session-list')
    await enter('textarea', 'Observation récente')
    await click('← Retour aux séances')
    await click('Reprendre la modification')
    await click('Enregistrer les modifications')
    assert.match(await evaluate('document.querySelector("form > .record-error").textContent'), /changé depuis/)
    await click('Notes de séance (facultatif)')
    await click('Pendant', '.workout-notes-section')
    assert.equal(await evaluate('document.querySelector("textarea").value'), 'Ancienne édition')
    await click('Annuler', 'form')
    assert.equal(await evaluate('document.activeElement.textContent'), 'Annuler')
    await click('Annuler', 'dialog[open]')
    assert.equal(await evaluate('Boolean(document.querySelector("dialog[open]"))'), false)
    await click('Annuler', 'form')
    await click('Abandonner les modifications', 'dialog[open]')
    assert.equal((await storedWorkouts())[0].notes.during, 'Observation récente')
    assert.equal(await guardActive(), false)
    await click('← Retour aux séances')
  })

  await check('échec des notes, catégories conservées, protection et nouvelle tentative', async () => {
    await click('Notes', '.workout-session-list')
    const before = await storedWorkouts()
    await evaluate(`window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
      if (key === 'liftboard.workouts.v1') throw new DOMException('Test quota', 'QuotaExceededError');
      return window.originalSetItem.call(this, key, value)
    }`)
    await enter('textarea', 'Saisie non enregistrée\n')
    assert.match(await evaluate('document.querySelector(".workout-notes-error").textContent'), /Non enregistré/)
    assert.deepEqual(await storedWorkouts(), before)
    assert.equal(await guardActive(), true)
    await click('Avant')
    await enter('textarea', 'Consigne en attente')
    await click('Pendant')
    assert.equal(await evaluate('document.querySelector("textarea").value'), 'Saisie non enregistrée\n')
    await click('← Retour aux séances')
    assert.equal(await evaluate('Boolean(document.querySelector("dialog[open]"))'), true)
    await click('Annuler', 'dialog[open]')
    await click('Records', '.primary-nav')
    await click('Séances', '.primary-nav')
    assert.equal(await evaluate('document.querySelector("textarea").value'), 'Saisie non enregistrée\n')
    await evaluate('Storage.prototype.setItem = window.originalSetItem')
    await click('Réessayer')
    assert.equal(await evaluate('Boolean(document.querySelector(".workout-notes-error"))'), false)
    assert.equal(await guardActive(), false)
    const [saved] = await storedWorkouts()
    assert.equal(saved.notes.during, 'Saisie non enregistrée\n')
    assert.equal(saved.notes.before, 'Consigne en attente')
    assert.deepEqual(saved.exercises, before[0].exercises)
    await click('← Retour aux séances')
    await reload()
    assert.deepEqual(await storedWorkouts(), [saved])
  })

  await check('suppression : confirmation accessible, annulation, échec et cible unique', async () => {
    const before = await storedWorkouts()
    // Une seconde séance distincte permet de vérifier l'absence d'effets secondaires.
    await click('+ Nouvelle séance')
    await enter('#workout-title', 'Séance B sans record')
    await enter('#workout-date', '2026-11-02')
    await click('+ Ajouter un exercice')
    await select('.workout-exercise select', 'front-squat')
    await enter('.workout-exercise input', '3')
    await enter('.workout-exercise input[id$="-intensity"]', '70')
    await click('+ Ajouter une série')
    await enter('.workout-set:nth-child(2) input[id$="-reps"]', '2')
    await enter('.workout-set:nth-child(2) input[id$="-intensity"]', '80')
    await evaluate(`window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new Error('Test write failure') }`)
    await click('Enregistrer la séance')
    assert.equal(await evaluate('document.querySelector("#workout-title").value'), 'Séance B sans record')
    assert.deepEqual(await storedWorkouts(), before)
    assert.match(await evaluate('document.querySelector("form > .record-error").textContent'), /Impossible/)
    await evaluate('Storage.prototype.setItem = window.originalSetItem')
    await click('Enregistrer la séance')
    const all = await storedWorkouts()
    assert.equal(all.length, 2)
    assert.equal(all[1].exercises[0].sets[0].load, null)
    await click('Notes', '.workout-session-list > li:nth-child(2)')
    await enter('textarea', 'Note B indépendante')
    assert.deepEqual((await storedWorkouts())[0], before[0])
    all[1].notes.during = 'Note B indépendante'
    await click('← Retour aux séances')
    await click('Ouvrir', '.workout-session-list')
    for (const width of [320, 393, 430]) await viewport(width, 'detail')
    await click('Supprimer la séance')
    for (const width of [320, 393, 430]) await viewport(width, 'confirmation', width === 320)
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /Technique A finale/)
    assert.equal(await evaluate('document.activeElement.textContent'), 'Annuler')
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await evaluate('Boolean(document.activeElement.closest("dialog[open]"))'), true)
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await settle()
    assert.equal(await evaluate('Boolean(document.querySelector("dialog[open]"))'), false)
    assert.deepEqual(await storedWorkouts(), all)
    await click('Supprimer la séance')
    await evaluate(`window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new Error('Test write failure') }`)
    await click('Supprimer la séance', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open] .record-error").textContent'), /Impossible/)
    assert.deepEqual(await storedWorkouts(), all)
    await evaluate('Storage.prototype.setItem = window.originalSetItem')
    await click('Supprimer la séance', 'dialog[open]')
    assert.deepEqual(await storedWorkouts(), [all[1]])
    assert.ok(before[0].id !== all[1].id)
    assert.equal(await evaluate('JSON.parse(localStorage.getItem("liftboard.personal-records.v1"))[0].oneRepMaxKg'), 100)
  })

  await check('charge absente : détour Records, calcul explicite et modification ciblée', async () => {
    await click('Ouvrir', '.workout-session-list')
    await click('Modifier')
    await click('Ouvrir les Records')
    await click('Ajouter un record', '.exercise-grid > li:nth-child(3)')
    await enter('#record-front-squat', '100')
    await click('Enregistrer', '.exercise-grid > li:nth-child(3)')
    await click('← Reprendre ma séance')
    assert.equal(await evaluate('document.querySelector(".workout-load strong").textContent.trim()'), '—')
    await click('Calculer cette charge', '.workout-set')
    assert.equal(await evaluate('document.querySelector(".workout-load strong").textContent.trim()'), '70 kg')
    await click('Enregistrer les modifications')
    const [saved] = await storedWorkouts()
    assert.deepEqual(saved.exercises[0].sets[0].load, { exactKg: 70, selectedKg: 70 })
    assert.equal(saved.exercises[0].sets[1].load, null)
    assert.equal(await guardActive(), false)
    await click('Ouvrir', '.workout-session-list')
    await click('Modifier')
    await enter('.workout-exercise input[id$="-intensity"]', '73,3')
    await select('.workout-exercise select[id$="-rounding"]', 'up-2.5')
    await click('Enregistrer les modifications')
    const [changed] = await storedWorkouts()
    assert.deepEqual(changed.exercises[0].sets[0].load, { exactKg: 73.3, selectedKg: 75 })
    assert.deepEqual(changed.exercises[0].sets[1], saved.exercises[0].sets[1])
    assert.equal(changed.id, saved.id)
    assert.equal((await storedWorkouts()).length, 1)
  })

  await check('flèches numériques Records et Calculator sans sauvegarde automatique', async () => {
    await viewport(1440, 'desktop')
    await evaluate(`window.addEventListener('keydown', event => { window.lastArrowPrevented = event.defaultPrevented })`)
    const workouts = await storedWorkouts()
    const records = await evaluate('localStorage.getItem("liftboard.personal-records.v1")')
    await click('Records', '.primary-nav')
    await click('Modifier le record', '.exercise-card')
    await enter('#record-snatch', '70')
    assert.equal(await arrow('#record-snatch', 'ArrowUp'), '70,5')
    assert.equal(await evaluate('window.lastArrowPrevented'), true)
    assert.equal(await arrow('#record-snatch', 'ArrowDown'), '70')
    await enter('#record-snatch', '70.1')
    assert.equal(await arrow('#record-snatch', 'ArrowUp'), '70.6')
    assert.equal(await arrow('#record-snatch', 'ArrowDown'), '70.1')
    await enter('#record-snatch', '70,1')
    assert.equal(await arrow('#record-snatch', 'ArrowUp', 4), '72,1')
    await enter('#record-snatch', '0,2')
    assert.equal(await arrow('#record-snatch', 'ArrowDown'), '0,2')
    for (const value of ['', '75,', 'abc']) {
      await enter('#record-snatch', value)
      assert.equal(await arrow('#record-snatch', 'ArrowUp'), value)
      assert.equal(await evaluate('window.lastArrowPrevented'), false)
    }
    assert.equal(await evaluate('localStorage.getItem("liftboard.personal-records.v1")'), records)
    await click('Annuler', '.exercise-card')
    await click('Calculer', '.primary-nav')
    await enter('#calculator-intensity', '85')
    assert.equal(await arrow('#calculator-intensity', 'ArrowUp'), '85,5')
    assert.match(await evaluate('document.querySelector(".calculator-result-value").textContent'), /85,5/)
    assert.equal(await arrow('#calculator-intensity', 'ArrowDown'), '85')
    await enter('#calculator-intensity', '99,8')
    assert.equal(await arrow('#calculator-intensity', 'ArrowUp', 3), '100')
    await enter('#calculator-intensity', '1.2')
    assert.equal(await arrow('#calculator-intensity', 'ArrowDown', 3), '1')
    await enter('#calculator-intensity', '')
    assert.equal(await arrow('#calculator-intensity', 'ArrowUp'), '')
    assert.deepEqual(await storedWorkouts(), workouts)
    await click('Séances', '.primary-nav')
  })

  await check('flèches des séries et ajout de cinq séries indépendantes, sans perte de focus', async () => {
    const before = await storedWorkouts()
    await click('Records', '.primary-nav')
    await click('Ajouter un record', '.exercise-grid > li:nth-child(2)')
    await enter('#record-clean-and-jerk', '120')
    await click('Enregistrer', '.exercise-grid > li:nth-child(2)')
    await click('Séances', '.primary-nav')
    await click('+ Nouvelle séance')
    await enter('#workout-title', 'Séries identiques')
    await click('+ Ajouter un exercice')
    await select('.workout-exercise select', 'clean-and-jerk')
    const reps = '.workout-set:first-child input[id$="-reps"]'
    const intensity = '.workout-set:first-child input[id$="-intensity"]'
    await enter(reps, '3')
    assert.equal(await arrow(reps, 'ArrowUp'), '4')
    assert.equal(await arrow(reps, 'ArrowDown'), '3')
    await enter(intensity, '85')
    assert.equal(await arrow(intensity, 'ArrowUp'), '85,5')
    assert.match(await evaluate('document.querySelector(".workout-load strong").textContent'), /102,6/)
    assert.equal(await arrow(intensity, 'ArrowDown'), '85')
    for (const value of ['', '75,', '101']) {
      await enter(intensity, value)
      assert.equal(await arrow(intensity, 'ArrowUp'), value)
    }
    await enter(intensity, '80')
    await select('.workout-exercise select[id$="-rounding"]', 'down-2.5')
    await viewport(320, 'series-before')
    await evaluate('document.querySelector(".workout-add-set").scrollIntoView({block:"center"}); document.querySelector(".workout-add-set").focus({preventScroll:true})')
    for (let index = 0; index < 4; index++) {
      await click('+ Ajouter une série')
      const position = await evaluate(`(() => { const button = document.querySelector('.workout-add-set'); const box = button.getBoundingClientRect();
        return { focused: document.activeElement === button, top: box.top, bottom: box.bottom, height: innerHeight } })()`)
      assert.equal(position.focused, true)
      assert.ok(position.top >= 0 && position.bottom <= position.height - 72, 'Ajouter reste accessible au-dessus de la navigation')
    }
    const sets = await evaluate(`[...document.querySelectorAll('.workout-set')].map(set => ({
      reps: set.querySelector('input[id$="-reps"]').value, intensity: set.querySelector('input[id$="-intensity"]').value,
      rounding: set.querySelector('select').value, load: set.querySelector('.workout-load strong').textContent.trim(),
      id: set.querySelector('input').id }))`)
    assert.equal(sets.length, 5)
    assert.equal(new Set(sets.map((set) => set.id)).size, 5)
    assert.ok(sets.every((set) => set.reps === '3' && set.intensity === '80' && set.rounding === 'down-2.5' && set.load === '95 kg'))
    await enter('.workout-set:last-child input[id$="-intensity"]', '90')
    assert.equal(await call((selector) => document.querySelector(selector).value, intensity), '80')
    await enter('.workout-set:last-child input[id$="-intensity"]', '75,')
    await click('+ Ajouter une série')
    assert.equal(await evaluate('document.querySelector(".workout-set:last-child input").value'), '')
    await click('Notes de séance (facultatif)')
    await enter('textarea', 'Notes sans raccourci numérique')
    assert.equal(await arrow('textarea', 'ArrowUp'), 'Notes sans raccourci numérique')
    assert.equal(await evaluate('window.lastArrowPrevented'), false)
    const handledSelect = await evaluate(`(() => { const event = new KeyboardEvent('keydown', {key:'ArrowUp',bubbles:true,cancelable:true});
      document.querySelector('.workout-exercise select').dispatchEvent(event); return event.defaultPrevented })()`)
    assert.equal(handledSelect, false)
    assert.deepEqual(await storedWorkouts(), before)
    await click('Annuler', 'form')
    await click('Abandonner les modifications', 'dialog[open]')
  })

  await check('ajout en édition : charges historiques intactes, nouvelle série au Record actuel', async () => {
    const [before] = await storedWorkouts()
    await click('Ouvrir', '.workout-session-list')
    await click('Modifier')
    await click('+ Ajouter une série')
    assert.equal(await evaluate('document.querySelector(".workout-set:last-child .workout-load strong").textContent.trim()'), '80 kg')
    assert.deepEqual(await storedWorkouts(), [before])
    await enter('.workout-set:first-child input[id$="-intensity"]', '80')
    await select('.workout-set:first-child select', 'exact')
    await click('Notes de séance (facultatif)')
    await enter('textarea', '  Consignes à recopier\nBarre proche\n')
    await click('Après', '.workout-notes-section')
    await enter('textarea', 'Bilan à ne pas recopier')
    await click('Enregistrer les modifications')
    const [saved] = await storedWorkouts()
    assert.deepEqual(saved.exercises[0].sets[1], before.exercises[0].sets[1])
    assert.deepEqual(saved.exercises[0].sets[2].load, { exactKg: 80, selectedKg: 80 })
    assert.ok(!before.exercises[0].sets.some((set) => set.id === saved.exercises[0].sets[2].id))
  })

  await check('duplication : garde du brouillon, notes de préparation, nouveaux IDs et recalcul', async () => {
    const [source] = await storedWorkouts()
    await click('Records', '.primary-nav')
    await click('Modifier le record', '.exercise-grid > li:nth-child(3)')
    await enter('#record-front-squat', '120')
    await click('Enregistrer', '.exercise-grid > li:nth-child(3)')
    await click('Séances', '.primary-nav')
    for (const width of [320, 393, 430, 768, 1440]) await viewport(width, 'cards-with-duplicate', width === 320 || width === 1440)
    await click('+ Nouvelle séance')
    await enter('#workout-title', 'Travail à conserver')
    await click('← Retour aux séances')
    await click('Dupliquer', '.workout-session-list')
    await click('Annuler', 'dialog[open]')
    await click('Reprendre le brouillon')
    assert.equal(await evaluate('document.querySelector("#workout-title").value'), 'Travail à conserver')
    await click('← Retour aux séances')
    await click('Dupliquer', '.workout-session-list')
    await click('Abandonner les modifications', 'dialog[open]')
    assert.equal(await evaluate('document.querySelector("#workout-title").value'), `${source.title} — copie`)
    const dateIsToday = await evaluate(`(() => { const today = new Date(); const date = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-');
      return document.querySelector('#workout-date').value === date })()`)
    assert.equal(dateIsToday, true)
    assert.match(await evaluate('document.querySelector(".workout-heading").textContent'), /Records actuels/)
    assert.equal(await guardActive(), true)
    assert.deepEqual(await storedWorkouts(), [source])
    const loads = await evaluate('[...document.querySelectorAll(".workout-load strong")].map(item => item.textContent.trim())')
    assert.ok(loads.every((load) => load === '96 kg'))
    await click('Notes de séance (facultatif)')
    assert.equal(await evaluate('document.querySelector("textarea").value'), source.notes.before)
    await click('Pendant', '.workout-notes-section')
    assert.equal(await evaluate('document.querySelector("textarea").value'), '')
    await click('Après', '.workout-notes-section')
    assert.equal(await evaluate('document.querySelector("textarea").value'), '')
    for (const width of [320, 393, 430, 768, 1440]) await viewport(width, 'duplicated-editor', width === 1440)
    await enter('#workout-title', 'Programmation jeudi')
    await enter('#workout-date', '2026-11-05')
    await enter('.workout-set:first-child input[id$="-intensity"]', '85')
    assert.equal(await arrow('.workout-set:first-child input[id$="-intensity"]', 'ArrowUp'), '85,5')
    assert.deepEqual(await storedWorkouts(), [source])
    await click('Enregistrer la séance')
    const saved = await storedWorkouts()
    assert.equal(saved.length, 2)
    assert.deepEqual(saved[0], source)
    assert.equal(saved[1].status, 'planned')
    assert.equal(saved[1].date, '2026-11-05')
    assert.deepEqual(saved[1].notes, { before: source.notes.before, during: '', after: '' })
    const ids = saved.flatMap(workout => [workout.id, ...workout.exercises.flatMap(block => [block.id, ...block.sets.map(set => set.id)])])
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual(saved[1].exercises[0].sets[0].load, { exactKg: 102.6, selectedKg: 102.6 })
    assert.deepEqual(saved[1].exercises[0].sets[1].load, { exactKg: 96, selectedKg: 96 })
    assert.equal(await guardActive(), false)
    await reload()
    assert.deepEqual(await storedWorkouts(), saved)
    await click('Dupliquer', '.workout-session-list')
    await click('Annuler', 'form')
    await click('Abandonner les modifications', 'dialog[open]')
    assert.deepEqual(await storedWorkouts(), saved)
  })

  await check('duplication sans record : absence explicite, source intacte et sauvegarde possible', async () => {
    const before = await storedWorkouts()
    await click('Records', '.primary-nav')
    await click('Modifier le record', '.exercise-grid > li:nth-child(3)')
    await click('Effacer ce record', '.exercise-grid > li:nth-child(3)')
    await click('Effacer le record', '.exercise-grid > li:nth-child(3) dialog[open]')
    await click('Séances', '.primary-nav')
    await click('Dupliquer', '.workout-session-list')
    assert.ok((await evaluate('[...document.querySelectorAll(".workout-load strong")].map(item => item.textContent.trim())')).every(load => load === '—'))
    await enter('#workout-title', 'Copie sans record')
    await click('Enregistrer la séance')
    const after = await storedWorkouts()
    assert.equal(after.length, 3)
    assert.deepEqual(after.slice(0, 2), before)
    assert.ok(after[2].exercises.every(block => block.sets.every(set => set.load === null)))
  })

  await check('stockage corrompu : message, écritures bloquées et brouillon préservé', async () => {
    await evaluate('localStorage.setItem("liftboard.workouts.v1", "{corrompu")')
    await reload()
    assert.match(await evaluate('document.querySelector(".records-storage-error").textContent'), /illisibles/)
    await click('+ Nouvelle séance')
    await enter('#workout-title', 'Ne pas perdre')
    await click('+ Ajouter un exercice')
    await enter('.workout-exercise input', '1')
    await enter('.workout-exercise input[id$="-intensity"]', '75')
    await click('Enregistrer la séance')
    assert.equal(await evaluate('document.querySelector("#workout-title").value'), 'Ne pas perdre')
    assert.equal(await evaluate('localStorage.getItem("liftboard.workouts.v1")'), '{corrompu')
    assert.match(await evaluate('document.querySelector("form > .record-error").textContent'), /bloquées/)
  })

  assert.deepEqual(browserErrors, [], 'Aucune exception JavaScript dans le navigateur')
  console.log(`${passed} parcours navigateur réussis. Captures et profil isolé : ${artifactDirectory}`)
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await command('Browser.close').catch(() => {})
    socket.close()
  }
  browser.kill()
}
