export const exercises = [
  { id: 'snatch', name: 'Snatch', category: 'Mouvement olympique' },
  { id: 'clean-and-jerk', name: 'Clean & Jerk', category: 'Mouvement olympique' },
  { id: 'front-squat', name: 'Front Squat', category: 'Force' },
  { id: 'back-squat', name: 'Back Squat', category: 'Force' },
] as const

export type Exercise = (typeof exercises)[number]

export type PersonalRecord = {
  exerciseId: string
  oneRepMaxKg: number
}

type RecordsLoadResult =
  | { records: PersonalRecord[]; error: null }
  | { records: null; error: string }

const storageKey = 'liftboard.personal-records.v1'

export function parseOneRepMax(input: string): number | null {
  const trimmed = input.trim()

  // Number seul accepterait aussi des formats comme 0x10.
  // La notation scientifique permet aussi de rééditer tout nombre fini sauvegardé.
  if (!/^(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) return null

  const value = Number(trimmed.replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : null
}

function isPersonalRecord(value: unknown): value is PersonalRecord {
  if (typeof value !== 'object' || value === null) return false

  return (
    'exerciseId' in value &&
    exercises.some((exercise) => exercise.id === value.exerciseId) &&
    'oneRepMaxKg' in value &&
    typeof value.oneRepMaxKg === 'number' &&
    Number.isFinite(value.oneRepMaxKg) &&
    value.oneRepMaxKg > 0
  )
}

export function loadPersonalRecords(): RecordsLoadResult {
  try {
    const stored = window.localStorage.getItem(storageKey)
    if (stored === null) return { records: [], error: null }

    const parsed: unknown = JSON.parse(stored)
    if (
      !Array.isArray(parsed) ||
      !parsed.every(isPersonalRecord) ||
      new Set(parsed.map((record) => record.exerciseId)).size !== parsed.length
    ) {
      return {
        records: null,
        error: 'Les records stockés sont invalides. Ils ont été conservés sans modification.',
      }
    }

    return { records: parsed, error: null }
  } catch {
    return {
      records: null,
      error: 'Impossible de lire les records sur ce navigateur. Les données existantes sont conservées.',
    }
  }
}

export function savePersonalRecords(records: PersonalRecord[]): void {
  // Laisser remonter l'erreur : l'interface ne doit confirmer que les écritures réussies.
  window.localStorage.setItem(storageKey, JSON.stringify(records))
}
