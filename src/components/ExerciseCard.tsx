import { useEffect, useRef, useState, type SubmitEvent } from 'react'
import { parseOneRepMax, type Exercise, type PersonalRecord } from '../data/personalRecords'

type ExerciseCardProps = {
  exercise: Exercise
  record?: PersonalRecord
  isEditing: boolean
  onStartEditing: () => void
  onStopEditing: () => void
  onSave: (oneRepMaxKg: number) => string | null
  onDelete: () => string | null
}

function focusInput(input: HTMLInputElement | null) {
  input?.focus({ preventScroll: true })
}

function ExerciseCard({
  exercise,
  record,
  isEditing,
  onStartEditing,
  onStopEditing,
  onSave,
  onDelete,
}: ExerciseCardProps) {
  const [draft, setDraft] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const cancelDeleteButton = useRef<HTMLButtonElement>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const restoreEditFocus = useRef(false)
  const { id, name, category } = exercise
  const inputId = `record-${id}`
  const formattedRecord = record?.oneRepMaxKg.toString().replace('.', ',')

  // Le bouton revient dans le DOM après la fermeture de l'éditeur.
  useEffect(() => {
    if (!isEditing && restoreEditFocus.current) {
      editButton.current?.focus({ preventScroll: true })
      restoreEditFocus.current = false
    }
  }, [isEditing])

  function startEditing() {
    setDraft(formattedRecord ?? '')
    setValidationError(null)
    setSaveError(null)
    onStartEditing()
  }

  function stopEditing() {
    setDraft('')
    setValidationError(null)
    setSaveError(null)
    restoreEditFocus.current = true
    onStopEditing()
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaveError(null)
    const oneRepMaxKg = parseOneRepMax(draft)

    if (oneRepMaxKg === null) {
      setValidationError('Saisissez un nombre supérieur à 0, avec une virgule ou un point si nécessaire.')
      return
    }

    setValidationError(null)
    const error = onSave(oneRepMaxKg)
    if (error) {
      setSaveError(error)
      return
    }

    stopEditing()
  }

  function openDeleteDialog() {
    setDeleteError(null)
    deleteDialog.current?.showModal()
    cancelDeleteButton.current?.focus({ preventScroll: true })
  }

  function handleDelete() {
    if (!deleteDialog.current?.open || !record) return

    const error = onDelete()
    if (error) {
      setDeleteError(error)
      return
    }

    deleteDialog.current.close()
    stopEditing()
  }

  return (
    <article className="exercise-card" aria-labelledby={`${inputId}-title`}>
      <p className="exercise-category">{category}</p>
      <h2 id={`${inputId}-title`}>{name}</h2>
      {!isEditing && (
        <>
          <p className="exercise-record" aria-live="polite" aria-atomic="true">
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
              aria-label={`${record ? 'Modifier le record' : 'Ajouter un record'} : ${name}`}
              onClick={startEditing}
            >
              {record ? 'Modifier le record' : 'Ajouter un record'}
            </button>
          </div>
        </>
      )}
      {isEditing && (
        <form id={`${inputId}-form`} className="record-form" onSubmit={handleSubmit} noValidate>
          <label htmlFor={inputId}>Record pour {name} (kg)</label>
          <input
            id={inputId}
            name="oneRepMaxKg"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            ref={focusInput}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setValidationError(null)
              setSaveError(null)
            }}
            aria-invalid={validationError !== null}
            aria-describedby={`${inputId}-hint${validationError ? ` ${inputId}-error` : ''}${saveError ? ` ${inputId}-save-error` : ''}`}
          />
          <p id={`${inputId}-hint`} className="record-hint">Par exemple : 82,5 ou 82.5.</p>
          {validationError && (
            <p id={`${inputId}-error`} className="record-error" role="alert">{validationError}</p>
          )}
          {saveError && (
            <p id={`${inputId}-save-error`} className="record-error" role="alert">{saveError}</p>
          )}
          <div className="record-form-actions">
            <button className="record-button record-button-primary" type="submit">
              Enregistrer
            </button>
            <button className="record-button" type="button" onClick={stopEditing}>
              Annuler
            </button>
          </div>
          {record && (
            <div className="record-delete-action">
              <button
                ref={deleteButton}
                className="record-button record-button-delete"
                type="button"
                aria-label={`Effacer ce record : ${name}`}
                aria-haspopup="dialog"
                onClick={openDeleteDialog}
              >
                Effacer ce record
              </button>
            </div>
          )}
        </form>
      )}
      <dialog
        ref={deleteDialog}
        className="record-dialog"
        aria-labelledby={`${inputId}-dialog-title`}
        aria-describedby={`${inputId}-dialog-description`}
        onClose={() => {
          setDeleteError(null)
          deleteButton.current?.focus({ preventScroll: true })
        }}
      >
        <h3 id={`${inputId}-dialog-title`}>Effacer ce record ?</h3>
        <p id={`${inputId}-dialog-description`} className="record-dialog-description">
          Le record <strong>{name} de {formattedRecord} kg</strong> sera définitivement supprimé.
        </p>
        {deleteError && <p className="record-error" role="alert">{deleteError}</p>}
        <div className="record-dialog-actions">
          <button
            ref={cancelDeleteButton}
            className="record-button record-button-primary"
            type="button"
            onClick={() => deleteDialog.current?.close()}
          >
            Annuler
          </button>
          <button
            className="record-button record-button-confirm-delete"
            type="button"
            onClick={handleDelete}
          >
            Effacer le record
          </button>
        </div>
      </dialog>
    </article>
  )
}

export default ExerciseCard
