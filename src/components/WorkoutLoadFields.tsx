import { useState } from 'react'
import type { PersonalRecord, RecordsLoadResult } from '../data/personalRecords'
import { normalizeExerciseSearch } from '../lib/exerciseSearch'
import { recordSnapshot } from '../lib/workoutEditorDraft'
import { handleNumericArrow, type NumericField } from '../lib/numericInput'
import type { AppDraftErrors, E2LoadDraft, WorkoutSetRounding } from '../types/workout'
import { roundingIncrements } from '../lib/loadCalculator'

type Errors = AppDraftErrors['blocks'][string]['fields'][string]
function Numeric({ id, label, value, error, field, onChange }: {
  id: string; label: string; value: string; error?: string; field: NumericField; onChange: (value: string) => void
}) {
  return <div className="workout-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} type="text" inputMode="decimal" autoComplete="off" value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => handleNumericArrow(event.nativeEvent, value, field, onChange)}
      aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
    {error && <p id={`${id}-error`} className="record-error" role="alert">{error}</p>}
  </div>
}

export default function WorkoutLoadFields({ id, value, errors, storedRecords, shortcut, onChange, onOpenRecords }: {
  id: string
  value: E2LoadDraft
  errors?: Errors
  storedRecords: RecordsLoadResult
  shortcut?: PersonalRecord
  onChange: (value: E2LoadDraft) => void
  onOpenRecords: () => void
}) {
  const [search, setSearch] = useState('')
  const records = storedRecords.records
  const current = records?.find((record) => record.exerciseId === value.reference?.exerciseId)
  const options = records?.filter((record) => record.exerciseId === value.reference?.exerciseId ||
    normalizeExerciseSearch(recordSnapshot(record).exerciseName).includes(normalizeExerciseSearch(search))) ?? []
  if (value.method === 'manual') return <Numeric id={`${id}-manual-load`} label="Charge libre (kg)" field="execution-load"
    value={value.manualInput} error={errors?.load} onChange={(manualInput) => onChange({ ...value, manualInput })} />
  if (value.method === 'none') return <p className="record-hint">Aucune charge prévue. Les kg réalisés seront nécessaires dans le suivi.</p>
  if (value.method === 'legacy') return null
  const selectReference = (record: PersonalRecord) => onChange({ ...value, reference: recordSnapshot(record) })
  return <div className="workout-e2-load-fields">
    <div className="workout-field">
      {(records?.length ?? 0) > 8 && <>
        <label htmlFor={`${id}-reference-search`}>Rechercher une référence</label>
        <input id={`${id}-reference-search`} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </>}
      <label htmlFor={`${id}-reference`}>Référence 1RM</label>
      <select id={`${id}-reference`} value={value.reference?.exerciseId ?? ''} disabled={records === null}
        onChange={(event) => {
          const record = records?.find((item) => item.exerciseId === event.target.value)
          onChange({ ...value, reference: record ? recordSnapshot(record) : null })
        }} aria-invalid={Boolean(errors?.reference)} aria-describedby={errors?.reference ? `${id}-reference-error` : `${id}-reference-hint`}>
        <option value="">Choisir un Record enregistré</option>
        {value.reference && !current && <option value={value.reference.exerciseId}>{value.reference.exerciseName} — référence enregistrée</option>}
        {options.map((record) => <option key={record.exerciseId} value={record.exerciseId}>
          {recordSnapshot(record).exerciseName} · {String(record.oneRepMaxKg).replace('.', ',')} kg
        </option>)}
      </select>
      <p id={`${id}-reference-hint`} className="record-hint">{value.reference
        ? `Référence choisie : ${value.reference.exerciseName}, ${String(value.reference.oneRepMaxKg).replace('.', ',')} kg.${value.savedPlan ? ' Les charges enregistrées restent figées.' : ''}`
        : 'Aucune référence choisie automatiquement.'}</p>
      {errors?.reference && <p id={`${id}-reference-error`} className="record-error" role="alert">{errors.reference}</p>}
      {records === null ? <p className="record-error" role="alert">{storedRecords.error}</p>
        : records.length === 0 && <p className="record-hint">Aucun Record enregistré. Renseignez un 1RM ou choisissez la charge libre.</p>}
      <div className="workout-reference-actions">
        {current && <button className="record-button" type="button" onClick={() => selectReference(current)}>Actualiser la référence</button>}
        {!value.reference && shortcut && <button className="record-button" type="button" onClick={() => selectReference(shortcut)}>
          Utiliser {recordSnapshot(shortcut).exerciseName} · {String(shortcut.oneRepMaxKg).replace('.', ',')} kg
        </button>}
        <button className="record-button" type="button" onClick={onOpenRecords}>Ouvrir les Records</button>
      </div>
    </div>
    <Numeric id={`${id}-intensity`} label="Intensité (% de la référence)" field="workout-intensity"
      value={value.intensityInput} error={errors?.intensity} onChange={(intensityInput) => onChange({ ...value, intensityInput })} />
    <div className="workout-field workout-rounding">
      <label htmlFor={`${id}-rounding`}>Ajustement de la charge</label>
      <select id={`${id}-rounding`} value={value.rounding.mode === 'exact' ? 'exact' : `${value.rounding.mode}-${value.rounding.increment}`}
        onChange={(event) => {
          const [mode, step] = event.target.value.split('-')
          const increment = roundingIncrements.find((item) => item === Number(step))
          const rounding: WorkoutSetRounding = (mode === 'up' || mode === 'down') && increment ? { mode, increment } : { mode: 'exact' }
          onChange({ ...value, rounding })
        }}>
        <option value="exact">Sans arrondi</option>
        {(['up', 'down'] as const).flatMap((mode) => roundingIncrements.map((increment) => <option key={`${mode}-${increment}`} value={`${mode}-${increment}`}>
          Vers le {mode === 'up' ? 'haut' : 'bas'} · {String(increment).replace('.', ',')} kg
        </option>))}
      </select>
    </div>
  </div>
}
