/**
 * hud.js — Barre supérieure : les cinq chiffres que les deux joueurs
 * partagent en permanence. Tout le reste est réservé à un rôle.
 */
import { $, eur, int, pct } from './dom.js';

export function createHud() {
  const r = {
    role: $('#hudRole'), day: $('#hudDay'), totalDays: $('#hudTotalDays'),
    dayBar: $('#hudDayBar'), cash: $('#hudCash'), cashFlow: $('#hudCashFlow'),
    value: $('#hudValue'), valueBar: $('#hudValueBar'),
    bikes: $('#hudBikes'), pending: $('#hudPending'),
    morale: $('#hudMorale'), partnerMorale: $('#hudPartnerMorale'),
    partner: $('#hudPartner'), pause: $('#btnPause'),
  };

  return {
    setRole(role, label) {
      r.role.textContent = label;
      r.role.className = `role-pill ${role}`;
    },

    update(v) {
      r.day.textContent = v.day;
      r.totalDays.textContent = `/${v.totalDays}`;
      r.dayBar.style.width = `${(v.day / v.totalDays * 100).toFixed(1)}%`;

      r.cash.textContent = eur(v.cash);
      r.cash.classList.toggle('neg', v.cash < 0);

      const net = -(v.charges.wages + v.charges.upkeep + v.charges.loans);
      r.cashFlow.textContent = `${int(net)} €/j fixes`;

      r.value.textContent = eur(v.companyValue);
      const ratio = Math.max(0, Math.min(1, v.companyValue / v.objective));
      r.valueBar.style.width = `${(ratio * 100).toFixed(1)}%`;
      r.valueBar.style.background = ratio >= 1 ? 'var(--ok)' : 'var(--amont)';
      r.value.classList.toggle('pos', ratio >= 1);

      r.bikes.textContent = int(v.bikes);
      r.pending.textContent = `${int(v.bikesPending)} à contrôler`;

      r.morale.textContent = pct(v.morale.own);
      r.partnerMorale.textContent = `partenaire : ${v.morale.partnerBand}`;

      r.pause.textContent = v.phase === 'paused' ? 'Reprendre' : 'Pause';
      r.pause.disabled = v.phase === 'over';
    },

    setPartner(connected, name) {
      r.partner.textContent = connected ? `${name ?? 'Partenaire'} · en ligne` : 'Partenaire déconnecté';
      r.partner.classList.toggle('off', !connected);
    },

    onPause(fn) { r.pause.addEventListener('click', fn); },
  };
}
