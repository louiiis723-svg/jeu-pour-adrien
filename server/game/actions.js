/**
 * actions.js — Porte d'entrée unique des intentions joueur.
 *
 * Toute action client passe ici : on valide l'appartenance du rôle, la
 * cohérence des nombres et la trésorerie, PUIS on applique. Le client n'a
 * aucun pouvoir de mutation directe.
 *
 * Deux chemins possibles pour une dépense :
 *   · en dessous du seuil de co-signature → exécution immédiate
 *   · au-dessus, ou décision engageante   → création d'une proposition,
 *     que l'autre joueur doit contresigner (mécanique B)
 */
import * as C from './constants.js';
import { log, ownerOf, assignedStaff, supplierOf } from './state.js';
import { spend, canAfford, takeLoan, loanDailyPayment } from './systems/finance.js';
import { placeOrder, quote } from './systems/supply.js';
import { signContract } from './systems/market.js';
import { startWork } from './systems/construction.js';
import * as proposals from './systems/proposals.js';
import { defectBreakdown } from './systems/quality.js';

const ok = () => ({ ok: true });
const err = (message) => ({ ok: false, error: message });
const fmt = (n) => Math.round(n).toLocaleString('fr-FR');

const isInt = (v, min, max) =>
  Number.isFinite(v) && Number.isInteger(v) && v >= min && v <= max;

/**
 * Applique une dépense, ou la transforme en proposition si elle dépasse le
 * seuil de co-signature. `force` impose la co-signature quel que soit le coût
 * (décisions engageantes : contrats, emprunts, bâtiments partagés).
 */
function gated(s, division, { cost, kind, title, detail, payload, force = false }) {
  if (!force && cost <= C.COSIGN_THRESHOLD) {
    if (cost > 0 && !canAfford(s, cost)) return err('Trésorerie insuffisante.');
    proposals.registerExecutor(kind, EXECUTORS[kind]);
    EXECUTORS[kind](s, payload);
    return ok();
  }
  // Anti-doublon : une même décision ne peut pas encombrer l'écran de
  // l'autre joueur en plusieurs exemplaires. On compare le type ET la charge
  // utile, pour couvrir aussi bien « améliorer l'atelier X » que
  // « recruter 3 personnes », qui n'a pas d'identifiant propre.
  const signature = `${kind}:${JSON.stringify(payload ?? {})}`;
  if (s.proposals.some((p) => `${p.kind}:${JSON.stringify(p.payload ?? {})}` === signature)) {
    return err('Une proposition identique est déjà en attente de contre-signature.');
  }
  proposals.create(s, { kind, title, detail, cost, initiator: division, payload });
  return { ok: true, pending: true };
}

// ─────────────────────────────────────────────────────────────
// Exécuteurs — ce qui se passe réellement, une fois la décision prise
// (immédiatement, ou après contre-signature).
// ─────────────────────────────────────────────────────────────
const EXECUTORS = {
  'supply:order': (s, { items }) => {
    const cost = quote(s, items);
    if (!canAfford(s, cost)) return log(s, 'danger', 'Commande annulée : trésorerie insuffisante.', 'amont');
    placeOrder(s, items);
  },

  'building:upgrade': (s, { id }) => {
    const b = s.buildings[id];
    if (!b || b.level >= C.MAX_LEVEL || b.work || b.broken) {
      return log(s, 'danger', `Amélioration annulée : ${C.BUILDINGS[id]?.label ?? id} n'est plus disponible.`);
    }
    const toLevel = b.level + 1;
    const cost = C.UPGRADE_COST[toLevel];
    if (!canAfford(s, cost)) return log(s, 'danger', 'Amélioration annulée : trésorerie insuffisante.');
    spend(s, cost, 'investissements');
    startWork(s, id, 'upgrade', C.UPGRADE_DAYS[toLevel], { toLevel });
    log(s, 'build',
      `Chantier lancé : ${C.BUILDINGS[id].label} → niveau ${toLevel} (${C.UPGRADE_DAYS[toLevel]} jours d'arrêt).`);
  },

  'building:service': (s, { id }) => {
    const b = s.buildings[id];
    if (!b || b.work || b.broken) return;
    if (!canAfford(s, C.SERVICE_COST)) return log(s, 'danger', 'Révision annulée : trésorerie insuffisante.');
    spend(s, C.SERVICE_COST, 'révisions');
    startWork(s, id, 'service', C.SERVICE_DAYS);
    log(s, 'build', `Révision lancée sur ${C.BUILDINGS[id].label} (${C.SERVICE_DAYS} jour d'arrêt).`);
  },

  'building:repair': (s, { id }) => {
    const b = s.buildings[id];
    if (!b || !b.broken || b.work) return;
    if (!canAfford(s, C.REPAIR_COST)) return log(s, 'danger', 'Réparation annulée : trésorerie insuffisante.');
    spend(s, C.REPAIR_COST, 'réparations');
    startWork(s, id, 'repair', C.REPAIR_DAYS);
    log(s, 'build', `Réparation lancée sur ${C.BUILDINGS[id].label} (${C.REPAIR_DAYS} jours).`);
  },

  'hr:hire': (s, { division, count }) => {
    const cost = count * C.HIRE_COST;
    if (!canAfford(s, cost)) return log(s, 'danger', 'Recrutement annulé : trésorerie insuffisante.', division);
    spend(s, cost, 'recrutement');
    s.staff[division] += count;
    log(s, 'hr', `${count} recrutement(s) en ${division} — ${fmt(cost)} € de frais.`, division);
  },

  'hr:fire': (s, { division, count }) => {
    const n = Math.min(count, s.staff[division]);
    const cost = n * C.FIRE_COST;
    spend(s, cost, 'indemnités de départ');
    s.staff[division] -= n;
    s.morale[division] = Math.max(C.MORALE_MIN, s.morale[division] - 0.05 * n);
    trimAssignments(s, division);
    log(s, 'hr', `${n} départ(s) en ${division} — ${fmt(cost)} € d'indemnités, moral en baisse.`, division);
  },

  'hr:bonus': (s, { division }) => {
    const cost = s.staff[division] * C.BONUS_COST_PER_WORKER;
    if (!canAfford(s, cost)) return log(s, 'danger', 'Prime annulée : trésorerie insuffisante.', division);
    spend(s, cost, 'primes');
    s.morale[division] = Math.min(1, s.morale[division] + C.BONUS_MORALE);
    log(s, 'hr', `Prime exceptionnelle versée à l'équipe ${division} — ${fmt(cost)} €.`);
  },

  'market:accept': (s, { id }) => {
    const offer = s.offers.find((o) => o.id === id);
    if (!offer) return log(s, 'danger', 'Le contrat n’était plus disponible.', 'aval');
    signContract(s, offer);
  },

  'market:campaign': (s) => {
    if (!canAfford(s, C.CAMPAIGN_COST)) return log(s, 'danger', 'Campagne annulée : trésorerie insuffisante.', 'aval');
    spend(s, C.CAMPAIGN_COST, 'marketing');
    s.market.campaignDaysLeft = C.CAMPAIGN_DAYS;
    s.market.reputation = Math.min(1, s.market.reputation + C.CAMPAIGN_REPUTATION);
    log(s, 'market', `Campagne de communication lancée pour ${C.CAMPAIGN_DAYS} jours (+${Math.round(C.CAMPAIGN_DEMAND_BOOST * 100)} % de demande).`);
  },

  'finance:loan': (s, { amount }) => {
    takeLoan(s, amount);
  },
};

// Les exécuteurs sont connus de proposals.js dès le chargement du module.
for (const [kind, fn] of Object.entries(EXECUTORS)) proposals.registerExecutor(kind, fn);

/** Après un départ, on rogne les affectations devenues impossibles. */
function trimAssignments(s, division) {
  let excess = assignedStaff(s, division) - s.staff[division];
  if (excess <= 0) return;
  for (const [id, b] of Object.entries(s.buildings)) {
    if (excess <= 0) break;
    if (ownerOf(id) !== division) continue;
    const take = Math.min(b.staff, excess);
    b.staff -= take;
    excess -= take;
  }
}

// ─────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} s
 * @param {'amont'|'aval'} division  rôle du joueur qui agit
 * @param {string} type
 * @param {object} payload
 */
export function apply(s, division, type, payload = {}) {
  if (s.phase === 'over') return err('La partie est terminée.');

  switch (type) {
    // ── Amont : approvisionnement ─────────────────────────────
    case 'supply:setSupplier': {
      if (division !== 'amont') return err('Réservé à la Direction Industrielle.');
      const sup = C.SUPPLIERS.find((x) => x.id === payload.supplierId);
      if (!sup) return err('Fournisseur inconnu.');
      if (sup.id === s.supplierId) return ok();
      s.supplierId = sup.id;
      log(s, 'supply',
        `Fournisseur : ${sup.name} (prix ×${sup.priceMult}, qualité ${Math.round(sup.quality * 100)} %, délai ${sup.leadTime} j).`,
        'amont');
      return ok();
    }

    case 'supply:order': {
      if (division !== 'amont') return err('Réservé à la Direction Industrielle.');
      const items = {};
      for (const mat of Object.keys(C.MATERIALS)) {
        const v = Number(payload[mat] ?? 0);
        if (!isInt(v, 0, 20000)) return err('Quantité invalide.');
        items[mat] = v;
      }
      const total = items.alu + items.cells + items.elec;
      if (total <= 0) return err('Commande vide.');

      const cost = quote(s, items);
      const detail = Object.entries(items).filter(([, q]) => q > 0)
        .map(([m, q]) => `${q} ${C.MATERIALS[m].unit} ${C.MATERIALS[m].label.toLowerCase()}`).join(', ');
      return gated(s, division, {
        cost, kind: 'supply:order',
        title: `Commande matières — ${fmt(cost)} €`,
        detail: `${detail} chez ${supplierOf(s).name}, livraison sous ${supplierOf(s).leadTime} jours.`,
        payload: { items },
      });
    }

    // ── Bâtiments ─────────────────────────────────────────────
    case 'building:setStaff': {
      const b = s.buildings[payload.id];
      if (!b) return err('Bâtiment inconnu.');
      const owner = ownerOf(payload.id);
      if (owner !== division) return err('Ce poste ne relève pas de votre direction.');
      const n = Number(payload.staff);
      if (!isInt(n, 0, 200)) return err('Effectif invalide.');

      const others = assignedStaff(s, division) - b.staff;
      if (others + n > s.staff[division]) {
        return err(`Effectif insuffisant : ${s.staff[division]} personne(s) en ${division}, ${others} déjà affectée(s).`);
      }
      b.staff = n;
      return ok();
    }

    case 'building:setActive': {
      const b = s.buildings[payload.id];
      if (!b) return err('Bâtiment inconnu.');
      if (ownerOf(payload.id) !== division) return err('Ce poste ne relève pas de votre direction.');
      b.active = !!payload.active;
      log(s, 'build',
        `${C.BUILDINGS[payload.id].label} ${b.active ? 'redémarré' : 'mis à l’arrêt'}.`, division);
      return ok();
    }

    case 'building:upgrade': {
      const id = payload.id;
      const b = s.buildings[id];
      if (!b) return err('Bâtiment inconnu.');
      const owner = ownerOf(id);
      if (owner !== division && owner !== 'shared') return err('Ce poste ne relève pas de votre direction.');
      if (b.level >= C.MAX_LEVEL) return err('Niveau maximum déjà atteint.');
      if (b.work) return err('Un chantier est déjà en cours sur ce poste.');
      if (b.broken) return err('Réparez ce poste avant de l’améliorer.');

      const toLevel = b.level + 1;
      const cost = C.UPGRADE_COST[toLevel];
      const days = C.UPGRADE_DAYS[toLevel];
      return gated(s, division, {
        cost, kind: 'building:upgrade',
        title: `${C.BUILDINGS[id].label} → niveau ${toLevel} (${fmt(cost)} €)`,
        detail: `Capacité ×${C.LEVEL_MULT[toLevel]}, mais ${days} jours d'arrêt complet du poste. Effectif nominal porté à ${Math.round(C.BUILDINGS[id].baseStaff * C.LEVEL_MULT[toLevel])}.`,
        payload: { id },
        force: owner === 'shared',
      });
    }

    case 'building:service': {
      const b = s.buildings[payload.id];
      if (!b) return err('Bâtiment inconnu.');
      if (ownerOf(payload.id) !== division) return err('Ce poste ne relève pas de votre direction.');
      if (b.work) return err('Un chantier est déjà en cours.');
      if (b.broken) return err('Ce poste est en panne : il faut le réparer, pas le réviser.');
      return gated(s, division, {
        cost: C.SERVICE_COST, kind: 'building:service',
        title: `Révision ${C.BUILDINGS[payload.id].label}`,
        detail: `${fmt(C.SERVICE_COST)} €, ${C.SERVICE_DAYS} jour d'arrêt, usure ramenée à ${Math.round(C.SERVICE_WEAR_LEFT * 100)} %.`,
        payload: { id: payload.id },
      });
    }

    case 'building:repair': {
      const b = s.buildings[payload.id];
      if (!b) return err('Bâtiment inconnu.');
      if (ownerOf(payload.id) !== division) return err('Ce poste ne relève pas de votre direction.');
      if (!b.broken) return err('Ce poste n’est pas en panne.');
      if (b.work) return err('Réparation déjà en cours.');
      return gated(s, division, {
        cost: C.REPAIR_COST, kind: 'building:repair',
        title: `Réparation ${C.BUILDINGS[payload.id].label}`,
        detail: `${fmt(C.REPAIR_COST)} €, ${C.REPAIR_DAYS} jours.`,
        payload: { id: payload.id },
      });
    }

    // ── Ressources humaines ───────────────────────────────────
    case 'hr:hire': {
      const n = Number(payload.count);
      if (!isInt(n, 1, 20)) return err('Nombre invalide (1 à 20).');
      const cost = n * C.HIRE_COST;
      return gated(s, division, {
        cost, kind: 'hr:hire',
        title: `Recruter ${n} personne(s) en ${division} — ${fmt(cost)} €`,
        detail: `Masse salariale : +${fmt(n * C.WAGE_PER_WORKER)} €/jour.`,
        payload: { division, count: n },
      });
    }

    case 'hr:fire': {
      const n = Number(payload.count);
      if (!isInt(n, 1, 20)) return err('Nombre invalide (1 à 20).');
      if (n > s.staff[division]) return err('Effectif insuffisant.');
      const cost = n * C.FIRE_COST;
      return gated(s, division, {
        cost, kind: 'hr:fire',
        title: `Se séparer de ${n} personne(s) en ${division} — ${fmt(cost)} €`,
        detail: `Économie : ${fmt(n * C.WAGE_PER_WORKER)} €/jour. Moral en forte baisse.`,
        payload: { division, count: n },
      });
    }

    case 'hr:bonus': {
      const cost = s.staff[division] * C.BONUS_COST_PER_WORKER;
      return gated(s, division, {
        cost, kind: 'hr:bonus',
        title: `Prime à l'équipe ${division} — ${fmt(cost)} €`,
        detail: `Moral +${Math.round(C.BONUS_MORALE * 100)} points immédiatement.`,
        payload: { division },
      });
    }

    // ── Aval : marché ─────────────────────────────────────────
    case 'market:setPrice': {
      if (division !== 'aval') return err('Réservé à la Direction Commerciale.');
      const p = Number(payload.price);
      if (!isInt(p, C.PRICE_MIN, C.PRICE_MAX)) {
        return err(`Prix hors bornes (${C.PRICE_MIN} – ${C.PRICE_MAX} €).`);
      }
      s.market.listPrice = p;
      return ok();
    }

    case 'market:accept': {
      if (division !== 'aval') return err('Réservé à la Direction Commerciale.');
      const offer = s.offers.find((o) => o.id === payload.offerId);
      if (!offer) return err('Cette offre n’est plus disponible.');
      // Un contrat engage l'outil industriel : co-signature TOUJOURS requise,
      // quel que soit le montant. C'est le point de friction central du jeu.
      return gated(s, division, {
        cost: 0, kind: 'market:accept', force: true,
        title: `Contrat ${offer.client} — ${offer.volume} vélos en ${offer.days} jours`,
        detail: `Cadence exigée : ${offer.ratePerDay} vélos/jour. Pénalité en cas d'échec : ${fmt(offer.penalty)} €. Produit : ${fmt(offer.total)} €.`,
        payload: { id: offer.id },
      });
    }

    case 'market:decline': {
      if (division !== 'aval') return err('Réservé à la Direction Commerciale.');
      const offer = s.offers.find((o) => o.id === payload.offerId);
      if (!offer) return err('Cette offre n’est plus disponible.');
      s.offers = s.offers.filter((o) => o.id !== offer.id);
      log(s, 'market', `Offre ${offer.client} déclinée.`, 'aval');
      return ok();
    }

    case 'market:campaign': {
      if (division !== 'aval') return err('Réservé à la Direction Commerciale.');
      if (s.market.campaignDaysLeft > 0) return err('Une campagne est déjà en cours.');
      return gated(s, division, {
        cost: C.CAMPAIGN_COST, kind: 'market:campaign',
        title: `Campagne de communication — ${fmt(C.CAMPAIGN_COST)} €`,
        detail: `+${Math.round(C.CAMPAIGN_DEMAND_BOOST * 100)} % de demande pendant ${C.CAMPAIGN_DAYS} jours, réputation +${Math.round(C.CAMPAIGN_REPUTATION * 100)} points.`,
        payload: {},
      });
    }

    // ── Finance ───────────────────────────────────────────────
    case 'finance:loan': {
      const amount = Number(payload.amount);
      if (!isInt(amount, 10000, C.LOAN_MAX)) {
        return err(`Montant hors bornes (10 000 – ${fmt(C.LOAN_MAX)} €).`);
      }
      const daily = loanDailyPayment(amount);
      return gated(s, division, {
        cost: 0, kind: 'finance:loan', force: true,
        title: `Emprunt de ${fmt(amount)} €`,
        detail: `Remboursement : ${fmt(daily)} €/jour pendant ${C.LOAN_TERM_DAYS} jours, soit ${fmt(daily * C.LOAN_TERM_DAYS)} € au total.`,
        payload: { amount },
      });
    }

    // ── Partage d'information (le pont entre les deux écrans) ──
    case 'info:share':
      return shareInfo(s, division, payload.key);

    case 'game:pause': {
      // En pause, on décale les échéances murales (propositions, crise) de la
      // durée de la pause : sinon une pause ferait expirer une décision en
      // cours, ce qui serait vécu comme un bug.
      if (payload.paused && s.phase === 'running') {
        s.phase = 'paused';
        s.pausedAt = Date.now();
        log(s, 'system', 'Partie mise en pause.');
      } else if (!payload.paused && s.phase === 'paused') {
        const delta = Date.now() - (s.pausedAt ?? Date.now());
        for (const p of s.proposals) p.expiresAt += delta;
        if (s.crisis) s.crisis.expiresAt += delta;
        s.phase = 'running';
        s.pausedAt = null;
        log(s, 'system', 'Reprise de la partie.');
      }
      return ok();
    }

    default:
      return err(`Action inconnue : ${type}`);
  }
}

/**
 * Publie une donnée privée dans le journal commun.
 * C'est la seule façon de faire passer un chiffre exact d'un écran à l'autre
 * sans passer par la voix — et ça laisse une trace horodatée.
 */
function shareInfo(s, division, key) {
  const pct = (v) => `${Math.round(v * 100)} %`;
  const lines = {
    amont: {
      materials: () => {
        const m = s.materials;
        return `Stock matières : ${m.alu} kg alu · ${m.cells} cellules · ${m.elec} modules électro. (qualité ${pct(s.matQuality)}).`;
      },
      wear: () => Object.keys(C.BUILDINGS)
        .filter((id) => ownerOf(id) === 'amont' && C.BUILDINGS[id].rate)
        .map((id) => `${C.BUILDINGS[id].label} ${pct(s.buildings[id].wear)}`)
        .join(' · ').replace(/^/, 'Usure amont : '),
      capacity: () => ['frames', 'batteries', 'motors']
        .map((id) => `${C.BUILDINGS[id].label} ${s.buildings[id].lastOutput}/j`)
        .join(' · ').replace(/^/, 'Production amont d’hier : '),
      supplier: () => {
        const sup = supplierOf(s);
        return `Fournisseur actif : ${sup.name} — délai ${sup.leadTime} j, qualité ${pct(sup.quality)}, prix ×${sup.priceMult}.`;
      },
      morale: () => `Moral de l'équipe amont : ${pct(s.morale.amont)}.`,
    },
    aval: {
      demand: () => `Demande spot du jour : ${s.market.spotDemandToday ?? 0} vélos, à ${s.market.listPrice} € (concurrent : ${s.market.competitorPrice} €).`,
      reputation: () => `Réputation : ${pct(s.market.reputation)}.`,
      defects: () => {
        const d = defectBreakdown(s);
        return `Taux de défaut : ${(d.total * 100).toFixed(1)} % (usure ${(d.fromWear * 100).toFixed(1)} · moral ${(d.fromMorale * 100).toFixed(1)} · matières ${(d.fromSupplier * 100).toFixed(1)}).`;
      },
      offers: () => s.offers.length
        ? `Offres sur le bureau : ${s.offers.map((o) => `${o.client} ${o.volume} vélos en ${o.days} j (${o.ratePerDay}/j, ${fmt(o.unitPrice)} €/u)`).join(' | ')}.`
        : 'Aucune offre de contrat en ce moment.',
      morale: () => `Moral de l'équipe aval : ${pct(s.morale.aval)}.`,
    },
  };

  const fn = lines[division]?.[key];
  if (!fn) return err('Donnée non partageable.');
  log(s, 'share', `[${division === 'amont' ? 'Industrie' : 'Commerce'}] ${fn()}`);
  return ok();
}
