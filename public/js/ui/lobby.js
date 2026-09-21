/**
 * lobby.js — Écran d'accueil : création de partie, code à partager,
 * choix du poste et mise en attente.
 */
import { $, $$, esc } from './dom.js';
import { toast } from './overlays.js';

export function createLobby(net, onStart) {
  const refs = {
    screen: $('#lobby'), pseudo: $('#pseudo'), error: $('#lobbyError'),
    create: $('#btnCreate'), join: $('#btnJoin'), joinCode: $('#joinCode'),
    intro: $('#lobbyIntro'), room: $('#lobbyRoom'), code: $('#roomCode'),
    copy: $('#btnCopy'), seats: $('#seats'), ready: $('#btnReady'),
    readyHint: $('#readyHint'), roleCards: $$('.role-card'),
  };

  let wantedRole = 'amont';
  let myRole = null;
  let isReady = false;

  // Le lien de partage porte le code : ?p=XXXX
  const urlCode = new URLSearchParams(location.search).get('p');
  if (urlCode) refs.joinCode.value = urlCode.toUpperCase();

  const saved = localStorage.getItem('voltra:name');
  if (saved) refs.pseudo.value = saved;

  for (const card of refs.roleCards) {
    card.addEventListener('click', () => {
      wantedRole = card.dataset.role;
      refs.roleCards.forEach((c) => c.classList.toggle('selected', c === card));
    });
  }

  const fail = (msg) => { refs.error.textContent = msg; };
  const name = () => {
    const n = refs.pseudo.value.trim();
    if (n) localStorage.setItem('voltra:name', n);
    return n || 'Anonyme';
  };

  function enterRoom(res) {
    myRole = res.role;
    refs.intro.hidden = true;
    refs.room.hidden = false;
    refs.code.textContent = res.code;
    history.replaceState(null, '', `?p=${res.code}`);
    paintSeats(res.summary);
  }

  function paintSeats(summary) {
    if (!summary) return;
    refs.seats.innerHTML = Object.values(summary.seats).map((s) => `
      <div class="seat ${s.role}">
        <div>
          <div class="seat-name">${s.name ? esc(s.name) : '<span class="muted">Siège libre</span>'}${s.role === myRole ? ' <span class="muted tiny">(vous)</span>' : ''}</div>
          <div class="seat-role">${esc(s.label)}</div>
        </div>
        <span class="seat-state ${s.connected ? 'on' : 'off'}">
          ${!s.connected ? 'absent' : s.ready ? 'prêt' : 'en attente'}
        </span>
      </div>`).join('');

    const bothHere = Object.values(summary.seats).every((s) => s.connected);
    refs.ready.disabled = !bothHere;
    refs.readyHint.textContent = bothHere
      ? 'La partie démarre dès que les deux directions sont prêtes.'
      : 'En attente de votre partenaire — partagez-lui le lien ou le code.';
  }

  refs.create.addEventListener('click', async () => {
    fail('');
    refs.create.disabled = true;
    const res = await net.ask('room:create', { name: name(), role: wantedRole });
    refs.create.disabled = false;
    if (!res.ok) return fail(res.error ?? 'Création impossible.');
    enterRoom(res);
  });

  refs.join.addEventListener('click', async () => {
    fail('');
    const code = refs.joinCode.value.trim().toUpperCase();
    if (!code) return fail('Entrez le code de la partie.');
    refs.join.disabled = true;
    const res = await net.ask('room:join', { code, name: name() });
    refs.join.disabled = false;
    if (!res.ok) return fail(res.error ?? 'Impossible de rejoindre.');
    enterRoom(res);
  });

  refs.joinCode.addEventListener('keydown', (e) => { if (e.key === 'Enter') refs.join.click(); });

  refs.copy.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?p=${refs.code.textContent}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Lien copié — envoyez-le à votre partenaire.', 'ok');
    } catch {
      // Le presse-papiers peut être refusé (contexte non sécurisé) : on affiche
      // alors le lien pour que le joueur le copie à la main.
      toast(url, 'info');
    }
  });

  refs.ready.addEventListener('click', () => {
    isReady = !isReady;
    refs.ready.textContent = isReady ? 'Annuler' : 'Je suis prêt';
    net.send('room:ready', { ready: isReady });
  });

  net.on('room:update', (summary) => {
    paintSeats(summary);
    if (summary.phase === 'lobby') {
      refs.screen.hidden = false;
      $('#game').hidden = true;
    }
  });

  return {
    get role() { return myRole; },
    hide() { refs.screen.hidden = true; onStart?.(); },
    show() {
      refs.screen.hidden = false;
      isReady = false;
      refs.ready.textContent = 'Je suis prêt';
    },
  };
}
