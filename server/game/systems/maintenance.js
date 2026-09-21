/**
 * maintenance.js — Usure et pannes.
 *
 * L'usure est le piège classique du tycoon : invisible tant qu'elle ne mord
 * pas, puis elle coûte de la capacité, de la qualité, et finit par casser au
 * pire moment. Ici elle est délibérément visible pour J1 SEULEMENT sur ses
 * bâtiments, et pour J2 sur les siens — aucun des deux n'a la vue complète.
 */
import * as C from '../constants.js';
import { log } from '../state.js';

export function tick(s) {
  for (const [id, b] of Object.entries(s.buildings)) {
    const def = C.BUILDINGS[id];
    if (!def.rate) continue;
    if (b.work || b.broken || !b.active) continue;

    // Un poste qui tourne à vide s'use quand même un peu (40 % de l'usure).
    b.wear = Math.min(1, b.wear + C.WEAR_PER_DAY * (0.4 + 0.6 * b.load));

    // Risque de panne, nul en dessous du plancher puis linéaire.
    const risk = Math.max(0, b.wear - C.BREAKDOWN_WEAR_FLOOR) * C.BREAKDOWN_SLOPE;
    if (risk > 0 && Math.random() < risk) {
      b.broken = true;
      b.lastOutput = 0;
      b.load = 0;
      b.bottleneck = 'broken';
      log(s, 'danger',
        `PANNE : ${def.label} est à l'arrêt (usure ${Math.round(b.wear * 100)} %). Réparation : ${C.REPAIR_COST.toLocaleString('fr-FR')} € et ${C.REPAIR_DAYS} jours.`);
    }
  }
}
