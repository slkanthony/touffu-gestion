/* ============================================================
   STORE — état de l'application, persistance & synchronisation
   Mode local  : localStorage (aucune config requise)
   Mode nuage  : Supabase (auth email/mdp, table app_state,
                 journal + instantanés quotidiens, temps réel)
   ============================================================ */
const Store = {
  DOMAINS: ['settings', 'catalogM', 'stockM', 'materials', 'catalogA', 'consumables', 'sales', 'journal', 'meta'],
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
        laborRate: 20, labelCost: 0.10, bulkDiscount: 0, b2bCoeffThreshold: 1.0, accCoeffThreshold: 2.0,
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
        wooExclude: [] // SKU exclus DÉFINITIVEMENT de l'export WooCommerce (produits événement-only, tests…) — jamais envoyés au site
      },
      catalogM: [],    // produits mastication (tarification) — voir pricing.js
      stockM: [],      // stock mastication : {id, catalogId, name, meatType, variants:[{id,label,mode,value,priceTTC,lots:[{id,lotNumber,dluo,qtyGeneral,qtyEvent,costUnit}]}]}
      materials: [],   // matières accessoires : {id,name,kind,unit,costUnit,qty,low}
      catalogA: [],    // accessoires finis : {id,name,category,bom:[{materialId,qty}],laborMinutes,extraCost,coefficient,stockGeneral,stockEvent,low,sku}
      consumables: [], // {id,name,category,unit,qty,low,costUnit}
      sales: [],       // ventes — voir ventes.js
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

  async loadRemote() {
    const { data, error } = await this.sb.from('app_state').select('key,data');
    if (error) throw error;
    const obj = {};
    (data || []).forEach(r => obj[r.key] = r.data);
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
    return s;
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
    window.addEventListener('focus', async () => {
      const pendingFile = document.getElementById('importFile');
      if (pendingFile && pendingFile.files && pendingFile.files.length) return; // ne pas ecraser une selection de fichier en cours (ex: retour du selecteur de fichier)
      if (this.remote && !this._flushing && !this._dirty.size) { await this.loadRemote(); window.App?.rerender?.(); }
    });
  },

  /* ---------- sauvegarde ---------- */
  save(...domains) {
    if (window.App && window.App.isViewer) {
      if (window.U && U.toast) U.toast('Lecture seule : cette modification ne sera pas enregistree.', true);
      else alert('Lecture seule : cette modification ne sera pas enregistree.');
      return;
    }
    domains.forEach(d => this._dirty.add(d));
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.flush(), 500);
    this.updateSyncBadge('…');
  },

  async flush() {
    if (!this._dirty.size) return;
    const dirty = [...this._dirty]; this._dirty.clear();
    if (this.remote) {
      this._flushing = true;
      try {
        const rows = dirty.map(k => ({ key: k, data: this.state[k], updated_at: new Date().toISOString() }));
        const { error } = await this.sb.from('app_state').upsert(rows);
        if (error) throw error;
        this._justSynced = Date.now();
        this.updateSyncBadge('✓ synchronisé');
      } catch (e) {
        dirty.forEach(d => this._dirty.add(d));
        this.updateSyncBadge('⚠ hors ligne'); console.error(e);
      } finally { this._flushing = false; }
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
    const entry = { id: U.uid(), ts: Date.now(), action, label, undo: undo || null };
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

  /* Vide le journal des mouvements (et donc l'historique d'annulation récent).
     Ne touche à aucune donnée courante. À réserver à un nettoyage volontaire
     (ex: repartir propre pour la mise en service). */
  clearJournal() {
    this.state.journal = [];
    this.save('journal');
  },

  /* ---------- accès pratiques ---------- */
  supplier(id) { return this.state.settings.suppliers.find(s => s.id === id); },
  supplierName(id) { return this.supplier(id)?.name || '—'; },
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
