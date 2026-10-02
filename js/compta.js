/* ═══════════ Comptabilité (2026-10-02) — entrées / sorties, trésorerie et résultat ═══════════
   Deux lectures SÉPARÉES (demandé par Antho), sans compter deux fois les mêmes achats :
   1. TRÉSORERIE = l'argent réel, par mois : entrées (ventes encaissées + port encaissé) − sorties (achats payés, frais de paiement,
      envois, stands / déplacements / repas, cotisations estimées). Une machine achetée pèse en une fois le mois où elle est payée.
      Achat payé avec la carte perso : compté quand tu te rembourses (sinon « à me rembourser »).
   2. RÉSULTAT = ce que tu as gagné : marge brute (ventes − coût des marchandises vendues) + port encaissé − frais de vente − cotisations
      − dépenses du mois (outillage, frais généraux, investissement sans durée d'amortissement) − amortissements et entretien.
      Les achats de mastication / matières / consommables n'y entrent PAS directement : ils passent par le coût des marchandises vendues.
   Réutilise Pricing.saleProfit (mêmes formules que le Tableau de bord et les Statistiques ; cotisations selon la nature des articles).
   Réservé à l'admin. */
const Compta = {
  f: { period: 'year' },
  PERIODS: [['year', 'Cette année'], ['lastyear', 'Année dernière'], ['12m', '12 derniers mois'], ['all', 'Depuis le début']],
  CATS: ['mastication', 'matiere', 'conso', 'equipement', 'outillage', 'frais'],
  setPeriod(v) { this.f.period = v; this.render(); },
  mk(ts) { return new Date(ts).toISOString().slice(0, 7); },
  monthLabel(k) { const [y, m] = k.split('-'); return ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][+m - 1] + ' ' + y; },
  _months() {
    const now = new Date(), cur = now.getFullYear() * 12 + now.getMonth(), key = i => Math.floor(i / 12) + '-' + String(i % 12 + 1).padStart(2, '0');
    let a = cur - now.getMonth(), b = cur;   // cette année
    if (this.f.period === 'lastyear') { a -= 12; b = a + 11; }
    else if (this.f.period === '12m') { a = cur - 11; }
    else if (this.f.period === 'all') {
      const ds = [].concat((Store.state.sales || []).filter(s => !s.cancelled).map(s => this.mk(s.ts)), (Achats.list() || []).map(p => String(p.date).slice(0, 7))).filter(x => /^\d{4}-\d{2}$/.test(x)).sort();
      if (ds.length) { const [y, m] = ds[0].split('-'); a = +y * 12 + (+m - 1); }
    }
    const out = []; for (let i = a; i <= b; i++) out.push(key(i));
    // on n'affiche pas les mois d'avant ta première vente / ton premier achat (lignes vides)
    const data = [].concat((Store.state.sales || []).filter(s => !s.cancelled).map(s => this.mk(s.ts)), Achats.list().map(p => String(p.date).slice(0, 7))).filter(x => /^\d{4}-\d{2}$/.test(x)).sort();
    const trimmed = data.length ? out.filter(k => k >= data[0]) : out;
    return trimmed.length ? trimmed : out.slice(-1);
  },
  /* amortissement du mois (Achats → liste d'amortissement des Paramètres) : mois exact si l'achat vient d'une facture, sinon année d'achat */
  _amortFor(k) {
    const [y, m] = k.split('-').map(Number), idx = y * 12 + m - 1; let t = 0;
    Pricing.equipItems().forEach(e => {
      const yrs = U.num(e.years); if (yrs <= 0) return;
      const monthly = U.num(e.price) / yrs / 12;
      if (e.buyDate) { const [by, bm] = String(e.buyDate).split('-').map(Number), s = by * 12 + bm - 1; if (idx >= s && idx < s + yrs * 12) t += monthly; }
      else { const by = U.num(e.buyYear); if (!by || (y >= by && y < by + yrs)) t += monthly; }
    });
    return t;
  },
  data() {
    const months = this._months(), M = {}, inSet = new Set(months);
    months.forEach(k => { M[k] = { inc: 0, incBy: {}, ca: 0, cogs: 0, shipFee: 0, fee: 0, shipping: 0, box: 0, eventFee: 0, cotis: 0, tva: 0, buy: {}, buyPaid: 0, expensed: 0, amort: this._amortFor(k), uv: Pricing.uvMaintenanceMonthly(), n: 0 }; });
    (Store.state.sales || []).forEach(s => {
      if (s.cancelled) return; const k = this.mk(s.ts); if (!inSet.has(k)) return;
      const sp = Pricing.saleProfit(s), m = M[k], cash = sp.ca + sp.shipFee;
      m.n++; m.inc += cash; const pk = s.payment || 'autre'; m.incBy[pk] = (m.incBy[pk] || 0) + cash;
      m.ca += sp.ca; m.cogs += sp.cogs; m.shipFee += sp.shipFee; m.fee += sp.fee; m.shipping += sp.shipping; m.box += sp.box; m.eventFee += sp.eventFee; m.cotis += sp.cotis; m.tva += sp.tva;
    });
    let toRefund = 0;
    Achats.list().forEach(p => {
      const k = String(p.date).slice(0, 7), ttc = Achats.lineTTC(p), total = Achats.grandTotal(p);
      if (p.paidBy === 'perso' && !p.reimbursed) toRefund += total;
      // répartition par catégorie + dépenses du mois (résultat) à la date de la facture
      if (inSet.has(k)) (p.lines || []).forEach((l, i) => {
        M[k].buy[l.cat] = (M[k].buy[l.cat] || 0) + ttc[i];
        if (l.cat === 'outillage' || l.cat === 'frais' || (l.cat === 'equipement' && !(U.num(l.years) > 0))) M[k].expensed += ttc[i];
      });
      // trésorerie : à la date du paiement (carte perso → date du remboursement)
      const pk = p.paidBy === 'perso' ? (p.reimbursed ? String(p.reimbursed).slice(0, 7) : '') : k;
      if (pk && inSet.has(pk)) M[pk].buyPaid += total;
    });
    months.forEach(k => {
      const m = M[k];
      m.out = m.buyPaid + m.fee + m.shipping + m.eventFee + m.cotis;
      m.solde = m.inc - m.out;
      m.marge = m.ca - m.cogs;
      m.sellCosts = m.fee + m.shipping + m.box + m.eventFee - m.shipFee;   // frais de vente nets du port encaissé
      m.fixed = m.amort + m.uv;
      m.net = m.marge - m.sellCosts - m.cotis - m.expensed - m.fixed - (Store.state.settings.vatActive ? m.tva : 0);
    });
    const T = { inc: 0, ca: 0, cogs: 0, marge: 0, shipFee: 0, fee: 0, shipping: 0, box: 0, eventFee: 0, cotis: 0, tva: 0, buyPaid: 0, out: 0, solde: 0, expensed: 0, amort: 0, uv: 0, fixed: 0, sellCosts: 0, net: 0, buy: {}, incBy: {}, n: 0 };
    months.forEach(k => { const m = M[k]; Object.keys(T).forEach(x => { if (typeof T[x] === 'number') T[x] += U.num(m[x]); }); Object.entries(m.buy).forEach(([c, v]) => T.buy[c] = (T.buy[c] || 0) + v); Object.entries(m.incBy).forEach(([c, v]) => T.incBy[c] = (T.incBy[c] || 0) + v); });
    return { months, M, T, toRefund };
  },

  render() {
    if (App.isViewer || App.isTeam) { App.mount('<div class="empty"><span class="big">🔒</span>Page réservée à l\'administrateur.</div>'); return; }
    U.syncFilters('compta', this.f);
    if (typeof Achats !== 'undefined') Achats.reconcileEquip();
    const { months, M, T, toRefund } = this.data(), S = Store.state.settings;
    const e = v => `<span class="sensitive">${U.eur(v)}</span>`, sg = v => `<span class="sensitive ${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${U.eur(v)}</span>`;
    const catLabel = c => { const x = Achats.cat(c); return x.ico + ' ' + x.label; };
    const payLabel = { sumup: '💳 SumUp', stripe: '🌐 En ligne (Stripe)', virement: '🏦 Virement', cash: '💵 Espèces', autre: 'Non précisé' };
    let cum = 0;
    const trRows = months.map(k => { const m = M[k]; cum += m.solde; return `<tr><td style="white-space:nowrap;"><b>${this.monthLabel(k)}</b></td><td class="num">${e(m.inc)}</td><td class="num">${e(m.buyPaid)}</td><td class="num">${e(m.fee)}</td><td class="num">${e(m.shipping)}</td><td class="num">${e(m.eventFee)}</td><td class="num">${e(m.cotis)}</td><td class="num">${e(m.out)}</td><td class="num"><b>${sg(m.solde)}</b></td><td class="num">${sg(cum)}</td></tr>`; }).join('');
    const reRows = months.map(k => { const m = M[k]; return `<tr><td style="white-space:nowrap;"><b>${this.monthLabel(k)}</b></td><td class="num">${e(m.ca)}</td><td class="num">${e(m.cogs)}</td><td class="num">${e(m.marge)}</td><td class="num">${e(m.sellCosts)}</td><td class="num">${e(m.cotis)}</td><td class="num">${e(m.expensed)}</td><td class="num">${e(m.fixed)}</td>${S.vatActive ? `<td class="num">${e(m.tva)}</td>` : ''}<td class="num"><b>${sg(m.net)}</b></td></tr>`; }).join('');
    const stockBuy = (T.buy.mastication || 0) + (T.buy.matiere || 0) + (T.buy.conso || 0);
    const line = (label, v, cls, help) => `<tr${cls ? ` class="${cls}"` : ''}><td style="text-align:left;">${label}${help ? ` <span class="muted" style="font-size:.78rem;">${help}</span>` : ''}</td><td class="num">${v}</td></tr>`;
    App.mount(`
      <div class="view-title"><h1>Comptabilité</h1><span class="sub">entrées, sorties, trésorerie et résultat</span></div>
      <div class="card"><div class="frow" style="align-items:center;gap:10px;"><div class="fg" style="max-width:240px;"><label>Période</label><select onchange="Compta.setPeriod(this.value)">${this.PERIODS.map(p => `<option value="${p[0]}" ${this.f.period === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select></div>
        <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Compta.exportAchats()">⬇ Registre des achats (CSV)</button>
        <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Compta.exportRecettes()">⬇ Livre des recettes (CSV)</button></div>
        <p class="muted help" style="font-size:.82rem;margin-top:8px;">Les cotisations URSSAF sont estimées avec tes taux des Paramètres (marchandises / fait main). Ce n'est pas une déclaration officielle : un indicateur de gestion. Les ventes importées de l'ancien historique ont des prix estimés.</p></div>
      <div class="grid c4" style="margin-bottom:16px;">
        <div class="kpi good sensitive"><div class="v">${U.eur(T.inc)}</div><div class="l">Entrées (encaissé)</div></div>
        <div class="kpi bad sensitive"><div class="v">${U.eur(T.out)}</div><div class="l">Sorties (payé)</div></div>
        <div class="kpi ${T.solde < 0 ? 'bad' : 'good'} sensitive"><div class="v">${U.eur(T.solde)}</div><div class="l">Solde de trésorerie</div></div>
        <div class="kpi ${T.net < 0 ? 'bad' : ''} sensitive"><div class="v">${U.eur(T.net)}</div><div class="l">Résultat (bénéfice net)</div></div>
      </div>

      <div class="card"><h2>💰 Trésorerie <span class="muted" style="font-size:.85rem;font-weight:400;">— l'argent réellement entré et sorti</span></h2>
        <div class="table-wrap"><table><thead><tr><th>Mois</th><th class="num">Entrées</th><th class="num">Achats payés</th><th class="num">Frais de paiement</th><th class="num">Envois</th><th class="num">Stands / dépl.</th><th class="num">Cotisations</th><th class="num">Total sorties</th><th class="num">Solde du mois</th><th class="num">Solde cumulé</th></tr></thead><tbody>${trRows}
          <tr style="border-top:2px solid var(--caramel);font-weight:700;"><td>Total</td><td class="num">${e(T.inc)}</td><td class="num">${e(T.buyPaid)}</td><td class="num">${e(T.fee)}</td><td class="num">${e(T.shipping)}</td><td class="num">${e(T.eventFee)}</td><td class="num">${e(T.cotis)}</td><td class="num">${e(T.out)}</td><td class="num">${sg(T.solde)}</td><td class="num"></td></tr></tbody></table></div>
        <div class="grid c2 mt">
          <div><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:4px;">Entrées par moyen de paiement</div><table class="pack-tbl"><tbody>${Object.entries(T.incBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td style="text-align:left;">${payLabel[k] || k}</td><td class="num">${e(v)}</td></tr>`).join('') || '<tr><td class="muted">Aucune vente sur la période.</td></tr>'}</tbody></table></div>
          <div><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:4px;">Achats par catégorie (TTC, livraison et TVA comprises)</div><table class="pack-tbl"><tbody>${this.CATS.map(c => T.buy[c] ? `<tr><td style="text-align:left;">${catLabel(c)}</td><td class="num">${e(T.buy[c])}</td></tr>` : '').join('') || '<tr><td class="muted">Aucun achat sur la période.</td></tr>'}</tbody></table></div>
        </div>
        ${toRefund > 0 ? `<p class="warn-txt" style="margin-top:10px;">💳 ${U.eur(toRefund)} payés avec ta carte perso restent à te rembourser : ils ne sont comptés dans la trésorerie qu'à la date de remboursement.</p>` : ''}
      </div>

      <div class="card"><h2>📈 Résultat <span class="muted" style="font-size:.85rem;font-weight:400;">— ce que tu as réellement gagné</span></h2>
        <div class="table-wrap"><table><thead><tr><th>Mois</th><th class="num">Ventes (CA)</th><th class="num">Coût marchandises vendues</th><th class="num">Marge brute</th><th class="num">Frais de vente (net du port)</th><th class="num">Cotisations</th><th class="num">Dépenses du mois</th><th class="num">Amort. &amp; entretien</th>${S.vatActive ? '<th class="num">TVA reversée</th>' : ''}<th class="num">Bénéfice net</th></tr></thead><tbody>${reRows}
          <tr style="border-top:2px solid var(--caramel);font-weight:700;"><td>Total</td><td class="num">${e(T.ca)}</td><td class="num">${e(T.cogs)}</td><td class="num">${e(T.marge)}</td><td class="num">${e(T.sellCosts)}</td><td class="num">${e(T.cotis)}</td><td class="num">${e(T.expensed)}</td><td class="num">${e(T.fixed)}</td>${S.vatActive ? `<td class="num">${e(T.tva)}</td>` : ''}<td class="num">${sg(T.net)}</td></tr></tbody></table></div>
        <div class="mt" style="max-width:560px;"><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:4px;">Détail de la période</div><table class="pack-tbl"><tbody>
          ${line('Ventes (CA)', e(T.ca))}${line('− Coût des marchandises vendues', e(T.cogs), '', 'coût réel figé à la vente')}${line('<b>= Marge brute</b>', e(T.marge))}
          ${line('+ Port encaissé', e(T.shipFee))}${line('− Frais de paiement (SumUp / Stripe)', e(T.fee))}${line('− Envois (transporteur, TTC)', e(T.shipping))}${line('− Consommables utilisés (cartons…)', e(T.box))}${line('− Stands, déplacements, repas', e(T.eventFee))}
          ${line('− Cotisations URSSAF (estimées)', e(T.cotis))}${line('− Outillage, frais généraux, investissements non amortis', e(T.expensed))}${line('− Amortissements du matériel', e(T.amort))}${line('− Entretien imprimante UV', e(T.uv))}${S.vatActive ? line('− TVA reversée', e(T.tva)) : ''}
          <tr style="border-top:2px solid var(--caramel);font-weight:800;"><td style="text-align:left;">= Bénéfice net</td><td class="num">${sg(T.net)}</td></tr></tbody></table>
          ${stockBuy > 0 ? `<p class="muted" style="font-size:.82rem;margin-top:8px;">ℹ️ ${U.eur(stockBuy)} d'achats de mastication, matières et consommables sur la période ne sont pas dans cette liste : ils passent par le « coût des marchandises vendues » au fur et à mesure des ventes (ce qui n'est pas encore vendu reste en stock).</p>` : ''}
        </div>
      </div>`);
  },

  /* ---------- exports ---------- */
  _periodPurchases() { const ks = new Set(this._months()); return Achats.list().filter(p => ks.has(String(p.date).slice(0, 7))); },
  exportAchats() { Achats.exportCsv(this._periodPurchases()); },
  exportRecettes() {
    const ks = new Set(this._months()), rows = (Store.state.sales || []).filter(s => !s.cancelled && ks.has(this.mk(s.ts))).sort((a, b) => a.ts - b.ts);
    if (!rows.length) { U.toast('Aucune vente sur cette période.', true); return; }
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', n = v => String(Math.round(U.num(v) * 100) / 100).replace('.', ',');
    const pay = { sumup: 'SumUp', stripe: 'Stripe', virement: 'Virement', cash: 'Especes' };
    const out = ['Date;Client;Moyen_de_paiement;Montant_marchandises;Port_encaisse;Total_encaisse'];
    rows.forEach(s => { const sp = Pricing.saleProfit(s); out.push([q(new Date(s.ts).toISOString().slice(0, 10)), q(s.customerName || ''), q(pay[s.payment] || ''), n(sp.ca), n(sp.shipFee), n(sp.ca + sp.shipFee)].join(';')); });
    const blob = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'recettes-' + U.today() + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
};
