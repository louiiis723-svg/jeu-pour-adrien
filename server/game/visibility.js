/**
 * visibility.js — Projection de l'état selon le rôle du joueur.
 *
 * C'EST LE FICHIER CENTRAL DU DESIGN COOPÉRATIF.
 *
 * L'état de partie est unique et vit sur le serveur. Chaque joueur n'en
 * reçoit qu'une projection : ce qui n'est pas dans sa vue ne transite jamais
 * sur son socket. L'information asymétrique est donc réelle — inspecter le
 * trafic réseau ne la contourne pas — et non un simple masquage d'interface.
 *
 * Répartition :
 *   AMONT (J1) seul  : stocks matières, qualité du stock, fournisseur et
 *                      délais, livraisons en transit, usure des ateliers amont.
 *   AVAL  (J2) seul  : demande, prix du concurrent, réputation, offres de
 *                      contrat et leurs marges, taux de défaut, usure aval.
 *   Partagé          : jour, trésorerie, valeur d'entreprise, tampon, stock de
 *                      vélos, commandes signées (sans la marge), effectifs,
 *                      production du jour, propositions, crise, journal.
 *
 * Sur les bâtiments de l'autre, on ne voit qu'un état grossier
 * (ok / dégradé / arrêté) : on sait qu'il y a un problème, pas sa cause.
 * C'est exactement ce qui oblige à se parler.
 */
import * as C from './constants.js';
import {
  companyValue, effectiveCapacity, capacityBreakdown, bufferCapacity,
  depotCapacity, materialsTotal, supplierOf, assignedStaff, idleStaff, ownerOf,
} from './state.js';
import { defectBreakdown } from './systems/quality.js';
import { demandBreakdown } from './systems/market.js';
import { totalDebt } from './systems/finance.js';
import { GRID_W, GRID_H, ROAD_Y, FRONTIER_X, PLOTS, FLOWS, roadTiles, routeBetween } from './layout.js';

const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

/** Bande grossière pour ce que l'on montre du camp adverse. */
function coarseStatus(b) {
  if (b.broken) return 'stopped';
  if (b.work) return 'work';
  if (!b.active) return 'stopped';
  if (b.bottleneck) return 'degraded';
  if (b.wear > 0.7) return 'degraded';
  return 'ok';
}

const moraleBand = (m) =>
  m >= 0.72 ? 'bon' : m >= 0.55 ? 'correct' : m >= 0.4 ? 'tendu' : 'critique';

/**
 * @param {object} s      état complet
 * @param {'amont'|'aval'} role
 */
export function viewFor(s, role) {
  const partner = role === 'amont' ? 'aval' : 'amont';

  // ── Bâtiments ───────────────────────────────────────────────
  const buildings = {};
  for (const [id, b] of Object.entries(s.buildings)) {
    const def = C.BUILDINGS[id];
    const owner = ownerOf(id);
    const mine = owner === role || owner === 'shared';

    const common = {
      id,
      label: def.label,
      desc: def.desc,
      kind: def.kind,
      owner,
      level: b.level,
      maxLevel: C.MAX_LEVEL,
      active: b.active,
      broken: b.broken,
      work: b.work ? { kind: b.work.kind, daysLeft: b.work.daysLeft, totalDays: b.work.totalDays } : null,
      lastOutput: b.lastOutput,
      load: round(b.load),
      staff: b.staff,
      nominalStaff: Math.round(def.baseStaff * C.LEVEL_MULT[b.level]),
      status: coarseStatus(b),
    };

    buildings[id] = mine
      ? {
          ...common,
          // Détails réservés au propriétaire du poste.
          wear: round(b.wear, 3),
          bottleneck: b.bottleneck,
          capacity: round(effectiveCapacity(s, id), 1),
          breakdown: def.rate ? capacityBreakdown(s, id) : null,
          upgradeCost: b.level < C.MAX_LEVEL ? C.UPGRADE_COST[b.level + 1] : null,
          upgradeDays: b.level < C.MAX_LEVEL ? C.UPGRADE_DAYS[b.level + 1] : null,
        }
      : common;
  }

  // ── Commandes signées : visibles des deux, mais pas la marge ──
  const orders = s.orders.map((o) => ({
    id: o.id,
    client: o.client,
    volume: o.volume,
    remaining: o.remaining,
    dayDue: o.dayDue,
    daysLeft: o.dayDue - s.day,
    ratePerDay: o.ratePerDay,
    penalty: o.penalty,                                   // risque partagé
    unitPrice: role === 'aval' ? o.unitPrice : null,      // marge = affaire de J2
  }));

  const view = {
    role,
    partnerRole: partner,
    /** Horloge serveur : le client s'en sert pour recaler ses comptes à rebours. */
    serverNow: Date.now(),

    // ── Partagé ───────────────────────────────────────────────
    day: s.day,
    totalDays: C.TARGET_DAYS,
    phase: s.phase,
    over: s.over,

    cash: Math.round(s.cash),
    companyValue: companyValue(s),
    objective: C.OBJECTIVE_VALUE,
    debt: Math.round(totalDebt(s)),
    loans: s.loans.map((l) => ({
      principal: l.principal, dailyPayment: l.dailyPayment, remainingDays: l.remainingDays,
    })),
    charges: {
      wages: (s.staff.amont + s.staff.aval) * C.WAGE_PER_WORKER,
      upkeep: Object.values(s.buildings).reduce((n, b) => n + C.UPKEEP_PER_LEVEL * b.level, 0),
      loans: s.loans.reduce((n, l) => n + l.dailyPayment, 0),
    },

    buffer: { ...s.buffer, capacity: bufferCapacity(s) },
    bikes: s.bikes,
    bikesPending: s.bikesPending,

    staff: {
      amont: s.staff.amont,
      aval: s.staff.aval,
      assigned: { amont: assignedStaff(s, 'amont'), aval: assignedStaff(s, 'aval') },
      idle: { amont: idleStaff(s, 'amont'), aval: idleStaff(s, 'aval') },
    },
    morale: {
      own: round(s.morale[role], 3),
      ownBand: moraleBand(s.morale[role]),
      partnerBand: moraleBand(s.morale[partner]),   // bande seulement : à lui de le dire
    },

    buildings,
    orders,
    proposals: s.proposals.map((p) => ({
      id: p.id, kind: p.kind, title: p.title, detail: p.detail, cost: p.cost,
      initiator: p.initiator, votes: p.votes, expiresAt: p.expiresAt,
      mine: p.votes[role] !== null,
    })),
    crisis: s.crisis,
    stats: s.stats,
    history: s.history,

    // ── Réservé au rôle ───────────────────────────────────────
    amont: role === 'amont' ? amontView(s) : null,
    aval: role === 'aval' ? avalView(s) : null,
  };

  return view;
}

function amontView(s) {
  const sup = supplierOf(s);
  return {
    materials: { ...s.materials },
    materialsTotal: materialsTotal(s),
    depotCapacity: depotCapacity(s),
    matQuality: round(s.matQuality, 3),
    supplier: { ...sup },
    suppliers: C.SUPPLIERS.map((x) => ({
      ...x,
      prices: Object.fromEntries(
        Object.entries(C.MATERIALS).map(([m, d]) => [m, round(d.basePrice * x.priceMult, 2)]),
      ),
    })),
    deliveries: s.deliveries.map((d) => ({
      id: d.id, supplierName: d.supplierName, daysLeft: d.daysLeft, items: d.items, cost: Math.round(d.cost),
    })),
    materialsMeta: C.MATERIALS,
    recipes: C.RECIPES,
    partCost: C.PART_MATERIAL_COST,
  };
}

function avalView(s) {
  const d = demandBreakdown(s);
  return {
    market: {
      listPrice: s.market.listPrice,
      competitorPrice: s.market.competitorPrice,
      reputation: round(s.market.reputation, 3),
      demandIndex: round(s.market.demandIndex, 3),
      spotDemandToday: s.market.spotDemandToday ?? 0,
      unmetDemand: s.market.unmetDemand ?? 0,
      campaignDaysLeft: s.market.campaignDaysLeft,
      breakdown: {
        season: round(d.season), campaign: round(d.campaign),
        reputation: round(d.reputation), priceEffect: round(d.priceEffect),
      },
      priceBounds: { min: C.PRICE_MIN, max: C.PRICE_MAX, reference: C.BIKE_REFERENCE_PRICE },
    },
    offers: s.offers.map((o) => ({ ...o, margin: o.unitPrice - C.BIKE_MATERIAL_COST })),
    defects: defectBreakdown(s),
    bikeMaterialCost: C.BIKE_MATERIAL_COST,
    campaign: { cost: C.CAMPAIGN_COST, days: C.CAMPAIGN_DAYS, boost: C.CAMPAIGN_DEMAND_BOOST },
  };
}

/** Le journal est filtré : une alerte « amont » ne part pas chez J2. */
export function logFor(entries, role) {
  return entries.filter((e) => e.scope === 'all' || e.scope === role);
}

/** Plan du campus — statique, envoyé une seule fois au démarrage. */
export function layoutPayload() {
  return {
    gridW: GRID_W, gridH: GRID_H, roadY: ROAD_Y, frontierX: FRONTIER_X,
    plots: PLOTS, roads: roadTiles(),
    // Les trajets sont calculés ici et non côté client : le plan du campus
    // n'a ainsi qu'une seule source de vérité.
    flows: FLOWS.map((f) => ({ ...f, path: routeBetween(f.from, f.to) })),
    labels: Object.fromEntries(
      Object.entries(C.BUILDINGS).map(([id, d]) => [id, { label: d.label, owner: d.owner, kind: d.kind }]),
    ),
  };
}

/** Constantes utiles au client pour afficher les coûts avant action. */
export function rulesPayload() {
  return {
    cosignThreshold: C.COSIGN_THRESHOLD,
    proposalTtl: C.PROPOSAL_TTL_MS,
    crisisTtl: C.CRISIS_TTL_MS,
    hireCost: C.HIRE_COST,
    fireCost: C.FIRE_COST,
    serviceCost: C.SERVICE_COST,
    serviceDays: C.SERVICE_DAYS,
    repairCost: C.REPAIR_COST,
    repairDays: C.REPAIR_DAYS,
    bonusPerWorker: C.BONUS_COST_PER_WORKER,
    bonusMorale: C.BONUS_MORALE,
    campaignCost: C.CAMPAIGN_COST,
    loanMax: C.LOAN_MAX,
    loanTermDays: C.LOAN_TERM_DAYS,
    loanTotalRate: C.LOAN_TOTAL_RATE,
    wagePerWorker: C.WAGE_PER_WORKER,
    upgradeCost: C.UPGRADE_COST,
    upgradeDays: C.UPGRADE_DAYS,
    levelMult: C.LEVEL_MULT,
    tickMs: C.TICK_MS,
    bikeMaterialCost: C.BIKE_MATERIAL_COST,
    materials: C.MATERIALS,
    recipes: C.RECIPES,
    bikeRecipe: C.BIKE_RECIPE,
  };
}
