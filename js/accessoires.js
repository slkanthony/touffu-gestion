/* ============================================================
   ACCESSOIRES — colliers, laisses, longes (non périssable)
   Matières : rouleaux de sangle enduite (au mètre), bouclerie
   (mousquetons, rivets… à la pièce). Fiche accessoire = nomen-
   clature matières + temps de main d'œuvre + coefficient.
   Fabrication → consomme les matières, ajoute au stock fini.
   ============================================================
   FAMILLES (coût moyen) :
   Sangles groupées par largeur (variant) → "Sangle 20mm"
   Bouclerie/autre groupés par produit   → "Mousqueton"
   BOM stocke familyKey OU materialId (rétrocompat).
   ============================================================ */
const Accessoires = {
  _strapRecalced: false,
  _bomOpen: -1,
  _bomQ: {},
  _bomCat: {},
  _widthsOpen: false,
  _accOpen: {},
  focusId: null,  // fiche à ouvrir/faire défiler (lien direct #/accessoires/<id>)
  setAccOpen(id, open) { this._accOpen[id] = open; },
  _fabOpen: {},
  setFabOpen(id, open) { this._fabOpen[id] = open; },
  accSort: 'cat', accSortDir: 'asc',
  accQ: '', accCatFilter: '', accWidthFilter: '', accBicolorFilter: '',
  setAccQ(v) { this.accQ = v; this.renderProducts(); U.refocus('acc_q'); },
  setAccCatFilter(v) { this.accCatFilter = v; this.renderProducts(); },
  setAccWidthFilter(v) { this.accWidthFilter = v; this.renderProducts(); },
  setAccBicolorFilter(v) { this.accBicolorFilter = v; this.renderProducts(); },
  setAccSort(key) {
    if (this.accSort === key) this.accSortDir = this.accSortDir === 'asc' ? 'desc' : 'asc';
    else { this.accSort = key; this.accSortDir = 'asc'; }
    this.renderProducts();
  },

  render() {
    App.mount(`
      <div class="view-title"><h1>Accessoires</h1><span class="sub">fabrication artisanale · sangle enduite</span></div>
      <div id="accBody"></div>`);
    this.renderProducts();
  },

  /* ---------- familles de matières (coût moyen) ---------- */
  families() {
    const mats = Store.state.materials;
    const groups = {};
    for (const m of mats) {
      let key, label;
      if (Store.isSangleKind(m.kind)) {
        // une famille par (catégorie de sangle, largeur) : « Sangle 16mm », « Sangle HEXA 16mm »… (clé « sangle:16mm » inchangée pour la catégorie de base)
        const width = m.variant || m.name;
        key = m.kind + ':' + width;
        label = (Stock.matKindLabel[m.kind] || 'Sangle') + ' ' + width;
      } else {
        const prod = m.product || m.name;
        key = (m.kind || 'autre') + ':' + prod;
        label = prod;
      }
      if (!groups[key]) groups[key] = { key, label, kind: m.kind, unit: m.unit, materials: [], totalCost: 0 };
      groups[key].materials.push(m);
      groups[key].totalCost += this.matCost(m);
    }
    // Familles « type + taille » (Mousquetons 20mm = moyenne de TOUS les mousquetons 20mm, toutes finitions/produits confondus) pour les catégories à la pièce
    // hors sangles : proposées seulement quand la fiche accessoire a une largeur de sangle, et seulement si elles regroupent au moins 2 produits.
    const bySize = {};
    for (const m of mats) {
      if (Store.isSangleKind(m.kind) || m.unit !== 'piece') continue;
      const size = this._sizeOf(m); if (!size) continue;
      const key = 'size:' + (m.kind || 'autre') + ':' + size;
      (bySize[key] = bySize[key] || { key, label: (Stock.matKindLabel[m.kind] || 'Matière') + ' ' + size, kind: m.kind, unit: 'piece', size, bySize: true, materials: [], totalCost: 0, prods: new Set() });
      const g = bySize[key]; g.materials.push(m); g.totalCost += this.matCost(m); g.prods.add(m.product || m.name);
    }
    Object.values(bySize).forEach(g => { if (g.prods.size >= 2) groups[g.key] = g; });
    return Object.values(groups).map(g => ({
      ...g,
      avgCost: g.totalCost / g.materials.length,
      count: g.materials.length
    })).sort((a, b) => U.sortFr(a.label, b.label));
  },

  /* Taille d'une matière à la pièce, normalisée (« 20mm ») : la variante si c'est une largeur, sinon la largeur lue dans le nom du produit (« Mousqueton 20 mm »). */
  _sizeOf(m) {
    const w = s => { const x = String(s || '').match(/^\s*(\d+(?:[.,]\d+)?)\s*mm\s*$/i); return x ? x[1].replace(',', '.') + 'mm' : ''; };
    const sz = w(m.size); if (sz) return sz;
    const v = w(m.variant); if (v) return v;
    const n = String(m.product || m.name || '').match(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*mm(?![a-z])/i);
    return n ? n[1].replace(',', '.') + 'mm' : '';
  },
  _normWidth(w) { const x = String(w || '').match(/(\d+(?:[.,]\d+)?)\s*mm/i); return x ? x[1].replace(',', '.') + 'mm' : String(w || ''); },

  familyCost(familyKey) {
    if (!familyKey) return 0;
    const fam = this.families().find(f => f.key === familyKey);
    return fam ? fam.avgCost : 0;
  },

  /* Coût unitaire d'une matière POUR LES CALCULS : coût stocké HT + TVA d'achat de la matière (m.costVat, sinon taux global) tant qu'Antho n'est pas assujetti (TVA non récupérable). */
  matCost(m) { return U.num(m.costUnit) * Pricing.vatK(Stock.matVat(m)); },

  bomLineCost(l) {
    if (l.familyKey) return this.familyCost(l.familyKey);
    if (l.materialId) { const m = Store.material(l.materialId); return m ? this.matCost(m) : 0; }
    return 0;
  },

  bomLineLabel(l) {
    let label;
    if (l.familyKey) { const fam = this.families().find(f => f.key === l.familyKey); label = fam ? fam.label : l.familyKey; }
    else if (l.materialId) { const m = Store.material(l.materialId); label = m ? m.name : '⚠ matière supprimée'; }
    else label = '—';
    if (l.strapColor === 1) label += ' (couleur 1 — interne)';
    else if (l.strapColor === 2) label += ' (couleur 2 — segments)';
    return label;
  },

  bomLineUnit(l) {
    if (l.familyKey) {
      const fam = this.families().find(f => f.key === l.familyKey);
      return fam?.unit === 'm' ? 'm' : 'PCS';
    }
    if (l.materialId) {
      const m = Store.material(l.materialId);
      return m?.unit === 'm' ? 'm' : 'PCS';
    }
    return 'PCS';
  },

  /* ---------- produits finis ---------- */
  renderProducts() {
    let needSave = false;
    for (const a of Store.state.catalogA) if (this._migrateInternalLength(a)) needSave = true;
    if (!this._strapRecalced) {
      this._strapRecalced = true;
      for (const a of Store.state.catalogA) {
        const strapIdxs = []; (a.bom || []).forEach((l, i) => { if (this.bomLineUnit(l) === 'm') strapIdxs.push(i); });
        if (!strapIdxs.length) continue;
        const old = strapIdxs.map(i => U.num(a.bom[i].qty));
        this._autoStrap(a);
        if (strapIdxs.some((si, j) => Math.abs(old[j] - U.num(a.bom[si].qty)) > 0.001)) needSave = true;
      }
    }
    if (needSave) Store.save('catalogA');
    U.syncFilters('accessoires', this, ['accQ', 'accCatFilter', 'accWidthFilter', 'accBicolorFilter', 'accSort', 'accSortDir']);
    const focusId = this.focusId; this.focusId = null;
    if (focusId) { this.accQ = ''; this.accCatFilter = ''; this.accWidthFilter = ''; this.accBicolorFilter = ''; this._accOpen[focusId] = true; }
    let list = [...Store.state.catalogA];
    const q = this.accQ.toLowerCase();
    if (q) list = list.filter(a => U.has(a.name, q));
    if (this.accCatFilter) list = list.filter(a => a.category === this.accCatFilter);
    if (this.accWidthFilter) list = list.filter(a => (a.mainWidth || (a.strapWidths || [])[0] || '') === this.accWidthFilter);
    if (this.accBicolorFilter === 'yes') list = list.filter(a => a.bicolor);
    else if (this.accBicolorFilter === 'no') list = list.filter(a => !a.bicolor);
    const dir = this.accSortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let v = 0;
      const ca = Pricing.accCalc(a), cb = Pricing.accCalc(b);
      switch(this.accSort) {
        case 'name': v = U.sortFr(a.name, b.name); break;
        case 'cat': v = U.sortFr(a.category||'', b.category||''); break;
        case 'width': v = U.sortFr((a.strapWidths||[]).join(','), (b.strapWidths||[]).join(',')); break;
        case 'cost': v = ca.cost - cb.cost; break;
        case 'price': v = ca.priceTTC - cb.priceTTC; break;
      }
      return (v || U.sortFr(a.category + a.name, b.category + b.name)) * dir;
    });
    const sortHead = (key, label) => `<span class="sortable ${this.accSort===key?'active':''}" onclick="Accessoires.setAccSort('${key}')">${label} ${this.accSort===key?(this.accSortDir==='asc'?'▲':'▼'):'⇕'}</span>`;
    const allCats = [...new Set(Store.state.catalogA.map(a => a.category).filter(Boolean))].sort(U.sortFr);
    const allWidths = [...new Set(Store.state.catalogA.flatMap(a => a.strapWidths || []))].sort((a, b) => parseInt(a) - parseInt(b));
    document.getElementById('accBody').innerHTML = `
      <div class="toolbar">
        <div class="fg"><label>Recherche</label><input id="acc_q" type="text" placeholder="nom du produit…" value="${U.esc(this.accQ)}" oninput="Accessoires.setAccQ(this.value)"></div>
        <div class="fg"><label>Catégorie</label><select onchange="Accessoires.setAccCatFilter(this.value)">
          <option value="">Toutes (${Store.state.catalogA.length})</option>
          ${allCats.map(c => `<option value="${U.esc(c)}" ${this.accCatFilter === c ? 'selected' : ''}>${U.esc(c)}</option>`).join('')}
        </select></div>
        <div class="fg"><label>Largeur</label><select onchange="Accessoires.setAccWidthFilter(this.value)">
          <option value="">Toutes</option>
          ${allWidths.map(w => `<option value="${U.esc(w)}" ${this.accWidthFilter === w ? 'selected' : ''}>${U.esc(w)}</option>`).join('')}
        </select></div>
        <div class="fg"><label>Bicolor</label><select onchange="Accessoires.setAccBicolorFilter(this.value)">
          <option value="" ${!this.accBicolorFilter ? 'selected' : ''}>Tous</option>
          <option value="yes" ${this.accBicolorFilter === 'yes' ? 'selected' : ''}>Bicolor</option>
          <option value="no" ${this.accBicolorFilter === 'no' ? 'selected' : ''}>Non bicolor</option>
        </select></div>
      </div>
      <div class="toolbar"><button class="btn-cta" onclick="Accessoires.editAcc()">＋ Nouvel accessoire</button></div>
      ${list.length ? `<div class="prod-list-header acc-header">
        <span>${sortHead('name', 'Nom du produit')}</span>
        <span>${sortHead('cat', 'Catégorie')}</span>
        <span>${sortHead('width', 'Largeur')}</span>
        <span class="right">${sortHead('cost', 'Coût')}</span>
        <span class="right">${sortHead('price', 'Prix TTC')}</span>
      </div>` : ''}
      ${list.map(a => this.accCard(a)).join('') || '<div class="card empty"><span class="big">🐕</span>Aucun accessoire. Crée ta première fiche : matières + temps de fabrication, et le prix se calcule tout seul.</div>'}`;
    if (focusId) setTimeout(() => { const el = document.getElementById('acc-' + focusId); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  },

  setAccInline(id, field, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (field === 'laborMinutes') a.laborMinutes = U.num(val);
    else if (field === 'coefficient') { a.coefficient = U.num(val); a.priceTTCManual = ''; }
    else if (field === 'priceTTCManual') a.priceTTCManual = U.num(val) || '';
    Store.commitSnapshot(snap, 'accessoires', 'Accessoire modifié — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  setAccBomQty(id, bomIdx, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (a.bom && a.bom[bomIdx]) a.bom[bomIdx].qty = U.num(val);
    Store.commitSnapshot(snap, 'accessoires', 'Accessoire modifié — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  setAccProdLen(id, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    const oldLen = U.num(a.productLength);
    const newLen = U.num(val);
    a.productLength = newLen;
    const delta = newLen - oldLen;
    if (delta !== 0) {
      a.internalLength = Math.max(0, Math.round((U.num(a.internalLength) + delta * 100) * 10) / 10);
    }
    this._autoStrap(a);
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Longueur produit modifiée — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  setAccInternalLen(id, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    a.internalLength = U.num(val);
    this._autoStrap(a);
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Longueur interne modifiée — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  toggleBicolor(id) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    a.bicolor = !a.bicolor;
    if (a.bicolor) {
      const si = (a.bom || []).findIndex(l => this.bomLineUnit(l) === 'm');
      if (si >= 0) {
        a.bom[si].strapColor = 1;
        a.bom.splice(si + 1, 0, { familyKey: a.bom[si].familyKey, qty: 0, strapColor: 2 });
      }
    } else {
      const idxs = []; (a.bom || []).forEach((l, i) => { if (this.bomLineUnit(l) === 'm') idxs.push(i); });
      if (idxs.length >= 2) {
        delete a.bom[idxs[0]].strapColor;
        a.bom.splice(idxs[1], 1);
      }
    }
    this._autoStrap(a);
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', (a.bicolor ? 'Bicolor activé' : 'Bicolor désactivé') + ' — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  setAccSegment(id, i, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (a.fabSegments && a.fabSegments[i]) a.fabSegments[i].value = U.num(val);
    this._autoStrap(a);
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Segment modifié — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  _autoStrap(a) {
    const strapIdxs = []; (a.bom || []).forEach((l, i) => { if (this.bomLineUnit(l) === 'm') strapIdxs.push(i); });
    if (!strapIdxs.length) return;
    const segTotal = (a.fabSegments || []).reduce((sum, s) => sum + U.num(s.value), 0);
    const interne = U.num(a.internalLength);
    if (a.bicolor && strapIdxs.length >= 2) {
      a.bom[strapIdxs[0]].qty = interne > 0 ? Math.round(interne / 100 * 1000) / 1000 : 0;
      a.bom[strapIdxs[1]].qty = segTotal > 0 ? Math.round(segTotal / 100 * 1000) / 1000 : 0;
    } else {
      const total = segTotal + interne;
      if (total > 0) a.bom[strapIdxs[0]].qty = Math.round(total / 100 * 1000) / 1000;
    }
  },

  _migrateInternalLength(a) {
    if (a.internalLength !== undefined) return false;
    if (!a.fabSegments) { a.internalLength = 0; return false; }
    const ii = a.fabSegments.findIndex(s => s.label && s.label.toLowerCase().includes('interne'));
    if (ii >= 0 && U.num(a.fabSegments[ii].value) > 0) {
      a.internalLength = U.num(a.fabSegments[ii].value);
      a.fabSegments.splice(ii, 1);
      return true;
    }
    a.internalLength = 0;
    return false;
  },

  initFabSegs(id) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    const defs = this._fabDefaults(a.category).map(s => ({ ...s }));
    const ii = defs.findIndex(s => s.label && s.label.toLowerCase().includes('interne'));
    if (ii >= 0) { a.internalLength = U.num(defs[ii].value); defs.splice(ii, 1); }
    a.fabSegments = defs;
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Segments configurés — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  setAccSegLabel(id, i, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (a.fabSegments && a.fabSegments[i]) a.fabSegments[i].label = val.trim();
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Segment renommé — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  addAccFabSeg(id) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (!a.fabSegments) a.fabSegments = [];
    a.fabSegments.push({ label: '', value: 0 });
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Segment ajouté — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  delAccFabSeg(id, i) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (a.fabSegments) a.fabSegments.splice(i, 1);
    Store.commitSnapshot(snap, 'accessoires', 'Segment supprimé — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  accCard(a) {
    const c = Pricing.accCalc(a);
    // Profit net = bénéfice « assujetti » (marge − cotisations, TVA hors calcul). Non assujetti : le gain réel (TVA conservée) est affiché en dessous.
    const vatOn = Store.state.settings.vatActive;
    const netProfit = c.profitAssujetti;
    const bomRows = (a.bom || []).map((l, li) => {
      const label = this.bomLineLabel(l);
      const unit = this.bomLineUnit(l);
      const unitCost = this.bomLineCost(l);
      const isFamily = !!l.familyKey;
      return `<tr><td class="col-name">${U.esc(label)}${isFamily ? ' <span class="muted">(moy.)</span>' : ''}</td>
        <td class="num"><input type="number" step="0.01" value="${l.qty}" class="acc-inline-input" onchange="Accessoires.setAccBomQty('${a.id}',${li},this.value)"> ${unit}</td>
        <td class="num sensitive">${U.eur(unitCost * U.num(l.qty))}</td></tr>`;
    }).join('');
    const fabHTML = this._fabCardHTML(a);
    const notesHTML = this._notesHTML(a);
    const accOpen = this._accOpen[a.id] || false;
    const widths = this._normalizeWidths(a);
    const criticalClass = c.critical ? ' acc-critical' : '';
    return `<details class="fold prod-fold acc-fold${criticalClass}" id="acc-${a.id}" ${accOpen ? 'open' : ''} ontoggle="Accessoires.setAccOpen('${a.id}',this.open)">
      <summary>
        <span><b>${U.esc(a.name)}</b>${c.critical ? ' <span class="badge bad">coeff critique</span>' : ''}</span>
        <span class="type-col"><span class="badge info">${U.esc(a.category)}</span></span>
        <span class="type-col">${widths.map(w => `<span class="badge${w === a.mainWidth && widths.length > 1 ? ' info' : ''}">${w === a.mainWidth && widths.length > 1 ? '★ ' : ''}${U.esc(w)}</span>`).join(' ') || '<span class="muted">—</span>'}</span>
        <span class="meta right sensitive">${U.eur(c.cost)}</span>
        <span class="meta right"><b>${U.eur(c.priceTTC)}</b></span>
      </summary>
      <div class="fold-body">
        ${fabHTML}
        <div class="grid c2">
          <div>
            <h2 style="font-size:.9rem;">Nomenclature</h2>
            <div class="table-wrap"><table><thead><tr><th class="col-name">Matière</th><th class="num">Qté</th><th class="num">Coût</th></tr></thead>
              <tbody>${bomRows || '<tr><td colspan="3" class="muted">Aucune matière.</td></tr>'}
              <tr><td>Main d'œuvre (<input type="number" step="1" value="${U.num(a.laborMinutes)}" class="acc-inline-input" onchange="Accessoires.setAccInline('${a.id}','laborMinutes',this.value)"> min à <span class="sensitive">${U.eur(Store.state.settings.laborRate)}/h</span>)</td><td></td><td class="num sensitive">${U.eur(c.laborCost)}</td></tr>
              ${U.num(a.extraCost) ? `<tr><td>Autres coûts</td><td></td><td class="num sensitive">${U.eur(a.extraCost)}</td></tr>` : ''}
              ${U.num(c.uvCost) ? `<tr><td>🖨️ Impression UV <span class="muted">(${U.qty(a.uvMl)} ml × ${U.eur(Pricing.uvCostPerMl())}/ml)</span></td><td></td><td class="num sensitive">${U.eur(c.uvCost)}</td></tr>` : ''}
              <tr><th>Coût de revient</th><th></th><th class="num sensitive">${U.eur(c.cost)}</th></tr></tbody></table></div>
          </div>
          <div>
            <h2 style="font-size:.9rem;">Tarification</h2>
            <div class="table-wrap"><table><tbody>
              <tr><td>Coefficient</td><td class="num sensitive"><input type="number" step="0.01" value="${c.coeff.toFixed(2)}" class="acc-inline-input" onchange="Accessoires.setAccInline('${a.id}','coefficient',this.value)"></td></tr>
              <tr><td>Prix HT</td><td class="num sensitive">${U.eur(c.priceHT)}</td></tr>
              <tr><td><b>Prix TTC</b></td><td class="num">${c.priceFixed ? '<button class="btn-icon" title="Revenir au calcul auto" onclick="Accessoires.setAccInline(\''+a.id+'\',\'priceTTCManual\',0)" style="vertical-align:middle;">↺</button>' : ''}<input type="number" step="0.10" value="${c.priceTTC.toFixed(2)}" class="acc-inline-input" style="font-weight:700;" onchange="Accessoires.setAccInline('${a.id}','priceTTCManual',this.value)"></td></tr>
              <tr><td>Marge</td><td class="num sensitive">${U.eur(c.margin)}</td></tr>
              <tr><td>Cotisations URSSAF <span class="muted">(${U.pct(Pricing.socialRateHandmade())} — fait main)</span></td><td class="num sensitive neg">− ${U.eur(c.social)}</td></tr>
              <tr><td><b>Profit net</b> <span class="muted help">Marge moins cotisations, TVA non comptée (c'est le bénéfice que tu auras une fois assujetti).</span></td><td class="num sensitive ${netProfit >= 0 ? 'pos' : 'neg'}"><b>${U.eur(netProfit)}</b></td></tr>
              ${vatOn ? '' : `<tr><td>Gain réel aujourd'hui <span class="muted help">Non assujetti : tu gardes la TVA (${U.eur(c.vatAmt)}) et les cotisations se calculent sur le prix TTC encaissé. C'est le même chiffre que dans les Stats.</span></td><td class="num sensitive ${c.profitActuel >= 0 ? 'pos' : 'neg'}">${U.eur(c.profitActuel)}</td></tr>`}
            </tbody></table></div>
          </div>
        </div>
        ${notesHTML}
        <div class="mt">${U.seg([
          { l: '🛠 Fabriquer', tone: 'ok', js: `Accessoires.fabricate('${a.id}')` },
          { l: 'Modifier', js: `Accessoires.editAcc('${a.id}')` },
          { l: '📋 Dupliquer', js: `Accessoires.duplicateAcc('${a.id}')` },
          ...((a.bom||[]).some(l => this.bomLineUnit(l) === 'm') ? [{ l: '📐 Sur mesure', js: `Accessoires.customLength('${a.id}')` }] : []),
          { l: 'Supprimer', tone: 'danger', js: `Accessoires.delAcc('${a.id}')` }
        ], { full: true, scroll: true })}</div>
      </div></details>`;
  },

  _notesHTML(a) {
    const parts = [];
    if (a.handleLength) parts.push(`Poignée : ${U.esc(a.handleLength)}`);
    if (a.flapLength) parts.push(`Rabats : ${U.esc(a.flapLength)}`);
    if (a.materialsDesc) parts.push(`Matières : ${U.esc(a.materialsDesc)}`);
    if (a.notes) parts.push(U.esc(a.notes).replace(/\n/g, '<br>'));
    if (!parts.length) return '';
    return `<div class="card" style="margin-top:8px;padding:8px 12px;background:var(--th-bg);">
      <b>📝 Notes :</b><br>${parts.join('<br>')}</div>`;
  },

  _fabSummary(a) {
    const segs = a.fabSegments || [];
    const prodLen = U.num(a.productLength);
    const interne = U.num(a.internalLength);
    if (!segs.some(s => s.value > 0) && !prodLen && !interne) return '';
    const parts = [];
    if (prodLen > 0) parts.push(`Produit : ${U.qty(prodLen)} m`);
    segs.filter(s => s.value > 0).forEach(s => parts.push(`${U.esc(s.label)} : ${U.lenTxt(s.value)}`));
    if (interne > 0) parts.push(`Interne : ${U.lenTxt(interne)}`);
    if (a.bicolor) {
      const s1 = interne > 0 ? Math.round(interne / 100 * 1000) / 1000 : 0;
      const segT = segs.reduce((sum, s) => sum + U.num(s.value), 0);
      const s2 = segT > 0 ? Math.round(segT / 100 * 1000) / 1000 : 0;
      if (s1 > 0) parts.push(`S1 : ${U.qty(s1)} m`);
      if (s2 > 0) parts.push(`S2 : ${U.qty(s2)} m`);
    } else {
      const sangleIdx = (a.bom || []).findIndex(l => this.bomLineUnit(l) === 'm');
      const totalStrap = sangleIdx >= 0 ? U.num(a.bom[sangleIdx].qty) : 0;
      if (totalStrap > 0) parts.push(`Sangle : ${U.qty(totalStrap)} m`);
    }
    return ` <span class="muted" style="font-weight:normal;font-size:.85rem;">— ${parts.join(' · ')}</span>`;
  },

  _fabCardHTML(a) {
    const hasSangle = (a.bom || []).some(l => this.bomLineUnit(l) === 'm');
    const segs = a.fabSegments || [];
    const interne = U.num(a.internalLength);
    if (!hasSangle && !segs.length && !interne) return '';
    if (hasSangle && !segs.length && !interne) {
      return `<div class="card" style="margin-bottom:8px;padding:8px 12px;background:var(--th-bg);">
        <b>📐 Longueurs de fabrication</b>
        <div style="margin-top:6px;"><button class="btn-ghost btn-sm" onclick="Accessoires.initFabSegs('${a.id}')">Configurer les segments</button></div></div>`;
    }
    const sangleIdx = (a.bom || []).findIndex(l => this.bomLineUnit(l) === 'm');
    const totalStrap = sangleIdx >= 0 ? U.num(a.bom[sangleIdx].qty) : 0;
    const prodLen = U.num(a.productLength);
    const fabOpen = this._fabOpen[a.id] || false;
    const segTotal = segs.reduce((sum, s) => sum + U.num(s.value), 0);

    // -- Colonne gauche : Produit fini + Longueur interne + Bicolor --
    let left = `<div style="font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">Produit fini</div>`;
    left += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      ${U.lenSplit('pl_' + a.id, prodLen * 100, { change: `Accessoires.setAccProdLen('${a.id}',U.lenCm('pl_${a.id}')/100)` })}</div>`;
    left += `<div style="padding:12px;border-radius:8px;background:rgba(100,180,255,0.07);border:1px dashed rgba(100,180,255,0.25);">
      <div style="font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">Longueur interne (X)</div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${U.lenSplit('il_' + a.id, interne, { change: `Accessoires.setAccInternalLen('${a.id}',U.lenCm('il_${a.id}'))` })}</div></div>`;
    left += `<div style="margin-top:12px;"><label style="cursor:pointer;font-size:.85rem;display:flex;align-items:center;gap:6px;"><input type="checkbox" ${a.bicolor ? 'checked' : ''} onchange="Accessoires.toggleBicolor('${a.id}')"> <span>🎨 Bicolor (2 sangles)</span></label></div>`;

    // -- Colonne droite : Segments fixes --
    let right = `<div style="font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">Segments fixes</div>`;
    segs.forEach((s, i) => {
      right += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
        <input type="text" value="${U.esc(s.label)}" placeholder="Nom" class="acc-inline-input" style="flex:1;min-width:110px;" onchange="Accessoires.setAccSegLabel('${a.id}',${i},this.value)">
        ${U.lenSplit(`sg_${a.id}_${i}`, s.value, { change: `Accessoires.setAccSegment('${a.id}',${i},U.lenCm('sg_${a.id}_${i}'))` })}
        <button class="btn-icon" onclick="Accessoires.delAccFabSeg('${a.id}',${i})" title="Supprimer">×</button></div>`;
    });
    right += `<div style="margin-top:6px;"><button class="btn-ghost btn-sm" onclick="Accessoires.addAccFabSeg('${a.id}')">＋ Segment</button></div>`;

    // -- Bas pleine largeur : résultat sangle(s), toujours 2 blocs égaux côte à côte --
    let bottom = '';
    if (a.bicolor) {
      const s1 = interne > 0 ? Math.round(interne / 100 * 1000) / 1000 : 0;
      const s2 = segTotal > 0 ? Math.round(segTotal / 100 * 1000) / 1000 : 0;
      bottom = `<div style="display:flex;gap:12px;margin-top:12px;">
        <div style="flex:1;text-align:center;padding:10px;border-radius:6px;background:var(--th-bg);border:1px solid var(--input-border);">
          <div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.03em;">Sangle 1 — interne</div>
          <b style="font-size:1.15rem;">${U.qty(s1)} m</b></div>
        <div style="flex:1;text-align:center;padding:10px;border-radius:6px;background:var(--th-bg);border:1px solid var(--input-border);">
          <div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.03em;">Sangle 2 — segments</div>
          <b style="font-size:1.15rem;">${U.qty(s2)} m</b></div></div>`;
    } else if (totalStrap > 0) {
      bottom = `<div style="margin-top:12px;padding:10px 16px;border-radius:6px;background:var(--th-bg);border:1px solid var(--input-border);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:500;">Sangle à couper</span><b style="font-size:1.15rem;">${U.qty(totalStrap)} m</b></div>`;
    }

    const body = `<div style="display:flex;gap:20px;margin-top:10px;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">${left}</div>
      <div style="flex:1;min-width:200px;">${right}</div>
    </div>${bottom}`;

    return `<details class="card" style="margin-bottom:8px;padding:8px 12px;background:var(--th-bg);" ${fabOpen ? 'open' : ''} ontoggle="Accessoires.setFabOpen('${a.id}',this.open)">
      <summary style="cursor:pointer;list-style:none;"><b>📐 Longueurs de fabrication</b>${this._fabSummary(a)}</summary>${body}</details>`;
  },

  _availableWidths() {
    const S = Store.state.settings;
    return (S.widths || []).slice().sort((a, b) => parseInt(a) - parseInt(b));
  },
  _normalizeWidths(a) {
    if (a.strapWidth && !a.strapWidths) a.strapWidths = [a.strapWidth];
    return a.strapWidths || [];
  },
  toggleWidth(w) {
    const ws = this._a.strapWidths || [];
    const idx = ws.indexOf(w);
    if (idx >= 0) ws.splice(idx, 1); else ws.push(w);
    this._a.strapWidths = ws;
    if (ws.length === 1) this._a.mainWidth = ws[0];
    else if (this._a.mainWidth && !ws.includes(this._a.mainWidth)) this._a.mainWidth = ws[0] || '';
    this.drawBom();
    const el = document.getElementById('a_widths_wrap');
    if (el) el.innerHTML = this._widthsSelectHTML();
  },
  setAllWidths(all) {
    this._a.strapWidths = all ? this._availableWidths().slice() : [];
    if (!all || this._a.strapWidths.length === 1) this._a.mainWidth = this._a.strapWidths[0] || '';
    this.drawBom();
    const el = document.getElementById('a_widths_wrap');
    if (el) el.innerHTML = this._widthsSelectHTML();
  },
  setMainWidth(w) {
    this._a.mainWidth = w;
    const el = document.getElementById('a_widths_wrap');
    if (el) el.innerHTML = this._widthsSelectHTML();
  },
  onWidthsOpen(open) { this._widthsOpen = open; },
  /* SKU TYPE-LARGEUR-NOM proposé d'après le formulaire (type, largeur principale, nom) ; en cas de collision avec un autre SKU : suffixe -2, -3… */
  _takenSkus(exceptId) {
    const s = new Set(), add = v => { v = String(v || '').trim().toUpperCase(); if (v) s.add(v); };
    Store.state.catalogA.forEach(x => { if (x.id !== exceptId) add(x.sku); });
    Store.state.stockM.forEach(p => (p.variants || []).forEach(v => add(v.sku)));
    Store.state.catalogM.forEach(p => (p.variants || []).forEach(v => add(v.sku)));
    return s;
  },
  genSku() {
    const a = this._a, ws = a.strapWidths || [];
    const base = Pricing.autoSkuAcc({ category: U.val('a_cat'), name: U.val('a_name'), mainWidth: a.mainWidth || ws[0] || '' });
    if (!base) { U.toast('Choisis un type et un nom pour générer le SKU.', true); return; }
    const taken = this._takenSkus(a.id); let sku = base, n = 1;
    while (taken.has(sku)) { n++; sku = base + '-' + n; }
    document.getElementById('a_sku').value = sku;
    U.toast(`SKU proposé : ${sku}${n > 1 ? ' (le SKU de base existait déjà)' : ''}`);
  },
  _widthsSelectHTML() {
    const widths = this._availableWidths();
    const sel = this._a.strapWidths || [];
    const main = this._a.mainWidth || '';
    let html = U.multiSelect({
      options: widths, selected: sel,
      toggle: 'Accessoires.toggleWidth', setAll: 'Accessoires.setAllWidths',
      open: this._widthsOpen, onOpen: 'Accessoires.onWidthsOpen',
      placeholder: '— Toutes —'
    });
    if (sel.length >= 2) {
      html += `<div style="margin-top:6px;font-size:.82rem;"><span class="muted">Largeur principale (sert au SKU) :</span> ${sel.map(w =>
        `<button class="btn-sm ${w === main ? 'btn-ok' : 'btn-ghost'}" style="margin:2px;" onclick="Accessoires.setMainWidth('${U.esc(w)}')">${w === main ? '★ ' : ''}${U.esc(w)}</button>`
      ).join('')}</div>`;
    }
    return html;
  },

  _fabDefaults(cat) {
    return (Store.state.settings.accFabDefaults || {})[cat]?.segments || [];
  },

  _fabFieldsHTML(a) {
    const segs = a.fabSegments || [];
    const interne = U.num(a.internalLength);
    return `<div class="fg"><label>Longueur produit fini</label><div>${U.lenSplit('a_prodLen', U.num(a.productLength) * 100, { change: 'Accessoires.onProdLenChange()' })}</div></div>
      <div style="margin-top:12px;padding:12px;border-radius:8px;border:1px solid var(--input-border);background:var(--th-bg);">
        <div style="font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">Détail des longueurs</div>
        <div id="a_segs_wrap">${this._fabSegsInnerHTML(segs)}</div>
        <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--input-border);">
          <div class="fg"><label>Longueur interne — X</label><div>${U.lenSplit('a_internLen', interne)}</div></div>
        </div>
      </div>`;
  },

  _fabSegsInnerHTML(segs) {
    return (segs || []).map((s, i) => `<div class="frow" style="gap:8px;align-items:flex-end;margin-top:6px;">
      <div class="fg" style="flex:2;"><input id="a_seg_label_${i}" value="${U.esc(s.label)}" placeholder="ex: Rabat" style="width:100%;"></div>
      <div class="fg" style="flex:0 0 auto;">${U.lenSplit('a_seg_val_' + i, s.value)}</div>
      <div class="fg" style="flex:0;"><button class="btn-icon" type="button" onclick="Accessoires.delFabSeg(${i})">×</button></div>
    </div>`).join('') + `<button class="btn-ghost btn-sm mt" type="button" onclick="Accessoires.addFabSeg()">＋ Ajouter un segment</button>`;
  },

  _readFabSegs() {
    const segs = this._a.fabSegments || [];
    for (let i = 0; i < segs.length; i++) {
      const lbl = document.getElementById('a_seg_label_' + i);
      if (lbl) segs[i].label = lbl.value.trim();
      if (document.getElementById('a_seg_val_' + i + '_m')) segs[i].value = U.lenCm('a_seg_val_' + i);
    }
  },

  addFabSeg() {
    this._readFabSegs();
    if (!this._a.fabSegments) this._a.fabSegments = [];
    this._a.fabSegments.push({ label: '', value: 0 });
    const el = document.getElementById('a_segs_wrap');
    if (el) el.innerHTML = this._fabSegsInnerHTML(this._a.fabSegments);
  },

  delFabSeg(i) {
    this._readFabSegs();
    if (this._a.fabSegments) this._a.fabSegments.splice(i, 1);
    const el = document.getElementById('a_segs_wrap');
    if (el) el.innerHTML = this._fabSegsInnerHTML(this._a.fabSegments || []);
  },

  onCatChange() {
    const cat = U.val('a_cat');
    this._readFabSegs();
    const allZero = (this._a.fabSegments || []).every(s => !s.value);
    if (this._isNewA || allZero) {
      const defs = this._fabDefaults(cat).map(s => ({ ...s }));
      const ii = defs.findIndex(s => s.label && s.label.toLowerCase().includes('interne'));
      if (ii >= 0) { this._a.internalLength = U.num(defs[ii].value); defs.splice(ii, 1); }
      this._a.fabSegments = defs;
    }
    this._a.category = cat;
    const nameEl = document.getElementById('a_name');
    if (nameEl) {
      const cur = nameEl.value.trim();
      const oldCat = this._a._prevCat || '';
      if (!cur || cur === oldCat) nameEl.value = cat;
      this._a._prevCat = cat;
    }
    const el = document.getElementById('a_segs_wrap');
    if (el) el.innerHTML = this._fabSegsInnerHTML(this._a.fabSegments || []);
    U.lenSet('a_internLen', U.num(this._a.internalLength));
  },

  onProdLenChange() {
    const nameEl = document.getElementById('a_name');
    if (!nameEl || !document.getElementById('a_prodLen_m')) return;
    const len = U.lenCm('a_prodLen') / 100;
    const cat = U.val('a_cat');
    let name = nameEl.value.trim();
    const lenRx = /\s*[—–-]\s*\d+([.,]\d+)?\s*m\s*$/i;
    name = name.replace(lenRx, '');
    if (!name) name = cat;
    if (len > 0) name += ' — ' + len + 'm';
    nameEl.value = name;
  },

  editAcc(id) {
    const S = Store.state.settings;
    const fabDefs = S.accFabDefaults || {};
    const a = id ? JSON.parse(JSON.stringify(Store.state.catalogA.find(x => x.id === id)))
      : (() => { const cat = S.accCategories[0]; const defs = (fabDefs[cat]?.segments || []).map(s => ({ ...s })); let internLen = 0; const ii = defs.findIndex(s => s.label && s.label.toLowerCase().includes('interne')); if (ii >= 0) { internLen = U.num(defs[ii].value); defs.splice(ii, 1); } return { id: U.uid(), name: '', category: cat, bom: [], laborMinutes: 20, extraCost: 0, coefficient: 2.5, priceTTCManual: '', sku: '', notes: '', handleLength: '', flapLength: '', materialsDesc: '', strapWidths: [], fabSegments: defs, productLength: 0, internalLength: internLen }; })();
    this._normalizeWidths(a);
    this._a = a; this._isNewA = !id; this._widthsOpen = false;
    if (!this._isNewA && (!a.fabSegments || !a.fabSegments.length)) {
      const defs = this._fabDefaults(a.category).map(s => ({ ...s }));
      if (defs.length) {
        const ii = defs.findIndex(s => s.label && s.label.toLowerCase().includes('interne'));
        if (ii >= 0 && a.internalLength === undefined) { a.internalLength = U.num(defs[ii].value); defs.splice(ii, 1); }
        a.fabSegments = defs;
      }
    }
    this._a._prevCat = a.category;
    U.modal({
      title: id ? U.esc(a.name) : 'Nouvel accessoire', okLabel: 'Enregistrer',
      body: `
      <div class="frow">
        <div class="fg"><label>Type</label><select id="a_cat" onchange="Accessoires.onCatChange()">${S.accCategories.slice().sort(U.sortFr).map(c => `<option ${a.category === c ? 'selected' : ''}>${U.esc(c)}</option>`).join('')}</select></div>
        <div class="fg"><label>Largeur</label><div id="a_widths_wrap">${this._widthsSelectHTML()}</div></div>
      </div>
      <div class="frow">
        <div class="fg" style="flex:2;"><label>Nom</label><input id="a_name" value="${U.esc(a.name || a.category)}" placeholder="ex: Longe 5m — 20mm"></div>
      </div>
      <h2 style="font-size:.95rem;">Matières utilisées ${(a.strapWidths||[]).length ? '' : '<span class="muted" style="font-weight:normal;font-size:.8rem;">(coût moyen par famille)</span>'}</h2>
      <div id="a_bom" data-onclose="Accessoires.closeBomPick"></div>
      <button class="btn-ghost btn-sm" onclick="Accessoires.addBom()">＋ Ajouter une matière</button>
      <hr class="sep">
      <div class="frow">
        <div class="fg"><label>Main d'œuvre (minutes)</label><input id="a_min" type="number" step="1" value="${a.laborMinutes}"></div>
        <div class="fg"><label>Autres coûts (€)</label><input id="a_extra" type="number" step="0.01" value="${a.extraCost}"></div>
        <div class="fg"><label>Coefficient</label><input id="a_coeff" type="number" step="0.01" value="${a.coefficient}"></div>
        <div class="fg"><label>Prix TTC forcé (option)</label><input id="a_pttc" type="number" step="0.10" value="${a.priceTTCManual}" placeholder="laisser vide = coeff"></div>
      </div>
      <div class="frow">
        <div class="fg"><label>SKU (option)</label><div style="display:flex;gap:6px;"><input id="a_sku" style="flex:1;min-width:0;" value="${U.esc(a.sku || '')}" placeholder="TYPE-LARGEUR-NOM"><button type="button" class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Accessoires.genSku()" title="Génère le SKU : type - largeur principale - nom (ex. LONGE-20MM-5M). La couleur n'y entre jamais.">✨ Générer</button></div></div>
        <div class="fg"><label>🖨️ Impression UV — ml d'encre</label><input id="a_uvml" type="number" step="0.1" min="0" value="${a.uvMl || ''}" placeholder="0 = pas de perso"></div>
      </div>
      <h2 style="font-size:.95rem;">📐 Longueurs de fabrication</h2>
      <div id="a_fab_row">
        ${this._fabFieldsHTML(a)}
        <div style="margin-top:6px;"><label style="cursor:pointer;font-size:.85rem;"><input id="a_bicolor" type="checkbox" ${a.bicolor ? 'checked' : ''}> 🎨 Bicolor (2 sangles de couleurs différentes)</label></div>
      </div>
      <h2 style="font-size:.95rem;">📝 Notes</h2>
      <div class="frow">
        <div class="fg" style="flex:2;"><label>Matières utilisées</label><input id="a_matdesc" value="${U.esc(a.materialsDesc || '')}" placeholder="ex: sangle noire 20mm, mousqueton laiton"></div>
      </div>
      <div class="fg" style="margin-top:4px;"><label>Notes libres</label><textarea id="a_notes" rows="3" placeholder="Informations, rappels…" style="width:100%;resize:vertical;">${U.esc(a.notes || '')}</textarea></div>`,
      onOk: () => {
        a.name = U.val('a_name').trim();
        if (!a.name) { U.toast('Nom obligatoire', true); return false; }
        a.category = U.val('a_cat'); a.laborMinutes = U.numVal('a_min'); a.extraCost = U.numVal('a_extra');
        a.coefficient = U.numVal('a_coeff'); a.priceTTCManual = U.val('a_pttc');
        a.sku = U.val('a_sku'); a.uvMl = U.numVal('a_uvml'); a.strapWidths = this._a.strapWidths || []; a.mainWidth = this._a.mainWidth || ''; delete a.strapWidth;
        a.notes = U.val('a_notes');
        this._readFabSegs();
        a.fabSegments = this._a.fabSegments || [];
        a.productLength = U.lenCm('a_prodLen') / 100;
        a.internalLength = U.lenCm('a_internLen');
        const wasBicolor = !!this._a.bicolor;
        const nowBicolor = !!document.getElementById('a_bicolor')?.checked;
        a.bicolor = nowBicolor;
        if (nowBicolor && !wasBicolor) {
          const si = (a.bom || []).findIndex(l => Accessoires.bomLineUnit(l) === 'm');
          if (si >= 0) { a.bom[si].strapColor = 1; a.bom.splice(si + 1, 0, { familyKey: a.bom[si].familyKey, qty: 0, strapColor: 2 }); }
        } else if (!nowBicolor && wasBicolor) {
          const idxs = []; (a.bom || []).forEach((l, i) => { if (Accessoires.bomLineUnit(l) === 'm') idxs.push(i); });
          if (idxs.length >= 2) { delete a.bom[idxs[0]].strapColor; a.bom.splice(idxs[1], 1); }
        }
        a.materialsDesc = U.val('a_matdesc').trim();
        const idx = Store.state.catalogA.findIndex(x => x.id === a.id);
        const before = idx >= 0 ? JSON.parse(JSON.stringify(Store.state.catalogA[idx])) : null;
        if (idx >= 0) Store.state.catalogA[idx] = a; else Store.state.catalogA.push(a);
        const entry = Store.log('accessoires', (this._isNewA ? 'Accessoire créé' : 'Accessoire modifié') + ' — ' + a.name,
          this._isNewA ? { type: 'deleteCreated', data: { domain: 'catalogA', id: a.id } } : { type: 'restoreItem', data: { domain: 'catalogA', id: a.id, before } });
        Store.save('catalogA'); U.closeModal(); App.rerender();
        U.toast(this._isNewA ? 'Accessoire créé.' : 'Modification enregistrée.', false, entry.id);
      }
    });
    this.drawBom();
  },

  duplicateAcc(id) {
    const src = Store.state.catalogA.find(x => x.id === id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = U.uid();
    copy.name = src.name + ' (copie)';
    copy.stockGeneral = 0;
    copy.stockEvent = 0;
    Store.state.catalogA.push(copy);
    const entry = Store.log('accessoires', 'Accessoire dupliqué — ' + copy.name,
      { type: 'deleteCreated', data: { domain: 'catalogA', id: copy.id } });
    Store.save('catalogA');
    App.rerender();
    U.toast('Copie créée — clique Modifier pour ajuster.', false, entry.id);
  },

  /* ---------- BOM picker (familles) ---------- */
  _bomLabel(l) {
    if (!l) return '';
    if (l.familyKey) {
      const fam = this.families().find(f => f.key === l.familyKey);
      if (!fam) return l.familyKey;
      return `${fam.label} (moy. ${U.eur(fam.avgCost)}/${fam.unit === 'm' ? 'm' : 'PCS'})`;
    }
    if (l.materialId) {
      const m = Store.material(l.materialId);
      return m ? `${m.name} (${U.eur(this.matCost(m))}/${m.unit === 'm' ? 'm' : 'PCS'})` : '';
    }
    return '';
  },

  /* Le texte (nom de produit) contient-il l'une des largeurs de sangle `ws` ? « Mousqueton 20mm » / « 20 mm » → vrai pour ['20mm'] ; « 120mm » → faux. */
  _labelHasWidth(txt, ws) {
    return ws.some(w => {
      const n = parseFloat(String(w).replace(',', '.')); if (!n) return false;
      return new RegExp('(^|[^\\d.,])' + String(n).replace('.', '[.,]') + '\\s*mm(?![a-z])', 'i').test(String(txt || ''));
    });
  },

  _bomListHTML(i) {
    const fams = this.families();
    const cat = this._bomCat[i] || '';
    const q = (this._bomQ[i] || '').toLowerCase();
    const ws = (this._a.strapWidths || []);
    let items = [];

    let filtered = fams.filter(f => ws.length || !f.bySize);   // les familles « type + taille » n'apparaissent que si une largeur de sangle est choisie
    if (cat) filtered = filtered.filter(f => f.kind === cat);

    if (ws.length) {
      filtered.forEach(f => {
        if (Store.isSangleKind(f.kind)) {
          if (ws.some(w => f.key === f.kind + ':' + w)) items.push({ type: 'family', data: f });
        } else if (f.bySize) {
          if (ws.some(w => this._normWidth(w) === f.size)) items.push({ type: 'family', data: f });
        } else if (f.unit === 'piece') {
          // boucleries + toute catégorie à la pièce (mousqueton, anneau…) : sélection par article, filtrée par largeur
          // produit dédié à une largeur (« Mousqueton 20mm », variantes = finitions) : la famille (prix moyen) est proposée, puis chaque article
          // produit « Toutes les tailles » (rivets, clous, décorations…) : proposé quelle que soit la largeur choisie
          const dedicated = this._labelHasWidth(f.label, ws), allW = f.materials.every(m => m.allSizes);
          if (dedicated || allW) items.push({ type: 'family', data: f });
          const wsn = ws.map(w => this._normWidth(w)), compatible = f.materials.filter(m => dedicated || m.allSizes || !m.variant || ws.includes(m.variant) || wsn.includes(this._sizeOf(m)));
          compatible.forEach(m => items.push({ type: 'material', data: m, family: f }));
        } else {
          items.push({ type: 'family', data: f });
        }
      });
    } else {
      filtered.forEach(f => items.push({ type: 'family', data: f }));
    }

    if (q) items = items.filter(it => {
      const label = it.type === 'family' ? it.data.label : it.data.name;
      return U.has(label, q);
    });

    if (!items.length) return '<div class="ac-item muted">Aucun résultat</div>';
    return items.map(it => {
      if (it.type === 'family') {
        const f = it.data;
        return `<div class="ac-item pp-row" onmousedown="event.preventDefault();Accessoires.pickBomFamily(${i},'${U.esc(f.key)}')"><span class="pp-a">${U.esc(f.label)}</span><span class="pp-b">${f.count} réf.</span><span class="pp-c">moy. ${U.eur(f.avgCost)} / ${f.unit === 'm' ? 'm' : 'PCS'}</span></div>`;
      }
      const m = it.data;
      const unit = m.unit === 'm' ? 'm' : 'PCS';
      return `<div class="ac-item pp-row" onmousedown="event.preventDefault();Accessoires.pickBomMaterial(${i},'${m.id}')"><span class="pp-a">${U.esc(m.name)}</span><span class="pp-b">stock ${U.qty(m.qty)} ${unit}</span><span class="pp-c">${U.eur(this.matCost(m))} / ${unit}</span></div>`;
    }).join('');
  },

  openBomPick(i) {
    if (this._bomOpen >= 0 && this._bomOpen !== i) {
      const prev = document.getElementById('a_bom_list_' + this._bomOpen);
      if (prev) prev.style.display = 'none';
      const prevIn = document.getElementById('a_bom_q_' + this._bomOpen);
      if (prevIn) prevIn.value = this._bomLabel(this._a.bom[this._bomOpen]);
    }
    this._bomOpen = i;
    this._bomQ[i] = '';
    const input = document.getElementById('a_bom_q_' + i);
    if (input) input.value = '';
    const listEl = document.getElementById('a_bom_list_' + i);
    if (listEl) { listEl.style.display = ''; listEl.innerHTML = this._bomListHTML(i); }
  },

  filterBomPick(i, v) {
    this._bomQ[i] = v;
    const listEl = document.getElementById('a_bom_list_' + i);
    if (listEl) listEl.innerHTML = this._bomListHTML(i);
  },

  closeBomPick() {
    if (this._bomOpen < 0) return;
    const i = this._bomOpen;
    this._bomOpen = -1;
    const listEl = document.getElementById('a_bom_list_' + i);
    if (listEl) listEl.style.display = 'none';
    const input = document.getElementById('a_bom_q_' + i);
    if (input) input.value = this._bomLabel(this._a.bom[i]);
  },

  setBomCat(i, v) {
    this._bomCat[i] = v;
    const l = this._a.bom[i];
    if (v && l && l.familyKey) {
      const fam = this.families().find(f => f.key === l.familyKey);
      if (fam && fam.kind !== v) {
        this._a.bom[i] = { familyKey: '', qty: l.qty || 1 };
        this.drawBom();
        return;
      }
    }
    if (this._bomOpen === i) {
      const listEl = document.getElementById('a_bom_list_' + i);
      if (listEl) listEl.innerHTML = this._bomListHTML(i);
    }
  },

  pickBomFamily(i, key) {
    this._a.bom[i] = { familyKey: key, qty: this._a.bom[i]?.qty || 1 };
    this._bomOpen = -1;
    this._bomQ[i] = '';
    this.drawBom();
  },

  pickBomMaterial(i, matId) {
    this._a.bom[i] = { materialId: matId, qty: this._a.bom[i]?.qty || 1 };
    this._bomOpen = -1;
    this._bomQ[i] = '';
    this.drawBom();
  },

  drawBom() {
    const kinds = Store.materialKinds()
      .map(k => ({ key: k.value, label: k.label }))
      .filter(k => Store.state.materials.some(m => (m.kind || 'autre') === k.key));
    const box = document.getElementById('a_bom');
    this._bomOpen = -1;

    box.innerHTML = (this._a.bom || []).map((l, i) => {
      const selLabel = this._bomLabel(l);
      const cat = this._bomCat[i] || '';

      return `<div class="frow" style="align-items:flex-end; margin-bottom:6px;">
        <div class="fg"><label>Catégorie</label>
          <select onchange="Accessoires.setBomCat(${i},this.value)">
            <option value="">— tous —</option>
            ${kinds.map(k => `<option value="${k.key}" ${cat === k.key ? 'selected' : ''}>${k.label}</option>`).join('')}
          </select>
        </div>
        <div class="fg" style="flex:2;position:relative;">
          <label>Famille (coût moyen)</label>
          <input id="a_bom_q_${i}" type="text" autocomplete="off"
            value="${U.esc(selLabel)}"
            placeholder="Chercher une famille…"
            onfocus="Accessoires.openBomPick(${i})"
            oninput="Accessoires.filterBomPick(${i},this.value)">
          <div id="a_bom_list_${i}" class="ac-list" style="max-height:200px;overflow:auto;display:none;"></div>
        </div>
        <div class="fg"><label>Quantité</label><input type="number" step="0.01" value="${l.qty}" onchange="Accessoires._a.bom[${i}].qty=this.value"></div>
        <div class="fg" style="flex:0;"><button class="btn-icon" onclick="Accessoires._a.bom.splice(${i},1);Accessoires.drawBom()">🗑️</button></div>
      </div>`;
    }).join('') || '<p class="muted">ex: 2,4 m de sangle 20mm + 1 mousqueton + 4 rivets…</p>';
  },

  addBom() { this._a.bom.push({ familyKey: '', qty: 1 }); this.drawBom(); },

  _updateCustomPreview() {
    const el = document.getElementById('cl_preview');
    if (!el || !this._clSrc) return;
    const desired = U.lenCm('cl_desired') / 100;
    const { prodLen, interneVal, fixedTotal, bicolor } = this._clSrc;
    if (desired > 0 && prodLen > 0) {
      const delta = desired - prodLen;
      const newInterne = Math.max(0, Math.round((interneVal + delta * 100) * 10) / 10);
      if (bicolor) {
        const s1 = Math.round(newInterne / 100 * 1000) / 1000;
        const s2 = Math.round(fixedTotal / 100 * 1000) / 1000;
        el.innerHTML = `Produit : <b>${U.qty(desired)} m</b> (${delta >= 0 ? '+' : ''}${U.qty(delta)} m)
          → Longueur interne : <b>${U.lenTxt(newInterne)}</b>
          → <b>Sangle 1 : ${U.qty(s1)} m</b> · <b>Sangle 2 : ${U.qty(s2)} m</b>`;
      } else {
        const newStrap = Math.round((fixedTotal + newInterne) / 100 * 1000) / 1000;
        el.innerHTML = `Produit : <b>${U.qty(desired)} m</b> (${delta >= 0 ? '+' : ''}${U.qty(delta)} m)
          → Longueur interne : <b>${U.lenTxt(newInterne)}</b>
          → <b>Sangle à couper : ${U.qty(newStrap)} m</b>`;
      }
    } else {
      el.innerHTML = '';
    }
  },

  customLength(id) {
    const src = Store.state.catalogA.find(x => x.id === id);
    if (!src) return;
    const sangleIdx = (src.bom || []).findIndex(l => this.bomLineUnit(l) === 'm');
    if (sangleIdx < 0) return;
    const currentStrap = U.num(src.bom[sangleIdx].qty);
    const segs = src.fabSegments || [];
    const prodLen = U.num(src.productLength);
    const hasSegs = segs.length > 0 && segs.some(s => s.value > 0);
    if (!prodLen) {
      U.toast('Renseigne d\'abord la "Longueur produit fini" dans Modifier.', true);
      return;
    }
    const interneVal = U.num(src.internalLength);
    const fixedTotal = segs.reduce((sum, s) => sum + U.num(s.value), 0);
    this._clSrc = { prodLen, interneVal, fixedTotal, bicolor: !!src.bicolor };
    U.modal({
      title: '📐 Sur mesure — ' + U.esc(src.name), okLabel: 'Créer la copie',
      body: `<p>Sangle actuelle : <b>${U.qty(currentStrap)} m</b> | Produit : <b>${U.qty(prodLen)} m</b></p>
        ${hasSegs || interneVal > 0 ? `<div class="card" style="padding:8px 12px;background:var(--th-bg);margin-bottom:12px;">
          ${segs.filter(s => s.value > 0).map(s => `<div>${U.esc(s.label)} : <b>${U.lenTxt(s.value)}</b></div>`).join('')}
          ${interneVal > 0 ? `<div style="border-top:1px dashed var(--input-border);padding-top:4px;margin-top:4px;">Longueur interne (X) : <b>${U.lenTxt(interneVal)}</b></div>` : ''}
        </div>` : ''}
        <div class="fg"><label>Longueur souhaitée du produit fini</label><div>${U.lenSplit('cl_desired', 0, { input: 'Accessoires._updateCustomPreview()' })}</div></div>
        <div id="cl_preview" class="mt" style="font-size:.95rem;"></div>
        <p class="muted mt">Seule la longueur interne (X) changera. Les segments fixes restent identiques.</p>`,
      onOk: () => {
        const desired = U.lenCm('cl_desired') / 100;
        if (desired <= 0) { U.toast('Longueur invalide', true); return false; }
        const delta = desired - prodLen;
        const newInterne = Math.max(0, Math.round((interneVal + delta * 100) * 10) / 10);
        const newStrap = Math.round((fixedTotal + newInterne) / 100 * 1000) / 1000;
        if (newStrap <= 0) { U.toast('Longueur trop courte (sangle négative)', true); return false; }
        const copy = JSON.parse(JSON.stringify(src));
        copy.id = U.uid();
        copy.productLength = desired;
        copy.internalLength = newInterne;
        this._autoStrap(copy);
        const lenRx = /\d+m\d+|\d+[.,]\d+\s*m(?!m)|\d+\s*m(?!m)/i;
        copy.name = lenRx.test(src.name)
          ? src.name.replace(lenRx, desired + 'm')
          : src.name + ' — ' + desired + 'm';
        Store.state.catalogA.push(copy);
        const entry = Store.log('accessoires', 'Sur mesure créé — ' + copy.name,
          { type: 'deleteCreated', data: { domain: 'catalogA', id: copy.id } });
        Store.save('catalogA');
        U.closeModal(); App.rerender();
        U.toast('Copie sur mesure créée.', false, entry.id);
      }
    });
    setTimeout(() => this._updateCustomPreview(), 50);
  },

  async delAcc(id) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    if (!await U.confirm(`Supprimer "${a.name}" ?`)) return;
    const snap = Store.snapshot('catalogA', a);
    Store.state.catalogA = Store.state.catalogA.filter(x => x.id !== id);
    const entry = Store.commitSnapshot(snap, 'accessoires', 'Accessoire supprimé — ' + a.name);
    Store.save('catalogA'); App.rerender();
    U.toast('Accessoire supprimé.', false, entry.id);
  },

  /* fabrication : consomme les matières premières du stock */
  fabricate(id) {
    const a = Store.state.catalogA.find(x => x.id === id);
    if (!a) return;
    this._fabBom = (a.bom || []).map(l => {
      if (l.familyKey) {
        const fam = this.families().find(f => f.key === l.familyKey);
        if (!fam) return { type: 'missing', label: l.familyKey, qty: l.qty };
        const sorted = [...fam.materials].sort((x, y) => U.num(y.qty) - U.num(x.qty));
        return { type: 'family', fam, materials: sorted, qty: l.qty, selectedId: sorted[0]?.id || '' };
      }
      if (l.materialId) { return { type: 'direct', m: Store.material(l.materialId), qty: l.qty }; }
      return null;
    }).filter(Boolean);

    const bomHTML = this._fabBom.map((b, i) => {
      if (b.type === 'family') {
        const unit = b.fam.unit === 'm' ? 'm' : 'PCS';
        const opts = b.materials.map(m =>
          `<option value="${m.id}" ${m.id === b.selectedId ? 'selected' : ''}>${U.esc(m.name)} — stock : ${U.qty(m.qty)} ${unit}</option>`
        ).join('');
        return `<div class="card" style="padding:8px 12px;margin-bottom:6px;background:var(--th-bg);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <b>${U.esc(b.fam.label)}</b><span class="muted">${U.qty(b.qty)} ${unit} par pièce</span></div>
          <select id="fab_mat_${i}" style="width:100%;" onchange="Accessoires._fabBom[${i}].selectedId=this.value">${opts}</select>
        </div>`;
      }
      if (b.type === 'direct' && b.m) {
        const unit = b.m.unit === 'm' ? 'm' : 'PCS';
        return `<div class="card" style="padding:8px 12px;margin-bottom:6px;background:var(--th-bg);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b>${U.esc(b.m.name)}</b><span class="muted">${U.qty(b.qty)} ${unit} — stock : ${U.qty(b.m.qty)} ${unit}</span></div>
        </div>`;
      }
      return `<div class="card" style="padding:8px 12px;margin-bottom:6px;color:var(--alerte);">⚠ Famille introuvable : ${U.esc(b.label)}</div>`;
    }).join('');

    U.modal({
      title: '🛠 Fabriquer — ' + U.esc(a.name), okLabel: 'Fabriquer',
      body: `<div class="fg"><label>Quantité à fabriquer</label><input id="fab_qty" type="number" step="1" value="1"></div>
        <h2 style="font-size:.95rem;margin-top:12px;">Matières à utiliser</h2>
        ${bomHTML || '<p class="muted">Aucune matière dans la nomenclature.</p>'}`,
      onOk: () => {
        const n = U.numVal('fab_qty');
        if (n <= 0) return false;
        const resolved = [];
        for (let i = 0; i < this._fabBom.length; i++) {
          const b = this._fabBom[i];
          const need = U.num(b.qty) * n;
          if (b.type === 'direct') {
            if (!b.m) { U.toast('Matière introuvable', true); return false; }
            if (U.num(b.m.qty) < need) { U.toast(`Stock insuffisant : ${b.m.name} (${U.qty(b.m.qty)} restant)`, true); return false; }
            resolved.push({ m: b.m, need });
          } else if (b.type === 'family') {
            const selId = document.getElementById('fab_mat_' + i)?.value || b.selectedId;
            const m = Store.material(selId);
            if (!m) { U.toast(`Matière non trouvée dans "${b.fam.label}"`, true); return false; }
            if (U.num(m.qty) < need) { U.toast(`Stock insuffisant : ${m.name} (${U.qty(m.qty)} restant, besoin de ${U.qty(need)})`, true); return false; }
            resolved.push({ m, need });
          } else { U.toast(`Famille introuvable : ${b.label}`, true); return false; }
        }
        const undo = { accId: a.id, n, mats: [], fid: U.uid() };
        for (const { m, need } of resolved) {
          m.qty = U.num(m.qty) - need;
          undo.mats.push({ id: m.id, qty: need });
        }
        const entry = Store.log('fabrication', `Fabrication de ${n} × ${a.name}`, { type: 'fabricate', data: undo });
        // Historique PERMANENT des fabrications (le journal ne garde que 600 actions) : sert aux stats « sangles / couleurs les plus utilisées » (Statistiques → Prix & marges → Accessoires)
        const S = Store.state.settings; (S.fabHistory = S.fabHistory || []).push({ id: undo.fid, ts: Date.now(), accId: a.id, n, mats: undo.mats.map(x => ({ ...x })) });
        if (S.fabHistory.length > 5000) S.fabHistory.splice(0, S.fabHistory.length - 5000);
        Store.save('materials', 'settings');
        U.closeModal(); App.rerender();
        U.toast(`${n} × ${a.name} — matières déduites du stock. 🛠`, false, entry.id);
      }
    });
  }
};
