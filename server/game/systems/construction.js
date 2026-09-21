/**
 * construction.js — Chantiers : améliorations, révisions, réparations, arrêts.
 *
 * Un bâtiment en chantier ne produit rien. C'est le coût caché de toute
 * décision d'investissement, et la raison pour laquelle il faut la planifier
 * à deux : améliorer l'atelier Batteries en plein contrat urgent est fatal.
 */
import * as C from '../constants.js';
import { log } from '../state.js';

/** Démarre un chantier sur un bâtiment. Aucune vérification ici : voir actions.js. */
export function startWork(s, id, kind, days, extra = {}) {
  s.buildings[id].work = { kind, daysLeft: days, totalDays: days, ...extra };
}

export function tick(s) {
  for (const [id, b] of Object.entries(s.buildings)) {
    if (!b.work) continue;
    b.work.daysLeft -= 1;
    if (b.work.daysLeft > 0) continue;

    const { kind, toLevel } = b.work;
    b.work = null;
    const label = C.BUILDINGS[id].label;

    switch (kind) {
      case 'upgrade':
        b.level = toLevel;
        log(s, 'build',
          `${label} amélioré au niveau ${toLevel} (capacité ×${C.LEVEL_MULT[toLevel]}). Pensez à réajuster l'effectif.`);
        break;
      case 'service':
        b.wear = C.SERVICE_WEAR_LEFT;
        log(s, 'build', `${label} : révision terminée, usure remise à ${Math.round(C.SERVICE_WEAR_LEFT * 100)} %.`);
        break;
      case 'repair':
        b.broken = false;
        b.wear = Math.min(b.wear, 0.45);
        log(s, 'build', `${label} : réparation terminée, le poste redémarre.`);
        break;
      case 'halt':
        log(s, 'build', `${label} : reprise de l'activité.`);
        break;
      default:
        break;
    }
  }
}
