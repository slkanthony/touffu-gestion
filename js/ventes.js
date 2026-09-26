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
  selKey: '', lotId: '', qty: 1,
  consoId: '', consoQty: 1,
  cart: [],
  customerName: '',
  historySort: { field: 'date', dir: 'desc' },
  retourOpen: false,   // panneau "Retour d'événement" (import CSV SumUp) ouvert ?
  retourData: null,    // données analysées de l'import en attente de validation
  retourDeduct: true,  // coché par défaut = déduire le stock ; décoché = import HISTORIQUE (stats sans toucher au stock)
  cashQ: '', cashOpen: false, cashSelKey: '', cashQty: 1, cashPrice: '', // saisie d'une vente en liquide dans le retour
  retourConsoId: '', retourConsoQty: 1, // saisie des consommables (sacs…) utilisés pendant l'événement
  kind: 'M',           // 'M' mastication (défaut) | 'A' accessoires — bascule le sélecteur de produit à sortir
  accWidth: 'all',     // filtre largeur de sangle en mode Accessoires
  editTicketId: '', ticketConsoId: '', ticketConsoQty: 1, // édition d'un ticket d'événement déjà validé (frais de stand + consommables)

  units() {
    const out = [];
    Store.state.stockM.forEach(p => p.variants.forEach(v => {
      if (v.mode === 'vrac') return;
      const availG = v.lots.reduce((a, l) => a + U.num(l.qtyGeneral), 0);
      const availE = v.lots.reduce((a, l) => a + U.num(l.qtyEvent), 0);
      const lots = v.lots.map(l => ({ id: l.id, lotNumber: l.lotNumber, dluo: l.dluo, qtyG: U.num(l.qtyGeneral), qtyE: U.num(l.qtyEvent) }));
      out.push({ key: 'M|' + p.id + '|' + v.id, kind: 'M', mode: v.mode || 'size', pId: p.id, vId: v.id, name: p.name, label: Pricing.labelVariant(v), type: p.meatType || 'Autre', sku: v.sku || '', price: U.num(v.priceTTC), availG, availE, lots });
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
        <button class="btn-cta" style="flex:0 0 auto;white-space:nowrap;" onclick="Ventes.toggleRetour()">${this.retourOpen ? '← Vente manuelle' : '📥 Retour d\'événement'}</button></div>

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
          ${this.qOpen && prodSuggestions.length ? `<div class="ac-list" style="position:static;margin-top:4px;">${prodSuggestions.map(u => `<div class="ac-item" onmousedown="event.preventDefault();Ventes.pickProduct('${u.key}')">${U.esc(u.name)}${u.label ? ' · ' + U.esc(u.label) : ''} — dispo ${U.qty(this.avail(u))} — ${U.eur(u.price)}</div>`).join('')}</div>` : ''}
        </div>
        ${sel ? `<div class="grid c2">
          ${sel.kind === 'M' ? lotSelect : `<div class="fg"><label>Disponible</label><input disabled value="${U.qty(this.avail(sel))} pièce(s)"></div>`}
          <div class="fg"><label>Quantité</label><input id="v_qty" type="number" step="0.001" min="0" value="${this.qty || 1}" onchange="Ventes.qty=U.num(this.value)"></div>
        </div>
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
            <button class="btn-ghost btn-sm" onclick="Ventes.exportSales()">⬇️ Exporter (CSV)</button>
            <button class="btn-danger btn-sm" onclick="Ventes.restoreAll()">↩️ Restaurer Tout</button>
            <button class="btn-danger btn-sm" onclick="Ventes.clearHistory()">🗑️ Vider l'historique</button>
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
    this.qOpen = false; this.lotId = ''; this.qty = 1; this.render();
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
    const qty = U.num(this.qty) || U.numVal('v_qty');
    if (qty <= 0) { U.toast('Quantité invalide.', true); return; }
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
    this.cart.push({ key: u.key, kind: u.kind, pId: u.pId, vId: u.vId, lotId, lotLabel, name: u.name, label: u.label, sku: u.sku, price: u.price, qty });
    this._pushConsoIfSelected();
    this.qty = 1; this.selKey = ''; this.q = ''; this.lotId = '';
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
          <td class="col-name"><b>${U.esc(c.name)}</b> <span class="muted">${U.esc(c.label)}</span>${c.kind === 'C' ? ' <span class="badge info">conso</span>' : ''}</td>
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
          if (remaining > 0) { shortfalls.push({ name: c.name, label: c.label, sold: c.qty, missing: remaining, src: source }); lineCost += remaining * U.num(v.costUnit); }
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
          if (c.qty - take > 0) shortfalls.push({ name: c.name, label: c.label, sold: c.qty, missing: c.qty - take, src: source });
        }
      }
      sale.items.push({ kind: c.kind, pId: c.pId, vId: c.vId, name: c.name, label: c.label, sku: c.sku, lotLabel: c.lotLabel, qty: c.qty, price: c.price, cost: lineCost });
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

  cancelSale(id) {
    const s = Store.state.sales.find(x => x.id === id);
    if (!s || s.cancelled) return;
    if (!confirm('Annuler cette sortie et re-créditer le stock ?')) return;
    (s.undoOps || []).forEach(op => this.applyUndoOp(op));
    s.cancelled = true;
    Store.log('vente', `Sortie annulée — ${U.eur(s.total)} du ${U.frDateTime(s.ts)}`);
    Store.save('sales', 'stockM', 'catalogA', 'consumables');
    this.render();
    U.toast('Sortie annulée, stock re-crédité.');
  },

  restoreAll() {
    // Les ventes HISTORIQUES (import stats, jamais déduites) sont exclues : rien à re-créditer,
    // et il ne faut surtout pas les marquer annulées (elles disparaîtraient des statistiques).
    const active = Store.state.sales.filter(s => !s.cancelled && !s.historical);
    if (!active.length) { U.toast('Aucune sortie active à restaurer.', true); return; }
    if (!confirm(`Annuler TOUTES les ${active.length} sortie(s) actives et re-créditer le stock ?`)) return;
    active.forEach(s => {
      (s.undoOps || []).forEach(op => this.applyUndoOp(op));
      s.cancelled = true;
    });
    Store.log('vente', `Restauration totale — ${active.length} sortie(s) annulée(s), stock re-crédité`);
    Store.save('sales', 'stockM', 'catalogA', 'consumables');
    this.render();
    U.toast('Toutes les sorties ont été restaurées.');
  },

  clearHistory() {
    if (!Store.state.sales.length) { U.toast('Historique déjà vide.', true); return; }
    if (!confirm(`Supprimer définitivement les ${Store.state.sales.length} entrée(s) de l'historique des sorties ? Le stock n'est pas modifié — utilise "Restaurer Tout" avant si tu veux aussi re-créditer le stock des ventes actives.`)) return;
    Store.state.sales = [];
    Store.log('vente', 'Historique des sorties vidé');
    Store.save('sales');
    this.render();
    U.toast('Historique des sorties vidé.');
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
  eventSelect(cur, cb, style) {
    const names = this.eventNames();
    if (cur && !names.includes(cur)) names.unshift(cur);
    return `<select style="${style || ''}" onchange="Ventes._pickEvent(this, v => { ${cb} })"><option value="">— choisir —</option>${names.map(n => `<option ${n === cur ? 'selected' : ''} value="${U.esc(n)}">${U.esc(n)}</option>`).join('')}<option value="__new">＋ Nouvel événement…</option></select>`;
  },
  _pickEvent(sel, cb) {
    let v = sel.value;
    if (v === '__new') {
      const n = (prompt('Nom du nouvel événement (ex : Marché de Noël Lyon) :') || '').trim();
      if (!n) { sel.value = ''; return; }
      v = Params.addEvent(n) || n;
      cb(v);
      this.render();   // le nouvel événement apparaît aussitôt dans les autres menus (autres journées, espèces)
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
  setDayEventName(key, val) { if (this.retourData) (this.retourData.eventNames = this.retourData.eventNames || {})[key] = String(val || '').trim(); },
  setCashEventName(val) { if (this.retourData) this.retourData.cashEventName = String(val || '').trim(); },

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

  setHistorySort(key) {
    if (this.historySort.field === key) this.historySort.dir = this.historySort.dir === 'asc' ? 'desc' : 'asc';
    else { this.historySort.field = key; this.historySort.dir = key === 'date' ? 'desc' : 'asc'; }
    this.render();
  },

  historyTable() {
    const sales = Store.state.sales.slice(0, 40);
    const hDir = this.historySort.dir === 'desc' ? -1 : 1;
    sales.sort((a, b) => {
      if (this.historySort.field === 'name') return hDir * U.sortFr(a.items[0]?.name || '', b.items[0]?.name || '');
      if (this.historySort.field === 'payment') return hDir * U.sortFr(this.paymentLabel(a), this.paymentLabel(b));
      return hDir * (a.ts - b.ts);
    });
    const sortHead = (key, label) => `<span class="sortable ${this.historySort.field === key ? 'active' : ''}" onclick="Ventes.setHistorySort('${key}')">${label} ${this.historySort.field === key ? (this.historySort.dir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
    const today = Store.state.sales.filter(s => !s.cancelled && new Date(s.ts).toDateString() === new Date().toDateString());
    const caJour = today.reduce((a, s) => a + s.total, 0);
    // Ordre des colonnes (retour d'Antho) : Date · Stock · articles (produit, variante, SKU, lot, qté, prix)
    // à GAUCHE, puis les infos de la vente (paiement, remise, client, frais…) à droite, souvent vides.
    // Cellules de la vente alignées en HAUT (rowspan) pour ne plus flotter au milieu d'une longue liste.
    const rs = n => `rowspan="${n}" style="vertical-align:top;"`;
    const rowsHtml = sales.map(s => s.items.map((i, idx) => `<tr class="${s.cancelled ? 'dim' : ''}">
        ${idx === 0 ? `<td ${rs(s.items.length).replace('style="', 'style="white-space:nowrap;')}>${U.frDateTime(s.ts)}</td>
        <td ${rs(s.items.length)}><span class="badge info">${s.source === 'event' ? 'Événement' : 'Général'}</span>${s.eventName ? `<div style="font-size:.78rem;margin-top:4px;color:var(--caramel);font-weight:600;">🎪 ${U.esc(s.eventName)}</div>` : ''}</td>` : ''}
        <td class="col-name" style="text-align:left;"><b>${U.esc(i.name)}</b></td>
        <td>${i.label ? U.esc(i.label) : '—'}</td>
        <td>${i.sku ? `<span class="tag">${U.esc(i.sku)}</span>` : '—'}</td>
        <td>${i.lotLabel ? `<span class="tag">${U.esc(i.lotLabel)}</span>` : '—'}</td>
        <td class="num">${U.qty(i.qty)}</td>
        <td class="num">${U.eur(i.price)}</td>
        <td class="num"><b>${U.eur(i.price * i.qty)}</b></td>
        ${idx === 0 ? `<td ${rs(s.items.length).replace('style="', 'style="border-left:2px solid var(--caramel);')}>${this.paymentLabel(s)}</td>
        <td ${rs(s.items.length)}>${this.deliveryLabel(s)}</td>
        <td ${rs(s.items.length)}>${s.customerName ? U.esc(s.customerName) : '—'}</td>
        <td ${rs(s.items.length)}>${s.delivery === 'livraison' ? `<span class="badge ${s.shippingChargedToCustomer ? 'info' : 'warn'}" style="cursor:pointer;" title="Cliquer pour changer" onclick="Ventes.toggleShippingCharged('${s.id}')">${s.shippingChargedToCustomer ? `✅ Facturé (${U.eur(s.shippingFeeCollected)})` : '❌ Offert'}</span>` : '—'}</td>
        <td ${rs(s.items.length)}>${s.delivery === 'livraison' ? `<input type="number" step="0.01" min="0" value="${U.num(s.shippingCost)}" style="width:80px;" onchange="Ventes.setShippingCost('${s.id}',this.value)">` : '—'}</td>
        <td ${rs(s.items.length)}>${s.source === 'event' ? `<input type="number" step="0.01" min="0" value="${U.num(s.eventFee)}" style="width:80px;" onchange="Ventes.setEventFee('${s.id}',this.value)">` : '—'}</td>
        <td ${rs(s.items.length).replace('style="', 'style="white-space:nowrap;')}>${s.cancelled ? '<span class="badge bad">annulée</span>' : `${s.source === 'event' ? `<button class="btn-ghost btn-sm" title="Ajouter frais de stand / consommables" onclick="Ventes.editEventTicket('${s.id}')">🎪 Modifier</button> ` : ''}<button class="btn-ghost btn-sm" onclick="Ventes.cancelSale('${s.id}')">Annuler</button>`}</td>` : ''}
      </tr>`).join('')).join('');
    return `<p class="muted">Aujourd'hui : <b>${U.eur(caJour)}</b> (${today.length} sorties)</p>
      <div class="table-wrap"><table><thead><tr><th>${sortHead('date', 'Date')}</th><th>Stock</th><th class="col-name" style="text-align:left;">${sortHead('name', 'Produit')}</th><th>Variante</th><th>SKU</th><th>Lot / DLUO</th><th class="num">Qté</th><th class="num">Prix U.</th><th class="num">Total</th><th style="border-left:2px solid var(--caramel);">${sortHead('payment', 'Paiement')}</th><th>Remise</th><th>Client</th><th>Port client</th><th>Frais d'envoi</th><th>Frais stand</th><th></th></tr></thead>
      <tbody>${rowsHtml || '<tr><td colspan="16" class="muted">Aucune sortie enregistrée.</td></tr>'}</tbody></table></div>`;
  },

  exportSales() {
    const rows = [['Date', 'Stock', 'Canal', 'Paiement', 'Remise', 'Client', 'Port_facture_client', 'Frais_port_encaisses', 'Frais_envoi', 'Frais_stand', 'Evenement', 'Cout_conso', 'Produit', 'Variante', 'SKU', 'Lot', 'Quantite', 'Prix_unitaire', 'Total', 'Annulee']];
    Store.state.sales.forEach(s => s.items.forEach((i, idx) => {
      rows.push([U.frDateTime(s.ts), s.source === 'event' ? 'Evenement' : 'General',
        s.channel === 'online' ? 'En ligne' : s.channel === 'direct' ? 'Directe' : '', s.payment || '',
        s.delivery === 'livraison' ? 'Livraison' : s.delivery === 'clickcollect' ? 'Click and Collect' : '', s.customerName || '',
        s.delivery === 'livraison' ? (s.shippingChargedToCustomer ? 'oui' : 'non') : '',
        idx === 0 && s.delivery === 'livraison' ? U.num(s.shippingFeeCollected).toFixed(2) : '',
        idx === 0 ? U.num(s.shippingCost).toFixed(2) : '',
        idx === 0 ? U.num(s.eventFee).toFixed(2) : '',
        s.eventName || '',
        idx === 0 ? U.num(s.items.filter(x => x.kind === 'C').reduce((a, x) => a + U.num(x.cost), 0)).toFixed(2) : '',
        i.name, i.label || '', i.sku || '', i.lotLabel || '',
        U.num(i.qty), U.num(i.price).toFixed(2), (U.num(i.price) * U.num(i.qty)).toFixed(2), s.cancelled ? 'oui' : 'non']);
    }));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    U.download(`ventes-touffu-${U.today()}.csv`, '﻿' + csv, 'text/csv');
    U.toast('Ventes exportées (CSV).');
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
      const k = l.target.kind + '|' + l.target.pId + '|' + l.target.vId;
      const g = map[k] || (map[k] = { kind: l.target.kind, pId: l.target.pId, vId: l.target.vId, name: l.target.name, label: l.target.label, sku: l.sku, qty: 0, ttc: 0 });
      g.qty += l.qty; g.ttc += l.ttc;
    });
    return Object.values(map).map(g => ({ ...g, unit: g.qty > 0 ? g.ttc / g.qty : g.ttc }));
  },
  /* Regroupe les lignes à traiter à la main par (SKU + libellé). */
  _groupProblems(lines) {
    const map = {};
    lines.forEach(l => {
      const k = (l.sku || '') + '||' + l.desc;
      const g = map[k] || (map[k] = { desc: l.desc, sku: l.sku, status: l.status, qty: 0, ttc: 0 });
      g.qty += l.qty; g.ttc += l.ttc;
    });
    return Object.values(map);
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
          const stocked = v.lots.filter(l => U.num(l.qtyEvent) > 0);
          ambiguous.push({ ...g, total: stocked.reduce((a, l) => a + U.num(l.qtyEvent), 0), nLots: stocked.length });
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

  /* SKU (majuscule, sans espaces) -> cible stock (variante Mastication ou accessoire). */
  _skuIndex() {
    const idx = {};
    Store.state.stockM.forEach(p => (p.variants || []).forEach(v => {
      const sku = (v.sku || '').trim().toUpperCase();
      if (sku) idx[sku] = { kind: 'M', pId: p.id, vId: v.id, name: p.name, label: Pricing.labelVariant(v) };
    }));
    Store.state.catalogA.forEach(a => {
      const sku = (a.sku || '').trim().toUpperCase();
      if (sku && !idx[sku]) idx[sku] = { kind: 'A', pId: a.id, vId: '', name: a.name, label: a.category || '' };
    });
    return idx;
  },

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
    const skuIdx = this._skuIndex();
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
      const target = sku ? skuIdx[sku.toUpperCase()] : null;
      line.status = !sku ? 'noSku' : target ? 'ok' : 'unknownSku';
      if (target) line.target = target;
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
        <p class="muted">Dépose ton export SumUp au format <b>CSV</b> (avec la colonne SKU). L'appli regroupe les ventes <b>par journée de marché</b>, déduit ton stock <b>Événement</b> pour chaque article reconnu par son SKU, et te liste à part ce qui est à traiter à la main (sans SKU / SKU inconnu). Rien n'est déduit sans ta validation, et un fichier déjà importé ne l'est jamais deux fois.</p>
        <input type="file" id="retour_file" accept=".csv,text/csv" class="mt">
        <div class="frow mt"><button class="btn-cta" onclick="Ventes.analyzeRetour()">Analyser le fichier</button></div>
      </div>`;
    }
    const imported = this._retourImportedRefs();
    let nNoSku = 0, nUnknown = 0, nDup = 0;
    const problems = [];
    d.days.forEach(g => g.lines.forEach(l => {
      if (imported.has(l.ref)) { nDup++; return; }
      if (l.status === 'noSku') { nNoSku++; problems.push(l); }
      else if (l.status === 'unknownSku') { nUnknown++; problems.push(l); }
    }));
    // Safe vs ambigu (multi-lots partiels) calculés sur les buckets réels (respecte la fusion).
    let safeQty = 0, ambQty = 0;
    const ambItems = [], safeItems = [];
    this._retourBuckets(d, imported).forEach(b => {
      const ok = b.lines.filter(l => l.status === 'ok' && !imported.has(l.ref));
      const { safe, ambiguous } = this._retourSplit(ok);
      safeQty += safe.reduce((a, g) => a + g.qty, 0);
      ambQty += ambiguous.reduce((a, g) => a + g.qty, 0);
      ambItems.push(...ambiguous);
      safeItems.push(...safe);
    });
    // Récap détaillé de ce qui SERA déduit (demande d'Antho) : un produit par ligne, stock
    // événement actuel → après (jamais négatif), en rouge si insuffisant.
    const safeMap = {};
    safeItems.forEach(g => { const k = g.kind + '|' + g.pId + '|' + (g.vId || ''); const x = safeMap[k] || (safeMap[k] = { ...g, qty: 0, ttc: 0 }); x.qty += g.qty; x.ttc += g.ttc; });
    const unitsByKey = {}; this.units().forEach(u => { unitsByKey[u.kind === 'A' ? 'A|' + u.pId + '|' : u.key] = u; });
    const safeList = Object.values(safeMap).map(g => { const u = unitsByKey[g.kind + '|' + g.pId + '|' + (g.vId || '')]; const cur = u ? U.num(u.availE) : 0; return { ...g, cur, after: Math.max(0, cur - g.qty), short: Math.max(0, g.qty - cur) }; })
      .sort((a, b) => U.sortFr(a.name + ' ' + (a.label || ''), b.name + ' ' + (b.label || '')));
    // Regroupe l'affichage des ambigus par produit (une ligne par variante).
    const ambMap = {};
    ambItems.forEach(a => { const k = a.name + '||' + a.label; const g = ambMap[k] || (ambMap[k] = { name: a.name, label: a.label, qty: 0, total: a.total, nLots: a.nLots }); g.qty += a.qty; });
    const ambList = Object.values(ambMap);
    return `<div class="card">
      <h2>📥 Retour d'événement — revue avant validation</h2>
      <div class="frow" style="gap:8px;flex-wrap:wrap;">
        <span class="badge ok">✅ ${safeQty} article(s) déduits</span>
        ${ambList.length ? `<span class="badge bad">🔀 ${ambList.length} produit(s) multi-lots (${ambQty} art.) — déduction manuelle</span>` : ''}
        ${nNoSku ? `<span class="badge warn">⚠️ ${nNoSku} sans SKU</span>` : ''}
        ${nUnknown ? `<span class="badge warn">⚠️ ${nUnknown} SKU inconnu</span>` : ''}
        ${nDup ? `<span class="badge info">↩️ ${nDup} déjà importé(s) — ignoré(s)</span>` : ''}
      </div>
      <label class="mt" style="display:flex;gap:8px;align-items:center;text-transform:none;cursor:pointer;">
        <input type="checkbox" ${d.mergeOne ? 'checked' : ''} onclick="Ventes.setRetourMerge(this.checked)">
        Fusionner les journées cochées en un seul ticket (ex : marché sur un week-end)</label>
      ${this.eventNamesDatalist()}
      <div class="mt">${d.days.map(g => this.retourDayCard(g, imported)).join('')}</div>
      ${safeList.length ? `<details class="fold" style="margin-top:12px;" ${this._retourSafeOpen ? 'open' : ''} ontoggle="Ventes._retourSafeOpen=this.open"><summary><b>✅ ${safeList.length} produit(s) ${this.retourDeduct ? 'qui seront déduits du stock événement' : 'enregistrés SANS déduction (import historique)'}</b> (${safeQty} article(s))${safeList.some(x => x.short) ? ' <span class="badge bad">⚠️ stock insuffisant sur ' + safeList.filter(x => x.short).length + '</span>' : ''}</summary><div class="fold-body">
        <div class="table-wrap"><table><thead><tr><th class="col-name">Produit</th><th>Variante</th><th>SKU</th><th class="num">Qté vendue</th><th class="num">Stock évén. actuel</th><th class="num">${this.retourDeduct ? 'Après validation' : 'Après (inchangé)'}</th></tr></thead>
        <tbody>${safeList.map(x => `<tr${x.short && this.retourDeduct ? ' style="color:var(--alerte);"' : ''}><td class="col-name"><b>${U.esc(x.name)}</b></td><td>${U.esc(x.label || '')}</td><td>${x.sku ? `<span class="tag">${U.esc(x.sku)}</span>` : '—'}</td><td class="num"><b>${U.qty(x.qty)}</b></td><td class="num">${U.qty(x.cur)}</td><td class="num">${this.retourDeduct ? `<b>${U.qty(x.after)}</b>${x.short ? ` <span class="badge bad" title="Stock événement insuffisant : ${U.qty(x.short)} ne pourront pas être déduits (sans doute un stock pas encore saisi)">−${U.qty(x.short)} manquant</span>` : ''}` : U.qty(x.cur)}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted" style="font-size:.82rem;">Déduction FEFO (DLUO la plus courte d'abord). Le stock ne passe jamais en négatif. Les ventes espèces et consommables ajoutés plus bas sont déduits en plus.</p>
      </div></details>` : ''}
      ${problems.length ? (() => { const gp = this._groupProblems(problems); return `<details class="fold" style="margin-top:12px;"><summary><b>⚠️ ${gp.length} produit(s) à traiter à la main</b> (${problems.reduce((a, l) => a + l.qty, 0)} article(s))</summary><div class="fold-body">
        <p class="muted">Non déduits automatiquement (sans SKU ou SKU absent de ton stock). Fais-les à la main dans la vente si nécessaire, ou complète le SKU côté SumUp et Stock puis réimporte.</p>
        <div class="table-wrap"><table><thead><tr><th class="col-name">Produit (SumUp)</th><th>SKU</th><th class="num">Qté</th><th class="num">Montant</th><th>Motif</th></tr></thead>
        <tbody>${gp.map(l => `<tr><td class="col-name">${U.esc(l.desc)}</td><td>${l.sku ? `<span class="tag">${U.esc(l.sku)}</span>` : '—'}</td><td class="num">${U.qty(l.qty)}</td><td class="num sensitive">${U.eur(l.ttc)}</td><td>${l.status === 'noSku' ? 'Sans SKU' : 'SKU inconnu'}</td></tr>`).join('')}</tbody></table></div>
      </div></details>`; })() : ''}
      ${ambList.length ? `<details class="fold" style="margin-top:12px;"><summary><b>🔀 ${ambList.length} produit(s) à traiter (numéro de lot)</b> (${ambQty} article(s))</summary><div class="fold-body">
        <p class="muted">Ces produits ont <b>plusieurs numéros de lot</b> en stock événement et tu n'en as vendu qu'une partie : impossible de deviner lequel est parti, donc <b>non déduits</b>. Retire la bonne quantité du bon lot dans <b>Stock</b> (ou via une Vente Événement).</p>
        <div class="table-wrap"><table><thead><tr><th class="col-name">Produit</th><th class="num">Vendu</th><th class="num">En stock évén.</th><th class="num">Nb lots</th></tr></thead>
        <tbody>${ambList.map(a => `<tr><td class="col-name"><b>${U.esc(a.name)}</b> <span class="muted">${U.esc(a.label || '')}</span></td><td class="num">${U.qty(a.qty)}</td><td class="num">${U.qty(a.total)}</td><td class="num">${a.nLots}</td></tr>`).join('')}</tbody></table></div>
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
      <p class="muted">Ajoute ici les ventes de l'événement encaissées en espèces (absentes de l'export SumUp). Elles créent un ticket séparé « espèces » et déduisent aussi ton stock événement.</p>
      <div class="grid c2">
        <div class="fg autocomplete" data-onclose="Ventes.closeCashMenu"><label>Produit</label>
          <input id="cash_prod" type="text" autocomplete="off" placeholder="tape un nom ou un SKU…" value="${U.esc(this.cashQ)}"
            oninput="Ventes.setCashQ(this.value);U.refocus('cash_prod')">
          ${this.cashOpen && suggestions.length ? `<div class="ac-list" style="position:static;margin-top:4px;max-height:230px;overflow-y:auto;">${suggestions.map(u => `<div class="ac-item" onmousedown="event.preventDefault();Ventes.pickCashProduct('${u.key}')">${U.esc(u.name)}${u.label ? ' · ' + U.esc(u.label) : ''}${u.sku ? ' · ' + U.esc(u.sku) : ''} — ${U.eur(u.price)}</div>`).join('')}</div>` : ''}
          ${this.cashOpen && !suggestions.length && this.cashQ ? `<div class="muted" style="padding:6px 2px;">Aucun produit ne correspond à « ${U.esc(this.cashQ)} ».</div>` : ''}
        </div>
        <div class="fg"><label>Date de l'événement</label><input type="date" value="${d.cashDate}" onchange="Ventes.setCashDate(this.value)"></div>
      </div>
      <div class="fg"><label>🎪 Événement (ventes espèces)</label>${this.eventSelect(this.retourData && this.retourData.cashEventName || '', 'Ventes.setCashEventName(v)')}</div>
      <div class="fg"><label>🏪 Frais de stand (€) <span class="muted" style="text-transform:none;">— seulement si cette journée n'a PAS de ticket SumUp (sinon mets-le sur la journée ci-dessus)</span></label><input type="number" step="0.01" min="0" placeholder="0" style="max-width:160px;" value="${U.num(d.cashStandFee) || ''}" onchange="Ventes.setCashStandFee(this.value)"></div>
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
      <p class="muted">Indique ce que tu as consommé pendant l'événement (ex : sacs donnés aux clients). ${this.retourDeduct ? 'Déduit du stock consommable' : 'Non déduit (mode historique)'} et compté en <b>coût</b> pour une marge plus précise dans les stats.</p>
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
      </div>

      <div class="card" style="border-left:3px solid var(--caramel);">
        <h2>📦 Consommables utilisés (sacs, étiquettes…)</h2>
        <p class="muted">${s.historical ? 'Événement <b>historique</b> → coût compté sans toucher au stock actuel.' : 'Déduit du stock consommable'} et compté en <b>coût</b> dans la marge du mois de cet événement.</p>
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
    const okLines = newLines.filter(l => l.status === 'ok');
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
        <span class="muted" style="font-size:.78rem;">coût du stand pour cette journée (métrage, emplacement…)</span>
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
    const allShort = [], allAmbig = [];
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
        const sale = { id: U.uid(), ts: b.ts || Date.now(), source: 'event', channel: 'direct', payment: 'sumup', delivery: 'clickcollect', customerName: '', eventFee, eventName, items, total, cancelled: false, undoOps: [], sumupRefs: refs, fromImport: true, historical: true };
        Store.state.sales.unshift(sale);
        Store.log('vente', `Import historique ${b.label} — ${U.eur(total)} (${items.length} produit(s), stock non déduit)`, { type: 'sale', data: { saleId: sale.id } });
        created++; deducted += items.reduce((a, i) => a + i.qty, 0); refs.forEach(r => seen.add(r));
        return;
      }
      const okLines = b.lines.filter(l => l.status === 'ok' && !seen.has(l.ref));
      if (!okLines.length) return;
      const refs = [...new Set(okLines.map(l => l.ref))];
      const { safe, ambiguous } = this._retourSplit(okLines);
      allAmbig.push(...ambiguous);
      // Un ticket n'est créé QUE s'il y a du "safe" à déduire ; sinon (tout ambigu) on ne
      // marque pas les refs → la journée réapparaîtra au prochain import pour rappel.
      if (!safe.length) return;
      const lines = safe.map(g => ({ kind: g.kind, pId: g.pId, vId: g.vId, name: g.name, label: g.label, sku: g.sku, lotLabel: '', price: g.unit, qty: g.qty }));
      const eventFee = (b.keys || []).reduce((a, k) => a + U.num((d.standFees || {})[k]), 0);
      const eventName = (b.keys || []).map(k => (d.eventNames || {})[k]).find(Boolean) || '';
      const sale = { id: U.uid(), ts: b.ts || Date.now(), source: 'event', channel: 'direct', payment: 'sumup', delivery: 'clickcollect', customerName: '', eventFee, eventName, items: [], total: 0, cancelled: false, undoOps: [], sumupRefs: refs, fromImport: true };
      const short = this._deductSale(sale, lines, 'event');
      Store.state.sales.unshift(sale);
      Store.log('vente', `Retour événement ${b.label} — ${U.eur(sale.total)} (${lines.length} produit(s))`, { type: 'sale', data: { saleId: sale.id } });
      created++; deducted += lines.reduce((a, l) => a + l.qty, 0); allShort.push(...short);
      refs.forEach(r => seen.add(r));
    });
    // Ticket espèces séparé (payment 'cash', pas de frais SumUp), daté à la journée choisie.
    if (d.cashLines.length) {
      const cashTs = d.cashDate ? new Date(d.cashDate + 'T12:00:00').getTime() : Date.now();
      if (!deduct) {
        const items = d.cashLines.map(l => ({ kind: l.kind || 'M', pId: l.pId || '', vId: l.vId || '', name: l.name, variant: l.label || '', sku: l.sku || '', qty: l.qty, price: l.price }));
        const total = items.reduce((a, i) => a + i.price * i.qty, 0);
        const sale = { id: U.uid(), ts: cashTs, source: 'event', channel: 'direct', payment: 'cash', delivery: 'clickcollect', customerName: '', eventFee: U.num(d.cashStandFee), eventName: d.cashEventName || '', items, total, cancelled: false, undoOps: [], fromImport: true, historical: true };
        Store.state.sales.unshift(sale);
        Store.log('vente', `Import historique (espèces) — ${U.eur(total)} (stock non déduit)`, { type: 'sale', data: { saleId: sale.id } });
        created++; deducted += d.cashLines.reduce((a, l) => a + l.qty, 0);
      } else {
        const sale = { id: U.uid(), ts: cashTs, source: 'event', channel: 'direct', payment: 'cash', delivery: 'clickcollect', customerName: '', eventFee: U.num(d.cashStandFee), eventName: d.cashEventName || '', items: [], total: 0, cancelled: false, undoOps: [], fromImport: true };
        const short = this._deductSale(sale, d.cashLines.map(l => ({ ...l, lotLabel: '' })), 'event');
        Store.state.sales.unshift(sale);
        Store.log('vente', `Retour événement (espèces) — ${U.eur(sale.total)}`, { type: 'sale', data: { saleId: sale.id } });
        created++; deducted += d.cashLines.reduce((a, l) => a + l.qty, 0); allShort.push(...short);
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
        consoCost = (sale.items || []).reduce((a, i) => a + U.num(i.cost), 0);
        Store.state.sales.unshift(sale);
        Store.log('vente', `Retour événement — consommables utilisés (${sale.items.length}, coût ${U.eur(consoCost)})`, { type: 'sale', data: { saleId: sale.id } });
        created++;
      }
    }
    if (!created && !allAmbig.length) { U.toast('Rien à valider (déjà importé ?).', true); return; }
    if (created) { if (deduct) Store.save('sales', 'stockM', 'catalogA', 'consumables'); else Store.save('sales'); }
    this.retourData = null;
    this.retourOpen = false; history.replaceState(null, '', '#/ventes');
    this.retourDeduct = true;   // retour au défaut sûr (déduction) après chaque import
    this.retourConsoId = ''; this.retourConsoQty = 1;
    this.render();
    const consoTxt = consoCost > 0 ? ` · consommables ${U.eur(consoCost)}` : '';
    if (created) U.toast(deduct
      ? `${created} ticket(s) créé(s) · ${deducted} article(s) déduits du stock événement${consoTxt}.`
      : `📚 ${created} ticket(s) historique(s) créé(s) · ${deducted} article(s) ajoutés aux stats (stock NON touché)${consoTxt}.`);
    if (deduct && (allShort.length || allAmbig.length)) this._alertRetourIssues(allShort, allAmbig);
  },

  _alertRetourIssues(shortfalls, ambiguous) {
    const parts = [];
    if (ambiguous.length) {
      const rows = ambiguous.map(a => `<li><b>${U.esc(a.name)}</b>${a.label ? ' ' + U.esc(a.label) : ''} — vendu ${U.qty(a.qty)} sur ${U.qty(a.total)} en stock, réparti sur <b>${a.nLots} lots</b></li>`).join('');
      parts.push(`<p><b>🔀 Plusieurs lots — à déduire à la main</b></p>
        <p class="muted">Ces produits ont <b>plusieurs numéros de lot</b> en stock événement et tu n'en as vendu qu'une partie : impossible de savoir lequel est parti, donc <b>rien n'a été déduit</b> pour eux. Va dans <b>Stock</b> (ou fais une <b>Vente Événement</b>) pour retirer la bonne quantité du bon lot.</p>
        <ul style="margin:8px 0;padding-left:20px;line-height:1.6;">${rows}</ul>`);
    }
    if (shortfalls.length) {
      const rows = shortfalls.map(s => `<li><b>${U.esc(s.name)}</b>${s.label ? ' ' + U.esc(s.label) : ''} — vendu ${U.qty(s.sold)}, <b class="warn-txt">${U.qty(s.missing)} non déduit(s)</b> (stock ${s.src === 'event' ? 'événement' : 'général'} épuisé)</li>`).join('');
      parts.push(`<p><b>⚠️ Stock insuffisant — mis à 0</b></p>
        <p class="muted">Le stock ne peut pas passer en négatif ; ces articles ont été mis à 0 (il en manquait).</p>
        <ul style="margin:8px 0;padding-left:20px;line-height:1.6;">${rows}</ul>`);
    }
    U.modal({ title: '⚠️ À vérifier après import', hideOk: true, body: parts.join('<hr class="sep" style="border-style:dashed;margin:12px 0;">') });
  }
};
