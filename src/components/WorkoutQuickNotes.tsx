import { useRef, useState } from 'react'
import { updateWorkoutNotes, type WorkoutsResult } from '../data/workouts'
import type { Workout, WorkoutNoteCategory, WorkoutNotes } from '../types/workout'
import WorkoutConfirmation from './WorkoutConfirmation'
import WorkoutNotesFields from './WorkoutNotesFields'

export default function WorkoutQuickNotes({ workout, onSaved, onPendingChange, onClose, returnLabel = 'Retour aux séances' }: {
  workout: Workout
  onSaved: (result: Extract<WorkoutsResult, { ok: true }>) => void
  onPendingChange: (pending: boolean) => void
  onClose: () => void
  returnLabel?: string
}) {
  const [notes, setNotes] = useState<WorkoutNotes>(() => ({ ...workout.notes }))
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const pending = useRef<Partial<WorkoutNotes>>({})

  // Synchrone : l'écriture est terminée avant que l'utilisateur puisse fermer.
  // Seules les catégories saisies et non encore sauvegardées sont fusionnées.
  function persist(patch: Partial<WorkoutNotes>) {
    pending.current = patch
    const result = updateWorkoutNotes(workout.id, patch)
    if (!result.ok) {
      setError(result.error)
      onPendingChange(true)
      return
    }
    pending.current = {}
    setError(null)
    onPendingChange(false)
    onSaved(result)
  }

  function changeNote(category: WorkoutNoteCategory, text: string) {
    setNotes((current) => ({ ...current, [category]: text }))
    persist({ ...pending.current, [category]: text })
  }

  return (
    <>
      <button className="record-button workout-back" type="button" onClick={() => {
        if (Object.keys(pending.current).length) setConfirmClose(true)
        else onClose()
      }}><span aria-hidden="true">←</span> {returnLabel}</button>
      <div className="page-heading">
        <h1 id="workout-page-title">Notes de séance</h1>
        <p>{workout.title}</p>
      </div>
      <section className="workout-details" aria-label="Notes rapides">
        <WorkoutNotesFields notes={notes} onChange={changeNote} initialCategory="during" focusOnMount />
        {error ? (
          <div className="workout-notes-error">
            <p className="record-error" role="alert">Non enregistré. {error}</p>
            <p className="record-hint">La saisie reste disponible ici en mémoire. Recharger ou quitter cette page la ferait perdre.</p>
            <button className="record-button" type="button" onClick={() => persist(pending.current)}>Réessayer</button>
          </div>
        ) : (
          <p className="record-hint">Sauvegarde automatique locale · dans ce navigateur, sur cet appareil.</p>
        )}
      </section>
      {confirmClose && (
        <WorkoutConfirmation title="Quitter sans enregistrer ?" confirmLabel="Abandonner la saisie"
          onCancel={() => setConfirmClose(false)} onConfirm={() => { onPendingChange(false); onClose() }}>
          <p>Les dernières notes de <strong>{workout.title}</strong> n’ont pas pu être enregistrées. Restez sur cette vue pour réessayer, ou abandonnez explicitement la saisie non sauvegardée.</p>
        </WorkoutConfirmation>
      )}
    </>
  )
}
