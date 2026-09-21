/**
 * iso.js — Projection isométrique et caméra.
 *
 * Convention de coordonnées, à respecter partout ailleurs :
 *   · une TUILE est désignée par des indices entiers (i, j)
 *   · gridToScreen() travaille sur des coordonnées de COIN (continues) :
 *     la tuile (i, j) occupe le losange délimité par les coins
 *     (i,j) → (i+1,j) → (i+1,j+1) → (i,j+1)
 *   · tileToScreen(i, j) vise le CENTRE de la tuile, soit le coin (i+.5, j+.5)
 *
 * Confondre les deux est la source d'erreur classique en isométrique :
 * les bâtiments se décalent d'une demi-tuile par rapport aux véhicules.
 */

export const TILE_W = 64;
export const TILE_H = 32;

/** Coin de grille (continu) → pixels monde. */
export function gridToScreen(gx, gy) {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2),
  };
}

/** Centre d'une tuile → pixels monde. */
export const tileToScreen = (i, j) => gridToScreen(i + 0.5, j + 0.5);

/** Pixels monde → coin de grille (continu). Inverse exact de gridToScreen. */
export function screenToGrid(px, py) {
  return {
    x: (px / (TILE_W / 2) + py / (TILE_H / 2)) / 2,
    y: (py / (TILE_H / 2) - px / (TILE_W / 2)) / 2,
  };
}

/**
 * Clé de tri en profondeur. Plus elle est grande, plus l'objet est « devant »
 * et doit être dessiné tard. On ajoute une micro-priorité pour départager
 * un véhicule et un bâtiment sur la même diagonale.
 */
export const depthKey = (gx, gy, bias = 0) => gx + gy + bias;

/** Trace le losange d'une tuile (sans le remplir). */
export function tilePath(ctx, i, j) {
  const a = gridToScreen(i, j);
  const b = gridToScreen(i + 1, j);
  const c = gridToScreen(i + 1, j + 1);
  const d = gridToScreen(i, j + 1);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  ctx.closePath();
}

/** Trace le losange d'une emprise rectangulaire (x, y, w, h en tuiles). */
export function footprintPath(ctx, x, y, w, h) {
  const p = footprintCorners(x, y, w, h);
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y);
  ctx.closePath();
}

/** Les 4 coins écran d'une emprise, dans l'ordre haut → droite → bas → gauche. */
export function footprintCorners(x, y, w, h) {
  return [
    gridToScreen(x, y),         // haut
    gridToScreen(x + w, y),     // droite
    gridToScreen(x + w, y + h), // bas
    gridToScreen(x, y + h),     // gauche
  ];
}

/**
 * Caméra : déplacement au glisser, zoom à la molette, recadrage automatique.
 * `x`/`y` désignent le point du monde affiché au centre du canvas.
 */
export class Camera {
  constructor() {
    this.x = 0; this.y = 0;
    this.zoom = 1;
    this.minZoom = 0.42;
    this.maxZoom = 2.2;
  }

  /** Applique la transformation à un contexte 2D déjà réinitialisé. */
  apply(ctx, width, height, dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(width / 2, height / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  /** Pixels écran (relatifs au canvas) → pixels monde. */
  toWorld(sx, sy, width, height) {
    return {
      x: (sx - width / 2) / this.zoom + this.x,
      y: (sy - height / 2) / this.zoom + this.y,
    };
  }

  pan(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  /** Zoom centré sur un point écran, pour que le curseur reste ancré. */
  zoomAt(factor, sx, sy, width, height) {
    const before = this.toWorld(sx, sy, width, height);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after = this.toWorld(sx, sy, width, height);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /** Cadre la grille entière avec une marge, et centre dessus. */
  fit(gridW, gridH, width, height, margin = 90) {
    const corners = footprintCorners(0, 0, gridW, gridH);
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    // On élargit verticalement : les bâtiments montent au-dessus du sol.
    const minY = Math.min(...ys) - 120, maxY = Math.max(...ys) + 40;

    this.x = (minX + maxX) / 2;
    this.y = (minY + maxY) / 2;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, Math.min(
      (width - margin) / (maxX - minX),
      (height - margin) / (maxY - minY),
    )));
  }
}
