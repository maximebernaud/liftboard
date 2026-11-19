import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { calculateLoad, parseIntensity, roundLoadDirected } from '../src/lib/loadCalculator.ts'
import { parseWorkoutIntensity } from '../src/lib/workoutDraft.ts'
import { stepNumericInput } from '../src/lib/numericInput.ts'
import {
  calculateWorkoutLoad, durationToSeconds, isPositiveSafeInteger, isPositiveSafeLoad,
  isWorkoutIntensityV2, parseDurationSeconds, parseWorkoutIntensityV2,
} from '../src/lib/workoutProgramming.ts'

describe('intensité E2 indépendante du contrat historique', () => {
  for (const intensity of [1, 75, 100, 110, 150, 300]) {
    it(`accepte ${intensity} % dans le nouveau contrat`, () => {
      assert.equal(parseWorkoutIntensityV2(String(intensity)), intensity)
      assert.equal(isWorkoutIntensityV2(intensity), true)
    })
  }

  it('accepte point et virgule sans perte des décimales', () => {
    for (const input of [' 110,5 ', '110.5', '00110,50']) assert.equal(parseWorkoutIntensityV2(input), 110.5)
  })

  it('refuse formats incomplets, bornes dépassées et précision perdue avant Number', () => {
    for (const input of ['', ' ', '0', '-1', '0.999999999999999999', '300,1', '300.000000000000001',
      '299.999999999999999999', '75.1234567890123456789', '110,', '110.', 'NaN', 'Infinity',
      '1e2', '0x10', '9007199254740992', '1'.repeat(400)]) {
      assert.equal(parseWorkoutIntensityV2(input), null, input)
    }
    for (const value of [0, -1, NaN, Infinity, -Infinity, 300.1, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(isWorkoutIntensityV2(value), false)
    }
  })

  it('préserve les parseurs, calculs et incréments 1–100 % des écrans actuels', () => {
    for (const input of ['110', '150', '300']) {
      assert.equal(parseIntensity(input), null)
      assert.equal(parseWorkoutIntensity(input), null)
    }
    assert.throws(() => calculateLoad(100, 110), RangeError)
    assert.equal(stepNumericInput('100', 'intensity', 1), '100')
    assert.equal(stepNumericInput('110', 'intensity', 1), null)
  })
})

describe('calcul pur des nouvelles charges de séance', () => {
  it('calcule 110 % de 100 kg et conserve la précision décimale historique', () => {
    assert.deepEqual(calculateWorkoutLoad(100, 110, { mode: 'exact' }), {
      status: 'ready', load: { exactKg: 110, selectedKg: 110 },
    })
    for (const [record, intensity] of [[82.5, 73.3], [0.1, 30], [100.1, 99.9]]) {
      const expected = calculateLoad(record, intensity).exactKg
      assert.deepEqual(calculateWorkoutLoad(record, intensity, { mode: 'exact' }), {
        status: 'ready', load: { exactKg: expected, selectedKg: expected },
      })
    }
  })

  it('réutilise les six arrondis dirigés et conserve leurs multiples exacts', () => {
    for (const increment of [1, 2.5, 5] as const) for (const mode of ['up', 'down'] as const) {
      assert.deepEqual(calculateWorkoutLoad(100, 110.4, { mode, increment }), {
        status: 'ready', load: { exactKg: 110.4, selectedKg: roundLoadDirected(110.4, increment, mode) },
      })
      assert.deepEqual(calculateWorkoutLoad(100, 150, { mode, increment }), {
        status: 'ready', load: { exactKg: 150, selectedKg: 150 },
      })
    }
  })

  it('conserve zéro uniquement comme charge sélectionnée par arrondi inférieur', () => {
    assert.deepEqual(calculateWorkoutLoad(100, 1, { mode: 'down', increment: 5 }), {
      status: 'ready', load: { exactKg: 1, selectedKg: 0 },
    })
    assert.equal(isPositiveSafeLoad(0), false)
  })

  it('distingue saisie invalide, référence absente et calcul indisponible', () => {
    assert.deepEqual(calculateWorkoutLoad(undefined, 75, { mode: 'exact' }), { status: 'missing-record' })
    for (const value of [0, -1, NaN, Infinity, -Infinity, 300.1]) {
      assert.deepEqual(calculateWorkoutLoad(undefined, value, { mode: 'exact' }), { status: 'invalid-input' })
    }
    for (const record of [0, -1, NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
      assert.deepEqual(calculateWorkoutLoad(record, 300, { mode: 'exact' }), { status: 'unavailable' })
    }
    assert.deepEqual(calculateWorkoutLoad(Number.MIN_VALUE, 1, { mode: 'exact' }), { status: 'unavailable' })
  })

  it('refuse les charges au-delà des limites sûres sans fausse valeur de secours', () => {
    assert.deepEqual(calculateWorkoutLoad(Number.MAX_SAFE_INTEGER, 300, { mode: 'exact' }), { status: 'unavailable' })
    assert.deepEqual(calculateWorkoutLoad(Number.MAX_SAFE_INTEGER, 100, { mode: 'up', increment: 5 }), { status: 'unavailable' })
    assert.deepEqual(calculateWorkoutLoad(Number.MAX_SAFE_INTEGER, 100, { mode: 'exact' }), {
      status: 'ready', load: { exactKg: Number.MAX_SAFE_INTEGER, selectedKg: Number.MAX_SAFE_INTEGER },
    })
  })

  it('valide séparément les entiers et les charges décimales', () => {
    for (const value of [1, 45, Number.MAX_SAFE_INTEGER]) assert.equal(isPositiveSafeInteger(value), true)
    assert.equal(isPositiveSafeLoad(87.5), true)
    assert.equal(isPositiveSafeInteger(87.5), false)
    for (const value of [null, undefined, '45', 0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(isPositiveSafeInteger(value), false)
      assert.equal(isPositiveSafeLoad(value), false)
    }
  })
})

describe('durées E2 en secondes entières', () => {
  for (const [input, unit, expected] of [
    ['45', 'seconds', 45], ['45,0', 'seconds', 45], ['0,75', 'minutes', 45], ['.75', 'minutes', 45],
    ['1,5', 'minutes', 90], ['1.5', 'minutes', 90], ['1', 'minutes', 60], [' 001,50 ', 'minutes', 90],
  ] as const) {
    it(`convertit exactement ${input} ${unit} en ${expected} secondes`, () => {
      assert.equal(parseDurationSeconds(input, unit), expected)
      assert.equal(durationToSeconds(Number(input.trim().replace(',', '.')), unit), expected)
    })
  }

  it('ne convertit jamais une fraction de seconde en entier par arrondi flottant', () => {
    for (const input of ['0.001', '0.016666666666666666', '0.750000000000000001', '1.000000000000000001']) {
      assert.equal(parseDurationSeconds(input, 'minutes'), null, input)
    }
    assert.equal(parseDurationSeconds('45.000000000000000001', 'seconds'), null)
    assert.equal(parseDurationSeconds('0.1', 'minutes'), 6)
    assert.equal(durationToSeconds(0.1, 'minutes'), 6)
    assert.equal(durationToSeconds(1 / 60, 'minutes'), null)
  })

  it('refuse zéro, négatifs, formats invalides et dépassements', () => {
    for (const input of ['', ' ', '0', '-1', '1,', '1.', 'NaN', 'Infinity', '1e2', '0x10',
      '45.5', '9007199254740992', '1'.repeat(400)]) {
      assert.equal(parseDurationSeconds(input, 'seconds'), null, input)
    }
    for (const value of [0, -1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(durationToSeconds(value, 'seconds'), null)
    }
    assert.equal(durationToSeconds(Number.MAX_VALUE, 'minutes'), null)
    assert.equal(parseDurationSeconds(String(Number.MAX_SAFE_INTEGER), 'minutes'), null)
    assert.equal(parseDurationSeconds(String(Number.MAX_SAFE_INTEGER), 'seconds'), Number.MAX_SAFE_INTEGER)
    assert.equal(parseDurationSeconds('150119987579016,5166666666666667', 'minutes'), null)
  })
})
