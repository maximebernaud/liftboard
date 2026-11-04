import { loadPersonalRecords, recordsStorageKey } from './personalRecords.ts'
import { loadWorkouts, workoutsStorageKey } from './workouts.ts'
import { backupFormat, backupSizeError, backupVersion, validateBackup, type BackupResult, type DataBackup } from '../lib/dataBackup.ts'
import { localDateString } from '../lib/workoutDraft.ts'

export type BackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type BackupExport = { backup: DataBackup; json: string; filename: string }
export type RestoreResult = { ok: true } | {
  ok: false
  error: string
  recovery: 'unchanged' | 'rolled-back' | 'uncertain'
}

export function exportBackup(storage?: BackupStorage, date = new Date()): BackupResult<BackupExport> {
  try {
    const target = storage ?? window.localStorage
    const records = loadPersonalRecords(target)
    const workouts = loadWorkouts(target)
    if (records.error !== null) return { ok: false, error: `Export impossible. ${records.error}` }
    if (!workouts.ok) return { ok: false, error: `Export impossible. ${workouts.error}` }
    const backup: DataBackup = {
      format: backupFormat, version: backupVersion, exportedAt: date.toISOString(),
      data: { records: records.records, workouts: workouts.workouts },
    }
    const json = JSON.stringify(backup, null, 2)
    const error = backupSizeError(new TextEncoder().encode(json).byteLength)
    if (error) return { ok: false, error: 'Export impossible : la sauvegarde dépasse la limite de 10 Mo. Vos données sont conservées.' }
    return { ok: true, value: { backup, json, filename: `liftboard-sauvegarde-${localDateString(date)}.json` } }
  } catch {
    return { ok: false, error: 'Export impossible : le stockage local est inaccessible ou les données sont illisibles. Aucune donnée modifiée.' }
  }
}

/** Deux écritures vérifiées ; retour au précédent état tenté, sans atomicité multiclés. */
export function restoreBackup(value: unknown, storage?: BackupStorage): RestoreResult {
  const validation = validateBackup(value)
  if (!validation.ok) return { ...validation, recovery: 'unchanged' }
  const keys = [recordsStorageKey, workoutsStorageKey]
  let target: BackupStorage
  let previous: (string | null)[]
  let next: string[]
  try {
    next = [JSON.stringify(validation.value.data.records), JSON.stringify(validation.value.data.workouts)]
    target = storage ?? window.localStorage
    // Conserver les octets d'origine, même si les données actuelles sont corrompues.
    previous = keys.map((key) => target.getItem(key))
  } catch {
    return { ok: false, recovery: 'unchanged', error: 'Impossible de lire le stockage actuel. Restauration annulée sans modification.' }
  }
  const attempted: number[] = []
  try {
    keys.forEach((key, index) => {
      attempted.push(index)
      target.setItem(key, next[index])
    })
    if (!keys.every((key, index) => target.getItem(key) === next[index])) throw new Error('Write verification failed')
    return { ok: true }
  } catch (error) {
    // Continuer la récupération des autres clés même si l'une d'elles échoue.
    for (const index of attempted.reverse()) {
      let unchanged = false
      try { unchanged = target.getItem(keys[index]) === previous[index] } catch { /* Tenter quand même la réécriture. */ }
      if (unchanged) continue
      try {
        if (previous[index] === null) target.removeItem(keys[index])
        else target.setItem(keys[index], previous[index])
      } catch { /* La vérification finale détermine l'état réellement récupéré. */ }
    }
    let recovered = false
    try { recovered = keys.every((key, index) => target.getItem(key) === previous[index]) } catch { /* État indéterminé. */ }
    const cause = error instanceof Error && error.name === 'QuotaExceededError' ? 'Stockage local plein.' : 'Échec de l’écriture ou de sa vérification.'
    return recovered ? {
      ok: false, recovery: 'rolled-back',
      error: `${cause} Restauration annulée ; les données précédentes ont été rétablies.`,
    } : {
      ok: false, recovery: 'uncertain',
      error: `${cause} Le retour aux données précédentes a aussi échoué. Le stockage peut contenir un mélange de données. Conservez votre fichier de sauvegarde et réessayez après avoir rétabli l’accès au stockage.`,
    }
  }
}
