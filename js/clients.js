/* ═══════════ Clients & chiens (2026-09-30) ═══════════
   Store.state.clients = [{id, name, phone, email, note, dogs:[{id, name, breed, birth, gabarit, chew, meats:{<viande>:'like'|'avoid'},
   allergies, health, food, hair, odor, fat, liked, note, tried:[{id, name, event, verdict:'like'|'avoid'|''}]}]}]
   Le lien avec les ventes se fait par le NOM (sale.customerName, casse/espaces ignorés) : renommer un client met à jour ses ventes.
   Affiché dans Statistiques → 👤 Clients (admin seulement : données personnelles). */
const Clients = {
  _open: {}, _dogOpen: {}, _balOpen: {}, _ord: {}, _q: '', _sort: { k: 'name', dir: 'asc' },
  key(n) { return String(n || '').trim().toLowerCase(); },
  list() { return Store.state.clients || (Store.state.clients = []); },
  find(name) { const k = this.key(name); return k ? this.list().find(c => this.key(c.name) === k) : null; },
  names() {
    const set = new Map();
    this.list().forEach(c => set.set(this.key(c.name), c.name));
    (Store.state.sales || []).forEach(s => { const n = (s.customerName || '').trim(); if (n && !set.has(this.key(n))) set.set(this.key(n), n); });
    return [...set.values()].sort((a, b) => a.localeCompare(b, 'fr'));
  },
  /* Menu de suggestions des champs « client » (remplace le <datalist> du navigateur) : mettre `data-clcombo autocomplete="off"` sur l'<input>.
     Recherche par mots (accents ignorés) sur le nom du client ET le nom de ses chiens. Le choix remplit le champ puis déclenche input + change :
     les onchange / oninput existants des champs font le reste. Le nom tapé librement (nouveau client) reste accepté. */
  _cb: null,
  _cbRows(q, mode) {
    if (mode.startsWith('opt:')) return ((mode === 'opt:lens' ? Accessoires.optLengths(Accessoires._optA) : Accessoires.optChoices()[mode.slice(4)]) || []).filter(x => !q || U.has(x, q)).map(x => ({ show: x, dogs: [] }));   // détails d'accessoire : couleurs / mousquetons / finitions des Matières premières
    if (mode === 'codes') {   // codes des partenaires : on montre la réduction du client, jamais le % reversé au partenaire
      if (this.ro()) return [];
      return Partners.list().flatMap(p => (p.codes || []).filter(c => c.code).map(c => ({ show: c.code, pname: p.name, disc: U.num(c.discPct) })))
        .filter(r => !q || U.has(r.show + ' ' + r.pname, q)).sort((a, b) => U.sortFr(a.show, b.show));
    }
    const dogsOf = n => { const c = this.find(n); return c ? (c.dogs || []).map(d => String(d.name || '').trim()).filter(Boolean) : []; };
    return this.names().map(n => ({ n, show: this.show(n), dogs: dogsOf(n) }))
      .filter(r => !q || U.has(r.show + ' ' + r.dogs.join(' '), q));
  },
  _cbOpen(inp) {
    const cb = this._cb && this._cb.inp === inp ? this._cb : (this.cbClose(), this._cb = { inp, i: -1, rows: [] });
    const mode = inp.dataset.clcombo || '', q = inp.value.trim(); cb.rows = this._cbRows(q, mode).slice(0, 60); cb.i = -1;
    let el = document.getElementById('clCombo');
    if (!el) { el = document.createElement('div'); el.id = 'clCombo'; el.className = 'ac-list'; el.onmousedown = e => e.preventDefault(); document.body.appendChild(el); }
    if (mode.startsWith('opt:')) el.innerHTML = cb.rows.length ? cb.rows.map((r, k) => `<div class="ac-item cb-row" data-k="${k}" onclick="Clients._cbPick(${k})"><span class="cb-n">${U.esc(r.show)}</span></div>`).join('') : `<div class="ac-item muted">${q ? '« ' + U.esc(q) + ' » sera gardé tel quel (saisie libre).' : 'Aucune proposition : tape ce que tu veux.'}</div>`;
    else el.innerHTML = mode === 'codes' ? (cb.rows.length ? cb.rows.map((r, k) => `<div class="ac-item cb-row" data-k="${k}" onclick="Clients._cbPick(${k})"><span class="cb-n">🏷️ ${U.esc(r.show)}${r.disc ? ` <span class="cb-pct">−${U.qty(r.disc)} %</span>` : ''}</span><span class="cb-d">🤝 ${U.esc(r.pname)}</span></div>`).join('') : `<div class="ac-item muted">${q ? 'Aucun code partenaire ne correspond : « ' + U.esc(q) + ' » sera gardé comme simple note (sans réduction automatique).' : 'Aucun code partenaire créé (Statistiques → Partenaires).'}</div>`) : cb.rows.length ? cb.rows.map((r, k) => {
      const dm = q ? r.dogs.filter(d => U.has(d, q)) : [];   // chiens qui correspondent à la recherche : mis en avant
      const dogTxt = r.dogs.map(d => `<span class="${dm.includes(d) ? 'cb-hit' : ''}">🐕 ${U.esc(d)}</span>`).join(' · ');
      return `<div class="ac-item cb-row" data-k="${k}" onclick="Clients._cbPick(${k})"><span class="cb-n">👤 ${U.esc(r.show)}</span>${dogTxt ? `<span class="cb-d">${dogTxt}</span>` : ''}</div>`;
    }).join('') : `<div class="ac-item muted">${q ? 'Aucun client ni chien trouvé : « ' + U.esc(q) + ' » sera créé comme nouveau client.' : 'Aucun client pour l\'instant.'}</div>`;
    this._cbPlace();
  },
  _cbPlace() {
    const cb = this._cb, el = document.getElementById('clCombo'); if (!cb || !el) return;
    if (!cb.inp.isConnected) { this.cbClose(); return; }
    const r = cb.inp.getBoundingClientRect(), w = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
    const below = window.innerHeight - r.bottom, up = below < 200 && r.top > below;
    el.style.cssText = `position:fixed;z-index:400;left:${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px;width:${w}px;min-width:0;max-width:none;right:auto;max-height:${Math.max(120, Math.min(300, (up ? r.top : below) - 12))}px;overflow-y:auto;overscroll-behavior:contain;` + (up ? `bottom:${window.innerHeight - r.top + 4}px;top:auto;` : `top:${r.bottom + 4}px;`);
  },
  cbClose() { const el = document.getElementById('clCombo'); if (el) el.remove(); this._cb = null; },
  _cbHi() {
    const el = document.getElementById('clCombo'), cb = this._cb; if (!el || !cb) return;
    el.querySelectorAll('.cb-row').forEach(x => x.classList.toggle('active', +x.dataset.k === cb.i));
    const a = el.querySelector('.cb-row.active'); if (a) a.scrollIntoView({ block: 'nearest' });
  },
  _cbPick(k) {
    const cb = this._cb; if (!cb || !cb.rows[k]) return;
    const inp = cb.inp; inp.value = cb.rows[k].show;
    inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
    this.cbClose();   // après les événements (l'événement input rouvrirait le menu)
  },
  _cbInit() {
    if (this._cbDone) return; this._cbDone = true;
    const is = e => e.target && e.target.matches && e.target.matches('input[data-clcombo]');
    document.addEventListener('focusin', e => { if (is(e)) this._cbOpen(e.target); else if (this._cb) this.cbClose(); });
    document.addEventListener('input', e => { if (is(e)) this._cbOpen(e.target); });
    document.addEventListener('mousedown', e => { if (this._cb && !e.target.closest('#clCombo') && e.target !== this._cb.inp) this.cbClose(); });   // fermeture par clic extérieur (jamais onblur)
    document.addEventListener('keydown', e => {
      const cb = this._cb; if (!cb || e.target !== cb.inp) return;
      if (e.key === 'Escape') { this.cbClose(); return; }
      if (e.key === 'Tab') { this.cbClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!cb.rows.length) return; cb.i = (cb.i + (e.key === 'ArrowDown' ? 1 : -1) + cb.rows.length) % cb.rows.length; this._cbHi(); }
      else if (e.key === 'Enter' && cb.i >= 0) { e.preventDefault(); this._cbPick(cb.i); }
    });
    window.addEventListener('resize', () => this._cbPlace());
    document.addEventListener('scroll', () => this._cbPlace(), true);
  },
  ro() { return !!App.isViewer || (!!App.visitMode && !App.isTeam); },   // profil visite OU mode « masquer » de l'admin : comme si un visiteur regardait l'écran   // profil visite : lecture seule, prénom uniquement, pas de coordonnées
  split(name) { const t = String(name || '').trim(), i = t.indexOf(' '); return i < 0 ? { first: t, last: '' } : { first: t.slice(0, i), last: t.slice(i + 1).trim() }; },
  show(name) {   // nom affiché : complet, ou prénom seul pour le profil visite
    const n = String(name || '').trim(); if (!n || !this.ro()) return n;
    const c = this.find(n); return c && c.firstName ? c.firstName : this.split(n).first;
  },
  /* Solde / avoir : c.balance > 0 = je lui dois (avoir à déduire de sa prochaine commande) ; < 0 = il me doit. Journal : c.balanceLog. */
  balanceOf(name) { if (this.ro()) return 0; const c = this.find(name); return c ? Math.round(U.num(c.balance) * 100) / 100 : 0; },
  /* Le solde = la somme des lignes du journal (chaque ligne est modifiable / supprimable). */
  _recalc(c) {
    const log = c.balanceLog || [];
    const diff = c.balMig ? 0 : Math.round((U.num(c.balance) - log.reduce((a, l) => a + U.num(l.amount), 0)) * 100) / 100;   // migration unique de l'ancien solde
    c.balMig = true;
    if (diff) log.push({ id: U.uid(), ts: 0, amount: diff, note: 'Solde initial', initial: true });   // ancien solde saisi avant le journal
    log.forEach(l => { if (!l.id) l.id = U.uid(); });
    c.balanceLog = log; c.balance = Math.round(log.reduce((a, l) => a + U.num(l.amount), 0) * 100) / 100;
  },
  adjustBalance(name, delta, note) {
    delta = Math.round(U.num(delta) * 100) / 100; if (!delta) return;
    const c = this.ensure(name); if (!c) return;
    this._recalc(c);
    c.balanceLog.unshift({ id: U.uid(), ts: Date.now(), amount: delta, note: note || '' }); this._recalc(c);
    Store.save('clients');
  },
  addBalEntry(cid) {
    if (this.ro()) return; const c = this.list().find(x => x.id === cid); if (!c) return;
    const a = Math.round(U.num((document.getElementById('cl_ba_' + cid) || {}).value) * 100) / 100;
    if (!a) { U.toast('Tape un montant (positif = je lui dois, négatif = il me doit).', true); return; }
    this.adjustBalance(c.name, a, ((document.getElementById('cl_bn_' + cid) || {}).value || '').trim() || 'Ajout manuel'); Stats.render();
  },
  editBalEntry(cid, eid, field, v) {
    if (this.ro()) return; const c = this.list().find(x => x.id === cid); if (!c) return;
    const l = (c.balanceLog || []).find(x => x.id === eid); if (!l) return;
    if (field === 'amount') l.amount = Math.round(U.num(v) * 100) / 100; else l.note = String(v || '').trim();
    this._recalc(c); Store.save('clients'); Stats.render();
  },
  async delBalEntry(cid, eid) {
    if (this.ro()) return; const c = this.list().find(x => x.id === cid); if (!c) return;
    if (!await U.confirm('Supprimer cette ligne du solde ?', { okLabel: 'Supprimer' })) return;
    c.balanceLog = (c.balanceLog || []).filter(x => x.id !== eid); this._recalc(c); Store.save('clients'); Stats.render();
  },
  _balUI(c) {
    this._recalc(c);
    const b = c.balance, log = c.balanceLog.slice().sort((x, y) => (y.ts || 0) - (x.ts || 0));
    const sum = !b ? 'Solde : 0 €' : b > 0 ? `Avoir : <b>${U.eur(b)}</b> (je lui dois)` : `Dette : <b>${U.eur(-b)}</b> (il me doit)`;
    const col = b > 0 ? 'var(--ok)' : b < 0 ? 'var(--alerte)' : 'var(--card-border)';   // vert = avoir (je lui dois), rouge = dette (il me doit)
    return `<details class="fold mt" ${this._balOpen[c.id] ? 'open' : ''} ontoggle="Clients._balOpen['${c.id}']=this.open" style="border:1px solid ${col};border-left:5px solid ${col};border-radius:10px;${b ? `background:color-mix(in srgb, ${col} 10%, transparent);` : ''}"><summary style="padding:10px 14px;cursor:pointer;display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><b>💶 Solde / avoir</b><span class="muted help">Positif = je lui dois (avoir : déduit automatiquement de sa prochaine commande). Négatif = il me doit (ajouté à sa prochaine commande). Le solde est la somme des lignes ci-dessous : tu peux modifier ou supprimer une ligne.</span><span style="${b ? `color:${col};font-weight:700;` : ''}">${sum}</span></summary>
      <div class="fold-body" style="padding:6px 14px 12px;">
      <div class="frow" style="align-items:flex-end;gap:8px;"><div class="fg" style="max-width:150px;"><label>Montant (€)</label><input id="cl_ba_${c.id}" type="number" step="0.01" placeholder="ex : 1,70 ou -3"></div><div class="fg"><label>Motif</label><input id="cl_bn_${c.id}" placeholder="ex : monnaie rendue en trop le 02/10"></div><button class="btn-cta btn-sm" style="flex:0 0 auto;" onclick="Clients.addBalEntry('${c.id}')">＋ Ajouter</button></div>
      ${log.length ? `<table class="pack-tbl" style="margin-top:8px;"><tbody>${log.map(l => `<tr><td class="muted" style="white-space:nowrap;">${l.ts ? new Date(l.ts).toLocaleDateString('fr-FR') : '—'}</td><td style="width:110px;"><input type="number" step="0.01" value="${U.num(l.amount)}" onchange="Clients.editBalEntry('${c.id}','${l.id}','amount',this.value)"></td><td><input value="${U.esc(l.note || '')}" onchange="Clients.editBalEntry('${c.id}','${l.id}','note',this.value)"></td><td><button class="btn-icon" title="Supprimer cette ligne" onclick="Clients.delBalEntry('${c.id}','${l.id}')">🗑️</button></td></tr>`).join('')}</tbody></table>` : ''}
    </div></details>`;
  },
  /* Réduction HABITUELLE d'un client (partenaire d'élevage…, Antho 2026-10-11) : c.discOn + c.discPct (%) + c.discCode (texte libre). Elle se remplit toute seule dans Paniers et Ventes quand on choisit ce client (modifiable par ticket). */
  /* Code PARTENAIRE de la fiche (2026-10-16) : c.partnerCodeId (choisi dans la fiche) ; sinon, une ancienne réduction habituelle dont le code tapé à la main correspond à un code partenaire suit ce partenaire.
     La réduction vient alors du code (Partners) : modifier le % ou le code du partenaire met à jour toutes les fiches rattachées. Renvoie { p, c } ou null. */
  partnerCodeOf(c) {
    if (!c || typeof Partners === 'undefined') return null;
    if (c.partnerCodeId) { for (const p of Partners.list()) { const x = (p.codes || []).find(k => k.id === c.partnerCodeId); if (x) return { p, c: x }; } return null; }
    return c.discOn && String(c.discCode || '').trim() ? Partners.byCode(c.discCode) : null;
  },
  discountOf(name) {
    const c = this.find(name); if (!c) return null;
    const m = this.partnerCodeOf(c);
    if (m) { const pct = Math.min(99, Math.max(0, U.num(m.c.discPct))); return pct > 0 ? { pct, code: m.c.code, partner: m.p.name } : null; }
    if (!c.discOn) return null;
    const pct = Math.min(99, Math.max(0, U.num(c.discPct)));
    return pct > 0 ? { pct, code: String(c.discCode || '').trim() } : null;
  },
  setPartnerCode(cid, v) {
    if (this.ro()) return;
    const c = this.list().find(x => x.id === cid); if (!c) return;
    c.partnerCodeId = v || '';
    if (!v && typeof Partners !== 'undefined' && Partners.byCode(c.discCode)) c.discCode = '';   // détachement : le code tapé à la main ne doit pas re-rattacher la fiche
    Store.save('clients'); Stats.render();
    if (v) { const d = this.discountOf(c.name); if (d) U.toast(`🤝 Rattaché au code ${d.code} (${d.partner}) : −${U.qty(d.pct)} % pour ce client.`); }
  },
  setDisc(cid, f, v) {
    if (this.ro()) return;
    const c = this.list().find(x => x.id === cid); if (!c) return;
    if (f === 'discOn') c.discOn = !!v;
    else if (f === 'discPct') c.discPct = Math.min(99, Math.max(0, Math.round(U.num(v) * 100) / 100));
    else c.discCode = String(v || '').trim();
    Store.save('clients'); Stats.render();
  },
  discBadge(c) { const d = this.discountOf(c.name); return d ? ` <span class="badge ok" title="Réduction habituelle${d.code ? ' — code ' + U.esc(d.code) : ''}">🏷️ −${U.qty(d.pct)} %</span>` : ''; },
  balBadge(c) { const b = this.balanceOf(c.name); return !b ? '' : b > 0 ? ` <span class="badge info" title="Je lui dois cet avoir">💶 Avoir ${U.eur(b)}</span>` : ` <span class="badge warn" title="Il me doit cette somme">💶 Dette ${U.eur(-b)}</span>`; },
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
    this.list().forEach(c => { const dp = c.dogs.filter(d => d.pets); if (dp.length) { if (!c.pets) c.pets = [...new Set(dp.map(d => d.pets))].join(', '); dp.forEach(d => delete d.pets); added = true; } });
    this.list().forEach(c => { if (c.firstName === undefined) { const p = this.split(c.name); c.firstName = p.first; c.lastName = p.last; added = true; } });
    (Store.state.sales || []).forEach(s => { const n = (s.customerName || '').trim(); if (n && !this.find(n)) { this.list().push(this._new(n)); added = true; } });
    if (added) Store.save('clients');
  },
  _norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); },
  /* Alerte intolérance à la vente : viande cochée ⛔ sur un chien du client, ou mot des « allergies / intolérances » présent dans la viande ou le nom du produit. */
  conflicts(clientName, u) {
    const c = this.find(clientName); if (!c) return [];
    return this.conflictsFor(c.dogs, u);
  },
  conflictsFor(dogs, u) {   // même contrôle, pour une liste de chiens donnée (ex. un seul chien d'un panier « chien par chien »)
    if (!u || u.kind !== 'M') return [];
    const meat = this._norm(u.type), prod = this._norm(u.name), out = [];
    (dogs || []).forEach(d => {
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
  /* Fiche client : clic sur une commande → seuls les produits de CETTE commande sont listés ; re-clic (ou ✕) → tous les achats. */
  pickOrder(cid, sid) { this._ord[cid] = this._ord[cid] === sid ? '' : sid; Stats.render(); },
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
      if (App.isTeam) { U.toast('Seul un administrateur peut renommer un client (ses ventes sont liées à son nom).', true); Stats.render(); return; }
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
    c.dogs.push({ id: U.uid(), name: '', breed: '', birth: '', gabarit: '', chew: '', meats: {}, allergies: '', health: '', food: '', hair: '', odor: '', fat: '', liked: '', note: '' });
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

  /* ---------- Produits déjà mastiqués (par chien) : d.tried = [{id, name, label, event, verdict:'' | 'like' | 'avoid'}] ----------
     Ne touche NI au stock, NI au chiffre d'affaires : simple mémoire de ce que le chien a déjà eu (et aimé ou non).
     Liste de choix = même habillage que « Ajouter un produit » des Paniers (filtre Variantes + recherche + lignes .pp-row). */
  _addEv: {}, _tQ: {}, _tOpen: '', _tVars: [], _tVarsOpen: false,
  _prodRows() {   // une ligne par variante du stock mastication
    const out = [];
    (Store.state.stockM || []).forEach(p => (p.variants || []).forEach(v => out.push({ name: p.name, label: Pricing.labelVariant(v), meat: p.meatType || '', sku: v.sku || '' })));
    return out;
  },
  _tCandidates(did) {
    const q = U.normSearch(this._tQ[did] || '');
    return this._prodRows().filter(c => {
      if (q && !U.has(c.name + ' ' + c.label + ' ' + c.sku, q)) return false;
      return !this._tVars.length || this._tVars.includes(c.label);
    }).sort((a, b) => U.sortFr(a.name + ' ' + a.label, b.name + ' ' + b.label)).slice(0, 100);
  },
  /* Produits (mastication) vendus lors d'un événement, tous clients confondus : proposés d'un clic. */
  _eventProds(ev) {
    const set = new Map();
    (Store.state.sales || []).filter(x => !x.cancelled && x.eventName === ev).forEach(x => (x.items || []).forEach(i => {
      if (i.kind === 'C' || i.kind === 'A' || !i.name) return;
      const k = this.key(i.name) + '|' + this.key(i.label);
      if (!set.has(k)) set.set(k, { name: i.name, label: i.label || '' });
    }));
    return [...set.values()].sort((a, b) => U.sortFr(a.name + ' ' + a.label, b.name + ' ' + b.label));
  },
  _dogOf(cid, did) { const c = this.list().find(x => x.id === cid); return c && c.dogs.find(x => x.id === did); },
  setAddEv(did, v) { this._addEv[did] = v; Stats.render(); },
  setTQ(did, v) { this._tQ[did] = v; this._tOpen = did; Stats.render(); U.refocus('cl_t_' + did); },
  openT(did) { if (this._tOpen === did) return; this._tOpen = did; this._tVarsOpen = false; Stats.render(); U.refocus('cl_t_' + did); },
  closeT() {
    if (!this._tOpen) return;
    if (document.activeElement && /^cl_t_/.test(document.activeElement.id)) return;   // le clic dans le champ arrive après son « focus » : pas un clic extérieur
    this._tOpen = ''; Stats.render();
  },
  toggleTVar(v) { const i = this._tVars.indexOf(v); if (i >= 0) this._tVars.splice(i, 1); else this._tVars.push(v); Stats.render(); },
  setAllTVar(all) { this._tVars = all ? Stock.allVariantGroups().flatMap(g => g.items) : []; Stats.render(); },
  setTVarsOpen(v) { this._tVarsOpen = v; if (v && this._tOpen) { this._tOpen = ''; Stats.render(); } },
  _pushTried(d, name, label, ev) {
    name = String(name || '').trim(); label = String(label || '').trim(); if (!name) return false;
    d.tried = d.tried || [];
    if (d.tried.some(t => this.key(t.name) === this.key(name) && this.key(t.label) === this.key(label) && (t.event || '') === (ev || ''))) { U.toast('Déjà dans la liste.', true); return false; }
    d.tried.push({ id: U.uid(), name, label, event: ev || '', verdict: '' });
    return true;
  },
  pickTried(cid, did, idx) {
    if (this.ro()) return;
    const d = this._dogOf(cid, did), c = this._tCandidates(did)[idx]; if (!d || !c) return;
    if (this._pushTried(d, c.name, c.label, this._addEv[did] || '')) { this._tQ[did] = ''; this._tOpen = ''; Store.save('clients'); Stats.render(); }
  },
  addTriedFree(cid, did) {   // texte libre + Entrée (produit absent de la liste)
    if (this.ro()) return;
    const d = this._dogOf(cid, did); if (!d) return;
    const v = (this._tQ[did] || '').trim(); if (!v) return;
    if (this._pushTried(d, v, '', this._addEv[did] || '')) { this._tQ[did] = ''; this._tOpen = ''; Store.save('clients'); Stats.render(); }
  },
  addTriedFromEvent(cid, did, idx) {
    if (this.ro()) return;
    const d = this._dogOf(cid, did), p = this._eventProds(this._addEv[did] || '')[idx]; if (!d || !p) return;
    if (this._pushTried(d, p.name, p.label, this._addEv[did] || '')) { Store.save('clients'); Stats.render(); }
  },
  /* Clic = neutre → aimé (vert) → pas aimé (rouge) → neutre */
  cycleTried(cid, did, tid) {
    if (this.ro()) return;
    const d = this._dogOf(cid, did), t = d && (d.tried || []).find(x => x.id === tid); if (!t) return;
    t.verdict = !t.verdict ? 'like' : t.verdict === 'like' ? 'avoid' : '';
    Store.save('clients'); Stats.render();
  },
  delTried(cid, did, tid) {
    if (this.ro()) return;
    const d = this._dogOf(cid, did); if (!d) return;
    d.tried = (d.tried || []).filter(x => x.id !== tid); Store.save('clients'); Stats.render();
  },
  _triedUI(c, d) {
    const ro = this.ro(), tried = d.tried || [], ev = this._addEv[d.id] || '';
    const chips = tried.map(t => `<span class="cl-chip ${t.verdict || ''}" title="${ro ? '' : 'Clique : aimé (vert) → pas aimé (rouge) → neutre'}" ${ro ? '' : `onclick="Clients.cycleTried('${c.id}','${d.id}','${t.id}')"`}>${t.verdict === 'like' ? '✓ ' : t.verdict === 'avoid' ? '✗ ' : ''}${U.esc(t.name)}${t.label ? ` <span class="muted" style="font-size:.78rem;">${U.esc(t.label)}</span>` : ''}${t.event ? ` <span class="muted" style="font-size:.75rem;">🎪 ${U.esc(t.event)}</span>` : ''}${ro ? '' : ` <b title="Retirer" style="margin-left:4px;opacity:.7;" onclick="event.stopPropagation();Clients.delTried('${c.id}','${d.id}','${t.id}')">✕</b>`}</span>`).join('');
    const all = ev ? this._eventProds(ev) : [];
    const sold = all.filter(p => !tried.some(t => this.key(t.name) === this.key(p.name) && this.key(t.label) === this.key(p.label) && (t.event || '') === ev));
    const events = Store.eventList();
    const list = this._tOpen === d.id ? this._tCandidates(d.id) : [];
    const rows = list.map((p, i) => `<div class="ac-item pp-row" onmousedown="event.preventDefault();Clients.pickTried('${c.id}','${d.id}',${i})"><span class="pp-a">${U.esc(p.name)} <span class="pp-v">${U.esc(p.label)}</span></span><span class="pp-b">${U.esc(p.meat)}</span><span class="pp-c"></span></div>`).join('');
    return `<div class="fg mt"><label>🍖 Produits déjà mastiqués <span class="muted" style="font-weight:400;">(clique une pastille : vert = a aimé · rouge = n'a pas aimé)</span></label>
      <div class="cl-chips">${chips || '<span class="muted">Aucun produit noté.</span>'}</div>
      ${ro ? '' : `<div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-top:12px;">
        <div class="fg mb0" style="min-width:160px;max-width:220px;"><label>Variantes</label>
          ${U.multiSelect({ groups: Stock.allVariantGroups(), selected: this._tVars, toggle: 'Clients.toggleTVar', setAll: 'Clients.setAllTVar', open: this._tVarsOpen, onOpen: 'Clients.setTVarsOpen' })}</div>
        <div class="fg mb0" style="flex:2;min-width:200px;"><label>➕ Ajouter un produit</label>
          <div class="autocomplete" data-onclose="Clients.closeT">
            <input id="cl_t_${d.id}" type="text" autocomplete="off" placeholder="Chercher un produit… (Entrée = texte libre)" value="${U.esc(this._tQ[d.id] || '')}" oninput="Clients.setTQ('${d.id}',this.value)" onfocus="Clients.openT('${d.id}')" onkeydown="if(event.key==='Enter'){event.preventDefault();Clients.addTriedFree('${c.id}','${d.id}')}">
            ${rows ? `<div class="ac-list" style="max-height:250px;overflow:auto;">${rows}</div>` : ''}
          </div></div>
        <div class="fg mb0" style="flex:1;min-width:180px;"><label>🎪 Événement (facultatif)</label>
          <select onchange="Clients.setAddEv('${d.id}',this.value)"><option value="">— aucun —</option>${events.map(e => `<option value="${U.esc(e)}" ${e === ev ? 'selected' : ''}>${U.esc(e)}</option>`).join('')}</select></div>
      </div>
      ${ev ? `<div class="muted" style="font-size:.82rem;margin-top:8px;">Vendus à « ${U.esc(ev)} » (clique pour ajouter) :</div><div class="cl-chips" style="margin-top:4px;">${sold.map(p => `<span class="cl-chip" onclick="Clients.addTriedFromEvent('${c.id}','${d.id}',${all.indexOf(p)})">＋ ${U.esc(p.name)}${p.label ? ` <span class="muted" style="font-size:.78rem;">${U.esc(p.label)}</span>` : ''}</span>`).join('') || '<span class="muted">Tout est déjà ajouté (ou aucune vente enregistrée pour cet événement).</span>'}</div>` : ''}`}
    </div>`;
  },

  /* ---------- rendu ---------- */
  _sel(cid, did, f, v, opts) {
    return `<select ${this.ro() ? 'disabled' : ''} onchange="Clients.setDog('${cid}','${did}','${f}',this.value)">${opts.map(o => `<option value="${o[0]}" ${String(v || '') === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
  },
  _dogCard(c, d) {
    const meats = (Store.state.settings.meatTypes || []).slice().sort(U.sortFr);
    const ro = this.ro() ? 'disabled' : '';
    const inp = (f, lbl, ph) => ['allergies', 'health', 'food', 'liked', 'note'].includes(f)
      ? `<div class="fg"><label>${lbl}</label><textarea class="note-area" rows="1" ${ro} placeholder="${ph || ''}" onchange="Clients.setDog('${c.id}','${d.id}','${f}',this.value)">${U.esc(d[f] || '')}</textarea></div>`
      : `<div class="fg"><label>${lbl}</label><input ${ro} value="${U.esc(d[f] || '')}" placeholder="${ph || ''}" onchange="Clients.setDog('${c.id}','${d.id}','${f}',this.value)"></div>`;
    const yn = [['', '— ?'], ['ok', 'Oui, aucun souci'], ['non', 'Non, ça le dérange']];
    const chips = meats.map(m => { const st = (d.meats || {})[m]; return `<span class="cl-chip ${st || ''}" title="Clique : aime ❤ → évite ⛔ → neutre" onclick="Clients.cycleMeat('${c.id}','${d.id}','${U.esc(m).replace(/'/g, '&#39;')}')">${st === 'like' ? '❤ ' : st === 'avoid' ? '⛔ ' : ''}${U.esc(m)}</span>`; }).join('');
    const age = this.ageTxt(d.birth);
    const sub = [age, d.sensitive ? '🌿 sensible' : '', d.allergies ? '⚠️ ' + U.esc(d.allergies) : ''].filter(Boolean).join(' · ');
    return `<details class="cl-dog fold" ${this._dogOpen[d.id] ? 'open' : ''} ontoggle="Clients._dogOpen['${d.id}']=this.open"><summary class="cl-dog-h"><b>🐕 ${U.esc(d.name || 'Nouveau chien')}</b>${sub ? ` <span class="muted">· ${sub}</span>` : ''}</summary>
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
        <div class="fg"><label>🌿 Chien sensible</label><label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;" title="Peau / digestion fragiles : à la création d'un panier, « Hypoallergénique uniquement » est coché pour sa cliente (tu peux le décocher)."><input type="checkbox" ${ro} ${d.sensitive ? 'checked' : ''} onchange="Clients.setDog('${c.id}','${d.id}','sensitive',this.checked)"> Privilégier l'hypoallergénique</label></div>
      </div>
      <div class="fg mt"><label>Viandes <span class="muted" style="font-weight:400;">(clique : ❤ aime · ⛔ évite / n'aime pas)</span></label><div class="cl-chips">${chips}</div></div>
      <div class="grid c2 mt">
        ${inp('allergies', '⚠️ Allergies / intolérances', 'ex : poulet, céréales')}${inp('health', 'Maladie / santé', 'ex : pancréatite')}
        ${inp('food', 'Croquettes / alimentation', 'marque, ration…')}${d.liked ? inp('liked', 'Ancien texte « produits préférés »', '') : ''}
      </div>
      ${this._triedUI(c, d)}
      ${inp('note', 'Note', 'autre chose à retenir')}
      </div></details>`;
  },
  _fiche(c, a) {
    const inp = (f, lbl, ph, type) => f === 'note' ? `<div class="fg"><label>${lbl}</label><textarea class="note-area" rows="1" placeholder="${ph || ''}" onchange="Clients.setField('${c.id}','${f}',this.value)">${U.esc(c[f] || '')}</textarea></div>` : `<div class="fg"><label>${lbl}</label><input ${type ? `type="${type}"` : ''} value="${U.esc(c[f] || '')}" placeholder="${ph || ''}" onchange="Clients.setField('${c.id}','${f}',this.value)"></div>`;
    const orders = a ? a.sales.slice().sort((x, y) => y.ts - x.ts) : [];
    const selSale = orders.find(s => s.id === this._ord[c.id]) || null;   // commande choisie (sinon : tous les achats)
    let prods = a ? Object.entries(a.prods).sort((x, y) => y[1].qty - x[1].qty) : [];
    if (selSale) {
      const pm = {};
      (selSale.items || []).filter(i => i.kind !== 'C').forEach(i => { const pk = i.name + (i.label ? ' ' + i.label : ''); const p = pm[pk] || (pm[pk] = { qty: 0, last: selSale.ts }); p.qty += U.num(i.qty); });
      prods = Object.entries(pm).sort((x, y) => y[1].qty - x[1].qty);
    }
    const pm = this.partnerCodeOf(c);
    const pcs = (typeof Partners !== 'undefined' ? Partners.list() : []).flatMap(p => (p.codes || []).filter(k => k.code).map(k => ({ id: k.id, label: `${k.code} · ${p.name}${U.num(k.discPct) ? ' (−' + U.qty(k.discPct) + ' %)' : ''}` })));
    return `<tr class="cl-fiche" id="clf_${c.id}"><td colspan="6"><div class="cl-body">
      ${this.ro() ? '' : `<div class="cl-id">${inp('firstName', 'Prénom', '')}${inp('lastName', 'Nom', '')}${inp('phone', 'Téléphone', '', 'tel')}${inp('email', 'Email', '', 'email')}${inp('note', 'Note', 'ex : rencontré au marché de…')}</div>
      <div class="cl-id mt">
        <div class="fg"><label>Commandes en ligne (stock général)</label><select onchange="Clients.setField('${c.id}','delivery',this.value)">${[['', '— ?'], ['clickcollect', '🏬 Click & Collect'], ['livraison', '📦 Livraison']].map(o => `<option value="${o[0]}" ${(c.delivery || '') === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>
        ${c.delivery === 'livraison' ? `<div class="fg" style="grid-column:span 2;"><label>Point Mondial Relay habituel</label><input value="${U.esc(c.relay || '')}" placeholder="nom du relais, ville, n° du point…" onchange="Clients.setField('${c.id}','relay',this.value)"></div>` : ''}
      </div>
      <div class="cl-id mt"><div class="fg" style="grid-column:span 3;">
        ${pcs.length ? `<label>🤝 Code partenaire ${U.info("La réduction de ce client vient du code du partenaire : si tu modifies le % ou le code dans Statistiques → Partenaires, cette fiche suit toute seule. « Aucun » = réduction manuelle ci-dessous.")}</label><select style="max-width:380px;" onchange="Clients.setPartnerCode('${c.id}',this.value)"><option value="">— aucun (réduction manuelle) —</option>${pcs.map(o => `<option value="${o.id}" ${pm && pm.c.id === o.id ? 'selected' : ''}>${U.esc(o.label)}</option>`).join('')}</select>${pm ? `<div class="muted" style="font-size:.82rem;margin-top:4px;">🏷️ −${U.qty(U.num(pm.c.discPct))} % avec le code <b>${U.esc(pm.c.code)}</b> (${U.esc(pm.p.name)}), appliqué tout seul dans Paniers et Ventes.</div>` : ''}` : ''}
        ${pm ? '' : `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-top:8px;"><input type="checkbox" ${c.discOn ? 'checked' : ''} onchange="Clients.setDisc('${c.id}','discOn',this.checked)"> 🏷️ Réduction habituelle (partenaire d'élevage, code personnel…)</label>
        ${c.discOn ? `<div class="frow" style="align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;"><input type="number" step="0.5" min="0" max="99" value="${c.discPct || ''}" placeholder="0" style="width:90px;" onchange="Clients.setDisc('${c.id}','discPct',this.value)"> <span>%</span><input type="text" value="${U.esc(c.discCode || '')}" placeholder="code (ex : ELEVAGE10)" style="width:190px;" onchange="Clients.setDisc('${c.id}','discCode',this.value)"><span class="muted help">Se remplit tout seul dans Paniers et Ventes quand tu choisis ce client ; tu peux la changer ou la retirer sur un ticket.</span></div>` : ''}`}
      </div></div>`}
      ${this.ro() ? '' : this._balUI(c)}
      <div class="cl-id mt"><div class="fg" style="grid-column:span 2;"><label>🏠 Autres animaux dans le foyer</label><textarea class="note-area" rows="1" ${this.ro() ? 'disabled' : ''} placeholder="ex : un chat, un lapin — vide = les chiens vivent seuls" onchange="Clients.setField('${c.id}','pets',this.value)">${U.esc(c.pets || '')}</textarea></div></div>
      <h3 class="mt">🐕 Chiens (${c.dogs.length})</h3>
      ${c.dogs.map(d => this._dogCard(c, d)).join('') || '<p class="muted">Aucun chien renseigné.</p>'}
      ${this.ro() ? '' : `<button class="btn-cta btn-sm" onclick="Clients.addDog('${c.id}')">＋ Ajouter un chien</button>`}
      <h3 class="mt">🛒 Achats</h3>
      ${a ? `<div class="cl-cols">
        <div><div class="muted" style="font-size:.82rem;margin-bottom:4px;">${selSale ? `Produits de la commande du <b>${new Date(selSale.ts).toLocaleDateString('fr-FR')}</b> <button class="btn-ghost btn-sm fit" onclick="Clients.pickOrder('${c.id}','${selSale.id}')" title="Revenir à tous les achats">✕ Tout afficher</button>` : 'Produits achetés (quantité totale)'}</div><table class="pack-tbl"><tbody>${prods.map(([n, p]) => `<tr><td class="col-name" style="text-align:left;">${U.esc(n)}</td><td class="num">×${p.qty}</td><td class="num muted">${new Date(p.last).toLocaleDateString('fr-FR')}</td></tr>`).join('')}</tbody></table></div>
        <div><div class="muted" style="font-size:.82rem;margin-bottom:4px;">Commandes <span class="muted">· clique une date</span></div><table class="pack-tbl cl-ord-tbl"><tbody>${orders.map(s => `<tr class="cl-ord ${selSale && selSale.id === s.id ? 'sel' : ''}" onclick="Clients.pickOrder('${c.id}','${s.id}')"><td class="col-name" style="text-align:left;">${new Date(s.ts).toLocaleDateString('fr-FR')}${s.eventName ? ' · 🎪 ' + U.esc(s.eventName) : ''}</td><td class="num sensitive">${U.eur(s.total)}</td></tr>`).join('')}</tbody></table></div>
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
      .filter(x => !q || U.has(this.show(x.c.name), q) || x.c.dogs.some(d => U.has(d.name || '', q)))
      .sort((x, y) => so.k === 'name' ? dir * U.sortFr(this.show(x.c.name), this.show(y.c.name)) : so.k === 'dogs' ? dir * (x.c.dogs.length - y.c.dogs.length) : dir * (x.a[so.k] - y.a[so.k]));
    const sh = (k, l) => `<span class="sortable ${so.k === k ? 'active' : ''}" onclick="Clients.setSort('${k}')">${l} ${so.k === k ? (so.dir === 'asc' ? '▲' : '▼') : '⇕'}</span>`;
    const rows = rowsData.map(({ c, a }) => {
      const open = !!this._open[c.id];
      return `<tr style="cursor:pointer;" onclick="Clients.toggle('${c.id}')"><td class="col-name" style="text-align:left;"><b>${open ? '▾' : '▸'} 👤 ${U.esc(this.show(c.name))}</b>${this.balBadge(c)}${this.discBadge(c)}</td><td style="text-align:left;">${c.dogs.length ? c.dogs.map(d => '🐕 ' + U.esc(d.name || '?')).join(' · ') : '<span class="muted">—</span>'}</td><td class="num">${a.n}</td><td class="num sensitive">${U.eur(a.ca)}</td><td class="num sensitive ${a.net >= 0 ? 'pos' : 'neg'}">${a.n ? U.eur(a.net) : '—'}</td><td class="num">${a.last ? new Date(a.last).toLocaleDateString('fr-FR') : '—'}</td></tr>${open ? this._fiche(c, a.n ? a : null) : ''}`;
    }).join('');
    App.mount(`
      <div class="view-title"><h1>Statistiques</h1><span class="sub">clients &amp; chiens</span></div>
      ${Stats.tabBar()}
      <div class="card cl-card">
        <h2>👤 Mes clients</h2>
        <div class="frow" style="gap:10px;align-items:flex-end;flex-wrap:wrap;">
          <div class="fg" style="max-width:280px;"><label>Rechercher (client ou chien)</label><input id="cl_q" value="${U.esc(this._q)}" placeholder="nom…" oninput="Clients.setQ(this.value)"></div>
          ${this.ro() ? '' : `<div class="fg" style="max-width:280px;"><label>Nouveau client <span class="muted" style="font-weight:400;">(prénom puis nom)</span></label><input id="cl_new" placeholder="ex : Jean Dupont" onkeydown="if(event.key==='Enter')Clients.create()"></div>
          <button class="btn-cta" onclick="Clients.create()">＋ Créer la fiche</button>`}
        </div>
        ${rowsData.length ? `<div class="table-wrap mt"><table class="pack-tbl"><thead><tr><th class="col-name" style="text-align:left;">${sh('name', 'Client')}</th><th style="text-align:left;">${sh('dogs', 'Chiens')}</th><th class="num">${sh('n', 'Commandes')}</th><th class="num">${sh('ca', 'CA total')}</th><th class="num">${sh('net', 'Bénéfice net')}</th><th class="num">${sh('last', 'Dernière commande')}</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted help" style="font-size:.82rem;">Clique un client pour ouvrir sa fiche (coordonnées, chiens, achats). Le nom choisi à la vente (champ « Client ») rattache automatiquement la commande à la fiche.</p>`
        : '<p class="muted mt">Aucun client pour l&#39;instant. Crée une fiche ci-dessus, ou saisis un nom à la vente (champ « Client »).</p>'}
        ${noName ? `<p class="muted" style="font-size:.85rem;">ℹ️ ${noName} vente(s) sans nom de client ne sont rattachées à aucune fiche.</p>` : ''}
      </div>`);
  }
};
Clients._cbInit();
