import { useEffect, useRef, useState } from 'react'
import type { RecordsLoadResult } from '../data/personalRecords'
import { createWorkoutDraft } from '../lib/workoutDraft'
import type { WorkoutDraft } from '../types/workout'
import SectionIcon from './SectionIcon'
import WorkoutEditor from './WorkoutEditor'
import './WorkoutEditor.css'

type WorkoutSessionsProps = {
  storedRecords: RecordsLoadResult
  onOpenRecords: () => void
}

function WorkoutSessions({ storedRecords, onOpenRecords }: WorkoutSessionsProps) {
  const [draft, setDraft] = useState<WorkoutDraft | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [hasEdits, setHasEdits] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusOnViewChange = useRef(false)

  useEffect(() => {
    if (focusOnViewChange.current) {
      heading.current?.focus({ preventScroll: true })
      focusOnViewChange.current = false
    }
  }, [editorOpen])

  // Le brouillon n'est jamais écrit dans localStorage. Le navigateur prévient
  // avant un rechargement ou une fermeture qui ferait perdre les saisies.
  useEffect(() => {
    if (!hasEdits) return
    function preventDraftLoss(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventDraftLoss)
    return () => window.removeEventListener('beforeunload', preventDraftLoss)
  }, [hasEdits])

  function changeView(open: boolean) {
    focusOnViewChange.current = true
    setEditorOpen(open)
  }

  function confirmDiscard(): boolean {
    return !hasEdits || window.confirm('Abandonner ce brouillon non enregistré ? Toutes ses saisies seront perdues.')
  }

  function startWorkout() {
    if (!confirmDiscard()) return
    setDraft(createWorkoutDraft())
    setHasEdits(false)
    changeView(true)
  }

  return (
    <div className="workout-sessions">
      {editorOpen && draft ? (
        <>
          <button className="record-button workout-back" type="button" onClick={() => changeView(false)}>
            <span aria-hidden="true">←</span> Retour aux séances
          </button>
          <div className="page-heading workout-heading">
            <h1 id="workout-page-title" ref={heading} tabIndex={-1}>Nouvelle séance</h1>
            <p>Brouillon non enregistré</p>
            <p className="record-hint">Conservé pendant la navigation entre onglets. Recharger ou quitter la page le supprime.</p>
          </div>
          <WorkoutEditor
            key={draft.id}
            draft={draft}
            storedRecords={storedRecords}
            onOpenRecords={onOpenRecords}
            onChange={(update) => {
              setDraft((current) => current ? update(current) : current)
              setHasEdits(true)
            }}
          />
          <button
            className="record-button record-button-delete workout-discard"
            type="button"
            onClick={() => {
              if (!confirmDiscard()) return
              setDraft(null)
              setHasEdits(false)
              changeView(false)
            }}
          >
            Abandonner le brouillon
          </button>
        </>
      ) : (
        <>
          <div className="page-heading workout-list-heading">
            <h1 id="workout-page-title" ref={heading} tabIndex={-1}>Mes séances</h1>
            <button
              className={`record-button${draft ? '' : ' record-button-primary'}`}
              type="button"
              onClick={startWorkout}
            >
              + Nouvelle séance
            </button>
          </div>
          {draft && (
            <section className="workout-resume" aria-labelledby="workout-resume-title">
              <p className="record-hint">Brouillon non enregistré · en mémoire uniquement</p>
              <h2 id="workout-resume-title">{draft.title.trim() || 'Séance sans titre'}</h2>
              <button className="record-button record-button-primary" type="button" onClick={() => changeView(true)}>
                Reprendre le brouillon
              </button>
            </section>
          )}
          <section className="empty-state" aria-labelledby="workouts-empty-title">
            <span className="empty-state-icon"><SectionIcon name="sessions" /></span>
            <h2 id="workouts-empty-title">Aucune séance planifiée</h2>
          </section>
        </>
      )}
    </div>
  )
}

export default WorkoutSessions
