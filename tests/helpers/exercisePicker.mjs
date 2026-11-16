// Parcours explicites pour les recettes antérieures au sélecteur E1.
export function exercisePickerActions({ call, click, settle }) {
  async function chooseExercise(exerciseId) {
    const found = await call(id => {
      const button = document.querySelector(`.exercise-picker[open] [data-exercise-id="${id}"]`)
      if (!button) return false
      button.scrollIntoView({ block: 'nearest' })
      button.focus({ preventScroll: true })
      button.click()
      return true
    }, exerciseId)
    if (!found) throw new Error(`Exercice introuvable dans le sélecteur : ${exerciseId}`)
    await settle()
  }
  async function addExercise(exerciseId = 'snatch', scope = 'body') {
    await click('+ Ajouter un exercice', scope)
    await chooseExercise(exerciseId)
  }
  async function changeExercise(exerciseId, scope = '.workout-exercise') {
    await call(scope => {
      const button = document.querySelector(scope).querySelector('.workout-movement-button')
      button.focus({ preventScroll: true })
      button.click()
    }, scope)
    await settle()
    await chooseExercise(exerciseId)
  }
  return { addExercise, changeExercise, chooseExercise }
}
