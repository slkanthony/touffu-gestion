/* ============================================================
   PANIERS PERSONNALISÉS — outil de composition de paniers
   Aide à créer des paniers mixtes de mastication avec un budget
   TTC, en tenant compte des préférences client (viandes exclues,
   avec/sans poil, hypoallergénique), de la DLUO (écouler le stock
   proche en priorité) et de la rentabilité (coeff le plus élevé).
   Outil de composition uniquement : la vente se fait manuellement
   dans l'onglet Ventes une fois le panier validé par le client.
   Stock total (général + événement) utilisé par défaut — Antho peut
   toujours se déplacer dans son stock général si besoin.
   ============================================================ */
const Paniers = {
  budget: 30,
  livraison: 0,
  reduction: 0,   // code de réduction du client (%), appliqué sur les produits (pas sur la livraison)
  reductionCode: '',   // texte du code (devis en attente, ticket, historique) — affiché aussi sur le devis du client depuis 2026-11-15 (« Réduction Zoomies (5 %) »), voir _redLabel
  _redLabel(d) { return 'Réduction' + (d.redCode ? ' ' + d.redCode : '') + ' (' + U.qty(d.redPct) + ' %)'; },
  _redAuto: false,   // la réduction vient de la fiche du client (retirée si on change de client) et non d'une saisie à la main
  nbChiens: 1,
  /* Type de panier (Antho 2026-11-17) : 'vente' = deux propositions (au plus près, et jusqu'à +10 %) ; 'site' = commande du site à prix fixe :
     jamais au-dessus du budget (le client ne paiera pas la différence), dates courtes puis plus fort coefficient (comme le lot) ; 'lot' = lot à gagner / offert : jamais au-dessus, dates courtes d'abord
     (elles seraient perdues de toute façon) puis les produits au plus fort coefficient (valeur affichée élevée pour un coût réel faible). */
  kind: 'vente',
  KINDS: [['vente', 'Vente'], ['site', 'Commande site'], ['lot', 'Lot à gagner']],
  setKind(v) { this.kind = v; this.proposals = null; this.render(); },
  /* Particularités du chien (Antho 2026-11-17) : utilisables SANS fiche chien (réglages avancés) ; remplies toutes seules quand on choisit une cliente
     (fiche chien, sinon valeurs de sa race). glouton / choke : pas de produit qui se ramollit ni de petite taille (XS, S) pour un chien qui n'est pas
     petit ; teeth : rien de dur ; surpoids : rien de moyennement gras ni gras ; energique : produits plus résistants et mastication longue. */
  risks: { glouton: false, choke: false, teeth: false, surpoids: false, energique: false, tendre: false },
  RISKS: [['glouton', 'Glouton'], ['choke', 'Risque d’étouffement'], ['teeth', 'Dents fragiles'], ['surpoids', 'Surpoids'], ['energique', 'Très énergique'], ['tendre', 'Préfère le tendre']],
  /* Race(s) choisie(s) dans les réglages avancés, pour un chien SANS fiche (ou pour pré-remplir) : ids de js/races.js */
  races: [], _raceQ: '', _raceOpen: false,
  priority: 'mix',    // 'dluo' | 'coeff' | 'mix'
  excludeMeats: [],
  excludeProducts: [],
  poilFilter: 'all',  // 'all' | 'avec' | 'sans'
  hypoOnly: false,
  resistanceInclude: ['faible', 'moyenne'],
  typeFilter: 'occupation', // défaut = mastication : un panier personnalisé est composé de mastication, pas de friandises/compléments (demande d'Antho). Valeurs = productTypes du référentiel + 'all'.
  ageInclude: ['0-3','3-5','6-10','11+','senior'],
  gabaritInclude: ['petit','moyen','grand'],
  odeurInclude: ['faible','moyenne','forte'],
  grasInclude: ['non','peu','moyen','gras'],
  /* Commission estimée dans le bénéfice du panier (Antho 2026-11-18 : plus de choix « Paiement » ici, le vrai mode se choisit dans Ventes) :
     commande site = Stripe (payée en ligne), sinon SumUp (estimation prudente). */
  _payMode() { return this.kind === 'site' ? 'stripe' : 'sumup'; },
  basket: [],          // [{pId, vId, lotId, name, variant, price, qty, dluo, coeff, meat, locked}]
  maxPerProduct: 2,

  // UI state
  ageOpen: false,
  gabaritOpen: false,
  odeurOpen: false,
  grasOpen: false,
  excludeMeatsOpen: false,
  excludeProdsQ: '',
  excludeProdsOpen: false,
  addQ: '',
  addOpen: false,
  addVariants: [],
  addCat: '', addWidth: '', addPerso: 'all',   // filtres de la liste d'accessoires (catégorie, largeur de sangle, personnalisation)
  addKind: 'all',   // ajout manuel : 'all' | 'M' (mastication) | 'A' (accessoires) — les devis peuvent aussi contenir des accessoires (2026-10-14)
  addVariantsOpen: false,
  proposals: null,
  client: '',   // cliente choisie avant de générer : sa fiche (viandes évitées, allergies, poils, odeurs, gras) filtre les produits

  /* ---------- Fusion tags variante → produit ---------- */
  _mergeTags(pTags, vTags) {
    const pt = pTags || {};
    const vt = vTags || {};
    return {
      poil: pt.poil || '',
      hypo: pt.hypo === 'oui' || pt.hypo === true,
      // Poil, hypo, résistance, type, odeur, gras : toujours ceux du PRODUIT (identiques pour toutes
      // les tailles, demande d'Antho 2026-09-29) ; seuls âge et gabarit peuvent varier par variante.
      resistance: pt.resistance || '',
      type: pt.type || '',
      odeur: pt.odeur || '',
      gras: pt.gras || '',
      ramollit: pt.ramollit === 'oui',
      age: (vt.age && vt.age.length) ? vt.age : (pt.age || []),
      gabarit: (vt.gabarit && vt.gabarit.length) ? vt.gabarit : (pt.gabarit || []),
      species: (vt.species && vt.species.length) ? vt.species : (pt.species || [])
    };
  },

  /* ---------- Fiche cliente → filtres ---------- */
  _clientRules() {
    const c = Clients.find(this.client);
    if (!c || Clients.ro()) return null;
    const dogs = c.dogs || [];
    return { c, dogs, sensitive: dogs.some(d => d.sensitive), hair: dogs.some(d => d.hair === 'non'), odor: dogs.some(d => d.odor === 'non'), fat: dogs.some(d => d.fat === 'non') };
  },
  _clientSummary() {
    const al = (this._clientRules() || { dogs: [] }).dogs.flatMap(d => this._traits(d).alerts);
    const base = this._clientSummary0();
    return al.length ? base + ' · Alerte race : ' + [...new Set(al)].join(' ') : base;
  },
  /* Nom du chien + âge (calculé depuis sa date de naissance), entre marqueurs \u0001…\u0002 → mis en caramel par _clientSummaryHTML (Antho 2026-11-19). */
  _dogLbl(d, n) { const a = Clients.ageTxt(d.birth); return '\u0001' + (n || String(d.name || '').trim() || 'chien') + (a ? ' · ' + a : '') + '\u0002'; },
  _clientSummaryHTML() { return U.esc(this._clientSummary()).replace(/\u0001([^\u0002]*)\u0002/g, '<b class="pan-dog">$1</b>'); },
  _clientSummary0() {
    if (!String(this.client || '').trim()) return 'Sa fiche (viandes évitées, allergies, poils, odeurs fortes, gras) filtre automatiquement les produits à la génération.';
    if (Clients.ro()) return '';
    const r = this._clientRules();
    if (!r) return 'Pas de fiche pour cette cliente : aucun filtre appliqué (elle sera créée à la vente).';
    if (!r.dogs.length) return 'Fiche sans chien renseigné : aucun filtre appliqué.';
    if (this._perDog()) {
      const per = this._dogList().map(d => {
        const av = Object.keys(d.meats || {}).filter(m => d.meats[m] === 'avoid'), ex = [].concat(d.sensitive ? ['sensible'] : [], av.length ? ['évite : ' + av.join(', ')] : [], d.hair === 'non' ? ['pas de poils'] : [], d.odor === 'non' ? ['pas d\'odeurs fortes'] : [], d.fat === 'non' ? ['pas de gras'] : []);
        return this._dogLbl(d, d._n) + (ex.length ? ' (' + ex.join(', ') + ')' : '');
      });
      return '🐕 ' + per.join(' · ') + ' → panier composé chien par chien (budget partagé) ; un produit pensé pour un seul chien est annoté « pour … », tu peux le changer.';
    }
    const avoid = [...new Set(r.dogs.flatMap(d => Object.keys(d.meats || {}).filter(m => d.meats[m] === 'avoid')))];
    const allergies = [...new Set(r.dogs.map(d => String(d.allergies || '').trim()).filter(Boolean))];
    const parts = [].concat(r.sensitive ? ['🌿 sensible : « Hypoallergénique uniquement » coché'] : [], avoid.length ? ['évite : ' + avoid.join(', ')] : [], allergies.length ? ['allergies : ' + allergies.join(' · ')] : [], r.hair ? ['pas de produits avec poils'] : [], r.odor ? ['pas d\'odeurs fortes'] : [], r.fat ? ['pas de produits gras'] : []);
    return '🐕 ' + r.dogs.map(d => this._dogLbl(d)).join(', ') + ' — ' + (parts.length ? parts.join(' · ') + ' → exclus à la génération' : 'aucune contrainte renseignée');
  },
  /* ---------- Panier chien par chien (cliente avec 2 chiens ou plus aux profils différents) ---------- */
  _dogList() { const r = this._clientRules(); return r ? r.dogs.map((d, i) => Object.assign({}, d, { _n: String(d.name || '').trim() || 'Chien ' + (i + 1) })) : []; },
  _monthsOld(d, frac) {   // âge en mois (frac : avec la partie de mois entamée, ex. 5,5) ; null si date inconnue
    if (!d || !d.birth) return null; const b = new Date(d.birth), n = new Date(); if (isNaN(b)) return null;
    if (frac) { const m = (n - b) / (30.44 * 86400000); return m < 0 ? null : m; }
    let m = (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth(); if (n.getDate() < b.getDate()) m--;
    return m < 0 ? null : m;
  },
  /* TAILLE ACTUELLE d'un chien qui grandit (Antho 2026-11-18) : un chiot de race moyenne n'a pas encore sa taille adulte.
     Poids adulte = moyenne de sa ou ses races (sinon taille de la fiche : petit 7 kg, moyen 17 kg, grand 35 kg) ;
     poids actuel ≈ poids adulte × âge ÷ 12 mois (÷ 10 mois pour une petite race, qui finit plus tôt) ; puis les seuils de l'appli
     (< 10 kg petit, < 25 kg moyen, sinon grand). null : un an ou plus, date de naissance ou taille adulte inconnues. */
  ADULT_KG: { petit: 7, moyen: 17, grand: 35 },
  _growGab(d) {
    const m = this._monthsOld(d, true); if (m === null || m >= 12) return null;
    const pf = typeof Races !== 'undefined' ? Races.profile(d) : null;
    const adultKg = pf && (U.num(pf.wMin) || U.num(pf.wMax)) ? (U.num(pf.wMin) + U.num(pf.wMax)) / 2 : (this.ADULT_KG[d.gabarit] || 0);
    if (!adultKg) return null;
    const adult = d.gabarit || (adultKg < 10 ? 'petit' : adultKg < 25 ? 'moyen' : 'grand');
    const kg = adultKg * Math.min(1, m / (adult === 'petit' ? 10 : 12));
    return { cur: kg < 10 ? 'petit' : kg < 25 ? 'moyen' : 'grand', adult, kg: Math.round(kg) };
  },
  /* Chien qui grandit : un produit coché « Grand » sans « Petit » est trop gros pour lui, sauf s'il est déjà grand (ex. l'églefin pour un chiot de 5 mois). */
  _tooBigForGrowing(g, tags) { const t = tags.gabarit || []; return !!g && g.cur !== 'grand' && t.includes('grand') && !t.includes('petit'); },
  _dogAges(d) {   // tranche d'âge de la fiche (naissance) → valeurs du filtre « Âge du chien » ; null si inconnue
    const m = this._monthsOld(d); if (m === null) return null;
    // Borne atteinte = tranche suivante (Antho 2026-11-17 : « 5 mois révolus, c'est bon » — sinon un chiot de 5 mois et demi n'était nulle part)
    return m < 3 ? ['0-3'] : m < 5 ? ['3-5'] : m < 10 ? ['6-10'] : m >= 96 ? ['11+', 'senior'] : ['11+'];
  },
  _profKey(d) {   // deux chiens avec la même clé = même profil (âge, gabarit, contraintes) ; la race ne compte pas
    const avoid = Object.keys(d.meats || {}).filter(m => d.meats[m] === 'avoid').sort();
    return JSON.stringify([(this._dogAges(d) || []).join(), d.gabarit || '', avoid, String(d.allergies || '').trim().toLowerCase(), d.hair === 'non', d.odor === 'non', d.fat === 'non', !!d.sensitive]);
  },
  _perDog() { const dogs = this._dogList(); return dogs.length >= 2 && new Set(dogs.map(d => this._profKey(d))).size > 1; },
  _compose(maxAvailable, locked) { return this._buildBasket(maxAvailable, locked); },
  /* Ce chien peut-il manger ce produit ? (viande évitée, allergie, poils, odeur, gras, sensible, âge, gabarit) */
  _dogSuits(d, p, pTags, tags) {
    if (Clients.conflictsFor([d], { kind: 'M', type: p.meatType || '', name: p.name }).length) return false;
    if (d.hair === 'non' && pTags.poil === 'avec') return false;
    if (d.odor === 'non' && tags.odeur === 'forte') return false;
    if (d.fat === 'non' && tags.gras === 'gras') return false;
    if (d.sensitive && pTags.hypo !== 'oui') return false;   // « non » est une valeur : seul « oui » passe
    const da = this._dogAges(d), gg = this._growGab(d), dgab = gg ? gg.cur : d.gabarit;   // chiot : sa taille d'aujourd'hui, pas sa taille adulte
    if (da && tags.age.length > 0 && !tags.age.some(x => da.includes(x))) return false;
    if (dgab && tags.gabarit.length > 0 && !tags.gabarit.includes(dgab)) return false;
    if (this._tooBigForGrowing(gg, tags)) return false;
    if (this._tooHardForPuppy(da, tags)) return false;
    if (this._triedVerdict([d], p.name) === 'avoid') return false;
    const tr = this._traits(d), nm = Clients._norm(p.meatType || '');
    if (tr.avoidMeats.some(m => Clients._norm(m) === nm)) return false;   // viande à éviter pour sa race
    if (this._riskBlocks(tr, tags, this._curVar, dgab === 'petit')) return false;
    return true;
  },
  /* ---------- Cliente déjà connue : son dernier panier (Antho 2026-11-17) ----------
     Dernière vente NON annulée de la cliente contenant de la mastication (lien par le nom, comme la fiche cliente). À la génération, ses produits sont
     évités pour varier (pénalité dans la note), sauf ceux que le chien aime (viande « aime » ou produit noté « aimé ») ; un produit noté « pas aimé »
     est de toute façon exclu. `redoLast()` recompose ce même panier avec le stock et les prix d'aujourd'hui. */
  /* Règle d'Antho (2026-11-17, revue le même jour) : un produit acheté par la cliente il y a MOINS D'UN MOIS n'est plus proposé, même à date dépassée ou
     courte (« ça fait doublon ») — sauf s'il est ajouté à la main au panier avant de générer. Au-delà d'un mois : aucune différence, la commande
     précédente est ignorée. Toutes les ventes de la cliente comptent, pas seulement la dernière. */
  RECENT_DAYS: 31,
  _lastSale() {
    if (Clients.ro()) return null;
    const keys = new Set([Clients.key(this.client)]), c = Clients.find(this.client);
    if (c) keys.add(Clients.key(c.name));
    keys.delete('');
    if (!keys.size) return null;
    return (Store.state.sales || []).filter(x => !x.cancelled && keys.has(Clients.key(x.customerName)) && (x.items || []).some(i => (i.kind || 'M') === 'M'))
      .sort((a, b) => U.num(b.ts) - U.num(a.ts))[0] || null;
  },
  _lastItems() { const x = this._lastSale(); return x ? x.items.filter(i => (i.kind || 'M') === 'M') : []; },
  /* Produit / variante du stock d'une ligne de vente : par identifiant, sinon par nom (anciennes ventes importées sans identifiant) */
  _stockOf(i) {
    const sm = Store.state.stockM || [], nm = t => Clients._norm(t).replace(/\s+/g, ' ').trim();
    const p = (i.pId && sm.find(x => x.id === i.pId)) || sm.find(x => nm(x.name) === nm(i.name));
    if (!p) return null;
    const lab = nm(i.label || i.variant || '').replace(/ /g, '');
    const v = (p.variants || []).find(x => x.id === i.vId) || (p.variants || []).find(x => lab && nm(Pricing.labelVariant(x)).replace(/ /g, '') === lab) || ((p.variants || []).length === 1 ? p.variants[0] : null);
    return { p, v };
  },
  /* { idProduit : jours depuis le dernier achat par la cliente } — toutes ses ventes non annulées, mastication seulement */
  _boughtAgo() {
    if (Clients.ro()) return {};
    const keys = new Set([Clients.key(this.client)]), c = Clients.find(this.client);
    if (c) keys.add(Clients.key(c.name));
    keys.delete('');
    const out = {};
    if (!keys.size) return out;
    (Store.state.sales || []).forEach(x => {
      if (x.cancelled || !keys.has(Clients.key(x.customerName))) return;
      const d = Math.max(0, Math.floor((Date.now() - U.num(x.ts)) / 86400000));
      (x.items || []).forEach(i => {
        if ((i.kind || 'M') !== 'M') return;
        const f = this._stockOf(i); if (!f) return;
        if (out[f.p.id] === undefined || d < out[f.p.id]) out[f.p.id] = d;
      });
    });
    Object.keys(out).forEach(id => { const tw = Stock.twinIdOf(id); if (tw && (out[tw] === undefined || out[id] < out[tw])) out[tw] = out[id]; });   // acheté avec poils = déjà eu sans poils
    return out;
  },
  /* Fenêtre « Voir » : contenu du dernier panier (ne prend aucune place sur la page ; se ferme et se rouvre à volonté) */
  showLast() {
    const x = this._lastSale(); if (!x) return;
    const it = this._lastItems(), tot = it.reduce((a, i) => a + U.num(i.price) * U.num(i.qty), 0);
    const rows = it.map(i => {
      const f = this._stockOf(i), dispo = f && f.v ? (f.v.lots || []).reduce((a, l) => a + U.num(l.qtyGeneral) + U.num(l.qtyEvent), 0) : 0;
      return `<tr><td class="col-name">${U.esc(i.name)}${i.label ? ` <span class="tag">${U.esc(i.label)}</span>` : ''}</td><td class="num">${U.qty(i.qty)}</td><td class="num">${U.eur(U.num(i.price) * U.num(i.qty))}</td><td>${dispo > 0 ? `<span class="muted" style="white-space:nowrap;">${U.qty(dispo)} en stock</span>` : '<span class="badge warn" style="white-space:nowrap;">épuisé</span>'}</td></tr>`;
    }).join('');
    U.modal({
      title: 'Dernier panier du ' + U.frDate(U.dayKey(x.ts)), hideOk: true, wide: true,
      body: `<div class="table-wrap"><table><thead><tr><th class="col-name">Produit</th><th class="num">Qté</th><th class="num">Total</th><th>Stock</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><td class="col-name"><b>Total payé</b></td><td class="num"><b>${U.qty(it.reduce((a, i) => a + U.num(i.qty), 0))}</b></td><td class="num"><b>${U.eur(tot)}</b></td><td></td></tr></tfoot></table></div>
        <p class="muted" style="margin:10px 0 0;font-size:.85rem;">Les produits achetés il y a moins d'un mois ne sont pas proposés à la génération. Pour en remettre un, ajoute-le au panier avant de générer.</p>`
    });
  },
  _lastHTML() {
    const x = this._lastSale(); if (!x) return '';
    const it = this._lastItems(), n = it.reduce((a, i) => a + U.num(i.qty), 0), tot = it.reduce((a, i) => a + U.num(i.price) * U.num(i.qty), 0);
    return `<div class="pan-last"><span>Dernier panier : <b>${U.frDate(U.dayKey(x.ts))}</b> · ${n} article${n > 1 ? 's' : ''} · ${U.eur(tot)} <span class="muted help">Un produit acheté par la cliente il y a moins d'un mois n'est pas reproposé, même à date courte (ajoute-le au panier avant de générer si tu le veux). Au-delà d'un mois, tout peut revenir. « Voir » ouvre le contenu de ce panier ; « Refaire » remet les mêmes produits, avec le stock et les prix d'aujourd'hui.</span></span>
      <span class="pan-last-btns"><button class="btn-ghost btn-sm" onclick="Paniers.showLast()">Voir</button><button class="btn-ghost btn-sm" onclick="Paniers.redoLast()" title="${U.esc(it.map(i => i.name + (i.label ? ' ' + i.label : '') + ' ×' + U.qty(i.qty)).join(' · '))}">Refaire</button></span></div>`;
  },
  async redoLast() {
    const sale = this._lastSale(); if (!sale) return;
    if ((this.basket || []).length && !await U.confirm('Remplacer le panier actuel par le dernier panier de ' + Clients.show(this.client) + ' ?', { okLabel: 'Remplacer' })) return;
    const out = [], miss = [], r = this._clientRules(), dogs = r ? r.dogs : [];
    this._lastItems().forEach(i => {
      const f = this._stockOf(i);
      if (!f || !f.v) { miss.push(i.name + ' (plus en stock)'); return; }
      const { p, v } = f;
      if (this._triedVerdict(dogs, p.name) === 'avoid') { miss.push(p.name + ' (noté « pas aimé »)'); return; }
      const rc = Stock.refCalc(p, v), price = rc ? rc.calc.priceTTC : U.num(v.priceTTC), coeff = rc ? (rc.calc.effCoeff || 0) : 0, fam = this._famInfo(p, v).family;
      let need = Math.max(1, Math.round(U.num(i.qty)));
      (v.lots || []).filter(l => U.num(l.qtyGeneral) + U.num(l.qtyEvent) > 0).sort((a, b) => String(a.dluo || '9999').localeCompare(String(b.dluo || '9999'))).forEach(l => {
        if (need <= 0) return;
        const q = Math.min(need, U.num(l.qtyGeneral) + U.num(l.qtyEvent)), d = U.daysTo(l.dluo);
        need -= q;
        out.push({ pId: p.id, vId: v.id, lotId: l.id, name: p.name, meat: p.meatType || '', variant: Pricing.labelVariant(v), price, qty: q, dluo: l.dluo || '', daysLeft: d === null ? 9999 : d, coeff, lotNumber: l.lotNumber || '', locked: false, gen: true, family: fam, dog: '' });
      });
      if (need > 0) miss.push(p.name + ' (' + need + ' manquant' + (need > 1 ? 's' : '') + ')');
    });
    if (!out.length) { U.toast('Aucun produit du dernier panier n’est disponible aujourd’hui.', true); return; }
    this.basket = out; this.proposals = null;
    this.render();
    const tot = out.reduce((a, b) => a + b.price * b.qty, 0);
    U.toast('Dernier panier recomposé : ' + U.eur(tot) + ' aux prix d’aujourd’hui' + (miss.length ? '. Manque : ' + miss.join(', ') : '.'), !!miss.length);
  },
  /* ---------- Réglages avancés (repliés par défaut) : résumé affiché sur la ligne de titre ---------- */
  _advOpen: false,
  _advSummary() {
    const out = [], P = { mix: 'Mix', dluo: 'Dates courtes d’abord', coeff: 'Rentabilité d’abord' };
    out.push(P[this.priority] || 'Mix');
    if (this.typeFilter !== 'all') out.push(Store.productTypeLabel(this.typeFilter).split(' (')[0] || this.typeFilter);
    const R = this.RESISTANCES.filter(x => this.resistanceInclude.includes(x[0])).map(x => x[1].toLowerCase());
    if (R.length && R.length < this.RESISTANCES.length) out.push('résistance : ' + R.join(', '));
    if (this.hypoOnly) out.push('hypoallergénique');
    const rn = this.races.map(id => (Races.find(id) || {}).name).filter(Boolean); if (rn.length) out.push(rn.join(' × '));
    this.RISKS.forEach(([k, l]) => { if (this.risks[k]) out.push(l.toLowerCase()); });
    if (this.poilFilter !== 'all') out.push(this.poilFilter === 'avec' ? 'avec poil' : 'sans poil');
    if (this._ageSel()) out.push('âge choisi');
    if (this._gabSel()) out.push('gabarit choisi');
    if ((this.odeurInclude || []).length && this.odeurInclude.length < 3) out.push('odeur limitée');
    if ((this.grasInclude || []).length && this.grasInclude.length < 4) out.push('gras limité');
    const ex = (this.excludeMeats || []).length + (this.excludeProducts || []).length;
    if (ex) out.push(ex + ' exclusion' + (ex > 1 ? 's' : ''));
    return out.join(' · ');
  },
  /* Produits du panier dont la fiche de stock n'a aucune pastille de profil (résistance, odeur, gras, âge, gabarit) : les filtres n'ont pas pu jouer sur eux */
  _untagged(list) {
    const seen = new Set(), out = [];
    (list || []).forEach(b => {
      if (seen.has(b.pId)) return; seen.add(b.pId);
      const sp = Store.state.stockM.find(x => x.id === b.pId); if (!sp) return;
      const sv = sp.variants.find(x => x.id === b.vId), t = this._mergeTags(Stock.effTags(sp), sv ? Stock.variantTags(sp, sv) : null);
      if (!t.resistance && !t.odeur && !t.gras && !t.age.length && !t.gabarit.length) out.push(sp.name);
    });
    return out;
  },
  _untaggedHTML(list) {
    const u = this._untagged(list); if (!u.length) return '';
    return `<p class="pan-untagged">${u.length} produit${u.length > 1 ? 's' : ''} sans pastilles (les filtres n’ont pas pu les trier) : ${U.esc(u.join(', '))} <a class="btn btn-ghost btn-sm fit" href="#/stock/mastication" onclick="Stock.openPastTodo()" style="text-decoration:none">Compléter</a></p>`;
  },
  /* ---------- Particularités d'un chien : sa fiche d'abord, sinon sa race (js/races.js) ---------- */
  _traits(d) {
    const pf = typeof Races !== 'undefined' ? Races.profile(d) : null;
    const yn = (v, dft) => v === 'oui' ? true : v === 'non' ? false : !!dft;
    const energy = d.energy || (pf ? pf.energy : '');
    return { glouton: yn(d.glouton, pf && pf.glouton), choke: yn(d.choke, pf && pf.choke), teeth: d.teeth === 'fragiles', surpoids: d.body === 'surpoids',
      energique: energy === 'tres-actif' && d.chew !== 'doux', tendre: d.chew === 'doux', energy, avoidMeats: pf ? pf.avoidMeats : [], alerts: pf ? pf.alerts : [] };
  },
  /* Mâcheur d'un chien : celui de la fiche, sinon déduit de son énergie (très actif → gros, actif → moyen, calme → doux) */
  _chewOf(d) { return d.chew || ({ 'tres-actif': 'gros', actif: 'moyen', calme: 'doux' })[this._traits(d).energy] || ''; },
  /* Petite pièce (taille XS ou S) : interdite à un chien glouton / à risque d'étouffement, sauf s'il est petit */
  _smallPiece(v) { return v && v.mode === 'size' && /^(xs|s)$/i.test(String(v.label || v.value || '').trim()); },
  /* Ce produit (variante) est-il interdit par ces particularités ? `small` = le chien est petit (les petites pièces lui conviennent) */
  _riskBlocks(r, tags, v, small) {
    if ((r.glouton || r.choke) && (tags.ramollit || (!small && this._smallPiece(v)))) return true;
    if ((r.teeth || r.tendre) && this.HARD.includes(tags.resistance)) return true;   // dents fragiles ou « préfère le tendre » : rien de dur
    if (r.surpoids && ['moyen', 'gras'].includes(tags.gras)) return true;
    return false;
  },
  /* Résistance d'une ligne du panier (pastilles de sa fiche de stock) */
  _resOf(b) { const sp = Store.state.stockM.find(x => x.id === b.pId); if (!sp) return ''; const sv = sp.variants.find(x => x.id === b.vId); return this._mergeTags(Stock.effTags(sp), sv ? Stock.variantTags(sp, sv) : null).resistance; },
  toggleRisk(k) {
    const on = !this.risks[k], r = Object.assign({}, this.risks, { [k]: on });
    if (on && k === 'energique') r.tendre = false;   // les deux s'excluent
    if (on && k === 'tendre') r.energique = false;
    this.risks = r;
    if (on && (k === 'energique' || k === 'tendre')) this._setResistFor(k === 'tendre' ? ['doux'] : ['gros']);
    this.render();
  },
  /* Résistance souhaitée d'après un ou plusieurs mâcheurs (doux / moyen / gros). La mastication longue n'est jamais cochée d'office (elle reste si elle l'était). */
  _setResistFor(chews) {
    const R = { doux: ['faible', 'moyenne'], moyen: ['faible', 'moyenne', 'forte'], gros: ['moyenne', 'forte', 'tres-forte'] };
    const keepLong = this.resistanceInclude.includes('longue') && !chews.every(k => k === 'doux');
    this.resistanceInclude = this.RESISTANCES.map(x => x[0]).filter(r => chews.some(k => (R[k] || []).includes(r)) || (r === 'longue' && keepLong));
  },
  /* ---------- Race(s) dans les réglages avancés : pré-remplit gabarit, particularités, résistance et viandes à éviter ---------- */
  setRaceQ(v) { this._raceQ = v; this._raceOpen = true; this.render(); U.refocus('pan_race_q'); },
  openRace() { if (this._raceOpen) return; this._raceOpen = true; this.render(); U.refocus('pan_race_q'); },
  closeRace() { if (!this._raceOpen) return; this._raceOpen = false; this.render(); },
  addRace(id) { if (!this.races.includes(id)) this.races = this.races.concat(id); this._raceQ = ''; this._raceOpen = false; this._applyRaces(); this.render(); },
  delRace(id) { this.races = this.races.filter(x => x !== id); this._applyRaces(); this.render(); },
  _applyRaces() {
    const pf = this.races.length ? Races.profile({ breeds: this.races }) : null; if (!pf) return;
    if (pf.gabarit) this.gabaritInclude = [pf.gabarit];
    const keepTendre = this.risks.tendre;
    this.risks = Object.assign({}, this.risks, { glouton: pf.glouton, choke: pf.choke, energique: pf.energy === 'tres-actif' && !keepTendre });
    this._setResistFor(keepTendre ? ['doux'] : [({ 'tres-actif': 'gros', actif: 'moyen', calme: 'doux' })[pf.energy] || 'moyen']);
    pf.avoidMeats.forEach(m => { if (!this.excludeMeats.includes(m)) this.excludeMeats.push(m); });
    if (pf.alerts.length) U.toast('Alerte race : ' + pf.alerts.join(' '));
  },
  _raceHTML() {
    const rs = this.races.map(id => Races.find(id)).filter(Boolean), q = this._raceQ;
    const res = this._raceOpen ? Races.list().filter(r => !this.races.includes(r.id) && (!q || U.has(r.name, q))).slice(0, 12) : [];
    return `<div class="fg" style="margin-top:8px;"><label>Race du chien <span class="muted help">Pour un chien sans fiche : choisir sa race (plusieurs pour un croisé) pré-remplit le gabarit, les particularités, la résistance souhaitée et les viandes à éviter de cette race (Paramètres → Races). Tu peux tout modifier ensuite.</span></label>
      ${rs.length ? `<div class="chips" style="margin-bottom:6px;">${rs.map(r => `<span class="chip">${U.esc(r.name)} <button class="btn-icon" title="Retirer" onclick="Paniers.delRace('${r.id}')">×</button></span>`).join('')}</div>` : ''}
      <div class="autocomplete" data-onclose="Paniers.closeRace"><input id="pan_race_q" type="text" autocomplete="off" placeholder="${rs.length ? 'autre race (croisé)…' : 'chercher une race…'}" value="${U.esc(q)}" oninput="Paniers.setRaceQ(this.value)" onfocus="Paniers.openRace()">
        ${res.length ? `<div class="ac-list">${res.map(r => `<div class="ac-item pp-row" onmousedown="event.preventDefault();Paniers.addRace('${r.id}')"><span class="pp-a">${U.esc(r.name)}</span><span class="pp-b">${r.wMin || '?'}–${r.wMax || '?'} kg</span></div>`).join('')}</div>` : ''}</div></div>`;
  },
  /* ---------- Règles de raisonnement (Antho 2026-11-17) ---------- */
  URGENT_DAYS: 30,
  /* Résistances « dures » : un seul produit dur par panier (sauf gros destructeur), jamais pour un chiot de moins de 6 mois.
     « longue » = mastication longue durée (cornes, bois naturels) : à laisser à disposition du chien, dure très longtemps. */
  HARD: ['forte', 'tres-forte', 'longue'],
  RESISTANCES: [['faible', 'Faible'], ['moyenne', 'Moyenne'], ['forte', 'Forte'], ['tres-forte', 'Très forte'], ['longue', 'Mastication longue']],   // date dépassée ou à moins de 30 jours = « urgent » : proposé en premier
  /* Tranches d'âge / gabarits choisis à la main dans les filtres : null tant que TOUT est coché (= « je ne sais pas », aucune préférence d'âge ou de gabarit) */
  _ageSel() { const a = this.ageInclude || []; return a.length && a.length < 5 ? a : null; },
  _gabSel() { const g = this.gabaritInclude || []; return g.length && g.length < 3 ? g : null; },
  /* Chiot de moins de 6 mois (dents de lait) : jamais de produit dur (forte, très forte, mastication longue) */
  _tooHardForPuppy(ages, tags) { return !!(ages && ages.length && ages.every(a => a === '0-3' || a === '3-5') && this.HARD.includes(tags.resistance)); },
  /* Produit déjà goûté par un de ces chiens (fiche cliente → « Produits déjà mastiqués ») : 'avoid' (pas aimé) l'emporte sur 'like' ; '' si jamais noté */
  _triedVerdict(dogs, name) {
    const n = Clients._norm(name).trim(); let out = '';
    (dogs || []).forEach(d => (d.tried || []).forEach(t => { if (t.verdict && Clients._norm(t.name).trim() === n) { if (t.verdict === 'avoid') out = 'avoid'; else if (!out) out = t.verdict; } }));
    return out;
  },
  /* Viande cochée « aime » ou produit noté « aimé » pour au moins un de ces chiens */
  _likedBy(dogs, p) {
    const meat = Clients._norm(p.meatType || '');
    return (dogs || []).some(d => Object.keys(d.meats || {}).some(m => d.meats[m] === 'like' && Clients._norm(m) === meat)) || this._triedVerdict(dogs, p.name) === 'like';
  },
  /* Note de date (0 à 1) : dépassée = 1 ; 30 j = 0,9 ; 90 j = 0,5 ; 6 mois = 0,2 ; 1 an et plus (ou sans date) = 0,05. Ne dépend plus de la date la plus lointaine du stock. */
  _dluoScore(d) {
    if (d === null || d === undefined || d >= 9999) return 0.05;
    if (d <= 0) return 1;
    if (d <= 30) return 1 - 0.1 * d / 30;
    if (d <= 90) return 0.9 - 0.4 * (d - 30) / 60;
    if (d <= 180) return 0.5 - 0.3 * (d - 90) / 90;
    if (d <= 365) return 0.2 - 0.15 * (d - 180) / 185;
    return 0.05;
  },
  /* Poids de chaque critère dans la note d'un produit (somme = 1). Une seule définition pour générer, exclure et remplacer. */
  /* Objectif choisi en haut (Antho 2026-11-19) : « Écouler » et « Rentable » s'appliquent à tous les types de panier ; « Équilibré » garde le réglage propre au type. */
  OBJECTIVES: [['dluo', 'Écouler'], ['mix', 'Équilibré'], ['coeff', 'Rentable']],
  setObjective(v) { this.priority = v; this.proposals = null; this.render(); },
  _weights() {
    if (this.priority === 'dluo') return { dluo: 0.40, coeff: 0.06, div: 0.12, size: 0.07, type: 0.07, meat: 0.07, gab: 0.08, hypoGras: 0.06, like: 0.07 };
    if (this.priority === 'coeff') return { dluo: 0.08, coeff: 0.38, div: 0.12, size: 0.07, type: 0.07, meat: 0.07, gab: 0.08, hypoGras: 0.06, like: 0.07 };
    if (this.kind === 'lot') return { dluo: 0.28, coeff: 0.30, div: 0.12, size: 0.06, type: 0.06, meat: 0.06, gab: 0.06, hypoGras: 0.03, like: 0.03 };
    // Commande site (Antho 2026-11-17) : le juste milieu entre dates courtes et bon coefficient (sans passage forcé des dates courtes, voir _buildBasket)
    if (this.kind === 'site') return { dluo: 0.22, coeff: 0.34, div: 0.10, size: 0.06, type: 0.06, meat: 0.06, gab: 0.06, hypoGras: 0.05, like: 0.05 };   // commande site : coefficients plus élevés (Antho 2026-11-18)
    return this.priority === 'dluo' ? { dluo: 0.36, coeff: 0.04, div: 0.14, size: 0.08, type: 0.08, meat: 0.08, gab: 0.08, hypoGras: 0.06, like: 0.08 }
      : this.priority === 'coeff' ? { dluo: 0.08, coeff: 0.32, div: 0.14, size: 0.08, type: 0.08, meat: 0.08, gab: 0.08, hypoGras: 0.06, like: 0.08 }
      : { dluo: 0.26, coeff: 0.08, div: 0.14, size: 0.08, type: 0.10, meat: 0.10, gab: 0.10, hypoGras: 0.06, like: 0.08 };
  },
  /* Étiquette « pour X » : seulement si le produit ne convient pas à tous les chiens */
  _dogTag(c) { return c && c.forDogs && c.forDogs.length < this._dogList().length ? c.forDogs.join(' et ') : ''; },
  _dogChoices() { return Clients.ro() ? [] : this._dogList().map(d => d._n); },
  setItemDog(i, v) { if (this.basket[i]) { this.basket[i].dog = v; this.render(); } },
  setClient(v) {
    v = String(v || '').trim();
    const c = Clients.find(v);
    this.client = c ? c.name : v;
    const dc = c ? Clients.discountOf(c.name) : null;   // réduction habituelle de la fiche → remplie toute seule
    if (dc) { this.reduction = dc.pct; this.reductionCode = dc.code; this._redAuto = true; }
    else if (this._redAuto) { this.reduction = 0; this.reductionCode = ''; this._redAuto = false; }
    if (c && (c.dogs || []).length) this.nbChiens = c.dogs.length;
    const sens = c && !Clients.ro() && (c.dogs || []).some(d => d.sensitive) && !this._perDog();
    if (sens) this.hypoOnly = true;
    const dogs = c && !Clients.ro() ? (c.dogs || []) : [];
    if (dogs.length) {   // particularités : un trait est coché dès qu'un des chiens l'a (fiche, sinon race) ; modifiables dans les réglages avancés
      const tr = dogs.map(d => this._traits(d));
      this.risks = this.RISKS.reduce((o, [k]) => { o[k] = tr.some(t => t[k]); return o; }, {});
      if (this.risks.tendre && this.risks.energique) this.risks.energique = false;
      this.races = [...new Set(dogs.flatMap(d => Races.ofDog(d).map(r => r.id)))];   // races de ses chiens, affichées dans les réglages avancés
    }
    const chews = [...new Set(dogs.map(d => this._chewOf(d)).filter(Boolean))];
    if (chews.length) {   // mâcheur de la fiche → résistance souhaitée cochée toute seule (modifiable dans les filtres)
      // La mastication longue n'est JAMAIS cochée d'office (Antho : elle ne revient qu'une fois tous les 2-3 mois) : tu la coches toi-même si tu la veux
      this._setResistFor(chews);
    }
    this.render();
    if (sens) U.toast('Chien sensible : « Hypoallergénique uniquement » est coché — décoche-le dans les filtres si besoin.');
    if (dc) U.toast(`🏷️ Réduction habituelle de ${U.qty(dc.pct)} %${dc.code ? ' (code ' + dc.code + ')' : ''} appliquée.`);
  },

  /* ---------- Données disponibles ---------- */
  candidates(diag) {   // diag (facultatif) : { 'pId|vId' ou 'pId' : raison } — pourquoi un produit n'est pas candidat (Antho 2026-11-19)
    const out = [];
    const why = (p, v, r) => { if (diag) diag[p.id + (v ? '|' + v.id : '')] = r; };
    const pd = this._perDog() ? this._dogList() : null;   // profils différents : on regarde, pour chaque produit, quels chiens peuvent le manger
    const cl = pd ? null : this._clientRules();
    // Chiens au même profil (ou un seul chien) : l'âge et le gabarit de la fiche comptent aussi (avant, seulement en « chien par chien »)
    const d0 = cl && cl.dogs.length ? cl.dogs[0] : null;
    const g0 = d0 ? this._growGab(d0) : null;   // chiot : taille d'aujourd'hui estimée d'après son âge et sa race
    const da = d0 ? this._dogAges(d0) : null, dg = d0 ? (g0 ? g0.cur : (d0.gabarit || '')) : '';
    const selAges = this._ageSel();
    const ago = this._boughtAgo();   // produits déjà achetés par la cliente : exclus s'ils sont récents, évités sinon

    Store.state.stockM.forEach(p => {
      if (this.excludeMeats.includes(p.meatType)) return why(p, null, 'viande exclue (réglages)');
      if (ago[p.id] !== undefined && ago[p.id] < this.RECENT_DAYS) return why(p, null, 'acheté par la cliente il y a moins d\'un mois');   // acheté récemment : jamais reproposé (doublon), même à date courte
      if (this.excludeProducts.includes(p.id)) return why(p, null, 'produit exclu (⊘)');
      if (this._dropped.includes(p.id)) return why(p, null, 'retiré de ce panier');   // retiré / remplacé dans ce panier

      const pTags = Stock.effTags(p);
      if (this.poilFilter === 'avec' && pTags.poil !== 'avec' && pTags.poil !== 'les_deux') return why(p, null, 'sans poil (filtre « avec poil »)');
      if (this.poilFilter === 'sans' && pTags.poil === 'avec') return why(p, null, 'avec poil (filtre « sans poil »)');
      if (this.hypoOnly && pTags.hypo !== 'oui') return why(p, null, 'pas hypoallergénique');
      if (cl) {
        if (Clients.conflictsFor(cl.dogs, { kind: 'M', type: p.meatType || '', name: p.name }).length) return why(p, null, 'viande à éviter / allergie (fiche du chien)');
        if (cl.hair && pTags.poil === 'avec') return why(p, null, 'avec poil (fiche du chien)');
        if (this._triedVerdict(cl.dogs, p.name) === 'avoid') return why(p, null, 'pas aimé (fiche du chien)');   // produit déjà goûté et noté « pas aimé » sur la fiche
        const nm = Clients._norm(p.meatType || '');
        if (cl.dogs.some(d => this._traits(d).avoidMeats.some(m => Clients._norm(m) === nm))) return why(p, null, 'viande déconseillée pour la race');   // viande à éviter pour la race d'un des chiens
      }

      p.variants.forEach(v => {
        if (v.mode === 'vrac') return why(p, v, 'vendu en vrac');

        const tags = this._mergeTags(pTags, Stock.variantTags(p, v));
        if (cl && ((cl.odor && tags.odeur === 'forte') || (cl.fat && tags.gras === 'gras'))) return why(p, v, cl.odor && tags.odeur === 'forte' ? 'odeur forte (fiche du chien)' : 'gras (fiche du chien)');

        if (this.resistanceInclude.length) {
          const r = tags.resistance;
          if (r && !this.resistanceInclude.includes(r)) return why(p, v, 'résistance non cochée (' + r + ')');
        }
        if (this.typeFilter !== 'all' && (tags.type || 'occupation') !== this.typeFilter) return why(p, v, 'type (éducation / occupation)');
        if (this.odeurInclude.length && tags.odeur && !this.odeurInclude.includes(tags.odeur)) return why(p, v, 'odeur (réglages)');
        if (this.grasInclude.length && tags.gras && !this.grasInclude.includes(tags.gras)) return why(p, v, 'gras (réglages)');
        if (this.ageInclude.length && tags.age.length > 0 && !tags.age.some(a => this.ageInclude.includes(a))) return why(p, v, 'âge (réglages)');
        if (this.gabaritInclude.length && tags.gabarit.length > 0 && !tags.gabarit.some(g => this.gabaritInclude.includes(g))) return why(p, v, 'gabarit (réglages)');
        if (tags.species && tags.species.length && !tags.species.includes('chien')) return why(p, v, 'pour chat');   // produit réservé aux chats : jamais dans un panier pour chiens
        if (da && tags.age.length > 0 && !tags.age.some(x => da.includes(x))) return why(p, v, 'pas pour l\'âge du chien');
        if (dg && tags.gabarit.length > 0 && !tags.gabarit.includes(dg)) return why(p, v, 'pas pour la taille du chien' + (g0 ? ' (il grandit)' : ''));
        if (!pd && this._tooBigForGrowing(g0, tags)) return why(p, v, 'trop gros pour un chien qui grandit');
        if (!pd && this._tooHardForPuppy(da || selAges, tags)) return why(p, v, 'trop dur pour un chiot');
        const small = (dg || (this._gabSel() || []).join()) === 'petit';
        if (this._riskBlocks(this.risks, tags, v, small)) return why(p, v, 'particularités (glouton, dents, surpoids…)');   // particularités cochées dans les réglages avancés
        let suits = null;
        this._curVar = v;
        if (pd) { suits = pd.filter(d => this._dogSuits(d, p, pTags, tags)); if (!suits.length) return why(p, v, 'ne convient à aucun des chiens'); }
        const dogsFor = suits || (cl ? cl.dogs : []), liked = this._likedBy(dogsFor, p);
        let chews = [...new Set(dogsFor.map(d => this._chewOf(d)).filter(Boolean))];
        if (this.risks.tendre) chews = ['doux'];   // « préfère le tendre » : l'emporte sur l'énergie et le gabarit
        else if (!chews.length && this.risks.energique) chews = ['gros'];   // sans fiche : « très énergique » coché = traité comme un gros mâcheur

        const lots = v.lots.filter(l => {
          const q = U.num(l.qtyGeneral) + U.num(l.qtyEvent);
          if (q <= 0) return false;
          const d = U.daysTo(l.dluo);
          // les lots périmés restent candidats (paniers pour associations) : ils passent en tête grâce au score de DLUO
          return true;
        });
        if (!lots.length) return why(p, v, 'plus en stock');

        const rc = Stock.refCalc(p, v);   // prix = fiche Prix mastication (la référence), jamais la copie du Stock
        const price = rc ? rc.calc.priceTTC : U.num(v.priceTTC);
        if (price <= 0) return why(p, v, 'pas de prix');
        const coeff = rc ? (rc.calc.effCoeff || 0) : 0;

        lots.forEach(l => {
          const avail = U.num(l.qtyGeneral) + U.num(l.qtyEvent);
          const daysLeft = U.daysTo(l.dluo);
          out.push({
            pId: p.id, vId: v.id, lotId: l.id,
            name: p.name, meat: p.meatType || '',
            variant: Pricing.labelVariant(v),
            sku: v.sku || '',
            price, coeff, avail,
            dluo: l.dluo || '', daysLeft: daysLeft !== null ? daysLeft : 9999,
            lotNumber: l.lotNumber || '',
            tags,
            mode: v.mode || '', value: v.value,
            ...this._famInfo(p, v),
            ...(suits ? { forDogs: suits.map(d => d._n), ages: (x => x.length ? x : undefined)([...new Set(suits.flatMap(d => this._dogAges(d) || []))]), gabs: (x => x.length ? x : undefined)([...new Set(suits.map(d => d.gabarit).filter(Boolean))]) } : { ages: da || undefined, gabs: dg ? [dg] : undefined }),
            chews, liked, teeth: !!(this.risks.teeth || dogsFor.some(d => this._traits(d).teeth)), grow: !pd && g0 ? g0.cur : undefined
          });
        });
      });
    });
    return out;
  },

  /* ---------- Algorithme de composition ---------- */
  /* Déclinaisons (ex. 25CM et 25CM LOT 2) : même « famille » → jamais proposées ensemble dans un panier. */
  _famInfo(p, v) {
    const par = Stock.parentOf(p, v);
    return { family: Stock.familyKey(p, v), packQty: par ? Stock.packQtyOf(v) : 1, hasPack: !!par || Stock.childrenOf(p, v).length > 0 };
  },
  _famOf(b) {
    if (b.family) return b.family;
    const sp = Store.state.stockM.find(x => x.id === b.pId); const sv = sp?.variants.find(x => x.id === b.vId);
    return sp && sv ? Stock.familyKey(sp, sv) : b.pId + ':' + b.vId;
  },
  /* true si une AUTRE variante de la même famille est déjà dans le panier (hors créneau `skipIdx`). */
  _famTaken(c, basket, skipIdx = -1) {
    const tw = Stock.twinIdOf(c.pId);   // jumeau avec / sans poils : jamais les deux dans le même panier (Antho 2026-11-17)
    // même PRODUIT dans un autre format, même si ce format n'est pas déclaré comme son lot (Trachée : « 1 pièce » et « Lot de 2 pc » indépendants, Antho 2026-11-19),
    // y compris avec plusieurs chiens : un lot de 2 couvre déjà les deux. Ajout à la main : toujours possible.
    return basket.some((b, i) => i !== skipIdx && ((this._famOf(b) === c.family && b.vId !== c.vId) || (b.pId === c.pId && b.vId !== c.vId) || (tw && b.pId === tw)));
  },
  _sizePrefScore(c) {
    // Taille déclinée en lots : plusieurs chiens → le lot, un seul chien → la pièce.
    const nn = c.forDogs ? c.forDogs.length : this.nbChiens;   // chiens concernés par CE produit
    if (c.hasPack) {
      if (c.packQty > 1) return nn > 1 ? 1.0 : 0.25;
      return nn > 1 ? 0.3 : 0.8;
    }
    if (c.mode !== 'gram') return 0.5;
    const v = U.num(c.value);
    if (nn > 1) {
      if (v >= 250) return 1.0;
      if (v >= 100) return 0.5;
      return 0.2;
    }
    if (v === 100) return 1.0;
    if (v === 50) return 0.6;
    if (v === 250) return 0.3;
    return 0.1;
  },

  _typePrefScore(c) {
    const t = (c.tags && c.tags.type) || 'occupation';
    if (t === 'occupation') return 1.0;
    if (t === 'education') return 0.2;
    return 0.6;
  },

  _meatAgePrefScore(c) {
    const ages = c.ages || this._ageSel();   // âge du chien (fiche) sinon tranches choisies ; toutes cochées = âge inconnu = aucune préférence
    if (!ages || !ages.length || (ages.length === 1 && ages[0] === '11+')) return 0.5;
    const m = (c.meat || '').toLowerCase();
    const volaille = m === 'poulet' || m === 'canard' || m === 'dinde';
    const isChiot = ages.some(a => a === '0-3' || a === '3-5' || a === '6-10');
    const dur = m === 'chameau' || m === 'sanglier' || m === 'cerf';
    if (isChiot) {
      if (dur) return 0.1;
      if (volaille || m === 'lapin' || m === 'agneau') return 1.0;
      if (m === 'poisson') return 0.9;
      return 0.3;
    }
    if (ages.includes('senior')) {
      if (dur) return 0.1;
      if (volaille || m === 'lapin' || m === 'agneau') return 1.0;
      if (m === 'veau') return 0.9;
      if (m === 'poisson') return 0.7;
      if (m === 'boeuf' || m === 'bœuf') return 0.2;
      return 0.35;
    }
    return 0.5;
  },

  _gabaritResistScore(c) {
    const r = (c.tags && c.tags.resistance) || '';
    if (!r) return 0.5;
    if (c.chews && c.chews.length) {   // « Mâcheur » de la fiche du chien : doux → produits tendres, gros destructeur → produits durs
      const T = { doux: { faible: 1, moyenne: 0.6, forte: 0.15, 'tres-forte': 0.05, longue: 0.05 }, moyen: { faible: 0.7, moyenne: 1, forte: 0.6, 'tres-forte': 0.2, longue: 0.3 }, gros: { faible: 0.2, moyenne: 0.6, forte: 1, 'tres-forte': 1, longue: 1 } };
      const sc = c.chews.map(k => (T[k] || {})[r]).filter(x => x !== undefined);
      if (sc.length) return sc.reduce((a, b) => a + b, 0) / sc.length;
    }
    const gabs = c.gabs || this._gabSel();
    if (!gabs || !gabs.length) return 0.5;
    const hasGrand = gabs.includes('grand');
    const hasMoyen = gabs.includes('moyen');
    const hasPetit = gabs.includes('petit');
    if (hasGrand && !hasPetit) {
      if (this.HARD.includes(r)) return 1.0;
      if (r === 'moyenne') return 0.6;
      return 0.2;
    }
    if (hasPetit && !hasGrand) {
      if (r === 'faible') return 1.0;
      if (r === 'moyenne') return 0.7;
      return 0.2;
    }
    return 0.5;
  },

  _hypoGrasScore(c) {
    if (!this.hypoOnly) return 0.5;
    const g = (c.tags && c.tags.gras) || '';
    if (!g) return 0.5;
    if (g === 'non') return 1.0;
    if (g === 'peu') return 0.8;
    if (g === 'moyen') return 0.3;
    return 0.1;
  },

  /* Équilibre du panier : autant de produits au gramme que de produits en vrac (pièces / tailles), et un produit dur quand il n'y en a pas encore (si le filtre Résistance l'autorise) */
  _bal: null,
  _balScore(c) {
    const b = this._bal; if (!b) return 0.5;
    const n = b.gram + b.vrac, hard = this.HARD.includes((c.tags && c.tags.resistance) || '');
    if (hard && !b.hard && n >= 2) return 1;
    if (!n) return 0.5;
    const gs = b.gram / n;
    return c.mode === 'gram' ? 1 - gs : gs;
  },
  _itemScore(c, usedProducts, usedMeats, maxCoeff, weights, mult) {
    const dluoScore = this._dluoScore(c.daysLeft);
    const coeffScore = maxCoeff > 0 ? c.coeff / maxCoeff : 0;
    let divScore = 1;
    if (usedProducts.has(c.pId)) divScore = 0.15;
    else if ((usedMeats[c.meat] || 0) >= 2 * mult) divScore = 0.4;
    else if ((usedMeats[c.meat] || 0) >= 1 * mult) divScore = 0.7;
    const sizeScore = this._sizePrefScore(c);
    const typeScore = this._typePrefScore(c);
    const meatScore = this._meatAgePrefScore(c);
    const gabScore = this._gabaritResistScore(c);
    const hypoGrasScore = this._hypoGrasScore(c);
    return this._fitMult(c) * (0.12 * this._balScore(c) + weights.dluo * dluoScore + weights.coeff * coeffScore + weights.div * divScore + weights.size * sizeScore + weights.type * typeScore + weights.meat * meatScore + weights.gab * gabScore + weights.hypoGras * hypoGrasScore + (weights.like || 0) * (c.liked ? 1 : 0.5));
  },
  /* Règles d'Antho (2026-11-17) : le produit reste possible, il passe seulement DERRIÈRE.
     · Grand chien (grand coché, petit non) : un produit aussi coché « Petit » (ex. oreille d'agneau) se mange trop vite pour l'occuper.
     · Dents fragiles (réglages avancés ou fiche du chien) : priorité aux produits cochés « Sénior ». */
  _fitMult(c) {
    const t = c.tags || {}, g = t.gabarit || [], a = t.age || [], gabs = c.gabs || this._gabSel();
    let m = 1;
    if (gabs && gabs.includes('grand') && !gabs.includes('petit') && g.includes('petit')) m *= 0.6;
    if (c.teeth && a.length && !a.includes('senior')) m *= 0.6;
    if (c.grow === 'moyen' && g.length && !g.includes('petit')) m *= 0.7;
    m *= this._learnMult(c) * this._popMult(c);   // ce que le générateur a appris d'Antho + popularité réelle (étape 2)   // chiot de taille moyenne qui grandit : ce qui convient aussi aux petits passe devant
    return m;
  },

  /* ═══ VARIÉTÉ (Antho 2026-11-17) ═══
     · « Morceau » = 1er mot du nom (Cou, Filet, Patte, Trachée, Oreille, Peau…), singulier, sans accent ; hareng et sprat = même morceau.
     · Deux produits sont TROP PROCHES s'ils sont le même morceau ET de même résistance (ou résistance inconnue) : trachée d'agneau + trachée
       d'autruche, cou d'oie + cou de dinde, patte de poulet + patte de canard. Oreille d'agneau (faible) + oreille de bœuf (forte) : accepté.
     · Tant qu'il reste d'autres choix : chaque produit une seule fois, et jamais deux produits trop proches. */
  CUT_ALIAS: { sprat: 'hareng', sprats: 'hareng', pavillion: 'pavillon' },
  _cutKey(name) {
    let w = String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().split(/[^a-z0-9]+/)[0] || '';
    if (this.CUT_ALIAS[w]) return this.CUT_ALIAS[w];
    if (w.length > 3 && /[sx]$/.test(w)) w = w.slice(0, -1);
    return this.CUT_ALIAS[w] || w;
  },
  _simOf(x) {
    if (x.cut !== undefined && x.res !== undefined) return { cut: x.cut, res: x.res };
    const sp = Store.state.stockM.find(p => p.id === x.pId), sv = sp && sp.variants.find(v => v.id === x.vId);
    const res = sp ? (this._mergeTags(Stock.effTags(sp), sv ? Stock.variantTags(sp, sv) : null).resistance || '') : '';
    return { cut: this._cutKey(sp ? sp.name : x.name), res };
  },
  _isFresh(c, basket) { return !basket.some(b => b.pId === c.pId) && !this._tooClose(c, basket) && !(this._avoidLike && this._tooClose(c, this._avoidLike)); },
  _avoidLike: null,   // produit qu'on est en train de remplacer : ses « jumeaux de morceau » passent derrière
  _tooClose(c, basket) {
    const a = this._simOf(c);
    if (!a.cut) return false;
    return basket.some(b => { if (b.pId === c.pId) return false; const o = this._simOf(b); return o.cut === a.cut && (!a.res || !o.res || a.res === o.res); });
  },
  /* LOTS (Antho 2026-11-18 : « deux rouleaux de porc à 4 € alors que le lot de 2 existe ») : une ligne à N exemplaires d'une taille qui a sa déclinaison
     « LOT N » disponible devient 1 × LOT N (moins cher pour le client, conditionnement plus cohérent). Lignes verrouillées jamais touchées. Renvoie l'écart de prix. */
  _packUp(basket, cands) {
    let delta = 0;
    basket.forEach((b, i) => {
      if (b.locked || !(b.qty >= 2)) return;
      const lot = cands.filter(c => c.pId === b.pId && c.vId !== b.vId && c.family && c.family === b.family && U.num(c.packQty) === b.qty && c.avail > 0)
        .sort((x, y) => x.daysLeft - y.daysLeft)[0];
      if (!lot) return;
      const old = cands.find(x => x.pId === b.pId && x.vId === b.vId && x.lotId === b.lotId); if (old) old.avail += b.qty;
      delta += lot.price - b.price * b.qty;
      basket[i] = { pId: lot.pId, vId: lot.vId, lotId: lot.lotId, name: lot.name, meat: lot.meat, variant: lot.variant, price: lot.price, qty: 1, dluo: lot.dluo, daysLeft: lot.daysLeft,
        coeff: lot.coeff, lotNumber: lot.lotNumber, locked: false, gen: true, family: lot.family, dog: b.dog, ...this._simOf(lot) };
      lot.avail--;
    });
    return delta;
  },
  /* ═══ APPRENDRE D'ANTHO (étape 2, 2026-11-19) ═══
     On note, par produit et par PROFIL de chien (âge : chiot / adulte / sénior × taille d'aujourd'hui), ce qu'Antho fait des propositions :
     r = retiré / remplacé / exclu (une proposition du générateur), a = ajouté à la main, s = vendu via un panier. Plus le compteur « tous profils » ('*').
     Effet : note × 0,55 à 1,35 (le profil compte pour 70 %, l'ensemble pour 30 %). S'y ajoute la popularité réelle (ventes des 12 derniers mois, événements compris) :
     × 0,92 à 1,12. Tout est visible et effaçable dans « Ce que j'ai appris ». Enregistré seulement pour l'admin (Store.state.panLearn). */
  _L() { const s = Store.state; if (!s.panLearn || !s.panLearn.p) s.panLearn = { p: {} }; return s.panLearn; },
  _learnKey() {
    const cl = this._perDog() ? null : this._clientRules(), d0 = cl && cl.dogs.length ? cl.dogs[0] : null;
    const ages = (d0 && this._dogAges(d0)) || this._ageSel();
    const g0 = d0 ? this._growGab(d0) : null, gs = this._gabSel();
    const gab = g0 ? g0.cur : (d0 && d0.gabarit) || (gs && gs.length === 1 ? gs[0] : '');
    const age = !ages ? '' : ages.includes('senior') && !ages.some(x => x !== 'senior' && x !== '11+') ? 'sénior' : ages.some(x => ['0-3', '3-5', '6-10'].includes(x)) ? 'chiot' : 'adulte';
    return (age || 'tout âge') + ' · ' + (gab || 'toute taille');
  },
  _learn(pId, field, n) {
    if (!pId || Clients.ro() || !(Store.isAdmin && Store.isAdmin())) return;
    const L = this._L(), rec = L.p[pId] || (L.p[pId] = {});
    [this._learnKey(), '*'].forEach(k => { const r = rec[k] || (rec[k] = { r: 0, a: 0, s: 0 }); r[field] = (r[field] || 0) + (n || 1); r.t = Date.now(); });
    Store.save('panLearn');
  },
  _learnScore(r) { return r ? (r.a || 0) + (r.s || 0) - 1.5 * (r.r || 0) : 0; },
  _learnMult(c) {
    const rec = this._L().p[c.pId]; if (!rec) return 1;
    const k = this._learnKey(), v = 0.7 * this._learnScore(rec[k]) + 0.3 * this._learnScore(rec['*']);
    return Math.max(0.55, Math.min(1.35, 1 + 0.06 * v));
  },
  /* Popularité : quantités vendues sur 12 mois par produit (toutes ventes), rang → × 0,92 (jamais vendu) à × 1,12 (le plus vendu). Calculée une fois par génération. */
  _popCache: null,
  _popMult(c) {
    const sales = Store.state.sales || [], key = sales.length + ':' + (Store.state.stockM || []).length;
    if (!this._popCache || this._popCache.key !== key) {
      const cut = Date.now() - 365 * 86400000, q = {};
      sales.forEach(x => { if (x.cancelled || U.num(x.ts) < cut) return; (x.items || []).forEach(i => { if ((i.kind || 'M') !== 'M') return; const f = this._stockOf(i); if (f) q[f.p.id] = (q[f.p.id] || 0) + U.num(i.qty); }); });
      const ranked = Object.keys(q).sort((a, b) => q[b] - q[a]), rank = {};
      ranked.forEach((id, i) => { rank[id] = ranked.length > 1 ? 1 - i / (ranked.length - 1) : 1; });
      this._popCache = { key, rank, q };
    }
    const r = this._popCache.rank[c.pId];
    return r === undefined ? 0.92 : 0.96 + 0.16 * r;
  },
  _learnedHTML() {
    if (Clients.ro()) return '';
    const L = this._L(), k = this._learnKey(), rows = [];
    Object.keys(L.p).forEach(id => {
      const p = Store.state.stockM.find(x => x.id === id); if (!p) return;
      const rec = L.p[id], m = this._learnMult({ pId: id }); if (Math.abs(m - 1) < 0.005) return;
      const pr = rec[k] || {}, gl = rec['*'] || {};
      rows.push({ id, name: p.name, m, txt: `${gl.s || 0} vendu${(gl.s || 0) > 1 ? 's' : ''} via un panier · ${gl.a || 0} ajouté${(gl.a || 0) > 1 ? 's' : ''} à la main · ${gl.r || 0} retiré${(gl.r || 0) > 1 ? 's' : ''}${(pr.r || pr.a || pr.s) ? ` (dont ce profil : +${(pr.a || 0) + (pr.s || 0)} / −${pr.r || 0})` : ''}` });
    });
    const pop = this._popCache && this._popCache.q ? Object.keys(this._popCache.q).sort((a, b) => this._popCache.q[b] - this._popCache.q[a]).slice(0, 5).map(id => { const p = Store.state.stockM.find(x => x.id === id); return p ? `${U.esc(p.name)} (${U.qty(this._popCache.q[id])})` : ''; }).filter(Boolean) : [];
    const up = rows.filter(r => r.m > 1).sort((a, b) => b.m - a.m).slice(0, 8), down = rows.filter(r => r.m < 1).sort((a, b) => a.m - b.m).slice(0, 8);
    const line = r => `<div class="pan-learn-row"><span><b>${U.esc(r.name)}</b> <span class="muted">${r.txt}</span></span><span class="pan-learn-m ${r.m > 1 ? 'ok-txt' : 'warn-txt'}">${r.m > 1 ? '+' : '−'}${Math.round(Math.abs(r.m - 1) * 100)} %</span><button type="button" class="btn-ghost btn-sm fit" onclick="Paniers.forgetLearn('${r.id}')">Oublier</button></div>`;
    return `<details class="fold pan-learn" ${this._learnOpen ? 'open' : ''} ontoggle="Paniers._learnOpen=this.open"><summary>🧠 Ce que j'ai appris <span class="muted">· profil : ${U.esc(k)}</span></summary><div class="fold-body">
      <p class="muted help">Le générateur retient ce que tu fais de ses propositions : un produit que tu retires ou remplaces passe derrière (surtout pour ce profil de chien) ; un produit que tu ajoutes ou que tu vends via un panier passe devant. Les produits qui se vendent le mieux sur 12 mois ont aussi un petit coup de pouce. « Oublier » efface ce qui a été appris sur un produit.</p>
      ${up.length ? `<div class="pan-learn-h">Mis en avant</div>${up.map(line).join('')}` : ''}
      ${down.length ? `<div class="pan-learn-h">Passés derrière</div>${down.map(line).join('')}` : ''}
      ${!up.length && !down.length ? '<p class="muted">Tes retouches : rien encore pour ce profil (ça se remplit à mesure que tu modifies des paniers générés).</p>' : ''}
      ${pop.length ? `<div class="pan-learn-h">Les plus vendus (12 mois)</div><p class="muted" style="margin:2px 0;">${pop.join(' · ')}</p>` : ''}
      ${(() => { const m = this._pairsAll(), nm = id => (Store.state.stockM.find(p => p.id === id) || {}).name, top = Object.entries(m).filter(([k]) => k.split('|').every(nm)).sort((a, b) => b[1] - a[1]).slice(0, 10);
        return top.length ? `<div class="pan-learn-h">Souvent pris ensemble</div><p class="muted" style="margin:2px 0;">${top.map(([k, n]) => U.esc(k.split('|').map(nm).join(' + ')) + ` (${n})`).join(' · ')}</p>` : ''; })()}
      ${(() => { const u = Object.entries(L.unk || {}).sort((a, b) => b[1] - a[1]); return u.length ? `<p class="muted" style="font-size:.8rem;margin-top:6px;">${u.length} libellé${u.length > 1 ? 's' : ''} SumUp non reconnu${u.length > 1 ? 's' : ''} (ignoré${u.length > 1 ? 's' : ''} pour les associations) : ${u.slice(0, 8).map(([k, n]) => U.esc(k) + ' (' + n + ')').join(' · ')}${u.length > 8 ? '…' : ''}</p>` : ''; })()}
    </div></details>`;
  },
  /* ═══ SOUVENT PRIS ENSEMBLE (étape 3, 2026-11-19) ═══
     Sources : (1) chaque RETOUR D'ÉVÉNEMENT (rapport des ventes SumUp) — les articles d'une même « Réf. transaction » = le panier d'un client ;
     (2) l'historique SumUp mai 2024 → nov. 2026, chargé une fois directement en base le 2026-11-18 ; (3) les ventes de l'appli hors événements (site, direct, paniers envoyés en vente).
     On ne garde QUE des compteurs par paire de produits du stock (panLearn.pairs) et les références déjà comptées (panLearn.tx) : aucun nom de client.
     Un libellé SumUp sans SKU est rattaché à un produit du stock seulement si son nom correspond nettement (sinon il est compté « non reconnu », visible). */
  _nameTok(s) {
    const stop = new Set(['de', 'd', 'du', 'des', 'la', 'le', 'les', 'l', 'en', 'et', 'a', 'au', 'aux', 'pour', 'pcs', 'pc', 'piece', 'pieces', 'lot', 'unite', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'g', 'kg', 'cm', 'mini', 'maxi', 'touffu', 'shop']);
    return String(s || '').toLowerCase().replace(/œ/g, 'oe').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\+\s*poils?/g, ' avec poils')
      .split(/[^a-z0-9]+/).filter(w => w && !stop.has(w) && !/^\d+(g|kg|cm|mm|m)?$/.test(w)).map(w => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w));
  },
  _matchName(desc) {
    const dt = [...new Set(this._nameTok(desc))]; if (!dt.length) return '';
    let best = null, second = 0;
    (Store.state.stockM || []).forEach(p => {
      const pt = new Set(this._nameTok(p.name)); if (!pt.size) return;
      const inter = dt.filter(w => pt.has(w)).length; if (!inter) return;
      /* tous les mots du rapport sont dans le nom du stock (« MOULES 50G » → « Moule séchée ») : bon score, un peu moins s'il y a des mots en plus */
      const sc = inter === dt.length ? (inter === pt.size ? 1 : Math.max(0.7, 0.95 - 0.05 * (pt.size - inter))) : inter / new Set([...dt, ...pt]).size;
      if (!best || sc > best.sc) { second = best ? best.sc : 0; best = { id: p.id, sc }; } else if (sc > second) second = sc;
    });
    /* nom identique = gagne même si un cousin existe (« Corne de vache » face à « Corne de vache pleine ») */
    return best && best.sc >= 0.6 && (best.sc - second >= 0.15 || (best.sc === 1 && second < 1)) ? best.id : '';
  },
  /* lignes = [{ ref, desc, target? }] (format du retour d'événement). Compte chaque transaction une seule fois. Renvoie { tx, pairs, unknown }. */
  learnFromSumup(lines) {
    if (!(Store.isAdmin && Store.isAdmin()) || !Array.isArray(lines) || !lines.length) return null;
    const L = this._L(); L.pairs = L.pairs || {}; L.tx = L.tx || {}; L.unk = L.unk || {};
    const byRef = {};
    lines.forEach(l => { if (!l || !l.ref || L.tx[l.ref]) return; (byRef[l.ref] = byRef[l.ref] || []).push(l); });
    let tx = 0, pairs = 0, unknown = 0;
    Object.keys(byRef).forEach(ref => {
      const ids = new Set();
      byRef[ref].forEach(l => {
        const t = l.target, mt = !t && typeof Ventes !== 'undefined' && Ventes._mapTarget ? Ventes._mapTarget(l.desc) : null;
        const id = t && t.kind === 'M' ? t.pId : mt && mt.kind === 'M' ? mt.pId : (t || mt) ? '' : this._matchName(l.desc);
        if (id) ids.add(id);
        else if (!t && !mt && l.desc && !/montant personnalis|commande|livraison/i.test(l.desc)) { const k = l.desc.trim().slice(0, 60); L.unk[k] = (L.unk[k] || 0) + 1; unknown++; }
      });
      const a = [...ids].sort();
      for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { const k = a[i] + '|' + a[j]; L.pairs[k] = (L.pairs[k] || 0) + 1; pairs++; }
      L.tx[ref] = 1; tx++;
    });
    if (tx) { this._pairCache = null; Store.save('panLearn'); }
    return { tx, pairs, unknown };
  },
  /* Paires vues dans les ventes de l'appli hors événements (site, direct, paniers envoyés en vente) : recalculées à la volée. */
  _pairCache: null,
  _pairsAll() {
    const sales = Store.state.sales || [], L = this._L(), key = sales.length + ':' + Object.keys(L.pairs || {}).length;
    if (this._pairCache && this._pairCache.key === key) return this._pairCache.m;
    const m = Object.assign({}, L.pairs || {});
    sales.forEach(s => {
      if (s.cancelled || s.source === 'event') return;
      const ids = [...new Set((s.items || []).filter(i => (i.kind || 'M') === 'M').map(i => { const f = this._stockOf(i); return f ? f.p.id : ''; }).filter(Boolean))].sort();
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = ids[i] + '|' + ids[j]; m[k] = (m[k] || 0) + 1; }
    });
    this._pairCache = { key, m };
    return m;
  },
  _pairMult(c, basket) {
    if (!basket || !basket.length) return 1;
    const m = this._pairsAll(); let s = 0;
    [...new Set(basket.map(b => b.pId))].forEach(id => { if (id === c.pId) return; const k = id < c.pId ? id + '|' + c.pId : c.pId + '|' + id; s += Math.min(6, m[k] || 0); });
    return Math.min(1.3, 1 + 0.03 * s);
  },
  /* ═══ COEFF VISÉ (étape 4, 2026-11-19) : réglage settings.panCoeffTarget (2,0 par défaut, 0 = sans cible).
     Tant que le coeff moyen du panier en cours est SOUS la cible, les produits au-dessus de la cible passent devant et ceux en dessous
     reculent (×0,75 à ×1,3) ; cible atteinte = plus d'effet. Jamais en objectif « Écouler » (les dates courtes priment). */
  _coeffTarget() { return Math.max(0, U.num(Store.state.settings && Store.state.settings.panCoeffTarget)); },
  _avgCoeff(lines) { const ci = (lines || []).filter(b => b.coeff > 0), q = ci.reduce((a, b) => a + U.num(b.qty), 0); return q > 0 ? ci.reduce((a, b) => a + b.coeff * U.num(b.qty), 0) / q : 0; },
  _coeffMult(c, basket) {
    const t = this._coeffTarget(); if (!t || this.priority === 'dluo' || !(c.coeff > 0)) return 1;
    const avg = this._avgCoeff(basket), strength = avg > 0 ? Math.max(0, Math.min(1, (t - avg) / 0.4)) : 0.3;
    return strength ? Math.max(0.75, Math.min(1.3, 1 + 0.5 * strength * (c.coeff - t) / t)) : 1;
  },
  _coeffTag(avg) {
    const t = this._coeffTarget(); if (!t || !(avg > 0)) return '';
    return ` <span class="${avg >= t - 0.005 ? 'pan-ct-ok' : 'pan-ct-low'}">(visé ${t.toFixed(2).replace('.', ',')})</span>`;
  },
  setCoeffTarget(v) {
    const n = U.num(String(v).replace(',', '.')); if (!(n >= 0) || n > 10) { U.toast('Coeff visé : un nombre entre 0 et 10 (0 = pas de cible).', true); this.render(); return; }
    Store.state.settings.panCoeffTarget = Math.round(n * 100) / 100; Store.save('settings'); this.proposals = null; this.render();
  },
  forgetLearn(id) { const L = this._L(); delete L.p[id]; Store.save('panLearn'); this.render(); U.toast('Oublié : ce produit repart de zéro.'); },
  _buildBasket(maxAvailable, lockedItems) {
    const cands = this.candidates();
    const basket = lockedItems.map(b => ({...b}));
    let spent = basket.reduce((a, b) => a + b.price * b.qty, 0);
    if (!cands.length) return basket;

    const maxCoeff = Math.max(...cands.map(c => c.coeff), 1);

    const weights = this._weights();

    const usedProducts = new Set();
    const usedMeats = {};
    basket.forEach(b => {
      usedProducts.add(b.pId);
      usedMeats[b.meat] = (usedMeats[b.meat] || 0) + b.qty;
    });

    const mult = Math.max(1, this.nbChiens);
    const nd = this._perDog() ? this._dogList().length : 0, shareCap = nd ? maxAvailable / nd : Infinity;   // budget « réservé » à chaque chien pour ses produits à lui
    const spentBy = {};
    basket.forEach(b => { if (b.dog && !b.dog.includes(' et ')) spentBy[b.dog] = (spentBy[b.dog] || 0) + b.price * b.qty; });

    basket.forEach(b => {
      const c = cands.find(x => x.pId === b.pId && x.vId === b.vId && x.lotId === b.lotId);
      if (c) c.avail = Math.max(0, c.avail - b.qty);
    });

    const score = (c) => this._itemScore(c, usedProducts, usedMeats, maxCoeff, weights, mult) * this._pairMult(c, basket) * this._coeffMult(c, basket);   // « souvent pris ensemble » (étape 3) + coeff visé (étape 4)
    // Ligne VERROUILLÉE par Antho (cadenas) : sa quantité ne bouge jamais, ni d'autre exemplaire de ce produit (Antho 2026-11-19).
    // _frozen explicite (Compléter) ; sinon toute ligne verrouillée reçue (Générer avec cadenas, Remplacer) est figée.
    const frozenP = new Set(lockedItems.filter(b => b._frozen === undefined ? b.locked : b._frozen).map(b => b.pId));

    for (let i = 0; i < 500; i++) {
      const affordable = cands.filter(c => c.price <= maxAvailable - spent && c.avail > 0 && !frozenP.has(c.pId));
      if (!affordable.length) break;

      const productQties = {};
      basket.forEach(b => { productQties[b.pId] = (productQties[b.pId] || 0) + b.qty; });
      let eligible = affordable.filter(c => {
        const mu = c.forDogs ? c.forDogs.length : mult;   // chiens concernés par ce produit
        if ((productQties[c.pId] || 0) >= this.maxPerProduct * mu) return false;
        if ((productQties[c.pId] || 0) >= this._capOf(c.pId)) return false;   // quantité baissée à la main : on ne la redépasse pas
        if (c.mode === 'gram' && (mu > 1 || c.forDogs) && basket.some(b => b.pId === c.pId)) return false;   // un sachet (plusieurs morceaux) suffit : pas deux fois le même produit au gramme
        if (c.forDogs && c.forDogs.length === 1 && (spentBy[c.forDogs[0]] || 0) + c.price > shareCap) return false;
        return !this._famTaken(c, basket);
      });
      const hardInBasket = basket.some(b => {
        const sp = Store.state.stockM.find(x => x.id === b.pId);
        if (!sp) return false;
        const sv = sp.variants.find(x => x.id === b.vId);
        const mt = this._mergeTags(Stock.effTags(sp), sv ? Stock.variantTags(sp, sv) : null);
        return this.HARD.includes(mt.resistance);
      });
      // Un seul produit dur par panier… sauf pour un « gros destructeur » (fiche du chien), à qui il en faut plusieurs — mais JAMAIS deux mastications longues
      if (hardInBasket) eligible = eligible.filter(c => !this.HARD.includes(c.tags.resistance) || (c.chews && c.chews.includes('gros')));
      if (basket.some(b => this._resOf(b) === 'longue')) eligible = eligible.filter(c => c.tags.resistance !== 'longue');
      if (!eligible.length) break;
      // VARIÉTÉ d'abord (Antho 2026-11-17) : produits pas encore dans le panier et pas trop proches d'un produit déjà choisi, tant qu'il y en a
      // Plus aucun produit « nouveau » qui rentre : un seul chien → on s'arrête là (la finition / la commande site complètent) ; plusieurs chiens → un 2e exemplaire reste possible
      { const fresh = eligible.filter(c => !usedProducts.has(c.pId) && this._isFresh(c, basket)); if (fresh.length) eligible = fresh; else if (!(mult > 1 || nd)) break; }
      // Dates dépassées ou courtes D'ABORD (Antho 2026-11-17) : tant qu'un produit urgent convient et rentre dans le budget, on ne choisit que parmi eux (sauf priorité « rentabilité »)
      // (un produit urgent déjà dans le panier ne force pas un 2e exemplaire : il repasse par la note normale, pour garder de la variété)
      // (commande site : pas de passage forcé, les dates courtes comptent autant que le coefficient dans la note — seules les dates DÉPASSÉES passent d'office)
      // Écouler : toutes les dates ≤ 30 j passent d'office, quel que soit le type ; Équilibré + commande site : seulement les dates dépassées ; Rentable : rien d'office
      if (this.priority !== 'coeff') { const urg = eligible.filter(c => (this.kind === 'site' && this.priority !== 'dluo' ? c.daysLeft < 0 : c.daysLeft <= this.URGENT_DAYS) && !usedProducts.has(c.pId)); if (urg.length) eligible = urg; }
      const gramN = basket.filter(b => { const sp = Store.state.stockM.find(x => x.id === b.pId), sv = sp && sp.variants.find(x => x.id === b.vId); return sv && sv.mode === 'gram'; }).length;
      this._bal = { gram: gramN, vrac: basket.length - gramN, hard: hardInBasket };
      // Alternance gramme / vrac : on prend le format le moins représenté tant qu'il en reste dans le budget
      { const vracN = basket.length - gramN, want = gramN > vracN ? 'vrac' : gramN < vracN ? 'gram' : '', f = want ? eligible.filter(c => (c.mode === 'gram') === (want === 'gram')) : []; if (f.length) eligible = f; }

      eligible.sort((a, b) => score(b) - score(a));
      let pick = eligible[0];
      // Même produit et même taille déjà dans le panier : on reste sur SA ligne (même lot) tant qu'il en reste — jamais deux lignes pour le même produit
      { const same = basket.find(b => b.pId === pick.pId && b.vId === pick.vId && b.lotId !== pick.lotId), sc = same && cands.find(c => c.pId === same.pId && c.vId === same.vId && c.lotId === same.lotId && c.avail > 0); if (sc) pick = sc; }

      const existing = basket.find(b => b.pId === pick.pId && b.vId === pick.vId && b.lotId === pick.lotId);
      if (existing) {
        existing.qty++;
      } else {
        basket.push({
          pId: pick.pId, vId: pick.vId, lotId: pick.lotId,
          name: pick.name, meat: pick.meat, variant: pick.variant,
          price: pick.price, qty: 1, dluo: pick.dluo, daysLeft: pick.daysLeft,
          coeff: pick.coeff, lotNumber: pick.lotNumber, locked: false, gen: true, family: pick.family, dog: this._dogTag(pick), ...this._simOf(pick)
        });
      }
      if (pick.forDogs && pick.forDogs.length === 1) spentBy[pick.forDogs[0]] = (spentBy[pick.forDogs[0]] || 0) + pick.price;

      spent += pick.price;
      pick.avail--;
      usedProducts.add(pick.pId);
      usedMeats[pick.meat] = (usedMeats[pick.meat] || 0) + 1;
    }

    this._bal = null;
    spent += this._packUp(basket, cands);   // 2 × la même taille → son « lot de 2 » s'il existe

    /* FINITION AU PLUS PRÈS DU BUDGET (Antho 2026-11-17). La boucle ci-dessus s'arrête quand plus rien ne rentre : il peut rester quelques euros.
       On tente alors, tant qu'il reste de la marge : (1) d'ajouter un produit qui rentre ; (2) sinon de remplacer UNE unité d'un produit non verrouillé
       par un produit un peu plus cher qui convient (mêmes règles : quantité max, famille, un seul produit dur), en prenant l'échange qui laisse le moins de reste.
       Jamais un produit à date dépassée / courte remplacé par un produit à date longue. Pas en « chien par chien » (budget partagé entre les chiens). */
    if (!nd) {
      const hard = t => this.HARD.includes((t || {}).resistance);
      const tagsOf = b => { const sp = Store.state.stockM.find(x => x.id === b.pId), sv = sp && sp.variants.find(x => x.id === b.vId); return sp ? this._mergeTags(Stock.effTags(sp), sv ? Stock.variantTags(sp, sv) : null) : {}; };
      const canAdd = (c, bk) => {
        if (c.avail <= 0 || frozenP.has(c.pId)) return false;
        const inBk = bk.reduce((a, b) => a + (b.pId === c.pId ? b.qty : 0), 0);
        if (inBk >= this.maxPerProduct * mult || inBk >= this._capOf(c.pId)) return false;
        if (c.mode === 'gram' && mult > 1 && bk.some(b => b.pId === c.pId)) return false;
        if (this._famTaken(c, bk)) return false;
        if (hard(c.tags) && !(c.chews && c.chews.includes('gros')) && bk.some(b => hard(tagsOf(b)))) return false;
        if (c.tags.resistance === 'longue' && bk.some(b => tagsOf(b).resistance === 'longue')) return false;   // une seule mastication longue par panier
        return true;
      };
      const put = c => {
        const ex = basket.find(x => x.pId === c.pId && x.vId === c.vId && x.lotId === c.lotId);
        if (ex) ex.qty++;
        else basket.push({ pId: c.pId, vId: c.vId, lotId: c.lotId, name: c.name, meat: c.meat, variant: c.variant, price: c.price, qty: 1, dluo: c.dluo, daysLeft: c.daysLeft, coeff: c.coeff, lotNumber: c.lotNumber, locked: false, gen: true, family: c.family, dog: this._dogTag(c), ...this._simOf(c) });
        c.avail--; usedProducts.add(c.pId); usedMeats[c.meat] = (usedMeats[c.meat] || 0) + 1;
      };
      for (let k = 0; k < 40; k++) {
        const gap = maxAvailable - spent;
        if (gap < 0.05) break;
        // La variété passe avant le budget au centime près : la finition n'ajoute jamais un 2e exemplaire ni un produit trop proche (Antho 2026-11-17)
        const adds = cands.filter(c => c.price <= gap + 0.005 && canAdd(c, basket) && this._isFresh(c, basket)).sort((a, b) => score(b) - score(a));
        if (adds.length) { put(adds[0]); spent += adds[0].price; continue; }
        let best = null;
        basket.forEach((b, bi) => {
          if (b.locked) return;
          const rest = basket.map((x, i) => i === bi ? { ...x, qty: x.qty - 1 } : x).filter(x => x.qty > 0);
          const bUrgent = (b.daysLeft === undefined || b.daysLeft === null ? 9999 : b.daysLeft) <= this.URGENT_DAYS;
          cands.forEach(c => {
            const delta = c.price - b.price;
            if (delta < 0.005 || delta > gap + 0.005) return;
            if (c.pId === b.pId && c.vId === b.vId) return;
            if (bUrgent && c.daysLeft > this.URGENT_DAYS) return;
            if (!canAdd(c, rest) || !this._isFresh(c, rest)) return;
            const sc = score(c);
            if (!best || delta > best.delta + 0.005 || (Math.abs(delta - best.delta) <= 0.005 && sc > best.sc)) best = { bi, c, delta, sc };
          });
        });
        if (!best) break;
        const b = basket[best.bi], old = cands.find(x => x.pId === b.pId && x.vId === b.vId && x.lotId === b.lotId);
        if (old) old.avail++;
        b.qty--; if (b.qty <= 0) basket.splice(best.bi, 1);
        put(best.c); spent += best.delta;
      }
      /* COMMANDE SITE (Antho 2026-11-17) : la commande est DÉJÀ PAYÉE, impossible de rembourser → le panier ne doit JAMAIS être sous le montant.
         S'il manque quelque chose : on ajoute un produit, ou on remplace une unité par un produit plus cher, en prenant ce qui dépasse le MOINS.
         (Même ordre de préférence : variété, puis note ; jamais un produit urgent remplacé par un produit à date longue.) */
      for (let k = 0; k < 60 && this.kind === 'site' && maxAvailable - spent > 0.005; k++) {
        const gap = maxAvailable - spent;
        // Deux recherches : (1) en gardant la variété, (2) sans cette contrainte (2e exemplaire possible, sur la même ligne).
        // On garde la variété SAUF si elle coûte plus de 0,50 € de dépassement de plus (Antho 2026-11-18 : 38,30 € → 49,30 € pour 40 € payés, avec un fromage à 11 €).
        const bests = {};
        for (const strict of [true, false]) {
        let best = null;
        const consider = (o) => { if (!best || o.over < best.over - 0.005 || (Math.abs(o.over - best.over) <= 0.005 && o.sc > best.sc)) best = o; };
        cands.forEach(c => { if (c.price + 0.005 >= gap && canAdd(c, basket) && (!strict || this._isFresh(c, basket))) consider({ c, over: c.price - gap, sc: score(c) }); });
        basket.forEach((b, bi) => {
          if (b.locked) return;
          const rest = basket.map((x, i) => i === bi ? { ...x, qty: x.qty - 1 } : x).filter(x => x.qty > 0);
          const bUrgent = (b.daysLeft === undefined || b.daysLeft === null ? 9999 : b.daysLeft) <= this.URGENT_DAYS;
          cands.forEach(c => {
            const delta = c.price - b.price;
            if (delta + 0.005 < gap || (c.pId === b.pId && c.vId === b.vId)) return;
            if (bUrgent && c.daysLeft > this.URGENT_DAYS) return;
            if (!canAdd(c, rest) || (strict && !this._isFresh(c, rest))) return;
            consider({ c, bi, over: delta - gap, sc: score(c) });
          });
        });
        bests[strict] = best;
        }
        const best = bests.true && (!bests.false || bests.true.over <= bests.false.over + 0.505) ? bests.true : bests.false;
        if (best) {
          if (best.bi !== undefined) {
            const b = basket[best.bi], old = cands.find(x => x.pId === b.pId && x.vId === b.vId && x.lotId === b.lotId);
            if (old) old.avail++;
            spent -= b.price; b.qty--; if (b.qty <= 0) basket.splice(best.bi, 1);
          }
          put(best.c); spent += best.c.price;
          spent += this._packUp(basket, cands);   // un 2e exemplaire devient le lot de 2 s'il existe…
          if (maxAvailable - spent > 0.005) continue;   // … qui est moins cher : on recomplète
          break;   // montant atteint (au plus juste)
        }
        // Aucun produit seul ne suffit à atteindre le montant : on en ajoute un (le mieux noté, variété d'abord) et on recommence
        const more = cands.filter(c => c.avail > 0 && canAdd(c, basket)).sort((a, b) => (this._isFresh(b, basket) ? 1 : 0) - (this._isFresh(a, basket) ? 1 : 0) || score(b) - score(a));
        if (!more.length) break;   // plus rien en stock qui convienne : on ne peut pas faire mieux
        put(more[0]); spent += more[0].price;
      }
    }
    return basket;
  },
  OVER_PCT: 10,   // la proposition « un peu au-dessus » peut dépasser le budget de 10 % au plus (Antho 2026-11-17 ; avant : 1 €)

  /* Générer avec des produits déjà dans le panier (Antho 2026-10-17) : on DEMANDE — les garder (ils deviennent la base verrouillée 🔒, le panier est complété autour)
     ou tout supprimer et repartir de zéro. Sans produit dans le panier, on génère directement. */
  /* « Générer le panier » = aussi l'ancien « Recomposer le reste » (Antho 2026-11-17 : « c'est le même bouton ») :
     les lignes verrouillées 🔒 restent, tout le reste est recomposé. S'il y a des 🔒, on demande si on les garde.
     (Garder TOUT le panier et seulement ajouter = bouton « Compléter le panier ».) */
  generate() {
    if (this.basket.some(b => b.locked)) { this._askGenerate(); return; }
    this._generateNow();
  },
  _askGenerate() {
    const lk = this.basket.filter(b => b.locked).length;
    U.modal({
      title: '🧺 Produits verrouillés dans le panier', hideOk: true,
      body: `<p style="margin-top:0;">Le panier contient <b>${lk} ligne${lk > 1 ? 's' : ''} verrouillée${lk > 1 ? 's' : ''} 🔒</b>. Que veux-tu en faire ?</p>
        <div class="frow" style="gap:10px;flex-wrap:wrap;align-items:center;">
          <button class="btn-cta fit" onclick="Paniers._genGo(true)">🔒 Les garder et refaire le reste</button>
          <button class="btn-ghost fit" onclick="Paniers._genGo(false)">🔄 Tout refaire</button>
        </div>
        <p class="muted help" style="margin-bottom:0;">« Garder » : les lignes 🔒 restent, tout le reste du panier est recomposé. « Tout refaire » : un panier entièrement nouveau. « Fermer » ne change rien.</p>`
    });
  },
  _genGo(keep) {
    U.closeModal();
    if (!keep) this.basket.forEach(b => { b.locked = false; });   // pas vidé : si la génération échoue, le panier actuel reste
    this._generateNow();
  },
  _generateNow() {
    const available = this._avail();
    if (available <= 0) { U.toast('Le budget disponible (après livraison) est nul ou négatif.', true); return; }
    if (!this.candidates().length) { U.toast('Aucun produit ne correspond aux filtres.', true); return; }

    // Les produits ajoutés à la main (locked:true via pickManual) — et tout item verrouillé —
    // servent de BASE : la génération complète le panier autour d'eux au lieu de les écraser
    // (demande d'Antho : un produit ajouté avant de générer doit rester la base du panier).
    const locked = this.basket.filter(b => b.locked).map(b => ({ ...b }));
    const b1 = this._compose(available, locked);
    const b2 = this.kind === 'vente' ? this._compose(available * (1 + this.OVER_PCT / 100), locked) : b1;   // commande site / lot : jamais au-dessus du budget
    const t1 = b1.reduce((a, b) => a + b.price * b.qty, 0);
    const t2 = b2.reduce((a, b) => a + b.price * b.qty, 0);

    const n1 = b1.reduce((a, b) => a + b.qty, 0);
    const n2 = b2.reduce((a, b) => a + b.qty, 0);

    if (!n1 && !n2) {
      this.proposals = null;   // le panier actuel est GARDÉ (avant, un échec de génération le vidait et faisait « disparaître » les produits ajoutés à la main)
      this.render();
      U.toast('Impossible de composer un panier avec ces contraintes : le panier actuel est conservé.', true);
    } else if (n1 > 0 && t2 > t1 + 0.005) {
      this.proposals = [b1, b2];
      this.basket = [];
      this.render();
      U.toast('2 propositions générées — choisis celle qui convient');
    } else {
      this.proposals = null;
      this.basket = n1 > 0 ? b1 : b2;
      this.render();
      const n = this.basket.reduce((a, b) => a + b.qty, 0);
      U.toast(`Panier généré : ${n} article(s)`);
    }
  },
  /* « Compléter le panier » (Antho 2026-11-17) : garde TOUS les produits déjà dans le panier tels quels et ajoute de quoi arriver au budget
     (mêmes règles que la génération). Une seule proposition, jamais au-dessus du budget. */
  complete() {
    const available = this._avail();
    const spent = this.basket.reduce((a, b) => a + b.price * b.qty, 0);
    if (available - spent < 0.05) { U.toast('Le panier est déjà au budget.', true); return; }
    const was = this.basket.map(b => !!b.locked);
    const base = this.basket.map(b => ({ ...b, locked: true, _frozen: !!b.locked }));   // cadenas d'Antho = quantité figée
    const out = this._compose(available, base);
    out.forEach((b, i) => { if (i < was.length) b.locked = was[i]; delete b._frozen; });   // les produits d'avant gardent leur verrou d'origine
    const added = out.reduce((a, b) => a + b.qty, 0) - this.basket.reduce((a, b) => a + b.qty, 0);
    if (added <= 0) { U.toast(`Aucun produit ne rentre dans le reste (${U.eur((available - spent) * (1 - this._disc()))}) avec ces réglages.`, true); return; }
    this.basket = out; this.proposals = null;
    this.render();
    U.toast(`Panier complété : ${added} article${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}.`);
  },
  /* ---------- Actions manuelles sur le panier ---------- */
  /* Produits RETIRÉS (🗑, quantité à 0) ou REMPLACÉS (🔄) par Antho (2026-11-18) : jamais reproposés par « Générer », « Compléter » ni « Remplacer »
     tant qu'on travaille sur ce panier (oublié à « Vider » / nouveau panier ; l'ajouter à la main le réautorise). « Exclure » (⊘) reste la liste durable. */
  _dropped: [],
  /* Ligne « Écartés de ce panier » (Antho 2026-11-19) : ce que Générer / Compléter / Remplacer s'interdisent pour ce panier, avec « rétablir ». */
  _ecartesHTML() {
    const nm = id => (Store.state.stockM.find(p => p.id === id) || {}).name || '';
    const items = (this._dropped || []).filter(nm).map(id => ({ id, l: U.esc(nm(id)), js: `Paniers.undrop('${id}')` }))
      .concat(Object.keys(this._qtyCap || {}).filter(nm).map(id => ({ id, l: `${U.esc(nm(id))} <span class="muted">(${this._qtyCap[id]} max)</span>`, js: `Paniers.uncap('${id}')` })));
    if (!items.length) return '';
    return `<div class="pan-ecartes"><span class="muted">Écartés de ce panier <span class="help">Produits écartés (🚫) et quantités baissées à la main : « Générer », « Compléter » et « Remplacer » ne les reprennent pas. « Rétablir » les autorise de nouveau. Tout est oublié à « Vider ».</span> :</span>
      ${items.map(it => `<span class="pan-ecarte">${it.l} <button type="button" class="btn-ghost btn-sm fit" onclick="${it.js}">Rétablir</button></span>`).join('')}</div>`;
  },
  undrop(id) { const tw = Stock.twinIdOf(id); this._dropped = (this._dropped || []).filter(x => x !== id && x !== tw); this._draft(); this.render(); },
  uncap(id) { delete this._qtyCap[id]; this._draft(); this.render(); },
  /* « Reste » en couleur (Antho 2026-11-18) : vert = c'est bon, rouge = à corriger. Vente / lot : rouge si on DÉPASSE le budget.
     Commande site (déjà payée) : rouge s'il MANQUE quelque chose (le client a payé plus que le panier), vert dès que le montant est atteint. */
  /* Case « Reste » (Antho 2026-11-19 : « -0,10 € Reste, ce n'est pas ce qui reste, c'est ce que j'ai dépassé ») : au-dessus du budget elle devient
     « Dépassement » avec un montant positif (+0,10 €). La couleur garde son sens : vert = bon, rouge = à corriger. */
  /* DATES COURTES (Antho 2026-11-19 : « beaucoup de dates courtes en stock, une seule dans le panier ») : combien sont en stock, combien sont dans le panier,
     et pour chacune des autres la RAISON (filtre, fiche du chien, variété, budget…) avec « Ajouter ». Une ligne par produit + taille, son lot le plus court. */
  _shortOpen: false,
  _shortDates() {
    const diag = {}, cands = this.candidates(diag), rows = [];
    const inB = new Set(this.basket.map(b => b.pId + '|' + b.vId));
    const spent = this.basket.reduce((a, b) => a + b.price * b.qty, 0), left = this._avail() - spent;
    Store.state.stockM.forEach(p => (p.variants || []).forEach(v => {
      if (v.mode === 'vrac') return;
      const lots = (v.lots || []).filter(l => U.num(l.qtyGeneral) + U.num(l.qtyEvent) > 0 && l.dluo).map(l => ({ l, d: U.daysTo(l.dluo) })).filter(x => x.d !== null && x.d <= this.URGENT_DAYS).sort((a, b) => a.d - b.d);
      if (!lots.length) return;
      const k = p.id + '|' + v.id, c = cands.find(x => x.pId === p.id && x.vId === v.id && x.lotId === lots[0].l.id) || cands.find(x => x.pId === p.id && x.vId === v.id);
      let reason = '';
      if (inB.has(k)) reason = '';
      else if (diag[k] || diag[p.id]) reason = diag[k] || diag[p.id];
      else if (!c) reason = 'pas proposé';
      else if (this.basket.some(b => b.pId === p.id)) reason = 'déjà dans le panier (autre format)';
      else if (this._famTaken(c, this.basket)) reason = 'sa version avec / sans poils ou un autre format est déjà là';
      else if (this._tooClose(c, this.basket)) { const o = this.basket.find(b => b.pId !== c.pId && (s => s.cut === this._simOf(c).cut)(this._simOf(b))); reason = 'trop proche de « ' + (o ? o.name : '?') + ' »'; }
      else if (this.HARD.includes(c.tags.resistance) && this.basket.some(b => this.HARD.includes(this._resOf(b)))) reason = 'déjà un produit dur dans le panier';
      else if (c.price > left + 0.005) reason = 'ne rentre pas dans le budget restant';
      else reason = 'moins bien noté que les produits choisis';
      rows.push({ p, v, lot: lots[0].l, d: lots[0].d, inBasket: inB.has(k), reason, canAdd: true });   // Antho 2026-11-19 : « Ajouter » sur TOUTES les dates courtes, même hors réglages (c'est lui qui juge)
    }));
    return rows.sort((a, b) => a.d - b.d);
  },
  _shortHTML() {
    if (Clients.ro() && !this.basket.length) return '';
    const rows = this._shortDates(); if (!rows.length) return '';
    const inN = rows.filter(r => r.inBasket).length, out = rows.filter(r => !r.inBasket);
    const dl = d => d < 0 ? `<span class="badge bad">dépassée (${-d} j)</span>` : `<span class="badge warn">${d} j</span>`;
    return `<div class="pan-short">
      <div class="pan-short-h"><b>⏳ Dates courtes :</b> ${rows.length} en stock · <b>${inN}</b> dans ce panier
        ${out.length ? `<button type="button" class="btn-ghost btn-sm fit" onclick="Paniers._shortOpen=!Paniers._shortOpen;Paniers.render()">${this._shortOpen ? 'Masquer' : 'Voir les ' + out.length + ' non retenues'}</button>` : ''}
        <span class="muted help">30 jours ou moins, ou date dépassée. Pour chacune : pourquoi elle n'est pas dans le panier. « Ajouter » la met quand même, même si elle ne correspond pas aux réglages (et elle reste, même en régénérant). Objectif « Écouler » : elles passent toutes en premier.</span></div>
      ${this._shortOpen && out.length ? `<div class="pan-short-list">${out.map(r => `<div class="pan-short-row"><span class="pan-short-n">${U.esc(r.p.name)} <span class="tag">${U.esc(Pricing.labelVariant(r.v))}</span></span>${dl(r.d)}<span class="muted pan-short-r">${U.esc(r.reason)}</span>${r.canAdd && !Clients.ro() ? `<button type="button" class="btn-ghost btn-sm fit" onclick="Paniers.pickManual('${r.p.id}','${r.v.id}','${r.lot.id}','M')">Ajouter</button>` : '<span></span>'}</div>`).join('')}</div>` : ''}
    </div>`;
  },
  _resteKPI(remaining) {
    const v = remaining * (1 - this._disc()), over = v < -0.005;
    return `<div class="kpi ${this._resteCls(remaining)}"><span class="kpi-val">${over ? '+' + U.eur(-v) : U.eur(v)}</span><span class="kpi-label">${over ? 'Dépassement' : (this.kind === 'site' && v > 0.005 ? 'Manque' : 'Reste')}</span></div>`;
  },
  _resteCls(remaining) {
    const bad = this.kind === 'site' ? remaining > 0.005 : remaining < -0.005;
    return this.basket.length ? (bad ? 'pan-kpi-bad' : 'pan-kpi-ok') : '';
  },
  /* Quantité BAISSÉE à la main (« − » ou saisie) : c'est le maximum voulu pour ce produit dans ce panier (Antho 2026-11-18 : « je retire le 2e merlan,
     tu le remets à chaque Compléter »). Générer / Compléter / Remplacer ne le dépassent plus ; l'augmenter à la main lève la limite. Oublié à « Vider ». */
  _qtyCap: {},
  _capOf(pId) { const v = this._qtyCap[pId]; return v === undefined ? Infinity : v; },
  _setCap(item, before) {
    if (!item || (item.kind || 'M') !== 'M') return;
    const tot = this.basket.reduce((a, b) => a + (b.pId === item.pId ? U.num(b.qty) : 0), 0);
    if (tot < before) this._qtyCap[item.pId] = tot; else if (tot > before) delete this._qtyCap[item.pId];
  },
  _dropLearn(it) { if (it && (it.kind || 'M') === 'M' && it.gen) this._learn(it.pId, 'r'); },   // une PROPOSITION retirée : le générateur s'en souvient
  _drop(pId) {
    [pId, Stock.twinIdOf(pId)].forEach(id => { if (id && !this._dropped.includes(id)) this._dropped.push(id); });   // sa version avec / sans poils part aussi (Antho 2026-11-18)
  },
  /* Corbeille = simple retrait de la LIGNE (Antho 2026-11-19 : « je veux juste le retirer pour mettre autre chose, tu peux me le reproposer ») :
     ni « Écartés de ce panier », ni apprentissage. Pour ne plus le voir proposé : 🚫. */
  removeItem(idx) {
    this.basket.splice(idx, 1);
    this.render();
  },
  /* Remplaçant possible pour la ligne idx : pas déjà dans le panier, pas trop proche d'un autre produit (même morceau, même dureté), sauf s'il n'y a rien d'autre */
  _varietyPick(eligible, idx) {
    const others = this.basket.filter((b, i) => i !== idx);
    const notDup = eligible.filter(c => !others.some(b => b.pId === c.pId));
    const fresh = notDup.filter(c => !this._tooClose(c, others));
    return fresh.length ? fresh : notDup;
  },
  changeQty(idx, delta) {
    const item = this.basket[idx];
    if (!item) return;
    const totBefore = this.basket.reduce((a, b) => a + (b.pId === item.pId ? U.num(b.qty) : 0), 0);
    item.qty = Math.max(0, item.qty + delta);
    if (item.qty > 0) this._setCap(item, totBefore);
    if (item.qty <= 0) this.basket.splice(idx, 1);   // arrivé à 0 = comme la corbeille (simple retrait)
    this.render();
    if (delta > 0) this._stockWarn(item.pId, item.vId);
  },
  setQty(idx, v) {   // quantité tapée à la main (nombre entier ; 0 ou vide = retirer la ligne, comme le « − » arrivé à 0)
    const item = this.basket[idx]; if (!item) return;
    const n = Math.max(0, Math.round(U.num(v)));
    const up = n > item.qty, totBefore = this.basket.reduce((a, b) => a + (b.pId === item.pId ? U.num(b.qty) : 0), 0);
    item.qty = n;
    if (n > 0) this._setCap(item, totBefore);
    if (n <= 0) this.basket.splice(idx, 1);   // 0 = comme la corbeille (simple retrait)
    this.render();
    if (up) this._stockWarn(item.pId, item.vId);
  },
  setItemPrice(idx, v) {   // prix TTC modifié à la main pour CE panier seulement (le stock n'est pas touché)
    const item = this.basket[idx]; if (!item) return;
    item.price = Math.max(0, Math.round(U.num(v) * 100) / 100);
    this.render();
  },
  toggleLock(idx) {
    const item = this.basket[idx];
    if (item) item.locked = !item.locked;
    this.render();
  },
  excludeItem(idx) {
    const item = this.basket[idx];
    if (!item) return;
    const oldName = item.name;
    this._dropLearn(item);
    this._drop(item.pId);   // Antho 2026-11-19 : écarté de CE panier seulement (avec sa version avec / sans poils) → « Écartés de ce panier », « Rétablir »

    const otherTotal = this.basket.reduce((a, b, i) => i === idx ? a : a + b.price * b.qty, 0);
    const maxPrice = this._avail() - otherTotal;
    const cands = this.candidates();

    this.basket.forEach((b, i) => {
      if (i === idx) return;
      const c = cands.find(x => x.pId === b.pId && x.vId === b.vId && x.lotId === b.lotId);
      if (c) c.avail = Math.max(0, c.avail - b.qty);
    });

    let eligible = cands.filter(c => c.price <= maxPrice && c.avail > 0 && !this._famTaken(c, this.basket, idx));
    eligible = this._varietyPick(eligible, idx);
    const otherHard = this.basket.some((b, j) => {
      if (j === idx) return false;
      const sp = Store.state.stockM.find(x => x.id === b.pId);
      if (!sp) return false;
      const sv = sp.variants.find(x => x.id === b.vId);
      const mt = this._mergeTags(Stock.effTags(sp), sv ? Stock.variantTags(sp, sv) : null);
      return this.HARD.includes(mt.resistance);
    });
    if (otherHard) eligible = eligible.filter(c => !this.HARD.includes(c.tags.resistance));

    if (!eligible.length) {
      this.basket.splice(idx, 1);
      this.render();
      U.toast(`${oldName} exclu — aucun remplacement trouvé`);
      return;
    }

    const maxCoeff = Math.max(...cands.map(c => c.coeff), 1);
    const weights = this._weights();
    const mult = Math.max(1, this.nbChiens);
    const usedProducts = new Set();
    const usedMeats = {};
    this.basket.forEach((b, i) => {
      if (i === idx) return;
      usedProducts.add(b.pId);
      usedMeats[b.meat] = (usedMeats[b.meat] || 0) + b.qty;
    });

    eligible.sort((a, b) => {
      const rest = this.basket.filter((x, i) => i !== idx);
      const sa = this._itemScore(a, usedProducts, usedMeats, maxCoeff, weights, mult) * this._coeffMult(a, rest);
      const sb = this._itemScore(b, usedProducts, usedMeats, maxCoeff, weights, mult) * this._coeffMult(b, rest);
      return sb - sa;
    });

    const pick = eligible[0];
    this.basket[idx] = {
      pId: pick.pId, vId: pick.vId, lotId: pick.lotId,
      name: pick.name, meat: pick.meat, variant: pick.variant,
      price: pick.price, qty: 1, dluo: pick.dluo, daysLeft: pick.daysLeft,
      coeff: pick.coeff, lotNumber: pick.lotNumber, locked: false, gen: true, family: pick.family, dog: this._dogTag(pick)
    };
    this.render();
    U.toast(`${oldName} exclu → ${pick.name}`);
  },
  /* « Remplacer » (🔄, Antho 2026-11-18) : le produit part, et son budget (+ le reste éventuel) est recomposé — UN OU PLUSIEURS produits,
     mêmes règles que la génération (variété, dates, dureté…), en évitant le même type de produit. Le produit remplacé N'EST PAS écarté (Antho 2026-11-19) : « Compléter » peut le reprendre.
     Les autres lignes ne bougent pas. Rien qui convienne → le panier reste tel quel. */
  swapItem(idx) {
    const item = this.basket[idx];
    if (!item) return;
    const before = this.basket.map(b => ({ ...b }));
    const others = this.basket.filter((b, i) => i !== idx);
    const was = others.map(b => !!b.locked);
    const keepDropped = this._dropped.slice();
    this._drop(item.pId);   // mis de côté le temps de chercher le remplaçant seulement (Antho 2026-11-19 : remplacer ≠ écarter)
    this._avoidLike = [item];
    let out;
    try { out = this._compose(this._avail(), others.map(b => ({ ...b, locked: true }))); } finally { this._avoidLike = null; this._dropped = keepDropped; }
    const fresh = out.slice(others.length);   // lignes nouvelles (les autres lignes gardent leur place)
    if (!fresh.length) {
      this.basket = before; this.render();
      U.toast('Aucun remplacement trouvé avec ces réglages : le produit reste.', true);
      return;
    }
    out.slice(0, others.length).forEach((b, i) => { b.locked = was[i]; });
    this.basket = out.slice(0, idx).concat(fresh, out.slice(idx, others.length));
    this.proposals = null;
    this.render();
    U.toast(`${item.name} → ${fresh.map(b => b.name + (b.qty > 1 ? ' ×' + b.qty : '')).join(' + ')}`);
  },
  /* Fenêtre « client » : produit, variante, prix TTC seulement (pas de coeff, DLUO, viande…) — pour capture d'écran ou copie du texte */
  _shareData() {
    const dn = this._dogChoices();
    const lines = this.basket.map(b => ({ name: b.name, variant: b.variant, qty: b.qty, total: b.price * b.qty, unit: b.price, dog: (b.dog && dn.length >= 2) ? b.dog : '', det: this._optLinesOf(b) }));
    const sub = lines.reduce((a, l) => a + l.total, 0);
    const ship = this.livraison > 0 ? this.livraison : 0;
    const red = this._disc() > 0 ? Math.round(sub * this._disc() * 100) / 100 : 0;
    const pre = sub - red + ship, bal = Clients.balanceOf(this._shClient || this.client);
    const av = this._balOn !== false && bal > 0 ? Math.round(Math.min(bal, Math.max(0, pre)) * 100) / 100 : 0;   // avoir déduit
    const det = this._balOn !== false && bal < 0 ? -bal : 0;   // dette à régler
    // n° de devis : prévu tant que rien n'est sorti ; lettre suivante si le contenu a changé depuis la dernière sortie (voir devis.js)
    const h = Devis.hash({ l: lines.map(l => [l.name, l.variant, l.qty, l.unit, l.dog].concat(l.det.length ? [l.det.join('|')] : [])), r: red, s: ship, a: av, t: det, m: this._shMode || '', ...(red > 0 && this.reductionCode ? { rc: this.reductionCode } : {}) });
    if (!this._dv) this._dv = Devis.blank();
    return { lines, sub, red, redPct: this.reduction, redCode: red > 0 ? String(this.reductionCode || '').trim() : '', ship, av, det, bal, total: pre - av + det, no: Devis.show(this._dv, h), h, x: this._shareExtras() };
  },
  /* Blocs facultatifs sous le total (réglés dans Paramètres → Paniers & livraison) : n'apparaissent que s'ils sont remplis */
  _payList() {
    const S = Store.state.settings, l = [];
    if (S.payCash) l.push('espèces');
    if (S.payVirement) l.push('virement');
    String(S.payOther || '').split(',').map(t => t.trim()).filter(Boolean).forEach(t => l.push(t.toLowerCase()));
    return l;
  },
  _shOpt: { pay: true, iban: true, who: true },
  _shMsg: null,
  _shClient: '', _shLabel: '', _shNote: '', _shValid: '', _shMode: '', _pendId: null, _pendUpd: 0, _balOn: true,   // _shMode : '' | 'cc' (Click & Collect) | 'liv' (livraison)
  _dogsOf(name) {   // chiens référencés de la cliente (nom + race) — jamais en mode visite
    const c = Clients.find(name);
    return (c && !Clients.ro() ? (c.dogs || []) : []).filter(d => String(d.name || '').trim());
  },
  _whoLine() {
    const n = String(this._shClient || '').trim();
    if (!n) return '';
    const dogs = this._dogsOf(n).map(d => String(d.name).trim());
    const list = dogs.length > 1 ? dogs.slice(0, -1).join(', ') + ' et ' + dogs[dogs.length - 1] : (dogs[0] || '');
    return 'Panier de ' + Clients.show(n) + (list ? ' — pour ' + list : '');
  },
  _shareExtras() {
    const S = Store.state.settings, o = this._shOpt || {};
    const pl = this._payList();
    const pay = (o.pay !== false && pl.length) ? 'Moyens de paiement acceptés : ' + pl.join(', ') : '';
    const holder = String(S.payHolder || '').trim(), iban = String(S.payIban || '').trim(), bic = String(S.payBic || '').trim();
    const ibanLines = (o.iban !== false && iban) ? [].concat(['RIB :'], holder ? ['Titulaire : ' + holder] : [], ['IBAN : ' + iban], bic ? ['BIC : ' + bic] : []) : [];
    const msg = String(this._shMsg != null ? this._shMsg : (S.payMessage || '')).trim();
    const who = o.who !== false ? this._whoLine() : '';
    const valid = this._shValid ? 'Devis valable jusqu\'au ' + U.frDate(this._shValid) : '';
    const mode = this._shMode === 'cc' ? 'Mode de remise : Click & Collect (retrait)' : this._shMode === 'liv' ? 'Mode de remise : Livraison' : '';
    const refHint = ibanLines.length ? 'Merci d\'indiquer le n° de devis dans le libellé de votre virement.' : '';
    // TODO (assujettissement) : si Pricing.vatActive(), détailler le devis (HT + TVA par taux + total TTC) avec quoteVatBreakdown(lignes),
    // à écrire en même temps que celui de Revente pro (b2b.js `_qtExtras`) ; « Total » redevient « Total TTC ». Mention 293 B déjà masquée.
    return { pay, ibanLines, msg, who, valid, mode, refHint, vatMention: Pricing.vatMention() };
  },
  /* Sortie du devis (copie image / texte, mise en attente) : le numéro devient définitif, la lettre avance si le contenu a changé */
  _dvCommit() {
    if (!this._dv) this._dv = Devis.blank();
    const no = Devis.commit(this._dv, this._shareData().h);
    this._draft(); this._shareRefresh();
    return no;
  },
  _shareInner(d) {
    const rows = d.lines.map(l => `<tr><td style="padding:7px 10px;text-align:left;font-weight:700;">${U.esc(l.name)}${l.det.length ? `<div style="font-weight:500;font-size:.85rem;line-height:1.35;">${l.det.map(U.esc).join('<br>')}</div>` : ''}${l.dog ? `<div style="font-weight:600;font-size:.85rem;color:var(--caramel);">→ pour ${U.esc(l.dog)}</div>` : ''}</td><td style="padding:7px 10px;text-align:center;">${U.esc(l.variant || '')}</td><td style="padding:7px 10px;text-align:center;font-weight:700;">${U.qty(l.qty)}</td><td style="padding:7px 10px;text-align:right;white-space:nowrap;">${U.eur(l.unit)}</td><td style="padding:7px 10px;text-align:right;font-weight:700;white-space:nowrap;">${U.eur(l.total)}</td></tr>`).join('');
    const x = d.x;
    return `${d.no ? `<p style="margin:0 10px 6px;font-weight:800;">Devis n° ${U.esc(d.no)}</p>` : ''}${x.who ? `<p style="margin:0 10px 8px;font-weight:700;color:var(--caramel);">${U.esc(x.who)}</p>` : ''}<table style="width:100%;border-collapse:collapse;font-size:1rem;">
        <thead><tr style="border-bottom:2px solid var(--caramel);"><th style="padding:7px 10px;text-align:left;">Produit</th><th style="padding:7px 10px;text-align:center;">Variante</th><th style="padding:7px 10px;text-align:center;">Qté</th><th style="padding:7px 10px;text-align:right;">Prix unit.</th><th style="padding:7px 10px;text-align:right;">Sous-total</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          ${d.red > 0 ? `<tr style="border-top:1px solid var(--card-border);"><td colspan="4" style="padding:7px 10px;text-align:right;">${U.esc(this._redLabel(d))}</td><td style="padding:7px 10px;text-align:right;white-space:nowrap;">− ${U.eur(d.red)}</td></tr>` : ''}
          ${d.ship > 0 ? `<tr style="border-top:1px solid var(--card-border);"><td colspan="4" style="padding:7px 10px;text-align:right;">Livraison</td><td style="padding:7px 10px;text-align:right;white-space:nowrap;">${U.eur(d.ship)}</td></tr>` : ''}
          ${d.av > 0 ? `<tr style="border-top:1px solid var(--card-border);"><td colspan="4" style="padding:7px 10px;text-align:right;">Avoir déduit</td><td style="padding:7px 10px;text-align:right;white-space:nowrap;">− ${U.eur(d.av)}</td></tr>` : ''}
          ${d.det > 0 ? `<tr style="border-top:1px solid var(--card-border);"><td colspan="4" style="padding:7px 10px;text-align:right;">Solde à régler</td><td style="padding:7px 10px;text-align:right;white-space:nowrap;">+ ${U.eur(d.det)}</td></tr>` : ''}
          <tr style="border-top:2px solid var(--caramel);"><td colspan="4" style="padding:9px 10px;text-align:right;font-weight:800;font-size:1.1rem;">${x.vatMention ? 'Total' : 'Total TTC'}</td><td style="padding:9px 10px;text-align:right;font-weight:800;font-size:1.1rem;white-space:nowrap;">${U.eur(d.total)}</td></tr>
        </tfoot>
      </table>
      ${x.mode ? `<p style="margin:10px 10px 0;font-weight:700;">${U.esc(x.mode)}</p>` : ''}
      ${x.valid ? `<p style="margin:10px 10px 0;font-style:italic;">${U.esc(x.valid)}</p>` : ''}
      ${x.pay ? `<p style="margin:12px 10px 0;">${U.esc(x.pay)}</p>` : ''}
      ${x.ibanLines.length ? `<p style="margin:8px 10px 0;font-weight:700;">${x.ibanLines.map(U.esc).join('<br>')}</p>` : ''}
      ${x.refHint ? `<p style="margin:6px 10px 0;font-style:italic;">${U.esc(x.refHint)}</p>` : ''}
      ${x.msg ? `<p style="margin:10px 10px 0;white-space:pre-wrap;">${U.esc(x.msg)}</p>` : ''}
      ${x.vatMention ? `<p style="margin:10px 10px 0;font-size:.85rem;color:var(--gris);">${U.esc(x.vatMention)}</p>` : ''}`;
  },
  /* L'aperçu de la fenêtre Partager prend les couleurs de l'image (jour / nuit) : ce que tu vois = ce que tu copies */
  _shareBoxStyle() { const p = U.imgPalette('quote'); return `padding:12px 8px;border-radius:10px;background:${p.bg};color:${p.fg};--caramel:${p.car};--gris:${p.muted};--card-border:${p.sep};`; },
  shareTheme(btn) {
    U.toggleImgTheme('quote', null, true);
    btn.innerHTML = U.imgThemeLabel('quote') + ' <span class="muted">· changer</span>';
    const box = document.getElementById('pan_share'); if (box) box.style.cssText = this._shareBoxStyle();
  },
  _shareRefresh() {
    const box = document.getElementById('pan_share');
    if (box) box.innerHTML = this._shareInner(this._shareData());
    document.querySelectorAll('.pan-bal').forEach(bb => { bb.innerHTML = this._balBox(); });
    const dvn = document.getElementById('pan_dvno'); if (dvn) dvn.textContent = 'Devis n° ' + this._shareData().no;
    const dg = document.getElementById('pan_dogs');
    if (dg) { const dogs = this._dogsOf(this._shClient); dg.textContent = dogs.length ? '🐕 ' + dogs.map(d => d.name + (d.breed ? ' (' + d.breed + ')' : '')).join(', ') : ''; }
  },
  _balBox() {   // solde / avoir de la cliente : déduit automatiquement, case pour le décocher
    const b = Clients.balanceOf(this._shClient || this.client);
    if (!b) return '';
    return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:12px;padding:8px 10px;border:1px solid var(--caramel);border-radius:8px;"><input type="checkbox" ${this._balOn !== false ? 'checked' : ''} onchange="Paniers._setBal(this.checked)"> 💶 ${b > 0 ? 'Déduire l\'avoir de ' + U.eur(b) + ' de cette commande' : 'Ajouter le solde dû de ' + U.eur(-b) + ' à cette commande'}</label>`;
  },
  _setBal(on) { this._balOn = !!on; this._shareRefresh(); this._draft(); },
  _modeBtns() {
    const b = (m, label) => ({ l: label, on: this._shMode === m, js: `Paniers._setMode('${m}')` });
    return U.seg([b('cc', '🏬 Click & Collect'), b('liv', '📦 Livraison')], { sm: true });
  },
  _setMode(m) {   // re-clic = on décoche ; Click & Collect = pas de frais de livraison, Livraison = frais habituels si aucun frais n'est saisi
    this._shMode = this._shMode === m ? '' : m;
    const S = Store.state.settings;
    if (this._shMode === 'cc') this.livraison = 0;
    else if (this._shMode === 'liv' && !this.livraison) this.livraison = U.num(S.shippingCost ?? 6.8);
    document.querySelectorAll('.pan-mode').forEach(bx => { bx.innerHTML = this._modeBtns(); });   // carte Configuration
    const li = document.getElementById('pan_livr'); if (li) li.value = this.livraison;
    this._updateKPI(); this._shareRefresh(); this._draft();
  },
  _shToggle(k, v) { this._shOpt = Object.assign({}, this._shOpt, { [k]: !!v }); this._shareRefresh(); },
  _shSetMsg(v) { this._shMsg = v; this._shareRefresh(); },
  _shSet(k, v) { this['_sh' + k] = v; this._shareRefresh(); },
  share() {
    if (!this.basket.length) return;
    const S = Store.state.settings;
    this._shOpt = { pay: true, iban: true, who: true }; this._shMsg = null;
    this._shClient = this._shClient || this.client || '';
    const hasPay = this._payList().length > 0, hasIban = !!String(S.payIban || '').trim();
    const chk = (k, label, on = true) => `<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" ${on ? 'checked' : ''} onchange="Paniers._shToggle('${k}',this.checked)"> ${label}</label>`;
    const fld = (label, inner) => `<div class="fg" style="margin:0;"><label>${label}</label>${inner}</div>`;
    const body = `<div style="display:flex;justify-content:flex-end;margin-bottom:6px;"><button class="btn-ghost btn-sm" onclick="Paniers.shareTheme(this)" title="Change les couleurs de l'aperçu ET de l'image copiée/enregistrée : jour = fond blanc, nuit = couleurs de l'appli">${U.imgThemeLabel('quote')} <span class="muted">· changer</span></button></div>
      <div id="pan_share" style="${this._shareBoxStyle()}">${this._shareInner(this._shareData())}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;justify-content:center;">
        <button class="btn-ghost btn-sm" onclick="Paniers.shareImage('copy')">🖼️ Copier l'image</button>
        <button class="btn-ghost btn-sm" onclick="Paniers.shareImage('save')">⬇ Enregistrer l'image</button>
      </div>
      <div style="margin-top:14px;padding-top:10px;border-top:1px dashed var(--card-border);">
        <div class="pan-bal">${this._balBox()}</div>
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">Afficher sur ce panier</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">${chk('who', 'Nom de la cliente et des chiens')}${hasPay ? chk('pay', 'Moyens de paiement') : ''}${hasIban ? chk('iban', 'IBAN') : ''}${!hasPay && !hasIban ? '<span class="muted" style="font-size:.85rem;">Moyens de paiement et IBAN : à renseigner dans Paramètres → Réglages financiers → Paniers & livraison.</span>' : ''}</div>
        <textarea class="note-area" rows="2" style="width:100%;" placeholder="Message pour ce client (vide = rien d'affiché)" oninput="Paniers._shSetMsg(this.value)">${U.esc(String(S.payMessage || ''))}</textarea>
      </div>
      <div style="margin-top:14px;padding-top:10px;border-top:1px dashed var(--card-border);">
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">⏳ Mettre en attente (en attendant l'accord de la cliente)</div>
        <div class="grid c2" style="gap:10px;">
          ${fld('Nom de la cliente', `<input type="text" data-clcombo autocomplete="off" value="${U.esc(this._shClient)}" placeholder="nom de la cliente ou du chien…" oninput="Paniers._shSet('Client',this.value)">`)}
          ${fld('Valable jusqu\'au (option)', `<input type="date" value="${U.esc(this._shValid)}" onchange="Paniers._shSet('Valid',this.value)">`)}
          ${fld('Intitulé (option)', `<input type="text" value="${U.esc(this._shLabel)}" placeholder="ex : version 2, sans le sprat…" oninput="Paniers._shLabel=this.value">`)}
          ${fld('Note interne (jamais affichée à la cliente)', `<input type="text" value="${U.esc(this._shNote)}" placeholder="ex : retrait samedi" oninput="Paniers._shNote=this.value">`)}
        </div>
        <div id="pan_dogs" class="muted" style="margin:6px 0 0;font-size:.85rem;"></div>
        <div style="margin-top:10px;text-align:center;"><button class="btn-cta btn-sm" onclick="Paniers.savePending()">💾 ${this._pendId ? 'Mettre à jour le panier en attente' : 'Mettre en attente'}</button></div>
      </div>`;
    U.modal({ title: '🧺 Votre panier Touffu', body, okLabel: '📋 Copier le texte', wide: true, onOk: () => { Paniers.copyShare(); return false; } });
    this._shareRefresh();
  },

  /* ---------- Paniers / devis en attente ---------- */
  _pending() { return Store.state.baskets || (Store.state.baskets = []); },
  /* Contenu du panier en cours tel qu'il est rangé dans « en attente » (dv = état du numéro de devis à lui donner) */
  _pendingData(dv, name, now) {
    return { dv: { ...dv }, name, label: String(this._shLabel || '').trim(), note: String(this._shNote || '').trim(), validUntil: this._shValid || '', mode: this._shMode || '', balOn: this._balOn !== false,
      items: JSON.parse(JSON.stringify(this.basket)), budget: this.budget, livraison: this.livraison, reduction: this.reduction, reductionCode: this.reductionCode || '', nbChiens: this.nbChiens, updated: now,
      dropped: (this._dropped || []).slice(), qtyCap: { ...(this._qtyCap || {}) } };   // écartés / plafonds : retrouvés à « Reprendre »
  },
  /* Range le panier en cours dans la liste « en attente » (le devis « sort » : numéro attribué, lettre suivante si le contenu a changé). Renvoie { rec, no } ou null. */
  _storePending() {
    const name = String(this._shClient || '').trim();
    if (!name) { U.toast('Indique le nom de la cliente pour mettre le panier en attente.', true); return null; }
    if (!this.basket.length) return null;
    const list = this._pending(), now = Date.now();
    let rec = this._pendId ? list.find(x => x.id === this._pendId) : null;
    const no = this._dvCommit();
    const data = this._pendingData(this._dv, name, now);
    const snap = rec ? Store.snapshot('baskets', rec) : null;   // annulation (2026-11-08) : le panier tel qu'il était avant cette mise en attente
    if (rec) { Object.assign(rec, data); delete rec.ready; }   // contenu modifié → la validation « prêt à traiter » est à refaire
    else { rec = Object.assign({ id: U.uid(), ts: now }, data); list.push(rec); }
    this._pendId = rec.id; this._pendUpd = rec.updated;
    const entry = Store.log('panier', `Panier en attente — ${name} (devis ${no})`, snap ? { type: 'restoreItem', data: snap } : { type: 'deleteCreated', data: { domain: 'baskets', id: rec.id } });
    Store.save('baskets', 'journal');
    return { rec, no, entry };
  },
  savePending() {
    const r = this._storePending(); if (!r) return;
    const no = r.no;
    U.closeModal();
    U.toast('Panier mis en attente — devis n° ' + no + ' (« Reprendre » pour le retrouver).', false, r.entry && r.entry.id);
    // Le panier est maintenant dans la liste « en attente » : l'espace de travail repart à vide (plus de panier en cours, plus de blocage au « Reprendre »)
    this.clearBasket();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  quickPending() {   // « Mettre en attente » depuis la barre du panier (sans ouvrir « Partager ») : le nom vient du champ Cliente
    this._shClient = String(this.client || this._shClient || '').trim();
    if (!this._shClient) { U.toast('Indique d\'abord le nom de la cliente (champ « Cliente » à gauche).', true); return; }
    this.savePending();
  },
  /* ✅ « Prêt à traiter » (Antho 2026-10-14) : le profil ÉQUIPE ne valide pas les ventes (c'est Antho qui fait les sorties de stock) ; quand un panier est d'accord, l'équipe le VALIDE :
     il reste dans « Paniers en attente » (partagé) avec rec.ready = { by, ts } ; Antho le voit « prêt à traiter » et fait « 🛒 Envoyer en vente » de son côté. Modifier le panier retire la validation. */
  _setReady(rec, on) {
    const me = (Store.session && Store.session.user && Store.session.user.email) || 'équipe';
    const snap = Store.snapshot('baskets', rec);
    if (on) rec.ready = { by: me, ts: Date.now() }; else delete rec.ready;
    const entry = Store.log('panier', `${on ? 'Panier validé — prêt à traiter' : 'Validation retirée'} — ${rec.name}`, { type: 'restoreItem', data: snap });
    Store.save('baskets', 'journal');
    return entry;
  },
  toggleReady(id) {
    const rec = this._pending().find(x => x.id === id); if (!rec) return;
    const entry = this._setReady(rec, !rec.ready); this.render();
    U.toast(rec.ready ? '✅ Panier validé : Antho le verra « prêt à traiter ».' : 'Validation retirée.', false, entry.id);
  },
  validateCurrent() {   // profil équipe : « Valider pour la vente » depuis le panier composé = mis en attente + prêt à traiter
    this._shClient = String(this.client || this._shClient || '').trim();
    if (!this._shClient) { U.toast('Indique d\'abord le nom de la cliente (champ « Cliente » à gauche).', true); return; }
    const r = this._storePending(); if (!r) return;
    this._setReady(r.rec, true);
    U.toast('✅ Panier validé — devis n° ' + r.no + '. Antho le verra « prêt à traiter » dans « Paniers en attente ».');
    this.clearBasket(); window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  _ageTxt(rec) {
    const d = Math.floor((Date.now() - (rec.updated || rec.ts)) / 86400000);
    return { d, txt: d <= 0 ? 'aujourd\'hui' : d === 1 ? 'depuis 1 jour' : `depuis ${d} jours` };
  },
  _pendingCard() {
    // les devis pro (kind:'pro') sont gérés par la page Revente pro. Un devis et ses variantes (-V1, -V2…) sont rangés ensemble : famille la plus récente d'abord, devis d'origine puis variantes.
    const all = this._pending().filter(r => r.kind !== 'pro'), fam = r => (r.dv && r.dv.base) || r.id, last = {};
    all.forEach(r => { last[fam(r)] = Math.max(last[fam(r)] || 0, r.updated || r.ts || 0); });
    const list = all.sort((a, b) => (last[fam(b)] - last[fam(a)]) || U.sortFr(fam(a), fam(b)) || (a.dv && a.dv.v ? 1 : 0) - (b.dv && b.dv.v ? 1 : 0) || U.sortFr((a.dv && a.dv.par) || '', (b.dv && b.dv.par) || '') || ((a.dv && a.dv.v) || 0) - ((b.dv && b.dv.v) || 0));
    if (!list.length) return '';
    const today = U.today();
    const rows = list.map(r => {
      const tot = (r.items || []).reduce((a, b) => a + U.num(b.price) * U.num(b.qty), 0) * (1 - Math.min(99, U.num(r.reduction)) / 100) + (U.num(r.livraison) > 0 ? U.num(r.livraison) : 0);
      const nb = (r.items || []).reduce((a, b) => a + U.num(b.qty), 0);
      const age = this._ageTxt(r);
      const dogs = this._dogsOf(r.name).map(d => d.name + (d.breed ? ' (' + d.breed + ')' : '')).join(', ');
      const exp = r.validUntil && r.validUntil < today;
      return `<tr${this._pendId === r.id ? ' style="background:var(--th-bg);"' : ''}>
        <td class="col-name"${r.dv && r.dv.v ? ' style="padding-left:26px;"' : ''}>${r.dv && r.dv.v ? '<span class="muted">↳ </span>' : ''}<b>${U.esc(Clients.show(r.name))}</b>${r.ready ? ` <span class="badge ok" title="Validé par ${U.esc(r.ready.by)} le ${U.frDateTime(r.ready.ts)}">✅ Prêt à traiter</span>` : ''}${r.dv && r.dv.base ? ` <span class="badge info" title="N° de devis">${Devis.no(r.dv)}</span>` : ''}${r.label ? ` <span class="badge info">${U.esc(r.label)}</span>` : ''}${dogs ? `<div class="muted" style="font-size:.8rem;">🐕 ${U.esc(dogs)}</div>` : ''}${r.note ? `<div class="muted" style="font-size:.8rem;font-style:italic;">📝 ${U.esc(r.note)}</div>` : ''}</td>
        <td><span class="badge ${age.d >= 7 ? 'warn' : ''}">⏳ ${age.txt}</span>${r.validUntil ? `<div class="${exp ? 'warn-txt' : 'muted'}" style="font-size:.8rem;">${exp ? '⚠ expiré le ' : 'valable jusqu\'au '}${U.frDate(r.validUntil)}</div>` : ''}</td>
        <td class="num" style="white-space:nowrap;">${nb} art.<br><b>${U.eur(tot)}</b></td>
        <td style="white-space:nowrap;text-align:right;">
          <button class="btn-ghost btn-sm" onclick="Paniers.resume('${r.id}')" title="Recharger ce panier pour le modifier">✏️ Reprendre</button>
          <button class="btn-ghost btn-sm" onclick="Paniers.makeVariant('${r.id}')" title="Garde ce devis tel quel et crée une variante (n° du devis + -V1, -V2…) pour changer un ou deux produits">🔀 Variante</button>
          <button class="btn-ghost btn-sm" onclick="Paniers.sharePending('${r.id}')" title="Ouvre la fenêtre « Partager » de ce devis : copier l'image ou le texte, enregistrer l'image">📤 Partager</button>
          ${App.isTeam
            ? `<button class="${r.ready ? 'btn-ghost' : 'btn-cta'} btn-sm" onclick="Paniers.toggleReady('${r.id}')" title="${r.ready ? 'Retirer la validation (le panier n\'est plus « prêt à traiter »)' : 'La cliente est d\'accord : Antho verra ce panier « prêt à traiter » et fera la sortie de stock'}">${r.ready ? '↩ Retirer la validation' : '✅ Valider pour la vente'}</button>`
            : `<button class="btn-cta btn-sm" onclick="Paniers.sendToSale('${r.id}')" title="La cliente est d'accord : charge les produits dans le ticket de la page Ventes">🛒 Envoyer en vente</button>`}
          <button class="btn-icon" onclick="Paniers.delPending('${r.id}')" title="Supprimer">🗑️</button>
        </td></tr>`;
    }).join('');
    return `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--caramel);">
      <h2>⏳ Paniers en attente (${list.length})${list.some(r => r.ready) ? ` <span class="badge ok" style="font-size:.75rem;vertical-align:middle;">✅ ${list.filter(r => r.ready).length} prêt${list.filter(r => r.ready).length > 1 ? 's' : ''} à traiter</span>` : ''}</h2>
      <div class="table-wrap"><table><thead><tr><th class="col-name">Cliente</th><th>En attente</th><th class="num">Panier</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    </div>`;
  },
  async resume(id) {
    const rec = this._pending().find(x => x.id === id); if (!rec) return;
    if (this.basket.length && this._pendId !== id && !await U.confirm('Remplacer le panier en cours par celui de ' + Clients.show(rec.name) + ' ?', { okLabel: 'Remplacer' })) return;
    this._loadRec(rec);
    this.render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    U.toast('Panier rechargé — modifie-le puis « Partager » → « Mettre à jour ».');
  },
  /* 📤 « Partager » directement depuis « Paniers en attente » (Antho 2026-11-04) : recharge ce devis dans le panier composé puis ouvre la fenêtre Partager (image / texte) */
  /* Le panier composé n'est PAS touché (Antho : plus de « remplacer le panier ? ») : on prête la place du panier au devis le temps de la fenêtre, puis on remet tout comme avant à sa fermeture. */
  _SWAPK: ['basket', 'proposals', 'client', 'budget', 'livraison', 'reduction', 'reductionCode', '_redAuto', 'nbChiens', '_pendId', '_pendUpd', '_dv', '_balOn', '_shClient', '_shLabel', '_shNote', '_shValid', '_shMode', '_shOpt', '_shMsg'],
  sharePending(id) {
    const rec = this._pending().find(x => x.id === id); if (!rec) return;
    if (this._swap) return;
    const snap = {}; this._SWAPK.forEach(k => { snap[k] = this[k]; });
    this._swap = true;
    this._loadRec(rec);
    this.share();
    const restore = () => {
      obs.disconnect(); this._swap = false;
      if (this._pendId === rec.id && this._dv && this._pending().includes(rec)) { rec.dv = { ...this._dv }; Store.save('baskets'); }   // la lettre du devis a pu avancer à la copie
      this._SWAPK.forEach(k => { this[k] = snap[k]; });
      this._draft();
      if (typeof App !== 'undefined' && App.current === 'paniers') this.render();
    };
    const obs = new MutationObserver(() => { if (!document.getElementById('modalBg')) restore(); });
    obs.observe(document.body, { childList: true });
  },
  _loadRec(rec) {
    this.basket = JSON.parse(JSON.stringify(rec.items || []));
    this._dropped = Array.isArray(rec.dropped) ? rec.dropped.slice() : []; this._qtyCap = rec.qtyCap ? { ...rec.qtyCap } : {};
    this.budget = U.num(rec.budget) || this.budget; this.livraison = U.num(rec.livraison); this.reduction = U.num(rec.reduction); this.reductionCode = rec.reductionCode || ''; this._redAuto = false; this.nbChiens = U.num(rec.nbChiens) || this.nbChiens;
    this._pendId = rec.id; this._pendUpd = rec.updated || rec.ts || 0;
    this.client = rec.name; this._shClient = rec.name; this._shLabel = rec.label || ''; this._shNote = rec.note || ''; this._shValid = rec.validUntil || ''; this._shMode = rec.mode || ''; this._balOn = rec.balOn !== false; this._dv = rec.dv ? { ...rec.dv } : Devis.blank();
    this.proposals = null;
  },
  /* Le panier en cours est une copie du panier en attente : si celui-ci a été mis à jour depuis un autre appareil (téléphone ↔ PC), on repart de la version à jour */
  _syncPend() {
    if (!this._pendId) return;
    const rec = this._pending().find(x => x.id === this._pendId);
    if (!rec) { this._pendId = null; this._pendUpd = 0; return; }   // supprimé ailleurs : le panier en cours devient un panier libre
    if ((rec.updated || rec.ts || 0) > (this._pendUpd || 0)) { this._loadRec(rec); U.toast('Panier mis à jour depuis un autre appareil.'); }
  },
  /* 🔀 Variante d'un devis (2026-10-06) : copie du panier qui reçoit le n° du devis d'origine + « -V1 », « -V2 »… (cf. devis.js). Depuis la liste (id) : la fiche est d'abord rechargée
     dans le panier composé. La variante part du panier TEL QU'IL EST affiché ; le devis d'origine reste comme il était dans « en attente » (ses modifications non enregistrées n'y sont pas écrites).
     Un panier pas encore rangé (ou sans n°) est d'abord mis en attente pour recevoir son numéro. La variante est rangée en attente et chargée dans le panier composé. */
  async makeVariant(id) {
    if (id) {
      const rec = this._pending().find(x => x.id === id); if (!rec) return;
      if (this.basket.length && this._pendId !== id && !await U.confirm('Remplacer le panier en cours par celui de ' + Clients.show(rec.name) + ' pour en faire une variante ?', { okLabel: 'Remplacer' })) return;
      if (this._pendId !== id) this._loadRec(rec);
    }
    if (!this.basket.length) return;
    this._shClient = String(this.client || this._shClient || '').trim();
    if (!this._shClient) { U.toast('Indique d\'abord le nom de la cliente (champ « Cliente » à gauche).', true); return; }
    const list = this._pending();
    let parent = this._pendId ? list.find(x => x.id === this._pendId) : null;
    if (!parent || !parent.dv || !parent.dv.base) { const r = this._storePending(); if (!r) return; parent = r.rec; }
    const now = Date.now(), dv = Devis.makeVariant(parent.dv, this._shareData().h);
    const copy = Object.assign({ id: U.uid(), ts: now }, this._pendingData(dv, this._shClient, now), { label: '' });
    list.push(copy);
    this._pendId = copy.id; this._pendUpd = copy.updated; this._dv = { ...dv }; this._shLabel = '';
    const entry = Store.log('panier', `Variante de devis — ${this._shClient} (${Devis.no(parent.dv)} → ${Devis.no(dv)})`, { type: 'deleteCreated', data: { domain: 'baskets', id: copy.id } });
    Store.save('baskets', 'journal');
    this.render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    U.toast('Variante créée — devis n° ' + Devis.no(dv) + '. Change tes produits puis « Mettre en attente ».', false, entry.id);
  },
  async delPending(id) {
    const rec = this._pending().find(x => x.id === id); if (!rec) return;
    if (!await U.confirm('Supprimer le panier en attente de ' + Clients.show(rec.name) + ' ?', { okLabel: 'Supprimer' })) return;
    const entry = Store.log('panier', `Panier en attente supprimé — ${rec.name}`, { type: 'restoreItem', data: Store.snapshot('baskets', rec) });
    Store.state.baskets = this._pending().filter(x => x.id !== id);
    if (this._pendId === id) this._pendId = null;
    Store.save('baskets', 'journal'); this.render();
    U.toast('Panier en attente supprimé.', false, entry.id);
  },
  sendToSale(id) { const rec = this._pending().find(x => x.id === id); if (rec) this._sendRecToSale(rec); },
  /* Panier composé → Ventes DIRECTEMENT, sans passer par « en attente » (vente immédiate / cliente déjà d'accord). Le panier reste ici
     tant qu'on ne le vide pas ; s'il venait d'un panier en attente, celui-ci est retiré à la validation de la vente (comme avant). */
  sendCurrentToSale() {
    if (!this.basket.length) return;
    this._sendRecToSale({ id: this._pendId || null, name: String(this.client || this._shClient || '').trim(), items: JSON.parse(JSON.stringify(this.basket)), reduction: this.reduction, reductionCode: this.reductionCode || '', livraison: this.livraison, balOn: this._balOn !== false, dv: this._pendId ? this._dv : null, fromComposer: true });
  },
  async _sendRecToSale(rec) {
    const units = Ventes.units(), merged = new Map(), warns = [], general = [];
    (rec.items || []).forEach((b, bi) => {
      const ukey = b.kind === 'A' ? 'A|' + b.pId : 'M|' + b.pId + '|' + b.vId, det = this._optLinesOf(b), key = det.length ? ukey + '#' + bi : ukey;
      if (merged.has(key)) { const m = merged.get(key); m.qty += U.num(b.qty); if (m.lotId !== (b.lotId || '')) m.lotId = ''; }   // plusieurs lots différents du même produit : le lot se choisit dans le ticket
      else merged.set(key, { key: ukey, name: b.name, variant: b.variant, price: U.num(b.price), qty: U.num(b.qty), lotId: b.kind === 'A' ? '' : (b.lotId || ''), det });
    });
    const lines = [];
    merged.forEach(m => {
      const u = units.find(x => x.key === m.key);
      if (!u) { warns.push(`<b>${U.esc(m.name)}</b> ${U.esc(m.variant || '')} : produit introuvable dans le stock (ignoré).`); return; }
      if (u.kind === 'A' && U.num(u.availE) + U.num(u.availG) < m.qty) warns.push(`🐕 <b>${U.esc(m.name)}</b> : stock fini insuffisant (${U.qty(m.qty)} demandé, ${U.qty(U.num(u.availE) + U.num(u.availG))} en stock) — à fabriquer.`);
      // Règle : toujours le stock ÉVÉNEMENT d'abord ; le manquant vient du stock général (confirmé dans la fenêtre)
      const e = Math.min(m.qty, Math.max(0, U.num(u.availE))), g = m.qty - e;
      if (e > 0) lines.push({ u, qty: e, price: m.price, src: 'event', lotId: m.lotId, det: m.det });
      if (g > 0) {
        lines.push({ u, qty: g, price: m.price, src: 'general', lotId: m.lotId, det: m.det });
        general.push(`<b>${U.esc(m.name)}</b> ${U.esc(u.label)} : ${e > 0 ? `${U.qty(e)} en événement + ` : ''}<b>${U.qty(g)} en stock général</b>`);
        if (g > U.num(u.availG)) warns.push(`<b>${U.esc(m.name)}</b> ${U.esc(u.label)} : stock général insuffisant (${U.qty(g)} à prendre, ${U.qty(u.availG)} dispo).`);
      }
      if (Math.abs(u.price - m.price) > 0.004) warns.push(`<b>${U.esc(m.name)}</b> ${U.esc(u.label)} : prix modifié depuis (${U.eur(m.price)} dans le panier, ${U.eur(u.price)} aujourd'hui). Le prix du panier est conservé.`);
      Clients.conflicts(rec.name, u).forEach(c => warns.push(`🐕 <b>${U.esc(m.name)}</b> : ${U.esc(c)}`));
    });
    if (!lines.length) { U.toast('Aucun produit à envoyer.', true); return; }
    const allGen = lines.every(l => l.src === 'general');
    const html = `<p>${allGen ? 'Aucun de ces produits n\'est en stock événement : tout sera déduit du stock <b>général</b>.' : 'Les produits seront déduits du stock <b>Événement</b>.'} Rien n'est déduit tant que tu n'as pas validé le ticket (et tu y choisis le lot de chaque ligne).</p>
      ${general.length && !allGen ? `<p style="margin-top:10px;"><b>🏬 Pas assez en événement — le manquant vient du stock général :</b></p><ul style="padding-left:18px;">${general.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}
      ${warns.length ? `<p style="margin-top:10px;"><b>⚠️ À vérifier :</b></p><ul style="padding-left:18px;">${warns.map(t => `<li>${t}</li>`).join('')}</ul>` : ''}`;
    if (!await U.ask({ title: '🛒 Envoyer en vente — confirmation', okLabel: 'Envoyer en vente', cancelLabel: 'Annuler', html })) return;
    if (Ventes.cart.length && !await U.confirm('Le ticket en cours de la page Ventes contient déjà des articles. Le remplacer par le panier de ' + Clients.show(rec.name) + ' ?', { okLabel: 'Remplacer' })) return;
    // Les autres versions du même devis (devis d'origine + variantes) ne servent plus : on propose de les supprimer, mais seulement APRÈS la validation de la vente (ticket abandonné = rien n'est perdu)
    const others = rec.dv && rec.dv.base ? this._pending().filter(x => x.kind !== 'pro' && x.id !== rec.id && x.dv && x.dv.base === rec.dv.base) : [];
    if (others.length && await U.ask({ title: '🗑️ Autres versions de ce devis', okLabel: 'Supprimer les autres', cancelLabel: 'Les garder', danger: true,
      html: `<p style="margin:0 0 8px;">Tu envoies en vente la version <b>${U.esc(Devis.no(rec.dv))}</b>. Ce devis a ${others.length} autre${others.length > 1 ? 's' : ''} version${others.length > 1 ? 's' : ''} en attente :</p><ul style="padding-left:18px;margin:0 0 8px;">${others.map(x => `<li><b>${U.esc(Devis.no(x.dv))}</b>${x.label ? ' — ' + U.esc(x.label) : ''}</li>`).join('')}</ul><p style="margin:0;">Les supprimer une fois la vente validée ?</p>` })) rec = { ...rec, others: others.map(x => x.id) };
    Ventes.loadFromBasket(rec, lines);
    (rec.items || []).forEach(b => { if ((b.kind || 'M') === 'M') this._learn(b.pId, 's', U.num(b.qty) || 1); });   // vendu via un panier : il plaît
  },

  /* Menu « Partager ▾ » : fermé par clic extérieur (jamais par onblur) */
  toggleShareMenu(e) {
    if (e) e.stopPropagation();
    const m = document.getElementById('pan_sharemenu'); if (!m) return;
    m.style.display = m.style.display === 'none' ? 'block' : 'none';
    if (!this._menuBound) {
      this._menuBound = true;
      document.addEventListener('click', ev => { const mm = document.getElementById('pan_sharemenu'); if (mm && mm.style.display !== 'none' && !mm.contains(ev.target)) mm.style.display = 'none'; });
    }
  },
  menuDo(fn, arg) { const m = document.getElementById('pan_sharemenu'); if (m) m.style.display = 'none'; this[fn](arg); },

  _stockWarn(pId, vId) {
    const p = Store.state.stockM.find(x => x.id === pId), v = p && (p.variants || []).find(x => x.id === vId);
    if (!v) return;
    const want = this.basket.filter(b => b.pId === pId && b.vId === vId).reduce((a, b) => a + U.num(b.qty), 0);
    const vq = Stock.isVirtual(p, v) ? Stock.virtualQty(p, v) : null;   // déclinaison sans stock propre : stock de la variante principale ÷ packQty
    const g = vq ? vq.g : (v.lots || []).reduce((a, l) => a + U.num(l.qtyGeneral), 0), e = vq ? vq.e : (v.lots || []).reduce((a, l) => a + U.num(l.qtyEvent), 0);
    if (want > g + e) U.toast(`⚠️ Stock insuffisant : ${U.qty(want)} ${p.name} ${Pricing.labelVariant(v)} dans le panier, ${U.qty(g + e)} en stock (général + événement).`, true);
    else if (want > g) U.toast(`⚠️ Stock général insuffisant : ${U.qty(want)} ${p.name} ${Pricing.labelVariant(v)} demandé(s), ${U.qty(g)} en général (le reste est en événement).`, true);
  },
  /* Image du panier (dessinée sur un canvas, aucune librairie) : copie dans le presse-papiers (HTTPS seulement) ou téléchargement PNG */
  async _shareCanvas() {
    const d = this._shareData();
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
    const pal = U.imgPalette('quote'), bg = pal.bg, fg = pal.fg, car = pal.car, th = pal.th;   // jour / nuit au choix (bouton « Image en mode… »)
    const font = (w, px) => `${w} ${px}px Quicksand, "Segoe UI", sans-serif`;
    const W = 860, pad = 32, rowH = 46, inner = W - 2 * pad;
    const cVar = pad + inner * 0.50, cQty = pad + inner * 0.645, rUnit = pad + inner * 0.82, rTot = W - pad - 12;   // colonnes : variante · quantité · prix unitaire · sous-total
    const rows = d.lines.length + (d.ship > 0 ? 1 : 0) + (d.red > 0 ? 1 : 0) + (d.av > 0 ? 1 : 0) + (d.det > 0 ? 1 : 0);
    // blocs facultatifs sous le total : lignes déjà coupées à la largeur utile
    const tmp = document.createElement('canvas').getContext('2d');
    const wrap = (txt, f) => { tmp.font = f; const out = []; String(txt).split('\n').forEach(par => { let cur = ''; par.split(' ').forEach(w => { const t = cur ? cur + ' ' + w : w; if (tmp.measureText(t).width > W - 2 * pad - 24 && cur) { out.push(cur); cur = w; } else cur = t; }); out.push(cur); }); return out; };
    const blocks = [];
    if (d.x.pay) blocks.push({ f: font(500, 16), l: wrap(d.x.pay, font(500, 16)) });
    if (d.x.ibanLines.length) blocks.push({ f: font(700, 16), l: d.x.ibanLines.concat(d.x.refHint ? wrap(d.x.refHint, font(500, 15)) : []) });
    if (d.x.msg) blocks.push({ f: font(500, 16), l: wrap(d.x.msg, font(500, 16)) });
    if (d.x.vatMention) blocks.push({ f: font(500, 15), l: wrap(d.x.vatMention, font(500, 15)) });
    if (d.x.valid) blocks.unshift({ f: font(500, 16), l: [d.x.valid] });
    if (d.x.mode) blocks.unshift({ f: font(700, 16), l: [d.x.mode] });
    const whoH = d.x.who ? 30 : 0;
    const extraH = blocks.reduce((a, b) => a + b.l.length * 24 + 12, 0);
    const OL = 21, detH = d.lines.reduce((a, l) => a + l.det.length * OL, 0);   // détails d'accessoire : une ligne de 21 px chacun sous le nom
    const H = pad + 50 + whoH + 44 + rows * rowH + detH + 70 + extraH + pad;
    const k = 2, cv = document.createElement('canvas');
    cv.width = W * k; cv.height = H * k;
    const x = cv.getContext('2d'); x.scale(k, k);
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.fillStyle = fg; x.textBaseline = 'middle';
    x.font = font(700, 26); x.textAlign = 'left'; x.fillText('Votre panier Touffu', pad, pad + 14);
    if (d.no) { x.font = font(700, 19); x.fillStyle = car; x.textAlign = 'right'; x.fillText('Devis n° ' + d.no, W - pad, pad + 14); x.fillStyle = fg; x.textAlign = 'left'; }
    let y = pad + 50;
    if (d.x.who) { x.fillStyle = car; x.font = font(700, 17); x.textAlign = 'left'; let wt = d.x.who; while (x.measureText(wt).width > W - 2 * pad && wt.length > 6) wt = wt.slice(0, -2); x.fillText(wt + (wt.length < d.x.who.length ? '…' : ''), pad, y + 6); y += whoH; }
    x.fillStyle = th; x.fillRect(pad, y, W - 2 * pad, 38);
    x.fillStyle = car; x.font = font(700, 13);
    x.textAlign = 'left'; x.fillText('PRODUIT', pad + 12, y + 19);
    x.textAlign = 'center'; x.fillText('VARIANTE', cVar, y + 19); x.fillText('QTÉ', cQty, y + 19);
    x.textAlign = 'right'; x.fillText('PRIX UNIT.', rUnit, y + 19); x.fillText('SOUS-TOTAL', rTot, y + 19);
    y += 38;
    x.strokeStyle = car; x.lineWidth = 2; x.beginPath(); x.moveTo(pad, y); x.lineTo(W - pad, y); x.stroke();
    d.lines.forEach((l, i) => {
      const rh = rowH + l.det.length * OL;
      if (i % 2) { x.fillStyle = th; x.globalAlpha = .45; x.fillRect(pad, y, W - 2 * pad, rh); x.globalAlpha = 1; }
      x.fillStyle = fg; x.font = font(700, 18); x.textAlign = 'left';
      let nm = l.name;
      while (x.measureText(nm).width > inner * 0.40 && nm.length > 4) nm = nm.slice(0, -2);
      x.fillText(nm + (nm.length < l.name.length ? '…' : ''), pad + 12, y + rowH / 2 - (l.dog ? 8 : 0));
      if (l.dog) { x.fillStyle = car; x.font = font(600, 13); x.fillText('→ pour ' + l.dog, pad + 12, y + rowH / 2 + 12); x.fillStyle = fg; }
      x.font = font(500, 17); x.textAlign = 'center'; x.fillText(l.variant || '', cVar, y + rowH / 2);
      x.font = font(700, 18); x.fillText(U.qty(l.qty), cQty, y + rowH / 2);
      x.font = font(500, 17); x.textAlign = 'right'; x.fillText(U.eur(l.unit), rUnit, y + rowH / 2);
      x.font = font(700, 18); x.fillText(U.eur(l.total), rTot, y + rowH / 2);
      if (l.det.length) { x.font = font(500, 15); x.fillStyle = fg; x.textAlign = 'left'; l.det.forEach((t, k) => { let tt = t; while (x.measureText(tt).width > inner * 0.62 && tt.length > 6) tt = tt.slice(0, -2); x.fillText(tt + (tt.length < t.length ? '…' : ''), pad + 28, y + rowH - 4 + k * OL + OL / 2); }); }
      y += rh;
    });
    if (d.red > 0) {
      x.fillStyle = fg; x.font = font(500, 17); x.textAlign = 'right';
      x.fillText(this._redLabel(d), rUnit, y + rowH / 2); x.fillText('− ' + U.eur(d.red), rTot, y + rowH / 2);
      y += rowH;
    }
    if (d.ship > 0) {
      x.fillStyle = fg; x.font = font(500, 17); x.textAlign = 'right';
      x.fillText('Livraison', rUnit, y + rowH / 2); x.fillText(U.eur(d.ship), rTot, y + rowH / 2);
      y += rowH;
    }
    [[d.av > 0, 'Avoir déduit', '− ' + U.eur(d.av)], [d.det > 0, 'Solde à régler', '+ ' + U.eur(d.det)]].forEach(([on, lab, val]) => {
      if (!on) return;
      x.fillStyle = fg; x.font = font(500, 17); x.textAlign = 'right'; x.fillText(lab, rUnit, y + rowH / 2); x.fillText(val, rTot, y + rowH / 2); y += rowH;
    });
    x.strokeStyle = car; x.beginPath(); x.moveTo(pad, y); x.lineTo(W - pad, y); x.stroke();
    x.fillStyle = fg; x.font = font(800, 21); x.textAlign = 'right';
    x.fillText(d.x.vatMention ? 'Total' : 'Total TTC', rUnit, y + 36); x.fillText(U.eur(d.total), rTot, y + 36);
    y += 72; x.textAlign = 'left';
    blocks.forEach(b => { x.font = b.f; x.fillStyle = fg; b.l.forEach(t => { x.fillText(t, pad + 12, y + 12); y += 24; }); y += 12; });
    return cv;
  },
  async shareImage(mode) {
    try {
      this._dvCommit();   // le devis sort : numéro définitif (lettre suivante si modifié)
      const cv = await this._shareCanvas();
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      if (!blob) throw new Error('image');
      if (mode === 'copy') {
        if (await U.copyImage(blob, cv.toDataURL('image/png'))) { U.toast('Image copiée — colle-la dans ta conversation.'); return; }
        // Connexion non sécurisée (http) : le navigateur refuse l'écriture dans le presse-papiers → on affiche l'image, clic droit > Copier l'image
        const box = document.getElementById('pan_share');
        if (box) {
          box.innerHTML = `<p class="muted" style="text-align:center;margin:0 0 8px;">Clic droit sur l'image → « Copier l'image »</p><img src="${cv.toDataURL('image/png')}" style="width:100%;border-radius:8px;display:block;" alt="Panier Touffu">`;
          return;
        }
        // pas de fenêtre « Partager » ouverte (bouton de la barre du panier) : on montre l'image dans une fenêtre
        U.modal({ title: '🖼️ Image du devis', hideOk: true, wide: true, body: `<p class="muted" style="text-align:center;margin:0 0 8px;">Clic droit sur l'image → « Copier l'image »</p><img src="${cv.toDataURL('image/png')}" style="width:100%;border-radius:8px;display:block;" alt="Panier Touffu">` });
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'panier-touffu.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { U.toast('Impossible de créer l’image.', true); }
  },
  copyShare() {
    this._dvCommit();   // le devis sort : numéro définitif (lettre suivante si modifié)
    const d = this._shareData();
    const eur = n => n.toFixed(2).replace('.', ',') + ' €';
    const text = ['Votre panier Touffu' + (d.no ? ' — Devis n° ' + d.no : '')].concat(d.x.who ? [d.x.who] : [], [''],
      d.lines.flatMap(l => [`• ${l.name}${l.variant ? ' (' + l.variant + ')' : ''}${l.qty > 1 ? ' × ' + U.qty(l.qty) + ' (' + eur(l.unit) + ' l\'unité)' : ''} — ${eur(l.total)}${l.dog ? ' → pour ' + l.dog : ''}`].concat(l.det.map(t => '     – ' + t))),
      [''], d.red > 0 ? [this._redLabel(d) + ' : − ' + eur(d.red)] : [], d.ship > 0 ? ['Livraison : ' + eur(d.ship)] : [], d.av > 0 ? ['Avoir déduit : − ' + eur(d.av)] : [], d.det > 0 ? ['Solde à régler : + ' + eur(d.det)] : [], [(d.x.vatMention ? 'Total' : 'Total TTC') + ' : ' + eur(d.total)],
      d.x.mode ? ['', d.x.mode] : [], d.x.valid ? ['', d.x.valid] : [], d.x.pay ? ['', d.x.pay] : [], d.x.ibanLines.length ? [''].concat(d.x.ibanLines, d.x.refHint ? [d.x.refHint] : []) : [], d.x.msg ? ['', d.x.msg] : [], d.x.vatMention ? ['', d.x.vatMention] : []).join('\n');
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); U.toast(ok ? 'Texte copié.' : 'Copie impossible', !ok); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => U.toast('Texte copié.')).catch(fallback); else fallback();
  },

  /* Remise à zéro de la CONFIGURATION (cliente, budget, livraison, réduction, chiens, priorité, filtres…) comme pour un tout nouveau panier */
  resetConfig() {
    Object.assign(this, JSON.parse(JSON.stringify(this._cfgDefaults || {})));
    this.client = ''; this.excludeMeatsOpen = false; this.addQ = ''; this.addOpen = false;
  },
  clearBasket() { this.resetWork(); this.render(); },
  /* Vide le panier composé SANS redessiner (aussi appelé par Ventes à la validation d'une vente : on n'est pas sur la page Paniers) */
  resetWork() {
    this.resetConfig();
    this.basket = []; this._dropped = []; this._qtyCap = {};
    this._pendId = null; this._pendUpd = 0; this._shClient = ''; this._shLabel = ''; this._shNote = ''; this._shValid = ''; this._shMode = ''; this._balOn = true; this._dv = Devis.blank();
    this.proposals = null;
  },
  pickProposal(idx) {
    if (!this.proposals || !this.proposals[idx]) return;
    this.basket = this.proposals[idx];
    this.proposals = null;
    this.render();
  },

  /* ---------- Ajout manuel ---------- */
  allCandidates() {
    const out = [];
    Store.state.stockM.forEach(p => {
      p.variants.forEach(v => {
        // Déclinaison « sans stock propre » (Lot 5…) : pas de lots à elle, son stock = celui de la variante principale ÷ packQty → une seule ligne, sans lot ni DLUO
        const vq = Stock.isVirtual(p, v) ? Stock.virtualQty(p, v) : null;
        const lots = vq ? (vq.t > 0 ? [{ id: '', qtyGeneral: vq.g, qtyEvent: vq.e, dluo: '', lotNumber: '' }] : []) : v.lots.filter(l => {
          const q = U.num(l.qtyGeneral) + U.num(l.qtyEvent);
          if (q <= 0) return false;
          const d = U.daysTo(l.dluo);
          // ajout manuel : les lots périmés restent proposés (badge « périmé »)
          return true;
        });
        if (!lots.length) return;
        const rc = Stock.refCalc(p, v);   // prix = fiche Prix mastication (la référence), jamais la copie du Stock
        const price = rc ? rc.calc.priceTTC : U.num(v.priceTTC);   // ajout manuel : même sans prix de vente renseigné (affiché 0,00 €)
        const coeff = rc ? (rc.calc.effCoeff || 0) : 0;
        const tags = this._mergeTags(Stock.effTags(p), Stock.variantTags(p, v));
        lots.forEach(l => {
          const avail = U.num(l.qtyGeneral) + U.num(l.qtyEvent);
          const daysLeft = U.daysTo(l.dluo);
          out.push({
            pId: p.id, vId: v.id, lotId: l.id,
            name: p.name, meat: p.meatType || '',
            variant: Pricing.labelVariant(v),
            sku: v.sku || '',
            price, coeff, avail,
            dluo: l.dluo || '', daysLeft: daysLeft !== null ? daysLeft : 9999,
            lotNumber: l.lotNumber || '',
            tags,
            mode: v.mode || '', value: v.value,
            ...this._famInfo(p, v)
          });
        });
      });
    });
    return out;
  },
  /* Accessoires proposables dans un panier / devis (toutes les fiches, même sans stock fini : fabriqués à la demande). Prix = fiche accessoire (accCalc). */
  accCandidates() {
    return Accessoires.crafted().map(a => {
      const c = Pricing.accCalc(a), w = a.mainWidth || (a.strapWidths || [])[0] || '';
      return { kind: 'A', pId: a.id, vId: '', lotId: '', name: a.name, meat: '', category: a.category || '', variant: '', width: w, sku: a.sku || '', price: c.priceTTC, coeff: c.effCoeff || 0,
        avail: U.num(a.stockGeneral) + U.num(a.stockEvent), dluo: '', daysLeft: 9999, tags: {}, rank: Accessoires._persoRank(a) };
    });
  },
  setAddKind(v) { this.addKind = v; this.addOpen = false; this.render(); },
  setAddFilter(k, v) { this[k] = v; this.addOpen = true; this.render(); },
  /* Filtres de la liste d'accessoires (mode « Accessoires ») : catégorie, largeur de sangle, personnalisation (sans / UV / thème UV / laser) */
  _accFilterOk(c) {
    if (this.addCat && c.category !== this.addCat) return false;
    if (this.addWidth && c.width !== this.addWidth) return false;
    const r = c.rank || 0, p = this.addPerso;
    return p === 'all' || (p === 'none' && r === 0) || (p === 'uv' && (r & 1) && !(r & 4)) || (p === 'theme' && (r & 4)) || (p === 'laser' && (r & 2));
  },
  manualCandidates(browse) {   // browse = sélecteur du téléphone : sans recherche ni filtre, on propose quand même la liste (limitée à 100 lignes)
    const q = U.normSearch(this.addQ), kind = this.addKind || 'all';
    const accs = kind === 'M' ? [] : this.accCandidates().filter(c => (kind !== 'A' || this._accFilterOk(c)) && (q ? U.has(c.name + ' ' + c.category + ' ' + c.width + ' ' + c.sku, q) : (kind === 'A' || browse))).filter(() => kind === 'A' || !this.addVariants.length).sort((a, b) => U.sortFr(a.name, b.name)).slice(0, 100);
    if (kind === 'A') return accs;
    return this.allCandidates().filter(c => {
      if (q && !U.has(c.name + ' ' + c.variant + ' ' + c.sku, q)) return false;
      if (this.addVariants.length && !this.addVariants.includes(c.variant)) return false;
      if (!q && !this.addVariants.length && !browse) return false;
      return true;
    }).filter((c, _i, arr) => !arr.some(o => o !== c && o.pId === c.pId && o.vId === c.vId && (o.daysLeft < c.daysLeft || (o.daysLeft === c.daysLeft && arr.indexOf(o) < arr.indexOf(c)))))   // une seule ligne par variante : le lot à la DLUO la plus courte (comme en vente)
      .sort((a, b) => U.sortFr(a.name + a.variant, b.name + b.variant)).slice(0, 100).concat(accs);
  },
  addVariantGroups() {
    return Stock.allVariantGroups();
  },
  toggleAddVariant(v) {
    const i = this.addVariants.indexOf(v);
    if (i >= 0) this.addVariants.splice(i, 1); else this.addVariants.push(v);
    this.render();
  },
  setAllAddVariant(all) {
    this.addVariants = all ? Stock.allVariantGroups().flatMap(g => g.items) : [];
    this.render();
  },
  setAddVariantsOpen(v) {   // un seul menu ouvert à la fois : ouvrir « Variantes » ferme la liste des produits
    this.addVariantsOpen = v;
    if (v && this.addOpen) { this.addOpen = false; this.render(); }
  },
  setAddQ(v) { this.addQ = v; this.addOpen = true; this.render(); U.refocus('pan_add_q'); },
  openAddMenu() { if (this.addOpen) return; this.addOpen = true; this.addVariantsOpen = false; this.render(); U.refocus('pan_add_q'); },   // ouvrir la liste des produits ferme le menu « Variantes »
  closeAddMenu() {
    if (!this.addOpen) return;
    // Le clic dans le champ arrive après son « focus » (qui a redessiné l'écran) : l'ancien champ est détaché, donc ce clic ressemblait à un clic extérieur et refermait la liste aussitôt.
    if (document.activeElement && document.activeElement.id === 'pan_add_q') return;
    this.addOpen = false; this.render();
  },
  /* silent = depuis le sélecteur plein écran du téléphone : on ajoute sans redessiner la page (elle l'est une seule fois à la fermeture) */
  /* Détails d'un accessoire du panier (motif, sangles, mousqueton, bouclerie, texte libre) — fenêtre partagée Accessoires.optEdit (Antho 2026-10-20 : d'abord pour les clients particuliers). */
  _optLinesOf(b) { return b && b.kind === 'A' && b.opts ? Accessoires.optLines(Accessoires.optOf(b.pId), b.opts) : []; },
  _optSum(b) { const L = this._optLinesOf(b); return L.length ? `<div style="font-weight:500;font-size:.8rem;color:var(--caramel);line-height:1.35;margin-top:3px;min-width:180px;">${L.map(U.esc).join(' · ')}</div>` : ''; },   // tableau : une ligne compacte (le devis, lui, met une ligne par détail)
  async itemOpts(i) {
    const b = this.basket[i]; if (!b || b.kind !== 'A') return;
    const res = await Accessoires.optEdit(Accessoires.optOf(b.pId), b.opts, b.name);
    if (res === null) return;
    if (Accessoires.optEmpty(res)) delete b.opts; else b.opts = res;
    this._draft(); this.render();
  },
  /* ⧉ même accessoire sur une nouvelle ligne (quantité 1, mêmes détails à modifier) : deux laisses de couleurs différentes = deux lignes */
  dupItem(i) {
    const b = this.basket[i]; if (!b) return;
    const c = JSON.parse(JSON.stringify(b)); c.qty = 1;
    this.basket.splice(i + 1, 0, c); this._draft(); this.render();
    U.toast('Ligne dupliquée — change ses détails avec « ✏️ Détails ».');
  },
  pickManual(pId, vId, lotId, kind, silent) {
    this._dropped = this._dropped.filter(x => x !== pId);   // ajouté à la main : à nouveau autorisé
    if ((kind || 'M') !== 'A') this._learn(pId, 'a');   // le générateur retient ce qu'Antho ajoute lui-même
    const done = () => { if (silent) this._draft(); else { this.addQ = ''; this.addOpen = false; this.render(); } };
    if (kind === 'A') {   // accessoire : pas de lot ni de DLUO
      const c = this.accCandidates().find(x => x.pId === pId); if (!c) { U.toast('Accessoire introuvable.', true); return; }
      const ex = this.basket.find(b => b.kind === 'A' && b.pId === pId && Accessoires.optEmpty(b.opts));
      if (ex) ex.qty++;
      else this.basket.push({ kind: 'A', pId: c.pId, vId: '', lotId: '', name: c.name, meat: '', category: c.category, variant: '', price: c.price, qty: 1, dluo: '', daysLeft: 9999, coeff: c.coeff, lotNumber: '', locked: true });
      done();
      if (c.avail <= 0) U.toast('🐕 ' + c.name + ' : pas de stock fini (à fabriquer pour la vente).');
      return;
    }
    const cands = this.allCandidates();
    const c = cands.find(x => x.pId === pId && x.vId === vId && x.lotId === lotId);
    if (!c) { U.toast('Produit introuvable ou plus en stock.', true); return; }
    if (c.daysLeft < 0) U.toast('⚠️ Lot périmé ajouté au panier : ' + c.name + ' (DLUO ' + U.frDate(c.dluo) + ').');
    const existing = this.basket.find(b => b.pId === pId && b.vId === vId && b.lotId === lotId);
    if (existing) { existing.qty++; }
    else {
      this.basket.push({
        pId: c.pId, vId: c.vId, lotId: c.lotId,
        name: c.name, meat: c.meat, variant: c.variant,
        price: c.price, qty: 1, dluo: c.dluo, daysLeft: c.daysLeft,
        coeff: c.coeff, lotNumber: c.lotNumber, locked: true
      });
    }
    done();
    this._stockWarn(pId, vId);
    Clients.conflicts(this.client, { kind: 'M', type: c.meat, name: c.name }).forEach(t => U.toast('🐕 ' + c.name + ' : ' + t, true));
  },

  /* ---------- Sélecteur plein écran (téléphone / tablette) ----------
     L'ancienne liste déroulante redessinait toute la page à chaque lettre et à chaque clic : écran qui saute, clavier qui se ferme.
     Ici : une feuille plein écran dont seule la liste change ; le champ de recherche n'est jamais recréé ; la page derrière n'est redessinée qu'à « Terminé ». */
  openPicker() {
    if (document.getElementById('panPicker')) return;
    if (this.addVariants.length > 1) this.addVariants = [];   // le sélecteur n'a qu'une variante à la fois
    this.addOpen = false; this.addVariantsOpen = false;
    const bg = document.createElement('div');
    bg.id = 'panPicker'; bg.className = 'pan-picker';
    bg.innerHTML = `<div class="pk-head"><div><b>➕ Ajouter au panier</b><div class="muted"><span id="pk_count">${this.basket.reduce((a, b) => a + U.num(b.qty), 0)}</span> article(s) dans le panier</div></div><button class="btn-cta btn-sm fit" onclick="Paniers.closePicker()">✓ Terminé</button></div>
      <div class="pk-top"><input id="pk_q" type="search" autocomplete="off" enterkeyhint="search" placeholder="Chercher un produit…" value="${U.esc(this.addQ)}" oninput="Paniers.pkQ(this.value)"><div id="pk_filters" class="pk-filters"></div></div>
      <div id="pk_list" class="pk-list"></div>`;
    document.body.appendChild(bg);
    document.body.classList.add('pan-picker-open');
    this._pickerFill();
  },
  closePicker() {
    const bg = document.getElementById('panPicker'); if (!bg) return;
    bg.remove(); document.body.classList.remove('pan-picker-open');
    this.addQ = ''; this.addOpen = false;
    const y = window.scrollY; this.render(); window.scrollTo(0, y);
    if (typeof Store !== 'undefined' && Store._afterModal) Store._afterModal();   // rattrape une synchro reportée pendant que la feuille était ouverte
  },
  _pickerFill() {
    const f = document.getElementById('pk_filters'); if (!f) return;
    const kind = this.addKind || 'all';
    const sel = (key, label, opts, cur) => `<label class="pk-f"><span>${label}</span><select onchange="Paniers.pkSet('${key}',this.value)">${opts.map(o => `<option value="${U.esc(o.v)}" ${o.v === cur ? 'selected' : ''}>${U.esc(o.l)}</option>`).join('')}</select></label>`;
    let h = sel('addKind', 'Type', [{ v: 'all', l: 'Tout' }, { v: 'M', l: '🥩 Mastication' }, { v: 'A', l: '🐕 Accessoires' }], kind);
    if (kind === 'A') {
      const accs = Accessoires.crafted(), cats = [...new Set(accs.map(a => a.category).filter(Boolean))].sort(U.sortFr), ws = [...new Set(accs.map(a => a.mainWidth || (a.strapWidths || [])[0] || '').filter(Boolean))].sort((a, b) => parseFloat(a) - parseFloat(b));
      h += sel('addCat', 'Catégorie', [{ v: '', l: 'Toutes' }].concat(cats.map(c => ({ v: c, l: c }))), this.addCat)
        + sel('addWidth', 'Largeur', [{ v: '', l: 'Toutes' }].concat(ws.map(w => ({ v: w, l: w }))), this.addWidth)
        + sel('addPerso', 'Personnalisation', [{ v: 'all', l: 'Toutes' }, { v: 'none', l: 'Sans' }, { v: 'uv', l: 'Impression UV' }, { v: 'theme', l: 'Création thème UV' }, { v: 'laser', l: 'Gravure laser' }], this.addPerso);
    } else {
      h += sel('addVariant', 'Variante', [{ v: '', l: 'Toutes' }].concat(Stock.allVariantLabels().map(l => ({ v: l, l }))), this.addVariants[0] || '');
    }
    f.innerHTML = h;
    this._pickerList();
  },
  _pickerList() {
    const box = document.getElementById('pk_list'); if (!box) return;
    const rows = this.manualCandidates(true);
    box.innerHTML = rows.length ? rows.map(c => {
      const inB = this.basket.filter(b => b.pId === c.pId && (c.kind === 'A' ? b.kind === 'A' : (b.vId === c.vId && b.lotId === c.lotId && b.kind !== 'A'))).reduce((a, b) => a + U.num(b.qty), 0);
      const sub = c.kind === 'A' ? '🐕 ' + U.esc(c.category) + (c.avail > 0 ? ' · stock ' + U.qty(c.avail) : ' · sans stock') : U.esc(c.meat) + (c.avail > 0 ? ' · stock ' + U.qty(c.avail) : '');
      return `<div class="pk-row${inB ? ' in' : ''}" onclick="Paniers.pkAdd('${c.pId}','${c.vId}','${c.lotId}','${c.kind || 'M'}')">
        <div class="pk-main"><div class="pk-name">${U.esc(c.name)} <span class="pk-v">${U.esc(c.kind === 'A' ? c.width : c.variant)}</span></div>
        <div class="pk-sub">${sub}${c.dluo ? ` · DLUO ${U.frDate(c.dluo)}` : ''}${c.coeff > 0 ? ` · <span class="sensitive">coeff ${c.coeff.toFixed(2)}</span>` : ''}</div></div>
        <div class="pk-price">${U.eur(c.price)}</div>
        <div class="pk-add">${inB ? '<span class="pk-n">' + U.qty(inB) + '</span>' : ''}<span class="pk-plus">+</span></div>
      </div>`;
    }).join('') : `<div class="pk-empty muted">Aucun résultat. Change la recherche ou un filtre.</div>`;
  },
  pkQ(v) { this.addQ = v; this._pickerList(); },
  pkSet(key, v) {
    if (key === 'addVariant') this.addVariants = v ? [v] : [];
    else this[key] = v;
    this._pickerFill();
  },
  pkAdd(pId, vId, lotId, kind) {
    const list = document.getElementById('pk_list'), top = list ? list.scrollTop : 0;
    this.pickManual(pId, vId, lotId, kind, true);
    this._pickerList();
    if (list) list.scrollTop = top;   // la liste reste où elle était : on enchaîne les ajouts
    const n = document.getElementById('pk_count'); if (n) n.textContent = this.basket.reduce((a, b) => a + U.num(b.qty), 0);
  },

  /* ---------- Filtres ---------- */
  /* Brouillon : le panier en cours (et sa cliente) survit à un rechargement de la page, un changement de fenêtre ou une fermeture d'onglet. « Vider » l'efface. */
  _DK: 'touffu_paniers_draft',
  _draft() {
    const keys = ['basket', 'proposals', 'client', '_pendId', '_pendUpd', '_dv', '_balOn', '_shClient', '_shLabel', '_shNote', '_shValid', '_shMode', '_dropped', '_qtyCap'];   // + écartés / plafonds (Antho 2026-11-19 : gardés après F5)
    try {
      if (!this._draftLoaded) {
        this._draftLoaded = true;
        const d = JSON.parse(localStorage.getItem(this._DK) || 'null');
        if (d && !(this.basket || []).length && !this.proposals) keys.forEach(k => { if (d[k] !== undefined && d[k] !== null) this[k] = d[k]; });
      }
      const out = {}; keys.forEach(k => { out[k] = this[k]; });
      localStorage.setItem(this._DK, JSON.stringify(out));
    } catch (e) {}
  },
  /* Synchro entre ONGLETS (Antho 2026-10-25) : un ajout fait dans un autre onglet (ex. « Ajouter » depuis Stock → Péremptions) s'affiche ici tout de suite.
     Avant : cet onglet gardait un vieux panier en mémoire et le réécrivait par-dessus le brouillon (au prochain rendu / retour sur l'onglet) → l'ajout disparaissait,
     même après un F5. Désormais l'événement `storage` (déclenché dans les AUTRES onglets seulement) recharge le brouillon en mémoire : plus jamais de panier périmé à réécrire. */
  _adoptDraft(raw) {
    try {
      const d = JSON.parse(raw || 'null'); if (!d) return;
      ['basket', 'proposals', 'client', '_pendId', '_pendUpd', '_dv', '_balOn', '_shClient', '_shLabel', '_shNote', '_shValid', '_shMode', '_dropped', '_qtyCap'].forEach(k => { if (k in d) this[k] = d[k]; });
      if (!Array.isArray(this._dropped)) this._dropped = []; if (!this._qtyCap || typeof this._qtyCap !== 'object') this._qtyCap = {};
      this._draftLoaded = true;
      if (typeof App !== 'undefined' && App.current === 'paniers') App.rerender();   // garde le champ en cours de saisie (App.rerender)
    } catch (e) { console.error(e); }
  },
  _disc() { return Math.min(99, Math.max(0, U.num(this.reduction))) / 100; },
  _avail() { return (this.budget - this.livraison) / (1 - this._disc()); },   // budget utilisable, exprimé en prix publics (avant réduction)
  setReduction(v) { this.reduction = Math.min(99, Math.max(0, U.num(v))); this._redAuto = false; this._updateKPI(); },
  setReductionCode(v) {
    this.reductionCode = String(v || '').trim();
    const m = Partners.byCode(this.reductionCode); if (m) this.reductionCode = m.c.code;   // code partenaire : sa réduction se remplit toute seule
    if (m && U.num(m.c.discPct) > 0) { this.reduction = U.num(m.c.discPct); this._redAuto = false; this.render(); U.toast(`🤝 Code ${m.p.name} : −${U.qty(this.reduction)} %.`); }
    else this._updateKPI();
  },
  setBudget(v) { this.budget = U.num(v); this._updateKPI(); },
  setLivraison(v) { this.livraison = U.num(v); this._updateKPI(); },
  setNbChiens(v) { this.nbChiens = Math.max(1, U.num(v)); this._updateKPI(); },
  setPriority(v) { this.priority = v; this.render(); },
  setPoil(v) { this.poilFilter = v; this.render(); },
  setHypo(v) { this.hypoOnly = v; },
  setMaxPer(v) { this.maxPerProduct = Math.max(1, U.num(v)); },
  toggleResistance(r) {
    const i = this.resistanceInclude.indexOf(r);
    if (i >= 0) this.resistanceInclude.splice(i, 1); else this.resistanceInclude.push(r);
    this.render();
  },
  setType(v) { this.typeFilter = v; this.render(); },
  toggleAge(v) { const i = this.ageInclude.indexOf(v); if (i >= 0) this.ageInclude.splice(i, 1); else this.ageInclude.push(v); this.render(); },
  setAllAge(all) { this.ageInclude = all ? ['0-3','3-5','6-10','11+','senior'] : []; this.render(); },
  setAgeOpen(v) { this.ageOpen = v; },
  toggleGabarit(v) { const i = this.gabaritInclude.indexOf(v); if (i >= 0) this.gabaritInclude.splice(i, 1); else this.gabaritInclude.push(v); this.render(); },
  setAllGabarit(all) { this.gabaritInclude = all ? ['petit','moyen','grand'] : []; this.render(); },
  setGabaritOpen(v) { this.gabaritOpen = v; },
  toggleOdeur(v) { const i = this.odeurInclude.indexOf(v); if (i >= 0) this.odeurInclude.splice(i, 1); else this.odeurInclude.push(v); this.render(); },
  setAllOdeur(all) { this.odeurInclude = all ? ['faible','moyenne','forte'] : []; this.render(); },
  setOdeurOpen(v) { this.odeurOpen = v; },
  toggleGras(v) { const i = this.grasInclude.indexOf(v); if (i >= 0) this.grasInclude.splice(i, 1); else this.grasInclude.push(v); this.render(); },
  setAllGras(all) { this.grasInclude = all ? ['non','peu','moyen','gras'] : []; this.render(); },
  setGrasOpen(v) { this.grasOpen = v; },

  _updateKPI() {
    const totalBasket = this.basket.reduce((a, b) => a + b.price * b.qty, 0);
    const available = this._avail();
    const remaining = available - totalBasket;
    const el = document.getElementById('pan_kpi');
    if (el) {
      const nbArticles = this.basket.reduce((a, b) => a + b.qty, 0);
      el.innerHTML = `
        <div class="kpi"><span class="kpi-val">${U.eur(this.budget)}</span><span class="kpi-label">Budget</span></div>
        ${this.livraison > 0 ? `<div class="kpi"><span class="kpi-val">− ${U.eur(this.livraison)}</span><span class="kpi-label">Livraison</span></div>` : ''}
        <div class="kpi"><span class="kpi-val">${U.eur(totalBasket)}</span><span class="kpi-label">Panier (${nbArticles} art.)</span></div>
        ${this._disc() > 0 ? `<div class="kpi"><span class="kpi-val">− ${U.eur(totalBasket * this._disc())}</span><span class="kpi-label">${U.esc(this._redLabel({ redCode: this.reductionCode, redPct: this.reduction }))}</span></div>` : ''}
        ${this._resteKPI(remaining)}
      `;
    }
  },

  toggleExcludeMeat(m) {
    const i = this.excludeMeats.indexOf(m);
    if (i >= 0) this.excludeMeats.splice(i, 1); else this.excludeMeats.push(m);
    this.render();
  },
  setExcludeMeatsOpen(v) { this.excludeMeatsOpen = v; },
  setAllExcludeMeats(all) { this.excludeMeats = all ? [...(Store.state.settings.meatTypes || [])] : []; this.render(); },

  setExcludeProdsQ(v) { this.excludeProdsQ = v; this.excludeProdsOpen = true; this.render(); U.refocus('pan_excl_q'); },
  openExcludeProds() { if (this.excludeProdsOpen) return; this.excludeProdsOpen = true; this.render(); U.refocus('pan_excl_q'); },
  closeExcludeProdMenu() { if (!this.excludeProdsOpen) return; this.excludeProdsOpen = false; this.render(); },
  addExcludeProduct(id) {
    if (!this.excludeProducts.includes(id)) this.excludeProducts.push(id);
    this.excludeProdsQ = ''; this.excludeProdsOpen = false;
    this.render();
  },
  removeExcludeProduct(id) {
    this.excludeProducts = this.excludeProducts.filter(x => x !== id);
    this.render();
  },

  /* ---------- Propositions (vue comparaison) ---------- */
  _renderProposals() {
    const available = this.budget - this.livraison;
    let html = `<h2>🧺 Propositions</h2>
      <p class="muted" style="margin-bottom:16px;">Deux options — choisis celle qui convient au client.</p>
      <div class="kpi-row" style="margin-bottom:16px;">
        <div class="kpi"><span class="kpi-val">${U.eur(this.budget)}</span><span class="kpi-label">Budget</span></div>
        ${this.livraison > 0 ? `<div class="kpi"><span class="kpi-val">− ${U.eur(this.livraison)}</span><span class="kpi-label">Livraison</span></div>` : ''}
        <div class="kpi"><span class="kpi-val">${U.eur(available)}</span><span class="kpi-label">Disponible</span></div>
      </div>`;

    this.proposals.forEach((prop, idx) => {
      const total = prop.reduce((a, b) => a + b.price * b.qty, 0);
      const nb = prop.reduce((a, b) => a + b.qty, 0);
      const nProd = new Set(prop.map(b => b.pId)).size;
      const nMeat = new Set(prop.map(b => b.meat).filter(Boolean)).size;
      const diff = total - available;
      const isOver = diff > 0.005;
      const remain = available - total;
      const label = idx === 0 ? '🎯 Pile budget' : '📈 Un peu au-dessus';
      const border = idx === 0 ? 'var(--caramel)' : '#e9a820';

      html += `<div style="border:2px solid ${border};border-radius:8px;padding:12px 16px;margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
          <h3 style="margin:0;">${label}</h3>
          <span style="font-size:1.15em;font-weight:700;">${U.eur(total)} ${isOver ? `<span class="badge warn">+${U.eur(diff)}</span>` : remain > 0.005 ? `<span class="muted" style="font-size:0.8em;">reste ${U.eur(remain)}</span>` : ''}</span>
        </div>
        <p class="muted" style="margin:0 0 8px;">${nb} article(s) · ${nProd} produit(s) · ${nMeat} viande(s)${(() => { const ci = prop.filter(b => b.coeff > 0); const cq = ci.reduce((a,b) => a + b.qty, 0); const cm = cq > 0 ? ci.reduce((a,b) => a + b.coeff * b.qty, 0) / cq : 0; return cm > 0 ? ` · <span class="sensitive"><b>Coeff moyen : ${cm.toFixed(2)}</b>${this._coeffTag(cm)}</span>` : ''; })()}</p>
        ${nb ? `<div class="table-wrap"><table>
          <thead><tr><th class="col-name">Produit</th><th>Variante</th><th>Viande</th><th class="num">Qté</th><th class="num">S/total</th><th>DLUO</th></tr></thead>
          <tbody>${prop.map(b => {
            const dl = U.daysTo(b.dluo);
            const dc = dl !== null && dl < 0 ? 'bad' : dl !== null && dl <= 30 ? 'warn' : '';
            return `<tr>
              <td class="col-name">${U.esc(b.name)}${b.dog ? `<div class="muted" style="font-size:.82rem;">→ pour ${U.esc(b.dog)}</div>` : ''}</td>
              <td><span class="tag">${U.esc(b.variant)}</span></td>
              <td><span class="badge info">${U.esc(b.meat || '—')}</span></td>
              <td class="num">${b.qty}</td>
              <td class="num"><b>${U.eur(b.price * b.qty)}</b></td>
              <td>${b.dluo ? `<span class="badge ${dc}">${U.frDate(b.dluo)}</span>` : '<span class="muted">—</span>'}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>` : '<p class="muted">Aucun article.</p>'}
        <button class="btn-cta" onclick="Paniers.pickProposal(${idx})" style="margin-top:8px;width:100%;">✅ Choisir ce panier</button>
      </div>`;
    });

    return html;
  },

  /* ---------- Rendu ---------- */
  render() {
    // Préférences/filtres persistés (pas `basket` : un panier en cours ne doit jamais
    // réapparaître tout seul après un F5, contrairement à un simple filtre de recherche).
    U.syncFilters('paniers', this, ['budget', 'livraison', 'reduction', 'reductionCode', 'nbChiens', 'priority', 'excludeMeats',
      'excludeProducts', 'poilFilter', 'hypoOnly', 'resistanceInclude', 'typeFilter',
      'ageInclude', 'gabaritInclude', 'odeurInclude', 'grasInclude', 'maxPerProduct', 'risks', 'kind', 'races']);
    this._draft();
    this._syncPend(); this._draft();
    const S = Store.state.settings;
    const meatTypes = (S.meatTypes || []).slice().sort(U.sortFr);
    const products = Store.state.stockM;
    const totalBasket = this.basket.reduce((a, b) => a + b.price * b.qty, 0);
    const available = this._avail();
    const remaining = available - totalBasket;
    const nbArticles = this.basket.reduce((a, b) => a + b.qty, 0);
    const hasLocked = this.basket.some(b => b.locked);

    const exclNames = this.excludeProducts.map(id => {
      const p = products.find(x => x.id === id);
      return p ? p.name : '?';
    });

    const exclProdResults = this.excludeProdsQ
      ? U.rank(products.filter(p => !this.excludeProducts.includes(p.id)), this.excludeProdsQ, p => p.name).slice(0, 10)
      : [];

    const addResults = this.addOpen ? this.manualCandidates() : [];

    App.mount(`
      <div class="view-title"><h1>🧺 Paniers personnalisés</h1><span class="sub">Compose un panier mixte de mastication en fonction du budget, des préférences du chien et de la rentabilité.</span></div>

      ${this._pendingCard()}
      <div class="paniers-layout">

      <div class="card" id="pan_cfg">
        <h2>⚙️ Configuration</h2>

        <div class="fg" style="margin-bottom:12px;"><label>🐕 Cliente (option)</label>
          <input type="text" data-clcombo autocomplete="off" id="pan_client" value="${U.esc(Clients.show(this.client))}" placeholder="nom de la cliente ou du chien…" onchange="Paniers.setClient(this.value)">
          <div class="muted" style="font-size:.82rem;margin-top:4px;">${this._clientSummaryHTML()}</div>${this._lastHTML()}</div>

        <div class="fg" style="margin-bottom:12px;"><label>Type de panier <span class="muted help">Vente : deux propositions, au plus près du budget et jusqu'à 10 % au-dessus. Commande site : déjà payée → jamais EN DESSOUS du montant, au plus juste au-dessus. Lot à gagner : jamais au-dessus du budget (le client ne paiera pas la différence), les dates courtes d'abord puis les produits au plus fort coefficient : si tu ajoutes ensuite un produit pour améliorer le panier, la marge reste bonne.</span></label>
          ${U.seg(this.KINDS.map(([v, l]) => ({ l, on: this.kind === v, js: `Paniers.setKind('${v}')` })), { sm: true })}</div>

        <div class="fg" style="margin-bottom:12px;"><label>Objectif <span class="muted help">Écouler : toutes les dates courtes (30 jours ou moins, et dépassées) passent en premier. Équilibré : le réglage habituel du type de panier (commande site : seules les dates dépassées d'office, puis date et coefficient). Rentable : les meilleurs coefficients d'abord.</span></label>
          ${U.seg(this.OBJECTIVES.map(([v, l]) => ({ l, on: this.priority === v, js: `Paniers.setObjective('${v}')` })), { sm: true })}</div>
        ${Store.isAdmin() ? `<div class="fg sensitive pan-ct" style="margin-bottom:12px;"><label>Coeff visé <span class="muted help">Coefficient moyen que le générateur essaie d'atteindre (prix de vente HT ÷ coût de revient). Sous la cible, il préfère les produits mieux margés ; cible atteinte, il ne change plus rien. Sans effet en « Écouler » (les dates courtes passent avant). 0 = pas de cible. Suivi mois par mois : Statistiques → Chiffre d'affaires.</span></label>
          <input id="pan_ctarget" type="text" inputmode="decimal" value="${this._coeffTarget() ? this._coeffTarget().toFixed(2).replace('.', ',') : '0'}" onchange="Paniers.setCoeffTarget(this.value)"></div>` : ''}

        <div class="frow" style="gap:12px;">
          <div class="fg"><label>💰 Budget TTC</label>
            <input type="number" id="pan_budget" step="0.5" min="0" value="${this.budget}" oninput="Paniers.setBudget(this.value)">
          </div>
          <div class="fg"><label>📦 Livraison</label>
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
              <input type="number" id="pan_livr" step="0.1" min="0" value="${this.livraison}" oninput="Paniers.setLivraison(this.value)" style="flex:1 1 70px;min-width:70px;">
              ${U.seg([{ l: '0 €', on: this.livraison === 0, js: 'Paniers.setLivraisonQuick(0)' }, { l: U.eur(Store.state.settings.shippingCost ?? 6.8), on: this.livraison === (Store.state.settings.shippingCost ?? 6.8), js: `Paniers.setLivraisonQuick(${Store.state.settings.shippingCost ?? 6.8})` }], { sm: true })}
            </div>
          </div>
          <div class="fg"><label>🏷️ Réduction % · code</label>
            <div style="display:flex;gap:6px;"><input type="number" id="pan_red" step="0.5" min="0" max="99" value="${this.reduction || ''}" placeholder="0" style="flex:0 0 76px;min-width:0;" oninput="Paniers.setReduction(this.value)" title="Réduction du client : le budget restant et la génération en tiennent compte (remplie toute seule si la fiche du client a une réduction habituelle)"><input type="text" id="pan_redcode" value="${U.esc(this.reductionCode || '')}" placeholder="code" data-clcombo="codes" autocomplete="off" style="flex:1 1 70px;min-width:0;" onchange="Paniers.setReductionCode(this.value)" title="Code utilisé (information pour toi : il n'apparaît pas sur le devis du client)"></div>
          </div>
          <div class="fg"><label>🐕 Chiens</label>
            <input type="number" id="pan_chiens" min="1" max="10" value="${this.nbChiens}" oninput="Paniers.setNbChiens(this.value)">
          </div>
        </div>

        <div class="frow" style="gap:12px;">
          <div class="fg"><label>📬 Mode de remise ${U.info("Affiché sur le devis. Click & Collect = retrait, sans frais de livraison ; Livraison = frais habituels si aucun frais n'est saisi. Re-clique pour décocher.")}</label>
            <div class="pan-mode">${this._modeBtns()}</div>
          </div>
        </div>

        <details class="fold pan-adv" ${this._advOpen ? 'open' : ''} ontoggle="Paniers._advOpen=this.open">
          <summary><span class="pan-adv-t">Réglages avancés</span> <span class="muted pan-adv-sum">${U.esc(this._advSummary())}</span></summary>
          <div class="fold-body">
        <div class="frow" style="gap:12px;">
          <div class="fg"><label>🐾 Poil</label>
            ${U.customSelect({ value: this.poilFilter, options: [{v:'all',l:'Tous'},{v:'avec',l:'Avec poil'},{v:'sans',l:'Sans poil'}], onPick: 'Paniers.setPoil' })}
          </div>
          <div class="fg"><label>Max/produit <span class="muted help">Nombre maximum de fois qu'un même produit peut apparaître dans le panier, par chien. Avec 2 : au plus 2 fois la même oreille pour 1 chien, 4 fois pour 2 chiens. Un produit vendu au poids (sachet) n'est jamais mis deux fois quand il y a plusieurs chiens.</span></label>
            <input type="number" id="pan_maxper" min="1" max="20" value="${this.maxPerProduct}" oninput="Paniers.setMaxPer(this.value)">
          </div>
        </div>

        <div class="frow" style="gap:12px;">
          <div class="fg"><label>🦴 Type</label>
            ${U.customSelect({ value: this.typeFilter, options: [{v:'all',l:'Tous'}].concat(Store.productTypes().map(t => ({v:t.value,l:t.label}))), onPick: 'Paniers.setType' })}
          </div>
        </div>

        <div class="frow" style="gap:12px;">
          <div class="fg"><label>🐶 Âge du chien</label>
            ${U.multiSelect({ options: ['0-3','3-5','6-10','11+','senior'], labels: {'0-3':'Chiot (0-3 mois)','3-5':'Chiot (3-5 mois)','6-10':'Jeune (6-10 mois)','11+':'Adulte (11 mois +)','senior':'Sénior'}, selected: this.ageInclude, toggle: 'Paniers.toggleAge', setAll: 'Paniers.setAllAge', open: this.ageOpen, onOpen: 'Paniers.setAgeOpen', placeholder: 'Tous âges' })}
          </div>
          <div class="fg"><label>📏 Gabarit</label>
            ${U.multiSelect({ options: ['petit','moyen','grand'], labels: {'petit':'Petit loulou','moyen':'Gabarit Moyen','grand':'Grand chien'}, selected: this.gabaritInclude, toggle: 'Paniers.toggleGabarit', setAll: 'Paniers.setAllGabarit', open: this.gabaritOpen, onOpen: 'Paniers.setGabaritOpen', placeholder: 'Tous gabarits' })}
          </div>
        </div>

        <div class="frow" style="gap:12px;">
          <div class="fg"><label>👃 Odeur max acceptée</label>
            ${U.multiSelect({ options: ['faible','moyenne','forte'], labels: {'faible':'Faible','moyenne':'Moyenne','forte':'Forte'}, selected: this.odeurInclude, toggle: 'Paniers.toggleOdeur', setAll: 'Paniers.setAllOdeur', open: this.odeurOpen, onOpen: 'Paniers.setOdeurOpen', placeholder: 'Toutes odeurs' })}
          </div>
          <div class="fg"><label>🫠 Niveau de gras</label>
            ${U.multiSelect({ options: ['non','peu','moyen','gras'], labels: {'non':'Non gras','peu':'Peu gras','moyen':'Moyennement gras','gras':'Gras'}, selected: this.grasInclude, toggle: 'Paniers.toggleGras', setAll: 'Paniers.setAllGras', open: this.grasOpen, onOpen: 'Paniers.setGrasOpen', placeholder: 'Tous niveaux' })}
          </div>
        </div>

        <div class="frow" style="gap:12px;margin-top:8px;align-items:center;">
          <label class="chip-opt fit"><input type="checkbox" ${this.hypoOnly ? 'checked' : ''} onchange="Paniers.setHypo(this.checked)"> Hypoallergénique uniquement</label>
        </div>
        ${this._raceHTML()}
        <div class="fg" style="margin-top:8px;"><label>Particularités du chien <span class="muted help">Préfère le tendre : rien de dur, produits faciles à mâcher (même pour un grand chien). Utilisables sans fiche chien. Remplies toutes seules quand tu choisis une cliente (fiche du chien, sinon sa race). Glouton ou risque d'étouffement : pas de produits qui se ramollissent (pastille « se ramollit ») ni de petites tailles (XS, S) sauf pour un petit chien. Dents fragiles : rien de dur. Surpoids : rien de gras. Très énergique : produits plus résistants. La mastication longue n'est jamais cochée d'office et n'est proposée qu'une fois par panier.</span></label>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">${this.RISKS.map(([k, l]) => `<label class="chip-opt"><input type="checkbox" ${this.risks[k] ? 'checked' : ''} onchange="Paniers.toggleRisk('${k}')"> ${l}</label>`).join('')}</div>
        </div>

        <div class="fg" style="margin-top:8px;">
          <label>💪 Résistance souhaitée</label>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">
            ${this.RESISTANCES.map(([v,l]) =>
              `<label class="chip-opt"><input type="checkbox" ${this.resistanceInclude.includes(v)?'checked':''} onchange="Paniers.toggleResistance('${v}')"> ${l}</label>`
            ).join('')}
          </div>
        </div>

        <div class="fg" style="margin-top:8px;">
          <label>🚫 Viandes exclues</label>
          ${U.multiSelect({ options: meatTypes, selected: this.excludeMeats, toggle: 'Paniers.toggleExcludeMeat', setAll: 'Paniers.setAllExcludeMeats', open: this.excludeMeatsOpen, onOpen: 'Paniers.setExcludeMeatsOpen', placeholder: 'Aucune exclusion' })}
        </div>

        <div class="fg" style="margin-top:8px;">
          <label>🚫 Produits exclus</label>
          <div class="autocomplete" data-onclose="Paniers.closeExcludeProdMenu">
            <input id="pan_excl_q" type="text" autocomplete="off" placeholder="Chercher un produit à exclure…"
              value="${U.esc(this.excludeProdsQ)}" oninput="Paniers.setExcludeProdsQ(this.value)" onfocus="Paniers.openExcludeProds()">
            ${this.excludeProdsOpen && exclProdResults.length ? `<div class="ac-list">${exclProdResults.map(p =>
              `<div class="ac-item pp-row" onmousedown="event.preventDefault();Paniers.addExcludeProduct('${p.id}')"><span class="pp-a">${U.esc(p.name)}</span><span class="pp-b">${U.esc(p.meatType || '')}</span><span class="pp-c"></span></div>`
            ).join('')}</div>` : ''}
          </div>
          ${exclNames.length ? `<div class="chips" style="margin-top:6px;">${this.excludeProducts.map((id, i) =>
            `<span class="chip">${U.esc(exclNames[i])} <button class="btn-icon" onclick="Paniers.removeExcludeProduct('${id}')" title="Retirer">×</button></span>`
          ).join('')}</div>` : ''}
        </div>
          </div>
        </details>

        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-cta" onclick="Paniers.generate()">🎲 Générer le panier</button>
          ${this.basket.length && this._avail() - this.basket.reduce((a, b) => a + b.price * b.qty, 0) >= 0.05 ? `<button class="btn-ghost" onclick="Paniers.complete()" title="Garde tous les produits du panier et ajoute de quoi arriver au budget">＋ Compléter le panier</button>` : ''}
          ${this.basket.length || this.proposals ? `<button class="btn-ghost" onclick="Paniers.clearBasket()">🧹 Vider</button>` : ''}
        </div>
      </div>

      <div class="card">
        ${this.proposals ? this._renderProposals() : `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
          <h2 style="margin:0;">🧺 Panier composé${this.nbChiens > 1 ? ` <span class="muted">(${this.nbChiens} chiens)</span>` : ''}</h2>
          ${this.basket.length ? `<div class="pan-actions" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;align-items:center;">
            <div style="position:relative;display:inline-block;">
              <button class="btn-ghost btn-sm" onclick="Paniers.toggleShareMenu(event)" title="Copier ou enregistrer l'image du devis, copier le texte, régler ce qui s'affiche">📤 Partager ▾</button>
              <div id="pan_sharemenu" style="display:none;position:absolute;right:0;top:100%;margin-top:4px;z-index:60;min-width:220px;background:var(--card-bg);border:1px solid var(--card-border);border-radius:10px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.4);">
                <button class="btn-ghost btn-sm" style="display:block;width:100%;text-align:left;margin:2px 0;" onclick="Paniers.menuDo('shareImage','copy')" title="Copie l'image du devis (avec son n°)">🖼️ Copier l'image</button>
                <button class="btn-ghost btn-sm" style="display:block;width:100%;text-align:left;margin:2px 0;" onclick="Paniers.menuDo('shareImage','save')">⬇ Enregistrer l'image</button>
                <button class="btn-ghost btn-sm" style="display:block;width:100%;text-align:left;margin:2px 0;" onclick="U.toggleImgTheme('quote',this)" title="Clique pour passer l'image en mode jour (fond blanc) ou nuit (couleurs de l'appli)">${U.imgThemeLabel('quote')}</button>
                <button class="btn-ghost btn-sm" style="display:block;width:100%;text-align:left;margin:2px 0;" onclick="Paniers.menuDo('copyShare')">📋 Copier le texte</button>
                <button class="btn-ghost btn-sm" style="display:block;width:100%;text-align:left;margin:2px 0;" onclick="Paniers.menuDo('share')" title="Fenêtre propre à montrer au client : produit, variante et prix TTC, avec les options d'affichage">⚙️ Aperçu et options…</button>
              </div>
            </div>
            <button class="btn-ghost btn-sm" onclick="Paniers.makeVariant()" title="Crée une variante de ce devis (n° du devis + -V1, -V2…) : tu gardes le panier de base et tu changes un ou deux produits">🔀 Variante</button>
            ${App.isTeam
              ? `<button class="btn-cta btn-sm" onclick="Paniers.validateCurrent()" title="La cliente est d'accord : range le panier en attente et le marque « prêt à traiter » pour Antho (c'est lui qui fait la sortie de stock)">✅ Valider pour la vente</button>`
              : `<button class="btn-cta btn-sm" onclick="Paniers.sendCurrentToSale()" title="Charge ce panier dans le ticket de la page Ventes (rien n'est déduit tant que tu n'as pas validé la vente)">🛒 Envoyer en vente</button>`}
            <button class="btn-cta btn-sm" onclick="Paniers.quickPending()" title="Range le devis dans « Paniers en attente » et repart à vide">💾 Mettre en attente</button>
          </div>` : ''}
        </div>
        ${this.basket.length ? `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px;"><div class="pan-bal">${this._balBox()}</div><span class="badge info" id="pan_dvno" title="N° de devis (définitif à la copie ou à la mise en attente)">Devis n° ${U.esc(this._shareData().no)}</span></div>` : ''}

        ${this._shortHTML()}
        <div class="kpi-row" id="pan_kpi" style="margin-bottom:16px;">
          <div class="kpi"><span class="kpi-val">${U.eur(this.budget)}</span><span class="kpi-label">Budget</span></div>
          ${this.livraison > 0 ? `<div class="kpi"><span class="kpi-val">− ${U.eur(this.livraison)}</span><span class="kpi-label">Livraison</span></div>` : ''}
          <div class="kpi"><span class="kpi-val">${U.eur(totalBasket)}</span><span class="kpi-label">Panier (${nbArticles} art.)</span></div>
        ${this._disc() > 0 ? `<div class="kpi"><span class="kpi-val">− ${U.eur(totalBasket * this._disc())}</span><span class="kpi-label">${U.esc(this._redLabel({ redCode: this.reductionCode, redPct: this.reduction }))}</span></div>` : ''}
          ${this._resteKPI(remaining)}
          ${this.basket.length ? (() => { const f = this._finData(), thr = U.num(Store.state.settings.b2bCoeffThreshold) || 1, bad = f.totProfit < 0 || (f.avgCoeff > 0 && f.avgCoeff < thr);
            return `<div class="kpi sensitive ${bad ? 'pan-kpi-bad' : 'pan-kpi-ok'}" title="Coefficient moyen = prix de vente HT ÷ coût de revient, pondéré par les quantités. Bénéfice net = marge − cotisations (détail plus bas)."><span class="kpi-val">${f.avgCoeff > 0 ? f.avgCoeff.toFixed(2).replace('.', ',') : '—'}</span><span class="kpi-label">Coeff moyen${(() => { const t = this._coeffTarget(); return t && f.avgCoeff > 0 ? ` (visé ${t.toFixed(2).replace('.', ',')})` : ''; })()} · ${f.totProfit >= 0 ? '+' : ''}${U.eur(f.totProfit)}</span></div>`; })() : ''}
        </div>

        ${this.basket.length ? `
        <div class="table-wrap"><table class="pan-tbl">
          <thead><tr>
            <th></th><th class="col-name">Produit</th><th>Variante</th><th>Viande</th>
            <th class="num">Prix TTC</th><th class="num">Qté</th><th class="num">Sous-total</th>
            <th>DLUO</th><th class="num">Coeff</th><th></th>
          </tr></thead>
          <tbody>${this.basket.map((b, i) => {
            const dogOpts = this._dogChoices();
            const daysLeft = U.daysTo(b.dluo);
            const dluoClass = daysLeft !== null && daysLeft < 0 ? 'bad' : daysLeft !== null && daysLeft <= 30 ? 'warn' : '';
            return `<tr${b.locked ? ' style="background:var(--th-bg);"' : ''}>
              <td class="pl-lk"><button class="btn-icon" onclick="Paniers.toggleLock(${i})" title="${b.locked ? 'Déverrouiller (sera remplacé à la régénération)' : 'Verrouiller (sera gardé à la régénération)'}">${b.locked ? '🔒' : '🔓'}</button></td>
              <td class="col-name">${U.esc(b.name)}${this._optSum(b)}${dogOpts.length ? `<div><select onchange="Paniers.setItemDog(${i},this.value)" title="Pour quel chien ? (vide = convient à tous, rien n'est affiché au client)"><option value="">🐕 tous</option>${dogOpts.concat(b.dog && !dogOpts.includes(b.dog) ? [b.dog] : []).map(n => `<option value="${U.esc(n)}" ${b.dog === n ? 'selected' : ''}>pour ${U.esc(n)}</option>`).join('')}</select></div>` : ''}</td>
              <td class="pl-var${b.kind !== 'A' && !b.variant ? ' pl-none' : ''}">${b.kind === 'A' ? `<button class="btn-ghost btn-sm" style="white-space:nowrap;" onclick="Paniers.itemOpts(${i})" title="Motif, couleurs de sangle, mousqueton, bouclerie, texte libre… (affichés sous le produit dans le devis, le ticket et la facture)">✏️ Détails</button>` : `<span class="tag">${U.esc(b.variant)}</span>`}</td>
              <td class="pl-meat">${b.kind === 'A' ? `<span class="badge info">🐕 ${U.esc(b.category || 'Accessoire')}</span>` : `<span class="badge info">${U.esc(b.meat || '—')}</span>`}</td>
              <td class="num pl-price"><input type="number" step="0.1" min="0" value="${(Math.round(U.num(b.price) * 100) / 100)}" style="width:84px;text-align:right;" title="Prix TTC modifiable pour ce panier (le prix du stock ne change pas)" onchange="Paniers.setItemPrice(${i},this.value)"></td>
              <td class="num pl-qty" style="white-space:nowrap;">
                <button class="btn-icon" onclick="Paniers.changeQty(${i},-1)">−</button>
                <input type="text" inputmode="numeric" value="${b.qty}" style="width:52px;text-align:center;font-weight:700;" title="Quantité : tape un nombre (0 = retirer du panier)" onfocus="this.select()" onchange="Paniers.setQty(${i},this.value)">
                <button class="btn-icon" onclick="Paniers.changeQty(${i},1)">+</button>
              </td>
              <td class="num pl-sub"><b>${U.eur(b.price * b.qty)}</b></td>
              <td class="pl-dluo${b.dluo ? '' : ' pl-none'}">${b.dluo ? `<span class="badge ${dluoClass}">${U.frDate(b.dluo)}${daysLeft !== null ? (daysLeft < 0 ? ` (périmé depuis ${-daysLeft} j)` : ` (${daysLeft} j)`) : ''}</span>` : '<span class="muted">—</span>'}</td>
              <td class="num pl-coef${b.coeff > 0 ? '' : ' pl-none'}">${b.coeff > 0 ? b.coeff.toFixed(2) : '<span class="muted">—</span>'}</td>
              <td class="pl-ac" style="white-space:nowrap;">${b.kind === 'A' ? `<button class="btn-icon" onclick="Paniers.dupItem(${i})" title="Dupliquer la ligne (même accessoire, autres couleurs / autre motif)">⧉</button>` : `<button class="btn-icon" onclick="Paniers.swapItem(${i})" title="Remplacer par un autre produit (il reste proposable)">🔄</button><button class="btn-icon" onclick="Paniers.excludeItem(${i})" title="Écarter : ne plus le proposer dans ce panier (remplacé tout de suite)">🚫</button>`}<button class="btn-icon" onclick="Paniers.removeItem(${i})" title="Retirer la ligne (pourra être reproposé par « Compléter »)">🗑️</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>

        ${this.kind === 'site'
          ? (remaining > 0.005 ? `<p class="warn-txt" style="margin-top:8px;">⚠️ Il manque ${U.eur(remaining * (1 - this._disc()))} pour atteindre le montant payé.</p>` : '')
          : (remaining < 0 ? '<p class="warn-txt" style="margin-top:8px;">⚠️ Le panier dépasse le budget disponible.</p>' : '')}
        ${this._ecartesHTML()}
        ${this._learnedHTML()}

        ${this._renderFinanceSummary()}
        ` : '<div class="empty" style="text-align:center;padding:40px;"><span class="big">🧺</span><p class="muted">Clique sur "Générer le panier" pour composer automatiquement,<br>ou ajoute des produits avec « Ajouter un produit ».</p></div>'}

        <div class="pan-mob" style="margin-top:12px;"><button class="btn-cta btn-sm" onclick="Paniers.openPicker()">➕ Ajouter un produit</button></div>
        <div class="pan-add-desk" style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-top:16px;">
          <div class="fg mb0" style="flex:0 0 150px;min-width:0;">
            <label style="white-space:nowrap;">Type</label>
            ${U.customSelect({ value: this.addKind || 'all', options: [{ v: 'all', l: 'Tout' }, { v: 'M', l: '🥩 Mastication' }, { v: 'A', l: '🐕 Accessoires' }], onPick: 'Paniers.setAddKind' })}
          </div>
          ${this.addKind === 'A' ? (() => {
            const accs = Accessoires.crafted(), cats = [...new Set(accs.map(a => a.category).filter(Boolean))].sort(U.sortFr), ws = [...new Set(accs.map(a => a.mainWidth || (a.strapWidths || [])[0] || '').filter(Boolean))].sort((a, b) => parseFloat(a) - parseFloat(b));
            const sel = (label, key, opts, w) => `<div class="fg mb0" style="flex:0 0 ${w}px;min-width:0;"><label style="white-space:nowrap;">${label}</label>${U.customSelect({ value: this[key], options: opts, onPick: 'Paniers._setAccF_' + key })}</div>`;
            return sel('Catégorie', 'addCat', [{ v: '', l: 'Toutes' }].concat(cats.map(c => ({ v: c, l: c }))), 120) + sel('Largeur', 'addWidth', [{ v: '', l: 'Toutes' }].concat(ws.map(w => ({ v: w, l: w }))), 100)
              + sel('Personnalisation', 'addPerso', [{ v: 'all', l: 'Toutes' }, { v: 'none', l: 'Sans' }, { v: 'uv', l: 'Impression UV' }, { v: 'theme', l: 'Création thème UV' }, { v: 'laser', l: 'Gravure laser' }], 165);
          })() : `<div class="fg mb0" style="min-width:160px;max-width:220px;">
            <label>Variantes</label>
            ${U.multiSelect({ groups: this.addVariantGroups(), selected: this.addVariants, toggle: 'Paniers.toggleAddVariant', setAll: 'Paniers.setAllAddVariant', open: this.addVariantsOpen, onOpen: 'Paniers.setAddVariantsOpen' })}
          </div>`}
          <div class="fg mb0" style="flex:${this.addKind === 'A' ? '1 1 100%' : '1'};min-width:200px;">
            <label>➕ Ajouter un produit</label>
            <div class="autocomplete" data-onclose="Paniers.closeAddMenu">
              <input id="pan_add_q" type="text" autocomplete="off" placeholder="Chercher un produit…"
                value="${U.esc(this.addQ)}" oninput="Paniers.setAddQ(this.value)" onfocus="Paniers.openAddMenu()">
            ${this.addOpen && addResults.length ? `<div class="ac-list" style="max-height:250px;overflow:auto;">${addResults.map(c =>
              `<div class="ac-item pp-row" onmousedown="event.preventDefault();Paniers.pickManual('${c.pId}','${c.vId}','${c.lotId}','${c.kind || 'M'}')"><span class="pp-a">${U.esc(c.name)} <span class="pp-v">${U.esc(c.kind === 'A' ? c.width : c.variant)}</span></span><span class="pp-b">${c.kind === 'A' ? '🐕 ' + U.esc(c.category) + (c.avail > 0 ? ' · stock ' + U.qty(c.avail) : ' · sans stock') : U.esc(c.meat)}${c.dluo ? ` · DLUO ${U.frDate(c.dluo)}` : ''}${c.coeff > 0 ? ` · <span class="sensitive">coeff ${c.coeff.toFixed(2)}</span>` : ''}</span><span class="pp-c">${U.eur(c.price)}</span></div>`
            ).join('')}</div>` : ''}
            </div>
          </div>
        </div>
        `}
      </div>
      </div>
    `);
  },

  /* Chiffres du panier (coût, marge, cotisations, bénéfice, coefficient moyen) : une seule définition pour le récapitulatif et la tuile du haut */
  _finData() {
    const S = Store.state.settings;
    const nbArticles = this.basket.reduce((a, b) => a + b.qty, 0);
    const fd = 1 - this._disc();   // réduction client : le prix encaissé baisse
    const rows = this.basket.map(b => {
      const acc = b.kind === 'A' ? Store.state.catalogA.find(x => x.id === b.pId) : null;   // accessoire : coût de la fiche, cotisations au taux « fait main »
      const sp = acc ? null : Store.state.stockM.find(x => x.id === b.pId);
      const sv = sp ? sp.variants.find(x => x.id === b.vId) : null;
      const rc = sp && sv ? Stock.refCalc(sp, sv) : null;   // fiche Prix mastication : même rang de palier que partout (avant : rang 0 pour tout)
      let cost = 0, priceHT = 0, priceTTC = 0, coeff = b.coeff;
      if (rc) {
        const calc = rc.calc;
        cost = calc.cost; priceHT = calc.priceHT; priceTTC = calc.priceTTC; coeff = calc.effCoeff;
      } else {
        const vat = U.num(S.vatRate) / 100;
        priceTTC = b.price;
        priceHT = b.price / (1 + vat);
        cost = acc ? U.num(Pricing.accCalc(acc).cost) : U.num(sv ? sv.costUnit : 0);
        if (!(coeff > 0) && cost > 0) coeff = priceHT / cost;   // produit sans fiche Prix mastication liée : coefficient calculé sur le coût du stock
      }
      if (fd < 1) { priceHT *= fd; priceTTC *= fd; }   // réduction client : le prix encaissé baisse, pas le coût
      // Même règle que les autres écrans : bénéfice « assujetti » (hors TVA) pour les totaux ; le gain réel non assujetti vient en plus.
      const rate = (acc ? Pricing.socialRateHandmade() : U.num(S.socialTaxRate)) / 100;
      const margin = priceHT - cost, social = priceHT * rate;
      const profit = margin - social;
      const profitActuel = priceTTC - cost - priceTTC * rate;
      return { ...b, cost, priceHT, margin, social, profit, profitActuel, coeff };
    });

    const valeur = rows.reduce((a, r) => a + r.price * r.qty, 0);   // valeur affichée au prix public (avant réduction client)
    const totVente = valeur * fd;
    const totCost = rows.reduce((a, r) => a + r.cost * r.qty, 0);
    const totMargin = rows.reduce((a, r) => a + r.margin * r.qty, 0);
    const totSocial = rows.reduce((a, r) => a + r.social * r.qty, 0);
    const totProfit = rows.reduce((a, r) => a + r.profit * r.qty, 0);
    const totActuel = rows.reduce((a, r) => a + r.profitActuel * r.qty, 0);
    const avgCoeff = nbArticles > 0 ? rows.reduce((a, r) => a + r.coeff * r.qty, 0) / nbArticles : 0;
    return { rows, nbArticles, fd, valeur, totVente, totCost, totMargin, totSocial, totProfit, totActuel, avgCoeff };
  },
  _renderFinanceSummary() {
    const S = Store.state.settings;
    const hasLocked = this.basket.some(b => b.locked);
    const { rows, nbArticles, fd, valeur, totVente, totCost, totMargin, totSocial, totProfit, totActuel, avgCoeff } = this._finData();
    const nViandes = [...new Set(this.basket.map(b => b.meat))].filter(Boolean).length;
    const nProduits = [...new Set(this.basket.map(b => b.pId))].length;
    const pm = this._payMode(), feeRate = pm === 'stripe' ? U.num(S.stripeFeeRate) : U.num(S.cardFeeRate);
    const feeName = (pm === 'stripe' ? 'Stripe' : 'SumUp') + ' (estimé)';
    const cbFee = totVente * feeRate / 100;

    return `<div style="margin-top:12px;padding:12px;background:var(--card-bg);border-radius:8px;border:1px solid var(--card-border);">
      <b>Récapitulatif :</b> ${nbArticles} article(s) · ${nViandes} viande(s) · ${nProduits} produit(s) différent(s)
      ${avgCoeff > 0 ? ` · <span class="sensitive"><b>Coeff moyen : ${avgCoeff.toFixed(2)}</b>${this._coeffTag(avgCoeff)}</span>` : ''}
      ${totCost > 0 && valeur > 0 ? ` · <span class="sensitive" title="Panier offert : la valeur affichée est celle au prix public ; le coût réel est le coût de revient des produits (fiche Prix mastication, frais de port d'achat estimés compris)">🎁 <b>Coût réel ${U.eur(totCost)}</b> pour ${U.eur(valeur)} de valeur affichée (${Math.round(totCost / valeur * 100)} %)</span>` : ''}
      ${this.nbChiens > 1 ? ` · × ${this.nbChiens} chiens` : ''}
      ${hasLocked ? ` · 🔒 ${this.basket.filter(b => b.locked).length} verrouillé(s)` : ''}
      ${this.basket.some(b => b.dluo && U.daysTo(b.dluo) <= 30) ? ` · <span class="badge warn">contient des DLUO proches</span>` : ''}
      ${this._untaggedHTML(this.basket)}
    </div>
    <details style="margin-top:12px;" ontoggle="this.open&&this.scrollIntoView({behavior:'smooth',block:'nearest'})">
      <summary style="cursor:pointer;font-weight:600;">📊 Détail financier du panier</summary>
      <div style="margin-top:8px;">
        <div class="kpi-row" style="margin-bottom:12px;">
          <div class="kpi"><span class="kpi-val">${U.eur(totVente)}</span><span class="kpi-label">Vente TTC</span></div>
          <div class="kpi sensitive"><span class="kpi-val">${U.eur(totCost)}</span><span class="kpi-label">Coût revient</span></div>
          <div class="kpi sensitive"><span class="kpi-val">${U.eur(totMargin)}</span><span class="kpi-label">Marge brute</span></div>
          <div class="kpi sensitive"><span class="kpi-val">${U.eur(totSocial)}</span><span class="kpi-label">Cotisations</span></div>
          <div class="kpi sensitive"><span class="kpi-val" style="color:var(--ok);">${U.eur(totProfit)}</span><span class="kpi-label">Bénéfice net</span></div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr>
            <th class="col-name">Produit</th><th>Variante</th><th class="num">Qté</th>
            <th class="num">Coût unit.</th><th class="num">Prix HT</th><th class="num">Marge</th>
            <th class="num">Cotis.</th><th class="num">Bénéf.</th><th class="num">Coeff</th>
          </tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td class="col-name">${U.esc(r.name)}</td>
            <td><span class="tag">${U.esc(r.variant)}</span></td>
            <td class="num">${r.qty}</td>
            <td class="num sensitive">${U.eur(r.cost)}</td>
            <td class="num sensitive">${U.eur(r.priceHT)}</td>
            <td class="num sensitive">${U.eur(r.margin * r.qty)}</td>
            <td class="num sensitive">${U.eur(r.social * r.qty)}</td>
            <td class="num sensitive" style="color:var(--ok);font-weight:600;">${U.eur(r.profit * r.qty)}</td>
            <td class="num sensitive">${r.coeff > 0 ? r.coeff.toFixed(2) : '—'}</td>
          </tr>`).join('')}
          <tr style="border-top:2px solid var(--card-border);font-weight:700;">
            <td colspan="3">Total</td>
            <td class="num sensitive">${U.eur(totCost)}</td>
            <td class="num"></td>
            <td class="num sensitive">${U.eur(totMargin)}</td>
            <td class="num sensitive">${U.eur(totSocial)}</td>
            <td class="num sensitive" style="color:var(--ok);">${U.eur(totProfit)}</td>
            <td class="num sensitive">${avgCoeff > 0 ? avgCoeff.toFixed(2) : ''}</td>
          </tr></tbody>
        </table></div>
        <p class="muted sensitive" style="margin-top:6px;font-size:.82rem;">Commission ${feeName} : ${U.eur(cbFee)} (${U.pct(feeRate)}) · Bénéfice après frais : ${U.eur(totProfit - cbFee)}${S.vatActive ? '' : ` · Gain réel aujourd'hui (TVA conservée) : ${U.eur(totActuel - cbFee)}`}</p>
      </div>
    </details>`;
  },

  setLivraisonQuick(v) {
    this.livraison = v;
    this.render();
  }
};

window.addEventListener('storage', e => { if (e.key === Paniers._DK) Paniers._adoptDraft(e.newValue); });

/* Valeurs d'origine de la configuration (avant toute valeur mémorisée) : sert à « repartir comme pour un nouveau panier » */
Paniers._cfgDefaults = JSON.parse(JSON.stringify(['budget', 'livraison', 'reduction', 'reductionCode', 'nbChiens', 'priority', 'excludeMeats', 'excludeProducts', 'poilFilter', 'hypoOnly', 'resistanceInclude', 'typeFilter', 'ageInclude', 'gabaritInclude', 'odeurInclude', 'grasInclude', 'maxPerProduct', 'risks', 'kind', 'races'].reduce((o, k) => { o[k] = Paniers[k]; return o; }, {})));

/* Menus de filtre des accessoires dans « Ajouter un produit » (U.customSelect appelle une fonction globale par son nom) */
['addCat', 'addWidth', 'addPerso'].forEach(k => { Paniers['_setAccF_' + k] = function (v) { this.setAddFilter(k, v); }; });
