import { plannedSetLoad, setPrescription } from '../lib/workoutPresentation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { exercises } from '../data/exercises'
import { completeWorkout, updateWorkoutSetExecution, type WorkoutsResult } from '../data/workouts'
import { workoutCompletionError, workoutCompletionMessage } from '../lib/workoutHistory'
import {
  executionNumberInput, getWorkoutProgress,
} from '../lib/workoutExecution'
import {
  appExecutionInputs, confirmAppSetExecution, hasPendingAppExecutionInputs, parseSetExecutionField,
  partialAppSetExecution, plannedExecutionValue, requiresSetExecutionCorrection, setExecutionFields,
  type SetExecutionInputs,
} from '../lib/workoutSetExecution'
import { handleNumericArrow } from '../lib/numericInput'
import type { AppWorkout as Workout, AppWorkoutSet as WorkoutSet, AppSetExecution } from '../types/workout'
import WorkoutConfirmation from './WorkoutConfirmation'
import WorkoutSetValue from './WorkoutSetValue'

type SavedResult = Extract<WorkoutsResult, { ok: true }>

function focusExecutionControl(control: HTMLElement | null) {
  control?.focus({ preventScroll: true })
  control?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

function nextUnstartedSetId(workout: Workout, afterId?: string): string | null {
  const sets = workout.exercises.flatMap((block) => block.sets)
  // Les résultats partiels ou anciens à corriger restent prioritaires et ouverts.
  if (sets.some((set) => set.execution && (!set.execution.completed || requiresSetExecutionCorrection(set)))) return null
  const start = afterId === undefined ? 0 : sets.findIndex((set) => set.id === afterId) + 1
  return sets.slice(start).find((set) => set.execution === undefined)?.id ?? null
}

function ExecutionSet({ workout, blockId, set, number, selected, onSelect, onSaved, onPendingChange }: {
  workout: Workout
  blockId: string
  set: WorkoutSet
  number: number
  selected: boolean
  onSelect: (id: string | null) => void
  onSaved: (result: SavedResult, newlyConfirmed: boolean) => void
  onPendingChange: (id: string, pending: boolean) => void
}) {
  // La référence de conflit ne bouge qu'après notre propre écriture réussie.
  const [savedWorkout, setSavedWorkout] = useState(workout)
  const [inputs, setInputs] = useState(() => appExecutionInputs(set))
  const [attempt, setAttempt] = useState<AppSetExecution | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRequired, setShowRequired] = useState(false)
  const [editing, setEditing] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const savedSet = savedWorkout.exercises.find((block) => block.id === blockId)!.sets.find((item) => item.id === set.id)!
  const saved = savedSet.execution
  const loaded = set.schemaVersion !== 2 || set.kind === 'load-reps'
  const fields = setExecutionFields(set)
  const plannedLoad = plannedSetLoad(set)
  const invalid = (field: keyof SetExecutionInputs) => Boolean(inputs[field]?.trim()) && parseSetExecutionField(field, inputs[field] ?? '') === null
  const dirty = hasPendingAppExecutionInputs(savedSet, inputs)
  const pending = dirty || attempt !== null
  const needsCorrection = requiresSetExecutionCorrection(savedSet)
  const confirmation = confirmAppSetExecution(set, inputs)
  const untouched = saved === undefined && set.execution === undefined && fields.every((field) => inputs[field] === null)
  const needsAttention = pending || Boolean(error) || needsCorrection || fields.some(invalid) ||
    (showRequired && Object.keys(confirmation.errors).length > 0)
  const canCompact = !needsAttention && (Boolean(saved?.completed) || untouched)
  const compact = canCompact && (saved?.completed ? !editing : !selected)
  const compactUnstarted = compact && !saved?.completed
  const canConfirmPlanned = untouched && !needsAttention && confirmation.execution !== null
  // Sélection et ajustement sont deux présentations distinctes du même brouillon.
  const plannedReady = !compact && canConfirmPlanned && !editing
  const id = `execution-${set.id}`

  useEffect(() => { onPendingChange(set.id, pending) }, [onPendingChange, pending, set.id])

  function persist(execution: AppSetExecution, fillInputs = false) {
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
      const updatedSet = result.workouts.find((item) => item.id === workout.id)!.exercises.find((block) => block.id === blockId)!.sets.find((item) => item.id === set.id)!
      setInputs(appExecutionInputs(updatedSet))
      setShowRequired(false)
      if (execution.completed) {
        setEditing(false)
        requestAnimationFrame(() => focusExecutionControl(editButton.current))
      }
    }
    if (saved?.completed && !execution.completed) {
      requestAnimationFrame(() => focusExecutionControl(heading.current))
    }
    onSaved(result, execution.completed && !saved?.completed)
  }

  function change(field: keyof SetExecutionInputs, value: string) {
    const next = { ...inputs, [field]: value }
    setInputs(next)
    setAttempt(null)
    setError(null)
    // Une correction d'une série réalisée demande une confirmation explicite.
    if (saved?.completed) return
    if (value.trim() && parseSetExecutionField(field, value) === null) return
    // Un champ invalide reste visible ; seul son dernier résultat valide est conservé.
    persist(partialAppSetExecution(savedSet, next))
  }

  const openButton = <button ref={editButton} className="record-button workout-execution-toggle" type="button" hidden={!compact && !plannedReady}
    aria-label={`${saved?.completed ? 'Modifier' : 'Ajuster'} la série ${number}`} aria-expanded={!compact && !plannedReady} aria-controls={`${id}-editor`}
    aria-describedby={compact || plannedReady ? saved?.completed ? `${id}-result ${id}-planned-summary` : `${id}-planned-result` : undefined}
    onClick={() => {
      setEditing(true)
      if (!saved?.completed) onSelect(set.id)
      requestAnimationFrame(() => focusExecutionControl(form.current?.querySelector<HTMLInputElement>('input') ?? null))
    }}>{saved?.completed ? 'Modifier' : 'Ajuster'}</button>

  const confirmPlannedButton = canConfirmPlanned && <button className="record-button workout-execution-confirm-planned" type="button"
    aria-label={`Confirmer tel que prévu : série ${number}`}
    aria-describedby={`${id}-planned-result workout-execution-hint`} onClick={() => {
      if (canConfirmPlanned && confirmation.execution) persist(confirmation.execution, true)
    }}>Confirmer tel que prévu</button>

  return (
    <form ref={form} id={`${id}-form`} aria-labelledby={`${id}-title`} className={`workout-execution-set${compact ? ' workout-execution-set-compact' : ''}${compactUnstarted ? ' workout-execution-set-unstarted' : ''}${plannedReady ? ' workout-execution-set-ready' : ''}`} noValidate onSubmit={(event) => {
      event.preventDefault()
      if (compact) return
      setShowRequired(true)
      if (confirmation.execution) persist(confirmation.execution, true)
      else requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus())
    }}>
      <div className="workout-block-heading">
        <div className="workout-execution-identity">
          <h3 id={`${id}-title`} ref={heading} tabIndex={-1}>Série {number}</h3>
          <span className={`workout-status${needsCorrection ? ' record-error' : saved?.completed ? ' workout-execution-completed' : ''}`}>
            {needsCorrection ? 'À corriger' : saved?.completed ? '✓ Réalisée' : saved ? 'Saisie en cours' : 'À réaliser'}
          </span>
        </div>
        {!compactUnstarted && !plannedReady && openButton}
      </div>
      {(compactUnstarted || plannedReady) && <div className="workout-execution-compact-summary" role="group" aria-label="Programmation de la série">
        {plannedReady && <p className="workout-label">Prévu</p>}
        <p id={`${id}-planned-result`} className="workout-execution-result">
          <WorkoutSetValue set={set} />{' '}
          {loaded && <span className="workout-execution-intensity">{setPrescription(set)}</span>}
        </p>
        {!confirmation.execution && <p className="record-hint">
          {plannedLoad === null ? 'Charge prévue non renseignée.' : 'Charge prévue à vérifier.'} Ajustez la charge réalisée.
        </p>}
        <div className="workout-execution-planned-actions">
          {plannedReady && confirmPlannedButton}
          {openButton}
          {!plannedReady && confirmPlannedButton}
        </div>
      </div>}
      {compact && saved?.completed && <div className="workout-execution-compact-summary">
        <p id={`${id}-result`} className="workout-execution-result">
          <WorkoutSetValue set={set} execution={saved} />
        </p>
        <p id={`${id}-planned-summary`} className="workout-execution-compact-planned">
          Prévu : <WorkoutSetValue set={set} missingLoad="charge non renseignée" />{loaded && ` · ${setPrescription(set)}`}
        </p>
      </div>}
      {/* Le formulaire reste monté : replier ne réinitialise ni saisie ni référence de conflit. */}
      <div id={`${id}-editor`} className="workout-execution-editor" hidden={compact || plannedReady}>
        <div className="workout-execution-planned">
          <p className="workout-label">Prévu</p>
          <p><WorkoutSetValue set={set} />{loaded && <><span aria-hidden="true"> · </span>{setPrescription(set)}</>}</p>
        </div>
        <fieldset className="workout-execution-fields">
          <legend>Réalisé</legend>
          <div className="workout-set-fields">
            {fields.map((field) => {
              const fieldId = `${id}-${field}`
              const fieldError = invalid(field) || showRequired ? confirmation.errors[field] : undefined
              return (
                <div className="workout-field" key={field}>
                  <label htmlFor={fieldId}>{field === 'reps' ? 'Répétitions effectuées' : field === 'durationSeconds' ? 'Durée effectuée (secondes)' : 'Charge réellement soulevée (kg)'}</label>
                  <input id={fieldId} type="text" inputMode={field === 'loadKg' ? 'decimal' : 'numeric'}
                    autoComplete="off" spellCheck={false} value={inputs[field] ?? ''}
                    placeholder={inputs[field] === null ? executionNumberInput(plannedExecutionValue(set, field)) : undefined}
                    aria-invalid={Boolean(fieldError)} aria-describedby={`${id}-hint${fieldError ? ` ${fieldId}-error` : ''}`}
                    onChange={(event) => change(field, event.target.value)}
                    onKeyDown={(event) => handleNumericArrow(event.nativeEvent,
                      inputs[field] ?? executionNumberInput(plannedExecutionValue(set, field)),
                      field === 'loadKg' ? 'execution-load' : 'execution-reps', (value) => change(field, value))} />
                  {fieldError && <p id={`${fieldId}-error`} className="record-error">{fieldError}</p>}
                </div>
              )
            })}
          </div>
        </fieldset>
        {needsCorrection && <p className="record-error">Ancien résultat à corriger : répétitions et charge doivent être strictement positives et dans les limites numériques sûres. Les valeurs enregistrées sont conservées.</p>}
        <p id={`${id}-hint`} className="record-hint">Les champs laissés intacts reprennent le prévu à la confirmation. {loaded && plannedLoad === null && 'Charge absente : renseignez les kg.'}</p>
        {saved?.completed && <p className="record-hint">Enregistré : <WorkoutSetValue set={set} execution={saved} />.</p>}
        <div className="workout-form-actions">
          {(!saved?.completed || pending || needsCorrection) && <button className="record-button record-button-primary" type="submit">
            {saved?.completed ? 'Enregistrer la correction' : 'Série réalisée'}
          </button>}
          {saved?.completed && <button className="record-button" type="button" disabled={pending}
            onClick={() => persist({ ...saved, completed: false })}>Annuler l’état réalisé</button>}
          {saved?.completed && pending && <button className="record-button" type="button" onClick={() => {
            setInputs(appExecutionInputs(savedSet)); setAttempt(null); setError(null); setShowRequired(false)
            requestAnimationFrame(() => focusExecutionControl(form.current?.querySelector<HTMLInputElement>('input') ?? null))
          }}>Rétablir les valeurs enregistrées</button>}
          <button className="record-button workout-execution-close" type="button" disabled={!canCompact}
            aria-controls={`${id}-editor`} aria-expanded="true" aria-describedby={!canCompact ? `${id}-close-hint` : undefined}
            onClick={() => {
              if (!canCompact) return
              if (saved?.completed) setEditing(false)
              else { setEditing(false); onSelect(null) }
              requestAnimationFrame(() => focusExecutionControl(editButton.current))
            }}>Fermer l’édition</button>
        </div>
        {!canCompact && <p id={`${id}-close-hint`} className="record-hint">
          {needsCorrection ? 'Corrigez l’ancien résultat avant de refermer.' : saved?.completed
            ? 'Enregistrez la correction ou rétablissez les valeurs enregistrées avant de refermer.'
            : 'Les saisies partielles ou à corriger restent ouvertes jusqu’à leur confirmation.'}
        </p>}
        {error ? (
          <div className="workout-notes-error">
            <p className="record-error" role="alert">Non enregistré. {error}</p>
            <button className="record-button" type="button" onClick={() => attempt && persist(attempt, attempt.completed)}>Réessayer</button>
          </div>
        ) : (
          <p className="record-hint">{pending ? 'Non enregistré · saisie à corriger ou à confirmer.' : saved ? 'Enregistré localement.' : 'Aucun résultat enregistré.'}</p>
        )}
      </div>
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
  const [selectedSetId, setSelectedSetId] = useState(() => nextUnstartedSetId(initialWorkout))
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
      <div className="page-heading forge-heading workout-tracking-heading">
        <p className="forge-kicker">Entraînement / En cours</p>
        <h1 id={active ? 'workout-page-title' : undefined} ref={heading} tabIndex={-1}>Suivi de séance</h1>
        <p className="workout-heading-context">{workout.title} · <time dateTime={workout.date}>{day}/{month}/{year}</time> · Planifiée</p>
        <p className="record-hint">Confirmez uniquement les séries réellement effectuées.</p>
      </div>
      <div className="workout-tracking-navigation">
        <button className="record-button workout-back" type="button" onClick={onBack}><span aria-hidden="true">←</span> Retour à la séance</button>
        <button className="record-button workout-notes-link" type="button" onClick={onNotes}>Notes de séance</button>
      </div>
      <fieldset className="workout-editor workout-execution-content" disabled={!editable}>
        <section className="workout-details" aria-label="Progression de la séance">
          <p className="workout-execution-progress"><strong>{progress.completed} / {progress.total}</strong> séries réalisées</p>
          <progress max={progress.total} value={progress.completed} aria-label={`${progress.completed} séries réalisées sur ${progress.total}`} />
          <p id="workout-execution-hint" className="record-hint">Saisie valide sauvegardée automatiquement dans ce navigateur. Confirmez uniquement les séries réellement effectuées.</p>
        </section>
        {workout.exercises.map((block, index) => (
          <section className="workout-exercise" key={block.id} aria-labelledby={`tracking-${block.id}`}>
            <h2 id={`tracking-${block.id}`}>{index + 1}. {exercises.find((item) => item.id === block.exerciseId)?.name}</h2>
            {block.sets.map((set, number) => <ExecutionSet key={set.id} workout={workout} blockId={block.id} set={set}
              number={number + 1} selected={selectedSetId === set.id} onSelect={setSelectedSetId} onSaved={(result, newlyConfirmed) => {
                const updated = result.workouts.find((item) => item.id === workout.id)!
                setWorkout(updated)
                if (newlyConfirmed) setSelectedSetId((current) => current === null || current === set.id
                  ? nextUnstartedSetId(updated, set.id) : current)
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
