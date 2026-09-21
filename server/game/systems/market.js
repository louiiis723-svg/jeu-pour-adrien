/**
 * market.js — Demande, concurrence, réputation et offres de contrat.
 *
 * C'est le domaine réservé de J2 : lui seul voit la demande, le prix du
 * concurrent et la marge réelle des contrats. Mais il ne peut pas savoir si
 * l'usine suivra — cette information-là est chez J1.
 */
import * as C from '../constants.js';
import { log, nextId, effectiveCapacity } from '../state.js';

const rand = () => Math.random();
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Demande spot du jour, décomposée pour l'affichage.
 * Formule : base × saison × bruit × campagne × réputation × effet prix.
 */
export function demandBreakdown(s) {
  const m = s.market;
  const season = 1 + C.DEMAND_SEASON_AMP *
    Math.sin((2 * Math.PI * s.day) / C.DEMAND_SEASON_PERIOD);
  const campaign = m.campaignDaysLeft > 0 ? 1 + C.CAMPAIGN_DEMAND_BOOST : 1;
  const reputation = 0.75 + 0.5 * m.reputation;
  const priceEffect = clamp(
    (m.competitorPrice / Math.max(1, m.listPrice)) ** C.DEMAND_PRICE_ELASTICITY,
    0.1, 2.6,
  );
  return { season, campaign, reputation, priceEffect,
           index: season * campaign * reputation };
}

export function tick(s) {
  const m = s.market;

  // Le concurrent ajuste son prix : retour lent vers la référence + aléa.
  m.competitorPrice = Math.round(clamp(
    m.competitorPrice + (C.BIKE_REFERENCE_PRICE - m.competitorPrice) * 0.08
      + (rand() - 0.5) * 55,
    C.PRICE_MIN, C.PRICE_MAX,
  ));

  const d = demandBreakdown(s);
  const noise = 1 + (rand() * 2 - 1) * C.DEMAND_NOISE;
  m.demandIndex = d.index;
  m.spotDemandToday = Math.max(0, Math.round(C.DEMAND_BASE * d.index * d.priceEffect * noise));

  // La réputation revient lentement vers la moyenne du secteur.
  m.reputation = clamp(
    m.reputation + (C.REPUTATION_START - m.reputation) * C.REPUTATION_DECAY * 5,
    0, 1,
  );

  if (m.campaignDaysLeft > 0) {
    m.campaignDaysLeft -= 1;
    if (m.campaignDaysLeft === 0) {
      log(s, 'market', 'La campagne de communication est terminée.', 'aval');
    }
  }

  // Les offres non traitées finissent par partir à la concurrence.
  for (const o of s.offers) o.ttl -= 1;
  const lost = s.offers.filter((o) => o.ttl <= 0);
  for (const o of lost) {
    log(s, 'market', `L'offre de ${o.client} a expiré.`, 'aval');
  }
  s.offers = s.offers.filter((o) => o.ttl > 0);

  // Nouvelle offre de contrat.
  if (s.day >= s.nextContractDay && s.offers.length < C.CONTRACT_MAX_OPEN) {
    s.offers.push(makeOffer(s));
    s.nextContractDay = s.day + Math.max(2, Math.round(C.CONTRACT_INTERVAL_DAYS + (rand() - 0.5) * 4));
  }
}

/**
 * Génère une offre calibrée sur la capacité d'assemblage du moment.
 * `intensity` est le chiffre qui décide de tout : c'est le rapport entre la
 * cadence exigée par le contrat et la cadence actuelle de l'usine. Au-delà
 * de 1, le contrat n'est PAS tenable sans investir — et seul J1 le sait.
 */
export function makeOffer(s) {
  const capacity = Math.max(8, effectiveCapacity(s, 'assembly'));
  const days = 8 + Math.floor(rand() * 11);          // 8 à 18 jours
  const intensity = 0.45 + rand() * 0.9;             // 0,45 à 1,35 × la capacité
  const volume = Math.max(40, Math.round(capacity * days * intensity * 0.7));

  const urgency = clamp((14 - days) / 14, -0.3, 0.45);
  const volumeDiscount = Math.min(0.22, volume / 2000);
  const repFactor = 0.9 + 0.25 * s.market.reputation;
  const unitPrice = Math.round(
    C.BIKE_REFERENCE_PRICE * (1 + urgency * 0.25 - volumeDiscount) * repFactor,
  );

  return {
    id: nextId('offer'),
    client: pick(C.CLIENT_NAMES),
    volume,
    days,
    unitPrice,
    total: volume * unitPrice,
    penalty: Math.round(volume * unitPrice * 0.18),
    /** Cadence exigée, en vélos/jour. Le nombre à confronter à l'usine. */
    ratePerDay: +(volume / days).toFixed(1),
    ttl: C.CONTRACT_OFFER_TTL,
  };
}

/** Transforme une offre acceptée en commande ferme. */
export function signContract(s, offer) {
  const order = {
    id: nextId('order'),
    client: offer.client,
    volume: offer.volume,
    remaining: offer.volume,
    unitPrice: offer.unitPrice,
    penalty: offer.penalty,
    dayDue: s.day + offer.days,
    ratePerDay: offer.ratePerDay,
  };
  s.orders.push(order);
  s.offers = s.offers.filter((o) => o.id !== offer.id);
  log(s, 'contract',
    `Contrat signé avec ${order.client} : ${order.volume} vélos sous ${offer.days} j (${order.ratePerDay}/jour).`);
  return order;
}
