/* ============================================================
   B2B — revente aux professionnels
   Remise globale (%) appliquée au prix HT public, avec option de
   décote INDIVIDUELLE par produit (surcharge, `p.b2bDiscount` /
   `a.b2bDiscount` — vide = hérite de la remise globale). Fiches
   produit repliables (même patron `<details class="fold">` que
   Catalogue), une ligne par variante avec coeff/marge/cotisations/
   bénéfice B2B — repris explicitement de l'ancienne appli.

   Deux « onglets » via un sélecteur en haut de page (`B2B.tab`,
   défaut 'mast') : Mastication (fiches repliables multi-variantes)
   et Accessoires (table à plat, un prix par fiche — mais avec les
   MÊMES fonctions B2B : décote par produit, coeff/marge/cotisations/
   bénéfice pro). ⚠️ Les accessoires cotisent au taux FAIT MAIN
   (`Pricing.socialRateHandmade()`, artisanat 21,2 %), pas au taux
   marchandises 12,3 % de la mastication.
   ============================================================ */
const B2B = {
  discount: 0,      // % de remise pro globale (repli si le produit n'a pas de décote propre)
  noVat: false,     // true = micro-entreprise, pas de TVA sur la revente pro
  tab: 'mast',      // 'mast' | 'acc' — onglet actif (défaut mastication)
  filters: { q: '', meat: 'all', sup: 'all', cat: 'all', width: 'all', sort: 'meat', sortDir: 'asc' },
  accSort: { key: 'name', dir: 'asc' },
  _prodOpen: {},    // pId -> true/false, mémorise les fiches mastication dépliées entre deux re-rendus
  _accProdOpen: {}, // aId -> true/false, idem côté accessoires
  _sel: {},         // id (produit mast OU accessoire) -> true, sélection pour l'export « Spécial commercial »
  _meatFilterOpen: false,
  _setMeatFilter(val) { this.filters.meat = val; this._meatFilterOpen = false; this.render(); },
  _setSupFilter(val) { this.filters.sup = val; this.render(); },
  _setCatFilter(val) { this.filters.cat = val; this.render(); },
  _setWidthFilter(val) { this.filters.width = val; this.render(); },
  setTab(t) { this.tab = t; this.render(); },

  render() {
    // ⚠️ Deux remises globales INDÉPENDANTES : mastication (achat-revente) et accessoires
    // (fait main) — marges et cotisations différentes, une réduction ne doit jamais
    // s'appliquer à l'autre catégorie (demande explicite d'Antho). Clés localStorage séparées.
    this.discount = this.discount || U.num(localStorage.getItem('touffu_b2bDiscount')) || 20;
    if (this.discountAcc === undefined) {
      const s = localStorage.getItem('touffu_b2bDiscountAcc');
      this.discountAcc = s !== null ? U.num(s) : 20;
    }
    if (!this._noVatLoaded) { this.noVat = localStorage.getItem('touffu_b2bNoVat') === 'true'; this._noVatLoaded = true; }
    U.syncFilters('b2b', this.filters);
    const tab = this.tab || 'mast';
    const disc = tab === 'acc' ? this.discountAcc : this.discount;

    const controls = `
      <div class="card">
        <div class="frow" style="gap:8px;margin-bottom:14px;">
          <button class="${tab === 'mast' ? 'btn-cta' : 'btn-ghost'}" onclick="B2B.setTab('mast')">🥩 Mastication</button>
          <button class="${tab === 'acc' ? 'btn-cta' : 'btn-ghost'}" onclick="B2B.setTab('acc')">🐕 Accessoires</button>
        </div>
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
          <div class="b2b-global-disc">
            <label>Réduction B2B ${tab === 'acc' ? 'accessoires' : 'mastication'} (%)</label>
            <div class="b2b-global-disc-input">
              <input id="b2b_disc" type="text" inputmode="numeric" value="${disc}" onchange="B2B.setDiscount(this.value)" onkeydown="if(event.key==='Enter')this.blur()" onclick="this.select()">
              <span>%</span>
            </div>
          </div>
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem;" title="Micro-entreprise : pas de TVA appliquée sur la revente pro"><input type="checkbox" ${this.noVat ? 'checked' : ''} onchange="B2B.setNoVat(this.checked)"> Hors TVA (micro-entreprise)</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <button class="btn-ghost" onclick="B2B.exportQuote()">🧾 Exporter le tarif pro (CSV)</button>
            <button class="btn-ghost" onclick="B2B.exportCommercial()" title="Export simplifié à envoyer au commercial : nom, variante, prix HT facturé, prix conseillé (public TTC)">🧑‍💼 Spécial commercial</button>
            <button class="btn-ghost btn-sm" onclick="B2B.expandAll()">📂 Tout développer</button>
            <button class="btn-ghost btn-sm" onclick="B2B.collapseAll()">📁 Tout réduire</button>
          </div>
        </div>
        <p class="muted help" style="margin-top:10px;">Le prix pro applique la remise sur le prix HT public. Chaque fiche peut avoir sa propre décote (surcharge le champ ci-dessus) — utile pour les produits où tu marges moins ou plus que la moyenne.${tab === 'acc' ? ` Cotisations accessoires au taux <b>fait main (${U.pct(Pricing.socialRateHandmade())})</b>.` : ''}</p>
      </div>`;

    App.mount(`
      <div class="view-title"><h1>Revente pro (B2B)</h1><span class="sub">remise & fiches par produit</span></div>
      ${controls}
      ${tab === 'acc' ? this.renderAcc() : this.renderMast()}`);
  },

  renderMast() {
    const S = Store.state.settings;
    const f = this.filters;
    const products = Store.state.catalogM.filter(p =>
      (!f.q || p.name.toLowerCase().includes(f.q.toLowerCase())) &&
      (f.meat === 'all' || (p.meatType || '').toLowerCase() === f.meat.toLowerCase()) &&
      (f.sup === 'all' || p.mainSupplierId === f.sup)
    );
    const items = products.map(p => this.productStats(p)).filter(it => it.rows.length);
    const dir = f.sortDir === 'desc' ? -1 : 1;
    items.sort((a, b) => {
      if (f.sort === 'name') return dir * U.sortFr(a.p.name, b.p.name);
      if (f.sort === 'supplier') return dir * (U.sortFr(a.supplierName, b.supplierName) || U.sortFr(a.p.name, b.p.name));
      if (f.sort === 'critical') return dir * ((b.critical - a.critical) || U.sortFr(a.p.name, b.p.name));
      return dir * (U.sortFr(a.p.meatType || '', b.p.meatType || '') || U.sortFr(a.p.name, b.p.name));
    });
    this._items = items;

    return `
      <div class="toolbar">
        <div class="fg"><label>Recherche</label><input id="b2b_q" value="${U.esc(f.q)}" oninput="B2B.filters.q=this.value;B2B.render();U.refocus('b2b_q')"></div>
        <div class="fg"><label>Viande</label>${U.meatFilter({ current: f.meat, meats: S.meatTypes, count: products.length, setter: 'B2B._setMeatFilter', openState: this._meatFilterOpen, openSetter: 'B2B._meatFilterOpen' })}</div>
        <div class="fg"><label>Fournisseur</label>${U.customSelect({ value: f.sup, options: [{ v: 'all', l: 'Tous' }].concat(S.suppliers.map(s => ({ v: s.id, l: Store.supplierName(s.id) })).sort((a, b) => U.sortFr(a.l, b.l))), onPick: 'B2B._setSupFilter' })}</div>
      </div>

      <div class="view-title" style="margin-top:6px;"><h2 style="margin:0;">🥩 Mastication</h2><span class="sub">${items.length} produit${items.length > 1 ? 's' : ''}</span></div>
      ${items.length ? `<div class="b2b-selrow-head"><input type="checkbox" class="b2b-selbox" ${items.every(it => this._sel[it.p.id]) ? 'checked' : ''} onchange="B2B.selectAllVisible(this.checked)" title="Tout sélectionner / désélectionner (pour l'export commercial)"><div class="prod-list-header b2b-list-header"><span>${this.sortHead('name', 'Nom du produit')}</span><span>${this.sortHead('critical', 'Alertes')}</span><span class="type-col">${this.sortHead('meat', 'Viande')}</span><span>${this.sortHead('supplier', 'Fournisseurs')}</span><span style="text-align:right">Réduction B2B (%)</span></div></div>
      <div class="muted" style="font-size:.82rem;margin:2px 0 8px;"><span id="b2b_selcount">${this._selCount()}</span> sélectionné(s) pour l'export commercial</div>` : ''}
      ${items.map(it => `<div class="b2b-selrow"><input type="checkbox" class="b2b-selbox" ${this._sel[it.p.id] ? 'checked' : ''} onclick="event.stopPropagation()" onchange="B2B.toggleSel('${it.p.id}',this.checked)">${this.card(it)}</div>`).join('') || '<div class="card empty"><span class="big">🥩</span>Aucun produit pour ces filtres.</div>'}`;
  },

  renderAcc() {
    const S = Store.state.settings;
    const f = this.filters;
    const allWidths = [...new Set(Store.state.catalogA.flatMap(a => this.accWidths(a)))].filter(Boolean).sort(U.sortFr);
    const list = Store.state.catalogA.filter(a =>
      (!f.q || (a.name || '').toLowerCase().includes(f.q.toLowerCase())) &&
      (f.cat === 'all' || (a.category || '') === f.cat) &&
      (f.width === 'all' || this.accWidths(a).includes(f.width))
    );
    let items = list.map(a => this.accStats(a));
    const s = this.accSort, dir = s.dir === 'desc' ? -1 : 1;
    items.sort((a, b) => {
      if (s.key === 'category') return dir * (U.sortFr(a.a.category || '', b.a.category || '') || U.sortFr(a.a.name, b.a.name));
      if (s.key === 'critical') return dir * ((b.critical - a.critical) || U.sortFr(a.a.name, b.a.name));
      return dir * U.sortFr(a.a.name, b.a.name);
    });
    this._accItems = items;
    const h = (k, l) => `<span class="sortable ${s.key === k ? 'active' : ''}" onclick="B2B.setAccSort('${k}')">${l} ${s.key === k ? (s.dir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;

    return `
      <div class="toolbar">
        <div class="fg"><label>Recherche</label><input id="b2b_q" value="${U.esc(f.q)}" oninput="B2B.filters.q=this.value;B2B.render();U.refocus('b2b_q')"></div>
        <div class="fg"><label>Catégorie</label>${U.customSelect({ value: f.cat, options: [{ v: 'all', l: 'Toutes' }].concat((S.accCategories || []).map(c => ({ v: c, l: c }))), onPick: 'B2B._setCatFilter' })}</div>
        <div class="fg"><label>Largeur</label>${U.customSelect({ value: f.width, options: [{ v: 'all', l: 'Toutes' }].concat(allWidths.map(w => ({ v: w, l: w }))), onPick: 'B2B._setWidthFilter' })}</div>
      </div>

      <div class="view-title" style="margin-top:6px;"><h2 style="margin:0;">🐕 Accessoires</h2><span class="sub">${items.length} produit${items.length > 1 ? 's' : ''}</span></div>
      ${items.length ? `<div class="b2b-selrow-head"><input type="checkbox" class="b2b-selbox" ${items.every(it => this._sel[it.a.id]) ? 'checked' : ''} onchange="B2B.selectAllVisible(this.checked)" title="Tout sélectionner / désélectionner (pour l'export commercial)"><div class="prod-list-header b2b-list-header"><span>${h('name', 'Nom du produit')}</span><span>${h('critical', 'Alertes')}</span><span class="type-col">${h('category', 'Catégorie')}</span><span>Largeur</span><span style="text-align:right">Réduction B2B (%)</span></div></div>
      <div class="muted" style="font-size:.82rem;margin:2px 0 8px;"><span id="b2b_selcount">${this._selCount()}</span> sélectionné(s) pour l'export commercial</div>` : ''}
      ${items.map(it => `<div class="b2b-selrow"><input type="checkbox" class="b2b-selbox" ${this._sel[it.a.id] ? 'checked' : ''} onclick="event.stopPropagation()" onchange="B2B.toggleSel('${it.a.id}',this.checked)">${this.accCard(it)}</div>`).join('') || '<div class="card empty"><span class="big">🐕</span>Aucun accessoire pour ces filtres.</div>'}`;
  },

  /* Fiche B2B d'un accessoire — même patron visuel que `card()` (mastication) :
     fold repliable + grille d'en-tête `.b2b-fold` partagée, table interne avec
     le séparateur caramel entre colonnes publiques et B2B. Un seul « palier »
     (pas de variantes) → une ligne dans la table interne. */
  accCard(it) {
    const { a, critical } = it;
    const open = this._accProdOpen[a.id] || false;
    const widths = this.accWidths(a);
    const mainW = a.mainWidth || widths[0] || '';
    const widthBadges = widths.length
      ? widths.map(w => `<span class="badge${w === mainW && widths.length > 1 ? ' info' : ''}">${w === mainW && widths.length > 1 ? '★ ' : ''}${U.esc(w)}</span>`).join(' ')
      : '<span class="muted">—</span>';
    return `<details class="fold b2b-fold" id="b2bacc-${a.id}" ${open ? 'open' : ''} ontoggle="B2B.setAccProdOpen('${a.id}',this.open)">
      <summary>
        <span class="b2b-name"><b>${U.esc(a.name)}</b></span>
        <span>${critical ? '<span class="badge bad">⚠ coeff critique</span>' : ''}${this._expDiff('a:' + a.id, it.priceHTB2B) ? ' <span class="badge warn" title="Un prix pro a changé depuis ton dernier export">💶 prix modifié</span>' : ''}</span>
        <span class="type-col"><span class="badge info">${U.esc(a.category || '—')}</span></span>
        <span class="sup-badges" onclick="event.stopPropagation()">${widthBadges}</span>
        <span class="b2b-disc-badge" onclick="event.preventDefault();event.stopPropagation()">
          <label>Réduction</label><input type="number" min="0" max="100" step="1" value="${a.b2bDiscount ?? ''}" placeholder="${this.discountAcc}" title="Réduction B2B propre à cet accessoire — vide = suit la remise globale accessoires" onchange="B2B.setAccDiscount('${a.id}',this.value)"><span>%</span>
        </span>
      </summary>
      <div class="fold-body">
        <div class="table-wrap"><table>
          <thead><tr><th class="col-name">Prix de vente</th><th class="num">Coût revient</th><th class="num">Coeff public</th><th class="num">Prix public TTC</th>
          <th class="num" style="border-left:2px solid var(--caramel);">Prix B2B HT</th><th class="num">Coeff B2B</th><th class="num">Marge B2B</th><th class="num">Cotisations B2B</th><th class="num">Bénéfice B2B</th><th class="num">${this.noVat ? 'Prix B2B HT' : 'Prix B2B TTC'}</th></tr></thead>
          <tbody><tr>
            <td class="col-name">${mainW ? U.esc(mainW) : 'Standard'}</td>
            <td class="num muted sensitive">${U.eur(it.cost, 3)}</td>
            <td class="num sensitive">${it.coeffPublic.toFixed(3)}</td>
            <td class="num muted">${U.eur(it.priceTTCPublic)}</td>
            <td class="num sensitive" style="border-left:2px solid var(--caramel);">${U.eur(it.priceHTB2B)} <span class="muted">HT</span>${this._expBadge(this._expDiff('a:' + it.a.id, it.priceHTB2B))}</td>
            <td class="num sensitive ${it.critical ? 'neg' : ''}">${it.coeffB2B.toFixed(3)}${it.critical ? ' ⚠️' : ''}</td>
            <td class="num sensitive ${it.marginB2B >= 0 ? 'pos' : 'neg'}">${U.eur(it.marginB2B)}</td>
            <td class="num sensitive neg">${U.eur(it.socialB2B)}</td>
            <td class="num sensitive ${it.profitB2B >= 0 ? 'pos' : 'neg'}"><b>${U.eur(it.profitB2B)}</b></td>
            <td class="num"><b>${U.eur(it.priceTTCB2B)}</b>${this.noVat ? ' <span class="muted">HT</span>' : ''}</td>
          </tr></tbody>
        </table></div>
      </div>
    </details>`;
  },

  /* Stats B2B par variante active d'un produit — coeff public repris de
     Pricing.variantCalc (effCoeff), coeff B2B recalculé par rapport au
     coût réel après application de la décote (pas juste le coeff public
     réduit d'un pourcentage). */
  productStats(p) {
    const S = Store.state.settings;
    const preview = Catalogue._previewSup[p.id];
    const baseMain = Pricing.baseUnitCost(p);
    const base = preview ? Pricing.baseUnitCost(p, preview) : baseMain;
    const discPct = this.effectiveDiscount(p);
    const vat = U.num(p.vatRate !== undefined && p.vatRate !== '' ? p.vatRate : S.vatRate) / 100;
    const na = (p.variants || []).filter(v => v.enabled !== false).length;
    let idx = 0;
    const rows = (p.variants || []).filter(v => v.enabled !== false).map(v => {
      const cRaw = Pricing.variantCalc(p, v, idx, base, na);
      const cMain = preview ? Pricing.variantCalc(p, v, idx, baseMain, na) : cRaw;
      idx++;
      const cost = cRaw.cost;
      const priceHT = cMain.priceHT;
      const priceTTC = cMain.priceTTC;
      const coeffPublic = cost > 0 ? priceHT / cost : 0;
      const priceHTB2B = priceHT * (1 - discPct / 100);
      const priceTTCB2B = this.noVat ? priceHTB2B : priceHTB2B * (1 + vat);
      const coeffB2B = cost > 0 ? priceHTB2B / cost : 0;
      const marginB2B = priceHTB2B - cost;
      const socialB2B = priceHTB2B * U.num(S.socialTaxRate) / 100;
      const profitB2B = marginB2B - socialB2B;
      const critical = coeffB2B < U.num(S.b2bCoeffThreshold);
      return { label: Pricing.labelVariant(v), cost, coeffPublic, priceTTCPublic: priceTTC, priceHTB2B, coeffB2B, marginB2B, socialB2B, profitB2B, priceTTCB2B, critical };
    });
    const activeSup = preview || p.mainSupplierId;
    return { p, rows, discPct, supplierName: activeSup ? Store.supplierName(activeSup) : '—', critical: rows.some(r => r.critical), preview };
  },

  /* Stats B2B d'un accessoire (un seul prix par fiche, pas de variantes).
     ⚠️ Cotisations au taux fait main (artisanat), pas au taux marchandises. */
  accStats(a) {
    const S = Store.state.settings;
    const c = Pricing.accCalc(a);
    const discPct = this.effectiveDiscountAcc(a);
    const cost = c.cost;
    const priceHT = c.priceHT;
    const priceHTB2B = priceHT * (1 - discPct / 100);
    const priceTTCB2B = this.noVat ? priceHTB2B : priceHTB2B * (1 + U.num(S.vatRate) / 100);
    const coeffB2B = cost > 0 ? priceHTB2B / cost : 0;
    const marginB2B = priceHTB2B - cost;
    const socialB2B = priceHTB2B * Pricing.socialRateHandmade() / 100;
    const profitB2B = marginB2B - socialB2B;
    // ⚠️ Accessoires (fait main) : leur propre seuil critique (S.accCoeffThreshold),
    // pas celui de la mastication — cohérent avec le calcul de prix public (Pricing.accCalc).
    const critical = coeffB2B < U.num(S.accCoeffThreshold || S.b2bCoeffThreshold);
    return { a, discPct, cost, coeffPublic: c.effCoeff, priceTTCPublic: c.priceTTC, priceHTB2B, coeffB2B, marginB2B, socialB2B, profitB2B, priceTTCB2B, critical };
  },

  effectiveDiscount(p) {
    const specific = p.b2bDiscount;
    return (specific !== undefined && specific !== '' && specific !== null) ? U.num(specific) : U.num(this.discount);
  },

  /* Largeurs d'un accessoire — même stockage que la page Accessoires
     (`a.strapWidths`, legacy `a.strapWidth`) : ⚠️ PAS `a.widths` (n'existe pas). */
  accWidths(a) {
    if (a.strapWidths && a.strapWidths.length) return a.strapWidths;
    if (a.strapWidth) return [a.strapWidth];
    return a.mainWidth ? [a.mainWidth] : [];
  },

  effectiveDiscountAcc(a) {
    const specific = a.b2bDiscount;
    return (specific !== undefined && specific !== '' && specific !== null) ? U.num(specific) : U.num(this.discountAcc);
  },

  /* Alerte « prix pro modifié depuis le dernier export » (demande d'Antho 2026-09-26) :
     chaque export (tarif pro / spécial commercial) mémorise le prix B2B HT envoyé par
     produit+variante dans settings.b2bLastExport ; ensuite on signale tout écart, pour
     penser à prévenir le client. Clé : 'm:<id catalogue>|<libellé variante>' ou 'a:<id accessoire>'. */
  _expKeyM(pId, label) { return 'm:' + pId + '|' + label; },
  _lastExp() { return Store.state.settings.b2bLastExport || { prices: {} }; },
  _expDiff(key, price) {
    const le = this._lastExp(), e = (le.prices || {})[key];
    if (!e) return null;
    const d = price - U.num(e.price);
    return Math.abs(d) < 0.005 ? null : { d, date: e.date };
  },
  _expBadge(x) {
    if (!x) return '';
    return ` <span class="badge ${x.d > 0 ? 'warn' : 'info'}" style="font-size:.68rem;white-space:nowrap;" title="Prix pro différent de celui envoyé le ${U.frDate(x.date)} — pense à prévenir ton client">${x.d > 0 ? '↑ +' : '↓ '}${U.eur(x.d)} depuis l'export du ${U.frDate(x.date).slice(0, 5)}</span>`;
  },
  _recordExport(entries) {
    const S = Store.state.settings;
    const le = S.b2bLastExport = S.b2bLastExport || { prices: {} };
    le.prices = le.prices || {};
    const d = U.today();
    entries.forEach(([k, price]) => { le.prices[k] = { price: Math.round(price * 100) / 100, date: d }; });
    le.date = d;
    Store.save('settings');
  },

  card(it) {
    const { p, rows, discPct, supplierName, critical, preview } = it;
    const expChanged = rows.some(r => this._expDiff(this._expKeyM(p.id, r.label), r.priceHTB2B));
    const open = this._prodOpen[p.id] || false;
    const activeSup = preview || p.mainSupplierId;
    const supBadges = (p.suppliers || []).slice().sort((a, b) => a.supplierId === p.mainSupplierId ? -1 : b.supplierId === p.mainSupplierId ? 1 : 0).map(s => {
      const isActive = s.supplierId === activeSup;
      const isMain = s.supplierId === p.mainSupplierId;
      const prefix = isMain ? '★ ' : '';
      if (isActive) return `<span class="sup-badge main" title="${isMain ? 'Fournisseur principal' : 'Comparaison — cliquer pour revenir au principal'}" onclick="event.preventDefault();event.stopPropagation();Catalogue.previewSup('${p.id}','${s.supplierId}')">${prefix}${U.esc(Store.supplierName(s.supplierId))}</span>`;
      return `<span class="sup-badge alt" title="Comparer avec ce fournisseur" onclick="event.preventDefault();event.stopPropagation();Catalogue.previewSup('${p.id}','${s.supplierId}')">${prefix}${U.esc(Store.supplierName(s.supplierId))}</span>`;
    }).join('');
    return `<details class="fold b2b-fold" id="b2b-${p.id}" ${open ? 'open' : ''} ontoggle="B2B.setProdOpen('${p.id}',this.open)">
      <summary>
        <span class="b2b-name"><b>${U.esc(p.name)}</b></span>
        <span>${critical ? '<span class="badge bad">⚠ coeff critique</span>' : ''}${expChanged ? ' <span class="badge warn" title="Un prix pro a changé depuis ton dernier export">💶 prix modifié</span>' : ''}</span>
        <span class="type-col">
          <span class="badge info">${U.esc(p.meatType || '—')}</span>
        </span>
        <span class="sup-badges" onclick="event.stopPropagation()">${(p.suppliers || []).length ? supBadges : '<span class="muted">—</span>'}</span>
        <span class="b2b-disc-badge" onclick="event.preventDefault();event.stopPropagation()">
          <label>Réduction</label><input type="number" min="0" max="100" step="1" value="${p.b2bDiscount ?? ''}" placeholder="${this.discount}" title="Réduction B2B propre à ce produit — vide = suit la remise globale" onchange="B2B.setProductDiscount('${p.id}',this.value)"><span>%</span>
        </span>
      </summary>
      <div class="fold-body">
        ${preview ? '<div class="badge warn" style="margin-bottom:8px;">Comparaison avec ' + U.esc(Store.supplierName(preview)) + ' — cliquer à nouveau pour revenir au principal</div>' : ''}
        <div class="table-wrap"><table>
          <thead><tr><th class="col-name">Variante</th><th class="num">Coût revient</th><th class="num">Coeff public</th><th class="num">Prix public TTC</th>
          <th class="num" style="border-left:2px solid var(--caramel);">Prix B2B HT</th><th class="num">Coeff B2B</th><th class="num">Marge B2B</th><th class="num">Cotisations B2B</th><th class="num">Bénéfice B2B</th><th class="num">${B2B.noVat ? 'Prix B2B HT' : 'Prix B2B TTC'}</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td class="col-name">${U.esc(r.label)}</td>
            <td class="num muted sensitive">${U.eur(r.cost, 3)}</td>
            <td class="num sensitive">${r.coeffPublic.toFixed(3)}</td>
            <td class="num muted">${U.eur(r.priceTTCPublic)}</td>
            <td class="num sensitive" style="border-left:2px solid var(--caramel);">${U.eur(r.priceHTB2B)} <span class="muted">HT</span>${this._expBadge(this._expDiff(this._expKeyM(p.id, r.label), r.priceHTB2B))}</td>
            <td class="num sensitive ${r.critical ? 'neg' : ''}">${r.coeffB2B.toFixed(3)}${r.critical ? ' ⚠️' : ''}</td>
            <td class="num sensitive ${r.marginB2B >= 0 ? 'pos' : 'neg'}">${U.eur(r.marginB2B)}</td>
            <td class="num sensitive neg">${U.eur(r.socialB2B)}</td>
            <td class="num sensitive ${r.profitB2B >= 0 ? 'pos' : 'neg'}"><b>${U.eur(r.profitB2B)}</b></td>
            <td class="num"><b>${U.eur(r.priceTTCB2B)}</b>${B2B.noVat ? ' <span class="muted">HT</span>' : ''}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </details>`;
  },

  setProdOpen(pId, open) { this._prodOpen[pId] = open; if (!open && Catalogue._previewSup[pId]) { delete Catalogue._previewSup[pId]; App.rerender(); } },
  setAccProdOpen(aId, open) { this._accProdOpen[aId] = open; },

  setSort(key) {
    const f = this.filters;
    if (f.sort === key) f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc';
    else { f.sort = key; f.sortDir = 'asc'; }
    this.render();
  },

  sortHead(key, label) {
    const f = this.filters;
    return `<span class="sortable ${f.sort === key ? 'active' : ''}" onclick="B2B.setSort('${key}')">${label} ${f.sort === key ? (f.sortDir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
  },

  setAccSort(key) {
    const s = this.accSort;
    if (s.key === key) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
    else { s.key = key; s.dir = 'asc'; }
    this.render();
  },

  expandAll() {
    if ((this.tab || 'mast') === 'acc') (this._accItems || []).forEach(it => this._accProdOpen[it.a.id] = true);
    else (this._items || []).forEach(it => this._prodOpen[it.p.id] = true);
    this.render();
  },
  collapseAll() {
    if ((this.tab || 'mast') === 'acc') (this._accItems || []).forEach(it => this._accProdOpen[it.a.id] = false);
    else (this._items || []).forEach(it => this._prodOpen[it.p.id] = false);
    this.render();
  },

  /* Décote propre à ce produit (surcharge la remise globale) — saisie
     directement sur la fiche B2B, pas dans l'éditeur Catalogue (même
     logique que l'ancien calculateur : c'est une donnée de tarification
     pro, pas une donnée produit). */
  setProductDiscount(pId, val) {
    const p = Store.state.catalogM.find(x => String(x.id) === String(pId)); if (!p) return;
    const snap = Store.snapshot('catalogM', p);
    p.b2bDiscount = val;
    const entry = Store.commitSnapshot(snap, 'b2b', 'Décote B2B modifiée — ' + p.name);
    Store.save('catalogM');
    U.toast('Décote mise à jour.', false, entry.id);
    this.render();
  },

  /* Idem pour un accessoire (`a.b2bDiscount` sur catalogA). */
  setAccDiscount(aId, val) {
    const a = Store.state.catalogA.find(x => String(x.id) === String(aId)); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    a.b2bDiscount = val;
    const entry = Store.commitSnapshot(snap, 'b2b', 'Décote B2B modifiée — ' + a.name);
    Store.save('catalogA');
    U.toast('Décote mise à jour.', false, entry.id);
    this.render();
  },

  /* Remise globale de l'onglet ACTIF (mastication OU accessoires — deux valeurs
     indépendantes). `onchange` (pas `oninput`) : la valeur n'est prise en compte
     qu'à la sortie du champ / Entrée, donc AUCUN re-rendu pendant la frappe → plus
     de curseur qui saute (le re-rendu à chaque frappe recréait l'input et remettait
     le curseur au début, bug signalé par Antho : « 25 » devenait « 52 »). */
  setDiscount(v) {
    const acc = (this.tab || 'mast') === 'acc';
    const before = acc ? this.discountAcc : this.discount;
    const val = Math.min(100, Math.max(0, U.num(v)));
    if (acc) { this.discountAcc = val; localStorage.setItem('touffu_b2bDiscountAcc', val); }
    else { this.discount = val; localStorage.setItem('touffu_b2bDiscount', val); }
    this.render();
    if (before !== val) {
      const entry = Store.log('b2b', `Remise B2B ${acc ? 'accessoires' : 'mastication'} modifiée (${before}% → ${val}%)`, { type: 'b2bGlobalDiscount', data: { before, acc } });
      U.toast('Remise globale mise à jour.', false, entry.id);
    }
  },

  setNoVat(checked) {
    this.noVat = !!checked;
    localStorage.setItem('touffu_b2bNoVat', this.noVat);
    this.render();
  },

  exportQuote() {
    if ((this.tab || 'mast') === 'acc') return this.exportQuoteAcc();
    const lines = [['Produit', 'Variante', 'Fournisseur', 'Decote_pct', 'Cout_revient', 'Coeff_public', 'Public_TTC', 'Prix_B2B_HT', 'Coeff_B2B', 'Marge_B2B', 'Cotisations_B2B', 'Benefice_B2B', 'Prix_B2B_TTC']];
    (this._items || []).forEach(it => {
      it.rows.forEach(r => lines.push([it.p.name, r.label, it.supplierName, it.discPct, r.cost.toFixed(3), r.coeffPublic.toFixed(3), r.priceTTCPublic.toFixed(2), r.priceHTB2B.toFixed(2), r.coeffB2B.toFixed(3), r.marginB2B.toFixed(2), r.socialB2B.toFixed(2), r.profitB2B.toFixed(2), r.priceTTCB2B.toFixed(2)]));
    });
    const csv = lines.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    U.download(`tarif-pro-mastication-touffu-${U.today()}.csv`, '﻿' + csv, 'text/csv');
    this._recordExport((this._items || []).flatMap(it => it.rows.map(r => [this._expKeyM(it.p.id, r.label), r.priceHTB2B])));
    U.toast('Tarif pro mastication exporté (CSV, ouvrable dans Excel).');
  },

  exportQuoteAcc() {
    const lines = [['Produit', 'Categorie', 'Decote_pct', 'Cout_revient', 'Coeff_public', 'Public_TTC', 'Prix_B2B_HT', 'Coeff_B2B', 'Marge_B2B', 'Cotisations_B2B_faitmain', 'Benefice_B2B', this.noVat ? 'Prix_B2B_HT' : 'Prix_B2B_TTC']];
    (this._accItems || []).forEach(r => lines.push([r.a.name, r.a.category || '', r.discPct, r.cost.toFixed(3), r.coeffPublic.toFixed(3), r.priceTTCPublic.toFixed(2), r.priceHTB2B.toFixed(2), r.coeffB2B.toFixed(3), r.marginB2B.toFixed(2), r.socialB2B.toFixed(2), r.profitB2B.toFixed(2), r.priceTTCB2B.toFixed(2)]));
    const csv = lines.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    U.download(`tarif-pro-accessoires-touffu-${U.today()}.csv`, '﻿' + csv, 'text/csv');
    this._recordExport((this._accItems || []).map(r => ['a:' + r.a.id, r.priceHTB2B]));
    U.toast('Tarif pro accessoires exporté (CSV, ouvrable dans Excel).');
  },

  /* ═══════════ Sélection & export « Spécial commercial » ═══════════
     Document simplifié à envoyer au commercial d'une entreprise : uniquement
     Nom · Variante · Prix hors taxes (= prix B2B HT facturé) · Prix conseillé
     (= prix public TTC = notre prix de revente conseillé, pour lui donner une
     idée de sa marge derrière). Sur les produits cochés (ou tous si aucun). */
  _curItems() {
    return (this.tab || 'mast') === 'acc'
      ? (this._accItems || []).map(it => ({ id: it.a.id, it }))
      : (this._items || []).map(it => ({ id: it.p.id, it }));
  },
  _selCount() { return this._curItems().filter(x => this._sel[x.id]).length; },
  _updateSelCount() { const el = document.getElementById('b2b_selcount'); if (el) el.textContent = this._selCount(); },
  toggleSel(id, checked) { this._sel[id] = !!checked; this._updateSelCount(); },
  selectAllVisible(checked) { this._curItems().forEach(x => { this._sel[x.id] = !!checked; }); this.render(); },

  exportCommercial() {
    const acc = (this.tab || 'mast') === 'acc';
    const items = this._curItems();
    let chosen = items.filter(x => this._sel[x.id]);
    let note = '';
    if (!chosen.length) { chosen = items; note = ' (aucun coché → tous exportés)'; }
    if (!chosen.length) { U.toast('Aucun produit à exporter.', true); return; }
    const lines = [['Nom du produit', 'Variante', 'Prix hors taxes', 'Prix conseillé']];
    if (acc) {
      chosen.forEach(x => {
        const r = x.it, widths = this.accWidths(r.a), mainW = r.a.mainWidth || widths[0] || '';
        lines.push([r.a.name, mainW || 'Standard', r.priceHTB2B.toFixed(2), r.priceTTCPublic.toFixed(2)]);
      });
    } else {
      chosen.forEach(x => x.it.rows.forEach(r => lines.push([x.it.p.name, r.label, r.priceHTB2B.toFixed(2), r.priceTTCPublic.toFixed(2)])));
    }
    const csv = lines.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    U.download(`tarif-commercial-${acc ? 'accessoires' : 'mastication'}-touffu-${U.today()}.csv`, '﻿' + csv, 'text/csv');
    this._recordExport(acc ? chosen.map(x => ['a:' + x.it.a.id, x.it.priceHTB2B]) : chosen.flatMap(x => x.it.rows.map(r => [this._expKeyM(x.it.p.id, r.label), r.priceHTB2B])));
    U.toast(`Export commercial généré${note} : ${chosen.length} produit(s).`);
  }
};
