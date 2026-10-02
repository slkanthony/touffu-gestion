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
  mode: 'list', _d: null, _editId: '', _dirty: false, _open: {}, _lastCat: 'mastication',
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
  grandTotal(p) { return this.r2(this.subTotal(p) + U.num(p.shipping) - U.num(p.discount)); },
  supplierLabel(p) { return p.supplierId ? Store.supplierName(p.supplierId) : '—'; },
  payLabel(v) { const x = this.PAYS.find(p => p[0] === v); return x ? x[1] : '—'; },
  unitFrom(u) { const t = String(u || '').toLowerCase(); return t === 'piece' || t === 'pcs' || t === 'pc' ? 'pièce' : String(u || ''); },
  itemName(kind, id) {
    if (kind === 'M') { const p = (Store.state.stockM || []).find(x => x.id === id); return p ? p.name : ''; }
    if (kind === 'T') { const m = (Store.state.materials || []).find(x => x.id === id); return m ? (m.product ? m.product + ' ' : '') + (m.variant || m.name || '') : ''; }
    const c = (Store.state.consumables || []).find(x => x.id === id); return c ? c.name : '';
  },
  _newLine(cat) {
    const c = this.cat(cat);
    return { id: U.uid(), cat: c.id, ref: '', label: '', qty: 1, unit: c.id === 'mastication' ? 'kg' : '', price: 0, lot: '', dluo: '', years: '' };
  },
  _newPurchase() {
    return { id: U.uid(), date: U.today(), supplierId: '', invoiceNo: '', payment: 'carte', paidBy: 'pro', reimbursed: '', shipping: 0, discount: 0, note: '', lines: [this._newLine(this._lastCat)] };
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
    if (q) rows = rows.filter(p => [p.invoiceNo, p.note, this.supplierLabel(p), ...(p.lines || []).flatMap(l => [l.label, l.lot])].filter(Boolean).join(' ').toLowerCase().includes(q));
    const dir = f.sortDir === 'asc' ? 1 : -1;
    rows.sort((x, y) => f.sort === 'supplier' ? dir * U.sortFr(this.supplierLabel(x), this.supplierLabel(y)) : f.sort === 'total' ? dir * (this.grandTotal(x) - this.grandTotal(y)) : dir * ((x.date || '').localeCompare(y.date || '') || (x.created || 0) - (y.created || 0)));
    return rows;
  },

  /* ---------- page principale ---------- */
  render() {
    if (App.isViewer || App.isTeam) { App.mount('<div class="empty"><span class="big">🔒</span>Page réservée à l\'administrateur.</div>'); return; }
    U.syncFilters('achats', this.f);
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
          <div class="fg"><label>Fournisseur</label><select onchange="Achats.setF('supplier',this.value)">${opt('', 'Tous', f.supplier)}${sups.map(s => opt(s.id, s.name, f.supplier)).join('')}</select></div>
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
      <div class="card">
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>${sh('date', 'Date')}</th><th style="text-align:left;">${sh('supplier', 'Fournisseur')}</th><th style="text-align:left;">N° facture</th><th style="text-align:left;">Contenu</th><th>Paiement</th><th>Payé par</th><th class="num">Livraison</th><th class="num">${sh('total', 'Total')}</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`
        : `<p class="muted">${this.list().length ? 'Aucune facture avec ces filtres.' : 'Aucune facture pour l\'instant. Clique sur « ＋ Nouvelle facture » pour saisir ton premier achat.'}</p>`}
        <p class="muted help" style="font-size:.82rem;">Les montants sont ceux réellement payés (TTC). Cette page n'écrit rien dans ton stock ni dans tes prix : c'est ton registre d'achats. Une facture ancienne peut être saisie avec sa vraie date. Clique sur une ligne pour voir le détail.</p>
      </div>`);
  },
  toggle(id) { this._open[id] = !this._open[id]; this.render(); },
  _detailRow(p) {
    const lines = (p.lines || []).map(l => {
      const c = this.cat(l.cat);
      return `<div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr) auto;gap:10px;padding:5px 0;border-bottom:1px solid var(--row-border);">
        <span>${c.ico} <b>${U.esc(l.label)}</b>${l.lot ? ` <span class="badge info">lot ${U.esc(l.lot)}${l.dluo ? ' · DLUO ' + U.frDate(l.dluo) : ''}</span>` : ''}${U.num(l.years) ? ` <span class="badge info">amorti sur ${U.num(l.years)} an(s)</span>` : ''}</span>
        <span class="muted">${c.detail ? U.qty(l.qty) + ' ' + U.esc(l.unit || '') + ' × ' + U.eur(l.price) : c.label}</span>
        <span class="sensitive" style="text-align:right;white-space:nowrap;"><b>${U.eur(this.lineTotal(l))}</b></span></div>`;
    }).join('');
    const extra = [U.num(p.shipping) ? `Livraison : ${U.eur(p.shipping)}` : '', U.num(p.discount) ? `Remise : − ${U.eur(p.discount)}` : ''].filter(Boolean).join(' · ');
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
    d.lines.forEach(l => { l.id = U.uid(); l.lot = ''; l.dluo = ''; });
    this._d = d; this._editId = ''; this._dirty = true; this.mode = 'edit'; this._saveDraft(); this.render(); window.scrollTo({ top: 0 });
    U.toast('Facture dupliquée : change la date, le n° de facture et les prix si besoin.');
  },
  async remove(id) {
    const p = this.list().find(x => x.id === id); if (!p) return;
    if (!await U.confirm(`Supprimer la facture ${p.invoiceNo ? 'n° ' + p.invoiceNo + ' ' : ''}de ${this.supplierLabel(p)} du ${U.frDate(p.date)} (${U.eur(this.grandTotal(p))}) ?`, { okLabel: 'Supprimer' })) return;
    const snap = Store.snapshot('purchases', p);
    Store.state.purchases = this.list().filter(x => x.id !== id);
    const entry = Store.commitSnapshot(snap, 'achat', `Facture supprimée — ${this.supplierLabel(p)} ${U.frDate(p.date)}`);
    Store.save('purchases'); this.render(); U.toast('Facture supprimée.', false, entry.id);
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
  setHead(k, v) { this._d[k] = (k === 'shipping' || k === 'discount') ? U.num(v) : v; this._touch(); if (k === 'shipping' || k === 'discount') this._refreshTotals(); if (k === 'paidBy') { if (v === 'pro') this._d.reimbursed = ''; this.render(); } if (k === 'payment') this.render(); },
  _pickSup(sel) {
    if (sel.value !== '__new') { this._d.supplierId = sel.value; this._touch(); return; }
    sel.value = this._d.supplierId || '';
    U.modal({ title: 'Nouveau fournisseur', body: `<div class="fg"><label>Nom du fournisseur</label><input id="ach_newsup" placeholder="ex : Amazon, magasin de bricolage…" onkeydown="if(event.key==='Enter')document.getElementById('modalOk').click()"></div>`, okLabel: 'Ajouter',
      onOk: () => {
        const n = U.val('ach_newsup').trim(); if (!n) { U.toast('Donne un nom au fournisseur.', true); return false; }
        const S = Store.state.settings; let s = S.suppliers.find(x => x.name.toLowerCase() === n.toLowerCase());
        if (!s) { s = { id: U.uid(), name: n }; S.suppliers.push(s); Store.save('settings'); }
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
    if (v) {
      const name = this.itemName(c.link, v); if (!String(l.label || '').trim() && name) l.label = name;
      if (c.link === 'T') { const m = Store.state.materials.find(x => x.id === v); if (m && !l.unit) l.unit = this.unitFrom(m.unit); }
      if (c.link === 'C') { const k = Store.state.consumables.find(x => x.id === v); if (k && !l.unit) l.unit = this.unitFrom(k.unit); }
    }
    this._touch(); this.render();
  },
  setText(i, k, v) { this._d.lines[i][k] = String(v || '').trim(); this._touch(); },
  setNum(i, k, v) { this._d.lines[i][k] = U.num(v); this._touch(); this._refreshTotals(); },
  _refreshTotals() {
    const d = this._d; if (!d) return;
    d.lines.forEach((l, i) => { const e = document.getElementById('ach_lt_' + i); if (e) e.textContent = U.eur(this.lineTotal(l)); });
    const s = document.getElementById('ach_sub'), t = document.getElementById('ach_tot');
    if (s) s.textContent = U.eur(this.subTotal(d)); if (t) t.textContent = U.eur(this.grandTotal(d));
  },
  _linkOpts(kind, cur) {
    let items;
    if (kind === 'M') items = (Store.state.stockM || []).map(p => [p.id, p.name]);
    else if (kind === 'T') items = (Store.state.materials || []).map(m => [m.id, (m.product ? m.product + ' ' : '') + (m.variant || m.name || '')]);
    else items = (Store.state.consumables || []).map(c => [c.id, c.name]);
    items.sort((a, b) => U.sortFr(a[1], b[1]));
    return `<option value="">— choisir (optionnel) —</option>` + items.map(([id, n]) => `<option value="${U.esc(id)}" ${id === cur ? 'selected' : ''}>${U.esc(n)}</option>`).join('');
  },
  _lineHTML(l, i) {
    const c = this.cat(l.cat);
    const catSel = `<select onchange="Achats.setLineCat(${i},this.value)">${this.CATS.map(x => `<option value="${x.id}" ${x.id === l.cat ? 'selected' : ''}>${x.ico} ${x.label}</option>`).join('')}</select>`;
    const label = `<input value="${U.esc(l.label)}" placeholder="${c.detail ? 'désignation' : 'ex : visseuse, assurance, timbres…'}" onchange="Achats.setText(${i},'label',this.value)">`;
    let inner;
    if (!c.detail) {
      inner = `<div class="fg"><label>Catégorie</label>${catSel}</div><div class="fg" style="grid-column:span 2;"><label>Désignation</label>${label}</div>
        <div class="fg"><label>Montant (€)</label><input type="number" step="any" value="${l.price || ''}" placeholder="0" oninput="Achats.setNum(${i},'price',this.value)"></div>`;
    } else {
      inner = `<div class="fg"><label>Catégorie</label>${catSel}</div>
        ${c.link ? `<div class="fg"><label>${c.link === 'M' ? 'Produit du stock' : c.link === 'T' ? 'Matière du stock' : 'Consommable du stock'}</label><select onchange="Achats.pickLink(${i},this.value)">${this._linkOpts(c.link, l.ref)}</select></div>` : ''}
        <div class="fg" style="grid-column:span 2;"><label>Désignation</label>${label}</div>
        <div class="fg"><label>Quantité</label><input type="number" step="any" value="${l.qty || ''}" oninput="Achats.setNum(${i},'qty',this.value)"></div>
        <div class="fg"><label>Unité</label><input list="ach_units" value="${U.esc(l.unit || '')}" placeholder="kg, pièce…" onchange="Achats.setText(${i},'unit',this.value)"></div>
        <div class="fg"><label>Prix unitaire (€)</label><input type="number" step="any" value="${l.price || ''}" placeholder="0" oninput="Achats.setNum(${i},'price',this.value)"></div>
        ${c.id === 'mastication' ? `<div class="fg"><label>N° de lot</label><input value="${U.esc(l.lot || '')}" placeholder="n° de lot du fournisseur" onchange="Achats.setText(${i},'lot',this.value)"></div><div class="fg"><label>DLUO</label><input type="date" value="${U.esc(l.dluo || '')}" onchange="Achats.setText(${i},'dluo',this.value)"></div>` : ''}
        ${c.id === 'equipement' ? `<div class="fg"><label>Amortissement (ans, optionnel)</label><input type="number" step="any" min="0" value="${l.years || ''}" placeholder="ex : 5" onchange="Achats.setNum(${i},'years',this.value)"></div>` : ''}
        <div class="fg"><label>Total ligne</label><div class="ach-tot sensitive" id="ach_lt_${i}">${U.eur(this.lineTotal(l))}</div></div>`;
    }
    return `<div class="ach-line"><div class="ach-grid">${inner}</div><div style="text-align:right;margin-top:4px;"><button class="btn-icon" title="Retirer cette ligne" onclick="Achats.delLine(${i})">🗑️</button></div></div>`;
  },
  renderEditor() {
    const d = this._d, sups = (Store.state.settings.suppliers || []).slice().sort((a, b) => U.sortFr(a.name, b.name));
    const pay = this.PAYS.map(p => `<button type="button" class="${d.payment === p[0] ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Achats.setHead('payment','${p[0]}')">${p[1]}</button>`).join('');
    const who = [['pro', '🏢 Compte pro'], ['perso', '💳 Carte perso (à me rembourser)']].map(p => `<button type="button" class="${d.paidBy === p[0] ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Achats.setHead('paidBy','${p[0]}')">${p[1]}</button>`).join('');
    App.mount(`
      <div class="view-title"><h1>${this._editId ? 'Modifier la facture' : 'Nouvelle facture'}</h1><span class="sub">achat fournisseur</span></div>
      <datalist id="ach_units">${['kg', 'g', 'pièce', 'lot', 'paquet', 'carton', 'rouleau', 'sachet', 'm', 'L'].map(u => `<option value="${u}">`).join('')}</datalist>
      <div class="card">
        <div class="grid c4">
          <div class="fg"><label>Date de la facture</label><input type="date" value="${U.esc(d.date)}" onchange="Achats.setHead('date',this.value)"></div>
          <div class="fg"><label>Fournisseur</label><select onchange="Achats._pickSup(this)"><option value="">— choisir —</option>${sups.map(s => `<option value="${s.id}" ${s.id === d.supplierId ? 'selected' : ''}>${U.esc(s.name)}</option>`).join('')}<option value="__new">＋ Autre fournisseur…</option></select></div>
          <div class="fg"><label>N° de facture / devis</label><input value="${U.esc(d.invoiceNo)}" placeholder="ex : FA-2026-0412" onchange="Achats.setHead('invoiceNo',this.value.trim())"></div>
          <div class="fg"><label>Note (option)</label><input value="${U.esc(d.note)}" placeholder="ex : commande de rentrée" onchange="Achats.setHead('note',this.value)"></div>
        </div>
        <div class="frow mt" style="gap:18px;align-items:center;">
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
          <div><span class="muted">Sous-total</span> <b class="sensitive" id="ach_sub">${U.eur(this.subTotal(d))}</b></div>
          <div class="fg"><label>Frais de livraison (€)</label><input type="number" step="any" value="${d.shipping || ''}" placeholder="0" oninput="Achats.setHead('shipping',this.value)"></div>
          <div class="fg"><label>Remise (€)</label><input type="number" step="any" value="${d.discount || ''}" placeholder="0" oninput="Achats.setHead('discount',this.value)"></div>
          <div class="ach-grand">Total payé <b class="sensitive" id="ach_tot">${U.eur(this.grandTotal(d))}</b></div>
        </div>
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
      lines.push({ id: l.id || U.uid(), cat: c.id, ref: l.ref || '', label: lab, qty: c.detail ? U.num(l.qty) || 0 : 1, unit: c.detail ? String(l.unit || '').trim() : '', price: U.num(l.price), lot: c.id === 'mastication' ? String(l.lot || '').trim() : '', dluo: c.id === 'mastication' ? (l.dluo || '') : '', years: c.id === 'equipement' ? U.num(l.years) : 0 });
    }
    if (!lines.length) { U.toast('Ajoute au moins une ligne avec un montant.', true); return; }
    const rec = { id: this._editId || d.id, date: d.date, supplierId: d.supplierId, invoiceNo: String(d.invoiceNo || '').trim(), payment: d.payment || '', paidBy: d.paidBy || 'pro', reimbursed: d.paidBy === 'perso' ? (d.reimbursed || '') : '', shipping: U.num(d.shipping), discount: U.num(d.discount), note: String(d.note || '').trim(), lines };
    rec.total = this.grandTotal(rec);
    // doublons : même n° de facture chez le même fournisseur, ou même fournisseur + date + montant (alerte non bloquante)
    const msgs = [], others = this.list().filter(p => p.id !== rec.id && p.supplierId === rec.supplierId);
    if (rec.invoiceNo && others.some(p => p.invoiceNo && p.invoiceNo.toLowerCase() === rec.invoiceNo.toLowerCase())) msgs.push(`Le n° « ${rec.invoiceNo} » existe déjà chez ${this.supplierLabel(rec)}.`);
    else if (others.some(p => p.date === rec.date && Math.abs(this.grandTotal(p) - rec.total) < 0.005)) msgs.push(`Une facture de ${this.supplierLabel(rec)} du ${U.frDate(rec.date)} au même montant (${U.eur(rec.total)}) existe déjà.`);
    if (!U.dupGate(msgs, () => Achats.save())) return;
    const old = this._editId ? this.list().find(p => p.id === this._editId) : null;
    let entry;
    if (old) { const snap = Store.snapshot('purchases', old); rec.created = old.created || Date.now(); rec.updated = Date.now(); Object.keys(old).forEach(k => delete old[k]); Object.assign(old, rec); entry = Store.commitSnapshot(snap, 'achat', `Facture modifiée — ${this.supplierLabel(rec)} ${U.frDate(rec.date)}`); }
    else { rec.created = Date.now(); this.list().push(rec); entry = Store.log('achat', `Facture ajoutée — ${this.supplierLabel(rec)} ${U.frDate(rec.date)} (${U.eur(rec.total)})`, { type: 'restoreItem', data: { domain: 'purchases', id: rec.id, before: null } }); }
    Store.save('purchases');
    this._lastCat = lines[lines.length - 1].cat;
    this._d = null; this._editId = ''; this._dirty = false; this.mode = 'list'; this._clearDraft();
    this.render(); U.toast(`Facture enregistrée : ${U.eur(rec.total)}.`, false, entry.id);
  },

  /* ---------- export : registre des achats (une ligne par article) ---------- */
  exportCsv() {
    const rows = this._filtered(); if (!rows.length) { U.toast('Aucune facture à exporter avec ces filtres.', true); return; }
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"', n = v => String(this.r2(v)).replace('.', ',');
    const head = ['Date', 'Fournisseur', 'N_facture', 'Paiement', 'Paye_par', 'Rembourse_le', 'Categorie', 'Designation', 'Quantite', 'Unite', 'Prix_unitaire', 'Total_ligne', 'Lot', 'DLUO', 'Livraison_facture', 'Remise_facture', 'Total_facture'];
    const out = [head.join(';')];
    rows.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(p => (p.lines || []).forEach((l, i) => {
      out.push([q(p.date), q(this.supplierLabel(p)), q(p.invoiceNo), q(this.payLabel(p.payment).replace(/^\S+\s/, '')), q(p.paidBy === 'perso' ? 'carte perso' : 'compte pro'), q(p.reimbursed), q(this.cat(l.cat).label), q(l.label), n(l.qty), q(l.unit), n(l.price), n(this.lineTotal(l)), q(l.lot), q(l.dluo), i ? '' : n(p.shipping), i ? '' : n(p.discount), i ? '' : n(this.grandTotal(p))].join(';'));
    }));
    const blob = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'achats-' + U.today() + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
};
