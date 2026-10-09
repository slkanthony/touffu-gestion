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
  tab: 'mast',     // 'mast' | 'acc' — onglet actif (défaut mastication)
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
    this._loadDiscounts();
    U.syncFilters('b2b', this.filters);
    const tab = this.tab || 'mast';
    const disc = tab === 'acc' ? this.discountAcc : this.discount;   // remise de l'ONGLET ACTIF (jamais une valeur unique)
    const cl = this._client();
    // Valeur stockée UNIQUE (`disc` = base : % sur le prix public HT = prix entreprise) ; le champ affiche la lecture du client sélectionné, les deux lectures sont rappelées dessous.
    const vatPct = Pricing.vatRate();   // taux global (en-tête) ; les fiches utilisent leur propre taux
    const pct1 = x => U.qty(this._pct1(x));
    const vEnt = this._discView(disc, vatPct, 'ent'), vMicro = this._discView(disc, vatPct, 'micro');
    const shown = this._pct1(cl === 'ent' ? vEnt : vMicro);
    const discLines = `<div class="b2b-disc-lines">
              <div class="${cl === 'micro' ? 'on' : ''}">🧑‍💼 Micro : −${pct1(vMicro)} % du prix public</div>
              <div class="${cl === 'ent' ? 'on' : ''}">🏢 Entreprise : −${pct1(vEnt)} % du prix public</div>
              <div class="muted">Micro = entreprise + ${pct1(vatPct)} % <span class="muted help" data-help-anchor="~ .b2b-global-disc > label">Le champ affiche la remise du client choisi ; la valeur réellement enregistrée est unique : −${pct1(disc)} % sur le prix public HT (= le prix entreprise). Tant que tu n'es pas assujetti, l'entreprise paie sans TVA : comparée au prix public TTC, sa remise paraît plus grande (${pct1(vEnt)} %) ; la remise « entreprise » ne peut pas descendre sous ${pct1(this._discBase(0, vatPct, 'ent').min)} % (= le prix public HT). Une fois assujetti, l'entreprise récupère la TVA (HT contre HT) et le micro compare TTC contre TTC : les deux remises sont alors égales. Le micro-entrepreneur ne récupère pas la TVA : il paie le prix TTC.</span></div>
            </div>`;

    const controls = `
      <div class="card">
        <div class="frow" style="gap:8px;margin-bottom:14px;align-items:center;">
          <span style="flex:0 0 auto;min-width:0;">${U.seg([{ l: '🥩 Mastication', on: tab === 'mast', js: "B2B.setTab('mast')" }, { l: '🐕 Accessoires', on: tab === 'acc', js: "B2B.setTab('acc')" }], { label: 'Catégorie' })}</span>

          <span style="margin-left:auto;display:inline-flex;align-items:center;gap:8px;"><span class="muted" style="font-size:.85rem;">Client</span>
            ${U.seg([{ l: '🏢 Entreprise', on: cl === 'ent', js: "B2B.setClient('ent')" }, { l: '🧑‍💼 Micro', on: cl === 'micro', js: "B2B.setClient('micro')" }], { label: 'Client' })}</span>
        </div>
        <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
          <div class="b2b-global-disc">
            <label>Remise ${cl === 'ent' ? 'entreprise' : 'micro'} — ${tab === 'acc' ? 'accessoires' : 'mastication'} (%)</label>
            <div class="b2b-global-disc-input">
              <input id="b2b_disc" type="text" inputmode="decimal" value="${shown}" onchange="B2B.setDiscount(this.value)" onkeydown="if(event.key==='Enter')this.blur()" onclick="this.select()">
              <span>%</span>
            </div>
            ${discLines}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <button class="btn-cta" onclick="B2B.openQuote(B2B._client())" title="${cl === 'micro' ? 'Pour une micro-entreprise (ne récupère pas la TVA) : prix avec TVA après remise + prix de vente conseillé' : 'Pour une entreprise qui récupère la TVA : prix HT après remise + prix de vente conseillé TTC'} — à copier en image ou en texte">📋 Partager le devis ${cl === 'micro' ? 'micro' : 'entreprise'}</button>
            <button class="btn-ghost" onclick="B2B.exportQuote()" title="Fichier interne (coûts, marges) avec les deux prix">🧾 Exporter le tarif pro (CSV)</button>
            ${U.seg([{ l: '📂 Tout développer', js: 'B2B.expandAll()' }, { l: '📁 Tout réduire', js: 'B2B.collapseAll()' }], { sm: true })}
          </div>
        </div>
        <p class="muted help" style="margin-top:10px;">Le prix pro applique la remise sur le prix HT public. Chaque fiche peut avoir sa propre décote (surcharge le champ ci-dessus) — utile pour les produits où tu marges moins ou plus que la moyenne. Les intitulés des colonnes de prix suivent la case « assujetti » des Paramètres : tant que tu ne factures pas de TVA, « Prix entreprise » (le prix de la remise) et « Prix micro » (ce prix + la TVA) ; une fois assujetti, « Prix B2B HT » et « Prix B2B TTC ». Les montants sont les mêmes dans les deux cas.${tab === 'acc' ? ` Cotisations accessoires au taux <b>fait main (${U.pct(Pricing.socialRateHandmade())})</b>.` : ''}</p>
      </div>`;

    App.mount(`
      <div class="view-title"><h1>Revente pro (B2B)</h1><span class="sub">remise & fiches par produit</span></div>
      ${controls}
      ${this._proPendingCard()}
      ${tab === 'acc' ? '' : this._capBanner()}
      ${tab === 'acc' ? this.renderAcc() : this.renderMast()}`);
  },

  /* Bandeau d'alerte « remises plafonnées » (toute la mastication, pas seulement les fiches filtrées) : liste dépliable produit / variante / remise demandée → appliquée. */
  _capOpen: false,
  /* Phrase ajoutée aux messages « remise mise à jour » : combien de variantes sont plafonnées (du produit `p`, ou de toute la mastication). */
  _capNote(p) {
    const l = this._capList(), keep = o => !p || o.name === p.name, n = l.capped.filter(keep).length, b = l.blocked.filter(keep).length;
    const thr = U.qty(U.num(Store.state.settings.b2bCoeffThreshold));
    return (n ? ` 🔒 ${n} variante${n > 1 ? 's' : ''} plafonnée${n > 1 ? 's' : ''} (coeff ${thr} minimum).` : '') + (b ? ` ${b} sans remise possible (déjà sous ${thr}).` : '');
  },
  _capList() {
    const out = [], blocked = [];
    Store.state.catalogM.forEach(p => {
      const it = this.productStats(p), vatP = Pricing.vatRate(p), view = x => this._pct1(this._discView(x, vatP, this._client()));
      it.rows.forEach(r => {
        const o = { name: p.name, variant: r.label, req: view(it.discPct), max: view(r.discMax), coeff: r.coeffB2B };
        if (r.capped && r.discMax > 0) out.push(o); else if (r.capped) blocked.push(o);
      });
    });
    const srt = (a, b) => U.sortFr(a.name, b.name) || U.sortFr(a.variant, b.variant);
    return { capped: out.sort(srt), blocked: blocked.sort(srt) };
  },
  _capBanner() {
    const { capped, blocked } = this._capList(), thr = U.qty(U.num(Store.state.settings.b2bCoeffThreshold));
    if (!capped.length && !blocked.length) return '';
    const tbl = (rows, withMax) => `<div class="table-wrap"><table><thead><tr><th class="col-name">Produit</th><th>Variante</th><th class="num">Remise demandée</th><th class="num">Remise appliquée</th></tr></thead><tbody>${rows.map(o => `<tr><td class="col-name">${U.esc(o.name)}</td><td>${U.esc(o.variant)}</td><td class="num">${o.req} %</td><td class="num"><b>${o.max} %</b></td></tr>`).join('')}</tbody></table></div>`;
    const nProd = n => new Set(n.map(o => o.name)).size;
    return `<details class="fold" ${this._capOpen ? 'open' : ''} ontoggle="B2B._capOpen=this.open" style="border-left:4px solid var(--warn);">
      <summary>🔒 <b>Remises plafonnées</b> <span class="muted" style="font-weight:400;">· le coeff entreprise ne descend jamais sous ${thr}</span>
        ${capped.length ? `<span class="badge warn">${capped.length} variante${capped.length > 1 ? 's' : ''} (${nProd(capped)} produit${nProd(capped) > 1 ? 's' : ''}) plafonnée${capped.length > 1 ? 's' : ''}</span>` : ''}
        ${blocked.length ? `<span class="badge bad" title="Déjà sous le seuil au prix public : aucune remise possible">${blocked.length} sans remise possible</span>` : ''}</summary>
      <div class="fold-body">
        ${capped.length ? `<p class="muted" style="margin-top:0;">Ces variantes reçoivent moins que la remise demandée ; les autres gardent la remise demandée.</p>${tbl(capped, true)}` : ''}
        ${blocked.length ? `<p class="muted" style="margin-bottom:4px;">Déjà sous ${thr} au <b>prix public</b> : aucune remise possible (le prix pro = le prix public HT). C'est le prix dans Prix mastication qu'il faut revoir.</p>${tbl(blocked, false)}` : ''}
      </div>
    </details>`;
  },

  renderMast() {
    const S = Store.state.settings;
    const f = this.filters;
    const products = Store.state.catalogM.filter(p =>
      (!f.q || U.has(p.name, f.q)) &&
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
        <div class="fg"><label>Fournisseur</label>${U.customSelect({ value: f.sup, options: [{ v: 'all', l: 'Tous' }].concat(Store.suppliersOf('mastication').map(s => ({ v: s.id, l: Store.supplierName(s.id) })).sort((a, b) => U.sortFr(a.l, b.l))), onPick: 'B2B._setSupFilter' })}</div>
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
      (!f.q || U.has(a.name || '', f.q)) &&
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
          <label>Réduction</label><input type="number" min="0" max="100" step="0.1" value="${this._fieldVal(a.b2bDiscount, Pricing.vatRate(a))}" placeholder="${this._pct1(this._discView(this.discountAcc, Pricing.vatRate(a), this._client()))}" title="Remise ${this._client() === 'ent' ? 'entreprise' : 'micro'} propre à cet accessoire — vide = suit la remise globale accessoires" onchange="B2B.setAccDiscount('${a.id}',this.value)"><span>%</span>
        </span>
      </summary>
      <div class="fold-body">
        <div class="table-wrap"><table>
          <thead><tr><th class="col-name">Prix de vente</th><th class="num">Coût revient</th><th class="num">Coeff public</th><th class="num">${this._lbl().pub}</th>
          <th class="num${this._hl('ent')}" style="border-left:2px solid var(--caramel);">${this._lbl().ent}</th><th class="num${this._hl('ent')}">${this._lbl().ce}</th><th class="num">${this._hdSfx('Marge B2B')}</th><th class="num">${this._hdSfx('Cotisations B2B')}</th><th class="num">${this._hdSfx('Bénéfice B2B')}</th><th class="num${this._hl('micro')}">${this._lbl().micro}</th><th class="num${this._hl('micro')}">${this._lbl().cm}</th></tr></thead>
          <tbody><tr>
            <td class="col-name">${mainW ? U.esc(mainW) : 'Standard'}</td>
            <td class="num muted sensitive">${U.eur(it.cost)}</td>
            <td class="num sensitive">${it.coeffPublic.toFixed(2)}</td>
            <td class="num muted">${U.eur(it.priceTTCPublic)}</td>
            <td class="num sensitive${this._hl('ent')}" style="border-left:2px solid var(--caramel);">${U.eur(it.priceHTB2B)}${this._lbl().ht}${this._expBadge(this._expDiff('a:' + it.a.id, it.priceHTB2B))}</td>
            <td class="num sensitive${this._hl('ent')} ${it.critical ? 'neg' : ''}">${it.coeffB2B.toFixed(2)}${it.critical ? ' ⚠️' : ''}</td>
            <td class="num sensitive ${it.marginB2B >= 0 ? 'pos' : 'neg'}">${U.eur(it.marginB2B)}</td>
            <td class="num sensitive neg">${U.eur(it.socialB2B)}</td>
            <td class="num sensitive ${it.profitB2B >= 0 ? 'pos' : 'neg'}"><b>${U.eur(it.profitB2B)}</b></td>
            <td class="num${this._hl('micro')}"><b>${U.eur(it.priceTTCB2B)}</b></td>
            <td class="num sensitive${this._hl('micro')}">${it.coeffMicro.toFixed(2)}</td>
          </tr></tbody>
        </table></div>
      </div>
    </details>`;
  },

  /* PLAFOND DE REMISE (Antho 2026-10-10) : la remise pro demandée (globale ou propre au produit) est PLAFONNÉE, variante par variante, pour que le coeff entreprise
     (prix pro HT ÷ coût de revient) ne passe jamais sous le seuil `b2bCoeffThreshold` ; les autres variantes gardent la remise demandée. Unité = celle de la remise stockée (`base`).
     → { applied: remise réellement appliquée, max: remise maximale permise (0 si la variante est déjà sous le seuil au prix public), capped: demandée > max }.
     ⚠️ Mastication seulement (les accessoires ont leur propre seuil et ne sont pas concernés pour l'instant). */
  cappedDiscount(priceHT, cost, base) {
    const req = U.num(base), thr = U.num(Store.state.settings.b2bCoeffThreshold);
    if (!(thr > 0) || !(cost > 0) || !(priceHT > 0)) return { applied: req, max: 100, capped: false };
    const max = Math.max(0, Math.floor((1 - thr * cost / priceHT) * 10000) / 100);   // arrondi vers le bas : le coeff reste ≥ seuil
    return { applied: Math.min(req, max), max, capped: req > max + 1e-9 };
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
    const vat = Pricing.vatRate(p) / 100;
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
      const dv = this.cappedDiscount(priceHT, cost, discPct);   // plafond : le coeff entreprise ne descend pas sous le seuil
      const priceHTB2B = priceHT * (1 - dv.applied / 100);
      const priceTTCB2B = priceHTB2B * (1 + vat);
      const coeffB2B = cost > 0 ? priceHTB2B / cost : 0;
      const marginB2B = priceHTB2B - cost;
      const socialB2B = priceHTB2B * U.num(S.socialTaxRate) / 100;
      const profitB2B = marginB2B - socialB2B;
      const critical = coeffB2B < U.num(S.b2bCoeffThreshold);
      return { vid: v.id, label: Pricing.labelVariant(v), discApplied: dv.applied, discMax: dv.max, capped: dv.capped, cost, coeffPublic, priceTTCPublic: priceTTC, priceHTB2B, coeffB2B, coeffMicro: this.coeffMicro(coeffB2B, vat), marginB2B, socialB2B, profitB2B, priceTTCB2B, ttcB2B: priceHTB2B * (1 + vat), critical };
    });
    const activeSup = preview || p.mainSupplierId;
    return { p, rows, discPct, supplierName: activeSup ? Store.supplierName(activeSup) : '—', critical: rows.some(r => r.critical), nCapped: rows.filter(r => r.capped).length, preview };
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
    const vat = Pricing.vatRate(a) / 100;
    const priceTTCB2B = priceHTB2B * (1 + vat);
    const coeffB2B = cost > 0 ? priceHTB2B / cost : 0;
    const marginB2B = priceHTB2B - cost;
    const socialB2B = priceHTB2B * Pricing.socialRateHandmade() / 100;
    const profitB2B = marginB2B - socialB2B;
    // ⚠️ Accessoires (fait main) : leur propre seuil critique (S.accCoeffThreshold),
    // pas celui de la mastication — cohérent avec le calcul de prix public (Pricing.accCalc).
    const critical = coeffB2B < U.num(S.accCoeffThreshold || S.b2bCoeffThreshold);
    return { a, discPct, cost, coeffPublic: c.effCoeff, priceTTCPublic: c.priceTTC, priceHTB2B, coeffB2B, coeffMicro: this.coeffMicro(coeffB2B, vat), marginB2B, socialB2B, profitB2B, priceTTCB2B, ttcB2B: priceHTB2B * (1 + vat), critical };
  },

  /* Coefficient du prix micro. Non assujetti : le client paie le prix entreprise + TVA et tu gardes tout → coeff × (1+TVA).
     Assujetti : ce prix est un TTC dont tu reverses la TVA → ta recette nette = le prix entreprise → coeff micro = coeff entreprise. */
  coeffMicro(coeffB2B, vat) { return Pricing.vatActive() ? coeffB2B : coeffB2B * (1 + vat); },

  /* Remise STOCKÉE (« base » = % sur le prix public HT = prix entreprise) ⇄ remise AFFICHÉE du client sélectionné.
     Non assujetti : l'entreprise paie sans TVA → comparée au prix public TTC, sa remise = 1 − (1−base)/(1+TVA) (20 → 33,3) ; le micro = base.
     Assujetti : l'entreprise récupère la TVA (HT contre HT) et le micro compare TTC contre TTC → les deux = base. */
  _discView(base, vatPct, client) {
    base = U.num(base);
    if (Pricing.vatActive() || client !== 'ent') return base;
    return (1 - (1 - base / 100) / (1 + U.num(vatPct) / 100)) * 100;
  },
  /* Inverse : valeur saisie → base stockée (bornée 0–100, 2 décimales). `min` = plancher de la saisie « entreprise » non assujettie (base 0 = prix public HT). */
  _discBase(shown, vatPct, client) {
    const x = U.num(shown), conv = !Pricing.vatActive() && client === 'ent';
    const raw = conv ? (1 - (1 - x / 100) * (1 + U.num(vatPct) / 100)) * 100 : x;
    const base = Math.round(Math.min(100, Math.max(0, raw)) * 100) / 100;
    return { base, clamped: raw < -0.005 || raw > 100.005, min: conv ? (1 - 1 / (1 + U.num(vatPct) / 100)) * 100 : 0 };
  },
  /* Chargement UNIQUE des deux remises globales (20 % si jamais réglées). Avant : `discount || … || 20` ramenait une remise à 0 % à 20 %. */
  _discLoaded: false,
  _loadDiscounts() {
    if (this._discLoaded) return;
    const g = localStorage.getItem('touffu_b2bDiscount'), a = localStorage.getItem('touffu_b2bDiscountAcc');
    this.discount = g !== null ? U.num(g) : 20;
    this.discountAcc = a !== null ? U.num(a) : 20;
    this._discLoaded = true;
  },
  _pct1(x) { return Math.round(U.num(x) * 10) / 10; },
  /* Champ « Réduction » d'une fiche : vide = suit la remise globale ; sinon affiché / saisi dans l'unité du client sélectionné (TVA de la fiche). */
  _fieldVal(base, vatPct) { return (base === undefined || base === null || base === '') ? '' : this._pct1(this._discView(base, vatPct, this._client())); },
  _fieldBase(shown, vatPct) { return String(shown == null ? '' : shown).trim() === '' ? null : this._discBase(shown, vatPct, this._client()); },
  _clampToast(r) { if (r && r.clamped) U.toast(r.min > 0 ? `Remise entreprise minimum ${U.qty(this._pct1(r.min))} % (= prix public HT).` : 'Remise bornée entre 0 et 100 %.', true); },

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
    const S = Store.state.settings, vatP = Pricing.vatRate(p), shownDisc = x => this._pct1(this._discView(x, vatP, this._client()));
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
        <span>${critical ? '<span class="badge bad">⚠ coeff critique</span>' : ''}${it.nCapped ? ` <span class="badge warn" title="Remise plafonnée pour garder le coeff entreprise au-dessus de ${U.qty(U.num(S.b2bCoeffThreshold))}">🔒 ${it.nCapped} plafonnée${it.nCapped > 1 ? 's' : ''}</span>` : ''}${expChanged ? ' <span class="badge warn" title="Un prix pro a changé depuis ton dernier export">💶 prix modifié</span>' : ''}</span>
        <span class="type-col">
          <span class="badge info">${U.esc(p.meatType || '—')}</span>
        </span>
        <span class="sup-badges" onclick="event.stopPropagation()">${(p.suppliers || []).length ? supBadges : '<span class="muted">—</span>'}</span>
        <span class="b2b-disc-badge" onclick="event.preventDefault();event.stopPropagation()">
          <label>Réduction</label><input type="number" min="0" max="100" step="0.1" value="${this._fieldVal(p.b2bDiscount, Pricing.vatRate(p))}" placeholder="${this._pct1(this._discView(this.discount, Pricing.vatRate(p), this._client()))}" title="Remise ${this._client() === 'ent' ? 'entreprise' : 'micro'} propre à ce produit — vide = suit la remise globale" onchange="B2B.setProductDiscount('${p.id}',this.value)"><span>%</span>
        </span>
      </summary>
      <div class="fold-body">
        ${preview ? '<div class="badge warn" style="margin-bottom:8px;">Comparaison avec ' + U.esc(Store.supplierName(preview)) + ' — cliquer à nouveau pour revenir au principal</div>' : ''}
        <div class="table-wrap"><table>
          <thead><tr><th class="col-name">Variante</th><th class="num">Coût revient</th><th class="num">Coeff public</th><th class="num">${B2B._lbl().pub}</th>
          <th class="num${B2B._hl('ent')}" style="border-left:2px solid var(--caramel);">${B2B._lbl().ent}</th><th class="num${B2B._hl('ent')}">${B2B._lbl().ce}</th><th class="num">${B2B._hdSfx('Marge B2B')}</th><th class="num">${B2B._hdSfx('Cotisations B2B')}</th><th class="num">${B2B._hdSfx('Bénéfice B2B')}</th><th class="num${B2B._hl('micro')}">${B2B._lbl().micro}</th><th class="num${B2B._hl('micro')}">${B2B._lbl().cm}</th></tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td class="col-name">${U.esc(r.label)}</td>
            <td class="num muted sensitive">${U.eur(r.cost)}</td>
            <td class="num sensitive">${r.coeffPublic.toFixed(2)}</td>
            <td class="num muted">${U.eur(r.priceTTCPublic)}</td>
            <td class="num sensitive${B2B._hl('ent')}" style="border-left:2px solid var(--caramel);">${U.eur(r.priceHTB2B)}${B2B._lbl().ht}${this._expBadge(this._expDiff(this._expKeyM(p.id, r.label), r.priceHTB2B))}</td>
            <td class="num sensitive${B2B._hl('ent')} ${r.critical ? 'neg' : ''}">${r.coeffB2B.toFixed(2)}${r.critical ? ' ⚠️' : ''}${r.capped ? ` <span class="badge warn" title="Remise demandée ${shownDisc(discPct)} % → plafonnée à ${shownDisc(r.discMax)} % pour garder le coeff entreprise à ${U.qty(U.num(S.b2bCoeffThreshold))} minimum">🔒 max ${shownDisc(r.discMax)} %</span>` : ''}</td>
            <td class="num sensitive ${r.marginB2B >= 0 ? 'pos' : 'neg'}">${U.eur(r.marginB2B)}</td>
            <td class="num sensitive neg">${U.eur(r.socialB2B)}</td>
            <td class="num sensitive ${r.profitB2B >= 0 ? 'pos' : 'neg'}"><b>${U.eur(r.profitB2B)}</b></td>
            <td class="num${B2B._hl('micro')}"><b>${U.eur(r.priceTTCB2B)}</b></td>
            <td class="num sensitive${B2B._hl('micro')}">${r.coeffMicro.toFixed(2)}</td>
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
    const r = this._fieldBase(val, Pricing.vatRate(p));
    p.b2bDiscount = r ? r.base : '';
    const entry = Store.commitSnapshot(snap, 'b2b', 'Décote B2B modifiée — ' + p.name);
    Store.save('catalogM');
    U.toast('Décote mise à jour.' + this._capNote(p), false, entry.id);
    this.render();
    this._clampToast(r);
  },

  /* Idem pour un accessoire (`a.b2bDiscount` sur catalogA). */
  setAccDiscount(aId, val) {
    const a = Store.state.catalogA.find(x => String(x.id) === String(aId)); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    const r = this._fieldBase(val, Pricing.vatRate(a));
    a.b2bDiscount = r ? r.base : '';
    const entry = Store.commitSnapshot(snap, 'b2b', 'Décote B2B modifiée — ' + a.name);
    Store.save('catalogA');
    U.toast('Décote mise à jour.', false, entry.id);
    this.render();
    this._clampToast(r);
  },

  /* Remise globale de l'onglet ACTIF (mastication OU accessoires — deux valeurs
     indépendantes). `onchange` (pas `oninput`) : la valeur n'est prise en compte
     qu'à la sortie du champ / Entrée, donc AUCUN re-rendu pendant la frappe → plus
     de curseur qui saute (le re-rendu à chaque frappe recréait l'input et remettait
     le curseur au début, bug signalé par Antho : « 25 » devenait « 52 »). */
  setDiscount(v) {
    const acc = (this.tab || 'mast') === 'acc';
    const before = acc ? this.discountAcc : this.discount;
    const r = this._discBase(v, Pricing.vatRate(), this._client());   // saisie dans l'unité du client choisi → base stockée
    const val = r.base;
    if (acc) { this.discountAcc = val; localStorage.setItem('touffu_b2bDiscountAcc', val); }
    else { this.discount = val; localStorage.setItem('touffu_b2bDiscount', val); }
    this.render();
    if (before !== val) {
      const entry = Store.log('b2b', `Remise B2B ${acc ? 'accessoires' : 'mastication'} modifiée (${before}% → ${val}%)`, { type: 'b2bGlobalDiscount', data: { before, acc } });
      U.toast('Remise globale mise à jour.' + this._capNote(), false, entry.id);
    }
    this._clampToast(r);   // en dernier : le message de plancher ne doit pas être écrasé par le toast précédent
  },

  /* Intitulés des colonnes de prix (mêmes montants dans les deux cas) : non assujetti → entreprise / micro, sans « HT/TTC » ; assujetti → HT / TTC. */
  _lbl() {
    return Pricing.vatActive()
      ? { ent: 'Prix B2B HT', micro: 'Prix B2B TTC', pub: 'Prix public TTC', ht: ' <span class="muted">HT</span>', ce: 'Coeff B2B HT', cm: 'Coeff B2B TTC', sfx: 'HT' }
      : { ent: 'Prix entreprise', micro: 'Prix micro', pub: 'Prix public', ht: '', ce: 'Coeff entreprise', cm: 'Coeff micro', sfx: 'entreprise' };
  },
  /* En-tête « Marge / Cotisations / Bénéfice B2B » : toujours calculés sur le prix entreprise (HT), précisé en petit sous le titre. */
  _hdSfx(txt) { return `${txt} <span class="b2b-sfx">${this._lbl().sfx}</span>`; },

  /* Client sélectionné (Revente pro) : 'ent' (défaut) | 'micro' — mémorisé dans le navigateur (touffu_b2bClient). Ne change AUCUN prix :
     choisit seulement la colonne mise en avant, la ligne de remise surlignée et le devis du bouton « Partager ». */
  client: 'ent',
  _clientLoaded: false,
  _client() {
    if (!this._clientLoaded) { try { this.client = localStorage.getItem('touffu_b2bClient') === 'micro' ? 'micro' : 'ent'; } catch (e) {} this._clientLoaded = true; }
    return this.client;
  },
  _setClientQuiet(c) { this.client = c === 'micro' ? 'micro' : 'ent'; this._clientLoaded = true; try { localStorage.setItem('touffu_b2bClient', this.client); } catch (e) {} },
  setClient(c) { this._setClientQuiet(c); this.render(); },
  _hl(c) { return this._client() === c ? ' b2b-sel' : ''; },

  exportQuote() {
    if ((this.tab || 'mast') === 'acc') return this.exportQuoteAcc();
    const lines = [['Produit', 'Variante', 'Fournisseur', 'Decote_pct', 'Cout_revient', 'Coeff_public', 'Public_TTC', 'Prix_B2B_HT', 'Coeff_B2B', 'Marge_B2B', 'Cotisations_B2B', 'Benefice_B2B', 'Prix_B2B_TTC']];
    let nAll = 0, nKept = 0;
    (this._items || []).forEach(it => {
      nAll += it.rows.length; this._keepRows(it.rows).forEach(r => { nKept++; lines.push([it.p.name, r.label, it.supplierName, r.discApplied, r.cost.toFixed(3), r.coeffPublic.toFixed(3), r.priceTTCPublic.toFixed(2), r.priceHTB2B.toFixed(2), r.coeffB2B.toFixed(3), r.marginB2B.toFixed(2), r.socialB2B.toFixed(2), r.profitB2B.toFixed(2), r.priceTTCB2B.toFixed(2)]); });
    });
    const csv = lines.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    U.download(`tarif-pro-mastication-touffu-${U.today()}.csv`, '﻿' + csv, 'text/csv');
    this._recordExport((this._items || []).flatMap(it => this._keepRows(it.rows).map(r => [this._expKeyM(it.p.id, r.label), r.priceHTB2B])));
    U.toast('Tarif pro mastication exporté (CSV, ouvrable dans Excel)' + this._offNote(nAll, nKept) + '.');
  },

  exportQuoteAcc() {
    const lines = [['Produit', 'Categorie', 'Decote_pct', 'Cout_revient', 'Coeff_public', 'Public_TTC', 'Prix_B2B_HT', 'Coeff_B2B', 'Marge_B2B', 'Cotisations_B2B_faitmain', 'Benefice_B2B', 'Prix_B2B_TTC']];
    const accKept = (this._accItems || []).filter(r => !this._isOffVar(this._accVariant(r.a)));
    accKept.forEach(r => lines.push([r.a.name, r.a.category || '', r.discPct, r.cost.toFixed(3), r.coeffPublic.toFixed(3), r.priceTTCPublic.toFixed(2), r.priceHTB2B.toFixed(2), r.coeffB2B.toFixed(3), r.marginB2B.toFixed(2), r.socialB2B.toFixed(2), r.profitB2B.toFixed(2), r.priceTTCB2B.toFixed(2)]));
    const csv = lines.map(l => l.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    U.download(`tarif-pro-accessoires-touffu-${U.today()}.csv`, '﻿' + csv, 'text/csv');
    this._recordExport(accKept.map(r => ['a:' + r.a.id, r.priceHTB2B]));
    U.toast('Tarif pro accessoires exporté (CSV, ouvrable dans Excel)' + this._offNote((this._accItems || []).length, accKept.length) + '.');
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

  /* ═══════════ Tarif à partager : micro-entreprise / entreprise avec TVA (fenêtre + image + texte) ═══════════
     • micro-entreprise (ne collecte pas la TVA) : Prix = TTC avec la remise · Prix de vente conseillé
     • entreprise (collecte la TVA) : Prix HT avec la remise · Prix de vente conseillé TTC
     Produits cochés (sinon tous), onglet actif. Pied : IBAN + message (jamais « espèces »), nom de l'entreprise modifiable. */
  _qt: null,
  _qtRows(all) {
    const acc = (this.tab || 'mast') === 'acc';
    const items = this._curItems();
    let chosen = items.filter(x => this._sel[x.id]);
    if (!chosen.length) chosen = items;
    const micro = this._qt && this._qt.type === 'micro';
    const price = r => micro ? r.ttcB2B : r.priceHTB2B;
    const list = [];
    chosen.forEach(x => {
      if (acc) {
        const r = x.it, mainW = r.a.mainWidth || this.accWidths(r.a)[0] || '';
        list.push({ key: 'a:' + r.a.id, aId: r.a.id, name: r.a.name, variant: mainW || 'Standard', price: price(r), reco: r.priceTTCPublic, ht: r.priceHTB2B });
      } else x.it.rows.forEach(r => {
        list.push({ key: this._expKeyM(x.it.p.id, r.label), pId: x.it.p.id, vid: r.vid, name: x.it.p.name, variant: r.label, price: price(r), reco: r.priceTTCPublic, ht: r.priceHTB2B });
      });
    });
    const q = (this._qt && this._qt.qty) || {};
    list.forEach(r => { r.qty = Math.max(1, Math.round(U.num(q[r.key])) || 1); r.on = !(this._qt && this._qt.off && this._qt.off[r.key]); r.sub = r.on ? r.qty * r.price : 0; r.subReco = r.on ? r.qty * r.reco : 0; });
    // Dès qu'une quantité est saisie : mode « devis » (seules les lignes avec une quantité, + Qté / Sous-total / Total). Sinon : simple liste de prix.
    const devis = list.some(r => r.on);
    const rows = all ? list : list.filter(r => r.on);
    return { rows, all: list, devis, keys: rows.map(r => [r.key, r.ht]), total: list.reduce((a, r) => a + r.sub, 0), totalReco: list.reduce((a, r) => a + r.subReco, 0) };
  },
  _qtCols() {
    const micro = this._qt.type === 'micro', franchise = !Pricing.vatActive();   // non assujetti : pas de « HT » (aucune TVA facturée)
    return { price: micro || franchise ? 'Prix' : 'Prix HT', reco: micro ? 'Prix de vente\nconseillé' : 'Prix de vente\nconseillé TTC' };
  },
  _qtExtras() {
    const S = Store.state.settings, q = this._qt;
    const iban = String(S.payIban || '').trim(), holder = String(S.payHolder || '').trim(), bic = String(S.payBic || '').trim();
    const ibanLines = (q.iban !== false && iban) ? [].concat(['RIB :'], holder ? ['Titulaire : ' + holder] : [], ['IBAN : ' + iban], bic ? ['BIC : ' + bic] : []) : [];
    const msg = String(q.msg != null ? q.msg : (S.payMessage || '')).trim();
    // TODO (assujettissement) : si Pricing.vatActive(), détailler le devis (HT + TVA par taux + total TTC) via une fonction
    // quoteVatBreakdown(lignes) à écrire AVEC son affichage ; à faire aussi pour le devis de Paniers (clients particuliers).
    // La mention 293 B disparaît déjà seule (Pricing.vatMention()) ; les montants ne changent pas, seul leur sens (HT/TTC).
    return { ibanLines, msg, vatMention: Pricing.vatMention(), refHint: ibanLines.length ? 'Merci d\'indiquer le n° de devis dans le libellé de votre virement.' : '' };
  },
  /* N° de devis (voir devis.js) : un état par entreprise (nom saisi) et par type de tarif, repris pendant 30 jours ; la lettre avance seulement si le contenu change */
  _dvKey() { return this._qt.type + '|' + String(this._qt.who || '').trim().toLowerCase(); },
  _dvState() {
    const m = Store.state.meta; m.devisB2B = m.devisB2B || {};
    let st = m.devisB2B[this._dvKey()];
    if (!st || (st.ts && Date.now() - st.ts > 30 * 86400000)) st = m.devisB2B[this._dvKey()] = { ...Devis.blank('P'), ts: 0 };
    if (!st.base && !st.pre) st.pre = 'P';   // devis pro : numéro préfixé « P » (P261003-1A) ; un devis déjà sorti garde son numéro
    return st;
  },
  _dvHash() { const { rows } = this._qtRows(); return Devis.hash({ t: this._qt.type, r: rows.map(r => [r.key, r.qty, Math.round(r.price * 100)]) }); },
  _dvShow() { return Devis.show(this._dvState(), this._dvHash()); },
  _dvCommit() { const st = this._dvState(), no = Devis.commit(st, this._dvHash()); st.ts = Date.now(); Store.save('meta'); this._qtNoRefresh(); return no; },
  _qtNoRefresh() { const e = document.getElementById('qt_no'); if (e) e.textContent = this._dvShow(); },
  _qtTotalLabel() { return this._qt.type === 'micro' || !Pricing.vatActive() ? 'Total' : 'Total HT'; },
  _qtRecoLabel() { return this._qt.type === 'micro' ? 'Total revente conseillé' : 'Total revente conseillé TTC'; },
  /* Total en direct (barre fixe en haut de la fenêtre) : nombre de lignes · total · total revente conseillé. */
  _qtTotalsTxt() {
    const { devis, all, total, totalReco } = this._qtRows(true);
    return devis ? `<span class="muted">${all.filter(r => r.on).length} ligne(s)</span> · ${this._qtTotalLabel()} : <b>${U.eur(total)}</b> <span class="qt-reco">· ${this._qtRecoLabel()} : ${U.eur(totalReco)}</span>` : '';
  },
  /* Tableau seul (zone qui défile). Colonnes à largeur fixe (aucune barre horizontale), une ligne par variante, nom du produit écrit une seule fois
     par groupe. Lignes décochées masquées (compteur + bouton dans la barre) sauf si une recherche est en cours. */
  _qtInner() {
    const { all } = this._qtRows(true), c = this._qtCols(), q = this._qt;
    const search = String(q.q || '').trim(), showOff = !!q.showOff;
    const vis = [];
    all.forEach((r, i) => { if (search ? U.has(r.name + ' ' + r.variant, search) : (r.on || showOff)) vis.push({ r, i }); });
    let prev = null;
    const rows = vis.map(({ r, i }) => {
      const first = r.name !== prev; prev = r.name;
      return `<tr id="qt_row_${i}" class="${first ? 'grp' : ''}" style="${r.on ? '' : 'opacity:.4;'}"><td class="ck"><input type="checkbox" ${r.on ? 'checked' : ''} onchange="B2B._qtOn(${i},this.checked)"></td><td class="nm">${first ? U.esc(r.name) : ''}</td><td class="ctr va">${U.esc(r.variant)}</td><td class="num pr pc">${U.eur(r.price)}</td><td class="num c-reco">${U.eur(r.reco)}</td><td class="ctr qy"><input type="number" id="qt_q_${i}" min="1" step="1" value="${r.qty}" onchange="B2B._qtQty(${i},this.value)"></td><td id="qt_sub_${i}" class="num pr sb">${r.on ? U.eur(r.sub) : ''}</td></tr>`;
    }).join('');
    const empty = `<tr><td colspan="7" class="muted" style="padding:16px;text-align:center;">${search ? 'Aucune ligne pour cette recherche.' : 'Aucune ligne cochée — utilise « Afficher les décochées » ou les formats ci-dessus.'}</td></tr>`;
    return `<table class="qt-t"><colgroup><col style="width:36px"><col><col style="width:118px"><col style="width:84px"><col class="c-reco" style="width:92px"><col style="width:72px"><col style="width:92px"></colgroup>
      <thead><tr><th class="ck"><input type="checkbox" id="qt_all" ${all.every(r => r.on) ? 'checked' : ''} onchange="B2B._qtAll(this.checked)" title="Tout cocher / tout décocher"></th><th>Produit</th><th class="ctr">Variante</th><th class="num">${U.esc(c.price)}</th><th class="num c-reco" title="${U.esc(c.reco.replace(/\n/g, ' '))}">Conseillé</th><th class="ctr">Qté</th><th class="num">Sous-total</th></tr></thead>
      <tbody>${rows || empty}</tbody></table>`;
  },
  /* Bouton « Afficher / Masquer les N décochées » (absent s'il n'y en a aucune). */
  _qtOffBtn() {
    const nOff = this._qtRows(true).all.filter(r => !r.on).length, s = !!this._qt.showOff;
    return nOff ? `<button type="button" class="btn-ghost btn-sm" onclick="B2B._qtToggleOff()">${s ? '🙈 Masquer' : '👁 Afficher'}<span class="qt-lg"> les</span> ${nOff}<span class="qt-lg"> décochée${nOff > 1 ? 's' : ''}</span></button>` : '';
  },
  _qtToggleOff() { this._qt.showOff = !this._qt.showOff; this._qtRefresh(); },
  _qtSearch(v) { this._qt.q = v; this._qtRefresh(); },
  /* Quantité saisie : mise à jour sur place (sous-total + total), sans redessiner le tableau (le défilement reste). */
  _qtQty(i, val) {
    const all = this._qtRows(true).all, r = all[i]; if (!r) return;
    this._qt.qty = this._qt.qty || {};
    this._qt.qty[r.key] = Math.max(1, Math.round(U.num(val)) || 1);
    const { all: a2 } = this._qtRows(true), r2 = a2[i];
    const sub = document.getElementById('qt_sub_' + i); if (sub) sub.textContent = r2.on ? U.eur(r2.sub) : '';
    const inp = document.getElementById('qt_q_' + i); if (inp && String(inp.value) !== String(r2.qty)) inp.value = r2.qty;
    this._qtChrome();
  },
  /* Case d'une ligne : la ligne décochée sort du devis (total, images, texte) ; elle reste affichée, grisée, jusqu'au prochain rafraîchissement (puis masquée si l'option est active). */
  _qtOn(i, on) {
    const r = this._qtRows(true).all[i]; if (!r) return;
    this._qt.off = this._qt.off || {};
    if (on) delete this._qt.off[r.key]; else this._qt.off[r.key] = true;
    const { all: a2 } = this._qtRows(true), r2 = a2[i];
    const row = document.getElementById('qt_row_' + i); if (row) row.style.opacity = r2.on ? '' : '.4';
    const sub = document.getElementById('qt_sub_' + i); if (sub) sub.textContent = r2.on ? U.eur(r2.sub) : '';
    const all = document.getElementById('qt_all'); if (all) all.checked = a2.every(x => x.on);
    this._qtChrome();
  },
  _qtAll(on) {
    this._qt.off = {};
    if (!on) this._qtRows(true).all.forEach(r => { this._qt.off[r.key] = true; });
    this._qtRefresh();
  },
  /* Éléments hors tableau (barre fixe du haut, formats, n° de devis) : mis à jour à chaque changement. */
  _qtChrome() {
    const set = (id, h) => { const e = document.getElementById(id); if (e) e.innerHTML = h; };
    set('qt_total', this._qtTotalsTxt()); set('qt_offwrap', this._qtOffBtn()); set('qt_fmt', this._qtVarChips());
    this._qtNoRefresh();
  },
  _qtRefresh() { const b = document.getElementById('qt_box'); if (b) b.innerHTML = this._qtInner(); this._qtChrome(); },
  openQuote(type) {
    this._qt = { type, who: '', iban: true, msg: null, per: 20, qty: {}, off: {} };
    const rows = this._qtRows(true).all;
    rows.forEach(r => { if (this._isOffVar(r.variant)) this._qt.off[r.key] = true; });   // formats non proposés aux pros (mémorisés)
    if (!rows.length) { U.toast('Aucun produit à exporter.', true); return; }
    const S = Store.state.settings, hasIban = !!String(S.payIban || '').trim();
    const nSel = this._curItems().filter(x => this._sel[x.id]).length;
    // Mise en page « fenêtre de travail » (2026-10-07) : haut fixe (entreprise, n° de devis, total en direct, recherche, options repliées) /
    // tableau = seule zone qui défile / bas fixe (boutons). Voir `.modal.qt-xl` dans style.css.
    const body = `<div class="qt-layout">
      <div class="qt-top">
        <div class="qt-row">
          <div class="fg qt-who"><label>Entreprise (affichée en haut à gauche)</label><input type="text" id="qt_who" placeholder="nom de l'entreprise…" oninput="B2B._qt.who=this.value;B2B._qtNoRefresh()"></div>
          <div class="qt-no">Devis n° <span id="qt_no">${U.esc(this._dvShow())}</span> <span class="muted help" data-help-anchor="~ .qt-no">Le n° de devis est définitif à la copie ; la lettre avance si tu modifies le devis. ${nSel ? nSel + ' produit(s) coché(s)' : 'Aucun produit coché : tous les produits de l\'onglet'} · ${rows.length} ligne(s) · remise B2B déjà appliquée. Quantité à 1 par défaut : change-la pour chaque ligne. Décoche les variantes que tu ne veux pas proposer (ou un format entier avec les formats ci-dessous).</span></div>
        </div>
        <div class="qt-bar">
          <div id="qt_total" class="qt-total">${this._qtTotalsTxt()}</div>
          <input type="text" id="qt_search" class="qt-search" placeholder="🔍 Chercher un produit…" oninput="B2B._qtSearch(this.value)">
          <span id="qt_offwrap">${this._qtOffBtn()}</span>
        </div>
        <details class="qt-fold"><summary>⚙️ Options du devis — formats proposés, pied de page (IBAN, message)</summary>
          <div class="qt-fold-body">
            <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:5px;">Formats à proposer <span class="muted" style="text-transform:none;letter-spacing:0;">— un clic décoche tous ceux du tableau ; ton choix est mémorisé (aussi pour les exports CSV)</span></div>
            <div id="qt_fmt" style="margin-bottom:12px;">${this._qtVarChips()}</div>
            <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">Afficher en bas</div>
            ${hasIban ? `<label style="display:inline-flex;align-items:center;gap:6px;margin-bottom:8px;"><input type="checkbox" checked onchange="B2B._qt.iban=this.checked;B2B._qtRefresh()"> IBAN</label>` : '<p class="muted" style="font-size:.85rem;margin:0 0 6px;">IBAN : à renseigner dans Paramètres → Réglages financiers → Paniers & livraison.</p>'}
            <textarea class="note-area" rows="2" style="width:100%;" placeholder="Message (vide = rien d'affiché)" oninput="B2B._qt.msg=this.value;B2B._qtRefresh()">${U.esc(String(S.payMessage || ''))}</textarea>
          </div>
        </details>
      </div>
      <div id="qt_box" class="qt-scroll">${this._qtInner()}</div>
    </div>`;
    const bg = U.modal({ title: type === 'micro' ? '🧑‍💼 Tarif — micro-entreprise' : '🏢 Tarif — entreprise (TVA collectée)', body, wide: true, okLabel: '📋 Copier le texte', onOk: () => { B2B.quoteText(); return false; } });
    bg.querySelector('.modal').classList.add('qt-xl');
    // Boutons d'action dans le pied FIXE de la fenêtre (toujours visibles), avec « Fermer » et « Copier le texte ».
    bg.querySelector('.actions').insertAdjacentHTML('afterbegin', `<label class="muted qt-per">lignes max. par image <input type="number" min="5" max="60" step="1" value="20" onchange="B2B._qt.per=this.value"></label>
      <button class="btn-ghost btn-sm" onclick="B2B.quotePending()" title="Garde ce devis (numéro attribué) pour le retrouver plus bas, le modifier ou le passer en vente quand le client accepte">💾 Mettre en attente</button>
      <button class="btn-cta btn-sm" onclick="B2B.quoteImages()" title="Découpe le tarif en plusieurs images lisibles">🖼️ Créer les images</button>`);
  },
  _qtTitle() { const w = String(this._qt.who || '').trim(); return 'Tarif Touffu' + (w ? ' — ' + w : ''); },
  /* Découpe en pages : on remplit une page jusqu'à `per` lignes sans couper un produit en deux (sauf produit plus long qu'une page) */
  _qtPages() {
    const { rows } = this._qtRows(), per = Math.max(5, Math.round(U.num(this._qt.per) || 20));
    const groups = [];
    rows.forEach(r => { const g = groups[groups.length - 1]; if (g && g[0].name === r.name) g.push(r); else groups.push([r]); });
    const pages = []; let cur = [];
    groups.forEach(g => {
      if (cur.length && cur.length + g.length > per) { pages.push(cur); cur = []; }
      g.forEach(r => { if (cur.length >= per) { pages.push(cur); cur = []; } cur.push(r); });
    });
    if (cur.length) pages.push(cur);
    return pages;
  },
  async _qtCanvas(pageRows, pageNo, pageCount) {
    const c = this._qtCols(), x = this._qtExtras(), last = pageNo === pageCount, { devis, total, totalReco } = this._qtRows();
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
    const cs = getComputedStyle(document.documentElement), col = (v, f) => (cs.getPropertyValue(v) || '').trim() || f;
    const bg = col('--card-bg', '#243746'), fg = col('--texte', '#f3ead9'), car = col('--caramel', '#a67153'), th = col('--th-bg', '#1c2b38');
    const font = (w, px) => `${w} ${px}px Quicksand, "Segoe UI", sans-serif`;
    const W = devis ? 1000 : 820, pad = 32, rowH = 40, innerW = W - 2 * pad;
    const tmp = document.createElement('canvas').getContext('2d');
    const wrap = (txt, f) => { tmp.font = f; const out = []; String(txt).split('\n').forEach(par => { let cur = ''; par.split(' ').forEach(w => { const t = cur ? cur + ' ' + w : w; if (tmp.measureText(t).width > innerW - 24 && cur) { out.push(cur); cur = w; } else cur = t; }); out.push(cur); }); return out; };
    const blocks = [];
    if (last && x.ibanLines.length) blocks.push({ f: font(700, 16), l: x.ibanLines.concat(x.refHint ? wrap(x.refHint, font(500, 15)) : []) });
    if (last && x.msg) blocks.push({ f: font(500, 16), l: wrap(x.msg, font(500, 16)) });
    if (last && x.vatMention) blocks.push({ f: font(500, 15), l: wrap(x.vatMention, font(500, 15)) });
    const extraH = blocks.reduce((a, b) => a + b.l.length * 24 + 12, 0);
    const totalH = last && devis ? 84 : 0;
    const H = pad + 56 + 54 + pageRows.length * rowH + totalH + (extraH ? 24 : 0) + extraH + pad;
    const k = 2, cv = document.createElement('canvas');
    cv.width = W * k; cv.height = H * k;
    const g = cv.getContext('2d'); g.scale(k, k);
    g.fillStyle = bg; g.fillRect(0, 0, W, H); g.textBaseline = 'middle';
    const pg = pageCount > 1 ? `${pageNo}/${pageCount}` : '';
    if (pg) { g.fillStyle = car; g.font = font(700, 16); g.textAlign = 'right'; g.fillText(pg, W - pad, pad + 14); }
    g.fillStyle = fg; g.font = font(700, 26); g.textAlign = 'left';
    const dvNo = 'Devis n° ' + this._dvShow();
    g.font = font(700, 18); const dvW = g.measureText(dvNo).width + 24; g.font = font(700, 26);
    let ttl = this._qtTitle(); while (g.measureText(ttl).width > innerW - (pg ? 70 : 0) - dvW && ttl.length > 8) ttl = ttl.slice(0, -2);
    g.fillText(ttl, pad, pad + 14);
    g.fillStyle = car; g.font = font(700, 18); g.textAlign = 'right'; g.fillText(dvNo, W - pad - (pg ? 64 : 0), pad + 14); g.fillStyle = fg; g.font = font(700, 26); g.textAlign = 'left';
    let y = pad + 56;
    // colonnes : liste de prix (4) ou devis (6, avec Qté et Sous-total)
    const L = devis ? { v: .36, p: .53, q: .61, s: .78, r: 1 } : { v: .52, p: .74, q: 0, s: 0, r: 1 };
    const cV = pad + innerW * L.v, cP = pad + innerW * L.p, cQ = pad + innerW * L.q, cS = pad + innerW * L.s, cR = W - pad - 12;
    g.fillStyle = th; g.fillRect(pad, y, innerW, 54);
    g.fillStyle = car; g.font = font(700, 12);
    g.textAlign = 'left'; g.fillText('PRODUIT', pad + 12, y + 27);
    g.textAlign = 'center'; g.fillText('VARIANTE', cV, y + 27);
    const hdr = (t, xx) => { const ls = t.toUpperCase().split('\n'); g.textAlign = 'right'; ls.forEach((l, i) => g.fillText(l, xx, y + 27 + (i - (ls.length - 1) / 2) * 15)); };
    hdr(c.price, cP);
    if (devis) { g.textAlign = 'center'; g.fillText('QTÉ', cQ, y + 27); hdr('Sous-total', cS); }
    hdr(c.reco, cR);
    y += 54; g.strokeStyle = car; g.lineWidth = 2; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
    const nameW = innerW * (devis ? .31 : .46);
    pageRows.forEach((r, i) => {
      if (i % 2) { g.fillStyle = th; g.globalAlpha = .45; g.fillRect(pad, y, innerW, rowH); g.globalAlpha = 1; }
      g.fillStyle = fg; g.font = font(700, 16); g.textAlign = 'left';
      let nm = r.name; while (g.measureText(nm).width > nameW && nm.length > 4) nm = nm.slice(0, -2);
      g.fillText(nm + (nm.length < r.name.length ? '…' : ''), pad + 12, y + rowH / 2);
      g.font = font(500, 15); g.textAlign = 'center'; let vt = r.variant; while (g.measureText(vt).width > innerW * 0.15 && vt.length > 3) vt = vt.slice(0, -2); g.fillText(vt, cV, y + rowH / 2);
      g.font = font(700, 16); g.textAlign = 'right'; g.fillText(U.eur(r.price), cP, y + rowH / 2);
      if (devis) { g.font = font(700, 16); g.textAlign = 'center'; g.fillText(String(r.qty), cQ, y + rowH / 2); g.textAlign = 'right'; g.fillText(U.eur(r.sub), cS, y + rowH / 2); }
      g.font = font(500, 16); g.textAlign = 'right'; g.fillText(U.eur(r.reco), cR, y + rowH / 2);
      y += rowH;
    });
    g.strokeStyle = car; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
    if (totalH) { g.fillStyle = fg; g.font = font(800, 20); g.textAlign = 'right'; g.fillText(this._qtTotalLabel(), cS - 90, y + 26); g.fillText(U.eur(total), cS, y + 26); g.fillStyle = car; g.font = font(700, 17); g.fillText(this._qtRecoLabel(), cR - 120, y + 60); g.fillText(U.eur(totalReco), cR, y + 60); y += totalH; }
    y += 24; g.textAlign = 'left';
    blocks.forEach(b => { g.font = b.f; g.fillStyle = fg; b.l.forEach(t => { g.fillText(t, pad + 12, y + 12); y += 24; }); y += 12; });
    return cv;
  },
  /* Images à partager : une image par page, chacune avec ses boutons (copier / enregistrer) + « tout enregistrer » */
  async quoteImages() {
    try {
      const pages = this._qtPages(), n = pages.length;
      if (!n) { U.toast('Aucune ligne cochée.', true); return; }
      this._dvCommit();   // le devis sort : numéro définitif (lettre suivante si modifié)
      this._qtImgs = [];
      for (let i = 0; i < n; i++) {
        const cv = await this._qtCanvas(pages[i], i + 1, n);
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        if (!blob) throw new Error('image');
        this._qtImgs.push({ blob, url: cv.toDataURL('image/png') });
      }
      this._recordExport(this._qtRows().keys);
      this._qtShowImages();
    } catch (e) { U.toast('Impossible de créer les images.', true); }
  },
  _qtShowImages() {
    const box = document.getElementById('qt_box'); if (!box) return;
    const imgs = this._qtImgs || [], n = imgs.length;
    box.innerHTML = `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <button class="btn-ghost btn-sm" onclick="B2B._qtRefresh()">← Revenir au tableau</button>
        <span class="muted" style="font-size:.85rem;">${n} image${n > 1 ? 's' : ''}${n > 1 ? ` · ${U.qty(this._qt.per || 20)} lignes max. par image` : ''}</span>
        ${n > 1 ? `<button class="btn-ghost btn-sm" onclick="B2B.qtSave(-1)">⬇ Tout enregistrer (${n} images)</button>` : ''}
      </div>
      <div>${imgs.map((im, i) => `<div style="margin-bottom:14px;">
        <div style="display:flex;gap:8px;justify-content:space-between;align-items:center;margin-bottom:4px;"><b>Image ${i + 1}${n > 1 ? ' / ' + n : ''}</b>
          <span><button class="btn-ghost btn-sm" onclick="B2B.qtCopy(${i})">🖼️ Copier</button> <button class="btn-ghost btn-sm" onclick="B2B.qtSave(${i})">⬇ Enregistrer</button></span></div>
        <img src="${im.url}" style="width:100%;border-radius:8px;display:block;" alt="Tarif Touffu ${i + 1}"></div>`).join('')}</div>
      <p class="muted" style="margin:6px 0 0;font-size:.82rem;">Si « Copier » ne marche pas sur cette adresse, fais un clic droit sur l'image → « Copier l'image ».</p>`;
  },
  async qtCopy(i) {
    const im = (this._qtImgs || [])[i]; if (!im) return;
    if (await U.copyImage(im.blob, im.url)) { U.toast(`Image ${i + 1} copiée — colle-la dans ta conversation.`); return; }
    U.toast(window.isSecureContext ? 'Copie impossible : clic droit sur l\'image → « Copier l\'image », ou « Enregistrer ».' : 'Chrome interdit la copie d\'image sur une adresse http:// : ouvre l\'appli en https://touffu-antho.duckdns.org, ou utilise « Enregistrer ». (Adresse vue par Chrome : ' + location.origin + ')', true);
  },
  async qtSave(i) {
    const imgs = this._qtImgs || [], list = i < 0 ? imgs.map((im, k) => [im, k]) : (imgs[i] ? [[imgs[i], i]] : []);
    for (const [im, k] of list) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(im.blob); a.download = imgs.length > 1 ? `tarif-touffu-${k + 1}.png` : 'tarif-touffu.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      if (list.length > 1) await new Promise(r => setTimeout(r, 500));
    }
  },
  quoteText() {
    if (!this._qtRows().rows.length) { U.toast('Aucune ligne cochée.', true); return; }
    const dvNo = this._dvCommit();   // le devis sort : numéro définitif (lettre suivante si modifié)
    const { rows, keys, devis, total, totalReco } = this._qtRows(), x = this._qtExtras(), micro = this._qt.type === 'micro';
    const eur = n => n.toFixed(2).replace('.', ',') + ' €';
    const text = [this._qtTitle(), 'Devis n° ' + dvNo, ''].concat(
      rows.map(r => `• ${r.name}${r.variant ? ' (' + r.variant + ')' : ''} — ${devis ? r.qty + ' × ' : ''}${micro || x.vatMention ? '' : 'HT '}${eur(r.price)}${devis ? ' = ' + eur(r.sub) : ''} · prix de vente conseillé${micro ? '' : ' TTC'} : ${eur(r.reco)}`),
      devis ? ['', this._qtTotalLabel() + ' : ' + eur(total), this._qtRecoLabel() + ' : ' + eur(totalReco)] : [],
      x.ibanLines.length ? [''].concat(x.ibanLines, x.refHint ? [x.refHint] : []) : [], x.msg ? ['', x.msg] : [], x.vatMention ? ['', x.vatMention] : []).join('\n');
    this._recordExport(keys);
    const fb = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); U.toast(ok ? 'Texte copié.' : 'Copie impossible', !ok); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => U.toast('Texte copié.')).catch(fb); else fb();
  },

  /* ═══════════ Formats (variantes) non proposés aux pros — mémorisés (2026-10-03) ═══════════
     settings.b2bOffVariants = libellés de variante (en minuscules) décochés d'office dans les devis ET exclus des exports CSV.
     Se règle d'un clic dans la fenêtre d'un devis (pastilles « Formats à proposer »), seulement là ; les exports CSV appliquent la même liste. */
  _vk(label) { return String(label == null ? '' : label).trim().toLowerCase(); },
  _offList() { const S = Store.state.settings; return Array.isArray(S.b2bOffVariants) ? S.b2bOffVariants : []; },
  _isOffVar(label) { return this._offList().includes(this._vk(label)); },
  _setOffVar(label, off) {
    const S = Store.state.settings, k = this._vk(label), cur = this._offList().filter(x => x !== k);
    if (off) cur.push(k);
    S.b2bOffVariants = cur; Store.save('settings');
  },
  _accVariant(a) { return a.mainWidth || this.accWidths(a)[0] || 'Standard'; },
  _keepRows(rows) { return rows.filter(r => !this._isOffVar(r.label)); },
  _offNote(total, kept) { const n = total - kept; return n > 0 ? ` · ${n} ligne(s) de formats non proposés exclue(s)` : ''; },
  _fmtChip(label, state, onclick, count) {
    const mark = state === 'on' ? '✓ ' : state === 'off' ? '✕ ' : '◐ ';
    return `<button type="button" class="${state === 'on' ? 'btn-cta' : 'btn-ghost'} btn-sm" style="padding:3px 10px;${state === 'off' ? 'text-decoration:line-through;opacity:.75;' : ''}" onclick="${onclick}">${mark}${U.esc(label)}${count != null ? ` <span style="opacity:.75;font-weight:400;">(${count})</span>` : ''}</button>`;
  },
  _qtVarChips() {
    const groups = new Map();
    this._qtRows(true).all.forEach(r => { const k = this._vk(r.variant); if (!groups.has(k)) groups.set(k, { label: r.variant, n: 0, on: 0 }); const g = groups.get(k); g.n++; if (r.on) g.on++; });
    const list = [...groups.values()].sort((a, b) => Ventes._labelCmp(a.label, b.label));
    this._qtVarList = list.map(g => g.label);
    if (list.length < 2) return '';
    return `<div style="display:flex;flex-wrap:wrap;gap:6px;">${list.map((g, i) => this._fmtChip(g.label, g.on === g.n ? 'on' : g.on === 0 ? 'off' : 'mix', `B2B._qtVar(${i})`, g.n)).join('')}</div>`;
  },
  _qtVar(i) {
    const label = (this._qtVarList || [])[i]; if (label == null) return;
    const k = this._vk(label), rows = this._qtRows(true).all.filter(r => this._vk(r.variant) === k), turnOff = rows.every(r => r.on);
    this._qt.off = this._qt.off || {};
    rows.forEach(r => { if (turnOff) this._qt.off[r.key] = true; else delete this._qt.off[r.key]; });
    this._setOffVar(label, turnOff);
    this._qtRefresh();
  },

  /* ═══════════ Devis pro en attente → vente (2026-10-03) ═══════════
     Un devis pro mis en attente est un enregistrement du domaine `baskets` avec kind:'pro' (invisible dans les paniers de la page Paniers).
     Il garde les lignes AVEC leurs prix remisés (figés) : la vente reprend exactement ces prix, donc la marge est calculée sur le prix pro vendu. */
  _proPending() { return (Store.state.baskets || []).filter(r => r.kind === 'pro'); },
  _proPendingCard() {
    const list = this._proPending().slice().sort((a, b) => (b.updated || b.ts || 0) - (a.updated || a.ts || 0));
    if (!list.length) return '';
    const rows = list.map(r => {
      const nb = (r.lines || []).reduce((a, l) => a + U.num(l.qty), 0), d = Math.floor((Date.now() - (r.updated || r.ts || Date.now())) / 86400000);
      return `<tr><td class="col-name"><b>${U.esc(r.name)}</b> ${r.dv && r.dv.base ? `<span class="badge info" title="N° de devis">${U.esc(Devis.no(r.dv))}</span>` : ''} <span class="badge">${r.type === 'micro' ? '🧑‍💼 micro-entreprise' : '🏢 entreprise'}</span></td>
        <td><span class="badge ${d >= 7 ? 'warn' : ''}">⏳ ${d <= 0 ? 'aujourd\'hui' : d === 1 ? 'depuis 1 jour' : 'depuis ' + d + ' jours'}</span></td>
        <td class="num" style="white-space:nowrap;">${nb} art.<br><b>${U.eur(r.total)}</b></td>
        <td style="white-space:nowrap;text-align:right;"><button class="btn-ghost btn-sm" onclick="B2B.resumePro('${r.id}')" title="Rouvrir ce devis pour le modifier">✏️ Reprendre</button> <button class="btn-cta btn-sm" onclick="B2B.sendProToSale('${r.id}')" title="Le client est d'accord : charge les produits, aux prix du devis, dans le ticket de la page Ventes">🛒 Envoyer en vente</button> <button class="btn-icon" onclick="B2B.delPro('${r.id}')" title="Supprimer">🗑️</button></td></tr>`;
    }).join('');
    return `<div class="card" style="margin-top:16px;border-left:4px solid var(--caramel);"><h2>⏳ Devis pro en attente (${list.length})</h2><div class="table-wrap"><table><thead><tr><th class="col-name">Entreprise</th><th>En attente</th><th class="num">Devis</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  },
  quotePending() {
    const who = String(this._qt.who || '').trim();
    if (!who) { U.toast('Indique le nom de l\'entreprise pour mettre le devis en attente.', true); const e = document.getElementById('qt_who'); if (e) e.focus(); return; }
    const { rows, total } = this._qtRows();
    if (!rows.length) { U.toast('Aucune ligne cochée.', true); return; }
    const no = this._dvCommit();   // mise en attente = le devis « sort » : numéro attribué (lettre suivante si modifié)
    const list = Store.state.baskets = Store.state.baskets || [], now = Date.now();
    const data = { kind: 'pro', type: this._qt.type, tab: this.tab || 'mast', name: who, sel: this._curItems().filter(x => this._sel[x.id]).map(x => x.id),
      qty: { ...(this._qt.qty || {}) }, off: { ...(this._qt.off || {}) }, iban: this._qt.iban !== false, msg: this._qt.msg == null ? null : this._qt.msg, per: this._qt.per, dv: { ...this._dvState() }, updated: now,
      lines: rows.map(r => ({ key: r.key, pId: r.pId || '', vid: r.vid || '', aId: r.aId || '', name: r.name, variant: r.variant, qty: r.qty, price: Math.round(r.price * 100) / 100, reco: r.reco })),
      total: Math.round(total * 100) / 100 };
    let rec = this._qt.pendId ? list.find(x => x.id === this._qt.pendId) : null;
    if (rec) Object.assign(rec, data); else { rec = Object.assign({ id: U.uid(), ts: now }, data); list.push(rec); }
    this._qt.pendId = rec.id;
    Store.log('devis pro', `Devis pro en attente — ${who} (${no})`);
    Store.save('baskets', 'journal', 'meta');
    U.closeModal(); this.render();
    U.toast(`Devis pro n° ${no} mis en attente (« Reprendre » ou « Envoyer en vente » plus bas).`);
  },
  resumePro(id) {
    const rec = this._proPending().find(x => x.id === id); if (!rec) return;
    this.tab = rec.tab || 'mast';
    this._setClientQuiet(rec.type);   // le sélecteur suit le type du devis rouvert
    this._sel = {}; (rec.sel || []).forEach(i => { this._sel[i] = true; });
    if (rec.dv && rec.dv.base) { const m = Store.state.meta; m.devisB2B = m.devisB2B || {}; m.devisB2B[rec.type + '|' + String(rec.name).trim().toLowerCase()] = { ...rec.dv, ts: Date.now() }; }
    this.render();
    this.openQuote(rec.type);
    if (!document.getElementById('qt_box')) return;
    Object.assign(this._qt, { who: rec.name, qty: { ...(rec.qty || {}) }, off: { ...(rec.off || {}) }, iban: rec.iban !== false, msg: rec.msg == null ? null : rec.msg, per: rec.per || 20, pendId: rec.id });
    const w = document.getElementById('qt_who'); if (w) w.value = rec.name;
    const ta = document.querySelector('#modalBg textarea.note-area'); if (ta && rec.msg != null) ta.value = rec.msg;
    const ib = document.querySelector('#modalBg input[type=checkbox][onchange*="_qt.iban"]'); if (ib) ib.checked = rec.iban !== false;
    this._qtRefresh();
  },
  async delPro(id) {
    const rec = this._proPending().find(x => x.id === id); if (!rec) return;
    if (!await U.confirm('Supprimer le devis pro en attente de ' + rec.name + ' ?', { okLabel: 'Supprimer' })) return;
    Store.state.baskets = (Store.state.baskets || []).filter(x => x.id !== id);
    Store.save('baskets'); this.render();
  },
  /* variante de stock reliée à une ligne de fiche prix (même fiche + même ligne de variante) */
  _stockUnitFor(units, catId, catVid) {
    for (const p of Store.state.stockM) for (const v of (p.variants || [])) {
      if ((v.catalogId || p.catalogId) === catId && v.catalogVariantId === catVid) { const u = units.find(x => x.key === 'M|' + p.id + '|' + v.id); if (u) return u; }
    }
    return null;
  },
  async sendProToSale(id) {
    const rec = this._proPending().find(x => x.id === id); if (!rec) return;
    const units = Ventes.units(), lines = [], warns = [], general = [];
    (rec.lines || []).forEach(l => {
      const nm = `<b>${U.esc(l.name)}</b> ${U.esc(l.variant || '')}`, qty = U.num(l.qty), price = U.num(l.price);
      const u = l.aId ? units.find(x => x.key === 'A|' + l.aId) : (l.pId && l.vid ? this._stockUnitFor(units, l.pId, l.vid) : null);
      if (!u) { warns.push(`${nm} : aucun produit du stock n'est relié à cette fiche prix — ligne ignorée (relie-la dans Stock ou ajoute-la à la main).`); return; }
      if (u.kind === 'A') {   // accessoire : fait à la commande, jamais bloquant
        lines.push({ u, qty, price, src: 'general' });
        if (qty > U.num(u.availG)) warns.push(`${nm} : stock fini insuffisant (${U.qty(u.availG)} dispo) — fait à la commande, tu pourras l'ajouter quand même.`);
        return;
      }
      const e = Math.min(qty, Math.max(0, U.num(u.availE))), g = qty - e;
      if (e > 0) lines.push({ u, qty: e, price, src: 'event' });
      if (g > 0) {
        lines.push({ u, qty: g, price, src: 'general' });
        general.push(`${nm} : ${e > 0 ? `${U.qty(e)} en événement + ` : ''}<b>${U.qty(g)} en stock général</b>`);
        if (g > U.num(u.availG)) warns.push(`${nm} : stock général insuffisant (${U.qty(g)} à prendre, ${U.qty(u.availG)} dispo).`);
      }
    });
    if (!lines.length) { U.toast('Aucun produit à envoyer.', true); return; }
    const allGen = lines.every(l => l.src === 'general');
    const html = `<p>Les produits sont chargés <b>au prix du devis</b> (remise pro incluse), pour <b>${U.esc(rec.name)}</b>. ${allGen ? 'Aucun n\'est en stock événement : tout sera déduit du stock <b>général</b>.' : 'Ils seront déduits du stock <b>Événement</b>.'} Rien n'est déduit tant que tu n'as pas validé le ticket (et tu y choisis le lot de chaque ligne).</p>
      ${general.length && !allGen ? `<p style="margin-top:10px;"><b>🏬 Pas assez en événement — le manquant vient du stock général :</b></p><ul style="padding-left:18px;">${general.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
      ${warns.length ? `<p style="margin-top:10px;"><b>⚠️ À vérifier :</b></p><ul style="padding-left:18px;">${warns.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}`;
    if (!await U.ask({ title: '🛒 Envoyer le devis pro en vente', okLabel: 'Envoyer en vente', cancelLabel: 'Annuler', html })) return;
    if (Ventes.cart.length && !await U.confirm('Le ticket en cours de la page Ventes contient déjà des articles. Le remplacer par le devis de ' + rec.name + ' ?', { okLabel: 'Remplacer' })) return;
    Ventes.loadFromBasket(rec, lines);
  },

  exportCommercial() {
    const acc = (this.tab || 'mast') === 'acc';
    const items = this._curItems();
    let chosen = items.filter(x => this._sel[x.id]);
    let note = '';
    if (!chosen.length) { chosen = items; note = ' (aucun coché → tous exportés)'; }
    if (!chosen.length) { U.toast('Aucun produit à exporter.', true); return; }
    const lines = [['Nom du produit', 'Variante', 'Prix hors taxes', 'Prix conseillé']];
    const nAll = acc ? chosen.length : chosen.reduce((a, x) => a + x.it.rows.length, 0);
    if (acc) chosen = chosen.filter(x => !this._isOffVar(this._accVariant(x.it.a)));
    else chosen = chosen.map(x => ({ ...x, it: { ...x.it, rows: this._keepRows(x.it.rows) } })).filter(x => x.it.rows.length);
    const nKept = acc ? chosen.length : chosen.reduce((a, x) => a + x.it.rows.length, 0);
    if (!chosen.length) { U.toast('Tous les formats sélectionnés sont exclus (bouton « Formats proposés »).', true); return; }
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
    U.toast(`Export commercial généré${note} : ${chosen.length} produit(s)${this._offNote(nAll, nKept)}.`);
  }
};
