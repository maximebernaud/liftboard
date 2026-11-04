import { isPersonalRecords, type PersonalRecord } from '../data/personalRecords.ts'
import { isWorkouts } from '../data/workouts.ts'
import type { Workout } from '../types/workout.ts'

export const backupFormat = 'liftboard.backup'
export const backupVersion = 1
export const maxBackupBytes = 10 * 1024 * 1024

export type DataBackup = {
  format: typeof backupFormat
  version: typeof backupVersion
  exportedAt: string
  data: { records: PersonalRecord[]; workouts: Workout[] }
}
export type BackupResult<T> = { ok: true; value: T } | { ok: false; error: string }

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Même validation de lecture que l'application, sans recalcul ni migration. */
export function validateBackup(value: unknown): BackupResult<DataBackup> {
  if (!object(value) || value.format !== backupFormat) {
    return { ok: false, error: 'Ce fichier n’est pas une sauvegarde LiftBoard.' }
  }
  if (value.version !== backupVersion) {
    return { ok: false, error: 'Version de sauvegarde incompatible. Seule la version 1 est prise en charge.' }
  }
  if (typeof value.exportedAt !== 'string' || !Number.isFinite(Date.parse(value.exportedAt)) ||
    new Date(value.exportedAt).toISOString() !== value.exportedAt) {
    return { ok: false, error: 'La date d’export de la sauvegarde est invalide.' }
  }
  if (!object(value.data) || !isPersonalRecords(value.data.records) || !isWorkouts(value.data.workouts)) {
    return { ok: false, error: 'Sauvegarde invalide : Records, séances, séries ou identifiants incohérents. Aucune donnée modifiée.' }
  }
  return { ok: true, value: value as DataBackup }
}

export function backupSizeError(bytes: number): string | null {
  return bytes > maxBackupBytes ? 'Le fichier dépasse la limite de 10 Mo. Aucune donnée modifiée.'
    : bytes <= 0 ? 'Le fichier est vide. Sélectionnez une sauvegarde JSON LiftBoard.' : null
}

export function parseBackup(text: string): BackupResult<DataBackup> {
  const error = backupSizeError(new TextEncoder().encode(text).byteLength)
  if (error) return { ok: false, error }
  let value: unknown
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')) } catch {
    return { ok: false, error: 'Le fichier ne contient pas un JSON valide. Aucune donnée modifiée.' }
  }
  return validateBackup(value)
}

export function backupSummary(backup: DataBackup) {
  return {
    records: backup.data.records.length,
    planned: backup.data.workouts.filter((workout) => workout.status === 'planned').length,
    completed: backup.data.workouts.filter((workout) => workout.status === 'completed').length,
  }
}
