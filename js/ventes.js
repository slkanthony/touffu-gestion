/* ============================================================
   VENTES & SORTIES DE STOCK — terminal guidé
   Sert à déclarer une sortie de stock : vente du site, commande,
   marché, ou ajustement. Sélection guidée avec filtres rapides
   dynamiques (poids / dim. / taille / autres) construits à partir
   du stock réellement disponible, et champs Produit/Catégorie en
   autocomplete. FEFO : à défaut de lot choisi, le plus proche de
   la DLUO part d'abord. Chaque sortie est annulable (re-crédite
   le stock) ; "Restaurer Tout" annule toutes les sorties actives.
   ============================================================ */
const Ventes = {
  source: 'event',   // 'general' (site/boutique) | 'event' (marché) — événement par défaut, comme l'ancienne appli
  q: '', qOpen: false,
  catQ: '', cat: 'all', catOpen: false,
  variant: 'all',
  selKey: '', lotId: '', qty: 1, packN: 1,
  consoId: '', consoQty: 1,
  cart: [],
  customerName: '',
  // Historique des sorties : filtres (persistés), pagination, dépliage, sélection (2026-09-29)
  histF: { period: 'year', from: '', to: '', src: 'all', origin: 'all', q: '', sort: 'date', dir: 'desc', page: 1 },
  _histOpen: {}, _histSel: {}, _pendingDel: null,
  retourOpen: false,   // panneau "Retour d'événement" (import CSV SumUp) ouvert ?
  retourData: null,    // données analysées de l'import en attente de validation
  retourDeduct: true,  // coché par défaut = déduire le stock ; décoché = import HISTORIQUE (stats sans toucher au stock)
  cashQ: '', cashOpen: false, cashSelKey: '', cashQty: 1, cashPrice: '', // saisie d'une vente en liquide dans le retour
  retourConsoId: '', retourConsoQty: 1, // saisie des consommables (sacs…) utilisés pendant l'événement
  kind: 'M',           // 'M' mastication (défaut) | 'A' accessoires — bascule le sélecteur de produit à sortir
  accWidth: 'all',     // filtre largeur de sangle en mode Accessoires
  editTicketId: '', ticketConsoId: '', ticketConsoQty: 1,
  todoOpen: false, todoFilter: 'all', todoShowDone: false, _tt: {}, _todoBanner: null, _memOpen: false, // page « 🧩 Articles à traiter » // édition d'un ticket d'événement déjà validé (frais de stand + consommables)

  units() {
    const out = [];
    Store.state.stockM.forEach(p => p.variants.forEach(v => {
      if (v.mode === 'vrac') return;
      const availG = v.lots.reduce((a, l) => a + U.num(l.qtyGeneral), 0);
      const availE = v.lots.reduce((a, l) => a + U.num(l.qtyEvent), 0);
      const lots = v.lots.map(l => ({ id: l.id, lotNumber: l.lotNumber, dluo: l.dluo, qtyG: U.num(l.qtyGeneral), qtyE: U.num(l.qtyEvent) }));
      out.push({ key: 'M|' + p.id + '|' + v.id, kind: 'M', mode: v.mode || 'size', pId: p.id, vId: v.id, name: p.name, label: Pricing.labelVariant(v), type: p.meatType || 'Autre', sku: v.sku || '', value: v.value, price: U.num(v.priceTTC), availG, availE, lots, packs: [...new Set((v.packSkus || []).map(x => U.num(x.n)).filter(n => n >= 2))].sort((a, b) => a - b) });
    }));
    Store.state.catalogA.forEach(a => {
      const width = a.mainWidth || (Array.isArray(a.strapWidths) && a.strapWidths[0]) || '';
      out.push({ key: 'A|' + a.id, kind: 'A', mode: 'acc', pId: a.id, vId: '', name: a.name, label: a.category || '', type: a.category || 'Accessoire', width, sku: a.sku || '', price: Pricing.accCalc(a).priceTTC, availG: U.num(a.stockGeneral), availE: U.num(a.stockEvent), lots: [] });
    });
    return out.sort((a, b) => U.sortFr(a.type + a.name + a.label, b.type + b.name + b.label));
  },
  avail(u) { return this.source === 'event' ? u.availE : u.availG; },
  lotQty(l) { return this.source === 'event' ? l.qtyE : l.qtyG; },

  match(u) {
    // Le produit déjà sélectionné reste "match" même si le texte affiché (avec
    // son " · variante ") ne correspond plus littéralement au filtre de recherche.
    if (this.selKey && u.key === this.selKey) return true;
    // Le sélecteur est basculé par le bouton Mastication / Accessoires (this.kind).
    const wantKind = this.kind === 'A' ? 'A' : 'M';
    if (u.kind !== wantKind) return false;
    // Mastication : une ligne à dispo 0 dans le stock concerné n'est pas affichée (périssable,
    // lots/DLUO, on ne veut pas survendre). Accessoires : TOUJOURS affichés même à 0 — ils sont
    // souvent faits à la commande (pas de stock fini d'avance), et leur coût est calculé depuis
    // le template (matières + main d'œuvre + UV), donc la marge reste juste même sans stock.
    if (wantKind !== 'A' && this.avail(u) <= 0) return false;
    return (this.cat === 'all' || u.type === this.cat) &&
      (wantKind !== 'A' || this.accWidth === 'all' || u.width === this.accWidth) &&
      (this.variant === 'all' || u.label === this.variant) &&
      (!this.q || (u.name + ' ' + u.label + ' ' + u.sku).toLowerCase().includes(this.q.toLowerCase()));
  },

  /* Classement des étiquettes de variantes en 4 familles pour les filtres rapides */
  classifyBuckets(labels) {
    const weightRe = /^(\d+(?:[.,]\d+)?)\s*(g|kg|mg)$/i;
    const dimRe = /^(\d+(?:[.,]\d+)?)\s*(cm|mm|m)$/i;
    const sizeRe = /^(XXS|XS|S|M|L|XL|XXL|3XL|4XL|5XL)$/i;
    const weights = [], dims = [], sizes = [], others = [];
    [...new Set(labels)].filter(Boolean).forEach(l => {
      const s = String(l).trim();
      if (weightRe.test(s)) weights.push(s);
      else if (dimRe.test(s)) dims.push(s);
      else if (sizeRe.test(s)) sizes.push(s);
      else others.push(s);
    });
    const numSort = re => (a, b) => parseFloat(String(a).match(re)[1].replace(',', '.')) - parseFloat(String(b).match(re)[1].replace(',', '.'));
    weights.sort(numSort(weightRe));
    dims.sort(numSort(dimRe));
    sizes.sort((a, b) => Stock.SIZE_ORDER.indexOf(a.toUpperCase()) - Stock.SIZE_ORDER.indexOf(b.toUpperCase()));
    others.sort(U.sortFr);
    return { weights, dims, sizes, others };
  },

  render() {
    if (this.editTicketId) { this.renderTicketEditor(); return; }
    if (this.todoOpen) { this.renderTodo(); return; }
    const units = this.units();
    const wantKind = this.kind === 'A' ? 'A' : 'M';
    // Catégories proposées = celles du type sélectionné uniquement (viandes pour la mastication,
    // catégories d'accessoire pour les accessoires — pas de mélange).
    const types = [...new Set(units.filter(u => u.kind === wantKind).map(u => u.type))].sort(U.sortFr);
    const accWidths = [...new Set(units.filter(u => u.kind === 'A' && u.width).map(u => u.width))].sort(U.sortFr);
    // Les filtres rapides poids/dim/taille ne concernent que la mastication → ne classer que ses libellés
    // (sinon les catégories d'accessoire — Laisse, Collier… — polluent le menu « Autres »).
    const buckets = this.classifyBuckets(units.filter(u => u.kind === 'M').map(u => u.label));
    if (this.variant !== 'all' && !units.some(u => u.label === this.variant)) this.variant = 'all';

    const filtered = units.filter(u => this.match(u));
    if (this.selKey && !filtered.some(u => u.key === this.selKey)) this.selKey = '';
    const sel = units.find(u => u.key === this.selKey) || null;

    // suggestions autocomplete catégorie
    const catSuggestions = this.catOpen ? types.filter(t => !this.catQ || t.toLowerCase().includes(this.catQ.toLowerCase())).slice(0, 20) : [];
    // suggestions autocomplete produit (déjà filtré par cat/variante/q)
    const prodSuggestions = this.qOpen ? filtered.slice(0, 30) : [];

    let lotSelect = '';
    if (sel && sel.kind === 'M') {
      // Seuls les lots avec du stock réel dans le stock concerné sont listés — un lot à 0 dispo
      // (ex: tout au général alors qu'on vend en événement) n'a rien à faire dans la liste, sur
      // demande explicite d'Antho. Le garde-fou pour "je me trompe" reste l'alerte péremption
      // (pickLot, si on choisit un lot dispo moins urgent qu'un autre) et l'alerte stock
      // insuffisant (addLine, si la quantité demandée dépasse ce que CE lot a de dispo) —
      // toutes deux confirmables, jamais bloquantes.
      const lots = sel.lots.filter(l => this.lotQty(l) > 0).sort((a, b) => (a.dluo || '9999').localeCompare(b.dluo || '9999'));
      if (!lots.some(l => l.id === this.lotId)) this.lotId = lots[0]?.id || '';
      lotSelect = `<div class="fg"><label>Lot (plus proche DLUO d'abord)</label>
        ${lots.length ? U.customSelect({ value: this.lotId, options: lots.map(l => ({v:l.id, l:(l.lotNumber||'sans n°')+' · '+(l.dluo?U.frDate(l.dluo):'sans DLUO')+' · dispo '+U.qty(this.lotQty(l))})), onPick: 'Ventes.pickLot' })
        : '<div class="muted" style="padding:9px 11px;border:1px solid var(--input-border);border-radius:9px;">Aucun lot en stock '+(this.source === 'event' ? 'événement' : 'général')+'</div>'}
        </div>`;
    }

    App.mount(`
      <div class="view-title" style="justify-content:space-between;align-items:flex-start;gap:12px;"><div><h1>Ventes</h1><span class="sub">déclare une sortie · le stock se met à jour</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">${this.todoCount() ? `<button class="btn-ghost" style="white-space:nowrap;" onclick="Ventes.openTodo()">🧩 À traiter (${this.todoCount()})</button>` : ''}
        <button class="btn-cta" style="flex:0 0 auto;white-space:nowrap;" onclick="Ventes.toggleRetour()">${this.retourOpen ? '← Vente manuelle' : '📥 Retour d\'événement'}</button></div></div>

      ${this.retourOpen ? this.retourPanel() : `
      <div class="frow" style="margin-bottom:10px;">
        <button class="${this.kind === 'M' ? 'btn-cta' : 'btn-ghost'}" onclick="Ventes.setKind('M')">🥩 Mastication</button>
        <button class="${this.kind === 'A' ? 'btn-cta' : 'btn-ghost'}" onclick="Ventes.setKind('A')">🦮 Accessoires</button>
      </div>
      <div class="frow" style="margin-bottom:16px;">
        <button class="${this.source === 'general' ? 'btn-cta' : 'btn-ghost'}" onclick="Ventes.setSource('general')">🏬 Vente Général</button>
        <button class="${this.source === 'event' ? 'btn-cta' : 'btn-ghost'}" onclick="Ventes.setSource('event')">🎪 Vente Événement</button>
      </div>

      <div class="card">
        <h2>➕ Sélectionner ${this.kind === 'A' ? 'un accessoire' : 'un produit'} à sortir</h2>
        <div class="fg"><label>Catégorie / type</label>
          ${U.autocomplete({ id: 'v_cat', value: this.catQ, placeholder: 'toutes catégories…', options: catSuggestions, open: this.catOpen, onInput: 'Ventes.setCatQ', onPick: 'Ventes.pickCat', onClose: 'Ventes.closeCatMenu' })}
        </div>
        ${this.kind === 'A' ? (accWidths.length ? `<div class="fg"><label>Largeur de sangle (optionnel)</label>
          ${U.customSelect({ value: this.accWidth === 'all' ? '' : this.accWidth, options: [{v:'',l:'📏 Largeur — toutes'}].concat(accWidths.map(w => ({v:w,l:w}))), onPick: 'Ventes._setAccWidth' })}
        </div>` : '') : `<div class="fg"><label>Filtres rapides (optionnel)</label>
          <div class="grid c4">
            ${U.customSelect({ value: buckets.weights.includes(this.variant) ? this.variant : '', options: [{v:'',l:'⚖️ Poids — tous'}].concat(buckets.weights.map(w => ({v:w,l:w}))), onPick: 'Ventes._setVariant' })}
            ${U.customSelect({ value: buckets.dims.includes(this.variant) ? this.variant : '', options: [{v:'',l:'📏 Dim. — tous'}].concat(buckets.dims.map(w => ({v:w,l:w}))), onPick: 'Ventes._setVariant' })}
            ${U.customSelect({ value: buckets.sizes.includes(this.variant) ? this.variant : '', options: [{v:'',l:'📐 Taille — tous'}].concat(buckets.sizes.map(w => ({v:w,l:w}))), onPick: 'Ventes._setVariant' })}
            ${U.customSelect({ value: buckets.others.includes(this.variant) ? this.variant : '', options: [{v:'',l:'🔢 Autres — tous'}].concat(buckets.others.map(w => ({v:w,l:w}))), onPick: 'Ventes._setVariant' })}
          </div>
        </div>`}
        <div class="fg" data-onclose="Ventes.closeQMenu"><label>Produit (${filtered.length})</label>
          ${U.autocomplete({ id: 'v_prod', value: this.q, placeholder: 'tape ou choisis dans la liste…', options: [], open: false, onInput: 'Ventes.setQ', onPick: 'Ventes.pickProduct' })}
          ${this.qOpen && prodSuggestions.length ? `<div class="ac-list" style="position:static;margin-top:4px;">${prodSuggestions.map(u => `<div class="ac-item pp-row" onmousedown="event.preventDefault();Ventes.pickProduct('${u.key}')"><span class="pp-a">${U.esc(u.name)}${u.label ? ` <span class="pp-v">${U.esc(u.label)}</span>` : ''}</span><span class="pp-b">dispo ${U.qty(this.avail(u))}</span><span class="pp-c">${U.eur(u.price)}</span></div>`).join('')}</div>` : ''}
        </div>
        ${sel ? `<div class="grid c2">
          ${sel.kind === 'M' ? lotSelect : `<div class="fg"><label>Disponible</label><input disabled value="${U.qty(this.avail(sel))} pièce(s)"></div>`}
          <div class="fg"><label>${this.packN > 1 ? `Nombre de lots de ${this.packN}` : 'Quantité'}</label><input id="v_qty" type="number" step="0.001" min="0" value="${this.qty || 1}" onchange="Ventes.qty=U.num(this.value)"></div>
        </div>
        ${sel.kind === 'M' && (sel.packs || []).length ? `<div class="frow" style="gap:6px;margin:8px 0 4px;"><span class="muted" style="align-self:center;">Vendu :</span><button class="${this.packN <= 1 ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Ventes.packN=1;Ventes.render()">À l'unité</button>${sel.packs.map(n => `<button class="${this.packN === n ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Ventes.packN=${n};Ventes.render()">Lot de ${n}</button>`).join('')}${this.packN > 1 ? `<span class="muted" style="align-self:center;">→ ${U.qty((U.num(this.qty) || 1) * this.packN)} pièce(s) retirée(s)</span>` : ''}</div>` : ''}
        <span class="muted">${U.esc(sel.name)}${sel.label ? ' · ' + U.esc(sel.label) : ''} — ${U.eur(sel.price)} — dispo ${U.qty(this.avail(sel))}</span>`
        : `<p class="muted">${filtered.length === 0 ? 'Aucun produit pour ce filtre — vérifie le stock concerné (général / événement) ou tes filtres.' : 'Tape un nom ou choisis un produit ci-dessus.'}</p>`}
      </div>

      ${this.consoSection()}

      ${sel || this.consoId ? `<div style="text-align:center;margin:12px 0;">
        <button class="btn-cta" style="min-width:260px;" onclick="Ventes.addLine()">Ajouter au ticket</button>
      </div>` : ''}

      ${this.cart.length ? this.ticketCard() : ''}
      `}

      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <h2 class="mb0">🧾 Historique des sorties</h2>
          <div class="frow" style="gap:6px;flex:0;">
            <button class="btn-ghost btn-sm" title="Exporte les ventes affichées par les filtres" onclick="Ventes.exportSales()">⬇️ Exporter (CSV)</button>
            <button class="btn-danger btn-sm" onclick="Ventes.restoreAll()">↩️ Restaurer Tout</button>
          </div>
        </div>
        ${this.historyTable()}
      </div>`);
  },

  setSource(s) { this.source = s; this.lotId = ''; this.render(); },
  setKind(k) { this.kind = (k === 'A' ? 'A' : 'M'); this.selKey = ''; this.cat = 'all'; this.catQ = ''; this.variant = 'all'; this.accWidth = 'all'; this.q = ''; this.lotId = ''; this.render(); },
  _setAccWidth(w) { this.accWidth = w || 'all'; this.selKey = ''; this.render(); },
  _setVariant(v) { this.variant = v || 'all'; this.selKey = ''; this.render(); },
  _setConso(v) { this.consoId = v; this.render(); },

  setQ(v) { this.q = v; this.qOpen = true; this.selKey = ''; this.render(); },
  setCatQ(v) {
    this.catQ = v; this.catOpen = true;
    const types = [...new Set(this.units().map(u => u.type))];
    const exact = types.find(t => t.toLowerCase() === v.trim().toLowerCase());
    this.cat = v.trim() === '' ? 'all' : (exact || 'all');
    this.selKey = ''; this.render();
  },
  pickCat(t) { this.catQ = t; this.cat = t; this.catOpen = false; this.selKey = ''; this.render(); },
  // Fermeture au blur (voir U.autocomplete) — un mousedown sur une suggestion empêche
  // le blur de se déclencher avant le pick, donc pas de conflit avec closeCatMenu/closeQMenu.
  closeCatMenu() { if (this.catOpen) { this.catOpen = false; this.render(); } },
  closeQMenu() { if (this.qOpen) { this.qOpen = false; this.render(); } },

  pickProduct(key) {
    const u = this.units().find(x => x.key === key);
    this.selKey = key; this.q = u ? u.name + (u.label ? ' · ' + u.label : '') : this.q;
    this.qOpen = false; this.lotId = ''; this.qty = 1; this.packN = 1; this.render();
  },

  /* Alerte péremption FEFO : si l'utilisateur choisit manuellement un lot alors qu'un autre,
     disponible dans le même stock (gén./évén.), a une DLUO plus proche, on prévient avant
     de valider le changement — reproduit le comportement de l'ancienne appli. */
  pickLot(lotId) {
    const u = this.units().find(x => x.key === this.selKey);
    if (!u || u.kind !== 'M') { this.lotId = lotId; this.render(); return; }
    const lots = u.lots.filter(l => this.lotQty(l) > 0).sort((a, b) => (a.dluo || '9999').localeCompare(b.dluo || '9999'));
    const suggested = lots[0];
    const picked = u.lots.find(l => l.id === lotId);
    if (suggested && picked && suggested.id !== picked.id && (suggested.dluo || '9999') < (picked.dluo || '9999')) {
      U.modal({
        title: '⚠️ Attention Péremption',
        okLabel: 'Confirmer',
        body: `<p>Un lot avec une date de péremption plus courte est disponible en Stock ${this.source === 'event' ? 'Événement' : 'Général'}.</p>
          <p>Lot actuel : <b>${U.esc(picked.lotNumber || 'sans n°')}</b> (${picked.dluo ? U.frDate(picked.dluo) : 'sans DLUO'})<br>
          Lot suggéré : <b>${U.esc(suggested.lotNumber || 'sans n°')}</b> (${suggested.dluo ? U.frDate(suggested.dluo) : 'sans DLUO'})<br>
          Stock dispo : <b>${U.qty(this.lotQty(suggested))}</b></p>
          <p>Voulez-vous continuer avec le lot sélectionné ?</p>`,
        onOk: () => { this.lotId = lotId; U.closeModal(); this.render(); },
        onCancel: () => { this.render(); }
      });
    } else {
      this.lotId = lotId; this.render();
    }
  },

  addLine() {
    const u = this.units().find(x => x.key === this.selKey);
    if (!u && !this.consoId) { U.toast('Choisis un produit ou un consommable.', true); return; }
    if (!u && this.consoId) { if (this._pushConsoIfSelected()) { this.render(); U.toast('Ajouté au ticket.'); } return; }
    let qty = U.num(this.qty) || U.numVal('v_qty');
    if (qty <= 0) { U.toast('Quantité invalide.', true); return; }
    if (u.kind === 'M' && this.packN > 1) qty = qty * this.packN;   // lot de N → N pièces par lot
    if (u.kind === 'M') {
      const lotId = this.lotId || u.lots[0]?.id || '';
      const lot = u.lots.find(l => l.id === lotId);
      if (!lot) { U.toast('Aucun lot pour cette variante.', true); return; }
      const lotLabel = (lot.lotNumber || 'sans n°') + (lot.dluo ? ' · ' + U.frDate(lot.dluo) : '');
      if (this.lotQty(lot) < qty) {
        // Pas de blocage strict : Antho garde la main pour vendre sur un lot que la fiche dit
        // insuffisant (produit retrouvé ailleurs, écart de saisie...) — juste prévenu avant.
        U.modal({
          title: '⚠️ Stock insuffisant sur ce lot',
          okLabel: 'Ajouter quand même',
          body: `<p>Le lot <b>${U.esc(lotLabel)}</b> n'a que <b>${U.qty(this.lotQty(lot))}</b> en stock ${this.source === 'event' ? 'événement' : 'général'} — tu es sur le point d'en sortir <b>${U.qty(qty)}</b>.</p>
            <p>Continuer quand même ?</p>`,
          onOk: () => { U.closeModal(); this._pushLine(u, qty, lotId, lotLabel); }
        });
        return;
      }
      this._pushLine(u, qty, lotId, lotLabel);
    } else if (u.kind === 'A' && this.avail(u) < qty) {
      // Accessoire fait à la commande : pas de blocage, juste un rappel (le stock fini est optionnel).
      U.modal({
        title: 'ℹ️ Accessoire — stock fini insuffisant',
        okLabel: 'Ajouter quand même',
        body: `<p><b>${U.esc(u.name)}</b> n'a que <b>${U.qty(this.avail(u))}</b> en stock ${this.source === 'event' ? 'événement' : 'général'}, tu en vends <b>${U.qty(qty)}</b>.</p>
          <p class="muted">Normal si tu le fabriques à la commande — la vente est enregistrée avec son coût de revient (matières + main d'œuvre + UV), le stock fini reste à 0.</p>`,
        onOk: () => { U.closeModal(); this._pushLine(u, qty, '', ''); }
      });
      return;
    }
    else if (this.avail(u) < qty) { U.toast(`Stock insuffisant : dispo ${U.qty(this.avail(u))}.`, true); return; }
    else { this._pushLine(u, qty, '', ''); }
  },

  _pushLine(u, qty, lotId, lotLabel) {
    const pk = u.kind === 'M' && this.packN > 1 ? { pack: this.packN, packs: qty / this.packN } : {};
    this.cart.push({ key: u.key, kind: u.kind, pId: u.pId, vId: u.vId, lotId, lotLabel, name: u.name, label: u.label, sku: u.sku, price: u.price, qty, ...pk });
    this._pushConsoIfSelected();
    this.qty = 1; this.selKey = ''; this.q = ''; this.lotId = ''; this.packN = 1;
    this.render();
    U.toast('Ajouté au ticket.');
  },

  _pushConsoIfSelected() {
    if (!this.consoId) return false;
    const c = Store.state.consumables.find(x => x.id === this.consoId);
    if (!c) return false;
    const qty = U.num(this.consoQty) || U.numVal('v_conso_qty');
    if (qty <= 0) return false;
    if (U.num(c.qty) < qty) { U.toast(`Consommable "${c.name}" : stock insuffisant (dispo ${U.qty(c.qty)}).`, true); return false; }
    this.cart.push({ key: 'C|' + c.id, kind: 'C', pId: c.id, vId: '', lotId: '', lotLabel: '', name: c.name, label: (!c.unit || c.unit === 'pc') ? 'PCS' : c.unit, sku: '', price: 0, qty });
    this.consoId = ''; this.consoQty = 1;
    return true;
  },

  /* Consommables (cartons d'envoi, étiquettes...) consommés en même temps qu'une vente —
     sur demande d'Antho : un colis expédié utilise aussi du carton, à déduire du stock au
     moment de la vente plutôt que séparément dans Stock. Pas de prix (ce n'est pas vendu),
     pas de séparation gén./évén. (les consommables n'ont qu'un seul stock, contrairement
     à Mastication/Accessoires). */
  consoSection() {
    const avail = Store.state.consumables.filter(c => U.num(c.qty) > 0).sort((a, b) => U.sortFr(a.name, b.name));
    return `<div class="card">
      <h2>📦 Consommable utilisé</h2>
      <div class="grid c2">
        <div class="fg"><label>Article</label>
          ${U.customSelect({ value: this.consoId, options: [{v:'',l:'— choisir —'}].concat(avail.map(c => ({v:c.id,l:c.name+' — dispo '+U.qty(c.qty)}))), onPick: 'Ventes._setConso' })}
        </div>
        <div class="fg"><label>Quantité</label><input id="v_conso_qty" type="number" step="1" min="1" value="${this.consoQty || 1}" onchange="Ventes.consoQty=U.num(this.value)"></div>
      </div>
      ${!avail.length ? '<p class="muted">Aucun consommable en stock.</p>' : ''}
    </div>`;
  },

  ticketCard() {
    const total = this.cart.reduce((a, c) => a + c.price * c.qty, 0);
    return `<div class="card" style="border-left:4px solid var(--caramel);">
      <h2>🛒 Ticket en cours (${this.cart.length}) — stock ${this.source === 'event' ? 'événement' : 'général'}</h2>
      <div class="table-wrap"><table><thead><tr><th class="col-name">Produit</th><th>Lot</th><th class="num">Prix</th><th class="num">Qté</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${this.cart.map((c, i) => `<tr>
          <td class="col-name"><b>${U.esc(c.name)}</b> <span class="muted">${U.esc(c.label)}</span>${c.kind === 'C' ? ' <span class="badge info">conso</span>' : ''}${U.num(c.pack) >= 2 ? ` <span class="badge info">${U.qty(c.packs)} lot${c.packs > 1 ? 's' : ''} de ${c.pack}</span>` : ''}</td>
          <td>${c.lotLabel ? `<span class="tag">${U.esc(c.lotLabel)}</span>` : '—'}</td>
          <td class="num"><input type="number" step="0.01" value="${c.price.toFixed(2)}" style="width:80px;" onchange="Ventes.cart[${i}].price=U.num(this.value);Ventes.render()"></td>
          <td class="num"><input type="number" step="0.001" value="${c.qty}" style="width:74px;" onchange="Ventes.cart[${i}].qty=U.num(this.value);Ventes.render()"></td>
          <td class="num"><b>${U.eur(c.price * c.qty)}</b></td>
          <td><button class="btn-icon" onclick="Ventes.cart.splice(${i},1);Ventes.render()">🗑️</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="4">Total</th><th class="num">${U.eur(total)}</th><th></th></tr></tfoot></table></div>
      <div class="fg mt" style="max-width:320px;"><label>Client (optionnel)</label><input id="v_customer" value="${U.esc(this.customerName || '')}" placeholder="nom du client…" oninput="Ventes.customerName=this.value"></div>
      <div class="frow mt">
        <button class="btn-ok" onclick="Ventes.validate()">✅ Valider la sortie de stock</button>
        <button class="btn-ghost" onclick="Ventes.cart=[];Ventes.render()">Vider le ticket</button>
      </div>
    </div>`;
  },

  validate() {
    if (!this.cart.length) return;
    U.modal({
      title: '🧾 Origine de la vente',
      hideOk: true,
      body: `<p class="muted mt-0">D'où vient cette vente ?</p>
        <div class="frow" style="gap:10px;">
          <button type="button" class="btn-cta" style="flex:1;padding:18px 10px;" onclick="Ventes._askDelivery('online')">🌐 Vente en ligne</button>
          <button type="button" class="btn-cta" style="flex:1;padding:18px 10px;" onclick="Ventes._askDelivery('direct')">🏪 Vente directe</button>
        </div>`
    });
  },

  _askDelivery(channel) {
    U.modal({
      title: '📦 Mode de remise',
      hideOk: true,
      body: `<p class="muted mt-0">Livraison ou Click & Collect ?</p>
        <div class="frow" style="gap:10px;">
          <button type="button" class="btn-cta" style="flex:1;padding:18px 10px;" onclick="Ventes._afterDelivery('${channel}','livraison')">📦 Livraison</button>
          <button type="button" class="btn-cta" style="flex:1;padding:18px 10px;" onclick="Ventes._afterDelivery('${channel}','clickcollect')">🏬 Click &amp; Collect</button>
        </div>
        <button type="button" class="btn-ghost btn-sm mt" onclick="Ventes.validate()">← Retour</button>`
    });
  },

  _afterDelivery(channel, delivery) {
    // Vente en ligne = site WordPress = Stripe (pas SumUp). Vente directe : on demande le mode.
    if (channel === 'online') this._finalizeSale('online', 'stripe', delivery);
    else this._askDirectPayment(delivery);
  },

  _askDirectPayment(delivery) {
    U.modal({
      title: '💳 Paiement — vente directe',
      hideOk: true,
      body: `<p class="muted mt-0">Comment le client a-t-il payé ?</p>
        <div class="frow" style="gap:10px;">
          <button type="button" class="btn-cta" style="flex:1;padding:18px 10px;" onclick="Ventes._finalizeSale('direct','virement','${delivery}')">🏦 Virement</button>
          <button type="button" class="btn-cta" style="flex:1;padding:18px 10px;" onclick="Ventes._finalizeSale('direct','sumup','${delivery}')">💳 SumUp</button>
        </div>
        <button type="button" class="btn-ghost btn-sm mt" onclick="Ventes._askDelivery('direct')">← Retour</button>`
    });
  },

  _finalizeSale(channel, payment, delivery) {
    U.closeModal();
    if (!this.cart.length) return;
    const sale = { id: U.uid(), ts: Date.now(), source: this.source, channel, payment, delivery, customerName: (this.customerName || '').trim(), items: [], total: 0, cancelled: false, undoOps: [] };
    const shortfalls = this._deductSale(sale, this.cart, this.source);
    if (delivery === 'livraison') {
      const S = Store.state.settings;
      sale.shippingChargedToCustomer = sale.total < U.num(S.freeShippingThreshold ?? 69);
      sale.shippingFeeCollected = sale.shippingChargedToCustomer ? U.num(S.shippingCost ?? 6.8) : 0;
    }
    Store.state.sales.unshift(sale);
    const entry = Store.log('vente', `Sortie ${U.eur(sale.total)} — ${sale.items.map(i => U.qty(i.qty) + '× ' + i.name).join(', ')}`, { type: 'sale', data: { saleId: sale.id } });
    Store.save('sales', 'stockM', 'catalogA', 'consumables');
    this.cart = [];
    this.customerName = '';
    this.render();
    U.toast(`Sortie enregistrée : ${U.eur(sale.total)} · stock à jour.`, false, entry.id);
    if (shortfalls.length) this._alertShortfalls(shortfalls);
  },

  /* Déduit une liste de lignes du stock (source 'general'|'event') et remplit sale.items/total/undoOps.
     ⚠️ Jamais de négatif : ce qui ne peut pas être déduit est renvoyé dans `shortfalls` (pour alerte),
     jamais retranché sous 0. Nettoie les lots épuisés (0 en général ET en événement) des variantes
     touchées — la variante, elle, reste (rupture visible + config/SKU conservés). Méthode partagée
     entre la vente manuelle (_finalizeSale) et l'import d'un retour d'événement. */
  _deductSale(sale, lines, source) {
    const shortfalls = [];
    const touched = [];
    for (const c of lines) {
      let missing = 0;
      // Coût de revient FIGÉ sur la ligne au moment de la vente (pour la vraie marge) :
      // mastication = coût réel des lots consommés (FEFO) ; accessoire = coût calculé (matières+main d'œuvre) ; consommable = coût unitaire.
      let lineCost = 0;
      if (c.kind === 'M') {
        const p = Store.state.stockM.find(x => x.id === c.pId);
        const v = p?.variants.find(x => x.id === c.vId);
        if (v) {
          const field = source === 'event' ? 'qtyEvent' : 'qtyGeneral';
          let remaining = c.qty;
          const ordered = [...v.lots].sort((a, b) => (a.id === c.lotId ? -1 : b.id === c.lotId ? 1 : (a.dluo || '9999').localeCompare(b.dluo || '9999')));
          for (const l of ordered) {
            if (remaining <= 0) break;
            const take = Math.min(U.num(l[field]), remaining);
            if (take > 0) { l[field] = U.num(l[field]) - take; remaining -= take; lineCost += take * U.num(l.costUnit || v.costUnit); sale.undoOps.push({ kind: 'M', pId: p.id, vId: v.id, lId: l.id, field, qty: take, lotMeta: { lotNumber: l.lotNumber, dluo: l.dluo, costUnit: l.costUnit } }); }
          }
          if (remaining > 0) { missing = remaining; shortfalls.push({ name: c.name, label: c.label, sold: c.qty, missing: remaining, src: source }); lineCost += remaining * U.num(v.costUnit); }
          if (!touched.includes(v)) touched.push(v);
        }
      } else if (c.kind === 'A') {
        const a = Store.state.catalogA.find(x => x.id === c.pId);
        if (a) {
          lineCost = U.num(Pricing.accCalc(a).cost) * c.qty;
          const field = source === 'event' ? 'stockEvent' : 'stockGeneral';
          const take = Math.min(U.num(a[field]), c.qty);
          if (take > 0) { a[field] = U.num(a[field]) - take; sale.undoOps.push({ kind: 'A', pId: a.id, field, qty: take }); }
          // Pas d'alerte "manque" pour un accessoire : fait à la commande, le stock fini est optionnel
          // (le coût de revient est déjà figé ci-dessus, la marge reste juste).
        }
      } else if (c.kind === 'C') {
        const co = Store.state.consumables.find(x => x.id === c.pId);
        if (co) {
          lineCost = U.num(co.costUnit) * c.qty;
          const take = Math.min(U.num(co.qty), c.qty);
          if (take > 0) { co.qty = U.num(co.qty) - take; sale.undoOps.push({ kind: 'C', pId: co.id, qty: take }); }
          if (c.qty - take > 0) missing = c.qty - take;
          if (c.qty - take > 0) shortfalls.push({ name: c.name, label: c.label, sold: c.qty, missing: c.qty - take, src: source });
        }
      }
      sale.items.push({ kind: c.kind, pId: c.pId, vId: c.vId, name: c.name, label: c.label, sku: c.sku, lotLabel: c.lotLabel, qty: c.qty, price: c.price, cost: lineCost, ...(missing > 0 ? { missing } : {}), ...(U.num(c.pack) >= 2 ? { pack: U.num(c.pack), packs: U.num(c.packs) } : {}) });
      sale.total += c.price * c.qty;
    }
    touched.forEach(v => { v.lots = v.lots.filter(l => U.num(l.qtyGeneral) > 0 || U.num(l.qtyEvent) > 0); });
    return shortfalls;
  },

  _alertShortfalls(shortfalls) {
    const rows = shortfalls.map(s => `<li><b>${U.esc(s.name)}</b>${s.label ? ' ' + U.esc(s.label) : ''} — vendu ${U.qty(s.sold)}, <b class="warn-txt">${U.qty(s.missing)} non déduit(s)</b> (stock ${s.src === 'event' ? 'événement' : 'général'} épuisé)</li>`).join('');
    U.modal({
      title: '⚠️ Stock insuffisant — mis à 0',
      hideOk: true,
      body: `<p>La vente est bien enregistrée, mais le stock ne peut pas passer en négatif. Ces articles ont été mis à <b>0</b> (il en manquait) — sans doute un stock pas encore saisi avant l'événement :</p>
        <ul style="margin:8px 0;padding-left:20px;line-height:1.6;">${rows}</ul>
        <p class="muted">Ajuste ces variantes dans Stock si besoin.</p>`
    });
  },

  applyUndoOp(op) {
    if (op.kind === 'M') {
      const f = Stock.findLot(op.pId, op.vId, op.lId);
      if (f) { f.lot[op.field] = U.num(f.lot[op.field]) + op.qty; }
      else {
        // Le lot a pu être nettoyé (épuisé) après la vente : on le recrée pour re-créditer.
        const p = Store.state.stockM.find(x => x.id === op.pId);
        const v = p?.variants.find(x => x.id === op.vId);
        if (v) { const m = op.lotMeta || {}; v.lots.push({ id: op.lId, lotNumber: m.lotNumber || '', dluo: m.dluo || '', costUnit: U.num(m.costUnit), qtyGeneral: op.field === 'qtyGeneral' ? op.qty : 0, qtyEvent: op.field === 'qtyEvent' ? op.qty : 0 }); }
      }
    }
    else if (op.kind === 'A') { const a = Store.state.catalogA.find(x => x.id === op.pId); if (a) a[op.field] = U.num(a[op.field]) + op.qty; }
    else if (op.kind === 'C') { const co = Store.state.consumables.find(x => x.id === op.pId); if (co) co.qty = U.num(op.qty) + U.num(co.qty); }
  },

  async cancelSale(id) {
    const s = Store.state.sales.find(x => x.id === id);
    if (!s || s.cancelled) return;
    if (!await U.confirm('Annuler cette sortie et re-créditer le stock ?')) return;
    (s.undoOps || []).forEach(op => this.applyUndoOp(op));
    s.cancelled = true;
    Store.log('vente', `Sortie annulée — ${U.eur(s.total)} du ${U.frDateTime(s.ts)}`);
    Store.save('sales', 'stockM', 'catalogA', 'consumables');
    this.render();
    U.toast('Sortie annulée, stock re-crédité.');
  },

  async restoreAll() {
    // Les ventes HISTORIQUES (import stats, jamais déduites) sont exclues : rien à re-créditer,
    // et il ne faut surtout pas les marquer annulées (elles disparaîtraient des statistiques).
    const active = Store.state.sales.filter(s => !s.cancelled && !s.historical);
    if (!active.length) { U.toast('Aucune sortie active à restaurer.', true); return; }
    if (!await U.confirm(`Annuler TOUTES les ${active.length} sortie(s) actives et re-créditer le stock ?`)) return;
    active.forEach(s => {
      (s.undoOps || []).forEach(op => this.applyUndoOp(op));
      s.cancelled = true;
    });
    Store.log('vente', `Restauration totale — ${active.length} sortie(s) annulée(s), stock re-crédité`);
    Store.save('sales', 'stockM', 'catalogA', 'consumables');
    this.render();
    U.toast('Toutes les sorties ont été restaurées.');
  },

  paymentLabel(s) {
    if (s.payment === 'cash') return '💵 Espèces';
    if (s.payment === 'stripe') return '🌐 En ligne (Stripe)';
    if (s.payment === 'virement') return '🏦 Virement';
    if (s.payment === 'sumup') return s.channel === 'online' ? '🌐 En ligne (SumUp)' : '💳 SumUp';
    if (!s.channel) return '—';
    return s.channel === 'online' ? '🌐 En ligne' : '💳 SumUp';
  },

  deliveryLabel(s) {
    if (!s.delivery) return '—';
    return s.delivery === 'livraison' ? '📦 Livraison' : '🏬 Click & Collect';
  },

  setShippingCost(id, val) {
    const s = Store.state.sales.find(x => x.id === id); if (!s) return;
    const snap = Store.snapshot('sales', s);
    s.shippingCost = U.num(val);
    const entry = Store.commitSnapshot(snap, 'vente', `Frais d'envoi — ${U.frDateTime(s.ts)} : ${U.eur(s.shippingCost)}`);
    U.toast('Frais d\'envoi mis à jour.', false, entry.id);
    Store.save('sales');
  },

  /* Frais de stand (coût de l'emplacement d'un marché) — saisi au retour d'événement,
     modifiable après coup ici. Imputé au bénéfice de cette vente/événement. */
  setEventFee(id, val) {
    const s = Store.state.sales.find(x => x.id === id); if (!s) return;
    const snap = Store.snapshot('sales', s);
    s.eventFee = U.num(val);
    const entry = Store.commitSnapshot(snap, 'vente', `Frais de stand — ${U.frDateTime(s.ts)} : ${U.eur(s.eventFee)}`);
    U.toast('Frais de stand mis à jour.', false, entry.id);
    Store.save('sales');
  },

  /* ─── Nom d'événement (2026-09-27) : sale.eventName, pour les stats par événement ───
     Suggestions = noms déjà utilisés (datalist), pour taper toujours le même nom. */
  eventNames() { return Store.eventList(); },
  eventNamesDatalist() { return ''; },
  /* Menu déroulant d'événement (référentiel Paramètres → Événements) + « ＋ Nouvel événement… »
     qui l'ajoute au référentiel sans quitter l'écran. `cb` = code JS appelé avec la valeur (v). */
  eventSelect(cur, cb, style, after) {
    const names = this.eventNames();
    if (cur && !names.includes(cur)) names.unshift(cur);
    return `<select style="${style || ''}" onchange="Ventes._pickEvent(this, v => { ${cb} }${after ? `, () => { ${after} }` : ''})"><option value="">— choisir —</option>${names.map(n => `<option ${n === cur ? 'selected' : ''} value="${U.esc(n)}">${U.esc(n)}</option>`).join('')}<option value="__new">＋ Nouvel événement…</option></select>`;
  },
  _pickEvent(sel, cb, after) {
    let v = sel.value;
    if (v === '__new') {
      /* Fenêtre de l'appli (DA caramel) au lieu du prompt() natif du navigateur. */
      sel.value = '';
      const ok = () => {
        const n = U.val('new_event_name').trim();
        if (!n) { U.toast('Donne un nom à l\'événement.', true); return false; }
        U.closeModal();
        const name = Params.addEvent(n) || n;
        cb(name);
        if (after) after(); else this.render();   // le nouvel événement apparaît aussitôt dans les autres menus (autres journées, espèces)
      };
      U.modal({
        title: '🎪 Nouvel événement', okLabel: 'Créer',
        body: `<div class="fg"><label>Nom de l'événement</label><input id="new_event_name" placeholder="ex : Marché de Noël Lyon" onkeydown="if(event.key==='Enter')document.getElementById('modalOk').click()"></div>
          <p class="muted" style="margin:0;">Ajouté à ta liste (Paramètres → Référentiels → Événements), où tu pourras compléter sa fiche : stand, km, péages…</p>`,
        onOk: ok
      });
      setTimeout(() => document.getElementById('new_event_name')?.focus(), 30);
      return;
    }
    cb(v);
  },
  setEventName(id, val) {
    const s = Store.state.sales.find(x => x.id === id); if (!s) return;
    const snap = Store.snapshot('sales', s);
    s.eventName = String(val || '').trim();
    const entry = Store.commitSnapshot(snap, 'vente', `Nom d'événement — ${U.frDateTime(s.ts)} : ${s.eventName || '(aucun)'}`);
    U.toast('Nom de l\'événement enregistré.', false, entry.id);
    Store.save('sales');
  },
  /* Choix d'un événement sur une journée → pré-remplit stand + déplacement depuis sa fiche
     (Paramètres → Événements). Si l'événement est déjà sur une autre journée de ce retour
     (marché sur 2 jours), on ne double pas : stand et trajet restent sur la 1re journée. */
  setDayEventName(key, val) {
    const d = this.retourData; if (!d) return;
    const name = String(val || '').trim();
    d.eventNames = d.eventNames || {}; d.standFees = d.standFees || {}; d.travel = d.travel || {};
    d.eventNames[key] = name;
    const already = name && Object.keys(d.eventNames).some(k => k !== key && d.eventNames[k] === name);
    if (name && !already) {
      const e = Store.eventInfo(name);
      if (!U.num(d.standFees[key]) && U.num(e.stand)) d.standFees[key] = U.num(e.stand);
      if (!U.num(d.travel[key])) {
        d.travelDet = d.travelDet || {};
        d.travelDet[key] = this._travelFromFiche(name);
        d.travel[key] = this.travelOf(d.travelDet[key]);
      }
    }
    this.render();
  },
  /* Déplacement détaillé (2026-09-27, retour d'Antho) : on saisit km aller-retour, prix du litre et
     péages/parking — l'appli fait le calcul avec la consommation du véhicule (Réglages financiers).
     det = {km, cons (L/100 km), fuel (€/L), tolls (€)}. Le montant en € (travelCost) reste ce qui est compté.
     Coût carburant = km × conso/100 × prix du litre (la conso est visible et modifiable, défaut = réglages). */
  _defDet() { const S = Store.state.settings; return { km: '', cons: U.num(S.fuelConsumption ?? 7), fuel: U.num(S.fuelPrice ?? 1.85), tolls: '' }; },
  travelOf(det) {
    if (!det) return 0;
    const cons = det.cons === '' || det.cons == null ? U.num(Store.state.settings.fuelConsumption ?? 7) : U.num(det.cons);
    return Math.round((U.num(det.km) * cons / 100 * U.num(det.fuel) + U.num(det.tolls)) * 100) / 100;
  },
  _travelFromFiche(name) {
    const e = name ? Store.eventInfo(name) : {};
    return Object.assign(this._defDet(), { km: U.num(e.km) || '', tolls: (U.num(e.tolls) + U.num(e.other)) || '' });
  },
  /* target : 'd:<journée>' (retour), 'cash' (ventes espèces), 's:<id vente>' (ticket déjà validé). */
  travelWidget(det, target, fallbackTotal) {
    det = det || this._defDet();
    const tid = 'tw_' + target.replace(/[^\w-]/g, '_');
    const empty = !U.num(det.km) && !U.num(det.tolls);
    const total = empty && U.num(fallbackTotal) ? U.num(fallbackTotal) : this.travelOf(det);
    if (det.cons === '' || det.cons == null) det = Object.assign({}, det, { cons: this._defDet().cons });
    const inp = (f, w, step) => `<input type="number" min="0" step="${step}" value="${det[f] === '' || det[f] == null ? '' : U.num(det[f])}" placeholder="0" style="width:${w}px;text-align:center;" onchange="Ventes.setTravelPart('${target}','${f}',this.value)">`;
    return `<span class="travel-split">
      ${inp('km', 70, 1)}<span class="muted">km A/R ·</span>${inp('cons', 58, 0.1)}<span class="muted">L/100 km ×</span>${inp('fuel', 64, 0.01)}<span class="muted">€/L +</span>${inp('tolls', 64, 0.01)}<span class="muted">€ péages</span>
      <span style="white-space:nowrap;"><span class="muted">=</span> <b class="sensitive" id="${tid}">${U.eur(total)}</b></span></span>`;
  },
  setTravelPart(target, field, val) {
    const v = val === '' ? '' : U.num(val);
    let cost;
    if (target.startsWith('s:')) {
      const s = Store.state.sales.find(x => x.id === target.slice(2)); if (!s) return;
      const snap = Store.snapshot('sales', s);
      s.travelDet = s.travelDet || this._defDet();
      s.travelDet[field] = v;
      s.travelCost = cost = this.travelOf(s.travelDet);
      const entry = Store.commitSnapshot(snap, 'vente', `Frais de déplacement — ${U.frDateTime(s.ts)} : ${U.eur(cost)}`);
      U.toast('Frais de déplacement mis à jour.', false, entry.id);
      Store.save('sales');
    } else {
      const d = this.retourData; if (!d) return;
      d.travelDet = d.travelDet || {};
      const k = target === 'cash' ? '__cash' : target.slice(2);
      d.travelDet[k] = d.travelDet[k] || this._defDet();
      d.travelDet[k][field] = v;
      cost = this.travelOf(d.travelDet[k]);
      if (target === 'cash') d.cashTravel = cost; else (d.travel = d.travel || {})[k] = cost;
    }
    const el = document.getElementById('tw_' + target.replace(/[^\w-]/g, '_'));
    if (el) el.textContent = U.eur(cost);
  },
  setCashEventName(val) {
    const d = this.retourData; if (!d) return;
    d.cashEventName = String(val || '').trim();
    const onDay = d.cashEventName && Object.values(d.eventNames || {}).includes(d.cashEventName);
    if (d.cashEventName && !onDay) {
      const e = Store.eventInfo(d.cashEventName);
      if (!U.num(d.cashStandFee) && U.num(e.stand)) d.cashStandFee = U.num(e.stand);
      if (!U.num(d.cashTravel)) {
        d.travelDet = d.travelDet || {};
        d.travelDet.__cash = this._travelFromFiche(d.cashEventName);
        d.cashTravel = this.travelOf(d.travelDet.__cash);
      }
    }
    this.render();
  },

  toggleShippingCharged(id) {
    const s = Store.state.sales.find(x => x.id === id); if (!s || s.delivery !== 'livraison') return;
    const snap = Store.snapshot('sales', s);
    s.shippingChargedToCustomer = !s.shippingChargedToCustomer;
    s.shippingFeeCollected = s.shippingChargedToCustomer ? U.num(Store.state.settings.shippingCost ?? 6.8) : 0;
    const entry = Store.commitSnapshot(snap, 'vente', `Port client — ${U.frDateTime(s.ts)} : ${s.shippingChargedToCustomer ? 'facturé' : 'offert'}`);
    U.toast(s.shippingChargedToCustomer ? 'Frais de port marqués facturés au client.' : 'Frais de port marqués offerts.', false, entry.id);
    Store.save('sales');
    this.render();
  },

  /* ══════════ HISTORIQUE DES SORTIES (2026-09-29, refonte demandée par Antho) ══════════
     Une ligne par vente (repliée), filtres période / stock / origine / recherche, tri, 25 par page,
     suppression ciblée (une vente ou une sélection) et changement d'origine d'une vente. */
  _saleOrigin(s) { return s.historical ? 'import' : s.fromImport ? 'retour' : 'manual'; },
  _saleKind(s) { return s.source === 'event' ? 'event' : s.channel === 'online' ? 'online' : 'direct'; },
  histFiltered() {
    const f = this.histF, now = new Date(), y = now.getFullYear();
    let lo = -Infinity, hi = Infinity;
    if (f.period === '30') lo = Date.now() - 30 * 864e5;
    else if (f.period === 'year') lo = new Date(y, 0, 1).getTime();
    else if (f.period === 'lastyear') { lo = new Date(y - 1, 0, 1).getTime(); hi = new Date(y, 0, 1).getTime() - 1; }
    else if (f.period === 'custom') { if (f.from) lo = new Date(f.from + 'T00:00:00').getTime(); if (f.to) hi = new Date(f.to + 'T23:59:59').getTime(); }
    const q = (f.q || '').trim().toLowerCase();
    const list = Store.state.sales.filter(s => {
      if (s.ts < lo || s.ts > hi) return false;
      if (f.src !== 'all' && this._saleKind(s) !== f.src) return false;
      if (f.origin !== 'all' && this._saleOrigin(s) !== f.origin) return false;
      if (q) {
        const hay = [s.customerName, s.eventName, ...(s.items || []).flatMap(i => [i.name, i.label, i.sku, i.desc])].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const dir = f.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (f.sort === 'total') return dir * (U.num(a.total) - U.num(b.total)) || b.ts - a.ts;
      if (f.sort === 'name') return dir * U.sortFr(a.items[0]?.name || '', b.items[0]?.name || '') || b.ts - a.ts;
      if (f.sort === 'payment') return dir * U.sortFr(this.paymentLabel(a), this.paymentLabel(b)) || b.ts - a.ts;
      return dir * (a.ts - b.ts);
    });
    return list;
  },
  setHistF(k, val) { this.histF[k] = val; if (k !== 'page') this.histF.page = 1; this.render(); if (k === 'q') U.refocus('hist_q'); },
  setHistorySort(key) {
    const f = this.histF;
    if (f.sort === key) f.dir = f.dir === 'asc' ? 'desc' : 'asc';
    else { f.sort = key; f.dir = key === 'date' || key === 'total' ? 'desc' : 'asc'; }
    f.page = 1; this.render();
  },
  toggleHistOpen(id, keepInView) {
    this._histOpen[id] = !this._histOpen[id]; this.render();
    // Replié depuis le bas d'une longue liste : on remet la vente à l'écran (sinon on se retrouve plus bas).
    if (keepInView) { const el = document.getElementById('hist-' + id); if (el) window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 140)); }
  },
  histOpenAll(open) { if (open) this.histFiltered().slice((this.histF.page - 1) * 25, this.histF.page * 25).forEach(s => { this._histOpen[s.id] = true; }); else this._histOpen = {}; this.render(); },
  toggleHistSel(id, on) { if (on) this._histSel[id] = true; else delete this._histSel[id]; this.render(); },
  histSelectList(ids, on) { ids.forEach(id => { if (on) this._histSel[id] = true; else delete this._histSel[id]; }); this.render(); },
  histSelectPeriod() { this.histSelectList(this.histFiltered().map(s => s.id), true); },
  _selIds() { return Object.keys(this._histSel).filter(id => Store.state.sales.some(s => s.id === id)); },

  /* Changer l'origine d'une vente (ou de la sélection) : 🌐 en ligne / 🏪 directe / 🎪 événement.
     Ne touche pas au stock : c'est une étiquette pour les statistiques. Quitter « événement »
     retire le nom d'événement (sinon la vente resterait comptée dans les stats par événement). */
  setSaleOrigin(ids, o) {
    ids = [].concat(ids);
    const sales = Store.state.sales.filter(s => ids.includes(s.id));
    if (!sales.length || !['online', 'direct', 'event'].includes(o)) return;
    const snaps = sales.map(s => Store.snapshot('sales', s));
    sales.forEach(s => {
      if (o === 'event') { s.source = 'event'; s.channel = 'direct'; }
      else { s.source = 'general'; s.channel = o; if (s.eventName) { s.eventName = ''; } }
    });
    const lbl = { online: 'En ligne', direct: 'Directe', event: 'Événement' }[o];
    const entry = Store.log('vente', `Origine changée → ${lbl} (${sales.length} vente(s))`, { type: 'restoreBatch', data: snaps });
    Store.save('sales'); this.render();
    U.toast(`${sales.length} vente(s) passée(s) en « ${lbl} ».`, false, entry.id);
  },

  /* Suppression ciblée. Import historique / vente annulée / sans mouvement de stock : simple retrait.
     Vraie vente qui avait retiré du stock : on demande « remettre le stock » ou « supprimer seulement ». */
  async deleteSales(ids) {
    ids = [].concat(ids).filter(id => Store.state.sales.some(s => s.id === id));
    if (!ids.length) return;
    const sales = Store.state.sales.filter(s => ids.includes(s.id));
    const withStock = sales.filter(s => !s.historical && !s.cancelled && (s.undoOps || []).length);
    const tot = sales.reduce((a, s) => a + (s.cancelled ? 0 : U.num(s.total)), 0);
    const what = sales.length === 1 ? `la vente du ${U.frDateTime(sales[0].ts)} (${U.eur(sales[0].total)})` : `${sales.length} ventes (${U.eur(tot)})`;
    if (!withStock.length) {
      if (!await U.confirm(`Supprimer ${what} de l'historique ? Elle(s) disparai(ssen)t aussi des statistiques. Le stock n'est pas modifié. (Annulable depuis le Journal.)`)) return;
      this._doDelete(ids, false); return;
    }
    this._pendingDel = ids;
    U.modal({
      title: '🗑️ Supprimer ' + (sales.length === 1 ? 'cette vente' : 'ces ventes'), hideOk: true,
      body: `<p>${what.charAt(0).toUpperCase() + what.slice(1)} — dont <b>${withStock.length}</b> qui ${withStock.length > 1 ? 'avaient' : 'avait'} retiré du stock.</p>
        <p class="muted">Que faire du stock retiré par ${withStock.length > 1 ? 'ces ventes' : 'cette vente'} ?</p>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
          <button class="btn-cta" onclick="Ventes._doDelete(Ventes._pendingDel,true)">↩️ Supprimer et remettre le stock</button>
          <button class="btn-ghost" onclick="Ventes._doDelete(Ventes._pendingDel,false)">🗑️ Supprimer seulement (le stock ne bouge pas)</button>
        </div>`
    });
  },
  _doDelete(ids, restock) {
    if (!ids || !ids.length) return;
    const sales = Store.state.sales.filter(s => ids.includes(s.id));
    const snaps = sales.map(s => Store.snapshot('sales', s));
    const domains = new Set(['sales']);
    if (restock) {
      const seen = new Set();
      sales.filter(s => !s.historical && !s.cancelled).forEach(s => (s.undoOps || []).forEach(op => {
        const dom = op.kind === 'A' ? 'catalogA' : op.kind === 'C' ? 'consumables' : 'stockM';
        const it = Store.state[dom].find(x => x.id === op.pId);
        if (it && !seen.has(dom + op.pId)) { seen.add(dom + op.pId); snaps.push(Store.snapshot(dom, it)); domains.add(dom); }
      }));
      sales.filter(s => !s.historical && !s.cancelled).forEach(s => (s.undoOps || []).forEach(op => this.applyUndoOp(op)));
    }
    Store.state.sales = Store.state.sales.filter(s => !ids.includes(s.id));
    ids.forEach(id => { delete this._histSel[id]; delete this._histOpen[id]; });
    this._pendingDel = null;
    const entry = Store.log('vente', `${sales.length} vente(s) supprimée(s) de l'historique` + (restock ? ' — stock remis' : ''), { type: 'restoreBatch', data: snaps });
    Store.save(...domains);
    if (document.getElementById('modalBg')) U.closeModal();
    this.render();
    U.toast(`${sales.length} vente(s) supprimée(s)` + (restock ? ', stock remis' : '') + '.', false, entry.id);
  },

  _isRealEvent(s) { return s.source === 'event' && !!(s.eventName || s.fromImport || U.num(s.eventFee) || U.num(s.travelCost)); },
  historyTable() {
    const f = U.syncFilters('ventes_hist', this.histF) || this.histF;
    const all = this.histFiltered();
    const PER = 25;
    const pages = Math.max(1, Math.ceil(all.length / PER));
    if (f.page > pages) f.page = pages;
    const pageList = all.slice((f.page - 1) * PER, f.page * PER);
    const active = all.filter(s => !s.cancelled);
    const caTot = active.reduce((a, s) => a + U.num(s.total), 0);
    const today = Store.state.sales.filter(s => !s.cancelled && new Date(s.ts).toDateString() === new Date().toDateString());
    const caJour = today.reduce((a, s) => a + s.total, 0);
    const sel = this._selIds();
    const pageIds = pageList.map(s => s.id);
    const allPageSel = pageIds.length && pageIds.every(id => this._histSel[id]);
    const pBtn = (k, l) => `<button class="${f.period === k ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Ventes.setHistF('period','${k}')">${l}</button>`;
    const sortBtn = (key, label) => `<button class="${f.sort === key ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Ventes.setHistorySort('${key}')">${label} ${f.sort === key ? (f.dir === 'asc' ? '▲' : '▼') : ''}</button>`;
    const originBadge = s => s.historical ? '<span class="badge" title="Import historique : n\'a pas touché au stock">📚 historique</span>' : s.fromImport ? '<span class="badge" title="Import d\'un retour d\'événement SumUp">📥 retour</span>' : '';
    const kindLbl = s => s.source === 'event' ? 'Événement' : s.channel === 'online' ? 'En ligne' : 'Général';
    const field = (label, html) => `<span class="sh-field"><span class="sh-lbl">${label}</span>${html}</span>`;
    const rowsHtml = pageList.map(s => {
      const open = !!this._histOpen[s.id];
      const nTodo = s.items.filter(i => i.todo === 'open').length;
      // Colonnes FIXES (grille .hist-row) alignées sur la ligne de titres (2026-09-29).
      const head = `<tr id="hist-${s.id}" class="sale-head ${s.cancelled ? 'dim' : ''}${this._histSel[s.id] ? ' is-sel' : ''}"><td colspan="7"><div class="hist-row">
          <span class="hc-cb"><input type="checkbox" class="hist-cb" ${this._histSel[s.id] ? 'checked' : ''} title="Sélectionner" onclick="event.stopPropagation();Ventes.toggleHistSel('${s.id}',this.checked)"></span>
          <span class="hc-tg"><button class="btn-icon hist-tg" title="${open ? 'Replier' : 'Voir les articles'}" onclick="Ventes.toggleHistOpen('${s.id}')">${open ? '▾' : '▸'}</button></span>
          <span class="hc-date sh-date" style="cursor:pointer;" onclick="Ventes.toggleHistOpen('${s.id}')">${U.frDateTime(s.ts)}</span>
          <span class="hc-kind"><span class="badge info">${kindLbl(s)}</span></span>
          <span class="hc-orig">${originBadge(s) || '<span class="muted">manuelle</span>'}</span>
          <span class="hc-ev">${s.eventName ? `<span class="sh-event" title="${U.esc(s.eventName)}">🎪 ${U.esc(s.eventName)}</span>` : s.customerName ? `<span title="Client">👤 ${U.esc(s.customerName)}</span>` : '<span class="muted">—</span>'}</span>
          <span class="hc-pay">${this.paymentLabel(s)}</span>
          <span class="hc-prod muted" title="${U.esc(s.items.map(i => i.name).join(', '))}">${nTodo && !s.cancelled ? `<button class="btn-ghost btn-sm hc-todo" title="${nTodo} article(s) pas encore déduit(s) du stock" onclick="Ventes.openTodo()">🧩 ${nTodo}</button> ` : ''}${s.items.length ? U.esc(s.items[0].name) + (s.items.length > 1 ? ` <b>+${s.items.length - 1}</b>` : '') : '—'}</span>
          <span class="hc-n">${s.items.length}</span>
          <span class="hc-tot"><b>${U.eur(s.total)}</b></span>
          <span class="hc-act"><span class="a1">${!s.cancelled && s.source === 'event' ? `<button class="btn-ghost btn-sm" title="Nom de l'événement, frais de stand, consommables" onclick="Ventes.editEventTicket('${s.id}')">🎪 Modifier</button>` : ''}</span><span class="a2">${s.cancelled ? '<span class="badge bad">annulée</span>' : s.historical ? '' : `<button class="btn-ghost btn-sm" title="Annuler la sortie et remettre le stock (la vente reste, marquée annulée)" onclick="Ventes.cancelSale('${s.id}')">Annuler</button>`}</span><span class="a3"><button class="btn-ghost btn-sm" title="Supprimer de l'historique" onclick="Ventes.deleteSales('${s.id}')">🗑</button></span></span>
        </div></td></tr>`;
      if (!open) return head;
      const kind = this._saleKind(s);
      const detail = `<tr class="sale-detail ${s.cancelled ? 'dim' : ''}"><td colspan="7"><div class="sh-info">
          <button class="btn-ghost btn-sm" title="Replier cette vente" onclick="Ventes.toggleHistOpen('${s.id}')">▴ Replier</button>
          ${field('Origine', `<select class="hist-origin" onchange="Ventes.setSaleOrigin('${s.id}',this.value)"><option value="online" ${kind === 'online' ? 'selected' : ''}>🌐 En ligne</option><option value="direct" ${kind === 'direct' ? 'selected' : ''}>🏪 Directe</option><option value="event" ${kind === 'event' ? 'selected' : ''}>🎪 Événement</option></select>`)}
          ${field('Remise', this.deliveryLabel(s))}
          ${s.delivery === 'livraison' ? field('Port client', `<span class="badge ${s.shippingChargedToCustomer ? 'info' : 'warn'}" style="cursor:pointer;" title="Cliquer pour changer" onclick="Ventes.toggleShippingCharged('${s.id}')">${s.shippingChargedToCustomer ? `✅ Facturé (${U.eur(s.shippingFeeCollected)})` : '❌ Offert'}</span>`) : ''}
          ${s.delivery === 'livraison' ? field('Frais d\'envoi', `<input type="number" step="0.01" min="0" value="${U.num(s.shippingCost)}" style="width:80px;" onchange="Ventes.setShippingCost('${s.id}',this.value)">`) : ''}
          ${this._isRealEvent(s) ? field('Frais stand', `<input type="number" step="0.01" min="0" value="${U.num(s.eventFee)}" style="width:80px;" onchange="Ventes.setEventFee('${s.id}',this.value)">`) : ''}
          ${this._isRealEvent(s) ? field('Déplacement', `<span class="sensitive" title="Détail km / carburant / péages : bouton 🎪 Modifier">${U.eur(s.travelCost)}</span>`) : ''}
        </div></td></tr>`;
      const items = s.items.map(i => `<tr class="${s.cancelled ? 'dim' : ''}">
        <td class="col-name" style="text-align:left;"><b>${U.esc(i.name)}</b>${U.num(i.pack) >= 2 ? ` <span class="badge info">${U.qty(i.packs)} lot${i.packs > 1 ? 's' : ''} de ${i.pack}</span>` : ''}</td>
        <td>${i.label ? U.esc(i.label) : '—'}</td>
        <td>${i.sku ? `<span class="tag">${U.esc(i.sku)}</span>` : '—'}</td>
        <td>${i.todo === 'open' ? `<span class="badge warn">🧩 à traiter</span>` : i.deducted === false ? `<span class="badge info">${i.todo === 'caOnly' ? '💶 CA seul' : '✔ fait à la main'}</span>` : i.lotLabel ? `<span class="tag">${U.esc(i.lotLabel)}</span>` : '—'}</td>
        <td class="num">${U.qty(i.qty)}</td>
        <td class="num">${U.eur(i.price)}</td>
        <td class="num"><b>${U.eur(i.price * i.qty)}</b></td>
      </tr>`).join('');
      return head + detail + `<tr class="hist-items-h"><th class="col-name" style="text-align:left;">Produit</th><th>Variante</th><th>SKU</th><th>Lot / DLUO</th><th class="num">Qté</th><th class="num">Prix U.</th><th class="num">Total</th></tr>` + items + `<tr class="hist-fold-foot"><td colspan="7"><button class="btn-ghost btn-sm" onclick="Ventes.toggleHistOpen('${s.id}',true)">▴ Replier cette vente (${s.items.length} article(s))</button></td></tr>`;
    }).join('');
    const pager = pages > 1 ? `<div class="hist-pager"><button class="btn-ghost btn-sm" ${f.page <= 1 ? 'disabled' : ''} onclick="Ventes.setHistF('page',${f.page - 1})">◀</button>
      ${Array.from({ length: pages }, (_, i) => i + 1).filter(n => n === 1 || n === pages || Math.abs(n - f.page) <= 2).map((n, i, arr) => (i && n - arr[i - 1] > 1 ? '<span class="muted">…</span>' : '') + `<button class="${n === f.page ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Ventes.setHistF('page',${n})">${n}</button>`).join('')}
      <button class="btn-ghost btn-sm" ${f.page >= pages ? 'disabled' : ''} onclick="Ventes.setHistF('page',${f.page + 1})">▶</button></div>` : '';
    return `<p class="muted">Aujourd'hui : <b>${U.eur(caJour)}</b> (${today.length} sorties)</p>
      <div class="hist-filters">
        <div class="hist-periods"><span class="muted">Période :</span>${pBtn('30', '30 derniers jours')}${pBtn('year', 'Cette année')}${pBtn('lastyear', 'Année dernière')}${pBtn('all', 'Tout')}${pBtn('custom', 'Du… au…')}
          ${f.period === 'custom' ? `<input type="date" value="${f.from}" onchange="Ventes.setHistF('from',this.value)"> <span class="muted">au</span> <input type="date" value="${f.to}" onchange="Ventes.setHistF('to',this.value)">` : ''}</div>
        <div class="grid c3">
          <div class="fg mb0"><label>Stock / canal</label><select onchange="Ventes.setHistF('src',this.value)"><option value="all" ${f.src === 'all' ? 'selected' : ''}>Tous</option><option value="event" ${f.src === 'event' ? 'selected' : ''}>🎪 Événement</option><option value="direct" ${f.src === 'direct' ? 'selected' : ''}>🏪 Général — directe</option><option value="online" ${f.src === 'online' ? 'selected' : ''}>🌐 En ligne</option></select></div>
          <div class="fg mb0"><label>Origine</label><select onchange="Ventes.setHistF('origin',this.value)"><option value="all" ${f.origin === 'all' ? 'selected' : ''}>Toutes</option><option value="manual" ${f.origin === 'manual' ? 'selected' : ''}>Ventes manuelles</option><option value="retour" ${f.origin === 'retour' ? 'selected' : ''}>Retours d'événement</option><option value="import" ${f.origin === 'import' ? 'selected' : ''}>Imports historiques</option></select></div>
          <div class="fg mb0"><label>Recherche</label><input id="hist_q" value="${U.esc(f.q)}" placeholder="produit, client, événement…" oninput="Ventes.setHistF('q',this.value)"></div>
        </div>
      </div>
      <div class="hist-summary"><span><b>${all.length}</b> vente(s) · <b class="sensitive">${U.eur(caTot)}</b>${all.length !== active.length ? ` <span class="muted">(${all.length - active.length} annulée(s) non comptée(s))</span>` : ''}</span>
        <span class="hist-sorts"><span class="muted">Trier :</span>${sortBtn('date', 'Date')}${sortBtn('total', 'Total')}${sortBtn('name', 'Produit')}${sortBtn('payment', 'Paiement')}</span></div>
      <div class="hist-tools">
        <label class="hist-selall"><input type="checkbox" ${allPageSel ? 'checked' : ''} onclick="Ventes.histSelectList(${U.esc(JSON.stringify(pageIds))},this.checked)"> Tout cocher (page)</label>
        ${all.length > pageList.length ? `<button class="btn-ghost btn-sm" onclick="Ventes.histSelectPeriod()">☑ Cocher les ${all.length} de la période</button>` : ''}
        <button class="btn-ghost btn-sm" onclick="Ventes.histOpenAll(true)">📂 Tout déplier</button><button class="btn-ghost btn-sm" onclick="Ventes.histOpenAll(false)">📁 Tout replier</button>
      </div>
      ${sel.length ? `<div class="hist-selbar"><b>${sel.length} vente(s) sélectionnée(s)</b>
        <span class="muted">Origine :</span><select onchange="if(this.value){Ventes.setSaleOrigin(Ventes._selIds(),this.value)}"><option value="">— changer —</option><option value="online">🌐 En ligne</option><option value="direct">🏪 Directe</option><option value="event">🎪 Événement</option></select>
        <button class="btn-danger btn-sm" onclick="Ventes.deleteSales(Ventes._selIds())">🗑 Supprimer la sélection</button>
        <button class="btn-ghost btn-sm" onclick="Ventes._histSel={};Ventes.render()">✕ Désélectionner</button></div>` : ''}
      <div class="table-wrap"><table class="sales-hist"><tbody>${pageList.length ? (() => { const hs = (key, label, cls) => `<span class="${cls}${key ? ' sortable' + (f.sort === key ? ' active' : '') : ''}"${key ? ` onclick="Ventes.setHistorySort('${key}')"` : ''}>${label}${key ? (f.sort === key ? (f.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇕') : ''}</span>`; return `<tr class="hist-head"><td colspan="7"><div class="hist-row"><span class="hc-cb"></span><span class="hc-tg"></span>${hs('date', 'Date', 'hc-date')}${hs('', 'Canal', 'hc-kind')}${hs('', 'Origine', 'hc-orig')}${hs('', 'Événement', 'hc-ev')}${hs('payment', 'Paiement', 'hc-pay')}${hs('name', 'Produits', 'hc-prod')}${hs('', 'Art.', 'hc-n')}${hs('total', 'Total', 'hc-tot')}<span class="hc-act"></span></div></td></tr>`; })() : ''}${rowsHtml || '<tr><td colspan="7" class="muted">Aucune vente pour ces filtres.</td></tr>'}</tbody></table></div>
      ${pager}`;
  },

  exportSales() {
    const rows = [['Date', 'Stock', 'Canal', 'Paiement', 'Remise', 'Client', 'Port_facture_client', 'Frais_port_encaisses', 'Frais_envoi', 'Frais_stand', 'Frais_deplacement', 'Evenement', 'Cout_conso', 'Produit', 'Variante', 'SKU', 'Lot', 'Quantite', 'Prix_unitaire', 'Total', 'Annulee']];
    const list = this.histFiltered();
    list.forEach(s => s.items.forEach((i, idx) => {
      rows.push([U.frDateTime(s.ts), s.source === 'event' ? 'Evenement' : 'General',
        s.channel === 'online' ? 'En ligne' : s.channel === 'direct' ? 'Directe' : '', s.payment || '',
        s.delivery === 'livraison' ? 'Livraison' : s.delivery === 'clickcollect' ? 'Click and Collect' : '', s.customerName || '',
        s.delivery === 'livraison' ? (s.shippingChargedToCustomer ? 'oui' : 'non') : '',
        idx === 0 && s.delivery === 'livraison' ? U.num(s.shippingFeeCollected).toFixed(2) : '',
        idx === 0 ? U.num(s.shippingCost).toFixed(2) : '',
        idx === 0 ? U.num(s.eventFee).toFixed(2) : '',
        idx === 0 ? U.num(s.travelCost).toFixed(2) : '',
        s.eventName || '',
        idx === 0 ? U.num(s.items.filter(x => x.kind === 'C').reduce((a, x) => a + U.num(x.cost), 0)).toFixed(2) : '',
        i.name, i.label || '', i.sku || '', i.lotLabel || '',
        U.num(i.qty), U.num(i.price).toFixed(2), (U.num(i.price) * U.num(i.qty)).toFixed(2), s.cancelled ? 'oui' : 'non']);
    }));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    U.download(`ventes-touffu-${U.today()}.csv`, '﻿' + csv, 'text/csv');
    U.toast(`${list.length} vente(s) exportée(s) (CSV) — celles affichées par les filtres.`);
  },

  /* ═══════════ RETOUR D'ÉVÉNEMENT — import des ventes SumUp (CSV) ═══════════
     Regroupe les ventes par journée de marché (frontière 5h du matin pour ne pas
     couper un marché nocturne à minuit), relie chaque ligne à une variante de stock
     par SON SKU EXACT (jamais par ressemblance de nom), et crée une sortie par
     journée retenue qui déduit le stock ÉVÉNEMENT. Anti-doublon par Réf. transaction.
     Rien n'est déduit sans validation manuelle ; les lignes sans SKU ou à SKU inconnu
     sont listées à part pour traitement à la main. */
  toggleRetour() {
    this.retourOpen = !this.retourOpen; if (!this.retourOpen) this.retourData = null;
    // L'état ouvert/fermé est porté par l'URL (#/ventes/retour) → un F5 garde le panneau ouvert.
    history.replaceState(null, '', '#/ventes' + (this.retourOpen ? '/retour' : ''));
    this.render();
  },
  resetRetour() { this.retourData = null; this.render(); },
  setRetourMerge(b) { if (this.retourData) { this.retourData.mergeOne = b; this.render(); } },
  setRetourDeduct(b) { this.retourDeduct = b; this.render(); },
  /* Regroupe TOUTES les lignes vendues d'un bucket par produit (nom, ou SKU si présent) —
     pour l'import HISTORIQUE : on enregistre tout (même sans SKU) pour les stats, sans déduire. */
  _groupAllForHistory(lines) {
    const map = {};
    lines.forEach(l => {
      const name = l.target ? l.target.name : (l.desc || 'Sans nom');
      const k = (l.sku || '') + '||' + name + '||' + (l.target ? l.target.label || '' : '');
      const g = map[k] || (map[k] = {
        kind: l.target ? l.target.kind : 'M', pId: l.target ? l.target.pId : '', vId: l.target ? l.target.vId : '',
        name, label: l.target ? l.target.label || '' : '', sku: l.sku || '', qty: 0, ttc: 0
      });
      g.qty += l.qty; g.ttc += l.ttc;
    });
    return Object.values(map).map(g => ({ ...g, unit: g.qty > 0 ? g.ttc / g.qty : g.ttc }));
  },
  toggleRetourDay(key) { const g = this.retourData?.days.find(d => d.key === key); if (g) { g.include = !g.include; this.render(); } },

  /* Regroupe les lignes reconnues identiques (même variante) en une seule : qté sommée,
     prix unitaire = total TTC / qté totale (moyenne pondérée, garde le vrai encaissé). */
  _groupOk(lines) {
    const map = {};
    lines.forEach(l => {
      const pk = U.num(l.target.pack) >= 2 ? U.num(l.target.pack) : 1;
      const k = l.target.kind + '|' + l.target.pId + '|' + l.target.vId + '|' + pk;
      const g = map[k] || (map[k] = { kind: l.target.kind, pId: l.target.pId, vId: l.target.vId, name: l.target.name, label: l.target.label, sku: l.target.sku || l.sku, mapped: false, qty: 0, ttc: 0, pack: pk, packs: 0 });
      if (l.status === 'mapped') g.mapped = true;
      g.qty += l.qty * pk; g.packs += l.qty; g.ttc += l.ttc;
    });
    return Object.values(map).map(g => ({ ...g, unit: g.qty > 0 ? g.ttc / g.qty : g.ttc }));
  },
  /* Regroupe les lignes à traiter à la main par (SKU + libellé). */
  _groupProblems(lines) {
    const map = {};
    lines.forEach(l => {
      const k = l.status + '||' + (l.sku || '') + '||' + l.desc;
      const g = map[k] || (map[k] = { desc: l.desc, sku: l.sku, status: l.status, qty: 0, ttc: 0 });
      g.qty += l.qty; g.ttc += l.ttc;
    });
    return Object.values(map).map(g => ({ ...g, unit: g.qty > 0 ? g.ttc / g.qty : g.ttc }));
  },

  /* ⚠️ Ambiguïté de lot à l'IMPORT (jamais en vente manuelle, où le lot est choisi) :
     si la variante a ≥2 lots avec du stock événement et qu'on n'en vend qu'une PARTIE
     (qty < total des lots), impossible de savoir quel lot est parti → déduction interdite,
     à faire à la main. Si qty ≥ total, tout part (aucune ambiguïté) → déduction OK. */
  _isAmbiguousEvent(v, qty) {
    if (!v) return false;
    const stocked = (v.lots || []).filter(l => U.num(l.qtyEvent) > 0);
    if (stocked.length <= 1) return false;
    const total = stocked.reduce((a, l) => a + U.num(l.qtyEvent), 0);
    return qty < total;
  },

  /* Buckets = tickets à créer (un par journée retenue, ou un seul si fusion). */
  _retourBuckets(d, imported) {
    const groups = d.days.filter(g => g.include && g.lines.some(l => !imported.has(l.ref)));
    return d.mergeOne
      ? [{ label: 'Retour événement (journées fusionnées)', ts: groups.length ? Math.max(...groups.map(g => g.ts)) : Date.now(), keys: groups.map(g => g.key), lines: groups.flatMap(g => g.lines) }]
      : groups.map(g => ({ label: g.label, ts: g.ts, keys: [g.key], lines: g.lines }));
  },

  /* Sépare les lignes reconnues (déjà regroupées par variante) en "safe" (déductibles
     sans ambiguïté) et "ambiguous" (multi-lots, vente partielle → à faire à la main). */
  _retourSplit(okLines) {
    const grouped = this._groupOk(okLines);
    const safe = [], ambiguous = [];
    grouped.forEach(g => {
      if (g.kind === 'M') {
        const p = Store.state.stockM.find(x => x.id === g.pId);
        const v = p && p.variants.find(x => x.id === g.vId);
        if (this._isAmbiguousEvent(v, g.qty)) {
          const stocked = v.lots.filter(l => U.num(l.qtyEvent) > 0).sort((a, b) => (a.dluo || '9999').localeCompare(b.dluo || '9999'));
          ambiguous.push({ ...g, total: stocked.reduce((a, l) => a + U.num(l.qtyEvent), 0), nLots: stocked.length, lots: stocked.map(l => ({ n: l.lotNumber || 'sans n°', dluo: l.dluo, q: U.num(l.qtyEvent) })) });
          return;
        }
      }
      safe.push(g);
    });
    return { safe, ambiguous };
  },

  /* ── Ventes en liquide (espèces) rattachées à la journée, absentes de SumUp ── */
  setCashQ(v) { this.cashQ = v; this.cashOpen = true; this.cashSelKey = ''; this.render(); },
  closeCashMenu() { if (this.cashOpen) { this.cashOpen = false; this.render(); } },
  pickCashProduct(key) {
    const u = this.units().find(x => x.key === key);
    this.cashSelKey = key; this.cashQ = u ? u.name + (u.label ? ' · ' + u.label : '') : this.cashQ;
    this.cashOpen = false; this.cashPrice = u ? u.price : ''; this.cashQty = 1; this.render();
  },
  setCashDate(v) { if (this.retourData) this.retourData.cashDate = v; },
  addCashLine() {
    if (!this.retourData) return;
    const u = this.units().find(x => x.key === this.cashSelKey);
    if (!u) { U.toast('Choisis un produit.', true); return; }
    const qty = U.num(this.cashQty) || U.numVal('cash_qty');
    if (qty <= 0) { U.toast('Quantité invalide.', true); return; }
    const price = this.cashPrice !== '' ? U.num(this.cashPrice) : u.price;
    this.retourData.cashLines.push({ kind: u.kind, pId: u.pId, vId: u.vId, name: u.name, label: u.label, sku: u.sku, price, qty });
    this.cashSelKey = ''; this.cashQ = ''; this.cashQty = 1; this.cashPrice = '';
    this.render();
  },
  removeCashLine(i) { if (this.retourData) { this.retourData.cashLines.splice(i, 1); this.render(); } },

  _frNum(s) { return U.num(String(s == null ? '' : s).replace(/\s/g, '').replace(',', '.')); },

  _frDate(s) {
    const m = String(s || '').trim().match(/(\d{1,2})\s+([A-Za-zéûôàèê.]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!m) return NaN;
    const months = { janvier:0, 'janv':0, 'févr':1, fevr:1, 'février':1, fevrier:1, mars:2, avril:3, avr:3, mai:4, juin:5, juillet:6, juil:6, 'août':7, aout:7, septembre:8, sept:8, octobre:9, oct:9, novembre:10, nov:10, 'décembre':11, 'déc':11, decembre:11, dec:11 };
    const key = m[2].toLowerCase().split('.').join('');
    const mo = months[key];
    if (mo === undefined) return NaN;
    return new Date(+m[3], mo, +m[1], +m[4], +m[5]).getTime();
  },

  /* Frontière de journée de marché à 5h : une vente à 01h reste rattachée à la veille. */
  _marketDay(ts) {
    if (isNaN(ts)) return 'date-inconnue';
    const d = new Date(ts - 5 * 3600 * 1000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },

  /* Parseur CSV robuste (champs entre guillemets, virgules décimales, "" échappé). Séparateur virgule. */
  _csvRows(text) {
    const rows = []; let row = [], field = '', inQ = false;
    text = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  },

  /* SKU (majuscule, sans espaces) -> cible stock (variante Mastication ou accessoire).
     Un SKU porté par PLUSIEURS fiches n'est jamais utilisé (risque de déduire le mauvais produit) :
     il est renvoyé dans `dups` et les lignes correspondantes partent « à traiter ». */
  _skuIndex() {
    const idx = {}, dups = new Set();
    const add = (sku, t) => { if (!sku) return; if (idx[sku]) dups.add(sku); else idx[sku] = t; };
    Store.state.stockM.forEach(p => (p.variants || []).forEach(v => {
      add((v.sku || '').trim().toUpperCase(), { kind: 'M', pId: p.id, vId: v.id, name: p.name, label: Pricing.labelVariant(v), sku: v.sku || '' });
      // SKU de lot : « lot de N » = N pièces de CETTE variante (sabots en vrac…)
      (v.packSkus || []).forEach(x => add((x.sku || '').trim().toUpperCase(), { kind: 'M', pId: p.id, vId: v.id, name: p.name, label: Pricing.labelVariant(v), sku: x.sku, pack: U.num(x.n) }));
    }));
    Store.state.catalogA.forEach(a => add((a.sku || '').trim().toUpperCase(), { kind: 'A', pId: a.id, vId: '', name: a.name, label: a.category || '', sku: a.sku || '' }));
    dups.forEach(s => delete idx[s]);
    return { idx, dups };
  },
  /* Associations « libellé SumUp → produit » choisies par Antho (settings.sumupMap) : réutilisées
     aux imports suivants. Ce n'est jamais une devinette : uniquement ce qu'il a lui-même associé. */
  _normDesc(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); },
  _targetFor(kind, pId, vId) {
    if (kind === 'A') { const a = Store.state.catalogA.find(x => x.id === pId); return a ? { kind: 'A', pId, vId: '', name: a.name, label: a.category || '', sku: a.sku || '' } : null; }
    const p = Store.state.stockM.find(x => x.id === pId); const v = p && (p.variants || []).find(x => x.id === vId);
    return v ? { kind: 'M', pId, vId, name: p.name, label: Pricing.labelVariant(v), sku: v.sku || '' } : null;
  },
  _mapTarget(desc) {
    const m = (Store.state.settings.sumupMap || {})[this._normDesc(desc)];
    const t = m ? this._targetFor(m.kind, m.pId, m.vId) : null;
    if (t && U.num(m.n) >= 2) t.pack = U.num(m.n);
    return t;
  },
  /* Lien ↗ : ouvre la fiche du produit dans un nouvel onglet (Stock → Mastication / Accessoires). */
  stockHref(kind, pId) { return kind === 'A' ? '#/accessoires/' + pId : kind === 'C' ? '#/stock/conso' : '#/stock/mastication/' + pId; },
  openLink(kind, pId) { return pId ? `<a class="btn-icon open-tab" href="${this.stockHref(kind, pId)}" target="_blank" rel="noopener" title="Ouvrir la fiche dans un nouvel onglet (contrôler / modifier)">↗</a>` : ''; },

  analyzeRetour() {
    const inp = document.getElementById('retour_file');
    const file = inp && inp.files[0];
    if (!file) { U.toast('Choisis d\'abord un fichier CSV.', true); return; }
    const reader = new FileReader();
    reader.onload = () => { try { this.parseRetour(reader.result); } catch (e) { U.toast('Fichier illisible : ' + e.message, true); } };
    reader.readAsText(file);
  },

  parseRetour(text) {
    const rows = this._csvRows(text);
    if (rows.length < 2) { U.toast('Fichier vide ou sans ventes.', true); return; }
    const header = rows[0].map(h => h.trim().toLowerCase());
    const find = (...keys) => header.findIndex(h => keys.some(k => h.includes(k)));
    const iDate = find('date'), iType = find('type'), iRef = find('transaction'),
      iQty = find('quantité', 'quantite'), iDesc = find('description'),
      iSku = header.findIndex(h => h === 'sku'), iTtc = find('ttc');
    if ([iDate, iRef, iQty, iDesc, iSku, iTtc].some(i => i < 0)) {
      U.toast('Colonnes SumUp introuvables (Date, Réf. transaction, Quantité, Description, SKU, Prix TTC).', true); return;
    }
    const { idx: skuIdx, dups } = this._skuIndex();
    const dayMap = {};
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (iType >= 0 && (r[iType] || '').trim().toLowerCase() !== 'vente') continue; // ignore remboursements etc.
      const ref = (r[iRef] || '').trim();
      const qty = Math.round(this._frNum(r[iQty]));
      if (!ref || qty <= 0) continue;
      const ts = this._frDate(r[iDate]);
      const ttc = this._frNum(r[iTtc]);
      const sku = (r[iSku] || '').trim();
      const line = { ref, ts, desc: (r[iDesc] || '').trim(), sku, qty, ttc, unit: qty > 0 ? ttc / qty : ttc };
      const SKU = sku.toUpperCase();
      const target = sku && !dups.has(SKU) ? skuIdx[SKU] : null;
      line.status = !sku ? 'noSku' : dups.has(SKU) ? 'dupSku' : target ? 'ok' : 'unknownSku';
      if (target) line.target = target;
      else { const mt = this._mapTarget(line.desc); if (mt) { line.target = mt; line.mappedFrom = line.status; line.status = 'mapped'; } }
      const dk = this._marketDay(ts);
      const g = dayMap[dk] || (dayMap[dk] = { key: dk, ts, label: dk === 'date-inconnue' ? 'Date inconnue' : U.frDate(dk), lines: [], include: true });
      if (!isNaN(ts) && ts < g.ts) { g.ts = ts; } // garde le 1er horodatage de la journée
      g.lines.push(line);
    }
    const days = Object.values(dayMap).sort((a, b) => b.ts - a.ts);
    if (!days.length) { U.toast('Aucune vente exploitable dans ce fichier.', true); return; }
    const latest = days[0] && days[0].key !== 'date-inconnue' ? days[0].key : new Date().toISOString().slice(0, 10);
    this.retourData = { days, mergeOne: false, cashLines: [], cashDate: latest, standFees: {}, cashStandFee: '', consoLines: [] };
    this.render();
  },
  setStandFee(key, val) { if (this.retourData) { (this.retourData.standFees = this.retourData.standFees || {})[key] = U.num(val); } },
  setCashStandFee(val) { if (this.retourData) this.retourData.cashStandFee = U.num(val); },

  _retourImportedRefs() {
    const set = new Set();
    Store.state.sales.forEach(s => (s.sumupRefs || []).forEach(r => set.add(r)));
    return set;
  },

  retourPanel() {
    const d = this.retourData;
    if (!d) {
      return `<div class="card">
        <h2>📥 Retour d'événement — import des ventes SumUp</h2>
        <p class="muted help">Dépose ton export SumUp au format <b>CSV</b> (avec la colonne SKU). L'appli regroupe les ventes <b>par journée de marché</b>, déduit ton stock <b>Événement</b> pour chaque article reconnu par son SKU, et te liste à part ce qui est à traiter à la main (sans SKU / SKU inconnu). Rien n'est déduit sans ta validation, et un fichier déjà importé ne l'est jamais deux fois.</p>
        <input type="file" id="retour_file" accept=".csv,text/csv" class="mt">
        <div class="frow mt"><button class="btn-cta" onclick="Ventes.analyzeRetour()">Analyser le fichier</button></div>
      </div>`;
    }
    const imported = this._retourImportedRefs();
    let nDup = 0;
    d.days.forEach(g => g.lines.forEach(l => { if (imported.has(l.ref)) nDup++; }));
    // Tout est calculé sur les journées COCHÉES (respecte la fusion) : ce qui sera déduit / pas déduit.
    let safeQty = 0, ambQty = 0;
    const ambItems = [], safeItems = [], problems = [];
    this._retourBuckets(d, imported).forEach(b => {
      const fresh = b.lines.filter(l => !imported.has(l.ref));
      problems.push(...fresh.filter(l => !l.target));
      const { safe, ambiguous } = this._retourSplit(fresh.filter(l => l.target));
      safeQty += safe.reduce((a, g) => a + g.qty, 0);
      ambQty += ambiguous.reduce((a, g) => a + g.qty, 0);
      ambItems.push(...ambiguous);
      safeItems.push(...safe);
    });
    const safeMap = {};
    safeItems.forEach(g => { const k = g.kind + '|' + g.pId + '|' + (g.vId || '') + '|' + (g.pack || 1); const x = safeMap[k] || (safeMap[k] = { ...g, qty: 0, ttc: 0, packs: 0 }); x.qty += g.qty; x.packs += U.num(g.packs); x.ttc += g.ttc; x.mapped = x.mapped || g.mapped; });
    const unitsByKey = {}; this.units().forEach(u => { unitsByKey[u.kind === 'A' ? 'A|' + u.pId + '|' : u.key] = u; });
    const packTxt = x => U.num(x.pack) >= 2 ? ` <span class="badge info">${U.qty(x.packs)} lot${x.packs > 1 ? 's' : ''} de ${x.pack}</span>` : '';
    const safeList = Object.values(safeMap).map(g => { const u = unitsByKey[g.kind + '|' + g.pId + '|' + (g.vId || '')]; const cur = u ? U.num(u.availE) : 0; const short = g.kind === 'A' ? 0 : Math.max(0, g.qty - cur); return { ...g, cur, after: Math.max(0, cur - g.qty), short }; })
      .sort((a, b) => U.sortFr(a.name + ' ' + (a.label || ''), b.name + ' ' + (b.label || '')));
    // Plusieurs lignes pour une même variante (à l'unité + en lot) : le stock « après » se cumule.
    const _run = {};
    safeList.forEach(x => { if (x.kind === 'A') return; const vk = x.pId + '|' + x.vId; const cur = vk in _run ? _run[vk] : x.cur; x.cur = cur; x.after = Math.max(0, cur - x.qty); x.short = Math.max(0, x.qty - cur); _run[vk] = x.after; });
    const shortQty = safeList.reduce((a, x) => a + x.short, 0);
    const ambMap = {};
    ambItems.forEach(a => { const k = a.pId + '|' + a.vId; const g = ambMap[k] || (ambMap[k] = { ...a, qty: 0 }); g.qty += a.qty; });
    const ambList = Object.values(ambMap);
    const gp = this._groupProblems(problems);
    const probQty = problems.reduce((a, l) => a + l.qty, 0);
    const nBy = st => problems.filter(l => l.status === st).reduce((a, l) => a + l.qty, 0);
    const nMapped = safeList.filter(x => x.mapped).length + ambList.filter(x => x.mapped).length;
    const deduct = this.retourDeduct;
    const notParts = [ambQty ? `${ambQty} à plusieurs lots` : '', nBy('noSku') ? `${nBy('noSku')} sans SKU` : '', nBy('unknownSku') ? `${nBy('unknownSku')} SKU inconnu` : '', nBy('dupSku') ? `${nBy('dupSku')} SKU en double` : '', shortQty ? `${shortQty} manquant(s) en stock` : ''].filter(Boolean);
    const reasonTxt = st => st === 'noSku' ? 'Sans SKU' : st === 'dupSku' ? 'SKU en double dans ton stock' : 'SKU inconnu dans ton stock';
    return `<div class="card">
      <h2>📥 Retour d'événement — revue avant validation</h2>
      ${!(safeQty + ambQty + probQty) ? `<div class="retour-summary"><div class="rs-box hist"><div class="rs-n">0</div><div><b>rien de nouveau à importer</b><br><span class="muted">${nDup ? 'toutes les lignes de ce fichier ont déjà été importées' : 'aucune journée cochée'}</span></div></div></div>`
      : deduct ? `<div class="retour-summary">
        <div class="rs-box ok"><div class="rs-n">${U.qty(safeQty - shortQty)}</div><div><b>article(s) déduits</b> du stock événement à la validation<br><span class="muted">${safeList.length} produit(s) reconnus par leur SKU${nMapped ? ` (dont ${nMapped} par une association retenue 🧠)` : ''}</span></div></div>
        <div class="rs-box todo"><div class="rs-n">${U.qty(ambQty + probQty + shortQty)}</div><div><b>article(s) NON déduits</b> maintenant → à traiter juste après<br><span class="muted">${notParts.join(' · ') || 'aucun'}</span></div></div>
      </div>
      <p class="muted help">Tous les articles vendus sont enregistrés dans le ticket (chiffre d'affaires juste). Ceux qui ne sont pas déduits s'ouvrent juste après la validation dans « 🧩 Articles à traiter » : associer le bon produit (des ressemblances de nom te sont proposées), choisir le lot, puis déduire.</p>`
      : `<div class="retour-summary"><div class="rs-box hist"><div class="rs-n">${U.qty(safeQty + ambQty + probQty)}</div><div><b>article(s) ajoutés aux statistiques</b><br><span class="muted">import historique : le stock n'est PAS touché</span></div></div></div>`}
      <div class="frow" style="gap:8px;flex-wrap:wrap;margin-top:8px;">
        ${nDup ? `<span class="badge info">↩️ ${nDup} ligne(s) déjà importée(s) — ignorée(s)</span>` : ''}
      </div>
      <label class="mt" style="display:flex;gap:8px;align-items:center;text-transform:none;cursor:pointer;">
        <input type="checkbox" ${d.mergeOne ? 'checked' : ''} onclick="Ventes.setRetourMerge(this.checked)">
        Fusionner les journées cochées en un seul ticket (ex : marché sur un week-end)</label>
      <div class="mt">${d.days.map(g => this.retourDayCard(g, imported)).join('')}</div>
      ${safeList.length ? `<details class="fold" style="margin-top:12px;" ${this._retourSafeOpen !== false ? 'open' : ''} ontoggle="Ventes._retourSafeOpen=this.open"><summary><b>✅ ${safeList.length} produit(s) ${deduct ? 'déduits du stock événement' : 'reconnus (enregistrés sans déduction)'}</b> (${U.qty(safeQty)} article(s))${deduct && shortQty ? ` <span class="badge bad">⚠️ stock insuffisant sur ${safeList.filter(x => x.short).length}</span>` : ''}</summary><div class="fold-body">
        <div class="table-wrap"><table><thead><tr><th class="col-name">Produit</th><th>Variante</th><th>SKU</th><th class="num">Qté vendue</th><th class="num">Stock évén. actuel</th><th class="num">${deduct ? 'Après validation' : 'Après (inchangé)'}</th><th></th></tr></thead>
        <tbody>${safeList.map(x => `<tr${x.short && deduct ? ' style="color:var(--alerte);"' : ''}><td class="col-name"><b>${U.esc(x.name)}</b>${packTxt(x)}${x.mapped ? ' <span class="badge info" title="Relié par une association que tu as retenue lors d\'un import précédent">🧠 retenu</span>' : ''}</td><td>${U.esc(x.label || '')}</td><td>${x.sku ? `<span class="tag">${U.esc(x.sku)}</span>` : '—'}</td><td class="num"><b>${U.qty(x.qty)}</b></td><td class="num">${x.kind === 'A' ? '<span class="muted">accessoire</span>' : U.qty(x.cur)}</td><td class="num">${x.kind === 'A' ? '—' : deduct ? `<b>${U.qty(x.after)}</b>${x.short ? ` <span class="badge bad" title="Stock événement insuffisant : ${U.qty(x.short)} ne pourront pas être déduits (sans doute un stock pas encore saisi)">−${U.qty(x.short)} manquant</span>` : ''}` : U.qty(x.cur)}</td><td>${this.openLink(x.kind, x.pId)}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted help" style="font-size:.82rem;">Un seul lot en stock événement, ou tous les lots vendus en entier : la déduction est sûre, elle se fait directement (DLUO la plus courte d'abord). Le stock ne passe jamais en négatif.</p>
      </div></details>` : ''}
      ${ambList.length ? `<details class="fold" style="margin-top:12px;" open><summary><b>🔀 ${ambList.length} produit(s) à plusieurs lots</b> (${U.qty(ambQty)} article(s)) — ${deduct ? 'tu choisiras le lot juste après' : 'enregistrés sans déduction'}</summary><div class="fold-body">
        <p class="muted help">Plusieurs numéros de lot en stock événement et vendus seulement en partie : impossible de savoir lequel est parti. Après la validation, tu indiques combien sont partis de chaque lot (ou tu acceptes la proposition « DLUO la plus courte d'abord ») et la déduction se fait.</p>
        <div class="table-wrap"><table><thead><tr><th class="col-name">Produit</th><th class="num">Vendu</th><th>Lots en stock événement</th><th></th></tr></thead>
        <tbody>${ambList.map(a => `<tr><td class="col-name"><b>${U.esc(a.name)}</b> <span class="muted">${U.esc(a.label || '')}</span></td><td class="num"><b>${U.qty(a.qty)}</b> / ${U.qty(a.total)}</td><td>${(a.lots || []).map(l => `<span class="tag">${U.esc(l.n)} · ${l.dluo ? U.frDate(l.dluo) : 'sans DLUO'} · ${U.qty(l.q)}</span>`).join(' ')}</td><td>${this.openLink(a.kind, a.pId)}</td></tr>`).join('')}</tbody></table></div>
      </div></details>` : ''}
      ${gp.length ? `<details class="fold" style="margin-top:12px;" open><summary><b>⚠️ ${gp.length} produit(s) sans produit reconnu</b> (${U.qty(probQty)} article(s)) — ${deduct ? 'à associer juste après' : 'enregistrés par leur nom'}</summary><div class="fold-body">
        <p class="muted help">Pas de SKU, SKU absent de ton stock, ou SKU porté par plusieurs produits. Après la validation, l'appli te propose les produits dont le nom ressemble : tu choisis le bon (ou tu cherches), et tu peux le retenir pour les prochains imports.</p>
        <div class="table-wrap"><table><thead><tr><th class="col-name">Produit (SumUp)</th><th>SKU</th><th class="num">Qté</th><th class="num">Montant</th><th>Motif</th></tr></thead>
        <tbody>${gp.map(l => `<tr><td class="col-name" style="text-align:left;">${U.esc(l.desc)}</td><td>${l.sku ? `<span class="tag">${U.esc(l.sku)}</span>` : '—'}</td><td class="num">${U.qty(l.qty)}</td><td class="num sensitive">${U.eur(l.ttc)}</td><td>${reasonTxt(l.status)}</td></tr>`).join('')}</tbody></table></div>
      </div></details>` : ''}
      ${this.cashSection()}
      ${this.retourConsoSection()}
      <label class="mt retour-deduct ${this.retourDeduct ? 'on' : 'off'}">
        <input type="checkbox" ${this.retourDeduct ? 'checked' : ''} onclick="Ventes.setRetourDeduct(this.checked)">
        <span title="${this.retourDeduct ? 'Coché : le stock événement sera déduit à la validation. Décoche pour un import historique (statistiques seulement).' : 'Décoché : import historique, statistiques seulement.'}"><b>${this.retourDeduct ? 'Déduire le stock événement' : 'Ne PAS déduire le stock (historique)'}</b> ${this.retourDeduct
          ? ''
          : '<br><span class="warn-txt" style="text-transform:none;">📚 DÉCOCHÉ = import historique : les ventes sont ajoutées aux statistiques (avec leur date d\'origine) mais le stock <b>n\'est PAS déduit</b>. À utiliser pour rentrer tes anciens marchés (2024, 2025…) sans toucher à ton stock actuel.</span>'}</span></label>
      <div class="frow mt" style="gap:8px;">
        <button class="btn-ok" onclick="Ventes.validateRetour()">${this.retourDeduct ? '✅ Valider et déduire le stock événement' : '📚 Valider en historique (sans déduire le stock)'}</button>
        <button class="btn-ghost" onclick="Ventes.resetRetour()">Choisir un autre fichier</button>
      </div>
    </div>`;
  },

  cashSection() {
    const d = this.retourData;
    const cashSel = this.units().find(u => u.key === this.cashSelKey);
    const q = (this.cashQ || '').toLowerCase();
    const suggestions = this.cashOpen ? this.units().filter(u => !q || (u.name + ' ' + u.label + ' ' + u.sku).toLowerCase().includes(q)).slice(0, 30) : [];
    const cashTotal = d.cashLines.reduce((a, l) => a + l.price * l.qty, 0);
    return `<div class="card" style="border-left:3px solid var(--nuit);margin-top:12px;">
      <h3 style="margin-top:0;">💵 Ventes en liquide (non SumUp)</h3>
      <p class="muted help">Ajoute ici les ventes de l'événement encaissées en espèces (absentes de l'export SumUp). Elles créent un ticket séparé « espèces » et déduisent aussi ton stock événement.</p>
      <div class="grid c2">
        <div class="fg autocomplete" data-onclose="Ventes.closeCashMenu"><label>Produit</label>
          <input id="cash_prod" type="text" autocomplete="off" placeholder="tape un nom ou un SKU…" value="${U.esc(this.cashQ)}"
            oninput="Ventes.setCashQ(this.value);U.refocus('cash_prod')">
          ${this.cashOpen && suggestions.length ? `<div class="ac-list" style="position:static;margin-top:4px;max-height:230px;overflow-y:auto;">${suggestions.map(u => `<div class="ac-item pp-row" onmousedown="event.preventDefault();Ventes.pickCashProduct('${u.key}')"><span class="pp-a">${U.esc(u.name)}${u.label ? ` <span class="pp-v">${U.esc(u.label)}</span>` : ''}</span><span class="pp-b">${U.esc(u.sku || '')}</span><span class="pp-c">${U.eur(u.price)}</span></div>`).join('')}</div>` : ''}
          ${this.cashOpen && !suggestions.length && this.cashQ ? `<div class="muted" style="padding:6px 2px;">Aucun produit ne correspond à « ${U.esc(this.cashQ)} ».</div>` : ''}
        </div>
        <div class="fg"><label>Date de l'événement</label><input type="date" value="${d.cashDate}" onchange="Ventes.setCashDate(this.value)"></div>
      </div>
      <div class="fg"><label>🎪 Événement (ventes espèces)</label>${this.eventSelect(this.retourData && this.retourData.cashEventName || '', 'Ventes.setCashEventName(v)')}</div>
      <div class="fg"><label>🏪 Frais de stand (€) <span class="muted help" style="text-transform:none;">— seulement si cette journée n'a PAS de ticket SumUp (sinon mets-le sur la journée ci-dessus)</span></label><input type="number" step="0.01" min="0" placeholder="0" style="max-width:160px;" value="${U.num(d.cashStandFee) || ''}" onchange="Ventes.setCashStandFee(this.value)"></div>
      <div class="fg"><label>🚗 Déplacement <span class="muted help" style="text-transform:none;">— idem, seulement sans ticket SumUp ce jour-là</span></label>${this.travelWidget((d.travelDet || {}).__cash, 'cash', d.cashTravel)}</div>
      ${cashSel ? `<div class="grid c2">
        <div class="fg"><label>Quantité</label><input id="cash_qty" type="number" step="0.001" min="0" value="${this.cashQty || 1}" onchange="Ventes.cashQty=U.num(this.value)"></div>
        <div class="fg"><label>Prix unitaire TTC</label><input id="cash_price" type="number" step="0.01" value="${this.cashPrice !== '' ? this.cashPrice : cashSel.price}" onchange="Ventes.cashPrice=U.num(this.value)"></div>
      </div>
      <button class="btn-cta btn-sm" onclick="Ventes.addCashLine()">＋ Ajouter cette vente espèces</button>` : ''}
      ${d.cashLines.length ? `<div class="table-wrap mt"><table><thead><tr><th class="col-name">Produit</th><th>SKU</th><th class="num">Qté</th><th class="num">Prix U.</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${d.cashLines.map((l, i) => `<tr><td class="col-name"><b>${U.esc(l.name)}</b> <span class="muted">${U.esc(l.label || '')}</span></td><td>${l.sku ? `<span class="tag">${U.esc(l.sku)}</span>` : '—'}</td><td class="num">${U.qty(l.qty)}</td><td class="num">${U.eur(l.price)}</td><td class="num"><b>${U.eur(l.price * l.qty)}</b></td><td><button class="btn-icon" onclick="Ventes.removeCashLine(${i})">🗑️</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="4">Total espèces</th><th class="num">${U.eur(cashTotal)}</th><th></th></tr></tfoot></table></div>` : ''}
    </div>`;
  },

  /* Consommables (sacs, étiquettes…) utilisés pendant l'événement : déduits du stock
     consommable et comptés en coût → marge plus précise dans les stats. */
  _setRetourConso(id) { this.retourConsoId = id; this.render(); },
  addRetourConso() {
    const c = Store.state.consumables.find(x => x.id === this.retourConsoId);
    const qty = U.num(this.retourConsoQty);
    if (!c) { U.toast('Choisis un consommable.', true); return; }
    if (qty <= 0) { U.toast('Quantité invalide.', true); return; }
    (this.retourData.consoLines = this.retourData.consoLines || []).push({ consumableId: c.id, name: c.name, qty, costUnit: U.num(c.costUnit) });
    this.retourConsoId = ''; this.retourConsoQty = 1; this.render();
  },
  removeRetourConso(i) { this.retourData.consoLines.splice(i, 1); this.render(); },
  retourConsoSection() {
    const d = this.retourData;
    const avail = Store.state.consumables.slice().sort((a, b) => U.sortFr(a.name, b.name));
    const cons = d.consoLines || [];
    const totalCost = cons.reduce((a, l) => a + l.costUnit * l.qty, 0);
    return `<div class="card" style="border-left:3px solid var(--caramel);margin-top:12px;">
      <h3 style="margin-top:0;">📦 Consommables utilisés (sacs, étiquettes…)</h3>
      <p class="muted help">Indique ce que tu as consommé pendant l'événement (ex : sacs donnés aux clients). ${this.retourDeduct ? 'Déduit du stock consommable' : 'Non déduit (mode historique)'} et compté en <b>coût</b> pour une marge plus précise dans les stats.</p>
      ${avail.length ? `<div class="grid c2">
        <div class="fg"><label>Consommable</label>${U.customSelect({ value: this.retourConsoId, options: [{ v: '', l: '— choisir —' }].concat(avail.map(c => ({ v: c.id, l: c.name + ' — dispo ' + U.qty(c.qty) + (U.num(c.costUnit) ? ' · ' + U.eur(c.costUnit) + '/u' : '') }))), onPick: 'Ventes._setRetourConso' })}</div>
        <div class="fg"><label>Quantité utilisée</label><input id="retour_conso_qty" type="number" step="1" min="1" value="${this.retourConsoQty || 1}" onchange="Ventes.retourConsoQty=U.num(this.value)"></div>
      </div>
      <button class="btn-cta btn-sm" onclick="Ventes.addRetourConso()">＋ Ajouter</button>` : '<p class="muted">Aucun consommable en stock. Ajoute-les dans Stock → Consommables.</p>'}
      ${cons.length ? `<div class="table-wrap mt"><table><thead><tr><th class="col-name">Consommable</th><th class="num">Qté</th><th class="num">Coût unit.</th><th class="num">Coût total</th><th></th></tr></thead>
        <tbody>${cons.map((l, i) => `<tr><td class="col-name"><b>${U.esc(l.name)}</b></td><td class="num">${U.qty(l.qty)}</td><td class="num">${U.eur(l.costUnit)}</td><td class="num"><b>${U.eur(l.costUnit * l.qty)}</b></td><td><button class="btn-icon" onclick="Ventes.removeRetourConso(${i})">🗑️</button></td></tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="3">Coût total consommables</th><th class="num">${U.eur(totalCost)}</th><th></th></tr></tfoot></table></div>` : ''}
    </div>`;
  },

  /* ── Édition d'un ticket d'événement DÉJÀ validé ──
     Antho ne peut pas toujours compter les sacs / connaître les frais de stand le jour du
     marché. Depuis l'historique, il clique « 🎪 Modifier » sur un ticket d'événement et
     retombe sur un panneau (comme le retour d'événement) où il saisit à la main les frais
     de stand et les consommables utilisés. Les consommables ajoutés sont des lignes kind:'C'
     du ticket : déduites du stock (sauf ticket historique) et comptées en coût dans la marge
     du mois de l'événement. Le retrait re-crédite le stock ; annuler le ticket entier re-crédite
     tout (via undoOps). */
  editEventTicket(id) { this.editTicketId = id; this.ticketConsoId = ''; this.ticketConsoQty = 1; this.render(); },
  closeEditTicket() { this.editTicketId = ''; this.render(); },
  _setTicketConso(id) { this.ticketConsoId = id; this.render(); },
  addTicketConso() {
    const s = Store.state.sales.find(x => x.id === this.editTicketId); if (!s) return;
    const c = Store.state.consumables.find(x => x.id === this.ticketConsoId);
    const qty = U.num(this.ticketConsoQty);
    if (!c) { U.toast('Choisis un consommable.', true); return; }
    if (qty <= 0) { U.toast('Quantité invalide.', true); return; }
    const cost = U.num(c.costUnit) * qty;
    let take = 0;
    if (!s.historical) {
      take = Math.min(U.num(c.qty), qty);
      if (take > 0) { c.qty = U.num(c.qty) - take; (s.undoOps = s.undoOps || []).push({ kind: 'C', pId: c.id, qty: take }); }
    }
    (s.items = s.items || []).push({ kind: 'C', pId: c.id, vId: '', name: c.name, label: '', sku: '', lotLabel: '', qty, price: 0, cost, _take: take });
    Store.log('vente', `Consommable ajouté au ticket ${U.frDateTime(s.ts)} : ${c.name} ×${U.qty(qty)} · coût ${U.eur(cost)}`);
    this.ticketConsoId = ''; this.ticketConsoQty = 1;
    Store.save(...(s.historical ? ['sales'] : ['sales', 'consumables']));
    this.render();
    U.toast(`📦 ${c.name} ×${U.qty(qty)} ajouté · coût ${U.eur(cost)}${s.historical ? ' (stock non déduit)' : ''}.`);
  },
  removeTicketConso(idx) {
    const s = Store.state.sales.find(x => x.id === this.editTicketId); if (!s) return;
    const it = (s.items || [])[idx];
    if (!it || it.kind !== 'C') return;
    if (!s.historical && U.num(it._take) > 0) {
      const co = Store.state.consumables.find(x => x.id === it.pId);
      if (co) co.qty = U.num(co.qty) + U.num(it._take);
      const oi = (s.undoOps || []).findIndex(o => o.kind === 'C' && o.pId === it.pId && U.num(o.qty) === U.num(it._take));
      if (oi >= 0) s.undoOps.splice(oi, 1);
    }
    s.items.splice(idx, 1);
    Store.log('vente', `Consommable retiré du ticket ${U.frDateTime(s.ts)} : ${it.name}`);
    Store.save('sales', 'consumables');
    this.render();
    U.toast('Consommable retiré du ticket.');
  },
  renderTicketEditor() {
    const s = Store.state.sales.find(x => x.id === this.editTicketId);
    if (!s) { this.editTicketId = ''; this.render(); return; }
    const consoItems = (s.items || []).map((it, i) => ({ it, i })).filter(x => x.it.kind === 'C');
    const soldItems = (s.items || []).filter(it => it.kind !== 'C');
    const avail = Store.state.consumables.slice().sort((a, b) => U.sortFr(a.name, b.name));
    const consoCost = consoItems.reduce((a, x) => a + U.num(x.it.cost), 0);
    App.mount(`
      <div class="view-title" style="justify-content:space-between;align-items:flex-start;gap:12px;">
        <div><h1>Modifier l'événement</h1><span class="sub">${U.frDateTime(s.ts)} · frais de stand & consommables</span></div>
        <button class="btn-ghost" style="flex:0 0 auto;white-space:nowrap;" onclick="Ventes.closeEditTicket()">← Retour à l'historique</button>
      </div>
      ${s.source !== 'event' ? '<div class="card"><p class="muted">Ce ticket n\'est pas un événement — rien à modifier ici.</p></div>' : `
      <div class="card">
        <h2>🎪 Événement & frais de stand</h2>
        ${this.eventNamesDatalist()}
        <div class="frow" style="gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
          <label style="margin:0;text-transform:none;">Nom de l'événement</label>
          ${this.eventSelect(s.eventName || '', `Ventes.setEventName('${s.id}',v)`, 'width:280px;')}
          <span class="muted" style="font-size:.82rem;">sert aux statistiques par événement (Statistiques → 🎪 Événements)</span>
        </div>
        <div class="frow" style="gap:10px;align-items:center;flex-wrap:wrap;">
          <label style="margin:0;text-transform:none;">Frais de stand (€)</label>
          <input type="number" step="0.01" min="0" style="width:130px;" value="${U.num(s.eventFee) || ''}" placeholder="0" onchange="Ventes.setEventFee('${s.id}',this.value)">
          <span class="muted" style="font-size:.82rem;">coût de l'emplacement (métrage…) — imputé au bénéfice de cet événement</span>
        </div>
        <div class="frow" style="gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px;">
          <label style="margin:0;text-transform:none;">🚗 Déplacement</label>
          ${this.travelWidget(s.travelDet, 's:' + s.id, s.travelCost)}
        </div>
      </div>

      <div class="card" style="border-left:3px solid var(--caramel);">
        <h2>📦 Consommables utilisés (sacs, étiquettes…)</h2>
        <p class="muted help">${s.historical ? 'Événement <b>historique</b> → coût compté sans toucher au stock actuel.' : 'Déduit du stock consommable'} et compté en <b>coût</b> dans la marge du mois de cet événement.</p>
        ${avail.length ? `<div class="grid c2">
          <div class="fg"><label>Consommable</label>${U.customSelect({ value: this.ticketConsoId, options: [{ v: '', l: '— choisir —' }].concat(avail.map(c => ({ v: c.id, l: c.name + ' — dispo ' + U.qty(c.qty) + (U.num(c.costUnit) ? ' · ' + U.eur(c.costUnit) + '/u' : '') }))), onPick: 'Ventes._setTicketConso' })}</div>
          <div class="fg"><label>Quantité utilisée</label><input id="ticket_conso_qty" type="number" step="1" min="1" value="${this.ticketConsoQty || 1}" onchange="Ventes.ticketConsoQty=U.num(this.value)"></div>
        </div>
        <button class="btn-cta btn-sm" onclick="Ventes.addTicketConso()">＋ Ajouter</button>` : '<p class="muted">Aucun consommable en stock. Ajoute-les dans Stock → Consommables.</p>'}
        ${consoItems.length ? `<div class="table-wrap mt"><table><thead><tr><th class="col-name">Consommable</th><th class="num">Qté</th><th class="num">Coût</th><th></th></tr></thead>
          <tbody>${consoItems.map(x => `<tr><td class="col-name"><b>${U.esc(x.it.name)}</b></td><td class="num">${U.qty(x.it.qty)}</td><td class="num">${U.eur(x.it.cost)}</td><td><button class="btn-icon" title="Retirer" onclick="Ventes.removeTicketConso(${x.i})">🗑️</button></td></tr>`).join('')}</tbody>
          <tfoot><tr><th colspan="2">Coût total consommables</th><th class="num">${U.eur(consoCost)}</th><th></th></tr></tfoot></table></div>` : ''}
      </div>

      <div class="card">
        <h2 class="mb0">🧾 Articles vendus</h2>
        <div class="table-wrap mt"><table><thead><tr><th class="col-name">Produit</th><th>Variante</th><th>SKU</th><th class="num">Qté</th><th class="num">Prix U.</th><th class="num">Total</th></tr></thead>
        <tbody>${soldItems.length ? soldItems.map(it => `<tr><td class="col-name"><b>${U.esc(it.name)}</b></td><td>${it.label ? U.esc(it.label) : '—'}</td><td>${it.sku ? `<span class="tag">${U.esc(it.sku)}</span>` : '—'}</td><td class="num">${U.qty(it.qty)}</td><td class="num">${U.eur(it.price)}</td><td class="num"><b>${U.eur(U.num(it.price) * U.num(it.qty))}</b></td></tr>`).join('') : '<tr><td colspan="6" class="muted">Aucun article vendu sur ce ticket.</td></tr>'}</tbody></table></div>
      </div>
      `}`);
  },

  retourDayCard(g, imported) {
    const newLines = g.lines.filter(l => !imported.has(l.ref));
    const okLines = newLines.filter(l => l.target);
    const okTotal = okLines.reduce((a, l) => a + l.ttc, 0);
    const dayTotal = newLines.reduce((a, l) => a + l.ttc, 0);
    const nTx = new Set(g.lines.map(l => l.ref)).size;
    const nProd = this._groupOk(okLines).length;
    const allDup = newLines.length === 0;
    return `<div class="card" style="border-left:3px solid var(--caramel);padding:9px 13px;margin-bottom:8px;${allDup ? 'opacity:.55;' : ''}">
      <label style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;text-transform:none;cursor:pointer;margin:0;">
        <span style="display:flex;gap:10px;align-items:center;">
          <input type="checkbox" ${g.include && !allDup ? 'checked' : ''} ${allDup ? 'disabled' : ''} onclick="Ventes.toggleRetourDay('${g.key}')">
          <b>${U.esc(g.label)}</b>
          <span class="muted">${nTx} transaction(s) · ${nProd} produit(s) · ${okLines.reduce((a, l) => a + l.qty, 0)} article(s) reconnu(s)${allDup ? ' · déjà importé' : ''}</span>
        </span>
        <span class="sensitive"><b>${U.eur(okTotal)}</b>${okTotal.toFixed(2) !== dayTotal.toFixed(2) ? ` <span class="muted">/ ${U.eur(dayTotal)} total</span>` : ''}</span>
      </label>
      ${allDup ? '' : `<div class="frow" style="margin-top:7px;gap:8px;align-items:center;">
        <label style="margin:0;text-transform:none;font-size:.85rem;">🎪 Événement</label>
        ${this.eventSelect((this.retourData.eventNames || {})[g.key] || '', `Ventes.setDayEventName('${g.key}',v)`, 'width:240px;')}
        <label style="margin:0;text-transform:none;font-size:.85rem;">🏪 Frais de stand (€)</label>
        <input type="number" step="0.01" min="0" placeholder="0" style="width:110px;" value="${U.num((this.retourData.standFees || {})[g.key]) || ''}" onchange="Ventes.setStandFee('${g.key}',this.value)">
        <label style="margin:0;text-transform:none;font-size:.85rem;">🚗 Déplacement</label>
        ${this.travelWidget((this.retourData.travelDet || {})[g.key], 'd:' + g.key, (this.retourData.travel || {})[g.key])}
      </div>`}
    </div>`;
  },

  validateRetour() {
    const d = this.retourData; if (!d) return;
    const imported = this._retourImportedRefs();
    const groups = d.days.filter(g => g.include && g.lines.some(l => !imported.has(l.ref)));
    if (!groups.length && !d.cashLines.length && !(d.consoLines || []).length) { U.toast('Rien à valider : coche au moins une journée, ou ajoute une vente espèces / des consommables.', true); return; }
    const buckets = this._retourBuckets(d, imported);
    const seen = new Set(imported);
    const deduct = this.retourDeduct;   // décoché = import HISTORIQUE (stats sans toucher au stock)
    let created = 0, deducted = 0;
    const createdSales = [];
    // Tickets SumUp (un par journée retenue), produits identiques regroupés.
    buckets.forEach(b => {
      if (!deduct) {
        // ── Mode HISTORIQUE : on enregistre TOUTES les lignes vendues (même sans SKU),
        //    groupées par produit, avec leur date d'origine, SANS déduire le stock. ──
        const raw = b.lines.filter(l => !seen.has(l.ref));
        if (!raw.length) return;
        const refs = [...new Set(raw.map(l => l.ref))];
        const grouped = this._groupAllForHistory(raw);
        if (!grouped.length) return;
        const items = grouped.map(g => ({ kind: g.kind, pId: g.pId, vId: g.vId, name: g.name, variant: g.label, sku: g.sku, qty: g.qty, price: g.unit }));
        const total = items.reduce((a, i) => a + i.price * i.qty, 0);
        const eventFee = (b.keys || []).reduce((a, k) => a + U.num((d.standFees || {})[k]), 0);
        const eventName = (b.keys || []).map(k => (d.eventNames || {})[k]).find(Boolean) || '';
        const travelCost = (b.keys || []).reduce((a, k) => a + U.num((d.travel || {})[k]), 0);
        const sale = { id: U.uid(), ts: b.ts || Date.now(), source: 'event', channel: 'direct', payment: 'sumup', delivery: 'clickcollect', customerName: '', eventFee, eventName, travelCost, travelDet: ((b.keys || []).length === 1 && (d.travelDet || {})[b.keys[0]]) || undefined, items, total, cancelled: false, undoOps: [], sumupRefs: refs, fromImport: true, historical: true };
        Store.state.sales.unshift(sale);
        Store.log('vente', `Import historique ${b.label} — ${U.eur(total)} (${items.length} produit(s), stock non déduit)`, { type: 'sale', data: { saleId: sale.id } });
        created++; deducted += items.reduce((a, i) => a + i.qty, 0); refs.forEach(r => seen.add(r));
        return;
      }
      // Tous les articles de la journée vont dans le ticket (CA juste). Seuls les « sûrs » sont déduits
      // maintenant ; les autres restent « à traiter » (todo:'open') dans « 🧩 Articles à traiter ».
      const raw = b.lines.filter(l => !seen.has(l.ref));
      if (!raw.length) return;
      const refs = [...new Set(raw.map(l => l.ref))];
      const { safe, ambiguous } = this._retourSplit(raw.filter(l => l.target));
      const probs = this._groupProblems(raw.filter(l => !l.target));
      const eventFee = (b.keys || []).reduce((a, k) => a + U.num((d.standFees || {})[k]), 0);
      const eventName = (b.keys || []).map(k => (d.eventNames || {})[k]).find(Boolean) || '';
      const travelCost = (b.keys || []).reduce((a, k) => a + U.num((d.travel || {})[k]), 0);
      const sale = { id: U.uid(), ts: b.ts || Date.now(), source: 'event', channel: 'direct', payment: 'sumup', delivery: 'clickcollect', customerName: '', eventFee, eventName, travelCost, travelDet: ((b.keys || []).length === 1 && (d.travelDet || {})[b.keys[0]]) || undefined, items: [], total: 0, cancelled: false, undoOps: [], sumupRefs: refs, fromImport: true };
      if (safe.length) this._deductSale(sale, safe.map(g => ({ kind: g.kind, pId: g.pId, vId: g.vId, name: g.name, label: g.label, sku: g.sku, lotLabel: '', price: g.unit, qty: g.qty, pack: g.pack, packs: g.packs })), 'event');
      this._markImported(sale.items);
      ambiguous.forEach(g => { sale.items.push({ kind: g.kind, pId: g.pId, vId: g.vId, name: g.name, label: g.label, sku: g.sku, lotLabel: '', qty: g.qty, price: g.unit, deducted: false, todo: 'open', reason: 'multiLot', ...(U.num(g.pack) >= 2 ? { pack: g.pack, packs: g.packs } : {}) }); sale.total += g.unit * g.qty; });
      probs.forEach(g => { sale.items.push({ kind: 'M', pId: '', vId: '', name: g.desc || 'Sans nom', label: '', sku: g.sku || '', sumupSku: g.sku || '', desc: g.desc || 'Sans nom', qty: g.qty, price: g.unit, deducted: false, todo: 'open', reason: g.status }); sale.total += g.unit * g.qty; });
      Store.state.sales.unshift(sale);
      const nDed = sale.items.filter(i => i.deducted).reduce((a, i) => a + U.num(i.qty) - U.num(i.missing), 0);
      Store.log('vente', `Retour événement ${b.label} — ${U.eur(sale.total)} (${sale.items.length} produit(s), ${nDed} article(s) déduits)`, { type: 'sale', data: { saleId: sale.id } });
      created++; deducted += nDed; createdSales.push(sale);
      refs.forEach(r => seen.add(r));
    });
    // Ticket espèces séparé (payment 'cash', pas de frais SumUp), daté à la journée choisie.
    if (d.cashLines.length) {
      const cashTs = d.cashDate ? new Date(d.cashDate + 'T12:00:00').getTime() : Date.now();
      if (!deduct) {
        const items = d.cashLines.map(l => ({ kind: l.kind || 'M', pId: l.pId || '', vId: l.vId || '', name: l.name, variant: l.label || '', sku: l.sku || '', qty: l.qty, price: l.price }));
        const total = items.reduce((a, i) => a + i.price * i.qty, 0);
        const sale = { id: U.uid(), ts: cashTs, source: 'event', channel: 'direct', payment: 'cash', delivery: 'clickcollect', customerName: '', eventFee: U.num(d.cashStandFee), eventName: d.cashEventName || '', travelCost: U.num(d.cashTravel), travelDet: (d.travelDet || {}).__cash, items, total, cancelled: false, undoOps: [], fromImport: true, historical: true };
        Store.state.sales.unshift(sale);
        Store.log('vente', `Import historique (espèces) — ${U.eur(total)} (stock non déduit)`, { type: 'sale', data: { saleId: sale.id } });
        created++; deducted += d.cashLines.reduce((a, l) => a + l.qty, 0);
      } else {
        const sale = { id: U.uid(), ts: cashTs, source: 'event', channel: 'direct', payment: 'cash', delivery: 'clickcollect', customerName: '', eventFee: U.num(d.cashStandFee), eventName: d.cashEventName || '', travelCost: U.num(d.cashTravel), travelDet: (d.travelDet || {}).__cash, items: [], total: 0, cancelled: false, undoOps: [], fromImport: true };
        this._deductSale(sale, d.cashLines.map(l => ({ ...l, lotLabel: '' })), 'event');
        this._markImported(sale.items);
        Store.state.sales.unshift(sale);
        Store.log('vente', `Retour événement (espèces) — ${U.eur(sale.total)}`, { type: 'sale', data: { saleId: sale.id } });
        created++; deducted += sale.items.reduce((a, i) => a + U.num(i.qty) - U.num(i.missing), 0); createdSales.push(sale);
      }
    }
    // Consommables utilisés pendant l'événement (sacs…) : un ticket dédié, coût compté dans les stats.
    let consoCost = 0;
    if ((d.consoLines || []).length) {
      const consoTs = buckets.length ? (Math.max(...buckets.map(b => b.ts || 0)) || Date.now())
        : (d.cashDate ? new Date(d.cashDate + 'T12:00:00').getTime() : Date.now());
      if (!deduct) {
        const items = d.consoLines.map(l => ({ kind: 'C', pId: l.consumableId, vId: '', name: l.name, variant: '', sku: '', qty: l.qty, price: 0, cost: U.num(l.costUnit) * U.num(l.qty) }));
        consoCost = items.reduce((a, i) => a + i.cost, 0);
        const sale = { id: U.uid(), ts: consoTs, source: 'event', channel: 'direct', payment: 'sumup', delivery: 'clickcollect', customerName: '', items, total: 0, cancelled: false, undoOps: [], fromImport: true, historical: true };
        Store.state.sales.unshift(sale);
        Store.log('vente', `Import historique — consommables événement (${items.length}, coût ${U.eur(consoCost)}, stock non déduit)`, { type: 'sale', data: { saleId: sale.id } });
        created++;
      } else {
        const sale = { id: U.uid(), ts: consoTs, source: 'event', channel: 'direct', payment: 'sumup', delivery: 'clickcollect', customerName: '', items: [], total: 0, cancelled: false, undoOps: [], fromImport: true };
        this._deductSale(sale, d.consoLines.map(l => ({ kind: 'C', pId: l.consumableId, vId: '', name: l.name, label: '', sku: '', lotLabel: '', price: 0, qty: l.qty })), 'event');
        this._markImported(sale.items); createdSales.push(sale);
        consoCost = (sale.items || []).reduce((a, i) => a + U.num(i.cost), 0);
        Store.state.sales.unshift(sale);
        Store.log('vente', `Retour événement — consommables utilisés (${sale.items.length}, coût ${U.eur(consoCost)})`, { type: 'sale', data: { saleId: sale.id } });
        created++;
      }
    }
    if (!created) { U.toast('Rien à valider (déjà importé ?).', true); return; }
    if (created) { if (deduct) Store.save('sales', 'stockM', 'catalogA', 'consumables'); else Store.save('sales'); }
    this.retourData = null;
    this.retourDeduct = true;   // retour au défaut sûr (déduction) après chaque import
    this.retourConsoId = ''; this.retourConsoQty = 1;
    const pending = createdSales.reduce((a, s) => a + s.items.filter(i => i.todo === 'open').length, 0);
    const consoTxt = consoCost > 0 ? ` · consommables ${U.eur(consoCost)}` : '';
    if (!deduct) {
      this.retourOpen = false; history.replaceState(null, '', '#/ventes'); this.render();
      U.toast(`📚 ${created} ticket(s) historique(s) créé(s) · ${deducted} article(s) ajoutés aux stats (stock NON touché)${consoTxt}.`);
      return;
    }
    if (pending) {
      // 2e partie : on enchaîne directement sur les articles restant à traiter.
      this._todoBanner = { deducted, pending };
      this.retourOpen = false; this.todoOpen = true; this.todoFilter = 'all';
      history.replaceState(null, '', '#/ventes/traiter'); this.render(); window.scrollTo(0, 0);
    } else {
      this.retourOpen = false; history.replaceState(null, '', '#/ventes'); this.render();
    }
    U.toast(`${created} ticket(s) créé(s) · ${deducted} article(s) déduits du stock événement${consoTxt}${pending ? ` · ${pending} à traiter` : ''}.`);
  },
  /* Lignes déduites à l'import : marquées déduites ; s'il manquait du stock, elles restent à vérifier. */
  _markImported(items) {
    (items || []).forEach(i => { i.deducted = true; if (U.num(i.missing) > 0) { i.todo = 'open'; i.reason = 'short'; } });
  },

  /* ══════════ 🧩 ARTICLES À TRAITER (2e partie du retour d'événement) ══════════
     Tout ce qui n'a pas été déduit automatiquement : article sans produit reconnu (à associer,
     avec des propositions par ressemblance de nom — c'est Antho qui choisit), produit à plusieurs
     lots (il choisit la quantité par lot), stock manquant (à vérifier). Rien n'est déduit sans clic. */
  todoCount() { let n = 0; Store.state.sales.forEach(s => { if (!s.cancelled) (s.items || []).forEach(i => { if (i.todo === 'open') n++; }); }); return n; },
  openTodo() { this.todoFilter = 'all'; location.hash = '/ventes/traiter'; },
  closeTodo() { this._todoBanner = null; location.hash = '/ventes'; },
  setTodoFilter(f) { this.todoFilter = f; this.render(); },
  setTodoShowDone(b) { this.todoShowDone = b; this.render(); },
  _ttState(k) { return this._tt[k] || (this._tt[k] = { q: '', lots: null, remember: true, src: 'event' }); },
  _ttFind(k) { const [sid, idx] = k.split(':'); const s = Store.state.sales.find(x => x.id === sid); const i = s && s.items[+idx]; return i ? { s, i } : null; },
  /* Catégorie d'un article à traiter : link (produit à associer), short (stock manquant),
     multi (plusieurs lots en stock événement et vente partielle → répartition à choisir, JAMAIS en groupe),
     ready (sans ambiguïté, prêt à déduire). Calculé sur le stock actuel. */
  /* « LOT 5 », « LOT2 », « lot de 3 » dans un libellé → 5 / 2 / 3 ; sinon 1. */
  _packFromDesc(desc) { const m = String(desc || '').match(/\blot\s*(?:de\s*)?(\d+)/i); const n = m ? +m[1] : 1; return n >= 2 ? n : 1; },
  _todoCat(i) {
    if (!i.pId) return 'link';
    if (i.reason === 'short') return 'short';
    if (i.kind === 'M') {
      const p = Store.state.stockM.find(x => x.id === i.pId); const v = p && (p.variants || []).find(x => x.id === i.vId);
      if (v) { const lots = v.lots.filter(l => U.num(l.qtyEvent) > 0); const tot = lots.reduce((a, l) => a + U.num(l.qtyEvent), 0); if (lots.length > 1 && i.qty < tot) return 'multi'; if (tot < i.qty) return 'gen'; }
    }
    return 'ready';
  },
  _tok(s) {
    const STOP = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'd', 'l', 'avec', 'et', 'a', 'au', 'aux', 'en', 'un', 'une', 'pcs', 'pc', 'piece', 'pieces']);
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/(\d)[\s,.]*(kg|g|cm|mm)\b/g, '$1$2').replace(/\blot\s*(\d+)/g, 'lot$1')
      .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(t => t && !STOP.has(t))
      .map(t => t.length > 3 && !/\d/.test(t) ? t.replace(/(s|x)$/, '') : t);
  },
  /* Produits dont le nom (+ variante) ressemble au libellé SumUp — simple PROPOSITION, jamais appliquée seule. */
  _suggest(desc, n, units) {
    const dt = [...new Set(this._tok(desc))]; if (!dt.length) return [];
    const near = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
    return units.map(u => {
      const ct = u._tok || (u._tok = [...new Set(this._tok(u.name + ' ' + u.label))]);
      if (!ct.length) return null;
      const hit = dt.filter(t => ct.some(c => near(t, c))).length;
      return { u, sc: 2 * hit / (dt.length + ct.length) };
    }).filter(x => x && x.sc >= 0.4).sort((a, b) => b.sc - a.sc || b.u.availE - a.u.availE).slice(0, n).map(x => x.u);
  },
  _fefo(lots, field, qty) {
    const out = {}; let rest = qty;
    lots.forEach(l => { if (rest <= 0) return; const t = Math.min(U.num(l[field]), rest); if (t > 0) { out[l.id] = t; rest -= t; } });
    return out;
  },

  /* Boutons d'actions groupées (toute la page si saleId vide, sinon un ticket). */
  _todoBulkBar(saleId) {
    const n = this._todoKeys(saleId).length, r = this._todoReady(saleId).length;
    const a = saleId ? `'${saleId}'` : "''";
    return `<div class="todo-bulk${saleId ? ' small' : ''}"><span class="muted">${saleId ? 'Ce ticket' : 'Articles affichés'} (${n}) :</span>
      <button class="btn-ok btn-sm" ${r ? '' : 'disabled'} title="Déduit tous les articles prêts : produit associé et « Total choisi = vendu »" onclick="Ventes.ttBulkDeduct(${a})">✅ Tout déduire (${r} prêt${r > 1 ? 's' : ''})</button>
      <button class="btn-ghost btn-sm" onclick="Ventes.ttBulkMark('done',${a})">✔ Tout déjà fait à la main</button>
      <button class="btn-ghost btn-sm" onclick="Ventes.ttBulkMark('caOnly',${a})">💶 Tout en CA seulement</button></div>`;
  },
  renderTodo() {
    const units = this.units();
    const counts = { all: 0, link: 0, ready: 0, multi: 0, gen: 0, short: 0 };
    let doneN = 0;
    const groups = [];
    Store.state.sales.forEach(s => {
      if (s.cancelled) return;
      const rows = [];
      (s.items || []).forEach((i, idx) => {
        if (!i.todo) return;
        const open = i.todo === 'open';
        if (open) { counts.all++; counts[this._todoCat(i)]++; } else doneN++;
        if (!open && !this.todoShowDone) return;
        if (this.todoFilter !== 'all' && (!open || this._todoCat(i) !== this.todoFilter)) return;
        rows.push(this.todoItem(s, idx, i, units));
      });
      if (rows.length) groups.push({ s, rows });
    });
    groups.sort((a, b) => b.s.ts - a.s.ts);
    const fb = (f, label) => `<button class="${this.todoFilter === f ? 'btn-cta' : 'btn-ghost'} btn-sm" onclick="Ventes.setTodoFilter('${f}')">${label} (${counts[f]})</button>`;
    const bn = this._todoBanner;
    const map = Store.state.settings.sumupMap || {};
    const mapRows = Object.entries(map).map(([k, m]) => { const t = this._targetFor(m.kind, m.pId, m.vId); return `<tr><td class="col-name" style="text-align:left;">${U.esc(k)}</td><td>${t ? `<b>${U.esc(t.name)}</b> <span class="muted">${U.esc(t.label || '')}</span>${U.num(m.n) >= 2 ? ` <span class="badge info">× ${m.n} pièces</span>` : ''} ${this.openLink(t.kind, t.pId)}` : '<span class="badge bad">produit supprimé</span>'}</td><td><button class="btn-ghost btn-sm" title="Oublier cette association" onclick="Ventes.ttForget(${U.esc(JSON.stringify(k))})">🗑</button></td></tr>`; }).join('');
    App.mount(`
      <div class="view-title" style="justify-content:space-between;align-items:flex-start;gap:12px;"><div><h1>🧩 Articles à traiter</h1><span class="sub">retours d'événement · ce qui n'a pas été déduit automatiquement</span></div>
        <button class="btn-ghost" style="white-space:nowrap;" onclick="Ventes.closeTodo()">← Retour aux ventes</button></div>
      ${bn ? `<div class="card todo-banner">✅ Import validé : <b>${U.qty(bn.deducted)}</b> article(s) déduits du stock événement. Il reste <b>${bn.pending}</b> ligne(s) à traiter ci-dessous — rien n'est déduit tant que tu ne cliques pas « Déduire ».</div>` : ''}
      <div class="card">
        <div class="sumup-filters">${fb('all', 'Tout')}${fb('link', '🏷️ Produit à associer')}${fb('ready', '✅ Prêts à déduire')}${fb('multi', '🔀 Plusieurs lots (à répartir)')}${fb('gen', '🏬 Stock événement insuffisant')}${fb('short', '📉 Stock manquant')}</div>
        ${counts[this.todoFilter] ? this._todoBulkBar('') : ''}
        <label style="display:flex;gap:8px;align-items:center;text-transform:none;cursor:pointer;margin:10px 0 0;"><input type="checkbox" ${this.todoShowDone ? 'checked' : ''} onchange="Ventes.setTodoShowDone(this.checked)"> Afficher aussi les articles déjà traités (${doneN})</label>
        <p class="muted help">Associer : clique une proposition 💡 (nom ressemblant) ou cherche le produit. « Retenir » applique l'association aux autres lignes identiques et aux prochains imports. Lots : indique combien sont partis de chaque lot, ou « Proposer » (DLUO la plus courte d'abord), puis « Déduire ». ↗ ouvre la fiche dans un nouvel onglet. Chaque déduction est annulable (↺ dans le message ou le Journal).</p>
      </div>
      ${groups.map(g => `<div class="card todo-ticket"><div class="todo-ticket-top"><h3 class="todo-ticket-h">📅 ${U.frDateTime(g.s.ts)} ${g.s.eventName ? `<span class="sh-event">🎪 ${U.esc(g.s.eventName)}</span>` : ''} <span class="muted">· ${g.s.payment === 'cash' ? 'espèces' : 'SumUp'}</span></h3>${this._todoKeys(g.s.id).length ? this._todoBulkBar(g.s.id) : ''}</div>${g.rows.join('')}</div>`).join('')
        || `<div class="card empty"><span class="big">🎉</span>${counts.all ? 'Rien pour ce filtre.' : 'Plus rien à traiter.'}</div>`}
      <details class="fold card params-fold" ${this._memOpen ? 'open' : ''} ontoggle="Ventes._memOpen=this.open"><summary><h2>🧠 Associations retenues (${Object.keys(map).length})</h2></summary><div class="fold-body">
        <p class="muted help">Libellés SumUp que tu as associés toi-même à un produit : aux prochains imports, ils sont reliés directement (badge 🧠 dans la revue). Supprime une association si elle est fausse.</p>
        ${mapRows ? `<div class="table-wrap"><table><thead><tr><th class="col-name" style="text-align:left;">Libellé SumUp</th><th>Produit</th><th></th></tr></thead><tbody>${mapRows}</tbody></table></div>` : '<p class="muted">Aucune association retenue pour l\'instant.</p>'}
      </div></details>`);
  },

  todoItem(s, idx, i, units) {
    const k = s.id + ':' + idx, sid = (s.id + '_' + idx).replace(/[^\w-]/g, '_');
    const st = this._ttState(k);
    const reasons = { multiLot: ['🔀 Plusieurs lots', 'warn'], short: ['📉 Stock manquant', 'bad'], dupSku: ['⚠️ SKU en double', 'bad'], unknownSku: ['❓ SKU inconnu', 'warn'], noSku: ['🏷️ Sans SKU', 'warn'] };
    const [rTxt, rCls] = reasons[i.reason] || ['À traiter', 'warn'];
    const head = `<div class="tt-head"><span class="badge ${rCls}">${rTxt}</span>${i.reason !== 'multiLot' && i.todo === 'open' && this._todoCat(i) === 'multi' ? ' <span class="badge bad">🔀 Plusieurs lots</span>' : ''}
      <span class="tt-desc"><b>${U.esc(i.desc || i.name)}</b>${!i.desc && i.label ? ` <span class="pp-v">${U.esc(i.label)}</span>` : ''}${i.sumupSku ? ` <span class="tag" title="SKU dans SumUp">${U.esc(i.sumupSku)}</span>` : ''}</span>
      <span class="tt-qty">× <b>${U.qty(i.qty)}</b>${U.num(i.pack) >= 2 ? ` <span class="muted">(${U.qty(i.packs)} lot${i.packs > 1 ? 's' : ''} de ${i.pack})</span>` : ''} · <span class="sensitive">${U.eur(i.price * i.qty)}</span></span></div>`;
    const linked = t => `<div class="tt-linked"><span class="muted">${i.desc ? 'Associé à' : 'Produit'} :</span> <b>${U.esc(t.name)}</b>${t.label ? ` <span class="pp-v">${U.esc(t.label)}</span>` : ''}${t.sku ? ` <span class="tag">${U.esc(t.sku)}</span>` : ''} ${this.openLink(t.kind, t.pId)}${i.desc && !i.deducted && i.todo === 'open' ? ` <button class="btn-ghost btn-sm" onclick="Ventes.ttUnlink('${k}')">✕ Changer</button>` : ''}</div>`;
    const markBtns = `<button class="btn-ghost btn-sm" title="Tu as déjà corrigé le stock toi-même" onclick="Ventes.ttMark('${k}','done')">✔ Déjà fait à la main</button>`;
    let body;
    if (i.todo !== 'open') {
      const t = i.pId ? this._targetFor(i.kind, i.pId, i.vId) : null;
      const txt = i.deducted ? `✅ Déduit${i.lotLabel ? ' — ' + U.esc(i.lotLabel) : ''}${U.num(i.missing) ? ` · ${U.qty(i.missing)} non déduit(s)` : ''}` : i.todo === 'caOnly' ? '💶 Compté dans le CA seulement (stock non touché)' : '✔ Marqué fait à la main';
      body = `<div class="tt-body tt-done"><span>${txt}</span>${t ? ' · ' + linked(t) : ''} ${!i.deducted || i.reason === 'short' ? `<button class="btn-ghost btn-sm" onclick="Ventes.ttMark('${k}','open')">↩ Rouvrir</button>` : ''}</div>`;
    } else if (i.reason === 'short') {
      const t = this._targetFor(i.kind, i.pId, i.vId);
      body = `<div class="tt-body">${t ? linked(t) : ''}<p style="margin:6px 0;">Déduit : <b>${U.qty(i.qty - U.num(i.missing))}</b> · <b class="warn-txt">${U.qty(i.missing)} non déduit(s)</b> : le stock ${i.kind === 'C' ? '' : 'événement '}était insuffisant (sans doute un stock pas encore saisi). Vérifie la fiche avec ↗.</p>
        <div class="tt-actions">${(() => { if (i.kind !== 'M') return ''; const pp = Store.state.stockM.find(x => x.id === i.pId); const vv = pp && pp.variants.find(x => x.id === i.vId); const g = vv ? vv.lots.reduce((a, l) => a + U.num(l.qtyGeneral), 0) : 0; return g > 0 ? `<button class="btn-ghost btn-sm" title="Stock général : ${U.qty(g)}" onclick="Ventes.ttGeneral('${k}')">🏬 Prendre le manquant dans le stock général (${U.qty(g)} dispo)</button>` : ''; })()}<button class="btn-ghost btn-sm" onclick="Ventes.ttMark('${k}','done')">✔ Vu, c'est vérifié</button></div></div>`;
    } else if (!i.pId) {
      const sug = this._suggest(i.desc || i.name, 4, units);
      const q = st.q;
      const res = q ? units.filter(u => (u.name + ' ' + u.label + ' ' + u.sku).toLowerCase().includes(q.toLowerCase())).slice(0, 20) : [];
      const uTxt = u => u.kind === 'A' ? 'accessoire' : 'évén. ' + U.qty(u.availE);
      body = `<div class="tt-body">
        <div class="tt-sug"><span class="muted">💡 Ça ressemble à :</span> ${sug.length ? sug.map(u => `<button class="btn-ghost btn-sm tt-chip" title="Associer à ce produit" onclick="Ventes.ttLink('${k}','${u.key}')"><b>${U.esc(u.name)}</b>${u.label ? ` <span class="pp-v">${U.esc(u.label)}</span>` : ''} <span class="muted">${uTxt(u)}</span></button>`).join('') : '<span class="muted">aucune ressemblance — cherche ci-dessous</span>'}</div>
        <input id="tt_q_${sid}" class="mt" placeholder="🔍 Chercher le bon produit (nom, variante ou SKU)…" value="${U.esc(q)}" oninput="Ventes.ttSearch('${k}',this.value);U.refocus('tt_q_${sid}')">
        ${res.length ? `<div class="ac-list" style="position:static;margin-top:4px;">${res.map(u => `<div class="ac-item pp-row" onmousedown="event.preventDefault();Ventes.ttLink('${k}','${u.key}')"><span class="pp-a">${U.esc(u.name)}${u.label ? ` <span class="pp-v">${U.esc(u.label)}</span>` : ''}</span><span class="pp-b">${uTxt(u)}</span><span class="pp-c">${U.esc(u.sku || '')}</span></div>`).join('')}</div>` : q ? '<p class="muted">Aucun produit trouvé.</p>' : ''}
        <div class="tt-actions"><label class="tt-pack" title="Si ce libellé SumUp est un lot (ex. « Sabot de veau LOT 5 »), chaque vente compte pour N pièces de la variante choisie">Vendu par lot de <input type="number" min="1" step="1" value="${st.pack == null ? this._packFromDesc(i.desc || i.name) : st.pack}" onchange="Ventes._ttState('${k}').pack=Math.max(1,Math.round(U.num(this.value)))"> pièce(s)</label>
          <label class="tt-remember"><input type="checkbox" ${st.remember ? 'checked' : ''} onchange="Ventes._ttState('${k}').remember=this.checked"> Retenir (lignes identiques + prochains imports)</label>
          <button class="btn-ghost btn-sm" title="Garder la vente dans le chiffre d'affaires sans toucher au stock (ex : montant personnalisé)" onclick="Ventes.ttMark('${k}','caOnly')">💶 CA seulement</button>${markBtns}</div>
      </div>`;
    } else {
      const t = this._targetFor(i.kind, i.pId, i.vId);
      if (!t) body = `<div class="tt-body"><p class="warn-txt">Produit introuvable (supprimé ?).</p><div class="tt-actions">${i.desc ? `<button class="btn-ghost btn-sm" onclick="Ventes.ttUnlink('${k}')">✕ Changer</button>` : ''}${markBtns}</div></div>`;
      else if (i.kind === 'A') {
        const a = Store.state.catalogA.find(x => x.id === i.pId);
        const av = U.num(a.stockEvent);
        body = `<div class="tt-body">${linked(t)}<div class="tt-actions"><span>Stock fini événement : <b>${U.qty(av)}</b></span>
          ${av > 0 ? `<button class="btn-ok btn-sm" onclick="Ventes.ttDeduct('${k}')">✅ Déduire ${U.qty(Math.min(av, i.qty))}</button>` : '<span class="muted">rien à déduire (fait à la commande)</span>'}${markBtns}</div></div>`;
      } else {
        const p = Store.state.stockM.find(x => x.id === i.pId); const v = p.variants.find(x => x.id === i.vId);
        const field = 'qtyEvent'; // retour d'événement : toujours le stock événement
        const lots = v.lots.filter(l => U.num(l[field]) > 0).sort((a, b) => (a.dluo || '9999').localeCompare(b.dluo || '9999'));
        if (st.lots === null) {
          const tot = lots.reduce((a, l) => a + U.num(l[field]), 0);
          st.lots = lots.length <= 1 || i.qty >= tot ? this._fefo(lots, field, i.qty) : {};
        }
        const sum = Object.values(st.lots).reduce((a, q) => a + U.num(q), 0);
        const today = U.today();
        body = `<div class="tt-body">${linked(t)}
          ${this._todoCat(i) === 'multi' ? `<p class="tt-multi">🔀 <b>Plusieurs lots en stock événement</b> : indique combien sont partis de chaque lot (ou « Proposer »), puis « Déduire ». Cet article n'est jamais déduit par « Tout déduire ».</p>` : ''}
          ${lots.length ? `<div class="table-wrap"><table class="tt-lots"><thead><tr><th>N° de lot</th><th>DLUO</th><th class="num">En stock</th><th class="num">Partis de ce lot</th></tr></thead><tbody>${lots.map(l => `<tr><td>${U.esc(l.lotNumber || 'sans n°')}</td><td>${l.dluo ? U.frDate(l.dluo) : '—'}${l.dluo && l.dluo < today ? ' <span class="badge bad">périmé</span>' : ''}</td><td class="num">${U.qty(l[field])}</td><td class="num"><input type="number" min="0" step="1" value="${st.lots[l.id] || ''}" placeholder="0" style="width:80px;text-align:center;" onchange="Ventes.ttSetLot('${k}','${l.id}',this.value)"></td></tr>`).join('')}</tbody></table></div>`
            : `<p class="muted">Aucun lot avec du stock événement pour cette variante.</p>`}
          ${(() => { const evTot = v.lots.reduce((a, l) => a + U.num(l.qtyEvent), 0), genTot = v.lots.reduce((a, l) => a + U.num(l.qtyGeneral), 0);
            return evTot < i.qty ? `<p class="tt-gen">🏬 Stock événement ${evTot ? `insuffisant (${U.qty(evTot)} pour ${U.qty(i.qty)} vendus)` : 'à 0'} · stock général : <b>${U.qty(genTot)}</b>
              <button class="btn-ghost btn-sm" onclick="Ventes.ttGeneral('${k}')">🏬 ${evTot ? 'Compléter depuis le stock général' : 'Déduire du stock général'}</button></p>` : ''; })()}
          <div class="tt-actions"><span>Total choisi : <b id="tt_sum_${sid}">${U.qty(sum)}</b> / ${U.qty(i.qty)} vendu(s)</span>
            ${lots.length ? `<button class="btn-ghost btn-sm" onclick="Ventes.ttFefo('${k}')">Proposer (DLUO la plus courte d'abord)</button><button class="btn-ok btn-sm" onclick="Ventes.ttDeduct('${k}')">✅ Déduire</button>` : ''}${markBtns}</div>
        </div>`;
      }
    }
    return `<div class="tt-item${i.todo !== 'open' ? ' is-done' : ''}">${head}${body}</div>`;
  },

  ttSearch(k, val) { this._ttState(k).q = val; this.render(); },
  ttSetLot(k, lotId, val) {
    const st = this._ttState(k); st.lots = st.lots || {};
    st.lots[lotId] = Math.max(0, Math.round(U.num(val)));
    const sum = Object.values(st.lots).reduce((a, q) => a + U.num(q), 0);
    const [sid, idx] = k.split(':');
    const el = document.getElementById('tt_sum_' + (sid + '_' + idx).replace(/[^\w-]/g, '_'));
    if (el) el.textContent = U.qty(sum);
  },
  ttFefo(k) {
    const f = this._ttFind(k); if (!f) return; const { i } = f;
    const st = this._ttState(k);
    const p = Store.state.stockM.find(x => x.id === i.pId); const v = p && p.variants.find(x => x.id === i.vId); if (!v) return;
    const field = 'qtyEvent'; // retour d'événement : toujours le stock événement
    const lots = v.lots.filter(l => U.num(l[field]) > 0).sort((a, b) => (a.dluo || '9999').localeCompare(b.dluo || '9999'));
    st.lots = this._fefo(lots, field, i.qty);
    this.render();
  },
  ttLink(k, key) {
    const f = this._ttFind(k); if (!f) return; const { i } = f;
    const u = this.units().find(x => x.key === key); if (!u) return;
    const st = this._ttState(k);
    const desc = i.desc || i.name;
    const norm = this._normDesc(desc);
    // Lignes à relier : celle-ci, et si « Retenir » est coché, toutes les lignes ouvertes au même libellé.
    const targets = [];
    Store.state.sales.forEach((s, si) => { if (s.cancelled) return; (s.items || []).forEach((it, ix) => {
      const same = it === i || (st.remember && it.todo === 'open' && !it.pId && this._normDesc(it.desc || it.name) === norm);
      if (same) targets.push({ s, it, k: s.id + ':' + ix });
    }); });
    const snaps = [...new Set(targets.map(t => t.s))].map(s => Store.snapshot('sales', s));
    const pack = st.pack == null ? this._packFromDesc(desc) : st.pack;
    targets.forEach(({ it, k: kk }) => {
      if (!it.desc) it.desc = it.name;
      Object.assign(it, { kind: u.kind, pId: u.pId, vId: u.vId || '', name: u.name, label: u.label, sku: u.sku || it.sumupSku || '' });
      // Lot : la ligne SumUp (N lots) devient N × pack pièces de la variante (prix ramené à la pièce).
      if (pack >= 2 && u.kind === 'M' && !it.pack) { it.packs = it.qty; it.pack = pack; it.qty = it.qty * pack; it.price = U.num(it.price) / pack; }
      delete it.cost;
      const s2 = this._ttState(kk); s2.q = ''; s2.lots = null;
    });
    const saves = ['sales'];
    if (st.remember) { const S = Store.state.settings; S.sumupMap = S.sumupMap || {}; S.sumupMap[norm] = { kind: u.kind, pId: u.pId, vId: u.vId || '', ...(pack >= 2 && u.kind === 'M' ? { n: pack } : {}) }; saves.push('settings'); }
    const entry = Store.log('vente', `Article associé — « ${desc} » → ${u.name} ${u.label}` + (targets.length > 1 ? ` (${targets.length} lignes)` : ''), { type: 'restoreBatch', data: snaps });
    Store.save(...saves);
    this.render();
    U.toast(`Associé à ${u.name}${u.label ? ' ' + u.label : ''}` + (targets.length > 1 ? ` (+${targets.length - 1} ligne(s) identique(s))` : '') + (st.remember ? ' · retenu pour les prochains imports' : '') + '.', false, entry.id);
  },
  ttUnlink(k) {
    const f = this._ttFind(k); if (!f) return; const { s, i } = f;
    if (i.deducted) return;
    const snap = Store.snapshot('sales', s);
    Object.assign(i, { kind: 'M', pId: '', vId: '', name: i.desc || i.name, label: '', sku: i.sumupSku || '' });
    if (U.num(i.pack) >= 2) { i.qty = U.num(i.packs) || i.qty / i.pack; i.price = U.num(i.price) * i.pack; delete i.pack; delete i.packs; }
    delete i.cost;
    const st = this._ttState(k); st.lots = null;
    const entry = Store.commitSnapshot(snap, 'vente', `Association retirée — « ${i.name} »`);
    Store.save('sales'); this.render();
    U.toast('Association retirée pour cette ligne (l\'association retenue reste dans la liste 🧠 en bas).', false, entry.id);
  },
  ttMark(k, status) {
    const f = this._ttFind(k); if (!f) return; const { s, i } = f;
    const snap = Store.snapshot('sales', s);
    i.todo = status;
    const lbl = status === 'caOnly' ? 'CA seulement' : status === 'done' ? 'traité' : 'rouvert';
    const entry = Store.commitSnapshot(snap, 'vente', `Article ${lbl} — ${i.desc || i.name}`);
    Store.save('sales'); this.render();
    U.toast(status === 'open' ? 'Article remis à traiter.' : 'Article marqué ' + lbl + '.', false, entry.id);
  },
  ttForget(key) {
    const map = Store.state.settings.sumupMap || {}; if (!map[key]) return;
    delete map[key]; Store.save('settings'); this.render();
    U.toast('Association oubliée.');
  },
  /* Vérifie un article « à traiter » avant déduction (sans rien modifier, sauf la répartition par
     défaut quand elle est sans ambiguïté : 1 lot, ou tout vendu). → {err} ou {sum, qty, ready}. */
  _ttCheck(k) {
    const f = this._ttFind(k); if (!f) return { err: 'introuvable' }; const { i } = f;
    if (i.todo !== 'open' || i.deducted || !i.pId) return { err: 'skip' };
    const st = this._ttState(k);
    if (i.kind === 'A') {
      const a = Store.state.catalogA.find(x => x.id === i.pId); if (!a) return { err: 'Accessoire introuvable.' };
      const take = Math.min(U.num(a.stockEvent), i.qty);
      return { sum: take, qty: i.qty, ready: take > 0 };
    }
    const p = Store.state.stockM.find(x => x.id === i.pId); const v = p && p.variants.find(x => x.id === i.vId);
    if (!v) return { err: 'Variante introuvable.' };
    const field = 'qtyEvent'; // retour d'événement : toujours le stock événement
    if (st.lots === null) {
      const lots = v.lots.filter(l => U.num(l[field]) > 0).sort((a, b) => (a.dluo || '9999').localeCompare(b.dluo || '9999'));
      const tot = lots.reduce((a, l) => a + U.num(l[field]), 0);
      st.lots = lots.length <= 1 || i.qty >= tot ? this._fefo(lots, field, i.qty) : {};
    }
    let sum = 0;
    for (const [lid, q] of Object.entries(st.lots || {})) {
      if (U.num(q) <= 0) continue;
      const lot = v.lots.find(l => l.id === lid);
      if (!lot || U.num(q) > U.num(lot[field])) return { err: `Le lot ${lot ? (lot.lotNumber || 'sans n°') : ''} n'a que ${lot ? U.qty(lot[field]) : 0} en stock.` };
      sum += U.num(q);
    }
    if (!sum) return { err: 'Indique combien sont partis de chaque lot (ou « Proposer »).', sum: 0, qty: i.qty };
    if (sum > i.qty) return { err: `Tu as choisi ${U.qty(sum)}, mais ${U.qty(i.qty)} ont été vendus.` };
    return { sum, qty: i.qty, ready: sum === i.qty };
  },
  /* Applique la déduction (déjà vérifiée par _ttCheck). snapMap : instantanés « avant » partagés. */
  _ttDo(k, snapMap, genPicks) {
    const { s, i } = this._ttFind(k); const st = this._ttState(k);
    const snap = (dom, obj) => { const key = dom + ':' + obj.id; if (!snapMap[key]) snapMap[key] = Store.snapshot(dom, obj); };
    snap('sales', s);
    s.undoOps = s.undoOps || [];
    let msg;
    if (i.kind === 'A') {
      const a = Store.state.catalogA.find(x => x.id === i.pId);
      snap('catalogA', a);
      const take = Math.min(U.num(a.stockEvent), i.qty);
      if (take > 0) { a.stockEvent = U.num(a.stockEvent) - take; s.undoOps.push({ kind: 'A', pId: a.id, field: 'stockEvent', qty: take }); }
      i.cost = U.num(Pricing.accCalc(a).cost) * i.qty;
      msg = `${take} déduit(s)`;
    } else {
      const p = Store.state.stockM.find(x => x.id === i.pId); const v = p.variants.find(x => x.id === i.vId);
      const field = 'qtyEvent'; // retour d'événement : toujours le stock événement
      snap('stockM', p);
      // Lots du stock événement (répartition de l'article) + éventuellement du stock GÉNÉRAL
      // (fenêtre « Déduire du stock général », quand le stock événement ne suffit pas).
      const picks = Object.entries(st.lots || {}).filter(([, q]) => U.num(q) > 0).map(([lid, q]) => [lid, q, field])
        .concat(Object.entries(genPicks || {}).filter(([, q]) => U.num(q) > 0).map(([lid, q]) => [lid, q, 'qtyGeneral']));
      let cost = 0, sum = 0, sumGen = 0; const labels = [];
      picks.forEach(([lid, q, fld]) => {
        const lot = v.lots.find(l => l.id === lid); q = U.num(q); sum += q; if (fld === 'qtyGeneral') sumGen += q;
        lot[fld] = U.num(lot[fld]) - q;
        cost += q * U.num(lot.costUnit || v.costUnit);
        s.undoOps.push({ kind: 'M', pId: p.id, vId: v.id, lId: lot.id, field: fld, qty: q, lotMeta: { lotNumber: lot.lotNumber, dluo: lot.dluo, costUnit: lot.costUnit } });
        labels.push((lot.lotNumber || 'sans n°') + (lot.dluo ? ' · ' + U.frDate(lot.dluo) : '') + ' ×' + q + (fld === 'qtyGeneral' ? ' (gén.)' : ''));
      });
      cost += (i.qty - sum) * U.num(v.costUnit);
      v.lots = v.lots.filter(l => U.num(l.qtyGeneral) > 0 || U.num(l.qtyEvent) > 0);
      i.cost = cost; i.lotLabel = labels.join(' / ');
      if (sum < i.qty) i.missing = i.qty - sum;
      msg = !sumGen ? `${U.qty(sum)} déduit(s) du stock événement` : sum === sumGen ? `${U.qty(sumGen)} déduit(s) du stock général` : `${U.qty(sum - sumGen)} déduit(s) du stock événement + ${U.qty(sumGen)} du stock général`;
    }
    i.deducted = true; i.todo = 'done';
    delete this._tt[k];
    return msg;
  },
  /* Fenêtre « Déduire du stock général » (2026-09-30, demande d'Antho) : quand le stock événement
     ne couvre pas la vente, on peut prendre le reste — ou tout — dans le stock GÉNÉRAL, lot par lot. */
  ttGeneral(k) {
    const f = this._ttFind(k); if (!f) return; const { i } = f;
    const p = Store.state.stockM.find(x => x.id === i.pId); const v = p && p.variants.find(x => x.id === i.vId); if (!v) return;
    const st = this._ttState(k);
    const evPicks = i.deducted ? [] : Object.entries(st.lots || {}).filter(([, q]) => U.num(q) > 0);
    const evSum = i.deducted ? i.qty - U.num(i.missing) : evPicks.reduce((a, [, q]) => a + U.num(q), 0);
    const need = i.deducted ? U.num(i.missing) : Math.max(0, i.qty - evSum);
    const glots = v.lots.filter(l => U.num(l.qtyGeneral) > 0).sort((a, b) => (a.dluo || '9999').localeCompare(b.dluo || '9999'));
    const genTot = glots.reduce((a, l) => a + U.num(l.qtyGeneral), 0);
    const pre = this._fefo(glots, 'qtyGeneral', need);
    const today = U.today();
    this._glCtx = { k, glots: glots.map(l => l.id), genTot, need };
    const head = `<p style="margin:0 0 8px;"><b>${U.esc(p.name)}</b> <span class="pp-v">${U.esc(Pricing.labelVariant(v))}</span> — vendu <b>${U.qty(i.qty)}</b></p>
      <p class="muted" style="margin:0 0 10px;">Pris dans le stock événement : <b>${U.qty(evSum)}</b> · à prendre dans le stock général : <b>${U.qty(need)}</b></p>`;
    if (!need) { U.toast('La répartition du stock événement couvre déjà toute la vente.', true); return; }
    if (!genTot) {
      U.modal({ title: '🏬 Déduire du stock général', hideOk: true, body: head + `<p class="warn-txt">Le stock général de cette variante est à 0 : rien à déduire. Si tu as déjà corrigé le stock toi-même, utilise « ✔ Déjà fait à la main ».</p>` });
      return;
    }
    U.modal({
      title: '🏬 Déduire du stock général', okLabel: 'Déduire du stock général',
      body: head + `<div class="table-wrap"><table class="tt-lots"><thead><tr><th>N° de lot</th><th>DLUO</th><th class="num">Stock général</th><th class="num">À retirer</th></tr></thead><tbody>
        ${glots.map(l => `<tr><td>${U.esc(l.lotNumber || 'sans n°')}</td><td>${l.dluo ? U.frDate(l.dluo) : '—'}${l.dluo && l.dluo < today ? ' <span class="badge bad">périmé</span>' : ''}</td><td class="num">${U.qty(l.qtyGeneral)}</td>
          <td class="num"><input type="number" min="0" step="1" id="gl_${l.id}" value="${pre[l.id] || ''}" placeholder="0" style="width:80px;text-align:center;" oninput="Ventes._glPreview()"></td></tr>`).join('')}
        </tbody></table></div>
        <p id="gl_preview" class="gl-preview"></p>`,
      onOk: () => this._glApply()
    });
    this._glPreview();
  },
  _glPicks() { const c = this._glCtx; const out = {}; (c ? c.glots : []).forEach(id => { const el = document.getElementById('gl_' + id); const q = Math.max(0, Math.round(U.num(el && el.value))); if (q) out[id] = q; }); return out; },
  _glPreview() {
    const c = this._glCtx, el = document.getElementById('gl_preview'); if (!c || !el) return;
    const sum = Object.values(this._glPicks()).reduce((a, q) => a + q, 0);
    el.innerHTML = `Stock général : <b>${U.qty(c.genTot)}</b> → <b>${U.qty(Math.max(0, c.genTot - sum))}</b> · retiré : <b>${U.qty(sum)}</b> / ${U.qty(c.need)} à prendre` + (sum > c.need ? ' <span class="badge bad">plus que nécessaire</span>' : sum < c.need ? ' <span class="badge warn">incomplet</span>' : ' <span class="badge ok">✓</span>');
  },
  _glApply() {
    const c = this._glCtx; if (!c) return false;
    const { k } = c; const f = this._ttFind(k); if (!f) return false; const { i } = f;
    const p = Store.state.stockM.find(x => x.id === i.pId); const v = p.variants.find(x => x.id === i.vId);
    const gp = this._glPicks();
    let gsum = 0;
    for (const [lid, q] of Object.entries(gp)) { const lot = v.lots.find(l => l.id === lid); if (!lot || q > U.num(lot.qtyGeneral)) { U.toast(`Le lot ${lot ? (lot.lotNumber || 'sans n°') : ''} n'a que ${lot ? U.qty(lot.qtyGeneral) : 0} en stock général.`, true); return false; } gsum += q; }
    if (!gsum) { U.toast('Indique la quantité à retirer du stock général.', true); return false; }
    if (gsum > c.need) { U.toast(`Tu retires ${U.qty(gsum)}, mais il n'en faut que ${U.qty(c.need)}.`, true); return false; }
    const snapMap = {};
    let msg;
    if (i.deducted) {
      // Article déjà déduit à l'import mais avec du manquant : on complète depuis le stock général.
      const s = f.s;
      snapMap['sales:' + s.id] = Store.snapshot('sales', s); snapMap['stockM:' + p.id] = Store.snapshot('stockM', p);
      s.undoOps = s.undoOps || []; const labels = [];
      Object.entries(gp).forEach(([lid, q]) => {
        const lot = v.lots.find(l => l.id === lid);
        lot.qtyGeneral = U.num(lot.qtyGeneral) - q;
        i.cost = U.num(i.cost) + q * (U.num(lot.costUnit || v.costUnit) - U.num(v.costUnit));
        s.undoOps.push({ kind: 'M', pId: p.id, vId: v.id, lId: lot.id, field: 'qtyGeneral', qty: q, lotMeta: { lotNumber: lot.lotNumber, dluo: lot.dluo, costUnit: lot.costUnit } });
        labels.push((lot.lotNumber || 'sans n°') + (lot.dluo ? ' · ' + U.frDate(lot.dluo) : '') + ' ×' + q + ' (gén.)');
      });
      v.lots = v.lots.filter(l => U.num(l.qtyGeneral) > 0 || U.num(l.qtyEvent) > 0);
      i.lotLabel = [i.lotLabel, ...labels].filter(Boolean).join(' / ');
      i.missing = U.num(i.missing) - gsum;
      if (i.missing <= 0) { delete i.missing; i.todo = 'done'; }
      msg = `${U.qty(gsum)} pris dans le stock général` + (i.missing ? ` (${U.qty(i.missing)} encore manquant)` : '');
      delete this._tt[k];
    } else {
      const chk = this._ttCheck(k);
      if (chk.err && chk.sum !== 0) { U.toast(chk.err, true); return false; }
      msg = this._ttDo(k, snapMap, gp);
    }
    const entry = Store.log('vente', `Article déduit — ${i.name} ${i.label || ''} : ${msg}`, { type: 'restoreBatch', data: Object.values(snapMap) });
    Store.save('sales', 'stockM');
    this._glCtx = null;
    setTimeout(() => { this.render(); U.toast(`${i.name} : ${msg}.`, false, entry.id); }, 0);
  },
  async ttDeduct(k) {
    const c = this._ttCheck(k);
    if (c.err) { if (c.err !== 'skip') U.toast(c.err, true); return; }
    const { i } = this._ttFind(k);
    if (c.sum < c.qty && !await U.confirm(`Tu retires ${U.qty(c.sum)} sur ${U.qty(c.qty)} vendus : ${U.qty(c.qty - c.sum)} ne seront pas déduits (stock insuffisant ?). Continuer et marquer cet article comme traité ?`, { title: '⚠️ Quantité incomplète', okLabel: 'Continuer' })) return;
    const snapMap = {};
    const msg = this._ttDo(k, snapMap);
    const entry = Store.log('vente', `Article déduit — ${i.name} ${i.label || ''} : ${msg}`, { type: 'restoreBatch', data: Object.values(snapMap) });
    Store.save('sales', 'stockM', 'catalogA');
    this.render();
    U.toast(`${i.name} : ${msg}.`, false, entry.id);
  },

  /* ── Actions groupées (2026-09-30, demande d'Antho) : sur les articles AFFICHÉS (filtre en cours),
     de toute la page ou d'un seul ticket (saleId). Une seule entrée de Journal → annulable d'un coup. ── */
  _todoKeys(saleId) {
    const keys = [];
    Store.state.sales.forEach(s => {
      if (s.cancelled || (saleId && s.id !== saleId)) return;
      (s.items || []).forEach((i, idx) => {
        if (i.todo !== 'open') return;
        if (this.todoFilter !== 'all' && this._todoCat(i) !== this.todoFilter) return;
        keys.push(s.id + ':' + idx);
      });
    });
    return keys;
  },
  _todoReady(saleId) { return this._todoKeys(saleId).filter(k => { const f = this._ttFind(k); if (!f || this._todoCat(f.i) === 'multi') return false; const c = this._ttCheck(k); return !c.err && c.ready; }); },
  async ttBulkDeduct(saleId) {
    const keys = this._todoKeys(saleId);
    const ready = this._todoReady(saleId);
    if (!ready.length) { U.toast('Aucun article prêt : associe le produit et complète la répartition par lot (Total choisi = vendu).', true); return; }
    const rest = keys.length - ready.length;
    if (!await U.confirm(`Déduire du stock les ${ready.length} article(s) prêts (produit associé, lots choisis = quantité vendue) ?` + (rest ? `\n\n${rest} autre(s) restent à traiter (produit à associer ou lot à choisir).` : '') + '\n\nAnnulable en une fois depuis le Journal.', { title: '✅ Tout déduire', okLabel: `Déduire ${ready.length} article(s)` })) return;
    const snapMap = {};
    let n = 0;
    ready.forEach(k => { this._ttDo(k, snapMap); n++; });
    const entry = Store.log('vente', `Articles à traiter — ${n} déduit(s) en une fois`, { type: 'restoreBatch', data: Object.values(snapMap) });
    Store.save('sales', 'stockM', 'catalogA');
    this.render();
    U.toast(`${n} article(s) déduit(s)` + (rest ? ` · ${rest} restent à traiter` : '') + '.', false, entry.id);
  },
  async ttBulkMark(status, saleId) {
    const keys = this._todoKeys(saleId);
    if (!keys.length) { U.toast('Rien à traiter ici.', true); return; }
    const lbl = status === 'caOnly' ? 'en « CA seulement » (le stock ne sera pas touché)' : 'comme « déjà fait à la main »';
    if (!await U.confirm(`Marquer les ${keys.length} article(s) affiché(s) ${lbl} ?\n\nAnnulable en une fois depuis le Journal.`, { title: status === 'caOnly' ? '💶 Tout en CA seulement' : '✔ Tout déjà fait à la main', okLabel: 'Confirmer' })) return;
    const snapMap = {};
    keys.forEach(k => {
      const { s, i } = this._ttFind(k);
      const key = 'sales:' + s.id; if (!snapMap[key]) snapMap[key] = Store.snapshot('sales', s);
      i.todo = (status === 'caOnly' && !i.deducted) ? 'caOnly' : 'done';
    });
    const entry = Store.log('vente', `Articles à traiter — ${keys.length} marqué(s) ${status === 'caOnly' ? 'CA seulement' : 'faits à la main'}`, { type: 'restoreBatch', data: Object.values(snapMap) });
    Store.save('sales');
    this.render();
    U.toast(`${keys.length} article(s) marqué(s).`, false, entry.id);
  },
};
