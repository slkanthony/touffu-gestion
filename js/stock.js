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

  perem: { q: '', meat: 'all', variants: [], variantsOpen: false, view: 'general', horizon: '3', excluded: [], sort: 'days', sortDir: 'asc' },
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
      <div class="tabs-seg">
        ${U.seg([
          ['mastication', '🥩', 'Mastication (' + Store.state.stockM.length + ')'],
          ['matieres', '🧵', 'Matières premières (' + Store.state.materials.length + ')'],
          ['accessoires', '🐕', 'Accessoires (' + Store.state.catalogA.length + ')'],
          ['conso', '📦', 'Consommables (' + Store.state.consumables.length + ')'],
          ['peremptions', '⏳', 'Péremptions'],
          ['faible', '📉', 'Faible stock']
        ].map(([id, ico, label]) => ({ l: `${ico} ${label}`, on: this.tab === id, href: `#/stock/${id}`, js: `if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&event.button!==1){event.preventDefault();Stock.tab='${id}';Stock.render();}` })), { full: true, scroll: true, label: 'Stock' })}
      </div>
      <div id="stockBody"></div>`);
    if (this.tab === 'mastication') this.renderM();
    else if (this.tab === 'conso') this.renderConso();
    else if (this.tab === 'matieres') this.renderMatieres();
    else if (this.tab === 'accessoires') this.renderAccessoires();
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
    { value: 'reminder', label: 'Rappels (pense-bête)',       badge: 'warn', icon: '🔔' },
    { value: 'nourl',    label: 'Sans lien site Touffu',      badge: 'info', icon: '🔗' },
    { value: 'nocat',    label: 'Sans lien catalogue prix',   badge: 'info', icon: '💰' },
    { value: 'hascat',   label: 'Lié au catalogue prix',      badge: 'ok',   icon: '💰' },
  ],
  /* Compte lecture seule (viewer) : produits/lots expirés jamais montrés (2026-09-26). */
  _hideExpired() { return !!(window.App && App.isViewer); },
  dluoFilterHTML(current, setter) {
    const opts = this._dluoOptions.filter(o => !(this._hideExpired() && o.value === 'expired'));
    const cur = opts.find(o => o.value === current) || opts[0];
    const curLabel = cur.badge ? `<span class="badge ${cur.badge}">${cur.icon} ${cur.label}</span>` : cur.label;
    return `<details class="multiselect dluo-filter" ${this._dluoFilterOpen ? 'open' : ''} ontoggle="Stock._dluoFilterOpen=this.open">
      <summary>${curLabel}</summary>
      <div class="multiselect-panel">
        ${opts.map(o => {
          const lb = o.badge ? `<span class="badge ${o.badge}">${o.icon} ${o.label}</span>` : o.label;
          return `<div class="dluo-opt${o.value===current?' active':''}" onclick="${setter}('${o.value}')">${lb}</div>`;
        }).join('')}
      </div>
    </details>`;
  },
  _dluoFilterOpen: false,
  _meatFilterOpen: false,
  _setMeatFilter(val) { this.filters.meat = val; this._meatFilterOpen = false; this.renderM(); },
  _peremMeatOpen: false,
  _setPeremMeat(val) { this.perem.meat = val; this._peremMeatOpen = false; this.renderPeremptions(); },
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
  _setConsoCat(val) { this.consoFilters.cat = val; this.renderConso(); },
  _setConsoState(val) { this.consoFilters.state = val; this.renderConso(); },
  _setMatType(val) { this.matFilters.type = val; this.renderMatieres(); },
  _setMatLink(val) { this.matFilters.link = val; this.renderMatieres(); },
  _setMatState(val) { this.matFilters.state = val; this.renderMatieres(); },
  /* Filtres de Stock → Matières : « À compléter » (fiches incomplètes) et « État du stock ». Un test = une fonction (matière → booléen) ; les compteurs du menu
     utilisent les mêmes fonctions que le filtrage. Rouleaux : seulement les catégories sangle. */
  _matTests() {
    const sangle = m => Store.isSangleKind(m.kind), nRolls = m => sangle(m) && m.rolls ? m.rolls.length : 0;
    return {
      todoLabel: { nourl: 'Sans lien fournisseur', noref: 'Sans réf. fournisseur', noboth: 'Sans lien ni réf.', nocost: 'Sans prix d\'achat', nosku: 'Sans SKU' },
      supplierOnly: ['nourl', 'noref', 'noboth'],
      todo: {
        nourl: m => !m.url, noref: m => !String(m.ref || '').trim(), noboth: m => !m.url && !String(m.ref || '').trim(),
        nocost: m => !(U.num(m.costUnit) > 0), nosku: m => !String(m.sku || '').trim()
      },
      stateLabel: { low: '⚠️ Stock bas', out: 'Rupture', multi: '🧵 Plusieurs rouleaux', entame: 'Rouleau entamé' },
      state: {
        low: m => U.num(m.low) > 0 && U.num(m.qty) <= U.num(m.low), out: m => U.num(m.qty) <= 0,
        multi: m => nRolls(m) > 1, entame: m => nRolls(m) > 0 && m.rolls.some(r => r.entame)
      }
    };
  },

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

    // Une seule fois : prix TTC arrondis à 0,10 € dans les fiches → on recopie sur les variantes reliées (7,69 → 7,70).
    if (!(window.App && (App.isViewer || App.isTeam)) && Store.state.meta && !Store.state.meta.roundSync1) {
      Store.state.meta.roundSync1 = true;
      const ids = new Set(); Store.state.stockM.forEach(p => p.variants.forEach(v => { const id = this.ficheOf(p, v); if (id) ids.add(id); }));
      ids.forEach(id => { try { this.syncPricesFromCatalog(id); } catch (e) {} });
      Store.save('meta'); Store.save('stockM');
    }
    // Produit à UNE seule variante reliée à une fiche prix : le produit est relié à la même fiche (rattrape l'existant).
    { let fixed = false;
      Store.state.stockM.forEach(p => {
        if (p.variants.length !== 1 || (p.catalogId && Store.state.catalogM.some(c => c.id === p.catalogId))) return;
        const cid = p.variants[0].catalogId;
        if (cid && Store.state.catalogM.some(c => c.id === cid)) { p.catalogId = cid; fixed = true; }
      });
      if (fixed) Store.save('stockM'); }
    const list = Store.state.stockM.filter(p => {
      if (f.q && !U.has(p.name, f.q)) return false;
      if (f.meat !== 'all' && (p.meatType || '').toLowerCase() !== f.meat.toLowerCase()) return false;
      if (f.variants.length && !p.variants.some(v => f.variants.includes(Pricing.labelVariant(v)))) return false;
      if (f.dluo === 'expired' && this._hideExpired()) return true;
      if (f.dluo === 'expired') return p.variants.some(v => v.lots.some(l => { const d = U.daysTo(l.dluo); return d !== null && d < 0 && (U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0; }));
      if (f.dluo === 'soon') return p.variants.some(v => v.lots.some(l => { const d = U.daysTo(l.dluo); return d !== null && d >= 0 && d <= U.num(S.dluoAlertDays) && (U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0; }));
      if (f.dluo === 'low') return p.variants.some(v => { const qg = v.lots.reduce((a,l)=>a+U.num(l.qtyGeneral),0); return U.num(v.low)>0 && qg<=U.num(v.low); });
      if (f.dluo === 'multilot') return p.variants.some(v => new Set(v.lots.filter(l => (U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0).map(l => (l.lotNumber||'').trim()).filter(Boolean)).size >= 2);
      if (f.dluo === 'reminder') return p.variants.some(v => v.lots.some(l => l.reminder && l.reminder.date));
      if (f.dluo === 'nourl') return !p.url;
      if (f.dluo === 'nocat') return !this.productHasFiche(p);
      if (f.dluo === 'hascat') return this.productHasFiche(p);
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
          ${U.seg([{ l: '▼ Tout déplier', js: 'Stock.foldAll(false)' }, { l: '▲ Tout réduire', js: 'Stock.foldAll(true)' }], { sm: true })}
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

  /* Fiche prix d'une variante : la sienne, sinon celle de sa taille (déclinaison), sinon celle du produit. */
  ficheOf(p, v) {
    const ok = id => id && Store.state.catalogM.some(c => c.id === id) ? id : '';
    const par = this.parentOf(p, v);
    return ok(v.catalogId) || (par && ok(par.catalogId)) || ok(p.catalogId) || '';
  },
  /* Produit « lié » = TOUTES ses variantes ont une fiche prix (au niveau produit ou variante par variante). */
  productHasFiche(p) {
    if (!p.variants.length) return !!(p.catalogId && Store.state.catalogM.some(c => c.id === p.catalogId));
    return p.variants.every(v => this.ficheOf(p, v));
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
    const hasAlert = !this._hideExpired() && p.variants.some(v => v.lots.some(l => { const d=U.daysTo(l.dluo); return d!==null&&d<0&&(U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0; }));
    const hasSoon = !hasAlert && p.variants.some(v => v.lots.some(l => { const d=U.daysTo(l.dluo); const S=Store.state.settings; return d!==null&&d>=0&&d<=U.num(S.dluoAlertDays)&&(U.num(l.qtyGeneral)+U.num(l.qtyEvent))>0; }));

    // filtre variantes selon le filtre actif (multi-sélection)
    const f = this.filters;
    const ordered = this.orderedVariants(p);
    const vars = f.variants.length ? ordered.filter(v => f.variants.includes(Pricing.labelVariant(v))) : ordered;
    const varRows = vars.map(v => this.variantRow(p, v)).join('');
    const nv = p.variants.filter(v => v.mode !== 'vrac').length;

    return `<details class="fold prod-fold" id="prod-${p.id}" ${prodOpen ? 'open' : ''} ontoggle="Stock.setProdOpen('${p.id}',this.open)">
      <summary onclick="Stock.summaryNav(event,'${p.id}')" onauxclick="Stock.summaryNav(event,'${p.id}')" title="Clic molette / Ctrl+clic : ouvrir la fiche dans un nouvel onglet">
        <b>${U.esc(p.name)}</b>
        <span>
          ${hasAlert ? '<span class="badge bad">⚠ Lot(s) périmé(s)</span>' : hasSoon ? '<span class="badge warn">⏳ DLUO proche</span>' : ''}
          ${hasAnyCatLink ? (() => { const fid = (cat && cat.id) || (p.variants.map(v => this.ficheOf(p, v)).find(Boolean)) || ''; return `<a class="badge ok" href="#/catalogue/edit/${fid}" onclick="event.stopPropagation()" title="Lié au catalogue prix — clic : ouvrir la fiche" style="text-decoration:none;">💰</a>`; })() : ''}
        </span>
        <span class="type-col">
          <span class="badge info">${U.esc(p.meatType||'—')}</span>
        </span>
        ${p.variants.some(v => v.lots.some(l => this.reminderDue(l))) ? '<span class="badge warn" title="Un rappel (pense-bête) est arrivé à échéance sur un lot">🔔 Rappel</span>' : ''}
        <span class="meta"><b>${totalG+totalE}</b> unités · gén <b>${totalG}</b> · évén <b>${totalE}</b> · <span class="muted">${nv} variante(s)</span></span>
        <span class="prod-actions act-grid"><span class="act-row">
          ${Store.hideSupplierInfo() ? '' : `<button class="btn-icon" title="${p.url ? 'Ouvrir la page sur le site Touffu' : 'Ajouter le lien site Touffu'}" onclick="event.preventDefault();event.stopPropagation();Stock.openProductLink('${p.id}')">${p.url ? '🔗' : '🔗＋'}</button>`}
          ${cat ? `<button class="btn-icon" title="Resynchroniser prix/variantes depuis le catalogue (ex: une taille ajoutée côté calcul de prix après coup)" onclick="event.preventDefault();event.stopPropagation();Stock.resyncFromCatalog('${p.id}')">🔄</button>` : `<button class="btn-icon" title="Créer la fiche de calcul de prix à partir de ce produit (reprend nom, viande et conditionnement — tu complètes fournisseur et prix)" onclick="event.preventDefault();event.stopPropagation();Stock.createCatalogFromStock('${p.id}')">📋</button>`}
          <button class="btn-icon" title="Dupliquer le produit (mêmes formats, sans stock ni SKU) — pour créer un autre produit à partir de celui-ci" onclick="event.preventDefault();event.stopPropagation();Stock.dupProduct('${p.id}')">📑</button>
          </span><span class="act-row">
          <button class="btn-ghost btn-sm" title="Modifier le produit" onclick="event.preventDefault();event.stopPropagation();Stock.editProduct('${p.id}')">Modifier</button>
          <button class="btn-icon" title="Supprimer le produit" onclick="event.preventDefault();event.stopPropagation();Stock.delProduct('${p.id}')">🗑️</button>
        </span></span>
      </summary>
      <div class="fold-body">
        <div class="table-wrap"><table>
          <thead><tr>
            <th class="col-name var-cell" style="padding-left:52px;">Variante</th><th>SKU</th>
            <th class="num">Min gén.</th><th class="num">Min évén.</th>
            <th class="num">Stock gén.</th><th class="num">Stock évén.</th><th class="num">Total</th>
            <th class="num" title="Fiche Prix mastication (frais de port d'achat estimés inclus) — indicatif">Prix achat</th><th class="num" title="Fiche Prix mastication — indicatif">Prix vente</th>
            <th class="num">Nb lots</th>
            <th></th>
          </tr></thead>
          <tbody>${varRows || '<tr><td colspan="11" class="muted">Aucune variante.</td></tr>'}</tbody>
        </table></div>
        <button class="btn-cta btn-sm mt" onclick="Stock.addVariant('${p.id}')">＋ Ajouter une variante</button>
      </div></details>`;
  },

  variantRow(p, v) {
    // Viewer : les lots expirés ne sont jamais affichés (ni lots, ni badges « périmé »).
    const lots = [...v.lots].filter(l => !this._hideExpired() || !(U.daysTo(l.dluo) < 0)).sort((a,b)=>(a.dluo||'9999').localeCompare(b.dluo||'9999'));
    const qg = lots.reduce((a,l)=>a+U.num(l.qtyGeneral),0);
    const qe = lots.reduce((a,l)=>a+U.num(l.qtyEvent),0);
    const isVrac = v.mode === 'vrac';
    const low = U.num(v.low); const lowE = U.num(v.lowEvent);
    const lowCls = low>0&&qg<=low?'warn-txt':'';
    const label = Pricing.labelVariant(v);
    const par = this.parentOf(p, v);
    const sib = p.variants.filter(x => (this.parentOf(p, x)?.id || '') === (par ? par.id : ''));
    const vi = sib.indexOf(v);
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
              <td class="col-name l-no"><span class="tag">${U.esc(l.lotNumber||'sans n°')}</span></td>
              <td class="l-dl" ondblclick="Stock.editReminder('${p.id}','${v.id}','${l.id}')" title="Double-clic : ajouter / modifier un rappel (pense-bête)" style="cursor:pointer;">${l.dluo?U.dluoTag(l.dluo):'<span class="muted">—</span>'}${this.reminderTag(l)}</td>
              <td class="num l-g"><input type="number" step="${isVrac?'0.001':'1'}" min="0" value="${l.qtyGeneral}" style="width:80px;" onchange="Stock.setLotQty('${p.id}','${v.id}','${l.id}','qtyGeneral',this.value)"></td>
              <td class="right l-tr" style="white-space:nowrap;">
                <button class="btn-transfer" style="background:var(--ok);" title="Transférer vers Événement" onclick="Stock.transferLot('${p.id}','${v.id}','${l.id}','ge')">→</button>
                <button class="btn-transfer" style="background:#3b6fa0;" title="Retour vers Stock Général" onclick="Stock.transferLot('${p.id}','${v.id}','${l.id}','eg')">←</button>
              </td>
              <td class="num l-e"><input type="number" step="${isVrac?'0.001':'1'}" min="0" value="${l.qtyEvent}" style="width:80px;" onchange="Stock.setLotQty('${p.id}','${v.id}','${l.id}','qtyEvent',this.value)"></td>
              <td class="num muted l-tot">${U.qty(tot)}</td>
              <td class="right l-act"><div class="act-grid"><span class="act-row">
                ${isVrac?`<button class="btn-ghost btn-sm" onclick="Stock.conditionner('${p.id}','${v.id}','${l.id}')">🎁 Conditionner</button>`:''}
                ${l.pack ? `<span class="tag" title="Conditionné le ${U.esc(U.frDate(l.pack.date))} : ${l.pack.qty} × ${U.esc(l.pack.name)} ${U.esc(l.pack.dims||'')} (${U.eur(l.pack.unitCost)}/u)">📦 ${U.esc(l.pack.dims||l.pack.name)}</span>` : `<button class="btn-icon" title="Indiquer le sachet utilisé pour ce lot" onclick="Stock.packLot('${p.id}','${v.id}','${l.id}')">📦</button>`}
                </span><span class="act-row">
                <button class="btn-ghost btn-sm" title="Modifier le lot" onclick="Stock.editLot('${p.id}','${v.id}','${l.id}')">Modifier</button>
                <button class="btn-icon" title="Supprimer le lot" onclick="Stock.delLot('${p.id}','${v.id}','${l.id}')">🗑️</button>
              </span></div></td></tr>`;
          }).join('') : '<tr><td colspan="7" class="muted">Aucun lot pour le moment.</td></tr>'}</tbody>
        </table></div>
        <button class="btn-cta btn-sm mt" onclick="Stock.addLot('${p.id}','${v.id}')">＋ Ajouter un lot</button>
      </div>
    </td></tr>`;

    if (this.isVirtual(p, v)) {
      const vq = this.virtualQty(p, v);
      return `<tr class="virt-row">
      <td class="col-name var-cell"><div class="vc"><span class="vc-ind"><span class="muted" title="Déclinaison sans stock propre de ${U.esc(Pricing.labelVariant(vq.par))}">↳</span></span><span style="width:22px;display:inline-block;"></span><b class="vc-name">${U.esc(label)}</b><span class="vc-badges"> <span class="badge info" style="font-size:.65rem;cursor:help;" title="Pas de stock propre : chaque vente retire ${vq.n} pièces de ${U.esc(Pricing.labelVariant(vq.par))}. Stock affiché = stock de ${U.esc(Pricing.labelVariant(vq.par))} ÷ ${vq.n}.">pris sur ${U.esc(Pricing.labelVariant(vq.par))} ÷ ${vq.n}</span>${!v.catalogVariantId ? ` <span class="badge warn" style="font-size:.65rem;cursor:help;" title="La fiche prix n'a pas de ligne « Lot de ${vq.n} pc » (prix du lot à saisir ici)">⚠ prix non lié</span>` : ''}</span></div></td>
      <td class="v-sku"><div class="sku-cell"><input value="${U.esc(v.sku||'')}" placeholder="SKU" title="${U.esc(v.sku||'SKU du lot')}" class="sku-input" onchange="Stock.setVarSku('${p.id}','${v.id}',this.value)">${v.sku ? '' : `<button class="btn-icon sku-gen" title="Générer le SKU automatiquement" onclick="Stock.proposeSku('${p.id}','${v.id}')">✨</button>`}</div></td>
      <td class="num muted v-ming" title="Les alertes de stock bas sont sur la variante principale">—</td>
      <td class="num muted v-mine" title="Les alertes de stock bas sont sur la variante principale">—</td>
      <td class="num v-stg" title="Lots disponibles en stock général (calculé)"><b>${U.qty(vq.g)}</b> <span class="muted" style="font-size:.72rem;">lots</span></td>
      <td class="num v-ste" title="Lots disponibles en stock événement (calculé)">${U.qty(vq.e)} <span class="muted" style="font-size:.72rem;">lots</span></td>
      <td class="num muted v-tot" title="Lots disponibles au total (calculé)"><b>${U.qty(vq.t)}</b></td>
      <td class="num sensitive muted v-pa" title="Coût d'un lot = coût de la pièce × ${vq.n} (fiche Prix mastication, frais de port d'achat estimés inclus)">${U.eur((this.refCalc(p, vq.par) ? this.refCalc(p, vq.par).calc.cost : U.num(vq.par.costUnit)) * vq.n)}</td>
      ${this._refPriceCell(p, v, 'Prix de vente TTC du lot')}
      <td class="num muted v-nb">—</td>
      <td class="right v-act"><div class="act-grid"><span class="act-row">
        <button class="btn-icon" title="Monter" ${vi<=0?'disabled':''} onclick="Stock.moveVariant('${p.id}','${v.id}',-1)">↑</button>
        <button class="btn-icon" title="Descendre" ${vi>=sib.length-1?'disabled':''} onclick="Stock.moveVariant('${p.id}','${v.id}',1)">↓</button>
        </span><span class="act-row">
        <button class="btn-ghost btn-sm" onclick="Stock.editVariant('${p.id}','${v.id}')">Modifier</button>
        <button class="btn-icon" title="Supprimer" onclick="Stock.delVariant('${p.id}','${v.id}')">🗑️</button>
      </span></div></td></tr>`;
    }
    return `<tr>
      <td class="col-name var-cell"><div class="vc"><span class="vc-ind">${par ? `<span class="muted" title="Déclinaison de ${U.esc(Pricing.labelVariant(par))} — fiche prix et tags hérités" style="cursor:help;">↳</span>` : ''}</span><button class="btn-icon" title="${open?'Replier':'Déplier'} les lots" onclick="Stock.toggleLotsOpen('${v.id}',${open})" style="margin:0;">${open?'▾':'▸'}</button><b class="vc-name">${U.esc(label)}</b><span class="vc-badges">${par && !v.catalogVariantId ? ` <span class="badge warn" style="font-size:.65rem;cursor:help;" title="${(par.catalogId||p.catalogId) ? `La fiche prix de ${U.esc(Pricing.labelVariant(par))} n'a pas de ligne « Lot de ${this.packQtyOf(v)} pc »` : `${U.esc(Pricing.labelVariant(par))} n'est liée à aucune fiche prix`}">⚠ prix non lié</span>` : ''}${isVrac?` <span class="badge info">vrac</span>`:''}${vDluoBadge}${v.catalogId ? (() => { const lc = Store.state.catalogM.find(c=>c.id===v.catalogId); return lc ? ` <a class="badge pk-link" href="#/catalogue/edit/${lc.id}" onclick="event.stopPropagation()" title="Lié à : ${U.esc(lc.name)} — clic : ouvrir la fiche" style="font-size:.65rem;background:var(--caramel);color:#fff;text-decoration:none;">💰</a>` : ''; })() : ''}${(() => { const u = this.usualPack(v); return u ? ` <span class="badge info" style="font-size:.65rem;cursor:help;" title="Sachet habituel : ${U.esc(u.name)} ${U.esc(u.dims)} — utilisé ${u.n} fois sur ${u.total} conditionnement(s)">📦 ${U.esc(u.dims || u.name)}</span>` : ''; })()}</span></div></td>
      <td class="v-sku"><div class="sku-cell"><input value="${U.esc(v.sku||'')}" placeholder="SKU" title="${U.esc(v.sku||'SKU — lien WooCommerce ↔ calcul de prix')}" class="sku-input" onchange="Stock.setVarSku('${p.id}','${v.id}',this.value)">${v.sku ? '' : `<button class="btn-icon sku-gen" title="Générer le SKU automatiquement" onclick="Stock.proposeSku('${p.id}','${v.id}')">✨</button>`}</div></td>
      <td class="num v-ming"><div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;"><input type="number" step="1" value="${low}" style="width:60px;" title="Stock min général" onchange="Stock.setVarMin('${p.id}','${v.id}','low',this.value)"><span style="font-size:.8rem;" aria-hidden="true">🛒</span><input type="checkbox" ${this.reorderOn(p, v) ? 'checked' : ''} title="Coché : ce format compte pour la commande (Faible stock). Décoché : il ne déclenche plus de commande (ex. 250G / 500G d'un produit acheté au kilo)." onchange="Stock.toggleReorder('${p.id}','${v.id}')" style="width:16px;height:16px;margin:0;cursor:pointer;"></div></td>
      <td class="num v-mine"><input type="number" step="1" value="${lowE}" style="width:60px;" title="Stock min événement" onchange="Stock.setVarMin('${p.id}','${v.id}','lowEvent',this.value)"></td>
      <td class="num v-stg ${lowCls}"><b>${U.qty(qg)}</b></td>
      <td class="num v-ste">${U.qty(qe)}${lowE>0&&qe<=lowE?` <span class="warn-txt" style="font-size:.75rem;">(min ${lowE})</span>`:''}</td>
      <td class="num muted v-tot" title="Stock gén. + Stock évén. — tout ce que tu possèdes physiquement pour cette variante"><b>${U.qty(qg+qe)}</b></td>
      ${this._refCostCell(p, v)}
      ${this._refPriceCell(p, v, 'Prix de vente TTC')}
      <td class="num muted v-nb">${lots.length}</td>
      <td class="right v-act"><div class="act-grid"><span class="act-row">
        <button class="btn-icon" title="Monter" ${vi<=0?'disabled':''} onclick="Stock.moveVariant('${p.id}','${v.id}',-1)">↑</button>
        <button class="btn-icon" title="Descendre" ${vi>=sib.length-1?'disabled':''} onclick="Stock.moveVariant('${p.id}','${v.id}',1)">↓</button>
        </span><span class="act-row">
        <button class="btn-ghost btn-sm" title="Modifier la variante" onclick="Stock.editVariant('${p.id}','${v.id}')">Modifier</button>
        <button class="btn-icon" title="Supprimer la variante" onclick="Stock.delVariant('${p.id}','${v.id}')">🗑️</button>
      </span></div></td>
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
  /* Cellules prix d'une ligne variante : variante RELIÉE à une fiche → valeur de la fiche, en lecture seule (indicatif) ;
     NON reliée (aucune fiche d'où la prendre) → champ modifiable comme avant. */
  _refPriceCell(p, v, label) {
    const rc = this.refCalc(p, v);
    if (rc) return `<td class="num v-pv" title="${label} — vient de la fiche Prix mastication (non modifiable ici)">${U.eur(rc.calc.priceTTC)}</td>`;
    return `<td class="num v-pv"><input type="number" step="0.01" value="${U.num(v.priceTTC).toFixed(2)}" style="width:72px;" title="${label} (variante non reliée à une fiche Prix mastication)" onchange="Stock.setVarPrice('${p.id}','${v.id}',this.value)"></td>`;
  },
  _refCostCell(p, v) {
    const rc = this.refCalc(p, v);
    if (rc) return `<td class="num sensitive v-pa" title="Coût de revient de la fiche Prix mastication (frais de port d'achat estimés inclus) — non modifiable ici">${U.eur(rc.calc.cost)}</td>`;
    return `<td class="num sensitive v-pa"><input type="number" step="0.01" value="${U.num(v.costUnit).toFixed(2)}" style="width:78px;" title="Prix d'achat / coût unitaire (variante non reliée à une fiche Prix mastication)" onchange="Stock.setVarCost('${p.id}','${v.id}',this.value)"></td>`;
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
  /* SKU proposé pour une variante stock (2026-09-30) : déclinaison → SKU de sa taille + « -LOT<n> » ;
     sinon base tirée d'une variante sœur qui a un SKU (ou du nom du produit) + suffixe de la variante.
     Évite un SKU déjà utilisé ailleurs (suffixe -2, -3…). */
  suggestSku(p, v) {
    const par = this.parentOf(p, v);
    let sku;
    if (par) {
      const b = (par.sku || '').trim().toUpperCase() || Pricing.autoSku(p.name, p.meatType, Pricing.skuVariantLabel(par));
      sku = b + '-LOT' + this.packQtyOf(v);
    } else {
      // Sœur de même « forme » d'abord (mesure 30CM ↔ 50CM, pas « sans chair ») : leur SKU porte le vrai début du produit.
      const shape = w => /^\d+([.,]\d+)?(CM|MM|M|G|KG)$/.test(String(Pricing.labelVariant(w) || '').toUpperCase().replace(/\s+/g, '')) ? 'N' : 'T';
      const sibs = p.variants.filter(w => w !== v && !this.parentOf(p, w) && Pricing.skuBaseFrom(w));
      const sib = sibs.find(w => shape(w) === shape(v)) || sibs[0];
      sku = sib ? Pricing.skuWithBase(Pricing.skuBaseFrom(sib), v) : Pricing.autoSku(p.name, p.meatType, Pricing.skuVariantLabel(v));
    }
    const used = new Set();
    Store.state.stockM.forEach(x => (x.variants || []).forEach(w => { if (w !== v && w.sku) used.add(String(w.sku).trim().toUpperCase()); }));
    let out = sku, k = 2; while (used.has(out)) out = sku + '-' + (k++);
    return out;
  },
  /* Bouton ✨ (SKU vide) et après création d'une variante : propose le SKU dans une petite fenêtre. */
  async proposeSku(pId, vId) {
    const p = Store.state.stockM.find(x => x.id === pId); const v = p && p.variants.find(x => x.id === vId); if (!v) return;
    const sku = this.suggestSku(p, v);
    if (!await U.ask({ title: '🏷️ Générer le SKU ?', html: `<p>SKU proposé pour <b>${U.esc(p.name)}</b> — ${U.esc(Pricing.labelVariant(v))} :</p><p style="font-size:1.15rem;font-weight:700;color:var(--caramel);margin:6px 0 10px;">${U.esc(sku)}</p><p class="muted" style="margin:0;">Tu pourras le modifier ensuite dans la colonne SKU. Pense à le reporter sur ton site / SumUp.</p>`, okLabel: 'Utiliser ce SKU', cancelLabel: 'Non merci' })) return;
    this.setVarSku(pId, vId, sku);
    this.render();
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
    const v=p.variants.find(x=>x.id===vId); if(!v) return;
    // Déplacement parmi les variantes de même niveau (les tailles entre elles, les déclinaisons d'une même taille entre elles).
    const parId = this.parentOf(p, v)?.id || '';
    const sib = p.variants.filter(x => (this.parentOf(p, x)?.id || '') === parId);
    const w = sib[sib.indexOf(v) + dir]; if (!w) return;
    const i=p.variants.indexOf(v), j=p.variants.indexOf(w);
    const snap=Store.snapshot('stockM',p);
    [p.variants[i],p.variants[j]]=[p.variants[j],p.variants[i]];
    const entry=Store.commitSnapshot(snap,'stock',`Variantes réordonnées — ${p.name}`);
    U.toast('Ordre mis à jour.', false, entry.id);
    Store.save('stockM'); App.rerender();
  },

  /* ─── Déclinaisons (2026-09-28, demande d'Antho) ───
     Une variante peut être la « déclinaison » d'une autre (ex. « 25CM LOT 2 » ← « 25CM ») : v.parentId
     (variante sœur, un seul niveau) + v.packQty (pièces par lot). Elle HÉRITE de sa taille : la fiche
     calcul de prix (ligne « Lot de N » de la même fiche) et les tags. Elle garde son SKU, son stock/lots,
     ses seuils. Le lien hérité est recopié sur la déclinaison (v.catalogId / v.catalogVariantId) pour que
     tout le reste de l'appli (paniers, SKU, tableau de bord) continue de fonctionner sans cas particulier. */
  parentOf(p, v) {
    if (!p || !v || !v.parentId) return null;
    return p.variants.find(x => x.id === v.parentId && x.id !== v.id && !x.parentId) || null;
  },
  childrenOf(p, v) { return (p?.variants || []).filter(x => x.parentId === v.id && this.parentOf(p, x)); },
  packQtyOf(v) { return Math.max(2, Math.round(U.num(v.packQty)) || 2); },
  /* Déclinaison « sans stock propre » (2026-09-30, sabots en vrac) : ses ventes retirent packQty pièces
     de la variante principale ; son stock affiché = stock principal ÷ packQty (arrondi à l'inférieur). */
  isVirtual(p, v) { return !!(v && v.virtual && this.parentOf(p, v)); },
  stockVar(p, vOrId) { const v = typeof vOrId === 'object' ? vOrId : (p?.variants || []).find(x => x.id === vOrId); return (v && v.virtual && this.parentOf(p, v)) || v; },
  virtualQty(p, v) {
    const par = this.parentOf(p, v), n = this.packQtyOf(v);
    const g = par.lots.reduce((a, l) => a + U.num(l.qtyGeneral), 0), e = par.lots.reduce((a, l) => a + U.num(l.qtyEvent), 0);
    return { g: Math.floor(g / n), e: Math.floor(e / n), t: Math.floor((g + e) / n), n, par };
  },
  /* Ordre d'affichage : chaque taille suivie de ses déclinaisons. */
  orderedVariants(p) {
    const out = [];
    p.variants.filter(v => !this.parentOf(p, v)).forEach(t => { out.push(t); this.childrenOf(p, t).forEach(c => out.push(c)); });
    return out;
  },
  /* Tags propres à une variante (déclinaison → ceux de sa taille). null = hérite du produit. */
  _packSkuRow(sku, n) {
    return `<div class="pack-sku-row"><input class="ps-sku" placeholder="ex : SABOTS-VEAU-LOT5" value="${U.esc(sku || '')}"><span class="muted">=</span><input class="ps-n" type="number" min="2" step="1" value="${n || ''}" placeholder="5"><span class="muted">pièces</span><button type="button" class="btn-icon" title="Retirer" onclick="this.parentElement.remove()">✕</button></div>`;
  },
  _addPackSkuRow() { const box = document.getElementById('ev_packs'); if (box) box.insertAdjacentHTML('beforeend', this._packSkuRow('', '')); },
  variantTags(p, v) { const src = this.parentOf(p, v) || v; return src.tags || null; },
  /* Famille = une taille + ses déclinaisons (sert aux paniers : jamais 2 variantes de la même famille). */
  familyKey(p, v) { const par = this.parentOf(p, v); return p.id + ':' + (par ? par.id : v.id); },
  /* Recopie sur la déclinaison le lien de sa taille : même fiche, ligne « Lot de N » (N = pièces par lot). */
  resolveChild(p, v) {
    const par = this.parentOf(p, v); if (!par) return { found: false, catChanged: false, cat: null };
    const catId = par.catalogId || p.catalogId || '';
    const cat = catId ? Store.state.catalogM.find(c => c.id === catId) : null;
    if (!cat) { v.catalogId = ''; v.catalogVariantId = ''; return { found: false, catChanged: false, cat: null }; }
    const n = this.packQtyOf(v);
    const isN = cv => cv.mode === 'piece' && U.num(cv.value) === n;
    const all = cat.variants || [];
    const cv = all.find(x => x.enabled !== false && isN(x)) || all.find(isN);
    v.catalogId = cat.id; v.catalogVariantId = cv ? cv.id : '';
    const catChanged = cv ? this.applyCatalogVariantPrice(p, v, cat, cv.id) : false;
    return { found: !!cv, disabled: !!cv && cv.enabled === false, catChanged, cat, n };
  },
  _evParentChange() {
    const _vb = document.getElementById('ev_virtual_block'); if (_vb) _vb.style.display = U.val('ev_parent') ? '' : 'none';
    const on = !!U.val('ev_parent');
    const set = (id, show) => { const el = document.getElementById(id); if (el) el.style.display = show ? '' : 'none'; };
    set('ev_cat_block', !on); set('ev_tags_block', !on); set('ev_pack_block', on); set('ev_inherit_note', on);
    const note = document.getElementById('ev_inherit_note');
    if (note && on) { const sel = document.getElementById('ev_parent'); note.textContent = '↳ Fiche calcul de prix et tags hérités de « ' + sel.options[sel.selectedIndex].text + ' » (ligne « Lot de N » de sa fiche).'; }
  },

  editVariant(pId, vId) {
    const p=Store.state.stockM.find(x=>x.id===pId); const v=p?.variants.find(x=>x.id===vId); if(!v) return;
    const linkedCatId = v.catalogId || p.catalogId || '';
    const linkedCat = linkedCatId ? Store.state.catalogM.find(c=>c.id===linkedCatId) : null;
    this._evCatPickId = linkedCatId;
    this._evPid = p.id; this._evVid = v.id;
    const _kids = this.childrenOf(p, v);
    const _parOpts = (_kids.length ? [] : p.variants.filter(w => w.id !== v.id && !this.parentOf(p, w) && w.mode !== 'vrac')).sort((x, y) => U.sortFr(Pricing.labelVariant(x), Pricing.labelVariant(y)));
    const _curPar = this.parentOf(p, v);
    let _parSel = _curPar ? _curPar.id : '', _suggested = false;
    if (!_parSel) {
      // Proposition d'après le nom (« 25CM LOT 2 » → « 25CM ») — pré-sélection seulement, rien d'enregistré sans « Enregistrer ».
      const me = Pricing.labelVariant(v).toUpperCase().trim();
      const cand = _parOpts.filter(w => { const lw = Pricing.labelVariant(w).toUpperCase().trim(); return lw && me.startsWith(lw + ' ') && /LOT/.test(me.slice(lw.length)); })
        .sort((a, b) => Pricing.labelVariant(b).length - Pricing.labelVariant(a).length)[0];
      if (cand) { _parSel = cand.id; _suggested = true; }
    }
    const _lotM = Pricing.labelVariant(v).match(/LOT\s*(?:DE\s*)?(\d+)/i);
    const _packDef = U.num(v.packQty) > 1 ? v.packQty : (_lotM ? U.num(_lotM[1]) : (v.mode === 'piece' && U.num(v.value) > 1 ? U.num(v.value) : 2));
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
        <div class="fg"><label>Nom de la variante</label><input id="ev_label" value="${U.esc(Pricing.labelVariant(v))}" placeholder="ex: 25CM, 100G, LOT 2…"></div>
        <div class="fg"><label>SKU WooCommerce</label><input id="ev_sku" value="${U.esc(v.sku||'')}"></div>
      </div>
      ${v.mode==='vrac' ? '' : `<div class="frow">
        <div class="fg"><label>⚖️ Poids moyen (g) <span class="muted help">Poids d'une pièce / d'un sachet de cette variante, pour estimer le poids des colis. Vide = calculé si possible (variante au poids, lot de N pièces, moyenne d'un tri d'achat).</span></label><input id="ev_wavg" type="number" step="any" min="0" value="${v.wAvg||''}" placeholder="${(()=>{const w=Ship.variantW(p,v);return w&&!(U.num(v.wAvg)>0)?Math.round(w.avg)+' (calculé)':'ex : 120';})()}"></div>
        <div class="fg"><label>Mini (g)</label><input id="ev_wmin" type="number" step="any" min="0" value="${v.wMin||''}" placeholder="option"></div>
        <div class="fg"><label>Maxi (g)</label><input id="ev_wmax" type="number" step="any" min="0" value="${v.wMax||''}" placeholder="option"></div>
      </div>`}
      ${_kids.length ? `<p class="muted" style="font-size:.8rem;margin:6px 0 0;">Déclinaisons de cette variante : <b>${_kids.map(k=>U.esc(Pricing.labelVariant(k))).join(', ')}</b> — elles héritent de sa fiche prix et de ses tags.</p>` : `<div class="frow" style="align-items:flex-end;">
        <div class="fg"><label>Déclinaison de</label><select id="ev_parent" onchange="Stock._evParentChange()">
          <option value="">— aucune (variante de référence) —</option>
          ${_parOpts.map(w => `<option value="${w.id}" ${w.id===_parSel?'selected':''}>${U.esc(Pricing.labelVariant(w))}</option>`).join('')}
        </select></div>
        <div class="fg" id="ev_pack_block" style="max-width:150px;${_parSel?'':'display:none;'}"><label>Pièces par lot</label><input id="ev_packqty" type="number" min="2" step="1" value="${_packDef}"></div>
      </div>
      <label id="ev_virtual_block" class="virt-check" style="${_parSel?'':'display:none;'}"><input type="checkbox" id="ev_virtual" ${v.virtual?'checked':''}> <span><b>Pas de stock propre</b> — prendre les pièces sur la variante principale (vente en vrac, lot sans conditionnement). Stock affiché = stock principal ÷ pièces par lot.</span></label>
      ${_suggested ? `<p class="muted" style="font-size:.78rem;margin:4px 0 0;">💡 Proposé d'après le nom — vérifie avant d'enregistrer (« — aucune — » pour ne pas la rattacher).</p>` : ''}
      <p class="muted help">Une déclinaison (ex. 25CM LOT 2) est la même taille vendue par plusieurs pièces : elle reprend automatiquement la fiche calcul de prix de sa taille (ligne « Lot de N ») et ses tags. Elle garde son SKU, son stock et ses seuils.</p>
      <p id="ev_inherit_note" style="font-size:.82rem;color:var(--caramel);margin:6px 0 0;${_parSel?'':'display:none;'}">${_parSel ? '↳ Fiche calcul de prix et tags hérités de « ' + U.esc(Pricing.labelVariant(p.variants.find(w=>w.id===_parSel))) + ' » (ligne « Lot de N » de sa fiche).' : ''}</p>`}
      <div id="ev_cat_block" style="${_parSel?'display:none;':''}">
      <hr class="sep">
      <div class="fg" data-onclose="Stock.closeEvCatPick">
        <label>Fiche calcul de prix</label>
        <input id="ev_cat_q" value="${U.esc(linkedCat ? linkedCat.name : '')}" placeholder="Rechercher une fiche catalogue…" autocomplete="off"
          onfocus="Stock.filterEvCatPick(this.value)" oninput="Stock.filterEvCatPick(this.value)">
        <div id="ev_cat_pick_list" class="ac-list" style="position:static;max-height:180px;overflow-y:auto;margin-top:4px;display:none;"></div>
        <p class="muted help" style="font-size:.78rem;margin-top:4px;">Associe cette variante à sa propre fiche du calcul de prix — chaque variante peut pointer vers une fiche différente.</p>
      </div>
      </div>
      ${(v.mode === 'size' || _kids.length || _parOpts.length) ? `<div id="ev_tags_block" style="${_parSel?'display:none;':''}"><hr class="sep">
      <div class="tags-inherited"><span class="muted">🔒 Hérités du produit (identiques pour toutes les tailles) :</span>
        ${[['Poil', {avec:'Avec poil', sans:'Sans poil', les_deux:'Avec ou sans'}[pt.poil] || ''], ['Hypoallergénique', (pt.hypo === 'oui' || pt.hypo === true) ? 'Oui' : pt.hypo === 'non' ? 'Non' : ''], ['Résistance', _rLb], ['Type', _tLb], ['Odeur', _oLb], ['Gras', _grLb]].map(([k, val]) => `<span class="tag-inh${val ? '' : ' empty'}">${k} : <b>${val ? U.esc(val) : 'non renseigné'}</b></span>`).join(' ')}
        <p class="muted" style="font-size:.74rem;margin:4px 0 0;">À modifier dans « ✏️ Modifier le produit ».</p></div>
      <p class="muted" style="font-size:.78rem;margin:10px 0 8px;">Propres à cette taille — vide = hérite du produit</p>
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
      </div></div>` : ''}`,
      onOk:()=>{
        const newLabel = U.val('ev_label').trim();
        if (!newLabel) { U.toast('Le nom de la variante ne peut pas être vide.', true); return false; }
        if (p.variants.some(x => x.id !== v.id && Pricing.labelVariant(x).trim().toUpperCase() === newLabel.toUpperCase())) { U.toast('Une autre variante de ce produit porte déjà ce nom.', true); return false; }
        const snap=Store.snapshot('stockM',p);
        if (newLabel !== Pricing.labelVariant(v)) v.label = newLabel;
        v.sku=U.val('ev_sku');
        if (document.getElementById('ev_wavg')) { const a=U.numVal('ev_wavg'), mn=U.numVal('ev_wmin'), mx=U.numVal('ev_wmax'); v.wAvg=a>0?a:0; v.wMin=mn>0?mn:0; v.wMax=mx>0?mx:0; if(!v.wAvg&&!v.wMin&&!v.wMax){delete v.wAvg;delete v.wMin;delete v.wMax;} }
        const parId = document.getElementById('ev_parent') ? U.val('ev_parent') : '';
        if (parId) {
          const par = p.variants.find(x => x.id === parId);
          const n = Math.max(2, Math.round(U.numVal('ev_packqty')) || 2);
          const wantVirtual = !!(document.getElementById('ev_virtual') || {}).checked;
          if (wantVirtual && !v.virtual && v.lots.some(l => U.num(l.qtyGeneral) + U.num(l.qtyEvent) > 0)) { U.toast('Cette variante a encore du stock dans ses lots : vide-les (ou transfère-les sur ' + Pricing.labelVariant(par) + ') avant de la passer « sans stock propre ».', true); return false; }
          v.parentId = parId; v.packQty = n;
          if (wantVirtual) { v.virtual = true; v.lots = []; v.low = 0; v.lowEvent = 0; } else delete v.virtual;
          if (!v.label) v.label = Pricing.labelVariant(par) + ' LOT ' + n;
          v.mode = 'piece'; v.value = n;
          delete v.tags;
          const r = Stock.resolveChild(p, v);
          const entry=Store.commitSnapshot(snap,'stock','Variante modifiée — '+p.name+' ('+Pricing.labelVariant(v)+')');
          Store.save('stockM'); if (r.catChanged) Store.save('catalogM');
          U.closeModal(); App.rerender();
          if (!r.cat) U.toast(`✅ Rattachée à ${Pricing.labelVariant(par)}. Son prix se mettra à jour tout seul dès que ${Pricing.labelVariant(par)} sera reliée à une fiche de prix.`, false, entry.id);
          else if (!r.found) U.toast(`⚠️ La fiche « ${r.cat.name} » n'a pas de ligne « Lot de ${n} pc » — ajoute-la dans Prix mastication, le prix se mettra à jour.`, true);
          else U.toast(`Déclinaison de ${Pricing.labelVariant(par)} — prix repris de « ${r.cat.name} » (Lot de ${n} pc)${r.disabled ? ' ⚠️ ligne désactivée dans la fiche' : ''}.`, false, entry.id);
          return;
        }
        delete v.parentId; delete v.packQty; delete v.virtual;
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
        // Produit à UNE seule variante : relier la variante relie aussi le produit (aucune ambiguïté).
        // Avec plusieurs variantes on ne devine jamais : le lien produit reste un choix explicite.
        if (finalCatId && p.variants.length === 1 && !(p.catalogId && Store.state.catalogM.some(c => c.id === p.catalogId))) p.catalogId = finalCatId;
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
        if (document.getElementById('ev_age')) {
          // Seuls l'âge et le gabarit dépendent de la taille ; le reste vient toujours du produit.
          const evAgeEl = document.getElementById('ev_age');
          const evAge = evAgeEl ? [...evAgeEl.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value) : [];
          const evGabaritEl = document.getElementById('ev_gabarit');
          const evGabarit = evGabaritEl ? [...evGabaritEl.querySelectorAll('input[type="checkbox"]:checked')].map(c => c.value) : [];
          v.tags = { age: evAge, gabarit: evGabarit };
        } else {
          delete v.tags;
        }
        // Les déclinaisons de cette taille suivent son (nouveau) lien.
        Stock.childrenOf(p, v).forEach(c => { if (Stock.resolveChild(p, c).catChanged) catSkuChanged = true; });
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
    v.costUnit = calc.costBase;   // coût RÉEL (sans le port estimé des Paramètres)
    let catChanged = false;
    if (v.sku) { if (cv.sku !== v.sku) { cv.sku = v.sku; catChanged = true; } }
    else if (cv.sku) v.sku = cv.sku;
    return catChanged;
  },

  /* PRIX DE RÉFÉRENCE (2026-10-09, décision d'Antho) : la fiche « Prix mastication » est la SEULE référence de prix et de coût ; le Stock n'en garde
     qu'une copie INDICATIVE, non modifiable, qui se remet à jour toute seule (refreshPrices, à chaque affichage d'écran).
     refCalc = calcul à la volée depuis la fiche reliée (même rang de palier que partout) ; null si la variante n'est reliée à aucune fiche.
     Paniers & co lisent ceci, jamais la copie. calc.cost = coût de revient AVEC port estimé ; calc.costBase = sans (comptabilité du stock). */
  refCalc(p, v) {
    const catId = (v && v.catalogId) || (p && p.catalogId) || ''; if (!catId || !v.catalogVariantId) return null;
    const cat = Store.state.catalogM.find(c => c.id === catId); if (!cat) return null;
    const cv = (cat.variants || []).find(x => x.id === v.catalogVariantId); if (!cv) return null;
    const enabledVars = (cat.variants || []).filter(x => x.enabled !== false);
    const idx = enabledVars.findIndex(x => x.id === cv.id);
    return { cat, cv, calc: Pricing.variantCalc(cat, cv, idx < 0 ? 0 : idx, Pricing.baseUnitCost(cat), enabledVars.length) };
  },
  /* Recopie sur le Stock les prix/coûts de TOUTES les fiches reliées (même chose que 🔄, mais automatique : appelée par App.rerender).
     N'enregistre que si quelque chose a changé. Jamais en profil visite/équipe (ils ne gèrent pas les fiches prix). */
  refreshPrices() {
    if (typeof App !== 'undefined' && (App.isViewer || App.isTeam)) return false;
    if (!Store.state || !Store.state.stockM || !Store.state.catalogM) return false;
    const sig = () => Store.state.stockM.map(sp => (sp.variants || []).map(v => [v.priceTTC, v.costUnit, v.mode, v.value, v.label, v.sku, v.catalogVariantId, v.catalogId].join('~')).join('|')).join('||');
    const before = sig(), ids = new Set();
    Store.state.stockM.forEach(sp => { if (sp.catalogId) ids.add(sp.catalogId); (sp.variants || []).forEach(v => { if (v.catalogId) ids.add(v.catalogId); }); });
    ids.forEach(id => { try { this.syncPricesFromCatalog(id); } catch (e) { console.error(e); } });
    if (sig() === before) return false;
    Store.save('stockM');
    return true;
  },

  async delVariant(pId, vId) {
    const p=Store.state.stockM.find(x=>x.id===pId); const v=p?.variants.find(x=>x.id===vId); if(!v) return;
    const kids=this.childrenOf(p,v);
    if(!await U.confirm(`Supprimer la variante "${Pricing.labelVariant(v)}" et tous ses lots ?${kids.length?`\n\nSes déclinaisons (${kids.map(k=>Pricing.labelVariant(k)).join(', ')}) sont gardées et redeviennent indépendantes.`:''}`)) return;
    const snap=Store.snapshot('stockM',p);
    p.variants=p.variants.filter(x=>x.id!==vId);
    p.variants.forEach(x=>{ if(x.parentId===vId){ delete x.parentId; delete x.packQty; } });
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
    const _tops = p.variants.filter(w => !this.parentOf(p, w) && w.mode !== 'vrac').sort((x, y) => U.sortFr(Pricing.labelVariant(x), Pricing.labelVariant(y)));
    U.modal({
      title:'＋ Variante — '+U.esc(p.name), okLabel:'Ajouter',
      body:`<div class="frow">
        <div class="fg"><label>Mode</label><select id="av_mode">
          <option value="gram">Poids (g)</option><option value="piece">Pièce / lot</option>
          <option value="size">Taille (S/M/L…)</option><option value="vrac">Vrac (kg ou pc)</option></select></div>
        <div class="fg"><label>Valeur / taille</label><input id="av_val" placeholder="ex: 100, S, 1…"></div>
      </div>
      ${_tops.length ? `<div class="frow">
        <div class="fg"><label>Déclinaison de (optionnel)</label><select id="av_parent" onchange="document.getElementById('av_pack_block').style.display=this.value?'':'none';document.getElementById('av_virtual_block').style.display=this.value?'':'none'">
          <option value="">— aucune —</option>${_tops.map(w=>`<option value="${w.id}">${U.esc(Pricing.labelVariant(w))}</option>`).join('')}</select></div>
        <div class="fg" id="av_pack_block" style="max-width:150px;display:none;"><label>Pièces par lot</label><input id="av_packqty" type="number" min="2" step="1" value="2"></div>
      </div>
      <label id="av_virtual_block" class="virt-check" style="display:none;"><input type="checkbox" id="av_virtual"> <span><b>Pas de stock propre</b> — prendre les pièces sur la variante principale (vente en vrac, lot sans conditionnement).</span></label>
      <p class="muted help">Déclinaison = la même taille vendue par plusieurs pièces (ex. 25CM → 25CM LOT 2) : fiche prix (ligne « Lot de N ») et tags repris de la taille. Le mode est alors ignoré ; si « Valeur / taille » reste vide, le nom est composé automatiquement (ex. 25CM LOT 2).</p>` : ''}
      <div class="frow">
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
        const parId = document.getElementById('av_parent') ? U.val('av_parent') : '';
        if (parId) {
          const par = p.variants.find(x=>x.id===parId);
          const n = Math.max(2, Math.round(U.numVal('av_packqty')) || 2);
          const virt = !!(document.getElementById('av_virtual') || {}).checked;
          const nv = {id:U.uid(),catalogVariantId:'',mode:'piece',value:n,label:raw || (Pricing.labelVariant(par)+' LOT '+n),parentId:parId,packQty:n,sku:U.val('av_sku'),priceTTC:U.numVal('av_price'),costUnit:0,low:virt?0:U.numVal('av_low'),lowEvent:virt?0:U.numVal('av_lowe'),lots:[],...(virt?{virtual:true}:{})};
          p.variants.push(nv);
          const r = Stock.resolveChild(p, nv);
          const entry=Store.commitSnapshot(snap,'stock','Variante ajoutée — '+p.name+' ('+nv.label+')');
          Store.save('stockM'); if (r.catChanged) Store.save('catalogM'); U.closeModal(); App.rerender();
          if (r.cat && !r.found) U.toast(`Déclinaison ajoutée — ⚠️ la fiche « ${r.cat.name} » n'a pas de ligne « Lot de ${n} pc ».`, true);
          else U.toast('Déclinaison ajoutée.', false, entry.id);
          if (!nv.sku) setTimeout(() => Stock.proposeSku(p.id, nv.id), 150);
          return;
        }
        const _nv = {id:U.uid(),catalogVariantId:'',mode,value,label:mode==='size'?raw:'',sku:U.val('av_sku'),priceTTC:U.numVal('av_price'),costUnit:0,low:U.numVal('av_low'),lowEvent:U.numVal('av_lowe'),lots:[]};
        p.variants.push(_nv);
        const entry=Store.commitSnapshot(snap,'stock','Variante ajoutée — '+p.name+' ('+raw+')');
        Store.save('stockM'); U.closeModal(); App.rerender();
        U.toast('Variante ajoutée.', false, entry.id);
        if (!_nv.sku) setTimeout(() => Stock.proposeSku(p.id, _nv.id), 150);
      }
    });
  },

  /* Contrôle des doublons (demande d'Antho, 2026-09-26) — ALERTE, jamais blocage :
     - une fiche prix liée à plusieurs produits stock (le 1er impose alors nom/viande, cf. stock prioritaire) ;
     - un lien fournisseur partagé entre produits mastication et/ou consommables
       (matières premières exclues : une même page sert souvent plusieurs couleurs/largeurs). */
  normUrl(u) { return String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, ''); },
  normRef(r) { return String(r || '').trim().toUpperCase().replace(/\s+/g, ''); },
  /* Tous les liens / réf. fournisseur de l'appli (2026-09-27 : mastication + matières + consommables).
     kind M = produit mastication (lien au niveau produit, réf. au niveau variante), T = matière, C = consommable. */
  /* 2026-09-27 : le lien d'un produit MASTICATION du stock = sa page sur le site Touffu (pas un fournisseur)
     → liste à part (siteUrls), comparée seulement entre produits mastication. Les liens/réf. fournisseur
     de la mastication vivent dans Prix mastication (kind P, une entrée par fournisseur de la fiche). */
  supplierEntries() {
    const urls = [], refs = [], siteUrls = [];
    Store.state.stockM.forEach(p => {
      if (p.url) siteUrls.push({ kind: 'M', id: p.id, pId: p.id, name: p.name, val: p.url });
    });
    Store.state.catalogM.forEach(cp => (cp.suppliers || []).forEach(s => {
      const nm = cp.name + ' — ' + Store.supplierName(s.supplierId);
      if (s.url) urls.push({ kind: 'P', id: cp.id, name: nm, val: s.url });
      if (s.ref) refs.push({ kind: 'P', id: cp.id, name: nm, val: s.ref });
    }));
    (Store.state.materials || []).forEach(m => {
      if (m.url) urls.push({ kind: 'T', id: m.id, name: m.name, val: m.url });
      if (m.ref) refs.push({ kind: 'T', id: m.id, name: m.name, val: m.ref });
    });
    (Store.state.consumables || []).forEach(c => {
      const nm = c.name + (this.consoDims(c) ? ' ' + this.consoDims(c) : '');
      if (c.url) urls.push({ kind: 'C', id: c.id, name: nm, val: c.url });
      if (c.ref) refs.push({ kind: 'C', id: c.id, name: nm, val: c.ref });
    });
    return { urls, refs, siteUrls };
  },
  urlOwners(url, site) {
    const k = this.normUrl(url); if (!k) return [];
    return this.supplierEntries()[site ? 'siteUrls' : 'urls'].filter(o => this.normUrl(o.val) === k);
  },
  refOwners(ref) {
    const k = this.normRef(ref); if (!k) return [];
    return this.supplierEntries().refs.filter(o => this.normRef(o.val) === k);
  },
  _kindTxt(k) { return k === 'C' ? ' (consommable)' : k === 'T' ? ' (matière)' : k === 'P' ? ' (prix mastication)' : ' (mastication)'; },
  /* self = {kind, id} de l'élément en cours d'édition (exclu des doublons). */
  dupWarnings({ pId, consoId, catId, url, ref, self }) {
    const msgs = [];
    if (catId) {
      const others = Store.state.stockM.filter(x => x.catalogId === catId && x.id !== pId);
      if (others.length) {
        const cat = Store.state.catalogM.find(c => c.id === catId);
        msgs.push('⚠️ La fiche prix « ' + (cat ? cat.name : '?') + ' » est déjà liée à : ' + others.map(x => x.name).join(', '));
      }
    }
    const me = self || (pId ? { kind: 'M', id: pId } : consoId ? { kind: 'C', id: consoId } : null);
    const notMe = o => !(me && o.kind === me.kind && (o.id === me.id || (o.kind === 'M' && me.kind === 'M' && o.pId === me.id && !String(me.id).includes(':'))));
    const site = me && me.kind === 'M';
    const owners = this.urlOwners(url, site).filter(notMe);
    if (owners.length) msgs.push((site ? '⚠️ Ce lien site Touffu est déjà utilisé par : ' : '⚠️ Ce lien fournisseur est déjà utilisé par : ') + owners.map(o => o.name + this._kindTxt(o.kind)).join(', '));
    const rOwners = this.refOwners(ref).filter(notMe);
    if (rOwners.length) msgs.push('⚠️ Cette référence fournisseur « ' + ref + ' » est déjà utilisée par : ' + rOwners.map(o => o.name + this._kindTxt(o.kind)).join(', '));
    return msgs;
  },

  editProduct(id) {
    const S = Store.state.settings;
    const p = id ? Store.state.stockM.find(x=>x.id===id)
      : {id:U.uid(),catalogId:'',name:'',meatType:S.meatTypes[0],variants:[]};
    const curCat = Store.state.catalogM.find(c => c.id === p.catalogId);
    this._catPickId = p.catalogId || '';
    this._catPickPid = p.id;
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
        <div class="fg"><label>Viande</label><select id="sp_meat" onchange="Stock.refreshCatPick()">${(p.meatType && !S.meatTypes.some(m=>m.toLowerCase()===p.meatType.toLowerCase()) ? `<option value="${U.esc(p.meatType)}" selected>${U.esc(p.meatType)} (hors liste)</option>` : '')}${S.meatTypes.slice().sort(U.sortFr).map(m=>`<option ${(p.meatType||'').toLowerCase()===m.toLowerCase()?'selected':''}>${U.esc(m)}</option>`).join('')}</select></div>
      </div>
      <div class="fg"${Store.hideSupplierInfo() ? ' style="display:none;"' : ''}><label>Lien site Touffu (optionnel)</label><div style="display:flex;gap:6px;align-items:center;"><input id="sp_url" value="${U.esc(p.url||'')}" placeholder="https://…" style="flex:1;"><button type="button" class="btn btn-sm" style="white-space:nowrap;" title="Ouvrir dans le navigateur" onclick="var u=document.getElementById('sp_url').value.trim();if(u)window.open(u,'_blank','noopener');else U.toast('Aucun lien renseigné.',true);">🔗 Ouvrir</button></div></div>
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
        const dupMsgs = this.dupWarnings({ pId: p.id, catId, url: U.val('sp_url') });
        if (!U.dupGate(dupMsgs, () => document.getElementById('modalOk').click())) return false;
        const oldCatId = p.catalogId || '';
        const oldName = p.name || '';
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
        if (id && oldName && oldName !== p.name) setTimeout(() => Stock.proposeSkuRename(p.id, oldName), 350);
      }
    });
  },

  /* Après un renommage de produit (demande d'Antho, 2026-09-28) : propose de mettre à jour les SKU des
     variantes dont le début correspond à l'ancien nom (ROULEAUX-POR-25CM → NOUVEAU-NOM-25CM).
     Rien si seule la casse/les accents changent (même début de SKU). SKU personnalisés (autre début)
     ou nouveau SKU déjà utilisé ailleurs → laissés tels quels. Jamais sans confirmation ; annulable. */
  async proposeSkuRename(pId, oldName) {
    const p = Store.state.stockM.find(x => x.id === pId); if (!p) return;
    const oldPre = Pricing.autoSku(oldName, p.meatType, '').toUpperCase();
    const newPre = Pricing.autoSku(p.name, p.meatType, '').toUpperCase();
    if (!oldPre || !newPre || oldPre === newPre) return;
    const others = new Set();
    Store.state.stockM.forEach(sp => sp.variants.forEach(sv => { if (sp.id !== p.id && sv.sku) others.add(sv.sku.trim().toUpperCase()); }));
    const rows = [], kept = [];
    this.orderedVariants(p).forEach(v => {
      const sku = (v.sku || '').trim(); if (!sku) return;
      const up = sku.toUpperCase();
      if (up === oldPre || up.startsWith(oldPre + '-')) {
        const nsku = newPre + up.slice(oldPre.length);
        rows.push({ v, old: sku, nsku, clash: others.has(nsku) });
      } else kept.push(sku);
    });
    if (!rows.length) return;
    const ok = rows.filter(r => !r.clash);
    const html = `<p style="margin:0 0 8px;">Tu as renommé <b>${U.esc(oldName)}</b> en <b>${U.esc(p.name)}</b>. Mettre à jour les SKU de ses variantes ?</p>
      <table style="width:100%;font-size:.85rem;"><thead><tr><th>Variante</th><th>SKU actuel</th><th>Nouveau SKU</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${U.esc(Pricing.labelVariant(r.v))}</td><td><code>${U.esc(r.old)}</code></td><td>${r.clash ? `<span class="warn-txt">⚠ ${U.esc(r.nsku)} déjà utilisé — gardé</span>` : `<code>${U.esc(r.nsku)}</code>`}</td></tr>`).join('')}
      </tbody></table>
      ${kept.length ? `<p class="muted" style="margin:8px 0 0;font-size:.8rem;">SKU personnalisés non touchés : ${kept.map(U.esc).join(', ')}</p>` : ''}
      <p class="muted" style="margin:8px 0 0;font-size:.8rem;">⚠️ Pense à mettre les mêmes SKU sur ton site, sinon le lien avec WooCommerce est perdu.</p>`;
    if (!ok.length) { U.alert('Les nouveaux SKU seraient déjà utilisés par d\'autres produits : rien n\'a été changé.', '🏷️ SKU'); return; }
    if (!await U.ask({ title: '🏷️ Mettre à jour les SKU ?', html, okLabel: `Mettre à jour (${ok.length})`, cancelLabel: 'Garder les SKU' })) return;
    const snaps = [Store.snapshot('stockM', p)];
    const catSnapped = new Set();
    ok.forEach(r => {
      r.v.sku = r.nsku;
      const cId = r.v.catalogId || p.catalogId;
      const cp = cId && r.v.catalogVariantId ? Store.state.catalogM.find(c => c.id === cId) : null;
      const cv = cp?.variants?.find(x => x.id === r.v.catalogVariantId);
      if (cv && cv.sku !== r.nsku) { if (!catSnapped.has(cp.id)) { snaps.push(Store.snapshot('catalogM', cp)); catSnapped.add(cp.id); } cv.sku = r.nsku; }
    });
    const entry = Store.log('stock', `SKU mis à jour après renommage — ${p.name} (${ok.length})`, { type: 'restoreBatch', data: snaps });
    Store.save('stockM'); if (catSnapped.size) Store.save('catalogM');
    App.rerender();
    U.toast(`${ok.length} SKU mis à jour — pense à les reporter sur ton site.`, false, entry.id);
  },

  /* Liste de suggestions pour "Lier au catalogue prix" — recherche texte plutôt
     qu'un <select> classique (137+ produits, impossible à parcourir/taper dedans).
     Affiche viande + fournisseur pour distinguer les doublons de nom (ex: "Ailes
     de poulet" présent 2 fois côté catalogue chez Antho). */
  catPickOptionsHTML(q) {
    const query = (q || '').trim().toLowerCase();
    // Champ vide → seulement les fiches de la MÊME viande que le produit (select « Viande »
    // de la fenêtre, suivi en direct) ; dès qu'on tape → recherche dans TOUTES les viandes
    // (retrouver une fiche rangée dans une mauvaise viande, ex. Bois Végétal/Bois Naturel).
    const meat = (U.val('sp_meat') || '').toLowerCase();
    const byMeat = !query && meat;
    const matches = Store.state.catalogM
      .filter(c => query ? U.has(c.name, query) : (!byMeat || (c.meatType || '').toLowerCase() === meat))
      .sort((a, b) => U.sortFr(a.name, b.name));
    // Repères de liaison : ✓ = déjà lié à CE produit ; 🔗 = déjà pris par un autre produit stock.
    const linkedBy = {};
    Store.state.stockM.forEach(sp => { if (sp.catalogId) (linkedBy[sp.catalogId] = linkedBy[sp.catalogId] || []).push(sp); });
    const tag = c => {
      const l = linkedBy[c.id] || [];
      if (l.some(sp => sp.id === this._catPickPid)) return ` <span style="color:var(--ok,#4caf50);font-weight:600;">✓ ce produit</span>`;
      if (l.length) return ` <span style="color:var(--warn,#e0a040);">🔗 lié à : ${U.esc(l.map(sp => sp.name).join(', '))}</span>`;
      return '';
    };
    const hint = byMeat ? `<div class="muted" style="padding:6px 10px;font-size:.8rem;">Fiches ${U.esc(U.val('sp_meat'))} — tape pour chercher dans toutes les viandes</div>` : '';
    const noneItem = `<div class="ac-item" onmousedown="event.preventDefault();Stock.pickCatForProduct('','')">— aucun (libre) —</div>`;
    const empty = !matches.length ? `<div class="muted" style="padding:6px 10px;">Aucune fiche${byMeat ? ' pour cette viande — tape le nom pour chercher partout' : ''}.</div>` : '';
    // Ordre (demande d'Antho) : fiche déjà liée à CE produit en tête, puis les fiches LIBRES (A→Z),
    // puis un séparateur et les fiches déjà liées à un autre produit (A→Z).
    const rank = c => { const l = linkedBy[c.id] || []; return l.some(sp => sp.id === this._catPickPid) ? 0 : (l.length ? 2 : 1); };
    matches.sort((a, b) => rank(a) - rank(b) || U.sortFr(a.name, b.name));
    const sepIdx = matches.findIndex(c => rank(c) === 2);
    const sep = `<div class="muted" style="padding:6px 10px;font-size:.78rem;border-top:1px dashed var(--caramel);margin-top:4px;">Déjà liées à un autre produit</div>`;
    return hint + noneItem + empty + matches.map((c, i) => (i === sepIdx ? sep : '') + `<div class="ac-item pp-row" onmousedown="event.preventDefault();Stock.pickCatForProduct('${c.id}','${U.esc(c.name).replace(/&#39;/g, "\\'")}')"><span class="pp-a">${U.esc(c.name)}${tag(c)}</span><span class="pp-b">${U.esc(c.meatType || '—')}</span><span class="pp-c">${U.esc(Store.supplierName(c.mainSupplierId))}</span></div>`).join('');
  },
  refreshCatPick() {
    const box = document.getElementById('cat_pick_list');
    if (box && box.style.display !== 'none') box.innerHTML = this.catPickOptionsHTML(U.val('sp_cat_q'));
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
    // Même logique que « Lier au catalogue prix » du produit : champ vide → fiches de la viande du produit ;
    // dès qu'on tape → toutes les viandes.
    const prod = Store.state.stockM.find(x => x.id === this._evPid);
    const meatRaw = prod?.meatType || '';
    const meat = meatRaw.toLowerCase();
    const byMeat = !query && meat;
    const matches = Store.state.catalogM
      .filter(c => query ? U.has(c.name, query) : (!byMeat || (c.meatType || '').toLowerCase() === meat));
    // Repères : ✓ cette variante / ✓ ce produit (lien du produit ou d'une autre de ses variantes) / 🔗 lié ailleurs.
    const owners = {};
    const add = (cid, who) => { if (cid) (owners[cid] = owners[cid] || []).push(who); };
    Store.state.stockM.forEach(sp => {
      add(sp.catalogId, { pId: sp.id, vId: '', label: sp.name });
      (sp.variants || []).forEach(v => add(v.catalogId, { pId: sp.id, vId: v.id, label: sp.name + ' — ' + (v.label || v.value || '') }));
    });
    const rank = c => {
      const o = owners[c.id] || [];
      if (o.some(w => w.pId === this._evPid && w.vId === this._evVid)) return 0;
      if (o.some(w => w.pId === this._evPid)) return 1;
      return o.length ? 3 : 2;
    };
    const tag = c => {
      const r = rank(c);
      if (r === 0) return ` <span style="color:var(--ok,#4caf50);font-weight:600;">✓ cette variante</span>`;
      if (r === 1) { const w = owners[c.id].filter(w => w.pId === this._evPid && w.vId); return ` <span style="color:var(--ok,#4caf50);">✓ ${w.length ? 'variante ' + U.esc(w.map(x => x.label.split(' — ').pop()).join(', ')) : 'ce produit'}</span>`; }
      if (r === 3) { const l = [...new Set(owners[c.id].map(w => w.label))]; return ` <span style="color:var(--warn,#e0a040);">🔗 lié à : ${U.esc(l.join(', '))}</span>`; }
      return '';
    };
    matches.sort((a, b) => rank(a) - rank(b) || U.sortFr(a.name, b.name));
    const sepIdx = matches.findIndex(c => rank(c) === 3);
    const sep = `<div class="muted" style="padding:6px 10px;font-size:.78rem;border-top:1px dashed var(--caramel);margin-top:4px;">Déjà liées à un autre produit</div>`;
    const hint = byMeat ? `<div class="muted" style="padding:6px 10px;font-size:.8rem;">Fiches ${U.esc(meatRaw)} — tape pour chercher dans toutes les viandes</div>` : '';
    const empty = !matches.length ? `<div class="muted" style="padding:6px 10px;">Aucune fiche${byMeat ? ' pour cette viande — tape le nom pour chercher partout' : ''}.</div>` : '';
    const noneItem = `<div class="ac-item" onmousedown="event.preventDefault();Stock.pickEvCat('','')">— aucune (libre) —</div>`;
    box.innerHTML = hint + noneItem + empty + matches.map((c, i) => (i === sepIdx ? sep : '') + `<div class="ac-item pp-row" onmousedown="event.preventDefault();Stock.pickEvCat('${c.id}','${U.esc(c.name).replace(/&#39;/g, "\'")}')"><span class="pp-a">${U.esc(c.name)}${tag(c)}</span><span class="pp-b">${U.esc(c.meatType || '—')}</span><span class="pp-c">${U.esc(Store.supplierName(c.mainSupplierId))}</span></div>`).join('');
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

  async delProduct(id) {
    const p=Store.state.stockM.find(x=>x.id===id);
    if(!await U.confirm(`Supprimer "${p.name}" et tous ses lots ?`)) return;
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
        // Déclinaison → traitée plus bas via sa taille ; variante liée à SA propre fiche → pas celle-ci.
        if (Stock.parentOf(sp, sv) || (sv.catalogId && sv.catalogId !== catalogId)) return;
        let cv = sv.catalogVariantId ? enabledVars.find(x=>x.id===sv.catalogVariantId) : null;
        if(!cv && sv.sku) cv = enabledVars.find(x=>x.sku && norm(x.sku)===norm(sv.sku));
        if(!cv) cv = enabledVars.find(x=>sameVar(x,sv));
        if(!cv) return; // aucune correspondance existante côté stock : on ne crée rien
        const idx = enabledVars.indexOf(cv);
        const calc = Pricing.variantCalc(cat,cv,idx,base,enabledVars.length);
        sv.catalogVariantId=cv.id; if (!sv.label) sv.label=Pricing.labelVariant(cv); // nom de variante : le stock est prioritaire (renommable dans « Modifier variante »)
        sv.mode=cv.mode; sv.value=cv.value;
        // SKU : le Stock est prioritaire (écrase celui du Catalogue) ; sinon, si le
        // Stock n'en a pas, on reprend celui du Catalogue comme avant.
        if (sv.sku) { if (cv.sku !== sv.sku) { cv.sku = sv.sku; catChanged = true; } }
        else if (cv.sku) sv.sku = cv.sku;
        sv.priceTTC=calc.priceTTC; sv.costUnit=calc.costBase;
      });
    });
    // Variante dont Antho a CHOISI cette fiche (v.catalogId) mais qui n'a pas de ligne de la fiche (v.catalogVariantId vide) : ex. « 25CM » (taille) face à une fiche
    // « 1 pièce + Lot de 2 ». Rapprochement par SKU, par valeur/libellé, sinon par la SEULE ligne restante (hors lignes « Lot de N » prises par ses déclinaisons et
    // lignes déjà prises par une variante sœur) ; s'il y a plusieurs candidates on ne devine pas.
    Store.state.stockM.forEach(sp => sp.variants.forEach(sv => {
      if (Stock.parentOf(sp, sv) || sv.catalogId !== catalogId || sv.catalogVariantId) return;
      let cv = (sv.sku && enabledVars.find(x => x.sku && norm(x.sku) === norm(sv.sku))) || enabledVars.find(x => sameVar(x, sv));
      if (!cv) {
        const kids = sp.variants.filter(k => Stock.parentOf(sp, k) && Stock.parentOf(sp, k).id === sv.id).map(k => Stock.packQtyOf(k));
        const free = enabledVars.filter(x => !(x.mode === 'piece' && kids.includes(U.num(x.value))) && !sp.variants.some(o => o !== sv && !Stock.parentOf(sp, o) && o.catalogId === catalogId && o.catalogVariantId === x.id));
        if (free.length === 1) cv = free[0];
      }
      if (cv) sv.catalogVariantId = cv.id;
    }));
    // Variantes liées à cette fiche AU NIVEAU VARIANTE (produit stock non lié à la fiche) : prix/coût mis à jour
    // aussi (avant, seul le lien produit suivait → ex. « 25CM LOT 2 » restait à 7,50 € quand la fiche passait à 7,69 €).
    Store.state.stockM.forEach(sp => sp.variants.forEach(sv => {
      if (linked.includes(sp) || Stock.parentOf(sp, sv)) return;
      if (sv.catalogId === catalogId && sv.catalogVariantId && Stock.applyCatalogVariantPrice(sp, sv, cat, sv.catalogVariantId)) catChanged = true;
    }));
    // Déclinaisons dont la taille est liée à cette fiche.
    Store.state.stockM.forEach(sp => sp.variants.forEach(sv => {
      const par = Stock.parentOf(sp, sv); if (!par) return;
      if ((par.catalogId || sp.catalogId) === catalogId && Stock.resolveChild(sp, sv).catChanged) catChanged = true;
    }));
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

  /* 📑 Dupliquer un produit du stock (Antho 2026-10-18) : on part d'un produit existant (« Boudin cerf »), on change le nom (et la viande) → « Boudin sanglier » avec les mêmes formats.
     Gardés : formats, prix, seuils, étiquettes (poil, résistance…), déclinaisons (« sans stock propre » rebranchées sur les nouvelles variantes). Repartent vides : stock et lots, SKU (recalculés),
     lien site, lien au catalogue prix (la liaison reste un choix manuel). Annulable en un coup. */
  dupProduct(id) {
    const src = Store.state.stockM.find(x => x.id === id); if (!src) return;
    const S = Store.state.settings;
    U.modal({
      title: '📑 Dupliquer le produit', okLabel: 'Dupliquer',
      body: `<p class="muted" style="margin:0 0 10px;">Copie « <b>${U.esc(src.name)}</b> » avec ses ${src.variants.length} variante(s) : formats, prix et seuils sont gardés ; le stock, les SKU, le lien site et la liaison au catalogue prix repartent vides.</p>
        <div class="frow">
          <div class="fg" style="flex:2;"><label>Nom du nouveau produit</label><input id="dp_name" value="${U.esc(src.name)}" autofocus onfocus="this.select()"></div>
          <div class="fg"><label>Viande</label><select id="dp_meat">${(src.meatType && !S.meatTypes.some(m => m.toLowerCase() === src.meatType.toLowerCase()) ? `<option value="${U.esc(src.meatType)}" selected>${U.esc(src.meatType)} (hors liste)</option>` : '')}${S.meatTypes.slice().sort(U.sortFr).map(m => `<option ${(src.meatType || '').toLowerCase() === m.toLowerCase() ? 'selected' : ''}>${U.esc(m)}</option>`).join('')}</select></div>
        </div>`,
      onOk: () => {
        const name = U.val('dp_name').trim(), meat = U.val('dp_meat');
        if (!name) { U.toast('Indique le nom du nouveau produit.', true); return false; }
        if (Store.state.stockM.some(x => U.normSearch(x.name) === U.normSearch(name) && (x.meatType || '').toLowerCase() === meat.toLowerCase())) { U.toast('Un produit « ' + name + ' » (' + meat + ') existe déjà : change le nom ou la viande.', true); return false; }
        const c = JSON.parse(JSON.stringify(src)), ids = new Map();
        c.id = U.uid(); c.name = name; c.meatType = meat; c.catalogId = ''; c.url = '';
        c.variants.forEach(v => { const nid = U.uid(); ids.set(v.id, nid); v.id = nid; });
        c.variants.forEach(v => {
          v.lots = []; v.sku = ''; v.catalogId = ''; v.catalogVariantId = '';
          if (v.parentId) v.parentId = ids.get(v.parentId) || '';   // déclinaison : rebranchée sur la variante mère de la COPIE
        });
        c.variants.forEach(v => { v.sku = this.suggestSku(c, v); });   // base tirée du nouveau nom + format de chaque variante
        Store.state.stockM.push(c);
        const entry = Store.log('stock', `Produit dupliqué — ${src.name} → ${name} (${c.variants.length} variante(s))`, { type: 'restoreBatch', data: [{ domain: 'stockM', id: c.id, before: null }] });
        Store.save('stockM'); U.closeModal(); App.rerender();
        U.toast(`Produit « ${name} » créé (${c.variants.length} variante(s), sans stock).`, false, entry.id);
      }
    });
  },

  _pickRecv(val) {   // choix d'une réception d'achat dans « ＋ Ajouter un lot » → pré-remplit n° de lot et DLUO
    const r = (this._pend || []).find(x => x.pid + '|' + x.lid === val); if (!r) return;
    const n = document.getElementById('nl_num'), d = document.getElementById('nl_dluo');
    if (n) n.value = r.lot || ''; if (d) { d.value = r.dluo || ''; d.dispatchEvent(new Event('change')); }
  },
  addLot(pId, vId) {
    { const _p = Store.state.stockM.find(x => x.id === pId); const _v = _p && _p.variants.find(x => x.id === vId); if (this.isVirtual(_p, _v)) { U.toast('Cette variante n\'a pas de stock propre : ajoute le lot sur ' + Pricing.labelVariant(this.parentOf(_p, _v)) + '.', true); return; } }
    const p=Store.state.stockM.find(x=>x.id===pId); if(!p) return;
    const v=p.variants.find(x=>x.id===vId); if(!v) return;
    // Instantané pris AVANT le resync automatique ci-dessous, pour que l'Annulation
    // défasse aussi cet éventuel effet de bord silencieux, pas seulement l'ajout du lot.
    const snap=Store.snapshot('stockM',p);
    if(p.catalogId) this.syncPricesFromCatalog(p.catalogId);
    // Réceptions d'achat en attente pour ce produit (page Achats) : n° de lot + DLUO pré-remplis
    const pend = (typeof Achats !== 'undefined' && !App.isViewer && !App.isTeam) ? Achats.pendingFor(pId) : [];
    this._pend = pend;
    const one = pend.length === 1 ? pend[0] : null;
    U.modal({
      title:'＋ Lot — '+U.esc(p.name)+' › '+U.esc(Pricing.labelVariant(v)), okLabel:'Ajouter',
      body:`${pend.length ? `<div class="fg"><label>📥 Provenance (achat à ranger)</label><select id="nl_src" onchange="Stock._pickRecv(this.value)"><option value="">— aucune —</option>${pend.map(r=>`<option value="${r.pid}|${r.lid}" ${one?'selected':''}>${U.esc(r.label)}</option>`).join('')}</select></div>` : ''}
      <div class="fg"><label>N° de lot</label><input id="nl_num" placeholder="lot fournisseur" value="${one?U.esc(one.lot):''}"></div>
      ${U.datePickerHTML('nl_dluo','DLUO').replace('<input id="nl_dluo" type="date"', `<input id="nl_dluo" type="date" value="${one?U.esc(one.dluo):''}"`)}
      <div class="frow">
        <div class="fg"><label>Qté stock général</label><input id="nl_qg" type="number" step="${v.mode==='vrac'?'0.001':'1'}" min="0" value="0"></div>
        <div class="fg"><label>Qté stock événement</label><input id="nl_qe" type="number" step="${v.mode==='vrac'?'0.001':'1'}" min="0" value="0"></div>
      </div>`,
      onOk:()=>{
        // Le coût unitaire vient du prix d'achat déjà réglé sur la variante (colonne "Prix achat"
        // de la fiche produit) — pas besoin de le ressaisir à chaque lot.
        const newLot={id:U.uid(),lotNumber:U.val('nl_num'),dluo:U.val('nl_dluo'),qtyGeneral:U.numVal('nl_qg'),qtyEvent:U.numVal('nl_qe'),costUnit:U.num(v.costUnit),costFinal:true};
        v.lots.push(newLot);
        const srcVal=U.val('nl_src'); let entry;
        if(srcVal){   // lot issu d'une réception d'achat : on l'inscrit dans le tri de cette réception (annulable avec le lot)
          const [spid,slid]=srcVal.split('|'), psnap=Achats.snapPurchase(spid);
          newLot.src={pid:spid,lid:slid};
          Achats.addDist(spid,slid,{lotId:newLot.id,vId:v.id,qty:U.num(newLot.qtyGeneral)+U.num(newLot.qtyEvent)});
          entry=Store.log('stock',`Lot ajouté — ${p.name}/${Pricing.labelVariant(v)} (${U.val('nl_num')||'sans n°'}) · réception d'achat`,{type:'restoreBatch',data:[snap].concat(psnap?[psnap]:[])});
        } else entry=Store.commitSnapshot(snap,'stock',`Lot ajouté — ${p.name}/${Pricing.labelVariant(v)} (${U.val('nl_num')||'sans n°'})`);
        Store.save('stockM'); U.closeModal(); App.rerender();
        U.toast('Lot ajouté.', false, entry.id);
        // Fenêtre facultative de conditionnement (sachet) — « Fermer » pour passer.
        const units = U.num(newLot.qtyGeneral) + U.num(newLot.qtyEvent);
        if (units > 0 && this.packConsos().length) this.packLot(p.id, v.id, newLot.id);
      }
    });
  },

  /* ================= Conditionnement d'un lot (sachets) — 2026-09-26 =================
     Après « ＋ Ajouter un lot », fenêtre FACULTATIVE : quel sachet (consommable) a été utilisé,
     combien. Effets à la validation :
       - stock du consommable déduit (plancher 0) ;
       - le lot garde lot.pack = {consoId,name,dims,qty,unitCost,date} (historique → Stats Emballages) ;
       - v.lastSachetConsoId = repère « 📦 habituel » + pré-sélection la fois suivante ;
       - si la variante est liée à une fiche prix et que le sachet diffère de celui de la fiche :
         la fiche passe sur ce sachet MAIS son prix TTC est FIGÉ (priceTTCManual = prix actuel) —
         seuls coût/marge/cotisations/bénéfice bougent (règle d'Antho). La Revente pro reprend le
         même coût (remise inchangée) → badge critique si le coeff pro passe sous le seuil ;
       - le coût du lot (lot.costUnit) est recalé sur le nouveau coût de revient → bénéfice réel. */
  /* Options d'emballage proposées au conditionnement :
       - sachets = consommables de catégorie « Sachets » (clé 'c:<consoId>') ;
       - blisters = découpes du référentiel (largeur × longueur, clé 'b:<refId>'), coûtées depuis
         le rouleau lié (Params._syncPackagingCosts) et déduites du rouleau en mètres/cm/mm. */
  /* Marque « 🚩 à ne plus racheter » d'un consommable (c.toReplace / c.replaceBy / c.replaceNote),
     affichée dans la liste Consommables, Faible stock, la commande à passer et le conditionnement. */
  replaceInfo(c) {
    if (!c || !c.toReplace) return null;
    const by = c.replaceBy ? Store.state.consumables.find(x => x.id === c.replaceBy) : null;
    const txt = '🚩 Ne plus racheter' + (by ? ' → ' + by.name + (by.dimensions ? ' ' + by.dimensions : '') + (U.num(by.costUnit) ? ' (' + U.eur(by.costUnit) + ' au lieu de ' + U.eur(c.costUnit) + ')' : '') : '') + (c.replaceNote ? ' — ' + c.replaceNote : '');
    return { by, txt };
  },
  replaceBadge(c) {
    const r = this.replaceInfo(c);
    return r ? ` <span class="badge warn" style="font-size:.7rem;cursor:help;" title="${U.esc(r.txt)}">🚩${r.by ? ' → ' + U.esc(r.by.name) + (r.by.dimensions ? ' ' + U.esc(r.by.dimensions) : '') : ' à remplacer'}</span>` : '';
  },
  packOptions() {
    const all = Store.state.consumables || [];
    const sach = all.filter(c => (c.category || '').toLowerCase() === 'sachets');
    const sachets = (sach.length ? sach : all.filter(c => (c.category || '').toLowerCase() !== 'blisters'))
      .slice().sort((a, b) => U.sortFr(a.name + ' ' + (a.dimensions || ''), b.name + ' ' + (b.dimensions || '')))
      .map(c => ({ key: 'c:' + c.id, type: 'sachet', label: this.consoLabel(c), cost: U.num(c.costUnit), stock: U.num(c.qty) + ' pcs', conso: c, flag: c.toReplace }));
    const S = Store.state.settings, rolls = S.blisterRolls || {};
    Params._syncPackagingCosts();
    const blisters = (S.sachets || []).filter(s => s.type === 'blister').map(s => {
      const d = Params._blisterDims(s); if (!d) return null;
      const roll = rolls[String(d.widthMm)];
      const conso = roll && roll.consumableId ? all.find(c => c.id === roll.consumableId) : null;
      return { key: 'b:' + s.id, type: 'blister', ref: s, dims: d, label: 'Blister ' + d.widthStr + ' × ' + d.lengthStr, cost: U.num(s.cost), stock: conso ? U.qty(conso.qty) + ' ' + (conso.unit || 'm') : 'rouleau non lié', conso, flag: conso && conso.toReplace };
    }).filter(Boolean).sort((a, b) => a.dims.widthMm - b.dims.widthMm || a.dims.lengthMm - b.dims.lengthMm);
    return { sachets, blisters, all: sachets.concat(blisters) };
  },
  packConsos() { return this.packOptions().all; },
  consoLabel(c) { return c ? c.name + (c.dimensions ? ' · ' + c.dimensions : '') : '—'; },
  /* Quantité à retirer du rouleau pour n découpes, dans l'unité du consommable rouleau. */
  _blisterRollQty(dims, conso, n) {
    const unit = ((conso && conso.unit) || 'm').toLowerCase();
    const mm = dims.lengthMm * n;
    return unit === 'mm' ? mm : unit === 'cm' ? mm / 10 : mm / 1000;
  },
  /* Sachet « habituel » d'une variante = le plus utilisé de son historique (à égalité : le plus récent). */
  usualPack(v) {
    const h = v.packHistory || []; if (!h.length) return null;
    const cnt = {};
    h.forEach((e, i) => { const k = e.key || ('c:' + e.consoId); cnt[k] = cnt[k] || { n: 0, last: -1, e }; cnt[k].n++; cnt[k].last = i; cnt[k].e = e; });
    const best = Object.values(cnt).sort((a, b) => b.n - a.n || b.last - a.last)[0];
    const e = best.e;
    if (e.type === 'blister') return { name: e.name, dims: e.dims, n: best.n, total: h.length };
    const c = Store.state.consumables.find(x => x.id === e.consoId);
    return { name: c ? c.name : e.name, dims: c ? (c.dimensions || '') : e.dims, n: best.n, total: h.length };
  },
  _packCatInfo(p, v) {
    const cat = Store.state.catalogM.find(c => c.id === (v.catalogId || p.catalogId));
    if (!cat) return null;
    const enabled = (cat.variants || []).filter(x => x.enabled !== false);
    const cv = enabled.find(x => x.id === v.catalogVariantId);
    if (!cv) return null;
    const idx = enabled.indexOf(cv);
    const calc = Pricing.variantCalc(cat, cv, idx, Pricing.baseUnitCost(cat), enabled.length);
    const sac = Store.sachet(cv.sachetId);
    let key = '';
    if (sac) key = sac.type === 'blister' ? 'b:' + sac.id : (sac.consumableId ? 'c:' + sac.consumableId : 's:' + sac.id);
    return { cat, cv, calc, sachet: sac, key };
  },
  _packImpact(info, newSacCost) {
    const S = Store.state.settings, c = info.calc;
    const thr = U.num(S.b2bCoeffThreshold);
    if (typeof B2B !== 'undefined') B2B._loadDiscounts();
    const disc = typeof B2B !== 'undefined' ? B2B.effectiveDiscount(info.cat) : 0;
    const soc = U.num(S.socialTaxRate) / 100;
    const mk = cost => {
      const proHT = c.priceHT * (1 - (typeof B2B !== 'undefined' ? B2B.cappedDiscount(c.priceHT, cost, disc).applied : disc) / 100);   // remise plafonnée comme dans Revente pro
      return {
        cost,
        coeff: cost > 0 ? c.priceHT / cost : 0,
        profit: c.priceHT - cost - c.social,   // = profitAssujetti, comme tous les écrans (la TVA n'est pas retirée une 2e fois)
        coeffB2B: cost > 0 ? proHT / cost : 0,
        profitB2B: proHT - cost - proHT * soc
      };
    };
    const rc = 1 + Pricing.portRate('conso');   // le sachet porte aussi le port estimé « consommables »
    return { before: mk(c.cost), after: mk(c.cost + (newSacCost - c.sacCost) * rc), thr, disc, priceTTC: c.priceTTC };
  },
  packLot(pId, vId, lId) {
    const f = this.findLot(pId, vId, lId); if (!f) return;
    const { p, v, lot } = f;
    const po = this.packOptions();
    const info = this._packCatInfo(p, v);
    const def = v.lastPackKey || (v.lastSachetConsoId ? 'c:' + v.lastSachetConsoId : '') || (info && info.key) || '';
    const units = U.num(lot.qtyGeneral) + U.num(lot.qtyEvent);
    this._packCtx = { pId, vId, lId, units };
    const opt = o => `<option value="${o.key}" ${o.key === def ? 'selected' : ''} data-a="${U.esc((o.flag ? '🚩 ' : '') + o.label)}" data-b="stock ${U.esc(o.stock)}" data-c="${U.esc(U.eur(o.cost))}">${o.flag ? '🚩 ' : ''}${U.esc(o.label)} — ${U.eur(o.cost)} (stock ${U.esc(o.stock)})</option>`;
    const opts = (po.sachets.length ? `<optgroup label="Sachets">${po.sachets.map(opt).join('')}</optgroup>` : '')
      + (po.blisters.length ? `<optgroup label="Blisters (découpe)">${po.blisters.map(opt).join('')}</optgroup>` : '');
    U.modal({
      title: '📦 Conditionnement — ' + U.esc(p.name) + ' › ' + U.esc(Pricing.labelVariant(v)),
      okLabel: 'Valider', wide: !!info,
      body: `<p class="muted mb0">Facultatif : indique l'emballage utilisé pour ce lot. <b>Fermer</b> = passer (déjà conditionné / pas nécessaire).</p>
        <div class="frow mt">
          <div class="fg" style="flex:3;"><label>Sachet / blister utilisé</label><select id="pk_conso" onchange="Stock._packRefresh()"><option value="">— choisir —</option>${opts}</select></div>
          <div class="fg"><label>Nombre (sachets / découpes)</label><input id="pk_qty" type="number" step="1" min="0" value="${units}" oninput="Stock._packRefresh()"></div>
        </div>
        <div id="pk_impact"></div>`,
      onOk: () => this._packApply()
    });
    this._packRefresh();
  },
  _packSel() { const k = U.val('pk_conso'); return k ? this.packOptions().all.find(o => o.key === k) || null : null; },
  _packRefresh() {
    const box = document.getElementById('pk_impact'); if (!box || !this._packCtx) return;
    const f = this.findLot(this._packCtx.pId, this._packCtx.vId, this._packCtx.lId); if (!f) return;
    const o = this._packSel();
    const qty = U.numVal('pk_qty');
    let html = '';
    if (o && o.flag) html += `<p style="color:var(--warn,#e0a040);">🚩 Emballage marqué « à ne plus racheter »${o.conso && o.conso.replaceNote ? ' — ' + U.esc(o.conso.replaceNote) : ''}.</p>`;
    if (o && o.type === 'sachet' && qty > U.num(o.conso.qty)) html += `<p style="color:var(--alerte);">⚠️ Stock de ce sachet insuffisant (${U.num(o.conso.qty)} dispo) — il sera mis à 0.</p>`;
    if (o && o.type === 'blister') {
      if (!o.conso) html += `<p style="color:var(--alerte);">⚠️ Aucun rouleau lié à la largeur ${U.esc(o.dims.widthStr)} (Paramètres → Blisters) : rien ne sera déduit.</p>`;
      else { const need = this._blisterRollQty(o.dims, o.conso, qty); html += `<p class="muted">Rouleau « ${U.esc(o.conso.name)} » : ${U.qty(need)} ${U.esc(o.conso.unit || 'm')} à déduire (stock ${U.qty(o.conso.qty)}).${need > U.num(o.conso.qty) ? ' <span style="color:var(--alerte);">⚠️ insuffisant — mis à 0.</span>' : ''}</p>`; }
    }
    const info = this._packCatInfo(f.p, f.v);
    const sacLbl = info && info.sachet ? info.sachet.name + (info.sachet.type !== 'blister' && info.sachet.dims ? ' · ' + info.sachet.dims : '') : 'aucun';
    if (!info) { box.innerHTML = html + `<p class="muted">Pas de fiche prix liée à cette variante : l'emballage est seulement déduit et mémorisé.</p>`; return; }
    if (!o) { box.innerHTML = html + `<p class="muted">Emballage de la fiche prix actuelle : <b>${U.esc(sacLbl)}</b> (${U.eur(info.calc.sacCost)}).</p>`; return; }
    const im = this._packImpact(info, o.cost);
    const same = o.key === info.key;
    const dEur = (a, b, lowerIsGood) => { const x = b - a; if (Math.abs(x) < 0.0005) return '<span class="muted">=</span>'; const good = lowerIsGood ? x < 0 : x > 0; return `<b class="${good ? 'pos' : 'neg'}">${x > 0 ? '+' : ''}${U.eur(x)}</b>`; };
    const dCo = (a, b) => { const x = b - a; if (Math.abs(x) < 0.005) return '<span class="muted">=</span>'; return `<b class="${x > 0 ? 'pos' : 'neg'}">${x > 0 ? '+' : ''}${x.toFixed(2)}</b>`; };
    const cls = (coeff, profit) => (profit < 0 || coeff < im.thr) ? 'neg' : 'pos';
    const n = this._packCtx.units;
    const flags = [];
    if (im.after.profit < 0) flags.push('🔴 <b>Vente à perte</b> (prix public)');
    else if (im.after.coeff < im.thr) flags.push(`🟠 <b>Coeff critique</b> (prix public sous ${im.thr})`);
    if (im.after.profitB2B < 0) flags.push('🔴 <b>Vente à perte en revente pro</b>');
    else if (im.after.coeffB2B < im.thr) flags.push(`🟠 <b>Coeff pro critique</b> (sous ${im.thr} avec ta remise de ${im.disc} %) — pense à baisser la remise ou revoir le prix`);
    box.innerHTML = html + `
      <div class="table-wrap mt"><table>
        <thead><tr><th></th><th class="num">Emballage de la fiche<br><span class="muted">${U.esc(sacLbl)} · ${U.eur(info.calc.sacCost)}</span></th><th class="num">Emballage choisi<br><span class="muted">${U.esc(o.label)} · ${U.eur(o.cost)}</span></th><th class="num">Écart</th></tr></thead>
        <tbody>
          <tr><td>Prix de vente TTC</td><td class="num">${U.eur(im.priceTTC)}</td><td class="num">${U.eur(im.priceTTC)}</td><td class="num muted">inchangé</td></tr>
          <tr><td>Coût de revient / unité</td><td class="num">${U.eur(im.before.cost)}</td><td class="num">${U.eur(im.after.cost)}</td><td class="num">${dEur(im.before.cost, im.after.cost, true)}</td></tr>
          <tr><td>Coeff public</td><td class="num">${im.before.coeff.toFixed(2)}</td><td class="num ${cls(im.after.coeff, im.after.profit)}">${im.after.coeff.toFixed(2)}</td><td class="num">${dCo(im.before.coeff, im.after.coeff)}</td></tr>
          <tr><td>Bénéfice / unité</td><td class="num">${U.eur(im.before.profit)}</td><td class="num ${im.after.profit >= 0 ? 'pos' : 'neg'}">${U.eur(im.after.profit)}</td><td class="num">${dEur(im.before.profit, im.after.profit)}</td></tr>
          <tr><td>Bénéfice sur le lot (${n} u.)</td><td class="num">${U.eur(im.before.profit * n)}</td><td class="num ${im.after.profit >= 0 ? 'pos' : 'neg'}">${U.eur(im.after.profit * n)}</td><td class="num">${dEur(im.before.profit * n, im.after.profit * n)}</td></tr>
          <tr><td>Coeff pro (remise ${im.disc} %)</td><td class="num">${im.before.coeffB2B.toFixed(2)}</td><td class="num ${cls(im.after.coeffB2B, im.after.profitB2B)}">${im.after.coeffB2B.toFixed(2)}</td><td class="num">${dCo(im.before.coeffB2B, im.after.coeffB2B)}</td></tr>
          <tr><td>Bénéfice pro / unité</td><td class="num">${U.eur(im.before.profitB2B)}</td><td class="num ${im.after.profitB2B >= 0 ? 'pos' : 'neg'}">${U.eur(im.after.profitB2B)}</td><td class="num">${dEur(im.before.profitB2B, im.after.profitB2B)}</td></tr>
        </tbody></table></div>
      ${flags.length ? `<p class="mt" style="color:var(--alerte);">${flags.join('<br>')}</p>` : `<p class="mt pos">✅ Au-dessus de ton seuil critique (${im.thr}).</p>`}
      <p class="muted" style="font-size:.82rem;">${same ? 'Même emballage que la fiche prix : rien ne change dans les prix.' : 'En validant, la fiche prix passe sur cet emballage : prix TTC figé, coût/marges recalculés (Prix mastication + Revente pro).'}</p>`;
  },
  _packApply() {
    const ctx = this._packCtx; if (!ctx) return;
    const f = this.findLot(ctx.pId, ctx.vId, ctx.lId); if (!f) return;
    const o = this._packSel();
    if (!o) { U.toast('Choisis un sachet / blister, ou « Fermer » pour passer.', true); return false; }
    const qty = Math.max(0, Math.round(U.numVal('pk_qty')));
    const { p, v, lot } = f;
    const info = this._packCatInfo(p, v);
    const snaps = [Store.snapshot('stockM', p)];
    if (o.conso) snaps.push(Store.snapshot('consumables', o.conso));
    const changeFiche = !!info && o.key !== info.key;
    if (changeFiche) snaps.push(Store.snapshot('catalogM', info.cat));
    // 1) déduction (jamais négatif) : sachet à la pièce, blister = longueur sur le rouleau
    if (o.conso) {
      const take = o.type === 'blister' ? this._blisterRollQty(o.dims, o.conso, qty) : qty;
      o.conso.qty = Math.max(0, Math.round((U.num(o.conso.qty) - take) * 1000) / 1000);
    }
    // 2) fiche prix : passe sur cet emballage, prix TTC figé
    if (changeFiche) {
      const S = Store.state.settings;
      let sac;
      if (o.type === 'blister') sac = o.ref;
      else {
        sac = (S.sachets || []).find(x => (x.type || 'sachet') === 'sachet' && x.consumableId === o.conso.id);
        if (!sac) { sac = { id: U.uid(), name: o.conso.name, type: 'sachet', cost: U.num(o.conso.costUnit), dims: o.conso.dimensions || '', consumableId: o.conso.id }; S.sachets.push(sac); }
      }
      if (!(U.num(info.cv.priceTTCManual) > 0)) info.cv.priceTTCManual = Math.round(info.calc.priceTTC * 100) / 100;
      info.cv.sachetId = sac.id;
      Params._renameSachets();
      this.syncPricesFromCatalog(info.cat.id);
      Store.save('settings', 'catalogM');
    }
    // 3) historique (lot + variante, durable) + coût réel du lot
    lot.pack = o.type === 'blister'
      ? { type: 'blister', key: o.key, refId: o.ref.id, consoId: o.conso ? o.conso.id : '', name: o.label, dims: o.dims.widthStr + '×' + o.dims.lengthStr, widthMm: o.dims.widthMm, lengthMm: o.dims.lengthMm, qty, unitCost: o.cost, date: U.today() }
      : { type: 'sachet', key: o.key, consoId: o.conso.id, name: o.conso.name, dims: o.conso.dimensions || '', qty, unitCost: o.cost, date: U.today() };
    if (info) { const fresh = this._packCatInfo(p, v); if (fresh) { lot.costUnit = fresh.calc.costBase; lot.costFinal = true; } }
    v.lastPackKey = o.key;
    if (o.type === 'sachet') v.lastSachetConsoId = o.conso.id;
    // Historique durable sur la VARIANTE (les lots vides sont supprimés après vente).
    (v.packHistory = v.packHistory || []).push({ ...lot.pack, lotNumber: lot.lotNumber || '' });
    const entry = Store.log('stock', `Lot conditionné — ${p.name}/${Pricing.labelVariant(v)} : ${qty} × ${o.label}` + (changeFiche ? ' (fiche prix mise à jour)' : ''), { type: 'restoreBatch', data: snaps });
    Store.save('stockM', 'consumables'); U.closeModal(); App.rerender();
    U.toast('Conditionnement enregistré' + (changeFiche ? ' — fiche prix passée sur cet emballage (prix TTC inchangé).' : '.'), false, entry.id);
  },

  /* ─── Rappel / pense-bête sur un lot (2026-09-26) ───
     Double-clic sur la cellule Péremption d'un lot → date + note libre (ex : « mettre en promo »,
     « recommander »). lot.reminder = {date, note}. Affiché sous la DLUO (rouge quand l'échéance est
     atteinte), badge « 🔔 Rappel » sur le produit, filtre « Rappels » dans Mastication. */
  reminderDue(l) { return !!(l && l.reminder && l.reminder.date && l.reminder.date <= U.today() && (U.num(l.qtyGeneral) + U.num(l.qtyEvent)) > 0); },
  reminderTag(l) {
    const r = l && l.reminder; if (!r || !r.date) return '';
    const due = r.date <= U.today();
    return `<div style="margin-top:4px;font-size:.75rem;${due ? 'color:var(--alerte);font-weight:600;' : 'color:var(--caramel);'}" title="Rappel — double-clic pour modifier">🔔 ${U.frDate(r.date)}${r.note ? ' · ' + U.esc(r.note) : ''}</div>`;
  },
  editReminder(pId, vId, lId) {
    const f = this.findLot(pId, vId, lId); if (!f) return;
    const r = f.lot.reminder || {};
    U.modal({
      title: '🔔 Rappel — ' + U.esc(f.p.name) + ' › ' + U.esc(Pricing.labelVariant(f.v)) + ' (lot ' + U.esc(f.lot.lotNumber || 'sans n°') + ')',
      okLabel: 'Enregistrer',
      body: `<p class="muted mb0">Pense-bête daté : mise en promo, recommande, vérification…</p>
        ${U.datePickerHTML('rm_date', 'Date du rappel')}
        <div class="fg"><label>Note</label><textarea class="note-area" id="rm_note" rows="1" placeholder="ex : mettre en réduction, recommander…">${U.esc(r.note || '')}</textarea></div>
        ${r.date ? `<button class="btn-ghost btn-sm" onclick="Stock._delReminder('${pId}','${vId}','${lId}')">🗑️ Supprimer ce rappel</button>` : ''}`,
      onOk: () => {
        const d = U.val('rm_date');
        if (!d) { U.toast('Choisis une date (ou « Fermer »).', true); return false; }
        const snap = Store.snapshot('stockM', f.p);
        f.lot.reminder = { date: d, note: U.val('rm_note').trim() };
        const entry = Store.commitSnapshot(snap, 'stock', `Rappel ${U.frDate(d)} — ${f.p.name}/${Pricing.labelVariant(f.v)}`);
        Store.save('stockM'); U.closeModal(); App.rerender();
        U.toast('Rappel enregistré.', false, entry.id);
      }
    });
    const inp = document.getElementById('rm_date');
    if (inp && r.date) { inp.value = r.date; U.datePickerSync('rm_date'); }
  },
  _delReminder(pId, vId, lId) {
    const f = this.findLot(pId, vId, lId); if (!f) return;
    const snap = Store.snapshot('stockM', f.p);
    delete f.lot.reminder;
    const entry = Store.commitSnapshot(snap, 'stock', `Rappel supprimé — ${f.p.name}/${Pricing.labelVariant(f.v)}`);
    Store.save('stockM'); U.closeModal(); App.rerender();
    U.toast('Rappel supprimé.', false, entry.id);
  },

  async delLot(pId,vId,lId){
    const f=this.findLot(pId,vId,lId); if(!f) return;
    if(!await U.confirm('Supprimer ce lot ?')) return;
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
          <input id="tl_qty" type="number" step="${f.v.mode==='vrac'?'0.001':'1'}" min="0" value="" oninput="Stock.updateTransferPreview(${genStart},${evtStart},'${dir}')"></div>
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
    const targets=p.variants.filter(v=>v.mode!=='vrac').sort((x,y)=>U.sortFr(Pricing.labelVariant(x),Pricing.labelVariant(y)));
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
        if(!dest){dest={id:U.uid(),lotNumber:f.lot.lotNumber,dluo:f.lot.dluo,qtyGeneral:0,qtyEvent:0,costUnit:U.num(tv.costUnit)||U.num(f.lot.costUnit),...((U.num(tv.costUnit)||f.lot.costFinal)?{costFinal:true}:{})};tv.lots.push(dest);}
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

    // Compte lecture seule (viewer) : les lots EXPIRÉS ne sont jamais montrés (demande d'Antho,
    // 2026-09-26) ; le profil équipe et l'admin les voient normalement.
    const hideExpired = !!(window.App && App.isViewer);
    if (hideExpired && f.horizon === 'expired') f.horizon = '3';
    let rows = this.allLotRows().filter(r => {
      if (viewQty(r) <= 0) return false;
      if (hideExpired && r.days < 0) return false;
      if (f.q && !U.has(r.p.name, f.q)) return false;
      if (f.meat && f.meat !== 'all' && (r.p.meatType || '').toLowerCase() !== f.meat.toLowerCase()) return false;
      if (f.variants.length && !f.variants.includes(r.label)) return false;
      if (f.horizon === 'multi') return multiSet.has(r.p.id + '|' + r.v.id);
      if (f.horizon === 'expired') return r.days < 0;
      if (f.horizon === '1') return r.days <= 30;
      if (f.horizon === '3') return r.days <= 90;
      if (f.horizon === '6') return r.days <= 180;
      if (f.horizon === '9') return r.days <= 270;
      return true; // 'all'
    });
    // UN BLOC PAR PRODUIT (Antho 2026-10-11) : le nom et la viande ne s'écrivent qu'une fois, les lots/variantes en dessous.
    // Le tri choisi ordonne les blocs (date : produit dont le lot expire le plus tôt en tête ; stock : total du produit…) et les lignes dans chaque bloc.
    const dir = f.sortDir === 'desc' ? -1 : 1;
    const byProd = new Map();
    rows.forEach(r => { let g = byProd.get(r.p.id); if (!g) byProd.set(r.p.id, g = { p: r.p, rows: [] }); g.rows.push(r); });
    const inner = (a, b) => f.sort === 'variant' ? dir * U.sortFr(a.label, b.label)
      : f.sort === 'stock' ? dir * (viewQty(a) - viewQty(b))
      : (f.sort === 'days' || f.sort === 'status') ? dir * (a.days - b.days)   // le statut suit strictement la DLUO restante
      : (U.sortFr(a.label, b.label) || (a.days - b.days));   // tri Produit / Type viande : variantes dans l'ordre, DLUO la plus courte en tête
    const groups = [...byProd.values()];
    groups.forEach(g => { g.rows.sort(inner); g.minDays = Math.min(...g.rows.map(r => r.days)); g.qty = g.rows.reduce((s, r) => s + viewQty(r), 0); });
    groups.sort((a, b) => {
      if (f.sort === 'meat') return dir * U.sortFr(a.p.meatType || '', b.p.meatType || '') || U.sortFr(a.p.name, b.p.name);
      if (f.sort === 'stock') return dir * (a.qty - b.qty);
      if (f.sort === 'days' || f.sort === 'status') return dir * (a.minDays - b.minDays) || U.sortFr(a.p.name, b.p.name);
      if (f.sort === 'variant') return dir * U.sortFr(a.rows[0].label, b.rows[0].label) || U.sortFr(a.p.name, b.p.name);
      return dir * U.sortFr(a.p.name, b.p.name);
    });
    rows = groups.flatMap(g => g.rows);
    this._peremRowsCache = rows;
    const allChecked = rows.every(r => !f.excluded.includes(this.peremKey(r)));
    const sortHead = (key, label) => `<span class="sortable ${f.sort===key?'active':''}" onclick="Stock.setPeremSort('${key}')">${label} ${f.sort===key?(f.sortDir==='asc'?'▲':'▼'):'⇕'}</span>`;

    document.getElementById('stockBody').innerHTML = `
      <div class="card" style="padding:12px 16px;">
        <label style="display:block;margin-bottom:6px;">Stock à vérifier</label>
        <div style="margin-bottom:12px;">${U.seg([['general', '🏬 Stock Général'], ['event', '🎪 Stock Événement'], ['both', '🧺 Général + événement (total)']].map(([k, l]) => ({ l, on: f.view === k, js: `Stock._setPeremView('${k}')` })), { full: true, scroll: true, label: 'Stock à vérifier' })}</div>
        <div class="grid c4">
          <div class="fg mb0"><label>Recherche</label><input id="stock_q_perem" value="${U.esc(f.q)}" placeholder="nom du produit…" oninput="Stock.perem.q=this.value;Stock.renderPeremptions();U.refocus('stock_q_perem')"></div>
          <div class="fg mb0"><label>Type de viande</label>${U.meatFilter({ current: f.meat || 'all', meats: Store.state.settings.meatTypes || [], count: Store.state.stockM.length, setter: 'Stock._setPeremMeat', openState: this._peremMeatOpen, openSetter: 'Stock._peremMeatOpen' })}</div>
          <div class="fg mb0"><label>Variantes</label>${U.multiSelect({ groups: varGroups, selected: f.variants, toggle: 'Stock.peremToggleVariant', setAll: 'Stock.peremSetAllVariant', open: f.variantsOpen, onOpen: 'Stock.peremSetOpen' })}</div>
          <div class="fg mb0"><label>Horizon</label>${U.customSelect({ value: f.horizon, options: [...((window.App && App.isViewer) ? [] : [{v:'expired',l:'Lots expirés'}]),{v:'1',l:'Expire dans 1 mois'},{v:'3',l:'Expire dans 3 mois'},{v:'6',l:'Expire dans 6 mois'},{v:'9',l:'Expire dans 9 mois'},{v:'all',l:'Afficher tout (avec date)'},{v:'multi',l:'🔀 Plusieurs lots (même variante)'}], onPick: 'Stock._setPeremHorizon' })}</div>
        </div>
        ${f.horizon === 'multi'
          ? `<p class="muted mb0" style="border-left:3px solid var(--warn);padding-left:8px;">🔀 <b>Produits à plusieurs numéros de lot</b> dans le ${f.view==='event'?'stock ÉVÉNEMENT':f.view==='both'?'stock TOTAL (général + événement)':'stock général'} — pense à vendre la <b>DLUO la plus courte en premier</b>. Coche puis imprime pour ta feuille de marché.</p>`
          : `<p class="muted mb0">Coche les lignes à inclure dans l'impression — toutes sont cochées par défaut.</p>`}
        <div class="frow mt" style="gap:6px;align-items:center;">
          <button class="btn-cta btn-sm" onclick="U.printLight()">🖨 Imprimer la sélection</button>
          ${U.seg([{ l: '☑ Tout cocher', js: 'Stock.peremSetAllSel(true)' }, { l: '☐ Tout décocher', js: 'Stock.peremSetAllSel(false)' }], { sm: true })}
          <span class="muted" style="margin-left:auto;">${rows.length} lot(s)</span>
        </div>
      </div>
      <div class="card">
        <div class="perem-mob no-print">${this._peremMobHTML(groups, viewQty, viewLabel)}</div>
        <div class="table-wrap perem-desk"><table>
          <thead><tr><th class="no-print"><input type="checkbox" ${allChecked?'checked':''} onchange="Stock.peremSetAllSel(this.checked)"></th><th class="col-name">${sortHead('name','Produit')}</th><th>${sortHead('meat','Type viande')}</th><th>${sortHead('variant','Variante')}</th><th>N° lot</th><th>${sortHead('days','Date péremption')}</th><th class="num">${sortHead('stock','Stock ('+viewLabel+')')}</th><th>${sortHead('status','Statut')}</th><th class="no-print"></th></tr></thead>
          ${groups.map((g, gi) => {
            const rs = g.rows.map(r => { const key = this.peremKey(r); return { r, key, on: !f.excluded.includes(key) }; });
            let first = rs.findIndex(x => x.on); if (first < 0) first = 0;   // le nom fusionné est porté par la 1re ligne COCHÉE (les lignes décochées ne s'impriment pas)
            return `<tbody class="perem-prod${gi % 2 ? ' alt' : ''}">` + rs.map((x, i) => `<tr class="${x.on ? '' : 'excluded-from-print'}">
            <td class="no-print"><input type="checkbox" ${x.on ? 'checked' : ''} onchange="Stock.peremToggleSel('${x.key}')"></td>
            ${i <= first ? `<td class="col-name perem-name"${i === first ? ` rowspan="${rs.length - first}"` : ''}><b>${U.esc(g.p.name)}</b></td>
            <td class="perem-name"${i === first ? ` rowspan="${rs.length - first}"` : ''}><span class="badge info">${U.esc(g.p.meatType || '—')}</span></td>` : ''}
            <td>${U.esc(x.r.label)}</td>
            <td><span class="tag">${U.esc(x.r.l.lotNumber || 'sans n°')}</span></td>
            <td>${U.frDate(x.r.l.dluo)}</td>
            <td class="num">${U.qty(viewQty(x.r))}</td>
            <td>${this.dluoStatusBadge(x.r.days)}</td>
            <td class="no-print" style="white-space:nowrap;">${this._peremAddBtn(x.r)}</td>
          </tr>`).join('') + '</tbody>';
          }).join('') || '<tbody><tr><td colspan="9" class="muted">Aucun lot pour ces filtres.</td></tr></tbody>'}
        </table></div>
      </div>`;
  },
  _peremAddBtn(r) {   // bouton simple (pas de compteur : il serait périmé dès que le panier change ailleurs) ; le toast confirme l'ajout
    return `<button class="btn-ghost btn-sm pm-add" onclick="Stock.peremToBasket('${r.p.id}','${r.v.id}','${r.l.id}')" title="Ajouter ce lot au panier en cours (page Paniers)">🧺 Ajouter</button>`;
  },
  peremToBasket(pId, vId, lId) {
    Paniers._draft();   // charge d'abord le brouillon enregistré (client, budget…) pour ne pas l'écraser
    Paniers.pickManual(pId, vId, lId, 'M', true);
    const row = this._peremRowsCache.find(r => r.p.id === pId && r.v.id === vId && r.l.id === lId);
    if (!row) return;
    U.toast('🧺 ' + row.p.name + ' ' + row.label + ' ajouté au panier.');
  },
  /* Téléphone : une fiche par produit, une ligne par lot (le tableau à cellules fusionnées ne tient pas sur 375 px) */
  _peremMobHTML(groups, viewQty, viewLabel) {
    const ex = this.perem.excluded || [];
    if (!groups.length) return '<p class="muted">Aucun lot pour ces filtres.</p>';
    const so = [['days', 'Date de péremption'], ['name', 'Produit'], ['meat', 'Type de viande'], ['variant', 'Variante'], ['stock', 'Stock']];
    return `<div class="pm-sort"><label>Trier par</label><select onchange="Stock.setPeremSortTo(this.value)">${so.map(([k, l]) => `<option value="${k}" ${this.perem.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn-ghost btn-sm fit" onclick="Stock.setPeremSort(Stock.perem.sort)" title="Inverser l'ordre">${this.perem.sortDir === 'asc' ? '▲' : '▼'}</button></div>` + groups.map(g => `<div class="pm-card"><div class="pm-head"><b>${U.esc(g.p.name)}</b><span class="badge info">${U.esc(g.p.meatType || '—')}</span></div>${g.rows.map(r => {
      const key = this.peremKey(r), on = !ex.includes(key);
      return `<div class="pm-row${on ? '' : ' off'}"><input type="checkbox" ${on ? 'checked' : ''} onchange="Stock.peremToggleSel('${key}')" aria-label="Inclure dans l'impression">
        <div class="pm-main"><div><b>${U.esc(r.label)}</b> <span class="tag">${U.esc(r.l.lotNumber || 'sans n°')}</span></div><div class="pm-sub">${U.frDate(r.l.dluo)} · stock ${viewLabel} ${U.qty(viewQty(r))} ${this.dluoStatusBadge(r.days)}</div></div>${this._peremAddBtn(r)}</div>`;
    }).join('')}</div>`).join('');
  },
  setPeremSortTo(key) { this.perem.sort = key; this.perem.sortDir = 'asc'; this.renderPeremptions(); },
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
        rows.push({ key: this.ftKey('M', p.id, v.id), pk: 'M|' + p.id, kind: 'M', cat: 'Mastication', produit: p.name, meat: p.meatType || '', variante: label, ref: v.ref || '', qg, qe, total: qg + qe, minG: U.num(v.low), minE: U.num(v.lowEvent), pid: p.id, vid: v.id, noReo: !this.reorderOn(p, v) });
      }));
    }
    if (!eventView && (typeEff === 'all' || typeEff === 'materiaux')) {
      Store.state.materials.forEach(m => {
        rows.push({ key: this.ftKey('MT', m.id), pk: 'MT|' + U.normSearch(m.product || m.name), kind: 'MT', cat: 'Matière première', produit: m.product || m.name, meat: '', variante: m.variant || m.name, ref: '', qg: U.num(m.qty), qe: 0, total: U.num(m.qty), minG: U.num(m.low), minE: 0 });
      });
    }
    if (!eventView && (typeEff === 'all' || typeEff === 'conso')) {
      Store.state.consumables.forEach(c => {
        rows.push({ key: this.ftKey('C', c.id), pk: 'C|' + c.id, kind: 'C', cid: c.id, cat: 'Consommable', produit: c.name, meat: '', variante: '—', ref: '', qg: U.num(c.qty), qe: 0, total: U.num(c.qty), minG: U.num(c.low), minE: 0 });
      });
    }

    // Métrique active selon la vue
    const stockOf = (r) => view === 'event' ? r.qe : view === 'total' ? r.total : r.qg;
    // Seuil de commande (Antho 2026-10-19) : le stock TOTAL (général + événement) est comparé au mini GÉNÉRAL ; le mini événement ne sert qu'à recharger la boîte de marché (vue Événement)
    const minOf = (r) => view === 'event' ? r.minE : r.minG;
    const viewLabel = view === 'event' ? 'évén.' : view === 'total' ? 'total' : 'gén.';

    // Ne garder que les lignes ayant un seuil défini pour la vue (sinon pas d'alerte pertinente)
    rows = rows.filter(r => minOf(r) > 0);
    // Formats qui « ne comptent pas pour la commande » (case du Stock) : cachés de la liste « faible / rupture », visibles (grisés) avec « Tout afficher » ; sans effet sur la vue Événement
    rows = rows.filter(r => eventView || !r.noReo || f.status === 'all');
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
    // Un bloc par PRODUIT (nom, catégorie et viande écrits une fois, variantes dessous), comme Péremptions ; l'ordre des blocs suit le tri choisi (1re ligne de chaque produit)
    const groups = [], gmap = {};
    rows.forEach(r => { if (!gmap[r.pk]) { gmap[r.pk] = { pk: r.pk, rows: [] }; groups.push(gmap[r.pk]); } gmap[r.pk].rows.push(r); });
    const sortHead = (key, label) => `<span class="sortable ${f.sort === key ? 'active' : ''}" onclick="Stock.setFaibleSort('${key}')">${label} ${f.sort === key ? (f.sortDir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
    const btn = (v, l) => ({ l, on: view === v, js: `Stock._setFaibleView('${v}')` });

    const filters = `
      ${eventView ? '' : `<div style="margin-bottom:12px;">${U.seg([['all', '📋 Tout'], ['mastication', '🥩 Mastication'], ['materiaux', '🧵 Matières premières'], ['conso', '📦 Consommables']].map(([v, l]) => ({ l, on: f.type === v, js: `Stock._setFaibleType('${v}')` })), { full: true, scroll: true, label: 'Type de produit' })}</div>`}
      <div class="grid c2">
        <div class="fg mb0"><label>Variantes</label>${U.multiSelect({ groups: varGroups, selected: f.variants, toggle: 'Stock.faibleToggleVariant', setAll: 'Stock.faibleSetAllVariant', open: f.variantsOpen, onOpen: 'Stock.faibleSetOpen' })}</div>
        <div class="fg mb0"><label>Statut</label>${U.customSelect({ value: f.status, options: [{ v: 'low', l: 'Stock faible (qté > 0)' }, { v: 'out', l: 'Rupture de stock' }, { v: 'all', l: 'Tout afficher' }], onPick: 'Stock._setFaibleStatus' })}</div>
      </div>`;

    let table;
    if (eventView) {
      table = `<table>
        <thead><tr><th class="no-print"><input type="checkbox" ${allEvtChecked ? 'checked' : ''} onchange="Stock.faibleSetAllExcluded(this.checked)"></th><th class="col-name">${sortHead('name', 'Produit')}</th><th>${sortHead('meat', 'Type viande')}</th><th>${sortHead('variant', 'Variante')}</th><th class="num">${sortHead('stock', 'Stock évén.')}</th><th class="num">${sortHead('min', 'Seuil min évén.')}</th><th class="num">${sortHead('gen', 'Stock général dispo.')}</th><th>${sortHead('status', 'Statut')}</th></tr></thead>
        ${groups.map((g, gi) => {
          const rs = g.rows.map(r => ({ r, on: !f.excluded.includes(r.key) }));
          let first = rs.findIndex(x => x.on); if (first < 0) first = 0;   // nom fusionné porté par la 1re ligne COCHÉE (les décochées ne s'impriment pas)
          return `<tbody class="perem-prod${gi % 2 ? ' alt' : ''}">` + rs.map((x, i) => `<tr class="${x.on ? '' : 'excluded-from-print'}">
          <td class="no-print"><input type="checkbox" ${x.on ? 'checked' : ''} onchange="Stock.faibleToggleExcluded('${x.r.key}')"></td>
          ${i <= first ? `<td class="col-name perem-name"${i === first ? ` rowspan="${rs.length - first}"` : ''}>${this._faibleName(x.r)}</td>
          <td class="perem-name"${i === first ? ` rowspan="${rs.length - first}"` : ''}>${x.r.meat ? `<span class="badge info">${U.esc(x.r.meat)}</span>` : '—'}</td>` : ''}
          <td>${U.esc(x.r.variante)}</td>
          <td class="num">${U.qty(x.r.qe)}</td>
          <td class="num">${U.qty(x.r.minE)}</td>
          <td class="num ${x.r.qg > 0 ? 'pos' : ''}">${U.qty(x.r.qg)}</td>
          <td>${x.r.qe <= 0 ? '<span class="badge bad">Rupture</span>' : '<span class="badge warn">Stock faible</span>'}</td>
        </tr>`).join('') + '</tbody>';
        }).join('') || '<tbody><tr><td colspan="8" class="muted">Aucun résultat pour ces filtres.</td></tr></tbody>'}
      </table>`;
    } else {
      table = `<table>
        <thead><tr><th class="no-print"><input type="checkbox" ${rows.length && f.sel.length === rows.length ? 'checked' : ''} onchange="Stock.faibleSetAllSel(this.checked)"></th><th>${sortHead('cat', 'Catégorie')}</th><th class="col-name">${sortHead('name', 'Produit')}</th><th>${sortHead('meat', 'Type viande')}</th><th>${sortHead('variant', 'Variante principale')}</th><th class="num">${sortHead('min', view === 'total' ? 'Mini général' : 'Stock minimal')}</th><th class="num">${sortHead('stock', 'Stock (' + viewLabel + ')')}</th><th>${sortHead('status', 'Statut')}</th></tr></thead>
        ${groups.map((g, gi) => {
          const r0 = g.rows[0], rsp = ` rowspan="${g.rows.length}"`;
          return `<tbody class="perem-prod${gi % 2 ? ' alt' : ''}">` + g.rows.map((r, i) => `<tr>
          <td class="no-print"><input type="checkbox" ${f.sel.includes(r.key) ? 'checked' : ''} onchange="Stock.faibleToggleSel('${r.key}')"></td>
          ${i === 0 ? `<td class="perem-name"${rsp}><span class="badge info">${U.esc(r0.cat)}</span></td>
          <td class="col-name perem-name"${rsp}>${this._faibleName(r0)}${r0.kind === 'C' ? this.replaceBadge(Store.state.consumables.find(x => x.id === r0.cid)) : ''}</td>
          <td class="perem-name"${rsp}>${r0.meat ? `<span class="badge info">${U.esc(r0.meat)}</span>` : '—'}</td>` : ''}
          <td>${U.esc(r.variante)}</td>
          <td class="num">${U.qty(minOf(r))}</td>
          <td class="num">${U.qty(stockOf(r))}</td>
          <td style="white-space:nowrap;">${this._faibleStatus(r, stockOf(r), minOf(r))}${r.kind === 'M' ? this._reoBtn(r) : ''}</td>
        </tr>`).join('') + '</tbody>';
        }).join('') || '<tbody><tr><td colspan="8" class="muted">Aucun résultat pour ces filtres.</td></tr></tbody>'}
      </table>`;
    }

    // Téléphone : une fiche par produit, une ligne par variante (le tableau à cellules fusionnées ne tient pas sur 375 px)
    const so = [['gap', 'Écart au seuil'], ['name', 'Produit'], ...(eventView ? [] : [['cat', 'Catégorie']]), ['meat', 'Type de viande'], ['stock', 'Stock'], ['status', 'Statut']];
    const mobSort = `<div class="pm-sort"><label>Trier par</label><select onchange="Stock.setFaibleSortTo(this.value)">${so.map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn-ghost btn-sm fit" onclick="Stock.setFaibleSort(Stock.faible.sort)" title="Inverser l'ordre">${f.sortDir === 'asc' ? '▲' : '▼'}</button></div>`;
    const mob = !groups.length ? '<p class="muted">Aucun résultat pour ces filtres.</p>' : mobSort + groups.map(g => {
      const r0 = g.rows[0];
      return `<div class="pm-card"><div class="pm-head">${this._faibleName(r0)}${r0.kind === 'C' ? this.replaceBadge(Store.state.consumables.find(x => x.id === r0.cid)) : ''}<span style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">${eventView ? '' : `<span class="badge info">${U.esc(r0.cat)}</span>`}${r0.meat ? `<span class="badge info">${U.esc(r0.meat)}</span>` : ''}</span></div>${g.rows.map(r => {
        const on = eventView ? !f.excluded.includes(r.key) : f.sel.includes(r.key);
        const s = stockOf(r);
        const sub = `seuil ${U.qty(minOf(r))} · stock ${viewLabel} ${U.qty(s)}${eventView ? ` · gén. dispo ${U.qty(r.qg)}` : ''}`;
        return `<div class="pm-row${eventView && !on ? ' off' : ''}"><input type="checkbox" ${on ? 'checked' : ''} onchange="${eventView ? 'Stock.faibleToggleExcluded' : 'Stock.faibleToggleSel'}('${r.key}')" aria-label="${eventView ? 'Inclure dans l\'impression' : 'Ajouter à la commande'}">
          <div class="pm-main">${r.variante && r.variante !== '—' ? `<div><b>${U.esc(r.variante)}</b></div>` : ''}<div class="pm-sub">${sub}</div></div><span style="display:flex;align-items:center;gap:4px;">${eventView ? (s <= 0 ? '<span class="badge bad">Rupture</span>' : '<span class="badge warn">Stock faible</span>') : this._faibleStatus(r, s, minOf(r))}${!eventView && r.kind === 'M' ? this._reoBtn(r) : ''}</span></div>`;
      }).join('')}</div>`;
    }).join('');

    const hint = eventView
      ? `<p class="muted help mb0">Avant un marché : vérifie que ton stock événement respecte le seuil. La colonne « général dispo » indique ce que tu peux transférer depuis le général.</p>`
      : `<p class="muted help mb0">Coche les produits à recommander puis « Générer la commande ». En vue « total », le stock général + événement est comparé au <b>mini général</b> (le mini événement sert seulement à recharger ta boîte de marché). Le bouton 🚫 d'une ligne retire ce format des commandes (ex. 250G / 500G d'un produit acheté au kilo) ; la même case est dans Stock → Mastication.</p>`;

    document.getElementById('stockBody').innerHTML = `
      <div class="card" style="padding:12px 16px;">
        <label style="display:block;margin-bottom:6px;">Stock à vérifier</label>
        <div style="margin-bottom:12px;">${U.seg([btn('general', '🏬 Stock Général'), btn('event', '🎪 Stock Événement'), btn('total', '🧺 Général + événement (total)')], { full: true, scroll: true, label: 'Stock à vérifier' })}</div>
        ${filters}
        ${hint}
        ${eventView ? `<div class="frow mt" style="gap:6px;align-items:center;">
            <button class="btn-cta btn-sm" onclick="U.printLight()">🖨 Imprimer la sélection</button>
            ${U.seg([{ l: '☑ Tout cocher', js: 'Stock.faibleSetAllExcluded(true)' }, { l: '☐ Tout décocher', js: 'Stock.faibleSetAllExcluded(false)' }], { sm: true })}
            <span class="muted" style="margin-left:auto;">${rows.length} ligne(s)</span>
          </div>`
          : `<div class="frow mt" style="gap:6px;align-items:center;">
            <button class="btn-cta btn-sm" onclick="Stock.faibleGenerateOrder()">📋 Générer la commande (${f.sel.length})</button>
            <span class="muted" style="margin-left:auto;">${rows.length} ligne(s)</span>
          </div>`}
      </div>
      <div class="card"><div class="perem-mob no-print">${mob}</div><div class="table-wrap perem-desk">${table}</div></div>`;
  },
  /* Le format compte-t-il pour la commande ? Choix d'Antho (`v.noReorder` true / false) sinon règle par défaut (2026-10-19) :
     un format AU GRAMME de 250 g ou plus qui a un format au gramme plus petit dans le même produit (250G / 500G / 1KG à côté d'un 100G) ne déclenche pas de commande — le produit est acheté au kilo et détaillé.
     Jamais pour un produit dont le plus petit format est déjà ≥ 250 g (sinon plus aucune alerte), ni pour les tailles / pièces / déclinaisons. */
  reorderOn(p, v) {
    if (v.noReorder === true) return false;
    if (v.noReorder === false) return true;
    // Lot (2 pièces ou plus) : hors commande dès que le produit a son format à l'UNITÉ (1 pièce / PCS / unité) ou que le lot est la déclinaison d'une variante principale ; seul format du produit → il compte
    if (v.mode === 'piece' && U.num(v.value) >= 2) return !(this.parentOf(p, v) || p.variants.some(x => x !== v && x.mode === 'piece' && U.num(x.value) === 1 && !this.parentOf(p, x)));
    if (v.mode !== 'gram' || this.parentOf(p, v)) return true;
    const g = U.num(v.value);
    if (!(g >= 250 && p.variants.some(x => x !== v && x.mode === 'gram' && !this.parentOf(p, x) && U.num(x.value) > 0 && U.num(x.value) < g))) return true;
    return !this.boughtByKilo(p, v);
  },
  /* Produit ACHETÉ AU KILO d'après sa fiche Prix mastication (ligne du fournisseur principal : unité « kilo ») ; fiche absente ou achat à la pièce → faux (donc le format compte : jamais d'alerte ratée en silence). */
  boughtByKilo(p, v) {
    const id = this.ficheOf(p, v), cat = id && Store.state.catalogM.find(c => c.id === id), e = cat && Pricing.mainEntry(cat);
    return !!(e && e.unit === 'kilo');
  },
  /* Nom du produit d'une ligne de Faible stock : lien vers sa fiche dans Stock → Mastication (voir les autres variantes, les quantités…) ; clic molette / Ctrl+clic = nouvel onglet */
  _faibleName(r) {
    const nm = `<b>${U.esc(r.produit)}</b>`;
    if (r.kind !== 'M' || !r.pid) return nm;
    return `<a class="pn-link" href="#/stock/mastication/${r.pid}" title="Ouvrir la fiche du produit dans Stock (clic molette / Ctrl+clic : nouvel onglet)">${nm}</a>`;
  },
  /* Statut d'une ligne de Faible stock ; un format qui « ne compte pas pour la commande » est grisé */
  _faibleStatus(r, s, m) {
    const b = s <= 0 ? '<span class="badge bad">Rupture</span>' : s <= m ? '<span class="badge warn">Stock faible</span>' : '<span class="badge ok">OK</span>';
    // largeur fixe : le bouton 🚫 / ↩ qui suit reste aligné d'une ligne à l'autre, quelle que soit la longueur du badge
    return `<span style="display:inline-block;min-width:92px;${r.noReo ? 'opacity:.5;' : ''}"${r.noReo ? ' title="Hors commande : ce format ne déclenche pas de commande (case du Stock, ou produit acheté au kilo d\'après sa fiche Prix mastication : seuls les petits formats comptent)"' : ''}>${b}</span>`;
  },
  _reoBtn(r) {
    return `<button class="btn-icon" style="vertical-align:middle;width:30px;padding:0;text-align:center;" title="${r.noReo ? 'Hors commande — cliquer pour remettre ce format dans les commandes' : 'Ce format ne doit plus déclencher de commande'}" onclick="Stock.toggleReorder('${r.pid}','${r.vid}')">${r.noReo ? '↩' : '🚫'}</button>`;
  },
  /* Case « compte pour la commande » d'un format (Antho 2026-10-19) : décochée = ce format n'apparaît plus dans « Stock faible » ni dans la commande (ex. 250G / 500G d'un produit acheté au kilo) */
  toggleReorder(pId, vId) {
    const p = Store.state.stockM.find(x => x.id === pId), v = p && p.variants.find(x => x.id === vId); if (!v) return;
    const snap = Store.snapshot('stockM', p);
    v.noReorder = this.reorderOn(p, v);   // choix explicite d'Antho (true = hors commande, false = compte), il remplace la règle par défaut
    const entry = Store.commitSnapshot(snap, 'stock', `${v.noReorder ? 'Format hors commande' : 'Format remis en commande'} — ${p.name} (${Pricing.labelVariant(v)})`);
    Store.save('stockM'); App.rerender();
    U.toast(v.noReorder ? `${Pricing.labelVariant(v)} ne déclenche plus de commande.` : `${Pricing.labelVariant(v)} compte de nouveau pour la commande.`, false, entry.id);
  },
  setFaibleSortTo(key) { this.faible.sort = key; this.faible.sortDir = 'asc'; this.renderFaible(); },
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
    this.faible.sel = all ? (this._faibleRowsCache || []).filter(r => !r.noReo).map(r => r.key) : [];
    this.renderFaible();
  },
  // Vue Événement : impression opt-out (tout coché par défaut, décoche pour exclure de l'impression)
  faibleToggleExcluded(key) { this._toggleIn(this.faible.excluded, key); this.renderFaible(); },
  faibleSetAllExcluded(checked) {
    this.faible.excluded = checked ? [] : (this._faibleRowsCache || []).map(r => r.key);
    this.renderFaible();
  },
  /* ───── COMMANDE À PASSER (refonte 2026-10-19, demande d'Antho) ─────
     Une ligne par PRODUIT (les formats 100G / 250G / 500G sont réunis : référence, lien et notes fournisseur écrits une seule fois), rangée par fournisseur OU par viande, filtrable par fournisseur
     et par viande, avec une case par produit. « 🔗 Ouvrir les liens » ouvre un onglet par lien (une seule fois par page) pour les produits cochés — le navigateur doit autoriser les fenêtres surgissantes. */
  faibleGenerateOrder() {
    const f = this.faible;
    if (!f.sel.length) { U.toast('Sélectionne au moins une ligne.', true); return; }
    const hide = Store.hideSupplierInfo(), items = [], seen = new Set(); let missing = 0;
    f.sel.forEach(key => {
      const [kind, id, vId] = key.split('|');
      let pName = '', fmt = '', meat = '', ref = '', supNotes = [], supplier = '', supplierUrl = '', pKey = kind + '|' + id;
      if (kind === 'M') {
        const p = Store.state.stockM.find(x => x.id === id); const v = p?.variants.find(x => x.id === vId); if (!v) return;
        pName = p.name; fmt = Pricing.labelVariant(v); meat = p.meatType || 'Autre';
        ref = v.ref || '';
        {   // fiche prix de CETTE variante (la sienne, sinon celle de sa taille, sinon celle du produit) : une variante peut venir d'un autre fournisseur que le reste du produit
          const fId = this.ficheOf(p, v), cat = fId ? Store.state.catalogM.find(c => c.id === fId) : null;
          if (cat) {
            (cat.suppliers || []).forEach(s => {
              if (s.notes) supNotes.push({ name: Store.supplierName(s.supplierId), text: s.notes, isMain: s.supplierId === cat.mainSupplierId });
            });
            if (!supNotes.length && cat.notes) supNotes.push({ name: 'Produit', text: cat.notes, isMain: false });
            const main = (cat.suppliers || []).find(s => s.supplierId === cat.mainSupplierId) || (cat.suppliers || [])[0];
            if (main) { supplier = Store.supplierName(main.supplierId); supplierUrl = main.url || ''; if (main.ref) ref = main.ref; }
          }
        }
      } else if (kind === 'MT') {
        const m = Store.state.materials.find(x => x.id === id); if (!m) return;
        pName = m.product || m.variant || m.name; fmt = m.product ? (m.variant || '') : ''; meat = this.matKindLabel[m.kind] || 'Matières premières'; pKey = 'MT|' + pName;
        ref = m.ref || ''; supplierUrl = m.url || '';
        supplier = m.supplierId ? Store.supplierName(m.supplierId) : this._hostOf(supplierUrl);   // pas de fournisseur saisi sur les matières : le site du lien en tient lieu (un bloc par site, pour « Ouvrir les liens »)
      } else {
        const c = Store.state.consumables.find(x => x.id === id); if (!c) return;
        pName = c.name; ref = c.ref || ''; supplierUrl = c.url || ''; meat = c.category || 'Consommables'; supplier = this._hostOf(supplierUrl);
        const ri = this.replaceInfo(c); if (ri) pName += ' — ' + ri.txt;
      }
      const ukey = kind + '|' + id + '|' + (vId || '');
      if (seen.has(ukey)) return; seen.add(ukey);
      if (hide) { ref = ''; supplierUrl = ''; supNotes = []; }
      else if (!ref && !supplier && !supplierUrl) missing++;
      items.push({ pKey, pName, fmt, meat, ref, supNotes, supplier, supplierUrl });
    });
    this._orderProds = this._orderBuild(items);
    this._orderSel = new Set(this._orderProds.map(g => g.k));
    this._orderFilter = null; this._orderMeat = null; this._orderBy = 'sup'; this._orderQueue = [];
    U.modal({
      title: '📋Commande à passer', hideOk: true, wide: true,
      body: `${missing ? `<p class="warn-txt mt-0">${missing} ligne(s) sans reference fournisseur.</p>` : ''}
        <div id="order_queue">${this._orderQueueHTML()}</div>
        <div id="order_filterbar">${this._orderFilterBarHTML()}</div>
        <div id="order_list" style="max-height:min(52vh,520px);overflow-y:auto;">${this._orderListHTML()}</div>
        <button type="button" class="btn-ghost btn-sm mt" onclick="Stock.copyOrderList()">📋Copier la liste</button>`
    });
  },

  /* Nom de site d'un lien (« pethardware.com ») : sert de fournisseur aux matières et consommables, qui n'ont pas de fournisseur saisi */
  _hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } },
  /* Une entrée par produit ET fournisseur : formats réunis, références / liens / notes sans doublon */
  _orderBuild(items) {
    const map = new Map(), uniq = a => [...new Set(a.filter(Boolean))];
    items.forEach(it => { const k = it.pKey + '|' + it.supplier; let g = map.get(k); if (!g) map.set(k, g = { k, pName: it.pName, meat: it.meat, supplier: it.supplier, items: [] }); g.items.push(it); });
    return [...map.values()].map((g, i) => {
      g.i = i;
      g.fmts = uniq(g.items.map(x => x.fmt));
      g.refs = uniq(g.items.map(x => x.ref));
      g.urls = uniq(g.items.map(x => x.supplierUrl)).filter(u => /^https?:\/\//i.test(u));   // jamais de lien « javascript: » ouvert
      const nm = new Map(); g.items.forEach(x => x.supNotes.forEach(n => { const kk = n.name + '|' + n.text; if (!nm.has(kk)) nm.set(kk, n); }));
      g.notes = [...nm.values()];
      return g;
    });
  },
  _orderVisible(ignore) {
    return (this._orderProds || []).filter(g => (ignore === 'sup' || this._orderFilter === null || g.supplier === this._orderFilter) && (ignore === 'meat' || this._orderMeat === null || g.meat === this._orderMeat));
  },
  _orderNoteBox(n) {
    return `<div style="margin:4px 0;padding:6px 10px;background:${n.isMain ? '#fff3cd' : '#e8f4fd'};color:${n.isMain ? '#664d03' : '#4a6de5'};border-left:4px solid ${n.isMain ? '#ffc107' : '#4da6d9'};border-radius:4px;font-size:.85rem;white-space:pre-wrap;"><b>💡${U.esc(n.name)}${n.isMain ? ' ★' : ''}</b>\n${U.esc(n.text)}</div>`;
  },
  _orderFilterBarHTML() {
    const chip = (js, label, count, active) => `<button type="button" class="btn-sm" style="border-radius:16px;padding:5px 12px;margin:2px;border:1px solid var(--card-border);background:${active ? 'var(--caramel)' : 'transparent'};color:${active ? '#1a1a1a' : 'var(--texte)'};font-weight:${active ? '700' : '400'};cursor:pointer;" onclick="${js}">${U.esc(label)} (${count})</button>`;
    const q = s => U.esc(s).replace(/&#39;/g, "\\'");
    const sups = [...new Set(this._orderProds.map(g => g.supplier))].sort((a, b) => (!a && b) ? 1 : (a && !b) ? -1 : U.sortFr(a, b));
    const meats = [...new Set(this._orderProds.map(g => g.meat))].sort(U.sortFr);
    const bySup = this._orderVisible('sup'), byMeat = this._orderVisible('meat');
    const vis = this._orderVisible(), nSel = vis.filter(g => this._orderSel.has(g.k)).length, hide = Store.hideSupplierInfo();
    const nUrl = new Set(vis.filter(g => this._orderSel.has(g.k)).flatMap(g => g.urls)).size;
    return `<div class="muted" style="font-size:.78rem;margin:0 0 2px;">Fournisseur</div>
      <div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:6px;">
        ${chip("Stock.filterOrderBySupplier('__ALL__')", 'Tous', bySup.length, this._orderFilter === null)}
        ${sups.map(s => chip(`Stock.filterOrderBySupplier('${q(s)}')`, s || 'Sans fournisseur', bySup.filter(g => g.supplier === s).length, this._orderFilter === s)).join('')}
      </div>
      <div class="muted" style="font-size:.78rem;margin:0 0 2px;">Viande / catégorie</div>
      <div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:8px;">
        ${chip("Stock.filterOrderByMeat('__ALL__')", 'Toutes', byMeat.length, this._orderMeat === null)}
        ${meats.map(m => chip(`Stock.filterOrderByMeat('${q(m)}')`, m, byMeat.filter(g => g.meat === m).length, this._orderMeat === m)).join('')}
      </div>
      <div class="frow" style="gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
        <span class="muted" style="font-size:.85rem;">Ranger :</span>${U.seg([{ l: 'Par fournisseur', on: this._orderBy === 'sup', js: "Stock.setOrderBy('sup')" }, { l: 'Par viande', on: this._orderBy === 'meat', js: "Stock.setOrderBy('meat')" }], { sm: true })}
        ${U.seg([{ l: '☑ Tout cocher', js: 'Stock.orderToggleAll(true)' }, { l: '☐ Tout décocher', js: 'Stock.orderToggleAll(false)' }], { sm: true })}
        ${hide ? '' : `<button type="button" class="btn-cta btn-sm" style="flex:0 0 auto;" ${nUrl ? '' : 'disabled'} onclick="Stock.orderOpenLinks(-1)" title="Ouvre un onglet par lien (une seule fois par page) pour les produits cochés et affichés">🔗 Ouvrir les liens (${nUrl})</button>`}
        <span class="muted" style="font-size:.85rem;margin-left:auto;">${nSel} / ${vis.length} produit(s) coché(s)</span>
      </div>`;
  },
  _orderListHTML() {
    const vis = this._orderVisible(), by = this._orderBy, hide = Store.hideSupplierInfo();
    const label = g => by === 'sup' ? g.supplier : g.meat;
    const keys = [...new Set(vis.map(label))].sort((a, b) => (!a && b) ? 1 : (a && !b) ? -1 : U.sortFr(a, b));
    this._orderHeads = keys.map(k => ({ label: k || (by === 'sup' ? 'Fournisseur non identifié' : 'Autre'), groups: vis.filter(g => label(g) === k).sort((a, b) => U.sortFr(a.pName, b.pName)) }));
    return this._orderHeads.map((h, hi) => {
      const nUrl = new Set(h.groups.filter(g => this._orderSel.has(g.k)).flatMap(g => g.urls)).size;
      const header = `<div style="display:flex;align-items:center;gap:8px;margin:14px 0 8px;background:var(--card-bg);padding:8px 10px;border-radius:6px;border-left:4px solid var(--caramel);">
        <h3 style="margin:0;font-size:1.05rem;font-weight:700;color:var(--caramel);flex:1;">${U.esc(h.label)} <span style="font-size:.8rem;font-weight:400;color:var(--gris);">(${h.groups.length})</span></h3>
        ${hide ? '' : `<button type="button" class="btn-ghost btn-sm" style="flex:0 0 auto;" ${nUrl ? '' : 'disabled'} onclick="Stock.orderOpenLinks(${hi})" title="Ouvre un onglet par lien pour les produits cochés de ce groupe">🔗 Ouvrir les liens (${nUrl})</button>`}</div>`;
      const rows = h.groups.map(g => {
        const refsSame = g.refs.length <= 1;
        return `<div style="padding:6px 0;border-bottom:1px solid var(--card-border);display:flex;gap:10px;align-items:flex-start;">
          <input type="checkbox" style="margin-top:4px;" ${this._orderSel.has(g.k) ? 'checked' : ''} onchange="Stock.orderToggle(${g.i})">
          <div style="flex:1;min-width:0;">
            <div><b>${U.esc(g.pName)}</b>${g.fmts.length ? ` <span class="muted">— ${g.fmts.map(x => U.esc(x)).join(' · ')}</span>` : ''}${by === 'meat' && g.supplier ? ` <span class="badge info">${U.esc(g.supplier)}</span>` : ''}</div>
            ${g.refs.length && refsSame ? `<div style="font-size:.85rem;color:var(--gris);font-family:monospace;">${U.esc(g.refs[0])}</div>` : g.items.filter(x => x.ref).map(x => `<div style="font-size:.85rem;color:var(--gris);font-family:monospace;">${x.fmt ? U.esc(x.fmt) + ' : ' : ''}${U.esc(x.ref)}</div>`).join('')}
            ${g.urls.map(u => { const fm = g.urls.length > 1 ? [...new Set(g.items.filter(x => x.supplierUrl === u).map(x => x.fmt).filter(Boolean))] : []; return `<div style="font-size:.85rem;"><a href="${U.esc(u)}" target="_blank" rel="noopener" style="color:var(--caramel);">🔗 ${fm.length ? U.esc(fm.join(' · ')) + ' : ' : ''}Commander chez le fournisseur</a></div>`; }).join('')}
            ${(!g.refs.length && !g.urls.length && !hide) ? `<div style="font-size:.85rem;color:var(--alerte);">⚠️Pas de reference fournisseur</div>` : ''}
            ${g.notes.map(n => this._orderNoteBox(n)).join('')}
          </div></div>`;
      }).join('');
      return header + rows;
    }).join('') || '<p class="muted">Aucun produit pour ce filtre.</p>';
  },
  _orderRefresh() {
    const bar = document.getElementById('order_filterbar'), list = document.getElementById('order_list');
    if (list) list.innerHTML = this._orderListHTML();   // d'abord : met à jour les en-têtes utilisés par la barre
    if (bar) bar.innerHTML = this._orderFilterBarHTML();
  },
  filterOrderBySupplier(key) { this._orderFilter = key === '__ALL__' ? null : key; this._orderRefresh(); },
  filterOrderByMeat(key) { this._orderMeat = key === '__ALL__' ? null : key; this._orderRefresh(); },
  setOrderBy(v) { this._orderBy = v; this._orderRefresh(); },
  orderToggle(i) { const g = (this._orderProds || [])[i]; if (!g) return; if (this._orderSel.has(g.k)) this._orderSel.delete(g.k); else this._orderSel.add(g.k); this._orderRefresh(); },
  orderToggleAll(on) { this._orderVisible().forEach(g => { if (on) this._orderSel.add(g.k); else this._orderSel.delete(g.k); }); this._orderRefresh(); },
  /* h = numéro d'un en-tête de la liste, ou -1 = tout ce qui est affiché. Un onglet par lien (dédoublonné) pour les produits cochés. */
  orderOpenLinks(h) {
    const groups = h >= 0 ? ((this._orderHeads || [])[h] || { groups: [] }).groups : this._orderVisible();
    const urls = [...new Set(groups.filter(g => this._orderSel.has(g.k)).flatMap(g => g.urls))];
    if (!urls.length) { U.toast('Aucun lien dans la sélection.', true); return; }
    // Chrome n'accepte qu'UN onglet par clic tant que le site n'est pas autorisé à ouvrir des fenêtres surgissantes : window.open renvoie alors null (ce n'est pas l'appli qui bride).
    // Les liens bloqués restent dans une file : « ▶ Ouvrir le suivant » = un clic, un lien, ce qui marche toujours.
    const rest = [];
    urls.forEach(u => { let w = null; try { w = window.open(u, '_blank'); } catch (e) { /* bloqué */ } if (w) { try { w.opener = null; } catch (e) { /* ignoré */ } } else rest.push(u); });
    this._orderQueue = rest; this._orderQueueTotal = urls.length;
    const q = document.getElementById('order_queue'); if (q) q.innerHTML = this._orderQueueHTML();
    if (rest.length) U.alert(`${urls.length - rest.length} onglet(s) ouvert(s), ${rest.length} bloqué(s) par Chrome (c'est lui qui limite à un onglet par clic, pas l'appli).

Pour tout ouvrir d'un coup : clique sur l'icône « pop-up bloqué » à droite de la barre d'adresse → « Toujours autoriser » pour ce site (ou cadenas / ⓘ à gauche de l'adresse → Paramètres du site → Fenêtres pop-up et redirections → Autoriser), puis reclique « Ouvrir les liens ».

Sans réglage : utilise le bouton « ▶ Ouvrir le suivant » (un clic = un lien).`, '🔗 Fenêtres bloquées');
    else U.toast(`${urls.length} onglet(s) ouvert(s).`);
  },
  _orderQueueHTML() {
    const n = (this._orderQueue || []).length; if (!n) return '';
    const total = this._orderQueueTotal || n;
    return `<div class="card" style="border-left:4px solid var(--warn);margin:0 0 10px;padding:10px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <span>⚠️ <b>${n} lien${n > 1 ? 's' : ''}</b> bloqué${n > 1 ? 's' : ''} par ton navigateur (${total - n} / ${total} ouverts).</span>
      <button type="button" class="btn-cta btn-sm" style="flex:0 0 auto;" onclick="Stock.orderOpenNext()">▶ Ouvrir le suivant</button>
      <button type="button" class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Stock.orderQueueClear()">Ignorer</button></div>`;
  },
  orderOpenNext() {
    const u = (this._orderQueue || []).shift(); if (!u) return;
    try { const w = window.open(u, '_blank'); if (w) w.opener = null; } catch (e) { /* ignoré */ }
    const q = document.getElementById('order_queue'); if (q) q.innerHTML = this._orderQueueHTML();
    if (!(this._orderQueue || []).length) U.toast('Tous les liens sont ouverts.');
  },
  orderQueueClear() { this._orderQueue = []; const q = document.getElementById('order_queue'); if (q) q.innerHTML = ''; },
  copyOrderList() {
    const heads = this._orderHeads; if (!heads) return;
    const text = heads.map(h => {
      const body = h.groups.filter(g => this._orderSel.has(g.k)).map(g => {
        let line = g.pName + (g.fmts.length ? ' — ' + g.fmts.join(', ') : '') + (g.refs.length ? ' [' + g.refs.join(' / ') + ']' : '') + g.urls.map(u => ` (${u})`).join('');
        g.notes.forEach(n => { line += `\n${n.isMain ? 'MAIN ' : ''}${n.text}`; });
        return line;
      }).join('\n');
      return body ? `=== ${h.label} ===\n${body}` : '';
    }).filter(Boolean).join('\n\n');
    if (!text) { U.toast('Rien de coché à copier.', true); return; }
    const fallbackCopy = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); U.toast('Liste copiee.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => U.toast('Liste copiee.')).catch(fallbackCopy);
    } else { fallbackCopy(); }
  },

  /* ───── CONSOMMABLES ───── */
  consoFilters: { q: '', cat: 'all', link: 'all', state: 'all', sort: 'name', sortDir: 'asc', view: 'list', pm: 'up' },
  setConsoSort(key) {
    const f = this.consoFilters;
    if (f.sort === key) f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc';
    else { f.sort = key; f.sortDir = 'asc'; }
    this.renderConso();
  },
  renderConso(){
    const S=Store.state.settings, f=this.consoFilters;
    U.syncFilters('stock_conso', f);
    const all = Store.state.consumables;
    const qn = U.normSearch(f.q || '');
    const isLow = c => U.num(c.low) > 0 && U.num(c.qty) <= U.num(c.low);
    // « À compléter » : fiches incomplètes (même principe que Matières premières) ; réf./lien masqués pour les profils sans accès fournisseur
    const hideSup = Store.hideSupplierInfo();
    const todo = { nourl: c => !c.url, noref: c => !String(c.ref || '').trim(), noboth: c => !c.url && !String(c.ref || '').trim(), nocost: c => !(U.num(c.costUnit) > 0), nolow: c => !(U.num(c.low) > 0) };
    if (!todo[f.link] || (hideSup && ['nourl', 'noref', 'noboth'].includes(f.link))) f.link = 'all';
    const list = all.filter(c =>
      (!qn || U.has(c.name + ' ' + (c.dimensions || '') + ' ' + (c.ref || ''), qn)) &&
      (!f.cat || f.cat === 'all' || (c.category || 'Autre') === f.cat) &&
      (!todo[f.link] || todo[f.link](c)) &&
      (f.state === 'low' ? isLow(c) : f.state === 'out' ? U.num(c.qty) <= 0 : f.state === 'replace' ? !!c.toReplace : f.state === 'dluo' ? this.consoLots(c).some(l => l.days <= 90) : f.state === 'nodim' ? !this.consoDims(c) : true));
    const cats = [...new Set(all.map(c => c.category || 'Autre'))].sort(U.sortFr);
    const cnt = fn => all.filter(fn).length;
    const dir = f.sortDir === 'asc' ? 1 : -1;
    list.sort((a,b) => {
      let v = 0;
      switch(f.sort) {
        case 'name': v = U.sortFr(a.name,b.name); break;
        case 'dim': v = this._dimVolume(this.consoDims(a))-this._dimVolume(this.consoDims(b)); break;
        case 'cat': v = U.sortFr(a.category||'',b.category||''); break;
        case 'qty': v = U.num(a.qty)-U.num(b.qty); break;
        case 'low': v = U.num(a.low)-U.num(b.low); break;
        case 'cost': v = U.num(a.costUnit)-U.num(b.costUnit); break;
      }
      return (v||U.sortFr(a.name,b.name)||(this._dimVolume(a.dimensions)-this._dimVolume(b.dimensions)))*dir;
    });
    const sortHead = (key, label) => `<span class="sortable ${f.sort===key?'active':''}" onclick="Stock.setConsoSort('${key}')">${label} ${f.sort===key?(f.sortDir==='asc'?'▲':'▼'):'⇕'}</span>`;
    document.getElementById('stockBody').innerHTML=`
      <div class="card" style="padding:12px 16px;"><div class="grid c4">
        <div class="fg mb0"><label>Recherche</label><input id="conso_q" placeholder="nom, dimensions, réf…" value="${U.esc(f.q || '')}" oninput="Stock.consoFilters.q=this.value;Stock.renderConso();U.refocus('conso_q')"></div>
        <div class="fg mb0"><label>Catégorie</label>${U.customSelect({ value: f.cat || 'all', options: [{v:'all',l:'Toutes ('+all.length+')'}].concat(cats.map(c=>({v:c,l:c+' ('+cnt(x=>(x.category||'Autre')===c)+')'}))), onPick: 'Stock._setConsoCat' })}</div>
        <div class="fg mb0"><label>À compléter</label>${U.customSelect({ value: f.link, options: [{v:'all',l:'Tous'}].concat([['nourl','Sans lien fournisseur'],['noref','Sans réf. fournisseur'],['noboth','Sans lien ni réf.'],['nocost','Sans prix d\'achat'],['nolow','Sans seuil d\'alerte']].filter(o => !hideSup || !['nourl','noref','noboth'].includes(o[0])).map(o => ({v:o[0],l:o[1]+' ('+cnt(todo[o[0]])+')'}))), onPick: 'Stock._setConsoLink' })}</div>
        <div class="fg mb0"><label>État</label>${U.customSelect({ value: f.state || 'all', options: [{v:'all',l:'Tous'},{v:'low',l:'⚠️ Stock bas ('+cnt(isLow)+')'},{v:'out',l:'Rupture ('+cnt(c=>U.num(c.qty)<=0)+')'},{v:'replace',l:'🚩 À ne plus racheter ('+cnt(c=>!!c.toReplace)+')'},{v:'dluo',l:'⏳ DLUO < 3 mois ou périmée ('+cnt(c=>this.consoLots(c).some(l=>l.days<=90))+')'},{v:'nodim',l:'Sans dimensions ('+cnt(c=>!this.consoDims(c))+')'}], onPick: 'Stock._setConsoState' })}</div>
      </div>
        <div class="frow mt" style="gap:6px;align-items:center;">
          <button class="btn-cta btn-sm" style="flex:0 0 calc(25% - 9px);" onclick="Stock.editConso()">＋ Nouveau consommable</button>
          <button class="${f.view === 'perem' ? 'btn-cta' : 'btn-ghost'} btn-sm" style="flex:0 0 auto;" title="${f.view === 'perem' ? 'Revenir à la liste des consommables' : 'Voir les dates limites (DLUO) des consommables'}" onclick="Stock.setConsoView('${f.view === 'perem' ? 'list' : 'perem'}')">${f.view === 'perem' ? '← Liste' : '⏳ Péremptions (' + all.reduce((n, c) => n + this.consoLots(c).length, 0) + ')'}</button>
          <span class="muted" style="margin-left:auto;flex:0 0 auto;">${list.length !== all.length ? `${list.length} / ${all.length}` : all.length} consommable(s)${list.length !== all.length ? ' affiché(s)' : ''}</span>
        </div></div>
      ${f.view === 'perem' ? this._consoPeremHTML(list) : list.length ? `<div class="card"><div class="table-wrap"><table>
        <thead><tr><th class="col-name">${sortHead('name','Article')}</th><th>${sortHead('dim','Dimensions')}</th><th>${sortHead('cat','Catégorie')}</th><th style="text-align:center;">${sortHead('qty','En stock')}</th><th style="text-align:center;">${sortHead('low','Seuil')}</th><th style="text-align:center;">${sortHead('cost','Coût / unité')}</th><th></th></tr></thead>
        <tbody>${list.map(c=>{const cTotal=c.costTotal!=null?U.num(c.costTotal):U.num(c.costUnit);const cQper=U.num(c.costQtyPer)||1;return `<tr>
          <td class="col-name"><b>${U.esc(c.name)}</b>${this.replaceBadge(c)}${this._consoDluoHTML(c)}</td>
          <td class="muted" style="font-size:1.1rem;font-weight:600;">${this.consoDims(c) ? U.esc(this.consoDims(c)) : '—'}</td>
          <td><span class="badge info">${U.esc(c.category||'Autre')}</span></td>
          <td class="${U.num(c.low)>0&&U.num(c.qty)<=U.num(c.low)?'warn-txt':''}" style="text-align:center;">
            <input type="number" step="1" value="${c.qty}" style="width:85px;text-align:center;" onchange="Stock.setConsoQty('${c.id}',this.value)"> ${U.esc(!c.unit || c.unit === 'pc' ? 'PCS' : c.unit)}</td>
          <td style="text-align:center;">${U.num(c.low)||'—'}</td>
          <td style="text-align:center;" class="sensitive"><div class="cost-split"><input type="number" step="0.01" value="${cTotal}" onchange="Stock.setConsoCost('${c.id}','costTotal',this.value)"><span class="cost-split-sep">/</span><input type="number" step="0.01" value="${cQper}" onchange="Stock.setConsoCost('${c.id}','costQtyPer',this.value)"></div>${(() => { const sh = this.costShown(c.costUnit, Store.state.settings.vatRate ?? 20), ent = c.costTax === 'TTC' ? 'TTC' : 'HT'; return (cQper !== 1 || Math.abs(sh.v - cTotal) > 0.0005) ? `<div class="muted" style="font-size:.78rem;margin-top:3px;">${ent !== sh.lab ? `<span class="badge warn" style="font-size:.68rem;">saisi ${ent}</span> ` : ''}= ${U.eur(sh.v)} ${sh.lab} / ${U.esc(!c.unit || c.unit === 'pc' ? 'PCS' : c.unit)}</div>` : ''; })()}</td>
          <td class="right"><div class="act-grid"><span class="act-row">${Store.hideSupplierInfo() ? '' : `<button class="btn-icon" title="${c.url ? 'Ouvrir la page fournisseur' : 'Ajouter un lien fournisseur'}" onclick="Stock.openConsoLink('${c.id}')">${c.url ? '🔗' : '🔗＋'}</button>`}
            <button class="btn-icon" title="Dupliquer" onclick="Stock.dupConso('${c.id}')">📋</button></span><span class="act-row">
            <button class="btn-ghost btn-sm" onclick="Stock.editConso('${c.id}')">Modifier</button>
            <button class="btn-icon" title="Supprimer" onclick="Stock.delConso('${c.id}')">🗑️</button></span></div></td></tr>`;}).join('')}
        </tbody></table></div></div>` : '<div class="card empty"><span class="big">📦</span>Aucun consommable.</div>'}`;
  },
  /* ───── Stock → Accessoires (Antho 2026-10-17) : stock FINI des accessoires (modèles d'exposition, pièces faites d'avance), général / événement ─────
     Même présentation que la page Accessoires (Antho : « remets le système de la page Accessoires ») : mêmes filtres (recherche, catégorie, largeur, bicolor), une ligne par FAMILLE
     (nom, largeurs, catégorie, nombre de longueurs, stock et valeurs cumulés) qui se déplie sur ses longueurs ; chaque longueur porte ses quantités modifiables.
     Champs de la fiche : `a.stockGeneral`, `a.stockEvent`, seuil `a.low` — « Fabriquer » les crédite, les ventes les débitent, Tableau de bord et synchro Site/SumUp les lisent. */
  accFilters: { q: '', cat: 'all', width: 'all', bic: 'all', state: 'all', sort: 'name', sortDir: 'asc' },
  _accGrpOpen: {},
  accSet(key, v) { this.accFilters[key] = v; this.renderAccessoires(); },
  accSort(key) { const f = this.accFilters; if (f.sort === key) f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc'; else { f.sort = key; f.sortDir = 'asc'; } this.renderAccessoires(); },
  accFoldAll(open) { document.querySelectorAll('#stockBody details.stk-acc-fold').forEach(d => { this._accGrpOpen[d.dataset.gid] = open; d.open = open; }); },
  renderAccessoires() {
    Accessoires.ensureFamilies();   // chaque accessoire fabriqué est rangé dans un produit (famille)
    const f = this.accFilters; U.syncFilters('stock_acc', f);
    if (f.sort === 'buy') f.sort = 'cost'; else if (f.sort === 'sell') f.sort = 'price';   // anciens réglages mémorisés
    const A = Accessoires, all = Store.state.catalogA, ro = !!App.isViewer, qn = U.normSearch(f.q || '');
    const tot = a => U.num(a.stockGeneral) + U.num(a.stockEvent);
    const isLow = a => U.num(a.low) > 0 && tot(a) <= U.num(a.low);
    const cats = [...new Set(all.map(a => a.category || 'Autre'))].sort(U.sortFr);
    const widths = [...new Set(all.map(a => A._widthOf(a)).filter(Boolean))].sort((x, y) => parseFloat(x) - parseFloat(y));
    if (f.cat !== 'all' && !cats.includes(f.cat)) f.cat = 'all';
    if (f.width !== 'all' && !widths.includes(f.width)) f.width = 'all';
    const cnt = fn => all.filter(fn).length;
    const pass = a => (!qn || U.has(a.name + ' ' + (a.sku || ''), qn)) && (f.cat === 'all' || (a.category || 'Autre') === f.cat) && (f.width === 'all' || A._widthOf(a) === f.width)
      && (f.bic === 'yes' ? !!a.bicolor : f.bic === 'no' ? !a.bicolor : true)
      && (f.state === 'in' ? tot(a) > 0 : f.state === 'out' ? tot(a) <= 0 : f.state === 'low' ? isLow(a) : f.state === 'manual' ? !!a.manual : f.state === 'craft' ? !a.manual : true);
    const list = all.filter(pass);
    // une entrée par famille (a.groupId) ou par accessoire isolé ; totaux = ceux des longueurs AFFICHÉES
    const byKey = new Map();
    list.forEach(a => { const k = a.groupId ? 'g' + a.groupId : 's' + a.id; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(a); });
    const memCmp = (x, y) => (A._lenOf(x) - A._lenOf(y)) || (A._persoRank(x) - A._persoRank(y)) || U.sortFr(x.name, y.name);
    const items = [...byKey.entries()].map(([key, mem]) => {
      mem.sort(memCmp);
      const rows = mem.map(a => { const c = Pricing.accCalc(a), q = tot(a); return { a, q, cost: c.costBase, price: c.priceTTC, buy: q * c.costBase, sell: q * c.priceTTC }; });
      const sum = fn => rows.reduce((t, r) => t + fn(r), 0), rng = fn => { const v = rows.map(fn); return [Math.min(...v), Math.max(...v)]; };
      return { key, gid: mem[0].groupId || '', mem, rows, first: mem[0], gen: sum(r => U.num(r.a.stockGeneral)), evt: sum(r => U.num(r.a.stockEvent)), q: sum(r => r.q), buy: sum(r => r.buy), sell: sum(r => r.sell), low: mem.some(isLow), cr: rng(r => r.cost), pr: rng(r => r.price) };
    });
    const dir = f.sortDir === 'asc' ? 1 : -1;
    items.sort((x, y) => {
      const v = f.sort === 'cat' ? U.sortFr(x.first.category || '', y.first.category || '') : f.sort === 'width' ? A._widthNum(x.first) - A._widthNum(y.first)
        : f.sort === 'tot' ? x.q - y.q : f.sort === 'cost' ? x.cr[0] - y.cr[0] : f.sort === 'price' ? x.pr[0] - y.pr[0] : 0;
      return (v || A._cmpAcc(x.first, y.first)) * dir;
    });
    const T = items.reduce((t, i) => ({ q: t.q + i.q, buy: t.buy + i.buy, sell: t.sell + i.sell }), { q: 0, buy: 0, sell: 0 });
    const autoOpen = !!qn || f.state !== 'all';   // une recherche ou un filtre d'état déplie les familles (sinon les lignes trouvées restent cachées)
    const sh = (key, label) => `<span class="sortable ${f.sort === key ? 'active' : ''}" onclick="Stock.accSort('${key}')">${label} ${f.sort === key ? (f.sortDir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
    const range = (r, fmt) => Math.abs(r[1] - r[0]) < 0.005 ? fmt(r[0]) : fmt(r[0]) + ' – ' + fmt(r[1]);
    const zc = v => U.num(v) > 0 ? '' : ' z';   // quantité à 0 : orange, comme dans Mastication
    const inp = (a, key, v, extra) => `<input class="stk-acc-in${extra || ''}" type="number" step="1" min="0" value="${U.num(v) || 0}" ${ro ? 'disabled' : ''} onchange="Accessoires.setStockFini('${a.id}','${key}',this.value)" onfocus="this.select()">`;
    const badges = a => { const r = A._persoRank(a); return (r & 4 ? ' <span class="badge">Thème UV</span>' : r & 1 ? ' <span class="badge">UV</span>' : '') + (r & 2 ? ' <span class="badge">Laser</span>' : ''); };
    const wBadge = a => { const w = A._widthOf(a); return w ? `<span class="badge">${U.esc(w)}</span>` : ''; };
    const arrows = a => ro ? '' : `<button class="btn-transfer" style="background:var(--ok);" title="Transférer du Général vers l'Événement" onclick="Accessoires.transferStock('${a.id}','ge')">→</button><button class="btn-transfer" style="background:#3b6fa0;" title="Retour de l'Événement vers le Général" onclick="Accessoires.transferStock('${a.id}','eg')">←</button>`;
    const link = a => a.manual ? '' : `<a class="btn-icon" href="#/accessoires/${a.id}" title="Ouvrir la fiche dans Artisanat (prix, matières, coût)" style="text-decoration:none;">↗</a>`;
    const actions = a => a.manual ? (ro ? '' : `<button class="btn-ghost btn-sm" title="Modifier cette pièce (nom, coût, prix, quantités)" onclick="Accessoires.editManual('${a.id}')">✎ Modifier</button><button class="btn-icon" title="Supprimer cette pièce" onclick="Accessoires.delManual('${a.id}')">🗑️</button>`)
      : (ro ? '' : `<button class="btn-ghost btn-sm" title="Fabriquer : ajoute les pièces au stock fini et retire les matières" onclick="Accessoires.fabricate('${a.id}')">🛠 Fabriquer</button>`) + link(a);
    // ligne d'une longueur (ou d'un accessoire isolé : nom complet + largeur + catégorie)
    const row = (r, solo) => { const a = r.a, len = A._lenOf(a);
      return `<div class="stk-acc-row${solo ? ' solo' : ''}${isLow(a) ? ' low' : ''}">
        <span data-l="${solo ? 'Accessoire' : 'Longueur'}"><b>${solo ? U.esc(a.name) : (len > 0 ? U.qty(len) + ' m' : U.esc(a.name))}</b>${badges(a)}</span>
        <span data-l="${solo ? 'Largeur · catégorie' : 'SKU'}">${solo ? `${wBadge(a)} <span class="badge info">${U.esc(a.category || 'Autre')}</span>${a.manual ? ' <span class="badge manual" title="Pièce faite à l’avance, pas encore terminée (ajoutée à la main)">🧩 Prêt à finir</span>' : ''}${a.sku ? `<div><span class="sku-txt">${U.esc(a.sku)}</span></div>` : ''}` : (a.sku ? `<span class="sku-txt">${U.esc(a.sku)}</span>` : '<span class="muted">—</span>')}</span>
        <span data-l="Général">${inp(a, 'general', a.stockGeneral, zc(a.stockGeneral))}</span>
        <span class="stk-acc-mv">${arrows(a)}</span>
        <span data-l="Événement">${inp(a, 'event', a.stockEvent, zc(a.stockEvent))}</span>
        <span data-l="Total" class="${isLow(a) ? 'warn-txt' : U.num(r.q) > 0 ? '' : 'warn-txt'}"><b>${U.qty(r.q)}</b>${U.num(a.low) > 0 ? `<div class="stk-acc-min${isLow(a) ? ' warn-txt' : ''}">(min ${U.qty(a.low)})</div>` : ''}</span>
        <span data-l="Min">${inp(a, 'low', a.low, ' min')}</span>
        <span data-l="Coût" class="sensitive right">${U.eur(r.cost)}</span>
        <span data-l="Prix TTC" class="right"><b>${U.eur(r.price)}</b></span>
        <span class="stk-acc-act">${actions(a)}</span></div>`; };
    const card = i => {
      if (!i.gid) return `<div class="fold stk-acc-single${i.first.manual ? ' manual' : ''}">${row(i.rows[0], true)}</div>`;
      const first = i.first, total = all.filter(x => x.groupId === i.gid).length, name = first.groupName || A._familyName(first);
      const open = autoOpen || !!this._accGrpOpen[i.gid], ws = [...new Set(i.mem.map(a => A._widthOf(a)).filter(Boolean))];
      const nz = v => v > 0 ? '' : ' class="warn-txt"';
      return `<details class="fold prod-fold acc-fold acc-group stk-acc-fold${i.low ? ' low' : ''}" data-gid="${i.gid}" ${open ? 'open' : ''} ontoggle="if(!${autoOpen})Stock._accGrpOpen['${i.gid}']=this.open">
        <summary>
          <span><b>${U.esc(name)}</b><div class="muted" style="font-size:.76rem;">${i.mem.length === total ? total : i.mem.length + ' / ' + total} longueur${total > 1 ? 's' : ''}</div></span>
          <span data-l="Largeur · catégorie">${ws.map(w => `<span class="badge">${U.esc(w)}</span>`).join(' ')} <span class="badge info">${U.esc(first.category || 'Autre')}</span></span>
          <span data-l="Général"><b${nz(i.gen)}>${U.qty(i.gen)}</b></span>
          <span></span>
          <span data-l="Événement"><b${nz(i.evt)}>${U.qty(i.evt)}</b></span>
          <span data-l="Total"><b${i.low || !i.q ? ' class="warn-txt"' : ''}>${U.qty(i.q)}</b></span>
          <span></span>
          <span data-l="Coût" class="sensitive right">${range(i.cr, U.eur)}</span>
          <span data-l="Prix TTC" class="right"><b>${range(i.pr, U.eur)}</b></span>
          <span class="stk-acc-act">${link(first)}</span>
        </summary>
        <div class="fold-body" style="padding:0;">
          <div class="stk-acc-sub"><span>Longueur</span><span>SKU</span><span>Général</span><span></span><span>Événement</span><span>Total</span><span>Min</span><span class="right">Coût</span><span class="right">Prix TTC</span><span></span></div>
          ${i.rows.map(r => row(r, false)).join('')}
          <div class="stk-acc-foot">${ro ? '' : `<button class="btn-cta btn-sm fit" onclick="Accessoires.addLength('${i.gid}')" title="Crée une nouvelle longueur dans cette famille (prix et coût calculés dans Artisanat)">＋ Ajouter une longueur</button>`}</div>
        </div>
      </details>`; };
    document.getElementById('stockBody').innerHTML = `
      <div class="toolbar">
        <div class="fg"><label>Recherche</label><input id="acc_q" type="text" placeholder="nom ou SKU…" value="${U.esc(f.q || '')}" oninput="Stock.accFilters.q=this.value;Stock.renderAccessoires();U.refocus('acc_q')"></div>
        <div class="fg"><label>Catégorie</label><select onchange="Stock.accSet('cat',this.value)"><option value="all">Toutes (${all.length})</option>${cats.map(c => `<option value="${U.esc(c)}" ${f.cat === c ? 'selected' : ''}>${U.esc(c)} (${cnt(x => (x.category || 'Autre') === c)})</option>`).join('')}</select></div>
        <div class="fg"><label>Largeur</label><select onchange="Stock.accSet('width',this.value)"><option value="all">Toutes</option>${widths.map(w => `<option value="${U.esc(w)}" ${f.width === w ? 'selected' : ''}>${U.esc(w)}</option>`).join('')}</select></div>
        <div class="fg"><label>Bicolor</label><select onchange="Stock.accSet('bic',this.value)"><option value="all" ${f.bic === 'all' ? 'selected' : ''}>Tous</option><option value="yes" ${f.bic === 'yes' ? 'selected' : ''}>Bicolor</option><option value="no" ${f.bic === 'no' ? 'selected' : ''}>Non bicolor</option></select></div>
        <div class="fg"><label>État du stock</label><select onchange="Stock.accSet('state',this.value)"><option value="all" ${f.state === 'all' ? 'selected' : ''}>Tous</option><option value="in" ${f.state === 'in' ? 'selected' : ''}>En stock (${cnt(a => tot(a) > 0)})</option><option value="out" ${f.state === 'out' ? 'selected' : ''}>Sans stock (${cnt(a => tot(a) <= 0)})</option><option value="low" ${f.state === 'low' ? 'selected' : ''}>⚠️ Stock bas (${cnt(isLow)})</option><option value="manual" ${f.state === 'manual' ? 'selected' : ''}>🧩 Prêts à finir (${cnt(a => a.manual)})</option><option value="craft" ${f.state === 'craft' ? 'selected' : ''}>🛠 Fabriqués (Artisanat) (${cnt(a => !a.manual)})</option></select></div>
      </div>
      <div class="frow" style="gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">
        <span class="muted">${list.length !== all.length ? list.length + ' / ' + all.length : all.length} accessoire(s) · <b>${U.qty(T.q)}</b> pièce(s) en stock fini</span>
        <span class="muted sensitive">Valeur du stock : achat <b>${U.eur(T.buy)}</b> · revente TTC <b>${U.eur(T.sell)}</b></span>
        <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">${ro ? '' : `<button style="white-space:nowrap;" class="btn-cta btn-sm fit" onclick="Accessoires.editManual()" title="Ajoute à la main une pièce faite à l'avance mais pas terminée (porte-clés non personnalisés, sangles prédécoupées…)">＋ Ajouter un accessoire</button>`}<button style="white-space:nowrap;" class="btn-ghost btn-sm fit" onclick="Stock.accFoldAll(true)">▼ Tout déplier</button><button style="white-space:nowrap;" class="btn-ghost btn-sm fit" onclick="Stock.accFoldAll(false)">▲ Tout réduire</button></span>
      </div>
      ${items.length ? `<div class="prod-list-header stk-acc-header">
        <span>${sh('name', 'Accessoire')}</span><span>${sh('width', 'Largeur')} · ${sh('cat', 'Catégorie')}</span><span>Général</span><span></span><span>Événement</span><span>${sh('tot', 'Total')}</span><span></span><span class="right">${sh('cost', 'Coût')}</span><span class="right">${sh('price', 'Prix TTC')}</span><span></span>
      </div>
      ${items.map(card).join('')}
      <p class="muted help mt" data-help-anchor=".stk-acc-header > span:first-child">Stock FINI = les pièces déjà fabriquées (modèles d'exposition, porte-clés imprimés d'avance…). « 🛠 Fabriquer » les ajoute ici (et retire les matières) ; chaque vente d'un accessoire en retire. Un accessoire fait à la commande peut rester à 0 (orange). Coût = coût de revient d'une pièce (matières, filament, impression, UV) et Prix TTC = prix de la fiche dans Artisanat (↗ pour l'ouvrir). → et ← déplacent des pièces entre le stock général (site) et le stock événement (SumUp). Min = seuil d'alerte sur le total. Clique une famille pour voir ses longueurs. Bandeau BLEU 🧩 = pièce « prête à finir » ajoutée à la main (porte-clés imprimés non personnalisés, sangles prédécoupées…) : elle n'apparaît pas dans Artisanat ; en fabriquant l'accessoire fini tu peux choisir de partir d'elle. Filtre « État du stock » → « Prêts à finir ».</p>`
      : '<div class="card empty"><span class="big">🐕</span>Aucun accessoire' + (all.length ? ' ne correspond au filtre.' : ' : crée-les dans la page Artisanat, ou ajoute une pièce à la main avec « ＋ Ajouter un accessoire ».') + '</div>'}`;
  },
  /* ───── DLUO des consommables (Antho 2026-10-14 : encres, nettoyants… ont une date limite) ─────
     c.hasDluo = « ce produit a une date limite » ; c.lots = [{id, qty, dluo, lotNumber}] = unités DATÉES. La quantité `c.qty` reste le stock total :
     ce qui n'est dans aucun lot daté = « sans date » (les achats / ajustements continuent de marcher comme avant). Pas de variantes. */
  consoLots(c) {
    if (!c || !c.hasDluo) return [];
    return (c.lots || []).filter(l => l.dluo && U.num(l.qty) > 0).map(l => ({ ...l, days: U.daysTo(l.dluo) })).sort((a, b) => a.days - b.days);
  },
  _consoDluoHTML(c) {
    if (!c.hasDluo) return '';
    const all = this.consoLots(c), hide = !!(window.App && App.isViewer), lots = hide ? all.filter(l => l.days >= 0) : all;
    const dated = all.reduce((s, l) => s + U.num(l.qty), 0), undated = Math.max(0, U.num(c.qty) - dated);
    const tip = all.map(l => U.qty(l.qty) + ' × ' + U.frDate(l.dluo) + (l.lotNumber ? ' (lot ' + l.lotNumber + ')' : '')).join('\n');
    const first = lots[0];
    return `<div style="margin-top:4px;" title="${U.esc(tip)}">${first ? `${U.dluoTag(first.dluo)} <span class="muted" style="font-size:.78rem;">× ${U.qty(first.qty)}${lots.length > 1 ? ` · +${lots.length - 1} autre${lots.length > 2 ? 's' : ''} lot${lots.length > 2 ? 's' : ''}` : ''}</span>` : '<span class="badge warn" style="font-size:.7rem;">📅 aucune DLUO saisie</span>'}${undated > 0 && first ? ` <span class="muted" style="font-size:.78rem;">· ${U.qty(undated)} sans date</span>` : ''}</div>`;
  },
  _cLots: [],
  _consoLotsHTML() {
    const rows = this._cLots.map((l, i) => `<div class="frow" style="gap:8px;align-items:flex-end;margin-bottom:6px;">
      <div class="fg mb0" style="flex:0 0 90px;"><label>Qté</label><input id="c_lot_q_${i}" type="number" step="1" min="0" value="${U.num(l.qty)}"></div>
      <div class="fg mb0" style="flex:1;min-width:150px;"><label>DLUO</label><input id="c_lot_d_${i}" type="date" value="${U.esc(l.dluo || '')}"></div>
      <div class="fg mb0" style="flex:1;min-width:110px;"><label>N° lot (option)</label><input id="c_lot_n_${i}" value="${U.esc(l.lotNumber || '')}"></div>
      <button type="button" class="btn-icon" title="Retirer ce lot" onclick="Stock._delConsoLot(${i})">✕</button></div>`).join('');
    return rows + `<button type="button" class="btn-ghost btn-sm" onclick="Stock._addConsoLot()">＋ Ajouter un lot</button>
      <span class="muted help">Chaque lot = une quantité et sa DLUO. La « Quantité » du consommable reste le stock total : ce qui n'est dans aucun lot est « sans date ». Si les lots dépassent la quantité, la quantité est relevée.</span>`;
  },
  _syncConsoLots() {
    if (!document.getElementById('c_lots_wrap')) return;
    this._cLots = this._cLots.map((l, i) => {
      const q = document.getElementById('c_lot_q_' + i), d = document.getElementById('c_lot_d_' + i), n = document.getElementById('c_lot_n_' + i);
      return q ? { id: l.id, qty: U.num(q.value), dluo: d ? d.value : l.dluo, lotNumber: n ? n.value.trim() : l.lotNumber } : l;
    });
  },
  _drawConsoLots() { const w = document.getElementById('c_lots_wrap'); if (w) w.innerHTML = this._consoLotsHTML(); },
  _addConsoLot() { this._syncConsoLots(); this._cLots.push({ id: U.uid(), qty: 1, dluo: '', lotNumber: '' }); this._drawConsoLots(); },
  _delConsoLot(i) { this._syncConsoLots(); this._cLots.splice(i, 1); this._drawConsoLots(); },
  _onConsoDluoToggle() {
    const on = !!(document.getElementById('c_hasDluo') || {}).checked, w = document.getElementById('c_lots_wrap'); if (!w) return;
    w.style.display = on ? '' : 'none';
    if (on && !this._cLots.length) this._cLots.push({ id: U.uid(), qty: Math.max(1, U.numVal('c_qty')), dluo: '', lotNumber: '' });
    this._drawConsoLots();
  },
  /* Vue « ⏳ Péremptions » de l'onglet Consommables (Antho 2026-10-14 : ne pas mélanger avec les péremptions de la mastication). `list` = consommables déjà filtrés
     (recherche / catégorie…) ; choix : à venir · périmés · tout, triés par date. Viewer : jamais les lots périmés. */
  setConsoView(v) { this.consoFilters.view = v; this.renderConso(); },
  setConsoPm(v) { this.consoFilters.pm = v; this.renderConso(); },
  _consoPeremHTML(list) {
    const f = this.consoFilters, hide = !!(window.App && App.isViewer);
    if (hide && f.pm === 'exp') f.pm = 'up';
    const all = [];
    list.forEach(c => this.consoLots(c).forEach(l => all.push({ c, l })));
    const nUp = all.filter(x => x.l.days >= 0).length, nExp = hide ? 0 : all.filter(x => x.l.days < 0).length;
    const rows = all.filter(x => f.pm === 'exp' ? x.l.days < 0 : f.pm === 'all' ? !(hide && x.l.days < 0) : x.l.days >= 0)
      .sort((a, b) => a.l.days - b.l.days || U.sortFr(a.c.name, b.c.name));
    const seg = U.seg([{ l: `⏳ À venir (${nUp})`, on: f.pm === 'up', js: "Stock.setConsoPm('up')" }].concat(hide ? [] : [{ l: `⚠️ Périmés (${nExp})`, on: f.pm === 'exp', js: "Stock.setConsoPm('exp')" }, { l: `Tout (${nUp + nExp})`, on: f.pm === 'all', js: "Stock.setConsoPm('all')" }]), { sm: true });
    return `<div class="card"><div style="margin-bottom:10px;">${seg}</div>
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th class="col-name">Produit</th><th>Catégorie</th><th>N° lot</th><th>Date péremption</th><th class="num">Quantité</th><th>Statut</th></tr></thead>
      <tbody>${rows.map(({ c, l }) => `<tr><td class="col-name"><b>${U.esc(c.name)}</b></td><td><span class="badge info">${U.esc(c.category || 'Autre')}</span></td><td><span class="tag">${U.esc(l.lotNumber || 'sans n°')}</span></td><td>${U.frDate(l.dluo)}</td><td class="num">${U.qty(l.qty)} ${U.esc(!c.unit || c.unit === 'pc' ? 'PCS' : c.unit)}</td><td>${this.dluoStatusBadge(l.days)}</td></tr>`).join('')}</tbody></table></div>`
        : `<div class="empty" style="padding:18px;text-align:center;"><span class="big">⏳</span>${all.length ? 'Aucun lot pour ce choix.' : 'Aucun lot avec DLUO. Coche « Ce produit a une date limite » dans la fiche d\'un consommable.'}</div>`}</div>`;
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
    c.costUnit = this.consoUnitCost(total, c.costQtyPer, c.costTax);
    const entry = Store.commitSnapshot(snap, 'stock', 'Coût modifié — ' + c.name);
    U.toast('Coût mis à jour.', false, entry.id);
    Store.save('consumables'); App.rerender();
  },
  editConso(id){
    const S=Store.state.settings;
    const c=id?Store.state.consumables.find(x=>x.id===id):{id:U.uid(),name:'',category:S.consCategories[0],unit:'PCS',qty:0,low:0,costUnit:0};
    const isBl = c.category === 'Blisters';
    this._editConsoId = c.id;
    this._cLots = (c.lots || []).map(l => ({ ...l }));
    U.modal({
      title:id?'Modifier':'Nouveau consommable', okLabel:'Enregistrer',
      body:`<div class="frow">
        <div class="fg" style="flex:2;"><label>Nom</label><input id="c_name" value="${U.esc(c.name)}" placeholder="ex: Carton emballage"></div>
        <div class="fg" id="c_dim_wrap" style="${isBl?'display:none':''}"><label>Dimensions</label><input id="c_dim" value="${U.esc(c.dimensions||'')}" placeholder="ex: 20×15×10"></div>
        <div class="fg"><label>Catégorie</label><select id="c_cat" onchange="Stock._onConsoCatChange()">${S.consCategories.slice().sort(U.sortFr).map(x=>`<option ${c.category===x?'selected':''}>${U.esc(x)}</option>`).join('')}</select></div></div>
      <div id="c_blister_fields" style="display:${isBl?'':'none'};margin-bottom:8px;">
        <div class="frow">
          <div class="fg"><label>Largeur du rouleau (mm)</label><input id="c_bwidth" type="number" step="1" value="${c.blisterWidthMm||''}" placeholder="ex: 60"></div>
        </div>
        <p class="muted" style="margin:0;">La longueur restante se saisit dans « En stock » (en mètres), et la longueur achetée dans « Pour » à côté du prix.</p>
      </div>
      <div class="frow">
        <div class="fg"><label>Unité</label><input id="c_unit" value="${U.esc(isBl && !c.unit ? 'm' : (c.unit||'PCS'))}"></div>
        <div class="fg"><label id="c_qty_lbl">${isBl?'En stock (longueur restante)':'Quantité'}</label><input id="c_qty" type="number" step="1" value="${c.qty}"></div>
        <div class="fg"><label>Seuil</label><input id="c_low" type="number" step="1" value="${c.low}"></div>
      </div>
      <div class="frow" style="align-items:flex-end;">
        <div class="fg"><label>Prix d'achat (€)</label><div class="tax-in"><input id="c_costTotal" type="number" step="0.01" value="${c.costTotal!=null?U.num(c.costTotal):U.num(c.costUnit)}" oninput="Stock._calcConsoUnit()"><button type="button" id="c_tax" class="tax-tag" data-tax="${c.costTax==='TTC'?'TTC':'HT'}" title="Clique pour basculer HT ⇄ TTC" onclick="Stock._toggleConsoTax()">${c.costTax==='TTC'?'TTC':'HT'}</button></div></div>
        <div class="fg"><label id="c_costQty_lbl">${isBl?'Pour (longueur achetée)':'Pour (qté achetée)'}</label><input id="c_costQty" type="number" step="0.01" min="0.01" value="${U.num(c.costQtyPer)||1}" oninput="Stock._calcConsoUnit()"></div>
        <div class="fg"><label>Coût unitaire</label><span id="c_costResult" style="display:block;padding:8px 0;font-weight:600;">${(() => { const sh = this.costShown(c.costUnit, Store.state.settings.vatRate ?? 20); return U.eur(sh.v) + ' ' + sh.lab; })()} /u</span></div>
      </div>
      <div class="fg" id="c_uvyear_wrap" style="${c.category==='Entretien UV'?'':'display:none'}"><label>Utilisé / remplacé par an (en unités) <span class="muted help">Entretien imprimante UV : nombre d'unités de ce consommable (flacon d'alcool, tampon feutre, tapis adhésif…) que tu utilises sur l'année. Prix unitaire × ce nombre = coût annuel, ajouté à « Entretien imprimante » (Paramètres → Impression UV).</span></label><input id="c_uvyear" type="number" step="0.01" min="0" value="${U.num(c.uvPerYear)||''}" placeholder="ex : 4"></div>
      <div class="fg" style="margin-top:6px;"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;"><input type="checkbox" id="c_hasDluo" ${c.hasDluo?'checked':''} onchange="Stock._onConsoDluoToggle()" style="width:auto;"> 📅 Ce produit a une date limite (DLUO)</label>
        <div id="c_lots_wrap" style="${c.hasDluo?'':'display:none;'}margin-top:6px;">${c.hasDluo ? this._consoLotsHTML() : ''}</div></div>
      <div class="fg"${Store.hideSupplierInfo() ? ' style="display:none;"' : ''}><label>Réf. fournisseur (optionnel)</label><input id="c_ref" value="${U.esc(c.ref||'')}" placeholder="ex : G-23012, 6784…"></div>
      <div class="fg"${Store.hideSupplierInfo() ? ' style="display:none;"' : ''}><label>Lien fournisseur (page produit, optionnel)</label><div style="display:flex;gap:6px;align-items:center;"><input id="c_url" value="${U.esc(c.url||'')}" placeholder="https://…" style="flex:1;"><button type="button" class="btn btn-sm" style="white-space:nowrap;" title="Ouvrir dans le navigateur" onclick="var u=document.getElementById('c_url').value.trim();if(u)window.open(u,'_blank','noopener');else U.toast('Aucun lien renseigné.',true);">🔗 Ouvrir</button></div></div>
      <div class="fg" style="margin-top:6px;"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;"><input type="checkbox" id="c_toReplace" ${c.toReplace?'checked':''} style="width:auto;"> 🚩 À ne plus racheter (à remplacer ou supprimer)</label></div>
      <div class="frow">
        <div class="fg"><label>Remplacer par (optionnel)</label><select id="c_replaceBy">${this._replaceOpts(c.id, c.category, c.replaceBy)}</select></div>
        <div class="fg" style="flex:2;"><label>Note (optionnel)</label><textarea class="note-area" id="c_replaceNote" rows="1" placeholder="ex : trop cher, finir le stock puis passer au 23×5×35">${U.esc(c.replaceNote||'')}</textarea></div>
      </div>`,
      onOk:()=>{
        if(!U.val('c_name').trim()){U.toast('Nom obligatoire',true);return false;}
        const dupMsgs = this.dupWarnings({ url: U.val('c_url'), ref: U.val('c_ref'), self: { kind: 'C', id: c.id } });
        if (!U.dupGate(dupMsgs, () => document.getElementById('modalOk').click())) return false;
        const hasDluo = !!(document.getElementById('c_hasDluo') || {}).checked;
        let lotsFinal = [];
        if (hasDluo) {
          this._syncConsoLots();
          if (this._cLots.some(l => U.num(l.qty) > 0 && !l.dluo)) { U.toast('Un lot n\'a pas de DLUO : renseigne la date ou retire le lot.', true); return false; }
          lotsFinal = this._cLots.filter(l => l.dluo && U.num(l.qty) > 0).map(l => ({ id: l.id || U.uid(), qty: U.num(l.qty), dluo: l.dluo, lotNumber: l.lotNumber || '' }));
        }
        const snap = id ? Store.snapshot('consumables',c) : null;
        c.name=U.val('c_name').trim();
        c.dimensions=U.val('c_dim').trim();
        c.category=U.val('c_cat');c.unit=U.val('c_unit');c.qty=U.numVal('c_qty');c.low=U.numVal('c_low');
        c.costTotal=U.numVal('c_costTotal'); c.costQtyPer=Math.max(0.01,U.numVal('c_costQty'));
        c.costTax=(document.getElementById('c_tax')||{dataset:{}}).dataset.tax||'HT';
        c.costUnit=this.consoUnitCost(c.costTotal,c.costQtyPer,c.costTax);
        c.hasDluo = hasDluo;
        if (hasDluo) { c.lots = lotsFinal; const dated = lotsFinal.reduce((a, l) => a + l.qty, 0); if (dated > U.num(c.qty)) c.qty = dated; }   // les lots datés comptent dans le stock total
        if (c.category === 'Entretien UV') c.uvPerYear = U.numVal('c_uvyear'); else delete c.uvPerYear;
        c.url=U.val('c_url').trim();
        c.ref=U.val('c_ref').trim();
        c.toReplace = !!(document.getElementById('c_toReplace')||{}).checked;
        c.replaceBy = U.val('c_replaceBy') || '';
        c.replaceNote = U.val('c_replaceNote').trim();
        if (c.category === 'Blisters') {
          c.blisterWidthMm = U.numVal('c_bwidth') || null;
        }
        if(!id) Store.state.consumables.push(c);
        const entry = Store.log('stock',(id?'Consommable modifié':'Consommable créé')+' — '+c.name,
          id ? { type:'restoreItem', data:snap } : { type:'deleteCreated', data:{ domain:'consumables', id:c.id } });
        Store.save('consumables'); U.closeModal(); App.rerender();
        U.toast(id?'Modification enregistrée.':'Consommable créé.', false, entry.id);
      }
    });
  },
  /* « Remplacer par » : uniquement les consommables de la MÊME catégorie (un blister ne se remplace pas par un sachet). */
  _replaceOpts(selfId, cat, cur) {
    const same = Store.state.consumables.filter(x => x.id !== selfId && (x.category || 'Autre') === (cat || 'Autre'))
      .sort((a, b) => U.sortFr(a.name + (this.consoDims(a) || ''), b.name + (this.consoDims(b) || '')));
    return `<option value="">—</option>` + same.map(x => `<option value="${x.id}" ${cur === x.id ? 'selected' : ''} data-a="${U.esc(x.name)}" data-b="${U.esc(this.consoDims(x) || '')}" data-c="${U.esc(U.eur(x.costUnit))}">${U.esc(x.name)}${this.consoDims(x) ? ' · ' + U.esc(this.consoDims(x)) : ''}</option>`).join('');
  },
  _onConsoCatChange() {
    const cat = U.val('c_cat');
    const rb = document.getElementById('c_replaceBy');
    if (rb) { const id = (Store.state.consumables.find(x => x.name === U.val('c_name')) || {}).id; rb.innerHTML = this._replaceOpts(this._editConsoId || id, cat, rb.value); }
    const isBl = cat === 'Blisters';
    const bl = document.getElementById('c_blister_fields');
    const dw = document.getElementById('c_dim_wrap');
    const uy = document.getElementById('c_uvyear_wrap'); if (uy) uy.style.display = cat === 'Entretien UV' ? '' : 'none';
    if (bl) bl.style.display = isBl ? '' : 'none';
    if (dw) dw.style.display = isBl ? 'none' : '';
    const ql = document.getElementById('c_qty_lbl'); if (ql) ql.textContent = isBl ? 'En stock (longueur restante)' : 'Quantité';
    const cl = document.getElementById('c_costQty_lbl'); if (cl) cl.textContent = isBl ? 'Pour (longueur achetée)' : 'Pour (qté achetée)';
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
  /* Dimensions affichées : un rouleau de blister n'a pas de L×l×h mais une LARGEUR (mm). */
  consoDims(c) {
    if (c.category === 'Blisters' && U.num(c.blisterWidthMm)) return U.num(c.blisterWidthMm) + ' mm';
    return c.dimensions || '';
  },
  _dimVolume(dim) {
    if (!dim) return 0;
    const nums = dim.match(/[\d.,]+/g);
    if (!nums || !nums.length) return 0;
    return nums.reduce((a, n) => a * parseFloat(n.replace(',', '.')), 1);
  },
  /* Prix d'achat consommable saisi HT ou TTC (c.costTax, défaut HT) : le coût unitaire est toujours
     ramené en HT (même convention que les fiches fournisseur du calcul de prix). */
  consoUnitCost(total, qper, tax) {
    const vat = 1 + U.num(Store.state.settings.vatRate ?? 20) / 100;
    const q = U.num(qper) > 0 ? U.num(qper) : 1;
    return U.num(total) / q / (tax === 'TTC' ? vat : 1);
  },
  /* Matières premières : prix d'achat saisi HT ou TTC (m.costTax) avec une TVA d'achat propre à la matière (m.costVat,
     vide = TVA globale). Le coût par unité (m.costUnit) est toujours ramené en HT, hors frais de port
     (le port se saisit sur la facture d'Achats, qui remet alors le coût réel à jour). */
  /* AFFICHAGE d'un coût unitaire dans le Stock : tant qu'Antho n'est pas assujetti à la TVA il achète TTC (TVA non récupérée) → on lui montre le TTC.
     Les CALCULS restent en HT (costUnit) : l'appli rajoute ensuite la TVA sur le prix de vente. Assujetti → HT. */
  costShown(ht, vat) {
    const S = Store.state.settings;
    return S.vatActive ? { v: U.num(ht), lab: 'HT' } : { v: U.num(ht) * (1 + U.num(vat) / 100), lab: 'TTC' };
  },
  /* Coefficient « TVA d'achat » d'un produit stock : taux de la ligne fournisseur principale de sa fiche prix, sinon taux global ; 1 si assujetti. */
  buyK(p, v) {
    const S = Store.state.settings; if (S.vatActive) return 1;
    const cat = Store.state.catalogM.find(x => x.id === ((v && v.catalogId) || (p && p.catalogId)));
    const e = cat ? Pricing.mainEntry(cat) : null;
    return Pricing.vatK(e ? Pricing.purchaseVatOf(e.supplierId, e.vatRate) : undefined);
  },
  /* Coût d'UNE pièce d'un lot pour la marge (2026-10-07) : les lots créés depuis cette date portent un coût déjà complet (`costFinal`, TVA d'achat comprise tant que non assujetti) ;
     les lots plus anciens (coût HT) reçoivent la TVA d'achat au moment de la vente. Sans coût de lot : coût de la variante. */
  lotCost(p, v, lot) {
    const c = lot ? U.num(lot.costUnit) : 0;
    if (!c) return U.num(v && v.costUnit);
    return lot.costFinal ? c : c * this.buyK(p, v);
  },
  matVat(m) { return U.num(m.costVat !== undefined && m.costVat !== null && m.costVat !== '' ? m.costVat : (Store.state.settings.vatRate ?? 20)); },
  matUnitCostOf(total, qper, tax, vat) {
    const q = U.num(qper) > 0 ? U.num(qper) : 1;
    return U.num(total) / q / (tax === 'TTC' ? 1 + U.num(vat) / 100 : 1);
  },
  matUnitCost(m) { return this.matUnitCostOf(m.costTotal != null ? m.costTotal : m.costUnit, m.costQtyPer, m.costTax, this.matVat(m)); },
  _toggleMatTaxIn() {
    const b = document.getElementById('m_tax'); if (!b) return;
    b.dataset.tax = b.dataset.tax === 'TTC' ? 'HT' : 'TTC'; b.textContent = b.dataset.tax;
    this._calcMatUnit();
  },
  _calcMatUnit() {
    const tax = (document.getElementById('m_tax') || { dataset: {} }).dataset.tax || 'HT';
    const vatTxt = U.val('m_vat').trim();
    const vat = vatTxt === '' ? U.num(Store.state.settings.vatRate ?? 20) : U.num(vatTxt);
    const unit = document.getElementById('m_unit') ? U.val('m_unit') : 'm';
    const el = document.getElementById('m_costResult');
    const sh = this.costShown(this.matUnitCostOf(U.numVal('m_costTotal'), U.numVal('m_costQty'), tax, vat), vat);
    if (el) el.textContent = U.eur(sh.v) + ' ' + sh.lab + ' / ' + (unit === 'm' ? 'm' : unit === 'g' ? 'g' : 'pièce');
  },
  _toggleConsoTax() {
    const b = document.getElementById('c_tax'); if (!b) return;
    b.dataset.tax = b.dataset.tax === 'TTC' ? 'HT' : 'TTC';
    b.textContent = b.dataset.tax;
    this._calcConsoUnit();
  },
  _calcConsoUnit() {
    const tax = (document.getElementById('c_tax') || { dataset: {} }).dataset.tax || 'HT';
    const unit = this.consoUnitCost(U.numVal('c_costTotal'), U.numVal('c_costQty'), tax);
    const el = document.getElementById('c_costResult');
    const sh = this.costShown(unit, Store.state.settings.vatRate ?? 20);
    if (el) el.textContent = U.eur(sh.v) + ' ' + sh.lab + ' /u';
  },
  async delConso(id){
    const c=Store.state.consumables.find(x=>x.id===id); if(!c) return;
    const isShip = Store.state.settings.shipLabelConsoId === id;   // étiquette d'envoi reliée aux livraisons : on prévient avant
    if(!await U.confirm(isShip ? `« ${c.name} » est ton ÉTIQUETTE D'ENVOI : elle est ajoutée automatiquement à chaque livraison.\n\nSi tu la supprimes, plus aucune étiquette ne sera ajoutée (tu pourras en relier une autre dans Paramètres). Les ventes déjà enregistrées gardent leur ligne.\n\nSupprimer quand même ?` : `Supprimer le consommable « ${c.name} » ?`, isShip ? { danger: true, okLabel: 'Supprimer quand même' } : undefined)) return;
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
  matFilters: { q: '', type: 'all', variants: [], variantsOpen: false, sort: 'name', sortDir: 'asc', link: 'all', state: 'all' },
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
    const T = this._matTests(), cnt = fn => Store.state.materials.filter(fn).length, hideSup = Store.hideSupplierInfo();
    const todoOpts = [{ v: 'all', l: 'Tous' }].concat(Object.keys(T.todoLabel).filter(k => !hideSup || !T.supplierOnly.includes(k)).map(k => ({ v: k, l: T.todoLabel[k] + ' (' + cnt(T.todo[k]) + ')' })));
    const stateOpts = [{ v: 'all', l: 'Tous' }].concat(Object.keys(T.stateLabel).map(k => ({ v: k, l: T.stateLabel[k] + ' (' + cnt(T.state[k]) + ')' })));
    if (!todoOpts.some(o => o.v === f.link)) f.link = 'all';
    const list = Store.state.materials.filter(m => {
      if (q && !U.has(m.name + ' ' + (m.product || '') + ' ' + (m.variant || '') + ' ' + (m.sku || '') + ' ' + (m.ref || ''), q)) return false;
      if (f.type !== 'all' && m.kind !== f.type) return false;
      if (f.variants.length && !f.variants.includes(m.variant || m.name)) return false;
      if (f.link !== 'all' && T.todo[f.link] && !T.todo[f.link](m)) return false;
      if (f.state !== 'all' && T.state[f.state] && !T.state[f.state](m)) return false;
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
          <div class="fg mb0"><label>Recherche</label><input id="stock_q_mat" value="${U.esc(f.q)}" placeholder="🔍 nom, produit, SKU, réf. fournisseur…" oninput="Stock.matFilters.q=this.value;Stock.renderMatieres();U.refocus('stock_q_mat')"></div>
          <div class="fg mb0"><label>Type</label>${U.customSelect({ value: f.type, options: [{ v: 'all', l: 'Tous' }].concat(Store.materialKinds().map(k => ({ v: k.value, l: k.label }))), onPick: 'Stock._setMatType' })}</div>
          <div class="fg mb0"><label>Tailles / variantes</label>${U.multiSelect({ options: allVariants, selected: f.variants, toggle: 'Stock.matToggleVariant', setAll: 'Stock.matSetAllVariant', open: f.variantsOpen, onOpen: 'Stock.matSetOpen' })}</div>
          <div class="fg mb0"><label>À compléter</label>${U.customSelect({ value: f.link, options: todoOpts, onPick: 'Stock._setMatLink' })}</div>
          <div class="fg mb0"><label>État du stock</label>${U.customSelect({ value: f.state || 'all', options: stateOpts, onPick: 'Stock._setMatState' })}</div>
        </div>
        <div class="frow mt" style="gap:6px;align-items:center;">
          <button class="btn-cta btn-sm" onclick="Stock.editMat()">＋ Nouvelle matière</button>
          ${U.seg([{ l: '▼ Tout déplier', js: 'Stock.foldAllMat(false)' }, { l: '▲ Tout réduire', js: 'Stock.foldAllMat(true)' }], { sm: true })}
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
    const hasAlert = items.some(m => U.num(m.low) > 0 && U.num(m.qty) <= U.num(m.low));
    const keyEsc = U.esc(key).replace(/&#39;/g, "\\'");
    const groupOpen = this._matGroupOpen[key] || false;
    return `<details class="fold prod-fold" ${groupOpen ? 'open' : ''} ontoggle="Stock.setMatGroupOpen('${keyEsc}',this.open)">
      <summary>
        <b>${U.esc(key)}</b>
        <span class="type-col">
          <span class="badge info">${this.matKindLabel[items[0].kind] || items[0].kind}</span>
          ${hasAlert ? '<span class="badge warn">Stock bas</span>' : ''}
        </span>
        <span class="meta">${items.length} référence(s)</span>
        <span class="prod-actions act-grid"><span class="act-row">
          <button class="btn-icon" title="Dupliquer le produit avec toutes ses ${Store.isSangleKind(items[0].kind) ? 'tailles' : 'variantes'}" onclick="event.preventDefault();event.stopPropagation();Stock.dupMatGroup('${keyEsc}')">📋</button>
          <button class="btn-ghost btn-sm" title="Modifier le produit : nom, taille, catégorie" onclick="event.preventDefault();event.stopPropagation();Stock.editMatGroup('${keyEsc}')">Modifier</button>
          <button class="btn-icon" title="Supprimer tout le groupe" onclick="event.preventDefault();event.stopPropagation();Stock.delMatGroup('${keyEsc}')">🗑️</button>
        </span></span>
      </summary>
      <div class="fold-body"><div class="table-wrap"><table class="mat-table">
        <thead><tr><th class="col-name">${Store.isSangleKind(items[0].kind) ? 'Taille' : 'Variante'}</th><th>SKU</th>${Store.hideSupplierInfo() ? '' : '<th>Réf. fournisseur</th>'}<th>Coût / unité</th><th>En stock</th><th>Seuil</th><th></th></tr></thead>
        <tbody>${items.map((m, i) => this.materialRow(m, i, items)).join('')}</tbody>
      </table></div>
      <button class="btn-cta btn-sm mt" onclick="Stock.addMatVariant('${keyEsc}')">＋ Ajouter ${Store.isSangleKind(items[0].kind) ? 'une taille' : 'une variante'}</button>
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
    if (!m.rolls || m.rolls.length < 1) return;
    const sum = m.rolls.reduce((a, r) => a + U.num(r.qty), 0);
    const drift = U.num(m.qty) - sum;
    if (Math.abs(drift) > 0.0001) m.rolls[m.rolls.length - 1].qty = Math.max(0, U.num(m.rolls[m.rolls.length - 1].qty) + drift);
  },

  materialRow(m, i, items) {
    const isSangle = Store.isSangleKind(m.kind);
    if (isSangle) this.reconcileRolls(m);
    const unit = Store.matUnitLabel(m.unit);
    const hasRolls = isSangle && m.rolls && m.rolls.length > 0;
    const multiRoll = hasRolls && m.rolls.length > 1;
    const rollsOpen = this._matRollsOpen[m.id] || false;
    const low = U.num(m.low), qty = U.num(m.qty);
    const label = U.esc(m.variant || m.name);
    const costTotal = m.costTotal != null ? U.num(m.costTotal) : U.num(m.costUnit);
    const costQtyPer = U.num(m.costQtyPer) || 1;
    const shown = this.costShown(m.costUnit, this.matVat(m));

    const sortedRolls = (m.rolls || []).slice().sort((a, b) => {
      const ae = a.entame ? 1 : 0, be = b.entame ? 1 : 0;
      if (ae !== be) return be - ae;
      if (ae && be) return U.num(a.qty) - U.num(b.qty);
      return 0;
    });
    const rollsBox = (isSangle && rollsOpen) ? `<tr class="lots-row"><td colspan="${Store.hideSupplierInfo() ? 6 : 7}" style="padding:0;">
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
      <td class="col-name">${isSangle ? `<button class="btn-icon" title="${rollsOpen ? 'Replier' : 'Déplier'} les rouleaux" onclick="Stock.toggleMatRollsOpen('${m.id}')" style="margin-right:4px;">${rollsOpen ? '▾' : '▸'}</button>` : ''}${label}${multiRoll ? ` <span class="badge info" title="${m.rolls.length} rouleaux distincts">🧵 ${m.rolls.length} rouleaux</span>` : ''}<span class="mini-reorder" style="display:inline-flex;margin:0 0 0 8px;vertical-align:middle;"><button class="btn-icon" title="Monter" ${i <= 0 ? 'disabled' : ''} onclick="Stock.moveMatVariant('${m.id}',-1)">↑</button><button class="btn-icon" title="Descendre" ${i >= items.length - 1 ? 'disabled' : ''} onclick="Stock.moveMatVariant('${m.id}',1)">↓</button></span></td>
      <td class="muted">${U.esc(m.sku || '—')}</td>
      ${Store.hideSupplierInfo() ? '' : `<td><input class="mat-ref" value="${U.esc(m.ref || '')}" placeholder="réf." title="Référence chez le fournisseur" onchange="Stock.setMatText('${m.id}','ref',this.value)"></td>`}
      <td class="sensitive"><div class="cost-split"><input type="number" step="0.01" value="${costTotal}" onchange="Stock.setMatCost('${m.id}','costTotal',this.value)"><span class="cost-split-sep">/</span><input type="number" step="0.01" value="${costQtyPer}" onchange="Stock.setMatCost('${m.id}','costQtyPer',this.value)"></div>${costQtyPer !== 1 || Math.abs(shown.v - costTotal) > 0.0005 ? `<div class="muted" style="font-size:.78rem;margin-top:3px;">= ${U.eur(shown.v)} ${shown.lab} / ${unit}${unit === 'g' ? ` (${U.eur(shown.v * 1000)} / kg)` : ''}</div>` : ''}</td>
      <td class="${low > 0 && qty <= low ? 'warn-txt' : ''}">${isSangle
        ? `<b>${U.qty(qty)}</b> ${unit}`
        : `<input type="number" step="0.01" value="${qty}" onchange="Stock.setMatField('${m.id}','qty',this.value)"> ${unit}`}</td>
      <td><input type="number" step="0.01" value="${low}" title="Seuil d'alerte" onchange="Stock.setMatField('${m.id}','low',this.value)"></td>
      <td class="right"><div class="act-grid"><span class="act-row">
        ${Store.hideSupplierInfo() ? '' : `<button class="btn-icon" title="${m.url ? 'Ouvrir la page fournisseur' : 'Ajouter un lien fournisseur'}" onclick="Stock.openMatLink('${m.id}')">${m.url ? '🔗' : '🔗＋'}</button>`}
        <button class="btn-icon" title="Dupliquer : nouvelle ${isSangle ? 'taille' : 'variante'} avec le même prix" onclick="Stock.dupMat('${m.id}')">📋</button>
        </span><span class="act-row">
        <button class="btn-ghost btn-sm" title="Modifier" onclick="Stock.editMat('${m.id}')">Modifier</button>
        <button class="btn-icon" title="Supprimer" onclick="Stock.delMat('${m.id}')">🗑️</button>
      </span></div></td>
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
  async delMatRoll(mId, rId) {
    const m = Store.state.materials.find(x => x.id === mId); if (!m || !m.rolls) return;
    const isLast = m.rolls.length <= 1;
    if (!await U.confirm(isLast ? 'Supprimer le dernier rouleau ? Le stock de cette taille passera à 0.' : 'Supprimer ce rouleau ?')) return;
    const snap = Store.snapshot('materials', m);
    if (isLast) {
      m.qty = 0;   // le stock d'une sangle = ses rouleaux : plus de rouleau, plus de stock
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
    m.costUnit = this.matUnitCost(m);
    const entry = Store.commitSnapshot(snap, 'stock', 'Coût modifié — ' + (m.product ? m.product + ' ' : '') + (m.variant || m.name));
    U.toast('Coût mis à jour.', false, entry.id);
    Store.save('materials'); App.rerender();
  },

  /* Champ texte d'une matière (ex. référence fournisseur), enregistré en quittant la case — annulable via le Journal. */
  setMatText(id, field, val) {
    const m = Store.state.materials.find(x => x.id === id); if (!m) return;
    const v = String(val || '').trim(); if (v === String(m[field] || '')) return;
    const snap = Store.snapshot('materials', m);
    m[field] = v;
    const entry = Store.commitSnapshot(snap, 'stock', 'Référence fournisseur modifiée — ' + (m.product ? m.product + ' ' : '') + (m.variant || m.name));
    U.toast('Référence enregistrée.', false, entry.id);
    Store.save('materials');
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

  /* ───── Matières : PRODUIT + TAILLE + VARIANTES (même principe que la Mastication) — décision d'Antho 2026-10-05 ─────
     Types HORS sangle (mousquetons, anneaux, rivets…) : le produit est rattaché à UNE taille de sangle (`m.size`, ex. « 20mm ») qui s'ajoute en SUFFIXE de son nom
     (« mousqueton » + 20mm → « mousqueton 20mm », stocké dans `m.product`) ; ses lignes sont des VARIANTES (`m.variant` : Noir, Argent, Or) avec chacune son SKU, sa réf., son prix,
     son stock. Le prix moyen des variantes sert dans Accessoires. SANGLES : produit = couleur, lignes = TAILLES (`m.variant` = largeur), pas de `m.size`. */
  matBase(m) { const p = m.product || m.name || ''; return m.size && p.toLowerCase().endsWith((' ' + m.size).toLowerCase()) ? p.slice(0, p.length - m.size.length - 1).trim() : p; },
  /* « Toutes les tailles » (`m.allSizes`, valeur '__all' dans les menus) : pièce utilisable sur n'importe quelle largeur de sangle (rivets, clous, décorations…), sans suffixe de taille dans le nom.
     Sans taille du tout (« aucune ») = pièce non rattachée (achat test) : elle n'est proposée dans Accessoires que si aucune largeur n'est choisie. */
  _applySize(o, size) { delete o.size; delete o.allSizes; if (size === '__all') o.allSizes = true; else if (size) o.size = size; },
  matCompose(base, size) { base = String(base || '').trim(); size = size === '__all' ? '' : String(size || '').trim(); return size && !base.toLowerCase().endsWith(size.toLowerCase()) ? (base + ' ' + size).trim() : base; },
  /* Toutes les tailles déjà utilisées : tailles des produits hors sangle + largeurs des sangles (+ anciennes variantes qui ressemblent à une largeur). */
  _allSizes() {
    const set = new Set();
    Store.state.materials.forEach(x => {
      if (x.size) set.add(x.size);
      else if (x.variant && (Store.isSangleKind(x.kind) || /^\s*\d+(?:[.,]\d+)?\s*mm\s*$/i.test(x.variant))) set.add(x.variant);
    });
    return [...set].sort(U.sortFr);
  },
  /* Menu « Taille » : tailles déjà utilisées + « Autre… » (champ texte). `taken` = tailles à griser (déjà dans ce produit, sangles). `none` = proposer « aucune ». */
  _sizeSelect(selId, inpId, cur, taken, none, onchange) {
    const labels = this._allSizes(); if (cur && cur !== '__all' && !labels.includes(cur)) labels.push(cur);
    const nrm = v => U.normSearch(v).replace(/\s+/g, '');
    if (!labels.length && !none) return `<input id="${inpId}" value="${U.esc(cur || '')}" placeholder="ex: 20mm">`;
    return `<select id="${selId}" onchange="var i=document.getElementById('${inpId}'),n=this.value==='__new';i.style.display=n?'':'none';if(n)i.focus();${onchange || ''}">
        ${cur ? (none ? '<option value="">— aucune —</option>' : '') : (none ? '<option value="">— aucune —</option>' : '<option value="">— choisir —</option>')}
        ${none ? `<option value="__all" ${cur === '__all' ? 'selected' : ''}>Toutes les tailles</option>` : ''}
        ${labels.map(v => { const t = taken && taken.has(nrm(v)) && nrm(v) !== nrm(cur || ''); return `<option value="${U.esc(v)}" ${v === cur ? 'selected' : ''} ${t ? 'disabled' : ''}>${U.esc(v)}${t ? ' — déjà dans ce produit' : ''}</option>`; }).join('')}
        <option value="__new">＋ Autre (nouvelle taille)…</option></select>
      <input id="${inpId}" value="" placeholder="ex: 20mm" style="display:none;margin-top:6px;">`;
  },
  _pickedSize(selId, inpId) { const v = U.val(selId); return (v && v !== '__new' ? v : U.val(inpId)).trim(); },

  /* Champ « Taille » de la fenêtre matière (selon le Type) : sangle = largeur de la ligne (sans variante) ; autre type = taille du PRODUIT (suffixe de son nom), masquée
     quand on ajoute une variante dans un produit existant (elle est déjà celle du produit). */
  _matSizeField(m, prod, kind, curOverride) {
    const sang = Store.isSangleKind(kind || m.kind);
    if ((!sang && this._matPreset) || (kind || m.kind) === 'filament') return `<div class="fg" id="m_size_fg" style="display:none;"></div>`;   // filament : pas de taille de sangle
    let cur = curOverride;
    if (cur === undefined) cur = sang ? (m.variant || (m.product ? '' : m.name) || '') : (m.allSizes ? '__all' : (m.size || (/^\s*\d+(?:[.,]\d+)?\s*mm\s*$/i.test(m.variant || '') ? m.variant : '')));
    const nrm = v => U.normSearch(v).replace(/\s+/g, '');
    const taken = sang && prod ? new Set(Store.state.materials.filter(x => x.id !== m.id && (x.product || x.name) === prod).map(x => nrm(x.variant || x.name))) : null;
    const info = sang ? "La largeur de cette ligne (10mm, 16mm…). Celles déjà dans ce produit sont grisées."
      : "La taille de sangle à laquelle ce produit est adapté (20mm…). Elle s'ajoute à la fin du nom du produit : « mousqueton » + 20mm → « mousqueton 20mm ». « Toutes les tailles » : utilisable sur n'importe quelle largeur de sangle (rivets, clous, décorations…). « Aucune » : pièce non rattachée (achat test), proposée dans Accessoires seulement quand aucune largeur n'est choisie.";
    return `<div class="fg" id="m_size_fg"><label>Taille ${U.info(info)}</label>${this._sizeSelect('m_size_sel', 'm_size', cur, taken, !sang)}</div>`;
  },
  _matVariantRow(m, kind) {
    const sang = Store.isSangleKind(kind || m.kind);
    const cur = sang ? '' : ((m.size || !/^\s*\d+(?:[.,]\d+)?\s*mm\s*$/i.test(m.variant || '')) ? (m.variant || '') : '');   // ancienne fiche dont la « variante » était la taille : à re-saisir
    return `<div class="fg" id="m_vrow" style="${sang ? 'display:none;' : ''}"><label>Variante ${U.info("Une déclinaison du produit : Noir, Argent, Or… Chaque variante a son prix, sa réf. fournisseur et son lien ; le prix moyen des variantes sert dans Accessoires.")}</label><input id="m_variant" value="${U.esc(cur)}" placeholder="ex: Noir, Argent, Or…"></div>`;
  },
  /* Le Type change (sangle ⇄ autre) : la ligne « Variante » apparaît / disparaît et le menu Taille change de sens. */
  _matKindChanged(kind) {
    const m = this._matEditing; if (!m) return;
    const row = document.getElementById('m_vrow'); if (row) row.style.display = Store.isSangleKind(kind) ? 'none' : '';
    const qf = document.getElementById('m_qty_fg'); if (qf) qf.style.display = Store.isSangleKind(kind) ? 'none' : '';
    const u = document.getElementById('m_unit');   // unité proposée selon le type (sangle = mètre, le reste = pièce), modifiable ensuite
    if (u) { u.value = Store.isSangleKind(kind) ? 'm' : kind === 'filament' ? 'g' : 'piece'; }
    const cq = document.getElementById('m_costQty'); if (cq && kind === 'filament' && U.num(cq.value) === 1) cq.value = 1000;   // filament : prix de la bobine pour 1000 g (1 kg), modifiable
    this._calcMatUnit();
    this._matSizeRefresh(kind);
  },
  _matSizeRefresh(kindArg) {
    const m = this._matEditing, fg = document.getElementById('m_size_fg'); if (!m || !fg) return;
    const kind = kindArg || U.val('m_kind') || m.kind, sang = Store.isSangleKind(kind);
    const picked = this._pickedSize('m_size_sel', 'm_size');
    const prod = U.val('m_product').trim(), nrm = v => U.normSearch(v).replace(/\s+/g, '');
    const clash = sang && picked && prod && Store.state.materials.some(x => x.id !== m.id && (x.product || x.name) === prod && nrm(x.variant || x.name) === nrm(picked));
    fg.outerHTML = this._matSizeField(m, prod, kind, clash ? '' : picked);
  },

  /* 📋 Dupliquer une ligne (variante / taille) : ouvre « nouvelle ligne » dans le MÊME produit, préremplie avec le type, l'unité, le prix, la TVA et le seuil de la ligne copiée
     (réf., lien, SKU et stock restent vides : propres à chaque ligne). Rien n'est créé tant qu'on n'a pas enregistré. */
  dupMat(id) {
    const src = Store.state.materials.find(x => x.id === id); if (!src) return;
    this.editMat(null, src.product || src.name, src);
  },

  /* 📋 Dupliquer un PRODUIT entier avec toutes ses lignes (variantes / tailles) : prix, type, unité, TVA, seuil conservés ; stock, réf., lien et SKU repartent vides (SKU recalculés).
     Sert à créer « mousqueton 16mm » depuis « mousqueton 20mm ». Annulable en un coup (journal restoreBatch avec before:null = suppression des copies). */
  dupMatGroup(key) {
    const items = Store.state.materials.filter(m => (m.product || m.name) === key); if (!items.length) return;
    const sang = Store.isSangleKind(items[0].kind), base = sang ? key : this.matBase(items[0]);
    U.modal({
      title: '📋 Dupliquer le produit', okLabel: 'Dupliquer',
      body: `<p class="muted" style="margin:0 0 10px;">Copie « <b>${U.esc(key)}</b> » avec ses ${items.length} ${sang ? 'taille(s)' : 'variante(s)'} : prix, type et seuil sont gardés ; le stock, les réf., les liens et les SKU repartent vides.</p>
        <div class="fg"><label>Nom du nouveau produit${sang ? '' : ' (la taille s’ajoute à la fin)'}</label><input id="dg_name" value="${U.esc(base)}" autofocus></div>
        ${sang ? '' : `<div class="fg"><label>Taille</label>${this._sizeSelect('dg_size_sel', 'dg_size', '', null, true)}</div>`}`,
      onOk: () => {
        const name = U.val('dg_name').trim(); if (!name) { U.toast('Indique le nom du nouveau produit.', true); return false; }
        const size = sang ? '' : this._pickedSize('dg_size_sel', 'dg_size'), prod = sang ? name : this.matCompose(name, size);
        if (prod === key || Store.state.materials.some(x => (x.product || x.name) === prod)) { U.toast('Un produit « ' + prod + ' » existe déjà : change le nom ou la taille.', true); return false; }
        const copies = items.map(m => {
          const c = JSON.parse(JSON.stringify(m));
          c.id = U.uid(); c.product = prod; if (!sang) this._applySize(c, size);
          c.name = (prod + ' ' + (c.variant || '')).trim(); c.qty = 0; delete c.rolls; c.ref = ''; c.url = '';
          c.sku = Pricing.autoSkuMat(prod, c.kind, c.variant);
          return c;
        });
        copies.forEach(c => Store.state.materials.push(c));
        const entry = Store.log('stock', `Produit dupliqué — ${key} → ${prod} (${copies.length} ligne(s))`, { type: 'restoreBatch', data: copies.map(c => ({ domain: 'materials', id: c.id, before: null })) });
        Store.save('materials'); U.closeModal(); App.rerender();
        U.toast(`Produit « ${prod} » créé (${copies.length} ligne(s)).`, false, entry.id);
      }
    });
  },

  editMat(id, presetProduct, tpl) {
    this._matEditing = null; this._matPreset = presetProduct || '';
    const ref = tpl || (presetProduct ? Store.state.materials.find(x => (x.product || x.name) === presetProduct) : null);
    this._matPresetSize = ref?.allSizes ? '__all' : (ref?.size || '');
    const m = id ? Store.state.materials.find(x => x.id === id)
      : { id: U.uid(), product: presetProduct || '', size: ref?.size || '', ...(ref?.allSizes ? { allSizes: true } : {}), variant: '', name: '', kind: ref?.kind || 'sangle', unit: ref?.unit || 'm', sku: '', costUnit: tpl ? tpl.costUnit : '', ...(tpl && tpl.costTotal != null ? { costTotal: tpl.costTotal, costQtyPer: tpl.costQtyPer } : {}), qty: 0, low: tpl ? tpl.low : 0, costTax: ref ? ref.costTax : 'TTC', costVat: ref ? ref.costVat : 21 };
    this._matEditing = m;
    const mTax = m.costTax === 'TTC' ? 'TTC' : 'HT', mTotal = m.costTotal != null ? U.num(m.costTotal) : U.num(m.costUnit), mQper = U.num(m.costQtyPer) || 1;
    U.modal({
      title: id ? 'Modifier la matière — ' + U.esc(m.product || m.name) : (tpl ? '📋 Dupliquer — ' + U.esc(presetProduct) : presetProduct ? '＋ ' + (Store.isSangleKind(m.kind) ? 'Taille' : 'Variante') + ' — ' + U.esc(presetProduct) : 'Nouvelle matière'), okLabel: 'Enregistrer',
      body: `
      <div class="frow" style="align-items:flex-start;">
        <div class="fg"><label>Produit ${U.info("Le nom du produit (ex : « mousqueton »). Pour un type hors sangle, la taille choisie à côté s'ajoute à la fin du nom (« mousqueton 20mm » ; rien n'est ajouté pour « Toutes les tailles » ou « aucune »). Pour renommer un produit entier : bouton « Modifier » sur la ligne du produit.")}</label><input id="m_product" value="${U.esc(presetProduct || (m.size ? this.matBase(m) : (m.product || '')))}" placeholder="ex: mousqueton" ${presetProduct ? 'readonly' : ''} oninput="Stock._matSizeRefresh()"></div>
        ${this._matSizeField(m, m.product || presetProduct || '', m.kind)}
      </div>
      ${this._matVariantRow(m, m.kind)}
      <div class="frow">
        <div class="fg"><label>Type</label><select id="m_kind" onchange="Stock._matKindChanged(this.value)">
          ${Store.materialKinds().map(k => `<option value="${U.esc(k.value)}" ${m.kind === k.value ? 'selected' : ''}>${U.esc(k.label)}${Store.isSangleKind(k.value) ? ' (rouleaux)' : ''}</option>`).join('')}</select></div>
        <div class="fg"><label>Unité ${U.info("Proposée automatiquement selon le type (mètre pour les sangles, pièce pour le reste) ; tu peux la changer si une matière sort de la règle.")}</label><select id="m_unit" onchange="Stock._calcMatUnit()">
          <option value="m" ${m.unit === 'm' ? 'selected' : ''}>mètre</option>
          <option value="piece" ${m.unit !== 'm' && m.unit !== 'g' ? 'selected' : ''}>pièce</option>
          <option value="g" ${m.unit === 'g' ? 'selected' : ''}>gramme (filament)</option></select></div>
      </div>
      <div class="frow">
        <div class="fg"><label>SKU</label><input id="m_sku" value="${U.esc(m.sku || '')}"></div>
        <div class="fg"><label>TVA d'achat (%)</label><input id="m_vat" type="number" step="0.1" value="${m.costVat ?? ''}" placeholder="${Store.state.settings.vatRate} (global)" oninput="Stock._calcMatUnit()"></div>
      </div>
      <div class="frow">
        <div class="fg"><label>Prix d'achat (€, hors port)</label><div class="tax-in"><input id="m_costTotal" type="number" step="0.01" value="${mTotal}" oninput="Stock._calcMatUnit()"><button type="button" id="m_tax" class="tax-tag" data-tax="${mTax}" title="Clique pour basculer HT ⇄ TTC" onclick="Stock._toggleMatTaxIn()">${mTax}</button></div></div>
        <div class="fg"><label>Pour (quantité achetée)</label><input id="m_costQty" type="number" step="0.01" min="0.01" value="${mQper}" oninput="Stock._calcMatUnit()"></div>
      </div>
      <div class="fg"><label>Coût par unité</label><span id="m_costResult" style="display:block;padding:4px 0;font-weight:600;">${(() => { const sh = this.costShown(m.costUnit, this.matVat(m)); return U.eur(sh.v) + ' ' + sh.lab; })()} / ${m.unit === 'm' ? 'm' : m.unit === 'g' ? 'g' : 'pièce'}</span></div>
      <div class="frow">
        <div class="fg" id="m_qty_fg" style="${Store.isSangleKind(m.kind) ? 'display:none;' : ''}"><label>Quantité en stock</label><input id="m_qty" type="number" step="0.01" value="${m.qty}"></div>
        <div class="fg"><label>Seuil d'alerte</label><input id="m_low" type="number" step="0.01" value="${m.low}"></div>
      </div>
      <div class="fg"${Store.hideSupplierInfo() ? ' style="display:none;"' : ''}><label>Réf. fournisseur (optionnel)</label><input id="m_ref" value="${U.esc(m.ref || '')}" placeholder="ex : BT-16-NOIR"></div>
      <div class="fg"${Store.hideSupplierInfo() ? ' style="display:none;"' : ''}><label>Lien fournisseur (page produit, optionnel)</label><div style="display:flex;gap:6px;align-items:center;"><input id="m_url" value="${U.esc(m.url || '')}" placeholder="https://…" style="flex:1;"><button type="button" class="btn btn-sm" style="white-space:nowrap;" title="Ouvrir dans le navigateur" onclick="var u=document.getElementById('m_url').value.trim();if(u)window.open(u,'_blank','noopener');else U.toast('Aucun lien renseigné.',true);">🔗 Ouvrir</button></div></div>`,
      onOk: () => {
        const snap = id ? Store.snapshot('materials', m) : null;
        const kindSel = U.val('m_kind'), sang = Store.isSangleKind(kindSel), base = U.val('m_product').trim(), picked = this._pickedSize('m_size_sel', 'm_size');
        if (!base) { U.toast('Indique le produit (ex : mousqueton).', true); return false; }
        let product, variant, size = '';
        if (sang) { product = base; variant = picked; if (!variant) { U.toast('Indique la taille (ex : 16mm).', true); return false; } }
        else {
          size = this._matPreset ? this._matPresetSize : picked;
          product = this._matPreset ? base : this.matCompose(base, size);
          variant = U.val('m_variant').trim();
          if (!variant) { U.toast('Indique la variante (ex : Noir).', true); return false; }
        }
        if (Store.state.materials.some(x => x.id !== m.id && (x.product || x.name) === product && U.normSearch(x.variant || x.name).replace(/\s+/g, '') === U.normSearch(variant).replace(/\s+/g, ''))) { U.toast(sang ? 'Cette taille existe déjà dans ce produit.' : 'Cette variante existe déjà dans ce produit.', true); return false; }
        const dupM = this.dupWarnings({ url: U.val('m_url'), ref: U.val('m_ref'), self: { kind: 'T', id: m.id } });
        if (!U.dupGate(dupM, () => document.getElementById('modalOk').click())) return false;
        m.product = product; m.variant = variant; this._applySize(m, size);
        m.name = (product + ' ' + variant).trim();
        m.kind = U.val('m_kind'); m.unit = U.val('m_unit');
        m.sku = U.val('m_sku') || Pricing.autoSkuMat(product || m.name, m.kind, m.variant);
        m.costTotal = U.numVal('m_costTotal'); m.costQtyPer = Math.max(0.01, U.numVal('m_costQty'));
        m.costTax = (document.getElementById('m_tax') || { dataset: {} }).dataset.tax === 'TTC' ? 'TTC' : 'HT';
        const vt = U.val('m_vat').trim(); if (vt === '') delete m.costVat; else m.costVat = U.num(vt);
        m.costUnit = this.matUnitCost(m);
        if (!sang) m.qty = U.numVal('m_qty');   // sangle : le stock = somme des rouleaux (pas de saisie à la main)
        else if (!(m.rolls && m.rolls.length)) m.qty = 0;
        m.low = U.numVal('m_low');
        m.url = U.val('m_url').trim();
        m.ref = U.val('m_ref').trim();
        if (!id) Store.state.materials.push(m);
        const entry = Store.log('stock', (id ? 'Matière modifiée' : 'Matière créée') + ' — ' + m.name,
          id ? { type:'restoreItem', data:snap } : { type:'deleteCreated', data:{ domain:'materials', id:m.id } });
        Store.save('materials'); U.closeModal(); App.rerender();
        U.toast(id?'Modification enregistrée.':'Matière créée.', false, entry.id);
      }
    });
  },
  async delMat(id) {
    const used = Store.state.catalogA.some(a => (a.bom || []).some(l => l.materialId === id));
    if (used) { U.toast('Impossible : cette matière est utilisée dans une fiche accessoire.', true); return; }
    const m = Store.state.materials.find(x => x.id === id); if (!m) return;
    if (!await U.confirm('Supprimer cette matière ?')) return;
    const snap = Store.snapshot('materials', m);
    Store.state.materials = Store.state.materials.filter(x => x.id !== id);
    const entry = Store.commitSnapshot(snap, 'stock', 'Matière supprimée — ' + m.name);
    Store.save('materials'); App.rerender();
    U.toast('Matière supprimée.', false, entry.id);
  },

  /* Modifier un groupe de matières (même produit / couleur) : nom + CATÉGORIE appliquée d'un coup à toutes ses variantes (ex. passer « Hexa Bleu »
     en « Sangle HEXA »). Les références du Calculateur (poids au mètre) de l'ancienne catégorie sont recopiées vers la nouvelle si elle n'en a pas. */
  editMatGroup(key) {
    const items = Store.state.materials.filter(m => (m.product || m.name) === key);
    if (!items.length) return;
    const kinds = Store.materialKinds(), cur = [...new Set(items.map(m => m.kind || 'autre'))], one = cur.length === 1 ? cur[0] : '';
    const sang = Store.isSangleKind(items[0].kind);
    const baseName = sang ? key : this.matBase(items[0]), curSize = sang ? '' : (items[0].allSizes ? '__all' : (items[0].size || ''));
    U.modal({
      title: '✏️ Modifier le produit', okLabel: 'Enregistrer',
      body: `<div class="fg"><label>Nom du produit${sang ? '' : ' (la taille s’ajoute à la fin)'}</label><input id="mg_name" value="${U.esc(baseName)}" autofocus></div>
        ${sang ? '' : `<div class="fg"><label>Taille ${U.info("La taille de sangle de ce produit : elle s'ajoute à la fin du nom et vaut pour toutes ses variantes.")}</label>${this._sizeSelect('mg_size_sel', 'mg_size', curSize, null, true)}</div>`}
        <div class="fg"><label>Catégorie ${U.info("Appliquée à TOUT le produit. Elle sert aux moyennes de coût dans Accessoires, aux références du Calculateur et aux filtres du Stock. Les SKU déjà créés ne changent pas.")}</label><select id="mg_kind">${one ? '' : '<option value="">— catégories mélangées : ne pas changer —</option>'}${kinds.map(k => `<option value="${U.esc(k.value)}" ${k.value === one ? 'selected' : ''}>${U.esc(k.label)}</option>`).join('')}</select></div>`,
      onOk: () => {
        const newName = U.val('mg_name').trim(), newKind = U.val('mg_kind');
        if (!newName) { U.toast('Le nom du produit ne peut pas être vide.', true); return false; }
        const newSize = sang ? '' : this._pickedSize('mg_size_sel', 'mg_size'), newProd = sang ? newName : this.matCompose(newName, newSize);
        const rename = newProd !== key, sizeChanged = !sang && newSize !== curSize, recat = !!newKind && items.some(m => (m.kind || 'autre') !== newKind);
        if (!rename && !recat && !sizeChanged) { U.closeModal(); return; }
        if (rename && Store.state.materials.some(x => (x.product || x.name) === newProd && !items.includes(x))) { U.toast('Un produit « ' + newProd + ' » existe déjà : choisis un autre nom ou une autre taille.', true); return false; }
        const snaps = items.map(m => Store.snapshot('materials', m));
        let copied = 0;
        if (recat) {
          const S = Store.state.settings, sw = S.strapWeights || (S.strapWeights = {});
          items.forEach(m => {
            const w = Calc.matWidth(m); if (!w) return;
            const oldKey = (m.kind || 'autre') + '|' + Calc.strapType(m) + ' ' + w, newKey = newKind + '|' + Calc.strapType({ ...m, kind: newKind }) + ' ' + w;
            if (sw[oldKey] && !sw[newKey]) { sw[newKey] = { ...sw[oldKey] }; copied++; }
          });
        }
        items.forEach(m => {
          m.product = newProd;
          if (!sang) this._applySize(m, newSize);
          m.name = (newProd + ' ' + (m.variant || '')).trim();
          if (recat) m.kind = newKind;
        });
        const lab = (Store.materialKinds().find(k => k.value === newKind) || {}).label || newKind;
        const entry = Store.log('stock', `Produit matière modifié : ${key}${rename ? ' → ' + newProd : ''}${recat ? ' · catégorie « ' + lab + ' »' : ''}`, { type: 'restoreBatch', data: snaps });
        Store.save('materials', 'settings'); U.closeModal(); App.rerender();
        U.toast((recat ? `${items.length} ligne(s) passée(s) en « ${lab} »` + (copied ? ` · ${copied} référence(s) du Calculateur recopiée(s)` : '') : 'Produit modifié') + '.', false, entry.id);
      }
    });
  },

  async delMatGroup(key) {
    const items = Store.state.materials.filter(m => (m.product || m.name) === key);
    if (!items.length) return;
    const usedIds = items.filter(m => Store.state.catalogA.some(a => (a.bom || []).some(l => l.materialId === m.id)));
    if (usedIds.length) { U.toast('Impossible : certaines matières de ce groupe sont utilisées dans des fiches accessoires.', true); return; }
    if (!await U.confirm(`Supprimer le groupe "${key}" et ses ${items.length} matière(s) ?`)) return;
    const snaps = items.map(m => Store.snapshot('materials', m));
    Store.state.materials = Store.state.materials.filter(m => (m.product || m.name) !== key);
    const entry = Store.log('stock', `Groupe de matières supprimé — ${key} (${items.length} matière${items.length > 1 ? 's' : ''})`, { type: 'restoreBatch', data: snaps });
    Store.save('materials'); App.rerender();
    U.toast('Groupe supprimé.', false, entry.id);
  },

  openMatLink(id) {
    const m=Store.state.materials.find(x=>x.id===id); if(!m) return;
    if (Store.hideSupplierInfo()) return;
    if (m.url) window.open(m.url, '_blank', 'noopener');
    else this.editMat(id);
  }
};
