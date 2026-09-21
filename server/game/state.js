/**
 * state.js — Forme de l'état de partie et helpers de lecture.
 *
 * Un seul objet d'état par room, détenu par le serveur. Les clients n'en
 * reçoivent qu'une projection (voir visibility.js) et ne le mutent jamais
 * directement : ils envoient des actions, le serveur décide.
 */

import * as C from './constants.js';
import { PLOTS } from './layout.js';

let seq = 0;
export const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export function createInitialState() {
  const buildings = {};
  for (const [id, def] of Object.entries(C.BUILDINGS)) {
    buildings[id] = {
      id,
      level: 1,
      staff: def.baseStaff,
      wear: 0,
      active: true,
      broken: false,
      /** Chantier en cours : { kind: 'upgrade'|'service'|'repair', daysLeft, toLevel? } */
      work: null,
      /** Rempli à chaque tick par les systèmes, pour l'affichage et le rendu. */
      lastOutput: 0,
      /** Pourquoi le poste n'a pas tourné à plein : 'materials' | 'bufferFull' | 'parts' | null */
      bottleneck: null,
      load: 0, // 0..1, taux d'utilisation du jour
    };
  }

  return {
    day: 1,
    phase: 'running',        // 'running' | 'paused' | 'over'
    over: null,

    // ── Finance ──────────────────────────────────────────────
    cash: C.START_CASH,
    loans: [],
    negativeDays: 0,

    // ── Stocks ───────────────────────────────────────────────
    materials: { alu: 520, cells: 640, elec: 190 },
    /** Qualité moyenne pondérée des matières en stock (0..1). */
    matQuality: 0.88,
    buffer: { frames: 20, batteries: 18, motors: 20 },
    bikesPending: 0,
    bikes: 8,

    // ── Industrie ────────────────────────────────────────────
    buildings,
    supplierId: 'sorec',
    deliveries: [],          // livraisons fournisseur en transit

    // ── RH ───────────────────────────────────────────────────
    staff: { amont: C.START_STAFF.amont, aval: C.START_STAFF.aval },
    morale: { amont: C.MORALE_START, aval: C.MORALE_START },

    // ── Marché ───────────────────────────────────────────────
    market: {
      demandIndex: 1,
      competitorPrice: C.BIKE_REFERENCE_PRICE,
      listPrice: C.START_LIST_PRICE,
      reputation: C.REPUTATION_START,
      campaignDaysLeft: 0,
    },
    offers: [],              // contrats proposés, visibles de J2 seul
    orders: [],              // contrats signés, visibles des deux
    nextContractDay: 3,
    nextCrisisDay: C.CRISIS_MIN_DAY,

    // ── Co-décision ──────────────────────────────────────────
    proposals: [],
    crisis: null,

    // ── Suivi ────────────────────────────────────────────────
    stats: {
      produced: 0, shipped: 0, scrapped: 0,
      revenue: 0, costs: 0,
      contractsDone: 0, contractsFailed: 0,
      spotSold: 0,
      /** Ventilation analytique, alimentée par spend() / earn(). */
      charges: {},
      produits: {},
    },
    history: [],
    /** Événements du tick courant, vidés après diffusion. */
    tickLog: [],
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers de lecture
// ─────────────────────────────────────────────────────────────

/** Fournisseur actuellement sélectionné. */
export const supplierOf = (s) => C.SUPPLIERS.find((x) => x.id === s.supplierId);

/** Camp propriétaire d'un bâtiment : 'amont' | 'aval' | 'shared'. */
export const ownerOf = (id) => C.BUILDINGS[id].owner;

/** Ouvriers assignés à une division. */
export function assignedStaff(s, division) {
  return Object.entries(s.buildings)
    .filter(([id]) => ownerOf(id) === division)
    .reduce((n, [, b]) => n + b.staff, 0);
}

/** Ouvriers embauchés mais non affectés (payés quand même). */
export function idleStaff(s, division) {
  return Math.max(0, s.staff[division] - assignedStaff(s, division));
}

/** Capacité du tampon, par type de composant. */
export const bufferCapacity = (s) =>
  Math.round(C.BUFFER_CAPACITY_PER_LEVEL * C.LEVEL_MULT[s.buildings.buffer.level]);

/** Capacité de stockage du dépôt matières, toutes matières confondues. */
export const depotCapacity = (s) =>
  Math.round(C.DEPOT_CAPACITY_PER_LEVEL * C.LEVEL_MULT[s.buildings.depot.level]);

export const materialsTotal = (s) =>
  s.materials.alu + s.materials.cells + s.materials.elec;

/**
 * Capacité journalière effective d'un poste de travail.
 * C'est LA formule que le joueur doit pouvoir s'expliquer :
 *
 *   capacité = cadence de base
 *            × multiplicateur de niveau
 *            × taux d'effectif (assignés / nominal, plafonné à 1,25)
 *            × facteur d'usure
 *            × facteur de moral
 *
 * Un poste arrêté, en panne ou en chantier produit zéro.
 */
export function effectiveCapacity(s, id) {
  const def = C.BUILDINGS[id];
  const b = s.buildings[id];
  if (!def.rate) return 0;
  if (!b.active || b.broken || b.work) return 0;

  const levelMult = C.LEVEL_MULT[b.level];
  const nominal = def.baseStaff * levelMult;
  const staffRatio = nominal > 0 ? Math.min(1.25, b.staff / nominal) : 1;
  const wearFactor = 1 - b.wear * C.WEAR_CAPACITY_PENALTY;
  const division = def.owner === 'aval' ? 'aval' : 'amont';
  const paceFactor = C.moraleToPace(s.morale[division]);

  return Math.max(0, def.rate * levelMult * staffRatio * wearFactor * paceFactor);
}

/** Décomposition lisible de la capacité, pour l'infobulle côté joueur. */
export function capacityBreakdown(s, id) {
  const def = C.BUILDINGS[id];
  const b = s.buildings[id];
  const levelMult = C.LEVEL_MULT[b.level];
  const nominal = def.baseStaff * levelMult;
  const division = def.owner === 'aval' ? 'aval' : 'amont';
  return {
    base: def.rate,
    levelMult,
    nominalStaff: Math.round(nominal),
    staffRatio: nominal > 0 ? Math.min(1.25, b.staff / nominal) : 1,
    wearFactor: 1 - b.wear * C.WEAR_CAPACITY_PENALTY,
    paceFactor: C.moraleToPace(s.morale[division]),
    total: effectiveCapacity(s, id),
  };
}

/** Valeur d'entreprise : c'est l'objectif de la partie. */
export function companyValue(s) {
  const matValue =
    s.materials.alu * C.MATERIALS.alu.basePrice +
    s.materials.cells * C.MATERIALS.cells.basePrice +
    s.materials.elec * C.MATERIALS.elec.basePrice;

  const partValue = Object.entries(s.buffer).reduce(
    (sum, [part, qty]) => sum + qty * C.PART_MATERIAL_COST[part], 0,
  );

  const bikeValue = (s.bikes + s.bikesPending * 0.7) * s.market.listPrice * 0.65;

  // Les bâtiments sont valorisés à 100 % : sans quoi améliorer une ligne
  // détruirait de la valeur comptable, ce qui punirait la boucle de jeu.
  const assets = Object.entries(s.buildings).reduce((sum, [id, b]) => {
    if (!PLOTS[id]) return sum;
    let v = C.BUILDING_BASE_VALUE * C.LEVEL_MULT[b.level];
    if (b.level >= 2) v += C.UPGRADE_COST[2] * C.UPGRADE_VALUE_RECOVERY;
    if (b.level >= 3) v += C.UPGRADE_COST[3] * C.UPGRADE_VALUE_RECOVERY;
    return sum + v * (1 - b.wear * 0.3);
  }, 0);

  const debt = s.loans.reduce((n, l) => n + l.dailyPayment * l.remainingDays, 0);

  return Math.round(s.cash + matValue + partValue + bikeValue + assets - debt);
}

/** Ajoute une ligne au journal du tick. scope : 'all' | 'amont' | 'aval'. */
export function log(s, kind, text, scope = 'all') {
  s.tickLog.push({ id: nextId('log'), day: s.day, kind, text, scope });
}
