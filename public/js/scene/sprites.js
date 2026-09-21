/**
 * sprites.js — Dessin procédural du campus.
 *
 * Aucun asset externe : tout est construit à partir de losanges isométriques
 * extrudés. Avantage concret — la taille, la couleur et le niveau de détail
 * de chaque bâtiment sont des paramètres, donc l'usine peut grandir
 * visuellement sans qu'on ait à produire une seule image.
 *
 * Le vocabulaire visuel est volontairement industriel et sobre :
 *   · territoire amont teinté cyan, aval teinté ambre, partagé violet
 *   · un bâtiment qui produit s'éclaire et fume ; à l'arrêt il s'éteint
 *   · une panne cercle le bâtiment de rouge, un chantier l'entoure d'échafaudages
 */
import { gridToScreen, footprintCorners } from './iso.js';

export const PALETTES = {
  amont:  { roof: '#3a5468', right: '#263b4c', left: '#1a2a37', trim: '#22d3ee', glow: 'rgba(34,211,238,' },
  aval:   { roof: '#5b4c33', right: '#3f3524', left: '#2c2519', trim: '#f5a524', glow: 'rgba(245,165,36,' },
  shared: { roof: '#453e5e', right: '#312b44', left: '#241f32', trim: '#a78bfa', glow: 'rgba(167,139,250,' },
};

/** Hauteur d'extrusion, en pixels, par type de bâtiment et par niveau. */
const HEIGHTS = { workshop: 56, storage: 48, buffer: 20, office: 82, logistics: 44 };
export const heightOf = (kind, level = 1) => (HEIGHTS[kind] ?? 36) * (1 + (level - 1) * 0.16);

const poly = (ctx, pts) => {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
};
const fill = (ctx, pts, color) => { poly(ctx, pts); ctx.fillStyle = color; ctx.fill(); };
const up = (p, dz) => ({ x: p.x, y: p.y - dz });

// ═════════════════════════════════════════════════════════════
// Sol
// ═════════════════════════════════════════════════════════════

/** Plaque de territoire + quadrillage discret. */
export function drawGround(ctx, layout) {
  const { gridW, gridH, frontierX } = layout;

  // Deux plaques teintées, séparées à la frontière.
  const plate = (x0, w, color, edge) => {
    const pts = footprintCorners(x0, 0, w, gridH);
    fill(ctx, pts, color);
    poly(ctx, pts);
    ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
  };
  plate(0, frontierX, '#0c1116', 'rgba(34,211,238,.13)');
  plate(frontierX, gridW - frontierX, '#120f0b', 'rgba(245,165,36,.13)');

  // Quadrillage : une ligne par tuile, très atténuée.
  ctx.strokeStyle = 'rgba(255,255,255,.028)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= gridW; i++) {
    const a = gridToScreen(i, 0), b = gridToScreen(i, gridH);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  for (let j = 0; j <= gridH; j++) {
    const a = gridToScreen(0, j), b = gridToScreen(gridW, j);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  // Ligne de frontière : la couture entre les deux responsabilités.
  const f0 = gridToScreen(frontierX, 0), f1 = gridToScreen(frontierX, gridH);
  ctx.save();
  ctx.setLineDash([7, 6]);
  ctx.strokeStyle = 'rgba(167,139,250,.35)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(f0.x, f0.y); ctx.lineTo(f1.x, f1.y); ctx.stroke();
  ctx.restore();
}

/** Voirie : artère centrale et embranchements. */
export function drawRoads(ctx, roads) {
  for (const { x, y } of roads) {
    const pts = footprintCorners(x, y, 1, 1);
    fill(ctx, pts, '#161a1f');
  }
  // Marquage central sur l'artère, tuile par tuile.
  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([9, 9]);
  ctx.beginPath();
  for (const { x, y } of roads) {
    const a = gridToScreen(x, y + 0.5), b = gridToScreen(x + 1, y + 0.5);
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

// ═════════════════════════════════════════════════════════════
// Bâtiments
// ═════════════════════════════════════════════════════════════

/**
 * @param {object} o
 * @param {{x,y,w,h}} o.plot     emprise en tuiles
 * @param {string} o.kind        workshop | storage | buffer | office | logistics
 * @param {string} o.owner       amont | aval | shared
 * @param {object} o.info        projection serveur du bâtiment
 * @param {number} o.night       0 (plein jour) → 1 (nuit)
 * @param {number} o.time        horloge d'animation, en secondes
 * @param {object} o.extra       données de remplissage (silos, caisses…)
 * @param {boolean} o.selected
 */
export function drawBuilding(ctx, o) {
  const { plot, kind, owner, info, night, time, selected } = o;
  const pal = PALETTES[owner] ?? PALETTES.shared;
  const h = heightOf(kind, info?.level ?? 1);

  const active = info && !info.broken && info.active && !info.work;
  const producing = active && (info.load ?? 0) > 0.02;

  drawShadow(ctx, plot);

  if (kind === 'buffer') drawYard(ctx, o, pal);
  else drawPrism(ctx, plot, h, pal, { dim: !active });

  const roof = footprintCorners(plot.x, plot.y, plot.w, plot.h).map((p) => up(p, h));

  switch (kind) {
    case 'workshop':  detailWorkshop(ctx, plot, h, roof, pal, { producing, night, time }); break;
    case 'storage':   detailStorage(ctx, plot, h, roof, pal, o.extra, night); break;
    case 'office':    detailOffice(ctx, plot, h, pal, night, time); break;
    case 'logistics': detailLogistics(ctx, plot, h, roof, pal, night); break;
    default: break;
  }

  if (kind !== 'buffer') drawLevelPips(ctx, roof, info?.level ?? 1, pal);
  // L'anneau se pose sur la TOITURE : tracé au sol, il se confondait avec le
  // marquage de voirie et semblait flotter devant le bâtiment.
  if (info?.broken) drawAlertRing(ctx, plot, h, time, '#f87171');
  else if (info?.status === 'degraded') drawAlertRing(ctx, plot, h, time, '#fbbf24', 0.55);
  if (info?.work) drawScaffolding(ctx, plot, h, info.work, time);
  if (selected) drawSelection(ctx, plot);
}

/** Ombre portée au sol : donne l'assise, sinon tout flotte. */
function drawShadow(ctx, plot) {
  const pts = footprintCorners(plot.x + 0.08, plot.y + 0.08, plot.w, plot.h);
  ctx.save();
  ctx.globalAlpha = 0.5;
  fill(ctx, pts, '#04060a');
  ctx.restore();
}

/** Volume principal : deux faces visibles + toiture. */
function drawPrism(ctx, plot, h, pal, { dim = false } = {}) {
  const [T, R, B, L] = footprintCorners(plot.x, plot.y, plot.w, plot.h);
  const f = dim ? 0.78 : 1;

  fill(ctx, [R, B, up(B, h), up(R, h)], mix(pal.right, f));   // face droite
  fill(ctx, [B, L, up(L, h), up(B, h)], mix(pal.left, f));    // face gauche
  fill(ctx, [up(T, h), up(R, h), up(B, h), up(L, h)], mix(pal.roof, f)); // toiture

  // Arêtes : c'est ce qui rend les volumes lisibles à petit zoom.
  ctx.strokeStyle = 'rgba(255,255,255,.14)';
  ctx.lineWidth = 1.1;
  poly(ctx, [up(T, h), up(R, h), up(B, h), up(L, h)]); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(B.x, B.y); ctx.lineTo(B.x, B.y - h); ctx.stroke();
  // Liseré clair sur l'arête de faîtage : accroche la lumière et sépare
  // nettement la toiture des murs.
  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  ctx.beginPath();
  ctx.moveTo(up(L, h).x, up(L, h).y); ctx.lineTo(up(B, h).x, up(B, h).y);
  ctx.lineTo(up(R, h).x, up(R, h).y); ctx.stroke();
}

/** Assombrit ou éclaircit une couleur hexadécimale. */
function mix(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `rgb(${r},${g},${b})`;
}

// ── Ateliers : toiture en dents de scie, cheminée, porte sectionnelle ──
function detailWorkshop(ctx, plot, h, roof, pal, { producing, night, time }) {
  const [rT, rR, rB, rL] = roof;
  const ridges = 4;

  // Sheds : bandes alternées + vitrage orienté au nord.
  for (let i = 0; i < ridges; i++) {
    const t0 = i / ridges, t1 = (i + 0.52) / ridges;
    const a = lerpPt(rT, rR, t0), b = lerpPt(rT, rR, t1);
    const c = lerpPt(rL, rB, t1), d = lerpPt(rL, rB, t0);
    fill(ctx, [a, b, c, d], 'rgba(255,255,255,.09)');

    const ga = lerpPt(rT, rR, t1), gb = lerpPt(rT, rR, (i + 0.78) / ridges);
    const gc = lerpPt(rL, rB, (i + 0.78) / ridges), gd = lerpPt(rL, rB, t1);
    fill(ctx, [ga, gb, gc, gd],
      producing ? `${pal.glow}${(0.22 + 0.12 * Math.sin(time * 2 + i)).toFixed(3)})` : 'rgba(10,14,20,.28)');
  }

  // Cheminée, côté nord-est.
  const base = lerpPt(lerpPt(rT, rR, 0.76), lerpPt(rL, rB, 0.76), 0.2);
  ctx.fillStyle = mix(pal.right, 1.25);
  ctx.fillRect(base.x - 4, base.y - 22, 8, 22);
  ctx.fillStyle = mix(pal.roof, 1.4);
  ctx.fillRect(base.x - 5, base.y - 25, 10, 4);

  // Porte sectionnelle + bandeau lumineux sur la face droite.
  const [, R, B] = footprintCorners(plot.x, plot.y, plot.w, plot.h);
  const doorA = lerpPt(R, B, 0.34), doorB = lerpPt(R, B, 0.66);
  const dh = h * 0.56;
  fill(ctx, [doorA, doorB, up(doorB, dh), up(doorA, dh)],
    producing ? `${pal.glow}0.2)` : 'rgba(0,0,0,.32)');

  const stripA = lerpPt(R, B, 0.14), stripB = lerpPt(R, B, 0.86);
  fill(ctx, [up(stripA, h - 5), up(stripB, h - 5), up(stripB, h - 2), up(stripA, h - 2)],
    producing ? pal.trim : `rgba(255,255,255,${0.05 + night * 0.04})`);
}

/** Dépôt : toiture plate, extracteurs, et trois silos dont le remplissage
 *  reflète le stock réel — invisible pour qui n'a pas accès à la donnée. */
function detailStorage(ctx, plot, h, roof, pal, extra, night) {
  const [rT, rR, rB, rL] = roof;
  fill(ctx, [lerpPt(rT, rR, 0.1), lerpPt(rT, rR, 0.9),
             lerpPt(rL, rB, 0.9), lerpPt(rL, rB, 0.1)], 'rgba(255,255,255,.035)');

  for (let i = 0; i < 3; i++) {
    const p = lerpPt(lerpPt(rT, rR, 0.25 + i * 0.25), lerpPt(rL, rB, 0.25 + i * 0.25), 0.45);
    ctx.fillStyle = mix(pal.roof, 1.5);
    ctx.fillRect(p.x - 5, p.y - 7, 10, 7);
  }

  // Silos devant la façade sud-ouest.
  const [, , B, L] = footprintCorners(plot.x, plot.y, plot.w, plot.h);
  const mats = extra?.materials ?? null;
  const ratios = extra?.ratios ?? null;
  const colors = ['#8b9bb4', '#5eead4', '#c4b5fd'];
  for (let i = 0; i < 3; i++) {
    const p = lerpPt(B, L, 0.24 + i * 0.26);
    const ratio = ratios ? Math.max(0, Math.min(1, ratios[i])) : null;
    drawSilo(ctx, p.x, p.y, 7, 26, ratio, colors[i], night);
  }
  void mats;
}

function drawSilo(ctx, x, y, r, h, ratio, color, night) {
  ctx.fillStyle = '#1b222b';
  ctx.fillRect(x - r, y - h, r * 2, h);
  if (ratio !== null) {
    const fh = Math.round(h * ratio);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x - r + 1.5, y - fh, r * 2 - 3, fh);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#2b3542';
  ctx.beginPath(); ctx.ellipse(x, y - h, r, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${0.07 + night * 0.05})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(x - r, y - h, r * 2, h);
}

/** Siège : façade vitrée, les fenêtres s'allument la nuit. */
function detailOffice(ctx, plot, h, pal, night, time) {
  const [, R, B, L] = footprintCorners(plot.x, plot.y, plot.w, plot.h);
  const floors = 4;
  for (const [a, b] of [[R, B], [B, L]]) {
    for (let f = 0; f < floors; f++) {
      const z = h * (0.16 + f * 0.2);
      for (let c = 0; c < 5; c++) {
        const t0 = 0.1 + c * 0.17, t1 = t0 + 0.11;
        const p0 = lerpPt(a, b, t0), p1 = lerpPt(a, b, t1);
        const lit = ((f * 7 + c * 3) % 5) < 3;
        fill(ctx, [up(p0, z), up(p1, z), up(p1, z + 7), up(p0, z + 7)],
          lit && night > 0.25
            ? `rgba(255,214,140,${(0.16 + night * 0.4).toFixed(3)})`
            : 'rgba(150,180,205,.07)');
      }
    }
  }
  // Enseigne clignotante très lente sur le toit.
  const roof = footprintCorners(plot.x, plot.y, plot.w, plot.h).map((p) => up(p, h));
  const c = lerpPt(lerpPt(roof[0], roof[1], 0.5), lerpPt(roof[3], roof[2], 0.5), 0.4);
  ctx.fillStyle = `rgba(167,139,250,${0.5 + 0.3 * Math.sin(time * 1.2)})`;
  ctx.fillRect(c.x - 12, c.y - 9, 24, 3);
  void pal;
}

/** Quai d'expédition : auvent sur poteaux et postes à quai. */
function detailLogistics(ctx, plot, h, roof, pal, night) {
  const [, R, B, L] = footprintCorners(plot.x, plot.y, plot.w, plot.h);
  for (let i = 0; i < 3; i++) {
    const a = lerpPt(R, B, 0.16 + i * 0.28), b = lerpPt(R, B, 0.3 + i * 0.28);
    fill(ctx, [a, b, up(b, h * 0.7), up(a, h * 0.7)], 'rgba(0,0,0,.38)');
    fill(ctx, [up(a, h * 0.7), up(b, h * 0.7), up(b, h * 0.74), up(a, h * 0.74)], pal.trim);
  }
  const canopy = [lerpPt(roof[1], roof[2], 0), lerpPt(roof[1], roof[2], 1)];
  ctx.strokeStyle = `rgba(245,165,36,${0.25 + night * 0.2})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(canopy[0].x, canopy[0].y); ctx.lineTo(canopy[1].x, canopy[1].y);
  ctx.stroke();
  void L;
}

/**
 * Tampon central : une cour ouverte où s'empilent physiquement les caisses.
 * C'est l'objet le plus important de la carte — les deux joueurs doivent
 * pouvoir lire son remplissage d'un coup d'œil, sans chiffre.
 */
function drawYard(ctx, o, pal) {
  const { plot, extra } = o;
  const [T, R, B, L] = footprintCorners(plot.x, plot.y, plot.w, plot.h);
  const wall = 20;

  fill(ctx, [T, R, B, L], '#141220');
  // Muret périphérique.
  fill(ctx, [R, B, up(B, wall), up(R, wall)], mix(pal.right, 1));
  fill(ctx, [B, L, up(L, wall), up(B, wall)], mix(pal.left, 1));
  fill(ctx, [up(T, wall), up(R, wall), up(B, wall), up(L, wall)], 'rgba(167,139,250,.05)');
  poly(ctx, [up(T, wall), up(R, wall), up(B, wall), up(L, wall)]);
  ctx.strokeStyle = 'rgba(167,139,250,.3)'; ctx.lineWidth = 1.2; ctx.stroke();

  // Trois travées de caisses : cadres, batteries, moteurs.
  const fills = extra?.fills ?? [0, 0, 0];
  const colors = ['#7dd3fc', '#5eead4', '#fca5a5'];
  const MAX_ROWS = 5, MAX_COLS = 3;

  for (let lane = 0; lane < 3; lane++) {
    const laneT = 0.26 + lane * 0.24;
    const count = Math.round(Math.max(0, Math.min(1, fills[lane])) * MAX_ROWS * MAX_COLS);
    for (let n = 0; n < count; n++) {
      const col = n % MAX_COLS;
      const row = Math.floor(n / MAX_COLS);
      const a = lerpPt(lerpPt(T, R, laneT), lerpPt(L, B, laneT), 0.28 + col * 0.22);
      drawCrate(ctx, a.x, a.y - row * 11 - wall * 0.3, colors[lane]);
    }
  }
}

function drawCrate(ctx, x, y, color) {
  const w = 11, d = 6, hh = 10;
  fill(ctx, [{ x, y: y - hh - d }, { x: x + w, y: y - hh }, { x, y: y - hh + d }, { x: x - w, y: y - hh }], color);
  fill(ctx, [{ x, y: y - hh + d }, { x: x + w, y: y - hh }, { x: x + w, y: y }, { x, y: y + d }], mix(rgbToHex(color), 0.62));
  fill(ctx, [{ x, y: y - hh + d }, { x: x - w, y: y - hh }, { x: x - w, y: y }, { x, y: y + d }], mix(rgbToHex(color), 0.42));
}
const rgbToHex = (c) => c;

/** Pastilles de niveau au-dessus de la toiture. */
function drawLevelPips(ctx, roof, level, pal) {
  const c = lerpPt(lerpPt(roof[0], roof[1], 0.5), lerpPt(roof[3], roof[2], 0.5), 0.5);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i < level ? pal.trim : 'rgba(255,255,255,.13)';
    ctx.fillRect(c.x - 9 + i * 7, c.y - 16, 4, 4);
  }
}

/** Cercle d'alerte pulsant : panne (rouge) ou poste dégradé (ambre). */
function drawAlertRing(ctx, plot, h, time, color, strength = 1) {
  const [T, R, B, L] = footprintCorners(plot.x, plot.y, plot.w, plot.h)
    .map((p) => up(p, h + 2));
  const pulse = 0.4 + 0.35 * Math.sin(time * 3.4);
  ctx.save();
  ctx.globalAlpha = pulse * strength;
  poly(ctx, [T, R, B, L]);
  ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.stroke();
  ctx.restore();

  if (strength === 1) {
    const top = up(lerpPt(T, B, 0.5), 34);
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 3.4);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y - 9); ctx.lineTo(top.x + 8, top.y + 5); ctx.lineTo(top.x - 8, top.y + 5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#0a0c0f';
    ctx.fillRect(top.x - 1, top.y - 4, 2, 6);
    ctx.restore();
  }
}

/** Chantier : échafaudage + grue animée. */
function drawScaffolding(ctx, plot, h, work, time) {
  const [T, R, B, L] = footprintCorners(plot.x, plot.y, plot.w, plot.h);
  ctx.save();
  ctx.strokeStyle = 'rgba(96,165,250,.55)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 3]);
  for (const p of [T, R, B, L]) {
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - h - 8); ctx.stroke();
  }
  poly(ctx, [up(T, h + 8), up(R, h + 8), up(B, h + 8), up(L, h + 8)]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Flèche de grue qui balaie lentement le chantier.
  const c = lerpPt(lerpPt(T, R, 0.5), lerpPt(L, B, 0.5), 0.5);
  const mast = up(c, h + 44);
  ctx.strokeStyle = 'rgba(96,165,250,.8)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(mast.x, mast.y); ctx.stroke();
  const ang = Math.sin(time * 0.6) * 0.9;
  ctx.beginPath();
  ctx.moveTo(mast.x - Math.cos(ang) * 14, mast.y - Math.sin(ang) * 6);
  ctx.lineTo(mast.x + Math.cos(ang) * 30, mast.y + Math.sin(ang) * 13);
  ctx.stroke();
  ctx.restore();
  void work;
}

function drawSelection(ctx, plot) {
  const pts = footprintCorners(plot.x - 0.12, plot.y - 0.12, plot.w + 0.24, plot.h + 0.24);
  ctx.save();
  poly(ctx, pts);
  ctx.strokeStyle = '#e6e8ec'; ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 4]); ctx.stroke();
  ctx.restore();
}

export const lerpPt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
