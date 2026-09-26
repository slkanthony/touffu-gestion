/* ============ APP : coquille, navigation, tableau de bord, synthèses ============ */
const App = {
  views: [
    { id: 'dashboard', ico: '🏠', label: 'Tableau de bord', group: '' },
    { id: 'stock', ico: '📦', label: 'Stock', group: 'Stock & ventes' },
    { id: 'ventes', ico: '🛒', label: 'Ventes', group: 'Stock & ventes' },

    { id: 'paniers', ico: '🧺', label: 'Paniers', group: 'Stock & ventes' },

    { id: 'catalogue', ico: '🥩', label: 'Prix mastication', group: 'Catalogue & prix' },
    { id: 'accessoires', ico: '🐕', label: 'Accessoires', group: 'Catalogue & prix' },
    { id: 'calc', ico: '🧮', label: 'Calculateur', group: 'Catalogue & prix' },
    { id: 'b2b', ico: '🤝', label: 'Revente pro', group: 'Catalogue & prix' },
    { id: 'stats', ico: '📊', label: 'Statistiques', group: 'Analyse & site' },
    { id: 'woo', ico: '🌐', label: 'Site (Woo)', group: 'Analyse & site' },
    { id: 'params', ico: '⚙️', label: 'Paramètres', group: '' }
  ],
  renderers: {
    dashboard: () => App.renderDashboard(), ventes: () => Ventes.render(), stock: () => Stock.render(),
    paniers: () => Paniers.render(),
    catalogue: () => Catalogue.render(), accessoires: () => Accessoires.render(),
    calc: () => Calc.render(),
    b2b: () => B2B.render(), stats: () => Stats.render(), woo: () => Woo.render(), params: () => Params.render()
  },
  current: 'dashboard',
  visitMode: false,

  async boot() {
    let status;
    try { status = await Store.init(); }
    catch (e) { alert('Erreur de connexion aux données : ' + e.message); return; }
    if (status === 'login') { this.showLogin(); return; }
    if (status === 'recovery') { this.showRecovery(); return; }
    this.showApp();
  },

  wirePasswordToggle(inputId, toggleId) {
    const inp = document.getElementById(inputId), tg = document.getElementById(toggleId);
    if (!inp || !tg) return;
    const eOpen = '<svg width="14" height="9" viewBox="0 0 16 10"><path d="M8 1C4.4 1 1.4 3.6 0 5c1.4 1.4 4.4 4 8 4s6.6-2.6 8-4c-1.4-1.4-4.4-4-8-4z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="5" r="2" fill="currentColor"/></svg>';
    const eClosed = '<svg width="14" height="9" viewBox="0 0 16 10"><path d="M8 1C4.4 1 1.4 3.6 0 5c1.4 1.4 4.4 4 8 4s6.6-2.6 8-4c-1.4-1.4-4.4-4-8-4z" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="2" y1="9" x2="14" y2="1" stroke="currentColor" stroke-width="1.5"/></svg>';
    tg.innerHTML = eClosed;
    tg.onclick = () => {
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      tg.innerHTML = show ? eOpen : eClosed;
    };
  },

  showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    this.wirePasswordToggle('loginPass','loginPassToggle');
    document.getElementById('loginBtn').onclick = async () => {
      const msg = document.getElementById('loginMsg');
      msg.textContent = 'Connexion…';
      try {
        await Store.login(U.val('loginEmail'), U.val('loginPass'));
        document.getElementById('loginScreen').style.display = 'none';
        this.showApp();
      } catch (e) { msg.textContent = 'Échec : ' + e.message; }
    };
    document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });

    document.getElementById('forgotLink').onclick = async (ev) => {
      ev.preventDefault();
      const email = U.val('loginEmail');
      const fmsg = document.getElementById('loginMsg');
      if (!email) { fmsg.textContent = "Entre d'abord ton email ci-dessus."; return; }
      fmsg.textContent = 'Envoi en cours...';
      try { await Store.sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname }); }
      catch (e) {}
      fmsg.textContent = 'Si cette adresse existe, un email de réinitialisation a été envoyé.';
    };
  },

  showRecovery() {
    document.getElementById('recoveryScreen').style.display = 'flex';
    this.wirePasswordToggle('recoveryPass','recoveryPassToggle');
    document.getElementById('recoveryBtn').onclick = async () => {
      const rmsg = document.getElementById('recoveryMsg');
      const pass = U.val('recoveryPass');
      if (!pass || pass.length < 6) { rmsg.textContent = 'Minimum 6 caractères.'; return; }
      rmsg.textContent = 'Mise à jour...';
      try {
        const { error } = await Store.sb.auth.updateUser({ password: pass });
        if (error) throw error;
        window.location.href = window.location.pathname;
      } catch (e) { rmsg.textContent = 'Echec : ' + e.message; }
    };
    document.getElementById('recoveryPass').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('recoveryBtn').click(); });
  },

  showApp() {
    document.getElementById('appScreen').style.display = 'flex';
    document.getElementById('scrollFab').style.display = '';
    /* Rôles (app_metadata.role dans Supabase) : absent = admin ; 'viewer' = lecture seule,
       fournisseurs anonymisés ; 'team' = peut modifier le stock (Store.TEAM_DOMAINS), voit
       les vrais fournisseurs/liens, mais coûts/marges masqués comme un viewer. */
    this.role = (Store.session && Store.session.user && Store.session.user.app_metadata && Store.session.user.app_metadata.role) || 'admin';
    this.isViewer = this.role === 'viewer';
    this.isTeam = this.role === 'team';
    this.visitMode = (this.isViewer || this.isTeam) ? true : sessionStorage.getItem('touffu_visitMode') === '1';
    if (this.visitMode) document.body.classList.add('visit-mode');
    if (this.isViewer || this.isTeam) { const b = document.querySelector('.topnav-brand'); if (b) b.title = this.isViewer ? 'Mode lecture seule' : 'Profil équipe'; }
    Store.logConnexion();
    if (!this.isViewer && !this.isTeam) setTimeout(() => this._maybeAskCleanup(), 4000);
    this._syncVisitEye();
    this.buildNav();
    // Molette → défilement horizontal sur TOUT bloc qui a une barre coulissante
    // (menu, tables `.table-wrap`, tout conteneur en overflow-x auto/scroll). Comme la
    // barre de menu, mais généralisé à toute l'appli. On ne détourne la molette verticale
    // que si le bloc peut encore défiler dans ce sens (sinon on laisse la page défiler
    // normalement → pas d'effet « bloqué » au bord).
    document.addEventListener('wheel', e => {
      if (e.ctrlKey) return; // laisse le zoom
      if (!e.deltaY || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      // Certaines souris envoient la molette en "lignes" (deltaMode 1) ou "pages" (2) —
      // on convertit en pixels pour un défilement franc (sinon +1px imperceptible).
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= (window.innerHeight || 800);
      let el = e.target;
      while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
        if (el.scrollWidth > el.clientWidth + 2) {
          const ox = getComputedStyle(el).overflowX;
          if (ox === 'auto' || ox === 'scroll') {
            // Tant que le curseur est dans un bloc à défilement horizontal, la molette le
            // pilote et bloque TOUJOURS la page — même arrivé en butée (ça reste en butée,
            // il faut sortir du champ pour scroller la page). Demande explicite d'Antho.
            el.scrollLeft += dy;
            e.preventDefault();
            return;
          }
        }
        el = el.parentElement;
      }
    }, { passive: false });
    window.addEventListener('hashchange', () => this._onHashChange());
    if (location.hash) {
      this._onHashChange();
    } else {
      const last = localStorage.getItem('touffu_lastView');
      this.go(this.views.some(v => v.id === last) ? last : 'dashboard');
    }
    window.addEventListener('scroll', () => this.updateScrollFab(), { passive: true });
    this.updateScrollFab();
  },


  /* Rappel mensuel de nettoyage des instantanés (admin uniquement) : s'il existe des instantanés
     plus vieux que la durée de conservation, propose Télécharger une sauvegarde / Nettoyer / Plus tard.
     « Plus tard » reporte de 7 jours ; après un nettoyage, prochain rappel dans 30 jours. */
  async _maybeAskCleanup() {
    try {
      const m = Store.state.meta || (Store.state.meta = {});
      if (m.cleanupNext && U.today() < m.cleanupNext) return;
      if (document.getElementById('modalBg')) return;
      const days = U.num(Store.state.settings.snapRetentionDays) || 30;
      const old = await Store.oldSnapshotDays(days);
      const later = n => { m.cleanupNext = new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); Store.save('meta'); };
      if (!old.length) { later(30); return; }
      U.modal({
        title: '🧹 Nettoyage mensuel des instantanés', hideOk: true,
        body: `<p><b>${old.length}</b> instantané(s) de retour arrière ont plus de <b>${days} jours</b> (le plus ancien : ${U.frDate(old.slice().sort()[0])}).</p>
          <p class="muted">Ce sont des copies automatiques quotidiennes. Tes produits, ton stock, tes ventes et tes statistiques ne sont <b>pas</b> touchés. Conseil : télécharge d'abord une sauvegarde complète.</p>
          <div class="frow" style="gap:8px;flex-wrap:wrap;">
            <button class="btn-ghost" onclick="Params.exportAll()">💾 Télécharger une sauvegarde complète</button>
            <button class="btn-cta" onclick="App._doCleanup()">🧹 Nettoyer (garder ${days} jours)</button>
            <button class="btn-ghost" onclick="App._laterCleanup()">Plus tard (7 jours)</button>
          </div>`,
        onCancel: () => later(7)
      });
      this._laterCleanup = () => { later(7); U.closeModal(); };
      this._doCleanup = async () => {
        try { await Store.purgeOldSnapshots(days); later(30); U.closeModal(); U.toast(old.length + ' ancien(s) instantané(s) supprimé(s).'); }
        catch (e) { console.error(e); U.toast('Nettoyage impossible : ' + (e.message || e), true); }
      };
    } catch (e) { console.warn('cleanup check', e); }
  },

  toggleVisitMode() {
    if (this.isViewer || this.isTeam) return;
    this.visitMode = !this.visitMode;
    document.body.classList.toggle('visit-mode', this.visitMode);
    sessionStorage.setItem('touffu_visitMode', this.visitMode ? '1' : '');
    this._syncVisitEye();
    this.rerender();
  },
  _syncVisitEye() {
    const el = document.getElementById('visitEye');
    if (el) el.innerHTML = this.visitMode
      ? '<svg width="12" height="8" viewBox="0 0 16 10"><path d="M8 1C4.4 1 1.4 3.6 0 5c1.4 1.4 4.4 4 8 4s6.6-2.6 8-4c-1.4-1.4-4.4-4-8-4z" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="2" y1="9" x2="14" y2="1" stroke="currentColor" stroke-width="1.5"/></svg>'
      : '<svg width="12" height="8" viewBox="0 0 16 10"><path d="M8 1C4.4 1 1.4 3.6 0 5c1.4 1.4 4.4 4 8 4s6.6-2.6 8-4c-1.4-1.4-4.4-4-8-4z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="5" r="2" fill="currentColor"/></svg>';
  },
  updateScrollFab() {
    const up = document.getElementById('scrollUpBtn'), down = document.getElementById('scrollDownBtn');
    if (!up) return;
    const nearTop = window.scrollY < 200;
    const nearBottom = window.scrollY + window.innerHeight > document.body.scrollHeight - 200;
    up.classList.toggle('hidden', nearTop);
    down.classList.toggle('hidden', nearBottom);
  },

  buildNav() {
    const inner = document.getElementById('topnavInner');
    inner.querySelectorAll('.nav-items,.sync-state,.theme-toggle').forEach(n => n.remove());
    // Les onglets sont dans un conteneur qui occupe tout l'espace disponible entre le logo
    // et l'état de sync, et les répartit (space-evenly) → barre équilibrée sur grand écran,
    // défilement horizontal si l'écran est trop étroit (voir .nav-items dans le CSS).
    const navWrap = document.createElement('div');
    navWrap.className = 'nav-items';
    this.views.forEach(v => {
      const b = document.createElement('a');
      b.className = 'nav-item'; b.dataset.view = v.id; b.title = v.label;
      b.href = '#/' + v.id;
      b.innerHTML = `<span class="ico">${v.ico}</span><span class="lbl">${v.label}</span>`;
      b.onclick = (e) => this.navClick(e, v.id);
      navWrap.appendChild(b);
    });
    inner.appendChild(navWrap);
    // Le bouton thème clair/sombre a été déplacé dans Paramètres (réglage rare).
    const sync = document.createElement('div');
    sync.className = 'sync-state';
    sync.textContent = Store.remote ? '☁ Supabase' : '💾 mode local';
    inner.appendChild(sync);
  },

  /* Navigation en <a href> plutôt qu'en <button onclick> : permet le
     clic molette/Ctrl+clic natif du navigateur pour ouvrir un nouvel
     onglet. Un clic gauche simple reste intercepté pour garder le
     comportement existant de go() (pas de rechargement complet si on
     est déjà sur la vue, cf. cas Stock/onglets). */
  navClick(e, id) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return; // laisse le navigateur ouvrir un nouvel onglet
    e.preventDefault();
    this.go(id);
  },

  /* Navigation par hash (#/vue ou #/stock/onglet) : le bouton retour du navigateur
     fonctionne (chaque go() pousse une entrée d'historique) et l'URL survit à un F5,
     donc pas besoin de relire localStorage pour retrouver la bonne page/le bon onglet. */
  stockTabs: ['mastication', 'matieres', 'conso', 'peremptions', 'faible', 'faible-total', 'faible-event'],

  routeFor(id) {
    if (id === 'stock') return `stock/${Stock.tab}`;
    return id;
  },

  go(id) {
    const route = this.routeFor(id);
    if (location.hash.replace(/^#\/?/, '') === route) { this._render(id); return; }
    location.hash = '/' + route; // déclenche hashchange -> _onHashChange -> _render
  },

  _onHashChange() {
    const path = location.hash.replace(/^#\/?/, '');
    const parts = path.split('/');
    const rawId = parts[0], sub = parts[1];
    const id = this.views.some(v => v.id === rawId) ? rawId : 'dashboard';
    if (id === 'stock') {
      if (this.stockTabs.includes(sub)) Stock.tab = sub;
      Stock.focusId = parts[2] || null;
    }
    if (id === 'catalogue') {
      if (sub === 'new') { Catalogue.mode = 'new'; Catalogue.editId = null; }
      else if (sub === 'edit' && parts[2]) { Catalogue.mode = 'edit'; Catalogue.editId = parts[2]; }
      else { Catalogue.mode = 'list'; Catalogue.editId = null; }
    }
    this._render(id);
  },

  _render(id) {
    if (this.current !== id) this._resetFolds();
    this.current = id;
    localStorage.setItem('touffu_lastView', id);
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === id));
    this.rerender();
    window.scrollTo(0, 0);
    setTimeout(() => this.updateScrollFab(), 50);
  },
  _resetFolds() {
    Stock._prodOpen = {}; Stock._lotsOpen = {}; Stock._matGroupOpen = {};
    Stock._matRollsOpen = {}; Stock._dluoFilterOpen = false; Stock._meatFilterOpen = false;
    Catalogue._prodOpen = {}; Catalogue._meatFilterOpen = false;
    B2B._prodOpen = {}; B2B._meatFilterOpen = false;
    Params._sachetsOpen = false; Params._abbrevOpen = false; Params._varPresetsOpen = false;
    Params._financeOpen = false; Params._refsOpen = false; Params._skuOpen = false;
    Params._mergeOpen = false; Params._importOpen = false; Params._sachetTypeOpen = {};
    this._dashOverviewOpen = false; this._dashValMeatOpen = false;
    this._dashValCatOpen = false; this._dashCAOpen = false; this._dashScopeOpen = false;
  },
  rerender() {
    document.getElementById('main').innerHTML = '';
    const r = this.renderers[this.current];
    if (r) r();
  },
  mount(html) { const m = document.getElementById('main'); m.innerHTML = html; return m; },

  supplierOptions(sel) {
    return Store.state.settings.suppliers
      .slice().sort((a, b) => U.sortFr(a.name, b.name))
      .map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${U.esc(Store.supplierName(s.id))}</option>`).join('');
  },

  /* ================= TABLEAU DE BORD ================= */
  /* ============ Vue unifiée : catalogue mastication + stock attaché ============ */
  inventoryRows() {
    const rows = []; const seen = new Set();
    Store.state.catalogM.forEach(p => {
      const base = Pricing.baseUnitCost(p); const na = (p.variants||[]).filter(v=>v.enabled!==false).length; let idx = 0;
      const sp = Store.state.stockM.find(s => s.catalogId === p.id);
      if (sp) seen.add(sp.id);
      let gen = 0, evt = 0, buy = 0, sell = 0, kg = 0, pieces = 0; const vars = [];
      (p.variants || []).forEach(v => {
        const on = v.enabled !== false; const c = Pricing.variantCalc(p, v, on ? idx : 0, base, na); if (on) idx++;
        const sv = sp?.variants.find(x => x.catalogVariantId === v.id);
        const qg = sv ? sv.lots.reduce((a, l) => a + U.num(l.qtyGeneral), 0) : 0;
        const qe = sv ? sv.lots.reduce((a, l) => a + U.num(l.qtyEvent), 0) : 0;
        const q = qg + qe;
        const price = (sv && U.num(sv.priceTTC) > 0) ? U.num(sv.priceTTC) : c.priceTTC;
        gen += qg; evt += qe; buy += q * c.cost; sell += q * price;
        if (v.mode === 'gram') kg += q * U.num(v.value) / 1000; else if (v.mode === 'vrac') kg += q; else pieces += q * (v.mode === 'piece' ? (U.num(v.value) || 1) : 1);
        vars.push({ label: Pricing.labelVariant(v), sku: v.sku || '', price, cost: c.cost, qGen: qg, qEvt: qe, low: U.num(sv?.low) });
      });
      rows.push({ kind: 'M', id: p.id, stockId: sp?.id || null, name: p.name, meat: p.meatType || 'Autre', supplier: Store.supplierName(p.mainSupplierId), gen, evt, buy, sell, kg, pieces, vars, linked: !!sp });
    });
    // produits en stock non reliés au catalogue
    Store.state.stockM.forEach(sp => {
      if (seen.has(sp.id)) return;
      if (sp.catalogId && Store.state.catalogM.some(c => c.id === sp.catalogId)) return;
      let gen = 0, evt = 0, buy = 0, sell = 0, kg = 0, pieces = 0; const vars = [];
      sp.variants.forEach(v => {
        const qg = v.lots.reduce((a, l) => a + U.num(l.qtyGeneral), 0);
        const qe = v.lots.reduce((a, l) => a + U.num(l.qtyEvent), 0);
        const q = qg + qe;
        const cost = v.lots.reduce((a, l) => a + U.num(l.costUnit) * (U.num(l.qtyGeneral) + U.num(l.qtyEvent)), 0);
        gen += qg; evt += qe; buy += cost; sell += q * U.num(v.priceTTC);
        if (v.mode === 'gram') kg += q * U.num(v.value) / 1000; else if (v.mode === 'vrac') kg += q; else pieces += q * (v.mode === 'piece' ? (U.num(v.value) || 1) : 1);
        vars.push({ label: Pricing.labelVariant(v), sku: v.sku || '', price: U.num(v.priceTTC), cost: q ? cost / q : 0, qGen: qg, qEvt: qe, low: U.num(v.low) });
      });
      rows.push({ kind: 'M', id: sp.id, stockId: sp.id, name: sp.name, meat: sp.meatType || 'Autre', supplier: '—', gen, evt, buy, sell, kg, pieces, vars, linked: false, unlinked: true });
    });
    return rows;
  },
  accessoryRows() {
    return Store.state.catalogA.map(a => {
      const c = Pricing.accCalc(a); const qg = U.num(a.stockGeneral), qe = U.num(a.stockEvent), q = qg + qe;
      return { id: a.id, name: a.name, category: a.category || 'Autre', gen: qg, evt: qe, total: q, cost: c.cost, price: c.priceTTC, buy: q * c.cost, sell: q * c.priceTTC, low: U.num(a.low) };
    });
  },

  dashScopeAll: ['Mastication', 'Matières premières', 'Consommable', 'Accessoire'],

  /* Lien de la Vue d'ensemble vers la fiche du produit — demande explicite d'Antho
     (cliquer un produit doit amener direct à sa ligne dans Stock). Mastication a un
     vrai lien profond avec scroll (`#/stock/mastication/<id du STOCK, pas du
     catalogue>` — voir Stock.focusId/renderM) ; les autres catégories n'ont pas
     encore ce mécanisme de scroll par fiche, donc on renvoie juste vers le bon
     onglet/la bonne page (pas de lien du tout si un produit Mastication n'a aucune
     fiche stock à afficher). */
  dashRowHref(r) {
    if (r.cat === 'Mastication') return r.stockId ? `#/stock/mastication/${r.stockId}` : null;
    if (r.cat === 'Accessoire') return '#/accessoires';
    if (r.cat === 'Matières premières') return '#/stock/matieres';
    if (r.cat === 'Consommable') return '#/stock/conso';
    return null;
  },

  renderDashboard() {
    const st = Store.state, S = st.settings;
    const inv = this.inventoryRows();
    const acc = this.accessoryRows();

    // Vue d'ensemble complète (avant filtre) : mastication + accessoires finis + matières
    // premières + consommables. Sert à la fois à la liste détaillée ET aux KPI du haut,
    // qui doivent refléter le périmètre sélectionné (ex: ne cocher que "Sanglier"/Mastication).
    let overview = [
      ...inv.map(r => ({ name: r.name, type: r.meat, stock: r.gen + r.evt, stockLabel: r.evt ? `${U.qty(r.gen)} + ${U.qty(r.evt)} évén.` : U.qty(r.gen), buy: r.buy, sell: r.sell, nv: r.vars.length, linked: r.linked, unlinked: r.unlinked, cat: 'Mastication', stockId: r.stockId })),
      ...acc.map(r => ({ name: r.name, type: r.category, stock: r.total, stockLabel: U.qty(r.total), buy: r.buy, sell: r.sell, nv: 1, linked: true, cat: 'Accessoire' })),
      ...st.materials.map(m => ({ name: m.name, type: Stock.matKindLabel[m.kind] || m.kind, stock: U.num(m.qty), stockLabel: `${U.qty(m.qty)} ${m.unit === 'm' ? 'm' : 'PCS'}`, buy: U.num(m.qty) * U.num(m.costUnit), sell: null, nv: 1, linked: true, cat: 'Matières premières' })),
      ...st.consumables.map(c => ({ name: c.name, type: c.category || 'Autre', stock: U.num(c.qty), stockLabel: `${U.qty(c.qty)} ${U.esc(!c.unit || c.unit === 'pc' ? 'PCS' : c.unit)}`, buy: U.num(c.qty) * U.num(c.costUnit), sell: null, nv: 1, linked: true, cat: 'Consommable' }))
    ];
    const dashScope = this._dashScope || ['Mastication'];
    overview = overview.filter(r => dashScope.includes(r.cat));
    const q = (this._dashQ || '').toLowerCase();
    overview = overview.filter(r => !q || (r.name + ' ' + r.type).toLowerCase().includes(q));

    // Les 4 KPI du haut reflètent le périmètre + la recherche ci-dessus (comme l'ancienne appli :
    // cocher/chercher "Sanglier" ne montre que la valeur et le stock des produits Sanglier).
    const valAchat = overview.reduce((a, r) => a + r.buy, 0);
    const valVente = overview.reduce((a, r) => a + (r.sell || 0), 0);
    const nbProduits = overview.length;
    const enStock = overview.filter(r => r.stock > 0).length;

    // Alertes DLUO
    const alerts = [];
    st.stockM.forEach(p => p.variants.forEach(v => v.lots.forEach(l => {
      const q = U.num(l.qtyGeneral) + U.num(l.qtyEvent);
      const d = U.daysTo(l.dluo);
      if (q > 0 && l.dluo && d !== null && d <= U.num(S.dluoAlertDays)) alerts.push({ name: p.name, label: Pricing.labelVariant(v), l, d, q });
    })));
    alerts.sort((a, b) => a.d - b.d);

    // Alertes stock (seuils bas atteints) : mastication + matières + consommables + accessoires
    let lowCount = 0;
    inv.forEach(r => r.vars.forEach(v => { if (v.low > 0 && v.qGen <= v.low) lowCount++; }));
    st.materials.forEach(m => { if (U.num(m.low) > 0 && U.num(m.qty) <= U.num(m.low)) lowCount++; });
    st.consumables.forEach(c => { if (U.num(c.low) > 0 && U.num(c.qty) <= U.num(c.low)) lowCount++; });
    acc.forEach(r => { if (r.low > 0 && r.total <= r.low) lowCount++; });

    // Ventes 30 j
    const saleConsoCost = (s) => s.items.filter(i => i.kind === 'C').reduce((a, i) => a + Pricing.saleItemCost(i), 0);
    // Coût de revient des marchandises vendues (mastication + accessoires) — figé à la vente si dispo, sinon estimé.
    const saleCogs = (s) => (s.items || []).filter(i => i.kind === 'M' || i.kind === 'A').reduce((a, i) => a + Pricing.saleItemCost(i), 0);
    // CA accessoires (fait main) d'une vente — cotise à un taux URSSAF différent (artisanat) de la mastication.
    const saleAccCA = (s) => (s.items || []).filter(i => i.kind === 'A').reduce((a, i) => a + U.num(i.price) * U.num(i.qty), 0);
    const socStd = U.num(S.socialTaxRate) / 100;
    const socHM = Pricing.socialRateHandmade() / 100;
    // Cotisations d'une vente : accessoires au taux fait main, reste (mastication + port encaissé) au taux marchandises.
    const saleCotis = (accCA, otherCA) => accCA * socHM + otherCA * socStd;
    // Frais de paiement par processeur : SumUp (ventes directes CB + marchés/retour d'événement)
    // et Stripe (ventes en ligne du site WordPress). Virement & espèces = 0 frais.
    // Le port encaissé passe par le même processeur → il subit aussi la commission.
    const cardRate = U.num(S.cardFeeRate) / 100, stripeRate = U.num(S.stripeFeeRate) / 100;
    const saleCardBase = (s) => (s.payment === 'sumup' || s.payment === 'stripe') ? U.num(s.total) + U.num(s.shippingFeeCollected) : 0;
    const saleProcFee = (s) => s.payment === 'sumup' ? saleCardBase(s) * cardRate : s.payment === 'stripe' ? saleCardBase(s) * stripeRate : 0;
    const cutoff = Date.now() - 30 * 86400000;
    const recent = st.sales.filter(s => !s.cancelled && s.ts >= cutoff);
    const ca = recent.reduce((a, s) => a + U.num(s.total), 0);
    const caCB = recent.reduce((a, s) => a + saleCardBase(s), 0);
    const fees = recent.reduce((a, s) => a + saleProcFee(s), 0);
    const shipping30 = recent.reduce((a, s) => a + U.num(s.shippingCost), 0);
    const shipFee30 = recent.reduce((a, s) => a + U.num(s.shippingFeeCollected), 0);
    const boxCost30 = recent.reduce((a, s) => a + saleConsoCost(s), 0);
    const caAcc30 = recent.reduce((a, s) => a + saleAccCA(s), 0);
    const eventFee30 = recent.reduce((a, s) => a + U.num(s.eventFee), 0);
    const cogs30 = recent.reduce((a, s) => a + saleCogs(s), 0);

    // Tri par colonne de la vue d'ensemble (comme l'ancienne appli).
    const dashSort = this._dashSort || { field: 'type', dir: 'asc' };
    const dashDir = dashSort.dir === 'desc' ? -1 : 1;
    overview.sort((a, b) => {
      if (dashSort.field === 'name') return dashDir * U.sortFr(a.name, b.name);
      if (dashSort.field === 'stock') return dashDir * (a.stock - b.stock);
      if (dashSort.field === 'buy') return dashDir * (a.buy - b.buy);
      if (dashSort.field === 'sell') return dashDir * ((a.sell || 0) - (b.sell || 0));
      return dashDir * U.sortFr(a.type + a.name, b.type + b.name); // 'type' (défaut)
    });
    const dashSortHead = (key, lbl) => `<span class="sortable ${dashSort.field === key ? 'active' : ''}" onclick="App.setDashSort('${key}')">${lbl} ${dashSort.field === key ? (dashSort.dir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;

    // Répartitions pour les graphiques (camemberts cliquables)
    const meatCounts = {};
    inv.forEach(r => { const k = r.meat || 'Autre'; meatCounts[k] = (meatCounts[k] || 0) + 1; });
    const catCounts = {};
    acc.forEach(r => { const k = r.category || 'Autre'; catCounts[k] = (catCounts[k] || 0) + 1; });

    // Valorisation agrégée par type de viande / catégorie accessoire + CA par mois —
    // contenu fusionné depuis l'ancienne page "Synthèses" (Antho : pas d'intérêt à
    // avoir une page séparée qui ne fait que ré-agréger ce qui est déjà visible
    // produit par produit dans la Vue d'ensemble ci-dessous).
    const byMeat = {};
    inv.forEach(r => {
      const m = byMeat[r.meat] = byMeat[r.meat] || { n: 0, kg: 0, pieces: 0, buy: 0, sell: 0 };
      m.n++; m.kg += r.kg; m.pieces += r.pieces; m.buy += r.buy; m.sell += r.sell;
    });
    const meatKeys = Object.keys(byMeat).sort(U.sortFr);
    const totM = Object.values(byMeat).reduce((a, m) => ({ buy: a.buy + m.buy, sell: a.sell + m.sell, n: a.n + m.n }), { buy: 0, sell: 0, n: 0 });

    const byCat = {};
    acc.forEach(a => {
      const c = byCat[a.category] = byCat[a.category] || { n: 0, q: 0, buy: 0, sell: 0 };
      c.n++; c.q += a.total; c.buy += a.buy; c.sell += a.sell;
    });

    const byMonth = {};
    st.sales.filter(s => !s.cancelled).forEach(s => {
      const k = new Date(s.ts).toISOString().slice(0, 7);
      byMonth[k] = byMonth[k] || { ca: 0, caAcc: 0, cogs: 0, cb: 0, fee: 0, n: 0, shipping: 0, shipFee: 0, boxCost: 0, eventFee: 0 };
      byMonth[k].ca += U.num(s.total); byMonth[k].caAcc += saleAccCA(s); byMonth[k].n++;
      byMonth[k].cogs += saleCogs(s);
      byMonth[k].cb += saleCardBase(s); byMonth[k].fee += saleProcFee(s);
      byMonth[k].eventFee += U.num(s.eventFee);
      byMonth[k].shipping += U.num(s.shippingCost);
      byMonth[k].shipFee += U.num(s.shippingFeeCollected);
      byMonth[k].boxCost += saleConsoCost(s);
    });
    const monthKeys = Object.keys(byMonth).sort().reverse().slice(0, 12);
    const uvMaint = Pricing.fixedOverheadMonthly(); // entretien UV + amortissement de tout le matériel, réparti par mois (0 si non renseigné)

    this.mount(`
      <div class="view-title"><h1>Bonjour Antho</h1><span class="sub">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      <div class="grid c4">
        <div class="kpi sensitive" onclick="Stock.tab='mastication';App.go('stock')"><div class="v">${U.eur(valAchat)}</div><div class="l">Valeur stock (achat)</div></div>
        <div class="kpi good sensitive" onclick="Stock.tab='mastication';App.go('stock')"><div class="v">${U.eur(valVente)}</div><div class="l">Valeur stock (vente TTC)</div></div>
        <div class="kpi info2" onclick="Stock.tab='mastication';App.go('stock')"><div class="v">${nbProduits}</div><div class="l">Produits (${enStock} en stock)</div></div>
        <div class="kpi ${lowCount ? 'bad' : 'good'}" onclick="Stock.tab='faible';App.go('stock')"><div class="v">${lowCount}</div><div class="l">Alertes stock (seuils atteints)</div></div>
        <div class="kpi ${alerts.length ? 'bad' : 'good'}" onclick="Stock.tab='peremptions';App.go('stock')"><div class="v">${alerts.length}</div><div class="l">Dates critiques (DLUO ≤ ${S.dluoAlertDays} j)</div></div>
      </div>

      <div class="card mt dash-scope-bar" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <span class="muted" style="font-size:.85rem;margin-right:4px;">Afficher :</span>
        ${[['Mastication', '🥩 Mastication'], ['Matières premières', '🧵 Matières premières'], ['Consommable', '📦 Consommables'], ['Accessoire', '🐕 Accessoires']].map(([k, l]) => `<button class="${dashScope.includes(k) ? 'btn-cta' : 'btn-ghost'} dash-scope-btn" onclick="App.toggleDashScope('${k}')" title="Cliquer pour ajouter / retirer cette catégorie">${l}</button>`).join('')}
        <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="App.setAllDashScope(${dashScope.length === this.dashScopeAll.length ? 'false' : 'true'})">${dashScope.length === this.dashScopeAll.length ? 'Tout décocher' : 'Tout afficher'}</button>
      </div>

      <div class="grid c2 mt">
        <div class="card">
          <h2>🥩 Répartition par type de viande</h2>
          ${Object.keys(meatCounts).length ? `<div style="position:relative;height:240px;"><canvas id="chartMeat"></canvas></div>` : `<p class="muted">Aucun produit.</p>`}
        </div>
        <div class="card">
          <h2>🐕 Répartition par type (accessoires)</h2>
          ${Object.keys(catCounts).length ? `<div style="position:relative;height:240px;"><canvas id="chartCat"></canvas></div>` : `<p class="muted">Aucun accessoire.</p>`}
        </div>
      </div>

      <details class="fold dash-section" id="dashOverview" ${this._dashOverviewOpen ? 'open' : ''} ontoggle="App._dashOverviewOpen=this.open">
        <summary><span>📋 Vue d'ensemble des produits <span class="muted" style="font-weight:400;">(${overview.length})</span></span></summary>
        <div class="fold-body">
        <div class="toolbar mb0">
          <div class="fg" style="max-width:300px;"><input id="dash_q" placeholder="🔍 Rechercher un produit, un type…" value="${U.esc(this._dashQ || '')}" oninput="App._dashQ=this.value;App.renderDashboard();U.refocus('dash_q')"></div>
        </div>
        ${overview.length ? `<div class="table-wrap"><table><thead><tr>
            <th class="col-name">Produit</th><th>${dashSortHead('type', 'Catégorie / Type')}</th>
            <th class="num">${dashSortHead('stock', 'Stock')}</th>
            <th class="num">${dashSortHead('buy', 'Valeur achat')}</th>
            <th class="num">${dashSortHead('sell', 'Valeur vente')}</th></tr></thead>
          <tbody>${overview.map(r => { const href = this.dashRowHref(r); const nameEl = href ? `<a href="${href}" style="text-decoration:none;color:inherit;" title="Ouvrir dans Stock">${U.esc(r.name)}</a>` : U.esc(r.name); return `<tr>
            <td class="col-name"><b>${nameEl}</b> ${r.unlinked ? '<span class="badge warn" title="Ce produit du stock n&#39;est pas relié à un tarif du catalogue">non relié</span>' : ''} ${r.nv > 1 ? `<span class="muted">(${r.nv} var.)</span>` : ''}</td>
            <td><span class="badge ${r.cat === 'Accessoire' ? 'main-sup' : r.cat === 'Matières premières' ? 'info' : r.cat === 'Consommable' ? 'yellow' : 'info'}">${U.esc(r.type)}</span> <span class="muted" style="font-size:.74rem;">${r.cat}</span></td>
            <td class="num">${r.stockLabel}</td>
            <td class="num sensitive">${U.eur(r.buy)}</td>
            <td class="num sensitive">${r.sell != null ? U.eur(r.sell) : '<span class="muted">—</span>'}</td></tr>`; }).join('')}
          </tbody></table></div>` : `<div class="empty"><span class="big">📦</span>Aucun résultat pour ce filtre. Importe ton calculateur et ton stock depuis <b>Paramètres → Import</b>.</div>`}
        </div>
      </details>

      <div class="grid c2 mt">
        <details class="fold dash-section" ${this._dashValMeatOpen ? 'open' : ''} ontoggle="App._dashValMeatOpen=this.open">
          <summary><span>🥩 Valorisation par type de viande</span></summary>
          <div class="fold-body">
          <div class="table-wrap"><table><thead><tr><th class="col-name">Viande</th><th class="num">Poids</th><th class="num">Pièces</th><th class="num">Val. achat</th><th class="num">Val. vente TTC</th><th class="num">Marge pot.</th></tr></thead>
          <tbody>${meatKeys.map(k => { const m = byMeat[k]; return `<tr><td class="col-name"><b>${U.esc(k)}</b> <span class="muted">(${m.n})</span></td>
            <td class="num">${m.kg ? U.qty(m.kg) + ' kg' : '—'}</td><td class="num">${m.pieces ? U.qty(m.pieces) + ' pc' : '—'}</td>
            <td class="num sensitive">${U.eur(m.buy)}</td><td class="num sensitive">${U.eur(m.sell)}</td>
            <td class="num sensitive ${m.sell - m.buy >= 0 ? 'pos' : 'neg'}">${U.eur(m.sell - m.buy)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="muted">Aucun produit.</td></tr>'}</tbody>
          <tfoot><tr><th>Total (${totM.n})</th><th></th><th></th><th class="num sensitive">${U.eur(totM.buy)}</th><th class="num sensitive">${U.eur(totM.sell)}</th><th class="num sensitive">${U.eur(totM.sell - totM.buy)}</th></tr></tfoot></table></div>
          </div>
        </details>
        <details class="fold dash-section" ${this._dashValCatOpen ? 'open' : ''} ontoggle="App._dashValCatOpen=this.open">
          <summary><span>🐕 Valorisation par type (accessoires)</span></summary>
          <div class="fold-body">
          <div class="table-wrap"><table><thead><tr><th class="col-name">Type</th><th class="num">Qté</th><th class="num">Coût de revient</th><th class="num">Val. vente TTC</th><th class="num">Marge pot.</th></tr></thead>
          <tbody>${Object.keys(byCat).sort(U.sortFr).map(k => { const c = byCat[k]; return `<tr><td class="col-name"><b>${U.esc(k)}</b> <span class="muted">(${c.n})</span></td><td class="num">${U.qty(c.q)}</td>
            <td class="num sensitive">${U.eur(c.buy)}</td><td class="num sensitive">${U.eur(c.sell)}</td>
            <td class="num sensitive pos">${U.eur(c.sell - c.buy)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Aucun accessoire.</td></tr>'}</tbody></table></div>
          </div>
        </details>
      </div>

      <details class="fold dash-section mt" ${this._dashCAOpen ? 'open' : ''} ontoggle="App._dashCAOpen=this.open">
        <summary><span>💶 Chiffre d'affaires par mois</span></summary>
        <div class="fold-body">
        <div class="table-wrap"><table><thead><tr><th class="col-name">Mois</th><th class="num">Ventes</th><th class="num">CA total</th><th class="num">Coût revient</th><th class="num">Marge brute</th><th class="num">Frais paiement</th><th class="num">Port encaissé</th><th class="num">Frais d'envoi réel</th><th class="num">Frais stand</th><th class="num">Coût cartons</th>${uvMaint ? '<th class="num">Entretien matériel</th>' : ''}<th class="num">Cotisations URSSAF (${U.pct(S.socialTaxRate)} / ${U.pct(Pricing.socialRateHandmade())})</th><th class="num">TVA ${S.vatActive ? '(reversée)' : '(conservée)'}</th><th class="num">Bénéfice net</th></tr></thead>
        <tbody>${monthKeys.map(k => { const m = byMonth[k], f = m.fee, vr = U.num(S.vatRate), tva = vr > 0 ? m.ca * vr / (100 + vr) : 0, marge = m.ca - m.cogs, cotis = saleCotis(m.caAcc, m.ca - m.caAcc + m.shipFee); const net = marge + m.shipFee - f - m.shipping - m.boxCost - m.eventFee - cotis - uvMaint - (S.vatActive ? tva : 0); const [y, mo] = k.split('-'); return `<tr><td class="col-name"><b>${mo}/${y}</b></td><td class="num">${m.n}</td><td class="num sensitive">${U.eur(m.ca)}</td>
          <td class="num sensitive neg">${m.cogs ? '− ' + U.eur(m.cogs) : '—'}</td><td class="num sensitive ${marge >= 0 ? 'pos' : 'neg'}">${U.eur(marge)}</td><td class="num sensitive neg">${f ? '− ' + U.eur(f) : '—'}</td><td class="num sensitive pos">${m.shipFee ? '+ ' + U.eur(m.shipFee) : '—'}</td><td class="num sensitive neg">${m.shipping ? '− ' + U.eur(m.shipping) : '—'}</td><td class="num sensitive neg">${m.eventFee ? '− ' + U.eur(m.eventFee) : '—'}</td><td class="num sensitive neg">${m.boxCost ? '− ' + U.eur(m.boxCost) : '—'}</td>${uvMaint ? `<td class="num sensitive neg" title="Entretien imprimante UV + amortissement de tout le matériel (imprimante, extracteur, scelleuse…) réparti par mois">− ${U.eur(uvMaint)}</td>` : ''}<td class="num sensitive neg">− ${U.eur(cotis)}</td>${S.vatActive ? `<td class="num sensitive neg" title="TVA reversée — déduite du bénéfice (assujetti)">${tva ? '− ' + U.eur(tva) : '—'}</td>` : `<td class="num sensitive pos" title="TVA contenue dans le CA — conservée dans ton bénéfice (non assujetti)">${tva ? U.eur(tva) : '—'}</td>`}<td class="num sensitive ${net >= 0 ? 'pos' : 'neg'}">${U.eur(net)}</td></tr>`; }).join('') || `<tr><td colspan="${uvMaint ? 14 : 13}" class="muted">Aucune vente enregistrée.</td></tr>`}</tbody></table></div>
        <p class="muted mt">"Coût revient" = coût d'achat/de fabrication des produits vendus (mastication : coût réel des lots ; accessoires : matières + main d'œuvre), figé à la vente ou estimé au coût actuel pour les ventes antérieures. "Marge brute" = CA − coût revient. "Frais paiement" = commission ${U.pct(S.cardFeeRate)} SumUp (ventes directes CB + marchés / retours d'événement) et ${U.pct(S.stripeFeeRate)} Stripe (ventes en ligne du site) ; virement et espèces = 0 frais. "Cotisations URSSAF" = ${U.pct(S.socialTaxRate)} sur la mastication (vente de marchandises) + ${U.pct(Pricing.socialRateHandmade())} sur les accessoires (fait main / artisanat), calculées ligne par ligne selon la nature du produit ; le port encaissé cotise au taux marchandises. Reste à déclarer/payer réellement à l'URSSAF, déjà déduit ici du bénéfice net. "TVA" = TVA contenue dans le CA (au taux ${U.pct(S.vatRate)}) : ${S.vatActive ? '<b>reversée</b> (assujetti) → déduite du bénéfice net.' : '<b>conservée</b> dans ton bénéfice (non assujetti) — elle sera déduite automatiquement le jour où tu coches « Je suis assujetti à la TVA » ci-dessus.'} "Port encaissé" = frais de livraison facturés au client (sous le seuil réglé en Paramètres) ; "Frais d'envoi réel" = ce que tu as payé au transporteur ; "Frais stand" = coût de l'emplacement d'un marché/événement (saisi au retour d'événement, modifiable dans l'historique des ventes) ; "Coût cartons" = coût des consommables utilisés dans le ticket.${uvMaint ? ` "Entretien matériel" = entretien de l'imprimante UV (filtres + cartouches de nettoyage + main d'œuvre) + amortissement de tout le matériel de l'atelier (imprimante, extracteur, scelleuse… réglés en Paramètres → Réglages financiers), réparti par mois (${U.eur(uvMaint)}/mois) — charge fixe indépendante du volume vendu.` : ''}</p>
        </div>
      </details>

      <details class="fold dash-section mt" ${this._dashActOpen ? 'open' : ''} ontoggle="App._dashActOpen=this.open">
        <summary><span>📊 Rentabilité par activité (tout l'historique)</span></summary>
        <div class="fold-body">
        <p class="muted">Mastication (achat-revente) vs accessoires (fait main). Chaque article compte dans son activité ; frais et charges fixes communs répartis au prorata du CA (entretien/amortissement UV → accessoires). La somme des deux = le bénéfice net global.</p>
        ${(() => { const as = st.sales.filter(x => !x.cancelled); const mc = new Set(as.map(x => new Date(x.ts).toISOString().slice(0, 7))).size || 1; return Stats._activityTable(Pricing.activityPnL(as, mc)); })()}
        </div>
      </details>

      <p class="muted mt sensitive">Coût revient 30 j : <b>${U.eur(cogs30)}</b> · Marge brute 30 j : <b>${U.eur(ca - cogs30)}</b> · Frais paiement estimés sur 30 j : <b>${U.eur(fees)}</b> (SumUp ${U.pct(S.cardFeeRate)} / Stripe ${U.pct(S.stripeFeeRate)}, sur ${U.eur(caCB)} par carte) · Port encaissé 30 j : <b>${U.eur(shipFee30)}</b> · Frais d'envoi 30 j : <b>${U.eur(shipping30)}</b> · Frais stand 30 j : <b>${U.eur(eventFee30)}</b> · Coût cartons 30 j : <b>${U.eur(boxCost30)}</b>${uvMaint ? ` · Entretien matériel / mois : <b>${U.eur(uvMaint)}</b>` : ''} · Cotisations 30 j : <b>${U.eur(saleCotis(caAcc30, ca - caAcc30 + shipFee30))}</b> · CA 30 j : <b>${U.eur(ca)}</b> (${recent.length} ventes)</p>`);

    this.renderCharts(meatCounts, catCounts);
  },

  /* ================= GRAPHIQUES (camemberts cliquables) ================= */
  _charts: {},
  renderCharts(meatCounts, catCounts) {
    if (typeof Chart === 'undefined') return; // CDN indisponible (hors-ligne) : pas bloquant
    const dark = Theme.get() === 'dark';
    const textColor = dark ? '#eee3d3' : '#1c2b33';
    const borderColor = dark ? '#1c3844' : '#ffffff';
    const palette = ['#a67153', '#4a7c59', '#c0564a', '#b97a24', '#5c6a78', '#7fc4e8', '#d99a78', '#8fd6a4', '#f29d92', '#f0b667', '#c9a8e0', '#6fb1c9', '#e0a1c4', '#9fb98a', '#e8c76a', '#8a9bd6', '#d6866a', '#6fd6c1', '#c98acb', '#a3d66a'];

    const build = (id, counts, scopeCat) => {
      const canvas = document.getElementById(id); if (!canvas) return;
      this._charts[id]?.destroy();
      const labels = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      const data = labels.map(l => counts[l]);
      this._charts[id] = new Chart(canvas, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => palette[i % palette.length]), borderColor, borderWidth: 2 }] },
        options: {
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right', labels: { color: textColor, boxWidth: 14, font: { family: 'Quicksand', size: 11 } },
              onClick: (evt, item, legend) => this.filterDashboard(legend.chart.data.labels[item.index], scopeCat)
            }
          },
          onClick: (evt, elements) => { if (elements.length) this.filterDashboard(labels[elements[0].index], scopeCat); }
        }
      });
    };
    build('chartMeat', meatCounts, 'Mastication');
    build('chartCat', catCounts, 'Accessoire');
  },

  /* Clic sur une part de camembert : filtre la vue d'ensemble (et donc les KPI du haut,
     qui en dérivent) sur ce type précis, en restreignant le périmètre à sa catégorie
     (ex: cliquer "Sanglier" ne montre que la Mastication Sanglier, pas des matières homonymes). */
  filterDashboard(label, scopeCat) {
    this._dashQ = label;
    if (scopeCat) this._dashScope = [scopeCat];
    this._dashOverviewOpen = true;
    this.renderDashboard();
    setTimeout(() => document.getElementById('dashOverview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  },

  setDashSort(field) {
    const cur = this._dashSort || { field: 'type', dir: 'asc' };
    this._dashSort = cur.field === field ? { field, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' };
    this.renderDashboard();
  },

  toggleDashScope(cat) {
    const cur = this._dashScope || ['Mastication'];
    const i = cur.indexOf(cat);
    this._dashScope = i >= 0 ? cur.filter(c => c !== cat) : [...cur, cat];
    this.renderDashboard();
  },
  setAllDashScope(all) { this._dashScope = all ? [...this.dashScopeAll] : []; this.renderDashboard(); },
  setDashScopeOpen(open) { this._dashScopeOpen = open; }
};
window.App = App;
document.addEventListener('DOMContentLoaded', () => App.boot());
