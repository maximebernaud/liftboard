import { executionNumberInput, requiresExecutionCorrection } from '../lib/workoutExecution'
import type { Workout, WorkoutSet, WorkoutSetRounding } from '../types/workout'

function roundingLabel(rounding: WorkoutSetRounding): string {
  return rounding.mode === 'exact' ? 'Sans arrondi' :
    `Arrondi ${rounding.mode === 'down' ? 'inférieur' : 'supérieur'} · ${String(rounding.increment).replace('.', ',')} kg`
}

export default function WorkoutSetSummary({ set, number, workoutStatus }: {
  set: WorkoutSet
  number: number
  workoutStatus: Workout['status']
}) {
  const execution = set.execution
  const invalid = requiresExecutionCorrection(execution)
  const status = invalid ? 'À corriger' : execution?.completed ? 'Effectuée' : workoutStatus === 'planned'
    ? 'À réaliser' : execution ? 'Non confirmée' : 'Non effectuée'
  const titleId = `summary-${workoutStatus}-${set.id}`

  return (
    <li className="workout-set-summary" aria-labelledby={titleId}>
      <div className="workout-block-heading">
        <h3 id={titleId}>Série {number}</h3>
        <span className={`workout-status${invalid ? ' record-error' : execution?.completed ? ' workout-execution-completed' : ''}`}>{status}</span>
      </div>
      <div className="workout-set-comparison">
        <div className="workout-comparison-group">
          <p className="workout-label">PRÉVU</p>
          <p className="workout-comparison-load workout-comparison-planned">{set.load ? `${executionNumberInput(set.load.selectedKg)} kg` : 'Non renseignée'}</p>
          <p>{set.reps} répétition{set.reps > 1 ? 's' : ''}</p>
          <p>{executionNumberInput(set.intensityPct)} % du 1RM</p>
          {set.rounding.mode !== 'exact' && <p className="record-hint">{roundingLabel(set.rounding)}</p>}
          {set.load && set.load.exactKg !== set.load.selectedKg && <p className="record-hint">Charge exacte calculée : {executionNumberInput(set.load.exactKg)} kg</p>}
        </div>
        <div className="workout-comparison-group">
          <p className="workout-label">SOULEVÉ</p>
          {execution ? <>
            <p className="workout-comparison-load">{execution.loadKg === null ? 'Non renseignée' : `${executionNumberInput(execution.loadKg)} kg`}</p>
            <p>{execution.reps === null ? 'Répétitions non renseignées' : `${executionNumberInput(execution.reps)} répétition${execution.reps > 1 ? 's' : ''}`}</p>
            {!execution.completed && <p className="record-hint">Saisie conservée, non confirmée comme effectuée.</p>}
          </> : <p>{workoutStatus === 'planned' ? 'Aucun résultat enregistré' : 'Non effectuée'}</p>}
        </div>
      </div>
      {invalid && <p className="record-error">Ancien résultat à corriger. Les valeurs enregistrées sont conservées.</p>}
    </li>
  )
}
