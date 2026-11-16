/* ═══════════ Copie « visite » des données (2026-11-16, audit sécurité S1) ═══════════
   Avant : le compte visite recevait les vraies données (prix d'achat, coefficients, noms et liens des fournisseurs, IBAN, SIRET, coordonnées
   des clients sur les factures…) et l'appli se contentait de les flouter à l'écran : tout restait lisible dans l'onglet Réseau du navigateur.
   Maintenant : l'ADMIN publie une copie NETTOYÉE de chaque domaine utile sous les clés `v_<domaine>` de `app_state`, et la base ne donne QUE ces
   clés au compte visite (fonction SQL `app_state_safe`). Ce que le visiteur ne doit pas connaître ne quitte donc plus la base.
   · Prix de vente : figés à leur valeur du moment (`priceTTCManual`), puisque le visiteur n'a plus les coûts pour les recalculer.
   · Coûts, coefficients, taux horaires, frais : à 0 / vides. Fournisseurs : « Fournisseur N », sans lien, référence ni note.
   · Jamais publiés : clients, paniers, achats, réceptions, banque, journal, infos techniques (`meta`).
   La copie part avec l'enregistrement du domaine source (voir `Store.save` / `Store._wire`). Changer une règle de nettoyage → incrémenter `VER`
   (tout est republié à la prochaine ouverture par l'admin). */
const Visite = {
  VER: 1,
  /* domaine source → clés de copie à republier quand il change (un prix figé dépend aussi des réglages, des consommables et des matières) */
  DEPS: {
    catalogM: ['catalogM'], stockM: ['stockM'], catalogA: ['catalogA'], sales: ['sales'],
    materials: ['materials', 'catalogA'], consumables: ['consumables', 'catalogM', 'catalogA'], settings: ['settings', 'catalogM', 'catalogA']
  },
  KEYS: ['settings', 'catalogM', 'stockM', 'catalogA', 'materials', 'consumables', 'sales'],
  keyOf(d) { return 'v_' + d; },
  isKey(k) { return typeof k === 'string' && k.startsWith('v_'); },
  keysFor(domains) { const out = new Set(); domains.forEach(d => (this.DEPS[d] || []).forEach(x => out.add(this.keyOf(x)))); return [...out]; },
  allKeys() { return this.KEYS.map(d => this.keyOf(d)); },

  /* Champs retirés PARTOUT, à n'importe quelle profondeur (filet de sécurité pour un champ ajouté plus tard) */
  ZERO: ['cost', 'costUnit', 'costTotal', 'costFinal', 'unitCost', 'wAvg', 'laborMinutes', 'extraCost', 'eventFee', 'travelCost', 'mealFee', 'shippingCost'],
  DROP: ['url', 'ref', 'notes', 'note', 'costQtyPer', 'costTax', 'costVat', 'purchaseVatRate', 'vatRate', 'priceDate', 'coeff', 'coefficient', 'groupCoeff', 'bulkDiscount',
    'customerName', 'invoice', 'undoOps', '_ops', 'travelDet', 'partnerId', 'partnerName', 'partnerCode', 'partnerPct', 'src', 'replaceNote'],
  _scrub(o) {
    if (Array.isArray(o)) { o.forEach(x => this._scrub(x)); return o; }
    if (!o || typeof o !== 'object') return o;
    Object.keys(o).forEach(k => {
      if (this.DROP.includes(k)) delete o[k];
      else if (this.ZERO.includes(k)) o[k] = 0;
      else this._scrub(o[k]);
    });
    return o;
  },
  _clone(x) { return JSON.parse(JSON.stringify(x === undefined ? null : x)); },
  _r2(x) { return Math.round(U.num(x) * 100) / 100; },

  /* Réglages : tout ce qui est financier, bancaire, légal ou lié aux fournisseurs / partenaires est retiré ou mis à 0 */
  SET_DROP: ['suppliersOther', 'partners', 'links', 'eventInfo', 'b2bLastExport', 'fabHistory', 'fabQueue', 'wooLinks', 'sumupLinks',
    'faAddress', 'faEmail', 'faLegal', 'faName', 'faNote', 'faPenalties', 'faPhone', 'faSiret', 'faTerms',
    'payBic', 'payCash', 'payHolder', 'payIban', 'payMessage', 'payOther', 'payVirement', 'uvEquip', 'portRates'],
  SET_ZERO: ['laborRate', 'labelCost', 'uvCartridgePrice', 'uvFilterPrice', 'uvCleanPrice', 'uvEquipPrice', 'uvEquipYears', 'uvMaintPct', 'uvMaintHoursPerYear', 'kwhPrice',
    'laserWearPerHour', 'print3dWearPerHour', 'comptaExtraServices', 'b2bCoeffThreshold', 'accCoeffThreshold', 'fuelPrice', 'fuelConsumption', 'shippingCost'],
  settings() {
    const S = this._clone(Store.state.settings) || {};
    this.SET_DROP.forEach(k => delete S[k]);
    this.SET_ZERO.forEach(k => { if (k in S) S[k] = 0; });
    S.suppliers = (Store.state.settings.suppliers || []).map((s, i) => ({ id: s.id, name: 'Fournisseur ' + (i + 1), types: s.types }));
    (S.sachets || []).forEach(x => { x.cost = 0; });
    (S.labelTypes || []).forEach(x => { x.cost = 0; });
    this._scrub(S);
    S.vatRate = Store.state.settings.vatRate;   // le taux de TVA de vente est public (retiré par le filet « vatRate », remis ici)
    S._v = this.VER;
    return S;
  },
  catalogM() {
    const on = !!Store.state.settings.priceBaseHT;
    return (Store.state.catalogM || []).map(p => {
      let calc = [];
      try { calc = Pricing._calcAllM(p, on); } catch (e) { console.error(e); }
      const c = this._clone(p);
      c.suppliers = (p.suppliers || []).map(s => ({ id: s.id, supplierId: s.supplierId, unit: s.unit || 'kilo', taxType: 'HT', price: '', weight: 1, quantity: 1, piecesPerKilo: '' }));
      (c.variants || []).forEach((v, i) => {
        v.priceTTCManual = calc[i] ? this._r2(calc[i].priceTTC) : 0;   // prix de vente figé (plus de coût pour le recalculer)
        if (v.mode === 'size') v.value = '';                            // en mode « taille », `value` est un prix d'achat
      });
      c.labelCost = 0;
      this._scrub(c);
      if (p.vatRate !== undefined) c.vatRate = p.vatRate;               // TVA de vente de la fiche : publique
      return c;
    });
  },
  catalogA() {
    return (Store.state.catalogA || []).map(a => {
      let ttc = 0;
      try { ttc = Pricing.accCalc(a).priceTTC; } catch (e) { console.error(e); }
      const c = this._clone(a);
      c.priceTTCManual = this._r2(ttc);
      c.uvMl = 0; c.laserMin = 0; c.print3dMin = 0;
      return this._scrub(c);
    });
  },
  plain(d) { return this._scrub(this._clone(Store.state[d]) || []); },
  stockM() {
    const out = this.plain('stockM');
    out.forEach(p => (p.variants || []).forEach(v => { if (v.mode === 'size') v.value = ''; }));   // en mode « taille », `value` peut reprendre le prix d'achat de la fiche
    return out;
  },
  /* Donnée envoyée pour une clé `v_…` */
  wire(k) {
    const d = k.slice(2);
    if (d === 'settings') return this.settings();
    if (d === 'catalogM') return this.catalogM();
    if (d === 'catalogA') return this.catalogA();
    if (d === 'stockM') return this.stockM();
    if (d === 'materials' || d === 'consumables' || d === 'sales') return this.plain(d);
    return null;
  },
  /* Première publication (ou règles de nettoyage changées) : tout republier une fois par ouverture de l'appli. Admin seulement.
     `meta.viewerVer` n'est posé qu'APRÈS l'envoi réussi de toutes les clés (voir afterFlush) ; un échec est noté dans `meta.viewerErr` (lisible en base pour le diagnostic). */
  _pending: false, _tried: false, _ok: new Set(),
  publishAll() {
    if (!Store.remote || !Store.isAdmin() || this._tried) return;
    this._tried = true; this._pending = true; this._ok = new Set();
    this.allKeys().forEach(k => Store._dirty.add(k));
    Store.save();   // déclenche l'envoi
  },
  afterFlush(sent, errs) {
    if (!Store.isAdmin()) return;
    const m = Store.state.meta || (Store.state.meta = {});
    const mine = (errs || []).filter(e => this.isKey(e));
    if (mine.length) { const msg = mine.join(' | ').slice(0, 400); if (m.viewerErr !== msg) { m.viewerErr = msg; Store.save('meta'); } return; }
    (sent || []).forEach(k => { if (this.isKey(k)) this._ok.add(k); });
    if (this._pending && this.allKeys().every(k => this._ok.has(k))) {
      this._pending = false; m.viewerVer = this.VER; delete m.viewerErr; Store.save('meta');
    }
  }
};
