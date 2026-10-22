type ExerciseCardProps = {
  name: string
  category: string
}

function ExerciseCard({ name, category }: ExerciseCardProps) {
  return (
    <article className="exercise-card">
      <p className="exercise-category">{category}</p>
      <h2>{name}</h2>
      <p className="exercise-record">
        <span className="record-indicator" aria-hidden="true" />
        Record non renseigné
      </p>
    </article>
  )
}

export default ExerciseCard
