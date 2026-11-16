export const exerciseFamilies = [
  { id: 'olympic', name: 'Mouvements olympiques combinés' },
  { id: 'snatch', name: 'Arraché / Snatch' },
  { id: 'clean', name: 'Épaulé / Clean' },
  { id: 'jerk', name: 'Jeté / Jerk' },
  { id: 'pulls', name: 'Tirages' },
  { id: 'squats', name: 'Squats' },
  { id: 'strength', name: 'Force et poussées' },
  { id: 'accessories', name: 'Renforcement et accessoires' },
] as const

export type ExerciseFamily = (typeof exerciseFamilies)[number]['id']
export type ExerciseMetadata = {
  id: string
  name: string
  family: ExerciseFamily
  aliases: readonly string[]
  tags: readonly string[]
  equipment?: string
  category?: string
}

// Source canonique et ordre stable de recherche. Les quatre premières définitions
// conservent aussi leur catégorie d'affichage historique dans Records.
export const exercises = [
  { id: 'snatch', name: 'Snatch', category: 'Mouvement olympique', family: 'snatch', aliases: ['Arraché'], tags: ['olympique', 'complet'] },
  { id: 'clean-and-jerk', name: 'Clean & Jerk', category: 'Mouvement olympique', family: 'olympic', aliases: ['Épaulé-jeté', 'Clean and Jerk', 'C&J', 'CJ'], tags: ['olympique', 'combiné'] },
  { id: 'front-squat', name: 'Front Squat', category: 'Force', family: 'squats', aliases: ['Squat avant'], tags: ['jambes', 'épaulé'] },
  { id: 'back-squat', name: 'Back Squat', category: 'Force', family: 'squats', aliases: ['Squat arrière'], tags: ['jambes', 'force'] },

  { id: 'power-clean-and-jerk', name: 'Power Clean & Jerk', family: 'olympic', aliases: ['Épaulé puissance et jeté'], tags: ['combiné', 'power'] },
  { id: 'power-clean-and-power-jerk', name: 'Power Clean & Power Jerk', family: 'olympic', aliases: ['Épaulé puissance et jeté puissance'], tags: ['combiné', 'power'] },
  { id: 'clean-and-power-jerk', name: 'Clean & Power Jerk', family: 'olympic', aliases: ['Épaulé et jeté puissance'], tags: ['combiné', 'power'] },
  { id: 'clean-and-squat-jerk', name: 'Clean & Squat Jerk', family: 'olympic', aliases: ['Épaulé et jeté en flexion'], tags: ['combiné', 'flexion'] },
  { id: 'hang-clean-and-jerk', name: 'Hang Clean & Jerk', family: 'olympic', aliases: ['Épaulé-jeté en suspension'], tags: ['combiné', 'hang'] },
  { id: 'block-clean-and-jerk', name: 'Block Clean & Jerk', family: 'olympic', aliases: ['Épaulé-jeté des plots'], tags: ['combiné', 'blocks'] },
  { id: 'clean-and-push-press', name: 'Clean & Push Press', family: 'olympic', aliases: ['Épaulé et développé avec impulsion'], tags: ['combiné', 'poussée'] },

  { id: 'power-snatch', name: 'Power Snatch', family: 'snatch', aliases: ['Arraché puissance', 'Arraché debout'], tags: ['power', 'réception haute'] },
  { id: 'hang-snatch', name: 'Hang Snatch', family: 'snatch', aliases: ['Arraché en suspension'], tags: ['hang', 'technique'] },
  { id: 'hang-power-snatch', name: 'Hang Power Snatch', family: 'snatch', aliases: ['Arraché puissance en suspension'], tags: ['hang', 'power'] },
  { id: 'high-hang-snatch', name: 'High Hang Snatch', family: 'snatch', aliases: ['Arraché en suspension haute'], tags: ['hang', 'haut de cuisse'] },
  { id: 'high-hang-power-snatch', name: 'High Hang Power Snatch', family: 'snatch', aliases: ['Arraché puissance en suspension haute'], tags: ['hang', 'power'] },
  { id: 'low-hang-snatch', name: 'Low Hang Snatch', family: 'snatch', aliases: ['Arraché en suspension basse'], tags: ['hang', 'sous le genou'] },
  { id: 'low-hang-power-snatch', name: 'Low Hang Power Snatch', family: 'snatch', aliases: ['Arraché puissance en suspension basse'], tags: ['hang', 'power'] },
  { id: 'block-snatch', name: 'Block Snatch', family: 'snatch', aliases: ['Arraché des plots', 'Snatch from Blocks'], tags: ['blocks', 'technique'] },
  { id: 'block-power-snatch', name: 'Block Power Snatch', family: 'snatch', aliases: ['Arraché puissance des plots'], tags: ['blocks', 'power'] },
  { id: 'muscle-snatch', name: 'Muscle Snatch', family: 'snatch', aliases: ['Arraché force'], tags: ['sans passage', 'bras'] },
  { id: 'hang-muscle-snatch', name: 'Hang Muscle Snatch', family: 'snatch', aliases: ['Arraché force en suspension'], tags: ['hang', 'sans passage'] },
  { id: 'tall-snatch', name: 'Tall Snatch', family: 'snatch', aliases: ['Arraché de la position haute sans impulsion'], tags: ['passage', 'technique'] },
  { id: 'no-foot-snatch', name: 'No-Foot Snatch', family: 'snatch', aliases: ['Arraché sans déplacement des pieds'], tags: ['pieds fixes', 'technique'] },
  { id: 'snatch-balance', name: 'Snatch Balance', family: 'snatch', aliases: ['Chute d’arraché avec impulsion'], tags: ['réception', 'overhead'] },
  { id: 'heaving-snatch-balance', name: 'Heaving Snatch Balance', family: 'snatch', aliases: ['Chute d’arraché avec impulsion pieds fixes'], tags: ['réception', 'pieds fixes'] },
  { id: 'drop-snatch', name: 'Drop Snatch', family: 'snatch', aliases: ['Chute d’arraché sans impulsion'], tags: ['réception', 'vitesse'] },
  { id: 'pressing-snatch-balance', name: 'Pressing Snatch Balance', family: 'snatch', aliases: ['Passage d’arraché en développé'], tags: ['réception', 'contrôle'] },
  { id: 'deficit-snatch', name: 'Deficit Snatch', family: 'snatch', aliases: ['Arraché en déficit', 'Snatch on Riser'], tags: ['déficit', 'départ surélevé'] },
  { id: 'pause-snatch', name: 'Pause Snatch', family: 'snatch', aliases: ['Arraché avec pause'], tags: ['pause', 'positions'] },
  { id: 'slow-pull-snatch', name: 'Slow-Pull Snatch', family: 'snatch', aliases: ['Arraché avec tirage lent'], tags: ['tempo', 'positions'] },

  { id: 'clean', name: 'Clean', family: 'clean', aliases: ['Épaulé'], tags: ['olympique', 'complet'] },
  { id: 'power-clean', name: 'Power Clean', family: 'clean', aliases: ['Épaulé puissance', 'Épaulé debout'], tags: ['power', 'réception haute'] },
  { id: 'hang-clean', name: 'Hang Clean', family: 'clean', aliases: ['Épaulé en suspension'], tags: ['hang', 'technique'] },
  { id: 'hang-power-clean', name: 'Hang Power Clean', family: 'clean', aliases: ['Épaulé puissance en suspension'], tags: ['hang', 'power'] },
  { id: 'high-hang-clean', name: 'High Hang Clean', family: 'clean', aliases: ['Épaulé en suspension haute'], tags: ['hang', 'haut de cuisse'] },
  { id: 'high-hang-power-clean', name: 'High Hang Power Clean', family: 'clean', aliases: ['Épaulé puissance en suspension haute'], tags: ['hang', 'power'] },
  { id: 'low-hang-clean', name: 'Low Hang Clean', family: 'clean', aliases: ['Épaulé en suspension basse'], tags: ['hang', 'sous le genou'] },
  { id: 'low-hang-power-clean', name: 'Low Hang Power Clean', family: 'clean', aliases: ['Épaulé puissance en suspension basse'], tags: ['hang', 'power'] },
  { id: 'block-clean', name: 'Block Clean', family: 'clean', aliases: ['Épaulé des plots', 'Clean from Blocks'], tags: ['blocks', 'technique'] },
  { id: 'block-power-clean', name: 'Block Power Clean', family: 'clean', aliases: ['Épaulé puissance des plots'], tags: ['blocks', 'power'] },
  { id: 'muscle-clean', name: 'Muscle Clean', family: 'clean', aliases: ['Épaulé force'], tags: ['sans passage', 'bras'] },
  { id: 'hang-muscle-clean', name: 'Hang Muscle Clean', family: 'clean', aliases: ['Épaulé force en suspension'], tags: ['hang', 'sans passage'] },
  { id: 'tall-clean', name: 'Tall Clean', family: 'clean', aliases: ['Épaulé de la position haute sans impulsion'], tags: ['passage', 'technique'] },
  { id: 'no-foot-clean', name: 'No-Foot Clean', family: 'clean', aliases: ['Épaulé sans déplacement des pieds'], tags: ['pieds fixes', 'technique'] },
  { id: 'deficit-clean', name: 'Deficit Clean', family: 'clean', aliases: ['Épaulé en déficit', 'Clean on Riser'], tags: ['déficit', 'départ surélevé'] },
  { id: 'pause-clean', name: 'Pause Clean', family: 'clean', aliases: ['Épaulé avec pause'], tags: ['pause', 'positions'] },
  { id: 'slow-pull-clean', name: 'Slow-Pull Clean', family: 'clean', aliases: ['Épaulé avec tirage lent'], tags: ['tempo', 'positions'] },

  { id: 'split-jerk', name: 'Split Jerk', family: 'jerk', aliases: ['Jeté en fente'], tags: ['fente', 'olympique'] },
  // Power Jerk et Push Jerk désignent le même mouvement : un seul objet.
  { id: 'power-jerk', name: 'Power Jerk', family: 'jerk', aliases: ['Push Jerk', 'Jeté puissance', 'Jeté debout'], tags: ['power', 'réception haute'] },
  { id: 'squat-jerk', name: 'Squat Jerk', family: 'jerk', aliases: ['Jeté en flexion'], tags: ['flexion', 'overhead'] },
  { id: 'jerk-balance', name: 'Jerk Balance', family: 'jerk', aliases: ['Équilibre de jeté'], tags: ['fente', 'technique'] },
  { id: 'jerk-from-blocks', name: 'Jerk from Blocks', family: 'jerk', aliases: ['Jeté des plots', 'Block Jerk'], tags: ['blocks', 'fente'] },
  { id: 'behind-the-neck-jerk', name: 'Behind-the-Neck Jerk', family: 'jerk', aliases: ['Jeté nuque en fente'], tags: ['nuque', 'fente'] },
  { id: 'behind-the-neck-power-jerk', name: 'Behind-the-Neck Power Jerk', family: 'jerk', aliases: ['Jeté puissance nuque'], tags: ['nuque', 'power'] },
  { id: 'jerk-recovery', name: 'Jerk Recovery', family: 'jerk', aliases: ['Récupération de jeté'], tags: ['supports', 'stabilité'] },
  { id: 'tall-jerk', name: 'Tall Jerk', family: 'jerk', aliases: ['Passage de jeté sans impulsion'], tags: ['passage', 'technique'] },
  { id: 'pause-jerk', name: 'Pause Jerk', family: 'jerk', aliases: ['Jeté avec pause en flexion'], tags: ['pause', 'impulsion'] },
  { id: 'jerk-dip-squat', name: 'Jerk Dip Squat', family: 'jerk', aliases: ['Flexion de jeté'], tags: ['dip', 'verticalité'] },
  { id: 'jerk-drive', name: 'Jerk Drive', family: 'jerk', aliases: ['Impulsion de jeté'], tags: ['drive', 'extension'] },

  { id: 'snatch-pull', name: 'Snatch Pull', family: 'pulls', aliases: ['Tirage d’arraché'], tags: ['arraché', 'extension'] },
  { id: 'clean-pull', name: 'Clean Pull', family: 'pulls', aliases: ['Tirage d’épaulé'], tags: ['épaulé', 'extension'] },
  { id: 'snatch-deadlift', name: 'Snatch Deadlift', family: 'pulls', aliases: ['Soulevé de terre d’arraché'], tags: ['arraché', 'positions'] },
  { id: 'clean-deadlift', name: 'Clean Deadlift', family: 'pulls', aliases: ['Soulevé de terre d’épaulé'], tags: ['épaulé', 'positions'] },
  { id: 'romanian-deadlift', name: 'Romanian Deadlift', family: 'pulls', aliases: ['Soulevé de terre roumain', 'RDL'], tags: ['ischios', 'chaîne postérieure'] },
  { id: 'snatch-grip-romanian-deadlift', name: 'Snatch-Grip Romanian Deadlift', family: 'pulls', aliases: ['Soulevé de terre roumain prise arraché'], tags: ['ischios', 'prise large'] },
  { id: 'high-pull', name: 'High Pull', family: 'pulls', aliases: ['Clean High Pull', 'Tirage haut d’épaulé'], tags: ['épaulé', 'tirage haut'] },
  { id: 'snatch-high-pull', name: 'Snatch High Pull', family: 'pulls', aliases: ['Tirage haut d’arraché'], tags: ['arraché', 'tirage haut'] },
  { id: 'block-snatch-pull', name: 'Block Snatch Pull', family: 'pulls', aliases: ['Tirage d’arraché des plots'], tags: ['blocks', 'extension'] },
  { id: 'block-clean-pull', name: 'Block Clean Pull', family: 'pulls', aliases: ['Tirage d’épaulé des plots'], tags: ['blocks', 'extension'] },
  { id: 'hang-snatch-pull', name: 'Hang Snatch Pull', family: 'pulls', aliases: ['Tirage d’arraché en suspension'], tags: ['hang', 'extension'] },
  { id: 'hang-clean-pull', name: 'Hang Clean Pull', family: 'pulls', aliases: ['Tirage d’épaulé en suspension'], tags: ['hang', 'extension'] },
  { id: 'deficit-snatch-pull', name: 'Deficit Snatch Pull', family: 'pulls', aliases: ['Tirage d’arraché en déficit'], tags: ['déficit', 'force'] },
  { id: 'deficit-clean-pull', name: 'Deficit Clean Pull', family: 'pulls', aliases: ['Tirage d’épaulé en déficit'], tags: ['déficit', 'force'] },
  { id: 'floating-snatch-pull', name: 'Floating Snatch Pull', family: 'pulls', aliases: ['Tirage d’arraché sans reposer au sol'], tags: ['tension continue', 'arraché'] },
  { id: 'floating-clean-pull', name: 'Floating Clean Pull', family: 'pulls', aliases: ['Tirage d’épaulé sans reposer au sol'], tags: ['tension continue', 'épaulé'] },
  { id: 'segment-snatch-pull', name: 'Segment Snatch Pull', family: 'pulls', aliases: ['Tirage d’arraché segmenté'], tags: ['pauses', 'positions'] },
  { id: 'segment-clean-pull', name: 'Segment Clean Pull', family: 'pulls', aliases: ['Tirage d’épaulé segmenté'], tags: ['pauses', 'positions'] },

  { id: 'pause-squat', name: 'Pause Squat', family: 'squats', aliases: ['Pause Back Squat', 'Squat arrière avec pause'], tags: ['pause', 'jambes'] },
  { id: 'pause-front-squat', name: 'Pause Front Squat', family: 'squats', aliases: ['Squat avant avec pause'], tags: ['pause', 'épaulé'] },
  { id: 'tempo-squat', name: 'Tempo Squat', family: 'squats', aliases: ['Tempo Back Squat', 'Squat arrière tempo'], tags: ['tempo', 'contrôle'] },
  { id: 'tempo-front-squat', name: 'Tempo Front Squat', family: 'squats', aliases: ['Squat avant tempo'], tags: ['tempo', 'épaulé'] },
  { id: 'overhead-squat', name: 'Overhead Squat', family: 'squats', aliases: ['Squat d’arraché', 'Snatch Squat', 'OHS'], tags: ['arraché', 'overhead'] },
  { id: 'split-squat', name: 'Split Squat', family: 'squats', aliases: ['Squat en fente'], tags: ['unilatéral', 'jambes'] },
  { id: 'bulgarian-split-squat', name: 'Bulgarian Split Squat', family: 'squats', aliases: ['Squat bulgare', 'Rear-Foot-Elevated Split Squat'], tags: ['unilatéral', 'pied surélevé'] },
  { id: 'goblet-squat', name: 'Goblet Squat', family: 'squats', aliases: ['Squat gobelet'], tags: ['haltère', 'jambes'] },
  { id: 'zombie-squat', name: 'Zombie Squat', family: 'squats', aliases: ['Squat avant bras tendus'], tags: ['front rack', 'posture'] },
  { id: 'box-squat', name: 'Box Squat', family: 'squats', aliases: ['Squat sur boîte'], tags: ['box', 'jambes'] },
  { id: 'pin-front-squat', name: 'Pin Front Squat', family: 'squats', aliases: ['Squat avant depuis les supports'], tags: ['pins', 'départ arrêté'] },
  { id: 'pin-back-squat', name: 'Pin Back Squat', family: 'squats', aliases: ['Squat arrière depuis les supports'], tags: ['pins', 'départ arrêté'] },

  { id: 'push-press', name: 'Push Press', family: 'strength', aliases: ['Développé avec impulsion'], tags: ['épaules', 'poussée'] },
  { id: 'strict-press', name: 'Strict Press', family: 'strength', aliases: ['Développé militaire', 'Overhead Press'], tags: ['épaules', 'strict'] },
  { id: 'bench-press', name: 'Bench Press', family: 'strength', aliases: ['Développé couché'], tags: ['pectoraux', 'poussée'] },
  { id: 'deadlift', name: 'Deadlift', family: 'strength', aliases: ['Soulevé de terre', 'Conventional Deadlift'], tags: ['force', 'chaîne postérieure'] },
  { id: 'good-morning', name: 'Good Morning', family: 'strength', aliases: ['Flexion du buste barre sur la nuque'], tags: ['ischios', 'dos'] },
  { id: 'pendlay-row', name: 'Pendlay Row', family: 'strength', aliases: ['Rowing Pendlay'], tags: ['dos', 'départ au sol'] },
  { id: 'snatch-push-press', name: 'Snatch Push Press', family: 'strength', aliases: ['Développé nuque prise arraché avec impulsion'], tags: ['arraché', 'overhead'] },
  { id: 'behind-the-neck-press', name: 'Behind-the-Neck Press', family: 'strength', aliases: ['Développé nuque'], tags: ['épaules', 'strict'] },
  { id: 'snatch-press', name: 'Snatch Press', family: 'strength', aliases: ['Développé nuque prise arraché'], tags: ['arraché', 'strict'] },
  { id: 'seated-press', name: 'Seated Press', family: 'strength', aliases: ['Développé militaire assis'], tags: ['épaules', 'assis'] },
  { id: 'incline-bench-press', name: 'Incline Bench Press', family: 'strength', aliases: ['Développé couché incliné'], tags: ['pectoraux', 'incliné'] },
  { id: 'close-grip-bench-press', name: 'Close-Grip Bench Press', family: 'strength', aliases: ['Développé couché prise serrée'], tags: ['triceps', 'poussée'] },
  { id: 'sumo-deadlift', name: 'Sumo Deadlift', family: 'strength', aliases: ['Soulevé de terre sumo'], tags: ['force', 'jambes'] },
  { id: 'trap-bar-deadlift', name: 'Trap Bar Deadlift', family: 'strength', aliases: ['Soulevé de terre à la barre hexagonale'], tags: ['force', 'trap bar'], equipment: 'Barre hexagonale' },
  { id: 'stiff-leg-deadlift', name: 'Stiff-Leg Deadlift', family: 'strength', aliases: ['Soulevé de terre jambes tendues'], tags: ['ischios', 'chaîne postérieure'] },
  { id: 'seated-good-morning', name: 'Seated Good Morning', family: 'strength', aliases: ['Good Morning assis'], tags: ['dos', 'assis'] },
  { id: 'bent-over-row', name: 'Bent-Over Row', family: 'strength', aliases: ['Rowing barre buste penché'], tags: ['dos', 'tirage horizontal'] },

  { id: 'pull-up', name: 'Pull-up', family: 'accessories', aliases: ['Traction pronation', 'Pullup'], tags: ['dos', 'poids du corps'] },
  { id: 'chin-up', name: 'Chin-up', family: 'accessories', aliases: ['Traction supination', 'Chinup'], tags: ['dos', 'biceps'] },
  { id: 'dumbbell-row', name: 'Dumbbell Row', family: 'accessories', aliases: ['Rowing haltère'], tags: ['dos', 'unilatéral'], equipment: 'Haltère' },
  { id: 'lunges', name: 'Lunges', family: 'accessories', aliases: ['Fentes avant', 'Forward Lunge'], tags: ['unilatéral', 'jambes'] },
  { id: 'walking-lunges', name: 'Walking Lunges', family: 'accessories', aliases: ['Fentes marchées'], tags: ['unilatéral', 'jambes'] },
  { id: 'reverse-lunges', name: 'Reverse Lunges', family: 'accessories', aliases: ['Fentes arrière'], tags: ['unilatéral', 'jambes'] },
  { id: 'lateral-lunges', name: 'Lateral Lunges', family: 'accessories', aliases: ['Fentes latérales'], tags: ['unilatéral', 'adducteurs'] },
  { id: 'step-up', name: 'Step-up', family: 'accessories', aliases: ['Montée sur banc'], tags: ['unilatéral', 'jambes'] },
  { id: 'back-extension', name: 'Back Extension', family: 'accessories', aliases: ['Extension du dos', 'Extension lombaire'], tags: ['dos', 'chaîne postérieure'] },
  { id: 'reverse-hyperextension', name: 'Reverse Hyperextension', family: 'accessories', aliases: ['Extension lombaire inversée', 'Reverse Hyper'], tags: ['dos', 'fessiers'] },
  { id: 'glute-ham-raise', name: 'Glute-Ham Raise', family: 'accessories', aliases: ['Relevé sur GHD', 'GHR'], tags: ['ischios', 'chaîne postérieure'] },
  { id: 'nordic-curl', name: 'Nordic Curl', family: 'accessories', aliases: ['Flexion nordique des ischios'], tags: ['ischios', 'excentrique'] },
  { id: 'hip-thrust', name: 'Hip Thrust', family: 'accessories', aliases: ['Relevé de bassin dos sur banc'], tags: ['fessiers', 'extension de hanche'] },
  { id: 'glute-bridge', name: 'Glute Bridge', family: 'accessories', aliases: ['Pont fessier'], tags: ['fessiers', 'au sol'] },
  { id: 'single-leg-romanian-deadlift', name: 'Single-Leg Romanian Deadlift', family: 'accessories', aliases: ['Soulevé de terre roumain sur une jambe'], tags: ['unilatéral', 'ischios'] },
  { id: 'dumbbell-bench-press', name: 'Dumbbell Bench Press', family: 'accessories', aliases: ['Développé couché haltères'], tags: ['pectoraux', 'poussée'], equipment: 'Haltères' },
  { id: 'dumbbell-shoulder-press', name: 'Dumbbell Shoulder Press', family: 'accessories', aliases: ['Développé épaules haltères'], tags: ['épaules', 'poussée'], equipment: 'Haltères' },
  { id: 'dips', name: 'Dips', family: 'accessories', aliases: ['Répulsions aux barres parallèles'], tags: ['triceps', 'poids du corps'] },
  { id: 'face-pull', name: 'Face Pull', family: 'accessories', aliases: ['Tirage au visage'], tags: ['épaules', 'haut du dos'] },
  { id: 'band-pull-apart', name: 'Band Pull-Apart', family: 'accessories', aliases: ['Écarté à l’élastique'], tags: ['épaules', 'haut du dos'], equipment: 'Élastique' },
  { id: 'hanging-leg-raise', name: 'Hanging Leg Raise', family: 'accessories', aliases: ['Relevé de jambes suspendu'], tags: ['abdominaux', 'tronc'] },
  { id: 'weighted-crunch', name: 'Weighted Crunch', family: 'accessories', aliases: ['Crunch lesté'], tags: ['abdominaux', 'tronc'] },
  { id: 'ab-wheel-rollout', name: 'Ab Wheel Rollout', family: 'accessories', aliases: ['Roue abdominale'], tags: ['abdominaux', 'tronc'] },
] as const satisfies readonly ExerciseMetadata[]

export type Exercise = (typeof exercises)[number]
export type ExerciseId = Exercise['id']
export type RecordExerciseId = 'snatch' | 'clean-and-jerk' | 'front-squat' | 'back-squat'
export type RecordExercise = Extract<Exercise, { id: RecordExerciseId }>

export function isRecordExerciseId(id: unknown): id is RecordExerciseId {
  return id === 'snatch' || id === 'clean-and-jerk' || id === 'front-squat' || id === 'back-squat'
}

export const recordExercises = exercises.filter((exercise): exercise is RecordExercise => isRecordExerciseId(exercise.id))

export function isExerciseId(id: unknown): id is ExerciseId {
  return typeof id === 'string' && exercises.some((exercise) => exercise.id === id)
}
