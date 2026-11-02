import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import type { RecordsLoadResult } from '../data/personalRecords'
import { createWorkout, deleteWorkout, loadWorkouts, sortWorkouts, updateWorkout } from '../data/workouts'
import { createWorkoutDraft, duplicateWorkoutDraft, validateWorkoutDraft, workoutToDraft } from '../lib/workoutDraft'
import type { Workout, WorkoutDraft } from '../types/workout'
import SectionIcon from './SectionIcon'
import WorkoutConfirmation from './WorkoutConfirmation'
import WorkoutDetail from './WorkoutDetail'
import WorkoutEditor from './WorkoutEditor'
import WorkoutQuickNotes from './WorkoutQuickNotes'
import './WorkoutEditor.css'

type WorkoutSessionsProps = {
  storedRecords: RecordsLoadResult
  onOpenRecords: () => void
}

function formatWorkoutDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

function WorkoutSessions({ storedRecords, onOpenRecords }: WorkoutSessionsProps) {
  const [stored, setStored] = useState(() => loadWorkouts())
  const [draft, setDraft] = useState<WorkoutDraft | null>(null)
  const [original, setOriginal] = useState<Workout | null>(null)
  const [duplicateSource, setDuplicateSource] = useState<string | null>(null)
  const [selected, setSelected] = useState<Workout | null>(null)
  const [view, setView] = useState<'list' | 'editor' | 'detail' | 'notes'>('list')
  const [hasEdits, setHasEdits] = useState(false)
  const [pendingNotes, setPendingNotes] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [discard, setDiscard] = useState<(() => void) | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const editorForm = useRef<HTMLFormElement>(null)
  const focusOnViewChange = useRef(false)

  useEffect(() => {
    if (focusOnViewChange.current) {
      heading.current?.focus({ preventScroll: true })
      focusOnViewChange.current = false
    }
  }, [view])

  useEffect(() => {
    if (!hasEdits && !pendingNotes) return
    function preventDraftLoss(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventDraftLoss)
    return () => window.removeEventListener('beforeunload', preventDraftLoss)
  }, [hasEdits, pendingNotes])

  function changeView(next: typeof view) {
    setError(null)
    focusOnViewChange.current = true
    setView(next)
  }

  function guardDraft(action: () => void) {
    if (hasEdits) setDiscard(() => action)
    else action()
  }

  function startWorkout() {
    guardDraft(() => {
      setDraft(createWorkoutDraft())
      setOriginal(null)
      setDuplicateSource(null)
      setHasEdits(false)
      setShowErrors(false)
      changeView('editor')
    })
  }

  function openWorkout(id: string, nextView: 'detail' | 'notes' = 'detail') {
    const current = loadWorkouts()
    if (!current.ok) { setError(current.error); return }
    setStored(current)
    const workout = current.workouts.find((item) => item.id === id)
    if (!workout) { setError('Cette séance n’existe plus. La liste a été actualisée.'); return }
    setSelected(workout)
    changeView(nextView)
  }

  function duplicateWorkout(id: string) {
    guardDraft(() => {
      const current = loadWorkouts()
      if (!current.ok) { setError(current.error); return }
      const source = current.workouts.find((item) => item.id === id)
      if (!source) { setError('Cette séance n’existe plus.'); return }
      setStored(current)
      setDraft(duplicateWorkoutDraft(source))
      setOriginal(null)
      setSelected(null)
      setDuplicateSource(source.title)
      setHasEdits(true)
      setShowErrors(false)
      changeView('editor')
      window.scrollTo({ top: 0, behavior: 'instant' })
    })
  }

  function editWorkout() {
    if (!selected) return
    guardDraft(() => {
      const current = loadWorkouts()
      if (!current.ok) { setError(current.error); return }
      const workout = current.workouts.find((item) => item.id === selected.id)
      if (!workout) { setError('Cette séance n’existe plus.'); return }
      setStored(current)
      setSelected(workout)
      setOriginal(workout)
      setDuplicateSource(null)
      setDraft(workoutToDraft(workout))
      setHasEdits(false)
      setShowErrors(false)
      changeView('editor')
    })
  }

  function cancelEditing() {
    guardDraft(() => {
      if (original) setSelected(stored.ok ? stored.workouts.find((item) => item.id === original.id) ?? original : original)
      setDraft(null)
      setOriginal(null)
      setDuplicateSource(null)
      setHasEdits(false)
      changeView(original ? 'detail' : 'list')
    })
  }

  function saveWorkout(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    setShowErrors(true)
    const validation = validateWorkoutDraft(draft, storedRecords.records ?? [])
    if (!validation.valid) {
      setError('Corrigez les champs indiqués avant d’enregistrer la séance.')
      requestAnimationFrame(() => editorForm.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    const result = original ? updateWorkout(validation.workout, original) : createWorkout(validation.workout)
    if (!result.ok) { setError(result.error); return }
    setStored(result)
    setDraft(null)
    setOriginal(null)
    setDuplicateSource(null)
    setHasEdits(false)
    changeView('list')
  }

  function confirmDelete() {
    if (!selected) return
    const result = deleteWorkout(selected.id)
    if (!result.ok) { setDeleteError(result.error); return }
    setStored(result)
    if (original?.id === selected.id) { setDraft(null); setOriginal(null); setHasEdits(false) }
    setSelected(null)
    setDeleting(false)
    changeView('list')
  }

  return (
    <div className="workout-sessions">
      {view === 'editor' && draft ? (
        <>
          <button className="record-button workout-back" type="button" onClick={() => changeView('list')}>
            <span aria-hidden="true">←</span> Retour aux séances
          </button>
          <div className="page-heading workout-heading">
            <h1 id="workout-page-title" ref={heading} tabIndex={-1}>{original ? 'Modifier la séance' : 'Nouvelle séance'}</h1>
            <p>{original ? (hasEdits ? 'Modifications non enregistrées' : 'Édition de la séance enregistrée') : 'Brouillon non enregistré'}</p>
            {duplicateSource && <p className="record-hint">Copie de « {duplicateSource} ». Charges calculées avec les Records actuels. Seules les notes Avant sont reprises ; Pendant et Après sont vides.</p>}
            <p className="record-hint">Saisies conservées pendant la navigation entre onglets. Enregistrez avant de recharger ou de quitter la page.</p>
          </div>
          <form ref={editorForm} className="workout-editor" onSubmit={saveWorkout} noValidate>
            <WorkoutEditor key={draft.id} draft={draft} storedRecords={storedRecords} onOpenRecords={onOpenRecords} showErrors={showErrors}
              onChange={(update) => {
                setDraft((current) => current ? update(current) : current)
                setHasEdits(true)
              }} />
            {error && <p className="record-error" role="alert">{error}</p>}
            <div className="workout-form-actions">
              <button className="record-button record-button-primary" type="submit">{original ? 'Enregistrer les modifications' : 'Enregistrer la séance'}</button>
              <button className="record-button" type="button" onClick={cancelEditing}>Annuler</button>
            </div>
          </form>
        </>
      ) : view === 'notes' && selected ? (
        <WorkoutQuickNotes key={selected.id} workout={selected} onPendingChange={setPendingNotes}
          onClose={() => changeView('list')} onSaved={(result) => {
            setStored(result)
            setSelected(result.workouts.find((item) => item.id === selected.id) ?? selected)
          }} />
      ) : view === 'detail' && selected ? (
        <>
          <button className="record-button workout-back" type="button" onClick={() => changeView('list')}><span aria-hidden="true">←</span> Retour aux séances</button>
          <div className="page-heading">
            <h1 id="workout-page-title" ref={heading} tabIndex={-1}>{selected.title}</h1>
            <p><time dateTime={selected.date}>{formatWorkoutDate(selected.date)}</time> · {selected.status === 'planned' ? 'Planifiée' : 'Terminée'}</p>
          </div>
          {error && <p className="record-error" role="alert">{error}</p>}
          <WorkoutDetail workout={selected} onEdit={editWorkout} onNotes={() => openWorkout(selected.id, 'notes')} onDelete={() => {
            setDeleteError(null)
            setDeleting(true)
          }} />
        </>
      ) : (
        <>
          <div className="page-heading workout-list-heading">
            <h1 id="workout-page-title" ref={heading} tabIndex={-1}>Mes séances</h1>
            <button className={`record-button${draft ? '' : ' record-button-primary'}`} type="button" onClick={startWorkout}>+ Nouvelle séance</button>
          </div>
          <p className="records-storage-note">Séances et notes enregistrées uniquement dans ce navigateur, sur cet appareil.</p>
          {draft && (
            <section className="workout-resume" aria-labelledby="workout-resume-title">
              <p className="record-hint">{original ? 'Édition en cours' : 'Brouillon non enregistré'} · en mémoire uniquement</p>
              <h2 id="workout-resume-title">{draft.title.trim() || 'Séance sans titre'}</h2>
              <button className="record-button record-button-primary" type="button" onClick={() => changeView('editor')}>{original ? 'Reprendre la modification' : 'Reprendre le brouillon'}</button>
            </section>
          )}
          {error && <p className="record-error" role="alert">{error}</p>}
          {!stored.ok ? (
            <div className="records-storage-error">
              <p className="record-error" role="alert">{stored.error}</p>
              <button className="record-button" type="button" onClick={() => setStored(loadWorkouts())}>Réessayer la lecture</button>
            </div>
          ) : stored.workouts.filter((item) => item.status === 'planned').length === 0 ? (
            <section className="empty-state" aria-labelledby="workouts-empty-title">
              <span className="empty-state-icon"><SectionIcon name="sessions" /></span>
              <h2 id="workouts-empty-title">Aucune séance planifiée</h2>
            </section>
          ) : (
            <ul className="workout-session-list">
              {sortWorkouts(stored.workouts.filter((item) => item.status === 'planned')).map((workout) => (
                <li key={workout.id}>
                  <article className="workout-details" aria-labelledby={`card-${workout.id}`}>
                    <div className="workout-block-heading">
                      <h2 id={`card-${workout.id}`}>{workout.title}</h2>
                      <span className="workout-status">Planifiée</span>
                    </div>
                    <p className="record-hint"><time dateTime={workout.date}>{formatWorkoutDate(workout.date)}</time> · {workout.exercises.length} exercice{workout.exercises.length > 1 ? 's' : ''}</p>
                    <div className="workout-card-actions workout-session-actions">
                      <button className="record-button record-button-primary" type="button" aria-label={`Ouvrir : ${workout.title}`} onClick={() => openWorkout(workout.id)}>Ouvrir</button>
                      <button className="record-button" type="button" aria-label={`Notes : ${workout.title}`} onClick={() => openWorkout(workout.id, 'notes')}>Notes</button>
                      <button className="record-button workout-duplicate" type="button" aria-label={`Dupliquer : ${workout.title}`} onClick={() => duplicateWorkout(workout.id)}>Dupliquer</button>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {deleting && selected && (
        <WorkoutConfirmation title="Supprimer cette séance ?" confirmLabel="Supprimer la séance" error={deleteError}
          onCancel={() => setDeleting(false)} onConfirm={confirmDelete}>
          <p><strong>{selected.title}</strong> du {formatWorkoutDate(selected.date)} et ses notes seront définitivement supprimées.</p>
        </WorkoutConfirmation>
      )}
      {discard && (
        <WorkoutConfirmation title="Abandonner les modifications ?" confirmLabel="Abandonner les modifications"
          onCancel={() => setDiscard(null)} onConfirm={() => { setDiscard(null); discard() }}>
          <p>Les saisies non enregistrées de <strong>{draft?.title.trim() || 'cette séance'}</strong> seront perdues. La version enregistrée sera conservée.</p>
        </WorkoutConfirmation>
      )}
    </div>
  )
}

export default WorkoutSessions
