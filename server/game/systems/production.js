/**
 * production.js — Les trois ateliers amont (J1) qui alimentent le tampon.
 *
 * Trois plafonds possibles, et le jeu dit toujours lequel a mordu :
 *   1. la capacité du poste       (effectif, usure, moral, niveau)
 *   2. les matières disponibles   (le dépôt est vide)
 *   3. la place dans le tampon    (l'aval ne consomme pas assez vite)
 *
 * Le cas 3 est le cœur de la coopération : J1 se bloque tout seul s'il
 * produit plus vite que J2 ne consomme.
 *
 * Les ateliers sont servis dans l'ordre ci-dessous. Cadres et Motorisation
 * puisent tous deux dans l'aluminium : en cas de pénurie, le premier servi
 * prend tout. J1 peut arbitrer en mettant un atelier à l'arrêt.
 */
import * as C from '../constants.js';
import { effectiveCapacity, bufferCapacity, log } from '../state.js';

const WORKSHOPS = ['frames', 'batteries', 'motors'];

export function tick(s) {
  const cap = bufferCapacity(s);

  for (const id of WORKSHOPS) {
    const b = s.buildings[id];
    const out = C.BUILDINGS[id].output;
    const recipe = C.RECIPES[out];

    const previous = b.bottleneck;
    const capacity = effectiveCapacity(s, id);
    if (capacity <= 0) {
      b.lastOutput = 0;
      b.load = 0;
      b.bottleneck = b.broken ? 'broken' : b.work ? 'work' : b.active ? null : 'stopped';
      continue;
    }

    // Plafond matières : la matière la plus rare décide.
    const byMaterials = Math.min(
      ...Object.entries(recipe).map(([mat, qty]) => Math.floor(s.materials[mat] / qty)),
    );
    // Plafond tampon : ce qu'il reste comme place pour ce composant.
    const byBuffer = Math.max(0, cap - s.buffer[out]);

    const made = Math.max(0, Math.min(Math.floor(capacity), byMaterials, byBuffer));

    for (const [mat, qty] of Object.entries(recipe)) s.materials[mat] -= made * qty;
    s.buffer[out] += made;

    b.lastOutput = made;
    b.load = capacity > 0 ? made / capacity : 0;
    b.bottleneck =
      made >= Math.floor(capacity) ? null
      : byBuffer <= byMaterials ? 'bufferFull'
      : 'materials';

    // On ne journalise qu'au FRANCHISSEMENT d'un seuil. Répéter l'alerte à
    // chaque jour de blocage noierait le journal et masquerait les
    // informations réellement nouvelles.
    if (b.bottleneck !== previous) {
      if (b.bottleneck === 'bufferFull') {
        log(s, 'warn',
          `${C.BUILDINGS[id].label} bridé : le tampon est plein (${s.buffer[out]}/${cap}). L'aval ne consomme pas assez vite.`,
          'amont');
      } else if (b.bottleneck === 'materials') {
        const missing = Object.entries(recipe)
          .filter(([mat, qty]) => s.materials[mat] < qty)
          .map(([mat]) => C.MATERIALS[mat].label.toLowerCase());
        log(s, 'danger',
          `${C.BUILDINGS[id].label} à l'arrêt : plus de ${missing.join(', ') || 'matière'}.`, 'amont');
      } else if (!b.bottleneck && previous) {
        log(s, 'success', `${C.BUILDINGS[id].label} a repris sa cadence nominale.`, 'amont');
      }
    }
  }
}
