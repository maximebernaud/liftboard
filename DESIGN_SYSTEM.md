# LiftBoard — Design System V1

> **Statut :** proposition à valider — 21 octobre 2026  
> **Direction artistique :** Forge Noire  
> **Produit :** application web d'haltérophilie, mobile-first  
> **Stack cible :** React + TypeScript + Vite + CSS natif  
> **Périmètre :** MVP — conception uniquement, aucune implémentation demandée

## 0. Vision et décisions structurantes

LiftBoard est **un outil d'entraînement**, pas une landing page ou un tableau de bord marketing. Son utilisateur principal, Khaled, doit pouvoir :

1. Préparer une séance avec exercices, séries, répétitions et intensités.
2. La consulter rapidement pendant l'entraînement.
3. La marquer explicitement comme terminée.
4. Renseigner ses records (1RM), calculer ses charges et retrouver ses séances.

**Identité :** précision mécanique, puissance maîtrisée, sobriété industrielle. Palette graphite, ivoire et or mat. L'or signale une action, une sélection ou une donnée prioritaire ; il ne décore pas chaque élément.

**Règle absolue :** sur l'écran initial, afficher les séances et une action « Nouvelle séance ». Pas de hero, slogan géant, image plein écran ou statistiques sans utilité immédiate.

**Références fonctionnelles :** Fallen (simplicité de préparation et organisation des séances), Strivee (structuration des exercices et calcul basé sur le 1RM). Ne pas copier leurs parcours complexes, la gestion de coachs, les programmes avancés ou les fonctions communautaires.

## 1. Couleurs et design tokens CSS

Ces variables constituent **la source unique de vérité** des couleurs et des mesures visuelles. La V1 ne prévoit **qu'un thème sombre** ; ne pas ajouter de thème clair ni de mécanisme de bascule.

```css
:root {
  color-scheme: dark;

  /* Identité Forge Noire */
  --lb-color-bg: #0F1112;          /* Fond global, app shell */
  --lb-color-surface: #1B1F20;     /* Cartes, navigation, formulaires */
  --lb-color-raised: #252A2B;      /* Inputs, zones secondaires, hover */
  --lb-color-accent: #D4A45A;      /* CTA primaire, actif, valeurs importantes */
  --lb-color-accent-hover: #E0B573;

  /* Textes */
  --lb-color-text: #F3F0E8;        /* Texte courant et valeurs principales */
  --lb-color-text-muted: #AAB0AD;  /* Descriptions, libellés secondaires */
  --lb-color-text-subtle: #92A09E; /* Métadonnées non essentielles */
  --lb-color-on-accent: #0F1112;   /* Texte/icône sur fond or */

  /* Contours */
  --lb-color-border: #353A3A;          /* Séparations et bordures décoratives */
  --lb-color-control-border: #758482;  /* Contours des champs/contrôles identifiables */
  --lb-color-focus: #D4A45A;

  /* États sémantiques : ponctuels, jamais couleurs de marque */
  --lb-color-success: #A6C7AC;    /* Séance terminée + confirmation */
  --lb-color-warning: #E7BE83;    /* Avertissement non bloquant */
  --lb-color-danger: #F09A92;     /* Validation d'erreur, action destructive */
  --lb-color-planned: #AAB0AD;    /* Séance planifiée : neutre */

  /* Dimensions fondamentales */
  --lb-radius-sm: 8px;
  --lb-radius-md: 12px;
  --lb-radius-lg: 16px;
  --lb-radius-pill: 999px;

  --lb-border-width: 1px;
  --lb-focus-width: 2px;

  --lb-touch-min: 44px;
  --lb-control-height: 48px;
  --lb-control-height-lg: 52px;

  --lb-content-max: 1040px;
  --lb-form-max: 680px;
  --lb-sidebar-width: 224px;
  --lb-mobile-nav-height: 72px;

  --lb-transition-fast: 120ms ease;
  --lb-transition-base: 180ms ease;
}
```

### Usages et interdits

| Token | Usage recommandé | À éviter |
|---|---|---|
| `bg` | Fond de toutes les pages | Noir `#000` alterné au hasard |
| `surface` | Carte de mouvement, séance, navigation | Multiplier les niveaux de panneaux |
| `raised` | Champ, carte secondaire, état survolé | En faire la couleur principale |
| `accent` | Action primaire, sélection, charge mise en avant | Tous les titres et pictogrammes |
| `text` | Titres, données, texte principal | Blanc pur systématique |
| `text-muted` | Labels et informations auxiliaires | Données critiques à faible contraste |
| `border` | Délimitation discrète de cartes | Unique indice visuel d'un champ |
| `control-border` | Champs et contrôles dont le contour compte | Toutes les séparations décoratives |

**Contrastes vérifiés (ratios approximatifs)** :
- Ivoire `#F3F0E8` sur fond `#0F1112` : **16,62:1**.
- Gris `#AAB0AD` sur surface `#1B1F20` : **7,54:1**.
- Or `#D4A45A` sur surface `#1B1F20` : **7,33:1**.
- Noir graphite sur or `#D4A45A` : **8,35:1**.
- Contour interactif `#758482` sur surface surélevée `#252A2B` : **3,72:1**.

Vérifier les autres combinaisons réelles au moment de l'implémentation. Une bordure décorative discrète n'est **pas** un contour suffisant pour un contrôle interactif.

## 2. Typographie

Deux familles maximum :

- **Saira Semi Condensed** : titres courts, titres d'exercices, chiffres importants, valeurs en `kg` et pourcentages. Graisses **600 / 700**.
- **Commissioner** : navigation, boutons, labels, formulaires, paragraphes et états vides. Graisses **400 / 500 / 600**.

Polices de repli : `Arial Narrow, Arial, sans-serif` pour les titres ; `Arial, sans-serif` pour le texte. Charger uniquement les graisses utilisées. Aucun package npm de typographie requis ; décider au moment de l'implémentation entre chargement web et hébergement local de fichiers autorisés.

```css
:root {
  --lb-font-display: "Saira Semi Condensed", "Arial Narrow", Arial, sans-serif;
  --lb-font-body: "Commissioner", Arial, sans-serif;

  --lb-text-xs: 12px;      /* Métadonnées, jamais contenu essentiel */
  --lb-text-sm: 14px;      /* Labels, aide, navigation */
  --lb-text-base: 16px;    /* Texte courant, champs, boutons */
  --lb-text-lg: 18px;      /* Titres de carte */
  --lb-text-xl: 24px;      /* Titre de section/écran */
  --lb-text-2xl: 32px;     /* Valeurs majeures, ponctuellement */
  --lb-text-3xl: 36px;     /* Écrans desktop seulement */

  --lb-leading-xs: 16px;
  --lb-leading-sm: 20px;
  --lb-leading-base: 24px;
  --lb-leading-lg: 26px;
  --lb-leading-xl: 30px;
  --lb-leading-2xl: 38px;
  --lb-leading-3xl: 44px;
}
```

| Élément | Famille | Taille / ligne | Graisse |
|---|---|---|---|
| Titre de page mobile | Saira | 24 / 30 px | 700 |
| Titre de page desktop | Saira | 32 / 38 px | 700 |
| Titre d'exercice / séance | Saira | 18 / 26 px | 600 |
| Charge cible majeure | Saira | 32 / 38 px | 700 |
| Valeur intermédiaire | Saira | 24 / 30 px | 600 |
| Texte courant / champ | Commissioner | 16 / 24 px | 400 ou 500 |
| Bouton | Commissioner | 16 / 24 px | 600 |
| Navigation et label | Commissioner | 14 / 20 px | 500 ou 600 |
| Métadonnée facultative | Commissioner | 12 / 16 px | 500 |

- Typographie nette, **sans uppercase généralisé**. Des petites capitales peuvent identifier un repère secondaire court (« CHARGE CIBLE »).
- Toujours indiquer les unités (`kg`, `%`) et les dissocier visuellement du nombre sans réduire leur lisibilité.
- Utiliser `font-variant-numeric: tabular-nums` pour les valeurs alignées, si la police/variante le prend en charge.
- Ne pas bloquer le zoom ou l'agrandissement des textes ; éviter les hauteurs fixes sur les blocs de texte.

## 3. Espacement, surfaces et rythme

Échelle unique 4 px :

```css
:root {
  --lb-space-1: 4px;
  --lb-space-2: 8px;
  --lb-space-3: 12px;
  --lb-space-4: 16px;
  --lb-space-5: 20px;
  --lb-space-6: 24px;
  --lb-space-8: 32px;
  --lb-space-10: 40px;
  --lb-space-12: 48px;
}
```

- **Page mobile** : 16 px de marge horizontale ; 24 px entre sections.
- **Carte** : 16 px de padding ; 12 px entre éléments associés.
- **Formulaire** : 16 px entre champs ; 8 px entre label et champ.
- **Cartes adjacentes** : 12 px entre blocs.
- **Desktop** : marges adaptées, colonne de formulaire limitée à `680px`, espace de travail limité à `1040px`.
- **Surfaces** : fond graphite, cartes anthracite, zones imbriquées `raised`. Maximum deux niveaux de panneaux dans le parcours courant.
- **Rayons** : 12 px pour inputs/boutons, 16 px pour cartes principales, 8 px pour badges.
- **Bordures** : 1 px ; pas de glow, effet verre, bordures dorées continues ou ombre forte. L'élévation provient essentiellement du contraste entre surfaces.
- **Ombres** : absentes par défaut ; légères uniquement pour un élément flottant qui doit passer devant le contenu.

## 4. États transversaux et interactions

| État | Règle |
|---|---|
| Repos | Contraste stable ; action clairement reconnaissable |
| Survol | Changement discret de surface, **jamais nécessaire** à la compréhension |
| Focus clavier | Anneau externe or de **2 px**, écart d'environ **2 px** ; jamais supprimé sans remplacement |
| Appui tactile | Variation brève de fond, pas d'animation complexe |
| Sélectionné | Fond/bordure/indicateur + libellé ; jamais uniquement la couleur |
| Désactivé | Aspect atténué, pas d'action possible, raison compréhensible si utile |
| Chargement | Bloquer les doubles soumissions ; libellé « Enregistrement… » si nécessaire |
| Erreur | Message textuel près du champ + signal visuel ; ne pas se limiter au rouge |
| Succès | Confirmation courte et explicite, sans interrompre le parcours |

Transitions de 120 à 180 ms ; respecter `prefers-reduced-motion: reduce` en supprimant les transitions non indispensables. Éviter animations continues, particules, shimmer décoratif et effets sonores.

## 5. Composants V1

### 5.1 Boutons

| Variante | Style | Utilisation |
|---|---|---|
| `primary` | Fond `accent`, texte `on-accent`, 48–52 px de haut | Nouvelle séance, Enregistrer, Marquer terminée |
| `secondary` | Fond `raised`, texte `text`, contour `control-border` si nécessaire | Ajouter exercice, Modifier |
| `ghost` | Sans fond permanent, texte clair, zone tactile 44 px mini | Retour, options secondaires |
| `danger` | Discret par défaut, texte `danger`, confirmation pour suppression | Supprimer séance/exercice |

- `padding-inline` usuel : 16–20 px ; radius 12 px ; icône de 18–20 px facultative.
- Un **seul CTA primaire dominant par écran ou zone d'action**, sauf exception motivée.
- Sur mobile, CTA d'enregistrement en pleine largeur quand pertinent ; le rendre visible sans masquer les champs.
- Le libellé est explicite (« Enregistrer la séance », « Marquer terminée »), pas « OK » ou « Valider » sans contexte.
- Pas de clic sur un élément qui ressemble à un bouton sans retour d'état ; vrai élément HTML `<button>`.

### 5.2 Champs numériques

Utilisés pour record (1RM), séries, répétitions, intensité et charge.

- Label **visible et persistant** au-dessus du champ ; ne pas utiliser le placeholder comme label.
- Texte du champ 16 px minimum pour éviter le zoom automatique sur certains navigateurs mobiles.
- Hauteur minimale 48 px ; fond `raised`, bordure `control-border`, texte `text`, rayon 12 px.
- Unité visible (`kg`, `%`) à proximité du champ, sans la mélanger à la valeur saisie.
- Clavier mobile numérique adapté (`inputMode` pertinent). Les valeurs décimales en français peuvent être saisies avec **virgule ou point** ; normaliser et valider explicitement.
- Interdire valeurs non numériques ou incohérentes **selon les règles métier validées**, sans ajouter de limites arbitraires.
- Pour les séries/répétitions, préférer des entrées simples et directes plutôt qu'un sélecteur spectaculaire.
- Validation proche du champ ; conserver la saisie en cas d'erreur ; informer si un record manque.
- Afficher la charge calculée avec l'unité et la règle d'arrondi choisie. **Règle à confirmer avec Khaled :** arrondi usuel à 2,5 kg pour les mouvements avec barre ; ne pas l'imposer sans validation.

### 5.3 Carte d'exercice

**Objectif :** lire instantanément le mouvement et les données utiles.

Structure recommandée :
1. Nom de l'exercice (priorité haute, Saira).
2. Séries × répétitions et intensité, alignées dans une ligne ou une grille compacte.
3. **Charge cible (kg)** mise en évidence visuellement ; calcul automatique si 1RM disponible.
4. Actions secondaires « Modifier » et « Supprimer » via contrôles accessibles et identifiables.

Style : `surface`, bordure décorative `border`, rayon 16 px, padding 16 px, espacement interne 12 px.

- Si 1RM absent : afficher **« Record à renseigner »** avec action correspondante, jamais `0 kg` ou charge inventée.
- Ne pas afficher graphiques, tracés biomécaniques ou statistiques au sein de chaque carte.
- Si le même exercice doit apparaître à plusieurs intensités, autoriser plusieurs blocs simples ; pas d'éditeur avancé série par série en V1.
- Toute zone « carte cliquable » doit être accessible au clavier et ne pas masquer des boutons imbriqués.

### 5.4 Carte et bloc de séance

**Carte dans la liste « Séances » :**
- Nom de séance ; date prévue ; état texte + pictogramme.
- Résumé utile : nombre d'exercices (éventuellement séries).
- Action principale « Ouvrir » ; action secondaire de modification pour les séances planifiées.
- Ne pas remplir la carte de métriques décoratives.

**Éditeur de séance :**
- Nom/date en tête ; exercices listés verticalement.
- Bouton « Ajouter un exercice » identifiable.
- Chaque exercice possède ses paramètres simples : séries, répétitions, intensité, charge calculée.
- Les blocs peuvent se replier **si cela sert réellement la lisibilité**, pas au prix d'une interaction supplémentaire systématique.
- Enregistrement explicite ; retour visuel après sauvegarde.
- Pour la V1, éviter drag-and-drop, modèles de programmes, cycles, séances récurrentes et menus multi-niveaux.

**Consultation pendant l'entraînement :**
- Lecture facile à une main ; charge et nombre de répétitions visibles.
- Aucun passage obligatoire par le calculateur séparé.
- Action « Marquer terminée » clairement accessible et confirmée.
- Éviter toute modification accidentelle en manipulant le téléphone à la salle.

## 6. Navigation et architecture de l'interface

### 6.1 Navigation mobile : quatre onglets

**Ordre et libellés figés :**

1. **Séances** — création, préparation, consultation ; **écran initial**.
2. **Records** — affichage et mise à jour des 1RM.
3. **Calculer** — calculateur indépendant depuis un record et un pourcentage.
4. **Historique** — liste et consultation des séances terminées.

- Barre en bas, persistante sur les écrans principaux.
- Icône + libellé toujours visible ; état actif avec or et repère additionnel (fond, trait, etc.).
- Hauteur de contenu cible : 72 px, **plus** `env(safe-area-inset-bottom)` ; zones de touche ≥ 44 × 44 px.
- Ne pas recouvrir le bas des listes/formulaires : réserver une zone de défilement supplémentaire tenant compte de la barre et du safe area.
- Ne pas introduire un cinquième onglet « Accueil » ou « Dashboard ».
- La navigation des vues d'édition/détail utilise un en-tête avec retour clair ; préserver les saisies non enregistrées.

### 6.2 Desktop : barre latérale

À partir de **960 px** :
- Remplacer la barre basse par une **sidebar gauche** d'environ `224px`, affichant les mêmes quatre sections.
- Conserver les mêmes intitulés et états actifs ; logo compact au-dessus de la navigation.
- Zone de contenu centrale `max-width: 1040px` ; formulaires `max-width: 680px`.
- Ne pas étendre les cartes jusqu'aux bords d'un écran très large.
- Pas de navigation desktop différente du parcours mobile ; uniquement un changement de disposition.

### 6.3 Architecture des vues

- `Séances` : liste **planifiée**, avec CTA « Nouvelle séance ».
- `Séance — détail/édition` : informations de séance et blocs d'exercices.
- `Records` : records par mouvement ; modification directe, sans sous-navigation inutile.
- `Calculer` : sélectionner mouvement/record et intensité ; afficher immédiatement les kg.
- `Historique` : séances **terminées**, classées par date, avec consultation du détail.

Pas de page marketing d'entrée, pas d'authentification, pas de coaching multi-utilisateurs dans le MVP.

## 7. États métier : « Planifiée » et « Terminée »

Seulement **deux statuts de séance** dans la V1 :

| État | Présentation | Actions principales |
|---|---|---|
| **Planifiée** | Badge neutre, texte « Planifiée », icône calendrier/horloge | Ouvrir, Modifier, Supprimer, Marquer terminée |
| **Terminée** | Badge sobre avec icône coche + texte « Terminée », teinte `success` ponctuelle | Consulter dans l'Historique |

**Comportements à conserver :**
- La création d'une séance produit une séance **planifiée**.
- Marquer terminée nécessite une **action explicite** ; aucune transition automatique par date.
- Après confirmation, la séance quitte la liste des planifiées et apparaît dans l'historique.
- Un écran terminé reste lisible, mais évite les champs modifiables par inadvertance. Une éventuelle correction post-séance doit être une action délibérée ; ne pas construire un workflow de réouverture complexe sans validation.
- Une suppression demande une confirmation précisant la séance concernée.
- Les charges affichées pour une séance terminée doivent rester fidèles à celles enregistrées : une modification ultérieure du 1RM ne doit **pas recalculer silencieusement l'historique**.
- La distinction des états ne repose jamais uniquement sur la couleur.

Les badges restent secondaires par rapport au nom, aux exercices et aux charges. Le doré n'est **pas** un marqueur de statut « terminée ».

## 8. États vides, erreurs et retours utilisateur

- **Aucune séance planifiée :** « Aucune séance planifiée » + « Nouvelle séance ».
- **Aucun record :** message direct + « Ajouter un record » ; ne pas multiplier les mentions « non renseigné » dans chaque carte.
- **Aucun historique :** « Aucune séance terminée pour le moment » ; sans statistiques fictives.
- **Record manquant lors d'un calcul :** expliquer le blocage et proposer de renseigner le 1RM.
- **Erreur de saisie :** message clair adjacent au champ, sans effacement du contenu.
- **Succès d'enregistrement :** retour textuel bref ; éviter les modales de succès répétitives.
- **Erreur de persistance locale :** signaler l'échec ; **ne jamais annoncer une sauvegarde non réalisée**.

La version de démonstration doit employer des données fictives explicitement distinguées des données personnelles de Khaled.

## 9. Responsive, accessibilité et robustesse

**Largeurs de référence à vérifier manuellement :** `320`, `375`, `390`, `430`, `768`, `960` et `1440px`. Il ne s'agit pas de tous créer en breakpoints CSS.

- **Approche CSS :** styles mobile par défaut ; `@media (min-width: 960px)` pour sidebar et mise en page desktop. Introduire un breakpoint additionnel seulement si un composant l'exige réellement.
- **Flux :** priorité à une colonne sur mobile ; groupes de données courts autorisés en 2–3 colonnes si aucun libellé essentiel ne tronque.
- **Écran et zoom :** pas de défilement horizontal à 320 px ; rester exploitable à 200 % de zoom ; éviter les dimensions figées des contenus textuels.
- **Cibles tactiles :** minimum cible 44 × 44 px, avec espacement contre les erreurs de manipulation.
- **Contraste :** viser WCAG AA : ≥ **4,5:1** pour le texte normal, ≥ **3:1** pour le grand texte et les éléments non textuels essentiels. Les couleurs ci-dessus ne dispensent pas de vérifier chaque combinaison.
- **Clavier :** ordre logique, focus visible, éléments sémantiques (`button`, `nav`, `main`, `label`, etc.), labels associés et messages d'erreur reliés aux champs.
- **Icônes :** toujours accompagnées de texte pour la navigation ; une icône seule nécessite un nom accessible.
- **Animations :** respecter les préférences de réduction des mouvements.
- **LocalStorage :** données locales à l'appareil/navigateur, sans synchronisation garantie ; ne jamais donner l'impression d'une sauvegarde cloud.
- **Navigation avec clavier virtuel :** s'assurer que champs et CTA restent accessibles lorsque le clavier mobile s'affiche.

## 10. Règles de réalisation React + TypeScript + CSS

Ce document guide Codex **après validation**, sans imposer l'ajout d'une bibliothèque.

- Déclarer les variables dans **un fichier CSS de tokens** (nom conseillé : `src/styles/tokens.css`) ; éviter les couleurs HEX dupliquées dans les composants.
- Utiliser des composants React réutilisables pour `Button`, `NumericField`, `ExerciseCard`, `SessionCard`, `StatusBadge`, `MobileNav`, `SidebarNav` **seulement lorsque leur réutilisation est réelle**.
- Préférer des props typées simples (`variant`, `status`, `disabled`), sans construire une bibliothèque UI générique.
- Garder les calculs de charges, la validation et l'accès à `localStorage` indépendants des styles CSS.
- Représenter le statut par des valeurs métier stables telles que `planned` et `completed`; les labels français ne servent pas d'identifiants de stockage.
- Utiliser CSS natif avec variables, `flex`, `grid`, media queries et pseudo-classes (`:focus-visible`, `:disabled`). **Aucune dépendance UI supplémentaire** pour la V1.
- Garder de vraies balises sémantiques et une navigation utilisable sans souris.
- Éviter les valeurs magiques, les styles inline dupliqués et les mises en page desktop construites avant le mobile.
- La livraison devra être vérifiée sur téléphone réel, pas uniquement sur simulateur.

## 11. Hors périmètre de cette V1

Ne pas intégrer au motif que les applications de référence le proposent :

- Connexion, comptes, multi-utilisateurs, coaching, messagerie.
- Bibliothèque massive d'exercices ou programmes multiphases.
- Synchronisation cloud, backend supplémentaire, analytics.
- Graphiques biomécaniques, conseils IA, notifications.
- Édition de chaque répétition, drag-and-drop complexe ou planification récurrente.
- Mode clair, thème personnalisable, animations avancées.
- Refonte marketing ou écran d'accueil promotionnel.

## 12. Points à confirmer avant transmission à Codex

1. **Arrondi des charges :** confirmer avec Khaled le pas de 2,5 kg proposé et l'existence éventuelle d'exceptions.
2. **Modification d'une séance terminée :** confirmer si consultation seule suffit au MVP ou si une correction explicite est nécessaire.
3. **Typographie :** valider visuellement Saira Semi Condensed + Commissioner sur un écran mobile réel et définir leur mode de chargement sans ajout de package.
4. **Comportement de la sauvegarde :** vérifier que le mécanisme actuel de persistance couvre effectivement le cycle planifiée → terminée et gère les erreurs.

**Critère d'acceptation de l'identité :** un utilisateur ouvre LiftBoard, voit immédiatement ses séances, identifie son action principale en moins de quelques secondes, lit sans effort ses charges en salle et retrouve ses séances terminées. L'application évoque un instrument de performance, pas une vitrine fitness.
