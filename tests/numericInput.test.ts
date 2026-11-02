import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { handleNumericArrow, stepNumericInput, type NumericField } from '../src/lib/numericInput.ts'

describe('incréments numériques', () => {
  it('ajoute ou retire un demi-kilo aux Records et un demi-point aux intensités', () => {
    for (const field of ['record', 'intensity'] as const) {
      assert.equal(stepNumericInput('70', field, 1), '70,5')
      assert.equal(stepNumericInput('85', field, -1), '84,5')
      assert.equal(stepNumericInput('70,1', field, 1), '70,6')
      assert.equal(stepNumericInput('70.1', field, -1), '69.6')
      assert.equal(stepNumericInput('72,35', field, 1), '72,85')
      assert.equal(stepNumericInput('72.35', field, -1), '71.85')
    }
  })

  it('incrémente les répétitions par entiers, sans dépassement de précision', () => {
    assert.equal(stepNumericInput('3', 'reps', 1), '4')
    assert.equal(stepNumericInput('3', 'reps', -1), '2')
    assert.equal(stepNumericInput('1', 'reps', -1), '1')
    assert.equal(stepNumericInput(String(Number.MAX_SAFE_INTEGER), 'reps', 1), String(Number.MAX_SAFE_INTEGER))
    assert.equal(stepNumericInput(String(Number.MAX_SAFE_INTEGER), 'reps', -1), String(Number.MAX_SAFE_INTEGER - 1))
    for (const input of ['2,5', '2.5', '1e2', '9007199254740992']) {
      assert.equal(stepNumericInput(input, 'reps', 1), null)
    }
  })

  it('borne les intensités à 1 et 100 sans reboucler', () => {
    assert.equal(stepNumericInput('1', 'intensity', -1), '1')
    assert.equal(stepNumericInput('1,2', 'intensity', -1), '1')
    assert.equal(stepNumericInput('99.8', 'intensity', 1), '100')
    assert.equal(stepNumericInput('100', 'intensity', 1), '100')
    for (const input of ['0,5', '101', '100.000000000000001']) {
      assert.equal(stepNumericInput(input, 'intensity', -1), null)
    }
  })

  it('ne crée pas de minimum arbitraire pour les Records et ne produit ni zéro ni Infinity', () => {
    for (const input of ['0,5', '0.2', '1e-7']) assert.equal(stepNumericInput(input, 'record', -1), input)
    assert.equal(stepNumericInput('0,1', 'record', 1), '0,6')
    assert.equal(stepNumericInput('1e2', 'record', 1), '100,5')
    assert.equal(stepNumericInput(String(Number.MAX_VALUE), 'record', 1), String(Number.MAX_VALUE))
    assert.equal(stepNumericInput('1e25', 'record', -1), '1e25')
  })

  it('conserve les saisies vides, incomplètes et invalides', () => {
    for (const field of ['record', 'intensity', 'reps'] as const) {
      for (const input of ['', ' ', '75,', '75.', ',', '.', 'abc', '-1', '0', 'NaN', 'Infinity']) {
        assert.equal(stepNumericInput(input, field, 1), null, `${field} : ${input}`)
        assert.equal(stepNumericInput(input, field, -1), null, `${field} : ${input}`)
      }
    }
  })

  it('évite les artefacts au fil des répétitions de touches', () => {
    let value = '70,1'
    for (let index = 0; index < 100; index++) value = stepNumericInput(value, 'record', 1)!
    assert.equal(value, '120,1')
    for (let index = 0; index < 100; index++) value = stepNumericInput(value, 'record', -1)!
    assert.equal(value, '70,1')
  })
})

describe('événements clavier', () => {
  it('consomme seulement les flèches gérées et ne notifie qu’un changement réel', () => {
    let prevented = 0
    const changes: string[] = []
    for (const [key, input, field] of [
      ['ArrowUp', '70', 'record'], ['ArrowDown', '85', 'intensity'], ['ArrowUp', '3', 'reps'],
    ] as const) {
      handleNumericArrow({ key, preventDefault: () => prevented++ }, input, field, (value) => changes.push(value))
    }
    assert.deepEqual(changes, ['70,5', '84,5', '4'])
    assert.equal(prevented, 3)
    handleNumericArrow({ key: 'ArrowDown', preventDefault: () => prevented++ }, '1', 'reps', (value) => changes.push(value))
    assert.equal(prevented, 4)
    assert.equal(changes.length, 3)
  })

  it('laisse les autres touches, combinaisons et saisies incomplètes tranquilles', () => {
    const unexpected = () => assert.fail('Touche non gérée')
    for (const key of ['ArrowLeft', 'ArrowRight', 'Enter', 'Tab', 'a']) {
      handleNumericArrow({ key, preventDefault: unexpected }, '70', 'record', unexpected)
    }
    for (const property of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'isComposing', 'defaultPrevented']) {
      handleNumericArrow({ key: 'ArrowUp', [property]: true, preventDefault: unexpected }, '70', 'record', unexpected)
    }
    for (const field of ['record', 'intensity', 'reps'] as NumericField[]) {
      handleNumericArrow({ key: 'ArrowUp', preventDefault: unexpected }, '75,', field, unexpected)
    }
  })
})
