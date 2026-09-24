/* ============================================================
   STATISTIQUES — coeff/marge par variante (public & B2B), KPI,
   graphiques Chart.js + drill-down. Portage de l'ancienne page
   "statistics.html" du Calculateur de Prix — demande explicite
   d'Antho pour retrouver ses stats de coeff/marge.
   Page à part entière (pas un onglet de Synthèses/Tableau de
   bord) : Antho a explicitement demandé de fusionner la valorisation
   (Synthèses) dans le Tableau de bord — redondante avec sa "Vue
   d'ensemble" déjà filtrable — mais de garder cette page de stats
   de PRIX séparée, comme dans son ancienne appli ("Stats" était déjà
   son propre onglet, à part du calculateur/produits/coût/B2B).
   Granularité VARIANTE (pas produit) : un produit acheté au kilo avec
   décote paliers a un coeff qui baisse progressivement par palier, un
   produit acheté à la pièce à prix différent par taille a un coeff
   différent par taille — chaque variante doit pouvoir tomber dans sa
   propre tranche de coefficient, jamais moyennée au niveau produit.
   ============================================================ */
const Stats = {
  detail: null,      // drill-down affiché sous les graphiques
  _charts: {},
  tab: 'price',       // 'price' (coeff/marges) | 'sales' (performance des ventes)
  salesPeriod: 'all', // 'all' | 'year' | '12m'
  salesMetric: 'qty', // 'qty' | 'ca' — métrique des classements & du mensuel
  seasonProduct: '',  // clé produit pour la saisonnalité détaillée
  _dormantOpen: false,
  _topOpen: false,

  toggleTop() { this._topOpen = !this._topOpen; this.render(); },
  setTab(t) { this.tab = t; this.detail = null; this.render(); },
  setSalesPeriod(v) { this.salesPeriod = v; this.seasonProduct = ''; this.render(); },
  setSalesMetric(m) { this.salesMetric = m; this.render(); },
  setSeasonProduct(v) { this.seasonProduct = v; this.render(); },
  toggleDormant() { this._dormantOpen = !this._dormantOpen; this.render(); },

  tabBar() {
    const t = this.tab || 'price';
    return `<div class="card"><div class="frow" style="gap:8px;">
      <button class="${t === 'price' ? 'btn-cta' : 'btn-ghost'}" onclick="Stats.setTab('price')">📊 Prix &amp; marges</button>
      <button class="${t === 'sales' ? 'btn-cta' : 'btn-ghost'}" onclick="Stats.setTab('sales')">🛒 Ventes</button>
    </div></div>`;
  },

  render() {
    U.syncFilters('stats', this, ['tab', 'salesPeriod', 'salesMetric', 'seasonProduct']);
    if ((this.tab || 'price') === 'sales') return this.renderSales();
    return this.renderPrice();
  },

  renderPrice() {
    const S = Store.state.settings;
    const products = Store.state.catalogM;
    // même init paresseuse que B2B.render() : au cas où cette page est ouverte
    // avant la page Revente pro, la remise partagée doit quand même refléter
    // la dernière valeur enregistrée (ou 20% par défaut), pas rester à 0.
    B2B.discount = B2B.discount || U.num(localStorage.getItem('touffu_b2bDiscount')) || 20;
    if (!B2B._noVatLoaded) { B2B.noVat = localStorage.getItem('touffu_b2bNoVat') === 'true'; B2B._noVatLoaded = true; }
    const statsPublic = (p) => this.variantStats(p, false);
    const statsB2B = (p) => this.variantStats(p, true);

    let sumCoeff = 0, sumMargin = 0, nPub = 0, sumCoeffB2B = 0, sumMarginB2B = 0, nB2B = 0;
    const meatCount = {}, supplierCount = {};
    products.forEach(p => {
      const sp = statsPublic(p);
      if (sp) { sumCoeff += sp.avg; sumMargin += sp.marginAvg; nPub++; }
      const sb = statsB2B(p);
      if (sb) { sumCoeffB2B += sb.avg; sumMarginB2B += sb.marginAvg; nB2B++; }
      const meat = p.meatType || 'Non spécifié';
      meatCount[meat] = (meatCount[meat] || 0) + 1;
      const sup = p.mainSupplierId ? Store.supplierName(p.mainSupplierId) : 'Non spécifié';
      supplierCount[sup] = (supplierCount[sup] || 0) + 1;
    });

    const t = U.num(S.b2bCoeffThreshold) || 1;
    const bins = [
      { label: `0 – ${t.toFixed(2)}`, min: 0, max: t },
      { label: `${t.toFixed(2)} – ${(t + 0.5).toFixed(2)}`, min: t, max: t + 0.5 },
      { label: `${(t + 0.5).toFixed(2)} – ${(t + 1).toFixed(2)}`, min: t + 0.5, max: t + 1 },
      { label: `${(t + 1).toFixed(2)} – ${(t + 1.5).toFixed(2)}`, min: t + 1, max: t + 1.5 },
      { label: `${(t + 1.5).toFixed(2)}+`, min: t + 1.5, max: Infinity }
    ];
    const binCounts = (statsFn) => bins.map(b => {
      let n = 0;
      products.forEach(p => { const s = statsFn(p); if (s) n += s.coeffs.filter(c => c >= b.min && c < b.max).length; });
      return n;
    });

    App.mount(`
      <div class="view-title"><h1>Statistiques</h1><span class="sub">coefficients & marges — public et B2B</span></div>
      ${this.tabBar()}
      <div class="grid c4">
        <div class="kpi"><div class="v">${products.length}</div><div class="l">Total produits</div></div>
        <div class="kpi sensitive"><div class="v">${(nPub ? sumCoeff / nPub : 0).toFixed(2)}</div><div class="l">Coeff moyen</div></div>
        <div class="kpi good sensitive"><div class="v">${(nPub ? sumMargin / nPub : 0).toFixed(1)}%</div><div class="l">Marge moyenne</div></div>
        <div class="kpi info2 sensitive"><div class="v">${(nB2B ? sumCoeffB2B / nB2B : 0).toFixed(2)}</div><div class="l">Coeff moyen B2B</div></div>
        <div class="kpi info2 sensitive"><div class="v">${(nB2B ? sumMarginB2B / nB2B : 0).toFixed(1)}%</div><div class="l">Marge moyenne B2B</div></div>
        <div class="kpi"><div class="v">${Object.keys(meatCount).length}</div><div class="l">Viandes</div></div>
        <div class="kpi"><div class="v">${Object.keys(supplierCount).length}</div><div class="l">Fournisseurs</div></div>
      </div>
      <div class="grid c2 mt">
        <div class="card"><h2>🥩 Répartition par type de viande</h2><div style="position:relative;height:260px;">${products.length ? '<canvas id="statsChartMeat"></canvas>' : '<p class="muted">Aucun produit.</p>'}</div></div>
        <div class="card"><h2>🏬 Répartition par fournisseur</h2><div style="position:relative;height:260px;">${products.length ? '<canvas id="statsChartSupplier"></canvas>' : '<p class="muted">Aucun produit.</p>'}</div></div>
      </div>
      <div class="grid c2 mt">
        <div class="card sensitive"><h2>📊 Distribution des coefficients (Public)</h2><div style="position:relative;height:260px;">${products.length ? '<canvas id="statsChartCoeff"></canvas>' : '<p class="muted">Aucun produit.</p>'}</div></div>
        <div class="card sensitive" style="border-left:4px solid var(--caramel);">
          <div class="frow" style="justify-content:space-between;align-items:center;">
            <h2 style="margin:0;">🤝 Distribution des coefficients (B2B)</h2>
            <div class="fg" style="max-width:110px;margin:0;"><label>Remise globale (%)</label><input type="number" step="1" value="${B2B.discount}" onchange="Stats.setB2BDiscount(this.value)"></div>
          </div>
          <div style="position:relative;height:230px;">${products.length ? '<canvas id="statsChartCoeffB2B"></canvas>' : '<p class="muted">Aucun produit.</p>'}</div>
        </div>
      </div>
      <div id="statsDetail"></div>`);

    if (products.length) this.drawCharts(meatCount, supplierCount, bins, binCounts(statsPublic), binCounts(statsB2B), statsPublic, statsB2B);
    if (this.detail) this.renderDetail();
  },

  /* Coeff effectif par variante active d'un produit. En B2B, applique la
     remise globale (B2B.discount) ou la décote propre au produit
     (p.b2bDiscount, gérée sur la page Revente pro) au prix HT avant de
     recalculer le coeff par rapport au coût réel. */
  variantStats(p, isB2B) {
    const S = Store.state.settings;
    const base = Pricing.baseUnitCost(p);
    const discPct = isB2B ? B2B.effectiveDiscount(p) : 0;
    const na = (p.variants || []).filter(v => v.enabled !== false).length;
    let idx = 0;
    const variants = (p.variants || []).filter(v => v.enabled !== false).map(v => {
      const c = Pricing.variantCalc(p, v, idx, base, na); idx++;
      let coeff = c.effCoeff;
      if (isB2B) {
        const proHT = c.priceHT * (1 - discPct / 100);
        coeff = c.cost > 0 ? proHT / c.cost : 0;
      }
      return { label: Pricing.labelVariant(v), coeff, margin: coeff > 0 ? (1 - 1 / coeff) * 100 : 0, critical: coeff < U.num(S.b2bCoeffThreshold) };
    });
    if (!variants.length) return null;
    const coeffs = variants.map(v => v.coeff);
    return { variants, coeffs, avg: coeffs.reduce((a, b) => a + b, 0) / coeffs.length, marginAvg: variants.reduce((a, v) => a + v.margin, 0) / variants.length };
  },

  /* Remise B2B globale partagée avec la page Revente pro (même localStorage
     touffu_b2bDiscount) : la modifier ici la modifie aussi là-bas. */
  setB2BDiscount(v) {
    B2B.discount = U.num(v);
    localStorage.setItem('touffu_b2bDiscount', B2B.discount);
    this.detail = null;
    this.render();
  },

  drawCharts(meatCount, supplierCount, bins, binsPublic, binsB2B, statsPublic, statsB2B) {
    if (typeof Chart === 'undefined') return; // CDN indisponible (hors-ligne) : pas bloquant
    const dark = Theme.get() === 'dark';
    const textColor = dark ? '#eee3d3' : '#1c2b33';
    const borderColor = dark ? '#1c3844' : '#ffffff';
    const palette = ['#a67153', '#4a7c59', '#c0564a', '#b97a24', '#5c6a78', '#7fc4e8', '#d99a78', '#8fd6a4', '#f29d92', '#f0b667', '#c9a8e0', '#6fb1c9', '#e0a1c4', '#9fb98a', '#e8c76a', '#8a9bd6', '#d6866a', '#6fd6c1', '#c98acb', '#a3d66a'];
    Object.values(this._charts).forEach(c => c?.destroy());
    this._charts = {};

    const buildPie = (id, counts, type, onPick) => {
      const canvas = document.getElementById(id); if (!canvas) return;
      const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      const data = labels.map(l => counts[l]);
      this._charts[id] = new Chart(canvas, {
        type,
        data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => palette[i % palette.length]), borderColor, borderWidth: 2 }] },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { position: 'right', labels: { color: textColor, boxWidth: 12, font: { family: 'Quicksand', size: 11 } }, onClick: (e, item, legend) => onPick(legend.chart.data.labels[item.index]) } },
          onClick: (evt, els) => { if (els.length) onPick(labels[els[0].index]); }
        }
      });
    };
    buildPie('statsChartMeat', meatCount, 'doughnut', (label) =>
      this.showDetail(p => (p.meatType || 'Non spécifié') === label, `Viande : ${label}`, statsPublic));
    buildPie('statsChartSupplier', supplierCount, 'pie', (label) =>
      this.showDetail(p => (p.mainSupplierId ? Store.supplierName(p.mainSupplierId) : 'Non spécifié') === label, `Fournisseur : ${label}`, statsPublic));

    const buildBar = (id, counts, statsFn, isB2B) => {
      const canvas = document.getElementById(id); if (!canvas) return;
      this._charts[id] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: bins.map(b => b.label),
          datasets: [{
            label: isB2B ? 'Variantes (B2B)' : 'Variantes (Public)', data: counts, borderRadius: 5,
            backgroundColor: bins.map(b => b.max <= bins[0].max ? '#c0564a' : (isB2B ? '#a67153' : '#4a7c59'))
          }]
        },
        options: {
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true, ticks: { color: textColor, precision: 0 } }, x: { ticks: { color: textColor } } },
          plugins: { legend: { labels: { color: textColor } } },
          onClick: (evt, els) => {
            if (!els.length) return;
            const b = bins[els[0].index];
            this.showDetail(p => { const s = statsFn(p); return s && s.coeffs.some(c => c >= b.min && c < b.max); },
              `Variantes ${isB2B ? 'B2B' : 'Public'} — coeff ${b.label}`, statsFn, b.min, b.max);
          }
        }
      });
    };
    buildBar('statsChartCoeff', binsPublic, statsPublic, false);
    buildBar('statsChartCoeffB2B', binsB2B, statsB2B, true);
  },

  /* Drill-down : liste des produits (groupés par viande) correspondant au
     clic sur une part de camembert ou une barre de coeff, avec pour
     chaque variante son coeff/marge — lien direct vers la fiche produit. */
  showDetail(filterFn, title, statsFn, min, max) {
    const products = Store.state.catalogM.filter(filterFn);
    const groups = {};
    products.forEach(p => { const m = p.meatType || 'Non spécifié'; (groups[m] = groups[m] || []).push(p); });
    this.detail = { title, meats: Object.keys(groups).sort(U.sortFr), groups, statsFn, min: min === undefined ? null : min, max: max === undefined ? null : max };
    this.renderDetail();
    setTimeout(() => document.getElementById('statsDetail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  },

  closeDetail() { this.detail = null; this.renderDetail(); },

  renderDetail() {
    const box = document.getElementById('statsDetail'); if (!box) return;
    if (!this.detail) { box.innerHTML = ''; return; }
    const { title, meats, groups, statsFn, min, max } = this.detail;
    box.innerHTML = `<div class="card mt">
      <div class="frow" style="justify-content:space-between;align-items:center;"><h2 style="margin:0;">${U.esc(title)}</h2><button class="btn-ghost btn-sm" onclick="Stats.closeDetail()">✕ Fermer</button></div>
      ${meats.map(m => {
        const items = groups[m];
        const cards = items.map(p => {
          const s = statsFn(p);
          if (!s) return '';
          const shown = (min == null) ? s.variants : s.variants.filter(v => v.coeff >= min && v.coeff < max);
          if (!shown.length) return '';
          const anyCritical = shown.some(v => v.critical);
          return `<a href="#/catalogue/edit/${p.id}" class="card" style="text-decoration:none;color:inherit;display:block;${anyCritical ? 'border-left:4px solid #c0564a;' : ''}" title="Ouvrir la fiche produit (clic molette : nouvel onglet)">
            <b>${U.esc(p.name)}</b> ${anyCritical ? '<span class="badge bad">critique</span>' : ''}
            <div class="mt">${shown.map(v => `<div class="frow" style="justify-content:space-between;font-size:.8rem;padding:2px 0;">
              <span class="muted">${U.esc(v.label)}</span><span class="sensitive" style="font-weight:600;${v.critical ? 'color:#c0564a;' : 'color:#4a7c59;'}">coeff ${v.coeff.toFixed(3)} · ${v.margin.toFixed(1)}%</span></div>`).join('')}</div>
          </a>`;
        }).join('');
        if (!cards) return '';
        return `<h3 style="margin:16px 0 8px;">🥩 ${U.esc(m.toUpperCase())}</h3><div class="grid c3">${cards}</div>`;
      }).join('') || '<p class="muted mt">Aucun produit dans cette sélection.</p>'}
    </div>`;
  },

  /* ═══════════ ONGLET VENTES — performance commerciale ═══════════
     Exploite l'historique des ventes (Store.state.sales) : best-sellers,
     répartition par canal (en ligne / directe / événement), saisonnalité
     (par mois), synthèse (panier moyen…), CA par catégorie/viande, et
     produits dormants (catalogue jamais vendu sur la période). Toutes les
     données existent déjà dans les ventes enregistrées — rien à ressaisir. */
  _monthLabels: ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'],

  _saleChannelLabel(s) {
    if (s.source === 'event') return 'Événement';
    if (s.channel === 'online') return 'En ligne';
    return 'Directe';
  },
  _prodMeat(pId) {
    if (!pId) return 'Non spécifié';
    const p = Store.state.catalogM.find(x => x.id === pId) || Store.state.stockM.find(x => x.id === pId);
    return p ? (p.meatType || 'Non spécifié') : 'Non spécifié';
  },
  /* Type + largeur d'un accessoire vendu (via son template catalogA), pour les stats accessoires. */
  _accInfo(pId) {
    const a = Store.state.catalogA.find(x => x.id === pId);
    if (!a) return { type: 'Accessoire', width: 'Non spécifié' };
    const width = a.mainWidth || (a.strapWidths && a.strapWidths[0]) || 'Non spécifié';
    return { type: a.category || 'Accessoire', width };
  },

  _salesAgg() {
    const period = this.salesPeriod || 'all';
    const now = Date.now();
    const cut = now - 365 * 86400000;
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    const inPeriod = (ts) => period === 'all' ? true : period === '12m' ? ts >= cut : ts >= yearStart;
    const metric = this.salesMetric === 'ca' ? 'ca' : 'qty';
    // Taux & frais — mêmes formules que le Tableau de bord (CA par mois), pour une compta cohérente.
    const S = Store.state.settings;
    const socStd = U.num(S.socialTaxRate) / 100;
    const socHM = Pricing.socialRateHandmade() / 100;
    const cardRate = U.num(S.cardFeeRate) / 100, stripeRate = U.num(S.stripeFeeRate) / 100;
    const cardBase = (s) => (s.payment === 'sumup' || s.payment === 'stripe') ? U.num(s.total) + U.num(s.shippingFeeCollected) : 0;
    const procFee = (s) => s.payment === 'sumup' ? cardBase(s) * cardRate : s.payment === 'stripe' ? cardBase(s) * stripeRate : 0;
    const allSales = Store.state.sales.filter(s => !s.cancelled);
    const sales = allSales.filter(s => inPeriod(s.ts));
    const prodMap = {};
    const byChannelCA = {}, byCatCA = {}, byMeatCA = {};
    const accType = {}, accWidth = {}; // stats accessoires : par type (Laisse/Collier…) et par largeur, {qty, ca}
    const byMonthQty = new Array(12).fill(0), byMonthCA = new Array(12).fill(0);
    const monthMap = {}; // 'YYYY-MM' -> agrégat chronologique (évolution dans le temps)
    let articles = 0, ca = 0;
    const soldPids = new Set();
    sales.forEach(s => {
      ca += U.num(s.total);
      const ch = this._saleChannelLabel(s);
      const mo = new Date(s.ts).getMonth();
      const mk = new Date(s.ts).toISOString().slice(0, 7);
      const my = monthMap[mk] || (monthMap[mk] = { key: mk, ca: 0, caAcc: 0, cogs: 0, articles: 0, nSales: 0, fee: 0, shipFee: 0, shipping: 0, boxCost: 0, eventFee: 0 });
      my.ca += U.num(s.total); my.nSales++;
      my.fee += procFee(s); my.shipFee += U.num(s.shippingFeeCollected); my.shipping += U.num(s.shippingCost); my.eventFee += U.num(s.eventFee);
      (s.items || []).forEach(i => {
        if (i.kind === 'C') { my.boxCost += Pricing.saleItemCost(i); return; } // consommables (carton…) : coût compté à part, pas en produit vendu
        const qty = U.num(i.qty), rev = U.num(i.price) * qty;
        articles += qty; my.articles += qty; my.cogs += Pricing.saleItemCost(i);
        if (i.kind === 'A') {
          my.caAcc += rev;
          const info = this._accInfo(i.pId);
          const at = accType[info.type] || (accType[info.type] = { qty: 0, ca: 0 }); at.qty += qty; at.ca += rev;
          const aw = accWidth[info.width] || (accWidth[info.width] = { qty: 0, ca: 0 }); aw.qty += qty; aw.ca += rev;
        }
        const key = i.pId || ('name:' + (i.name || '?'));
        let g = prodMap[key];
        if (!g) g = prodMap[key] = { key, name: i.name || '(sans nom)', qty: 0, ca: 0, kind: i.kind, pId: i.pId, meat: i.kind === 'M' ? this._prodMeat(i.pId) : '—', saleIds: new Set(), month: new Array(12).fill(0) };
        g.qty += qty; g.ca += rev; g.saleIds.add(s.id); g.month[mo] += (metric === 'ca' ? rev : qty);
        if (i.pId) soldPids.add(i.pId);
        byChannelCA[ch] = (byChannelCA[ch] || 0) + rev;
        const cat = i.kind === 'A' ? 'Accessoires' : 'Mastication';
        byCatCA[cat] = (byCatCA[cat] || 0) + rev;
        if (i.kind === 'M') { const m = this._prodMeat(i.pId); byMeatCA[m] = (byMeatCA[m] || 0) + rev; }
        byMonthQty[mo] += qty; byMonthCA[mo] += rev;
      });
    });
    const products = Object.values(prodMap).map(g => ({ ...g, sales: g.saleIds.size }));
    // Produits dormants : fiches du catalogue jamais vendues SUR LA PÉRIODE.
    const lastSold = {};
    allSales.forEach(s => (s.items || []).forEach(i => { if (i.pId) lastSold[i.pId] = Math.max(lastSold[i.pId] || 0, s.ts); }));
    const dormant = [];
    Store.state.catalogM.forEach(p => { if (!soldPids.has(p.id)) dormant.push({ name: p.name, cat: p.meatType || '—', last: lastSold[p.id] || null }); });
    Store.state.catalogA.forEach(a => { if (!soldPids.has(a.id)) dormant.push({ name: a.name, cat: 'Accessoire', last: lastSold[a.id] || null }); });
    dormant.sort((a, b) => (a.last || 0) - (b.last || 0));
    const months = Object.values(monthMap).sort((a, b) => a.key < b.key ? -1 : 1);
    const vatRate = U.num(S.vatRate);
    const uvMaint = Pricing.fixedOverheadMonthly(); // entretien UV + amortissement de tout le matériel, réparti par mois (0 si non renseigné)
    months.forEach(m => {
      m.marge = m.ca - m.cogs; // marge brute (CA − coût de revient des produits vendus)
      m.tva = vatRate > 0 ? m.ca * vatRate / (100 + vatRate) : 0; // TVA contenue dans le CA TTC (taux global, approximation)
      m.cotis = m.caAcc * socHM + (m.ca - m.caAcc + m.shipFee) * socStd; // accessoires au taux fait main, reste + port au taux marchandises
      m.uvMaint = uvMaint; // charge fixe machine (filtres + nettoyage + main d'œuvre entretien)
      // Non assujetti : la TVA reste dans le bénéfice (tu la gardes). Assujetti : elle est reversée → déduite.
      m.net = m.ca - m.cogs + m.shipFee - m.fee - m.shipping - m.boxCost - m.eventFee - m.cotis - m.uvMaint - (S.vatActive ? m.tva : 0);
    });
    return { nSales: sales.length, articles, ca, products, byChannelCA, byCatCA, byMeatCA, accType, accWidth, byMonthQty, byMonthCA, months, dormant, sales };
  },

  _monthKeyLabel(key) { const [y, mo] = String(key).split('-'); return (this._monthLabels[+mo - 1] || mo) + ' ' + y; },

  /* Tableau « Rentabilité par activité » (Mastication vs Accessoires) à partir d'un résultat Pricing.activityPnL.
     Réutilisé par la page Stats et le Tableau de bord. */
  _activityTable(p) {
    const va = Store.state.settings.vatActive;
    const M = p.masti, A = p.acc;
    const line = (lbl, key, sign) => {
      const mv = M[key], av = A[key];
      const cls = sign === '-' ? 'neg' : sign === '+' ? 'pos' : '';
      const fmt = v => !v ? '—' : (sign === '-' ? '− ' : sign === '+' ? '+ ' : '') + U.eur(v);
      return `<tr><td>${lbl}</td><td class="num sensitive ${cls}">${fmt(mv)}</td><td class="num sensitive ${cls}">${fmt(av)}</td></tr>`;
    };
    return `<div class="table-wrap mt"><table>
      <thead><tr><th>Poste</th><th class="num">🥩 Mastication</th><th class="num">🐕 Accessoires</th></tr></thead>
      <tbody>
        <tr><td>Chiffre d'affaires</td><td class="num sensitive">${U.eur(M.ca)}</td><td class="num sensitive">${U.eur(A.ca)}</td></tr>
        ${line('Coût de revient', 'cogs', '-')}
        <tr><td><b>Marge brute</b></td><td class="num sensitive ${M.marge >= 0 ? 'pos' : 'neg'}"><b>${U.eur(M.marge)}</b></td><td class="num sensitive ${A.marge >= 0 ? 'pos' : 'neg'}"><b>${U.eur(A.marge)}</b></td></tr>
        ${line('Port encaissé', 'shipFee', '+')}
        ${line('Frais paiement', 'fee', '-')}
        ${line('Frais d\'envoi réel', 'shipping', '-')}
        ${line('Frais stand', 'eventFee', '-')}
        ${line('Coût cartons', 'box', '-')}
        ${line('Cotisations URSSAF', 'cotis', '-')}
        ${va ? line('TVA (reversée)', 'tva', '-') : ''}
        ${line('Charges fixes matériel', 'fixed', '-')}
      </tbody>
      <tfoot><tr><td><b>Bénéfice net</b></td><td class="num sensitive ${M.net >= 0 ? 'pos' : 'neg'}"><b>${U.eur(M.net)}</b></td><td class="num sensitive ${A.net >= 0 ? 'pos' : 'neg'}"><b>${U.eur(A.net)}</b></td></tr></tfoot>
    </table></div>
    <p class="muted" style="margin-top:6px;font-size:.8rem;">« Charges fixes matériel » = entretien imprimante UV (→ accessoires) + amortissement du matériel réparti sur la période (tagué mastication/accessoires directement, « commun » au prorata du CA). ${va ? '' : 'TVA non déduite (non assujetti) — affichée pour info seulement si tu coches « assujetti ».'}</p>`;
  },

  renderSales() {
    const agg = this._salesAgg();
    const metric = this.salesMetric === 'ca' ? 'ca' : 'qty';
    const mLabel = metric === 'ca' ? 'CA' : 'Quantité';
    const periodOpts = [{ v: 'all', l: 'Tout l’historique' }, { v: 'year', l: 'Cette année' }, { v: '12m', l: '12 derniers mois' }];
    const top = agg.products.slice().sort((a, b) => metric === 'ca' ? b.ca - a.ca : b.qty - a.qty).slice(0, 20);
    const topAcc = agg.products.filter(p => p.kind === 'A').sort((a, b) => metric === 'ca' ? b.ca - a.ca : b.qty - a.qty).slice(0, 15);
    const hasAcc = Object.keys(agg.accType || {}).length > 0;
    const prodOpts = [{ v: '', l: '— choisir un produit —' }].concat(agg.products.slice().sort((a, b) => U.sortFr(a.name, b.name)).map(p => ({ v: p.key, l: p.name })));
    const hasSales = agg.nSales > 0;
    const totCogs = agg.months.reduce((a, m) => a + m.cogs, 0);
    const totNet = agg.months.reduce((a, m) => a + m.net, 0);
    const totMarge = agg.ca - totCogs;
    const hasChannel = Object.keys(agg.byChannelCA || {}).length > 0;
    const hasCat = Object.keys(agg.byCatCA || {}).length > 0;
    const hasMeat = Object.keys(agg.byMeatCA || {}).length > 0;

    App.mount(`
      <div class="view-title"><h1>Statistiques</h1><span class="sub">performance des ventes</span></div>
      ${this.tabBar()}
      <div class="card">
        <div class="frow" style="gap:16px;align-items:flex-end;flex-wrap:wrap;">
          <div class="fg" style="max-width:220px;margin:0;"><label>Période</label>${U.customSelect({ value: this.salesPeriod, options: periodOpts, onPick: 'Stats.setSalesPeriod' })}</div>
          <div class="fg" style="margin:0;"><label>Classer par</label><div class="frow" style="gap:6px;">
            <button class="btn-ghost btn-sm ${metric === 'qty' ? 'active' : ''}" onclick="Stats.setSalesMetric('qty')">Quantité</button>
            <button class="btn-ghost btn-sm ${metric === 'ca' ? 'active' : ''}" onclick="Stats.setSalesMetric('ca')">Chiffre d'affaires</button>
          </div></div>
        </div>
        <p class="muted" style="margin-top:8px;">Basé sur tes ventes enregistrées. ⚠️ Les ventes de marché <b>sans SKU</b> (non importées) n'apparaissent pas ici — le classement devient précis à mesure que tu remplis les SKU côté SumUp.</p>
      </div>
      ${!hasSales ? '<div class="card empty"><span class="big">🛒</span>Aucune vente sur cette période.</div>' : `
      <div class="grid c4">
        <div class="kpi"><div class="v">${agg.nSales}</div><div class="l">Ventes</div></div>
        <div class="kpi"><div class="v">${U.qty(agg.articles)}</div><div class="l">Articles vendus</div></div>
        <div class="kpi sensitive"><div class="v">${U.eur(agg.ca)}</div><div class="l">Chiffre d'affaires</div></div>
        <div class="kpi sensitive"><div class="v">${U.eur(agg.nSales ? agg.ca / agg.nSales : 0)}</div><div class="l">Panier moyen</div></div>
        <div class="kpi good sensitive"><div class="v">${U.eur(totMarge)}</div><div class="l">Marge brute</div></div>
        <div class="kpi ${totNet >= 0 ? 'good' : 'bad'} sensitive"><div class="v">${U.eur(totNet)}</div><div class="l">Bénéfice net</div></div>
        <div class="kpi"><div class="v">${(agg.nSales ? agg.articles / agg.nSales : 0).toFixed(1)}</div><div class="l">Articles / vente</div></div>
        <div class="kpi"><div class="v">${agg.products.length}</div><div class="l">Produits vendus</div></div>
      </div>

      <div class="grid ${hasChannel ? 'c2' : ''} mt">
        <div class="card"><h2>🏆 Top produits (${mLabel})</h2>
          <div style="position:relative;height:230px;"><canvas id="salesTopChart"></canvas></div>
          <button class="btn-ghost btn-sm mt" onclick="Stats.toggleTop()">${this._topOpen ? 'Masquer le classement' : `Voir le classement complet (Top ${top.length})`}</button>
          ${this._topOpen ? `<div class="table-wrap mt"><table><thead><tr><th>#</th><th class="col-name">Produit</th><th class="num">Quantité</th><th class="num sensitive">CA</th><th class="num">Ventes</th></tr></thead>
          <tbody>${top.map((p, i) => `<tr><td>${i + 1}</td><td class="col-name"><b>${U.esc(p.name)}</b>${p.kind === 'A' ? ' <span class="badge info">accessoire</span>' : ''}</td><td class="num">${U.qty(p.qty)}</td><td class="num sensitive">${U.eur(p.ca)}</td><td class="num">${p.sales}</td></tr>`).join('')}</tbody></table></div>` : ''}
        </div>
        ${hasChannel ? `<div class="card"><h2>🛍️ Répartition par canal (CA)</h2><div style="position:relative;height:230px;"><canvas id="salesChannelChart"></canvas></div></div>` : ''}
      </div>

      <div class="card mt"><h2>📈 Détail par mois — CA & rentabilité</h2>
        <p class="muted">Évolution réelle mois par mois (chronologique, années distinctes) — avec la même compta que le Tableau de bord.</p>
        <div style="position:relative;height:190px;"><canvas id="salesTimelineChart"></canvas></div>
        ${(() => {
          const va = Store.state.settings.vatActive;
          const uvM = Pricing.fixedOverheadMonthly(); // entretien UV + amortissement matériel / mois (0 si non renseigné)
          const T = agg.months.reduce((a, m) => ({ n: a.n + m.nSales, ca: a.ca + m.ca, cogs: a.cogs + m.cogs, shipFee: a.shipFee + m.shipFee, fee: a.fee + m.fee, shipping: a.shipping + m.shipping, box: a.box + m.boxCost, ev: a.ev + m.eventFee, uv: a.uv + m.uvMaint, cotis: a.cotis + m.cotis, tva: a.tva + m.tva, net: a.net + m.net }), { n: 0, ca: 0, cogs: 0, shipFee: 0, fee: 0, shipping: 0, box: 0, ev: 0, uv: 0, cotis: 0, tva: 0, net: 0 });
          T.marge = T.ca - T.cogs;
          const cell = (v, cls) => `<td class="num sensitive ${cls || ''}">${v ? (cls === 'neg' ? '− ' : cls === 'pos' ? '+ ' : '') + U.eur(v) : '—'}</td>`;
          const margeCell = (v) => `<td class="num sensitive ${v >= 0 ? 'pos' : 'neg'}">${U.eur(v)}</td>`;
          // TVA : reversée (déduite, rouge) si assujetti ; sinon conservée (dans le bénéfice, affichée en info).
          // Assujetti → TVA reversée (rouge, déduite) ; non assujetti → conservée (vert, dans le bénéfice).
          const tvaCell = (v) => va ? `<td class="num sensitive neg" title="TVA reversée — déduite du bénéfice (assujetti)">${v ? '− ' + U.eur(v) : '—'}</td>` : `<td class="num sensitive pos" title="TVA contenue dans le CA — conservée dans ton bénéfice (non assujetti)">${v ? U.eur(v) : '—'}</td>`;
          const uvCell = (v) => uvM ? `<td class="num sensitive neg" title="Entretien imprimante UV + amortissement de tout le matériel (imprimante, extracteur, scelleuse…) réparti par mois">− ${U.eur(v)}</td>` : '';
          const row = (label, m) => `<tr><td class="col-name"><b>${label}</b></td><td class="num">${m.nSales}</td><td class="num sensitive">${U.eur(m.ca)}</td>${cell(m.cogs, 'neg')}${margeCell(m.marge)}${cell(m.shipFee, 'pos')}${cell(m.fee, 'neg')}${cell(m.shipping, 'neg')}${cell(m.eventFee, 'neg')}${cell(m.boxCost, 'neg')}${uvCell(m.uvMaint)}<td class="num sensitive neg">− ${U.eur(m.cotis)}</td>${tvaCell(m.tva)}<td class="num sensitive ${m.net >= 0 ? 'pos' : 'neg'}"><b>${U.eur(m.net)}</b></td></tr>`;
          return `<div class="table-wrap mt"><table>
            <thead><tr><th class="col-name">Mois</th><th class="num">Ventes</th><th class="num">CA</th><th class="num">Coût revient</th><th class="num">Marge brute</th><th class="num">Port encaissé</th><th class="num">Frais paiement</th><th class="num">Frais d'envoi</th><th class="num">Frais stand</th><th class="num">Coût cartons</th>${uvM ? '<th class="num">Entretien matériel</th>' : ''}<th class="num">Cotisations URSSAF</th><th class="num">TVA ${va ? '(reversée)' : '(conservée)'}</th><th class="num">Bénéfice net</th></tr></thead>
            <tbody>${agg.months.slice().reverse().map(m => row(this._monthKeyLabel(m.key), m)).join('') || `<tr><td colspan="${uvM ? 14 : 13}" class="muted">Aucune vente.</td></tr>`}</tbody>
            <tfoot><tr><td class="col-name"><b>Total</b></td><td class="num">${T.n}</td><td class="num sensitive">${U.eur(T.ca)}</td>${cell(T.cogs, 'neg')}${margeCell(T.marge)}${cell(T.shipFee, 'pos')}${cell(T.fee, 'neg')}${cell(T.shipping, 'neg')}${cell(T.ev, 'neg')}${cell(T.box, 'neg')}${uvCell(T.uv)}<td class="num sensitive neg">− ${U.eur(T.cotis)}</td>${tvaCell(T.tva)}<td class="num sensitive ${T.net >= 0 ? 'pos' : 'neg'}"><b>${U.eur(T.net)}</b></td></tr></tfoot>
          </table></div>
          <p class="muted" style="margin-top:6px;font-size:.8rem;">« Marge brute » = CA − coût de revient des produits vendus. « Bénéfice net » = marge brute + port encaissé − frais paiement − frais d'envoi − frais stand − coût cartons − cotisations URSSAF${va ? ' − TVA reversée' : ''}. ${va ? 'TVA <b>reversée</b> (assujetti) : déduite du bénéfice.' : 'TVA <b>conservée</b> dans ton bénéfice (non assujetti) — la colonne TVA montre le montant contenu dans le CA ; elle sera déduite automatiquement le jour où tu coches « assujetti à la TVA » dans Paramètres → Réglages financiers.'} Coût de revient <b>exact</b> pour les ventes récentes (figé à la vente), <b>estimé</b> au coût actuel pour les ventes antérieures.</p>`;
        })()}
      </div>

      <div class="card mt"><h2>📊 Rentabilité par activité</h2>
        <p class="muted">Mastication (achat-revente) vs accessoires (fait main), sur la période choisie. Chaque article compte dans son activité ; les frais et charges fixes communs sont répartis au prorata du CA (l'entretien/amortissement UV va aux accessoires). La somme des deux = le bénéfice net global.</p>
        ${this._activityTable(Pricing.activityPnL(agg.sales, Math.max(1, agg.months.length)))}
      </div>

      <div class="card mt"><h2>📅 Saisonnalité — ${mLabel} par mois</h2>
        <p class="muted">Toutes années confondues sur la période : à quelle période de l'année ça se vend le plus.</p>
        <div style="position:relative;height:200px;"><canvas id="salesMonthChart"></canvas></div>
        <div class="frow mt" style="align-items:flex-end;gap:12px;flex-wrap:wrap;">
          <div class="fg" style="max-width:340px;margin:0;"><label>Saisonnalité d'un produit précis</label>${U.customSelect({ value: this.seasonProduct, options: prodOpts, onPick: 'Stats.setSeasonProduct' })}</div>
        </div>
        ${this.seasonProduct ? '<div style="position:relative;height:190px;margin-top:10px;"><canvas id="salesSeasonChart"></canvas></div>' : ''}
      </div>

      ${(hasCat || hasMeat) ? `<div class="grid ${hasCat && hasMeat ? 'c2' : ''} mt">
        ${hasCat ? '<div class="card"><h2>🐕 CA par catégorie</h2><div style="position:relative;height:200px;"><canvas id="salesCatChart"></canvas></div></div>' : ''}
        ${hasMeat ? '<div class="card"><h2>🍖 CA par type de viande</h2><div style="position:relative;height:200px;"><canvas id="salesMeatChart"></canvas></div></div>' : ''}
      </div>` : ''}

      ${hasAcc ? `<div class="card mt"><h2>🦮 Accessoires — performance</h2>
        <p class="muted">Répartition de tes ventes d'accessoires par type et par largeur (${mLabel}). ℹ️ La couleur n'est pas encore suivie par vente (un seul SKU par modèle) — on pourra l'ajouter plus tard si tu veux le détail par couleur.</p>
        <div class="grid c2">
          <div><h3 style="font-size:.9rem;">Par type</h3><div style="position:relative;height:200px;"><canvas id="salesAccTypeChart"></canvas></div></div>
          <div><h3 style="font-size:.9rem;">Par largeur</h3><div style="position:relative;height:200px;"><canvas id="salesAccWidthChart"></canvas></div></div>
        </div>
        <div class="table-wrap mt"><table><thead><tr><th>#</th><th class="col-name">Accessoire</th><th class="num">Quantité</th><th class="num sensitive">CA</th><th class="num">Ventes</th></tr></thead>
        <tbody>${topAcc.map((p, i) => `<tr><td>${i + 1}</td><td class="col-name"><b>${U.esc(p.name)}</b></td><td class="num">${U.qty(p.qty)}</td><td class="num sensitive">${U.eur(p.ca)}</td><td class="num">${p.sales}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aucune vente d\'accessoire.</td></tr>'}</tbody></table></div>
      </div>` : ''}

      <div class="card mt"><h2>💤 Produits dormants <span class="muted">(${agg.dormant.length})</span></h2>
        <p class="muted">Produits du catalogue jamais vendus sur cette période — candidats au déstockage / à ne pas racheter.</p>
        ${agg.dormant.length ? `<button class="btn-ghost btn-sm" onclick="Stats.toggleDormant()">${this._dormantOpen ? 'Masquer' : 'Afficher la liste'}</button>
        ${this._dormantOpen ? `<div class="table-wrap mt"><table><thead><tr><th class="col-name">Produit</th><th>Catégorie</th><th>Dernière vente</th></tr></thead>
          <tbody>${agg.dormant.map(d => `<tr><td class="col-name">${U.esc(d.name)}</td><td>${U.esc(d.cat)}</td><td>${d.last ? U.frDate(new Date(d.last).toISOString().slice(0, 10)) : '<span class="muted">jamais</span>'}</td></tr>`).join('')}</tbody></table></div>` : ''}` : '<p class="muted">Aucun — tous tes produits se sont vendus au moins une fois. 🎉</p>'}
      </div>
      `}`);

    if (hasSales) this.drawSalesCharts(agg);
  },

  drawSalesCharts(agg) {
    if (typeof Chart === 'undefined') return;
    const dark = Theme.get() === 'dark';
    const textColor = dark ? '#eee3d3' : '#1c2b33';
    const borderColor = dark ? '#1c3844' : '#ffffff';
    const palette = ['#a67153', '#4a7c59', '#c0564a', '#b97a24', '#5c6a78', '#7fc4e8', '#d99a78', '#8fd6a4', '#f29d92', '#f0b667', '#c9a8e0', '#6fb1c9', '#e0a1c4', '#9fb98a', '#e8c76a', '#8a9bd6', '#d6866a', '#6fd6c1', '#c98acb', '#a3d66a'];
    Object.values(this._charts).forEach(c => c?.destroy());
    this._charts = {};
    const metric = this.salesMetric === 'ca' ? 'ca' : 'qty';
    const mLabel = metric === 'ca' ? 'CA' : 'Quantité';
    const fmtV = (v) => metric === 'ca' ? U.eur(v) : U.qty(v);

    // Top produits — barres horizontales
    const top = agg.products.slice().sort((a, b) => metric === 'ca' ? b.ca - a.ca : b.qty - a.qty).slice(0, 12);
    const topC = document.getElementById('salesTopChart');
    if (topC && top.length) this._charts.top = new Chart(topC, {
      type: 'bar',
      data: { labels: top.map(p => p.name), datasets: [{ data: top.map(p => metric === 'ca' ? p.ca : p.qty), backgroundColor: '#a67153', borderRadius: 5 }] },
      options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtV(c.parsed.x) } } }, scales: { x: { beginAtZero: true, ticks: { color: textColor } }, y: { ticks: { color: textColor, font: { size: 10 } } } } }
    });

    const buildPie = (id, counts, type, fmt) => {
      const canvas = document.getElementById(id); if (!canvas) return;
      const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      if (!labels.length) return;
      this._charts[id] = new Chart(canvas, {
        type,
        data: { labels, datasets: [{ data: labels.map(l => counts[l]), backgroundColor: labels.map((_, i) => palette[i % palette.length]), borderColor, borderWidth: 2 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: textColor, boxWidth: 12, font: { family: 'Quicksand', size: 11 } } }, tooltip: { callbacks: { label: (c) => ` ${c.label} : ${(fmt || U.eur)(c.parsed)}` } } } }
      });
    };
    buildPie('salesChannelChart', agg.byChannelCA, 'doughnut');
    buildPie('salesCatChart', agg.byCatCA, 'doughnut');
    buildPie('salesMeatChart', agg.byMeatCA, 'pie');
    // Accessoires : par type + par largeur, selon la métrique choisie (qté / CA)
    const accTypeCounts = {}, accWidthCounts = {};
    Object.entries(agg.accType || {}).forEach(([k, v]) => accTypeCounts[k] = metric === 'ca' ? v.ca : v.qty);
    Object.entries(agg.accWidth || {}).forEach(([k, v]) => accWidthCounts[k] = metric === 'ca' ? v.ca : v.qty);
    buildPie('salesAccTypeChart', accTypeCounts, 'doughnut', fmtV);
    buildPie('salesAccWidthChart', accWidthCounts, 'doughnut', fmtV);

    // Évolution chronologique mois par mois (vrais mois, années distinctes)
    const tl = agg.months || [];
    const tlC = document.getElementById('salesTimelineChart');
    if (tlC && tl.length) this._charts.timeline = new Chart(tlC, {
      type: 'bar',
      data: { labels: tl.map(m => this._monthKeyLabel(m.key)), datasets: [{ label: mLabel, data: tl.map(m => metric === 'ca' ? m.ca : m.articles), backgroundColor: '#5c6a78', borderRadius: 5 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtV(c.parsed.y) } } }, scales: { y: { beginAtZero: true, ticks: { color: textColor } }, x: { ticks: { color: textColor, maxRotation: 60, font: { size: 10 } } } } }
    });

    // Saisonnalité mensuelle
    const monthData = metric === 'ca' ? agg.byMonthCA : agg.byMonthQty;
    const monthC = document.getElementById('salesMonthChart');
    if (monthC) this._charts.month = new Chart(monthC, {
      type: 'bar',
      data: { labels: this._monthLabels, datasets: [{ label: mLabel, data: monthData, backgroundColor: '#4a7c59', borderRadius: 5 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtV(c.parsed.y) } } }, scales: { y: { beginAtZero: true, ticks: { color: textColor } }, x: { ticks: { color: textColor } } } }
    });

    // Saisonnalité d'un produit précis
    if (this.seasonProduct) {
      const g = agg.products.find(p => p.key === this.seasonProduct);
      const seasonC = document.getElementById('salesSeasonChart');
      if (g && seasonC) this._charts.season = new Chart(seasonC, {
        type: 'bar',
        data: { labels: this._monthLabels, datasets: [{ label: g.name, data: g.month, backgroundColor: '#b97a24', borderRadius: 5 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { labels: { color: textColor } }, tooltip: { callbacks: { label: (c) => ' ' + fmtV(c.parsed.y) } } }, scales: { y: { beginAtZero: true, ticks: { color: textColor } }, x: { ticks: { color: textColor } } } }
      });
    }
  }
};
