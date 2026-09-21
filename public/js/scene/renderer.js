/**
 * renderer.js — Boucle de rendu de la scène isométrique.
 *
 * Ordre de composition, du fond vers l'avant :
 *   1. ciel / vignettage (espace écran)
 *   2. sol : plaques de territoire, quadrillage, frontière
 *   3. voirie
 *   4. bâtiments ET véhicules, FUSIONNÉS puis triés en profondeur
 *      (sans cette fusion, un camion passerait toujours devant ou toujours
 *       derrière un bâtiment, ce qui casse immédiatement l'illusion 3D)
 *   5. fumées
 *   6. voile de nuit
 *   7. étiquettes et badges (espace écran, pour un texte net)
 */
import { Camera, screenToGrid, footprintCorners } from './iso.js';
import { drawGround, drawRoads, drawBuilding, heightOf } from './sprites.js';
import { AgentSystem, drawAgent } from './agents.js';
import { EffectSystem } from './effects.js';

/** Durée d'un cycle jour/nuit complet, en jours de jeu. */
const DAY_CYCLE = 16;
/** Opacité maximale du voile nocturne. Au-delà, la scène devient illisible
 *  et le joueur perd de vue ce qui tourne ou pas — l'ambiance ne doit jamais
 *  coûter de la lecture. */
const NIGHT_MAX = 0.26;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = new Camera();
    this.layout = null;
    this.view = null;
    this.agents = null;
    this.effects = new EffectSystem();

    this.selected = null;
    this.hovered = null;
    this.onSelect = () => {};

    this.time = 0;
    this.dayAnchor = { day: 1, at: performance.now() };
    this.tickMs = 2500;
    this.fitted = false;
    this.running = false;

    this._bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Le canvas est encore masqué quand ce module se charge : sa taille vaut
    // alors zéro. Un ResizeObserver garantit qu'on la remesure dès qu'il
    // apparaît, sans quoi la scène serait rendue dans un buffer de 1×1 pixel
    // et le clic de sélection ne toucherait jamais rien.
    if (typeof ResizeObserver !== 'undefined') {
      this._observer = new ResizeObserver(() => this.resize());
      this._observer.observe(canvas);
    }
  }

  init(layout, rules) {
    this.layout = layout;
    this.tickMs = rules?.tickMs ?? 2500;
    this.agents = new AgentSystem(layout, this.tickMs);
    this.fitted = false;
  }

  setView(view) {
    if (this.view && view.day !== this.view.day) {
      this.dayAnchor = { day: view.day, at: performance.now() };
    } else if (!this.view) {
      this.dayAnchor = { day: view.day, at: performance.now() };
    }
    this.view = view;
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.time += dt;
      this._update(dt);
      this._draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop() { this.running = false; }

  recenter() {
    if (!this.layout) return;
    this.camera.fit(this.layout.gridW, this.layout.gridH, this.w, this.h);
  }

  // ── Interne ──────────────────────────────────────────────

  /** Remesure le canvas et réaligne le buffer sur la densité d'écran. */
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    if (this.layout && this.fitted) this.recenter();
  }

  _update(dt) {
    if (!this.layout) return;
    if (!this.fitted && this.w > 10) { this.recenter(); this.fitted = true; }
    this.agents?.update(dt, this.view);
    this.effects.update(dt, this.view, this.layout);
  }

  /** Progression fractionnaire du jour, pour une nuit qui tombe en continu. */
  get dayFloat() {
    const elapsed = (performance.now() - this.dayAnchor.at) / this.tickMs;
    return this.dayAnchor.day + Math.max(0, Math.min(1, elapsed));
  }

  get night() {
    const phase = (this.dayFloat % DAY_CYCLE) / DAY_CYCLE;
    return (1 - Math.cos(phase * Math.PI * 2)) / 2;
  }

  _draw() {
    const { ctx } = this;
    const night = this.night;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    // 1. Ciel
    const sky = ctx.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, night > 0.5 ? '#070b13' : '#0c131c');
    sky.addColorStop(1, '#06070c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.w, this.h);
    if (!this.layout) return;

    this.camera.apply(ctx, this.w, this.h, this.dpr);

    // 2-3. Sol et voirie
    drawGround(ctx, this.layout);
    drawRoads(ctx, this.layout.roads);

    // 4. Bâtiments + véhicules, triés ensemble
    const items = [];
    for (const [id, plot] of Object.entries(this.layout.plots)) {
      const info = this.view?.buildings?.[id];
      items.push({
        kind: 'building', id, plot, info,
        depth: plot.x + plot.w / 2 + plot.y + plot.h / 2,
      });
    }
    if (this.agents) items.push(...this.agents.renderables());
    items.sort((a, b) => a.depth - b.depth);

    for (const it of items) {
      if (it.kind === 'agent') {
        drawAgent(ctx, it.agent, it.tile);
      } else {
        const meta = this.layout.labels[it.id];
        drawBuilding(ctx, {
          plot: it.plot,
          kind: meta.kind,
          owner: meta.owner,
          info: it.info,
          night,
          time: this.time,
          selected: this.selected === it.id,
          extra: this._extraFor(it.id),
        });
      }
    }

    // 5. Fumées
    this.effects.draw(ctx);

    // 6. Voile de nuit
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (night > 0.02) {
      ctx.fillStyle = `rgba(8,13,26,${(night * NIGHT_MAX).toFixed(3)})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    // 7. Étiquettes
    this._drawLabels();
  }

  /** Données de remplissage propres à certains bâtiments (silos, caisses). */
  _extraFor(id) {
    const v = this.view;
    if (!v) return null;
    if (id === 'buffer') {
      const cap = Math.max(1, v.buffer.capacity);
      return { fills: [v.buffer.frames / cap, v.buffer.batteries / cap, v.buffer.motors / cap] };
    }
    if (id === 'depot') {
      // Seule la Direction Industrielle reçoit le détail des stocks : sur
      // l'écran de l'autre, les silos restent volontairement opaques.
      if (!v.amont) return null;
      const m = v.amont.materials;
      const cap = Math.max(1, v.amont.depotCapacity / 3);
      return { ratios: [m.alu / cap, m.cells / (cap * 1.6), m.elec / (cap * 0.5)] };
    }
    return null;
  }

  /** Monde → écran, pour poser du texte net par-dessus la scène. */
  _project(wx, wy) {
    return {
      x: (wx - this.camera.x) * this.camera.zoom + this.w / 2,
      y: (wy - this.camera.y) * this.camera.zoom + this.h / 2,
    };
  }

  _drawLabels() {
    const { ctx } = this;
    if (!this.view) return;
    const showNames = this.camera.zoom > 0.62;

    for (const [id, plot] of Object.entries(this.layout.plots)) {
      const info = this.view.buildings[id];
      const meta = this.layout.labels[id];
      if (!info) continue;

      const corners = footprintCorners(plot.x, plot.y, plot.w, plot.h);
      const topWorld = {
        x: (corners[0].x + corners[2].x) / 2,
        y: corners[0].y - heightOf(meta.kind, info.level) - 24,
      };
      const p = this._project(topWorld.x, topWorld.y);
      if (p.x < -120 || p.x > this.w + 120 || p.y < -50 || p.y > this.h + 50) continue;

      const badge = badgeFor(info);
      const name = meta.label;

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (badge) {
        ctx.font = '600 10px ui-monospace, monospace';
        const w = ctx.measureText(badge.text).width + 14;
        roundRect(ctx, p.x - w / 2, p.y - 9, w, 17, 4);
        ctx.fillStyle = badge.bg; ctx.fill();
        ctx.fillStyle = badge.fg;
        ctx.fillText(badge.text, p.x, p.y);
      }

      if (showNames) {
        const dy = badge ? 15 : 0;
        const focus = this.selected === id || this.hovered === id;
        ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
        // Un bâtiment peut passer derrière l'étiquette d'un autre : sans ce
        // fond, le nom devient illisible dès que la carte se remplit.
        const tw = ctx.measureText(name).width;
        roundRect(ctx, p.x - tw / 2 - 5, p.y + dy - 8, tw + 10, 16, 4);
        ctx.fillStyle = focus ? 'rgba(12,15,20,.9)' : 'rgba(10,12,16,.62)';
        ctx.fill();
        ctx.fillStyle = focus ? 'rgba(236,239,243,.98)' : 'rgba(214,219,227,.72)';
        ctx.fillText(name, p.x, p.y + dy);
      }
    }
  }

  // ── Interaction ──────────────────────────────────────────

  _bindInput() {
    const c = this.canvas;
    let dragging = false, moved = 0, lastX = 0, lastY = 0;

    c.addEventListener('pointerdown', (e) => {
      dragging = true; moved = 0;
      lastX = e.clientX; lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });

    c.addEventListener('pointermove', (e) => {
      const rect = c.getBoundingClientRect();
      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        this.camera.pan(dx, dy);
        lastX = e.clientX; lastY = e.clientY;
      } else {
        this.hovered = this._pick(e.clientX - rect.left, e.clientY - rect.top);
      }
    });

    const release = (e) => {
      if (!dragging) return;
      dragging = false;
      c.classList.remove('dragging');
      // En dessous de ce seuil, on considère que c'était un clic, pas un glisser.
      if (moved < 5) {
        const rect = c.getBoundingClientRect();
        const hit = this._pick(e.clientX - rect.left, e.clientY - rect.top);
        this.selected = hit;
        this.onSelect(hit);
      }
    };
    c.addEventListener('pointerup', release);
    c.addEventListener('pointercancel', () => { dragging = false; c.classList.remove('dragging'); });

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      this.camera.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12,
        e.clientX - rect.left, e.clientY - rect.top, this.w, this.h);
    }, { passive: false });
  }

  /**
   * Désignation d'un bâtiment sous le curseur.
   * On teste d'abord l'emprise au sol, puis l'emprise « remontée » de la
   * hauteur du bâtiment : sans ce second test, cliquer sur une toiture ne
   * sélectionnerait rien.
   */
  _pick(sx, sy) {
    if (!this.layout) return null;
    const world = this.camera.toWorld(sx, sy, this.w, this.h);

    const entries = Object.entries(this.layout.plots)
      .sort((a, b) => (b[1].x + b[1].y) - (a[1].x + a[1].y)); // de l'avant vers l'arrière

    for (const [id, plot] of entries) {
      const meta = this.layout.labels[id];
      const h = heightOf(meta.kind, this.view?.buildings?.[id]?.level ?? 1);
      for (const dz of [0, h]) {
        const g = screenToGrid(world.x, world.y + dz);
        if (g.x >= plot.x && g.x <= plot.x + plot.w &&
            g.y >= plot.y && g.y <= plot.y + plot.h) return id;
      }
    }
    return null;
  }
}

function badgeFor(info) {
  if (info.broken) return { text: 'PANNE', bg: 'rgba(248,113,113,.9)', fg: '#160607' };
  if (info.work) {
    const label = { upgrade: 'CHANTIER', service: 'RÉVISION', repair: 'RÉPARATION', halt: 'ARRÊT' }[info.work.kind] ?? 'TRAVAUX';
    return { text: `${label} J-${info.work.daysLeft}`, bg: 'rgba(96,165,250,.88)', fg: '#04101f' };
  }
  if (!info.active) return { text: 'À L’ARRÊT', bg: 'rgba(100,109,122,.85)', fg: '#0a0c0f' };
  if (info.lastOutput > 0) return { text: `${info.lastOutput}/j`, bg: 'rgba(11,13,17,.8)', fg: '#c8cdd6' };
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
