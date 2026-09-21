/**
 * api/server.js — Point d'entrée Vercel.
 *
 * Vercel sert ce fichier comme une Function sous `/api/server` et se charge
 * lui-même de l'écoute réseau : on exporte donc le serveur HTTP sans appeler
 * `listen()`. Les WebSockets sont acheminés vers l'instance qui a accepté la
 * connexion, ce qui permet à Socket.IO de fonctionner normalement.
 *
 * Les fichiers du dossier `public/` sont servis en statique par Vercel, sans
 * passer par cette fonction.
 */
import server from '../server/app.js';

export default server;
