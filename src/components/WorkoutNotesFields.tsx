import { useEffect, useId, useRef, useState } from 'react'
import type { WorkoutNoteCategory, WorkoutNotes } from '../types/workout'

const categories = [
  { id: 'before', label: 'Avant', hint: 'Objectifs et consignes.' },
  { id: 'during', label: 'Pendant', hint: 'Observations et remarques immédiates.' },
  { id: 'after', label: 'Après', hint: 'Bilan et points à retravailler.' },
] as const

export default function WorkoutNotesFields({ notes, onChange, initialCategory = 'before', focusOnMount = false }: {
  notes: WorkoutNotes
  onChange: (category: WorkoutNoteCategory, text: string) => void
  initialCategory?: WorkoutNoteCategory
  focusOnMount?: boolean
}) {
  const [category, setCategory] = useState(initialCategory)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  const current = categories.find((item) => item.id === category)!

  useEffect(() => {
    if (focusOnMount) textarea.current?.focus({ preventScroll: true })
  }, [focusOnMount])

  return (
    <div className="workout-notes-fields">
      <div className="workout-notes-categories" role="group" aria-label="Catégorie de note">
        {categories.map((item) => (
          <button key={item.id} type="button" className="record-button" aria-pressed={category === item.id}
            onClick={() => { setCategory(item.id); textarea.current?.focus({ preventScroll: true }) }}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="workout-field">
        <label htmlFor={id}>Note {current.label.toLowerCase()} la séance</label>
        <p id={`${id}-hint`} className="record-hint">{current.hint}</p>
        <textarea ref={textarea} id={id} rows={7} value={notes[category]} aria-describedby={`${id}-hint`}
          onChange={(event) => onChange(category, event.target.value)} />
      </div>
    </div>
  )
}
