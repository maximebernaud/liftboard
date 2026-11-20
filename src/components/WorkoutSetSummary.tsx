import { plannedSetLoad, setPrescription } from '../lib/workoutPresentation'
import { executionNumberInput } from '../lib/workoutExecution'
import { requiresSetExecutionCorrection } from '../lib/workoutSetExecution'
import WorkoutSetValue from './WorkoutSetValue'
import type { AppWorkout as Workout, AppWorkoutSet as WorkoutSet, WorkoutSetRounding } from '../types/workout'

function roundingLabel(rounding: WorkoutSetRounding): string {
  return rounding.mode === 'exact' ? 'Sans arrondi' :
    `Arrondi ${rounding.mode === 'down' ? 'inférieur' : 'supérieur'} · ${String(rounding.increment).replace('.', ',')} kg`
}

export default function WorkoutSetSummary({ set, number, workoutStatus }: {
  set: WorkoutSet
  number: number
  workoutStatus: Workout['status']
}) {
  const load = plannedSetLoad(set)
  const loaded = set.schemaVersion !== 2 || set.kind === 'load-reps'
  const rounding = set.schemaVersion !== 2 ? set.rounding : set.kind === 'load-reps' && set.loading?.method === 'percentage' ? set.loading.rounding : null
  const execution = set.execution
  const invalid = requiresSetExecutionCorrection(set)
  const status = invalid ? 'À corriger' : execution?.completed ? 'Effectuée' : workoutStatus === 'planned'
    ? 'À réaliser' : execution ? 'Non confirmée' : 'Non effectuée'
  const titleId = `summary-${workoutStatus}-${set.id}`

  return (
    <li className={`workout-set-summary${execution ? '' : ' workout-set-summary-unstarted'}`} aria-labelledby={titleId}>
      <div className="workout-block-heading">
        <h3 id={titleId}>Série {number}</h3>
        <span className={`workout-status${invalid ? ' record-error' : execution?.completed ? ' workout-execution-completed' : ''}`}>{status}</span>
      </div>
      <div className="workout-set-comparison">
        <div className="workout-comparison-group">
          <p className="workout-label">PRÉVU</p>
          <p className="workout-comparison-load workout-comparison-planned"><WorkoutSetValue set={set} missingLoad="Non renseignée" /></p>
          {loaded && <p>{setPrescription(set)}</p>}
          {rounding && rounding.mode !== 'exact' && <p className="record-hint">{roundingLabel(rounding)}</p>}
          {load && load.exactKg !== load.selectedKg && <p className="record-hint">Charge exacte calculée : {executionNumberInput(load.exactKg)} kg</p>}
        </div>
        <div className="workout-comparison-group">
          <p className="workout-label">{loaded ? 'SOULEVÉ' : 'RÉALISÉ'}</p>
          {execution ? <>
            <p className="workout-comparison-load"><WorkoutSetValue set={set} execution={execution} missingLoad="Non renseignée" /></p>
            {!execution.completed && <p className="record-hint">Saisie conservée, non confirmée comme effectuée.</p>}
          </> : <p>{workoutStatus === 'planned' ? 'Aucun résultat enregistré' : 'Non effectuée'}</p>}
        </div>
      </div>
      {invalid && <p className="record-error">Ancien résultat à corriger. Les valeurs enregistrées sont conservées.</p>}
    </li>
  )
}
