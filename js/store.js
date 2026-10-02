/* ============================================================
   STORE — état de l'application, persistance & synchronisation
   Mode local  : localStorage (aucune config requise)
   Mode nuage  : Supabase (auth email/mdp, table app_state,
                 journal + instantanés quotidiens, temps réel)
   ============================================================ */
const Store = {
  DOMAINS: ['settings', 'catalogM', 'stockM', 'materials', 'catalogA', 'consumables', 'sales', 'clients', 'baskets', 'purchases', 'journal', 'meta'],
  state: null,
  sb: null,            // client supabase
  session: null,
  remote: false,
  _dirty: new Set(),
  _saveT: null,

  defaults() {
    return {
      settings: {
        vatRate: 20, vatActive: false, socialTaxRate: 12.3, socialTaxRateHandmade: 21.2, cardFeeRate: 1.75, stripeFeeRate: 1.5,
        // Expédition (Boxtal / Mondial Relay) : grille poids → prix HT (tranche = jusqu'à maxG grammes), poids du carton et d'un sachet
        shipTiers: [{ maxG: 250, priceHT: 3.04 }, { maxG: 500, priceHT: 3.14 }, { maxG: 1000, priceHT: 3.51 }, { maxG: 2000, priceHT: 4.90 }, { maxG: 3000, priceHT: 5.21 }, { maxG: 4000, priceHT: 5.21 }, { maxG: 5000, priceHT: 9.44 }, { maxG: 7000, priceHT: 10.36 }, { maxG: 10000, priceHT: 10.36 }, { maxG: 15000, priceHT: 16.16 }, { maxG: 30000, priceHT: 16.26 }],
        shipBoxG: 0, shipBagG: 0,
        urssafFreq: 'quarter', comptaExtraServices: 0,   // Compta : déclaration URSSAF mensuelle / trimestrielle ; CA hors application (éducation canine…) de l'année en cours
        laborRate: 20, labelCost: 0.10, bulkDiscount: 0, b2bCoeffThreshold: 1.0, accCoeffThreshold: 2.0, snapRetentionDays: 30,
        uvCartridgePrice: 42, uvCartridgeVolume: 100, // impression UV : coût encre/ml = prix ÷ volume
        uvMaintPct: 0, // + majoration entretien optionnelle (% du coût encre) — filtres/nettoyage/entretien
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
        consCategories: ['Cartons', 'Sachets', 'Blisters', 'Étiquettes', 'Encre', 'Autre'],
        suppliers: [{ id: 's1', name: 'Cernunos' }, { id: 's2', name: 'Kuaurtikel' }],
        events: [], eventInfo: {}, fuelConsumption: 7, fuelPrice: 1.85,
        sachets: [],   // {id, name, cost, type}
        meatAbbrev: {}, // {meatType: 'ABBR'} — surcharge l'auto-abréviation
        matAbbrev: {},  // {matKind: 'ABBR'} — abréviations catégories matières (Sangle→SAN)
        consoAbbrev: {}, // {consoCategory: 'ABBR'} — abréviations catégories consommables
        blisterRolls: {}, // {widthMm: {consumableId}} — lie chaque largeur de blister à un consommable en stock
        materialKinds: [ // catégories de matières éditables (référentiel) — 'sangle' garde le comportement rouleaux ; les autres suivent leur unité
          { value: 'sangle', label: 'Sangle' },
          { value: 'bouclerie', label: 'Bouclerie' },
          { value: 'autre', label: 'Autre' }
        ],
        strapWeights: {}, // {'<kind>|<type> <largeur>': {w, q}} — poids de réf. des matières en mode "partagé" pour le 🧮 Calculateur : w g = q m
        calcRefMode: { sangle: 'shared', bouclerie: 'perItem', autre: 'perItem' }, // 🧮 Calculateur : mode de référence par catégorie de matière ('shared' = partagée par largeur/type ; 'perItem' = par article)
        variantPresets: { gram: [50, 100, 250, 500, 1000], piece: [1, 2, 3, 4, 5], size: ['S', 'M', 'L', 'XL'] },
        wooExclude: [], // SKU exclus DÉFINITIVEMENT de l'export WooCommerce (produits événement-only, tests…) — jamais envoyés au site
        sumupExclude: [] // SKU (majuscules) exclus DÉFINITIVEMENT de l'export SumUp (ex: sachets 500g+ jamais emmenés sur les marchés) — jamais proposés à l'export
      },
      catalogM: [],    // produits mastication (tarification) — voir pricing.js
      stockM: [],      // stock mastication : {id, catalogId, name, meatType, variants:[{id,label,mode,value,priceTTC,lots:[{id,lotNumber,dluo,qtyGeneral,qtyEvent,costUnit}]}]}
      materials: [],   // matières accessoires : {id,name,kind,unit,costUnit,qty,low}
      catalogA: [],    // accessoires finis : {id,name,category,bom:[{materialId,qty}],laborMinutes,extraCost,coefficient,stockGeneral,stockEvent,low,sku}
      consumables: [], // {id,name,category,unit,qty,low,costUnit}
      sales: [],       // ventes — voir ventes.js
      baskets: [],     // paniers / devis en attente (admin seulement) : {id,ts,name,label,note,validUntil,items,budget,livraison}
      purchases: [],   // achats (admin seulement) : factures saisies — voir achats.js
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

  _saveSeq: 0,
  async loadRemote() {
    const seq = this._saveSeq;
    // Profil visite : la base refuse la lecture directe (données personnelles des clients) ; il passe par une fonction
    // SQL qui renvoie les données SANS clients, journal ni noms de clients sur les ventes (voir supabase_schema.sql).
    const isViewer = (this.session && this.session.user && this.session.user.app_metadata && this.session.user.app_metadata.role) === 'viewer';
    const { data, error } = isViewer ? await this.sb.rpc('app_state_safe') : await this.sb.from('app_state').select('key,data');
    if (error) throw error;
    // ⚠️ Course corrigée (2026-09-30, « je dois enregistrer plusieurs fois ») : la réponse arrive APRÈS coup. Si pendant
    // l'attente une fenêtre d'édition s'est ouverte (elle garde des références vers l'ANCIENS objets) ou si on a modifié /
    // enregistré quelque chose, appliquer cette réponse écraserait le travail en cours → on l'abandonne.
    if (this._saveSeq !== seq || this._dirty.size || this._flushing || this._modalOpen()) { if (this._modalOpen()) this._pendingReload = true; return; }
    const obj = {};
    (data || []).forEach(r => obj[r.key] = r.data);
    if (isViewer) { delete obj.baskets; delete obj.purchases; }   // paniers en attente = noms de clientes ; achats = comptabilité : jamais pour un visiteur
    this.state = this.merge(obj);
    // première utilisation : pousser les valeurs par défaut
    if (!data || !data.length) { this.DOMAINS.forEach(d => this._dirty.add(d)); await this.flush(); }
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
    return s;
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
  labelCostOf(p) {
    const t = this.labelType(p && p.labelTypeId);
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

  listenRealtime() {
    try {
      this.sb.channel('touffu-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, async () => {
          if (this._flushing || this._dirty.size) return;
          if (this._justSynced && Date.now() - this._justSynced < 2000) return; // echo de notre propre sauvegarde : rien a recharger
          if (this._modalOpen() || this._fileBusy()) { this._pendingReload = true; return; }
          await this.loadRemote();
          window.App?.rerender?.();
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
        await this.loadRemote(); window.App?.rerender?.();
      }
    });
  },

  /* ⚠️ Piège corrigé (2026-09-26, « je dois enregistrer 2 fois ») : une fenêtre d'édition
     (U.modal) garde une référence vers l'objet du produit. Si loadRemote() remplace
     this.state pendant qu'elle est ouverte (retour sur l'onglet après avoir copié une URL,
     ou modif d'un autre appareil), l'enregistrement s'appliquait à l'ANCIENNE copie → perdu
     sans message. On diffère donc tout rechargement tant qu'une fenêtre est ouverte ;
     U.closeModal() appelle _afterModal() pour le rattraper ensuite. */
  _modalOpen() { return !!(document.getElementById('modalBg') || document.getElementById('askBg')); },
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
  TEAM_DOMAINS: ['stockM', 'materials', 'consumables', 'journal', 'meta', 'clients'],

  save(...domains) {
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
    domains.forEach(d => this._dirty.add(d));
    this._saveSeq++;
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.flush(), 500);
    this.updateSyncBadge('…');
  },

  async flush() {
    if (!this._dirty.size) return;
    const dirty = [...this._dirty]; this._dirty.clear();
    if (this.remote) {
      this._flushing = true;
      /* Un envoi PAR domaine (2026-09-29) : avant, tout partait en un seul paquet, donc un domaine
         refusé par le serveur (règle de sécurité Supabase d'un profil) faisait échouer TOUT
         l'enregistrement, et le paquet était renvoyé en boucle. Désormais : un domaine refusé
         (permission) est signalé clairement et abandonné ; les autres s'enregistrent normalement ;
         seule une vraie coupure réseau garde les domaines en attente pour un nouvel essai. */
      const denied = [], retry = [];
      try {
        for (const k of dirty) {
          const { error } = await this.sb.from('app_state').upsert({ key: k, data: this.state[k], updated_at: new Date().toISOString() });
          if (!error) continue;
          console.error(k, error);
          if (error.code === '42501' || /row-level security|permission|policy/i.test(error.message || '')) denied.push(k); else retry.push(k);
        }
      } catch (e) {
        console.error(e);
        dirty.forEach(d => { if (!denied.includes(d)) retry.push(d); });
      } finally { this._flushing = false; }
      retry.forEach(d => this._dirty.add(d));
      if (!retry.length) this._justSynced = Date.now();
      this.updateSyncBadge(retry.length ? '⚠ hors ligne' : denied.length ? '⚠ refusé' : '✓ synchronisé');
      if (denied.length && typeof U !== 'undefined' && U.toast) {
        const names = { stockM: 'stock mastication', catalogM: 'fiches Prix mastication', catalogA: 'accessoires', materials: 'matières premières', consumables: 'consommables', settings: 'réglages', sales: 'ventes', clients: 'clients', baskets: 'paniers en attente', purchases: 'achats', journal: 'journal', meta: 'infos techniques' };
        U.toast('⛔ Le serveur a refusé d’enregistrer : ' + denied.map(d => names[d] || d).join(', ') + ' (droits de ton profil). Ces modifications ne sont pas gardées.', true);
      }
    } else {
      localStorage.setItem('touffu_state', JSON.stringify(this.state));
      this.updateSyncBadge('✓ enregistré (local)');
    }
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
  calcRefMode(kind) { const m = this.state.settings.calcRefMode || {}; return m[kind] || (kind === 'sangle' ? 'shared' : 'perItem'); },
  /* Catégories de matières (sangle/bouclerie/autre + ajouts d'Antho : mousqueton, anneaux…)
     — référentiel {value,label} éditable en Paramètres. Fallback sur les 3 par défaut. */
  materialKinds() {
    const k = this.state.settings.materialKinds;
    return (Array.isArray(k) && k.length) ? k : [{ value: 'sangle', label: 'Sangle' }, { value: 'bouclerie', label: 'Bouclerie' }, { value: 'autre', label: 'Autre' }];
  },
  /* Types de produit (occupation/mastication, éducation/friandises, + ajouts d'Antho
     type complément alimentaire…) — référentiel {value,label} éditable en Paramètres.
     Fallback sur les 2 types historiques si le réglage n'existe pas encore. */
  productTypes() {
    const t = this.state.settings.productTypes;
    return (Array.isArray(t) && t.length) ? t : [{ value: 'occupation', label: 'Occupation (mastication)' }, { value: 'education', label: 'Éducation (friandises)' }];
  },
  productTypeLabel(v) { const t = this.productTypes().find(x => x.value === v); return t ? t.label : ''; },

};
