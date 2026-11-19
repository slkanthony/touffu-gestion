/* ============================================================
   RÉPERTOIRE : Clients, Partenaires, Événements (gestion/simulation)
   Regroupement des fiches de référence, séparé des Statistiques.
   ============================================================ */
const Repertoire = {
  tab: 'clients',
  _evSim: '',
  _evSimCA: null,
  _evSimCur: '',

  setTab(t) { this.tab = t; this.render(); },

  tabBar() {
    const t = this.tab || 'clients';
    const tabs = [];
    if (!App.isViewer) tabs.push(['clients', '👤 Clients']);
    if (!App.isViewer && !App.isTeam) tabs.push(['partners', '🤝 Partenaires']);
    tabs.push(['events', '🎪 Événements']);
    return `<div class="card">${U.seg(tabs.map(([k, l]) => ({ l, on: t === k, js: `Repertoire.setTab('${k}')` })), { full: true, scroll: true, label: 'Répertoire' })}</div>`;
  },

  render() {
    U.syncFilters('repertoire', this, ['tab']);
    if (this.tab === 'partners' && !App.isViewer && !App.isTeam) return Partners.render();
    if (this.tab === 'events') return this.renderEvents();
    if (this.tab === 'clients' && !App.isViewer) return Clients.render();
    return this.renderEvents();
  },

  renderEvents() {
    const allNames = Store.eventList();
    const simName = this._evSim && allNames.includes(this._evSim) ? this._evSim : '';
    const fi = simName ? Store.eventInfo(simName) : {};
    const inp = (key, lbl, ph, step) => key === 'note' ? `<div class="fg"><label>${lbl}</label><textarea class="note-area" id="evf_note" rows="1" placeholder="${ph}" oninput="Repertoire._evFicheDirty()">${U.esc(fi[key] ?? '')}</textarea></div>` : `<div class="fg"><label>${lbl}</label><input id="evf_${key}" ${step ? `type="number" step="${step}" min="0"` : ''} value="${U.esc(fi[key] ?? '')}" placeholder="${ph}" oninput="Repertoire._evFicheDirty()"></div>`;
    const Sx = Store.state.settings, consX = U.num(Sx.fuelConsumption ?? 7), priceX = U.num(Sx.fuelPrice ?? 1.85);
    App.mount(`
      <div class="view-title"><h1>Répertoire</h1><span class="sub">événements</span></div>
      ${this.tabBar()}
      <div class="card">
        <h2>🎪 Mes événements — fiche &amp; simulation</h2>
        <p class="muted help">Choisis (ou crée) un marché, enregistre sa fiche habituelle (stand, km, péages…) : elle sera pré-remplie à chaque retour d'événement. La simulation en bas se met à jour avec.</p>
        <div class="frow" style="gap:10px;align-items:flex-end;flex-wrap:wrap;">
          <div class="fg" style="max-width:300px;"><label>Événement</label>${Ventes.eventSelect(simName, 'Repertoire._evSim=v;Repertoire.render()', '', 'Repertoire.render()')}</div>
          ${simName ? `<div class="fg" style="max-width:200px;"><label>CA espéré (€)</label><input id="ev_sim_ca" type="number" step="1" min="0" value="${(this._evSimCA || {})[simName] || ''}" placeholder="moyenne" oninput="(Repertoire._evSimCA=Repertoire._evSimCA||{})[Repertoire._evSimCur]=this.value;Repertoire._simEvent()"></div>` : ''}
        </div>
        ${simName ? `<div class="mt" style="border:1px solid rgba(166,113,83,.45);border-radius:10px;padding:12px 14px;">
          <h3 style="margin:0 0 8px;">📋 Fiche « ${U.esc(simName)} »</h3>
          <div class="grid c3">
          ${inp('place', 'Lieu', 'ex : Lyon, place Bellecour')}
          ${inp('stand', 'Prix du stand habituel (€)', '0', '0.01')}
          ${inp('km', 'Kilomètres aller-retour', '0', '1')}
          ${inp('tolls', 'Péages / parking (€)', '0', '0.01')}
          ${inp('other', 'Hébergement / autres (€)', '0', '0.01')}
          ${inp('note', 'Note', 'ex : installation 7h, prévoir tonnelle')}
          </div>
          <p class="muted" style="font-size:.82rem;margin:4px 0 8px;">🚗 Déplacement : ${U.num(fi.km)} km × ${String(consX).replace('.', ',')} L/100 km × ${U.eur(priceX)}/L + péages + autres = <b class="sensitive">${U.eur(Store.eventTravelCost(simName))}</b> <span style="font-size:.78rem;">(consommation et prix du litre : Paramètres → Réglages financiers)</span></p>
          <button class="btn-cta btn-sm" id="evf_save" onclick="Repertoire.saveEventFiche()">💾 Enregistrer la fiche</button> <span id="evf_state" class="muted" style="font-size:.82rem;">${Object.keys(fi).length ? '✅ Fiche enregistrée' : 'Fiche vide'}</span>
        </div>
        <h3 class="mt" style="margin-bottom:0;">🧮 Simulation</h3>
        <div id="ev_sim_out" class="mt"></div>` : `<p class="muted mt">${allNames.length ? 'Choisis un événement dans le menu pour voir et modifier sa fiche, puis simuler un marché.' : 'Aucun événement : crée-en un avec « ＋ Nouvel événement… ».'}</p>`}
      </div>`);
    this._evSimCur = simName;
    if (simName) this._simEvent();
  },

  _evFicheDirty() { const e = document.getElementById('evf_state'); if (e) { e.textContent = '● Modifications non enregistrées'; e.style.color = '#f5b041'; } },

  saveEventFiche() {
    const name = this._evSimCur; if (!name) return;
    const S = Store.state.settings; S.eventInfo = S.eventInfo || {};
    const e = S.eventInfo[name] = S.eventInfo[name] || {};
    ['place', 'note'].forEach(k => { e[k] = U.val('evf_' + k).trim(); });
    ['stand', 'km', 'tolls', 'other'].forEach(k => { const v = U.val('evf_' + k); e[k] = v === '' ? '' : U.num(v); });
    if (!(S.events || []).includes(name)) (S.events = S.events || []).push(name);
    Store.save('settings'); this.render();
    U.toast('Fiche « ' + name + ' » enregistrée — pré-remplie au prochain retour d\'événement.');
  },

  _simEvent() {
    const out = document.getElementById('ev_sim_out'); if (!out) return;
    const name = this._evSimCur; if (!name) return;
    const all = Stats._eventAgg().list;
    const e = all.find(x => x.name === name);
    const exFees = t => t.net + t.stand + t.travel;
    const n = e ? (e.editions || 1) : 0;
    const gCA = all.reduce((a, x) => a + x.tot.ca, 0), gEx = all.reduce((a, x) => a + exFees(x.tot), 0);
    const gEd = all.reduce((a, x) => a + (x.editions || 1), 0);
    const own = !!(e && e.tot.ca > 0);
    const rate = own ? exFees(e.tot) / e.tot.ca : (gCA > 0 ? gEx / gCA : 0);
    const avgCA = own ? e.tot.ca / n : (gEd ? gCA / gEd : 0);
    const typed = U.val('ev_sim_ca');
    const ca = typed === '' ? avgCA : U.num(typed);
    const fee = U.num(Store.eventInfo(name).stand), travel = Store.eventTravelCost(name);
    const exF = ca * rate;
    const est = exF - fee - travel;
    const breakEven = rate > 0 ? (fee + travel) / rate : null;
    const caLbl = typed !== '' ? 'CA espéré (saisi)' : own ? `CA moyen de cet événement (${n} édition(s))` : 'CA moyen de tous tes événements';
    if (!rate) { out.innerHTML = `<p class="muted">Pas encore assez de ventes d'événement pour estimer un taux de bénéfice. Stand + déplacement prévus : <b class="sensitive">${U.eur(fee + travel)}</b>.</p>`; return; }
    out.innerHTML = `<div class="recap-grid">
      <div class="kpi recap-tile sensitive"><div class="v">${U.eur(ca)}</div><div class="l">${caLbl}</div></div>
      <div class="kpi recap-tile sensitive"><div class="v">${U.eur(exF)}</div><div class="l">Bénéfice avant stand & déplacement (${Math.round(rate * 100)} % du CA)</div></div>
      <div class="kpi recap-tile sensitive"><div class="v">${U.eur(fee)}</div><div class="l">Stand prévu (fiche)</div></div>
      <div class="kpi recap-tile sensitive"><div class="v">${U.eur(travel)}</div><div class="l">Déplacement prévu (fiche)</div></div>
      <div class="kpi recap-tile sensitive ${est >= 0 ? 'good' : 'bad'} recap-net"><div class="v ${est >= 0 ? 'pos' : 'neg'}">${U.eur(est)}</div><div class="l">Bénéfice estimé</div></div>
      <div class="kpi recap-tile sensitive"><div class="v">${breakEven === null ? '—' : U.eur(breakEven)}</div><div class="l">CA minimum pour couvrir stand + déplacement</div></div>
    </div>
    <p class="muted" style="font-size:.82rem;margin-top:8px;">${est >= 0 ? '✅ Rentable avec ce CA.' : '🔴 En perte avec ce CA.'} ${own ? `Taux de bénéfice tiré de tes ${n} édition(s) de cet événement.` : "Pas encore d'historique pour cet événement : taux de bénéfice moyen de tous tes événements."} À prendre comme un ordre de grandeur.</p>
    <p class="muted" style="font-size:.82rem;margin-top:4px;"><b>Comment c'est calculé :</b> CA prévu (celui que tu saisis, sinon ${own ? 'la moyenne de cet événement' : 'la moyenne de tous tes événements'}) × ${Math.round(rate * 100)} % (part du CA qui te reste sur tes événements passés après coût de revient, frais de paiement, consommables et cotisations, avant stand et déplacement) − stand − déplacement de la fiche.</p>`;
  },
};
