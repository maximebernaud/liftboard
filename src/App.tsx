import ExerciseCard from './components/ExerciseCard'
import Header from './components/Header'
import './App.css'

const exercises = [
  { name: 'Arraché', category: 'Mouvement olympique' },
  { name: 'Épaulé-jeté', category: 'Mouvement olympique' },
  { name: 'Squat avant', category: 'Force' },
  { name: 'Squat arrière', category: 'Force' },
]

function App() {
  return (
    <>
      <Header />

      <main className="home container">
        <div className="home-intro">
          <p className="eyebrow">Votre entraînement, vos repères</p>
          <h1>Chaque mouvement compte.</h1>
          <p className="home-description">
            Bienvenue sur LiftBoard, votre carnet d’haltérophilie.
            Retrouvez les mouvements essentiels de votre progression.
          </p>
        </div>

        <section aria-labelledby="exercises-title">
          <div className="section-heading">
            <h2 id="exercises-title">Vos exercices</h2>
            <span className="exercise-count">4 mouvements</span>
          </div>

          <ul className="exercise-grid">
            {exercises.map((exercise) => (
              <li key={exercise.name}>
                <ExerciseCard name={exercise.name} category={exercise.category} />
              </li>
            ))}
          </ul>
        </section>

        <p className="home-note">
          La progression se construit une séance à la fois.
        </p>
      </main>
    </>
  )
}

export default App
