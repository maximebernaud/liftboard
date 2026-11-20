import type { AppSetExecution, AppWorkoutSet } from '../types/workout'
import { executionNumberInput } from '../lib/workoutExecution'
import { plannedSetLoad } from '../lib/workoutPresentation'

// Même présentation dans le suivi et l'Historique, avec les seules unités du type.
export default function WorkoutSetValue({ set, execution, missingLoad = '—' }: {
  set: AppWorkoutSet
  execution?: AppSetExecution
  missingLoad?: string
}) {
  if (set.schemaVersion === 2 && set.kind === 'duration') {
    const value = execution === undefined ? set.durationSeconds : 'durationSeconds' in execution ? execution.durationSeconds : null
    return value === null ? <>Durée non renseignée</> : <><strong>{executionNumberInput(value)}</strong>{' '}<span>seconde{value > 1 ? 's' : ''}</span></>
  }
  const reps = execution === undefined ? set.reps : 'reps' in execution ? execution.reps : null
  if (set.schemaVersion === 2 && set.kind === 'reps') return reps === null ? <>Répétitions non renseignées</>
    : <><strong>{executionNumberInput(reps)}</strong>{' '}<span>répétition{reps > 1 ? 's' : ''}</span></>
  const load = execution === undefined ? plannedSetLoad(set)?.selectedKg ?? null : 'loadKg' in execution ? execution.loadKg : null
  return <>
    <strong>{load === null ? missingLoad : <>{executionNumberInput(load)} <span>kg</span></>}</strong>{' '}
    <span className="workout-comparison-reps">{reps === null ? 'Répétitions non renseignées' : `× ${executionNumberInput(reps)} répétition${reps > 1 ? 's' : ''}`}</span>
  </>
}
