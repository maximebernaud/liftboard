import { useCallback, useEffect, useRef, useState } from 'react'
import { exercises } from '../data/personalRecords'
import { completeWorkout, updateWorkoutSetExecution, type WorkoutsResult } from '../data/workouts'
import { workoutCompletionError, workoutCompletionMessage } from '../lib/workoutHistory'
import {
  confirmSetExecution, executionInputs, executionNumberInput, getWorkoutProgress, hasPendingExecutionInputs,
  parseExecutionLoad, parseExecutionReps, partialSetExecution, requiresExecutionCorrection, type ExecutionInputs,
} from '../lib/workoutExecution'
import { handleNumericArrow } from '../lib/numericInput'
import type { Workout, WorkoutSet, WorkoutSetExecution } from '../types/workout'
import WorkoutConfirmation from './WorkoutConfirmation'

type SavedResult = Extract<WorkoutsResult, { ok: true }>

function ExecutionSet({ workout, blockId, set, number, onSaved, onPendingChange }: {
  workout: Workout
  blockId: string
  set: WorkoutSet
  number: number
  onSaved: (result: SavedResult) => void
  onPendingChange: (id: string, pending: boolean) => void
}) {
  // La référence de conflit ne bouge qu'après notre propre écriture réussie.
  const [savedWorkout, setSavedWorkout] = useState(workout)
  const [inputs, setInputs] = useState(() => executionInputs(set.execution))
  const [attempt, setAttempt] = useState<WorkoutSetExecution | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRequired, setShowRequired] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const saved = savedWorkout.exercises.find((block) => block.id === blockId)!.sets.find((item) => item.id === set.id)!.execution
  const parsed = { reps: parseExecutionReps(inputs.reps ?? ''), loadKg: parseExecutionLoad(inputs.loadKg ?? '') }
  const invalid = { reps: Boolean(inputs.reps?.trim()) && parsed.reps === null, loadKg: Boolean(inputs.loadKg?.trim()) && parsed.loadKg === null }
  const dirty = hasPendingExecutionInputs(inputs, saved)
  const pending = dirty || attempt !== null
  const needsCorrection = requiresExecutionCorrection(saved)
  const confirmation = confirmSetExecution(set, inputs)
  const id = `execution-${set.id}`

  useEffect(() => { onPendingChange(set.id, pending) }, [onPendingChange, pending, set.id])

  function persist(execution: WorkoutSetExecution, fillInputs = false) {
    const result = updateWorkoutSetExecution(savedWorkout, blockId, set.id, execution)
    if (!result.ok) {
      setAttempt(execution)
      setError(result.error)
      return
    }
    setSavedWorkout(result.workouts.find((item) => item.id === workout.id)!)
    setAttempt(null)
    setError(null)
    if (fillInputs) {
      setInputs(executionInputs(execution))
      setShowRequired(false)
    }
    onSaved(result)
  }

  function change(field: keyof ExecutionInputs, value: string) {
    const next = { ...inputs, [field]: value }
    setInputs(next)
    setAttempt(null)
    setError(null)
    // Une correction d'une série réalisée demande une confirmation explicite.
    if (saved?.completed) return
    const parse = field === 'reps' ? parseExecutionReps : parseExecutionLoad
    if (value.trim() && parse(value) === null) return
    // Un champ invalide reste visible ; seul son dernier résultat valide est conservé.
    persist(partialSetExecution(next, saved))
  }

  return (
    <form ref={form} id={`${id}-form`} aria-labelledby={`${id}-title`} className="workout-execution-set" noValidate onSubmit={(event) => {
      event.preventDefault()
      setShowRequired(true)
      if (confirmation.execution) persist(confirmation.execution, true)
      else requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus())
    }}>
      <div className="workout-block-heading">
        <h3 id={`${id}-title`}>Série {number}</h3>
        <span className={`workout-status${saved?.completed ? ' workout-execution-completed' : ''}`}>
          {saved?.completed ? '✓ Réalisée' : saved ? 'Saisie en cours' : 'À réaliser'}{needsCorrection && ' · à corriger'}
        </span>
      </div>
      <div className="workout-execution-planned">
        <p className="workout-label">Prévu</p>
        <p><strong>{set.reps} rép.</strong><span aria-hidden="true"> · </span>{executionNumberInput(set.intensityPct)} % du 1RM<span aria-hidden="true"> · </span><strong>{set.load ? `${executionNumberInput(set.load.selectedKg)} kg` : '—'}</strong></p>
      </div>
      <fieldset className="workout-execution-fields">
        <legend>Réalisé</legend>
        <div className="workout-set-fields">
          {(['reps', 'loadKg'] as const).map((field) => {
            const fieldId = `${id}-${field}`
            const fieldError = invalid[field] || showRequired ? confirmation.errors[field] : undefined
            return (
              <div className="workout-field" key={field}>
                <label htmlFor={fieldId}>{field === 'reps' ? 'Répétitions effectuées' : 'Charge réellement soulevée (kg)'}</label>
                <input id={fieldId} type="text" inputMode={field === 'reps' ? 'numeric' : 'decimal'}
                  autoComplete="off" spellCheck={false} value={inputs[field] ?? ''}
                  placeholder={inputs[field] === null ? executionNumberInput(field === 'reps' ? set.reps : set.load?.selectedKg) : undefined}
                  aria-invalid={Boolean(fieldError)} aria-describedby={`${id}-hint${fieldError ? ` ${fieldId}-error` : ''}`}
                  onChange={(event) => change(field, event.target.value)}
                  onKeyDown={(event) => handleNumericArrow(event.nativeEvent,
                    inputs[field] ?? executionNumberInput(field === 'reps' ? set.reps : set.load?.selectedKg),
                    field === 'reps' ? 'execution-reps' : 'execution-load', (value) => change(field, value))} />
                {fieldError && <p id={`${fieldId}-error`} className="record-error">{fieldError}</p>}
              </div>
            )
          })}
        </div>
      </fieldset>
      {needsCorrection && <p className="record-error">Ancien résultat à corriger : répétitions et charge doivent être strictement positives et dans les limites numériques sûres. Les valeurs enregistrées sont conservées.</p>}
      <p id={`${id}-hint`} className="record-hint">Les champs laissés intacts reprennent le prévu à la confirmation. {set.load === null && 'Charge absente : renseignez les kg.'}</p>
      {saved?.completed && <p className="record-hint">Enregistré : {executionNumberInput(saved.reps)} rép. à {executionNumberInput(saved.loadKg)} kg.</p>}
      <div className="workout-form-actions">
        {(!saved?.completed || pending || needsCorrection) && <button className="record-button record-button-primary" type="submit">
          {saved?.completed ? 'Enregistrer la correction' : 'Série réalisée'}
        </button>}
        {saved?.completed && <button className="record-button" type="button" disabled={pending}
          onClick={() => persist({ ...saved, completed: false })}>Annuler l’état réalisé</button>}
        {saved?.completed && pending && <button className="record-button" type="button" onClick={() => {
          setInputs(executionInputs(saved)); setAttempt(null); setError(null); setShowRequired(false)
        }}>Rétablir les valeurs enregistrées</button>}
      </div>
      {error ? (
        <div className="workout-notes-error">
          <p className="record-error" role="alert">Non enregistré. {error}</p>
          <button className="record-button" type="button" onClick={() => attempt && persist(attempt, attempt.completed)}>Réessayer</button>
        </div>
      ) : (
        <p className="record-hint">{pending ? 'Non enregistré · saisie à corriger ou à confirmer.' : saved ? 'Enregistré localement.' : 'Aucun résultat enregistré.'}</p>
      )}
    </form>
  )
}

export default function WorkoutExecution({ initialWorkout, active, editable, onSaved, onCompleted, onPendingChange, onBack, onList, onNotes }: {
  initialWorkout: Workout
  active: boolean
  editable: boolean
  onSaved: (result: SavedResult) => void
  onCompleted: (result: SavedResult) => void
  onPendingChange: (pending: boolean) => void
  onBack: () => void
  onList: () => void
  onNotes: () => void
}) {
  // Les notes ne doivent jamais remplacer la structure d'un suivi ouvert.
  // Seules nos écritures validées actualisent cette vue ; les conflits gardent la saisie.
  const [workout, setWorkout] = useState(initialWorkout)
  const [completing, setCompleting] = useState(false)
  const [completionError, setCompletionError] = useState<string | null>(null)
  const pendingSets = useRef(new Set<string>())
  const heading = useRef<HTMLHeadingElement>(null)
  const progress = getWorkoutProgress(workout)
  const [year, month, day] = workout.date.split('-')
  const handlePendingChange = useCallback((id: string, pending: boolean) => {
    if (pending) pendingSets.current.add(id)
    else pendingSets.current.delete(id)
    onPendingChange(pendingSets.current.size > 0)
  }, [onPendingChange])

  useEffect(() => { if (active) heading.current?.focus({ preventScroll: true }) }, [active])

  return (
    <>
      <button className="record-button workout-back" type="button" onClick={onBack}><span aria-hidden="true">←</span> Retour à la séance</button>
      <div className="page-heading">
        <h1 id={active ? 'workout-page-title' : undefined} ref={heading} tabIndex={-1}>Suivi · {workout.title}</h1>
        <p><time dateTime={workout.date}>{day}/{month}/{year}</time> · Planifiée</p>
      </div>
      <fieldset className="workout-editor workout-execution-content" disabled={!editable}>
        <section className="workout-details" aria-label="Progression de la séance">
          <p className="workout-execution-progress">{progress.completed} série{progress.completed > 1 ? 's' : ''} réalisée{progress.completed > 1 ? 's' : ''} sur {progress.total}</p>
          <progress max={progress.total} value={progress.completed} aria-label={`${progress.completed} séries réalisées sur ${progress.total}`} />
          <p className="record-hint">Saisie valide sauvegardée automatiquement dans ce navigateur. Confirmez chaque série pour la compter comme réalisée.</p>
          <button className="record-button" type="button" onClick={onNotes}>Notes de séance</button>
        </section>
        {workout.exercises.map((block, index) => (
          <section className="workout-exercise" key={block.id} aria-labelledby={`tracking-${block.id}`}>
            <h2 id={`tracking-${block.id}`}>{index + 1}. {exercises.find((item) => item.id === block.exerciseId)?.name}</h2>
            {block.sets.map((set, number) => <ExecutionSet key={set.id} workout={workout} blockId={block.id} set={set}
              number={number + 1} onSaved={(result) => {
                setWorkout(result.workouts.find((item) => item.id === workout.id)!)
                onSaved(result)
              }} onPendingChange={handlePendingChange} />)}
          </section>
        ))}
        <section className="workout-details" aria-label="Clôture de la séance">
          <p>Terminez la séance pour la retrouver dans l’Historique avec ses performances et ses notes.</p>
          <button className="record-button record-button-primary" type="button" aria-haspopup="dialog" onClick={() => {
            const error = pendingSets.current.size
              ? 'Des performances ne sont pas enregistrées. Corrigez ou confirmez les saisies en cours avant de terminer la séance.'
              : workoutCompletionError(workout)
            setCompletionError(error)
            if (!error) setCompleting(true)
          }}>Terminer la séance</button>
          {completionError && !completing && <p className="record-error" role="alert">{completionError}</p>}
        </section>
        <button className="record-button" type="button" onClick={onList}>Retour aux séances</button>
      </fieldset>
      {completing && editable && <WorkoutConfirmation title="Terminer cette séance ?" confirmLabel="Terminer la séance" destructive={false}
        error={completionError} onCancel={() => { setCompleting(false); setCompletionError(null) }} onConfirm={() => {
          if (pendingSets.current.size) {
            setCompletionError('Des performances ne sont pas enregistrées. Annulez pour les corriger avant de terminer.')
            return
          }
          const result = completeWorkout(workout)
          if (!result.ok) { setCompletionError(result.error); return }
          setCompleting(false)
          onCompleted(result)
        }}>
        <p>{workoutCompletionMessage(workout)}</p>
        {workout.exercises.some((block) => block.sets.some((set) => set.execution && !set.execution.completed)) &&
          <p className="record-hint">Les saisies non confirmées sont conservées sans compter comme séries effectuées.</p>}
      </WorkoutConfirmation>}
    </>
  )
}
