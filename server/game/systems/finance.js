/**
 * finance.js — Trésorerie, charges fixes, emprunts.
 *
 * Toutes les sorties et entrées d'argent du jeu passent par spend() / earn(),
 * pour que le compte de résultat de fin de partie soit toujours juste.
 */
import * as C from '../constants.js';
import { log, nextId } from '../state.js';

/**
 * Toute sortie d'argent. `category` alimente le compte de résultat affiché
 * en fin de partie — c'est ce qui permet aux joueurs de comprendre APRÈS COUP
 * où est passé l'argent, et donc de rejouer différemment.
 */
export function spend(s, amount, category = 'divers', label = null, scope = 'all') {
  if (amount <= 0) return;
  s.cash -= amount;
  s.stats.costs += amount;
  s.stats.charges[category] = (s.stats.charges[category] ?? 0) + amount;
  if (label) log(s, 'cost', `${label} — ${fmt(amount)} €`, scope);
}

/** Toute entrée d'argent, ventilée de la même façon. */
export function earn(s, amount, category = 'divers', label = null, scope = 'all') {
  if (amount <= 0) return;
  s.cash += amount;
  s.stats.revenue += amount;
  s.stats.produits[category] = (s.stats.produits[category] ?? 0) + amount;
  if (label) log(s, 'revenue', `${label} + ${fmt(amount)} €`, scope);
}

/** Une dépense est-elle possible sans franchir le seuil de faillite ? */
export const canAfford = (s, amount) => s.cash - amount >= C.BANKRUPT_CASH;

/** Mensualité d'un emprunt : capital × taux total, étalé sur la durée. */
export const loanDailyPayment = (amount) =>
  Math.round((amount * C.LOAN_TOTAL_RATE) / C.LOAN_TERM_DAYS);

export function takeLoan(s, amount) {
  const loan = {
    id: nextId('loan'),
    principal: amount,
    dailyPayment: loanDailyPayment(amount),
    remainingDays: C.LOAN_TERM_DAYS,
  };
  s.loans.push(loan);
  earn(s, amount, 'emprunts', `Emprunt bancaire de ${fmt(amount)} €`);
  log(s, 'finance',
    `Remboursement : ${fmt(loan.dailyPayment)} €/jour pendant ${C.LOAN_TERM_DAYS} jours.`);
  return loan;
}

/** Encours total restant à rembourser. */
export const totalDebt = (s) =>
  s.loans.reduce((n, l) => n + l.dailyPayment * l.remainingDays, 0);

export function tick(s) {
  // Salaires : on paie TOUS les embauchés, y compris ceux qui ne sont
  // affectés à aucun poste. C'est ce qui rend le sur-effectif coûteux.
  const workers = s.staff.amont + s.staff.aval;
  spend(s, workers * C.WAGE_PER_WORKER, 'salaires');

  // Entretien courant des bâtiments, proportionnel à leur niveau.
  const upkeep = Object.values(s.buildings)
    .reduce((n, b) => n + C.UPKEEP_PER_LEVEL * b.level, 0);
  spend(s, upkeep, 'entretien courant');

  // Échéances d'emprunt.
  for (const loan of s.loans) {
    spend(s, loan.dailyPayment, 'remboursements');
    loan.remainingDays -= 1;
  }
  const cleared = s.loans.filter((l) => l.remainingDays <= 0);
  for (const l of cleared) log(s, 'finance', `Emprunt de ${fmt(l.principal)} € soldé.`);
  s.loans = s.loans.filter((l) => l.remainingDays > 0);

  // Compteur de découvert, pour la condition de faillite.
  if (s.cash < C.BANKRUPT_CASH) s.negativeDays += 1;
  else s.negativeDays = 0;
}

const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
