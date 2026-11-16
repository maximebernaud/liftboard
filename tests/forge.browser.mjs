// Recette Forge Noire : Chrome/CDP sans dépendance et profil de test isolé.
// node tests/forge.browser.mjs http://127.0.0.1:5174 [--baseline] [--baseline-directory=...]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5174'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname))
const baseline = process.argv.includes('--baseline')
const baselineDirectory = process.argv.find(value => value.startsWith('--baseline-directory='))?.slice('--baseline-directory='.length)
const artifactDirectory = await mkdtemp(join(tmpdir(), 'liftboard-forge-'))
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
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, modifiers })
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
const editor = '.record-editor-dialog[open]'
const confirmation = 'dialog[open]:not(.record-editor-dialog)'
const recordRow = id => `#record-${id}-row`
const storedRecords = () => evaluate('JSON.parse(localStorage.getItem("liftboard.personal-records.v1"))')
const storedWorkouts = () => evaluate('JSON.parse(localStorage.getItem("liftboard.workouts.v1"))')
const dirtyGuard = () => evaluate('!window.dispatchEvent(new Event("beforeunload", { cancelable: true }))')
async function openRecord(id = 'snatch') {
  await call(scope => {
    const button = document.querySelector(scope).querySelector('.record-actions button')
    button.focus({ preventScroll: true })
    button.click()
  }, recordRow(id))
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
const testRecords = [
  { exerciseId: 'snatch', oneRepMaxKg: 100 }, { exerciseId: 'clean-and-jerk', oneRepMaxKg: 120 },
  { exerciseId: 'front-squat', oneRepMaxKg: 140 }, { exerciseId: 'back-squat', oneRepMaxKg: 165 },
]
const testWorkouts = [
  { id: 'forge-planned', title: 'Force & technique', date: '2026-11-16', status: 'planned' },
  { id: 'forge-completed-a', title: 'Technique olympique', date: '2026-11-14', status: 'completed' },
  { id: 'forge-completed-b', title: 'Force — squats', date: '2026-11-12', status: 'completed' },
  { id: 'forge-completed-c', title: 'Snatch & stabilité', date: '2026-11-10', status: 'completed' },
].map((workout, index) => ({ ...workout, notes: { before: 'Préparer la mobilité.', during: 'Garder la trajectoire proche.', after: 'Bonne séance.' },
  exercises: [{ id: `${workout.id}-block`, exerciseId: index === 2 ? 'front-squat' : 'snatch',
    sets: [1, 2, 3].map(number => ({ id: `${workout.id}-${number}`, reps: 3, intensityPct: 75,
      rounding: { mode: 'exact' }, load: { exactKg: 75, selectedKg: 75 },
      ...(workout.status === 'completed' ? { execution: { completed: true, reps: 3, loadKg: 75 } } : {}),
    })),
  }],
}))
async function seed() {
  await call((records, workouts) => {
    localStorage.setItem('liftboard.personal-records.v1', JSON.stringify(records))
    localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts))
    sessionStorage.clear()
  }, testRecords, testWorkouts)
  await command('Page.reload')
  await new Promise(resolve => setTimeout(resolve, 200))
  await waitForApp()
}
async function sessionSnapshot() {
  await evaluate('document.fonts.ready.then(() => true)')
  return call(() => {
    const panel = document.querySelector('.workout-sessions:not(.workout-history)')
    return { text: panel.textContent, styles: [...panel.querySelectorAll('h1,h2,p,button,input,select,article')].filter(element => element.getClientRects().length).map(element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect()
      return { tag: element.tagName, text: element.textContent, font: style.fontFamily, size: style.fontSize,
        weight: style.fontWeight, color: style.color, background: style.backgroundColor,
        padding: style.padding, border: style.border, radius: style.borderRadius, width: Math.round(box.width), height: Math.round(box.height) }
    }) }
  })
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
  await evaluate('document.fonts.ready.then(() => true)')
  const snapshots = {}
  await check('Séances : références visuelles et styles du contenu à 375 et 1440 px', async () => {
    for (const width of [375, 1440]) {
      await viewport(width)
      snapshots[width] = await sessionSnapshot()
      await capture(`${baseline ? 'baseline' : 'final'}-seances-${width}`)
    }
    await writeFile(join(artifactDirectory, 'seances-snapshots.json'), JSON.stringify(snapshots, null, 2))
    if (baselineDirectory) assert.deepEqual(snapshots, JSON.parse(await readFile(join(baselineDirectory, 'seances-snapshots.json'), 'utf8')), 'Contenu et styles Séances inchangés')
  })
  if (!baseline) {
    await check('Navigation : SVG existants, aucun numéro, état actif et barre mobile conservés', async () => {
      for (const width of [320, 375, 412, 1024, 1440]) {
        await viewport(width)
        for (const label of ['Séances', 'Records', 'Calculer', 'Historique']) {
          await click(label, '.primary-nav')
          const navigation = await call(() => {
            const nav = document.querySelector('.primary-nav')
            const buttons = [...nav.querySelectorAll('button')]
            return {
              labels: buttons.map(button => button.textContent.trim()),
              icons: buttons.map(button => {
                const icon = button.querySelector('svg'), rect = icon.getBoundingClientRect()
                return { visible: getComputedStyle(icon).display !== 'none' && rect.width > 0 && rect.height > 0,
                  hidden: icon.getAttribute('aria-hidden'), content: getComputedStyle(button, '::after').content }
              }),
              active: buttons.filter(button => button.getAttribute('aria-current') === 'page').map(button => button.textContent.trim()),
              indicator: getComputedStyle(nav.querySelector('[aria-current=page]'), '::before').width,
              position: getComputedStyle(nav).position,
              bottom: nav.getBoundingClientRect().bottom,
            }
          })
          assert.deepEqual(navigation.labels, ['Séances', 'Records', 'Calculer', 'Historique'])
          assert.ok(navigation.icons.every(icon => icon.visible && icon.hidden === 'true' && icon.content === 'none'))
          assert.deepEqual(navigation.active, [label])
          assert.ok(parseFloat(navigation.indicator) > 0)
          assert.equal(navigation.position, width < 960 ? 'fixed' : 'static')
          if (width < 960) assert.equal(navigation.bottom, 960)
        }
      }
    })
    await check('Titres : préfixes décoratifs supprimés sur les pages du lot A', async () => {
      await click('Calculer', '.primary-nav')
      assert.equal(await evaluate('document.querySelector(".calculator-section-heading p").textContent'), 'Votre charge d’entraînement')
      await click('Historique', '.primary-nav')
      assert.deepEqual(await evaluate('[...document.querySelectorAll(".history-section-heading h2")].map(heading => heading.textContent)'), ['Filtres', 'Séances terminées'])
      assert.equal(await evaluate('document.querySelector(".workout-history-filters .history-section-heading").children.length'), 1)
      await click('Records', '.primary-nav')
      assert.equal(await call(() => [...document.querySelectorAll('.records-group-heading h2')].some(heading => /^\d+\s*\//.test(heading.textContent))), false)
    })
    await check('Records : focus initial, confinement clavier, Échap, reprise et retour au déclencheur', async () => {
      await click('Records', '.primary-nav')
      await openRecord()
      assert.equal(await evaluate('document.activeElement.id'), 'record-snatch')
      for (let index = 0; index < 10; index++) {
        await key('Tab', 9)
        const focus = await focusState()
        // Chrome inclut son interface dans le cycle natif ; aucun contrôle de fond ne doit recevoir le focus.
        assert.equal(focus.insideModal || focus.browserWrap, true, 'La tabulation ne rejoint aucun contrôle en arrière-plan')
        if (focus.browserWrap) { await key('Tab', 9); assert.equal((await focusState()).insideModal, true) }
      }
      for (let index = 0; index < 6; index++) {
        await key('Tab', 9, 8)
        const focus = await focusState()
        assert.equal(focus.insideModal || focus.browserWrap, true)
        if (focus.browserWrap) { await key('Tab', 9, 8); assert.equal((await focusState()).insideModal, true) }
      }
      await key('Escape', 27)
      assert.equal(await evaluate('Boolean(document.querySelector(".record-editor-dialog[open]"))'), false)
      assert.equal(await call(scope => document.activeElement === document.querySelector(`${scope} .record-actions button`), recordRow('snatch')), true)
      await openRecord()
      assert.equal(await evaluate('document.activeElement.id'), 'record-snatch')
      await click('Annuler', editor)
      assert.equal(await call(scope => document.activeElement === document.querySelector(`${scope} .record-actions button`), recordRow('snatch')), true)
    })
    await check('Records : brouillon décimal suspendu, navigation réelle et aucune écriture implicite', async () => {
      const before = await storedRecords()
      await openRecord()
      await enter('#record-snatch', '102,5')
      assert.equal(await dirtyGuard(), true)
      await key('Escape', 27)
      await click('Calculer', '.primary-nav')
      assert.equal(await dirtyGuard(), true)
      assert.match(await evaluate('document.querySelector(".calculator-result-value").textContent'), /75/)
      await click('Records', '.primary-nav')
      await openRecord()
      assert.equal(await evaluate('document.querySelector("#record-snatch").value'), '102,5')
      assert.deepEqual(await storedRecords(), before)
      await click('Annuler', editor)
      assert.equal(await dirtyGuard(), false)
      assert.deepEqual(await storedRecords(), before)
    })
    await check('Records : saisie invalide, virgule et point, enregistrement puis persistance', async () => {
      await openRecord()
      await enter('#record-snatch', 'invalide')
      await click('Enregistrer', editor)
      assert.equal(await evaluate('document.querySelector("#record-snatch").getAttribute("aria-invalid")'), 'true')
      assert.match(await evaluate('document.querySelector(".record-editor-dialog [role=alert]").textContent'), /supérieur à 0/)
      assert.equal(await evaluate('document.querySelector("#record-snatch").value'), 'invalide')
      await enter('#record-snatch', '101,25')
      await click('Enregistrer', editor)
      assert.equal((await storedRecords())[0].oneRepMaxKg, 101.25)
      await openRecord()
      await enter('#record-snatch', '100.5')
      await click('Enregistrer', editor)
      assert.equal((await storedRecords())[0].oneRepMaxKg, 100.5)
      await command('Page.reload')
      await new Promise(resolve => setTimeout(resolve, 200))
      await waitForApp()
      assert.equal((await storedRecords())[0].oneRepMaxKg, 100.5)
      await click('Records', '.primary-nav')
    })
    await check('Records : confirmation de suppression, annulation, Échap et effacement ciblé', async () => {
      await openRecord()
      await click('Effacer ce record', editor)
      assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Annuler')
      await key('Escape', 27)
      assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Effacer ce record')
      assert.equal((await storedRecords()).length, 4)
      await click('Effacer ce record', editor)
      await click('Annuler', confirmation)
      assert.equal((await storedRecords()).length, 4)
      await click('Effacer ce record', editor)
      await click('Effacer le record', confirmation)
      assert.deepEqual((await storedRecords()).map(record => record.exerciseId), ['clean-and-jerk', 'front-squat', 'back-squat'])
      assert.match(await call(scope => document.querySelector(scope).textContent, recordRow('snatch')), /Record non renseigné/)
      assert.equal(await dirtyGuard(), false)
    })
    await check('Records : erreur localStorage visible, saisie conservée et reprise après stockage indisponible', async () => {
      await seed()
      await click('Records', '.primary-nav')
      await openRecord()
      await enter('#record-snatch', '103,5')
      await call(() => {
        window.forgeSet = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {
          if (key === 'liftboard.personal-records.v1') throw new DOMException('Full', 'QuotaExceededError')
          return window.forgeSet.call(this, key, value)
        }
      })
      await click('Enregistrer', editor)
      assert.equal(await evaluate('document.querySelector("#record-snatch").value'), '103,5')
      assert.equal(await evaluate('Boolean(document.querySelector(".record-editor-dialog [role=alert]"))'), true)
      assert.equal((await storedRecords())[0].oneRepMaxKg, 100)
      await call(() => { Storage.prototype.setItem = window.forgeSet })
      await click('Reprendre plus tard', editor)
      await call(() => {
        window.forgeGet = Storage.prototype.getItem
        Storage.prototype.getItem = function (key) {
          if (key === 'liftboard.personal-records.v1') throw new Error('Denied')
          return window.forgeGet.call(this, key)
        }
        window.dispatchEvent(new StorageEvent('storage', { key: 'liftboard.personal-records.v1', storageArea: localStorage }))
      })
      await settle()
      assert.equal(await evaluate('document.querySelector("#record-snatch-row .record-actions button").disabled'), false)
      await openRecord()
      assert.equal(await evaluate('document.querySelector("#record-snatch").value'), '103,5')
      await click('Annuler', editor)
      assert.equal(await dirtyGuard(), false)
      await call(() => { Storage.prototype.getItem = window.forgeGet })
      await seed()
    })
    await check('Calculer : résultat, décimales, trois arrondis et absence de résultat invalide', async () => {
      await click('Calculer', '.primary-nav')
      assert.match(await evaluate('document.querySelector(".calculator-result-value").textContent'), /75/)
      await enter('#calculator-intensity', '72,3')
      assert.match(await evaluate('document.querySelector(".calculator-result-value").textContent'), /72,3/)
      for (const [increment, expected] of [['1', '72'], ['2.5', '72,5'], ['5', '70']]) {
        await select('#calculator-rounding', increment)
        assert.equal(await call(() => document.querySelector('.calculator-result-value').textContent.replace(/\s+/g, ' ').trim()), `${expected} kg`)
        assert.match(await evaluate('document.querySelector(".calculator-exact").textContent'), /72,3/)
      }
      await select('#calculator-rounding', 'none')
      await enter('#calculator-intensity', '72.5')
      assert.match(await evaluate('document.querySelector(".calculator-result-value").textContent'), /72,5/)
      for (const invalid of ['', 'invalide', '0', '101']) {
        await enter('#calculator-intensity', invalid)
        assert.equal(await evaluate('Boolean(document.querySelector(".calculator-result-value"))'), false)
        assert.equal(await evaluate('document.querySelector("#calculator-intensity").getAttribute("aria-invalid")'), 'true')
      }
      await enter('#calculator-intensity', '75')
    })
    await check('Calculer : record absent, accès Records et résultat actualisé après enregistrement', async () => {
      await call(() => {
        const records = JSON.parse(localStorage.getItem('liftboard.personal-records.v1'))
        localStorage.setItem('liftboard.personal-records.v1', JSON.stringify(records.filter(record => record.exerciseId !== 'snatch')))
      })
      await command('Page.reload')
      await new Promise(resolve => setTimeout(resolve, 200))
      await waitForApp()
      await click('Calculer', '.primary-nav')
      assert.equal(await evaluate('Boolean(document.querySelector(".calculator-result-value"))'), false)
      await click('Renseigner mon record', '.calculator')
      await openRecord()
      await enter('#record-snatch', '110')
      await click('Enregistrer', editor)
      await click('Calculer', '.primary-nav')
      assert.match(await evaluate('document.querySelector(".calculator-result-value").textContent'), /82,5/)
      await seed()
    })
    await check('Historique : tri, filtres combinés, aucun résultat et réinitialisation', async () => {
      await click('Historique', '.primary-nav')
      const before = await storedWorkouts()
      const titles = () => evaluate('[...document.querySelectorAll(".history-journal h2")].map(title => title.textContent)')
      const count = () => evaluate('document.querySelector(".history-completed-heading [role=status]").textContent')
      assert.deepEqual(await titles(), ['Technique olympique', 'Force — squats', 'Snatch & stabilité'])
      assert.equal(await count(), '3 séances')
      assert.equal(await evaluate('document.querySelectorAll(".workout-history [role=status], .workout-history [aria-live]").length'), 1)
      assert.equal(await evaluate('Boolean(document.querySelector(".history-results-count, .history-journal .workout-status"))'), false)
      assert.deepEqual(await evaluate('[...document.querySelectorAll(".history-column-headings span")].map(span => span.textContent)'), ['Séance', 'Séries effectuées', 'Action'])
      assert.equal(await evaluate('[...document.querySelectorAll(".history-journal button")].every(button => button.textContent === "Consulter" && button.getAttribute("aria-label") === `Consulter la séance : ${button.closest("article").querySelector("h2").textContent}`)'), true)
      assert.equal(await evaluate('[...document.querySelectorAll(".history-row-progress")].every(item => item.textContent.includes("3 / 3"))'), true)
      await select('#history-exercise', 'snatch')
      assert.equal(await count(), '2 séances')
      await enter('#history-date', '2026-11-10')
      assert.deepEqual(await titles(), ['Snatch & stabilité'])
      assert.equal(await count(), '1 séance')
      await click('Réinitialiser les filtres', '.workout-history')
      assert.equal(await count(), '3 séances')
      await enter('#history-date', '2026-11-10')
      assert.equal(await count(), '1 séance')
      await select('#history-exercise', 'front-squat')
      assert.equal(await count(), '0 séance')
      assert.equal(await evaluate('Boolean(document.querySelector("#history-filter-empty-title"))'), true)
      await click('Effacer les filtres', '.workout-history')
      assert.equal((await titles()).length, 3)
      assert.equal(await count(), '3 séances')
      await click('Consulter', '.history-journal li')
      assert.equal(await evaluate('document.querySelector("#history-page-title").textContent'), 'Technique olympique')
      assert.match(await evaluate('document.querySelector(".workout-history .page-heading .workout-status").textContent'), /Terminée/)
      await click('← Retour à l’historique', '.workout-history')
      assert.equal(await evaluate('document.activeElement.id'), 'history-page-title')
      assert.deepEqual(await storedWorkouts(), before)
    })
    await check('Historique : état sans séance terminée et retour aux séances', async () => {
      await call(workouts => localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts.filter(workout => workout.status === 'planned'))), testWorkouts)
      await command('Page.reload')
      await new Promise(resolve => setTimeout(resolve, 200))
      await waitForApp()
      await click('Historique', '.primary-nav')
      assert.equal(await evaluate('document.querySelector("#history-empty-title").textContent'), 'Aucune séance terminée pour le moment.')
      await click('Retour aux séances', '.workout-history')
      assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Séances')
      await seed()
    })
    const observations = []
    const issues = []
    for (const width of [320, 375, 412, 768, 1024, 1440]) for (const scale of [1, 2]) {
      await check(`Responsive et texte ${scale * 100} % : quatre vues à ${width} px`, async () => {
        for (const [label, scope, name] of [
          ['Records', '.records-catalog', 'records'], ['Records', editor, 'record-dialog'],
          ['Calculer', '.calculator', 'calculer'], ['Historique', '.workout-history-list', 'historique'],
        ]) {
          await seed()
          await viewport(width)
          await click(label, '.primary-nav')
          if (name === 'record-dialog') await openRecord()
          if (scale === 2) await doubleText()
          await call(() => window.scrollTo({ top: 0, behavior: 'instant' }))
          await settle()
          const layout = await inspectLayout(scope)
          observations.push({ name, width, scale, ...layout })
          if (layout.scrollWidth > width || layout.modalOverflow || layout.clipped.length || layout.smallTargets.length || layout.brokenWords.length ||
            layout.navTargets.some(target => target.width < 44 || target.height < 44)) issues.push({ name, width, scale, ...layout })
          if (width < 960) {
            assert.equal(layout.mobileNav, true, 'Navigation mobile fixe conservée')
            assert.ok(Math.abs(layout.navBottom - 960) <= 1)
          }
          await capture(`forge-${name}-${width}-text-${scale * 100}`)
          if (name === 'record-dialog') {
            await key('Tab', 9)
            const focus = await focusState()
            assert.equal(focus.insideModal, true)
            assert.notEqual(focus.outline, 'none')
            assert.ok(focus.outlineWidth >= 2)
            await click('Annuler', editor)
          }
          if (name === 'calculer' && width < 960) {
            assert.equal(await call(() => {
              const rounding = document.querySelector('#calculator-rounding'), result = document.querySelector('.calculator-result')
              return rounding.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false
            }), true, 'L’arrondi précède le résultat dans le DOM')
            assert.equal(await call(() => document.querySelector('#calculator-rounding').getBoundingClientRect().bottom <= document.querySelector('.calculator-result').getBoundingClientRect().top), true)
          }
        }
      })
    }
    await writeFile(join(artifactDirectory, 'forge-responsive-audit.json'), JSON.stringify({ method: 'Tailles de police et interlignes calculés doublés pour chaque élément, viewport CSS inchangé.', observations, issues }, null, 2))
    await check('Accessibilité : aucun débordement, label coupé, texte tronqué ou cible trop petite', async () => {
      assert.deepEqual(issues, [], `Voir forge-responsive-audit.json : ${JSON.stringify(issues)}`)
    })
    await check('Mouvement réduit et navigation basse dégagée au défilement', async () => {
      await seed()
      await viewport(375)
      await click('Historique', '.primary-nav')
      await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
      assert.equal(await evaluate('[...document.querySelectorAll(".nav-button, .history-row button")].every(button => getComputedStyle(button).transitionDuration.split(",").every(duration => parseFloat(duration) <= 0.01))'), true)
      await command('Emulation.setEmulatedMedia', { features: [] })
      await call(() => document.querySelector('.history-journal li:last-child button').focus())
      await key('Tab', 9, 8)
      await key('Tab', 9)
      const focus = await focusState()
      assert.equal(focus.visible, true)
      await capture('forge-navigation-mobile-focus-375')
    })
    // Huit captures de comparaison : page complète sur mobile, navigation fixe au bas de la capture.
    for (const width of [375, 1440]) {
      for (const [label, name] of [['Records', 'records'], ['Calculer', 'calculer'], ['Historique', 'historique']]) {
        await seed()
        await viewport(width)
        await click(label, '.primary-nav')
        await capturePrimary(`forge-final-${name}-${width}`, width === 375)
        if (name === 'records') {
          await openRecord()
          await capturePrimary(`forge-final-record-dialog-${width}`)
          await click('Annuler', editor)
        }
      }
    }
  }
  assert.deepEqual(browserErrors, [])
  console.log(`${passed} parcours Forge réussis, 0 échoué. Captures : ${artifactDirectory}`)
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await command('Browser.close').catch(() => {}); socket.close() }
  browser.kill()
}
