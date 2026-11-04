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

export type RecordsLoadResult =
  | { records: PersonalRecord[]; error: null }
  | { records: null; error: string }

export const recordsStorageKey = 'liftboard.personal-records.v1'

export type RecordMutation = {
  exerciseId: Exercise['id']
  original: PersonalRecord | null
  oneRepMaxKg: number | null // null demande un effacement explicite.
}
export type RecordsMutationResult =
  | { ok: true; records: PersonalRecord[] }
  | { ok: false; error: string }
type RecordsStorage = Pick<Storage, 'getItem' | 'setItem'>

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

export function isPersonalRecords(value: unknown): value is PersonalRecord[] {
  return Array.isArray(value) && value.every(isPersonalRecord) &&
    new Set(value.map((record) => record.exerciseId)).size === value.length
}

export function loadPersonalRecords(storage?: Pick<Storage, 'getItem'>): RecordsLoadResult {
  try {
    const stored = (storage ?? window.localStorage).getItem(recordsStorageKey)
    if (stored === null) return { records: [], error: null }

    const parsed: unknown = JSON.parse(stored)
    if (!isPersonalRecords(parsed)) {
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

/** Relire, comparer la référence d'édition puis modifier uniquement le mouvement ciblé.
 * localStorage ne fournit pas de transaction entre cette lecture et l'écriture.
 */
export function mutatePersonalRecord(mutation: RecordMutation, storage?: RecordsStorage): RecordsMutationResult {
  const { exerciseId, original, oneRepMaxKg } = mutation
  if (!exercises.some((exercise) => exercise.id === exerciseId) ||
    (original !== null && (!isPersonalRecord(original) || original.exerciseId !== exerciseId)) ||
    (oneRepMaxKg !== null && (!Number.isFinite(oneRepMaxKg) || oneRepMaxKg <= 0))) {
    return { ok: false, error: 'Record invalide. Aucune modification enregistrée.' }
  }

  try {
    const target = storage ?? window.localStorage
    const current = loadPersonalRecords(target)
    if (current.records === null) return { ok: false, error: current.error }
    const latest = current.records.find((record) => record.exerciseId === exerciseId)
    if ((latest?.oneRepMaxKg ?? null) !== (original?.oneRepMaxKg ?? null)) {
      return { ok: false, error: 'Ce Record a été modifié ailleurs depuis son ouverture. Votre saisie est conservée. Annulez l’édition puis rouvrez le Record pour consulter la valeur enregistrée.' }
    }

    const records = oneRepMaxKg === null
      ? current.records.filter((record) => record.exerciseId !== exerciseId)
      : latest
        ? current.records.map((record) => record.exerciseId === exerciseId ? { ...record, oneRepMaxKg } : record)
        : [...current.records, { exerciseId, oneRepMaxKg }]
    const serialized = JSON.stringify(records)
    target.setItem(recordsStorageKey, serialized)
    if (target.getItem(recordsStorageKey) !== serialized) {
      return { ok: false, error: 'La sauvegarde du Record n’a pas pu être vérifiée. Votre saisie est conservée. Vérifiez les données enregistrées avant de réessayer.' }
    }
    return { ok: true, records }
  } catch {
    return { ok: false, error: 'Impossible de lire ou d’enregistrer les Records sur ce navigateur. La sauvegarde n’est pas confirmée ; votre saisie est conservée. Réessayez.' }
  }
}
