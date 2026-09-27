/* ============================================================
   PRICING — formules reprises du Calculateur de Prix existant
   Coût unitaire = produit + sachet/blister + étiquette
   Prix HT = coût × coefficient × (1 − décote palier)
   Prix TTC = HT × (1 + TVA)   ·   Marge = HT − coût
   Profit = Marge − cotisations sociales − TVA
   ============================================================
   Produit catalogM :
   { id, name, meatType, mainSupplierId,
     suppliers: [{ id, supplierId, price, taxType('HT'|'TTC'), vatRate,
                   unit('kilo'|'piece'), weight, quantity, piecesPerKilo }],
     variants: [{ id, label, mode('gram'|'piece'|'size'), value, weight,
                  sachetId, coeff, priceTTCManual, enabled, sku }],
     coefficient, labelCost, vatRate, bulkDiscount, notes }
   mainSupplierId désigne le fournisseur (parmi `suppliers`) dont le prix
   sert de base à tous les calculs de revient ; les autres entrées ne
   servent qu'à comparer, saisies et mises à jour à la main par Antho.
   Une variante avec `priceTTCManual` renseigné garde un prix de vente
   FIXE quel que soit le fournisseur principal actif : c'est le coefficient
   affiché qui devient informatif (dérivé du coût courant), pas l'inverse.
   `vatRate`/`bulkDiscount` sur le produit sont optionnels et surchargent
   les réglages globaux (S.vatRate/S.bulkDiscount) — vide = hérite du global.
   ============================================================ */
const Pricing = {

  /* Taux de cotisations URSSAF pour le fait main (accessoires) : les
     accessoires cousus main relèvent des BIC prestation de services
     artisanale (21,2 %), pas de la vente de marchandises (12,3 % =
     `socialTaxRate`, utilisé pour la mastication). Repli sur le taux
     standard si le champ n'a jamais été renseigné. */
  socialRateHandmade() {
    const S = Store.state.settings;
    const h = S.socialTaxRateHandmade;
    return (h !== undefined && h !== '' && h !== null) ? U.num(h) : U.num(S.socialTaxRate);
  },

  /* Fiche prix du fournisseur principal du produit (ou le 1er à défaut).
     overrideSupId : si fourni, utilise ce fournisseur au lieu du principal
     (prévisualisation temporaire, aucune donnée modifiée). */
  mainEntry(p, overrideSupId) {
    const list = p.suppliers || [];
    const target = overrideSupId || p.mainSupplierId;
    return list.find(s => s.supplierId === target) || list[0] || null;
  },

  /* Prix d'achat HT unitaire de base (au kg ou à la pièce), d'après la
     fiche du fournisseur principal (ou overrideSupId si fourni). */
  baseUnitCost(p, overrideSupId) {
    const S = Store.state.settings;
    const b = this.mainEntry(p, overrideSupId);
    if (!b) return { unitHT: 0, unit: 'kilo', src: 'aucun fournisseur', ppk: 0 };
    const vat = 1 + U.num(b.vatRate !== undefined && b.vatRate !== '' ? b.vatRate : S.vatRate) / 100;
    let price = U.num(b.price);
    if ((b.taxType || 'HT') === 'TTC') price /= vat;
    const div = b.unit === 'kilo' ? (U.num(b.weight) || 1) : (U.num(b.quantity) || 1);
    return { unitHT: price / div, unit: b.unit || 'kilo', src: Store.supplierName(b.supplierId), ppk: U.num(b.piecesPerKilo) };
  },

  /* Coût de production d'une variante (hors emballage) */
  variantProdCost(p, v, base) {
    const b = base || this.baseUnitCost(p);
    if (v.mode === 'gram') {
      if (b.unit === 'kilo') return b.unitHT * (U.num(v.value) / 1000);
      return b.unitHT; // achat à la pièce revendu au poids : approximation 1 pièce
    }
    if (v.mode === 'piece') {
      const ratio = b.unit === 'kilo' ? U.num(v.value) / (b.ppk || 1) : U.num(v.value);
      return b.unitHT * ratio;
    }
    // mode 'size' : coût saisi sur la variante (valeur = prix d'achat HT de la taille,
    // cas "acheté à la pièce, prix différent par taille") — prioritaire si renseigné
    if (U.num(v.value) > 0) return U.num(v.value);
    // cas "acheté au kilo, poids différent par taille" (v.weight en grammes) : permet
    // de refléter les grosses variations de poids entre tailles sur un même achat au kilo
    if (b.unit === 'kilo' && U.num(v.weight) > 0) return b.unitHT * (U.num(v.weight) / 1000);
    return b.unit === 'kilo' && b.ppk > 0 ? b.unitHT / b.ppk : b.unitHT;
  },

  /* Calcul complet d'une variante.
     idxActive = position parmi les variantes actives (décote dès la 2e)
     nActive   = nombre total de variantes actives (pour décote progressive)
     Si v.priceTTCManual est renseigné, le prix de vente est FIXE (ne
     bouge pas quand le coût change, ex: changement de fournisseur
     principal) et le coefficient affiché devient une valeur dérivée. */
  /* Coûts d'un événement portés par une vente : frais de stand + frais de déplacement (2026-09-27). */
  eventCost(s) { return U.num(s && s.eventFee) + U.num(s && s.travelCost); },

  variantCalc(p, v, idxActive, base, nActive) {
    const S = Store.state.settings;
    const vat = U.num(p.vatRate !== undefined && p.vatRate !== '' ? p.vatRate : S.vatRate) / 100;
    const prodCost = this.variantProdCost(p, v, base);
    const sac = Store.sachet(v.sachetId);
    const sacCost = sac ? U.num(sac.cost) : 0;
    const labelCost = Store.labelCostOf(p);
    const cost = prodCost + sacCost + labelCost;

    const bulkPct = U.num(p.bulkDiscount !== undefined && p.bulkDiscount !== '' ? p.bulkDiscount : S.bulkDiscount);
    const n = nActive || 1;
    let discount = (idxActive > 0 && n > 1) ? (bulkPct / 100) * (idxActive / (n - 1)) : 0;
    let coeff, priceHT, priceTTC;
    const priceFixed = U.num(v.priceTTCManual) > 0;
    if (priceFixed) {
      priceTTC = U.num(v.priceTTCManual);
      priceHT = priceTTC / (1 + vat);
      coeff = cost > 0 ? priceHT / cost : 0;
    } else {
      // Coefficient propre à la ligne = coefficient final (la décote paliers ne s'y ajoute pas) ;
      // sinon coefficient commun du produit, diminué de la décote du palier (2026-09-27).
      if (U.num(v.coeff) > 0) { coeff = U.num(v.coeff); discount = 0; }
      else coeff = U.num(p.coefficient) || 2;
      priceHT = cost * coeff * (1 - discount);
      priceTTC = priceHT * (1 + vat);
      // Prix TTC calculé toujours arrondi à 0,10 € (4,50 / 4,70…) — demande d'Antho. Un prix saisi
      // à la main (prix fixé) reste exactement tel quel.
      if (priceTTC > 0) {
        priceTTC = Math.round(priceTTC * 10) / 10;
        priceHT = priceTTC / (1 + vat);
        if (discount > 0) discount = cost > 0 && coeff > 0 ? 1 - priceHT / (cost * coeff) : discount;
      }
    }
    const margin = priceHT - cost;
    const social = priceHT * (U.num(S.socialTaxRate) / 100);
    const vatAmt = priceTTC - priceHT;
    const profit = margin - social - vatAmt;
    const effCoeff = cost > 0 ? priceHT / cost : 0;
    return { prodCost, sacCost, labelCost, cost, coeff, discount, priceHT, priceTTC, margin, social, vatAmt, profit, effCoeff, priceFixed, ownCoeff: priceFixed || U.num(v.coeff) > 0, critical: effCoeff < U.num(S.b2bCoeffThreshold) };
  },

  labelVariant(v) {
    if (v.label) return v.label;
    if (v.mode === 'gram') return U.num(v.value) >= 1000 ? (U.num(v.value) / 1000) + 'KG' : v.value + 'G';
    if (v.mode === 'piece') return U.num(v.value) > 1 ? 'Lot de ' + v.value + ' pc' : '1 pièce';
    return 'Taille';
  },

  /* ---------- Accessoires (fabrication) ----------
     { bom:[{materialId, qty}], laborMinutes, extraCost, coefficient } */
  /* Coût de l'impression UV au millilitre (tout compris) :
     encre (prix cartouche ÷ volume) + entretien/solvant par ml. */
  // Coût encre au ml (prix cartouche ÷ volume).
  uvInkPerMl() {
    const S = Store.state.settings;
    const vol = U.num(S.uvCartridgeVolume);
    return vol > 0 ? U.num(S.uvCartridgePrice) / vol : 0;
  },
  // Entretien (filtres/nettoyage/main d'œuvre) = simple majoration % du coût encre — pas de données annuelles.
  uvMaintPerMl() {
    return this.uvInkPerMl() * U.num(Store.state.settings.uvMaintPct) / 100;
  },
  uvCostPerMl() {
    return this.uvInkPerMl() + this.uvMaintPerMl();
  },
  // Amortissement du matériel — liste GÉNÉRALE (imprimante UV, extracteur, scelleuse mastication…), pas propre à l'UV.
  // Charge fixe de l'atelier, déduite du bénéfice net mensuel global. Migre l'ancien slot unique uvEquipPrice/uvEquipYears.
  equipItems() {
    const S = Store.state.settings;
    if (Array.isArray(S.uvEquip) && S.uvEquip.length) return S.uvEquip;
    if (U.num(S.uvEquipPrice) > 0) return [{ id: 'legacy', name: 'Imprimante', price: U.num(S.uvEquipPrice), years: U.num(S.uvEquipYears), buyYear: 0 }];
    return [];
  },
  // Amortissement annuel = somme de (prix ÷ durée) par équipement, arrêté une fois entièrement amorti si l'année d'achat est renseignée.
  equipAmortAnnual() {
    const nowY = new Date().getFullYear();
    let amort = 0;
    this.equipItems().forEach(e => {
      const yrs = U.num(e.years); if (yrs <= 0) return;
      const by = U.num(e.buyYear); if (by > 0 && nowY >= by + yrs) return; // entièrement amorti → ne compte plus
      amort += U.num(e.price) / yrs;
    });
    return amort;
  },
  equipAmortMonthly() { return this.equipAmortAnnual() / 12; },
  // Entretien imprimante UV — coût ANNUEL (filtres + cartouches de nettoyage + main d'œuvre), propre à l'UV.
  // Charge fixe machine : déduite du bénéfice net mensuel (÷12), JAMAIS du prix d'un accessoire.
  uvMaintenanceAnnual() {
    const S = Store.state.settings;
    const filters = U.num(S.uvFilterPrice) * U.num(S.uvFilterPerYear);
    const clean = U.num(S.uvCleanPrice) * U.num(S.uvCleanPerYear);
    const labor = U.num(S.uvMaintHoursPerYear) * U.num(S.laborRate);
    return { filters, clean, labor, total: filters + clean + labor };
  },
  uvMaintenanceMonthly() {
    return this.uvMaintenanceAnnual().total / 12;
  },
  // Charge fixe mensuelle totale déduite du bénéfice net (Tableau de bord + Stats) : entretien UV + amortissement de TOUT le matériel.
  fixedOverheadMonthly() { return this.uvMaintenanceMonthly() + this.equipAmortMonthly(); },

  /* Rentabilité PAR ACTIVITÉ (mastication vs accessoires) sur un ensemble de ventes + N mois de charges fixes.
     Règle : chaque article selon son type ; tout le commun (frais paiement, port, frais d'envoi, frais stand, cartons,
     TVA, charges fixes « commun ») réparti au PRORATA du CA. L'entretien UV → accessoires ; un équipement tagué →
     son activité, « commun » → prorata. La somme des 2 activités = le bénéfice net global (mêmes formules). */
  activityPnL(sales, monthsCount) {
    const S = Store.state.settings;
    const socStd = U.num(S.socialTaxRate) / 100;
    const socHM = (U.num(S.socialTaxRateHandmade) || U.num(S.socialTaxRate)) / 100;
    const vatRate = U.num(S.vatRate), vatActive = S.vatActive;
    const cardRate = U.num(S.cardFeeRate) / 100, stripeRate = U.num(S.stripeFeeRate) / 100;
    const blank = () => ({ ca: 0, cogs: 0, fee: 0, shipFee: 0, shipping: 0, eventFee: 0, box: 0, cotis: 0, tva: 0, fixed: 0 });
    const M = blank(), A = blank();
    (sales || []).forEach(s => {
      if (s.cancelled) return;
      let mCA = 0, aCA = 0, mCogs = 0, aCogs = 0, box = 0;
      (s.items || []).forEach(i => {
        if (i.kind === 'A') { aCA += U.num(i.price) * U.num(i.qty); aCogs += this.saleItemCost(i); }
        else if (i.kind === 'C') { box += this.saleItemCost(i); }
        else { mCA += U.num(i.price) * U.num(i.qty); mCogs += this.saleItemCost(i); }
      });
      const ca = mCA + aCA;
      const mSh = ca > 0 ? mCA / ca : 0.5, aSh = 1 - mSh;
      const shipFee = U.num(s.shippingFeeCollected), shipping = U.num(s.shippingCost), eventFee = Pricing.eventCost(s);
      const cardBase = (s.payment === 'sumup' || s.payment === 'stripe') ? ca + shipFee : 0;
      const fee = s.payment === 'sumup' ? cardBase * cardRate : s.payment === 'stripe' ? cardBase * stripeRate : 0;
      const tva = vatRate > 0 ? ca * vatRate / (100 + vatRate) : 0;
      M.ca += mCA; A.ca += aCA; M.cogs += mCogs; A.cogs += aCogs;
      M.box += box * mSh; A.box += box * aSh;
      M.fee += fee * mSh; A.fee += fee * aSh;
      M.shipFee += shipFee * mSh; A.shipFee += shipFee * aSh;
      M.shipping += shipping * mSh; A.shipping += shipping * aSh;
      M.eventFee += eventFee * mSh; A.eventFee += eventFee * aSh;
      M.tva += tva * mSh; A.tva += tva * aSh;
      // cotisations : port encaissé cotise au taux marchandises (mastication), comme dans la compta globale
      M.cotis += (mCA + shipFee) * socStd; A.cotis += aCA * socHM;
    });
    // Charges fixes réparties sur monthsCount mois
    const totCA = M.ca + A.ca, mShT = totCA > 0 ? M.ca / totCA : 0.5, aShT = 1 - mShT;
    A.fixed += this.uvMaintenanceMonthly() * monthsCount; // entretien imprimante UV → accessoires
    const nowY = new Date().getFullYear();
    this.equipItems().forEach(e => {
      const yrs = U.num(e.years); if (yrs <= 0) return;
      const by = U.num(e.buyYear); if (by > 0 && nowY >= by + yrs) return;
      const monthly = (U.num(e.price) / yrs / 12) * monthsCount;
      const cat = e.category || 'commun';
      if (cat === 'mastication') M.fixed += monthly;
      else if (cat === 'accessoires') A.fixed += monthly;
      else { M.fixed += monthly * mShT; A.fixed += monthly * aShT; }
    });
    [M, A].forEach(x => {
      x.marge = x.ca - x.cogs;
      x.net = x.ca - x.cogs + x.shipFee - x.fee - x.shipping - x.box - x.eventFee - x.cotis - x.fixed - (vatActive ? x.tva : 0);
    });
    return { masti: M, acc: A };
  },

  accCost(a) {
    const S = Store.state.settings;
    const matCost = (a.bom || []).reduce((acc, l) => {
      const unitCost = Accessoires.bomLineCost(l);
      return acc + unitCost * U.num(l.qty);
    }, 0);
    const laborCost = (U.num(a.laborMinutes) / 60) * U.num(S.laborRate);
    const uvCost = U.num(a.uvMl) * this.uvCostPerMl();   // perso UV : ml d'encre × coût/ml
    const cost = matCost + laborCost + U.num(a.extraCost) + uvCost;
    return { matCost, laborCost, extraCost: U.num(a.extraCost), uvCost, cost };
  },
  /* ---------- SKU automatique ---------- */
  slugify(text) {
    return String(text || '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  },

  meatAbbrevMap() {
    const S = Store.state.settings;
    const custom = S.meatAbbrev || {};
    const slugs = (S.meatTypes || []).map(mt => ({
      mt, slug: this.slugify(mt)
    }));
    const map = {};
    for (const { mt, slug } of slugs) {
      if (custom[mt]) { map[slug] = custom[mt]; continue; }
      let len = 3;
      while (len < slug.length && slugs.some(o => o.mt !== mt && o.slug.substring(0, len) === slug.substring(0, len))) len++;
      map[slug] = slug.substring(0, Math.max(3, len));
    }
    return map;
  },

  categoryAbbrevMap(categories, customAbbrev) {
    const custom = customAbbrev || {};
    const slugs = categories.map(c => ({ c, slug: this.slugify(c) }));
    const map = {};
    for (const { c, slug } of slugs) {
      if (custom[c]) { map[slug] = custom[c]; continue; }
      let len = 3;
      while (len < slug.length && slugs.some(o => o.c !== c && o.slug.substring(0, len) === slug.substring(0, len))) len++;
      map[slug] = slug.substring(0, Math.max(3, len));
    }
    return map;
  },

  matAbbrevMap() {
    const S = Store.state.settings;
    return this.categoryAbbrevMap(Object.keys(Stock.matKindLabel), S.matAbbrev || {});
  },

  consoAbbrevMap() {
    const S = Store.state.settings;
    return this.categoryAbbrevMap(S.consCategories || [], S.consoAbbrev || {});
  },

  autoSkuGeneric(productName, category, variantLabel, abbrevMap) {
    let slug = this.slugify(productName);
    const catSlug = this.slugify(category);
    const entries = Object.entries(abbrevMap).sort((a, b) => b[0].length - a[0].length);
    const parts = slug.split('-');
    for (let i = 0; i < parts.length; i++) {
      for (const [full, abbr] of entries) {
        if (full !== abbr && parts[i].length >= full.length && parts[i].startsWith(full)) {
          parts[i] = abbr; break;
        }
      }
    }
    const noise = new Set(['DE', 'D', 'DU', 'DES', 'LE', 'LA', 'LES', 'AU', 'AUX', 'AVEC', 'ET', 'EN']);
    slug = parts.filter(w => !noise.has(w)).join('-');
    slug = slug.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    const prefix = abbrevMap[catSlug] || catSlug.substring(0, 3);
    if (!slug.startsWith(prefix)) slug = prefix + '-' + slug;
    const vLabel = this.slugify(variantLabel);
    return (vLabel ? slug + '-' + vLabel : slug).replace(/-{2,}/g, '-');
  },

  autoSkuMat(productName, kind, variantLabel) {
    return this.autoSkuGeneric(productName, kind, variantLabel, this.matAbbrevMap());
  },

  autoSku(productName, meatType, variantLabel) {
    let slug = this.slugify(productName);
    const abbrevMap = this.meatAbbrevMap();
    const entries = Object.entries(abbrevMap).sort((a, b) => b[0].length - a[0].length);
    const parts = slug.split('-');
    for (let i = 0; i < parts.length; i++) {
      for (const [full, abbr] of entries) {
        if (full !== abbr && parts[i].length >= full.length && parts[i].startsWith(full)) {
          parts[i] = abbr; break;
        }
      }
    }
    const noise = new Set(['DE', 'D', 'DU', 'DES', 'LE', 'LA', 'LES', 'AU', 'AUX', 'AVEC', 'ET', 'EN']);
    slug = parts.filter(w => !noise.has(w)).join('-');
    slug = slug.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    const vLabel = this.slugify(variantLabel);
    return vLabel ? slug + '-' + vLabel : slug;
  },

  /* SKU d'une variante déduit du SKU d'une AUTRE variante du même produit (2026-09-30) :
     « SABOTS-VEAU » (1 pièce) → base « SABOTS-VEAU » → Lot de 2 = « SABOTS-VEAU-LOT2 » ;
     « FRIANDISE-LAP-50G » → base « FRIANDISE-LAP » → 100 g = « FRIANDISE-LAP-100G ».
     ref = variante qui a déjà un SKU ; renvoie la base (sans suffixe de variante) ou '' si indéductible. */
  skuBaseFrom(ref) {
    const s = String(ref && ref.sku || '').trim().toUpperCase(); if (!s) return '';
    const lab = this.slugify(this.skuVariantLabel(ref));
    if (!lab) return s;
    if (s.endsWith('-' + lab)) return s.slice(0, -(lab.length + 1));
    return '';
  },
  skuWithBase(base, v) { const lab = this.slugify(this.skuVariantLabel(v)); return lab ? base + '-' + lab : base; },
  skuVariantLabel(v) {
    if (v.mode === 'gram') return U.num(v.value) >= 1000 ? (U.num(v.value) / 1000) + 'KG' : v.value + 'G';
    // Une seule pièce → AUCUN suffixe (le « -1PC » est redondant : c'est une pièce par défaut).
    // Le suffixe n'a de sens que pour différencier (lot de 2+ → LOT2, LOT5…).
    if (v.mode === 'piece') return U.num(v.value) > 1 ? 'LOT' + v.value : '';
    return v.label || '';
  },

  accCalc(a) {
    const S = Store.state.settings;
    const vat = U.num(S.vatRate) / 100;
    const c = this.accCost(a);
    const storedCoeff = U.num(a.coefficient) || 2;
    let coeff, priceHT, priceTTC, priceFixed = false;
    if (U.num(a.priceTTCManual) > 0) {
      priceFixed = true;
      priceTTC = U.num(a.priceTTCManual);
      priceHT = priceTTC / (1 + vat);
      coeff = c.cost > 0 ? priceHT / c.cost : 0;
    } else {
      coeff = storedCoeff;
      priceHT = c.cost * coeff;
      priceTTC = Math.round(priceHT * (1 + vat) * 10) / 10;
      priceHT = priceTTC / (1 + vat);
    }
    const margin = priceHT - c.cost;
    const social = priceHT * (this.socialRateHandmade() / 100);
    const vatAmt = priceTTC - priceHT;
    const profit = margin - social - vatAmt;
    const effCoeff = c.cost > 0 ? priceHT / c.cost : 0;
    const thr = U.num(S.accCoeffThreshold || S.b2bCoeffThreshold);
    return { ...c, coeff, storedCoeff, priceFixed, priceHT, priceTTC, margin, social, vatAmt, profit, effCoeff, critical: effCoeff < thr };
  },

  /* Coût de revient TOTAL d'une ligne de vente (pour la marge).
     Ventes récentes : `i.cost` a été figé à la vente (exact, coût réel des lots). Ventes
     passées (avant cette fonctionnalité) : estimation avec le coût de revient ACTUEL —
     variante stock (`v.costUnit`) pour la mastication, `accCalc` pour l'accessoire,
     coût unitaire pour le consommable. Renvoie le coût de la ligne entière (× qté). */
  saleItemCost(i) {
    if (i.cost !== undefined && i.cost !== null && i.cost !== '') return U.num(i.cost);
    const qty = U.num(i.qty);
    if (i.kind === 'A') { const a = Store.state.catalogA.find(x => x.id === i.pId); return a ? U.num(this.accCalc(a).cost) * qty : 0; }
    if (i.kind === 'C') { const co = Store.state.consumables.find(x => x.id === i.pId); return co ? U.num(co.costUnit) * qty : 0; }
    const p = Store.state.stockM.find(x => x.id === i.pId);
    const v = p && (p.variants || []).find(x => x.id === i.vId);
    return v ? U.num(v.costUnit) * qty : 0;
  }
};
