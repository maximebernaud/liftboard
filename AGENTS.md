# Directives pour Codex — LiftBoard

## Mission
Développer une application frontend de carnet et création de séances d'haltérophilie avec React + TypeScript + Vite. Objectif : MVP soigné en un sprint d'environ 10 jours.

## Avant chaque modification
- Lire le README du dépôt et `PROJECT.md` / `ROADMAP.md` / `STACK.md` / `ARCHITECTURE.md` s'ils sont présents.
- Résumer en une phrase la portée de la tâche.
- Ne modifier que les fichiers nécessaires. Respecter les changements non committés existants.

## Principes
- Utiliser TypeScript, composants fonctionnels React et hooks standards.
- Favoriser code simple et lisible. Éviter architecture prématurée, Redux, serveur, authentification et gros UI kits.
- Conserver les données en `localStorage` pour la V1 ; ne stocker aucun secret.
- Utiliser des calculs purs, types explicites, gestion d'erreurs et labels accessibles.
- Ne pas ajouter de dépendances non nécessaires sans justification.
- Ne pas supprimer les tests existants pour faire passer le build.

## Validation attendue
- Après changement : exécuter `npm run build` et les tests disponibles si l'environnement le permet.
- Résumer : fichiers modifiés, comportement, commandes exécutées, limites ou vérifications manuelles restantes.
- Quand tu ajoutes une notion React importante (state/props/useEffect), l'expliquer en trois phrases simples au porteur de projet.
