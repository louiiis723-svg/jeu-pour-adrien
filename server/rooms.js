/**
 * rooms.js — Registre des parties et cycle de vie d'une room.
 *
 * Une room = une entreprise = deux sièges (amont / aval). Le code de partie
 * sert de lien de partage : le premier joueur crée, le second rejoint.
 *
 * Les rooms vivent en mémoire. Pour ajouter de la persistance plus tard, il
 * suffit de sérialiser `room.state` (c'est du JSON pur) et de recharger.
 */
import { createInitialState } from './game/state.js';
import { TICK_MS } from './game/constants.js';

/** Alphabet sans caractères ambigus : ni O/0, ni I/1. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const EMPTY_ROOM_TTL_MS = 15 * 60 * 1000;

export const ROLES = ['amont', 'aval'];
export const ROLE_LABELS = {
  amont: 'Direction Industrielle',
  aval: 'Direction Commerciale',
};

/** @type {Map<string, Room>} */
const rooms = new Map();

function generateCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  // Repli improbable : on rallonge plutôt que d'échouer.
  return `${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function makeSeat() {
  return { name: null, socketId: null, connected: false, ready: false, lastSeen: 0 };
}

export function createRoom(name, preferredRole = 'amont') {
  const code = generateCode();
  const role = ROLES.includes(preferredRole) ? preferredRole : 'amont';
  const room = {
    code,
    createdAt: Date.now(),
    phase: 'lobby',          // 'lobby' | 'playing' | 'over'
    hostRole: role,
    seats: { amont: makeSeat(), aval: makeSeat() },
    state: null,
    timer: null,
    /** Journal complet non filtré, pour rejouer l'historique aux reconnexions. */
    log: [],
    chat: [],
    /** Pause automatique quand un joueur se déconnecte. */
    autoPaused: false,
  };
  rooms.set(code, room);
  return { room, role };
}

export const getRoom = (code) => rooms.get(String(code ?? '').toUpperCase().trim()) ?? null;

/**
 * Attribue un siège dans une room.
 * Un siège déconnecté est réattribuable : c'est ce qui permet de reprendre
 * la partie après un rafraîchissement de page.
 */
export function claimSeat(room, name, socketId, wantedRole = null) {
  const free = ROLES.filter((r) => !room.seats[r].connected);
  if (!free.length) return { ok: false, error: 'Cette partie est déjà complète.' };

  const role = wantedRole && free.includes(wantedRole) ? wantedRole : free[0];
  const seat = room.seats[role];
  const reconnecting = seat.name !== null;

  seat.name = name || seat.name || 'Anonyme';
  seat.socketId = socketId;
  seat.connected = true;
  seat.lastSeen = Date.now();
  return { ok: true, role, reconnecting };
}

export function seatOfSocket(room, socketId) {
  for (const role of ROLES) {
    if (room.seats[role].socketId === socketId) return role;
  }
  return null;
}

export const bothConnected = (room) => ROLES.every((r) => room.seats[r].connected);
export const bothReady = (room) => ROLES.every((r) => room.seats[r].ready);

export function startGame(room) {
  room.state = createInitialState();
  room.phase = 'playing';
  room.log = [];
  room.autoPaused = false;
  return room.state;
}

/** Remet la room en lobby pour rejouer, sièges conservés. */
export function resetGame(room) {
  stopLoop(room);
  room.state = null;
  room.phase = 'lobby';
  room.log = [];
  room.chat = [];
  room.autoPaused = false;
  for (const r of ROLES) room.seats[r].ready = false;
}

export function startLoop(room, onTick) {
  stopLoop(room);
  room.timer = setInterval(() => onTick(room), TICK_MS);
}

export function stopLoop(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}

export function destroyRoom(room) {
  stopLoop(room);
  rooms.delete(room.code);
}

/** Vue publique d'une room, pour l'écran de lobby. */
export function roomSummary(room) {
  return {
    code: room.code,
    phase: room.phase,
    seats: Object.fromEntries(ROLES.map((r) => [r, {
      role: r,
      label: ROLE_LABELS[r],
      name: room.seats[r].name,
      connected: room.seats[r].connected,
      ready: room.seats[r].ready,
    }])),
  };
}

/** Supprime les rooms vides depuis trop longtemps. */
export function sweep() {
  const now = Date.now();
  for (const room of rooms.values()) {
    const idle = ROLES.every((r) => !room.seats[r].connected);
    const since = Math.max(...ROLES.map((r) => room.seats[r].lastSeen), room.createdAt);
    if (idle && now - since > EMPTY_ROOM_TTL_MS) destroyRoom(room);
  }
}

export const roomCount = () => rooms.size;
