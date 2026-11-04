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

type PersonalRecordsProps = {
  storedRecords: RecordsLoadResult
  onPersist: (mutation: RecordMutation) => string | null
  onReload: () => void
  onPendingChange: (pending: boolean) => void
}

function PersonalRecords({ storedRecords, onPersist, onReload, onPendingChange }: PersonalRecordsProps) {
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
      <p className="records-storage-note">
        Vos records sont enregistrés uniquement dans ce navigateur, sur cet appareil.
      </p>
      {(records !== null || editingExerciseId !== null) && (
        <ul className="exercise-grid">
          {exercises.map((exercise) => (
            <li key={exercise.id}>
              <ExerciseCard
                exercise={exercise}
                record={records?.find((record) => record.exerciseId === exercise.id)}
                storageUnavailable={records === null}
                isEditing={editingExerciseId === exercise.id}
                onStartEditing={() => changeEditor(exercise.id)}
                onStopEditing={() => { setEditingExerciseId(null); setUnsavedDraft(null) }}
                onDirtyChange={setUnsavedDraft}
                onSave={(oneRepMaxKg, original) => onPersist({ exerciseId: exercise.id, original, oneRepMaxKg })}
                onDelete={(original) => onPersist({ exerciseId: exercise.id, original, oneRepMaxKg: null })}
              />
            </li>
          ))}
        </ul>
      )}
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
