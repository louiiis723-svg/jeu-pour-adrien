/**
 * dom.js — Petits utilitaires partagés par l'interface.
 * Pas de framework : le jeu tient dans quelques centaines de lignes de DOM.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const eur = (n) => `${Math.round(n ?? 0).toLocaleString('fr-FR')} €`;
export const int = (n) => Math.round(n ?? 0).toLocaleString('fr-FR');
export const dec = (n, d = 1) => (n ?? 0).toFixed(d).replace('.', ',');
export const pct = (n) => `${Math.round((n ?? 0) * 100)} %`;
export const signed = (n) => `${n >= 0 ? '+' : '−'}${int(Math.abs(n))} €`;

/** Échappement systématique : les noms de joueur finissent dans du HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Remplace le contenu d'un conteneur en préservant la saisie en cours.
 * Sans cela, le re-rendu périodique (toutes les 2,5 s) viderait le champ que
 * le joueur est en train de remplir — bug classique des interfaces temps réel.
 */
export function render(container, html) {
  const active = document.activeElement;
  const focusedId = active && container.contains(active) && active.id ? active.id : null;
  const caret = focusedId && 'selectionStart' in active ? active.selectionStart : null;

  const saved = {};
  for (const input of container.querySelectorAll('input[id]')) saved[input.id] = input.value;

  container.innerHTML = html;

  for (const input of container.querySelectorAll('input[id]')) {
    if (saved[input.id] !== undefined) input.value = saved[input.id];
  }
  if (focusedId) {
    const node = container.querySelector(`#${CSS.escape(focusedId)}`);
    if (node) {
      node.focus();
      if (caret !== null && 'setSelectionRange' in node) {
        try { node.setSelectionRange(caret, caret); } catch { /* type sans sélection */ }
      }
    }
  }
}

/** Jauge horizontale : valeur / capacité, avec couleur de seuil. */
export function gauge(label, value, max, color, note = '') {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return `
    <div class="gauge">
      <div class="gauge-top">
        <span class="muted">${label}</span>
        <b>${int(value)}<span class="muted"> / ${int(max)}</span></b>
      </div>
      <div class="gauge-bar"><i style="width:${(ratio * 100).toFixed(1)}%;background:${color}"></i></div>
      ${note ? `<div class="tiny muted">${note}</div>` : ''}
    </div>`;
}

export const row = (label, value, cls = '') =>
  `<div class="row"><span class="row-label">${label}</span><span class="row-value ${cls}">${value}</span></div>`;

export const section = (title, tag, body) => `
  <div class="sec">
    <div class="sec-head">${title}<span class="spacer"></span>${tag ? `<span class="tag">${tag}</span>` : ''}</div>
    <div class="sec-body">${body}</div>
  </div>`;

/** Couleur d'une jauge selon un ratio, avec seuils communs à tout le jeu. */
export function heat(ratio, invert = false) {
  const r = invert ? 1 - ratio : ratio;
  if (r > 0.85) return 'var(--danger)';
  if (r > 0.65) return 'var(--warn)';
  return 'var(--ok)';
}
