import { useState } from 'react'
import { exercises, parseOneRepMax, type Exercise, type RecordsLoadResult } from '../data/personalRecords'
import { calculateLoad, parseIntensity, roundingIncrements, type RoundingIncrement } from '../lib/loadCalculator'
import { handleNumericArrow } from '../lib/numericInput'
import './Calculator.css'

type CalculatorProps = {
  isActive: boolean
  storedRecords: RecordsLoadResult
  onOpenRecords: () => void
}

const roundingOptions: { value: RoundingIncrement; label: string }[] = [
  { value: null, label: 'Aucun arrondi' },
  ...roundingIncrements.map((value) => ({ value, label: `Multiple de ${formatNumber(value)} kg` })),
]

// Conserver les décimales du calcul sans imposer un arrondi d’affichage.
function formatNumber(value: number): string {
  return value.toString().replace('.', ',')
}

function Calculator({ isActive, storedRecords, onOpenRecords }: CalculatorProps) {
  const [exerciseId, setExerciseId] = useState<Exercise['id']>(exercises[0].id)
  const [intensityInput, setIntensityInput] = useState('75')
  const [roundingIncrement, setRoundingIncrement] = useState<RoundingIncrement>(null)
  // null : record officiel ; une chaîne (même vide) : essai temporaire.
  const [temporaryInput, setTemporaryInput] = useState<string | null>(null)
  const [isEditingNumber, setIsEditingNumber] = useState(false)
  // La navigation masque ce composant sans le démonter : oublier uniquement l’essai.
  if (!isActive) {
    if (temporaryInput !== null) setTemporaryInput(null)
    if (isEditingNumber) setIsEditingNumber(false)
  }
  const exercise = exercises.find((item) => item.id === exerciseId) ?? exercises[0]
  const record = storedRecords.records?.find((item) => item.exerciseId === exerciseId)
  const effectiveReference = temporaryInput === null
    ? record?.oneRepMaxKg ?? null
    : parseOneRepMax(temporaryInput)
  const referenceError = temporaryInput !== null && effectiveReference === null
    ? 'Saisissez une charge de référence supérieure à 0 kg, avec une virgule ou un point si nécessaire.'
    : null
  const intensity = parseIntensity(intensityInput)
  const intensityError = intensity === null
    ? 'Saisissez une intensité entre 1 et 100 %, avec une virgule ou un point si nécessaire.'
    : null
  const result = effectiveReference !== null && intensity !== null
    ? calculateLoad(effectiveReference, intensity, roundingIncrement)
    : null

  return (
    <div className="calculator">
      <div className="calculator-section-heading">
        <p>Votre charge d’entraînement</p>
        <span>Calcul automatique</span>
      </div>
      <div className="calculator-layout">
        <div className="calculator-parameters">
          <div className="calculator-field">
            <label htmlFor="calculator-exercise">Exercice</label>
            <select
              id="calculator-exercise"
              value={exerciseId}
              onChange={(event) => {
                const selected = exercises.find((item) => item.id === event.target.value)
                if (selected) {
                  setExerciseId(selected.id)
                  setTemporaryInput(null)
                }
              }}
            >
              {exercises.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>

          <div className="calculator-reference">
            {storedRecords.records === null ? (
              <div className="calculator-missing-record">
                <p className="record-error" role="alert">{storedRecords.error}</p>
                <p>Le calcul depuis vos records est indisponible tant qu’ils ne peuvent pas être chargés.</p>
                <button className="record-button" type="button" onClick={onOpenRecords}>
                  Ouvrir les Records
                </button>
              </div>
            ) : record ? (
              <div className="calculator-record">
                <p className="calculator-label">Record personnel (1RM)</p>
                <p className="calculator-record-value">
                  {formatNumber(record.oneRepMaxKg)} <span>kg</span>
                </p>
              </div>
            ) : (
              <div className="calculator-missing-record">
                <h2>Aucun record pour {exercise.name}</h2>
                <p>Renseignez votre 1RM dans l’onglet Records pour calculer une charge.</p>
                <button className="record-button" type="button" onClick={onOpenRecords}>
                  Renseigner mon record
                </button>
              </div>
            )}
            {temporaryInput !== null && (
              <div className="calculator-field">
                <label htmlFor="calculator-temporary-reference">Charge de référence temporaire (kg)</label>
                <input
                  id="calculator-temporary-reference"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  value={temporaryInput}
                  onChange={(event) => setTemporaryInput(event.target.value)}
                  onKeyDown={(event) => handleNumericArrow(event.nativeEvent, event.currentTarget.value, 'record', setTemporaryInput)}
                  onFocus={() => setIsEditingNumber(true)}
                  onBlur={() => setIsEditingNumber(false)}
                  aria-invalid={referenceError !== null}
                  aria-describedby={`calculator-reference-hint${referenceError ? ' calculator-reference-error' : ''}`}
                />
                <p id="calculator-reference-hint" className="record-hint">
                  Utilisée uniquement pour ce calcul. Votre record enregistré ne sera pas modifié.
                </p>
                {referenceError && (
                  <p id="calculator-reference-error" className="record-error">{referenceError}</p>
                )}
              </div>
            )}
            <button
              className="calculator-reference-action"
              type="button"
              aria-expanded={temporaryInput !== null}
              aria-controls={temporaryInput !== null ? 'calculator-temporary-reference' : undefined}
              onClick={() => setTemporaryInput(temporaryInput === null
                ? record ? formatNumber(record.oneRepMaxKg) : ''
                : null)}
            >
              {temporaryInput === null
                ? 'Tester une autre charge de référence'
                : record ? 'Utiliser mon record enregistré' : 'Annuler l’essai'}
            </button>
          </div>
          {(record || temporaryInput !== null) && (
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
                  onFocus={() => setIsEditingNumber(true)}
                  onBlur={() => setIsEditingNumber(false)}
                  onKeyDown={(event) => handleNumericArrow(event.nativeEvent, event.currentTarget.value, 'intensity', setIntensityInput)}
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

          )}
        </div>
        <div className="calculator-result">
          <span className="calculator-announcement" role="status" aria-live="polite" aria-atomic="true">
            {!isEditingNumber && isActive && result
              ? `${roundingIncrement === null ? 'Charge calculée' : 'Charge arrondie'} : ${formatNumber(result.roundedKg)} kg. ${temporaryInput === null ? 'Record enregistré' : 'Référence temporaire'}.`
              : ''}
          </span>
          <h2>{roundingIncrement === null ? 'Charge calculée' : 'Charge arrondie'}</h2>
          {effectiveReference !== null && result && intensity !== null ? (
            <>
              <p className="calculator-result-value">
                {formatNumber(result.roundedKg)} <span>kg</span>
              </p>
              <p className="calculator-formula">
                {exercise.name} · {temporaryInput === null ? 'Record enregistré' : 'Référence temporaire'} : {formatNumber(effectiveReference)} kg × {formatNumber(intensity)} %
              </p>
              {roundingIncrement !== null && (
                <div className="calculator-exact">
                  <p>Charge exacte : <strong>{formatNumber(result.exactKg)} kg</strong></p>
                  <p>Arrondi au multiple de {formatNumber(roundingIncrement)} kg le plus proche.</p>
                </div>
              )}
              <p className="calculator-result-note">
                {temporaryInput === null
                  ? 'Résultat indicatif issu du 1RM enregistré sur cet appareil.'
                  : 'Résultat indicatif issu de la référence temporaire. Votre record enregistré reste inchangé.'}
              </p>
            </>
          ) : (
            <p className="calculator-result-placeholder">
              {referenceError
                ? 'Saisissez une charge de référence temporaire valide pour calculer la charge.'
                : temporaryInput !== null
                  ? 'Saisissez une intensité valide pour calculer la charge.'
                  : storedRecords.records === null
                    ? 'Le résultat sera disponible lorsque vos records pourront être chargés.'
                    : !record
                      ? 'Renseignez votre record pour calculer une charge.'
                      : 'Saisissez une intensité valide pour calculer la charge.'}
            </p>
          )}
        </div>
      </div>
      <p className="calculator-footnote">Le record est consulté depuis la rubrique Records. Les calculs ne modifient aucune charge enregistrée.</p>
    </div>
  )
}

export default Calculator
