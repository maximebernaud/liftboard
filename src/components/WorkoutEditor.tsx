import { useRef, useState } from 'react'
import { exercises, type RecordsLoadResult } from '../data/personalRecords'
import {
  createWorkoutExerciseDraft,
  createWorkoutSetDraft,
  getWorkoutSetLoad,
  updateDraftExercise,
  updateDraftSet,
  validateWorkoutDraft,
} from '../lib/workoutDraft'
import { roundingIncrements } from '../lib/loadCalculator'
import type { WorkoutDraft, WorkoutDraftErrors, WorkoutExerciseDraft, WorkoutSetRounding } from '../types/workout'

// Un seul contrôle combine le pas et la direction pour rester compact sur mobile.
const roundingOptions: { value: string; label: string; rounding: WorkoutSetRounding }[] = [
  { value: 'exact', label: 'Exacte', rounding: { mode: 'exact' } },
  ...roundingIncrements.flatMap((increment) => [
    {
      value: `down-${increment}`,
      label: `Inférieur · ${increment.toString().replace('.', ',')} kg`,
      rounding: { mode: 'down' as const, increment },
    },
    {
      value: `up-${increment}`,
      label: `Supérieur · ${increment.toString().replace('.', ',')} kg`,
      rounding: { mode: 'up' as const, increment },
    },
  ]),
]

type DraftFieldProps = {
  id: string
  label: string
  value: string
  error?: string
  type?: 'text' | 'date'
  inputMode?: 'numeric' | 'decimal'
  onChange: (value: string) => void
}

function DraftField({ id, label, value, error, type = 'text', inputMode, onChange }: DraftFieldProps) {
  const [touched, setTouched] = useState(false)
  const visibleError = (touched || value !== '') ? error : undefined

  return (
    <div className="workout-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={Boolean(visibleError)}
        aria-describedby={visibleError ? `${id}-error` : undefined}
      />
      {visibleError && (
        <p id={`${id}-error`} className="record-error" role="alert">{visibleError}</p>
      )}
    </div>
  )
}

type ExerciseBlockProps = {
  block: WorkoutExerciseDraft
  number: number
  errors: WorkoutDraftErrors['blocks'][string]
  storedRecords: RecordsLoadResult
  onChange: (update: (draft: WorkoutDraft) => WorkoutDraft) => void
  onRemove: () => void
  onOpenRecords: () => void
}

function ExerciseBlock({ block, number, errors, storedRecords, onChange, onRemove, onOpenRecords }: ExerciseBlockProps) {
  const addSetButton = useRef<HTMLButtonElement>(null)
  const record = storedRecords.records?.find((item) => item.exerciseId === block.exerciseId)
  const exerciseName = exercises.find((item) => item.id === block.exerciseId)?.name
  const blockId = `workout-block-${block.id}`

  return (
    <article className="workout-exercise" aria-labelledby={`${blockId}-title`}>
      <div className="workout-block-heading">
        <h2 id={`${blockId}-title`}>Exercice {number}</h2>
        <button
          className="record-button record-button-delete workout-remove"
          type="button"
          aria-label={`Retirer l’exercice ${number} : ${exerciseName} et toutes ses séries`}
          onClick={onRemove}
        >
          Retirer l’exercice
        </button>
      </div>

      <div className="workout-field">
        <label htmlFor={blockId}>Mouvement</label>
        <select
          id={blockId}
          value={block.exerciseId}
          onChange={(event) => {
            const selected = exercises.find((item) => item.id === event.target.value)
            if (selected) {
              onChange((draft) => updateDraftExercise(draft, block.id, (current) => ({
                ...current, exerciseId: selected.id,
              })))
            }
          }}
        >
          {exercises.map((exercise) => (
            <option key={exercise.id} value={exercise.id}>{exercise.name}</option>
          ))}
        </select>
      </div>

      <div className="workout-record-context">
        {storedRecords.records === null ? (
          <p className="record-error">Records indisponibles. Le calcul est en attente.</p>
        ) : record ? (
          <p>Record 1RM : <strong>{record.oneRepMaxKg.toString().replace('.', ',')} kg</strong></p>
        ) : (
          <p>Record à renseigner</p>
        )}
        {(!record || storedRecords.records === null) && (
          <button className="record-button" type="button" onClick={onOpenRecords}>
            Ouvrir les Records
          </button>
        )}
      </div>

      <div className="workout-set-list">
        {block.sets.map((set, index) => {
          const setId = `workout-set-${set.id}`
          const load = getWorkoutSetLoad(set, record?.oneRepMaxKg)
          const fieldErrors = errors.fields[set.id]
          const loadMessage = storedRecords.records === null
            ? 'Records indisponibles'
            : load.status === 'missing-record'
              ? 'Record à renseigner'
              : load.status === 'invalid-input'
                ? 'Saisie à compléter'
                : 'Calcul indisponible'

          return (
            <fieldset className="workout-set" key={set.id}>
              <legend>Série {index + 1}</legend>
              <div className="workout-set-fields">
                <DraftField
                  id={`${setId}-reps`}
                  label="Répétitions"
                  inputMode="numeric"
                  value={set.repsInput}
                  error={fieldErrors?.reps}
                  onChange={(repsInput) => onChange((draft) => updateDraftSet(draft, block.id, set.id, { repsInput }))}
                />
                <DraftField
                  id={`${setId}-intensity`}
                  label="Intensité (%)"
                  inputMode="decimal"
                  value={set.intensityInput}
                  error={fieldErrors?.intensity}
                  onChange={(intensityInput) => onChange((draft) => updateDraftSet(draft, block.id, set.id, { intensityInput }))}
                />
              </div>
              <div className="workout-field workout-rounding">
                <label htmlFor={`${setId}-rounding`}>Arrondi de la charge</label>
                <select
                  id={`${setId}-rounding`}
                  value={set.rounding.mode === 'exact' ? 'exact' : `${set.rounding.mode}-${set.rounding.increment}`}
                  onChange={(event) => {
                    const option = roundingOptions.find((item) => item.value === event.target.value)
                    if (option) {
                      onChange((draft) => updateDraftSet(draft, block.id, set.id, { rounding: { ...option.rounding } }))
                    }
                  }}
                  aria-invalid={Boolean(fieldErrors?.rounding)}
                  aria-describedby={fieldErrors?.rounding ? `${setId}-rounding-error` : undefined}
                >
                  {roundingOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                {fieldErrors?.rounding && (
                  <p id={`${setId}-rounding-error`} className="record-error" role="alert">{fieldErrors.rounding}</p>
                )}
              </div>
              <div className="workout-set-result">
                <div className="workout-load" role="status" aria-live="polite" aria-atomic="true">
                  <span className="workout-label">
                    {set.rounding.mode === 'exact' ? 'Charge exacte (kg)' : 'Charge sélectionnée (kg)'}
                  </span>
                  {load.status === 'ready' ? (
                    <>
                      <strong>{load.selectedKg.toString().replace('.', ',')} <span>kg</span></strong>
                      {load.selectedKg !== load.exactKg && (
                        <span className="record-hint">Charge exacte : {load.exactKg.toString().replace('.', ',')} kg</span>
                      )}
                    </>
                  ) : (
                    <><strong>—</strong><span className="record-hint">{loadMessage}</span></>
                  )}
                </div>
                <button
                  className="record-button record-button-delete workout-remove"
                  type="button"
                  aria-label={`Retirer la série ${index + 1} de l’exercice ${number} : ${exerciseName}`}
                  onClick={() => {
                    onChange((draft) => updateDraftExercise(draft, block.id, (current) => ({
                      ...current, sets: current.sets.filter((item) => item.id !== set.id),
                    })))
                    addSetButton.current?.focus({ preventScroll: true })
                  }}
                >
                  Retirer la série
                </button>
              </div>
            </fieldset>
          )
        })}
      </div>
      {errors.sets && <p className="record-hint">{errors.sets}</p>}
      <button
        ref={addSetButton}
        className="record-button workout-add-set"
        type="button"
        aria-label={`Ajouter une série à l’exercice ${number} : ${exerciseName}`}
        onClick={() => {
          const set = createWorkoutSetDraft()
          onChange((draft) => updateDraftExercise(draft, block.id, (current) => ({
            ...current, sets: [...current.sets, set],
          })))
        }}
      >
        + Ajouter une série
      </button>
    </article>
  )
}

type WorkoutEditorProps = {
  draft: WorkoutDraft
  storedRecords: RecordsLoadResult
  onChange: (update: (draft: WorkoutDraft) => WorkoutDraft) => void
  onOpenRecords: () => void
}

function WorkoutEditor({ draft, storedRecords, onChange, onOpenRecords }: WorkoutEditorProps) {
  const addExerciseButton = useRef<HTMLButtonElement>(null)
  const { errors } = validateWorkoutDraft(draft)

  return (
    <div className="workout-editor">
      <section className="workout-details" aria-labelledby="workout-details-title">
        <h2 id="workout-details-title">La séance</h2>
        <p className="record-hint">Tous les champs sont obligatoires. Charges exactes par défaut ; arrondi au choix pour chaque série.</p>
        <div className="workout-details-fields">
          <DraftField
            id="workout-title"
            label="Titre"
            value={draft.title}
            error={errors.title}
            onChange={(title) => onChange((current) => ({ ...current, title }))}
          />
          <DraftField
            id="workout-date"
            label="Date"
            type="date"
            value={draft.date}
            error={errors.date}
            onChange={(date) => onChange((current) => ({ ...current, date }))}
          />
        </div>
      </section>

      <div className="workout-exercise-list">
        {draft.exercises.map((block, index) => (
          <ExerciseBlock
            key={block.id}
            block={block}
            number={index + 1}
            errors={errors.blocks[block.id]}
            storedRecords={storedRecords}
            onChange={onChange}
            onOpenRecords={onOpenRecords}
            onRemove={() => {
              onChange((current) => ({
                ...current, exercises: current.exercises.filter((item) => item.id !== block.id),
              }))
              addExerciseButton.current?.focus({ preventScroll: true })
            }}
          />
        ))}
      </div>
      {errors.exercises && <p className="record-hint">{errors.exercises}</p>}
      <button
        ref={addExerciseButton}
        className="record-button record-button-primary workout-add-exercise"
        type="button"
        onClick={() => {
          const block = createWorkoutExerciseDraft()
          onChange((current) => ({ ...current, exercises: [...current.exercises, block] }))
        }}
      >
        + Ajouter un exercice
      </button>
    </div>
  )
}

export default WorkoutEditor
