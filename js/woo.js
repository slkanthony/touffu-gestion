/* ============================================================
   WOOCOMMERCE — pont avec le site touffu-shop.com
   Le SKU est la clé commune entre l'app et WooCommerce.
   L'app calcule prix de vente (public TTC) et stock ; on
   exporte un CSV que l'importateur natif de WooCommerce
   applique aux produits existants (matching par SKU).
   Le coût d'achat reste dans l'app (Woo ne le gère pas).
   ============================================================ */
const Woo = {
  stockScope: 'both',   // 'general' | 'both' — figé à 'both' : le site regroupe la totalité du stock
  includePrice: true,
  includeStock: true,

  /* Filtres (recherche + type de viande) + sélection par produit — pour n'exporter
     que certains produits (test sur 2-3, ou mise à jour ciblée). Même patron que
     Stock (filtres) et Revente pro (sélection par cases). Clé de sélection = SKU. */
  filters: { q: '', meat: 'all', sort: 'name', sortDir: 'asc' },
  _sel: {},
  _setSearch(v) { this.filters.q = v; this.render(); U.refocus('woo_q'); },
  _setMeat(v) { this.filters.meat = v; this.render(); },
  setSort(key) {
    if (this.filters.sort === key) this.filters.sortDir = this.filters.sortDir === 'asc' ? 'desc' : 'asc';
    else { this.filters.sort = key; this.filters.sortDir = 'asc'; }
    this.render();
  },
  _visible(linked) {
    const q = (this.filters.q || '').toLowerCase().trim();
    const meat = this.filters.meat;
    return linked.filter(l => {
      if (meat !== 'all' && (l.meat || '') !== meat) return false;
      if (q && !((l.name || '').toLowerCase().includes(q) || (l.sku || '').toLowerCase().includes(q))) return false;
      return true;
    });
  },
  _selCount(linked) { return linked.filter(l => this._sel[l.sku]).length; },
  toggleSel(sku, checked) { this._sel[sku] = !!checked; this._refreshSelInfo(); },
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
  compareSite() {
    const file = document.getElementById('woo_cmp_file')?.files[0];
    if (!file) { U.toast('Choisis d\'abord le fichier CSV exporté depuis ton site.', true); return; }
    const reader = new FileReader();
    reader.onload = () => {
      let rows; try { rows = this._parseCSV(reader.result); } catch (e) { U.toast('CSV illisible : ' + e.message, true); return; }
      if (!rows.length) { U.toast('Fichier vide.', true); return; }
      const head = rows[0];
      const iSku = this._cmpCol(head, ['UGS', 'SKU', 'sku']);
      const iName = this._cmpCol(head, ['Nom', 'Name', 'name']);
      const iPrice = this._cmpCol(head, ['Tarif régulier', 'Regular price', 'regular_price']);
      const iStock = this._cmpCol(head, ['Stock', 'stock']);
      if (iSku < 0) { U.toast('Colonne UGS/SKU introuvable dans ce fichier.', true); return; }
      const num = (v) => { const n = parseFloat(String(v || '').replace(',', '.').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : null; };
      const site = new Map(); let siteNoSku = 0;
      rows.slice(1).filter(r => r.length > 1).forEach(r => {
        const sku = (r[iSku] || '').trim();
        if (!sku) { siteNoSku++; return; }
        site.set(sku, { sku, name: iName >= 0 ? r[iName] : '', price: iPrice >= 0 ? num(r[iPrice]) : null, stock: iStock >= 0 ? num(r[iStock]) : null });
      });
      const app = new Map();
      this.lines().filter(l => l.sku).forEach(l => app.set(l.sku, l));
      const matched = [], appOnly = [], siteOnly = [];
      app.forEach((l, sku) => {
        const s = site.get(sku);
        if (!s) { appOnly.push({ sku, name: l.name }); return; }
        const priceDiff = (l.price != null && s.price != null) ? +(l.price - s.price).toFixed(2) : null;
        const stockDiff = (l.stock != null && s.stock != null) ? (l.stock - s.stock) : null;
        matched.push({ sku, name: l.name, appPrice: l.price, sitePrice: s.price, priceDiff, appStock: l.stock, siteStock: s.stock, stockDiff });
      });
      site.forEach((s, sku) => { if (!app.has(sku)) siteOnly.push({ sku, name: s.name }); });
      this._cmp = { siteRows: site.size, siteNoSku, matched, appOnly, siteOnly };
      this.render();
      U.toast(`Comparaison : ${matched.length} reliés, ${appOnly.length} appli seule, ${siteOnly.length} site seul.`);
    };
    reader.readAsText(file);
  },
  clearCompare() { this._cmp = null; this.render(); },
  _renderCompare() {
    const c = this._cmp;
    const priceDiffs = c.matched.filter(m => m.priceDiff != null && Math.abs(m.priceDiff) >= 0.01);
    const stockDiffs = c.matched.filter(m => m.stockDiff != null && m.stockDiff !== 0);
    const cap = (arr, n) => arr.length > n ? `<p class="muted">… et ${arr.length - n} autres.</p>` : '';
    const tbl = (rows, cols, cap0) => `<div class="table-wrap"><table><thead><tr>${cols.map(c => `<th${c.num ? ' class="num"' : ''}>${c.h}</th>`).join('')}</tr></thead><tbody>${rows.slice(0, 100).map(r => `<tr>${cols.map(c => `<td${c.num ? ' class="num"' : ''}>${c.f(r)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="muted">Aucun</td></tr>`}</tbody></table></div>${cap0}`;
    return `
      <div class="frow mt" style="gap:10px;flex-wrap:wrap;">
        <span class="tag">${c.matched.length} reliés (SKU des 2 côtés)</span>
        <span class="tag" style="border-color:var(--warn);">${priceDiffs.length} écart(s) de prix</span>
        <span class="tag" style="border-color:var(--warn);">${stockDiffs.length} écart(s) de stock</span>
        <span class="tag" style="border-color:var(--alerte);">${c.appOnly.length} dans l'appli, absent du site</span>
        <span class="tag">${c.siteOnly.length} sur le site, absent de l'appli</span>
        ${c.siteNoSku ? `<span class="tag muted">${c.siteNoSku} ligne(s) site sans SKU (non comparables)</span>` : ''}
      </div>
      ${c.siteRows === 0 ? '<p class="warn-txt">Aucune ligne du site n\'a de SKU (UGS) rempli — impossible de comparer tant que tu n\'as pas mis les SKU sur ton site.</p>' : ''}

      <details class="fold mt" open><summary><b>💶 Écarts de prix (${priceDiffs.length})</b></summary>
        ${tbl(priceDiffs.sort((a, b) => Math.abs(b.priceDiff) - Math.abs(a.priceDiff)), [
          { h: 'SKU', f: r => `<span class="tag">${U.esc(r.sku)}</span>` },
          { h: 'Produit', f: r => U.esc(r.name) },
          { h: 'Prix appli', num: true, f: r => U.eur(r.appPrice) },
          { h: 'Prix site', num: true, f: r => r.sitePrice != null ? U.eur(r.sitePrice) : '—' },
          { h: 'Écart', num: true, f: r => `<b class="${r.priceDiff > 0 ? 'pos' : 'neg'}">${r.priceDiff > 0 ? '+' : ''}${U.eur(r.priceDiff)}</b>` }
        ], cap(priceDiffs, 100))}
      </details>

      <details class="fold mt"><summary><b>📦 Écarts de stock (${stockDiffs.length})</b></summary>
        ${tbl(stockDiffs.sort((a, b) => Math.abs(b.stockDiff) - Math.abs(a.stockDiff)), [
          { h: 'SKU', f: r => `<span class="tag">${U.esc(r.sku)}</span>` },
          { h: 'Produit', f: r => U.esc(r.name) },
          { h: 'Stock appli', num: true, f: r => U.qty(r.appStock) },
          { h: 'Stock site', num: true, f: r => r.siteStock != null ? U.qty(r.siteStock) : '—' },
          { h: 'Écart', num: true, f: r => `<b class="${r.stockDiff > 0 ? 'pos' : 'neg'}">${r.stockDiff > 0 ? '+' : ''}${r.stockDiff}</b>` }
        ], cap(stockDiffs, 100))}
      </details>

      <details class="fold mt"><summary><b>⚠️ Dans l'appli, absent du site (${c.appOnly.length}) — créeraient un doublon à l'export</b></summary>
        ${tbl(c.appOnly.sort((a, b) => U.sortFr(a.name, b.name)), [
          { h: 'SKU', f: r => `<span class="tag">${U.esc(r.sku)}</span>` },
          { h: 'Produit', f: r => U.esc(r.name) }
        ], cap(c.appOnly, 100))}
      </details>

      <details class="fold mt"><summary><b>ℹ️ Sur le site, absent de l'appli (${c.siteOnly.length})</b></summary>
        ${tbl(c.siteOnly.sort((a, b) => U.sortFr(a.name || '', b.name || '')), [
          { h: 'SKU', f: r => `<span class="tag">${U.esc(r.sku)}</span>` },
          { h: 'Produit (site)', f: r => U.esc(r.name || '—') }
        ], cap(c.siteOnly, 100))}
      </details>`;
  },
  /* Met à jour le compteur + le libellé du bouton d'export SANS re-render
     (snappy quand on coche/décoche plein de cases). */
  _refreshSelInfo() {
    const linked = this.lines().filter(l => l.sku);
    const n = this._selCount(linked);
    const info = document.getElementById('woo_selinfo');
    if (info) info.textContent = n > 0 ? `${n} produit(s) sélectionné(s)` : 'Aucune sélection → tout est exporté';
    const btn = document.getElementById('woo_export_btn');
    if (btn) btn.textContent = n > 0 ? `⬇️ Exporter le CSV (${n} sélectionné(s))` : `⬇️ Exporter le CSV pour WooCommerce (${linked.length} produits liés)`;
  },

  /* Construit les lignes exportables { sku, name, price, stock, kind }, clé = SKU.
     UNIQUEMENT la mastication (stockM pour stock/prix/SKU + catalogM pour affiner le prix).
     Accessoires / matières / consommables volontairement exclus (voir plus bas). */
  lines() {
    const map = new Map();
    const add = (sku, name, price, stock, kind, meat) => {
      sku = String(sku || '').trim(); if (!sku) return;
      const ex = map.get(sku);
      if (ex) {
        if (stock !== null) ex.stock = (ex.stock === null ? 0 : ex.stock) + stock;
        if (price) ex.price = price;
        if (!ex.meat && meat) ex.meat = meat;
      } else map.set(sku, { sku, name, price: price || 0, stock, kind, meat: meat || '' });
    };
    // 1) Stock mastication (quantités + prix de vente + SKU)
    Store.state.stockM.forEach(p => p.variants.forEach(v => {
      if (v.mode === 'vrac') return;
      const stock = v.lots.reduce((a, l) => a + U.num(l.qtyGeneral) + (this.stockScope === 'both' ? U.num(l.qtyEvent) : 0), 0);
      add(v.sku, `${p.name} — ${Pricing.labelVariant(v)}`, U.num(v.priceTTC), stock, 'Mastication', p.meatType || '');
    }));
    // 2) Catalogue prix : si un SKU y est renseigné, il fournit/affine le prix calculé
    Store.state.catalogM.forEach(p => {
      const base = Pricing.baseUnitCost(p); const na = (p.variants||[]).filter(v=>v.enabled!==false).length; let idx = 0;
      (p.variants || []).forEach(v => {
        const on = v.enabled !== false; const c = Pricing.variantCalc(p, v, on ? idx : 0, base, na); if (on) idx++;
        if (v.sku) add(v.sku, `${p.name} — ${Pricing.labelVariant(v)}`, c.priceTTC, null, 'Mastication', p.meatType || '');
      });
    });
    // Les ACCESSOIRES (catalogA) sont volontairement EXCLUS de l'export/comparaison :
    // ce sont des modèles de calcul, pas les fiches produit finies mises en ligne, et ils
    // n'ont pas de SKU. (Décision explicite d'Antho — ne pas les réintroduire ici.)
    // Matières premières et consommables ne sont pas non plus des produits vendus → jamais inclus.
    return [...map.values()].sort((a, b) => U.sortFr(a.name, b.name));
  },

  render() {
    const all = this.lines();
    const linked = all.filter(l => l.sku);
    const missing = all.filter(l => !l.sku);
    const visible = this._visible(linked);
    // Tri cliquable (même patron que Stock : clic = trie, re-clic = inverse le sens)
    const f = this.filters;
    const dir = f.sortDir === 'desc' ? -1 : 1;
    visible.sort((a, b) => {
      let r;
      if (f.sort === 'price') r = (a.price || 0) - (b.price || 0);
      else if (f.sort === 'stock') r = ((a.stock ?? -1)) - ((b.stock ?? -1));
      else if (f.sort === 'excluded') r = (this._isExcluded(a.sku) ? 1 : 0) - (this._isExcluded(b.sku) ? 1 : 0);
      else r = U.sortFr(a[f.sort] || '', b[f.sort] || '');
      return r * dir;
    });
    const sortHead = (key, label) => `<span class="sortable ${f.sort === key ? 'active' : ''}" onclick="Woo.setSort('${key}')">${label} ${f.sort === key ? (f.sortDir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
    const selCount = this._selCount(linked.filter(l => !this._isExcluded(l.sku)));
    // Options « type de viande » construites à partir des lignes réellement liées
    const meatCounts = {};
    linked.forEach(l => { if (l.meat) meatCounts[l.meat] = (meatCounts[l.meat] || 0) + 1; });
    const meatOpts = [{ v: 'all', l: `Tous (${linked.length})` }]
      .concat(Object.keys(meatCounts).sort(U.sortFr).map(m => ({ v: m, l: `${m} (${meatCounts[m]})` })));
    const allVisSel = visible.length > 0 && visible.filter(l => !this._isExcluded(l.sku)).every(l => this._sel[l.sku]) && visible.some(l => !this._isExcluded(l.sku));
    const excludedCount = linked.filter(l => this._isExcluded(l.sku)).length;
    const exportable = linked.length - excludedCount;
    const exportLabel = selCount > 0 ? `⬇️ Exporter le CSV (${selCount} sélectionné(s))` : `⬇️ Exporter le CSV pour WooCommerce (${exportable} produit${exportable > 1 ? 's' : ''})`;

    App.mount(`
      <div class="view-title"><h1>Site (WooCommerce)</h1><span class="sub">liaison par SKU · prix & stock</span></div>

      <div class="card">
        <h2>🔗 Comment ça marche</h2>
        <p class="muted mb0">Le <b>SKU</b> (référence unique d'un produit sur ton site) relie chaque produit de l'app à sa fiche WooCommerce. L'app calcule le <b>prix de vente</b> et le <b>stock</b> ; tu les envoies vers le site via un fichier CSV que WooCommerce applique aux produits existants (il les retrouve par leur SKU). Ton <b>coût d'achat et tes marges restent dans l'app</b> — WooCommerce n'en a pas besoin.</p>
      </div>

      <div class="card">
        <h2>⚙️ Ce que j'exporte</h2>
        <p class="muted" style="margin-top:0;margin-bottom:12px;">Le stock envoyé au site = <b>la totalité</b> (général + événement) — c'est l'ensemble de ta marchandise que ton site met en ligne.</p>
        <div class="frow" style="gap:18px;flex-wrap:wrap;margin-bottom:4px;">
          <label style="display:flex;gap:8px;align-items:center;text-transform:none;"><input type="checkbox" ${this.includePrice ? 'checked' : ''} onchange="Woo.includePrice=this.checked"> Envoyer les prix (TTC public)</label>
          <label style="display:flex;gap:8px;align-items:center;text-transform:none;"><input type="checkbox" ${this.includeStock ? 'checked' : ''} onchange="Woo.includeStock=this.checked"> Envoyer les quantités de stock</label>
        </div>
        <div class="grid c2 mt">
          <div class="fg"><label>Recherche</label><input id="woo_q" value="${U.esc(this.filters.q)}" placeholder="nom du produit ou SKU…" oninput="Woo._setSearch(this.value)"></div>
          <div class="fg"><label>Type de viande</label>${U.customSelect({ value: this.filters.meat, options: meatOpts, onPick: 'Woo._setMeat' })}</div>
        </div>
        <div class="frow mt" style="gap:12px;align-items:center;flex-wrap:wrap;">
          <label class="ms-opt" style="flex:0 0 auto;"><input type="checkbox" ${allVisSel ? 'checked' : ''} onchange="Woo.selectAllVisible(this.checked)"> Tout sélectionner (${visible.length} affiché(s))</label>
          <span id="woo_selinfo" class="muted">${selCount > 0 ? `${selCount} produit(s) sélectionné(s)` : 'Aucune sélection → tout est exporté'}</span>
          ${excludedCount > 0 ? `<span class="tag" style="border-color:var(--alerte);">🚫 ${excludedCount} exclu(s) du site</span>` : ''}
          ${selCount > 0 ? `<button class="btn-ghost btn-sm" style="flex:0;" onclick="Woo.clearSel()">Vider la sélection</button>` : ''}
        </div>
        <button id="woo_export_btn" class="btn-cta mt" onclick="Woo.exportCsv()">${exportLabel}</button>
        <p class="muted mt">Sur ton site : menu <b>Produits</b> (l'entrée à part, <u>pas</u> le menu WooCommerce) → <b>Tous les produits</b> → bouton <b>Importer</b> en haut de la page → choisir le fichier → cocher <b>« Mettre à jour les produits existants »</b>. WooCommerce retrouve chaque produit par son SKU.</p>
        <p class="pos mb0" style="margin-top:4px;">✓ Le fichier ne contient que <b>SKU + prix + stock</b> : tes <b>descriptions, catégories, étiquettes et images</b> sur le site ne sont <b>jamais touchées</b>.</p>
        <p class="muted mb0" style="margin-top:4px;">Les colonnes sont au <b>format français de ton site</b> (UGS, Tarif régulier, Stock, En stock ?) → WooCommerce les reconnaît sans mapping manuel. <b>Fais un essai sur 2-3 produits d'abord</b> et vérifie que le prix affiché est bien le bon (ni ×100, ni ÷100).</p>
        <p class="muted mb0" style="margin-top:4px;">Seule la <b>mastication</b> est envoyée. Les <b>accessoires</b> (modèles de calcul, sans SKU), <b>matières premières</b> et <b>consommables</b> ne sont <b>jamais</b> exportés ni comparés — ce ne sont pas des produits vendus en ligne. Pour un produit mastication que tu gardes dans l'appli mais ne vends pas en ligne (événement-only, test…), clique <b>🚫</b> dans la colonne « Envoi site » : il sera <b>exclu définitivement</b> de l'export.</p>
      </div>

      <div class="card">
        <h2>🔄 Comparer avec le site (import)</h2>
        <p class="muted">Dépose l'export produits de ton site (le CSV WooCommerce, menu <b>Produits → Tous les produits → Exporter</b>) pour comparer <b>prix</b> et <b>stock</b> par SKU, et repérer les produits présents d'un seul côté. <b>Lecture seule</b> — aucune donnée n'est modifiée.</p>
        <div class="frow" style="gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="file" id="woo_cmp_file" accept=".csv,text/csv">
          <button class="btn-cta btn-sm" style="flex:0 0 auto;" onclick="Woo.compareSite()">Comparer</button>
          ${this._cmp ? `<button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Woo.clearCompare()">Effacer le rapport</button>` : ''}
        </div>
        ${this._cmp ? this._renderCompare() : ''}
      </div>

      ${missing.length ? `<div class="card" style="border-left:4px solid var(--warn);">
        <h2>⚠️ ${missing.length} produit(s) sans SKU — à relier</h2>
        <p class="muted">Ces produits ne seront pas envoyés tant qu'ils n'ont pas de SKU. Renseigne le même SKU que sur ta fiche WooCommerce (Prix mastication → Modifier → colonne SKU, ou Accessoires → Modifier).</p>
        <div class="table-wrap"><table><thead><tr><th class="col-name">Produit</th><th>Type</th></tr></thead>
          <tbody>${missing.map(l => `<tr><td class="col-name">${U.esc(l.name)}</td><td><span class="badge info">${l.kind}</span></td></tr>`).join('')}</tbody></table></div>
      </div>` : `<div class="card"><p class="pos">✓ Tous tes produits ont un SKU.</p></div>`}

      <div class="card">
        <h2>👁 Aperçu de l'export (${visible.length}${visible.length !== linked.length ? ` sur ${linked.length}` : ''} ligne(s))</h2>
        <div class="table-wrap"><table><thead><tr>
          <th style="width:34px;"><input type="checkbox" ${allVisSel ? 'checked' : ''} onchange="Woo.selectAllVisible(this.checked)" title="Tout sélectionner"></th>
          <th>${sortHead('sku', 'SKU')}</th><th class="col-name">${sortHead('name', 'Produit')}</th><th>${sortHead('meat', 'Viande')}</th><th class="num">${sortHead('price', 'Prix TTC')}</th><th class="num">${sortHead('stock', 'Stock')}</th><th>${sortHead('excluded', 'Envoi site')}</th></tr></thead>
          <tbody>${visible.slice(0, 200).map(l => { const excl = this._isExcluded(l.sku); const skuJs = String(l.sku).replace(/'/g, "\\'"); return `<tr${excl ? ' style="opacity:.45;"' : ''}>
            <td><input type="checkbox" ${excl ? 'disabled' : (this._sel[l.sku] ? 'checked' : '')} onchange="Woo.toggleSel('${skuJs}',this.checked)"></td>
            <td><span class="tag">${U.esc(l.sku)}</span></td>
            <td class="col-name">${U.esc(l.name)}${excl ? ' <span class="badge">exclu</span>' : ''}</td>
            <td>${l.meat ? `<span class="badge info">${U.esc(l.meat)}</span>` : '—'}</td>
            <td class="num">${this.includePrice ? U.eur(l.price) : '—'}</td>
            <td class="num">${this.includeStock ? (l.stock === null ? '<span class="muted">pas de stock lié</span>' : U.qty(l.stock)) : '—'}</td>
            <td>${excl ? `<button class="btn-ghost btn-sm" onclick="Woo.toggleExclude('${skuJs}')">↩ Inclure</button>` : `<button class="btn-icon" title="Exclure ce produit du site (ne jamais l'envoyer)" onclick="Woo.toggleExclude('${skuJs}')">🚫</button>`}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Aucun produit ne correspond au filtre.</td></tr>'}</tbody></table>
          ${visible.length > 200 ? `<p class="muted">… et ${visible.length - 200} autres non affichés (affine la recherche pour les voir — « Tout sélectionner » couvre bien les ${visible.length}).</p>` : ''}</div>
      </div>

      <div class="card">
        <h2>🔄 Synchronisation automatique (plus tard)</h2>
        <p class="muted mb0">L'export CSV ci-dessus est le moyen le plus sûr pour commencer. Pour une synchro automatique (l'app pousse prix et stock vers le site sans fichier), WooCommerce offre une API REST. Elle ne peut pas être appelée directement depuis cette app (les clés seraient exposées et le navigateur bloque ces appels) : il faut un petit relais côté serveur. Comme tu utilises déjà Supabase, ce relais peut être une « Edge Function » Supabase. C'est décrit dans le guide, section WooCommerce — à activer quand tu voudras. En attendant, l'export CSV fait le travail.</p>
      </div>
    `);
  },

  exportCsv() {
    // Les produits exclus du site (réglage persistant) ne sont JAMAIS exportés.
    const allLinked = this.lines().filter(l => l.sku && !this._isExcluded(l.sku));
    if (!allLinked.length) { U.toast('Aucun produit à exporter (tous sans SKU ou exclus).', true); return; }
    // Sélection active → on n'exporte QUE les produits cochés ; sinon tout.
    const selCount = this._selCount(allLinked);
    const linked = selCount > 0 ? allLinked.filter(l => this._sel[l.sku]) : allLinked;
    if (!linked.length) { U.toast('Aucun produit sélectionné à exporter.', true); return; }
    // En-têtes en FRANÇAIS, identiques à l'export natif du site d'Antho (WooCommerce FR :
    // UGS = SKU, Tarif régulier = prix, En stock ? = statut). Ainsi l'importateur WooCommerce
    // les reconnaît automatiquement (pas de mapping manuel de colonnes à faire).
    const head = ['UGS'];
    if (this.includePrice) head.push('Tarif régulier');
    if (this.includeStock) { head.push('Stock'); head.push('En stock ?'); }
    const rows = [head];
    linked.forEach(l => {
      const r = [l.sku];
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
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    U.download(`woocommerce-touffu-${U.today()}.csv`, '\ufeff' + csv, 'text/csv');
    U.toast(`CSV WooCommerce exporté : ${linked.length} produit(s)${selCount > 0 ? ' (sélection)' : ''}.`);
  }
};
