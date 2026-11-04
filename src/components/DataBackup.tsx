import { useEffect, useRef, useState } from 'react'
import { exportBackup, restoreBackup } from '../data/backup'
import { downloadBackup, readBackupFile } from '../lib/backupFile'
import { backupSummary, type DataBackup as Backup } from '../lib/dataBackup'
import WorkoutConfirmation from './WorkoutConfirmation'
import './DataBackup.css'

export type BackupNotice = { message: string; error: boolean } | null

type Props = {
  restoreBlocked: boolean
  notice: BackupNotice
  onNoticeChange: (notice: BackupNotice) => void
  onRestored: () => void
  onRecoveryFailed: (error: string) => void
}

const pendingMessage = 'Une saisie est encore en cours dans Séances, Records ou Historique. Enregistrez-la ou abandonnez-la explicitement dans son onglet avant de restaurer.'

export default function DataBackup({ restoreBlocked, notice, onNoticeChange, onRestored, onRecoveryFailed }: Props) {
  const [preview, setPreview] = useState<{ backup: Backup; filename: string } | null>(null)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const restoreButton = useRef<HTMLButtonElement>(null)
  const readId = useRef(0)
  useEffect(() => () => { readId.current++ }, [])

  function exportCurrent() {
    onNoticeChange(null)
    const result = exportBackup()
    if (!result.ok) { setError(result.error); return }
    try {
      downloadBackup(result.value)
      setError(null)
      onNoticeChange({ message: 'Téléchargement lancé. Vérifie que ta sauvegarde apparaît dans tes téléchargements.', error: false })
    } catch {
      setError('Impossible de lancer le téléchargement. Vos données sont conservées ; réessayez.')
    }
  }

  async function selectFile(file: File) {
    const id = ++readId.current
    setPreview(null)
    setError(null)
    onNoticeChange(null)
    setReading(true)
    const result = await readBackupFile(file)
    if (id !== readId.current) return
    setReading(false)
    if (!result.ok) { setError(result.error); return }
    setPreview({ backup: result.value, filename: file.name })
  }

  function confirmRestore() {
    if (!preview) return
    if (restoreBlocked) { setError(pendingMessage); return }
    const result = restoreBackup(preview.backup)
    if (result.ok) { onRestored(); return }
    if (result.recovery === 'uncertain') { onRecoveryFailed(result.error); return }
    setError(result.error)
  }

  const summary = preview ? backupSummary(preview.backup) : null
  return (
    <section className="data-backup" aria-labelledby="data-backup-title" aria-busy={reading}>
      <h2 id="data-backup-title">Sauvegarder mes entraînements</h2>
      <p className="record-hint">Télécharge une copie de tes records, séances et notes pour pouvoir les retrouver si tu changes d'appareil ou de navigateur chiby 🤞</p>
      <div className="data-backup-actions">
        <button className="record-button" type="button" onClick={exportCurrent}>Récupérer mes données</button>
        <button ref={restoreButton} className="record-button" type="button" disabled={reading} aria-haspopup="dialog" onClick={() => fileInput.current?.click()}>Restaurer une sauvegarde</button>
      </div>
      <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Fichier de sauvegarde LiftBoard" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = '' // Autoriser une nouvelle sélection du même fichier après une erreur.
        if (file) void selectFile(file)
      }} />
      <p className="record-hint">Seules tes données déjà enregistrées sont sauvegardées. Pense à conserver ton fichier en lieu sûr la zez.</p>
      {restoreBlocked && <p className="record-hint">{pendingMessage}</p>}
      {reading && <p className="record-hint" role="status">Lecture et vérification de la sauvegarde…</p>}
      {notice && !preview && <p className={notice.error ? 'record-error' : 'data-backup-notice'} role={notice.error ? 'alert' : 'status'}>{notice.message}</p>}
      {error && !preview && <p className="record-error" role="alert">{error}</p>}
      {preview && summary && (
        <WorkoutConfirmation title="Restaurer cette sauvegarde ?" confirmLabel="Restaurer mes données" error={error}
          onCancel={() => {
            setPreview(null)
            setError(null)
            onNoticeChange(null)
            requestAnimationFrame(() => restoreButton.current?.focus({ preventScroll: true }))
          }} onConfirm={confirmRestore}>
          <p className="data-backup-filename">{preview.filename}</p>
          <dl className="data-backup-summary">
            <div><dt>Records</dt><dd>{summary.records}</dd></div>
            <div><dt>Séances planifiées</dt><dd>{summary.planned}</dd></div>
            <div><dt>Séances terminées</dt><dd>{summary.completed}</dd></div>
          </dl>
          <p>Restaurer cette sauvegarde remplacera vos Records et vos séances actuellement enregistrés sur cet appareil. Cette opération ne peut pas être annulée automatiquement.</p>
          {restoreBlocked && <p className="record-error">{pendingMessage}</p>}
          <button className="record-button data-backup-export-current" type="button" onClick={exportCurrent}>Sauvegarder mes données actuelles</button>
          {notice && <p className="record-hint" role="status">{notice.message}</p>}
        </WorkoutConfirmation>
      )}
    </section>
  )
}
