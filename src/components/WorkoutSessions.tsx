import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import type { RecordsLoadResult } from '../data/personalRecords'
import { createWorkout, deleteWorkout, loadWorkouts, sortWorkouts, updateWorkout, type WorkoutsResult } from '../data/workouts'
import { createWorkoutDraft, duplicateWorkoutDraft, validateWorkoutDraft, workoutToDraft } from '../lib/workoutDraft'
import { hasWorkoutExecution } from '../lib/workoutExecution'
import { formatWorkoutDate } from '../lib/workoutHistory'
import type { Workout, WorkoutDraft } from '../types/workout'
import SectionIcon from './SectionIcon'
import WorkoutConfirmation from './WorkoutConfirmation'
import WorkoutDetail from './WorkoutDetail'
import WorkoutEditor from './WorkoutEditor'
import WorkoutExecution from './WorkoutExecution'
import WorkoutQuickNotes from './WorkoutQuickNotes'
import './WorkoutEditor.css'

export type WorkoutSessionsScreen = {
  selected: Workout | null
  view: 'list' | 'editor' | 'detail' | 'notes' | 'tracking'
}

type WorkoutSessionsProps = {
  storedRecords: RecordsLoadResult
  onOpenRecords: () => void
  screen: WorkoutSessionsScreen
  onScreenChange: (update: (current: WorkoutSessionsScreen) => WorkoutSessionsScreen) => void
  onTrackingChange: (id: string | null) => void
  stored: WorkoutsResult
  onStoredChange: (result: WorkoutsResult) => void
  onCompleted: (result: Extract<WorkoutsResult, { ok: true }>, id: string) => void
}

function WorkoutSessions({ storedRecords, onOpenRecords, screen, onScreenChange, onTrackingChange, stored, onStoredChange: setStored, onCompleted }: WorkoutSessionsProps) {
  const [draft, setDraft] = useState<WorkoutDraft | null>(null)
  const [original, setOriginal] = useState<Workout | null>(null)
  const [duplicateSource, setDuplicateSource] = useState<string | null>(null)
  const { selected, view } = screen
  const setSelected = (selected: Workout | null) => onScreenChange((current) => ({ ...current, selected }))
  const setView = (view: WorkoutSessionsScreen['view']) => onScreenChange((current) => ({ ...current, view }))
  const [notesReturn, setNotesReturn] = useState<'list' | 'tracking'>('list')
  const [hasEdits, setHasEdits] = useState(false)
  const [pendingNotes, setPendingNotes] = useState(false)
  const [pendingExecution, setPendingExecution] = useState(false)
  const [discardExecution, setDiscardExecution] = useState<(() => void) | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [discard, setDiscard] = useState<(() => void) | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const editorForm = useRef<HTMLFormElement>(null)
  const focusOnViewChange = useRef(false)
  const editable = stored.ok && stored.workouts.some((item) => item.id === selected?.id && item.status === 'planned')
  const unavailable = selected && !editable && (view === 'tracking' || view === 'detail')
  const trackingId = editable && (view === 'tracking' || (view === 'notes' && notesReturn === 'tracking')) ? selected?.id ?? null : null

  useEffect(() => { onTrackingChange(trackingId) }, [onTrackingChange, trackingId])

  useEffect(() => {
    if (focusOnViewChange.current) {
      heading.current?.focus({ preventScroll: true })
      focusOnViewChange.current = false
    }
  }, [view])

  useEffect(() => {
    if (!hasEdits && !pendingNotes && !pendingExecution) return
    function preventDraftLoss(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventDraftLoss)
    return () => window.removeEventListener('beforeunload', preventDraftLoss)
  }, [hasEdits, pendingNotes, pendingExecution])

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

  function openWorkout(id: string, nextView: 'detail' | 'notes' | 'tracking' = 'detail') {
    const current = loadWorkouts()
    if (!current.ok) { setError(current.error); return }
    setStored(current)
    const workout = current.workouts.find((item) => item.id === id)
    if (!workout) { setError('Cette séance n’existe plus. La liste a été actualisée.'); return }
    if (workout.status !== 'planned') { setError('Cette séance est terminée. Consultez-la dans l’Historique.'); return }
    setSelected(workout)
    if (nextView === 'notes') setNotesReturn('list')
    changeView(nextView)
  }

  function leaveTracking(nextView: 'detail' | 'list') {
    const leave = () => { setPendingExecution(false); changeView(nextView) }
    if (pendingExecution) setDiscardExecution(() => leave)
    else leave()
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
      if (hasWorkoutExecution(workout)) {
        setError('Le suivi a commencé : la programmation est protégée pour conserver les résultats. Les notes restent modifiables ; dupliquez la séance pour préparer une autre programmation.')
        return
      }
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
      {selected && (view === 'tracking' || (view === 'notes' && notesReturn === 'tracking')) && (
        <div hidden={view !== 'tracking' || !editable}>
          <WorkoutExecution key={selected.id} initialWorkout={selected} active={view === 'tracking' && editable} editable={editable} onPendingChange={setPendingExecution}
            onSaved={(result) => {
              setStored(result)
              setSelected(result.workouts.find((item) => item.id === selected.id) ?? selected)
            }} onCompleted={(result) => {
              setPendingExecution(false)
              setSelected(null)
              changeView('list')
              onCompleted(result, selected.id)
            }} onBack={() => leaveTracking('detail')} onList={() => leaveTracking('list')}
            onNotes={() => { setNotesReturn('tracking'); changeView('notes') }} />
        </div>
      )}
      {unavailable ? (
        <>
          <h1 id="workout-page-title">Séance indisponible pour le suivi</h1>
          <p className="record-error" role="alert">{!stored.ok ? stored.error : 'Cette séance a été terminée ou supprimée ailleurs. Le suivi est bloqué. Consultez la liste actuelle ou l’Historique. Les saisies en cours restent en mémoire jusqu’à votre départ du suivi.'}</p>
          <button className="record-button" type="button" onClick={() => leaveTracking('list')}>Retour aux séances</button>
        </>
      ) : view === 'tracking' ? null : view === 'editor' && draft ? (
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
          returnLabel={notesReturn === 'tracking' ? 'Retour au suivi' : 'Retour aux séances'}
          onClose={() => changeView(notesReturn)} onSaved={(result) => {
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
          <WorkoutDetail workout={selected} onTrack={() => openWorkout(selected.id, 'tracking')} onEdit={editWorkout} onNotes={() => openWorkout(selected.id, 'notes')} onDelete={() => {
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
      {discardExecution && (
        <WorkoutConfirmation title="Quitter sans enregistrer ?" confirmLabel="Abandonner la saisie"
          onCancel={() => setDiscardExecution(null)} onConfirm={() => { setDiscardExecution(null); discardExecution() }}>
          <p>Certaines performances ne sont pas enregistrées. Les saisies invalides, corrections en cours ou écritures en échec seront perdues. Restez dans le suivi pour les corriger ou réessayer. Les résultats déjà enregistrés seront conservés.</p>
        </WorkoutConfirmation>
      )}
    </div>
  )
}

export default WorkoutSessions
