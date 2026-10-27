import { useRef, useState } from 'react'
import Calculator from './components/Calculator'
import Header from './components/Header'
import PersonalRecords from './components/PersonalRecords'
import SectionIcon from './components/SectionIcon'
import { loadPersonalRecords, savePersonalRecords, type PersonalRecord } from './data/personalRecords'
import './App.css'

const sections = [
  { id: 'sessions', label: 'Séances', title: 'Mes séances' },
  { id: 'records', label: 'Records', title: 'Records' },
  { id: 'calculator', label: 'Calculer', title: 'Calculer' },
  { id: 'history', label: 'Historique', title: 'Historique' },
] as const

type SectionId = (typeof sections)[number]['id']

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
  const [activeSection, setActiveSection] = useState<SectionId>('sessions')
  const [storedRecords, setStoredRecords] = useState(loadPersonalRecords)
  const recordsNavButton = useRef<HTMLButtonElement>(null)
  const currentSection = sections.find((section) => section.id === activeSection) ?? sections[0]

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
    setActiveSection('records')
    recordsNavButton.current?.focus({ preventScroll: true })
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
                  ref={section.id === 'records' ? recordsNavButton : undefined}
                  className="nav-button"
                  type="button"
                  aria-current={activeSection === section.id ? 'page' : undefined}
                  aria-controls="main-content"
                  onClick={() => setActiveSection(section.id)}
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
        aria-labelledby="page-title"
        tabIndex={-1}
      >
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

        {activeSection === 'sessions' && (
          <EmptyState icon="sessions" title="Aucune séance planifiée" />
        )}

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
