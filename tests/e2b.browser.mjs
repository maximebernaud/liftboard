// E2-B : parcours métier réels, profils temporaires et captures exclusivement isolées.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBrowser } from './helpers/browser.mjs'
import { exercisePickerActions } from './helpers/exercisePicker.mjs'

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5182'
const artifacts = await mkdtemp(join(tmpdir(), 'liftboard-e2b-parcours-'))
console.log(`Artefacts E2-B et profils isolés : ${artifacts}`)
const browser = await startBrowser(baseUrl, artifacts)
const { call, click, enter, reload, settle, viewport, capture, command } = browser
const { addExercise, chooseExercise } = exercisePickerActions(browser)
const checks = []
let restorationBrowser
const raw = () => call(() => ({ records: JSON.parse(localStorage.getItem('liftboard.personal-records.v1') ?? '[]'), workouts: JSON.parse(localStorage.getItem('liftboard.workouts.v1') ?? '[]') }))
const check = async (name, action) => { await action(); checks.push(name); console.log(`OK : ${name}`) }
async function select(selector, value) {
  assert.equal(await call((selector, value) => {
    const field = document.querySelector(selector)
    if (!field || !field.getClientRects().length) return false
    field.value = value
    field.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, selector, value), true, selector)
  await settle()
}
async function waitFor(predicate, target = browser) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await target.call(predicate)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Attente dépassée : ${predicate}`)
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
async function scaleText(scale) {
  await call(scale => {
    for (const saved of window.e2bScaled ?? []) if (saved.element.isConnected) {
      saved.element.style.fontSize = saved.fontSize
      saved.element.style.lineHeight = saved.lineHeight
    }
    window.e2bScaled = []
    if (scale === 1) return
    const entries = [...document.querySelectorAll('body, body *')].filter(element => element instanceof HTMLElement)
      .map(element => ({ element, fontSize: element.style.fontSize, lineHeight: element.style.lineHeight,
        computedFont: parseFloat(getComputedStyle(element).fontSize), computedLine: parseFloat(getComputedStyle(element).lineHeight) }))
    for (const entry of entries) {
      entry.element.style.fontSize = `${entry.computedFont * scale}px`
      if (Number.isFinite(entry.computedLine)) entry.element.style.lineHeight = `${entry.computedLine * scale}px`
    }
    window.e2bScaled = entries
  }, scale)
  await settle()
}
async function responsive(name) {
  for (const width of [320, 375, 412, 768, 1024, 1440]) for (const scale of [1, 2]) {
    await viewport(width)
    await scaleText(scale)
    const layout = await call(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      unlabeled: [...document.querySelectorAll('input,select,textarea')].filter(field => field.getClientRects().length && !field.labels?.length && !field.getAttribute('aria-label')).map(field => field.id),
      small: [...document.querySelectorAll('button,input,select,textarea')].filter(field => field.getClientRects().length)
        .filter(field => field.getBoundingClientRect().height < 43 || field.getBoundingClientRect().width < 43).map(field => field.id || field.textContent) }))
    assert.ok(layout.documentWidth <= width + 1, `${name} ${width}/${scale} : débordement ${JSON.stringify(layout)}`)
    assert.deepEqual(layout.unlabeled, [], `${name} : labels`)
    assert.deepEqual(layout.small, [], `${name} : cibles tactiles`)
    if (name === '12-editeur-mobile') {
      await call(() => {
        const field = document.querySelector('input[id$="-manual-load"]')
        field.focus({ preventScroll: true })
        field.scrollIntoView({ block: 'center' })
      })
      await settle()
      const focused = await call(() => {
        const bounds = document.activeElement.getBoundingClientRect()
        const navigation = document.querySelector('.primary-nav').getBoundingClientRect()
        return { top: bounds.top, bottom: bounds.bottom, limit: innerWidth < 960 ? navigation.top : innerHeight }
      })
      assert.ok(focused.top >= 0 && focused.bottom <= focused.limit, `${name} : champ au-dessus de la navigation ${JSON.stringify(focused)}`)
    } else if (name === '13-suivi-mobile') {
      await call(() => document.querySelector('.workout-execution-set:nth-of-type(2)').scrollIntoView({ block: 'start' }))
      await settle()
    }
    if (width === 375 || width === 1440) await capture(`${name}-${width}-texte-${scale * 100}`)
    checks.push(`${name} ${width}px texte ${scale * 100}%`)
    await scaleText(1)
  }
  await viewport(1440)
}
async function importFile(target, path) {
  await target.command('Page.setInterceptFileChooserDialog', { enabled: true })
  await target.click('Récupérer mes données', '.data-backup')
  const { root } = await target.command('DOM.getDocument')
  const { nodeId } = await target.command('DOM.querySelector', { nodeId: root.nodeId, selector: '.data-backup input[type=file]' })
  await target.command('DOM.setFileInputFiles', { nodeId, files: [path] })
  await waitFor(() => Boolean(document.querySelector('.data-backup dialog[open]') || document.querySelector('.data-backup > .record-error')), target)
}
try {
  await call(() => { localStorage.clear(); sessionStorage.clear() })
  await reload()
  await viewport(1440)
  await check('Records : ajout réel de Clean, quatre fiches historiques et aucune fiche fictive', async () => {
    await click('Records', '.primary-nav')
    assert.equal(await call(() => document.querySelectorAll('.exercise-card').length), 4)
    await capture('01-records-historiques')
    await click('Ajouter un mouvement')
    await chooseExercise('clean')
    await waitFor(() => Boolean(document.querySelector('#record-clean-form')))
    await enter('#record-clean', '100')
    await capture('02-ajout-clean')
    await click('Enregistrer', '.record-editor-dialog[open]')
    assert.deepEqual((await raw()).records, [{ exerciseId: 'clean', oneRepMaxKg: 100 }])
    await reload()
    assert.equal(await call(() => document.querySelectorAll('.exercise-card').length), 5)
    assert.match(await call(() => document.querySelector('#record-clean-row').textContent), /100 kg/)
    assert.equal(await call(() => document.querySelector('#calculator-exercise').options.length), 4)
    await capture('03-records-clean-enregistre')
    await click('Ajouter un mouvement')
    await chooseExercise('clean')
    await waitFor(() => Boolean(document.querySelector('#record-clean-form')))
    assert.equal(await call(() => document.querySelectorAll('.exercise-card').length), 5)
    assert.equal(await call(() => document.querySelector('#record-clean').value), '100')
    await click('Annuler', '.record-editor-dialog[open]')
    assert.deepEqual((await raw()).records, [{ exerciseId: 'clean', oneRepMaxKg: 100 }])
    await responsive('11-records-mobile')
  })
  await check('Programmation : choix explicite de Clean et méthodes différentes par série', async () => {
    await click('Séances', '.primary-nav')
    await click('+ Nouvelle séance')
    await enter('#workout-title', 'E2-B · Clean Pull')
    await addExercise('clean-pull')
    await enter('.workout-set input[id$="-reps"]', '3')
    await select('.workout-set select[id$="-method"]', 'percentage')
    assert.equal(await call(() => document.querySelector('select[id$="-reference"]').value), '')
    await select('select[id$="-reference"]', 'clean')
    await enter('.workout-set input[id$="-intensity"]', '110')
    assert.match(await call(() => document.querySelector('.workout-load').textContent), /110 kg/)
    await capture('04-editeur-reference-clean')
    await capture('05-serie-110-pourcent')
    await select('.workout-set select[id$="-method"]', 'manual')
    assert.equal(await call(() => document.querySelector('input[id$="-manual-load"]').value), '')
    await enter('input[id$="-manual-load"]', '88,')
    await select('.workout-set select[id$="-method"]', 'percentage')
    assert.equal(await call(() => document.querySelector('input[id$="-intensity"]').value), '110')
    await select('.workout-set select[id$="-method"]', 'manual')
    assert.equal(await call(() => document.querySelector('input[id$="-manual-load"]').value), '88,')
    await select('.workout-set select[id$="-method"]', 'percentage')
    await click('+ Ajouter une série')
    await enter('.workout-set:nth-child(2) input[id$="-reps"]', '3')
    await select('.workout-set:nth-child(2) select[id$="-method"]', 'manual')
    await enter('.workout-set:nth-child(2) input[id$="-manual-load"]', '90')
    await click('Replier la série 2 de l’exercice 1')
    assert.equal(await call(() => document.querySelector('.workout-set:nth-child(2) .workout-set-prescription').textContent), '3 rép. · Charge libre')
    assert.match(await call(() => document.querySelector('.workout-set:first-child .workout-set-prescription').textContent), /110 % de Clean/)
    await click('Modifier la série 2 de l’exercice 1')
    await capture('06-serie-90-kg-libres')
    await capture('07-bloc-methodes-mixtes')
    await responsive('12-editeur-mobile')
    await click('Enregistrer la séance')
    const workout = (await raw()).workouts[0]
    const [percentage, manual] = workout.exercises[0].sets
    assert.equal(percentage.loading.reference.exerciseId, 'clean')
    assert.equal(percentage.loading.reference.oneRepMaxKg, 100)
    assert.deepEqual(percentage.loading.load, { exactKg: 110, selectedKg: 110 })
    assert.deepEqual(manual.loading, { method: 'manual', loadKg: 90 })
    assert.equal(JSON.stringify(workout).includes('manualInput'), false)
    await reload()
    assert.deepEqual((await raw()).workouts[0], workout)
  })
  await check('Suivi : prévu 110/90 kg, réalisé 110/87 kg, conflit réel entre deux onglets', async () => {
    await click('Ouvrir', '.workout-session-list')
    await click('Démarrer le suivi')
    await click('Confirmer tel que prévu : série 1')
    await click('Ajuster la série 2')
    await enter('.workout-execution-set:nth-of-type(2) input[id$="-loadKg"]', '87')
    await click('Série réalisée', '.workout-execution-set:nth-of-type(2)')
    let sets = (await raw()).workouts[0].exercises[0].sets
    assert.deepEqual(sets.map(set => set.execution), [{ completed: true, reps: 3, loadKg: 110 }, { completed: true, reps: 3, loadKg: 87 }])
    await capture('08-suivi-prevu-realise')
    await responsive('13-suivi-mobile')
    await click('Modifier la série 2')
    await enter('.workout-execution-set:nth-of-type(2) input[id$="-loadKg"]', '86')
    await peerWrite(`(() => { const workouts = JSON.parse(localStorage.getItem('liftboard.workouts.v1')); workouts[0].exercises[0].sets[1].execution.loadKg = 88; localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts)); })()`)
    assert.equal((await raw()).workouts[0].exercises[0].sets[1].execution.loadKg, 88)
    await click('Enregistrer la correction', '.workout-execution-set:nth-of-type(2)')
    assert.match(await call(() => document.querySelector('.workout-execution-set:nth-of-type(2) .workout-notes-error').textContent), /changé ailleurs/)
    assert.equal(await call(() => document.querySelector('.workout-execution-set:nth-of-type(2) input[id$="-loadKg"]').value), '86')
    await click('Rétablir les valeurs enregistrées', '.workout-execution-set:nth-of-type(2)')
    await click('← Retour à la séance')
    await click('Reprendre le suivi')
    await click('Modifier la série 2')
    await enter('.workout-execution-set:nth-of-type(2) input[id$="-loadKg"]', '87')
    await click('Enregistrer la correction', '.workout-execution-set:nth-of-type(2)')
    await reload()
    sets = (await raw()).workouts[0].exercises[0].sets
    assert.equal(sets[1].loading.loadKg, 90)
    assert.equal(sets[1].execution.loadKg, 87)
    await click('Terminer la séance')
    await click('Terminer la séance', 'dialog[open]')
    await waitFor(() => Boolean(document.querySelector('.workout-history .workout-detail')))
    const detail = await call(() => document.querySelector('.workout-history .workout-detail').textContent)
    assert.match(detail, /110 % de Clean.*100 kg/)
    assert.match(detail, /Charge libre/)
    assert.match(detail, /87 kg/)
    await capture('09-historique')
  })
  await check('Record modifié : anciennes charges conservées et duplication calculée à 105 kg', async () => {
    await click('Records', '.primary-nav')
    await click('Modifier le record : Clean')
    await enter('#record-clean', '105')
    await click('Enregistrer', '.record-editor-dialog[open]')
    assert.equal((await raw()).workouts[0].exercises[0].sets[0].loading.load.selectedKg, 110)
    await click('Historique', '.primary-nav')
    await click('Consulter', '.history-journal')
    await click('Réouvrir la séance')
    await click('Réouvrir la séance', 'dialog[open]')
    await click('← Retour aux séances')
    await click('Dupliquer', '.workout-session-list')
    await click('Enregistrer la séance')
    const data = await raw()
    assert.equal(data.workouts.length, 2)
    assert.equal(data.workouts[0].exercises[0].sets[0].loading.load.selectedKg, 110)
    assert.equal(data.workouts[1].exercises[0].sets[0].loading.load.selectedKg, 115.5)
    assert.equal(data.workouts[1].exercises[0].sets[0].loading.reference.oneRepMaxKg, 105)
    assert.equal(data.workouts[1].exercises[0].sets[1].execution, undefined)
  })
  await check('Record supprimé : snapshot consultable, duplication bloquée et charge libre proposée sans conversion', async () => {
    await click('Records', '.primary-nav')
    await click('Modifier le record : Clean')
    await click('Effacer ce record : Clean')
    await click('Effacer le record', '.record-dialog[open]:not(.record-editor-dialog)')
    assert.deepEqual((await raw()).records, [])
    assert.equal((await raw()).workouts[0].exercises[0].sets[0].loading.reference.oneRepMaxKg, 100)
    await click('Séances', '.primary-nav')
    await click('Dupliquer', '.workout-session-list')
    const before = (await raw()).workouts
    await click('Enregistrer la séance')
    assert.deepEqual((await raw()).workouts, before)
    assert.match(await call(() => document.querySelector('.workout-editor').textContent), /plus disponible/)
    await capture('10-reference-absente')
    await viewport(375)
    await capture('10-reference-absente-mobile')
    await viewport(1440)
    await select('.workout-set:first-child select[id$="-method"]', 'manual')
    assert.equal(await call(() => document.querySelector('.workout-set:first-child input[id$="-manual-load"]').value), '')
    await enter('.workout-set:first-child input[id$="-manual-load"]', '110')
    await click('Enregistrer la séance')
    assert.equal((await raw()).workouts.length, 3)
  })
  let backup
  await check('Export V2 téléchargé puis restauration intégrale dans un autre profil isolé', async () => {
    // Restaurer aussi un vrai Record ; les snapshots 100/105 kg restent indépendants.
    await click('Records', '.primary-nav')
    await click('Ajouter un mouvement')
    await chooseExercise('clean')
    await waitFor(() => Boolean(document.querySelector('#record-clean-form')))
    await enter('#record-clean', '105')
    await click('Enregistrer', '.record-editor-dialog[open]')
    assert.deepEqual((await raw()).records, [{ exerciseId: 'clean', oneRepMaxKg: 105 }])
    await click('Séances', '.primary-nav')
    const downloads = join(artifacts, 'downloads')
    await mkdir(downloads)
    await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads })
    await click('Télécharger ma sauvegarde', '.data-backup')
    let files = []
    for (let attempt = 0; attempt < 80; attempt++) {
      files = (await readdir(downloads)).filter(name => name.endsWith('.json'))
      if (files.length) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(files.length, 1)
    const path = join(downloads, files[0])
    backup = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(backup.version, 2)
    assert.deepEqual(backup.data, await raw())
    const directory = join(artifacts, 'restoration')
    await mkdir(directory)
    restorationBrowser = await startBrowser(baseUrl, directory)
    await importFile(restorationBrowser, path)
    await restorationBrowser.click('Restaurer mes données', '.data-backup dialog[open]')
    await restorationBrowser.reload()
    const restored = await restorationBrowser.call(() => ({ records: JSON.parse(localStorage.getItem('liftboard.personal-records.v1')), workouts: JSON.parse(localStorage.getItem('liftboard.workouts.v1')) }))
    assert.deepEqual(restored, backup.data)
  })
  await check('Ancien JSON V1 restauré sans migration ; durée décimale et import partiel refusés', async () => {
    const legacy = { id: 'old', title: 'Ancienne séance', date: '2026-11-03', status: 'completed', notes: { before: '  Note\n', during: '', after: '' },
      exercises: [{ id: 'old-block', exerciseId: 'snatch', sets: [{ id: 'old-set', reps: 3, intensityPct: 75, rounding: { mode: 'exact' }, load: { exactKg: 55.5, selectedKg: 55.5 }, execution: { completed: true, reps: 0, loadKg: 0 } }] }] }
    const v1 = { format: 'liftboard.backup', version: 1, exportedAt: '2026-11-03T12:00:00.000Z', data: { records: [{ exerciseId: 'snatch', oneRepMaxKg: 100 }], workouts: [legacy] } }
    const path = join(artifacts, 'historique-v1.json')
    await writeFile(path, JSON.stringify(v1))
    await importFile(restorationBrowser, path)
    await restorationBrowser.click('Restaurer mes données', '.data-backup dialog[open]')
    await restorationBrowser.reload()
    assert.deepEqual(await restorationBrowser.call(() => JSON.parse(localStorage.getItem('liftboard.workouts.v1'))), [legacy])
    const bad = structuredClone(backup)
    bad.data.workouts[0].exercises[0].sets[0] = { schemaVersion: 2, id: 'duration', kind: 'duration', durationSeconds: 1.5 }
    const badPath = join(artifacts, 'duree-interdite-v2.json')
    await writeFile(badPath, JSON.stringify(bad))
    await importFile(restorationBrowser, badPath)
    assert.equal(await restorationBrowser.call(() => Boolean(document.querySelector('.data-backup dialog[open]'))), false)
    assert.deepEqual(await restorationBrowser.call(() => JSON.parse(localStorage.getItem('liftboard.workouts.v1'))), [legacy])
  })
  assert.deepEqual(browser.errors, [])
  assert.deepEqual(restorationBrowser.errors, [])
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ passed: checks.length, checks }, null, 2))
  console.log(`${checks.length} contrôles E2-B réussis, 0 échoué. Captures et rapport : ${artifacts}`)
} catch (error) {
  await capture('ECHEC').catch(() => {})
  console.error(`${checks.length} contrôles E2-B réussis avant échec.`)
  throw error
} finally {
  restorationBrowser?.close()
  browser.close()
}
