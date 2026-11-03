import { useCallback, useEffect, useRef, useState } from 'react'
import Calculator from './components/Calculator'
import Header from './components/Header'
import PersonalRecords from './components/PersonalRecords'
import SectionIcon from './components/SectionIcon'
import WorkoutSessions from './components/WorkoutSessions'
import { loadPersonalRecords, savePersonalRecords, type PersonalRecord } from './data/personalRecords'
import { loadNavigation, saveNavigation, type SectionId } from './lib/navigation'
import './App.css'

const sections = [
  { id: 'sessions', label: 'Séances', title: 'Mes séances' },
  { id: 'records', label: 'Records', title: 'Records' },
  { id: 'calculator', label: 'Calculer', title: 'Calculer' },
  { id: 'history', label: 'Historique', title: 'Historique' },
] as const

type EmptyStateProps = {
  icon: SectionId
  title: string
  description?: string
}

function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <section className="empty-state" aria-labelledby="empty-state-title">
      <span className="empty-state-icon">
        <SectionIcon name={icon} />
      </span>
      <h2 id="empty-state-title">{title}</h2>
      {description && <p>{description}</p>}
    </section>
  )
}

function App() {
  const [navigation, setNavigation] = useState(loadNavigation)
  const activeSection = navigation.section
  const [storedRecords, setStoredRecords] = useState(loadPersonalRecords)
  const [returnToWorkout, setReturnToWorkout] = useState(false)
  const recordsNavButton = useRef<HTMLButtonElement>(null)
  const sessionsNavButton = useRef<HTMLButtonElement>(null)
  const currentSection = sections.find((section) => section.id === activeSection) ?? sections[0]

  useEffect(() => { saveNavigation(navigation) }, [navigation])

  const setTrackingWorkoutId = useCallback((id: string | null) => {
    setNavigation((current) => current.trackingWorkoutId === id ? current : { ...current, trackingWorkoutId: id })
  }, [])

  function setActiveSection(section: SectionId) {
    setNavigation((current) => ({ ...current, section }))
  }

  function persistRecords(nextRecords: PersonalRecord[]): string | null {
    try {
      savePersonalRecords(nextRecords)
      setStoredRecords({ records: nextRecords, error: null })
      return null
    } catch {
      return 'Impossible d’enregistrer sur ce navigateur. Aucune modification n’a été sauvegardée. Réessayez.'
    }
  }

  function openRecords() {
    setReturnToWorkout(false)
    setActiveSection('records')
    recordsNavButton.current?.focus({ preventScroll: true })
  }

  function openWorkoutRecords() {
    openRecords()
    setReturnToWorkout(true)
  }

  function resumeWorkout() {
    setReturnToWorkout(false)
    setActiveSection('sessions')
    sessionsNavButton.current?.focus({ preventScroll: true })
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>

      <div className="app-navigation">
        <Header />
        <nav className="primary-nav" aria-label="Navigation principale">
          <ul className="nav-list">
            {sections.map((section) => (
              <li key={section.id}>
                <button
                  ref={section.id === 'records' ? recordsNavButton : section.id === 'sessions' ? sessionsNavButton : undefined}
                  className="nav-button"
                  type="button"
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  aria-controls="main-content"
                  onClick={() => {
                    setReturnToWorkout(false)
                    setActiveSection(section.id)
                  }}
                >
                  <SectionIcon name={section.id} />
                  <span>{section.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <main
        className="app-main container"
        id="main-content"
        aria-labelledby={activeSection === 'sessions' ? 'workout-page-title' : 'page-title'}
        tabIndex={-1}
      >
        {activeSection === 'records' && returnToWorkout && (
          <button className="record-button workout-back" type="button" onClick={resumeWorkout}>
            <span aria-hidden="true">←</span> Reprendre ma séance
          </button>
        )}
        {activeSection !== 'sessions' && (
          <div className={`page-heading${activeSection === 'records' ? ' page-heading-records' : ''}`}>
            <h1 id="page-title" aria-live="polite" aria-atomic="true">
              {currentSection.title}
            </h1>
            {activeSection === 'records' && (
              <p>Charge maximale sur une répétition (1RM).</p>
            )}
            {activeSection === 'calculator' && (
              <p>Calculez une charge à partir de votre record et d’une intensité.</p>
            )}
          </div>
        )}

        <section hidden={activeSection !== 'sessions'} aria-label="Séances">
          <WorkoutSessions storedRecords={storedRecords} onOpenRecords={openWorkoutRecords}
            initialTrackingWorkoutId={navigation.trackingWorkoutId} onTrackingChange={setTrackingWorkoutId} />
        </section>

        {/* Garder les saisies en cours lorsque l'utilisateur change de section. */}
        <section hidden={activeSection !== 'records'} aria-label="Records personnels">
          <PersonalRecords
            storedRecords={storedRecords}
            onPersist={persistRecords}
            onReload={() => setStoredRecords(loadPersonalRecords())}
          />
        </section>

        <section hidden={activeSection !== 'calculator'} aria-label="Calculateur de charge">
          <Calculator
            storedRecords={storedRecords}
            onOpenRecords={openRecords}
          />
        </section>

        {activeSection === 'history' && (
          <EmptyState icon="history" title="Aucune séance terminée pour le moment" />
        )}
      </main>
    </div>
  )
}

export default App
