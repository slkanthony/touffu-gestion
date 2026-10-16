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

  /* ---------- Seuils & déclarations URSSAF (indicatif — à confirmer sur autoentrepreneur.urssaf.fr / avec un comptable) ---------- */
  THRESH: { vente: 85000, venteMaj: 93500, services: 37500, servicesMaj: 41250, year: 2026 },   // franchise en base de TVA 2026
  _split(s) {   // CA encaissé d'une vente : marchandises (+ port encaissé) / fait main
    let m = 0, a = 0;
    (s.items || []).forEach(i => { const v = U.num(i.price) * U.num(i.qty); if (i.kind === 'A') a += v; else if (i.kind !== 'C') m += v; });
    const k = Pricing.urssafK();   // assujetti : le CA déclaré à l'URSSAF est HT
    return { m: (m + U.num(s.shippingFeeCollected)) * k, a: a * k };
  },
  _sum(from, to) {
    const S = Store.state.settings; let m = 0, a = 0, cash = 0, card = 0;
    (Store.state.sales || []).forEach(s => { if (s.cancelled || s.ts < from || s.ts >= to) return; const x = this._split(s); m += x.m; a += x.a; if (s.payment === 'cash') cash += x.m + x.a; else card += x.m + x.a; });
    const cot = m * U.num(S.socialTaxRate) / 100 + a * (U.num(S.socialTaxRateHandmade) || U.num(S.socialTaxRate)) / 100;
    return { m, a, cot, cash, card };
  },
  _urssafPeriods() {
    const f = Store.state.settings.urssafFreq === 'month' ? 'month' : 'quarter', now = new Date(), y = now.getFullYear(), mo = now.getMonth(), n = f === 'month' ? 1 : 3;
    const done = Store.state.meta.urssafDone || {}, out = [];
    const first = [].concat((Store.state.sales || []).filter(x => !x.cancelled).map(x => x.ts), Achats.list().map(p => new Date(p.date).getTime())).filter(x => x > 0).sort((p, q) => p - q)[0] || Date.now();
    let m0 = f === 'month' ? mo : Math.floor(mo / 3) * 3, y0 = y;
    for (let i = 0; i < 16; i++) {
      const from = new Date(y0, m0, 1), to = new Date(y0, m0 + n, 1);
      if (i > 0 && to.getTime() <= first) break;   // période d'avant ta première activité
      const key = (f === 'month' ? 'm' : 'q') + from.toISOString().slice(0, 7), deadline = new Date(y0, m0 + n + 1, 0);
      const lastM = y0 + '-' + String(m0 + n).padStart(2, '0'), firstM = y0 + '-' + String(m0 + 1).padStart(2, '0');
      const label = f === 'month' ? this.monthLabel(firstM) : 'T' + (m0 / 3 + 1) + ' ' + y0 + ' (' + this.monthLabel(firstM) + ' à ' + this.monthLabel(lastM) + ')';
      out.push({ from, to, deadline, key, label, current: i === 0, doneOn: done[key] || '', late: !done[key] && deadline.getTime() < Date.now() && i > 0, ...this._sum(from.getTime(), to.getTime()) });
      m0 -= n; if (m0 < 0) { m0 += 12; y0--; }
    }
    return out;
  },
  /* Statut d'une déclaration (clic sur le badge) : à déclarer / en cours ⇄ déclaré (date du jour) */
  setDeclared(key) {
    const m = Store.state.meta; m.urssafDone = m.urssafDone || {};
    if (m.urssafDone[key]) delete m.urssafDone[key]; else m.urssafDone[key] = U.today();
    Store.save('meta'); this.render();
    U.toast(m.urssafDone[key] ? 'Déclaration marquée comme faite.' : 'Déclaration remise « à déclarer ».');
  },
  setFreq(v) { Store.state.settings.urssafFreq = v; Store.save('settings'); this.render(); },
  setExtra(v) { Store.state.settings.comptaExtraServices = Math.max(0, U.num(v)); Store.save('settings'); this.render(); },
  _gauge(label, val, base, maj, note) {
    const p = base ? val / base * 100 : 0, col = p >= 100 ? 'var(--alerte)' : p >= 80 ? 'var(--warn)' : 'var(--ok)';
    return `<div style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;"><b>${label}</b><span class="sensitive"><b style="color:${col};">${U.eur(val, 0)}</b> / ${U.eur(base, 0)} <span class="muted">(${Math.round(p)} %)</span></span></div>
      <div style="height:10px;border-radius:6px;background:var(--th-bg);overflow:hidden;margin:4px 0;"><div style="height:100%;width:${Math.min(100, p)}%;background:${col};"></div></div>
      <div class="muted" style="font-size:.8rem;">Seuil majoré ${U.eur(maj, 0)} · ${p >= 100 ? '⚠️ seuil de base dépassé : la franchise s\'arrête au 1er janvier suivant (au 1er jour de dépassement si le seuil majoré est franchi)' : p >= 80 ? '⚠️ tu approches du seuil' : 'tu es loin du seuil'}${note ? ' · ' + note : ''}</div></div>`;
  },
  _watchCard() {
    const S = Store.state.settings, y = new Date().getFullYear(), cur = this._sum(new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()), T = this.THRESH, extra = U.num(S.comptaExtraServices);
    const per = this._urssafPeriods(), d = x => x.deadline.toLocaleDateString('fr-FR');
    return `<div class="card"><h2>🧭 Seuils &amp; déclaration URSSAF <span class="muted help">Indicatif : seuils de franchise de TVA ${T.year} (vente de marchandises ${U.eur(T.vente, 0)}, services ${U.eur(T.services, 0)}). Je ne sais pas à quelle catégorie ton URSSAF rattache le fait main : à confirmer. Les montants sont tes encaissements de l'application ; ajoute ci-dessous le CA réalisé hors application (éducation canine…).</span></h2>
      ${this._gauge('🥩 Ventes de marchandises (mastication + port encaissé)', cur.m, T.vente, T.venteMaj, 'année ' + y)}
      ${this._gauge('🐕 Fait main + services (accessoires + CA hors application)', cur.a + extra, T.services, T.servicesMaj, 'année ' + y)}
      <div class="frow" style="align-items:flex-end;gap:10px;max-width:640px;"><div class="fg"><label>CA hors application cette année (€)</label><input type="number" step="any" min="0" value="${extra || ''}" placeholder="0 (éducation canine, autres)" onchange="Compta.setExtra(this.value)"></div>
        <div class="fg"><label>Je déclare à l'URSSAF</label><select onchange="Compta.setFreq(this.value)"><option value="quarter" ${S.urssafFreq !== 'month' ? 'selected' : ''}>chaque trimestre</option><option value="month" ${S.urssafFreq === 'month' ? 'selected' : ''}>chaque mois</option></select></div></div>
      <div class="table-wrap mt"><table class="pack-tbl"><thead><tr><th style="text-align:left;">Période</th><th class="num">Marchandises</th><th class="num">Fait main</th><th class="num">Carte / virement</th><th class="num">Espèces</th><th class="num">Cotisations estimées</th><th>À déclarer avant le</th><th>Statut</th></tr></thead><tbody>${per.map(p => `<tr><td style="text-align:left;"><b>${p.label}</b></td><td class="num"><span class="sensitive">${U.eur(p.m)}</span></td><td class="num"><span class="sensitive">${U.eur(p.a)}</span></td><td class="num"><span class="sensitive">${U.eur(p.card)}</span></td><td class="num"><span class="sensitive">${U.eur(p.cash)}</span></td><td class="num"><span class="sensitive">${U.eur(p.cot)}</span></td><td>${d(p)}</td><td>${p.doneOn ? `<span class="badge info" style="cursor:pointer;" title="Déclarée le ${U.frDate(p.doneOn)} — clique pour annuler" onclick="Compta.setDeclared('${p.key}')">✔ déclarée</span>` : `<span class="badge ${p.late ? 'bad' : 'warn'}" style="cursor:pointer;${p.late ? 'background:var(--alerte);color:#fff;' : ''}" title="Clique pour marquer comme déclarée" onclick="Compta.setDeclared('${p.key}')">${p.late ? '⚠ en retard' : p.current ? 'en cours' : 'à déclarer'}</span>`}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted" style="font-size:.8rem;">Clique sur le statut d'une période pour la marquer « déclarée » (ou l'annuler). Même sans CA, la déclaration à 0 € est à faire. Dates indicatives (fin du mois ou du trimestre suivant) : vérifie-les sur ton espace autoentrepreneur.urssaf.fr. Le CA à déclarer est celui encaissé, hors éducation canine si tu la déclares à part.</p></div>`;
  },
  _todoCard() {
    const noInv = Achats.list().filter(p => !String(p.invoiceNo || '').trim()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!noInv.length) return '';
    return `<div class="card"><h2>📋 À compléter <span class="muted" style="font-size:.85rem;font-weight:400;">— ${noInv.length} achat(s) sans n° de facture</span></h2>
      <p class="muted help" style="font-size:.85rem;">Le registre des achats demande la référence de la pièce. Retrouve le n° dans ton compte fournisseur et ajoute-le.</p>
      ${noInv.slice(0, 10).map(p => `<div style="display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--row-border);flex-wrap:wrap;"><span>${U.frDate(p.date)} · <b>${U.esc(Achats.supplierLabel(p))}</b> <span class="muted">${(p.lines || []).length} ligne(s)</span>${p.payment === 'especes' ? ' <span class="badge warn">espèces</span>' : ''}</span><span><span class="sensitive">${U.eur(Achats.grandTotal(p))}</span> <button class="btn-ghost btn-sm" onclick="Achats.mode='list';location.hash='#/achats';setTimeout(()=>Achats.edit('${p.id}'),50)">Modifier</button></span></div>`).join('')}${noInv.length > 10 ? `<p class="muted">… et ${noInv.length - 10} autre(s).</p>` : ''}</div>`;
  },
  /* Rappel annuel (janvier → mars) : exporter le registre des achats et le livre des recettes de l'année écoulée */
  _markExport(kind) {
    const m = Store.state.meta, y = this.f.period === 'lastyear' ? new Date().getFullYear() - 1 : this.f.period === 'year' ? new Date().getFullYear() : 0; if (!y) return;
    m.comptaExp = m.comptaExp || {}; (m.comptaExp[kind] = m.comptaExp[kind] || []); if (!m.comptaExp[kind].includes(y)) m.comptaExp[kind].push(y); Store.save('meta');
  },
  maybeRemind() {
    if (App.isViewer || App.isTeam) return;
    const now = new Date(), y = now.getFullYear() - 1, m = Store.state.meta, ex = m.comptaExp || {};
    if (now.getMonth() > 2 || (m.comptaNext && m.comptaNext > U.today())) return;
    const has = Achats.list().some(p => String(p.date).startsWith(String(y))) || (Store.state.sales || []).some(s => new Date(s.ts).getFullYear() === y);
    if (!has || ((ex.achats || []).includes(y) && (ex.recettes || []).includes(y))) return;
    U.ask({ title: '📒 Sauvegarde comptable ' + y, html: `<p>Pense à exporter le <b>registre des achats</b> et le <b>livre des recettes</b> de ${y} (à conserver 10 ans avec tes factures). Ton compte fournisseur peut disparaître : garde une copie.</p>`, okLabel: 'Ouvrir la Compta (' + y + ')', cancelLabel: 'Plus tard (7 jours)' }).then(ok => {
      if (ok) { this.f.period = 'lastyear'; location.hash = '#/compta'; } else { const d = new Date(Date.now() + 7 * 86400000); m.comptaNext = d.toISOString().slice(0, 10); Store.save('meta'); }
    });
  },
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
  /* CHARGES D'ACHATS qui entrent dans le bénéfice net (SOURCE UNIQUE : Compta, Tableau de bord, Statistiques, rentabilité par activité) :
     · expensed = outillage + frais généraux + équipement sans durée d'amortissement (TTC de la ligne) ;
     · portBuy  = frais de livraison de la facture, au prorata des lignes mastication / matière / consommable (il n'est jamais réparti dans le coût des lots). */
  _lineCharges(p, l, ttcLine) {
    let expensed = 0, portBuy = 0;
    if (l.cat === 'outillage' || l.cat === 'frais' || (l.cat === 'equipement' && !(U.num(l.years) > 0))) expensed = ttcLine;
    if (l.cat === 'mastication' || l.cat === 'matiere' || l.cat === 'conso') { const sub = Achats.subTotal(p); if (sub) portBuy = U.num(p.shipping) * Achats.lineTotal(l) / sub * Achats.ttcFactor(p); }
    return { expensed, portBuy };
  },
  /* Charges d'achats sur une période : from / to = timestamp (ms) ou date 'AAAA-MM-JJ' (bornes incluses, sur la date de la facture).
     → { portBuy, expensed, portBy: {mastication, matiere, conso}, byMonth: { 'AAAA-MM': {portBuy, expensed} } } */
  chargesPeriod(from, to) {
    const ds = x => { if (typeof x !== 'number') return String(x).slice(0, 10); const d = new Date(x); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };   // date LOCALE (comme la saisie d'une facture)
    const a = ds(from), b = ds(to), out = { portBuy: 0, expensed: 0, portBy: { mastication: 0, matiere: 0, conso: 0 }, byMonth: {} };
    (Achats.list() || []).forEach(p => {
      const d = String(p.date).slice(0, 10); if (d < a || d > b) return;
      const ttc = Achats.lineTTC(p), k = d.slice(0, 7);
      (p.lines || []).forEach((l, i) => {
        const c = this._lineCharges(p, l, ttc[i]); if (!c.expensed && !c.portBuy) return;
        out.expensed += c.expensed; out.portBuy += c.portBuy; if (c.portBuy && out.portBy[l.cat] !== undefined) out.portBy[l.cat] += c.portBuy;
        const m = out.byMonth[k] || (out.byMonth[k] = { portBuy: 0, expensed: 0 }); m.expensed += c.expensed; m.portBuy += c.portBuy;
      });
    });
    return out;
  },
  data() {
    const months = this._months(), M = {}, inSet = new Set(months);
    months.forEach(k => { M[k] = { inc: 0, incBy: {}, ca: 0, cogs: 0, shipFee: 0, fee: 0, shipping: 0, box: 0, eventFee: 0, partner: 0, cotis: 0, tva: 0, buy: {}, buyPaid: 0, expensed: 0, portBuy: 0, amort: this._amortFor(k), uv: Pricing.uvMaintenanceMonthly(), n: 0 }; });
    (Store.state.sales || []).forEach(s => {
      if (s.cancelled) return; const k = this.mk(s.ts); if (!inSet.has(k)) return;
      const sp = Pricing.saleProfit(s), m = M[k], cash = sp.ca + sp.shipFee;
      m.n++; m.inc += cash; const pk = s.payment || 'autre'; m.incBy[pk] = (m.incBy[pk] || 0) + cash;
      m.ca += sp.ca; m.cogs += sp.cogs; m.shipFee += sp.shipFee; m.fee += sp.fee; m.shipping += sp.shipping; m.box += sp.box; m.eventFee += sp.eventFee; m.partner += sp.partner; m.cotis += sp.cotis; m.tva += sp.tva;
    });
    let toRefund = 0;
    Achats.list().forEach(p => {
      const k = String(p.date).slice(0, 7), ttc = Achats.lineTTC(p), total = Achats.grandTotal(p);
      if (p.paidBy === 'perso' && !p.reimbursed) toRefund += total;
      // répartition par catégorie + dépenses du mois (résultat) à la date de la facture
      if (inSet.has(k)) (p.lines || []).forEach((l, i) => {
        M[k].buy[l.cat] = (M[k].buy[l.cat] || 0) + ttc[i];
        const ch = this._lineCharges(p, l, ttc[i]); M[k].expensed += ch.expensed; M[k].portBuy += ch.portBuy;   // mêmes charges que chargesPeriod (Tableau de bord, Stats…)
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
      m.sellCosts = m.fee + m.shipping + m.box + m.eventFee + m.partner - m.shipFee;   // frais de vente nets du port encaissé
      m.fixed = m.amort + m.uv;
      m.net = m.marge - m.sellCosts - m.cotis - m.expensed - m.portBuy - m.fixed - (Store.state.settings.vatActive ? m.tva : 0);
    });
    const T = { inc: 0, ca: 0, cogs: 0, marge: 0, shipFee: 0, fee: 0, shipping: 0, box: 0, eventFee: 0, partner: 0, cotis: 0, tva: 0, buyPaid: 0, out: 0, solde: 0, expensed: 0, amort: 0, uv: 0, fixed: 0, sellCosts: 0, portBuy: 0, net: 0, buy: {}, incBy: {}, n: 0 };
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
    const reRows = months.map(k => { const m = M[k]; return `<tr><td style="white-space:nowrap;"><b>${this.monthLabel(k)}</b></td><td class="num">${e(m.ca)}</td><td class="num">${e(m.cogs)}</td><td class="num">${e(m.marge)}</td><td class="num">${e(m.sellCosts)}</td><td class="num">${e(m.cotis)}</td><td class="num">${e(m.expensed + m.portBuy)}</td><td class="num">${e(m.fixed)}</td>${S.vatActive ? `<td class="num">${e(m.tva)}</td>` : ''}<td class="num"><b>${sg(m.net)}</b></td></tr>`; }).join('');
    const stockBuy = (T.buy.mastication || 0) + (T.buy.matiere || 0) + (T.buy.conso || 0);
    const line = (label, v, cls, help) => `<tr${cls ? ` class="${cls}"` : ''}><td style="text-align:left;">${label}${help ? ` <span class="muted" style="font-size:.78rem;">${help}</span>` : ''}</td><td class="num">${v}</td></tr>`;
    App.mount(`
      <div class="view-title"><h1>Comptabilité</h1><span class="sub">entrées, sorties, trésorerie et résultat</span></div>
      <div class="card"><div class="frow" style="align-items:center;gap:10px;"><div class="fg" style="max-width:240px;"><label>Période</label><select onchange="Compta.setPeriod(this.value)">${this.PERIODS.map(p => `<option value="${p[0]}" ${this.f.period === p[0] ? 'selected' : ''}>${p[1]}</option>`).join('')}</select></div>
        <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Compta.exportAchats()">⬇ Registre des achats (CSV)</button>
        <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Compta.exportRecettes()">⬇ Livre des recettes (CSV)</button></div>
        <p class="muted help" style="font-size:.82rem;margin-top:8px;">Les cotisations URSSAF sont estimées avec tes taux des Paramètres (marchandises / fait main). Ce n'est pas une déclaration officielle : un indicateur de gestion. Les ventes importées de l'ancien historique ont des prix estimés.</p></div>
      ${this._watchCard()}
      <div class="grid c4" style="margin-bottom:16px;">
        <div class="kpi good sensitive"><div class="v">${U.eur(T.inc)}</div><div class="l">Entrées (encaissé)</div></div>
        <div class="kpi bad sensitive"><div class="v">${U.eur(T.out)}</div><div class="l">Sorties (payé)</div></div>
        <div class="kpi ${T.net < 0 ? 'bad' : ''} sensitive"><div class="v">${U.eur(T.net)}</div><div class="l">Résultat (bénéfice net)</div></div>
        <div class="kpi ${T.solde < 0 ? 'bad' : 'good'} sensitive"><div class="v">${U.eur(T.solde)}</div><div class="l">Solde de trésorerie calculé ${U.info('Calculé par l\'appli : entrées − sorties de la période. Ce n\'est pas ton solde bancaire (pas de solde de départ, cotisations estimées, versements SumUp décalés…). Pour comparer avec ta banque, utilise le « Pointage bancaire » plus bas.')}</div></div>
        ${this._bankTile()}
      </div>
      ${this._bankPanel()}

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
          <tr style="border-top:2px solid var(--caramel);font-weight:700;"><td>Total</td><td class="num">${e(T.ca)}</td><td class="num">${e(T.cogs)}</td><td class="num">${e(T.marge)}</td><td class="num">${e(T.sellCosts)}</td><td class="num">${e(T.cotis)}</td><td class="num">${e(T.expensed + T.portBuy)}</td><td class="num">${e(T.fixed)}</td>${S.vatActive ? `<td class="num">${e(T.tva)}</td>` : ''}<td class="num">${sg(T.net)}</td></tr></tbody></table></div>
        <div class="mt" style="max-width:560px;"><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:4px;">Détail de la période</div><table class="pack-tbl"><tbody>
          ${line('Ventes (CA)', e(T.ca))}${line('− Coût des marchandises vendues', e(T.cogs), '', 'coût réel figé à la vente')}${line('<b>= Marge brute</b>', e(T.marge))}
          ${line('+ Port encaissé', e(T.shipFee))}${line('− Frais de paiement (SumUp / Stripe)', e(T.fee))}${line('− Envois (transporteur, TTC)', e(T.shipping))}${line('− Consommables utilisés (cartons…)', e(T.box))}${line('− Stands, déplacements, repas', e(T.eventFee))}${T.partner ? line('− Reversements aux partenaires', e(T.partner), '', 'charge : ne baisse pas les cotisations') : ''}
          ${line('− Cotisations URSSAF (estimées)', e(T.cotis))}${line('− Outillage, frais généraux, investissements non amortis', e(T.expensed))}${line('− Frais de livraison sur achats de marchandises', e(T.portBuy), '', 'livraison payée aux fournisseurs')}${line('− Amortissements du matériel', e(T.amort))}${line('− Entretien imprimante UV', e(T.uv))}${S.vatActive ? line('− TVA reversée', e(T.tva)) : ''}
          <tr style="border-top:2px solid var(--caramel);font-weight:800;"><td style="text-align:left;">= Bénéfice net</td><td class="num">${sg(T.net)}</td></tr></tbody></table>
          ${stockBuy > 0 ? `<p class="muted" style="font-size:.82rem;margin-top:8px;">ℹ️ ${U.eur(stockBuy)} d'achats de mastication, matières et consommables sur la période ne sont pas dans cette liste : ils passent par le « coût des marchandises vendues » au fur et à mesure des ventes (ce qui n'est pas encore vendu reste en stock). Seule leur livraison est comptée tout de suite, à la date de la facture.</p>` : ''}
        </div>
      </div>
      ${this._todoCard()}`);
  },

  /* ---------- Pointage bancaire (2026-10-03) ----------
     Antho saisit le solde RÉEL de son compte à une date (point de départ), puis de temps en temps (fin de mois…). L'appli calcule ce
     que le compte devrait contenir : dernier solde saisi + mouvements connus datés APRÈS ce point, et affiche l'écart. Un petit écart
     est normal (versements SumUp/Stripe décalés, cotisations réelles ≠ estimées…) ; un gros écart = oubli à chercher.
     Mouvements comptés : ventes non réglées en espèces (net des frais de paiement), envois et stands/repas/déplacements (sauf ceux cochés « payés en espèces »), achats non payés
     en espèces (carte perso : à la date du remboursement). PAS comptés : cotisations URSSAF estimées, espèces → à saisir ci-dessous
     (« mouvements hors appli » : dépôt d'espèces, paiement URSSAF réel, virement perso, frais bancaires…).
     Données dans Store.state.bank = { points:[{id,date,amount,note}], moves:[{id,date,amount,label}] } (admin seulement). */
  _money(raw) { return parseFloat(String(raw == null ? '' : raw).replace(/[\s\u00a0€]/g, '').replace(',', '.')); },   // « 3 250,50 € » → 3250.5 (NaN si illisible)
  _bank() { const b = Store.state.bank = Store.state.bank || {}; b.points = b.points || []; b.moves = b.moves || []; return b; },
  _dkey(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  _bankMoves() {
    const mv = [];
    (Store.state.sales || []).forEach(s => {
      if (s.cancelled) return;
      const sp = Pricing.saleProfit(s), d = this._dkey(s.ts);
      if (s.payment !== 'cash') mv.push({ d, k: 'sales', amt: sp.ca + sp.shipFee - sp.fee });
      const out = sp.shipping + (s.eventFeeCash ? 0 : sp.eventFee); if (out) mv.push({ d, k: 'costs', amt: -out });   // frais d'événement payés en espèces : pas de sortie de banque
    });
    Achats.list().forEach(p => {
      if (p.payment === 'especes') return;
      const d = p.paidBy === 'perso' ? (p.reimbursed ? String(p.reimbursed).slice(0, 10) : '') : String(p.date).slice(0, 10);
      if (d) mv.push({ d, k: 'buy', amt: -Achats.grandTotal(p) });
    });
    this._bank().moves.forEach(m => { if (m.date) mv.push({ d: m.date, k: 'manual', amt: U.num(m.amount) }); });
    return mv;
  },
  _bankSum(mv, from, to) { const r = { sales: 0, costs: 0, buy: 0, manual: 0, total: 0 }; mv.forEach(m => { if (m.d > from && m.d <= to) { r[m.k] += m.amt; r.total += m.amt; } }); return r; },
  _bankBody() {
    const b = this._bank(), pts = b.points.slice().sort((x, y) => x.date.localeCompare(y.date) || 0), mv = this._bankMoves(), today = U.today();
    const e = v => `<span class="sensitive">${U.eur(v)}</span>`, sg = v => `<span class="sensitive ${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${(v > 0 ? '+' : '') + U.eur(v)}</span>`;
    const head = `<p class="muted help" data-help-anchor="~ h2" style="font-size:.82rem;">Tu saisis le solde réel de ton compte à une date (ton point de départ), puis de temps en temps (fin de mois…). L'appli calcule ce que ton compte devrait contenir : dernier solde saisi + ventes encaissées − achats payés − envois et stands, depuis cette date. Un petit écart est normal : les versements SumUp / Stripe arrivent quelques jours après la vente, tes cotisations URSSAF réelles ne sont pas celles estimées. Un gros écart sans explication = un oubli à chercher (achat non saisi, vente oubliée…). Les ventes en espèces, les achats payés en espèces et les frais d'événement cochés « payés en espèces » ne comptent pas (l'argent n'est pas en banque) : saisis un « mouvement hors appli » quand tu déposes des espèces, quand l'URSSAF te prélève, quand tu te fais un virement perso, pour des frais bancaires… N'enregistre jamais de numéro de compte ici : seulement des montants.</p>`;
    if (!pts.length) {
      return `${head}
        <p style="margin:10px 0 4px;"><b>Point de départ</b> : combien y a-t-il sur ton compte professionnel là, maintenant ?</p>
        <div class="frow" style="align-items:flex-end;flex-wrap:wrap;gap:8px;"><div class="fg" style="max-width:170px;"><label>Date</label><input type="date" id="bk_date" value="${today}"></div>
          <div class="fg" style="max-width:170px;"><label>Solde de ton compte (€)</label><input id="bk_amt" inputmode="decimal" placeholder="ex : 3 250,00" onkeydown="if(event.key==='Enter')Compta.addPoint()"></div>
          <button class="btn-cta" style="flex:0 0 auto;" onclick="Compta.addPoint()">Enregistrer mon point de départ</button></div>`;
    }
    const last = pts[pts.length - 1], since = this._bankSum(mv, last.date, today), expected = U.num(last.amount) + since.total;
    const rows = pts.map((p, i) => {
      let calc = '—', gap = '—';
      if (i > 0) { const prev = pts[i - 1], c = U.num(prev.amount) + this._bankSum(mv, prev.date, p.date).total, g = U.num(p.amount) - c; calc = e(c); gap = Math.abs(g) < 1 ? '<span class="pos">✅ OK</span>' : `<span class="warn-txt">${sg(g)}</span>`; }
      return `<tr><td style="white-space:nowrap;">${U.frDate(p.date)}${i === 0 ? ' <span class="badge info">départ</span>' : ''}</td><td class="num"><b>${e(U.num(p.amount))}</b></td><td class="num">${calc}</td><td class="num">${gap}</td><td style="text-align:left;">${U.esc(p.note || '')}</td><td><button class="btn-icon" title="Supprimer ce pointage" onclick="Compta.delPoint('${p.id}')">🗑️</button></td></tr>`;
    }).join('');
    const mvs = b.moves.slice().sort((x, y) => y.date.localeCompare(x.date)).map(m => `<tr><td style="white-space:nowrap;">${U.frDate(m.date)}</td><td style="text-align:left;">${U.esc(m.label || '')}</td><td class="num">${sg(U.num(m.amount))}</td><td><button class="btn-icon" title="Supprimer" onclick="Compta.delMove('${m.id}')">🗑️</button></td></tr>`).join('');
    return `${head}
      <div class="grid c2" style="margin:12px 0;">
        <div class="kpi sensitive"><div class="v">${U.eur(expected)}</div><div class="l">Solde attendu en banque aujourd'hui</div></div>
        <div class="kpi sensitive"><div class="v">${U.eur(U.num(last.amount))}</div><div class="l">Dernier solde relevé (${U.frDate(last.date)})</div></div>
      </div>
      <p class="muted" style="font-size:.85rem;margin:0 0 10px;">Depuis le ${U.frDate(last.date)} : ventes encaissées ${sg(since.sales)} · achats payés ${sg(since.buy)} · envois et stands ${sg(since.costs)} · mouvements hors appli ${sg(since.manual)}.</p>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th class="num">Solde de ta banque</th><th class="num">Calculé par l'appli</th><th class="num">Écart</th><th>Note</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="frow mt" style="align-items:flex-end;flex-wrap:wrap;gap:8px;"><div class="fg" style="max-width:160px;"><label>Date</label><input type="date" id="bk_date" value="${today}"></div>
        <div class="fg" style="max-width:170px;"><label>Solde de ta banque (€)</label><input id="bk_amt" inputmode="decimal" placeholder="ex : 3 250,00" onkeydown="if(event.key==='Enter')Compta.addPoint()"></div>
        <div class="fg" style="max-width:260px;"><label>Note (option)</label><input id="bk_note" placeholder="ex : fin septembre"></div>
        <button class="btn-cta" style="flex:0 0 auto;" onclick="Compta.addPoint()">＋ Nouveau pointage</button></div>
      <h3 style="margin:18px 0 6px;">Mouvements hors appli <span class="muted" style="font-size:.8rem;font-weight:400;">— ce qui passe par ta banque sans être dans l'appli</span></h3>
      ${mvs ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Libellé</th><th class="num">Montant</th><th></th></tr></thead><tbody>${mvs}</tbody></table></div>` : '<p class="muted" style="font-size:.85rem;margin:0 0 6px;">Aucun pour l\'instant. Exemples : dépôt d\'espèces (+), prélèvement URSSAF (−), virement vers ton compte perso (−), frais bancaires (−).</p>'}
      <div class="frow mt" style="align-items:flex-end;flex-wrap:wrap;gap:8px;"><div class="fg" style="max-width:160px;"><label>Date</label><input type="date" id="mv_date" value="${today}"></div>
        <div class="fg" style="max-width:170px;"><label>Montant (€, − si sorti)</label><input id="mv_amt" inputmode="decimal" placeholder="ex : 250 ou -420,50" onkeydown="if(event.key==='Enter')Compta.addMove()"></div>
        <div class="fg" style="max-width:300px;"><label>Libellé</label><input id="mv_label" placeholder="ex : dépôt d'espèces du marché" onkeydown="if(event.key==='Enter')Compta.addMove()"></div>
        <button class="btn-ghost" style="flex:0 0 auto;" onclick="Compta.addMove()">＋ Ajouter</button></div>`;
  },
  /* Tuile « Solde attendu en banque » (5e case de la rangée Entrées / Sorties / Solde / Résultat) : cliquable → déplie / replie le panneau de pointage
     juste sous la rangée. Ouvert d'office tant qu'aucun point de départ n'est saisi. */
  _bankOpen: undefined,
  _bankIsOpen() { return this._bankOpen === undefined ? !this._bank().points.length : this._bankOpen; },
  toggleBank() { this._bankOpen = !this._bankIsOpen(); this.render(); },
  _bankTile() {
    const pts = this._bank().points.slice().sort((x, y) => x.date.localeCompare(y.date)), open = this._bankIsOpen();
    let v, sub = '';
    if (!pts.length) v = '<span class="muted" style="font-size:1rem;">à saisir</span>';
    else { const last = pts[pts.length - 1]; v = U.eur(U.num(last.amount) + this._bankSum(this._bankMoves(), last.date, U.today()).total); sub = ` <span style="opacity:.7;font-weight:400;text-transform:none;">· relevé du ${U.frDate(last.date).slice(0, 5)}</span>`; }
    return `<div class="kpi sensitive" style="cursor:pointer;" role="button" tabindex="0" onclick="Compta.toggleBank()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();Compta.toggleBank();}" title="${open ? 'Replier' : 'Ouvrir'} le pointage bancaire"><div class="v">${v}</div><div class="l">Solde attendu en banque${sub} <span style="color:var(--caramel);">${open ? '▴' : '▾'}</span></div></div>`;
  },
  _bankPanel() {
    if (!this._bankIsOpen()) return '';
    return `<div class="card" style="border-left:4px solid var(--caramel);"><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><h2 style="margin:0;">🏦 Pointage bancaire <span class="muted" style="font-size:.85rem;font-weight:400;">— l'appli et ta banque racontent-elles la même chose ?</span></h2><button class="btn-ghost btn-sm" style="margin-left:auto;" onclick="Compta.toggleBank()">▴ Replier</button></div>${this._bankBody()}</div>`;
  },
  addPoint() {
    const date = U.val('bk_date'), raw = String(U.val('bk_amt') || '').trim();
    if (!date) { U.toast('Choisis la date du solde.', true); return; }
    const amt = this._money(raw);
    if (isNaN(amt)) { U.toast('Indique le solde de ton compte (en €).', true); return; }
    const b = this._bank();
    if (b.points.some(p => p.date === date && Math.abs(U.num(p.amount) - amt) < 0.005)) { U.toast('Ce pointage existe déjà.', true); return; }
    b.points.push({ id: U.uid(), date, amount: Math.round(amt * 100) / 100, note: String(U.val('bk_note') || '').trim() });
    Store.log('compta', 'Pointage bancaire — ' + U.frDate(date));
    Store.save('bank', 'journal'); this.render();
    U.toast(b.points.length === 1 ? 'Point de départ enregistré : l\'appli suit maintenant ton solde.' : 'Pointage enregistré.');
  },
  async delPoint(id) {
    const b = this._bank(), p = b.points.find(x => x.id === id); if (!p) return;
    if (!await U.confirm('Supprimer le pointage du ' + U.frDate(p.date) + ' ?', { okLabel: 'Supprimer' })) return;
    b.points = b.points.filter(x => x.id !== id); Store.save('bank'); this.render();
  },
  addMove() {
    const date = U.val('mv_date'), raw = String(U.val('mv_amt') || '').trim(), label = String(U.val('mv_label') || '').trim();
    if (!date) { U.toast('Choisis la date du mouvement.', true); return; }
    const amt = this._money(raw);
    if (isNaN(amt) || amt === 0) { U.toast('Indique le montant (négatif si c\'est une sortie).', true); return; }
    this._bank().moves.push({ id: U.uid(), date, amount: Math.round(amt * 100) / 100, label });
    Store.log('compta', 'Mouvement hors appli — ' + (label || U.frDate(date)));
    Store.save('bank', 'journal'); this.render();
  },
  async delMove(id) {
    const b = this._bank(), m = b.moves.find(x => x.id === id); if (!m) return;
    if (!await U.confirm('Supprimer ce mouvement (' + (m.label || U.frDate(m.date)) + ') ?', { okLabel: 'Supprimer' })) return;
    b.moves = b.moves.filter(x => x.id !== id); Store.save('bank'); this.render();
  },

  /* ---------- exports ---------- */
  _periodPurchases() { const ks = new Set(this._months()); return Achats.list().filter(p => ks.has(String(p.date).slice(0, 7))); },
  exportAchats() { Achats.exportCsv(this._periodPurchases()); this._markExport('achats'); },
  exportRecettes() {
    const ks = new Set(this._months()), rows = (Store.state.sales || []).filter(s => !s.cancelled && ks.has(this.mk(s.ts))).sort((a, b) => a.ts - b.ts);
    if (!rows.length) { U.toast('Aucune vente sur cette période.', true); return; }
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', n = v => String(Math.round(U.num(v) * 100) / 100).replace('.', ',');
    const pay = { sumup: 'SumUp', stripe: 'Stripe', virement: 'Virement', cash: 'Especes' };
    const out = ['Date;Reference;Client;Nature;Moyen_de_paiement;Montant_marchandises;Port_encaisse;Total_encaisse'];
    rows.forEach(s => { const sp = Pricing.saleProfit(s); const x = this._split(s), d = new Date(s.ts).toISOString().slice(0, 10); out.push([q(d), q('V' + d.replace(/-/g, '') + '-' + String(s.id).slice(-4).toUpperCase()), q(s.customerName || ''), q(x.m && x.a ? 'Vente marchandises + fait main' : x.a ? 'Fait main' : 'Vente marchandises'), q(pay[s.payment] || ''), n(sp.ca), n(sp.shipFee), n(sp.ca + sp.shipFee)].join(';')); });
    const blob = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'recettes-' + U.today() + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); this._markExport('recettes');
  }
};
