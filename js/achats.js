/* ═══════════ Achats (2026-10-02) — étape 1 : saisie des factures + liste ═══════════
   Store.state.purchases = [{ id, date, supplierId, invoiceNo, payment: 'carte'|'especes'|'virement', paidBy: 'pro'|'perso',
     reimbursed: '' | 'AAAA-MM-JJ', shipping, discount, note, total, created, updated,
     lines: [{ id, cat, ref, label, qty, unit, price, lot, dluo, years }] }]
   cat : mastication · matiere · conso · equipement (lignes détaillées) / outillage · frais (un seul montant).
   ref : id du produit stock (mastication) / de la matière / du consommable — optionnel, sert aux étapes suivantes
         (mise à jour du stock à la réception, lots, coûts réels, statistiques).
   Montants = ce qui a été PAYÉ (TTC). Aucune écriture dans le stock ni dans les prix à cette étape : rien n'est modifié ailleurs.
   Réservé à l'admin (ni viewer, ni équipe). */
const Achats = {
  mode: 'list', _priceOpen: true, _d: null, _editId: '', _dirty: false, _open: {}, _lastCat: 'mastication',
  f: { period: 'year', from: '', to: '', supplier: '', cat: '', pay: '', q: '', refund: false, sort: 'date', sortDir: 'desc' },
  CATS: [
    { id: 'mastication', ico: '🥩', label: 'Mastication', detail: true, link: 'M' },
    { id: 'matiere', ico: '🧵', label: 'Matière première', detail: true, link: 'T' },
    { id: 'conso', ico: '📦', label: 'Consommable', detail: true, link: 'C' },
    { id: 'equipement', ico: '🛠️', label: 'Investissement / machine', detail: true, link: '' },
    { id: 'outillage', ico: '🔧', label: 'Outillage', detail: false, link: '' },
    { id: 'frais', ico: '🧾', label: 'Frais généraux', detail: false, link: '' }
  ],
  PAYS: [['carte', '💳 Carte'], ['especes', '💵 Espèces'], ['virement', '🏦 Virement']],

  /* ---------- calculs ---------- */
  cat(id) { return this.CATS.find(c => c.id === id) || this.CATS[0]; },
  list() { return Store.state.purchases || (Store.state.purchases = []); },
  r2(n) { return Math.round(U.num(n) * 100) / 100; },
  lineTotal(l) { return this.r2(U.num(l.qty) * U.num(l.price)); },
  subTotal(p) { return this.r2((p.lines || []).reduce((a, l) => a + this.lineTotal(l), 0)); },
  /* Facture saisie en TTC (défaut) ou en HT (fournisseur qui détaille la TVA en bas de page : p.vat = [{rate, amount}]).
     base = lignes + livraison − remise (dans le mode de saisie) ; payé (TTC) = base + TVA si HT. */
  isHT(p) { return p.taxMode === 'ht'; },
  base(p) { return this.r2(this.subTotal(p) + U.num(p.shipping) - U.num(p.discount)); },
  vatSum(p) { return this.isHT(p) ? this.r2((p.vat || []).reduce((a, v) => a + U.num(v.amount), 0)) : 0; },
  grandTotal(p) { return this.r2(this.base(p) + this.vatSum(p)); },   // TOUJOURS ce qui a été payé (TTC)
  /* TVA répartie au prorata (le fournisseur ne dit pas sur quel produit) : coût TTC = HT × (1 + TVA totale / base HT) */
  ttcFactor(p) { const b = this.base(p); return this.isHT(p) && b > 0 ? 1 + this.vatSum(p) / b : 1; },
  supplierLabel(p) { return p.supplierId ? Store.supplierName(p.supplierId) : '—'; },
  others() { const S = Store.state.settings; return S.suppliersOther || (S.suppliersOther = []); },   // fournisseurs hors produits (outillage, équipement, frais…)
  lineTTC(p) { const f = this.ttcFactor(p); return this._eff(p).map(x => x * f); },   // montant payé (TTC) imputé à chaque ligne : livraison, remise et TVA comprises (somme = payé)

  /* Investissements : une ligne « Investissement / machine » avec une durée d'amortissement alimente la liste d'amortissement des
     Paramètres (settings.uvEquip, entrée marquée src = « facture|ligne »). Réconciliation idempotente : crée les entrées manquantes,
     retire celles dont la facture ou la ligne n'existe plus (suppression, annulation, durée retirée). */
  reconcileEquip() {
    const S = Store.state.settings; if (!S) return;
    if (!Array.isArray(S.uvEquip) && typeof Params !== 'undefined') Params._uvEquipMigrate();
    if (!Array.isArray(S.uvEquip)) S.uvEquip = [];
    const want = new Map();
    this.list().forEach(p => { const ttc = this.lineTTC(p); (p.lines || []).forEach((l, i) => { if (l.cat === 'equipement' && U.num(l.years) > 0) want.set(p.id + '|' + l.id, { p, l, price: this.r2(ttc[i]) }); }); });
    let changed = false;
    const before = S.uvEquip.length;
    S.uvEquip = S.uvEquip.filter(e => !e.src || want.has(e.src));
    if (S.uvEquip.length !== before) changed = true;
    want.forEach((w, key) => {
      const e = S.uvEquip.find(x => x.src === key);
      if (!e) { S.uvEquip.push({ id: U.uid(), name: w.l.label, price: w.price, years: U.num(w.l.years), buyYear: +String(w.p.date).slice(0, 4), buyDate: w.p.date, category: 'commun', src: key }); changed = true; }
      else if (e.price !== w.price && !e.edited) { e.price = w.price; changed = true; }
    });
    if (changed) Store.save('settings');
  },
  /* Référentiel Paramètres : fournisseurs « autres » (outillage, équipement, frais…), séparés des fournisseurs de produits */
  othersCard() {
    const o = this.others().slice().sort((a, b) => U.sortFr(a.name, b.name));
    return `<div style="padding:12px 0;border-bottom:1px solid var(--row-border);"><h3 style="margin:0 0 8px;">Autres fournisseurs <span class="muted help">Outillage, équipement, lumières, assurance… : tout ce qui n'est pas de la mastication, de la matière première ou un consommable. Cette liste est distincte de celle des fournisseurs de produits et sert uniquement à la page Achats.</span></h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">${o.map(s => `<span class="tag" style="display:inline-flex;gap:6px;align-items:center;">${U.esc(s.name)} <button class="btn-icon" style="padding:0;" onclick="Achats.delOther('${s.id}')">×</button></span>`).join('') || '<span class="muted">Vide</span>'}</div>
      <div class="frow mt"><input id="add_sup_other" placeholder="Ajouter…" onkeydown="if(event.key==='Enter')Achats.addOther()"><button class="btn-ghost btn-sm" onclick="Achats.addOther()">＋</button></div></div>`;
  },
  addOther() {
    const n = U.val('add_sup_other').trim(); if (!n) return;
    if (this.others().some(s => s.name.toLowerCase() === n.toLowerCase())) { U.toast('Ce fournisseur existe déjà.', true); return; }
    this.others().push({ id: U.uid(), name: n }); Store.save('settings'); App.rerender();
  },
  async delOther(id) {
    const used = this.list().filter(p => p.supplierId === id).length;
    if (!await U.confirm(used ? `Ce fournisseur est utilisé par ${used} facture(s) : elles afficheront « — ». Le retirer quand même ?` : 'Retirer ce fournisseur ?', { okLabel: 'Retirer' })) return;
    Store.state.settings.suppliersOther = this.others().filter(s => s.id !== id); Store.save('settings'); App.rerender();
  },
  payLabel(v) { const x = this.PAYS.find(p => p[0] === v); return x ? x[1] : '—'; },
  UNITS: ['pièce', 'kg', 'g', 'm'],
  unitFrom(u) { const t = String(u || '').toLowerCase(); return t === 'piece' || t === 'pcs' || t === 'pc' ? 'pièce' : t === 'ml' ? 'm' : String(u || ''); },
  itemName(kind, id) {
    if (kind === 'M') { const p = (Store.state.stockM || []).find(x => x.id === id); return p ? p.name : ''; }
    if (kind === 'T') { const m = (Store.state.materials || []).find(x => x.id === id); return m ? (m.product ? m.product + ' ' : '') + (m.variant || m.name || '') : ''; }
    const c = (Store.state.consumables || []).find(x => x.id === id); return c ? c.name + (Stock.consoDims(c) ? ' ' + Stock.consoDims(c) : '') : '';
  },
  _newLine(cat) {
    const c = this.cat(cat);
    return { id: U.uid(), cat: c.id, ref: '', label: '', qty: 1, unit: c.id === 'mastication' ? 'kg' : c.detail ? 'pièce' : '', price: 0, lot: '', dluo: '', years: '', toStock: false };
  },

  /* ---------- mise à jour du stock (consommables + matières premières) ----------
     Case « Ajouter au stock » par ligne liée : à l'enregistrement, la quantité est ajoutée à la fiche et son coût devient
     le DERNIER prix payé (livraison et remise réparties au prorata du montant de chaque ligne). Modifier ou supprimer la facture
     retire la quantité ajoutée (le prix, lui, reste celui du dernier achat). Jamais de création de fiche. Annulable (Journal). */
  _recent(date) { return !date || date >= new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10); },   // facture ancienne → case décochée par défaut
  _item(l) { return l.cat === 'conso' ? (Store.state.consumables || []).find(x => x.id === l.ref) : l.cat === 'matiere' ? (Store.state.materials || []).find(x => x.id === l.ref) : null; },
  _packOf(l, it) { return l.cat === 'conso' && U.num(it.costQtyPer) > 1 ? U.num(it.costQtyPer) : 1; },   // prix saisi « par lot de N » : on ajoute N × quantité
  _stockPreview(l) {
    const it = this._item(l); if (!it) return null;
    const add = U.num(l.qty) * this._packOf(l, it);
    return { it, add, cur: U.num(it.qty), after: U.num(it.qty) + add };
  },
  _eff(rec) {   // total de chaque ligne + sa part de livraison − sa part de remise (dans le mode de saisie)
    const sub = this.subTotal(rec), extra = U.num(rec.shipping) - U.num(rec.discount);
    return (rec.lines || []).map(l => this.lineTotal(l) + (sub ? extra * this.lineTotal(l) / sub : 0));
  },
  _effHT(rec) { const g = 1 + U.num(Store.state.settings.vatRate ?? 20) / 100; return this._eff(rec).map(x => this.isHT(rec) ? x : x / g); },   // coût réel HT de chaque ligne (livraison et remise comprises)
  _snapOnce(domain, item, snaps) { if (!snaps.some(s => s.domain === domain && s.id === item.id)) snaps.push(Store.snapshot(domain, item)); },
  _revertStock(rec, snaps) {
    (rec.lines || []).forEach(l => {
      const ap = l.applied; if (!ap) return;
      const it = this._item(l); if (!it) return;
      this._snapOnce(l.cat === 'conso' ? 'consumables' : 'materials', it, snaps);
      if (ap.rollId && Array.isArray(it.rolls)) { it.rolls = it.rolls.filter(r => r.id !== ap.rollId); it.qty = it.rolls.reduce((a, r) => a + U.num(r.qty), 0); }
      else it.qty = Math.max(0, U.num(it.qty) - U.num(ap.qty));
    });
  },
  _applyStock(rec, snaps, notes) {
    const eff = this._effHT(rec);   // coût réel HT par ligne (TVA propre à la facture si saisie en HT)
    rec.lines.forEach((l, i) => {
      delete l.applied;
      if (!l.toStock || !l.ref || (l.cat !== 'conso' && l.cat !== 'matiere') || !(U.num(l.qty) > 0)) return;
      const it = this._item(l); if (!it) return;
      this._snapOnce(l.cat === 'conso' ? 'consumables' : 'materials', it, snaps);
      const pack = this._packOf(l, it), add = U.num(l.qty) * pack, prevQty = U.num(it.qty), prevCost = U.num(it.costUnit);
      const perPack = eff[i] / U.num(l.qty), ap = { qty: add, prevCost };
      if (l.cat === 'conso') {
        it.costTotal = Math.round(perPack * 10000) / 10000; it.costQtyPer = pack > 1 ? pack : 1; it.costTax = 'HT';
        it.costUnit = Stock.consoUnitCost(it.costTotal, it.costQtyPer, 'HT'); it.qty = prevQty + add;
      } else {
        it.costUnit = Math.round(perPack * 10000) / 10000;
        if (it.kind === 'sangle') {
          if (!Array.isArray(it.rolls)) it.rolls = prevQty > 0 ? [{ id: U.uid(), label: 'Stock avant achat', qty: prevQty }] : [];
          const r = { id: U.uid(), label: 'Achat ' + U.frDate(rec.date) + (rec.invoiceNo ? ' · ' + rec.invoiceNo : ''), qty: add };
          it.rolls.push(r); ap.rollId = r.id; it.qty = it.rolls.reduce((a, x) => a + U.num(x.qty), 0);
        } else it.qty = prevQty + add;
      }
      ap.newCost = it.costUnit; l.applied = ap;
      const nm = this.itemName(l.cat === 'conso' ? 'C' : 'T', l.ref) || l.label, pct = prevCost > 0 ? (it.costUnit - prevCost) / prevCost * 100 : 0;
      notes.push(`${nm} +${U.qty(add)} (${U.qty(prevQty)} → ${U.qty(it.qty)})`);
      if (Math.abs(it.costUnit - prevCost) > 0.00005 && prevCost > 0) notes.push(`💶 prix ${pct > 0 ? '↑ +' : '↓ '}${Math.round(pct * 10) / 10} % : ${nm} ${U.eur(prevCost, 3)} → ${U.eur(it.costUnit, 3)} HT (vérifie les fiches prix concernées)`);
    });
  },
  _newPurchase() {
    return { id: U.uid(), date: U.today(), supplierId: '', invoiceNo: '', payment: 'carte', paidBy: 'pro', reimbursed: '', taxMode: 'ttc', vat: [], shipping: 0, discount: 0, note: '', lines: [this._newLine(this._lastCat)] };
  },

  /* ---------- brouillon (survit à F5 / changement de fenêtre) ---------- */
  _DK: 'touffu_achats_draft',
  _saveDraft() { try { localStorage.setItem(this._DK, JSON.stringify({ d: this._d, editId: this._editId, dirty: this._dirty })); } catch (e) {} },
  _clearDraft() { try { localStorage.removeItem(this._DK); } catch (e) {} },
  _loadDraft() {
    if (this._draftLoaded) return; this._draftLoaded = true;
    try {
      const x = JSON.parse(localStorage.getItem(this._DK) || 'null');
      if (x && x.d && Array.isArray(x.d.lines)) { this._d = x.d; this._editId = x.editId || ''; this._dirty = !!x.dirty; this.mode = 'edit'; }
    } catch (e) {}
  },

  /* ---------- filtres ---------- */
  setF(k, v) { this.f[k] = v; this.render(); },
  setQ(v) { this.f.q = v; this.render(); U.refocus('ach_q'); },
  setSort(k) { this.f = Object.assign({}, this.f, this.f.sort === k ? { sortDir: this.f.sortDir === 'asc' ? 'desc' : 'asc' } : { sort: k, sortDir: k === 'date' || k === 'total' ? 'desc' : 'asc' }); this.render(); },
  _range() {
    const f = this.f, now = new Date(), y = now.getFullYear(), iso = d => d.toISOString().slice(0, 10);
    if (f.period === 'month') return [iso(new Date(y, now.getMonth(), 1)), '9999'];
    if (f.period === '30d') return [iso(new Date(Date.now() - 30 * 86400000)), '9999'];
    if (f.period === 'year') return [y + '-01-01', y + '-12-31'];
    if (f.period === 'lastyear') return [(y - 1) + '-01-01', (y - 1) + '-12-31'];
    if (f.period === 'custom') return [f.from || '0000', f.to || '9999'];
    return ['0000', '9999'];
  },
  _filtered() {
    const f = this.f, [a, b] = this._range(), q = f.q.trim().toLowerCase();
    let rows = this.list().filter(p => p.date >= a && p.date <= b);
    if (f.supplier) rows = rows.filter(p => p.supplierId === f.supplier);
    if (f.cat) rows = rows.filter(p => (p.lines || []).some(l => l.cat === f.cat));
    if (f.pay) rows = rows.filter(p => p.payment === f.pay);
    if (f.refund) rows = rows.filter(p => p.paidBy === 'perso' && !p.reimbursed);
    if (q) rows = rows.filter(p => U.has([p.invoiceNo, p.note, this.supplierLabel(p), ...(p.lines || []).flatMap(l => [l.label, l.lot])].filter(Boolean).join(' '), q));
    const dir = f.sortDir === 'asc' ? 1 : -1;
    rows.sort((x, y) => f.sort === 'supplier' ? dir * U.sortFr(this.supplierLabel(x), this.supplierLabel(y)) : f.sort === 'total' ? dir * (this.grandTotal(x) - this.grandTotal(y)) : dir * ((x.date || '').localeCompare(y.date || '') || (x.created || 0) - (y.created || 0)));
    return rows;
  },

  /* ---------- page principale ---------- */
  render() {
    if (App.isViewer || App.isTeam) { App.mount('<div class="empty"><span class="big">🔒</span>Page réservée à l\'administrateur.</div>'); return; }
    U.syncFilters('achats', this.f); this.reconcileEquip();
    this._loadDraft();
    if (this.mode === 'edit' && this._d) this.renderEditor(); else this.renderList();
  },
  renderList() {
    const f = this.f, rows = this._filtered();
    const sum = rows.reduce((a, p) => a + this.grandTotal(p), 0), ship = rows.reduce((a, p) => a + U.num(p.shipping), 0);
    const toRefund = this.list().filter(p => p.paidBy === 'perso' && !p.reimbursed).reduce((a, p) => a + this.grandTotal(p), 0);
    const sups = (Store.state.settings.suppliers || []).slice().sort((a, b) => U.sortFr(a.name, b.name));
    const opt = (v, l, cur) => `<option value="${U.esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${U.esc(l)}</option>`;
    const periods = [['month', 'Ce mois-ci'], ['30d', '30 derniers jours'], ['year', 'Cette année'], ['lastyear', 'Année dernière'], ['all', 'Tout'], ['custom', 'Du… au…']];
    const sh = (k, l) => `<span class="sortable ${f.sort === k ? 'active' : ''}" onclick="Achats.setSort('${k}')">${l} ${f.sort === k ? (f.sortDir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
    const body = rows.map(p => {
      const open = !!this._open[p.id], tot = this.grandTotal(p);
      const cats = [...new Set((p.lines || []).map(l => this.cat(l.cat).ico))].join(' ');
      const refund = p.paidBy === 'perso' ? (p.reimbursed ? `<span class="badge info" title="Remboursé le ${U.frDate(p.reimbursed)}">💳 perso · remboursé</span>` : `<span class="badge warn">💳 perso · à rembourser</span>`) : '<span class="muted">compte pro</span>';
      return `<tr style="cursor:pointer;" onclick="Achats.toggle('${p.id}')">
        <td style="white-space:nowrap;"><b>${open ? '▾' : '▸'} ${U.frDate(p.date)}</b></td>
        <td style="text-align:left;">${U.esc(this.supplierLabel(p))}</td>
        <td style="text-align:left;">${U.esc(p.invoiceNo || '—')}</td>
        <td style="text-align:left;">${cats} <span class="muted">${(p.lines || []).length} ligne(s)</span></td>
        <td>${this.payLabel(p.payment)}</td>
        <td>${refund}</td>
        <td class="num sensitive">${U.num(p.shipping) ? U.eur(p.shipping) : '—'}</td>
        <td class="num sensitive"><b>${U.eur(tot)}</b></td>
        <td style="white-space:nowrap;text-align:right;" onclick="event.stopPropagation()">
          ${p.paidBy === 'perso' && !p.reimbursed ? `<button class="btn-ghost btn-sm" onclick="Achats.setReimbursed('${p.id}',true)" title="Marquer comme remboursé">✔ Remboursé</button>` : ''}
          <button class="btn-ghost btn-sm" onclick="Achats.edit('${p.id}')">Modifier</button>
          <button class="btn-icon" title="Dupliquer (nouvelle facture pré-remplie)" onclick="Achats.dup('${p.id}')">📋</button>
          <button class="btn-icon" title="Supprimer" onclick="Achats.remove('${p.id}')">🗑️</button>
        </td></tr>${open ? this._detailRow(p) : ''}`;
    }).join('');
    App.mount(`
      <div class="view-title"><h1>Achats</h1><span class="sub">factures fournisseurs · dépenses de l'activité</span></div>
      <div class="grid c4" style="margin-bottom:16px;">
        <div class="kpi sensitive"><div class="v">${U.eur(sum)}</div><div class="l">Dépensé (période)</div></div>
        <div class="kpi"><div class="v">${rows.length}</div><div class="l">Facture(s)</div></div>
        <div class="kpi sensitive"><div class="v">${U.eur(ship)}</div><div class="l">dont livraison</div></div>
        <div class="kpi ${toRefund > 0 ? 'warn' : ''} sensitive" style="${toRefund > 0 ? 'cursor:pointer;' : ''}" ${toRefund > 0 ? `onclick="Achats.setF('refund',${!f.refund})"` : ''}><div class="v">${U.eur(toRefund)}</div><div class="l">À me rembourser (carte perso)</div></div>
      </div>
      <div class="card">
        <div class="grid c4" style="align-items:end;">
          <div class="fg"><label>Période</label><select onchange="Achats.setF('period',this.value)">${periods.map(p => opt(p[0], p[1], f.period)).join('')}</select></div>
          ${f.period === 'custom' ? `<div class="fg"><label>Du</label><input type="date" value="${U.esc(f.from)}" onchange="Achats.setF('from',this.value)"></div><div class="fg"><label>Au</label><input type="date" value="${U.esc(f.to)}" onchange="Achats.setF('to',this.value)"></div>` : ''}
          <div class="fg"><label>Fournisseur</label><select onchange="Achats.setF('supplier',this.value)">${opt('', 'Tous', f.supplier)}<optgroup label="Produits">${sups.map(s => opt(s.id, s.name, f.supplier)).join('')}</optgroup>${this.others().length ? `<optgroup label="Autres">${this.others().slice().sort((a, b) => U.sortFr(a.name, b.name)).map(s => opt(s.id, s.name, f.supplier)).join('')}</optgroup>` : ''}</select></div>
          <div class="fg"><label>Catégorie</label><select onchange="Achats.setF('cat',this.value)">${opt('', 'Toutes', f.cat)}${this.CATS.map(c => opt(c.id, c.ico + ' ' + c.label, f.cat)).join('')}</select></div>
          <div class="fg"><label>Paiement</label><select onchange="Achats.setF('pay',this.value)">${opt('', 'Tous', f.pay)}${this.PAYS.map(p => opt(p[0], p[1], f.pay)).join('')}</select></div>
          <div class="fg"><label>Recherche</label><input id="ach_q" value="${U.esc(f.q)}" placeholder="n° facture, produit, lot…" oninput="Achats.setQ(this.value)"></div>
        </div>
        <div class="frow mt" style="align-items:center;gap:10px;">
          <button class="btn-cta" style="flex:0 0 auto;" onclick="Achats.create()">＋ Nouvelle facture</button>
          <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Achats.exportCsv()" title="Un fichier avec les factures affichées (une ligne par article) : registre des achats">⬇ Exporter (CSV)</button>
          ${f.refund ? `<button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Achats.setF('refund',false)">✕ Afficher aussi les remboursées</button>` : ''}
        </div>
      </div>
      ${this._recvCard()}
      ${this._priceCard()}
      <div class="card">
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>${sh('date', 'Date')}</th><th style="text-align:left;">${sh('supplier', 'Fournisseur')}</th><th style="text-align:left;">N° facture</th><th style="text-align:left;">Contenu</th><th>Paiement</th><th>Payé par</th><th class="num">Livraison</th><th class="num">${sh('total', 'Total')}</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
        : `<p class="muted">${this.list().length ? 'Aucune facture avec ces filtres.' : 'Aucune facture pour l\'instant. Clique sur « ＋ Nouvelle facture » pour saisir ton premier achat.'}</p>`}
        <p class="muted help" style="font-size:.82rem;">Les montants sont ceux réellement payés (TTC). Cette page n'écrit rien dans ton stock ni dans tes prix : c'est ton registre d'achats. Une facture ancienne peut être saisie avec sa vraie date. Clique sur une ligne pour voir le détail.</p>
      </div>`);
  },
  toggle(id) { this._open[id] = !this._open[id]; this.render(); },
  /* Variation de coût d'une ligne : consommable / matière = ancien → nouveau coût du stock ; mastication = prix de la fiche de calcul → dernier prix payé */
  _chgInfo(l) {
    let from = 0, to = 0, unit = '';
    if (l.applied) { from = U.num(l.applied.prevCost); to = U.num(l.applied.newCost); }
    else if (l.priceCmp) { from = U.num(l.priceCmp.fiche); to = U.num(l.priceCmp.paid); unit = l.priceCmp.unit || ''; }
    if (!(from > 0) || Math.abs(to - from) < 0.00005) return null;
    return { from, to, pct: (to - from) / from * 100, unit, fiche: !!l.priceCmp && !l.applied };
  },
  _chg(l) { const i = this._chgInfo(l); return i ? i.pct : 0; },
  _priceCard() {   // variations de coût constatées à l'achat : de quoi savoir quelles fiches de prix revoir
    const rows = [];
    this.list().forEach(p => (p.lines || []).forEach(l => { const c = this._chgInfo(l); if (c) rows.push({ p, l, c }); }));
    if (!rows.length) return '';
    rows.sort((a, b) => (b.p.date || '').localeCompare(a.p.date || ''));
    return `<details class="fold card" ${this._priceOpen ? 'open' : ''} ontoggle="Achats._priceOpen=this.open"><summary><b>💶 Variations de prix constatées (${rows.length})</b> <span class="muted">— coût d'achat différent du précédent (ou de ta fiche prix) : pense à vérifier les fiches concernées</span></summary>
      <div class="fold-body">${rows.slice(0, 30).map(({ p, l, c }) => `<div style="display:grid;grid-template-columns:90px minmax(0,2fr) minmax(0,2fr) 90px;gap:10px;padding:5px 0;border-bottom:1px solid var(--row-border);"><span class="muted">${U.frDate(p.date)}</span><span><b>${U.esc(l.label)}</b> <span class="muted">${U.esc(this.supplierLabel(p))}</span></span><span class="sensitive">${c.fiche ? 'fiche prix ' : ''}${U.eur(c.from, 3)} → ${U.eur(c.to, 3)} HT${c.unit ? ' / ' + U.esc(c.unit) : ''}</span><span class="${c.pct > 0 ? 'neg' : 'pos'}" style="text-align:right;">${c.pct > 0 ? '↑ +' : '↓ '}${Math.round(c.pct * 10) / 10} %</span></div>`).join('')}</div></details>`;
  },

  /* ---------- mastication : réceptions à ranger (lot → plusieurs tailles) ----------
     Ligne mastication liée à un produit du stock + « Réception à ranger » : l.recv = { dist: [{lotId, vId, qty}], loss, pieces, closed, ... }.
     Dans Stock → « ＋ Ajouter un lot », la réception est proposée (n° de lot + DLUO pré-remplis) ; chaque lot ajouté s'inscrit dans dist.
     « Terminer le tri » fige le coût réel par pièce (total de la ligne + livraison ÷ pièces triées) sur les lots concernés. */
  _applyRecv(rec, old, notes) {
    const eff = this._effHT(rec);
    rec.lines.forEach((l, i) => {
      if (l.cat !== 'mastication') return;
      const oldL = old && (old.lines || []).find(x => x.id === l.id);
      if (l.toStock && l.ref) { if (!l.recv) l.recv = (oldL && oldL.recv) || { dist: [], loss: 0, closed: false }; }
      else if (l.recv && !(l.recv.dist || []).length) delete l.recv;   // décochée et rien de rangé : on oublie
      // comparaison avec la fiche de calcul de prix (même unité seulement : kg ↔ « kilo », pièce ↔ pièce)
      delete l.priceCmp;
      const sp = (Store.state.stockM || []).find(x => x.id === l.ref), cat = sp && sp.catalogId ? (Store.state.catalogM || []).find(x => x.id === sp.catalogId) : null;
      if (!cat || !(U.num(l.qty) > 0)) return;
      const b = Pricing.baseUnitCost(cat), u = String(l.unit || '').toLowerCase(), perUnitHT = eff[i] / U.num(l.qty);
      const kg = u === 'kg' && b.unit === 'kilo', pc = (u === 'pièce' || u === 'piece' || u === 'pc') && b.unit !== 'kilo';
      if (!(kg || pc) || !(b.unitHT > 0)) return;
      l.priceCmp = { fiche: Math.round(b.unitHT * 10000) / 10000, paid: Math.round(perUnitHT * 10000) / 10000, unit: kg ? 'kg' : 'pièce' };
      const ci = this._chgInfo(l);
      if (ci) notes.push(`💶 ${l.label} : fiche prix ${U.eur(ci.from, 3)} → payé ${U.eur(ci.to, 3)} HT/${l.priceCmp.unit} (${ci.pct > 0 ? '↑ +' : '↓ '}${Math.round(ci.pct * 10) / 10} %) — vérifie la fiche`);
    });
  },
  /* Réceptions en attente de rangement pour un produit du stock (proposées dans « ＋ Ajouter un lot ») */
  pendingFor(pId) {
    const out = [];
    this.list().forEach(p => (p.lines || []).forEach(l => { if (l.cat === 'mastication' && l.ref === pId && l.recv && !l.recv.closed) out.push({ pid: p.id, lid: l.id, date: p.date, lot: l.lot || '', dluo: l.dluo || '', label: `${U.frDate(p.date)} · ${this.supplierLabel(p)} · ${U.qty(l.qty)} ${l.unit || ''}${l.lot ? ' · lot ' + l.lot : ''}${l.dluo ? ' · DLUO ' + U.frDate(l.dluo) : ''}` }); }));
    return out.sort((a, b) => b.date.localeCompare(a.date));
  },
  /* Poids moyen (g) d'une pièce d'après le dernier tri terminé d'un produit — sert à estimer le poids des colis (ship.js) */
  avgPieceG(pId) {
    let best = null;
    this.list().forEach(p => (p.lines || []).forEach(l => { if (l.cat === 'mastication' && l.ref === pId && l.recv && l.recv.closed && U.num(l.recv.avgG) > 0 && (!best || (l.recv.closedAt || 0) > best.t)) best = { t: l.recv.closedAt || 0, g: U.num(l.recv.avgG) }; }));
    return best ? best.g : 0;
  },
  snapPurchase(pid) { const p = this.list().find(x => x.id === pid); return p ? Store.snapshot('purchases', p) : null; },
  addDist(pid, lid, entry) {
    const p = this.list().find(x => x.id === pid), l = p && p.lines.find(x => x.id === lid); if (!l || !l.recv) return;
    (l.recv.dist = l.recv.dist || []).push(entry); Store.save('purchases');
  },
  _recvCard() {
    const rows = [];
    this.list().forEach(p => (p.lines || []).forEach(l => { if (l.cat === 'mastication' && l.recv && !l.recv.closed) rows.push({ p, l }); }));
    if (!rows.length) return '';
    rows.sort((a, b) => b.p.date.localeCompare(a.p.date));
    const vlabel = (pId, vId) => { const sp = Store.state.stockM.find(x => x.id === pId), v = sp && sp.variants.find(x => x.id === vId); return v ? Pricing.labelVariant(v) : '?'; };
    return `<div class="card" style="border-left:4px solid var(--caramel);"><h2>📥 Réceptions à ranger (${rows.length})</h2>
      <p class="muted help" style="font-size:.85rem;">Pour chaque achat de mastication : dans Stock → le produit → « ＋ Ajouter un lot », choisis la réception (n° de lot et DLUO sont pré-remplis) et saisis les quantités d'une taille. Recommence pour chaque taille, puis clique « Terminer le tri » : le coût réel par pièce est calculé et appliqué aux lots.</p>
      ${rows.map(({ p, l }) => {
        const r = l.recv, dist = r.dist || [], sum = dist.reduce((a, d) => a + U.num(d.qty), 0);
        const by = {}; dist.forEach(d => { const k = vlabel(l.ref, d.vId); by[k] = (by[k] || 0) + U.num(d.qty); });
        return `<div style="padding:8px 0;border-bottom:1px solid var(--row-border);display:grid;grid-template-columns:minmax(0,2fr) minmax(0,2fr) auto;gap:10px;align-items:center;">
          <div><b>${U.esc(l.label)}</b><div class="muted" style="font-size:.82rem;">${U.frDate(p.date)} · ${U.esc(this.supplierLabel(p))} · ${U.qty(l.qty)} ${U.esc(l.unit || '')}${l.lot ? ' · lot ' + U.esc(l.lot) : ''}${l.dluo ? ' · DLUO ' + U.frDate(l.dluo) : ''}</div></div>
          <div>${dist.length ? Object.entries(by).map(([k, q]) => `<span class="badge info">${U.esc(k)} : ${U.qty(q)}</span>`).join(' ') + ` <span class="muted">= ${U.qty(sum)} pièce(s)</span>` : '<span class="muted">rien de rangé pour l\'instant</span>'}</div>
          <div style="white-space:nowrap;text-align:right;"><a class="btn btn-ghost btn-sm" style="text-decoration:none;" href="#/stock/mastication/${l.ref}">Ouvrir le produit</a> <button class="btn-cta btn-sm" onclick="Achats.closeRecv('${p.id}','${l.id}')" ${dist.length ? '' : 'disabled'}>✔ Terminer le tri</button></div></div>`;
      }).join('')}</div>`;
  },
  closeRecv(pid, lid) {
    const p = this.list().find(x => x.id === pid), l = p && p.lines.find(x => x.id === lid); if (!l || !l.recv) return;
    const r = l.recv, dist = r.dist || [], sum = dist.reduce((a, d) => a + U.num(d.qty), 0), eff = this._effHT(p)[p.lines.indexOf(l)];
    const kg = String(l.unit || '').toLowerCase() === 'kg';
    U.modal({ title: 'Terminer le tri — ' + U.esc(l.label), okLabel: 'Terminer le tri', body: `
      <p>${U.qty(l.qty)} ${U.esc(l.unit || '')} acheté(s) · ${U.qty(sum)} pièce(s) rangée(s) en stock.</p>
      <div class="frow"><div class="fg"><label>Pièces triées au total</label><input id="rc_pieces" type="number" step="1" min="1" value="${sum}"></div>
      <div class="fg"><label>Pertes / déchets (${kg ? 'kg' : 'pièces'}, option)</label><input id="rc_loss" type="number" step="any" min="0" value="${U.num(r.loss) || ''}" placeholder="0"></div></div>
      <p class="muted">Le coût réel par pièce = total HT de la ligne (livraison comprise, ${U.eur(eff)}) ÷ pièces triées. Il est appliqué aux lots de cette réception.${kg ? ' Le poids moyen par pièce est calculé aussi.' : ''}</p>`,
      onOk: () => {
        const pieces = U.numVal('rc_pieces'), loss = U.numVal('rc_loss');
        if (!(pieces > 0)) { U.toast('Indique le nombre de pièces triées.', true); return false; }
        const ht = Math.round(eff / pieces * 10000) / 10000;
        const snaps = [Store.snapshot('purchases', p)], sp = Store.state.stockM.find(x => x.id === l.ref);
        if (sp) snaps.push(Store.snapshot('stockM', sp));
        let n = 0;
        dist.forEach(d => { (sp ? sp.variants : []).forEach(v => (v.lots || []).forEach(lot => { if (lot.id === d.lotId) { lot.costUnit = ht; n++; } })); });
        Object.assign(r, { closed: true, closedAt: Date.now(), pieces, loss, costPerPiece: ht, avgG: kg ? Math.round((U.num(l.qty) - loss) * 1000 / pieces) : 0 });
        const entry = Store.log('achat', `Tri terminé — ${l.label} (${U.qty(pieces)} pièces, ${U.eur(ht, 3)} HT / pièce)`, { type: 'restoreBatch', data: snaps });
        Store.save('purchases', 'stockM'); U.closeModal(); this.render();
        U.toast(`Tri terminé : ${U.eur(ht, 3)} HT / pièce${r.avgG ? ' · ' + r.avgG + ' g en moyenne' : ''} · ${n} lot(s) mis à jour.`, false, entry.id);
      } });
  },
  _detailRow(p) {
    const lines = (p.lines || []).map(l => {
      const c = this.cat(l.cat);
      return `<div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr) auto;gap:10px;padding:5px 0;border-bottom:1px solid var(--row-border);">
        <span>${c.ico} <b>${U.esc(l.label)}</b>${l.lot ? ` <span class="badge info">lot ${U.esc(l.lot)}${l.dluo ? ' · DLUO ' + U.frDate(l.dluo) : ''}</span>` : ''}${l.applied ? ` <span class="badge info" title="Quantité ajoutée au stock à l'enregistrement">📥 +${U.qty(l.applied.qty)} en stock</span>` : ''}${this._chg(l) ? ` <span class="badge warn" title="${this._chgInfo(l).fiche ? 'Fiche prix' : 'Coût HT par unité'} : ${U.eur(this._chgInfo(l).from, 3)} → ${U.eur(this._chgInfo(l).to, 3)}">💶 prix ${this._chg(l) > 0 ? '↑ +' : '↓ '}${Math.round(this._chg(l) * 10) / 10} %</span>` : ''}${l.recv ? (l.recv.closed ? ` <span class="badge info" title="Coût réel figé sur les lots">✔ tri terminé · ${U.qty(l.recv.pieces)} pièces · ${U.eur(l.recv.costPerPiece, 3)} HT/pièce${l.recv.avgG ? ' · ' + l.recv.avgG + ' g/pièce' : ''}</span>` : ` <span class="badge warn">📥 à ranger${(l.recv.dist || []).length ? ' · ' + (l.recv.dist || []).length + ' lot(s) rangé(s)' : ''}</span>`) : ''}${U.num(l.years) ? ` <span class="badge info">amorti sur ${U.num(l.years)} an(s)</span>` : ''}</span>
        <span class="muted">${c.detail ? U.qty(l.qty) + ' ' + U.esc(l.unit || '') + ' × ' + U.eur(l.price) : c.label}</span>
        <span class="sensitive" style="text-align:right;white-space:nowrap;"><b>${U.eur(this.lineTotal(l))}</b></span></div>`;
    }).join('');
    const ht = this.isHT(p) ? ' HT' : '';
    const extra = [this.isHT(p) ? 'Prix saisis HT' : '', U.num(p.shipping) ? `Livraison : ${U.eur(p.shipping)}${ht}` : '', U.num(p.discount) ? `Remise : − ${U.eur(p.discount)}${ht}` : '', this.isHT(p) ? 'TVA : ' + ((p.vat || []).map(v => U.qty(v.rate) + ' % = ' + U.eur(v.amount)).join(' + ') || '0 €') + ` → payé ${U.eur(this.grandTotal(p))} TTC` : ''].filter(Boolean).join(' · ');
    return `<tr class="sale-detail"><td colspan="9" style="text-align:left;">${lines}${extra ? `<div class="muted sensitive" style="padding-top:6px;">${extra}</div>` : ''}${p.note ? `<div class="muted" style="padding-top:4px;font-style:italic;">📝 ${U.esc(p.note)}</div>` : ''}</td></tr>`;
  },

  /* ---------- actions sur les factures ---------- */
  create() { this._d = this._newPurchase(); this._editId = ''; this._dirty = false; this.mode = 'edit'; this._saveDraft(); this.render(); window.scrollTo({ top: 0 }); },
  edit(id) {
    const p = this.list().find(x => x.id === id); if (!p) return;
    this._d = JSON.parse(JSON.stringify(p)); this._d.lines.forEach(l => { if (!l.id) l.id = U.uid(); });
    this._editId = id; this._dirty = false; this.mode = 'edit'; this._saveDraft(); this.render(); window.scrollTo({ top: 0 });
  },
  dup(id) {
    const p = this.list().find(x => x.id === id); if (!p) return;
    const d = JSON.parse(JSON.stringify(p));
    Object.assign(d, { id: U.uid(), date: U.today(), invoiceNo: '', reimbursed: '', note: '' }); delete d.created; delete d.updated; delete d.total;
    d.lines.forEach(l => { l.id = U.uid(); l.lot = ''; l.dluo = ''; delete l.applied; });
    this._d = d; this._editId = ''; this._dirty = true; this.mode = 'edit'; this._saveDraft(); this.render(); window.scrollTo({ top: 0 });
    U.toast('Facture dupliquée : change la date, le n° de facture et les prix si besoin.');
  },
  async remove(id) {
    const p = this.list().find(x => x.id === id); if (!p) return;
    if (!await U.confirm(`Supprimer la facture ${p.invoiceNo ? 'n° ' + p.invoiceNo + ' ' : ''}de ${this.supplierLabel(p)} du ${U.frDate(p.date)} (${U.eur(this.grandTotal(p))}) ?`, { okLabel: 'Supprimer' })) return;
    const snaps = [Store.snapshot('purchases', p)], touched = (p.lines || []).filter(l => l.applied).length;
    this._revertStock(p, snaps);
    Store.state.purchases = this.list().filter(x => x.id !== id);
    const entry = Store.log('achat', `Facture supprimée — ${this.supplierLabel(p)} ${U.frDate(p.date)}`, { type: 'restoreBatch', data: snaps });
    Store.save('purchases', 'consumables', 'materials'); this.reconcileEquip(); this.render();
    U.toast('Facture supprimée' + (touched ? ' · stock remis comme avant l\'achat.' : '.'), false, entry.id);
  },
  setReimbursed(id, on) {
    const p = this.list().find(x => x.id === id); if (!p) return;
    const snap = Store.snapshot('purchases', p);
    p.reimbursed = on ? U.today() : '';
    const entry = Store.commitSnapshot(snap, 'achat', `${on ? 'Remboursé' : 'À rembourser'} — ${this.supplierLabel(p)} ${U.frDate(p.date)}`);
    Store.save('purchases'); this.render(); U.toast(on ? 'Marqué comme remboursé.' : 'Remis « à rembourser ».', false, entry.id);
  },

  /* ---------- éditeur ---------- */
  _touch() { this._dirty = true; this._saveDraft(); },
  setHead(k, v) {
    const d = this._d; d[k] = (k === 'shipping' || k === 'discount') ? U.num(v) : v; this._touch();
    if (k === 'shipping' || k === 'discount') this._refreshTotals();
    if (k === 'taxMode') { if (v === 'ht' && !(d.vat || []).length) d.vat = [{ rate: U.num(Store.state.settings.vatRate ?? 20), amount: 0, auto: true }]; this._autoVat(); this._touch(); this.render(); }
    if (k === 'paidBy') { if (v === 'pro') d.reimbursed = ''; this.render(); }
    if (k === 'payment') this.render();
  },
  /* TVA en HT : une seule ligne « auto » = base HT × taux (modifiable) ; dès qu'on tape un montant ou qu'on ajoute un taux, c'est à la main */
  _autoVat() { const d = this._d; if (!d || !this.isHT(d)) return; const v = d.vat || []; if (v.length === 1 && v[0].auto) v[0].amount = this.r2(this.base(d) * U.num(v[0].rate) / 100); },
  setVat(i, f, val) {
    const v = this._d.vat[i]; if (!v) return; v[f] = U.num(val);
    if (f === 'amount') v.auto = false; else this._autoVat();
    this._touch(); this._refreshTotals();
    if (f === 'rate') { const e = document.getElementById('ach_vatamt_' + i); if (e) e.value = v.amount || ''; }
  },
  addVat() { const d = this._d; d.vat = d.vat || []; d.vat.forEach(v => v.auto = false); d.vat.push({ rate: d.vat.length ? 10 : U.num(Store.state.settings.vatRate ?? 20), amount: 0, auto: false }); this._touch(); this.render(); },
  delVat(i) { this._d.vat.splice(i, 1); this._touch(); this.render(); },
  _pickSup(sel) {
    const kind = sel.value === '__newP' ? 'P' : sel.value === '__newO' ? 'O' : '';
    if (!kind) { this._d.supplierId = sel.value; this._touch(); return; }
    sel.value = this._d.supplierId || '';
    U.modal({ title: kind === 'P' ? 'Nouveau fournisseur de produits' : 'Nouveau fournisseur (autre)', body: `<div class="fg"><label>Nom du fournisseur</label><input id="ach_newsup" placeholder="${kind === 'P' ? 'ex : un nouvel éleveur' : 'ex : Amazon, magasin de bricolage…'}" onkeydown="if(event.key==='Enter')document.getElementById('modalOk').click()"></div><p class="muted" style="font-size:.82rem;">${kind === 'P' ? 'Il rejoint la liste de tes fournisseurs de mastication / matières / consommables (aussi utilisée dans les fiches prix).' : 'Il rejoint la liste des fournisseurs « autres » (outillage, équipement, frais généraux), séparée de celle des produits.'}</p>`, okLabel: 'Ajouter',
      onOk: () => {
        const n = U.val('ach_newsup').trim(); if (!n) { U.toast('Donne un nom au fournisseur.', true); return false; }
        const S = Store.state.settings, list = kind === 'P' ? S.suppliers : this.others(); let s = list.find(x => x.name.toLowerCase() === n.toLowerCase());
        if (!s) { s = { id: U.uid(), name: n }; list.push(s); Store.save('settings'); }
        this._d.supplierId = s.id; this._touch(); this.render();
      } });
    setTimeout(() => { const i = document.getElementById('ach_newsup'); if (i) i.focus(); }, 50);
  },
  addLine() { const l = this._newLine(this._d.lines.length ? this._d.lines[this._d.lines.length - 1].cat : this._lastCat); this._d.lines.push(l); this._touch(); this.render(); },
  delLine(i) { this._d.lines.splice(i, 1); if (!this._d.lines.length) this._d.lines.push(this._newLine(this._lastCat)); this._touch(); this.render(); },
  setLineCat(i, v) {
    const l = this._d.lines[i], c = this.cat(v);
    if (l.cat !== c.id) { if (l.cat === 'mastication' && l.unit === 'kg') l.unit = ''; l.cat = c.id; l.ref = ''; if (!c.detail) { l.qty = 1; l.unit = ''; } else if (!l.unit && c.id === 'mastication') l.unit = 'kg'; }
    this._lastCat = c.id; this._touch(); this.render();
  },
  pickLink(i, v) {
    const l = this._d.lines[i], c = this.cat(l.cat); l.ref = v;
    l.toStock = !!v && (c.link === 'C' || c.link === 'T' || c.link === 'M') && this._recent(this._d.date);   // cochée par défaut, sauf facture ancienne
    if (v) {
      const name = this.itemName(c.link, v); if (!String(l.label || '').trim() && name) l.label = name;
      if (c.link === 'T') { const m = Store.state.materials.find(x => x.id === v); if (m && !l.unit) l.unit = this.unitFrom(m.unit); }
      if (c.link === 'C') { const k = Store.state.consumables.find(x => x.id === v); if (k && !l.unit) l.unit = this.unitFrom(k.unit); }
    }
    this._touch(); this.render();
  },
  setToStock(i, on) { this._d.lines[i].toStock = !!on; this._touch(); this.render(); },
  setText(i, k, v) { this._d.lines[i][k] = String(v || '').trim(); this._touch(); },
  setNum(i, k, v) { this._d.lines[i][k] = U.num(v); this._touch(); this._refreshTotals(); },
  _refreshTotals() {
    const d = this._d; if (!d) return;
    d.lines.forEach((l, i) => { const e = document.getElementById('ach_lt_' + i); if (e) e.textContent = U.eur(this.lineTotal(l)); });
    d.lines.forEach((l, i) => { const e = document.getElementById('ach_pv_' + i); if (e) e.textContent = this._pvText(l); });
    this._autoVat();
    if ((d.vat || []).length === 1 && d.vat[0].auto) { const e = document.getElementById('ach_vatamt_0'); if (e && document.activeElement !== e) e.value = d.vat[0].amount || ''; }
    const s = document.getElementById('ach_sub'), t = document.getElementById('ach_tot'), b = document.getElementById('ach_base'), v = document.getElementById('ach_vat');
    if (s) s.textContent = U.eur(this.subTotal(d)); if (t) t.textContent = U.eur(this.grandTotal(d));
    if (b) b.textContent = U.eur(this.base(d)); if (v) v.textContent = U.eur(this.vatSum(d));
  },
  _linkOpts(kind, cur) {   // trois colonnes comme le choix de consommable des Ventes : nom · dimensions / variante · stock (et coût)
    let items;
    if (kind === 'M') items = (Store.state.stockM || []).map(p => {
      const n = (p.variants || []).filter(v => !Stock.isVirtual(p, v)).reduce((t, v) => t + (v.lots || []).reduce((q, l) => q + U.num(l.qtyGeneral) + U.num(l.qtyEvent), 0), 0);
      return { id: p.id, a: p.name, b: p.meatType || '', c: 'stock ' + U.qty(n) };
    });
    else if (kind === 'T') items = (Store.state.materials || []).map(m => ({ id: m.id, a: m.product || m.name || '', b: m.product ? (m.variant || m.name || '') : (m.variant || ''), c: 'stock ' + U.qty(m.qty) + ' ' + this.unitFrom(m.unit) + (U.num(m.costUnit) ? ' · ' + U.eur(m.costUnit) + '/u' : '') }));
    else items = (Store.state.consumables || []).map(c => ({ id: c.id, a: c.name, b: Stock.consoDims(c), c: 'stock ' + U.qty(c.qty) + (U.num(c.costUnit) ? ' · ' + U.eur(c.costUnit) + '/u' : ''), vol: Stock._dimVolume(Stock.consoDims(c)) }));
    items.sort((x, y) => U.sortFr(x.a, y.a) || (U.num(x.vol) - U.num(y.vol)) || U.sortFr(x.b, y.b));
    return `<option value="">— choisir (optionnel) —</option>` + items.map(o => `<option value="${U.esc(o.id)}" data-a="${U.esc(o.a)}" data-b="${U.esc(o.b)}" data-c="${U.esc(o.c)}" ${o.id === cur ? 'selected' : ''}>${U.esc([o.a, o.b, o.c].filter(Boolean).join(' — '))}</option>`).join('');
  },
  _pvText(l) {
    const pv = this._stockPreview(l); if (!pv) return '';
    const pack = this._packOf(l, pv.it);
    return (l.applied ? '· déjà ajouté (+' + U.qty(l.applied.qty) + '), remis à jour à l\'enregistrement · ' : '') + 'stock actuel ' + U.qty(pv.cur) + ' → ' + U.qty(pv.after) + (pack > 1 ? ' (lots de ' + U.qty(pack) + ')' : '');
  },
  _recvBox(l, i) {
    return `<div class="fg" style="grid-column:span 2;"><label>Stock</label><label class="ach-chk"><input type="checkbox" ${l.toStock ? 'checked' : ''} onchange="Achats.setToStock(${i},this.checked)"> 📥 Réception à ranger <span class="muted">${l.recv ? (l.recv.closed ? '· tri terminé' : '· ' + (l.recv.dist || []).length + ' lot(s) déjà rangé(s)') : 'le lot sera proposé dans Stock → « ＋ Ajouter un lot »'}</span></label></div>`;
  },
  _stockBox(l, i) {
    if (!this._stockPreview(l)) return '';
    return `<div class="fg" style="grid-column:span 2;"><label>Stock</label><label class="ach-chk"><input type="checkbox" ${l.toStock ? 'checked' : ''} onchange="Achats.setToStock(${i},this.checked)"> 📥 Ajouter au stock <span class="muted" id="ach_pv_${i}">${this._pvText(l)}</span></label></div>`;
  },
  _lineHTML(l, i) {
    const c = this.cat(l.cat);
    const catSel = `<select onchange="Achats.setLineCat(${i},this.value)">${this.CATS.map(x => `<option value="${x.id}" ${x.id === l.cat ? 'selected' : ''}>${x.ico} ${x.label}</option>`).join('')}</select>`;
    const label = `<input value="${U.esc(l.label)}" placeholder="${c.detail ? 'désignation' : 'ex : visseuse, assurance, timbres…'}" onchange="Achats.setText(${i},'label',this.value)">`;
    let inner;
    if (!c.detail) {
      inner = `<div class="fg"><label>Catégorie</label>${catSel}</div><div class="fg" style="grid-column:span 2;"><label>Désignation</label>${label}</div>
        <div class="fg"><label>Montant (€ ${this._d && this.isHT(this._d) ? 'HT' : 'TTC'})</label><input type="number" step="any" value="${l.price || ''}" placeholder="0" oninput="Achats.setNum(${i},'price',this.value)"></div>`;
    } else {
      inner = `<div class="fg"><label>Catégorie</label>${catSel}</div>
        ${c.link ? `<div class="fg"><label>${c.link === 'M' ? 'Produit du stock' : c.link === 'T' ? 'Matière du stock' : 'Consommable du stock'}</label><select onchange="Achats.pickLink(${i},this.value)">${this._linkOpts(c.link, l.ref)}</select></div>` : ''}
        <div class="fg" style="grid-column:span 2;"><label>Désignation</label>${label}</div>
        ${(c.link === 'C' || c.link === 'T') && l.ref ? this._stockBox(l, i) : c.link === 'M' && l.ref ? this._recvBox(l, i) : ''}
        <div class="fg"><label>Quantité</label><input type="number" step="any" value="${l.qty || ''}" oninput="Achats.setNum(${i},'qty',this.value)"></div>
        <div class="fg"><label>Unité</label><select onchange="Achats.setText(${i},'unit',this.value)">${(this.UNITS.includes(l.unit) || !l.unit ? this.UNITS : this.UNITS.concat([l.unit])).map(u => `<option value="${U.esc(u)}" ${u === (l.unit || (c.id === 'mastication' ? 'kg' : 'pièce')) ? 'selected' : ''}>${U.esc(u)}</option>`).join('')}</select></div>
        <div class="fg"><label>Prix unitaire (€ ${this._d && this.isHT(this._d) ? 'HT' : 'TTC'})</label><input type="number" step="any" value="${l.price || ''}" placeholder="0" oninput="Achats.setNum(${i},'price',this.value)"></div>
        ${c.id === 'mastication' ? `<div class="fg"><label>N° de lot</label><input value="${U.esc(l.lot || '')}" placeholder="n° de lot du fournisseur" onchange="Achats.setText(${i},'lot',this.value)"></div><div class="fg"><label>DLUO</label><input type="date" value="${U.esc(l.dluo || '')}" onchange="Achats.setText(${i},'dluo',this.value)"></div>` : ''}
        ${c.id === 'equipement' ? `<div class="fg"><label>Amortissement (ans, optionnel)</label><input type="number" step="any" min="0" value="${l.years || ''}" placeholder="ex : 5" onchange="Achats.setNum(${i},'years',this.value)"></div>` : ''}
        <div class="fg"><label>Total ligne</label><div class="ach-tot sensitive" id="ach_lt_${i}">${U.eur(this.lineTotal(l))}</div></div>`;
    }
    return `<div class="ach-line"><div class="ach-grid">${inner}</div><div style="text-align:right;margin-top:4px;"><button class="btn-icon" title="Retirer cette ligne" onclick="Achats.delLine(${i})">🗑️</button></div></div>`;
  },
  renderEditor() {
    const d = this._d, sups = (Store.state.settings.suppliers || []).slice().sort((a, b) => U.sortFr(a.name, b.name)), oth = this.others().slice().sort((a, b) => U.sortFr(a.name, b.name));
    const supOpts = `<option value="">— choisir —</option><optgroup label="Fournisseurs de produits (mastication, matières, consommables)">${sups.map(s => `<option value="${s.id}" ${s.id === d.supplierId ? 'selected' : ''}>${U.esc(s.name)}</option>`).join('')}</optgroup>${oth.length ? `<optgroup label="Autres fournisseurs (outillage, équipement, frais…)">${oth.map(s => `<option value="${s.id}" ${s.id === d.supplierId ? 'selected' : ''}>${U.esc(s.name)}</option>`).join('')}</optgroup>` : ''}<optgroup label="Ajouter"><option value="__newP">＋ Nouveau fournisseur de produits…</option><option value="__newO">＋ Nouveau fournisseur « autre »…</option></optgroup>`;
    const mode = [['ttc', 'TTC'], ['ht', 'HT (TVA détaillée en bas)']].map(p => `<button type="button" class="${(d.taxMode || 'ttc') === p[0] ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Achats.setHead('taxMode','${p[0]}')">${p[1]}</button>`).join('');
    const pay = this.PAYS.map(p => `<button type="button" class="${d.payment === p[0] ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Achats.setHead('payment','${p[0]}')">${p[1]}</button>`).join('');
    const who = [['pro', '🏢 Compte pro'], ['perso', '💳 Carte perso (à me rembourser)']].map(p => `<button type="button" class="${d.paidBy === p[0] ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Achats.setHead('paidBy','${p[0]}')">${p[1]}</button>`).join('');
    App.mount(`
      <div class="view-title"><h1>${this._editId ? 'Modifier la facture' : 'Nouvelle facture'}</h1><span class="sub">achat fournisseur</span></div>
      <div class="card">
        <div class="grid c4">
          <div class="fg"><label>Date de la facture</label><input type="date" value="${U.esc(d.date)}" onchange="Achats.setHead('date',this.value)"></div>
          <div class="fg"><label>Fournisseur</label><select onchange="Achats._pickSup(this)">${supOpts}</select></div>
          <div class="fg"><label>N° de facture / devis</label><input value="${U.esc(d.invoiceNo)}" placeholder="ex : FA-2026-0412" onchange="Achats.setHead('invoiceNo',this.value.trim())"></div>
          <div class="fg"><label>Note (option)</label><input value="${U.esc(d.note)}" placeholder="ex : commande de rentrée" onchange="Achats.setHead('note',this.value)"></div>
        </div>
        <div class="frow mt" style="gap:18px;align-items:center;">
          <div style="flex:0 0 auto;"><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:4px;">Prix saisis sur la facture <span class="muted help">TTC : tu tapes ce que tu as payé (taux de TVA global des Paramètres pour le coût HT). HT : le fournisseur donne les prix hors taxe et la TVA par taux en bas de page (10 %, 20 %…) : tu la saisis en bas, elle est répartie au prorata sur les lignes.</span></div><div style="display:flex;gap:6px;flex-wrap:wrap;">${mode}</div></div>
          <div style="flex:0 0 auto;"><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:4px;">Moyen de paiement</div><div style="display:flex;gap:6px;flex-wrap:wrap;">${pay}</div></div>
          <div style="flex:0 0 auto;"><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:4px;">Payé avec</div><div style="display:flex;gap:6px;flex-wrap:wrap;">${who}</div></div>
          ${d.paidBy === 'perso' ? `<div class="fg" style="max-width:200px;"><label>Remboursé le (option)</label><input type="date" value="${U.esc(d.reimbursed || '')}" onchange="Achats.setHead('reimbursed',this.value)"></div>` : ''}
        </div>
      </div>
      <div class="card">
        <h2>🧾 Lignes de la facture</h2>
        <p class="muted help" style="font-size:.85rem;">Mastication, matière première, consommable et investissement se détaillent ligne par ligne (quantité × prix). Outillage et frais généraux : un seul montant. Pour la mastication, tu peux déjà noter le n° de lot et la DLUO : ils te seront proposés quand tu rentreras ces produits dans le stock. Lier la ligne à un produit du stock est facultatif.</p>
        ${d.lines.map((l, i) => this._lineHTML(l, i)).join('')}
        <button class="btn-ghost btn-sm" onclick="Achats.addLine()">＋ Ajouter une ligne</button>
        <div class="ach-sum">
          <div><span class="muted">Sous-total ${this.isHT(d) ? 'HT' : ''}</span> <b class="sensitive" id="ach_sub">${U.eur(this.subTotal(d))}</b></div>
          <div class="fg"><label>Frais de livraison (€ ${this.isHT(d) ? 'HT' : 'TTC'})</label><input type="number" step="any" value="${d.shipping || ''}" placeholder="0" oninput="Achats.setHead('shipping',this.value)"></div>
          <div class="fg"><label>Remise (€ ${this.isHT(d) ? 'HT' : 'TTC'})</label><input type="number" step="any" value="${d.discount || ''}" placeholder="0" oninput="Achats.setHead('discount',this.value)"></div>
          ${this.isHT(d) ? `<div><span class="muted">Total HT</span> <b class="sensitive" id="ach_base">${U.eur(this.base(d))}</b></div>` : ''}
          <div class="ach-grand">Total payé <b class="sensitive" id="ach_tot">${U.eur(this.grandTotal(d))}</b></div>
        </div>
        ${this.isHT(d) ? `<div class="ach-vat"><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:6px;">TVA indiquée en bas de la facture</div>
          ${(d.vat || []).map((v, i) => `<div class="frow" style="align-items:center;gap:8px;margin-bottom:6px;max-width:460px;"><div class="fg" style="max-width:110px;"><input type="number" step="any" min="0" value="${v.rate}" onchange="Achats.setVat(${i},'rate',this.value)" title="Taux (%)"></div><span>% →</span><div class="fg" style="max-width:150px;"><input id="ach_vatamt_${i}" type="number" step="any" min="0" value="${v.amount || ''}" placeholder="montant TVA" oninput="Achats.setVat(${i},'amount',this.value)"></div><span>€</span><button class="btn-icon" title="Retirer ce taux" onclick="Achats.delVat(${i})">🗑️</button></div>`).join('')}
          <button class="btn-ghost btn-sm" onclick="Achats.addVat()">＋ Ajouter un taux de TVA</button> <span class="muted">TVA totale : <b class="sensitive" id="ach_vat">${U.eur(this.vatSum(d))}</b></span></div>` : ''}
        <div class="frow mt">
          <button class="btn-ok" style="flex:0 0 auto;" onclick="Achats.save()">✅ Enregistrer la facture</button>
          <button class="btn-ghost" style="flex:0 0 auto;" onclick="Achats.cancel()">Annuler</button>
        </div>
      </div>`);
  },
  async cancel() {
    if (this._dirty && !await U.confirm('Abandonner cette facture ? Ce que tu as saisi sera perdu.', { okLabel: 'Abandonner', title: '⚠️ Abandonner ?' })) return;
    this._d = null; this._editId = ''; this._dirty = false; this.mode = 'list'; this._clearDraft(); this.render();
  },
  save() {
    const d = this._d; if (!d) return;
    if (!d.date) { U.toast('Indique la date de la facture.', true); return; }
    if (!d.supplierId) { U.toast('Choisis le fournisseur.', true); return; }
    const lines = [];
    for (let i = 0; i < d.lines.length; i++) {
      const l = d.lines[i], c = this.cat(l.cat);
      const lab = String(l.label || '').trim() || this.itemName(c.link, l.ref);
      if (!lab && !U.num(l.price) && !l.ref) continue;   // ligne vide : ignorée
      if (!lab) { U.toast(`Ligne ${i + 1} : indique une désignation.`, true); return; }
      lines.push({ id: l.id || U.uid(), cat: c.id, ref: l.ref || '', label: lab, qty: c.detail ? U.num(l.qty) || 0 : 1, unit: c.detail ? String(l.unit || '').trim() : '', price: U.num(l.price), lot: c.id === 'mastication' ? String(l.lot || '').trim() : '', dluo: c.id === 'mastication' ? (l.dluo || '') : '', years: c.id === 'equipement' ? U.num(l.years) : 0, toStock: !!l.toStock && !!l.ref && (c.id === 'conso' || c.id === 'matiere' || c.id === 'mastication'), ...(l.recv ? { recv: l.recv } : {}) });
    }
    if (!lines.length) { U.toast('Ajoute au moins une ligne avec un montant.', true); return; }
    this._autoVat();
    const rec = { id: this._editId || d.id, date: d.date, supplierId: d.supplierId, taxMode: d.taxMode === 'ht' ? 'ht' : 'ttc', vat: d.taxMode === 'ht' ? (d.vat || []).filter(v => U.num(v.amount) > 0 || U.num(v.rate) > 0).map(v => ({ rate: U.num(v.rate), amount: this.r2(v.amount), auto: !!v.auto })) : [], invoiceNo: String(d.invoiceNo || '').trim(), payment: d.payment || '', paidBy: d.paidBy || 'pro', reimbursed: d.paidBy === 'perso' ? (d.reimbursed || '') : '', shipping: U.num(d.shipping), discount: U.num(d.discount), note: String(d.note || '').trim(), lines };
    rec.total = this.grandTotal(rec);
    // doublons : même n° de facture chez le même fournisseur, ou même fournisseur + date + montant (alerte non bloquante)
    const msgs = [], others = this.list().filter(p => p.id !== rec.id && p.supplierId === rec.supplierId);
    if (rec.invoiceNo && others.some(p => p.invoiceNo && p.invoiceNo.toLowerCase() === rec.invoiceNo.toLowerCase())) msgs.push(`Le n° « ${rec.invoiceNo} » existe déjà chez ${this.supplierLabel(rec)}.`);
    else if (others.some(p => p.date === rec.date && Math.abs(this.grandTotal(p) - rec.total) < 0.005)) msgs.push(`Une facture de ${this.supplierLabel(rec)} du ${U.frDate(rec.date)} au même montant (${U.eur(rec.total)}) existe déjà.`);
    if (!U.dupGate(msgs, () => Achats.save())) return;
    const old = this._editId ? this.list().find(p => p.id === this._editId) : null;
    const snaps = [], notes = [];
    if (old) { snaps.push(Store.snapshot('purchases', old)); this._revertStock(old, snaps); }   // on retire d'abord l'effet de l'ancienne version
    else snaps.push({ domain: 'purchases', id: rec.id, before: null });
    this._applyStock(rec, snaps, notes);
    this._applyRecv(rec, old, notes);
    if (old) { rec.created = old.created || Date.now(); rec.updated = Date.now(); Object.keys(old).forEach(k => delete old[k]); Object.assign(old, rec); }
    else { rec.created = Date.now(); this.list().push(rec); }
    const entry = Store.log('achat', (old ? 'Facture modifiée — ' : 'Facture ajoutée — ') + `${this.supplierLabel(rec)} ${U.frDate(rec.date)} (${U.eur(rec.total)})`, { type: 'restoreBatch', data: snaps });
    Store.save('purchases', 'consumables', 'materials'); this.reconcileEquip();
    this._lastCat = lines[lines.length - 1].cat;
    this._d = null; this._editId = ''; this._dirty = false; this.mode = 'list'; this._clearDraft();
    this.render(); U.toast(`Facture enregistrée : ${U.eur(rec.total)}.` + (notes.length ? ' Stock : ' + notes.join(' · ') : ''), false, entry.id);
  },

  /* ---------- export : registre des achats (une ligne par article) ---------- */
  exportCsv(rowsOverride) {
    const rows = rowsOverride || this._filtered(); if (!rows.length) { U.toast('Aucune facture à exporter avec ces filtres.', true); return; }
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', n = v => String(this.r2(v)).replace('.', ',');
    const head = ['Date', 'Fournisseur', 'N_facture', 'Paiement', 'Paye_par', 'Rembourse_le', 'Categorie', 'Designation', 'Quantite', 'Unite', 'Prix_unitaire', 'Total_ligne', 'Lot', 'DLUO', 'Livraison_facture', 'Remise_facture', 'Mode_prix', 'TVA_facture', 'Total_paye_TTC'];
    const out = [head.join(';')];
    rows.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(p => (p.lines || []).forEach((l, i) => {
      out.push([q(p.date), q(this.supplierLabel(p)), q(p.invoiceNo), q(this.payLabel(p.payment).replace(/^\S+\s/, '')), q(p.paidBy === 'perso' ? 'carte perso' : 'compte pro'), q(p.reimbursed), q(this.cat(l.cat).label), q(l.label), n(l.qty), q(l.unit), n(l.price), n(this.lineTotal(l)), q(l.lot), q(l.dluo), i ? '' : n(p.shipping), i ? '' : n(p.discount), q(this.isHT(p) ? 'HT' : 'TTC'), i ? '' : (this.isHT(p) ? n(this.vatSum(p)) : ''), i ? '' : n(this.grandTotal(p))].join(';'));
    }));
    const blob = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'achats-' + U.today() + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
};
