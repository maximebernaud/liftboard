import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  calculateLoad,
  parseIntensity,
  type RoundingIncrement,
} from '../src/lib/loadCalculator.ts'

describe('parseIntensity', () => {
  it('accepte les bornes et les décimales françaises ou anglaises', () => {
    for (const [input, expected] of [
      ['1', 1], ['100', 100], ['75', 75], ['70,5', 70.5], ['70.5', 70.5], [' 75,25 ', 75.25],
    ] as const) {
      assert.equal(parseIntensity(input), expected, input)
    }
  })

  it('refuse les saisies vides, hors limites, non finies et les formats non décimaux', () => {
    for (const input of [
      '', ' ', '0', '0,5', '-1', '100.1', '100,01', 'Infinity', '-Infinity', 'NaN',
      'abc', '75%', '75kg', '0x10', '1e2', '7,5.0', '7..5', '+75',
    ]) {
      assert.equal(parseIntensity(input), null, input)
    }
  })

  it('valide les bornes des décimales longues avant leur conversion numérique', () => {
    for (const separator of ['.', ',']) {
      for (const prefix of ['', '000']) {
        assert.equal(parseIntensity(`${prefix}100${separator}000000000000001`), null)
        assert.equal(parseIntensity(`${prefix}0${separator}99999999999999999`), null)
        assert.equal(parseIntensity(`${prefix}100${separator}000000000000000`), 100)
        assert.equal(parseIntensity(`${prefix}1${separator}000000000000000`), 1)
      }
    }
  })
})

describe('calculateLoad', () => {
  it('calcule les exemples métier', () => {
    assert.deepEqual(calculateLoad(100, 75), { exactKg: 75, roundedKg: 75 })
    assert.deepEqual(calculateLoad(85, 70), { exactKg: 59.5, roundedKg: 59.5 })
    assert.deepEqual(calculateLoad(85, 70, 2.5), { exactKg: 59.5, roundedKg: 60 })
  })

  it('conserve le résultat exact sans arrondi et en changeant d’incrément', () => {
    const unrounded = calculateLoad(83.7, 73.3)
    assert.equal(unrounded.exactKg, 61.3521)
    assert.equal(unrounded.roundedKg, unrounded.exactKg)
    assert.deepEqual(calculateLoad(83.7, 73.3, null), unrounded)
    for (const increment of [1, 2.5, 5] as const) {
      assert.equal(calculateLoad(83.7, 73.3, increment).exactKg, unrounded.exactKg)
    }
  })

  it('évite les artefacts des multiplications décimales', () => {
    assert.equal(calculateLoad(0.1, 30).exactKg, 0.03)
    assert.equal(calculateLoad(82.5, 73.3).exactKg, 60.4725)
    assert.equal(calculateLoad(100.1, 99.9).exactKg, 99.9999)
  })

  it('arrondit chaque milieu exact vers le multiple supérieur', () => {
    for (const [record, intensity, increment, expected] of [
      [70, 75, 1, 53],
      [85, 75, 2.5, 65],
      [70, 75, 5, 55],
      [0.5, 100, 1, 1],
      [1.25, 100, 2.5, 2.5],
      [2.5, 100, 5, 5],
      [0.7, 75, 1, 1],
    ] as const) {
      assert.equal(calculateLoad(record, intensity, increment).roundedKg, expected)
    }
  })

  it('distingue les valeurs immédiatement inférieures et supérieures au milieu', () => {
    for (const [increment, midpoint, below, above] of [
      [1, 52.5, 52, 53],
      [2.5, 63.75, 62.5, 65],
      [5, 52.5, 50, 55],
    ] as const) {
      assert.equal(calculateLoad(midpoint - 1e-12, 100, increment).roundedKg, below)
      assert.equal(calculateLoad(midpoint + 1e-12, 100, increment).roundedKg, above)
    }
  })

  it('conserve les multiples existants et permet un arrondi à zéro', () => {
    assert.equal(calculateLoad(60, 100, 2.5).roundedKg, 60)
    assert.equal(calculateLoad(1, 1, 2.5).roundedKg, 0)
  })

  it('prend en charge la notation scientifique sans débordement intermédiaire', () => {
    assert.equal(calculateLoad(1e-7, 75).exactKg, 7.5e-8)
    assert.equal(calculateLoad(1e25, 75, 2.5).roundedKg, 7.5e24)
    assert.equal(calculateLoad(Number.MAX_VALUE, 100).exactKg, Number.MAX_VALUE)
  })

  it('refuse les nombres métier invalides, même sans interface React', () => {
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      assert.throws(() => calculateLoad(value, 75), RangeError)
    }
    for (const value of [0, 0.5, -1, 100.1, NaN, Infinity, -Infinity]) {
      assert.throws(() => calculateLoad(100, value), RangeError)
    }
    assert.throws(() => calculateLoad(100, 75, 3 as RoundingIncrement), RangeError)
  })
})
