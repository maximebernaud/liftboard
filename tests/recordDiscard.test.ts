import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { recordDiscardMessage, type RecordEditDraft } from '../src/lib/recordDiscard.ts'

const draft: RecordEditDraft = {
  exerciseId: 'snatch', original: { exerciseId: 'snatch', oneRepMaxKg: 100 }, input: '95',
}

describe('message d’abandon d’un Record', () => {
  it('reprend exactement le mouvement, la référence d’ouverture, la saisie et la destination', () => {
    assert.deepEqual(recordDiscardMessage(draft, 'clean-and-jerk'), {
      change: "Tu as modifié ton Record de Snatch de 100 kg à 95 kg, mais tu ne l'as pas enregistré.",
      consequence: 'Si tu ouvres Clean & Jerk, ta saisie de 95 kg sera perdue. La valeur actuellement enregistrée ne sera pas modifiée par cet abandon.',
    })
  })

  it('utilise les décimales françaises et les noms réels pour un autre mouvement et une autre destination', () => {
    const message = recordDiscardMessage({
      exerciseId: 'clean-and-jerk', original: { exerciseId: 'clean-and-jerk', oneRepMaxKg: 120.5 }, input: ' 117.25 ',
    }, 'front-squat')
    assert.equal(message.change, "Tu as modifié ton Record de Clean & Jerk de 120,5 kg à 117,25 kg, mais tu ne l'as pas enregistré.")
    assert.match(message.consequence, /^Si tu ouvres Front Squat, ta saisie de 117,25 kg sera perdue\./)
  })

  it('décrit une première saisie sans inventer une ancienne valeur ou un Record enregistré', () => {
    assert.deepEqual(recordDiscardMessage({ ...draft, original: null }, 'back-squat'), {
      change: "Tu as saisi un Record de Snatch à 95 kg, mais tu ne l'as pas enregistré.",
      consequence: 'Si tu ouvres Back Squat, ta saisie de 95 kg sera perdue. Les données actuellement enregistrées ne seront pas modifiées par cet abandon.',
    })
  })

  it('décrit un champ vidé sans le transformer en zéro kg', () => {
    for (const input of ['', '   ']) {
      const message = recordDiscardMessage({ ...draft, input }, 'clean-and-jerk')
      assert.match(message.change, /vidé le champ.*Snatch.*initialement à 100 kg/)
      assert.equal(message.consequence, 'Si tu ouvres Clean & Jerk, ta saisie actuelle sera perdue. La valeur actuellement enregistrée ne sera pas modifiée par cet abandon.')
      assert.doesNotMatch(message.change, /(?:à|de) 0 kg/)
    }
  })

  it('décrit un champ vide sans Record initial sans afficher la moindre valeur en kg', () => {
    const message = recordDiscardMessage({ ...draft, original: null, input: ' ' }, 'clean-and-jerk')
    assert.match(message.change, /Snatch n'était pas renseigné.*champ est actuellement vide/)
    assert.doesNotMatch(message.change + message.consequence, /kg/)
  })

  it('cite les saisies invalides telles quelles sans les annoncer comme des poids', () => {
    for (const input of ['invalide', '0', '-5', 'NaN', 'Infinity', '1e999', '0x10', '<script>texte</script>']) {
      for (const original of [draft.original, null]) {
        const message = recordDiscardMessage({ ...draft, input, original }, 'clean-and-jerk')
        assert.ok(message.change.includes(`« ${input} »`))
        assert.match(message.change, /n'est pas une valeur valide/)
        assert.match(message.consequence, /ta saisie actuelle sera perdue/)
        assert.doesNotMatch(message.consequence, /kg/)
        if (!original) assert.doesNotMatch(message.change, /kg/)
      }
    }
  })

  it('reste neutre sur l’action quand il n’y a pas de changement d’exercice', () => {
    const message = recordDiscardMessage(draft)
    assert.equal(message.consequence, 'Si tu abandonnes ces modifications, ta saisie de 95 kg sera perdue. La valeur actuellement enregistrée ne sera pas modifiée par cet abandon.')
    assert.doesNotMatch(message.consequence, /ouvres/)
  })

  it('n’annonce pas une ouverture si la destination est le même mouvement', () => {
    assert.match(recordDiscardMessage(draft, 'snatch').consequence, /^Si tu abandonnes ces modifications,/)
  })
})
