/**
 * proposals.js — Double signature (mécanique B).
 *
 * Toute décision qui engage durablement l'entreprise devient une proposition :
 * elle s'affiche chez les deux joueurs, l'initiateur a déjà signé, l'autre
 * doit contresigner avant l'expiration. Aucun euro ne bouge tant que les deux
 * n'ont pas signé.
 *
 * Les exécuteurs sont enregistrés par actions.js, pour que ce fichier ne
 * connaisse rien des règles métier — on ajoute un type de proposition sans
 * toucher ici.
 */
import * as C from '../constants.js';
import { log, nextId } from '../state.js';

const executors = new Map();

/** @param {(state, payload) => void} fn */
export function registerExecutor(kind, fn) {
  executors.set(kind, fn);
}

/**
 * @param {object} spec
 * @param {string} spec.kind       clé d'exécuteur
 * @param {string} spec.title      libellé court
 * @param {string} spec.detail     phrase explicative affichée aux deux joueurs
 * @param {number} spec.cost       impact immédiat sur la trésorerie (0 si aucun)
 * @param {'amont'|'aval'} spec.initiator
 * @param {object} spec.payload    données transmises à l'exécuteur
 */
export function create(s, spec) {
  const p = {
    id: nextId('prop'),
    kind: spec.kind,
    title: spec.title,
    detail: spec.detail,
    cost: spec.cost ?? 0,
    initiator: spec.initiator,
    payload: spec.payload ?? {},
    votes: { amont: null, aval: null },
    expiresAt: Date.now() + C.PROPOSAL_TTL_MS,
  };
  p.votes[spec.initiator] = 'yes'; // proposer, c'est déjà signer
  s.proposals.push(p);
  log(s, 'proposal',
    `${spec.initiator === 'amont' ? 'L’Industrie' : 'Le Commerce'} propose : ${spec.title}. Contre-signature requise.`);
  return p;
}

/** @param {'yes'|'no'} choice */
export function vote(s, proposalId, division, choice) {
  const p = s.proposals.find((x) => x.id === proposalId);
  if (!p) return { ok: false, error: 'Cette proposition n’existe plus.' };

  p.votes[division] = choice;

  if (choice === 'no') {
    remove(s, p);
    log(s, 'proposal', `Proposition refusée : ${p.title}.`);
    return { ok: true, outcome: 'rejected' };
  }
  if (p.votes.amont === 'yes' && p.votes.aval === 'yes') {
    remove(s, p);
    execute(s, p);
    return { ok: true, outcome: 'approved' };
  }
  return { ok: true, outcome: 'pending' };
}

function execute(s, p) {
  const fn = executors.get(p.kind);
  if (!fn) {
    log(s, 'danger', `Proposition « ${p.title} » sans exécuteur — ignorée.`);
    return;
  }
  log(s, 'proposal', `Signé à deux : ${p.title}.`);
  fn(s, p.payload);
}

const remove = (s, p) => { s.proposals = s.proposals.filter((x) => x.id !== p.id); };

export function tick(s) {
  const now = Date.now();
  const expired = s.proposals.filter((p) => p.expiresAt <= now);
  for (const p of expired) {
    log(s, 'proposal', `Proposition expirée faute de contre-signature : ${p.title}.`);
  }
  if (expired.length) {
    s.proposals = s.proposals.filter((p) => p.expiresAt > now);
  }
}

/** Nettoie les propositions devenues sans objet (offre expirée, etc.). */
export function dropWhere(s, predicate) {
  s.proposals = s.proposals.filter((p) => !predicate(p));
}
