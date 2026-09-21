/**
 * net.js — Couche réseau. Enveloppe socket.io pour exposer des appels
 * en promesse, et centraliser la gestion de la reconnexion.
 */

/**
 * Chemin du point d'entrée Socket.IO — doit correspondre exactement à
 * SOCKET_PATH dans server/app.js. Sur Vercel, la fonction déployée depuis
 * `api/server.js` est servie sous `/api/server`, et Socket.IO ajoute
 * `/socket.io` derrière. On utilise le même chemin en local pour que le code
 * client soit identique dans les deux environnements.
 */
export const SOCKET_PATH = '/api/server/socket.io';

export function createNet() {
  /* global io */
  const socket = io({
    path: SOCKET_PATH,
    // Vercel ne prend pas en charge le long-polling pour Socket.IO.
    transports: ['websocket'],
  });

  return {
    socket,
    /** Émission avec accusé de réception, en promesse. */
    ask(event, payload) {
      return new Promise((resolve) => {
        let settled = false;
        const done = (res) => { if (!settled) { settled = true; resolve(res ?? { ok: true }); } };
        socket.emit(event, payload, done);
        setTimeout(() => done({ ok: false, error: 'Le serveur ne répond pas.' }), 8000);
      });
    },
    send(event, payload) { socket.emit(event, payload); },
    on(event, handler) { socket.on(event, handler); },
  };
}
