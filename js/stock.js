/* ============================================================
   STOCK — mastication & consommables
   Vue variantes enrichie : seuils min gén/évén, prix achat/vente
   éditables, stock global + dispo, lots dépliables par variante,
   ajout de variante, filtre par variante/type/péremption.
   Onglets dédiés : Péremptions · Faible Stock Total · Faible Stock Événement.
   Modèle stock général/événement : deux pools INDÉPENDANTS
   (général = local/entrepôt, événement = emmené en marché) ;
   le total physique = qtyGeneral + qtyEvent.
   ============================================================ */
const Stock = {
  tab: 'mastication',
  focusId: null,  // id produit à ouvrir/scroller automatiquement (lien profond depuis un autre onglet)
  SIZE_ORDER: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'],

  filters: { q: '', meat: 'all', variants: [], dluo: 'all', variantsOpen: false, sort: 'meat', sortDir: 'asc' },
  _allVariantsCache: [],
  _lotsOpen: {},   // vId -> true/false, remplace le défaut auto (ouvert si alerte DLUO)
  _prodOpen: {},   // pId -> true/false, mémorise les fiches produit dépliées entre deux re-rendus
  _matGroupOpen: {}, // clé produit matière -> true/false, idem pour les groupes de l'onglet Matières

  perem: { q: '', variants: [], variantsOpen: false, view: 'general', horizon: '3', excluded: [], sort: 'days', sortDir: 'asc' },
  _peremVariantsCache: [],

  // Onglet unifié « Faible stock » : view = 'general' | 'event' | 'total' (3 gros boutons).
  faible: { view: 'total', type: 'mastication', variants: [], variantsOpen: false, status: 'low', sel: [], excluded: [], sort: 'gap', sortDir: 'asc' },
  _faibleVariantsCache: [],

  render() {
    // Compat : les anciens onglets « faible-total » / « faible-event » sont fusionnés dans
    // un seul onglet « faible » (3 boutons Général/Événement/Total). On remappe avant tout
    // rendu pour que l'état actif et l'URL soient corrects (anciens liens/KPI/hash).
    if (this.tab === 'faible-total') { this.faible.view = 'total'; this.tab = 'faible'; }
    else if (this.tab === 'faible-event') { this.faible.view = 'event'; this.tab = 'faible'; }
    // Synchronise l'URL avec l'onglet courant (sans empiler d'historique) pour qu'un F5
    // ou un clic sur "Stock" dans le menu revienne sur le bon onglet, pas toujours Mastication.
    // Le 3e segment (focusId) est préservé s'il y en a un : lien profond vers un produit précis.
    const route = 'stock/' + this.tab + (this.focusId ? '/' + this.focusId : '');
    if (location.hash.replace(/^#\/?/, '') !== route) history.replaceState(null, '', '#/' + route);
    App.mount(`
      <div class="view-title"><h1>Stock</h1><span class="sub">général & événement · lots, DLUO, seuils</span></div>
      <div class="tabs">
        ${[
          ['mastication', '🥩', 'Mastication (' + Store.state.stockM.length + ')'],
          ['matieres', '🧵', 'Matières premières (' + Store.state.materials.length + ')'],
          ['conso', '📦', 'Consommables (' + Store.state.consumables.length + ')'],
          ['peremptions', '⏳', 'Péremptions'],
          ['faible', '📉', 'Faible stock']
        ].map(([id, ico, label]) => `<a href="#/stock/${id}" class="tab-btn ${this.tab === id ? 'active' : ''}" onclick="if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.button!==1){event.preventDefault();Stock.tab='${id}';Stock.render();}">${ico} ${label}</a>`).join('')}
      </div>
      <div id="stockBody"></div>`);
    if (this.tab === 'mastication') this.renderM();
    else if (this.tab === 'conso') this.renderConso();
    else if (this.tab === 'matieres') this.renderMatieres();
    else if (this.tab === 'peremptions') this.renderPeremptions();
    else this.renderFaible();
  },

  /* ───── util communs ───── */
  _toggleIn(arr, val) { const i = arr.indexOf(val); if (i >= 0) arr.splice(i, 1); else arr.push(val); },

  _dluoOptions: [
    { value: 'all',      label: 'Tout',                      badge: '' },
    { value: 'expired',  label: 'Lot(s) périmé(s)',          badge: 'bad',  icon: '⚠' },
    { value: 'soon',     label: 'DLUO proche',               badge: 'warn', icon: '⏳' },
    { value: 'low',      label: 'Stock bas (général)',        badge: 'info', icon: '📉' },
    { value: 'multilot', label: 'Plusieurs numéros de lots',  badge: 'info', icon: '🔢' },
    { value: 'nourl',    label: 'Sans lien fournisseur',      badge: 'info', icon: '🔗' },
    { value: 'nocat',    label: 'Sans lien catalogue prix',   badge: 'info', icon: '💰' },
    { value: 'hascat',   label: 'Lié au catalogue prix',      badge: 'ok',   icon: '💰' },
  ],
  dluoFilterHTML(current, setter) {
    const cur = this._dluoOptions.find(o => o.value === current) || this._dluoOptions[0];
    const curLabel = cur.badge ? `<span class="badge ${cur.badge}">${cur.icon} ${cur.label}</span>` : cur.label;
    return `<details class="multiselect dluo-filter" ${this._dluoFilterOpen ? 'open' : ''} ontoggle="Stock._dluoFilterOpen=this.open">
      <summary>${curLabel} ▾</summary>
      <div class="multiselect-panel">
        ${this._dluoOptions.map(o => {
          const lb = o.badge ? `<span class="badge ${o.badge}">${o.icon} ${o.label}</span>` : o.label;
          return `<div class="dluo-opt${o.value===current?' active':''}" onclick="${setter}('${o.value}')">${lb}</div>`;
        }).join('')}
      </div>
    </details>`;
  },
  _dluoFilterOpen: false,
  _meatFilterOpen: false,
  _setMeatFilter(val) { this.filters.meat = val; this._meatFilterOpen = false; this.renderM(); },
  _setPeremView(val) { this.perem.view = val; this.renderPeremptions(); },
  _setPeremHorizon(val) {
    this.perem.horizon = val;
    // Mode « plusieurs lots » : groupe par produit (DLUO la plus courte en tête) par défaut
    if (val === 'multi') { this.perem.sort = 'name'; this.perem.sortDir = 'asc'; }
    this.renderPeremptions();
  },
  _setFaibleView(val) { this.faible.view = val; this.renderFaible(); },
  _setFaibleType(val) { this.faible.type = val; this.renderFaible(); },
  _setFaibleStatus(val) { this.faible.status = val; this.renderFaible(); },
  _setConsoLink(val) { this.consoFilters.link = val; this.renderConso(); },
  _setMatType(val) { this.matFilters.type = val; this.renderMatieres(); },
  _setMatLink(val) { this.matFilters.link = val; this.renderMatieres(); },

  allVariantLabels() {
    return [...new Set(Store.state.stockM.flatMap(p => p.variants.map(v => Pricing.labelVariant(v))).filter(Boolean))].sort(U.sortFr);
  },
  allVariantGroups() {
    const vp = Store.state.settings.variantPresets || {};
    const norm = s => String(s).toUpperCase().trim();
    const presetGram = new Set((vp.gram || []).map(v => norm(Pricing.labelVariant({ mode: 'gram', value: v }))));
    const presetPiece = new Set((vp.piece || []).map(v => norm(typeof v === 'number' || !isNaN(Number(v)) ? Pricing.labelVariant({ mode: 'piece', value: v }) : v)));
    const presetSize = new Set((vp.size || []).map(v => norm(v)));
    const groups = { gram: new Set(), piece: new Set(), size: new Set(), other: new Set() };
    Store.state.stockM.forEach(p => p.variants.forEach(v => {
      const lb = Pricing.labelVariant(v);
      if (!lb) return;
      const n = norm(lb);
      if (presetGram.has(n)) groups.gram.add(lb);
      else if (presetPiece.has(n)) groups.piece.add(lb);
      else if (presetSize.has(n)) groups.size.add(lb);
      else groups.other.add(lb);
    }));
    const sizeSort = (a, b) => {
      const ia = this.SIZE_ORDER.indexOf(a.toUpperCase().trim());
      const ib = this.SIZE_ORDER.indexOf(b.toUpperCase().trim());
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return U.sortFr(a, b);
    };
    const out = [];
    if (groups.gram.size) out.push({ label: 'Poids', items: [...groups.gram].sort(U.sortFr) });
    if (groups.piece.size) out.push({ label: 'Pièces / lots', items: [...groups.piece].sort(U.sortFr) });
    if (groups.size.size) out.push({ label: 'Tailles', items: [...groups.size].sort(sizeSort) });
    if (groups.other.size) out.push({ label: 'Autres', items: [...groups.other].sort(U.sortFr) });
    return out;
  },

  /* ───── MASTICATION ───── */
  renderM() {
    const S = Store.state.settings, f = this.filters;
    // Lien profond (#/stock/mastication/<id>) : ouvre la fiche et la fait défiler à l'écran,
    // une seule fois — consommé ici pour ne pas re-scroller à chaque re-rendu suivant (filtre, etc.).
    const focusId = this.focusId; this.focusId = null;
    if (focusId) {
      this._prodOpen[focusId] = true;
      f.q = ''; f.meat = 'all'; f.variants = []; f.dluo = 'all';
    }
    U.syncFilters('stock_mastication', f);
    const varGroups = this.allVariantGroups();
    const allVariants = varGroups.flatMap(g => g.items);
    this._allVariantsCache = allVariants;
    f.variants = f.variants.filter(v => allVariants.includes(v));

    const list = Store.state.stockM.filter(p => {
      if (f.q && !p.name.toLowerCase().includes(f.q.toLowerCase())) return false;
      if (f.meat !== 'all' && (p.meatType || '').toLowerCase() !== f.meat.toLowerCase()) return false;
      if (f.variants.length && !p.variants.some(v => f.variants.includes(Pricing.labelVariant(v)))) return false;
      if (f.dluo === 'expired') return p.variants.some(v => v.lots.some(l => { const d = U.daysTo(l.dluo); return d !== null && d < 0 && (U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0; }));
      if (f.dluo === 'soon') return p.variants.some(v => v.lots.some(l => { const d = U.daysTo(l.dluo); return d !== null && d >= 0 && d <= U.num(S.dluoAlertDays) && (U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0; }));
      if (f.dluo === 'low') return p.variants.some(v => { const qg = v.lots.reduce((a,l)=>a+U.num(l.qtyGeneral),0); return U.num(v.low)>0 && qg<=U.num(v.low); });
      if (f.dluo === 'multilot') return p.variants.some(v => new Set(v.lots.filter(l => (U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0).map(l => (l.lotNumber||'').trim()).filter(Boolean)).size >= 2);
      if (f.dluo === 'nourl') return !p.url;
      if (f.dluo === 'nocat') return !p.catalogId || !Store.state.catalogM.some(c => c.id === p.catalogId);
      if (f.dluo === 'hascat') return p.catalogId && Store.state.catalogM.some(c => c.id === p.catalogId);
      return true;
    }).sort((a, b) => {
      const dir = f.sortDir === 'desc' ? -1 : 1;
      if (f.sort === 'name') return dir * U.sortFr(a.name, b.name);
      return dir * U.sortFr((a.meatType || '') + a.name, (b.meatType || '') + b.name);
    });

    const sortHead = (key, label) => `<span class="sortable ${f.sort===key?'active':''}" onclick="Stock.setSort('${key}')">${label} ${f.sort===key?(f.sortDir==='asc'?'▲':'▼'):'⇕'}</span>`;

    document.getElementById('stockBody').innerHTML = `
      <div class="card" style="padding:12px 16px;">
        <div class="grid c4">
          <div class="fg mb0"><label>Recherche</label><input id="stock_q_mast" value="${U.esc(f.q)}" placeholder="nom du produit…" oninput="Stock.filters.q=this.value;Stock.renderM();U.refocus('stock_q_mast')"></div>
          <div class="fg mb0"><label>Type de viande</label>${U.meatFilter({ current: f.meat, meats: S.meatTypes, count: Store.state.stockM.length, setter: 'Stock._setMeatFilter', openState: this._meatFilterOpen, openSetter: 'Stock._meatFilterOpen' })}</div>
          <div class="fg mb0"><label>Variantes</label>${U.multiSelect({ groups: varGroups, selected: f.variants, toggle: 'Stock.toggleVariantFilter', setAll: 'Stock.setAllVariantFilter', open: f.variantsOpen, onOpen: 'Stock.setVariantFilterOpen' })}</div>
          <div class="fg mb0"><label>Filtre DLUO / seuil</label>${this.dluoFilterHTML(f.dluo, 'Stock.setDluoFilter')}</div>
        </div>
        <div class="frow mt" style="gap:6px;align-items:center;">
          <button class="btn-cta btn-sm" onclick="Stock.editProduct()">＋ Nouveau produit</button>
          <button class="btn-ghost btn-sm" onclick="Stock.foldAll(false)">▼ Tout déplier</button>
          <button class="btn-ghost btn-sm" onclick="Stock.foldAll(true)">▲ Tout réduire</button>
          <span class="muted" style="margin-left:auto;">${list.length} produit(s) · ${list.reduce((a,p)=>a+p.variants.reduce((b,v)=>b+v.lots.reduce((c,l)=>c+U.num(l.qtyGeneral)+U.num(l.qtyEvent),0),0),0).toFixed(0)} unités en stock</span>
        </div>
      </div>
      <div class="prod-list-header">
        <span>${sortHead('name', 'Nom du produit')}</span>
        <span>Alertes</span>
        <span>${sortHead('meat', 'Catégorie')}</span>
        <span class="meta">Stock</span>
        <span class="prod-actions">Actions</span>
      </div>
      ${list.map(p => this.productCard(p)).join('') || '<div class="card empty"><span class="big">📦</span>Aucun résultat. Importe ton inventaire depuis Paramètres ou ajuste tes filtres.</div>'}`;
    if (focusId) {
      setTimeout(() => {
        const el = document.getElementById('prod-' + focusId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    }
  },

  setSort(key) {
    if (this.filters.sort === key) this.filters.sortDir = this.filters.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.filters.sort = key; this.filters.sortDir = 'asc'; }
    this.renderM();
  },

  toggleVariantFilter(name) { this._toggleIn(this.filters.variants, name); this.renderM(); },
  setAllVariantFilter(all) { this.filters.variants = all ? [...this._allVariantsCache] : []; this.renderM(); },
  setVariantFilterOpen(open) { this.filters.variantsOpen = open; },
  setDluoFilter(val) { this.filters.dluo = val; this._dluoFilterOpen = false; this.renderM(); },

  productCard(p) {
    const prodOpen = this._prodOpen[p.id] || false;
    const cat = Store.state.catalogM.find(c => c.id === p.catalogId);
    const hasAnyCatLink = !!cat || p.variants.some(v => v.catalogId && Store.state.catalogM.some(c => c.id === v.catalogId));
    const totalG = p.variants.reduce((a,v)=>a+v.lots.reduce((b,l)=>b+U.num(l.qtyGeneral),0),0);
    const totalE = p.variants.reduce((a,v)=>a+v.lots.reduce((b,l)=>b+U.num(l.qtyEvent),0),0);
    const hasAlert = p.variants.some(v => v.lots.some(l => { const d=U.daysTo(l.dluo); return d!==null&&d<0&&(U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0; }));
    const hasSoon = !hasAlert && p.variants.some(v => v.lots.some(l => { const d=U.daysTo(l.dluo); const S=Store.state.settings; return d!==null&&d>=0&&d<=U.num(S.dluoAlertDays)&&(U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0; }));

    // filtre variantes selon le filtre actif (multi-sélection)
    const f = this.filters;
    const vars = f.variants.length ? p.variants.filter(v => f.variants.includes(Pricing.labelVariant(v))) : p.variants;
    const varRows = vars.map(v => this.variantRow(p, v)).join('');
    const nv = p.variants.filter(v => v.mode !== 'vrac').length;

    return `<details class="fold prod-fold" id="prod-${p.id}" ${prodOpen ? 'open' : ''} ontoggle="Stock.setProdOpen('${p.id}',this.open)">
      <summary onclick="Stock.summaryNav(event,'${p.id}')" onauxclick="Stock.summaryNav(event,'${p.id}')" title="Clic molette / Ctrl+clic : ouvrir la fiche dans un nouvel onglet">
        <b>${U.esc(p.name)}</b>
        <span>
          ${hasAlert ? '<span class="badge bad">⚠ Lot(s) périmé(s)</span>' : hasSoon ? '<span class="badge warn">⏳ DLUO proche</span>' : ''}
          ${hasAnyCatLink ? '<span class="badge ok" title="Lié au catalogue prix">💰</span>' : ''}
        </span>
        <span class="type-col">
          <span class="badge info">${U.esc(p.meatType||'—')}</span>
        </span>
        <span class="meta"><b>${totalG+totalE}</b> unités · gén <b>${totalG}</b> · évén <b>${totalE}</b> · <span class="muted">${nv} variante(s)</span></span>
        <span class="prod-actions" style="white-space:nowrap;">
          ${Store.hideSupplierInfo() ? '' : `<button class="btn-icon" title="${p.url ? 'Ouvrir la page fournisseur' : 'Ajouter un lien fournisseur'}" onclick="event.preventDefault();event.stopPropagation();Stock.openProductLink('${p.id}')">${p.url ? '🔗' : '🔗＋'}</button>`}
          ${cat ? `<button class="btn-icon" title="Resynchroniser prix/variantes depuis le catalogue (ex: une taille ajoutée côté calcul de prix après coup)" onclick="event.preventDefault();event.stopPropagation();Stock.resyncFromCatalog('${p.id}')">🔄</button>` : `<button class="btn-icon" title="Créer la fiche de calcul de prix à partir de ce produit (reprend nom, viande et conditionnement — tu complètes fournisseur et prix)" onclick="event.preventDefault();event.stopPropagation();Stock.createCatalogFromStock('${p.id}')">📋</button>`}
          <button class="btn-icon" title="Ajouter une variante" onclick="event.preventDefault();event.stopPropagation();Stock.addVariant('${p.id}')">➕</button>
          <button class="btn-icon" title="Modifier le produit" onclick="event.preventDefault();event.stopPropagation();Stock.editProduct('${p.id}')">✏️</button>
          <button class="btn-icon" title="Supprimer le produit" onclick="event.preventDefault();event.stopPropagation();Stock.delProduct('${p.id}')">🗑️</button>
        </span>
      </summary>
      <div class="fold-body">
        <div class="table-wrap"><table>
          <thead><tr>
            <th class="col-name">Variante</th><th>SKU</th>
            <th class="num">Min gén.</th><th class="num">Min évén.</th>
            <th class="num">Stock gén.</th><th class="num">Stock évén.</th><th class="num">Total</th>
            <th class="num">Prix achat</th><th class="num">Prix vente</th>
            <th class="num">Nb lots</th>
            <th></th>
          </tr></thead>
          <tbody>${varRows || '<tr><td colspan="11" class="muted">Aucune variante.</td></tr>'}</tbody>
        </table></div>
      </div></details>`;
  },

  variantRow(p, v) {
    const lots = [...v.lots].sort((a,b)=>(a.dluo||'9999').localeCompare(b.dluo||'9999'));
    const qg = lots.reduce((a,l)=>a+U.num(l.qtyGeneral),0);
    const qe = lots.reduce((a,l)=>a+U.num(l.qtyEvent),0);
    const isVrac = v.mode === 'vrac';
    const low = U.num(v.low); const lowE = U.num(v.lowEvent);
    const lowCls = low>0&&qg<=low?'warn-txt':'';
    const label = Pricing.labelVariant(v);
    const vi = p.variants.findIndex(x=>x.id===v.id);
    const alertDays = U.num(Store.state.settings.dluoAlertDays);
    const vExpired = lots.some(l => { const d=U.daysTo(l.dluo); return d!==null&&d<0&&(U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0; });
    const vSoon = !vExpired && lots.some(l => { const d=U.daysTo(l.dluo); return d!==null&&d>=0&&d<=alertDays&&(U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0; });
    const vDluoBadge = vExpired ? ' <span class="badge bad" style="font-size:.65rem;">⚠ périmé</span>' : vSoon ? ' <span class="badge warn" style="font-size:.65rem;">⏳ DLUO proche</span>' : '';

    // lots dépliables : repliés par défaut, l'utilisateur peut déplier via le chevron (mémorisé par variante).
    const open = this._lotsOpen[v.id] !== undefined ? this._lotsOpen[v.id] : false;

    const lotsBox = !open ? '' : `<tr class="lots-row"><td colspan="11" style="padding:0;">
      <div class="lots-box">
        <div class="lots-box-title">Lots pour ${U.esc(label)} — <span class="muted">total ${U.qty(qg+qe)}</span></div>
        <div class="table-wrap"><table class="lots-table">
          <thead><tr>
            <th class="col-name">N° lot</th><th>Péremption</th>
            <th class="num">Stock général</th><th></th><th class="num">Stock événement</th>
            <th class="num">Total</th>
            <th></th>
          </tr></thead>
          <tbody>${lots.length ? lots.map(l => {
            const tot = U.num(l.qtyGeneral)+U.num(l.qtyEvent);
            return `<tr class="${tot<=0?'dim':''}">
              <td class="col-name"><span class="tag">${U.esc(l.lotNumber||'sans n°')}</span></td>
              <td>${l.dluo?U.dluoTag(l.dluo):'<span class="muted">—</span>'}</td>
              <td class="num"><input type="number" step="0.001" value="${l.qtyGeneral}" style="width:80px;" onchange="Stock.setLotQty('${p.id}','${v.id}','${l.id}','qtyGeneral',this.value)"></td>
              <td class="right" style="white-space:nowrap;">
                <button class="btn-transfer" style="background:var(--ok);" title="Transférer vers Événement" onclick="Stock.transferLot('${p.id}','${v.id}','${l.id}','ge')">→</button>
                <button class="btn-transfer" style="background:#3b6fa0;" title="Retour vers Stock Général" onclick="Stock.transferLot('${p.id}','${v.id}','${l.id}','eg')">←</button>
              </td>
              <td class="num"><input type="number" step="0.001" value="${l.qtyEvent}" style="width:80px;" onchange="Stock.setLotQty('${p.id}','${v.id}','${l.id}','qtyEvent',this.value)"></td>
              <td class="num muted">${U.qty(tot)}</td>
              <td class="right" style="white-space:nowrap;">
                ${isVrac?`<button class="btn-ghost btn-sm" onclick="Stock.conditionner('${p.id}','${v.id}','${l.id}')">🎁 Conditionner</button>`:''}
                <button class="btn-icon" title="Modifier le lot" onclick="Stock.editLot('${p.id}','${v.id}','${l.id}')">✏️</button>
                <button class="btn-icon" title="Supprimer le lot" onclick="Stock.delLot('${p.id}','${v.id}','${l.id}')">🗑️</button>
              </td></tr>`;
          }).join('') : '<tr><td colspan="7" class="muted">Aucun lot pour le moment.</td></tr>'}</tbody>
        </table></div>
        <button class="btn-cta btn-sm mt" onclick="Stock.addLot('${p.id}','${v.id}')">＋ Ajouter un lot</button>
      </div>
    </td></tr>`;

    return `<tr>
      <td class="col-name"><button class="btn-icon" title="${open?'Replier':'Déplier'} les lots" onclick="Stock.toggleLotsOpen('${v.id}',${open})" style="margin-right:4px;">${open?'▾':'▸'}</button><b>${U.esc(label)}</b>${isVrac?` <span class="badge info">vrac</span>`:''}${vDluoBadge}${v.catalogId ? (() => { const lc = Store.state.catalogM.find(c=>c.id===v.catalogId); return lc ? ` <span class="badge" title="Lié à : ${U.esc(lc.name)}" style="font-size:.65rem;background:var(--caramel);color:#fff;cursor:help;">💰</span>` : ''; })() : ''}</td>
      <td><input value="${U.esc(v.sku||'')}" placeholder="SKU" title="${U.esc(v.sku||'SKU — lien WooCommerce ↔ calcul de prix')}" class="sku-input" onchange="Stock.setVarSku('${p.id}','${v.id}',this.value)"></td>
      <td class="num"><input type="number" step="1" value="${low}" style="width:60px;" title="Stock min général" onchange="Stock.setVarMin('${p.id}','${v.id}','low',this.value)"></td>
      <td class="num"><input type="number" step="1" value="${lowE}" style="width:60px;" title="Stock min événement" onchange="Stock.setVarMin('${p.id}','${v.id}','lowEvent',this.value)"></td>
      <td class="num ${lowCls}"><b>${U.qty(qg)}</b></td>
      <td class="num">${U.qty(qe)}${lowE>0&&qe<=lowE?` <span class="warn-txt" style="font-size:.75rem;">(min ${lowE})</span>`:''}</td>
      <td class="num muted" title="Stock gén. + Stock évén. — tout ce que tu possèdes physiquement pour cette variante"><b>${U.qty(qg+qe)}</b></td>
      <td class="num sensitive"><input type="number" step="0.001" value="${U.num(v.costUnit).toFixed(3)}" style="width:78px;" title="Prix d'achat / coût unitaire de référence" onchange="Stock.setVarCost('${p.id}','${v.id}',this.value)"></td>
      <td class="num"><input type="number" step="0.01" value="${U.num(v.priceTTC).toFixed(2)}" style="width:72px;" title="Prix de vente TTC" onchange="Stock.setVarPrice('${p.id}','${v.id}',this.value)"></td>
      <td class="num muted">${lots.length}</td>
      <td class="right" style="white-space:nowrap;">
        <button class="btn-icon" title="Monter" ${vi<=0?'disabled':''} onclick="Stock.moveVariant('${p.id}','${v.id}',-1)">↑</button>
        <button class="btn-icon" title="Descendre" ${vi>=p.variants.length-1?'disabled':''} onclick="Stock.moveVariant('${p.id}','${v.id}',1)">↓</button>
        <button class="btn-icon" title="Modifier la variante" onclick="Stock.editVariant('${p.id}','${v.id}')">✏️</button>
        <button class="btn-icon" title="Supprimer la variante" onclick="Stock.delVariant('${p.id}','${v.id}')">🗑️</button>
      </td>
    </tr>${lotsBox}`;
  },

  toggleLotsOpen(vId, currentlyOpen) {
    this._lotsOpen[vId] = !currentlyOpen;
    this.renderM();
  },

  // Ne redessine rien : juste mémoriser l'état pour le prochain re-rendu (voir productCard).
  setProdOpen(pId, open) { this._prodOpen[pId] = open; },

  foldAll(collapse) {
    Store.state.stockM.forEach(p => { this._prodOpen[p.id] = !collapse; });
    this.renderM();
  },

  foldAllMat(collapse) {
    Store.state.materials.forEach(m => { this._matGroupOpen[m.product || m.name] = !collapse; });
    this.renderMatieres();
  },

  /* Clic molette (auxclick) ou Ctrl/Cmd+clic sur la ligne du produit :
     ouvre sa fiche dans un nouvel onglet (lien profond #/stock/mastication/id),
     sans toucher au clic gauche simple qui garde le pli/dépli natif du <details>. */
  summaryNav(e, id) {
    if (e.type === 'auxclick' && e.button !== 1) return;
    if (e.type === 'click' && !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    window.open('#/stock/mastication/' + id, '_blank');
  },
  setMatGroupOpen(key, open) { this._matGroupOpen[key] = open; },

  setVarMin(pId, vId, field, val) {
    const p=Store.state.stockM.find(x=>x.id===pId); const v=p?.variants.find(x=>x.id===vId); if(!v) return;
    const snap=Store.snapshot('stockM',p);
    v[field]=U.num(val);
    const entry=Store.commitSnapshot(snap,'stock',`Seuil modifié — ${p.name} (${Pricing.labelVariant(v)})`);
    U.toast('Seuil mis à jour.', false, entry.id);
    Store.save('stockM');
  },
  setVarPrice(pId, vId, val) {
    const p=Store.state.stockM.find(x=>x.id===pId); const v=p?.variants.find(x=>x.id===vId); if(!v) return;
    const snap=Store.snapshot('stockM',p);
    v.priceTTC=U.num(val);
    const entry=Store.commitSnapshot(snap,'stock',`Prix de vente modifié — ${p.name} (${Pricing.labelVariant(v)})`);
    U.toast('Prix de vente mis à jour.', false, entry.id);
    Store.save('stockM');
  },
  setVarCost(pId, vId, val) {
    const p=Store.state.stockM.find(x=>x.id===pId); const v=p?.variants.find(x=>x.id===vId); if(!v) return;
    const snap=Store.snapshot('stockM',p);
    v.costUnit=U.num(val);
    const entry=Store.commitSnapshot(snap,'stock',`Prix d'achat modifié — ${p.name} (${Pricing.labelVariant(v)})`);
    U.toast('Prix d\'achat mis à jour.', false, entry.id);
    Store.save('stockM');
  },
  setVarSku(pId, vId, val) {
    const p=Store.state.stockM.find(x=>x.id===pId); const v=p?.variants.find(x=>x.id===vId); if(!v) return;
    const snap=Store.snapshot('stockM',p);
    v.sku=val;
    // Le Stock est prioritaire sur le SKU : répercute immédiatement vers la fiche
    // Catalogue liée (même règle que le lien initial / Params > SKU).
    const cId = v.catalogId || p.catalogId;
    let catChanged = false;
    if (cId && v.catalogVariantId) {
      const cp = Store.state.catalogM.find(x => x.id === cId);
      const cv = cp?.variants?.find(x => x.id === v.catalogVariantId);
      if (cv && cv.sku !== v.sku) { cv.sku = v.sku; catChanged = true; }
    }
    const entry=Store.commitSnapshot(snap,'stock',`SKU modifié — ${p.name} (${Pricing.labelVariant(v)})`);
    U.toast('SKU mis à jour.', false, entry.id);
    Store.save('stockM'); if (catChanged) Store.save('catalogM');
  },

  moveVariant(pId, vId, dir) {
    const p=Store.state.stockM.find(x=>x.id===pId); if(!p) return;
    const i=p.variants.findIndex(x=>x.id===vId); if(i<0) return;
    const j=i+dir; if(j<0||j>=p.variants.length) return;
    const snap=Store.snapshot('stockM',p);
    [p.variants[i],p.variants[j]]=[p.variants[j],p.variants[i]];
    const entry=Store.commitSnapshot(snap,'stock',`Variantes réordonnées — ${p.name}`);
    U.toast('Ordre mis à jour.', false, entry.id);
    Store.save('stockM'); App.rerender();
  },

  editVariant(pId, vId) {
    const p=Store.state.stockM.find(x=>x.id===pId); const v=p?.variants.find(x=>x.id===vId); if(!v) return;
    const linkedCatId = v.catalogId || p.catalogId || '';
    const linkedCat = linkedCatId ? Store.state.catalogM.find(c=>c.id===linkedCatId) : null;
    this._evCatPickId = linkedCatId;
    const pt = p.tags || {};
    const _rLb = {'faible':'Faible','moyenne':'Moyenne','forte':'Forte','tres-forte':'Très Forte'}[pt.resistance] || '';
    const _tLb = Store.productTypeLabel(pt.type);
    const _oLb = {'faible':'Faible','moyenne':'Moyenne','forte':'Forte'}[pt.odeur] || '';
    const _grLb = {'non':'Non gras','peu':'Peu gras','moyen':'Moyennement gras','gras':'Gras'}[pt.gras] || '';
    const _aLb = (pt.age||[]).map(a => a==='11+'?'11 mois +':a==='senior'?'Sénior':a+' mois').join(', ');
    const _gLb = (pt.gabarit||[]).map(g => g==='petit'?'Petit':g==='moyen'?'Moyen':'Grand').join(', ');
    U.modal({
      title:'✏️ Modifier variante — '+U.esc(p.name), okLabel:'Enregistrer',
      body:`<div class="frow">
        <div class="fg"><label>SKU WooCommerce</label><input id="ev_sku" value="${U.esc(v.sku||'')}"></div>
        <div class="fg"${Store.hideSupplierInfo() ? ' style="display:none;"' : ''}><label>Réf. fournisseur (optionnel)</label><input id="ev_ref" value="${U.esc(v.ref||'')}"></div>
      </div>
      <hr class="sep">
      <div class="fg" data-onclose="Stock.closeEvCatPick">
        <label>Fiche calcul de prix</label>
        <input id="ev_cat_q" value="${U.esc(linkedCat ? linkedCat.name : '')}" placeholder="Rechercher une fiche catalogue…" autocomplete="off"
          onfocus="Stock.filterEvCatPick(this.value)" oninput="Stock.filterEvCatPick(this.value)">
        <div id="ev_cat_pick_list" class="ac-list" style="position:static;max-height:180px;overflow-y:auto;margin-top:4px;display:none;"></div>
        <p class="muted" style="font-size:.78rem;margin-top:4px;">Associe cette variante à sa propre fiche du calcul de prix — chaque variante peut pointer vers une fiche différente.</p>
      </div>
      ${v.mode === 'size' ? `<hr class="sep">
      <p class="muted" style="font-size:.78rem;margin-bottom:8px;">Tags de cette variante — vide = hérite du produit</p>
      <div class="frow" style="gap:12px;">
        <div class="fg"><label>Résistance</label><select id="ev_resistance">
          <option value="" ${!(v.tags||{}).resistance?'selected':''}>— hériter du produit${_rLb?' ('+_rLb+')':' (non défini)'} —</option>
          <option value="faible" ${(v.tags||{}).resistance==='faible'?'selected':''}>Faible</option>
          <option value="moyenne" ${(v.tags||{}).resistance==='moyenne'?'selected':''}>Moyenne</option>
          <option value="forte" ${(v.tags||{}).resistance==='forte'?'selected':''}>Forte</option>
          <option value="tres-forte" ${(v.tags||{}).resistance==='tres-forte'?'selected':''}>Très Forte</option>
        </select></div>
        <div class="fg"><label>Type</label><select id="ev_type">
          <option value="" ${!(v.tags||{}).type?'selected':''}>— hériter du produit${_tLb?' ('+_tLb+')':' (non défini)'} —</option>
          ${Store.productTypes().map(t => `<option value="${U.esc(t.value)}" ${(v.tags||{}).type===t.value?'selected':''}>${U.esc(t.label)}</option>`).join('')}
        </select></div>
      </div>
      <div class="frow" style="gap:12px;">
        <div class="fg"><label>Odeur</label><select id="ev_odeur">
          <option value="" ${!(v.tags||{}).odeur?'selected':''}>— hériter du produit${_oLb?' ('+_oLb+')':' (non défini)'} —</option>
          <option value="faible" ${(v.tags||{}).odeur==='faible'?'selected':''}>Faible</option>
          <option value="moyenne" ${(v.tags||{}).odeur==='moyenne'?'selected':''}>Moyenne</option>
          <option value="forte" ${(v.tags||{}).odeur==='forte'?'selected':''}>Forte</option>
        </select></div>
        <div class="fg"><label>Gras</label><select id="ev_gras">
          <option value="" ${!(v.tags||{}).gras?'selected':''}>— hériter du produit${_grLb?' ('+_grLb+')':' (non défini)'} —</option>
          <option value="non" ${(v.tags||{}).gras==='non'?'selected':''}>Non gras</option>
          <option value="peu" ${(v.tags||{}).gras==='peu'?'selected':''}>Peu gras</option>
          <option value="moyen" ${(v.tags||{}).gras==='moyen'?'selected':''}>Moyennement gras</option>
          <option value="gras" ${(v.tags||{}).gras==='gras'?'selected':''}>Gras</option>
        </select></div>
      </div>
      <div class="frow" style="gap:12px;">
        <div class="fg"><label>Âge</label>
          <div id="ev_age" style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:4px;justify-content:center;">
          ${['0-3','3-5','6-10','11+','senior'].map(a => {
            const chk = ((v.tags||{}).age||[]).includes(a) ? 'checked' : '';
            const lb = a==='11+'?'11 mois +':a==='senior'?'Sénior':a+' mois';
            return '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:.88rem;"><input type="checkbox" value="'+a+'" '+chk+'> '+lb+'</label>';
          }).join('')}
          </div>
          <p class="muted" style="font-size:.72rem;margin-top:2px;">Vide = hérite du produit${_aLb?' ('+_aLb+')':''}</p>
        </div>
        <div class="fg"><label>Gabarit</label>
          <div id="ev_gabarit" style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:4px;justify-content:center;">
          ${['petit','moyen','grand'].map(g => {
            const chk = ((v.tags||{}).gabarit||[]).includes(g) ? 'checked' : '';
            const lb = g==='petit'?'Petit':g==='moyen'?'Moyen':'Grand';
            return '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:.88rem;"><input type="checkbox" value="'+g+'" '+chk+'> '+lb+'</label>';
          }).join('')}
          </div>
          <p class="muted" style="font-size:.72rem;margin-top:2px;">Vide = hérite du produit${_gLb?' ('+_gLb+')':''}</p>
        </div>
      </div>` : ''}`,
      onOk:()=>{
        const snap=Store.snapshot('stockM',p);
        v.sku=U.val('ev_sku'); v.ref=U.val('ev_ref');
        const pickedCatId = Stock._evCatPickId || '';
        const typed = U.val('ev_cat_q').trim();
        let finalCatId = pickedCatId;
        if (typed === '') {
          finalCatId = '';
        } else if (pickedCatId) {
          const cur = Store.state.catalogM.find(c=>c.id===pickedCatId);
          if (!cur || cur.name !== typed) {
            const exact = Store.state.catalogM.filter(c => c.name.toLowerCase() === typed.toLowerCase());
            if (exact.length === 1) finalCatId = exact[0].id;
            else if (exact.length > 1) { U.toast('Plusieurs fiches portent ce nom — clique une ligne dans la liste.', true); return false; }
            else { U.toast('Choisis une fiche dans la liste déroulante (ou vide le champ).', true); return false; }
          }
        } else {
          const exact = Store.state.catalogM.filter(c => c.name.toLowerCase() === typed.toLowerCase());
          if (exact.length === 1) finalCatId = exact[0].id;
          else if (exact.length > 1) { U.toast('Plusieurs fiches portent ce nom — clique une ligne dans la liste.', true); return false; }
          else { U.toast('Choisis une fiche dans la liste déroulante (ou vide le champ).', true); return false; }
        }
        v.catalogId = finalCatId;
        let catSkuChanged = false;
        if (finalCatId) {
          const cat = Store.state.catalogM.find(c=>c.id===finalCatId);
          if (cat) {
            const stockLabel = Pricing.labelVariant(v).toLowerCase();
            const match = (cat.variants||[]).find(cv => Pricing.labelVariant(cv).toLowerCase() === stockLabel);
            const catVarId = match ? match.id : (v.catalogVariantId || '');
            v.catalogVariantId = catVarId;
            if (catVarId) catSkuChanged = Stock.applyCatalogVariantPrice(p, v, cat, catVarId);
          }
        } else {
          v.catalogVariantId = '';
        }
        if (v.mode === 'size') {
          const evResistance = U.val('ev_resistance');
          const evType = U.val('ev_type');
          const evOdeur = U.val('ev_odeur');
          const evGras = U.val('ev_gras');
          const evAgeEl = document.getElementById('ev_age');
          const evAge = evAgeEl ? [...evAgeEl.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value) : [];
          const evGabaritEl = document.getElementById('ev_gabarit');
          const evGabarit = evGabaritEl ? [...evGabaritEl.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value) : [];
          v.tags = { resistance: evResistance, type: evType, odeur: evOdeur, gras: evGras, age: evAge, gabarit: evGabarit };
        } else {
          delete v.tags;
        }
        const entry=Store.commitSnapshot(snap,'stock','Variante modifiée — '+p.name+' ('+Pricing.labelVariant(v)+')');
        Store.save('stockM'); if (catSkuChanged) Store.save('catalogM');
        U.closeModal(); App.rerender();
        U.toast('Variante modifiée.', false, entry.id);
      }
    });
  },

  /* Reprend le prix/coût d'une ligne précise du calcul de prix sur UNE variante
     de stock. `cat` = la fiche catalogue (peut venir de v.catalogId OU de
     p.catalogId). Ne touche ni aux autres variantes ni au nom du produit.
     SKU : le Stock est prioritaire — s'il a déjà un SKU, il écrase celui du
     Catalogue (même si ce dernier en avait déjà un différent) ; seulement si
     le Stock est vide, on reprend celui du Catalogue. Retourne true si le
     SKU du Catalogue a été modifié (pour que l'appelant sauvegarde 'catalogM'). */
  applyCatalogVariantPrice(p, v, cat, catVarId) {
    const cv = (cat.variants || []).find(x => x.id === catVarId); if (!cv) return false;
    const base = Pricing.baseUnitCost(cat);
    const enabledVars = (cat.variants || []).filter(x => x.enabled !== false);
    const idx = enabledVars.findIndex(x => x.id === cv.id);
    const calc = Pricing.variantCalc(cat, cv, idx < 0 ? 0 : idx, base, enabledVars.length);
    v.priceTTC = calc.priceTTC;
    v.costUnit = calc.cost;
    let catChanged = false;
    if (v.sku) { if (cv.sku !== v.sku) { cv.sku = v.sku; catChanged = true; } }
    else if (cv.sku) v.sku = cv.sku;
    return catChanged;
  },

  delVariant(pId, vId) {
    const p=Store.state.stockM.find(x=>x.id===pId); const v=p?.variants.find(x=>x.id===vId); if(!v) return;
    if(!confirm(`Supprimer la variante "${Pricing.labelVariant(v)}" et tous ses lots ?`)) return;
    const snap=Store.snapshot('stockM',p);
    p.variants=p.variants.filter(x=>x.id!==vId);
    const entry=Store.commitSnapshot(snap,'stock','Variante supprimée — '+p.name+' ('+Pricing.labelVariant(v)+')');
    Store.save('stockM'); App.rerender();
    U.toast('Variante supprimée.', false, entry.id);
  },

  setLotQty(pId, vId, lId, field, val) {
    const f = this.findLot(pId, vId, lId); if (!f) return;
    const before = U.num(f.lot[field]);
    f.lot[field] = U.num(val);
    const entry = Store.log('ajustement', `${f.p.name} / ${Pricing.labelVariant(f.v)} lot ${f.lot.lotNumber||'—'} : ${field==='qtyEvent'?'évén.':'gén.'} ${U.qty(before)} → ${U.qty(val)}`,
      { type:'setQty', data:{pId,vId,lId,field,before} });
    U.toast('Quantité mise à jour.', false, entry.id);
    Store.save('stockM');
    // Le "Total" (gén.+évén.) est affiché à 3 endroits dérivés de cette valeur (ligne variante,
    // titre de l'encadré des lots, colonne Total par lot) : sans re-rendu ils restaient figés
    // à l'ancienne valeur tant qu'aucune autre action ne déclenchait un rafraîchissement.
    this.render();
  },
  findLot(pId, vId, lId) {
    const p=Store.state.stockM.find(x=>x.id===pId);
    const v=p?.variants.find(x=>x.id===vId);
    const lot=v?.lots.find(x=>x.id===lId);
    return lot?{p,v,lot}:null;
  },

  /* ─── Ajouter une variante à un produit existant ─── */
  addVariant(pId) {
    const p = Store.state.stockM.find(x=>x.id===pId); if(!p) return;
    U.modal({
      title:'＋ Variante — '+U.esc(p.name), okLabel:'Ajouter',
      body:`<div class="frow">
        <div class="fg"><label>Mode</label><select id="av_mode">
          <option value="gram">Poids (g)</option><option value="piece">Pièce / lot</option>
          <option value="size">Taille (S/M/L…)</option><option value="vrac">Vrac (kg ou pc)</option></select></div>
        <div class="fg"><label>Valeur / étiquette</label><input id="av_val" placeholder="ex: 100, S, 1…"></div>
      </div>
      <div class="frow">
        <div class="fg"${Store.hideSupplierInfo() ? ' style="display:none;"' : ''}><label>Réf. fournisseur</label><input id="av_ref" placeholder="optionnel"></div>
        <div class="fg"><label>SKU WooCommerce</label><input id="av_sku" placeholder="optionnel"></div>
      </div>
      <div class="frow">
        <div class="fg"><label>Prix TTC (€)</label><input id="av_price" type="number" step="0.01" value="0"></div>
        <div class="fg"><label>Min stock gén.</label><input id="av_low" type="number" step="1" value="0"></div>
        <div class="fg"><label>Min stock évén.</label><input id="av_lowe" type="number" step="1" value="0"></div>
      </div>`,
      onOk:()=>{
        const snap=Store.snapshot('stockM',p);
        const mode=U.val('av_mode'), raw=U.val('av_val').trim();
        const value=mode==='gram'||mode==='piece'?U.num(raw)||0:raw;
        p.variants.push({id:U.uid(),catalogVariantId:'',mode,value,label:mode==='size'?raw:'',ref:U.val('av_ref'),sku:U.val('av_sku'),priceTTC:U.numVal('av_price'),costUnit:0,low:U.numVal('av_low'),lowEvent:U.numVal('av_lowe'),lots:[]});
        const entry=Store.commitSnapshot(snap,'stock','Variante ajoutée — '+p.name+' ('+raw+')');
        Store.save('stockM'); U.closeModal(); App.rerender();
        U.toast('Variante ajoutée.', false, entry.id);
      }
    });
  },

  editProduct(id) {
    const S = Store.state.settings;
    const p = id ? Store.state.stockM.find(x=>x.id===id)
      : {id:U.uid(),catalogId:'',name:'',meatType:S.meatTypes[0],variants:[]};
    const curCat = Store.state.catalogM.find(c => c.id === p.catalogId);
    this._catPickId = p.catalogId || '';
    U.modal({
      title:id?'Modifier le produit':'Nouveau produit en stock', okLabel:'Enregistrer',
      body:`<div class="fg"><label>Lier au catalogue prix (recommandé)</label>
        <div class="autocomplete" data-onclose="Stock.closeCatPick">
          <input id="sp_cat_q" type="text" autocomplete="off" placeholder="Tape pour chercher un produit du catalogue…" value="${U.esc(curCat ? curCat.name : '')}" oninput="Stock.filterCatPick(this.value)" onfocus="Stock.filterCatPick(this.value)">
          <div id="cat_pick_list" class="ac-list" style="position:static;max-height:220px;overflow:auto;margin-top:4px;display:none;"></div>
        </div>
      </div>
      <div class="frow">
        <div class="fg" style="flex:2;"><label>Nom</label><input id="sp_name" value="${U.esc(p.name)}"></div>
        <div class="fg"><label>Viande</label><select id="sp_meat">${(p.meatType && !S.meatTypes.some(m=>m.toLowerCase()===p.meatType.toLowerCase()) ? `<option value="${U.esc(p.meatType)}" selected>${U.esc(p.meatType)} (hors liste)</option>` : '')}${S.meatTypes.slice().sort(U.sortFr).map(m=>`<option ${(p.meatType||'').toLowerCase()===m.toLowerCase()?'selected':''}>${U.esc(m)}</option>`).join('')}</select></div>
      </div>
      <div class="fg"${Store.hideSupplierInfo() ? ' style="display:none;"' : ''}><label>Lien fournisseur (page produit, optionnel)</label><div style="display:flex;gap:6px;align-items:center;"><input id="sp_url" value="${U.esc(p.url||'')}" placeholder="https://…" style="flex:1;"><button type="button" class="btn btn-sm" style="white-space:nowrap;" title="Ouvrir dans le navigateur" onclick="var u=document.getElementById('sp_url').value.trim();if(u)window.open(u,'_blank','noopener');else U.toast('Aucun lien renseigné.',true);">🔗 Ouvrir</button></div></div>
      <div class="frow" style="gap:12px;">
        <div class="fg"><label>Poil</label><select id="sp_poil">
          <option value="" ${!(p.tags||{}).poil?'selected':''}>— non renseigné —</option>
          <option value="avec" ${(p.tags||{}).poil==='avec'?'selected':''}>Avec poil</option>
          <option value="sans" ${(p.tags||{}).poil==='sans'?'selected':''}>Sans poil</option>
          <option value="les_deux" ${(p.tags||{}).poil==='les_deux'?'selected':''}>Avec ou sans</option>
        </select></div>
        <div class="fg"><label>Hypoallergénique</label><select id="sp_hypo">
          <option value="" ${!(p.tags||{}).hypo?'selected':''}>— non renseigné —</option>
          <option value="oui" ${(p.tags||{}).hypo==='oui'||(p.tags||{}).hypo===true?'selected':''}>Oui</option>
          <option value="non" ${(p.tags||{}).hypo==='non'?'selected':''}>Non</option>
        </select></div>
      </div>
      <div class="frow" style="gap:12px;">
        <div class="fg"><label>Résistance</label><select id="sp_resistance">
          <option value="" ${!(p.tags||{}).resistance?'selected':''}>— non renseigné —</option>
          <option value="faible" ${(p.tags||{}).resistance==='faible'?'selected':''}>Faible</option>
          <option value="moyenne" ${(p.tags||{}).resistance==='moyenne'?'selected':''}>Moyenne</option>
          <option value="forte" ${(p.tags||{}).resistance==='forte'?'selected':''}>Forte</option>
          <option value="tres-forte" ${(p.tags||{}).resistance==='tres-forte'?'selected':''}>Très Forte</option>
        </select></div>
        <div class="fg"><label>Type</label><select id="sp_type">
          <option value="" ${!(p.tags||{}).type?'selected':''}>— non renseigné —</option>
          ${Store.productTypes().map(t => `<option value="${U.esc(t.value)}" ${(p.tags||{}).type===t.value?'selected':''}>${U.esc(t.label)}</option>`).join('')}
        </select></div>
      </div>
      <div class="frow" style="gap:12px;">
        <div class="fg"><label>Odeur</label><select id="sp_odeur">
          <option value="" ${!(p.tags||{}).odeur?'selected':''}>— non renseigné —</option>
          <option value="faible" ${(p.tags||{}).odeur==='faible'?'selected':''}>Faible</option>
          <option value="moyenne" ${(p.tags||{}).odeur==='moyenne'?'selected':''}>Moyenne</option>
          <option value="forte" ${(p.tags||{}).odeur==='forte'?'selected':''}>Forte</option>
        </select></div>
        <div class="fg"><label>Gras</label><select id="sp_gras">
          <option value="" ${!(p.tags||{}).gras?'selected':''}>— non renseigné —</option>
          <option value="non" ${(p.tags||{}).gras==='non'?'selected':''}>Non gras</option>
          <option value="peu" ${(p.tags||{}).gras==='peu'?'selected':''}>Peu gras</option>
          <option value="moyen" ${(p.tags||{}).gras==='moyen'?'selected':''}>Moyennement gras</option>
          <option value="gras" ${(p.tags||{}).gras==='gras'?'selected':''}>Gras</option>
        </select></div>
      </div>
      <div class="frow" style="gap:12px;">
        <div class="fg"><label>Âge</label>
          <div id="sp_age" style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:4px;justify-content:center;">
          ${['0-3','3-5','6-10','11+','senior'].map(a => {
            const chk = ((p.tags||{}).age||[]).includes(a) ? 'checked' : '';
            const lb = a==='11+'?'11 mois +':a==='senior'?'Sénior':a+' mois';
            return '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:.88rem;"><input type="checkbox" value="'+a+'" '+chk+'> '+lb+'</label>';
          }).join('')}
          </div>
        </div>
        <div class="fg"><label>Gabarit</label>
          <div id="sp_gabarit" style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:4px;justify-content:center;">
          ${['petit','moyen','grand'].map(g => {
            const chk = ((p.tags||{}).gabarit||[]).includes(g) ? 'checked' : '';
            const lb = g==='petit'?'Petit':g==='moyen'?'Moyen':'Grand';
            return '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:.88rem;"><input type="checkbox" value="'+g+'" '+chk+'> '+lb+'</label>';
          }).join('')}
          </div>
        </div>
      </div>`,
      onOk:()=>{
        // ⚠️ Piège corrigé : _catPickId n'est posé QUE par un clic sur une suggestion
        // (pickCatForProduct). Si Antho tape un nom au clavier puis clique directement
        // "Enregistrer" sans cliquer la ligne, _catPickId restait à son ancienne valeur
        // (souvent vide) et le lien ne changeait jamais — silencieusement, sans erreur ni
        // avertissement, donnant l'impression que "ça ne fait rien". Ici on compare le texte
        // tapé au nom de la fiche actuellement sélectionnée : s'ils ne correspondent plus
        // (tapé sans cliquer, ou modifié après un clic), on cherche une correspondance EXACTE
        // par nom ; si aucune ou plusieurs (doublon de nom), on bloque l'enregistrement avec
        // un message clair plutôt que de garder l'ancien lien sans le dire.
        const typed = U.val('sp_cat_q').trim();
        const curPicked = Store.state.catalogM.find(c => c.id === this._catPickId);
        let catId = this._catPickId || '';
        if (typed === '') {
          catId = '';
        } else if (!curPicked || curPicked.name !== typed) {
          const exact = Store.state.catalogM.filter(c => c.name.toLowerCase() === typed.toLowerCase());
          if (exact.length === 1) catId = exact[0].id;
          else if (exact.length > 1) { U.toast('Plusieurs produits catalogue portent ce nom — clique une ligne précise dans la liste (viande/fournisseur affichés) plutôt que taper.', true); return false; }
          else { U.toast('Choisis un produit catalogue dans la liste déroulante (ou vide le champ pour ne pas relier).', true); return false; }
        }
        const oldCatId = p.catalogId || '';
        const before = id ? { name: p.name, meatType: p.meatType, catalogId: p.catalogId, url: p.url, tags: JSON.parse(JSON.stringify(p.tags || {})), variants: JSON.parse(JSON.stringify(p.variants)) } : null;
        p.catalogId=catId;
        const cat=Store.state.catalogM.find(c=>c.id===p.catalogId);
        const stockName = U.val('sp_name').trim();
        let catRenameEntry = null;
        const stockMeat = U.val('sp_meat');
        if (cat && catId && ((stockName && cat.name !== stockName) || (stockMeat && cat.meatType !== stockMeat))) {
          const catSnap = Store.snapshot('catalogM', cat);
          if (stockName) cat.name = stockName;
          if (stockMeat) cat.meatType = stockMeat;
          catRenameEntry = Store.commitSnapshot(catSnap, 'catalogue', 'Fiche prix alignée sur le stock (nom/viande) — ' + (stockName || cat.name));
          Store.save('catalogM');
        }
        p.name=stockName||cat?.name||'Sans nom';
        p.meatType=U.val('sp_meat')||cat?.meatType||'';
        p.url=U.val('sp_url').trim();
        const poilVal = U.val('sp_poil');
        const hypoVal = U.val('sp_hypo');
        const resistanceVal = U.val('sp_resistance');
        const typeVal = U.val('sp_type');
        const odeurVal = U.val('sp_odeur');
        const grasVal = U.val('sp_gras');
        const ageEl = document.getElementById('sp_age');
        const ageVal = ageEl ? [...ageEl.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value) : [];
        const gabaritEl = document.getElementById('sp_gabarit');
        const gabaritVal = gabaritEl ? [...gabaritEl.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value) : [];
        p.tags = { poil: poilVal, hypo: hypoVal, resistance: resistanceVal, type: typeVal, odeur: odeurVal, gras: grasVal, age: ageVal, gabarit: gabaritVal };
        if(!id) Store.state.stockM.push(p);
        if(cat) this.syncPricesFromCatalog(cat.id);
        const entry = Store.log('stock',(id?'Produit modifié':'Produit créé')+' — '+p.name,
          id ? { type:'editStockProduct', data:{ pId:p.id, before } } : { type:'createStockProduct', data:{ pId:p.id } });
        Store.save('stockM'); U.closeModal(); App.rerender();
        if (catRenameEntry) {
          U.toast('Modification enregistrée — fiche prix alignée sur le stock (nom/viande).', false, catRenameEntry.id);
        } else {
          U.toast(id?'Modification enregistrée.':'Produit créé.', false, entry.id);
        }
      }
    });
  },

  /* Liste de suggestions pour "Lier au catalogue prix" — recherche texte plutôt
     qu'un <select> classique (137+ produits, impossible à parcourir/taper dedans).
     Affiche viande + fournisseur pour distinguer les doublons de nom (ex: "Ailes
     de poulet" présent 2 fois côté catalogue chez Antho). */
  catPickOptionsHTML(q) {
    const query = (q || '').trim().toLowerCase();
    const matches = Store.state.catalogM
      .filter(c => !query || c.name.toLowerCase().includes(query))
      .sort((a, b) => U.sortFr(a.name, b.name));
    const noneItem = `<div class="ac-item" onmousedown="event.preventDefault();Stock.pickCatForProduct('','')">— aucun (libre) —</div>`;
    return noneItem + matches.map(c => `<div class="ac-item" onmousedown="event.preventDefault();Stock.pickCatForProduct('${c.id}','${U.esc(c.name).replace(/&#39;/g, "\\'")}')">${U.esc(c.name)} <span class="muted">— ${U.esc(c.meatType || '—')} (${U.esc(Store.supplierName(c.mainSupplierId))})</span></div>`).join('');
  },
  filterCatPick(q) {
    const box = document.getElementById('cat_pick_list');
    if (!box) return;
    box.style.display = 'block';
    box.innerHTML = this.catPickOptionsHTML(q);
  },
  /* Fermeture au clic extérieur (jamais onblur — voir la note "Fermeture des menus
     U.autocomplete" : ici pas de re-rendu global qui détache l'input, mais le même
     data-onclose générique est réutilisé par simplicité/cohérence). */
  closeCatPick() {
    const box = document.getElementById('cat_pick_list');
    if (box) box.style.display = 'none';
  },
  pickCatForProduct(catId, name) {
    this._catPickId = catId;
    const input = document.getElementById('sp_cat_q');
    if (input) input.value = name;
    this.closeCatPick();
  },

  /* --- Recherche de fiche catalogue dans la modale "Modifier variante" ---
     Même patron que catPickOptionsHTML/filterCatPick mais pour le lien
     par VARIANTE (chaque variante stock peut pointer vers une fiche
     catalogue différente, ex: Nerf 12cm → fiche Nerf 12cm chez Kuaurtikel,
     Nerf 30cm → fiche Nerf 30cm chez PSF). */
  filterEvCatPick(q) {
    const box = document.getElementById('ev_cat_pick_list');
    if (!box) return;
    box.style.display = 'block';
    const query = (q || '').trim().toLowerCase();
    const matches = Store.state.catalogM
      .filter(c => !query || c.name.toLowerCase().includes(query))
      .sort((a, b) => U.sortFr(a.name, b.name));
    const noneItem = `<div class="ac-item" onmousedown="event.preventDefault();Stock.pickEvCat('','')">— aucune (libre) —</div>`;
    box.innerHTML = noneItem + matches.map(c => `<div class="ac-item" onmousedown="event.preventDefault();Stock.pickEvCat('${c.id}','${U.esc(c.name).replace(/&#39;/g, "\\'")}')">${U.esc(c.name)} <span class="muted">— ${U.esc(c.meatType || '—')} (${U.esc(Store.supplierName(c.mainSupplierId))})</span></div>`).join('');
  },
  closeEvCatPick() {
    const box = document.getElementById('ev_cat_pick_list');
    if (box) box.style.display = 'none';
  },
  pickEvCat(catId, name) {
    this._evCatPickId = catId;
    const input = document.getElementById('ev_cat_q');
    if (input) input.value = name;
    this.closeEvCatPick();
  },

  delProduct(id) {
    const p=Store.state.stockM.find(x=>x.id===id);
    if(!confirm(`Supprimer "${p.name}" et tous ses lots ?`)) return;
    const snap=Store.snapshot('stockM',p);
    Store.state.stockM=Store.state.stockM.filter(x=>x.id!==id);
    const entry=Store.commitSnapshot(snap,'stock','Produit supprimé — '+p.name);
    Store.save('stockM'); App.rerender();
    U.toast('Produit supprimé.', false, entry.id);
  },

  openProductLink(id) {
    const p=Store.state.stockM.find(x=>x.id===id); if(!p) return;
    if (Store.hideSupplierInfo()) return;
    if (p.url) window.open(p.url, '_blank', 'noopener');
    else this.editProduct(id);
  },

  /* ⚠️ Règle absolue posée par Antho (session du 2026-07-28) après avoir trouvé des
     variantes fantômes (ex: une taille "GIANT" jamais créée par lui, des tailles dupliquées
     à 0 stock) : cette fonction n'a JAMAIS le droit de créer un produit ou une variante côté
     stock. Elle a seulement le droit d'associer un prix/coût à une variante de stock qui
     EXISTE DÉJÀ. Si une variante catalogue n'a aucune variante stock correspondante, on
     l'ignore purement et simplement — pas de création, jamais. Le rattachement variante ↔
     variante catalogue se fait par ordre de préférence : catalogVariantId déjà posé, puis
     SKU identique, puis libellé/valeur identique (même logique que Params.applyLink). */
  syncPricesFromCatalog(catalogId) {
    const cat=Store.state.catalogM.find(c=>c.id===catalogId); if(!cat) return false;
    const norm = s => String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
    const sameVar = (cv, sv) => {
      if ((cv.mode==='gram'||cv.mode==='piece') && sv.mode===cv.mode) return U.num(cv.value)===U.num(sv.value);
      return norm(cv.label||Pricing.labelVariant(cv))===norm(sv.label||Pricing.labelVariant(sv));
    };
    const base=Pricing.baseUnitCost(cat);
    const enabledVars=(cat.variants||[]).filter(x=>x.enabled!==false);
    let catChanged = false;
    // Le STOCK est prioritaire (décision d'Antho, 2026-09-26) : nom et viande de la fiche
    // stock sont recopiés sur la fiche prix liée — jamais l'inverse. Une resynchro corrige
    // donc d'elle-même une viande/un nom divergent côté prix (ex. « Bois Végétal » vs « Bois Naturel »).
    const linked = Store.state.stockM.filter(s=>s.catalogId===catalogId);
    const ref = linked[0];
    if (ref) {
      if (ref.name && cat.name !== ref.name) { cat.name = ref.name; catChanged = true; }
      if (ref.meatType && cat.meatType !== ref.meatType) { cat.meatType = ref.meatType; catChanged = true; }
    }
    linked.forEach(sp=>{
      sp.variants.forEach(sv=>{
        let cv = sv.catalogVariantId ? enabledVars.find(x=>x.id===sv.catalogVariantId) : null;
        if(!cv && sv.sku) cv = enabledVars.find(x=>x.sku && norm(x.sku)===norm(sv.sku));
        if(!cv) cv = enabledVars.find(x=>sameVar(x,sv));
        if(!cv) return; // aucune correspondance existante côté stock : on ne crée rien
        const idx = enabledVars.indexOf(cv);
        const calc = Pricing.variantCalc(cat,cv,idx,base,enabledVars.length);
        sv.catalogVariantId=cv.id; sv.label=Pricing.labelVariant(cv); sv.mode=cv.mode; sv.value=cv.value;
        // SKU : le Stock est prioritaire (écrase celui du Catalogue) ; sinon, si le
        // Stock n'en a pas, on reprend celui du Catalogue comme avant.
        if (sv.sku) { if (cv.sku !== sv.sku) { cv.sku = sv.sku; catChanged = true; } }
        else if (cv.sku) sv.sku = cv.sku;
        sv.priceTTC=calc.priceTTC; sv.costUnit=calc.cost;
      });
    });
    if (catChanged) Store.save('catalogM');
    return catChanged;
  },

  /* Resynchronisation manuelle déclenchée par Antho (bouton 🔄 sur une fiche
     déjà reliée) : la synchro automatique ne se fait qu'au moment où le lien
     est posé, jamais en continu — si une taille/un lot est ajouté côté calcul
     de prix après coup, la fiche stock déjà reliée ne le récupère pas tant
     que ce bouton n'est pas cliqué. Jamais automatique, toujours à la demande. */
  resyncFromCatalog(pId) {
    const p = Store.state.stockM.find(x => x.id === pId); if (!p || !p.catalogId) return;
    const cat = Store.state.catalogM.find(c => c.id === p.catalogId);
    // Garde-fou : si la fiche catalogue liée a été supprimée entretemps (ou le lien
    // corrompu), ne jamais afficher un succès trompeur — dire clairement quoi refaire.
    if (!cat) { U.toast('Le lien catalogue de ce produit ne pointe plus vers une fiche valide — relie-le à nouveau via "✏️ Modifier le produit".', true); return; }
    // Instantané avant resync, pour permettre l'Annulation (bouton dans Paramètres →
    // Journal des mouvements) — demande explicite d'Antho après avoir vu une resync
    // introduire des variantes qu'il ne voulait pas.
    const before = { name: p.name, meatType: p.meatType, variants: JSON.parse(JSON.stringify(p.variants)) };
    this.syncPricesFromCatalog(p.catalogId);
    const entry = Store.log('stock', 'Prix/variantes resynchronisés depuis le catalogue — ' + p.name, { type: 'resyncStock', data: { pId, before } });
    Store.save('stockM');
    U.toast('Prix et variantes resynchronisés depuis le catalogue.', false, entry.id);
    this.render();
  },

  /* "📋 Créer la fiche de calcul de prix" sur un produit stock pas encore relié :
     action EXPLICITE (jamais automatique) qui ouvre l'éditeur Catalogue "Nouveau produit"
     pré-rempli avec nom, viande et conditionnement (variantes) déjà existants côté stock —
     Antho n'a plus qu'à ajouter le fournisseur et les prix. Sens inverse de la règle "le
     stock ne doit jamais être créé depuis le catalogue" : ici c'est le CATALOGUE qui part
     du stock, à la demande explicite d'Antho, et rien n'est enregistré tant qu'il ne valide
     pas lui-même la fiche (il atterrit sur la page complète, pas une création silencieuse). */
  createCatalogFromStock(pId) {
    const p = Store.state.stockM.find(x => x.id === pId); if (!p) return;
    const S = Store.state.settings;
    const meat = S.meatTypes.find(m => m.toLowerCase() === (p.meatType || '').toLowerCase()) || S.meatTypes[0];
    Catalogue._prefill = {
      name: p.name,
      meatType: meat,
      variants: (p.variants || []).filter(v => v.mode !== 'vrac').map(v => ({
        id: U.uid(), mode: v.mode,
        value: v.mode === 'size' ? '' : U.num(v.value),
        label: v.mode === 'size' ? (v.label || '') : '',
        sachetId: '0', coeff: '', priceTTCManual: '', sku: v.sku || '', enabled: true
      }))
    };
    location.hash = '/catalogue/new';
  },

  addLot(pId, vId) {
    const p=Store.state.stockM.find(x=>x.id===pId); if(!p) return;
    const v=p.variants.find(x=>x.id===vId); if(!v) return;
    // Instantané pris AVANT le resync automatique ci-dessous, pour que l'Annulation
    // défasse aussi cet éventuel effet de bord silencieux, pas seulement l'ajout du lot.
    const snap=Store.snapshot('stockM',p);
    if(p.catalogId) this.syncPricesFromCatalog(p.catalogId);
    U.modal({
      title:'＋ Lot — '+U.esc(p.name)+' › '+U.esc(Pricing.labelVariant(v)), okLabel:'Ajouter',
      body:`<div class="fg"><label>N° de lot</label><input id="nl_num" placeholder="lot fournisseur"></div>
      ${U.datePickerHTML('nl_dluo','DLUO')}
      <div class="frow">
        <div class="fg"><label>Qté stock général</label><input id="nl_qg" type="number" step="0.001" value="0"></div>
        <div class="fg"><label>Qté stock événement</label><input id="nl_qe" type="number" step="0.001" value="0"></div>
      </div>`,
      onOk:()=>{
        // Le coût unitaire vient du prix d'achat déjà réglé sur la variante (colonne "Prix achat"
        // de la fiche produit) — pas besoin de le ressaisir à chaque lot.
        v.lots.push({id:U.uid(),lotNumber:U.val('nl_num'),dluo:U.val('nl_dluo'),qtyGeneral:U.numVal('nl_qg'),qtyEvent:U.numVal('nl_qe'),costUnit:U.num(v.costUnit)});
        const entry=Store.commitSnapshot(snap,'stock',`Lot ajouté — ${p.name}/${Pricing.labelVariant(v)} (${U.val('nl_num')||'sans n°'})`);
        Store.save('stockM'); U.closeModal(); App.rerender();
        U.toast('Lot ajouté.', false, entry.id);
      }
    });
  },

  delLot(pId,vId,lId){
    const f=this.findLot(pId,vId,lId); if(!f) return;
    if(!confirm('Supprimer ce lot ?')) return;
    const snap=Store.snapshot('stockM',f.p);
    f.v.lots=f.v.lots.filter(l=>l.id!==lId);
    const entry=Store.commitSnapshot(snap,'stock',`Lot supprimé — ${f.p.name}/${Pricing.labelVariant(f.v)}`);
    Store.save('stockM'); App.rerender();
    U.toast('Lot supprimé.', false, entry.id);
  },

  editLot(pId,vId,lId){
    const f=this.findLot(pId,vId,lId); if(!f) return;
    const snap=Store.snapshot('stockM',f.p);
    U.modal({
      title:'✏️ Modifier le lot — '+U.esc(f.p.name)+' › '+U.esc(Pricing.labelVariant(f.v)),
      okLabel:'Enregistrer',
      body:`<div class="fg"><label>N° de lot</label><input id="el_num" value="${U.esc(f.lot.lotNumber||'')}"></div>
      ${U.datePickerHTML('el_dluo','DLUO')}`,
      onOk:()=>{
        f.lot.lotNumber=U.val('el_num');
        f.lot.dluo=U.val('el_dluo');
        const entry=Store.commitSnapshot(snap,'stock',`Lot modifié — ${f.p.name}/${Pricing.labelVariant(f.v)} (${f.lot.lotNumber||'sans n°'})`);
        Store.save('stockM'); U.closeModal(); App.rerender();
        U.toast('Lot modifié.', false, entry.id);
      }
    });
    const dlInput=document.getElementById('el_dluo');
    if(dlInput&&f.lot.dluo){dlInput.value=f.lot.dluo;U.datePickerSync('el_dluo');}
  },

  transferLot(pId,vId,lId,dir){
    const f=this.findLot(pId,vId,lId); if(!f) return;
    const isGE = dir==='ge';
    const genStart = U.num(f.lot.qtyGeneral), evtStart = U.num(f.lot.qtyEvent);
    const avail = isGE ? genStart : evtStart;
    const label = isGE ? "Quantité à transférer du Stock Général vers Événement" : "Quantité à retirer de l'Événement vers le Stock Général";
    const availLabel = isGE ? 'Stock disponible en Général' : 'Stock actuellement en Événement';
    const quickBtns = [1,2,3,4,5,6,7,8,9,10].map(n=>`<button type="button" class="btn-ghost btn-sm" onclick="document.getElementById('tl_qty').value='${n}';Stock.updateTransferPreview(${genStart},${evtStart},'${dir}')">${n}</button>`).join('');
    U.modal({
      title: isGE ? '→ Transfert vers Événement' : '← Retour vers Stock Général', okLabel:'Confirmer le transfert',
      body:`<p class="muted"><b>${U.esc(f.p.name)}</b><br>${U.esc(Pricing.labelVariant(f.v))} · lot ${U.esc(f.lot.lotNumber||'—')}</p>
        <div class="fg"><label>${label}</label>
          <input id="tl_qty" type="number" step="0.001" min="0" value="" oninput="Stock.updateTransferPreview(${genStart},${evtStart},'${dir}')"></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${quickBtns}
          <button type="button" class="btn-ghost btn-sm" style="border-color:var(--ok);color:var(--ok);" onclick="document.getElementById('tl_qty').value='${avail}';Stock.updateTransferPreview(${genStart},${evtStart},'${dir}')">MAX</button>
        </div>
        <p class="muted mt">${availLabel} : <b>${U.qty(avail)}</b></p>
        <div style="border-left:4px solid ${isGE?'var(--ok)':'#3b6fa0'};padding:8px 12px;display:flex;gap:24px;">
          <div><div class="muted" style="font-size:.78rem;">Stock Général après</div><b id="tl_after_gen" style="font-size:1.1rem;">${U.qty(genStart)}</b></div>
          <div><div class="muted" style="font-size:.78rem;">Stock Événement après</div><b id="tl_after_evt" style="font-size:1.1rem;">${U.qty(evtStart)}</b></div>
        </div>`,
      onOk:()=>{
        const n=U.numVal('tl_qty'); if(n<=0){U.toast('Quantité invalide.',true);return false;}
        const l=f.lot;
        if(isGE){ if(U.num(l.qtyGeneral)<n){U.toast('Stock général insuffisant',true);return false;} l.qtyGeneral=U.num(l.qtyGeneral)-n;l.qtyEvent=U.num(l.qtyEvent)+n; }
        else{ if(U.num(l.qtyEvent)<n){U.toast('Stock événement insuffisant',true);return false;} l.qtyEvent=U.num(l.qtyEvent)-n;l.qtyGeneral=U.num(l.qtyGeneral)+n; }
        const entry = Store.log('transfert',`Transfert ${U.qty(n)} — ${f.p.name}/${Pricing.labelVariant(f.v)} (${isGE?'gén.→évén.':'évén.→gén.'})`,
          {type:'lotTransfer',data:{pId,vId,lId,n,dir}});
        Store.save('stockM'); U.closeModal(); App.rerender();
        U.toast('Transfert effectué.', false, entry.id);
      }
    });
  },

  /* Aperçu live "après transfert" dans la modale de transfert — repris de l'ancienne appli
     sur demande d'Antho. genStart/evtStart sont les valeurs au moment de l'ouverture de la
     modale (figées en closure via transferLot), n vient de l'input à chaque frappe/clic rapide. */
  updateTransferPreview(genStart, evtStart, dir){
    const n = U.numVal('tl_qty');
    const isGE = dir === 'ge';
    const afterGen = isGE ? genStart - n : genStart + n;
    const afterEvt = isGE ? evtStart + n : evtStart - n;
    const gEl = document.getElementById('tl_after_gen');
    const eEl = document.getElementById('tl_after_evt');
    if (gEl) gEl.textContent = U.qty(afterGen);
    if (eEl) eEl.textContent = U.qty(afterEvt);
  },

  conditionner(pId,vId,lId){
    const f=this.findLot(pId,vId,lId); if(!f) return;
    const p=f.p;
    if(p.catalogId) this.syncPricesFromCatalog(p.catalogId);
    const targets=p.variants.filter(v=>v.mode!=='vrac');
    if(!targets.length){U.toast('Aucune variante de vente : ajoute une variante via ＋ Variante.',true);return;}
    const isKg=f.v.label.includes('kg');
    U.modal({
      title:'🎁 Conditionner — '+U.esc(p.name), okLabel:'Conditionner',
      body:`<p class="muted">Vrac disponible (lot ${U.esc(f.lot.lotNumber||'—')}) : <b>${U.qty(U.num(f.lot.qtyGeneral)+U.num(f.lot.qtyEvent))}</b> ${isKg?'kg':'pc'} ${U.dluoTag(f.lot.dluo)}</p>
        <div class="frow">
          <div class="fg" style="flex:2;"><label>Variante à produire</label><select id="cd_var">
            ${targets.map(v=>`<option value="${v.id}">${U.esc(Pricing.labelVariant(v))}</option>`).join('')}</select></div>
          <div class="fg"><label>Nombre d'unités</label><input id="cd_n" type="number" step="1" value="1"></div>
        </div>`,
      onOk:()=>{
        const n=U.numVal('cd_n'); if(n<=0) return false;
        const tv=p.variants.find(x=>x.id===U.val('cd_var'));
        let consumed;
        if(tv.mode==='gram') consumed=isKg?n*U.num(tv.value)/1000:n;
        else consumed=isKg?0:n*(U.num(tv.value)||1);
        if(consumed===0&&isKg){U.toast('Variante à la pièce depuis un vrac en kg : utilise un vrac en pièces.',true);return false;}
        const avail=U.num(f.lot.qtyGeneral)+U.num(f.lot.qtyEvent);
        if(consumed>avail+1e-9){U.toast(`Vrac insuffisant : il faut ${U.qty(consumed)} ${isKg?'kg':'pc'}.`,true);return false;}
        const fromG=Math.min(U.num(f.lot.qtyGeneral),consumed);
        f.lot.qtyGeneral=U.num(f.lot.qtyGeneral)-fromG; f.lot.qtyEvent=U.num(f.lot.qtyEvent)-(consumed-fromG);
        let dest=tv.lots.find(l=>l.lotNumber===f.lot.lotNumber&&l.dluo===f.lot.dluo);
        if(!dest){dest={id:U.uid(),lotNumber:f.lot.lotNumber,dluo:f.lot.dluo,qtyGeneral:0,qtyEvent:0,costUnit:U.num(tv.costUnit)||U.num(f.lot.costUnit)};tv.lots.push(dest);}
        dest.qtyGeneral=U.num(dest.qtyGeneral)+n;
        const entry = Store.log('conditionnement',`${n}×${Pricing.labelVariant(tv)} — ${p.name} (lot ${f.lot.lotNumber||'—'})`,
          {type:'condition',data:{pId,vId,lId,tvId:tv.id,destLotId:dest.id,n,consumed,fromG}});
        Store.save('stockM'); U.closeModal(); App.rerender();
        U.toast(`${n}×${Pricing.labelVariant(tv)} conditionnés.`, false, entry.id);
      }
    });
  },

  /* ───── PÉREMPTIONS (onglet dédié) ───── */
  allLotRows() {
    const rows = [];
    Store.state.stockM.forEach(p => p.variants.forEach(v => {
      v.lots.forEach(l => {
        if (!l.dluo) return;
        rows.push({ p, v, l, label: Pricing.labelVariant(v), qg: U.num(l.qtyGeneral), qe: U.num(l.qtyEvent), days: U.daysTo(l.dluo) });
      });
    }));
    return rows;
  },

  dluoStatusBadge(days) {
    if (days < 0) return `<span class="badge bad">Expiré</span>`;
    if (days === 0) return `<span class="badge bad">Aujourd'hui</span>`;
    if (days === 1) return `<span class="badge bad">Demain</span>`;
    if (days <= 30) return `<span class="badge bad">Dans ${days} j</span>`;
    if (days <= 90) return `<span class="badge warn">Expire dans 3 mois</span>`;
    if (days <= 180) return `<span class="badge yellow">Expire dans 6 mois</span>`;
    return `<span class="badge ok">Expire dans ${Math.ceil(days/30)} mois</span>`;
  },

  peremKey(r) { return r.p.id+'|'+r.v.id+'|'+r.l.id; },

  renderPeremptions() {
    const f = this.perem;
    if (!f.excluded) f.excluded = []; // clés (pId|vId|lId) décochées — tout est coché par défaut
    U.syncFilters('stock_peremptions', f);
    const varGroups = this.allVariantGroups();
    const allVariants = varGroups.flatMap(g => g.items);
    this._peremVariantsCache = allVariants;
    f.variants = f.variants.filter(v => allVariants.includes(v));

    // Quantité selon le stock à vérifier : Général, Événement, ou les DEUX réunis (total).
    const viewQty = (r) => f.view === 'event' ? r.qe : f.view === 'both' ? (r.qe + r.qg) : r.qg;
    const viewLabel = f.view === 'event' ? 'évén.' : f.view === 'both' ? 'total' : 'gén.';

    // Variantes ayant ≥2 numéros de lot DISTINCTS avec du stock dans le stock affiché
    // (même logique que le filtre « Plusieurs numéros de lots » de Mastication). Sert au
    // filtre « Plusieurs lots » : feuille de vigilance FEFO à imprimer avant un marché
    // (produits où il faut penser à vendre la DLUO la plus courte en premier).
    const multiSet = new Set();
    { const byVar = {};
      this.allLotRows().forEach(r => {
        if (viewQty(r) <= 0) return;
        const ln = (r.l.lotNumber || '').trim(); if (!ln) return;
        const vk = r.p.id + '|' + r.v.id;
        (byVar[vk] = byVar[vk] || new Set()).add(ln);
      });
      Object.keys(byVar).forEach(k => { if (byVar[k].size >= 2) multiSet.add(k); });
    }

    let rows = this.allLotRows().filter(r => {
      if (viewQty(r) <= 0) return false;
      if (f.q && !r.p.name.toLowerCase().includes(f.q.toLowerCase())) return false;
      if (f.variants.length && !f.variants.includes(r.label)) return false;
      if (f.horizon === 'multi') return multiSet.has(r.p.id + '|' + r.v.id);
      if (f.horizon === 'expired') return r.days < 0;
      if (f.horizon === '1') return r.days <= 30;
      if (f.horizon === '3') return r.days <= 90;
      if (f.horizon === '6') return r.days <= 180;
      if (f.horizon === '9') return r.days <= 270;
      return true; // 'all'
    }).sort((a, b) => {
      const dir = f.sortDir === 'desc' ? -1 : 1;
      // Tri « Produit » : regroupe les lots d'un même produit, DLUO la plus courte en tête
      // (idéal pour la feuille de marché « plusieurs lots »).
      if (f.sort === 'name') return dir * (U.sortFr(a.p.name, b.p.name) || (a.days - b.days));
      if (f.sort === 'meat') return dir * U.sortFr(a.p.meatType || '', b.p.meatType || '');
      if (f.sort === 'variant') return dir * U.sortFr(a.label, b.label);
      if (f.sort === 'stock') return dir * (viewQty(a) - viewQty(b));
      if (f.sort === 'status') return dir * (a.days - b.days); // le statut suit strictement la DLUO restante
      return dir * (a.days - b.days); // 'days' (défaut : les plus proches de la péremption d'abord)
    });
    this._peremRowsCache = rows;
    const allChecked = rows.every(r => !f.excluded.includes(this.peremKey(r)));
    const sortHead = (key, label) => `<span class="sortable ${f.sort===key?'active':''}" onclick="Stock.setPeremSort('${key}')">${label} ${f.sort===key?(f.sortDir==='asc'?'▲':'▼'):'⇕'}</span>`;

    document.getElementById('stockBody').innerHTML = `
      <div class="card" style="padding:12px 16px;">
        <label style="display:block;margin-bottom:6px;">Stock à vérifier</label>
        <div class="frow" style="margin-bottom:12px;">
          <button class="${f.view==='general'?'btn-cta':'btn-ghost'}" onclick="Stock._setPeremView('general')">🏬 Stock Général</button>
          <button class="${f.view==='event'?'btn-cta':'btn-ghost'}" onclick="Stock._setPeremView('event')">🎪 Stock Événement</button>
          <button class="${f.view==='both'?'btn-cta':'btn-ghost'}" onclick="Stock._setPeremView('both')">🧺 Général + événement (total)</button>
        </div>
        <div class="grid c3">
          <div class="fg mb0"><label>Recherche</label><input id="stock_q_perem" value="${U.esc(f.q)}" placeholder="nom du produit…" oninput="Stock.perem.q=this.value;Stock.renderPeremptions();U.refocus('stock_q_perem')"></div>
          <div class="fg mb0"><label>Variantes</label>${U.multiSelect({ groups: varGroups, selected: f.variants, toggle: 'Stock.peremToggleVariant', setAll: 'Stock.peremSetAllVariant', open: f.variantsOpen, onOpen: 'Stock.peremSetOpen' })}</div>
          <div class="fg mb0"><label>Horizon</label>${U.customSelect({ value: f.horizon, options: [{v:'expired',l:'Lots expirés'},{v:'1',l:'Expire dans 1 mois'},{v:'3',l:'Expire dans 3 mois'},{v:'6',l:'Expire dans 6 mois'},{v:'9',l:'Expire dans 9 mois'},{v:'all',l:'Afficher tout (avec date)'},{v:'multi',l:'🔀 Plusieurs lots (même variante)'}], onPick: 'Stock._setPeremHorizon' })}</div>
        </div>
        ${f.horizon === 'multi'
          ? `<p class="muted mb0" style="border-left:3px solid var(--warn);padding-left:8px;">🔀 <b>Produits à plusieurs numéros de lot</b> dans le ${f.view==='event'?'stock ÉVÉNEMENT':f.view==='both'?'stock TOTAL (général + événement)':'stock général'} — pense à vendre la <b>DLUO la plus courte en premier</b>. Coche puis imprime pour ta feuille de marché.</p>`
          : `<p class="muted mb0">Coche les lignes à inclure dans l'impression — toutes sont cochées par défaut.</p>`}
        <div class="frow mt" style="gap:6px;align-items:center;">
          <button class="btn-cta btn-sm" onclick="window.print()">🖨 Imprimer la sélection</button>
          <button class="btn-ghost btn-sm" onclick="Stock.peremSetAllSel(true)">☑ Tout cocher</button>
          <button class="btn-ghost btn-sm" onclick="Stock.peremSetAllSel(false)">☐ Tout décocher</button>
          <span class="muted" style="margin-left:auto;">${rows.length} lot(s)</span>
        </div>
      </div>
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th class="no-print"><input type="checkbox" ${allChecked?'checked':''} onchange="Stock.peremSetAllSel(this.checked)"></th><th class="col-name">${sortHead('name','Produit')}</th><th>${sortHead('meat','Type viande')}</th><th>${sortHead('variant','Variante')}</th><th>N° lot</th><th>${sortHead('days','Date péremption')}</th><th class="num">${sortHead('stock','Stock ('+viewLabel+')')}</th><th>${sortHead('status','Statut')}</th></tr></thead>
          <tbody>${rows.map(r => { const key = this.peremKey(r); const checked = !f.excluded.includes(key); return `<tr class="${checked?'':'excluded-from-print'}">
            <td class="no-print"><input type="checkbox" ${checked?'checked':''} onchange="Stock.peremToggleSel('${key}')"></td>
            <td class="col-name"><b>${U.esc(r.p.name)}</b></td>
            <td><span class="badge info">${U.esc(r.p.meatType||'—')}</span></td>
            <td>${U.esc(r.label)}</td>
            <td><span class="tag">${U.esc(r.l.lotNumber||'sans n°')}</span></td>
            <td>${U.frDate(r.l.dluo)}</td>
            <td class="num">${U.qty(viewQty(r))}</td>
            <td>${this.dluoStatusBadge(r.days)}</td>
          </tr>`; }).join('') || '<tr><td colspan="8" class="muted">Aucun lot pour ces filtres.</td></tr>'}</tbody>
        </table></div>
      </div>`;
  },
  setPeremSort(key) {
    if (this.perem.sort === key) this.perem.sortDir = this.perem.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.perem.sort = key; this.perem.sortDir = 'asc'; }
    this.renderPeremptions();
  },
  peremToggleVariant(name) { this._toggleIn(this.perem.variants, name); this.renderPeremptions(); },
  peremSetAllVariant(all) { this.perem.variants = all ? [...this._peremVariantsCache] : []; this.renderPeremptions(); },
  peremSetOpen(open) { this.perem.variantsOpen = open; },
  peremToggleSel(key) { this._toggleIn(this.perem.excluded, key); this.renderPeremptions(); },
  peremSetAllSel(checked) {
    if (checked) { this.perem.excluded = []; }
    else { this.perem.excluded = (this._peremRowsCache || []).map(r => this.peremKey(r)); }
    this.renderPeremptions();
  },

  /* ───── FAIBLE STOCK (onglet unifié : 3 boutons Général / Événement / Total) ─────
     - Général : stock général vs seuil général — tous types — bouton « Générer la commande »
     - Total   : stock total (gén+évén) vs (seuil gén + seuil évén) — tous types — commande
     - Événement : stock événement vs seuil événement — mastication seulement —
                   colonne « général dispo » (aide au transfert), pas de commande */
  ftKey(kind, pId, vId) { return kind + '|' + pId + '|' + (vId || ''); },

  renderFaible() {
    const f = this.faible;
    U.syncFilters('stock_faible', f);
    const varGroups = this.allVariantGroups();
    const allVariants = varGroups.flatMap(g => g.items);
    this._faibleVariantsCache = allVariants;
    f.variants = f.variants.filter(v => allVariants.includes(v));

    const view = f.view;                 // 'general' | 'event' | 'total'
    const eventView = view === 'event';
    // En Événement : mastication uniquement (matières/consommables ne partent pas en événement)
    const typeEff = eventView ? 'mastication' : f.type;

    let rows = [];
    if (typeEff === 'all' || typeEff === 'mastication') {
      Store.state.stockM.forEach(p => p.variants.forEach(v => {
        if (v.mode === 'vrac') return;
        const label = Pricing.labelVariant(v);
        if (f.variants.length && !f.variants.includes(label)) return;
        const qg = v.lots.reduce((a, l) => a + U.num(l.qtyGeneral), 0);
        const qe = v.lots.reduce((a, l) => a + U.num(l.qtyEvent), 0);
        rows.push({ key: this.ftKey('M', p.id, v.id), kind: 'M', cat: 'Mastication', produit: p.name, meat: p.meatType || '', variante: label, ref: v.ref || '', qg, qe, total: qg + qe, minG: U.num(v.low), minE: U.num(v.lowEvent) });
      }));
    }
    if (!eventView && (typeEff === 'all' || typeEff === 'materiaux')) {
      Store.state.materials.forEach(m => {
        rows.push({ key: this.ftKey('MT', m.id), kind: 'MT', cat: 'Matière première', produit: m.product || m.name, meat: '', variante: m.variant || m.name, ref: '', qg: U.num(m.qty), qe: 0, total: U.num(m.qty), minG: U.num(m.low), minE: 0 });
      });
    }
    if (!eventView && (typeEff === 'all' || typeEff === 'conso')) {
      Store.state.consumables.forEach(c => {
        rows.push({ key: this.ftKey('C', c.id), kind: 'C', cat: 'Consommable', produit: c.name, meat: '', variante: '—', ref: '', qg: U.num(c.qty), qe: 0, total: U.num(c.qty), minG: U.num(c.low), minE: 0 });
      });
    }

    // Métrique active selon la vue
    const stockOf = (r) => view === 'event' ? r.qe : view === 'total' ? r.total : r.qg;
    const minOf = (r) => view === 'event' ? r.minE : view === 'total' ? (r.minG + r.minE) : r.minG;
    const viewLabel = view === 'event' ? 'évén.' : view === 'total' ? 'total' : 'gén.';

    // Ne garder que les lignes ayant un seuil défini pour la vue (sinon pas d'alerte pertinente)
    rows = rows.filter(r => minOf(r) > 0);
    rows = rows.filter(r => {
      const s = stockOf(r), m = minOf(r);
      if (f.status === 'out') return s <= 0;
      if (f.status === 'low') return s <= m;
      return true;
    }).sort((a, b) => {
      const dir = f.sortDir === 'desc' ? -1 : 1;
      if (f.sort === 'cat') return dir * U.sortFr(a.cat, b.cat);
      if (f.sort === 'name') return dir * U.sortFr(a.produit, b.produit);
      if (f.sort === 'meat') return dir * U.sortFr(a.meat, b.meat);
      if (f.sort === 'variant') return dir * U.sortFr(a.variante, b.variante);
      if (f.sort === 'min') return dir * (minOf(a) - minOf(b));
      if (f.sort === 'stock') return dir * (stockOf(a) - stockOf(b));
      if (f.sort === 'gen') return dir * (a.qg - b.qg);
      if (f.sort === 'status') return dir * ((stockOf(a) <= 0 ? 0 : 1) - (stockOf(b) <= 0 ? 0 : 1)); // Rupture d'abord
      return dir * ((stockOf(a) - minOf(a)) - (stockOf(b) - minOf(b))); // 'gap' : les plus en dessous du seuil d'abord
    });
    this._faibleRowsCache = rows;
    f.sel = f.sel.filter(k => rows.some(r => r.key === k));
    if (!f.excluded) f.excluded = [];
    f.excluded = f.excluded.filter(k => rows.some(r => r.key === k)); // impression événement : opt-out
    const allEvtChecked = rows.every(r => !f.excluded.includes(r.key));
    const sortHead = (key, label) => `<span class="sortable ${f.sort === key ? 'active' : ''}" onclick="Stock.setFaibleSort('${key}')">${label} ${f.sort === key ? (f.sortDir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
    const btn = (v, l) => `<button class="${view === v ? 'btn-cta' : 'btn-ghost'}" onclick="Stock._setFaibleView('${v}')">${l}</button>`;

    const filters = `
      <div class="grid ${eventView ? 'c2' : 'c3'}">
        ${eventView ? '' : `<div class="fg mb0"><label>Type de produit</label>${U.customSelect({ value: f.type, options: [{ v: 'all', l: 'Tous les produits' }, { v: 'mastication', l: 'Mastication' }, { v: 'materiaux', l: 'Matières premières' }, { v: 'conso', l: 'Consommables' }], onPick: 'Stock._setFaibleType' })}</div>`}
        <div class="fg mb0"><label>Variantes</label>${U.multiSelect({ groups: varGroups, selected: f.variants, toggle: 'Stock.faibleToggleVariant', setAll: 'Stock.faibleSetAllVariant', open: f.variantsOpen, onOpen: 'Stock.faibleSetOpen' })}</div>
        <div class="fg mb0"><label>Statut</label>${U.customSelect({ value: f.status, options: [{ v: 'low', l: 'Stock faible (qté > 0)' }, { v: 'out', l: 'Rupture de stock' }, { v: 'all', l: 'Tout afficher' }], onPick: 'Stock._setFaibleStatus' })}</div>
      </div>`;

    let table;
    if (eventView) {
      table = `<table>
        <thead><tr><th class="no-print"><input type="checkbox" ${allEvtChecked ? 'checked' : ''} onchange="Stock.faibleSetAllExcluded(this.checked)"></th><th class="col-name">${sortHead('name', 'Produit')}</th><th>${sortHead('meat', 'Type viande')}</th><th>${sortHead('variant', 'Variante')}</th><th class="num">${sortHead('stock', 'Stock évén.')}</th><th class="num">${sortHead('min', 'Seuil min évén.')}</th><th class="num">${sortHead('gen', 'Stock général dispo.')}</th><th>${sortHead('status', 'Statut')}</th></tr></thead>
        <tbody>${rows.map(r => { const checked = !f.excluded.includes(r.key); return `<tr class="${checked ? '' : 'excluded-from-print'}">
          <td class="no-print"><input type="checkbox" ${checked ? 'checked' : ''} onchange="Stock.faibleToggleExcluded('${r.key}')"></td>
          <td class="col-name"><b>${U.esc(r.produit)}</b></td>
          <td>${r.meat ? `<span class="badge info">${U.esc(r.meat)}</span>` : '—'}</td>
          <td>${U.esc(r.variante)}</td>
          <td class="num">${U.qty(r.qe)}</td>
          <td class="num">${U.qty(r.minE)}</td>
          <td class="num ${r.qg > 0 ? 'pos' : ''}">${U.qty(r.qg)}</td>
          <td>${r.qe <= 0 ? '<span class="badge bad">Rupture</span>' : '<span class="badge warn">Stock faible</span>'}</td>
        </tr>`; }).join('') || '<tr><td colspan="8" class="muted">Aucun résultat pour ces filtres.</td></tr>'}</tbody>
      </table>`;
    } else {
      table = `<table>
        <thead><tr><th class="no-print"><input type="checkbox" ${rows.length && f.sel.length === rows.length ? 'checked' : ''} onchange="Stock.faibleSetAllSel(this.checked)"></th><th>${sortHead('cat', 'Catégorie')}</th><th class="col-name">${sortHead('name', 'Produit')}</th><th>${sortHead('meat', 'Type viande')}</th><th>${sortHead('variant', 'Variante principale')}</th><th class="num">${sortHead('min', 'Stock minimal')}</th><th class="num">${sortHead('stock', 'Stock (' + viewLabel + ')')}</th><th>${sortHead('status', 'Statut')}</th></tr></thead>
        <tbody>${rows.map(r => `<tr>
          <td class="no-print"><input type="checkbox" ${f.sel.includes(r.key) ? 'checked' : ''} onchange="Stock.faibleToggleSel('${r.key}')"></td>
          <td><span class="badge info">${U.esc(r.cat)}</span></td>
          <td class="col-name"><b>${U.esc(r.produit)}</b></td>
          <td>${r.meat ? `<span class="badge info">${U.esc(r.meat)}</span>` : '—'}</td>
          <td>${U.esc(r.variante)}</td>
          <td class="num">${U.qty(minOf(r))}</td>
          <td class="num">${U.qty(stockOf(r))}</td>
          <td>${stockOf(r) <= 0 ? '<span class="badge bad">Rupture</span>' : '<span class="badge warn">Stock faible</span>'}</td>
        </tr>`).join('') || '<tr><td colspan="8" class="muted">Aucun résultat pour ces filtres.</td></tr>'}</tbody>
      </table>`;
    }

    const hint = eventView
      ? `<p class="muted mb0">Avant un marché : vérifie que ton stock événement respecte le seuil. La colonne « général dispo » indique ce que tu peux transférer depuis le général.</p>`
      : `<p class="muted mb0">Coche les produits à recommander puis « Générer la commande ».</p>`;

    document.getElementById('stockBody').innerHTML = `
      <div class="card" style="padding:12px 16px;">
        <label style="display:block;margin-bottom:6px;">Stock à vérifier</label>
        <div class="frow" style="margin-bottom:12px;">
          ${btn('general', '🏬 Stock Général')}
          ${btn('event', '🎪 Stock Événement')}
          ${btn('total', '🧺 Général + événement (total)')}
        </div>
        ${filters}
        ${hint}
        ${eventView ? `<div class="frow mt" style="gap:6px;align-items:center;">
            <button class="btn-cta btn-sm" onclick="window.print()">🖨 Imprimer la sélection</button>
            <button class="btn-ghost btn-sm" onclick="Stock.faibleSetAllExcluded(true)">☑ Tout cocher</button>
            <button class="btn-ghost btn-sm" onclick="Stock.faibleSetAllExcluded(false)">☐ Tout décocher</button>
            <span class="muted" style="margin-left:auto;">${rows.length} ligne(s)</span>
          </div>`
          : `<div class="frow mt" style="gap:6px;align-items:center;">
            <button class="btn-cta btn-sm" onclick="Stock.faibleGenerateOrder()">📋 Générer la commande (${f.sel.length})</button>
            <span class="muted" style="margin-left:auto;">${rows.length} ligne(s)</span>
          </div>`}
      </div>
      <div class="card"><div class="table-wrap">${table}</div></div>`;
  },
  setFaibleSort(key) {
    const f = this.faible;
    if (f.sort === key) f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc';
    else { f.sort = key; f.sortDir = 'asc'; }
    this.renderFaible();
  },
  faibleToggleVariant(name) { this._toggleIn(this.faible.variants, name); this.renderFaible(); },
  faibleSetAllVariant(all) { this.faible.variants = all ? [...this._faibleVariantsCache] : []; this.renderFaible(); },
  faibleSetOpen(open) { this.faible.variantsOpen = open; },
  faibleToggleSel(key) { this._toggleIn(this.faible.sel, key); this.renderFaible(); },
  faibleSetAllSel(all) {
    this.faible.sel = all ? (this._faibleRowsCache || []).map(r => r.key) : [];
    this.renderFaible();
  },
  // Vue Événement : impression opt-out (tout coché par défaut, décoche pour exclure de l'impression)
  faibleToggleExcluded(key) { this._toggleIn(this.faible.excluded, key); this.renderFaible(); },
  faibleSetAllExcluded(checked) {
    this.faible.excluded = checked ? [] : (this._faibleRowsCache || []).map(r => r.key);
    this.renderFaible();
  },
  faibleGenerateOrder() {
    const f = this.faible;
    if (!f.sel.length) { U.toast('Sélectionne au moins une ligne.', true); return; }
    const items = []; let missing = 0;
    const seen = new Set();
    f.sel.forEach(key => {
      const [kind, id, vId] = key.split('|');
      let prodName = '', ref = '', supNotes = [], supplier = '', supplierUrl = '';
      if (kind === 'M') {
        const p = Store.state.stockM.find(x => x.id === id); const v = p?.variants.find(x => x.id === vId); if (!v) return;
        prodName = `${p.name} — ${Pricing.labelVariant(v)}`;
        ref = v.ref || '';
        if (p.catalogId) {
          const cat = Store.state.catalogM.find(c => c.id === p.catalogId);
          if (cat) {
            (cat.suppliers || []).forEach(s => {
              if (s.notes) supNotes.push({ name: Store.supplierName(s.supplierId), text: s.notes, isMain: s.supplierId === cat.mainSupplierId });
            });
            if (!supNotes.length && cat.notes) supNotes.push({ name: 'Produit', text: cat.notes, isMain: false });
            const main = (cat.suppliers || []).find(s => s.supplierId === cat.mainSupplierId) || (cat.suppliers || [])[0];
          if (main) { supplier = Store.supplierName(main.supplierId); supplierUrl = main.url || ''; }
          }
        }
      } else if (kind === 'MT') {
        const m = Store.state.materials.find(x => x.id === id); if (!m) return;
        prodName = `${m.product ? m.product + ' ' : ''}${m.variant || m.name}`;
        if (m.supplierId) supplier = Store.supplierName(m.supplierId);
        supplierUrl = m.url || '';
      } else {
        const c = Store.state.consumables.find(x => x.id === id); if (!c) return;
        prodName = c.name; missing++;
      }
      const ukey = kind + '|' + id + '|' + (vId || '');
      if (seen.has(ukey)) return; seen.add(ukey);
      if (Store.hideSupplierInfo()) { ref = ''; supplierUrl = ''; supNotes = []; }
      else if (!ref && !supplier && !supplierUrl) missing++;
      items.push({ prodName, ref, supNotes, supplier, supplierUrl });
    });
      this._orderItems = items;
      const groups = {};
      items.forEach(it => { const key = it.supplier || ''; if (!groups[key]) groups[key] = []; groups[key].push(it); });
      const groupKeys = Object.keys(groups).sort((a, b) => { if (!a && b) return 1; if (a && !b) return -1; return U.sortFr(a, b); });
      this._orderGroups = groups; this._orderGroupKeys = groupKeys; this._orderFilter = null;
      U.modal({
        title: '📋Commande à passer', hideOk: true, wide: true,
        body: `${missing ? `<p class="warn-txt mt-0">${missing} ligne(s) sans reference fournisseur.</p>` : ''}
          <div id="order_filterbar">${this._orderFilterBarHTML()}</div>
          <div id="order_list" style="max-height:min(60vh,560px);overflow-y:auto;">${this._orderListHTML()}</div>
          <button type="button" class="btn-ghost btn-sm mt" onclick="Stock.copyOrderList()">📋Copier la liste</button>`
      });
    },

    _orderNoteBox(n) {
      return `<div style="margin:4px 0;padding:6px 10px;background:${n.isMain ? '#fff3cd' : '#e8f4fd'};color:${n.isMain ? '#664d03' : '#4a6de5'};border-left:4px solid ${n.isMain ? '#ffc107' : '#4da6d9'};border-radius:4px;font-size:.85rem;white-space:pre-wrap;"><b>💡${U.esc(n.name)}${n.isMain ? ' ★' : ''}</b>\n${U.esc(n.text)}</div>`;
    },

    _orderFilterBarHTML() {
      const chip = (key, label, count, active) => `<button type="button" class="btn-sm" style="border-radius:16px;padding:5px 12px;margin:2px;border:1px solid var(--card-border);background:${active ? 'var(--caramel)' : 'transparent'};color:${active ? '#1a1a1a' : 'var(--txt)'};font-weight:${active ? '700' : '400'};cursor:pointer;" onclick="Stock.filterOrderBySupplier('${U.esc(key).replace(/'/g, "\\'")}')">${U.esc(label)} (${count})</button>`;
      const total = this._orderItems.length;
      return `<div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:10px;">
        ${chip('__ALL__', 'Tous', total, !this._orderFilter)}
        ${this._orderGroupKeys.map(k => chip(k, k || 'Sans fournisseur', this._orderGroups[k].length, this._orderFilter === k)).join('')}
      </div>`;
    },

    _orderListHTML() {
      const keys = this._orderFilter !== null ? [this._orderFilter] : this._orderGroupKeys;
      return keys.map(supName => {
        const list = this._orderGroups[supName];
        const header = `<h3 style="margin:14px 0 8px;font-size:1.05rem;font-weight:700;color:var(--caramel);background:var(--card-bg);padding:8px 10px;border-radius:6px;border-left:4px solid var(--caramel);">${supName ? U.esc(supName) : 'Fournisseur non identifie'} <span style="font-size:.8rem;font-weight:400;color:var(--gris);">(${list.length})</span></h3>`;
        const rows = list.map(it =>
          `<div style="padding:6px 0;border-bottom:1px solid var(--card-border);">
            <div><b>${U.esc(it.prodName)}</b></div>
            ${it.ref ? `<div style="font-size:.85rem;color:var(--gris);font-family:monospace;">${U.esc(it.ref)}</div>` : ''}
            ${it.supplierUrl ? `<div style="font-size:.85rem;"><a href="${U.esc(it.supplierUrl)}" target="_blank" rel="noopener" style="color:var(--caramel);">🔗 Commander chez le fournisseur</a></div>` : ''}
            ${(!it.ref && !it.supplierUrl && !Store.hideSupplierInfo()) ? `<div style="font-size:.85rem;color:var(--alerte);">⚠️Pas de reference fournisseur</div>` : ''}
            ${it.supNotes.map(n => this._orderNoteBox(n)).join('')}
          </div>`
        ).join('');
        return header + rows;
      }).join('');
    },

    filterOrderBySupplier(key) {
      this._orderFilter = (key === '__ALL__') ? null : key;
      const bar = document.getElementById('order_filterbar');
      const list = document.getElementById('order_list');
      if (bar) bar.innerHTML = this._orderFilterBarHTML();
      if (list) list.innerHTML = this._orderListHTML();
    },

    copyOrderList() {
      const items = this._orderItems; if (!items) return;
      const keys = this._orderFilter !== null ? [this._orderFilter] : this._orderGroupKeys;
      const text = keys.map(supName => {
        const header = `=== ${supName || 'Fournisseur non identifie'} ===`;
        const body = this._orderGroups[supName].map(it => {
          let line = it.prodName + (it.ref ? ` [${it.ref}]` : '') + (it.supplierUrl ? ` (${it.supplierUrl})` : '');
          it.supNotes.forEach(n => { line += `\n${n.isMain ? 'MAIN ' : ''}${n.text}`; });
          return line;
        }).join('\n');
        return header + '\n' + body;
      }).join('\n\n');
      const fallbackCopy = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); U.toast('Liste copiee.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => U.toast('Liste copiee.')).catch(fallbackCopy);
      } else { fallbackCopy(); }
    },

  /* ───── CONSOMMABLES ───── */
  consoFilters: { link: 'all', sort: 'name', sortDir: 'asc' },
  setConsoSort(key) {
    const f = this.consoFilters;
    if (f.sort === key) f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc';
    else { f.sort = key; f.sortDir = 'asc'; }
    this.renderConso();
  },
  renderConso(){
    const S=Store.state.settings, f=this.consoFilters;
    U.syncFilters('stock_conso', f);
    const list = Store.state.consumables.filter(c=>f.link!=='nourl'||!c.url);
    const dir = f.sortDir === 'asc' ? 1 : -1;
    list.sort((a,b) => {
      let v = 0;
      switch(f.sort) {
        case 'name': v = U.sortFr(a.name,b.name); break;
        case 'dim': v = this._dimVolume(a.dimensions)-this._dimVolume(b.dimensions); break;
        case 'cat': v = U.sortFr(a.category||'',b.category||''); break;
        case 'qty': v = U.num(a.qty)-U.num(b.qty); break;
        case 'low': v = U.num(a.low)-U.num(b.low); break;
        case 'cost': v = U.num(a.costUnit)-U.num(b.costUnit); break;
      }
      return (v||U.sortFr(a.name,b.name)||(this._dimVolume(a.dimensions)-this._dimVolume(b.dimensions)))*dir;
    });
    const sortHead = (key, label) => `<span class="sortable ${f.sort===key?'active':''}" onclick="Stock.setConsoSort('${key}')">${label} ${f.sort===key?(f.sortDir==='asc'?'▲':'▼'):'⇕'}</span>`;
    document.getElementById('stockBody').innerHTML=`
      <div class="toolbar"><button class="btn-cta" onclick="Stock.editConso()">＋ Consommable</button>
        <div class="fg mb0" style="max-width:240px;"><label>Lien fournisseur</label>${U.customSelect({ value: f.link, options: [{v:'all',l:'Tous'},{v:'nourl',l:'Sans lien fournisseur'}], onPick: 'Stock._setConsoLink' })}</div>
        <span class="muted">Cartons d'envoi, sachets, blisters, étiquettes, encre…</span></div>
      ${list.length ? `<div class="card"><div class="table-wrap"><table>
        <thead><tr><th class="col-name">${sortHead('name','Article')}</th><th>${sortHead('dim','Dimensions')}</th><th>${sortHead('cat','Catégorie')}</th><th style="text-align:center;">${sortHead('qty','En stock')}</th><th style="text-align:center;">${sortHead('low','Seuil')}</th><th style="text-align:center;">${sortHead('cost','Coût / unité')}</th><th></th></tr></thead>
        <tbody>${list.map(c=>{const cTotal=c.costTotal!=null?U.num(c.costTotal):U.num(c.costUnit);const cQper=U.num(c.costQtyPer)||1;return `<tr>
          <td class="col-name"><b>${U.esc(c.name)}</b></td>
          <td class="muted">${c.dimensions ? U.esc(c.dimensions) : '—'}</td>
          <td><span class="badge info">${U.esc(c.category||'Autre')}</span></td>
          <td class="${U.num(c.low)>0&&U.num(c.qty)<=U.num(c.low)?'warn-txt':''}" style="text-align:center;">
            <input type="number" step="1" value="${c.qty}" style="width:85px;text-align:center;" onchange="Stock.setConsoQty('${c.id}',this.value)"> ${U.esc(!c.unit || c.unit === 'pc' ? 'PCS' : c.unit)}</td>
          <td style="text-align:center;">${U.num(c.low)||'—'}</td>
          <td style="text-align:center;" class="sensitive"><div class="cost-split"><input type="number" step="0.01" value="${cTotal}" onchange="Stock.setConsoCost('${c.id}','costTotal',this.value)"><span class="cost-split-sep">/</span><input type="number" step="0.01" value="${cQper}" onchange="Stock.setConsoCost('${c.id}','costQtyPer',this.value)"></div></td>
          <td class="right">${Store.hideSupplierInfo() ? '' : `<button class="btn-icon" title="${c.url ? 'Ouvrir la page fournisseur' : 'Ajouter un lien fournisseur'}" onclick="Stock.openConsoLink('${c.id}')">${c.url ? '🔗' : '🔗＋'}</button>`}
            <button class="btn-icon" title="Dupliquer" onclick="Stock.dupConso('${c.id}')">📋</button>
            <button class="btn-ghost btn-sm" onclick="Stock.editConso('${c.id}')">Modifier</button>
            <button class="btn-icon" onclick="Stock.delConso('${c.id}')">🗑️</button></td></tr>`;}).join('')}
        </tbody></table></div></div>` : '<div class="card empty"><span class="big">📦</span>Aucun consommable.</div>'}`;
  },
  setConsoQty(id,val){
    const c=Store.state.consumables.find(x=>x.id===id); if(!c) return;
    const before=U.num(c.qty); c.qty=U.num(val);
    const entry = Store.log('ajustement',`Consommable ${c.name} : ${U.qty(before)} → ${U.qty(val)}`,{type:'setConsoQty',data:{id,before}});
    U.toast('Quantité mise à jour.', false, entry.id);
    Store.save('consumables');
  },
  setConsoCost(id, field, val) {
    const c = Store.state.consumables.find(x => x.id === id); if (!c) return;
    const snap = Store.snapshot('consumables', c);
    c[field] = U.num(val);
    const total = U.num(c.costTotal != null ? c.costTotal : c.costUnit);
    const qper = U.num(c.costQtyPer) || 1;
    c.costUnit = qper > 0 ? total / qper : 0;
    const entry = Store.commitSnapshot(snap, 'stock', 'Coût modifié — ' + c.name);
    U.toast('Coût mis à jour.', false, entry.id);
    Store.save('consumables'); App.rerender();
  },
  editConso(id){
    const S=Store.state.settings;
    const c=id?Store.state.consumables.find(x=>x.id===id):{id:U.uid(),name:'',category:S.consCategories[0],unit:'PCS',qty:0,low:0,costUnit:0};
    const isBl = c.category === 'Blisters';
    U.modal({
      title:id?'Modifier':'Nouveau consommable', okLabel:'Enregistrer',
      body:`<div class="frow">
        <div class="fg" style="flex:2;"><label>Nom</label><input id="c_name" value="${U.esc(c.name)}" placeholder="ex: Carton emballage"></div>
        <div class="fg" id="c_dim_wrap" style="${isBl?'display:none':''}"><label>Dimensions</label><input id="c_dim" value="${U.esc(c.dimensions||'')}" placeholder="ex: 20×15×10"></div>
        <div class="fg"><label>Catégorie</label><select id="c_cat" onchange="Stock._onConsoCatChange()">${S.consCategories.slice().sort(U.sortFr).map(x=>`<option ${c.category===x?'selected':''}>${U.esc(x)}</option>`).join('')}</select></div></div>
      <div id="c_blister_fields" style="display:${isBl?'':'none'};margin-bottom:8px;">
        <div class="frow">
          <div class="fg"><label>Largeur du rouleau (mm)</label><input id="c_bwidth" type="number" step="1" value="${c.blisterWidthMm||''}" placeholder="ex: 60"></div>
          <div class="fg"><label>Longueur du rouleau</label><input id="c_blen" value="${U.esc(c.blisterLength||'')}" placeholder="ex: 100m ou 5000cm"></div>
        </div>
        <p class="muted" style="margin:0;">Renseigne la largeur pour pré-remplir le nom et faciliter le lien avec les fiches prix.</p>
      </div>
      <div class="frow">
        <div class="fg"><label>Unité</label><input id="c_unit" value="${U.esc(isBl && !c.unit ? 'm' : (c.unit||'PCS'))}"></div>
        <div class="fg"><label>Quantité</label><input id="c_qty" type="number" step="1" value="${c.qty}"></div>
        <div class="fg"><label>Seuil</label><input id="c_low" type="number" step="1" value="${c.low}"></div>
      </div>
      <div class="frow" style="align-items:flex-end;">
        <div class="fg"><label>Prix d'achat (€)</label><input id="c_costTotal" type="number" step="0.01" value="${c.costTotal!=null?U.num(c.costTotal):U.num(c.costUnit)}" oninput="Stock._calcConsoUnit()"></div>
        <div class="fg"><label>Pour (qté achetée)</label><input id="c_costQty" type="number" step="0.01" min="0.01" value="${U.num(c.costQtyPer)||1}" oninput="Stock._calcConsoUnit()"></div>
        <div class="fg"><label>Coût unitaire</label><span id="c_costResult" style="display:block;padding:8px 0;font-weight:600;">${U.eur(c.costUnit,3)} /u</span></div>
      </div>
      <div class="fg"${Store.hideSupplierInfo() ? ' style="display:none;"' : ''}><label>Lien fournisseur (page produit, optionnel)</label><div style="display:flex;gap:6px;align-items:center;"><input id="c_url" value="${U.esc(c.url||'')}" placeholder="https://…" style="flex:1;"><button type="button" class="btn btn-sm" style="white-space:nowrap;" title="Ouvrir dans le navigateur" onclick="var u=document.getElementById('c_url').value.trim();if(u)window.open(u,'_blank','noopener');else U.toast('Aucun lien renseigné.',true);">🔗 Ouvrir</button></div></div>`,
      onOk:()=>{
        const snap = id ? Store.snapshot('consumables',c) : null;
        c.name=U.val('c_name').trim(); if(!c.name){U.toast('Nom obligatoire',true);return false;}
        c.dimensions=U.val('c_dim').trim();
        c.category=U.val('c_cat');c.unit=U.val('c_unit');c.qty=U.numVal('c_qty');c.low=U.numVal('c_low');
        c.costTotal=U.numVal('c_costTotal'); c.costQtyPer=Math.max(0.01,U.numVal('c_costQty'));
        c.costUnit=c.costTotal/c.costQtyPer;
        c.url=U.val('c_url').trim();
        if (c.category === 'Blisters') {
          c.blisterWidthMm = U.numVal('c_bwidth') || null;
          c.blisterLength = U.val('c_blen').trim() || null;
        }
        if(!id) Store.state.consumables.push(c);
        const entry = Store.log('stock',(id?'Consommable modifié':'Consommable créé')+' — '+c.name,
          id ? { type:'restoreItem', data:snap } : { type:'deleteCreated', data:{ domain:'consumables', id:c.id } });
        Store.save('consumables'); U.closeModal(); App.rerender();
        U.toast(id?'Modification enregistrée.':'Consommable créé.', false, entry.id);
      }
    });
  },
  _onConsoCatChange() {
    const cat = U.val('c_cat');
    const isBl = cat === 'Blisters';
    const bl = document.getElementById('c_blister_fields');
    const dw = document.getElementById('c_dim_wrap');
    if (bl) bl.style.display = isBl ? '' : 'none';
    if (dw) dw.style.display = isBl ? 'none' : '';
    if (isBl) {
      const unitEl = document.getElementById('c_unit');
      if (unitEl && unitEl.value === 'PCS') unitEl.value = 'm';
    }
  },
  dupConso(id) {
    const src = Store.state.consumables.find(x => x.id === id); if (!src) return;
    const dup = JSON.parse(JSON.stringify(src));
    dup.id = U.uid(); dup.qty = 0; dup.dimensions = '';
    Store.state.consumables.push(dup);
    const entry = Store.log('stock', 'Consommable dupliqué — ' + dup.name, { type: 'deleteCreated', data: { domain: 'consumables', id: dup.id } });
    Store.save('consumables'); App.rerender();
    U.toast('Consommable dupliqué.', false, entry.id);
    this.editConso(dup.id);
  },
  _dimVolume(dim) {
    if (!dim) return 0;
    const nums = dim.match(/[\d.,]+/g);
    if (!nums || !nums.length) return 0;
    return nums.reduce((a, n) => a * parseFloat(n.replace(',', '.')), 1);
  },
  _calcConsoUnit() {
    const total = U.numVal('c_costTotal'), qty = Math.max(1, U.numVal('c_costQty'));
    const unit = total / qty;
    const el = document.getElementById('c_costResult');
    if (el) el.textContent = U.eur(unit, 3) + ' /u';
  },
  delConso(id){
    if(!confirm('Supprimer ?')) return;
    const c=Store.state.consumables.find(x=>x.id===id); if(!c) return;
    const snap=Store.snapshot('consumables',c);
    Store.state.consumables=Store.state.consumables.filter(x=>x.id!==id);
    const entry=Store.commitSnapshot(snap,'stock','Consommable supprimé — '+c.name);
    Store.save('consumables'); App.rerender();
    U.toast('Consommable supprimé.', false, entry.id);
  },
  openConsoLink(id){
    const c=Store.state.consumables.find(x=>x.id===id); if(!c) return;
    if (Store.hideSupplierInfo()) return;
    if (c.url) window.open(c.url, '_blank', 'noopener');
    else this.editConso(id);
  },

  /* ───── MATIÈRES PREMIÈRES (accessoires : sangle, bouclerie…) ─────
     Même traitement que Mastication : en-tête triable, filtres (recherche/type/variantes),
     colonne catégorie centrée, réordonnancement, ajout de variante directement sur le groupe. */
  matFilters: { q: '', type: 'all', variants: [], variantsOpen: false, sort: 'name', sortDir: 'asc', link: 'all' },
  _matVariantsCache: [],
  /* Dérivé du référentiel éditable Store.materialKinds (sangle/bouclerie/autre + ajouts).
     Getter → reste utilisable partout en Stock.matKindLabel[kind] et Object.keys(...). */
  get matKindLabel() { const o = {}; Store.materialKinds().forEach(k => { o[k.value] = k.label; }); return o; },

  allMaterialVariantLabels() {
    return [...new Set(Store.state.materials.map(m => m.variant || m.name).filter(Boolean))].sort(U.sortFr);
  },

  renderMatieres() {
    const f = this.matFilters, kindLabel = this.matKindLabel;
    U.syncFilters('stock_matieres', f);
    const allVariants = this.allMaterialVariantLabels();
    this._matVariantsCache = allVariants;
    f.variants = f.variants.filter(v => allVariants.includes(v));

    const q = (f.q || '').toLowerCase();
    const list = Store.state.materials.filter(m => {
      if (q && !(m.name + ' ' + (m.product || '') + ' ' + (m.sku || '')).toLowerCase().includes(q)) return false;
      if (f.type !== 'all' && m.kind !== f.type) return false;
      if (f.variants.length && !f.variants.includes(m.variant || m.name)) return false;
      if (f.link === 'nourl' && m.url) return false;
      return true;
    });

    const groups = {};
    list.forEach(m => { const key = m.product || m.name; (groups[key] = groups[key] || []).push(m); });
    const dir = f.sortDir === 'desc' ? -1 : 1;
    const groupKeys = Object.keys(groups).sort((a, b) => {
      if (f.sort === 'name') return dir * U.sortFr(a, b);
      const ka = kindLabel[groups[a][0].kind] || groups[a][0].kind, kb = kindLabel[groups[b][0].kind] || groups[b][0].kind;
      return dir * U.sortFr(ka + a, kb + b);
    });
    const sortHead = (key, label) => `<span class="sortable ${f.sort === key ? 'active' : ''}" onclick="Stock.setMatSort('${key}')">${label} ${f.sort === key ? (f.sortDir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;

    document.getElementById('stockBody').innerHTML = `
      <div class="card" style="padding:12px 16px;">
        <div class="grid c4">
          <div class="fg mb0"><label>Recherche</label><input id="stock_q_mat" value="${U.esc(f.q)}" placeholder="🔍 nom, produit, SKU…" oninput="Stock.matFilters.q=this.value;Stock.renderMatieres();U.refocus('stock_q_mat')"></div>
          <div class="fg mb0"><label>Type</label>${U.customSelect({ value: f.type, options: [{ v: 'all', l: 'Tous' }].concat(Store.materialKinds().map(k => ({ v: k.value, l: k.label }))), onPick: 'Stock._setMatType' })}</div>
          <div class="fg mb0"><label>Variantes</label>${U.multiSelect({ options: allVariants, selected: f.variants, toggle: 'Stock.matToggleVariant', setAll: 'Stock.matSetAllVariant', open: f.variantsOpen, onOpen: 'Stock.matSetOpen' })}</div>
          <div class="fg mb0"><label>Lien fournisseur</label>${U.customSelect({ value: f.link, options: [{v:'all',l:'Tous'},{v:'nourl',l:'Sans lien fournisseur'}], onPick: 'Stock._setMatLink' })}</div>
        </div>
        <div class="frow mt" style="gap:6px;align-items:center;">
          <button class="btn-cta btn-sm" onclick="Stock.editMat()">＋ Nouvelle matière</button>
          <button class="btn-ghost btn-sm" onclick="Stock.foldAllMat(false)">▼ Tout déplier</button>
          <button class="btn-ghost btn-sm" onclick="Stock.foldAllMat(true)">▲ Tout réduire</button>
          <span class="muted" style="margin-left:auto;">${groupKeys.length} produit(s) · ${list.length} référence(s)</span>
        </div>
      </div>
      <div class="prod-list-header">
        <span>${sortHead('name', 'Nom du produit')}</span>
        <span>${sortHead('cat', 'Catégorie')}</span>
        <span class="meta">Stock</span>
        <span class="prod-actions">Actions</span>
      </div>
      ${groupKeys.map(key => this.materialGroupCard(key, groups[key])).join('') || '<div class="card empty"><span class="big">🧵</span>Aucune matière pour ces filtres.</div>'}`;
  },

  setMatSort(key) {
    if (this.matFilters.sort === key) this.matFilters.sortDir = this.matFilters.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.matFilters.sort = key; this.matFilters.sortDir = 'asc'; }
    this.renderMatieres();
  },
  matToggleVariant(name) { this._toggleIn(this.matFilters.variants, name); this.renderMatieres(); },
  matSetAllVariant(all) { this.matFilters.variants = all ? [...this._matVariantsCache] : []; this.renderMatieres(); },
  matSetOpen(open) { this.matFilters.variantsOpen = open; },

  materialGroupCard(key, items) {
    items = [...items].sort((a, b) => U.num(a.order) - U.num(b.order) || U.sortFr(a.variant || a.name, b.variant || b.name));
    const totalQty = items.reduce((a, m) => a + U.num(m.qty), 0);
    const hasAlert = items.some(m => U.num(m.low) > 0 && U.num(m.qty) <= U.num(m.low));
    const unit = items[0].unit === 'm' ? 'm' : 'PCS';
    const keyEsc = U.esc(key).replace(/&#39;/g, "\\'");
    const groupOpen = this._matGroupOpen[key] || false;
    return `<details class="fold prod-fold" ${groupOpen ? 'open' : ''} ontoggle="Stock.setMatGroupOpen('${keyEsc}',this.open)">
      <summary>
        <b>${U.esc(key)}</b>
        <span class="type-col">
          <span class="badge info">${this.matKindLabel[items[0].kind] || items[0].kind}</span>
          ${hasAlert ? '<span class="badge warn">Stock bas</span>' : ''}
        </span>
        <span class="meta">${items.length} référence(s) · ${U.qty(totalQty)} ${unit} au total</span>
        <span class="prod-actions">
          <button class="btn-icon" title="Renommer ce groupe" onclick="event.preventDefault();event.stopPropagation();Stock.editMatGroup('${keyEsc}')">✏️</button>
          <button class="btn-icon" title="Supprimer tout le groupe" onclick="event.preventDefault();event.stopPropagation();Stock.delMatGroup('${keyEsc}')">🗑️</button>
        </span>
      </summary>
      <div class="fold-body"><div class="table-wrap"><table class="mat-table">
        <thead><tr><th class="col-name">Variante</th><th>SKU</th><th>Coût / unité</th><th>En stock</th><th>Seuil</th><th></th></tr></thead>
        <tbody>${items.map((m, i) => this.materialRow(m, i, items)).join('')}</tbody>
      </table></div>
      <button class="btn-cta btn-sm mt" onclick="Stock.addMatVariant('${keyEsc}')">＋ Ajouter une variante</button>
      </div>
    </details>`;
  },

  /* Rouleaux (sangles) : suivi optionnel de plusieurs bobines distinctes pour une même largeur,
     sans DLUO (matière non périssable) — juste pour cumuler le stock de rouleaux différents
     (ex: un rouleau neuf de 30m + un rouleau entamé de 8,4m = 38,4m au total).
     m.qty reste la somme de référence utilisée partout ailleurs (seuils, BOM accessoires…) ;
     m.rolls n'est qu'un détail éditable, gardé en synchro avec m.qty à chaque modification. */
  _matRollsOpen: {},

  reconcileRolls(m) {
    if (!m.rolls || m.rolls.length < 2) return;
    const sum = m.rolls.reduce((a, r) => a + U.num(r.qty), 0);
    const drift = U.num(m.qty) - sum;
    if (Math.abs(drift) > 0.0001) m.rolls[m.rolls.length - 1].qty = Math.max(0, U.num(m.rolls[m.rolls.length - 1].qty) + drift);
  },

  materialRow(m, i, items) {
    const isSangle = m.kind === 'sangle';
    if (isSangle) this.reconcileRolls(m);
    const unit = m.unit === 'm' ? 'm' : 'PCS';
    const hasRolls = isSangle && m.rolls && m.rolls.length > 0;
    const multiRoll = hasRolls && m.rolls.length > 1;
    const rollsOpen = this._matRollsOpen[m.id] || false;
    const low = U.num(m.low), qty = U.num(m.qty);
    const label = U.esc(m.variant || m.name);
    const costTotal = m.costTotal != null ? U.num(m.costTotal) : U.num(m.costUnit);
    const costQtyPer = U.num(m.costQtyPer) || 1;

    const sortedRolls = (m.rolls || []).slice().sort((a, b) => {
      const ae = a.entame ? 1 : 0, be = b.entame ? 1 : 0;
      if (ae !== be) return be - ae;
      if (ae && be) return U.num(a.qty) - U.num(b.qty);
      return 0;
    });
    const rollsBox = (isSangle && rollsOpen) ? `<tr class="lots-row"><td colspan="6" style="padding:0;">
      <div class="lots-box">
        <div class="lots-box-title">Rouleaux pour ${label}</div>
        <div class="table-wrap"><table class="lots-table">
          <thead><tr><th>Rouleau</th><th style="width:90px;text-align:center;">Entamé</th><th class="num">Restant</th><th></th></tr></thead>
          <tbody>${sortedRolls.length ? sortedRolls.map(r => `<tr${r.entame ? ' style="background:rgba(201,122,26,0.08);"' : ''}>
              <td><input value="${U.esc(r.label || '')}" placeholder="ex: Sangle 1…" style="width:160px;" onchange="Stock.setMatRollField('${m.id}','${r.id}','label',this.value)"></td>
              <td style="text-align:center;"><input type="checkbox" ${r.entame ? 'checked' : ''} onchange="Stock.setMatRollField('${m.id}','${r.id}','entame',this.checked)"></td>
              <td class="num"><input type="number" step="0.01" value="${r.qty}" style="width:80px;" onchange="Stock.setMatRollField('${m.id}','${r.id}','qty',this.value)"> ${unit}</td>
              <td class="right"><button class="btn-icon" title="Supprimer ce rouleau" onclick="Stock.delMatRoll('${m.id}','${r.id}')">🗑️</button></td>
            </tr>`).join('') : '<tr><td colspan="4" class="muted">Aucun rouleau.</td></tr>'}</tbody>
        </table></div>
        <button class="btn-cta btn-sm mt" onclick="Stock.addMatRoll('${m.id}')">＋ Ajouter un rouleau</button>
      </div>
    </td></tr>` : '';

    return `<tr>
      <td class="col-name">${isSangle ? `<button class="btn-icon" title="${rollsOpen ? 'Replier' : 'Déplier'} les rouleaux" onclick="Stock.toggleMatRollsOpen('${m.id}')" style="margin-right:4px;">${rollsOpen ? '▾' : '▸'}</button>` : ''}${label}${multiRoll ? ` <span class="badge info" title="${m.rolls.length} rouleaux distincts">🧵 ${m.rolls.length} rouleaux</span>` : ''}</td>
      <td class="muted">${U.esc(m.sku || '—')}</td>
      <td class="sensitive"><div class="cost-split"><input type="number" step="0.01" value="${costTotal}" onchange="Stock.setMatCost('${m.id}','costTotal',this.value)"><span class="cost-split-sep">/</span><input type="number" step="0.01" value="${costQtyPer}" onchange="Stock.setMatCost('${m.id}','costQtyPer',this.value)"></div></td>
      <td class="${low > 0 && qty <= low ? 'warn-txt' : ''}">${hasRolls
        ? `<b>${U.qty(qty)}</b> ${unit}`
        : `<input type="number" step="0.01" value="${qty}" onchange="Stock.setMatField('${m.id}','qty',this.value)"> ${unit}`}</td>
      <td><input type="number" step="0.01" value="${low}" title="Seuil d'alerte" onchange="Stock.setMatField('${m.id}','low',this.value)"></td>
      <td class="right" style="white-space:nowrap;">
        ${Store.hideSupplierInfo() ? '' : `<button class="btn-icon" title="${m.url ? 'Ouvrir la page fournisseur' : 'Ajouter un lien fournisseur'}" onclick="Stock.openMatLink('${m.id}')">${m.url ? '🔗' : '🔗＋'}</button>`}
        <button class="btn-icon" title="Monter" ${i <= 0 ? 'disabled' : ''} onclick="Stock.moveMatVariant('${m.id}',-1)">↑</button>
        <button class="btn-icon" title="Descendre" ${i >= items.length - 1 ? 'disabled' : ''} onclick="Stock.moveMatVariant('${m.id}',1)">↓</button>
        <button class="btn-icon" title="Modifier" onclick="Stock.editMat('${m.id}')">✏️</button>
        <button class="btn-icon" title="Supprimer" onclick="Stock.delMat('${m.id}')">🗑️</button>
      </td>
    </tr>${rollsBox}`;
  },

  toggleMatRollsOpen(id) { this._matRollsOpen[id] = !this._matRollsOpen[id]; this.renderMatieres(); },

  addMatRoll(id) {
    const m = Store.state.materials.find(x => x.id === id); if (!m) return;
    const snap = Store.snapshot('materials', m);
    if (!m.rolls || !m.rolls.length) {
      m.rolls = [{ id: U.uid(), label: 'Sangle 1', qty: U.num(m.qty), entame: false }];
    } else {
      const num = m.rolls.length + 1;
      m.rolls.push({ id: U.uid(), label: 'Sangle ' + num, qty: 0, entame: false });
    }
    m.qty = m.rolls.reduce((a, r) => a + U.num(r.qty), 0);
    this._matRollsOpen[id] = true;
    const entry = Store.commitSnapshot(snap, 'stock', 'Rouleau ajouté — ' + (m.product ? m.product + ' ' : '') + (m.variant || m.name));
    Store.save('materials'); App.rerender();
    U.toast('Rouleau ajouté.', false, entry.id);
  },
  setMatRollField(mId, rId, field, val) {
    const m = Store.state.materials.find(x => x.id === mId); if (!m || !m.rolls) return;
    const r = m.rolls.find(x => x.id === rId); if (!r) return;
    const snap = Store.snapshot('materials', m);
    r[field] = field === 'qty' ? U.num(val) : field === 'entame' ? !!val : val;
    m.qty = m.rolls.reduce((a, x) => a + U.num(x.qty), 0);
    const entry = Store.commitSnapshot(snap, 'stock', 'Rouleau modifié — ' + (m.product ? m.product + ' ' : '') + (m.variant || m.name));
    U.toast('Rouleau mis à jour.', false, entry.id);
    Store.save('materials'); App.rerender();
  },
  delMatRoll(mId, rId) {
    const m = Store.state.materials.find(x => x.id === mId); if (!m || !m.rolls) return;
    const isLast = m.rolls.length <= 1;
    if (!confirm(isLast ? 'Supprimer le dernier rouleau et revenir au champ simple ?' : 'Supprimer ce rouleau ?')) return;
    const snap = Store.snapshot('materials', m);
    if (isLast) {
      const r = m.rolls.find(x => x.id === rId);
      m.qty = r ? U.num(r.qty) : 0;
      m.rolls = [];
    } else {
      m.rolls = m.rolls.filter(x => x.id !== rId);
      m.rolls.forEach((r, i) => { r.label = 'Sangle ' + (i + 1); });
      m.qty = m.rolls.reduce((a, x) => a + U.num(x.qty), 0);
    }
    const entry = Store.commitSnapshot(snap, 'stock', 'Rouleau supprimé — ' + (m.product ? m.product + ' ' : '') + (m.variant || m.name));
    U.toast('Rouleau supprimé.', false, entry.id);
    Store.save('materials'); App.rerender();
  },

  setMatCost(id, field, val) {
    const m = Store.state.materials.find(x => x.id === id); if (!m) return;
    const snap = Store.snapshot('materials', m);
    m[field] = U.num(val);
    const total = U.num(m.costTotal != null ? m.costTotal : m.costUnit);
    const qper = U.num(m.costQtyPer) || 1;
    m.costUnit = qper > 0 ? total / qper : 0;
    const entry = Store.commitSnapshot(snap, 'stock', 'Coût modifié — ' + (m.product ? m.product + ' ' : '') + (m.variant || m.name));
    U.toast('Coût mis à jour.', false, entry.id);
    Store.save('materials'); App.rerender();
  },

  setMatField(id, field, val) {
    const m = Store.state.materials.find(x => x.id === id); if (!m) return;
    const snap = Store.snapshot('materials', m);
    m[field] = U.num(val);
    if (field === 'qty' && m.rolls && m.rolls.length === 1) m.rolls[0].qty = m.qty;
    const entry = Store.commitSnapshot(snap, 'stock', 'Matière modifiée — ' + (m.product ? m.product + ' ' : '') + (m.variant || m.name));
    U.toast('Mise à jour enregistrée.', false, entry.id);
    Store.save('materials');
  },

  moveMatVariant(id, dir) {
    const m = Store.state.materials.find(x => x.id === id); if (!m) return;
    const key = m.product || m.name;
    const group = Store.state.materials.filter(x => (x.product || x.name) === key)
      .sort((a, b) => U.num(a.order) - U.num(b.order) || U.sortFr(a.variant || a.name, b.variant || b.name));
    group.forEach((x, i) => { if (x.order === undefined || x.order === null) x.order = i; });
    const i = group.findIndex(x => x.id === id);
    const j = i + dir; if (j < 0 || j >= group.length) return;
    const tmp = group[i].order; group[i].order = group[j].order; group[j].order = tmp;
    Store.save('materials'); App.rerender();
  },

  addMatVariant(product) { this.editMat(null, product); },

  editMat(id, presetProduct) {
    const ref = presetProduct ? Store.state.materials.find(x => (x.product || x.name) === presetProduct) : null;
    const m = id ? Store.state.materials.find(x => x.id === id)
      : { id: U.uid(), product: presetProduct || '', variant: '', name: '', kind: ref?.kind || 'sangle', unit: ref?.unit || 'm', sku: '', costUnit: '', qty: 0, low: 0 };
    U.modal({
      title: id ? 'Modifier la matière' : (presetProduct ? '＋ Variante — ' + U.esc(presetProduct) : 'Nouvelle matière'), okLabel: 'Enregistrer',
      body: `
      <div class="frow">
        <div class="fg"><label>Produit (regroupe les variantes, optionnel)</label><input id="m_product" value="${U.esc(m.product || '')}" placeholder="ex: Noir" ${presetProduct ? 'readonly' : ''}></div>
        <div class="fg"><label>Variante</label><input id="m_variant" value="${U.esc(m.variant || (m.product ? '' : m.name) || '')}" placeholder="ex: 10mm"></div>
      </div>
      <div class="frow">
        <div class="fg"><label>Type</label><select id="m_kind">
          ${Store.materialKinds().map(k => `<option value="${U.esc(k.value)}" ${m.kind === k.value ? 'selected' : ''}>${U.esc(k.label)}${k.value === 'sangle' ? ' (rouleaux)' : ''}</option>`).join('')}</select></div>
        <div class="fg"><label>Unité</label><select id="m_unit">
          <option value="m" ${m.unit === 'm' ? 'selected' : ''}>mètre</option>
          <option value="piece" ${m.unit === 'piece' ? 'selected' : ''}>pièce</option></select></div>
      </div>
      <div class="frow">
        <div class="fg"><label>SKU</label><input id="m_sku" value="${U.esc(m.sku || '')}"></div>
        <div class="fg"><label>Coût par unité (€ HT, port incl.)</label><input id="m_cost" type="number" step="0.001" value="${m.costUnit}"></div>
      </div>
      <div class="frow">
        <div class="fg"><label>Quantité en stock</label><input id="m_qty" type="number" step="0.01" value="${m.qty}"></div>
        <div class="fg"><label>Seuil d'alerte</label><input id="m_low" type="number" step="0.01" value="${m.low}"></div>
      </div>
      <div class="fg"${Store.hideSupplierInfo() ? ' style="display:none;"' : ''}><label>Lien fournisseur (page produit, optionnel)</label><div style="display:flex;gap:6px;align-items:center;"><input id="m_url" value="${U.esc(m.url || '')}" placeholder="https://…" style="flex:1;"><button type="button" class="btn btn-sm" style="white-space:nowrap;" title="Ouvrir dans le navigateur" onclick="var u=document.getElementById('m_url').value.trim();if(u)window.open(u,'_blank','noopener');else U.toast('Aucun lien renseigné.',true);">🔗 Ouvrir</button></div></div>`,
      onOk: () => {
        const snap = id ? Store.snapshot('materials', m) : null;
        const product = U.val('m_product').trim(), variant = U.val('m_variant').trim();
        if (!variant) { U.toast('Indique au moins la variante (ou le nom si pas de produit).', true); return false; }
        m.product = product; m.variant = product ? variant : '';
        m.name = product ? (product + ' ' + variant).trim() : variant;
        m.kind = U.val('m_kind'); m.unit = U.val('m_unit');
        m.sku = U.val('m_sku') || Pricing.autoSkuMat(m.name, m.kind, m.variant);
        m.costUnit = U.numVal('m_cost'); m.qty = U.numVal('m_qty'); m.low = U.numVal('m_low');
        m.url = U.val('m_url').trim();
        if (!id) Store.state.materials.push(m);
        const entry = Store.log('stock', (id ? 'Matière modifiée' : 'Matière créée') + ' — ' + m.name,
          id ? { type:'restoreItem', data:snap } : { type:'deleteCreated', data:{ domain:'materials', id:m.id } });
        Store.save('materials'); U.closeModal(); App.rerender();
        U.toast(id?'Modification enregistrée.':'Matière créée.', false, entry.id);
      }
    });
  },
  delMat(id) {
    const used = Store.state.catalogA.some(a => (a.bom || []).some(l => l.materialId === id));
    if (used) { U.toast('Impossible : cette matière est utilisée dans une fiche accessoire.', true); return; }
    const m = Store.state.materials.find(x => x.id === id); if (!m) return;
    if (!confirm('Supprimer cette matière ?')) return;
    const snap = Store.snapshot('materials', m);
    Store.state.materials = Store.state.materials.filter(x => x.id !== id);
    const entry = Store.commitSnapshot(snap, 'stock', 'Matière supprimée — ' + m.name);
    Store.save('materials'); App.rerender();
    U.toast('Matière supprimée.', false, entry.id);
  },

  editMatGroup(key) {
    const items = Store.state.materials.filter(m => (m.product || m.name) === key);
    if (!items.length) return;
    U.modal({
      title: '✏️ Renommer le groupe', okLabel: 'Renommer',
      body: `<div class="fg"><label>Nom du groupe</label><input id="mg_name" value="${U.esc(key)}" autofocus></div>`,
      onOk: () => {
        const newName = U.val('mg_name').trim();
        if (!newName) { U.toast('Le nom ne peut pas être vide.', true); return false; }
        if (newName === key) return;
        const snaps = items.map(m => Store.snapshot('materials', m));
        items.forEach(m => {
          m.product = newName;
          m.name = (newName + ' ' + (m.variant || '')).trim();
        });
        Store.log('stock', `Groupe matière renommé : ${key} → ${newName}`);
        Store.save('materials'); U.closeModal(); App.rerender();
        U.toast('Groupe renommé.');
      }
    });
  },

  delMatGroup(key) {
    const items = Store.state.materials.filter(m => (m.product || m.name) === key);
    if (!items.length) return;
    const usedIds = items.filter(m => Store.state.catalogA.some(a => (a.bom || []).some(l => l.materialId === m.id)));
    if (usedIds.length) { U.toast('Impossible : certaines matières de ce groupe sont utilisées dans des fiches accessoires.', true); return; }
    if (!confirm(`Supprimer le groupe "${key}" et ses ${items.length} matière(s) ?`)) return;
    const snaps = items.map(m => Store.snapshot('materials', m));
    Store.state.materials = Store.state.materials.filter(m => (m.product || m.name) !== key);
    snaps.forEach(s => Store.commitSnapshot(s, 'stock', 'Matière supprimée (groupe) — ' + s.item.name));
    Store.save('materials'); App.rerender();
    U.toast('Groupe supprimé.');
  },

  openMatLink(id) {
    const m=Store.state.materials.find(x=>x.id===id); if(!m) return;
    if (Store.hideSupplierInfo()) return;
    if (m.url) window.open(m.url, '_blank', 'noopener');
    else this.editMat(id);
  }
};
