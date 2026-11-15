import { exercises } from '../data/personalRecords'
import { getWorkoutProgress, hasWorkoutExecution } from '../lib/workoutExecution'
import type { Workout } from '../types/workout'
import WorkoutSetSummary from './WorkoutSetSummary'

export default function WorkoutDetail({ workout, onEdit, onNotes, onDelete, onTrack, onReopen, forge = false, onBack }: {
  workout: Workout
  onEdit?: () => void
  onNotes: () => void
  onDelete?: () => void
  onTrack?: () => void
  onReopen?: () => void
  forge?: boolean
  onBack?: () => void
}) {
  const started = hasWorkoutExecution(workout)
  const completed = workout.status === 'completed'
  const progress = getWorkoutProgress(workout)
  return (
    <div className="workout-editor workout-detail">
      {forge && <p className="record-hint workout-detail-progress">{progress.completed} série{progress.completed > 1 ? 's' : ''} réalisée{progress.completed > 1 ? 's' : ''} sur {progress.total} · charges figées à l’enregistrement.</p>}
      <div className="workout-card-actions">
        {!completed && onTrack && <button className="record-button record-button-primary" type="button" onClick={onTrack}>{started ? 'Reprendre le suivi' : 'Démarrer le suivi'}</button>}
        {!completed && onEdit && <button className="record-button" type="button" disabled={started} aria-describedby={started ? 'workout-program-protection' : undefined} onClick={onEdit}>Modifier</button>}
        <button className="record-button" type="button" onClick={onNotes}>Notes</button>
      </div>
      {!completed && started && <p id="workout-program-protection" className="record-hint">Programmation verrouillée : des performances sont enregistrées. Dupliquez cette séance pour préparer une autre programmation. Les notes restent modifiables.</p>}
      {completed && <p className="record-hint">Performances en lecture seule. Pour les corriger, réouvrez explicitement la séance. Les notes restent modifiables.</p>}
      {!forge && <>
        <p className="record-hint">{progress.completed} série{progress.completed > 1 ? 's' : ''} réalisée{progress.completed > 1 ? 's' : ''} sur {progress.total}</p>
        <p className="record-hint">Charges conservées lors de l’enregistrement, indépendamment des Records actuels.</p>
      </>}
      {forge && <h2 className="sessions-section-title workout-program-title">Programme · {workout.exercises.length} exercice{workout.exercises.length > 1 ? 's' : ''}</h2>}
      {workout.exercises.map((block, index) => (
        <article className="workout-exercise" key={block.id} aria-labelledby={`detail-${block.id}`}>
          <h2 id={`detail-${block.id}`}>{index + 1}. {exercises.find((item) => item.id === block.exerciseId)?.name}</h2>
          <ol className="workout-detail-sets">
            {block.sets.map((set, setIndex) => <WorkoutSetSummary key={set.id} set={set} number={setIndex + 1} workoutStatus={workout.status} />)}
          </ol>
        </article>
      ))}
      <section className="workout-details workout-detail-notes" aria-labelledby="detail-notes-title">
        <h2 id="detail-notes-title">Notes de séance</h2>
        {(['before', 'during', 'after'] as const).map((category, index) => (
          <div key={category}>
            <h3 className="workout-label">{['Avant', 'Pendant', 'Après'][index]}</h3>
            <p className="workout-note-text">{workout.notes[category] || 'Aucune note'}</p>
          </div>
        ))}
      </section>
      {onBack && <button className="record-button workout-back" type="button" onClick={onBack}><span aria-hidden="true">←</span> Retour aux séances</button>}
      {!completed && onDelete && <button className="record-button record-button-confirm-delete" type="button" aria-haspopup="dialog" onClick={onDelete}>Supprimer la séance</button>}
      {completed && onReopen && <button className="record-button" type="button" aria-haspopup="dialog" onClick={onReopen}>Réouvrir la séance</button>}
    </div>
  )
}
