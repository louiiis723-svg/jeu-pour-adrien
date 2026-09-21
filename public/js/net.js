/**
 * net.js — Couche réseau. Enveloppe socket.io pour exposer des appels
 * en promesse, et centraliser la gestion de la reconnexion.
 */

export function createNet() {
  /* global io */
  const socket = io({ transports: ['websocket', 'polling'] });

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
