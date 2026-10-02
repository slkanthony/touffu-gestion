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
  nbChiens: 1,
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
  paymentMode: 'sumup', // 'sumup' | 'stripe' | 'virement'
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
  addVariantsOpen: false,
  proposals: null,
  client: '',   // cliente choisie avant de générer : sa fiche (viandes évitées, allergies, poils, odeurs, gras) filtre les produits

  /* ---------- Fusion tags variante → produit ---------- */
  _mergeTags(pTags, vTags) {
    const pt = pTags || {};
    const vt = vTags || {};
    return {
      poil: pt.poil || '',
      hypo: pt.hypo || false,
      // Poil, hypo, résistance, type, odeur, gras : toujours ceux du PRODUIT (identiques pour toutes
      // les tailles, demande d'Antho 2026-09-29) ; seuls âge et gabarit peuvent varier par variante.
      resistance: pt.resistance || '',
      type: pt.type || '',
      odeur: pt.odeur || '',
      gras: pt.gras || '',
      age: (vt.age && vt.age.length) ? vt.age : (pt.age || []),
      gabarit: (vt.gabarit && vt.gabarit.length) ? vt.gabarit : (pt.gabarit || [])
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
    if (!String(this.client || '').trim()) return 'Sa fiche (viandes évitées, allergies, poils, odeurs fortes, gras) filtre automatiquement les produits à la génération.';
    if (Clients.ro()) return '';
    const r = this._clientRules();
    if (!r) return 'Pas de fiche pour cette cliente : aucun filtre appliqué (elle sera créée à la vente).';
    if (!r.dogs.length) return 'Fiche sans chien renseigné : aucun filtre appliqué.';
    if (this._perDog()) {
      const per = this._dogList().map(d => {
        const av = Object.keys(d.meats || {}).filter(m => d.meats[m] === 'avoid'), ex = [].concat(d.sensitive ? ['sensible'] : [], av.length ? ['évite : ' + av.join(', ')] : [], d.hair === 'non' ? ['pas de poils'] : [], d.odor === 'non' ? ['pas d\'odeurs fortes'] : [], d.fat === 'non' ? ['pas de gras'] : []);
        return d._n + (ex.length ? ' (' + ex.join(', ') + ')' : '');
      });
      return '🐕 ' + per.join(' · ') + ' → panier composé chien par chien (budget partagé) ; un produit pensé pour un seul chien est annoté « pour … », tu peux le changer.';
    }
    const avoid = [...new Set(r.dogs.flatMap(d => Object.keys(d.meats || {}).filter(m => d.meats[m] === 'avoid')))];
    const allergies = [...new Set(r.dogs.map(d => String(d.allergies || '').trim()).filter(Boolean))];
    const parts = [].concat(r.sensitive ? ['🌿 sensible : « Hypoallergénique uniquement » coché'] : [], avoid.length ? ['évite : ' + avoid.join(', ')] : [], allergies.length ? ['allergies : ' + allergies.join(' · ')] : [], r.hair ? ['pas de produits avec poils'] : [], r.odor ? ['pas d\'odeurs fortes'] : [], r.fat ? ['pas de produits gras'] : []);
    return '🐕 ' + r.dogs.map(d => d.name || 'chien').join(', ') + ' — ' + (parts.length ? parts.join(' · ') + ' → exclus à la génération' : 'aucune contrainte renseignée');
  },
  /* ---------- Panier chien par chien (cliente avec 2 chiens ou plus aux profils différents) ---------- */
  _dogList() { const r = this._clientRules(); return r ? r.dogs.map((d, i) => Object.assign({}, d, { _n: String(d.name || '').trim() || 'Chien ' + (i + 1) })) : []; },
  _dogAges(d) {   // tranche d'âge de la fiche (naissance) → valeurs du filtre « Âge du chien » ; null si inconnue
    if (!d.birth) return null; const b = new Date(d.birth), n = new Date(); if (isNaN(b)) return null;
    let m = (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth(); if (n.getDate() < b.getDate()) m--;
    if (m < 0) return null;
    return m < 3 ? ['0-3'] : m < 6 ? ['3-5'] : m < 11 ? ['6-10'] : m >= 96 ? ['11+', 'senior'] : ['11+'];
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
    if (d.sensitive && !pTags.hypo) return false;
    const da = this._dogAges(d);
    if (da && tags.age.length > 0 && !tags.age.some(x => da.includes(x))) return false;
    if (d.gabarit && tags.gabarit.length > 0 && !tags.gabarit.includes(d.gabarit)) return false;
    return true;
  },
  /* Étiquette « pour X » : seulement si le produit ne convient pas à tous les chiens */
  _dogTag(c) { return c && c.forDogs && c.forDogs.length < this._dogList().length ? c.forDogs.join(' et ') : ''; },
  _dogChoices() { return Clients.ro() ? [] : this._dogList().map(d => d._n); },
  setItemDog(i, v) { if (this.basket[i]) { this.basket[i].dog = v; this.render(); } },
  setClient(v) {
    v = String(v || '').trim();
    const c = Clients.find(v);
    this.client = c ? c.name : v;
    if (c && (c.dogs || []).length) this.nbChiens = c.dogs.length;
    const sens = c && !Clients.ro() && (c.dogs || []).some(d => d.sensitive) && !this._perDog();
    if (sens) this.hypoOnly = true;
    this.render();
    if (sens) U.toast('Chien sensible : « Hypoallergénique uniquement » est coché — décoche-le dans les filtres si besoin.');
  },

  /* ---------- Données disponibles ---------- */
  candidates() {
    const out = [];
    const pd = this._perDog() ? this._dogList() : null;   // profils différents : on regarde, pour chaque produit, quels chiens peuvent le manger
    const cl = pd ? null : this._clientRules();

    Store.state.stockM.forEach(p => {
      if (this.excludeMeats.includes(p.meatType)) return;
      if (this.excludeProducts.includes(p.id)) return;

      const pTags = p.tags || {};
      if (this.poilFilter === 'avec' && pTags.poil !== 'avec' && pTags.poil !== 'les_deux') return;
      if (this.poilFilter === 'sans' && pTags.poil !== 'sans' && pTags.poil !== 'les_deux') return;
      if (this.hypoOnly && !pTags.hypo) return;
      if (cl) {
        if (Clients.conflictsFor(cl.dogs, { kind: 'M', type: p.meatType || '', name: p.name }).length) return;
        if (cl.hair && pTags.poil === 'avec') return;
      }

      p.variants.forEach(v => {
        if (v.mode === 'vrac') return;
        const cat = Store.state.catalogM.find(c => c.id === (v.catalogId || p.catalogId));

        const tags = this._mergeTags(pTags, Stock.variantTags(p, v));
        if (cl && ((cl.odor && tags.odeur === 'forte') || (cl.fat && tags.gras === 'gras'))) return;

        if (this.resistanceInclude.length) {
          const r = tags.resistance;
          if (r && !this.resistanceInclude.includes(r)) return;
        }
        if (this.typeFilter !== 'all' && tags.type && tags.type !== this.typeFilter) return;
        if (this.odeurInclude.length && tags.odeur && !this.odeurInclude.includes(tags.odeur)) return;
        if (this.grasInclude.length && tags.gras && !this.grasInclude.includes(tags.gras)) return;
        if (this.ageInclude.length && tags.age.length > 0 && !tags.age.some(a => this.ageInclude.includes(a))) return;
        if (this.gabaritInclude.length && tags.gabarit.length > 0 && !tags.gabarit.some(g => this.gabaritInclude.includes(g))) return;
        let suits = null;
        if (pd) { suits = pd.filter(d => this._dogSuits(d, p, pTags, tags)); if (!suits.length) return; }

        const lots = v.lots.filter(l => {
          const q = U.num(l.qtyGeneral) + U.num(l.qtyEvent);
          if (q <= 0) return false;
          const d = U.daysTo(l.dluo);
          // les lots périmés restent candidats (paniers pour associations) : ils passent en tête grâce au score de DLUO
          return true;
        });
        if (!lots.length) return;

        const price = U.num(v.priceTTC);
        if (price <= 0) return;

        let coeff = 0;
        if (cat) {
          const cv = v.catalogVariantId ? (cat.variants || []).find(x => x.id === v.catalogVariantId) : null;
          if (cv) {
            const base = Pricing.baseUnitCost(cat);
            const calc = Pricing.variantCalc(cat, cv, 0, base);
            coeff = calc.effCoeff || 0;
          }
        }

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
            ...(suits ? { forDogs: suits.map(d => d._n), ages: (x => x.length ? x : undefined)([...new Set(suits.flatMap(d => this._dogAges(d) || []))]), gabs: (x => x.length ? x : undefined)([...new Set(suits.map(d => d.gabarit).filter(Boolean))]) } : {})
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
    return basket.some((b, i) => i !== skipIdx && this._famOf(b) === c.family && b.vId !== c.vId);
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
    const t = (c.tags && c.tags.type) || '';
    if (t === 'occupation') return 1.0;
    if (t === 'education') return 0.2;
    return 0.6;
  },

  _meatAgePrefScore(c) {
    const ages = c.ages || this.ageInclude;
    if (!ages.length || (ages.length === 1 && ages[0] === '11+')) return 0.5;
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
    const gabs = c.gabs || this.gabaritInclude;
    if (!gabs.length) return 0.5;
    const r = (c.tags && c.tags.resistance) || '';
    if (!r) return 0.5;
    const hasGrand = gabs.includes('grand');
    const hasMoyen = gabs.includes('moyen');
    const hasPetit = gabs.includes('petit');
    if (hasGrand && !hasPetit) {
      if (r === 'forte' || r === 'tres-forte') return 1.0;
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
    const n = b.gram + b.vrac, hard = ['forte', 'tres-forte'].includes((c.tags && c.tags.resistance) || '');
    if (hard && !b.hard && n >= 2) return 1;
    if (!n) return 0.5;
    const gs = b.gram / n;
    return c.mode === 'gram' ? 1 - gs : gs;
  },
  _itemScore(c, usedProducts, usedMeats, maxDays, maxCoeff, weights, mult) {
    const dluoScore = c.daysLeft >= 9999 ? 0.1 : Math.max(0, 1 - c.daysLeft / maxDays);
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
    return 0.12 * this._balScore(c) + weights.dluo * dluoScore + weights.coeff * coeffScore + weights.div * divScore + weights.size * sizeScore + weights.type * typeScore + weights.meat * meatScore + weights.gab * gabScore + weights.hypoGras * hypoGrasScore;
  },

  _buildBasket(maxAvailable, lockedItems) {
    const cands = this.candidates();
    const basket = lockedItems.map(b => ({...b}));
    let spent = basket.reduce((a, b) => a + b.price * b.qty, 0);
    if (!cands.length) return basket;

    const maxDays = Math.max(...cands.map(c => c.daysLeft), 1);
    const maxCoeff = Math.max(...cands.map(c => c.coeff), 1);

    const weights = this.priority === 'dluo' ? { dluo: 0.34, coeff: 0.06, div: 0.14, size: 0.08, type: 0.10, meat: 0.10, gab: 0.10, hypoGras: 0.08 }
      : this.priority === 'coeff' ? { dluo: 0.06, coeff: 0.34, div: 0.14, size: 0.08, type: 0.10, meat: 0.10, gab: 0.10, hypoGras: 0.08 }
      : { dluo: 0.18, coeff: 0.18, div: 0.14, size: 0.08, type: 0.14, meat: 0.10, gab: 0.10, hypoGras: 0.08 };

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

    const score = (c) => this._itemScore(c, usedProducts, usedMeats, maxDays, maxCoeff, weights, mult);

    for (let i = 0; i < 500; i++) {
      const affordable = cands.filter(c => c.price <= maxAvailable - spent && c.avail > 0);
      if (!affordable.length) break;

      const productQties = {};
      basket.forEach(b => { productQties[b.pId] = (productQties[b.pId] || 0) + b.qty; });
      let eligible = affordable.filter(c => {
        const mu = c.forDogs ? c.forDogs.length : mult;   // chiens concernés par ce produit
        if ((productQties[c.pId] || 0) >= this.maxPerProduct * mu) return false;
        if (c.mode === 'gram' && (mu > 1 || c.forDogs) && basket.some(b => b.pId === c.pId)) return false;   // un sachet (plusieurs morceaux) suffit : pas deux fois le même produit au gramme
        if (c.forDogs && c.forDogs.length === 1 && (spentBy[c.forDogs[0]] || 0) + c.price > shareCap) return false;
        return !this._famTaken(c, basket);
      });
      const hardInBasket = basket.some(b => {
        const sp = Store.state.stockM.find(x => x.id === b.pId);
        if (!sp) return false;
        const sv = sp.variants.find(x => x.id === b.vId);
        const mt = this._mergeTags(sp.tags, sv ? Stock.variantTags(sp, sv) : null);
        return ['forte', 'tres-forte'].includes(mt.resistance);
      });
      if (hardInBasket) eligible = eligible.filter(c => !['forte', 'tres-forte'].includes(c.tags.resistance));
      if (!eligible.length) break;
      const gramN = basket.filter(b => { const sp = Store.state.stockM.find(x => x.id === b.pId), sv = sp && sp.variants.find(x => x.id === b.vId); return sv && sv.mode === 'gram'; }).length;
      this._bal = { gram: gramN, vrac: basket.length - gramN, hard: hardInBasket };
      // Alternance gramme / vrac : on prend le format le moins représenté tant qu'il en reste dans le budget
      { const vracN = basket.length - gramN, want = gramN > vracN ? 'vrac' : gramN < vracN ? 'gram' : '', f = want ? eligible.filter(c => (c.mode === 'gram') === (want === 'gram')) : []; if (f.length) eligible = f; }

      // Plusieurs chiens : on élargit d'abord la gamme (produits pas encore dans le panier) avant de remettre un produit déjà choisi
      if (mult > 1 || nd) { const fresh = eligible.filter(c => !usedProducts.has(c.pId)); if (fresh.length) eligible = fresh; }
      eligible.sort((a, b) => score(b) - score(a));
      const pick = eligible[0];

      const existing = basket.find(b => b.pId === pick.pId && b.vId === pick.vId && b.lotId === pick.lotId);
      if (existing) {
        existing.qty++;
      } else {
        basket.push({
          pId: pick.pId, vId: pick.vId, lotId: pick.lotId,
          name: pick.name, meat: pick.meat, variant: pick.variant,
          price: pick.price, qty: 1, dluo: pick.dluo, daysLeft: pick.daysLeft,
          coeff: pick.coeff, lotNumber: pick.lotNumber, locked: false, family: pick.family, dog: this._dogTag(pick)
        });
      }
      if (pick.forDogs && pick.forDogs.length === 1) spentBy[pick.forDogs[0]] = (spentBy[pick.forDogs[0]] || 0) + pick.price;

      spent += pick.price;
      pick.avail--;
      usedProducts.add(pick.pId);
      usedMeats[pick.meat] = (usedMeats[pick.meat] || 0) + 1;
    }

    this._bal = null;
    return basket;
  },

  generate() {
    const available = this._avail();
    if (available <= 0) { U.toast('Le budget disponible (après livraison) est nul ou négatif.', true); return; }
    if (!this.candidates().length) { U.toast('Aucun produit ne correspond aux filtres.', true); return; }

    // Les produits ajoutés à la main (locked:true via pickManual) — et tout item verrouillé —
    // servent de BASE : la génération complète le panier autour d'eux au lieu de les écraser
    // (demande d'Antho : un produit ajouté avant de générer doit rester la base du panier).
    const locked = this.basket.filter(b => b.locked).map(b => ({ ...b }));
    const b1 = this._compose(available, locked);
    const b2 = this._compose(available + 1, locked);
    const t1 = b1.reduce((a, b) => a + b.price * b.qty, 0);
    const t2 = b2.reduce((a, b) => a + b.price * b.qty, 0);

    const n1 = b1.reduce((a, b) => a + b.qty, 0);
    const n2 = b2.reduce((a, b) => a + b.qty, 0);

    if (!n1 && !n2) {
      this.proposals = null; this.basket = [];
      this.render();
      U.toast('Impossible de composer un panier avec ces contraintes.', true);
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
  regenerate() {
    const available = this._avail();
    if (available <= 0) { U.toast('Le budget disponible (après livraison) est nul ou négatif.', true); return; }

    const locked = this.basket.filter(b => b.locked).map(b => ({...b}));
    const b1 = this._compose(available, locked);
    const b2 = this._compose(available + 1, locked);
    const t1 = b1.reduce((a, b) => a + b.price * b.qty, 0);
    const t2 = b2.reduce((a, b) => a + b.price * b.qty, 0);

    const n1 = b1.reduce((a, b) => a + b.qty, 0);
    const n2 = b2.reduce((a, b) => a + b.qty, 0);

    if (!n1 && !n2) {
      this.proposals = null; this.basket = [];
      this.render();
      U.toast('Impossible de composer un panier avec ces contraintes.', true);
    } else if (n1 > 0 && t2 > t1 + 0.005) {
      this.proposals = [b1, b2];
      this.basket = [];
      this.render();
      U.toast('2 propositions régénérées — choisis celle qui convient');
    } else {
      this.proposals = null;
      this.basket = n1 > 0 ? b1 : b2;
      this.render();
      const n = this.basket.reduce((a, b) => a + b.qty, 0);
      U.toast(`Panier régénéré : ${n} article(s)`);
    }
  },

  /* ---------- Actions manuelles sur le panier ---------- */
  removeItem(idx) {
    this.basket.splice(idx, 1);
    this.render();
  },
  changeQty(idx, delta) {
    const item = this.basket[idx];
    if (!item) return;
    item.qty = Math.max(0, item.qty + delta);
    if (item.qty <= 0) this.basket.splice(idx, 1);
    this.render();
    if (delta > 0) this._stockWarn(item.pId, item.vId);
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
    if (!this.excludeProducts.includes(item.pId)) this.excludeProducts.push(item.pId);

    const otherTotal = this.basket.reduce((a, b, i) => i === idx ? a : a + b.price * b.qty, 0);
    const maxPrice = this._avail() - otherTotal;
    const cands = this.candidates();

    this.basket.forEach((b, i) => {
      if (i === idx) return;
      const c = cands.find(x => x.pId === b.pId && x.vId === b.vId && x.lotId === b.lotId);
      if (c) c.avail = Math.max(0, c.avail - b.qty);
    });

    let eligible = cands.filter(c => c.price <= maxPrice && c.avail > 0 && !this._famTaken(c, this.basket, idx));
    const otherHard = this.basket.some((b, j) => {
      if (j === idx) return false;
      const sp = Store.state.stockM.find(x => x.id === b.pId);
      if (!sp) return false;
      const sv = sp.variants.find(x => x.id === b.vId);
      const mt = this._mergeTags(sp.tags, sv ? Stock.variantTags(sp, sv) : null);
      return ['forte', 'tres-forte'].includes(mt.resistance);
    });
    if (otherHard) eligible = eligible.filter(c => !['forte', 'tres-forte'].includes(c.tags.resistance));

    if (!eligible.length) {
      this.basket.splice(idx, 1);
      this.render();
      U.toast(`${oldName} exclu — aucun remplacement trouvé`);
      return;
    }

    const maxDays = Math.max(...cands.map(c => c.daysLeft), 1);
    const maxCoeff = Math.max(...cands.map(c => c.coeff), 1);
    const weights = this.priority === 'dluo' ? { dluo: 0.34, coeff: 0.06, div: 0.14, size: 0.08, type: 0.10, meat: 0.10, gab: 0.10, hypoGras: 0.08 }
      : this.priority === 'coeff' ? { dluo: 0.06, coeff: 0.34, div: 0.14, size: 0.08, type: 0.10, meat: 0.10, gab: 0.10, hypoGras: 0.08 }
      : { dluo: 0.18, coeff: 0.18, div: 0.14, size: 0.08, type: 0.14, meat: 0.10, gab: 0.10, hypoGras: 0.08 };
    const mult = Math.max(1, this.nbChiens);
    const usedProducts = new Set();
    const usedMeats = {};
    this.basket.forEach((b, i) => {
      if (i === idx) return;
      usedProducts.add(b.pId);
      usedMeats[b.meat] = (usedMeats[b.meat] || 0) + b.qty;
    });

    eligible.sort((a, b) => {
      const sa = this._itemScore(a, usedProducts, usedMeats, maxDays, maxCoeff, weights, mult);
      const sb = this._itemScore(b, usedProducts, usedMeats, maxDays, maxCoeff, weights, mult);
      return sb - sa;
    });

    const pick = eligible[0];
    this.basket[idx] = {
      pId: pick.pId, vId: pick.vId, lotId: pick.lotId,
      name: pick.name, meat: pick.meat, variant: pick.variant,
      price: pick.price, qty: 1, dluo: pick.dluo, daysLeft: pick.daysLeft,
      coeff: pick.coeff, lotNumber: pick.lotNumber, locked: false, family: pick.family, dog: this._dogTag(pick)
    };
    this.render();
    U.toast(`${oldName} exclu → ${pick.name}`);
  },
  swapItem(idx) {
    const item = this.basket[idx];
    if (!item) return;

    const otherTotal = this.basket.reduce((a, b, i) => i === idx ? a : a + b.price * b.qty, 0);
    const maxPrice = this._avail() - otherTotal;

    const cands = this.candidates();
    if (!cands.length) { U.toast('Aucun produit disponible.', true); return; }

    this.basket.forEach((b, i) => {
      if (i === idx) return;
      const c = cands.find(x => x.pId === b.pId && x.vId === b.vId && x.lotId === b.lotId);
      if (c) c.avail = Math.max(0, c.avail - b.qty);
    });

    // Historique des produits déjà refusés pour CE créneau : chaque clic sur 🔄 ajoute
    // le produit courant à la liste et l'exclut des candidats → « remplacer » propose
    // toujours du NOUVEAU, ne revient jamais à un produit déjà écarté (demande d'Antho).
    const rejected = Array.isArray(item._swapRejected) ? item._swapRejected.slice() : [];
    if (!rejected.includes(item.pId)) rejected.push(item.pId);

    const otherHard = this.basket.some((b, j) => {
      if (j === idx) return false;
      const sp = Store.state.stockM.find(x => x.id === b.pId);
      if (!sp) return false;
      const sv = sp.variants.find(x => x.id === b.vId);
      const mt = this._mergeTags(sp.tags, sv ? Stock.variantTags(sp, sv) : null);
      return ['forte', 'tres-forte'].includes(mt.resistance);
    });
    const eligibleFor = rej => {
      let e = cands.filter(c => c.price <= maxPrice && c.avail > 0 && !rej.includes(c.pId) && !this._famTaken(c, this.basket, idx));
      if (otherHard) e = e.filter(c => !['forte', 'tres-forte'].includes(c.tags.resistance));
      return e;
    };
    let eligible = eligibleFor(rejected);
    // Toutes les autres options ont déjà été refusées dans cette série : on repart d'une
    // liste neuve (n'exclut que le produit courant) plutôt que de rester bloqué.
    if (!eligible.length) { rejected.length = 0; rejected.push(item.pId); eligible = eligibleFor(rejected); }
    if (!eligible.length) { U.toast('Aucun remplacement trouvé dans le budget restant.', true); return; }

    const usedProducts = new Set();
    const usedMeats = {};
    this.basket.forEach((b, i) => {
      if (i === idx) return;
      usedProducts.add(b.pId);
      usedMeats[b.meat] = (usedMeats[b.meat] || 0) + b.qty;
    });

    const maxDays = Math.max(...cands.map(c => c.daysLeft), 1);
    const maxCoeff = Math.max(...cands.map(c => c.coeff), 1);
    const weights = this.priority === 'dluo' ? { dluo: 0.34, coeff: 0.06, div: 0.14, size: 0.08, type: 0.10, meat: 0.10, gab: 0.10, hypoGras: 0.08 }
      : this.priority === 'coeff' ? { dluo: 0.06, coeff: 0.34, div: 0.14, size: 0.08, type: 0.10, meat: 0.10, gab: 0.10, hypoGras: 0.08 }
      : { dluo: 0.18, coeff: 0.18, div: 0.14, size: 0.08, type: 0.14, meat: 0.10, gab: 0.10, hypoGras: 0.08 };
    const mult = Math.max(1, this.nbChiens);

    eligible.sort((a, b) => {
      const sa = this._itemScore(a, usedProducts, usedMeats, maxDays, maxCoeff, weights, mult);
      const sb = this._itemScore(b, usedProducts, usedMeats, maxDays, maxCoeff, weights, mult);
      return sb - sa;
    });

    const pick = eligible[0];
    const oldName = item.name;
    this.basket[idx] = {
      pId: pick.pId, vId: pick.vId, lotId: pick.lotId,
      name: pick.name, meat: pick.meat, variant: pick.variant,
      price: pick.price, qty: 1, dluo: pick.dluo, daysLeft: pick.daysLeft,
      coeff: pick.coeff, lotNumber: pick.lotNumber, locked: false, family: pick.family, dog: this._dogTag(pick),
      _swapRejected: rejected // mémorise la série de refus pour les prochains 🔄 sur ce créneau
    };
    this.render();
    U.toast(`${oldName} → ${pick.name}`);
  },
  /* Fenêtre « client » : produit, variante, prix TTC seulement (pas de coeff, DLUO, viande…) — pour capture d'écran ou copie du texte */
  _shareData() {
    const dn = this._dogChoices();
    const lines = this.basket.map(b => ({ name: b.name, variant: b.variant, qty: b.qty, total: b.price * b.qty, unit: b.price, dog: (b.dog && dn.length >= 2) ? b.dog : '' }));
    const sub = lines.reduce((a, l) => a + l.total, 0);
    const ship = this.livraison > 0 ? this.livraison : 0;
    const red = this._disc() > 0 ? Math.round(sub * this._disc() * 100) / 100 : 0;
    const pre = sub - red + ship, bal = Clients.balanceOf(this._shClient || this.client);
    const av = this._balOn !== false && bal > 0 ? Math.round(Math.min(bal, Math.max(0, pre)) * 100) / 100 : 0;   // avoir déduit
    const det = this._balOn !== false && bal < 0 ? -bal : 0;   // dette à régler
    // n° de devis : prévu tant que rien n'est sorti ; lettre suivante si le contenu a changé depuis la dernière sortie (voir devis.js)
    const h = Devis.hash({ l: lines.map(l => [l.name, l.variant, l.qty, l.unit, l.dog]), r: red, s: ship, a: av, t: det, m: this._shMode || '' });
    if (!this._dv) this._dv = Devis.blank();
    return { lines, sub, red, redPct: this.reduction, ship, av, det, bal, total: pre - av + det, no: Devis.show(this._dv, h), h, x: this._shareExtras() };
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
    return { pay, ibanLines, msg, who, valid, mode, refHint };
  },
  /* Sortie du devis (copie image / texte, mise en attente) : le numéro devient définitif, la lettre avance si le contenu a changé */
  _dvCommit() {
    if (!this._dv) this._dv = Devis.blank();
    const no = Devis.commit(this._dv, this._shareData().h);
    this._draft(); this._shareRefresh();
    return no;
  },
  _shareInner(d) {
    const rows = d.lines.map(l => `<tr><td style="padding:7px 10px;text-align:left;font-weight:700;">${U.esc(l.name)}${l.dog ? `<div style="font-weight:600;font-size:.85rem;color:var(--caramel);">→ pour ${U.esc(l.dog)}</div>` : ''}</td><td style="padding:7px 10px;text-align:center;">${U.esc(l.variant || '')}</td><td style="padding:7px 10px;text-align:center;font-weight:700;">${U.qty(l.qty)}</td><td style="padding:7px 10px;text-align:right;white-space:nowrap;">${U.eur(l.unit)}</td><td style="padding:7px 10px;text-align:right;font-weight:700;white-space:nowrap;">${U.eur(l.total)}</td></tr>`).join('');
    const x = d.x;
    return `${d.no ? `<p style="margin:0 10px 6px;font-weight:800;">Devis n° ${U.esc(d.no)}</p>` : ''}${x.who ? `<p style="margin:0 10px 8px;font-weight:700;color:var(--caramel);">${U.esc(x.who)}</p>` : ''}<table style="width:100%;border-collapse:collapse;font-size:1rem;">
        <thead><tr style="border-bottom:2px solid var(--caramel);"><th style="padding:7px 10px;text-align:left;">Produit</th><th style="padding:7px 10px;text-align:center;">Variante</th><th style="padding:7px 10px;text-align:center;">Qté</th><th style="padding:7px 10px;text-align:right;">Prix unit.</th><th style="padding:7px 10px;text-align:right;">Sous-total</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          ${d.red > 0 ? `<tr style="border-top:1px solid var(--card-border);"><td colspan="4" style="padding:7px 10px;text-align:right;">Réduction (${U.qty(d.redPct)} %)</td><td style="padding:7px 10px;text-align:right;white-space:nowrap;">− ${U.eur(d.red)}</td></tr>` : ''}
          ${d.ship > 0 ? `<tr style="border-top:1px solid var(--card-border);"><td colspan="4" style="padding:7px 10px;text-align:right;">Livraison</td><td style="padding:7px 10px;text-align:right;white-space:nowrap;">${U.eur(d.ship)}</td></tr>` : ''}
          ${d.av > 0 ? `<tr style="border-top:1px solid var(--card-border);"><td colspan="4" style="padding:7px 10px;text-align:right;">Avoir déduit</td><td style="padding:7px 10px;text-align:right;white-space:nowrap;">− ${U.eur(d.av)}</td></tr>` : ''}
          ${d.det > 0 ? `<tr style="border-top:1px solid var(--card-border);"><td colspan="4" style="padding:7px 10px;text-align:right;">Solde à régler</td><td style="padding:7px 10px;text-align:right;white-space:nowrap;">+ ${U.eur(d.det)}</td></tr>` : ''}
          <tr style="border-top:2px solid var(--caramel);"><td colspan="4" style="padding:9px 10px;text-align:right;font-weight:800;font-size:1.1rem;">Total TTC</td><td style="padding:9px 10px;text-align:right;font-weight:800;font-size:1.1rem;white-space:nowrap;">${U.eur(d.total)}</td></tr>
        </tfoot>
      </table>
      ${x.mode ? `<p style="margin:10px 10px 0;font-weight:700;">${U.esc(x.mode)}</p>` : ''}
      ${x.valid ? `<p style="margin:10px 10px 0;font-style:italic;">${U.esc(x.valid)}</p>` : ''}
      ${x.pay ? `<p style="margin:12px 10px 0;">${U.esc(x.pay)}</p>` : ''}
      ${x.ibanLines.length ? `<p style="margin:8px 10px 0;font-weight:700;">${x.ibanLines.map(U.esc).join('<br>')}</p>` : ''}
      ${x.refHint ? `<p style="margin:6px 10px 0;font-style:italic;">${U.esc(x.refHint)}</p>` : ''}
      ${x.msg ? `<p style="margin:10px 10px 0;white-space:pre-wrap;">${U.esc(x.msg)}</p>` : ''}`;
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
    const b = (m, label) => `<button class="btn-ghost btn-sm${this._shMode === m ? ' active' : ''}" onclick="Paniers._setMode('${m}')">${label}</button>`;
    return b('cc', '🏬 Click & Collect') + b('liv', '📦 Livraison');
  },
  _setMode(m) {   // re-clic = on décoche ; Click & Collect = pas de frais de livraison, Livraison = frais habituels si aucun frais n'est saisi
    this._shMode = this._shMode === m ? '' : m;
    const S = Store.state.settings;
    if (this._shMode === 'cc') this.livraison = 0;
    else if (this._shMode === 'liv' && !this.livraison) this.livraison = U.num(S.shippingCost ?? 6.8);
    document.querySelectorAll('.pan-mode').forEach(bx => { bx.innerHTML = this._modeBtns(); });   // fenêtre « Partager » ET barre du panier composé
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
    const body = `<div id="pan_share" style="padding:4px 2px;">${this._shareInner(this._shareData())}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;justify-content:center;">
        <button class="btn-ghost btn-sm" onclick="Paniers.shareImage('copy')">🖼️ Copier l'image</button>
        <button class="btn-ghost btn-sm" onclick="Paniers.shareImage('save')">⬇ Enregistrer l'image</button>
      </div>
      <div style="margin-top:14px;padding-top:10px;border-top:1px dashed var(--card-border);">
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">Mode de remise (affiché sur le devis)</div>
        <div class="pan-mode" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">${this._modeBtns()}</div>
        <div class="pan-bal">${this._balBox()}</div>
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">Afficher sur ce panier</div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">${chk('who', 'Nom de la cliente et des chiens')}${hasPay ? chk('pay', 'Moyens de paiement') : ''}${hasIban ? chk('iban', 'IBAN') : ''}${!hasPay && !hasIban ? '<span class="muted" style="font-size:.85rem;">Moyens de paiement et IBAN : à renseigner dans Paramètres → Réglages financiers → Paniers & livraison.</span>' : ''}</div>
        <textarea class="note-area" rows="2" style="width:100%;" placeholder="Message pour ce client (vide = rien d'affiché)" oninput="Paniers._shSetMsg(this.value)">${U.esc(String(S.payMessage || ''))}</textarea>
      </div>
      <div style="margin-top:14px;padding-top:10px;border-top:1px dashed var(--card-border);">
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:6px;">⏳ Mettre en attente (en attendant l'accord de la cliente)</div>
        <div class="grid c2" style="gap:10px;">
          ${fld('Nom de la cliente', `<input type="text" list="dl_clients" value="${U.esc(this._shClient)}" placeholder="nom de la cliente…" oninput="Paniers._shSet('Client',this.value)">${Clients.datalist()}`)}
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
  savePending() {
    const name = String(this._shClient || '').trim();
    if (!name) { U.toast('Indique le nom de la cliente pour mettre le panier en attente.', true); return; }
    if (!this.basket.length) return;
    const list = this._pending(), now = Date.now();
    let rec = this._pendId ? list.find(x => x.id === this._pendId) : null;
    const no = this._dvCommit();   // mise en attente = le devis « sort » : numéro attribué ; lettre suivante si le contenu a changé depuis la dernière version
    const data = { dv: { ...this._dv }, name, label: String(this._shLabel || '').trim(), note: String(this._shNote || '').trim(), validUntil: this._shValid || '', mode: this._shMode || '', balOn: this._balOn !== false,
      items: JSON.parse(JSON.stringify(this.basket)), budget: this.budget, livraison: this.livraison, reduction: this.reduction, nbChiens: this.nbChiens, updated: now };
    if (rec) Object.assign(rec, data);
    else { rec = Object.assign({ id: U.uid(), ts: now }, data); list.push(rec); }
    this._pendId = rec.id; this._pendUpd = rec.updated;
    Store.log('panier', `Panier en attente — ${name} (devis ${no})`);
    Store.save('baskets', 'journal');
    U.closeModal();
    U.toast('Panier mis en attente — devis n° ' + no + ' (« Reprendre » pour le retrouver).');
    // Le panier est maintenant dans la liste « en attente » : l'espace de travail repart à vide (plus de panier en cours, plus de blocage au « Reprendre »)
    this.clearBasket();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  quickPending() {   // « Mettre en attente » depuis la barre du panier (sans ouvrir « Partager ») : le nom vient du champ Cliente
    this._shClient = String(this.client || this._shClient || '').trim();
    if (!this._shClient) { U.toast('Indique d\'abord le nom de la cliente (champ « Cliente » à gauche).', true); return; }
    this.savePending();
  },
  _ageTxt(rec) {
    const d = Math.floor((Date.now() - (rec.updated || rec.ts)) / 86400000);
    return { d, txt: d <= 0 ? 'aujourd\'hui' : d === 1 ? 'depuis 1 jour' : `depuis ${d} jours` };
  },
  _pendingCard() {
    const list = this._pending().slice().sort((a, b) => (b.updated || b.ts) - (a.updated || a.ts));
    if (!list.length) return '';
    const today = new Date().toISOString().slice(0, 10);
    const rows = list.map(r => {
      const tot = (r.items || []).reduce((a, b) => a + U.num(b.price) * U.num(b.qty), 0) * (1 - Math.min(99, U.num(r.reduction)) / 100) + (U.num(r.livraison) > 0 ? U.num(r.livraison) : 0);
      const nb = (r.items || []).reduce((a, b) => a + U.num(b.qty), 0);
      const age = this._ageTxt(r);
      const dogs = this._dogsOf(r.name).map(d => d.name + (d.breed ? ' (' + d.breed + ')' : '')).join(', ');
      const exp = r.validUntil && r.validUntil < today;
      return `<tr${this._pendId === r.id ? ' style="background:var(--th-bg);"' : ''}>
        <td class="col-name"><b>${U.esc(Clients.show(r.name))}</b>${r.dv && r.dv.base ? ` <span class="badge info" title="N° de devis">${Devis.no(r.dv)}</span>` : ''}${r.label ? ` <span class="badge info">${U.esc(r.label)}</span>` : ''}${dogs ? `<div class="muted" style="font-size:.8rem;">🐕 ${U.esc(dogs)}</div>` : ''}${r.note ? `<div class="muted" style="font-size:.8rem;font-style:italic;">📝 ${U.esc(r.note)}</div>` : ''}</td>
        <td><span class="badge ${age.d >= 7 ? 'warn' : ''}">⏳ ${age.txt}</span>${r.validUntil ? `<div class="${exp ? 'warn-txt' : 'muted'}" style="font-size:.8rem;">${exp ? '⚠ expiré le ' : 'valable jusqu\'au '}${U.frDate(r.validUntil)}</div>` : ''}</td>
        <td class="num" style="white-space:nowrap;">${nb} art.<br><b>${U.eur(tot)}</b></td>
        <td style="white-space:nowrap;text-align:right;">
          <button class="btn-ghost btn-sm" onclick="Paniers.resume('${r.id}')" title="Recharger ce panier pour le modifier">✏️ Reprendre</button>
          <button class="btn-ghost btn-sm" onclick="Paniers.dupPending('${r.id}')" title="Garder cette version et en proposer une autre">📋 Dupliquer</button>
          <button class="btn-cta btn-sm" onclick="Paniers.sendToSale('${r.id}')" title="La cliente est d'accord : charge les produits dans le ticket de la page Ventes">🛒 Envoyer en vente</button>
          <button class="btn-icon" onclick="Paniers.delPending('${r.id}')" title="Supprimer">🗑️</button>
        </td></tr>`;
    }).join('');
    return `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--caramel);">
      <h2>⏳ Paniers en attente (${list.length})</h2>
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
  _loadRec(rec) {
    this.basket = JSON.parse(JSON.stringify(rec.items || []));
    this.budget = U.num(rec.budget) || this.budget; this.livraison = U.num(rec.livraison); this.reduction = U.num(rec.reduction); this.nbChiens = U.num(rec.nbChiens) || this.nbChiens;
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
  dupPending(id) {
    const rec = this._pending().find(x => x.id === id); if (!rec) return;
    const now = Date.now();
    const copy = Object.assign(JSON.parse(JSON.stringify(rec)), { id: U.uid(), ts: now, updated: now, dv: null, label: (rec.label ? rec.label + ' ' : '') + '(copie)' });
    this._pending().push(copy);
    Store.save('baskets'); this.render(); U.toast('Panier dupliqué.');
  },
  async delPending(id) {
    const rec = this._pending().find(x => x.id === id); if (!rec) return;
    if (!await U.confirm('Supprimer le panier en attente de ' + Clients.show(rec.name) + ' ?', { okLabel: 'Supprimer' })) return;
    Store.state.baskets = this._pending().filter(x => x.id !== id);
    if (this._pendId === id) this._pendId = null;
    Store.save('baskets'); this.render();
  },
  async sendToSale(id) {
    const rec = this._pending().find(x => x.id === id); if (!rec) return;
    const units = Ventes.units(), merged = new Map(), warns = [], general = [];
    (rec.items || []).forEach(b => {
      const key = 'M|' + b.pId + '|' + b.vId;
      if (merged.has(key)) merged.get(key).qty += U.num(b.qty);
      else merged.set(key, { key, name: b.name, variant: b.variant, price: U.num(b.price), qty: U.num(b.qty) });
    });
    const lines = [];
    merged.forEach(m => {
      const u = units.find(x => x.key === m.key);
      if (!u) { warns.push(`<b>${U.esc(m.name)}</b> ${U.esc(m.variant || '')} : produit introuvable dans le stock (ignoré).`); return; }
      // Règle : toujours le stock ÉVÉNEMENT d'abord ; le manquant vient du stock général (confirmé dans la fenêtre)
      const e = Math.min(m.qty, Math.max(0, U.num(u.availE))), g = m.qty - e;
      if (e > 0) lines.push({ u, qty: e, price: m.price, src: 'event' });
      if (g > 0) {
        lines.push({ u, qty: g, price: m.price, src: 'general' });
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
    Ventes.loadFromBasket(rec, lines);
  },

  _stockWarn(pId, vId) {
    const p = Store.state.stockM.find(x => x.id === pId), v = p && (p.variants || []).find(x => x.id === vId);
    if (!v || Stock.isVirtual(p, v)) return;
    const want = this.basket.filter(b => b.pId === pId && b.vId === vId).reduce((a, b) => a + U.num(b.qty), 0);
    const g = (v.lots || []).reduce((a, l) => a + U.num(l.qtyGeneral), 0), e = (v.lots || []).reduce((a, l) => a + U.num(l.qtyEvent), 0);
    if (want > g + e) U.toast(`⚠️ Stock insuffisant : ${U.qty(want)} ${p.name} ${Pricing.labelVariant(v)} dans le panier, ${U.qty(g + e)} en stock (général + événement).`, true);
    else if (want > g) U.toast(`⚠️ Stock général insuffisant : ${U.qty(want)} ${p.name} ${Pricing.labelVariant(v)} demandé(s), ${U.qty(g)} en général (le reste est en événement).`, true);
  },
  /* Image du panier (dessinée sur un canvas, aucune librairie) : copie dans le presse-papiers (HTTPS seulement) ou téléchargement PNG */
  async _shareCanvas() {
    const d = this._shareData();
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
    const cs = getComputedStyle(document.documentElement);
    const col = (v, f) => (cs.getPropertyValue(v) || '').trim() || f;
    const bg = col('--card-bg', '#243746'), fg = col('--texte', '#f3ead9'), car = col('--caramel', '#a67153'), line = col('--card-border', '#3a5266'), th = col('--th-bg', '#1c2b38');
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
    if (d.x.valid) blocks.unshift({ f: font(500, 16), l: [d.x.valid] });
    if (d.x.mode) blocks.unshift({ f: font(700, 16), l: [d.x.mode] });
    const whoH = d.x.who ? 30 : 0;
    const extraH = blocks.reduce((a, b) => a + b.l.length * 24 + 12, 0);
    const H = pad + 50 + whoH + 44 + rows * rowH + 70 + extraH + pad;
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
      if (i % 2) { x.fillStyle = th; x.globalAlpha = .45; x.fillRect(pad, y, W - 2 * pad, rowH); x.globalAlpha = 1; }
      x.fillStyle = fg; x.font = font(700, 18); x.textAlign = 'left';
      let nm = l.name;
      while (x.measureText(nm).width > inner * 0.40 && nm.length > 4) nm = nm.slice(0, -2);
      x.fillText(nm + (nm.length < l.name.length ? '…' : ''), pad + 12, y + rowH / 2 - (l.dog ? 8 : 0));
      if (l.dog) { x.fillStyle = car; x.font = font(600, 13); x.fillText('→ pour ' + l.dog, pad + 12, y + rowH / 2 + 12); x.fillStyle = fg; }
      x.font = font(500, 17); x.textAlign = 'center'; x.fillText(l.variant || '', cVar, y + rowH / 2);
      x.font = font(700, 18); x.fillText(U.qty(l.qty), cQty, y + rowH / 2);
      x.font = font(500, 17); x.textAlign = 'right'; x.fillText(U.eur(l.unit), rUnit, y + rowH / 2);
      x.font = font(700, 18); x.fillText(U.eur(l.total), rTot, y + rowH / 2);
      y += rowH;
    });
    if (d.red > 0) {
      x.fillStyle = fg; x.font = font(500, 17); x.textAlign = 'right';
      x.fillText('Réduction (' + U.qty(d.redPct) + ' %)', rUnit, y + rowH / 2); x.fillText('− ' + U.eur(d.red), rTot, y + rowH / 2);
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
    x.fillText('Total TTC', rUnit, y + 36); x.fillText(U.eur(d.total), rTot, y + 36);
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
      d.lines.map(l => `• ${l.name}${l.variant ? ' (' + l.variant + ')' : ''}${l.qty > 1 ? ' × ' + U.qty(l.qty) + ' (' + eur(l.unit) + ' l\'unité)' : ''} — ${eur(l.total)}${l.dog ? ' → pour ' + l.dog : ''}`),
      [''], d.red > 0 ? ['Réduction (' + U.qty(d.redPct) + ' %) : − ' + eur(d.red)] : [], d.ship > 0 ? ['Livraison : ' + eur(d.ship)] : [], d.av > 0 ? ['Avoir déduit : − ' + eur(d.av)] : [], d.det > 0 ? ['Solde à régler : + ' + eur(d.det)] : [], ['Total TTC : ' + eur(d.total)],
      d.x.mode ? ['', d.x.mode] : [], d.x.valid ? ['', d.x.valid] : [], d.x.pay ? ['', d.x.pay] : [], d.x.ibanLines.length ? [''].concat(d.x.ibanLines, d.x.refHint ? [d.x.refHint] : []) : [], d.x.msg ? ['', d.x.msg] : []).join('\n');
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); U.toast(ok ? 'Texte copié.' : 'Copie impossible', !ok); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => U.toast('Texte copié.')).catch(fallback); else fallback();
  },

  /* Remise à zéro de la CONFIGURATION (cliente, budget, livraison, réduction, chiens, priorité, filtres…) comme pour un tout nouveau panier */
  resetConfig() {
    Object.assign(this, JSON.parse(JSON.stringify(this._cfgDefaults || {})));
    this.client = ''; this.excludeMeatsOpen = false; this.addQ = ''; this.addOpen = false;
  },
  clearBasket() {
    this.resetConfig();
    this.basket = [];
    this._pendId = null; this._pendUpd = 0; this._shClient = ''; this._shLabel = ''; this._shNote = ''; this._shValid = ''; this._shMode = ''; this._balOn = true; this._dv = Devis.blank();
    this.proposals = null;
    this.render();
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
        const cat = Store.state.catalogM.find(c => c.id === (v.catalogId || p.catalogId));
        const lots = v.lots.filter(l => {
          const q = U.num(l.qtyGeneral) + U.num(l.qtyEvent);
          if (q <= 0) return false;
          const d = U.daysTo(l.dluo);
          // ajout manuel : les lots périmés restent proposés (badge « périmé »)
          return true;
        });
        if (!lots.length) return;
        const price = U.num(v.priceTTC);   // ajout manuel : même sans prix de vente renseigné (affiché 0,00 €)
        let coeff = 0;
        if (cat) {
          const cv = v.catalogVariantId ? (cat.variants || []).find(x => x.id === v.catalogVariantId) : null;
          if (cv) {
            const base = Pricing.baseUnitCost(cat);
            const calc = Pricing.variantCalc(cat, cv, 0, base);
            coeff = calc.effCoeff || 0;
          }
        }
        const tags = this._mergeTags(p.tags || {}, Stock.variantTags(p, v));
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
  manualCandidates() {
    const q = U.normSearch(this.addQ);
    return this.allCandidates().filter(c => {
      if (q && !U.has(c.name + ' ' + c.variant + ' ' + c.sku, q)) return false;
      if (this.addVariants.length && !this.addVariants.includes(c.variant)) return false;
      if (!q && !this.addVariants.length) return false;
      return true;
    }).filter((c, _i, arr) => !arr.some(o => o !== c && o.pId === c.pId && o.vId === c.vId && (o.daysLeft < c.daysLeft || (o.daysLeft === c.daysLeft && arr.indexOf(o) < arr.indexOf(c)))))   // une seule ligne par variante : le lot à la DLUO la plus courte (comme en vente)
      .sort((a, b) => U.sortFr(a.name + a.variant, b.name + b.variant)).slice(0, 100);
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
  pickManual(pId, vId, lotId) {
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
    this.addQ = ''; this.addOpen = false;
    this.render();
    this._stockWarn(pId, vId);
    Clients.conflicts(this.client, { kind: 'M', type: c.meat, name: c.name }).forEach(t => U.toast('🐕 ' + c.name + ' : ' + t, true));
  },

  /* ---------- Filtres ---------- */
  /* Brouillon : le panier en cours (et sa cliente) survit à un rechargement de la page, un changement de fenêtre ou une fermeture d'onglet. « Vider » l'efface. */
  _DK: 'touffu_paniers_draft',
  _draft() {
    const keys = ['basket', 'proposals', 'client', '_pendId', '_pendUpd', '_dv', '_balOn', '_shClient', '_shLabel', '_shNote', '_shValid', '_shMode'];
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
  _disc() { return Math.min(99, Math.max(0, U.num(this.reduction))) / 100; },
  _avail() { return (this.budget - this.livraison) / (1 - this._disc()); },   // budget utilisable, exprimé en prix publics (avant réduction)
  setReduction(v) { this.reduction = Math.min(99, Math.max(0, U.num(v))); this._updateKPI(); },
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
  setPayment(v) { this.paymentMode = v; this.render(); },
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
        ${this._disc() > 0 ? `<div class="kpi"><span class="kpi-val">− ${U.eur(totalBasket * this._disc())}</span><span class="kpi-label">Réduction (${U.qty(this.reduction)} %)</span></div>` : ''}
        <div class="kpi"><span class="kpi-val ${remaining < 0 ? 'warn-txt' : ''}">${U.eur(remaining * (1 - this._disc()))}</span><span class="kpi-label">Reste</span></div>
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
        <p class="muted" style="margin:0 0 8px;">${nb} article(s) · ${nProd} produit(s) · ${nMeat} viande(s)${(() => { const ci = prop.filter(b => b.coeff > 0); const cq = ci.reduce((a,b) => a + b.qty, 0); const cm = cq > 0 ? ci.reduce((a,b) => a + b.coeff * b.qty, 0) / cq : 0; return cm > 0 ? ` · <b>Coeff moyen : ${cm.toFixed(2)}</b>` : ''; })()}</p>
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
    U.syncFilters('paniers', this, ['budget', 'livraison', 'reduction', 'nbChiens', 'priority', 'excludeMeats',
      'excludeProducts', 'poilFilter', 'hypoOnly', 'resistanceInclude', 'typeFilter',
      'ageInclude', 'gabaritInclude', 'odeurInclude', 'grasInclude', 'paymentMode', 'maxPerProduct']);
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

      <div class="card">
        <h2>⚙️ Configuration</h2>

        <div class="fg" style="margin-bottom:12px;"><label>🐕 Cliente (option)</label>
          <input type="text" list="dl_clients" id="pan_client" value="${U.esc(Clients.show(this.client))}" placeholder="nom de la cliente…" onchange="Paniers.setClient(this.value)">${Clients.datalist()}
          <div class="muted" style="font-size:.82rem;margin-top:4px;">${U.esc(this._clientSummary())}</div></div>

        <div class="frow" style="gap:12px;">
          <div class="fg"><label>💰 Budget TTC</label>
            <input type="number" id="pan_budget" step="0.5" min="0" value="${this.budget}" oninput="Paniers.setBudget(this.value)">
          </div>
          <div class="fg"><label>📦 Livraison</label>
            <div style="display:flex;gap:6px;align-items:center;">
              <input type="number" id="pan_livr" step="0.1" min="0" value="${this.livraison}" oninput="Paniers.setLivraison(this.value)" style="flex:1;">
              <button class="btn-ghost btn-sm${this.livraison===0?' active':''}" onclick="Paniers.setLivraisonQuick(0)">0 €</button>
              <button class="btn-ghost btn-sm${this.livraison===(Store.state.settings.shippingCost??6.8)?' active':''}" onclick="Paniers.setLivraisonQuick(${Store.state.settings.shippingCost??6.8})">${U.eur(Store.state.settings.shippingCost??6.8)}</button>
            </div>
          </div>
          <div class="fg"><label>🏷️ Réduction (%)</label>
            <input type="number" id="pan_red" step="0.5" min="0" max="99" value="${this.reduction || ''}" placeholder="0" oninput="Paniers.setReduction(this.value)" title="Code de réduction du client : le budget restant et la génération en tiennent compte">
          </div>
          <div class="fg"><label>🐕 Chiens</label>
            <input type="number" id="pan_chiens" min="1" max="10" value="${this.nbChiens}" oninput="Paniers.setNbChiens(this.value)">
          </div>
        </div>

        <div class="frow" style="gap:12px;">
          <div class="fg"><label>💳 Paiement</label>
            <div style="display:flex;gap:6px;">
              <button class="btn-ghost btn-sm${this.paymentMode==='sumup'?' active':''}" onclick="Paniers.setPayment('sumup')">SumUp (${U.pct(S.cardFeeRate)})</button>
              <button class="btn-ghost btn-sm${this.paymentMode==='stripe'?' active':''}" onclick="Paniers.setPayment('stripe')">Stripe (${U.pct(S.stripeFeeRate || 0)})</button>
              <button class="btn-ghost btn-sm${this.paymentMode==='virement'?' active':''}" onclick="Paniers.setPayment('virement')">Virement (0%)</button>
            </div>
          </div>
        </div>

        <div class="frow" style="gap:12px;">
          <div class="fg"><label>🎯 Priorité</label>
            ${U.customSelect({ value: this.priority, options: [{v:'mix',l:'Mix (DLUO + rentabilité)'},{v:'dluo',l:"DLUO courte d'abord"},{v:'coeff',l:"Meilleur coeff d'abord"}], onPick: 'Paniers.setPriority' })}
          </div>
          <div class="fg"><label>🐾 Poil</label>
            ${U.customSelect({ value: this.poilFilter, options: [{v:'all',l:'Tous'},{v:'avec',l:'Avec poil'},{v:'sans',l:'Sans poil'}], onPick: 'Paniers.setPoil' })}
          </div>
          <div class="fg"><label>Max/produit</label>
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
          <label class="ms-opt"><input type="checkbox" ${this.hypoOnly ? 'checked' : ''} onchange="Paniers.setHypo(this.checked)"> Hypoallergénique uniquement</label>
        </div>

        <div class="fg" style="margin-top:8px;">
          <label>💪 Résistance souhaitée</label>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px;">
            ${[['faible','Faible'],['moyenne','Moyenne'],['forte','Forte'],['tres-forte','Très Forte']].map(([v,l]) =>
              `<label class="ms-opt"><input type="checkbox" ${this.resistanceInclude.includes(v)?'checked':''} onchange="Paniers.toggleResistance('${v}')"> ${l}</label>`
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

        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-cta" onclick="Paniers.generate()">🎲 Générer le panier</button>
          ${this.basket.length ? `<button class="btn-ghost" onclick="Paniers.regenerate()" title="Garde les produits verrouillés 🔒 et recompose le reste du panier">🔄 Recomposer le reste</button>` : ''}
          ${this.basket.length || this.proposals ? `<button class="btn-ghost" onclick="Paniers.clearBasket()">🧹 Vider</button>` : ''}
        </div>
      </div>

      <div class="card">
        ${this.proposals ? this._renderProposals() : `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
          <h2 style="margin:0;">🧺 Panier composé${this.nbChiens > 1 ? ` <span class="muted">(${this.nbChiens} chiens)</span>` : ''}</h2>
          ${this.basket.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="btn-ghost btn-sm" onclick="Paniers.share()" title="Fenêtre propre à montrer au client : produit, variante et prix TTC">📤 Partager</button>
            <button class="btn-ghost btn-sm" onclick="Paniers.shareImage('copy')" title="Copie l'image du devis (avec son n°)">🖼️ Copier l'image</button>
            <button class="btn-ghost btn-sm" onclick="Paniers.shareImage('save')">⬇ Enregistrer l'image</button>
            <button class="btn-ghost btn-sm" onclick="Paniers.copyShare()">📋 Copier le texte</button>
            <button class="btn-cta btn-sm" onclick="Paniers.quickPending()" title="Range le devis dans « Paniers en attente » et repart à vide">💾 Mettre en attente</button>
          </div>` : ''}
        </div>
        ${this.basket.length ? `<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px;"><span class="muted" style="font-size:.78rem;text-transform:uppercase;">Mode de remise (sur le devis)</span><div class="pan-mode" style="display:flex;gap:8px;flex-wrap:wrap;">${this._modeBtns()}</div><div class="pan-bal">${this._balBox()}</div><span class="badge info" id="pan_dvno" title="N° de devis (définitif à la copie ou à la mise en attente)">Devis n° ${U.esc(this._shareData().no)}</span></div>` : ''}

        <div class="kpi-row" id="pan_kpi" style="margin-bottom:16px;">
          <div class="kpi"><span class="kpi-val">${U.eur(this.budget)}</span><span class="kpi-label">Budget</span></div>
          ${this.livraison > 0 ? `<div class="kpi"><span class="kpi-val">− ${U.eur(this.livraison)}</span><span class="kpi-label">Livraison</span></div>` : ''}
          <div class="kpi"><span class="kpi-val">${U.eur(totalBasket)}</span><span class="kpi-label">Panier (${nbArticles} art.)</span></div>
        ${this._disc() > 0 ? `<div class="kpi"><span class="kpi-val">− ${U.eur(totalBasket * this._disc())}</span><span class="kpi-label">Réduction (${U.qty(this.reduction)} %)</span></div>` : ''}
          <div class="kpi"><span class="kpi-val ${remaining < 0 ? 'warn-txt' : ''}">${U.eur(remaining * (1 - this._disc()))}</span><span class="kpi-label">Reste</span></div>
        </div>

        ${this.basket.length ? `
        <div class="table-wrap"><table>
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
              <td><button class="btn-icon" onclick="Paniers.toggleLock(${i})" title="${b.locked ? 'Déverrouiller (sera remplacé à la régénération)' : 'Verrouiller (sera gardé à la régénération)'}">${b.locked ? '🔒' : '🔓'}</button></td>
              <td class="col-name">${U.esc(b.name)}${dogOpts.length ? `<div><select onchange="Paniers.setItemDog(${i},this.value)" title="Pour quel chien ? (vide = convient à tous, rien n'est affiché au client)"><option value="">🐕 tous</option>${dogOpts.concat(b.dog && !dogOpts.includes(b.dog) ? [b.dog] : []).map(n => `<option value="${U.esc(n)}" ${b.dog === n ? 'selected' : ''}>pour ${U.esc(n)}</option>`).join('')}</select></div>` : ''}</td>
              <td><span class="tag">${U.esc(b.variant)}</span></td>
              <td><span class="badge info">${U.esc(b.meat || '—')}</span></td>
              <td class="num"><input type="number" step="0.1" min="0" value="${(Math.round(U.num(b.price) * 100) / 100)}" style="width:84px;text-align:right;" title="Prix TTC modifiable pour ce panier (le prix du stock ne change pas)" onchange="Paniers.setItemPrice(${i},this.value)"></td>
              <td class="num" style="white-space:nowrap;">
                <button class="btn-icon" onclick="Paniers.changeQty(${i},-1)">−</button>
                <b>${b.qty}</b>
                <button class="btn-icon" onclick="Paniers.changeQty(${i},1)">+</button>
              </td>
              <td class="num"><b>${U.eur(b.price * b.qty)}</b></td>
              <td>${b.dluo ? `<span class="badge ${dluoClass}">${U.frDate(b.dluo)}${daysLeft !== null ? ` (${daysLeft}j)` : ''}</span>` : '<span class="muted">—</span>'}</td>
              <td class="num">${b.coeff > 0 ? b.coeff.toFixed(2) : '<span class="muted">—</span>'}</td>
              <td style="white-space:nowrap;"><button class="btn-icon" onclick="Paniers.swapItem(${i})" title="Remplacer par un autre produit">🔄</button><button class="btn-icon" onclick="Paniers.excludeItem(${i})" title="Exclure ce produit (ne sera plus proposé)">🚫</button><button class="btn-icon" onclick="Paniers.removeItem(${i})" title="Retirer">🗑️</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>

        ${remaining < 0 ? '<p class="warn-txt" style="margin-top:8px;">⚠️ Le panier dépasse le budget disponible.</p>' : ''}

        ${this._renderFinanceSummary()}
        ` : '<div class="empty" style="text-align:center;padding:40px;"><span class="big">🧺</span><p class="muted">Clique sur "Générer le panier" pour composer automatiquement,<br>ou ajoute des produits manuellement ci-dessous.</p></div>'}

        <div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-top:16px;">
          <div class="fg mb0" style="min-width:160px;max-width:220px;">
            <label>Variantes</label>
            ${U.multiSelect({ groups: this.addVariantGroups(), selected: this.addVariants, toggle: 'Paniers.toggleAddVariant', setAll: 'Paniers.setAllAddVariant', open: this.addVariantsOpen, onOpen: 'Paniers.setAddVariantsOpen' })}
          </div>
          <div class="fg mb0" style="flex:1;min-width:200px;">
            <label>➕ Ajouter un produit</label>
            <div class="autocomplete" data-onclose="Paniers.closeAddMenu">
              <input id="pan_add_q" type="text" autocomplete="off" placeholder="Chercher un produit…"
                value="${U.esc(this.addQ)}" oninput="Paniers.setAddQ(this.value)" onfocus="Paniers.openAddMenu()">
            ${this.addOpen && addResults.length ? `<div class="ac-list" style="max-height:250px;overflow:auto;">${addResults.map(c =>
              `<div class="ac-item pp-row" onmousedown="event.preventDefault();Paniers.pickManual('${c.pId}','${c.vId}','${c.lotId}')"><span class="pp-a">${U.esc(c.name)} <span class="pp-v">${U.esc(c.variant)}</span></span><span class="pp-b">${U.esc(c.meat)}${c.dluo ? ` · DLUO ${U.frDate(c.dluo)}` : ''}</span><span class="pp-c">${U.eur(c.price)}</span></div>`
            ).join('')}</div>` : ''}
            </div>
          </div>
        </div>
        `}
      </div>
      </div>
    `);
  },

  _renderFinanceSummary() {
    const S = Store.state.settings;
    const nbArticles = this.basket.reduce((a, b) => a + b.qty, 0);
    const hasLocked = this.basket.some(b => b.locked);
    const fd = 1 - this._disc();   // réduction client : le prix encaissé baisse
    const rows = this.basket.map(b => {
      const sp = Store.state.stockM.find(x => x.id === b.pId);
      const sv = sp ? sp.variants.find(x => x.id === b.vId) : null;
      const catId = sv ? (sv.catalogId || (sp && sp.catalogId)) : null;
      const cat = catId ? Store.state.catalogM.find(c => c.id === catId) : null;
      const cvId = sv ? sv.catalogVariantId : null;
      const cv = cat && cvId ? (cat.variants || []).find(x => x.id === cvId) : null;
      let cost = 0, priceHT = 0, margin = 0, social = 0, profit = 0, coeff = b.coeff, vatAmt = 0;
      if (cat && cv) {
        const base = Pricing.baseUnitCost(cat);
        const calc = Pricing.variantCalc(cat, cv, 0, base);
        cost = calc.cost; priceHT = calc.priceHT; margin = calc.margin; social = calc.social; profit = calc.profit; coeff = calc.effCoeff; vatAmt = calc.vatAmt;
      } else {
        const vat = U.num(S.vatRate) / 100;
        priceHT = b.price / (1 + vat);
        cost = U.num(sv ? sv.costUnit : 0);
        margin = priceHT - cost;
        social = priceHT * (U.num(S.socialTaxRate) / 100);
        vatAmt = b.price - priceHT;
        profit = margin - social - vatAmt;
      }
      if (fd < 1) { priceHT *= fd; vatAmt *= fd; social *= fd; margin = priceHT - cost; profit = margin - social - vatAmt; }
      // Non assujetti : la TVA reste dans le bénéfice (cohérent avec Prix mastication / Accessoires / compta).
      if (!S.vatActive) profit += vatAmt;
      return { ...b, cost, priceHT, margin, social, profit, coeff };
    });

    const totVente = rows.reduce((a, r) => a + r.price * r.qty, 0) * fd;
    const totCost = rows.reduce((a, r) => a + r.cost * r.qty, 0);
    const totMargin = rows.reduce((a, r) => a + r.margin * r.qty, 0);
    const totSocial = rows.reduce((a, r) => a + r.social * r.qty, 0);
    const totProfit = rows.reduce((a, r) => a + r.profit * r.qty, 0);
    const avgCoeff = nbArticles > 0 ? rows.reduce((a, r) => a + r.coeff * r.qty, 0) / nbArticles : 0;
    const nViandes = [...new Set(this.basket.map(b => b.meat))].filter(Boolean).length;
    const nProduits = [...new Set(this.basket.map(b => b.pId))].length;
    const feeRate = this.paymentMode === 'sumup' ? U.num(S.cardFeeRate) : this.paymentMode === 'stripe' ? U.num(S.stripeFeeRate) : 0;
    const feeName = this.paymentMode === 'sumup' ? 'SumUp' : this.paymentMode === 'stripe' ? 'Stripe' : 'Virement';
    const cbFee = totVente * feeRate / 100;

    return `<div style="margin-top:12px;padding:12px;background:var(--card-bg);border-radius:8px;border:1px solid var(--card-border);">
      <b>Récapitulatif :</b> ${nbArticles} article(s) · ${nViandes} viande(s) · ${nProduits} produit(s) différent(s)
      ${avgCoeff > 0 ? ` · <span class="sensitive"><b>Coeff moyen : ${avgCoeff.toFixed(2)}</b></span>` : ''}
      ${this.nbChiens > 1 ? ` · × ${this.nbChiens} chiens` : ''}
      ${hasLocked ? ` · 🔒 ${this.basket.filter(b => b.locked).length} verrouillé(s)` : ''}
      ${this.basket.some(b => b.daysLeft <= 30) ? ` · <span class="badge warn">contient des DLUO proches</span>` : ''}
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
        <p class="muted sensitive" style="margin-top:6px;font-size:.82rem;">Commission ${feeName} : ${U.eur(cbFee)} (${U.pct(feeRate)}) · Bénéfice après frais : ${U.eur(totProfit - cbFee)}</p>
      </div>
    </details>`;
  },

  setLivraisonQuick(v) {
    this.livraison = v;
    this.render();
  }
};

/* Valeurs d'origine de la configuration (avant toute valeur mémorisée) : sert à « repartir comme pour un nouveau panier » */
Paniers._cfgDefaults = JSON.parse(JSON.stringify(['budget', 'livraison', 'reduction', 'nbChiens', 'priority', 'excludeMeats', 'excludeProducts', 'poilFilter', 'hypoOnly', 'resistanceInclude', 'typeFilter', 'ageInclude', 'gabaritInclude', 'odeurInclude', 'grasInclude', 'paymentMode', 'maxPerProduct'].reduce((o, k) => { o[k] = Paniers[k]; return o; }, {})));
