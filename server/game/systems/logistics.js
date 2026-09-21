/**
 * logistics.js — Expéditions, honorabilité des contrats, ventes spot.
 *
 * Ordre de priorité : les contrats d'abord, par échéance la plus proche,
 * puis le reliquat part en vente spot. Le quai d'expédition plafonne le tout,
 * ce qui en fait un goulot invisible tant qu'on ne l'a pas saturé une fois.
 */
import * as C from '../constants.js';
import { effectiveCapacity, log } from '../state.js';
import { earn, spend } from './finance.js';

export function tick(s) {
  const b = s.buildings.shipping;
  const previousBottleneck = b.bottleneck;
  let budget = Math.floor(effectiveCapacity(s, 'shipping'));
  const capacity = budget;
  let shippedTotal = 0;

  // ── 1. Contrats, échéance la plus proche en premier ──────────
  const byDeadline = [...s.orders].sort((a, b2) => a.dayDue - b2.dayDue);
  for (const order of byDeadline) {
    if (budget <= 0 || s.bikes <= 0) break;
    const qty = Math.min(order.remaining, s.bikes, budget);
    if (qty <= 0) continue;

    s.bikes -= qty;
    budget -= qty;
    shippedTotal += qty;
    order.remaining -= qty;
    earn(s, qty * order.unitPrice, 'contrats');
    s.stats.shipped += qty;

    if (order.remaining === 0) {
      s.stats.contractsDone += 1;
      s.market.reputation = Math.min(1, s.market.reputation + C.REPUTATION_ON_TIME);
      log(s, 'contract',
        `Contrat ${order.client} honoré intégralement (+${(order.volume * order.unitPrice).toLocaleString('fr-FR')} €).`);
    }
  }
  s.orders = s.orders.filter((o) => o.remaining > 0);

  // ── 2. Contrats en retard : pénalité forfaitaire et réputation ──
  const failed = s.orders.filter((o) => s.day >= o.dayDue);
  for (const o of failed) {
    spend(s, o.penalty, 'pénalités de retard');
    s.stats.contractsFailed += 1;
    s.market.reputation = Math.max(0, s.market.reputation + C.REPUTATION_LATE);
    log(s, 'danger',
      `Contrat ${o.client} NON honoré (${o.remaining} vélos manquants) — pénalité de ${o.penalty.toLocaleString('fr-FR')} €.`);
  }
  s.orders = s.orders.filter((o) => s.day < o.dayDue);

  // ── 3. Ventes spot sur ce qu'il reste ────────────────────────
  const demand = s.market.spotDemandToday ?? 0;
  const spot = Math.max(0, Math.min(demand, s.bikes, budget));
  if (spot > 0) {
    s.bikes -= spot;
    budget -= spot;
    shippedTotal += spot;
    earn(s, spot * s.market.listPrice, 'ventes spot');
    s.stats.shipped += spot;
    s.stats.spotSold += spot;
  }

  b.lastOutput = shippedTotal;
  b.load = capacity > 0 ? shippedTotal / capacity : 0;
  b.bottleneck =
    capacity > 0 && budget <= 0 && (s.bikes > 0 || s.orders.some((o) => o.remaining > 0))
      ? 'shipCapacity'
      : null;

  if (b.bottleneck === 'shipCapacity' && previousBottleneck !== 'shipCapacity') {
    log(s, 'warn',
      `Quai d'expédition saturé : ${capacity} vélos/jour, et ${s.bikes} en attente. Envisagez un niveau supplémentaire.`,
      'aval');
  }

  s.market.unmetDemand = Math.max(0, demand - spot);
}
