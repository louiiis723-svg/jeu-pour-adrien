/**
 * supply.js — Fournisseurs, commandes de matières, livraisons en transit.
 *
 * Arbitrage central pour J1 : un fournisseur moins cher livre plus lentement
 * ET dégrade la qualité des matières, ce qui ne se paie qu'au contrôle
 * qualité, plusieurs jours plus tard, dans le camp de J2.
 */
import * as C from '../constants.js';
import { log, nextId, supplierOf, depotCapacity, materialsTotal } from '../state.js';
import { spend } from './finance.js';

/** Prix unitaire d'une matière chez le fournisseur actif. */
export const unitPrice = (s, mat) =>
  C.MATERIALS[mat].basePrice * supplierOf(s).priceMult;

/** Coût total d'un panier { alu, cells, elec }. */
export function quote(s, items) {
  return Object.entries(items)
    .reduce((sum, [mat, qty]) => sum + (qty > 0 ? qty * unitPrice(s, mat) : 0), 0);
}

/** Place une commande : payée immédiatement, livrée après le délai du fournisseur. */
export function placeOrder(s, items) {
  const sup = supplierOf(s);
  const cost = quote(s, items);
  spend(s, cost, 'matières premières');

  const delivery = {
    id: nextId('dlv'),
    supplierId: sup.id,
    supplierName: sup.name,
    quality: sup.quality,
    items: { ...items },
    daysLeft: sup.leadTime,
    cost,
  };
  s.deliveries.push(delivery);

  const detail = Object.entries(items)
    .filter(([, q]) => q > 0)
    .map(([m, q]) => `${q} ${C.MATERIALS[m].unit} ${C.MATERIALS[m].label.toLowerCase()}`)
    .join(', ');
  log(s, 'supply',
    `Commande passée chez ${sup.name} (${detail}) — ${Math.round(cost).toLocaleString('fr-FR')} €, livraison sous ${sup.leadTime} j.`,
    'amont');
  return delivery;
}

export function tick(s) {
  const arrived = [];
  for (const d of s.deliveries) {
    d.daysLeft -= 1;
    if (d.daysLeft <= 0) arrived.push(d);
  }
  if (!arrived.length) {
    s.deliveries = s.deliveries.filter((d) => d.daysLeft > 0);
    return;
  }

  const capacity = depotCapacity(s);
  for (const d of arrived) {
    const incoming = d.items.alu + d.items.cells + d.items.elec;
    const room = Math.max(0, capacity - materialsTotal(s));
    const ratio = incoming > 0 ? Math.min(1, room / incoming) : 1;

    // La qualité du stock est une moyenne pondérée : mélanger du bas de gamme
    // dans un dépôt bien fourni ne dégrade que progressivement la production.
    const before = materialsTotal(s);
    const accepted = Math.floor(incoming * ratio);
    if (accepted > 0) {
      s.matQuality = (s.matQuality * before + d.quality * accepted) / (before + accepted);
    }

    for (const mat of Object.keys(C.MATERIALS)) {
      s.materials[mat] += Math.floor(d.items[mat] * ratio);
    }

    if (ratio < 1) {
      log(s, 'warn',
        `Dépôt saturé : ${Math.round((1 - ratio) * 100)} % de la livraison ${d.supplierName} refusée et perdue.`,
        'amont');
    } else {
      log(s, 'supply', `Livraison ${d.supplierName} réceptionnée.`, 'amont');
    }
  }
  s.deliveries = s.deliveries.filter((d) => d.daysLeft > 0);
}
