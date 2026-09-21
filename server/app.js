/**
 * app.js — Serveur HTTP + WebSocket, sans écoute de port.
 *
 * Ce module construit l'application et la retourne telle quelle. Il ne décide
 * PAS comment elle est servie : c'est `server/index.js` qui écoute un port en
 * local, et `api/server.js` qui l'exporte pour Vercel. Un seul code de jeu,
 * deux façons de le servir.
 *
 * Responsabilités, volontairement étroites :
 *   · servir le client statique
 *   · router les messages socket vers actions.js / proposals.js / events.js
 *   · diffuser à chaque joueur SA projection de l'état (visibility.js)
 *
 * Aucune règle de jeu ici. Si une règle apparaît dans ce fichier, c'est
 * qu'elle est au mauvais endroit.
 */
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import * as rooms from './rooms.js';
import { tick } from './game/engine.js';
import { apply } from './game/actions.js';
import * as proposals from './game/systems/proposals.js';
import * as events from './game/systems/events.js';
import { viewFor, logFor, layoutPayload, rulesPayload } from './game/visibility.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_LOG = 250;
const MAX_CHAT = 120;

/**
 * Chemin du point d'entrée Socket.IO.
 *
 * Sur Vercel, une fonction déployée depuis `api/server.js` est servie sous
 * `/api/server`, et Socket.IO ajoute `/socket.io` derrière. On fixe donc le
 * même chemin des deux côtés — serveur ET client — pour que le code soit
 * rigoureusement identique en local et en production.
 */
export const SOCKET_PATH = '/api/server/socket.io';

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
// Deux chemins pour la même sonde : en local l'application répond sur tout
// le domaine, alors que sur Vercel seule la route /api/server/* atteint cette
// fonction — le reste est servi en statique par le CDN.
const health = (_req, res) => res.json({ ok: true, rooms: rooms.roomCount() });
app.get('/api/health', health);
app.get('/api/server/health', health);

const server = createServer(app);
const io = new Server(server, {
  path: SOCKET_PATH,
  // Vercel n'accepte pas le long-polling pour Socket.IO : on impose le
  // transport WebSocket, des deux côtés.
  transports: ['websocket'],
  cors: { origin: '*' },
});

// ─────────────────────────────────────────────────────────────
// Diffusion
// ─────────────────────────────────────────────────────────────

/** Envoie à chaque joueur connecté la projection correspondant à son rôle. */
function pushState(room) {
  if (!room.state) return;
  for (const role of rooms.ROLES) {
    const seat = room.seats[role];
    if (!seat.connected || !seat.socketId) continue;
    io.to(seat.socketId).emit('game:state', viewFor(room.state, role));
  }
}

/** Vide le journal du tick et l'envoie, filtré, à chacun. */
function pushLog(room) {
  const entries = room.state?.tickLog ?? [];
  if (!entries.length) return;
  room.log.push(...entries);
  if (room.log.length > MAX_LOG) room.log.splice(0, room.log.length - MAX_LOG);
  for (const role of rooms.ROLES) {
    const seat = room.seats[role];
    if (!seat.connected || !seat.socketId) continue;
    const mine = logFor(entries, role);
    if (mine.length) io.to(seat.socketId).emit('game:log', mine);
  }
  room.state.tickLog = [];
}

/** À appeler après toute action joueur, pour un retour immédiat. */
function flush(room) {
  pushLog(room);
  pushState(room);
}

const pushRoom = (room) => io.to(room.code).emit('room:update', rooms.roomSummary(room));

// ─────────────────────────────────────────────────────────────
// Boucle de jeu
// ─────────────────────────────────────────────────────────────
function onTick(room) {
  if (!room.state) return;
  tick(room.state);
  pushLog(room);
  pushState(room);

  if (room.state.phase === 'over') {
    room.phase = 'over';
    rooms.stopLoop(room);
    io.to(room.code).emit('game:over', room.state.over);
    pushRoom(room);
  }
}

// ─────────────────────────────────────────────────────────────
// Socket
// ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  /** Room à laquelle ce socket est rattaché. */
  let code = null;

  const currentRoom = () => (code ? rooms.getRoom(code) : null);

  /** Récupère room + rôle, ou renvoie une erreur normalisée. */
  function seated() {
    const room = currentRoom();
    if (!room || !room.state) return null;
    const role = rooms.seatOfSocket(room, socket.id);
    return role ? { room, role } : null;
  }

  /** Envoie tout ce qu'il faut pour (re)construire l'écran de jeu. */
  function sendFullGame(room, role) {
    socket.emit('game:init', {
      layout: layoutPayload(),
      rules: rulesPayload(),
      role,
      roleLabel: rooms.ROLE_LABELS[role],
      partnerLabel: rooms.ROLE_LABELS[role === 'amont' ? 'aval' : 'amont'],
    });
    socket.emit('game:log', logFor(room.log, role));
    socket.emit('chat:history', room.chat);
    socket.emit('game:state', viewFor(room.state, role));
    if (room.state.over) socket.emit('game:over', room.state.over);
  }

  // ── Lobby ──────────────────────────────────────────────────
  socket.on('room:create', ({ name, role } = {}, cb) => {
    const { room, role: hostRole } = rooms.createRoom(name, role);
    const claim = rooms.claimSeat(room, sanitizeName(name), socket.id, hostRole);
    if (!claim.ok) return cb?.(claim);

    code = room.code;
    socket.join(room.code);
    cb?.({ ok: true, code: room.code, role: claim.role, summary: rooms.roomSummary(room) });
    pushRoom(room);
  });

  socket.on('room:join', ({ code: wanted, name } = {}, cb) => {
    const room = rooms.getRoom(wanted);
    if (!room) return cb?.({ ok: false, error: 'Aucune partie ne correspond à ce code.' });

    const claim = rooms.claimSeat(room, sanitizeName(name), socket.id);
    if (!claim.ok) return cb?.(claim);

    code = room.code;
    socket.join(room.code);
    cb?.({ ok: true, code: room.code, role: claim.role, summary: rooms.roomSummary(room) });

    // Reprise après déconnexion : on renvoie la partie en cours et on relance.
    if (room.phase === 'playing' && room.state) {
      sendFullGame(room, claim.role);
      if (room.autoPaused && rooms.bothConnected(room)) {
        apply(room.state, claim.role, 'game:pause', { paused: false });
        room.autoPaused = false;
        if (!room.timer) rooms.startLoop(room, onTick);
        flush(room);
      }
    }
    pushRoom(room);
  });

  socket.on('room:setRole', ({ role } = {}) => {
    const room = currentRoom();
    if (!room || room.phase !== 'lobby') return;
    const mine = rooms.seatOfSocket(room, socket.id);
    const other = role === 'amont' ? 'aval' : 'amont';
    if (!mine || mine === role || !rooms.ROLES.includes(role)) return;
    if (room.seats[role].connected) return; // siège occupé

    room.seats[role] = { ...room.seats[mine] };
    room.seats[mine] = { name: null, socketId: null, connected: false, ready: false, lastSeen: Date.now() };
    void other;
    pushRoom(room);
  });

  socket.on('room:ready', ({ ready } = {}) => {
    const room = currentRoom();
    if (!room || room.phase !== 'lobby') return;
    const role = rooms.seatOfSocket(room, socket.id);
    if (!role) return;
    room.seats[role].ready = !!ready;
    pushRoom(room);

    if (rooms.bothConnected(room) && rooms.bothReady(room)) {
      rooms.startGame(room);
      for (const r of rooms.ROLES) {
        const seat = room.seats[r];
        if (seat.socketId) {
          io.to(seat.socketId).emit('game:init', {
            layout: layoutPayload(),
            rules: rulesPayload(),
            role: r,
            roleLabel: rooms.ROLE_LABELS[r],
            partnerLabel: rooms.ROLE_LABELS[r === 'amont' ? 'aval' : 'amont'],
          });
        }
      }
      pushState(room);
      pushRoom(room);
      rooms.startLoop(room, onTick);
    }
  });

  socket.on('game:restart', () => {
    const room = currentRoom();
    if (!room || room.phase !== 'over') return;
    rooms.resetGame(room);
    io.to(room.code).emit('game:reset');
    pushRoom(room);
  });

  // ── Jeu ────────────────────────────────────────────────────
  socket.on('game:action', ({ type, payload } = {}, cb) => {
    const ctx = seated();
    if (!ctx) return cb?.({ ok: false, error: 'Partie introuvable.' });
    const result = apply(ctx.room.state, ctx.role, String(type ?? ''), payload ?? {});
    flush(ctx.room);
    cb?.(result);
  });

  socket.on('game:voteProposal', ({ id, choice } = {}, cb) => {
    const ctx = seated();
    if (!ctx) return cb?.({ ok: false, error: 'Partie introuvable.' });
    const result = proposals.vote(ctx.room.state, id, ctx.role, choice === 'yes' ? 'yes' : 'no');
    flush(ctx.room);
    cb?.(result);
  });

  socket.on('game:voteCrisis', ({ id, option } = {}, cb) => {
    const ctx = seated();
    if (!ctx) return cb?.({ ok: false, error: 'Partie introuvable.' });
    const result = events.vote(ctx.room.state, id, ctx.role, option);
    flush(ctx.room);
    cb?.(result);
  });

  socket.on('chat:send', ({ text } = {}) => {
    const room = currentRoom();
    if (!room) return;
    const role = rooms.seatOfSocket(room, socket.id);
    if (!role) return;
    const clean = String(text ?? '').slice(0, 280).trim();
    if (!clean) return;

    const msg = { from: role, name: room.seats[role].name, text: clean, at: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > MAX_CHAT) room.chat.shift();
    io.to(room.code).emit('chat:msg', msg);
  });

  // ── Déconnexion ────────────────────────────────────────────
  socket.on('disconnect', () => {
    const room = currentRoom();
    if (!room) return;
    const role = rooms.seatOfSocket(room, socket.id);
    if (!role) return;

    room.seats[role].connected = false;
    room.seats[role].socketId = null;
    room.seats[role].ready = false;
    room.seats[role].lastSeen = Date.now();

    // Le jeu est coopératif : il n'a pas de sens si l'un des deux n'est plus là.
    if (room.phase === 'playing' && room.state?.phase === 'running') {
      apply(room.state, role, 'game:pause', { paused: true });
      room.autoPaused = true;
      rooms.stopLoop(room);
      flush(room);
    }
    pushRoom(room);
  });
});

const sanitizeName = (name) =>
  String(name ?? '').replace(/[<>]/g, '').slice(0, 24).trim() || 'Anonyme';

setInterval(() => rooms.sweep(), 60_000).unref();

export { app, server, io };
export default server;
