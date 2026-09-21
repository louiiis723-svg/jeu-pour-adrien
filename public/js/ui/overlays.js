/**
 * overlays.js — Propositions, crises, fin de partie, notifications.
 *
 * Ces surcouches portent la mécanique de co-décision : ce sont les seuls
 * moments où le jeu s'arrête d'être « chacun son écran » pour exiger un
 * accord explicite.
 *
 * Les comptes à rebours sont calés sur l'horloge SERVEUR (via view.serverNow)
 * et non sur celle du navigateur : deux machines mal synchronisées afficheraient
 * sinon deux décomptes différents pour la même décision.
 */
import { render, eur, int, dec, esc } from './dom.js';

let clockOffset = 0;
export const syncClock = (serverNow) => { clockOffset = serverNow - Date.now(); };
const now = () => Date.now() + clockOffset;

// ═════════════════════════════════════════════════════════════
// Propositions à double signature
// ═════════════════════════════════════════════════════════════
export function renderProposals(root, view, ttl) {
  const items = view.proposals ?? [];
  const signature = items.map((p) => `${p.id}:${p.votes.amont}:${p.votes.aval}`).join('|');
  if (root.dataset.signature === signature) return;
  root.dataset.signature = signature;

  render(root, items.map((p) => {
    const waiting = p.votes[view.role] !== null;
    const who = p.initiator === 'amont' ? 'l’Industrie' : 'le Commerce';
    return `
    <div class="prop" data-expires="${p.expiresAt}" data-ttl="${ttl}">
      <div class="prop-tag">Contre-signature demandée par ${who}</div>
      <h4>${esc(p.title)}</h4>
      <p>${esc(p.detail)}</p>
      ${p.cost > 0 ? `<p class="tiny muted" style="margin-top:-6px">Impact trésorerie : <b style="color:var(--danger)">−${int(p.cost)} €</b></p>` : ''}
      <div class="prop-foot">
        ${waiting
          ? '<span class="prop-wait">En attente de votre partenaire…</span>'
          : `<button class="btn btn-sm btn-accept" data-vote="yes" data-id="${p.id}" type="button">Signer</button>
             <button class="btn btn-sm btn-reject" data-vote="no" data-id="${p.id}" type="button">Refuser</button>`}
        <span class="prop-timer"><i style="width:100%"></i></span>
      </div>
    </div>`;
  }).join(''));
}

// ═════════════════════════════════════════════════════════════
// Crise chronométrée
// ═════════════════════════════════════════════════════════════
export function renderCrisis(root, view, ttl) {
  const c = view.crisis;
  if (!c) { root.hidden = true; root.dataset.signature = ''; root.innerHTML = ''; return; }

  const signature = `${c.id}:${c.votes.amont}:${c.votes.aval}`;
  root.hidden = false;
  if (root.dataset.signature === signature) return;
  root.dataset.signature = signature;

  const mine = c.votes[view.role];
  const theirs = c.votes[view.partnerRole];
  const partnerName = view.partnerRole === 'amont' ? 'Industrie' : 'Commerce';

  render(root, `
    <div class="crisis-box" data-expires="${c.expiresAt}" data-ttl="${ttl}">
      <div class="crisis-tag">Crise — décision commune</div>
      <h3>${esc(c.title)}</h3>
      <p>${esc(c.text)}</p>
      <div class="crisis-opts">
        ${c.options.map((o) => {
          const isMine = mine === o.id;
          const isTheirs = theirs === o.id;
          const agreed = isMine && isTheirs;
          const cls = [agreed ? 'agreed' : '', isMine && !agreed ? 'mine' : '', isTheirs && !agreed ? 'theirs' : ''].filter(Boolean).join(' ');
          return `
          <button class="crisis-opt ${cls}" data-crisis="${c.id}" data-option="${o.id}" type="button"
                  ${isTheirs ? `data-who="${esc(partnerName)} a choisi"` : ''}>
            <strong>${esc(o.label)}</strong>
            <small>${esc(o.detail)}</small>
          </button>`;
        }).join('')}
      </div>
      <p class="crisis-default">
        Sans accord avant la fin du compte à rebours, l'option
        « ${esc(c.options.find((o) => o.id === c.defaultOption)?.label ?? '—')} » s'applique d'office.
      </p>
      <div class="crisis-timer"><i style="width:100%"></i></div>
    </div>`);
}

/** Met à jour tous les comptes à rebours affichés. Appelé ~10 fois/s. */
export function tickTimers(rootProposals, rootCrisis) {
  for (const root of [rootProposals, rootCrisis]) {
    for (const node of root.querySelectorAll('[data-expires]')) {
      const expires = Number(node.dataset.expires);
      const ttl = Number(node.dataset.ttl) || 60000;
      const left = Math.max(0, expires - now());
      const bar = node.querySelector('.prop-timer > i, .crisis-timer > i');
      if (bar) bar.style.width = `${(left / ttl * 100).toFixed(1)}%`;
    }
  }
}

// ═════════════════════════════════════════════════════════════
// Fin de partie : compte de résultat et bilan de la coopération
// ═════════════════════════════════════════════════════════════
export function renderGameOver(root, over, view) {
  root.hidden = false;
  const s = over.stats;
  const defectRate = s.produced > 0 ? s.scrapped / s.produced : 0;

  const lines = (obj) => Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([k, val]) => `<div class="pnl-line"><span>${esc(k)}</span><b>${eur(val)}</b></div>`)
    .join('');

  const result = s.revenue - s.costs;

  render(root, `
    <div class="over-box ${over.win ? 'win' : 'lose'}">
      <div class="over-title">${esc(over.title)}</div>
      <p class="over-text">${esc(over.text)}</p>

      <div class="over-grid">
        <div class="over-cell"><span>Valeur finale</span><b>${eur(over.value)}</b></div>
        <div class="over-cell"><span>Objectif</span><b>${eur(over.objective)}</b></div>
        <div class="over-cell"><span>Vélos assemblés</span><b>${int(s.produced)}</b></div>
        <div class="over-cell"><span>Vélos expédiés</span><b>${int(s.shipped)}</b></div>
        <div class="over-cell"><span>Taux de rebut</span><b>${dec(defectRate * 100, 1)} %</b></div>
        <div class="over-cell"><span>Contrats honorés</span><b>${int(s.contractsDone)}</b></div>
        <div class="over-cell"><span>Contrats manqués</span><b style="color:${s.contractsFailed ? 'var(--danger)' : 'inherit'}">${int(s.contractsFailed)}</b></div>
        <div class="over-cell"><span>Jour atteint</span><b>${int(over.day)}</b></div>
      </div>

      <div class="pnl">
        <div>
          <h4>Produits</h4>
          ${lines(s.produits ?? {})}
          <div class="pnl-line total"><span>Total</span><b>${eur(s.revenue)}</b></div>
        </div>
        <div>
          <h4>Charges</h4>
          ${lines(s.charges ?? {})}
          <div class="pnl-line total"><span>Total</span><b>${eur(s.costs)}</b></div>
        </div>
      </div>
      <div class="pnl-line total" style="margin-bottom:20px">
        <span>Résultat d'exploitation</span>
        <b style="color:${result >= 0 ? 'var(--ok)' : 'var(--danger)'}">${result >= 0 ? '+' : '−'}${eur(Math.abs(result))}</b>
      </div>

      <button class="btn btn-primary" data-act="restart" type="button">Rejouer</button>
    </div>`);
  void view;
}

// ═════════════════════════════════════════════════════════════
// Notifications éphémères
// ═════════════════════════════════════════════════════════════
export function toast(text, kind = 'info', root = document.getElementById('toasts')) {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = text;
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, kind === 'error' ? 4200 : 3000);
}
