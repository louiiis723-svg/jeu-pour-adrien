/**
 * engine.js — Boucle de simulation.
 *
 * Un tick = un jour de jeu. L'ordre des systèmes n'est pas arbitraire : il
 * suit la chaîne physique, pour qu'une matière commandée, produite, assemblée
 * et expédiée le même jour soit impossible — chaque étape voit l'état laissé
 * par la précédente, comme dans une vraie usine.
 *
 * Pour ajouter un système (R&D, bourse, concurrence active…), il suffit de
 * l'insérer au bon endroit de SYSTEMS et de lui donner un `tick(state)`.
 */
import * as C from './constants.js';
import { companyValue, log } from './state.js';

import * as construction from './systems/construction.js';
import * as finance from './systems/finance.js';
import * as supply from './systems/supply.js';
import * as production from './systems/production.js';
import * as assembly from './systems/assembly.js';
import * as quality from './systems/quality.js';
import * as market from './systems/market.js';
import * as logistics from './systems/logistics.js';
import * as hr from './systems/hr.js';
import * as maintenance from './systems/maintenance.js';
import * as events from './systems/events.js';
import * as proposals from './systems/proposals.js';

/** L'ordre fait le jeu. Modifier avec précaution. */
const SYSTEMS = [
  ['chantiers',      construction],  // un chantier terminé libère le poste dès aujourd'hui
  ['finance',        finance],       // charges fixes et échéances, avant toute recette
  ['approvisionnt',  supply],        // les livraisons du jour arrivent au dépôt
  ['production',     production],    // ateliers amont → tampon
  ['assemblage',     assembly],      // tampon → vélos à contrôler
  ['qualité',        quality],       // tri : vendables / rebuts
  ['marché',         market],        // demande du jour, réputation, nouvelles offres
  ['logistique',     logistics],     // contrats d'abord, puis ventes spot
  ['RH',             hr],            // le moral réagit à la charge du jour
  ['maintenance',    maintenance],   // l'usure suit l'utilisation réelle
  ['événements',     events],        // crises
  ['propositions',   proposals],     // expirations
];

/**
 * Avance la partie d'un jour.
 * @returns {boolean} true si un jour a effectivement été simulé.
 */
export function tick(s) {
  if (s.phase !== 'running') return false;

  s.tickLog = [];
  for (const [, system] of SYSTEMS) system.tick(s);

  record(s);
  checkEnd(s);

  if (s.phase === 'running') s.day += 1;
  return true;
}

function record(s) {
  s.history.push({
    day: s.day,
    cash: Math.round(s.cash),
    value: companyValue(s),
    produced: s.buildings.assembly.lastOutput,
    shipped: s.buildings.shipping.lastOutput,
    bikes: s.bikes,
  });
  if (s.history.length > C.TARGET_DAYS + 5) s.history.shift();
}

function checkEnd(s) {
  if (s.negativeDays >= C.BANKRUPT_GRACE_DAYS) {
    return end(s, false, 'faillite',
      'Dépôt de bilan',
      `La trésorerie est restée sous ${C.BANKRUPT_CASH.toLocaleString('fr-FR')} € pendant ${C.BANKRUPT_GRACE_DAYS} jours. La banque a coupé les vivres.`);
  }
  if (s.day >= C.TARGET_DAYS) {
    const value = companyValue(s);
    const win = value >= C.OBJECTIVE_VALUE;
    return end(s, win, 'terme',
      win ? 'Objectif atteint' : 'Objectif manqué',
      win
        ? `Au bout de ${C.TARGET_DAYS} jours, l'entreprise vaut ${value.toLocaleString('fr-FR')} € — au-dessus de l'objectif de ${C.OBJECTIVE_VALUE.toLocaleString('fr-FR')} €.`
        : `Au bout de ${C.TARGET_DAYS} jours, l'entreprise vaut ${value.toLocaleString('fr-FR')} €, contre ${C.OBJECTIVE_VALUE.toLocaleString('fr-FR')} € visés.`);
  }
}

function end(s, win, reason, title, text) {
  s.phase = 'over';
  s.over = {
    win, reason, title, text,
    value: companyValue(s),
    objective: C.OBJECTIVE_VALUE,
    day: s.day,
    stats: { ...s.stats },
  };
  log(s, win ? 'success' : 'danger', `FIN DE PARTIE — ${title}.`);
}
