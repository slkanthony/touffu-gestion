/* ═══════════ Clients & chiens (2026-09-30) ═══════════
   Store.state.clients = [{id, name, phone, email, note, dogs:[{id, name, breed, birth, gabarit, chew, meats:{<viande>:'like'|'avoid'},
   allergies, health, food, hair, odor, fat, liked, note}]}]
   Le lien avec les ventes se fait par le NOM (sale.customerName, casse/espaces ignorés) : renommer un client met à jour ses ventes.
   Affiché dans Statistiques → 👤 Clients (admin seulement : données personnelles). */
const Clients = {
  _open: {}, _dogOpen: {}, _q: '', _sort: { k: 'ca', dir: 'desc' },
  key(n) { return String(n || '').trim().toLowerCase(); },
  list() { return Store.state.clients || (Store.state.clients = []); },
  find(name) { const k = this.key(name); return k ? this.list().find(c => this.key(c.name) === k) : null; },
  names() {
    const set = new Map();
    this.list().forEach(c => set.set(this.key(c.name), c.name));
    (Store.state.sales || []).forEach(s => { const n = (s.customerName || '').trim(); if (n && !set.has(this.key(n))) set.set(this.key(n), n); });
    return [...set.values()].sort((a, b) => a.localeCompare(b, 'fr'));
  },
  datalist() { return `<datalist id="dl_clients">${this.names().map(n => `<option value="${U.esc(this.show(n))}">`).join('')}</datalist>`; },
  ro() { return !!App.isViewer; },   // profil visite : lecture seule, prénom uniquement, pas de coordonnées
  split(name) { const t = String(name || '').trim(), i = t.indexOf(' '); return i < 0 ? { first: t, last: '' } : { first: t.slice(0, i), last: t.slice(i + 1).trim() }; },
  show(name) {   // nom affiché : complet, ou prénom seul pour le profil visite
    const n = String(name || '').trim(); if (!n || !App.isViewer) return n;
    const c = this.find(n); return c && c.firstName ? c.firstName : this.split(n).first;
  },
  _new(name) { const p = this.split(name); return { id: U.uid(), name: String(name).trim(), firstName: p.first, lastName: p.last, phone: '', email: '', note: '', dogs: [] }; },
  ensure(name) {
    const n = String(name || '').trim(); if (!n) return null;
    let c = this.find(n);
    if (!c) { c = this._new(n); this.list().push(c); Store.save('clients'); }
    return c;
  },
  _sync() {   // crée les fiches manquantes pour les noms déjà présents sur des ventes
    let added = false;
    if (this.ro()) return;
    this.list().forEach(c => { if (c.firstName === undefined) { const p = this.split(c.name); c.firstName = p.first; c.lastName = p.last; added = true; } });
    (Store.state.sales || []).forEach(s => { const n = (s.customerName || '').trim(); if (n && !this.find(n)) { this.list().push(this._new(n)); added = true; } });
    if (added) Store.save('clients');
  },
  _norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); },
  /* Alerte intolérance à la vente : viande cochée ⛔ sur un chien du client, ou mot des « allergies / intolérances » présent dans la viande ou le nom du produit. */
  conflicts(clientName, u) {
    const c = this.find(clientName); if (!c || !u || u.kind !== 'M') return [];
    const meat = this._norm(u.type), prod = this._norm(u.name), out = [];
    c.dogs.forEach(d => {
      const who = d.name || 'Un chien';
      const av = Object.keys(d.meats || {}).find(m => d.meats[m] === 'avoid' && this._norm(m) === meat);
      if (av) out.push(`${who} évite / n'aime pas : ${av}`);
      String(d.allergies || '').split(/[,;/+\n]| et /).map(t => this._norm(t).trim().replace(/s$/, '')).filter(t => t.length >= 3).forEach(t => {
        if (meat.includes(t) || t.includes(meat) && meat.length >= 3 || prod.includes(t)) out.push(`${who} : allergie / intolérance « ${t} »`);
      });
    });
    return [...new Set(out)];
  },
  ageTxt(birth) {
    if (!birth) return '';
    const b = new Date(birth), n = new Date(); if (isNaN(b)) return '';
    let m = (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth(); if (n.getDate() < b.getDate()) m--;
    if (m < 0) return '';
    const y = Math.floor(m / 12), r = m % 12;
    return y ? `${y} an${y > 1 ? 's' : ''}${r ? ' ' + r + ' mois' : ''}` : `${r} mois`;
  },
  _agg() {
    const map = {};
    (Store.state.sales || []).filter(s => !s.cancelled).forEach(s => {
      const k = this.key(s.customerName); if (!k) return;
      const a = map[k] || (map[k] = { n: 0, ca: 0, net: 0, last: 0, prods: {}, sales: [] });
      a.n++; a.ca += U.num(s.total); a.net += Pricing.saleProfit(s).net; a.last = Math.max(a.last, s.ts); a.sales.push(s);
      (s.items || []).filter(i => i.kind !== 'C').forEach(i => {
        const pk = i.name + (i.label ? ' ' + i.label : '');
        const p = a.prods[pk] || (a.prods[pk] = { qty: 0, last: 0 }); p.qty += U.num(i.qty); p.last = Math.max(p.last, s.ts);
      });
    });
    return map;
  },

  /* ---------- actions ---------- */
  toggle(id) { this._open[id] = !this._open[id]; Stats.render(); },
  setQ(v) { this._q = v; Stats.render(); U.refocus('cl_q'); },
  setSort(k) { this._sort = this._sort.k === k ? { k, dir: this._sort.dir === 'asc' ? 'desc' : 'asc' } : { k, dir: k === 'name' ? 'asc' : 'desc' }; Stats.render(); },
  create() {
    if (this.ro()) return;
    const el = document.getElementById('cl_new'); const n = (el && el.value || '').trim();
    if (!n) { U.toast('Tape le nom du client.', true); return; }
    if (this.find(n)) { U.toast('Ce client existe déjà.', true); return; }
    const c = this._new(n);
    this.list().push(c); this._open[c.id] = true; Store.save('clients'); Stats.render();
  },
  setField(cid, f, v) {
    if (this.ro()) return;
    const c = this.list().find(x => x.id === cid); if (!c) return;
    if (f === 'firstName' || f === 'lastName') {
      const first = String(f === 'firstName' ? v : c.firstName || '').trim(), last = String(f === 'lastName' ? v : c.lastName || '').trim();
      const full = (first + ' ' + last).trim();
      if (!first) { U.toast('Le prénom ne peut pas être vide.', true); Stats.render(); return; }
      const other = this.find(full); if (other && other.id !== cid) { U.toast('Un autre client porte déjà ce nom.', true); Stats.render(); return; }
      const ok = this.key(c.name);
      (Store.state.sales || []).forEach(s => { if (this.key(s.customerName) === ok) s.customerName = full; });
      Store.save('sales');
      c.firstName = first; c.lastName = last; c.name = full; Store.save('clients'); Stats.render(); return;
    }
    c[f] = v; Store.save('clients'); Stats.render();
  },
  async remove(cid) {
    if (this.ro()) return;
    const c = this.list().find(x => x.id === cid); if (!c) return;
    if (!await U.confirm(`Supprimer la fiche de « ${c.name} » et de ses chiens ? (Ses ventes restent, avec son nom.)`)) return;
    const snap = Store.snapshot('clients', c);
    Store.state.clients = this.list().filter(x => x.id !== cid);
    const entry = Store.commitSnapshot(snap, 'client', `Client supprimé — ${c.name}`);
    Store.save('clients'); U.toast('Fiche supprimée.', false, entry.id); Stats.render();
  },
  addDog(cid) {
    if (this.ro()) return;
    const c = this.list().find(x => x.id === cid); if (!c) return;
    c.dogs.push({ id: U.uid(), name: '', breed: '', birth: '', gabarit: '', chew: '', meats: {}, allergies: '', health: '', food: '', pets: '', hair: '', odor: '', fat: '', liked: '', note: '' });
    this._dogOpen[c.dogs[c.dogs.length - 1].id] = true; Store.save('clients'); Stats.render();
  },
  async delDog(cid, did) {
    if (this.ro()) return;
    const c = this.list().find(x => x.id === cid); if (!c) return;
    const d = c.dogs.find(x => x.id === did); if (!d) return;
    if (!await U.confirm(`Supprimer la fiche de ${d.name || 'ce chien'} ?`)) return;
    c.dogs = c.dogs.filter(x => x.id !== did); Store.save('clients'); Stats.render();
  },
  setDog(cid, did, f, v) {
    if (this.ro()) return;
    const c = this.list().find(x => x.id === cid); const d = c && c.dogs.find(x => x.id === did); if (!d) return;
    d[f] = v; Store.save('clients'); if (f === 'birth' || f === 'name') Stats.render();
  },
  cycleMeat(cid, did, m) {
    if (this.ro()) return;
    const c = this.list().find(x => x.id === cid); const d = c && c.dogs.find(x => x.id === did); if (!d) return;
    d.meats = d.meats || {}; const cur = d.meats[m];
    if (!cur) d.meats[m] = 'like'; else if (cur === 'like') d.meats[m] = 'avoid'; else delete d.meats[m];
    Store.save('clients'); Stats.render();
  },

  /* ---------- rendu ---------- */
  _sel(cid, did, f, v, opts) {
    return `<select ${this.ro() ? 'disabled' : ''} onchange="Clients.setDog('${cid}','${did}','${f}',this.value)">${opts.map(o => `<option value="${o[0]}" ${String(v || '') === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
  },
  _dogCard(c, d) {
    const meats = (Store.state.settings.meatTypes || []).slice().sort(U.sortFr);
    const ro = this.ro() ? 'disabled' : '';
    const inp = (f, lbl, ph) => `<div class="fg"><label>${lbl}</label><input ${ro} value="${U.esc(d[f] || '')}" placeholder="${ph || ''}" onchange="Clients.setDog('${c.id}','${d.id}','${f}',this.value)"></div>`;
    const yn = [['', '— ?'], ['ok', 'Oui, aucun souci'], ['non', 'Non, ça le dérange']];
    const chips = meats.map(m => { const st = (d.meats || {})[m]; return `<span class="cl-chip ${st || ''}" title="Clique : aime ❤ → évite ⛔ → neutre" onclick="Clients.cycleMeat('${c.id}','${d.id}','${U.esc(m).replace(/'/g, '&#39;')}')">${st === 'like' ? '❤ ' : st === 'avoid' ? '⛔ ' : ''}${U.esc(m)}</span>`; }).join('');
    const age = this.ageTxt(d.birth);
    const sub = [age, d.allergies ? '⚠️ ' + U.esc(d.allergies) : ''].filter(Boolean).join(' · ');
    return `<details class="cl-dog fold" ${this._dogOpen[d.id] || !d.name ? 'open' : ''} ontoggle="Clients._dogOpen['${d.id}']=this.open"><summary class="cl-dog-h"><b>🐕 ${U.esc(d.name || 'Nouveau chien')}</b>${sub ? ` <span class="muted">· ${sub}</span>` : ''}</summary>
      <div class="cl-dog-b">
      ${ro ? '' : `<div style="text-align:right;margin-bottom:6px;"><button class="btn-danger btn-sm" onclick="Clients.delDog('${c.id}','${d.id}')">🗑 Retirer ce chien</button></div>`}
      <div class="grid c4">
        ${inp('name', 'Nom', 'Rex')}${inp('breed', 'Race', 'Berger allemand')}
        <div class="fg"><label>Date de naissance</label><input ${ro} type="date" value="${U.esc(d.birth || '')}" onchange="Clients.setDog('${c.id}','${d.id}','birth',this.value)"></div>
        <div class="fg"><label>Gabarit</label>${this._sel(c.id, d.id, 'gabarit', d.gabarit, [['', '—'], ['petit', 'Petit'], ['moyen', 'Moyen'], ['grand', 'Grand']])}</div>
        <div class="fg"><label>Mâcheur</label>${this._sel(c.id, d.id, 'chew', d.chew, [['', '—'], ['doux', 'Doux'], ['moyen', 'Moyen'], ['gros', 'Gros destructeur']])}</div>
        <div class="fg"><label>Aime les produits avec poils</label>${this._sel(c.id, d.id, 'hair', d.hair, yn)}</div>
        <div class="fg"><label>Supporte les odeurs fortes</label>${this._sel(c.id, d.id, 'odor', d.odor, yn)}</div>
        <div class="fg"><label>Supporte les produits gras</label>${this._sel(c.id, d.id, 'fat', d.fat, yn)}</div>
      </div>
      <div class="fg mt"><label>Viandes <span class="muted" style="font-weight:400;">(clique : ❤ aime · ⛔ évite / n'aime pas)</span></label><div class="cl-chips">${chips}</div></div>
      <div class="grid c2 mt">
        ${inp('allergies', '⚠️ Allergies / intolérances', 'ex : poulet, céréales')}${inp('health', 'Maladie / santé', 'ex : pancréatite')}
        ${inp('food', 'Croquettes / alimentation', 'marque, ration…')}${inp('liked', 'Produits préférés / déjà mastiqués', 'ex : oreilles de porc, tendons')}
        ${inp('pets', 'Vit avec d\'autres animaux ?', 'ex : un chat, un lapin — vide = vit seul')}
      </div>
      ${inp('note', 'Note', 'autre chose à retenir')}
      </div></details>`;
  },
  _fiche(c, a) {
    const inp = (f, lbl, ph, type) => `<div class="fg"><label>${lbl}</label><input ${type ? `type="${type}"` : ''} value="${U.esc(c[f] || '')}" placeholder="${ph || ''}" onchange="Clients.setField('${c.id}','${f}',this.value)"></div>`;
    const prods = a ? Object.entries(a.prods).sort((x, y) => y[1].qty - x[1].qty) : [];
    const orders = a ? a.sales.slice().sort((x, y) => y.ts - x.ts) : [];
    return `<tr class="cl-fiche"><td colspan="6"><div class="cl-body">
      ${this.ro() ? '' : `<div class="cl-id">${inp('firstName', 'Prénom', '')}${inp('lastName', 'Nom', '')}${inp('phone', 'Téléphone', '', 'tel')}${inp('email', 'Email', '', 'email')}${inp('note', 'Note', 'ex : rencontré au marché de…')}</div>
      <div class="cl-id mt">
        <div class="fg"><label>Commandes en ligne (stock général)</label><select onchange="Clients.setField('${c.id}','delivery',this.value)">${[['', '— ?'], ['clickcollect', '🏬 Click & Collect'], ['livraison', '📦 Livraison']].map(o => `<option value="${o[0]}" ${(c.delivery || '') === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
        ${c.delivery === 'livraison' ? `<div class="fg" style="grid-column:span 2;"><label>Point Mondial Relay habituel</label><input value="${U.esc(c.relay || '')}" placeholder="nom du relais, ville, n° du point…" onchange="Clients.setField('${c.id}','relay',this.value)"></div>` : ''}
      </div>`}
      <h3 class="mt">🐕 Chiens (${c.dogs.length})</h3>
      ${c.dogs.map(d => this._dogCard(c, d)).join('') || '<p class="muted">Aucun chien renseigné.</p>'}
      ${this.ro() ? '' : `<button class="btn-cta btn-sm" onclick="Clients.addDog('${c.id}')">＋ Ajouter un chien</button>`}
      <h3 class="mt">🛒 Achats</h3>
      ${a ? `<div class="cl-cols">
        <div><div class="muted" style="font-size:.82rem;margin-bottom:4px;">Produits achetés (quantité totale)</div><table class="pack-tbl"><tbody>${prods.map(([n, p]) => `<tr><td class="col-name" style="text-align:left;">${U.esc(n)}</td><td class="num">×${p.qty}</td><td class="num muted">${new Date(p.last).toLocaleDateString('fr-FR')}</td></tr>`).join('')}</tbody></table></div>
        <div><div class="muted" style="font-size:.82rem;margin-bottom:4px;">Commandes</div><table class="pack-tbl"><tbody>${orders.map(s => `<tr><td class="col-name" style="text-align:left;">${new Date(s.ts).toLocaleDateString('fr-FR')}${s.eventName ? ' · 🎪 ' + U.esc(s.eventName) : ''}</td><td class="num sensitive">${U.eur(s.total)}</td></tr>`).join('')}</tbody></table></div>
      </div>` : '<p class="muted">Aucune commande pour ce client.</p>'}
      ${this.ro() ? '' : `<div class="mt"><button class="btn-danger btn-sm" onclick="Clients.remove('${c.id}')">🗑 Supprimer ce client</button></div>`}
    </div></td></tr>`;
  },
  render() {
    U.syncFilters('clients_ui', this, ['_q', '_sort']);
    this._sync();
    const agg = this._agg(), q = this._q.toLowerCase(), so = this._sort, dir = so.dir === 'asc' ? 1 : -1;
    const noName = (Store.state.sales || []).filter(s => !s.cancelled && !this.key(s.customerName)).length;
    const rowsData = this.list().map(c => ({ c, a: agg[this.key(c.name)] || { n: 0, ca: 0, net: 0, last: 0, prods: {}, sales: [] } }))
      .filter(x => !q || this.show(x.c.name).toLowerCase().includes(q) || x.c.dogs.some(d => (d.name || '').toLowerCase().includes(q)))
      .sort((x, y) => so.k === 'name' ? dir * U.sortFr(this.show(x.c.name), this.show(y.c.name)) : so.k === 'dogs' ? dir * (x.c.dogs.length - y.c.dogs.length) : dir * (x.a[so.k] - y.a[so.k]));
    const sh = (k, l) => `<span class="sortable ${so.k === k ? 'active' : ''}" onclick="Clients.setSort('${k}')">${l} ${so.k === k ? (so.dir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
    const rows = rowsData.map(({ c, a }) => {
      const open = !!this._open[c.id];
      return `<tr style="cursor:pointer;" onclick="Clients.toggle('${c.id}')"><td class="col-name" style="text-align:left;"><b>${open ? '▾' : '▸'} 👤 ${U.esc(this.show(c.name))}</b></td><td style="text-align:left;">${c.dogs.length ? c.dogs.map(d => '🐕 ' + U.esc(d.name || '?')).join(' · ') : '<span class="muted">—</span>'}</td><td class="num">${a.n}</td><td class="num sensitive">${U.eur(a.ca)}</td><td class="num sensitive ${a.net >= 0 ? 'pos' : 'neg'}">${a.n ? U.eur(a.net) : '—'}</td><td class="num">${a.last ? new Date(a.last).toLocaleDateString('fr-FR') : '—'}</td></tr>${open ? this._fiche(c, a.n ? a : null) : ''}`;
    }).join('');
    App.mount(`
      <div class="view-title"><h1>Statistiques</h1><span class="sub">clients &amp; chiens</span></div>
      ${Stats.tabBar()}
      <div class="card">
        <h2>👤 Mes clients</h2>
        <div class="frow" style="gap:10px;align-items:flex-end;flex-wrap:wrap;">
          <div class="fg" style="max-width:280px;"><label>Rechercher (client ou chien)</label><input id="cl_q" value="${U.esc(this._q)}" placeholder="nom…" oninput="Clients.setQ(this.value)"></div>
          ${this.ro() ? '' : `<div class="fg" style="max-width:280px;"><label>Nouveau client <span class="muted" style="font-weight:400;">(prénom puis nom)</span></label><input id="cl_new" placeholder="ex : Justine Saoudi" onkeydown="if(event.key==='Enter')Clients.create()"></div>
          <button class="btn-cta" onclick="Clients.create()">＋ Créer la fiche</button>`}
        </div>
        ${rowsData.length ? `<div class="table-wrap mt"><table class="pack-tbl"><thead><tr><th class="col-name" style="text-align:left;">${sh('name', 'Client')}</th><th style="text-align:left;">${sh('dogs', 'Chiens')}</th><th class="num">${sh('n', 'Commandes')}</th><th class="num">${sh('ca', 'CA total')}</th><th class="num">${sh('net', 'Bénéfice net')}</th><th class="num">${sh('last', 'Dernière commande')}</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted help" style="font-size:.82rem;">Clique un client pour ouvrir sa fiche (coordonnées, chiens, achats). Le nom choisi à la vente (champ « Client ») rattache automatiquement la commande à la fiche.</p>`
        : '<p class="muted mt">Aucun client pour l&#39;instant. Crée une fiche ci-dessus, ou saisis un nom à la vente (champ « Client »).</p>'}
        ${noName ? `<p class="muted" style="font-size:.85rem;">ℹ️ ${noName} vente(s) sans nom de client ne sont rattachées à aucune fiche.</p>` : ''}
      </div>`);
  }
};
