/* ============================================================
   WOOCOMMERCE — pont avec le site touffu-shop.com
   Le SKU est la clé commune entre l'app et WooCommerce.
   L'app calcule prix de vente (public TTC) et stock ; on
   exporte un CSV que l'importateur natif de WooCommerce
   applique aux produits existants (matching par SKU).
   Le coût d'achat reste dans l'app (Woo ne le gère pas).
   ============================================================ */
const Woo = {
  /* Onglets de la page Site (2026-09-28, Antho : page interminable) : export / comparaison site / comparaison SumUp.
     Porté par l'URL (#/woo, #/woo/site, #/woo/sumup) → survit à un F5. */
  tab: 'export',
  /* tab = 'export' (site, exporter) | 'site' (site, comparer) | 'sumupexp' (SumUp, exporter) | 'sumup' (SumUp, comparer) */
  _target() { return this.tab === 'sumup' || this.tab === 'sumupexp' ? 'sumup' : 'site'; },
  _mode() { return this.tab === 'site' || this.tab === 'sumup' ? 'compare' : 'export'; },
  setTarget(t) { this.setTab(t === 'sumup' ? (this._mode() === 'compare' ? 'sumup' : 'sumupexp') : (this._mode() === 'compare' ? 'site' : 'export')); },
  setMode(m) { this.setTab(this._target() === 'sumup' ? (m === 'compare' ? 'sumup' : 'sumupexp') : (m === 'compare' ? 'site' : 'export')); },
  setTab(t) {
    this.tab = t;
    history.replaceState(null, '', '#/woo' + (t === 'export' ? '' : '/' + t));
    this.render(); window.scrollTo(0, 0);
  },
  stockScope: 'both',   // 'general' | 'both' — figé à 'both' : le site regroupe la totalité du stock
  includePrice: true,
  includeStock: true,

  /* Filtres (recherche + type de viande) + sélection par produit — pour n'exporter
     que certains produits (test sur 2-3, ou mise à jour ciblée). Même patron que
     Stock (filtres) et Revente pro (sélection par cases). Clé de sélection = SKU. */
  filters: { q: '', meat: 'all', accCat: 'all', accWidth: 'all', accBic: 'all', sort: 'name', sortDir: 'asc' },
  _sel: {},
  _setSearch(v) { this.filters.q = v; this.render(); U.refocus('woo_q'); },
  _setMeat(v) { this.filters.meat = v; this.render(); },
  setSort(key) {
    if (this.filters.sort === key) this.filters.sortDir = this.filters.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.filters.sort = key; this.filters.sortDir = 'asc'; }
    this.render();
  },
  /* Filtres COMMUNS à Exporter et Comparer (Antho 2026-10-17, même esprit que Stock mastication / Accessoires) : Catégorie (Tous | Mastication | Accessoires, partagée avec SumUp),
     puis selon la catégorie — mastication : type de viande + variantes (format) ; accessoires : catégorie, largeur de sangle, bicolor. Une ligne = { kind:'Mastication'|'Accessoires', meat, accCat, width, bicolor }. */
  _k(l) { return l.kind === 'Accessoires' ? 'A' : 'M'; },
  /* Variante décochée (« utilisée » = case cochée de la ligne dans Prix mastication, enabled !== false). Une variante du Stock est « non utilisée » si la ligne de fiche qui lui est reliée est décochée,
     ou si son SKU n'existe que sur des lignes décochées. */
  _offSkus() {
    const on = new Set(), off = new Set();
    Store.state.catalogM.forEach(c => (c.variants || []).forEach(v => { const k = String(v.sku || '').trim().toUpperCase(); if (k) (v.enabled === false ? off : on).add(k); }));
    on.forEach(k => off.delete(k));
    return off;
  },
  _offStock(p, v) {
    const src = Stock.parentOf(p, v) || v, catId = v.catalogId || src.catalogId || p.catalogId || '';
    const cat = catId ? Store.state.catalogM.find(c => c.id === catId) : null;
    const cv = cat && v.catalogVariantId ? (cat.variants || []).find(x => x.id === v.catalogVariantId) : null;
    return !!cv && cv.enabled === false;
  },
  _unitOff(u) {
    if (u.kind !== 'M') return false;
    const p = Store.state.stockM.find(x => x.id === u.pId), v = p && p.variants.find(x => x.id === u.vId);
    return !!v && (this._offStock(p, v) || this._offSkus().has(String(v.sku || '').trim().toUpperCase()));
  },
  _pass(l) {
    const f = this.filters, k = this._k(l);
    if (!this._inCat(k)) return false;
    if (k === 'A') {
      if (this.cat === 'all') return f.meat === 'all';   // une viande choisie = on ne regarde que la mastication
      if (f.accCat !== 'all' && (l.accCat || '') !== f.accCat) return false;
      if (f.accWidth !== 'all' && (l.width || '') !== f.accWidth) return false;
      if (f.accBic === 'yes' && !l.bicolor) return false;
      if (f.accBic === 'no' && l.bicolor) return false;
      return true;
    }
    if (f.meat !== 'all' && (l.meat || '') !== f.meat) return false;
    // une ligne « site seul » n'a pas de format de l'appli : on lit la fin de son SKU (…-250G) ; un format que l'appli ne connaît pas ne la masque pas
    const fm = l._site ? this._fmtKey(String(l.sku || '').split('-').pop()) : this._fmtOfName(l.name);
    if ((!l._site || (this._siteFmtList || []).includes(fm)) && !this._siteFmtSel().includes(fm)) return false;
    return true;
  },
  /* Options des filtres + remise à « tous » d'un choix qui n'existe plus. */
  _opts(linked) {
    const M = linked.filter(l => this._k(l) === 'M'), A = linked.filter(l => this._k(l) === 'A'), f = this.filters;
    this._siteFmtList = [...new Set(M.map(l => this._fmtOfName(l.name)))];
    const meatCounts = {}; M.forEach(l => { if (l.meat) meatCounts[l.meat] = (meatCounts[l.meat] || 0) + 1; });
    const uniq = a => [...new Set(a.filter(Boolean))].sort(U.sortFr);
    const accCats = uniq(A.map(l => l.accCat)), widths = uniq(A.map(l => l.width));
    if (f.meat !== 'all' && !meatCounts[f.meat]) f.meat = 'all';
    if (f.accCat === undefined || (f.accCat !== 'all' && !accCats.includes(f.accCat))) f.accCat = 'all';
    if (f.accWidth === undefined || (f.accWidth !== 'all' && !widths.includes(f.accWidth))) f.accWidth = 'all';
    if (!['all', 'yes', 'no'].includes(f.accBic)) f.accBic = 'all';
    return {
      meatOpts: [{ v: 'all', l: `Tous (${M.length})` }].concat(Object.keys(meatCounts).sort(U.sortFr).map(m => ({ v: m, l: `${m} (${meatCounts[m]})` }))),
      accOpts: [{ v: 'all', l: `Toutes (${A.length})` }].concat(accCats.map(c => ({ v: c, l: `${c} (${A.filter(l => l.accCat === c).length})` }))),
      widthOpts: [{ v: 'all', l: 'Toutes' }].concat(widths.map(w => ({ v: w, l: `${w} (${A.filter(l => l.width === w).length})` }))),
      bicOpts: [{ v: 'all', l: 'Tous' }, { v: 'yes', l: 'Bicolor' }, { v: 'no', l: 'Non bicolor' }]
    };
  },
  /* Cases de filtre selon la catégorie choisie (HTML des .fg, à poser dans une grille). */
  _ctrls(o) {
    const f = this.filters, fg = (l, h) => `<div class="fg"><label>${l}</label>${h}</div>`;
    if (this.cat === 'A') return [
      fg('Catégorie', U.customSelect({ value: f.accCat, options: o.accOpts, onPick: 'Woo._setAccCat' })),
      fg('Largeur', U.customSelect({ value: f.accWidth, options: o.widthOpts, onPick: 'Woo._setAccW' })),
      fg('Bicolor', U.customSelect({ value: f.accBic, options: o.bicOpts, onPick: 'Woo._setAccBic' }))];
    return [
      fg('Type de viande', U.customSelect({ value: f.meat, options: o.meatOpts, onPick: 'Woo._setMeat' })),
      fg('Variantes (format)', U.multiSelect({ groups: this._fmtGroups(this._siteFmtList || []), selected: this._siteFmtSel(), toggle: 'Woo._siteFmtToggle', setAll: 'Woo._siteFmtAll', open: f.fmtOpen, onOpen: 'Woo._siteFmtOpen' }))];
  },
  _setAccCat(v) { this.filters.accCat = v; this.render(); },
  _setAccW(v) { this.filters.accWidth = v; this.render(); },
  _setAccBic(v) { this.filters.accBic = v; this.render(); },
  _visible(linked) {
    const q = (this.filters.q || '').toLowerCase().trim();
    return linked.filter(l => this._pass(l) && (!q || U.has((l.name || '') + ' ' + (l.sku || ''), q)));
  },
  _selCount(linked) { return linked.filter(l => this._sel[l.sku]).length; },
  toggleSel(sku, checked) { this._sel[sku] = !!checked; this._syncBoxes(); this._refreshSelInfo(); },
  /* Aperçu de l'export regroupé par PRODUIT (Antho 2026-10-17) : une case par produit coche/décoche tous ses formats, chaque format garde sa case.
     Clé de groupe = nom avant « — ». La case produit est « partielle » quand seuls certains formats sont cochés (mise à jour par _syncBoxes, sans re-rendu). */
  /* Accessoire = famille « type + largeur » comme dans Stock → Accessoires (« Longe 20mm », « poignée 10mm — Personnalisation UV ») ; ses lignes = longueurs / tailles (Antho 2026-11-07) */
  _grpKey(l) { return l.kind === 'Accessoires' && l.gid ? 'g' + l.gid : U.normSearch(String(l.name || '').split(' — ')[0]).trim(); },
  _grpTitle(l) { return l.kind === 'Accessoires' && l.gname ? l.gname : String(l.name || '').split(' — ')[0]; },
  _grpLabel(l) { if (l.kind === 'Accessoires' && l.gid && l.vlabel) return l.vlabel; const p = String(l.name || '').split(' — '); return p.length > 1 ? p.slice(1).join(' — ') : l.name; },
  _grpOrder(a, b) { return U.sortFr(this._grpTitle(a), this._grpTitle(b)) || (a.kind === 'Accessoires' && b.kind === 'Accessoires' ? ((a.srank - b.srank) || (a.len - b.len) || (a.perso - b.perso)) : 0) || U.sortFr(a.name, b.name); },
  _grpClosed: new Set(),
  toggleGroup(k, on) {
    this._visible(this.lines().filter(l => l.sku)).filter(l => this._grpKey(l) === k && !this._isExcluded(l.sku)).forEach(l => { this._sel[l.sku] = !!on; });
    this._syncBoxes(); this._refreshSelInfo();
  },
  /* 🚫 sur la ligne produit : exclut (ou ré-inclut) TOUS les formats d'un coup — comme le 🚫 d'une ligne, mémorisé dans les réglages */
  toggleExcludeGroup(k) {
    const members = this._visible(this.lines().filter(l => l.sku)).filter(l => this._grpKey(l) === k);
    if (!members.length) return;
    const s = Store.state.settings; if (!s.wooExclude) s.wooExclude = [];
    const allOut = members.every(l => this._isExcluded(l.sku));
    members.forEach(l => {
      const i = s.wooExclude.indexOf(l.sku);
      if (allOut) { if (i >= 0) s.wooExclude.splice(i, 1); } else if (i < 0) s.wooExclude.push(l.sku);
    });
    Store.save('settings');
    this.render();
    U.toast(allOut ? `${members.length} format(s) de nouveau envoyés au site.` : `${members.length} format(s) exclus du site (ils ne seront plus jamais exportés).`);
  },
  toggleGrpFold(k) { if (this._grpClosed.has(k)) this._grpClosed.delete(k); else this._grpClosed.add(k); this.render(); },
  _syncBoxes() {
    const rows = [...document.querySelectorAll('input.rsel')];
    rows.forEach(b => { b.checked = !!this._sel[b.dataset.sku]; });
    document.querySelectorAll('input[data-gbox]').forEach(h => {
      const mine = rows.filter(b => b.dataset.grp === h.dataset.gbox && !b.disabled), n = mine.filter(b => b.checked).length;
      h.disabled = !mine.length; h.checked = mine.length > 0 && n === mine.length; h.indeterminate = n > 0 && n < mine.length;
    });
  },
  _previewRows(visible) {
    const map = new Map(), groups = [];
    visible.slice(0, 200).forEach(l => { const k = this._grpKey(l); let g = map.get(k); if (!g) { map.set(k, g = { k, rows: [] }); groups.push(g); } g.rows.push(l); });
    const row = (l, k, multi) => {
      const excl = this._isExcluded(l.sku), skuJs = String(l.sku).replace(/'/g, "\\'"), parts = String(l.name || '').split(' — ');
      const fam = l.kind === 'Accessoires' && l.gid && l.gname;
      const label = fam ? (multi ? U.esc(l.vlabel || '—') : U.esc(l.gname + (l.vlabel ? ' — ' + l.vlabel : ''))) : multi && parts.length > 1 ? U.esc(this._grpLabel(l)) : U.esc(l.name);
      return `<tr${excl ? ' style="opacity:.45;"' : ''} data-grp="${U.esc(k)}"${multi && this._grpClosed.has(k) ? ' hidden' : ''}>
            <td><input type="checkbox" class="rsel" data-sku="${U.esc(l.sku)}" data-grp="${U.esc(k)}" ${excl ? 'disabled' : (this._sel[l.sku] ? 'checked' : '')} onchange="Woo.toggleSel('${skuJs}',this.checked)"></td>
            <td><span class="tag">${U.esc(l.sku)}</span></td>
            <td class="col-name"${multi ? ' data-fmt="1"' : ''}>${label}${excl ? ' <span class="badge">exclu</span>' : ''}</td>
            <td>${l.meat || l.accCat ? `<span class="badge info">${U.esc(l.meat || l.accCat)}</span>` : '—'}</td>
            <td class="num">${this.includePrice ? U.eur(l.price) : '—'}</td>
            <td class="num">${this.includeStock ? (l.stock === null ? '<span class="muted">pas de stock lié</span>' : U.qty(l.stock)) : '—'}</td>
            <td>${excl ? `<button class="btn-ghost btn-sm" onclick="Woo.toggleExclude('${skuJs}')">↩ Inclure</button>` : `<button class="btn-icon" title="Exclure ce produit du site (ne jamais l'envoyer)" onclick="Woo.toggleExclude('${skuJs}')">🚫</button>`}</td></tr>`;
    };
    return groups.map(g => {
      if (g.rows.length < 2) return row(g.rows[0], g.k, false);
      const closed = this._grpClosed.has(g.k);
      return `<tr class="wgrp"><td><input type="checkbox" data-gbox="${U.esc(g.k)}" title="Cocher tous les formats de ce produit" onchange="Woo.toggleGroup(this.dataset.gbox,this.checked)"></td>
            <td colspan="5" style="cursor:pointer;" data-gk="${U.esc(g.k)}" onclick="Woo.toggleGrpFold(this.dataset.gk)">${closed ? '▸' : '▾'} <b>${U.esc(this._grpTitle(g.rows[0]))}</b> <span class="muted">· ${g.rows.length} ${g.rows[0].kind === 'Accessoires' && g.rows[0].gid ? (g.rows[0].sized ? 'tailles' : 'longueurs') : 'formats'}</span></td>
            <td>${g.rows.every(l => this._isExcluded(l.sku)) ? `<button class="btn-ghost btn-sm" data-gk="${U.esc(g.k)}" onclick="Woo.toggleExcludeGroup(this.dataset.gk)">↩ Inclure</button>` : `<button class="btn-icon" title="Exclure tous les formats de ce produit du site (ne jamais les envoyer)" data-gk="${U.esc(g.k)}" onclick="Woo.toggleExcludeGroup(this.dataset.gk)">🚫</button>`}</td></tr>` + g.rows.map(l => row(l, g.k, true)).join('');
    }).join('');
  },
  selectAllVisible(checked) {
    this._visible(this.lines().filter(l => l.sku)).forEach(l => { if (!this._isExcluded(l.sku)) this._sel[l.sku] = !!checked; });
    this.render();
  },
  clearSel() { this._sel = {}; this.render(); },

  /* ───── Exclusion PERSISTANTE du site (produits événement-only, tests…) ─────
     Un SKU exclu n'est JAMAIS envoyé au site (ni en « tout », ni via une sélection),
     ce qui évite de créer des doublons / produits non désirés. Stocké dans les réglages. */
  _isExcluded(sku) { return (Store.state.settings.wooExclude || []).includes(sku); },
  toggleExclude(sku) {
    const s = Store.state.settings;
    if (!s.wooExclude) s.wooExclude = [];
    const i = s.wooExclude.indexOf(sku);
    if (i >= 0) s.wooExclude.splice(i, 1); else s.wooExclude.push(sku);
    Store.save('settings');
    this.render();
  },

  /* ───── Comparaison INVERSE : import de l'export du site → rapport (lecture seule) ─────
     Compare, par SKU, les prix et stocks de l'appli avec ceux du site, et repère les
     produits présents d'un seul côté. Ne modifie AUCUNE donnée. */
  _cmp: null,
  _parseCSV(s) {
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    const rows = []; let row = [], field = '', i = 0, inQ = false;
    while (i < s.length) {
      const c = s[i];
      if (inQ) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  },
  _cmpCol(head, names) { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; },
  /* Export du site gardé en cache (localStorage, comme la référence SumUp) : il survit à F5 / changement de page, et la comparaison est RECALCULÉE à chaque affichage
     avec les données actuelles de l'appli (Antho 2026-10-17 : après avoir corrigé un SKU, plus besoin de redéposer le fichier). Redéposer = rafraîchir la référence. */
  _siteRef: null, _siteCacheChecked: false,
  _restoreSiteCache() {
    if (this._siteRef || this._siteCacheChecked) return;
    this._siteCacheChecked = true;
    try { const j = JSON.parse(localStorage.getItem('touffu_siteRef') || 'null'); if (j && Array.isArray(j.items)) this._siteRef = j; } catch (e) {}
  },
  _buildCmp() {
    const ref = this._siteRef; if (!ref) return null;
    const site = new Map(ref.items.map(s => [s.sku, s]));
    const app = new Map();
    this.lines().filter(l => l.sku).forEach(l => app.set(l.sku, l));
    // SKU EN DOUBLE sur le site (Antho 2026-10-18) : une seule fiche garde la correspondance (nom le plus ressemblant, sans ambiguïté) ; sans fiche nettement plus proche, aucune n'est retenue
    // (le produit de l'appli passe en « absent du site » + alerte) plutôt que de mettre à jour la mauvaise fiche au hasard. Les autres fiches sortent en « site seul » + « SKU en double ».
    const dupInfo = new Map();
    (ref.dupGroups || []).forEach(g => {
      const l = app.get(g[0].sku); let best = null;
      if (l) { const sc = g.map(x => [this._slScore(l.name, x.name), x]).sort((a, b) => b[0] - a[0]); if (sc[0][0] > sc[1][0]) best = sc[0][1]; }
      if (best) site.set(best.sku, best); else if (l) site.delete(g[0].sku);
      dupInfo.set(g[0].sku, g);
    });
    const matched = [], appOnly = [], siteOnly = [];
    const meta = l => ({ kind: l.kind, meat: l.meat, accCat: l.accCat, width: l.width, bicolor: l.bicolor, gid: l.gid, gname: l.gname, vlabel: l.vlabel, sized: l.sized, srank: l.srank, len: l.len, perso: l.perso });
    // Liaisons manuelles (Antho 2026-10-17) : produit de l'appli ↔ fiche du site (par ID) dont l'UGS est différent ou vide ; l'appli est prioritaire → l'UGS du site sera corrigé par le CSV « Corriger les UGS du site »
    const links = (Store.state.settings.wooLinks) || {}, byId = new Map(), claimed = new Map(), key = x => (ref.v === 2 ? String(x.id) : x.sku);
    if (ref.v === 2) { ref.items.forEach(s => byId.set(String(s.id), s)); (ref.noSku || []).forEach(s => byId.set(String(s.id), s)); }
    // La liaison faite à la main l'EMPORTE sur la correspondance par UGS (ex. l'UGS d'une autre fiche a été collé par erreur sur le site) : la fiche reliée est « réservée » à ce produit.
    app.forEach((l, sku) => { const t = links[sku] != null ? byId.get(String(links[sku])) : null; if (t && !claimed.has(String(t.id))) claimed.set(String(t.id), sku); });
    const matchedKeys = new Set();
    app.forEach((l, sku) => {
      let s = null, link = null;
      const lt = links[sku] != null ? byId.get(String(links[sku])) : null;
      if (lt && claimed.get(String(lt.id)) === sku) { s = lt; if (lt.sku !== sku) link = { id: String(lt.id), type: lt.type, parent: lt.parent, siteSku: lt.sku || '' }; }
      else { const d = site.get(sku); if (d && !(ref.v === 2 && claimed.has(String(d.id)))) s = d; }
      if (!s) { appOnly.push({ sku, name: l.name, ...meta(l) }); return; }
      matchedKeys.add(key(s));
      const priceDiff = (l.price != null && s.price != null) ? +(l.price - s.price).toFixed(2) : null;
      const stockDiff = (l.stock != null && s.stock != null) ? (l.stock - s.stock) : null;
      matched.push({ sku, name: l.name, appPrice: l.price, sitePrice: s.price, priceDiff, appStock: l.stock, siteStock: s.stock, stockDiff, link, sid: ref.v === 2 ? { id: String(s.id), type: s.type, parent: s.parent } : null, ...meta(l) });
    });
    site.forEach((s, sku) => { if (!matchedKeys.has(key(s))) siteOnly.push({ sku, name: s.name, kind: s.kind, meat: s.meat, _site: true }); });
    const idKey = x => String(x.id || x.name), othersOf = (g, id) => g.filter(x => idKey(x) !== id).map(x => x.name + (x.id ? ' (#' + x.id + ')' : ''));
    dupInfo.forEach((g, sku) => {
      const m = matched.find(x => x.sku === sku), keptId = m && m.sid ? String(m.sid.id) : null;
      if (m) m.dup = { n: g.length, others: othersOf(g, keptId) };
      const a = appOnly.find(x => x.sku === sku); if (a) a.dup = { n: g.length, others: g.map(x => x.name + (x.id ? ' (#' + x.id + ')' : '')) };
      for (let i = siteOnly.length - 1; i >= 0; i--) if (siteOnly[i].sku === sku) siteOnly.splice(i, 1);
      g.filter(x => idKey(x) !== keptId).forEach(x => siteOnly.push({ sku, name: x.name, kind: x.kind, meat: x.meat, _site: true, dup: { n: g.length, others: othersOf(g, idKey(x)) } }));
    });
    const dups = [...dupInfo.values()].map(g => ({ sku: g[0].sku, labels: g.map(x => x.name + (x.id ? ' (#' + x.id + ')' : '')) }));
    return { siteRows: site.size, siteNoSku: ref.siteNoSku, matched, appOnly, siteOnly, dups, appDups: this._appDups() };
  },
  /* Fichier choisi = lu TOUT DE SUITE (onchange du champ, Antho 2026-10-17 : il fallait recharger la page pour que le 2e choix soit pris en compte). Le champ est vidé
     dès la lecture (rechoisir le même nom de fichier redéclenche l'événement) ; une lecture impossible (fichier déplacé / modifié depuis le choix) est signalée. */
  _readPicked(inp, fallbackId, askMsg, onText) {
    const file = (inp && inp.files && inp.files[0]) || document.getElementById(fallbackId)?.files[0];
    if (!file) { U.toast(askMsg, true); return; }
    const reader = new FileReader();
    reader.onerror = () => { if (inp) inp.value = ''; U.toast('Impossible de lire « ' + file.name + ' » (déplacé ou modifié depuis le choix ?) : choisis-le à nouveau.', true); };
    reader.onload = () => { if (inp) inp.value = ''; onText(reader.result, file); };
    reader.readAsText(file);
  },
  compareSite(inp) {
    this._readPicked(inp, 'woo_cmp_file', 'Choisis d\'abord le fichier CSV exporté depuis ton site.', (text, file) => {
      let rows; try { rows = this._parseCSV(text); } catch (e) { U.toast('CSV illisible : ' + e.message, true); return; }
      if (!rows.length) { U.toast('Fichier vide.', true); return; }
      const head = rows[0];
      const iSku = this._cmpCol(head, ['UGS', 'SKU', 'sku']);
      const iName = this._cmpCol(head, ['Nom', 'Name', 'name']);
      const iPrice = this._cmpCol(head, ['Tarif régulier', 'Regular price', 'regular_price']);
      const iStock = this._cmpCol(head, ['Stock', 'stock']);
      if (iSku < 0) { U.toast('Colonne UGS/SKU introuvable dans ce fichier.', true); return; }
      const num = (v) => { const n = parseFloat(String(v || '').replace(',', '.').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : null; };
      // Catégories du site (colonne « Catégories », celles d'une variation = celles de son produit parent « id:N ») → rangent les lignes « site seul » en mastication / accessoires + viande.
      const iCat = this._cmpCol(head, ['Catégories', 'Categories']), iId = this._cmpCol(head, ['ID', 'Id']), iPar = this._cmpCol(head, ['Parent']);
      const catById = new Map();
      if (iCat >= 0 && iId >= 0) rows.slice(1).forEach(r => { if (r[iId] && r[iCat]) catById.set(String(r[iId]).trim(), r[iCat]); });
      const siteKind = r => {
        let c = iCat >= 0 ? (r[iCat] || '') : '';
        if (!c && iPar >= 0) c = catById.get(String(r[iPar] || '').replace(/^id:/i, '').trim()) || '';
        const m = c.split(', ').find(x => /Type de viande > /.test(x));
        return { kind: /accessoires/i.test(c) ? 'Accessoires' : 'Mastication', meat: m ? m.split(' > ').pop().trim() : '' };
      };
      // ID / Type / Parent : nécessaires pour RELIER une fiche du site à un produit de l'appli (liaison par ID, sans doublon)
      const iType = this._cmpCol(head, ['Type']);
      const idOf = r => ({ id: iId >= 0 ? String(r[iId] || '').trim() : '', type: iType >= 0 ? String(r[iType] || '').trim() : '', parent: iPar >= 0 ? String(r[iPar] || '').trim() : '' });
      const site = new Map(), noSku = [], all = new Map(); let siteNoSku = 0;
      rows.slice(1).filter(r => r.length > 1).forEach(r => {
        const sku = (r[iSku] || '').trim();
        const base = { name: iName >= 0 ? r[iName] : '', price: iPrice >= 0 ? num(r[iPrice]) : null, stock: iStock >= 0 ? num(r[iStock]) : null, ...idOf(r), ...siteKind(r) };
        if (!sku) { siteNoSku++; if (base.id && (base.type === 'variation' || base.type === 'simple')) noSku.push({ sku: '', ...base }); return; }
        site.set(sku, { sku, ...base });
        if (!all.has(sku)) all.set(sku, []);
        all.get(sku).push({ sku, ...base });
      });
      // SKU (UGS) présents sur plusieurs fiches du site : gardés pour l'alerte « SKU en double » (la comparaison, elle, ne retient qu'une fiche par UGS)
      const dupGroups = [...all.values()].filter(g => g.length > 1);
      this._siteRef = { v: 2, file: file.name, ts: Date.now(), siteNoSku, items: [...site.values()], noSku, dupGroups };
      this._pruneLinks();
      try { localStorage.setItem('touffu_siteRef', JSON.stringify(this._siteRef)); } catch (e) { U.toast('Export du site trop gros pour la mémoire du navigateur : il faudra le redéposer après un rechargement.', true); }
      this._cmp = this._buildCmp();
      this.render();
      const c = this._cmp;
      U.toast(`Comparaison : ${c.matched.length} reliés, ${c.appOnly.length} appli seule, ${c.siteOnly.length} site seul.`);
    });
  },
  /* ───── Liaison manuelle produit de l'appli ↔ fiche du site (Antho 2026-10-17) ─────
     Pour un produit « absent du site » (UGS différent ou jamais rempli sur le site) : on choisit la fiche du site, l'appli retient son ID. L'appli est PRIORITAIRE :
     l'export normal (onglet Exporter) envoie alors ces produits avec l'ID de la fiche (colonnes ID / Type / UGS / Parent comme l'export natif du site + prix + stock) →
     UN SEUL import met à jour UGS, prix et stock, sans doublon. */
  _pruneLinks() {
    const L = Store.state.settings.wooLinks, ref = this._siteRef;
    if (!L || !ref || ref.v !== 2) return;
    const ids = new Set(ref.items.concat(ref.noSku || []).map(s => String(s.id))), bySku = new Map(ref.items.map(s => [s.sku, s]));
    let ch = false;
    Object.keys(L).forEach(k => { const d = bySku.get(k); if ((d && String(d.id) === String(L[k])) || !ids.has(String(L[k]))) { delete L[k]; ch = true; } });   // la fiche reliée porte désormais le bon UGS, ou elle a disparu
    if (ch) Store.save('settings');
  },
  /* sku → { id, type, parent } de la fiche du site : UGS identique (export du site) ou fiche reliée à la main. Sert à l'export « avec ID ». */
  _idMap() {
    const c = this._siteRef ? this._buildCmp() : null, m = new Map();
    if (c) c.matched.forEach(x => { if (x.sid) m.set(x.sku, x.sid); });
    return m;
  },
  _pendingSkus() {
    this._restoreSiteCache();
    const c = this._siteRef ? this._buildCmp() : null;
    return new Set(c ? c.matched.filter(m => m.link).map(m => m.sku) : []);
  },
  _tok(s) { return U.normSearch(s || '').split(/[^a-z0-9]+/).filter(x => x.length > 1).map(x => x.length > 3 ? x.replace(/[sx]$/, '') : x); },
  _linkCandidates() {
    const ref = this._siteRef; if (!ref || ref.v !== 2) return null;
    const appBySku = new Map(this.lines().filter(l => l.sku).map(l => [l.sku, l]));
    const used = new Set(Object.values(Store.state.settings.wooLinks || {}).map(String));
    const pool = new Map(); ref.items.concat(ref.noSku || [], ...(ref.dupGroups || [])).forEach(s => { if (s.id && !pool.has(String(s.id))) pool.set(String(s.id), s); });
    return [...pool.values()].filter(s => s.type !== 'variable' && !used.has(String(s.id)))
      .map(s => { const t = s.sku ? appBySku.get(s.sku) : null; return t ? { ...s, _taken: t } : s; });   // _taken : l'UGS de cette fiche est déjà celui d'un produit de l'appli
  },
  openLink(sku) {
    const l = this.lines().find(x => x.sku === sku); if (!l) return;
    const c = this._linkCandidates();
    if (!c) {
      U.toast('Choisis à nouveau le fichier d\'export de ton site (bouton « Choisir un fichier », en haut de la comparaison) : une seule fois, pour activer la liaison.', true);
      document.getElementById('woo_cmp_file')?.scrollIntoView({ block: 'center' });
      return;
    }
    const want = new Set(this._tok(l.name));
    this._lkSku = sku;
    const cover = (A, name) => { const t = new Set(this._tok(name)); let n = 0; A.forEach(x => { if (t.has(x)) n++; }); const u = A.size + t.size - n; return u ? n / u : 0; };   // ressemblance (intersection / union) : « Oreille de porc » ressemble plus à « Oreilles de porc » qu'à « Pavillons d'oreilles de porc »
    this._lkAll = c.map(s => ({ ...s, _score: cover(want, s.name), _own: s._taken ? cover(new Set(this._tok(s._taken.name)), s.name) : 0 }))
      .sort((a, b) => b._score - a._score || U.sortFr(a.name || '', b.name || ''));
    U.modal({
      title: '🔗 Relier à une fiche du site', wide: true, hideOk: true,
      body: `<p class="muted" style="margin-top:0;">Choisis la fiche du site qui correspond à <b>${U.esc(l.name)}</b>. Son UGS sera remplacé par celui de l'appli : <span class="sku-txt">${U.esc(sku)}</span>. <b>Les autres formats du même produit se relient tout seuls</b> quand leur nom est identique (100G ↔ 100g).</p>
        <input id="woo_lk_q" style="width:100%;" placeholder="Rechercher une fiche du site…" oninput="Woo._lkRender()">
        <div id="woo_lk_list" style="max-height:52vh;overflow:auto;margin-top:8px;"></div>`
    });
    this._lkRender();
    setTimeout(() => document.getElementById('woo_lk_q')?.focus(), 50);
  },
  _lkRender() {
    const box = document.getElementById('woo_lk_list'); if (!box) return;
    const q = (document.getElementById('woo_lk_q')?.value || '').trim();
    // Suggestions : fiches libres de nom proche + fiches dont l'UGS appartient déjà à un AUTRE produit alors que le nom ne lui ressemble pas (UGS collé par erreur sur le site)
    const pool = q ? this._lkAll.filter(s => U.has((s.name || '') + ' ' + (s.sku || ''), q)) : this._lkAll.filter(s => s._taken ? (s._score >= 0.75 && s._score > s._own + 0.05) : s._score > 0);
    this._lkShown = pool.slice(0, q ? 40 : 12);
    box.innerHTML = (q ? '' : '<div class="muted" style="font-size:.8rem;margin-bottom:6px;">Suggestions (noms proches) — tape un mot pour chercher ailleurs.</div>')
      + (this._lkShown.map((s, i) => `<button type="button" class="btn-ghost" style="display:block;width:100%;text-align:left;margin-bottom:6px;" onclick="Woo.doLink(${i})"><b>${U.esc(s.name || '—')}</b><div class="sub" style="font-size:.8rem;">#${U.esc(s.id)} · UGS sur le site : ${s.sku ? `<span class="sku-txt">${U.esc(s.sku)}</span>` : '<i>aucun</i>'}${s.price != null ? ' · ' + U.eur(s.price) : ''}${s._taken ? `<br>⚠️ cet UGS est déjà celui de « ${U.esc(s._taken.name)} » dans l'appli : ce produit repassera en « absent du site »` : ''}</div></button>`).join('')
      || '<p class="muted">Aucune fiche trouvée. Les fiches déjà reliées ne sont pas proposées.</p>');
  },
  doLink(i) {
    const s = (this._lkShown || [])[i]; if (!s || !this._lkSku) return;
    const st = Store.state.settings; if (!st.wooLinks) st.wooLinks = {};
    st.wooLinks[this._lkSku] = String(s.id);
    // Les autres formats du MÊME produit (même nom avant « — », même fiche parente sur le site) sont reliés d'un coup quand le nom du format est identique (100G ↔ 100g…)
    const app = this.lines().find(x => x.sku === this._lkSku), pre = n => String(n || '').split(' — ')[0], norm = v => U.normSearch(v || '').replace(/[^a-z0-9]/g, '');
    const taken = new Set([String(s.id)].concat(Object.values(st.wooLinks).map(String))); let extra = 0;
    if (s.parent && app && this._cmp) this._cmp.appOnly.filter(a => a.sku !== this._lkSku && pre(a.name) === pre(app.name)).forEach(a => {
      const f = String(a.name || '').split(' — ').slice(1).join(' — '); if (!norm(f)) return;
      const t = this._lkAll.find(x => x.parent === s.parent && !x._taken && !taken.has(String(x.id)) && this._fmtSame(f, String(x.name || '').split(' - ').pop()));
      if (t) { st.wooLinks[a.sku] = String(t.id); taken.add(String(t.id)); extra++; }
    });
    Store.save('settings');
    U.closeModal();
    this.render();
    U.toast(`Relié à « ${s.name} » (#${s.id})${extra ? ` + ${extra} autre(s) format(s) du même produit` : ''}. Coche-le dans « Exporter » : le fichier mettra aussi l'UGS de l'appli sur la fiche.`);
  },
  unlink(sku) {
    const L = Store.state.settings.wooLinks; if (!L || !(sku in L)) return;
    delete L[sku]; Store.save('settings'); this.render(); U.toast('Liaison retirée.');
  },
  clearCompare() { this._cmp = null; this._siteRef = null; try { localStorage.removeItem('touffu_siteRef'); } catch (e) {} this.render(); },
  cmpFilter: 'issues', cmpQ: '', cmpSort: 'name', cmpSortDir: 'asc',
  _setCmpFilter(v) { this.cmpFilter = v; this.render(); },
  _setCmpQ(v) { this.cmpQ = v; this.render(); U.refocus('woo_cmp_q'); },
  _setCmpSort(k) {
    if (this.cmpSort === k) this.cmpSortDir = this.cmpSortDir === 'asc' ? 'desc' : 'asc';
    else { this.cmpSort = k; this.cmpSortDir = 'asc'; }
    this.render();
  },

  /* ───── Comparaison avec SumUp (2026-09-28, demande d'Antho) ─────
     Fichier = export de la bibliothèque d'articles SumUp (« items-export » : Item name, Variations,
     Price, Track inventory?, Quantity, SKU…). Une ligne « article » (Item name rempli) sans prix est
     un parent ; ses variantes suivent (Item name vide). Un article avec prix et sans variante = article
     simple. Comparaison PAR SKU (jamais par nom) avec le stock mastication + les accessoires de l'appli :
     prix TTC et quantité (stock choisi : événement / général / total). LECTURE SEULE. */
  _sumup: null,
  _sumupCacheChecked: false,
  /* Fichier de référence SumUp gardé en cache (localStorage, navigateur courant) pour ne plus avoir
     à le redéposer à chaque visite (2026-09-30, Antho : « ça ne doit pas attendre le fichier
     d'analyse à chaque fois »). Un fichier n'est à redéposer que pour rafraîchir la référence
     (nouvel article créé dans SumUp…). */
  _restoreSumupCache() {
    if (this._sumup || this._sumupCacheChecked) return;
    this._sumupCacheChecked = true;
    try { const raw = localStorage.getItem('touffu_sumupRef'); if (raw) { this._sumup = JSON.parse(raw); this._pruneSumupLinks(); } } catch (e) {}
  },
  /* Exclusion PERSISTANTE d'un article des exports SumUp (ex: sachets 500g+ jamais emmenés sur les
     marchés) — même patron que _isExcluded/toggleExclude pour le site, réglage séparé
     (Store.state.settings.sumupExclude) puisque « exclu du site » et « exclu de SumUp » sont deux
     choses différentes (un produit peut être vendu en ligne mais pas emmené en événement, ou l'inverse). */
  _isSumupExcluded(sku) { return (Store.state.settings.sumupExclude || []).includes(String(sku || '').toUpperCase()); },
  toggleSumupExclude(sku) {
    const s = Store.state.settings; if (!s.sumupExclude) s.sumupExclude = [];
    const k = String(sku).toUpperCase();
    const i = s.sumupExclude.indexOf(k);
    if (i >= 0) s.sumupExclude.splice(i, 1); else s.sumupExclude.push(k);
    Store.save('settings'); this.render();
  },
  // La quantité SumUp = le stock ÉVÉNEMENT d'Antho (confirmé 2026-09-28) → comparée uniquement à celui-là.
  sumupFilter: 'issues', sumupQ: '', sumupSort: 'name', sumupSortDir: 'asc', sumupMeat: 'all', sumupFmt: 'all',
  /* Filtres de la carte d'export SumUp (simple aperçu, même patron que le tableau d'export site). */
  sumupExpFilters: { q: '', meat: 'all', sort: 'name', sortDir: 'asc' },
  setSumupExpSort(key) {   // en-têtes cliquables de l'export SumUp (même patron que Stock : clic = trie, re-clic = inverse)
    const f = this.sumupExpFilters;
    if (f.sort === key) f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc';
    else { f.sort = key; f.sortDir = 'asc'; }
    this.render();
  },
  _setSumupExpQ(v) { this.sumupExpFilters.q = v; this.render(); U.refocus('sumup_exp_q'); },
  _setSumupExpMeat(v) { this.sumupExpFilters.meat = v || 'all'; this.render(); },
  sumupExpSelectAll(on) { (this._sumupExpVisible || []).forEach(k => { this._sumupSel[k] = !!on; }); this.render(); },
  _setSumupMeat(v) { this.sumupMeat = v; this.render(); },
  _setSumupFmt(v) { this.sumupFmt = v; this.render(); },
  /* Format d'une ligne (poids / taille / lot) : variante SumUp normalisée (« 100g » → « 100G »). */
  _fmtKey(v) { return String(v || '').toUpperCase().replace(/\s+/g, '') || '—'; },
  /* Ordre naturel des formats : poids croissants, puis tailles XS→XXL, puis le reste A→Z. */
  _fmtRank(f) {
    const g = f.match(/^(\d+(?:[.,]\d+)?)(G|KG)$/);
    if (g) return [0, parseFloat(g[1].replace(',', '.')) * (g[2] === 'KG' ? 1000 : 1), ''];
    const sizes = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
    const i = sizes.indexOf(f);
    if (i >= 0) return [1, i, ''];
    return [2, 0, f];
  },
  /* Groupes de formats (même esprit que le filtre « Variantes » de Stock) */
  _fmtClass(f) {
    if (/^\d+(?:[.,]\d+)?(G|KG)$/.test(f)) return 'Poids';
    if (/^(XXS|XS|S|M|L|XL|XXL|XXXL)$/.test(f)) return 'Tailles';
    if (/LOT|PC|PIECE|^\d+$/.test(f)) return 'Pièces / lots';
    return 'Autres';
  },
  _isBigFmt(f) { const r = Woo._fmtRank(f); return r[0] === 0 && r[1] >= 500; },
  _fmtGroups(list) {
    return ['Poids', 'Pièces / lots', 'Tailles', 'Autres']
      .map(label => ({ label, items: list.filter(x => this._fmtClass(x) === label).sort((a, b) => this._fmtCmp(a, b)) }))
      .filter(g => g.items.length);
  },
  _fmtOfName(name) { const i = String(name || '').lastIndexOf(' — '); return i < 0 ? '—' : this._fmtKey(name.slice(i + 3)); },
  // Export SumUp : par défaut les 500 g et plus sont décochés (fmts === null), le reste coché.
  _sumupFmtSel() { const f = this.sumupExpFilters, list = this._sumupFmtList || []; return (f.fmts || list).filter(x => list.includes(x)); },
  _sumupFmtToggle(v) { const f = this.sumupExpFilters; const cur = this._sumupFmtSel(); f.fmts = cur.includes(v) ? cur.filter(x => x !== v) : cur.concat(v); this.render(); },
  _sumupFmtAll(all) { this.sumupExpFilters.fmts = all ? [...(this._sumupFmtList || [])] : []; this.render(); },
  sumupExpSelectNoBig() { (this._sumupExpVisible || []).forEach(k => { const m = (this._sumupExpMap || {})[k]; this._sumupSel[k] = !(m && this._isBigFmt(m.fmt)); }); this.render(); },
  _sumupFmtOpen(o) { this.sumupExpFilters.fmtOpen = o; },
  _siteFmtSel() { const list = this._siteFmtList || []; return (this.filters.fmts || list).filter(x => list.includes(x)); },
  _siteFmtToggle(v) { const cur = this._siteFmtSel(); this.filters.fmts = cur.includes(v) ? cur.filter(x => x !== v) : cur.concat(v); this.render(); },
  _siteFmtAll(all) { this.filters.fmts = all ? [...(this._siteFmtList || [])] : []; this.render(); },
  _siteFmtOpen(o) { this.filters.fmtOpen = o; },
  /* Tri par nom d'un produit à formats (« Produit — S ») : produit A→Z, puis formats dans l'ordre naturel (100G < 250G < 500G, S < M < L < XL) et non alphabétique (Antho 2026-10-17) */
  _nameCmp(a, b) {
    const sp = n => String(n || '').match(/^(.*) [—–-] (.+)$/);   // « Produit — S » (appli) ou « Produit - S » (export du site)
    const x = sp(a), y = sp(b);
    if (!x || !y) return U.sortFr(String(a || ''), String(b || ''));
    return U.sortFr(x[1], y[1]) || this._fmtCmp(this._fmtKey(x[2]), this._fmtKey(y[2]));
  },
  /* Même FORMAT, écrit différemment (Antho 2026-10-18) : pour un produit vendu à la pièce, SumUp / le site disent « PCS », « LOT2 » là où l'appli dit « 1 pièce », « Lot de 2 pc ». _packN : nombre de pièces
     d'un format « à la pièce » (0 = pas un format à la pièce, on retombe sur la comparaison de texte : 100G ↔ 100g). Sert au rapprochement automatique des formats frères (relier un format relie les autres). */
  _packN(v) {
    const t = U.normSearch(String(v || '')).replace(/\s+/g, ' ').trim();
    if (/^(pcs?|pieces?|unites?|1 ?(pcs?|pieces?|unites?))$/.test(t)) return 1;
    const m = t.match(/^lot ?(?:de )?(\d+)(?: ?(?:pcs?|pieces?))?$/) || t.match(/^(\d+) ?(?:pcs?|pieces?|unites?)$/);
    return m ? +m[1] : 0;
  },
  _fmtSame(a, b) { const x = this._packN(a), y = this._packN(b); return x || y ? x === y : this._fmtKey(a) === this._fmtKey(b); },
  _fmtCmp(a, b) { const x = Woo._fmtRank(a), y = Woo._fmtRank(b); return x[0] - y[0] || x[1] - y[1] || U.sortFr(x[2], y[2]); },
  _setSumupFilter(v) { this.sumupFilter = v; this.render(); },
  _setSumupQ(v) { this.sumupQ = v; this.render(); U.refocus('woo_sumup_q'); },
  _setSumupSort(k) {
    if (this.sumupSort === k) this.sumupSortDir = this.sumupSortDir === 'asc' ? 'desc' : 'asc';
    else { this.sumupSort = k; this.sumupSortDir = 'asc'; }
    this.render();
  },
  clearSumup() { this._sumup = null; this._sumupSel = {}; try { localStorage.removeItem('touffu_sumupRef'); } catch (e) {} this.render(); },

  /* ───── Liaison manuelle article SumUp ↔ produit de l'appli (Antho 2026-10-18) ─────
     Pour une ligne SumUp sans SKU ou au SKU inconnu : on choisit le produit de l'appli, l'appli retient l'identifiant de la ligne SumUp (Variant id, sinon Item id : il ne change pas quand le SKU change).
     L'appli est PRIORITAIRE : le fichier d'import SumUp met alors le SKU de l'appli sur cette ligne (+ prix / quantité si cochés), sans doublon. Même principe que la liaison avec le site. */
  _pruneSumupLinks() {
    const L = Store.state.settings.sumupLinks, ref = this._sumup;
    if (!L || !ref || ref.v !== 2) return;
    const byId = new Map(ref.lines.filter(l => l.id).map(l => [l.id, l])), skus = new Set(Ventes.units().filter(u => u.sku).map(u => u.sku.trim().toUpperCase()));
    let ch = false;
    Object.keys(L).forEach(k => { const l = byId.get(String(L[k])); if (!l || (l.sku || '').toUpperCase() === k.toUpperCase() || !skus.has(k.toUpperCase())) { delete L[k]; ch = true; } });   // la ligne porte désormais le bon SKU, ou elle / le produit a disparu
    if (ch) Store.save('settings');
  },
  _sumupNeedsV2() {
    if (this._sumup && this._sumup.v === 2) return false;
    U.toast('Choisis à nouveau ton export SumUp (bouton « Choisir un fichier », en haut) : une seule fois, pour activer la liaison.', true);
    document.getElementById('woo_sumup_file')?.scrollIntoView({ block: 'center' });
    return true;
  },
  _slScore(a, b) { const A = new Set(this._tok(a)), B = new Set(this._tok(b)); let n = 0; A.forEach(x => { if (B.has(x)) n++; }); const u = A.size + B.size - n; return u ? n / u : 0; },   // ressemblance (intersection / union des mots)
  /* mode 'line' : depuis une ligne SumUp (key = son identifiant) → choisir le produit de l'appli ; mode 'app' : depuis un produit de l'appli (key = son SKU) → choisir la ligne SumUp. */
  openSumupLink(mode, key) {
    if (this._sumupNeedsV2()) return;
    const r = this._sumupReport(), links = Store.state.settings.sumupLinks || {}, linkedSkus = new Set(Object.keys(links).map(k => k.toUpperCase()));
    const unitLabel = u => u.name + (u.label ? ' — ' + u.label : ''), lineLabel = l => l.name + (l.variant ? ' — ' + l.variant : '');
    let src, items, srcTxt;
    if (mode === 'line') {
      src = this._sumup.lines.find(l => l.id === key); if (!src) return;
      const holder = new Map(); this._sumup.lines.forEach(l => { if (l.sku) holder.set(l.sku.toUpperCase(), l); });
      items = Ventes.units().filter(u => u.sku && !this._unitOff(u) && !linkedSkus.has(u.sku.trim().toUpperCase())).map(u => {
        const h = holder.get(u.sku.trim().toUpperCase());
        return { ref: u.sku.trim(), title: unitLabel(u), sku: u.sku.trim(), price: u.price, text: unitLabel(u) + ' ' + u.sku, score: this._slScore(lineLabel(src), unitLabel(u)), taken: h && h.id !== src.id ? h : null };
      });
      items.forEach(s => { s.own = s.taken ? this._slScore(lineLabel(s.taken), s.title) : 0; });
      srcTxt = `<b>${U.esc(lineLabel(src))}</b> (SumUp) — SKU actuel : ${src.sku ? `<span class="sku-txt">${U.esc(src.sku)}</span>` : '<i>aucun</i>'}`;
    } else {
      src = Ventes.units().find(x => x.sku && x.sku.trim() === key); if (!src) return;
      const used = new Set(Object.values(links).map(String));
      items = r.unknown.concat(r.noSku).filter(l => l.id && !used.has(l.id)).map(l => ({ ref: l.id, title: lineLabel(l), sku: l.sku, price: l.price, text: lineLabel(l) + ' ' + (l.sku || ''), score: this._slScore(unitLabel(src), lineLabel(l)), taken: null, own: 0 }));
      srcTxt = `<b>${U.esc(unitLabel(src))}</b> (appli) — SKU : <span class="sku-txt">${U.esc(src.sku)}</span>`;
    }
    this._sl = { mode, src, all: items.sort((a, b) => b.score - a.score || U.sortFr(a.title, b.title)) };
    U.modal({
      title: mode === 'line' ? '🔗 Relier à un produit de l\'appli' : '🔗 Relier à une ligne SumUp', wide: true, hideOk: true,
      body: `<p class="muted" style="margin-top:0;">Choisis ${mode === 'line' ? 'le produit de l\'appli' : 'la ligne SumUp'} qui correspond à ${srcTxt}. Le SKU de l'<b>appli</b> sera mis dans SumUp à l'import. <b>Les autres formats du même produit se relient tout seuls</b> quand leur format est identique (100G ↔ 100g).</p>
        <input id="woo_sl_q" style="width:100%;" placeholder="Rechercher…" oninput="Woo._slRender()">
        <div id="woo_sl_list" style="max-height:52vh;overflow:auto;margin-top:8px;"></div>`
    });
    this._slRender();
    setTimeout(() => document.getElementById('woo_sl_q')?.focus(), 50);
  },
  _slRender() {
    const box = document.getElementById('woo_sl_list'); if (!box || !this._sl) return;
    const q = (document.getElementById('woo_sl_q')?.value || '').trim(), line = this._sl.mode === 'line';
    // Suggestions : noms proches ; un produit dont le SKU est DÉJÀ sur une autre ligne SumUp n'est suggéré que si la ressemblance est nette (SKU collé par erreur sur la mauvaise ligne)
    const pool = q ? this._sl.all.filter(s => U.has(s.text, q)) : this._sl.all.filter(s => s.taken ? (s.score >= 0.75 && s.score > s.own + 0.05) : s.score > 0);
    this._slShown = pool.slice(0, q ? 40 : 12);
    box.innerHTML = (q ? '' : '<div class="muted" style="font-size:.8rem;margin-bottom:6px;">Suggestions (noms proches) — tape un mot pour chercher ailleurs.</div>')
      + (this._slShown.map((s, i) => `<button type="button" class="btn-ghost" style="display:block;width:100%;text-align:left;margin-bottom:6px;" onclick="Woo.doSumupLink(${i})"><b>${U.esc(s.title)}</b><div class="sub" style="font-size:.8rem;">${line ? 'SKU appli' : 'SKU SumUp'} : ${s.sku ? `<span class="sku-txt">${U.esc(s.sku)}</span>` : '<i>aucun</i>'}${s.price != null ? ' · ' + U.eur(s.price) : ''}${s.taken ? `<br>⚠️ ce SKU est déjà sur « ${U.esc(s.taken.name + (s.taken.variant ? ' — ' + s.taken.variant : ''))} » dans SumUp : il y restera en double tant que tu ne relies pas aussi cette ligne` : ''}</div></button>`).join('')
      || '<p class="muted">Rien trouvé. Les éléments déjà reliés ne sont pas proposés.</p>');
  },
  doSumupLink(i) {
    const s = (this._slShown || [])[i], sl = this._sl; if (!s || !sl) return;
    const st = Store.state.settings; if (!st.sumupLinks) st.sumupLinks = {};
    const r = this._sumupReport();
    const line = sl.mode === 'line' ? sl.src : this._sumup.lines.find(l => l.id === s.ref);
    const unit = sl.mode === 'line' ? Ventes.units().find(u => u.sku && u.sku.trim() === s.ref) : sl.src;
    if (!line || !unit) return;
    st.sumupLinks[unit.sku.trim()] = line.id;
    // Les autres formats du MÊME produit (même article SumUp, même produit appli) : reliés d'un coup quand le format est identique, seulement pour les lignes encore à corriger
    const nk = n => U.normSearch(n || '').replace(/[^a-z0-9]/g, ''), fk = v => this._fmtKey(v);
    const used = new Set(Object.values(st.sumupLinks).map(String)), linked = new Set(Object.keys(st.sumupLinks).map(k => k.toUpperCase())), todo = new Set(r.unknown.concat(r.noSku).map(l => l.id)); let extra = 0;
    if (fk(line.variant) !== '—') this._sumup.lines.filter(l => l.id && !used.has(l.id) && todo.has(l.id) && nk(l.name) === nk(line.name) && fk(l.variant) !== '—').forEach(l => {
      const t = r.appOnly.find(u => u.name === unit.name && !linked.has(u.sku.trim().toUpperCase()) && this._fmtSame(u.label, l.variant));
      if (t) { st.sumupLinks[t.sku.trim()] = l.id; used.add(l.id); linked.add(t.sku.trim().toUpperCase()); extra++; }
    });
    Store.save('settings');
    U.closeModal();
    this.render();
    U.toast(`Relié : ${unit.name}${unit.label ? ' — ' + unit.label : ''} ↔ SumUp${extra ? ` + ${extra} autre(s) format(s) du même produit` : ''}. Coche-le dans « Exporter » : le fichier mettra le SKU de l'appli dans SumUp.`);
  },
  unlinkSumup(sku) {
    const L = Store.state.settings.sumupLinks; if (!L || !(sku in L)) return;
    delete L[sku]; Store.save('settings'); this.render(); U.toast('Liaison retirée.');
  },

  /* ───── Fichier d'IMPORT SumUp (2026-09-28, demande d'Antho) ─────
     Repart du fichier SumUp déposé (toutes ses lignes, identifiants « Item id / Variant id (Do not change) »
     intacts → SumUp met à jour l'existant au lieu de créer des doublons) et ne change QUE, pour les articles
     cochés : la quantité (= stock événement de l'appli) et, si demandé, le prix TTC. Les autres lignes
     sont recopiées telles quelles. Aucune sélection → tous les articles reliés (après confirmation). */
  _sumupSel: {},
  sumupExpQty: true,
  sumupExpPrice: false,
  toggleSumupSel(sku, on) { this._sumupSel[String(sku).toUpperCase()] = !!on; this._sumupSelInfo(); },
  /* Aperçu de l'export SumUp regroupé par PRODUIT (Antho 2026-10-18) — mêmes gestes que l'export du site : case produit (tri-état) = tous ses formats d'un coup, repli du produit,
     🚫 / ↩ Inclure sur tout le produit (mémorisé dans `sumupExclude`, comme le 🚫 d'une ligne). _sumupExpRows / _sumupExclRows = lignes affichées / exclues, remplies à chaque rendu. */
  /* Un accessoire se range comme dans SumUp et dans Stock → Accessoires (Antho 2026-11-07) : le PRODUIT = famille « type + largeur » (« Longe 20mm »), ses lignes = les longueurs (5 m, 7 m…) ou
     les tailles (S, M, L). Mastication : produit = nom, lignes = formats. */
  _sumupGrpKey(m) { return m.kind === 'A' && m.gid ? 'g' + m.gid + '|A' : U.normSearch(m.name || '').trim() + '|' + (m.kind || ''); },
  _sumupGrpTitle(m) { return m.kind === 'A' && m.gname ? m.gname : m.name; },
  _sumupRowLabel(m) { return m.kind === 'A' && m.gid && m.vlabel ? m.vlabel : (m.variant || m.name); },
  _sumupUnits() {
    return Ventes.units().filter(u => u.sku && this._inCat(u.kind) && !this._unitOff(u)).map(u => ({
      sku: u.sku.trim(), name: u.name, variant: u.label || '', appType: u.kind === 'A' ? 'Accessoires' : (u.type || ''),
      appPrice: u.price, appQty: u.availE, mode: u.mode, value: u.value, kind: u.kind, fmt: this._fmtKey(u.label),
      gid: u.gid || '', gname: u.gname || '', vlabel: u.vlabel || '', sized: !!u.sized, srank: u.srank || 0, len: u.len || 0, perso: u.perso || 0, cat: u.type || ''
    }));
  },
  _sumupNameCmp(a, b) {   // ordre « par nom » : produit (famille pour un accessoire), puis taille / longueur / personnalisation, puis format
    const ttl = m => this._sumupGrpTitle(m);
    return U.sortFr(ttl(a), ttl(b))
      || (a.kind === 'A' && b.kind === 'A' ? ((a.srank - b.srank) || (a.len - b.len) || (a.perso - b.perso)) : 0)
      || U.sortFr(a.name + ' ' + a.variant, b.name + ' ' + b.variant);
  },
  _sumupGrpClosed: new Set(),
  toggleSumupGroup(k, on) {
    (this._sumupExpRows || []).filter(m => this._sumupGrpKey(m) === k).forEach(m => { this._sumupSel[m.sku.toUpperCase()] = !!on; });
    this.render();
  },
  toggleSumupExcludeGroup(k, out) {
    const members = ((out ? this._sumupExpRows : this._sumupExclRows) || []).filter(m => this._sumupGrpKey(m) === k);
    if (!members.length) return;
    const s = Store.state.settings; if (!s.sumupExclude) s.sumupExclude = [];
    members.forEach(m => {
      const key = m.sku.toUpperCase(), i = s.sumupExclude.indexOf(key);
      if (out) { if (i < 0) s.sumupExclude.push(key); delete this._sumupSel[key]; } else if (i >= 0) s.sumupExclude.splice(i, 1);
    });
    Store.save('settings');
    this.render();
    U.toast(out ? `${members.length} format(s) exclus de SumUp (ils ne seront plus jamais exportés).` : `${members.length} format(s) de nouveau envoyés à SumUp.`);
  },
  toggleSumupGrpFold(k) { if (this._sumupGrpClosed.has(k)) this._sumupGrpClosed.delete(k); else this._sumupGrpClosed.add(k); this.render(); },
  _syncSumupBoxes() {
    const rows = [...document.querySelectorAll('input.ssel')];
    document.querySelectorAll('input[data-sgbox]').forEach(h => {
      const mine = rows.filter(b => b.dataset.grp === h.dataset.sgbox), n = mine.filter(b => b.checked).length;
      h.checked = mine.length > 0 && n === mine.length; h.indeterminate = n > 0 && n < mine.length;
    });
  },
  sumupSelectVisible(on) {
    (this._sumupVisible || []).forEach(k => { this._sumupSel[k] = !!on; });
    this.render();
  },
  clearSumupSel() { this._sumupSel = {}; this.render(); },
  _sumupSelCount() { return Object.values(this._sumupSel).filter(Boolean).length; },
  _sumupSelInfo() {
    const n = this._sumupSelCount();
    const el = document.getElementById('sumup_selinfo');
    if (el) el.textContent = n ? `${n} article(s) sélectionné(s)` : 'Aucune sélection → tous les articles reliés';
    const b = document.getElementById('sumup_exp_btn');
    if (b) b.textContent = n ? `⬇ Fichier d'import SumUp (${n})` : '⬇ Fichier d\'import SumUp (tous)';
  },
  /* Découpe le texte CSV en enregistrements BRUTS (même découpage que _parseCSV, guillemets respectés) :
     les lignes non modifiées sont recopiées caractère pour caractère dans le fichier d'import. */
  _splitRecords(s) {
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    const out = []; let start = 0, inQ = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') { if (inQ && s[i + 1] === '"') { i++; continue; } inQ = !inQ; continue; }
      if (c === '\n' && !inQ) { out.push(s.slice(start, i).replace(/\r$/, '')); start = i + 1; }
    }
    if (start < s.length) out.push(s.slice(start).replace(/\r$/, ''));
    return out;
  },
  _csvField(v) {
    const t = String(v ?? '');
    return /[",\n\r]/.test(t) || /^\s|\s$/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  },
  async exportSumupImport() {
    if (!this._sumup || !this._sumup.raw) { U.toast('Dépose d\'abord ton export d\'articles SumUp.', true); return; }
    const r = this._sumupReport();
    // Les articles exclus (réglage persistant, carte d'export) ne sont JAMAIS mis à jour, même
    // s'ils restaient cochés d'une sélection précédente.
    const allExportable = r.matched.filter(m => !this._isSumupExcluded(m.sku));
    if (!allExportable.length) { U.toast('Aucun article exportable (tous exclus, ou aucun relié par SKU).', true); return; }
    const n = this._sumupSelCount();
    const chosen = n ? allExportable.filter(m => this._sumupSel[m.sku.toUpperCase()]) : allExportable;
    if (!chosen.length) { U.toast('Aucun article sélectionné à exporter.', true); return; }
    const nLinked = chosen.filter(m => m.link).length;   // lignes reliées à la main : leur SKU est remplacé par celui de l'appli (même sans prix ni quantité)
    if (!this.sumupExpQty && !this.sumupExpPrice && !nLinked) { U.toast('Coche au moins « quantités » ou « prix » (ou relie des articles dont le SKU est à corriger).', true); return; }
    const untracked = this.sumupExpQty ? chosen.filter(m => !m.track).length : 0;
    const changes = chosen.filter(m => m.link || (this.sumupExpQty && m.track && !m.qtyOk) || (this.sumupExpPrice && !m.priceOk)).length;
    const catTxt = this.cat === 'A' ? ' (accessoires)' : this.cat === 'M' ? ' (mastication)' : '';
    // Confirmation TOUJOURS (Antho 2026-10-18, après un export reçu comme « 116 articles ») : dit exactement ce qui va partir
    const what = [this.sumupExpQty ? 'quantités' : '', this.sumupExpPrice ? 'prix' : '', nLinked ? 'SKU des ' + nLinked + ' reliés' : ''].filter(Boolean).join(' + ');
    const list = chosen.slice(0, 6).map(m => m.sku).join(', ') + (chosen.length > 6 ? '…' : '');
    if (!await U.confirm(n
      ? `Le fichier ne contiendra que ${chosen.length} ligne(s) choisie(s) (${list}) — ${what}.\n\nLes autres articles de SumUp ne sont pas touchés. Continuer ?`
      : `Aucune sélection : le fichier mettra à jour les ${chosen.length} articles reliés par SKU${catTxt} (${what}).\n\nPour un premier essai, coche plutôt 1 ou 2 articles. Continuer ?`, { title: '📥 Fichier d\'import SumUp', okLabel: 'Générer le fichier' })) return;
    const raw = this._sumup.raw.map(row => row.slice());
    const lines = this._sumup.rawText.slice();
    const sameCount = lines.length === raw.length;
    const { iPrice, iQty, iSku } = this._sumup.cols;
    const touched = new Set();
    chosen.forEach(m => {
      const row = raw[m.ri]; if (!row) return;
      if (m.link && iSku >= 0) row[iSku] = m.sku;   // ligne reliée : SumUp reçoit le SKU de l'appli (prioritaire)
      if (this.sumupExpQty) row[iQty] = String(Math.round(U.num(m.appQty)));
      if (this.sumupExpPrice) row[iPrice] = U.num(m.appPrice).toFixed(2);
      touched.add(m.ri);
    });
    // Le fichier ne contient QUE les articles choisis (en-tête + la ligne de chaque article touché avec toutes ses variantes, qui sont recopiées telles quelles) — comme l'export du site :
    // les autres articles de SumUp ne sont ni relus ni réécrits (SumUp compte « N articles importés » = les lignes du fichier ; avant, tout le catalogue repartait, avec le risque
    // d'écraser des quantités vendues depuis l'export). Lignes cochées : réécrites ; variantes voisines : texte d'origine.
    const iName = raw[0].map(h => String(h).trim()).indexOf('Item name'), keep = new Set([0]); let curStart = -1, curKeep = false;
    raw.forEach((row, i) => {
      if (i === 0) return;
      if (iName < 0 || String(row[iName] || '').trim()) { curStart = i; curKeep = false; }   // nouvelle ligne « article »
      if (touched.has(i)) curKeep = true;
      if (curKeep) for (let j = curStart; j <= i; j++) keep.add(j);
    });
    const idx = [...keep].sort((a, b) => a - b), nItems = idx.filter(i => i > 0 && (iName < 0 || String(raw[i][iName] || '').trim())).length;
    const out = idx.map(i => touched.has(i) || !sameCount ? raw[i].map(f => this._csvField(f)).join(',') : lines[i]);
    const text = out.join('\n') + '\n';
    U.download('sumup-import-' + U.today() + '.csv', text, 'text/csv;charset=utf-8');
    // SKU qui resteraient en double dans SumUp : une ligne NON reliée porte encore le SKU qu'une ligne reliée va recevoir
    const taking = new Set(chosen.filter(m => m.link).map(m => m.sku.toUpperCase())), dups = r.unknown.filter(l => l.taken && taking.has(l.sku.toUpperCase()));
    U.alert(`Fichier généré : ${chosen.length} article(s) mis à jour (${changes} avec une vraie différence)${nLinked ? `, dont ${nLinked} avec SKU corrigé` : ''}${untracked ? `, dont ${untracked} sans suivi de stock dans SumUp — leur quantité n'aura aucun effet tant que le suivi n'est pas activé` : ''}.${dups.length ? `\n\n⚠️ ${dups.length} ligne(s) SumUp gardent un SKU qu'un autre article va recevoir (${dups.slice(0, 3).map(l => l.sku).join(', ')}${dups.length > 3 ? '…' : ''}) : relie-les aussi, sinon SumUp aura ces SKU en double.` : ''}\n\nLe fichier ne contient que ${nItems} article${nItems > 1 ? 's' : ''} de ta bibliothèque SumUp (avec leurs variantes) : SumUp annoncera « ${nItems} article${nItems > 1 ? 's' : ''} importé${nItems > 1 ? 's' : ''} ». Les autres ne sont pas touchés.\n\nDans SumUp : Articles → Importer → choisis ce fichier. Garde ton export d'origine (${this._sumup.file}) : c'est ta sauvegarde si le résultat ne te convient pas.`, '📥 Fichier d\'import SumUp');
  },
  /* ── AJOUT GROUPÉ SumUp (Antho 2026-11-07) : « Articles → Autres options → Importer des articles » avec des articles que SumUp ne connaît pas encore (sans « Item id » = SumUp les CRÉE).
     Même gabarit que l'export SumUp déposé (en-têtes exacts, lu dans le fichier de référence) : une ligne PRODUIT (famille « Longe 20mm », catégorie #ACCESSOIRES) + une ligne par déclinaison
     (longueur / taille / format) avec SKU, prix TTC, quantité. Seuls les articles ABSENTS de SumUp (SKU introuvable dans la référence) partent : aucun doublon possible avec ceux déjà là. ── */
  _sumupAbsent() {
    const r = this._sumup ? this._sumupReport() : null, known = new Set(r ? r.matched.map(m => m.sku.toUpperCase()) : []);
    if (this._sumup) (this._sumup.lines || []).forEach(l => { if (l.sku) known.add(String(l.sku).toUpperCase()); });
    return this._sumupUnits().filter(m => !this._isSumupExcluded(m.sku) && !known.has(m.sku.toUpperCase()));
  },
  async exportSumupNew() {
    if (!this._sumup || !this._sumup.raw) { U.toast('Dépose d\'abord ton export d\'articles SumUp : il me donne les colonnes exactes et me dit ce qui existe déjà (pour ne rien créer en double).', true); return; }
    const absent = this._sumupAbsent(), n = this._sumupSelCount();
    const chosen = (n ? absent.filter(m => this._sumupSel[m.sku.toUpperCase()]) : absent).sort((a, b) => this._sumupNameCmp(a, b));
    if (!chosen.length) { U.toast(n ? 'Aucun des articles cochés n\'est absent de SumUp (ceux qui y sont déjà se mettent à jour avec l\'autre bouton).' : 'Rien à ajouter : tout ce qui est affiché existe déjà dans SumUp.', true); return; }
    const map = new Map(), groups = [];
    chosen.forEach(m => { const k = this._sumupGrpKey(m); let g = map.get(k); if (!g) { map.set(k, g = { rows: [] }); groups.push(g); } g.rows.push(m); });
    const list = groups.slice(0, 5).map(g => this._sumupGrpTitle(g.rows[0])).join(', ') + (groups.length > 5 ? '…' : '');
    if (!await U.confirm(`${n ? 'Le fichier ne contiendra que les articles cochés ABSENTS de SumUp' : 'Aucune sélection : le fichier contiendra TOUS les articles affichés absents de SumUp'} : ${groups.length} produit(s), ${chosen.length} article(s) (${list}).\n\nSumUp va les CRÉER (rien n'est modifié sur les articles existants). Pour un premier essai, coche plutôt 1 ou 2 produits. Continuer ?`, { title: '🆕 Ajout groupé SumUp', okLabel: 'Générer le fichier' })) return;
    const head = this._sumup.raw[0].map(h => String(h).trim()), ix = h => head.indexOf(h), iCat = ix('Category'), iName = ix('Item name');
    const catA = (() => { for (const row of this._sumup.raw.slice(1)) { const c = String(row[iCat] || '').trim(); if (iName >= 0 && String(row[iName] || '').trim() && /accessoire/i.test(c)) return c; } return '#ACCESSOIRES'; })();
    const track = this.sumupExpQty;
    const mk = vals => { const row = head.map(() => ''); Object.entries(vals).forEach(([h, v]) => { const i = ix(h); if (i >= 0) row[i] = String(v); }); return row; };
    const base = (name, cat) => ({ 'Item name': name, 'Variable price? (Yes/No)': 'No', 'On sale in Online Store?': 'No', 'Set up different prices and VAT for takeaway': 'No', 'Unit': 'each.each', 'Track inventory? (Yes/No)': track ? 'Yes' : 'No', 'Category': cat, 'Display item at Checkout? (Yes/No)': 'Yes', 'Display item in Online Store? (Yes/No)': 'No', 'Display service in Bookings? (Yes/No)': 'No' });
    const priceQty = m => ({ 'Is variation visible? (Yes/No)': 'Yes', 'Price': U.num(m.appPrice).toFixed(2), 'SKU': m.sku, ...(track ? { 'Quantity': String(Math.round(U.num(m.appQty))), 'Low stock threshold': '0' } : {}) });
    const optSet = m => m.kind === 'A' ? (m.sized ? 'TAILLES' : 'TAILLE DE LONGES') : m.mode === 'gram' ? 'poids' : m.mode === 'piece' ? 'LOT' : 'TAILLES';
    const out = [head.map(h => this._csvField(h)).join(',')];
    groups.forEach(g => {
      const f = g.rows[0], title = this._sumupGrpTitle(f), cat = f.kind === 'A' ? catA : (f.appType || '');
      if (g.rows.length === 1 && !(f.kind === 'A' && f.gid)) { out.push(mk({ ...base(title, cat), ...priceQty(f) }).map(x => this._csvField(x)).join(',')); return; }
      out.push(mk(base(title, cat)).map(x => this._csvField(x)).join(','));
      g.rows.forEach(m => { const lb = this._sumupRowLabel(m); out.push(mk({ 'Variations': lb, 'Option set 1': optSet(m), 'Option 1': lb, ...priceQty(m) }).map(x => this._csvField(x)).join(',')); });
    });
    U.download('sumup-ajout-groupe-' + U.today() + '.csv', out.join('\n') + '\n', 'text/csv;charset=utf-8');
    U.alert(`Fichier généré : ${groups.length} produit(s), ${chosen.length} article(s) à créer dans SumUp (prix TTC${track ? ' + quantités du stock événement' : ''}, catégorie ${groups[0].rows[0].kind === 'A' ? catA : groups[0].rows[0].appType || '—'}).\n\nDans SumUp : Articles → Autres options → Importer des articles → choisis ce fichier. Les articles ne sont pas publiés dans la boutique en ligne. Vérifie le résultat sur 1 ou 2 produits avant d'en envoyer beaucoup.\n\nGarde ton export d'origine (${this._sumup.file}) : c'est ta sauvegarde.`, '🆕 Ajout groupé SumUp');
  },
  compareSumup(inp) {
    this._readPicked(inp, 'woo_sumup_file', 'Choisis d\'abord le fichier exporté depuis SumUp (Articles → Exporter).', (text, file) => {
      let rows; try { rows = this._parseCSV(text); } catch (e) { U.toast('CSV illisible : ' + e.message, true); return; }
      if (rows.length < 2) { U.toast('Fichier vide.', true); return; }
      const head = rows[0].map(h => h.trim());
      const col = n => head.indexOf(n);
      const iName = col('Item name'), iVar = col('Variations'), iPrice = col('Price'), iTrack = col('Track inventory? (Yes/No)'),
        iQty = col('Quantity'), iSku = col('SKU'), iCat = col('Category'), iItemId = col('Item id (Do not change)'), iVarId = col('Variant id (Do not change)');
      const idOf = r => ((iVarId >= 0 ? r[iVarId] : '') || (iItemId >= 0 ? r[iItemId] : '') || '').trim();   // identifiant stable de la ligne (reste le même quand le SKU change)
      if (iName < 0 || iSku < 0 || iPrice < 0) { U.toast('Ce fichier ne ressemble pas à un export d\'articles SumUp (colonnes Item name / Price / SKU introuvables).', true); return; }
      const num = v => { const n = parseFloat(String(v || '').replace(',', '.')); return isFinite(n) ? n : null; };
      const lines = [];
      let parent = null;
      rows.forEach((r, ri) => {
        if (ri === 0 || r.length <= 3) return;
        const name = (r[iName] || '').trim();
        if (name) {
          parent = { name, track: (r[iTrack] || '').trim() === 'Yes', cat: iCat >= 0 ? (r[iCat] || '').trim() : '' };
          if ((r[iPrice] || '').trim() !== '') lines.push({ ri, id: idOf(r), name, variant: '', sku: (r[iSku] || '').trim(), price: num(r[iPrice]), qty: num(r[iQty]), track: parent.track, cat: parent.cat });
          return;
        }
        if (!parent) return;
        lines.push({ ri, id: idOf(r), name: parent.name, variant: (r[iVar] || '').trim(), sku: (r[iSku] || '').trim(), price: num(r[iPrice]), qty: num(r[iQty]), track: parent.track, cat: parent.cat });
      });
      // Fichier brut conservé : le fichier d'import SumUp repart de CE fichier (mêmes lignes, mêmes « Item id / Variant id »). v:2 = les lignes portent leur identifiant (liaison manuelle possible).
      this._sumup = { v: 2, lines, file: file.name, raw: rows, rawText: this._splitRecords(text), cols: { iPrice, iQty, iSku } };
      this._pruneSumupLinks();
      this._sumupSel = {};
      try { localStorage.setItem('touffu_sumupRef', JSON.stringify(this._sumup)); } catch (e) {}
      this.render();
      U.toast(`SumUp : ${lines.length} article(s)/variante(s) lus.`);
    });
  },
  /* Catégorie (Antho 2026-10-11) : Tous | Mastication | Accessoires, PARTAGÉE par Comparer et Exporter SumUp (mémorisée). Elle borne aussi le « tout est exporté » quand rien n'est coché :
     les accessoires (qui reçoivent leurs SKU un par un) ne partent jamais dans SumUp sans l'avoir choisi. Côté SumUp, un article est « accessoire » si sa catégorie SumUp contient « accessoire » ;
     sans catégorie du tout → alerte (visible seulement sous « Tous »). Côté appli : kind 'A' = accessoire, le reste = mastication. */
  cat: 'M',   // Antho 2026-10-17 : la page s'ouvre TOUJOURS sur Mastication (son choix « Tous / Accessoires » ne vaut que pour la visite en cours, plus mémorisé)
  setCat(v) { this.cat = v === 'A' || v === 'all' ? v : 'M'; this.render(); },
  _inCat(kind) { return this.cat === 'all' || (this.cat === 'A' ? kind === 'A' : kind !== 'A'); },
  _catSeg() {
    return `<div class="frow mt" style="gap:8px;align-items:center;flex-wrap:wrap;"><span class="muted">Catégorie :</span>${U.seg([['all', 'Tous'], ['M', '🥩 Mastication'], ['A', '🐕 Accessoires']].map(([k, l]) => ({ l, on: this.cat === k, js: `Woo.setCat('${k}')` })), { sm: true, wrap: true })}</div>`;
  },
  _uncatAppCount() { return Store.state.stockM.reduce((n, p) => n + (String(p.meatType || '').trim() ? 0 : p.variants.filter(v => v.sku).length), 0); },   // produits mastication SANS type de viande (Ventes.units() les range sous « Autre »)
  _uncatAlert(n) {
    const na = this._uncatAppCount(); if (!n && !na) return '';
    const parts = [];
    if (n) parts.push(`<b>${n} article${n > 1 ? 's' : ''} SumUp sans catégorie</b> (ni viande, ni « Accessoire »)`);
    if (na) parts.push(`<b>${na} produit${na > 1 ? 's' : ''} de l'appli sans type de viande</b>`);
    return `<div class="card" style="border-left:4px solid var(--warn);margin:10px 0 0;padding:10px 14px;">⚠️ ${parts.join(' · ')} — à classer pour être comptés dans la bonne catégorie.${n ? ' <span class="muted">Les articles SumUp sans catégorie n\'apparaissent que sous « Tous ».</span>' : ''}</div>`;
  },
  _sumupReport() {
    const units = Ventes.units();
    const bySku = new Map();
    units.forEach(u => { if (u.sku) bySku.set(u.sku.trim().toUpperCase(), u); });
    const qOf = u => u.availE;
    const seen = new Set();
    const matched = [], unknown = [], noSku = [];
    // Liaisons manuelles (l'appli est prioritaire) : la ligne SumUp reliée reçoit le SKU de l'appli. Elles l'emportent sur la correspondance par SKU.
    const links = (this._sumup.v === 2 && Store.state.settings.sumupLinks) || {}, byLine = new Map();
    Object.keys(links).forEach(k => { const u = bySku.get(k.toUpperCase()); if (u) byLine.set(String(links[k]), u); });
    const claimed = new Set([...byLine.values()].map(u => u.sku.trim().toUpperCase()));
    // SKU EN DOUBLE dans SumUp (Antho 2026-10-18 : « Oreilles de bœuf — LOT2 » portait le SKU des oreilles AVEC poils) : une seule ligne garde la correspondance (celle dont le nom ressemble le plus
    // au produit de l'appli, si sans ambiguïté) ; les autres passent en « SKU inconnu / en double » à relier — jamais de prix ni de quantité envoyés à la mauvaise ligne.
    const lineLabel = l => l.name + (l.variant ? ' — ' + l.variant : ''), unitLabel = u => u.name + (u.label ? ' — ' + u.label : '');
    const bySkuLines = new Map();
    this._sumup.lines.forEach(l => { const k = (l.sku || '').toUpperCase(); if (!k) return; if (!bySkuLines.has(k)) bySkuLines.set(k, []); bySkuLines.get(k).push(l); });
    const keepLine = new Map();
    bySkuLines.forEach((ls, k) => {
      if (ls.length < 2) return;
      const u = bySku.get(k); let best = null;
      if (u) { const sc = ls.map(l => [this._slScore(lineLabel(l), unitLabel(u)), l]).sort((a, b) => b[0] - a[0]); if (sc[0][0] > sc[1][0]) best = sc[0][1]; }
      keepLine.set(k, best);
    });
    const dupOf = l => { const g = l.sku ? bySkuLines.get(l.sku.toUpperCase()) : null; return g && g.length > 1 ? { n: g.length, others: g.filter(x => x !== l).map(lineLabel) } : null; };
    const push = (l, u, link, dup) => {
      seen.add(u.sku.trim().toUpperCase());
      const appQty = qOf(u);
      const priceOk = l.price != null && Math.round(l.price * 100) === Math.round(u.price * 100);
      const qtyOk = !l.track ? null : (l.qty != null && Math.abs(l.qty - appQty) < 0.0005);
      matched.push({ ...l, sku: link ? u.sku.trim() : l.sku, link: link ? { sumupSku: l.sku } : null, dup: dup || null, appName: u.name + (u.label ? ' — ' + u.label : ''), appPrice: u.price, appQty, priceOk, qtyOk, kind: u.kind, appType: u.kind === 'A' ? 'Accessoires' : (u.type || '') });
    };
    this._sumup.lines.forEach(l => {
      const lu = l.id ? byLine.get(l.id) : null;
      if (lu) { push(l, lu, (l.sku || '').toUpperCase() !== lu.sku.trim().toUpperCase()); return; }
      if (!l.sku) { noSku.push(l); return; }
      const u = bySku.get(l.sku.toUpperCase()), dup = dupOf(l);
      if (!u) { unknown.push(dup ? { ...l, dup } : l); return; }
      if (claimed.has(l.sku.toUpperCase())) { unknown.push({ ...l, taken: true, dup }); return; }   // son SKU est celui d'un produit relié à une AUTRE ligne SumUp
      if (dup && keepLine.get(l.sku.toUpperCase()) !== l) { unknown.push({ ...l, dup }); return; }
      push(l, u, false, dup);
    });
    // Catégorie des lignes SumUp SANS équivalent dans l'appli : d'après leur catégorie SumUp (« Accessoires » ou une viande ; vide = non classée)
    const lineKind = l => { const c = this._sumupCatOf(l); return /accessoire/i.test(c) ? 'A' : c === 'Sans catégorie' ? '?' : 'M'; };
    const uncat = unknown.filter(l => lineKind(l) === '?').length + noSku.filter(l => lineKind(l) === '?').length;
    const inCat = l => this.cat === 'all' || lineKind(l) === this.cat;
    // 500 g et plus : réservés aux ventes en ligne, jamais emmenés sur les marchés (Antho, 2026-09-28) → normal qu'ils manquent dans SumUp.
    const bigBag = u => u.kind === 'M' && u.mode === 'gram' && U.num(u.value) >= 500;
    const appOnly = units.filter(u => u.sku && !seen.has(u.sku.trim().toUpperCase()) && !bigBag(u) && this._inCat(u.kind) && !this._unitOff(u));
    const dups = [...bySkuLines].filter(([k, ls]) => ls.filter(l => !(l.id && byLine.has(l.id))).length > 1 && ls.some(l => this._inCat(bySku.get(k) ? bySku.get(k).kind : lineKind(l) === 'A' ? 'A' : 'M'))).map(([k, ls]) => ({ sku: ls[0].sku, labels: ls.map(lineLabel) }));
    const byAppSku = new Map(); units.forEach(u => { if (!u.sku) return; const k = u.sku.trim().toUpperCase(); if (!byAppSku.has(k)) byAppSku.set(k, []); byAppSku.get(k).push(u); });
    const appDups = [...byAppSku].filter(([k, us]) => us.length > 1 && us.some(u => this._inCat(u.kind))).map(([k, us]) => ({ sku: us[0].sku.trim(), labels: us.map(unitLabel) }));
    return { matched: matched.filter(m => this._inCat(m.kind)), unknown: unknown.filter(inCat), noSku: noSku.filter(inCat), appOnly, uncat, dups, appDups };
  },
  /* Groupe « à relier » par viande : à gauche les articles SumUp sans SKU ou avec un SKU inconnu,
     à droite les produits de l'appli (avec SKU) absents de SumUp — même viande côte à côte, triés par nom,
     pour qu'Antho repère lui-même les correspondances et corrige le SKU dans SumUp. Aucun rapprochement
     automatique par ressemblance de nom (règle du projet) : c'est un simple rangement. */
  _sumupGroupKey(label) { return U.normSearch(label || '').replace(/[^a-z0-9]/g, ''); },
  _sumupCatOf(l) {
    const parts = String(l.cat || '').split('||').map(x => x.trim()).filter(Boolean);
    const meat = parts.find(x => !x.startsWith('#'));
    return meat || (parts.length ? 'Accessoires' : 'Sans catégorie');
  },
  _sumupOpen: {},
  /* Bandeau « SKU en double » : un SKU est UNIQUE, dans SumUp comme dans l'appli (Antho 2026-10-18). */
  _appDups() {
    // Sur les produits eux-mêmes (Ventes.units), PAS sur lines() : lines() fusionne les SKU identiques (stocks additionnés) et cacherait justement le doublon.
    const m = new Map(); Ventes.units().filter(u => u.sku && !this._unitOff(u)).forEach(u => { const k = u.sku.trim().toUpperCase(); if (!m.has(k)) m.set(k, []); m.get(k).push(u); });
    return [...m.values()].filter(g => g.length > 1).map(g => ({ sku: g[0].sku.trim(), labels: g.map(u => u.name + (u.label ? ' — ' + u.label : '')) }));
  },
  /* Même bandeau pour le site (Comparer ET Exporter : deux lignes de l'appli avec le même SKU feraient refuser l'import par WooCommerce) */
  _siteDupAlert(c) {
    const dups = c ? c.dups : [], appDups = c ? c.appDups : this._appDups();
    if (!dups.length && !appDups.length) return '';
    const li = arr => arr.slice(0, 8).map(d => `<li><span class="sku-txt">${U.esc(d.sku)}</span> — ${d.labels.map(x => U.esc(x)).join(' · ')}</li>`).join('') + (arr.length > 8 ? `<li class="muted">… et ${arr.length - 8} autre(s)</li>` : '');
    return `<div class="card" style="border-left:4px solid var(--alerte);margin:10px 0 0;padding:10px 14px;">
      ${dups.length ? `<b>⚠️ ${dups.length} SKU (UGS) en double sur le site</b> — WooCommerce veut un UGS unique. L'appli ne compare que la fiche la plus ressemblante (sans fiche nettement plus proche, aucune : le produit passe en « absent du site ») ; corrige l'UGS de l'autre fiche sur le site, ou relie la bonne avec 🔗.<ul style="margin:6px 0 0 18px;">${li(dups)}</ul>` : ''}
      ${appDups.length ? `<div${dups.length ? ' class="mt"' : ''}><b>⚠️ ${appDups.length} SKU en double dans l'appli</b> — à corriger dans Stock / Accessoires (deux produits ne peuvent pas avoir le même SKU : l'import du site serait refusé ou mélangé).<ul style="margin:6px 0 0 18px;">${li(appDups)}</ul></div>` : ''}</div>`;
  },
  _sumupDupAlert(r) {
    if (!r || (!r.dups.length && !r.appDups.length)) return '';
    const li = arr => arr.slice(0, 8).map(d => `<li><span class="sku-txt">${U.esc(d.sku)}</span> — ${d.labels.map(x => U.esc(x)).join(' · ')}</li>`).join('') + (arr.length > 8 ? `<li class="muted">… et ${arr.length - 8} autre(s)</li>` : '');
    return `<div class="card" style="border-left:4px solid var(--alerte);margin:10px 0 0;padding:10px 14px;">
      ${r.dups.length ? `<b>⚠️ ${r.dups.length} SKU en double dans SumUp</b> — un SKU doit être unique. L'appli ne met à jour que la ligne la plus ressemblante ; l'autre passe en « SKU en double » : clique 🔗 pour la relier au bon produit (son SKU sera corrigé à l'import).<ul style="margin:6px 0 0 18px;">${li(r.dups)}</ul>` : ''}
      ${r.appDups.length ? `<div${r.dups.length ? ' class="mt"' : ''}><b>⚠️ ${r.appDups.length} SKU en double dans l'appli</b> — à corriger dans Stock (deux variantes ne peuvent pas avoir le même SKU).<ul style="margin:6px 0 0 18px;">${li(r.appDups)}</ul></div>` : ''}</div>`;
  },
  _copySku(t) {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    U.toast(ok ? `SKU copié : ${t}` : `SKU : ${t}`);
  },
  _renderSumupPairs(r) {
    const groups = new Map();
    const g = (label) => { const k = this._sumupGroupKey(label); if (!groups.has(k)) groups.set(k, { label, left: [], right: [] }); return groups.get(k); };
    r.noSku.forEach(l => g(this._sumupCatOf(l)).left.push({ ...l, why: 'sans SKU' }));
    r.unknown.forEach(l => g(this._sumupCatOf(l)).left.push({ ...l, why: 'inconnu' }));
    r.appOnly.forEach(u => g(u.kind === 'A' ? 'Accessoires' : (u.type || 'Sans catégorie')).right.push(u));
    // Catégories SumUp / viandes appli nommées un peu différemment (« CERF/ CHEVREUIL » ↔ « Cerf »,
    // « CORNE » ↔ « Cornes ») : un groupe seulement SumUp et un groupe seulement appli dont l'un des noms
    // commence par l'autre sont réunis.
    [...groups.entries()].forEach(([k, x]) => {
      if (!x.left.length || x.right.length) return;
      const hit = [...groups.entries()].find(([k2, y]) => k2 !== k && !y.left.length && y.right.length && k2.length >= 4 && k.length >= 4 && (k.startsWith(k2) || k2.startsWith(k)));
      if (hit) { x.right = hit[1].right; x.label = x.label + ' · ' + hit[1].label; groups.delete(hit[0]); }
    });
    const list = [...groups.values()].filter(x => x.left.length || x.right.length).sort((a, b) => (b.left.length > 0) - (a.left.length > 0) || U.sortFr(a.label, b.label));
    const nL = r.noSku.length + r.unknown.length;
    const sku = t => `<span class="tag" style="cursor:copy;" title="Cliquer pour copier" onclick="Woo._copySku('${U.esc(t).replace(/&#39;/g, "\\'")}')">${U.esc(t)} 📋</span>`;
    return `<h3 class="mt">🔗 À relier, par viande <span class="muted" style="font-size:.85rem;font-weight:400;">— ${nL} article(s) SumUp à corriger · ${r.appOnly.length} produit(s) de l'appli absents de SumUp (hors 500 g et plus, jamais sur les marchés)</span></h3>
      <p class="muted help">À gauche, les articles SumUp sans SKU ou avec un SKU que l'appli ne connaît pas ; à droite, les produits de l'appli (avec leur SKU) qui ne sont pas dans SumUp, pour la même viande. Repère les correspondances puis clique 🔗 (ou « Relier à un produit de l'appli » dans le tableau) : le SKU de l'appli sera mis dans SumUp par le fichier d'import (onglet Exporter). Tu peux aussi cliquer le SKU de l'appli pour le copier. Rien n'est relié sans ton clic.</p>
      ${list.map(x => {
        const k = this._sumupGroupKey(x.label);
        const open = this._sumupOpen[k] !== undefined ? this._sumupOpen[k] : false;
        return `<details class="fold mt" ${open ? 'open' : ''} ontoggle="Woo._sumupOpen['${k}']=this.open"><summary><b>${U.esc(x.label)}</b> <span class="muted" style="font-size:.85rem;">— SumUp à corriger : ${x.left.length} · appli absent de SumUp : ${x.right.length}</span></summary>
          <div class="sumup-pairs">
            <div><div class="muted" style="font-size:.8rem;margin-bottom:4px;">💳 SumUp</div>
              ${x.left.sort((a, b) => U.sortFr(a.name + a.variant, b.name + b.variant)).map(l => `<div class="sp-row"><span><b>${U.esc(l.name)}</b>${l.variant ? ' — ' + U.esc(l.variant) : ''}</span><span>${l.why === 'sans SKU' ? '<span class="badge warn">sans SKU</span>' : `<span class="badge bad" title="SKU inconnu dans l'appli">${U.esc(l.sku)}</span>`} <span class="muted">${l.price != null ? U.eur(l.price) : ''}</span>${l.id ? ` <button class="btn-ghost btn-sm fit" data-id="${U.esc(l.id)}" onclick="Woo.openSumupLink('line', this.dataset.id)" title="Relier à un produit de l'appli : son SKU sera mis dans SumUp à l'import">🔗</button>` : ''}</span></div>`).join('') || '<div class="muted">Rien à corriger</div>'}
            </div>
            <div><div class="muted" style="font-size:.8rem;margin-bottom:4px;">📦 Appli (pas dans SumUp)</div>
              ${x.right.sort((a, b) => U.sortFr(a.name + a.label, b.name + b.label)).map(u => `<div class="sp-row"><span><b>${U.esc(u.name)}</b>${u.label ? ' — ' + U.esc(u.label) : ''}</span><span>${sku(u.sku)} <span class="muted">${U.eur(u.price)}</span> <button class="btn-ghost btn-sm fit" data-sku="${U.esc(u.sku)}" onclick="Woo.openSumupLink('app', this.dataset.sku)" title="Relier à une ligne SumUp : le SKU de l'appli sera mis dans SumUp à l'import">🔗</button></span></div>`).join('') || '<div class="muted">—</div>'}
            </div>
          </div></details>`;
      }).join('')}`;
  },
  exportSumupIssues() {
    const r = this._sumupReport();
    const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const f = v => v == null ? '' : String(v.toFixed ? v.toFixed(2) : v).replace('.', ',');
    const out = [['Article SumUp', 'Variante', 'SKU', 'Problème', 'Prix SumUp', 'Prix appli', 'Qté SumUp', 'Qté appli'].map(q).join(';')];
    r.matched.filter(m => !m.priceOk || m.qtyOk === false || m.link || m.dup).forEach(m => out.push([m.name, m.variant, m.sku,
      [m.dup ? 'SKU en double dans SumUp' : '', m.link ? 'SKU SumUp à remplacer (' + (m.link.sumupSku || 'vide') + ')' : '', !m.priceOk ? 'prix différent' : '', m.qtyOk === false ? 'quantité différente' : ''].filter(Boolean).join(' + '),
      f(m.price), f(m.appPrice), m.track ? m.qty : 'non suivi', m.appQty].map(q).join(';')));
    r.unknown.forEach(l => out.push([l.name, l.variant, l.sku, l.dup ? 'SKU en double dans SumUp (aussi sur : ' + l.dup.others.join(' · ') + ')' : 'SKU inconnu dans l\'appli', f(l.price), '', l.track ? l.qty : '', ''].map(q).join(';')));
    r.noSku.forEach(l => out.push([l.name, l.variant, '', 'pas de SKU dans SumUp', f(l.price), '', l.track ? l.qty : '', ''].map(q).join(';')));
    U.download('sumup-a-corriger-' + U.today() + '.csv', '\ufeff' + out.join('\n'), 'text/csv;charset=utf-8');
  },
  /* Carte d'export SumUp \u00ab simple \u00bb (2026-09-30, demande d'Antho : le m\u00eame syst\u00e8me que l'export
     vers le site \u2014 aper\u00e7u, recherche, filtre viande, s\u00e9lection ET exclusion persistante \u2014 sans
     attendre un rapport de comparaison). Ne liste que les articles reli\u00e9s par SKU (r.matched) :
     on ne peut mettre \u00e0 jour dans SumUp qu'un article qu'il conna\u00eet d\u00e9j\u00e0 par ce SKU. La s\u00e9lection
     (_sumupSel) et les 2 cases prix/quantit\u00e9 sont PARTAG\u00c9ES avec le rapport d\u00e9taill\u00e9 ci-dessous et
     exportSumupImport() \u2014 un seul m\u00e9canisme de g\u00e9n\u00e9ration, juste une 2e fa\u00e7on de le piloter. */
  _renderSumupExport() {
    const f = this.sumupExpFilters;
    // Liste = les produits de l'appli (avec SKU), SANS besoin du fichier SumUp : simple réglage en
    // amont (quoi exporter / ne jamais exporter). Le fichier SumUp n'est requis qu'au moment de
    // générer (identifiants cachés des articles → mise à jour sans doublons).
    const r = this._sumup ? this._sumupReport() : null;
    const inSumup = new Map(); if (r) r.matched.forEach(m => inSumup.set(m.sku.toUpperCase(), m));
    const units = this._sumupUnits();
    const isExcl = u => this._isSumupExcluded(u.sku);
    const exportable = units.filter(u => !isExcl(u));
    const excludedCount = units.length - exportable.length;
    const typeCounts = {};
    exportable.forEach(m => { const t = m.appType || 'Autre'; typeCounts[t] = (typeCounts[t] || 0) + 1; });
    const typeOpts = [{ v: 'all', l: `Tous (${exportable.length})` }].concat(Object.keys(typeCounts).sort(U.sortFr).map(t => ({ v: t, l: `${t} (${typeCounts[t]})` })));
    const q = U.normSearch(f.q || '').trim();
    const fmtList = [...new Set(exportable.map(m => m.fmt))];
    this._sumupFmtList = fmtList;
    const fmtSel = this._sumupFmtSel();
    const byName = (a, b) => this._sumupNameCmp(a, b);
    const sdir = f.sortDir === 'desc' ? -1 : 1;
    const stRank = m => !r ? 0 : inSumup.has(m.sku.toUpperCase()) ? (inSumup.get(m.sku.toUpperCase()).link ? 1 : 2) : 3;   // sans référence · à corriger · présent · absent
    const visible = exportable.filter(m => fmtSel.includes(m.fmt) && (f.meat === 'all' || m.appType === f.meat) && (!q || U.has(m.name + ' ' + m.gname + ' ' + m.variant + ' ' + m.sku, q)))
      .sort((a, b) => {
        let c;
        if (f.sort === 'sku') c = U.sortFr(a.sku, b.sku);
        else if (f.sort === 'type') c = U.sortFr(a.appType || '', b.appType || '');
        else if (f.sort === 'price') c = U.num(a.appPrice) - U.num(b.appPrice);
        else if (f.sort === 'stock') c = U.num(a.appQty) - U.num(b.appQty);
        else if (f.sort === 'insumup') c = stRank(a) - stRank(b);
        else c = byName(a, b);
        return (c * sdir) || byName(a, b);
      });
    const sh = (key, label) => `<span class="sortable ${f.sort === key ? 'active' : ''}" onclick="Woo.setSumupExpSort('${key}')">${label} ${f.sort === key ? (f.sortDir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
    this._sumupExpVisible = visible.map(m => m.sku.toUpperCase());
    this._sumupExpRows = visible; this._sumupExclRows = units.filter(isExcl);
    this._sumupExpMap = Object.fromEntries(visible.map(m => [m.sku.toUpperCase(), m]));
    const allVisSel = visible.length > 0 && visible.every(m => this._sumupSel[m.sku.toUpperCase()]);
    const selCount = exportable.filter(m => this._sumupSel[m.sku.toUpperCase()]).length;
    const exportLabel = selCount > 0 ? `⬇ Générer le fichier d'import SumUp (${selCount} sélectionné(s))` : `⬇ Générer le fichier d'import SumUp (${exportable.length} produit${exportable.length > 1 ? 's' : ''})`;
    const refBlock = this._sumup
      ? `<div class="frow" style="gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;">
          <span class="muted" style="font-size:.85rem;">✅ Référence SumUp : ${U.esc(this._sumup.file)}</span>
          <input type="file" id="woo_sumup_file" accept=".csv,text/csv" style="flex:1 1 200px;" onchange="Woo.compareSumup(this)">
        </div>`
      : `<div class="card" style="border-left:4px solid var(--warn);margin:10px 0 0;">
          <b>Pour générer le fichier, il me faut ton export d'articles SumUp</b> (me.sumup.com → Articles → Exporter) : il contient les identifiants cachés qui permettent à SumUp de mettre à jour tes articles au lieu d'en créer en double. À déposer <b>une seule fois</b> — il est ensuite gardé en mémoire.
          <div class="frow" style="gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;">
            <input type="file" id="woo_sumup_file" accept=".csv,text/csv" style="flex:1 1 200px;" onchange="Woo.compareSumup(this)">
          </div></div>`;
    return `
      ${this._sumupDupAlert(r)}${this._catSeg()}${this._uncatAlert(r ? r.uncat : 0)}
      <div class="frow mt" style="gap:18px;flex-wrap:wrap;margin:0 0 4px;">
        <label class="opt-check"><input type="checkbox" ${this.sumupExpPrice ? 'checked' : ''} onchange="Woo.sumupExpPrice=this.checked"> Envoyer les prix (TTC public)</label>
        <label class="opt-check"><input type="checkbox" ${this.sumupExpQty ? 'checked' : ''} onchange="Woo.sumupExpQty=this.checked"> Envoyer les quantités (stock événement)</label>
      </div>
      <div class="grid c3 mt">
        <div class="fg"><label>Recherche</label><input id="sumup_exp_q" value="${U.esc(f.q)}" placeholder="nom du produit ou SKU…" oninput="Woo._setSumupExpQ(this.value)"></div>
        <div class="fg"><label>Type / viande</label>${U.customSelect({ value: f.meat, options: typeOpts, onPick: 'Woo._setSumupExpMeat' })}</div>
        <div class="fg"><label>Variantes (format)</label>${U.multiSelect({ groups: this._fmtGroups(fmtList), selected: fmtSel, toggle: 'Woo._sumupFmtToggle', setAll: 'Woo._sumupFmtAll', open: f.fmtOpen, onOpen: 'Woo._sumupFmtOpen' })}</div>
      </div>
      <div class="frow mt" style="gap:12px;align-items:center;flex-wrap:wrap;">
        <label class="ms-opt" style="flex:0 0 auto;"><input type="checkbox" ${allVisSel ? 'checked' : ''} onchange="Woo.sumupExpSelectAll(this.checked)"> Tout sélectionner (${visible.length} affiché(s))</label>
        <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Woo.sumupExpSelectNoBig()" title="Coche les produits affichés, sauf les formats de 500 g et plus">Tout sélectionner sauf 500 g et plus</button>
        <span class="muted">${selCount > 0 ? `${selCount} produit(s) sélectionné(s)` : 'Aucune sélection → tout est exporté'}</span>
        ${excludedCount > 0 ? `<span class="tag" style="border-color:var(--alerte);">🚫 ${excludedCount} exclu(s) de SumUp</span>` : ''}
        ${selCount > 0 ? `<button class="btn-ghost btn-sm" style="flex:0;" onclick="Woo.clearSumupSel()">Vider la sélection</button>` : ''}
      </div>
      ${refBlock}
      <div class="mt" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button id="sumup_exp_btn2" class="btn-cta" onclick="Woo.exportSumupImport()">${exportLabel}</button>
        <button class="btn-ghost" onclick="Woo.exportSumupNew()" title="Crée dans SumUp les articles qu'il ne connaît pas encore (Articles → Autres options → Importer des articles). Les articles déjà dans SumUp ne sont pas touchés.">${(() => { const ab = this._sumupAbsent(), sc = this._sumupSelCount(), n = sc ? ab.filter(m => this._sumupSel[m.sku.toUpperCase()]).length : ab.length; return sc ?`🆕 Ajout groupé : ${n} coché(s) absent(s) de SumUp` : `🆕 Ajout groupé : ${ab.length} absent(s) de SumUp (tous)`; })()}</button>
      </div>
      <p class="muted help mt">Dans SumUp : Articles → Importer → choisis ce fichier. <b>Coche 1 ou 2 produits pour un premier essai</b> (le fichier ne contient QUE les articles cochés, avec leurs variantes) et vérifie que SumUp met bien à jour l'existant (pas de doublon créé) avant de faire un export complet. Un produit « absent » de SumUp n'est pas mis à jour : crée-le d'abord dans SumUp puis rafraîchis la référence. 🚫 = exclu définitivement (mémorisé).</p>
      <div class="table-wrap mt"><table><thead><tr>
        <th style="width:34px;"><input type="checkbox" ${allVisSel ? 'checked' : ''} onchange="Woo.sumupExpSelectAll(this.checked)" title="Tout sélectionner"></th>
        <th>${sh('sku', 'SKU')}</th><th class="col-name">${sh('name', 'Produit')}</th><th>${sh('type', 'Type / viande')}</th><th class="num">${sh('price', 'Prix TTC')}</th><th class="num">${sh('stock', 'Stock évén.')}</th><th>${sh('insumup', 'Dans SumUp')}</th><th>Envoi SumUp</th></tr></thead>
        <tbody>${(() => {
          const map = new Map(), groups = [];
          visible.slice(0, 200).forEach(m => { const k = this._sumupGrpKey(m); let g = map.get(k); if (!g) { map.set(k, g = { k, rows: [] }); groups.push(g); } g.rows.push(m); });
          const row = (m, k, multi) => { const sku = m.sku.toUpperCase(); const skuJs = String(m.sku).replace(/'/g, "\\'"); return `<tr data-grp="${U.esc(k)}"${multi && this._sumupGrpClosed.has(k) ? ' hidden' : ''}>
          <td><input type="checkbox" class="ssel" data-grp="${U.esc(k)}" ${this._sumupSel[sku] ? 'checked' : ''} onchange="Woo.toggleSumupSel('${skuJs}',this.checked);Woo.render();"></td>
          <td><span class="tag">${U.esc(m.sku)}</span></td>
          <td class="col-name"${multi ? ' data-fmt="1"' : ''}>${multi ? U.esc(this._sumupRowLabel(m)) : (m.kind === 'A' && m.gid ? U.esc(this._sumupGrpTitle(m)) + (m.vlabel ? ' — ' + U.esc(m.vlabel) : '') : U.esc(m.name) + (m.variant ? ' — ' + U.esc(m.variant) : ''))}</td>
          <td>${m.appType ? `<span class="badge info">${U.esc(m.appType)}</span>` : '—'}</td>
          <td class="num">${this.sumupExpPrice ? U.eur(m.appPrice) : '—'}</td>
          <td class="num">${this.sumupExpQty ? U.qty(m.appQty) : '—'}</td>
          <td>${!r ? '<span class="muted">—</span>' : inSumup.has(sku) ? (inSumup.get(sku).link ? '<span class="badge info" title="Ligne SumUp reliée à la main : le fichier d\'import y met le SKU de l\'appli">🔗 SKU à corriger</span>' : '<span class="pos">✅</span>') : '<span class="badge warn">absent</span>'}</td>
          <td><button class="btn-icon" title="Exclure définitivement cet article des exports SumUp" onclick="Woo.toggleSumupExclude('${skuJs}')">🚫</button></td></tr>`; };
          return groups.map(g => {
            if (g.rows.length < 2) return row(g.rows[0], g.k, false);
            const closed = this._sumupGrpClosed.has(g.k);
            return `<tr class="wgrp"><td><input type="checkbox" data-sgbox="${U.esc(g.k)}" title="Cocher tous les formats de ce produit" onchange="Woo.toggleSumupGroup(this.dataset.sgbox,this.checked)"></td>
              <td colspan="6" style="cursor:pointer;" data-gk="${U.esc(g.k)}" onclick="Woo.toggleSumupGrpFold(this.dataset.gk)">${closed ? '▸' : '▾'} <b>${U.esc(this._sumupGrpTitle(g.rows[0]))}</b> <span class="muted">· ${g.rows.length} ${g.rows[0].kind === 'A' ? (g.rows[0].sized ? 'tailles' : 'longueurs') : 'formats'}</span></td>
              <td><button class="btn-icon" title="Exclure tous les formats de ce produit de SumUp (ne jamais les envoyer)" data-gk="${U.esc(g.k)}" onclick="Woo.toggleSumupExcludeGroup(this.dataset.gk,true)">🚫</button></td></tr>` + g.rows.map(m => row(m, g.k, true)).join('');
          }).join('');
        })() || '<tr><td colspan="8" class="muted">Aucun article ne correspond au filtre.</td></tr>'}</tbody></table>
        ${visible.length > 200 ? `<p class="muted">… et ${visible.length - 200} autres non affichés (affine la recherche pour les voir — « Tout sélectionner » couvre bien les ${visible.length}).</p>` : ''}
      </div>
      ${excludedCount > 0 ? `<details class="fold mt" ${this._sumupExclOpen ? 'open' : ''} ontoggle="Woo._sumupExclOpen=this.open"><summary>🚫 ${excludedCount} article(s) exclu(s) de SumUp</summary><div class="fold-body">
        ${(() => {
          const map = new Map(), groups = [];
          units.filter(isExcl).sort((a, b) => this._sumupNameCmp(a, b)).forEach(m => { const k = this._sumupGrpKey(m); let g = map.get(k); if (!g) { map.set(k, g = { k, rows: [] }); groups.push(g); } g.rows.push(m); });
          return groups.map(g => (g.rows.length > 1 ? `<div class="frow" style="gap:10px;align-items:center;padding:6px 0 2px;"><b style="flex:1;">${U.esc(this._sumupGrpTitle(g.rows[0]))} <span class="muted" style="font-weight:400;">· ${g.rows.length} formats</span></b><button class="btn-ghost btn-sm" data-gk="${U.esc(g.k)}" onclick="Woo.toggleSumupExcludeGroup(this.dataset.gk,false)">↩ Inclure tout le produit</button></div>` : '')
            + g.rows.map(m => { const skuJs = String(m.sku).replace(/'/g, "\\'"); return `<div class="frow" style="gap:10px;align-items:center;padding:3px 0;${g.rows.length > 1 ? 'margin-left:18px;' : ''}"><span class="tag">${U.esc(m.sku)}</span><span style="flex:1;">${U.esc(g.rows.length > 1 ? this._sumupRowLabel(m) : m.name + (m.variant && !(m.kind === 'A' && m.gid) ? ' — ' + m.variant : ''))}</span><button class="btn-ghost btn-sm" onclick="Woo.toggleSumupExclude('${skuJs}')">↩ Inclure</button></div>`; }).join('')).join('');
        })()}
      </div></details>` : ''}
    `;
  },
  /* « Je compare : Tout | SKU | Prix | Stock » (Antho 2026-10-11) : une seule chose à la fois (colonnes + pastilles de statut adaptées) ; les lignes sont regroupées par produit (nom écrit une fois, formats dessous). */
  sumupWhat: 'all',
  cmpWhat: 'all',
  _setSumupWhat(v) { this.sumupWhat = v; this.sumupFilter = 'issues'; this.render(); },
  _setCmpWhat(v) { this.cmpWhat = v; this.cmpFilter = 'issues'; this.render(); },
  _whatSeg(cur, setter) {
    return `<div class="frow mt" style="gap:8px;align-items:center;flex-wrap:wrap;"><span class="muted">Je compare :</span>${U.seg([['all', 'Tout'], ['sku', '🏷️ SKU'], ['price', '💶 Prix'], ['stock', '📦 Stock']].map(([k, l]) => ({ l, on: cur === k, js: `${setter}('${k}')` })), { sm: true, wrap: true })}</div>`;
  },
  _renderSumup() {
    const r = this._sumupReport(), W = ['sku', 'price', 'stock'].includes(this.sumupWhat) ? this.sumupWhat : 'all';
    // Toutes les lignes SumUp dans un seul tableau : reliées, SKU inconnu, sans SKU.
    const all = [
      ...r.matched.map(m => ({ ...m, st: 'matched', dPrice: m.price != null ? +(m.appPrice - m.price).toFixed(2) : null, dQty: m.qtyOk === null || m.qty == null ? null : m.appQty - m.qty })),
      ...r.unknown.map(l => ({ ...l, st: 'unknown', appName: '', appPrice: null, appQty: null, priceOk: null, qtyOk: null, dPrice: null, dQty: null })),
      ...r.noSku.map(l => ({ ...l, st: 'nosku', appName: '', appPrice: null, appQty: null, priceOk: null, qtyOk: null, dPrice: null, dQty: null }))
    ];
    const matched = m => m.st === 'matched';
    const isOk = m => matched(m) && m.priceOk && m.qtyOk !== false;
    const skuOk = m => matched(m) && !m.link && !m.dup;   // relié à la main = SKU encore à corriger dans SumUp (par l'import) ; en double = à corriger aussi
    const lnk = { l: '🔗 SKU à corriger par l\'import', f: m => !!m.link }, dupF = { l: '⚠️ SKU en double', f: m => !!m.dup };
    const bad = '⚠️ À corriger', unk = { l: '❓ SKU inconnu dans l\'appli', f: m => m.st === 'unknown' }, nos = { l: '🏷️ Sans SKU dans SumUp', f: m => m.st === 'nosku' };
    const FS = {
      all: {
        issues: { l: bad, f: m => !isOk(m) || !!m.link || !!m.dup }, all: { l: 'Tout', f: () => true }, ok: { l: '✅ Identiques', f: m => isOk(m) && !m.link && !m.dup },
        dup: dupF, linked: lnk, price: { l: '💶 Prix différent', f: m => matched(m) && !m.priceOk }, qty: { l: '📦 Quantité différente', f: m => m.qtyOk === false }, unknown: unk, nosku: nos
      },
      sku: { issues: { l: bad, f: m => !skuOk(m) }, all: { l: 'Tout', f: () => true }, ok: { l: '✅ SKU reconnus', f: skuOk }, dup: dupF, linked: lnk, unknown: unk, nosku: nos },
      price: { issues: { l: bad, f: m => matched(m) && !m.priceOk }, all: { l: 'Tout', f: matched }, ok: { l: '✅ Identiques', f: m => matched(m) && !!m.priceOk } },
      stock: { issues: { l: bad, f: m => m.qtyOk === false }, all: { l: 'Tout', f: matched }, ok: { l: '✅ Identiques', f: m => m.qtyOk === true }, untracked: { l: '🚫 Suivi désactivé dans SumUp', f: m => matched(m) && !m.track } }
    };
    const F = FS[W];
    const cur = F[this.sumupFilter] ? this.sumupFilter : 'issues';
    const cols = { all: ['sku', 'price', 'stock'], sku: ['sku'], price: ['price'], stock: ['stock'] }[W], has = c => cols.includes(c);
    const sortOk = ['name', 'meat', 'fmt'].concat(has('sku') ? ['sku'] : [], has('price') ? ['dPrice'] : [], has('stock') ? ['dQty'] : []);
    const sortK = sortOk.includes(this.sumupSort) ? this.sumupSort : 'name';
    all.forEach(m => { m.meat = m.appType || this._sumupCatOf(m); m.fmt = this._fmtKey(m.variant); });
    const meatK = v => this._sumupGroupKey(v);
    const q = U.normSearch(this.sumupQ || '').trim();
    const base = all.filter(F[cur].f);
    const meats = [...new Map(base.map(m => [meatK(m.meat), m.meat])).entries()].sort((a, b) => U.sortFr(a[1], b[1]));
    const fmts = [...new Set(base.filter(m => this.sumupMeat === 'all' || meatK(m.meat) === this.sumupMeat).map(m => m.fmt))].sort((a, b) => this._fmtCmp(a, b));
    const cnt = (f) => base.filter(f).length;
    const meatOpts = [{ v: 'all', l: `Toutes les viandes (${base.length})` }].concat(meats.map(([k, l]) => ({ v: k, l: `${l} (${cnt(m => meatK(m.meat) === k)})` })));
    const fmtOpts = [{ v: 'all', l: 'Tous les formats' }].concat(fmts.map(f => ({ v: f, l: f === '—' ? '— (sans variante)' : f })));
    const key = {
      meat: m => m.meat || '', fmt: m => m.fmt,
      name: m => m.name + ' ' + m.variant, sku: m => m.sku || '', price: m => m.price, appPrice: m => m.appPrice,
      dPrice: m => m.dPrice, qty: m => m.track ? m.qty : null, appQty: m => m.appQty, dQty: m => m.dQty
    }[sortK] || (m => m.name);
    const dir = this.sumupSortDir === 'desc' ? -1 : 1;
    const sorted = base
      .filter(m => this.sumupMeat === 'all' || meatK(m.meat) === this.sumupMeat)
      .filter(m => this.sumupFmt === 'all' || m.fmt === this.sumupFmt)
      .filter(m => !q || U.has(m.name + ' ' + m.variant + ' ' + (m.sku || '') + ' ' + (m.appName || ''), q))
      .sort((a, b) => {
        const x = key(a), y = key(b);
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        const c = sortK === 'fmt' ? this._fmtCmp(x, y) : (typeof x === 'number' ? x - y : U.sortFr(String(x), String(y)));
        return c * dir || U.sortFr(a.name, b.name) || this._fmtCmp(a.fmt, b.fmt);
      });
    // Un bloc par produit : il prend la place de sa 1re ligne dans l'ordre du tri, ses autres lignes le suivent.
    const gmap = new Map();
    sorted.forEach(m => { const k = U.normSearch(m.name) + '|' + meatK(m.meat); let g = gmap.get(k); if (!g) gmap.set(k, g = { m, rows: [] }); g.rows.push(m); });
    const groups = [...gmap.values()], rows = groups.flatMap(g => g.rows);
    const yes = '<span class="pos">✅</span>', no = '<span class="neg">❌</span>';
    const selN = this._sumupSelCount();
    const visKeys = rows.filter(m => m.st === 'matched').map(m => m.sku.toUpperCase());
    this._sumupVisible = visKeys;
    const th = (k, l, num) => `<th class="sortable${sortK === k ? ' active' : ''}${num ? ' num' : ''}" style="cursor:pointer;" onclick="Woo._setSumupSort('${k}')">${l} ${sortK === k ? (this.sumupSortDir === 'asc' ? '▲' : '▼') : '⇕'}</th>`;
    const sgn = v => (v > 0 ? '+' : '') ;
    const widths = { all: [28, 13, 10, 17, 16, 16], sku: [36, 20, 16, 28], price: [36, 20, 16, 28], stock: [36, 20, 16, 28] }[W];
    const nCols = 3 + cols.length;
    const dupTxt = m => m.dup ? `<div class="sub" style="color:var(--alerte);">⚠️ SKU en double : aussi sur « ${U.esc(m.dup.others.join(' · '))} »</div>` : '';
    const body = groups.map((g, gi) => `<tbody class="sumup-prod${gi % 2 ? ' alt' : ''}">` + g.rows.map((m, i) => {
      const same = m.appName && U.normSearch(m.appName) === U.normSearch(m.name + (m.variant ? ' — ' + m.variant : ''));
      const price = m.priceOk === null
        ? `<span class="muted">SumUp ${m.price != null ? U.eur(m.price) : '—'}</span>`
        : m.priceOk ? `${yes} ${U.eur(m.price)}`
        : `<span class="neg">❌ ${m.dPrice != null ? sgn(m.dPrice) + U.eur(m.dPrice) : ''}</span><div class="sub">SumUp ${m.price != null ? U.eur(m.price) : '—'} · appli ${U.eur(m.appPrice)}</div>`;
      const qty = !m.track ? '<span class="muted">non suivi</span>'
        : m.qtyOk === null ? `<span class="muted">SumUp ${m.qty != null ? U.qty(m.qty) : '—'}</span>`
        : m.qtyOk ? `${yes} ${U.qty(m.qty)}`
        : `<span class="neg">❌ ${sgn(m.dQty)}${U.qty(m.dQty)}</span><div class="sub">SumUp ${U.qty(m.qty)} · évén. ${U.qty(m.appQty)}</div>`;
      return `<tr>${i === 0 ? `<td rowspan="${g.rows.length}"><b>${U.esc(g.m.name)}</b></td><td rowspan="${g.rows.length}"><span class="muted">${U.esc(g.m.meat || '—')}</span></td>` : ''}
          <td><b>${U.esc(m.fmt)}</b>${m.appName && !same ? `<div class="sub">appli : ${U.esc(m.appName)}</div>` : ''}</td>
          ${has('sku') ? `<td>${m.st === 'nosku' ? '<span class="badge warn">sans SKU</span>' : m.st === 'unknown' ? `<span class="badge bad" title="${m.taken ? 'Ce SKU est celui d\'un produit de l\'appli relié à une autre ligne SumUp' : m.dup ? 'SKU en double dans SumUp : ce n\'est pas la ligne reconnue' : 'SKU inconnu dans l\'appli'}">${U.esc(m.sku)}</span>${m.taken ? '<div class="sub">⚠️ SKU pris par une autre ligne reliée</div>' : ''}${dupTxt(m)}` : m.link ? `<span class="sku-txt">${U.esc(m.sku)}</span><div class="sub">🔗 SumUp : ${m.link.sumupSku ? U.esc(m.link.sumupSku) : 'vide'} → remplacé par l'appli</div><div style="margin-top:4px;"><button class="btn-ghost btn-sm fit" data-sku="${U.esc(m.sku)}" onclick="Woo.unlinkSumup(this.dataset.sku)">Délier</button></div>` : `<span class="sku-txt">${U.esc(m.sku)}</span>${dupTxt(m)}`}${(m.st === 'unknown' || m.st === 'nosku') && m.id ? `<div style="margin-top:4px;"><button class="btn-ghost btn-sm fit" data-id="${U.esc(m.id || '')}" onclick="Woo.openSumupLink('line', this.dataset.id)">🔗 Relier à l'appli</button></div>` : ''}</td>` : ''}
          ${has('price') ? `<td>${price}</td>` : ''}
          ${has('stock') ? `<td>${qty}</td>` : ''}
        </tr>`;
    }).join('') + '</tbody>').join('') || `<tbody><tr><td colspan="${nCols}" class="muted">${cur === 'issues' ? 'Rien à corriger 🎉' : 'Aucune ligne.'}</td></tr></tbody>`;
    const help = [has('price') ? 'Prix : ✅ = identique ; ❌ = écart (« + » = l\'appli est plus chère que SumUp), avec les deux prix en dessous.' : '', has('stock') ? 'Quantité : comparée à ton <b>stock événement</b>, seulement si le suivi de stock est activé dans SumUp (« + » = l\'appli a plus que SumUp).' : '', has('price') || has('stock') ? 'Clique « Prix TTC » ou « Quantité » pour trier par écart.' : 'Ici, seuls les SKU sont comparés : un article est « reconnu » quand son SKU existe dans l\'appli.'].filter(Boolean).join(' ');
    const needV2 = this._sumup.v !== 2 ? `<div class="card" style="border-left:4px solid var(--warn);margin:10px 0 0;padding:10px 14px;">🔗 <b>Pour relier des articles, choisis à nouveau ton export SumUp</b> (le bouton « Choisir un fichier » ci-dessus ; le même fichier convient). Une seule fois : l'ancienne copie gardée en mémoire ne contient pas les identifiants des articles.</div>` : '';
    return `
      ${needV2}${this._sumupDupAlert(r)}${this._catSeg()}${this._uncatAlert(r.uncat)}
      ${this._whatSeg(W, 'Woo._setSumupWhat')}
      <div class="sumup-filters mt">
        ${Object.entries(F).filter(([k, o]) => !['linked', 'dup'].includes(k) || all.some(o.f)).map(([k, o]) => `<button class="${cur === k ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Woo._setSumupFilter('${k}')">${o.l} <b>(${all.filter(o.f).length})</b></button>`).join('')}
      </div>
      <div class="frow mt" style="gap:8px;flex-wrap:wrap;align-items:center;">
        <input id="woo_sumup_q" style="flex:1 1 240px;" placeholder="Rechercher un article, un SKU…" value="${U.esc(this.sumupQ || '')}" oninput="Woo._setSumupQ(this.value)">
        <div style="flex:0 1 220px;min-width:170px;">${U.customSelect({ value: this.sumupMeat, options: meatOpts, onPick: 'Woo._setSumupMeat' })}</div>
        <div style="flex:0 1 180px;min-width:150px;">${U.customSelect({ value: this.sumupFmt, options: fmtOpts, onPick: 'Woo._setSumupFmt' })}</div>
        <span class="muted" style="flex:0 0 auto;">${rows.length} ligne(s)</span>
        <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Woo.exportSumupIssues()" title="Toutes les différences (SKU, prix et quantité), quel que soit le choix « Je compare »">⬇ Liste à corriger (CSV)</button>
      </div>
      <table class="sumup-table mt">
        <colgroup>${widths.map(w => `<col style="width:${w}%">`).join('')}</colgroup>
        <thead><tr>${th('name', 'Article')}${th('meat', 'Viande')}${th('fmt', 'Format')}${has('sku') ? th('sku', 'SKU') : ''}${has('price') ? th('dPrice', 'Prix TTC') : ''}${has('stock') ? th('dQty', 'Quantité') : ''}</tr></thead>
        ${body}
      </table>
      <p class="muted help">${help}</p>
      ${W === 'all' || W === 'sku' ? this._renderSumupPairs(r) : ''}`;
  },
  _renderCompare() {
    const c = this._cmp, W = ['sku', 'price', 'stock'].includes(this.cmpWhat) ? this.cmpWhat : 'all';
    const opts = this._opts(this.lines().filter(l => l.sku));   // aussi : remet à jour la liste des formats utilisée par _pass
    const all = [
      ...c.matched.map(m => ({ ...m, st: 'matched', priceOk: m.priceDiff == null ? null : Math.abs(m.priceDiff) < 0.01, stockOk: m.stockDiff == null ? null : m.stockDiff === 0 })),
      ...c.appOnly.map(m => ({ ...m, st: 'appOnly', priceOk: null, stockOk: null, priceDiff: null, stockDiff: null })),
      ...c.siteOnly.map(m => ({ ...m, st: 'siteOnly', priceOk: null, stockOk: null, priceDiff: null, stockDiff: null }))
    ].filter(m => this._pass(m));
    const matched = m => m.st === 'matched';
    const skuOk = m => matched(m) && !m.link && !m.dup, isOk = m => skuOk(m) && m.priceOk !== false && m.stockOk !== false;
    const lnk = { l: '🔗 UGS à corriger sur le site', f: m => !!m.link }, dupF = { l: '⚠️ SKU en double', f: m => !!m.dup };
    const bad = '⚠️ À corriger', app = { l: '⚠️ Absent du site', f: m => m.st === 'appOnly' }, site = { l: 'ℹ️ Absent de l\'appli', f: m => m.st === 'siteOnly' };
    const FS = {
      all: { issues: { l: bad, f: m => !isOk(m) }, all: { l: 'Tout', f: () => true }, ok: { l: '✅ Identiques', f: isOk }, dup: dupF, linked: lnk, price: { l: '💶 Prix différent', f: m => m.priceOk === false }, stock: { l: '📦 Stock différent', f: m => m.stockOk === false }, appOnly: app, siteOnly: site },
      sku: { issues: { l: bad, f: m => !skuOk(m) }, all: { l: 'Tout', f: () => true }, ok: { l: '✅ SKU reconnus', f: skuOk }, dup: dupF, linked: lnk, appOnly: app, siteOnly: site },
      price: { issues: { l: bad, f: m => m.priceOk === false }, all: { l: 'Tout', f: matched }, ok: { l: '✅ Identiques', f: m => m.priceOk === true } },
      stock: { issues: { l: bad, f: m => m.stockOk === false }, all: { l: 'Tout', f: matched }, ok: { l: '✅ Identiques', f: m => m.stockOk === true } }
    };
    const F = FS[W];
    const cur = F[this.cmpFilter] ? this.cmpFilter : 'issues';
    const cols = { all: ['sku', 'price', 'stock'], sku: ['sku'], price: ['price'], stock: ['stock'] }[W], has = k => cols.includes(k);
    const sortOk = ['name'].concat(has('sku') ? ['sku'] : [], has('price') ? ['dPrice'] : [], has('stock') ? ['dStock'] : []);
    const sortK = sortOk.includes(this.cmpSort) ? this.cmpSort : 'name';
    const q = U.normSearch(this.cmpQ || '').trim();
    const key = { name: m => m.name || '', sku: m => m.sku || '', dPrice: m => m.priceDiff, dStock: m => m.stockDiff }[sortK] || (m => m.name || '');
    const dir = this.cmpSortDir === 'desc' ? -1 : 1;
    const split = n => { const s = String(n || '—'), i = s.lastIndexOf(' — '); return i < 0 ? { p: s, v: '' } : { p: s.slice(0, i), v: s.slice(i + 3) }; };
    const sorted = all.filter(F[cur].f)
      .filter(m => !q || U.has((m.name || '') + ' ' + (m.sku || ''), q))
      .sort((a, b) => {
        const x = key(a), y = key(b);
        if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
        return (typeof x === 'number' ? x - y : sortK === 'name' ? this._nameCmp(x, y) : U.sortFr(String(x), String(y))) * dir || this._nameCmp(a.name, b.name);
      });
    // Un bloc par produit (nom écrit une fois, formats dessous) : il prend la place de sa 1re ligne dans l'ordre du tri.
    const shown = sorted.slice(0, 400), gmap = new Map();
    shown.forEach(m => {
      const fam = m.kind === 'Accessoires' && m.gid && m.gname;   // accessoire : produit = famille « Longe 20mm », format = longueur / taille
      const sp = fam ? { p: m.gname, v: m.vlabel || '' } : split(m.name); m._sp = sp;
      const k = fam ? 'g' + m.gid : U.normSearch(sp.p); let g = gmap.get(k); if (!g) gmap.set(k, g = { p: sp.p, rows: [] }); g.rows.push(m);
    });
    const groups = [...gmap.values()];
    groups.forEach(g => { if (g.rows[0].kind === 'Accessoires' && g.rows[0].gid && sortK === 'name') g.rows.sort((a, b) => ((a.srank || 0) - (b.srank || 0)) || ((a.len || 0) - (b.len || 0)) || ((a.perso || 0) - (b.perso || 0))); });
    const yes = '<span class="pos">✅</span>';
    const sgn = v => (v > 0 ? '+' : '');
    const th = (k, l) => `<th class="sortable${sortK === k ? ' active' : ''}" style="cursor:pointer;" onclick="Woo._setCmpSort('${k}')">${l} ${sortK === k ? (this.cmpSortDir === 'asc' ? '▲' : '▼') : '⇕'}</th>`;
    const cell = (ok, d, a, b, fmt, lb) => ok === null ? '<span class="muted">—</span>'
      : ok ? `${yes} ${fmt(a)}`
      : `<span class="neg">❌ ${d != null ? sgn(d) + fmt(d) : ''}</span><div class="sub">site ${b != null ? fmt(b) : '—'} · ${lb} ${fmt(a)}</div>`;
    const widths = { all: [32, 14, 22, 16, 16], sku: [40, 20, 40], price: [44, 20, 36], stock: [44, 20, 36] }[W];
    const body = groups.map((g, gi) => `<tbody class="sumup-prod${gi % 2 ? ' alt' : ''}">` + g.rows.map((m, i) => `<tr>${i === 0 ? `<td rowspan="${g.rows.length}"><b>${U.esc(g.p)}</b></td>` : ''}
          <td>${m._sp.v ? `<b>${U.esc(m._sp.v)}</b>` : '<span class="muted">—</span>'}${m.st === 'appOnly' ? `<div class="sub">⚠️ absent du site — créerait un doublon à l'export</div><div class="mt" style="margin-top:4px;"><button class="btn-ghost btn-sm fit" data-sku="${U.esc(m.sku)}" onclick="Woo.openLink(this.dataset.sku)">🔗 Relier à une fiche du site</button></div>` : m.link ? `<div class="sub">🔗 fiche #${U.esc(m.link.id)} · UGS du site : ${m.link.siteSku ? U.esc(m.link.siteSku) : 'vide'}</div><div style="margin-top:4px;"><button class="btn-ghost btn-sm fit" data-sku="${U.esc(m.sku)}" onclick="Woo.unlink(this.dataset.sku)">Délier</button></div>` : m.st === 'siteOnly' ? '<div class="sub">ℹ️ sur le site, absent de l\'appli</div>' : ''}${m.dup ? `<div class="sub" style="color:var(--alerte);">⚠️ SKU en double sur le site : aussi sur « ${U.esc(m.dup.others.join(' · '))} »</div>` : ''}</td>
          ${has('sku') ? `<td><span class="sku-txt">${U.esc(m.sku)}</span></td>` : ''}
          ${has('price') ? `<td>${cell(m.priceOk, m.priceDiff, m.appPrice, m.sitePrice, U.eur, 'appli')}</td>` : ''}
          ${has('stock') ? `<td>${cell(m.stockOk, m.stockDiff, m.appStock, m.siteStock, U.qty, 'appli')}</td>` : ''}
        </tr>`).join('') + '</tbody>').join('') || `<tbody><tr><td colspan="${2 + cols.length}" class="muted">${cur === 'issues' ? 'Rien à corriger 🎉' : 'Aucune ligne.'}</td></tr></tbody>`;
    return `
      ${this._siteDupAlert(c)}
      ${c.siteRows === 0 ? '<p class="warn-txt mt">Aucune ligne du site n\'a de SKU (UGS) rempli — impossible de comparer tant que tu n\'as pas mis les SKU sur ton site.</p>' : ''}
      ${this._whatSeg(W, 'Woo._setCmpWhat')}
      ${this._catSeg()}
      <div class="grid c3 mt">${this._ctrls(opts).join('')}</div>
      <div class="sumup-filters mt">
        ${Object.entries(F).filter(([k, o]) => !['linked', 'dup'].includes(k) || all.some(o.f)).map(([k, o]) => `<button class="${cur === k ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Woo._setCmpFilter('${k}')">${o.l} <b>(${all.filter(o.f).length})</b></button>`).join('')}
        ${c.siteNoSku ? `<span class="muted" style="align-self:center;font-size:.82rem;">· ${c.siteNoSku} ligne(s) du site sans SKU (non comparables)</span>` : ''}
      </div>
      <div class="frow mt" style="gap:8px;flex-wrap:wrap;align-items:center;">
        <input id="woo_cmp_q" style="flex:1 1 240px;" placeholder="Rechercher un produit, un SKU…" value="${U.esc(this.cmpQ || '')}" oninput="Woo._setCmpQ(this.value)">
        <span class="muted" style="flex:0 0 auto;">${sorted.length} ligne(s)</span>
      </div>
      <table class="sumup-table mt">
        <colgroup>${widths.map(w => `<col style="width:${w}%">`).join('')}</colgroup>
        <thead><tr>${th('name', 'Produit')}<th>Format</th>${has('sku') ? th('sku', 'SKU') : ''}${has('price') ? th('dPrice', 'Prix TTC') : ''}${has('stock') ? th('dStock', 'Stock') : ''}</tr></thead>
        ${body}
      </table>
      ${sorted.length > 400 ? `<p class="muted">… et ${sorted.length - 400} autres (affine avec la recherche).</p>` : ''}
      <p class="muted help">${has('price') || has('stock') ? 'Prix / Stock : ✅ = identique ; ❌ = écart (« + » = l\'appli a plus que le site : prix plus cher / plus de stock), avec les deux valeurs en dessous. Clique « Prix TTC » ou « Stock » pour trier par écart.' : 'Ici, seuls les SKU sont comparés : un produit est « reconnu » quand son SKU existe à la fois dans l\'appli et sur le site.'}</p>`;
  },
  /* Met à jour le compteur + le libellé du bouton d'export SANS re-render
     (snappy quand on coche/décoche plein de cases). */
  _refreshSelInfo() {
    const linked = this.lines().filter(l => l.sku && this._inCat(this._k(l)));
    const n = this._selCount(linked);
    const info = document.getElementById('woo_selinfo');
    if (info) info.textContent = n > 0 ? `${n} produit(s) sélectionné(s)` : 'Aucune sélection → tout est exporté';
    const btn = document.getElementById('woo_export_btn');
    if (btn) btn.textContent = n > 0 ? `⬇️ Exporter le CSV (${n} sélectionné(s))` : `⬇️ Exporter le CSV pour WooCommerce (${linked.length} produits liés)`;
  },

  /* Construit les lignes exportables { sku, name, price, stock, kind }, clé = SKU.
     Mastication (stockM pour stock/prix/SKU + catalogM pour affiner le prix) + accessoires ayant un SKU (catalogA).
     Matières / consommables volontairement exclus (voir plus bas). */
  lines() {
    const map = new Map();
    const add = (sku, name, price, stock, kind, meat, extra) => {
      sku = String(sku || '').trim(); if (!sku) return;
      const ex = map.get(sku);
      if (ex) {
        if (stock !== null) ex.stock = (ex.stock === null ? 0 : ex.stock) + stock;
        if (price) ex.price = price;
        if (!ex.meat && meat) ex.meat = meat;
      } else map.set(sku, { sku, name, price: price || 0, stock, kind, meat: meat || '', ...(extra || {}) });
    };
    // Variantes NON UTILISÉES (décochées dans Prix mastication, ex. « Lot de 3 pc » qu'Antho ne vend pas) : jamais exportées ni comparées (2026-10-17)
    const offSku = this._offSkus();
    // 1) Stock mastication (quantités + prix de vente + SKU)
    Store.state.stockM.forEach(p => p.variants.forEach(v => {
      if (v.mode === 'vrac') return;
      if (this._offStock(p, v) || offSku.has(String(v.sku || '').trim().toUpperCase())) return;
      const _sv = Stock.stockVar(p, v), _n = Stock.isVirtual(p, v) ? Stock.packQtyOf(v) : 1;   // lot sans stock propre : stock principal ÷ N
      const stock = Math.floor(_sv.lots.reduce((a, l) => a + U.num(l.qtyGeneral) + (this.stockScope === 'both' ? U.num(l.qtyEvent) : 0), 0) / _n);
      add(v.sku, `${p.name} — ${Pricing.labelVariant(v)}`, U.num(v.priceTTC), stock, 'Mastication', p.meatType || '');
    }));
    // 2) Catalogue prix : si un SKU y est renseigné, il fournit/affine le prix calculé
    Store.state.catalogM.forEach(p => {
      const base = Pricing.baseUnitCost(p); const na = (p.variants||[]).filter(v=>v.enabled!==false).length; let idx = 0;
      (p.variants || []).forEach(v => {
        const on = v.enabled !== false; const c = Pricing.variantCalc(p, v, on ? idx : 0, base, na); if (on) idx++;
        if (v.sku && on) add(v.sku, `${p.name} — ${Pricing.labelVariant(v)}`, c.priceTTC, null, 'Mastication', p.meatType || '');
      });
    });
    // 3) ACCESSOIRES (catalogA) : seulement ceux qui ont un SKU (Antho 2026-10-17 : ses fiches accessoires reçoivent leurs SKU un par un, la catégorie
    //    « Accessoires » du filtre les isole). Stock = stock fini (général + événement). Avant cette date ils étaient exclus faute de SKU.
    // Matières premières et consommables ne sont pas des produits vendus → jamais inclus.
    Accessoires.crafted().forEach(a => {
      const width = a.mainWidth || (Array.isArray(a.strapWidths) && a.strapWidths[0]) || '';
      add(a.sku, a.name, Pricing.accCalc(a).priceTTC, U.num(a.stockGeneral) + U.num(a.stockEvent), 'Accessoires', '', { accCat: a.category || '', width: String(width || ''), bicolor: !!a.bicolor,
        gid: a.groupId || '', gname: a.groupName || '', vlabel: a.sizeLabel ? String(a.sizeLabel) : (Accessoires._lenOf(a) > 0 ? U.qty(Accessoires._lenOf(a)) + 'm' : ''), sized: !!a.sizeLabel,
        srank: Accessoires._sizeRank(a), len: Accessoires._lenOf(a), perso: Accessoires._persoRank(a) });
    });
    return [...map.values()].sort((a, b) => this._grpOrder(a, b));
  },

  render() {
    this._restoreSumupCache();
    this._restoreSiteCache();
    this._cmp = this._buildCmp();   // recalculé avec les données actuelles de l'appli (SKU, prix, stock corrigés entre-temps)
    U.syncFilters('woo', this.filters);
    const all = this.lines();
    const linked = all.filter(l => l.sku);
    const missing = all.filter(l => !l.sku);
    const opts = this._opts(linked);
    const visible = this._visible(linked);
    // Tri cliquable (même patron que Stock : clic = trie, re-clic = inverse le sens)
    const f = this.filters;
    const dir = f.sortDir === 'desc' ? -1 : 1;
    visible.sort((a, b) => {
      let r;
      if (f.sort === 'price') r = (a.price || 0) - (b.price || 0);
      else if (f.sort === 'stock') r = ((a.stock ?? -1)) - ((b.stock ?? -1));
      else if (f.sort === 'excluded') r = (this._isExcluded(a.sku) ? 1 : 0) - (this._isExcluded(b.sku) ? 1 : 0);
      else if (f.sort === 'name') r = this._nameCmp(a.name, b.name);
      else r = U.sortFr(a[f.sort] || '', b[f.sort] || '');
      return r * dir;
    });
    const sortHead = (key, label) => `<span class="sortable ${f.sort === key ? 'active' : ''}" onclick="Woo.setSort('${key}')">${label} ${f.sort === key ? (f.sortDir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
    const inCat = linked.filter(l => this._inCat(this._k(l)));   // le « tout est exporté » est borné par la catégorie choisie
    const selCount = this._selCount(inCat.filter(l => !this._isExcluded(l.sku)));
    const allVisSel = visible.length > 0 && visible.filter(l => !this._isExcluded(l.sku)).every(l => this._sel[l.sku]) && visible.some(l => !this._isExcluded(l.sku));
    const excludedCount = inCat.filter(l => this._isExcluded(l.sku)).length;
    const exportable = inCat.length - excludedCount;
    const exportLabel = selCount > 0 ? `⬇️ Exporter le CSV (${selCount} sélectionné(s))` : `⬇️ Exporter le CSV pour WooCommerce (${exportable} produit${exportable > 1 ? 's' : ''})`;

    App.mount(`
      <div class="view-title"><h1>Synchro — Site & SumUp</h1><span class="sub">liaison par SKU · prix & stock</span></div>

      <div>
        <p class="muted help mb0" data-help-anchor=".view-title h1">Le <b>SKU</b> (référence unique d'un produit sur ton site) relie chaque produit de l'app à sa fiche WooCommerce. L'app calcule le <b>prix de vente</b> et le <b>stock</b> ; tu les envoies vers le site via un fichier CSV que WooCommerce applique aux produits existants (il les retrouve par leur SKU). Ton <b>coût d'achat et tes marges restent dans l'app</b> — WooCommerce n'en a pas besoin.</p>
      </div>


      <div class="seg-stack">
        ${U.seg([['site', '🌐 Site (WooCommerce)'], ['sumup', '💳 SumUp']].map(([k, l]) => ({ l, on: this._target() === k, js: `Woo.setTarget('${k}')` })), { full: true, label: 'Destination' })}
        <div style="display:flex;justify-content:${this._target() === 'sumup' ? 'flex-end' : 'flex-start'};">${U.seg([['export', '📤 Exporter'], ['compare', '🔄 Comparer']].map(([k, l]) => ({ l, on: this._mode() === k, js: `Woo.setMode('${k}')` })), { label: 'Action' })}</div>
      </div>

      ${this.tab === 'export' ? `      <div class="card">
        <h2>⚙️ Ce que j'exporte</h2>
        <p class="muted" style="margin-top:0;margin-bottom:12px;">Le stock envoyé au site = <b>la totalité</b> (général + événement) — c'est l'ensemble de ta marchandise que ton site met en ligne.</p>
        <div class="frow" style="gap:18px;flex-wrap:wrap;margin-bottom:4px;">
          <label class="opt-check"><input type="checkbox" ${this.includePrice ? 'checked' : ''} onchange="Woo.includePrice=this.checked"> Envoyer les prix (TTC public)</label>
          <label class="opt-check"><input type="checkbox" ${this.includeStock ? 'checked' : ''} onchange="Woo.includeStock=this.checked"> Envoyer les quantités de stock</label>
        </div>
        ${this._catSeg()}
        <div class="grid c${this.cat === 'A' ? 4 : 3} mt">
          <div class="fg"><label>Recherche</label><input id="woo_q" value="${U.esc(this.filters.q)}" placeholder="nom du produit ou SKU…" oninput="Woo._setSearch(this.value)"></div>
          ${this._ctrls(opts).join('')}
        </div>
        <div class="frow mt" style="gap:12px;align-items:center;flex-wrap:wrap;">
          <label class="ms-opt" style="flex:0 0 auto;"><input type="checkbox" ${allVisSel ? 'checked' : ''} onchange="Woo.selectAllVisible(this.checked)"> Tout sélectionner (${visible.length} affiché(s))</label>
          <span id="woo_selinfo" class="muted">${selCount > 0 ? `${selCount} produit(s) sélectionné(s)` : 'Aucune sélection → tout est exporté'}</span>
          ${excludedCount > 0 ? `<span class="tag" style="border-color:var(--alerte);">🚫 ${excludedCount} exclu(s) du site</span>` : ''}
          ${selCount > 0 ? `<button class="btn-ghost btn-sm" style="flex:0;" onclick="Woo.clearSel()">Vider la sélection</button>` : ''}
        </div>
        <div class="frow mt" style="gap:10px;align-items:center;flex-wrap:wrap;"><button id="woo_export_btn" class="btn-cta fit" onclick="Woo.exportCsv()">${exportLabel}</button><button class="btn-ghost btn-sm fit" onclick="Woo.showGuide()">📖 Guide d'import</button></div>
        <p class="muted help mt">Sur ton site : menu <b>Produits</b> (l'entrée à part, <u>pas</u> le menu WooCommerce) → <b>Tous les produits</b> → bouton <b>Importer</b> en haut de la page → choisir le fichier → cocher <b>« Mettre à jour les produits existants »</b>. WooCommerce retrouve chaque produit par son SKU.</p>
        <p class="pos mb0" style="margin-top:4px;">✓ Le fichier ne contient que <b>SKU + prix + stock</b> : tes <b>descriptions, catégories, étiquettes et images</b> sur le site ne sont <b>jamais touchées</b>.</p>
        <p class="muted help mb0" style="margin-top:4px;">Les colonnes sont au <b>format français de ton site</b> (UGS, Tarif régulier, Stock, En stock ?) → WooCommerce les reconnaît sans mapping manuel. <b>Fais un essai sur 2-3 produits d'abord</b> et vérifie que le prix affiché est bien le bon (ni ×100, ni ÷100).</p>
        <p class="muted help mb0" style="margin-top:4px;">Sont envoyés la <b>mastication</b> et les <b>accessoires qui ont un SKU</b> (choisis la catégorie au-dessus : sans sélection, « tout » = la catégorie affichée ; le stock d'un accessoire = son stock fini). Les <b>matières premières</b> et <b>consommables</b> ne sont <b>jamais</b> exportés ni comparés. Pour un produit mastication que tu gardes dans l'appli mais ne vends pas en ligne (événement-only, test…), clique <b>🚫</b> dans la colonne « Envoi site » : il sera <b>exclu définitivement</b> de l'export.</p>
      </div>

` : ''}

      ${this.tab === 'site' ? `      <div class="card">
        <h2>🔄 Comparer avec le site (import)</h2>
        <p class="muted help">Dépose l'export produits de ton site (le CSV WooCommerce, menu <b>Produits → Tous les produits → Exporter</b>) pour comparer <b>prix</b> et <b>stock</b> par SKU, et repérer les produits présents d'un seul côté. <b>Lecture seule</b> — aucune donnée n'est modifiée. Le fichier est <b>gardé en mémoire</b> dans ce navigateur : la comparaison se recalcule toute seule avec tes données actuelles (SKU, prix, stock corrigés), même après un rechargement ; ne redépose un fichier que pour <b>rafraîchir la référence</b> (nouvel export du site) : <b>dès que tu choisis le fichier, il est lu et comparé</b>, sans bouton.</p>
        <div class="frow" style="gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="file" id="woo_cmp_file" accept=".csv,text/csv" onchange="Woo.compareSite(this)">
          ${this._siteRef ? `<span class="muted" style="font-size:.8rem;">Référence : ${U.esc(this._siteRef.file)} (${new Date(this._siteRef.ts).toLocaleDateString('fr-FR')})</span><button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Woo.clearCompare()">Effacer</button>` : ''}
        </div>
        ${this._cmp ? this._renderCompare() : ''}
      </div>

` : ''}

      ${this.tab === 'sumupexp' ? `      <div class="card">
        <h2>📤 Export vers SumUp</h2>
        <p class="muted help">Choisis ici les produits de Touffu Gestion à envoyer à SumUp (ou à ne jamais envoyer avec 🚫 — c'est mémorisé). Aucun fichier n'est nécessaire pour trier : ton export d'articles SumUp (me.sumup.com → <b>Articles → Exporter</b>) n'est demandé qu'au moment de générer le fichier, une seule fois (il est ensuite gardé en mémoire).</p>
        ${this._renderSumupExport()}
      </div>

` : ''}

      ${this.tab === 'sumup' ? `      <div class="card">
        <h2>🔍 Comparer avec SumUp</h2>
        <p class="muted help">Dépose l'export d'articles SumUp (me.sumup.com → <b>Articles → Exporter</b>) pour comparer <b>prix</b> et <b>quantités</b> (stock événement) par SKU. <b>Lecture seule</b> — rien n'est modifié. Dès que tu choisis le fichier, il est lu et comparé.</p>
        <div class="frow" style="gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="file" id="woo_sumup_file" accept=".csv,text/csv" onchange="Woo.compareSumup(this)">
          ${this._sumup ? `<span class="muted" style="font-size:.8rem;">Référence : ${U.esc(this._sumup.file)}</span><button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Woo.clearSumup()">Effacer</button>` : ''}
        </div>
        ${this._sumup ? this._renderSumup() : ''}
      </div>

` : ''}

      ${this.tab === 'export' ? `      ${this._siteDupAlert((this._restoreSiteCache(), this._siteRef ? this._buildCmp() : null))}
      ${missing.length ? `<div class="card" style="border-left:4px solid var(--warn);">
        <h2>⚠️ ${missing.length} produit(s) sans SKU — à relier</h2>
        <p class="muted help">Ces produits ne seront pas envoyés tant qu'ils n'ont pas de SKU. Renseigne le même SKU que sur ta fiche WooCommerce (Prix mastication → Modifier → colonne SKU, ou Accessoires → Modifier).</p>
        <div class="table-wrap"><table><thead><tr><th class="col-name">Produit</th><th>Type</th></tr></thead>
          <tbody>${missing.map(l => `<tr><td class="col-name">${U.esc(l.name)}</td><td><span class="badge info">${l.kind}</span></td></tr>`).join('')}</tbody></table></div>
      </div>` : `<div class="card"><p class="pos">✓ Tous tes produits ont un SKU.</p></div>`}

      <div class="card">
        <h2>👁 Aperçu de l'export (${visible.length}${visible.length !== linked.length ? ` sur ${linked.length}` : ''} ligne(s))</h2>
        <div class="table-wrap"><table><thead><tr>
          <th style="width:34px;"><input type="checkbox" ${allVisSel ? 'checked' : ''} onchange="Woo.selectAllVisible(this.checked)" title="Tout sélectionner"></th>
          <th>${sortHead('sku', 'SKU')}</th><th class="col-name">${sortHead('name', 'Produit')}</th><th>${sortHead('meat', 'Type')}</th><th class="num">${sortHead('price', 'Prix TTC')}</th><th class="num">${sortHead('stock', 'Stock')}</th><th>${sortHead('excluded', 'Envoi site')}</th></tr></thead>
          <tbody>${this._previewRows(visible) || '<tr><td colspan="7" class="muted">Aucun produit ne correspond au filtre.</td></tr>'}</tbody></table>
          ${visible.length > 200 ? `<p class="muted">… et ${visible.length - 200} autres non affichés (affine la recherche pour les voir — « Tout sélectionner » couvre bien les ${visible.length}).</p>` : ''}</div>
      </div>

      <div class="card">
        <h2>🔄 Synchronisation automatique (plus tard)</h2>
        <p class="muted help mb0">L'export CSV ci-dessus est le moyen le plus sûr pour commencer. Pour une synchro automatique (l'app pousse prix et stock vers le site sans fichier), WooCommerce offre une API REST. Elle ne peut pas être appelée directement depuis cette app (les clés seraient exposées et le navigateur bloque ces appels) : il faut un petit relais côté serveur. Comme tu utilises déjà Supabase, ce relais peut être une « Edge Function » Supabase. C'est décrit dans le guide, section WooCommerce — à activer quand tu voudras. En attendant, l'export CSV fait le travail.</p>
      </div>` : ''}
    `);
    this._syncBoxes();
    this._syncSumupBoxes();
  },

  exportCsv() {
    // Les produits exclus du site (réglage persistant) ne sont JAMAIS exportés.
    const pending = this._pendingSkus();   // reliés à une fiche du site dont l'UGS n'est pas encore corrigé : leur ligne part avec l'ID de la fiche (un seul import met tout à jour)
    const inScope = this.lines().filter(l => l.sku && this._inCat(this._k(l)));   // « tout » = la catégorie choisie (Tous | Mastication | Accessoires)
    // Sélection active → on n'exporte QUE les produits cochés ; sinon tout. La sélection est comptée AVANT d'écarter les exclus / reliés à corriger :
    // sinon, si tous les produits cochés étaient écartés, le compte tombait à 0 et l'appli exportait TOUT le catalogue (incident du 2026-10-17 : 72 fiches du site mises à jour au lieu de 3).
    const selCount = this._selCount(inScope);
    const chosen = selCount > 0 ? inScope.filter(l => this._sel[l.sku]) : inScope;
    let linked = chosen.filter(l => !this._isExcluded(l.sku));
    if (!linked.length) {
      U.toast(selCount > 0 ? 'Aucun produit sélectionné à exporter (exclus du site ?).' : 'Aucun produit à exporter (tous sans SKU ou exclus).', true);
      return;
    }
    // En-têtes en FRANÇAIS, identiques à l'export natif du site d'Antho (WooCommerce FR :
    // UGS = SKU, Tarif régulier = prix, En stock ? = statut). Ainsi l'importateur WooCommerce
    // les reconnaît automatiquement (pas de mapping manuel de colonnes à faire).
    // Mode « avec ID » (Antho 2026-10-17 : un seul import qui met TOUT à jour) : dès qu'un produit de l'export est relié à une fiche du site dont l'UGS est à corriger,
    // CHAQUE ligne part avec l'ID / Type / Parent de sa fiche (export natif du site) : WooCommerce met alors à jour la fiche par son ID (UGS corrigé + prix + stock, sans doublon).
    // Les produits absents du site n'ont pas d'ID : ils ne sont pas exportés (ils créeraient des produits sans nom).
    let ids = null, skipped = 0, blocked = 0;
    if (linked.some(l => pending.has(l.sku))) {
      ids = this._idMap();
      const before = linked.length;
      linked = linked.filter(l => ids.has(l.sku));
      skipped = before - linked.length;
      if (!linked.length) { U.toast("Aucun des produits choisis n'est sur ton site (redépose l'export du site dans Comparer si ça vient de changer).", true); return; }
    }
    if (ids) {
      // WooCommerce refuse un UGS déjà porté par une AUTRE fiche : une fiche qui prend l'UGS d'une autre doit donc passer APRÈS elle dans le fichier (cas d'UGS échangés entre 2 fiches).
      const owner = new Map(this._siteRef.items.map(x => [x.sku, String(x.id)])), idOf = l => String(ids.get(l.sku).id), inExp = new Map(linked.map(l => [idOf(l), l]));
      const ordered = [], seen = new Set();
      const visit = l => { const id = idOf(l); if (seen.has(id)) return; seen.add(id); const o = owner.get(l.sku); if (o && o !== id && inExp.has(o)) visit(inExp.get(o)); ordered.push(l); };
      linked.forEach(visit);
      blocked = linked.filter(l => { const o = owner.get(l.sku); return o && o !== idOf(l) && !inExp.has(o); }).length;
      linked = ordered;
    }
    const head = ids ? ['ID', 'Type', 'UGS', 'Parent'] : ['UGS'];
    if (this.includePrice) head.push('Tarif régulier');
    if (this.includeStock) { head.push('Stock'); head.push('En stock ?'); }   // espace INSÉCABLE : celle de l'export du site, seule reconnue par l'importateur
    const rows = [head];
    linked.forEach(l => {
      const d = ids ? ids.get(l.sku) : null;
      const r = d ? [d.id, d.type, l.sku, d.parent] : [l.sku];
      // Prix : décimale VIRGULE (format FR, comme l'export du site). Tous les champs sont
      // mis entre guillemets plus bas, donc la virgule décimale ne casse pas le CSV.
      if (this.includePrice) r.push(l.price.toFixed(2).replace('.', ','));
      if (this.includeStock) {
        const q = l.stock === null ? '' : String(Math.round(l.stock));
        r.push(q);
        r.push(l.stock === null ? '' : (l.stock > 0 ? '1' : '0'));   // En stock ? : 1/0 comme le site
      }
      rows.push(r);
    });
    // Guillemets SEULEMENT si nécessaire (virgule, guillemet, saut de ligne) : un BOM suivi de « "UGS" » faisait lire le titre avec ses guillemets → colonne UGS non reconnue par l'importateur
    const q = c => { c = String(c); return /[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c; };
    const csv = rows.map(r => r.map(q).join(',')).join('\r\n');
    const fname = `woocommerce-touffu-${U.today()}.csv`;
    U.download(fname, '﻿' + csv, 'text/csv');
    U.toast(`CSV WooCommerce exporté : ${linked.length} produit(s)${selCount > 0 ? ' (sélection)' : ''}.${ids ? ' Les fiches reliées reçoivent aussi leur nouvel UGS.' : ''}${skipped ? ` ${skipped} produit(s) absent(s) du site non exporté(s) (ils créeraient des produits vides).` : ''}${blocked ? ` ⚠️ ${blocked} UGS sont encore portés par une autre fiche du site absente de l'export : coche aussi cette fiche, sinon WooCommerce refusera la ligne.` : ''}`);
    // Produits à contrôler sur le site après l'import : tous si ≤ 3, sinon 3 au hasard
    const pool = linked.slice(), pick = [];
    while (pick.length < Math.min(3, pool.length)) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    this._lastExport = { file: fname, n: linked.length, ids: !!ids, price: this.includePrice, stock: this.includeStock, sample: pick.map(l => ({ sku: l.sku, name: l.name, price: l.price, stock: l.stock })) };
    if (!this.guideOff()) setTimeout(() => this.showGuide(), 400);
  },

  /* ───── Guide d'import WooCommerce (Antho 2026-10-17) : s'ouvre après chaque export (sauf « ne plus afficher »), revoir via « 📖 Guide d'import » ─────
     Fenêtre qui reste ouverte (seul « Fermer » la ferme) pendant qu'Antho fait l'import sur son site dans un autre onglet. Étapes à cocher + valeurs attendues du dernier export. */
  guideOff() { try { return localStorage.getItem('touffu_wooGuideOff') === '1'; } catch (e) { return false; } },
  setGuideOff(on) { try { localStorage.setItem('touffu_wooGuideOff', on ? '1' : '0'); } catch (e) {} },
  showGuide() {
    const x = this._lastExport, step = (n, h) => `<label style="display:flex;gap:10px;align-items:flex-start;margin:0 0 12px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:.95rem;font-weight:400;color:var(--texte);"><input type="checkbox" style="margin-top:4px;flex:0 0 auto;"><span><b>${n}.</b> ${h}</span></label>`;
    const cols = (x && x.ids ? ['ID → ID', 'Type → Type', 'UGS → UGS', 'Parent → Parent'] : ['UGS → UGS']).concat(!x || x.price ? ['Tarif régulier → Tarif régulier'] : [], !x || x.stock ? ['Stock → Stock', 'En stock ? → En stock ?'] : []);
    const checks = x ? x.sample.map(s => `<li><b>${U.esc(s.name)}</b> (${U.esc(s.sku)}) : ${x.price ? U.eur(s.price) : ''}${x.price && x.stock && s.stock !== null ? ' · ' : ''}${x.stock && s.stock !== null ? 'stock ' + U.qty(s.stock) : ''}</li>`).join('') : '';
    U.modal({
      title: '📖 Guide d\'import sur ton site', wide: true, hideOk: true,
      body: `<p class="muted" style="margin-top:0;">Garde cette fenêtre ouverte, passe sur ton site (autre onglet) et coche chaque étape.</p>
        ${step(1, x ? `Le fichier <b>${U.esc(x.file)}</b> (${x.n} produit${x.n > 1 ? 's' : ''}) est enregistré dans tes Téléchargements.` : 'Exporte d\'abord ton fichier (bouton « Exporter le CSV »).')}
        ${step(2, 'Sur ton site : menu <b>Produits</b> (pas WooCommerce) → <b>Tous les produits</b> → bouton <b>Importer</b> en haut.')}
        ${step(3, 'Clique « Choisir un fichier », prends le fichier ci-dessus, <b>coche « Mettre à jour les produits existants »</b>, puis <b>Continuer</b>.')}
        ${step(4, `Écran « Mapper les champs » : chaque colonne de gauche doit avoir <b>le même nom à droite</b> :<br><span class="muted">${cols.join(' · ')}</span><br><b style="color:var(--alerte);">Si une ligne affiche « Ne pas importer » : ne lance pas l'import</b> (ferme, refais l'export, ou choisis le bon champ à la main).`)}
        ${step(5, 'Clique <b>Lancer l\'importation</b> et attends « Terminé ».')}
        ${step(6, `Contrôle : ouvre ${x && x.sample.length > 1 ? 'ces fiches' : 'la fiche'} sur le site${x && x.n > x.sample.length ? ' (quelques produits pris au hasard dans ton export)' : ''} :${checks ? `<ul style="margin:6px 0 0 18px;">${checks}</ul>` : ''}`)}
        ${step(7, 'Dernier pas : exporte à nouveau tes produits depuis le site (<b>Produits → Tous les produits → Exporter</b>), puis ici <b>Synchro → Site → Comparer → Rafraîchir la référence</b> : les produits envoyés doivent passer en ✅.')}
        <label class="opt-check" style="margin-top:6px;text-transform:none;letter-spacing:0;font-size:.9rem;"><input type="checkbox" ${this.guideOff() ? 'checked' : ''} onchange="Woo.setGuideOff(this.checked)"> Ne plus afficher ce guide après un export <span class="muted">(le bouton « 📖 Guide d'import » le rouvre)</span></label>`
    });
  }
};
