import { useEffect, useRef, useState } from 'react'
import { exercises } from '../data/personalRecords'
import { loadWorkouts, reopenWorkout, sortWorkouts, type WorkoutsResult } from '../data/workouts'
import { getWorkoutProgress } from '../lib/workoutExecution'
import { filterWorkoutHistory, formatWorkoutDate, type HistoryFilters } from '../lib/workoutHistory'
import type { Workout } from '../types/workout'
import SectionIcon from './SectionIcon'
import WorkoutConfirmation from './WorkoutConfirmation'
import WorkoutDetail from './WorkoutDetail'
import WorkoutQuickNotes from './WorkoutQuickNotes'

type SavedResult = Extract<WorkoutsResult, { ok: true }>
export type HistoryView = { workoutId: string | null; notes: boolean }

export default function WorkoutHistory({ stored, onStoredChange, onSessions, onReopened, filters, onFiltersChange, view, onViewChange, onPendingChange }: {
  stored: WorkoutsResult
  onStoredChange: (result: WorkoutsResult) => void
  onSessions: () => void
  onReopened: (result: SavedResult, id: string) => void
  filters: HistoryFilters
  onFiltersChange: (filters: HistoryFilters) => void
  view: HistoryView
  onViewChange: (view: HistoryView) => void
  onPendingChange: (pending: boolean) => void
}) {
  const selectedId = view.workoutId
  const [notesWorkout, setNotesWorkout] = useState<Workout | null>(null)
  const [pendingNotes, setPendingNotes] = useState(false)
  const [reopening, setReopening] = useState<Workout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const notesPanel = useRef<HTMLDivElement>(null)
  const selected = stored.ok ? stored.workouts.find((item) => item.id === selectedId && item.status === 'completed') : null
  const completed = stored.ok ? stored.workouts.filter((item) => item.status === 'completed') : []
  const filtered = sortWorkouts(filterWorkoutHistory(completed, filters))
  const hasFilters = Boolean(filters.exerciseId || filters.date)
  useEffect(() => { onPendingChange(pendingNotes) }, [pendingNotes, onPendingChange])

  useEffect(() => {
    if (!pendingNotes) return
    function preventNoteLoss(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventNoteLoss)
    return () => window.removeEventListener('beforeunload', preventNoteLoss)
  }, [pendingNotes])

  function focusHeading() {
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }))
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  function openWorkout(id: string) {
    const current = loadWorkouts()
    onStoredChange(current)
    if (!current.ok) return
    if (!current.workouts.some((item) => item.id === id && item.status === 'completed')) {
      setError('Cette séance n’est plus dans l’Historique. La liste a été actualisée.')
      return
    }
    onViewChange({ workoutId: id, notes: false })
    setError(null)
    focusHeading()
  }

  function returnToList() {
    onViewChange({ workoutId: null, notes: false })
    setError(null)
    onStoredChange(loadWorkouts())
    focusHeading()
  }

  function resumeNotes() {
    if (!notesWorkout) return
    onViewChange({ workoutId: notesWorkout.id, notes: true })
    requestAnimationFrame(() => notesPanel.current?.querySelector('textarea')?.focus({ preventScroll: true }))
  }

  return (
    <div className="workout-sessions workout-history">
      {notesWorkout && (
        <div ref={notesPanel} hidden={!view.notes}>
          <WorkoutQuickNotes key={notesWorkout.id} workout={notesWorkout} headingId={view.notes ? 'history-page-title' : 'history-notes-page-title'}
            returnLabel="Retour à la séance" onPendingChange={setPendingNotes} onSaved={onStoredChange}
            onClose={() => { setNotesWorkout(null); onViewChange({ workoutId: notesWorkout.id, notes: false }); onStoredChange(loadWorkouts()); focusHeading() }} />
        </div>
      )}
      {!view.notes && (
        <>
          {selectedId && <button className="record-button workout-back" type="button" onClick={returnToList}><span aria-hidden="true">←</span> Retour à l’historique</button>}
          <div className="page-heading">
            <h1 id="history-page-title" ref={heading} tabIndex={-1}>{selected?.title ?? 'Historique'}</h1>
            {selected && <p><time dateTime={selected.date}>{formatWorkoutDate(selected.date)}</time> · <span className="workout-status workout-execution-completed">✓ Terminée</span></p>}
          </div>
          {error && <p className="record-error" role="alert">{error}</p>}
          {notesWorkout && pendingNotes && <div className="workout-resume">
            <p className="record-hint">Une note non enregistrée de « {notesWorkout.title} » est conservée en mémoire.</p>
            <button className="record-button" type="button" onClick={resumeNotes}>Reprendre les notes en attente</button>
          </div>}
          {!stored.ok ? (
            <div className="records-storage-error">
              <p className="record-error" role="alert">{stored.error}</p>
              <button className="record-button" type="button" onClick={() => onStoredChange(loadWorkouts())}>Réessayer la lecture</button>
            </div>
          ) : selectedId ? selected ? (
            <WorkoutDetail workout={selected} onNotes={() => {
              // Ne pas remplacer une note en échec lorsqu'une autre séance est consultée.
              if (notesWorkout && pendingNotes) { resumeNotes(); return }
              setNotesWorkout(selected)
              onViewChange({ workoutId: selected.id, notes: true })
            }}
              onReopen={() => { setReopening(selected); setError(null) }} />
          ) : (
            <p className="record-error" role="alert">Cette séance a été réouverte ou supprimée ailleurs. Revenez à la liste pour consulter les séances actuelles.</p>
          ) : (
            <>
              <p className="records-storage-note">Date de séance renseignée lors de la préparation. Données conservées uniquement dans ce navigateur, sur cet appareil.</p>
              {completed.length === 0 ? (
                <section className="empty-state" aria-labelledby="history-empty-title">
                  <span className="empty-state-icon"><SectionIcon name="history" /></span>
                  <h2 id="history-empty-title">Aucune séance terminée pour le moment.</h2>
                  <button className="record-button" type="button" onClick={onSessions}>Retour aux séances</button>
                </section>
              ) : (
                <>
                  <section className="workout-details workout-history-filters" aria-label="Filtres de l’historique">
                    <div className="workout-details-fields">
                      <div className="workout-field">
                        <label htmlFor="history-exercise">Exercice</label>
                        <select id="history-exercise" value={filters.exerciseId} onChange={(event) =>
                          onFiltersChange({ ...filters, exerciseId: event.target.value as HistoryFilters['exerciseId'] })}>
                          <option value="">Tous les exercices</option>
                          {exercises.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
                        </select>
                      </div>
                      <div className="workout-field">
                        <label htmlFor="history-date">Date de séance</label>
                        <input id="history-date" type="date" value={filters.date} onChange={(event) =>
                          onFiltersChange({ ...filters, date: event.target.value })} />
                      </div>
                    </div>
                    {hasFilters && <button className="record-button" type="button" onClick={() => onFiltersChange({ exerciseId: '', date: '' })}>Réinitialiser les filtres</button>}
                  </section>
                  <p className="record-hint" role="status">{filtered.length} séance{filtered.length > 1 ? 's' : ''} affichée{filtered.length > 1 ? 's' : ''}</p>
                  {filtered.length === 0 ? (
                    <section className="empty-state" aria-labelledby="history-filter-empty-title">
                      <h2 id="history-filter-empty-title">Aucune séance ne correspond à ces filtres.</h2>
                      <button className="record-button" type="button" onClick={() => onFiltersChange({ exerciseId: '', date: '' })}>Effacer les filtres</button>
                    </section>
                  ) : (
                    <ul className="workout-session-list">
                      {filtered.map((workout) => {
                        const progress = getWorkoutProgress(workout)
                        return <li key={workout.id}>
                          <article className="workout-details" aria-labelledby={`history-card-${workout.id}`}>
                            <div className="workout-block-heading">
                              <h2 id={`history-card-${workout.id}`}>{workout.title}</h2>
                              <span className="workout-status workout-execution-completed">✓ Terminée</span>
                            </div>
                            <p className="record-hint"><time dateTime={workout.date}>{formatWorkoutDate(workout.date)}</time> · {workout.exercises.length} exercice{workout.exercises.length > 1 ? 's' : ''}</p>
                            <p>{progress.completed} série{progress.completed > 1 ? 's' : ''} réalisée{progress.completed > 1 ? 's' : ''} sur {progress.total}</p>
                            <button className="record-button workout-consult" type="button" aria-label={`Consulter la séance : ${workout.title}`} onClick={() => openWorkout(workout.id)}>Consulter la séance</button>
                          </article>
                        </li>
                      })}
                    </ul>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
      {reopening && <WorkoutConfirmation title="Réouvrir cette séance ?" confirmLabel="Réouvrir la séance" destructive={false}
        error={error} onCancel={() => { setReopening(null); setError(null) }} onConfirm={() => {
          const result = reopenWorkout(reopening)
          if (!result.ok) { setError(result.error); return }
          setReopening(null)
          onViewChange({ workoutId: null, notes: false })
          setError(null)
          onReopened(result, reopening.id)
        }}>
        <p><strong>{reopening.title}</strong> redeviendra planifiée et quittera l’Historique. Vous pourrez reprendre son suivi.</p>
        <p>Toutes les performances, les notes et la programmation seront conservées.</p>
      </WorkoutConfirmation>}
    </div>
  )
}
