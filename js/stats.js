/* ============================================================
   STATISTIQUES — coeff/marge par variante (public & B2B), KPI,
   graphiques Chart.js + drill-down. Portage de l'ancienne page
   "statistics.html" du Calculateur de Prix — demande explicite
   d'Antho pour retrouver ses stats de coeff/marge.
   Page à part entière (pas un onglet de Synthèses/Tableau de
   bord) : Antho a explicitement demandé de fusionner la valorisation
   (Synthèses) dans le Tableau de bord — redondante avec sa "Vue
   d'ensemble" déjà filtrable — mais de garder cette page de stats
   de PRIX séparée, comme dans son ancienne appli ("Stats" était déjà
   son propre onglet, à part du calculateur/produits/coût/B2B).
   Granularité VARIANTE (pas produit) : un produit acheté au kilo avec
   décote paliers a un coeff qui baisse progressivement par palier, un
   produit acheté à la pièce à prix différent par taille a un coeff
   différent par taille — chaque variante doit pouvoir tomber dans sa
   propre tranche de coefficient, jamais moyennée au niveau produit.
   ============================================================ */
const Stats = {
  detail: null,      // drill-down affiché sous les graphiques
  _charts: {},
  tab: 'price',       // 'price' (coeff/marges) | 'sales' (performance des ventes)
  salesPeriod: 'all', // 'all' | 'year' | '12m'
  salesKind: 'all',   // 'all' | 'mast' | 'acc' — filtre de l'onglet Ventes (volumes) ; l'onglet Chiffre d'affaires est toujours global
  seasonProduct: '',  // clé produit pour la saisonnalité détaillée
  priceKind: 'mast',  // 'mast' | 'acc' : catégorie affichée dans l'onglet Prix & marges
  _dormantOpen: false,
  _topOpen: false,

  toggleTop() { this._topOpen = !this._topOpen; this.render(); },
  setTab(t) { this.tab = t; this.detail = null; this.render(); },
  setPriceKind(k) { this.priceKind = k === 'acc' ? 'acc' : 'mast'; this.detail = null; this.render(); },
  _priceKindBar() {
    const k = this.priceKind === 'acc' ? 'acc' : 'mast';
    return `<div style="margin:12px 0 14px;">${U.seg([{ l: '🥩 Mastication', on: k === 'mast', js: "Stats.setPriceKind('mast')" }, { l: '🐕 Accessoires', on: k === 'acc', js: "Stats.setPriceKind('acc')" }], { label: 'Catégorie' })}</div>`;
  },
  /* Seuil de coeff critique de la catégorie affichée (mastication : b2bCoeffThreshold ; accessoires : accCoeffThreshold). */
  _thr(acc) { const S = Store.state.settings; return U.num(acc ? (S.accCoeffThreshold || S.b2bCoeffThreshold) : S.b2bCoeffThreshold); },
  setSalesPeriod(v) { this.salesPeriod = v; this.seasonProduct = ''; this.render(); },
  setSalesKind(k) { this.salesKind = k; this.seasonProduct = ''; this.render(); },
  _metric() { return this.tab === 'ca' ? 'ca' : 'qty'; },   // onglet Chiffre d'affaires = euros ; onglet Ventes = quantités
  setSeasonProduct(v) { this.seasonProduct = v; this.render(); },
  toggleDormant() { this._dormantOpen = !this._dormantOpen; this.render(); },

  tabBar() {
    const t = this.tab || 'price';
    const tabs = [['price', '📊 Prix &amp; marges'], ['sales', '🛒 Ventes'], ['ca', '💶 Chiffre d&#39;affaires'], ['pack', '📦 Emballages'], ['events', '🎪 Événements']];
    if (!App.isViewer) tabs.push(['clients', '👤 Clients']);
    return `<div class="card">${U.seg(tabs.map(([k, l]) => ({ l, on: t === k, js: `Stats.setTab('${k}')` })), { full: true, scroll: true, label: 'Statistiques' })}</div>`;
  },

  render() {
    U.syncFilters('stats', this, ['tab', 'salesPeriod', 'salesKind', 'seasonProduct', 'priceKind']);
    if (this.tab === 'sales' || this.tab === 'ca') return this.renderSales();
    if (this.tab === 'pack') return this.renderPack();
    if (this.tab === 'events') return this.renderEvents();
    if (this.tab === 'clients' && !App.isViewer) return this.renderClients();
    return this.renderPrice();
  },

  /* ═══════════ Onglet « 📦 Emballages » (2026-09-26) ═══════════
     Sachets : historique de conditionnement des lots (v.packHistory, posé par Stock._packApply).
     Cartons : lignes consommables (kind 'C') des ventes dont le consommable est de catégorie « Cartons ».
     But (Antho) : voir ce qui sert le plus / le moins pour réduire le nombre de formats. */
  /* ═══════════ Onglet « 🎪 Événements » (2026-09-27) ═══════════
     Rentabilité par événement nommé (sale.eventName, saisi au retour d'événement ou via
     « 🎪 Modifier » dans l'historique). Une édition = une année de cet événement.
     Mêmes formules que la compta du Tableau de bord (coût de revient figé/estimé, frais
     SumUp/Stripe, frais de stand, consommables, cotisations par nature, TVA si assujetti). */
  _eventAgg() {
    const S = Store.state.settings;
    const socStd = U.num(S.socialTaxRate) / 100, socHM = Pricing.socialRateHandmade() / 100;
    const cardRate = U.num(S.cardFeeRate) / 100, stripeRate = U.num(S.stripeFeeRate) / 100;
    const vr = U.num(S.vatRate);
    const saleCalc = s => {
      const items = s.items || [];
      const ca = U.num(s.total);
      const caAcc = items.filter(i => i.kind === 'A').reduce((a, i) => a + U.num(i.price) * U.num(i.qty), 0);
      const cogs = items.filter(i => i.kind === 'M' || i.kind === 'A').reduce((a, i) => a + Pricing.saleItemCost(i), 0);
      const conso = items.filter(i => i.kind === 'C').reduce((a, i) => a + Pricing.saleItemCost(i), 0);
      const base = (s.payment === 'sumup' || s.payment === 'stripe') ? ca + U.num(s.shippingFeeCollected) : 0;
      const fee = s.payment === 'sumup' ? base * cardRate : s.payment === 'stripe' ? base * stripeRate : 0;
      const cotis = (caAcc * socHM + (ca - caAcc + U.num(s.shippingFeeCollected)) * socStd) * Pricing.urssafK();
      const tva = S.vatActive && vr > 0 ? ca * vr / (100 + vr) : 0;
      const stand = U.num(s.eventFee), travel = U.num(s.travelCost), meal = U.num(s.mealFee);
      const tx = (s.sumupRefs && s.sumupRefs.length) || 1;
      return { ca, cogs, conso, fee, cotis, tva, stand, travel, meal, tx, net: ca - cogs - conso - fee - cotis - tva - stand - travel - meal + U.num(s.shippingFeeCollected) - U.num(s.shippingCost) };
    };
    const zero = () => ({ ca: 0, cogs: 0, conso: 0, fee: 0, cotis: 0, tva: 0, stand: 0, travel: 0, meal: 0, tx: 0, net: 0, days: new Set() });
    const add = (t, c, day) => { Object.keys(c).forEach(k => { t[k] += c[k]; }); t.days.add(day); };
    const byName = {};
    Store.state.sales.filter(s => !s.cancelled && s.eventName).forEach(s => {
      const d = new Date(s.ts), day = d.toISOString().slice(0, 10), y = d.getFullYear();
      const e = byName[s.eventName] || (byName[s.eventName] = { name: s.eventName, tot: zero(), years: {} });
      const c = saleCalc(s);
      add(e.tot, c, day);
      add(e.years[y] || (e.years[y] = zero()), c, day);
    });
    const unnamed = Store.state.sales.filter(s => !s.cancelled && Ventes._isEventSale(s) && !s.eventName).length;
    const list = Object.values(byName).map(e => ({ ...e, editions: Object.keys(e.years).length, nDays: e.tot.days.size, perDay: e.tot.net / (e.tot.days.size || 1), basket: e.tot.ca / (e.tot.tx || 1) }));
    return { list, unnamed };
  },
  _toggleEv(enc) { const k = decodeURIComponent(enc); const o = this._evOpen || (this._evOpen = {}); o[k] = !o[k]; this.render(); },
  setEventSort(k) {
    const cur = this._evSort || { k: 'net', dir: 'desc' };
    this._evSort = cur.k === k ? { k, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { k, dir: k === 'name' ? 'asc' : 'desc' };
    this.render();
  },
  renderEvents() {
    const { list, unnamed } = this._eventAgg();
    const so = this._evSort || { k: 'net', dir: 'desc' };
    const dir = so.dir === 'asc' ? 1 : -1;
    const val = (e, k) => k === 'name' ? e.name : k === 'editions' ? e.editions : k === 'days' ? e.nDays : k === 'perDay' ? e.perDay : k === 'basket' ? e.basket : e.tot[k];
    list.sort((a, b) => so.k === 'name' ? dir * U.sortFr(a.name, b.name) : dir * (val(a, so.k) - val(b, so.k)));
    const sh = (k, l) => `<span class="sortable ${so.k === k ? 'active' : ''}" onclick="Stats.setEventSort('${k}')">${l} ${so.k === k ? (so.dir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
    const neg = v => v ? '− ' + U.eur(v) : '—';
    const rowCells = t => `<td class="num sensitive">${U.eur(t.ca)}</td><td class="num sensitive">${neg(t.cogs)}</td><td class="num sensitive">${neg(t.stand)}</td><td class="num sensitive">${neg(t.meal)}</td><td class="num sensitive">${neg(t.travel)}</td><td class="num sensitive">${neg(t.fee)}</td><td class="num sensitive">${neg(t.conso)}</td><td class="num sensitive">${neg(t.cotis)}</td><td class="num sensitive ${t.net >= 0 ? 'pos' : 'neg'}"><b>${U.eur(t.net)}</b></td>`;
    const open = this._evOpen || (this._evOpen = {});
    const rows = list.map(e => {
      const years = Object.keys(e.years).sort().reverse();
      const yRows = years.map((y, i) => {
        const t = e.years[y], prev = e.years[years[i + 1]];
        const evo = prev && prev.net ? (t.net - prev.net) / Math.abs(prev.net) * 100 : null;
        return `<tr class="ev-year"><td class="col-name" style="padding-left:28px;">${y} ${evo === null ? '' : `<span class="${evo >= 0 ? 'pos' : 'neg'}" style="font-size:.78rem;font-weight:600;">${evo >= 0 ? '▲ +' : '▼ '}${Math.round(evo)} %</span>`}</td><td class="num">1</td><td class="num">${t.days.size}</td>${rowCells(t)}<td class="num sensitive">${U.eur(t.net / (t.days.size || 1))}</td><td class="num sensitive">${U.eur(t.ca / (t.tx || 1))}</td></tr>`;
      }).join('');
      const k = encodeURIComponent(e.name).replace(/'/g, '%27');
      return `<tr style="cursor:pointer;" onclick="Stats._toggleEv('${k}')"><td class="col-name" style="text-align:left;"><b>${open[e.name] ? '▾' : '▸'} ${U.esc(e.name)}</b></td><td class="num">${e.editions}</td><td class="num">${e.nDays}</td>${rowCells(e.tot)}<td class="num sensitive">${U.eur(e.perDay)}</td><td class="num sensitive">${U.eur(e.basket)}</td></tr>${open[e.name] ? yRows : ''}`;
    }).join('');
    // Simulateur — tous les événements du référentiel (même sans vente) + création directe.
    const allNames = Store.eventList();
    const simName = this._evSim && allNames.includes(this._evSim) ? this._evSim : '';   // aucun événement présélectionné : on choisit dans le menu
    const encN = encodeURIComponent(simName).replace(/'/g, '%27');
    const fi = simName ? Store.eventInfo(simName) : {};
    const inp = (key, lbl, ph, step) => key === 'note' ? `<div class="fg"><label>${lbl}</label><textarea class="note-area" id="evf_note" rows="1" placeholder="${ph}" oninput="Stats._evFicheDirty()">${U.esc(fi[key] ?? '')}</textarea></div>` : `<div class="fg"><label>${lbl}</label><input id="evf_${key}" ${step ? `type="number" step="${step}" min="0"` : ''} value="${U.esc(fi[key] ?? '')}" placeholder="${ph}" oninput="Stats._evFicheDirty()"></div>`;
    const Sx = Store.state.settings, consX = U.num(Sx.fuelConsumption ?? 7), priceX = U.num(Sx.fuelPrice ?? 1.85);
    App.mount(`
      <div class="view-title"><h1>Statistiques</h1><span class="sub">rentabilité par événement</span></div>
      ${this.tabBar()}
      ${unnamed ? `<div class="card" style="border-left:4px solid #f5b041;"><p class="mb0">⚠️ <b>${unnamed}</b> vente(s) d'événement sans nom ne sont pas comptées ici. Nomme-les via <b>Ventes → historique → 🎪 Modifier</b>.</p></div>` : ''}
      <div class="card">
        <h2>🎪 Rentabilité par événement</h2>
        ${list.length ? U.fold('events', list.length, `<div class="table-wrap"><table class="pack-tbl"><thead><tr><th class="col-name" style="text-align:left;">${sh('name', 'Événement')}</th><th class="num">${sh('editions', 'Éditions')}</th><th class="num">${sh('days', 'Jours')}</th><th class="num">${sh('ca', 'CA')}</th><th class="num">${sh('cogs', 'Coût revient')}</th><th class="num">${sh('stand', 'Stand')}</th><th class="num">${sh('meal', 'Repas')}</th><th class="num">${sh('travel', 'Déplacement')}</th><th class="num">${sh('fee', 'Frais paiement')}</th><th class="num">${sh('conso', 'Conso.')}</th><th class="num">${sh('cotis', 'Cotisations')}</th><th class="num">${sh('net', 'Bénéfice net')}</th><th class="num">${sh('perDay', 'Bénéfice / jour')}</th><th class="num">${sh('basket', 'Panier moyen')}</th></tr></thead><tbody>${rows}</tbody></table></div>`, { unit: 'événements' }) + `
        <p class="muted help" style="font-size:.82rem;">Clique un événement pour voir ses éditions année par année (▲▼ = évolution du bénéfice net par rapport à l'édition précédente). <b>Couleurs :</b> les colonnes de coûts (précédées d'un « − ») sont simplement déduites du CA ; seul le <b>bénéfice net</b> est coloré — 🟢 vert = gagné, 🔴 rouge = perdu.</p>`
        : '<p class="muted">Aucun événement nommé pour l\'instant. Donne un nom à tes journées au moment du <b>Retour d\'événement</b>, ou via <b>🎪 Modifier</b> dans l\'historique des ventes.</p>'}
      </div>
      <div class="card">
        <h2>🎪 Mes événements — fiche & simulation</h2>
        <p class="muted help">Choisis (ou crée) un marché, enregistre sa fiche habituelle (stand, km, péages…) : elle sera pré-remplie à chaque retour d'événement. La simulation en bas se met à jour avec.</p>
        <div class="frow" style="gap:10px;align-items:flex-end;flex-wrap:wrap;">
          <div class="fg" style="max-width:300px;"><label>Événement</label>${Ventes.eventSelect(simName, 'Stats._evSim=v;Stats.render()', '', 'Stats.render()')}</div>
          ${simName ? `<div class="fg" style="max-width:200px;"><label>CA espéré (€)</label><input id="ev_sim_ca" type="number" step="1" min="0" value="${(this._evSimCA || {})[simName] || ''}" placeholder="moyenne" oninput="(Stats._evSimCA=Stats._evSimCA||{})[Stats._evSimCur]=this.value;Stats._simEvent()"></div>` : ''}
        </div>
        ${simName ? `<div class="mt" style="border:1px solid rgba(166,113,83,.45);border-radius:10px;padding:12px 14px;">
          <h3 style="margin:0 0 8px;">📋 Fiche « ${U.esc(simName)} »</h3>
          <div class="grid c3">
          ${inp('place', 'Lieu', 'ex : Lyon, place Bellecour')}
          ${inp('stand', 'Prix du stand habituel (€)', '0', '0.01')}
          ${inp('km', 'Kilomètres aller-retour', '0', '1')}
          ${inp('tolls', 'Péages / parking (€)', '0', '0.01')}
          ${inp('other', 'Hébergement / autres (€)', '0', '0.01')}
          ${inp('note', 'Note', 'ex : installation 7h, prévoir tonnelle')}
          </div>
          <p class="muted" style="font-size:.82rem;margin:4px 0 8px;">🚗 Déplacement : ${U.num(fi.km)} km × ${String(consX).replace('.', ',')} L/100 km × ${U.eur(priceX)}/L + péages + autres = <b class="sensitive">${U.eur(Store.eventTravelCost(simName))}</b> <span style="font-size:.78rem;">(consommation et prix du litre : Paramètres → Réglages financiers)</span></p>
          <button class="btn-cta btn-sm" id="evf_save" onclick="Stats.saveEventFiche()">💾 Enregistrer la fiche</button> <span id="evf_state" class="muted" style="font-size:.82rem;">${Object.keys(fi).length ? '✅ Fiche enregistrée' : 'Fiche vide'}</span>
        </div>
        <h3 class="mt" style="margin-bottom:0;">🧮 Simulation</h3>
        <div id="ev_sim_out" class="mt"></div>` : `<p class="muted mt">${allNames.length ? 'Choisis un événement dans le menu pour voir et modifier sa fiche, puis simuler un marché.' : 'Aucun événement : crée-en un avec « ＋ Nouvel événement… ».'}</p>`}
      </div>`);
    this._evSimCur = simName;
    if (simName) this._simEvent();
  },
  renderClients() { return Clients.render(); },
  _evFicheDirty() { const e = document.getElementById('evf_state'); if (e) { e.textContent = '● Modifications non enregistrées'; e.style.color = '#f5b041'; } },
  saveEventFiche() {
    const name = this._evSimCur; if (!name) return;
    const S = Store.state.settings; S.eventInfo = S.eventInfo || {};
    const e = S.eventInfo[name] = S.eventInfo[name] || {};
    ['place', 'note'].forEach(k => { e[k] = U.val('evf_' + k).trim(); });
    ['stand', 'km', 'tolls', 'other'].forEach(k => { const v = U.val('evf_' + k); e[k] = v === '' ? '' : U.num(v); });
    if (!(S.events || []).includes(name)) (S.events = S.events || []).push(name);
    Store.save('settings'); this.render();
    U.toast('Fiche « ' + name + ' » enregistrée — pré-remplie au prochain retour d\'événement.');
  },
  _simEvent() {
    const out = document.getElementById('ev_sim_out'); if (!out) return;
    const name = this._evSimCur; if (!name) return;
    const all = this._eventAgg().list;
    const e = all.find(x => x.name === name);
    const exFees = t => t.net + t.stand + t.travel;               // bénéfice AVANT stand et déplacement
    const n = e ? (e.editions || 1) : 0;
    // Taux « ce qu'il reste par € de CA avant stand/déplacement » : celui de l'événement s'il a un
    // historique, sinon la moyenne de tous tes événements.
    const gCA = all.reduce((a, x) => a + x.tot.ca, 0), gEx = all.reduce((a, x) => a + exFees(x.tot), 0);
    const gEd = all.reduce((a, x) => a + (x.editions || 1), 0);
    const own = !!(e && e.tot.ca > 0);
    const rate = own ? exFees(e.tot) / e.tot.ca : (gCA > 0 ? gEx / gCA : 0);
    const avgCA = own ? e.tot.ca / n : (gEd ? gCA / gEd : 0);
    const typed = U.val('ev_sim_ca');
    const ca = typed === '' ? avgCA : U.num(typed);
    const fee = U.num(Store.eventInfo(name).stand), travel = Store.eventTravelCost(name);
    const exF = ca * rate;
    const est = exF - fee - travel;
    const breakEven = rate > 0 ? (fee + travel) / rate : null;
    const caLbl = typed !== '' ? 'CA espéré (saisi)' : own ? `CA moyen de cet événement (${n} édition(s))` : 'CA moyen de tous tes événements';
    if (!rate) { out.innerHTML = `<p class="muted">Pas encore assez de ventes d'événement pour estimer un taux de bénéfice. Stand + déplacement prévus : <b class="sensitive">${U.eur(fee + travel)}</b>.</p>`; return; }
    out.innerHTML = `<div class="recap-grid">
      <div class="kpi recap-tile sensitive"><div class="v">${U.eur(ca)}</div><div class="l">${caLbl}</div></div>
      <div class="kpi recap-tile sensitive"><div class="v">${U.eur(exF)}</div><div class="l">Bénéfice avant stand & déplacement (${Math.round(rate * 100)} % du CA)</div></div>
      <div class="kpi recap-tile sensitive"><div class="v">${U.eur(fee)}</div><div class="l">Stand prévu (fiche)</div></div>
      <div class="kpi recap-tile sensitive"><div class="v">${U.eur(travel)}</div><div class="l">Déplacement prévu (fiche)</div></div>
      <div class="kpi recap-tile sensitive ${est >= 0 ? 'good' : 'bad'} recap-net"><div class="v ${est >= 0 ? 'pos' : 'neg'}">${U.eur(est)}</div><div class="l">Bénéfice estimé</div></div>
      <div class="kpi recap-tile sensitive"><div class="v">${breakEven === null ? '—' : U.eur(breakEven)}</div><div class="l">CA minimum pour couvrir stand + déplacement</div></div>
    </div>
    <p class="muted" style="font-size:.82rem;margin-top:8px;">${est >= 0 ? '✅ Rentable avec ce CA.' : '🔴 En perte avec ce CA.'} ${own ? `Taux de bénéfice tiré de tes ${n} édition(s) de cet événement.` : "Pas encore d'historique pour cet événement : taux de bénéfice moyen de tous tes événements."} À prendre comme un ordre de grandeur.</p>
    <p class="muted" style="font-size:.82rem;margin-top:4px;"><b>Comment c'est calculé :</b> CA prévu (celui que tu saisis, sinon ${own ? 'la moyenne de cet événement' : 'la moyenne de tous tes événements'}) × ${Math.round(rate * 100)} % (part du CA qui te reste sur tes événements passés après coût de revient, frais de paiement, consommables et cotisations, avant stand et déplacement) − stand − déplacement de la fiche.</p>`;
  },

  _packAgg() {
    const period = this.salesPeriod || 'all';
    const now = Date.now();
    const inPeriod = iso => {
      if (period === 'all') return true;
      const t = new Date(iso).getTime();
      return period === '12m' ? t >= now - 365 * 86400000 : t >= new Date(new Date().getFullYear(), 0, 1).getTime();
    };
    const S = Store.state.settings;
    const consos = Store.state.consumables || [];
    const isCat = (c, re) => re.test((c && c.category) || '');
    // Fiches prix (variantes actives) qui utilisent chaque entrée du référentiel sachets/blisters
    // → « utilisation prévue », disponible tout de suite, même sans historique de conditionnement.
    const fichesByRef = {};
    Store.state.catalogM.forEach(p => (p.variants || []).filter(v => v.enabled !== false).forEach(v => {
      if (!v.sachetId || String(v.sachetId) === '0') return;
      (fichesByRef[v.sachetId] = fichesByRef[v.sachetId] || []).push(p.name + ' ' + Pricing.labelVariant(v));
    }));
    const mk = c => ({ id: c.id, name: c.name, dims: c.dimensions || '', unitCost: U.num(c.costUnit) * Pricing.vatK(), stock: U.num(c.qty), unit: c.unit, uses: 0, qty: 0, cost: 0, last: '', prods: {}, fiches: [] });
    // Sachets
    const sach = {};
    consos.filter(c => isCat(c, /sachet/i)).forEach(c => { sach[c.id] = mk(c); });
    (S.sachets || []).filter(s => (s.type || 'sachet') === 'sachet' && s.consumableId && sach[s.consumableId])
      .forEach(s => { sach[s.consumableId].fiches.push(...(fichesByRef[s.id] || [])); });
    // Blisters : on part de TOUT le référentiel (rouleaux × longueurs), puis on ajoute l'historique
    const rolls = S.blisterRolls || {};
    Params._syncPackagingCosts();
    const blis = {};
    const wEntry = (widthMm, widthStr) => blis[widthMm] || (blis[widthMm] = { widthMm, widthStr, rollId: (rolls[String(widthMm)] || {}).consumableId || '', lengths: {} });
    const lEntry = (w, lengthMm, lengthStr) => w.lengths[lengthMm] || (w.lengths[lengthMm] = { lengthMm, lengthStr, unitCost: 0, uses: 0, qty: 0, cost: 0, last: '', prods: {}, fiches: [] });
    (S.sachets || []).filter(s => s.type === 'blister').forEach(s => {
      const d = Params._blisterDims(s); if (!d) return;
      const L = lEntry(wEntry(d.widthMm, d.widthStr), d.lengthMm, d.lengthStr);
      L.unitCost = U.num(s.cost);
      L.fiches.push(...(fichesByRef[s.id] || []));
    });
    Store.state.stockM.forEach(p => (p.variants || []).forEach(v => (v.packHistory || []).forEach(h => {
      if (!inPeriod(h.date)) return;
      const k = p.name + ' ' + Pricing.labelVariant(v);
      if (h.type === 'blister') {
        const parts = (h.dims || '').split('×');
        const w = wEntry(h.widthMm, parts[0] || (h.widthMm + 'mm'));
        if (!w.rollId) w.rollId = h.consoId;
        const L = lEntry(w, h.lengthMm, parts[1] || (h.lengthMm / 10 + 'cm'));
        if (!L.unitCost) L.unitCost = U.num(h.unitCost);
        L.uses++; L.qty += U.num(h.qty); L.cost += U.num(h.qty) * U.num(h.unitCost);
        if (!L.last || h.date > L.last) L.last = h.date;
        L.prods[k] = (L.prods[k] || 0) + U.num(h.qty);
        return;
      }
      const r = sach[h.consoId] || (sach[h.consoId] = { id: h.consoId, name: h.name + ' (supprimé)', dims: h.dims || '', unitCost: U.num(h.unitCost), stock: 0, uses: 0, qty: 0, cost: 0, last: '', prods: {}, fiches: [] });
      r.uses++; r.qty += U.num(h.qty); r.cost += U.num(h.qty) * U.num(h.unitCost);
      if (!r.last || h.date > r.last) r.last = h.date;
      r.prods[k] = (r.prods[k] || 0) + U.num(h.qty);
    })));
    // Cartons
    const cart = {};
    consos.filter(c => isCat(c, /carton/i)).forEach(c => { cart[c.id] = mk(c); cart[c.id].fiches = null; });
    Store.state.sales.filter(s => !s.cancelled && inPeriod(new Date(s.ts).toISOString())).forEach(s => {
      const items = s.items || [];
      items.filter(i => i.kind === 'C' && cart[i.pId]).forEach(i => {
        const r = cart[i.pId];
        r.uses++; r.qty += U.num(i.qty); r.cost += U.num(i.cost);
        const d = new Date(s.ts).toISOString().slice(0, 10);
        if (!r.last || d > r.last) r.last = d;
        items.filter(x => x.kind !== 'C').forEach(x => { r.prods[x.name] = (r.prods[x.name] || 0) + 1; });
      });
    });
    const sort = o => Object.values(o).sort((a, b) => b.qty - a.qty || (b.fiches || []).length - (a.fiches || []).length || U.sortFr(a.name, b.name));
    const blisters = Object.values(blis).sort((a, b) => a.widthMm - b.widthMm).map(w => {
      const roll = consos.find(c => c.id === w.rollId);
      const unit = ((roll && roll.unit) || 'm').toLowerCase();
      const perM = roll ? U.num(roll.costUnit) * Pricing.vatK() * (unit === 'mm' ? 1000 : unit === 'cm' ? 100 : 1) : 0; // € par mètre
      return { ...w, roll, perM, lengths: Object.values(w.lengths).sort((a, b) => a.lengthMm - b.lengthMm) };
    });
    return { sach: sort(sach), cart: sort(cart), blisters };
  },

  _fichesCell(list) {
    if (!list) return '';
    if (!list.length) return '<td class="num"><span class="muted">0</span></td>';
    const title = U.esc(list.slice().sort(U.sortFr).join('\n'));
    return `<td class="num" title="${title}" style="cursor:help;"><b>${list.length}</b></td>`;
  },

  _packTable(rows, unitWord, prodWord) {
    if (!rows.length) return '<p class="muted">Aucun consommable de cette catégorie.</p>';
    const withFiches = rows.some(r => Array.isArray(r.fiches));
    const total = rows.reduce((a, r) => a + r.qty, 0) || 1;
    const sixMonths = new Date(Date.now() - 182 * 86400000).toISOString().slice(0, 10);
    const lbl = r => U.esc(r.name) + (r.dims ? ` <span class="muted">${U.esc(r.dims)}</span>` : '');
    return U.fold('pack:' + unitWord, rows.length, `<div class="table-wrap"><table class="pack-tbl">
      <thead><tr><th class="col-name">Emballage</th><th class="num">Coût / u.</th><th class="num">En stock</th>${withFiches ? '<th class="num" title="Nombre de variantes de fiches prix (Prix mastication) qui utilisent cet emballage — survole pour la liste">Fiches prix</th>' : ''}<th class="num">${unitWord}</th><th class="num">Part</th><th class="num">Coût total</th><th>Dernier usage</th><th>${prodWord}</th><th>Statut</th></tr></thead>
      <tbody>${rows.map(r => {
        const top = Object.entries(r.prods).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, q]) => `${U.esc(n)} <span class="muted">(${U.qty(q)})</span>`).join(', ') || '<span class="muted">—</span>';
        const cObj = Store.state.consumables.find(c => c.id === r.id);
        const nF = Array.isArray(r.fiches) ? r.fiches.length : null;
        let st;
        if (r.qty) st = r.last < sixMonths ? '<span class="badge warn">peu utilisé (+6 mois)</span>' : '<span class="badge ok">actif</span>';
        else if (nF) st = '<span class="badge info">prévu (fiches prix)</span>';
        else st = '<span class="badge bad">jamais utilisé</span>';
        if (cObj && cObj.toReplace) st += typeof Stock !== 'undefined' ? Stock.replaceBadge(cObj) : ' 🚩';
        const dim = !r.qty && !nF;
        return `<tr class="${dim ? 'dim' : ''}"><td class="col-name">${lbl(r)}</td><td class="num sensitive">${U.eur(r.unitCost)}</td><td class="num">${U.qty(r.stock)}</td>${withFiches ? this._fichesCell(r.fiches || []) : ''}<td class="num"><b>${U.qty(r.qty)}</b></td><td class="num">${Math.round(r.qty / total * 100)} %</td><td class="num sensitive">${U.eur(r.cost)}</td><td>${r.last ? U.frDate(r.last) : '<span class="muted">—</span>'}</td><td style="font-size:.85rem;">${top}</td><td>${st}</td></tr>`;
      }).join('')}</tbody></table></div>`, { unit: 'emballages' });
  },

  _blisterHTML(bl) {
    if (!bl.length) return '<p class="muted">Aucun blister dans le référentiel (Prix mastication → 3. Conditionnement).</p>';
    return bl.map(w => {
      const tot = w.lengths.reduce((a, L) => a + L.qty, 0) || 1;
      const meters = w.lengths.reduce((a, L) => a + L.qty * L.lengthMm / 1000, 0);
      const nF = w.lengths.reduce((a, L) => a + L.fiches.length, 0);
      const opts = w.lengths.map(L => `<option value="${L.lengthMm}">${U.esc(L.lengthStr)}</option>`).join('');
      const opts2 = w.lengths.map((L, i) => `<option value="${L.lengthMm}" ${i === 1 ? 'selected' : ''}>${U.esc(L.lengthStr)}</option>`).join('');
      const open = !!(this._rollOpen || {})[w.widthMm];
      return `<details class="fold sachet-group" style="margin:8px 0;" ${open ? 'open' : ''} ontoggle="(Stats._rollOpen=Stats._rollOpen||{})[${w.widthMm}]=this.open">
        <summary style="cursor:pointer;padding:8px 0;"><b style="font-size:1rem;">Rouleau ${U.esc(w.widthStr)}</b> <span class="muted" style="font-size:.85rem;">${w.roll ? '· ' + U.esc(w.roll.name) + ' · ' + U.eur(w.perM) + '/m · stock ' + U.qty(w.roll.qty) + ' ' + U.esc(w.roll.unit || 'm') : '· rouleau non lié'} · ${nF} fiche(s) prix · ${U.qty(Math.round(meters * 100) / 100)} m consommés</span>${w.roll && w.roll.toReplace && typeof Stock !== 'undefined' ? Stock.replaceBadge(w.roll) : ''}</summary>
        <div class="table-wrap"><table class="pack-tbl">
          <thead><tr><th class="col-name">Longueur de découpe</th><th class="num">Coût / découpe</th><th class="num" title="Variantes de fiches prix qui utilisent cette découpe — survole pour la liste">Fiches prix</th><th class="num">Découpes</th><th class="num">Part</th><th class="num">Mètres</th><th class="num">Coût</th><th>Dernier usage</th><th>Produits conditionnés</th><th>Statut</th></tr></thead>
          <tbody>${w.lengths.map(L => {
            const top = Object.entries(L.prods).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, q]) => `${U.esc(n)} <span class="muted">(${U.qty(q)})</span>`).join(', ') || '<span class="muted">—</span>';
            const st = L.qty ? '<span class="badge ok">actif</span>' : L.fiches.length ? '<span class="badge info">prévu (fiches prix)</span>' : '<span class="badge bad">aucune fiche</span>';
            return `<tr class="${!L.qty && !L.fiches.length ? 'dim' : ''}"><td class="col-name"><b>${U.esc(L.lengthStr)}</b></td><td class="num sensitive">${U.eur(L.unitCost)}</td>${this._fichesCell(L.fiches)}<td class="num"><b>${U.qty(L.qty)}</b></td><td class="num">${Math.round(L.qty / tot * 100)} %</td><td class="num">${U.qty(Math.round(L.qty * L.lengthMm / 10) / 100)}</td><td class="num sensitive">${U.eur(L.cost)}</td><td>${L.last ? U.frDate(L.last) : '<span class="muted">—</span>'}</td><td style="font-size:.85rem;">${top}</td><td>${st}</td></tr>`;
          }).join('')}</tbody></table></div>
        ${w.lengths.length > 1 ? `<div class="frow mt" style="align-items:flex-end;gap:8px;">
          <div class="fg" style="max-width:170px;"><label>Simuler : remplacer</label><select id="bsim_a_${w.widthMm}" onchange="Stats._simBlister(${w.widthMm})">${opts}</select></div>
          <div class="fg" style="max-width:170px;"><label>par (plus long)</label><select id="bsim_b_${w.widthMm}" onchange="Stats._simBlister(${w.widthMm})">${opts2}</select></div>
          <div class="fg" style="flex:2;"><span id="bsim_r_${w.widthMm}" class="muted"></span></div>
        </div>` : ''}
      </details>`;
    }).join('');
  },
  /* Simulateur de regroupement : remplacer la longueur A par B (plus longue) pour découper à
     l'avance en moins de formats. Toujours : surcoût PAR découpe + nb de fiches prix concernées.
     Avec historique : mètres en plus (= perte) et surcoût sur la période. */
  _simBlister(widthMm) {
    const out = document.getElementById('bsim_r_' + widthMm); if (!out) return;
    const w = (this._packAgg().blisters || []).find(x => x.widthMm === widthMm); if (!w) return;
    const a = U.num(U.val('bsim_a_' + widthMm)), b = U.num(U.val('bsim_b_' + widthMm));
    const A = w.lengths.find(L => L.lengthMm === a), B = w.lengths.find(L => L.lengthMm === b);
    if (!A || !B) return;
    if (b <= a) { out.innerHTML = 'Choisis une longueur de remplacement <b>plus longue</b> que celle remplacée.'; return; }
    const perCut = (b - a) / 1000 * w.perM || (B.unitCost - A.unitCost);
    let html = `Chaque découpe de ${U.esc(A.lengthStr)} faite en ${U.esc(B.lengthStr)} = <b>+${U.qty((b - a) / 10)} cm</b> de rouleau, soit <b class="neg">+${U.eur(perCut)}</b> par découpe · <b>${A.fiches.length}</b> fiche(s) prix concernée(s)`;
    if (A.qty) {
      const extraM = A.qty * (b - a) / 1000;
      html += `<br>Sur la période : ${U.qty(A.qty)} découpes → <b class="neg">+${U.qty(Math.round(extraM * 100) / 100)} m</b>` + (w.perM ? `, <b class="neg">+${U.eur(extraM * w.perM)}</b>` : '');
    } else html += '<br><span class="muted">Pas encore de découpes enregistrées : le total sur la période apparaîtra avec les conditionnements.</span>';
    out.innerHTML = html + ' — une longueur de moins à préparer.';
  },

  renderPack() {
    const agg = this._packAgg();
    const periodOpts = [{ v: 'all', l: 'Tout l\'historique' }, { v: 'year', l: 'Cette année' }, { v: '12m', l: '12 derniers mois' }];
    App.mount(`
      <div class="view-title"><h1>Statistiques</h1><span class="sub">emballages — sachets, blisters & cartons</span></div>
      ${this.tabBar()}
      <div class="card">
        <div class="fg" style="max-width:220px;margin:0;"><label>Période</label>${U.customSelect({ value: this.salesPeriod, options: periodOpts, onPick: 'Stats.setSalesPeriod' })}</div>
        <p class="muted help mb0 mt" style="font-size:.85rem;">Sachets : d'après le conditionnement indiqué à l'ajout des lots (Stock → ＋ Ajouter un lot, ou 📦 sur un lot). Cartons : d'après les consommables de catégorie « Cartons » ajoutés aux ventes. Le « jamais / peu utilisé » t'aide à repérer les formats à supprimer ou remplacer.</p>
      </div>
      <div class="card"><h2>🛍️ Sachets</h2>${this._packTable(agg.sach, 'Sachets utilisés', 'Produits qui l\'utilisent le plus')}</div>
      <div class="card"><h2>🎞️ Blisters</h2><p class="muted help mb0" style="font-size:.85rem;">Par largeur de rouleau et longueur de découpe. Le simulateur montre ce que coûterait de regrouper deux longueurs (découper à l'avance en moins de formats, avec un peu de perte).</p>${this._blisterHTML(agg.blisters)}</div>
      <div class="card"><h2>📦 Cartons</h2>${this._packTable(agg.cart, 'Colis envoyés', 'Produits le plus souvent envoyés dedans')}</div>`);
    agg.blisters.forEach(w => { if (w.lengths.length > 1) this._simBlister(w.widthMm); });
  },


  /* ───────── LISTE PAR COEFF (Antho 2026-10-10) ─────────
     Sortir la liste des produits (variantes) dont le coeff PUBLIC est dans une fourchette (ex. paniers offerts : à valeur affichée égale, un fort coeff coûte moins cher à offrir).
     Même coeff/prix/coût que la fiche Prix mastication (Pricing.variantCalc, frais de port d'achat estimés compris) ; stock + DLUO la plus proche lus sur les variantes du Stock reliées à la fiche.
     Cases à cocher (comme Stock → Péremptions) : on imprime / copie seulement les lignes cochées. Mastication ET accessoires (même onglet que le sélecteur). */
  coeffList: { min: '2', max: '', stockOnly: false, sort: 'coeff', q: '', excluded: [] },
  _coeffNum(s) { const t = String(s == null ? '' : s).trim().replace(',', '.'); if (t === '') return null; const n = parseFloat(t); return isFinite(n) ? n : null; },
  _stockIndex() {   // 'idFiche|idLigneFiche' -> { qty, dluo } (somme des variantes du Stock reliées à cette ligne de fiche ; dluo = la plus proche)
    const idx = {};
    (Store.state.stockM || []).forEach(sp => (sp.variants || []).forEach(sv => {
      const cid = sv.catalogId || sp.catalogId; if (!cid || !sv.catalogVariantId) return;
      const e = idx[cid + '|' + sv.catalogVariantId] || (idx[cid + '|' + sv.catalogVariantId] = { qty: 0, dluo: '' });
      if (Stock.isVirtual(sp, sv)) { e.qty += Stock.virtualQty(sp, sv).t; return; }
      (sv.lots || []).forEach(l => { const q = U.num(l.qtyGeneral) + U.num(l.qtyEvent); if (q <= 0) return; e.qty += q; if (l.dluo && (!e.dluo || l.dluo < e.dluo)) e.dluo = l.dluo; });
    }));
    return idx;
  },
  _coeffRows(kind) {
    const cl = this.coeffList, min = this._coeffNum(cl.min), max = this._coeffNum(cl.max), all = [];
    if (kind === 'acc') {
      (Store.state.catalogA || []).forEach(a => {
        const c = Pricing.accCalc(a); if (!(c.cost > 0)) return;
        const w = B2B.accWidths(a);
        all.push({ key: 'A|' + a.id, id: a.id, name: a.name, variant: a.mainWidth || w[0] || '', group: a.category || '', price: c.priceTTC, cost: c.cost, coeff: c.effCoeff, qty: U.num(a.stockGeneral) + U.num(a.stockEvent), dluo: '' });
      });
    } else {
      const sidx = this._stockIndex();
      (Store.state.catalogM || []).forEach(p => {
        const base = Pricing.baseUnitCost(p), vs = (p.variants || []).filter(v => v.enabled !== false);
        vs.forEach((v, i) => {
          const c = Pricing.variantCalc(p, v, i, base, vs.length), s = sidx[p.id + '|' + v.id] || { qty: 0, dluo: '' };
          all.push({ key: 'M|' + p.id + '|' + v.id, id: p.id, name: p.name, variant: Pricing.labelVariant(v), group: p.meatType || '', price: c.priceTTC, cost: c.cost, coeff: c.effCoeff, qty: s.qty, dluo: s.dluo });
        });
      });
    }
    const rows = all.filter(r => (min == null || r.coeff >= min - 1e-9) && (max == null || r.coeff <= max + 1e-9)
      && (!cl.stockOnly || r.qty > 0) && U.has(r.name + ' ' + r.variant + ' ' + r.group, cl.q));
    const by = cl.sort;
    rows.sort((a, b) => by === 'dluo' ? ((a.dluo || '9999') < (b.dluo || '9999') ? -1 : (a.dluo || '9999') > (b.dluo || '9999') ? 1 : b.coeff - a.coeff)
      : by === 'name' ? U.sortFr(a.name + ' ' + a.variant, b.name + ' ' + b.variant) : b.coeff - a.coeff || U.sortFr(a.name, b.name));
    return rows;
  },
  _coeffLabel() {
    const cl = this.coeffList, f = x => String(x).replace('.', ',');
    const min = this._coeffNum(cl.min), max = this._coeffNum(cl.max);
    return min != null && max != null ? `coeff de ${f(min)} à ${f(max)}` : min != null ? `coeff ${f(min)} et plus` : max != null ? `coeff jusqu'à ${f(max)}` : 'tous les coeff';
  },
  _coeffListHTML(kind) {
    const cl = this.coeffList, rows = this._coeffRows(kind), acc = kind === 'acc';
    const min = this._coeffNum(cl.min), max = this._coeffNum(cl.max), on = (a, b) => min === a && max === b;
    const sel = rows.filter(r => !cl.excluded.includes(r.key));
    const presets = [['Tous', null, null], ['≥ 2', 2, null], ['≥ 2,5', 2.5, null], ['2 à 2,5', 2, 2.5]];
    return `<div class="card sensitive" id="coeffListCard">
      <h2 class="no-print">🎯 Liste par coefficient <span class="muted" style="font-weight:400;font-size:.85rem;">· ${acc ? 'accessoires' : 'mastication'}, coeff public</span></h2>
      <div class="print-only"><h2 style="margin:0 0 4px;">${acc ? 'Accessoires' : 'Mastication'} — ${U.esc(this._coeffLabel())}</h2><p style="margin:0 0 8px;">Liste du ${new Date().toLocaleDateString('fr-FR')} · ${sel.length} ligne(s)</p></div>
      <div class="no-print">
        <p class="muted help mb0">Idée panier offert : à valeur affichée égale, un produit à fort coeff te coûte moins cher à offrir. Coche les lignes à garder, puis imprime ou copie la liste. Prix et coût = ceux de la fiche ${acc ? 'accessoire' : 'Prix mastication'} (frais de port d'achat estimés compris).</p>
        <div class="frow mt" style="gap:10px;align-items:flex-end;flex-wrap:wrap;">
          ${U.seg(presets.map(([l, a, b]) => ({ l, on: on(a, b), js: `Stats.setCoeffRange(${a === null ? 'null' : a},${b === null ? 'null' : b})` })), { wrap: true, sm: true })}
          <div class="fg" style="max-width:96px;margin:0;"><label>Coeff de</label><input id="cl_min" type="text" inputmode="decimal" value="${U.esc(cl.min)}" placeholder="min" onchange="Stats.setCoeffFilter('min',this.value)"></div>
          <div class="fg" style="max-width:96px;margin:0;"><label>à</label><input id="cl_max" type="text" inputmode="decimal" value="${U.esc(cl.max)}" placeholder="max" onchange="Stats.setCoeffFilter('max',this.value)"></div>
          <div class="fg" style="max-width:220px;margin:0;"><label>Recherche</label><input id="cl_q" value="${U.esc(cl.q)}" placeholder="nom du produit…" oninput="Stats.setCoeffFilter('q',this.value);U.refocus('cl_q')"></div>
        </div>
        <div class="frow mt" style="gap:10px;align-items:center;flex-wrap:wrap;">
          ${U.seg([{ l: 'Tout le catalogue', on: !cl.stockOnly, js: 'Stats.setCoeffFilter(\'stockOnly\',false)' }, { l: '📦 En stock seulement', on: cl.stockOnly, js: 'Stats.setCoeffFilter(\'stockOnly\',true)' }], { wrap: true, sm: true })}
          ${U.seg([['coeff', 'Tri : coeff ↓'], ['dluo', 'Tri : DLUO'], ['name', 'Tri : nom']].map(([k, l]) => ({ l, on: cl.sort === k, js: `Stats.setCoeffFilter('sort','${k}')` })), { wrap: true, sm: true })}
        </div>
        <div class="frow mt" style="gap:6px;align-items:center;flex-wrap:wrap;">
          <button class="btn-cta btn-sm" onclick="Stats.coeffPrint()">🖨 Imprimer la sélection</button>
          <button class="btn-ghost btn-sm" onclick="Stats.coeffCopy()">📋 Copier la liste</button>
          ${U.seg([{ l: '☑ Tout cocher', js: 'Stats.coeffAll(true)' }, { l: '☐ Tout décocher', js: 'Stats.coeffAll(false)' }], { sm: true })}
          <span class="muted" style="margin-left:auto;">${sel.length} / ${rows.length} ligne(s) · ${U.esc(this._coeffLabel())}</span>
        </div>
      </div>
      ${rows.length ? U.fold('coeff', rows.length, `<div class="table-wrap mt"><table>
        <thead><tr><th class="no-print"><input type="checkbox" ${sel.length === rows.length ? 'checked' : ''} onchange="Stats.coeffAll(this.checked)"></th><th class="col-name">Produit</th><th>${acc ? 'Largeur' : 'Variante'}</th><th>${acc ? 'Catégorie' : 'Viande'}</th><th class="num">Prix TTC</th><th class="num">Coût de revient</th><th class="num">Coeff</th><th class="num">En stock</th>${acc ? '' : '<th>DLUO</th>'}</tr></thead>
        <tbody>${rows.map(r => `<tr class="${cl.excluded.includes(r.key) ? 'excluded-from-print' : ''}">
          <td class="no-print"><input type="checkbox" ${cl.excluded.includes(r.key) ? '' : 'checked'} onchange="Stats.coeffToggle('${r.key}')"></td>
          <td class="col-name"><a href="${acc ? '#/accessoires/' + r.id : '#/catalogue/edit/' + r.id}" title="Ouvrir la fiche">${U.esc(r.name)}</a></td>
          <td>${U.esc(r.variant)}</td><td>${U.esc(r.group)}</td>
          <td class="num">${U.eur(r.price)}</td><td class="num sensitive">${U.eur(r.cost)}</td><td class="num sensitive"><b>${r.coeff.toFixed(2)}</b></td>
          <td class="num">${r.qty > 0 ? U.qty(r.qty) : '<span class="muted">0</span>'}</td>${acc ? '' : `<td>${r.dluo ? U.frDate(r.dluo) : '<span class="muted">—</span>'}</td>`}</tr>`).join('')}</tbody></table></div>`)
        : `<p class="muted mt">Aucune ligne dans cette fourchette${cl.stockOnly ? ' (essaie « Tout le catalogue » si tu veux aussi les produits sans stock)' : ''}.</p>`}
    </div>`;
  },
  renderCoeffList() { const box = document.getElementById('coeffList'); if (box) box.innerHTML = this._coeffListHTML(this.priceKind === 'acc' ? 'acc' : 'mast'); },
  setCoeffFilter(k, v) { this.coeffList[k] = v; this.renderCoeffList(); },
  setCoeffRange(a, b) { this.coeffList.min = a === null ? '' : String(a); this.coeffList.max = b === null ? '' : String(b); this.renderCoeffList(); },
  coeffToggle(key) { const ex = this.coeffList.excluded, i = ex.indexOf(key); if (i >= 0) ex.splice(i, 1); else ex.push(key); this.renderCoeffList(); },
  coeffAll(checked) {
    const keys = this._coeffRows(this.priceKind === 'acc' ? 'acc' : 'mast').map(r => r.key), ex = this.coeffList.excluded;
    this.coeffList.excluded = checked ? ex.filter(k => !keys.includes(k)) : [...new Set(ex.concat(keys))];
    this.renderCoeffList();
  },
  /* Impression : la page entière sauf cette carte (classe `print-focus`, retirée après l'impression). */
  coeffPrint() {
    document.body.classList.add('print-focus');
    const done = () => { document.body.classList.remove('print-focus'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1500);
  },
  coeffCopy() {
    const acc = this.priceKind === 'acc', rows = this._coeffRows(acc ? 'acc' : 'mast').filter(r => !this.coeffList.excluded.includes(r.key));
    if (!rows.length) { U.toast('Aucune ligne cochée à copier.'); return; }
    const f = n => U.eur(n).replace(/[  ]/g, ' ');
    const text = (acc ? 'Accessoires' : 'Mastication') + ' — ' + this._coeffLabel() + ' (' + rows.length + ')\n' + rows.map(r =>
      '• ' + r.name + (r.variant ? ' — ' + r.variant : '') + ' : ' + f(r.price) + ' · coeff ' + r.coeff.toFixed(2).replace('.', ',') + ' · stock ' + U.qty(r.qty) + (r.dluo ? ' · DLUO ' + U.frDate(r.dluo) : '')).join('\n');
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); U.toast('Liste copiée (' + rows.length + ' lignes).'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => U.toast('Liste copiée (' + rows.length + ' lignes).')).catch(fallback);
    else fallback();
  },

  renderPrice() { return this.priceKind === 'acc' ? this.renderPriceAcc() : this.renderPriceMast(); },

  renderPriceMast() {
    const S = Store.state.settings;
    const products = Store.state.catalogM;
    // même init paresseuse que B2B.render() : au cas où cette page est ouverte
    // avant la page Revente pro, la remise partagée doit quand même refléter
    // la dernière valeur enregistrée (ou 20% par défaut), pas rester à 0.
    B2B._loadDiscounts();
    const statsPublic = (p) => this.variantStats(p, false);
    const statsB2B = (p) => this.variantStats(p, true);

    let sumCoeff = 0, sumMargin = 0, nPub = 0, sumCoeffB2B = 0, sumMarginB2B = 0, nB2B = 0;
    const meatCount = {}, supplierCount = {};
    products.forEach(p => {
      const sp = statsPublic(p);
      if (sp) { sumCoeff += sp.avg; sumMargin += sp.marginAvg; nPub++; }
      const sb = statsB2B(p);
      if (sb) { sumCoeffB2B += sb.avg; sumMarginB2B += sb.marginAvg; nB2B++; }
      const meat = p.meatType || 'Non spécifié';
      meatCount[meat] = (meatCount[meat] || 0) + 1;
      const sup = p.mainSupplierId ? Store.supplierName(p.mainSupplierId) : 'Non spécifié';
      supplierCount[sup] = (supplierCount[sup] || 0) + 1;
    });

    const bins = this._bins();
    const binCounts = (statsFn, key) => bins.map(b => {
      let n = 0;
      products.forEach(p => { const s = statsFn(p); if (s) n += s[key || 'coeffs'].filter(c => c >= b.min && c < b.max).length; });
      return n;
    });

    App.mount(`
      <div class="view-title"><h1>Statistiques</h1><span class="sub">coefficients & marges — public et B2B</span></div>
      ${this.tabBar()}${this._priceKindBar()}
      <div class="grid c4">
        <div class="kpi"><div class="v">${products.length}</div><div class="l">Total produits</div></div>
        <div class="kpi sensitive"><div class="v">${(nPub ? sumCoeff / nPub : 0).toFixed(2)}</div><div class="l">Coeff moyen</div></div>
        <div class="kpi good sensitive"><div class="v">${(nPub ? sumMargin / nPub : 0).toFixed(1)}%</div><div class="l">Marge moyenne</div></div>
        <div class="kpi info2 sensitive"><div class="v">${(nB2B ? sumCoeffB2B / nB2B : 0).toFixed(2)}</div><div class="l">Coeff moyen B2B</div></div>
        <div class="kpi info2 sensitive"><div class="v">${(nB2B ? sumMarginB2B / nB2B : 0).toFixed(1)}%</div><div class="l">Marge moyenne B2B</div></div>
        <div class="kpi"><div class="v">${Object.keys(meatCount).length}</div><div class="l">Viandes</div></div>
        <div class="kpi"><div class="v">${Object.keys(supplierCount).length}</div><div class="l">Fournisseurs</div></div>
      </div>
      <div class="grid c2 mt">
        <div class="card"><h2>🥩 Répartition par type de viande</h2><div style="position:relative;height:260px;">${products.length ? '<canvas id="statsChartMeat"></canvas>' : '<p class="muted">Aucun produit.</p>'}</div></div>
        <div class="card"><h2>🏬 Répartition par fournisseur</h2><div style="position:relative;height:260px;">${products.length ? '<canvas id="statsChartSupplier"></canvas>' : '<p class="muted">Aucun produit.</p>'}</div></div>
      </div>
      <div class="grid c2 mt">
        <div class="card sensitive"><h2>📊 Distribution des coefficients (Public)</h2><div style="position:relative;height:260px;">${products.length ? '<canvas id="statsChartCoeff"></canvas>' : '<p class="muted">Aucun produit.</p>'}</div></div>
        <div class="card sensitive" style="border-left:4px solid var(--caramel);">
          <div class="frow" style="justify-content:space-between;align-items:center;">
            <h2 style="margin:0;">🤝 Distribution des coefficients (B2B)</h2>
            <div class="fg" style="max-width:150px;margin:0;"><label>Remise globale ${B2B._client() === 'ent' ? 'entreprise' : 'micro'} (%)</label><input type="number" step="0.1" value="${B2B._pct1(B2B._discView(B2B.discount, Pricing.vatRate(), B2B._client()))}" onchange="Stats.setB2BDiscount(this.value)"></div>
          </div>
          <div style="position:relative;height:230px;">${products.length ? '<canvas id="statsChartCoeffB2B"></canvas>' : '<p class="muted">Aucun produit.</p>'}</div>
        </div>
      </div>
      <div id="coeffList" class="mt print-target">${this._coeffListHTML('mast')}</div>
      <div id="statsDetail"></div>`);

    if (products.length) this.drawCharts(meatCount, supplierCount, bins, binCounts(statsPublic), { ent: binCounts(statsB2B), micro: binCounts(statsB2B, 'coeffsMicro') }, statsPublic, statsB2B);
    if (this.detail) this.renderDetail();
  },

  /* Coeff effectif par variante active d'un produit. En B2B, applique la
     remise globale (B2B.discount) ou la décote propre au produit
     (p.b2bDiscount, gérée sur la page Revente pro) au prix HT avant de
     recalculer le coeff par rapport au coût réel. */
  variantStats(p, isB2B) {
    const S = Store.state.settings;
    const base = Pricing.baseUnitCost(p);
    const discPct = isB2B ? B2B.effectiveDiscount(p) : 0;
    const vat = Pricing.vatRate(p) / 100;   // même TVA que B2B.productStats
    const na = (p.variants || []).filter(v => v.enabled !== false).length;
    let idx = 0;
    const variants = (p.variants || []).filter(v => v.enabled !== false).map(v => {
      const c = Pricing.variantCalc(p, v, idx, base, na); idx++;
      let coeff = c.effCoeff, coeffMicro = c.effCoeff, profitB2B = 0;
      if (isB2B) {
        const proHT = c.priceHT * (1 - B2B.cappedDiscount(c.priceHT, c.cost, discPct).applied / 100);   // remise plafonnée comme dans Revente pro
        coeff = c.cost > 0 ? proHT / c.cost : 0;
        coeffMicro = B2B.coeffMicro(coeff, vat);   // non assujetti : × (1 + TVA) ; assujetti : = coeff entreprise (recette nette)
        profitB2B = proHT - c.cost - proHT * U.num(S.socialTaxRate) / 100;   // même formule que « Bénéfice B2B » de Revente pro
      }
      return { label: Pricing.labelVariant(v), coeff, coeffMicro, profitB2B, margin: coeff > 0 ? (1 - 1 / coeff) * 100 : 0, critical: coeff < U.num(S.b2bCoeffThreshold) };
    });
    if (!variants.length) return null;
    const coeffs = variants.map(v => v.coeff);
    return { variants, coeffs, coeffsMicro: variants.map(v => v.coeffMicro), avg: coeffs.reduce((a, b) => a + b, 0) / coeffs.length, marginAvg: variants.reduce((a, v) => a + v.margin, 0) / variants.length };
  },

  /* ───────── PRIX & MARGES — ACCESSOIRES (2026-10-10) ─────────
     Même page que la mastication : tuiles, répartitions (catégorie, largeur de sangle), distribution des coeff public / B2B avec le seuil et la remise
     globale des ACCESSOIRES (B2B.discountAcc, plafonnée comme dans Revente pro), + classements : accessoires les plus vendus, sangles et couleurs les plus utilisées. */
  accVariantStats(a, isB2B) {
    const S = Store.state.settings, thr = this._thr(true);
    if (!(Pricing.accCalc(a).cost > 0)) return null;   // fiche sans coût (pas encore chiffrée) : ignorée comme une fiche sans variante
    const w = B2B.accWidths(a), label = a.mainWidth || w[0] || 'Standard';
    let coeff, coeffMicro, profitB2B = 0;
    if (isB2B) { const it = B2B.accStats(a); coeff = it.coeffB2B; coeffMicro = it.coeffMicro; profitB2B = it.profitB2B; }
    else { coeff = coeffMicro = Pricing.accCalc(a).effCoeff; }
    const v = { label, coeff, coeffMicro, profitB2B, margin: coeff > 0 ? (1 - 1 / coeff) * 100 : 0, critical: coeff < thr };
    return { variants: [v], coeffs: [coeff], coeffsMicro: [coeffMicro], avg: coeff, marginAvg: v.margin };
  },
  setB2BDiscountAcc(v) {
    const r = B2B._discBase(v, Pricing.vatRate(), B2B._client());
    B2B.discountAcc = r.base;
    localStorage.setItem('touffu_b2bDiscountAcc', B2B.discountAcc);
    this.detail = null;
    this.render();
    B2B._clampToast(r);
  },
  /* Fabrications réellement faites (🛠 Fabriquer) : historique permanent `settings.fabHistory` + entrées plus anciennes encore dans le journal (sans doublon). */
  _fabEvents() {
    const seen = new Set(), out = [];
    (Store.state.settings.fabHistory || []).forEach(f => { seen.add(f.id); out.push(f); });
    (Store.state.journal || []).forEach(j => {
      const u = j.undo; if (j.action !== 'fabrication' || !u || u.type !== 'fabricate' || !u.data) return;
      const id = u.data.fid || j.id; if (seen.has(id)) return; seen.add(id);
      out.push({ id, ts: j.ts, accId: u.data.accId, n: u.data.n, mats: u.data.mats || [] });
    });
    return out;
  },
  /* Sangles utilisées : { source: 'fabrications' | 'ventes', refs: [{label, m, n}], colors: [{label, m, n}] } (m = mètres, n = fabrications / pièces). Mètres = unité des rouleaux.
     Source 1 (fiable, donne la COULEUR) : les fabrications enregistrées. Sans fabrication : estimation ventes × nomenclature des fiches (couleur connue seulement si la fiche cite une sangle précise). */
  _strapUsage() {
    const refs = {}, colors = {}, add = (map, key, label, m, n) => { const g = map[key] || (map[key] = { label, m: 0, n: 0 }); g.m += m; g.n += n; };
    const colorOf = m => String(m.product || m.name || '?').trim();
    const widthOf = m => String(m.variant || '').trim();
    const events = this._fabEvents();
    let used = 0;
    events.forEach(f => (f.mats || []).forEach(x => {
      const m = Store.material(x.id); if (!m || !Store.isSangleKind(m.kind)) return;
      const c = colorOf(m), lab = (c + ' ' + widthOf(m)).trim();
      add(refs, m.id, lab, U.num(x.qty), 1); add(colors, c.toLowerCase(), c, U.num(x.qty), 1); used++;
    }));
    let source = 'fabrications';
    if (!used) {   // aucune fabrication enregistrée : estimation d'après les accessoires vendus
      source = 'ventes';
      (Store.state.sales || []).filter(s => !s.cancelled).forEach(s => (s.items || []).forEach(i => {
        if (i.kind !== 'A') return; const a = Store.state.catalogA.find(x => x.id === i.pId); if (!a) return;
        (a.bom || []).forEach(l => {
          if (Accessoires.bomLineUnit(l) !== 'm') return;
          const metres = U.num(i.qty) * U.num(l.qty);
          const m = l.materialId ? Store.material(l.materialId) : null;
          if (m && Store.isSangleKind(m.kind)) { const c = colorOf(m); add(refs, m.id, (c + ' ' + widthOf(m)).trim(), metres, U.num(i.qty)); add(colors, c.toLowerCase(), c, metres, U.num(i.qty)); }
          else if (l.familyKey) { const fam = Accessoires.families().find(f => f.key === l.familyKey); add(refs, 'f:' + l.familyKey, (fam ? fam.label : l.familyKey) + ' (moyenne)', metres, U.num(i.qty)); }
        });
      }));
    }
    const top = map => Object.values(map).sort((a, b) => b.m - a.m || b.n - a.n).slice(0, 10);
    return { source, nEvents: events.length, refs: top(refs), colors: top(colors) };
  },
  _topAccessories() {
    const g = {};
    (Store.state.sales || []).filter(s => !s.cancelled).forEach(s => (s.items || []).forEach(i => {
      if (i.kind !== 'A') return;
      const key = i.pId || ('name:' + (i.name || '?')), r = g[key] || (g[key] = { pId: i.pId, name: i.name || '(sans nom)', qty: 0, ca: 0 });
      r.qty += U.num(i.qty); r.ca += U.num(i.price) * U.num(i.qty);
    }));
    return Object.values(g).sort((a, b) => b.qty - a.qty || b.ca - a.ca).slice(0, 10);
  },
  /* Classement à barres (sans librairie) : rows = [{label, value, sub, href}]. */
  _rankCard(title, rows, fmt, empty, note) {
    const max = Math.max(1, ...rows.map(r => r.value));
    return `<div class="card"><h2>${title}</h2>${rows.length ? rows.map((r, i) => `<div style="display:flex;align-items:center;gap:8px;margin:5px 0;">
      <span style="flex:0 0 40%;overflow-wrap:anywhere;font-size:.88rem;">${i + 1}. ${r.href ? `<a href="${r.href}" style="color:inherit;">${U.esc(r.label)}</a>` : U.esc(r.label)}${r.sub ? ` <span class="muted" style="font-size:.74rem;">${U.esc(r.sub)}</span>` : ''}</span>
      <div style="flex:1;background:var(--th-bg);border-radius:6px;height:16px;"><div style="width:${Math.max(3, r.value / max * 100)}%;height:100%;background:var(--caramel);border-radius:6px;"></div></div>
      <b class="sensitive" style="flex:0 0 auto;min-width:70px;text-align:right;font-size:.85rem;">${fmt(r)}</b></div>`).join('') : `<p class="muted">${empty}</p>`}${note ? `<p class="muted" style="font-size:.78rem;margin:8px 0 0;">${note}</p>` : ''}</div>`;
  },

  renderPriceAcc() {
    const items = Store.state.catalogA;
    B2B._loadDiscounts();
    const statsPublic = a => this.accVariantStats(a, false), statsB2B = a => this.accVariantStats(a, true);
    let sumCoeff = 0, sumMargin = 0, nPub = 0, sumCoeffB2B = 0, sumMarginB2B = 0, nB2B = 0;
    const catCount = {}, widthCount = {};
    items.forEach(a => {
      const sp = statsPublic(a); if (sp) { sumCoeff += sp.avg; sumMargin += sp.marginAvg; nPub++; }
      const sb = statsB2B(a); if (sb) { sumCoeffB2B += sb.avg; sumMarginB2B += sb.marginAvg; nB2B++; }
      const cat = a.category || 'Non spécifié'; catCount[cat] = (catCount[cat] || 0) + 1;
      const ws = B2B.accWidths(a); (ws.length ? ws : ['Non spécifié']).forEach(w => { widthCount[w] = (widthCount[w] || 0) + 1; });
    });
    const bins = this._bins();
    const binCounts = (fn, key) => bins.map(b => { let n = 0; items.forEach(a => { const s = fn(a); if (s) n += s[key || 'coeffs'].filter(c => c >= b.min && c < b.max).length; }); return n; });
    const none = '<p class="muted">Aucun accessoire.</p>';
    const top = this._topAccessories(), use = this._strapUsage();
    const fabNote = use.source === 'fabrications'
      ? `D'après tes ${use.nEvents} fabrication${use.nEvents > 1 ? 's' : ''} enregistrée${use.nEvents > 1 ? 's' : ''} (🛠 Fabriquer), en mètres de sangle.`
      : `Aucune fabrication enregistrée : estimation = accessoires vendus × mètres de la fiche. La couleur n'est connue que si la fiche cite une sangle précise ; elle se remplit toute seule à chaque 🛠 Fabriquer.`;
    App.mount(`
      <div class="view-title"><h1>Statistiques</h1><span class="sub">coefficients & marges — public et B2B</span></div>
      ${this.tabBar()}${this._priceKindBar()}
      <div class="grid c4">
        <div class="kpi"><div class="v">${items.length}</div><div class="l">Total accessoires</div></div>
        <div class="kpi sensitive"><div class="v">${(nPub ? sumCoeff / nPub : 0).toFixed(2)}</div><div class="l">Coeff moyen</div></div>
        <div class="kpi good sensitive"><div class="v">${(nPub ? sumMargin / nPub : 0).toFixed(1)}%</div><div class="l">Marge moyenne</div></div>
        <div class="kpi info2 sensitive"><div class="v">${(nB2B ? sumCoeffB2B / nB2B : 0).toFixed(2)}</div><div class="l">Coeff moyen B2B</div></div>
        <div class="kpi info2 sensitive"><div class="v">${(nB2B ? sumMarginB2B / nB2B : 0).toFixed(1)}%</div><div class="l">Marge moyenne B2B</div></div>
        <div class="kpi"><div class="v">${Object.keys(catCount).length}</div><div class="l">Catégories</div></div>
        <div class="kpi"><div class="v">${Object.keys(widthCount).filter(w => w !== 'Non spécifié').length}</div><div class="l">Largeurs de sangle</div></div>
      </div>
      <div class="grid c2 mt">
        <div class="card"><h2>🐕 Répartition par catégorie</h2><div style="position:relative;height:260px;">${items.length ? '<canvas id="statsChartMeat"></canvas>' : none}</div></div>
        <div class="card"><h2>📏 Répartition par largeur de sangle</h2><div style="position:relative;height:260px;">${items.length ? '<canvas id="statsChartSupplier"></canvas>' : none}</div>
          <p class="muted" style="font-size:.78rem;margin:6px 0 0;">Un accessoire proposé en plusieurs largeurs est compté dans chacune.</p></div>
      </div>
      <div class="grid c2 mt">
        <div class="card sensitive"><h2>📊 Distribution des coefficients (Public)</h2><div style="position:relative;height:260px;">${items.length ? '<canvas id="statsChartCoeff"></canvas>' : none}</div></div>
        <div class="card sensitive" style="border-left:4px solid var(--caramel);">
          <div class="frow" style="justify-content:space-between;align-items:center;">
            <h2 style="margin:0;">🤝 Distribution des coefficients (B2B)</h2>
            <div class="fg" style="max-width:150px;margin:0;"><label>Remise globale accessoires ${B2B._client() === 'ent' ? 'entreprise' : 'micro'} (%)</label><input type="number" step="0.1" value="${B2B._pct1(B2B._discView(B2B.discountAcc, Pricing.vatRate(), B2B._client()))}" onchange="Stats.setB2BDiscountAcc(this.value)"></div>
          </div>
          <div style="position:relative;height:230px;">${items.length ? '<canvas id="statsChartCoeffB2B"></canvas>' : none}</div>
        </div>
      </div>
      <div class="grid c3 mt">
        ${this._rankCard('🏆 Accessoires les plus vendus', top.map(r => ({ label: r.name, value: r.qty, sub: U.eur(r.ca), href: r.pId ? '#/accessoires/' + r.pId : '' })), r => U.qty(r.value) + ' vendu' + (r.value > 1 ? 's' : ''), 'Aucun accessoire vendu pour le moment.', 'Toutes les ventes enregistrées (classement par quantité ; en petit : chiffre d\'affaires).')}
        ${this._rankCard('📏 Sangles les plus utilisées', use.refs.map(r => ({ label: r.label, value: r.m })), r => U.qty(r.value) + ' m', 'Aucune sangle utilisée pour le moment.', fabNote)}
        ${this._rankCard('🎨 Couleurs les plus utilisées', use.colors.map(r => ({ label: r.label, value: r.m })), r => U.qty(r.value) + ' m', 'Pas encore de couleur connue : elle est retenue à chaque 🛠 Fabriquer.', 'Toutes largeurs confondues. ' + fabNote)}
      </div>
      <div id="coeffList" class="mt print-target">${this._coeffListHTML('acc')}</div>
      <div id="statsDetail"></div>`);

    if (items.length) this.drawCharts(catCount, widthCount, bins, binCounts(statsPublic), { ent: binCounts(statsB2B), micro: binCounts(statsB2B, 'coeffsMicro') }, statsPublic, statsB2B, true);
    if (this.detail) this.renderDetail();
  },

  /* Remise B2B globale partagée avec la page Revente pro (même localStorage
     touffu_b2bDiscount) : la modifier ici la modifie aussi là-bas. */
  setB2BDiscount(v) {
    const r = B2B._discBase(v, Pricing.vatRate(), B2B._client());   // saisie dans l'unité du client choisi (page Revente pro) → base stockée
    B2B.discount = r.base;
    localStorage.setItem('touffu_b2bDiscount', B2B.discount);
    this.detail = null;
    this.render();
    B2B._clampToast(r);
  },

  drawCharts(meatCount, supplierCount, bins, binsPublic, binsB2B, statsPublic, statsB2B, acc) {
    if (typeof Chart === 'undefined') return; // CDN indisponible (hors-ligne) : pas bloquant
    const dark = Theme.get() === 'dark';
    const textColor = dark ? '#eee3d3' : '#1c2b33';
    const borderColor = dark ? '#1c3844' : '#ffffff';
    const palette = U.CHART_COLORS;
    Object.values(this._charts).forEach(c => c?.destroy());
    this._charts = {};

    const buildPie = (id, counts, onPick, ctr) => {
      const canvas = document.getElementById(id); if (!canvas) return;
      const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      const data = labels.map(l => counts[l]);
      this._charts[id] = new Chart(canvas, {
        type: 'doughnut',
        plugins: [U.donutCenter(textColor, null, ctr.label, ctr.parts)],
        data: { labels, datasets: [{ data: U.donutShown(data), real: data, backgroundColor: labels.map((_, i) => palette[i % palette.length]), borderColor, borderWidth: 3, borderRadius: 7, hoverOffset: 6 }] },
        options: {
          maintainAspectRatio: false, cutout: '58%',
          plugins: { legend: { position: 'right', labels: { color: textColor, usePointStyle: true, pointStyle: 'circle', boxWidth: 9, boxHeight: 9, padding: 12, font: { family: 'Quicksand', size: 11 } }, onClick: (e, item, legend) => onPick(legend.chart.data.labels[item.index]) }, tooltip: { callbacks: { label: (c) => ` ${c.label} : ${U.qty(c.dataset.real[c.dataIndex])}` } } },
          onClick: (evt, els) => { if (els.length) onPick(labels[els[0].index]); }
        }
      });
    };
    if (acc) {   // accessoires : camembert 1 = catégorie, camembert 2 = largeur de sangle (stockés sous les mêmes ids de canvas)
      buildPie('statsChartMeat', meatCount, (label) =>
        this.showAccDetail(a => (a.category || 'Non spécifié') === label, `Catégorie : ${label}`, statsPublic), { label: 'accessoires' });
      buildPie('statsChartSupplier', supplierCount, (label) =>
        this.showAccDetail(a => { const w = B2B.accWidths(a); return (w.length ? w : ['Non spécifié']).includes(label); }, `Largeur de sangle : ${label}`, statsPublic), { label: 'largeurs', parts: true });
    } else {
      buildPie('statsChartMeat', meatCount, (label) =>
        this.showDetail(p => (p.meatType || 'Non spécifié') === label, `Viande : ${label}`, statsPublic), { label: 'produits' });
      buildPie('statsChartSupplier', supplierCount, (label) =>
        this.showDetail(p => (p.mainSupplierId ? Store.supplierName(p.mainSupplierId) : 'Non spécifié') === label, `Fournisseur : ${label}`, statsPublic), { label: 'fournisseurs', parts: true });
    }

    // Seuil critique (S.b2bCoeffThreshold) : bande rouge à gauche + ligne pointillée « Seuil x,xx » (plugin maison, pas de librairie).
    // La position est interpolée dans la tranche de 0,25 qui contient le seuil (au-delà de la dernière tranche : à son bord gauche).
    const thr = this._thr(acc);
    const thrX = (chart) => {
      const sx = chart.scales.x, w = sx.getPixelForValue(1) - sx.getPixelForValue(0);
      const last = bins.length - 1, idx = Math.min(Math.floor(thr / this.BIN_STEP), last);
      const frac = idx < last ? (thr - idx * this.BIN_STEP) / this.BIN_STEP : 0;
      return sx.getPixelForValue(idx) - w / 2 + frac * w;
    };
    const thresholdPlugin = {
      id: 'coeffThreshold',
      beforeDatasetsDraw: (chart) => {
        if (!(thr > 0)) return;
        const { ctx, chartArea: a } = chart, x = thrX(chart);
        ctx.save(); ctx.fillStyle = 'rgba(192,86,74,.3)'; ctx.fillRect(a.left, a.top, Math.max(0, x - a.left), a.bottom - a.top); ctx.restore();
      },
      afterDatasetsDraw: (chart) => {
        if (!(thr > 0)) return;
        const { ctx, chartArea: a } = chart, x = thrX(chart), txt = 'Seuil ' + thr.toFixed(2).replace('.', ',');
        ctx.save();
        ctx.strokeStyle = '#c0564a'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#c0564a'; ctx.font = '700 12px Quicksand, "Segoe UI", sans-serif'; ctx.textBaseline = 'top';
        const wTxt = ctx.measureText(txt).width, onLeft = x - 6 - wTxt >= a.left;   // étiquette dans la bande rouge (à gauche), sinon à droite de la ligne
        ctx.textAlign = onLeft ? 'right' : 'left'; ctx.fillText(txt, onLeft ? x - 6 : x + 6, a.top + 4);
        ctx.restore();
      }
    };
    // Nombre de variantes (ou d'accessoires) écrit AU-DESSUS de chaque barre (Antho 2026-10-11 : l'axe de gauche seul ne permettait pas de lire les effectifs) ; les tranches à 0 restent vides.
    const valuesPlugin = {
      id: 'barValues',
      afterDatasetsDraw: (chart) => {
        const { ctx } = chart, multi = chart.data.datasets.length > 1, size = multi ? 11 : 14;
        ctx.save(); ctx.fillStyle = textColor; ctx.font = `800 ${size}px Quicksand, "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        chart.data.datasets.forEach((ds, di) => {
          const meta = chart.getDatasetMeta(di); if (meta.hidden) return;
          meta.data.forEach((bar, i) => { const v = ds.data[i]; if (v > 0) ctx.fillText(String(v), bar.x, bar.y - 4); });
        });
        ctx.restore();
      }
    };
    // Barres : chaque série garde sa couleur ; le danger est marqué par la ligne et la bande, pas par la couleur des barres.
    const buildBar = (id, datasets, statsFn, isB2B) => {
      const canvas = document.getElementById(id); if (!canvas) return;
      this._charts[id] = new Chart(canvas, {
        type: 'bar',
        data: { labels: bins.map(b => b.label), datasets: datasets.map(d => ({ ...d, borderRadius: 4 })) },
        plugins: [thresholdPlugin, valuesPlugin],
        options: {
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, grace: '12%', ticks: { color: textColor, precision: 0 }, title: { display: true, text: acc ? "Nombre d'accessoires" : 'Nombre de variantes', color: textColor, font: { size: 11, weight: '600' } } }, x: { ticks: { color: textColor, autoSkip: false, maxRotation: 60, font: { size: 10 } } } },
          plugins: { legend: { labels: { color: textColor, usePointStyle: true, pointStyle: 'circle', boxWidth: 9, boxHeight: 9, padding: 12, font: { family: 'Quicksand', size: 11 } } } },
          onClick: (evt, els) => {
            if (!els.length) return;
            const b = bins[els[0].index];
            if (isB2B) { if (acc) this.showAccCoeffDetail(els[0].datasetIndex, els[0].index); else this.showCoeffDetail(els[0].datasetIndex, els[0].index); return; }
            if (acc) this.showAccDetail(a => { const s = statsFn(a); return s && s.coeffs.some(c => c >= b.min && c < b.max); }, `Accessoires Public — coeff ${b.label}`, statsFn, b.min, b.max);
            else this.showDetail(p => { const s = statsFn(p); return s && s.coeffs.some(c => c >= b.min && c < b.max); },
              `Variantes Public — coeff ${b.label}`, statsFn, b.min, b.max);
          }
        }
      });
    };
    buildBar('statsChartCoeff', [{ label: 'Variantes (Public)', data: binsPublic, backgroundColor: '#4a7c59' }], statsPublic, false);
    buildBar('statsChartCoeffB2B', [
      { label: 'Entreprise', data: binsB2B.ent, backgroundColor: '#a67153' },
      { label: 'Micro', data: binsB2B.micro, backgroundColor: '#6b8e9e' }
    ], statsB2B, true);
  },

  /* Tranches FIXES de 0,25 ancrées sur 0 : [0–0,25) … [2,25–2,50), puis « 2,5+ ». */
  BIN_STEP: 0.25,
  _bins() {
    const st = this.BIN_STEP, f = x => x.toFixed(2).replace('.', ',').replace(/,?0+$/, '');
    const bins = [];
    for (let i = 0; i < 10; i++) bins.push({ label: `${f(i * st)} – ${f((i + 1) * st)}`, min: i * st, max: (i + 1) * st });
    bins.push({ label: `${f(2.5)}+`, min: 2.5, max: Infinity });
    return bins;
  },

  /* Clic sur une barre du graphe B2B : variantes de la tranche pour la série cliquée (0 = entreprise, 1 = micro), triées par coeff croissant.
     Un 2e clic sur la même barre referme la liste. */
  showCoeffDetail(serie, binIdx) {
    const d = this.detail;
    if (d && d.kind === 'coeff' && !d.acc && d.serie === serie && d.binIdx === binIdx) { this.closeDetail(); return; }
    const b = this._bins()[binIdx], rows = [];
    Store.state.catalogM.forEach(p => {
      const s = this.variantStats(p, true); if (!s) return;
      s.variants.forEach(v => { const c = serie === 0 ? v.coeff : v.coeffMicro; if (c >= b.min && c < b.max) rows.push({ p, v, key: c }); });
    });
    rows.sort((x, y) => x.key - y.key || U.sortFr(x.p.name, y.p.name));
    this.detail = { kind: 'coeff', serie, binIdx, title: `Variantes B2B — ${serie === 0 ? 'prix entreprise' : 'prix micro'} — coeff ${b.label} (${rows.length})`, rows };
    this.renderDetail();
    setTimeout(() => document.getElementById('statsDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  },

  /* Drill-down : liste des produits (groupés par viande) correspondant au
     clic sur une part de camembert ou une barre de coeff, avec pour
     chaque variante son coeff/marge — lien direct vers la fiche produit. */
  showDetail(filterFn, title, statsFn, min, max) {
    const products = Store.state.catalogM.filter(filterFn);
    const groups = {};
    products.forEach(p => { const m = p.meatType || 'Non spécifié'; (groups[m] = groups[m] || []).push(p); });
    this.detail = { title, meats: Object.keys(groups).sort(U.sortFr), groups, statsFn, min: min === undefined ? null : min, max: max === undefined ? null : max };
    this.renderDetail();
    setTimeout(() => document.getElementById('statsDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  },

  /* Mêmes détails au clic pour les ACCESSOIRES (fiches catalogA, regroupées par catégorie ; lien vers la fiche Accessoires). */
  showAccDetail(filterFn, title, statsFn, min, max) {
    const items = Store.state.catalogA.filter(filterFn), groups = {};
    items.forEach(a => { const c = a.category || 'Non spécifié'; (groups[c] = groups[c] || []).push(a); });
    this.detail = { acc: true, title, meats: Object.keys(groups).sort(U.sortFr), groups, statsFn, min: min === undefined ? null : min, max: max === undefined ? null : max };
    this.renderDetail();
    setTimeout(() => document.getElementById('statsDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  },
  showAccCoeffDetail(serie, binIdx) {
    const d = this.detail;
    if (d && d.kind === 'coeff' && d.acc && d.serie === serie && d.binIdx === binIdx) { this.closeDetail(); return; }
    const b = this._bins()[binIdx], rows = [];
    Store.state.catalogA.forEach(a => {
      const s = this.accVariantStats(a, true); if (!s) return;
      s.variants.forEach(v => { const c = serie === 0 ? v.coeff : v.coeffMicro; if (c >= b.min && c < b.max) rows.push({ p: a, v, key: c }); });
    });
    rows.sort((x, y) => x.key - y.key || U.sortFr(x.p.name, y.p.name));
    this.detail = { kind: 'coeff', acc: true, serie, binIdx, title: `Accessoires B2B — ${serie === 0 ? 'prix entreprise' : 'prix micro'} — coeff ${b.label} (${rows.length})`, rows };
    this.renderDetail();
    setTimeout(() => document.getElementById('statsDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  },

  closeDetail() { this.detail = null; this.renderDetail(); },

  renderDetail() {
    const box = document.getElementById('statsDetail'); if (!box) return;
    if (!this.detail) { box.innerHTML = ''; return; }
    const link = p => this.detail.acc ? '#/accessoires/' + p.id : '#/catalogue/edit/' + p.id;   // fiche accessoire ou fiche prix mastication
    if (this.detail.kind === 'coeff') {
      const thr = this._thr(this.detail.acc), { title, rows } = this.detail;
      box.innerHTML = `<div class="card mt">
        <div class="frow" style="justify-content:space-between;align-items:center;"><h2 style="margin:0;">${U.esc(title)}</h2><button class="btn-ghost btn-sm" onclick="Stats.closeDetail()">✕ Fermer</button></div>
        ${rows.length ? U.fold('det:' + title, rows.length, `<div class="table-wrap"><table>
          <thead><tr><th class="col-name">Produit</th><th>Variante</th><th class="num">Coeff entreprise</th><th class="num">Coeff micro</th><th class="num">Bénéfice B2B</th></tr></thead>
          <tbody>${rows.map(({ p, v }) => `<tr>
            <td class="col-name"><a href="${link(p)}" title="Ouvrir la fiche produit">${U.esc(p.name)}</a></td>
            <td>${U.esc(v.label)}</td>
            <td class="num sensitive ${v.coeff < thr ? 'neg' : ''}">${v.coeff.toFixed(2)}${v.coeff < thr ? ' ⚠️' : ''}</td>
            <td class="num sensitive ${v.coeffMicro < thr ? 'neg' : ''}">${v.coeffMicro.toFixed(2)}</td>
            <td class="num sensitive ${v.profitB2B >= 0 ? 'pos' : 'neg'}"><b>${U.eur(v.profitB2B)}</b></td></tr>`).join('')}</tbody></table></div>`) : '<p class="muted mt">Aucune variante dans cette tranche.</p>'}
      </div>`;
      return;
    }
    const { title, meats, groups, statsFn, min, max } = this.detail;
    box.innerHTML = `<div class="card mt">
      <div class="frow" style="justify-content:space-between;align-items:center;"><h2 style="margin:0;">${U.esc(title)}</h2><button class="btn-ghost btn-sm" onclick="Stats.closeDetail()">✕ Fermer</button></div>
      ${U.fold('det:' + title, meats.reduce((a, m) => a + groups[m].length, 0), `${meats.map(m => {
        const items = groups[m];
        const cards = items.map(p => {
          const s = statsFn(p);
          if (!s) return '';
          const shown = (min == null) ? s.variants : s.variants.filter(v => v.coeff >= min && v.coeff < max);
          if (!shown.length) return '';
          const anyCritical = shown.some(v => v.critical);
          return `<a href="${link(p)}" class="card" style="text-decoration:none;color:inherit;display:block;${anyCritical ? 'border-left:4px solid #c0564a;' : ''}" title="Ouvrir la fiche produit (clic molette : nouvel onglet)">
            <b>${U.esc(p.name)}</b> ${anyCritical ? '<span class="badge bad">critique</span>' : ''}
            <div class="mt">${shown.map(v => `<div class="frow" style="justify-content:space-between;font-size:.8rem;padding:2px 0;">
              <span class="muted">${U.esc(v.label)}</span><span class="sensitive" style="font-weight:600;${v.critical ? 'color:#c0564a;' : 'color:#4a7c59;'}">coeff ${v.coeff.toFixed(2)} · ${v.margin.toFixed(1)}%</span></div>`).join('')}</div>
          </a>`;
        }).join('');
        if (!cards) return '';
        return `<h3 style="margin:16px 0 8px;">${this.detail.acc ? '🐕' : '🥩'} ${U.esc(m.toUpperCase())}</h3><div class="grid c3">${cards}</div>`;
      }).join('') || '<p class="muted mt">Aucun produit dans cette sélection.</p>'}`, { limit: 6, h: 380, unit: 'produits' })}
    </div>`;
  },

  /* ═══════════ ONGLET VENTES — performance commerciale ═══════════
     Exploite l'historique des ventes (Store.state.sales) : best-sellers,
     répartition par canal (en ligne / directe / événement), saisonnalité
     (par mois), synthèse (panier moyen…), CA par catégorie/viande, et
     produits dormants (catalogue jamais vendu sur la période). Toutes les
     données existent déjà dans les ventes enregistrées — rien à ressaisir. */
  _monthLabels: ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'],

  _saleChannelLabel(s) {
    return ({ event: 'Événement', online: 'En ligne', direct: 'Directe' })[Ventes._saleKind(s)];
  },
  _prodMeat(pId) {
    if (!pId) return 'Non spécifié';
    const p = Store.state.catalogM.find(x => x.id === pId) || Store.state.stockM.find(x => x.id === pId);
    return p ? (p.meatType || 'Non spécifié') : 'Non spécifié';
  },
  /* Type + largeur d'un accessoire vendu (via son template catalogA), pour les stats accessoires. */
  _accInfo(pId) {
    const a = Store.state.catalogA.find(x => x.id === pId);
    if (!a) return { type: 'Accessoire', width: 'Non spécifié' };
    const width = a.mainWidth || (a.strapWidths && a.strapWidths[0]) || 'Non spécifié';
    return { type: a.category || 'Accessoire', width };
  },

  _salesAgg() {
    const period = this.salesPeriod || 'all';
    const now = Date.now();
    const cut = now - 365 * 86400000;
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    const inPeriod = (ts) => period === 'all' ? true : period === '12m' ? ts >= cut : ts >= yearStart;
    const metric = this._metric();
    const kind = this.tab === 'sales' ? (this.salesKind || 'all') : 'all';   // filtre Mastication / Accessoires (onglet Ventes seulement)
    const keep = i => kind === 'all' || (kind === 'acc') === (i.kind === 'A');
    // Taux & frais — mêmes formules que le Tableau de bord (CA par mois), pour une compta cohérente.
    const S = Store.state.settings;
    const socStd = U.num(S.socialTaxRate) / 100;
    const socHM = Pricing.socialRateHandmade() / 100;
    const cardRate = U.num(S.cardFeeRate) / 100, stripeRate = U.num(S.stripeFeeRate) / 100;
    const cardBase = (s) => (s.payment === 'sumup' || s.payment === 'stripe') ? U.num(s.total) + U.num(s.shippingFeeCollected) : 0;
    const procFee = (s) => s.payment === 'sumup' ? cardBase(s) * cardRate : s.payment === 'stripe' ? cardBase(s) * stripeRate : 0;
    const allSales = Store.state.sales.filter(s => !s.cancelled);
    const sales = allSales.filter(s => inPeriod(s.ts));
    const prodMap = {};
    const byChannelCA = {}, byCatCA = {}, byMeatCA = {};
    const accType = {}, accWidth = {}; // stats accessoires : par type (Laisse/Collier…) et par largeur, {qty, ca}
    const byMonthQty = new Array(12).fill(0), byMonthCA = new Array(12).fill(0);
    const monthMap = {}; // 'YYYY-MM' -> agrégat chronologique (évolution dans le temps)
    let articles = 0, ca = 0;
    const soldPids = new Set();
    sales.forEach(s => {
      ca += U.num(s.total);
      const ch = this._saleChannelLabel(s);
      const mo = new Date(s.ts).getMonth();
      const mk = new Date(s.ts).toISOString().slice(0, 7);
      const my = monthMap[mk] || (monthMap[mk] = { key: mk, ca: 0, caAcc: 0, cogs: 0, articles: 0, nSales: 0, fee: 0, shipFee: 0, shipping: 0, boxCost: 0, eventFee: 0 });
      my.ca += U.num(s.total); my.nSales++;
      my.fee += procFee(s); my.shipFee += U.num(s.shippingFeeCollected); my.shipping += U.num(s.shippingCost); my.eventFee += Pricing.eventCost(s);
      (s.items || []).forEach(i => {
        if (i.kind === 'C') { my.boxCost += Pricing.saleItemCost(i); return; } // consommables (carton…) : coût compté à part, pas en produit vendu
        if (!keep(i)) return;
        const qty = U.num(i.qty), rev = U.num(i.price) * qty;
        articles += qty; my.articles += qty; my.cogs += Pricing.saleItemCost(i);
        if (i.kind === 'A') {
          my.caAcc += rev;
          const info = this._accInfo(i.pId);
          const at = accType[info.type] || (accType[info.type] = { qty: 0, ca: 0 }); at.qty += qty; at.ca += rev;
          const aw = accWidth[info.width] || (accWidth[info.width] = { qty: 0, ca: 0 }); aw.qty += qty; aw.ca += rev;
        }
        const key = i.pId || ('name:' + (i.name || '?'));
        let g = prodMap[key];
        if (!g) g = prodMap[key] = { key, name: i.name || '(sans nom)', qty: 0, ca: 0, kind: i.kind, pId: i.pId, meat: i.kind === 'M' ? this._prodMeat(i.pId) : '—', saleIds: new Set(), month: new Array(12).fill(0), singles: 0, lots: {} };
        g.qty += qty; g.ca += rev; g.saleIds.add(s.id); g.month[mo] += (metric === 'ca' ? rev : qty);
        // Détail « à l'unité / en lot » (SKU de lot, lot en vente manuelle)
        if (U.num(i.pack) >= 2) g.lots[i.pack] = (g.lots[i.pack] || 0) + U.num(i.packs); else g.singles += qty;
        if (i.pId) soldPids.add(i.pId);
        byChannelCA[ch] = (byChannelCA[ch] || 0) + rev;
        const cat = i.kind === 'A' ? 'Accessoires' : 'Mastication';
        byCatCA[cat] = (byCatCA[cat] || 0) + rev;
        if (i.kind === 'M') { const m = this._prodMeat(i.pId); byMeatCA[m] = (byMeatCA[m] || 0) + rev; }
        byMonthQty[mo] += qty; byMonthCA[mo] += rev;
      });
    });
    const products = Object.values(prodMap).map(g => ({ ...g, sales: g.saleIds.size }));
    // Produits dormants : fiches du catalogue jamais vendues SUR LA PÉRIODE.
    const lastSold = {};
    allSales.forEach(s => (s.items || []).forEach(i => { if (i.pId) lastSold[i.pId] = Math.max(lastSold[i.pId] || 0, s.ts); }));
    const dormant = [];
    if (kind !== 'acc') Store.state.catalogM.forEach(p => { if (!soldPids.has(p.id)) dormant.push({ name: p.name, cat: p.meatType || '—', last: lastSold[p.id] || null }); });
    if (kind !== 'mast') Store.state.catalogA.forEach(a => { if (!soldPids.has(a.id)) dormant.push({ name: a.name, cat: 'Accessoire', last: lastSold[a.id] || null }); });
    dormant.sort((a, b) => (a.last || 0) - (b.last || 0));
    // Frais de livraison sur achats + frais généraux : les MÊMES charges que la Compta (Compta.chargesPeriod), sur la période choisie.
    // Un mois sans vente mais avec une facture reste affiché, pour que le total soit celui de la Compta.
    const range = { from: period === 'all' ? 0 : period === '12m' ? cut : yearStart, to: now };
    const charges = Compta.chargesPeriod(range.from, range.to);
    Object.keys(charges.byMonth).forEach(k => { if (!monthMap[k]) monthMap[k] = { key: k, ca: 0, caAcc: 0, cogs: 0, articles: 0, nSales: 0, fee: 0, shipFee: 0, shipping: 0, boxCost: 0, eventFee: 0 }; });
    const months = Object.values(monthMap).sort((a, b) => a.key < b.key ? -1 : 1);
    const vatRate = U.num(S.vatRate);
    const uvMaint = Pricing.fixedOverheadMonthly(); // entretien UV + amortissement de tout le matériel, réparti par mois (0 si non renseigné)
    months.forEach(m => {
      m.marge = m.ca - m.cogs; // marge brute (CA − coût de revient des produits vendus)
      m.tva = vatRate > 0 ? m.ca * vatRate / (100 + vatRate) : 0; // TVA contenue dans le CA TTC (taux global, approximation)
      m.cotis = (m.caAcc * socHM + (m.ca - m.caAcc + m.shipFee) * socStd) * Pricing.urssafK(); // assujetti : base HT ; accessoires au taux fait main, reste + port au taux marchandises
      m.uvMaint = uvMaint; // charge fixe machine (filtres + nettoyage + main d'œuvre entretien)
      // Non assujetti : la TVA reste dans le bénéfice (tu la gardes). Assujetti : elle est reversée → déduite.
      const mc = charges.byMonth[m.key]; m.charges = mc ? mc.portBuy + mc.expensed : 0;   // frais de livraison sur achats + frais généraux du mois (comme la Compta)
      m.net = m.ca - m.cogs + m.shipFee - m.fee - m.shipping - m.boxCost - m.eventFee - m.cotis - m.uvMaint - m.charges - (S.vatActive ? m.tva : 0);
    });
    const nSales = kind === 'all' ? sales.length : sales.filter(s => (s.items || []).some(i => i.kind !== 'C' && keep(i))).length;
    return { charges, nSales, articles, ca, products, byChannelCA, byCatCA, byMeatCA, accType, accWidth, byMonthQty, byMonthCA, months, dormant, sales };
  },

  _monthKeyLabel(key) { const [y, mo] = String(key).split('-'); return (this._monthLabels[+mo - 1] || mo) + ' ' + y; },

  /* Tableau « Rentabilité par activité » (Mastication vs Accessoires) à partir d'un résultat Pricing.activityPnL.
     Réutilisé par la page Stats et le Tableau de bord. */
  _activityTable(p) {
    const va = Store.state.settings.vatActive;
    const M = p.masti, A = p.acc;
    const line = (lbl, key, sign) => {
      const mv = M[key], av = A[key];
      const cls = sign === '-' ? 'neg' : sign === '+' ? 'pos' : '';
      const fmt = v => !v ? '—' : (sign === '-' ? '− ' : sign === '+' ? '+ ' : '') + U.eur(v);
      return `<tr><td>${lbl}</td><td class="num sensitive ${cls}">${fmt(mv)}</td><td class="num sensitive ${cls}">${fmt(av)}</td></tr>`;
    };
    return `<div class="table-wrap mt"><table>
      <thead><tr><th>Poste</th><th class="num">🥩 Mastication</th><th class="num">🐕 Accessoires</th></tr></thead>
      <tbody>
        <tr><td>Chiffre d'affaires</td><td class="num sensitive">${U.eur(M.ca)}</td><td class="num sensitive">${U.eur(A.ca)}</td></tr>
        ${line('Coût de revient', 'cogs', '-')}
        <tr><td><b>Marge brute</b></td><td class="num sensitive ${M.marge >= 0 ? 'pos' : 'neg'}"><b>${U.eur(M.marge)}</b></td><td class="num sensitive ${A.marge >= 0 ? 'pos' : 'neg'}"><b>${U.eur(A.marge)}</b></td></tr>
        ${line('Port encaissé', 'shipFee', '+')}
        ${line('Frais paiement', 'fee', '-')}
        ${line('Frais d\'envoi réel', 'shipping', '-')}
        ${line('Stand, repas & déplacement', 'eventFee', '-')}
        ${line('Coût cartons', 'box', '-')}
        ${line('Cotisations URSSAF', 'cotis', '-')}
        ${va ? line('TVA (reversée)', 'tva', '-') : ''}
        ${line('Charges fixes matériel', 'fixed', '-')}
        ${line('Frais de livraison & frais généraux', 'charges', '-')}
      </tbody>
      <tfoot><tr><td><b>Bénéfice net</b></td><td class="num sensitive ${M.net >= 0 ? 'pos' : 'neg'}"><b>${U.eur(M.net)}</b></td><td class="num sensitive ${A.net >= 0 ? 'pos' : 'neg'}"><b>${U.eur(A.net)}</b></td></tr></tfoot>
    </table></div>
    <p class="muted help" style="margin-top:6px;font-size:.8rem;">« Charges fixes matériel » = entretien imprimante UV (→ accessoires) + amortissement du matériel réparti sur la période (tagué mastication/accessoires directement, « commun » au prorata du CA). ${va ? '' : 'TVA non déduite (non assujetti) — affichée pour info seulement si tu coches « assujetti ».'}</p>`;
  },

  renderSales() {
    const agg = this._salesAgg();
    const metric = this._metric();
    const mLabel = metric === 'ca' ? 'CA' : 'Quantité';
    const periodOpts = [{ v: 'all', l: 'Tout l’historique' }, { v: 'year', l: 'Cette année' }, { v: '12m', l: '12 derniers mois' }];
    const top = agg.products.slice().sort((a, b) => metric === 'ca' ? b.ca - a.ca : b.qty - a.qty).slice(0, 20);
    const topAcc = agg.products.filter(p => p.kind === 'A').sort((a, b) => metric === 'ca' ? b.ca - a.ca : b.qty - a.qty).slice(0, 15);
    const hasAcc = Object.keys(agg.accType || {}).length > 0;
    const prodOpts = [{ v: '', l: '— choisir un produit —' }].concat(agg.products.slice().sort((a, b) => U.sortFr(a.name, b.name)).map(p => ({ v: p.key, l: p.name })));
    const hasSales = agg.nSales > 0;
    const totCogs = agg.months.reduce((a, m) => a + m.cogs, 0);
    const totNet = agg.months.reduce((a, m) => a + m.net, 0);
    const totMarge = agg.ca - totCogs;
    const hasChannel = Object.keys(agg.byChannelCA || {}).length > 0;
    const hasCat = Object.keys(agg.byCatCA || {}).length > 0;
    const hasMeat = Object.keys(agg.byMeatCA || {}).length > 0;

    App.mount(`
      <div class="view-title"><h1>Statistiques</h1><span class="sub">${metric === 'ca' ? 'chiffre d\'affaires & rentabilité' : 'performance des ventes'}</span></div>
      ${this.tabBar()}
      <div class="card">
        <div class="frow" style="gap:16px;align-items:flex-end;flex-wrap:wrap;">
          <div class="fg" style="max-width:220px;margin:0;"><label>Période</label>${U.customSelect({ value: this.salesPeriod, options: periodOpts, onPick: 'Stats.setSalesPeriod' })}</div>
          ${metric === 'ca' ? '' : `<div class="fg" style="margin:0;flex:0 0 auto;"><label>Catégorie</label>${U.seg([['all', 'Tout'], ['mast', '🥩 Mastication'], ['acc', '🐕 Accessoires']].map(([k, l]) => ({ l, on: (this.salesKind || 'all') === k, js: `Stats.setSalesKind('${k}')` })), { wrap: true })}</div>`}
        </div>
        <p class="muted help" style="margin-top:8px;">Basé sur tes ventes enregistrées. ⚠️ Les ventes de marché <b>sans SKU</b> (non importées) n'apparaissent pas ici — le classement devient précis à mesure que tu remplis les SKU côté SumUp.</p>
      </div>
      ${!hasSales ? `<div class="card empty"><span class="big">🛒</span>Aucune vente ${metric === 'qty' && this.salesKind !== 'all' ? 'de cette catégorie ' : ''}sur cette période.</div>` : `
      <div class="grid c4">
        <div class="kpi"><div class="v">${agg.nSales}</div><div class="l">Ventes</div></div>
        ${metric === 'ca' ? `<div class="kpi sensitive"><div class="v">${U.eur(agg.ca)}</div><div class="l">Chiffre d'affaires</div></div>
        <div class="kpi sensitive"><div class="v">${U.eur(agg.nSales ? agg.ca / agg.nSales : 0)}</div><div class="l">Panier moyen</div></div>
        <div class="kpi good sensitive"><div class="v">${U.eur(totMarge)}</div><div class="l">Marge brute</div></div>
        <div class="kpi ${totNet >= 0 ? 'good' : 'bad'} sensitive"><div class="v">${U.eur(totNet)}</div><div class="l">Bénéfice net</div></div>`
        : `<div class="kpi"><div class="v">${U.qty(agg.articles)}</div><div class="l">Articles vendus</div></div>
        <div class="kpi"><div class="v">${(agg.nSales ? agg.articles / agg.nSales : 0).toFixed(1)}</div><div class="l">Articles / vente</div></div>
        <div class="kpi"><div class="v">${agg.products.length}</div><div class="l">Produits vendus</div></div>`}
      </div>

      <div class="grid ${hasChannel && metric === 'ca' ? 'c2' : ''} mt">
        <div class="card"><h2>🏆 Top produits (${mLabel})</h2>
          <div style="position:relative;height:230px;"><canvas id="salesTopChart"></canvas></div>
          <button class="btn-ghost btn-sm mt" onclick="Stats.toggleTop()">${this._topOpen ? 'Masquer le classement' : `Voir le classement complet (Top ${top.length})`}</button>
          ${this._topOpen ? `<div class="table-wrap mt"><table><thead><tr><th>#</th><th class="col-name">Produit</th><th class="num">Quantité</th><th class="num sensitive">CA</th><th class="num">Ventes</th></tr></thead>
          <tbody>${top.map((p, i) => `<tr><td>${i + 1}</td><td class="col-name"><b>${U.esc(p.name)}</b>${p.kind === 'A' ? ' <span class="badge info">accessoire</span>' : ''}${Object.keys(p.lots || {}).length ? `<div class="muted" style="font-size:.8rem;">${[p.singles ? `${U.qty(p.singles)} à l'unité` : ''].concat(Object.keys(p.lots).sort((a, b) => a - b).map(n => `${U.qty(p.lots[n])} lot${p.lots[n] > 1 ? 's' : ''} de ${n}`)).filter(Boolean).join(' · ')}</div>` : ''}</td><td class="num">${U.qty(p.qty)}</td><td class="num sensitive">${U.eur(p.ca)}</td><td class="num">${p.sales}</td></tr>`).join('')}</tbody></table></div>` : ''}
        </div>
        ${hasChannel && metric === 'ca' ? `<div class="card"><h2>🛍️ Répartition par canal (CA)</h2><div style="position:relative;height:230px;"><canvas id="salesChannelChart"></canvas></div></div>` : ''}
      </div>

      <div class="card mt"><h2>${metric === 'ca' ? '📈 Évolution — CA, coûts, marge & bénéfice' : '📊 Quantité vendue par mois'}</h2>
        <p class="muted help">${metric === 'ca' ? 'Une courbe par poste, mois par mois (chronologique, années distinctes) : clique un nom dans la légende pour masquer / afficher sa courbe. « Frais » = paiement, envoi, stand/repas/déplacement, entretien matériel, livraison & frais généraux (sans les cartons, qui ont leur courbe).' : 'Nombre d\'articles vendus mois par mois (chronologique, années distinctes).'}</p>
        <div style="position:relative;height:${metric === 'ca' ? 300 : 190}px;"><canvas id="salesTimelineChart"></canvas></div>
      </div>

      ${metric !== 'ca' ? '' : `<div class="card mt"><h2>🧾 Détail par mois — frais, marge & bénéfice</h2>
        <p class="muted help">Le même détail en chiffres, avec la même compta que le Tableau de bord.</p>
        ${(() => {
          const va = Store.state.settings.vatActive;
          const uvM = Pricing.fixedOverheadMonthly(); // entretien UV + amortissement matériel / mois (0 si non renseigné)
          const T = agg.months.reduce((a, m) => ({ ch: a.ch + m.charges, n: a.n + m.nSales, ca: a.ca + m.ca, cogs: a.cogs + m.cogs, shipFee: a.shipFee + m.shipFee, fee: a.fee + m.fee, shipping: a.shipping + m.shipping, box: a.box + m.boxCost, ev: a.ev + m.eventFee, uv: a.uv + m.uvMaint, cotis: a.cotis + m.cotis, tva: a.tva + m.tva, net: a.net + m.net }), { ch: 0, n: 0, ca: 0, cogs: 0, shipFee: 0, fee: 0, shipping: 0, box: 0, ev: 0, uv: 0, cotis: 0, tva: 0, net: 0 });
          T.marge = T.ca - T.cogs;
          const cell = (v, cls) => `<td class="num sensitive ${cls || ''}">${v ? (cls === 'neg' ? '− ' : cls === 'pos' ? '+ ' : '') + U.eur(v) : '—'}</td>`;
          const margeCell = (v) => `<td class="num sensitive ${v >= 0 ? 'pos' : 'neg'}">${U.eur(v)}</td>`;
          // TVA : reversée (déduite, rouge) si assujetti ; sinon conservée (dans le bénéfice, affichée en info).
          // Assujetti → TVA reversée (rouge, déduite) ; non assujetti → conservée (vert, dans le bénéfice).
          const tvaCell = (v) => va ? `<td class="num sensitive neg" title="TVA reversée — déduite du bénéfice (assujetti)">${v ? '− ' + U.eur(v) : '—'}</td>` : `<td class="num sensitive pos" title="TVA contenue dans le CA — conservée dans ton bénéfice (non assujetti)">${v ? U.eur(v) : '—'}</td>`;
          const chCell = (v) => `<td class="num sensitive neg" title="Frais de livraison sur achats + frais généraux (mêmes que la Compta)">${v ? '− ' + U.eur(v) : '—'}</td>`;
          const uvCell = (v) => uvM ? `<td class="num sensitive neg" title="Entretien imprimante UV + amortissement de tout le matériel (imprimante, extracteur, scelleuse…) réparti par mois">− ${U.eur(v)}</td>` : '';
          const row = (label, m) => `<tr><td class="col-name"><b>${label}</b></td><td class="num">${m.nSales}</td><td class="num sensitive">${U.eur(m.ca)}</td>${cell(m.cogs, 'neg')}${margeCell(m.marge)}${cell(m.shipFee, 'pos')}${cell(m.fee, 'neg')}${cell(m.shipping, 'neg')}${cell(m.eventFee, 'neg')}${cell(m.boxCost, 'neg')}${uvCell(m.uvMaint)}${chCell(m.charges)}<td class="num sensitive neg">− ${U.eur(m.cotis)}</td>${tvaCell(m.tva)}<td class="num sensitive ${m.net >= 0 ? 'pos' : 'neg'}"><b>${U.eur(m.net)}</b></td></tr>`;
          return U.fold('months', agg.months.length, `<div class="table-wrap mt"><table>
            <thead><tr><th class="col-name">Mois</th><th class="num">Ventes</th><th class="num">CA</th><th class="num">Coût revient</th><th class="num">Marge brute</th><th class="num">Port encaissé</th><th class="num">Frais paiement</th><th class="num">Frais d'envoi</th><th class="num">Stand, repas & déplac.</th><th class="num">Coût cartons</th>${uvM ? '<th class="num">Entretien matériel</th>' : ''}<th class="num" title="Frais de livraison facturés par tes fournisseurs (factures Achats) + outillage, frais généraux et investissements non amortis : comme en Compta">Livraison &amp; frais généraux</th><th class="num">Cotisations URSSAF</th><th class="num">TVA ${va ? '(reversée)' : '(conservée)'}</th><th class="num">Bénéfice net</th></tr></thead>
            <tbody>${agg.months.slice().reverse().map(m => row(this._monthKeyLabel(m.key), m)).join('') || `<tr><td colspan="${uvM ? 15 : 14}" class="muted">Aucune vente.</td></tr>`}</tbody>
            <tfoot><tr><td class="col-name"><b>Total</b></td><td class="num">${T.n}</td><td class="num sensitive">${U.eur(T.ca)}</td>${cell(T.cogs, 'neg')}${margeCell(T.marge)}${cell(T.shipFee, 'pos')}${cell(T.fee, 'neg')}${cell(T.shipping, 'neg')}${cell(T.ev, 'neg')}${cell(T.box, 'neg')}${uvCell(T.uv)}${chCell(T.ch)}<td class="num sensitive neg">− ${U.eur(T.cotis)}</td>${tvaCell(T.tva)}<td class="num sensitive ${T.net >= 0 ? 'pos' : 'neg'}"><b>${U.eur(T.net)}</b></td></tr></tfoot>
          </table></div>`, { h: 440, unit: 'mois' }) + `
          <p class="muted help" style="margin-top:6px;font-size:.8rem;">« Marge brute » = CA − coût de revient des produits vendus. « Bénéfice net » = marge brute + port encaissé − frais paiement − frais d'envoi − frais stand/repas/déplacement − coût cartons − entretien/amortissement matériel − frais de livraison sur achats & frais généraux (outillage…) − cotisations URSSAF${va ? ' − TVA reversée' : ''}. ${va ? 'TVA <b>reversée</b> (assujetti) : déduite du bénéfice.' : 'TVA <b>conservée</b> dans ton bénéfice (non assujetti) — la colonne TVA montre le montant contenu dans le CA ; elle sera déduite automatiquement le jour où tu coches « assujetti à la TVA » dans Paramètres → Réglages financiers.'} Coût de revient <b>exact</b> pour les ventes récentes (figé à la vente), <b>estimé</b> au coût actuel pour les ventes antérieures.</p>`;
        })()}
      </div>

      <div class="card mt"><h2>📊 Rentabilité par activité</h2>
        <p class="muted help">Mastication (achat-revente) vs accessoires (fait main), sur la période choisie. Chaque article compte dans son activité ; les frais et charges fixes communs sont répartis au prorata du CA (l'entretien/amortissement UV va aux accessoires). La somme des deux = le bénéfice net global.</p>
        ${this._activityTable(Pricing.activityPnL(agg.sales, Math.max(1, agg.months.length), agg.charges))}
      </div>`}

      <div class="card mt"><h2>📅 Saisonnalité — ${mLabel} par mois</h2>
        <p class="muted help">Toutes années confondues sur la période : à quelle période de l'année ça se vend le plus.</p>
        <div style="position:relative;height:200px;"><canvas id="salesMonthChart"></canvas></div>
        <div class="frow mt" style="align-items:flex-end;gap:12px;flex-wrap:wrap;">
          <div class="fg" style="max-width:340px;margin:0;"><label>Saisonnalité d'un produit précis</label>${U.customSelect({ value: this.seasonProduct, options: prodOpts, onPick: 'Stats.setSeasonProduct' })}</div>
        </div>
        ${this.seasonProduct ? '<div style="position:relative;height:190px;margin-top:10px;"><canvas id="salesSeasonChart"></canvas></div>' : ''}
      </div>

      ${metric === 'ca' && (hasCat || hasMeat) ? `<div class="grid ${hasCat && hasMeat ? 'c2' : ''} mt">
        ${hasCat ? '<div class="card"><h2>🐕 CA par catégorie</h2><div style="position:relative;height:200px;"><canvas id="salesCatChart"></canvas></div></div>' : ''}
        ${hasMeat ? '<div class="card"><h2>🍖 CA par type de viande</h2><div style="position:relative;height:200px;"><canvas id="salesMeatChart"></canvas></div></div>' : ''}
      </div>` : ''}

      ${hasAcc && !(metric === 'qty' && this.salesKind === 'mast') ? `<div class="card mt"><h2>🦮 Accessoires — performance</h2>
        <p class="muted help">Répartition de tes ventes d'accessoires par type et par largeur (${mLabel}). ℹ️ La couleur n'est pas encore suivie par vente (un seul SKU par modèle) — on pourra l'ajouter plus tard si tu veux le détail par couleur.</p>
        <div class="grid c2">
          <div><h3 style="font-size:.9rem;">Par type</h3><div style="position:relative;height:200px;"><canvas id="salesAccTypeChart"></canvas></div></div>
          <div><h3 style="font-size:.9rem;">Par largeur</h3><div style="position:relative;height:200px;"><canvas id="salesAccWidthChart"></canvas></div></div>
        </div>
        ${U.fold('accperf', topAcc.length, `<div class="table-wrap mt"><table><thead><tr><th>#</th><th class="col-name">Accessoire</th><th class="num">Quantité</th><th class="num sensitive">CA</th><th class="num">Ventes</th></tr></thead>
        <tbody>${topAcc.map((p, i) => `<tr><td>${i + 1}</td><td class="col-name"><b>${U.esc(p.name)}</b></td><td class="num">${U.qty(p.qty)}</td><td class="num sensitive">${U.eur(p.ca)}</td><td class="num">${p.sales}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucune vente d\'accessoire.</td></tr>'}</tbody></table></div>`)}
      </div>` : ''}

      ${metric === 'ca' ? '' : `<div class="card mt"><h2>💤 Produits dormants <span class="muted">(${agg.dormant.length})</span></h2>
        <p class="muted help">Produits du catalogue jamais vendus sur cette période — candidats au déstockage / à ne pas racheter.</p>
        ${agg.dormant.length ? `<button class="btn-ghost btn-sm" onclick="Stats.toggleDormant()">${this._dormantOpen ? 'Masquer' : 'Afficher la liste'}</button>
        ${this._dormantOpen ? `<div class="table-wrap mt"><table><thead><tr><th class="col-name">Produit</th><th>Catégorie</th><th>Dernière vente</th></tr></thead>
          <tbody>${agg.dormant.map(d => `<tr><td class="col-name">${U.esc(d.name)}</td><td>${U.esc(d.cat)}</td><td>${d.last ? U.frDate(new Date(d.last).toISOString().slice(0, 10)) : '<span class="muted">jamais</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}` : '<p class="muted">Aucun — tous tes produits se sont vendus au moins une fois. 🎉</p>'}
      </div>`}
      `}`);

    if (hasSales) this.drawSalesCharts(agg);
  },

  drawSalesCharts(agg) {
    if (typeof Chart === 'undefined') return;
    const dark = Theme.get() === 'dark';
    const textColor = dark ? '#eee3d3' : '#1c2b33';
    const borderColor = dark ? '#1c3844' : '#ffffff';
    const palette = U.CHART_COLORS;
    Object.values(this._charts).forEach(c => c?.destroy());
    this._charts = {};
    const metric = this._metric();
    const mLabel = metric === 'ca' ? 'CA' : 'Quantité';
    const fmtV = (v) => metric === 'ca' ? U.eur(v) : U.qty(v);

    // Top produits — barres horizontales
    const top = agg.products.slice().sort((a, b) => metric === 'ca' ? b.ca - a.ca : b.qty - a.qty).slice(0, 12);
    const topC = document.getElementById('salesTopChart');
    if (topC && top.length) this._charts.top = new Chart(topC, {
      type: 'bar',
      data: { labels: top.map(p => p.name), datasets: [{ data: top.map(p => metric === 'ca' ? p.ca : p.qty), backgroundColor: '#a67153', borderRadius: 5 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtV(c.parsed.x) } } }, scales: { x: { beginAtZero: true, ticks: { color: textColor } }, y: { ticks: { color: textColor, font: { size: 10 } } } } }
    });

    const buildPie = (id, counts, fmt) => {
      const canvas = document.getElementById(id); if (!canvas) return;
      const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      if (!labels.length) return;
      this._charts[id] = new Chart(canvas, {
        type: 'doughnut',
        plugins: [U.donutCenter(textColor, fmt || U.eur, fmt ? mLabel : 'CA')],
        data: { labels, datasets: [{ data: U.donutShown(labels.map(l => counts[l])), real: labels.map(l => counts[l]), backgroundColor: labels.map((_, i) => palette[i % palette.length]), borderColor, borderWidth: 3, borderRadius: 7, hoverOffset: 6 }] },
        options: { maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { color: textColor, usePointStyle: true, pointStyle: 'circle', boxWidth: 9, boxHeight: 9, padding: 12, font: { family: 'Quicksand', size: 11 } } }, tooltip: { callbacks: { label: (c) => ` ${c.label} : ${(fmt || U.eur)(c.dataset.real[c.dataIndex])}` } } } }
      });
    };
    buildPie('salesChannelChart', agg.byChannelCA);
    buildPie('salesCatChart', agg.byCatCA);
    buildPie('salesMeatChart', agg.byMeatCA);
    // Accessoires : par type + par largeur, selon la métrique choisie (qté / CA)
    const accTypeCounts = {}, accWidthCounts = {};
    Object.entries(agg.accType || {}).forEach(([k, v]) => accTypeCounts[k] = metric === 'ca' ? v.ca : v.qty);
    Object.entries(agg.accWidth || {}).forEach(([k, v]) => accWidthCounts[k] = metric === 'ca' ? v.ca : v.qty);
    buildPie('salesAccTypeChart', accTypeCounts, fmtV);
    buildPie('salesAccWidthChart', accWidthCounts, fmtV);

    // Évolution chronologique mois par mois (vrais mois, années distinctes)
    const tl = agg.months || [];
    const tlC = document.getElementById('salesTimelineChart');
    if (tlC && tl.length && metric === 'ca') {   // CA : courbes € (une par poste) ; Quantité : barres du nombre d'articles
      const line = (label, color, f, o = {}) => ({ label, data: tl.map(f), borderColor: color, backgroundColor: color, pointBackgroundColor: color, borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 6, tension: .3, ...o });
      const C = U.CHART_COLORS;
      this._charts.timeline = new Chart(tlC, {
        type: 'line',
        data: { labels: tl.map(m => this._monthKeyLabel(m.key)), datasets: [
          line('CA', C[4], m => m.ca), line('Coût de revient', C[2], m => m.cogs), line('Marge brute', C[1], m => m.marge),
          line('Frais', C[3], m => m.fee + m.shipping + m.eventFee + m.uvMaint + m.charges), line('Coût cartons', C[5], m => m.boxCost),
          line('Cotisations URSSAF', C[7], m => m.cotis, { hidden: true }), line('Bénéfice net', C[0], m => m.net, { borderWidth: 4, pointRadius: 4 })
        ] },
        options: {
          maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom', labels: { color: textColor, usePointStyle: true, pointStyle: 'circle', boxWidth: 9, boxHeight: 9, padding: 14, font: { family: 'Quicksand', size: 11 } } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} : ${U.eur(c.parsed.y)}` } } },
          scales: { y: { ticks: { color: textColor, callback: v => v + ' €' } }, x: { ticks: { color: textColor, maxRotation: 60, font: { size: 10 } } } }
        }
      });
    } else if (tlC && tl.length) this._charts.timeline = new Chart(tlC, {
      type: 'bar',
      data: { labels: tl.map(m => this._monthKeyLabel(m.key)), datasets: [{ label: mLabel, data: tl.map(m => metric === 'ca' ? m.ca : m.articles), backgroundColor: '#5c6a78', borderRadius: 5 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtV(c.parsed.y) } } }, scales: { y: { beginAtZero: true, ticks: { color: textColor } }, x: { ticks: { color: textColor, maxRotation: 60, font: { size: 10 } } } } }
    });

    // Saisonnalité mensuelle
    const monthData = metric === 'ca' ? agg.byMonthCA : agg.byMonthQty;
    const monthC = document.getElementById('salesMonthChart');
    if (monthC) this._charts.month = new Chart(monthC, {
      type: 'bar',
      data: { labels: this._monthLabels, datasets: [{ label: mLabel, data: monthData, backgroundColor: '#4a7c59', borderRadius: 5 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtV(c.parsed.y) } } }, scales: { y: { beginAtZero: true, ticks: { color: textColor } }, x: { ticks: { color: textColor } } } }
    });

    // Saisonnalité d'un produit précis
    if (this.seasonProduct) {
      const g = agg.products.find(p => p.key === this.seasonProduct);
      const seasonC = document.getElementById('salesSeasonChart');
      if (g && seasonC) this._charts.season = new Chart(seasonC, {
        type: 'bar',
        data: { labels: this._monthLabels, datasets: [{ label: g.name, data: g.month, backgroundColor: '#b97a24', borderRadius: 5 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { labels: { color: textColor, usePointStyle: true, pointStyle: 'circle', boxWidth: 9, boxHeight: 9, padding: 12, font: { family: 'Quicksand', size: 11 } } }, tooltip: { callbacks: { label: (c) => ' ' + fmtV(c.parsed.y) } } }, scales: { y: { beginAtZero: true, ticks: { color: textColor } }, x: { ticks: { color: textColor } } } }
      });
    }
  }
};
