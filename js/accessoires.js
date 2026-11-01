/* ============================================================
   ACCESSOIRES — colliers, laisses, longes (non périssable)
   Matières : rouleaux de sangle enduite (au mètre), bouclerie
   (mousquetons, rivets… à la pièce). Fiche accessoire = nomen-
   clature matières + temps de main d'œuvre + coefficient.
   Fabrication → consomme les matières, ajoute au stock fini.
   ============================================================
   FAMILLES (coût moyen) :
   Sangles groupées par largeur (variant) → "Sangle 20mm"
   Bouclerie/autre groupés par produit   → "Mousqueton"
   BOM stocke familyKey OU materialId (rétrocompat).
   ============================================================ */
const Accessoires = {
  _strapRecalced: false,
  _bomOpen: -1,
  _bomQ: {},
  _widthsOpen: false,
  _accOpen: {},
  focusId: null,  // fiche à ouvrir/faire défiler (lien direct #/accessoires/<id>)
  setAccOpen(id, open) { this._accOpen[id] = open; },
  _fabOpen: {},
  setFabOpen(id, open) { this._fabOpen[id] = open; },
  accSort: 'cat', accSortDir: 'asc',
  accQ: '', accCatFilter: '', accWidthFilter: '', accBicolorFilter: '',
  setAccQ(v) { this.accQ = v; this.renderProducts(); U.refocus('acc_q'); },
  setAccCatFilter(v) { this.accCatFilter = v; this.renderProducts(); },
  setAccWidthFilter(v) { this.accWidthFilter = v; this.renderProducts(); },
  setAccBicolorFilter(v) { this.accBicolorFilter = v; this.renderProducts(); },
  /* Tri d'accessoires (Antho 2026-10-14) : nom SANS la longueur finale (« Laisse Classique — 1.2m » et « — 5m » = même nom), puis longueur du produit fini (1,2 m avant 5 m), puis largeur de sangle (16 mm avant 20 mm). */
  /* Taille S / M / L / XL (`a.sizeLabel`, Antho 2026-11-01) : écrite à la FIN du nom (avant le suffixe de personnalisation) « … — Taille L » et dans le SKU ; les tailles d'un même modèle restent dans la même famille (le nom de base la retire). */
  _SIZE_RX: /\s*(?:[—–-]\s*)?taille\s+[A-Za-z0-9]{1,4}\s*$/i,   // « … — Taille L » ou « … Taille L » (sans tiret)
  _stripSize(name) { let n = String(name || ''); while (this._SIZE_RX.test(n)) n = n.replace(this._SIZE_RX, ''); return n.trim(); },
  _baseName(a) { return this._stripSize(String(a.name || '').replace(this._PERSO_RX, '')).replace(/\s*[—–-]?\s*\d+(?:[.,]\d+)?\s*m\s*$/i, '').trim(); },
  _persoRank(a) { return ((a.uv !== undefined ? !!a.uv : U.num(a.uvMl) > 0) ? 1 : 0) + (a.laser ? 2 : 0) + (a.theme ? 4 : 0); },   // bits : 1 = impression UV, 2 = laser, 4 = création de thème
  _lenOf(a) { const l = U.num(a.productLength); if (l > 0) return l; const m = String(a.name || '').match(/(\d+(?:[.,]\d+)?)\s*m\s*$/i); return m ? parseFloat(m[1].replace(',', '.')) : 0; },
  _widthNum(a) { return parseFloat(String(a.mainWidth || (a.strapWidths || [])[0] || '').replace(',', '.')) || 0; },
  /* Rang d'une taille (XS < S < M < L < XL…) : les tailles d'un même modèle se rangent dans cet ordre, avant la longueur */
  _sizeRank(a) { const i = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL'].indexOf(a.sizeLabel); return i < 0 ? 99 : i; },
  _cmpAcc(a, b) { return U.sortFr(this._baseName(a), this._baseName(b)) || (this._sizeRank(a) - this._sizeRank(b)) || (this._lenOf(a) - this._lenOf(b)) || (this._persoRank(a) - this._persoRank(b)) || (this._widthNum(a) - this._widthNum(b)) || U.sortFr(a.name, b.name); },

  /* ───── FAMILLES D'ACCESSOIRES (Antho 2026-10-14) ─────
     Un PRODUIT (famille) = même nom + même catégorie + même largeur de sangle principale ; ses déclinaisons = les longueurs (et la personnalisation UV / laser).
     Chaque déclinaison reste une fiche à part entière (même id, SKU, stock, historique de ventes : rien ne casse) ; la famille se lit sur les fiches :
     a.groupId, a.groupName (nom de la famille), a.groupCoeff (coefficient commun). Une fiche « suit » la famille si son coefficient = le commun et qu'elle n'a pas de prix forcé ;
     sinon elle a un réglage PROPRE (badge « propre »). Tout changement de famille = un seul « Annuler » (restoreBatch sur les fiches). */
  _grpOpen: {},
  setGrpOpen(gid, v) { this._grpOpen[gid] = !!v; },
  _grpMembers(gid) { return Store.state.catalogA.filter(x => x.groupId === gid).sort((a, b) => (this._lenOf(a) - this._lenOf(b)) || (this._persoRank(a) - this._persoRank(b)) || U.sortFr(a.name, b.name)); },
  _follows(a) { const gc = U.num(a.groupCoeff); return gc > 0 && Math.abs(U.num(a.coefficient) - gc) < 0.0005 && !(U.num(a.priceTTCManual) > 0); },
  _widthOf(a) { return a.mainWidth || (a.strapWidths || [])[0] || ''; },
  /* Nom d'une famille = même logique que les fiches : catégorie (type) + largeur de sangle principale + personnalisation (UV / laser) → « Longe 16mm », « Longe 16mm — Personnalisation UV ». Si le nom de la fiche précise un modèle (« Laisse Classique — 5m »), il est gardé : « Laisse Classique 20mm ». */
  _familyName(a) {
    let base = this._baseName(a); const cat = String(a.category || '').trim();
    if (cat && !U.normSearch(base).includes(U.normSearch(cat))) base = (cat + ' ' + base).trim();
    const r = this._persoRank(a), w = this._widthOf(a);
    return this._persoName((base + (w ? ' ' + w : '')).trim(), !!(r & 1), !!(r & 2), !!(r & 4));
  },
  /* Applique `fn` à des fiches avec UN seul « Annuler » ; renvoie l'entrée de journal. */
  _grpTouch(list, fn, label) {
    const snaps = list.map(a => Store.snapshot('catalogA', a));
    list.forEach(fn);
    const entry = Store.log('accessoires', label, { type: 'restoreBatch', data: snaps });
    Store.save('catalogA'); App.rerender();
    return entry;
  },
  /* Tout accessoire fabriqué est RANGÉ dans un produit (famille), même avec une seule variante (Antho 2026-10-18 : plus de fiche « hors des clous », plus de Regrouper / Dégrouper).
     Appelé à l'affichage et à la création d'une fiche. Une fiche pas rangée rejoint la famille de même clé (même nom sans longueur + catégorie + largeur + UV / laser), sinon elle crée la sienne
     (nom = catégorie + largeur : « poignée 20mm »). Identifiants DÉTERMINISTES (« g » + id de la 1re fiche) : refaire le calcul donne toujours le même résultat, même sur un autre appareil. */
  _famKey(a) { return U.normSearch(this._baseName(a)) + '|' + U.normSearch(a.category || '') + '|' + this._widthOf(a) + '|' + this._persoRank(a); },
  ensureFamilies() {
    const all = this.crafted(), loose = all.filter(a => !a.groupId);
    let changed = false;
    if (loose.length) {
      const fam = new Map(); all.filter(a => a.groupId).forEach(a => { const k = this._famKey(a); if (!fam.has(k)) fam.set(k, { gid: a.groupId, name: a.groupName || this._familyName(a), gc: U.num(a.groupCoeff) }); });
      const byKey = new Map(); loose.forEach(a => { const k = this._famKey(a); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(a); });
      byKey.forEach((mem, k) => {
        mem.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
        let f = fam.get(k);
        if (!f) f = { gid: 'g' + mem[0].id, name: this._familyName(mem[0]), gc: 0 };
        mem.forEach(a => { a.groupId = f.gid; a.groupName = f.name; a.groupCoeff = f.gc || Math.round((U.num(a.coefficient) || 2) * 100) / 100; });
      });
      changed = true;
    }
    // Produit à UNE seule variante : son coefficient EST le coefficient commun (Antho 2026-10-18). Quand son prix TTC est tapé (↺), le coefficient enregistré est remis d'équerre avec ce prix
    // (comme `_applyTtc`), sinon « ↺ Revenir au calcul auto » repartirait d'un vieux coefficient et le coefficient commun afficherait autre chose que la fiche.
    const cnt = {}; all.forEach(a => { if (a.groupId) cnt[a.groupId] = (cnt[a.groupId] || 0) + 1; });
    all.forEach(a => {
      if (!a.groupId || cnt[a.groupId] !== 1) return;
      const c = Pricing.accCalc(a);
      let coef = U.num(a.coefficient) || 2;
      if (c.priceFixed && c.cost > 0) {
        coef = Math.round((c.priceTTC - U.num(c.persoSup)) / (1 + U.num(Store.state.settings.vatRate) / 100) / c.cost * 1e6) / 1e6;
        if (coef > 0 && Math.abs(U.num(a.coefficient) - coef) > 1e-6) { a.coefficient = coef; changed = true; }
      }
      const g = Math.round(coef * 100) / 100;
      if (g > 0 && Math.abs(U.num(a.groupCoeff) - g) > 0.0049) { a.groupCoeff = g; changed = true; }
    });
    if (changed) Store.save('catalogA');
    return changed;
  },
  renameGroup(gid, val) {
    const name = String(val || '').trim(), mem = this._grpMembers(gid); if (!name || !mem.length) return;
    this._grpOpen[gid] = true;
    this._grpTouch(mem, a => { a.groupName = name; }, 'Famille renommée — ' + name);
  },
  /* Coefficient commun : met à jour les longueurs qui le SUIVENT ; celles à réglage propre sont gardées (badge « propre », bouton « Aligner »). */
  setGroupCoeff(gid, val) {
    const v = Math.round(U.num(val) * 100) / 100, mem = this._grpMembers(gid); if (!(v > 0) || !mem.length) return;
    let upd = 0, kept = 0;
    this._grpOpen[gid] = true;
    const entry = this._grpTouch(mem, a => { if (this._follows(a) || mem.length === 1) { a.coefficient = v; a.priceTTCManual = ''; upd++; } else kept++; a.groupCoeff = v; }, `Coefficient commun ${v} — ${mem[0].groupName || ''}`);
    U.toast(`Coefficient commun ${v} : ${upd} longueur${upd > 1 ? 's' : ''} mise${upd > 1 ? 's' : ''} à jour${kept ? `, ${kept} gardent leur réglage propre` : ''}.`, false, entry.id);
  },
  async alignGroup(gid) {
    const mem = this._grpMembers(gid).filter(a => !this._follows(a)); if (!mem.length) return;
    const gc = U.num(mem[0].groupCoeff);
    if (!await U.confirm(`Mettre ${mem.length} longueur${mem.length > 1 ? 's' : ''} au coefficient commun ${gc} ? Leur coefficient / prix propre est remplacé et leur prix TTC est recalculé.`, { title: '↻ Aligner la famille', okLabel: 'Aligner' })) return;
    this._grpOpen[gid] = true;
    const entry = this._grpTouch(mem, a => { a.coefficient = gc; a.priceTTCManual = ''; }, `Famille alignée sur le coefficient ${gc} (${mem.length})`);
    U.toast('Famille alignée.', false, entry.id);
  },
  /* « ＋ Ajouter une longueur » : même fenêtre que « Sur mesure », à partir d'une fiche de la famille ; la nouvelle fiche suit le coefficient commun. */
  addLength(gid) {
    const mem = this._grpMembers(gid); if (!mem.length) return;
    const ref = mem.find(a => !this._persoRank(a)) || mem[0];
    this._grpOpen[gid] = true;
    if (this.isSizedFam(gid)) { this.addSize(gid); return; }
    this.customLength(ref.id, true);
  },
  /* Famille de colliers (catégorie « Collier » ou taille déjà choisie sur une fiche) : on ajoute des TAILLES (S, M, L, XL), pas des longueurs. */
  isSizedFam(gid) { const mem = this._grpMembers(gid); return !!mem.length && (mem.some(a => a.sizeLabel) || /collier/i.test(mem[0].category || '')); },
  /* « ＋ Ajouter une taille » (Antho 2026-11-01) : crée la taille suivante qui n'existe pas encore (S, puis M, puis L, puis XL) en copiant la plus grande taille de la famille ;
     nom « … — Taille M » et SKU automatiques, stock à 0, coefficient commun. La fiche s'ouvre ensuite pour régler SES longueurs (tour de cou de référence, X, fourchette). */
  addSize(gid) {
    const mem = this._grpMembers(gid); if (!mem.length) return;
    const next = ['S', 'M', 'L', 'XL'].find(t => !mem.some(a => a.sizeLabel === t));
    if (!next) { U.toast('Les tailles S, M, L et XL existent déjà dans cette famille.', true); return; }
    const plain = mem.filter(a => !this._persoRank(a)), src = plain.filter(a => a.sizeLabel).sort((x, y) => this._sizeRank(y) - this._sizeRank(x))[0] || plain[0] || mem[0];
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = U.uid(); copy.stockGeneral = 0; copy.stockEvent = 0;   // une nouvelle taille démarre sans stock
    if (copy.groupId && U.num(copy.groupCoeff) > 0) { copy.coefficient = copy.groupCoeff; copy.priceTTCManual = ''; }   // elle suit le coefficient commun de la famille
    copy.sizeLabel = next; delete copy.sizeRange;   // la fourchette de tour de cou de la taille copiée ne vaut pas pour la nouvelle
    copy.name = this._baseName(src) + ' — Taille ' + next;
    { const base = Pricing.autoSkuAcc(copy), taken = this._takenSkus(copy.id); let sku = base, n = 1; while (base && taken.has(sku)) { n++; sku = base + '-' + n; } copy.sku = base ? sku : ''; }
    this._grpOpen[gid] = true;
    Store.state.catalogA.push(copy);
    const entry = Store.log('accessoires', 'Taille ajoutée — ' + copy.name, { type: 'restoreBatch', data: [{ domain: 'catalogA', id: copy.id, before: null }] });
    Store.save('catalogA'); App.rerender();
    U.toast(`Taille ${next} ajoutée : règle ses longueurs (tour de cou, X…).`, false, entry.id);
    setTimeout(() => this.editAcc(copy.id), 60);
  },
  /* SKU de la famille : TYPE-LARGEUR-NOM-LONGUEUR[-UV][-LASER] pour chaque longueur (Pricing.autoSkuAcc), à valider ligne par ligne. */
  groupSkus(gid) {
    const mem = this._grpMembers(gid); if (!mem.length) return;
    const taken = new Set(); Store.state.catalogA.filter(x => !mem.includes(x)).forEach(x => { if (x.sku) taken.add(String(x.sku).trim().toUpperCase()); });
    Store.state.stockM.forEach(p => (p.variants || []).forEach(v => { if (v.sku) taken.add(String(v.sku).trim().toUpperCase()); }));
    Store.state.catalogM.forEach(p => (p.variants || []).forEach(v => { if (v.sku) taken.add(String(v.sku).trim().toUpperCase()); }));
    const rows = mem.map(a => { const base = Pricing.autoSkuAcc(a); let sku = base, n = 1; while (base && taken.has(sku.toUpperCase())) { n++; sku = base + '-' + n; } if (sku) taken.add(sku.toUpperCase()); return { a, now: String(a.sku || ''), next: sku }; });
    this._skuRows = rows;
    const changed = rows.filter(r => r.next && r.next !== r.now).length;
    U.modal({
      title: '✨ SKU de la famille — ' + U.esc(mem[0].groupName || ''), okLabel: 'Appliquer',
      body: `<p class="muted" style="margin-top:0;">Format <b>TYPE-LARGEUR-NOM-LONGUEUR</b> (+ -UV / -LASER). Coche les lignes à changer. ⚠️ Un SKU modifié doit l'être aussi dans SumUp et sur le site si tu les utilises.</p>
        <div class="table-wrap"><table><thead><tr><th></th><th>Fiche</th><th>SKU actuel</th><th>SKU proposé</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td><input type="checkbox" id="sk_${i}" ${r.next && r.next !== r.now ? 'checked' : ''} ${r.next && r.next !== r.now ? '' : 'disabled'} style="width:auto;"></td><td>${U.esc(r.a.name)}</td><td class="muted">${U.esc(r.now || '—')}</td><td><b>${U.esc(r.next || '—')}</b>${r.next === r.now ? ' <span class="muted">(déjà bon)</span>' : ''}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted">${changed ? changed + ' SKU à mettre à jour.' : 'Tous les SKU de la famille sont déjà au bon format.'}</p>`,
      onOk: () => {
        const sel = rows.filter((r, i) => { const c = document.getElementById('sk_' + i); return c && c.checked && !c.disabled; });
        if (!sel.length) { U.toast('Rien de coché.', true); return false; }
        const entry = this._grpTouch(sel.map(r => r.a), a => { a.sku = sel.find(r => r.a === a).next; }, `SKU de la famille mis à jour — ${mem[0].groupName || ''} (${sel.length})`);
        U.closeModal(); U.toast(`${sel.length} SKU mis à jour.`, false, entry.id);
      }
    });
  },
  groupCard(shown) {
    const first = shown[0], gid = first.groupId, total = Store.state.catalogA.filter(x => x.groupId === gid).length;
    const mem = shown.slice().sort((a, b) => (this._sizeRank(a) - this._sizeRank(b)) || (this._lenOf(a) - this._lenOf(b)) || (this._persoRank(a) - this._persoRank(b)) || U.sortFr(a.name, b.name));
    const calcs = mem.map(a => Pricing.accCalc(a));
    const rng = (arr, f) => { const lo = Math.min(...arr), hi = Math.max(...arr); return Math.abs(hi - lo) < 0.005 ? f(lo) : f(lo) + ' – ' + f(hi); };
    const widths = [...new Set(mem.map(a => this._widthOf(a)).filter(Boolean))];
    const sizes = [...mem].sort((x, y) => this._sizeRank(x) - this._sizeRank(y)).map(a => a.sizeLabel).filter((t, i, arr) => t && arr.indexOf(t) === i);
    const nCrit = calcs.filter(c => c.critical).length, nOwn = total > 1 ? this._grpMembers(gid).filter(a => !this._follows(a)).length : 0;
    const gc = U.num(first.groupCoeff), open = !!this._grpOpen[gid], name = first.groupName || this._familyName(first);
    const notes = first.groupNotes ? `<div class="muted" style="font-size:.85rem;margin:0 0 10px;white-space:pre-line;">📝 ${U.esc(first.groupNotes)}</div>` : '';
    return `<details class="fold prod-fold acc-fold acc-group" id="grp-${gid}" ${open ? 'open' : ''} ontoggle="Accessoires.setGrpOpen('${gid}',this.open)">
      <summary>
        <span><b>${U.esc(name)}</b></span>
        <span class="type-col acc-size">${sizes.map(t => `<span class="badge info">${U.esc(t)}</span>`).join('') || '<span class="muted">—</span>'}</span>
        <span class="type-col">${widths.map(w => `<span class="badge">${U.esc(w)}</span>`).join(' ') || '<span class="muted">—</span>'}</span>
        <span class="type-col"><span class="badge info">${U.esc(first.category || '')}</span></span>
        <span class="type-col"><span class="badge info">${mem.length === total ? total : mem.length + ' / ' + total} longueur${total > 1 ? 's' : ''}</span></span>
        <span class="type-col">${nCrit ? `<span class="badge bad">${nCrit} coeff critique</span>` : ''}</span>
        <span class="meta right sensitive" style="white-space:nowrap;">${rng(calcs.map(c => c.cost), U.eur)}</span>
        <span class="meta right" style="white-space:nowrap;"><b>${rng(calcs.map(c => c.priceTTC), U.eur)}</b></span>
      </summary>
      <div class="fold-body">
        ${notes}
        <div class="card" style="padding:10px 14px;margin:0 0 10px;">
          <div class="frow" style="gap:10px;align-items:flex-end;flex-wrap:wrap;">
            <div class="fg mb0" style="flex:0 0 170px;"><label>Coefficient commun ${U.info("Le coefficient de toute la famille : change-le ici et toutes les longueurs qui le suivent se recalculent (prix TTC arrondi comme d'habitude). Une longueur dont tu as tapé le prix ou le coefficient garde son réglage (badge « propre ») : « Aligner » la remet au commun.")}</label><input type="number" step="0.01" min="0.01" value="${gc ? Math.round(gc * 100) / 100 : ''}" onchange="Accessoires.setGroupCoeff('${gid}',this.value)"></div>
            ${nOwn ? `<button class="btn-ghost btn-sm fit" onclick="Accessoires.alignGroup('${gid}')" title="Remettre les ${nOwn} longueur(s) à réglage propre au coefficient commun">↻ Aligner (${nOwn})</button>` : '<span class="muted fit" style="font-size:.82rem;line-height:38px;white-space:nowrap;">✓ Toutes les longueurs suivent ce coefficient</span>'}
          </div>
        </div>
        ${mem.map(a => this.accCard(a)).join('')}
        <div class="mt">${U.seg([
          { l: this.isSizedFam(gid) ? '＋ Ajouter une taille' : '＋ Ajouter une longueur', tone: 'ok', js: `Accessoires.addLength('${gid}')` },
          ...(this.isSizedFam(gid) ? [{ l: '📏 Calculer', js: `Accessoires.calcFamily('${gid}')` }] : []),
          { l: 'Modifier', js: `Accessoires.editGroup('${gid}')` },
          { l: '✨ SKU', js: `Accessoires.groupSkus('${gid}')` },
          { l: '📋 Dupliquer', js: `Accessoires.duplicateGroup('${gid}')` },
          { l: 'Supprimer', tone: 'danger', js: `Accessoires.deleteGroup('${gid}')` }
        ], { full: true, scroll: true })}</div>
      </div>
    </details>`;
  },
  /* Bloc « Personnalisation » commun aux fenêtres de famille : Impression UV (ml) · Création thème UV · Gravure laser (min). Un thème = impression UV avec visuel créé : il coche l'impression UV. */
  _persoBlockHTML(p, f, onchange) {
    const r = this._persoRank(f), lab = 'display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;font-size:.9rem;margin:0;white-space:nowrap;';
    const box = (id, on, txt, which) => `<label style="${lab}"><input id="${p}_${id}" type="checkbox" style="width:16px;height:16px;" ${on ? 'checked' : ''} onchange="Accessoires._persoFam('${p}','${which}');${onchange}"> ${txt}</label>`;
    return `<div style="display:flex;align-items:center;gap:10px 22px;flex-wrap:wrap;min-height:40px;">
        <span style="display:flex;align-items:center;gap:10px;">${box('uv', !!(r & 1), 'Impression UV', 'uv')}<input id="${p}_uvml" type="number" step="0.1" min="0" value="${U.num(f.uvMl) || ''}" placeholder="ml d'encre" style="width:120px;margin:0;"></span>
        <span style="display:flex;align-items:center;gap:10px;">${box('th', !!(r & 4), 'Création thème UV', 'th')}</span>
        <span style="display:flex;align-items:center;gap:10px;">${box('la', !!(r & 2), 'Gravure laser', 'la')}<input id="${p}_lamin" type="number" step="0.5" min="0" value="${U.num(f.laserMin) || ''}" placeholder="minutes" style="width:110px;margin:0;"></span></div>`;
  },
  _persoFam(p, which) {   // un thème coche l'impression UV ; décocher l'impression UV décoche le thème
    const uv = document.getElementById(p + '_uv'), th = document.getElementById(p + '_th');
    if (which === 'th' && th && th.checked && uv) uv.checked = true;
    if (which === 'uv' && uv && !uv.checked && th) th.checked = false;
  },
  _persoRead(p) { const th = U.chk(p + '_th'); return { theme: th, uv: U.chk(p + '_uv') || th, laser: U.chk(p + '_la'), uvMl: U.numVal(p + '_uvml'), laMin: U.numVal(p + '_lamin') }; },
  /* « Modifier » une famille : nom, catégorie (appliquée à toutes les longueurs), coefficient commun, notes. */
  editGroup(gid) {
    const mem = this._grpMembers(gid); if (!mem.length) return;
    const f = mem[0], cats = (Store.state.settings.accCategories || []).slice().sort(U.sortFr), w0 = this._widthOf(f);
    if (f.category && !cats.includes(f.category)) cats.push(f.category);
    const ws = [...new Set([w0, ...(Store.state.settings.widths || [])].filter(Boolean))].sort((a, b) => parseFloat(a) - parseFloat(b));
    const r0 = this._persoRank(f), uv0 = !!(r0 & 1), la0 = !!(r0 & 2), th0 = !!(r0 & 4);
    this._gmW0 = w0; this._gmCur = w0;
    const nw = 'white-space:nowrap;';
    U.modal({
      title: '✏️ Modifier la famille — ' + U.esc(f.groupName || ''), okLabel: 'Enregistrer',
      body: `<div class="frow" style="align-items:flex-start;">
          <div class="fg" style="flex:1 1 150px;min-width:0;"><label style="${nw}">Nom du produit</label><input id="gm_name" value="${U.esc(f.groupName || this._familyName(f))}"></div>
          <div class="fg" style="flex:0 0 130px;min-width:0;"><label style="${nw}">Catégorie ${U.info('Appliquée à toutes les longueurs de la famille ; leurs SKU sont mis à jour.')}</label><select id="gm_cat">${cats.map(c => `<option ${c === f.category ? 'selected' : ''}>${U.esc(c)}</option>`).join('')}</select></div>
          <div class="fg" style="flex:0 0 100px;min-width:0;"><label style="${nw}">Largeur ${U.info("Change la largeur de sangle de TOUTES les longueurs : les sangles de chaque nomenclature passent à la nouvelle largeur, les coûts se recalculent, les SKU sont mis à jour. Tu n'as plus qu'à vérifier les prix.")}</label><select id="gm_w" onchange="Accessoires._gmName()">${ws.map(w => `<option ${w === w0 ? 'selected' : ''}>${U.esc(w)}</option>`).join('')}</select></div>
          <div class="fg" style="flex:0 0 115px;min-width:0;"><label style="${nw}">Coeff. commun</label><input id="gm_coef" type="number" step="0.01" min="0.01" value="${U.num(f.groupCoeff) ? Math.round(U.num(f.groupCoeff) * 100) / 100 : ''}"></div></div>
        <div class="fg"><label>🎨 Personnalisation ${U.info("Coche l'impression UV et / ou la gravure laser : elle est ajoutée au nom et au SKU de TOUTES les longueurs de la famille, avec son coût (ml d'encre / minutes). Décoche pour la retirer partout.")}</label>
          ${this._persoBlockHTML('gm', f, 'Accessoires._gmName()')}</div>
        <div class="fg"><label>Notes sur ce produit (optionnel)</label><textarea id="gm_notes" rows="3" placeholder="ex : modèle éducation, mousqueton laiton, à proposer avec la poignée…" style="width:100%;resize:vertical;">${U.esc(f.groupNotes || '')}</textarea></div>
        <p class="muted">${mem.length} longueur${mem.length > 1 ? 's' : ''} dans cette famille.</p>`,
      onOk: () => {
        const name = U.val('gm_name').trim(); if (!name) { U.toast('Nom obligatoire', true); return false; }
        const cat = U.val('gm_cat'), w1 = U.val('gm_w') || w0, v = Math.round(U.numVal('gm_coef') * 100) / 100, notes = U.val('gm_notes').trim();
        const coefChanged = v > 0 && Math.abs(v - U.num(f.groupCoeff)) > 0.0049;
        const { uv: uv1, laser: la1, theme: th1, uvMl, laMin } = this._persoRead('gm');
        const persoChanged = uv1 !== uv0 || la1 !== la0 || th1 !== th0, widthChanged = w1 !== w0, catChanged = !!cat && cat !== f.category;
        const amountChanged = (uv1 && Math.abs(uvMl - U.num(f.uvMl)) > 0.0001) || (la1 && Math.abs(laMin - U.num(f.laserMin)) > 0.0001);
        const skuChange = persoChanged || widthChanged || catChanged;   // le SKU contient le type, la largeur et la personnalisation
        const taken = new Set(); let missing = 0;   // SKU déjà pris ailleurs (hors famille), + ceux attribués ici
        if (skuChange) {
          const ids = new Set(mem.map(a => a.id)); const add = x => { x = String(x || '').trim().toUpperCase(); if (x) taken.add(x); };
          Store.state.catalogA.forEach(x => { if (!ids.has(x.id)) add(x.sku); });
          Store.state.stockM.forEach(p => (p.variants || []).forEach(x => add(x.sku))); Store.state.catalogM.forEach(p => (p.variants || []).forEach(x => add(x.sku)));
        }
        const entry = this._grpTouch(mem, a => {
          if (coefChanged && this._follows(a)) { a.coefficient = v; a.priceTTCManual = ''; }
          if (coefChanged) a.groupCoeff = v;
          a.groupName = name; if (cat) a.category = cat;
          if (notes) a.groupNotes = notes; else delete a.groupNotes;
          if (widthChanged) {   // sangles et pièces à la taille de chaque nomenclature : nouvelle largeur ; coûts recalculés
            a.strapWidths = (a.strapWidths || []).map(w => w === w0 ? w1 : w); a.mainWidth = w1;
            (a.bom || []).forEach(l => { if (l.familyKey && l.familyKey.endsWith(':' + w0)) { l.familyKey = l.familyKey.slice(0, -w0.length) + w1; if (!this.families().some(x => x.key === l.familyKey)) missing++; } });
            if (a.name.includes(w0)) a.name = a.name.replace(w0, w1);
            this._autoStrap(a);
          }
          if (persoChanged || amountChanged) { a.uv = uv1; a.uvMl = uv1 ? uvMl : 0; a.laser = la1; a.laserMin = la1 ? laMin : 0; if (th1) a.theme = true; else delete a.theme; }
          if (persoChanged) a.name = this._persoName(a.name, uv1, la1, th1);
          if (skuChange) { const base = Pricing.autoSkuAcc(a); let sku = base, n = 1; while (base && taken.has(sku.toUpperCase())) { n++; sku = base + '-' + n; } if (sku) taken.add(sku.toUpperCase()); a.sku = base ? sku : a.sku; }
        }, 'Famille modifiée — ' + name);
        this._grpOpen[gid] = true; U.closeModal();
        U.toast('Famille enregistrée.' + (skuChange ? ' SKU mis à jour.' : '') + (missing ? ` ⚠️ ${missing} ligne(s) de sangle sans référence en ${w1} dans le stock : coût à vérifier.` : ''), missing > 0, entry.id);
      }
    });
  },
  /* Nom proposé dans « Modifier la famille » : suit la largeur et les cases UV / laser (« Longe 16mm — Personnalisation UV »). */
  _gmName() {
    const el = document.getElementById('gm_name'); if (!el) return;
    let base = el.value.replace(this._PERSO_RX, '').trim(); const w1 = U.val('gm_w'), cur = this._gmCur;
    if (cur && w1 && base.includes(cur)) base = base.replace(cur, w1);
    this._gmCur = w1 || cur;
    const p = this._persoRead('gm'); el.value = this._persoName(base, p.uv, p.laser, p.theme);
  },
  /* « Dupliquer » une famille : copie toutes les longueurs (stock à 0, SKU neufs). On peut changer la LARGEUR : les sangles de chaque nomenclature passent à la nouvelle largeur → coûts recalculés ; les prix suivent le coefficient commun. */
  duplicateGroup(gid) {
    const mem = this._grpMembers(gid); if (!mem.length) return;
    const f = mem[0], w0 = this._widthOf(f);
    const ws = [...new Set([w0, ...(Store.state.settings.widths || [])].filter(Boolean))].sort((a, b) => parseFloat(a) - parseFloat(b));
    this._dgW0 = w0; this._dgWcur = w0;
    setTimeout(() => { const e = document.getElementById('dg_name'); if (e) { e.focus(); e.select(); } }, 60);   // nom sélectionné : taper le nouveau nom remplace l'ancien (plus de « (copie) » à effacer)
    U.modal({
      title: '📋 Dupliquer la famille — ' + U.esc(f.groupName || ''), okLabel: 'Dupliquer',
      body: `<div class="frow" style="align-items:flex-start;"><div class="fg" style="flex:1 1 240px;"><label style="white-space:nowrap;">Nom de la nouvelle famille</label><input id="dg_name" value="${U.esc(f.groupName || '')}" onfocus="this.select()"></div>
        <div class="fg" style="flex:0 0 150px;"><label style="white-space:nowrap;">Largeur de sangle ${U.info("Change la largeur pour décliner le produit (ex. 16 mm → 20 mm) : les sangles de chaque longueur passent à la nouvelle largeur et les coûts se recalculent. Tu n'as plus qu'à vérifier les prix.")}</label><select id="dg_w" onchange="Accessoires._dgWidth()">${ws.map(w => `<option ${w === w0 ? 'selected' : ''}>${U.esc(w)}</option>`).join('')}</select></div></div>
        <div class="fg"><label>🎨 Personnalisation de la nouvelle famille ${U.info("Coche pour décliner le produit en version personnalisée : toutes les longueurs reçoivent l'impression UV et / ou la gravure laser (coût, nom et SKU mis à jour).")}</label>
          ${this._persoBlockHTML('dg', f, 'Accessoires._dgWidth()')}</div>
        <p class="muted">${mem.length} fiche${mem.length > 1 ? 's' : ''} seront créées (stock à 0, nouveaux SKU).</p>`,
      onOk: () => {
        const typed = U.val('dg_name').trim(); if (!typed) { U.toast('Nom obligatoire', true); return false; }
        const w1 = U.val('dg_w') || w0, gid2 = U.uid(), gc = U.num(f.groupCoeff), changed = w1 !== w0;
        const { uv: uv1, laser: la1, theme: th1, uvMl, laMin } = this._persoRead('dg');
        // Nom de la famille : la largeur de sangle y est OBLIGATOIRE (elle revient toute seule si elle a été effacée) ; « (copie) » n'est ajouté QUE si le nom est resté celui d'une famille existante.
        const wRx = this._widthRx(w1), taken0 = new Set(Store.state.catalogA.filter(x => x.groupName).map(x => U.normSearch(x.groupName)));
        let core = typed.replace(this._PERSO_RX, '').replace(/\s+/g, ' ').trim();
        if (!wRx.test(core)) core = (core + ' ' + w1).trim();
        let name = this._persoName(core, uv1, la1, th1);
        if (taken0.has(U.normSearch(name))) { core += ' (copie)'; name = this._persoName(core, uv1, la1, th1); }
        // Les fiches suivent le nouveau nom : « Collier nomade — 5m » → « Collier Instant — 5m » (nom de la famille sans la largeur)
        const newBase = core.replace(wRx, ' ').replace(/\s+/g, ' ').trim(), oldBase = this._baseName(f);
        const taken = this._takenSkus(''), created = []; let missing = 0;
        mem.forEach(a => {
          const c = JSON.parse(JSON.stringify(a));
          c.id = U.uid(); c.groupId = gid2; c.groupName = name; c.stockGeneral = 0; c.stockEvent = 0;
          { const ob = this._baseName(a), nm = String(a.name || ''); c.name = this._persoName(ob && nm.toLowerCase().startsWith(ob.toLowerCase()) ? newBase + nm.slice(ob.length) : nm, uv1, la1, th1); }
          if (changed) {
            c.strapWidths = (c.strapWidths || []).map(w => w === w0 ? w1 : w); c.mainWidth = w1;
            (c.bom || []).forEach(l => { if (l.familyKey && l.familyKey.endsWith(':' + w0)) { l.familyKey = l.familyKey.slice(0, -w0.length) + w1; if (!this.families().some(x => x.key === l.familyKey)) missing++; } });
          }
          c.uv = uv1; c.uvMl = uv1 ? uvMl : 0; c.laser = la1; c.laserMin = la1 ? laMin : 0; if (th1) c.theme = true; else delete c.theme;
          if (gc > 0) { c.coefficient = gc; c.priceTTCManual = ''; }
          this._autoStrap(c);
          const base = Pricing.autoSkuAcc(c); let sku = base, n = 1; while (base && taken.has(sku.toUpperCase())) { n++; sku = base + '-' + n; } if (sku) taken.add(sku.toUpperCase()); c.sku = base ? sku : '';
          created.push(c);
        });
        created.forEach(c => Store.state.catalogA.push(c));
        const entry = Store.log('accessoires', `Famille dupliquée — ${name} (${created.length} fiches)`, { type: 'restoreBatch', data: created.map(c => ({ domain: 'catalogA', id: c.id, before: null })) });
        Store.save('catalogA'); this._grpOpen[gid2] = true; U.closeModal(); App.rerender();
        U.toast(`Famille dupliquée (${created.length} fiches).` + (missing ? ` ⚠️ ${missing} ligne(s) de sangle sans référence en ${w1} dans le stock : coût à vérifier.` : ''), missing > 0, entry.id);
      }
    });
  },
  /* Regex de la largeur dans un nom (« 20mm », « 20 mm », « 12,5mm ») */
  _widthRx(w) {
    const m = String(w || '').match(/^(\d+(?:[.,]\d+)?)\s*(\D*)$/);
    return m ? new RegExp('(^|\\s)' + m[1].replace(/[.,]/, '[.,]') + '\\s*' + (m[2] || 'mm').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'i') : new RegExp('(^|\\s)' + String(w || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'i');
  },
  /* Changer la largeur / la personnalisation dans « Dupliquer » : le nom TAPÉ est conservé, seule la largeur (« 16mm » → « 20mm ») et le suffixe UV / laser sont ajustés ; la largeur manquante est rajoutée à la validation. */
  _dgWidth() {   // appelé aussi par les cases UV / laser
    const el = document.getElementById('dg_name'), w1 = U.val('dg_w'), prev = this._dgWcur || this._dgW0; if (!el) return;
    const { uv, laser: la, theme: th } = this._persoRead('dg');
    let v = el.value;
    if (prev && w1 && w1 !== prev) { const rx = this._widthRx(prev); if (rx.test(v)) v = v.replace(rx, (m0, sp) => sp + w1); }
    this._dgWcur = w1;
    el.value = this._persoName(v, uv, la, th);
  },
  async deleteGroup(gid) {
    const mem = this._grpMembers(gid); if (!mem.length) return;
    const stock = mem.reduce((s, a) => s + U.num(a.stockGeneral) + U.num(a.stockEvent), 0);
    if (!await U.confirm(`Supprimer la famille « ${mem[0].groupName || ''} » et ses ${mem.length} fiche${mem.length > 1 ? 's' : ''} ?${stock ? `\nIl reste ${U.qty(stock)} pièce(s) en stock fini.` : ''}\nL'historique des ventes est conservé. Tu pourras annuler.`, { title: '🗑️ Supprimer la famille', okLabel: 'Supprimer', danger: true })) return;
    const snaps = mem.map(a => Store.snapshot('catalogA', a)), ids = new Set(mem.map(a => a.id));
    Store.state.catalogA = Store.state.catalogA.filter(x => !ids.has(x.id));
    const entry = Store.log('accessoires', `Famille supprimée — ${mem[0].groupName || ''} (${mem.length} fiches)`, { type: 'restoreBatch', data: snaps });
    Store.save('catalogA'); App.rerender();
    U.toast('Famille supprimée.', false, entry.id);
  },
  setAccSort(key) {
    if (this.accSort === key) this.accSortDir = this.accSortDir === 'asc' ? 'desc' : 'asc';
    else { this.accSort = key; this.accSortDir = 'asc'; }
    this.renderProducts();
  },

  render() {
    App.mount(`
      <div class="view-title"><h1>Artisanat</h1><span class="sub">fabrication artisanale · sangle enduite · prix et coûts</span></div>
      <div id="accBody"></div>`);
    this.renderProducts();
  },

  /* ---------- familles de matières (coût moyen) ---------- */
  families() {
    // Cache de courte durée (2026-10-19, page Artisanat lente : families() était recalculée ~200 fois par affichage — tri compris). Vidé à chaque sauvegarde / nouvel affichage (`_famC = null`) et à la fin du tour de boucle.
    if (this._famC) return this._famC;
    const res = this._families();
    this._famC = res;
    Promise.resolve().then(() => { if (this._famC === res) this._famC = null; });
    return res;
  },
  _families() {
    const mats = Store.state.materials, kindLabel = Stock.matKindLabel;
    const groups = {};
    for (const m of mats) {
      let key, label;
      if (Store.isSangleKind(m.kind)) {
        // une famille par (catégorie de sangle, largeur) : « Sangle 16mm », « Sangle HEXA 16mm »… (clé « sangle:16mm » inchangée pour la catégorie de base)
        const width = m.variant || m.name;
        key = m.kind + ':' + width;
        label = (kindLabel[m.kind] || 'Sangle') + ' ' + width;
      } else {
        const prod = m.product || m.name;
        key = (m.kind || 'autre') + ':' + prod;
        label = prod;
      }
      if (!groups[key]) groups[key] = { key, label, kind: m.kind, unit: m.unit, materials: [], totalCost: 0 };
      groups[key].materials.push(m);
      groups[key].totalCost += this.matCost(m);
    }
    // Familles « type + taille » (Mousquetons 20mm = moyenne de TOUS les mousquetons 20mm, toutes finitions/produits confondus) pour les catégories à la pièce
    // hors sangles : proposées seulement quand la fiche accessoire a une largeur de sangle, et seulement si elles regroupent au moins 2 produits.
    const bySize = {};
    for (const m of mats) {
      if (Store.isSangleKind(m.kind) || m.unit !== 'piece') continue;
      const size = this._sizeOf(m); if (!size) continue;
      const key = 'size:' + (m.kind || 'autre') + ':' + size;
      (bySize[key] = bySize[key] || { key, label: (kindLabel[m.kind] || 'Matière') + ' ' + size, kind: m.kind, unit: 'piece', size, bySize: true, materials: [], totalCost: 0, prods: new Set() });
      const g = bySize[key]; g.materials.push(m); g.totalCost += this.matCost(m); g.prods.add(m.product || m.name);
    }
    Object.values(bySize).forEach(g => { if (g.prods.size >= 2) groups[g.key] = g; });
    return Object.values(groups).map(g => ({
      ...g,
      avgCost: g.totalCost / g.materials.length,
      count: g.materials.length
    })).sort((a, b) => U.sortFr(a.label, b.label));
  },

  /* Taille d'une matière à la pièce, normalisée (« 20mm ») : la variante si c'est une largeur, sinon la largeur lue dans le nom du produit (« Mousqueton 20 mm »). */
  _sizeOf(m) {
    const w = s => { const x = String(s || '').match(/^\s*(\d+(?:[.,]\d+)?)\s*mm\s*$/i); return x ? x[1].replace(',', '.') + 'mm' : ''; };
    const sz = w(m.size); if (sz) return sz;
    const v = w(m.variant); if (v) return v;
    const n = String(m.product || m.name || '').match(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*mm(?![a-z])/i);
    return n ? n[1].replace(',', '.') + 'mm' : '';
  },
  _normWidth(w) { const x = String(w || '').match(/(\d+(?:[.,]\d+)?)\s*mm/i); return x ? x[1].replace(',', '.') + 'mm' : String(w || ''); },

  familyCost(familyKey) {
    if (!familyKey) return 0;
    const fam = this.families().find(f => f.key === familyKey);
    return fam ? fam.avgCost : 0;
  },

  /* Coût unitaire d'une matière POUR LES CALCULS : coût stocké HT + TVA d'achat de la matière (m.costVat, sinon taux global) tant qu'Antho n'est pas assujetti (TVA non récupérable). */
  matCost(m) { return U.num(m.costUnit) * Pricing.vatK(Stock.matVat(m)); },

  bomLineCost(l) {
    if (l.familyKey) return this.familyCost(l.familyKey);
    if (l.materialId) { const m = Store.material(l.materialId); return m ? this.matCost(m) : 0; }
    return 0;
  },

  bomLineLabel(l, a) {
    let label;
    if (l.familyKey) { const fam = this.families().find(f => f.key === l.familyKey); label = fam ? fam.label : l.familyKey; }
    else if (l.materialId) { const m = Store.material(l.materialId); label = m ? m.name : '⚠ matière supprimée'; }
    else label = '—';
    if (l.strapColor) label += ` (couleur ${l.strapColor}${a ? ' — ' + this._colorTitle(a, l.strapColor) : ''})`;
    const sec = l.secId && a ? (a.fabSections || []).find(s => s.id === l.secId) : null;
    if (sec) label += ` (section « ${sec.label || 'sans nom'} »)`;
    return label;
  },

  bomLineUnit(l) {
    if (l.familyKey) {
      const fam = this.families().find(f => f.key === l.familyKey);
      return Store.matUnitLabel(fam && fam.unit);
    }
    if (l.materialId) {
      const m = Store.material(l.materialId);
      return Store.matUnitLabel(m && m.unit);
    }
    return 'PCS';
  },

  /* ---------- produits finis ---------- */
  renderProducts() {
    this.ensureFamilies();
    let needSave = false;
    for (const a of Store.state.catalogA) if (this._migrateInternalLength(a)) needSave = true;
    if (!this._strapRecalced) {
      this._strapRecalced = true;
      for (const a of Store.state.catalogA) {
        const strapIdxs = []; (a.bom || []).forEach((l, i) => { if (this.bomLineUnit(l) === 'm') strapIdxs.push(i); });
        if (!strapIdxs.length) continue;
        const old = strapIdxs.map(i => U.num(a.bom[i].qty));
        this._autoStrap(a);
        if (strapIdxs.some((si, j) => Math.abs(old[j] - U.num(a.bom[si].qty)) > 0.001)) needSave = true;
      }
    }
    if (needSave) Store.save('catalogA');
    U.syncFilters('accessoires', this, ['accQ', 'accCatFilter', 'accWidthFilter', 'accBicolorFilter', 'accSort', 'accSortDir']);
    const focusId = this.focusId; this.focusId = null;
    if (focusId) { this.accQ = ''; this.accCatFilter = ''; this.accWidthFilter = ''; this.accBicolorFilter = ''; this._accOpen[focusId] = true; const _fa = Store.state.catalogA.find(x => x.id === focusId); if (_fa && _fa.groupId) this._grpOpen[_fa.groupId] = true; }
    let list = [...this.crafted()];   // les pièces « prêtes à finir » (ajoutées à la main) ne sont que dans Stock → Accessoires
    const q = this.accQ.toLowerCase();
    if (q) list = list.filter(a => U.has(a.name, q));
    if (this.accCatFilter) list = list.filter(a => a.category === this.accCatFilter);
    if (this.accWidthFilter) list = list.filter(a => (a.mainWidth || (a.strapWidths || [])[0] || '') === this.accWidthFilter);
    if (this.accBicolorFilter === 'yes') list = list.filter(a => a.bicolor);
    else if (this.accBicolorFilter === 'no') list = list.filter(a => !a.bicolor);
    const dir = this.accSortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let v = 0;
      const ca = Pricing.accCalc(a), cb = Pricing.accCalc(b);
      switch(this.accSort) {
        case 'name': v = this._cmpAcc(a, b); break;
        case 'cat': v = U.sortFr(a.category||'', b.category||''); break;
        case 'len': v = this._lenOf(a) - this._lenOf(b); break;
        case 'width': v = this._widthNum(a) - this._widthNum(b); break;
        case 'cost': v = ca.cost - cb.cost; break;
        case 'price': v = ca.priceTTC - cb.priceTTC; break;
      }
      return (v || (this.accSort === 'name' ? 0 : this._cmpAcc(a, b))) * dir;
    });
    const sortHead = (key, label) => `<span class="sortable ${this.accSort===key?'active':''}" onclick="Accessoires.setAccSort('${key}')">${label} ${this.accSort===key?(this.accSortDir==='asc'?'▲':'▼'):'⇕'}</span>`;
    const allCats = [...new Set(this.crafted().map(a => a.category).filter(Boolean))].sort(U.sortFr);
    const allWidths = [...new Set(this.crafted().flatMap(a => a.strapWidths || []))].sort((a, b) => parseInt(a) - parseInt(b));
    document.getElementById('accBody').innerHTML = `
      <div class="toolbar">
        <div class="fg"><label>Recherche</label><input id="acc_q" type="text" placeholder="nom du produit…" value="${U.esc(this.accQ)}" oninput="Accessoires.setAccQ(this.value)"></div>
        <div class="fg"><label>Catégorie</label><select onchange="Accessoires.setAccCatFilter(this.value)">
          <option value="">Toutes (${this.crafted().length})</option>
          ${allCats.map(c => `<option value="${U.esc(c)}" ${this.accCatFilter === c ? 'selected' : ''}>${U.esc(c)}</option>`).join('')}
        </select></div>
        <div class="fg"><label>Largeur</label><select onchange="Accessoires.setAccWidthFilter(this.value)">
          <option value="">Toutes</option>
          ${allWidths.map(w => `<option value="${U.esc(w)}" ${this.accWidthFilter === w ? 'selected' : ''}>${U.esc(w)}</option>`).join('')}
        </select></div>
        <div class="fg"><label>Bicolor</label><select onchange="Accessoires.setAccBicolorFilter(this.value)">
          <option value="" ${!this.accBicolorFilter ? 'selected' : ''}>Tous</option>
          <option value="yes" ${this.accBicolorFilter === 'yes' ? 'selected' : ''}>Bicolor</option>
          <option value="no" ${this.accBicolorFilter === 'no' ? 'selected' : ''}>Non bicolor</option>
        </select></div>
      </div>
      ${this._queueCard()}
      <div class="toolbar"><button class="btn-cta" onclick="Accessoires.editAcc()">＋ Nouvel accessoire</button></div>
      ${list.length ? `<div class="prod-list-header acc-header">
        <span>${sortHead('name', 'Nom du produit')}</span>
        <span>Taille</span>
        <span>${sortHead('width', 'Largeur')}</span>
        <span>${sortHead('cat', 'Catégorie')}</span>
        <span>${sortHead('len', 'Longueur')}</span>
        <span>Alerte</span>
        <span class="right">${sortHead('cost', 'Coût')}</span>
        <span class="right">${sortHead('price', 'Prix TTC')}</span>
      </div>` : ''}
      ${(() => { const seen = new Set(); return list.map(a => { if (!a.groupId) return this.accCard(a); if (seen.has(a.groupId)) return ''; seen.add(a.groupId); return this.groupCard(list.filter(x => x.groupId === a.groupId)); }).join(''); })() || '<div class="card empty"><span class="big">🐕</span>Aucun accessoire. Crée ta première fiche : matières + temps de fabrication, et le prix se calcule tout seul.</div>'}`;
    if (focusId) setTimeout(() => { const el = document.getElementById('acc-' + focusId); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  },

  /* Le prix TTC tapé commande (comme les fiches Prix mastication) : le coefficient s'en déduit et est enregistré.
     Le prix n'est « forcé » (↺) que s'il n'est pas un « prix rond » (multiple de l'arrondi des Paramètres, 0,50 € par défaut) : le calcul auto arrondit ainsi. */
  _applyTtc(a, ttc) {
    if (!(ttc > 0)) { a.priceTTCManual = ''; return; }
    const sup = Pricing.persoSupplement(a), cost = U.num(Pricing.accCost(a).cost), k = 1 + U.num(Store.state.settings.vatRate) / 100;   // supplément de personnalisation retiré avant de déduire le coefficient
    if (!(cost > 0)) { a.priceTTCManual = ttc; return; }
    a.coefficient = Math.round((ttc - sup) / k / cost * 1e6) / 1e6;
    a.priceTTCManual = Math.abs(Pricing.accAutoTTC(a, { cost }, a.coefficient) - ttc) < 0.005 ? '' : ttc;   // même règle que le prix automatique (arrondi + seuil critique)
  },

  /* Maintenir l'appui sur « Profit net » : gain réel avec la TVA conservée (comme « Bénéfice » dans Prix mastication). */
  peekBenef(id, active) {
    document.querySelectorAll('.acc-benef-cell').forEach(td => { if (td.dataset.acc !== id) return; const b = td.querySelector('b'); if (b) b.textContent = active ? td.dataset.peek : td.dataset.normal; });
  },

  setAccInline(id, field, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (field === 'laborMinutes') a.laborMinutes = U.num(val);
    else if (field === 'coefficient') { a.coefficient = U.num(val); a.priceTTCManual = ''; }
    else if (field === 'priceTTCManual') this._applyTtc(a, U.num(val));
    Store.commitSnapshot(snap, 'accessoires', 'Accessoire modifié — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  setAccBomQty(id, bomIdx, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (a.bom && a.bom[bomIdx]) a.bom[bomIdx].qty = U.num(val);
    Store.commitSnapshot(snap, 'accessoires', 'Accessoire modifié — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  setAccProdLen(id, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    const oldLen = U.num(a.productLength);
    const newLen = U.num(val);
    a.productLength = newLen;
    const delta = newLen - oldLen;
    if (delta !== 0) {
      a.internalLength = Math.max(0, Math.round((U.num(a.internalLength) + delta * 100) * 10) / 10);
    }
    this._autoStrap(a);
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Longueur produit modifiée — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  setAccInternalLen(id, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    a.internalLength = U.num(val);
    this._autoStrap(a);
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Longueur interne modifiée — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  toggleBicolor(id) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    a.bicolor = !a.bicolor;
    this._applyColors(a);
    this._autoStrap(a);
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', (a.bicolor ? 'Bicolor activé' : 'Bicolor désactivé') + ' — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  toggleBicolorEnds(id) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    a.bicolorEnds = !a.bicolorEnds;
    this._applyColors(a);
    this._autoStrap(a);
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', (a.bicolorEnds ? '3 couleurs (extrémités différentes)' : '2 couleurs') + ' — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  setAccSegment(id, i, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (a.fabSegments && a.fabSegments[i]) a.fabSegments[i].value = U.num(val);
    this._autoStrap(a);
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Segment modifié — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  /* Nombre de COULEURS de sangle (Antho 2026-10-13) : 1 ; bicolor = 2 (couleur 1 = segments fixes rabat + poignée, couleur 2 = longueur interne) ;
     bicolor + « extrémités de couleurs différentes » (`a.bicolorEnds`, ≥ 2 segments) = 3 (couleur 1 = 1er segment, couleur 2 = les autres segments, couleur 3 = longueur interne). */
  _colorCount(a) { return a.bicolor ? ((a.bicolorEnds && (a.fabSegments || []).length >= 2) ? 3 : 2) : 1; },
  /* Colliers (Antho 2026-11-01) : la formule (segments, sections, X pour le tour de cou de RÉFÉRENCE `productLength`) est commune à toutes les tailles ; chaque taille a sa FOURCHETTE de tour de cou
     (`a.sizeRange`, ex. « 38–45 cm »). Le COÛT d'une taille est celui du haut de sa fourchette : X est ramené à ce tour de cou (X + haut − référence). Sans taille, fourchette ou référence : X tel quel. */
  _rangeOf(a) {
    const n = (String(a.sizeRange || '').match(/\d+(?:[.,]\d+)?/g) || []).map(x => parseFloat(x.replace(',', '.'))).filter(x => x > 0);
    return n.length ? { min: Math.min(...n), max: Math.max(...n) } : null;
  },
  _xEff(a) {
    const r = a.sizeLabel ? this._rangeOf(a) : null, ref = U.num(a.productLength) * 100;
    return r && ref > 0 ? Math.max(0, Math.round((U.num(a.internalLength) + r.max - ref) * 10) / 10) : U.num(a.internalLength);
  },
  /* Quantités de sangle déduites des « Longueurs de fabrication » : [total] ou, par couleur, [segments…, interne] (en m, arrondi au mm) */
  _strapTargets(a, nStrap) {
    const segs = (a.fabSegments || []).map(s => U.num(s.value)), segTotal = segs.reduce((x, y) => x + y, 0);
    const interne = this._xEff(a), r = x => x > 0 ? Math.round(x / 100 * 1000) / 1000 : 0, n = this._colorCount(a);
    if (n >= 2 && nStrap >= n) return n === 3 ? [r(segs[0] || 0), r(segTotal - (segs[0] || 0)), r(interne)] : [r(segTotal), r(interne)];
    return [r(segTotal + interne)];
  },
  /* Nom court de la partie de la laisse qui porte la couleur c (d'après le nom des segments) */
  _colorTitle(a, c) {
    const all = a.fabSegments || [], n = this._colorCount(a), clean = l => String(l || '').replace(/\s*\([^)]*\)/g, '').trim() || 'segment';
    if (c === n) return 'longueur interne';
    if (n === 2) return all.map(s => clean(s.label)).join(' + ') || 'segments';
    if (c === 1) return clean(all[0] && all[0].label);
    return all.length > 2 ? all.slice(1).map(s => clean(s.label)).join(' + ') : clean(all[1] && all[1].label);
  },
  _colorParts(a) {
    const n = this._colorCount(a); if (n < 2) return [];
    return this._strapTargets(a, n).map((q, i) => ({ k: i + 1, title: this._colorTitle(a, i + 1), qty: q }));
  },
  _colorSubText(a) {
    const p = this._colorParts(a);
    return p.length ? p.map(x => `Couleur ${x.k} = ${x.title}`).join(' · ') : 'Coche si la laisse utilise des sangles de couleurs différentes.';
  },
  /* Met les lignes de sangle de la nomenclature en accord avec le nombre de couleurs (ajoute / retire des lignes, numérote 1, 2, 3) */
  _applyColors(a) {
    const n = this._colorCount(a), colored = () => this._strapIdxs(a).filter(i => a.bom[i].strapColor);
    let col = colored();
    if (n === 1) {
      if (!col.length) return;
      for (let k = col.length - 1; k >= 1; k--) a.bom.splice(col[k], 1);
      delete a.bom[col[0]].strapColor; delete a.bom[col[0]].qtyManual;
      return;
    }
    if (!col.length) { const si = this._strapIdxs(a); if (!si.length) return; a.bom[si[0]].strapColor = 1; col = colored(); }
    if (col.length === n) { col.forEach((i, k) => { a.bom[i].strapColor = k + 1; }); return; }
    for (let k = col.length - 1; k >= n; k--) a.bom.splice(col[k], 1);
    col = colored();
    const { strapColor, qtyManual, _cat, tpl, ...rest } = a.bom[col[0]];
    while (col.length < n) {
      const at = col[col.length - 1] + 1;
      a.bom.splice(at, 0, { ...rest, qty: 0, strapColor: col.length + 1 });
      col = colored();
    }
    col.forEach((i, k) => { a.bom[i].strapColor = k + 1; delete a.bom[i].qtyManual; });
  },
  /* Lignes de sangle de la section PRINCIPALE (segments + X) : les lignes des autres sections (`l.secId`) ont leur propre calcul. */
  _strapIdxs(a) { const idx = []; (a.bom || []).forEach((l, i) => { if (!l.secId && this.bomLineUnit(l) === 'm') idx.push(i); }); return idx; },
  _mainStrapIdx(a) { const i = this._strapIdxs(a); return i.length ? i[0] : -1; },

  /* ═══ Sections de fabrication (Antho 2026-11-01, colliers : surpiqûre sur une sangle plus étroite) ═══
     Section PRINCIPALE = `fabSegments` + `internalLength` (X), calculée comme avant. Les AUTRES sections (`a.fabSections` = [{id, label, width, segs:[{label, value en cm}]}])
     ne dépendent PAS de X : chacune a sa largeur de sangle et sa propre ligne de sangle dans la nomenclature (`l.secId`), quantité = somme de ses segments. */
  _secTotalCm(s) { return (s.segs || []).reduce((t, g) => t + U.num(g.value), 0); },
  /* Famille de sangle de la largeur w, dans la même catégorie que la sangle principale ('' si elle n'existe pas dans le stock) */
  _secKey(a, w) {
    const mi = this._mainStrapIdx(a), main = mi >= 0 ? a.bom[mi] : null, fams = this.families();
    const kind = main && main.familyKey ? String(main.familyKey).split(':')[0] : 'sangle';
    return [kind + ':' + w, 'sangle:' + w].find(k => fams.some(f => f.key === k)) || '';
  },
  /* Une ligne de sangle par section (créée / retirée / remise à la bonne largeur), quantité = somme des segments sauf saisie à la main. */
  _secSync(a) {
    const secs = a.fabSections || [];
    if (!(a.bom || []).some(l => l.secId) && !secs.length) return;
    if (!a.bom) a.bom = [];
    a.bom = a.bom.filter(l => !l.secId || secs.some(s => s.id === l.secId));
    secs.forEach(s => {
      let l = a.bom.find(x => x.secId === s.id);
      if (!l) { l = { familyKey: s.width ? this._secKey(a, s.width) : '', qty: 0, secId: s.id, secW: s.width }; a.bom.push(l); }
      else if (l.secW !== s.width) { l.secW = s.width; delete l.materialId; l.familyKey = s.width ? this._secKey(a, s.width) : ''; }
      if (!l.qtyManual) l.qty = Math.round(this._secTotalCm(s) / 100 * 100) / 100;
    });
  },
  /* Met la quantité de sangle d'après les longueurs, sauf pour une ligne saisie à la main (l.qtyManual). */
  _autoStrap(a) {
    this._secSync(a);
    const idxs = this._strapIdxs(a); if (!idxs.length) return;
    this._strapTargets(a, idxs.length).forEach((q, k) => {
      const l = a.bom[idxs[k]];
      if (!l || l.qtyManual) return;
      if ((a.bicolor && idxs.length >= 2) || q > 0) l.qty = Math.round(q * 100) / 100;   // 2 décimales (au cm près) comme tout l'affichage
    });
  },
  /* À l'ouverture d'une fiche existante : une quantité de sangle différente du calcul est considérée « saisie à la main » (on ne la change pas en douce). */
  _flagManualStrap(a) {
    const idxs = this._strapIdxs(a);
    this._strapTargets(a, idxs.length).forEach((q, k) => {
      const l = a.bom[idxs[k]];
      if (l && q > 0 && Math.abs(U.num(l.qty) - q) > 0.0051) l.qtyManual = true;
    });
  },

  _migrateInternalLength(a) {
    if (a.internalLength !== undefined) return false;
    if (!a.fabSegments) { a.internalLength = 0; return false; }
    const ii = a.fabSegments.findIndex(s => s.label && s.label.toLowerCase().includes('interne'));
    if (ii >= 0 && U.num(a.fabSegments[ii].value) > 0) {
      a.internalLength = U.num(a.fabSegments[ii].value);
      a.fabSegments.splice(ii, 1);
      return true;
    }
    a.internalLength = 0;
    return false;
  },

  initFabSegs(id) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    const defs = this._fabDefaults(a.category).map(s => ({ ...s }));
    const ii = defs.findIndex(s => s.label && s.label.toLowerCase().includes('interne'));
    if (ii >= 0) { a.internalLength = U.num(defs[ii].value); defs.splice(ii, 1); }
    a.fabSegments = defs;
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Segments configurés — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  setAccSegLabel(id, i, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (a.fabSegments && a.fabSegments[i]) a.fabSegments[i].label = val.trim();
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Segment renommé — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  addAccFabSeg(id) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (!a.fabSegments) a.fabSegments = [];
    a.fabSegments.push({ label: '', value: 0 });
    this._fabOpen[id] = true;
    Store.commitSnapshot(snap, 'accessoires', 'Segment ajouté — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  delAccFabSeg(id, i) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    const snap = Store.snapshot('catalogA', a);
    if (a.fabSegments) a.fabSegments.splice(i, 1);
    Store.commitSnapshot(snap, 'accessoires', 'Segment supprimé — ' + a.name);
    Store.save('catalogA'); App.rerender();
  },

  accCard(a) {
    const c = Pricing.accCalc(a);
    // Profit net = bénéfice « assujetti » (marge − cotisations, TVA hors calcul). Non assujetti : le gain réel (TVA conservée) est affiché en dessous.
    const vatOn = Store.state.settings.vatActive;
    const netProfit = c.profitAssujetti;
    const bomRows = (a.bom || []).map((l, li) => {
      const label = this.bomLineLabel(l, a);
      const unit = this.bomLineUnit(l);
      const unitCost = this.bomLineCost(l);
      const isFamily = !!l.familyKey;
      return `<tr><td class="col-name">${U.esc(label)}${isFamily ? ' <span class="muted">(moy.)</span>' : ''}</td>
        <td class="num"><input type="number" step="0.01" value="${l.qty}" class="acc-inline-input" onchange="Accessoires.setAccBomQty('${a.id}',${li},this.value)"> ${unit}</td>
        <td class="num sensitive">${U.eur(unitCost * U.num(l.qty))}</td></tr>`;
    }).join('');
    const strapRows = (a.bom || []).filter(l => this.bomLineUnit(l) === 'm');
    const strapTotalRow = strapRows.length >= 2 ? `<tr><td class="col-name"><b>📏 Total sangle</b> <span class="muted">(${strapRows.length} ${strapRows.some(l => l.secId) ? 'sangles' : 'couleurs'})</span></td><td class="num"><b>${U.qty(strapRows.reduce((s, l) => s + U.num(l.qty), 0))} m</b></td><td class="num sensitive">${U.eur(strapRows.reduce((s, l) => s + this.bomLineCost(l) * U.num(l.qty), 0))}</td></tr>` : '';
    const fabHTML = this._fabCardHTML(a);
    const notesHTML = this._notesHTML(a);
    const accOpen = this._accOpen[a.id] || false;
    const widths = this._normalizeWidths(a);
    const criticalClass = c.critical ? ' acc-critical' : '';
    return `<details class="fold prod-fold acc-fold${criticalClass}" id="acc-${a.id}" ${accOpen ? 'open' : ''} ontoggle="Accessoires.setAccOpen('${a.id}',this.open)">
      <summary>
        <span><b>${U.esc(a.name)}</b></span>
        <span class="type-col acc-size">${a.sizeLabel ? `<span class="badge info">${U.esc(a.sizeLabel)}</span>` : ''}${a.sizeRange ? `<small class="muted" title="Tour de cou (indicatif)">${U.esc(a.sizeRange)}</small>` : ''}${!a.sizeLabel && !a.sizeRange ? '<span class="muted">—</span>' : ''}</span>
        <span class="type-col">${widths.map(w => `<span class="badge${w === a.mainWidth && widths.length > 1 ? ' info' : ''}">${w === a.mainWidth && widths.length > 1 ? '★ ' : ''}${U.esc(w)}</span>`).join(' ') || '<span class="muted">—</span>'}</span>
        <span class="type-col"><span class="badge info">${U.esc(a.category)}</span></span>
        <span class="type-col">${this._lenOf(a) > 0 ? U.qty(this._lenOf(a)) + ' m' : '<span class="muted">—</span>'}</span>
        <span class="type-col">${c.critical ? '<span class="badge bad">coeff critique</span>' : ''}${a.groupId && !this._follows(a) && Store.state.catalogA.filter(x => x.groupId === a.groupId).length > 1 ? ' <span class="badge warn" title="Coefficient ou prix propre à cette longueur (différent du coefficient commun de la famille)">propre</span>' : ''}</span>
        <span class="meta right sensitive" style="white-space:nowrap;">${U.eur(c.cost)}</span>
        <span class="meta right"><b>${U.eur(c.priceTTC)}</b></span>
      </summary>
      <div class="fold-body">
        ${fabHTML}
        <div class="grid c2">
          <div>
            <h2 style="font-size:.9rem;">Nomenclature</h2>
            <div class="table-wrap"><table><thead><tr><th class="col-name">Matière</th><th class="num">Qté</th><th class="num">Coût</th></tr></thead>
              <tbody>${bomRows || '<tr><td colspan="3" class="muted">Aucune matière.</td></tr>'}${strapTotalRow}
              <tr><td>Main d'œuvre (<input type="number" step="1" value="${U.num(a.laborMinutes)}" class="acc-inline-input" onchange="Accessoires.setAccInline('${a.id}','laborMinutes',this.value)"> min à <span class="sensitive">${U.eur(Store.state.settings.laborRate)}/h</span>)</td><td></td><td class="num sensitive">${U.eur(c.laborCost)}</td></tr>
              ${U.num(a.extraCost) ? `<tr><td>Autres coûts</td><td></td><td class="num sensitive">${U.eur(a.extraCost)}</td></tr>` : ''}
              ${U.num(c.laserCost) ? `<tr><td>🔦 Gravure laser <span class="muted">(${U.qty(a.laserMin)} min × ${U.eur(Pricing.laserCostPerHour() / 60)}/min)</span></td><td></td><td class="num sensitive">${U.eur(c.laserCost)}</td></tr>` : ''}
              ${U.num(c.print3dCost) ? `<tr><td>🧊 Impression 3D <span class="muted">(${U.qty(a.print3dMin)} min × ${U.eur(Pricing.print3dCostPerHour() / 60)}/min)</span></td><td></td><td class="num sensitive">${U.eur(c.print3dCost)}</td></tr>` : ''}
              ${U.num(c.uvCost) ? `<tr><td>🖨️ Impression UV <span class="muted">(${U.qty(a.uvMl)} ml × ${U.eur(Pricing.uvCostPerMl())}/ml)</span></td><td></td><td class="num sensitive">${U.eur(c.uvCost)}</td></tr>` : ''}
              <tr><th>Coût de revient</th><th></th><th class="num sensitive">${U.eur(c.cost)}</th></tr></tbody></table></div>
          </div>
          <div>
            <h2 style="font-size:.9rem;">Tarification</h2>
            <div class="table-wrap"><table><tbody>
              <tr><td>Coefficient</td><td class="num sensitive"><input type="number" step="0.01" value="${c.coeff.toFixed(2)}" class="acc-inline-input" onchange="Accessoires.setAccInline('${a.id}','coefficient',this.value)"></td></tr>
              <tr><td>Prix HT</td><td class="num sensitive">${U.eur(c.priceHT)}</td></tr>
              <tr><td><b>Prix TTC</b></td><td class="num">${c.priceFixed ? '<button class="btn-icon" title="Revenir au calcul auto" onclick="Accessoires.setAccInline(\''+a.id+'\',\'priceTTCManual\',0)" style="vertical-align:middle;">↺</button>' : ''}<input type="number" step="0.10" value="${c.priceTTC.toFixed(2)}" class="acc-inline-input" style="font-weight:700;" onchange="Accessoires.setAccInline('${a.id}','priceTTCManual',this.value)"></td></tr>
              ${c.persoSup > 0 ? `<tr><td>Dont supplément personnalisation <span class="muted help">Ajouté automatiquement au prix (réglé dans Paramètres → Accessoires) : impression UV, création de thème UV et / ou gravure laser. Le coefficient s'applique à tout le coût, encre et laser compris.</span></td><td class="num">+ ${U.eur(c.persoSup)}</td></tr>` : ''}
              <tr><td>Marge</td><td class="num sensitive">${U.eur(c.margin)}</td></tr>
              <tr><td>Cotisations URSSAF <span class="muted">(${U.pct(Pricing.socialRateHandmade())} — fait main)</span></td><td class="num sensitive neg">− ${U.eur(c.social)}</td></tr>
              <tr><td>TVA <span class="muted">${vatOn ? '(reversée)' : '(conservée)'}</span></td><td class="num sensitive ${vatOn ? 'neg' : ''}">${vatOn ? '− ' : ''}${U.eur(c.vatAmt)}</td></tr>
              <tr class="acc-benef-row" ${vatOn ? '' : `style="cursor:pointer;user-select:none;" title="Maintenir l'appui : voir le gain avec la TVA conservée" onmousedown="Accessoires.peekBenef('${a.id}',true)" onmouseup="Accessoires.peekBenef('${a.id}',false)" onmouseleave="Accessoires.peekBenef('${a.id}',false)" ontouchstart="event.preventDefault();Accessoires.peekBenef('${a.id}',true)" ontouchend="Accessoires.peekBenef('${a.id}',false)" ontouchcancel="Accessoires.peekBenef('${a.id}',false)"`}><td><b>Profit net</b> <span class="muted help">Marge moins cotisations, TVA non comptée (le bénéfice que tu auras une fois assujetti).${vatOn ? '' : ' Maintiens l’appui sur cette ligne pour voir le gain réel d’aujourd’hui : tu gardes la TVA et les cotisations se calculent sur le prix TTC encaissé (même chiffre que dans les Stats).'}</span></td><td class="num sensitive acc-benef-cell ${netProfit >= 0 ? 'pos' : 'neg'}" data-acc="${a.id}" data-normal="${U.eur(netProfit)}" data-peek="${U.eur(vatOn ? netProfit : c.profitActuel)}"><b>${U.eur(netProfit)}</b></td></tr>
              ${U.num(c.laborCost) > 0 ? `<tr><td>Ton temps de fabrication <span class="muted">(${U.qty(a.laborMinutes)} min à ${U.eur(Store.state.settings.laborRate)}/h)</span> <span class="muted help">Déjà retiré dans le coût de revient (ligne « Main d’œuvre ») : comme c’est toi qui fabriques, cet argent te revient. Il est donc rajouté ici.</span></td><td class="num sensitive pos">+ ${U.eur(c.laborCost)}</td></tr>
              <tr><td><b>Profit avec ton temps</b> <span class="muted help">Profit net + ton temps de fabrication : ce qui te reste réellement pour cette pièce, une fois payés les matières et les cotisations. Maintiens l’appui sur « Profit net » pour voir aussi le gain avec la TVA conservée.</span></td><td class="num sensitive acc-benef-cell ${netProfit + c.laborCost >= 0 ? 'pos' : 'neg'}" data-acc="${a.id}" data-normal="${U.eur(netProfit + c.laborCost)}" data-peek="${U.eur((vatOn ? netProfit : c.profitActuel) + c.laborCost)}"><b>${U.eur(netProfit + c.laborCost)}</b></td></tr>` : ''}
            </tbody></table></div>
          </div>
        </div>
        ${notesHTML}
        <div class="mt">${U.seg([
          { l: '🛠 Fabriquer', tone: 'ok', js: `Accessoires.fabricate('${a.id}')` },
          { l: 'Modifier', js: `Accessoires.editAcc('${a.id}')` },
          // Une longueur de plus = « ＋ Ajouter une longueur » du produit (famille) ; SKU et Dupliquer sont ceux de la famille
          { l: 'Supprimer', tone: 'danger', js: `Accessoires.delAcc('${a.id}')` }
        ], { full: true, scroll: true })}</div>
      </div></details>`;
  },

  _notesHTML(a) {
    const parts = [];
    if (a.handleLength) parts.push(`Poignée : ${U.esc(a.handleLength)}`);
    if (a.flapLength) parts.push(`Rabats : ${U.esc(a.flapLength)}`);
    if (a.materialsDesc) parts.push(`Matières : ${U.esc(a.materialsDesc)}`);
    if (a.notes) parts.push(U.esc(a.notes).replace(/\n/g, '<br>'));
    if (!parts.length) return '';
    return `<div class="card" style="margin-top:8px;padding:8px 12px;background:var(--th-bg);">
      <b>📝 Notes :</b><br>${parts.join('<br>')}</div>`;
  },

  _fabSummary(a) {
    const segs = a.fabSegments || [];
    const prodLen = U.num(a.productLength);
    const interne = U.num(a.internalLength), xEff = this._xEff(a);
    if (!segs.some(s => s.value > 0) && !prodLen && !interne) return '';
    const parts = [];
    if (prodLen > 0) parts.push(`${a.sizeLabel ? 'Tour de cou réf.' : 'Produit'} : ${U.qty(prodLen)} m`);
    segs.filter(s => s.value > 0).forEach(s => parts.push(`${U.esc(s.label)} : ${U.lenTxt(s.value)}`));
    if (interne > 0) parts.push(Math.abs(xEff - interne) > 0.05 ? `Interne (haut de fourchette) : ${U.lenTxt(xEff)}` : `Interne : ${U.lenTxt(interne)}`);
    if (this._colorCount(a) >= 2) {
      this._colorParts(a).forEach(p => { if (p.qty > 0) parts.push(`Couleur ${p.k} : ${U.qty(p.qty)} m`); });
    } else {
      const sangleIdx = this._mainStrapIdx(a);
      const totalStrap = sangleIdx >= 0 ? U.num(a.bom[sangleIdx].qty) : 0;
      if (totalStrap > 0) parts.push(`Sangle : ${U.qty(totalStrap)} m`);
    }
    (a.fabSections || []).forEach(s => { const t = this._secTotalCm(s); if (t > 0) parts.push(`${U.esc(s.label || 'Section')}${s.width ? ' ' + U.esc(s.width) : ''} : ${U.qty(t / 100)} m`); });
    return ` <span class="muted" style="font-weight:normal;font-size:.85rem;">— ${parts.join(' · ')}</span>`;
  },

  _fabCardHTML(a) {
    const hasSangle = (a.bom || []).some(l => this.bomLineUnit(l) === 'm');
    const segs = a.fabSegments || [];
    const interne = U.num(a.internalLength);
    if (!hasSangle && !segs.length && !interne) return '';
    if (hasSangle && !segs.length && !interne) {
      return `<div class="card" style="margin-bottom:8px;padding:8px 12px;background:var(--th-bg);">
        <b>📐 Longueurs de fabrication</b>
        <div style="margin-top:6px;"><button class="btn-ghost btn-sm" onclick="Accessoires.initFabSegs('${a.id}')">Configurer les segments</button></div></div>`;
    }
    const sangleIdx = this._mainStrapIdx(a);
    const totalStrap = sangleIdx >= 0 ? U.num(a.bom[sangleIdx].qty) : 0;
    const prodLen = U.num(a.productLength);
    const fabOpen = this._fabOpen[a.id] || false;
    const segTotal = segs.reduce((sum, s) => sum + U.num(s.value), 0);

    // -- Colonne gauche : Produit fini + Longueur interne + Bicolor --
    let left = `<div style="font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">Produit fini</div>`;
    left += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
      ${U.lenSplit('pl_' + a.id, prodLen * 100, { change: `Accessoires.setAccProdLen('${a.id}',U.lenCm('pl_${a.id}')/100)` })}</div>`;
    left += `<div style="padding:12px;border-radius:8px;background:rgba(100,180,255,0.07);border:1px dashed rgba(100,180,255,0.25);">
      <div style="font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">Longueur interne (X)</div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${U.lenSplit('il_' + a.id, interne, { change: `Accessoires.setAccInternalLen('${a.id}',U.lenCm('il_${a.id}'))` })}</div></div>`;
    left += `<div style="margin-top:12px;"><label style="cursor:pointer;font-size:.85rem;display:flex;align-items:center;gap:6px;"><input type="checkbox" ${a.bicolor ? 'checked' : ''} onchange="Accessoires.toggleBicolor('${a.id}')"> <span>🎨 Bicolor (2 sangles)</span></label></div>`;
    if (a.bicolor && segs.length >= 2) left += `<div style="margin-top:6px;"><label style="cursor:pointer;font-size:.82rem;display:flex;align-items:center;gap:6px;"><input type="checkbox" ${a.bicolorEnds ? 'checked' : ''} onchange="Accessoires.toggleBicolorEnds('${a.id}')"> <span>Extrémités de couleurs différentes (3 couleurs)</span></label></div>`;

    // -- Colonne droite : Segments fixes --
    let right = `<div style="font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">Segments fixes</div>`;
    segs.forEach((s, i) => {
      right += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;">
        <input type="text" value="${U.esc(s.label)}" placeholder="Nom" class="acc-inline-input" style="flex:1;min-width:110px;" onchange="Accessoires.setAccSegLabel('${a.id}',${i},this.value)">
        ${U.lenSplit(`sg_${a.id}_${i}`, s.value, { change: `Accessoires.setAccSegment('${a.id}',${i},U.lenCm('sg_${a.id}_${i}'))` })}
        <button class="btn-icon" onclick="Accessoires.delAccFabSeg('${a.id}',${i})" title="Supprimer">×</button></div>`;
    });
    right += `<div style="margin-top:6px;"><button class="btn-ghost btn-sm" onclick="Accessoires.addAccFabSeg('${a.id}')">＋ Segment</button></div>`;

    // -- Bas pleine largeur : résultat sangle(s), toujours 2 blocs égaux côte à côte --
    let bottom = '';
    if (this._colorCount(a) >= 2) {
      bottom = `<div style="display:flex;gap:12px;margin-top:12px;flex-wrap:wrap;">${this._colorParts(a).map(p => `<div style="flex:1;min-width:150px;text-align:center;padding:10px;border-radius:6px;background:var(--th-bg);border:1px solid var(--input-border);">
          <div class="muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.03em;">Couleur ${p.k} — ${U.esc(p.title)}</div>
          <b style="font-size:1.15rem;">${U.qty(p.qty)} m</b></div>`).join('')}</div>`;
    } else if (totalStrap > 0) {
      bottom = `<div style="margin-top:12px;padding:10px 16px;border-radius:6px;background:var(--th-bg);border:1px solid var(--input-border);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:500;">${(a.fabSections || []).length ? 'Sangle principale à couper' : 'Sangle à couper'}</span><b style="font-size:1.15rem;">${U.qty(totalStrap)} m</b></div>`;
    }
    (a.fabSections || []).forEach(s => {
      bottom += `<div style="margin-top:8px;padding:10px 16px;border-radius:6px;background:var(--th-bg);border:1px solid var(--input-border);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-weight:500;">📏 ${U.esc(s.label || 'Section')}${s.width ? ' <span class="muted">— sangle ' + U.esc(s.width) + '</span>' : ''} <span class="muted">(${(s.segs || []).filter(g => U.num(g.value) > 0).map(g => U.esc(g.label || 'segment') + ' ' + U.lenTxt(g.value)).join(' + ') || 'à renseigner dans Modifier'})</span></span><b style="font-size:1.15rem;">${U.qty(this._secTotalCm(s) / 100)} m</b></div>`;
    });

    const body = `<div style="display:flex;gap:20px;margin-top:10px;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">${left}</div>
      <div style="flex:1;min-width:200px;">${right}</div>
    </div>${bottom}`;

    return `<details class="card" style="margin-bottom:8px;padding:8px 12px;background:var(--th-bg);" ${fabOpen ? 'open' : ''} ontoggle="Accessoires.setFabOpen('${a.id}',this.open)">
      <summary style="cursor:pointer;list-style:none;"><b>📐 Longueurs de fabrication</b>${this._fabSummary(a)}</summary>${body}</details>`;
  },

  _availableWidths() {
    const S = Store.state.settings;
    return (S.widths || []).slice().sort((a, b) => parseInt(a) - parseInt(b));
  },
  _normalizeWidths(a) {
    if (a.strapWidth && !a.strapWidths) a.strapWidths = [a.strapWidth];
    return a.strapWidths || [];
  },
  toggleWidth(w) {
    const ws = this._a.strapWidths || [];
    const idx = ws.indexOf(w);
    if (idx >= 0) ws.splice(idx, 1); else ws.push(w);
    this._a.strapWidths = ws;
    if (ws.length === 1) this._a.mainWidth = ws[0];
    else if (this._a.mainWidth && !ws.includes(this._a.mainWidth)) this._a.mainWidth = ws[0] || '';
    this._ensureStrap(); this.syncStrap();
    const el = document.getElementById('a_widths_wrap');
    if (el) el.innerHTML = this._widthsSelectHTML();
    this._syncIdentity();
  },
  setAllWidths(all) {
    this._a.strapWidths = all ? this._availableWidths().slice() : [];
    if (!all || this._a.strapWidths.length === 1) this._a.mainWidth = this._a.strapWidths[0] || '';
    this._ensureStrap(); this.syncStrap();
    const el = document.getElementById('a_widths_wrap');
    if (el) el.innerHTML = this._widthsSelectHTML();
    this._syncIdentity();
  },
  setMainWidth(w) {
    this._a.mainWidth = w;
    const el = document.getElementById('a_widths_wrap');
    if (el) el.innerHTML = this._widthsSelectHTML();
    this._syncIdentity();
  },
  onWidthsOpen(open) { this._widthsOpen = open; },
  /* SKU TYPE-LARGEUR-NOM proposé d'après le formulaire (type, largeur principale, nom) ; en cas de collision avec un autre SKU : suffixe -2, -3… */
  _takenSkus(exceptId) {
    const s = new Set(), add = v => { v = String(v || '').trim().toUpperCase(); if (v) s.add(v); };
    Store.state.catalogA.forEach(x => { if (x.id !== exceptId) add(x.sku); });
    Store.state.stockM.forEach(p => (p.variants || []).forEach(v => add(v.sku)));
    Store.state.catalogM.forEach(p => (p.variants || []).forEach(v => add(v.sku)));
    return s;
  },
  /* SKU proposé d'après le formulaire (type, largeur principale, nom, longueur du produit fini, UV / laser), unique parmi les autres fiches. */
  _formSku() {
    const a = this._a, ws = a.strapWidths || [];
    const base = Pricing.autoSkuAcc({ category: U.val('a_cat'), name: U.val('a_name'), mainWidth: a.mainWidth || ws[0] || '', productLength: U.lenCm('a_prodLen') / 100, uv: U.chk('a_uv'), laser: U.chk('a_laser'), sizeLabel: U.val('a_sizeLabel') });
    const taken = this._takenSkus(a.id); let sku = base, n = 1;
    while (base && taken.has(sku)) { n++; sku = base + '-' + n; }
    return { base, sku, n };
  },
  genSku() {
    this.onProdLenChange();   // le nom reçoit d'abord la longueur du produit fini
    const { base, sku, n } = this._formSku();
    if (!base) { U.toast('Choisis un type et un nom pour générer le SKU.', true); return; }
    document.getElementById('a_sku').value = sku;
    U.toast(`SKU proposé : ${sku}${n > 1 ? ' (le SKU de base existait déjà)' : ''}`);
  },
  /* Personnalisation (Antho 2026-10-13) : impression UV et/ou gravure laser. Nom : « … — Personnalisation UV — Gravure laser » ; SKU : « …-UV-LASER ». */
  /* Création de thème UV (Antho 2026-10-14) = impression UV AVEC un visuel créé pour le client : « … — Création thème UV » (remplace « Personnalisation UV »), SKU « …-UV-THEME ». */
  _PERSO_RX: /(\s*[—–-]\s*(personnalisation\s+uv|cr[ée]ation\s+th[èe]me\s+uv|gravure\s+laser))+\s*$/i,
  _persoName(name, uv, laser, theme) {
    const base = String(name || '').replace(this._PERSO_RX, '').trimEnd();
    return base ? base + (theme ? ' — Création thème UV' : uv ? ' — Personnalisation UV' : '') + (laser ? ' — Gravure laser' : '') : base;
  },
  /* SKU avec les bons suffixes (-UV, -THEME puis -LASER), avant un éventuel -2 de collision ; un « -5 » sans suffixe fait partie du nom. */
  _persoSku(sku, uv, laser, theme) {
    const m = String(sku).match(/^(.*?)((?:-UV)?(?:-THEME)?(?:-LASER)?)((?:-\d+)?)$/i);
    let base = m[1], tags = m[2], num = m[3];
    if (!tags && num) { base += num; num = ''; }
    return base + (uv || theme ? '-UV' : '') + (theme ? '-THEME' : '') + (laser ? '-LASER' : '') + num;
  },
  /* Cases « Personnalisation UV » / « Gravure laser » : cochée → le NOM et le SKU déjà écrit prennent leur suffixe et la case des ml / minutes apparaît à droite ; décochée → tout est retiré (valeur remise à 0). Un SKU vide n'est pas inventé : bouton « Générer ». */
  onPersoToggle(which) {
    // « Création thème UV » = impression UV avec visuel créé : elle coche l'impression UV ; décocher l'impression UV décoche le thème
    const uvEl = document.getElementById('a_uv'), thEl = document.getElementById('a_theme');
    if (which === 'theme' && thEl && thEl.checked && uvEl) uvEl.checked = true;
    if (which === 'uv' && uvEl && !uvEl.checked && thEl) thEl.checked = false;
    const uv = U.chk('a_uv'), laser = U.chk('a_laser'), theme = U.chk('a_theme');
    [['a_uvml', uv, 'uv'], ['a_lasermin', laser, 'laser']].forEach(([id, on, w]) => {
      const el = document.getElementById(id); if (!el) return;
      el.style.display = on ? '' : 'none';
      if (!on) el.value = ''; else if (w === which || (which === 'theme' && w === 'uv')) el.focus({ preventScroll: true });
    });
    const nm = document.getElementById('a_name');
    if (nm) { const v = this._persoName(nm.value, uv, laser, theme); if (v !== nm.value) nm.value = v; }
    const el = document.getElementById('a_sku'); if (!el) return;
    const old = el.value.trim(); if (!old) return;
    const sku = this._persoSku(old, uv, laser, theme); if (sku === old) return;
    el.value = sku;
    const taken = this._takenSkus(this._a.id);
    if (taken.has(sku.toUpperCase())) U.toast(`SKU ${sku} : déjà utilisé par une autre fiche.`, true);
    else U.toast(`SKU mis à jour : ${sku}`);
  },
  _widthsSelectHTML() {
    const widths = this._availableWidths();
    const sel = this._a.strapWidths || [];
    const main = this._a.mainWidth || '';
    let html = U.multiSelect({
      options: widths, selected: sel,
      toggle: 'Accessoires.toggleWidth', setAll: 'Accessoires.setAllWidths',
      open: this._widthsOpen, onOpen: 'Accessoires.onWidthsOpen',
      placeholder: '— Toutes —'
    });
    if (sel.length >= 2) {
      html += `<div style="margin-top:6px;font-size:.82rem;"><span class="muted">Largeur principale (sert au SKU) :</span> ${sel.map(w =>
        `<button class="btn-sm ${w === main ? 'btn-ok' : 'btn-ghost'}" style="margin:2px;" onclick="Accessoires.setMainWidth('${U.esc(w)}')">${w === main ? '★ ' : ''}${U.esc(w)}</button>`
      ).join('')}</div>`;
    }
    return html;
  },

  _fabDefaults(cat) {
    return (Store.state.settings.accFabDefaults || {})[cat]?.segments || [];
  },

  _fabFieldsHTML(a) {
    const segs = a.fabSegments || [];
    const interne = U.num(a.internalLength), sized = !!a.sizeLabel || /collier/i.test(a.category || '');
    const refLabel = sized ? `Tour de cou de référence ${U.info("Colliers : le tour de cou pour lequel la longueur interne X ci-dessous est réglée (ex. 40 cm). Cette formule (segments, sections, X, référence) est la MÊME pour toutes les tailles du collier : à l'enregistrement, je te propose de l'appliquer aux autres tailles. Seuls le nom, la taille, la fourchette et le stock sont propres à chaque taille.")}` : 'Longueur produit fini';
    return `<div class="fg"><label>${refLabel}</label><div>${U.lenSplit('a_prodLen', U.num(a.productLength) * 100, { change: 'Accessoires.onProdLenChange()' })}</div></div>
      <div style="margin-top:12px;padding:12px;border-radius:8px;border:1px solid var(--input-border);background:var(--th-bg);">
        <div style="font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">Détail des longueurs</div>
        <div style="font-weight:700;font-size:.9rem;margin-bottom:6px;">Section principale <span class="muted" style="font-weight:400;font-size:.8rem;">— calculée avec X (sangle ${U.esc(a.mainWidth || (a.strapWidths || [])[0] || 'principale')})</span></div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 10px;border:1px solid var(--caramel);border-radius:8px;margin-bottom:6px;text-transform:none;letter-spacing:0;color:var(--texte);">
          <input id="a_bicolor" type="checkbox" style="width:15px;height:15px;flex:0 0 auto;" ${a.bicolor ? 'checked' : ''} onchange="Accessoires.onBicolor()">
          <span><b style="font-size:.85rem;">🎨 Bicolor — sangles de couleurs différentes</b><br><span class="muted" id="a_bicolor_sub" style="font-size:.72rem;">${this._colorSubText(a)}</span></span>
        </label>
        <div id="a_segs_wrap">${this._fabSegsInnerHTML(segs)}</div>
        <div id="a_secs_wrap">${this._secsHTML()}</div>
        <button class="btn-ghost btn-sm mt" type="button" onclick="Accessoires.addSection()" title="Une section en plus, non liée à X (ex. surpiqûre) : elle a sa propre largeur de sangle et ses propres longueurs">＋ Ajouter une section</button>
        <div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--input-border);">
          <div class="fg"><label>Longueur interne — X</label><div>${U.lenSplit('a_internLen', interne, { change: 'Accessoires.syncStrap()' })}</div></div>
          <div id="a_xnote" class="muted" style="font-size:.8rem;margin-top:4px;">${this._xNoteTxt(a)}</div>
        </div>
      </div>`;
  },

  /* ── Formule commune aux tailles d'un collier (Antho 2026-11-01) : segments, sections, bicolor, X, tour de cou de référence et lignes de sangle ── */
  _formulaSig(a) {
    const sg = (a.fabSegments || []).map(s => [String(s.label || ''), U.num(s.value)]);
    const sc = (a.fabSections || []).filter(s => s.label || this._secTotalCm(s) > 0).map(s => [s.id, String(s.label || ''), s.width || '', (s.segs || []).map(g => [String(g.label || ''), U.num(g.value)])]);
    return JSON.stringify([sg, sc, !!a.bicolor, !!a.bicolorEnds, U.num(a.internalLength), U.num(a.productLength),
      (a.bom || []).filter(l => this.bomLineUnit(l) === 'm').map(l => [l.familyKey || '', l.materialId || '', l.strapColor || 0, l.secId || ''])]);
  },
  _copyFormula(src, d) {
    const cp = o => JSON.parse(JSON.stringify(o));
    d.fabSegments = cp(src.fabSegments || []);
    if ((src.fabSections || []).length) d.fabSections = cp(src.fabSections); else delete d.fabSections;
    d.bicolor = !!src.bicolor; if (src.bicolorEnds) d.bicolorEnds = true; else delete d.bicolorEnds;
    d.internalLength = src.internalLength; d.productLength = src.productLength;
    d.bom = [...(src.bom || []).filter(l => this.bomLineUnit(l) === 'm').map(cp), ...(d.bom || []).filter(l => this.bomLineUnit(l) !== 'm')];   // sangles de la formule ; pièces (mousquetons…) propres à la taille
    this._applyColors(d); this._autoStrap(d);   // quantités recalculées pour le haut de la fourchette de CETTE taille
  },
  /* Après l'enregistrement d'une taille dont la formule a changé : propose de l'appliquer aux autres tailles du collier (annulable) */
  async _offerFormula(a) {
    const sibs = this._grpMembers(a.groupId).filter(x => x.id !== a.id && x.sizeLabel && this._formulaSig(x) !== this._formulaSig(a));
    if (!sibs.length) return;
    const names = sibs.map(x => x.sizeLabel).join(', ');
    if (!await U.confirm(`Appliquer ces longueurs (segments, sections, X, tour de cou de référence, sangles) aux autres tailles : ${names} ? Leurs propres longueurs sont remplacées ; nom, fourchette, stock, prix et pièces ne changent pas. Le coût de chaque taille est recalculé sur le haut de sa fourchette.`, { title: '📐 Formule commune aux tailles', okLabel: 'Appliquer' })) return;
    const entry = this._grpTouch(sibs, s => this._copyFormula(a, s), `Longueurs communes appliquées à ${sibs.length} taille(s) — ${a.groupName || ''}`);
    U.toast(`Longueurs appliquées aux tailles ${names}.`, false, entry.id);
  },
  /* Sous X : à quel tour de cou le coût de cette taille est calculé (haut de la fourchette) */
  _xNoteTxt(a) {
    const r = a.sizeLabel ? this._rangeOf(a) : null, ref = U.num(a.productLength) * 100;
    if (!r || !(ref > 0)) return '';
    return `Coût de cette taille calculé pour le haut de la fourchette (${U.lenTxt(r.max)}) : X = ${U.lenTxt(this._xEff(a))}.`;
  },
  /* Fourchette de tour de cou modifiée : le coût de la taille (haut de la fourchette) suit */
  onRangeChange() { if (this._a) { this._a.sizeRange = U.val('a_range').trim(); this.syncStrap(); } },

  /* ── Sections en plus de la principale (fenêtre Modifier) ── */
  _secWidths() { const ws = (this._a && this._a.strapWidths) || []; return ws.length ? ws : this._availableWidths(); },
  _secTotTxt(s) { return `Sangle ${U.esc(s.width || '?')} à couper : <b>${U.qty(this._secTotalCm(s) / 100)} m</b>`; },
  _secsHTML() {
    const a = this._a, ws = this._secWidths();
    return (a.fabSections || []).map((s, si) => {
      const opts = ws.includes(s.width) || !s.width ? ws : [s.width, ...ws];
      return `<div style="margin-top:12px;padding:10px;border-radius:8px;border:1px solid var(--caramel);">
      <div class="frow" style="gap:8px;align-items:flex-end;">
        <div class="fg" style="flex:2;"><label>Section</label><input id="a_sec_label_${si}" value="${U.esc(s.label)}" placeholder="ex: Surpiqûre" style="width:100%;" onchange="Accessoires.syncStrap()"></div>
        <div class="fg" style="flex:0 0 120px;min-width:0;"><label>Sangle</label><select id="a_sec_w_${si}" onchange="Accessoires.syncStrap()">${opts.map(w => `<option value="${U.esc(w)}" ${w === s.width ? 'selected' : ''}>${U.esc(w)}</option>`).join('')}</select></div>
        <div class="fg" style="flex:0;"><button class="btn-icon" type="button" title="Supprimer la section" onclick="Accessoires.delSection(${si})">🗑️</button></div>
      </div>
      ${(s.segs || []).map((g, i) => `<div class="frow" style="gap:8px;align-items:flex-end;margin-top:6px;">
        <div class="fg" style="flex:2;"><input id="a_sec_seg_label_${si}_${i}" value="${U.esc(g.label)}" placeholder="ex: Bande de couleur" style="width:100%;" onchange="Accessoires.syncStrap()"></div>
        <div class="fg" style="flex:0 0 auto;">${U.lenSplit(`a_sec_seg_val_${si}_${i}`, g.value, { change: 'Accessoires.syncStrap()' })}</div>
        <div class="fg" style="flex:0;"><button class="btn-icon" type="button" onclick="Accessoires.delSecSeg(${si},${i})">×</button></div>
      </div>`).join('')}
      <button class="btn-ghost btn-sm mt" type="button" onclick="Accessoires.addSecSeg(${si})">＋ Ajouter un segment</button>
      <div id="a_sec_tot_${si}" class="muted" style="margin-top:8px;font-size:.85rem;">${this._secTotTxt(s)}</div>
    </div>`;
    }).join('');
  },
  _readSecs() {
    ((this._a && this._a.fabSections) || []).forEach((s, si) => {
      const lb = document.getElementById('a_sec_label_' + si); if (!lb) return;
      s.label = lb.value.trim();
      const w = document.getElementById('a_sec_w_' + si); if (w) s.width = w.value;
      (s.segs || []).forEach((g, i) => {
        const gl = document.getElementById(`a_sec_seg_label_${si}_${i}`); if (gl) g.label = gl.value.trim();
        if (document.getElementById(`a_sec_seg_val_${si}_${i}_m`)) g.value = U.lenCm(`a_sec_seg_val_${si}_${i}`);
      });
    });
  },
  _redrawSecs() { const el = document.getElementById('a_secs_wrap'); if (el) el.innerHTML = this._secsHTML(); },
  addSection() {
    this._readFabSegs(); this._readSecs();
    const a = this._a, ws = this._secWidths(), main = a.mainWidth || (a.strapWidths || [])[0] || '';
    (a.fabSections = a.fabSections || []).push({ id: U.uid(), label: '', width: ws.find(w => w !== main) || ws[0] || '', segs: [{ label: '', value: 0 }] });
    this._redrawSecs(); this.syncStrap();
  },
  delSection(si) {
    this._readSecs();
    if (this._a.fabSections) this._a.fabSections.splice(si, 1);
    this._redrawSecs(); this.syncStrap();
  },
  addSecSeg(si) {
    this._readSecs();
    const s = (this._a.fabSections || [])[si]; if (!s) return;
    (s.segs = s.segs || []).push({ label: '', value: 0 });
    this._redrawSecs(); this.syncStrap();
  },
  delSecSeg(si, i) {
    this._readSecs();
    const s = (this._a.fabSections || [])[si]; if (!s) return;
    s.segs.splice(i, 1);
    this._redrawSecs(); this.syncStrap();
  },

  _fabSegsInnerHTML(segs) {
    return (segs || []).map((s, i) => `<div class="frow" style="gap:8px;align-items:flex-end;margin-top:6px;">
      <div class="fg" style="flex:2;"><input id="a_seg_label_${i}" value="${U.esc(s.label)}" placeholder="ex: Rabat" style="width:100%;" onchange="Accessoires.syncStrap()"></div>
      <div class="fg" style="flex:0 0 auto;">${U.lenSplit('a_seg_val_' + i, s.value, { change: 'Accessoires.syncStrap()' })}</div>
      <div class="fg" style="flex:0;"><button class="btn-icon" type="button" onclick="Accessoires.delFabSeg(${i})">×</button></div>
    </div>${i === 0 ? this._endsToggleHTML(segs) : ''}`).join('') + `<button class="btn-ghost btn-sm mt" type="button" onclick="Accessoires.addFabSeg()">＋ Ajouter un segment</button>`;
  },

  /* Petite case entre le 1er et le 2e segment : « ces extrémités n'ont pas la même couleur » → 3 couleurs (visible seulement en bicolor, avec ≥ 2 segments) */
  _endsToggleHTML(segs) {
    if (!(this._a && this._a.bicolor && segs.length >= 2)) return '';
    return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:6px 0 0 6px;font-size:.84rem;text-transform:none;letter-spacing:0;color:var(--texte);"><input id="a_bicolorEnds" type="checkbox" ${this._a.bicolorEnds ? 'checked' : ''} onchange="Accessoires.onBicolorEnds()"> <span>Ces 2 sangles ne sont pas de la même couleur <span class="muted">(→ 3 couleurs)</span></span></label>`;
  },
  _readFabSegs() {
    const segs = this._a.fabSegments || [];
    for (let i = 0; i < segs.length; i++) {
      const lbl = document.getElementById('a_seg_label_' + i);
      if (lbl) segs[i].label = lbl.value.trim();
      if (document.getElementById('a_seg_val_' + i + '_m')) segs[i].value = U.lenCm('a_seg_val_' + i);
    }
  },

  addFabSeg() {
    this._readFabSegs();
    if (!this._a.fabSegments) this._a.fabSegments = [];
    this._a.fabSegments.push({ label: '', value: 0 });
    const el = document.getElementById('a_segs_wrap');
    if (el) el.innerHTML = this._fabSegsInnerHTML(this._a.fabSegments);
    this.syncStrap();
  },

  delFabSeg(i) {
    this._readFabSegs();
    if (this._a.fabSegments) this._a.fabSegments.splice(i, 1);
    const el = document.getElementById('a_segs_wrap');
    if (el) el.innerHTML = this._fabSegsInnerHTML(this._a.fabSegments || []);
    this.syncStrap();
  },

  onCatChange() {
    const cat = U.val('a_cat');
    this._readFabSegs();
    const allZero = (this._a.fabSegments || []).every(s => !s.value);
    if (this._isNewA || allZero) {
      const defs = this._fabDefaults(cat).map(s => ({ ...s }));
      const ii = defs.findIndex(s => s.label && s.label.toLowerCase().includes('interne'));
      if (ii >= 0) { this._a.internalLength = U.num(defs[ii].value); defs.splice(ii, 1); }
      this._a.fabSegments = defs;
    }
    this._a.category = cat;
    this._syncIdentity();
    const el = document.getElementById('a_segs_wrap');
    if (el) el.innerHTML = this._fabSegsInnerHTML(this._a.fabSegments || []);
    U.lenSet('a_internLen', U.num(this._a.internalLength));
    if (this._isNewA || !(this._a.bom || []).length) this._a.bom = (this._a.bom || []).filter(l => !(l.tpl && !l.familyKey && !l.materialId)).concat(this._tplLines(cat));
    this.syncStrap();
  },

  /* Nom + SKU suivent le type, la longueur du produit fini et la largeur principale tant qu'ils sont « automatiques » (Antho 2026-10-13) :
     le nom garde ses mots (« Bi-color », « (copie) »…) mais change de type / de longueur ; le SKU est refait seulement s'il est au format automatique TYPE-LARGEUR-… (jamais un SKU tapé à la main). */
  _syncIdentity() {
    const nameEl = document.getElementById('a_name'); if (!nameEl || !document.getElementById('a_prodLen_m')) return;
    const a = this._a, ws = a.strapWidths || [], cat = U.val('a_cat'), len = Math.round(U.lenCm('a_prodLen')) / 100;
    const snap = this._idSnap || { category: cat, mainWidth: a.mainWidth || ws[0] || '' };
    const skuEl = document.getElementById('a_sku'), prev = skuEl ? skuEl.value.trim().toUpperCase() : '';
    const autoPrefix = [Pricing.slugify(snap.category), Pricing.slugify(snap.mainWidth)].filter(Boolean).join('-');
    let name = nameEl.value.trim().replace(this._PERSO_RX, '');
    const sz = U.val('a_sizeLabel'); if (sz || a.sizeLabel) name = this._stripSize(name);   // la taille est (re)posée à la fin, avant la personnalisation
    if (!name) name = cat;
    else if (snap.category && snap.category !== cat && name.toLowerCase().startsWith(snap.category.toLowerCase()) && !/^[A-Za-zÀ-ÿ0-9]/.test(name.slice(snap.category.length))) name = cat + name.slice(snap.category.length);
    if (len > 0) {
      const tok = /(^|[\s—–-])\d+(?:[.,]\d+)?\s*m(?![A-Za-z0-9])/i, txt = Math.round(len * 100) / 100 + 'm';
      if (sz) name = name.replace(tok, '').replace(/\s*[—–-]\s*$/, '').replace(/\s{2,}/g, ' ').trim();   // avec une taille, la longueur de référence quitte le nom
      else if (tok.test(name)) name = name.replace(tok, (m0, p) => p + txt);
      else { const mm = name.match(/^(.*?)\s*(\([^)]*\))?\s*$/); name = mm[1] + ' — ' + txt + (mm[2] ? ' ' + mm[2] : ''); }   // avec une taille, c'est elle qui distingue la fiche : pas de longueur ajoutée au nom
    }
    if (sz) name += ' — Taille ' + sz;
    a.sizeLabel = sz;
    nameEl.value = this._persoName(name, U.chk('a_uv'), U.chk('a_laser'), U.chk('a_theme'));
    this._idSnap = { category: cat, mainWidth: a.mainWidth || ws[0] || '' };
    a.productLength = len;
    if (skuEl && prev && autoPrefix && (prev === autoPrefix || prev.startsWith(autoPrefix + '-'))) {
      const { sku } = this._formSku();
      if (sku && sku.toUpperCase() !== prev) { skuEl.value = sku; U.toast(`SKU mis à jour : ${sku}`); }
    }
  },
  /* Taille S / M / L / XL changée : le nom (« … — Taille L ») et, s'il est au format automatique, le SKU suivent. */
  onSizeChange() { this._syncIdentity(); this.syncStrap(); },
  /* Longueur du produit fini modifiée : la longueur interne bouge du même écart (même règle que « Sur mesure » et la saisie dans la fiche), donc sangle et coût suivent. */
  onProdLenChange() {
    const el = document.getElementById('a_internLen_m'); if (!el) return;
    const oldLen = U.num(this._a.productLength), newLen = Math.round(U.lenCm('a_prodLen')) / 100;
    this._syncIdentity();
    if (oldLen > 0 && newLen > 0 && Math.abs(newLen - oldLen) > 0.0001) {
      const oldInt = U.lenCm('a_internLen'), newInt = Math.max(0, Math.round((oldInt + (newLen - oldLen) * 100) * 10) / 10);
      if (newInt !== oldInt) {
        U.lenSet('a_internLen', newInt);
        this.syncStrap();
        U.toast(`Longueur interne ajustée : ${U.lenTxt(oldInt)} → ${U.lenTxt(newInt)}`);
      }
    }
  },

  editAcc(id) {
    const S = Store.state.settings;
    const fabDefs = S.accFabDefaults || {};
    const a = id ? JSON.parse(JSON.stringify(Store.state.catalogA.find(x => x.id === id)))
      : (() => { const cat = S.accCategories[0]; const defs = (fabDefs[cat]?.segments || []).map(s => ({ ...s })); let internLen = 0; const ii = defs.findIndex(s => s.label && s.label.toLowerCase().includes('interne')); if (ii >= 0) { internLen = U.num(defs[ii].value); defs.splice(ii, 1); } return { id: U.uid(), name: '', category: cat, bom: this._tplLines(cat), laborMinutes: 20, extraCost: 0, coefficient: 2.5, priceTTCManual: '', sku: '', notes: '', handleLength: '', flapLength: '', materialsDesc: '', strapWidths: [], fabSegments: defs, productLength: 0, internalLength: internLen }; })();
    this._normalizeWidths(a);
    this._a = a; this._isNewA = !id; this._widthsOpen = false; this._bomQ = {};
    this._sigOpen = this._isNewA ? '' : this._formulaSig(a);   // pour savoir à l'enregistrement si la formule a changé
    if (!this._isNewA) this._flagManualStrap(a);
    if (!this._isNewA && (!a.fabSegments || !a.fabSegments.length)) {
      const defs = this._fabDefaults(a.category).map(s => ({ ...s }));
      if (defs.length) {
        const ii = defs.findIndex(s => s.label && s.label.toLowerCase().includes('interne'));
        if (ii >= 0 && a.internalLength === undefined) { a.internalLength = U.num(defs[ii].value); defs.splice(ii, 1); }
        a.fabSegments = defs;
      }
    }
    this._idSnap = { category: a.category || '', mainWidth: a.mainWidth || (a.strapWidths || [])[0] || '' };
    U.modal({
      title: id ? U.esc(a.name) : 'Nouvel accessoire', okLabel: 'Enregistrer',
      body: `
      <div class="frow">
        <div class="fg"><label>Type</label><select id="a_cat" onchange="Accessoires.onCatChange()">${S.accCategories.slice().sort(U.sortFr).map(c => `<option ${a.category === c ? 'selected' : ''}>${U.esc(c)}</option>`).join('')}</select></div>
        <div class="fg"><label>Largeur</label><div id="a_widths_wrap">${this._widthsSelectHTML()}</div></div>
      </div>
      <div class="frow">
        <div class="fg" style="flex:2;"><label>Nom</label><input id="a_name" value="${U.esc(a.name || a.category)}" placeholder="ex: Longe 5m — 20mm"></div>
        <div class="fg" style="flex:0 0 90px;min-width:0;"><label>Taille</label><select id="a_sizeLabel" onchange="Accessoires.onSizeChange()">${['', 'S', 'M', 'L', 'XL'].concat(a.sizeLabel && !['S', 'M', 'L', 'XL'].includes(a.sizeLabel) ? [a.sizeLabel] : []).map(t => `<option value="${U.esc(t)}" ${t === (a.sizeLabel || '') ? 'selected' : ''}>${t ? U.esc(t) : '—'}</option>`).join('')}</select></div>
        <div class="fg" style="flex:0 0 190px;max-width:100%;"><label>Tour de cou ${U.info("Fourchette de tour de cou de la taille (ex. 38–45 cm) : sert à choisir la taille d'un devis et à retrouver la taille quand tu tapes un tour de cou dans « 📏 Calculer ». Le HAUT de la fourchette sert aussi à calculer le coût de la taille (la sangle d'un collier au plus grand tour de cou).")}</label><input id="a_range" value="${U.esc(a.sizeRange || '')}" placeholder="ex : 38–45 cm" onchange="Accessoires.onRangeChange()"></div>
      </div>
      <h2 style="font-size:.95rem;">Matières utilisées ${(a.strapWidths||[]).length ? '' : '<span class="muted" style="font-weight:normal;font-size:.8rem;">(coût moyen par famille)</span>'}</h2>
      <p class="muted help">La sangle se calcule toute seule d'après « Longueurs de fabrication » (en bas) : tu n'as pas à la saisir. Mousquetons, rivets, anneaux… : choisis la catégorie puis la référence, avec la quantité. Les lignes sans référence sont ignorées à l'enregistrement.</p>
      <div id="a_bom" data-onclose="Accessoires.closeBomPick"></div>
      <button class="btn-ghost btn-sm" onclick="Accessoires.addBom()">＋ Ajouter une matière</button>
      <hr class="sep">
      <div class="frow">
        <div class="fg"><label>Main d'œuvre (minutes)</label><input id="a_min" type="number" step="1" value="${a.laborMinutes}"></div>
        <div class="fg"><label>Autres coûts (€)</label><input id="a_extra" type="number" step="0.01" value="${a.extraCost}"></div>
        <div class="fg"><label>Coefficient</label><input id="a_coeff" type="number" step="0.01" value="${a.coefficient}"></div>
        <div class="fg"><label>Prix TTC forcé (option)</label><input id="a_pttc" type="number" step="0.10" value="${a.priceTTCManual}" placeholder="laisser vide = coeff"></div>
      </div>
      <div class="frow">
        <div class="fg"><label>SKU (option)</label><div style="display:flex;gap:6px;"><input id="a_sku" style="flex:1;min-width:0;" value="${U.esc(a.sku || '')}" placeholder="TYPE-LARGEUR-NOM"><button type="button" class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Accessoires.genSku()" title="Génère le SKU : type - largeur principale - nom (ex. LONGE-20MM-5M, + -UV si impression UV). La couleur n'y entre jamais.">✨ Générer</button></div></div>
      </div>
      <div class="frow">
        <div class="fg"><label>🎨 Personnalisation</label>${(() => { const uvOn = a.uv !== undefined ? !!a.uv : U.num(a.uvMl) > 0, laOn = !!a.laser;
          const lab = 'display:flex;align-items:center;gap:8px;cursor:pointer;text-transform:none;letter-spacing:0;color:var(--texte);font-size:.9rem;margin:0;white-space:nowrap;';
          return `<div style="display:flex;align-items:center;gap:8px 22px;flex-wrap:wrap;min-height:40px;">
            <span style="display:flex;align-items:center;gap:12px;"><label style="${lab}"><input id="a_uv" type="checkbox" style="width:16px;height:16px;" ${uvOn ? 'checked' : ''} onchange="Accessoires.onPersoToggle('uv')"> Impression UV</label><input id="a_uvml" type="number" step="0.1" min="0" value="${a.uvMl || ''}" placeholder="ml d'encre" style="width:120px;margin:0;${uvOn ? '' : 'display:none;'}"></span>
            <span style="display:flex;align-items:center;gap:12px;"><label style="${lab}" title="Impression UV avec un visuel créé pour le client (supplément plus élevé, réglé dans Paramètres)"><input id="a_theme" type="checkbox" style="width:16px;height:16px;" ${a.theme ? 'checked' : ''} onchange="Accessoires.onPersoToggle('theme')"> Création thème UV</label></span>
            <span style="display:flex;align-items:center;gap:12px;"><label style="${lab}"><input id="a_laser" type="checkbox" style="width:16px;height:16px;" ${laOn ? 'checked' : ''} onchange="Accessoires.onPersoToggle('laser')"> Gravure laser</label><input id="a_lasermin" type="number" step="0.5" min="0" value="${a.laserMin || ''}" placeholder="minutes" style="width:110px;margin:0;${laOn ? '' : 'display:none;'}"></span></div>`; })()}</div>
      </div>
      <div class="frow">
        <div class="fg" style="flex:0 0 260px;max-width:100%;"><label>🧊 Impression 3D (minutes) ${U.info("Durée d'impression 3D de la pièce : le coût d'électricité et d'usure de l'imprimante (Paramètres → Accessoires → Imprimante 3D) s'ajoute au coût de revient. Le filament se met dans « Matières utilisées » (en grammes, matière de type Filament 3D). Laisse vide si la pièce n'est pas imprimée en 3D.")}</label><input id="a_p3d" type="number" step="1" min="0" value="${a.print3dMin || ''}" placeholder="0 = pas d'impression 3D"></div>
      </div>
      <h2 style="font-size:.95rem;">📐 Longueurs de fabrication</h2>
      <div id="a_fab_row">
        ${this._fabFieldsHTML(a)}
      </div>
      <h2 style="font-size:.95rem;">📝 Notes</h2>
      <div class="frow">
        <div class="fg" style="flex:2;"><label>Matières utilisées</label><input id="a_matdesc" value="${U.esc(a.materialsDesc || '')}" placeholder="ex: sangle noire 20mm, mousqueton laiton"></div>
      </div>
      <div class="fg" style="margin-top:4px;"><label>Notes libres</label><textarea id="a_notes" rows="3" placeholder="Informations, rappels…" style="width:100%;resize:vertical;">${U.esc(a.notes || '')}</textarea></div>`,
      onOk: () => {
        a.name = U.val('a_name').trim();
        if (!a.name) { U.toast('Nom obligatoire', true); return false; }
        a.category = U.val('a_cat'); a.laborMinutes = U.numVal('a_min'); a.extraCost = U.numVal('a_extra');
        a.coefficient = U.numVal('a_coeff'); a.priceTTCManual = U.val('a_pttc');
        a.sku = U.val('a_sku'); a.theme = U.chk('a_theme'); if (!a.theme) delete a.theme; a.uv = U.chk('a_uv') || !!a.theme; a.uvMl = a.uv ? U.numVal('a_uvml') : 0; a.laser = U.chk('a_laser'); a.laserMin = a.laser ? U.numVal('a_lasermin') : 0; a.strapWidths = this._a.strapWidths || []; a.mainWidth = this._a.mainWidth || ''; delete a.strapWidth;
        a.notes = U.val('a_notes'); a.print3dMin = U.numVal('a_p3d');
        a.sizeRange = U.val('a_range').trim(); if (!a.sizeRange) delete a.sizeRange;
        a.sizeLabel = U.val('a_sizeLabel'); if (!a.sizeLabel) delete a.sizeLabel;
        this._readFabSegs(); this._readSecs();
        a.fabSegments = this._a.fabSegments || [];
        a.fabSections = (this._a.fabSections || []).filter(s => s.label || this._secTotalCm(s) > 0);   // une section vide (ni nom ni longueur) est ignorée
        if (!a.fabSections.length) delete a.fabSections;
        a.productLength = U.lenCm('a_prodLen') / 100;
        a.internalLength = U.lenCm('a_internLen');
        a.bicolor = !!document.getElementById('a_bicolor')?.checked;
        // lignes sans référence ignorées ; champs de travail du formulaire retirés ; sangle recalculée d'après les longueurs
        const nBefore = (a.bom || []).length;
        a.bom = (a.bom || []).filter(l => l.familyKey || l.materialId).map(l => { const c = { ...l }; delete c._cat; delete c.tpl; return c; });
        this._autoStrap(a);
        a.bom = a.bom.filter(l => l.familyKey || l.materialId);   // la sangle d'une section sans référence (largeur absente du stock) est ignorée aussi
        if (a.bom.length < nBefore) U.toast(`${nBefore - a.bom.length} ligne(s) de matière sans référence ignorée(s).`);
        a.materialsDesc = U.val('a_matdesc').trim();
        const idx = Store.state.catalogA.findIndex(x => x.id === a.id);
        const before = idx >= 0 ? JSON.parse(JSON.stringify(Store.state.catalogA[idx])) : null;
        if (idx >= 0) Store.state.catalogA[idx] = a; else Store.state.catalogA.push(a);
        this.ensureFamilies();   // un nouvel accessoire est tout de suite un produit (famille), comme les autres
        if (a.groupId) this._grpOpen[a.groupId] = true;
        const entry = Store.log('accessoires', (this._isNewA ? 'Accessoire créé' : 'Accessoire modifié') + ' — ' + a.name,
          this._isNewA ? { type: 'deleteCreated', data: { domain: 'catalogA', id: a.id } } : { type: 'restoreItem', data: { domain: 'catalogA', id: a.id, before } });
        Store.save('catalogA'); U.closeModal(); App.rerender();
        U.toast(this._isNewA ? 'Accessoire créé.' : 'Modification enregistrée.', false, entry.id);
        if (a.groupId && a.sizeLabel && this.isSizedFam(a.groupId) && this._formulaSig(a) !== this._sigOpen) this._offerFormula(a);
      }
    });
    this.drawBom();
  },

  /* ---------- BOM picker (familles) ---------- */
  _bomLabel(l) {
    if (!l) return '';
    if (l.familyKey) {
      const fam = this.families().find(f => f.key === l.familyKey);
      if (!fam) return l.familyKey;
      return `${fam.label} (moy. ${U.eur(fam.avgCost)}/${Store.matUnitLabel(fam.unit)})`;
    }
    if (l.materialId) {
      const m = Store.material(l.materialId);
      return m ? `${m.name} (${U.eur(this.matCost(m))}/${Store.matUnitLabel(m.unit)})` : '';
    }
    return '';
  },

  /* Le texte (nom de produit) contient-il l'une des largeurs de sangle `ws` ? « Mousqueton 20mm » / « 20 mm » → vrai pour ['20mm'] ; « 120mm » → faux. */
  _labelHasWidth(txt, ws) {
    return ws.some(w => {
      const n = parseFloat(String(w).replace(',', '.')); if (!n) return false;
      return new RegExp('(^|[^\\d.,])' + String(n).replace('.', '[.,]') + '\\s*mm(?![a-z])', 'i').test(String(txt || ''));
    });
  },

  /* Le texte (nom de produit) cite-t-il une largeur en mm qui n'est PAS parmi celles choisies ? « mousqueton 25mm » avec 20mm choisi → vrai (peu importe l'unité de la matière). */
  _otherWidthOnly(txt, ws) {
    const found = [...String(txt || '').matchAll(/(?:^|[^\d.,])(\d+(?:[.,]\d+)?)\s*mm(?![a-z])/gi)].map(m => m[1].replace(',', '.') + 'mm');
    if (!found.length) return false;
    const wsn = ws.map(w => this._normWidth(w));
    return !found.some(w => wsn.includes(w));
  },

  _bomListHTML(i) {
    const fams = this.families();
    const cat = (this._a.bom[i] || {})._cat || '';
    const q = (this._bomQ[i] || '').toLowerCase();
    const ws = (this._a.strapWidths || []);
    let items = [];

    let filtered = fams.filter(f => ws.length || !f.bySize);   // les familles « type + taille » n'apparaissent que si une largeur de sangle est choisie
    if (cat) filtered = filtered.filter(f => f.kind === cat);

    if (ws.length) {
      filtered.forEach(f => {
        if (Store.isSangleKind(f.kind)) {
          if (ws.some(w => f.key === f.kind + ':' + w)) items.push({ type: 'family', data: f });
        } else if (f.bySize) {
          if (ws.some(w => this._normWidth(w) === f.size)) items.push({ type: 'family', data: f });
        } else if (f.unit === 'piece') {
          // boucleries + toute catégorie à la pièce (mousqueton, anneau…) : sélection par article, filtrée par largeur
          // produit dédié à une largeur (« Mousqueton 20mm », variantes = finitions) : la famille (prix moyen) est proposée, puis chaque article
          // produit « Toutes les tailles » (rivets, clous, décorations…) : proposé quelle que soit la largeur choisie
          const dedicated = this._labelHasWidth(f.label, ws), allW = f.materials.every(m => m.allSizes);
          if (dedicated || allW) items.push({ type: 'family', data: f });
          const wsn = ws.map(w => this._normWidth(w)), compatible = f.materials.filter(m => dedicated || m.allSizes || ((!m.variant || ws.includes(m.variant) || wsn.includes(this._sizeOf(m))) && !this._otherWidthOnly(m.product || m.name, ws)));
          compatible.forEach(m => items.push({ type: 'material', data: m, family: f }));
        } else if (!this._otherWidthOnly(f.label, ws)) {
          items.push({ type: 'family', data: f });   // autre unité (m…) : proposée sauf si son nom cite une autre largeur
        }
      });
    } else {
      filtered.forEach(f => items.push({ type: 'family', data: f }));
    }

    if (q) items = items.filter(it => {
      const label = it.type === 'family' ? it.data.label : it.data.name;
      return U.has(label, q);
    });

    if (!items.length) return '<div class="ac-item muted">Aucun résultat</div>';
    return items.map(it => {
      if (it.type === 'family') {
        const f = it.data;
        return `<div class="ac-item pp-row" onmousedown="event.preventDefault();Accessoires.pickBomFamily(${i},'${U.esc(f.key)}')"><span class="pp-a">${U.esc(f.label)}</span><span class="pp-b">${f.count} réf.</span><span class="pp-c">moy. ${U.eur(f.avgCost)} / ${Store.matUnitLabel(f.unit)}</span></div>`;
      }
      const m = it.data;
      const unit = Store.matUnitLabel(m.unit);
      return `<div class="ac-item pp-row" onmousedown="event.preventDefault();Accessoires.pickBomMaterial(${i},'${m.id}')"><span class="pp-a">${U.esc(m.name)}</span><span class="pp-b">stock ${U.qty(m.qty)} ${unit}</span><span class="pp-c">${U.eur(this.matCost(m))} / ${unit}</span></div>`;
    }).join('');
  },

  openBomPick(i) {
    if (this._bomOpen >= 0 && this._bomOpen !== i) {
      const prev = document.getElementById('a_bom_list_' + this._bomOpen);
      if (prev) prev.style.display = 'none';
      const prevIn = document.getElementById('a_bom_q_' + this._bomOpen);
      if (prevIn) prevIn.value = this._bomLabel(this._a.bom[this._bomOpen]);
    }
    this._bomOpen = i;
    this._bomQ[i] = '';
    const input = document.getElementById('a_bom_q_' + i);
    if (input) input.value = '';
    const listEl = document.getElementById('a_bom_list_' + i);
    if (listEl) { listEl.style.display = ''; listEl.innerHTML = this._bomListHTML(i); }
  },

  filterBomPick(i, v) {
    this._bomQ[i] = v;
    const listEl = document.getElementById('a_bom_list_' + i);
    if (listEl) listEl.innerHTML = this._bomListHTML(i);
  },

  closeBomPick() {
    if (this._bomOpen < 0) return;
    const i = this._bomOpen;
    this._bomOpen = -1;
    const listEl = document.getElementById('a_bom_list_' + i);
    if (listEl) listEl.style.display = 'none';
    const input = document.getElementById('a_bom_q_' + i);
    if (input) input.value = this._bomLabel(this._a.bom[i]);
  },

  setBomCat(i, v) {
    const l = this._a.bom[i]; if (!l) return;
    l._cat = v;
    if (v && l.familyKey) {
      const fam = this.families().find(f => f.key === l.familyKey);
      if (fam && fam.kind !== v) {
        this._a.bom[i] = { familyKey: '', qty: l.qty || 1, _cat: v, ...(l.secId ? { secId: l.secId, secW: l.secW } : {}) };
        this.drawBom();
        return;
      }
    }
    if (this._bomOpen === i) {
      const listEl = document.getElementById('a_bom_list_' + i);
      if (listEl) listEl.innerHTML = this._bomListHTML(i);
    }
  },

  /* Choisir une référence garde le reste de la ligne (couleur de sangle 1/2, catégorie) ; une sangle reprend la quantité calculée. */
  _pickInto(i, ref) {
    const o = this._a.bom[i] || {};
    const n = { ...o, qty: o.qty || 1 }; delete n.familyKey; delete n.materialId; delete n.qtyManual; delete n.tpl;
    this._a.bom[i] = { ...n, ...ref };
    this._bomOpen = -1; this._bomQ[i] = '';
    this._applyColors(this._a);
    this._autoStrap(this._a);
    this.drawBom();
  },
  pickBomFamily(i, key) { this._pickInto(i, { familyKey: key }); },
  pickBomMaterial(i, matId) { this._pickInto(i, { materialId: matId }); },

  setBomQty(i, v) {
    const l = this._a.bom[i]; if (!l) return;
    l.qty = Math.round(U.num(v) * 100) / 100;
    if (this.bomLineUnit(l) === 'm') l.qtyManual = true;
    this.drawBom();
  },
  bomAuto(i) {
    const l = this._a.bom[i]; if (!l) return;
    delete l.qtyManual;
    this.syncStrap();
  },
  delBom(i) { this._a.bom.splice(i, 1); this.drawBom(); },

  /* Relit les longueurs du formulaire, recalcule la sangle, redessine les matières (appelé à chaque modification des longueurs, du bicolor, de la largeur…). */
  syncStrap() {
    const a = this._a; if (!a) return;
    this._readFabSegs(); this._readSecs();
    if (document.getElementById('a_internLen_m')) a.internalLength = U.lenCm('a_internLen');
    if (document.getElementById('a_prodLen_m')) a.productLength = Math.round(U.lenCm('a_prodLen')) / 100;
    if (document.getElementById('a_range')) a.sizeRange = U.val('a_range').trim();
    if (document.getElementById('a_sizeLabel')) a.sizeLabel = U.val('a_sizeLabel');
    this._applyColors(a);
    this._autoStrap(a);
    const xn = document.getElementById('a_xnote'); if (xn) xn.textContent = this._xNoteTxt(a);
    (a.fabSections || []).forEach((s, si) => { const t = document.getElementById('a_sec_tot_' + si); if (t) t.innerHTML = this._secTotTxt(s); });
    const sub = document.getElementById('a_bicolor_sub'); if (sub) sub.textContent = this._colorSubText(a);
    this.drawBom();
  },

  /* Une seule largeur choisie : la sangle correspondante est proposée toute seule (ou mise à la nouvelle largeur). */
  _ensureStrap() {
    const a = this._a, ws = a.strapWidths || []; if (ws.length !== 1) return;
    const fams = this.families(), idxs = this._strapIdxs(a);
    if (!idxs.length) {
      const fam = fams.find(f => f.key === 'sangle:' + ws[0]);
      if (fam) a.bom.unshift({ familyKey: fam.key, qty: 1 });
      return;
    }
    idxs.forEach(i => {
      const l = a.bom[i]; if (!l.familyKey) return;
      const k = l.familyKey.indexOf(':'); if (k < 0 || l.familyKey.slice(k + 1) === ws[0]) return;
      const nk = l.familyKey.slice(0, k) + ':' + ws[0];
      if (fams.some(f => f.key === nk)) l.familyKey = nk;
    });
  },

  /* Bicolor : les sangles de chaque couleur apparaissent tout de suite dans « Matières utilisées ». */
  onBicolor() {
    this._a.bicolor = !!document.getElementById('a_bicolor')?.checked;
    this._readFabSegs();
    const el = document.getElementById('a_segs_wrap'); if (el) el.innerHTML = this._fabSegsInnerHTML(this._a.fabSegments || []);
    this.syncStrap();
  },
  onBicolorEnds() {
    this._a.bicolorEnds = !!document.getElementById('a_bicolorEnds')?.checked;
    this.syncStrap();
  },

  /* Lignes « modèle » du type d'accessoire (Paramètres → Segments et pièces de fabrication) : catégorie + quantité, référence à choisir. */
  _tplLines(cat) {
    return (((Store.state.settings.accFabDefaults || {})[cat] || {}).parts || []).map(p => ({ familyKey: '', qty: U.num(p.qty) || 1, _cat: p.kind || '', tpl: true }));
  },

  drawBom() {
    const kinds = Store.materialKinds()
      .map(k => ({ key: k.value, label: k.label }))
      .filter(k => Store.state.materials.some(m => (m.kind || 'autre') === k.key));
    const box = document.getElementById('a_bom');
    if (!box) return;
    this._bomOpen = -1;
    const bom = this._a.bom || [], sIdx = this._strapIdxs(this._a), targets = this._strapTargets(this._a, sIdx.length);

    box.innerHTML = bom.map((l, i) => {
      const selLabel = this._bomLabel(l);
      const cat = l._cat || '';
      const picked = !!(l.familyKey || l.materialId), k = sIdx.indexOf(i);
      const unit = picked ? this.bomLineUnit(l) : '';
      let hint = '';
      if (k >= 0 && k < targets.length) {
        const t = targets[k];
        hint = t > 0
          ? (l.qtyManual
            ? `✏️ Quantité saisie à la main · les longueurs ci-dessous donnent <b>${U.qty(t)} m</b> <button type="button" class="btn-ghost btn-sm" onclick="Accessoires.bomAuto(${i})">🔗 Revenir au calcul auto</button>`
            : `🔗 Calculée d'après les longueurs de fabrication ci-dessous (${U.qty(t)} m)`)
          : '🔗 Renseigne les longueurs de fabrication ci-dessous : la quantité de sangle se calcule toute seule.';
      } else if (!picked && l.tpl) hint = '🧩 Ligne prévue par ton modèle : choisis la référence (sans référence, elle est ignorée à l\'enregistrement).';
      const sec = l.secId ? (this._a.fabSections || []).find(s => s.id === l.secId) : null;
      if (sec) {
        const t = Math.round(this._secTotalCm(sec)) / 100;
        hint = !picked ? `⚠ Aucune sangle ${U.esc(sec.width || '')} en stock : choisis la référence (sans référence, cette section est ignorée à l'enregistrement).`
          : l.qtyManual ? `✏️ Quantité saisie à la main · la section donne <b>${U.qty(t)} m</b> <button type="button" class="btn-ghost btn-sm" onclick="Accessoires.bomAuto(${i})">🔗 Revenir au calcul auto</button>`
          : `🔗 Calculée d'après la section « ${U.esc(sec.label || 'sans nom')} » ci-dessus (${U.qty(t)} m)`;
      }

      const chip = l.strapColor ? `🎨 Couleur ${l.strapColor} — ${U.esc(this._colorTitle(this._a, l.strapColor))}` : sec ? `📏 Section « ${U.esc(sec.label || 'sans nom')} »${sec.width ? ' — ' + U.esc(sec.width) : ''}` : '';
      return `<div style="margin-bottom:8px;${chip ? 'padding:6px 8px;border-left:4px solid var(--caramel);background:var(--th-bg);border-radius:6px;' : ''}">${chip ? `<div style="font-weight:700;font-size:.9rem;color:var(--caramel);margin-bottom:4px;">${chip}</div>` : ''}<div class="frow" style="align-items:flex-end;">
        <div class="fg"><label>Catégorie</label>
          <select onchange="Accessoires.setBomCat(${i},this.value)">
            <option value="">— tous —</option>
            ${kinds.map(kd => `<option value="${kd.key}" ${cat === kd.key ? 'selected' : ''}>${kd.label}</option>`).join('')}
          </select>
        </div>
        <div class="fg" style="flex:2;position:relative;">
          <label>Famille (coût moyen)</label>
          <input id="a_bom_q_${i}" type="text" autocomplete="off"
            value="${U.esc(selLabel)}"
            placeholder="Chercher une famille…"
            onfocus="Accessoires.openBomPick(${i})"
            oninput="Accessoires.filterBomPick(${i},this.value)">
          <div id="a_bom_list_${i}" class="ac-list" style="max-height:200px;overflow:auto;display:none;"></div>
        </div>
        <div class="fg"><label>Quantité${unit ? ' (' + unit + ')' : ''}</label><input type="number" step="0.01" value="${Math.round(U.num(l.qty) * 100) / 100}" onchange="Accessoires.setBomQty(${i},this.value)"></div>
        <div class="fg" style="flex:0;">${l.secId ? '' : `<button class="btn-icon" onclick="Accessoires.delBom(${i})">🗑️</button>`}</div>
      </div>${hint ? `<div class="muted" style="font-size:.8rem;margin-top:3px;">${hint}</div>` : ''}</div>`;
    }).join('') || '<p class="muted">ex: 2,4 m de sangle 20mm + 1 mousqueton + 4 rivets…</p>';
    if (sIdx.length >= 2) {
      const tot = sIdx.reduce((s, i) => s + U.num(bom[i].qty), 0);
      box.innerHTML += `<div style="padding:6px 8px;border-radius:6px;background:var(--th-bg);font-weight:700;">📏 Total sangle : ${U.qty(tot)} m <span class="muted" style="font-weight:400;">(${sIdx.length} sangles)</span></div>`;
    }
  },

  addBom() { this._a.bom.push({ familyKey: '', qty: 1 }); this.drawBom(); },

  _updateCustomPreview() {
    const el = document.getElementById('cl_preview');
    if (!el || !this._clSrc) return;
    const desired = U.lenCm('cl_desired') / 100;
    const { prodLen, interneVal, fixedTotal } = this._clSrc;
    if (desired > 0 && prodLen > 0) {
      const delta = desired - prodLen;
      const newInterne = Math.max(0, Math.round((interneVal + delta * 100) * 10) / 10);
      if (this._colorCount(this._clSrc.src) >= 2) {
        const parts = this._colorParts({ ...this._clSrc.src, internalLength: newInterne });
        el.innerHTML = `Produit : <b>${U.qty(desired)} m</b> (${delta >= 0 ? '+' : ''}${U.qty(delta)} m)
          → Longueur interne : <b>${U.lenTxt(newInterne)}</b>
          → ${parts.map(p => `<b>Couleur ${p.k} (${U.esc(p.title)}) : ${U.qty(p.qty)} m</b>`).join(' · ')}`;
      } else {
        const newStrap = Math.round((fixedTotal + newInterne) / 100 * 1000) / 1000;
        el.innerHTML = `Produit : <b>${U.qty(desired)} m</b> (${delta >= 0 ? '+' : ''}${U.qty(delta)} m)
          → Longueur interne : <b>${U.lenTxt(newInterne)}</b>
          → <b>Sangle à couper : ${U.qty(newStrap)} m</b>`;
      }
    } else {
      el.innerHTML = '';
    }
  },

  /* ═══ 📏 Calculer (colliers, Antho 2026-11-01) — bouton sur la ligne du PRODUIT (`calcFamily(gid)`), pas sur une taille ═══
     « Longueur produit fini » de la fiche = tour de cou de RÉFÉRENCE. On tape le tour de cou voulu : la taille est trouvée d'après les fourchettes (`a.sizeRange`), X bouge du même écart, les sections non liées à X ne bougent pas.
     Rien n'est créé ni enregistré sur la fiche : « 🛠 Fabriquer » ouvre la fenêtre habituelle avec ces longueurs exactes (copie de la fiche pour cette seule fabrication,
     donc les matières retirées du stock sont les bonnes) ; « ⏳ Mettre en attente » garde le calcul dans « 🧵 À fabriquer » (`settings.fabQueue`). Le coût d'une taille se calcule sur le HAUT de sa fourchette (`_xEff`) ; la fenêtre ne montre que les longueurs (coûts / économies = Stats et Ventes). */
  _calcClone(a, neckCm, refCm) {
    const c = JSON.parse(JSON.stringify(a));
    const ref = refCm > 0 ? refCm : U.num(a.productLength) * 100;
    delete c.sizeRange;   // X de la copie = le tour de cou tapé (pas le haut de la fourchette de la taille)
    c.productLength = neckCm / 100;
    c.internalLength = Math.max(0, Math.round((U.num(a.internalLength) + neckCm - ref) * 10) / 10);
    (c.bom || []).forEach(l => { if (this.bomLineUnit(l) === 'm') delete l.qtyManual; });   // le calcul repart des longueurs, pas d'une quantité saisie à la main
    this._applyColors(c); this._autoStrap(c);
    return c;
  },
  /* Lignes de sangle à couper : [{ part, strap, qty (m) }] (section principale ; une ligne par couleur en bicolor ; une ligne par section) */
  _calcRows(c) {
    const fams = this.families();
    return (c.bom || []).filter(l => this.bomLineUnit(l) === 'm' && U.num(l.qty) > 0).map(l => {
      const sec = l.secId ? (c.fabSections || []).find(s => s.id === l.secId) : null;
      const fam = l.familyKey ? fams.find(f => f.key === l.familyKey) : null, mat = l.materialId ? Store.material(l.materialId) : null;
      const part = sec ? (sec.label || 'Section') : l.strapColor ? `Couleur ${l.strapColor} — ${this._colorTitle(c, l.strapColor)}` : 'Sangle principale';
      return { part, strap: fam ? fam.label : mat ? mat.name : '', qty: U.num(l.qty) };
    });
  },
  _calcRowsHTML(rows) {
    return rows.map(r => `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:4px 0;"><span>${U.esc(r.part)}${r.strap ? ` <span class="muted">— ${U.esc(r.strap)}</span>` : ''}</span><b style="white-space:nowrap;">${U.qty(r.qty)} m</b></div>`).join('');
  },
  /* Tailles du collier (fiches de la famille avec une taille et une sangle), de la plus petite à la plus grande */
  _calcSizes(gid) { return this._grpMembers(gid).filter(a => a.sizeLabel && this._mainStrapIdx(a) >= 0).sort((x, y) => this._sizeRank(x) - this._sizeRank(y)); },
  /* Taille à fabriquer : celle choisie dans le menu, sinon (« Automatique ») celle dont la fourchette contient le tour de cou tapé */
  _calcResolve() {
    const sizes = this._calcSizes(this._ccGid), pick = U.val('cc_size') || 'auto', neck = U.lenCm('cc_neck');
    if (pick !== 'auto') return { a: sizes.find(x => x.id === pick) || null, auto: false };
    if (!(neck > 0)) return { a: null, auto: true };
    const hit = sizes.filter(x => { const r = this._rangeOf(x); return r && neck >= r.min - 0.0001 && neck <= r.max + 0.0001; });
    return { a: hit[0] || null, auto: true, none: !hit.length, several: hit.length > 1 };
  },
  _calcPreview() {
    const el = document.getElementById('cc_preview'); if (!el) return;
    const neck = U.lenCm('cc_neck'), r = this._calcResolve(); this._ccAcc = r.a;
    if (!(neck > 0)) { el.innerHTML = ''; return; }
    if (!r.a) { el.innerHTML = `<span class="muted">${r.auto ? `Aucune taille n'a une fourchette qui contient ${U.lenTxt(neck)} : choisis la taille dans le menu.` : 'Choisis une taille.'}</span>`; return; }
    const a = r.a, ref = this._ccRef(a);
    if (!(ref > 0)) { el.innerHTML = '<span class="muted">Tape aussi le tour de cou de référence (celui pour lequel X est réglé).</span>'; return; }
    const c = this._calcClone(a, neck, ref), rg = this._rangeOf(a);
    el.innerHTML = `<div class="card" style="padding:8px 12px;background:var(--th-bg);margin:0;">
      <div style="margin-bottom:4px;">📏 Taille <b>${U.esc(a.sizeLabel)}</b>${rg ? ` <span class="muted">(${U.esc(a.sizeRange)})</span>` : ''}${r.several ? ' <span class="muted">— plusieurs tailles possibles, change-la dans le menu</span>' : ''} <span class="muted">· X = ${U.lenTxt(c.internalLength)}</span></div>
      ${this._calcRowsHTML(this._calcRows(c)) || '<span class="muted">Aucune sangle à couper : renseigne les longueurs de la fiche.</span>'}</div>`;
  },
  /* Tour de cou de référence (cm) : celui de la fiche, sinon celui tapé dans la fenêtre */
  _ccRef(a) { return U.num(a.productLength) > 0 ? U.num(a.productLength) * 100 : (document.getElementById('cc_ref_cm') ? U.lenCm('cc_ref') : 0); },
  /* Tailles sans référence : on retient celle tapée (c'est le tour de cou pour lequel X a été mesuré) */
  _ccKeepRef(ref) {
    if (!(ref > 0)) return;
    const miss = this._calcSizes(this._ccGid).filter(x => !(U.num(x.productLength) > 0)); if (!miss.length) return;
    miss.forEach(x => { x.productLength = ref / 100; }); Store.save('catalogA');
  },
  /* Vérifie la saisie : { a, neck, ref } ou null (avec message) */
  _calcCheck() {
    const neck = U.lenCm('cc_neck'); if (!(neck > 0)) { U.toast('Tape le tour de cou du chien.', true); return null; }
    const r = this._calcResolve(); if (!r.a) { U.toast('Aucune taille ne correspond à ce tour de cou : choisis-en une dans le menu Taille.', true); return null; }
    const ref = this._ccRef(r.a); if (!(ref > 0)) { U.toast('Tape le tour de cou de référence (celui pour lequel X est réglé).', true); return null; }
    return { a: r.a, neck, ref };
  },
  /* « 📏 Calculer » est sur la ligne du PRODUIT (famille de colliers) : on tape le tour de cou, l'appli trouve la taille d'après les fourchettes */
  calcFamily(gid) {
    const sizes = this._calcSizes(gid);
    if (!sizes.length) { U.toast('Cette famille n\'a pas de taille avec une sangle : règle une taille et sa sangle dans « Modifier ».', true); return; }
    this._ccGid = gid; this._ccAcc = null;
    const needRef = sizes.some(x => !(U.num(x.productLength) > 0)), name = this._grpMembers(gid)[0].groupName || '';
    U.modal({
      title: '📏 Calculer — ' + U.esc(name), okLabel: '🛠 Fabriquer',
      body: `<p class="muted help">Tape le tour de cou du chien : l'appli trouve la taille d'après les fourchettes, applique la formule du collier (X bouge du même écart que le tour de cou de référence, les sections non liées à X ne changent pas) et te donne les longueurs de sangle à couper. Rien n'est enregistré sur les fiches.</p>
        ${needRef ? `<div class="fg"><label>Tour de cou de référence ${U.info('Le tour de cou pour lequel la longueur interne X des fiches est réglée (ex. 40 cm). Demandé une seule fois : il est mémorisé sur les tailles (« Tour de cou de référence » dans Modifier).')}</label><div>${U.lenSplit('cc_ref', 0, { input: 'Accessoires._calcPreview()' })}</div></div>` : ''}
        <div class="frow" style="align-items:flex-end;">
          <div class="fg"><label>Tour de cou du chien</label><div>${U.lenSplit('cc_neck', 0, { input: 'Accessoires._calcPreview()' })}</div></div>
          <div class="fg"><label>Taille</label><select id="cc_size" onchange="Accessoires._calcPreview()"><option value="auto">Automatique (fourchette)</option>${sizes.map(x => `<option value="${x.id}">${U.esc(x.sizeLabel)}${x.sizeRange ? ' — ' + U.esc(x.sizeRange) : ''}</option>`).join('')}</select></div>
        </div>
        <div id="cc_preview" class="mt"></div>
        <div class="fg mt"><label>Client <span class="muted">— option</span></label><input id="cc_client" type="text" data-clcombo autocomplete="off" placeholder="Choisis ou tape un client"></div>
        <div class="fg mt"><label>Note <span class="muted">— option</span></label><input id="cc_note" placeholder="ex : collier rouge, boucle à gauche"></div>
        <div class="mt"><button class="btn-ghost btn-sm" type="button" onclick="Accessoires.calcQueue()" title="Garde ce calcul dans « 🧵 À fabriquer » (page Artisanat) pour le fabriquer plus tard">⏳ Mettre en attente</button></div>`,
      onOk: () => {
        const k = this._calcCheck(); if (!k) return false;
        const note = U.val('cc_note').trim(), client = U.val('cc_client').trim();
        const src = this._calcClone(k.a, k.neck, k.ref);
        this._ccKeepRef(k.ref);
        Clients.cbClose(); U.closeModal();
        this.fabricate(k.a.id, { src, neck: k.neck, note, client });
      }
    });
  },
  calcQueue() {
    const k = this._calcCheck(); if (!k) return;
    const a = k.a, neck = k.neck;
    this._ccKeepRef(k.ref);
    const S = Store.state.settings;
    (S.fabQueue = S.fabQueue || []).push({ id: U.uid(), accId: a.id, neck, client: U.val('cc_client').trim(), note: U.val('cc_note').trim(), ts: Date.now() });
    Store.save('settings'); Clients.cbClose(); U.closeModal(); App.rerender();
    U.toast(`${a.name} (tour de cou ${U.lenTxt(neck)}) mis en attente dans « À fabriquer ».`);
  },
  _queueOpen: true,
  _queueCard() {
    const q = (Store.state.settings.fabQueue || []).filter(x => Store.state.catalogA.some(a => a.id === x.accId));
    if (!q.length) return '';
    return `<details class="card" style="margin-bottom:10px;" ${this._queueOpen ? 'open' : ''} ontoggle="Accessoires._queueOpen=this.open">
      <summary style="cursor:pointer;"><b>🧵 À fabriquer (${q.length})</b> <span class="muted help">Colliers calculés avec « 📏 Calculer » et mis en attente : les longueurs exactes sont gardées, la déduction du stock se fait à « 🛠 Fabriquer ».</span></summary>
      ${q.map(x => {
        const a = Store.state.catalogA.find(y => y.id === x.accId), rows = this._calcRows(this._calcClone(a, x.neck));
        return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--card-border);">
          <div style="flex:1;min-width:220px;"><b>${U.esc(a.name)}</b> ${x.client ? `<span class="tag">👤 ${U.esc(Clients.show(x.client))}</span> ` : ''}<span class="muted">· tour de cou ${U.lenTxt(x.neck)}${x.note ? ' · ' + U.esc(x.note) : ''}</span>
            <div class="muted" style="font-size:.85rem;">${rows.map(r => `${U.esc(r.part)} ${U.qty(r.qty)} m`).join(' · ')}</div></div>
          <button class="btn-cta btn-sm" onclick="Accessoires.fabQueued('${x.id}')">🛠 Fabriquer</button>
          <button class="btn-icon" title="Retirer de la liste" onclick="Accessoires.delQueued('${x.id}')">🗑️</button></div>`;
      }).join('')}</details>`;
  },
  fabQueued(qid) {
    const x = (Store.state.settings.fabQueue || []).find(y => y.id === qid), a = x && Store.state.catalogA.find(y => y.id === x.accId); if (!a) return;
    this.fabricate(a.id, { src: this._calcClone(a, x.neck), neck: x.neck, note: x.note, client: x.client, qid });
  },
  async delQueued(qid) {
    const x = (Store.state.settings.fabQueue || []).find(y => y.id === qid); if (!x) return;
    if (!await U.confirm('Retirer ce collier de la liste « À fabriquer » ? (Rien n\'est fabriqué ni déduit du stock.)')) return;
    Store.state.settings.fabQueue = Store.state.settings.fabQueue.filter(y => y.id !== qid);
    Store.save('settings'); App.rerender();
  },

  customLength(id, asVariant) {
    const src = Store.state.catalogA.find(x => x.id === id);
    if (!src) return;
    const sangleIdx = this._mainStrapIdx(src);
    if (sangleIdx < 0) { U.toast('Cette fiche n’a pas de ligne de sangle (en mètres) : ajoute-la dans Artisanat pour pouvoir créer une longueur.', true); return; }
    const currentStrap = U.num(src.bom[sangleIdx].qty);
    const segs = src.fabSegments || [];
    const prodLen = U.num(src.productLength);
    const hasSegs = segs.length > 0 && segs.some(s => s.value > 0);
    if (!prodLen) {
      U.toast('Renseigne d\'abord la "Longueur produit fini" dans Modifier.', true);
      return;
    }
    const interneVal = U.num(src.internalLength);
    const fixedTotal = segs.reduce((sum, s) => sum + U.num(s.value), 0);
    this._clSrc = { prodLen, interneVal, fixedTotal, src };
    U.modal({
      title: (asVariant ? '＋ Ajouter une longueur — ' : '📐 Sur mesure — ') + U.esc(src.name), okLabel: asVariant ? 'Ajouter la longueur' : 'Créer la copie',
      body: `<p>Sangle actuelle : <b>${U.qty(currentStrap)} m</b> | Produit : <b>${U.qty(prodLen)} m</b></p>
        ${hasSegs || interneVal > 0 ? `<div class="card" style="padding:8px 12px;background:var(--th-bg);margin-bottom:12px;">
          ${segs.filter(s => s.value > 0).map(s => `<div>${U.esc(s.label)} : <b>${U.lenTxt(s.value)}</b></div>`).join('')}
          ${interneVal > 0 ? `<div style="border-top:1px dashed var(--input-border);padding-top:4px;margin-top:4px;">Longueur interne (X) : <b>${U.lenTxt(interneVal)}</b></div>` : ''}
        </div>` : ''}
        <div class="fg"><label>Longueur souhaitée du produit fini</label><div>${U.lenSplit('cl_desired', 0, { input: 'Accessoires._updateCustomPreview()' })}</div></div>
        <div id="cl_preview" class="mt" style="font-size:.95rem;"></div>
        <p class="muted mt">Seule la longueur interne (X) changera. Les segments fixes restent identiques.</p>`,
      onOk: () => {
        const desired = U.lenCm('cl_desired') / 100;
        if (desired <= 0) { U.toast('Longueur invalide', true); return false; }
        const delta = desired - prodLen;
        const newInterne = Math.max(0, Math.round((interneVal + delta * 100) * 10) / 10);
        const newStrap = Math.round((fixedTotal + newInterne) / 100 * 1000) / 1000;
        if (newStrap <= 0) { U.toast('Longueur trop courte (sangle négative)', true); return false; }
        const copy = JSON.parse(JSON.stringify(src));
        copy.id = U.uid();
        copy.stockGeneral = 0; copy.stockEvent = 0;   // une nouvelle longueur démarre sans stock (la copie gardait celui de l'original)
        if (copy.groupId && U.num(copy.groupCoeff) > 0) { copy.coefficient = copy.groupCoeff; copy.priceTTCManual = ''; }   // elle suit le coefficient commun de la famille
        copy.productLength = desired;
        copy.internalLength = newInterne;
        this._autoStrap(copy);
        const lenRx = /\d+m\d+|\d+[.,]\d+\s*m(?!m)|\d+\s*m(?!m)/i;
        copy.name = lenRx.test(src.name)
          ? src.name.replace(lenRx, desired + 'm')
          : src.name + ' — ' + desired + 'm';
        { const base = Pricing.autoSkuAcc(copy), taken = this._takenSkus(copy.id); let sku = base, n = 1; while (base && taken.has(sku)) { n++; sku = base + '-' + n; } copy.sku = base ? sku : ''; }   // SKU propre à cette longueur
        const snaps = [];
        if (copy.groupId) this._grpOpen[copy.groupId] = true;
        Store.state.catalogA.push(copy);
        snaps.push({ domain: 'catalogA', id: copy.id, before: null });
        const entry = Store.log('accessoires', (asVariant ? 'Longueur ajoutée — ' : 'Sur mesure créé — ') + copy.name, { type: 'restoreBatch', data: snaps });
        Store.save('catalogA');
        U.closeModal(); App.rerender();
        U.toast(asVariant ? 'Longueur ajoutée à la famille.' : 'Copie sur mesure créée.', false, entry.id);
      }
    });
    setTimeout(() => this._updateCustomPreview(), 50);
  },

  async delAcc(id) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a) return;
    if (!await U.confirm(`Supprimer "${a.name}" ?`)) return;
    const snap = Store.snapshot('catalogA', a);
    Store.state.catalogA = Store.state.catalogA.filter(x => x.id !== id);
    const entry = Store.commitSnapshot(snap, 'accessoires', 'Accessoire supprimé — ' + a.name);
    Store.save('catalogA'); App.rerender();
    U.toast('Accessoire supprimé.', false, entry.id);
  },

  /* fabrication : consomme les matières premières du stock */
  /* Construit la liste des matières de la fenêtre « Fabriquer » à partir d'une fiche (ou d'une copie modifiée pour cette seule fabrication). */
  _fabBuild(src) {
    this._fabBom = (src.bom || []).map(l => {
      const secL = l.secId ? (src.fabSections || []).find(s => s.id === l.secId) : null;
      const tag = l.strapColor ? '🎨 Couleur ' + l.strapColor + ' — ' + this._colorTitle(src, l.strapColor) : secL ? '📏 Section « ' + (secL.label || 'sans nom') + ' »' + (secL.width ? ' — ' + secL.width : '') : '';
      if (l.familyKey) {
        const fam = this.families().find(f => f.key === l.familyKey);
        if (!fam) return { type: 'missing', label: l.familyKey, qty: l.qty };
        const sorted = [...fam.materials].sort((x, y) => U.num(y.qty) - U.num(x.qty));
        return { type: 'family', fam, materials: sorted, qty: l.qty, selectedId: sorted[0]?.id || '', tag, color: l.strapColor || 0 };
      }
      if (l.materialId) { return { type: 'direct', m: Store.material(l.materialId), qty: l.qty, tag, color: l.strapColor || 0 }; }
      return null;
    }).filter(Boolean);
  },
  /* Sangle en rouleaux : on choisit sur quel rouleau couper (quantités restantes affichées) ; un rouleau trop court pour la longueur nécessaire est grisé. */
  _fabMat(i) { const b = this._fabBom[i]; return !b ? null : b.type === 'family' ? Store.material(b.selectedId) : b.m; },
  _fabNeed(i) { const el = document.getElementById('fab_qty'); return U.num(this._fabBom[i].qty) * (el ? U.num(el.value) || 1 : 1); },
  _fabRollsHTML(i) {
    const b = this._fabBom[i], m = this._fabMat(i);
    if (!m || !Store.isSangleKind(m.kind) || !(m.rolls && m.rolls.length)) return '';
    const need = this._fabNeed(i), rs = Stock.rollsSorted(m), unit = Store.matUnitLabel(m.unit), ok = r => U.num(r.qty) >= need - 1e-6;
    if (!b.rollManual || !rs.some(r => r.id === b.rollId)) { const d = Stock.defaultRoll(m, need); b.rollId = d ? d.id : ''; }
    const any = rs.some(ok);
    return `<div style="margin-top:6px;font-size:.88rem;"><div class="muted" style="margin-bottom:3px;">Dans quel rouleau couper ? <span class="muted">(il faut ${U.qty(need)} ${unit})</span></div>`
      + rs.map(r => `<label style="display:flex;align-items:center;gap:8px;padding:2px 0;text-transform:none;letter-spacing:0;${ok(r) ? 'cursor:pointer;' : 'opacity:.5;'}"><input type="radio" name="fab_roll_${i}" value="${r.id}" style="width:auto;" ${r.id === b.rollId ? 'checked' : ''} ${ok(r) ? '' : 'disabled'} onchange="Accessoires._fabPickRoll(${i},'${r.id}')"> <b>${U.esc(r.label || 'Rouleau')}</b>${r.entame ? ' <span class="badge info">entamé</span>' : ''} <span class="muted">— ${U.qty(r.qty)} ${unit} restant${ok(r) ? '' : ' · trop court'}</span></label>`).join('')
      + (any ? '' : `<div style="color:var(--alerte);margin-top:3px;">⚠ Aucun rouleau n'a assez : baisse la quantité à fabriquer.</div>`) + '</div>';
  },
  _fabPickRoll(i, id) { const b = this._fabBom[i]; if (b) { b.rollId = id; b.rollManual = true; } },
  _fabRollsRefresh(i, reset) { const b = this._fabBom[i], e = document.getElementById('fab_rolls_' + i); if (!b || !e) return; if (reset) b.rollManual = false; e.innerHTML = this._fabRollsHTML(i); },
  _fabRollsRefreshAll() { (this._fabBom || []).forEach((b, i) => this._fabRollsRefresh(i, false)); },
  _fabBomHTML() {
    return this._fabBom.map((b, i) => {
      if (b.type === 'family') {
        const unit = Store.matUnitLabel(b.fam.unit);
        const opts = b.materials.map(m =>
          `<option value="${m.id}" ${m.id === b.selectedId ? 'selected' : ''}>${U.esc(m.name)} — stock : ${U.qty(m.qty)} ${unit}</option>`
        ).join('');
        return `<div class="card" style="padding:8px 12px;margin-bottom:6px;background:var(--th-bg);">
          ${b.tag ? `<div style="font-weight:700;font-size:.85rem;color:var(--caramel);margin-bottom:4px;">${U.esc(b.tag)}</div>` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <b>${U.esc(b.fam.label)}</b><span class="muted">${U.qty(b.qty)} ${unit} par pièce</span></div>
          <select id="fab_mat_${i}" style="width:100%;" onchange="Accessoires._fabBom[${i}].selectedId=this.value;Accessoires._fabRollsRefresh(${i},true)">${opts}</select>
          <div id="fab_rolls_${i}">${this._fabRollsHTML(i)}</div>
        </div>`;
      }
      if (b.type === 'direct' && b.m) {
        const unit = Store.matUnitLabel(b.m.unit);
        return `<div class="card" style="padding:8px 12px;margin-bottom:6px;background:var(--th-bg);">
          ${b.tag ? `<div style="font-weight:700;font-size:.85rem;color:var(--caramel);margin-bottom:4px;">${U.esc(b.tag)}</div>` : ''}
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <b>${U.esc(b.m.name)}</b><span class="muted">${U.qty(b.qty)} ${unit} — stock : ${U.qty(b.m.qty)} ${unit}</span></div>
          <div id="fab_rolls_${i}">${this._fabRollsHTML(i)}</div>
        </div>`;
      }
      return `<div class="card" style="padding:8px 12px;margin-bottom:6px;color:var(--alerte);">⚠ Famille introuvable : ${U.esc(b.label)}</div>`;
    }).join('');
  },
  /* Case « Ces 2 sangles ne sont pas de la même couleur » DANS la fenêtre Fabriquer (Antho 2026-10-14) : pour CETTE fabrication seulement (la fiche ne change pas),
     bascule entre 2 et 3 couleurs → un bloc de choix de sangle en plus. Les sangles déjà choisies sont gardées par numéro de couleur. */
  _fabToggleEnds() {
    const a = this._fabSrcAcc; if (!a) return;
    const keep = {}; this._fabBom.forEach((b, i) => { if (b.color && b.type === 'family') { const el = document.getElementById('fab_mat_' + i); if (el) keep[b.color] = el.value; } });
    const c = JSON.parse(JSON.stringify(a)); c.bicolorEnds = !!(document.getElementById('fab_ends') || {}).checked;
    this._applyColors(c); this._autoStrap(c);
    this._fabBuild(c);
    this._fabBom.forEach(b => { if (b.color && b.type === 'family' && keep[b.color] && b.materials.some(m => m.id === keep[b.color])) b.selectedId = keep[b.color]; });
    const w = document.getElementById('fab_bom_wrap'); if (w) w.innerHTML = this._fabBomHTML() || '<p class="muted">Aucune matière dans la nomenclature.</p>';
  },

  /* ---------- pièces « prêtes à finir » ajoutées à la main (Antho 2026-10-17) ----------
     Pièces faites d'avance mais pas terminées (porte-clés imprimés non personnalisés, sangles prédécoupées…) : même structure que les autres accessoires (général / événement / seuil, mêmes filtres)
     mais SANS recette : `a.manual = true`, coût dans `a.extraCost`, prix dans `a.priceTTCManual` (donc `Pricing.accCalc` marche tel quel). Elles n'apparaissent PAS dans Artisanat, Revente pro, Paniers,
     stats de prix ni export du site (`Accessoires.crafted()`) ; elles comptent dans le stock fini et le Tableau de bord. « Fabriquer » peut partir d'une de ces pièces (`fab_src`). */
  crafted() { return Store.state.catalogA.filter(a => !a.manual); },

  /* ═══ Détails d'un accessoire sur mesure dans un devis (Antho 2026-10-20) ═══
     Une ligne de devis accessoire peut porter des détails : motif / personnalisation, couleur(s) de sangle, longueur ou taille, mousqueton, couleur de bouclerie, note.
     Les propositions viennent des Matières premières (couleurs de sangle SANS le texte entre parenthèses ; types de mousqueton sans leur largeur ; finitions = variantes
     des mousquetons) — la saisie reste libre. Jamais de largeur sur les sangles « en dessous » : seule celle de l'accessoire choisi compte (déjà dans son nom).
     Objet des détails : { motif, c: {1:'…', 2:'…'}, len, snap, fin, note }. Sangle « principale » = la dernière couleur de la fiche (longueur interne), les autres = secondaires. */
  _optClean(t) { return String(t || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(); },
  _optCap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; },
  optChoices() {
    const colors = new Set(), snaps = new Set(), fins = new Set(), nw = t => this._optClean(String(t || '').replace(/\s*\d+(?:[.,]\d+)?\s*mm\b/gi, ''));
    (Store.state.materials || []).forEach(m => {
      const p = nw(m.product || m.name);
      if (Store.isSangleKind(m.kind)) { if (p && !/^x{3,}/i.test(p)) colors.add(p); }
      else if (m.kind === 'mousqueton') { if (p) snaps.add(this._optCap(p)); const v = this._optClean(m.variant); if (v) fins.add(this._optCap(v)); }
    });
    const srt = x => [...x].sort(U.sortFr);
    return { colors: srt(colors), snaps: srt(snaps), fins: srt(fins) };
  },
  /* Longueurs proposées pour une laisse / longe… : celles des fiches du même produit (même nom de base + même catégorie, toutes largeurs confondues) ;
     s'il y en a moins de 2, celles de la catégorie. Au format que tape Antho (« 1m20 », « 2m50 », « 10m »). La saisie libre reste toujours possible. */
  optLengths(a) {
    const fmt = l => { const m = Math.floor(l + 1e-6), cm = Math.round((l - m) * 100); return m > 0 ? m + 'm' + (cm ? String(cm).padStart(2, '0') : '') : cm + 'cm'; };
    const pool = this.crafted().filter(x => this._lenOf(x) > 0), cat = U.normSearch((a && a.category) || '');
    let L = a ? pool.filter(x => U.normSearch(this._baseName(x)) === U.normSearch(this._baseName(a)) && U.normSearch(x.category || '') === cat) : [];
    if (new Set(L.map(x => this._lenOf(x))).size < 2) L = pool.filter(x => U.normSearch(x.category || '') === cat);
    return [...new Set(L.map(x => this._lenOf(x)))].sort((x, y) => x - y).map(fmt);
  },
  optParts(a) {
    const n = a ? this._colorCount(a) : 1;
    if (n < 2) return [{ k: 1, label: 'Sangle', hint: '' }];
    const hint = k => this._colorTitle(a, k);   // texte entre parenthèses = écran de saisie seulement (« longueur interne », « Rabat + Poignée »), jamais sur le devis
    const out = [{ k: n, label: 'Sangle principale', hint: hint(n) }];   // plusieurs couleurs : « Sangle principale (longueur interne) » + « Sangle secondaire (Rabat + Poignée) »
    for (let k = 1; k < n; k++) out.push({ k, label: n > 2 ? 'Sangle secondaire ' + k : 'Sangle secondaire', hint: hint(k) });
    return out;
  },
  optLines(a, o) {
    o = o || {}; const t = x => String(x == null ? '' : x).trim(), L = [], parts = this.optParts(a);
    if (t(o.motif)) L.push(t(o.motif));
    parts.forEach(p => { const v = t((o.c || {})[p.k]); if (v) L.push(p.label + ' : ' + v); });   // jamais le texte entre parenthèses (rabat + poignée…) : réservé à l'écran de saisie
    if (t(o.len)) L.push(t(o.len));
    if (t(o.snap)) L.push(t(o.snap));
    if (t(o.fin)) L.push('Bouclerie : ' + t(o.fin));
    if (t(o.note)) t(o.note).split(/\n+/).map(x => x.trim()).filter(Boolean).forEach(x => L.push(x));   // bloc de texte libre : une ligne par ligne saisie
    return L;
  },
  optOf(aId) { return (Store.state.catalogA || []).find(x => x.id === aId) || null; },
  optEmpty(o) { return !o || (!Object.keys(o.c || {}).some(k => String(o.c[k] || '').trim()) && !['motif', 'len', 'snap', 'fin', 'note'].some(k => String(o[k] || '').trim())); },
  _optDraft: null,
  _optSet(k, v) { const d = this._optDraft; if (!d) return; if (/^c\d$/.test(k)) { d.c = d.c || {}; d.c[k.slice(1)] = v; } else d[k] = v; },
  /* Fenêtre « ✏️ Détails » d'un accessoire (posée AU-DESSUS de la fenêtre ou de la page ouverte, qui reste en place).
     Renvoie une promesse : l'objet de détails nettoyé ({} si tout a été vidé) ou null si annulé. Utilisée par Paniers (devis client) et Revente pro. */
  async optEdit(a, cur, title) {
    const parts = this.optParts(a); this._optA = a;
    const d = this._optDraft = JSON.parse(JSON.stringify(cur || {})); d.c = d.c || {};
    const fld = (label, key, val, list, ph, full) => `<div class="fg" style="margin:0;${full ? 'grid-column:1/-1;' : ''}"><label style="white-space:nowrap;">${label}</label><input type="text" ${list ? `data-clcombo="opt:${list}" autocomplete="off"` : ''} value="${U.esc(val || '')}" placeholder="${U.esc(ph || '')}" oninput="Accessoires._optSet('${key}',this.value)" style="width:100%;"></div>`;
    const html = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px 12px;">
      ${fld('Motif / personnalisation', 'motif', d.motif, '', 'ex : Motif Stitch sur mesure', true)}
      ${parts.map(p => fld(p.label + (parts.length > 1 && p.hint ? ' <span class="muted">(' + U.esc(p.hint) + ')</span>' : ''), 'c' + p.k, d.c[p.k], 'colors', 'couleur')).join('')}
      ${fld('Longueur / taille', 'len', d.len, 'lens', 'choisis ou tape : 1m50 · Taille M — 42/43 cm')}
      ${fld('Mousqueton', 'snap', d.snap, 'snaps', 'type')}
      ${fld('Bouclerie', 'fin', d.fin, 'fins', 'couleur / finition')}
      <div class="fg" style="margin:0;grid-column:1/-1;"><label style="white-space:nowrap;">Texte libre <span class="muted">(une ligne = une ligne du devis)</span></label><textarea rows="3" style="width:100%;" placeholder="ex : prénom brodé « Ulysse », boucle côté gauche…" oninput="Accessoires._optSet('note',this.value)">${U.esc(d.note || '')}</textarea></div>
    </div><p class="muted" style="margin:8px 0 0;font-size:.82rem;">Propositions tirées de tes Matières premières et des longueurs de tes fiches — tu peux toujours taper librement (longueur intermédiaire…). Seules les cases remplies s'affichent, sous le produit, dans le devis (image, texte, tableau) puis sur le ticket et la facture.</p>`;
    if (!await U.ask({ title: '✏️ Détails — ' + U.esc(title || (a && a.name) || 'accessoire'), html, okLabel: 'Enregistrer', cancelLabel: 'Annuler' })) return null;
    const clean = { c: {} };
    Object.keys(d.c).forEach(k => { const v = String(d.c[k] || '').trim(); if (v) clean.c[k] = v; });
    ['motif', 'len', 'snap', 'fin', 'note'].forEach(k => { const v = String(d[k] || '').trim(); if (v) clean[k] = v; });
    return clean;
  },
  editManual(id) {
    if (App.isViewer) return;
    const S = Store.state.settings, ex = id ? Store.state.catalogA.find(x => x.id === id) : null;
    if (id && !ex) return;
    const a = ex || { category: '', name: '', sku: '', extraCost: '', priceTTCManual: '', stockGeneral: 0, stockEvent: 0, low: 0 };
    const cats = [...new Set([...(S.accCategories || []), a.category].filter(Boolean))].sort(U.sortFr);
    const nv = v => (v === '' || v === undefined || v === null) ? '' : U.num(v);
    U.modal({
      title: ex ? '🧩 ' + U.esc(a.name) : '🧩 Ajouter un accessoire', okLabel: 'Enregistrer',
      body: `<div class="frow">
          <div class="fg" style="flex:2;min-width:0;"><label>Nom ${U.info('Ex. « Porte-clés pas fini », « Sangle 20 mm prédécoupée ». Pièce faite à l\'avance, pas encore terminée : elle reste dans le stock des accessoires (bandeau bleu) et n\'apparaît pas dans Artisanat. Quand tu fabriques l\'accessoire fini, tu peux choisir de partir d\'elle.')}</label><input id="m_name" value="${U.esc(a.name)}" placeholder="ex: Porte-clés pas fini"></div>
          <div class="fg" style="min-width:0;"><label>Catégorie</label><select id="m_cat"><option value="">Autre</option>${cats.map(c => `<option ${a.category === c ? 'selected' : ''}>${U.esc(c)}</option>`).join('')}</select></div>
        </div>
        <div class="frow">
          <div class="fg" style="min-width:0;"><label>SKU (option)</label><input id="m_sku" value="${U.esc(a.sku || '')}"></div>
          <div class="fg" style="min-width:0;"><label>Coût (€)</label><input id="m_cost" type="number" step="0.01" min="0" value="${nv(a.extraCost)}"></div>
          <div class="fg" style="min-width:0;"><label>Prix TTC (€)</label><input id="m_price" type="number" step="0.01" min="0" value="${nv(a.priceTTCManual)}"></div>
        </div>
        <div class="frow">
          <div class="fg" style="min-width:0;"><label>Général</label><input id="m_gen" type="number" step="1" min="0" value="${U.num(a.stockGeneral)}"></div>
          <div class="fg" style="min-width:0;"><label>Événement</label><input id="m_evt" type="number" step="1" min="0" value="${U.num(a.stockEvent)}"></div>
          <div class="fg" style="min-width:0;"><label>Seuil min</label><input id="m_low" type="number" step="1" min="0" value="${U.num(a.low)}"></div>
        </div>
        <span class="muted help">Le coût sert à valoriser le stock (Tableau de bord). Le filament et les matières de l'accessoire fini ne sont retirés qu'au moment de le fabriquer : ne les retire pas toi-même en ajoutant la pièce ici.</span>`,
      onOk: () => {
        const name = U.val('m_name').trim();
        if (!name) { U.toast('Donne un nom à la pièce.', true); return false; }
        const sku = U.val('m_sku').trim();
        if (sku && this._takenSkus(ex ? ex.id : '').has(sku.toUpperCase())) { U.toast('Ce SKU existe déjà.', true); return false; }
        const raw = k => { const v = U.val(k).trim(); return v === '' ? '' : Math.max(0, U.num(v)); };
        const whole = k => Math.max(0, Math.round(U.numVal(k)));
        const snap = ex ? Store.snapshot('catalogA', ex) : null;
        const rec = ex || { id: U.uid(), manual: true, bom: [], strapWidths: [], coefficient: 2 };
        Object.assign(rec, { name, category: U.val('m_cat'), sku, extraCost: raw('m_cost'), priceTTCManual: raw('m_price'), stockGeneral: whole('m_gen'), stockEvent: whole('m_evt'), low: whole('m_low') });
        if (!ex) Store.state.catalogA.push(rec);
        const entry = ex ? Store.commitSnapshot(snap, 'stock', 'Pièce prête à finir modifiée — ' + name)
          : Store.log('stock', 'Pièce prête à finir ajoutée — ' + name, { type: 'deleteCreated', data: { domain: 'catalogA', id: rec.id } });
        Store.save('catalogA'); U.closeModal(); App.rerender();
        U.toast(ex ? 'Modification enregistrée.' : name + ' ajouté au stock.', false, entry.id);
      }
    });
  },
  async delManual(id) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a || App.isViewer) return;
    if (!await U.confirm(`Supprimer « ${a.name} » du stock ?`, { danger: true })) return;
    const snap = Store.snapshot('catalogA', a);
    Store.state.catalogA = Store.state.catalogA.filter(x => x.id !== id);
    const entry = Store.commitSnapshot(snap, 'stock', 'Pièce prête à finir supprimée — ' + a.name);
    Store.save('catalogA'); App.rerender();
    U.toast('Pièce supprimée.', false, entry.id);
  },

  /* ---------- stock fini (Stock → Accessoires) ---------- */
  setStockFini(id, field, val) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a || App.isViewer) return;
    const key = field === 'event' ? 'stockEvent' : field === 'low' ? 'low' : 'stockGeneral';
    const v = Math.max(0, Math.round(U.num(val)));
    if (v === Math.round(U.num(a[key]))) { App.rerender(); return; }
    const snap = Store.snapshot('catalogA', a);
    a[key] = v;
    const lab = { stockGeneral: 'stock général', stockEvent: 'stock événement', low: 'seuil d\'alerte' }[key];
    const entry = Store.commitSnapshot(snap, 'stock', `Accessoire — ${lab} de ${a.name} : ${v}`);
    Store.save('catalogA'); App.rerender();
    U.toast(`${a.name} : ${lab} = ${v}.`, false, entry.id);
  },
  transferStock(id, dir0) {
    const a = Store.state.catalogA.find(x => x.id === id); if (!a || App.isViewer) return;
    U.modal({
      title: '⇄ Transférer — ' + U.esc(a.name), okLabel: 'Transférer',
      body: `<div class="frow"><div class="fg"><label>Sens</label><select id="tr_dir"><option value="ge" ${dir0 !== 'eg' ? 'selected' : ''}>Général → Événement (${U.qty(a.stockGeneral)} en général)</option><option value="eg" ${dir0 === 'eg' ? 'selected' : ''}>Événement → Général (${U.qty(a.stockEvent)} en événement)</option></select></div>
        <div class="fg"><label>Quantité</label><input id="tr_n" type="number" step="1" min="1" value="1"></div></div>`,
      onOk: () => {
        const dir = U.val('tr_dir'), n = Math.round(U.numVal('tr_n')), from = dir === 'ge' ? 'stockGeneral' : 'stockEvent', to = dir === 'ge' ? 'stockEvent' : 'stockGeneral';
        if (!(n > 0)) { U.toast('Indique une quantité.', true); return false; }
        if (n > U.num(a[from])) { U.toast(`Stock insuffisant : ${U.qty(a[from])} disponible(s).`, true); return false; }
        const snap = Store.snapshot('catalogA', a);
        a[from] = U.num(a[from]) - n; a[to] = U.num(a[to]) + n;
        const entry = Store.commitSnapshot(snap, 'stock', `Accessoire transféré — ${n} × ${a.name} (${dir === 'ge' ? 'général → événement' : 'événement → général'})`);
        Store.save('catalogA'); U.closeModal(); App.rerender();
        U.toast(`${n} × ${a.name} transféré${n > 1 ? 's' : ''}.`, false, entry.id);
      }
    });
  },
  /* `custom` (option) = { src: copie de la fiche aux longueurs calculées, neck (cm), note, qid } : fabrication « 📏 Calculer » — les matières viennent de la copie, le stock fini est celui de la vraie fiche. */
  fabricate(id, custom) {
    const a = Store.state.catalogA.find(x => x.id === id);
    if (!a) return;
    const src = custom ? custom.src : a;
    this._fabSrcAcc = src;
    this._fabBuild(src);
    const bomHTML = this._fabBomHTML();
    const customTxt = custom ? `tour de cou ${U.lenTxt(custom.neck)}${custom.client ? ' · pour ' + custom.client : ''}${custom.note ? ' · ' + custom.note : ''}` : '';
    const endsBox = src.bicolor && (src.fabSegments || []).length >= 2 ? `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin:6px 0 0;font-size:.84rem;text-transform:none;letter-spacing:0;"><input id="fab_ends" type="checkbox" ${src.bicolorEnds ? 'checked' : ''} onchange="Accessoires._fabToggleEnds()"> <span>Ces 2 sangles ne sont pas de la même couleur <span class="muted">(→ 3 couleurs, pour cette fabrication)</span></span></label>` : '';

    // pièces « prêtes à finir » (ajoutées à la main) en stock : on peut en partir (elles perdent n pièces, le stock fini de l'accessoire en gagne n)
    const srcOpts = Store.state.catalogA.filter(x => x.manual && x.id !== a.id).flatMap(x => [['stockGeneral', 'Général'], ['stockEvent', 'Événement']]
      .filter(([k]) => U.num(x[k]) > 0).map(([k, l]) => `<option value="${x.id}|${k}">${U.esc(x.name)} — ${l} (${U.qty(x[k])})</option>`)).join('');
    const srcRow = srcOpts ? `<div class="frow"><div class="fg"><label>Partir d'une pièce prête à finir ${U.info("Option. Choisis la pièce faite à l'avance (ex. porte-clés pas fini) : elle perd autant de pièces que tu en fabriques, et l'accessoire fini en gagne autant. Les matières de la recette ci-dessous sont quand même retirées : le filament et la sangle n'ont pas été retirés quand tu as ajouté la pièce à la main.")}</label><select id="fab_src"><option value="">— Non, fabriquer de zéro —</option>${srcOpts}</select></div></div>` : '';
    U.modal({
      title: '🛠 Fabriquer — ' + U.esc(a.name), okLabel: 'Fabriquer',
      body: `${custom ? `<p class="card" style="padding:8px 12px;background:var(--th-bg);margin:0 0 10px;">📏 Longueurs calculées pour un <b>${U.esc(customTxt)}</b> (X = ${U.lenTxt(src.internalLength)}) : les quantités de sangle ci-dessous sont les vraies.</p>` : ''}<div class="frow"><div class="fg"><label>Quantité à fabriquer</label><input id="fab_qty" type="number" step="1" value="1" oninput="Accessoires._fabRollsRefreshAll()"></div>
        <div class="fg"><label>Pièces ajoutées au stock ${U.info("Les pièces fabriquées entrent dans le stock fini de cet accessoire (visible dans Stock → Accessoires et au Tableau de bord). Général = site / atelier ; Événement = emporté en marché (SumUp).")}</label><select id="fab_dest"><option value="stockGeneral">Général</option><option value="stockEvent">Événement</option></select></div></div>
        ${srcRow}
        <h2 style="font-size:.95rem;margin-top:12px;">Matières à utiliser</h2>
        ${endsBox}
        <div id="fab_bom_wrap" style="margin-top:8px;">${bomHTML || '<p class="muted">Aucune matière dans la nomenclature.</p>'}</div>`,
      onOk: () => {
        const n = U.numVal('fab_qty');
        if (n <= 0) return false;
        const resolved = [], usedRoll = {};
        for (let i = 0; i < this._fabBom.length; i++) {
          const b = this._fabBom[i];
          const need = U.num(b.qty) * n;
          let m;
          if (b.type === 'direct') {
            if (!b.m) { U.toast('Matière introuvable', true); return false; }
            if (U.num(b.m.qty) < need) { U.toast(`Stock insuffisant : ${b.m.name} (${U.qty(b.m.qty)} restant)`, true); return false; }
            m = b.m;
          } else if (b.type === 'family') {
            const selId = document.getElementById('fab_mat_' + i)?.value || b.selectedId;
            m = Store.material(selId);
            if (!m) { U.toast(`Matière non trouvée dans "${b.fam.label}"`, true); return false; }
            if (U.num(m.qty) < need) { U.toast(`Stock insuffisant : ${m.name} (${U.qty(m.qty)} restant, besoin de ${U.qty(need)})`, true); return false; }
          } else { U.toast(`Famille introuvable : ${b.label}`, true); return false; }
          let rollId = '';
          if (Store.isSangleKind(m.kind) && m.rolls && m.rolls.length) {   // sangle en rouleaux : on coupe dans UN rouleau, choisi dans la fenêtre
            Stock.reconcileRolls(m);
            rollId = (document.querySelector(`input[name="fab_roll_${i}"]:checked`) || {}).value || b.rollId;
            const r = m.rolls.find(x => x.id === rollId);
            if (!r) { U.toast(`Choisis le rouleau à utiliser pour ${m.name}.`, true); return false; }
            const left = U.num(r.qty) - U.num(usedRoll[r.id]);
            if (left < need - 1e-6) { U.toast(`${r.label} : il ne reste que ${U.qty(left)} ${Store.matUnitLabel(m.unit)}, il en faut ${U.qty(need)}. Choisis un autre rouleau.`, true); return false; }
            usedRoll[r.id] = U.num(usedRoll[r.id]) + need;
          }
          resolved.push({ m, need, rollId });
        }
        const pool = U.val('fab_dest') === 'stockEvent' ? 'stockEvent' : 'stockGeneral';
        const [srcId, srcPool] = (U.val('fab_src') || '').split('|'), srcAcc = srcId ? Store.state.catalogA.find(x => x.id === srcId && x.manual) : null;
        if (srcAcc && U.num(srcAcc[srcPool]) < n) { U.toast(`Pas assez de « ${srcAcc.name} » : ${U.qty(srcAcc[srcPool])} disponible(s).`, true); return false; }
        const undo = { accId: a.id, n, mats: [], fid: U.uid(), pool };
        if (srcAcc) { srcAcc[srcPool] = U.num(srcAcc[srcPool]) - n; undo.src = { id: srcAcc.id, pool: srcPool, n }; }   // pièce prête à finir consommée
        a[pool] = U.num(a[pool]) + n;   // stock FINI crédité (avant 2026-10-17 la fabrication ne faisait que retirer les matières)
        for (const { m, need, rollId } of resolved) {
          const before = rollId ? JSON.parse(JSON.stringify(m.rolls)) : null;   // rouleaux avant : l'annulation les remet exactement
          if (rollId) Stock.consumeRoll(m, rollId, need); else m.qty = U.num(m.qty) - need;
          undo.mats.push(before ? { id: m.id, qty: need, rolls: before } : { id: m.id, qty: need });
        }
        const entry = Store.log('fabrication', `Fabrication de ${n} × ${a.name}${custom ? ' (' + customTxt + ')' : ''}`, { type: 'fabricate', data: undo });
        // Historique PERMANENT des fabrications (le journal ne garde que 600 actions) : sert aux stats « sangles / couleurs les plus utilisées » (Statistiques → Prix & marges → Accessoires)
        const S = Store.state.settings; (S.fabHistory = S.fabHistory || []).push({ id: undo.fid, ts: Date.now(), accId: a.id, n, mats: undo.mats.map(x => ({ id: x.id, qty: x.qty })) });
        if (S.fabHistory.length > 5000) S.fabHistory.splice(0, S.fabHistory.length - 5000);
        if (custom && custom.qid) S.fabQueue = (S.fabQueue || []).filter(x => x.id !== custom.qid);   // le collier mis en attente vient d'être fabriqué
        Store.save('materials', 'settings', 'catalogA');
        U.closeModal(); App.rerender();
        U.toast(`${n} × ${a.name} — matières déduites${srcAcc ? `, −${n} « ${srcAcc.name} »` : ''}, +${n} en stock ${pool === 'stockEvent' ? 'événement' : 'général'}. 🛠`, false, entry.id);
      }
    });
  }
};
