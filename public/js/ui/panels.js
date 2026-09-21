/**
 * panels.js — Panneau latéral gauche, spécifique au rôle.
 *
 * Les deux joueurs ne voient PAS le même panneau, et ce n'est pas un choix
 * d'ergonomie : les données absentes de leur projection n'arrivent tout
 * simplement jamais jusqu'ici (voir server/game/visibility.js).
 *
 * Conventions :
 *   · tout élément cliquable porte data-act, traité par délégation
 *   · aucun listener n'est attaché aux nœuds re-rendus
 */
import { render, eur, int, dec, pct, esc, gauge, row, section, heat } from './dom.js';

const MAT_COLORS = { alu: '#8b9bb4', cells: '#5eead4', elec: '#c4b5fd' };
const PART_LABELS = { frames: 'Cadres', batteries: 'Batteries', motors: 'Moteurs' };

export function createPanel(root, ctx) {
  root.addEventListener('click', (e) => {
    const target = e.target.closest('[data-act]');
    if (target) ctx.onAction(target.dataset, root);
  });
  root.addEventListener('change', (e) => {
    if (e.target.dataset.act === 'price') {
      ctx.send('market:setPrice', { price: Number(e.target.value) });
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.dataset.act === 'price') {
      const out = root.querySelector('#priceOut');
      if (out) out.textContent = eur(e.target.value);
    }
    if (e.target.dataset.mat) refreshOrderTotal(root);
  });

  return {
    update(view) {
      render(root, view.role === 'amont' ? amontPanel(view, ctx) : avalPanel(view, ctx));
      if (view.role === 'amont') refreshOrderTotal(root);
    },
  };
}

/** Recalcule le montant de la commande en cours de saisie, à la volée. */
function refreshOrderTotal(root) {
  const out = root.querySelector('#orderTotal');
  if (!out) return;
  let total = 0;
  for (const input of root.querySelectorAll('input[data-mat]')) {
    total += (Number(input.value) || 0) * Number(input.dataset.price || 0);
  }
  out.textContent = eur(total);
  out.style.color = total > 0 ? 'var(--fg)' : 'var(--fg-mute)';
}

// ═════════════════════════════════════════════════════════════
// Direction Industrielle (amont)
// ═════════════════════════════════════════════════════════════
function amontPanel(v, ctx) {
  const a = v.amont;
  if (!a) return '';
  const sup = a.supplier;

  // Couverture en jours : le chiffre que J1 doit surveiller en permanence.
  const rate = Math.min(
    v.buildings.frames.capacity ?? 0, v.buildings.batteries.capacity ?? 0,
    v.buildings.motors.capacity ?? 0, 99,
  );
  const perBike = { alu: 9, cells: 12, elec: 2 };
  const coverage = (mat) => {
    const daily = rate * perBike[mat];
    return daily > 0 ? a.materials[mat] / daily : Infinity;
  };
  const worst = Math.min(...Object.keys(perBike).map(coverage));

  return [
    section('Approvisionnement', `qualité stock ${pct(a.matQuality)}`, `
      ${a.suppliers.map((s) => `
        <button class="supplier ${s.id === sup.id ? 'selected' : ''}" data-act="supplier" data-id="${s.id}" type="button">
          <strong>${esc(s.name)}</strong>
          <div class="sup-metrics">
            <span>×${s.priceMult}</span>
            <span>qualité ${pct(s.quality)}</span>
            <span>${s.leadTime} j</span>
          </div>
          <small>${esc(s.note)}</small>
        </button>`).join('')}

      <div class="unit">
        <div class="unit-head"><span class="unit-name">Passer commande</span>
          <span class="unit-out muted tiny">livraison ${sup.leadTime} j</span></div>
        <div class="unit-grid">
          ${Object.entries(a.materialsMeta).map(([id, m]) => `
            <div class="row">
              <span class="row-label">${esc(m.label)}
                <span class="muted tiny">${dec(m.basePrice * sup.priceMult, 2)} €/${m.unit}</span></span>
              <input id="ord_${id}" type="number" min="0" max="20000" step="50" value="0"
                     style="width:82px" data-mat="${id}"
                     data-price="${(m.basePrice * sup.priceMult).toFixed(3)}">
            </div>`).join('')}
          ${row('Total', '<span id="orderTotal">0 €</span>')}
          <button class="btn" data-act="order" type="button">Commander</button>
          <div class="tiny muted">Au-delà de ${int(ctx.rules.cosignThreshold)} €, la commande passe en contre-signature.</div>
        </div>
      </div>

      ${a.deliveries.length ? `<div class="unit">
        <div class="unit-head"><span class="unit-name">En transit</span></div>
        ${a.deliveries.map((d) => `<div class="row tiny">
          <span class="row-label">${esc(d.supplierName)} · ${int(d.items.alu + d.items.cells + d.items.elec)} u</span>
          <span class="row-value">J-${d.daysLeft}</span></div>`).join('')}
      </div>` : ''}
    `),

    section('Dépôt matières', `${int(a.materialsTotal)} / ${int(a.depotCapacity)}`, `
      ${Object.entries(a.materialsMeta).map(([id, m]) => {
        // La barre se lit en COUVERTURE (objectif : 10 jours), pas en part de
        // capacité : c'est le nombre de jours restants qui décide d'une
        // commande, pas la place disponible dans le dépôt.
        const daily = rate * perBike[id];
        const target = Math.max(1, Math.round(daily * 10));
        return gauge(m.label, a.materials[id], target, MAT_COLORS[id],
          `${dec(Math.min(coverage(id), 99), 1)} j de couverture · objectif 10 j`);
      }).join('')}
      ${worst < 3 ? `<div class="chip danger">Rupture imminente — ${dec(worst, 1)} j de couverture</div>` : ''}
    `),

    section('Ateliers de composants', `${int(v.buildings.frames.lastOutput + v.buildings.batteries.lastOutput + v.buildings.motors.lastOutput)} pièces/j`,
      ['frames', 'batteries', 'motors'].map((id) => unitCard(id, v, ctx)).join('')),

    teamSection(v, ctx, 'amont'),
    financeSection(v, ctx),
  ].join('');
}

// ═════════════════════════════════════════════════════════════
// Direction Commerciale (aval)
// ═════════════════════════════════════════════════════════════
function avalPanel(v, ctx) {
  const d = v.aval;
  if (!d) return '';
  const m = d.market;
  const defect = d.defects;

  const committed = v.orders.reduce(
    (n, o) => n + o.remaining / Math.max(1, o.daysLeft), 0);
  const capacity = v.buildings.assembly.capacity ?? 0;

  return [
    section('Marché', `demande ${int(m.spotDemandToday)}/j`, `
      <div class="unit">
        <div class="unit-head"><span class="unit-name">Prix catalogue</span>
          <span class="unit-out" id="priceOut">${eur(m.listPrice)}</span></div>
        <input type="range" data-act="price" min="${m.priceBounds.min}" max="${m.priceBounds.max}"
               step="10" value="${m.listPrice}" id="priceRange">
        <div class="unit-grid" style="margin-top:8px">
          ${row('Concurrent', `<b>${eur(m.competitorPrice)}</b>`)}
          ${row('Demande spot du jour', `<b>${int(m.spotDemandToday)}</b> vélos`)}
          ${m.unmetDemand > 0 ? row('Demande non servie', `<b style="color:var(--warn)">${int(m.unmetDemand)}</b>`) : ''}
          ${row('Réputation', `<b>${pct(m.reputation)}</b>`)}
          ${row('Marge unitaire', `<b>${eur(m.listPrice - d.bikeMaterialCost)}</b>`)}
        </div>
        <div class="formula">
          <b>demande</b> = base × saison ${dec(m.breakdown.season, 2)}
          × campagne ${dec(m.breakdown.campaign, 2)}
          × réputation ${dec(m.breakdown.reputation, 2)}
          × effet prix ${dec(m.breakdown.priceEffect, 2)}
        </div>
        <div class="unit-actions">
          <button class="btn btn-sm" data-act="campaign" type="button"
            ${m.campaignDaysLeft > 0 ? 'disabled' : ''}>
            ${m.campaignDaysLeft > 0 ? `Campagne en cours · J-${m.campaignDaysLeft}` : `Campagne ${int(ctx.rules.campaignCost)} €`}
          </button>
        </div>
      </div>

      <div class="unit">
        <div class="unit-head"><span class="unit-name">Taux de défaut</span>
          <span class="unit-out ${defect.total > 0.1 ? '' : ''}" style="color:${defect.total > 0.1 ? 'var(--danger)' : 'var(--fg)'}">${dec(defect.total * 100, 1)} %</span></div>
        <div class="formula">
          <b>base</b> ${dec(defect.base * 100, 1)} %
          · <b>usure ligne</b> +${dec(defect.fromWear * 100, 1)}
          · <b>moral</b> +${dec(defect.fromMorale * 100, 1)}
          · <b>matières</b> +${dec(defect.fromSupplier * 100, 1)}
        </div>
        ${defect.fromSupplier > 0.02
          ? '<div class="chip warn" style="margin-top:7px">Les matières dégradent la qualité — demandez à l’Industrie quel fournisseur est actif.</div>'
          : ''}
      </div>
    `),

    section('Contrats', `engagé ${dec(committed, 1)} / ${dec(capacity, 1)} par jour`, `
      ${d.offers.length ? d.offers.map((o) => offerCard(o, capacity, committed)).join('')
        : '<div class="tiny muted">Aucune offre sur le bureau. Les clients se manifestent tous les 5 jours environ.</div>'}
      ${v.orders.length ? `<div class="sec-head" style="padding:6px 0 4px">En cours</div>
        ${v.orders.map((o) => orderCard(o)).join('')}` : ''}
    `),

    section('Chaîne aval', `${int(v.buildings.shipping.lastOutput)} expédiés/j`,
      ['assembly', 'quality', 'shipping'].map((id) => unitCard(id, v, ctx)).join('')),

    teamSection(v, ctx, 'aval'),
    financeSection(v, ctx),
  ].join('');
}

// ═════════════════════════════════════════════════════════════
// Blocs communs
// ═════════════════════════════════════════════════════════════

/** Carte d'un poste de travail : le seul endroit où l'on pilote la production. */
function unitCard(id, v, ctx) {
  const b = v.buildings[id];
  const cls = b.broken ? 'alert' : b.work ? 'working' : b.owner;
  const loadColor = heat(b.load ?? 0);

  const bottleneck = {
    materials: 'Bridé : plus de matière',
    bufferFull: 'Bridé : tampon plein',
    parts: 'Bridé : composants manquants',
    shipCapacity: 'Quai saturé',
    backlog: 'File d’attente au contrôle',
    broken: 'En panne',
    stopped: 'À l’arrêt',
    work: 'Chantier en cours',
  }[b.bottleneck] ?? null;

  const canAct = !b.work && !b.broken;

  return `
  <div class="unit ${cls}">
    <div class="unit-head">
      <span class="unit-name">${esc(b.label)}</span>
      <span class="unit-lvl">niv.${b.level}</span>
      <span class="unit-out">${int(b.lastOutput)}<span class="muted">/j</span></span>
    </div>

    ${b.work ? `<div class="chip info">${({ upgrade: 'Amélioration', service: 'Révision', repair: 'Réparation', halt: 'Arrêt forcé' })[b.work.kind]} — encore ${b.work.daysLeft} j</div>`
      : b.broken ? '<div class="chip danger">En panne — production nulle</div>' : ''}

    <div class="unit-grid" style="margin-top:7px">
      ${b.capacity !== undefined ? `
        <div class="gauge">
          <div class="gauge-top"><span class="muted">Charge</span>
            <b>${dec((b.load ?? 0) * 100, 0)} %<span class="muted"> de ${dec(b.capacity, 1)}/j</span></b></div>
          <div class="gauge-bar"><i style="width:${Math.min(100, (b.load ?? 0) * 100)}%;background:${loadColor}"></i></div>
        </div>` : ''}

      ${b.wear !== undefined ? `
        <div class="gauge">
          <div class="gauge-top"><span class="muted">Usure</span><b>${pct(b.wear)}</b></div>
          <div class="gauge-bar"><i style="width:${b.wear * 100}%;background:${heat(b.wear)}"></i></div>
        </div>` : ''}

      <div class="row">
        <span class="row-label">Effectif <span class="muted tiny">nominal ${b.nominalStaff}</span></span>
        <span class="stepper">
          <button class="btn btn-sm" data-act="staff" data-id="${id}" data-delta="-1" type="button" ${b.staff <= 0 ? 'disabled' : ''}>−</button>
          <span class="val ${b.staff < b.nominalStaff ? 'muted' : ''}">${b.staff}</span>
          <button class="btn btn-sm" data-act="staff" data-id="${id}" data-delta="1" type="button">+</button>
        </span>
      </div>
    </div>

    ${bottleneck ? `<div class="chip ${b.broken || b.bottleneck === 'materials' ? 'danger' : 'warn'}" style="margin-top:7px">${bottleneck}</div>` : ''}

    <div class="unit-actions">
      ${b.broken
        ? `<button class="btn btn-sm" data-act="repair" data-id="${id}" type="button" ${b.work ? 'disabled' : ''}>Réparer ${int(ctx.rules.repairCost)} €</button>`
        : `<button class="btn btn-sm" data-act="service" data-id="${id}" type="button" ${!canAct ? 'disabled' : ''}>Réviser ${int(ctx.rules.serviceCost)} €</button>`}
      ${b.upgradeCost ? `<button class="btn btn-sm" data-act="upgrade" data-id="${id}" type="button" ${!canAct ? 'disabled' : ''}>Niveau ${b.level + 1} · ${int(b.upgradeCost)} €</button>` : ''}
      <button class="btn btn-sm" data-act="toggle" data-id="${id}" data-on="${b.active ? '0' : '1'}" type="button" ${b.work || b.broken ? 'disabled' : ''}>
        ${b.active ? 'Arrêter' : 'Redémarrer'}
      </button>
    </div>
  </div>`;
}

function offerCard(o, capacity, committed) {
  const free = Math.max(0, capacity - committed);
  const tight = o.ratePerDay > free;
  return `
  <div class="deal ${tight ? 'tight' : ''}">
    <div class="deal-head">
      <span class="deal-client">${esc(o.client)}</span>
      <span class="tiny muted">expire J-${o.ttl}</span>
    </div>
    <div class="deal-metrics">
      <div><span>Volume</span> <b>${int(o.volume)}</b></div>
      <div><span>Délai</span> <b>${o.days} j</b></div>
      <div><span>Cadence</span> <b style="color:${tight ? 'var(--warn)' : 'var(--ok)'}">${dec(o.ratePerDay, 1)}/j</b></div>
      <div><span>Prix unit.</span> <b>${eur(o.unitPrice)}</b></div>
      <div><span>Produit</span> <b>${eur(o.total)}</b></div>
      <div><span>Pénalité</span> <b style="color:var(--danger)">${eur(o.penalty)}</b></div>
    </div>
    ${tight ? `<div class="chip warn" style="margin-bottom:7px">Au-dessus de votre cadence libre (${dec(free, 1)}/j). Demandez à l’Industrie si l’usine peut suivre.</div>` : ''}
    <div class="deal-actions">
      <button class="btn btn-sm btn-accept" data-act="accept" data-id="${o.id}" type="button">Proposer la signature</button>
      <button class="btn btn-sm" data-act="decline" data-id="${o.id}" type="button">Décliner</button>
    </div>
  </div>`;
}

function orderCard(o) {
  const done = o.volume - o.remaining;
  const need = o.remaining / Math.max(1, o.daysLeft);
  const late = o.daysLeft <= 2;
  return `
  <div class="deal ${late ? 'late' : ''}">
    <div class="deal-head">
      <span class="deal-client">${esc(o.client)}</span>
      <span class="tiny ${late ? '' : 'muted'}" style="${late ? 'color:var(--danger)' : ''}">J-${o.daysLeft}</span>
    </div>
    <div class="gauge" style="margin:7px 0">
      <div class="gauge-top"><span class="muted">Livré</span><b>${int(done)} / ${int(o.volume)}</b></div>
      <div class="gauge-bar"><i style="width:${(done / o.volume * 100).toFixed(1)}%;background:var(--ok)"></i></div>
    </div>
    <div class="tiny ${need > 0 ? '' : 'muted'}">Reste <b>${dec(need, 1)}</b> vélos/jour à tenir${o.penalty ? ` · pénalité ${eur(o.penalty)}` : ''}</div>
  </div>`;
}

function teamSection(v, ctx, division) {
  const total = v.staff[division];
  const assigned = v.staff.assigned[division];
  const idle = v.staff.idle[division];
  return section('Équipe ' + (division === 'amont' ? 'industrielle' : 'commerciale'),
    `${int(total)} personnes`, `
    ${row('Affectés', `<b>${assigned}</b>`)}
    ${row('Non affectés <span class="muted tiny">payés quand même</span>',
      `<b style="color:${idle > 0 ? 'var(--warn)' : 'var(--fg)'}">${idle}</b>`)}
    ${row('Masse salariale', `<b>${eur(total * ctx.rules.wagePerWorker)}/j</b>`)}
    <div class="gauge">
      <div class="gauge-top"><span class="muted">Moral</span><b>${pct(v.morale.own)} · ${v.morale.ownBand}</b></div>
      <div class="gauge-bar"><i style="width:${v.morale.own * 100}%;background:${heat(v.morale.own, true)}"></i></div>
      <div class="tiny muted">Le moral agit sur la cadence ET sur le taux de défaut.</div>
    </div>
    <div class="unit-actions">
      <button class="btn btn-sm" data-act="hire" data-n="1" type="button">+1 · ${int(ctx.rules.hireCost)} €</button>
      <button class="btn btn-sm" data-act="hire" data-n="3" type="button">+3</button>
      <button class="btn btn-sm" data-act="fire" data-n="1" type="button" ${total < 1 ? 'disabled' : ''}>−1</button>
      <button class="btn btn-sm" data-act="bonus" type="button">Prime · ${int(total * ctx.rules.bonusPerWorker)} €</button>
    </div>
  `);
}

function financeSection(v, ctx) {
  const c = v.charges;
  return section('Finance', v.debt > 0 ? `dette ${int(v.debt)} €` : 'sans dette', `
    ${row('Salaires', `<b>${eur(c.wages)}/j</b>`)}
    ${row('Entretien', `<b>${eur(c.upkeep)}/j</b>`)}
    ${c.loans ? row('Échéances', `<b>${eur(c.loans)}/j</b>`) : ''}
    ${row('Total charges fixes', `<b>${eur(c.wages + c.upkeep + c.loans)}/j</b>`, 'num')}
    ${v.loans.map((l) => `<div class="tiny muted">Emprunt ${int(l.principal)} € · ${int(l.dailyPayment)} €/j · encore ${l.remainingDays} j</div>`).join('')}
    <div class="row">
      <input id="loanAmount" type="number" min="10000" max="${ctx.rules.loanMax}" step="5000" value="50000" style="width:110px">
      <button class="btn btn-sm" data-act="loan" type="button">Emprunter</button>
    </div>
    <div class="tiny muted">Remboursement sur ${ctx.rules.loanTermDays} jours, coût total ×${ctx.rules.loanTotalRate}. Toujours contre-signé.</div>
  `);
}

// ═════════════════════════════════════════════════════════════
// Carte du tampon (panneau droit) — l'objet partagé par les deux
// ═════════════════════════════════════════════════════════════
export function renderBuffer(root, v) {
  const cap = v.buffer.capacity;
  const worst = Math.max(v.buffer.frames, v.buffer.batteries, v.buffer.motors) / cap;
  const min = Math.min(v.buffer.frames, v.buffer.batteries, v.buffer.motors);

  let note = '';
  if (worst > 0.92) {
    note = '<div class="chip danger">Tampon saturé : l’amont se bloque. L’aval doit consommer plus vite.</div>';
  } else if (min === 0) {
    note = '<div class="chip warn">Un composant manque : l’assemblage tourne à vide.</div>';
  } else if (min < cap * 0.12) {
    note = '<div class="chip warn">Stock tampon bas — l’aval risque la rupture.</div>';
  } else {
    note = '<div class="chip ok">Flux équilibré.</div>';
  }

  render(root, `
    <div class="buffer-title">Tampon central · partagé</div>
    <div class="buffer-gauges">
      ${['frames', 'batteries', 'motors'].map((k) => gauge(
        PART_LABELS[k], v.buffer[k], cap,
        v.buffer[k] / cap > 0.92 ? 'var(--danger)' : v.buffer[k] === 0 ? 'var(--danger)' : 'var(--shared)',
      )).join('')}
    </div>
    <div class="buffer-note">${note}</div>
    <div class="row tiny muted" style="margin-top:8px">
      <span>Vélos à contrôler ${int(v.bikesPending)}</span>
      <span>Prêts à expédier <b>${int(v.bikes)}</b></span>
    </div>
  `);
}

// ═════════════════════════════════════════════════════════════
// Boutons de partage d'information
// ═════════════════════════════════════════════════════════════
const SHARE_KEYS = {
  amont: [
    ['materials', 'Stocks'], ['wear', 'Usure'], ['capacity', 'Cadences'],
    ['supplier', 'Fournisseur'], ['morale', 'Moral'],
  ],
  aval: [
    ['demand', 'Demande'], ['reputation', 'Réputation'], ['defects', 'Défauts'],
    ['offers', 'Offres'], ['morale', 'Moral'],
  ],
};

export function renderShare(root, role) {
  render(root, `
    <div class="share-title">Partager une donnée dans le journal</div>
    <div class="share-buttons">
      ${SHARE_KEYS[role].map(([key, label]) =>
        `<button class="btn btn-sm" data-act="share" data-key="${key}" type="button">${label}</button>`).join('')}
    </div>
  `);
}

// ═════════════════════════════════════════════════════════════
// Inspecteur : la formule derrière le chiffre
// ═════════════════════════════════════════════════════════════
export function renderInspector(root, id, v) {
  if (!id || !v?.buildings[id]) { root.hidden = true; return; }
  const b = v.buildings[id];
  root.hidden = false;

  const bd = b.breakdown;
  // `wear` n'est envoyé qu'au propriétaire du poste : sa présence est donc
  // le marqueur fiable de « ce bâtiment est à moi ».
  const mine = b.wear !== undefined;
  const detailed = mine;

  render(root, `
    <button class="insp-close" data-act="closeInspector" type="button" aria-label="Fermer">×</button>
    <h3>${esc(b.label)}</h3>
    <p class="insp-desc">${esc(b.desc)}</p>
    <div class="insp-rows">
      ${row('Niveau', `<b>${b.level} / ${b.maxLevel}</b>`)}
      ${row('Production du jour', `<b>${int(b.lastOutput)}</b>`)}
      ${detailed ? row('Usure', `<b>${pct(b.wear)}</b>`) : row('État', `<b>${({ ok: 'Nominal', degraded: 'Dégradé', stopped: 'Arrêté', work: 'En chantier' })[b.status]}</b>`)}
      ${row('Effectif', `<b>${b.staff} / ${b.nominalStaff}</b>`)}
    </div>
    ${bd ? `<div class="formula">
      <b>capacité</b> = ${dec(bd.base, 0)}
      × niveau ${dec(bd.levelMult, 2)}
      × effectif ${dec(bd.staffRatio, 2)}
      × usure ${dec(bd.wearFactor, 2)}
      × moral ${dec(bd.paceFactor, 2)}
      = <b style="color:var(--fg)">${dec(bd.total, 1)} / jour</b>
    </div>` : `<div class="formula">Ce poste relève de l’autre direction : vous n’en voyez que l’état général.</div>`}
  `);
}
