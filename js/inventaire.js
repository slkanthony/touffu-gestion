/* ============================================================
   INVENTAIRE — inventaire rapide stock général & événement
   Brouillon en mémoire · validation en bloc · journal
   ============================================================ */
const Inventaire = {

  /* ── brouillon en mémoire (jamais persisté) ── */
  _draft: null,  // {type:'event'|'general', entries:{key:qty}, touched:Set<key>}
  // key = varId + ':' + lotId

  /* ── état UI autocomplete emplacements (dans Params) ── */
  _locAcQ: {},    // locId → texte tapé
  _locAcOpen: {}, // locId → bool
  _locAcRes: {},  // locId → [{id,name}]

  /* ── état UI inventaire ── */
  _secOpen: {},   // id-section → bool

  /* ───── Utilitaires clé ───── */
  _domKey(key) { return 'inv_' + key.replace(/[^a-zA-Z0-9]/g, '_'); },
  _lotKey(varId, lotId) { return varId + ':' + lotId; },

  /* ───── Paramétrage des emplacements (rendu dans Params) ───── */

  locsCard() {
    const locs = Store.state.settings.inventoryLocations || [];
    const rows = locs.map((loc, i) => {
      const prods = (loc.products || [])
        .map(pid => Store.state.stockM.find(p => p.id === pid)).filter(Boolean);
      const acQ   = this._locAcQ[loc.id]   || '';
      const acOpen = this._locAcOpen[loc.id] || false;
      const acRes  = this._locAcRes[loc.id]  || [];
      const lid    = U.esc(loc.id);

      return `<div class="card" style="margin-bottom:8px;padding:10px 14px;">
        <div class="frow" style="gap:8px;align-items:center;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" onclick="Inventaire.moveLoc('${lid}',-1)" ${i===0?'disabled':''} title="Monter">↑</button>
          <button class="btn btn-ghost btn-sm" onclick="Inventaire.moveLoc('${lid}',1)" ${i===locs.length-1?'disabled':''} title="Descendre">↓</button>
          <input value="${U.esc(loc.name)}" placeholder="Nom (ex : Colonne 1 – Bœuf)" style="flex:1;min-width:140px;" onchange="Inventaire.renameLoc('${lid}',this.value)">
          <select style="flex:0 0 auto;width:110px;" onchange="Inventaire.setLocType('${lid}',this.value)">
            <option value="column" ${loc.type==='column'?'selected':''}>Colonne</option>
            <option value="box" ${loc.type==='box'?'selected':''}>Boîte</option>
          </select>
          ${loc.type==='column' ? `<div class="frow" style="gap:4px;align-items:center;">
            <span class="muted" style="white-space:nowrap;font-size:.88em;">Étages :</span>
            <input type="number" min="1" max="20" value="${loc.floors||1}" style="width:52px;text-align:center;" onchange="Inventaire.setLocFloors('${lid}',this.value)">
          </div>` : ''}
          <button class="btn btn-danger btn-sm" onclick="Inventaire.delLoc('${lid}')" title="Supprimer">${U.icon('trash-2',{size:.9})}</button>
        </div>
        <div class="frow mt" style="gap:6px;flex-wrap:wrap;align-items:center;">
          ${prods.map(p => `<span class="badge" style="cursor:pointer;user-select:none;" onclick="Inventaire.removeProdFromLoc('${lid}','${U.esc(p.id)}')" title="Retirer">${U.esc(p.name)} ×</span>`).join('')}
          <div style="position:relative;">
            <input id="loc_ac_${lid}" type="text" autocomplete="off" placeholder="Ajouter un produit…" value="${U.esc(acQ)}" style="min-width:160px;"
              oninput="Inventaire._acInput('${lid}',this.value);U.refocus('loc_ac_${lid}')"
              onblur="setTimeout(()=>Inventaire._acClose('${lid}'),160)">
            ${acOpen && acRes.length ? `<div style="position:absolute;top:100%;left:0;min-width:200px;background:var(--fond-carte);border:1px solid var(--ligne);border-radius:6px;z-index:200;max-height:200px;overflow-y:auto;padding:4px 0;box-shadow:0 4px 12px rgba(0,0,0,.18);">
              ${acRes.map(p => `<div style="padding:6px 12px;cursor:pointer;" onmousedown="event.preventDefault();Inventaire._acPick('${lid}','${U.esc(p.id)}')">${U.esc(p.name)}</div>`).join('')}
            </div>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    return `<div>
      ${rows || '<p class="muted">Aucun emplacement — clique sur un bouton ci-dessous pour commencer.</p>'}
      <div class="frow mt" style="gap:6px;">
        <button class="btn btn-ghost btn-sm" onclick="Inventaire.addLoc('column')">${U.icon('plus',{size:.9})} Colonne</button>
        <button class="btn btn-ghost btn-sm" onclick="Inventaire.addLoc('box')">${U.icon('plus',{size:.9})} Boîte</button>
      </div>
      <p class="muted help" style="margin-top:8px;">Ces emplacements servent dans l'inventaire rapide du stock événement. Ajoute les produits présents dans chaque colonne ou boîte pour retrouver l'ordre physique de ton rangement.</p>
    </div>`;
  },

  _acInput(locId, q) {
    this._locAcQ[locId] = q;
    const loc = (Store.state.settings.inventoryLocations || []).find(l => l.id === locId);
    const existing = loc ? (loc.products || []) : [];
    if (!q.trim()) {
      this._locAcRes[locId]  = [];
      this._locAcOpen[locId] = false;
    } else {
      this._locAcRes[locId]  = Store.state.stockM.filter(p => !existing.includes(p.id) && U.has(p.name, q)).slice(0, 8);
      this._locAcOpen[locId] = this._locAcRes[locId].length > 0;
    }
    Params.render();
  },

  _acPick(locId, prodId) {
    this.addProdToLoc(locId, prodId);
    this._locAcQ[locId]    = '';
    this._locAcOpen[locId] = false;
    this._locAcRes[locId]  = [];
    Params.render();
  },

  _acClose(locId) {
    if (!this._locAcOpen[locId]) return;
    this._locAcOpen[locId] = false;
    Params.render();
  },

  addLoc(type) {
    const S = Store.state.settings;
    if (!S.inventoryLocations) S.inventoryLocations = [];
    S.inventoryLocations.push({ id: 'loc_' + Date.now(), name: '', type, floors: type === 'column' ? 2 : 1, products: [] });
    Store.save('settings');
    Params.render();
  },

  renameLoc(id, name) {
    const loc = (Store.state.settings.inventoryLocations || []).find(l => l.id === id);
    if (loc) { loc.name = name; Store.save('settings'); }
  },

  setLocType(id, type) {
    const loc = (Store.state.settings.inventoryLocations || []).find(l => l.id === id);
    if (!loc) return;
    loc.type = type;
    if (type === 'box') loc.floors = 1;
    Store.save('settings');
    Params.render();
  },

  setLocFloors(id, n) {
    const loc = (Store.state.settings.inventoryLocations || []).find(l => l.id === id);
    if (loc) { loc.floors = Math.max(1, parseInt(n) || 1); Store.save('settings'); }
  },

  moveLoc(id, dir) {
    const locs = Store.state.settings.inventoryLocations || [];
    const i = locs.findIndex(l => l.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= locs.length) return;
    [locs[i], locs[j]] = [locs[j], locs[i]];
    Store.save('settings');
    Params.render();
  },

  delLoc(id) {
    U.confirm({ title: 'Supprimer cet emplacement ?', html: 'Les produits ne seront pas supprimés du stock — seulement retirés de cet emplacement.' }).then(ok => {
      if (!ok) return;
      const S = Store.state.settings;
      S.inventoryLocations = (S.inventoryLocations || []).filter(l => l.id !== id);
      Store.save('settings');
      Params.render();
    });
  },

  addProdToLoc(locId, prodId) {
    const loc = (Store.state.settings.inventoryLocations || []).find(l => l.id === locId);
    if (!loc) return;
    if (!loc.products) loc.products = [];
    if (!loc.products.includes(prodId)) { loc.products.push(prodId); Store.save('settings'); }
  },

  removeProdFromLoc(locId, prodId) {
    const loc = (Store.state.settings.inventoryLocations || []).find(l => l.id === locId);
    if (!loc) return;
    loc.products = (loc.products || []).filter(id => id !== prodId);
    Store.save('settings');
    Params.render();
  },

  /* ───── Ouverture de l'inventaire ───── */

  open() {
    U.modal({
      title: 'Inventaire rapide',
      body: `<p style="margin-bottom:16px;" class="muted">Quel stock veux-tu inventorier ?</p>
        <div class="frow" style="gap:10px;justify-content:center;">
          <button class="btn-cta" style="min-width:140px;" onclick="U.closeModal();Inventaire.start('event')">
            ${U.icon('tent',{size:1})} Stock événement
          </button>
          <button class="btn-cta" style="min-width:140px;background:var(--gris-fonc);" onclick="U.closeModal();Inventaire.start('general')">
            ${U.icon('package',{size:1})} Stock général
          </button>
        </div>`,
      hideOk: true
    });
  },

  start(type) {
    this._draft   = { type, entries: {}, touched: new Set(), filters: { q: '', meats: new Set() }, excluded: new Set() };
    this._secOpen = {};
    this._saveDraft();
    this.render();
  },

  /* ───── Vue inventaire ───── */

  render() {
    if (!this._draft) return Stock.render();
    if (this._draft.type === 'event') this._renderEvent();
    else this._renderGeneral();
  },

  _pool() { return this._draft.type === 'event' ? 'qtyEvent' : 'qtyGeneral'; },

  _lotsOfType(v) {
    const pool = this._pool();
    return (v.lots || []).filter(l => (l[pool] || 0) > 0);
  },

  _draftQty(varId, l) {
    const k = this._lotKey(varId, l.id);
    return k in this._draft.entries ? this._draft.entries[k] : (l[this._pool()] || 0);
  },

  _lotRowHTML(p, v, l, lotTotal, lotIdx) {
    const k       = this._lotKey(v.id, l.id);
    const dk      = this._domKey(k);
    const pool    = this._pool();
    const cur     = l[pool] || 0;
    const touched = this._draft.touched.has(k);
    const qty     = touched && k in this._draft.entries ? this._draft.entries[k] : '';

    const varLabel    = U.esc(Pricing.labelVariant(v));
    const lotNumLabel = lotTotal > 1 ? `Lot ${lotIdx+1}/${lotTotal}` : '';
    const lotRef      = l.lotNumber ? (lotTotal > 1 ? 'Réf. ' : 'Lot ') + U.esc(l.lotNumber) : '';
    const lastInvStr  = l.lastInv ? (() => {
      const d = new Date(l.lastInv);
      return 'Inv. ' + d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) + ' à ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    })() : '';
    const lotInfo     = [lotNumLabel, lotRef, l.dluo || '', lastInvStr].filter(Boolean).join(' · ');

    const delta = touched && k in this._draft.entries ? this._draft.entries[k] - cur : null;
    const dHtml = delta !== null && delta !== 0
      ? `<span style="position:absolute;top:-8px;right:-4px;font-size:.68em;font-weight:700;color:${delta>0?'var(--ok)':'var(--alerte)'};background:var(--fond-carte);border-radius:3px;padding:0 3px;line-height:1.4;">${delta>0?'+':''}${delta}</span>`
      : `<span id="${dk}_d" style="display:none;position:absolute;top:-8px;right:-4px;"></span>`;
    const inputBorder = touched ? 'var(--ok)' : 'var(--caramel)';
    const btnOpacity  = touched && delta === 0 ? 'opacity:.45;' : '';

    return `<div style="display:flex;align-items:center;gap:8px;padding:10px 10px 10px 12px;margin:5px 10px;border-radius:8px;background:var(--fond);box-shadow:0 1px 4px rgba(0,0,0,.18);">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:.95em;line-height:1.3;">${varLabel}</div>
        ${lotInfo ? `<div class="muted" style="font-size:.78em;margin-top:2px;">${lotInfo}</div>` : ''}
      </div>
      <button id="${dk}_btn" onclick="Inventaire.confirmQty('${k}')"
        title="Valider : quantité correcte (${cur})"
        style="flex-shrink:0;background:var(--ok);color:#fff;border:none;border-radius:6px;min-width:48px;height:48px;cursor:pointer;font-size:.88em;font-weight:700;padding:0 8px;white-space:nowrap;${btnOpacity}">
        ${U.icon('check',{size:.85})} ${cur}
      </button>
      <div style="position:relative;flex-shrink:0;">
        <input id="${dk}" type="number" min="0" placeholder="—"
          style="width:92px;height:56px;text-align:center;font-size:1.35em;font-weight:700;border-radius:8px;border:2px solid ${inputBorder};background:var(--fond-carte);color:var(--texte);"
          value="${qty}"
          oninput="Inventaire.setQty('${k}',this.value)" onchange="Inventaire.setQty('${k}',this.value)">
        ${dHtml}
      </div>
    </div>`;
  },

  _prodHTML(p, pool) {
    const rows = (p.variants || []).flatMap(v => {
      const lots = this._lotsOfType(v);
      if (!lots.length) return [];
      const result = [];
      if (lots.length > 1) {
        result.push(`<div style="display:flex;align-items:center;gap:6px;padding:5px 12px;background:var(--th-bg);color:var(--warn);">
          ${U.icon('triangle-alert',{size:.85})}
          <span style="font-size:.82em;font-weight:600;">${U.esc(Pricing.labelVariant(v))} — ${lots.length} lots en stock, renseigner chaque ligne</span>
        </div>`);
      }
      result.push(...lots.map((l, li) => this._lotRowHTML(p, v, l, lots.length, li)));
      return result;
    }).join('');
    if (!rows) return '';
    return `<div style="border:1px solid var(--ligne);border-left:4px solid var(--caramel);border-radius:10px;margin-bottom:12px;overflow:hidden;background:var(--fond-carte);">
      <div style="background:var(--th-bg);padding:9px 14px;border-bottom:1px solid var(--ligne);text-align:center;">
        <span style="font-weight:700;font-size:.92em;text-transform:uppercase;letter-spacing:.04em;color:var(--caramel);">${U.esc(p.name)}</span>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding:3px 10px 0;">
        <span class="muted" style="font-size:.70em;text-align:center;min-width:48px;">Réf.</span>
        <span class="muted" style="font-size:.70em;text-align:center;width:92px;">Inventaire</span>
      </div>
      ${rows}
      <div style="height:5px;"></div>
    </div>`;
  },

  /* ───── Filtres & exclusions ───── */

  _filtersHTML() {
    const f    = this._draft.filters || { q: '', meats: new Set() };
    const exc  = this._draft.excluded || new Set();
    const pool = this._pool();

    const hasPool = p => (p.variants||[]).some(v => (v.lots||[]).some(l => (l[pool]||0) > 0));
    const allMeats = [...new Set(
      Store.state.stockM.filter(hasPool).map(p => p.meatType || 'Autre')
    )].sort((a,b) => a.localeCompare(b,'fr'));

    // Viandes avec lastInv < 30 jours
    const now   = Date.now();
    const MS_30 = 30 * 24 * 3600 * 1000;
    const recentByMeat = {};
    Store.state.stockM.filter(hasPool).forEach(p => {
      const m = p.meatType || 'Autre';
      (p.variants||[]).forEach(v => (v.lots||[]).forEach(l => {
        if (l.lastInv && (!recentByMeat[m] || l.lastInv > recentByMeat[m])) recentByMeat[m] = l.lastInv;
      }));
    });
    const recentMeats = Object.entries(recentByMeat)
      .filter(([,ts]) => (now - ts) < MS_30)
      .sort(([,a],[,b]) => b - a);

    // Boutons filtre viande (hors exclus)
    const meatBtns = allMeats.filter(m => !exc.has(m)).map(m => {
      const on = f.meats.has(m);
      return `<button onclick="Inventaire._toggleMeat('${U.esc(m)}')"
        style="border:1px solid ${on?'var(--caramel)':'var(--ligne)'};border-radius:20px;padding:3px 10px;font-size:.82em;cursor:pointer;white-space:nowrap;background:${on?'var(--caramel)':'var(--fond)'};color:${on?'#fff':'var(--texte)'};">
        ${U.esc(m)}
      </button>`;
    }).join('');

    // Badges exclusion active
    const exclBadges = [...exc].map(m =>
      `<button onclick="Inventaire._toggleExclude('${U.esc(m)}')" title="Réintégrer ${U.esc(m)}"
        style="border:none;border-radius:20px;padding:3px 9px;font-size:.80em;cursor:pointer;white-space:nowrap;background:var(--alerte);color:#fff;">
        ${U.icon('x',{size:.75})} ${U.esc(m)}
      </button>`
    ).join('');

    // Section viandes inventoriées ce mois
    const recentHTML = recentMeats.length ? `
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--ligne);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span class="muted" style="font-size:.78em;white-space:nowrap;">Inventoriés ce mois :</span>
        ${recentMeats.map(([m, ts]) => {
          const d  = new Date(ts);
          const ds = d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit'}) + ' ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
          const exl = exc.has(m);
          return `<button onclick="Inventaire._toggleExclude('${U.esc(m)}')" title="${exl?'Réintégrer':'Exclure'} ${U.esc(m)}"
            style="border:1px solid ${exl?'var(--ok)':'var(--warn)'};border-radius:20px;padding:3px 9px;font-size:.80em;cursor:pointer;white-space:nowrap;background:${exl?'var(--ok)':'transparent'};color:${exl?'#fff':'var(--warn)'};">
            ${exl ? U.icon('check',{size:.75})+' ' : ''} ${U.esc(m)} · ${ds}
          </button>`;
        }).join('')}
      </div>` : '';

    return `<div class="card" style="padding:10px 12px;margin-bottom:10px;">
      <input id="inv-search" type="text" placeholder="Rechercher un produit…" value="${U.esc(f.q)}"
        style="width:100%;box-sizing:border-box;${allMeats.length > 1 ? 'margin-bottom:8px;' : ''}"
        oninput="Inventaire._setQ(this.value);U.refocus('inv-search')">
      ${allMeats.length > 1 ? `<div style="display:flex;gap:5px;flex-wrap:wrap;">${meatBtns}</div>` : ''}
      ${exclBadges ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;"><span class="muted" style="font-size:.78em;">Exclus :</span> ${exclBadges}</div>` : ''}
      ${recentHTML}
    </div>`;
  },

  _historyHTML() {
    const hist = (Store.state.settings.inventoryHistory || []).slice(0, 20);
    if (!hist.length) return '';
    const open = this._secOpen['_hist'] || false;
    const rows = hist.map(h => {
      const d  = new Date(h.date);
      const ds = d.toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'}) + ' à ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
      const typeLabel = h.type === 'qtyEvent' ? 'Événement' : 'Général';
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--ligne);font-size:.85em;flex-wrap:wrap;">
        <span style="white-space:nowrap;font-weight:600;">${ds}</span>
        <span class="badge" style="font-size:.8em;">${typeLabel}</span>
        <span style="flex:1;min-width:0;">${(h.meatTypes||[]).join(', ')}</span>
        <span class="muted" style="white-space:nowrap;">${h.count} ajust.</span>
      </div>`;
    }).join('');
    return `<details class="fold card" style="margin-top:10px;padding:0;" ${open?'open':''} ontoggle="Inventaire._secOpen['_hist']=this.open">
      <summary style="padding:10px 14px;font-weight:700;font-size:.95em;">${U.icon('list',{size:.9})} Historique des inventaires</summary>
      <div style="padding:4px 14px 10px;">${rows}</div>
    </details>`;
  },

  _toggleMeat(meat) {
    if (!this._draft) return;
    const meats = this._draft.filters.meats;
    if (meats.has(meat)) meats.delete(meat); else meats.add(meat);
    this._saveDraft(); this.render();
  },

  _setQ(q) {
    if (!this._draft) return;
    this._draft.filters.q = q;
    this._saveDraft(); this.render();
  },

  _toggleExclude(meat) {
    if (!this._draft) return;
    const exc = this._draft.excluded;
    if (exc.has(meat)) exc.delete(meat);
    else { exc.add(meat); this._draft.filters.meats.delete(meat); }
    this._saveDraft(); this.render();
  },

  _sectionHTML(id, title, inner, count) {
    if (!inner.trim() || !count) return '';
    const open = this._secOpen[id] !== false;
    return `<details class="fold card" ${open?'open':''} style="margin-bottom:10px;padding:0;" ontoggle="Inventaire._secOpen['${id}']=this.open">
      <summary style="font-weight:700;font-size:1.05em;padding:12px 14px;border-radius:var(--radius);">${title} <span class="muted" style="font-weight:400;font-size:.85em;">${count} produit${count>1?'s':''}</span></summary>
      <div style="padding:0 10px 10px;">${inner}</div>
    </details>`;
  },

  _toolbar() {
    const count = this._countUntouched();
    const badge = count > 0
      ? `<span class="badge warn">${U.icon('triangle-alert',{size:.9})} ${count} non renseigné${count>1?'s':''}</span>`
      : `<span class="badge ok">${U.icon('circle-check',{size:.9})} Tout renseigné</span>`;
    return `<div class="card" style="padding:10px 14px;margin-bottom:14px;position:sticky;top:0;z-index:50;background:var(--fond-carte);">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" onclick="Inventaire.close()" style="white-space:nowrap;">← Retour</button>
        <span id="inv-untouched" style="flex:1;text-align:center;">${badge}</span>
        <button class="btn-cta btn-sm" onclick="Inventaire.validate()" style="white-space:nowrap;">${U.icon('clipboard-list',{size:.9})} Valider</button>
      </div>
    </div>`;
  },

  _renderEvent() {
    const locs    = Store.state.settings.inventoryLocations || [];
    const pool    = 'qtyEvent';
    const allLocProds = new Set(locs.flatMap(l => l.products || []));
    const hasEvent    = p => (p.variants || []).some(v => (v.lots || []).some(l => (l[pool] || 0) > 0));
    const unclassed   = Store.state.stockM.filter(p => hasEvent(p) && !allLocProds.has(p.id));

    const sections = locs.map(loc => {
      const prods = (loc.products || []).map(pid => Store.state.stockM.find(p => p.id === pid)).filter(Boolean);
      const inner = prods.map(p => this._prodHTML(p, pool)).join('');
      const count = prods.filter(p => (p.variants||[]).some(v => this._lotsOfType(v).length > 0)).length;
      const typeLabel = loc.type === 'column' ? `Colonne${loc.floors > 1 ? ' ('+loc.floors+' étages)' : ''}` : 'Boîte';
      return this._sectionHTML(loc.id, `${U.esc(loc.name)||'(sans nom)'} <span style="font-size:.8em;font-weight:400;" class="muted">— ${typeLabel}</span>`, inner, count);
    }).join('');

    const unclassedHTML = unclassed.length
      ? this._sectionHTML('_nc', `${U.icon('triangle-alert',{size:.9,tone:'warn'})} Non classés`, unclassed.map(p => this._prodHTML(p, pool)).join(''), unclassed.length)
      : '';

    App.mount(`
      <div class="view-title" style="padding-bottom:4px;">
        <h1 style="font-size:1.3em;">${U.icon('clipboard-list')} Inventaire événement</h1>
      </div>
      ${this._toolbar()}
      <div id="invBody">
        ${sections || '<div class="card empty" style="padding:16px;">Aucun emplacement configuré — <button class="btn btn-ghost btn-sm" onclick="App.go(\'params\')">Paramètres → Emplacements</button></div>'}
        ${unclassedHTML}
        ${!sections && !unclassedHTML ? '<div class="card empty" style="padding:16px;">Aucun stock événement pour le moment.</div>' : ''}
      </div>`);
  },

  _renderGeneral() {
    const pool   = 'qtyGeneral';
    const f      = this._draft.filters || { q: '', meats: new Set() };
    const exc    = this._draft.excluded || new Set();
    const hasGen = p => (p.variants||[]).some(v => (v.lots||[]).some(l => (l[pool]||0) > 0));
    let prods    = Store.state.stockM.filter(hasGen);

    if (exc.size)              prods = prods.filter(p => !exc.has(p.meatType || 'Autre'));
    if (f.meats && f.meats.size) prods = prods.filter(p => f.meats.has(p.meatType || 'Autre'));
    if (f.q && f.q.trim())    prods = prods.filter(p => U.has(p.name, f.q));

    const byMeat = {};
    prods.forEach(p => {
      const m = p.meatType || 'Autre';
      if (!byMeat[m]) byMeat[m] = [];
      byMeat[m].push(p);
    });

    const sections = Object.entries(byMeat).sort(([a],[b]) => a.localeCompare(b,'fr')).map(([meat, ps]) => {
      const inner = ps.map(p => this._prodHTML(p, pool)).join('');
      return this._sectionHTML('gen_' + meat, `${U.icon('beef',{size:.9})} ${U.esc(meat)}`, inner, ps.length);
    }).join('');

    App.mount(`
      <div class="view-title" style="padding-bottom:4px;">
        <h1 style="font-size:1.3em;">${U.icon('clipboard-list')} Inventaire général</h1>
      </div>
      ${this._toolbar()}
      ${this._filtersHTML()}
      <div id="invBody">
        ${sections || '<div class="card empty" style="padding:16px;">Aucun produit ne correspond aux filtres.</div>'}
      </div>
      ${this._historyHTML()}`);
  },

  /* ───── Persistance brouillon (localStorage) ───── */

  _saveDraft() {
    if (!this._draft) { this._clearDraft(); return; }
    try {
      const f = this._draft.filters || { q: '', meats: new Set() };
      localStorage.setItem('touffu_inv_draft', JSON.stringify({
        type: this._draft.type,
        entries: this._draft.entries,
        touched: [...this._draft.touched],
        filters: { q: f.q || '', meats: [...(f.meats || [])] },
        excluded: [...(this._draft.excluded || [])]
      }));
    } catch(e) {}
  },
  _restoreDraft() {
    try {
      const raw = localStorage.getItem('touffu_inv_draft');
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || !d.type) return false;
      this._draft = {
        type: d.type,
        entries: d.entries || {},
        touched: new Set(d.touched || []),
        filters: { q: (d.filters || {}).q || '', meats: new Set((d.filters || {}).meats || []) },
        excluded: new Set(d.excluded || [])
      };
      this._secOpen = {};
      return true;
    } catch(e) { return false; }
  },
  _clearDraft() { try { localStorage.removeItem('touffu_inv_draft'); } catch(e) {} },

  /* ───── Validation d'une ligne (bouton vert) ───── */

  confirmQty(key) {
    if (!this._draft) return;
    const [varId, lotId] = key.split(':');
    const p = Store.state.stockM.find(p => (p.variants||[]).some(v => v.id === varId));
    const v = p ? (p.variants||[]).find(v => v.id === varId) : null;
    const l = v ? (v.lots||[]).find(l => l.id === lotId) : null;
    if (!l) return;
    const cur = l[this._pool()] || 0;
    const inp = document.getElementById(this._domKey(key));
    if (inp) inp.value = cur;
    this.setQty(key, cur);
    const btn = document.getElementById(this._domKey(key) + '_btn');
    if (btn) btn.style.opacity = '.45';
  },

  /* ───── Mise à jour en temps réel (sans re-render) ───── */

  setQty(key, val) {
    if (!this._draft) return;
    const qty = Math.max(0, parseFloat(val) || 0);
    this._draft.entries[key] = qty;
    this._draft.touched.add(key);

    // Delta inline
    const dk = this._domKey(key);
    const [varId, lotId] = key.split(':');
    const p = Store.state.stockM.find(p => (p.variants||[]).some(v => v.id === varId));
    const v = p ? (p.variants||[]).find(v => v.id === varId) : null;
    const l = v ? (v.lots||[]).find(l => l.id === lotId) : null;
    if (l) {
      const pool  = this._pool();
      const cur   = l[pool] || 0;
      const delta = qty - cur;
      const dEl = document.getElementById(dk + '_d');
      if (dEl) {
        if (delta !== 0) {
          dEl.textContent = (delta > 0 ? '+' : '') + delta;
          dEl.style.color = delta > 0 ? 'var(--ok)' : 'var(--alerte)';
          dEl.style.display = '';
        } else {
          dEl.textContent = '';
          dEl.style.display = 'none';
        }
      }
    }

    // Badge non renseigné
    const count = this._countUntouched();
    const badge = document.getElementById('inv-untouched');
    if (badge) {
      badge.innerHTML = count > 0
        ? `<span class="badge warn" style="font-size:.85em;">${U.icon('triangle-alert',{size:.85})} ${count} non renseigné${count>1?'s':''}</span>`
        : `<span class="badge ok" style="font-size:.85em;">${U.icon('circle-check',{size:.85})} Tout renseigné</span>`;
    }
    this._saveDraft();
  },

  _countUntouched() {
    if (!this._draft) return 0;
    const pool = this._pool();
    let count = 0;
    Store.state.stockM.forEach(p => {
      (p.variants || []).forEach(v => {
        (v.lots || []).forEach(l => {
          if ((l[pool] || 0) > 0 && !this._draft.touched.has(this._lotKey(v.id, l.id))) count++;
        });
      });
    });
    return count;
  },

  /* ───── Validation en bloc ───── */

  validate() {
    if (!this._draft) return;
    const pool      = this._pool();
    const untouched = this._countUntouched();

    // Calculer les écarts
    const changes = [];
    for (const [key, qty] of Object.entries(this._draft.entries)) {
      const [varId, lotId] = key.split(':');
      const p = Store.state.stockM.find(p => (p.variants||[]).some(v => v.id === varId));
      const v = p ? (p.variants||[]).find(v => v.id === varId) : null;
      const l = v ? (v.lots||[]).find(l => l.id === lotId) : null;
      if (!l || !v || !p) continue;
      const cur   = l[pool] || 0;
      const delta = qty - cur;
      if (delta === 0) continue;
      changes.push({ p, v, l, cur, qty, delta });
    }

    const changesHTML = changes.length
      ? `<div style="max-height:280px;overflow-y:auto;border:1px solid var(--ligne);border-radius:6px;padding:6px 10px;">
          ${changes.map(c => {
            const sign  = c.delta > 0 ? '+' : '';
            const color = c.delta > 0 ? 'var(--ok)' : 'var(--alerte)';
            return `<div class="frow" style="gap:6px;padding:3px 0;border-bottom:1px solid var(--ligne);font-size:.88em;">
              <span style="flex:1;">${U.esc(c.p.name)} · ${U.esc(Pricing.labelVariant(c.v))}${c.l.lotNumber?' <span class="muted">(lot '+U.esc(c.l.lotNumber)+')</span>':''}</span>
              <span class="muted">${c.cur} → ${c.qty}</span>
              <span style="color:${color};font-weight:600;min-width:38px;text-align:right;">${sign}${c.delta}</span>
            </div>`;
          }).join('')}
        </div>`
      : '<p class="muted" style="margin:8px 0;">Aucun écart — les quantités correspondent au stock actuel.</p>';

    const untouchedHTML = untouched > 0
      ? `<div class="badge warn" style="margin-top:10px;display:block;font-size:.85em;padding:6px 10px;">${U.icon('triangle-alert',{size:.85})} ${untouched} ligne${untouched>1?'s':''} non renseignée${untouched>1?'s':''} — elles ne seront pas modifiées.</div>`
      : '';

    const typeLabel = this._draft.type === 'event' ? 'Stock événement' : 'Stock général';

    U.modal({
      title: 'Valider l\'inventaire',
      wide: true,
      body: `<p class="muted" style="margin-bottom:10px;">${typeLabel} · <b>${changes.length}</b> ajustement${changes.length!==1?'s':''} à appliquer</p>
        ${changesHTML}${untouchedHTML}`,
      okLabel: changes.length ? 'Confirmer et mettre à jour' : 'Fermer',
      onOk: () => {
        if (changes.length) this._applyChanges(changes, pool);
        else U.closeModal();
      }
    });
  },

  _applyChanges(changes, pool) {
    const now = Date.now();
    changes.forEach(c => { c.l[pool] = c.qty; c.l.lastInv = now; });
    // Historique
    const S = Store.state.settings;
    if (!S.inventoryHistory) S.inventoryHistory = [];
    const meatTypes = [...new Set(changes.map(c => c.p.meatType || 'Autre'))];
    S.inventoryHistory.unshift({ date: now, type: pool, meatTypes, count: changes.length });
    if (S.inventoryHistory.length > 20) S.inventoryHistory.length = 20;
    Store.save('stockM');
    Store.save('settings');
    Store.log('inventaire', `Inventaire ${pool === 'qtyEvent' ? 'événement' : 'général'} — ${changes.length} ajustement${changes.length>1?'s':''}`, null);
    this._clearDraft();
    U.closeModal();
    U.toast(`Inventaire appliqué — ${changes.length} lot${changes.length>1?'s':''} mis à jour.`);
    this.close();
  },

  close() {
    this._draft = null;
    this._clearDraft();
    Stock.render();
  }
};
