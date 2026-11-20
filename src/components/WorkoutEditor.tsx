import { useEffect,useRef,useState } from 'react'
import { exercises,isRecordExerciseId,type ExerciseId } from '../data/exercises'
import type { RecordsLoadResult } from '../data/personalRecords'
import {
  createWorkoutExerciseDraft,
  createWorkoutSetDraft,
  hasWorkoutExerciseData,
} from '../lib/workoutDraft'
import { duplicateAppSetDraft as duplicateWorkoutSetDraft, changeAppMovement as changeDraftMovement, getAppSetLoad, updateAppExercise as updateDraftExercise, updateAppSet as updateDraftSet, validateAppWorkoutDraft as validateWorkoutDraft, newE2LoadDraft } from '../lib/workoutEditorDraft'
import WorkoutLoadFields from './WorkoutLoadFields'
import { roundingIncrements } from '../lib/loadCalculator'
import { handleNumericArrow } from '../lib/numericInput'
import type { AppWorkoutDraft as WorkoutDraft,AppDraftErrors as WorkoutDraftErrors,AppExerciseDraft as WorkoutExerciseDraft,WorkoutSetRounding } from '../types/workout'
import WorkoutNotesFields from './WorkoutNotesFields'
import WorkoutConfirmation from './WorkoutConfirmation'
import ExercisePicker from './ExercisePicker'

// Un seul contrôle combine le pas et la direction pour rester compact sur mobile.
const roundingOptions: { value: string; label: string; rounding: WorkoutSetRounding }[]=[
  { value: 'exact',label: 'Sans arrondi',rounding: { mode: 'exact' } },
  ...(['up','down'] as const).flatMap((mode) => roundingIncrements.map((increment) => ({
    value: `${mode}-${increment}`,
    label: `Vers le ${mode==='up'? 'haut':'bas'} · ${increment.toString().replace('.',',')} kg`,
    rounding: { mode,increment },
  }))),
]

type DraftFieldProps={
  id: string
  label: string
  value: string
  error?: string
  type?: 'text'|'date'
  inputMode?: 'numeric'|'decimal'
  onChange: (value: string) => void
  showErrors?: boolean
}

function DraftField({ id,label,value,error,type='text',inputMode,onChange,showErrors }: DraftFieldProps) {
  const [touched,setTouched]=useState(false)
  const visibleError=(showErrors||touched||value!=='')? error:undefined

  return (
    <div className="workout-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete="off"
        spellCheck={false}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={inputMode? (event) => handleNumericArrow(
          event.nativeEvent,event.currentTarget.value,inputMode==='numeric'? 'reps':'intensity',onChange,
        ):undefined}
        onBlur={() => setTouched(true)}
        aria-invalid={Boolean(visibleError)}
        aria-describedby={visibleError? `${id}-error`:undefined}
      />
      {visibleError&&(
        <p id={`${id}-error`} className="record-error" role="alert">{visibleError}</p>
      )}
    </div>
  )
}

type ExerciseBlockProps={
  block: WorkoutExerciseDraft
  number: number
  errors: WorkoutDraftErrors['blocks'][string]
  storedRecords: RecordsLoadResult
  onChange: (update: (draft: WorkoutDraft) => WorkoutDraft) => void
  onRemove: () => void
  onOpenRecords: () => void
  onChooseMovement: () => void
  initiallyExpanded: boolean
  showErrors: boolean
}

function ExerciseBlock({ block,number,errors,storedRecords,onChange,onRemove,onOpenRecords,onChooseMovement,initiallyExpanded,showErrors }: ExerciseBlockProps) {
  const addSetButton=useRef<HTMLButtonElement>(null)
  const revealAddedSet=useRef<string|null>(null)
  const [expandedSetId,setExpandedSetId]=useState<string|null>(() =>
    initiallyExpanded||number===1||block.sets.some((set) => errors.fields[set.id])? block.sets[0]?.id??null:null,
  )
  const record=storedRecords.records?.find((item) => item.exerciseId===block.exerciseId)
  const exerciseName=exercises.find((item) => item.id===block.exerciseId)?.name
  const recordSupported=isRecordExerciseId(block.exerciseId)
  const hasLegacySets=block.sets.some((set) => !set.e2||set.e2.method==='legacy')
  const blockId=`workout-block-${block.id}`

  useEffect(() => {
    if(!revealAddedSet.current) return
    // Révéler le numéro et les champs ajoutés sans déplacer le focus vers un input.
    if(block.sets.at(-1)?.id===revealAddedSet.current) {
      addSetButton.current?.scrollIntoView({ block: 'nearest',behavior: 'instant' })
    }
    const title=document.getElementById(`workout-set-${revealAddedSet.current}-title`)
    title?.scrollIntoView({ block: 'nearest',behavior: 'instant' })
    revealAddedSet.current=null
  },[block.sets])

  return (
    <article className="workout-exercise" aria-labelledby={`${blockId}-title`}>
      <div className="workout-block-heading">
        <h3 id={`${blockId}-title`}><span className="workout-exercise-number">Exercice {number}</span>{exerciseName}</h3>
        <button
          className="record-button record-button-delete workout-remove"
          type="button"
          aria-label={`Retirer l’exercice ${number} : ${exerciseName} et toutes ses séries`}
          onClick={onRemove}
        >
          Retirer l’exercice
        </button>
      </div>

      <div className="workout-movement-context">
        <div className="workout-field">
          <span id={`${blockId}-label`} className="workout-label">Mouvement</span>
          <button
            id={blockId}
            type="button"
            className="record-button workout-movement-button"
            aria-label={`Changer le mouvement de l’exercice ${number} : ${exerciseName}`}
            aria-haspopup="dialog"
            onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onChooseMovement() }}
          >
            <span>{exerciseName}</span><span aria-hidden="true">Changer ↗</span>
          </button>
          {errors.exercise&&<p className="record-error" role="alert">{errors.exercise}</p>}
        </div>

        <div className="workout-record-context">
          {hasLegacySets? <>
          {!recordSupported? (
            <p>Aucun Record disponible pour ce mouvement. La charge prévue reste non calculée ; la séance peut être enregistrée.</p>
          ):storedRecords.records===null? (
            <p className="record-error">Records indisponibles. Le calcul est en attente.</p>
          ):record? (
            <p>Record actuel (1RM) : <strong>{record.oneRepMaxKg.toString().replace('.',',')} kg</strong></p>
          ):(
            <p>Record à renseigner</p>
          )}
          {block.sets.some((set) => set.savedLoad!==undefined)&&<p>Les charges déjà enregistrées restent figées.{recordSupported&&' Le record actuel s’applique aux nouveaux calculs.'}</p>}
          {recordSupported&&(!record||storedRecords.records===null)&&(
            <button className="record-button" type="button" onClick={onOpenRecords}>
              Ouvrir les Records
            </button>
          )}
          </>:<p>Chaque série conserve sa méthode de charge et sa référence choisie. Les charges enregistrées restent figées.</p>}
        </div>
      </div>

      <div className="workout-set-list">
        {block.sets.map((set,index) => {
          const setId=`workout-set-${set.id}`
          const load=getAppSetLoad(set,storedRecords.records,block.exerciseId)
          const method=set.e2?.method??'legacy'
          const canCalculateSavedLoad=method==='legacy'&&set.savedLoad===null&&
            getAppSetLoad({ ...set,savedLoad: undefined },storedRecords.records,block.exerciseId).status==='ready'
          const prescription=method==='legacy'? `${set.intensityInput||'—'} % du 1RM`
            :method==='manual'? 'Charge libre'
              :method==='none'? 'Sans charge prévue'
                :`${set.e2?.intensityInput||'—'} % de ${set.e2?.reference?.exerciseName??'référence à choisir'}`
          const fieldErrors=errors.fields[set.id]
          // Une erreur visible force l'ouverture, même si une autre série est sélectionnée.
          const needsCorrection=Boolean(fieldErrors)
          const expanded=expandedSetId===set.id||needsCorrection
          const loadMessage=set.savedLoad===null
            ? 'Charge non enregistrée'
            :!recordSupported
              ? 'Aucun Record disponible pour ce mouvement'
            :storedRecords.records===null
              ? 'Records indisponibles'
              :load.status==='missing-record'
                ? 'Record à renseigner'
                :load.status==='invalid-input'
                  ? 'Saisie à compléter'
                  :'Calcul indisponible'

          return (
            <fieldset className={`workout-set${expanded? '':' workout-set-compact'}`} key={set.id}>
              <legend id={`${setId}-title`}>Série {index+1}<span className="workout-set-open-label"> · ouverte</span></legend>
              <div className="workout-set-layout">
                {/* Les champs restent montés : valeurs, erreurs et état de visite sont conservés. */}
                <div id={`${setId}-editor`} className="workout-set-editor" hidden={!expanded}>
                  <div className="workout-field workout-load-method">
                    <label htmlFor={`${setId}-method`}>Méthode de charge</label>
                    <select id={`${setId}-method`} value={set.e2?.method??'legacy'} onChange={(event) => {
                      const method=event.target.value
                      if(method==='legacy'||method==='percentage'||method==='manual'||method==='none') {
                        onChange((draft) => updateDraftSet(draft,block.id,set.id,{ e2: { ...(set.e2??newE2LoadDraft(set)),method } }))
                      }
                    }}>
                      <option value="legacy">Programmation historique (%)</option>
                      <option value="percentage">% du 1RM</option>
                      <option value="manual">Charge libre (kg)</option>
                      <option value="none">Sans charge prévue</option>
                    </select>
                  </div>
                  <div className="workout-set-fields">
                    <DraftField
                      id={`${setId}-reps`}
                      label="Répétitions"
                      inputMode="numeric"
                      value={set.repsInput}
                      error={fieldErrors?.reps}
                      showErrors={showErrors}
                      onChange={(repsInput) => onChange((draft) => updateDraftSet(draft,block.id,set.id,{ repsInput }))}
                    />
                    {(!set.e2||set.e2.method==='legacy')&&<DraftField
                      id={`${setId}-intensity`}
                      label="Intensité (% du 1RM)"
                      inputMode="decimal"
                      value={set.intensityInput}
                      error={fieldErrors?.intensity}
                      showErrors={showErrors}
                      onChange={(intensityInput) => onChange((draft) => updateDraftSet(draft,block.id,set.id,{ intensityInput }))}
                    />}
                  </div>
                  {(!set.e2||set.e2.method==='legacy')&&<div className="workout-field workout-rounding">
                    <label htmlFor={`${setId}-rounding`}>Ajustement de la charge</label>
                    <select
                      id={`${setId}-rounding`}
                      value={set.rounding.mode==='exact'? 'exact':`${set.rounding.mode}-${set.rounding.increment}`}
                      onChange={(event) => {
                        const option=roundingOptions.find((item) => item.value===event.target.value)
                        if(option) {
                          onChange((draft) => updateDraftSet(draft,block.id,set.id,{ rounding: { ...option.rounding } }))
                        }
                      }}
                      aria-invalid={Boolean(fieldErrors?.rounding)}
                      aria-describedby={fieldErrors?.rounding? `${setId}-rounding-error`:undefined}
                    >
                      {roundingOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    {fieldErrors?.rounding&&(
                      <p id={`${setId}-rounding-error`} className="record-error" role="alert">{fieldErrors.rounding}</p>
                    )}
                  </div>}
                  {set.e2&&set.e2.method!=='legacy'&&<WorkoutLoadFields id={setId} value={set.e2} errors={fieldErrors}
                    storedRecords={storedRecords} onOpenRecords={onOpenRecords}
                    shortcut={storedRecords.records?.find((record) => record.exerciseId===block.sets.slice(0,index).findLast((item) => item.e2?.reference)?.e2?.reference?.exerciseId)}
                    onChange={(e2) => onChange((draft) => updateDraftSet(draft,block.id,set.id,{ e2 }))} />}
                </div>
                <div className="workout-set-result">
                  <div className="workout-load" role="status" aria-live="polite" aria-atomic="true">
                    <span className="workout-label">
                      Charge prévue
                    </span>
                    {load.status==='ready'? (
                      <>
                        <strong>{load.selectedKg.toString().replace('.',',')} <span>kg</span></strong>
                        {load.selectedKg!==load.exactKg&&(
                          <span className="record-hint">Charge exacte calculée : {load.exactKg.toString().replace('.',',')} kg</span>
                        )}
                      </>
                    ):(
                      <><strong>—</strong><span className="record-hint">{method!=='legacy'? (method==='none'?'Sans charge prévue':'Saisie à compléter ou référence à vérifier'):loadMessage}</span></>
                    )}
                    <p className="workout-set-prescription" hidden={expanded}>{set.repsInput||'—'} rép. · {prescription}</p>
                  </div>
                  <div className="workout-set-controls">
                    {canCalculateSavedLoad&&(
                      <button className="record-button" type="button" onClick={() =>
                        onChange((draft) => updateDraftSet(draft,block.id,set.id,{ savedLoad: undefined }))
                      }>
                        Calculer cette charge
                      </button>
                    )}
                    <button className="record-button workout-set-toggle" type="button"
                      aria-label={`${expanded? 'Replier':'Modifier'} la série ${index+1} de l’exercice ${number}`}
                      aria-expanded={expanded} aria-controls={`${setId}-editor`}
                      disabled={needsCorrection} aria-describedby={needsCorrection? `${setId}-collapse-hint`:undefined}
                      onClick={() => setExpandedSetId(expanded? null:set.id)}>
                      {expanded? 'Replier':'Modifier'}
                    </button>
                    <button
                      className="record-button workout-set-duplicate"
                      type="button"
                      aria-label={`Dupliquer la série ${index+1} de l’exercice ${number}`}
                      onClick={() => {
                        const copy=duplicateWorkoutSetDraft(set,storedRecords.records??[])
                        revealAddedSet.current=copy.id
                        setExpandedSetId(copy.id)
                        onChange((draft) => updateDraftExercise(draft,block.id,(current) => ({
                          ...current,sets: current.sets.flatMap((item) => item.id===set.id? [item,copy]:[item]),
                        })))
                      }}
                    >
                      Dupliquer la série
                    </button>
                    <button
                      className="record-button record-button-delete workout-remove"
                      type="button"
                      aria-label={`Retirer la série ${index+1} de l’exercice ${number} : ${exerciseName}`}
                      onClick={() => {
                        onChange((draft) => updateDraftExercise(draft,block.id,(current) => ({
                          ...current,sets: current.sets.filter((item) => item.id!==set.id),
                        })))
                        addSetButton.current?.focus({ preventScroll: true })
                      }}
                    >
                      Retirer la série
                    </button>
                  </div>
                </div>
              </div>
              {needsCorrection&&<p id={`${setId}-collapse-hint`} className="record-hint">Corrigez les champs indiqués avant de replier cette série.</p>}
            </fieldset>
          )
        })}
      </div>
      {errors.sets&&<p className={showErrors? 'record-error':'record-hint'} role={showErrors? 'alert':undefined}>{errors.sets}</p>}
      <button
        ref={addSetButton}
        className="record-button workout-add-set"
        type="button"
        aria-label={`Ajouter une série à l’exercice ${number} : ${exerciseName}`}
        onClick={() => {
          const set=createWorkoutSetDraft()
          revealAddedSet.current=set.id
          setExpandedSetId(set.id)
          onChange((draft) => updateDraftExercise(draft,block.id,(current) => ({
            ...current,sets: [...current.sets,set],
          })))
        }}
      >
        + Ajouter une série
      </button>
    </article>
  )
}

type WorkoutEditorProps={
  draft: WorkoutDraft
  storedRecords: RecordsLoadResult
  onChange: (update: (draft: WorkoutDraft) => WorkoutDraft) => void
  onOpenRecords: () => void
  showErrors?: boolean
}

function WorkoutEditor({ draft,storedRecords,onChange,onOpenRecords,showErrors=false }: WorkoutEditorProps) {
  const addExerciseButton=useRef<HTMLButtonElement>(null)
  const [pendingRemoval,setPendingRemoval]=useState<WorkoutExerciseDraft|null>(null)
  const [picker,setPicker]=useState<{ blockId?: string }|null>(null)
  const [addedBlockId,setAddedBlockId]=useState<string|null>(null)
  const [pendingMovement,setPendingMovement]=useState<{ blockId: string; exerciseId: ExerciseId }|null>(null)
  const { errors }=validateWorkoutDraft(draft,storedRecords.records)

  function chooseExercise(exerciseId: ExerciseId) {
    const blockId=picker?.blockId
    if(blockId) {
      if(draft.exercises.some((block) => block.id===blockId&&block.exerciseId!==exerciseId)) {
        const block=draft.exercises.find((item) => item.id===blockId)
        if(block?.sets.some((set) => (!set.e2||set.e2.method==='legacy')&&set.savedLoad!==undefined)) {
          setPendingMovement({ blockId,exerciseId })
        } else onChange((current) => changeDraftMovement(current,blockId,exerciseId))
      }
    } else {
      const block=createWorkoutExerciseDraft(exerciseId)
      setAddedBlockId(block.id)
      onChange((current) => ({ ...current,exercises: [...current.exercises,block] }))
      requestAnimationFrame(() => {
        const input=document.getElementById(`workout-set-${block.sets[0].id}-reps`)
        input?.focus({ preventScroll: true })
        input?.scrollIntoView({ block: 'center',behavior: 'instant' })
      })
    }
    setPicker(null)
  }

  function removeExercise(blockId: string) {
    onChange((current) => ({
      ...current,exercises: current.exercises.filter((item) => item.id!==blockId),
    }))
    setPendingRemoval(null)
    requestAnimationFrame(() => addExerciseButton.current?.focus({ preventScroll: true }))
  }

  return (
    <div className="workout-editor">
      <section className="workout-details" aria-labelledby="workout-details-title">
        <h2 id="workout-details-title" className="sessions-section-title">Informations de la séance</h2>
        <p className="record-hint">Titre, date et séries obligatoires. Un record manquant n’empêche pas l’enregistrement.</p>
        <div className="workout-details-fields">
          <DraftField
            id="workout-title"
            label="Titre"
            value={draft.title}
            error={errors.title}
            showErrors={showErrors}
            onChange={(title) => onChange((current) => ({ ...current,title }))}
          />
          <DraftField
            id="workout-date"
            label="Date"
            type="date"
            value={draft.date}
            error={errors.date}
            showErrors={showErrors}
            onChange={(date) => onChange((current) => ({ ...current,date }))}
          />
        </div>
      </section>

      <p className="record-hint">Lorsqu’un Record est disponible, la charge est calculée à partir du 1RM et de l’intensité choisie.</p>
      <section className="workout-exercises-section" aria-labelledby="workout-exercises-title">
        <h2 id="workout-exercises-title" className="sessions-section-title">Exercices et séries</h2>
        <div className="workout-exercise-list">
          {draft.exercises.map((block,index) => (
            <ExerciseBlock
              key={block.id}
              block={block}
              number={index+1}
              errors={errors.blocks[block.id]}
              storedRecords={storedRecords}
              onChange={onChange}
              onOpenRecords={onOpenRecords}
              onChooseMovement={() => setPicker({ blockId: block.id })}
              initiallyExpanded={block.id===addedBlockId}
              showErrors={showErrors}
              onRemove={() => {
                if(block.sets.some((set) => set.e2)||hasWorkoutExerciseData(block)) setPendingRemoval(block)
                else removeExercise(block.id)
              }}
            />
          ))}
        </div>
        {errors.exercises&&<p className={showErrors? 'record-error':'record-hint'} role={showErrors? 'alert':undefined}>{errors.exercises}</p>}
        <button
          ref={addExerciseButton}
          className="record-button workout-add-exercise"
          type="button"
          aria-haspopup="dialog"
          onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); setPicker({}) }}
        >
          + Ajouter un exercice
        </button>
      </section>
      <details className="workout-notes-section">
        <summary>Notes de séance <span className="record-hint">(facultatif)</span></summary>
        <p className="record-hint">Les notes seront sauvegardées avec le formulaire, lors de l’enregistrement.</p>
        <WorkoutNotesFields notes={draft.notes} onChange={(category,text) =>
          onChange((current) => ({ ...current,notes: { ...current.notes,[category]: text } }))
        } />
      </details>
      {picker&&<ExercisePicker currentExerciseId={draft.exercises.find((block) => block.id===picker.blockId)?.exerciseId}
        onSelect={chooseExercise} onCancel={() => setPicker(null)} />}
      {pendingMovement&&<WorkoutConfirmation title="Changer le mouvement ?" confirmLabel="Changer le mouvement"
        onCancel={() => setPendingMovement(null)} onConfirm={() => {
          onChange((current) => changeDraftMovement(current,pendingMovement.blockId,pendingMovement.exerciseId))
          setPendingMovement(null)
        }}>
        <p>Les répétitions sont conservées. Les charges historiques de ce bloc seront recalculées avec les Records actuels du nouveau mouvement, ou resteront sans charge si aucun Record n’est disponible.</p>
        <p>Les références E2 explicites, leurs charges figées et les charges libres seront conservées.</p>
      </WorkoutConfirmation>}
      {pendingRemoval&&(
        <WorkoutConfirmation title="Retirer cet exercice ?" confirmLabel="Retirer l’exercice"
          onCancel={() => setPendingRemoval(null)} onConfirm={() => removeExercise(pendingRemoval.id)}>
          <p>
            L’exercice {draft.exercises.findIndex((block) => block.id===pendingRemoval.id)+1} : {exercises.find((exercise) => exercise.id===pendingRemoval.exerciseId)?.name} et toutes ses séries seront retirés du brouillon.
            {' '}Enregistrez ensuite la séance pour conserver ce changement.
          </p>
        </WorkoutConfirmation>
      )}
    </div>
  )
}

export default WorkoutEditor
