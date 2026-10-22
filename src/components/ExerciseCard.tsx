import { useRef, useState, type SubmitEvent } from 'react'
import { parseOneRepMax, type Exercise, type PersonalRecord } from '../data/personalRecords'

type ExerciseCardProps = {
  exercise: Exercise
  record?: PersonalRecord
  onSave: (oneRepMaxKg: number) => string | null
  onDelete: () => string | null
}

type Feedback = { kind: 'success' | 'error'; message: string } | null

function ExerciseCard({ exercise, record, onSave, onDelete }: ExerciseCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const { id, name, category } = exercise
  const inputId = `record-${id}`
  const formattedRecord = record?.oneRepMaxKg.toString().replace('.', ',')

  function toggleEditor() {
    setDraft(formattedRecord ?? '')
    setValidationError(null)
    setFeedback(null)
    setIsEditing(!isEditing)
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    const oneRepMaxKg = parseOneRepMax(draft)

    if (oneRepMaxKg === null) {
      setValidationError('Saisissez un nombre supérieur à 0, avec une virgule ou un point si nécessaire.')
      return
    }

    setValidationError(null)
    const error = onSave(oneRepMaxKg)
    if (error) {
      setFeedback({ kind: 'error', message: error })
      return
    }

    setIsEditing(false)
    setFeedback({ kind: 'success', message: 'Record enregistré dans ce navigateur.' })
    editButton.current?.focus()
  }

  function handleDelete() {
    setFeedback(null)
    if (!window.confirm(`Effacer le record de ${name} (${formattedRecord} kg) ?`)) return

    const error = onDelete()
    if (error) {
      setFeedback({ kind: 'error', message: error })
      return
    }

    setFeedback({ kind: 'success', message: 'Record effacé de ce navigateur.' })
    editButton.current?.focus()
  }

  return (
    <article className="exercise-card" aria-labelledby={`${inputId}-title`}>
      <p className="exercise-category">{category}</p>
      <h2 id={`${inputId}-title`}>{name}</h2>
      <p className="exercise-record">
        {record ? (
          <span className="record-value">{formattedRecord} <span>kg</span></span>
        ) : (
          <><span className="record-indicator" aria-hidden="true" />Record non renseigné</>
        )}
      </p>
      <div className="record-actions">
        <button
          ref={editButton}
          className="record-button"
          type="button"
          aria-label={`${isEditing ? 'Annuler la saisie' : record ? 'Modifier le record' : 'Ajouter un record'} : ${name}`}
          aria-expanded={isEditing}
          aria-controls={isEditing ? `${inputId}-form` : undefined}
          onClick={toggleEditor}
        >
          {isEditing ? 'Annuler' : record ? 'Modifier le record' : 'Ajouter un record'}
        </button>
        {record && !isEditing && (
          <button
            className="record-button record-button-danger"
            type="button"
            aria-label={`Effacer le record : ${name}`}
            onClick={handleDelete}
          >
            Effacer
          </button>
        )}
      </div>
      {isEditing && (
        <form id={`${inputId}-form`} className="record-form" onSubmit={handleSubmit} noValidate>
          <label htmlFor={inputId}>Record pour {name} (kg)</label>
          <input
            id={inputId}
            name="oneRepMaxKg"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setValidationError(null)
              setFeedback(null)
            }}
            aria-invalid={validationError !== null}
            aria-describedby={`${inputId}-hint${validationError ? ` ${inputId}-error` : ''}`}
          />
          <p id={`${inputId}-hint`} className="record-hint">Par exemple : 82,5 ou 82.5.</p>
          {validationError && (
            <p id={`${inputId}-error`} className="record-error" role="alert">{validationError}</p>
          )}
          <button className="record-button record-button-primary" type="submit">
            Enregistrer le record
          </button>
        </form>
      )}
      <p className="record-feedback record-error" role="alert">
        {feedback?.kind === 'error' ? feedback.message : ''}
      </p>
      <p className="record-feedback record-success" role="status" aria-atomic="true">
        {feedback?.kind === 'success' ? feedback.message : ''}
      </p>
    </article>
  )
}

export default ExerciseCard
