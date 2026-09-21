# Voltra Industries

Jeu de gestion coopératif **pour deux joueurs, en temps réel, dans le navigateur**.
Les deux joueurs dirigent la **même** usine de vélos électriques, chacun sur son
écran, avec des responsabilités et des informations différentes.

```
   ─── AMONT (Joueur 1) ─────────────┐   ┌──────── AVAL (Joueur 2) ────────────
   Fournisseur → Dépôt matières      │   │   Assemblage → Qualité → Expédition
        ↓                         ┌──┴───┴──┐        ↑              ↓
   Atelier Cadres ───────────────►│ TAMPON  │────────┘         Contrats clients
   Atelier Batteries ────────────►│ partagé │                  + ventes spot
   Atelier Motorisation ─────────►│         │
                                  └─────────┘
```

---

## Démarrer

```bash
npm install
npm start
```

Puis ouvrir <http://localhost:3000>. Un joueur crée la partie et obtient un
**code à 4 caractères** ainsi qu'un lien de partage ; l'autre le rejoint. La
partie démarre quand les deux directions se déclarent prêtes.

Variables d'environnement utiles :

| Variable  | Défaut | Rôle |
|-----------|--------|------|
| `PORT`    | `3000` | Port d'écoute |
| `TICK_MS` | `2500` | Durée réelle d'un jour de jeu. `TICK_MS=120` déroule une partie complète en quelques secondes, pratique pour tester la fin de partie. |

---

## Ce qui rend la coopération nécessaire

Trois mécaniques s'appuient l'une sur l'autre. Aucune ne fonctionne seule.

### 1. Territoires séparés, flux commun

Le campus est coupé en deux. L'amont fabrique les composants, l'aval les
assemble et les vend. Les deux camps sont reliés par un **tampon central
saturable** :

- si l'amont produit trop vite, le tampon sature et **les ateliers amont se
  bloquent eux-mêmes** ;
- s'il produit trop lentement, la ligne d'assemblage **tourne à vide** et les
  contrats de l'aval partent en retard.

Le débit doit être négocié. Le tampon est visible des deux côtés, sur la carte
comme dans le panneau latéral : c'est l'objet autour duquel la conversation
s'organise.

### 2. Information asymétrique — réelle, pas cosmétique

| La Direction Industrielle voit seule | La Direction Commerciale voit seule |
|---|---|
| Stocks de matières et leur couverture en jours | Demande du marché et prix du concurrent |
| Qualité du stock, fournisseur actif, délais | Réputation et offres de contrat |
| Usure de ses machines, cadences réelles | Marge de chaque contrat, taux de défaut |

Sur les bâtiments de l'autre, on ne lit qu'un état grossier — *nominal*,
*dégradé*, *arrêté*. **On voit qu'il y a un problème, jamais sa cause.**

Ce filtrage est fait **côté serveur** (`server/game/visibility.js`) : les
données absentes de la vue d'un joueur ne transitent jamais sur son socket.
Inspecter le trafic réseau ne contourne rien.

Un bouton **« Partager »** publie une donnée privée, chiffrée et horodatée,
dans le journal commun des deux joueurs. C'est le seul canal in-game pour
transmettre un nombre exact.

### 3. Décisions à double signature

- Toute dépense au-dessus de **15 000 €** devient une *proposition* : elle
  s'affiche chez les deux, l'initiateur a déjà signé, l'autre a 60 secondes
  pour contresigner.
- **Signer un contrat client engage l'outil industriel** : la contre-signature
  est requise quel que soit le montant. C'est le point de friction central —
  l'aval connaît la marge et l'échéance, l'amont sait si l'usine peut suivre.
- Les **crises** (toutes les ~11 jours) doivent être tranchées à deux en
  45 secondes. Sans accord, l'option par défaut — toujours la plus mauvaise —
  s'applique d'office.

---

## Les systèmes, et leur logique

Chaque mécanique repose sur une formule que le jeu affiche au joueur, dans
l'inspecteur de bâtiment ou dans les panneaux.

**Capacité d'un poste de travail**

```
capacité = cadence de base
         × multiplicateur de niveau     (×1 · ×1,6 · ×2,4)
         × taux d'effectif              (affectés / nominal, plafonné à 1,25)
         × facteur d'usure              (1 − usure × 0,4)
         × facteur de moral             (0,7 + 0,4 × moral)
```

Conséquence à connaître : **améliorer un atelier augmente aussi son effectif
nominal**. Passer au niveau 2 sans recruter ne donne aucun gain de cadence.

**Taux de défaut au contrôle qualité** — la facture différée de trois décisions
prises ailleurs, souvent par l'autre joueur :

```
défauts = 3 %
        + usure de la ligne d'assemblage × 10 %
        + déficit de moral sous 0,70     × 25 %
        + (1 − qualité des matières)     × 14 %
```

**Demande spot**

```
demande = 16 × saison × campagne × réputation × effet prix
effet prix = (prix concurrent / votre prix) ^ 1,9
```

Baisser le prix est le levier de déstockage de l'aval.

**Usure et pannes** — un poste s'use proportionnellement à son utilisation. Au
delà de 55 % d'usure, le risque de panne quotidien vaut `(usure − 0,55) × 0,13`.
Une panne immobilise le poste jusqu'à réparation.

**Fin de partie** — 60 jours. Objectif : porter la **valeur d'entreprise** à
500 000 €. Faillite si la trésorerie reste sous −20 000 € pendant 3 jours.

---

## Architecture

**Serveur autoritaire, client muet.** Le client n'envoie que des intentions ;
toute la simulation tourne dans Node. Aucune règle de jeu ne vit côté
navigateur — une règle dupliquée finirait fausse.

```
server/
  index.js              HTTP + Socket.IO — routage uniquement, zéro règle
  rooms.js              Registre des parties, codes, sièges, reconnexion
  game/
    constants.js        TOUT l'équilibrage, en un seul fichier
    layout.js           Plan du campus, trajets des véhicules
    state.js            Forme de l'état, formules de lecture
    engine.js           Boucle de tick : l'ordre des systèmes fait le jeu
    actions.js          Porte d'entrée unique des intentions joueur
    visibility.js       ★ Projection de l'état selon le rôle
    systems/            Un fichier par mécanique (13 systèmes)

public/
  index.html · css/style.css
  js/
    main.js             Câblage réseau ↔ scène ↔ interface
    net.js  store       Couche socket
    scene/
      iso.js            Projection isométrique et caméra
      sprites.js        Dessin procédural — aucun asset externe
      agents.js         Véhicules, en nombre proportionnel au débit simulé
      effects.js        Fumées
      renderer.js       Boucle de rendu, tri en profondeur, jour/nuit
    ui/                 dom · lobby · hud · panels · overlays · feed

tools/
  simulate.js           Simulateur sans interface, pour l'équilibrage
```

### La partie graphique

La scène est rendue en **Canvas 2D**, en isométrique, **entièrement dessinée en
code** : pas une seule image à charger, donc la taille et le niveau de détail
d'un bâtiment sont de simples paramètres.

Ce qui bouge à l'écran n'est pas décoratif :

- le **nombre de véhicules** sur chaque route est proportionnel au débit
  réellement simulé — un atelier bloqué, et sa route se vide ;
- les **caisses empilées dans le tampon** reflètent son remplissage réel ;
- les **silos du dépôt** montrent les stocks de matières… mais seulement sur
  l'écran de la Direction Industrielle ;
- un atelier **ne fume que s'il produit** ;
- une panne cercle le bâtiment de rouge, un chantier l'entoure d'échafaudages
  et d'une grue.

---

## Équilibrage

`tools/simulate.js` joue des parties complètes sans interface, avec deux
« joueurs » automatiques, et sort un compte de résultat consolidé.

```bash
node tools/simulate.js 200 --profil=prudent         # investit tard, pas de coordination
node tools/simulate.js 200 --profil=prudent-garde   # idem + coordination chantier/contrat
node tools/simulate.js 200 --profil=coordonne       # investit franchement + coordination
node tools/simulate.js 200 --profil=offensif        # emprunte tôt, sur-engage
node tools/simulate.js 1   --verbose                # trace jour par jour
```

### Ce que le simulateur a servi à vérifier

Les profils `prudent` et `prudent-garde` sont **rigoureusement identiques à un
paramètre près** : le second refuse de lancer un chantier quand une échéance de
contrat tombe dans moins de 9 jours. Rien d'autre ne les distingue — même
politique d'achat, même seuil d'investissement, mêmes contrats acceptés.

Sur 200 parties chacun :

| | `prudent` | `prudent-garde` |
|---|---|---|
| Valeur médiane | 401 000 € | **439 000 €** |
| Quartiles (25 · 75) | 323 000 · 453 000 € | 392 000 · 481 000 € |
| Faillites | 72 / 200 (36 %) | **35 / 200 (18 %)** |
| Objectif atteint | 7 / 200 (4 %) | **31 / 200 (16 %)** |

Cette unique règle vaut **+38 000 €** de valeur médiane, **divise par deux** le
risque de faillite et **quadruple** le taux de réussite.

C'est la validation chiffrée du parti pris de conception : la décision la plus
rentable du jeu est celle qu'**aucun des deux joueurs ne peut prendre seul**,
puisque l'aval connaît l'échéance du contrat et l'amont la durée du chantier.

À titre de repère, le profil `offensif` — qui emprunte au 3ᵉ jour et engage
95 % de sa cadence — fait faillite dans **133 parties sur 150**. Le levier
financier sans coordination industrielle ne pardonne pas.

---

## Étendre le jeu

Le découpage a été pensé pour qu'on ajoute des systèmes sans toucher au reste.

**Ajouter un système** (R&D, bourse, concurrence active, syndicats…)

1. créer `server/game/systems/monsysteme.js` exportant `tick(state)` ;
2. l'insérer au bon endroit du tableau `SYSTEMS` dans `engine.js` — l'ordre
   suit la chaîne physique et compte ;
3. ajouter ses réglages dans `constants.js` ;
4. exposer ses données dans `visibility.js`, en choisissant **qui** les voit.

**Ajouter une action joueur**

1. un `case` dans le `switch` de `actions.js` (validation + appartenance de rôle) ;
2. si elle coûte cher ou engage l'entreprise, la passer par `gated()` : elle
   devient automatiquement une proposition à contresigner ;
3. son exécuteur dans la table `EXECUTORS` du même fichier.

**Ajouter une crise** — une entrée dans le tableau `CRISES` de
`systems/events.js`, avec ses options et une fonction `apply(state, option)`.
Seule la partie descriptive part sur le réseau.

**Ajouter un bâtiment**

1. sa définition dans `BUILDINGS` (`constants.js`) ;
2. son emprise dans `PLOTS` (`layout.js`), au nord ou au sud de l'artère ;
3. si de la matière y circule, un flux dans `FLOWS` — les véhicules suivront
   automatiquement.

---

## Pile technique

Node.js ≥ 18 · Express · Socket.IO · Canvas 2D · modules ES natifs côté client.
**Aucune étape de build, aucun framework front, aucun asset binaire.**
