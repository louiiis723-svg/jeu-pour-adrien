/**
 * constants.js — Tous les réglages d'équilibrage du jeu, en un seul endroit.
 *
 * Règle du projet : AUCUN nombre magique ailleurs dans les systèmes.
 * Pour rééquilibrer le jeu, on ne touche qu'à ce fichier.
 */

// ─────────────────────────────────────────────────────────────
// Rythme
// ─────────────────────────────────────────────────────────────
// 1 « jour » de jeu = 2,5 s réelles. TICK_MS=100 permet de dérouler une
// partie entière en quelques secondes pour tester la fin de partie.
export const TICK_MS = Number(process.env.TICK_MS) || 2500;
export const TARGET_DAYS = 60;      // durée d'une partie
export const OBJECTIVE_VALUE = 500000; // valeur d'entreprise visée (€)

// ─────────────────────────────────────────────────────────────
// Finance
// ─────────────────────────────────────────────────────────────
export const START_CASH = 120000;
export const WAGE_PER_WORKER = 130;     // € / ouvrier / jour
export const UPKEEP_PER_LEVEL = 180;    // € / bâtiment / niveau / jour
export const BANKRUPT_CASH = -20000;    // seuil de découvert
export const BANKRUPT_GRACE_DAYS = 3;   // jours consécutifs sous le seuil avant faillite

export const LOAN_TERM_DAYS = 30;
export const LOAN_TOTAL_RATE = 1.11;    // on rembourse 111 % du capital sur la durée
export const LOAN_MAX = 150000;

// ─────────────────────────────────────────────────────────────
// Co-décision (mécanique B)
// ─────────────────────────────────────────────────────────────
export const COSIGN_THRESHOLD = 15000;  // au-delà, la dépense doit être co-signée
export const PROPOSAL_TTL_MS = 60000;   // une proposition expire au bout de 60 s
export const CRISIS_TTL_MS = 45000;     // une crise doit être tranchée en 45 s
export const CRISIS_MIN_DAY = 6;        // pas de crise avant ce jour
export const CRISIS_INTERVAL_DAYS = 11; // écart moyen entre deux crises

// ─────────────────────────────────────────────────────────────
// Matières premières
// ─────────────────────────────────────────────────────────────
export const MATERIALS = {
  alu:   { label: 'Aluminium',          unit: 'kg', basePrice: 12 },
  cells: { label: 'Cellules batterie',  unit: 'u',  basePrice: 26 },
  elec:  { label: 'Modules électro.',   unit: 'u',  basePrice: 55 },
};

export const DEPOT_CAPACITY_PER_LEVEL = 4200; // unités de matière, tous types confondus

// ─────────────────────────────────────────────────────────────
// Fournisseurs — le choix est un arbitrage prix / qualité / délai.
// La qualité se paie plus tard, en taux de défaut au contrôle qualité.
// ─────────────────────────────────────────────────────────────
export const SUPPLIERS = [
  {
    id: 'alpha', name: 'Alpha Métal', priceMult: 0.86, quality: 0.72, leadTime: 4,
    note: 'Le moins cher, mais 4 jours de délai et une qualité irrégulière.',
  },
  {
    id: 'sorec', name: 'Sorec Industrie', priceMult: 1.0, quality: 0.88, leadTime: 2,
    note: 'Le compromis standard du secteur.',
  },
  {
    id: 'kaizen', name: 'Kaizen Supply', priceMult: 1.19, quality: 0.97, leadTime: 1,
    note: 'Cher, mais livré le lendemain et quasiment sans défaut.',
  },
];

// ─────────────────────────────────────────────────────────────
// Recettes — ce que consomme chaque composant, puis le vélo fini
// ─────────────────────────────────────────────────────────────
export const RECIPES = {
  frames:    { alu: 6 },
  batteries: { cells: 12 },
  motors:    { elec: 2, alu: 3 },
};

/** Un vélo = 1 cadre + 1 batterie + 1 moteur, prélevés dans le tampon. */
export const BIKE_RECIPE = { frames: 1, batteries: 1, motors: 1 };

/**
 * Coût matière d'un composant, dérivé de sa recette (prix fournisseur de
 * référence, hors multiplicateur). Sert à valoriser les stocks et à afficher
 * au joueur d'où vient son prix de revient.
 */
export const PART_MATERIAL_COST = Object.fromEntries(
  Object.entries(RECIPES).map(([part, recipe]) => [
    part,
    Object.entries(recipe).reduce((sum, [mat, qty]) => sum + qty * MATERIALS[mat].basePrice, 0),
  ]),
);

/** Coût matière d'un vélo complet. */
export const BIKE_MATERIAL_COST = Object.entries(BIKE_RECIPE).reduce(
  (sum, [part, qty]) => sum + qty * PART_MATERIAL_COST[part], 0,
);

// ─────────────────────────────────────────────────────────────
// Bâtiments
//
// owner : 'amont' (J1) | 'aval' (J2) | 'shared' (les deux, co-signature requise)
// rate  : production journalière à niveau 1, effectif nominal, usure nulle
// ─────────────────────────────────────────────────────────────
export const BUILDINGS = {
  depot: {
    label: 'Dépôt matières', owner: 'amont', kind: 'storage',
    baseStaff: 2, rate: 0,
    desc: 'Stocke les matières premières livrées par le fournisseur.',
  },
  frames: {
    label: 'Atelier Cadres', owner: 'amont', kind: 'workshop', output: 'frames',
    baseStaff: 4, rate: 30,
    desc: 'Découpe et soude les cadres aluminium.',
  },
  batteries: {
    label: 'Atelier Batteries', owner: 'amont', kind: 'workshop', output: 'batteries',
    baseStaff: 5, rate: 24,
    desc: 'Assemble les packs de cellules. Le poste le plus lent de l’amont.',
  },
  motors: {
    label: 'Atelier Motorisation', owner: 'amont', kind: 'workshop', output: 'motors',
    baseStaff: 4, rate: 28,
    desc: 'Monte les moteurs-moyeux et leur électronique.',
  },
  buffer: {
    label: 'Tampon central', owner: 'shared', kind: 'buffer',
    baseStaff: 0, rate: 0,
    desc: 'Stock frontière entre l’amont et l’aval. S’il sature, les ateliers se bloquent.',
  },
  assembly: {
    label: 'Ligne d’assemblage', owner: 'aval', kind: 'workshop', output: 'bikesPending',
    baseStaff: 6, rate: 26,
    desc: 'Consomme 1 cadre + 1 batterie + 1 moteur pour produire un vélo à contrôler.',
  },
  quality: {
    label: 'Contrôle qualité', owner: 'aval', kind: 'workshop', output: 'bikes',
    baseStaff: 3, rate: 40,
    desc: 'Trie les vélos assemblés. Les rebuts sont partiellement revalorisés.',
  },
  shipping: {
    label: 'Quai d’expédition', owner: 'aval', kind: 'logistics',
    baseStaff: 3, rate: 45,
    desc: 'Limite le nombre de vélos expédiables par jour.',
  },
  hq: {
    label: 'Siège', owner: 'shared', kind: 'office',
    baseStaff: 0, rate: 0,
    desc: 'Le centre de décision. Ne produit rien, mais c’est de là que tout part.',
  },
};

/** Bâtiments améliorables et leur grille de coûts. */
export const MAX_LEVEL = 3;
export const UPGRADE_COST = { 2: 45000, 3: 92000 };   // coût pour ATTEINDRE ce niveau
export const UPGRADE_DAYS = { 2: 4, 3: 6 };
export const LEVEL_MULT = { 1: 1, 2: 1.6, 3: 2.4 };   // multiplicateur de capacité

/** Valorisation d'un bâtiment neuf de niveau 1, pour le calcul de valeur d'entreprise. */
export const BUILDING_BASE_VALUE = 12000;
/** Part du coût d'amélioration qui se retrouve à l'actif. */
export const UPGRADE_VALUE_RECOVERY = 0.7;

export const BUFFER_CAPACITY_PER_LEVEL = 110;  // par type de composant

// ─────────────────────────────────────────────────────────────
// Usure, pannes, entretien
// ─────────────────────────────────────────────────────────────
export const WEAR_PER_DAY = 0.014;        // usure à pleine charge
export const WEAR_CAPACITY_PENALTY = 0.4; // à 100 % d'usure, on perd 40 % de capacité
export const BREAKDOWN_WEAR_FLOOR = 0.55; // en dessous, aucun risque de panne
export const BREAKDOWN_SLOPE = 0.13;      // proba/jour = (usure - plancher) * pente

export const SERVICE_COST = 5500;         // révision préventive
export const SERVICE_DAYS = 1;
export const SERVICE_WEAR_LEFT = 0.05;

export const REPAIR_COST = 6500;          // réparation après panne
export const REPAIR_DAYS = 2;

// ─────────────────────────────────────────────────────────────
// Ressources humaines
// ─────────────────────────────────────────────────────────────
export const HIRE_COST = 2200;            // frais de recrutement, par personne
export const FIRE_COST = 3400;            // indemnité de départ, par personne
export const START_STAFF = { amont: 15, aval: 12 };

export const MORALE_START = 0.75;
export const MORALE_MIN = 0.2;
export const MORALE_COMFORT_LOAD = 0.85;  // au-delà, les équipes s'épuisent
export const MORALE_GAIN = 0.006;
export const MORALE_LOSS = 0.009;
export const MORALE_DEBT_LOSS = 0.012;    // pénalité si la trésorerie est négative
export const BONUS_COST_PER_WORKER = 900;
export const BONUS_MORALE = 0.16;

/** Cadence = ce facteur, appliqué au moral. Moral 0,75 → cadence 1,00. */
export const moraleToPace = (m) => 0.7 + 0.4 * m;

// ─────────────────────────────────────────────────────────────
// Qualité
// ─────────────────────────────────────────────────────────────
export const DEFECT_BASE = 0.03;
export const DEFECT_FROM_WEAR = 0.10;      // × usure de la ligne d'assemblage
export const DEFECT_FROM_MORALE = 0.25;    // × déficit de moral sous 0,7
export const DEFECT_FROM_SUPPLIER = 0.14;  // × (1 - qualité fournisseur)
export const SCRAP_RECOVERY = 0.3;         // part de la valeur matière récupérée

// ─────────────────────────────────────────────────────────────
// Marché et ventes
// ─────────────────────────────────────────────────────────────
export const BIKE_REFERENCE_PRICE = 1200;  // prix de référence du marché
export const START_LIST_PRICE = 1200;
export const PRICE_MIN = 700;
export const PRICE_MAX = 2200;

export const DEMAND_BASE = 16;             // ventes spot/jour au prix de référence
export const DEMAND_SEASON_AMP = 0.35;     // amplitude de la saisonnalité
export const DEMAND_SEASON_PERIOD = 40;    // en jours
export const DEMAND_NOISE = 0.12;
export const DEMAND_PRICE_ELASTICITY = 1.9; // sensibilité au prix face au concurrent

export const REPUTATION_START = 0.6;
export const REPUTATION_ON_TIME = 0.03;
export const REPUTATION_LATE = -0.09;
export const REPUTATION_DECAY = 0.002;     // retour lent vers la moyenne

export const CAMPAIGN_COST = 14000;
export const CAMPAIGN_DAYS = 8;
export const CAMPAIGN_DEMAND_BOOST = 0.35;
export const CAMPAIGN_REPUTATION = 0.05;

// Contrats clients
export const CONTRACT_INTERVAL_DAYS = 5;   // un nouveau contrat proposé tous les ~5 jours
export const CONTRACT_OFFER_TTL = 6;       // jours avant qu'une offre disparaisse
export const CONTRACT_MAX_OPEN = 3;        // offres simultanées sur le bureau de J2

export const CLIENT_NAMES = [
  'Vélocité Lyon', 'Cyclopolis', 'Groupe Mobira', 'Urbik Distribution',
  'La Roue Libre', 'Nordcycle', 'Atelier Kerguelen', 'Pédalo Express',
  'Métropole de Nantes', 'Decathlon Pro', 'Flotte Verte SA', 'Kilomètre Zéro',
];
