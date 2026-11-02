import { exercises } from '../data/personalRecords'
import type { Workout, WorkoutSetRounding } from '../types/workout'

function roundingLabel(rounding: WorkoutSetRounding): string {
  return rounding.mode === 'exact' ? 'Charge exacte' :
    `Arrondi ${rounding.mode === 'down' ? 'inférieur' : 'supérieur'} · ${String(rounding.increment).replace('.', ',')} kg`
}

export default function WorkoutDetail({ workout, onEdit, onNotes, onDelete }: {
  workout: Workout
  onEdit: () => void
  onNotes: () => void
  onDelete: () => void
}) {
  return (
    <div className="workout-editor">
      <div className="workout-card-actions">
        <button className="record-button record-button-primary" type="button" onClick={onEdit}>Modifier</button>
        <button className="record-button" type="button" onClick={onNotes}>Notes</button>
      </div>
      <p className="record-hint">Charges conservées lors de l’enregistrement, indépendamment des Records actuels.</p>
      {workout.exercises.map((block, index) => (
        <article className="workout-exercise" key={block.id} aria-labelledby={`detail-${block.id}`}>
          <h2 id={`detail-${block.id}`}>{index + 1}. {exercises.find((item) => item.id === block.exerciseId)?.name}</h2>
          <ol className="workout-detail-sets">
            {block.sets.map((set) => (
              <li key={set.id}>
                <div className="workout-set-result">
                  <span>{set.reps} rép. × {String(set.intensityPct).replace('.', ',')} %</span>
                  <span className="workout-load"><strong>{set.load ? `${String(set.load.selectedKg).replace('.', ',')} kg` : '—'}</strong></span>
                </div>
                <p className="record-hint">{roundingLabel(set.rounding)}</p>
                {set.load === null ? <p className="record-hint">Charge non enregistrée. Calcul possible dans « Modifier » avec un record 1RM.</p> :
                  set.load.exactKg !== set.load.selectedKg && <p className="record-hint">Charge exacte : {String(set.load.exactKg).replace('.', ',')} kg</p>}
              </li>
            ))}
          </ol>
        </article>
      ))}
      <section className="workout-details" aria-labelledby="detail-notes-title">
        <h2 id="detail-notes-title">Notes de séance</h2>
        {(['before', 'during', 'after'] as const).map((category, index) => (
          <div key={category}>
            <h3 className="workout-label">{['Avant', 'Pendant', 'Après'][index]}</h3>
            <p className="workout-note-text">{workout.notes[category] || 'Aucune note'}</p>
          </div>
        ))}
      </section>
      <button className="record-button record-button-confirm-delete" type="button" aria-haspopup="dialog" onClick={onDelete}>Supprimer la séance</button>
    </div>
  )
}
