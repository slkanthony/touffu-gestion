/* ============================================================
   STORE — état de l'application, persistance & synchronisation
   Mode local  : localStorage (aucune config requise)
   Mode nuage  : Supabase (auth email/mdp, table app_state,
                 journal + instantanés quotidiens, temps réel)
   ============================================================ */
const Store = {
  DOMAINS: ['settings', 'catalogM', 'stockM', 'materials', 'catalogA', 'consumables', 'sales', 'clients', 'baskets', 'purchases', 'receptions', 'bank', 'journal', 'meta', 'panLearn'],   // panLearn : ce que le générateur de paniers apprend d'Antho (2026-11-19)
  state: null,
  sb: null,            // client supabase
  session: null,
  remote: false,
  _dirty: new Set(),
  _saveT: null,

  defaults() {
    return {
      panLearn: { p: {} },
      settings: {
        portRates: { mastication: 0, matiere: 0, conso: 0 },   // port à l'achat (%) ajouté au coût de revient pour fixer les prix
        vatRate: 20, vatActive: false, socialTaxRate: 12.3, socialTaxRateHandmade: 21.2, cardFeeRate: 1.75, stripeFeeRate: 1.5,
        urssafFreq: 'quarter', comptaExtraServices: 0,   // Compta : déclaration URSSAF mensuelle / trimestrielle ; CA hors application (éducation canine…) de l'année en cours
        laborRate: 20, thanksConsoId: '', cardConsoId: '', shipLabelConsoId: '', labelCost: 0.10, fabHistory: [], bulkDiscount: 0, b2bCoeffThreshold: 1.0, accCoeffThreshold: 2.0, panCoeffTarget: 2.0, accPriceStep: 0.5, accPersoUv: 5, accPersoLaser: 3, accPersoTheme: 10, snapRetentionDays: 30,
        uvCartridgePrice: 42, uvCartridgeVolume: 100, // impression UV : coût encre/ml = prix ÷ volume
        uvMaintPct: 0, // + majoration entretien optionnelle (% du coût encre) — filtres/nettoyage/entretien
        laserWatts: 0, kwhPrice: 0, laserWearPerHour: 0, print3dWatts: 0, print3dWearPerHour: 0, // gravure laser : puissance (W), prix de l'électricité (€/kWh), usure/entretien du laser (€/h, facultatif)
        // Entretien imprimante UV — charges annuelles (déduites du bénéfice net mensuel ÷ 12, PAS du prix de l'accessoire)
        uvFilterPrice: 0, uvFilterPerYear: 0, // prix d'un filtre × nb de changements/an
        uvCleanPrice: 0, uvCleanPerYear: 0, // prix d'une cartouche de nettoyage × nb/an
        uvMaintHoursPerYear: 0, // heures d'entretien/an (valorisées au taux main d'œuvre laborRate)
        uvEquip: [], // amortissement matériel : liste d'équipements {id,name,category,price,years,buyYear} — chacun amorti indépendamment (prix ÷ durée)
        finOrder: [], // ordre déplaçable des blocs de Réglages financiers (↑↓) — vide = ordre par défaut
        uvEquipPrice: 0, uvEquipYears: 0, // LEGACY (ancien slot unique) — migré vers uvEquip, conservé pour compat
        dluoAlertDays: 30,
        meatTypes: ['Agneau', 'Autruche', 'Boeuf', 'Buffle', 'Canard', 'Cerf', 'Chameau', 'Cheval', 'Chevreuil', 'Cornes', 'Dinde', 'Lapin', 'Mouton', 'Poisson', 'Porc', 'Poulet', 'Sanglier', 'Autre'],
        accCategories: ['Collier', 'Laisse', 'Longe', 'Laisse 3 points', 'Harnais', 'Autre'],
        productTypes: [{ value: 'occupation', label: 'Occupation (mastication)' }, { value: 'education', label: 'Éducation (friandises)' }],
        accFabDefaults: {
          'Collier':         { segments: [{label: 'Attache + anneau D', value: 0}, {label: 'Trous de réglage', value: 0}] },
          'Laisse':          { segments: [{label: 'Rabat (mousqueton)', value: 0}, {label: 'Poignée', value: 0}] },
          'Longe':           { segments: [{label: 'Rabat (mousqueton)', value: 0}, {label: 'Poignée', value: 0}] },
          'Laisse 3 points': { segments: [{label: 'Rabat (mousqueton)', value: 0}, {label: 'Poignée', value: 0}] },
          'Harnais':         { segments: [{label: 'Extrémité 1', value: 0}, {label: 'Extrémité 2', value: 0}] },
          'Autre':           { segments: [{label: 'Extrémité 1', value: 0}, {label: 'Extrémité 2', value: 0}] }
        },
        widths: ['10mm', '16mm', '20mm', '25mm'],
        consCategories: ['Cartons', 'Sachets', 'Blisters', 'Étiquettes', 'Étiquettes d\'envoi', 'Encre UV', 'Nettoyant UV', 'Filtre UV', 'Entretien UV', 'Autre'],
        suppliers: [{ id: 's1', name: 'Cernunos' }, { id: 's2', name: 'Kuaurtikel' }],
        events: [], eventInfo: {}, fuelConsumption: 7, fuelPrice: 1.85,
        sachets: [],   // {id, name, cost, type}
        meatAbbrev: {}, // {meatType: 'ABBR'} — surcharge l'auto-abréviation
        matAbbrev: {},  // {matKind: 'ABBR'} — abréviations catégories matières (Sangle→SAN)
        consoAbbrev: {}, // {consoCategory: 'ABBR'} — abréviations catégories consommables
        blisterRolls: {}, // {widthMm: {consumableId}} — lie chaque largeur de blister à un consommable en stock
        materialKinds: [ // catégories de matières éditables (référentiel) — 'sangle' garde le comportement rouleaux ; les autres suivent leur unité
          { value: 'sangle', label: 'Sangle' },
          { value: 'sangle-hexa', label: 'Sangle HEXA' },
          { value: 'sangle-reflechissante', label: 'Sangle réfléchissante' },
          { value: 'bouclerie', label: 'Bouclerie' },
          { value: 'filament', label: 'Filament 3D' },
          { value: 'autre', label: 'Autre' }
        ],
        strapWeights: {}, // {'<kind>|<type> <largeur>': {w, q}} — poids de réf. des matières en mode "partagé" pour le 🧮 Calculateur : w g = q m
        calcRefMode: { sangle: 'shared', bouclerie: 'perItem', autre: 'perItem' }, // 🧮 Calculateur : mode de référence par catégorie de matière ('shared' = partagée par largeur/type ; 'perItem' = par article)
        variantPresets: { gram: [50, 100, 250, 500, 1000], piece: [1, 2, 3, 4, 5], size: ['S', 'M', 'L', 'XL'] },
        sumupLinks: {}, // liaisons manuelles {SKU appli: identifiant de la ligne SumUp (Variant id, sinon Item id)} : SumUp reçoit le SKU de l'appli à l'import — voir Woo.openSumupLink
        wooLinks: {},// liaisons manuelles {SKU appli: ID de la fiche du site} : fiche du site à laquelle on remplace l'UGS (l'appli reste prioritaire) — voir Woo.openLink
        wooExclude: [], // SKU exclus DÉFINITIVEMENT de l'export WooCommerce (produits événement-only, tests…) — jamais envoyés au site
        links: [{ id: 'caisse', emoji: '🧾', label: 'Caisse', url: 'https://touffu-caisse.duckdns.org/#/calculette' }], // 🔗 Mes liens (Paramètres) : {id, emoji, label, url} — « caisse » est verrouillé (bouton dans Ventes, seule l'adresse change)
        sumupExclude: [] // SKU (majuscules) exclus DÉFINITIVEMENT de l'export SumUp (ex: sachets 500g+ jamais emmenés sur les marchés) — jamais proposés à l'export
      },
      catalogM: [],    // produits mastication (tarification) — voir pricing.js
      stockM: [],      // stock mastication : {id, catalogId, name, meatType, variants:[{id,label,mode,value,priceTTC,lots:[{id,lotNumber,dluo,qtyGeneral,qtyEvent,costUnit}]}]}
      materials: [],   // matières accessoires : {id,name,kind,unit,costUnit,qty,low}
      catalogA: [],    // accessoires finis : {id,name,category,bom:[{materialId,qty}],laborMinutes,extraCost,coefficient,stockGeneral,stockEvent,low,sku}
      consumables: [], // {id,name,category,unit,qty,low,costUnit}
      sales: [],       // ventes — voir ventes.js
      baskets: [],     // paniers / devis en attente (admin + équipe, pas le profil visite) : {id,ts,name,label,note,validUntil,items,budget,livraison}
      purchases: [],   // achats (admin seulement) : factures saisies — voir achats.js
      receptions: [],  // copie SANS PRIX des commandes « à recevoir » (id = facture) : lignes + coches + n° de lot + DLUO ; l'équipe y écrit (page Réception), l'admin la tient à jour — voir Achats.syncReceptions
      bank: { points: [], moves: [] },   // pointage bancaire (admin seulement) : soldes relevés + mouvements hors appli — voir compta.js
      journal: [],     // {id,ts,action,label,undo}
      meta: { lastSnapshotDay: '' }
    };
  },

  /* ---------- initialisation ---------- */
  async init() {
    const cfg = window.TOUFFU_CONFIG || {};
    if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
      this.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const isRecovery = window.location.hash.includes('type=recovery') || window.location.hash.includes('type=invite');
      const { data } = await this.sb.auth.getSession();
      this.session = data.session;
      if (isRecovery && this.session) return 'recovery';
      if (!this.session) return 'login';           // l'app affichera l'écran de connexion
      await this.loadRemote();
      this.remote = true;
      this.listenRealtime();
    } else {
      this.loadLocal();
    }
    await this.dailySnapshot();
    return 'ready';
  },

  async login(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.session = data.session;
    await this.loadRemote();
    this.remote = true;
    this.listenRealtime();
    await this.dailySnapshot();
  },
  async logout() { await this.sb?.auth.signOut(); location.reload(); },

  loadLocal() {
    const raw = localStorage.getItem('touffu_state');
    let parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); }
      catch (e) {
        // localStorage corrompu : on ne bloque pas le démarrage (sinon écran blanc).
        // Sauvegarde de secours du contenu illisible, puis repart sur les valeurs par défaut.
        console.error('touffu_state illisible, réinitialisation :', e);
        try { localStorage.setItem('touffu_state_corrupt_backup', raw); } catch (_) {}
      }
    }
    this.state = this.merge(parsed);
  },

  /* Rôle du compte connecté (app_metadata.role) : 'admin' (ou absent, ancien fonctionnement), 'team', 'viewer'. Point d'entrée unique (audit sécurité 2026-11-16). */
  roleOf() { const r = this.session && this.session.user && this.session.user.app_metadata && this.session.user.app_metadata.role; return r || 'admin'; },
  isAdmin() { return this.roleOf() === 'admin'; },
  /* COFFRE DU JOURNAL (audit sécurité 2026-11-16, S2). Le journal est lisible par l'équipe ; or « Annuler » garde une copie de la fiche d'avant, y compris des
     factures d'achat et du pointage bancaire (réservés à l'admin). Ces copies-là ne partent donc plus dans la clé `journal` : elles vont dans la clé
     `journalAdmin` ({ idEntrée: undo }, lisible par l'admin seulement — règle RLS), et l'entrée envoyée porte `undo: { type: 'vault' }`.
     EN MÉMOIRE rien ne change pour l'admin (l'entrée garde son vrai `undo`, remis au chargement) ; l'équipe reçoit `undo: null` (pas de bouton « Annuler »). */
  PRIVATE_UNDO_DOMAINS: ['purchases', 'bank'],
  _undoPrivate(u) {
    if (!u || !u.type || u.type === 'vault') return false;
    if (u.type === 'bankItem') return true;
    const snaps = Array.isArray(u.data) ? u.data : (u.data && typeof u.data === 'object' ? [u.data] : []);
    return snaps.some(x => x && this.PRIVATE_UNDO_DOMAINS.includes(x.domain));
  },
  /* Donnée réellement envoyée à Supabase pour une clé (les autres clés partent telles quelles). */
  _wire(k) {
    const J = this.state.journal || [];
    if (k === 'journal') return J.map(e => this._undoPrivate(e.undo) ? { ...e, undo: { type: 'vault' } } : e);
    if (typeof Visite !== 'undefined' && Visite.isKey(k)) return Visite.wire(k);
    if (k === 'journalAdmin') { const o = {}; J.forEach(e => { if (this._undoPrivate(e.undo)) o[e.id] = e.undo; }); return o; }
    return this.state[k];
  },
  /* Au chargement : l'admin retrouve ses copies depuis le coffre ; les autres profils n'ont pas de bouton « Annuler » sur ces entrées. Renvoie true si le journal
     distant contient encore des copies réservées (journal d'avant le coffre) → à renvoyer une fois, nettoyé. */
  _unvault(journal, vault) {
    let legacy = false; const admin = this.isAdmin();
    (journal || []).forEach(e => {
      if (!e) return;
      if (admin) { if (this._undoPrivate(e.undo)) legacy = true; else if (vault && vault[e.id]) e.undo = vault[e.id]; else if (e.undo && e.undo.type === 'vault') e.undo = null; }
      else if (e.undo && (e.undo.type === 'vault' || this._undoPrivate(e.undo))) e.undo = null;
    });
    return legacy;
  },

  _saveSeq: 0,
  DOMAIN_NAMES: { stockM: 'stock mastication', catalogM: 'fiches Prix mastication', catalogA: 'accessoires', materials: 'matières premières', consumables: 'consommables', settings: 'réglages', sales: 'ventes', clients: 'clients', baskets: 'paniers en attente', purchases: 'achats', journalAdmin: 'copies d’annulation des achats', receptions: 'réception des commandes', journal: 'journal', meta: 'infos techniques' },
  /* VERSIONS (audit A1, 2026-11-16) : chaque clé de `app_state` porte un numéro `rev` qui avance à chaque écriture (voir supabase_versions_2026-11-16.sql).
     · Au chargement on lit d'abord seulement les numéros (quelques octets) et on ne télécharge que les clés qui ont changé ;
     · à l'enregistrement on renvoie le numéro qu'on avait chargé : si un autre appareil a écrit entre-temps, la base refuse TOUT (voir flush / _onConflict). */
  _rev: {},
  _vault: null,   // dernier coffre du journal chargé (admin)
  async loadRemote() {
    const seq = this._saveSeq;
    // Profil visite : la base refuse la lecture directe ; il passe par une fonction SQL qui ne rend que la copie nettoyée (clés v_…, voir visite.js).
    const isViewer = (this.session && this.session.user && this.session.user.app_metadata && this.session.user.app_metadata.role) === 'viewer';
    const full = isViewer || !this.state;
    let rows = [], heads = null;
    if (isViewer) {
      const { data, error } = await this.sb.rpc('app_state_safe');
      if (error) throw error;
      rows = data || [];
    } else {
      const h = await this.sb.from('app_state').select('key,rev');
      if (h.error) throw h.error;
      heads = (h.data || []).filter(x => !(typeof Visite !== 'undefined' && Visite.isKey(x.key)));   // les copies « visite » (clés v_…) ne sont jamais rechargées par l'admin ni l'équipe
      const want = heads.filter(x => full || this._rev[x.key] !== x.rev).map(x => x.key);
      if (!full && !want.length) return false;   // rien n'a changé ailleurs : on garde l'état en mémoire tel quel
      if (want.length) {
        const d = await this.sb.from('app_state').select('key,data,rev').in('key', want);
        if (d.error) throw d.error;
        rows = d.data || [];
      }
    }
    // ⚠️ Course corrigée (2026-09-30, « je dois enregistrer plusieurs fois ») : la réponse arrive APRÈS coup. Si pendant
    // l'attente une fenêtre d'édition s'est ouverte (elle garde des références vers l'ANCIENS objets) ou si on a modifié /
    // enregistré quelque chose, appliquer cette réponse écraserait le travail en cours → on l'abandonne.
    if (this._saveSeq !== seq || this._dirty.size || this._flushing || this._modalOpen()) { if (this._modalOpen()) this._pendingReload = true; return false; }
    const obj = {};
    if (!full) this.DOMAINS.forEach(d => { obj[d] = this.state[d]; });   // rechargement partiel : les clés inchangées gardent leur valeur en mémoire
    rows.forEach(r => {
      if (!full && r.rev !== undefined && r.rev !== null && (this._rev[r.key] || 0) > r.rev) return;   // déjà plus récent (reçu d'un autre onglet)
      obj[r.key] = r.data; if (r.rev !== undefined && r.rev !== null) this._rev[r.key] = r.rev;
    });
    const gotJournal = rows.some(r => r.key === 'journal'), gotVault = rows.find(r => r.key === 'journalAdmin');
    if (gotVault) this._vault = gotVault.data;
    const role = this.session && this.session.user && this.session.user.app_metadata && this.session.user.app_metadata.role;
    if (role === 'team') delete obj.bank;   // soldes bancaires : admin seulement (la base ne bloque la lecture qu'après le SQL de supabase_schema.sql)
    if (isViewer) { delete obj.baskets; delete obj.purchases; delete obj.receptions; delete obj.bank; }   // paniers en attente = noms de clientes ; achats = comptabilité : jamais pour un visiteur
    this.state = this.merge(obj);
    if ((full || gotJournal) && this._unvault(this.state.journal, this._vault) && !this._vaultMig) { this._vaultMig = true; setTimeout(() => this.save('journal'), 0); }   // une fois : sort du journal les copies d'achats / de banque déjà enregistrées
    if (this.isAdmin() && typeof Visite !== 'undefined' && this.state.meta.viewerVer !== Visite.VER) setTimeout(() => { try { Visite.publishAll(); } catch (e) { console.error(e); } }, 1500);   // copie nettoyée du compte visite : première publication (ou règles changées)
    if (!isViewer && role !== 'team') setTimeout(() => { try { if (typeof Achats !== 'undefined') Achats.syncReceptions(); } catch (e) { console.error(e); } }, 0);   // admin : reprend ce que l'équipe a coché / saisi et met la copie sans prix à jour
    if (!isViewer && role !== 'team') setTimeout(() => { try { this.autoPriceBase(); this.normSingleCoeff(); } catch (e) { console.error(e); } }, 50);   // admin : passage automatique (une seule fois) à la base de prix HT
    // première utilisation : pousser les valeurs par défaut
    if (heads && !heads.length) { this.DOMAINS.forEach(d => this._dirty.add(d)); await this.flush(); }
    return true;
  },

  /* Base de prix HT universelle (Antho 2026-11-08) : appliquée AUTOMATIQUEMENT une seule fois, à la première ouverture après la mise à jour (admin). Les prix TTC ne bougent pas (coefficients recalculés,
     prix qui tomberaient à côté figés) ; si un seul prix devait bouger, rien n'est appliqué. Annulable dans le Journal. Voir Pricing.priceBasePlan / applyPriceBase. */
  autoPriceBase() {
    const S = this.state && this.state.settings; if (!S || S.priceBaseHT || this._modalOpen() || this._dirty.size) return;
    if (!(this.state.catalogM || []).length && !(this.state.catalogA || []).length) { S.priceBaseHT = true; this.save('settings'); return; }   // base vide : directement la nouvelle formule
    const r = Pricing.applyPriceBase(); if (!r) return;
    if (r.blocked) { console.warn('Base de prix HT : non appliquée,', r.bad, 'prix auraient bougé'); U.toast('Nouveau calcul des prix NON appliqué : ' + r.bad + ' prix auraient changé. Rien n’a bougé, préviens Claude.', true); return; }
    U.toast(`Prix recalculés sur une base HT : ${r.plan.lines} prix inchangés, ${r.plan.frozen} fixés pour ne pas bouger. Coefficients mis à jour.`, false, r.entry.id);
    if (window.App && App.rerender) App.rerender();
  },
  /* Produit à UNE seule variante active : son coefficient EST le coefficient commun (Antho 2026-11-08, « le coef c'est le coef, point »). Aligne `coefficient` sur celui de la ligne (prix fixé ou coeff propre) :
     le prix ne bouge pas (prix fixé inchangé ; coeff propre = même valeur). Idempotent, annulable (Journal). */
  normSingleCoeff() {
    const S = this.state && this.state.settings; if (!S || !S.priceBaseHT || this._modalOpen() || this._dirty.size) return;
    const snaps = [];
    (this.state.catalogM || []).forEach(p => {
      const act = (p.variants || []).filter(v => v.enabled !== false); if (act.length !== 1) return;
      const v = act[0]; if (!(U.num(v.priceTTCManual) > 0) && !(U.num(v.coeff) > 0)) return;
      const k = Math.round(Pricing.variantCalc(p, v, 0, Pricing.baseUnitCost(p), 1).coeffU * 10000) / 10000;
      if (!(k > 0) || (Math.abs(U.num(p.coefficient) - k) < 0.00005 && !(U.num(v.coeff) > 0))) return;
      const before = JSON.parse(JSON.stringify(p));
      p.coefficient = k; if (U.num(v.coeff) > 0) v.coeff = '';
      const after = Math.round(Pricing.variantCalc(p, v, 0, Pricing.baseUnitCost(p), 1).priceTTC * 100) / 100, was = Math.round(Pricing.variantCalc(before, before.variants.find(x => x.id === v.id), 0, Pricing.baseUnitCost(before), 1).priceTTC * 100) / 100;
      if (Math.abs(after - was) > 0.001) { Object.keys(p).forEach(x => delete p[x]); Object.assign(p, before); return; }   // sécurité : jamais de prix qui bouge
      snaps.push({ domain: 'catalogM', id: p.id, before });
    });
    if (!snaps.length) return;
    this.log('catalogue', `Coefficient commun aligné sur la variante unique : ${snaps.length} produit(s)`, { type: 'restoreBatch', data: snaps });
    this.save('catalogM');
    if (window.App && App.rerender) App.rerender();
  },
  merge(loaded) {
    const s = this.defaults();
    if (loaded) this.DOMAINS.forEach(d => {
      if (loaded[d] !== undefined && loaded[d] !== null) {
        s[d] = (d === 'settings' || d === 'meta') ? { ...s[d], ...loaded[d] } : loaded[d];
      }
    });
    this._fillDefaultVariantPresets(s);
    this.migrateCatalogSuppliers(s);
    this.migrateSachetDims(s);
    this.migrateFabSegments(s);
    this.migrateLabelTypes(s);
    this.migratePackSkus(s);
    this.migrateSuppliers(s);
    this.migrateMatTax(s);
    this.migrateSangleKinds(s);
    this.migrateSangleStock(s);
    this.migrateFilamentKind(s);
    this.migrateUvCategories(s);
    return s;
  },
  /* (2026-10-28) Le stock d'une sangle = la somme de ses ROULEAUX (en mètres). Une sangle sans rouleau n'a donc pas de stock : les
     valeurs « fantômes » de l'ancien inventaire (saisies à la main) sont remises à 0. Idempotent. */
  migrateSangleStock(s) {
    (s.materials || []).forEach(m => { if (this.isSangleKind(m.kind) && !(m.rolls && m.rolls.length) && U.num(m.qty) !== 0) m.qty = 0; });
  },
  /* (2026-10-14) Catégories de consommables « Encre UV » et « Nettoyant UV » : l'ancienne « Encre » est renommée (ses consommables suivent),
     « Nettoyant UV » est ajoutée. UNE fois (flag : si Antho en supprime une, elle ne revient pas). Le coût de l'encre au ml = moyenne des consommables « Encre UV » (`Pricing.uvInkCartridge`). */
  migrateUvCategories(s) {
    const S = s.settings; if (!S) return;
    const norm = x => String(x || '').trim().toLowerCase();
    if (!S.uvFilterCatMigrated) {   // « Filtre UV » (filtre charbon) ajoutée une fois, 2026-10-14
      S.uvFilterCatMigrated = true;
      if (Array.isArray(S.consCategories) && !S.consCategories.some(c => norm(c) === 'filtre uv')) S.consCategories.push('Filtre UV');
    }
    if (!S.uvEntretienCatMigrated) {   // « Entretien UV » (alcool, tampons, tapis…) ajoutée une fois, 2026-10-14
      S.uvEntretienCatMigrated = true;
      if (Array.isArray(S.consCategories) && !S.consCategories.some(c => norm(c) === 'entretien uv')) S.consCategories.push('Entretien UV');
    }
    if (!S.shipLabelCatMigrated) {   // « Étiquettes d'envoi » (étiquette collée sur les colis) ajoutée une fois, 2026-10-15, juste après « Étiquettes »
      S.shipLabelCatMigrated = true;
      if (Array.isArray(S.consCategories) && !S.consCategories.some(c => norm(c) === "étiquettes d'envoi")) { const i = S.consCategories.findIndex(c => norm(c) === 'étiquettes'); S.consCategories.splice(i >= 0 ? i + 1 : S.consCategories.length, 0, "Étiquettes d'envoi"); }
    }
    if (S.uvCatsMigrated) return;
    S.uvCatsMigrated = true;
    if (!Array.isArray(S.consCategories)) return;
    const had = S.consCategories.some(c => norm(c) === 'encre uv');
    if (S.consCategories.some(c => norm(c) === 'encre')) {
      S.consCategories = S.consCategories.filter(c => norm(c) !== 'encre');
      if (!had) S.consCategories.push('Encre UV');
    } else if (!had) S.consCategories.push('Encre UV');
    if (!S.consCategories.some(c => norm(c) === 'nettoyant uv')) S.consCategories.push('Nettoyant UV');
    (s.consumables || []).forEach(c => { if (norm(c.category) === 'encre') c.category = 'Encre UV'; });
  },
  /* (2026-10-03) Une seule liste de fournisseurs avec des types. Les anciens fournisseurs « de produits » reçoivent
     mastication + matières + consommables ; ceux de l'ancienne liste « autres » (suppliersOther) sont repris avec leur id
     (les factures restent valides) et le type « autre ». Idempotent. */
  /* (2026-10-04) Prix d'achat des matières saisis HT ou TTC. Les sangles déjà saisies à la main sont des prix TTC
     du fournisseur (TVA 21 %) → passées en « TTC 21 % ». Une matière dont le coût vient d'une facture d'Achats
     (coût incohérent avec « prix / quantité ») est déjà un coût réel HT : gardée en HT. Idempotent (costTax posé une fois). */
  /* (2026-10-04) Trois catégories de sangles : « Sangle », « Sangle HEXA », « Sangle réfléchissante » (moyennes séparées dans Accessoires, références
     séparées dans le Calculateur). Ajoutées UNE fois aux catégories existantes (flag : si Antho en supprime une, elle ne revient pas) avec une abréviation
     SKU fixe (sinon « sangle » deviendrait « SANGLE- » à cause du préfixe commun). Toute catégorie dont la valeur commence par « sangle » a le comportement
     sangle (rouleaux) : `Store.isSangleKind`. */
  migrateSangleKinds(s) {
    const S = s.settings; if (!S || S.sangleKindsMigrated) return;
    if (Array.isArray(S.materialKinds) && S.materialKinds.length) {
      const add = [{ value: 'sangle-hexa', label: 'Sangle HEXA' }, { value: 'sangle-reflechissante', label: 'Sangle réfléchissante' }];
      let at = S.materialKinds.findIndex(k => k.value === 'sangle'); at = at >= 0 ? at + 1 : S.materialKinds.length;
      add.forEach(k => { if (!S.materialKinds.some(x => x.value === k.value)) { S.materialKinds.splice(at, 0, k); at++; } });
    }
    S.matAbbrev = Object.assign({ 'sangle': 'SAN', 'sangle-hexa': 'HEX', 'sangle-reflechissante': 'REF' }, S.matAbbrev || {});
    S.sangleKindsMigrated = true;
  },
  isSangleKind(kind) { return String(kind || '').toLowerCase().startsWith('sangle'); },
  /* Unité d'une matière : m (sangle…), g (filament 3D : stock en grammes, prix de la bobine ÷ son poids), sinon PCS */
  matUnitLabel(unit) { return unit === 'm' ? 'm' : unit === 'g' ? 'g' : 'PCS'; },
  /* (2026-10-17) Catégorie « Filament 3D » ajoutée UNE fois aux catégories existantes (flag : si Antho la supprime, elle ne revient pas), abréviation SKU FIL. */
  migrateFilamentKind(s) {
    const S = s.settings; if (!S || S.filamentKindMigrated) return;
    if (Array.isArray(S.materialKinds) && S.materialKinds.length && !S.materialKinds.some(k => k.value === 'filament')) {
      let at = S.materialKinds.findIndex(k => k.value === 'bouclerie'); at = at >= 0 ? at + 1 : S.materialKinds.length;
      S.materialKinds.splice(at, 0, { value: 'filament', label: 'Filament 3D' });
    }
    S.matAbbrev = Object.assign({ 'filament': 'FIL' }, S.matAbbrev || {});
    S.filamentKindMigrated = true;
  },
  migrateMatTax(s) {
    (s.materials || []).forEach(m => {
      if (m.costTax) return;
      const q = Number(m.costQtyPer) > 0 ? Number(m.costQtyPer) : 1, cu = Number(m.costUnit) || 0;
      const typed = m.costTotal == null || Math.abs(Number(m.costTotal) / q - cu) < 0.0005;
      if (m.kind === 'sangle' && typed) {
        if (m.costTotal == null) m.costTotal = cu;
        m.costQtyPer = q; m.costTax = 'TTC'; m.costVat = 21;
        m.costUnit = Number(m.costTotal) / q / 1.21;
      } else {
        if (m.costTotal == null || !typed) { m.costTotal = cu; m.costQtyPer = 1; }
        m.costTax = 'HT';
      }
    });
  },
  migrateSuppliers(s) {
    const S = s.settings; if (!S) return;
    if (!Array.isArray(S.suppliers)) S.suppliers = [];
    S.suppliers.forEach(x => { if (!Array.isArray(x.types) || !x.types.length) x.types = ['mastication', 'matiere', 'conso']; });
    // TVA d'achat par fournisseur (2026-10-08) : valeurs proposées tant que rien n'a été saisi (jamais d'écrasement ; vide « » saisi = volontaire)
    const supVatDefaults = { kuaurtikel: 10, cernunos: 20, masticorp: 20, psf: 20 };
    S.suppliers.forEach(x => {
      const k = String(x.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
      if (x.purchaseVatRate === undefined && k in supVatDefaults) x.purchaseVatRate = supVatDefaults[k];
    });
    const oth = Array.isArray(S.suppliersOther) ? S.suppliersOther : [];
    oth.forEach(o => { if (o && o.id && !S.suppliers.some(x => x.id === o.id)) S.suppliers.push({ id: o.id, name: o.name, types: ['autre'] }); });
    if (oth.length) S.suppliersOther = [];
  },
  /* Types d'étiquette (2026-09-27) : liste éditable {id,name,cost} dans Réglages → Consommables.
     Une fiche prix pointe un type (p.labelTypeId → coût suivi en direct) ou '' = « Autre montant » (p.labelCost libre, vrac).
     Migration unique : fiche au montant par défaut actuel → « Étiquette sachet », sinon « Autre montant » (valeur gardée). */
  /* (2026-09-30) Les « SKU de lot » (v.packSkus) deviennent des déclinaisons « sans stock propre »
     (même produit, parentId = la variante, packQty = n, virtual) — données saisies par Antho, rien d'inventé. */
  migratePackSkus(s) {
    (s.stockM || []).forEach(p => (p.variants || []).slice().forEach(v => {
      if (!Array.isArray(v.packSkus) || !v.packSkus.length) return;
      v.packSkus.forEach(x => {
        const n = Math.round(Number(x.n) || 0); if (n < 2 || !x.sku) return;
        if (p.variants.some(w => (w.sku || '').toUpperCase() === String(x.sku).toUpperCase())) return;
        const base = (v.label || (v.mode === 'size' ? v.value : '') || '').toString();
        p.variants.push({ id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), catalogVariantId: '', mode: 'piece', value: n, label: (base ? base + ' ' : '') + 'LOT ' + n, parentId: v.id, packQty: n, virtual: true, sku: String(x.sku).toUpperCase(), priceTTC: 0, costUnit: 0, low: 0, lowEvent: 0, lots: [] });
      });
      delete v.packSkus;
    }));
  },
  migrateLabelTypes(s) {
    const S = s.settings; if (!S) return;
    if (!Array.isArray(S.labelTypes)) {
      S.labelTypes = [{ id: 'lt_sachet', name: 'Étiquette sachet', cost: U.num(S.labelCost ?? 0.10) }, { id: 'lt_elastique', name: 'Élastique + étiquette', cost: 0 }];
      S.labelDefaultId = 'lt_sachet';
    }
    const def = U.num(S.labelCost ?? 0.10);
    (s.catalogM || []).forEach(p => {
      if (p.labelTypeId !== undefined) return;
      const v = U.num(p.labelCost ?? def);
      p.labelTypeId = Math.abs(v - def) < 1e-9 && S.labelTypes.some(t => t.id === 'lt_sachet') ? 'lt_sachet' : '';
      p.labelCost = v;
    });
  },
  labelTypes() { return (this.state.settings.labelTypes || []); },
  labelType(id) { return id ? this.labelTypes().find(t => t.id === id) : null; },
  labelDefault() { const S = this.state.settings; return this.labelType(S.labelDefaultId) || this.labelTypes()[0] || null; },
  /* Consommable (étiquettes en stock) auquel le type d'étiquette d'une fiche est relié : son coût / unité (par étiquette) est alors repris automatiquement (2026-10-07). */
  labelConso(p) { const t = this.labelType(p && p.labelTypeId); return t && t.consumableId ? (this.state.consumables || []).find(c => c.id === t.consumableId) || null : null; },
  labelCostOf(p) {
    const t = this.labelType(p && p.labelTypeId);
    const lc = this.labelConso(p); if (lc) return U.num(lc.costUnit);   // coût HT du consommable (la TVA d'achat est ajoutée au calcul des prix, comme pour les sachets liés)
    if (t) return U.num(t.cost);
    return U.num(p && p.labelCost !== undefined && p.labelCost !== '' ? p.labelCost : this.state.settings.labelCost);
  },

  /* Si un état sauvegardé a déjà un variantPresets (donc pas remplacé par le
     spread des defaults() ci-dessus) mais avec un mode resté vide
     (gram/piece/size), le repeuple avec les paliers standards par défaut —
     mêmes valeurs que dans defaults() — pour éviter d'avoir à les retaper à
     la main dans Paramètres > Variantes. N'écrase jamais un mode déjà rempli. */
  _fillDefaultVariantPresets(s) {
    const def = this.defaults().settings.variantPresets;
    if (!s.settings.variantPresets) { s.settings.variantPresets = def; return; }
    const vp = s.settings.variantPresets;
    ['gram', 'piece', 'size'].forEach(mode => {
      if (!Array.isArray(vp[mode]) || vp[mode].length === 0) vp[mode] = [...def[mode]];
    });
  },

  /* Ancien modèle : un seul fournisseur (mainSupplierId) + un seul prix
     d'achat (basis) par produit. Nouveau modèle : plusieurs fournisseurs
     comparables (suppliers[]), mainSupplierId sélectionne celui qui sert
     de base aux calculs. Convertit les anciennes fiches une seule fois. */
  migrateCatalogSuppliers(s) {
    (s.catalogM || []).forEach(p => {
      if (p.suppliers) return;
      const b = p.basis || {};
      p.suppliers = p.mainSupplierId ? [{
        id: U.uid(), supplierId: p.mainSupplierId,
        price: b.price ?? '', taxType: b.taxType || 'HT', unit: b.unit || 'kilo',
        weight: b.weight ?? 1, quantity: b.quantity ?? 1, piecesPerKilo: b.piecesPerKilo ?? ''
      }] : [];
      delete p.basis;
    });
  },

  migrateSachetDims(s) {
    (s.settings?.sachets || []).forEach(sc => {
      if (sc.dims !== undefined) return;
      const m = (sc.name || '').match(/\(([^)]+)\)/);
      sc.dims = m ? m[1].replace(/\*/g, '×').replace(/\s*×\s*/g, '×').trim() : '';
    });
  },

  migrateFabSegments(s) {
    const fd = s.settings?.accFabDefaults;
    if (fd) {
      for (const cat of Object.keys(fd)) {
        const d = fd[cat];
        if (d.segments) continue;
        d.segments = [];
        if (d.end1Label || d.end1) d.segments.push({ label: d.end1Label || 'Extrémité 1', value: d.end1 || 0 });
        if (d.end2Label || d.end2) d.segments.push({ label: d.end2Label || 'Extrémité 2', value: d.end2 || 0 });
        delete d.end1Label; delete d.end1; delete d.end2Label; delete d.end2;
      }
    }
    (s.catalogA || []).forEach(a => {
      if (a.fabSegments !== undefined) return;
      const e1 = U.num(a.extraEnd1), e2 = U.num(a.extraEnd2);
      const cat = a.category || '';
      const defs = fd?.[cat]?.segments || [];
      a.fabSegments = [];
      if (e1) a.fabSegments.push({ label: defs[0]?.label || 'Extrémité 1', value: e1 });
      if (e2) a.fabSegments.push({ label: defs[1]?.label || 'Extrémité 2', value: e2 });
      delete a.extraEnd1; delete a.extraEnd2;
    });
  },

  /* PLUSIEURS ONGLETS (Antho 2026-11-18 : « j'aime travailler avec plusieurs onglets pour comparer ») : chaque onglet est un « appareil » pour la base.
     Pour qu'un onglet ne reparte jamais d'une version en retard, celui qui vient d'enregistrer envoie aussitôt aux autres onglets du navigateur
     les données enregistrées et leur numéro de version (BroadcastChannel, instantané, sans passer par Internet). L'onglet qui reçoit les adopte
     tout de suite, sauf s'il a lui-même des changements en attente sur ce domaine ou une fenêtre ouverte (il se recharge alors après, comme avant). */
  watchTabs() {
    if (this._bc) return;
    try {
      const bc = this._bc = new BroadcastChannel('touffu_onglets');
      bc.onmessage = e => { try { if (e.data && e.data.t === 'saved') this._adoptFromTab(e.data.keys || {}); } catch (err) { console.error(err); } };
    } catch (e) { /* navigateur sans BroadcastChannel : on garde le rechargement par la base */ }
  },
  _tellTabs(keys) {
    if (!this._bc || !keys.length) return;
    const out = {};
    keys.forEach(k => { if (this.state && this.state[k] !== undefined && this._rev[k] && !this._dirty.has(k)) out[k] = { rev: this._rev[k], data: this.state[k] }; });
    if (Object.keys(out).length) try { this._bc.postMessage({ t: 'saved', keys: out }); } catch (e) { console.error(e); }
  },
  _adoptFromTab(keys) {
    if (!this.remote || !this.state) return;
    if (this._modalOpen() || this._fileBusy()) { this._pendingReload = true; return; }
    let changed = false;
    Object.keys(keys).forEach(k => {
      const it = keys[k];
      if (!it || !(it.rev > (this._rev[k] || 0))) return;          // déjà à jour (ou plus récent ici)
      if (this._dirty.has(k) || this._flushing) { this._pendingReload = true; return; }   // changements en attente ici : rechargement après
      this.state[k] = it.data; this._rev[k] = it.rev; changed = true;
    });
    // Réaffichage SANS enregistrement : ce que l'affichage recalcule (prix recopiés…) a déjà été enregistré par l'autre onglet — sinon les onglets se relancent sans fin
    if (changed) { clearTimeout(this._adoptT); this._adoptT = setTimeout(() => { if (this._modalOpen()) return; this._quiet = true; try { window.App?.rerender?.(); } finally { this._quiet = false; } }, 60); }
  },
  listenRealtime() {
    try {
      this.sb.channel('touffu-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, async () => {
          if (this._flushing || this._dirty.size) return;
          if (this._justSynced && Date.now() - this._justSynced < 2000) return; // echo de notre propre sauvegarde : rien a recharger
          if (this._modalOpen() || this._fileBusy()) { this._pendingReload = true; return; }
          if (await this.loadRemote()) window.App?.rerender?.();   // réaffiche seulement si quelque chose a vraiment changé (sinon : boucle avec les autres onglets, 2026-11-19)
        }).subscribe();
    } catch (e) { /* temps réel non activé : rechargement au focus */ }
    // ⚠️ Piège (repéré en corrigeant les suggestions de liaison stock↔catalogue) :
    // save() ne fait que marquer les domaines "dirty" et attend 500ms avant
    // d'envoyer réellement à Supabase (flush()). loadRemote() REMPLACE tout
    // this.state. Sans le garde-fou `!this._dirty.size` ci-dessous, reprendre
    // le focus de l'onglet (ex: revenir d'un autre onglet juste après avoir
    // cliqué "Lier" plusieurs fois de suite) écrasait silencieusement les
    // changements pas encore envoyés par l'état encore ancien du serveur —
    // ça donnait l'impression que la 2e/3e action "ne faisait rien".
    document.addEventListener('click', e => { if (e.target && e.target.matches && e.target.matches('input[type=file]')) this._filePickUntil = Date.now() + 120000; }, true);
    document.addEventListener('change', e => { if (e.target && e.target.matches && e.target.matches('input[type=file]')) this._filePickUntil = 0; }, true);
    window.addEventListener('focus', async () => {
      if (this._fileBusy()) return; // ne pas écraser une sélection de fichier en cours (retour du sélecteur de fichier)
      if (this.remote && !this._flushing && !this._dirty.size) {
        if (this._modalOpen()) { this._pendingReload = true; return; }
        if (await this.loadRemote()) window.App?.rerender?.();
      }
    });
  },

  /* ⚠️ Piège corrigé (2026-09-26, « je dois enregistrer 2 fois ») : une fenêtre d'édition
     (U.modal) garde une référence vers l'objet du produit. Si loadRemote() remplace
     this.state pendant qu'elle est ouverte (retour sur l'onglet après avoir copié une URL,
     ou modif d'un autre appareil), l'enregistrement s'appliquait à l'ANCIENNE copie → perdu
     sans message. On diffère donc tout rechargement tant qu'une fenêtre est ouverte ;
     U.closeModal() appelle _afterModal() pour le rattraper ensuite. */
  _modalOpen() { return !!(document.getElementById('modalBg') || document.getElementById('askBg') || document.getElementById('panPicker')); },   // panPicker = sélecteur plein écran de Paniers (téléphone)
  /* ⚠️ Piège corrigé (2026-09-26, « le fichier choisi ne reste pas ») : ouvrir le sélecteur de
     fichier fait perdre le focus à la fenêtre ; au retour, l'événement `focus` déclenchait
     loadRemote() + re-rendu → le champ <input type=file> était recréé VIDE. Valable pour TOUS
     les champs fichier (retour d'événement, imports Paramètres, Site…). On ne recharge donc pas
     pendant 2 min après un clic sur un champ fichier, ni tant qu'un champ fichier contient un fichier. */
  _filePickUntil: 0,
  _fileBusy() {
    if (Date.now() < this._filePickUntil) return true;
    return [...document.querySelectorAll('input[type=file]')].some(i => i.files && i.files.length);
  },
  _afterModal() {
    if (!this._pendingReload) return;
    this._pendingReload = false;
    setTimeout(async () => {
      if (!this.remote || this._modalOpen()) { this._pendingReload = true; return; }
      if (this._flushing || this._dirty.size) return; // notre propre save part : le serveur aura notre version
      await this.loadRemote(); window.App?.rerender?.();
    }, 1200);
  },

  /* ---------- sauvegarde ---------- */
  /* Domaines qu'un compte « équipe » a le droit d'enregistrer (stock + journal). */
  TEAM_DOMAINS: ['stockM', 'materials', 'consumables', 'journal', 'meta', 'clients', 'baskets', 'receptions'],   // baskets = paniers / devis en attente (2026-10-14 : l'équipe en crée) → il faut aussi la règle RLS (supabase_schema.sql)

  save(...domains) {
    if (typeof Accessoires !== 'undefined') Accessoires._famC = null;   // cache des familles de matières : périmé dès qu'on enregistre
    if (this._quiet) return;   // réaffichage d'une version reçue d'un autre onglet : rien à renvoyer (voir _adoptFromTab)
    if (window.App && window.App.isViewer) {
      if (typeof U !== 'undefined' && U.toast) U.toast('Lecture seule : cette modification ne sera pas enregistree.', true);
      else alert('Lecture seule : cette modification ne sera pas enregistree.');
      return;
    }
    if (window.App && window.App.isTeam) {
      // Fiches prix (catalogM) : seulement via Catalogue.save en profil équipe, qui ne recopie
      // QUE lien / réf. / notes fournisseur (flag _teamCatalogOK posé le temps de l'appel).
      const ok = d => this.TEAM_DOMAINS.includes(d) || (d === 'catalogM' && this._teamCatalogOK);
      const blocked = domains.filter(d => !ok(d));
      domains = domains.filter(ok);
      if (blocked.length && typeof U !== 'undefined' && U.toast) U.toast(blocked.includes('catalogM') ? 'Profil équipe : sur les fiches prix, seuls le lien, la réf. et les notes fournisseur s’enregistrent (ouvre la fiche avec « Modifier »).' : 'Profil équipe : seul le stock peut être modifié — le reste n’est pas enregistré.', true);
      if (!domains.length) return;
    }
    if (domains.includes('purchases') && window.App && !window.App.isTeam && !window.App.isViewer) setTimeout(() => { try { if (typeof Achats !== 'undefined') Achats.syncReceptions(); } catch (e) { console.error(e); } }, 0);   // toute modification d'achat : la copie « Réception » de l'équipe suit
    domains.forEach(d => this._dirty.add(d));
    if (this.remote && this._dirty.has('journal') && this.isAdmin()) this._dirty.add('journalAdmin');
    if (this.remote && this.isAdmin() && typeof Visite !== 'undefined') Visite.keysFor(domains).forEach(k => this._dirty.add(k));   // la copie nettoyée du compte visite suit chaque enregistrement (voir visite.js)   // le coffre part avec le journal (voir _wire)
    this._saveSeq++;
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.flush(), 500);
    this.updateSyncBadge('…');
  },

  async flush() {
    if (!this._dirty.size) return;
    /* ⚠️ Piège corrigé (Antho 2026-11-17, « Enregistrement refusé » en cliquant vite des pastilles) : un 2e envoi parti PENDANT le 1er
       repartait avec l'ancien numéro de version (le 1er n'avait pas encore rendu le nouveau) → la base le prenait pour un autre appareil.
       On attend donc la fin de l'envoi en cours avant d'envoyer la suite. */
    if (this._flushing) { clearTimeout(this._saveT); this._saveT = setTimeout(() => this.flush(), 300); return; }
    const rank = k => k === 'journalAdmin' ? 0 : (typeof Visite !== 'undefined' && Visite.isKey(k)) ? 2 : 1;   // 1 = vraie donnée ; 0 et 2 = copies calculées (coffre du journal, copie « visite »)
    const dirty = [...this._dirty].sort((a, b) => rank(a) - rank(b)); this._dirty.clear();
    if (this.remote) {
      this._flushing = true;
      /* UN SEUL envoi pour toutes les clés, « tout ou rien » (2026-11-16, fonction SQL app_state_put_many) : chaque vraie donnée part avec le numéro de
         version chargé. Si une seule a été modifiée ailleurs entre-temps, la base n'écrit RIEN (jamais une vente sans son stock) et on passe par _onConflict.
         Une clé refusée par les droits du profil est signalée et abandonnée, les autres s'enregistrent ; une coupure réseau garde tout en attente. */
      const denied = [], retry = [], sent = [], wireErr = [], items = [], sentNow = {};
      let conflicts = null;
      try {
        for (const k of dirty) {
          let data;
          try { data = this._wire(k); }
          catch (e) { console.error('préparation de', k, e); wireErr.push(k + ' : ' + ((e && e.message) || e)); if (rank(k) === 1) retry.push(k); continue; }   // une copie dérivée qui plante est ABANDONNÉE (jamais bloquante pour les vraies données)
          items.push({ key: k, data, rev: rank(k) === 1 ? (this._rev[k] || 0) : null });
          if (rank(k) === 1) { sentNow[k] = this._canon(data); this._lastSent[k] = [sentNow[k]].concat(this._lastSent[k] || []).slice(0, 3); }   // empreintes des derniers envois (voir _selfConflict), notées AVANT l'envoi : la réponse peut se perdre
        }
        if (items.length) {
          const { data: res, error } = await this.sb.rpc('app_state_put_many', { p_items: items });
          if (error && error.code) {
            /* Filet de sécurité : la base a REFUSÉ l'appel lui-même (fonction absente, erreur inattendue…), ce n'est pas une coupure réseau.
               On ne bloque jamais l'enregistrement : retour à l'ancien envoi clé par clé (sans contrôle de version), et la cause est notée dans `meta.putErr`. */
            console.error('app_state_put_many', error);
            for (const it of items) {
              const r = await this.sb.from('app_state').upsert({ key: it.key, data: it.data, updated_at: new Date().toISOString() });
              if (!r.error) { sent.push(it.key); delete this._rev[it.key]; }
              else if (r.error.code === '42501' || /row-level security|permission|policy/i.test(r.error.message || '')) denied.push(it.key);
              else retry.push(it.key);
            }
            const msg = String(error.code + ' ' + (error.message || '')).slice(0, 300), m = this.state.meta || (this.state.meta = {});
            if (m.putErr !== msg) { m.putErr = msg; this._dirty.add('meta'); }
          }
          else if (error) { console.error(error); items.forEach(it => retry.push(it.key)); }
          else if (!res || res.ok === false) conflicts = (res && res.conflicts) || [];
          else {
            Object.keys(res.revs || {}).forEach(k => { this._rev[k] = res.revs[k]; sent.push(k); });
            (res.denied || []).forEach(k => denied.push(k));
          }
        }
      } catch (e) {
        console.error(e);
        items.forEach(it => { if (!retry.includes(it.key)) retry.push(it.key); });
      } finally { this._flushing = false; }
      if (conflicts && (this._selfRetry || 0) < 2 && await this._selfConflict(conflicts)) {
        // Faux conflit : la base contient exactement ce que CET onglet a envoyé en dernier (réponse perdue / numéro pas à jour) → on renvoie, sans alerte
        this._selfRetry = (this._selfRetry || 0) + 1;
        items.forEach(it => this._dirty.add(it.key));
        clearTimeout(this._saveT); this._saveT = setTimeout(() => this.flush(), 50);
        return;
      }
      if (conflicts) { this._selfRetry = 0; await this._onConflict(conflicts, items.map(it => it.key)); return; }
      this._selfRetry = 0;
      try { if (typeof Visite !== 'undefined') Visite.afterFlush(sent, wireErr); } catch (e) { console.error(e); }
      retry.forEach(d => this._dirty.add(d));
      if (retry.length) { this._netRetry = (this._netRetry || 0) + 1; if (this._netRetry <= 5) { clearTimeout(this._saveT); this._saveT = setTimeout(() => this.flush(), 3000 * this._netRetry); } } else this._netRetry = 0;
      if (!retry.length) this._justSynced = Date.now();
      this._tellTabs(sent.filter(k => rank(k) === 1));   // les autres onglets reprennent cette version tout de suite
      this.updateSyncBadge(retry.length ? '⚠ hors ligne' : denied.length ? '⚠ refusé' : '✓ synchronisé');
      if (denied.length && typeof U !== 'undefined' && U.toast) {
        U.toast('⛔ Le serveur a refusé d’enregistrer : ' + denied.map(d => this.DOMAIN_NAMES[d] || d).join(', ') + ' (droits de ton profil). Ces modifications ne sont pas gardées.', true);
      }
    } else {
      localStorage.setItem('touffu_state', JSON.stringify(this.state));
      this.updateSyncBadge('✓ enregistré (local)');
    }
  },
  /* FAUX CONFLITS (Antho 2026-11-18, « Enregistrement refusé » alors qu'il est seul sur son ordinateur) : si la version de la base est EXACTEMENT
     la dernière que cet onglet a lui-même enregistrée (réponse du serveur perdue, numéro de version resté en retard), ce n'est pas un autre appareil :
     on reprend le bon numéro et on renvoie. Comparaison sur une écriture « canonique » (clés triées : la base réordonne les champs). */
  _lastSent: {},
  _canon(v) {
    if (Array.isArray(v)) return '[' + v.map(x => this._canon(x)).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + this._canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  },
  async _selfConflict(conflicts) {
    try {
      const keys = (conflicts || []).filter(k => this._lastSent[k] !== undefined);
      if (!keys.length || keys.length !== conflicts.length) return false;
      const { data, error } = await this.sb.from('app_state').select('key,data,rev').in('key', keys);
      if (error || !data || data.length !== keys.length) return false;
      if (!data.every(r => (this._lastSent[r.key] || []).includes(this._canon(r.data)))) return false;
      data.forEach(r => { this._rev[r.key] = r.rev; });
      return true;
    } catch (e) { console.error(e); return false; }
  },
  /* Un autre appareil a enregistré entre-temps : RIEN n'a été écrit. On recharge la version à jour de tout ce que cet enregistrement touchait
     (les changements locaux de cette action sont abandonnés, pour ne laisser aucun état à moitié enregistré) et on le dit clairement. */
  async _onConflict(conflicts, keys) {
    (keys || []).forEach(k => { delete this._rev[k]; });
    this.updateSyncBadge('⚠ non enregistré');
    const list = (conflicts || []).filter(k => !(typeof Visite !== 'undefined' && Visite.isKey(k)) && k !== 'journalAdmin').map(k => this.DOMAIN_NAMES[k] || k).join(', ');
    try {
      if (this._modalOpen()) this._pendingReload = true;
      else { await this.loadRemote(); window.App?.rerender?.(); }
    } catch (e) { console.error(e); }
    if (typeof U !== 'undefined' && U.alert) U.alert('Ces données ont été modifiées sur un autre appareil pendant que tu travaillais : ' + (list || 'données') + '.\n\nTa dernière action n’a PAS été enregistrée, et rien n’a été écrasé. L’écran affiche maintenant la version à jour : refais ta dernière action.', '⚠ Enregistrement refusé');
  },

  updateSyncBadge(txt) {
    document.querySelectorAll('.sync-state').forEach(el => {
      el.textContent = txt; el.classList.toggle('ok', txt.startsWith('✓'));
    });
  },

  /* ---------- journal & annulation ---------- */
  // Retourne l'entrée créée (id notamment) pour que l'appelant puisse la passer à
  // U.toast(msg, err, entry.id) et afficher un "↺ Annuler" directement dans le toast.
  log(action, label, undo) {
    if (action !== 'annulation' && action !== 'refaire' && typeof Params !== 'undefined') Params._redo = [];   // une nouvelle action vide la pile « refaire »
    const entry = { id: U.uid(), ts: Date.now(), action, label, undo: undo || null, user: this.session?.user?.email || '' };
    this.state.journal.unshift(entry);
    if (this.state.journal.length > 600) this.state.journal.length = 600;
    this.save('journal');
    return entry;
  },

  /* Instantané générique AVANT modification d'une fiche complète (produit stock,
     produit catalogue, accessoire, matière, consommable…) — demande explicite
     d'Antho : "peu importe l'action... un clic souris avec un changement de valeur"
     doit pouvoir être annulé (nom, SKU, seuils, prix, ajout/suppression de variante
     ou de lot, etc.), pas seulement les quelques actions déjà couvertes une par une.
     Plutôt que construire un type d'annulation sur-mesure pour chaque champ, on
     capture la fiche ENTIÈRE (JSON clone) avant la mutation et on la restaure en
     bloc au clic sur "Annuler" — couvre aussi bien un champ du produit qu'un champ
     niché dedans (variante, lot, rouleau...), puisque tout est imbriqué dans le
     même objet. Usage : `const snap = Store.snapshot('stockM', p); ...mute p...;
     const entry = Store.commitSnapshot(snap, 'stock', 'Libellé de l'action');`
     Limite assumée (comme les undo déjà existants) : un "dernier changement sur
     cette fiche", pas un historique multi-étapes — annuler après plusieurs actions
     successives sur la même fiche ne revient qu'à l'état d'avant la DERNIÈRE. */
  snapshot(domain, item) {
    return { domain, id: item.id, before: JSON.parse(JSON.stringify(item)) };
  },
  commitSnapshot(snap, action, label) {
    return this.log(action, label, { type: 'restoreItem', data: snap });
  },

  /* ---------- instantanés quotidiens ---------- */
  snapshotData() {
    const { journal, ...rest } = this.state;
    return rest;
  },
  async dailySnapshot() {
    // Sauvegardes complètes (achats + banque compris) : réservées à l'admin (audit sécurité 2026-11-05). Équipe / visiteur : rien, et surtout PAS de « lastSnapshotDay » posé à sa place.
    if (this.remote && !this.isAdmin()) return;
    const day = U.today();
    if (this.state.meta.lastSnapshotDay === day) return;
    await this.takeSnapshot(day, true);
    this.state.meta.lastSnapshotDay = day;
    this.save('meta');
  },
  async takeSnapshot(day, silent) {
    const data = this.snapshotData();
    if (this.remote) {
      await this.sb.from('snapshots').upsert({ day, data, created_at: new Date().toISOString() }, { onConflict: 'day' });
    } else {
      const all = JSON.parse(localStorage.getItem('touffu_snapshots') || '{}');
      all[day] = data;
      const days = Object.keys(all).sort();
      while (days.length > 14) delete all[days.shift()];
      localStorage.setItem('touffu_snapshots', JSON.stringify(all));
    }
    if (!silent) U.toast('Instantané enregistré : ' + U.frDate(day));
  },
  async listSnapshots() {
    if (this.remote) {
      const { data } = await this.sb.from('snapshots').select('day').order('day', { ascending: false }).limit(30);
      return (data || []).map(r => r.day);
    }
    return Object.keys(JSON.parse(localStorage.getItem('touffu_snapshots') || '{}')).sort().reverse();
  },
  async restoreSnapshot(day) {
    let data = null;
    if (this.remote) {
      const { data: rows } = await this.sb.from('snapshots').select('data').eq('day', day).single();
      data = rows?.data;
    } else {
      data = JSON.parse(localStorage.getItem('touffu_snapshots') || '{}')[day];
    }
    if (!data) { U.toast('Instantané introuvable', true); return; }
    const journal = this.state.journal;
    this.state = this.merge(data);
    this.state.journal = journal;
    this.log('restauration', 'Restauration de l\u2019instantané du ' + U.frDate(day));
    this.save(...this.DOMAINS);
    U.toast('État du ' + U.frDate(day) + ' restauré');
    window.App.rerender();
  },

  /* Efface TOUT l'historique des instantanés (retour arrière) — local ET cloud.
     Ne touche à AUCUNE donnée courante (produits/stock/ventes) : ce sont juste
     les sauvegardes quotidiennes automatiques. Réinitialise lastSnapshotDay pour
     qu'un nouvel instantané « propre » soit repris dès aujourd'hui.
     Cas d'usage : repartir sur une base saine à la mise en service (jeter les
     instantanés accumulés pendant les tests). */
  async clearSnapshots() {
    if (this.remote) {
      const { error } = await this.sb.from('snapshots').delete().gte('day', '1970-01-01'); if (error) throw error;
    } else {
      localStorage.removeItem('touffu_snapshots');
    }
    this.state.meta.lastSnapshotDay = '';
    this.save('meta');
  },

  /* ---------- Nettoyage des instantanés (2026-09-26, validé par Antho : 30 jours) ----------
     Les instantanés quotidiens ne sont jamais supprimés côté Supabase : on garde les N derniers
     jours (settings.snapRetentionDays, 30 par défaut). Un rappel MENSUEL (App._maybeAskCleanup)
     propose d'abord de télécharger une sauvegarde complète, puis de nettoyer (ou de reporter). */
  _snapCutoff(days) { return new Date(Date.now() - (U.num(days) || 30) * 86400000).toISOString().slice(0, 10); },
  async oldSnapshotDays(days) {
    const cut = this._snapCutoff(days);
    if (this.remote) {
      const { data, error } = await this.sb.from('snapshots').select('day').lt('day', cut);
      if (error) throw error;
      return (data || []).map(r => r.day);
    }
    return Object.keys(JSON.parse(localStorage.getItem('touffu_snapshots') || '{}')).filter(d => d < cut);
  },
  async purgeOldSnapshots(days) {
    const cut = this._snapCutoff(days);
    if (this.remote) {
      const { error } = await this.sb.from('snapshots').delete().lt('day', cut); if (error) throw error;
    } else {
      const all = JSON.parse(localStorage.getItem('touffu_snapshots') || '{}');
      Object.keys(all).forEach(d => { if (d < cut) delete all[d]; });
      localStorage.setItem('touffu_snapshots', JSON.stringify(all));
    }
  },

  /* Vide le journal des mouvements (et donc l'historique d'annulation récent).
     Ne touche à aucune donnée courante. À réserver à un nettoyage volontaire
     (ex: repartir propre pour la mise en service). */
  clearJournal() {
    this.state.journal = [];
    this.save('journal');
  },

  /* ---------- accès pratiques ---------- */
  supplier(id) { return this.state.settings.suppliers.find(s => s.id === id); },
  /* Types de fournisseur (2026-10-03) : une seule liste `settings.suppliers`, chaque fournisseur a un ou plusieurs types
     (`types`). Mastication / matières / consommables alimentent les fiches prix et le stock ; « autre » = outillage, matériel, frais. */
  SUPPLIER_TYPES: [{ v: 'mastication', l: 'Mastication' }, { v: 'matiere', l: 'Matières premières' }, { v: 'conso', l: 'Consommables' }, { v: 'autre', l: 'Autre' }],
  supplierTypes(s) { return s && Array.isArray(s.types) && s.types.length ? s.types : ['mastication', 'matiere', 'conso']; },
  supplierTypesLabel(s) { const t = this.supplierTypes(s); return this.SUPPLIER_TYPES.filter(x => t.includes(x.v)).map(x => x.l).join(' · '); },
  /* Fiches Prix mastication ACTIVES (Antho 2026-11-15) : une fiche « inactive » (p.inactive) sert de brouillon / de comparaison
     (estimation d'un produit pas encore acheté…) — elle reste dans Prix mastication mais n'entre ni dans les stats, ni dans Revente pro,
     ni dans les exports WooCommerce/SumUp, ni dans les alertes. Par défaut une fiche est active (aucune migration). */
  catActive() { return (this.state.catalogM || []).filter(p => !p.inactive); },
  /* Fournisseurs d'un type (le fournisseur déjà choisi `keepId` est toujours conservé, même s'il n'a plus ce type) */
  suppliersOf(type, keepId) { return (this.state.settings.suppliers || []).filter(s => this.supplierTypes(s).includes(type) || s.id === keepId); },
  /* Nom affiché d'un fournisseur. Pour un compte viewer, anonymisé en « Fournisseur N »
     (N = rang dans le référentiel Paramètres → Fournisseurs, stable sur toutes les pages). */
  supplierName(id) {
    const list = this.state.settings.suppliers || [];
    const i = list.findIndex(s => s.id === id);
    if (i < 0) { const o = (this.state.settings.suppliersOther || []).find(s => s.id === id); return o ? o.name : '—'; }   // fournisseurs « autres » (achats : outillage, équipement…)
    return (window.App && App.isViewer) ? 'Fournisseur ' + (i + 1) : list[i].name;
  },
  /* true si l'utilisateur courant ne doit voir ni liens, ni références, ni notes fournisseur. */
  hideSupplierInfo() { return !!(window.App && App.isViewer); },

  /* Suivi des connexions : une ligne dans la table Supabase `connexions` à chaque ouverture
     de l'appli (au plus une toutes les 30 min par navigateur). Si la table n'existe pas
     encore, l'erreur est ignorée silencieusement — rien n'est bloqué. */
  async logConnexion() {
    if (!this.remote || !this.sb || !this.session) return;
    try {
      const k = 'touffu_lastConnLog', last = +localStorage.getItem(k) || 0;
      if (Date.now() - last < 30 * 60 * 1000) return;
      const { error } = await this.sb.from('connexions').insert({ email: this.session.user.email, role: (window.App && App.role) || 'admin' });
      if (!error) localStorage.setItem(k, String(Date.now()));
    } catch (e) {}
  },
  /* Référentiel des événements (marchés, salons…) — Paramètres → Référentiels.
     Inclut aussi les noms déjà présents sur des ventes (anciens imports), pour ne rien perdre. */
  /* Fiche d'un événement (Paramètres → Événements) : {stand, km (aller-retour), tolls, other, place, note}. */
  eventInfo(name) { return ((this.state.settings.eventInfo || {})[name]) || {}; },
  fuelCostPerKm() { const S = this.state.settings; return U.num(S.fuelConsumption) / 100 * U.num(S.fuelPrice); },
  /* Coût de déplacement pré-calculé d'un événement = km A/R × (conso L/100 × prix du litre) + péages/parking + autres frais. */
  eventTravelCost(name) { const e = this.eventInfo(name); return Math.round((U.num(e.km) * this.fuelCostPerKm() + U.num(e.tolls) + U.num(e.other)) * 100) / 100; },
  eventList() {
    const set = new Set((this.state.settings.events || []).filter(Boolean));
    (this.state.sales || []).forEach(s => { if (s.eventName) set.add(s.eventName); });
    return [...set].sort(U.sortFr);
  },
  sachet(id) { return this.state.settings.sachets.find(s => String(s.id) === String(id)); },
  material(id) { return this.state.materials.find(m => m.id === id); },
  /* 🧮 Calculateur : mode de référence d'une catégorie de matière.
     'shared' = référence partagée par largeur/type (sangles) ; 'perItem' = par article (boucleries).
     Défaut : sangle partagée, tout le reste par article. */
  calcRefMode(kind) { const m = this.state.settings.calcRefMode || {}; return m[kind] || (this.isSangleKind(kind) ? 'shared' : 'perItem'); },
  /* Catégories de matières (sangle/bouclerie/autre + ajouts d'Antho : mousqueton, anneaux…)
     — référentiel {value,label} éditable en Paramètres. Fallback sur les 3 par défaut. */
  materialKinds() {
    const k = this.state.settings.materialKinds;
    return ((Array.isArray(k) && k.length) ? k : [{ value: 'sangle', label: 'Sangle' }, { value: 'sangle-hexa', label: 'Sangle HEXA' }, { value: 'sangle-reflechissante', label: 'Sangle réfléchissante' }, { value: 'bouclerie', label: 'Bouclerie' }, { value: 'autre', label: 'Autre' }]).slice().sort((x, y) => U.sortFr(x.label, y.label));   // ordre alphabétique partout (règle d'Antho)
  },
  /* Types de produit (occupation/mastication, éducation/friandises, + ajouts d'Antho
     type complément alimentaire…) — référentiel {value,label} éditable en Paramètres.
     Fallback sur les 2 types historiques si le réglage n'existe pas encore. */
  productTypes() {
    const t = this.state.settings.productTypes;
    return ((Array.isArray(t) && t.length) ? t : [{ value: 'occupation', label: 'Occupation (mastication)' }, { value: 'education', label: 'Éducation (friandises)' }]).slice().sort((x, y) => U.sortFr(x.label, y.label));
  },
  productTypeLabel(v) { const t = this.productTypes().find(x => x.value === v); return t ? t.label : ''; },

};
try { Store.watchTabs(); } catch (e) {}
