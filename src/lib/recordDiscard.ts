import { exercises, parseOneRepMax, type Exercise, type PersonalRecord } from '../data/personalRecords.ts'

export type RecordEditDraft = {
  exerciseId: Exercise['id']
  original: PersonalRecord | null
  input: string
}

/** Décrit le brouillon d'ouverture, sans relire ni modifier sa référence de conflit. */
export function recordDiscardMessage(draft: RecordEditDraft, destinationId?: Exercise['id']): { change: string; consequence: string } {
  const movement = exercises.find((exercise) => exercise.id === draft.exerciseId)!.name
  const destination = exercises.find((exercise) => exercise.id === destinationId && exercise.id !== draft.exerciseId)
  const formatKg = (value: number) => `${value.toString().replace('.', ',')} kg`
  const previous = draft.original ? formatKg(draft.original.oneRepMaxKg) : null
  const current = parseOneRepMax(draft.input)
  let change: string

  if (current !== null) {
    change = previous
      ? `Tu as modifié ton Record de ${movement} de ${previous} à ${formatKg(current)}, mais tu ne l'as pas enregistré.`
      : `Tu as saisi un Record de ${movement} à ${formatKg(current)}, mais tu ne l'as pas enregistré.`
  } else if (!draft.input.trim()) {
    change = previous
      ? `Tu as vidé le champ de ton Record de ${movement}, initialement à ${previous}, mais tu n'as pas enregistré cette modification.`
      : `Ton Record de ${movement} n'était pas renseigné à l'ouverture. Le champ est actuellement vide et tes modifications n'ont pas été enregistrées.`
  } else {
    change = previous
      ? `Tu as modifié la saisie de ton Record de ${movement}, initialement à ${previous}, en « ${draft.input} ». Cette saisie n'est pas une valeur valide et n'a pas été enregistrée.`
      : `Tu as saisi « ${draft.input} » pour ton Record de ${movement}, qui n'était pas renseigné à l'ouverture. Cette saisie n'est pas une valeur valide et n'a pas été enregistrée.`
  }

  const action = destination ? `Si tu ouvres ${destination.name}` : 'Si tu abandonnes ces modifications'
  const loss = current !== null ? `ta saisie de ${formatKg(current)}` : 'ta saisie actuelle'
  const stored = draft.original
    ? 'La valeur actuellement enregistrée ne sera pas modifiée par cet abandon.'
    : 'Les données actuellement enregistrées ne seront pas modifiées par cet abandon.'
  return { change, consequence: `${action}, ${loss} sera perdue. ${stored}` }
}
