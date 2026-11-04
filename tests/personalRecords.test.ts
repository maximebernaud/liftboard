import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadPersonalRecords, mutatePersonalRecord, recordsStorageKey, type PersonalRecord, type RecordMutation } from '../src/data/personalRecords.ts'
import { exportBackup, restoreBackup } from '../src/data/backup.ts'
import { getWorkoutSetLoad } from '../src/lib/workoutDraft.ts'

const snatch: PersonalRecord = { exerciseId: 'snatch', oneRepMaxKg: 100 }
const clean: PersonalRecord = { exerciseId: 'clean-and-jerk', oneRepMaxKg: 120 }
const mutation: RecordMutation = { exerciseId: 'snatch', original: snatch, oneRepMaxKg: 110 }

class MemoryStorage {
  data = new Map([[recordsStorageKey, JSON.stringify([snatch, clean])]])
  writes = 0
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.writes++; this.data.set(key, value) }
  removeItem(key: string) { this.data.delete(key) }
}

describe('mutations ciblées des Records', () => {
  it('fusionne deux modifications indépendantes à partir de la version persistée la plus récente', () => {
    const storage = new MemoryStorage()
    assert.equal(mutatePersonalRecord({ ...mutation, oneRepMaxKg: 105 }, storage).ok, true)
    assert.deepEqual(mutatePersonalRecord({ exerciseId: 'clean-and-jerk', original: clean, oneRepMaxKg: 125 }, storage), {
      ok: true, records: [{ ...snatch, oneRepMaxKg: 105 }, { ...clean, oneRepMaxKg: 125 }],
    })
    assert.equal(storage.writes, 2)
    assert.deepEqual(snatch, { exerciseId: 'snatch', oneRepMaxKg: 100 })
  })

  it('refuse le même mouvement modifié ailleurs sans écrire, même si la valeur demandée est identique', () => {
    const storage = new MemoryStorage()
    mutatePersonalRecord({ ...mutation, oneRepMaxKg: 105 }, storage)
    const before = new Map(storage.data)
    for (const oneRepMaxKg of [105, 110, null]) {
      const result = mutatePersonalRecord({ ...mutation, oneRepMaxKg }, storage)
      assert.equal(result.ok, false)
      if (!result.ok) assert.match(result.error, /modifié ailleurs.*saisie est conservée/)
    }
    assert.equal(storage.writes, 1)
    assert.deepEqual(storage.data, before)
  })

  it('détecte un Record ajouté pendant une création', () => {
    const storage = new MemoryStorage()
    assert.equal(mutatePersonalRecord({ ...mutation, original: null }, storage).ok, false)
    assert.equal(storage.writes, 0)
  })

  it('détecte un Record supprimé pendant une édition ou une demande de suppression', () => {
    const storage = new MemoryStorage()
    storage.data.set(recordsStorageKey, JSON.stringify([clean]))
    assert.equal(mutatePersonalRecord(mutation, storage).ok, false)
    assert.equal(mutatePersonalRecord({ ...mutation, oneRepMaxKg: null }, storage).ok, false)
    assert.deepEqual(loadPersonalRecords(storage).records, [clean])
    assert.equal(storage.writes, 0)
  })

  it('crée depuis une clé absente sans changer de format ni de clé', () => {
    const storage = new MemoryStorage()
    storage.data.clear()
    assert.deepEqual(mutatePersonalRecord({ ...mutation, original: null }, storage), {
      ok: true, records: [{ ...snatch, oneRepMaxKg: 110 }],
    })
    assert.deepEqual([...storage.data.keys()], [recordsStorageKey])
  })

  it('efface uniquement le mouvement ciblé et conserve les autres Records récents', () => {
    const storage = new MemoryStorage()
    mutatePersonalRecord({ exerciseId: 'clean-and-jerk', original: clean, oneRepMaxKg: 125 }, storage)
    assert.deepEqual(mutatePersonalRecord({ ...mutation, oneRepMaxKg: null }, storage), {
      ok: true, records: [{ ...clean, oneRepMaxKg: 125 }],
    })
  })

  it('refuse toute mutation lorsque les données sont devenues corrompues après chargement', () => {
    const storage = new MemoryStorage()
    assert.deepEqual(loadPersonalRecords(storage).records, [snatch, clean])
    for (const raw of ['{corrompu', '{}', '[{"exerciseId":"snatch","oneRepMaxKg":0}]', JSON.stringify([snatch, snatch])]) {
      storage.data.set(recordsStorageKey, raw)
      assert.equal(mutatePersonalRecord(mutation, storage).ok, false)
      assert.equal(mutatePersonalRecord({ ...mutation, oneRepMaxKg: null }, storage).ok, false)
      assert.equal(storage.getItem(recordsStorageKey), raw)
    }
    assert.equal(storage.writes, 0)
  })

  it('refuse toute écriture si la lecture devient inaccessible', () => {
    const storage = new MemoryStorage(), before = new Map(storage.data)
    storage.getItem = () => { throw new Error('Denied') }
    assert.equal(mutatePersonalRecord(mutation, storage).ok, false)
    assert.equal(storage.writes, 0)
    assert.deepEqual(storage.data, before)
  })

  it('ne confirme aucun succès si une écriture est refusée ou dépasse le quota', () => {
    for (const error of [new Error('Denied'), new DOMException('Full', 'QuotaExceededError')]) {
      const storage = new MemoryStorage(), before = new Map(storage.data)
      storage.setItem = () => { throw error }
      const result = mutatePersonalRecord(mutation, storage)
      assert.equal(result.ok, false)
      if (!result.ok) assert.match(result.error, /saisie est conservée/)
      assert.deepEqual(storage.data, before)
    }
  })

  it('refuse de confirmer une écriture ignorée silencieusement', () => {
    const storage = new MemoryStorage(), before = new Map(storage.data)
    storage.setItem = () => {}
    const result = mutatePersonalRecord(mutation, storage)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /vérifiée/)
    assert.deepEqual(storage.data, before)
  })

  it('ne confirme pas le succès si la relecture de vérification échoue après écriture', () => {
    const storage = new MemoryStorage()
    const read = storage.getItem.bind(storage)
    storage.getItem = (key) => { if (storage.writes) throw new Error('Denied'); return read(key) }
    assert.equal(mutatePersonalRecord(mutation, storage).ok, false)
    assert.equal(storage.writes, 1)
  })

  it('refuse les valeurs invalides et les références mal associées sans écrire', () => {
    const storage = new MemoryStorage()
    for (const oneRepMaxKg of [0, -1, NaN, Infinity]) {
      assert.equal(mutatePersonalRecord({ ...mutation, oneRepMaxKg }, storage).ok, false)
    }
    assert.equal(mutatePersonalRecord({ ...mutation, original: clean }, storage).ok, false)
    assert.equal(mutatePersonalRecord({ ...mutation, exerciseId: 'unknown' } as RecordMutation, storage).ok, false)
    assert.equal(storage.writes, 0)
  })

  it('reste compatible avec export, restauration et calcul des charges', () => {
    const storage = new MemoryStorage()
    mutatePersonalRecord(mutation, storage)
    const backup = exportBackup(storage)
    assert.ok(backup.ok)
    const destination = new MemoryStorage()
    assert.equal(restoreBackup(backup.value.backup, destination).ok, true)
    assert.deepEqual(loadPersonalRecords(destination).records, [{ ...snatch, oneRepMaxKg: 110 }, clean])
    assert.deepEqual(getWorkoutSetLoad({ id: 'set', repsInput: '3', intensityInput: '75', rounding: { mode: 'exact' } },
      loadPersonalRecords(destination).records?.[0].oneRepMaxKg), { status: 'ready', exactKg: 82.5, selectedKg: 82.5 })
  })
})
