/**
 * index.js — Lancement en local (`npm start`).
 *
 * Toute la logique vit dans `server/app.js`. Ce fichier ne fait qu'écouter un
 * port, ce que Vercel gère lui-même de son côté (voir `api/server.js`).
 */
import server from './app.js';

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`\n  Voltra Industries — serveur démarré`);
  console.log(`  ▸ http://localhost:${PORT}\n`);
});
