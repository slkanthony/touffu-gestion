/* ═══════════ Base des races de chiens (Antho 2026-11-17) ═══════════
   Sert à la fiche chien (race, croisements) et au générateur de paniers. Valeurs PAR DÉFAUT, générales et approximatives (moyennes d'adultes),
   jamais un avis vétérinaire : Antho les corrige dans Paramètres → Races (ses modifications vont dans settings.breeds et remplacent cette liste).
   Une race : { id, name, wMin, wMax (kg adulte), energy: 'calme' | 'actif' | 'tres-actif', glouton, choke (risque d'étouffement : chiens brachycéphales
   ou qui bavent beaucoup, produits qui se ramollissent dangereux), sens (digestion / peau souvent sensibles), alert (texte libre), avoidMeats: [viandes] }.
   Gabarit déduit du poids moyen : < 10 kg petit, < 25 kg moyen, sinon grand. */
const RACES_DEFAULT = (() => {
  const C = 'calme', A = 'actif', T = 'tres-actif';
  const MDR1 = 'Race concernée par la mutation MDR1 : sensibilité à certains médicaments (ivermectine, lopéramide…). Aucun effet connu sur l’alimentation.';
  // [nom, poids min, poids max, énergie, glouton, risque d'étouffement, sensible, alerte]
  const L = [
    ['Affenpinscher', 3, 6, A], ['Airedale terrier', 18, 29, T], ['Akita américain', 35, 55, A], ['Akita inu', 32, 45, A], ['American Bully', 20, 50, A, 0, 1],
    ['American Staffordshire terrier', 25, 35, A], ['Barbet', 17, 28, A], ['Basenji', 9, 11, A], ['Basset hound', 20, 29, C, 1], ['Beagle', 10, 15, T, 1],
    ['Beauceron', 30, 45, A], ['Berger allemand', 22, 40, T, 0, 0, 1, 'Digestion souvent sensible (insuffisance pancréatique possible).'],
    ['Berger australien', 16, 32, T, 0, 0, 0, MDR1], ['Berger australien miniature', 9, 18, T, 0, 0, 0, MDR1], ['Berger belge Groenendael', 20, 30, T],
    ['Berger belge Malinois', 20, 30, T], ['Berger belge Tervueren', 20, 30, T], ['Berger blanc suisse', 25, 40, A, 0, 0, 1, 'Race souvent sensible au type de viande (à préciser).'],
    ['Berger des Pyrénées', 8, 15, T], ['Berger des Shetland', 6, 11, A, 0, 0, 0, MDR1], ['Berger hollandais', 23, 32, T], ['Bichon bolonais', 3, 4, C],
    ['Bichon frisé', 3, 6, A], ['Bichon havanais', 3, 6, A], ['Bichon maltais', 2, 4, C], ['Bobtail', 27, 45, A], ['Border collie', 14, 20, T, 0, 0, 0, MDR1],
    ['Border terrier', 5, 7, T], ['Boston terrier', 5, 11, A, 0, 1], ['Bouledogue américain', 27, 54, A, 0, 1], ['Bouledogue anglais', 18, 25, C, 1, 1, 1],
    ['Bouledogue français', 8, 14, A, 0, 1, 1], ['Bouvier bernois', 35, 55, C], ['Bouvier des Flandres', 27, 40, A], ['Boxer', 25, 32, T, 0, 1, 1, 'Intestin souvent sensible (colite).'],
    ['Braque allemand', 25, 32, T], ['Braque de Weimar', 25, 40, T], ['Braque hongrois (Vizsla)', 18, 30, T], ['Briard', 25, 40, A], ['Bull terrier', 22, 30, A],
    ['Bullmastiff', 45, 60, C, 0, 1], ['Cairn terrier', 6, 8, A], ['Cane Corso', 40, 50, A, 0, 1], ['Caniche moyen', 7, 12, A], ['Caniche nain', 4, 7, A],
    ['Caniche royal', 20, 32, A], ['Caniche toy', 2, 4, A], ['Carlin', 6, 9, C, 1, 1], ['Cavalier King Charles', 5, 8, C, 1, 1], ['Chien d’eau portugais', 16, 25, T],
    ['Chihuahua', 1, 3, A], ['Chow-chow', 20, 32, C], ['Cocker américain', 10, 14, A, 1], ['Cocker anglais', 12, 15, A, 1], ['Colley', 18, 30, A, 0, 0, 0, MDR1],
    ['Coton de Tuléar', 4, 6, A], ['Dalmatien', 23, 32, T, 0, 0, 0, 'Prédisposé aux calculs urinaires (urates) : limiter les abats riches en purines.'],
    ['Dobermann', 32, 45, T], ['Dogue allemand', 50, 90, C, 0, 0, 0, 'Risque de torsion d’estomac : éviter les grosses quantités d’un coup.'], ['Dogue argentin', 35, 45, A],
    ['Dogue de Bordeaux', 45, 65, C, 1, 1], ['Épagneul breton', 14, 18, T], ['Épagneul français', 20, 25, A], ['Épagneul nain continental (Papillon)', 2, 5, A],
    ['Eurasier', 18, 32, C], ['Flat-coated retriever', 25, 36, T, 1], ['Fox terrier', 7, 8, T], ['Golden retriever', 25, 34, A, 1, 0, 1], ['Greyhound', 27, 40, C],
    ['Griffon bruxellois', 3, 6, A, 0, 1], ['Griffon Korthals', 23, 27, T], ['Hovawart', 25, 40, A], ['Jack Russell terrier', 5, 7, T], ['Labrador retriever', 25, 36, A, 1],
    ['Lagotto romagnolo', 11, 16, A], ['Léonberg', 45, 75, C], ['Lévrier afghan', 23, 27, A], ['Lhassa apso', 5, 8, C], ['Loulou de Poméranie', 2, 3, A],
    ['Malamute de l’Alaska', 34, 45, A, 1], ['Mastiff', 70, 100, C, 0, 1], ['Mâtin napolitain', 50, 70, C, 0, 1], ['Montagne des Pyrénées', 40, 60, C],
    ['Parson Russell terrier', 6, 8, T], ['Pékinois', 3, 6, C, 0, 1], ['Petit lévrier italien', 3, 5, A], ['Pinscher nain', 4, 6, T], ['Pointer', 20, 30, T],
    ['Rhodesian Ridgeback', 30, 40, A], ['Rottweiler', 35, 60, A, 1], ['Saint-Bernard', 60, 90, C, 0, 1], ['Samoyède', 17, 30, A],
    ['Schnauzer géant', 25, 48, T], ['Schnauzer moyen', 14, 20, A], ['Schnauzer nain', 5, 8, A, 0, 0, 1, 'Prédisposé à la pancréatite : éviter les produits gras.'],
    ['Scottish terrier', 8, 10, A], ['Setter anglais', 25, 30, T], ['Setter Gordon', 25, 36, A], ['Setter irlandais', 25, 32, T, 0, 0, 1, 'Intolérance au gluten possible.'],
    ['Shar-Pei', 18, 25, C, 0, 0, 1, 'Peau et digestion souvent sensibles.'], ['Shiba inu', 8, 11, A], ['Shih Tzu', 4, 7, C, 0, 1], ['Siberian husky', 16, 27, T],
    ['Spitz japonais', 5, 10, A], ['Spitz loup (Keeshond)', 15, 20, A], ['Springer anglais', 18, 25, T, 1], ['Staffordshire bull terrier', 11, 17, A],
    ['Teckel', 7, 12, A, 1], ['Teckel nain', 4, 6, A, 1], ['Terre-Neuve', 55, 70, C, 0, 1], ['Welsh corgi Pembroke', 10, 14, A, 1],
    ['West Highland white terrier', 7, 10, A, 0, 0, 1, 'Peau souvent sensible (allergies).'], ['Whippet', 10, 15, A], ['Yorkshire terrier', 2, 3, A, 0, 0, 1]
  ];
  const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return L.map(([name, wMin, wMax, energy, glouton, choke, sens, alert]) => ({ id: slug(name), name, wMin, wMax, energy, glouton: !!glouton, choke: !!choke, sens: !!sens, alert: alert || '', avoidMeats: [] }));
})();

const Races = {
  ENERGY: [['calme', 'Calme'], ['actif', 'Actif'], ['tres-actif', 'Très actif']],
  list() { const b = Store.state.settings.breeds; return (Array.isArray(b) && b.length ? b : RACES_DEFAULT).slice().sort((x, y) => U.sortFr(x.name, y.name)); },
  find(id) { return this.list().find(r => r.id === id) || null; },
  gabaritOf(r) { const m = (U.num(r.wMin) + U.num(r.wMax)) / 2; return !m ? '' : m < 10 ? 'petit' : m < 25 ? 'moyen' : 'grand'; },
  /* Races d'un chien (plusieurs pour un croisé). Ancien champ texte `breed` : race reconnue par son nom exact si possible. */
  ofDog(d) {
    if (!d) return [];
    if (Array.isArray(d.breeds) && d.breeds.length) return d.breeds.map(id => this.find(id)).filter(Boolean);
    const n = U.normSearch(d.breed || '').trim(); if (!n) return [];
    const r = this.list().find(x => U.normSearch(x.name) === n); return r ? [r] : [];
  },
  /* Profil déduit des races du chien (croisé : poids moyen, et un trait compte dès qu'une des races l'a). null si aucune race connue. */
  profile(d) {
    const rs = this.ofDog(d); if (!rs.length) return null;
    const avg = k => Math.round(rs.reduce((a, r) => a + U.num(r[k]), 0) / rs.length);
    const order = this.ENERGY.map(x => x[0]), energy = rs.map(r => r.energy).sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] || '';
    const wMin = avg('wMin'), wMax = avg('wMax');
    return { names: rs.map(r => r.name), wMin, wMax, gabarit: this.gabaritOf({ wMin, wMax }), energy, glouton: rs.some(r => r.glouton), choke: rs.some(r => r.choke), sens: rs.some(r => r.sens),
      alerts: [...new Set(rs.map(r => r.alert).filter(Boolean))], avoidMeats: [...new Set(rs.flatMap(r => r.avoidMeats || []))] };
  },
  /* ---------- Paramètres → Races (modifiable) ---------- */
  _q: '', _open: false, _edit: '',
  _own() { const S = Store.state.settings; if (!Array.isArray(S.breeds) || !S.breeds.length) S.breeds = JSON.parse(JSON.stringify(RACES_DEFAULT)); return S.breeds; },
  set(id, k, v) {
    const r = this._own().find(x => x.id === id); if (!r) return;
    if (k === 'wMin' || k === 'wMax') v = Math.max(0, Math.round(U.num(v)));
    if (['glouton', 'choke', 'sens'].includes(k)) v = !r[k];
    if (k === 'energy' && r.energy === v) v = '';
    if (k === 'avoidMeat') { const a = r.avoidMeats || (r.avoidMeats = []), i = a.indexOf(v); if (i >= 0) a.splice(i, 1); else a.push(v); }
    else r[k] = v;
    Store.save('settings'); Params.render();
  },
  add() {
    const name = String(U.val('race_new') || '').trim(); if (!name) { U.toast('Indique le nom de la race.', true); return; }
    const list = this._own(); if (list.some(r => U.normSearch(r.name) === U.normSearch(name))) { U.toast('Cette race existe déjà.', true); return; }
    const id = 'r-' + U.uid(); list.push({ id, name, wMin: 0, wMax: 0, energy: '', glouton: false, choke: false, sens: false, alert: '', avoidMeats: [] });
    this._edit = id; this._q = name; Store.save('settings'); Params.render(); U.toast('Race ajoutée : complète sa fiche.');
  },
  async del(id) {
    const r = this._own().find(x => x.id === id); if (!r) return;
    const used = (Store.state.clients || []).some(c => (c.dogs || []).some(d => (d.breeds || []).includes(id)));
    if (!await U.confirm(`Supprimer la race « ${r.name} » ?` + (used ? ' Des chiens l’utilisent : elle disparaîtra de leur fiche.' : ''), { danger: true, okLabel: 'Supprimer' })) return;
    Store.state.settings.breeds = this._own().filter(x => x.id !== id); Store.save('settings'); Params.render();
  },
  setQ(v) { this._q = v; Params.render(); U.refocus('race_q'); },
  toggleEdit(id) { this._edit = this._edit === id ? '' : id; Params.render(); },
  _row(r, meats) {
    const kg = r.wMin || r.wMax ? `${r.wMin || '?'}–${r.wMax || '?'} kg` : 'poids ?';
    const traits = [(this.ENERGY.find(e => e[0] === r.energy) || [])[1], r.glouton ? 'glouton' : '', r.choke ? 'risque d’étouffement' : '', r.sens ? 'sensible' : ''].filter(Boolean).join(' · ');
    const open = this._edit === r.id;
    return `<div class="race-row${open ? ' open' : ''}"><div class="race-h" onclick="Races.toggleEdit('${r.id}')"><b>${U.esc(r.name)}</b> <span class="muted">${kg}${traits ? ' · ' + traits : ''}</span>${r.alert ? ` <span class="badge warn" title="${U.esc(r.alert)}">alerte</span>` : ''}</div>
      ${open ? `<div class="race-b">
        <div class="frow"><div class="fg race-kg"><label>Poids min (kg)</label><input type="text" inputmode="numeric" value="${r.wMin || ''}" onchange="Races.set('${r.id}','wMin',this.value)"></div>
          <div class="fg race-kg"><label>Poids max (kg)</label><input type="text" inputmode="numeric" value="${r.wMax || ''}" onchange="Races.set('${r.id}','wMax',this.value)"></div>
          <div class="fg fit"><label>Énergie</label>${U.seg(this.ENERGY.map(([v, l]) => ({ l, on: r.energy === v, js: `Races.set('${r.id}','energy','${v}')` })), { sm: true })}</div></div>
        <div class="fg"><label>Traits</label>${U.seg([['glouton', 'Glouton'], ['choke', 'Risque d’étouffement'], ['sens', 'Sensible (digestion / peau)']].map(([k, l]) => ({ l, on: !!r[k], js: `Races.set('${r.id}','${k}')` })), { sm: true, wrap: true })}</div>
        <div class="fg"><label>Alerte (affichée sur la fiche du chien et au panier)</label><textarea class="note-area" rows="2" onchange="Races.set('${r.id}','alert',this.value)">${U.esc(r.alert || '')}</textarea></div>
        <div class="fg"><label>Viandes à éviter pour cette race</label><div class="cl-chips">${meats.map(m => `<span class="cl-chip ${(r.avoidMeats || []).includes(m) ? 'avoid' : ''}" onclick="Races.set('${r.id}','avoidMeat','${U.esc(m).replace(/'/g, '&#39;')}')">${U.esc(m)}</span>`).join('')}</div></div>
        <div style="text-align:right;"><button class="btn-ghost btn-sm" onclick="Races.del('${r.id}')">Supprimer cette race</button></div>
      </div>` : ''}</div>`;
  },
  paramsHTML() {
    const meats = (Store.state.settings.meatTypes || []).slice().sort(U.sortFr);
    const all = this.list(), list = all.filter(r => !this._q || U.has(r.name, this._q));
    return `<details class="fold card params-fold" ${this._open ? 'open' : ''} ontoggle="Races._open=this.open">
      <summary><h2>🐕 Races de chiens <span class="muted" style="font-size:.85rem;font-weight:400;">(${all.length})</span> <span class="muted help">Base utilisée par la fiche chien et le générateur de paniers : poids, énergie, glouton, risque d'étouffement, sensibilités, alertes et viandes à éviter. Valeurs de départ générales et approximatives : corrige-les selon ton expérience. Clique une race pour la modifier.</span></h2></summary>
      <div class="fold-body race-wrap">
        <div class="frow"><div class="fg"><label>Rechercher</label><input id="race_q" type="text" autocomplete="off" placeholder="nom de la race…" value="${U.esc(this._q)}" oninput="Races.setQ(this.value)"></div>
          <div class="fg"><label>Nouvelle race</label><input id="race_new" type="text" placeholder="ex : Berger de Beauce" onkeydown="if(event.key==='Enter')Races.add()"></div>
          <button class="btn-ghost fit" onclick="Races.add()">Ajouter</button></div>
        <div class="race-list">${list.map(r => this._row(r, meats)).join('') || '<p class="muted">Aucune race trouvée.</p>'}</div>
      </div></details>`;
  }
};
