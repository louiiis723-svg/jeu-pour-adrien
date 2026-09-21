/**
 * events.js — Crises chronométrées (mécanique B, versant pression temporelle).
 *
 * Une crise suspend le confort du jeu : les deux joueurs doivent choisir la
 * MÊME option avant la fin du compte à rebours. S'ils divergent ou laissent
 * filer, l'option par défaut — toujours la plus mauvaise — s'applique.
 *
 * Les effets sont des fonctions serveur : seule la partie descriptive part
 * sur le réseau, donc un client ne peut ni les lire ni les déclencher.
 */
import * as C from '../constants.js';
import { log, nextId } from '../state.js';
import { spend, canAfford } from './finance.js';
import { startWork } from './construction.js';
import { signContract } from './market.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const CRISES = [
  {
    id: 'power',
    title: 'Coupure électrique sur la zone industrielle',
    text: 'Le gestionnaire du réseau annonce 48 h de délestage. Il faut décider qui tourne, ou payer pour que tout tourne.',
    options: [
      { id: 'genset',   label: 'Louer des groupes électrogènes', detail: '16 000 € — aucune interruption.' },
      { id: 'haltUp',   label: 'Arrêter l’amont 2 jours',   detail: 'Les trois ateliers de composants s’arrêtent. Le tampon se vide.' },
      { id: 'haltDown', label: 'Arrêter l’aval 2 jours',    detail: 'Assemblage, qualité et expédition s’arrêtent. Le tampon sature.' },
    ],
    default: 'haltUp',
    apply(s, opt) {
      if (opt === 'genset') {
        spend(s, 16000, 'crises');
        log(s, 'event', 'Groupes électrogènes en place : la production continue normalement.');
      } else if (opt === 'haltDown') {
        for (const id of ['assembly', 'quality', 'shipping']) startWork(s, id, 'halt', 2);
        log(s, 'danger', 'L’aval est à l’arrêt pour 2 jours.');
      } else {
        for (const id of ['frames', 'batteries', 'motors']) startWork(s, id, 'halt', 2);
        log(s, 'danger', 'L’amont est à l’arrêt pour 2 jours.');
      }
    },
  },
  {
    id: 'urgent',
    title: 'Commande urgente d’un client historique',
    text: 'Vélocité Grand Est a besoin de 70 vélos sous 4 jours et paie 1 480 € l’unité. Refuser abîme la relation.',
    options: [
      { id: 'accept', label: 'Accepter la commande', detail: '70 vélos en 4 jours — 103 600 €, pénalité 21 000 € en cas d’échec.' },
      { id: 'refuse', label: 'Décliner poliment',    detail: 'Réputation −4 points, aucun risque industriel.' },
    ],
    default: 'refuse',
    apply(s, opt) {
      if (opt === 'accept') {
        signContract(s, {
          id: nextId('offer'), client: 'Vélocité Grand Est', volume: 70, days: 4,
          unitPrice: 1480, penalty: 21000, ratePerDay: 17.5,
        });
      } else {
        s.market.reputation = clamp(s.market.reputation - 0.04, 0, 1);
        log(s, 'event', 'Commande déclinée. Le client en prend note.');
      }
    },
  },
  {
    id: 'recall',
    title: 'Rappel qualité sur un lot livré',
    text: 'Un lot de 40 vélos présente un défaut de serrage sur la potence. Le client attend une position sous 45 secondes.',
    options: [
      { id: 'refund',  label: 'Remboursement intégral', detail: '17 000 € — la réputation est préservée.' },
      { id: 'repair',  label: 'Réparation sur place',   detail: '9 000 € et réputation −5 points.' },
      { id: 'contest', label: 'Contester le défaut',    detail: 'Gratuit, mais réputation −13 points.' },
    ],
    default: 'contest',
    apply(s, opt) {
      if (opt === 'refund') { spend(s, 17000, 'crises'); log(s, 'event', 'Lot remboursé. Le client reste confiant.'); }
      else if (opt === 'repair') {
        spend(s, 9000, 'crises');
        s.market.reputation = clamp(s.market.reputation - 0.05, 0, 1);
        log(s, 'event', 'Réparation sur place effectuée.');
      } else {
        s.market.reputation = clamp(s.market.reputation - 0.13, 0, 1);
        log(s, 'danger', 'Défaut contesté. L’affaire a circulé dans la presse spécialisée.');
      }
    },
  },
  {
    id: 'poaching',
    title: 'Un concurrent débauche vos ouvriers',
    text: 'Cinq salariés ont reçu une offre à +15 %. Sans réponse rapide, ils partent.',
    options: [
      { id: 'raise', label: 'Revaloriser les salaires', detail: '15 000 € — personne ne part, moral +12 points partout.' },
      { id: 'let',   label: 'Les laisser partir',       detail: '3 ouvriers amont et 2 aval en moins, moral −8 points.' },
    ],
    default: 'let',
    apply(s, opt) {
      if (opt === 'raise') {
        spend(s, 15000, 'crises');
        s.morale.amont = clamp(s.morale.amont + 0.12, 0, 1);
        s.morale.aval = clamp(s.morale.aval + 0.12, 0, 1);
        log(s, 'event', 'Revalorisation actée. Les équipes restent.');
      } else {
        s.staff.amont = Math.max(0, s.staff.amont - 3);
        s.staff.aval = Math.max(0, s.staff.aval - 2);
        s.morale.amont = clamp(s.morale.amont - 0.08, C.MORALE_MIN, 1);
        s.morale.aval = clamp(s.morale.aval - 0.08, C.MORALE_MIN, 1);
        log(s, 'danger', '5 départs. Vérifiez vos affectations de postes : des postes sont peut-être en sureffectif déclaré.');
      }
    },
  },
  {
    id: 'badBatch',
    title: 'Lot de cellules suspect',
    text: 'Le laboratoire signale une dispersion anormale sur 300 cellules déjà en stock.',
    options: [
      { id: 'scrap', label: 'Détruire le lot',    detail: '300 cellules perdues, la qualité du stock est préservée.' },
      { id: 'use',   label: 'L’utiliser quand même', detail: 'Rien à payer maintenant. La qualité du stock chute de 25 %.' },
    ],
    default: 'use',
    apply(s, opt) {
      if (opt === 'scrap') {
        s.materials.cells = Math.max(0, s.materials.cells - 300);
        log(s, 'event', 'Lot détruit. 300 cellules parties au recyclage.');
      } else {
        s.matQuality = clamp(s.matQuality * 0.75, 0.3, 1);
        log(s, 'danger', 'Lot conservé. Le taux de défaut va grimper au contrôle qualité.');
      }
    },
  },
  {
    id: 'strike',
    title: 'Grève des transporteurs régionaux',
    text: 'Votre transporteur habituel est bloqué. Les expéditions s’arrêtent si rien n’est fait.',
    options: [
      { id: 'charter', label: 'Affréter un transporteur privé', detail: '11 000 € — les expéditions continuent.' },
      { id: 'wait',    label: 'Attendre la fin du conflit',     detail: 'Quai d’expédition bloqué 2 jours. Les contrats courent toujours.' },
    ],
    default: 'wait',
    apply(s, opt) {
      if (opt === 'charter') { spend(s, 11000, 'crises'); log(s, 'event', 'Transporteur privé affrété.'); }
      else { startWork(s, 'shipping', 'halt', 2); log(s, 'danger', 'Expéditions bloquées 2 jours.'); }
    },
  },
  {
    id: 'usedMachine',
    title: 'Ligne de packs batteries d’occasion',
    text: 'Une usine voisine liquide son matériel. Une ligne complète part à 28 000 € au lieu de 45 000 €, installation en 2 jours.',
    options: [
      { id: 'buy',  label: 'Saisir l’occasion', detail: 'Atelier Batteries au niveau supérieur pour 28 000 € et 2 jours de chantier.' },
      { id: 'pass', label: 'Passer son tour',        detail: 'Aucun effet.' },
    ],
    default: 'pass',
    apply(s, opt) {
      const b = s.buildings.batteries;
      if (opt !== 'buy') return log(s, 'event', 'Occasion déclinée.');
      if (b.level >= C.MAX_LEVEL) return log(s, 'event', 'L’atelier Batteries est déjà au niveau maximum.');
      if (b.work || b.broken) return log(s, 'event', 'L’atelier Batteries est indisponible : occasion perdue.');
      if (!canAfford(s, 28000)) return log(s, 'danger', 'Trésorerie insuffisante : occasion perdue.');
      spend(s, 28000, 'investissements');
      startWork(s, 'batteries', 'upgrade', 2, { toLevel: b.level + 1 });
      log(s, 'build', 'Ligne d’occasion achetée. Installation en 2 jours.');
    },
  },
];

const byId = Object.fromEntries(CRISES.map((c) => [c.id, c]));

/** Version envoyable au client : pas de fonction, pas d'effet lisible. */
const serialize = (def, s) => ({
  id: nextId('crisis'),
  defId: def.id,
  title: def.title,
  text: def.text,
  options: def.options,
  defaultOption: def.default,
  votes: { amont: null, aval: null },
  expiresAt: Date.now() + C.CRISIS_TTL_MS,
});

export function tick(s) {
  // Résolution d'une crise en cours.
  if (s.crisis) {
    const { amont, aval } = s.crisis.votes;
    if (amont && aval && amont === aval) return resolve(s, amont, 'accord');
    if (Date.now() >= s.crisis.expiresAt) {
      const agreed = amont && aval && amont === aval;
      return resolve(s, agreed ? amont : s.crisis.defaultOption, agreed ? 'accord' : 'défaut');
    }
    return;
  }

  // Déclenchement d'une nouvelle crise.
  if (s.day < s.nextCrisisDay) return;
  const def = CRISES[Math.floor(Math.random() * CRISES.length)];
  s.crisis = serialize(def, s);
  s.nextCrisisDay = s.day + Math.max(4, Math.round(C.CRISIS_INTERVAL_DAYS + (Math.random() - 0.5) * 6));
  log(s, 'crisis', `CRISE — ${def.title}. Décision commune sous ${Math.round(C.CRISIS_TTL_MS / 1000)} s.`);
}

/** Vote d'un joueur ; la résolution immédiate est gérée au tick suivant. */
export function vote(s, crisisId, division, optionId) {
  if (!s.crisis || s.crisis.id !== crisisId) return { ok: false, error: 'Crise déjà résolue.' };
  if (!s.crisis.options.some((o) => o.id === optionId)) return { ok: false, error: 'Option inconnue.' };
  s.crisis.votes[division] = optionId;

  const { amont, aval } = s.crisis.votes;
  if (amont && aval && amont === aval) resolve(s, amont, 'accord');
  return { ok: true };
}

function resolve(s, optionId, how) {
  const crisis = s.crisis;
  s.crisis = null;
  const def = byId[crisis.defId];
  const chosen = def.options.find((o) => o.id === optionId);
  log(s, 'crisis',
    how === 'accord'
      ? `Crise tranchée d'un commun accord : « ${chosen.label} ».`
      : `Pas d'accord à temps : l'option par défaut s'applique — « ${chosen.label} ».`);
  def.apply(s, optionId);
}
