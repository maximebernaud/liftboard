import type { AppWorkoutSet, WorkoutLoad } from '../types/workout.ts'

export function plannedSetLoad(set: AppWorkoutSet): WorkoutLoad | null {
  if (set.schemaVersion !== 2) return set.load
  const plan = set.loading
  return plan === null ? null : plan.method === 'percentage' ? plan.load : { exactKg: plan.loadKg, selectedKg: plan.loadKg }
}

export function setPrescription(set: AppWorkoutSet): string {
  const format = (value: number) => String(value).replace('.', ',')
  if (set.schemaVersion !== 2) return `${format(set.intensityPct)} % du 1RM`
  if (set.loading === null) return 'Sans charge prévue'
  if (set.loading.method === 'manual') return 'Charge libre'
  const { intensityPct, reference } = set.loading
  return `${format(intensityPct)} % de ${reference.exerciseName} · référence ${format(reference.oneRepMaxKg)} kg`
}
