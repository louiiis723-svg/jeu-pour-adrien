/**
 * effects.js — Fumées et particules d'ambiance.
 *
 * Même règle que pour les véhicules : un atelier ne fume que s'il produit
 * réellement. L'ambiance est un instrument de lecture, pas un décor.
 */
import { footprintCorners } from './iso.js';
import { lerpPt, heightOf } from './sprites.js';

const MAX_PARTICLES = 220;

export class EffectSystem {
  constructor() {
    this.particles = [];
    this.emitAcc = new Map();
  }

  /**
   * @param {number} dt      secondes écoulées
   * @param {object} view    projection serveur
   * @param {object} layout  plan du campus
   */
  update(dt, view, layout) {
    for (const p of this.particles) {
      p.life -= dt;
      p.y -= p.vy * dt;
      p.x += p.vx * dt;
      p.size += p.grow * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    if (!view) return;

    for (const id of ['frames', 'batteries', 'motors', 'assembly']) {
      const info = view.buildings[id];
      const plot = layout.plots[id];
      if (!info || !plot) continue;

      const producing = info.active && !info.broken && !info.work && (info.load ?? 0) > 0.03;
      const rate = producing ? 1.1 + info.load * 2.4 : 0;

      const acc = (this.emitAcc.get(id) ?? 0) + rate * dt;
      let n = Math.floor(acc);
      this.emitAcc.set(id, acc - n);
      if (this.particles.length + n > MAX_PARTICLES) n = 0;

      while (n-- > 0) this.emitSmoke(plot, view.buildings[id].level ?? 1);
    }
  }

  emitSmoke(plot, level) {
    const roof = footprintCorners(plot.x, plot.y, plot.w, plot.h)
      .map((p) => ({ x: p.x, y: p.y - heightOf('workshop', level) }));
    // Même repère que la cheminée dessinée dans sprites.js.
    const base = lerpPt(lerpPt(roof[0], roof[1], 0.76), lerpPt(roof[3], roof[2], 0.76), 0.2);
    this.particles.push({
      x: base.x + (Math.random() - 0.5) * 3,
      y: base.y - 24,
      vx: 5 + Math.random() * 7,
      vy: 13 + Math.random() * 9,
      size: 3 + Math.random() * 2,
      grow: 5,
      life: 1.7 + Math.random() * 1.1,
      maxLife: 2.8,
    });
  }

  draw(ctx) {
    ctx.save();
    for (const p of this.particles) {
      const t = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = t * 0.26;
      ctx.fillStyle = '#c9d4e0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
