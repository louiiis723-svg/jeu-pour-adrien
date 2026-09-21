/**
 * agents.js — Véhicules et flux de matière visibles.
 *
 * Principe : le nombre de véhicules en circulation sur chaque trajet est
 * proportionnel au DÉBIT RÉELLEMENT SIMULÉ. Ce qui roule sur la carte n'est
 * donc pas de la décoration — c'est la production du jour, rendue lisible.
 * Un atelier bloqué, et sa route se vide sous les yeux des deux joueurs.
 */
import { tileToScreen } from './iso.js';
import { lerpPt } from './sprites.js';

/** Combien d'unités transporte un véhicule, par type de flux. */
const PAYLOAD = {
  supply: 42, frames: 7, batteries: 7, motors: 7,
  assembly: 7, quality: 7, toShip: 7, dispatch: 9,
};
const SPEED = { truck: 2.9, cart: 3.6 };   // tuiles par seconde
const MAX_PER_FLOW = 7;

const CARGO_COLORS = {
  material: '#8b9bb4',
  frames: '#7dd3fc',
  batteries: '#5eead4',
  motors: '#fca5a5',
  mixed: '#c4b5fd',
  bike: '#f5a524',
};

/**
 * Débit du jour associé à chaque flux, lu dans la projection serveur.
 * C'est le seul endroit qui relie la simulation au rendu.
 */
function throughput(flowId, view) {
  const b = view.buildings;
  switch (flowId) {
    // Approvisionnement : proxy sur la consommation des trois ateliers.
    case 'supply':    return (b.frames.lastOutput + b.batteries.lastOutput + b.motors.lastOutput) * 1.6;
    case 'frames':    return b.frames.lastOutput;
    case 'batteries': return b.batteries.lastOutput;
    case 'motors':    return b.motors.lastOutput;
    case 'assembly':  return b.assembly.lastOutput;
    case 'quality':   return b.assembly.lastOutput;
    case 'toShip':    return b.quality.lastOutput;
    case 'dispatch':  return b.shipping.lastOutput;
    default:          return 0;
  }
}

export class AgentSystem {
  /** @param {object} layout payload de plan renvoyé par le serveur */
  constructor(layout, tickMs) {
    this.tickSeconds = Math.max(0.5, (tickMs ?? 2500) / 1000);
    this.flows = layout.flows.map((f) => ({
      ...f,
      metrics: measure(f.path),
      accumulator: 0,
    }));
    this.agents = [];
  }

  /** @param {object} view dernière projection reçue, ou null */
  update(dt, view) {
    for (const flow of this.flows) {
      const out = view ? throughput(flow.id, view) : 0;
      // Véhicules par seconde = (unités/jour) / (unités par véhicule) / (durée d'un jour)
      const rate = out > 0 ? out / PAYLOAD[flow.id] / this.tickSeconds : 0;
      const onRoute = this.agents.filter((a) => a.flow === flow.id).length;

      flow.accumulator += rate * dt;
      while (flow.accumulator >= 1) {
        flow.accumulator -= 1;
        if (onRoute + 1 <= MAX_PER_FLOW) this.spawn(flow);
      }
      if (rate === 0) flow.accumulator = Math.min(flow.accumulator, 0.9);
    }

    for (const a of this.agents) {
      a.u += (a.speed * dt) / a.length;
      a.bob += dt * 7;
    }
    this.agents = this.agents.filter((a) => a.u < 1);
  }

  spawn(flow) {
    this.agents.push({
      flow: flow.id,
      path: flow.path,
      metrics: flow.metrics,
      length: flow.metrics.totalTiles,
      u: 0,
      bob: Math.random() * 6,
      speed: SPEED[flow.vehicle] ?? 3,
      vehicle: flow.vehicle,
      cargo: CARGO_COLORS[flow.cargo] ?? '#9aa3af',
    });
  }

  /** Position courante d'un agent, en coordonnées de tuile. */
  positionOf(a) {
    return pointAt(a.path, a.metrics, a.u);
  }

  /** Agents triés en profondeur, prêts à être fusionnés avec les bâtiments. */
  renderables() {
    return this.agents.map((a) => {
      const p = this.positionOf(a);
      return { kind: 'agent', agent: a, tile: p, depth: p.x + p.y + 0.35 };
    });
  }
}

/** Longueurs de segments, mesurées en ÉCRAN pour une vitesse apparente stable. */
function measure(path) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = tileToScreen(path[i].x, path[i].y);
    const b = tileToScreen(path[i + 1].x, path[i + 1].y);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 0.001;
    segs.push(len);
    total += len;
  }
  return { segs, total, totalTiles: total / 32 };
}

/** Interpolation le long de la polyligne, en coordonnées de tuile. */
function pointAt(path, metrics, u) {
  const target = Math.max(0, Math.min(1, u)) * metrics.total;
  let walked = 0;
  for (let i = 0; i < metrics.segs.length; i++) {
    if (walked + metrics.segs[i] >= target) {
      const t = (target - walked) / metrics.segs[i];
      return lerpPt(path[i], path[i + 1], t);
    }
    walked += metrics.segs[i];
  }
  return path[path.length - 1];
}

/** Dessine un véhicule à sa position, en vue isométrique. */
export function drawAgent(ctx, a, tile) {
  const p = tileToScreen(tile.x, tile.y);
  const bob = Math.sin(a.bob) * 0.7;
  const y = p.y + bob;
  const big = a.vehicle === 'truck';
  const w = big ? 11 : 7;
  const d = big ? 6 : 4;
  const h = big ? 9 : 6;

  // Ombre au sol.
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#04060a';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, w * 1.05, d * 0.75, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const box = (cx, cy, bw, bd, bh, top, right, left) => {
    quad(ctx, [{ x: cx, y: cy - bh - bd }, { x: cx + bw, y: cy - bh },
               { x: cx, y: cy - bh + bd }, { x: cx - bw, y: cy - bh }], top);
    quad(ctx, [{ x: cx, y: cy - bh + bd }, { x: cx + bw, y: cy - bh },
               { x: cx + bw, y: cy }, { x: cx, y: cy + bd }], right);
    quad(ctx, [{ x: cx, y: cy - bh + bd }, { x: cx - bw, y: cy - bh },
               { x: cx - bw, y: cy }, { x: cx, y: cy + bd }], left);
  };

  box(p.x, y, w, d, h, '#2f3944', '#222a33', '#1a2027');
  // Chargement coloré : on voit CE QUI circule, pas juste qu'il circule.
  box(p.x, y - h - 1, w * 0.62, d * 0.62, 5, a.cargo, shadeHex(a.cargo, 0.66), shadeHex(a.cargo, 0.45));

  if (big) {
    ctx.fillStyle = 'rgba(255,220,150,.75)';
    ctx.fillRect(p.x + w - 3, y - h + 1, 3, 2);
  }
}

function quad(ctx, pts, color) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function shadeHex(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}
