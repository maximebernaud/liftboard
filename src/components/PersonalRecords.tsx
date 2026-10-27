import { useState } from 'react'
import {
  exercises,
  type Exercise,
  type PersonalRecord,
  type RecordsLoadResult,
} from '../data/personalRecords'
import ExerciseCard from './ExerciseCard'

type PersonalRecordsProps = {
  storedRecords: RecordsLoadResult
  onPersist: (records: PersonalRecord[]) => string | null
  onReload: () => void
}

function PersonalRecords({ storedRecords, onPersist, onReload }: PersonalRecordsProps) {
  const [editingExerciseId, setEditingExerciseId] = useState<Exercise['id'] | null>(null)

  const { records, error } = storedRecords

  if (records === null) {
    return (
      <div className="records-storage-error">
        <p role="alert">{error}</p>
        <p>Les modifications sont bloquées pour protéger vos données.</p>
        <button
          className="record-button"
          type="button"
          onClick={onReload}
        >
          Réessayer le chargement
        </button>
      </div>
    )
  }

  return (
    <>
      <p className="records-storage-note">
        Vos records sont enregistrés uniquement dans ce navigateur, sur cet appareil.
      </p>
      <ul className="exercise-grid">
        {exercises.map((exercise) => (
          <li key={exercise.id}>
            <ExerciseCard
              exercise={exercise}
              record={records.find((record) => record.exerciseId === exercise.id)}
              isEditing={editingExerciseId === exercise.id}
              onStartEditing={() => setEditingExerciseId(exercise.id)}
              onStopEditing={() => setEditingExerciseId(null)}
              onSave={(oneRepMaxKg) => onPersist([
                ...records.filter((record) => record.exerciseId !== exercise.id),
                { exerciseId: exercise.id, oneRepMaxKg },
              ])}
              onDelete={() => onPersist(
                records.filter((record) => record.exerciseId !== exercise.id),
              )}
            />
          </li>
        ))}
      </ul>
    </>
  )
}

export default PersonalRecords
