import { useEffect, useId, useRef, useState } from 'react'
import { exercises, exerciseFamilies, type Exercise, type ExerciseId } from '../data/exercises'
import { exerciseFavoritesStorageKey, loadExerciseFavorites, setExerciseFavorite } from '../data/exerciseFavorites'
import { loadWorkouts } from '../data/workouts'
import { normalizeExerciseSearch, recentExercises, searchExercises, type ExerciseFamilyFilter } from '../lib/exerciseSearch'
import './ExercisePicker.css'

type Props = {
  currentExerciseId?: ExerciseId
  onSelect: (id: ExerciseId) => void
  onCancel: () => void
}

export default function ExercisePicker({ currentExerciseId, onSelect, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const id = useId()
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState<ExerciseFamilyFilter>('all')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [storedFavorites, setStoredFavorites] = useState(() => loadExerciseFavorites())
  const [favoriteError, setFavoriteError] = useState<string | null>(null)
  const [storedWorkouts] = useState(() => loadWorkouts())
  const favorites = storedFavorites.ok ? storedFavorites.ids : []
  const error = favoriteError ?? (storedFavorites.ok ? null : storedFavorites.error)
  const results = searchExercises(query, family).filter((exercise) => !favoritesOnly || favorites.includes(exercise.id))
  const showSuggestions = !normalizeExerciseSearch(query) && family === 'all' && !favoritesOnly
  const favoriteSuggestions = showSuggestions ? exercises.filter((exercise) => favorites.includes(exercise.id)).slice(0, 4) : []
  const recents = showSuggestions && storedWorkouts.ok
    ? recentExercises(storedWorkouts.workouts, 8).filter((exercise) => !favoriteSuggestions.some((item) => item.id === exercise.id)).slice(0, 6)
    : []
  const suggestionIds = new Set([...favoriteSuggestions, ...recents].map((exercise) => exercise.id))
  const catalogue = results.filter((exercise) => !suggestionIds.has(exercise.id))

  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    element?.showModal()
    search.current?.focus({ preventScroll: true })
    document.body.style.overflow = 'hidden'
    function refreshFavorites(event: StorageEvent) {
      if (event.key !== exerciseFavoritesStorageKey && event.key !== null) return
      setStoredFavorites(loadExerciseFavorites())
      setFavoriteError(null)
    }
    window.addEventListener('storage', refreshFavorites)
    return () => {
      window.removeEventListener('storage', refreshFavorites)
      element?.close()
      document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
      else document.querySelector<HTMLButtonElement>('.workout-add-exercise')?.focus({ preventScroll: true })
    }
  }, [])

  function toggleFavorite(exercise: Exercise) {
    const result = setExerciseFavorite(exercise.id, !favorites.includes(exercise.id))
    if (result.ok) { setStoredFavorites(result); setFavoriteError(null) }
    else setFavoriteError(result.error)
    // La ligne peut passer du catalogue aux suggestions, ou disparaître du filtre.
    requestAnimationFrame(() => {
      const control = dialog.current?.querySelector<HTMLButtonElement>(`[data-favorite-id="${exercise.id}"]`)
      const target = control ?? search.current
      target?.focus({ preventScroll: true })
    })
  }

  function resetFilters() {
    setQuery('')
    setFamily('all')
    setFavoritesOnly(false)
    search.current?.focus({ preventScroll: true })
  }

  function rows(items: readonly Exercise[]) {
    return <ul className="exercise-picker-list">
      {items.map((exercise) => {
        const favorite = favorites.includes(exercise.id)
        return <li className="exercise-picker-row" key={exercise.id}>
          <button className="exercise-picker-choice" type="button" data-exercise-id={exercise.id}
            aria-label={`Choisir ${exercise.name}`} onClick={() => onSelect(exercise.id)}>
            <span className="exercise-picker-identity">
              <span className="exercise-picker-name">{exercise.name}{currentExerciseId === exercise.id && <span className="exercise-picker-current"> · Actuel</span>}</span>
              <span className="exercise-picker-meta">{exerciseFamilies.find((item) => item.id === exercise.family)?.name}<span> · {exercise.tags[0]}</span></span>
            </span>
            <span className="exercise-picker-arrow" aria-hidden="true">↗</span>
          </button>
          <button className="exercise-picker-favorite" type="button" data-favorite-id={exercise.id}
            aria-label={`${favorite ? 'Retirer' : 'Ajouter'} ${exercise.name} ${favorite ? 'des' : 'aux'} favoris`}
            aria-pressed={favorite} onClick={() => toggleFavorite(exercise)}>
            <span aria-hidden="true">{favorite ? '★' : '☆'}</span>
          </button>
        </li>
      })}
    </ul>
  }

  return <dialog ref={dialog} className="exercise-picker" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`}
    onKeyDown={(event) => {
      // Un champ search natif consomme sinon le premier Échap pour effacer sa valeur.
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); return }
      if (event.key !== 'Tab') return
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, select')]
        .filter((element) => element.getClientRects().length > 0)
      const destination = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1)
        : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null
      if (destination) { event.preventDefault(); destination.focus() }
    }}
    onCancel={(event) => { event.preventDefault(); onCancel() }}>
    <div className="exercise-picker-header">
      <div>
        <p className="exercise-picker-kicker">Bibliothèque<span> / {exercises.length} mouvements</span></p>
        <h2 id={`${id}-title`}>{currentExerciseId ? 'Changer de mouvement' : 'Choisir un exercice'}</h2>
      </div>
      <button className="exercise-picker-close" type="button" onClick={onCancel} aria-label="Fermer le sélecteur d’exercices">✕</button>
    </div>
    <div className="exercise-picker-search">
      <label htmlFor={`${id}-search`}>Rechercher un exercice</label>
      <div className="exercise-picker-search-field">
        <input ref={search} id={`${id}-search`} type="search" value={query} autoComplete="off" spellCheck={false}
          placeholder="Snatch, arraché, squat…" onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} />
        {query && <button className="exercise-picker-clear" type="button" onClick={() => { setQuery(''); search.current?.focus() }} aria-label="Effacer la recherche">✕</button>}
      </div>
      <p id={`${id}-hint`}>Nom, alias français ou anglais, technique.</p>
    </div>
    <div className="exercise-picker-scroll">
      <fieldset className="exercise-picker-families">
        <legend>Famille</legend>
        <div className="exercise-picker-chips">
          {[{ id: 'all' as const, name: 'Tous' }, ...exerciseFamilies].map((item) => <button type="button" key={item.id}
            aria-pressed={family === item.id} onClick={() => setFamily(item.id)}>
            {family === item.id && <span aria-hidden="true">✓ </span>}{item.name}
          </button>)}
        </div>
        <select className="exercise-picker-family-select" aria-label="Filtrer par famille" value={family} onChange={(event) => {
          const selected = exerciseFamilies.find((item) => item.id === event.target.value)
          setFamily(selected?.id ?? 'all')
        }}>
          <option value="all">Toutes les familles</option>
          {exerciseFamilies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </fieldset>
      <div className="exercise-picker-toolbar" aria-label="Accès aux favoris">
        <button type="button" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly((current) => !current)}>
          <span aria-hidden="true">{favoritesOnly ? '★' : '☆'}</span> Favoris ({favorites.length}){favoritesOnly && <span aria-hidden="true"> ✓</span>}
        </button>
        {(query || family !== 'all' || favoritesOnly) && <button type="button" onClick={resetFilters}>Tout réinitialiser</button>}
        <p role="status" aria-live="polite" aria-atomic="true">{results.length} exercice{results.length > 1 ? 's' : ''}</p>
      </div>
      {error && <div className="exercise-picker-error">
        <p className="record-error" role="alert">{error}</p>
        <button className="record-button" type="button" onClick={() => { setStoredFavorites(loadExerciseFavorites()); setFavoriteError(null) }}>Relire les favoris</button>
      </div>}
      {favoriteSuggestions.length > 0 && <section aria-labelledby={`${id}-favorites`}>
        <h3 id={`${id}-favorites`}>Tes favoris</h3>
        {rows(favoriteSuggestions)}
      </section>}
      {recents.length > 0 && <section aria-labelledby={`${id}-recent`}>
        <h3 id={`${id}-recent`}>Dans tes dernières séances</h3>
        <p className="exercise-picker-note">Ordre d’enregistrement des séances, sans date réelle d’utilisation disponible.</p>
        {rows(recents)}
      </section>}
      {results.length === 0 ? <div className="exercise-picker-empty">
        <h3>{favoritesOnly && favorites.length === 0 ? 'Aucun favori pour le moment' : 'Aucun exercice trouvé'}</h3>
        <p>{favoritesOnly && favorites.length === 0 ? 'Utilise l’étoile à côté d’un mouvement pour le retrouver ici.' : 'Essaie un autre nom ou une autre famille.'}</p>
        {query && <button className="record-button" type="button" onClick={() => { setQuery(''); search.current?.focus() }}>Effacer la recherche</button>}
        <button className="record-button" type="button" onClick={resetFilters}>Afficher tous les exercices</button>
      </div> : catalogue.length > 0 && <section aria-labelledby={`${id}-catalogue`}>
        <h3 id={`${id}-catalogue`}>{favoritesOnly ? 'Tes favoris' : showSuggestions ? 'Catalogue' : 'Résultats'}</h3>
        {rows(catalogue)}
      </section>}
    </div>
    <div className="exercise-picker-footer">
      <p>Choisis un mouvement pour {currentExerciseId ? 'remplacer celui du bloc' : 'l’ajouter à ta séance'}.</p>
      <button className="record-button" type="button" onClick={onCancel}>Annuler</button>
    </div>
  </dialog>
}
