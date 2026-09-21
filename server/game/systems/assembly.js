/**
 * assembly.js — La ligne d'assemblage (J2) : tampon → vélos à contrôler.
 *
 * Consomme un jeu complet de composants par vélo. Il suffit qu'UN des trois
 * manque pour que la ligne s'arrête, même si les deux autres débordent :
 * c'est ce qui rend le déséquilibre amont immédiatement visible.
 */
import * as C from '../constants.js';
import { effectiveCapacity, log } from '../state.js';

export function tick(s) {
  const b = s.buildings.assembly;
  const previous = b.bottleneck;
  const capacity = effectiveCapacity(s, 'assembly');

  if (capacity <= 0) {
    b.lastOutput = 0;
    b.load = 0;
    b.bottleneck = b.broken ? 'broken' : b.work ? 'work' : b.active ? null : 'stopped';
    return;
  }

  const byParts = Math.min(
    ...Object.entries(C.BIKE_RECIPE).map(([part, qty]) => Math.floor(s.buffer[part] / qty)),
  );
  const made = Math.max(0, Math.min(Math.floor(capacity), byParts));

  for (const [part, qty] of Object.entries(C.BIKE_RECIPE)) s.buffer[part] -= made * qty;
  s.bikesPending += made;
  s.stats.produced += made;

  b.lastOutput = made;
  b.load = made / capacity;
  b.bottleneck = made >= Math.floor(capacity) ? null : 'parts';

  // Comme pour l'amont : une seule ligne au basculement, pas une par jour.
  if (b.bottleneck !== previous) {
    if (b.bottleneck === 'parts') {
      const labels = { frames: 'cadres', batteries: 'batteries', motors: 'moteurs' };
      const missing = Object.keys(C.BIKE_RECIPE)
        .filter((part) => s.buffer[part] < 1)
        .map((part) => labels[part] ?? part);
      log(s, 'danger',
        missing.length
          ? `Assemblage à l'arrêt : plus de ${missing.join(' ni de ')} dans le tampon. Prévenez l'Industrie.`
          : 'Assemblage bridé : le tampon ne suit pas.',
        'aval');
    } else if (!b.bottleneck && previous) {
      log(s, 'success', 'La ligne d\u2019assemblage a repris sa cadence nominale.', 'aval');
    }
  }
}
