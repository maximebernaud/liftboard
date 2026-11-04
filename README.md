# React + TypeScript + Vite

## LiftBoard — sauvegardes J7

Dans **Mes séances → Sauvegarde des données**, « Exporter mes données » télécharge
les données enregistrées et « Restaurer une sauvegarde » ouvre un aperçu local.
L’aperçu indique le nombre de Records et de séances planifiées/terminées, permet
d’exporter les données actuelles et exige une confirmation avant le remplacement
complet. Annuler ne modifie aucune donnée métier. Aucun fichier n’est envoyé à un serveur.

Le fichier `liftboard-sauvegarde-AAAA-MM-JJ.json` suit ce format :

```json
{
  "format": "liftboard.backup",
  "version": 1,
  "exportedAt": "2026-11-04T12:00:00.000Z",
  "data": {
    "records": [],
    "workouts": []
  }
}
```

`records` et `workouts` reprennent les modèles persistés existants, sans recalcul
des charges, migration des résultats ni modification des identifiants. Les trois
notes, les arrondis, les charges prévues, les performances partielles/confirmées et
les effacements explicites sont conservés. Les anciens résultats à zéro ou dépassant
les limites de nouvelle saisie restent lisibles, selon les validateurs existants.
L’unicité des identifiants suit le lecteur actuel : Records par mouvement, séances
dans la liste, blocs et séries dans chaque séance.

Seules `liftboard.personal-records.v1` et `liftboard.workouts.v1` sont exportées et
remplacées. La navigation dans `sessionStorage`, les autres clés et les brouillons
en mémoire sont exclus. Un éditeur de Record ouvert, un brouillon de séance ou des
notes/performances non enregistrées bloquent la restauration, même dans un onglet
masqué ; il faut les enregistrer ou les abandonner explicitement avant de continuer.
Après restauration, les vues métier repartent des données relues ; les saisies du
calculateur restent en mémoire et utilisent les Records restaurés.

Limite du fichier : 10 × 1024² octets, en import comme en export. Un export refuse
une source corrompue/inaccessible au lieu de produire un fichier incomplet. Une
sauvegarde valide peut remplacer des données actuelles corrompues après confirmation.
Le fichier ne fournit ni chiffrement ni synchronisation cloud.

Les écritures `localStorage` sur deux clés ne sont **pas une transaction atomique**.
Les valeurs brutes précédentes sont gardées en mémoire, les nouvelles valeurs sont
relues avant tout succès et un échec déclenche une tentative de récupération.
Si cette récupération ne peut pas être vérifiée, l’interface signale le risque de
données mélangées et recharge les vues. Une fermeture brutale entre les écritures,
une modification concurrente dans un autre onglet ou une panne durable du stockage
ne peuvent pas être annulées automatiquement ; conserver le fichier de sauvegarde.

Vérifications :

```powershell
npm.cmd run build
npm.cmd run lint
node --test tests/*.test.ts
git diff --check
git status --short
```

Les tests unitaires J7 sont dans `tests/backup.test.ts`. Le parcours Chrome existant
comprend aussi dix cas J7 (téléchargement réellement reçu, sélection native,
aperçu/annulation, fichiers refusés, saisies masquées, quota, remplacement et F5),
puis les régressions J5/J6. Il utilise uniquement un profil temporaire isolé et
conserve les fichiers/captures dans le dossier temporaire indiqué à la fin :

```powershell
# Terminal 1
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
# Terminal 2 (Chrome installé, ou LIFTBOARD_TEST_CHROME défini)
node tests/workouts.browser.mjs http://127.0.0.1:5173
```

Recette manuelle sur **deux profils de test distincts** :

1. Dans A, créer des Records, une séance planifiée et une terminée avec notes et
   performances ; exporter et vérifier le fichier téléchargé.
2. Dans B vierge, sélectionner ce fichier, vérifier les trois compteurs puis annuler :
   B doit rester vide. Sélectionner à nouveau et confirmer ; contrôler Records,
   Séances, Historique, charges, performances et les trois notes, puis recharger F5.
3. Ajouter une donnée différente dans B, exporter sa sauvegarde puis restaurer A :
   la donnée propre à B doit disparaître. Refuser un JSON invalide ou une version 99
   doit laisser les données et les vues métier intactes.
4. Laisser un Record en édition ou un brouillon de séance avant de revenir à la
   liste : la restauration doit être bloquée et la saisie rester disponible après
   annulation. Vérifier également une note historique dont l’écriture est en échec.
5. Tester au clavier (Tab, Entrée, Échap, retour du focus sur le bouton de sélection)
   et aux largeurs 320, 393, 430, 768 et 1440 px : aucun débordement horizontal,
   boutons accessibles et confirmation lisible. Vérifier aussi sur téléphone réel.

React : le state conserve le fichier validé en mémoire sans écrire dans le stockage.
Les props transmettent les résultats et les indicateurs de saisie entre composants.
Les effets signalent les saisies en cours ; une nouvelle clé React après restauration
réinitialise les anciennes copies métier. TypeScript décrit le format et distingue
explicitement succès, refus et récupération incertaine ; les validateurs contrôlent
les données réelles à l’exécution.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
