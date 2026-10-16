/* ═══════════ Partenaires & codes de réduction (Antho 2026-10-16) ═══════════
   settings.partners = [{ id, name, codes: [{ id, code, discPct, affPct }], paid: { 'AAAA-MM': { amount, ts } } }]
   - discPct : réduction accordée au client qui utilise le code (se remplit toute seule à la vente / dans Paniers) ;
   - affPct  : % reversé au partenaire sur la commande = articles APRÈS réduction, livraison exclue (0 = code sans affiliation) ;
   - paid    : reversements pointés « fait » par mois.
   Lien vente ↔ partenaire : par le code saisi (sale.discountCode, avec une réduction > 0). À la validation (et à la correction du code) le lien est
   FIGÉ sur la vente (partnerId / partnerName / partnerCode / partnerPct) : changer le % d'un partenaire ne touche pas les ventes passées.
   Les ventes plus anciennes (code saisi mais pas figé) suivent la fiche actuelle du partenaire.
   Le reversement est une charge : il baisse le bénéfice net (Pricing.partnerCost) mais PAS les cotisations URSSAF (calculées sur le CA). */
const Partners = {
  _month: '',
  list() { const S = Store.state.settings; return Array.isArray(S.partners) ? S.partners : (S.partners = []); },
  _ck(c) { return U.normSearch(String(c || '')).replace(/\s+/g, ''); },   // code comparé sans casse, accents ni espaces
  byCode(code) {
    const k = this._ck(code); if (!k) return null;
    for (const p of this.list()) { const c = (p.codes || []).find(x => this._ck(x.code) === k); if (c) return { p, c }; }
    return null;
  },
  /* Partenaire rattaché à une vente (ou null) : { id, name, code, pct } — pct = % d'affiliation (0 = code sans affiliation). */
  link(s) {
    if (!s || !U.num(s.discountPct)) return null;
    if (s.partnerId) { const p = this.list().find(x => x.id === s.partnerId); return { id: s.partnerId, name: p ? p.name : (s.partnerName || '?'), code: s.partnerCode || s.discountCode || '', pct: U.num(s.partnerPct) }; }
    const m = this.byCode(s.discountCode);
    return m ? { id: m.p.id, name: m.p.name, code: m.c.code, pct: U.num(m.c.affPct) } : null;
  },
  /* Base du reversement : articles de la vente après réduction (les consommables et la livraison n'en font pas partie). */
  base(s) { return (s.items || []).reduce((a, i) => a + (i.kind === 'C' ? 0 : U.num(i.price) * U.num(i.qty)), 0); },
  cost(s) {
    if (!s || s.cancelled) return 0;
    const l = this.link(s); if (!l || !(l.pct > 0)) return 0;
    return Math.round(this.base(s) * l.pct) / 100;
  },
  /* Fige le lien sur la vente d'après son code actuel (à appeler à la validation et quand le code change). */
  stamp(s) {
    ['partnerId', 'partnerName', 'partnerCode', 'partnerPct'].forEach(k => delete s[k]);
    const m = U.num(s.discountPct) > 0 ? this.byCode(s.discountCode) : null;
    if (m) { s.partnerId = m.p.id; s.partnerName = m.p.name; s.partnerCode = m.c.code; s.partnerPct = U.num(m.c.affPct); }
  },
  active() { return this.list().length > 0; },   // colonnes « Reversements » des tableaux : seulement si des partenaires existent

  /* ---------- gestion ---------- */
  _save() { Store.save('settings'); },
  _rerender() { if (Stats.tab === 'partners') Stats.render(); },
  addPartner() {
    const i = document.getElementById('pt_new'), name = ((i || {}).value || '').trim();
    if (!name) { U.toast('Indique le nom du partenaire.', true); return; }
    this.list().push({ id: U.uid(), name, codes: [{ id: U.uid(), code: '', discPct: 5, affPct: 0 }], paid: {} });
    this._save(); this._rerender();
  },
  setName(pid, v) { const p = this.list().find(x => x.id === pid); if (!p) return; v = String(v || '').trim(); if (!v) { this._rerender(); return; } p.name = v; this._save(); this._rerender(); },
  async delPartner(pid) {
    const p = this.list().find(x => x.id === pid); if (!p) return;
    if (!await U.confirm(`Supprimer le partenaire « ${p.name} » et ses codes ?\n\nLes ventes déjà faites gardent leur lien (nom et % figés) ; seuls les nouveaux codes ne seront plus reconnus. Les reversements pointés sont perdus.`, { danger: true, okLabel: 'Supprimer' })) return;
    Store.state.settings.partners = this.list().filter(x => x.id !== pid); this._save(); this._rerender();
  },
  addCode(pid) { const p = this.list().find(x => x.id === pid); if (!p) return; (p.codes = p.codes || []).push({ id: U.uid(), code: '', discPct: 5, affPct: 0 }); this._save(); this._rerender(); },
  setCode(pid, cid, f, v) {
    const p = this.list().find(x => x.id === pid), c = p && (p.codes || []).find(x => x.id === cid); if (!c) return;
    if (f === 'code') {
      v = String(v || '').trim();
      const dup = v && this.byCode(v);
      if (dup && dup.c.id !== cid) { U.toast(`Le code « ${v} » existe déjà (${dup.p.name}).`, true); this._rerender(); return; }
      c.code = v;
    } else c[f] = Math.min(100, Math.max(0, Math.round(U.num(v) * 100) / 100));
    this._save(); this._rerender();
  },
  async delCode(pid, cid) {
    const p = this.list().find(x => x.id === pid), c = p && (p.codes || []).find(x => x.id === cid); if (!c) return;
    if (!await U.confirm(`Supprimer le code « ${c.code || '(vide)'} » ?`, { okLabel: 'Supprimer' })) return;
    p.codes = p.codes.filter(x => x.id !== cid); this._save(); this._rerender();
  },
  async togglePaid(pid, month) {
    const p = this.list().find(x => x.id === pid); if (!p) return;
    p.paid = p.paid || {};
    const due = this._index().get(pid + '|' + month);
    const cur = p.paid[month], amt = due ? Math.round(due.due * 100) / 100 : 0;
    if (cur && Math.abs(U.num(cur.amount) - amt) < 0.005) {   // déjà soldé : un clic = annuler (et retirer l'avoir de la fiche client s'il y en a un)
      if (U.num(cur.avoirAmt) > 0 && !await this._undoAvoir(p, cur, month)) return;
      delete p.paid[month]; U.toast('Reversement décoché.');
    } else { p.paid[month] = { ...(cur || {}), amount: amt, ts: Date.now() }; U.toast(`✔ ${U.eur(amt)} pointé comme reversé à ${p.name}.`); }
    this._save(); this._rerender();
  },
  /* Partenaire aussi client : le reversement du mois passe en AVOIR sur sa fiche (déduit tout seul de sa prochaine commande). */
  _client(p) { return p && p.clientId ? Clients.list().find(x => x.id === p.clientId) || null : null; },
  setClient(pid, name) {
    const p = this.list().find(x => x.id === pid); if (!p) return;
    name = String(name || '').trim();
    if (!name) { delete p.clientId; this._save(); this._rerender(); return; }
    Clients._sync();
    const c = Clients.find(name);
    if (!c) { U.toast('Client introuvable : choisis-le dans la liste (ou crée sa fiche dans Statistiques → Clients).', true); this._rerender(); return; }
    p.clientId = c.id; this._save(); this._rerender(); U.toast(`👤 ${p.name} est relié à la fiche de ${c.name}.`);
  },
  passAvoir(pid, month) {
    const p = this.list().find(x => x.id === pid), c = this._client(p); if (!p) return;
    if (!c) { U.toast('Relie d\'abord ce partenaire à sa fiche client (bloc « Mes partenaires »).', true); return; }
    const e = this._index().get(pid + '|' + month), cur = (p.paid || {})[month];
    const delta = Math.round(((e ? e.due : 0) - U.num(cur && cur.amount)) * 100) / 100;
    if (!(delta > 0.005)) { U.toast('Rien à ajouter : ce mois est déjà soldé.', true); return; }
    Clients.adjustBalance(c.name, delta, `Reversement partenaire · ${p.name} · ${Compta.monthLabel(month)}`);
    const id = c.balanceLog[0].id;
    p.paid = p.paid || {};
    p.paid[month] = { ...(cur || {}), amount: Math.round(((e ? e.due : 0)) * 100) / 100, ts: Date.now(), clientId: c.id, avoirIds: [...((cur && cur.avoirIds) || []), id], avoirAmt: Math.round((U.num(cur && cur.avoirAmt) + delta) * 100) / 100 };
    this._save(); this._rerender();
    U.toast(`💶 ${U.eur(delta)} d'avoir ajouté sur la fiche de ${c.name}.`);
  },
  async _undoAvoir(p, cur, month) {
    const c = Clients.list().find(x => x.id === cur.clientId);
    if (c && !await U.confirm(`Retirer aussi l'avoir de ${U.eur(cur.avoirAmt)} de la fiche de ${c.name} ?\n\nS'il a déjà été déduit d'une commande, son solde passera en dette du même montant.`, { okLabel: 'Décocher et retirer l\'avoir' })) return false;
    if (c) { const ids = new Set(cur.avoirIds || []); c.balanceLog = (c.balanceLog || []).filter(l => !ids.has(l.id)); Clients._recalc(c); Store.save('clients'); }
    return true;
  },
  setMonth(m) { this._month = m; Stats.render(); },
  _chartP: '',   // partenaire affiché dans la courbe ('' = tous)
  setChartP(v) { this._chartP = v; Stats.render(); },
  /* Courbe des 12 derniers mois : commandes avec un code (axe de droite) et montant reversé (axe de gauche). Existe dès le départ, même à zéro. */
  _draw() {
    const cv = document.getElementById('partnersChart'); if (!cv || typeof Chart === 'undefined') return;
    if (Stats._charts.partners) { Stats._charts.partners.destroy(); delete Stats._charts.partners; }
    const now = new Date(), keys = [];
    for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); keys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
    const n = {}, due = {}; keys.forEach(k => { n[k] = 0; due[k] = 0; });
    this._index().forEach(e => { if (this._chartP && e.pid !== this._chartP) return; if (e.month in n) { n[e.month] += e.sales.length; due[e.month] += e.due; } });
    const dark = Theme.get() === 'dark', tc = dark ? '#eee3d3' : '#1c2b33', C = U.CHART_COLORS;
    const ds = (label, data, color, yAxisID, extra) => ({ label, data, yAxisID, borderColor: color, backgroundColor: color, pointBackgroundColor: color, borderWidth: 3, pointRadius: 4, pointHoverRadius: 7, tension: .3, ...extra });
    Stats._charts.partners = new Chart(cv, {
      type: 'line',
      data: { labels: keys.map(k => Compta.monthLabel(k)), datasets: [ds('Montant reversé (€)', keys.map(k => Math.round(due[k] * 100) / 100), C[0], 'y'), ds('Commandes avec un code', keys.map(k => n[k]), C[4], 'y1', { borderDash: [6, 4] })] },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { color: tc, usePointStyle: true, pointStyle: 'circle', boxWidth: 15, boxHeight: 15, padding: 18, font: { family: 'Quicksand', size: 14, weight: '700' } } }, tooltip: { callbacks: { label: c => c.datasetIndex === 0 ? ' Reversé : ' + U.eur(c.parsed.y) : ' ' + c.parsed.y + ' commande' + (c.parsed.y > 1 ? 's' : '') + ' avec un code' } } },
        scales: { y: { beginAtZero: true, suggestedMax: 5, position: 'left', ticks: { color: tc, callback: v => v + ' €' } }, y1: { beginAtZero: true, suggestedMax: 5, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: tc, precision: 0, stepSize: 1 } }, x: { ticks: { color: tc, maxRotation: 60, font: { size: 11 } } } }
      }
    });
  },
  _code: '',   // filtre par code (toutes les listes) : '' = tous
  setCodeF(v) { this._code = v; Stats.render(); },
  /* Clic sur une commande → fiche du client (Stats → Clients), commande sélectionnée */
  goSale(id) {
    const s = (Store.state.sales || []).find(x => x.id === id); if (!s) return;
    const c = Clients.find(s.customerName);
    if (!c) { U.toast('Cette commande n\'a pas de client enregistré : rien à ouvrir.', true); return; }
    Clients._open[c.id] = true; Clients._ord[c.id] = s.id; Clients._q = '';
    Stats.setTab('clients');
    setTimeout(() => { const f = document.querySelector('#clf_' + c.id + ' .cl-cols') || document.getElementById('clf_' + c.id); if (f) f.scrollIntoView({ block: 'center' }); }, 80);
  },

  /* ---------- calculs : index « partenaire|mois » → { p, month, sales:[{s, base, amt, code}], due, uses } ---------- */
  _index() {
    const idx = new Map();
    (Store.state.sales || []).forEach(s => {
      if (s.cancelled) return;
      const l = this.link(s); if (!l) return;
      const mk = Compta.mk(s.ts), key = l.id + '|' + mk;
      const e = idx.get(key) || { pid: l.id, name: l.name, month: mk, sales: [], due: 0, base: 0 };
      const amt = this.cost(s), b = this.base(s);
      e.sales.push({ s, base: b, amt, code: l.code, pct: l.pct }); e.due += amt; e.base += b;
      idx.set(key, e);
    });
    return idx;
  },
  _rest(e) { const p = this.list().find(x => x.id === e.pid), paid = p && p.paid && p.paid[e.month] ? U.num(p.paid[e.month].amount) : 0; return { paid, rest: Math.round((e.due - paid) * 100) / 100, done: !!(p && p.paid && p.paid[e.month]) }; },

  /* ---------- rendu (Statistiques → 🤝 Partenaires) ---------- */
  _codeRow(p, c) {
    const f = (lbl, inner, w) => `<div class="fg" style="margin:0;flex:0 0 ${w}px;"><label style="white-space:nowrap;">${lbl}</label>${inner}</div>`;
    return `<div class="pt-code">
      ${f('Code', `<input value="${U.esc(c.code || '')}" placeholder="ex : ELEVAGE5" style="text-transform:uppercase;" onchange="Partners.setCode('${p.id}','${c.id}','code',this.value)">`, 170)}
      ${f('Réduction client %', `<input type="number" step="0.5" min="0" max="100" value="${c.discPct || ''}" placeholder="0" onchange="Partners.setCode('${p.id}','${c.id}','discPct',this.value)">`, 130)}
      ${f('Reversé au partenaire %', `<input type="number" step="0.5" min="0" max="100" value="${c.affPct || ''}" placeholder="0 = aucun" onchange="Partners.setCode('${p.id}','${c.id}','affPct',this.value)">`, 150)}
      <button class="btn-icon pt-del" title="Supprimer ce code" onclick="Partners.delCode('${p.id}','${c.id}')">🗑️</button>
      <div class="muted pt-cl">${(cl => cl.length ? '👥 Clients rattachés : ' + cl.slice(0, 8).map(x => U.esc(Clients.show(x.name))).join(', ') + (cl.length > 8 ? ' … (+' + (cl.length - 8) + ')' : '') : '👥 Aucun client rattaché (choisis ce code dans la fiche du client)')(Clients.list().filter(x => { const m = Clients.partnerCodeOf(x); return m && m.c.id === c.id; }))}</div>
    </div>`;
  },
  _partnerCard(p) {
    return `<div class="pt-card"><div class="frow" style="align-items:flex-end;gap:10px;margin-bottom:8px;">
        <div class="fg" style="margin:0;max-width:300px;"><label>🤝 Partenaire</label><input value="${U.esc(p.name)}" onchange="Partners.setName('${p.id}',this.value)"></div>
        <div class="fg" style="margin:0;max-width:300px;"><label title="Si ce partenaire est aussi un de tes clients : le reversement du mois pourra passer en avoir sur sa fiche">👤 Fiche client liée (option)</label><input data-clcombo autocomplete="off" value="${U.esc((this._client(p) || {}).name || '')}" placeholder="si c'est aussi un client…" onchange="Partners.setClient('${p.id}',this.value)"></div>
        <button class="btn-danger btn-sm fit" onclick="Partners.delPartner('${p.id}')">🗑 Supprimer</button></div>
      ${(p.codes || []).map(c => this._codeRow(p, c)).join('')}
      <button class="btn-ghost btn-sm fit" onclick="Partners.addCode('${p.id}')">＋ Ajouter un code</button></div>`;
  },
  render() {
    if (App.isViewer || App.isTeam) { App.mount('<div class="empty"><span class="big">🔒</span>Page réservée à l\'administrateur.</div>'); return; }
    const idx = this._index(), entries = [...idx.values()];
    const months = [...new Set(entries.map(e => e.month).concat([Compta.mk(Date.now())]))].sort().reverse();
    if (this._month !== 'all' && !months.includes(this._month)) this._month = months[0];
    const allM = this._month === 'all', codeF = this._ck(this._code);
    const allCodes = this.list().flatMap(p => (p.codes || []).filter(c => c.code).map(c => ({ code: c.code, pname: p.name }))).sort((x, y) => U.sortFr(x.pname, y.pname) || U.sortFr(x.code, y.code));
    if (this._code && !allCodes.some(c => this._ck(c.code) === codeF)) this._code = '';
    // entrées affichées : le mois choisi (ou tous), limitées au code choisi
    const cur = entries.filter(e => allM || e.month === this._month).map(e => ({ ...e, sales: e.sales.filter(x => !codeF || this._ck(x.code) === codeF) })).filter(e => e.sales.length)
      .sort((a, b) => allM && a.month !== b.month ? (a.month < b.month ? 1 : -1) : U.sortFr(a.name, b.name));
    const pending = allM ? [] : entries.filter(e => e.month !== this._month && e.due > 0 && this._rest(e).rest > 0.005).sort((a, b) => a.month < b.month ? 1 : -1);
    const totalRest = entries.reduce((a, e) => a + Math.max(0, this._rest(e).rest), 0);
    const block = e => {
      const r = this._rest(e), p = this.list().find(x => x.id === e.pid), affil = e.sales.some(x => x.pct > 0);
      const full = e.sales.length === (idx.get(e.pid + '|' + e.month) || e).sales.length, due = e.sales.reduce((a, x) => a + x.amt, 0);   // full = pas de filtre qui masque des commandes
      const state = !affil ? '<span class="badge info">Code sans affiliation : rien à reverser</span>'
        : !full ? '<span class="badge info">Filtre par code : retire-le pour pointer le reversement</span>'
        : r.done && Math.abs(r.rest) < 0.005 ? `<span class="badge ok">${U.num(((p || {}).paid || {})[e.month] && p.paid[e.month].avoirAmt) > 0 ? '✔ Passé en avoir' : '✔ Reversé'} (${U.eur(r.paid)})</span>`
        : r.done ? `<span class="badge warn">Reversé ${U.eur(r.paid)} · reste ${U.eur(r.rest)}</span>` : '<span class="badge warn">À reverser</span>';
      const shown = e.sales.slice().sort((a, b) => a.s.ts - b.s.ts), act = affil && p && full;
      return `<div class="pt-card"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
          <div><b>🤝 ${U.esc(e.name)}</b> <span class="muted">${allM ? '· ' + Compta.monthLabel(e.month) + ' ' : ''}· ${e.sales.length} commande${e.sales.length > 1 ? 's' : ''}</span></div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">${affil ? `<span class="pt-due sensitive">${U.eur(due)}</span>` : ''}${state}
            ${act && this._client(p) && r.rest > 0.005 ? `<button class="btn-ghost btn-sm fit" title="Ajoute ${U.eur(r.rest)} d'avoir sur la fiche de ${U.esc(this._client(p).name)} (déduit de sa prochaine commande)" onclick="Partners.passAvoir('${e.pid}','${e.month}')">💶 Passer en avoir</button>` : ''}
            ${act ? `<button class="${r.done && Math.abs(r.rest) < 0.005 ? 'btn-ghost' : 'btn-cta'} btn-sm fit" onclick="Partners.togglePaid('${e.pid}','${e.month}')">${r.done && Math.abs(r.rest) < 0.005 ? '↩ Décocher' : '✔ Marquer reversé'}</button>` : ''}</div></div>
        <div class="table-wrap mt"><table class="pt-tbl"><thead><tr><th style="text-align:left;">Date</th><th style="text-align:left;">Client · code</th><th class="num" title="Articles après réduction, livraison exclue : la base du reversement">Commande</th><th class="num">À reverser</th></tr></thead><tbody>${shown.map(x => `<tr class="pt-ord" title="Ouvrir la commande dans la fiche du client" onclick="Partners.goSale('${x.s.id}')"><td style="text-align:left;white-space:nowrap;">${new Date(x.s.ts).toLocaleDateString('fr-FR')}</td><td style="text-align:left;">${U.esc(Clients.show(x.s.customerName || '') || '—')}<br><span class="muted" style="font-size:.78rem;">${U.esc(x.code)}${x.pct ? ' · ' + U.qty(x.pct) + ' %' : ' · sans affiliation'}</span></td><td class="num sensitive">${U.eur(x.base)}</td><td class="num sensitive">${x.amt ? U.eur(x.amt) : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
    };
    App.mount(`
      <div class="view-title"><h1>Statistiques</h1><span class="sub">partenaires &amp; codes</span></div>
      ${Stats.tabBar()}
      <div class="card"><h2>💶 Reversements ${U.info("Chaque commande faite avec le code d'un partenaire lui rapporte un pourcentage, calculé sur les articles APRÈS réduction (la livraison est exclue). Ex : panier 40 € −5 % = 38 € de produits ; à 5 % tu reverses 1,90 €. C'est une charge : elle baisse ton bénéfice net, mais pas tes cotisations URSSAF (calculées sur le chiffre d'affaires encaissé). Les ventes annulées ne comptent pas.")}</h2>
        <div class="frow" style="align-items:flex-end;gap:12px;flex-wrap:wrap;">
          <div class="fg" style="max-width:220px;margin:0;"><label>Mois</label><select onchange="Partners.setMonth(this.value)"><option value="all" ${allM ? 'selected' : ''}>Tous les mois</option>${months.map(m => `<option value="${m}" ${m === this._month ? 'selected' : ''}>${Compta.monthLabel(m)}</option>`).join('')}</select></div>
          <div class="fg" style="max-width:260px;margin:0;"><label>Code</label><select data-panel-class="pt-codes" onchange="Partners.setCodeF(this.value)"><option value="">Tous les codes</option>${allCodes.map(c => `<option value="${U.esc(c.code)}" data-a="${U.esc(c.pname)}" data-c="${U.esc(c.code)}" ${this._ck(c.code) === codeF ? 'selected' : ''}>${U.esc(c.pname)} · ${U.esc(c.code)}</option>`).join('')}</select></div>
          <div class="kpi ${totalRest > 0.005 ? 'warn' : 'good'} sensitive" style="flex:0 0 auto;min-width:200px;"><div class="v">${U.eur(totalRest)}</div><div class="l">Reste à reverser (tous mois)</div></div>
        </div>
        ${cur.length ? cur.map(block).join('') : `<p class="muted mt">Aucune commande avec ${this._code ? 'le code « ' + U.esc(this._code) + ' »' : 'un code partenaire'} ${allM ? 'pour le moment' : 'en ' + Compta.monthLabel(this._month)}.</p>`}
        ${pending.length ? `<div class="mt"><div class="muted" style="font-size:.82rem;margin-bottom:4px;">Autres mois pas encore soldés</div><table class="pack-tbl"><tbody>${pending.map(e => `<tr style="cursor:pointer;" onclick="Partners.setMonth('${e.month}')"><td style="text-align:left;">${Compta.monthLabel(e.month)}</td><td style="text-align:left;">${U.esc(e.name)}</td><td class="num sensitive">${U.eur(this._rest(e).rest)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div>
      <div class="card sensitive"><div class="chart-head" style="min-height:0;align-items:center;"><h2>📈 Évolution sur 12 mois</h2>
          <div class="fg" style="margin:0;max-width:240px;"><label>Partenaire</label><select onchange="Partners.setChartP(this.value)"><option value="">Tous</option>${this.list().map(p => `<option value="${p.id}" ${p.id === this._chartP ? 'selected' : ''}>${U.esc(p.name)}</option>`).join('')}</select></div></div>
        <div style="position:relative;height:280px;"><canvas id="partnersChart"></canvas></div>
        <p class="muted help" style="margin:6px 0 0;font-size:.82rem;">Montant reversé aux partenaires (courbe pleine, axe de gauche) et nombre de commandes passées avec un code (pointillés, axe de droite).${entries.length ? '' : ' Pas encore de commande avec un code : la courbe reste à zéro, puis se remplira toute seule.'}</p>
      </div>
      <div class="card"><h2>🤝 Mes partenaires &amp; codes ${U.info("Un partenaire peut avoir plusieurs codes. « Réduction client % » = ce que le client économise : elle se remplit toute seule quand tu tapes le code dans Paniers ou Ventes. « Reversé au partenaire % » = ce que TU lui reverses (laisse vide ou 0 pour un code de réduction sans affiliation). Le pourcentage est figé sur chaque vente au moment de la commande.")}</h2>
        <div class="frow" style="align-items:flex-end;gap:10px;flex-wrap:wrap;">
          <div class="fg" style="max-width:280px;margin:0;"><label>Nouveau partenaire</label><input id="pt_new" placeholder="nom du partenaire" onkeydown="if(event.key==='Enter')Partners.addPartner()"></div>
          <button class="btn-cta fit" onclick="Partners.addPartner()">＋ Créer</button></div>
        ${this.list().map(p => this._partnerCard(p)).join('') || '<p class="muted mt">Aucun partenaire pour l\'instant.</p>'}
      </div>`);
    this._draw();
  }
};
