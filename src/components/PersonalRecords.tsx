import { useState } from 'react'
import {
  exercises,
  loadPersonalRecords,
  savePersonalRecords,
  type PersonalRecord,
} from '../data/personalRecords'
import ExerciseCard from './ExerciseCard'

function PersonalRecords() {
  const [storedRecords, setStoredRecords] = useState(loadPersonalRecords)

  function persistRecords(nextRecords: PersonalRecord[]): string | null {
    try {
      savePersonalRecords(nextRecords)
      setStoredRecords({ records: nextRecords, error: null })
      return null
    } catch {
      return 'Impossible d’enregistrer sur ce navigateur. Aucune modification n’a été sauvegardée. Réessayez.'
    }
  }

  const { records, error } = storedRecords

  if (records === null) {
    return (
      <div className="records-storage-error">
        <p role="alert">{error}</p>
        <p>Les modifications sont bloquées pour protéger vos données.</p>
        <button
          className="record-button"
          type="button"
          onClick={() => setStoredRecords(loadPersonalRecords())}
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
              onSave={(oneRepMaxKg) => persistRecords([
                ...records.filter((record) => record.exerciseId !== exercise.id),
                { exerciseId: exercise.id, oneRepMaxKg },
              ])}
              onDelete={() => persistRecords(
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
