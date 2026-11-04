import type { BackupExport } from '../data/backup.ts'
import { backupSizeError, parseBackup, type BackupResult, type DataBackup } from './dataBackup.ts'

export async function readBackupFile(file: File): Promise<BackupResult<DataBackup>> {
  const error = backupSizeError(file.size)
  if (error) return { ok: false, error }
  if (!/\.json$/i.test(file.name)) return { ok: false, error: 'Sélectionnez un fichier .json de sauvegarde LiftBoard.' }
  try { return parseBackup(await file.text()) } catch {
    return { ok: false, error: 'Impossible de lire ce fichier. Sélectionnez à nouveau une sauvegarde accessible.' }
  }
}

export function downloadBackup({ json, filename }: BackupExport): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    // Laisser au navigateur le temps de démarrer le téléchargement.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
