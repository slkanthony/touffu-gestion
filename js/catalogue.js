/* ============================================================
   CATALOGUE MASTICATION — tarification (repris du Calculateur)
   Deux vues : liste (cartes) et éditeur pleine page (créer/modifier),
   séparées comme deux "pages" via le hash (#/catalogue,
   #/catalogue/new, #/catalogue/edit/<id>) — voir App.routeFor/_onHashChange.
   ============================================================ */
const Catalogue = {
  filters: { q: '', meat: 'all', sup: 'all', sort: 'meat', sortDir: 'asc' },
  mode: 'list',      // 'list' | 'new' | 'edit'
  editId: null,
  _loadedKey: null,
  _sel: new Set(),
  _previewSup: {},   // pId -> supplierId : prévisualisation temporaire (aucune donnée modifiée)
  _prodOpen: {},     // pId -> true/false, persiste l'état ouvert/fermé des fiches liste
  _showInactive: {}, // pId -> true/false, afficher les variantes désactivées
  _meatFilterOpen: false,
  _setMeatFilter(val) { this.filters.meat = val; this._meatFilterOpen = false; this.render(); },
  _setSupFilter(val) { this.filters.sup = val; this.render(); },

  render() {
    if (this.mode === 'new' || this.mode === 'edit') {
      const key = this.mode + ':' + (this.editId || 'new');
      if (this._loadedKey !== key) { this._loadedKey = key; this.loadDraft(); }
      // loadDraft() peut être retombé en mode 'list' (produit introuvable) :
      // ne jamais tenter renderEditor() sans brouillon valide (filet anti écran-noir).
      if ((this.mode === 'new' || this.mode === 'edit') && this._d) return this.renderEditor();
    }
    this._loadedKey = null;
    return this.renderList();
  },

  renderList() {
    const S = Store.state.settings;
    const f = this.filters;
    U.syncFilters('catalogue', f);
    let list = Store.state.catalogM.filter(p =>
      (!f.q || p.name.toLowerCase().includes(f.q.toLowerCase())) &&
      (f.meat === 'all' || (p.meatType || '').toLowerCase() === f.meat.toLowerCase()) &&
      (f.sup === 'all' || (f.sup === '_multi' ? (p.suppliers || []).length >= 2 : f.sup === '_single' ? (p.suppliers || []).length <= 1 : (p.suppliers || []).some(s => s.supplierId === f.sup)))
    );
    const dir = f.sortDir === 'desc' ? -1 : 1;
    const hasCritical = (p) => { const base = Pricing.baseUnitCost(p); const na = (p.variants||[]).filter(v => v.enabled !== false).length; let idx = 0; return (p.variants||[]).some(v => { if (v.enabled === false) return false; const c = Pricing.variantCalc(p, v, idx, base, na); idx++; return c.critical; }); };
    list.sort((a, b) => {
      if (f.sort === 'name') return dir * U.sortFr(a.name, b.name);
      if (f.sort === 'supplier') return dir * U.sortFr(Store.supplierName(a.mainSupplierId), Store.supplierName(b.mainSupplierId));
      if (f.sort === 'base') return dir * (Pricing.baseUnitCost(a).unitHT - Pricing.baseUnitCost(b).unitHT);
      if (f.sort === 'critical') return dir * ((hasCritical(b) - hasCritical(a)) || U.sortFr(a.name, b.name));
      return dir * U.sortFr((a.meatType || '') + a.name, (b.meatType || '') + b.name); // 'meat' (défaut)
    });
    const sortHead = (key, label) => `<span class="sortable ${f.sort === key ? 'active' : ''}" onclick="Catalogue.setSort('${key}')">${label} ${f.sort === key ? (f.sortDir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;

    App.mount(`
      <div class="view-title"><h1>Prix mastication</h1><span class="sub">${Store.state.catalogM.length} produits · coefficient, marges & profit</span></div>
      <div class="toolbar">
        <div class="fg"><label>Recherche</label><input id="cf_q" value="${U.esc(f.q)}" placeholder="nom du produit…" oninput="Catalogue.filters.q=this.value;Catalogue.render();document.getElementById('cf_q').focus();document.getElementById('cf_q').setSelectionRange(999,999)"></div>
        <div class="fg"><label>Viande</label>${U.meatFilter({ current: f.meat, meats: S.meatTypes, count: Store.state.catalogM.length, setter: 'Catalogue._setMeatFilter', openState: this._meatFilterOpen, openSetter: 'Catalogue._meatFilterOpen' })}</div>
        <div class="fg"><label>Fournisseur</label>${U.customSelect({ value: f.sup, options: [{v:'all',l:'Tous'},{v:'_multi',l:'Multi fournisseurs'},{v:'_single',l:'Un seul fournisseur'}].concat(S.suppliers.map(s => ({v:s.id,l:Store.supplierName(s.id)})).sort((a,b) => U.sortFr(a.l,b.l))), onPick: 'Catalogue._setSupFilter' })}</div>
        <a class="btn btn-cta" style="text-decoration:none;text-align:center;" href="#/catalogue/new">＋ Nouveau produit</a>
      </div>
      ${list.length ? `<div class="toolbar" style="margin-top:-8px">
        <button class="btn-ghost btn-sm" onclick="Catalogue.expandAll()">📂 Tout développer</button>
        <button class="btn-ghost btn-sm" onclick="Catalogue.collapseAll()">📁 Tout réduire</button>
      </div>` : ''}
      ${list.length ? `<div class="prod-list-header cat-header">
        <span>${sortHead('name', 'Nom du produit')}</span>
        <span>${sortHead('critical', 'Alertes')}</span>
        <span>${sortHead('meat', 'Viande')}</span>
        <span>${sortHead('supplier', 'Fournisseurs')}</span>
        <span class="right">${sortHead('base', 'Variantes / base')}</span>
        <span style="text-align:right">Décote paliers (%)</span>
        <span></span>
      </div>` : ''}
      ${list.map(p => this.card(p)).join('') || `<div class="card empty"><span class="big">🥩</span>Aucun produit. Crée ton premier produit ou importe ton fichier <b>Prix_final.json</b> depuis Paramètres → Import.</div>`}
      ${this._sel.size ? `<div class="cat-sel-bar">
        <span class="cat-sel-count">${this._sel.size} produit${this._sel.size>1?'s':''} sélectionné${this._sel.size>1?'s':''}</span>
        ${this._sel.size>=2?'<button class="btn btn-cta btn-sm" onclick="Catalogue.mergeSelected()">🔀 Fusionner</button>':''}
        ${this._sel.size===1?'<button class="btn btn-ghost btn-sm" onclick="Catalogue.duplicateSelected()">👥 Dupliquer</button>':''}
        <button class="btn-danger btn-sm" onclick="Catalogue.deleteSelected()">🗑️ Supprimer</button>
        <button class="btn-ghost btn-sm" onclick="Catalogue.clearSel()">Annuler</button>
      </div>` : ''}
    `);
  },

  setSort(key) {
    const f = this.filters;
    if (f.sort === key) f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc';
    else { f.sort = key; f.sortDir = 'asc'; }
    this.render();
  },

  /* Prix d'achat HT/u d'une fiche fournisseur (même formule que Pricing.baseUnitCost) */
  supUnitHT(s) {
    const vat = 1 + U.num(s.vatRate !== undefined && s.vatRate !== '' ? s.vatRate : Store.state.settings.vatRate) / 100;
    let price = U.num(s.price);
    if ((s.taxType || 'HT') === 'TTC') price /= vat;
    const div = s.unit === 'kilo' ? (U.num(s.weight) || 1) : (U.num(s.quantity) || 1);
    return price / div;
  },

  previewSup(pId, supId) {
    if (this._previewSup[pId] === supId) delete this._previewSup[pId];
    else this._previewSup[pId] = supId;
    this._prodOpen[pId] = true;
    App.rerender();
  },
  setCatOpen(pId, open) {
    this._prodOpen[pId] = open;
    if (!open) delete this._previewSup[pId];
  },
  toggleInactive(pId) {
    this._showInactive[pId] = !this._showInactive[pId];
    this._prodOpen[pId] = true;
    App.rerender();
  },
  expandAll() { Store.state.catalogM.forEach(p => this._prodOpen[p.id] = true); this.render(); },
  collapseAll() { Store.state.catalogM.forEach(p => { this._prodOpen[p.id] = false; delete this._previewSup[p.id]; }); this.render(); },

  card(p) {
    const S = Store.state.settings;
    const selected = this._sel.has(p.id);
    const preview = this._previewSup[p.id];
    const activeSup = preview || p.mainSupplierId;
    const baseMain = Pricing.baseUnitCost(p);
    const base = preview ? Pricing.baseUnitCost(p, preview) : baseMain;
    const actives = (p.variants || []).filter(v => v.enabled !== false);
    const na = actives.length;
    let critCount = 0;
    let idx = 0;
    const varRow = (v, on) => {
      const curIdx = idx;
      const cRaw = Pricing.variantCalc(p, v, on ? curIdx : 0, base, na);
      let c = cRaw;
      if (preview) {
        const cMain = Pricing.variantCalc(p, v, on ? curIdx : 0, baseMain, na);
        const S = Store.state.settings;
        const cost = cRaw.cost;
        const priceHT = cMain.priceHT;
        const priceTTC = cMain.priceTTC;
        const coeff = cost > 0 ? priceHT / cost : 0;
        const margin = priceHT - cost;
        const social = priceHT * (U.num(S.socialTaxRate) / 100);
        const vatAmt = priceTTC - priceHT;
        const profit = margin - social - vatAmt;
        c = { ...cRaw, priceHT, priceTTC, coeff, margin, social, vatAmt, profit, effCoeff: coeff, priceFixed: true, critical: coeff < U.num(S.b2bCoeffThreshold) };
      }
      if (on) { idx++; if (c.critical) critCount++; }
      return `<tr class="${on ? '' : 'dim'}">
        <td class="col-name"><b>${U.esc(Pricing.labelVariant(v))}</b>${c.critical && on ? ' <span class="badge bad">coeff critique</span>' : ''}</td>
        <td class="num sensitive">${U.eur(c.cost, 3)}</td>
        <td class="num sensitive">${c.coeff.toFixed(2)}${c.priceFixed ? ' <span class="badge info" title="Prix de vente fixé — coefficient recalculé selon le coût de ce fournisseur">fixe</span>' : ''}${c.priceFixed && Math.abs(c.effDiscount) > 0.001 ? `<br><span class="num-decote-eff" title="Décote effective par rapport au prix sans décote (coeff × coût)">−${U.pct(c.effDiscount * 100)}</span>` : c.discount ? `<br><span class="num-decote">−${U.pct(c.discount * 100)}</span>` : ''}</td>
        <td class="num sensitive">${U.eur(c.priceHT)}</td>
        <td class="num sensitive num-marge">${U.eur(c.margin)}</td>
        <td class="num sensitive num-cotis">${U.eur(c.social)}</td>
        <td class="num sensitive ${S.vatActive ? 'num-cotis' : 'num-marge'}">${S.vatActive ? '− ' : ''}${U.eur(c.priceTTC - c.priceHT)}</td>
        <td class="num sensitive num-benef-cell ${c.profit >= 0 ? 'pos' : 'neg'}" data-normal="${U.eur(c.profit)}" data-peek="${U.eur(c.profit + c.priceTTC - c.priceHT)}"><b>${U.eur(c.profit)}</b></td>
        <td class="num">${v.priceTTCManual ? `<button class="btn-icon" title="Revenir au calcul automatique (coeff × décote)" onclick="Catalogue.resetCardPrice('${p.id}','${v.id}')" style="vertical-align:middle;">↺</button>` : ''}<b><input type="number" step="0.10" value="${c.priceTTC.toFixed(2)}" style="width:85px;text-align:right;font-weight:700;" onchange="Catalogue.setCardPriceTTC('${p.id}','${v.id}',this.value,${on ? curIdx : -1})"></b></td>
      </tr>`;
    };
    const showInactive = this._showInactive[p.id];
    const inactiveVars = (p.variants || []).filter(v => v.enabled === false);
    const rows = (p.variants || []).map(v => {
      const on = v.enabled !== false;
      if (!on && !showInactive) return '';
      return varRow(v, on);
    }).join('');
    const supRows = (p.suppliers || []).slice().sort((a, b) => {
      if (a.supplierId === p.mainSupplierId) return -1;
      if (b.supplierId === p.mainSupplierId) return 1;
      return U.sortFr(Store.supplierName(a.supplierId), Store.supplierName(b.supplierId));
    }).map(s => {
      const isMain = s.supplierId === p.mainSupplierId;
      const vatNote = (s.vatRate !== undefined && s.vatRate !== '') ? ` <span class="muted">(TVA achat ${U.num(s.vatRate)}%)</span>` : '';
      const link = (s.url && !Store.hideSupplierInfo()) ? ` <button class="btn-icon" title="Ouvrir la page fournisseur" onclick="window.open('${U.esc(s.url)}','_blank','noopener')">🔗</button>` : '';
      return `<tr class="${isMain ? '' : 'dim'}">
        <td class="col-name">${isMain ? '★ ' : ''}${U.esc(Store.supplierName(s.supplierId))}${vatNote}${link}</td>
        <td class="num sensitive">${U.eur(this.supUnitHT(s), 3)}/${s.unit === 'kilo' ? 'kg' : 'pc'} HT</td>
        <td>${isMain ? '<span class="badge main-sup">principal</span>' : `<button class="btn-ghost btn-sm" onclick="Catalogue.setMain('${p.id}','${s.supplierId}')">Passer principal</button>`}</td>
      </tr>`;
    }).join('');
    const supBadges = (p.suppliers || []).slice().sort((a, b) => a.supplierId === p.mainSupplierId ? -1 : b.supplierId === p.mainSupplierId ? 1 : 0).map(s => {
      const isActive = s.supplierId === activeSup;
      const isMain = s.supplierId === p.mainSupplierId;
      const prefix = isMain ? '★ ' : '';
      if (isActive) return `<span class="sup-badge main" title="${isMain ? 'Fournisseur principal' : 'Comparaison — cliquer pour revenir au principal'}" onclick="event.preventDefault();event.stopPropagation();Catalogue.previewSup('${p.id}','${s.supplierId}')">${prefix}${U.esc(Store.supplierName(s.supplierId))}</span>`;
      return `<span class="sup-badge alt" title="Comparer avec ce fournisseur" onclick="event.preventDefault();event.stopPropagation();Catalogue.previewSup('${p.id}','${s.supplierId}')">${prefix}${U.esc(Store.supplierName(s.supplierId))}</span>`;
    }).join('');
    return `<details class="fold prod-fold cat-fold${selected ? ' cat-selected' : ''}" data-cid="${p.id}" ${this._prodOpen[p.id] ? 'open' : ''} ontoggle="Catalogue.setCatOpen('${p.id}',this.open)">
      <summary onclick="Catalogue.summaryNav(event,'${p.id}')" onauxclick="Catalogue.summaryNav(event,'${p.id}')">
        <b>${U.esc(p.name)}</b>
        <span>${critCount ? '<span class="badge bad">⚠ coeff critique</span>' : ''}</span>
        <span><span class="badge info">${U.esc(p.meatType || '—')}</span></span>
        <span class="sup-badges" onclick="event.stopPropagation()">${(p.suppliers || []).length ? supBadges : '<span class="muted">—</span>'}</span>
        <span class="meta right">${actives.length} variante(s) · <span class="sensitive">base ${U.eur(base.unitHT, 3)}/${base.unit === 'kilo' ? 'kg' : 'pc'}</span> <i>(${base.src})</i></span>
        <span class="b2b-disc-badge" onclick="event.preventDefault();event.stopPropagation()">
          <label>Décote</label><input type="number" min="0" max="100" step="1" value="${p.bulkDiscount ?? ''}" placeholder="${S.bulkDiscount}" title="Décote paliers propre à ce produit — vide = suit le réglage global (${S.bulkDiscount}%)" onchange="Catalogue.setCardBulkDiscount('${p.id}',this.value)"><span>%</span>
        </span>
        <span onclick="event.stopPropagation();Catalogue.toggleSel('${p.id}')"><button class="btn btn-sm ${selected?'cat-sel-active':'btn-ghost'}">${selected?'✓ Sélectionné':'Sélectionner'}</button></span>
      </summary>
      <div class="fold-body">
        ${preview ? '<div class="badge warn" style="margin-bottom:8px;">Comparaison avec ' + U.esc(Store.supplierName(preview)) + ' — les prix ci-dessous sont temporaires, cliquer à nouveau pour revenir au principal</div>' : ''}
        <div class="table-wrap"><table>
          <thead><tr><th class="col-name">Variante</th><th class="num">Coût de revient</th><th class="num">Coeff</th><th class="num">Prix HT</th><th class="num">Marge</th><th class="num" style="white-space:normal;line-height:1.2;">Cotisations<br>URSSAF</th><th class="num">TVA ${S.vatActive ? '(reversée)' : '(conservée)'}</th><th class="num" style="cursor:pointer;user-select:none;" title="Maintenir l'appui : voir bénéfice + TVA" onmousedown="Catalogue.peekBenefTVA(true)" onmouseup="Catalogue.peekBenefTVA(false)" onmouseleave="Catalogue.peekBenefTVA(false)" ontouchstart="event.preventDefault();Catalogue.peekBenefTVA(true)" ontouchend="Catalogue.peekBenefTVA(false)" ontouchcancel="Catalogue.peekBenefTVA(false)">Bénéfice</th><th class="num">Prix TTC</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9" class="muted">Aucune variante.</td></tr>'}</tbody></table></div>
        ${inactiveVars.length ? `<button class="btn-ghost btn-sm mt" onclick="Catalogue.toggleInactive('${p.id}')" style="font-size:.78rem;">${showInactive ? 'Masquer' : 'Afficher'} les ${inactiveVars.length} variante${inactiveVars.length > 1 ? 's' : ''} désactivée${inactiveVars.length > 1 ? 's' : ''}</button>` : ''}
        <p class="muted mt">* bénéfice = marge − cotisations URSSAF − TVA (toujours hors TVA, quel que soit ton statut) · maintiens l'appui sur « Bénéfice » pour voir bénéfice + TVA conservée · coût = produit + sachet + étiquette.</p>
        <h3 style="font-size:.85rem;margin:14px 0 6px;">Fournisseurs</h3>
        <div class="table-wrap"><table>
          <thead><tr><th class="col-name">Fournisseur</th><th class="num">Prix d'achat</th><th></th></tr></thead>
          <tbody>${supRows || '<tr><td colspan="3" class="muted">Aucun fournisseur renseigné.</td></tr>'}</tbody></table></div>
        <div class="frow mt">
          <a class="btn btn-ghost" style="text-decoration:none;text-align:center;" href="#/catalogue/edit/${p.id}">Modifier</a>
        </div>
      </div>
    </details>`;
  },

  /* Clic molette (auxclick, bouton du milieu) ou Ctrl/Cmd+clic sur la ligne
     du produit : ouvre sa fiche de modification dans un nouvel onglet, sans
     toucher au clic gauche simple (qui garde le simple pli/dépli natif du
     <details>, pas de rechargement). Pas de <a href> sur toute la ligne
     exprès : ça casserait ce pli/dépli léger existant. */
  summaryNav(e, id) {
    if (e.type === 'auxclick' && e.button !== 1) return;
    if (e.type === 'click' && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    window.open('#/catalogue/edit/' + id, '_blank');
  },

  /* ---------- sélection de produits (fusionner / dupliquer / supprimer en masse) ---------- */
  toggleSel(id) {
    const was = this._sel.has(id);
    if (was) this._sel.delete(id); else this._sel.add(id);
    const det = document.querySelector(`details.cat-fold[data-cid="${id}"]`);
    if (det) {
      det.classList.toggle('cat-selected', !was);
      const btn = det.querySelector('summary > span:last-child > button');
      if (btn) {
        btn.className = 'btn btn-sm ' + (!was ? 'cat-sel-active' : 'btn-ghost');
        btn.textContent = !was ? '✓ Sélectionné' : 'Sélectionner';
      }
    }
    this._renderSelBar();
  },
  _renderSelBar() {
    let bar = document.querySelector('.cat-sel-bar');
    if (!this._sel.size) { if (bar) bar.remove(); return; }
    const html = `<span class="cat-sel-count">${this._sel.size} produit${this._sel.size>1?'s':''} sélectionné${this._sel.size>1?'s':''}</span>
      ${this._sel.size>=2?'<button class="btn btn-cta btn-sm" onclick="Catalogue.mergeSelected()">🔀 Fusionner</button>':''}
      ${this._sel.size===1?'<button class="btn btn-ghost btn-sm" onclick="Catalogue.duplicateSelected()">👥 Dupliquer</button>':''}
      <button class="btn-danger btn-sm" onclick="Catalogue.deleteSelected()">🗑️ Supprimer</button>
      <button class="btn-ghost btn-sm" onclick="Catalogue.clearSel()">Annuler</button>`;
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'cat-sel-bar';
      document.getElementById('main').appendChild(bar);
    }
    bar.innerHTML = html;
  },
  clearSel() {
    this._sel.forEach(id => {
      const det = document.querySelector(`details.cat-fold[data-cid="${id}"]`);
      if (det) {
        det.classList.remove('cat-selected');
        const btn = det.querySelector('summary > span:last-child > button');
        if (btn) { btn.className = 'btn btn-sm btn-ghost'; btn.textContent = 'Sélectionner'; }
      }
    });
    this._sel.clear();
    this._renderSelBar();
  },

  mergeSelected() {
    const sel = [...this._sel];
    if (sel.length < 2) { U.toast('Sélectionne au moins 2 produits à fusionner.', true); return; }
    const products = sel.map(id => Store.state.catalogM.find(p => String(p.id) === String(id))).filter(Boolean);
    if (products.length < 2) { U.toast('Produits introuvables (' + sel.length + ' sélectionnés, ' + products.length + ' trouvés).', true); return; }
    const supMap = new Map();
    products.forEach(p => (p.suppliers || []).forEach(s => { if (!supMap.has(s.supplierId)) supMap.set(s.supplierId, s); }));
    const uniqueSups = [...supMap.values()];
    if (!uniqueSups.length) { U.toast('Aucun fournisseur trouvé sur ces produits.', true); return; }
    const defaultMain = products[0].mainSupplierId || uniqueSups[0].supplierId;
    U.modal({
      title: 'Fusionner ' + products.length + ' produits',
      body: `<p>Les fournisseurs seront regroupés sur un seul produit :</p>
        <ul style="margin:8px 0;">${products.map(p => `<li><b>${U.esc(p.name)}</b> — ${(p.suppliers||[]).map(s => U.esc(Store.supplierName(s.supplierId))).join(', ') || 'sans fournisseur'} <span class="muted">(${(p.variants||[]).filter(v=>v.enabled!==false).length} var.)</span></li>`).join('')}</ul>
        <p class="mt"><b>Quel fournisseur sera le principal ?</b></p>
        ${uniqueSups.map(s => `<label style="display:block;padding:4px 0;cursor:pointer;">
          <input type="radio" name="merge_main" value="${s.supplierId}" ${s.supplierId === defaultMain ? 'checked' : ''}>
          ${U.esc(Store.supplierName(s.supplierId))}
        </label>`).join('')}
        <p class="muted mt" style="font-size:.82rem;">Le produit avec le plus de variantes actives sera conservé. Les fiches stock liées aux autres seront rattachées automatiquement.</p>`,
      okLabel: 'Fusionner',
      onOk: () => {
        const mainSup = document.querySelector('input[name="merge_main"]:checked')?.value;
        if (!mainSup) return false;
        this._doMerge(products, mainSup);
      }
    });
  },

  _doMerge(products, mainSupplierId) {
    const base = products.slice().sort((a, b) =>
      (b.variants||[]).filter(v => v.enabled !== false).length -
      (a.variants||[]).filter(v => v.enabled !== false).length
    )[0];
    const others = products.filter(p => p.id !== base.id);
    const baseBefore = JSON.parse(JSON.stringify(base));
    const removedData = others.map(p => ({
      product: JSON.parse(JSON.stringify(p)),
      stockIds: Store.state.stockM.filter(sp => sp.catalogId === p.id).map(sp => sp.id)
    }));
    const existingIds = new Set((base.suppliers || []).map(s => s.supplierId));
    others.forEach(p => {
      (p.suppliers || []).forEach(s => {
        if (!existingIds.has(s.supplierId)) {
          base.suppliers.push(JSON.parse(JSON.stringify(s)));
          existingIds.add(s.supplierId);
        }
      });
    });
    base.mainSupplierId = mainSupplierId;
    others.forEach(p => {
      Store.state.stockM.forEach(sp => { if (sp.catalogId === p.id) sp.catalogId = base.id; });
    });
    const otherIds = new Set(others.map(p => p.id));
    Store.state.catalogM = Store.state.catalogM.filter(p => !otherIds.has(p.id));
    Stock.syncPricesFromCatalog(base.id);
    const entry = Store.log('catalogue', 'Fusion de ' + products.length + ' produits — ' + base.name, {
      type: 'unmergeProducts',
      data: { baseId: base.id, baseBefore, removed: removedData }
    });
    Store.save('catalogM', 'stockM');
    this._sel.clear();
    U.closeModal();
    U.toast('Produits fusionnés — fournisseur principal : ' + Store.supplierName(mainSupplierId), false, entry.id);
    App.rerender();
  },

  duplicateSelected() {
    if (this._sel.size !== 1) return;
    const srcId = [...this._sel][0];
    const src = Store.state.catalogM.find(p => String(p.id) === String(srcId));
    if (!src) return;
    const dup = JSON.parse(JSON.stringify(src));
    dup.id = U.uid();
    dup.name += ' (copie)';
    (dup.suppliers || []).forEach(s => s.id = U.uid());
    (dup.variants || []).forEach(v => v.id = U.uid());
    Store.state.catalogM.push(dup);
    const entry = Store.log('catalogue', 'Produit dupliqué — ' + dup.name, { type: 'deleteCreated', data: { domain: 'catalogM', id: dup.id } });
    Store.save('catalogM');
    this._sel.clear();
    U.toast('Produit dupliqué : ' + dup.name, false, entry.id);
    App.rerender();
  },

  deleteSelected() {
    const sel = [...this._sel];
    const products = sel.map(id => Store.state.catalogM.find(p => String(p.id) === String(id))).filter(Boolean);
    if (!products.length) return;
    const msg = products.length === 1
      ? 'Supprimer "' + products[0].name + '" du catalogue ?'
      : 'Supprimer ' + products.length + ' produits du catalogue ?\n\n' + products.map(p => '• ' + p.name).join('\n');
    if (!confirm(msg + '\n\nLe stock existant est conservé.')) return;
    const snapshots = products.map(p => JSON.parse(JSON.stringify(p)));
    const selStr = new Set(sel.map(String));
    Store.state.catalogM = Store.state.catalogM.filter(p => !selStr.has(String(p.id)));
    const entry = Store.log('catalogue', snapshots.length + ' produit(s) supprimé(s)', {
      type: 'bulkDeleteCatalog', data: { products: snapshots }
    });
    Store.save('catalogM');
    this._sel.clear();
    U.toast(snapshots.length + ' produit(s) supprimé(s).', false, entry.id);
    App.rerender();
  },

  /* ---------- édition (page pleine largeur, pas une modale) ---------- */
  edit(id) {
    location.hash = id ? '/catalogue/edit/' + id : '/catalogue/new';
  },
  cancelEdit() {
    location.hash = '/catalogue';
  },
  loadDraft() {
    const S = Store.state.settings;
    this._d = null;
    if (this.editId) {
      const found = Store.state.catalogM.find(x => String(x.id) === String(this.editId));
      if (!found) {
        U.toast('Produit introuvable — retour à la liste.', true);
        this.mode = 'list'; this.editId = null; this._loadedKey = null;
        return;
      }
      this._d = JSON.parse(JSON.stringify(found));
      return;
    }
    this._d = { id: U.uid(), name: '', meatType: S.meatTypes[0], mainSupplierId: '', coefficient: 2.1, labelCost: S.labelCost, vatRate: '', bulkDiscount: '', suppliers: [], variants: [] };
    // Pré-remplissage optionnel (ex: depuis Stock.createCatalogFromStock, "📋 Créer la fiche
    // de calcul de prix" sur un produit stock non relié) — reprend nom/viande/conditionnement
    // existants, à Antho de compléter fournisseur + prix. Jamais l'inverse (le stock ne doit
    // jamais être créé depuis le catalogue automatiquement, voir la règle plus haut).
    if (this._prefill) { Object.assign(this._d, this._prefill); this._prefill = null; }
  },

  renderEditor() {
    const S = Store.state.settings, p = this._d;
    const vp = S.variantPresets || { gram: [], piece: [], size: [] };
    const isNew = this.mode === 'new';
    App.mount(`
      <div class="view-title">
        <h1>${isNew ? 'Nouveau produit mastication' : 'Modifier — ' + U.esc(p.name || '')}</h1>
        <span class="spacer"></span>
        <button class="btn-ghost" onclick="Catalogue.cancelEdit()">← Retour à la liste</button>
      </div>

      <div class="card" style="border-left:4px solid var(--caramel);">
        <h2>🏷️ 1. Informations produit</h2>
        <div class="frow">
          <div class="fg" style="flex:2;"><label>Nom du produit</label><input id="cp_name" value="${U.esc(p.name)}"></div>
          <div class="fg"><label>Viande</label><select id="cp_meat">${S.meatTypes.slice().sort(U.sortFr).map(m => `<option ${((p.meatType || '').toLowerCase() === m.toLowerCase()) ? 'selected' : ''}>${U.esc(m)}</option>`).join('')}</select></div>
        </div>
      </div>

      <div class="card" style="border-left:4px solid #4a7c59;">
        <h2>🏬 2. Fournisseurs & prix d'achat</h2>
        <p class="muted mb0">Coche le fournisseur <b>principal</b> : c'est son prix qui sert de base à tous les calculs (coût de revient, marges, revente pro). Renseigne les autres pour comparer, et bascule quand tu veux.</p>
        <div id="cp_sups" class="mt"></div>
        <button class="btn-ghost btn-sm" onclick="Catalogue.addSupplier()">＋ Ajouter un fournisseur</button>
      </div>

      <div class="card" style="border-left:4px solid var(--warn);">
        <h2>📦 3. Conditionnement (sachets & blisters)</h2>
        <details>
          <summary style="cursor:pointer;font-weight:600;color:var(--caramel);padding:6px 0;">${S.sachets.length} emballage(s) disponible(s) — cliquer pour voir la liste</summary>
          ${Params._sachetGroupHTML(S.sachets, 'blister', 'Blisters', 'pour pièces & tailles')}
          ${Params._sachetGroupHTML(S.sachets, 'sachet', 'Sachets', 'pour poids (grammes)')}
          <button class="btn-ghost btn-sm mt" onclick="Params.addSachet()">＋ Ajouter un sachet / blister</button>
        </details>
        <hr class="sep">
        <div class="fg" style="max-width:220px;"><label>Coût de l'étiquette (€)</label><input id="cp_label" type="number" step="0.01" value="${p.labelCost ?? S.labelCost}" oninput="Catalogue._d.labelCost=this.value;Catalogue.drawVars()"></div>
      </div>

      <div class="card" style="border-left:4px solid #c0564a;">
        <h2>💰 4. Rentabilité & taxes</h2>
        <div class="frow">
          <div class="fg"><label>Coefficient par défaut</label><input id="cp_coeff" type="number" step="0.001" value="${p.coefficient}" oninput="Catalogue.syncMargin('coeff')"></div>
          <div class="fg"><label>Marge commerciale (%)</label><input id="cp_marge" type="number" step="0.1" value="${U.num(p.coefficient) > 0 ? ((1 - 1 / U.num(p.coefficient)) * 100).toFixed(1) : ''}" oninput="Catalogue.syncMargin('marge')"></div>
        </div>
        <p class="muted mb0">Modifier l'un met à jour l'autre automatiquement — coefficient par défaut, utilisé si une variante n'a ni prix fixe ni coefficient propre.</p>
        <div class="frow mt">
          <div class="fg"><label>Taux de TVA (%)</label><input id="cp_vat" type="number" step="0.1" value="${p.vatRate ?? ''}" placeholder="${S.vatRate} (global)" oninput="Catalogue.syncTaxFields()"></div>
          <div class="fg"><label>Décote paliers (%)</label><input id="cp_bulk" type="number" step="1" value="${p.bulkDiscount ?? ''}" placeholder="${S.bulkDiscount || 0} (global)" title="Réduction automatiquement appliquée dès la 2e variante active vendue (plus le grammage/lot est élevé, plus la décote compte) — laisse vide pour utiliser le réglage global." oninput="Catalogue.syncTaxFields()"></div>
        </div>
        <p class="muted mb0">Laisse vide pour utiliser les réglages globaux (Paramètres). Renseigne uniquement si ce produit a un taux ou une décote spécifique.</p>
      </div>

      <div class="card" style="border-left:4px solid var(--caramel);">
        <h2>🏪 5. Variantes de vente</h2>
        <p class="muted mb0">Les boutons ci-dessous génèrent d'un coup les paliers standards : décoche ceux que tu ne vends pas. Prix vente HT/TTC sont éditables directement — les modifier fixe ce prix (il ne bougera plus si tu changes de fournisseur principal) ; ↺ pour revenir au calcul automatique (coût × coefficient).</p>
        <div id="cp_vars" class="mt"></div>
        <div class="frow" style="gap:10px;">
          <button class="btn-ghost" onclick="Catalogue.addVar('gram')">＋ Poids</button>
          <button class="btn-ghost" onclick="Catalogue.addVar('piece')">＋ Pièces</button>
          <button class="btn-ghost" onclick="Catalogue.addVar('size')">＋ Taille</button>
        </div>
      </div>

      <div class="frow">
        <button class="btn-cta" style="flex:2;" onclick="Catalogue.save()">💾 ${isNew ? 'Créer le produit' : 'Enregistrer les modifications'}</button>
        <button class="btn-ghost" onclick="Catalogue.cancelEdit()">Annuler</button>
        ${!isNew ? `<button class="btn-danger" onclick="Catalogue.remove('${p.id}')">Supprimer</button>` : ''}
      </div>
    `);
    if (isNew && !(p.suppliers || []).length) this.addSupplier(); else this.drawSuppliers();
    this.drawVars();
  },

  /* Coefficient ⟷ marge commerciale (%) : les deux champs représentent
     la même valeur, éditer l'un met juste à jour l'affichage de l'autre. */
  syncMargin(from) {
    const coeffEl = document.getElementById('cp_coeff'), margeEl = document.getElementById('cp_marge');
    if (from === 'coeff') {
      const c = U.numVal('cp_coeff');
      margeEl.value = c > 0 ? ((1 - 1 / c) * 100).toFixed(1) : '';
    } else {
      const m = U.numVal('cp_marge');
      coeffEl.value = (m < 100 && m > -1000) ? (1 / (1 - m / 100)).toFixed(3) : '';
    }
    this._d.coefficient = U.numVal('cp_coeff');
    this.drawVars();
  },

  syncTaxFields() {
    this._d.vatRate = U.val('cp_vat');
    this._d.bulkDiscount = U.val('cp_bulk');
    this.drawVars();
  },

  /* ---------- fournisseurs (fiche prix) ---------- */
  drawSuppliers() {
    const box = document.getElementById('cp_sups');
    const list = this._d.suppliers || [];
    box.innerHTML = list.map((s, i) => `
      <div class="sup-block">
      <div class="sup-grid">
        <div class="fg"><label>Principal</label><div class="sup-cell">
          <input type="radio" name="cp_main" ${this._d.mainSupplierId === s.supplierId ? 'checked' : ''} onchange="Catalogue._d.mainSupplierId='${s.supplierId}'" style="width:20px;height:20px;"></div></div>
        <div class="fg"><label>Fournisseur</label>
          <select onchange="Catalogue._d.suppliers[${i}].supplierId=this.value">${App.supplierOptions(s.supplierId)}</select></div>
        <div class="fg"><label>Prix d'achat</label><input type="number" step="0.01" value="${s.price ?? ''}" onchange="Catalogue._d.suppliers[${i}].price=this.value;Catalogue.drawSuppliers()">
          <span class="muted" style="font-size:.78rem;">→ ${U.eur(this.supUnitHT(s), 3)}/${s.unit === 'kilo' ? 'kg' : 'pc'} HT</span></div>
        <div class="fg"><label>HT / TTC</label><select onchange="Catalogue._d.suppliers[${i}].taxType=this.value;Catalogue.drawSuppliers()">
          <option ${(s.taxType || 'HT') === 'HT' ? 'selected' : ''}>HT</option><option ${s.taxType === 'TTC' ? 'selected' : ''}>TTC</option></select></div>
        <div class="fg"><label title="TVA d'achat (%)">TVA achat (%)</label><input type="number" step="0.1" value="${s.vatRate ?? ''}" placeholder="${Store.state.settings.vatRate}" onchange="Catalogue._d.suppliers[${i}].vatRate=this.value;Catalogue.drawSuppliers()"></div>
        <div class="fg"><label>Acheté</label><select onchange="Catalogue._d.suppliers[${i}].unit=this.value;Catalogue.drawSuppliers()">
          <option value="kilo" ${(s.unit || 'kilo') === 'kilo' ? 'selected' : ''}>au kilo</option>
          <option value="piece" ${s.unit === 'piece' ? 'selected' : ''}>à la pièce</option></select></div>
        <div class="fg"><label>Poids (kg) / Qté</label><input type="number" step="0.001" value="${s.unit === 'piece' ? (s.quantity ?? 1) : (s.weight ?? 1)}" onchange="Catalogue.setSupDiv(${i},this.value)"></div>
        <div class="fg"><label>Pièces / kilo</label><input type="number" step="0.1" value="${s.piecesPerKilo ?? ''}" placeholder="si revente pièce" onchange="Catalogue._d.suppliers[${i}].piecesPerKilo=this.value"></div>
        <div class="fg"><label>&nbsp;</label><div class="sup-cell"><button class="btn-icon" title="Retirer ce fournisseur" onclick="Catalogue.delSupplier(${i})">🗑️</button></div></div>
      </div>
      <div class="sup-grid2" style="${Store.hideSupplierInfo() ? 'display:none;' : ''}">
        <div class="fg"><label>Réf. fournisseur</label><input value="${U.esc(s.ref || '')}" placeholder="ex : C-23012" onchange="Catalogue._d.suppliers[${i}].ref=this.value.trim()"></div>
        <div class="fg"><label>Lien page fournisseur (URL)</label>
          <div style="display:flex;gap:6px;">
            <input type="url" id="sup_url_${i}" value="${U.esc(s.url || '')}" placeholder="https://…" style="flex:1;min-width:0;" onchange="Catalogue._d.suppliers[${i}].url=this.value;Catalogue.drawSuppliers()">
            <button type="button" class="btn btn-sm" style="white-space:nowrap;" title="Ouvrir dans le navigateur" onclick="var u=document.getElementById('sup_url_${i}').value.trim();if(u)window.open(u,'_blank','noopener');else U.toast('Aucun lien renseigné.',true);">🔗 Ouvrir</button>
          </div></div>
      </div>
      <div style="margin:-4px 0 8px;padding:0 4px;${Store.hideSupplierInfo() ? 'display:none;' : ''}">
        <div class="fg mb0" style="flex:1;"><label>📝 Notes fournisseur <span class="muted" style="font-weight:400;">(visible dans la liste de commande)</span></label>
          <textarea rows="2" placeholder="Ex: acheter au minimum 5 kg sinon aller chez Cernunos…" style="width:100%;resize:vertical;font-size:.85rem;" onchange="Catalogue._d.suppliers[${i}].notes=this.value">${U.esc(s.notes || '')}</textarea></div>
      </div></div>`).join('') || '<p class="muted">Aucun fournisseur — ajoute au moins un fournisseur avec son prix d\'achat.</p>';
    this.drawVars();
  },
  addSupplier() {
    this._d.suppliers = this._d.suppliers || [];
    const used = this._d.suppliers.map(s => s.supplierId);
    const S = Store.state.settings;
    const free = S.suppliers.find(x => !used.includes(x.id));
    const supplierId = free ? free.id : (S.suppliers[0]?.id || '');
    this._d.suppliers.push({ id: U.uid(), supplierId, price: '', taxType: 'HT', vatRate: '', unit: 'kilo', weight: 1, quantity: 1, piecesPerKilo: '', url: '', notes: '' });
    if (!this._d.mainSupplierId) this._d.mainSupplierId = supplierId;
    this.drawSuppliers();
  },
  setSupDiv(i, val) {
    const s = this._d.suppliers[i];
    if (s.unit === 'piece') s.quantity = val; else s.weight = val;
    this.drawSuppliers();
  },
  delSupplier(i) {
    const removed = this._d.suppliers[i];
    this._d.suppliers.splice(i, 1);
    if (this._d.mainSupplierId === removed.supplierId) this._d.mainSupplierId = this._d.suppliers[0]?.supplierId || '';
    this.drawSuppliers();
  },

  /* Bascule rapide du fournisseur principal, directement depuis la carte */
  setMain(prodId, supplierId) {
    const p = Store.state.catalogM.find(x => x.id === prodId);
    if (!p) return;
    const snap = Store.snapshot('catalogM', p);
    p.mainSupplierId = supplierId;
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Fournisseur principal changé — ' + p.name + ' → ' + Store.supplierName(supplierId));
    Store.save('catalogM', 'stockM');
    U.toast('Fournisseur principal : ' + Store.supplierName(supplierId), false, entry.id);
    App.rerender();
  },

  setCardBulkDiscount(prodId, val) {
    const p = Store.state.catalogM.find(x => x.id === prodId);
    if (!p) return;
    const snap = Store.snapshot('catalogM', p);
    p.bulkDiscount = val === '' ? undefined : U.num(val);
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Décote paliers modifiée — ' + p.name);
    Store.save('catalogM', 'stockM');
    U.toast('Décote paliers mise à jour.', false, entry.id);
    App.rerender();
  },

  setCardPriceTTC(prodId, varId, val, idxActive) {
    const p = Store.state.catalogM.find(x => x.id === prodId);
    if (!p) return;
    const v = (p.variants || []).find(x => x.id === varId);
    if (!v) return;
    const snap = Store.snapshot('catalogM', p);
    const ttc = U.num(val);
    if (ttc <= 0) {
      delete v.priceTTCManual;
    } else {
      v.priceTTCManual = ttc;
      const actives = (p.variants || []).filter(x => x.enabled !== false);
      const lastActive = actives[actives.length - 1];
      if (lastActive && lastActive.id === varId && actives.length > 1) {
        const S = Store.state.settings;
        const vat = U.num(p.vatRate !== undefined && p.vatRate !== '' ? p.vatRate : S.vatRate) / 100;
        const base = Pricing.baseUnitCost(p);
        const baseCoeff = U.num(v.coeff) > 0 ? U.num(v.coeff) : (U.num(p.coefficient) || 2);
        const cost = Pricing.variantProdCost(p, v, base) + (Store.sachet(v.sachetId) ? U.num(Store.sachet(v.sachetId).cost) : 0) + U.num(p.labelCost ?? S.labelCost);
        if (cost > 0 && baseCoeff > 0) {
          const priceHT = ttc / (1 + vat);
          const newBulk = (1 - priceHT / (cost * baseCoeff)) * 100;
          if (newBulk >= 0 && newBulk <= 100) p.bulkDiscount = Math.round(newBulk * 10) / 10;
        }
      }
    }
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Prix TTC modifié — ' + p.name + ' ' + Pricing.labelVariant(v));
    Store.save('catalogM', 'stockM');
    U.toast('Prix TTC mis à jour.', false, entry.id);
    App.rerender();
  },

  resetCardPrice(prodId, varId) {
    const p = Store.state.catalogM.find(x => x.id === prodId);
    if (!p) return;
    const v = (p.variants || []).find(x => x.id === varId);
    if (!v || !v.priceTTCManual) return;
    const snap = Store.snapshot('catalogM', p);
    delete v.priceTTCManual;
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Prix TTC réinitialisé — ' + p.name + ' ' + Pricing.labelVariant(v));
    Store.save('catalogM', 'stockM');
    U.toast('Prix revenu au calcul automatique.', false, entry.id);
    App.rerender();
  },

  sachetOpts(sel, mode) {
    Params._renameSachets();
    const preferred = mode === 'gram' ? 'sachet' : 'blister';
    const sachets = Store.state.settings.sachets.filter(s => (s.type || 'sachet') === 'sachet').sort(Params._dimSort('sachet'));
    const blisters = Store.state.settings.sachets.filter(s => (s.type || 'sachet') === 'blister').sort(Params._dimSort('blister'));
    let html = '<option value="0">Aucun</option>';
    const renderSachets = (list) => {
      list.forEach(s => {
        const label = `${s.name}${s.dims ? ' — ' + s.dims : ''} (${U.eur(s.cost, 3)})`;
        html += `<option value="${s.id}" ${String(s.id) === String(sel) ? 'selected' : ''}>${U.esc(label)}</option>`;
      });
    };
    const renderBlisters = (list) => {
      const groups = {};
      list.forEach(s => {
        const d = Params._blisterDims(s);
        const key = d ? d.widthStr : '?';
        if (!groups[key]) groups[key] = [];
        groups[key].push({ s, d });
      });
      Object.entries(groups).forEach(([wStr, items]) => {
        html += `<optgroup label="Blister ${U.esc(wStr)}">`;
        items.forEach(({ s, d }) => {
          const label = d ? `${d.lengthStr} (${U.eur(s.cost, 3)})` : `${s.dims || '?'} (${U.eur(s.cost, 3)})`;
          html += `<option value="${s.id}" ${String(s.id) === String(sel) ? 'selected' : ''}>${U.esc(label)}</option>`;
        });
        html += '</optgroup>';
      });
    };
    if (preferred === 'sachet') {
      renderSachets(sachets);
      if (blisters.length) { html += '<option disabled>──────────</option>'; renderBlisters(blisters); }
    } else {
      renderBlisters(blisters);
      if (sachets.length) { html += '<option disabled>──────────</option>'; renderSachets(sachets); }
    }
    return html;
  },

  /* ---------- variantes de vente : 3 tableaux (poids / lots / tailles),
     colorés comme l'ancien calculateur (marge verte, cotisations rouges,
     bénéfice bleu), avec prix HT/TTC éditables en direct. ---------- */
  varGroups: [
    { mode: 'gram', title: 'Prix de vente par poids', col: 'Poids' },
    { mode: 'piece', title: 'Prix de vente par lot (pièces)', col: 'Lot' },
    { mode: 'size', title: 'Prix de vente par taille', col: 'Taille' }
  ],

  drawVars() {
    const box = document.getElementById('cp_vars');
    if (!box) return;
    const base = Pricing.baseUnitCost(this._d);
    const variants = this._d.variants || [];
    const na = variants.filter(v => v.enabled !== false).length;
    let idx = 0;
    const rows = variants.map((v, i) => {
      const on = v.enabled !== false;
      const c = Pricing.variantCalc(this._d, v, on ? idx : 0, base, na);
      if (on) idx++;
      return { v, i, c, on };
    });
    box.innerHTML = this.varGroups.map(g => {
      const groupRows = rows.filter(r => r.v.mode === g.mode);
      if (!groupRows.length) return '';
      return `<h3 class="cp-var-title">${g.title}
          <button class="btn-icon" title="Supprimer tout ce groupe (${groupRows.length} ligne${groupRows.length > 1 ? 's' : ''})" onclick="Catalogue.removeVarGroup('${g.mode}')">🗑️</button></h3>
        <div class="table-wrap"><table class="cp-var-table">
          <thead><tr><th></th><th>${g.col}</th><th>Sachet / Blister</th><th class="num">Coût revient</th><th class="num">Prix vente HT</th><th class="num">Marge</th><th class="num" style="white-space:normal;line-height:1.2;">Cotisations<br>URSSAF</th><th class="num">TVA ${Store.state.settings.vatActive ? '(reversée)' : '(conservée)'}</th><th class="num">Bénéfice</th><th class="num">Prix vente TTC</th><th></th></tr></thead>
          <tbody>${groupRows.map((r, j) => this.variantRow(r, base, j, groupRows.length)).join('')}</tbody>
        </table></div>`;
    }).join('') || '<p class="muted">Aucune variante — ajoute au moins un conditionnement de vente.</p>';
  },

  variantRow({ v, i, c, on }, base, j, groupLen) {
    let firstCell;
    if (v.mode === 'gram') {
      firstCell = `<input type="number" step="1" value="${v.value}" class="v-num" onchange="Catalogue._d.variants[${i}].value=this.value;Catalogue.drawVars()"> g`;
    } else if (v.mode === 'piece') {
      firstCell = `Lot de <input type="number" step="1" value="${v.value}" class="v-num" onchange="Catalogue._d.variants[${i}].value=this.value;Catalogue.drawVars()"> pc`;
    } else {
      const weightField = base.unit === 'kilo'
        ? `<input type="number" step="1" value="${v.weight || ''}" class="v-num" placeholder="poids (g)" title="Poids de cette taille en grammes — utilisé pour calculer le coût à partir du prix au kilo (laisse vide si tu préfères saisir un prix d'achat direct)" onchange="Catalogue._d.variants[${i}].weight=this.value;Catalogue.drawVars()">`
        : '';
      firstCell = `<input value="${U.esc(v.label || '')}" class="v-num" placeholder="S, M, L…" onchange="Catalogue._d.variants[${i}].label=this.value;Catalogue.drawVars()">
        <input type="number" step="0.01" value="${v.value || ''}" class="v-num" placeholder="prix achat HT/pc" title="Prix d'achat HT pour cette taille (prioritaire sur le poids si renseigné)" onchange="Catalogue._d.variants[${i}].value=this.value;Catalogue.drawVars()">
        ${weightField}`;
    }
    return `<tr class="${on ? '' : 'dim'}">
      <td>
        <input type="checkbox" ${on ? 'checked' : ''} onchange="Catalogue._d.variants[${i}].enabled=this.checked;if(this.checked)Catalogue.autoFillSkus('${v.mode}');Catalogue.drawVars()">
        <div class="mini-reorder">
          <button class="btn-icon" title="Monter" ${j <= 0 ? 'disabled' : ''} onclick="Catalogue.moveVar(${i},-1)">↑</button>
          <button class="btn-icon" title="Descendre" ${j >= groupLen - 1 ? 'disabled' : ''} onclick="Catalogue.moveVar(${i},1)">↓</button>
        </div>
      </td>
      <td>${firstCell}
        <div class="mini-coeff"><label>Coeff${c.critical && on ? ' <span class="badge bad" style="font-size:.6rem;padding:1px 5px;">critique</span>' : ''}</label>
          <input type="number" step="0.001" value="${c.coeff.toFixed(3)}" ${v.priceTTCManual ? 'disabled title="Ignoré tant qu\'un prix de vente fixe est renseigné"' : ''} onchange="Catalogue._d.variants[${i}].coeff=this.value;Catalogue.drawVars()"></div>
      </td>
      <td><select onchange="Catalogue._d.variants[${i}].sachetId=this.value;Catalogue.drawVars()">${this.sachetOpts(v.sachetId, v.mode)}</select>
        <div><input value="${U.esc(v.sku || '')}" placeholder="SKU" title="SKU WooCommerce" onchange="Catalogue._d.variants[${i}].sku=this.value;Catalogue.autoFillSkus('${v.mode}');Catalogue.drawVars()" style="margin-top:4px;width:100%;font-size:.82rem;"></div></td>
      <td class="num sensitive">${U.eur(c.cost, 3)}</td>
      <td class="num sensitive"><input type="number" step="0.10" value="${c.priceHT.toFixed(2)}" class="v-price" onchange="Catalogue.setVariantPrice(${i},'ht',this.value)"></td>
      <td class="num num-marge sensitive">${U.eur(c.margin)}</td>
      <td class="num num-cotis sensitive">${U.eur(c.social)}</td>
      <td class="num sensitive ${Store.state.settings.vatActive ? 'num-cotis' : 'num-marge'}">${Store.state.settings.vatActive ? '− ' : ''}${U.eur(c.priceTTC - c.priceHT)}</td>
      <td class="num num-benef sensitive ${(Store.state.settings.vatActive ? c.profit : c.profit + c.priceTTC - c.priceHT) >= 0 ? 'pos' : 'neg'}"><b>${U.eur(Store.state.settings.vatActive ? c.profit : c.profit + c.priceTTC - c.priceHT)}</b></td>
      <td class="num"><input type="number" step="0.10" value="${c.priceTTC.toFixed(2)}" class="v-price strong" onchange="Catalogue.setVariantPrice(${i},'ttc',this.value)">
        ${c.priceFixed ? `<button class="btn-icon" title="Revenir au calcul automatique" onclick="Catalogue.resetVariantPrice(${i})">↺</button>` : ''}</td>
      <td><button class="btn-icon" onclick="Catalogue._d.variants.splice(${i},1);Catalogue.drawVars()">🗑️</button></td>
    </tr>`;
  },

  /* Réordonne une variante au sein de son groupe (poids/lots/tailles) — ex:
     remonter une taille ajoutée après coup (XS, 1XXL…) au-dessus des tailles
     standards. Le tableau `variants` reste plat (3 modes mélangés) : on
     retrouve les indices du même mode puis on échange à leurs vraies
     positions, sans dépendre de leur contiguïté dans le tableau. */
  moveVar(i, dir) {
    const variants = this._d.variants;
    const mode = variants[i].mode;
    const groupIdx = variants.reduce((acc, v, idx) => { if (v.mode === mode) acc.push(idx); return acc; }, []);
    const pos = groupIdx.indexOf(i);
    const swapPos = pos + dir;
    if (swapPos < 0 || swapPos >= groupIdx.length) return;
    const j = groupIdx[swapPos];
    [variants[i], variants[j]] = [variants[j], variants[i]];
    this.drawVars();
  },

  /* Supprime d'un coup toutes les variantes d'un groupe (poids/lots/tailles),
     pour ne pas avoir à vider une génération de paliers ligne par ligne. */
  removeVarGroup(mode) {
    const label = { gram: 'les poids', piece: 'les lots (pièces)', size: 'les tailles' }[mode] || mode;
    const n = (this._d.variants || []).filter(v => v.mode === mode).length;
    if (!confirm(`Supprimer ${label} (${n} ligne${n > 1 ? 's' : ''}) de ce produit ?`)) return;
    this._d.variants = this._d.variants.filter(v => v.mode !== mode);
    this.drawVars();
  },

  /* Prix vente HT/TTC édité en direct dans le tableau : fixe le prix
     (v.priceTTCManual) — le coefficient affiché devient alors dérivé. */
  setVariantPrice(i, kind, val) {
    const num = U.num(val);
    const v = this._d.variants[i];
    if (num <= 0) { v.priceTTCManual = ''; this.drawVars(); return; }
    if (kind === 'ttc') {
      v.priceTTCManual = num;
    } else {
      const S = Store.state.settings;
      const vat = 1 + U.num(this._d.vatRate !== undefined && this._d.vatRate !== '' ? this._d.vatRate : S.vatRate) / 100;
      v.priceTTCManual = (num * vat).toFixed(2);
    }
    this.drawVars();
  },
  resetVariantPrice(i) {
    this._d.variants[i].priceTTCManual = '';
    this.drawVars();
  },

  /* + Poids / + Pièces / + Taille : génère d'un coup les paliers standards
     (comme l'ancien calculateur), à cocher/décocher plutôt qu'à ajouter
     un par un. Une fois tous présents, un nouveau clic ajoute un palier
     libre (ex: un poids, un lot ou une taille hors standard). */
  addVar(mode) {
    const vp = Store.state.settings.variantPresets || { gram: [50, 100, 250, 500, 1000], piece: [1, 2, 3, 4, 5], size: ['S', 'M', 'L', 'XL'] };
    const isNum = v => typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v !== '');
    if (mode === 'gram') {
      const preset = [...(vp.gram || [])].sort((a, b) => Number(a) - Number(b));
      if (preset.length) {
        const existing = new Set(this._d.variants.filter(v => v.mode === 'gram').map(v => Number(v.value)));
        const missing = preset.filter(val => !existing.has(Number(val)));
        if (missing.length) {
          missing.forEach(val => this._d.variants.push({ id: U.uid(), mode: 'gram', value: Number(val), label: '', sachetId: '0', coeff: '', priceTTCManual: '', sku: '', enabled: true }));
          this.autoFillSkus('gram'); this.drawVars(); return;
        }
      }
    }
    if (mode === 'piece') {
      const all = vp.piece || [];
      const numPreset = all.filter(isNum).sort((a, b) => Number(a) - Number(b));
      const txtPreset = all.filter(v => !isNum(v));
      const existNums = new Set(this._d.variants.filter(v => v.mode === 'piece' && isNum(v.value)).map(v => Number(v.value)));
      const existLabels = new Set(this._d.variants.filter(v => v.mode === 'piece').map(v => (v.label || '').toUpperCase()));
      const missingNums = numPreset.filter(val => !existNums.has(Number(val)));
      const missingTxts = txtPreset.filter(lb => !existLabels.has(String(lb).toUpperCase()));
      if (missingNums.length || missingTxts.length) {
        missingNums.forEach(val => this._d.variants.push({ id: U.uid(), mode: 'piece', value: Number(val), label: '', sachetId: '0', coeff: '', priceTTCManual: '', sku: '', enabled: true }));
        missingTxts.forEach(lb => this._d.variants.push({ id: U.uid(), mode: 'piece', value: '', label: String(lb).toUpperCase(), sachetId: '0', coeff: '', priceTTCManual: '', sku: '', enabled: true }));
        this.autoFillSkus('piece'); this.drawVars(); return;
      }
    }
    if (mode === 'size') {
      const sizePreset = vp.size || ['S', 'M', 'L', 'XL'];
      if (sizePreset.length) {
        const existingLabels = new Set(this._d.variants.filter(v => v.mode === 'size').map(v => (v.label || '').toUpperCase()));
        const missing = sizePreset.filter(lb => !existingLabels.has(String(lb).toUpperCase()));
        if (missing.length) {
          missing.forEach(lb => this._d.variants.push({ id: U.uid(), mode: 'size', value: '', label: String(lb).toUpperCase(), sachetId: '0', coeff: '', priceTTCManual: '', sku: '', enabled: true }));
          this.drawVars(); return;
        }
      }
    }
    this._d.variants.push({ id: U.uid(), mode, value: mode === 'gram' ? 100 : mode === 'piece' ? 1 : '', label: '', sachetId: '0', coeff: '', priceTTCManual: '', sku: '', enabled: true });
    this.autoFillSkus(mode);
    this.drawVars();
  },

  autoFillSkus(mode) {
    const sfx = mode === 'piece' ? 'PC' : mode === 'gram' ? 'G' : null;
    if (!sfx) return;
    const ref = this._d.variants.find(r => r.mode === mode && r.sku);
    if (!ref) return;
    const rv = String(ref.value);
    if (!rv) return;
    const re = new RegExp(rv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + sfx, 'i');
    if (!re.test(ref.sku)) return;
    const dupes = [];
    this._d.variants.forEach(v => {
      if (v.mode !== mode || v.sku || v === ref) return;
      const tv = String(v.value);
      if (!tv) return;
      const generated = ref.sku.replace(re, tv + sfx);
      if (this._skuExists(generated)) dupes.push(generated);
      v.sku = generated;
    });
    if (dupes.length) U.toast(`⚠️ SKU généré déjà utilisé ailleurs : ${dupes.join(', ')} — vérifie/modifie-le.`, true);
  },

  /* Un SKU est-il déjà pris par une AUTRE fiche (Stock, ou une autre fiche Catalogue) ?
     Utilisé pour alerter (pas bloquer) quand autoFillSkus() génère un SKU en doublon. */
  _skuExists(sku) {
    const target = String(sku).trim().toLowerCase();
    if (!target) return false;
    if (Store.state.stockM.some(p => (p.variants || []).some(v => (v.sku || '').trim().toLowerCase() === target))) return true;
    return Store.state.catalogM.some(p => p.id !== this.editId && (p.variants || []).some(v => (v.sku || '').trim().toLowerCase() === target));
  },

  save() {
    const p = this._d;
    p.name = U.val('cp_name').trim();
    if (!p.name) { U.toast('Le nom est obligatoire.', true); return false; }
    if (!(p.suppliers || []).length) { U.toast('Ajoute au moins un fournisseur avec son prix d\'achat.', true); return false; }
    p.meatType = U.val('cp_meat');
    p.coefficient = U.numVal('cp_coeff') || 2;
    p.labelCost = U.numVal('cp_label');
    p.vatRate = U.val('cp_vat');
    p.bulkDiscount = U.val('cp_bulk');
    if (!p.suppliers.some(s => s.supplierId === p.mainSupplierId)) p.mainSupplierId = p.suppliers[0].supplierId;
    // Doublons lien / réf. fournisseur (alerte, jamais blocage) — hors cette même fiche
    const dup = [];
    p.suppliers.forEach(s => Stock.dupWarnings({ url: s.url, ref: s.ref, self: { kind: 'P', id: p.id } }).forEach(m => { if (!dup.includes(m)) dup.push(m); }));
    if (dup.length && !confirm(dup.join('\n\n') + '\n\nEnregistrer quand même ?')) return false;
    const wasNew = this.mode === 'new';
    const idx = Store.state.catalogM.findIndex(x => x.id === p.id);
    // Instantané avant écrasement (Annulation) — ne couvre que la fiche catalogue elle-même,
    // pas les fiches stock resynchronisées en cascade juste après (leur propre bouton 🔄 permet
    // de rattraper ça séparément si besoin).
    const before = idx >= 0 ? JSON.parse(JSON.stringify(Store.state.catalogM[idx])) : null;
    if (idx >= 0) Store.state.catalogM[idx] = p; else Store.state.catalogM.push(p);
    // répercuter les prix TTC sur le stock lié
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.log('catalogue', (wasNew ? 'Produit créé' : 'Produit modifié') + ' — ' + p.name,
      wasNew ? { type: 'deleteCreated', data: { domain: 'catalogM', id: p.id } } : { type: 'restoreItem', data: { domain: 'catalogM', id: p.id, before } });
    Store.save('catalogM', 'stockM');
    U.toast(wasNew ? 'Produit créé.' : 'Produit modifié.', false, entry.id);
    this.cancelEdit();
  },

peekBenefTVA(active) {
    document.querySelectorAll('.num-benef-cell b').forEach(b => {
      const td = b.parentElement;
      b.textContent = active ? td.dataset.peek : td.dataset.normal;
    });
  },

  remove(id) {
    const p = Store.state.catalogM.find(x => x.id === id);
    if (!confirm(`Supprimer "${p.name}" du catalogue ? (le stock existant est conservé)`)) return;
    const snap = Store.snapshot('catalogM', p);
    Store.state.catalogM = Store.state.catalogM.filter(x => x.id !== id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Produit supprimé — ' + p.name);
    Store.save('catalogM');
    U.toast('Produit supprimé.', false, entry.id);
    this.mode = 'list'; this.editId = null; this._loadedKey = null; location.hash = '/catalogue'; App.rerender();
  }
};
