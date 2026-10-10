/* ============================================================
   CATALOGUE MASTICATION — tarification (repris du Calculateur)
   Deux vues : liste (cartes) et éditeur pleine page (créer/modifier),
   séparées comme deux "pages" via le hash (#/catalogue,
   #/catalogue/new, #/catalogue/edit/<id>) — voir App.routeFor/_onHashChange.
   ============================================================ */
const Catalogue = {
  /* Petite ligne « dont port » sous le coût de revient quand un taux de port à l'achat (Paramètres) est appliqué : le coût affiché l'inclut déjà. */
  _portNote(c) { return c && c.portCost > 0.0005 ? `<div class="muted" style="font-size:.72rem;font-weight:400;" title="Frais de port d'achat estimés (Paramètres → Réglages financiers → Frais de port d'achat estimés), déjà compris dans le coût de revient">dont frais de port estimés ${U.eur(c.portCost)}</div>` : ''; },
  filters: { q: '', meat: 'all', sup: 'all', ctl: 'all', sort: 'meat', sortDir: 'asc' },
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
  _setCtlFilter(val) { this.filters.ctl = val; this.render(); },

  /* ---------- menu « Contrôle » (filtre d'aide au contrôle des fiches) ---------- */
  _CTL: [
    ['all', 'Tous'],
    ['crit', '⚠ Coeff critique'],
    ['under', '📉 Vendu sous le coût de revient'],
    ['own', '🎚 Coeff ou décote personnalisé'],
    ['px_old', '🕒 Prix à vérifier : plus de 30 jours ou jamais daté'],
    ['px_old90', '🕒 Prix à vérifier : plus de 90 jours ou jamais daté'],
    ['px_new', '✅ Prix mis à jour ces 30 derniers jours'],
    ['px_none', '❔ Prix jamais daté'],
    ['vat0', '🧾 Sans TVA d\'achat : 0 %'],
    ['vat10', '🧾 TVA d\'achat à 10 %'],
    ['vat20', '🧾 TVA d\'achat à 20 %'],
    ['vatOwn', '🧾 TVA d\'achat propre à la fiche'],
    ['noRef', '📝 Sans réf. fournisseur'],
    ['noUrl', '📝 Sans lien fournisseur'],
    ['noPpk', '📝 Vente à la pièce sans pièces par kilo'],
    ['noSku', '📝 Variante sans SKU'],
    ['unlinked', '🔗 Non relié au Stock'],
    ['linked', '🔗 Relié au Stock'],
    ['t_gram', '⚖ Vendu au poids'],
    ['t_piece', '🔢 Vendu à la pièce'],
    ['t_size', '📏 Vendu par taille'],
    ['inactive', '🙈 Avec variantes désactivées'],
    ['cheaper', '💡 Principal pas le moins cher']
  ],
  /* Calculs de toutes les variantes ACTIVES d'une fiche (même position/décote que dans la liste) */
  _activeCalcs(p) {
    const base = Pricing.baseUnitCost(p), act = (p.variants || []).filter(v => v.enabled !== false);
    return act.map((v, i) => Pricing.variantCalc(p, v, i, base, act.length));
  },
  /* Date de dernière mise à jour du prix d'achat du fournisseur principal (0 = jamais datée) */
  priceDateOf(p, supId) { const s = Pricing.mainEntry(p, supId); return (s && U.num(s.priceDate)) || 0; },
  _ageDays(ts) { return ts ? Math.floor((Date.now() - ts) / 86400000) : null; },
  _ageTxt(ts) {
    const d = this._ageDays(ts); if (d === null) return '';
    const ago = d <= 0 ? 'aujourd\'hui' : d === 1 ? 'hier' : d < 60 ? d + ' j' : Math.round(d / 30) + ' mois';
    return new Date(ts).toLocaleDateString('fr-FR') + ' · ' + ago;
  },
  _ctlMatch(p, key, linked) {
    if (key === 'all') return true;
    const main = Pricing.mainEntry(p), act = (p.variants || []).filter(v => v.enabled !== false);
    const vatOf = () => main ? Pricing.purchaseVatOf(main.supplierId, main.vatRate) : null;
    const age = this._ageDays(this.priceDateOf(p));
    switch (key) {
      case 'crit': return this._activeCalcs(p).some(c => c.critical);
      case 'under': return this._activeCalcs(p).some(c => c.margin < 0);
      case 'own': return (p.bulkDiscount !== undefined && p.bulkDiscount !== '' && p.bulkDiscount !== null) || act.some(v => U.num(v.coeff) > 0);
      case 'px_old': return age === null || age > 30;
      case 'px_old90': return age === null || age > 90;
      case 'px_new': return age !== null && age <= 30;
      case 'px_none': return age === null;
      case 'vat0': return vatOf() === 0;
      case 'vat10': return vatOf() === 10;
      case 'vat20': return vatOf() === 20;
      case 'vatOwn': return !!main && main.vatRate !== undefined && main.vatRate !== '' && U.num(main.vatRate) !== Pricing.purchaseVatOf(main.supplierId, '');
      case 'noRef': return !main || !String(main.ref || '').trim();
      case 'noUrl': return !main || !String(main.url || '').trim();
      case 'noPpk': return !!main && (main.unit || 'kilo') === 'kilo' && !(U.num(main.piecesPerKilo) > 0) && act.some(v => v.mode === 'piece');
      case 'noSku': return act.some(v => !String(v.sku || '').trim());
      case 'unlinked': return !linked.has(p.id);
      case 'linked': return linked.has(p.id);
      case 't_gram': return act.some(v => v.mode === 'gram');
      case 't_piece': return act.some(v => v.mode === 'piece');
      case 't_size': return act.some(v => v.mode === 'size');
      case 'inactive': return (p.variants || []).some(v => v.enabled === false);
      case 'cheaper': return !!this._cheaper(p);
    }
    return true;
  },

  /* ═══════════ FICHE DE CONTRÔLE DES PRIX (Antho 2026-10-10) ═══════════
     Liste imprimable / téléchargeable des variantes vendues : produit, variante, SKU, sachet, coeff, prix TTC — pour pointer au stylo, vérifier les cohérences et comparer avec d'autres outils
     (autre appli, prix d'événements). Filtres COMBINABLES : fournisseur principal, viande, grammage/format (vide = tous). Même coeff et même prix que la fiche (Pricing.variantCalc).
     Sorties : 🖨 impression (classe print-target : seule cette carte s'imprime), image PNG (copier / enregistrer, comme les devis), Excel .xlsx (bibliothèque SheetJS chargée au premier clic). */
  sheet: { open: false, sup: [], meat: [], size: [], group: 'meat', supOpen: false, meatOpen: false, sizeOpen: false },
  sheetShow() { this.sheet.open = !this.sheet.open; this.render(); },
  setSheetGroup(g) { this.sheet.group = g; this.render(); },
  _sheetOptions() {
    const cat = Store.state.catalogM || [];
    return {
      sup: [...new Set(cat.map(p => p.mainSupplierId).filter(Boolean).map(id => Store.supplierName(id)))].sort(U.sortFr),
      meat: [...new Set(cat.map(p => p.meatType || 'Non spécifié'))].sort(U.sortFr),
      size: [...new Set(cat.flatMap(p => (p.variants || []).filter(v => v.enabled !== false).map(v => Pricing.labelVariant(v)).filter(Boolean)))].sort(U.sortFr)
    };
  },
  _sheetRows() {
    const sh = this.sheet, rows = [], hide = Store.hideSupplierInfo();
    (Store.state.catalogM || []).forEach(p => {
      const meat = p.meatType || 'Non spécifié', sup = p.mainSupplierId ? Store.supplierName(p.mainSupplierId) : '—';
      if (sh.meat.length && !sh.meat.includes(meat)) return;
      if (!hide && sh.sup.length && !sh.sup.includes(sup)) return;
      const base = Pricing.baseUnitCost(p), vs = (p.variants || []).filter(v => v.enabled !== false);
      vs.forEach((v, i) => {
        const label = Pricing.labelVariant(v); if (sh.size.length && !sh.size.includes(label)) return;
        const c = Pricing.variantCalc(p, v, i, base, vs.length), pk = Store.sachet(v.sachetId);
        rows.push({ id: p.id, name: p.name, meat, sup: hide ? '' : sup, variant: label, sku: v.sku || '', pack: pk ? pk.name : '', coeff: c.effCoeff, price: c.priceTTC });
      });
    });
    const key = r => sh.group === 'sup' ? r.sup : sh.group === 'meat' ? r.meat : '';
    rows.sort((a, b) => U.sortFr(key(a), key(b)) || U.sortFr(a.name, b.name));   // tri stable : les variantes gardent l'ordre de la fiche
    return rows;
  },
  _sheetGroups(rows) {
    const sh = this.sheet, out = [];
    rows.forEach(r => {
      const label = sh.group === 'sup' ? (r.sup || '—') : sh.group === 'meat' ? r.meat : '';
      let g = out[out.length - 1]; if (!g || g.label !== label) { g = { label, rows: [] }; out.push(g); }
      g.rows.push(r);
    });
    return out;
  },
  _sheetSummary() {
    const sh = this.sheet, hide = Store.hideSupplierInfo();
    return [sh.meat.length ? 'Viandes : ' + sh.meat.join(', ') : '', !hide && sh.sup.length ? 'Fournisseurs : ' + sh.sup.join(', ') : '', sh.size.length ? 'Formats : ' + sh.size.join(', ') : ''].filter(Boolean).join(' · ') || 'Tous les produits';
  },
  _sheetHTML() {
    const sh = this.sheet, rows = this._sheetRows(), grp = this._sheetGroups(rows), o = this._sheetOptions(), hide = Store.hideSupplierInfo();
    const ms = (k, label, opts) => `<div class="fg" style="margin:0;min-width:170px;flex:1 1 170px;"><label>${label}</label>${U.multiSelect({ options: opts, selected: sh[k], toggle: 'Catalogue.sheetTog_' + k, setAll: 'Catalogue.sheetAll_' + k, open: sh[k + 'Open'], onOpen: 'Catalogue.sheetOp_' + k })}</div>`;
    const prodsOf = g => { const out = []; g.rows.forEach(r => { const l = out[out.length - 1]; if (l && l.id === r.id) l.rows.push(r); else out.push({ id: r.id, name: r.name, rows: [r] }); }); return out; };
    const pl = n => n > 1 ? 's' : '';
    const fold = html => grp.length > 1 ? html : U.fold('sheet', rows.length, html, { h: 560, unit: 'lignes' });   // plusieurs groupes : pas de repli, on navigue de groupe en groupe (▲ ▼ / « Aller à »)
    const body = grp.map((g, gi) => {
      const prods = prodsOf(g);
      const head = g.label ? `<tbody class="sheet-gh" id="sg_${gi}"><tr class="sheet-grp"><td colspan="6"><b>${U.esc(g.label)}</b> <span class="muted">(${prods.length} produit${pl(prods.length)} · ${g.rows.length} ligne${pl(g.rows.length)})</span><span class="no-print sheet-nav"><button type="button" class="btn-icon" title="${gi ? 'Groupe précédent' : 'Haut de la fiche'}" onclick="Catalogue.sheetGo(${gi - 1})">▲</button><button type="button" class="btn-icon" title="Groupe suivant" ${gi < grp.length - 1 ? '' : 'disabled'} onclick="Catalogue.sheetGo(${gi + 1})">▼</button></span></td><td class="print-col"></td></tr></tbody>` : '';
      return head + prods.map((pr, i) => `<tbody class="sheet-prod${i % 2 ? ' alt' : ''}">` + pr.rows.map((r, j) => `<tr>${j === 0 ? `<td class="col-name sheet-name" rowspan="${pr.rows.length}"><a href="#/catalogue/edit/${r.id}" title="Ouvrir la fiche">${U.esc(pr.name)}</a></td>` : ''}<td>${U.esc(r.variant)}</td><td>${r.sku ? U.esc(r.sku) : '<span class="muted">—</span>'}</td><td>${r.pack ? U.esc(r.pack) : '<span class="muted">—</span>'}</td><td class="num sensitive">${r.coeff.toFixed(2)}</td><td class="num"><b>${U.eur(r.price)}</b></td><td class="print-col">☐</td></tr>`).join('') + '</tbody>').join('');
    }).join('');
    return `<div class="card print-target" id="ctlSheet">
      <div class="frow no-print" style="justify-content:space-between;align-items:center;"><h2 style="margin:0;">🖨 Fiche de contrôle des prix</h2><button class="btn-ghost btn-sm" onclick="Catalogue.sheetShow()">✕ Fermer</button></div>
      <div class="print-only"><h2 style="margin:0 0 4px;">Fiche de contrôle des prix — mastication</h2><p style="margin:0 0 8px;">${new Date().toLocaleDateString('fr-FR')} · ${rows.length} ligne(s) · ${U.esc(this._sheetSummary())}</p></div>
      <div class="no-print">
        <p class="muted help mb0">Coche des fournisseurs, des viandes et/ou des formats pour cibler la liste (rien de coché = tout). Prix et coeff = ceux de la fiche Prix mastication ; le fournisseur pris en compte est le principal de chaque fiche.</p>
        <div class="frow mt" style="gap:10px;align-items:flex-end;flex-wrap:wrap;">
          ${hide ? '' : ms('sup', 'Fournisseur', o.sup)}${ms('meat', 'Viande', o.meat)}${ms('size', 'Format / grammage', o.size)}
          <div class="fg" style="margin:0;flex:0 0 auto;"><label>Regrouper par</label>${U.seg([['meat', 'Viande'], ...(hide ? [] : [['sup', 'Fournisseur']]), ['none', 'Rien']].map(([k, l]) => ({ l, on: sh.group === k, js: `Catalogue.setSheetGroup('${k}')` })), { sm: true, wrap: true })}</div>
        </div>
        <div class="frow mt" style="gap:6px;align-items:center;flex-wrap:wrap;">
          <button class="btn-cta btn-sm" onclick="Catalogue.sheetPrint()">🖨 Imprimer</button>
          <button class="btn-ghost btn-sm" onclick="Catalogue.sheetImage('copy')">🖼️ Copier l'image</button>
          <button class="btn-ghost btn-sm" onclick="Catalogue.sheetImage('save')">⬇ Image (PNG)</button>
          <button class="btn-ghost btn-sm" onclick="Catalogue.sheetExcel()">📊 Excel (.xlsx)</button>
          <span class="muted" style="margin-left:auto;">${rows.length} ligne(s)</span>
        </div>
        ${grp.length > 1 ? `<div class="frow mt" style="gap:6px;flex-wrap:wrap;align-items:center;"><span class="muted" style="font-size:.8rem;">Aller à :</span>${grp.map((g, gi) => `<button type="button" class="btn-ghost btn-sm" onclick="Catalogue.sheetGo(${gi})">${U.esc(g.label)} <span class="muted">(${prodsOf(g).length})</span></button>`).join('')}</div>` : ''}
      </div>
      ${rows.length ? fold(`<div class="table-wrap mt"><table>
        <thead><tr><th class="col-name" style="text-align:left;">Produit</th><th>Variante</th><th>SKU</th><th>Sachet</th><th class="num">Coeff</th><th class="num">Prix TTC</th><th class="print-col">✔</th></tr></thead>${body}</table></div>`) : '<p class="muted mt">Aucune ligne avec ces filtres.</p>'}
    </div>`;
  },
  /* Groupe précédent / suivant de la fiche (i = -1 : haut de la fiche) */
  sheetGo(i) { const el = document.getElementById(i < 0 ? 'ctlSheet' : 'sg_' + i); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  sheetPrint() {
    document.body.classList.add('print-focus');
    const done = () => { document.body.classList.remove('print-focus'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
    setTimeout(done, 1500);
  },
  /* Image : fond blanc, mêmes lignes que la fiche (sans la case ✔) — hauteur selon le nombre de lignes. */
  _sheetCanvas() {
    const rows = this._sheetRows(), grp = this._sheetGroups(rows), W = 1240, pad = 36, rowH = 30;
    const prodsOf = g => { const out = []; g.rows.forEach(r => { const l = out[out.length - 1]; if (l && l.id === r.id) l.rows.push(r); else out.push({ id: r.id, name: r.name, rows: [r] }); }); return out; };
    const lines = grp.reduce((a, g) => a + g.rows.length + (g.label ? 1 : 0), 0), H = pad + 96 + 44 + Math.max(1, lines) * rowH + pad;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d'), font = (w, s) => `${w} ${s}px Quicksand, "Segoe UI", Arial, sans-serif`;
    const fit = (t, max) => { t = String(t || ''); if (x.measureText(t).width <= max) return t; while (t.length > 1 && x.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; };
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H); x.textBaseline = 'middle';
    x.fillStyle = '#1c2b33'; x.font = font(800, 26); x.fillText('Fiche de contrôle des prix — mastication', pad, pad + 14);
    x.fillStyle = '#5c6a78'; x.font = font(500, 15); x.fillText(fit(new Date().toLocaleDateString('fr-FR') + ' · ' + rows.length + ' ligne(s) · ' + this._sheetSummary(), W - 2 * pad), pad, pad + 48);
    const C = { name: pad + 10, variant: 430, sku: 560, pack: 780, coeff: 1060, price: W - pad - 10 };
    let y = pad + 84;
    x.fillStyle = '#efe6dc'; x.fillRect(pad, y, W - 2 * pad, 40); x.fillStyle = '#6b4a36'; x.font = font(800, 14);
    x.textAlign = 'left'; [['PRODUIT', C.name], ['VARIANTE', C.variant], ['SKU', C.sku], ['SACHET', C.pack]].forEach(([t, px]) => x.fillText(t, px, y + 20));
    x.textAlign = 'right'; x.fillText('COEFF', C.coeff, y + 20); x.fillText('PRIX TTC', C.price, y + 20);
    y += 44;
    grp.forEach(g => {
      const prods = prodsOf(g);
      if (g.label) { x.fillStyle = '#f1e7dc'; x.fillRect(pad, y, W - 2 * pad, rowH); x.fillStyle = '#a67153'; x.font = font(800, 16); x.textAlign = 'left'; x.fillText(`${g.label} (${prods.length} produit${prods.length > 1 ? 's' : ''} · ${g.rows.length} ligne${g.rows.length > 1 ? 's' : ''})`, C.name, y + rowH / 2); y += rowH; }
      prods.forEach((pr, i) => {
        const top = y;
        if (i % 2) { x.fillStyle = '#faf7f3'; x.fillRect(pad, y, W - 2 * pad, pr.rows.length * rowH); }
        pr.rows.forEach((r, j) => {
          x.textAlign = 'left';
          if (j === 0) { x.fillStyle = '#1c2b33'; x.font = font(800, 16); x.fillText(fit(pr.name, C.variant - C.name - 14), C.name, y + rowH / 2); }
          x.font = font(500, 16); x.fillStyle = '#1c2b33'; x.fillText(fit(r.variant, C.sku - C.variant - 14), C.variant, y + rowH / 2);
          x.fillStyle = r.sku ? '#1c2b33' : '#9aa5ae'; x.fillText(fit(r.sku || '—', C.pack - C.sku - 14), C.sku, y + rowH / 2);
          x.fillStyle = r.pack ? '#1c2b33' : '#9aa5ae'; x.fillText(fit(r.pack || '—', C.coeff - 90 - C.pack), C.pack, y + rowH / 2);
          x.fillStyle = '#1c2b33'; x.textAlign = 'right'; x.fillText(r.coeff.toFixed(2).replace('.', ','), C.coeff, y + rowH / 2);
          x.font = font(800, 16); x.fillText(U.eur(r.price), C.price, y + rowH / 2);
          y += rowH;
        });
        x.strokeStyle = '#cdbfae'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(pad, top); x.lineTo(W - pad, top); x.stroke();   // trait entre deux produits
      });
    });
    return cv;
  },
  async sheetImage(mode) {
    try {
      if (!this._sheetRows().length) { U.toast('Aucune ligne à mettre en image.', true); return; }
      const cv = this._sheetCanvas(), blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      if (!blob) throw new Error('image');
      if (mode === 'copy') {
        if (await U.copyImage(blob, cv.toDataURL('image/png'))) { U.toast('Image copiée — colle-la où tu veux.'); return; }
        U.modal({ title: '🖼️ Fiche de contrôle', hideOk: true, wide: true, body: `<p class="muted" style="text-align:center;margin:0 0 8px;">Clic droit sur l'image → « Copier l'image »</p><img src="${cv.toDataURL('image/png')}" style="width:100%;border-radius:8px;display:block;" alt="Fiche de contrôle">` });
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `controle-prix-mastication-${U.today()}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { U.toast('Impossible de créer l’image.', true); }
  },
  _loadXlsx() {
    return new Promise((ok, ko) => {
      if (window.XLSX) return ok();
      const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = () => (window.XLSX ? ok() : ko(new Error('xlsx'))); s.onerror = () => ko(new Error('xlsx')); document.head.appendChild(s);
    });
  },
  async sheetExcel() {
    const rows = this._sheetRows(); if (!rows.length) { U.toast('Aucune ligne à exporter.', true); return; }
    try { await this._loadXlsx(); } catch (e) { U.toast('Impossible de charger la bibliothèque Excel (connexion internet nécessaire). Utilise l’image ou l’impression.', true); return; }
    const hide = Store.hideSupplierInfo();
    const head = ['Viande', 'Produit', 'Variante', 'SKU', 'Sachet', 'Coeff', 'Prix TTC (€)'].concat(hide ? [] : ['Fournisseur']);
    const data = [head].concat(rows.map(r => [r.meat, r.name, r.variant, r.sku, r.pack, Math.round(r.coeff * 100) / 100, Math.round(r.price * 100) / 100].concat(hide ? [] : [r.sup])));
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 14 }, { wch: 34 }, { wch: 16 }, { wch: 24 }, { wch: 26 }, { wch: 8 }, { wch: 13 }, { wch: 18 }];
    for (let i = 1; i < data.length; i++) { ['F', 'G'].forEach(c => { const cell = ws[c + (i + 1)]; if (cell) cell.z = '0.00'; }); }
    ws['!autofilter'] = { ref: ws['!ref'] };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Prix mastication');
    XLSX.writeFile(wb, `controle-prix-mastication-${U.today()}.xlsx`);
    U.toast('Fichier Excel téléchargé (' + rows.length + ' lignes).');
  },

  /* ALERTE « le principal n'est pas le moins cher » (Antho 2026-10-10) : compare le COÛT RÉEL d'achat (Pricing.baseUnitCost : TVA d'achat comprise tant que non assujetti, comme tout le reste)
     du fournisseur principal aux autres fournisseurs de la fiche, à même unité (kg ou pièce) ; écart < 1 % ignoré ; fournisseurs sans prix ignorés.
     « Garder ce principal » (keepMain) mémorise la paire + les deux coûts dans p.mainOkSig : l'alerte revient toute seule si un prix change. Rien d'automatique : c'est Antho qui change le principal. */
  _cheaper(p, ignoreOk) {
    if (Store.hideSupplierInfo()) return null;
    const list = p.suppliers || []; if (list.length < 2) return null;
    const main = Pricing.mainEntry(p); if (!main) return null;
    const bm = Pricing.baseUnitCost(p, main.supplierId); if (!(bm.unitCost > 0)) return null;
    let best = null;
    list.forEach(s => {
      if (s.supplierId === main.supplierId || !(U.num(s.price) > 0)) return;
      const b = Pricing.baseUnitCost(p, s.supplierId);
      if (b.unit !== bm.unit || !(b.unitCost > 0) || b.unitCost >= bm.unitCost * 0.99) return;
      if (!best || b.unitCost < best.unitCost) best = { supplierId: s.supplierId, unitCost: b.unitCost, unit: b.unit };
    });
    if (!best) return null;
    const gap = bm.unitCost - best.unitCost;
    const sig = [main.supplierId, best.supplierId, bm.unitCost.toFixed(4), best.unitCost.toFixed(4)].join('|');
    if (!ignoreOk && p.mainOkSig === sig) return null;
    return { ...best, name: Store.supplierName(best.supplierId), mainName: Store.supplierName(main.supplierId), gap, pct: gap / bm.unitCost * 100, sig };
  },
  keepMain(prodId) {
    const p = Store.state.catalogM.find(x => String(x.id) === String(prodId)); if (!p) return;
    const ch = this._cheaper(p, true); if (!ch) return;
    const snap = Store.snapshot('catalogM', p);
    p.mainOkSig = ch.sig;
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Principal gardé malgré un fournisseur moins cher — ' + p.name);
    Store.save('catalogM');
    U.toast('Principal gardé : plus d\'alerte tant que les prix ne changent pas.', false, entry.id);
    App.rerender();
  },

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
    const linked = new Set();
    Store.state.stockM.forEach(sp => { if (sp.catalogId) linked.add(sp.catalogId); (sp.variants || []).forEach(sv => { if (sv.catalogId) linked.add(sv.catalogId); }); });
    let list = Store.state.catalogM.filter(p =>
      this._ctlMatch(p, f.ctl || 'all', linked) &&
      (!f.q || U.has(p.name, f.q)) &&
      (f.meat === 'all' || (p.meatType || '').toLowerCase() === f.meat.toLowerCase()) &&
      (f.sup === 'all' || (f.sup === '_multi' ? (p.suppliers || []).length >= 2 : f.sup === '_single' ? (p.suppliers || []).length <= 1 : (p.suppliers || []).some(s => s.supplierId === f.sup)))
    );
    const dir = f.sortDir === 'desc' ? -1 : 1;
    const hasCritical = (p) => this._activeCalcs(p).some(c => c.critical);
    list.sort((a, b) => {
      if (f.sort === 'name') return dir * U.sortFr(a.name, b.name);
      if (f.sort === 'priceDate') return dir * ((this.priceDateOf(a) - this.priceDateOf(b)) || U.sortFr(a.name, b.name));
      if (f.sort === 'supplier') return dir * U.sortFr(Store.supplierName(a.mainSupplierId), Store.supplierName(b.mainSupplierId));
      if (f.sort === 'base') return dir * (Pricing.baseUnitCost(a).unitCost - Pricing.baseUnitCost(b).unitCost);
      if (f.sort === 'critical') return dir * ((hasCritical(b) - hasCritical(a)) || U.sortFr(a.name, b.name));
      return dir * U.sortFr((a.meatType || '') + a.name, (b.meatType || '') + b.name); // 'meat' (défaut)
    });
    const sortHead = (key, label) => `<span class="sortable ${f.sort === key ? 'active' : ''}" onclick="Catalogue.setSort('${key}')">${label} ${f.sort === key ? (f.sortDir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;

    App.mount(`
      <div class="view-title"><h1>Prix mastication</h1><span class="sub">${list.length === Store.state.catalogM.length ? Store.state.catalogM.length + ' produits' : list.length + ' sur ' + Store.state.catalogM.length + ' produits'} · coefficient, marges & profit</span></div>
      <div class="toolbar">
        <div class="fg"><label>Recherche</label><input id="cf_q" value="${U.esc(f.q)}" placeholder="nom du produit…" oninput="Catalogue.filters.q=this.value;Catalogue.render();document.getElementById('cf_q').focus();document.getElementById('cf_q').setSelectionRange(999,999)"></div>
        <div class="fg"><label>Viande</label>${U.meatFilter({ current: f.meat, meats: S.meatTypes, count: Store.state.catalogM.length, setter: 'Catalogue._setMeatFilter', openState: this._meatFilterOpen, openSetter: 'Catalogue._meatFilterOpen' })}</div>
        <div class="fg"><label>Fournisseur</label>${U.customSelect({ value: f.sup, options: [{v:'all',l:'Tous'},{v:'_multi',l:'Multi fournisseurs'},{v:'_single',l:'Un seul fournisseur'}].concat(Store.suppliersOf('mastication').map(s => ({v:s.id,l:Store.supplierName(s.id)})).sort((a,b) => U.sortFr(a.l,b.l))), onPick: 'Catalogue._setSupFilter' })}</div>
        <div class="fg"><label>Contrôle</label>${U.customSelect({ value: f.ctl || 'all', options: this._CTL.map(([v, l]) => ({ v, l })), onPick: 'Catalogue._setCtlFilter' })}</div>
        <button class="btn ${this.sheet.open ? 'btn-cta' : 'btn-ghost'}" onclick="Catalogue.sheetShow()" title="Liste imprimable / téléchargeable : produit, variante, SKU, sachet, coeff, prix">🖨 Fiche de contrôle</button>
        <a class="btn btn-cta" style="text-decoration:none;text-align:center;" href="#/catalogue/new">＋ Nouveau produit</a>
      </div>
      ${this.sheet.open ? this._sheetHTML() : ''}
      ${(() => { const n = (f.ctl || 'all') === 'cheaper' ? 0 : Store.state.catalogM.filter(p => this._cheaper(p)).length; return n ? `<div class="card" style="border-left:4px solid var(--warn);display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between;"><span>💡 <b>${n} produit${n > 1 ? 's' : ''}</b> : le fournisseur principal n'est pas le moins cher.</span><button class="btn-ghost btn-sm" onclick="Catalogue._setCtlFilter('cheaper')">Les voir</button></div>` : ''; })()}
      ${list.length ? `<div class="toolbar" style="margin-top:-8px">
        ${U.seg([{ l: '📂 Tout développer', js: 'Catalogue.expandAll()' }, { l: '📁 Tout réduire', js: 'Catalogue.collapseAll()' }], { sm: true })}
      </div>` : ''}
      ${list.length ? `<div class="prod-list-header cat-header">
        <span>${sortHead('name', 'Nom du produit')}</span>
        <span>${sortHead('critical', 'Alertes')}</span>
        <span>${sortHead('meat', 'Viande')}</span>
        <span>${sortHead('supplier', 'Fournisseurs')} · ${sortHead('priceDate', '📅 MAJ')}</span>
        <span class="right">${sortHead('base', 'Variantes / base')}</span>
        <span style="text-align:right">Coeff commun · Décote paliers</span>
        <span></span>
      </div>` : ''}
      ${list.map(p => this.card(p)).join('') || (Store.state.catalogM.length ? `<div class="card empty"><span class="big">🔎</span>Aucun produit ne correspond à ces filtres.</div>` : `<div class="card empty"><span class="big">🥩</span>Aucun produit. Crée ton premier produit ou importe ton fichier <b>Prix_final.json</b> depuis Paramètres → Import.</div>`)}
      ${this._sel.size ? `<div class="cat-sel-bar">
        <span class="cat-sel-count">${this._sel.size} produit${this._sel.size>1?'s':''} sélectionné${this._sel.size>1?'s':''}</span>
        ${this._sel.size>=2?'<button class="btn btn-cta btn-sm" onclick="Catalogue.mergeSelected()">🔀 Fusionner</button>':''}
        ${this._sel.size===1?'<button class="btn btn-ghost btn-sm" onclick="Catalogue.duplicateSelected()">👥 Dupliquer</button>':''}
        <button class="btn-danger btn-sm" onclick="Catalogue.deleteSelected()">🗑️ Supprimer</button>
        <button class="btn-ghost btn-sm" onclick="Catalogue.clearSel()">Annuler</button>
      </div>` : ''}
    `);
    this._teamLock();
  },

  setSort(key) {
    const f = this.filters;
    if (f.sort === key) f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc';
    else { f.sort = key; f.sortDir = 'asc'; }
    this.render();
  },

  /* Prix d'achat HT/u d'une fiche fournisseur (même formule que Pricing.baseUnitCost) */
  supUnitHT(s) {
    const vat = 1 + Pricing.purchaseVatOf(s.supplierId, s.vatRate) / 100;
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
    // Produit « par taille » : chaque taille a son propre prix d'achat → base / coeff commun / décote n'ont pas de sens
    const perSize = actives.length > 0 && actives.every(v => v.mode === 'size' && (U.num(v.value) > 0 || U.num(v.weight) > 0));
    let sizeMeta = '', sizeCoeff = '';
    if (perSize) {
      const calcs = actives.map((v, k) => Pricing.variantCalc(p, v, k, base, na));
      const costs = calcs.map(c => c.cost), cfs = calcs.map(c => c.effCoeff || c.coeff || 0);
      const rng = (arr, f) => { const lo = Math.min(...arr), hi = Math.max(...arr); return Math.abs(hi - lo) < 0.005 ? f(lo) : f(lo) + ' → ' + f(hi); };
      sizeMeta = `<span style="white-space:nowrap;">${na} taille(s) · <span class="sensitive">coût ${rng(costs, x => U.eur(x))}</span></span>`;
      sizeCoeff = `<span class="b2b-disc-badge sensitive" style="width:auto;" title="Chaque taille a son propre prix d'achat et son propre coefficient (voir le tableau)"><label>Coeff</label><span style="padding:0 8px;font-weight:700;">${rng(cfs, x => x.toFixed(2))}</span></span>`;
    }
    const ch = this._cheaper(p);   // fournisseur moins cher que le principal (ou null)
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
        const profitAssujetti = margin - social;
        const profitActuel = priceTTC - cost - priceTTC * (U.num(S.socialTaxRate) / 100);
        c = { ...cRaw, priceHT, priceTTC, coeff, margin, social, vatAmt, profitAssujetti, profitActuel, effCoeff: coeff, priceFixed: true, critical: coeff < U.num(S.b2bCoeffThreshold) };
      }
      if (on) { idx++; if (c.critical) critCount++; }
      return `<tr class="${on ? '' : 'dim'}">
        <td class="col-name"><b>${U.esc(Pricing.labelVariant(v))}</b>${c.critical && on ? ' <span class="badge bad">coeff critique</span>' : ''}</td>
        <td class="num sensitive">${U.eur(c.cost)}${Catalogue._portNote(c)}</td>
        <td class="ctr sensitive">${this.coeffCell(c, `Catalogue.setCardCoeff('${p.id}','${v.id}',this.value)`, `Catalogue.resetCardLine('${p.id}','${v.id}')`, perSize ? undefined : (U.num(p.coefficient) || 2))}</td>
        <td class="num sensitive">${U.eur(c.priceHT)}</td>
        <td class="num sensitive num-marge">${U.eur(c.margin)}</td>
        <td class="num sensitive num-cotis">${U.eur(c.social)}</td>
        <td class="num sensitive ${S.vatActive ? 'num-cotis' : 'num-marge'}">${S.vatActive ? '− ' : ''}${U.eur(c.priceTTC - c.priceHT)}</td>
        <td class="num sensitive num-benef-cell ${c.profitAssujetti >= 0 ? 'pos' : 'neg'}" data-normal="${U.eur(c.profitAssujetti)}" data-peek="${U.eur(S.vatActive ? c.profitAssujetti : c.profitActuel)}"><b>${U.eur(c.profitAssujetti)}</b></td>
        <td class="num"><b><input type="number" step="0.10" value="${c.priceTTC.toFixed(2)}" style="width:85px;text-align:right;font-weight:700;" onchange="Catalogue.setCardPriceTTC('${p.id}','${v.id}',this.value,${on ? curIdx : -1})"></b></td>
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
      const vatOwn = s.vatRate !== undefined && s.vatRate !== '', vatSup = (Store.state.settings.suppliers || []).some(x => x.id === s.supplierId && x.purchaseVatRate !== undefined && x.purchaseVatRate !== '');
      const vatNote = (vatOwn || vatSup) ? ` <span class="muted">(TVA achat ${Pricing.purchaseVatOf(s.supplierId, s.vatRate)}%)</span>` : '';
      const link = (s.url && !Store.hideSupplierInfo()) ? ` <button class="btn-icon" title="Ouvrir la page fournisseur" onclick="window.open('${U.esc(s.url)}','_blank','noopener')">🔗</button>` : '';
      return `<tr class="${isMain ? '' : 'dim'}">
        <td class="col-name">${isMain ? '★ ' : ''}${U.esc(Store.supplierName(s.supplierId))}${vatNote}${link}${ch && ch.supplierId === s.supplierId ? ` <span class="badge ok" title="Coût d'achat réel plus bas que le principal">💡 −${U.pct(ch.pct)}</span>` : ''}</td>
        <td class="num sensitive">${U.eur(this.supUnitHT(s))}/${s.unit === 'kilo' ? 'kg' : 'pc'} HT</td>
        <td class="muted" style="white-space:nowrap;">${this._ageTxt(U.num(s.priceDate) || 0)}</td>
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
        <b>${U.esc(p.name)}</b>${(() => { const t = this._ageTxt(this.priceDateOf(p, activeSup)); return t ? `<span class="px-date" title="Prix d'achat mis à jour le ${t}">${t}</span>` : ''; })()}
        <span>${critCount ? '<span class="badge bad">⚠ coeff critique</span>' : ''}${ch ? ` <span class="badge warn" title="${U.esc(ch.name)} est moins cher que le principal (${U.esc(ch.mainName)}) : −${U.pct(ch.pct)}">💡 moins cher ailleurs</span>` : ''}</span>
        <span><span class="badge info">${U.esc(p.meatType || '—')}</span></span>
        <span class="sup-badges" onclick="event.stopPropagation()">${(p.suppliers || []).length ? supBadges : '<span class="muted">—</span>'}</span>
        <span class="meta right">${perSize ? sizeMeta : `${actives.length} variante(s) · base <span class="sensitive kg-hl">${U.eur(base.unitCost)}/${base.unit === 'kilo' ? 'kg' : 'pc'}${base.k > 1 ? ' TTC' : ''}</span>${base.unit === 'kilo' && base.ppk > 0 ? ' <span class="kg-hl">' + U.qty(base.ppk) + ' pc/kg</span>' : ''} <i>(${base.src})</i>`}</span>
        <span class="cat-head-inputs" onclick="event.preventDefault();event.stopPropagation()">${perSize ? sizeCoeff : `<span class="b2b-disc-badge" title="Coefficient commun : appliqué à toutes les variantes qui n'ont pas leur propre coefficient (diminué de la décote paliers)">
          <label>Coeff</label><input type="number" min="0" step="0.01" value="${Math.round((U.num(p.coefficient) || 2) * 100) / 100}" class="sensitive" onchange="Catalogue.setCardCommonCoeff('${p.id}',this.value)"></span>
        <span class="b2b-disc-badge">
          <label>Décote</label><input type="number" min="0" max="100" step="1" value="${p.bulkDiscount ?? ''}" placeholder="${S.bulkDiscount}" title="Décote paliers propre à ce produit — vide = suit le réglage global (${S.bulkDiscount}%)" onchange="Catalogue.setCardBulkDiscount('${p.id}',this.value)"><span>%</span>
        </span>`}</span>
        <span onclick="event.stopPropagation();Catalogue.toggleSel('${p.id}')"><button class="btn btn-sm ${selected?'cat-sel-active':'btn-ghost'}">${selected?'✓ Sélectionné':'Sélectionner'}</button></span>
      </summary>
      <div class="fold-body">
        ${ch ? `<div style="border-left:4px solid var(--warn);padding:8px 12px;margin-bottom:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <span>💡 <b>${U.esc(ch.name)}</b> est moins cher que ton principal <b>${U.esc(ch.mainName)}</b> : <b class="sensitive">−${U.eur(ch.gap)}/${ch.unit === 'kilo' ? 'kg' : 'pc'}</b> (−${U.pct(ch.pct)}) <span class="muted">· coût d'achat réel${base.k > 1 ? ", TVA d'achat comprise" : ""}</span></span>
          <button class="btn-cta btn-sm" onclick="Catalogue.setMain('${p.id}','${ch.supplierId}')">Passer ${U.esc(ch.name)} principal</button>
          <button class="btn-ghost btn-sm" onclick="Catalogue.keepMain('${p.id}')" title="Tu gardes ce principal exprès (qualité, délai…) : l'alerte disparaît jusqu'au prochain changement de prix">Garder ${U.esc(ch.mainName)}</button>
        </div>` : ''}
        ${preview ? '<div class="badge warn" style="margin-bottom:8px;">Comparaison avec ' + U.esc(Store.supplierName(preview)) + ' — les prix ci-dessous sont temporaires, cliquer à nouveau pour revenir au principal</div>' : ''}
        <div class="table-wrap"><table>
          <thead><tr><th class="col-name">Variante</th><th class="num">Coût de revient</th><th class="ctr">Coeff</th><th class="num">Prix HT</th><th class="num">Marge</th><th class="num" style="white-space:normal;line-height:1.2;">Cotisations<br>URSSAF</th><th class="num">TVA ${S.vatActive ? '(reversée)' : '(conservée)'}</th><th class="num th-benef" style="cursor:pointer;user-select:none;" title="Maintenir l'appui : voir bénéfice + TVA" onmousedown="Catalogue.peekBenefTVA(true)" onmouseup="Catalogue.peekBenefTVA(false)" onmouseleave="Catalogue.peekBenefTVA(false)" ontouchstart="event.preventDefault();Catalogue.peekBenefTVA(true)" ontouchend="Catalogue.peekBenefTVA(false)" ontouchcancel="Catalogue.peekBenefTVA(false)">Bénéfice</th><th class="num">Prix TTC</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9" class="muted">Aucune variante.</td></tr>'}</tbody></table></div>
        ${inactiveVars.length ? `<button class="btn-ghost btn-sm mt" onclick="Catalogue.toggleInactive('${p.id}')" style="font-size:.78rem;">${showInactive ? 'Masquer' : 'Afficher'} les ${inactiveVars.length} variante${inactiveVars.length > 1 ? 's' : ''} désactivée${inactiveVars.length > 1 ? 's' : ''}</button>` : ''}
        <p class="muted help mt" data-help-anchor="~ th.th-benef">* bénéfice = marge − cotisations URSSAF − TVA (toujours hors TVA, quel que soit ton statut) · maintiens l'appui sur « Bénéfice » pour voir bénéfice + TVA conservée · coût = produit + sachet + étiquette.</p>
        <h3 style="font-size:.85rem;margin:14px 0 6px;">Fournisseurs</h3>
        <div class="table-wrap"><table>
          <thead><tr><th class="col-name">Fournisseur</th><th class="num">Prix d'achat</th><th>Prix mis à jour</th><th></th></tr></thead>
          <tbody>${supRows || '<tr><td colspan="4" class="muted">Aucun fournisseur renseigné.</td></tr>'}</tbody></table></div>
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

  async deleteSelected() {
    const sel = [...this._sel];
    const products = sel.map(id => Store.state.catalogM.find(p => String(p.id) === String(id))).filter(Boolean);
    if (!products.length) return;
    const msg = products.length === 1
      ? 'Supprimer "' + products[0].name + '" du catalogue ?'
      : 'Supprimer ' + products.length + ' produits du catalogue ?\n\n' + products.map(p => '• ' + p.name).join('\n');
    if (!await U.confirm(msg + '\n\nLe stock existant est conservé.')) return;
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
    this._d = { id: U.uid(), name: '', meatType: S.meatTypes[0], mainSupplierId: '', coefficient: 2.1, labelTypeId: (Store.labelDefault() || {}).id || '', labelCost: Store.labelDefault() ? U.num(Store.labelDefault().cost) : S.labelCost, vatRate: '', bulkDiscount: '', suppliers: [], variants: [] };
    // Pré-remplissage optionnel (ex: depuis Stock.createCatalogFromStock, "📋 Créer la fiche
    // de calcul de prix" sur un produit stock non relié) — reprend nom/viande/conditionnement
    // existants, à Antho de compléter fournisseur + prix. Jamais l'inverse (le stock ne doit
    // jamais être créé depuis le catalogue automatiquement, voir la règle plus haut).
    if (this._prefill) { Object.assign(this._d, this._prefill); this._prefill = null; }
  },

  /* Profil « équipe » (2026-09-29, choix A d'Antho) : sur les fiches prix, seuls le lien, la réf. et
     les notes fournisseur sont modifiables ; tout le reste est grisé (et de toute façon jamais
     enregistré : Catalogue.save ne recopie que ces 3 champs, Store.save bloque le reste). */
  _teamLock() {
    if (!App.isTeam) return;
    const root = document.getElementById('main'); if (!root) return;
    const scope = this.mode === 'list' ? '.cat-fold .fold-body, .cat-head-inputs' : '';
    const els = scope ? root.querySelectorAll(scope.split(',').map(s => s.trim() + ' input, ' + s.trim() + ' select, ' + s.trim() + ' textarea, ' + s.trim() + ' button').join(','))
      : root.querySelectorAll('input, select, textarea, button');
    els.forEach(el => { if (!el.closest('[data-team-ok]')) { el.disabled = true; el.title = 'Profil équipe : non modifiable'; } });
    root.querySelectorAll(this.mode === 'list' ? '.cat-fold details.pack-picker, a[href="#/catalogue/new"]' : 'details.pack-picker, .sup-grid .btn-icon').forEach(el => { el.style.pointerEvents = 'none'; el.style.opacity = '.55'; });
  },

  renderEditor() {
    const S = Store.state.settings, p = this._d;
    const vp = S.variantPresets || { gram: [], piece: [], size: [] };
    const isNew = this.mode === 'new';
    App.mount(`
      <div class="view-title">
        <h1>${isNew ? 'Nouveau produit mastication' : 'Modifier — ' + U.esc(p.name || '')}</h1>
        <span class="spacer"></span>
        <button class="btn-ghost" data-team-ok onclick="Catalogue.cancelEdit()">← Retour à la liste</button>
        <button class="btn-cta" data-team-ok onclick="Catalogue.save()">💾 ${isNew ? 'Créer le produit' : 'Enregistrer'}</button>
      </div>
      ${App.isTeam ? `<div class="card team-note">👥 <b>Profil équipe</b> : sur cette fiche tu peux compléter uniquement le <b>lien</b>, la <b>réf.</b> et les <b>notes fournisseur</b> (section 2). Le reste est verrouillé.</div>` : ''}

      <div class="card" style="border-left:4px solid var(--caramel);">
        <h2>🏷️ 1. Informations produit</h2>
        <div class="frow">
          <div class="fg" style="flex:2;"><label>Nom du produit</label><input id="cp_name" value="${U.esc(p.name)}"></div>
          <div class="fg"><label>Viande</label><select id="cp_meat">${S.meatTypes.slice().sort(U.sortFr).map(m => `<option ${((p.meatType || '').toLowerCase() === m.toLowerCase()) ? 'selected' : ''}>${U.esc(m)}</option>`).join('')}</select></div>
        </div>
      </div>

      <div class="card" style="border-left:4px solid #4a7c59;">
        <h2>🏬 2. Fournisseurs & prix d'achat</h2>
        <p class="muted help mb0">Coche le fournisseur <b>principal</b> : c'est son prix qui sert de base à tous les calculs (coût de revient, marges, revente pro). Renseigne les autres pour comparer, et bascule quand tu veux.</p>
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
        <div class="frow" style="align-items:flex-end;max-width:520px;">
          <div class="fg"><label>Étiquette</label><select id="cp_labeltype" onchange="Catalogue.setLabelType(this.value)">
            ${Store.labelTypes().slice().sort((x, y) => U.sortFr(x.name, y.name)).map(t => `<option value="${t.id}" ${p.labelTypeId === t.id ? 'selected' : ''}>${U.esc(t.name)} — ${U.eur(t.cost)}</option>`).join('')}
            <option value="" ${!Store.labelType(p.labelTypeId) ? 'selected' : ''}>Autre montant (vrac…)</option></select></div>
          <div class="fg" style="max-width:160px;"><label>Coût (€)</label><input id="cp_label" type="number" step="0.01" value="${Store.labelCostOf(p)}" ${Store.labelType(p.labelTypeId) ? 'disabled title="Suit le coût réglé dans Paramètres → Réglages financiers → Consommables"' : ''} oninput="Catalogue._d.labelCost=this.value;Catalogue.drawVars()"></div>
        </div>
        <p class="muted help" style="font-size:.78rem;margin:2px 0 0;">Les types d'étiquette (et leur coût) se gèrent dans Paramètres → Réglages financiers → Consommables.</p>
      </div>

      <div class="card" style="border-left:4px solid #c0564a;">
        <h2>💰 4. Rentabilité & taxes</h2>
        <div class="frow">
          <div class="fg"><label>Coefficient par défaut</label><input id="cp_coeff" type="number" step="0.01" value="${Math.round((U.num(p.coefficient) || 2) * 100) / 100}" oninput="Catalogue.syncMargin('coeff')"></div>
          <div class="fg"><label>Marge commerciale (%)</label><input id="cp_marge" type="number" step="0.1" value="${U.num(p.coefficient) > 0 ? ((1 - 1 / U.num(p.coefficient)) * 100).toFixed(1) : ''}" oninput="Catalogue.syncMargin('marge')"></div>
        </div>
        <p class="muted help mb0">Modifier l'un met à jour l'autre automatiquement — coefficient par défaut, utilisé si une variante n'a ni prix fixe ni coefficient propre.</p>
        <div class="frow mt">
          <div class="fg"><label>Taux de TVA (%)</label><input id="cp_vat" type="number" step="0.1" value="${p.vatRate ?? ''}" placeholder="${S.vatRate} (global)" oninput="Catalogue.syncTaxFields()"></div>
          <div class="fg"><label>Décote paliers (%)</label><input id="cp_bulk" type="number" step="1" value="${p.bulkDiscount ?? ''}" placeholder="${S.bulkDiscount || 0} (global)" title="Réduction automatiquement appliquée dès la 2e variante active vendue (plus le grammage/lot est élevé, plus la décote compte) — laisse vide pour utiliser le réglage global." oninput="Catalogue.syncTaxFields()"></div>
        </div>
        <p class="muted help mb0">Laisse vide pour utiliser les réglages globaux (Paramètres). Renseigne uniquement si ce produit a un taux ou une décote spécifique.</p>
      </div>

      <div class="card" style="border-left:4px solid var(--caramel);">
        <h2>🏪 5. Variantes de vente</h2>
        <p class="muted help mb0">Les boutons ci-dessous génèrent d'un coup les paliers standards : décoche ceux que tu ne vends pas. Prix vente HT/TTC sont éditables directement — les modifier fixe ce prix (il ne bougera plus si tu changes de fournisseur principal) ; ↺ pour revenir au calcul automatique (coût × coefficient).</p>
        <div id="cp_vars" class="mt"></div>
        <div class="frow" style="gap:10px;">
          <button class="btn-ghost" onclick="Catalogue.addVar('gram')">＋ Poids</button>
          <button class="btn-ghost" onclick="Catalogue.addVar('piece')">＋ Pièces</button>
          <button class="btn-ghost" onclick="Catalogue.addVar('size')">＋ Taille</button>
        </div>
      </div>

      <div class="frow">
        <button class="btn-cta" data-team-ok style="flex:2;" onclick="Catalogue.save()">💾 ${isNew ? 'Créer le produit' : 'Enregistrer les modifications'}</button>
        <button class="btn-ghost" data-team-ok onclick="Catalogue.cancelEdit()">Annuler</button>
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
      coeffEl.value = (m < 100 && m > -1000) ? (1 / (1 - m / 100)).toFixed(2) : '';
    }
    this._d.coefficient = U.numVal('cp_coeff');
    this.drawVars();
  },

  syncTaxFields() {
    this._d.vatRate = U.val('cp_vat');
    this._d.bulkDiscount = U.val('cp_bulk');
    this.drawVars();
  },

  setLabelType(id) {
    const t = Store.labelType(id), inp = document.getElementById('cp_label');
    this._d.labelTypeId = id;
    if (t) this._d.labelCost = U.num(t.cost);
    if (inp) { inp.disabled = !!t; if (t) inp.value = U.num(t.cost); else inp.focus(); }
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
          <select onchange="Catalogue._d.suppliers[${i}].supplierId=this.value;Catalogue.drawSuppliers()">${App.supplierOptions(s.supplierId)}</select></div>
        <div class="fg"><label>Prix d'achat</label><input type="number" step="0.01" value="${s.price ?? ''}" onchange="Catalogue._d.suppliers[${i}].price=this.value;Catalogue.drawSuppliers()">
          <span class="muted" style="font-size:.78rem;">→ ${U.eur(this.supUnitHT(s))}/${s.unit === 'kilo' ? 'kg' : 'pc'} HT</span></div>
        <div class="fg"><label>HT / TTC</label><select onchange="Catalogue._d.suppliers[${i}].taxType=this.value;Catalogue.drawSuppliers()">
          <option ${(s.taxType || 'HT') === 'HT' ? 'selected' : ''}>HT</option><option ${s.taxType === 'TTC' ? 'selected' : ''}>TTC</option></select></div>
        <div class="fg"><label title="TVA d'achat (%)">TVA achat (%)</label><input type="number" step="0.1" value="${s.vatRate ?? ''}" placeholder="${Pricing.purchaseVatOf(s.supplierId, '')}" title="Vide = suit le taux du fournisseur (Paramètres → Référentiels), sinon le taux global. Un taux tapé ici ne concerne que ce produit." onchange="Catalogue._d.suppliers[${i}].vatRate=this.value;Catalogue.drawSuppliers()"></div>
        <div class="fg"><label>Acheté</label><select onchange="Catalogue._d.suppliers[${i}].unit=this.value;Catalogue.drawSuppliers()">
          <option value="kilo" ${(s.unit || 'kilo') === 'kilo' ? 'selected' : ''}>au kilo</option>
          <option value="piece" ${s.unit === 'piece' ? 'selected' : ''}>à la pièce</option></select></div>
        <div class="fg"><label>Poids (kg) / Qté</label><input type="number" step="0.01" value="${s.unit === 'piece' ? (s.quantity ?? 1) : (s.weight ?? 1)}" onchange="Catalogue.setSupDiv(${i},this.value)"></div>
        <div class="fg"><label>Pièces / kilo</label><input type="number" step="0.1" value="${s.piecesPerKilo ?? ''}" placeholder="si revente pièce" onchange="Catalogue._d.suppliers[${i}].piecesPerKilo=this.value"></div>
        <div class="fg"><label>&nbsp;</label><div class="sup-cell"><button class="btn-icon" title="Retirer ce fournisseur" onclick="Catalogue.delSupplier(${i})">🗑️</button></div></div>
      </div>
      <div class="muted" style="font-size:.78rem;margin:-2px 4px 8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">${s.priceDate ? `📅 Prix d'achat mis à jour le <b>${this._ageTxt(U.num(s.priceDate))}</b>` : ''}
        <button type="button" class="btn-ghost btn-sm" title="Le prix est inchangé mais tu viens de le vérifier chez le fournisseur : met la date à aujourd'hui" onclick="Catalogue.markPriceChecked(${i})">✓ Prix vérifié aujourd'hui</button></div>
      <div class="sup-grid2" data-team-ok style="${Store.hideSupplierInfo() ? 'display:none;' : ''}">
        <div class="fg"><label>Réf. fournisseur</label><input value="${U.esc(s.ref || '')}" placeholder="ex : C-23012" onchange="Catalogue._d.suppliers[${i}].ref=this.value.trim()"></div>
        <div class="fg"><label>Lien page fournisseur (URL)</label>
          <div style="display:flex;gap:6px;">
            <input type="url" id="sup_url_${i}" value="${U.esc(s.url || '')}" placeholder="https://…" style="flex:1;min-width:0;" onchange="Catalogue._d.suppliers[${i}].url=this.value;Catalogue.drawSuppliers()">
            <button type="button" class="btn btn-sm" style="white-space:nowrap;" title="Ouvrir dans le navigateur" onclick="var u=document.getElementById('sup_url_${i}').value.trim();if(u)window.open(u,'_blank','noopener');else U.toast('Aucun lien renseigné.',true);">🔗 Ouvrir</button>
          </div></div>
      </div>
      <div data-team-ok style="margin:-4px 0 8px;padding:0 4px;${Store.hideSupplierInfo() ? 'display:none;' : ''}">
        <div class="fg mb0" style="flex:1;"><label>📝 Notes fournisseur <span class="muted" style="font-weight:400;">(visible dans la liste de commande)</span></label>
          <textarea rows="2" placeholder="Ex: acheter au minimum 5 kg sinon aller chez Cernunos…" style="width:100%;resize:vertical;font-size:.85rem;" onchange="Catalogue._d.suppliers[${i}].notes=this.value">${U.esc(s.notes || '')}</textarea></div>
      </div></div>`).join('') || '<p class="muted">Aucun fournisseur — ajoute au moins un fournisseur avec son prix d\'achat.</p>';
    this.drawVars();
  },
  addSupplier() {
    this._d.suppliers = this._d.suppliers || [];
    const used = this._d.suppliers.map(s => s.supplierId);
    const S = Store.state.settings;
    const pool = Store.suppliersOf('mastication'), free = pool.find(x => !used.includes(x.id));
    const supplierId = free ? free.id : (pool[0]?.id || '');
    this._d.suppliers.push({ id: U.uid(), supplierId, price: '', taxType: 'HT', vatRate: '', unit: 'kilo', weight: 1, quantity: 1, piecesPerKilo: '', url: '', notes: '' });
    if (!this._d.mainSupplierId) this._d.mainSupplierId = supplierId;
    this.drawSuppliers();
  },
  setSupDiv(i, val) {
    const s = this._d.suppliers[i];
    if (s.unit === 'piece') s.quantity = val; else s.weight = val;
    this.drawSuppliers();
  },
  markPriceChecked(i) {
    this._d.suppliers[i].priceDate = Date.now();
    this.drawSuppliers();
    U.toast('Prix marqué comme vérifié — pense à enregistrer la fiche.');
  },
  delSupplier(i) {
    const removed = this._d.suppliers[i];
    this._d.suppliers.splice(i, 1);
    if (this._d.mainSupplierId === removed.supplierId) this._d.mainSupplierId = this._d.suppliers[0]?.supplierId || '';
    this.drawSuppliers();
  },

  /* Bascule rapide du fournisseur principal, directement depuis la carte */
  setMain(prodId, supplierId) {
    const p = Store.state.catalogM.find(x => String(x.id) === String(prodId));
    if (!p) return;
    const snap = Store.snapshot('catalogM', p);
    p.mainSupplierId = supplierId;
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Fournisseur principal changé — ' + p.name + ' → ' + Store.supplierName(supplierId));
    Store.save('catalogM', 'stockM');
    U.toast('Fournisseur principal : ' + Store.supplierName(supplierId), false, entry.id);
    App.rerender();
  },

  /* Case Coeff d'une ligne (fiche + éditeur) : coefficient réel de la ligne ; gris = calculé (coeff commun
     − décote), normal + ↺ = propre à la ligne (coefficient tapé ou prix TTC fixé). Le ↺ remet la ligne sur
     le calcul automatique. La place du ↺ est toujours réservée → cases alignées. */
  /* Décote de la ligne par rapport au coeff commun (petit texte sous la case) : décote paliers exacte pour une ligne
     automatique, écart réel pour une ligne dont le prix / coeff est fixé. Masquée sous 1 %. */
  decoteTag(c, common) {
    const k = U.num(common) || 2;
    const d = c.ownCoeff ? (c.effCoeff > 0 ? 1 - c.effCoeff / k : 0) : U.num(c.discount);
    if (Math.abs(d) < 0.01) return '';
    return `<span class="coeff-dec${d < 0 ? ' plus' : ''}" title="Écart de cette ligne par rapport au coeff commun (${k})">${d > 0 ? 'décote ' : '+'}${U.pct(Math.abs(d) * 100)}</span>`;
  },
  coeffCell(c, onChange, onReset, common) {
    const own = !!c.ownCoeff;
    const tip = own ? (c.priceFixed ? 'Prix TTC fixé à la main — le coefficient en découle. Modifier le coefficient retire le prix fixé.' : 'Coefficient propre à cette variante')
      : ('Calculé : coeff commun' + (c.discount ? ' − décote ' + U.pct(c.discount * 100) : ''));
    return `<span class="coeff-wrap"><span class="coeff-cell"><input type="number" step="0.01" min="0" value="${(c.effCoeff || 0).toFixed(2)}" class="coeff-in${own ? '' : ' auto'}" title="${tip}" onchange="${onChange}"><button type="button" class="btn-icon coeff-reset" title="Revenir au calcul automatique (coeff commun − décote)" ${own ? '' : 'style="visibility:hidden" tabindex="-1"'} onclick="${onReset}">↺</button></span>${common !== undefined ? this.decoteTag(c, common) : ''}</span>`;
  },
  setCardCommonCoeff(prodId, val) {
    const p = Store.state.catalogM.find(x => String(x.id) === String(prodId)); if (!p) return;
    const k = U.num(val);
    if (k <= 0) { App.rerender(); return; }
    const snap = Store.snapshot('catalogM', p);
    p.coefficient = k;
    // La DERNIÈRE valeur modifiée commande (Antho 2026-10-06) : le coeff du haut = celui de la 1re variante, et les autres en découlent → les prix (ou coeffs) fixés des variantes sont retirés pour qu'elles suivent (annulable)
    const reset = this._freeLines(p, 0);
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Coefficient commun modifié — ' + p.name + ' : ' + k);
    Store.save('catalogM', 'stockM');
    U.toast(reset ? `Coefficient commun mis à jour · ${reset} prix fixé${reset > 1 ? 's' : ''} retiré${reset > 1 ? 's' : ''} (les variantes suivent le coeff).` : 'Coefficient commun mis à jour.', false, entry.id);
    App.rerender();
  },
  resetCardLine(prodId, varId) {
    const p = Store.state.catalogM.find(x => String(x.id) === String(prodId)); if (!p) return;
    const v = (p.variants || []).find(x => String(x.id) === String(varId)); if (!v) return;
    const snap = Store.snapshot('catalogM', p);
    delete v.priceTTCManual; v.coeff = '';
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Variante remise sur le calcul automatique — ' + p.name + ' ' + Pricing.labelVariant(v));
    Store.save('catalogM', 'stockM');
    U.toast('Variante remise sur le coefficient commun.', false, entry.id);
    App.rerender();
  },
  setCardBulkDiscount(prodId, val) {
    const p = Store.state.catalogM.find(x => String(x.id) === String(prodId));
    if (!p) return;
    const snap = Store.snapshot('catalogM', p);
    p.bulkDiscount = val === '' ? undefined : U.num(val);
    const reset = this._freeLines(p, 1);   // la dernière valeur modifiée commande : les lots dont le prix était fixé suivent maintenant la décote
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Décote paliers modifiée — ' + p.name);
    Store.save('catalogM', 'stockM');
    U.toast(reset ? `Décote paliers mise à jour · ${reset} prix fixé${reset > 1 ? 's' : ''} retiré${reset > 1 ? 's' : ''} (les variantes suivent la décote).` : 'Décote paliers mise à jour.', false, entry.id);
    App.rerender();
  },

  /* Prix / coeff tapé sur une ligne → la décote du PRODUIT est déduite de cet écart (2026-09-30, demande d'Antho) :
     décote de la ligne = 1 − coeff de la ligne ÷ coeff commun ; la décote paliers monte progressivement (0 sur la 1re
     variante active, pleine sur la dernière), donc décote du produit = décote de la ligne × (n−1) ÷ rang de la ligne.
     Retourne la valeur posée (en %), ou null si rien à déduire (1re variante, une seule variante, prix au-dessus du coeff commun). */
  /* 1re variante active d'un produit « au gramme / à la pièce » (pas « par taille » : chaque taille a son propre prix d'achat, pas de coeff commun) = la RÉFÉRENCE :
     son prix TTC (ou son coeff) tapé devient le coeff commun du produit, donc le « Coeff » de l'en-tête (demande d'Antho 2026-10-06) ; les lots en découlent avec la décote paliers. */
  _isRef(p, v) {
    const actives = (p.variants || []).filter(x => x.enabled !== false);
    if (!actives.length || String(actives[0].id) !== String(v.id)) return false;
    return !actives.every(x => x.mode === 'size' && (U.num(x.value) > 0 || U.num(x.weight) > 0));
  },
  /* Retire le prix TTC / coeff fixé des variantes actives à partir du rang `from` (0 = toutes, 1 = les lots) pour qu'elles suivent le coeff commun et la décote ; renvoie le nombre de lignes libérées.
     Produits « par taille » : rien (pas de coeff commun). */
  _freeLines(p, from) {
    const actives = (p.variants || []).filter(x => x.enabled !== false);
    if (!actives.length || !this._isRef(p, actives[0])) return 0;
    let n = 0;
    actives.forEach((v, i) => { if (i >= from && (U.num(v.priceTTCManual) > 0 || U.num(v.coeff) > 0)) { delete v.priceTTCManual; v.coeff = ''; n++; } });
    return n;
  },
  _deriveBulk(p, v) {
    const actives = (p.variants || []).filter(x => x.enabled !== false);
    const n = actives.length, idx = actives.findIndex(x => String(x.id) === String(v.id));
    if (n < 2 || idx < 1) return null;
    const c = Pricing.variantCalc(p, v, idx, Pricing.baseUnitCost(p), n);
    const common = U.num(p.coefficient) || 2;
    if (!(c.coeff > 0) || c.cost <= 0) return null;
    const d = 1 - c.coeff / common;
    if (d <= 0) return null;
    const bulk = Math.min(100, Math.round(d * 100 * (n - 1) / idx * 10) / 10);
    p.bulkDiscount = bulk;
    return bulk;
  },
  setCardPriceTTC(prodId, varId, val, idxActive) {
    const p = Store.state.catalogM.find(x => String(x.id) === String(prodId));
    if (!p) return;
    const v = (p.variants || []).find(x => String(x.id) === String(varId));
    if (!v) return;
    const snap = Store.snapshot('catalogM', p);
    const ttc = U.num(val);
    if (ttc <= 0) {
      delete v.priceTTCManual;
    } else {
      v.priceTTCManual = ttc;
    }
    const bulk = ttc > 0 ? this._deriveBulk(p, v) : null;
    let common = null;
    if (ttc > 0 && this._isRef(p, v)) {   // 1re variante : son prix devient le coeff commun (les lots en automatique en découlent)
      const actives = (p.variants || []).filter(x => x.enabled !== false);
      const c = Pricing.variantCalc(p, v, 0, Pricing.baseUnitCost(p), actives.length);
      if (c.effCoeff > 0) { p.coefficient = Math.round(c.effCoeff * 10000) / 10000; common = p.coefficient; }
    }
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Prix TTC modifié — ' + p.name + ' ' + Pricing.labelVariant(v));
    Store.save('catalogM', 'stockM');
    U.toast(common !== null ? `Prix TTC mis à jour · coeff commun du produit : ${U.qty(Math.round(common * 1000) / 1000)}` : bulk !== null ? `Prix TTC mis à jour · décote du produit : ${bulk} %` : 'Prix TTC mis à jour.', false, entry.id);
    App.rerender();
  },

  /* Coefficient modifié directement dans la fiche (2026-09-27, demande d'Antho, comme son ancienne appli) :
     le prix de vente suit le coefficient ; si la variante avait un prix fixé, il est retiré. */
  setCardCoeff(prodId, varId, val) {
    const p = Store.state.catalogM.find(x => String(x.id) === String(prodId)); if (!p) return;
    const v = (p.variants || []).find(x => String(x.id) === String(varId)); if (!v) return;
    const k = U.num(val);
    if (k <= 0) { App.rerender(); return; }
    const snap = Store.snapshot('catalogM', p);
    const isRef = this._isRef(p, v);
    v.coeff = k;
    delete v.priceTTCManual;
    if (isRef) { p.coefficient = k; v.coeff = ''; }   // 1re variante : son coeff EST le coeff commun (la ligne reste automatique)
    const bulk = this._deriveBulk(p, v);
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Coefficient modifié — ' + p.name + ' ' + Pricing.labelVariant(v) + ' : ' + k);
    Store.save('catalogM', 'stockM');
    U.toast(isRef ? `Coefficient commun du produit : ${U.qty(k)}` : bulk !== null ? `Coefficient mis à jour · décote du produit : ${bulk} %` : 'Coefficient mis à jour.', false, entry.id);
    App.rerender();
  },

  /* Choix du sachet / blister d'une variante : liste maison en colonnes (nom · dimensions · coût), avec
     titres de groupe, au lieu du <select> natif illisible (2026-09-28, demande d'Antho). */
  packPicker(i, sel, mode) {
    Params._renameSachets();
    const all = Store.state.settings.sachets || [];
    const sachets = all.filter(s => (s.type || 'sachet') === 'sachet').sort(Params._dimSort('sachet'));
    const blisters = all.filter(s => (s.type || 'sachet') === 'blister').sort(Params._dimSort('blister'));
    const cur = all.find(s => String(s.id) === String(sel));
    const row = (id, a, b, cost, active) => `<div class="pp-row${active ? ' active' : ''}" onclick="this.closest('details').open=false;Catalogue._pickPack(${i},'${id}')"><span class="pp-a">${a}</span><span class="pp-b">${b}</span><span class="pp-c">${cost}</span></div>`;
    const sachetBlock = sachets.length ? `<div class="pp-head">🛍️ Sachets</div>` + sachets.map(s => {
      const dims = s.dims || '';
      const name = dims && s.name.endsWith(' — ' + dims) ? s.name.slice(0, -(' — ' + dims).length) : s.name;
      return row(s.id, U.esc(name), U.esc(dims || '—'), U.eur(s.cost), String(s.id) === String(sel));
    }).join('') : '';
    const groups = {};
    blisters.forEach(s => { const d = Params._blisterDims(s); const k = d ? d.widthStr : '?'; (groups[k] = groups[k] || []).push({ s, d }); });
    const blisterBlock = Object.entries(groups).map(([w, items]) => `<div class="pp-head">🎞️ Blister ${U.esc(w)}</div>` +
      items.map(({ s, d }) => row(s.id, 'Longueur', U.esc(d ? d.lengthStr : (s.dims || '?')), U.eur(s.cost), String(s.id) === String(sel))).join('')).join('');
    let label = 'Aucun';
    if (cur) {
      if ((cur.type || 'sachet') === 'blister') { const d = Params._blisterDims(cur); label = `Blister ${d ? d.widthStr + ' × ' + d.lengthStr : (cur.dims || '')}`; }
      else label = cur.dims && !cur.name.includes(cur.dims) ? `${cur.name} — ${cur.dims}` : cur.name;
      label += ` · ${U.eur(cur.cost)}`;
    }
    return `<details class="multiselect custom-select pack-picker">
      <summary>${U.esc(label)}</summary>
      <div class="multiselect-panel pp-panel">
        ${row('0', '<i>Aucun</i>', '', '', !cur)}
        ${mode === 'gram' ? sachetBlock + blisterBlock : blisterBlock + sachetBlock}
      </div>
    </details>`;
  },
  _pickPack(i, id) { Catalogue._d.variants[i].sachetId = id; Catalogue.drawVars(); },

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
      if (g.mode === 'size') return this.sizeTable(g, groupRows, base);
      return `<h3 class="cp-var-title">${g.title}
          <button class="btn-icon" title="Supprimer tout ce groupe (${groupRows.length} ligne${groupRows.length > 1 ? 's' : ''})" onclick="Catalogue.removeVarGroup('${g.mode}')">🗑️</button></h3>
        <div class="table-wrap"><table class="cp-var-table">
          <thead><tr><th></th><th>${g.col}</th><th>Sachet / Blister</th><th class="num">Coût revient</th><th class="num">Prix vente HT</th><th class="num">Marge</th><th class="num" style="white-space:normal;line-height:1.2;">Cotisations<br>URSSAF</th><th class="num">TVA ${Store.state.settings.vatActive ? '(reversée)' : '(conservée)'}</th><th class="num">Bénéfice</th><th class="num">Prix vente TTC</th><th></th></tr></thead>
          <tbody>${groupRows.map((r, j) => this.variantRow(r, base, j, groupRows.length)).join('')}</tbody>
        </table></div>`;
    }).join('') || '<p class="muted">Aucune variante — ajoute au moins un conditionnement de vente.</p>';
    this._teamLock();
  },

  /* Tableau « par taille » : une ligne par taille, une colonne par donnée
     (prix d'achat HT, poids, sachet, SKU, coût, coeff, prix…). Défile sur
     place sans déborder de la page, colonne Taille fixe. */
  sizeTable(g, groupRows, base) {
    const S = Store.state.settings, kilo = base.unit === 'kilo';
    const th = (t, cls) => `<th class="${cls || 'num'}">${t}</th>`;
    const rows = groupRows.map((r, j) => {
      const { v, i, c, on } = r;
      const benef = c.profitAssujetti;
      return `<tr class="${on ? '' : 'dim'}">
        <td class="sz-ck"><input type="checkbox" ${on ? 'checked' : ''} onchange="Catalogue._d.variants[${i}].enabled=this.checked;if(this.checked)Catalogue.autoFillSkus('size');Catalogue.drawVars()">
          <span class="mini-reorder"><button class="btn-icon" title="Monter" ${j <= 0 ? 'disabled' : ''} onclick="Catalogue.moveVar(${i},-1)">↑</button><button class="btn-icon" title="Descendre" ${j >= groupRows.length - 1 ? 'disabled' : ''} onclick="Catalogue.moveVar(${i},1)">↓</button></span></td>
        <td class="sz-name"><input value="${U.esc(v.label || '')}" class="v-num" placeholder="S, M, L…" onchange="Catalogue._d.variants[${i}].label=this.value;Catalogue.drawVars()">${c.critical && on ? ' <span class="badge bad" style="font-size:.6rem;padding:1px 5px;">critique</span>' : ''}</td>
        <td class="num sensitive"><input type="number" step="0.01" value="${v.value || ''}" class="v-price" placeholder="${kilo ? '—' : 'achat'}" title="Prix d'achat HT de cette taille (prioritaire sur le poids si renseigné)" onchange="Catalogue._d.variants[${i}].value=this.value;Catalogue.drawVars()"></td>
        ${kilo ? `<td class="num sensitive"><input type="number" step="1" value="${v.weight || ''}" class="v-price" placeholder="g" title="Poids de cette taille en grammes (coût = prix au kilo × poids)" onchange="Catalogue._d.variants[${i}].weight=this.value;Catalogue.drawVars()"></td>` : ''}
        <td>${this.packPicker(i, v.sachetId, v.mode)}</td>
        <td><input value="${U.esc(v.sku || '')}" placeholder="SKU" title="SKU WooCommerce" onchange="Catalogue._d.variants[${i}].sku=this.value;if(this.value)Catalogue.autoFillSkus('size');Catalogue.drawVars()" class="sz-sku"></td>
        <td class="num sensitive">${U.eur(c.cost)}${Catalogue._portNote(c)}</td>
        <td class="ctr sensitive">${this.coeffCell(c, `Catalogue.setVarCoeff(${i},this.value)`, `Catalogue.resetVariantPrice(${i})`)}</td>
        <td class="num sensitive"><input type="number" step="0.10" value="${c.priceHT.toFixed(2)}" class="v-price" onchange="Catalogue.setVariantPrice(${i},'ht',this.value)"></td>
        <td class="num num-marge sensitive">${U.eur(c.margin)}</td>
        <td class="num num-cotis sensitive">${U.eur(c.social)}</td>
        <td class="num sensitive ${S.vatActive ? 'num-cotis' : 'num-marge'}">${S.vatActive ? '− ' : ''}${U.eur(c.priceTTC - c.priceHT)}</td>
        <td class="num num-benef sensitive ${benef >= 0 ? 'pos' : 'neg'}"><b>${U.eur(benef)}</b></td>
        <td class="num"><input type="number" step="0.10" value="${c.priceTTC.toFixed(2)}" class="v-price strong" onchange="Catalogue.setVariantPrice(${i},'ttc',this.value)"></td>
        <td><button class="btn-icon" onclick="Catalogue._d.variants.splice(${i},1);Catalogue.drawVars()">🗑️</button></td>
      </tr>`;
    }).join('');
    return `<h3 class="cp-var-title">${g.title}
        <button class="btn-icon" title="Supprimer tout ce groupe (${groupRows.length} ligne${groupRows.length > 1 ? 's' : ''})" onclick="Catalogue.removeVarGroup('size')">🗑️</button></h3>
      <div class="table-wrap"><table class="cp-var-table cp-size-table">
        <thead><tr><th></th>${th('Taille', 'sz-name')}${th('Prix d\'achat HT')}${kilo ? th('Poids (g)') : ''}${th('Sachet / Blister', '')}${th('SKU', '')}${th('Coût revient')}${th('Coeff', 'ctr')}${th('Prix vente HT')}${th('Marge')}${th('Cotisations URSSAF')}${th('TVA ' + (S.vatActive ? '(reversée)' : '(conservée)'))}${th('Bénéfice')}${th('Prix vente TTC')}<th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`;
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
          ${this.coeffCell(c, `Catalogue.setVarCoeff(${i},this.value)`, `Catalogue.resetVariantPrice(${i})`, U.num(this._d.coefficient) || 2)}</div>
      </td>
      <td>${this.packPicker(i, v.sachetId, v.mode)}
        <div><input value="${U.esc(v.sku || '')}" placeholder="SKU" title="SKU WooCommerce" onchange="Catalogue._d.variants[${i}].sku=this.value;if(this.value)Catalogue.autoFillSkus('${v.mode}');Catalogue.drawVars()" style="margin-top:4px;width:100%;font-size:.82rem;"></div></td>
      <td class="num sensitive">${U.eur(c.cost)}${Catalogue._portNote(c)}</td>
      <td class="num sensitive"><input type="number" step="0.10" value="${c.priceHT.toFixed(2)}" class="v-price" onchange="Catalogue.setVariantPrice(${i},'ht',this.value)"></td>
      <td class="num num-marge sensitive">${U.eur(c.margin)}</td>
      <td class="num num-cotis sensitive">${U.eur(c.social)}</td>
      <td class="num sensitive ${Store.state.settings.vatActive ? 'num-cotis' : 'num-marge'}">${Store.state.settings.vatActive ? '− ' : ''}${U.eur(c.priceTTC - c.priceHT)}</td>
      <td class="num num-benef sensitive ${c.profitAssujetti >= 0 ? 'pos' : 'neg'}"><b>${U.eur(c.profitAssujetti)}</b></td>
      <td class="num"><input type="number" step="0.10" value="${c.priceTTC.toFixed(2)}" class="v-price strong" onchange="Catalogue.setVariantPrice(${i},'ttc',this.value)">
</td>
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
  async removeVarGroup(mode) {
    const label = { gram: 'les poids', piece: 'les lots (pièces)', size: 'les tailles' }[mode] || mode;
    const n = (this._d.variants || []).filter(v => v.mode === mode).length;
    if (!await U.confirm(`Supprimer ${label} (${n} ligne${n > 1 ? 's' : ''}) de ce produit ?`)) return;
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
  setVarCoeff(i, val) {
    const v = this._d.variants[i];
    if (U.num(val) <= 0) { this.drawVars(); return; }
    v.coeff = val;
    v.priceTTCManual = '';
    this.drawVars();
  },
  resetVariantPrice(i) {
    this._d.variants[i].priceTTCManual = '';
    this._d.variants[i].coeff = '';
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

  /* Génération automatique des SKU des variantes COCHÉES sans SKU (2026-09-30, demande d'Antho) :
     base = SKU d'une variante déjà remplie de la fiche (même mode d'abord), sinon nom du produit ;
     puis suffixe de la variante (100G, LOT2, S…). Rempli dans le brouillon (visible, modifiable),
     enregistré avec « Enregistrer ». Un SKU déjà pris ailleurs → alerte, jamais bloqué. */
  autoFillSkus(mode) {
    const vs = this._d.variants || [];
    const refs = vs.filter(r => r.sku && String(r.sku).trim());
    const ref = refs.find(r => r.mode === mode && Pricing.skuBaseFrom(r)) || refs.find(r => Pricing.skuBaseFrom(r));
    const base = ref ? Pricing.skuBaseFrom(ref) : (this._d.name || U.val('cp_name') ? Pricing.autoSku(this._d.name || U.val('cp_name'), this._d.meatType, '') : '');
    if (!base) return;
    const taken = new Set(vs.filter(r => r.sku).map(r => String(r.sku).trim().toUpperCase()));
    const made = [], dupes = [];
    vs.forEach(v => {
      if (v.sku || v.enabled === false) return;
      let sku = Pricing.skuWithBase(base, v);
      if (taken.has(sku)) return;   // même SKU qu'une autre ligne de la fiche : on laisse vide (à saisir)
      taken.add(sku); v.sku = sku; made.push(sku);
      if (this._skuExists(sku)) dupes.push(sku);
    });
    if (dupes.length) U.toast(`⚠️ SKU généré déjà utilisé ailleurs : ${dupes.join(', ')} — vérifie/modifie-le.`, true);
    else if (made.length) U.toast(`SKU généré${made.length > 1 ? 's' : ''} : ${made.join(', ')} (modifiable, enregistré avec la fiche).`);
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
    if (App.isTeam) return this._saveTeam();
    const p = this._d;
    p.name = U.val('cp_name').trim();
    if (!p.name) { U.toast('Le nom est obligatoire.', true); return false; }
    if (!(p.suppliers || []).length) { U.toast('Ajoute au moins un fournisseur avec son prix d\'achat.', true); return false; }
    p.meatType = U.val('cp_meat');
    p.coefficient = U.numVal('cp_coeff') || 2;
    p.labelTypeId = U.val('cp_labeltype'); p.labelCost = Store.labelType(p.labelTypeId) ? U.num(Store.labelType(p.labelTypeId).cost) : U.numVal('cp_label');
    p.vatRate = U.val('cp_vat');
    p.bulkDiscount = U.val('cp_bulk');
    if (!p.suppliers.some(s => s.supplierId === p.mainSupplierId)) p.mainSupplierId = p.suppliers[0].supplierId;
    // Doublons lien / réf. fournisseur (alerte, jamais blocage) — hors cette même fiche
    const dup = [];
    p.suppliers.forEach(s => Stock.dupWarnings({ url: s.url, ref: s.ref, self: { kind: 'P', id: p.id } }).forEach(m => { if (!dup.includes(m)) dup.push(m); }));
    if (!U.dupGate(dup, () => Catalogue.save())) return false;
    const wasNew = this.mode === 'new';
    const idx = Store.state.catalogM.findIndex(x => x.id === p.id);
    // Instantané avant écrasement (Annulation) — ne couvre que la fiche catalogue elle-même,
    // pas les fiches stock resynchronisées en cascade juste après (leur propre bouton 🔄 permet
    // de rattraper ça séparément si besoin).
    const before = idx >= 0 ? JSON.parse(JSON.stringify(Store.state.catalogM[idx])) : null;
    // Date de mise à jour du prix d'achat : nouvelle ligne ou prix/TVA/unité/poids modifié → aujourd'hui (sinon on garde la date, y compris « Prix vérifié »)
    const now = Date.now(), priceKey = x => [x.price, x.taxType || 'HT', x.vatRate, x.unit || 'kilo', x.weight, x.quantity].map(y => String(y ?? '')).join('|');
    p.suppliers.forEach(s => { const o = before && (before.suppliers || []).find(x => x.id === s.id); if (!o || priceKey(o) !== priceKey(s)) s.priceDate = now; });
    if (idx >= 0) Store.state.catalogM[idx] = p; else Store.state.catalogM.push(p);
    // répercuter les prix TTC sur le stock lié
    Stock.syncPricesFromCatalog(p.id);
    const entry = Store.log('catalogue', (wasNew ? 'Produit créé' : 'Produit modifié') + ' — ' + p.name,
      wasNew ? { type: 'deleteCreated', data: { domain: 'catalogM', id: p.id } } : { type: 'restoreItem', data: { domain: 'catalogM', id: p.id, before } });
    Store.save('catalogM', 'stockM');
    U.toast(wasNew ? 'Produit créé.' : 'Produit modifié.', false, entry.id);
    this.cancelEdit();
  },

_saveTeam() {
    const d = this._d;
    const idx = Store.state.catalogM.findIndex(x => x.id === d.id);
    if (idx < 0) { U.toast('Profil équipe : tu ne peux pas créer de fiche prix.', true); return false; }
    const p = Store.state.catalogM[idx];
    const dup = [];
    (d.suppliers || []).forEach(s => Stock.dupWarnings({ url: s.url, ref: s.ref, self: { kind: 'P', id: p.id } }).forEach(m => { if (!dup.includes(m)) dup.push(m); }));
    if (!U.dupGate(dup, () => Catalogue.save())) return false;
    const before = JSON.parse(JSON.stringify(p));
    let n = 0;
    (p.suppliers || []).forEach(s => {
      const e = (d.suppliers || []).find(x => x.id === s.id); if (!e) return;
      ['url', 'ref', 'notes'].forEach(f => { const v = (e[f] || '').trim(); if (v !== (s[f] || '')) { s[f] = v; n++; } });
    });
    if (!n) { U.toast('Aucun lien / réf. / note fournisseur modifié.'); this.cancelEdit(); return; }
    const entry = Store.log('catalogue', 'Infos fournisseur modifiées (équipe) — ' + p.name, { type: 'restoreItem', data: { domain: 'catalogM', id: p.id, before } });
    Store._teamCatalogOK = true;
    try { Store.save('catalogM'); } finally { Store._teamCatalogOK = false; }
    U.toast('Lien / réf. fournisseur enregistrés.', false, entry.id);
    this.cancelEdit();
  },

  peekBenefTVA(active) {
    document.querySelectorAll('.num-benef-cell b').forEach(b => {
      const td = b.parentElement;
      b.textContent = active ? td.dataset.peek : td.dataset.normal;
    });
  },

  async remove(id) {
    const p = Store.state.catalogM.find(x => String(x.id) === String(id));
    if (!await U.confirm(`Supprimer "${p.name}" du catalogue ? (le stock existant est conservé)`)) return;
    const snap = Store.snapshot('catalogM', p);
    Store.state.catalogM = Store.state.catalogM.filter(x => x.id !== id);
    const entry = Store.commitSnapshot(snap, 'catalogue', 'Produit supprimé — ' + p.name);
    Store.save('catalogM');
    U.toast('Produit supprimé.', false, entry.id);
    this.mode = 'list'; this.editId = null; this._loadedKey = null; location.hash = '/catalogue'; App.rerender();
  }
};

/* Saisies directes dans la liste (coeff, décote, prix TTC) : si une erreur survient, elle est AFFICHÉE (et rendue dans la console)
   au lieu d'échouer en silence, et la page revient à l'état enregistré. */
['setCardPriceTTC', 'setCardCoeff', 'setCardCommonCoeff', 'setCardBulkDiscount', 'resetCardLine'].forEach(name => {
  const fn = Catalogue[name];
  Catalogue[name] = function (...a) {
    try { return fn.apply(this, a); }
    catch (e) { console.error('Catalogue.' + name, e); U.toast('⚠️ Enregistrement impossible : ' + (e && e.message ? e.message : e), true); App.rerender(); }
  };
});

/* Menus à cases de la fiche de contrôle : un trio de méthodes par filtre (U.multiSelect appelle des fonctions globales par leur nom). */
['sup', 'meat', 'size'].forEach(k => {
  Catalogue['sheetTog_' + k] = function (v) { const a = this.sheet[k], i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); this.render(); };
  Catalogue['sheetAll_' + k] = function (all) { this.sheet[k] = all ? this._sheetOptions()[k].slice() : []; this.render(); };
  Catalogue['sheetOp_' + k] = function (open) { this.sheet[k + 'Open'] = open; };
});
