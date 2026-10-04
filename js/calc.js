/* ============================================================
   CALCULATEUR DE QUANTITÉ — poids → longueur (sangle) ou nombre
   (bouclerie). Portage de l'ancienne mini-appli "Calculateur de
   Sangle" d'Antho (ratio poids/longueur), intégré à Touffu Gestion.

   Choix d'archi validés avec Antho :
   - PAGE DÉDIÉE et ISOLÉE (pas un onglet noyé ailleurs) : quand il
     ne l'ouvre pas, les valeurs ne bougent pas, aucun risque de
     toucher au stock par erreur. Cette page ne modifie JAMAIS le
     stock — c'est un outil de calcul en lecture seule. La seule
     écriture possible est délibérée : enregistrer la référence
     (bouton explicite).

   - RÉFÉRENCE SANGLE = PAR LARGEUR, PAS PAR COULEUR (demande explicite
     d'Antho) : le poids au mètre d'une sangle ne dépend que de sa
     largeur (une 16mm grise pèse comme une 16mm bleue). On stocke donc
     UNE référence par largeur dans `Store.state.settings.strapWeights`
     ({ '16mm': {w, q}, ... } — w g = q m), partagée par toutes les
     couleurs. Les largeurs viennent du référentiel `S.widths` ∪ des
     largeurs réellement présentes sur les matières sangle (`m.variant`,
     où pour une sangle product=couleur / variant=largeur).

   - RÉFÉRENCE BOUCLERIE = PAR ARTICLE : un mousqueton ≠ un rivet ≠ une
     taille différente. Stockée sur la matière elle-même
     (`m.refWeight` g = `m.refQty` pièces).

   Formule (identique à l'ancienne appli) :
     ratio = poids de réf. / quantité de réf.   (g par m ou par pièce)
     résultat = poids mesuré / ratio            (m ou pièces)
   Pour les pièces, on arrondit (on ne compte pas 3,7 mousquetons).

   ⚠️ Mise à jour live SANS re-render : les champs "poids mesuré" et
   les champs de référence mettent à jour uniquement l'encadré résultat
   via textContent (pas de App.mount/innerHTML), donc pas de piège de
   focus/curseur — inutile d'appeler U.refocus ici. Seuls le sélecteur
   et le bascule Longueur/Pièces re-rendent (pas des champs texte). */
const Calc = {
  refSel: '',          // '' = manuel | 'w:<largeur>' = sangle par largeur | 'm:<id>' = bouclerie par article
  mode: 'len',         // 'len' (mètres) | 'pcs' (pièces)
  refWeight: 0,        // poids de référence (g)
  refQty: 0,           // quantité de référence (m ou pièces)
  measured: 0,         // poids mesuré (g)

  ratio() { return (this.refWeight > 0 && this.refQty > 0) ? this.refWeight / this.refQty : null; },
  result() { const r = this.ratio(); return r ? this.measured / r : null; },
  unitLabel() { return this.mode === 'pcs' ? 'pièce' : 'm'; },

  /* Extrait une largeur normalisée ("16mm") d'une chaîne (variante/nom). */
  normWidth(str) {
    const m = String(str || '').match(/(\d+(?:[.,]\d+)?)\s*mm/i);
    return m ? m[1].replace(',', '.') + 'mm' : '';
  },
  matWidth(m) { return this.normWidth(m.variant) || this.normWidth(m.name); },

  /* Type/famille de sangle : "Hexa" (plus légère par nature → poids au mètre
     différent à largeur égale) si le nom/produit contient "hexa", sinon
     "Classique". Pour une catégorie en mode "partagé", la référence est keyée
     par (type, largeur). Les catégories hors sangle n'ont pas de "hexa" → type
     "Classique" par défaut, donc regroupées par largeur seule. */
  strapType(m) {
    // catégories « Sangle HEXA » / « Sangle réfléchissante » : le type EST la catégorie (pas de double « HEXA Hexa ») ; catégorie « Sangle » : on garde la détection par le nom
    if (Store.isSangleKind(m.kind) && m.kind !== 'sangle') return 'Classique';
    return /hexa/i.test(String(m.product || '') + ' ' + String(m.name || '')) ? 'Hexa' : 'Classique';
  },
  /* Unité d'une catégorie (pour le mode partagé qui n'a pas d'article précis) :
     déduite des matières réelles de cette catégorie, sinon repli (bouclerie → pièces,
     reste → mètres). Gère les catégories libres ajoutées par Antho. */
  kindUnit(kind) {
    const m = Store.state.materials.find(x => (x.kind || 'autre') === kind && (x.unit === 'm' || x.unit === 'piece'));
    if (m) return m.unit;
    return kind === 'bouclerie' ? 'piece' : 'm';
  },

  /* Construit les entrées du sélecteur selon le mode de chaque catégorie
     (Store.calcRefMode) :
     - 'shared' : une entrée par (catégorie, type, largeur), réf. dans
       S.strapWeights['<kind>|<type> <largeur>'], partagée par toutes les
       couleurs. Semée depuis le référentiel S.widths (famille Classique) ∪ les
       largeurs réelles des matières de cette catégorie. Une matière sans
       largeur repérable retombe en "par article" (rien perdu).
     - 'perItem' : une entrée par article (réf. sur la matière `m.refWeight`/`m.refQty`).
     Clé S.strapWeights namespacée par catégorie pour éviter les collisions de
     largeur entre catégories. */
  buildOptions() {
    const S = Store.state.settings;
    const shared = new Map();      // storageKey -> {kind, type, width, unit}
    const perItem = [];            // matières listées à l'article
    // familles/largeurs seed depuis le référentiel, pour chaque catégorie en mode partagé
    Object.keys(Stock.matKindLabel).forEach(k => {
      if (Store.calcRefMode(k) !== 'shared') return;
      if (Store.isSangleKind(k) && k !== 'sangle') return;   // sangles HEXA / réfléchissantes : seulement les largeurs réellement présentes (pas toute la liste « sans réf. »)
      (S.widths || []).forEach(w => {
        const n = this.normWidth(w); if (!n) return;
        shared.set(k + '|Classique ' + n, { kind: k, type: 'Classique', width: n, unit: this.kindUnit(k) });
      });
    });
    Store.state.materials.filter(m => m.unit === 'm' || m.unit === 'piece').forEach(m => {
      const kind = m.kind || 'autre';
      if (Store.calcRefMode(kind) === 'shared') {
        const w = this.matWidth(m);
        if (!w) { perItem.push(m); return; }   // pas de largeur → repli par article
        const type = this.strapType(m);
        shared.set(kind + '|' + type + ' ' + w, { kind, type, width: w, unit: m.unit || this.kindUnit(kind) });
      } else {
        perItem.push(m);
      }
    });
    const sharedOpts = [...shared.entries()].map(([sk, v]) => ({ sk, ...v }))
      .sort((a, b) => (a.kind !== b.kind ? U.sortFr(a.kind, b.kind)
        : a.type !== b.type ? U.sortFr(a.type, b.type)
          : parseFloat(a.width) - parseFloat(b.width)));
    perItem.sort((a, b) => U.sortFr(a.name || '', b.name || ''));
    return { sharedOpts, perItem };
  },
  /* Retrouve l'unité d'une entrée partagée à partir de sa clé (pour fixer le mode). */
  sharedUnit(sk) {
    const e = this.buildOptions().sharedOpts.find(o => o.sk === sk);
    return e ? e.unit : this.kindUnit(String(sk).split('|')[0]);
  },

  render() {
    const S = Store.state.settings;
    const sw = S.strapWeights || {};
    const { sharedOpts, perItem } = this.buildOptions();

    const widthOpts = sharedOpts.map(e => {
      const ref = sw[e.sk];
      const u = e.unit === 'piece' ? 'pièce' : 'm';
      const tag = (ref && U.num(ref.w) > 0 && U.num(ref.q) > 0) ? ` — ${U.qty(U.num(ref.w) / U.num(ref.q))} g/${u}` : ' — (pas de réf.)';
      const kl = Stock.matKindLabel[e.kind] || e.kind;
      const typePart = (e.type && e.type !== 'Classique') ? ' ' + e.type : '';
      const ico = e.unit === 'piece' ? '🔩' : '📏';
      return { v: 'w:' + e.sk, l: `${ico} ${kl}${typePart} ${e.width}${tag}` };
    });
    const boucOpts = perItem.map(m => {
      const rw = U.num(m.refWeight), rq = U.num(m.refQty);
      const u = m.unit === 'piece' ? 'pièce' : 'm';
      const tag = (rw > 0 && rq > 0) ? ` — ${U.qty(rw / rq)} g/${u}` : ' — (pas de réf.)';
      const ico = m.unit === 'piece' ? '🔩' : '📏';
      return { v: 'm:' + m.id, l: `${ico} ${m.name || '—'}${tag}` };
    });
    const options = [{ v: '', l: '✏️ Référence manuelle (non enregistrée)' }].concat(widthOpts, boucOpts);

    const kind = this.refSel.startsWith('w:') ? 'width' : this.refSel.startsWith('m:') ? 'mat' : 'manual';
    let savedName = '';
    if (kind === 'width') {
      const sk = this.refSel.slice(2);          // "<kind>|<type> <largeur>"
      const [mk, grp] = sk.split('|');
      const kl = Stock.matKindLabel[mk] || mk;
      savedName = 'les ' + kl.toLowerCase() + ' ' + String(grp || '').replace(/^Classique /, '');
    } else if (kind === 'mat') {
      savedName = '« ' + (Store.material(this.refSel.slice(2))?.name || '') + ' »';
    }
    const refQtyLbl = this.mode === 'pcs' ? '= nombre de pièces de référence' : '= longueur de référence (m)';

    App.mount(`
      <div class="view-title"><h1>🧮 Calculateur de quantité</h1><span class="sub">poids → longueur de sangle ou nombre de pièces</span></div>

      <div class="grid c2">
        <div class="card">
          <h2>1. Référence</h2>
          <p class="muted help" style="margin-top:-4px;">Le mode de chaque catégorie se règle dans <b>Paramètres → Référentiels</b>. Par défaut : sangles = référence <b>partagée par largeur/type</b> (le poids au mètre ne dépend pas de la couleur ; les <b>Hexa</b>, plus légères, sont séparées) ; boucleries = référence <b>par article</b>. Ou saisis une référence manuelle ponctuelle.</p>

          <div class="fg"><label>Sangle (largeur/type) / bouclerie</label>${U.customSelect({ value: this.refSel, options, onPick: 'Calc.pickRef' })}</div>

          ${kind === 'manual' ? `<div class="frow" style="margin:6px 0 10px;">
            <button type="button" class="btn-ghost btn-sm ${this.mode === 'len' ? 'active' : ''}" onclick="Calc.setMode('len')">📏 Longueur (m)</button>
            <button type="button" class="btn-ghost btn-sm ${this.mode === 'pcs' ? 'active' : ''}" onclick="Calc.setMode('pcs')">🔢 Pièces</button>
          </div>` : ''}

          <div class="frow">
            <div class="fg"><label>Poids de référence (g)</label><input id="calc_refw" type="number" step="0.01" min="0" value="${this.refWeight || ''}" placeholder="ex: 600" oninput="Calc.onRef('refWeight',this.value)"></div>
            <div class="fg"><label>${refQtyLbl}</label><input id="calc_refq" type="number" step="0.01" min="0" value="${this.refQty || ''}" placeholder="${this.mode === 'pcs' ? 'ex: 50' : 'ex: 30'}" oninput="Calc.onRef('refQty',this.value)"></div>
          </div>

          <div class="calc-ratio">Ratio : <b id="calc_ratio">${this.ratio() ? U.qty(this.ratio()) : '—'}</b> g/${this.unitLabel()}</div>

          ${kind !== 'manual' ? `<button class="btn-cta btn-sm mt" onclick="Calc.saveRef()">💾 Enregistrer la référence pour ${U.esc(savedName)}</button>
          <p class="muted help" style="font-size:.8rem;margin-top:6px;">${kind === 'width' ? 'Cette référence sera partagée par <b>toutes les couleurs</b> de cette largeur et de ce type (classique / Hexa).' : 'Cette référence sera enregistrée sur cet article.'} Seul ce bouton écrit quelque chose — le calcul ci-contre ne touche jamais au stock.</p>` : ''}
        </div>

        <div class="card">
          <h2>2. Calcul</h2>
          <div class="fg"><label>Poids mesuré (g)</label><input id="calc_measured" type="number" step="0.01" min="0" value="${this.measured || ''}" placeholder="Pèse ton rouleau / tes pièces…" oninput="Calc.onMeasure(this.value)"></div>

          <div class="calc-result">
            <div class="calc-result-label" id="calc_result_label">${this.mode === 'pcs' ? 'Nombre estimé' : 'Longueur estimée'}</div>
            <div class="calc-result-value" id="calc_result">${this._resultBig()}</div>
            <div class="calc-result-unit" id="calc_result_unit">${this.mode === 'pcs' ? 'pièces' : 'mètres'}</div>
            <div class="calc-result-sub muted" id="calc_result_sub">${this._resultSub()}</div>
          </div>
        </div>
      </div>

      <div>
        <ul class="muted help" data-help-anchor=".view-title h1" style="line-height:1.7;margin:0;padding-left:18px;">
          <li><b>Sangle</b> : choisis la <b>largeur</b> (les sangles <b>Hexa</b>, plus légères, ont leur propre référence, séparée des classiques). Pèse une longueur connue (ex : un rouleau neuf de 30 m), mets ce poids et 30 en référence, puis enregistre : la référence vaut pour toutes les couleurs de cette largeur et de ce type. Ensuite, pèse n'importe quel rouleau entamé → sa longueur restante.</li>
          <li><b>Bouclerie</b> : choisis l'article, pèse un nombre connu de pièces (ex : 50 mousquetons), mets ce poids et 50 en référence, enregistre. Ensuite, pèse un sachet → le nombre de pièces.</li>
          <li>Une fois enregistrée, la référence se recharge automatiquement à chaque fois — tu ne la ressaisis plus.</li>
          <li><b>Mode par catégorie</b> : dans <b>Paramètres → Référentiels → Accessoires</b>, tu choisis pour chaque catégorie de matière si sa référence est « partagée par largeur » (comme les sangles) ou « par article » (comme les boucleries).</li>
        </ul>
      </div>`);
  },

  _resultBig() {
    const r = this.result();
    if (r == null) return this.mode === 'pcs' ? '0' : '0,00';
    return this.mode === 'pcs' ? String(Math.round(r)) : U.qty(Math.round(r * 100) / 100);
  },
  _resultSub() {
    const r = this.result();
    if (r == null) return 'Renseigne la référence et le poids mesuré.';
    if (this.mode === 'pcs') return `valeur exacte : ${U.qty(Math.round(r * 10) / 10)} pièces (arrondi à l'entier)`;
    return `soit ${U.qty(Math.round(r * 100) / 100)} m`;
  },
  _refreshResult() {
    const rv = document.getElementById('calc_result'); if (rv) rv.textContent = this._resultBig();
    const rs = document.getElementById('calc_result_sub'); if (rs) rs.textContent = this._resultSub();
    const rt = document.getElementById('calc_ratio'); if (rt) rt.textContent = this.ratio() ? U.qty(this.ratio()) : '—';
  },

  onMeasure(v) { this.measured = U.num(v); this._refreshResult(); },
  onRef(field, v) { this[field] = U.num(v); this._refreshResult(); },

  setMode(mode) { this.mode = mode; this.render(); },

  pickRef(value) {
    this.refSel = value;
    if (value.startsWith('w:')) {
      const sk = value.slice(2);
      const ref = (Store.state.settings.strapWeights || {})[sk] || {};
      this.refWeight = U.num(ref.w); this.refQty = U.num(ref.q);
      this.mode = this.sharedUnit(sk) === 'piece' ? 'pcs' : 'len';
    } else if (value.startsWith('m:')) {
      const m = Store.material(value.slice(2));
      if (m) { this.refWeight = U.num(m.refWeight); this.refQty = U.num(m.refQty); this.mode = m.unit === 'piece' ? 'pcs' : 'len'; }
    }
    // manuel : on garde les valeurs courantes
    this.render();
  },

  saveRef() {
    if (!(this.refWeight > 0 && this.refQty > 0)) { U.toast('Renseigne un poids et une quantité de référence valides.', true); return; }
    if (this.refSel.startsWith('w:')) {
      const key = this.refSel.slice(2);
      const S = Store.state.settings;
      if (!S.strapWeights) S.strapWeights = {};
      S.strapWeights[key] = { w: this.refWeight, q: this.refQty };
      Store.save('settings');
      const grp = String(key.split('|')[1] || '').replace(/^Classique /, '');
      U.toast('Référence enregistrée pour ' + grp + ' (toutes couleurs).');
      this.render();
    } else if (this.refSel.startsWith('m:')) {
      const m = Store.material(this.refSel.slice(2));
      if (!m) { U.toast('Article introuvable.', true); return; }
      const snap = Store.snapshot('materials', m);
      m.refWeight = this.refWeight; m.refQty = this.refQty;
      const entry = Store.commitSnapshot(snap, 'stock', 'Poids de référence — ' + (m.name || ''));
      Store.save('materials');
      U.toast('Référence enregistrée sur l\'article.', false, entry.id);
      this.render();
    }
  }
};
