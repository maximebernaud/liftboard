// Test réel de React sans dépendance : Chrome headless + protocole DevTools.
// Le profil est créé dans un dossier temporaire distinct du navigateur habituel.
// Démarrer Vite, puis : node tests/workouts.browser.mjs http://127.0.0.1:5173
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5173'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname), 'Utiliser uniquement un serveur local de test')
const chromePath = process.env.LIFTBOARD_TEST_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const artifactDirectory = await mkdtemp(join(tmpdir(), 'liftboard-j7-test-'))
console.log(`Profil et fichiers de test isolés : ${artifactDirectory}`)
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
let acceptBeforeUnload = false
let beforeUnloadPrompts = 0
let fileChooserPrompts = 0

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

async function reload(discardUnsaved = false) {
  acceptBeforeUnload = discardUnsaved
  await command('Page.reload')
  await new Promise((resolve) => setTimeout(resolve, 200))
  await waitForApp()
  await settle()
  acceptBeforeUnload = false
}

const storedWorkouts = () => evaluate('JSON.parse(localStorage.getItem("liftboard.workouts.v1") ?? "[]")')
const guardActive = () => evaluate('!window.dispatchEvent(new Event("beforeunload", { cancelable: true }))')

async function check(label, action) {
  await action()
  passed++
  console.log(`✓ ${label}`)
}

async function chooseBackup(path) {
  const before = fileChooserPrompts
  // L'activation au clavier ou au pointeur place le focus sur le déclencheur.
  await call(() => [...document.querySelectorAll('.data-backup button')]
    .find(button => button.textContent === 'Restaurer une sauvegarde').focus({ preventScroll: true }))
  await click('Restaurer une sauvegarde', '.data-backup')
  assert.equal(fileChooserPrompts, before + 1, 'Le bouton ouvre le sélecteur natif')
  const { root } = await command('DOM.getDocument')
  const { nodeId } = await command('DOM.querySelector', { nodeId: root.nodeId, selector: '.data-backup input[type=file]' })
  await command('DOM.setFileInputFiles', { nodeId, files: [path] })
  for (let attempt = 0; attempt < 80; attempt++) {
    await settle()
    if (await evaluate('document.querySelector(".data-backup").getAttribute("aria-busy") === "false" && Boolean(document.querySelector(".data-backup dialog[open], .data-backup > .record-error"))')) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('La sélection de sauvegarde ne se termine pas')
}

async function downloadCurrentBackup() {
  // Chrome peut remplacer un téléchargement de même nom : isoler chaque export.
  const downloadDirectory = await mkdtemp(join(artifactDirectory, 'download-'))
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory })
  await click('Exporter mes données', '.data-backup')
  for (let attempt = 0; attempt < 80; attempt++) {
    const filename = (await readdir(downloadDirectory)).find(name => name.endsWith('.json'))
    if (filename) {
      const path = join(downloadDirectory, filename)
      return { path, backup: JSON.parse(await readFile(path, 'utf8')) }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Aucun fichier JSON effectivement téléchargé')
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
      const panel = [...document.querySelectorAll('.workout-sessions')].find(item => item.getClientRects().length).getBoundingClientRect();
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
    if (message.method === 'Page.fileChooserOpened') fileChooserPrompts++
    if (message.method === 'Page.javascriptDialogOpening' && message.params.type === 'beforeunload' && acceptBeforeUnload) {
      beforeUnloadPrompts++
      void command('Page.handleJavaScriptDialog', { accept: true }).catch(error => browserErrors.push(String(error)))
    }
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
  await command('Page.setInterceptFileChooserDialog', { enabled: true })
  await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifactDirectory })
  await waitForApp()

  // J7 : toutes les écritures et tous les téléchargements utilisent ce profil temporaire.
  const j7records = [{ exerciseId: 'snatch', oneRepMaxKg: 82.5 }]
  const j7planned = {
    id: 'j7-planned', title: 'J7 <script>texte seulement</script>', date: '2026-11-04', status: 'planned',
    notes: { before: '  Avant\nDeuxième ligne\n', during: 'Pendant 💪', after: 'Après' },
    exercises: [{ id: 'j7-block', exerciseId: 'snatch', sets: [
      { id: 'j7-set', reps: 3, intensityPct: 73.3, rounding: { mode: 'up', increment: 2.5 }, load: { exactKg: 60.4725, selectedKg: 62.5 }, execution: { completed: true, reps: 2, loadKg: 65 } },
      { id: 'j7-partial', reps: 2, intensityPct: 80, rounding: { mode: 'exact' }, load: null, execution: { completed: false, reps: null, loadKg: null, cleared: { loadKg: true } } },
    ] }],
  }
  const j7completed = { ...structuredClone(j7planned), id: 'j7-completed', status: 'completed' }
  j7completed.exercises[0].sets[0].execution = { completed: true, reps: 0, loadKg: 0 }
  let j7download
  const snapshotBusiness = () => evaluate('({records: localStorage.getItem("liftboard.personal-records.v1"), workouts: localStorage.getItem("liftboard.workouts.v1"), unrelated: localStorage.getItem("j7-unrelated")})')

  await check('J7 : export réellement téléchargé sur navigateur vierge, sans mutation', async () => {
    const before = await snapshotBusiness()
    const { backup } = await downloadCurrentBackup()
    assert.equal(backup.format, 'liftboard.backup')
    assert.equal(backup.version, 1)
    assert.deepEqual(backup.data, { records: [], workouts: [] })
    assert.deepEqual(await snapshotBusiness(), before)
    assert.equal(await evaluate('document.querySelectorAll(".primary-nav button").length'), 4)
  })

  await check('J7 : export fidèle de toutes les données enregistrées, sans autre clé', async () => {
    await call((records, workouts) => {
      localStorage.setItem('liftboard.personal-records.v1', JSON.stringify(records))
      localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts))
      localStorage.setItem('j7-unrelated', 'Ne pas exporter')
    }, j7records, [j7planned, j7completed])
    await reload()
    const before = await snapshotBusiness()
    j7download = await downloadCurrentBackup()
    assert.deepEqual(j7download.backup.data, { records: j7records, workouts: [j7planned, j7completed] })
    assert.equal(JSON.stringify(j7download.backup).includes('Ne pas exporter'), false)
    assert.deepEqual(await snapshotBusiness(), before)
    for (const width of [320, 393, 430, 768, 1440]) await viewport(width, 'j7-backup', width === 320 || width === 1440)
  })

  await check('J7 : sélection native, aperçu complet et annulation sans changement', async () => {
    const before = await snapshotBusiness()
    await chooseBackup(j7download.path)
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".data-backup-summary dd")].map(e => e.textContent)'), ['1', '1', '1'])
    assert.match(await evaluate('document.querySelector(".data-backup dialog").textContent'), /remplacera vos Records et vos séances.*ne peut pas être annulée automatiquement/s)
    assert.equal(await evaluate('document.activeElement.textContent'), 'Annuler')
    for (const width of [320, 393, 430, 768, 1440]) await viewport(width, 'j7-preview', width === 320)
    await click('Annuler', 'dialog[open]')
    assert.deepEqual(await snapshotBusiness(), before)
    assert.equal(await evaluate('document.querySelector(".data-backup dialog")'), null)
    assert.equal(await evaluate('document.activeElement.textContent'), 'Restaurer une sauvegarde')
  })

  await check('J7 : fichiers JSON invalides, version incompatible et données corrompues refusés sans écriture', async () => {
    const before = await snapshotBusiness()
    const duplicate = structuredClone(j7download.backup)
    duplicate.data.workouts.push(duplicate.data.workouts[0])
    for (const [name, content] of [
      ['invalid.json', '{invalide'],
      ['version.json', JSON.stringify({ ...j7download.backup, version: 99 })],
      ['duplicate.json', JSON.stringify(duplicate)],
    ]) {
      const path = join(artifactDirectory, name)
      await writeFile(path, content)
      await chooseBackup(path)
      assert.equal(await evaluate('Boolean(document.querySelector(".data-backup > .record-error"))'), true)
      assert.deepEqual(await snapshotBusiness(), before)
      assert.equal(await evaluate('document.querySelector(".data-backup dialog")'), null)
    }
  })

  await check('J7 : un brouillon de séance reste protégé pendant la confirmation', async () => {
    await click('+ Nouvelle séance')
    await enter('#workout-title', 'Brouillon à préserver')
    await click('← Retour aux séances')
    const before = await snapshotBusiness()
    await chooseBackup(j7download.path)
    await click('Restaurer mes données', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open] .record-error").textContent'), /saisie.*en cours/s)
    assert.deepEqual(await snapshotBusiness(), before)
    await click('Annuler', 'dialog[open]')
    await click('Reprendre le brouillon')
    assert.equal(await evaluate('document.querySelector("#workout-title").value'), 'Brouillon à préserver')
    await click('Annuler', '.workout-editor')
    await click('Abandonner les modifications', 'dialog[open]')
  })

  await check('J7 : la saisie Records masquée est protégée et reste intacte après annulation', async () => {
    await click('Records', '.primary-nav')
    await click('Modifier le record', '.exercise-card')
    await enter('#record-snatch', '999')
    await click('Séances', '.primary-nav')
    const before = await snapshotBusiness()
    await chooseBackup(j7download.path)
    await click('Restaurer mes données', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open] .record-error").textContent'), /saisie.*en cours/s)
    assert.deepEqual(await snapshotBusiness(), before)
    await click('Annuler', 'dialog[open]')
    await click('Records', '.primary-nav')
    assert.equal(await evaluate('document.querySelector("#record-snatch").value'), '999')
    await click('Annuler', '.exercise-card')
    await click('Séances', '.primary-nav')
  })

  await check('J7 : une note historique non enregistrée et masquée bloque le remplacement', async () => {
    await click('Historique', '.primary-nav')
    await click('Consulter la séance', '.workout-history')
    await click('Notes', '.workout-history')
    await evaluate(`window.j7setItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
      if (key === 'liftboard.workouts.v1') throw new Error('Denied'); return window.j7setItem.call(this, key, value)
    }`)
    await enter('.workout-history textarea', 'J7 : note en attente')
    await evaluate('Storage.prototype.setItem = window.j7setItem')
    await click('Séances', '.primary-nav')
    const before = await snapshotBusiness()
    await chooseBackup(j7download.path)
    await click('Restaurer mes données', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open] .record-error").textContent'), /saisie.*en cours/s)
    assert.deepEqual(await snapshotBusiness(), before)
    await click('Annuler', 'dialog[open]')
    await click('Historique', '.primary-nav')
    assert.equal(await evaluate('document.querySelector(".workout-history textarea").value'), 'J7 : note en attente')
    await click('Réessayer', '.workout-history')
    await click('← Retour à la séance', '.workout-history')
    await click('Séances', '.primary-nav')
  })

  await check('J7 : échec partiel de quota, récupération vérifiée puis restauration complète et F5', async () => {
    const before = await snapshotBusiness()
    await chooseBackup(j7download.path)
    await evaluate(`window.j7failOnce = true; window.j7setItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
      if (key === 'liftboard.workouts.v1' && window.j7failOnce) { window.j7failOnce = false; throw new DOMException('Full', 'QuotaExceededError') }
      return window.j7setItem.call(this, key, value)
    }`)
    await click('Restaurer mes données', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open] .record-error").textContent'), /plein.*rétablies/s)
    assert.deepEqual(await snapshotBusiness(), before)
    await evaluate('Storage.prototype.setItem = window.j7setItem')
    await click('Restaurer mes données', 'dialog[open]')
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Mes séances')
    assert.match(await evaluate('document.querySelector(".data-backup [role=status]").textContent'), /restaurées/)
    assert.deepEqual(await storedWorkouts(), j7download.backup.data.workouts)
    await click('Records', '.primary-nav')
    assert.match(await evaluate('document.querySelector(".exercise-record").textContent'), /82,5/)
    await click('Historique', '.primary-nav')
    assert.equal(await evaluate('document.querySelectorAll(".workout-history .workout-session-list li").length'), 1)
    await click('Séances', '.primary-nav')
    await reload()
    assert.deepEqual(await storedWorkouts(), j7download.backup.data.workouts)
    assert.equal(await guardActive(), false)
  })

  await check('J7 : restauration du fichier téléchargé sur un stockage vierge', async () => {
    await call(() => {
      localStorage.removeItem('liftboard.personal-records.v1')
      localStorage.removeItem('liftboard.workouts.v1')
    })
    await reload()
    await chooseBackup(j7download.path)
    await click('Restaurer mes données', 'dialog[open]')
    assert.deepEqual(await storedWorkouts(), [j7planned, j7completed])
    assert.deepEqual(await evaluate('JSON.parse(localStorage.getItem("liftboard.personal-records.v1"))'), j7records)
    assert.equal(await evaluate('localStorage.getItem("j7-unrelated")'), 'Ne pas exporter')
  })

  await check('J7 : remplacement par une sauvegarde vide, avant les régressions J5/J6', async () => {
    const path = join(artifactDirectory, 'empty.json')
    await writeFile(path, JSON.stringify({ ...j7download.backup, data: { records: [], workouts: [] } }))
    await chooseBackup(path)
    await click('Restaurer mes données', 'dialog[open]')
    assert.deepEqual(await storedWorkouts(), [])
    assert.deepEqual(await evaluate('JSON.parse(localStorage.getItem("liftboard.personal-records.v1"))'), [])
    await reload()
  })

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

  const j6Source = {
    id: 'j6-workout', title: 'Suivi technique', date: '2026-11-03', status: 'planned',
    notes: { before: 'Barre proche', during: '', after: '' },
    exercises: [0, 1].map((block) => ({
      id: `j6-block-${block}`, exerciseId: block === 0 ? 'snatch' : 'front-squat',
      sets: (block === 0 ? [0, 1, 2] : [3, 4]).map((index) => ({
        id: `j6-set-${index}`, reps: 3, intensityPct: 80, rounding: { mode: 'exact' },
        load: index === 4 ? null : { exactKg: 80, selectedKg: 80 },
      })),
    })),
  }
  const executionScope = (index) => `#execution-j6-set-${index}-form`
  const executionField = (index, field) => `#execution-j6-set-${index}-${field}`
  const executionAt = async (index) => (await storedWorkouts())[0].exercises.flatMap((block) => block.sets)[index].execution

  await check('J6 : ancienne séance lisible, suivi vide et cinq largeurs accessibles', async () => {
    await call((source) => localStorage.setItem('liftboard.workouts.v1', JSON.stringify([source])), j6Source)
    await reload()
    await click('Ouvrir', '.workout-session-list')
    assert.equal(await evaluate('document.querySelectorAll(".workout-set-summary").length'), 5)
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-set-summary .workout-status")].every(status => status.textContent === "À réaliser")'), true)
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-set-summary .workout-comparison-group:last-child")].every(group => group.textContent === "SOULEVÉAucun résultat enregistré")'), true)
    await click('Démarrer le suivi')
    assert.equal(await guardActive(), false)
    assert.equal(await evaluate('document.querySelector(".workout-execution-progress").textContent'), '0 série réalisée sur 5')
    assert.equal(await evaluate('document.querySelectorAll(".workout-execution-set").length'), 5)
    assert.deepEqual(await storedWorkouts(), [j6Source])
    for (const width of [320, 393, 430, 768, 1440]) {
      await viewport(width, 'tracking-empty', width === 320 || width === 1440)
      assert.ok(await evaluate(`[...document.querySelectorAll('.workout-execution-set input')].every(input => parseFloat(getComputedStyle(input).fontSize) >= 16 && input.labels.length === 1)`))
    }
  })

  await check('J6 : confirmation prévue, saisie différente, curseur stable et notes indépendantes', async () => {
    await click('Série réalisée', executionScope(0))
    assert.deepEqual(await executionAt(0), { completed: true, reps: 3, loadKg: 80 })
    await enter(executionField(1, 'reps'), '2')
    assert.deepEqual(await executionAt(1), { completed: false, reps: 2, loadKg: null })
    await call((selector) => {
      const input = document.querySelector(selector)
      window.j6Input = input
      input.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '77,5')
      input.setSelectionRange(2, 2)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, executionField(1, 'loadKg'))
    await settle()
    assert.deepEqual(await evaluate('({same:document.activeElement === window.j6Input, cursor:window.j6Input.selectionStart})'), { same: true, cursor: 2 })
    assert.deepEqual(await executionAt(1), { completed: false, reps: 2, loadKg: 77.5 })
    await click('Notes de séance')
    await enter('textarea', 'Réception à stabiliser')
    assert.equal(await evaluate('document.querySelectorAll("#workout-page-title").length'), 1)
    await click('← Retour au suivi')
    await click('Série réalisée', executionScope(1))
    assert.deepEqual(await executionAt(1), { completed: true, reps: 2, loadKg: 77.5 })
    const [saved] = await storedWorkouts()
    assert.equal(saved.notes.during, 'Réception à stabiliser')
    assert.deepEqual(saved.exercises[0].sets[1].load, { exactKg: 80, selectedKg: 80 })
    assert.equal(saved.exercises[0].sets[1].reps, 3)
    assert.equal(saved.status, 'planned')
    assert.equal(await evaluate('document.querySelector(".workout-execution-progress").textContent'), '2 séries réalisées sur 5')
    assert.equal(await guardActive(), false)
  })

  await check('J6 : retour Records, rechargement et reprise des résultats enregistrés', async () => {
    const before = await storedWorkouts()
    await click('Records', '.primary-nav')
    await click('Séances', '.primary-nav')
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(1, 'loadKg')), '77,5')
    await click('← Retour à la séance')
    assert.equal(await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent === "Modifier").disabled'), true)
    assert.match(await evaluate('document.querySelector("#workout-program-protection").textContent'), /Programmation verrouillée.*performances/)
    await reload()
    await click('Ouvrir', '.workout-session-list')
    await click('Reprendre le suivi')
    assert.deepEqual(await storedWorkouts(), before)
    assert.equal(await evaluate('document.querySelector(".workout-execution-progress").textContent'), '2 séries réalisées sur 5')
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(1, 'reps')), '2')
  })

  await check('J6 : saisie partielle conservée après rechargement sans réalisation implicite', async () => {
    await enter(executionField(2, 'reps'), '1')
    assert.deepEqual(await executionAt(2), { completed: false, reps: 1, loadKg: null })
    assert.equal(await guardActive(), false)
    await reload()
    assert.match(await evaluate('document.querySelector("#workout-page-title").textContent'), /Suivi · Suivi technique/)
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(2, 'reps')), '1')
    assert.equal(await evaluate('document.querySelector(".workout-execution-progress").textContent'), '2 séries réalisées sur 5')
  })

  await check('J6 : saisie invalide préservée dans les notes et les onglets, sortie protégée', async () => {
    await enter(executionField(2, 'loadKg'), '75,')
    assert.equal(await guardActive(), true)
    assert.deepEqual(await executionAt(2), { completed: false, reps: 1, loadKg: null })
    await click('Série réalisée', executionScope(2))
    assert.equal(await call((selector) => document.querySelector(selector).getAttribute('aria-invalid'), executionField(2, 'loadKg')), 'true')
    assert.equal(await call((selector) => document.activeElement === document.querySelector(selector), executionField(2, 'loadKg')), true)
    await click('Notes de séance')
    await enter('textarea', 'Note indépendante de la saisie invalide')
    await click('← Retour au suivi')
    await click('Calculer', '.primary-nav')
    await click('Séances', '.primary-nav')
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(2, 'loadKg')), '75,')
    await click('← Retour à la séance')
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /seront perdues/)
    await click('Annuler', 'dialog[open]')
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(2, 'loadKg')), '75,')
    await click('Retour aux séances')
    await click('Abandonner la saisie', 'dialog[open]')
    assert.equal(await guardActive(), false)
    await click('Ouvrir', '.workout-session-list')
    await click('Reprendre le suivi')
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(2, 'loadKg')), '')
    assert.equal((await storedWorkouts())[0].notes.during, 'Note indépendante de la saisie invalide')
  })

  await check('J6 : correction explicite et annulation de réalisation sans effacer les performances', async () => {
    await enter(executionField(1, 'reps'), '1')
    await enter(executionField(1, 'loadKg'), '75')
    assert.deepEqual(await executionAt(1), { completed: true, reps: 2, loadKg: 77.5 })
    assert.equal(await guardActive(), true)
    await click('Enregistrer la correction', executionScope(1))
    assert.deepEqual(await executionAt(1), { completed: true, reps: 1, loadKg: 75 })
    assert.equal(await guardActive(), false)
    await enter(executionField(1, 'loadKg'), 'abc')
    await click('Rétablir les valeurs enregistrées', executionScope(1))
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(1, 'loadKg')), '75')
    assert.equal(await guardActive(), false)
    await click('Annuler l’état réalisé', executionScope(1))
    assert.deepEqual(await executionAt(1), { completed: false, reps: 1, loadKg: 75 })
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(1, 'loadKg')), '75')
    assert.equal(await evaluate('document.querySelector(".workout-execution-progress").textContent'), '1 série réalisée sur 5')
    await click('Série réalisée', executionScope(1))
  })

  await check('J6 : écriture et quota en échec, saisie visible, navigation protégée et nouvelle tentative', async () => {
    const before = await storedWorkouts()
    await evaluate(`window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function() { throw new DOMException('Full', 'QuotaExceededError') }`)
    await enter(executionField(3, 'loadKg'), '72,5')
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(3, 'loadKg')), '72,5')
    assert.deepEqual(await storedWorkouts(), before)
    assert.match(await call((scope) => document.querySelector(scope).textContent, executionScope(3)), /Non enregistré.*plein/)
    assert.equal(await guardActive(), true)
    await click('← Retour à la séance')
    await click('Annuler', 'dialog[open]')
    await evaluate('Storage.prototype.setItem = window.originalSetItem')
    await click('Réessayer', executionScope(3))
    assert.deepEqual(await executionAt(3), { completed: false, reps: null, loadKg: 72.5 })
    assert.equal(await guardActive(), false)
    await evaluate(`Storage.prototype.setItem = function() { throw new Error('Write failure') }`)
    await click('Série réalisée', executionScope(3))
    assert.equal((await executionAt(3)).completed, false)
    assert.match(await call((scope) => document.querySelector(scope).textContent, executionScope(3)), /Non enregistré/)
    await evaluate('Storage.prototype.setItem = window.originalSetItem')
    await click('Réessayer', executionScope(3))
    assert.deepEqual(await executionAt(3), { completed: true, reps: 3, loadKg: 72.5 })
    assert.equal(await guardActive(), false)
  })

  await check('fiche commune : prévu, effectué, saisie non confirmée et absence de résultat sans écriture', async () => {
    await click('Annuler l’état réalisé', executionScope(1))
    const before = await storedWorkouts()
    const raw = await evaluate('localStorage.getItem("liftboard.workouts.v1")')
    await click('← Retour à la séance')
    const rows = await call(() => [...document.querySelectorAll('.workout-sessions:not(.workout-history) .workout-set-summary')].map(card => ({
      title: card.querySelector("h3").textContent,
      status: card.querySelector(".workout-status").textContent,
      badges: card.querySelectorAll(".workout-status").length,
      planned: card.querySelector(".workout-comparison-group:first-child").textContent,
      lifted: card.querySelector(".workout-comparison-group:last-child").textContent,
    })))
    assert.equal(rows.length, 5)
    assert.deepEqual(rows.map(row => row.title), ['Série 1', 'Série 2', 'Série 3', 'Série 1', 'Série 2'])
    assert.equal(rows.every(row => row.badges === 1), true)
    assert.equal(rows[0].status, 'Effectuée')
    assert.match(rows[0].planned, /PRÉVU80 kg3 répétitions80 % du 1RM/)
    assert.match(rows[0].lifted, /SOULEVÉ80 kg3 répétitions/)
    assert.equal(rows[1].status, 'À réaliser')
    assert.match(rows[1].lifted, /SOULEVÉ75 kg1 répétition.*Saisie conservée, non confirmée/s)
    assert.equal(rows[4].status, 'À réaliser')
    assert.equal(rows[4].lifted, 'SOULEVÉAucun résultat enregistré')
    assert.doesNotMatch(rows[4].lifted, /0 kg|0 répétition|Non effectuée/)
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".workout-sessions:not(.workout-history) .workout-note-text")].map(p => p.textContent)'),
      Object.values(before[0].notes).map(note => note || 'Aucune note'))
    await evaluate('window.scrollTo(0, 0)')
    for (const width of [320, 393, 430, 1440]) {
      await viewport(width, 'planned-detail', width === 320 || width === 393 || width === 1440)
      assert.equal(await evaluate('[...document.querySelectorAll(".workout-set-summary")].every(card => parseFloat(getComputedStyle(card).borderTopWidth) >= 1 && card.querySelectorAll(".workout-comparison-group").length === 2)'), true)
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".workout-set-comparison")).gridTemplateColumns.split(" ").length'), width === 320 ? 1 : 2)
    }
    assert.equal(await evaluate('localStorage.getItem("liftboard.workouts.v1")'), raw)
    await click('Reprendre le suivi')
    assert.deepEqual(await storedWorkouts(), before)
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(1, 'loadKg')), '75')
    await click('Série réalisée', executionScope(1))
  })

  await check('J6 : charge prévue absente et progression complète sans clôture', async () => {
    await click('Série réalisée', executionScope(4))
    assert.equal(await executionAt(4), undefined)
    assert.match(await call((scope) => document.querySelector(scope).textContent, executionScope(4)), /Renseignez la charge/)
    await enter(executionField(4, 'loadKg'), '20')
    await click('Série réalisée', executionScope(4))
    // Le clavier permet aussi de confirmer une série depuis son champ numérique.
    await call((selector) => document.querySelector(selector).focus(), executionField(2, 'loadKg'))
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Série réalisée')
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await settle()
    assert.equal((await executionAt(2)).completed, true, await call((scope) => document.querySelector(scope).textContent, executionScope(2)))
    const [saved] = await storedWorkouts()
    assert.equal(saved.exercises[1].sets[1].load, null)
    assert.equal(saved.status, 'planned')
    assert.equal(await evaluate('document.querySelector(".workout-execution-progress").textContent'), '5 séries réalisées sur 5')
    for (const width of [320, 393, 430, 768, 1440]) {
      await viewport(width, 'tracking-complete', width === 393)
      const bottom = await evaluate(`(() => {
        const button = [...document.querySelectorAll('.workout-sessions button')].find(button => button.textContent === 'Retour aux séances')
        button.scrollIntoView({block: 'end'})
        const box = button.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom, height: innerHeight }
      })()`)
      assert.ok(bottom.top >= 0 && bottom.bottom <= bottom.height - (width < 960 ? 72 : 0), 'Le dernier contrôle reste accessible au-dessus de la navigation')
    }
  })

  await check('J6 : duplication sans réalisation et programmation calculée avec les Records actuels', async () => {
    const [source] = await storedWorkouts()
    await click('Retour aux séances')
    await click('Records', '.primary-nav')
    await click('Modifier le record', '.exercise-grid > li:nth-child(1)')
    await enter('#record-snatch', '120')
    await click('Enregistrer', '.exercise-grid > li:nth-child(1)')
    await click('Séances', '.primary-nav')
    await click('Dupliquer', '.workout-session-list')
    await click('Enregistrer la séance')
    const [original, copy] = await storedWorkouts()
    assert.deepEqual(original, source)
    assert.ok(copy.exercises.every(block => block.sets.every(set => !('execution' in set))))
    assert.deepEqual(copy.notes, { before: source.notes.before, during: '', after: '' })
    assert.equal(copy.exercises[0].sets[0].load.selectedKg, 96)
    assert.equal(copy.status, 'planned')
    await click('Ouvrir', `[aria-labelledby="card-${copy.id}"]`)
    await click('Démarrer le suivi')
    assert.equal(await evaluate('document.querySelector(".workout-execution-progress").textContent'), '0 série réalisée sur 5')
    await click('Retour aux séances')
    await call((id) => localStorage.setItem('liftboard.workouts.v1', JSON.stringify(JSON.parse(localStorage.getItem('liftboard.workouts.v1')).filter(item => item.id === id))), source.id)
    await reload()
  })

  await check('J6 : résultats obsolètes de la même série refusés sans écrasement', async () => {
    await click('Ouvrir', '.workout-session-list')
    await click('Reprendre le suivi')
    await call(() => {
      const workouts = JSON.parse(localStorage.getItem('liftboard.workouts.v1'))
      workouts[0].exercises[0].sets[0].execution = { completed: true, reps: 1, loadKg: 60 }
      localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts))
    })
    await enter(executionField(0, 'loadKg'), '90')
    await click('Enregistrer la correction', executionScope(0))
    assert.match(await call((scope) => document.querySelector(scope).textContent, executionScope(0)), /ont changé ailleurs/)
    assert.deepEqual(await executionAt(0), { completed: true, reps: 1, loadKg: 60 })
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(0, 'loadKg')), '90')
    await click('← Retour à la séance')
    await click('Abandonner la saisie', 'dialog[open]')
    await click('Reprendre le suivi')
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(0, 'loadKg')), '60')
    await click('Retour aux séances')
  })

  await check('J6 : les notes ne remplacent pas une série saisie si la programmation change ailleurs', async () => {
    await call((source) => localStorage.setItem('liftboard.workouts.v1', JSON.stringify([source])), j6Source)
    await reload()
    await click('Ouvrir', '.workout-session-list')
    await click('Démarrer le suivi')
    await enter(executionField(0, 'loadKg'), '77,')
    await click('Notes de séance')
    await call(() => {
      const workouts = JSON.parse(localStorage.getItem('liftboard.workouts.v1'))
      workouts[0].exercises[0].sets.shift()
      localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts))
    })
    await enter('textarea', 'Programmation modifiée ailleurs')
    await click('← Retour au suivi')
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(0, 'loadKg')), '77,')
    assert.equal(await guardActive(), true)
    await enter(executionField(0, 'loadKg'), '77,5')
    assert.match(await call((scope) => document.querySelector(scope).textContent, executionScope(0)), /changé depuis son ouverture/)
    assert.equal((await storedWorkouts())[0].exercises[0].sets.some(set => set.id === 'j6-set-0'), false)
    assert.equal(await call((selector) => document.querySelector(selector).value, executionField(0, 'loadKg')), '77,5')
    await click('Retour aux séances')
    await click('Abandonner la saisie', 'dialog[open]')
    assert.equal(await guardActive(), false)
  })

  const fixesSource = {
    ...structuredClone(j6Source), id: 'fix-workout', title: 'TEST J6',
    exercises: [{ ...structuredClone(j6Source.exercises[0]), sets: Array.from({ length: 10 }, (_, index) => ({
      ...structuredClone(j6Source.exercises[0].sets[0]), id: `j6-set-${index}`,
    })) }],
  }

  await check('correctifs : libellés explicites, confirmation intacte et restauration directe après F5', async () => {
    await call(source => localStorage.setItem('liftboard.workouts.v1', JSON.stringify([source])), fixesSource)
    await reload()
    await click('Ouvrir', '.workout-session-list')
    assert.match(await evaluate('document.querySelector(".workout-detail-sets li").textContent'), /Série 1.*À réaliser.*PRÉVU.*80 kg.*3 répétitions.*80 % du 1RM.*SOULEVÉ.*Aucun résultat enregistré/s)
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".workout-detail-sets")).listStyleType'), 'none')
    await click('Démarrer le suivi')
    await click('Série réalisée', executionScope(0))
    assert.deepEqual(await executionAt(0), { completed: true, reps: 3, loadKg: 80 })
    const before = await storedWorkouts()
    await reload()
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Suivi · TEST J6')
    assert.equal(await evaluate('document.querySelector(".workout-execution-progress").textContent'), '1 série réalisée sur 10')
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(0, 'loadKg')), '80')
    assert.deepEqual(await storedWorkouts(), before)
    assert.deepEqual(await evaluate('JSON.parse(sessionStorage.getItem("liftboard.navigation.v1"))'), { section: 'sessions', trackingWorkoutId: 'fix-workout' })
  })

  await check('correctifs : flèches depuis les placeholders, précision et champs effacés ou invalides', async () => {
    await evaluate(`window.addEventListener('keydown', event => { window.lastArrowPrevented = event.defaultPrevented })`)
    assert.equal(await arrow(executionField(1, 'loadKg'), 'ArrowUp'), '80,5')
    assert.equal(await arrow(executionField(1, 'loadKg'), 'ArrowDown'), '80')
    assert.equal(await arrow(executionField(1, 'reps'), 'ArrowUp'), '4')
    assert.equal(await arrow(executionField(1, 'reps'), 'ArrowDown'), '3')
    assert.deepEqual(await executionAt(1), { completed: false, reps: 3, loadKg: 80 })
    await enter(executionField(1, 'reps'), '1')
    assert.equal(await arrow(executionField(1, 'reps'), 'ArrowDown'), '1')
    await enter(executionField(1, 'reps'), '3')
    await enter(executionField(1, 'loadKg'), '70.1')
    assert.equal(await arrow(executionField(1, 'loadKg'), 'ArrowUp', 4), '72.1')
    await enter(executionField(1, 'loadKg'), '70,1')
    assert.equal(await arrow(executionField(1, 'loadKg'), 'ArrowDown'), '69,6')
    await enter(executionField(1, 'loadKg'), '0,5')
    assert.equal(await arrow(executionField(1, 'loadKg'), 'ArrowDown'), '0,5')
    await enter(executionField(1, 'loadKg'), '')
    assert.equal(await call(selector => document.querySelector(selector).getAttribute('placeholder'), executionField(1, 'loadKg')), null)
    assert.equal(await arrow(executionField(1, 'loadKg'), 'ArrowUp'), '')
    assert.equal(await evaluate('window.lastArrowPrevented'), false)
    assert.deepEqual(await executionAt(1), { completed: false, reps: 3, loadKg: null, cleared: { loadKg: true } })
    await enter(executionField(1, 'loadKg'), '77,')
    assert.equal(await arrow(executionField(1, 'loadKg'), 'ArrowUp'), '77,')
    assert.equal(await evaluate('window.lastArrowPrevented'), false)
    assert.equal(await guardActive(), true)
    assert.equal(await evaluate('document.querySelector(".workout-execution-progress").textContent'), '1 série réalisée sur 10')
  })

  await check('correctifs : F5 protégé, restauration du seul stockage et effacement explicite durable', async () => {
    await reload(true)
    assert.ok(beforeUnloadPrompts >= 1, 'Chrome a demandé confirmation avant de perdre le texte invalide')
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Suivi · TEST J6')
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(1, 'loadKg')), '')
    assert.equal(await call(selector => document.querySelector(selector).getAttribute('placeholder'), executionField(1, 'loadKg')), null)
    assert.equal(await guardActive(), false)
    await click('Série réalisée', executionScope(1))
    assert.equal((await executionAt(1)).completed, false)
    assert.equal(await call(selector => document.querySelector(selector).getAttribute('aria-invalid'), executionField(1, 'loadKg')), 'true')
    assert.equal(await arrow(executionField(1, 'loadKg'), 'ArrowUp'), '')
    await enter(executionField(1, 'loadKg'), '77,5')
    await click('Série réalisée', executionScope(1))
    assert.deepEqual(await executionAt(1), { completed: true, reps: 3, loadKg: 77.5 })
    await enter(executionField(2, 'reps'), '2')
    await click('Série réalisée', executionScope(2))
    assert.deepEqual(await executionAt(2), { completed: true, reps: 2, loadKg: 80 })
  })

  await check('correctifs : zéro, négatifs et dépassements refusés sans perdre les derniers résultats valides', async () => {
    await enter(executionField(3, 'reps'), '0')
    await click('Série réalisée', executionScope(3))
    assert.equal(await executionAt(3), undefined)
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(3, 'reps')), '0')
    await enter(executionField(3, 'reps'), '2')
    for (const raw of ['0', '-1', 'Infinity', '9007199254740992', '77,']) {
      await enter(executionField(3, 'loadKg'), raw)
      await click('Série réalisée', executionScope(3))
      assert.deepEqual(await executionAt(3), { completed: false, reps: 2, loadKg: null })
      assert.equal(await call(selector => document.querySelector(selector).value, executionField(3, 'loadKg')), raw)
    }
    assert.equal(await guardActive(), true)
    await enter(executionField(3, 'loadKg'), '77,5')
    await click('Série réalisée', executionScope(3))
    assert.deepEqual(await executionAt(3), { completed: true, reps: 2, loadKg: 77.5 })
    assert.equal(await guardActive(), false)
  })

  await check('correctifs : dix sous-cartes lisibles, accessibles et centrées aux cinq largeurs', async () => {
    assert.equal(await evaluate('document.querySelectorAll(".workout-execution-set").length'), 10)
    for (const width of [320, 393, 430, 768, 1440]) {
      await call(scope => document.querySelector(scope).scrollIntoView({ block: 'start' }), executionScope(0))
      await viewport(width, 'tracking-cards', width === 393 || width === 1440)
      assert.ok(await evaluate(`[...document.querySelectorAll('.workout-execution-set')].every(card => {
        const style = getComputedStyle(card)
        return parseFloat(style.borderTopWidth) >= 1 && parseFloat(style.paddingTop) >= 8 &&
          style.backgroundColor !== getComputedStyle(card.parentElement).backgroundColor &&
          [...card.querySelectorAll('input')].every(input => input.labels.length === 1 && parseFloat(getComputedStyle(input).fontSize) >= 16)
      })`))
    }
  })

  await check('correctifs : mêmes onglets Records et Calculer après F5, puis retour volontaire à la liste', async () => {
    const before = await storedWorkouts()
    for (const section of ['Records', 'Calculer']) {
      await click(section, '.primary-nav')
      await reload()
      assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), section)
      await click('Séances', '.primary-nav')
      assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Suivi · TEST J6')
      assert.deepEqual(await storedWorkouts(), before)
    }
    await click('Retour aux séances')
    await reload()
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Mes séances')
    assert.equal(await evaluate('document.querySelectorAll(".workout-execution-set").length'), 0)
    assert.deepEqual(await storedWorkouts(), before)
  })

  await check('correctifs : anciennes réalisations à zéro accessibles, signalées et corrigeables', async () => {
    const legacy = structuredClone(fixesSource)
    legacy.exercises[0].sets[0].execution = { completed: true, reps: 0, loadKg: 0 }
    const other = { ...structuredClone(j6Source), id: 'other-workout', title: 'Autre séance' }
    await call((legacy, other) => localStorage.setItem('liftboard.workouts.v1', JSON.stringify([legacy, other])), legacy, other)
    await reload()
    assert.deepEqual(await storedWorkouts(), [legacy, other])
    await click('Ouvrir', '[aria-labelledby="card-fix-workout"]')
    assert.equal(await evaluate('[...document.querySelectorAll("button")].find(button => button.textContent === "Modifier").disabled'), true)
    assert.equal(await evaluate('document.querySelectorAll("#workout-program-protection").length'), 1)
    await click('Reprendre le suivi')
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(0, 'reps')), '0')
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(0, 'loadKg')), '0')
    assert.match(await call(scope => document.querySelector(scope).textContent, executionScope(0)), /Ancien résultat à corriger/)
    assert.equal(await guardActive(), false)
    await click('Notes de séance')
    await enter('textarea', 'Note malgré ancien zéro')
    await click('← Retour au suivi')
    assert.deepEqual(await executionAt(0), { completed: true, reps: 0, loadKg: 0 })
    await enter(executionField(0, 'reps'), '2')
    await enter(executionField(0, 'loadKg'), '77,5')
    assert.deepEqual(await executionAt(0), { completed: true, reps: 0, loadKg: 0 })
    await click('Enregistrer la correction', executionScope(0))
    const saved = await storedWorkouts()
    assert.deepEqual(saved[0].exercises[0].sets[0].execution, { completed: true, reps: 2, loadKg: 77.5 })
    assert.deepEqual(saved[0].exercises[0].sets[0].load, legacy.exercises[0].sets[0].load)
    assert.equal(saved[0].notes.during, 'Note malgré ancien zéro')
    assert.deepEqual(saved[1], other)
    await reload()
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(0, 'loadKg')), '77,5')
  })

  await check('correctifs : séance supprimée et navigation malformée ramènent à une vue sûre', async () => {
    const [, other] = await storedWorkouts()
    await call(other => localStorage.setItem('liftboard.workouts.v1', JSON.stringify([other])), other)
    await reload()
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Mes séances')
    assert.deepEqual(await storedWorkouts(), [other])
    assert.equal(await evaluate('JSON.parse(sessionStorage.getItem("liftboard.navigation.v1")).trackingWorkoutId'), null)
    for (const raw of ['{broken', JSON.stringify({ section: 'unknown', trackingWorkoutId: other.id }), JSON.stringify({ section: 'sessions', trackingWorkoutId: 'deleted' })]) {
      await call(raw => sessionStorage.setItem('liftboard.navigation.v1', raw), raw)
      await reload()
      assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Mes séances')
      assert.deepEqual(await storedWorkouts(), [other])
    }
  })

  await check('correctifs : sessionStorage inaccessible sans bloquer la navigation ni la sauvegarde', async () => {
    const { identifier } = await command('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('Denied', 'SecurityError') } })`,
    })
    try {
      await reload()
      assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Mes séances')
      await click('Records', '.primary-nav')
      await click('Calculer', '.primary-nav')
      await click('Séances', '.primary-nav')
      await click('Ouvrir', '.workout-session-list')
      await click('Démarrer le suivi')
      await click('Série réalisée', executionScope(0))
      const before = await storedWorkouts()
      await reload()
      assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Mes séances')
      assert.deepEqual(await storedWorkouts(), before)
    } finally {
      await command('Page.removeScriptToEvaluateOnNewDocument', { identifier })
    }
  })

  const historyScope = '.workout-history'
  const historyCards = () => evaluate('[...document.querySelectorAll(".workout-history .workout-session-list h2")].map(item => item.textContent)')
  const historySource = {
    ...structuredClone(j6Source), id: 'history-workout', title: 'Historique J6-B',
    notes: { before: 'Consigne initiale', during: 'Observation réelle', after: '' },
  }

  await check('J6-B : aucune confirmation refuse la clôture, puis saisie invalide protégée', async () => {
    // Retirer de ce document le faux sessionStorage inaccessible du parcours précédent.
    await reload()
    await call(source => {
      localStorage.setItem('liftboard.workouts.v1', JSON.stringify([source]))
      sessionStorage.setItem('liftboard.navigation.v1', JSON.stringify({ section: 'sessions', trackingWorkoutId: null }))
    }, historySource)
    await reload()
    await click('Ouvrir', '.workout-session-list')
    await click('Démarrer le suivi')
    await click('Terminer la séance')
    assert.match(await call(() => document.querySelector('[aria-label="Clôture de la séance"]').textContent), /Aucune performance confirmée/)
    assert.equal(await evaluate('Boolean(document.querySelector("dialog[open]"))'), false)
    await click('Série réalisée', executionScope(0))
    await enter(executionField(0, 'loadKg'), '77,')
    const before = await storedWorkouts()
    await click('Terminer la séance')
    assert.match(await call(() => document.querySelector('[aria-label="Clôture de la séance"]').textContent), /ne sont pas enregistrées/)
    assert.equal(await evaluate('Boolean(document.querySelector("dialog[open]"))'), false)
    assert.deepEqual(await storedWorkouts(), before)
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(0, 'loadKg')), '77,')
    await click('Rétablir les valeurs enregistrées', executionScope(0))
  })

  await check('J6-B : avertissement 3/5, dialogue clavier et annulation sans conséquence', async () => {
    await enter(executionField(1, 'reps'), '2')
    await enter(executionField(1, 'loadKg'), '77,5')
    await click('Série réalisée', executionScope(1))
    await click('Série réalisée', executionScope(2))
    // La quatrième série a une saisie persistée mais jamais confirmée.
    await enter(executionField(3, 'reps'), '1')
    const before = await storedWorkouts()
    await call(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Terminer la séance').focus())
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await settle()
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /3 séries sur 5.*Les 2 autres séries seront considérées comme non effectuées.*saisies non confirmées sont conservées/s)
    assert.equal(await evaluate('document.activeElement.textContent'), 'Annuler')
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await settle()
    assert.equal(await evaluate('Boolean(document.querySelector("dialog[open]"))'), false)
    assert.deepEqual(await storedWorkouts(), before)
    assert.equal(await evaluate('document.activeElement.textContent'), 'Terminer la séance')
  })

  await check('J6-B : quota et écriture refusée ne donnent aucun faux succès, puis nouvelle tentative', async () => {
    const before = await storedWorkouts()
    await click('Terminer la séance')
    await evaluate(`window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
      if (key === 'liftboard.workouts.v1') throw new DOMException('Full', 'QuotaExceededError')
      return window.originalSetItem.call(this, key, value)
    }`)
    await click('Terminer la séance', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /plein/)
    assert.deepEqual(await storedWorkouts(), before)
    assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Séances')
    await evaluate(`Storage.prototype.setItem = function(key, value) {
      if (key === 'liftboard.workouts.v1') throw new Error('Denied')
      return window.originalSetItem.call(this, key, value)
    }`)
    await click('Terminer la séance', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /Impossible d’écrire/)
    assert.deepEqual(await storedWorkouts(), before)
    await evaluate('Storage.prototype.setItem = window.originalSetItem')
    await click('Terminer la séance', 'dialog[open]')
    assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Historique')
    assert.deepEqual(await storedWorkouts(), [{ ...before[0], status: 'completed' }])
    assert.equal(await evaluate('document.querySelector("#history-page-title").textContent'), 'Historique J6-B')
    assert.equal(await evaluate('document.querySelector(".workout-notice").textContent'), 'Séance terminée et enregistrée dans l’historique.')
    await click('← Retour à l’historique', historyScope)
    assert.deepEqual(await historyCards(), ['Historique J6-B'])
    assert.match(await evaluate('document.querySelector(".workout-history .workout-session-list").textContent'), /3 séries réalisées sur 5/)
    assert.equal(await evaluate('document.querySelectorAll(".workout-execution-set").length'), 0)
    assert.deepEqual(await evaluate('JSON.parse(sessionStorage.getItem("liftboard.navigation.v1"))'), { section: 'history', trackingWorkoutId: null })
  })

  await check('J6-B : F5 conserve Historique, retour volontaire aux Séances sans ancien suivi', async () => {
    const before = await storedWorkouts()
    await reload()
    assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Historique')
    assert.deepEqual(await historyCards(), ['Historique J6-B'])
    await click('Séances', '.primary-nav')
    assert.match(await evaluate('document.querySelector(".workout-sessions:not(.workout-history)").textContent'), /Aucune séance planifiée/)
    assert.equal(await evaluate('document.querySelectorAll(".workout-execution-set").length'), 0)
    await reload()
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Mes séances')
    assert.deepEqual(await storedWorkouts(), before)
    await click('Historique', '.primary-nav')
  })

  await check('J6-B : consultation du prévu, réalisé, non confirmé, non réalisé et notes', async () => {
    await click('Consulter la séance', historyScope)
    assert.equal(await evaluate('document.querySelector("#history-page-title").textContent'), 'Historique J6-B')
    const rows = await evaluate('[...document.querySelectorAll(".workout-history .workout-detail-sets li")].map(item => item.textContent)')
    assert.match(rows[1], /Effectuée.*PRÉVU.*80 kg.*3 répétitions.*80 % du 1RM.*SOULEVÉ.*77,5 kg.*2 répétitions/s)
    assert.match(rows[3], /Non confirmée.*SOULEVÉ.*Non renseignée.*1 répétition.*Saisie conservée, non confirmée/s)
    assert.match(rows[4], /Non effectuée.*SOULEVÉ.*Non effectuée/s)
    assert.doesNotMatch(rows[4], /0 kg/)
    const notes = await evaluate('document.querySelector(".workout-history [aria-labelledby=detail-notes-title]").textContent')
    assert.match(notes, /Avant.*Consigne initiale.*Pendant.*Observation réelle.*Après.*Aucune note/s)
    assert.equal(await evaluate('document.querySelectorAll(".workout-history input, .workout-history textarea").length'), 0)
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-history button")].some(item => /suivi|Modifier|Supprimer/.test(item.textContent))'), false)
    for (const width of [320, 393, 430, 768, 960, 1440]) {
      await viewport(width, 'history-detail', width === 320 || width === 393 || width === 1440)
      assert.equal(await evaluate(`[...document.querySelectorAll('.workout-history .workout-set-summary')].every(card => {
        const style = getComputedStyle(card)
        return parseFloat(style.borderTopWidth) >= 1 && parseFloat(style.paddingTop) >= 12 &&
          style.backgroundColor !== getComputedStyle(card.closest('.workout-exercise')).backgroundColor &&
          card.querySelectorAll('h3').length === 1 && card.querySelectorAll('.workout-comparison-group').length === 2 &&
          [...card.querySelectorAll('.workout-comparison-load')].every(load => parseFloat(getComputedStyle(load).fontSize) >= 24)
      })`), true)
      const columns = await evaluate(`getComputedStyle(document.querySelector('.workout-set-comparison')).gridTemplateColumns.split(' ').length`)
      assert.equal(columns, width === 320 ? 1 : 2)
    }
  })

  await check('J6-B : note Après autosauvegardée, conservée après F5 et résultats intacts', async () => {
    const before = (await storedWorkouts())[0]
    await click('Notes', historyScope)
    assert.equal(await evaluate('document.querySelector(".workout-history [aria-pressed=true]").textContent'), 'Après')
    await enter('.workout-history textarea', 'Bilan après clôture\nÀ conserver')
    await click('← Retour à la séance', historyScope)
    assert.deepEqual((await storedWorkouts())[0], { ...before, notes: { ...before.notes, after: 'Bilan après clôture\nÀ conserver' } })
    await reload()
    await click('Consulter la séance', historyScope)
    assert.match(await evaluate('document.querySelector(".workout-history .workout-note-text:last-child").parentElement.parentElement.textContent'), /Bilan après clôture/)
  })

  await check('J6-B : note en échec conservée entre onglets et fermeture protégée', async () => {
    await click('Notes', historyScope)
    const before = await storedWorkouts()
    await evaluate(`window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
      if (key === 'liftboard.workouts.v1') throw new Error('Denied')
      return window.originalSetItem.call(this, key, value)
    }`)
    await enter('.workout-history textarea', 'Bilan non enregistré')
    assert.equal(await guardActive(), true)
    await click('Séances', '.primary-nav')
    await click('Historique', '.primary-nav')
    assert.equal(await evaluate('document.querySelector(".workout-history textarea").value'), 'Bilan non enregistré')
    await click('← Retour à la séance', historyScope)
    await click('Annuler', 'dialog[open]')
    assert.deepEqual(await storedWorkouts(), before)
    await evaluate('Storage.prototype.setItem = window.originalSetItem')
    await click('Réessayer', historyScope)
    assert.equal(await guardActive(), false)
    await click('← Retour à la séance', historyScope)
  })

  await check('J6-B : conflit de notes historiques conservé sans écraser la version récente', async () => {
    await click('Notes', historyScope)
    await call(() => {
      const workouts = JSON.parse(localStorage.getItem('liftboard.workouts.v1'))
      workouts[0].notes.after = 'Version récente ailleurs'
      localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts))
    })
    await enter('.workout-history textarea', 'Ancien formulaire')
    assert.match(await evaluate('document.querySelector(".workout-history .workout-notes-error").textContent'), /note a changé ailleurs/)
    assert.equal((await storedWorkouts())[0].notes.after, 'Version récente ailleurs')
    await click('← Retour à la séance', historyScope)
    await click('Abandonner la saisie', 'dialog[open]')
    assert.equal(await guardActive(), false)
  })

  await check('J6-B : réouverture annulée puis confirmée, sans perte et avec suivi accessible', async () => {
    const before = (await storedWorkouts())[0]
    await click('Réouvrir la séance', historyScope)
    await click('Annuler', 'dialog[open]')
    assert.deepEqual((await storedWorkouts())[0], before)
    assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Historique')
    assert.equal(await evaluate('document.querySelector("#history-page-title").textContent'), before.title)
    await click('Réouvrir la séance', historyScope)
    await evaluate(`window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
      if (key === 'liftboard.workouts.v1') throw new DOMException('Full', 'QuotaExceededError')
      return window.originalSetItem.call(this, key, value)
    }`)
    await click('Réouvrir la séance', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /plein/)
    assert.deepEqual((await storedWorkouts())[0], before)
    assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Historique')
    assert.equal(await evaluate('document.querySelector("#history-page-title").textContent'), before.title)
    await evaluate('Storage.prototype.setItem = window.originalSetItem')
    await click('Réouvrir la séance', 'dialog[open]')
    assert.deepEqual((await storedWorkouts())[0], { ...before, status: 'planned' })
    assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Séances')
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), before.title)
    assert.equal(await evaluate('document.querySelectorAll(".workout-execution-set").length'), 0)
    await click('Historique', '.primary-nav')
    assert.deepEqual(await historyCards(), [])
    await click('Retour aux séances', historyScope)
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), before.title)
    await click('Reprendre le suivi')
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(1, 'loadKg')), '77,5')
    await enter(executionField(1, 'loadKg'), '75')
    await click('Enregistrer la correction', executionScope(1))
    assert.equal((await executionAt(1)).loadKg, 75)
  })

  await check('J6-B : clôture obsolète et séance supprimée ne sont jamais réécrites', async () => {
    await click('Terminer la séance')
    await call(() => {
      const workouts = JSON.parse(localStorage.getItem('liftboard.workouts.v1'))
      workouts[0].exercises[0].sets[0].execution.loadKg = 90
      localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts))
    })
    const before = await storedWorkouts()
    await click('Terminer la séance', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /performances.*changé/s)
    assert.deepEqual(await storedWorkouts(), before)
    await evaluate('localStorage.setItem("liftboard.workouts.v1", "[]")')
    await click('Terminer la séance', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /n’existe plus/)
    assert.deepEqual(await storedWorkouts(), [])
    await click('Annuler', 'dialog[open]')
    await reload()
  })

  await check('J6-B : ancien zéro bloque la clôture avec série identifiée, puis correction et clôture complète', async () => {
    const legacy = structuredClone(historySource)
    legacy.exercises = [legacy.exercises[0]]
    legacy.exercises[0].sets = legacy.exercises[0].sets.slice(0, 3)
    legacy.exercises[0].sets.forEach(set => { set.execution = { completed: true, reps: 3, loadKg: 80 } })
    legacy.exercises[0].sets[1].execution = { completed: true, reps: 0, loadKg: 0 }
    await call(source => localStorage.setItem('liftboard.workouts.v1', JSON.stringify([source])), legacy)
    await reload()
    await click('Ouvrir', '.workout-session-list')
    await click('Reprendre le suivi')
    await click('Terminer la séance')
    assert.match(await call(() => document.querySelector('[aria-label="Clôture de la séance"]').textContent), /Exercice 1 \(Snatch\), série 2/)
    assert.deepEqual(await storedWorkouts(), [legacy])
    await enter(executionField(1, 'reps'), '2')
    await enter(executionField(1, 'loadKg'), '77,5')
    await click('Enregistrer la correction', executionScope(1))
    await click('Terminer la séance')
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /Vous avez réalisé les 3 séries de cette séance/)
    assert.doesNotMatch(await evaluate('document.querySelector("dialog[open]").textContent'), /restantes/)
    await click('Terminer la séance', 'dialog[open]')
    assert.equal((await storedWorkouts())[0].status, 'completed')
    assert.equal(await evaluate('document.querySelector("#history-page-title").textContent'), legacy.title)
    await click('← Retour à l’historique', historyScope)
  })

  await check('J6-B : listes exclusives, tri décroissant stable et filtres exercice ET date', async () => {
    const a = (await storedWorkouts())[0]
    const b = { ...structuredClone(a), id: 'history-b', title: 'Front squat', date: '2026-10-25' }
    b.exercises[0].exerciseId = 'front-squat'
    const c = { ...structuredClone(a), id: 'history-c', title: 'Snatch même date', date: '2026-10-25' }
    const planned = { ...structuredClone(a), id: 'planned-only', title: 'Seulement planifiée', status: 'planned' }
    await call(workouts => localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts)), [b, c, a, planned])
    await click('Séances', '.primary-nav')
    assert.equal(await evaluate('document.querySelector(".workout-sessions:not(.workout-history) .workout-session-list h2").textContent'), planned.title)
    await click('Historique', '.primary-nav')
    assert.deepEqual(await historyCards(), [a.title, b.title, c.title])
    for (const width of [320, 393, 430, 768, 960, 1440]) {
      await viewport(width, 'history-list', width === 393 || width === 1440)
      assert.equal(await evaluate('[...document.querySelectorAll(".workout-history input, .workout-history select")].every(field => field.labels.length === 1 && parseFloat(getComputedStyle(field).fontSize) >= 16)'), true)
    }
    await select('#history-exercise', 'snatch')
    assert.deepEqual(await historyCards(), [a.title, c.title])
    await enter('#history-date', '2026-10-25')
    assert.deepEqual(await historyCards(), [c.title])
    await click('Consulter la séance', historyScope)
    await click('← Retour à l’historique', historyScope)
    await click('Records', '.primary-nav')
    await click('Historique', '.primary-nav')
    assert.equal(await evaluate('document.querySelector("#history-date").value'), '2026-10-25')
    assert.deepEqual(await historyCards(), [c.title])
    await click('Réinitialiser les filtres', historyScope)
    await enter('#history-date', '2026-10-25')
    assert.deepEqual(await historyCards(), [b.title, c.title])
    await select('#history-exercise', 'back-squat')
    assert.match(await evaluate('document.querySelector(".workout-history .empty-state").textContent'), /Aucune séance ne correspond à ces filtres/)
    await click('Effacer les filtres', historyScope)
    assert.deepEqual(await historyCards(), [a.title, b.title, c.title])
  })

  await check('J6-B : ancienne réalisation terminée invalide reste visible sans transformation', async () => {
    const legacy = { ...structuredClone(historySource), status: 'completed' }
    legacy.exercises[0].sets[0].execution = { completed: true, reps: 0, loadKg: 0 }
    await call(source => localStorage.setItem('liftboard.workouts.v1', JSON.stringify([source])), legacy)
    await reload()
    await click('Consulter la séance', historyScope)
    const row = await evaluate('document.querySelector(".workout-history .workout-detail-sets li").textContent')
    assert.match(row, /À corriger.*SOULEVÉ.*0 kg.*0 répétition.*Ancien résultat à corriger/s)
    assert.deepEqual(await storedWorkouts(), [legacy])
    await click('← Retour à l’historique', historyScope)
  })

  await check('J6-B : statut changé ailleurs bloque immédiatement un ancien suivi après notification', async () => {
    await call(source => {
      localStorage.setItem('liftboard.workouts.v1', JSON.stringify([source]))
      sessionStorage.setItem('liftboard.navigation.v1', JSON.stringify({ section: 'sessions', trackingWorkoutId: source.id }))
    }, historySource)
    await reload()
    await call(() => {
      const workouts = JSON.parse(localStorage.getItem('liftboard.workouts.v1'))
      workouts[0].status = 'completed'
      localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts))
      window.dispatchEvent(new StorageEvent('storage', { key: 'liftboard.workouts.v1' }))
    })
    await settle()
    assert.match(await evaluate('document.querySelector("#workout-page-title").textContent'), /indisponible/)
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-execution-set input")].some(input => input.getClientRects().length && !input.matches(":disabled"))'), false)
    assert.equal(await evaluate('JSON.parse(sessionStorage.getItem("liftboard.navigation.v1")).trackingWorkoutId'), null)
    await reload()
    assert.equal(await evaluate('document.querySelectorAll(".workout-execution-set").length'), 0)
  })

  await check('UX : référence 1RM unique, libellés explicites, arrondis et record absent', async () => {
    await call(() => {
      localStorage.setItem('liftboard.workouts.v1', '[]')
      localStorage.setItem('liftboard.personal-records.v1', JSON.stringify([{ exerciseId: 'snatch', oneRepMaxKg: 100 }]))
      sessionStorage.setItem('liftboard.navigation.v1', JSON.stringify({ section: 'sessions', trackingWorkoutId: null }))
    })
    await reload()
    await click('+ Nouvelle séance')
    await enter('#workout-title', 'UX création')
    await click('+ Ajouter un exercice')
    await enter('.workout-exercise input[id$="-reps"]', '2')
    await enter('.workout-exercise input[id$="-intensity"]', '83,3')
    await select('.workout-exercise select[id$="-rounding"]', 'down-2.5')
    for (let index = 0; index < 4; index++) await click('+ Ajouter une série')
    assert.equal(await evaluate('document.querySelectorAll(".workout-record-context strong").length'), 1)
    assert.equal(await evaluate('document.querySelector(".workout-record-context").textContent.trim()'), 'Record actuel (1RM) : 100 kg')
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-set label")].filter(label => label.textContent === "Intensité (% du 1RM)").length'), 5)
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-set label")].filter(label => label.textContent === "Ajustement de la charge").length'), 5)
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-set .workout-load")].every(load => /Charge prévue.*82,5 kg.*Charge exacte calculée : 83,3 kg/.test(load.textContent))'), true)
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-editor > .record-hint")].filter(p => p.textContent === "La charge est calculée automatiquement à partir du 1RM et de l’intensité choisie.").length'), 1)
    assert.deepEqual(await evaluate('[...document.querySelector(".workout-set select").options].map(option => option.textContent)'), [
      'Sans arrondi', 'Vers le bas · 1 kg', 'Vers le haut · 1 kg',
      'Vers le bas · 2,5 kg', 'Vers le haut · 2,5 kg',
      'Vers le bas · 5 kg', 'Vers le haut · 5 kg',
    ])
    await select('.workout-field > select:not([id$="-rounding"])', 'front-squat')
    assert.match(await evaluate('document.querySelector(".workout-record-context").textContent'), /Record à renseigner/)
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-load > strong")].every(load => load.textContent === "—")'), true)
    await select('.workout-field > select:not([id$="-rounding"])', 'snatch')
    await viewport(320, 'ux-editor', true)
    await click('Enregistrer la séance')
    assert.equal((await storedWorkouts())[0].exercises[0].sets.length, 5)
    assert.equal((await storedWorkouts())[0].exercises[0].sets[0].load.selectedKg, 82.5)
  })

  await check('UX : changement de 1RM sans référence trompeuse ni recalcul du suivi et de l’historique', async () => {
    const before = (await storedWorkouts())[0]
    await call(() => localStorage.setItem('liftboard.personal-records.v1', JSON.stringify([{ exerciseId: 'snatch', oneRepMaxKg: 110 }])))
    await reload()
    await click('Ouvrir', '.workout-session-list')
    await click('Modifier')
    assert.match(await evaluate('document.querySelector(".workout-record-context").textContent'), /Record actuel \(1RM\) : 110 kg.*charges déjà enregistrées restent figées/s)
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-load > strong")].every(load => load.textContent === "82,5 kg")'), true)
    await click('Annuler')
    await click('Démarrer le suivi')
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-execution-planned")].every(p => /83,3 % du 1RM.*82,5 kg/.test(p.textContent))'), true)
    assert.equal(await evaluate('document.querySelectorAll(".workout-record-context").length'), 0)
    const form = await evaluate('document.querySelector(".workout-execution-set").id')
    await click('Série réalisée', `#${form}`)
    await click('Terminer la séance')
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /1 série sur 5.*Les 4 autres séries/s)
    await click('Terminer la séance', 'dialog[open]')
    assert.equal(await evaluate('document.querySelector("#history-page-title").textContent'), before.title)
    assert.equal(await evaluate('[...document.querySelectorAll(".workout-history .workout-comparison-planned")].every(load => load.textContent === "82,5 kg")'), true)
    assert.equal(await evaluate('document.querySelector(".workout-history").textContent.includes("110 kg")'), false)
    assert.deepEqual((await storedWorkouts())[0].exercises[0].sets.map(set => set.load), before.exercises[0].sets.map(set => set.load))
  })

  await check('UX : clôture à une série restante visible malgré filtres et note historique en attente', async () => {
    const old = { ...structuredClone(historySource), id: 'ux-old', title: 'Ancienne séance', status: 'completed', date: '2026-10-25' }
    old.exercises = [{ ...old.exercises[0], exerciseId: 'front-squat' }]
    const planned = { ...structuredClone(historySource), id: 'ux-new', title: 'Séance à retrouver' }
    planned.exercises = [planned.exercises[0]]
    planned.exercises[0].sets[0].execution = { completed: true, reps: 2, loadKg: 77.5 }
    planned.exercises[0].sets[1].execution = { completed: true, reps: 3, loadKg: 80 }
    await call(workouts => {
      localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts))
      sessionStorage.setItem('liftboard.navigation.v1', JSON.stringify({ section: 'history', trackingWorkoutId: null }))
    }, [old, planned])
    await reload()
    await select('#history-exercise', 'front-squat')
    await enter('#history-date', old.date)
    await click('Séances', '.primary-nav')
    await click('Historique', '.primary-nav')
    assert.equal(await evaluate('document.querySelector("#history-date").value'), old.date)
    assert.equal(await evaluate('document.querySelector("#history-exercise").value'), 'front-squat')
    await click('Consulter la séance', historyScope)
    await click('Notes', historyScope)
    await evaluate(`window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
      if (key === 'liftboard.workouts.v1') throw new Error('Denied')
      return window.originalSetItem.call(this, key, value)
    }`)
    await enter('.workout-history textarea', 'Note à préserver malgré la clôture')
    await evaluate('Storage.prototype.setItem = window.originalSetItem')
    await click('Séances', '.primary-nav')
    await click('Ouvrir', '.workout-session-list')
    await click('Reprendre le suivi')
    await click('Terminer la séance')
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /2 séries sur 3\. La dernière série sera considérée comme non effectuée/)
    assert.doesNotMatch(await evaluate('document.querySelector("dialog[open]").textContent'), /Les 1 séries/)
    const before = await storedWorkouts()
    await click('Annuler', 'dialog[open]')
    assert.deepEqual(await storedWorkouts(), before)
    assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Séances')
    await click('Terminer la séance')
    await click('Terminer la séance', 'dialog[open]')
    assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Historique')
    assert.equal(await evaluate('document.querySelector("#history-page-title").textContent'), planned.title)
    assert.equal(await guardActive(), true)
    assert.deepEqual(await storedWorkouts(), [old, { ...planned, status: 'completed' }])
    await click('← Retour à l’historique', historyScope)
    assert.deepEqual(await historyCards(), [planned.title, old.title])
    assert.equal(await evaluate('document.querySelector("#history-exercise").value'), '')
    assert.equal(await evaluate('document.querySelector("#history-date").value'), '')
    await click('Reprendre les notes en attente', historyScope)
    assert.equal(await evaluate('document.querySelector(".workout-history textarea").value'), 'Note à préserver malgré la clôture')
    assert.equal(await evaluate('document.activeElement === document.querySelector(".workout-history textarea")'), true)
    await click('← Retour à la séance', historyScope)
    await click('Annuler', 'dialog[open]')
    await click('Réessayer', historyScope)
    await click('← Retour à la séance', historyScope)
    assert.equal(await guardActive(), false)
    assert.equal((await storedWorkouts())[0].notes.after, 'Note à préserver malgré la clôture')
    assert.deepEqual((await storedWorkouts())[1].exercises, planned.exercises)
    await click('← Retour à l’historique', historyScope)
  })

  await check('UX : bouton Consulter contrasté, clavier, six largeurs et reflow équivalent à 200 %', async () => {
    for (const width of [320, 393, 430, 768, 960, 1440]) await viewport(width, 'ux-history-list', width === 393 || width === 1440)
    const style = await evaluate(`(() => {
      const button = document.querySelector('.workout-consult'), style = getComputedStyle(button)
      button.focus({ preventScroll: true })
      return { color: style.color, border: style.borderTopColor, background: style.backgroundColor }
    })()`)
    assert.deepEqual(style, { color: 'rgb(212, 164, 90)', border: 'rgb(212, 164, 90)', background: 'rgb(27, 31, 32)' })
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    assert.equal(await evaluate('document.activeElement.classList.contains("workout-consult")'), true)
    assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'solid')
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await settle()
    assert.equal(await evaluate('document.querySelector("#history-page-title").textContent'), 'Ancienne séance')
    // 1440 × 844 pixels physiques avec une surface CSS divisée par deux : reflow à 200 %.
    await command('Emulation.setDeviceMetricsOverride', { width: 720, height: 422, deviceScaleFactor: 2, mobile: false })
    await settle()
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true)
    await call(() => [...document.querySelectorAll('.workout-history button')].find(button => button.textContent === 'Réouvrir la séance').scrollIntoView({ block: 'end' }))
    assert.equal(await evaluate(`(() => {
      const button = [...document.querySelectorAll('.workout-history button')].find(b => b.textContent === 'Réouvrir la séance').getBoundingClientRect()
      return button.top >= 0 && button.bottom <= document.querySelector('.primary-nav').getBoundingClientRect().top
    })()`), true)
    const screenshot = await command('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(artifactDirectory, 'ux-history-reflow-200.png'), Buffer.from(screenshot.data, 'base64'))
    await viewport(393, 'ux-history-final', true)
    await click('← Retour à l’historique', historyScope)
  })

  await check('réouverture ciblée : fiche directe par ID, retour liste, filtres conservés et F5 cohérent', async () => {
    const before = await storedWorkouts()
    const target = before.find(workout => workout.id === 'ux-new')
    assert.equal(target.exercises[0].sets.filter(set => set.execution?.completed).length, 2)
    assert.equal(target.exercises[0].sets.length, 3)
    await select('#history-exercise', 'snatch')
    await enter('#history-date', target.date)
    await click('Consulter la séance', '[aria-labelledby="history-card-ux-new"]')
    const historyValues = await evaluate('[...document.querySelectorAll(".workout-history .workout-set-summary")].slice(0, 2).map(card => card.querySelector(".workout-set-comparison").textContent)')
    await click('Réouvrir la séance', historyScope)
    await click('Réouvrir la séance', 'dialog[open]')
    const after = before.map(workout => workout.id === target.id ? { ...workout, status: 'planned' } : workout)
    assert.deepEqual(await storedWorkouts(), after)
    assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Séances')
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), target.title)
    assert.equal(await evaluate('document.querySelectorAll(".workout-execution-set").length'), 0)
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".workout-sessions:not(.workout-history) .workout-set-summary .workout-status")].map(status => status.textContent)'), ['Effectuée', 'Effectuée', 'À réaliser'])
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".workout-sessions:not(.workout-history) .workout-set-summary")].slice(0, 2).map(card => card.querySelector(".workout-set-comparison").textContent)'), historyValues)
    assert.match(await evaluate('document.querySelector(".workout-sessions:not(.workout-history)").textContent'), /Reprendre le suivi.*Notes/s)
    assert.deepEqual(await evaluate('JSON.parse(sessionStorage.getItem("liftboard.navigation.v1"))'), { section: 'sessions', trackingWorkoutId: null })
    await click('Historique', '.primary-nav')
    assert.equal(await evaluate('document.querySelector("#history-exercise").value'), 'snatch')
    assert.equal(await evaluate('document.querySelector("#history-date").value'), target.date)
    assert.deepEqual(await historyCards(), [])
    await click('Séances', '.primary-nav')
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), target.title)
    await click('← Retour aux séances')
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Mes séances')
    assert.equal(await evaluate('document.querySelector("[aria-labelledby=card-ux-new] h2").textContent'), target.title)
    await click('Ouvrir', '[aria-labelledby="card-ux-new"]')
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), target.title)
    await reload()
    // Les fiches ne sont pas persistées : conserver le retour à la liste existant.
    assert.equal(await evaluate('document.querySelector("#workout-page-title").textContent'), 'Mes séances')
    assert.deepEqual(await storedWorkouts(), after)
    await click('Ouvrir', '[aria-labelledby="card-ux-new"]')
    await click('Reprendre le suivi')
    assert.equal(await evaluate('document.querySelector(".workout-execution-progress").textContent'), '2 séries réalisées sur 3')
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(0, 'loadKg')), '77,5')
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(1, 'loadKg')), '80')
    assert.equal(await call(selector => document.querySelector(selector).value, executionField(2, 'loadKg')), '')
    assert.equal((await storedWorkouts()).find(workout => workout.id === target.id).exercises[0].sets[2].execution, undefined)
    await click('Retour aux séances')
  })

  await check('réouverture obsolète ou supprimée : aucune fiche de succès et aucune restauration', async () => {
    await click('Historique', '.primary-nav')
    await select('#history-exercise', '')
    await enter('#history-date', '')
    await click('Consulter la séance', '[aria-labelledby="history-card-ux-old"]')
    await click('Réouvrir la séance', historyScope)
    await call(() => {
      const workouts = JSON.parse(localStorage.getItem('liftboard.workouts.v1'))
      workouts.find(workout => workout.id === 'ux-old').exercises[0].sets[0].execution = { completed: true, reps: 2, loadKg: 70 }
      localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts))
    })
    const before = await storedWorkouts()
    await click('Réouvrir la séance', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /performances.*changé/s)
    assert.deepEqual(await storedWorkouts(), before)
    assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Historique')
    assert.equal(await evaluate('document.querySelector("#history-page-title").textContent'), 'Ancienne séance')
    await call(() => localStorage.setItem('liftboard.workouts.v1', JSON.stringify(JSON.parse(localStorage.getItem('liftboard.workouts.v1')).filter(workout => workout.id !== 'ux-old'))))
    const remaining = await storedWorkouts()
    await click('Réouvrir la séance', 'dialog[open]')
    assert.match(await evaluate('document.querySelector("dialog[open]").textContent'), /n’existe plus/)
    assert.deepEqual(await storedWorkouts(), remaining)
    assert.equal(await evaluate('document.querySelector(".primary-nav [aria-current=page]").textContent.trim()'), 'Historique')
    await click('Annuler', 'dialog[open]')
    await click('← Retour à l’historique', historyScope)
  })

  await check('J6-B : stockage inaccessible et corrompu distincts de l’historique vide, sans écriture', async () => {
    await click('Historique', '.primary-nav')
    await evaluate(`window.originalGetItem = Storage.prototype.getItem; Storage.prototype.getItem = function(key) {
      if (key === 'liftboard.workouts.v1') throw new Error('Denied')
      return window.originalGetItem.call(this, key)
    }`)
    await click('Séances', '.primary-nav')
    await click('Historique', '.primary-nav')
    assert.match(await evaluate('document.querySelector(".workout-history .records-storage-error").textContent'), /Impossible de lire/)
    assert.equal(await evaluate('document.querySelectorAll(".workout-history .empty-state").length'), 0)
    await evaluate('Storage.prototype.getItem = window.originalGetItem; localStorage.setItem("liftboard.workouts.v1", "{corrompu")')
    await click('Réessayer la lecture', historyScope)
    assert.match(await evaluate('document.querySelector(".workout-history .records-storage-error").textContent'), /illisibles/)
    assert.equal(await evaluate('localStorage.getItem("liftboard.workouts.v1")'), '{corrompu')
    await click('Séances', '.primary-nav')
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
