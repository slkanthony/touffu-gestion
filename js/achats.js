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
  mode: 'list', _priceOpen: false, _ppkOpen: true, _d: null, _editId: '', _dirty: false, _open: {}, _lastCat: 'mastication',
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
  /* Remise donnée « sur le total TTC » (code promo retiré APRÈS la TVA, Antho 2026-10-29) : le total HT et la TVA restent ceux de la facture, la remise se retire du total payé (p.discTTC, facture en HT seulement). */
  discPost(p) { return this.isHT(p) && p.discTTC ? U.num(p.discount) : 0; },
  discPre(p) { return U.num(p.discount) - this.discPost(p); },
  /* La même remise ramenée en HT (part du total payé) : sert seulement au coût réel de chaque ligne. */
  discHT(p) { const d = this.discPost(p); if (!d) return this.discPre(p); const b = this.base(p), t = b + this.vatSum(p); return t > 0 ? this.r2(d * b / t) : d; },
  base(p) { return this.r2(this.subTotal(p) + U.num(p.shipping) - this.discPre(p)); },
  vatSum(p) { return this.isHT(p) ? this.r2((p.vat || []).reduce((a, v) => a + U.num(v.amount), 0)) : 0; },
  grandTotal(p) { return this.r2(this.base(p) + this.vatSum(p) - this.discPost(p)); },   // TOUJOURS ce qui a été payé (TTC)
  /* TVA répartie au prorata (le fournisseur ne dit pas sur quel produit) : coût TTC = HT × (1 + TVA totale / base HT) */
  ttcFactor(p) { const b = this.base(p); return this.isHT(p) && b > 0 ? 1 + (this.vatSum(p) - this.discPost(p)) / b : 1; },
  supplierLabel(p) { return p.supplierId ? Store.supplierName(p.supplierId) : '—'; },
  suppliers() { return (Store.state.settings.suppliers || []).slice().sort((a, b) => U.sortFr(a.name, b.name)); },   // une seule liste ; chaque fournisseur a des types (Store.SUPPLIER_TYPES)
  /* Types de fournisseur déduits des catégories de la facture (mastication → « mastication », outillage/équipement/frais → « autre »…) */
  _supTypesFromLines(d) { const m = { mastication: 'mastication', matiere: 'matiere', conso: 'conso' }; return [...new Set(((d && d.lines) || []).map(l => m[l.cat] || 'autre'))]; },
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
  /* Longueur d'un rouleau de sangle = la case « pour (quantité achetée) » de la fiche matière (ex. 34,74 € / 30 m). 0 si ce n'est pas une sangle au rouleau. */
  _rollLen(it) { return it && Store.isSangleKind(it.kind) && U.num(it.costQtyPer) > 1 ? U.num(it.costQtyPer) : 0; },
  /* Prix saisi « par lot de N » : on ajoute N × quantité. Sangle achetée « au rouleau » : 1 rouleau = longueur de la fiche (en mètres). */
  /* Matière non-sangle dont la fiche est « prix / N » (ex. 11,80 € / 100 boutons de col) : achetée par LOT de N (unité « lot »), ou à la pièce (unité « pièce »). */
  _lotLen(it) { return it && !Store.isSangleKind(it.kind) && U.num(it.costQtyPer) > 1 ? U.num(it.costQtyPer) : 0; },
  _packOf(l, it) { return l.cat === 'conso' && U.num(it.costQtyPer) > 1 ? U.num(it.costQtyPer) : l.cat === 'matiere' && l.unit === 'rouleau' ? (this._rollLen(it) || 1) : l.cat === 'matiere' && l.unit === 'lot' ? (this._lotLen(it) || 1) : 1; },
  _stockPreview(l) {
    const it = this._item(l); if (!it) return null;
    const add = U.num(l.qty) * this._packOf(l, it);
    return { it, add, cur: U.num(it.qty), after: U.num(it.qty) + add };
  },
  _eff(rec) {   // total de chaque ligne + sa part de livraison − sa part de remise (dans le mode de saisie)
    const sub = this.subTotal(rec), extra = U.num(rec.shipping) - this.discPre(rec);
    return (rec.lines || []).map(l => this.lineTotal(l) + (sub ? extra * this.lineTotal(l) / sub : 0));
  },
  /* TVA d'une facture saisie en TTC : taux propre à la facture (rec.vatRate, retenu par fournisseur) ; vide = taux global des Paramètres. */
  vatRateOf(rec) { return U.num(rec && rec.vatRate !== undefined && rec.vatRate !== null && rec.vatRate !== '' ? rec.vatRate : (Store.state.settings.vatRate ?? 20)); },
  /* Coût réel HT de chaque ligne : remise comprise, livraison EXCLUE. Décision d'Antho (2026-10-04) : le port d'une facture n'est PAS réparti
     dans le coût des lots / du stock ; c'est une charge (Compta) + un taux « port à l'achat » par catégorie ajouté au calcul de prix (Paramètres). */
  _effHT(rec) {
    const g = 1 + this.vatRateOf(rec) / 100, sub = this.subTotal(rec), disc = this.discHT(rec);
    return (rec.lines || []).map(l => { const t = this.lineTotal(l) - (sub ? disc * this.lineTotal(l) / sub : 0); return this.isHT(rec) ? t : t / g; });
  },
  /* Livraison HT imputée à chaque ligne (au prorata du montant) : sert aux statistiques de port par catégorie et à la charge « port sur achats ». */
  portHTByLine(rec) {
    const g = 1 + this.vatRateOf(rec) / 100, sub = this.subTotal(rec), ship = U.num(rec.shipping) / (this.isHT(rec) ? 1 : g);
    return (rec.lines || []).map(l => sub ? ship * this.lineTotal(l) / sub : 0);
  },
  /* Port moyen par catégorie sur une période [from, to] (dates AAAA-MM-JJ) : port HT payé ÷ marchandises HT achetées. Ne regarde que
     mastication / matière / consommable (les outils et frais généraux n'entrent pas dans l'assiette). */
  portStats(from, to) {
    const out = {}; ['mastication', 'matiere', 'conso'].forEach(c => out[c] = { port: 0, goods: 0, n: 0, pcts: [] });
    this.list().forEach(p => {
      if (p.date < from || p.date > to) return;
      const eff = this._effHT(p), port = this.portHTByLine(p), per = {};
      (p.lines || []).forEach((l, i) => { const o = out[l.cat]; if (!o) return; o.goods += eff[i]; o.port += port[i]; (per[l.cat] = per[l.cat] || { g: 0, p: 0 }); per[l.cat].g += eff[i]; per[l.cat].p += port[i]; });
      Object.keys(per).forEach(c => { out[c].n++; if (per[c].g > 0) out[c].pcts.push(per[c].p / per[c].g * 100); });
    });
    Object.values(out).forEach(o => { o.pct = o.goods > 0 ? o.port / o.goods * 100 : 0; o.min = o.pcts.length ? Math.min(...o.pcts) : 0; o.max = o.pcts.length ? Math.max(...o.pcts) : 0; });
    return out;
  },
  _snapOnce(domain, item, snaps) { if (!snaps.some(s => s.domain === domain && s.id === item.id)) snaps.push(Store.snapshot(domain, item)); },
  _revertStock(rec, snaps) {
    (rec.lines || []).forEach(l => {
      const ap = l.applied; if (!ap) return;
      if (l.cat === 'mastication') {   // achat à la pièce rangé tout de suite : on retire la quantité du lot créé (le lot disparaît s'il est vide)
        const sp = (Store.state.stockM || []).find(x => x.id === ap.pId), v = sp && sp.variants.find(x => x.id === ap.vId), lot = v && (v.lots || []).find(x => x.id === ap.lotId);
        if (!lot) return;
        this._snapOnce('stockM', sp, snaps);
        let rest = U.num(ap.qty), g = Math.min(rest, U.num(lot.qtyGeneral)); lot.qtyGeneral = U.num(lot.qtyGeneral) - g; rest -= g;
        lot.qtyEvent = Math.max(0, U.num(lot.qtyEvent) - rest);
        if (!(U.num(lot.qtyGeneral) > 0) && !(U.num(lot.qtyEvent) > 0)) v.lots = v.lots.filter(x => x.id !== lot.id);
        return;
      }
      const it = this._item(l); if (!it) return;
      this._snapOnce(l.cat === 'conso' ? 'consumables' : 'materials', it, snaps);
      if ((ap.rollId || ap.rollIds) && Array.isArray(it.rolls)) { const gone = [ap.rollId].concat(ap.rollIds || []); it.rolls = it.rolls.filter(r => !gone.includes(r.id)); it.qty = it.rolls.reduce((a, r) => a + U.num(r.qty), 0); }
      else it.qty = Math.max(0, U.num(it.qty) - U.num(ap.qty));
    });
  },
  _applyStock(rec, snaps, notes) {
    const eff = this._effHT(rec);   // coût réel HT par ligne (TVA propre à la facture si saisie en HT)
    if (rec.pending) { rec.lines.forEach(l => { delete l.applied; }); return; }   // commande pas encore reçue : rien n'entre en stock
    rec.lines.forEach((l, i) => {
      delete l.applied;
      const dr = this._directOf(l);
      if (dr) {   // mastication à la pièce : un lot (n° de lot, DLUO, coût réel TVA d'achat comprise) dans la taille choisie
        this._snapOnce('stockM', dr.sp, snaps);
        const q = Math.round(U.num(l.qty)), lot = { id: U.uid(), lotNumber: l.lot || '', dluo: l.dluo || '', qtyGeneral: q, qtyEvent: 0, costUnit: Math.round(eff[i] / U.num(l.qty) * Stock.buyK(dr.sp, dr.v) * 10000) / 10000, costFinal: true, src: { pid: rec.id, lid: l.id } };
        dr.v.lots.push(lot); l.applied = { qty: q, pId: dr.sp.id, vId: dr.v.id, lotId: lot.id };
        notes.push(`${dr.sp.name} › ${Pricing.labelVariant(dr.v)} +${q}${l.lot ? ' (lot ' + l.lot + ')' : ''}`);
        return;
      }
      if (!l.toStock || !l.ref || (l.cat !== 'conso' && l.cat !== 'matiere') || !(U.num(l.qty) > 0)) return;
      const it = this._item(l); if (!it) return;
      this._snapOnce(l.cat === 'conso' ? 'consumables' : 'materials', it, snaps);
      const pack = this._packOf(l, it), add = U.num(l.qty) * pack, prevQty = U.num(it.qty), prevCost = U.num(it.costUnit);
      const perPack = eff[i] / U.num(l.qty), ap = { qty: add, prevCost };
      if (l.cat === 'conso') {
        it.costTotal = Math.round(perPack * 10000) / 10000; it.costQtyPer = pack > 1 ? pack : 1; it.costTax = 'HT';
        it.costUnit = Stock.consoUnitCost(it.costTotal, it.costQtyPer, 'HT'); it.qty = prevQty + add;
      } else {
        it.costUnit = Math.round(perPack / pack * 10000) / 10000;
        // coût réel HT (port compris) : les champs « prix / quantité » suivent (au rouleau : prix d'un rouleau / longueur du rouleau)
        if (pack > 1) { it.costTotal = Math.round(perPack * 10000) / 10000; it.costQtyPer = pack; } else { it.costTotal = it.costUnit; it.costQtyPer = 1; }
        it.costTax = 'HT';
        if (Store.isSangleKind(it.kind)) {
          if (!Array.isArray(it.rolls)) it.rolls = prevQty > 0 ? [{ id: U.uid(), label: 'Stock avant achat', qty: prevQty }] : [];
          if (pack > 1) {   // N rouleaux entiers (+ un rouleau partiel si quantité décimale)
            const q = U.num(l.qty), n = Math.floor(q + 1e-9), rem = Math.round((q - n) * pack * 100) / 100;
            ap.rollIds = [];
            for (let k = 0; k < n; k++) { const r = { id: U.uid(), label: 'Rouleau ' + (it.rolls.length + 1), qty: pack, entame: false, src: rec.id }; it.rolls.push(r); ap.rollIds.push(r.id); }
            if (rem > 0) { const r = { id: U.uid(), label: 'Rouleau ' + (it.rolls.length + 1), qty: rem, entame: false, src: rec.id }; it.rolls.push(r); ap.rollIds.push(r.id); }   // reste décimal = dernier rouleau, plus court
          } else { const r = { id: U.uid(), label: 'Rouleau ' + (it.rolls.length + 1), qty: add, entame: false, src: rec.id }; it.rolls.push(r); ap.rollId = r.id; }
          it.qty = it.rolls.reduce((a, x) => a + U.num(x.qty), 0);
        } else it.qty = prevQty + add;
      }
      ap.newCost = it.costUnit; l.applied = ap;
      const nm = this.itemName(l.cat === 'conso' ? 'C' : 'T', l.ref) || l.label, pct = prevCost > 0 ? (it.costUnit - prevCost) / prevCost * 100 : 0;
      notes.push(`${nm} +${U.qty(add)} (${U.qty(prevQty)} → ${U.qty(it.qty)})`);
      if (Math.abs(it.costUnit - prevCost) > 0.00005 && prevCost > 0) notes.push(`💶 prix ${pct > 0 ? '↑ +' : '↓ '}${Math.round(pct * 10) / 10} % : ${nm} ${U.eur(prevCost)} → ${U.eur(it.costUnit)} HT (vérifie les fiches prix concernées)`);
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
      if (x && x.d && Array.isArray(x.d.lines)) {
        this._d = x.d; this._editId = x.editId || ''; this._dirty = !!x.dirty; this.mode = 'edit';
        if (this._d.supplierId && this._adaptLinesToSupplier()) this._saveDraft();   // brouillon enregistré avant la correction : on remet la catégorie du fournisseur (sauf choix manuel)
      }
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
  _fixDiscTTC() {   // facture « remise sur le total TTC » enregistrée avant le 2026-10-29 soir : TVA recalculée sur le total HT (le total payé ne change pas)
    if (this._fixedDisc) return; this._fixedDisc = true; let n = 0;
    this.list().forEach(p => { if (p.discTTC && !p.discFixed && (p.vat || []).length === 1 && p.vat[0].auto) { p.vat[0].amount = this.r2(this.base(p) * U.num(p.vat[0].rate) / 100); p.discFixed = true; p.total = this.grandTotal(p); n++; } });
    this.list().forEach(p => { if (!p.cmpV3 && (p.lines || []).some(l => l.cat === 'mastication')) { const lh = this._listHT(p); (p.lines || []).forEach((l, i) => { if (l.cat === 'mastication' && l.ref) this._priceCmp(p, l, lh[i], []); }); p.cmpV3 = true; n++; } });   // comparaison avec la fiche : fournisseur de la facture, prix avant remise (factures déjà enregistrées)
    if (n) Store.save('purchases');
  },
  renderList() {
    this._fixDiscTTC();
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
        <td style="text-align:left;">${cats} <span class="muted">${(p.lines || []).length} ligne(s)</span>${p.hist ? ' <span class="badge" title="Saisie statistique : n\'a pas touché au stock ni aux prix">📚</span>' : ''}${p.pending ? ' <span class="badge warn" style="white-space:nowrap;" title="Commande pas encore reçue : rien n\'est entré en stock">📦 à recevoir</span>' : ''}</td>
        <td>${this.payLabel(p.payment)}</td>
        <td>${refund}</td>
        <td class="num sensitive">${U.num(p.shipping) ? U.eur(p.shipping) : '—'}</td>
        <td class="num sensitive"><b>${U.eur(tot)}</b></td>
        <td style="white-space:nowrap;text-align:right;" onclick="event.stopPropagation()">
          ${p.paidBy === 'perso' && !p.reimbursed ? `<button class="btn-ghost btn-sm" onclick="Achats.setReimbursed('${p.id}',true)" title="Marquer comme remboursé">✔ Remboursé</button>` : ''}
          ${(p.lines || []).some(l => l.cat === 'mastication' && (String(l.lot || '').trim() || String(l.dluo || '').trim())) ? `<button class="btn-ghost btn-sm" onclick="Achats.copyLabels('${p.id}')" title="Copie « produit — lot — DLUO (mois/année) » de cette facture, à donner à Claude pour les étiquettes">🏷️ Lots et DLUO</button>` : ''}
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
          <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Achats.openHist()" title="Rentrer une vieille facture juste pour les statistiques (compta, frais de livraison moyens) : rien n'est ajouté au stock ni aux prix">📚 Ancienne facture (statistiques)</button>
          <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Achats.exportCsv()" title="Un fichier avec les factures affichées (une ligne par article) : registre des achats">⬇ Exporter (CSV)</button>
          ${f.refund ? `<button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Achats.setF('refund',false)">✕ Afficher aussi les remboursées</button>` : ''}
        </div>
      </div>
      ${this._pendingCard()}
      ${this._recvCard()}
      ${this._priceCard()}
      ${this._ppkCard()}
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
  /* Bouton « Ouvrir la fiche » : mène à la fiche de calcul de prix (Prix mastication) du produit de la ligne, pour comparer / corriger sans le rechercher */
  _ficheLink(l) {
    const sp = l.cat === 'mastication' && l.ref ? (Store.state.stockM || []).find(x => x.id === l.ref) : null;
    return sp && sp.catalogId ? `<a class="btn btn-ghost btn-sm" style="text-decoration:none;white-space:nowrap;" href="#/catalogue/edit/${sp.catalogId}" title="Ouvrir la fiche de calcul de prix de ce produit">📋 Ouvrir la fiche</a>` : '<span></span>';
  },
  _priceCard() {   // prix à vérifier à l'achat : UN BLOC par date + produit ; dans le bloc, une rangée par alerte (étiquette · texte · écart), séparées
    const groups = [];
    this.list().forEach(p => (p.lines || []).forEach(l => {
      const c = this._chgInfo(l), pc = l.priceCmp || {}, items = [];
      if (c) items.push({ tag: '💶 Prix', text: `<span class="sensitive">${c.fiche ? 'Ta fiche prix ' : 'Avant '}${U.eur(c.from)} → payé <b>${U.eur(c.to)}</b> HT${c.unit ? ' / ' + U.esc(c.unit) : ''}</span>`, pct: `<span class="badge ${c.pct > 0 ? 'bad' : 'ok'}">${c.pct > 0 ? '↑ +' : '↓ '}${Math.round(c.pct * 10) / 10} %</span>` });
      if (pc.noSup) items.push({ tag: '⚠ Fournisseur', text: `Ce fournisseur n'est pas dans la fiche prix${pc.main ? ' (fiche : ' + U.esc(pc.main) + ')' : ''}`, pct: '' });
      if (pc.cheaper) { const h = pc.cheaper; items.push({ tag: '💡 Moins cher', text: `<span class="sensitive">Chez <b>${U.esc(h.name)}</b> (${h.isMain ? 'ton principal' : 'pas ton principal'}) : ${U.eur(h.alt)} HT / ${U.esc(h.unit)} au lieu de <b>${U.eur(h.paid)}</b></span>`, pct: `<span class="badge ok">↓ −${Math.round(h.pct * 10) / 10} %</span>` }); }
      if (!items.length) return;
      const key = p.id + '|' + (l.ref || l.id), g = groups.find(x => x.key === key);
      if (g) g.items.push(...items); else groups.push({ key, p, l, items });
    }));
    if (!groups.length) return '';
    groups.sort((a, b) => (b.p.date || '').localeCompare(a.p.date || ''));
    const row = x => `<div class="pv-row"><span class="pv-tag">${x.tag}</span><span>${x.text}</span><span class="pv-pct">${x.pct}</span></div>`;
    return `<details class="fold card" ${this._priceOpen ? 'open' : ''} ontoggle="Achats._priceOpen=this.open"><summary><b>💶 Prix à vérifier (${groups.length})</b> <span class="muted">— variation de coût, fournisseur absent de la fiche ou moins cher ailleurs : pense à vérifier les fiches concernées</span></summary>
      <div class="fold-body">${groups.slice(0, 30).map(g => `<div class="pv-grp"><span class="muted">${U.frDate(g.p.date)}</span><span><b>${U.esc(g.l.label)}</b><div class="muted" style="font-size:.82rem;">${U.esc(this.supplierLabel(g.p))}</div></span><div>${g.items.map(row).join('')}</div>${this._ficheLink(g.l)}</div>`).join('')}</div></details>`;
  },

  /* ---------- Pièces / kilo MESURÉ (Antho 2026-10-28) ----------
     Ligne mastication achetée au KILO + tri : pièces rangées ÷ kg achetés = pièces / kilo RÉEL de ce lot, comparé au champ « Pièces / kilo » de la fiche prix liée
     (fournisseur principal). Seuil volontairement bas : alerte dès 1 pièce / kg d'écart (≥ 3 : rouge) ; fiche vide : la valeur mesurée est proposée.
     Les kilos de pertes restent comptés (comme dans le coût de revient). Jamais appliqué sans clic d'Antho. */
  PPK_TOL: 1,
  _supOfLine(l) { const p = this.list().find(x => (x.lines || []).some(y => y.id === l.id)); return p ? p.supplierId : ''; },
  _ppkFiche(l) {
    const sp = (Store.state.stockM || []).find(x => x.id === l.ref), cat = sp && sp.catalogId ? (Store.state.catalogM || []).find(x => x.id === sp.catalogId) : null;
    if (!cat) return null;
    const sup = this._supOfLine(l);   // « pièces / kilo » de la ligne du fournisseur de la facture ; fournisseur absent de la fiche : pas de comparaison (signalé à part)
    if (sup && (cat.suppliers || []).length && !(cat.suppliers || []).some(s => s.supplierId === sup)) return null;
    const b = Pricing.baseUnitCost(cat, sup || undefined);
    if (b.unit !== 'kilo') return null;   // fiche achetée à la pièce : « pièces / kilo » sans objet
    return { cat, fiche: U.num(b.ppk) };
  },
  /* { measured, fiche, delta, level: 'ok' | 'warn' | 'bad' | 'empty', cat } ou null (ligne non concernée : pas au kilo, pas de fiche liée, pas de pièces) */
  ppkInfo(l, pieces) {
    if (String(l.unit || '').toLowerCase() !== 'kg' || !(U.num(l.qty) > 0) || !(U.num(pieces) > 0)) return null;
    const f = this._ppkFiche(l); if (!f) return null;
    const measured = Math.round(U.num(pieces) / U.num(l.qty) * 10) / 10;
    if (!(f.fiche > 0)) return { measured, fiche: 0, delta: 0, level: 'empty', cat: f.cat };
    const delta = Math.round((measured - f.fiche) * 10) / 10, ad = Math.abs(delta);
    return { measured, fiche: f.fiche, delta, level: ad < this.PPK_TOL ? 'ok' : ad >= 3 ? 'bad' : 'warn', cat: f.cat };
  },
  _ppkAlert(info) { return !!info && info.level !== 'ok'; },
  _ppkBadge(info) {
    if (!this._ppkAlert(info)) return '';
    const e = info.level === 'empty';
    return ` <span class="badge ${info.level === 'bad' ? 'bad' : 'warn'}" title="${e ? 'La fiche prix n\'a pas de « Pièces / kilo »' : 'Écart entre la fiche prix et ce lot'} : ouvre la fiche pour la corriger">📏 pièces/kg ${e ? 'mesuré ' + U.qty(info.measured) + ' (fiche vide)' : 'fiche ' + U.qty(info.fiche) + ' → mesuré ' + U.qty(info.measured)}</span>`;
  },
  /* Tous les « pièces / kilo » mesurés (tris terminés) pour une fiche prix, du plus récent au plus ancien — affichés dans l'éditeur de la fiche */
  measuredPpk(catId) {
    const out = [];
    this.list().forEach(p => (p.lines || []).forEach(l => {
      if (l.cat !== 'mastication' || !l.recv || !l.recv.closed) return;
      if (String(l.unit || '').toLowerCase() !== 'kg' || !(U.num(l.qty) > 0) || !(U.num(l.recv.pieces) > 0)) return;
      const sp = (Store.state.stockM || []).find(x => x.id === l.ref); if (!sp || sp.catalogId !== catId) return;
      out.push({ date: p.date, ppk: Math.round(U.num(l.recv.pieces) / U.num(l.qty) * 10) / 10, kg: U.num(l.qty), pieces: U.num(l.recv.pieces) });
    }));
    return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  },
  _ppkCard() {   // lots triés dont le « pièces / kilo » réel s'écarte de la fiche prix : de quoi savoir quelles fiches corriger
    const rows = [];
    this.list().forEach(p => (p.lines || []).forEach(l => { if (l.cat === 'mastication' && l.recv && l.recv.closed) { const i = this.ppkInfo(l, l.recv.pieces); if (this._ppkAlert(i)) rows.push({ p, l, i }); } }));
    if (!rows.length) return '';
    rows.sort((a, b) => (b.p.date || '').localeCompare(a.p.date || ''));
    return `<details class="fold card" ${this._ppkOpen ? 'open' : ''} ontoggle="Achats._ppkOpen=this.open"><summary><b>📏 Pièces / kilo à vérifier (${rows.length})</b> <span class="muted">— nombre de pièces réellement obtenues par kilo différent de ta fiche prix (dès 1 pièce / kg d'écart)</span></summary>
      <div class="fold-body">${rows.slice(0, 30).map(({ p, l, i }) => `<div style="display:grid;grid-template-columns:90px minmax(0,2fr) minmax(0,2fr) auto;gap:10px;padding:5px 0;border-bottom:1px solid var(--row-border);align-items:center;"><span class="muted">${U.frDate(p.date)}</span><span><b>${U.esc(l.label)}</b> <span class="muted">${U.esc(this.supplierLabel(p))}</span></span><span>${U.qty(l.recv.pieces)} pièces ÷ ${U.qty(l.qty)} kg = <b>${U.qty(i.measured)}</b> / kg · ${i.level === 'empty' ? 'fiche vide' : 'fiche ' + U.qty(i.fiche) + ' <span class="' + (i.level === 'bad' ? 'neg' : 'warn') + '">(' + (i.delta > 0 ? '+' : '') + U.qty(i.delta) + ')</span>'}</span><a class="btn btn-ghost btn-sm" style="text-decoration:none;" href="#/catalogue/edit/${i.cat.id}">Ouvrir la fiche</a></div>`).join('')}</div></details>`;
  },

  /* ---------- mastication : réceptions à ranger (lot → plusieurs tailles) ----------
     Ligne mastication liée à un produit du stock + « Réception à ranger » : l.recv = { dist: [{lotId, vId, qty}], loss, pieces, closed, ... }.
     Dans Stock → « ＋ Ajouter un lot », la réception est proposée (n° de lot + DLUO pré-remplis) ; chaque lot ajouté s'inscrit dans dist.
     « Terminer le tri » fige le coût réel par pièce (total de la ligne + livraison ÷ pièces triées) sur les lots concernés. */
  /* Prix HT de chaque ligne SANS la remise (comparaison avec la fiche prix) */
  _listHT(rec) { const g = this.isHT(rec) ? 1 : 1 + this.vatRateOf(rec) / 100; return (rec.lines || []).map(l => this.lineTotal(l) / g); },
  /* Comparaison d'une ligne mastication avec la fiche de calcul de prix : ligne du fournisseur de CETTE facture, prix HT AVANT remise (listHT1 = total HT de la ligne). */
  _priceCmp(rec, l, listHT1, notes) {
      // comparaison avec la fiche de calcul de prix (même unité seulement : kg ↔ « kilo », pièce ↔ pièce)
      delete l.priceCmp;
      const sp = (Store.state.stockM || []).find(x => x.id === l.ref), cat = sp && sp.catalogId ? (Store.state.catalogM || []).find(x => x.id === sp.catalogId) : null;
      if (!cat || !(U.num(l.qty) > 0)) return;
      // la comparaison se fait avec la ligne du fournisseur de CETTE facture (pas le fournisseur principal de la fiche) ; fournisseur absent de la fiche = alerte
      if ((cat.suppliers || []).length && !(cat.suppliers || []).some(s => s.supplierId === rec.supplierId)) {
        const mainSup = Pricing.mainEntry(cat);
        l.priceCmp = { noSup: true, main: mainSup ? Store.supplierName(mainSup.supplierId) : '' };
        notes.push(`⚠ ${l.label} : acheté chez ${this.supplierLabel(rec)}, qui n'est pas dans la fiche prix${l.priceCmp.main ? ' (fiche : ' + l.priceCmp.main + ')' : ''}`);
        return;
      }
      const b = Pricing.baseUnitCost(cat, rec.supplierId), u = String(l.unit || '').toLowerCase(), perUnitHT = listHT1 / U.num(l.qty);   // prix AVANT remise : une remise exceptionnelle (offre d'inscription…) ne doit pas déclencher l'alerte « fiche prix à revoir »
      const kg = u === 'kg' && b.unit === 'kilo', pc = (u === 'pièce' || u === 'piece' || u === 'pc') && b.unit !== 'kilo';
      if (!(kg || pc) || !(b.unitHT > 0)) return;
      l.priceCmp = { fiche: Math.round(b.unitHT * 10000) / 10000, paid: Math.round(perUnitHT * 10000) / 10000, unit: kg ? 'kg' : 'pièce' };
      // un AUTRE fournisseur de la fiche (même unité) moins cher que ce que tu viens de payer (coût réel, TVA d'achat comprise tant que non assujetti), principal ou non
      const paidCost = perUnitHT * b.k, mainId = (Pricing.mainEntry(cat) || {}).supplierId; let best = null;
      (cat.suppliers || []).forEach(se => {
        if (se.supplierId === rec.supplierId || !(U.num(se.price) > 0)) return;
        const o = Pricing.baseUnitCost(cat, se.supplierId);
        if (o.unit !== b.unit || !(o.unitCost > 0) || o.unitCost >= paidCost * 0.99) return;
        if (!best || o.unitCost < best.cost) best = { cost: o.unitCost, supplierId: se.supplierId, alt: o.unitHT };
      });
      if (best) l.priceCmp.cheaper = { name: Store.supplierName(best.supplierId), isMain: best.supplierId === mainId, alt: Math.round(best.alt * 10000) / 10000, paid: Math.round(perUnitHT * 10000) / 10000, unit: l.priceCmp.unit, pct: (paidCost - best.cost) / paidCost * 100 };
      if (best) notes.push(`💡 ${l.label} : moins cher chez ${l.priceCmp.cheaper.name} (${U.eur(l.priceCmp.cheaper.alt)} HT/${l.priceCmp.unit} au lieu de ${U.eur(l.priceCmp.cheaper.paid)}${l.priceCmp.cheaper.isMain ? '' : ', pas ton principal'})`);
      const ci = this._chgInfo(l);
      if (ci) notes.push(`💶 ${l.label} : fiche prix ${U.eur(ci.from)} → payé ${U.eur(ci.to)} HT/${l.priceCmp.unit} (${ci.pct > 0 ? '↑ +' : '↓ '}${Math.round(ci.pct * 10) / 10} %) — vérifie la fiche`);
  },
  _applyRecv(rec, old, notes) {
    const listHT = this._listHT(rec);
    rec.lines.forEach((l, i) => {
      if (l.cat !== 'mastication') return;
      const oldL = old && (old.lines || []).find(x => x.id === l.id);
      if (l.toStock && l.ref && !l.applied && !rec.pending) { if (!l.recv) l.recv = (oldL && oldL.recv) || { dist: [], loss: 0, closed: false }; }   // rangé tout de suite (à la pièce) : rien à ranger ensuite
      else if (l.recv && !(l.recv.dist || []).length) delete l.recv;   // décochée et rien de rangé : on oublie
      this._priceCmp(rec, l, listHT[i], notes);
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
  /* Commandes passées mais pas encore reçues (Antho 2026-10-29) : la facture sert de bon de contrôle ; « Réceptionner » rouvre la facture (lots, DLUO, case « Reçue »). */
  _pendingCard() {
    const rows = this.list().filter(p => p.pending);
    if (!rows.length) return '';
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="card" style="border-left:4px solid var(--warn);"><h2>📦 Commandes à recevoir (${rows.length})</h2>
      <p class="muted help" style="font-size:.85rem;">Rien n'est entré en stock pour ces commandes. À la livraison, clique « Réceptionner » : contrôle les quantités avec la facture, note les n° de lot et les DLUO, passe sur « Reçue » puis enregistre.</p>
      ${rows.map(p => `<div style="padding:8px 0;border-bottom:1px solid var(--row-border);display:grid;grid-template-columns:minmax(0,3fr) auto auto;gap:10px;align-items:center;">
        <div><b>${U.esc(this.supplierLabel(p))}</b> <span class="muted">${U.frDate(p.date)}${p.invoiceNo ? ' · n° ' + U.esc(p.invoiceNo) : ''} · ${(p.lines || []).length} ligne(s)</span></div>
        <span class="sensitive"><b>${U.eur(this.grandTotal(p))}</b></span>
        <span style="white-space:nowrap;"><button class="btn btn-ghost btn-sm" onclick="Achats.checklist('${p.id}')">📋 Checklist${this._ckProg(p)}</button> <button class="btn-cta btn-sm" onclick="Achats.edit('${p.id}')">📦 Réceptionner</button></span></div>`).join('')}</div>`;
  },
  /* Checklist de réception (Antho 2026-10-29) : les produits d'une commande « à recevoir » avec leurs quantités, à cocher en ouvrant le colis (surtout sur téléphone).
     Les coches sont enregistrées sur la facture (p.chk[idLigne] : 1 = reçu ; sans coche = manque) : on peut fermer, reprendre plus tard, ou cocher sur le téléphone et retrouver l'état sur l'ordinateur. */
  _ckLines(p) { return (p.lines || []).filter(l => U.num(l.qty) > 0 && l.label); },
  _ckQty(l) { const q = U.num(l.qty), u = String(l.unit || ''); return U.qty(q) + ' ' + U.esc(q > 1 && /^pièce$/i.test(u) ? 'pièces' : u); },
  /* Par défaut une ligne est « manquante » : on coche celles qui sont bien dans le colis (Antho 2026-11-04). Les lignes de mastication portent aussi n° de lot + DLUO,
     saisis pendant le contrôle (le plus souvent le même lot pour tout le colis : les lots déjà notés sont proposés en pastilles). Ils sont écrits sur la facture (l.lot / l.dluo). */
  _ckRow(p, l) {
    const ok = (p.chk || {})[l.id] === 1;
    return `<div class="ck-row${ok ? ' ok' : ''}" id="ck_${l.id}"><div class="ck-main" onclick="Achats.ckSet('${p.id}','${l.id}')"><span class="ck-box">${ok ? '✔' : ''}</span><span class="ck-name">${U.esc(l.label)}</span><span class="ck-qty">${this._ckQty(l)}</span></div>${l.cat === 'mastication' ? this._ckLot(p, l) : ''}</div>`;
  },
  /* Rangement par type de viande (Antho 2026-11-04) : viande du produit du stock lié (sinon de sa fiche prix) ; sans liaison = « Autres » (jamais deviné), en dernier. */
  _ckMeat(l) {
    if ('meat' in l) return l.meat;   // copie « Réception » de l'équipe : viande déjà figée
    if (l.cat !== 'mastication' || !l.ref) return '';
    const sp = (Store.state.stockM || []).find(x => x.id === l.ref), cat = sp && sp.catalogId ? (Store.state.catalogM || []).find(x => x.id === sp.catalogId) : null;
    return String((sp && sp.meatType) || (cat && cat.meatType) || '').trim();
  },
  _ckGroups(p) {
    const by = new Map();
    this._ckLines(p).forEach(l => { const m = this._ckMeat(l); if (!by.has(m)) by.set(m, []); by.get(m).push(l); });
    const keys = [...by.keys()].sort((a, b) => !a ? 1 : !b ? -1 : U.sortFr(a, b));
    return keys.map(m => ({ meat: m, lines: by.get(m).sort((a, b) => U.sortFr(a.label, b.label)) }));
  },
  _ckGrpHead(p, g, i) {
    const c = p.chk || {}, ok = g.lines.filter(l => c[l.id] === 1).length;
    return `<div class="ck-grp${ok === g.lines.length ? ' done' : ''}" id="ckg_${i}"><span class="ck-grp-tag">${U.esc(g.meat || 'Autres')}</span><span class="ck-grp-n">${ok} / ${g.lines.length}</span></div>`;
  },
  _ckBody(p) {
    const gs = this._ckGroups(p);
    if (gs.length === 1 && !gs[0].meat) return gs[0].lines.map(l => this._ckRow(p, l)).join('');   // aucune viande connue : liste simple
    return gs.map((g, i) => `<div class="ck-grpwrap">${this._ckGrpHead(p, g, i)}${g.lines.map(l => this._ckRow(p, l)).join('')}</div>`).join('');
  },
  _ckKnown(p) {
    const m = new Map();
    (p.lines || []).forEach(x => { const k = String(x.lot || '').trim(); if (k) m.set(k, x.dluo || m.get(k) || ''); });
    return [...m].map(([lot, dluo]) => ({ lot, dluo }));
  },
  _ckLot(p, l) {
    return `<div class="ck-lot"><input id="ck_lot_${l.id}" class="ck-lot-in" placeholder="N° de lot" autocomplete="off" value="${U.esc(l.lot || '')}" onchange="Achats.ckLot('${p.id}','${l.id}',this.value)"><input id="ck_dl_${l.id}" type="date" value="${U.esc(l.dluo || '')}" onchange="Achats.ckDluo('${p.id}','${l.id}',this.value)"><div class="ck-chips" id="ckc_${l.id}">${this._ckChips(p, l)}</div></div>`;
  },
  _ckChips(p, l) {
    const ks = this._ckKnown(p); if (!ks.length || (ks.length === 1 && ks[0].lot === (l.lot || '').trim())) return '';
    return ks.map(k => `<button type="button" class="ck-chip${k.lot === (l.lot || '').trim() ? ' on' : ''}" onclick="Achats.ckPick('${p.id}','${l.id}',this.dataset.lot)" data-lot="${U.esc(k.lot)}">${U.esc(k.lot)}${k.dluo ? ' · ' + U.frDate(k.dluo) : ''}</button>`).join('');
  },
  _ckRefreshChips(p) { this._ckLines(p).forEach(l => { const c = document.getElementById('ckc_' + l.id); if (c) c.innerHTML = this._ckChips(p, l); }); },
  _ckProg(p) { const n = this._ckLines(p).filter(l => (p.chk || {})[l.id] === 1).length; return n ? ` (${n}/${this._ckLines(p).length})` : ''; },
  _ckCount(p) {
    const ls = this._ckLines(p), c = p.chk || {}, ok = ls.filter(l => c[l.id] === 1).length;
    return `<span id="ckCount" class="ck-count${ok === ls.length ? ' done' : ''}">${ok} / ${ls.length} reçus</span>`;
  },
  checklist(pid) {
    const p = this._ckGet(pid); if (!p) return;
    const ls = this._ckLines(p), team = App.isTeam;
    if (!ls.length) { U.toast('Cette commande n\'a aucune ligne avec une quantité.', true); return; }
    // Équipe : ni fournisseur ni facture (titre = date de la commande) ; « Terminé » ferme seulement, la réception en stock reste à l'admin.
    const title = team ? `📋 Commande du ${U.frDate(p.date)}` : `📋 Checklist · ${U.esc(this.supplierLabel(p))}`;
    const bg = U.modal({ title: `${title} ${this._ckCount(p)}`, okLabel: team ? '✔ Terminé' : '📦 Réceptionner', body: `<div class="ck-list">${this._ckBody(p)}</div>`, onOk: () => { U.closeModal(); if (team) App.rerender(); else this.edit(pid); }, onCancel: () => App.rerender() });
    bg.querySelector('.modal').classList.add('ck-xl');
  },
  /* ===== Réception par l'équipe (Antho 2026-11-04) =====
     L'équipe n'a pas le droit de lire les achats (prix, fournisseurs, factures). Domaine `receptions` = copie SANS PRIX des commandes « à recevoir » :
     { id (= facture), date, upd, chk, lines:[{id, label, qty, unit, cat, meat, lot, dluo}] }. L'équipe y coche / saisit lots et DLUO (page « Réception », `renderReception`) ;
     l'admin garde les achats et reprend ces saisies (la plus récente gagne : `p.ckUpd` côté facture, `r.upd` côté copie). Appelée au chargement des données et à chaque
     enregistrement d'achat (hook de `Store.save`) ; ne fait rien pour un profil équipe / visite. */
  syncReceptions() {
    const role = Store.session && Store.session.user && Store.session.user.app_metadata && Store.session.user.app_metadata.role;
    if (role === 'team' || role === 'viewer' || this._rsync) return;
    this._rsync = true;
    try {
      const recs = Store.state.receptions || [], out = [];
      let pulled = false;
      this.list().filter(p => p.pending).forEach(p => {
        const ls = this._ckLines(p), r = recs.find(x => x.id === p.id);
        if (r && (r.upd || 0) > (p.ckUpd || 0)) {   // l'équipe a saisi plus récemment : on reprend coches, lots et DLUO dans la facture
          ls.forEach(l => { const rl = (r.lines || []).find(x => x.id === l.id); if (rl) { l.lot = rl.lot || ''; l.dluo = rl.dluo || ''; } });
          p.chk = Object.assign({}, r.chk || {}); p.ckUpd = r.upd; pulled = true;
        }
        out.push({ id: p.id, date: p.date, upd: p.ckUpd || 0, chk: Object.assign({}, p.chk || {}), lines: ls.map(l => ({ id: l.id, label: l.label, qty: l.qty, unit: l.unit || '', cat: l.cat, meat: this._ckMeat(l), lot: l.lot || '', dluo: l.dluo || '' })) });
      });
      if (JSON.stringify(out) !== JSON.stringify(recs)) { Store.state.receptions = out; Store.save('receptions'); }
      if (pulled) { Store.save('purchases'); if (App.current === 'achats' && this.mode !== 'edit' && !Store._modalOpen()) try { App.rerender(); } catch (e) { console.error(e); } }
    } finally { this._rsync = false; }
  },
  /* Page « Réception » (profil équipe, à la place d'Achats) : commandes à recevoir, sans montant ni fournisseur. */
  renderReception() {
    const rows = (Store.state.receptions || []).slice().sort((a, b) => b.date.localeCompare(a.date));
    App.mount(`<div class="view-title"><h1>📦 Réception</h1><span class="sub">commandes à contrôler</span></div>
      <div class="card" style="border-left:4px solid var(--warn);"><h2>Commandes à recevoir (${rows.length})</h2>
      <p class="muted help" style="font-size:.85rem;">À la livraison : ouvre la checklist, coche chaque produit bien présent dans le colis, et note le n° de lot et la date de péremption. Ce qui n'est pas coché est considéré comme manquant. Tout est enregistré automatiquement.</p>
      ${rows.length ? rows.map(r => { const n = this._ckLines(r).length, ok = this._ckLines(r).filter(l => (r.chk || {})[l.id] === 1).length; return `<div style="padding:10px 0;border-bottom:1px solid var(--row-border);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;">
        <div><b>Commande du ${U.frDate(r.date)}</b> <span class="muted">· ${n} produit(s)</span></div>
        <button class="btn-cta btn-sm" onclick="Achats.checklist('${r.id}')">📋 Checklist${ok ? ` (${ok}/${n})` : ''}</button></div>`; }).join('') : '<p class="muted">Aucune commande à recevoir pour le moment.</p>'}</div>`);
  },
  ckSet(pid, lid) {
    const p = this._ckGet(pid), l = p && (p.lines || []).find(x => x.id === lid); if (!l) return;
    p.chk = p.chk || {};
    if (p.chk[lid] === 1) delete p.chk[lid]; else p.chk[lid] = 1;
    this._ckSave(p);
    const el = document.getElementById('ck_' + lid); if (el) el.outerHTML = this._ckRow(p, l);
    const c = document.getElementById('ckCount'); if (c) c.outerHTML = this._ckCount(p);
    const gs = this._ckGroups(p), gi = gs.findIndex(g => g.lines.includes(l)), h = document.getElementById('ckg_' + gi); if (h) h.outerHTML = this._ckGrpHead(p, gs[gi], gi);
  },
  _ckGet(pid) { return App.isTeam ? (Store.state.receptions || []).find(x => x.id === pid) : this.list().find(x => x.id === pid); },
  _ckSave(p) { if (App.isTeam) { p.upd = Date.now(); Store.save('receptions'); } else { p.ckUpd = Date.now(); Store.save('purchases'); } },
  /* Un n° de lot / une DLUO saisis = la ligne est bien arrivée : elle se coche toute seule (Antho 2026-11-04). Mise à jour légère de l'affichage (la ligne n'est pas redessinée : le focus reste dans les champs). */
  _ckAuto(p, l) {
    p.chk = p.chk || {}; if (p.chk[l.id] === 1) return;
    p.chk[l.id] = 1;
    const row = document.getElementById('ck_' + l.id); if (row) { row.classList.add('ok'); const b = row.querySelector('.ck-box'); if (b) b.textContent = '✔'; }
    const c = document.getElementById('ckCount'); if (c) c.outerHTML = this._ckCount(p);
    const gs = this._ckGroups(p), gi = gs.findIndex(g => g.lines.includes(l)), h = document.getElementById('ckg_' + gi); if (h) h.outerHTML = this._ckGrpHead(p, gs[gi], gi);
  },
  _ckLine(pid, lid) { const p = this._ckGet(pid), l = p && (p.lines || []).find(x => x.id === lid); return l ? { p, l } : null; },
  ckLot(pid, lid, v) {
    const r = this._ckLine(pid, lid); if (!r) return;
    const { p, l } = r, lot = String(v || '').trim(), had = this._ckKnown(p).find(k => k.lot === lot);
    l.lot = lot;
    if (lot && !l.dluo && had && had.dluo) { l.dluo = had.dluo; const d = document.getElementById('ck_dl_' + lid); if (d) d.value = l.dluo; }   // même lot = même DLUO : reprise automatique
    if (lot) this._ckAuto(p, l); this._ckSave(p); this._ckRefreshChips(p);
  },
  ckDluo(pid, lid, v) {
    const r = this._ckLine(pid, lid); if (!r) return;
    r.l.dluo = String(v || ''); if (r.l.dluo) this._ckAuto(r.p, r.l); this._ckSave(r.p); this._ckRefreshChips(r.p);
  },
  ckPick(pid, lid, lot) {
    const r = this._ckLine(pid, lid); if (!r) return;
    const { p, l } = r, k = this._ckKnown(p).find(x => x.lot === lot); if (!k) return;
    l.lot = k.lot; if (k.dluo) l.dluo = k.dluo;
    const a = document.getElementById('ck_lot_' + lid), d = document.getElementById('ck_dl_' + lid);
    if (a) a.value = l.lot; if (d) d.value = l.dluo || '';
    this._ckAuto(p, l); this._ckSave(p); this._ckRefreshChips(p);
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
          <div>${dist.length ? Object.entries(by).map(([k, q]) => `<span class="badge info">${U.esc(k)} : ${U.qty(q)}</span>`).join(' ') + ` <span class="muted">= ${U.qty(sum)} pièce(s)</span>` + (() => { const pi = this.ppkInfo(l, sum); return pi ? (this._ppkAlert(pi) ? this._ppkBadge(pi) : ` <span class="muted" title="Pièces rangées ÷ kg achetés, comparé à la fiche prix">📏 ${U.qty(pi.measured)} pièces/kg ✓</span>`) : ''; })() : '<span class="muted">rien de rangé pour l\'instant</span>'}</div>
          <div style="white-space:nowrap;text-align:right;"><a class="btn btn-ghost btn-sm" style="text-decoration:none;" href="#/stock/mastication/${l.ref}">Ouvrir le produit</a> <button class="btn-cta btn-sm" onclick="Achats.closeRecv('${p.id}','${l.id}')" ${dist.length ? '' : 'disabled'}>✔ Terminer le tri</button></div></div>`;
      }).join('')}</div>`;
  },
  closeRecv(pid, lid) {
    const p = this.list().find(x => x.id === pid), l = p && p.lines.find(x => x.id === lid); if (!l || !l.recv) return;
    const r = l.recv, dist = r.dist || [], sum = dist.reduce((a, d) => a + U.num(d.qty), 0), eff = this._effHT(p)[p.lines.indexOf(l)];
    const kg = String(l.unit || '').toLowerCase() === 'kg';
    U.modal({ title: 'Terminer le tri — ' + U.esc(l.label), okLabel: 'Terminer le tri', body: `
      <p>${U.qty(l.qty)} ${U.esc(l.unit || '')} acheté(s) · ${U.qty(sum)} pièce(s) rangée(s) en stock.</p>
      <div class="frow"><div class="fg"><label>Pièces triées au total</label><input id="rc_pieces" type="number" step="1" min="1" value="${sum}" oninput="Achats._rcPpk('${p.id}','${l.id}')"></div>
      <div class="fg"><label>Pertes / déchets (${kg ? 'kg' : 'pièces'}, option)</label><input id="rc_loss" type="number" step="any" min="0" value="${U.num(r.loss) || ''}" placeholder="0"></div></div>
      <p class="muted">Le coût réel par pièce = total HT de la ligne (hors livraison, ${U.eur(eff)}) ÷ pièces triées. Il est appliqué aux lots de cette réception. La livraison est comptée à part, comme une charge, dans la Compta.${kg ? ' Le poids moyen par pièce est calculé aussi.' : ''}</p>
      <div id="rc_ppk"></div>`,
      onOk: () => {
        const pieces = U.numVal('rc_pieces'), loss = U.numVal('rc_loss');
        if (!(pieces > 0)) { U.toast('Indique le nombre de pièces triées.', true); return false; }
        const ht = Math.round(eff / pieces * 10000) / 10000;
        const snaps = [Store.snapshot('purchases', p)], sp = Store.state.stockM.find(x => x.id === l.ref);
        if (sp) snaps.push(Store.snapshot('stockM', sp));
        // « Mettre à jour la fiche prix » (case cochée par Antho dans l'alerte) : « Pièces / kilo » du fournisseur principal = valeur mesurée
        const pi = this.ppkInfo(l, pieces), upd = document.getElementById('rc_ppk_upd');
        let ppkUpdated = false;
        if (pi && upd && upd.checked) {
          const main = Pricing.mainEntry(pi.cat, p.supplierId);   // la ligne du fournisseur de cette facture
          if (main) { snaps.push(Store.snapshot('catalogM', pi.cat)); main.piecesPerKilo = pi.measured; ppkUpdated = true; }
        }
        let n = 0;
        dist.forEach(d => { (sp ? sp.variants : []).forEach(v => (v.lots || []).forEach(lot => { if (lot.id === d.lotId) { lot.costUnit = Math.round(ht * Stock.buyK(sp, v) * 10000) / 10000; lot.costFinal = true; n++; } })); });
        Object.assign(r, { closed: true, closedAt: Date.now(), pieces, loss, costPerPiece: ht, avgG: kg ? Math.round((U.num(l.qty) - loss) * 1000 / pieces) : 0 });
        const entry = Store.log('achat', `Tri terminé — ${l.label} (${U.qty(pieces)} pièces, ${U.eur(ht)} HT / pièce)${ppkUpdated ? ' · fiche prix : ' + U.qty(pi.measured) + ' pièces/kg' : ''}`, { type: 'restoreBatch', data: snaps });
        Store.save(...(ppkUpdated ? ['purchases', 'stockM', 'catalogM'] : ['purchases', 'stockM'])); U.closeModal(); this.render();
        U.toast(`Tri terminé : ${U.eur(ht)} HT / pièce${r.avgG ? ' · ' + r.avgG + ' g en moyenne' : ''} · ${n} lot(s) mis à jour${ppkUpdated ? ' · fiche prix : ' + U.qty(pi.measured) + ' pièces/kg' : ''}.`, false, entry.id);
      } });
    this._rcPpk(pid, lid);
  },
  /* Pièces / kilo mesuré, en direct dans « Terminer le tri » (pièces saisies ÷ kg achetés) — avec, si ça diffère de la fiche prix, la case « Mettre à jour la fiche prix » (jamais cochée d'office) */
  _rcPpk(pid, lid) {
    const box = document.getElementById('rc_ppk'); if (!box) return;
    const p = this.list().find(x => x.id === pid), l = p && p.lines.find(x => x.id === lid); if (!l) return;
    const pi = this.ppkInfo(l, U.numVal('rc_pieces'));
    if (!pi) { box.innerHTML = ''; return; }
    const m = U.qty(pi.measured), checked = (document.getElementById('rc_ppk_upd') || {}).checked ? 'checked' : '';
    box.innerHTML = pi.level === 'ok'
      ? `<p class="muted" style="margin:8px 0 0;">📏 ${m} pièces / kg — conforme à la fiche prix (${U.qty(pi.fiche)}).</p>`
      : `<div style="margin-top:10px;padding:10px 12px;border-radius:8px;border:1.5px solid var(--${pi.level === 'bad' ? 'alerte' : 'warn'});">
          <b>📏 ${m} pièces / kg</b> (${U.qty(U.numVal('rc_pieces'))} pièces ÷ ${U.qty(l.qty)} kg) — ${pi.level === 'empty' ? 'la fiche prix n\'a pas de « Pièces / kilo ».' : `ta fiche prix dit <b>${U.qty(pi.fiche)}</b> (${pi.delta > 0 ? '+' : ''}${U.qty(pi.delta)}). Vérifie le nombre de pièces saisi, ou corrige la fiche.`}
          <label style="display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer;"><input type="checkbox" id="rc_ppk_upd" ${checked}> Mettre à jour la fiche prix « ${U.esc(pi.cat.name)} » : Pièces / kilo = ${m}</label></div>`;
  },
  _detailRow(p) {
    const lines = (p.lines || []).map(l => {
      const c = this.cat(l.cat);
      return `<div style="display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr) auto;gap:10px;padding:5px 0;border-bottom:1px solid var(--row-border);">
        <span>${c.ico} <b>${U.esc(l.label)}</b>${l.lot ? ` <span class="badge info">lot ${U.esc(l.lot)}${l.dluo ? ' · DLUO ' + U.frDate(l.dluo) : ''}</span>` : ''}${l.applied ? ` <span class="badge info" title="Quantité ajoutée au stock à l'enregistrement">📥 +${U.qty(l.applied.qty)} en stock</span>` : ''}${l.priceCmp && l.priceCmp.cheaper ? ` <span class="badge warn" title="Un autre fournisseur de la fiche prix est moins cher">💡 moins cher chez ${U.esc(l.priceCmp.cheaper.name)}</span>` : ''}${this._chg(l) ? ` <span class="badge warn" title="${this._chgInfo(l).fiche ? 'Fiche prix' : 'Coût HT par unité'} : ${U.eur(this._chgInfo(l).from)} → ${U.eur(this._chgInfo(l).to)}">💶 prix ${this._chg(l) > 0 ? '↑ +' : '↓ '}${Math.round(this._chg(l) * 10) / 10} %</span>` : ''}${l.recv ? (l.recv.closed ? ` <span class="badge info" title="Coût réel figé sur les lots">✔ tri terminé · ${U.qty(l.recv.pieces)} pièces · ${U.eur(l.recv.costPerPiece)} HT/pièce${l.recv.avgG ? ' · ' + l.recv.avgG + ' g/pièce' : ''}</span>` : ` <span class="badge warn">📥 à ranger${(l.recv.dist || []).length ? ' · ' + (l.recv.dist || []).length + ' lot(s) rangé(s)' : ''}</span>`) : ''}${l.recv && l.recv.closed ? this._ppkBadge(this.ppkInfo(l, l.recv.pieces)) : ''}${U.num(l.years) ? ` <span class="badge info">amorti sur ${U.num(l.years)} an(s)</span>` : ''}</span>
        <span class="muted">${c.detail ? U.qty(l.qty) + ' ' + U.esc(l.unit || '') + ' × ' + U.eur(l.price) : c.label}</span>
        <span class="sensitive" style="text-align:right;white-space:nowrap;"><b>${U.eur(this.lineTotal(l))}</b></span></div>`;
    }).join('');
    const ht = this.isHT(p) ? ' HT' : '';
    const extra = [this.isHT(p) ? 'Prix saisis HT' : '', U.num(p.shipping) ? `Livraison : ${U.eur(p.shipping)}${ht}` : '', U.num(p.discount) ? `Remise : − ${U.eur(p.discount)}${p.discTTC ? ' TTC' : ht}` : '', this.isHT(p) ? 'TVA : ' + ((p.vat || []).map(v => U.qty(v.rate) + ' % = ' + U.eur(v.amount)).join(' + ') || '0 €') + ` → payé ${U.eur(this.grandTotal(p))} TTC` : ''].filter(Boolean).join(' · ');
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
    Store.save('purchases', 'consumables', 'materials', 'stockM'); this.reconcileEquip(); this.render();
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
    if (k === 'discTTC') { this._autoVat(); this._touch(); this.render(); }
    if (k === 'payment' || k === 'pending') this.render();
  },
  /* TVA en HT : une seule ligne « auto » = base HT × taux (modifiable) ; dès qu'on tape un montant ou qu'on ajoute un taux, c'est à la main */
  _autoVat() {
    const d = this._d; if (!d || !this.isHT(d)) return; const v = d.vat || [];
    if (v.length !== 1) return;
    if (v[0].auto || !U.num(v[0].amount)) { v[0].auto = true; v[0].amount = this.r2(this.base(d) * U.num(v[0].rate) / 100); }
    else { const b = this.base(d); if (b > 0) v[0].rate = Math.round(U.num(v[0].amount) / b * 10000) / 100; }   // montant tapé : le taux affiché suit
  },
  /* Un seul taux : taper le taux calcule le montant, taper le montant calcule le taux (sur le total HT). Plusieurs taux : chacun à la main. */
  setVat(i, f, val) {
    const d = this._d, v = d.vat[i]; if (!v) return; v[f] = U.num(val);
    if (d.vat.length === 1) { if (f === 'amount') { v.auto = false; this._autoVat(); } else { v.auto = true; this._autoVat(); } }
    else if (f === 'amount') v.auto = false;
    this._touch(); this._refreshTotals();
    const o = document.getElementById(f === 'rate' ? 'ach_vatamt_' + i : 'ach_vatrate_' + i); if (o && d.vat.length === 1) o.value = (f === 'rate' ? v.amount : v.rate) || '';
  },

  delVat(i) { this._d.vat.splice(i, 1); this._touch(); this.render(); },
  setVatRate(v) { this._d.vatRate = String(v).trim() === '' ? '' : U.num(v); this._touch(); },
  /* Catégories de ligne proposées pour un fournisseur (Antho 2026-10-28 : « chez ce fournisseur je ne peux pas acheter une autre catégorie ») :
     celles qui correspondent à ses types (Paramètres → Fournisseurs) — mastication / matière / consommable ; « autre » = investissement, outillage, frais.
     Sans fournisseur choisi : toutes. */
  _catType(id) { return id === 'mastication' || id === 'matiere' || id === 'conso' ? id : 'autre'; },
  _catsFor(supplierId) {
    const s = supplierId ? (Store.state.settings.suppliers || []).find(x => x.id === supplierId) : null;
    if (!s) return this.CATS;
    const t = Store.supplierTypes(s), list = this.CATS.filter(c => t.includes(this._catType(c.id)));
    return list.length ? list : this.CATS;
  },
  /* Fournisseur choisi : les lignes encore VIDES (ni produit, ni désignation, ni prix) prennent une catégorie vendue par ce fournisseur ; une ligne déjà remplie n'est jamais modifiée. */
  _adaptLinesToSupplier(fromPick) {
    const d = this._d, ok = this._catsFor(d.supplierId).map(c => c.id); if (!ok.length) return false;
    let changed = false;
    d.lines.forEach(l => {
      const empty = !l.ref && !String(l.label || '').trim() && !U.num(l.price);
      if (fromPick) delete l.catManual;   // choisir le fournisseur reprend la main sur les lignes encore vides
      if (empty && !l.catManual && !ok.includes(l.cat)) {
        const c = this.cat(ok[0]);
        l.cat = c.id; l.ref = ''; l.toStock = false;
        if (!c.detail) { l.qty = 1; l.unit = ''; } else l.unit = c.id === 'mastication' ? 'kg' : 'pièce';
        changed = true;
      }
    });
    if (!ok.includes(this._lastCat)) this._lastCat = ok[0];
    return changed;
  },
  _pickSup(sel) {
    if (sel.value !== '__new') {
      this._d.supplierId = sel.value; this._touch();
      const s = (Store.state.settings.suppliers || []).find(x => x.id === sel.value);   // reprend le dernier taux de TVA utilisé avec ce fournisseur
      const sv = s ? (s.vatRate !== undefined && s.vatRate !== '' ? s.vatRate : s.purchaseVatRate) : undefined;   // dernier taux utilisé, sinon TVA d'achat du fournisseur (Paramètres)
      if (sv !== undefined && sv !== '' && (this._d.vatRate === undefined || this._d.vatRate === '')) { this._d.vatRate = U.num(sv); this._touch(); }
      this._adaptLinesToSupplier(true);
      this._touch();   // enregistrer le brouillon APRÈS le changement de catégorie, sinon F5 ramène l'ancienne
      this.render();
      return;
    }
    sel.value = this._d.supplierId || '';
    const pre = this._supTypesFromLines(this._d);   // types proposés d'après les catégories des lignes (modifiables)
    const chk = Store.SUPPLIER_TYPES.map(t => `<label style="display:inline-flex;gap:5px;align-items:center;margin-right:12px;text-transform:none;letter-spacing:0;font-size:.9rem;white-space:nowrap;"><input type="checkbox" class="ach_newsup_t" style="width:auto;" value="${t.v}" ${pre.includes(t.v) ? 'checked' : ''}> ${t.l}</label>`).join('');
    U.modal({ title: 'Nouveau fournisseur', body: `<div class="fg"><label>Nom du fournisseur</label><input id="ach_newsup" placeholder="ex : un nouvel éleveur, Amazon, magasin de bricolage…" onkeydown="if(event.key==='Enter')document.getElementById('modalOk').click()"></div><div class="fg mt"><label>Il te vend…</label><div style="display:flex;flex-wrap:wrap;gap:6px 0;">${chk}</div></div><p class="muted" style="font-size:.82rem;">Les types servent à filtrer : les fiches prix ne proposent que les fournisseurs « Mastication ». Modifiable ensuite dans Paramètres → Référentiels.</p>`, okLabel: 'Ajouter',
      onOk: () => {
        const n = U.val('ach_newsup').trim(); if (!n) { U.toast('Donne un nom au fournisseur.', true); return false; }
        const types = [...document.querySelectorAll('.ach_newsup_t')].filter(c => c.checked).map(c => c.value);
        if (!types.length) { U.toast('Coche au moins un type.', true); return false; }
        const S = Store.state.settings; let s = S.suppliers.find(x => x.name.toLowerCase() === n.toLowerCase());
        if (!s) { s = { id: U.uid(), name: n, types }; S.suppliers.push(s); Store.save('settings'); }
        this._d.supplierId = s.id; this._touch(); this.render();
      } });
    setTimeout(() => { const i = document.getElementById('ach_newsup'); if (i) i.focus(); }, 50);
  },
  addLine() {
    const ok = this._catsFor(this._d.supplierId).map(c => c.id), prev = this._d.lines.length ? this._d.lines[this._d.lines.length - 1].cat : this._lastCat;
    const l = this._newLine(ok.includes(prev) ? prev : ok.includes(this._lastCat) ? this._lastCat : ok[0]);   // même catégorie que la ligne d'avant si ce fournisseur la vend
    this._d.lines.push(l); this._touch(); this.render();
  },
  delLine(i) { this._d.lines.splice(i, 1); if (!this._d.lines.length) this._d.lines.push(this._newLine(this._lastCat)); this._touch(); this.render(); },
  setLineCat(i, v) {
    const l = this._d.lines[i], c = this.cat(v);
    if (l.cat !== c.id) { if (l.cat === 'mastication' && l.unit === 'kg') l.unit = ''; l.cat = c.id; l.ref = ''; if (!c.detail) { l.qty = 1; l.unit = ''; } else if (!l.unit && c.id === 'mastication') l.unit = 'kg'; }
    delete l.tot; if (l.unit === 'rouleau' || l.unit === 'lot') l.unit = c.id === 'mastication' ? 'kg' : c.detail ? 'pièce' : ''; l.catManual = true; this._lastCat = c.id; this._touch(); this.render();
  },
  pickLink(i, v) {
    const l = this._d.lines[i], c = this.cat(l.cat); l.ref = v;
    l.toStock = !!v && (c.link === 'C' || c.link === 'T' || c.id === 'mastication') && this._recent(this._d.date);   // d'office (sauf facture ancienne)
    l.vId = c.id === 'mastication' ? this._soleVariant(v) : '';   // achat à la pièce : la taille est proposée d'office quand le produit n'en a qu'une
    if (v) {
      const name = this.itemName(c.link, v); if (name && (!String(l.label || '').trim() || l.label === l._auto)) { l.label = name; l._auto = name; }   // la désignation suit le produit choisi tant que tu ne l'as pas retapée
      if (c.link === 'T') { const m = Store.state.materials.find(x => x.id === v); if (m) { if (this._rollLen(m)) l.unit = 'rouleau'; else if (this._lotLen(m)) l.unit = 'lot'; else if (!l.unit || l.unit === 'rouleau' || l.unit === 'lot') l.unit = this.unitFrom(m.unit); } }   // sangle au rouleau : on saisit un nombre de rouleaux
      if (c.link === 'C') { const k = Store.state.consumables.find(x => x.id === v); if (k) { if (U.num(k.costQtyPer) > 1) l.unit = 'lot'; else if (!l.unit || l.unit === 'lot') l.unit = this.unitFrom(k.unit); } }   // fiche « prix / 100 » : on achète des lots de 100
    }
    this._touch(); this.render();
  },
  /* Mastication : le lot et la DLUO sont TOUJOURS suivis (Antho 2026-10-29, plus de case « À ranger »).
     Acheté à la PIÈCE (ou à la taille) → la quantité entre tout de suite en stock, dans la taille choisie, avec n° de lot et DLUO (`_directOf`).
     Acheté au KILO → il est reconditionné chez lui : proposé dans Stock → « ＋ Ajouter un lot » (lot et DLUO pré-remplis), aucune quantité tant qu'il n'a pas rangé. */
  _stockVariants(pId) {
    const sp = (Store.state.stockM || []).find(x => x.id === pId);
    return sp ? sp.variants.filter(v => !Stock.isVirtual(sp, v)).sort((a, b) => U.sortFr(Pricing.labelVariant(a), Pricing.labelVariant(b))) : [];
  },
  _soleVariant(pId) { const vs = this._stockVariants(pId); return vs.length === 1 ? vs[0].id : ''; },
  _directOf(l) {
    if (l.cat !== 'mastication' || !l.toStock || !l.ref || !l.vId || this.unitFrom(l.unit) !== 'pièce' || !(Math.round(U.num(l.qty)) > 0)) return null;
    const sp = (Store.state.stockM || []).find(x => x.id === l.ref), v = sp && sp.variants.find(x => x.id === l.vId);
    return v && !Stock.isVirtual(sp, v) ? { sp, v } : null;
  },
  setVar(i, v) { this._d.lines[i].vId = v; this._touch(); this.render(); },
  /* « ＋ » du menu « Matière / Consommable du stock » : fenêtre de création vide (comme dans Stock), puis la ligne se lie à la nouvelle fiche.
     La quantité de la facture s'ajoute au stock à l'enregistrement : laisser « Quantité en stock » à 0 dans cette fenêtre. */
  newItem(i) {
    const l = this._d && this._d.lines[i]; if (!l) return;
    const done = it => { const ix = this._d.lines.findIndex(x => x.id === l.id); if (ix >= 0) this.pickLink(ix, it.id); };
    if (l.cat === 'matiere') Stock.editMat(null, null, null, done); else if (l.cat === 'conso') Stock.editConso(null, done); else if (l.cat === 'mastication') Stock.editProduct(null, done);
  },
  setToStock(i, on) { this._d.lines[i].toStock = !!on; this._touch(); this.render(); },
  setText(i, k, v) { const l = this._d.lines[i]; l[k] = String(v || '').trim(); if (k === 'unit' && l.cat === 'mastication' && l.ref && !l.vId) l.vId = this._soleVariant(l.ref); this._touch(); if (k === 'unit') this.render(); },   // l'unité (rouleau ⇄ m) change l'aperçu du stock et le prix au mètre
  setNum(i, k, v) {
    const l = this._d.lines[i];
    if (k === 'qty' && this._totalMode(l)) { if (l.tot === undefined) l.tot = this.lineTotal(l); l.qty = U.num(v); l.price = l.qty > 0 ? l.tot / l.qty : 0; }   // changer la quantité garde le prix de la ligne
    else l[k] = U.num(v);
    this._touch(); this._refreshTotals();
  },
  _refreshTotals() {
    const d = this._d; if (!d) return;
    d.lines.forEach((l, i) => {
      const e = document.getElementById('ach_lt_' + i), u = document.getElementById('ach_upin_' + i);
      if (e) { if (e.tagName === 'INPUT') { if (document.activeElement !== e) e.value = this.lineTotal(l) || ''; } else e.textContent = U.eur(this.lineTotal(l)); }
      if (u && document.activeElement !== u) u.value = l.price ? Math.round(l.price * 10000) / 10000 : '';   // total tapé : le prix à l'unité suit
    });
    d.lines.forEach((l, i) => { const e = document.getElementById('ach_pv_' + i); if (e) e.textContent = this._pvText(l); });
    d.lines.forEach((l, i) => { const e = document.getElementById('ach_ph_' + i); if (e) e.textContent = this._phText(l); });
    d.lines.forEach((l, i) => { const e = document.getElementById('ach_up_' + i); if (e) e.textContent = this._upText(l); });
    d.lines.forEach((l, i) => { const e = document.getElementById('ach_tt_' + i); if (e) e.textContent = this._ttcOf(this.lineTotal(l)); });
    { const e = document.getElementById('ach_shiptt'); if (e) e.textContent = this._ttcOf(d.shipping); }
    this._autoVat();
    if ((d.vat || []).length === 1) { const a = document.getElementById('ach_vatamt_0'), r = document.getElementById('ach_vatrate_0'); if (a && document.activeElement !== a) a.value = d.vat[0].amount || ''; if (r && document.activeElement !== r) r.value = d.vat[0].rate || ''; }
    const s = document.getElementById('ach_sub'), t = document.getElementById('ach_tot'), b = document.getElementById('ach_base'), v = document.getElementById('ach_vat');
    if (s) s.textContent = U.eur(this.subTotal(d)); if (t) t.textContent = U.eur(this.grandTotal(d));
    if (b) b.textContent = U.eur(this.base(d)); if (v) v.textContent = U.eur(this.vatSum(d));
  },
  _linkOpts(kind, cur) {   // trois colonnes comme le choix de consommable des Ventes : nom · dimensions / variante · stock (et coût)
    let items;
    if (kind === 'M') items = (Store.state.stockM || []).map(p => {
      const n = (p.variants || []).filter(v => !Stock.isVirtual(p, v)).reduce((t, v) => t + (v.lots || []).reduce((q, l) => q + U.num(l.qtyGeneral) + U.num(l.qtyEvent), 0), 0);
      // références des fournisseurs de la fiche prix liée (celles de la facture : « RFellstrKU5000 ») : cherchables ici comme dans Prix mastication
      const cats = [...new Set([p.catalogId].concat((p.variants || []).map(v => v.catalogId)).filter(Boolean))].map(id => (Store.state.catalogM || []).find(x => x.id === id)).filter(Boolean);
      const refs = Store.hideSupplierInfo() ? '' : cats.map(c => (c.suppliers || []).map(s => s.ref || '').join(' ')).join(' ');
      return { id: p.id, a: p.name, b: p.meatType || '', c: 'stock ' + U.qty(n), s: [p.sku, refs].concat((p.variants || []).map(v => [v.sku, v.ref, v.label].join(' '))).join(' ') };
    });
    // `s` = mots de recherche non affichés : référence fournisseur et SKU (le fournisseur peut nommer / colorier un produit autrement que toi)
    else if (kind === 'T') items = (Store.state.materials || []).map(m => ({ id: m.id, a: m.product || m.name || '', b: m.product ? (m.variant || m.name || '') : (m.variant || ''), c: 'stock ' + U.qty(m.qty) + ' ' + this.unitFrom(m.unit) + (U.num(m.costUnit) ? ' · ' + U.eur(m.costUnit) + '/u' : ''), s: [m.name, m.product, m.variant, m.sku, m.ref].join(' ') }));
    else items = (Store.state.consumables || []).map(c => ({ id: c.id, a: c.name, b: Stock.consoDims(c), c: 'stock ' + U.qty(c.qty) + (U.num(c.costUnit) ? ' · ' + U.eur(c.costUnit) + '/u' : ''), vol: Stock._dimVolume(Stock.consoDims(c)), s: [c.dimensions, c.sku, c.ref].join(' ') }));
    items.sort((x, y) => U.sortFr(x.a, y.a) || (U.num(x.vol) - U.num(y.vol)) || U.sortFr(x.b, y.b));
    return `<option value="">— choisir (optionnel) —</option>` + items.map(o => `<option value="${U.esc(o.id)}" data-a="${U.esc(o.a)}" data-b="${U.esc(o.b)}" data-c="${U.esc(o.c)}" data-s="${U.esc(o.s || '')}" ${o.id === cur ? 'selected' : ''}>${U.esc([o.a, o.b, o.c].filter(Boolean).join(' — '))}</option>`).join('');
  },
  _pvText(l) {
    const pv = this._stockPreview(l); if (!pv) return '';
    const pack = this._packOf(l, pv.it);
    const roll = l.cat === 'matiere' && l.unit === 'rouleau' && pack > 1;
    return (l.applied ? 'déjà ajouté · ' : '') + U.qty(pv.cur) + ' → ' + U.qty(pv.after) + (roll ? ' m · ' + U.qty(U.num(l.qty)) + ' rouleau' + (U.num(l.qty) > 1 ? 'x' : '') + ' de ' + U.qty(pack) + ' m' : pack > 1 ? ' · ' + U.qty(U.num(l.qty)) + ' lot' + (U.num(l.qty) > 1 ? 's' : '') + ' de ' + U.qty(pack) : '');
  },
  /* Matière / consommable : le prix saisi est celui de la LIGNE (Antho 2026-10-28) ; le prix unitaire = prix ÷ quantité (l.price, utilisé partout ailleurs). Mastication : inchangée (prix unitaire). */
  _totalMode(l) { return l.cat === 'matiere' || l.cat === 'conso'; },
  /* Facture saisie en HT : montant TTC de la ligne (HT × (1 + TVA totale / base HT)), à comparer avec la colonne « TVA inc » de la facture du fournisseur. */
  _ttcOf(amount) { const d = this._d; if (!d || !this.isHT(d)) return ''; const rates = (d.vat || []).filter(v => U.num(v.rate) > 0), f = rates.length === 1 ? 1 + U.num(rates[0].rate) / 100 : this.ttcFactor(d);   // un seul taux : HT × (1 + taux), comme sur la facture ; plusieurs taux : proportion TVA / base
    return f > 1.00001 && U.num(amount) > 0 ? '= ' + U.eur(U.num(amount) * f) + ' TTC' : ''; },
  _upText(l) { return U.num(l.qty) > 0 && U.num(l.price) > 0 ? U.eur(l.price) + (l.unit ? ' / ' + l.unit : '') : '—'; },
  /* Sangle au rouleau : prix du mètre ; consommable en lot : prix de la pièce — à comparer avec la facture du fournisseur */
  _phText(l) {
    if (!this._totalMode(l) || !(U.num(l.price) > 0)) return '';
    const it = this._item(l), pack = it ? this._packOf(l, it) : 1;
    // 3 décimales (0,118 € la pièce, 0,957 € le mètre) : c'est la précision de la facture du fournisseur
    return pack > 1 ? '= ' + (Math.round(U.num(l.price) / pack * 1000) / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) + ' € / ' + (l.unit === 'rouleau' ? 'm' : 'pièce') : '';
  },
  setLineTot(i, v) { const l = this._d.lines[i], t = U.num(v); if (this._totalMode(l)) l.tot = t; else delete l.tot; l.price = U.num(l.qty) > 0 ? t / U.num(l.qty) : 0; this._touch(); this._refreshTotals(); },
  _recvBox(l, i) {   // mastication : lot et DLUO suivis d'office ; à la pièce → stock tout de suite (taille choisie), au kilo → à ranger (voir _directOf)
    const fg = (lab, inner) => `<div class="fg"><label>${lab}</label>${inner}</div>`;
    if (!l.toStock) return fg('Stock', `<label class="ach-chk"><input type="checkbox" onchange="Achats.setToStock(${i},this.checked)"> 📥 Suivre ce lot <span class="muted help">Facture ancienne (plus de 7 jours) : rien n'est ajouté ni suivi d'office, pour ne pas compter deux fois une marchandise déjà en stock. Coche si elle n'y est pas encore.</span></label>`);
    if (this.unitFrom(l.unit) === 'pièce') {
      const opts = '<option value="">— je range moi-même —</option>' + this._stockVariants(l.ref).map(v => `<option value="${v.id}" ${v.id === l.vId ? 'selected' : ''}>${U.esc(Pricing.labelVariant(v))}</option>`).join('');
      return fg('Taille en stock', `<select onchange="Achats.setVar(${i},this.value)">${opts}</select><span class="muted help">Acheté à la pièce : la quantité entre tout de suite en stock dans cette taille, avec le n° de lot et la DLUO. « Je range moi-même » : le lot sera proposé dans Stock → « ＋ Ajouter un lot » (aucune quantité ajoutée).</span>`);
    }
    const st = l.recv ? (l.recv.closed ? 'tri terminé' : (l.recv.dist || []).length + ' lot(s) rangé(s)') : '';
    return fg('Stock', `<div class="ach-chk" style="cursor:default;">📥 À ranger${st ? ' <span class="muted">· ' + st + '</span>' : ''}</div>`);
  },
  _stockBox(l, i) {   // consommable / matière : la quantité achetée est ajoutée au stock à l'enregistrement
    if (!this._stockPreview(l)) return '';
    return `<div class="fg"><label>Stock</label><label class="ach-chk"><input type="checkbox" ${l.toStock ? 'checked' : ''} onchange="Achats.setToStock(${i},this.checked)"> 📥 Ajouter <span class="muted" id="ach_pv_${i}">${this._pvText(l)}</span> <span class="muted help">Ajoute la quantité achetée au stock de cette fiche à l'enregistrement et met à jour son coût (dernier prix payé, livraison et remise réparties). Décoche pour une facture ancienne déjà comptée. Modifier ou supprimer la facture retire la quantité ajoutée.</span></label></div>`;
  },
  /* Ligne de facture : DEUX rangées à colonnes fixes (même rangée quelle que soit la largeur de l'écran sur ordinateur) —
     rangée 1 : catégorie · produit du stock · désignation ; rangée 2 : quantité · unité · prix · total · stock · lot · DLUO.
     Tablette : rangée 2 sur 4 colonnes ; téléphone : 2 colonnes (voir .ach-r1 / .ach-r2 dans style.css). */
  _lineHTML(l, i) {
    const c = this.cat(l.cat), ht = this._d && this.isHT(this._d) ? 'HT' : 'TTC';
    const fg = (lab, inner, fr, wide, col) => ({ h: `<div class="fg${wide ? ' ach-wide' : ''}"${col ? ` style="grid-column:${col};"` : ''}><label>${lab}</label>${inner}</div>`, fr });
    const catOpts = this.CATS;   // menu libre (Antho 2026-10-28) : le fournisseur règle la catégorie d'office, mais on peut la changer à la main
    const catSel = `<select onchange="Achats.setLineCat(${i},this.value)">${catOpts.map(x => `<option value="${x.id}" ${x.id === l.cat ? 'selected' : ''}>${x.ico} ${x.label}</option>`).join('')}</select>`;
    const label = `<input value="${U.esc(l.label)}" placeholder="${c.detail ? 'désignation' : 'ex : visseuse, assurance, timbres…'}" onchange="Achats.setText(${i},'label',this.value)">`;
    const r1 = [fg('Catégorie', catSel, '1fr')], r2 = [];
    if (!c.detail) {
      r1.push(fg('Désignation', label, '3fr', true), fg('Montant (€ ' + ht + ')', `<input type="number" step="any" value="${l.price || ''}" placeholder="0" oninput="Achats.setNum(${i},'price',this.value)"><div class="muted sensitive" id="ach_tt_${i}" style="font-size:.78rem;">${this._ttcOf(this.lineTotal(l))}</div>`, '1fr'));
    } else {
      if (c.link) r1.push(fg(c.link === 'M' ? 'Produit du stock' : c.link === 'T' ? 'Matière du stock' : 'Consommable du stock', `<select onchange="Achats.pickLink(${i},this.value)" data-add data-add-line="${i}" data-add-title="${c.link === 'M' ? 'Nouveau produit de mastication' : c.link === 'T' ? 'Nouvelle matière première' : 'Nouveau consommable'}">${this._linkOpts(c.link, l.ref)}</select>`, '1.4fr'));
      r1.push(fg('Désignation', label, c.link ? '2fr' : '4fr', true));
      r2.push(fg('Quantité', `<input type="number" step="any" value="${l.qty || ''}" oninput="Achats.setNum(${i},'qty',this.value)">`, '.8fr', false, 1));
      const itL = c.id === 'matiere' || c.id === 'conso' ? this._item(l) : null;
      const units = c.id === 'conso' && l.unit === 'lot' && itL && U.num(itL.costQtyPer) > 1 ? ['lot'] : l.unit === 'rouleau' || (c.id === 'matiere' && itL && this._rollLen(itL)) ? ['rouleau', 'm'] : c.id === 'matiere' && itL && this._lotLen(itL) ? ['lot', 'pièce'] : this.UNITS;   // sangle au rouleau : rouleaux ou mètres ; consommable en lot : lots ; matière « prix / N » : lots de N ou pièces
      r2.push(fg('Unité', `<select onchange="Achats.setText(${i},'unit',this.value)">${(units.includes(l.unit) || !l.unit ? units : units.concat([l.unit])).map(u => `<option value="${U.esc(u)}" ${u === (l.unit || (c.id === 'mastication' ? 'kg' : 'pièce')) ? 'selected' : ''}>${U.esc(u)}</option>`).join('')}</select>`, '.9fr', false, 2));
      if (this._totalMode(l)) {   // matière / consommable : on tape le prix de la ligne (comme sur la facture), l'appli divise par la quantité
        const tot = l.tot !== undefined ? l.tot : (this.lineTotal(l) || '');
        r2.push(fg('Prix ligne (€ ' + ht + ')', `<input type="number" step="any" value="${tot}" placeholder="0" oninput="Achats.setLineTot(${i},this.value)">`, '1fr', false, 3));
        r2.push(fg('Prix unitaire', `<div class="ach-tot sensitive" id="ach_up_${i}">${this._upText(l)}</div><div class="muted sensitive" id="ach_ph_${i}" style="font-size:.78rem;">${this._phText(l)}</div><div class="muted sensitive" id="ach_tt_${i}" style="font-size:.78rem;">${this._ttcOf(this.lineTotal(l))}</div>`, '.9fr', false, 4));
      } else {
        // prix d'UNE unité (au kg, à la pièce…) ET total de la ligne : on tape l'un ou l'autre, l'autre se calcule (colis de 5 kg à 64,15 € = 12,83 € / kg)
        r2.push(fg('Prix / ' + (l.unit || (c.id === 'mastication' ? 'kg' : 'pièce')) + ' (€ ' + ht + ')', `<input id="ach_upin_${i}" type="number" step="any" value="${l.price ? Math.round(l.price * 10000) / 10000 : ''}" placeholder="0" oninput="Achats.setNum(${i},'price',this.value)">`, '1fr', false, 3));
        r2.push(fg('Total (€ ' + ht + ')', `<input id="ach_lt_${i}" type="number" step="any" value="${this.lineTotal(l) || ''}" placeholder="0" oninput="Achats.setLineTot(${i},this.value)"><div class="muted sensitive" id="ach_tt_${i}" style="font-size:.78rem;">${this._ttcOf(this.lineTotal(l))}</div>`, '.9fr', false, 4));
      }
      const box = (c.link === 'C' || c.link === 'T') && l.ref ? this._stockBox(l, i) : c.link === 'M' && l.ref ? this._recvBox(l, i) : '';
      if (box) r2.push({ h: box.replace('<div class="fg">', '<div class="fg" style="grid-column:5;">'), fr: '1.2fr' });
      if (c.id === 'mastication') {
        r2.push(fg('N° de lot', `<input value="${U.esc(l.lot || '')}" placeholder="n° de lot du fournisseur" onchange="Achats.setText(${i},'lot',this.value)">`, '1.3fr', false, 6));
        r2.push(fg('DLUO', `<input type="date" value="${U.esc(l.dluo || '')}" onchange="Achats.setText(${i},'dluo',this.value)">`, '1.2fr', false, 7));
      }
      if (c.id === 'equipement') r2.push(fg('Amortissement (ans, option)', `<input type="number" step="any" min="0" value="${l.years || ''}" placeholder="ex : 5" onchange="Achats.setNum(${i},'years',this.value)">`, '1.2fr', false, 6));
    }
    const row = (cls, list) => list.length ? `<div class="${cls}" style="grid-template-columns:${cls === 'ach-r2' ? '.8fr .9fr 1fr .9fr 1.2fr 1.3fr 1.2fr' : list.map(x => x.fr).join(' ')};">${list.map(x => x.h).join('')}</div>` : '';
    return `<div class="ach-line"><div class="ach-grid">${row('ach-r1', r1)}${row('ach-r2', r2)}</div><div style="text-align:right;margin-top:4px;"><button class="btn-icon" title="Retirer cette ligne" onclick="Achats.delLine(${i})">🗑️</button></div></div>`;
  },
  renderEditor() {
    this._autoVat();   // TVA calculée dès l'affichage (retour sur un brouillon, passage en HT…)
    const d = this._d, sups = this.suppliers();
    const supOpts = `<option value="">— choisir —</option>${sups.map(s => `<option value="${s.id}" data-a="${U.esc(s.name)}" data-c="${U.esc(Store.supplierTypesLabel(s))}" ${s.id === d.supplierId ? 'selected' : ''}>${U.esc(s.name)}</option>`).join('')}<option value="__new">＋ Nouveau fournisseur…</option>`;
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
          <div style="flex:0 0 auto;"><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:4px;">Prix saisis sur la facture <span class="muted help">TTC : tu tapes ce que tu as payé (le taux de TVA de la facture sert à calculer le coût HT ; vide = taux global des Paramètres). HT : le fournisseur donne les prix hors taxe et la TVA par taux en bas de page (10 %, 20 %…) : tu la saisis en bas, elle est répartie au prorata sur les lignes.</span></div><div style="display:flex;gap:6px;flex-wrap:wrap;">${mode}</div></div>
          ${(d.taxMode || 'ttc') === 'ttc' ? `<div class="fg" style="max-width:150px;"><label>TVA de la facture (%)</label><input type="number" step="0.1" min="0" value="${d.vatRate ?? ''}" placeholder="${Store.state.settings.vatRate ?? 20} (global)" title="Taux utilisé pour ramener cette facture en HT. Il est retenu pour ce fournisseur." onchange="Achats.setVatRate(this.value)"></div>` : ''}
          <div style="flex:0 0 auto;"><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:4px;">Moyen de paiement</div><div style="display:flex;gap:6px;flex-wrap:wrap;">${pay}</div></div>
          <div style="flex:0 0 auto;"><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:4px;">Payé avec</div><div style="display:flex;gap:6px;flex-wrap:wrap;">${who}</div></div>
          <div style="flex:0 0 auto;"><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:4px;">Réception <span class="muted help">Pas encore reçue : rien n'entre en stock et la facture te sert de bon de contrôle à la livraison. Une fois la commande reçue : passe sur « Reçue », complète les n° de lot et les DLUO, enregistre : le stock est alors ajouté.</span></div><div style="display:flex;gap:6px;flex-wrap:wrap;">${[[false, '✔ Reçue'], [true, '📦 Pas encore reçue']].map(p => `<button type="button" class="${!!d.pending === p[0] ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Achats.setHead('pending',${p[0]})">${p[1]}</button>`).join('')}</div></div>
          ${d.paidBy === 'perso' ? `<div class="fg" style="max-width:200px;"><label>Remboursé le (option)</label><input type="date" value="${U.esc(d.reimbursed || '')}" onchange="Achats.setHead('reimbursed',this.value)"></div>` : ''}
        </div>
      </div>
      <div class="card">
        <h2>🧾 Lignes de la facture</h2>
        <p class="muted help" style="font-size:.85rem;">Mastication, matière première, consommable et investissement se détaillent ligne par ligne (quantité × prix). Outillage et frais généraux : un seul montant. Pour la mastication, note le n° de lot et la DLUO : acheté à la pièce, la quantité entre tout de suite en stock avec eux ; acheté au kilo, ils te seront proposés quand tu rangeras les pièces dans le stock. Lier la ligne à un produit du stock est facultatif.</p>
        ${d.lines.map((l, i) => this._lineHTML(l, i)).join('')}
        <button class="btn-ghost btn-sm" onclick="Achats.addLine()">＋ Ajouter une ligne</button>
        <div class="ach-sum">
          <div><span class="muted">Sous-total ${this.isHT(d) ? 'HT' : ''}</span> <b class="sensitive" id="ach_sub">${U.eur(this.subTotal(d))}</b></div>
          <div class="fg"><label>Frais de livraison (€ ${this.isHT(d) ? 'HT' : 'TTC'})</label><input type="number" step="any" value="${d.shipping || ''}" placeholder="0" oninput="Achats.setHead('shipping',this.value)"><div class="muted sensitive" id="ach_shiptt" style="font-size:.78rem;">${this._ttcOf(d.shipping)}</div></div>
          <div class="fg"><label>Remise (€ ${this.isHT(d) && !d.discTTC ? 'HT' : 'TTC'})</label><input type="number" step="any" value="${d.discount || ''}" placeholder="0" oninput="Achats.setHead('discount',this.value)"></div>
          ${this.isHT(d) ? `<div class="fg" style="max-width:none;"><label>Remise donnée <span class="muted help">« Avant TVA » : la remise réduit le prix HT. « Sur le total TTC » : elle est retirée après la TVA (code promo) : le total HT et la TVA restent ceux de ta facture, seul le total payé baisse.</span></label><div style="display:flex;gap:6px;">${[[false, 'avant TVA (HT)'], [true, 'sur le total TTC']].map(x => `<button type="button" class="${!!d.discTTC === x[0] ? 'btn-cta' : 'btn-ghost'} btn-sm" style="white-space:nowrap;" onclick="Achats.setHead('discTTC',${x[0]})">${x[1]}</button>`).join('')}</div></div>` : ''}
          ${this.isHT(d) ? `<div><span class="muted">Total HT</span> <b class="sensitive" id="ach_base">${U.eur(this.base(d))}</b></div>` : ''}
          <div class="ach-grand">Total payé <b class="sensitive" id="ach_tot">${U.eur(this.grandTotal(d))}</b></div>
        </div>
        ${this.isHT(d) ? `<div class="ach-vat"><div class="muted" style="font-size:.78rem;text-transform:uppercase;margin-bottom:6px;">TVA indiquée en bas de la facture</div>
          ${(d.vat || []).map((v, i) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:nowrap;"><input id="ach_vatrate_${i}" type="number" step="any" min="0" value="${v.rate}" oninput="Achats.setVat(${i},'rate',this.value)" title="Taux (%)" style="width:80px;flex:0 0 80px;"><span style="white-space:nowrap;">% →</span><input id="ach_vatamt_${i}" type="number" step="any" min="0" value="${v.amount || ''}" placeholder="montant TVA" oninput="Achats.setVat(${i},'amount',this.value)" style="width:140px;flex:0 0 140px;"><span>€</span><button class="btn-icon" title="Retirer ce taux" onclick="Achats.delVat(${i})">🗑️</button></div>`).join('')}
          <button class="btn-ghost btn-sm" onclick="Achats.addVat()">＋ Ajouter un taux de TVA</button> <span class="muted">TVA totale : <b class="sensitive" id="ach_vat">${U.eur(this.vatSum(d))}</b></span></div>` : ''}
        <div class="frow mt">
          <button class="btn-ok" style="flex:0 0 auto;" onclick="Achats.save()">✅ Enregistrer la facture</button>
          <button class="btn-ghost" style="flex:0 0 auto;" onclick="Achats.cancel()">Annuler</button>
          <button class="btn-ghost" style="flex:0 0 auto;" onclick="Achats.copyLabels()" title="Copie la liste « produit — lot — DLUO (mois/année) » de cette facture, à donner à Claude pour mettre tes étiquettes à jour">🏷️ Copier lots et DLUO</button>
        </div>
      </div>`);
  },
  /* 🏷️ Liste pour les étiquettes (Antho 2026-11-05) : « Produit — Lot X — DLUO MM/AAAA », une ligne par produit de mastication de la facture, à coller à Claude (mise à jour de ses étiquettes Canva). */
  copyLabels(id) {   // avec un id : facture enregistrée (liste Achats) ; sans id : facture en cours de saisie
    const d = id ? (Store.state.purchases || []).find(x => x.id === id) : this._d; if (!d) return;
    const seen = new Set(), out = [];
    let skipped = 0;
    (d.lines || []).filter(l => l.cat === 'mastication' && l.label).forEach(l => {
      const lot = String(l.lot || '').trim(), dl = String(l.dluo || '').trim();
      if (!lot && !dl) { skipped++; return; }
      const sp = l.ref ? (Store.state.stockM || []).find(x => x.id === l.ref) : null;
      const name = String((sp && sp.name) || l.label).trim();
      const m = dl.match(/^(\d{4})-(\d{2})/);
      const txt = `${name} — ${lot ? 'Lot ' + lot : 'lot manquant'} — ${dl ? 'DLUO ' + (m ? m[2] + '/' + m[1] : dl) : 'DLUO manquante'}`;
      if (!seen.has(txt)) { seen.add(txt); out.push(txt); }
    });
    if (!out.length) { U.toast('Aucun produit avec un n° de lot ou une DLUO sur cette facture.', true); return; }
    const text = out.join('\n'), done = () => U.toast(`Liste copiée (${out.length} produit${out.length > 1 ? 's' : ''})${skipped ? ` — ${skipped} ligne(s) sans lot ni DLUO ignorée(s)` : ''}.`, skipped > 0);
    const fb = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); if (ok) done(); else U.toast('Copie impossible', true); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(fb); else fb();
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
      lines.push({ id: l.id || U.uid(), cat: c.id, ref: l.ref || '', label: lab, qty: c.detail ? U.num(l.qty) || 0 : 1, unit: c.detail ? String(l.unit || '').trim() : '', price: U.num(l.price), lot: c.id === 'mastication' ? String(l.lot || '').trim() : '', dluo: c.id === 'mastication' ? (l.dluo || '') : '', years: c.id === 'equipement' ? U.num(l.years) : 0, toStock: !!l.toStock && !!l.ref && (c.id === 'conso' || c.id === 'matiere' || c.id === 'mastication'), ...(c.id === 'mastication' && l.vId ? { vId: l.vId } : {}), ...(l.recv ? { recv: l.recv } : {}) });
    }
    if (!lines.length) { U.toast('Ajoute au moins une ligne avec un montant.', true); return; }
    this._autoVat();
    const rec = { id: this._editId || d.id, date: d.date, supplierId: d.supplierId, taxMode: d.taxMode === 'ht' ? 'ht' : 'ttc', vat: d.taxMode === 'ht' ? (d.vat || []).filter(v => U.num(v.amount) > 0 || U.num(v.rate) > 0).map(v => ({ rate: U.num(v.rate), amount: this.r2(v.amount), auto: !!v.auto })) : [], vatRate: d.taxMode === 'ht' || d.vatRate === undefined || d.vatRate === '' ? '' : U.num(d.vatRate), invoiceNo: String(d.invoiceNo || '').trim(), payment: d.payment || '', paidBy: d.paidBy || 'pro', reimbursed: d.paidBy === 'perso' ? (d.reimbursed || '') : '', shipping: U.num(d.shipping), discount: U.num(d.discount), note: String(d.note || '').trim(), ...(d.pending ? { pending: true, ...(d.chk ? { chk: d.chk } : {}) } : {}), ...(d.taxMode === 'ht' && d.discTTC && U.num(d.discount) ? { discTTC: true } : {}), lines };
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
    this._rememberVat(rec);
    Store.save('purchases', 'consumables', 'materials', 'stockM'); this.reconcileEquip();
    this._lastCat = lines[lines.length - 1].cat;
    this._d = null; this._editId = ''; this._dirty = false; this.mode = 'list'; this._clearDraft();
    this.render(); U.toast(rec.pending ? `Commande enregistrée : ${U.eur(rec.total)}. Rien n'est entré en stock : clique « Réceptionner » à la livraison.` : `Facture enregistrée : ${U.eur(rec.total)}.` + (notes.length ? ' Stock : ' + notes.join(' · ') : ''), false, entry.id);
  },

  /* Le taux de TVA saisi sur une facture TTC devient celui proposé pour ce fournisseur la fois suivante. */
  _rememberVat(rec) {
    if (rec.vatRate === '' || rec.vatRate === undefined) return;
    const s = (Store.state.settings.suppliers || []).find(x => x.id === rec.supplierId);
    if (s && (s.vatRate === undefined || U.num(s.vatRate) !== U.num(rec.vatRate))) { s.vatRate = U.num(rec.vatRate); Store.save('settings'); }
  },

  /* ---------- Ancienne facture « statistique » (2026-10-04) ----------
     Comme l'import historique d'un retour d'événement : on rentre les vieilles factures (2025…) juste pour la compta et le calcul des frais de livraison moyens,
     SANS toucher au stock ni aux prix. Un montant par catégorie + le port, au lieu de détailler chaque produit. Marquée « 📚 » dans la liste. */
  openHist() {
    const sups = this.suppliers(), S = Store.state.settings;
    const row = (id, ico, lab) => `<div class="fg"><label>${ico} ${lab}</label><input id="oh_a_${id}" type="number" step="any" min="0" placeholder="0"></div>`;
    U.modal({ title: '📚 Ancienne facture (statistiques)', okLabel: 'Enregistrer', wide: true, body: `
      <p class="muted help" style="font-size:.85rem;">Pour tes anciennes factures : rien n'est ajouté à ton stock ni à tes prix. Elles comptent dans la Compta (à leur date) et dans le calcul des frais de livraison moyens. Après « Enregistrer », la fenêtre reste ouverte pour la facture suivante.</p>
      <div class="frow"><div class="fg"><label>Date de la facture</label><input id="oh_date" type="date"></div>
        <div class="fg"><label>Fournisseur</label><select id="oh_sup" onchange="Achats._histSup(this.value)"><option value="">— choisir —</option>${sups.map(s => `<option value="${s.id}">${U.esc(s.name)}</option>`).join('')}</select></div>
        <div class="fg"><label>…ou nouveau fournisseur</label><input id="oh_newsup" placeholder="nom"></div></div>
      <div class="frow"><div class="fg"><label>Montants saisis</label><select id="oh_mode" onchange="Achats._histMode()"><option value="ttc">TTC (ce que tu as payé)</option><option value="ht">HT</option></select></div>
        <div class="fg"><label>TVA (%)</label><input id="oh_vat" type="number" step="0.1" min="0" placeholder="${S.vatRate ?? 20} (global)"></div>
        <div class="fg"><label>Paiement</label><select id="oh_pay">${this.PAYS.map(p => `<option value="${p[0]}">${p[1]}</option>`).join('')}</select></div>
        <div class="fg"><label>N° facture (option)</label><input id="oh_no"></div></div>
      <div class="frow">${row('mastication', '🥩', 'Mastication (€)')}${row('matiere', '🧵', 'Matières premières (€)')}${row('conso', '📦', 'Consommables (€)')}${row('frais', '🧾', 'Autres dépenses (€)')}</div>
      <div class="frow"><div class="fg" style="max-width:260px;"><label>Frais de livraison (€)</label><input id="oh_ship" type="number" step="any" min="0" placeholder="0"></div>
        <div class="fg" style="max-width:300px;"><label>Montant de TVA (€) <span class="muted help">option, en mode HT : si la facture indique la TVA en euros (ex. TVA sur les marchandises seulement, pas sur le port), saisis-la ici ; sinon elle est calculée avec le taux</span></label><input id="oh_vatamt" type="number" step="any" min="0" placeholder="auto"></div></div>
      <p class="muted" style="font-size:.82rem;" id="oh_hint">Les montants et les frais de livraison sont saisis en TTC.</p>`,
      onOk: () => this._saveHist() });
  },
  _histSup(id) {
    const s = (Store.state.settings.suppliers || []).find(x => x.id === id), v = document.getElementById('oh_vat');
    const sv = s ? (s.vatRate !== undefined && s.vatRate !== '' ? s.vatRate : s.purchaseVatRate) : undefined;
    if (sv !== undefined && sv !== '' && v && v.value === '') v.value = sv;
  },
  _histMode() { const h = document.getElementById('oh_hint'); if (h) h.textContent = 'Les montants et les frais de livraison sont saisis en ' + (U.val('oh_mode') === 'ht' ? 'HT (la TVA sera ajoutée au total).' : 'TTC.'); },
  _saveHist() {
    const date = U.val('oh_date'); if (!date) { U.toast('Indique la date de la facture.', true); return false; }
    const S = Store.state.settings, cats = [['mastication', 'Mastication'], ['matiere', 'Matières premières'], ['conso', 'Consommables'], ['frais', 'Autres dépenses']];
    const amt = {}; cats.forEach(c => amt[c[0]] = this.r2(U.numVal('oh_a_' + c[0])));
    const lines = cats.filter(c => amt[c[0]] > 0).map(c => ({ id: U.uid(), cat: c[0], ref: '', label: 'Récap — ' + c[1], qty: 1, unit: this.cat(c[0]).detail ? 'pièce' : '', price: amt[c[0]], lot: '', dluo: '', years: 0, toStock: false }));
    if (!lines.length) { U.toast('Indique au moins un montant.', true); return false; }
    let supId = U.val('oh_sup'); const nn = U.val('oh_newsup').trim();
    if (nn) {
      let s = S.suppliers.find(x => x.name.toLowerCase() === nn.toLowerCase());
      if (!s) { s = { id: U.uid(), name: nn, types: this._supTypesFromLines({ lines }) }; S.suppliers.push(s); Store.save('settings'); }
      supId = s.id;
    }
    if (!supId) { U.toast('Choisis ou crée le fournisseur.', true); return false; }
    const ht = U.val('oh_mode') === 'ht', vt = U.val('oh_vat').trim();
    const rec = { id: U.uid(), date, supplierId: supId, taxMode: ht ? 'ht' : 'ttc', vat: [], vatRate: !ht && vt !== '' ? U.num(vt) : '', invoiceNo: U.val('oh_no').trim(), payment: U.val('oh_pay') || 'carte', paidBy: 'pro', reimbursed: '', shipping: this.r2(U.numVal('oh_ship')), discount: 0, note: 'Saisie statistique (ancienne facture)', hist: true, lines };
    if (ht) {
      const rate = vt !== '' ? U.num(vt) : U.num(S.vatRate ?? 20), va = U.val('oh_vatamt').trim();
      rec.vat = va !== '' ? [{ rate, amount: this.r2(U.num(va)), auto: false }] : [{ rate, amount: this.r2(this.base(rec) * rate / 100), auto: true }];
    }
    rec.total = this.grandTotal(rec); rec.created = Date.now();
    this.list().push(rec); this._rememberVat(rec);
    if (ht && vt !== '') { const s = S.suppliers.find(x => x.id === supId); if (s && U.num(s.vatRate) !== U.num(vt)) { s.vatRate = U.num(vt); Store.save('settings'); } }
    const entry = Store.log('achat', `Ancienne facture (statistiques) — ${this.supplierLabel(rec)} ${U.frDate(rec.date)} (${U.eur(rec.total)})`, { type: 'restoreBatch', data: [{ domain: 'purchases', id: rec.id, before: null }] });
    Store.save('purchases'); this.render();
    cats.forEach(c => { const e = document.getElementById('oh_a_' + c[0]); if (e) e.value = ''; });
    ['oh_ship', 'oh_no', 'oh_newsup', 'oh_vatamt'].forEach(i => { const e = document.getElementById(i); if (e) e.value = ''; });
    const sel = document.getElementById('oh_sup'); if (nn && sel && !sel.querySelector(`option[value="${supId}"]`)) sel.insertAdjacentHTML('beforeend', `<option value="${supId}">${U.esc(nn)}</option>`);
    if (sel) sel.value = supId;
    U.toast(`Facture enregistrée : ${U.eur(rec.total)}. Saisis la suivante ou clique « Fermer ».`, false, entry.id);
    return false;
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

/* « ＋ » du menu de choix d'une matière / d'un consommable (utils.js, data-add) */
document.addEventListener('nseladd', e => { const s = e.target; if (s && s.dataset && s.dataset.addLine !== undefined) Achats.newItem(+s.dataset.addLine); });
