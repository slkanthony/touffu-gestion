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

  /* ---------- Données disponibles ---------- */
  candidates() {
    const out = [];

    Store.state.stockM.forEach(p => {
      if (this.excludeMeats.includes(p.meatType)) return;
      if (this.excludeProducts.includes(p.id)) return;

      const pTags = p.tags || {};
      if (this.poilFilter === 'avec' && pTags.poil !== 'avec' && pTags.poil !== 'les_deux') return;
      if (this.poilFilter === 'sans' && pTags.poil !== 'sans' && pTags.poil !== 'les_deux') return;
      if (this.hypoOnly && !pTags.hypo) return;

      p.variants.forEach(v => {
        if (v.mode === 'vrac') return;
        const cat = Store.state.catalogM.find(c => c.id === (v.catalogId || p.catalogId));

        const tags = this._mergeTags(pTags, Stock.variantTags(p, v));

        if (this.resistanceInclude.length) {
          const r = tags.resistance;
          if (r && !this.resistanceInclude.includes(r)) return;
        }
        if (this.typeFilter !== 'all' && tags.type && tags.type !== this.typeFilter) return;
        if (this.odeurInclude.length && tags.odeur && !this.odeurInclude.includes(tags.odeur)) return;
        if (this.grasInclude.length && tags.gras && !this.grasInclude.includes(tags.gras)) return;
        if (this.ageInclude.length && tags.age.length > 0 && !tags.age.some(a => this.ageInclude.includes(a))) return;
        if (this.gabaritInclude.length && tags.gabarit.length > 0 && !tags.gabarit.some(g => this.gabaritInclude.includes(g))) return;

        const lots = v.lots.filter(l => {
          const q = U.num(l.qtyGeneral) + U.num(l.qtyEvent);
          if (q <= 0) return false;
          const d = U.daysTo(l.dluo);
          if (d !== null && d < 0) return false;
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
            ...this._famInfo(p, v)
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
    if (c.hasPack) {
      if (c.packQty > 1) return this.nbChiens > 1 ? 1.0 : 0.25;
      return this.nbChiens > 1 ? 0.3 : 0.8;
    }
    if (c.mode !== 'gram') return 0.5;
    const v = U.num(c.value);
    if (this.nbChiens > 1) {
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
    const ages = this.ageInclude;
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
    const gabs = this.gabaritInclude;
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
    return weights.dluo * dluoScore + weights.coeff * coeffScore + weights.div * divScore + weights.size * sizeScore + weights.type * typeScore + weights.meat * meatScore + weights.gab * gabScore + weights.hypoGras * hypoGrasScore;
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
    const maxPer = this.maxPerProduct * mult;

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
      let eligible = affordable.filter(c => (productQties[c.pId] || 0) < maxPer && !this._famTaken(c, basket));
      const hardInBasket = basket.some(b => {
        const sp = Store.state.stockM.find(x => x.id === b.pId);
        if (!sp) return false;
        const sv = sp.variants.find(x => x.id === b.vId);
        const mt = this._mergeTags(sp.tags, sv ? Stock.variantTags(sp, sv) : null);
        return ['forte', 'tres-forte'].includes(mt.resistance);
      });
      if (hardInBasket) eligible = eligible.filter(c => !['forte', 'tres-forte'].includes(c.tags.resistance));
      if (!eligible.length) break;

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
          coeff: pick.coeff, lotNumber: pick.lotNumber, locked: false, family: pick.family
        });
      }

      spent += pick.price;
      pick.avail--;
      usedProducts.add(pick.pId);
      usedMeats[pick.meat] = (usedMeats[pick.meat] || 0) + 1;
    }

    return basket;
  },

  generate() {
    const available = this.budget - this.livraison;
    if (available <= 0) { U.toast('Le budget disponible (après livraison) est nul ou négatif.', true); return; }
    if (!this.candidates().length) { U.toast('Aucun produit ne correspond aux filtres.', true); return; }

    // Les produits ajoutés à la main (locked:true via pickManual) — et tout item verrouillé —
    // servent de BASE : la génération complète le panier autour d'eux au lieu de les écraser
    // (demande d'Antho : un produit ajouté avant de générer doit rester la base du panier).
    const locked = this.basket.filter(b => b.locked).map(b => ({ ...b }));
    const b1 = this._buildBasket(available, locked);
    const b2 = this._buildBasket(available + 1, locked);
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
    const available = this.budget - this.livraison;
    if (available <= 0) { U.toast('Le budget disponible (après livraison) est nul ou négatif.', true); return; }

    const locked = this.basket.filter(b => b.locked).map(b => ({...b}));
    const b1 = this._buildBasket(available, locked);
    const b2 = this._buildBasket(available + 1, locked);
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
    const maxPrice = this.budget - this.livraison - otherTotal;
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
      coeff: pick.coeff, lotNumber: pick.lotNumber, locked: false, family: pick.family
    };
    this.render();
    U.toast(`${oldName} exclu → ${pick.name}`);
  },
  swapItem(idx) {
    const item = this.basket[idx];
    if (!item) return;

    const otherTotal = this.basket.reduce((a, b, i) => i === idx ? a : a + b.price * b.qty, 0);
    const maxPrice = this.budget - this.livraison - otherTotal;

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
      coeff: pick.coeff, lotNumber: pick.lotNumber, locked: false, family: pick.family,
      _swapRejected: rejected // mémorise la série de refus pour les prochains 🔄 sur ce créneau
    };
    this.render();
    U.toast(`${oldName} → ${pick.name}`);
  },
  /* Fenêtre « client » : produit, variante, prix TTC seulement (pas de coeff, DLUO, viande…) — pour capture d'écran ou copie du texte */
  _shareData() {
    const lines = this.basket.map(b => ({ name: b.name, variant: b.variant, qty: b.qty, total: b.price * b.qty, unit: b.price }));
    const sub = lines.reduce((a, l) => a + l.total, 0);
    const ship = this.livraison > 0 ? this.livraison : 0;
    return { lines, sub, ship, total: sub + ship };
  },
  share() {
    if (!this.basket.length) return;
    const d = this._shareData();
    const rows = d.lines.map(l => `<tr><td style="padding:7px 10px;text-align:left;font-weight:700;">${U.esc(l.name)}${l.qty > 1 ? ` <span style="color:var(--caramel);">× ${l.qty}</span>` : ''}</td><td style="padding:7px 10px;text-align:center;">${U.esc(l.variant || '')}</td><td style="padding:7px 10px;text-align:right;font-weight:700;white-space:nowrap;">${U.eur(l.total)}</td></tr>`).join('');
    const body = `<div id="pan_share" style="padding:4px 2px;">
      <table style="width:100%;border-collapse:collapse;font-size:1rem;">
        <thead><tr style="border-bottom:2px solid var(--caramel);"><th style="padding:7px 10px;text-align:left;">Produit</th><th style="padding:7px 10px;text-align:center;">Variante</th><th style="padding:7px 10px;text-align:right;">Prix TTC</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          ${d.ship > 0 ? `<tr style="border-top:1px solid var(--card-border);"><td colspan="2" style="padding:7px 10px;text-align:right;">Livraison</td><td style="padding:7px 10px;text-align:right;white-space:nowrap;">${U.eur(d.ship)}</td></tr>` : ''}
          <tr style="border-top:2px solid var(--caramel);"><td colspan="2" style="padding:9px 10px;text-align:right;font-weight:800;font-size:1.1rem;">Total TTC</td><td style="padding:9px 10px;text-align:right;font-weight:800;font-size:1.1rem;white-space:nowrap;">${U.eur(d.total)}</td></tr>
        </tfoot>
      </table>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;justify-content:center;">
        <button class="btn-ghost btn-sm" onclick="Paniers.shareImage('copy')">🖼️ Copier l'image</button>
        <button class="btn-ghost btn-sm" onclick="Paniers.shareImage('save')">⬇ Enregistrer l'image</button>
      </div></div>`;
    U.modal({ title: '🧺 Votre panier Touffu', body, okLabel: '📋 Copier le texte', onOk: () => { Paniers.copyShare(); return false; } });
  },
  /* Image du panier (dessinée sur un canvas, aucune librairie) : copie dans le presse-papiers (HTTPS seulement) ou téléchargement PNG */
  async _shareCanvas() {
    const d = this._shareData();
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
    const cs = getComputedStyle(document.documentElement);
    const col = (v, f) => (cs.getPropertyValue(v) || '').trim() || f;
    const bg = col('--card-bg', '#243746'), fg = col('--texte', '#f3ead9'), car = col('--caramel', '#a67153'), line = col('--card-border', '#3a5266'), th = col('--th-bg', '#1c2b38');
    const font = (w, px) => `${w} ${px}px Quicksand, "Segoe UI", sans-serif`;
    const W = 720, pad = 32, rowH = 46;
    const rows = d.lines.length + (d.ship > 0 ? 1 : 0);
    const H = pad + 50 + 44 + rows * rowH + 70 + pad;
    const k = 2, cv = document.createElement('canvas');
    cv.width = W * k; cv.height = H * k;
    const x = cv.getContext('2d'); x.scale(k, k);
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.fillStyle = fg; x.textBaseline = 'middle';
    x.font = font(700, 26); x.textAlign = 'left'; x.fillText('Votre panier Touffu', pad, pad + 14);
    let y = pad + 50;
    x.fillStyle = th; x.fillRect(pad, y, W - 2 * pad, 38);
    x.fillStyle = car; x.font = font(700, 13);
    x.textAlign = 'left'; x.fillText('PRODUIT', pad + 12, y + 19);
    x.textAlign = 'center'; x.fillText('VARIANTE', pad + (W - 2 * pad) * 0.62, y + 19);
    x.textAlign = 'right'; x.fillText('PRIX TTC', W - pad - 12, y + 19);
    y += 38;
    x.strokeStyle = car; x.lineWidth = 2; x.beginPath(); x.moveTo(pad, y); x.lineTo(W - pad, y); x.stroke();
    d.lines.forEach((l, i) => {
      if (i % 2) { x.fillStyle = th; x.globalAlpha = .45; x.fillRect(pad, y, W - 2 * pad, rowH); x.globalAlpha = 1; }
      x.fillStyle = fg; x.font = font(700, 18); x.textAlign = 'left';
      let nm = l.name + (l.qty > 1 ? ' × ' + l.qty : '');
      while (x.measureText(nm).width > (W - 2 * pad) * 0.5 && nm.length > 4) nm = nm.slice(0, -2);
      x.fillText(nm + (nm.length < (l.name + (l.qty > 1 ? ' × ' + l.qty : '')).length ? '…' : ''), pad + 12, y + rowH / 2);
      x.font = font(500, 17); x.textAlign = 'center'; x.fillText(l.variant || '', pad + (W - 2 * pad) * 0.62, y + rowH / 2);
      x.font = font(700, 18); x.textAlign = 'right'; x.fillText(U.eur(l.total), W - pad - 12, y + rowH / 2);
      y += rowH;
    });
    if (d.ship > 0) {
      x.fillStyle = fg; x.font = font(500, 17); x.textAlign = 'right';
      x.fillText('Livraison', pad + (W - 2 * pad) * 0.62 + 40, y + rowH / 2); x.fillText(U.eur(d.ship), W - pad - 12, y + rowH / 2);
      y += rowH;
    }
    x.strokeStyle = car; x.beginPath(); x.moveTo(pad, y); x.lineTo(W - pad, y); x.stroke();
    x.fillStyle = fg; x.font = font(800, 21); x.textAlign = 'right';
    x.fillText('Total TTC', pad + (W - 2 * pad) * 0.62 + 40, y + 36); x.fillText(U.eur(d.total), W - pad - 12, y + 36);
    return cv;
  },
  async shareImage(mode) {
    try {
      const cv = await this._shareCanvas();
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      if (!blob) throw new Error('image');
      if (mode === 'copy') {
        if (navigator.clipboard && window.ClipboardItem) {
          try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); U.toast('Image copiée — colle-la dans ta conversation.'); return; } catch (e) {}
        }
        U.toast('Copie de l’image impossible ici (connexion non sécurisée) — image enregistrée à la place.', true);
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'panier-touffu.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { U.toast('Impossible de créer l’image.', true); }
  },
  copyShare() {
    const d = this._shareData();
    const eur = n => n.toFixed(2).replace('.', ',') + ' €';
    const text = ['Votre panier Touffu', ''].concat(
      d.lines.map(l => `• ${l.name}${l.variant ? ' (' + l.variant + ')' : ''}${l.qty > 1 ? ' × ' + l.qty : ''} — ${eur(l.total)}`),
      [''], d.ship > 0 ? ['Livraison : ' + eur(d.ship)] : [], ['Total TTC : ' + eur(d.total)]).join('\n');
    const fallback = () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); U.toast(ok ? 'Texte copié.' : 'Copie impossible', !ok); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => U.toast('Texte copié.')).catch(fallback); else fallback();
  },

  clearBasket() {
    this.basket = [];
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
        if (v.mode === 'vrac') return;
        const cat = Store.state.catalogM.find(c => c.id === (v.catalogId || p.catalogId));
        const lots = v.lots.filter(l => {
          const q = U.num(l.qtyGeneral) + U.num(l.qtyEvent);
          if (q <= 0) return false;
          const d = U.daysTo(l.dluo);
          if (d !== null && d < 0) return false;
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
      if (q && !U.normSearch(c.name + ' ' + c.variant + ' ' + c.sku).includes(q)) return false;
      if (this.addVariants.length && !this.addVariants.includes(c.variant)) return false;
      if (!q && !this.addVariants.length) return false;
      return true;
    }).sort((a, b) => U.sortFr(a.name + a.variant, b.name + b.variant)).slice(0, 30);
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
  setAddVariantsOpen(v) { this.addVariantsOpen = v; },
  setAddQ(v) { this.addQ = v; this.addOpen = true; this.render(); U.refocus('pan_add_q'); },
  openAddMenu() { if (this.addOpen) return; this.addOpen = true; this.render(); U.refocus('pan_add_q'); },
  closeAddMenu() { if (!this.addOpen) return; this.addOpen = false; this.render(); },
  pickManual(pId, vId, lotId) {
    const cands = this.allCandidates();
    const c = cands.find(x => x.pId === pId && x.vId === vId && x.lotId === lotId);
    if (!c) { U.toast('Produit introuvable ou plus en stock.', true); return; }
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
  },

  /* ---------- Filtres ---------- */
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
    const available = this.budget - this.livraison;
    const remaining = available - totalBasket;
    const el = document.getElementById('pan_kpi');
    if (el) {
      const nbArticles = this.basket.reduce((a, b) => a + b.qty, 0);
      el.innerHTML = `
        <div class="kpi"><span class="kpi-val">${U.eur(this.budget)}</span><span class="kpi-label">Budget</span></div>
        ${this.livraison > 0 ? `<div class="kpi"><span class="kpi-val">− ${U.eur(this.livraison)}</span><span class="kpi-label">Livraison</span></div>` : ''}
        <div class="kpi"><span class="kpi-val">${U.eur(totalBasket)}</span><span class="kpi-label">Panier (${nbArticles} art.)</span></div>
        <div class="kpi"><span class="kpi-val ${remaining < 0 ? 'warn-txt' : ''}">${U.eur(remaining)}</span><span class="kpi-label">Reste</span></div>
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
              <td class="col-name">${U.esc(b.name)}</td>
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
    U.syncFilters('paniers', this, ['budget', 'livraison', 'nbChiens', 'priority', 'excludeMeats',
      'excludeProducts', 'poilFilter', 'hypoOnly', 'resistanceInclude', 'typeFilter',
      'ageInclude', 'gabaritInclude', 'odeurInclude', 'grasInclude', 'paymentMode', 'maxPerProduct']);
    const S = Store.state.settings;
    const meatTypes = (S.meatTypes || []).slice().sort(U.sortFr);
    const products = Store.state.stockM;
    const totalBasket = this.basket.reduce((a, b) => a + b.price * b.qty, 0);
    const available = this.budget - this.livraison;
    const remaining = available - totalBasket;
    const nbArticles = this.basket.reduce((a, b) => a + b.qty, 0);
    const hasLocked = this.basket.some(b => b.locked);

    const exclNames = this.excludeProducts.map(id => {
      const p = products.find(x => x.id === id);
      return p ? p.name : '?';
    });

    const exclProdResults = this.excludeProdsQ
      ? products.filter(p => p.name.toLowerCase().includes(this.excludeProdsQ.toLowerCase()) && !this.excludeProducts.includes(p.id)).slice(0, 10)
      : [];

    const addResults = this.addOpen ? this.manualCandidates() : [];

    App.mount(`
      <div class="view-title"><h1>🧺 Paniers personnalisés</h1><span class="sub">Compose un panier mixte de mastication en fonction du budget, des préférences du chien et de la rentabilité.</span></div>

      <div class="paniers-layout">

      <div class="card">
        <h2>⚙️ Configuration</h2>

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
          ${this.basket.length ? `<button class="btn-ghost" onclick="Paniers.share()" title="Fenêtre propre à montrer au client : produit, variante et prix TTC">📤 Partager</button>` : ''}
        </div>
      </div>

      <div class="card">
        ${this.proposals ? this._renderProposals() : `
        <h2>🧺 Panier composé${this.nbChiens > 1 ? ` <span class="muted">(${this.nbChiens} chiens)</span>` : ''}</h2>

        <div class="kpi-row" id="pan_kpi" style="margin-bottom:16px;">
          <div class="kpi"><span class="kpi-val">${U.eur(this.budget)}</span><span class="kpi-label">Budget</span></div>
          ${this.livraison > 0 ? `<div class="kpi"><span class="kpi-val">− ${U.eur(this.livraison)}</span><span class="kpi-label">Livraison</span></div>` : ''}
          <div class="kpi"><span class="kpi-val">${U.eur(totalBasket)}</span><span class="kpi-label">Panier (${nbArticles} art.)</span></div>
          <div class="kpi"><span class="kpi-val ${remaining < 0 ? 'warn-txt' : ''}">${U.eur(remaining)}</span><span class="kpi-label">Reste</span></div>
        </div>

        ${this.basket.length ? `
        <div class="table-wrap"><table>
          <thead><tr>
            <th></th><th class="col-name">Produit</th><th>Variante</th><th>Viande</th>
            <th class="num">Prix TTC</th><th class="num">Qté</th><th class="num">Sous-total</th>
            <th>DLUO</th><th class="num">Coeff</th><th></th>
          </tr></thead>
          <tbody>${this.basket.map((b, i) => {
            const daysLeft = U.daysTo(b.dluo);
            const dluoClass = daysLeft !== null && daysLeft < 0 ? 'bad' : daysLeft !== null && daysLeft <= 30 ? 'warn' : '';
            return `<tr${b.locked ? ' style="background:var(--th-bg);"' : ''}>
              <td><button class="btn-icon" onclick="Paniers.toggleLock(${i})" title="${b.locked ? 'Déverrouiller (sera remplacé à la régénération)' : 'Verrouiller (sera gardé à la régénération)'}">${b.locked ? '🔒' : '🔓'}</button></td>
              <td class="col-name">${U.esc(b.name)}</td>
              <td><span class="tag">${U.esc(b.variant)}</span></td>
              <td><span class="badge info">${U.esc(b.meat || '—')}</span></td>
              <td class="num">${U.eur(b.price)}</td>
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
      // Non assujetti : la TVA reste dans le bénéfice (cohérent avec Prix mastication / Accessoires / compta).
      if (!S.vatActive) profit += vatAmt;
      return { ...b, cost, priceHT, margin, social, profit, coeff };
    });

    const totVente = rows.reduce((a, r) => a + r.price * r.qty, 0);
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
