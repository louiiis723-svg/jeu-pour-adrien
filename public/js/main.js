/**
 * main.js — Point d'entrée du client : câblage entre le réseau, la scène
 * isométrique et l'interface.
 *
 * Le client ne contient AUCUNE règle de jeu. Il envoie des intentions,
 * reçoit une projection d'état, et la dessine. Toute logique métier qui
 * apparaîtrait ici serait duplicative — et donc fausse tôt ou tard.
 */
import { createNet } from './net.js';
import { $ } from './ui/dom.js';
import { createLobby } from './ui/lobby.js';
import { createHud } from './ui/hud.js';
import { createFeed } from './ui/feed.js';
import { createPanel, renderBuffer, renderShare, renderInspector } from './ui/panels.js';
import {
  renderProposals, renderCrisis, renderGameOver, tickTimers, toast, syncClock,
} from './ui/overlays.js';
import { Renderer } from './scene/renderer.js';


const net = createNet();
const hud = createHud();
const renderer = new Renderer($('#scene'));

const feed = createFeed({
  tabs: [...document.querySelectorAll('.feed-tabs .tab')],
  logPane: $('#logPane'), chatPane: $('#chatPane'),
  chatForm: $('#chatForm'), badge: $('#chatBadge'),
});

let view = null;        // dernière projection reçue
let rules = null;       // constantes envoyées au démarrage
let role = null;
let panel = null;
let selected = null;

const send = async (type, payload) => {
  const res = await net.ask('game:action', { type, payload });
  if (!res.ok && res.error) toast(res.error, 'error');
  else if (res.pending) toast('Proposition envoyée à votre partenaire.', 'info');
  return res;
};

// ═════════════════════════════════════════════════════════════
// Actions du panneau (délégation via data-act)
// ═════════════════════════════════════════════════════════════
function onAction(data, root) {
  switch (data.act) {
    case 'supplier':
      send('supply:setSupplier', { supplierId: data.id });
      break;

    case 'order': {
      const payload = {};
      let total = 0;
      for (const input of root.querySelectorAll('input[data-mat]')) {
        const qty = Math.max(0, Math.round(Number(input.value) || 0));
        payload[input.dataset.mat] = qty;
        total += qty;
      }
      if (total <= 0) return toast('Indiquez au moins une quantité.', 'error');
      send('supply:order', payload).then((res) => {
        if (res.ok) for (const i of root.querySelectorAll('input[data-mat]')) i.value = 0;
      });
      break;
    }

    case 'staff': {
      const current = view?.buildings?.[data.id]?.staff ?? 0;
      send('building:setStaff', { id: data.id, staff: Math.max(0, current + Number(data.delta)) });
      break;
    }

    case 'toggle':   send('building:setActive', { id: data.id, active: data.on === '1' }); break;
    case 'service':  send('building:service', { id: data.id }); break;
    case 'repair':   send('building:repair', { id: data.id }); break;
    case 'upgrade':  send('building:upgrade', { id: data.id }); break;

    case 'hire':     send('hr:hire', { count: Number(data.n) }); break;
    case 'fire':     send('hr:fire', { count: Number(data.n) }); break;
    case 'bonus':    send('hr:bonus', {}); break;

    case 'accept':   send('market:accept', { offerId: data.id }); break;
    case 'decline':  send('market:decline', { offerId: data.id }); break;
    case 'campaign': send('market:campaign', {}); break;

    case 'loan': {
      const amount = Number(root.querySelector('#loanAmount')?.value ?? 0);
      send('finance:loan', { amount: Math.round(amount) });
      break;
    }

    case 'share':    send('info:share', { key: data.key }); break;
    default: break;
  }
}

// ═════════════════════════════════════════════════════════════
// Lobby
// ═════════════════════════════════════════════════════════════
const lobby = createLobby(net);

// ═════════════════════════════════════════════════════════════
// Démarrage de partie
// ═════════════════════════════════════════════════════════════
net.on('game:init', (init) => {
  role = init.role;
  rules = init.rules;

  lobby.hide();
  $('#game').hidden = false;

  hud.setRole(role, init.roleLabel);
  renderShare($('#sharePane'), role);
  renderer.resize();

  panel = createPanel($('#panelLeft'), { role, rules, send, onAction });
  renderer.init(init.layout, rules);
  renderer.onSelect = (id) => { selected = id; renderInspector($('#inspector'), id, view); };
  renderer.start();
  feed.clear();
});

net.on('game:state', (next) => {
  view = next;
  syncClock(next.serverNow);

  hud.update(next);
  panel?.update(next);
  renderBuffer($('#bufferCard'), next);
  renderer.setView(next);
  renderProposals($('#proposals'), next, rules?.proposalTtl ?? 60000);
  renderCrisis($('#crisis'), next, rules?.crisisTtl ?? 45000);
  if (selected) renderInspector($('#inspector'), selected, next);
});

net.on('game:log', (entries) => feed.addLog(entries));
net.on('chat:history', (msgs) => msgs.forEach((m) => feed.addChat(m, role)));
net.on('chat:msg', (msg) => feed.addChat(msg, role));

net.on('game:over', (over) => {
  renderGameOver($('#gameOver'), over, view);
});

net.on('game:reset', () => {
  $('#gameOver').hidden = true;
  $('#game').hidden = true;
  renderer.stop();
  view = null; selected = null;
  $('#inspector').hidden = true;
  lobby.show();
});

net.on('room:update', (summary) => {
  if (!role) return;
  const partner = summary.seats[role === 'amont' ? 'aval' : 'amont'];
  hud.setPartner(partner.connected, partner.name);
});

net.on('disconnect', () => toast('Connexion perdue — tentative de reconnexion…', 'error'));
net.on('connect', () => { if (role) toast('Reconnecté.', 'ok'); });

// ═════════════════════════════════════════════════════════════
// Interactions globales
// ═════════════════════════════════════════════════════════════
hud.onPause(() => send('game:pause', { paused: view?.phase !== 'paused' }));

$('#proposals').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-vote]');
  if (!btn) return;
  net.ask('game:voteProposal', { id: btn.dataset.id, choice: btn.dataset.vote })
    .then((res) => { if (!res.ok && res.error) toast(res.error, 'error'); });
});

$('#crisis').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-option]');
  if (!btn) return;
  net.ask('game:voteCrisis', { id: btn.dataset.crisis, option: btn.dataset.option })
    .then((res) => { if (!res.ok && res.error) toast(res.error, 'error'); });
});

$('#gameOver').addEventListener('click', (e) => {
  if (e.target.closest('[data-act="restart"]')) net.send('game:restart');
});

// Les boutons de partage sont dans le panneau DROIT : ils ont besoin de leur
// propre délégation, celle du panneau gauche ne les couvre pas.
$('#sharePane').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act="share"]');
  if (btn) send('info:share', { key: btn.dataset.key });
});

$('#inspector').addEventListener('click', (e) => {
  if (e.target.closest('[data-act="closeInspector"]')) {
    selected = null;
    renderer.selected = null;
    $('#inspector').hidden = true;
  }
});

$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  net.send('chat:send', { text });
  input.value = '';
});

$('#btnZoomIn').addEventListener('click', () =>
  renderer.camera.zoomAt(1.2, renderer.w / 2, renderer.h / 2, renderer.w, renderer.h));
$('#btnZoomOut').addEventListener('click', () =>
  renderer.camera.zoomAt(1 / 1.2, renderer.w / 2, renderer.h / 2, renderer.w, renderer.h));
$('#btnRecenter').addEventListener('click', () => renderer.recenter());

// Comptes à rebours des propositions et des crises.
setInterval(() => tickTimers($('#proposals'), $('#crisis')), 100);

// Raccourcis clavier : espace = pause, échap = fermer l'inspecteur.
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.code === 'Space' && view) {
    e.preventDefault();
    send('game:pause', { paused: view.phase !== 'paused' });
  }
  if (e.code === 'Escape') {
    selected = null; renderer.selected = null; $('#inspector').hidden = true;
  }
});
