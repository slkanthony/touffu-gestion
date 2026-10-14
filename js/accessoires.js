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
  /* Tri d'accessoires (Antho 2026-10-14) : nom SANS la longueur finale (« Laisse Classique — 1.2m » et « — 5m » = même nom), puis longueur du produit fini (1,2 m avant 5 m), puis largeur de sangle (16 mm avant 20 mm). */
  _baseName(a) { return String(a.name || '').replace(this._PERSO_RX, '').replace(/\s*[—–-]?\s*\d+(?:[.,]\d+)?\s*m\s*$/i, '').trim(); },
  _persoRank(a) { return ((a.uv !== undefined ? !!a.uv : U.num(a.uvMl) > 0) ? 1 : 0) + (a.laser ? 2 : 0); },
  _lenOf(a) { const l = U.num(a.productLength); if (l > 0) return l; const m = String(a.name || '').match(/(\d+(?:[.,]\d+)?)\s*m\s*$/i); return m ? parseFloat(m[1].replace(',', '.')) : 0; },
  _widthNum(a) { return parseFloat(String(a.mainWidth || (a.strapWidths || [])[0] || '').replace(',', '.')) || 0; },
  _cmpAcc(a, b) { return U.sortFr(this._baseName(a), this._baseName(b)) || (this._lenOf(a) - this._lenOf(b)) || (this._persoRank(a) - this._persoRank(b)) || (this._widthNum(a) - this._widthNum(b)) || U.sortFr(a.name, b.name); },

  /* ───── FAMILLES D'ACCESSOIRES (Antho 2026-10-14) ─────
     Un PRODUIT (famille) = même nom + même catégorie + même largeur de sangle principale ; ses déclinaisons = les longueurs (et la personnalisation UV / laser).
     Chaque déclinaison reste une fiche à part entière (même id, SKU, stock, historique de ventes : rien ne casse) ; la famille se lit sur les fiches :
     a.groupId, a.groupName (nom de la famille), a.groupCoeff (coefficient commun). Une fiche « suit » la famille si son coefficient = le commun et qu'elle n'a pas de prix forcé ;
     sinon elle a un réglage PROPRE (badge « propre »). Tout changement de famille = un seul « Annuler » (restoreBatch sur les fiches). */
  _grpOpen: {},
  setGrpOpen(gid, v) { this._grpOpen[gid] = !!v; },
  _grpMembers(gid) { return Store.state.catalogA.filter(x => x.groupId === gid).sort((a, b) => (this._lenOf(a) - this._lenOf(b)) || (this._persoRank(a) - this._persoRank(b)) || U.sortFr(a.name, b.name)); },
  _follows(a) { const gc = U.num(a.groupCoeff); return gc > 0 && Math.abs(U.num(a.coefficient) - gc) < 0.0005 && !(U.num(a.priceTTCManual) > 0); },
  _widthOf(a) { return a.mainWidth || (a.strapWidths || [])[0] || ''; },
  /* Applique `fn` à des fiches avec UN seul « Annuler » ; renvoie l'entrée de journal. */
  _grpTouch(list, fn, label) {
    const snaps = list.map(a => Store.snapshot('catalogA', a));
    list.forEach(fn);
    const entry = Store.log('accessoires', label, { type: 'restoreBatch', data: snaps });
    Store.save('catalogA'); App.rerender();
    return entry;
  },
  /* Propositions de familles pour les fiches pas encore rangées : même nom (sans longueur ni personnalisation) + catégorie + largeur, au moins 2 fiches. */
  _proposeGroups() {
    const map = {};
    Store.state.catalogA.filter(a => !a.groupId).forEach(a => {
      const k = U.normSearch(this._baseName(a)) + '|' + U.normSearch(a.category || '') + '|' + this._widthOf(a);
      (map[k] = map[k] || []).push(a);
    });
    return Object.values(map).filter(g => g.length >= 2).map(g => {
      g.sort((a, b) => (this._lenOf(a) - this._lenOf(b)) || (this._persoRank(a) - this._persoRank(b)) || U.sortFr(a.name, b.name));
      return { name: this._baseName(g[0]), category: g[0].category || '', width: this._widthOf(g[0]), members: g };
    }).sort((x, y) => U.sortFr(x.name, y.name) || (parseFloat(x.width) - parseFloat(y.width)));
  },
  openRegroup() {
    const props = this._proposeGroups();
    if (!props.length) { U.toast('Aucun regroupement à proposer : toutes tes fiches sont déjà rangées ou n\'ont pas de « jumelles ».'); return; }
    this._rgProps = props;
    const body = props.map((g, gi) => `<div class="card" style="padding:10px 14px;margin-bottom:10px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;"><input type="checkbox" id="rg_g_${gi}" checked style="width:auto;"> <b>Créer cette famille</b> <span class="badge info">${U.esc(g.category)}</span> <span class="badge">${U.esc(g.width || '—')}</span></label>
        <div class="fg" style="margin:8px 0;"><label>Nom du produit</label><input id="rg_n_${gi}" value="${U.esc(g.name)}"></div>
        ${g.members.map((a, mi) => `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:.88rem;margin:2px 0;"><input type="checkbox" id="rg_m_${gi}_${mi}" checked style="width:auto;"> <span>${U.esc(a.name)}</span> <span class="muted">· ${U.eur(Pricing.accCalc(a).priceTTC)}${a.sku ? ' · ' + U.esc(a.sku) : ''}</span></label>`).join('')}
      </div>`).join('');
    U.modal({
      title: '🗂 Regrouper mes accessoires', okLabel: 'Créer les familles',
      body: `<p class="muted" style="margin-top:0;">Voici ce que je propose : les fiches qui ne diffèrent que par la <b>longueur</b> (ou la personnalisation). Décoche une famille ou une fiche pour la laisser seule, corrige le nom si besoin. <b>Aucun prix, SKU ni stock ne change</b> ; tu pourras tout annuler.</p>${body}`,
      onOk: () => {
        const touched = [], made = [];
        props.forEach((g, gi) => {
          if (!document.getElementById('rg_g_' + gi) || !document.getElementById('rg_g_' + gi).checked) return;
          const mem = g.members.filter((a, mi) => { const c = document.getElementById('rg_m_' + gi + '_' + mi); return c && c.checked; });
          if (mem.length < 2) return;
          const name = (U.val('rg_n_' + gi) || g.name).trim() || g.name;
          const cnt = {}; mem.forEach(a => { const k = Math.round(U.num(a.coefficient) * 1000) / 1000; cnt[k] = (cnt[k] || 0) + 1; });
          const gc = Number(Object.keys(cnt).sort((p, q) => cnt[q] - cnt[p] || Number(p) - Number(q))[0]) || 2;   // coefficient le plus répandu
          made.push({ gid: U.uid(), name, gc, mem });
          mem.forEach(a => touched.push(a));
        });
        if (!made.length) { U.toast('Rien de coché : aucune famille créée.', true); return false; }
        const entry = this._grpTouch(touched, a => { const m = made.find(x => x.mem.includes(a)); a.groupId = m.gid; a.groupName = m.name; a.groupCoeff = m.gc; }, `Familles d'accessoires créées (${made.length}) — ${touched.length} fiches rangées`);
        made.forEach(m => { this._grpOpen[m.gid] = false; });
        U.closeModal();
        U.toast(`${made.length} famille${made.length > 1 ? 's' : ''} créée${made.length > 1 ? 's' : ''} (${touched.length} fiches).`, false, entry.id);
      }
    });
  },
  renameGroup(gid, val) {
    const name = String(val || '').trim(), mem = this._grpMembers(gid); if (!name || !mem.length) return;
    this._grpOpen[gid] = true;
    this._grpTouch(mem, a => { a.groupName = name; }, 'Famille renommée — ' + name);
  },
  /* Coefficient commun : met à jour les longueurs qui le SUIVENT ; celles à réglage propre sont gardées (badge « propre », bouton « Aligner »). */
  setGroupCoeff(gid, val) {
    const v = Math.round(U.num(val) * 100) / 100, mem = this._grpMembers(gid); if (!(v > 0) || !mem.length) return;
    let upd = 0, kept = 0;
    this._grpOpen[gid] = true;
    const entry = this._grpTouch(mem, a => { if (this._follows(a)) { a.coefficient = v; a.priceTTCManual = ''; upd++; } else kept++; a.groupCoeff = v; }, `Coefficient commun ${v} — ${mem[0].groupName || ''}`);
    U.toast(`Coefficient commun ${v} : ${upd} longueur${upd > 1 ? 's' : ''} mise${upd > 1 ? 's' : ''} à jour${kept ? `, ${kept} gardent leur réglage propre` : ''}.`, false, entry.id);
  },
  async alignGroup(gid) {
    const mem = this._grpMembers(gid).filter(a => !this._follows(a)); if (!mem.length) return;
    const gc = U.num(mem[0].groupCoeff);
    if (!await U.confirm(`Mettre ${mem.length} longueur${mem.length > 1 ? 's' : ''} au coefficient commun ${gc} ? Leur coefficient / prix propre est remplacé et leur prix TTC est recalculé.`, { title: '↻ Aligner la famille', okLabel: 'Aligner' })) return;
    this._grpOpen[gid] = true;
    const entry = this._grpTouch(mem, a => { a.coefficient = gc; a.priceTTCManual = ''; }, `Famille alignée sur le coefficient ${gc} (${mem.length})`);
    U.toast('Famille alignée.', false, entry.id);
  },
  async ungroup(gid) {
    const mem = this._grpMembers(gid); if (!mem.length) return;
    if (!await U.confirm(`Dégrouper « ${mem[0].groupName || 'cette famille'} » ? Les ${mem.length} fiches redeviennent des produits séparés (rien d'autre ne change).`, { title: 'Dégrouper', okLabel: 'Dégrouper' })) return;
    const entry = this._grpTouch(mem, a => { delete a.groupId; delete a.groupName; delete a.groupCoeff; }, 'Famille dégroupée — ' + (mem[0].groupName || ''));
    U.toast('Famille dégroupée.', false, entry.id);
  },
  /* « ＋ Ajouter une longueur » : même fenêtre que « Sur mesure », à partir d'une fiche de la famille ; la nouvelle fiche suit le coefficient commun. */
  addLength(gid) {
    const mem = this._grpMembers(gid); if (!mem.length) return;
    const ref = mem.find(a => !this._persoRank(a)) || mem[0];
    this._grpOpen[gid] = true;
    this.customLength(ref.id, true);
  },
  /* SKU de la famille : TYPE-LARGEUR-NOM-LONGUEUR[-UV][-LASER] pour chaque longueur (Pricing.autoSkuAcc), à valider ligne par ligne. */
  groupSkus(gid) {
    const mem = this._grpMembers(gid); if (!mem.length) return;
    const taken = new Set(); Store.state.catalogA.filter(x => x.groupId !== gid).forEach(x => { if (x.sku) taken.add(String(x.sku).trim().toUpperCase()); });
    Store.state.stockM.forEach(p => (p.variants || []).forEach(v => { if (v.sku) taken.add(String(v.sku).trim().toUpperCase()); }));
    Store.state.catalogM.forEach(p => (p.variants || []).forEach(v => { if (v.sku) taken.add(String(v.sku).trim().toUpperCase()); }));
    const rows = mem.map(a => { const base = Pricing.autoSkuAcc(a); let sku = base, n = 1; while (base && taken.has(sku.toUpperCase())) { n++; sku = base + '-' + n; } if (sku) taken.add(sku.toUpperCase()); return { a, now: String(a.sku || ''), next: sku }; });
    this._skuRows = rows;
    const changed = rows.filter(r => r.next && r.next !== r.now).length;
    U.modal({
      title: '✨ SKU de la famille — ' + U.esc(mem[0].groupName || ''), okLabel: 'Appliquer',
      body: `<p class="muted" style="margin-top:0;">Format <b>TYPE-LARGEUR-NOM-LONGUEUR</b> (+ -UV / -LASER). Coche les lignes à changer. ⚠️ Un SKU modifié doit l'être aussi dans SumUp et sur le site si tu les utilises.</p>
        <div class="table-wrap"><table><thead><tr><th></th><th>Fiche</th><th>SKU actuel</th><th>SKU proposé</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td><input type="checkbox" id="sk_${i}" ${r.next && r.next !== r.now ? 'checked' : ''} ${r.next && r.next !== r.now ? '' : 'disabled'} style="width:auto;"></td><td>${U.esc(r.a.name)}</td><td class="muted">${U.esc(r.now || '—')}</td><td><b>${U.esc(r.next || '—')}</b>${r.next === r.now ? ' <span class="muted">(déjà bon)</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted">${changed ? changed + ' SKU à mettre à jour.' : 'Tous les SKU de la famille sont déjà au bon format.'}</p>`,
      onOk: () => {
        const sel = rows.filter((r, i) => { const c = document.getElementById('sk_' + i); return c && c.checked && !c.disabled; });
        if (!sel.length) { U.toast('Rien de coché.', true); return false; }
        const entry = this._grpTouch(sel.map(r => r.a), a => { a.sku = sel.find(r => r.a === a).next; }, `SKU de la famille mis à jour — ${mem[0].groupName || ''} (${sel.length})`);
        U.closeModal(); U.toast(`${sel.length} SKU mis à jour.`, false, entry.id);
      }
    });
  },
  groupCard(shown) {
    const first = shown[0], gid = first.groupId, total = Store.state.catalogA.filter(x => x.groupId === gid).length;
    const mem = shown.slice().sort((a, b) => (this._lenOf(a) - this._lenOf(b)) || (this._persoRank(a) - this._persoRank(b)) || U.sortFr(a.name, b.name));
    const calcs = mem.map(a => Pricing.accCalc(a));
    const rng = (arr, f) => { const lo = Math.min(...arr), hi = Math.max(...arr); return Math.abs(hi - lo) < 0.005 ? f(lo) : f(lo) + ' – ' + f(hi); };
    const widths = [...new Set(mem.map(a => this._widthOf(a)).filter(Boolean))];
    const nCrit = calcs.filter(c => c.critical).length, nOwn = this._grpMembers(gid).filter(a => !this._follows(a)).length;
    const gc = U.num(first.groupCoeff), open = !!this._grpOpen[gid], name = first.groupName || this._baseName(first);
    return `<details class="fold prod-fold acc-fold acc-group" id="grp-${gid}" ${open ? 'open' : ''} ontoggle="Accessoires.setGrpOpen('${gid}',this.open)">
      <summary>
        <span><b>${U.esc(name)}</b> <span class="badge info">${mem.length === total ? total : mem.length + ' / ' + total} longueur${total > 1 ? 's' : ''}</span>${nCrit ? ` <span class="badge bad">${nCrit} coeff critique</span>` : ''}</span>
        <span class="type-col">${widths.map(w => `<span class="badge">${U.esc(w)}</span>`).join(' ') || '<span class="muted">—</span>'}</span>
        <span class="type-col"><span class="badge info">${U.esc(first.category || '')}</span></span>
        <span class="meta right sensitive">${rng(calcs.map(c => c.cost), U.eur)}</span>
        <span class="meta right"><b>${rng(calcs.map(c => c.priceTTC), U.eur)}</b></span>
      </summary>
      <div class="fold-body">
        <div class="card" style="padding:10px 14px;margin:0 0 10px;">
          <div class="frow" style="gap:10px;align-items:flex-end;flex-wrap:wrap;">
            <div class="fg mb0" style="flex:1 1 200px;min-width:170px;"><label>Nom du produit</label><input value="${U.esc(name)}" onchange="Accessoires.renameGroup('${gid}',this.value)"></div>
            <div class="fg mb0" style="flex:0 0 160px;"><label>Coefficient commun ${U.info("Le coefficient de toute la famille : change-le ici et toutes les longueurs qui le suivent se recalculent (prix TTC arrondi comme d'habitude). Une longueur dont tu as tapé le prix ou le coefficient garde son réglage (badge « propre ») : « Aligner » la remet au commun.")}</label><input type="number" step="0.01" min="0.01" value="${gc ? Math.round(gc * 100) / 100 : ''}" onchange="Accessoires.setGroupCoeff('${gid}',this.value)"></div>
            ${nOwn ? `<button class="btn-ghost btn-sm" onclick="Accessoires.alignGroup('${gid}')" title="Remettre les ${nOwn} longueur(s) à réglage propre au coefficient commun">↻ Aligner (${nOwn})</button>` : ''}
            <button class="btn-cta btn-sm" onclick="Accessoires.addLength('${gid}')">＋ Ajouter une longueur</button>
            <button class="btn-ghost btn-sm" onclick="Accessoires.groupSkus('${gid}')">✨ SKU de la famille</button>
            <button class="btn-ghost btn-sm" onclick="Accessoires.ungroup('${gid}')">Dégrouper</button>
          </div>
        </div>
        ${mem.map(a => this.accCard(a)).join('')}
      </div>
    </details>`;
  },
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

  bomLineLabel(l, a) {
    let label;
    if (l.familyKey) { const fam = this.families().find(f => f.key === l.familyKey); label = fam ? fam.label : l.familyKey; }
    else if (l.materialId) { const m = Store.material(l.materialId); label = m ? m.name : '⚠ matière supprimée'; }
    else label = '—';
    if (l.strapColor) label += ` (couleur ${l.strapColor}${a ? ' — ' + this._colorTitle(a, l.strapColor) : ''})`;
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
    if (focusId) { this.accQ = ''; this.accCatFilter = ''; this.accWidthFilter = ''; this.accBicolorFilter = ''; this._accOpen[focusId] = true; const _fa = Store.state.catalogA.find(x => x.id === focusId); if (_fa && _fa.groupId) this._grpOpen[_fa.groupId] = true; }
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
        case 'name': v = this._cmpAcc(a, b); break;
        case 'cat': v = U.sortFr(a.category||'', b.category||''); break;
        case 'width': v = this._widthNum(a) - this._widthNum(b); break;
        case 'cost': v = ca.cost - cb.cost; break;
        case 'price': v = ca.priceTTC - cb.priceTTC; break;
      }
      return (v || (this.accSort === 'name' ? 0 : this._cmpAcc(a, b))) * dir;
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
      <div class="toolbar"><button class="btn-cta" onclick="Accessoires.editAcc()">＋ Nouvel accessoire</button>${(() => { const n = this._proposeGroups().length; return n ? `<button class="btn-ghost" onclick="Accessoires.openRegroup()" title="Plusieurs fiches ne diffèrent que par la longueur : les ranger dans un seul produit">🗂 Regrouper les longueurs (${n})</button>` : ''; })()}</div>
      ${list.length ? `<div class="prod-list-header acc-header">
        <span>${sortHead('name', 'Nom du produit')}</span>
        <span>${sortHead('width', 'Largeur')}</span>
        <span>${sortHead('cat', 'Catégorie')}</span>
        <span class="right">${sortHead('cost', 'Coût')}</span>
        <span class="right">${sortHead('price', 'Prix TTC')}</span>
      </div>` : ''}
      ${(() => { const seen = new Set(); return list.map(a => { if (!a.groupId) return this.accCard(a); if (seen.has(a.groupId)) return ''; seen.add(a.groupId); return this.groupCard(list.filter(x => x.groupId === a.groupId)); }).join(''); })() || '<div class="card empty"><span class="big">🐕</span>Aucun accessoire. Crée ta première fiche : matières + temps de fabrication, et le prix se calcule tout seul.</div>'}`;
    if (focusId) setTimeout(() => { const el = document.getElementById('acc-' + focusId); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  },

  /* Le prix TTC tapé commande (comme les fiches Prix mastication) : le coefficient s'en déduit et est enregistré.
     Le prix n'est « forcé » (↺) que s'il n'est pas un « prix rond » (multiple de l'arrondi des Paramètres, 0,50 € par défaut) : le calcul auto arrondit ainsi. */
  _applyTtc(a, ttc) {
    if (!(ttc > 0)) { a.priceTTCManual = ''; return; }
    const cost = U.num(Pricing.accCost(a).cost), k = 1 + U.num(Store.state.settings.vatRate) / 100;
    if (!(cost > 0)) { a.priceTTCManual = ttc; return; }
    a.coefficient = Math.round(ttc / k / cost * 1e6) / 1e6;
    a.priceTTCManual = Math.abs(Pricing.roundAccPrice(cost * a.coefficient * k) - ttc) < 0.005 ? '' : ttc;
  },

  /* Maintenir l'appui sur « Profit net » : gain réel avec la TVA conservée (comme « Bénéfice » dans Prix mastication). */
  peekBenef(id, active) {
    document.querySelectorAll('.acc-benef-cell').forEach(td => { if (td.dataset.acc !== id) return; const b = td.querySelector('b'); if (b) b.textContent = active ? td.dataset.peek : td.dataset.normal; });
  },

  setAccInline(id, field, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (field === 'laborMinutes') a.laborMinutes = U.num(val);
    else if (field === 'coefficient') { a.coefficient = U.num(val); a.priceTTCManual = ''; }
    else if (field === 'priceTTCManual') this._applyTtc(a, U.num(val));
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
    this._applyColors(a);
    this._autoStrap(a);
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', (a.bicolor ? 'Bicolor activé' : 'Bicolor désactivé') + ' — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  toggleBicolorEnds(id) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    a.bicolorEnds = !a.bicolorEnds;
    this._applyColors(a);
    this._autoStrap(a);
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', (a.bicolorEnds ? '3 couleurs (extrémités différentes)' : '2 couleurs') + ' — ' + a.name);
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

  /* Nombre de COULEURS de sangle (Antho 2026-10-13) : 1 ; bicolor = 2 (couleur 1 = segments fixes rabat + poignée, couleur 2 = longueur interne) ;
     bicolor + « extrémités de couleurs différentes » (`a.bicolorEnds`, ≥ 2 segments) = 3 (couleur 1 = 1er segment, couleur 2 = les autres segments, couleur 3 = longueur interne). */
  _colorCount(a) { return a.bicolor ? ((a.bicolorEnds && (a.fabSegments || []).length >= 2) ? 3 : 2) : 1; },
  /* Quantités de sangle déduites des « Longueurs de fabrication » : [total] ou, par couleur, [segments…, interne] (en m, arrondi au mm) */
  _strapTargets(a, nStrap) {
    const segs = (a.fabSegments || []).map(s => U.num(s.value)), segTotal = segs.reduce((x, y) => x + y, 0);
    const interne = U.num(a.internalLength), r = x => x > 0 ? Math.round(x / 100 * 1000) / 1000 : 0, n = this._colorCount(a);
    if (n >= 2 && nStrap >= n) return n === 3 ? [r(segs[0] || 0), r(segTotal - (segs[0] || 0)), r(interne)] : [r(segTotal), r(interne)];
    return [r(segTotal + interne)];
  },
  /* Nom court de la partie de la laisse qui porte la couleur c (d'après le nom des segments) */
  _colorTitle(a, c) {
    const all = a.fabSegments || [], n = this._colorCount(a), clean = l => String(l || '').replace(/\s*\([^)]*\)/g, '').trim() || 'segment';
    if (c === n) return 'longueur interne';
    if (n === 2) return all.map(s => clean(s.label)).join(' + ') || 'segments';
    if (c === 1) return clean(all[0] && all[0].label);
    return all.length > 2 ? all.slice(1).map(s => clean(s.label)).join(' + ') : clean(all[1] && all[1].label);
  },
  _colorParts(a) {
    const n = this._colorCount(a); if (n < 2) return [];
    return this._strapTargets(a, n).map((q, i) => ({ k: i + 1, title: this._colorTitle(a, i + 1), qty: q }));
  },
  _colorSubText(a) {
    const p = this._colorParts(a);
    return p.length ? p.map(x => `Couleur ${x.k} = ${x.title}`).join(' · ') : 'Coche si la laisse utilise des sangles de couleurs différentes.';
  },
  /* Met les lignes de sangle de la nomenclature en accord avec le nombre de couleurs (ajoute / retire des lignes, numérote 1, 2, 3) */
  _applyColors(a) {
    const n = this._colorCount(a), colored = () => this._strapIdxs(a).filter(i => a.bom[i].strapColor);
    let col = colored();
    if (n === 1) {
      if (!col.length) return;
      for (let k = col.length - 1; k >= 1; k--) a.bom.splice(col[k], 1);
      delete a.bom[col[0]].strapColor; delete a.bom[col[0]].qtyManual;
      return;
    }
    if (!col.length) { const si = this._strapIdxs(a); if (!si.length) return; a.bom[si[0]].strapColor = 1; col = colored(); }
    if (col.length === n) { col.forEach((i, k) => { a.bom[i].strapColor = k + 1; }); return; }
    for (let k = col.length - 1; k >= n; k--) a.bom.splice(col[k], 1);
    col = colored();
    const { strapColor, qtyManual, _cat, tpl, ...rest } = a.bom[col[0]];
    while (col.length < n) {
      const at = col[col.length - 1] + 1;
      a.bom.splice(at, 0, { ...rest, qty: 0, strapColor: col.length + 1 });
      col = colored();
    }
    col.forEach((i, k) => { a.bom[i].strapColor = k + 1; delete a.bom[i].qtyManual; });
  },
  _strapIdxs(a) { const idx = []; (a.bom || []).forEach((l, i) => { if (this.bomLineUnit(l) === 'm') idx.push(i); }); return idx; },
  /* Met la quantité de sangle d'après les longueurs, sauf pour une ligne saisie à la main (l.qtyManual). */
  _autoStrap(a) {
    const idxs = this._strapIdxs(a); if (!idxs.length) return;
    this._strapTargets(a, idxs.length).forEach((q, k) => {
      const l = a.bom[idxs[k]];
      if (!l || l.qtyManual) return;
      if ((a.bicolor && idxs.length >= 2) || q > 0) l.qty = Math.round(q * 100) / 100;   // 2 décimales (au cm près) comme tout l'affichage
    });
  },
  /* À l'ouverture d'une fiche existante : une quantité de sangle différente du calcul est considérée « saisie à la main » (on ne la change pas en douce). */
  _flagManualStrap(a) {
    const idxs = this._strapIdxs(a);
    this._strapTargets(a, idxs.length).forEach((q, k) => {
      const l = a.bom[idxs[k]];
      if (l && q > 0 && Math.abs(U.num(l.qty) - q) > 0.0051) l.qtyManual = true;
    });
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
      const label = this.bomLineLabel(l, a);
      const unit = this.bomLineUnit(l);
      const unitCost = this.bomLineCost(l);
      const isFamily = !!l.familyKey;
      return `<tr><td class="col-name">${U.esc(label)}${isFamily ? ' <span class="muted">(moy.)</span>' : ''}</td>
        <td class="num"><input type="number" step="0.01" value="${l.qty}" class="acc-inline-input" onchange="Accessoires.setAccBomQty('${a.id}',${li},this.value)"> ${unit}</td>
        <td class="num sensitive">${U.eur(unitCost * U.num(l.qty))}</td></tr>`;
    }).join('');
    const strapRows = (a.bom || []).filter(l => this.bomLineUnit(l) === 'm');
    const strapTotalRow = strapRows.length >= 2 ? `<tr><td class="col-name"><b>📏 Total sangle</b> <span class="muted">(${strapRows.length} couleurs)</span></td><td class="num"><b>${U.qty(strapRows.reduce((s, l) => s + U.num(l.qty), 0))} m</b></td><td class="num sensitive">${U.eur(strapRows.reduce((s, l) => s + this.bomLineCost(l) * U.num(l.qty), 0))}</td></tr>` : '';
    const fabHTML = this._fabCardHTML(a);
    const notesHTML = this._notesHTML(a);
    const accOpen = this._accOpen[a.id] || false;
    const widths = this._normalizeWidths(a);
    const criticalClass = c.critical ? ' acc-critical' : '';
    return `<details class="fold prod-fold acc-fold${criticalClass}" id="acc-${a.id}" ${accOpen ? 'open' : ''} ontoggle="Accessoires.setAccOpen('${a.id}',this.open)">
      <summary>
        <span><b>${U.esc(a.name)}</b>${c.critical ? ' <span class="badge bad">coeff critique</span>' : ''}${a.groupId && !this._follows(a) ? ' <span class="badge warn" title="Coefficient ou prix propre à cette longueur (différent du coefficient commun de la famille)">propre</span>' : ''}</span>
        <span class="type-col">${widths.map(w => `<span class="badge${w === a.mainWidth && widths.length > 1 ? ' info' : ''}">${w === a.mainWidth && widths.length > 1 ? '★ ' : ''}${U.esc(w)}</span>`).join(' ') || '<span class="muted">—</span>'}</span>
        <span class="type-col"><span class="badge info">${U.esc(a.category)}</span></span>
        <span class="meta right sensitive">${U.eur(c.cost)}</span>
        <span class="meta right"><b>${U.eur(c.priceTTC)}</b></span>
      </summary>
      <div class="fold-body">
        ${fabHTML}
        <div class="grid c2">
          <div>
            <h2 style="font-size:.9rem;">Nomenclature</h2>
            <div class="table-wrap"><table><thead><tr><th class="col-name">Matière</th><th class="num">Qté</th><th class="num">Coût</th></tr></thead>
              <tbody>${bomRows || '<tr><td colspan="3" class="muted">Aucune matière.</td></tr>'}${strapTotalRow}
              <tr><td>Main d'œuvre (<input type="number" step="1" value="${U.num(a.laborMinutes)}" class="acc-inline-input" onchange="Accessoires.setAccInline('${a.id}','laborMinutes',this.value)"> min à <span class="sensitive">${U.eur(Store.state.settings.laborRate)}/h</span>)</td><td></td><td class="num sensitive">${U.eur(c.laborCost)}</td></tr>
              ${U.num(a.extraCost) ? `<tr><td>Autres coûts</td><td></td><td class="num sensitive">${U.eur(a.extraCost)}</td></tr>` : ''}
              ${U.num(c.laserCost) ? `<tr><td>🔦 Gravure laser <span class="muted">(${U.qty(a.laserMin)} min × ${U.eur(Pricing.laserCostPerHour() / 60)}/min)</span></td><td></td><td class="num sensitive">${U.eur(c.laserCost)}</td></tr>` : ''}
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
              <tr><td>TVA <span class="muted">${vatOn ? '(reversée)' : '(conservée)'}</span></td><td class="num sensitive ${vatOn ? 'neg' : ''}">${vatOn ? '− ' : ''}${U.eur(c.vatAmt)}</td></tr>
              <tr class="acc-benef-row" ${vatOn ? '' : `style="cursor:pointer;user-select:none;" title="Maintenir l'appui : voir le gain avec la TVA conservée" onmousedown="Accessoires.peekBenef('${a.id}',true)" onmouseup="Accessoires.peekBenef('${a.id}',false)" onmouseleave="Accessoires.peekBenef('${a.id}',false)" ontouchstart="event.preventDefault();Accessoires.peekBenef('${a.id}',true)" ontouchend="Accessoires.peekBenef('${a.id}',false)" ontouchcancel="Accessoires.peekBenef('${a.id}',false)"`}><td><b>Profit net</b> <span class="muted help">Marge moins cotisations, TVA non comptée (le bénéfice que tu auras une fois assujetti).${vatOn ? '' : ' Maintiens l’appui sur cette ligne pour voir le gain réel d’aujourd’hui : tu gardes la TVA et les cotisations se calculent sur le prix TTC encaissé (même chiffre que dans les Stats).'}</span></td><td class="num sensitive acc-benef-cell ${netProfit >= 0 ? 'pos' : 'neg'}" data-acc="${a.id}" data-normal="${U.eur(netProfit)}" data-peek="${U.eur(vatOn ? netProfit : c.profitActuel)}"><b>${U.eur(netProfit)}</b></td></tr>
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
    if (this._colorCount(a) >= 2) {
      this._colorParts(a).forEach(p => { if (p.qty > 0) parts.push(`Couleur ${p.k} : ${U.qty(p.qty)} m`); });
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
    if (a.bicolor && segs.length >= 2) left += `<div style="margin-top:6px;"><label style="cursor:pointer;font-size:.82rem;display:flex;align-items:center;gap:6px;"><input type="checkbox" ${a.bicolorEnds ? 'checked' : ''} onchange="Accessoires.toggleBicolorEnds('${a.id}')"> <span>Extrémités de couleurs différentes (3 couleurs)</span></label></div>`;

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
    if (this._colorCount(a) >= 2) {
      bottom = `<div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap;">${this._colorParts(a).map(p => `<div style="flex:1;min-width:150px;text-align:center;padding:10px;border-radius:6px;background:var(--th-bg);border:1px solid var(--input-border);">
          <div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.03em;">Couleur ${p.k} — ${U.esc(p.title)}</div>
          <b style="font-size:1.15rem;">${U.qty(p.qty)} m</b></div>`).join('')}</div>`;
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
    this._ensureStrap(); this.syncStrap();
    const el = document.getElementById('a_widths_wrap');
    if (el) el.innerHTML = this._widthsSelectHTML();
    this._syncIdentity();
  },
  setAllWidths(all) {
    this._a.strapWidths = all ? this._availableWidths().slice() : [];
    if (!all || this._a.strapWidths.length === 1) this._a.mainWidth = this._a.strapWidths[0] || '';
    this._ensureStrap(); this.syncStrap();
    const el = document.getElementById('a_widths_wrap');
    if (el) el.innerHTML = this._widthsSelectHTML();
    this._syncIdentity();
  },
  setMainWidth(w) {
    this._a.mainWidth = w;
    const el = document.getElementById('a_widths_wrap');
    if (el) el.innerHTML = this._widthsSelectHTML();
    this._syncIdentity();
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
  /* SKU proposé d'après le formulaire (type, largeur principale, nom, longueur du produit fini, UV / laser), unique parmi les autres fiches. */
  _formSku() {
    const a = this._a, ws = a.strapWidths || [];
    const base = Pricing.autoSkuAcc({ category: U.val('a_cat'), name: U.val('a_name'), mainWidth: a.mainWidth || ws[0] || '', productLength: U.lenCm('a_prodLen') / 100, uv: U.chk('a_uv'), laser: U.chk('a_laser') });
    const taken = this._takenSkus(a.id); let sku = base, n = 1;
    while (base && taken.has(sku)) { n++; sku = base + '-' + n; }
    return { base, sku, n };
  },
  genSku() {
    this.onProdLenChange();   // le nom reçoit d'abord la longueur du produit fini
    const { base, sku, n } = this._formSku();
    if (!base) { U.toast('Choisis un type et un nom pour générer le SKU.', true); return; }
    document.getElementById('a_sku').value = sku;
    U.toast(`SKU proposé : ${sku}${n > 1 ? ' (le SKU de base existait déjà)' : ''}`);
  },
  /* Personnalisation (Antho 2026-10-13) : impression UV et/ou gravure laser. Nom : « … — Personnalisation UV — Gravure laser » ; SKU : « …-UV-LASER ». */
  _PERSO_RX: /(\s*[—–-]\s*(personnalisation\s+uv|gravure\s+laser))+\s*$/i,
  _persoName(name, uv, laser) {
    const base = String(name || '').replace(this._PERSO_RX, '').trimEnd();
    return base ? base + (uv ? ' — Personnalisation UV' : '') + (laser ? ' — Gravure laser' : '') : base;
  },
  /* SKU avec les bons suffixes (-UV puis -LASER), avant un éventuel -2 de collision ; un « -5 » sans suffixe fait partie du nom. */
  _persoSku(sku, uv, laser) {
    const m = String(sku).match(/^(.*?)((?:-UV)?(?:-LASER)?)((?:-\d+)?)$/i);
    let base = m[1], tags = m[2], num = m[3];
    if (!tags && num) { base += num; num = ''; }
    return base + (uv ? '-UV' : '') + (laser ? '-LASER' : '') + num;
  },
  /* Cases « Personnalisation UV » / « Gravure laser » : cochée → le NOM et le SKU déjà écrit prennent leur suffixe et la case des ml / minutes apparaît à droite ; décochée → tout est retiré (valeur remise à 0). Un SKU vide n'est pas inventé : bouton « Générer ». */
  onPersoToggle(which) {
    const uv = U.chk('a_uv'), laser = U.chk('a_laser');
    [['a_uvml', uv, 'uv'], ['a_lasermin', laser, 'laser']].forEach(([id, on, w]) => {
      const el = document.getElementById(id); if (!el) return;
      el.style.display = on ? '' : 'none';
      if (!on) el.value = ''; else if (w === which) el.focus({ preventScroll: true });
    });
    const nm = document.getElementById('a_name');
    if (nm) { const v = this._persoName(nm.value, uv, laser); if (v !== nm.value) nm.value = v; }
    const el = document.getElementById('a_sku'); if (!el) return;
    const old = el.value.trim(); if (!old) return;
    const sku = this._persoSku(old, uv, laser); if (sku === old) return;
    el.value = sku;
    const taken = this._takenSkus(this._a.id);
    if (taken.has(sku.toUpperCase())) U.toast(`SKU ${sku} : déjà utilisé par une autre fiche.`, true);
    else U.toast(`SKU mis à jour : ${sku}`);
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
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 10px;border:1px solid var(--caramel);border-radius:8px;margin-bottom:6px;text-transform:none;letter-spacing:0;color:var(--texte);">
          <input id="a_bicolor" type="checkbox" style="width:15px;height:15px;flex:0 0 auto;" ${a.bicolor ? 'checked' : ''} onchange="Accessoires.onBicolor()">
          <span><b style="font-size:.85rem;">🎨 Bicolor — sangles de couleurs différentes</b><br><span class="muted" id="a_bicolor_sub" style="font-size:.72rem;">${this._colorSubText(a)}</span></span>
        </label>
        <div id="a_segs_wrap">${this._fabSegsInnerHTML(segs)}</div>
        <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--input-border);">
          <div class="fg"><label>Longueur interne — X</label><div>${U.lenSplit('a_internLen', interne, { change: 'Accessoires.syncStrap()' })}</div></div>
        </div>
      </div>`;
  },

  _fabSegsInnerHTML(segs) {
    return (segs || []).map((s, i) => `<div class="frow" style="gap:8px;align-items:flex-end;margin-top:6px;">
      <div class="fg" style="flex:2;"><input id="a_seg_label_${i}" value="${U.esc(s.label)}" placeholder="ex: Rabat" style="width:100%;" onchange="Accessoires.syncStrap()"></div>
      <div class="fg" style="flex:0 0 auto;">${U.lenSplit('a_seg_val_' + i, s.value, { change: 'Accessoires.syncStrap()' })}</div>
      <div class="fg" style="flex:0;"><button class="btn-icon" type="button" onclick="Accessoires.delFabSeg(${i})">×</button></div>
    </div>${i === 0 ? this._endsToggleHTML(segs) : ''}`).join('') + `<button class="btn-ghost btn-sm mt" type="button" onclick="Accessoires.addFabSeg()">＋ Ajouter un segment</button>`;
  },

  /* Petite case entre le 1er et le 2e segment : « ces extrémités n'ont pas la même couleur » → 3 couleurs (visible seulement en bicolor, avec ≥ 2 segments) */
  _endsToggleHTML(segs) {
    if (!(this._a && this._a.bicolor && segs.length >= 2)) return '';
    return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:6px 0 0 6px;font-size:.84rem;text-transform:none;letter-spacing:0;color:var(--texte);"><input id="a_bicolorEnds" type="checkbox" ${this._a.bicolorEnds ? 'checked' : ''} onchange="Accessoires.onBicolorEnds()"> <span>Ces 2 sangles ne sont pas de la même couleur <span class="muted">(→ 3 couleurs)</span></span></label>`;
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
    this.syncStrap();
  },

  delFabSeg(i) {
    this._readFabSegs();
    if (this._a.fabSegments) this._a.fabSegments.splice(i, 1);
    const el = document.getElementById('a_segs_wrap');
    if (el) el.innerHTML = this._fabSegsInnerHTML(this._a.fabSegments || []);
    this.syncStrap();
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
    this._syncIdentity();
    const el = document.getElementById('a_segs_wrap');
    if (el) el.innerHTML = this._fabSegsInnerHTML(this._a.fabSegments || []);
    U.lenSet('a_internLen', U.num(this._a.internalLength));
    if (this._isNewA || !(this._a.bom || []).length) this._a.bom = (this._a.bom || []).filter(l => !(l.tpl && !l.familyKey && !l.materialId)).concat(this._tplLines(cat));
    this.syncStrap();
  },

  /* Nom + SKU suivent le type, la longueur du produit fini et la largeur principale tant qu'ils sont « automatiques » (Antho 2026-10-13) :
     le nom garde ses mots (« Bi-color », « (copie) »…) mais change de type / de longueur ; le SKU est refait seulement s'il est au format automatique TYPE-LARGEUR-… (jamais un SKU tapé à la main). */
  _syncIdentity() {
    const nameEl = document.getElementById('a_name'); if (!nameEl || !document.getElementById('a_prodLen_m')) return;
    const a = this._a, ws = a.strapWidths || [], cat = U.val('a_cat'), len = Math.round(U.lenCm('a_prodLen')) / 100;
    const snap = this._idSnap || { category: cat, mainWidth: a.mainWidth || ws[0] || '' };
    const skuEl = document.getElementById('a_sku'), prev = skuEl ? skuEl.value.trim().toUpperCase() : '';
    const autoPrefix = [Pricing.slugify(snap.category), Pricing.slugify(snap.mainWidth)].filter(Boolean).join('-');
    let name = nameEl.value.trim().replace(this._PERSO_RX, '');
    if (!name) name = cat;
    else if (snap.category && snap.category !== cat && name.toLowerCase().startsWith(snap.category.toLowerCase()) && !/^[A-Za-zÀ-ÿ0-9]/.test(name.slice(snap.category.length))) name = cat + name.slice(snap.category.length);
    if (len > 0) {
      const tok = /(^|[\s—–-])\d+(?:[.,]\d+)?\s*m(?![A-Za-z0-9])/i, txt = Math.round(len * 100) / 100 + 'm';
      if (tok.test(name)) name = name.replace(tok, (m0, p) => p + txt);
      else { const mm = name.match(/^(.*?)\s*(\([^)]*\))?\s*$/); name = mm[1] + ' — ' + txt + (mm[2] ? ' ' + mm[2] : ''); }
    }
    nameEl.value = this._persoName(name, U.chk('a_uv'), U.chk('a_laser'));
    this._idSnap = { category: cat, mainWidth: a.mainWidth || ws[0] || '' };
    a.productLength = len;
    if (skuEl && prev && autoPrefix && (prev === autoPrefix || prev.startsWith(autoPrefix + '-'))) {
      const { sku } = this._formSku();
      if (sku && sku.toUpperCase() !== prev) { skuEl.value = sku; U.toast(`SKU mis à jour : ${sku}`); }
    }
  },
  /* Longueur du produit fini modifiée : la longueur interne bouge du même écart (même règle que « Sur mesure » et la saisie dans la fiche), donc sangle et coût suivent. */
  onProdLenChange() {
    const el = document.getElementById('a_internLen_m'); if (!el) return;
    const oldLen = U.num(this._a.productLength), newLen = Math.round(U.lenCm('a_prodLen')) / 100;
    this._syncIdentity();
    if (oldLen > 0 && newLen > 0 && Math.abs(newLen - oldLen) > 0.0001) {
      const oldInt = U.lenCm('a_internLen'), newInt = Math.max(0, Math.round((oldInt + (newLen - oldLen) * 100) * 10) / 10);
      if (newInt !== oldInt) {
        U.lenSet('a_internLen', newInt);
        this.syncStrap();
        U.toast(`Longueur interne ajustée : ${U.lenTxt(oldInt)} → ${U.lenTxt(newInt)}`);
      }
    }
  },

  editAcc(id) {
    const S = Store.state.settings;
    const fabDefs = S.accFabDefaults || {};
    const a = id ? JSON.parse(JSON.stringify(Store.state.catalogA.find(x => x.id === id)))
      : (() => { const cat = S.accCategories[0]; const defs = (fabDefs[cat]?.segments || []).map(s => ({ ...s })); let internLen = 0; const ii = defs.findIndex(s => s.label && s.label.toLowerCase().includes('interne')); if (ii >= 0) { internLen = U.num(defs[ii].value); defs.splice(ii, 1); } return { id: U.uid(), name: '', category: cat, bom: this._tplLines(cat), laborMinutes: 20, extraCost: 0, coefficient: 2.5, priceTTCManual: '', sku: '', notes: '', handleLength: '', flapLength: '', materialsDesc: '', strapWidths: [], fabSegments: defs, productLength: 0, internalLength: internLen }; })();
    this._normalizeWidths(a);
    this._a = a; this._isNewA = !id; this._widthsOpen = false; this._bomQ = {};
    if (!this._isNewA) this._flagManualStrap(a);
    if (!this._isNewA && (!a.fabSegments || !a.fabSegments.length)) {
      const defs = this._fabDefaults(a.category).map(s => ({ ...s }));
      if (defs.length) {
        const ii = defs.findIndex(s => s.label && s.label.toLowerCase().includes('interne'));
        if (ii >= 0 && a.internalLength === undefined) { a.internalLength = U.num(defs[ii].value); defs.splice(ii, 1); }
        a.fabSegments = defs;
      }
    }
    this._idSnap = { category: a.category || '', mainWidth: a.mainWidth || (a.strapWidths || [])[0] || '' };
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
      <p class="muted help">La sangle se calcule toute seule d'après « Longueurs de fabrication » (en bas) : tu n'as pas à la saisir. Mousquetons, rivets, anneaux… : choisis la catégorie puis la référence, avec la quantité. Les lignes sans référence sont ignorées à l'enregistrement.</p>
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
        <div class="fg"><label>SKU (option)</label><div style="display:flex;gap:6px;"><input id="a_sku" style="flex:1;min-width:0;" value="${U.esc(a.sku || '')}" placeholder="TYPE-LARGEUR-NOM"><button type="button" class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Accessoires.genSku()" title="Génère le SKU : type - largeur principale - nom (ex. LONGE-20MM-5M, + -UV si impression UV). La couleur n'y entre jamais.">✨ Générer</button></div></div>
      </div>
      <div class="frow">
        <div class="fg"><label>🎨 Personnalisation</label>${(() => { const uvOn = a.uv !== undefined ? !!a.uv : U.num(a.uvMl) > 0, laOn = !!a.laser;
          const lab = 'display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;color:var(--texte);font-size:.9rem;margin:0;white-space:nowrap;';
          return `<div style="display:flex;align-items:center;gap:8px 22px;flex-wrap:wrap;min-height:40px;">
            <span style="display:flex;align-items:center;gap:12px;"><label style="${lab}"><input id="a_uv" type="checkbox" style="width:16px;height:16px;" ${uvOn ? 'checked' : ''} onchange="Accessoires.onPersoToggle('uv')"> Impression UV</label><input id="a_uvml" type="number" step="0.1" min="0" value="${a.uvMl || ''}" placeholder="ml d'encre" style="width:120px;margin:0;${uvOn ? '' : 'display:none;'}"></span>
            <span style="display:flex;align-items:center;gap:12px;"><label style="${lab}"><input id="a_laser" type="checkbox" style="width:16px;height:16px;" ${laOn ? 'checked' : ''} onchange="Accessoires.onPersoToggle('laser')"> Gravure laser</label><input id="a_lasermin" type="number" step="0.5" min="0" value="${a.laserMin || ''}" placeholder="minutes" style="width:110px;margin:0;${laOn ? '' : 'display:none;'}"></span></div>`; })()}</div>
      </div>
      <h2 style="font-size:.95rem;">📐 Longueurs de fabrication</h2>
      <div id="a_fab_row">
        ${this._fabFieldsHTML(a)}
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
        a.sku = U.val('a_sku'); a.uv = U.chk('a_uv'); a.uvMl = a.uv ? U.numVal('a_uvml') : 0; a.laser = U.chk('a_laser'); a.laserMin = a.laser ? U.numVal('a_lasermin') : 0; a.strapWidths = this._a.strapWidths || []; a.mainWidth = this._a.mainWidth || ''; delete a.strapWidth;
        a.notes = U.val('a_notes');
        this._readFabSegs();
        a.fabSegments = this._a.fabSegments || [];
        a.productLength = U.lenCm('a_prodLen') / 100;
        a.internalLength = U.lenCm('a_internLen');
        a.bicolor = !!document.getElementById('a_bicolor')?.checked;
        // lignes sans référence ignorées ; champs de travail du formulaire retirés ; sangle recalculée d'après les longueurs
        const nBefore = (a.bom || []).length;
        a.bom = (a.bom || []).filter(l => l.familyKey || l.materialId).map(l => { const c = { ...l }; delete c._cat; delete c.tpl; return c; });
        this._autoStrap(a);
        if (a.bom.length < nBefore) U.toast(`${nBefore - a.bom.length} ligne(s) de matière sans référence ignorée(s).`);
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
    { const base = Pricing.autoSkuAcc(copy), taken = this._takenSkus(copy.id); let sku = base, n = 1; while (base && taken.has(sku)) { n++; sku = base + '-' + n; } copy.sku = base ? sku : ''; }   // jamais le même SKU que l'original
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

  /* Le texte (nom de produit) cite-t-il une largeur en mm qui n'est PAS parmi celles choisies ? « mousqueton 25mm » avec 20mm choisi → vrai (peu importe l'unité de la matière). */
  _otherWidthOnly(txt, ws) {
    const found = [...String(txt || '').matchAll(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*mm(?![a-z])/gi)].map(m => m[1].replace(',', '.') + 'mm');
    if (!found.length) return false;
    const wsn = ws.map(w => this._normWidth(w));
    return !found.some(w => wsn.includes(w));
  },

  _bomListHTML(i) {
    const fams = this.families();
    const cat = (this._a.bom[i] || {})._cat || '';
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
          const wsn = ws.map(w => this._normWidth(w)), compatible = f.materials.filter(m => dedicated || m.allSizes || ((!m.variant || ws.includes(m.variant) || wsn.includes(this._sizeOf(m))) && !this._otherWidthOnly(m.product || m.name, ws)));
          compatible.forEach(m => items.push({ type: 'material', data: m, family: f }));
        } else if (!this._otherWidthOnly(f.label, ws)) {
          items.push({ type: 'family', data: f });   // autre unité (m…) : proposée sauf si son nom cite une autre largeur
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
    const l = this._a.bom[i]; if (!l) return;
    l._cat = v;
    if (v && l.familyKey) {
      const fam = this.families().find(f => f.key === l.familyKey);
      if (fam && fam.kind !== v) {
        this._a.bom[i] = { familyKey: '', qty: l.qty || 1, _cat: v };
        this.drawBom();
        return;
      }
    }
    if (this._bomOpen === i) {
      const listEl = document.getElementById('a_bom_list_' + i);
      if (listEl) listEl.innerHTML = this._bomListHTML(i);
    }
  },

  /* Choisir une référence garde le reste de la ligne (couleur de sangle 1/2, catégorie) ; une sangle reprend la quantité calculée. */
  _pickInto(i, ref) {
    const o = this._a.bom[i] || {};
    const n = { ...o, qty: o.qty || 1 }; delete n.familyKey; delete n.materialId; delete n.qtyManual; delete n.tpl;
    this._a.bom[i] = { ...n, ...ref };
    this._bomOpen = -1; this._bomQ[i] = '';
    this._applyColors(this._a);
    this._autoStrap(this._a);
    this.drawBom();
  },
  pickBomFamily(i, key) { this._pickInto(i, { familyKey: key }); },
  pickBomMaterial(i, matId) { this._pickInto(i, { materialId: matId }); },

  setBomQty(i, v) {
    const l = this._a.bom[i]; if (!l) return;
    l.qty = Math.round(U.num(v) * 100) / 100;
    if (this.bomLineUnit(l) === 'm') l.qtyManual = true;
    this.drawBom();
  },
  bomAuto(i) {
    const l = this._a.bom[i]; if (!l) return;
    delete l.qtyManual;
    this.syncStrap();
  },
  delBom(i) { this._a.bom.splice(i, 1); this.drawBom(); },

  /* Relit les longueurs du formulaire, recalcule la sangle, redessine les matières (appelé à chaque modification des longueurs, du bicolor, de la largeur…). */
  syncStrap() {
    const a = this._a; if (!a) return;
    this._readFabSegs();
    if (document.getElementById('a_internLen_m')) a.internalLength = U.lenCm('a_internLen');
    this._applyColors(a);
    this._autoStrap(a);
    const sub = document.getElementById('a_bicolor_sub'); if (sub) sub.textContent = this._colorSubText(a);
    this.drawBom();
  },

  /* Une seule largeur choisie : la sangle correspondante est proposée toute seule (ou mise à la nouvelle largeur). */
  _ensureStrap() {
    const a = this._a, ws = a.strapWidths || []; if (ws.length !== 1) return;
    const fams = this.families(), idxs = this._strapIdxs(a);
    if (!idxs.length) {
      const fam = fams.find(f => f.key === 'sangle:' + ws[0]);
      if (fam) a.bom.unshift({ familyKey: fam.key, qty: 1 });
      return;
    }
    idxs.forEach(i => {
      const l = a.bom[i]; if (!l.familyKey) return;
      const k = l.familyKey.indexOf(':'); if (k < 0 || l.familyKey.slice(k + 1) === ws[0]) return;
      const nk = l.familyKey.slice(0, k) + ':' + ws[0];
      if (fams.some(f => f.key === nk)) l.familyKey = nk;
    });
  },

  /* Bicolor : les sangles de chaque couleur apparaissent tout de suite dans « Matières utilisées ». */
  onBicolor() {
    this._a.bicolor = !!document.getElementById('a_bicolor')?.checked;
    this._readFabSegs();
    const el = document.getElementById('a_segs_wrap'); if (el) el.innerHTML = this._fabSegsInnerHTML(this._a.fabSegments || []);
    this.syncStrap();
  },
  onBicolorEnds() {
    this._a.bicolorEnds = !!document.getElementById('a_bicolorEnds')?.checked;
    this.syncStrap();
  },

  /* Lignes « modèle » du type d'accessoire (Paramètres → Segments et pièces de fabrication) : catégorie + quantité, référence à choisir. */
  _tplLines(cat) {
    return (((Store.state.settings.accFabDefaults || {})[cat] || {}).parts || []).map(p => ({ familyKey: '', qty: U.num(p.qty) || 1, _cat: p.kind || '', tpl: true }));
  },

  drawBom() {
    const kinds = Store.materialKinds()
      .map(k => ({ key: k.value, label: k.label }))
      .filter(k => Store.state.materials.some(m => (m.kind || 'autre') === k.key));
    const box = document.getElementById('a_bom');
    if (!box) return;
    this._bomOpen = -1;
    const bom = this._a.bom || [], sIdx = this._strapIdxs(this._a), targets = this._strapTargets(this._a, sIdx.length);

    box.innerHTML = bom.map((l, i) => {
      const selLabel = this._bomLabel(l);
      const cat = l._cat || '';
      const picked = !!(l.familyKey || l.materialId), k = sIdx.indexOf(i);
      const unit = picked ? this.bomLineUnit(l) : '';
      let hint = '';
      if (k >= 0 && k < targets.length) {
        const t = targets[k];
        hint = t > 0
          ? (l.qtyManual
            ? `✏️ Quantité saisie à la main · les longueurs ci-dessous donnent <b>${U.qty(t)} m</b> <button type="button" class="btn-ghost btn-sm" onclick="Accessoires.bomAuto(${i})">🔗 Revenir au calcul auto</button>`
            : `🔗 Calculée d'après les longueurs de fabrication ci-dessous (${U.qty(t)} m)`)
          : '🔗 Renseigne les longueurs de fabrication ci-dessous : la quantité de sangle se calcule toute seule.';
      } else if (!picked && l.tpl) hint = '🧩 Ligne prévue par ton modèle : choisis la référence (sans référence, elle est ignorée à l\'enregistrement).';

      const chip = l.strapColor ? `🎨 Couleur ${l.strapColor} — ${U.esc(this._colorTitle(this._a, l.strapColor))}` : '';
      return `<div style="margin-bottom:8px;${chip ? 'padding:6px 8px;border-left:4px solid var(--caramel);background:var(--th-bg);border-radius:6px;' : ''}">${chip ? `<div style="font-weight:700;font-size:.9rem;color:var(--caramel);margin-bottom:4px;">${chip}</div>` : ''}<div class="frow" style="align-items:flex-end;">
        <div class="fg"><label>Catégorie</label>
          <select onchange="Accessoires.setBomCat(${i},this.value)">
            <option value="">— tous —</option>
            ${kinds.map(kd => `<option value="${kd.key}" ${cat === kd.key ? 'selected' : ''}>${kd.label}</option>`).join('')}
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
        <div class="fg"><label>Quantité${unit ? ' (' + unit + ')' : ''}</label><input type="number" step="0.01" value="${Math.round(U.num(l.qty) * 100) / 100}" onchange="Accessoires.setBomQty(${i},this.value)"></div>
        <div class="fg" style="flex:0;"><button class="btn-icon" onclick="Accessoires.delBom(${i})">🗑️</button></div>
      </div>${hint ? `<div class="muted" style="font-size:.8rem;margin-top:3px;">${hint}</div>` : ''}</div>`;
    }).join('') || '<p class="muted">ex: 2,4 m de sangle 20mm + 1 mousqueton + 4 rivets…</p>';
    if (sIdx.length >= 2) {
      const tot = sIdx.reduce((s, i) => s + U.num(bom[i].qty), 0);
      box.innerHTML += `<div style="padding:6px 8px;border-radius:6px;background:var(--th-bg);font-weight:700;">📏 Total sangle : ${U.qty(tot)} m <span class="muted" style="font-weight:400;">(${sIdx.length} sangles)</span></div>`;
    }
  },

  addBom() { this._a.bom.push({ familyKey: '', qty: 1 }); this.drawBom(); },

  _updateCustomPreview() {
    const el = document.getElementById('cl_preview');
    if (!el || !this._clSrc) return;
    const desired = U.lenCm('cl_desired') / 100;
    const { prodLen, interneVal, fixedTotal } = this._clSrc;
    if (desired > 0 && prodLen > 0) {
      const delta = desired - prodLen;
      const newInterne = Math.max(0, Math.round((interneVal + delta * 100) * 10) / 10);
      if (this._colorCount(this._clSrc.src) >= 2) {
        const parts = this._colorParts({ ...this._clSrc.src, internalLength: newInterne });
        el.innerHTML = `Produit : <b>${U.qty(desired)} m</b> (${delta >= 0 ? '+' : ''}${U.qty(delta)} m)
          → Longueur interne : <b>${U.lenTxt(newInterne)}</b>
          → ${parts.map(p => `<b>Couleur ${p.k} (${U.esc(p.title)}) : ${U.qty(p.qty)} m</b>`).join(' · ')}`;
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

  customLength(id, asVariant) {
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
    this._clSrc = { prodLen, interneVal, fixedTotal, src };
    U.modal({
      title: (asVariant ? '＋ Ajouter une longueur — ' : '📐 Sur mesure — ') + U.esc(src.name), okLabel: asVariant ? 'Ajouter la longueur' : 'Créer la copie',
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
        copy.stockGeneral = 0; copy.stockEvent = 0;   // une nouvelle longueur démarre sans stock (la copie gardait celui de l'original)
        if (copy.groupId && U.num(copy.groupCoeff) > 0) { copy.coefficient = copy.groupCoeff; copy.priceTTCManual = ''; }   // elle suit le coefficient commun de la famille
        copy.productLength = desired;
        copy.internalLength = newInterne;
        this._autoStrap(copy);
        const lenRx = /\d+m\d+|\d+[.,]\d+\s*m(?!m)|\d+\s*m(?!m)/i;
        copy.name = lenRx.test(src.name)
          ? src.name.replace(lenRx, desired + 'm')
          : src.name + ' — ' + desired + 'm';
        { const base = Pricing.autoSkuAcc(copy), taken = this._takenSkus(copy.id); let sku = base, n = 1; while (base && taken.has(sku)) { n++; sku = base + '-' + n; } copy.sku = base ? sku : ''; }   // SKU propre à cette longueur
        Store.state.catalogA.push(copy);
        const entry = Store.log('accessoires', (asVariant ? 'Longueur ajoutée — ' : 'Sur mesure créé — ') + copy.name,
          { type: 'deleteCreated', data: { domain: 'catalogA', id: copy.id } });
        Store.save('catalogA');
        U.closeModal(); App.rerender();
        U.toast(asVariant ? 'Longueur ajoutée à la famille.' : 'Copie sur mesure créée.', false, entry.id);
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
  /* Construit la liste des matières de la fenêtre « Fabriquer » à partir d'une fiche (ou d'une copie modifiée pour cette seule fabrication). */
  _fabBuild(src) {
    this._fabBom = (src.bom || []).map(l => {
      const tag = l.strapColor ? '🎨 Couleur ' + l.strapColor + ' — ' + this._colorTitle(src, l.strapColor) : '';
      if (l.familyKey) {
        const fam = this.families().find(f => f.key === l.familyKey);
        if (!fam) return { type: 'missing', label: l.familyKey, qty: l.qty };
        const sorted = [...fam.materials].sort((x, y) => U.num(y.qty) - U.num(x.qty));
        return { type: 'family', fam, materials: sorted, qty: l.qty, selectedId: sorted[0]?.id || '', tag, color: l.strapColor || 0 };
      }
      if (l.materialId) { return { type: 'direct', m: Store.material(l.materialId), qty: l.qty, tag, color: l.strapColor || 0 }; }
      return null;
    }).filter(Boolean);
  },
  _fabBomHTML() {
    return this._fabBom.map((b, i) => {
      if (b.type === 'family') {
        const unit = b.fam.unit === 'm' ? 'm' : 'PCS';
        const opts = b.materials.map(m =>
          `<option value="${m.id}" ${m.id === b.selectedId ? 'selected' : ''}>${U.esc(m.name)} — stock : ${U.qty(m.qty)} ${unit}</option>`
        ).join('');
        return `<div class="card" style="padding:8px 12px;margin-bottom:6px;background:var(--th-bg);">
          ${b.tag ? `<div style="font-weight:700;font-size:.85rem;color:var(--caramel);margin-bottom:4px;">${U.esc(b.tag)}</div>` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <b>${U.esc(b.fam.label)}</b><span class="muted">${U.qty(b.qty)} ${unit} par pièce</span></div>
          <select id="fab_mat_${i}" style="width:100%;" onchange="Accessoires._fabBom[${i}].selectedId=this.value">${opts}</select>
        </div>`;
      }
      if (b.type === 'direct' && b.m) {
        const unit = b.m.unit === 'm' ? 'm' : 'PCS';
        return `<div class="card" style="padding:8px 12px;margin-bottom:6px;background:var(--th-bg);">
          ${b.tag ? `<div style="font-weight:700;font-size:.85rem;color:var(--caramel);margin-bottom:4px;">${U.esc(b.tag)}</div>` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b>${U.esc(b.m.name)}</b><span class="muted">${U.qty(b.qty)} ${unit} — stock : ${U.qty(b.m.qty)} ${unit}</span></div>
        </div>`;
      }
      return `<div class="card" style="padding:8px 12px;margin-bottom:6px;color:var(--alerte);">⚠ Famille introuvable : ${U.esc(b.label)}</div>`;
    }).join('');
  },
  /* Case « Ces 2 sangles ne sont pas de la même couleur » DANS la fenêtre Fabriquer (Antho 2026-10-14) : pour CETTE fabrication seulement (la fiche ne change pas),
     bascule entre 2 et 3 couleurs → un bloc de choix de sangle en plus. Les sangles déjà choisies sont gardées par numéro de couleur. */
  _fabToggleEnds() {
    const a = this._fabSrcAcc; if (!a) return;
    const keep = {}; this._fabBom.forEach((b, i) => { if (b.color && b.type === 'family') { const el = document.getElementById('fab_mat_' + i); if (el) keep[b.color] = el.value; } });
    const c = JSON.parse(JSON.stringify(a)); c.bicolorEnds = !!(document.getElementById('fab_ends') || {}).checked;
    this._applyColors(c); this._autoStrap(c);
    this._fabBuild(c);
    this._fabBom.forEach(b => { if (b.color && b.type === 'family' && keep[b.color] && b.materials.some(m => m.id === keep[b.color])) b.selectedId = keep[b.color]; });
    const w = document.getElementById('fab_bom_wrap'); if (w) w.innerHTML = this._fabBomHTML() || '<p class="muted">Aucune matière dans la nomenclature.</p>';
  },
  fabricate(id) {
    const a = Store.state.catalogA.find(x => x.id === id);
    if (!a) return;
    this._fabSrcAcc = a;
    this._fabBuild(a);
    const bomHTML = this._fabBomHTML();
    const endsBox = a.bicolor && (a.fabSegments || []).length >= 2 ? `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:6px 0 0;font-size:.84rem;text-transform:none;letter-spacing:0;"><input id="fab_ends" type="checkbox" ${a.bicolorEnds ? 'checked' : ''} onchange="Accessoires._fabToggleEnds()"> <span>Ces 2 sangles ne sont pas de la même couleur <span class="muted">(→ 3 couleurs, pour cette fabrication)</span></span></label>` : '';

    U.modal({
      title: '🛠 Fabriquer — ' + U.esc(a.name), okLabel: 'Fabriquer',
      body: `<div class="fg"><label>Quantité à fabriquer</label><input id="fab_qty" type="number" step="1" value="1"></div>
        <h2 style="font-size:.95rem;margin-top:12px;">Matières à utiliser</h2>
        ${endsBox}
        <div id="fab_bom_wrap" style="margin-top:8px;">${bomHTML || '<p class="muted">Aucune matière dans la nomenclature.</p>'}</div>`,
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
