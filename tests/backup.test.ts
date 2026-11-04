import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { exportBackup, restoreBackup, type BackupStorage } from '../src/data/backup.ts'
import { loadPersonalRecords, recordsStorageKey } from '../src/data/personalRecords.ts'
import { loadWorkouts, workoutsStorageKey } from '../src/data/workouts.ts'
import { backupFormat, backupSummary, maxBackupBytes, parseBackup, validateBackup, type DataBackup } from '../src/lib/dataBackup.ts'
import { readBackupFile } from '../src/lib/backupFile.ts'
import type { Workout } from '../src/types/workout.ts'

class MemoryStorage implements BackupStorage {
  data = new Map<string, string>()
  writes = 0
  failRead = false
  failOn = new Set<number>()
  silentOn = new Set<number>()
  getItem(key: string) {
    if (this.failRead) throw new Error('Denied')
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.writes++
    if (this.failOn.has(this.writes)) throw new DOMException('Full', 'QuotaExceededError')
    if (!this.silentOn.has(this.writes)) this.data.set(key, value)
  }
  removeItem(key: string) { this.data.delete(key) }
}

function fixture(): DataBackup {
  const planned: Workout = {
    id: 'planned', title: 'Technique <script>sans exécution</script>', date: '2026-11-04', status: 'planned',
    notes: { before: '  Consignes\nLigne 2\n', during: 'Pendant 💪', after: 'Bilan' },
    exercises: [{ id: 'block', exerciseId: 'snatch', sets: [
      { id: 'exact', reps: 3, intensityPct: 73.3, rounding: { mode: 'exact' }, load: { exactKg: 60.4725, selectedKg: 60.4725 }, execution: { completed: true, reps: 2, loadKg: 62.5 } },
      { id: 'down', reps: 1, intensityPct: 80, rounding: { mode: 'down', increment: 1 }, load: { exactKg: 66.6, selectedKg: 66 }, execution: { completed: false, reps: null, loadKg: null, cleared: { reps: true } } },
      { id: 'up', reps: 2, intensityPct: 75, rounding: { mode: 'up', increment: 2.5 }, load: { exactKg: 61.875, selectedKg: 62.5 }, execution: { completed: false, reps: 1, loadKg: 61 } },
      { id: 'missing', reps: 1, intensityPct: 60, rounding: { mode: 'down', increment: 5 }, load: null },
    ] }],
  }
  const completed = structuredClone(planned)
  completed.id = 'completed'
  completed.status = 'completed'
  completed.exercises[0].sets[0].execution = { completed: true, reps: 0, loadKg: 0 }
  // Les identifiants de blocs/séries sont uniques dans leur séance, comme dans le lecteur actuel.
  return {
    format: backupFormat, version: 1, exportedAt: '2026-11-04T12:00:00.000Z',
    data: { records: [{ exerciseId: 'snatch', oneRepMaxKg: 82.5 }, { exerciseId: 'front-squat', oneRepMaxKg: 120 }], workouts: [planned, completed] },
  }
}

function seededStorage() {
  const storage = new MemoryStorage(), source = fixture()
  storage.data.set(recordsStorageKey, JSON.stringify(source.data.records))
  storage.data.set(workoutsStorageKey, JSON.stringify(source.data.workouts))
  storage.data.set('unrelated.secret', 'must not be exported or modified')
  return storage
}

describe('export et format de sauvegarde', () => {
  it('exporte toutes les données persistées sans mutation ni autre clé', () => {
    const storage = seededStorage(), before = new Map(storage.data)
    const result = exportBackup(storage, new Date('2026-11-04T12:00:00Z'))
    assert.ok(result.ok)
    if (!result.ok) return
    assert.deepEqual(result.value.backup, fixture())
    assert.match(result.value.filename, /^liftboard-sauvegarde-\d{4}-\d{2}-\d{2}\.json$/)
    assert.deepEqual(parseBackup(result.value.json), { ok: true, value: fixture() })
    assert.equal(result.value.json.includes('unrelated.secret'), false)
    assert.deepEqual(storage.data, before)
    assert.equal(storage.writes, 0)
    assert.deepEqual(backupSummary(result.value.backup), { records: 2, planned: 1, completed: 1 })
  })

  it('exporte un navigateur vierge et des Records sans aucune séance', () => {
    const storage = new MemoryStorage()
    for (const records of [[], fixture().data.records]) {
      storage.data.set(recordsStorageKey, JSON.stringify(records))
      const result = exportBackup(storage)
      assert.ok(result.ok)
      if (result.ok) assert.deepEqual(result.value.backup.data, { records, workouts: [] })
    }
    assert.equal(storage.writes, 0)
  })

  it('refuse tout export incomplet si une source est corrompue ou inaccessible', () => {
    for (const key of [recordsStorageKey, workoutsStorageKey]) {
      for (const invalid of ['{broken', '{}', '[{}]', 'null']) {
        const storage = seededStorage()
        storage.data.set(key, invalid)
        assert.equal(exportBackup(storage).ok, false)
        assert.equal(storage.getItem(key), invalid)
        assert.equal(storage.writes, 0)
      }
    }
    const storage = seededStorage()
    storage.failRead = true
    assert.equal(exportBackup(storage).ok, false)
    assert.equal(storage.writes, 0)
  })

  it('préserve les charges figées, notes, statuts, effacements et anciens résultats à zéro ou hors limites de nouvelle saisie', () => {
    const source = fixture()
    source.data.workouts[1].exercises[0].sets[1].execution = { completed: true, reps: 1, loadKg: Number.MAX_VALUE }
    const storage = new MemoryStorage()
    assert.deepEqual(restoreBackup(source, storage), { ok: true })
    const exported = exportBackup(storage)
    assert.ok(exported.ok)
    if (exported.ok) assert.deepEqual(exported.value.backup.data, source.data)
  })
})

describe('validation sans écriture', () => {
  it('accepte un fichier valide, y compris un BOM UTF-8', async () => {
    const file = new File([JSON.stringify(fixture())], 'sauvegarde.JSON', { type: 'application/json' })
    assert.deepEqual(await readBackupFile(file), { ok: true, value: fixture() })
    assert.equal(parseBackup('\uFEFF' + JSON.stringify(fixture())).ok, true)
  })

  it('refuse fichier vide, taille excessive, extension incorrecte et lecture en échec', async () => {
    const empty = await readBackupFile(new File([], 'backup.json'))
    assert.ok(!empty.ok && /vide/.test(empty.error))
    const large = await readBackupFile(new File([' '.repeat(maxBackupBytes + 1)], 'backup.json'))
    assert.ok(!large.ok && /10 Mo/.test(large.error))
    assert.equal(parseBackup(' '.repeat(maxBackupBytes + 1)).ok, false)
    assert.equal((await readBackupFile(new File([JSON.stringify(fixture())], 'backup.txt'))).ok, false)
    const unreadable = new File(['{}'], 'backup.json')
    unreadable.text = () => Promise.reject(new Error('Unreadable'))
    assert.equal((await readBackupFile(unreadable)).ok, false)
  })

  it('refuse JSON invalide, mauvais format, version et métadonnées incompatibles', () => {
    for (const input of ['', '{invalid', '[]', 'null', '{"format":"other"}']) assert.equal(parseBackup(input).ok, false)
    for (const patch of [{ version: 2 }, { version: '1' }, { exportedAt: 'hier' }, { exportedAt: '2026-02-30T12:00:00.000Z' }]) {
      assert.equal(validateBackup({ ...fixture(), ...patch }).ok, false)
    }
  })

  it('refuse les structures métier corrompues et identifiants dupliqués sans toucher au stockage', () => {
    const source = fixture(), planned = source.data.workouts[0], block = planned.exercises[0], set = block.sets[0]
    const invalidValues: unknown[] = [
      { ...source, data: null },
      { ...source, data: { ...source.data, records: [...source.data.records, source.data.records[0]] } },
      { ...source, data: { ...source.data, records: [{ exerciseId: 'unknown', oneRepMaxKg: 10 }] } },
      { ...source, data: { ...source.data, records: [{ exerciseId: 'snatch', oneRepMaxKg: 0 }] } },
      { ...source, data: { ...source.data, workouts: [planned, planned] } },
    ]
    for (const patch of [{ id: '' }, { date: '2026-02-30' }, { title: ' ' }, { status: 'other' }, { notes: { before: '' } }, { exercises: [] }]) {
      invalidValues.push({ ...source, data: { ...source.data, workouts: [{ ...planned, ...patch }] } })
    }
    for (const patch of [
      { id: planned.id }, { exerciseId: 'unknown' }, { sets: [set, set] },
      ...[{ id: block.id }, { reps: 1.5 }, { intensityPct: 101 }, { load: { exactKg: 10, selectedKg: 9 } },
        { rounding: { mode: 'up', increment: 3 } }, { execution: { completed: true, reps: null, loadKg: 10 } },
        { execution: { completed: false, reps: -1, loadKg: 10 } },
        { execution: { completed: false, reps: 1, loadKg: null, cleared: { reps: true } } },
      ].map((setPatch) => ({ sets: [{ ...set, ...setPatch }] })),
    ]) invalidValues.push({ ...source, data: { ...source.data, workouts: [{ ...planned, exercises: [{ ...block, ...patch }] }] } })
    const storage = seededStorage(), before = new Map(storage.data)
    for (const invalid of invalidValues) {
      assert.equal(validateBackup(invalid).ok, false, JSON.stringify(invalid))
      assert.equal(restoreBackup(invalid, storage).ok, false)
    }
    assert.deepEqual(storage.data, before)
    assert.equal(storage.writes, 0)
  })
})

describe('restauration et récupération des écritures', () => {
  it('remplace entièrement les données, préserve les autres clés et se relit avec les lecteurs habituels après rechargement', () => {
    const storage = seededStorage(), replacement = fixture()
    replacement.data.records = [{ exerciseId: 'back-squat', oneRepMaxKg: 150 }]
    replacement.data.workouts = []
    assert.deepEqual(restoreBackup(replacement, storage), { ok: true })
    assert.deepEqual(loadPersonalRecords(storage), { records: replacement.data.records, error: null })
    assert.deepEqual(loadWorkouts(storage), { ok: true, workouts: [] })
    assert.equal(storage.data.get('unrelated.secret'), 'must not be exported or modified')
  })

  it('restaure volontairement sur un stockage corrompu après validation complète de la sauvegarde', () => {
    const storage = new MemoryStorage()
    storage.data.set(recordsStorageKey, '{broken')
    storage.data.set(workoutsStorageKey, 'incompatible')
    assert.deepEqual(restoreBackup(fixture(), storage), { ok: true })
    assert.deepEqual(loadPersonalRecords(storage).records, fixture().data.records)
    assert.deepEqual(loadWorkouts(storage), { ok: true, workouts: fixture().data.workouts })
  })

  it('n’écrit rien si la copie du stockage actuel est inaccessible', () => {
    const storage = seededStorage(), before = new Map(storage.data)
    storage.failRead = true
    const result = restoreBackup(fixture(), storage)
    assert.ok(!result.ok && result.recovery === 'unchanged')
    assert.deepEqual(storage.data, before)
    assert.equal(storage.writes, 0)
  })

  it('récupère exactement les valeurs brutes après quota dépassé dès la première ou la deuxième écriture', () => {
    for (const failure of [1, 2]) {
      const storage = seededStorage()
      storage.data.set(recordsStorageKey, '  [ ]\n')
      storage.data.set(workoutsStorageKey, '{corrompu')
      const before = new Map(storage.data)
      storage.failOn.add(failure)
      const result = restoreBackup(fixture(), storage)
      assert.ok(!result.ok && result.recovery === 'rolled-back' && /plein/.test(result.error))
      assert.deepEqual(storage.data, before)
    }
  })

  it('supprime la clé créée pendant un échec partiel sur un navigateur vierge', () => {
    const storage = new MemoryStorage()
    storage.failOn.add(2)
    const result = restoreBackup(fixture(), storage)
    assert.ok(!result.ok && result.recovery === 'rolled-back')
    assert.deepEqual([...storage.data], [])
  })

  it('ne signale pas de succès si une écriture silencieuse n’est pas confirmée à la relecture', () => {
    const storage = new MemoryStorage()
    storage.silentOn.add(2)
    const result = restoreBackup(fixture(), storage)
    assert.ok(!result.ok && result.recovery === 'rolled-back')
    assert.equal(storage.data.size, 0)
  })

  it('tente aussi le retour à l’état précédent si la lecture devient inaccessible après les écritures', () => {
    const storage = seededStorage(), before = new Map(storage.data)
    storage.data.set(recordsStorageKey, '[]')
    before.set(recordsStorageKey, '[]')
    const getItem = storage.getItem.bind(storage)
    storage.getItem = (key) => {
      if (storage.writes >= 2) throw new Error('Read denied after writing')
      return getItem(key)
    }
    const result = restoreBackup(fixture(), storage)
    assert.ok(!result.ok && result.recovery === 'uncertain') // Impossible de vérifier la récupération.
    assert.deepEqual(storage.data, before)
    assert.equal(storage.writes, 4)
  })

  it('signale honnêtement le mélange possible si le retour aux données précédentes échoue aussi', () => {
    const storage = seededStorage()
    storage.data.set(recordsStorageKey, '[]')
    storage.failOn = new Set([2, 3])
    const result = restoreBackup(fixture(), storage)
    assert.ok(!result.ok && result.recovery === 'uncertain' && /mélange/.test(result.error))
    assert.equal(storage.getItem(recordsStorageKey), JSON.stringify(fixture().data.records))
  })
})
