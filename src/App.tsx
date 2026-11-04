import { useCallback, useEffect, useRef, useState } from 'react'
import Calculator from './components/Calculator'
import Header from './components/Header'
import PersonalRecords from './components/PersonalRecords'
import SectionIcon from './components/SectionIcon'
import WorkoutSessions, { type WorkoutSessionsScreen } from './components/WorkoutSessions'
import WorkoutHistory, { type HistoryView } from './components/WorkoutHistory'
import { loadPersonalRecords, savePersonalRecords, type PersonalRecord } from './data/personalRecords'
import { loadWorkouts, workoutsStorageKey, type WorkoutsResult } from './data/workouts'
import { findTrackedWorkout, loadNavigation, saveNavigation, type SectionId } from './lib/navigation'
import { historyFiltersForWorkout, type HistoryFilters } from './lib/workoutHistory'
import './App.css'

const sections = [
  { id: 'sessions', label: 'Séances', title: 'Mes séances' },
  { id: 'records', label: 'Records', title: 'Records' },
  { id: 'calculator', label: 'Calculer', title: 'Calculer' },
  { id: 'history', label: 'Historique', title: 'Historique' },
] as const

function App() {
  const [navigation, setNavigation] = useState(loadNavigation)
  const activeSection = navigation.section
  const [storedRecords, setStoredRecords] = useState(loadPersonalRecords)
  const [storedWorkouts, setStoredWorkouts] = useState(loadWorkouts)
  const [sessionsScreen, setSessionsScreen] = useState<WorkoutSessionsScreen>(() => {
    const selected = storedWorkouts.ok ? findTrackedWorkout(storedWorkouts.workouts, navigation.trackingWorkoutId) : null
    return { selected, view: selected ? 'tracking' : 'list' }
  })
  const [workoutNotice, setWorkoutNotice] = useState<string | null>(null)
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({ exerciseId: '', date: '' })
  const [historyView, setHistoryView] = useState<HistoryView>({ workoutId: null, notes: false })
  const [returnToWorkout, setReturnToWorkout] = useState(false)
  const recordsNavButton = useRef<HTMLButtonElement>(null)
  const sessionsNavButton = useRef<HTMLButtonElement>(null)
  const currentSection = sections.find((section) => section.id === activeSection) ?? sections[0]

  useEffect(() => { saveNavigation(navigation) }, [navigation])

  useEffect(() => {
    function refreshWorkouts(event: StorageEvent) {
      if (event.key === workoutsStorageKey || event.key === null) setStoredWorkouts(loadWorkouts())
    }
    window.addEventListener('storage', refreshWorkouts)
    return () => window.removeEventListener('storage', refreshWorkouts)
  }, [])

  const setTrackingWorkoutId = useCallback((id: string | null) => {
    setNavigation((current) => current.trackingWorkoutId === id ? current : { ...current, trackingWorkoutId: id })
  }, [])

  function setActiveSection(section: SectionId) {
    if (section === 'sessions' || section === 'history') setStoredWorkouts(loadWorkouts())
    setWorkoutNotice(null)
    setNavigation((current) => ({ ...current, section }))
  }

  function finishWorkout(result: Extract<WorkoutsResult, { ok: true }>, id: string) {
    setStoredWorkouts(result)
    const completed = result.workouts.find((workout) => workout.id === id)!
    setHistoryFilters((current) => historyFiltersForWorkout(current, completed))
    setHistoryView({ workoutId: id, notes: false })
    setNavigation({ section: 'history', trackingWorkoutId: null })
    setWorkoutNotice('Séance terminée et enregistrée dans l’historique.')
    document.getElementById('main-content')?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'instant' })
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
        aria-labelledby={activeSection === 'sessions' ? 'workout-page-title' : activeSection === 'history' ? 'history-page-title' : 'page-title'}
        tabIndex={-1}
      >
        {activeSection === 'records' && returnToWorkout && (
          <button className="record-button workout-back" type="button" onClick={resumeWorkout}>
            <span aria-hidden="true">←</span> Reprendre ma séance
          </button>
        )}
        {activeSection !== 'sessions' && activeSection !== 'history' && (
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
            stored={storedWorkouts} onStoredChange={setStoredWorkouts} onCompleted={finishWorkout}
            screen={sessionsScreen} onScreenChange={setSessionsScreen} onTrackingChange={setTrackingWorkoutId} />
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

        <section hidden={activeSection !== 'history'} aria-label="Historique des séances">
          {workoutNotice && activeSection === 'history' && <p className="workout-notice" role="status">{workoutNotice}</p>}
          <WorkoutHistory stored={storedWorkouts} onStoredChange={setStoredWorkouts} onSessions={resumeWorkout}
            filters={historyFilters} onFiltersChange={setHistoryFilters} view={historyView} onViewChange={setHistoryView}
            onReopened={(result, id) => {
              setStoredWorkouts(result)
              setSessionsScreen({ selected: findTrackedWorkout(result.workouts, id), view: 'detail' })
              setNavigation({ section: 'sessions', trackingWorkoutId: null })
              setWorkoutNotice(null)
              document.getElementById('main-content')?.focus({ preventScroll: true })
              window.scrollTo({ top: 0, behavior: 'instant' })
            }} />
        </section>
      </main>
    </div>
  )
}

export default App
