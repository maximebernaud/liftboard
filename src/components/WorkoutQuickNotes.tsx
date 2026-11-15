import { useRef,useState } from 'react'
import { updateWorkoutNotes,type WorkoutsResult } from '../data/workouts'
import type { Workout,WorkoutNoteCategory,WorkoutNotes } from '../types/workout'
import WorkoutConfirmation from './WorkoutConfirmation'
import WorkoutNotesFields from './WorkoutNotesFields'

export default function WorkoutQuickNotes({ workout,onSaved,onPendingChange,onClose,returnLabel='Retour aux séances',headingId='workout-page-title',forge=false }: {
  workout: Workout
  onSaved: (result: Extract<WorkoutsResult,{ ok: true }>) => void
  onPendingChange: (pending: boolean) => void
  onClose: () => void
  returnLabel?: string
  headingId?: string
  forge?: boolean
}) {
  const [notes,setNotes]=useState<WorkoutNotes>(() => ({ ...workout.notes }))
  const [error,setError]=useState<string|null>(null)
  const [confirmClose,setConfirmClose]=useState(false)
  const pending=useRef<Partial<WorkoutNotes>>({})
  const savedNotes=useRef(workout.notes)

  // Synchrone : l'écriture est terminée avant que l'utilisateur puisse fermer.
  // Seules les catégories saisies et non encore sauvegardées sont fusionnées.
  function persist(patch: Partial<WorkoutNotes>) {
    pending.current=patch
    const result=updateWorkoutNotes(workout.id,patch,undefined,savedNotes.current)
    if(!result.ok) {
      setError(result.error)
      onPendingChange(true)
      return
    }
    pending.current={}
    savedNotes.current=result.workouts.find((item) => item.id===workout.id)!.notes
    setNotes({ ...savedNotes.current })
    setError(null)
    onPendingChange(false)
    onSaved(result)
  }

  function changeNote(category: WorkoutNoteCategory,text: string) {
    setNotes((current) => ({ ...current,[category]: text }))
    persist({ ...pending.current,[category]: text })
  }

  const backButton=<button className={`record-button workout-back${forge? ' workout-notes-back':''}`} type="button" onClick={() => {
    if(Object.keys(pending.current).length) setConfirmClose(true)
    else onClose()
  }}><span aria-hidden="true">←</span> {returnLabel}</button>

  return (
    <>
      <div className={forge? 'workout-quick-notes':undefined}>
        {!forge&&backButton}
        <div className={`page-heading${forge? ' forge-heading workout-notes-heading':''}`}>
          {forge&&<p className="forge-kicker">Journal / Notes</p>}
          <h1 id={headingId}>Notes de séance</h1>
          <p>{workout.title}</p>
        </div>
        {forge&&backButton}
        <section className="workout-details" aria-label="Notes rapides">
          {forge&&<h2 className="sessions-section-title">Moment de la séance</h2>}
          <WorkoutNotesFields notes={notes} onChange={changeNote} initialCategory={workout.status==='completed'? 'after':'during'} focusOnMount />
          {error? (
            <div className="workout-notes-error">
              <p className="record-error" role="alert">Non enregistré. {error}</p>
              <p className="record-hint">La saisie reste disponible ici en mémoire. Recharger ou quitter cette page la ferait perdre.</p>
              <button className="record-button" type="button" onClick={() => persist(pending.current)}>Réessayer</button>
            </div>
          ):(
            <p className="record-hint">Sauvegarde automatique locale · dans ce navigateur, sur cet appareil.</p>
          )}
        </section>
      </div>
      {confirmClose&&(
        <WorkoutConfirmation title="Quitter sans enregistrer ?" confirmLabel="Abandonner la saisie"
          onCancel={() => setConfirmClose(false)} onConfirm={() => { onPendingChange(false); onClose() }}>
          <p>Les dernières notes de <strong>{workout.title}</strong> n’ont pas pu être enregistrées. Restez sur cette vue pour réessayer, ou abandonnez explicitement la saisie non sauvegardée.</p>
        </WorkoutConfirmation>
      )}
    </>
  )
}
