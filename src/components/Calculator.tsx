import { useState } from 'react'
import { exercises, type Exercise, type RecordsLoadResult } from '../data/personalRecords'
import { calculateLoad, parseIntensity, type RoundingIncrement } from '../lib/loadCalculator'
import './Calculator.css'

type CalculatorProps = {
  storedRecords: RecordsLoadResult
  onOpenRecords: () => void
}

const roundingOptions: { value: RoundingIncrement; label: string }[] = [
  { value: null, label: 'Aucun arrondi' },
  { value: 1, label: 'Multiple de 1 kg' },
  { value: 2.5, label: 'Multiple de 2,5 kg' },
  { value: 5, label: 'Multiple de 5 kg' },
]

// Conserver les décimales du calcul sans imposer un arrondi d’affichage.
function formatNumber(value: number): string {
  return value.toString().replace('.', ',')
}

function Calculator({ storedRecords, onOpenRecords }: CalculatorProps) {
  const [exerciseId, setExerciseId] = useState<Exercise['id']>(exercises[0].id)
  const [intensityInput, setIntensityInput] = useState('75')
  const [roundingIncrement, setRoundingIncrement] = useState<RoundingIncrement>(null)
  const exercise = exercises.find((item) => item.id === exerciseId) ?? exercises[0]
  const record = storedRecords.records?.find((item) => item.exerciseId === exerciseId)
  const intensity = parseIntensity(intensityInput)
  const intensityError = intensity === null
    ? 'Saisissez une intensité entre 1 et 100 %, avec une virgule ou un point si nécessaire.'
    : null
  const result = record && intensity !== null
    ? calculateLoad(record.oneRepMaxKg, intensity, roundingIncrement)
    : null

  return (
    <div className="calculator">
      <div className="calculator-field">
        <label htmlFor="calculator-exercise">Exercice</label>
        <select
          id="calculator-exercise"
          value={exerciseId}
          onChange={(event) => {
            const selected = exercises.find((item) => item.id === event.target.value)
            if (selected) setExerciseId(selected.id)
          }}
        >
          {exercises.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </div>

      {storedRecords.records === null ? (
        <div className="calculator-missing-record">
          <p className="record-error" role="alert">{storedRecords.error}</p>
          <p>Le calcul est indisponible tant que vos records ne peuvent pas être chargés.</p>
          <button className="record-button" type="button" onClick={onOpenRecords}>
            Ouvrir les Records
          </button>
        </div>
      ) : record ? (
        <>
          <div className="calculator-record">
            <p className="calculator-label">Record personnel (1RM)</p>
            <p className="calculator-record-value">
              {formatNumber(record.oneRepMaxKg)} <span>kg</span>
            </p>
          </div>

          <div className="calculator-fields">
            <div className="calculator-field">
              <label htmlFor="calculator-intensity">Intensité (%)</label>
              <input
                id="calculator-intensity"
                name="intensityPct"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={intensityInput}
                onChange={(event) => setIntensityInput(event.target.value)}
                aria-invalid={intensityError !== null}
                aria-describedby={`calculator-intensity-hint${intensityError ? ' calculator-intensity-error' : ''}`}
              />
              <p id="calculator-intensity-hint" className="record-hint">
                De 1 à 100 %. Par exemple : 72,5 ou 72.5.
              </p>
              {intensityError && (
                <p id="calculator-intensity-error" className="record-error" role="alert">
                  {intensityError}
                </p>
              )}
            </div>

            <div className="calculator-field">
              <label htmlFor="calculator-rounding">Arrondi de la charge</label>
              <select
                id="calculator-rounding"
                value={roundingIncrement ?? 'none'}
                onChange={(event) => {
                  const selected = roundingOptions.find(
                    (item) => String(item.value ?? 'none') === event.target.value,
                  )
                  if (selected) setRoundingIncrement(selected.value)
                }}
                aria-describedby={roundingIncrement !== null ? 'calculator-rounding-hint' : undefined}
              >
                {roundingOptions.map((option) => (
                  <option key={option.value ?? 'none'} value={option.value ?? 'none'}>
                    {option.label}
                  </option>
                ))}
              </select>
              {roundingIncrement !== null && (
                <p id="calculator-rounding-hint" className="record-hint">
                  Multiple le plus proche ; à mi-chemin, le multiple supérieur est retenu.
                </p>
              )}
            </div>
          </div>

          <div className="calculator-result" role="status" aria-live="polite" aria-atomic="true">
            {result && intensity !== null ? (
              <>
                <h2>{roundingIncrement === null ? 'Charge calculée' : 'Charge arrondie'}</h2>
                <p className="calculator-result-value">
                  {formatNumber(result.roundedKg)} <span>kg</span>
                </p>
                <p className="calculator-formula">
                  {exercise.name} : {formatNumber(record.oneRepMaxKg)} kg × {formatNumber(intensity)} %
                </p>
                {roundingIncrement !== null && (
                  <div className="calculator-exact">
                    <p>Charge exacte : <strong>{formatNumber(result.exactKg)} kg</strong></p>
                    <p>Arrondi au multiple de {formatNumber(roundingIncrement)} kg le plus proche.</p>
                  </div>
                )}
              </>
            ) : (
              <p>Saisissez une intensité valide pour calculer la charge.</p>
            )}
          </div>
        </>
      ) : (
        <div className="calculator-missing-record">
          <h2>Aucun record pour {exercise.name}</h2>
          <p>Renseignez votre 1RM dans l’onglet Records pour calculer une charge.</p>
          <button className="record-button" type="button" onClick={onOpenRecords}>
            Renseigner mon record
          </button>
        </div>
      )}
    </div>
  )
}

export default Calculator
