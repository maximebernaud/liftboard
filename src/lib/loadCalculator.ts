export type RoundingIncrement = null | 1 | 2.5 | 5

export type LoadCalculation = {
  exactKg: number
  roundedKg: number
}

export function parseIntensity(input: string): number | null {
  const trimmed = input.trim()
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(trimmed)) return null

  // Vérifier les bornes avant que Number ne perde les dernières décimales.
  const [integer, fraction = ''] = trimmed.split(/[.,]/)
  const whole = Number(integer)
  if (whole < 1 || whole > 100 || (whole === 100 && /[1-9]/.test(fraction))) return null

  const value = Number(trimmed.replace(',', '.'))
  return Number.isFinite(value) && value >= 1 && value <= 100 ? value : null
}

// Conserver les décimales du nombre sans effectuer de multiplication flottante.
// La notation scientifique couvre aussi les records très petits ou très grands.
function decimalParts(value: number): { coefficient: bigint; scale: number } {
  const [mantissa, exponent = '0'] = value.toString().split('e')
  const [integer, fraction = ''] = mantissa.split('.')
  const scale = fraction.length - Number(exponent)
  const coefficient = BigInt(integer + fraction)

  return scale < 0
    ? { coefficient: coefficient * 10n ** BigInt(-scale), scale: 0 }
    : { coefficient, scale }
}

/** Calcul de charge réutilisable, sans dépendance à React ni au stockage.
 * À mi-chemin entre deux multiples, retenir le multiple supérieur.
 */
export function calculateLoad(
  oneRepMaxKg: number,
  intensityPct: number,
  roundingIncrement: RoundingIncrement = null,
): LoadCalculation {
  if (!Number.isFinite(oneRepMaxKg) || oneRepMaxKg <= 0) {
    throw new RangeError('Le record 1RM doit être un nombre fini supérieur à 0.')
  }
  if (!Number.isFinite(intensityPct) || intensityPct < 1 || intensityPct > 100) {
    throw new RangeError('L’intensité doit être comprise entre 1 et 100 %.')
  }
  if (![null, 1, 2.5, 5].includes(roundingIncrement)) {
    throw new RangeError('L’incrément doit être 1, 2,5 ou 5 kg, ou aucun arrondi.')
  }

  const record = decimalParts(oneRepMaxKg)
  const intensity = decimalParts(intensityPct)
  const coefficient = record.coefficient * intensity.coefficient
  const scale = record.scale + intensity.scale + 2
  const exactKg = Number(`${coefficient}e-${scale}`)

  if (roundingIncrement === null) return { exactKg, roundedKg: exactKg }

  // Tous les incréments autorisés sont entiers en dixièmes de kilogramme.
  // Comparer les restes entiers distingue le milieu exact de ses voisins.
  const incrementTenths = BigInt(roundingIncrement * 10)
  const numerator = coefficient * 10n
  const denominator = 10n ** BigInt(scale) * incrementTenths
  const lowerMultiple = numerator / denominator
  const remainder = numerator % denominator
  const multiple = lowerMultiple + (2n * remainder >= denominator ? 1n : 0n)
  const roundedKg = Number(`${multiple * incrementTenths}e-1`)

  return { exactKg, roundedKg }
}
