/**
 * layout.js — Plan du campus (grille isométrique).
 *
 * Le plan est construit autour d'une artère centrale horizontale (y = ROAD_Y).
 * Chaque bâtiment est posé au-dessus ou en dessous et rejoint l'artère par un
 * embranchement vertical. Conséquence : tous les trajets de véhicules sont des
 * L simples (bâtiment → embranchement → artère → embranchement → bâtiment),
 * ce qui évite tout pathfinding tout en donnant un trafic crédible.
 *
 * Coordonnées en tuiles. L'origine (0,0) est le coin « nord » de la grille iso.
 */

export const GRID_W = 22;
export const GRID_H = 11;
export const ROAD_Y = 5;

/** Frontière visuelle entre le territoire amont (J1) et aval (J2). */
export const FRONTIER_X = 13;

/**
 * footprint : { x, y, w, h } en tuiles.
 * side      : 'north' (au-dessus de l'artère) | 'south' (en dessous)
 */
export const PLOTS = {
  depot:     { x: 1,  y: 1, w: 3, h: 3, side: 'north' },
  batteries: { x: 5,  y: 1, w: 3, h: 3, side: 'north' },
  hq:        { x: 10, y: 1, w: 3, h: 3, side: 'north' },
  assembly:  { x: 14, y: 1, w: 3, h: 3, side: 'north' },
  shipping:  { x: 18, y: 1, w: 3, h: 3, side: 'north' },

  frames:    { x: 1,  y: 7, w: 3, h: 3, side: 'south' },
  motors:    { x: 5,  y: 7, w: 3, h: 3, side: 'south' },
  buffer:    { x: 10, y: 7, w: 3, h: 3, side: 'south' },
  quality:   { x: 14, y: 7, w: 3, h: 3, side: 'south' },
};

/** Centre d'un bâtiment, en coordonnées de tuile (flottantes). */
export function centerOf(id) {
  const p = PLOTS[id];
  return { x: p.x + p.w / 2 - 0.5, y: p.y + p.h / 2 - 0.5 };
}

/** Point de raccordement du bâtiment sur l'artère centrale. */
export function junctionOf(id) {
  return { x: centerOf(id).x, y: ROAD_Y };
}

/**
 * Trajet entre deux bâtiments : centre → embranchement → artère → centre.
 * `from` / `to` peuvent valoir 'WEST_GATE' / 'EAST_GATE' pour entrer ou
 * sortir de la carte (camions fournisseur et camions de livraison client).
 */
const GATES = {
  WEST_GATE: { x: -2, y: ROAD_Y },
  EAST_GATE: { x: GRID_W + 1, y: ROAD_Y },
};

export function routeBetween(from, to) {
  const path = [];
  const push = (p) => {
    const last = path[path.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) path.push(p);
  };

  if (GATES[from]) {
    push(GATES[from]);
  } else {
    push(centerOf(from));
    push(junctionOf(from));
  }

  if (GATES[to]) {
    push(GATES[to]);
  } else {
    push(junctionOf(to));
    push(centerOf(to));
  }
  return path;
}

/**
 * Les flux de matière du jeu, dans l'ordre de la chaîne.
 * Le moteur de rendu s'en sert pour faire circuler des véhicules dont le
 * nombre est proportionnel au débit réel simulé : ce qu'on voit rouler sur
 * la carte, c'est littéralement la production du jour.
 */
export const FLOWS = [
  { id: 'supply',    from: 'WEST_GATE', to: 'depot',    vehicle: 'truck', cargo: 'material' },
  { id: 'frames',    from: 'frames',    to: 'buffer',   vehicle: 'cart',  cargo: 'frames' },
  { id: 'batteries', from: 'batteries', to: 'buffer',   vehicle: 'cart',  cargo: 'batteries' },
  { id: 'motors',    from: 'motors',    to: 'buffer',   vehicle: 'cart',  cargo: 'motors' },
  { id: 'assembly',  from: 'buffer',    to: 'assembly', vehicle: 'cart',  cargo: 'mixed' },
  { id: 'quality',   from: 'assembly',  to: 'quality',  vehicle: 'cart',  cargo: 'bike' },
  { id: 'toShip',    from: 'quality',   to: 'shipping', vehicle: 'cart',  cargo: 'bike' },
  { id: 'dispatch',  from: 'shipping',  to: 'EAST_GATE', vehicle: 'truck', cargo: 'bike' },
];

/** Tuiles de route, pré-calculées : artère + embranchements. */
export function roadTiles() {
  const tiles = new Set();
  for (let x = 0; x < GRID_W; x++) tiles.add(`${x},${ROAD_Y}`);
  for (const id of Object.keys(PLOTS)) {
    const p = PLOTS[id];
    const cx = Math.round(centerOf(id).x);
    if (p.side === 'north') {
      for (let y = p.y + p.h; y <= ROAD_Y; y++) tiles.add(`${cx},${y}`);
    } else {
      for (let y = ROAD_Y; y < p.y; y++) tiles.add(`${cx},${y}`);
    }
  }
  return [...tiles].map((s) => {
    const [x, y] = s.split(',').map(Number);
    return { x, y };
  });
}
