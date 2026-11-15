import { useEffect, useState } from 'react'
import {
  exercises,
  type Exercise,
  type RecordMutation,
  type RecordsLoadResult,
} from '../data/personalRecords'
import ExerciseCard from './ExerciseCard'
import WorkoutConfirmation from './WorkoutConfirmation'
import { recordDiscardMessage, type RecordEditDraft } from '../lib/recordDiscard'
import './PersonalRecords.css'

type PersonalRecordsProps = {
  isActive: boolean
  storedRecords: RecordsLoadResult
  onPersist: (mutation: RecordMutation) => string | null
  onReload: () => void
  onPendingChange: (pending: boolean) => void
}

function PersonalRecords({ isActive, storedRecords, onPersist, onReload, onPendingChange }: PersonalRecordsProps) {
  const [editingExerciseId, setEditingExerciseId] = useState<Exercise['id'] | null>(null)
  const [unsavedDraft, setUnsavedDraft] = useState<RecordEditDraft | null>(null)
  const hasUnsavedChanges = unsavedDraft !== null
  const [pendingExerciseId, setPendingExerciseId] = useState<Exercise['id'] | null>(null)
  useEffect(() => { onPendingChange(editingExerciseId !== null) }, [editingExerciseId, onPendingChange])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    function protectDraft(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectDraft)
    return () => window.removeEventListener('beforeunload', protectDraft)
  }, [hasUnsavedChanges])

  function changeEditor(exerciseId: Exercise['id']) {
    if (hasUnsavedChanges) { setPendingExerciseId(exerciseId); return }
    setEditingExerciseId(exerciseId)
  }

  const { records, error } = storedRecords
  const discardMessage = unsavedDraft && pendingExerciseId ? recordDiscardMessage(unsavedDraft, pendingExerciseId) : null

  return (
    <>
      {records === null && (
        <div className="records-storage-error">
          <p role="alert">{error}</p>
          <p>Les modifications sont bloquées pour protéger vos données.</p>
          <button className="record-button" type="button" onClick={onReload}>
            Réessayer le chargement
          </button>
        </div>
      )}
      {(records !== null || editingExerciseId !== null) && (
        <div className="records-catalog">
          {[...new Set(exercises.map((exercise) => exercise.category))].map((category, index) => (
            <section className="records-group" key={category} aria-labelledby={`records-category-${index}`}>
              <div className="records-group-heading">
                <h2 id={`records-category-${index}`}>{category}</h2>
                <span aria-hidden="true">Record 1RM</span>
              </div>
              <ul className="exercise-grid">
                {exercises.filter((exercise) => exercise.category === category).map((exercise) => (
                  <li key={exercise.id} id={`record-${exercise.id}-row`}>
                    <ExerciseCard
                      exercise={exercise}
                      record={records?.find((record) => record.exerciseId === exercise.id)}
                      storageUnavailable={records === null}
                      isEditing={editingExerciseId === exercise.id}
                      isActive={isActive}
                      onStartEditing={() => changeEditor(exercise.id)}
                      onStopEditing={() => { setEditingExerciseId(null); setUnsavedDraft(null) }}
                      onDirtyChange={setUnsavedDraft}
                      onSave={(oneRepMaxKg, original) => onPersist({ exerciseId: exercise.id, original, oneRepMaxKg })}
                      onDelete={(original) => onPersist({ exerciseId: exercise.id, original, oneRepMaxKg: null })}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <p className="records-storage-note records-footer">
        Vos records sont enregistrés uniquement dans ce navigateur, sur cet appareil.
      </p>
      {pendingExerciseId && discardMessage && (
        <WorkoutConfirmation title="Modifications non enregistrées" cancelLabel="Continuer à modifier" confirmLabel="Abandonner les modifications"
          onCancel={() => setPendingExerciseId(null)}
          onConfirm={() => {
            setEditingExerciseId(pendingExerciseId)
            setUnsavedDraft(null)
            setPendingExerciseId(null)
          }}>
          <p>{discardMessage.change}</p>
          <p>{discardMessage.consequence}</p>
        </WorkoutConfirmation>
      )}
    </>
  )
}

export default PersonalRecords
