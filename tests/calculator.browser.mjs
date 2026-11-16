import { exercisePickerActions } from './helpers/exercisePicker.mjs'
// Lot D : interactions, stockage surveillé et captures dans un profil Chrome isolé.
// node tests/calculator.browser.mjs http://127.0.0.1:5177 [--baseline]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5177'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname))
const baseline = process.argv.includes('--baseline')
const artifactDirectory = await mkdtemp(join(tmpdir(), 'liftboard-calculator-'))
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
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Délai : ${method}`)) }, 10000)
    pending.set(id, { resolve, reject, timeout, method })
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
const { addExercise } = exercisePickerActions({ call, click, settle })
async function waitForApp() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate('Boolean(document.querySelector("#workout-page-title"))')) { await settle(); return }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Application non affichée')
}
async function click(label, scope = 'body') {
  assert.ok(await call((label, scope) => {
    const button = [...document.querySelector(scope).querySelectorAll('button')].find(item => item.getClientRects().length && item.textContent.trim() === label)
    if (!button) return false
    button.click()
    return true
  }, label, scope), `Bouton absent : ${label}`)
  await settle()
}
async function enter(selector, value) {
  await call((selector, value) => {
    const input = document.querySelector(selector)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, selector, value)
  await settle()
}
async function select(selector, value) {
  await call((selector, value) => {
    const input = document.querySelector(selector)
    input.value = value
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector, value)
  await settle()
}
async function key(key, code, modifiers = 0) {
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, modifiers, ...(key === 'Enter' ? { text: '\r' } : {}) })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code })
  await settle()
}
async function check(label, action) {
  try { await action() } catch (error) { console.error(`${passed} parcours réussis ; échec : ${label}`); throw error }
  passed++
  console.log(`✓ ${label}`)
}
async function viewport(width) {
  await command('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: width < 960 })
  await settle()
}
async function capture(name, fullPage = false) {
  await evaluate('document.fonts.ready.then(() => true)')
  const image = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage })
  await writeFile(join(artifactDirectory, `${name}.png`), Buffer.from(image.data, 'base64'))
}
async function capturePrimary(name, expanded = false) {
  await call(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo({ top: 0, behavior: 'instant' }) })
  if (!expanded) { await capture(name); return }
  const size = await call(() => ({ width: innerWidth, height: innerHeight, documentHeight: document.documentElement.scrollHeight }))
  await command('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.documentHeight, deviceScaleFactor: 1, mobile: size.width < 960 })
  await settle()
  await capture(name)
  await command('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: size.width < 960 })
  await settle()
}
async function doubleText() {
  // Agrandissement des tailles calculées avant toute mutation, sans zoom ni changement de viewport.
  await call(() => {
    const elements = [...document.querySelectorAll('.app-main, .app-main *, .primary-nav, .primary-nav *, .app-header, .app-header *')]
    const sizes = elements.map(element => {
      const style = getComputedStyle(element)
      return { element, size: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) }
    })
    for (const { element, size, line } of sizes) {
      element.style.setProperty('font-size', `${size * 2}px`, 'important')
      if (Number.isFinite(line)) element.style.setProperty('line-height', `${line * 2}px`, 'important')
    }
  })
  await settle()
}
async function inspectLayout(scope) {
  return call(scope => {
    const panel = document.querySelector(scope)
    const visible = [...panel.querySelectorAll('*')].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
    const controls = visible.filter(element => element.matches('button, input, select'))
    const clipped = visible.filter(element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect()
      return element.matches('h1,h2,h3,label,p,button') && rect.width > 4 && style.clipPath === 'none' &&
        style.overflowX !== 'auto' && element.scrollWidth > element.clientWidth + 2
    }).map(element => ({ tag: element.tagName, text: element.textContent.trim(), width: element.clientWidth, scroll: element.scrollWidth }))
    const smallTargets = controls.map(element => {
      const rect = element.getBoundingClientRect()
      return { text: element.textContent.trim() || element.id, width: rect.width, height: rect.height }
    }).filter(rect => rect.width < 43.5 || rect.height < 43.5)
    const nav = document.querySelector('.primary-nav'), navRect = nav.getBoundingClientRect()
    const navButtons = [...nav.querySelectorAll('button')]
    const brokenWords = []
    const readingLabels = [...controls.filter(element => element.tagName === 'BUTTON'),
      ...panel.querySelectorAll('.records-group-heading h2, .exercise-card > h3')]
    for (const control of readingLabels) {
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of node.textContent.matchAll(/\S+/g)) {
          const range = document.createRange()
          range.setStart(node, match.index)
          range.setEnd(node, match.index + match[0].length)
          const rows = new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top)))
          if (rows.size > 1) brokenWords.push({ label: control.textContent.trim(), word: match[0] })
        }
      }
    }
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, panelWidth: panel.getBoundingClientRect().width,
      clipped, smallTargets, brokenWords, modalOverflow: panel.matches('dialog') && panel.scrollWidth > panel.clientWidth + 1,
      mobileNav: getComputedStyle(nav).position === 'fixed', navBottom: navRect.bottom,
      navTargets: navButtons.map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })),
    }
  }, scope)
}
async function focusState() {
  return call(() => {
    const element = document.activeElement, rect = element.getBoundingClientRect(), style = getComputedStyle(element)
    const modal = element.closest('dialog[open]'), nav = document.querySelector('.primary-nav')
    const availableBottom = modal ? innerHeight : getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().top : innerHeight
    return { id: element.id, text: element.textContent, outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth),
      visible: rect.top >= 0 && rect.bottom <= availableBottom + 1, insideModal: Boolean(modal), browserWrap: element === document.body }
  })
}
const reference = '#calculator-temporary-reference'
const activate = 'Tester une autre charge de référence'
const restore = 'Utiliser mon record enregistré'
const recordsKey = 'liftboard.personal-records.v1'
const workoutsKey = 'liftboard.workouts.v1'
const testRecords = [
  { exerciseId: 'snatch', oneRepMaxKg: 100 },
  { exerciseId: 'clean-and-jerk', oneRepMaxKg: 120 },
]
const testWorkouts = [{
  id: 'calculator-planned', title: 'Programmation inchangée', date: '2026-11-16', status: 'planned',
  notes: { before: 'Consigne', during: '', after: '' },
  exercises: [{ id: 'calculator-block', exerciseId: 'snatch', sets: [{
    id: 'calculator-set', reps: 3, intensityPct: 75,
    rounding: { mode: 'exact' }, load: { exactKg: 75, selectedKg: 75 },
  }] }],
}]
async function reload() {
  // Page.reload peut répondre avant le remplacement de l’ancien document.
  const loaded = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error('Rechargement incomplet')) }, 10000)
    function receive(event) {
      if (JSON.parse(event.data).method !== 'Page.loadEventFired') return
      clearTimeout(timeout)
      socket.removeEventListener('message', receive)
      resolve()
    }
    socket.addEventListener('message', receive)
  })
  await command('Page.reload')
  await loaded
  await waitForApp()

  await click('Calculer', '.primary-nav')
}
async function seed(records = testRecords) {
  await call((records, workouts, recordsKey, workoutsKey) => {
    localStorage.clear()
    localStorage.setItem(recordsKey, JSON.stringify(records))
    localStorage.setItem(workoutsKey, JSON.stringify(workouts))
    localStorage.setItem('calculator-sentinel', 'à conserver')
    sessionStorage.clear()
  }, records, testWorkouts, recordsKey, workoutsKey)
  await reload()
}
const value = selector => call(selector => document.querySelector(selector)?.value ?? null, selector)
const text = selector => call(selector => document.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() ?? null, selector)
const result = () => text('.calculator-result-value')
async function assertResult(expected) { assert.equal(await result(), expected === null ? null : `${expected} kg`) }
async function startTrial(input = '90') { await click(activate, '.calculator'); await enter(reference, input) }
async function watchStorage() {
  await call(() => {
    window.calculatorStorageSnapshot = Object.fromEntries(Object.entries(localStorage))
    window.calculatorStorageWrites = []
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method]
      Storage.prototype[method] = function (...args) {
        if (this === localStorage) window.calculatorStorageWrites.push({ method, args })
        return original.apply(this, args)
      }
    }
  })
}
async function assertStorageUnchanged() {
  assert.deepEqual(await evaluate('window.calculatorStorageWrites'), [], 'Aucun appel de mutation localStorage')
  assert.equal(await evaluate('JSON.stringify(Object.fromEntries(Object.entries(localStorage))) === JSON.stringify(window.calculatorStorageSnapshot)'), true)
}
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
  const debugOrigin = new URL(address).origin.replace('ws:', 'http:')
  const target = await (await fetch(`${debugOrigin}/json/new?${encodeURIComponent(baseUrl)}`, { method: 'PUT' })).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails)
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timeout)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(`${request.method} : ${JSON.stringify(message.error)}`))
    else request.resolve(message.result)
  })
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  await command('Page.enable')
  await command('Runtime.enable')
  await waitForApp()

  await seed()
  for (const width of [1440, 375]) {
    await viewport(width)
    await capturePrimary(`${baseline ? 'baseline' : 'final'}-official-${width}`, width === 375)
  }
  if (!baseline) {
    await check('Mode officiel par défaut et source explicite', async () => {
      await assertResult('75')
      assert.equal(await value(reference), null)
      assert.match(await text('.calculator-formula'), /Snatch · Record enregistré : 100 kg × 75 %/)
      assert.equal(await value('#calculator-intensity'), '75')
      assert.equal(await value('#calculator-rounding'), 'none')
    })
    await watchStorage()
    await check('Activation, préremplissage, record en lecture seule et aucun focus forcé', async () => {
      await call(label => [...document.querySelectorAll('.calculator button')].find(button => button.textContent.trim() === label).focus({ preventScroll: true }), activate)
      await click(activate, '.calculator')
      assert.equal(await value(reference), '100')
      assert.equal(await evaluate('document.activeElement.tagName'), 'BUTTON')
      assert.equal(await text('.calculator-record-value'), '100 kg')
      assert.equal(await evaluate('Boolean(document.querySelector(".calculator-record input"))'), false)
      assert.equal(await evaluate('document.querySelector(".calculator-reference-action").getAttribute("aria-expanded")'), 'true')
      await assertResult('75')
    })
    await check('Référence temporaire unique : 90 × 75 % = 67,5 kg', async () => {
      await enter(reference, '90')
      await assertResult('67,5')
      assert.match(await text('.calculator-formula'), /Référence temporaire : 90 kg × 75 %/)
      assert.equal(await text('.calculator-record-value'), '100 kg')
      await capturePrimary('final-temporary-375', true)
      await viewport(1440)
      await capturePrimary('final-temporary-1440')
    })
    await check('Décimales, point, virgule et résultat exact 67,425 kg', async () => {
      for (const input of ['92,5', '92.5']) {
        await enter(reference, input)
        await assertResult('69,375')
      }
      await enter(reference, '93')
      await enter('#calculator-intensity', '72,5')
      await assertResult('67,425')
    })
    await check('Quatre arrondis, milieu supérieur, multiples exacts et intensité 100 %', async () => {
      await enter(reference, '90')
      await enter('#calculator-intensity', '75')
      for (const [increment, expected] of [['none', '67,5'], ['1', '68'], ['2.5', '67,5'], ['5', '70']]) {
        await select('#calculator-rounding', increment)
        await assertResult(expected)
        if (increment !== 'none') assert.match(await text('.calculator-exact'), /Charge exacte : 67,5 kg/)
      }
      await enter(reference, '100')
      for (const increment of ['1', '2.5', '5']) {
        await select('#calculator-rounding', increment)
        await assertResult('75')
      }
      await enter('#calculator-intensity', '100')
      await assertResult('100')
    })
    await check('Retour officiel : paramètres conservés et ancienne saisie effacée', async () => {
      await enter(reference, '90')
      await enter('#calculator-intensity', '72,5')
      await select('#calculator-rounding', '5')
      await assertResult('65')
      await click(restore, '.calculator')
      await assertResult('75')
      assert.equal(await value(reference), null)
      assert.equal(await value('#calculator-intensity'), '72,5')
      assert.equal(await value('#calculator-rounding'), '5')
      await click(activate, '.calculator')
      assert.equal(await value(reference), '100')
    })
    await check('Changement d’exercice : essai oublié, intensité et arrondi conservés', async () => {
      await enter(reference, '90')
      await select('#calculator-exercise', 'clean-and-jerk')
      assert.equal(await value(reference), null)
      await assertResult('85')
      assert.equal(await value('#calculator-intensity'), '72,5')
      assert.equal(await value('#calculator-rounding'), '5')
      await select('#calculator-exercise', 'snatch')
      await click(activate, '.calculator')
      assert.equal(await value(reference), '100')
    })
    await check('Références invalides : aucun résultat périmé ni retour silencieux au record', async () => {
      for (const input of ['', ' ', '0', '-1', 'NaN', 'Infinity', '-Infinity', 'abc', '90kg', '9,2.5', '0x10', '9..5', '+90', '1e309']) {
        await enter(reference, input)
        await assertResult(null)
        assert.equal(await evaluate(`document.querySelector('${reference}').getAttribute('aria-invalid')`), 'true', input)
        assert.match(await text('#calculator-reference-error'), /charge.*supérieure à 0/)
        assert.match(await evaluate(`document.querySelector('${reference}').getAttribute('aria-describedby')`), /calculator-reference-error/)
        assert.doesNotMatch(await text('.calculator-result'), /NaN|Infinity/)
      }
      await enter(reference, '')
      await capturePrimary('final-invalid-1440')
      await enter(reference, '90')
      await select('#calculator-rounding', 'none')
      await enter('#calculator-intensity', '75')
      await assertResult('67,5')
    })
    await check('Validations de l’intensité conservées dans les deux modes', async () => {
      for (const temporary of [true, false]) {
        if (!temporary) await click(restore, '.calculator')
        for (const invalid of ['', '0', '0,5', '101', '100.000000000000001', 'NaN', 'Infinity', 'abc']) {
          await enter('#calculator-intensity', invalid)
          await assertResult(null)
          assert.equal(await evaluate('document.querySelector("#calculator-intensity").getAttribute("aria-invalid")'), 'true')
        }
        for (const valid of ['1', '100', '72,5', '72.5']) {
          await enter('#calculator-intensity', valid)
          assert.notEqual(await result(), null)
        }
      }
    })
    await check('Sans record : activation vide, calcul valide et annulation sans sauvegarde', async () => {
      await select('#calculator-exercise', 'front-squat')
      assert.match(await text('.calculator-missing-record'), /Aucun record pour Front Squat/)
      await click(activate, '.calculator')
      assert.equal(await value(reference), '')
      await assertResult(null)
      await enter(reference, '90')
      await enter('#calculator-intensity', '75')
      await assertResult('67,5')
      await viewport(375)
      await capturePrimary('final-no-record-375', true)
      await click('Annuler l’essai', '.calculator')
      await assertResult(null)
      assert.equal(await value(reference), null)
    })
    await check('Aucune écriture localStorage, Records et séances strictement identiques', assertStorageUnchanged)
    await check('Navigation : essai oublié sans perdre les paramètres', async () => {
      await select('#calculator-exercise', 'snatch')
      await startTrial('90')
      await enter('#calculator-intensity', '72,5')
      await select('#calculator-rounding', '5')
      for (const section of ['Séances', 'Records', 'Historique']) {
        await click(section, '.primary-nav')
        await click('Calculer', '.primary-nav')
        assert.equal(await value(reference), null)
        await assertResult('75')
        assert.equal(await value('#calculator-intensity'), '72,5')
        assert.equal(await value('#calculator-rounding'), '5')
        await startTrial('90')
      }
      await assertStorageUnchanged()
    })
    await check('Export JSON téléchargé : aucune donnée temporaire ni charge programmée modifiée', async () => {
      const downloads = join(artifactDirectory, 'downloads')
      await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
      await click('Séances', '.primary-nav')
      await click('Télécharger ma sauvegarde', '.data-backup')
      let files = []
      for (let attempt = 0; attempt < 50; attempt++) {
        files = (await readdir(downloads).catch(() => [])).filter(name => name.endsWith('.json'))
        if (files.length) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.equal(files.length, 1)
      const backup = JSON.parse(await readFile(join(downloads, files[0]), 'utf8'))
      assert.deepEqual(backup.data, { records: testRecords, workouts: testWorkouts })
      await assertStorageUnchanged()
    })
    await check('Rechargement : aucune restauration de l’essai temporaire', async () => {
      await click('Calculer', '.primary-nav')
      await startTrial('90')
      await assertStorageUnchanged()
      await reload()
      assert.equal(await value(reference), null)
      await assertResult('75')
    })
    await check('Programmation : une nouvelle série utilise le record officiel après un essai', async () => {
      await startTrial('90')
      await watchStorage()
      await click('Séances', '.primary-nav')
      await click('+ Nouvelle séance', '.workout-sessions')
      await addExercise('snatch', '.workout-editor')
      await enter('.workout-exercise input[id$="-reps"]', '3')
      await enter('.workout-exercise input[id$="-intensity"]', '75')
      assert.match(await text('.workout-load'), /75 kg/)
      assert.doesNotMatch(await text('.workout-load'), /67,5/)
      await assertStorageUnchanged()
      await click('Annuler', '.workout-editor')
      await click('Abandonner les modifications', 'dialog[open]')
      await click('Calculer', '.primary-nav')
      await assertResult('75')
    })
    await check('Deux onglets : essai indépendant et record actualisé sans remplacer la saisie', async () => {
      await startTrial('90')
      await watchStorage()
      const target = await (await fetch(`${debugOrigin}/json/new?${encodeURIComponent(baseUrl)}`, { method: 'PUT' })).json()
      const second = new WebSocket(target.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        second.addEventListener('open', resolve, { once: true })
        second.addEventListener('error', reject, { once: true })
      })
      let id = 0
      const secondCall = expression => new Promise((resolve, reject) => {
        const requestId = ++id
        const timeout = setTimeout(() => { second.removeEventListener('message', receive); reject(new Error('Délai second onglet')) }, 10000)
        function receive(event) {
          const message = JSON.parse(event.data)
          if (message.id !== requestId) return
          clearTimeout(timeout)
          second.removeEventListener('message', receive)
          if (message.error || message.result.exceptionDetails) reject(new Error(JSON.stringify(message)))
          else resolve(message.result.result.value)
        }
        second.addEventListener('message', receive)
        second.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
      })
      try {
        for (let attempt = 0; attempt < 80; attempt++) {
          if (await secondCall('Boolean(document.querySelector(".primary-nav"))')) break
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        await secondCall('[...document.querySelectorAll(".primary-nav button")].find(button => button.textContent.trim() === "Calculer").click()')
        assert.equal(await secondCall('Boolean(document.querySelector("#calculator-temporary-reference"))'), false)
        await secondCall('localStorage.setItem("liftboard.personal-records.v1", JSON.stringify([{exerciseId:"snatch",oneRepMaxKg:110},{exerciseId:"clean-and-jerk",oneRepMaxKg:120}]))')
        await command('Page.bringToFront')
        for (let attempt = 0; attempt < 80 && await text('.calculator-record-value') !== '110 kg'; attempt++) await settle()
        assert.equal(await text('.calculator-record-value'), '110 kg')
        assert.equal(await value(reference), '90')
        await assertResult('67,5')
        assert.deepEqual(await evaluate('window.calculatorStorageWrites'), [], 'Le calculateur ne réécrit pas le stockage après storage')
        await click(restore, '.calculator')
        await assertResult('82,5')
      } finally {
        second.close()
        await command('Target.closeTarget', { targetId: target.id })
      }
    })
    await check('Records corrompus : erreur visible et calcul temporaire sans mutation', async () => {
      await seed()
      await call(key => localStorage.setItem(key, '{invalide'), recordsKey)
      await reload()
      await watchStorage()
      const error = await text('.calculator-missing-record .record-error')
      assert.match(error, /conserv/)
      await startTrial('90')
      await assertResult('67,5')
      assert.equal(await text('.calculator-missing-record .record-error'), error)
      await click('Annuler l’essai', '.calculator')
      await assertResult(null)
      await assertStorageUnchanged()
    })
    await check('Lecture inaccessible : calcul indépendant et protections Records maintenues', async () => {
      await seed()
      const script = await command('Page.addScriptToEvaluateOnNewDocument', { source: `
        const originalGet = Storage.prototype.getItem;
        Storage.prototype.getItem = function(key) {
          if (this === localStorage && key === 'liftboard.personal-records.v1') throw new Error('Lecture refusée');
          return originalGet.call(this, key);
        };
      ` })
      await reload()
      await watchStorage()
      assert.match(await text('.calculator-missing-record .record-error'), /Impossible de lire/)
      await startTrial('90')
      await assertResult('67,5')
      assert.match(await text('.calculator-missing-record .record-error'), /Impossible de lire/)
      await click('Ouvrir les Records', '.calculator')
      assert.match(await text('.records-storage-error'), /modifications sont bloquées/)
      await assertStorageUnchanged()
      await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier })
      await reload()
    })
    await check('Clavier, focus visible, label, aide, flèches et annonces à la sortie du champ', async () => {
      await seed()
      await viewport(375)
      await call(() => document.querySelector('#calculator-exercise').focus())
      await key('Tab', 9)
      assert.match((await focusState()).text, /Tester une autre charge/)
      await key('Enter', 13)
      assert.equal(await value(reference), '100', 'Activation clavier')
      assert.match((await focusState()).text, /Utiliser mon record/, 'Focus sur le bouton de retour')
      await key('Tab', 9, 8)
      assert.equal((await focusState()).id, 'calculator-temporary-reference')
      assert.notEqual((await focusState()).outline, 'none')
      assert.ok((await focusState()).outlineWidth >= 2)
      assert.equal(await evaluate(`document.querySelector('${reference}').labels[0].textContent`), 'Charge de référence temporaire (kg)')
      assert.equal(await evaluate(`document.querySelector('${reference}').inputMode`), 'decimal')
      assert.match(await text('#calculator-reference-hint'), /ne sera pas modifié/)
      await enter(reference, '90')
      await assertResult('67,5')
      assert.equal(await text('.calculator [role=status]'), '')
      await key('ArrowUp', 38)
      assert.equal(await value(reference), '90,5')
      await key('Tab', 9)
      assert.match(await text('.calculator [role=status]'), /67,875 kg/)
      await key('Enter', 13)
      assert.match((await focusState()).text, /Tester une autre charge/)
      await key('Tab', 9)
      assert.equal((await focusState()).id, 'calculator-intensity')
    })
    const observations = []
    for (const width of [320, 375, 412, 768, 1024, 1440]) for (const scale of [1, 2]) {
      await check(`Responsive ${width} px, texte ${scale * 100} % : quatre états`, async () => {
        for (const state of ['official', 'temporary', 'invalid', 'missing']) {
          await seed()
          await viewport(width)
          if (state === 'missing') await select('#calculator-exercise', 'front-squat')
          if (state !== 'official') await startTrial(state === 'invalid' ? '' : '90')
          if (scale === 2) await doubleText()
          await call(() => window.scrollTo({ top: 0, behavior: 'instant' }))
          const layout = await inspectLayout('.calculator')
          observations.push({ state, width, scale, ...layout })
          assert.ok(layout.scrollWidth <= width, JSON.stringify(layout))
          assert.deepEqual(layout.clipped, [])
          assert.deepEqual(layout.smallTargets, [])
          assert.deepEqual(layout.brokenWords, [])
          assert.ok(layout.navTargets.every(target => target.width >= 44 && target.height >= 44))
          if (width < 960) { assert.equal(layout.mobileNav, true); assert.equal(layout.navBottom, 960) }
          else assert.equal(await evaluate('getComputedStyle(document.querySelector(".calculator-layout")).gridTemplateColumns.split(" ").length'), 2)
          await capture(`responsive-${state}-${width}-text-${scale * 100}`)
        }
      })
    }
    await writeFile(join(artifactDirectory, 'calculator-responsive-audit.json'), JSON.stringify(observations, null, 2))
  }
  assert.deepEqual(browserErrors, [])
  console.log(`${passed} contrôles Calculer réussis, 0 échoué. Captures : ${artifactDirectory}`)
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await command('Browser.close').catch(() => {}); socket.close() }
  browser.kill()
}

