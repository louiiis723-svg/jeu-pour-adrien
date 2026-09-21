/**
 * hr.js — Moral des équipes, par division.
 *
 * Le moral est le lien entre les deux camps : il agit sur la cadence ET sur
 * le taux de défaut. Faire tourner une division à 100 % pendant deux semaines
 * finit par coûter plus cher que le poste qu'on a économisé.
 */
import * as C from '../constants.js';
import { log } from '../state.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Charge moyenne des postes productifs d'une division (0..1). */
export function divisionLoad(s, division) {
  const ids = Object.keys(C.BUILDINGS).filter(
    (id) => C.BUILDINGS[id].rate > 0 &&
      (C.BUILDINGS[id].owner === division ||
       (division === 'amont' && C.BUILDINGS[id].owner === 'shared')),
  );
  const active = ids.filter((id) => s.buildings[id].active && !s.buildings[id].broken);
  if (!active.length) return 0;
  return active.reduce((n, id) => n + s.buildings[id].load, 0) / active.length;
}

export function tick(s) {
  for (const division of ['amont', 'aval']) {
    const load = divisionLoad(s, division);
    let delta = load > C.MORALE_COMFORT_LOAD ? -C.MORALE_LOSS : C.MORALE_GAIN;
    if (s.cash < 0) delta -= C.MORALE_DEBT_LOSS;

    const before = s.morale[division];
    s.morale[division] = clamp(before + delta, C.MORALE_MIN, 1);

    // On n'alerte qu'au franchissement d'un seuil, pas à chaque tick.
    for (const threshold of [0.6, 0.45, 0.3]) {
      if (before >= threshold && s.morale[division] < threshold) {
        log(s, 'warn',
          `Moral de l'équipe ${division} sous ${Math.round(threshold * 100)} % — la cadence et la qualité en pâtissent.`,
          division);
      }
    }
  }
}

export const staffCost = (s) =>
  (s.staff.amont + s.staff.aval) * C.WAGE_PER_WORKER;
