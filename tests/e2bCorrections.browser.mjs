// Recette ciblée : affichage du calcul historique et confirmation sans auto-acceptation.
import assert from 'node:assert/strict'
import { realpathSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBrowser } from './helpers/browser.mjs'
import { exercisePickerActions } from './helpers/exercisePicker.mjs'

// Refuser un lancement depuis le dépôt avant de créer le moindre artefact.
assert.equal(realpathSync(process.cwd()), realpathSync(tmpdir()), 'CWD, TEMP et TMP doivent être isolés ensemble')
const artifacts = await mkdtemp(join(tmpdir(), 'liftboard-e2b-corrections-'))
console.log(`Captures et rapport isolés : ${artifacts}`)
const browser = await startBrowser(process.argv[2] ?? 'http://127.0.0.1:5182', artifacts)
const { call, click, enter, reload, settle, capture } = browser
const { addExercise, chooseExercise } = exercisePickerActions(browser)
// Ne pas utiliser changeExercise : il accepte certaines confirmations automatiquement.
const checks = []
const records = [
  { exerciseId: 'snatch', oneRepMaxKg: 80 }, { exerciseId: 'clean-and-jerk', oneRepMaxKg: 110 },
  { exerciseId: 'front-squat', oneRepMaxKg: 120 }, { exerciseId: 'back-squat', oneRepMaxKg: 200 },
  { exerciseId: 'clean', oneRepMaxKg: 100 },
]
const notes = { before: '', during: '', after: '' }
const legacySet = id => ({ id, reps: 3, intensityPct: 75, rounding: { mode: 'exact' }, load: null })
const workout = (id, exercises) => ({ id, title: id, date: '2026-11-20', status: 'planned', notes: { ...notes }, exercises })
const block = id => `.workout-exercise[aria-labelledby="workout-block-${id}-title"]`
const row = (id, index) => `${block(id)} .workout-set:nth-child(${index})`
const field = (id, index, suffix) => `${row(id, index)} [id$="-${suffix}"]`
const raw = () => call(() => ({
  records: localStorage.getItem('liftboard.personal-records.v1'), workouts: localStorage.getItem('liftboard.workouts.v1'),
}))
const savedWorkouts = async () => JSON.parse((await raw()).workouts)
const value = selector => call(selector => document.querySelector(selector).value, selector)
const load = scope => call(scope => document.querySelector(`${scope} .workout-load strong`).textContent.trim(), scope)
const check = async (name, action) => { await action(); checks.push(name); console.log(`OK : ${name}`) }
async function seed(workouts, currentRecords = records) {
  await call((workouts, records) => {
    localStorage.clear(); sessionStorage.clear()
    localStorage.setItem('liftboard.personal-records.v1', JSON.stringify(records))
    localStorage.setItem('liftboard.workouts.v1', JSON.stringify(workouts))
  }, workouts, currentRecords)
  await reload()
}
async function edit() {
  await click('Ouvrir', '.workout-session-list')
  await click('Modifier', '.workout-detail')
}
async function expand(id, index) {
  if (await call(scope => document.querySelector(`${scope} .workout-set-editor`).hidden, row(id, index))) {
    await click('Modifier', row(id, index))
  }
}
async function select(selector, selected) {
  assert.equal(await call((selector, selected) => {
    const control = document.querySelector(selector)
    if (!control?.getClientRects().length) return false
    control.value = selected
    control.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }, selector, selected), true, selector)
  await settle()
}
async function requestMovement(id, exerciseId) {
  await call(scope => document.querySelector(`${scope} .workout-movement-button`).click(), block(id))
  await settle()
  await chooseExercise(exerciseId)
}
const confirmation = () => call(() => [...document.querySelectorAll('dialog[open] h3')]
  .some(heading => heading.textContent === 'Changer le mouvement ?'))
async function assertConfirmation() {
  assert.equal(await confirmation(), true, 'La confirmation doit réellement apparaître')
  const text = await call(() => document.querySelector('dialog.record-dialog[open]').textContent)
  assert.match(text, /répétitions sont conservées/)
  assert.match(text, /charges historiques.*recalculées/)
  assert.match(text, /références E2 explicites.*charges figées.*charges libres.*conservées/)
  assert.deepEqual(await call(() => [...document.querySelectorAll('dialog.record-dialog[open] .record-dialog-actions button')]
    .map(button => button.textContent)), ['Annuler', 'Changer le mouvement'])
}
const draftView = () => call(() => {
  const form = document.querySelector('form.workout-editor')
  return {
    fields: [...form.querySelectorAll('input,select,textarea')].map(control => ({ id: control.id, value: control.value })),
    blocks: [...form.querySelectorAll('.workout-exercise')].map(block => ({
      id: block.getAttribute('aria-labelledby'), movement: block.querySelector('.workout-movement-button').textContent,
      sets: [...block.querySelectorAll('.workout-set')].map(set => ({
        id: set.querySelector('legend').id, load: set.querySelector('.workout-load').textContent,
        reference: set.querySelector('[id$="-reference-hint"]')?.textContent ?? null,
      })),
    })),
  }
})

let source, mixedId, otherId, persisted, draftBefore, cachesBefore, changed
const completed = { ...workout('Autre séance terminée', [{ id: 'completed-block', exerciseId: 'back-squat',
  sets: [{ ...legacySet('completed-set'), load: { exactKg: 150, selectedKg: 150 }, execution: { completed: true, reps: 3, loadKg: 147 } }] }]),
status: 'completed', notes: { before: 'Préparation', during: 'Suivi conservé', after: 'Résultat conservé' } }
const currentRecords = records.map(record => record.exerciseId === 'clean' ? { ...record, oneRepMaxKg: 105 } : record)
async function probeCaches() {
  await expand(mixedId, 1)
  await select(field(mixedId, 1, 'method'), 'manual')
  const manual = await value(field(mixedId, 1, 'manual-load'))
  await select(field(mixedId, 1, 'method'), 'percentage')
  const frozen = { reference: await value(field(mixedId, 1, 'reference')), intensity: await value(field(mixedId, 1, 'intensity')),
    rounding: await value(field(mixedId, 1, 'rounding')), load: await load(row(mixedId, 1)),
    snapshot: await call(selector => document.querySelector(selector).textContent, field(mixedId, 1, 'reference-hint')) }
  await expand(mixedId, 2)
  await select(field(mixedId, 2, 'method'), 'percentage')
  const percentage = { reference: await value(field(mixedId, 2, 'reference')), intensity: await value(field(mixedId, 2, 'intensity')),
    rounding: await value(field(mixedId, 2, 'rounding')),
    snapshot: await call(selector => document.querySelector(selector).textContent, field(mixedId, 2, 'reference-hint')) }
  await select(field(mixedId, 2, 'method'), 'manual')
  return { manual, frozen, percentage, activeManual: await value(field(mixedId, 2, 'manual-load')) }
}

try {
  await check('Clean V1 sans charge : bouton absent, sauvegarde V1 intacte puis adoption E2 explicite et ciblée', async () => {
    const untouched = { ...legacySet('clean-frozen'), load: { exactKg: 55.5, selectedKg: 55.5 } }
    const clean = workout('Clean historique', [{ id: 'legacy-clean', exerciseId: 'clean', sets: [legacySet('clean-null'), untouched] }])
    await seed([clean])
    const initial = await raw()
    await edit()
    assert.equal(await call(() => [...document.querySelectorAll('form.workout-editor button')]
      .some(button => button.textContent.trim() === 'Calculer cette charge')), false)
    assert.equal(await load(row('legacy-clean', 1)), '—')
    assert.equal(await value(field('legacy-clean', 1, 'method')), 'legacy')
    assert.deepEqual(await raw(), initial)
    await enter('#workout-title', 'Clean historique conservé')
    await click('Enregistrer les modifications')
    const [saved] = await savedWorkouts()
    assert.deepEqual(saved.exercises, clean.exercises)
    assert.equal('schemaVersion' in saved.exercises[0].sets[0], false)
    await edit()
    await select(field('legacy-clean', 1, 'method'), 'percentage')
    assert.equal(await value(field('legacy-clean', 1, 'reference')), '')
    await select(field('legacy-clean', 1, 'reference'), 'clean')
    await enter(field('legacy-clean', 1, 'intensity'), '110')
    assert.equal(await load(row('legacy-clean', 1)), '110 kg')
    assert.deepEqual(await savedWorkouts(), [saved])
    await capture('01-clean-adoption-explicite')
    await click('Enregistrer les modifications')
    const [converted] = await savedWorkouts()
    assert.equal(converted.exercises[0].sets[0].schemaVersion, 2)
    assert.equal(converted.exercises[0].sets[0].loading.reference.exerciseId, 'clean')
    assert.equal(converted.exercises[0].sets[0].loading.reference.oneRepMaxKg, 100)
    assert.equal(converted.exercises[0].sets[0].loading.load.selectedKg, 110)
    assert.deepEqual(converted.exercises[0].sets[1], untouched)
  })
  await check('Quatre références historiques : calcul disponible seulement sur une saisie calculable, sans conversion', async () => {
    const historical = records.slice(0, 4)
    const original = workout('Quatre calculs historiques', historical.map(record => ({ id: `legacy-${record.exerciseId}`,
      exerciseId: record.exerciseId, sets: [legacySet(`set-${record.exerciseId}`)] })))
    await seed([original])
    await edit()
    for (const record of historical) {
      const id = `legacy-${record.exerciseId}`
      await expand(id, 1)
      assert.equal(await load(row(id, 1)), '—')
      await enter(field(id, 1, 'reps'), '')
      assert.equal(await call(scope => [...document.querySelector(scope).querySelectorAll('button')]
        .some(button => button.textContent.trim() === 'Calculer cette charge'), row(id, 1)), false)
      await enter(field(id, 1, 'reps'), '3')
      await click('Calculer cette charge', row(id, 1))
      assert.equal(await load(row(id, 1)), `${String(record.oneRepMaxKg * 0.75).replace('.', ',')} kg`)
      assert.deepEqual(await savedWorkouts(), [original])
    }
    await click('Enregistrer les modifications')
    const [saved] = await savedWorkouts()
    saved.exercises.forEach((exercise, index) => {
      const set = exercise.sets[0], kg = historical[index].oneRepMaxKg * 0.75
      assert.equal('schemaVersion' in set, false)
      assert.deepEqual(set.load, { exactKg: kg, selectedKg: kg })
    })
  })
  await check('Préparation réelle du bloc mixte : deux séries E2 et une série V1 enregistrée imposant la confirmation', async () => {
    await seed([completed])
    await click('+ Nouvelle séance')
    await enter('#workout-title', 'Confirmation mixte')
    await addExercise('clean-pull')
    // Les IDs viennent du formulaire créé par React, jamais d’un accès à son état interne.
    mixedId = await call(() => document.querySelector('.workout-exercise').getAttribute('aria-labelledby')
      .replace('workout-block-', '').replace(/-title$/, ''))
    await enter(field(mixedId, 1, 'reps'), '3')
    await select(field(mixedId, 1, 'method'), 'percentage')
    await select(field(mixedId, 1, 'reference'), 'clean')
    await enter(field(mixedId, 1, 'intensity'), '110')
    await select(field(mixedId, 1, 'rounding'), 'up-2.5')
    await click('+ Ajouter une série', block(mixedId))
    await enter(field(mixedId, 2, 'reps'), '3')
    await select(field(mixedId, 2, 'method'), 'manual')
    await enter(field(mixedId, 2, 'manual-load'), '90')
    await click('+ Ajouter une série', block(mixedId))
    await enter(field(mixedId, 3, 'reps'), '2')
    await enter(field(mixedId, 3, 'intensity'), '80')
    await select(field(mixedId, 3, 'rounding'), 'down-2.5')
    await addExercise('back-squat')
    otherId = await call(() => [...document.querySelectorAll('.workout-exercise')].at(-1).getAttribute('aria-labelledby')
      .replace('workout-block-', '').replace(/-title$/, ''))
    await enter(field(otherId, 1, 'reps'), '4')
    await enter(field(otherId, 1, 'intensity'), '75')
    await click('Enregistrer la séance')
    source = (await savedWorkouts()).find(item => item.status === 'planned')
    assert.equal(source.exercises[0].sets.length, 3)
    assert.equal(source.exercises[0].sets[2].load, null)
    assert.equal(source.exercises[0].sets[0].loading.reference.oneRepMaxKg, 100)
    // Changer réellement le Record : perdre savedPlan ferait maintenant disparaître les 110 kg.
    await click('Records', '.primary-nav')
    await click('Modifier le record : Clean')
    await enter('#record-clean', '105')
    await click('Enregistrer', '.record-editor-dialog[open]')
    await click('Séances', '.primary-nav')
    await edit()
    await enter('#workout-title', 'Titre en cours non enregistré')
    await enter(field(mixedId, 1, 'reps'), '5')
    await select(field(mixedId, 1, 'method'), 'manual')
    await enter(field(mixedId, 1, 'manual-load'), '88,')
    await select(field(mixedId, 1, 'method'), 'percentage')
    await expand(mixedId, 2)
    await select(field(mixedId, 2, 'method'), 'percentage')
    await select(field(mixedId, 2, 'reference'), 'snatch')
    await enter(field(mixedId, 2, 'intensity'), '125')
    await select(field(mixedId, 2, 'rounding'), 'down-2.5')
    await select(field(mixedId, 2, 'method'), 'manual')
    await enter(field(mixedId, 2, 'manual-load'), '92,5')
    await expand(mixedId, 3)
    await enter(field(mixedId, 3, 'reps'), '2,')
    cachesBefore = await probeCaches()
    assert.equal(cachesBefore.manual, '88,')
    assert.equal(cachesBefore.frozen.load, '110 kg')
    assert.match(cachesBefore.frozen.snapshot, /Clean, 100 kg/)
    assert.equal(cachesBefore.activeManual, '92,5')
    assert.equal(cachesBefore.percentage.reference, 'snatch')
    assert.equal(cachesBefore.percentage.intensity, '125')
    assert.equal(cachesBefore.percentage.rounding, 'down-2.5')
    draftBefore = await draftView()
    persisted = await raw()
    await requestMovement(mixedId, 'front-squat')
    await assertConfirmation()
    assert.deepEqual(await draftView(), draftBefore)
    assert.deepEqual(await raw(), persisted)
    await capture('02-confirmation-obligatoire')
  })
  await check('Annuler : brouillon valide/invalide, snapshots figés, caches inactifs, IDs et autres exercices inchangés', async () => {
    await click('Annuler', 'dialog.record-dialog[open]')
    assert.equal(await confirmation(), false)
    assert.deepEqual(await draftView(), draftBefore)
    assert.deepEqual(await probeCaches(), cachesBefore)
    assert.deepEqual(await draftView(), draftBefore)
    assert.deepEqual(await raw(), persisted)
    assert.equal(await value(field(mixedId, 3, 'reps')), '2,')
  })
  await check('Échap : seconde apparition obligatoire, fermeture sans abandon du brouillon', async () => {
    await requestMovement(mixedId, 'front-squat')
    await assertConfirmation()
    await browser.key('Escape', 27)
    assert.equal(await confirmation(), false)
    assert.deepEqual(await draftView(), draftBefore)
    assert.deepEqual(await probeCaches(), cachesBefore)
    assert.deepEqual(await raw(), persisted)
  })
  await check('Confirmer : changement ciblé, E2 intact, saisie invalide bloquante puis sauvegarde explicite du recalcul V1', async () => {
    await requestMovement(mixedId, 'front-squat')
    await assertConfirmation()
    await click('Changer le mouvement', 'dialog.record-dialog[open]')
    assert.equal(await confirmation(), false)
    const after = await draftView()
    assert.deepEqual(after.fields, draftBefore.fields)
    assert.match(after.blocks[0].movement, /Front Squat/)
    assert.deepEqual(after.blocks[0].sets.slice(0, 2), draftBefore.blocks[0].sets.slice(0, 2))
    assert.equal(after.blocks[0].sets[2].id, draftBefore.blocks[0].sets[2].id)
    assert.equal(await load(row(mixedId, 3)), '—')
    assert.deepEqual(after.blocks.slice(1), draftBefore.blocks.slice(1))
    assert.deepEqual(await probeCaches(), cachesBefore)
    assert.deepEqual(await raw(), persisted)
    await click('Enregistrer les modifications')
    assert.deepEqual(await raw(), persisted, 'Une saisie invalide bloque toute écriture')
    await enter(field(mixedId, 3, 'reps'), '4')
    assert.equal(await load(row(mixedId, 3)), '95 kg')
    await capture('03-changement-confirme-brouillon')
    assert.deepEqual(await raw(), persisted)
    await click('Enregistrer les modifications')
    const data = await savedWorkouts()
    assert.deepEqual(data.find(item => item.id === completed.id), completed)
    changed = data.find(item => item.id === source.id)
    assert.equal(changed.title, 'Titre en cours non enregistré')
    assert.equal(changed.exercises[0].exerciseId, 'front-squat')
    assert.deepEqual(changed.exercises[0].sets.map(set => set.id), source.exercises[0].sets.map(set => set.id))
    assert.deepEqual(changed.exercises[0].sets[0], { ...source.exercises[0].sets[0], reps: 5 })
    assert.deepEqual(changed.exercises[0].sets[1], { ...source.exercises[0].sets[1], loading: { method: 'manual', loadKg: 92.5 } })
    assert.deepEqual(changed.exercises[0].sets[2], { ...source.exercises[0].sets[2], reps: 4, load: { exactKg: 96, selectedKg: 95 } })
    assert.deepEqual(changed.exercises[1], source.exercises[1])
    await reload()
    assert.deepEqual(await savedWorkouts(), data)
  })
  await check('Changement simple E2 : aucune confirmation systématique, références et charges conservées', async () => {
    const simple = structuredClone(changed)
    simple.id = 'simple-e2'
    simple.exercises[0].sets = simple.exercises[0].sets.slice(0, 2)
    await seed([completed, simple], currentRecords)
    await edit()
    const before = await draftView(), stored = await raw()
    await requestMovement(mixedId, 'clean-pull')
    assert.equal(await confirmation(), false)
    const after = await draftView()
    assert.deepEqual(after.fields, before.fields)
    assert.deepEqual(after.blocks[0].sets, before.blocks[0].sets)
    assert.deepEqual(after.blocks.slice(1), before.blocks.slice(1))
    assert.match(after.blocks[0].movement, /Clean Pull/)
    assert.deepEqual(await raw(), stored)
    await click('Enregistrer les modifications')
    const expected = structuredClone(simple)
    expected.exercises[0].exerciseId = 'clean-pull'
    assert.deepEqual(await savedWorkouts(), [completed, expected])
  })
  assert.deepEqual(browser.errors, [])
  await writeFile(join(artifacts, 'results.json'), JSON.stringify({ passed: checks.length, checks }, null, 2))
  console.log(`${checks.length} parcours corrections E2-B réussis, 0 échoué. Rapport : ${artifacts}`)
} catch (error) {
  await capture('ECHEC').catch(() => {})
  console.error(`${checks.length} parcours réussis avant échec.`)
  throw error
} finally {
  browser.close()
}
