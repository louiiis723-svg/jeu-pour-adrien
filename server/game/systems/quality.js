/**
 * quality.js — Contrôle qualité : vélos assemblés → vélos vendables + rebuts.
 *
 * Le taux de défaut est la facture différée de trois décisions prises
 * ailleurs, souvent par l'autre joueur :
 *   · la qualité du fournisseur choisi par J1, plusieurs jours plus tôt
 *   · l'usure de la ligne d'assemblage, que J2 a peut-être négligé d'entretenir
 *   · le moral de l'équipe aval, dégradé par la surcharge
 */
import * as C from '../constants.js';
import { effectiveCapacity, log } from '../state.js';
import { earn } from './finance.js';

/** Taux de défaut du jour, décomposé pour être affichable au joueur. */
export function defectBreakdown(s) {
  const wear = s.buildings.assembly.wear;
  const morale = s.morale.aval;
  const fromWear = wear * C.DEFECT_FROM_WEAR;
  const fromMorale = Math.max(0, 0.7 - morale) * C.DEFECT_FROM_MORALE;
  const fromSupplier = (1 - s.matQuality) * C.DEFECT_FROM_SUPPLIER;
  const total = Math.min(0.6, C.DEFECT_BASE + fromWear + fromMorale + fromSupplier);
  return { base: C.DEFECT_BASE, fromWear, fromMorale, fromSupplier, total };
}

export function tick(s) {
  const b = s.buildings.quality;
  const capacity = effectiveCapacity(s, 'quality');

  if (capacity <= 0) {
    b.lastOutput = 0;
    b.load = 0;
    b.bottleneck = b.broken ? 'broken' : b.work ? 'work' : b.active ? null : 'stopped';
    return;
  }

  const checked = Math.min(Math.floor(capacity), s.bikesPending);
  const rate = defectBreakdown(s).total;
  const defects = Math.round(checked * rate);
  const passed = checked - defects;

  s.bikesPending -= checked;
  s.bikes += passed;
  s.stats.scrapped += defects;

  // Les rebuts sont partiellement revalorisés en ferraille.
  if (defects > 0) {
    const recovered = Math.round(defects * C.BIKE_MATERIAL_COST * C.SCRAP_RECOVERY);
    earn(s, recovered, 'revalorisation rebuts');
    if (rate > 0.09) {
      log(s, 'warn',
        `Contrôle qualité : ${defects} vélo(s) rebutés sur ${checked} (${(rate * 100).toFixed(1)} % de défauts).`,
        'aval');
    }
  }

  b.lastOutput = passed;
  b.load = checked / capacity;
  b.bottleneck = s.bikesPending > 0 ? 'backlog' : null;
}
