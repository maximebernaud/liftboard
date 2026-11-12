export const exercises = [
  { id: 'snatch', name: 'Snatch', category: 'Mouvement olympique' },
  { id: 'clean-and-jerk', name: 'Clean & Jerk', category: 'Mouvement olympique' },
  { id: 'front-squat', name: 'Front Squat', category: 'Force' },
  { id: 'back-squat', name: 'Back Squat', category: 'Force' },
] as const

export type Exercise = (typeof exercises)[number]
