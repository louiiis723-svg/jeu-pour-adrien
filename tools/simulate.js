/**
 * tools/simulate.js — Simulateur sans interface, pour l'équilibrage.
 *
 *   node tools/simulate.js [nombre de parties] [--verbose]
 *
 * Joue des parties complètes avec deux "joueurs" automatiques qui appliquent
 * une stratégie raisonnable mais pas optimale. Sert à vérifier qu'une partie
 * correctement jouée est gagnable sans être triviale, et qu'une partie mal
 * jouée peut mener à la faillite.
 */
import * as C from '../server/game/constants.js';
import { createInitialState, effectiveCapacity, companyValue, materialsTotal, depotCapacity } from '../server/game/state.js';
import { tick } from '../server/game/engine.js';
import { apply } from '../server/game/actions.js';
import * as proposals from '../server/game/systems/proposals.js';
import * as events from '../server/game/systems/events.js';

const runs = Number(process.argv[2]) || 1;
const verbose = process.argv.includes('--verbose');

/**
 * Deux profils de jeu, pour calibrer l'objectif entre « jouable » et
 * « exigeant » :
 *   prudent  — investit tard, refuse les contrats un peu tendus (défaut)
 *   offensif — emprunte pour lever les goulots tôt, remplit les contrats
 */
const PROFILES = {
  prudent: {
    name: 'prudent', upgradeCash: 130000, contractFill: 0.85, borrow: false,
    guardDays: 0, upgradeOrder: ['batteries', 'assembly'],
  },
  offensif: {
    name: 'offensif', upgradeCash: 60000, contractFill: 0.95, borrow: true,
    guardDays: 0, upgradeOrder: ['batteries', 'assembly', 'motors', 'frames', 'shipping', 'buffer'],
  },
  // Le profil « coordonné » est le jeu tel qu'il est pensé : on investit
  // franchement, mais JAMAIS pendant qu'un contrat serré court. C'est la
  // décision qui exige que les deux joueurs se parlent — J2 connaît
  // l'échéance, J1 connaît la durée du chantier.
  coordonne: {
    name: 'coordonné', upgradeCash: 95000, contractFill: 0.75, borrow: false,
    guardDays: 9, upgradeOrder: ['batteries', 'assembly', 'motors', 'shipping', 'frames', 'buffer'],
  },
  // Strictement identique à « prudent », À L'EXCEPTION de guardDays. Sert à
  // mesurer l'effet propre de la coordination chantier/contrat, sans le
  // confondre avec celui d'une politique d'investissement différente.
  'prudent-garde': {
    name: 'prudent + garde', upgradeCash: 130000, contractFill: 0.85, borrow: false,
    guardDays: 9, upgradeOrder: ['batteries', 'assembly'],
  },
};
const flag = process.argv.find((a) => a.startsWith('--profil='))?.split('=')[1]
  ?? (process.argv.includes('--strong') ? 'offensif' : 'prudent');
const PROFILE = PROFILES[flag] ?? PROFILES.prudent;

/**
 * Consommation réelle de matière PAR VÉLO SORTI, et non par atelier.
 * C'est le raisonnement qu'un bon J1 doit tenir : acheter de quoi alimenter
 * trois ateliers à pleine capacité quand un seul dicte la cadence, c'est
 * immobiliser de la trésorerie dans un dépôt qui ne se videra jamais.
 */
function materialPerBike() {
  const per = { alu: 0, cells: 0, elec: 0 };
  for (const [part, qty] of Object.entries(C.BIKE_RECIPE)) {
    for (const [mat, m] of Object.entries(C.RECIPES[part])) per[mat] += m * qty;
  }
  return per;
}

/** J1 automatique : garde le dépôt rempli et l'usine en état. */
function playAmont(s) {
  // Cadence réellement atteignable = le maillon le plus faible de la chaîne.
  const rate = Math.min(
    ...['frames', 'batteries', 'motors', 'assembly']
      .map((id) => effectiveCapacity(s, id) || C.BUILDINGS[id].rate),
  );
  const per = materialPerBike();
  const lead = C.SUPPLIERS.find((x) => x.id === s.supplierId).leadTime;

  // Point de commande : moins de (délai + 2) jours de couverture.
  // Cible : 5 jours de couverture. Commandes petites et fréquentes.
  const order = {};
  let any = false;
  for (const mat of Object.keys(C.MATERIALS)) {
    const daily = rate * per[mat];
    const coverage = daily > 0 ? s.materials[mat] / daily : Infinity;
    if (coverage < lead + 2) {
      order[mat] = Math.max(0, Math.round(daily * 5 - s.materials[mat]));
      if (order[mat] > 0) any = true;
    } else order[mat] = 0;
  }
  if (any) {
    const room = depotCapacity(s) - materialsTotal(s);
    const total = order.alu + order.cells + order.elec;
    if (total > room) for (const m of Object.keys(order)) order[m] = Math.floor(order[m] * room / total);
    if (order.alu + order.cells + order.elec > 0) apply(s, 'amont', 'supply:order', order);
  }

  // Entretien préventif dès 70 % d'usure.
  for (const id of ['frames', 'batteries', 'motors', 'depot']) {
    const b = s.buildings[id];
    if (b.broken && !b.work) apply(s, 'amont', 'building:repair', { id });
    else if (!b.work && b.wear > 0.7) apply(s, 'amont', 'building:service', { id });
  }

  // On garde les postes dotés de leur effectif nominal si possible.
  balanceStaff(s, 'amont');

  // Un emprunt d'amorçage permet de lever le goulot batteries dès le début,
  // au prix d'une échéance quotidienne à tenir.
  if (PROFILE.borrow && s.day === 3 && !s.loans.length) {
    apply(s, 'amont', 'finance:loan', { amount: 90000 });
  }
  invest(s, 'amont');
}

/**
 * Investissement : on lève le goulot le plus contraignant de sa division,
 * dans l'ordre défini par le profil, et on recrute pour doter le poste agrandi.
 */
function invest(s, division) {
  ensureStaff(s, division);
  if (s.cash < PROFILE.upgradeCash) return;
  if (s.day > C.TARGET_DAYS - 12) return; // trop tard pour rentabiliser
  // Un seul chantier d'amélioration à la fois, proposition comprise :
  // sans ce garde, on relance la décision chaque jour tant qu'elle attend
  // la contre-signature.
  if (Object.values(s.buildings).some((x) => x.work?.kind === 'upgrade')) return;
  if (s.proposals.some((p) => p.kind === 'building:upgrade')) return;
  // Un chantier immobilise le poste plusieurs jours : on ne le lance pas
  // avec une échéance de contrat dans le viseur.
  if (PROFILE.guardDays && s.orders.some((o) => o.dayDue - s.day < PROFILE.guardDays)) return;

  for (const id of PROFILE.upgradeOrder) {
    const owner = C.BUILDINGS[id].owner;
    if (owner !== division && owner !== 'shared') continue;
    const b = s.buildings[id];
    if (b.level >= C.MAX_LEVEL || b.work || b.broken) continue;
    apply(s, division, 'building:upgrade', { id });
    return;
  }
}

/** Recrute juste ce qu'il faut pour doter tous les postes de la division. */
function ensureStaff(s, division) {
  if (s.proposals.some((p) => p.kind === 'hr:hire')) return;
  const needed = Object.keys(C.BUILDINGS)
    .filter((id) => C.BUILDINGS[id].owner === division)
    .reduce((n, id) => n + Math.round(C.BUILDINGS[id].baseStaff * C.LEVEL_MULT[s.buildings[id].level]), 0);
  const gap = needed - s.staff[division];
  if (gap > 0) apply(s, division, 'hr:hire', { count: Math.min(20, gap) });
}

/** J2 automatique : accepte les contrats tenables, pilote le prix au stock. */
function playAval(s) {
  const capacity = effectiveCapacity(s, 'assembly');
  // Cadence déjà engagée par les contrats en cours.
  const committed = s.orders.reduce(
    (n, o) => n + o.remaining / Math.max(1, o.dayDue - s.day), 0);
  const free = Math.max(0, capacity - committed);

  for (const offer of [...s.offers]) {
    // On n'engage que ce qui reste de cadence libre, en gardant 15 % de marge
    // pour la vente spot et les aléas.
    if (offer.ratePerDay <= free * PROFILE.contractFill) apply(s, 'aval', 'market:accept', { offerId: offer.id });
    else apply(s, 'aval', 'market:decline', { offerId: offer.id });
  }

  // Prix : on se cale sous le concurrent, et on casse le prix si le stock de
  // vélos finis s'accumule — c'est le levier de déstockage de J2.
  const glut = s.bikes > capacity * 4 ? 0.82 : s.bikes > capacity * 2 ? 0.92 : 0.99;
  const target = Math.round(
    Math.max(C.PRICE_MIN, Math.min(C.PRICE_MAX, s.market.competitorPrice * glut)));
  if (Math.abs(target - s.market.listPrice) > 25) apply(s, 'aval', 'market:setPrice', { price: target });

  for (const id of ['assembly', 'quality', 'shipping']) {
    const b = s.buildings[id];
    if (b.broken && !b.work) apply(s, 'aval', 'building:repair', { id });
    else if (!b.work && b.wear > 0.7) apply(s, 'aval', 'building:service', { id });
  }
  balanceStaff(s, 'aval');

  invest(s, 'aval');
}

/** Réaffecte l'effectif disponible au prorata des besoins nominaux. */
function balanceStaff(s, division) {
  const ids = Object.keys(C.BUILDINGS).filter((id) => C.BUILDINGS[id].owner === division);
  const wanted = ids.map((id) => ({
    id, n: Math.round(C.BUILDINGS[id].baseStaff * C.LEVEL_MULT[s.buildings[id].level]),
  }));
  const total = wanted.reduce((n, w) => n + w.n, 0);
  const pool = s.staff[division];
  for (const id of ids) s.buildings[id].staff = 0;
  for (const w of wanted) {
    const n = total > 0 ? Math.floor(pool * w.n / total) : 0;
    apply(s, division, 'building:setStaff', { id: w.id, staff: n });
  }
}

/** Les deux directions contresignent systématiquement (cas favorable). */
function autoSign(s) {
  for (const p of [...s.proposals]) {
    const other = p.initiator === 'amont' ? 'aval' : 'amont';
    if (p.votes[other] === null) proposals.vote(s, p.id, other, 'yes');
  }
  if (s.crisis) {
    // On paie pour éviter l'interruption si la trésorerie le permet, sinon on
    // subit l'option par défaut — comme le feraient deux joueurs prudents.
    const choice = s.cash > 90000 ? s.crisis.options[0].id : s.crisis.defaultOption;
    events.vote(s, s.crisis.id, 'amont', choice);
    events.vote(s, s.crisis.id, 'aval', choice);
  }
}

function runGame() {
  const s = createInitialState();
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 500) {
    playAmont(s);
    playAval(s);
    autoSign(s);
    tick(s);
    if (verbose && s.day % 10 === 0) {
      console.log(`  j${String(s.day).padStart(2)}  tréso ${fmt(s.cash).padStart(9)} €  valeur ${fmt(companyValue(s)).padStart(9)} €  tampon ${s.buffer.frames}/${s.buffer.batteries}/${s.buffer.motors}  stock ${s.bikes}`);
    }
  }
  return s;
}

const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
const results = [];
for (let i = 0; i < runs; i++) {
  if (verbose) console.log(`\n── Partie ${i + 1} ──`);
  results.push(runGame());
}

console.log('\n════ RÉSULTATS ════');
const wins = results.filter((s) => s.over?.win).length;
const bust = results.filter((s) => s.over?.reason === 'faillite').length;
const values = results.map((s) => s.over.value).sort((a, b) => a - b);
const quantile = (q) => values[Math.min(values.length - 1, Math.floor(values.length * q))];
const median = quantile(0.5);

console.log(`Profil           : ${PROFILE.name}`);
console.log(`Parties          : ${runs}`);
console.log(`Objectif atteint : ${wins}/${runs} (${Math.round(wins / runs * 100)} %)`);
console.log(`Faillites        : ${bust}`);
console.log(`Valeur médiane   : ${fmt(median)} €   (objectif ${fmt(C.OBJECTIVE_VALUE)} €)`);
console.log(`Quartiles        : ${fmt(quantile(0.25))} € · ${fmt(median)} € · ${fmt(quantile(0.75))} €`);
console.log(`Valeur min / max : ${fmt(values[0])} € / ${fmt(values[values.length - 1])} €`);

const s0 = results[0];
console.log('\nDétail de la première partie :');
console.log(`  ${s0.over.title} — ${s0.over.text}`);
console.log(`  Produits ${s0.stats.produced} · expédiés ${s0.stats.shipped} · rebuts ${s0.stats.scrapped} (${(s0.stats.scrapped / Math.max(1, s0.stats.produced) * 100).toFixed(1)} %)`);
console.log(`  Contrats honorés ${s0.stats.contractsDone} · échoués ${s0.stats.contractsFailed}`);
console.log(`  Recettes ${fmt(s0.stats.revenue)} € · charges ${fmt(s0.stats.costs)} €`);

// ── Compte de résultat consolidé de la première partie ───────
const pnl = (title, obj) => {
  console.log(`\n  ${title}`);
  Object.entries(obj).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`    ${k.padEnd(24)} ${fmt(v).padStart(11)} €`));
};
pnl('PRODUITS', s0.stats.produits);
pnl('CHARGES', s0.stats.charges);
console.log(`\n    ${'RÉSULTAT'.padEnd(24)} ${fmt(s0.stats.revenue - s0.stats.costs).padStart(11)} €`);
