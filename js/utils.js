/* ============ Thème clair / sombre ============ */
const Theme = {
  KEY: 'touffu_theme',
  get() { return localStorage.getItem(this.KEY) || 'dark'; },
  apply(t) { document.documentElement.setAttribute('data-theme', t); },
  set(t) { localStorage.setItem(this.KEY, t); this.apply(t); },
  toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); }
};
Theme.apply(Theme.get()); // appliqué tout de suite pour éviter un flash en thème clair

/* Ferme tout menu multi-sélection ouvert dès qu'on clique ailleurs (y compris sur un autre
   champ/menu déroulant) — capture:true pour passer avant les autres gestionnaires de clic. */
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.multiselect[open]').forEach(d => {
    if (!d.contains(e.target)) {
      d.open = false;
      const fn = d.getAttribute('ontoggle');
      if (fn) try { new Function(fn).call(d); } catch(_) {}
    }
  });
}, true);

/* Ferme les listes autocomplete ouvertes au clic ailleurs. On ne peut pas utiliser onblur
   ici : App.mount() remplace tout le innerHTML à chaque rendu, donc l'input qui vient de
   s'ouvrir est aussitôt détaché puis recréé — ça déclenche un blur "fantôme" qui refermerait
   la liste immédiatement après son ouverture. Comme pour les menus multi-sélection ci-dessus,
   on détecte plutôt le vrai clic hors du widget (data-onclose porte le nom de la fonction
   globale à appeler, ex: "Ventes.closeCatMenu"). */
document.addEventListener('click', (e) => {
  document.querySelectorAll('[data-onclose]').forEach(el => {
    if (el.contains(e.target)) return;
    // Les modules (Ventes, Stock...) sont des `const` de script, absents de `window` :
    // on passe par new Function pour les résoudre via la portée globale, comme le fait
    // déjà chaque attribut inline onclick="Module.methode()" du reste de l'appli.
    new Function(el.getAttribute('data-onclose') + '()')();
  });
}, true);

/* ============ Utilitaires ============ */
const U = {
  uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
  num: (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; },
  eur: (v, dec = 2) => (U.num(v)).toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + ' €',
  qty: (v) => (U.num(v)).toLocaleString('fr-FR', { maximumFractionDigits: 3 }),
  pct: (v) => (U.num(v)).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %',
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  today: () => new Date().toISOString().slice(0, 10),
  frDate: (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return d && y ? `${d}/${m}/${y}` : iso; },
  frDateTime: (ts) => new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
  daysTo: (iso) => { if (!iso) return null; return Math.ceil((new Date(iso) - new Date(U.today())) / 86400000); },

  /* Persiste un objet de filtres (recherche, viande, tri…) dans localStorage pour qu'il
     survive à un F5 — appelé en tête de chaque render() de page filtrée : recharge UNE
     SEULE fois par chargement de page (flag __fLoaded posé sur l'objet lui-même), puis
     réenregistre à chaque appel pour capter toute mutation faite par les setters (qu'ils
     réassignent la clé ou mutent un tableau en place, peu importe — on relit l'état actuel).
     Les clés finissant par "Open" (état ouvert/fermé d'un menu déroulant) ne sont jamais
     persistées : on ne veut pas rouvrir un panneau de filtre tout seul au chargement.
     `keys` optionnel : liste de propriétés à cibler sur un objet qui n'est pas dédié aux
     filtres (ex: un module entier avec quelques propriétés éparses) — sinon Object.keys(obj). */
  syncFilters(name, obj, keys) {
    const lsKey = 'touffu_filt_' + name;
    const isSkipped = k => k === '__fLoaded' || /open$/i.test(k);
    if (!obj.__fLoaded) {
      try {
        const saved = JSON.parse(localStorage.getItem(lsKey) || '{}');
        Object.keys(saved).forEach(k => { if (!isSkipped(k) && (!keys || keys.includes(k))) obj[k] = saved[k]; });
      } catch (e) {}
      obj.__fLoaded = true;
    }
    try {
      const list = keys || Object.keys(obj);
      const out = {};
      list.forEach(k => { if (!isSkipped(k)) out[k] = obj[k]; });
      localStorage.setItem(lsKey, JSON.stringify(out));
    } catch (e) {}
  },

  frDateLong(iso) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  },

  datePickerHTML(id, label = 'DLUO') {
    return `<div class="fg">
      <label>${label}</label>
      <div class="date-picker-wrap">
        <input id="${id}" type="date" onchange="U.datePickerSync('${id}')">
        <span class="date-preview" id="${id}_preview"></span>
      </div>
      <div class="date-quick-btns">
        <button type="button" class="btn-date-quick" onclick="U.setDateQuick('${id}',0)">Aujourd'hui</button>
        <button type="button" class="btn-date-quick" onclick="U.setDateQuick('${id}',30)">+1 mois</button>
        <button type="button" class="btn-date-quick" onclick="U.setDateQuick('${id}',90)">+3 mois</button>
        <button type="button" class="btn-date-quick" onclick="U.setDateQuick('${id}',180)">+6 mois</button>
        <button type="button" class="btn-date-quick" onclick="U.setDateQuick('${id}',365)">+1 an</button>
      </div>
    </div>`;
  },

  setDateQuick(id, days) {
    const d = new Date(); d.setDate(d.getDate() + days);
    const iso = d.toISOString().slice(0, 10);
    const el = document.getElementById(id);
    if (el) { el.value = iso; U.datePickerSync(id); }
  },

  datePickerSync(id) {
    const el = document.getElementById(id);
    const preview = document.getElementById(id + '_preview');
    if (!el || !preview) return;
    const v = el.value;
    if (!v) { preview.textContent = ''; preview.className = 'date-preview'; return; }
    const days = U.daysTo(v);
    const txt = U.frDateLong(v);
    const suffix = days === 0 ? " (aujourd'hui)" : days === 1 ? ' (demain)' : days > 0 ? ` (dans ${days} j)` : ` (il y a ${Math.abs(days)} j)`;
    preview.textContent = txt + suffix;
    preview.className = 'date-preview' + (days < 0 ? ' date-past' : days <= 30 ? ' date-soon' : '');
  },

  dluoTag(iso) {
    if (!iso) return `<span class="tag">DLUO —</span>`;
    const d = U.daysTo(iso);
    const cls = d < 0 ? 'dluo-bad' : d <= 30 ? 'dluo-warn' : 'dluo-ok';
    const txt = d < 0 ? `périmé (${U.frDate(iso)})` : `DLUO ${U.frDate(iso)} · ${d} j`;
    return `<span class="tag ${cls}">${txt}</span>`;
  },

  /* journalId (optionnel) : si l'entrée du journal correspondante a un `undo`, affiche un
     bouton "↺ Annuler" directement dans le toast — demande explicite d'Antho (repris de son
     ancienne appli : un "Annuler" apparaît systématiquement en bas à droite juste après
     chaque action, pas seulement dans Paramètres → Journal). Reste affiché plus longtemps
     dans ce cas pour laisser le temps de cliquer. */
  toast(msg, err = false, journalId = null) {
    const t = document.getElementById('toast');
    const j = journalId ? Store.state.journal.find(x => x.id === journalId) : null;
    if (j && j.undo) {
      t.innerHTML = `<span>${U.esc(msg)}</span><button class="btn-ghost btn-sm toast-undo" onclick="U.undoToast('${journalId}')">↺ Annuler</button>`;
    } else {
      t.innerHTML = U.esc(msg);
    }
    t.classList.toggle('err', !!err); t.classList.add('show');
    clearTimeout(U._tt); U._tt = setTimeout(() => t.classList.remove('show'), j && j.undo ? 6000 : 2600);
  },
  undoToast(journalId) {
    document.getElementById('toast').classList.remove('show');
    clearTimeout(U._tt);
    Params.undo(journalId);
  },

  /* Modale générique : U.modal({title, body(html), onOk, onCancel, okLabel, wide}).
     onCancel (optionnel) : appelé sans argument si l'utilisateur ferme sans valider
     (bouton "Fermer" ou clic hors de la modale) — utile quand un contrôle du formulaire
     appelant (ex: un <select>) a déjà changé de valeur avant l'ouverture de la modale et
     doit être remis dans son état d'origine si l'utilisateur annule. */
  modal({ title, body, onOk, onCancel, okLabel = 'Valider', danger = false, hideOk = false, wide = false }) {
    U.closeModal();
    const bg = document.createElement('div');
    bg.className = 'modal-bg'; bg.id = 'modalBg';
    bg.innerHTML = `<div class="modal${wide ? ' wide' : ''}"><h2>${title}</h2><div id="modalBody">${body}</div>
      <div class="actions">
        <button class="btn-ghost" id="modalCancel">Fermer</button>
        ${hideOk ? '' : `<button class="${danger ? 'btn-danger' : 'btn-cta'}" id="modalOk">${okLabel}</button>`}
      </div></div>`;
    document.body.appendChild(bg);
    // Un clic à côté NE FERME PLUS la fenêtre (Antho perdait ses saisies) : seul « Fermer » ferme. Petit rebond visuel.
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) { const m = bg.querySelector('.modal'); m.classList.remove('nudge'); void m.offsetWidth; m.classList.add('nudge'); } });
    document.getElementById('modalCancel').onclick = () => { U.closeModal(); if (onCancel) onCancel(); };
    if (!hideOk) document.getElementById('modalOk').onclick = () => { if (onOk && onOk() === false) return; };
    return bg;
  },
  /* Confirmation aux couleurs de l'appli (remplace le confirm() natif du navigateur), posée AU-DESSUS
     d'une éventuelle fenêtre U.modal déjà ouverte (sans la fermer). Renvoie une promesse → true / false. */
  ask({ title = 'Confirmer', html = '', okLabel = 'Valider', cancelLabel = 'Annuler', danger = false } = {}) {
    return new Promise(resolve => {
      document.getElementById('askBg')?.remove();
      const bg = document.createElement('div');
      bg.className = 'modal-bg ask-bg'; bg.id = 'askBg';
      bg.innerHTML = `<div class="modal ask-modal"><h2>${title}</h2><div>${html}</div>
        <div class="actions">${cancelLabel ? `<button class="btn-ghost" id="askNo">${cancelLabel}</button>` : ''}<button class="${danger ? 'btn-danger' : 'btn-cta'}" id="askYes">${okLabel}</button></div></div>`;
      document.body.appendChild(bg);
      const done = v => { bg.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); } };
      document.addEventListener('keydown', key, true);
      bg.addEventListener('click', e => { if (e.target === bg) done(false); });
      if (bg.querySelector('#askNo')) bg.querySelector('#askNo').onclick = () => done(false);
      bg.querySelector('#askYes').onclick = () => done(true);
      bg.querySelector('#askYes').focus();
    });
  },
  /* Remplace window.confirm() partout : même question, fenêtre de l'appli. Suppression / effacement → bouton rouge. */
  confirm(msg, o = {}) {
    const txt = String(msg || '');
    const m = txt.match(/^\s*(Supprimer|Effacer|Vider)/i);
    const verb = m ? m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() : '';
    return U.ask({
      title: o.title || (verb ? '🗑️ ' + verb + ' ?' : '⚠️ Confirmer'),
      html: `<p style="margin:0;line-height:1.5;">${U.esc(txt).replace(/\n/g, '<br>')}</p>`,
      okLabel: o.okLabel || (verb || 'Confirmer'), cancelLabel: o.cancelLabel || 'Annuler', danger: o.danger ?? !!verb
    });
  },
  /* Message simple (remplace window.alert). */
  alert(msg, title = 'ℹ️ Information') {
    return U.ask({ title, html: `<p style="margin:0;line-height:1.5;">${U.esc(String(msg)).replace(/\n/g, '<br>')}</p>`, okLabel: 'OK', cancelLabel: '' });
  },
  /* Alerte de doublons (lien / réf. fournisseur, liaison fiche prix) : jamais bloquante.
     Renvoie true s'il n'y a rien à signaler (ou si on revient après « Enregistrer quand même ») ;
     sinon ouvre la confirmation et renvoie false — si l'utilisateur confirme, retry() relance l'enregistrement. */
  dupGate(msgs, retry) {
    if (!msgs || !msgs.length || U._dupPass) return true;
    U.ask({
      title: '⚠️ Doublon détecté',
      html: `<ul class="ask-list">${msgs.map(m => `<li>${U.esc(String(m).replace(/^⚠️\s*/, ''))}</li>`).join('')}</ul><p class="muted" style="margin:8px 0 0;">Ce n'est qu'une alerte : tu peux enregistrer quand même si c'est voulu.</p>`,
      okLabel: 'Enregistrer quand même', cancelLabel: 'Revenir'
    }).then(ok => { if (!ok) return; U._dupPass = true; try { retry(); } finally { U._dupPass = false; } });
    return false;
  },
  closeModal() { document.getElementById('modalBg')?.remove(); if (typeof Store !== 'undefined' && Store._afterModal) Store._afterModal(); },

  download(filename, text, mime = 'application/json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename; a.click(); URL.revokeObjectURL(a.href);
  },

  sortFr: (a, b) => String(a).localeCompare(String(b), 'fr', { sensitivity: 'base' }),
  normSearch: s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae').toLowerCase(),
  val: (id) => document.getElementById(id)?.value ?? '',
  numVal: (id) => U.num(U.val(id)),

  /* Saisie de longueur en double case « [m] m [cm] cm » (même visuel .cost-split que l'encre UV).
     La valeur est toujours manipulée en CENTIMÈTRES (lenCm). opts.change = code JS exécuté quand on QUITTE
     le bloc (pas entre m et cm, pour ne pas perdre le focus sur un re-rendu) et seulement si la valeur a changé ;
     opts.input = code JS exécuté à chaque frappe (aperçu live, sans re-rendu). */
  lenSplit(id, cm, opts = {}) {
    const v = Math.max(0, U.num(cm));
    const m = Math.floor(v / 100), rest = Math.round((v - m * 100) * 10) / 10;
    const inp = opts.input ? `oninput="${opts.input}"` : '';
    const out = opts.change ? `data-v="${v}" onfocusout="if(!this.contains(event.relatedTarget)&&U.lenCm('${id}')!=this.dataset.v){this.dataset.v=U.lenCm('${id}');${opts.change}}"` : '';
    return `<span class="cost-split len-split" ${out}><input id="${id}_m" type="number" min="0" step="any" inputmode="decimal" value="${m || ''}" placeholder="0" ${inp}><span class="cost-split-sep">m</span><input id="${id}_cm" type="number" min="0" step="any" inputmode="decimal" value="${rest || ''}" placeholder="0" ${inp}><span class="cost-split-sep" style="padding-right:8px;">cm</span></span>`;
  },
  /* Affichage d'une longueur en cm sous forme lisible : 526 → « 5 m 26 cm », 23 → « 23 cm », 600 → « 6 m ». */
  lenTxt(cm) {
    const v = Math.max(0, U.num(cm)), m = Math.floor(v / 100), rest = Math.round((v - m * 100) * 10) / 10;
    return m ? `${m} m${rest ? ' ' + U.qty(rest) + ' cm' : ''}` : `${U.qty(rest)} cm`;
  },
  lenCm: (id) => Math.round((U.numVal(id + '_m') * 100 + U.numVal(id + '_cm')) * 10) / 10,
  lenSet(id, cm) {
    const v = Math.max(0, U.num(cm)), m = Math.floor(v / 100), rest = Math.round((v - m * 100) * 10) / 10;
    const em = document.getElementById(id + '_m'), ec = document.getElementById(id + '_cm');
    if (em) em.value = m || ''; if (ec) ec.value = rest || '';
  },
  chk: (id) => !!document.getElementById(id)?.checked,

  meatFilter({ current, meats, count, setter, openState, openSetter }) {
    const sorted = meats.slice().sort(U.sortFr);
    const main = sorted.filter(m => m.toLowerCase() !== 'autre');
    const autre = sorted.filter(m => m.toLowerCase() === 'autre');
    const all = main.concat(autre);
    const curLabel = current === 'all' ? `Tous (${count})` : U.esc(current);
    return `<details class="multiselect meat-filter" ${openState ? 'open' : ''} ontoggle="${openSetter}=this.open">
      <summary>${curLabel} ▾</summary>
      <div class="multiselect-panel">
        <div class="dluo-opt${current==='all'?' active':''}" onclick="${setter}('all')">Tous (${count})</div>
        ${all.map(m => `<div class="dluo-opt${current.toLowerCase()===m.toLowerCase()?' active':''}" onclick="${setter}('${U.esc(m)}')">${U.esc(m)}</div>`).join('')}
      </div>
    </details>`;
  },

  customSelect({ value, options, onPick, cls }) {
    const cur = options.find(o => String(o.v) === String(value)) || options[0];
    const label = cur ? cur.l : '—';
    return `<details class="multiselect custom-select${cls ? ' ' + cls : ''}">
      <summary>${U.esc(label)} ▾</summary>
      <div class="multiselect-panel">
        ${options.map(o => `<div class="dluo-opt${String(o.v)===String(value)?' active':''}" onclick="this.closest('details').open=false;(${onPick})('${U.esc(String(o.v)).replace(/&#39;/g, "\\'")}')">${U.esc(o.l)}</div>`).join('')}
      </div>
    </details>`;
  },

  /* Dropdown à cases à cocher : "Tout cocher/décocher" + liste d'options.
     toggle/setAll sont des noms de fonctions globales : toggle(value), setAll(bool).
     onOpen est un nom de fonction globale appelée avec le nouvel état ouvert/fermé : onOpen(bool),
     à utiliser par l'appelant pour mémoriser l'état et le repasser dans `open` au ré-rendu suivant. */
  _msGroupToggle(gi, isOpen, el) {
    (this._msOpenGroups || (this._msOpenGroups = new Set()));
    if (isOpen) { this._msOpenGroups.add(gi); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    else { this._msOpenGroups.delete(gi); }
  },

  multiSelect({ options, groups, selected, toggle, setAll, open, onOpen, placeholder = 'Toutes', labels }) {
    const allItems = groups ? groups.flatMap(g => g.items) : options;
    const lb = (o) => (labels && labels[o]) || o;
    const label = !allItems.length ? placeholder
      : selected.length === 0 ? placeholder
      : selected.length === allItems.length ? 'Toutes' : selected.length + ' sélectionnée(s)';
    const chk = o => `<label class="ms-opt"><input type="checkbox" ${selected.includes(o) ? 'checked' : ''} onchange="${toggle}('${U.esc(o).replace(/&#39;/g, "\\'")}')"> ${U.esc(lb(o))}</label>`;
    let body;
    if (groups && groups.length) {
      body = groups.map((g, gi) => {
        const selCount = g.items.filter(o => selected.includes(o)).length;
        const badge = selCount ? ` <span style="font-size:.75rem;color:var(--caramel);">(${selCount})</span>` : '';
        const gOpen = (U._msOpenGroups || (U._msOpenGroups = new Set())).has(gi);
        return `<details class="ms-group" ${gOpen ? 'open' : ''} ontoggle="U._msGroupToggle(${gi}, this.open, this)"><summary style="cursor:pointer;font-weight:600;font-size:.82rem;padding:4px 0;">${U.esc(g.label)}${badge} <span style="font-size:.7rem;color:var(--gris);">(${g.items.length})</span></summary><div style="padding-left:6px;">${g.items.map(chk).join('')}</div></details>`;
      }).join('');
    } else {
      body = allItems.length ? allItems.map(chk).join('') : '<span class="muted">Aucune variante.</span>';
    }
    return `<details class="multiselect" ${open ? 'open' : ''} ontoggle="${onOpen}(this.open)">
      <summary>${U.esc(label)} ▾</summary>
      <div class="multiselect-panel">
        <div class="frow" style="gap:6px;">
          <button type="button" class="btn-ghost btn-sm" onclick="${setAll}(true)">Tout cocher</button>
          <button type="button" class="btn-ghost btn-sm" onclick="${setAll}(false)">Tout décocher</button>
        </div>
        <hr class="sep">
        ${body}
      </div>
    </details>`;
  },

  /* À appeler APRÈS un re-rendu déclenché par un oninput, en lui passant l'id de l'input.
     App.mount() fait un innerHTML = à chaque rendu : l'input qui vient de déclencher l'événement
     est détaché puis recréé, donc `event.target.focus()` ne fait plus rien (un nœud détaché
     n'est pas focusable) — seule la 1re lettre tapée était prise en compte avant ce correctif.
     Il faut retrouver le nouvel élément (même id) dans le DOM fraîchement recréé et le refocaliser. */
  /* Petite icône ⓘ + bulle d'explication (2026-09-27) : survol = affiche, souris qui part = efface ;
     sur tactile, toucher = ouvre / toucher ailleurs = ferme. Une seule bulle globale (#tipBubble),
     positionnée en fixed et gardée dans l'écran (jamais coupée par un bloc qui défile). */
  info(html) {
    return `<span class="info-tip" tabindex="0" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()" onmouseenter="U.tipShow(this)" onmouseleave="U.tipHide()" onfocus="U.tipShow(this)" onblur="U.tipHide()" onclick="event.preventDefault();event.stopPropagation();U.tipToggle(this)">i<span class="info-src">${html}</span></span>`;
  },
  _tipEl() {
    let b = document.getElementById('tipBubble');
    if (!b) { b = document.createElement('div'); b.id = 'tipBubble'; b.className = 'info-bubble'; document.body.appendChild(b); }
    return b;
  },
  tipShow(el) {
    const b = this._tipEl(), src = el.querySelector('.info-src');
    b.innerHTML = src ? src.innerHTML : ''; b._owner = el; b.classList.add('show');
    const r = el.getBoundingClientRect(), bw = b.offsetWidth, bh = b.offsetHeight, m = 8;
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(m, Math.min(left, window.innerWidth - bw - m));
    let top = r.bottom + 8;
    if (top + bh > window.innerHeight - m && r.top - bh - 8 > m) top = r.top - bh - 8;
    b.style.left = left + 'px'; b.style.top = top + 'px';
  },
  tipHide() { const b = document.getElementById('tipBubble'); if (b) { b.classList.remove('show'); b._owner = null; } },
  tipToggle(el) { const b = document.getElementById('tipBubble'); if (b && b._owner === el && b.classList.contains('show')) this.tipHide(); else this.tipShow(el); },
  refocus(id) {
    const el = document.getElementById(id);
    if (el) { el.focus(); el.setSelectionRange(999, 999); }
  },

  /* Champ autocomplete : liste déroulante filtrée sous un input texte.
     options = liste de chaînes déjà filtrées par l'appelant selon `value`.
     onInput/onPick sont des noms de fonctions globales : onInput(value), onPick(value).
     onClose (optionnel) : nom d'une fonction globale sans argument (ex: "Ventes.closeCatMenu"),
     appelée par le listener de clic extérieur défini plus haut pour refermer la liste. */
  autocomplete({ id, value, placeholder, options, open, onInput, onPick, onClose }) {
    return `<div class="autocomplete" ${onClose ? `data-onclose="${U.esc(onClose)}"` : ''}>
      <input id="${id}" type="text" autocomplete="off" placeholder="${U.esc(placeholder || '')}" value="${U.esc(value || '')}"
        oninput="${onInput}(this.value);U.refocus('${id}')" onfocus="${onInput}(this.value)">
      ${open && options && options.length ? `<div class="ac-list">${options.map(o => `<div class="ac-item" onmousedown="event.preventDefault();${onPick}('${U.esc(o).replace(/&#39;/g, "\\'")}')">${U.esc(o)}</div>`).join('')}</div>` : ''}
    </div>`;
  }
};

document.addEventListener('click', (e) => { if (!e.target.closest || !e.target.closest('.info-tip')) U.tipHide(); });
window.addEventListener('scroll', () => U.tipHide(), true);

/* Aide repliée (2026-09-27) : tout élément marqué class="help" (paragraphe explicatif) est retiré de la page
   et son texte passe dans un ⓘ posé sur le titre le plus proche : data-help-anchor (sélecteur) > libellé parent
   > libellé du champ (.fg) > titre juste avant > dernier titre du bloc (.card, details, fenêtre…). Plusieurs
   aides pour le même titre sont regroupées dans une seule bulle. Marche aussi pour les rendus partiels / fenêtres. */
U._helpAnchor = (el) => {
  const sel = el.getAttribute('data-help-anchor');
  if (sel) {
    // « ~ sélecteur » = cherché dans le bloc de l'aide (fiche repliable, carte, fenêtre), pas dans toute la page
    const a = sel[0] === '~' ? (el.closest('details, .card, .modal') || document).querySelector(sel.slice(1).trim()) : document.querySelector(sel);
    if (a) return a;
  }
  if (el.parentElement && el.parentElement.tagName === 'LABEL') return el.parentElement;
  const fg = el.closest('.fg'); if (fg) { const lb = fg.querySelector(':scope > label'); if (lb && lb !== el) return lb; }
  const prev = el.previousElementSibling;
  if (prev && /^H[1-4]$/.test(prev.tagName)) return prev;
  let box = el.parentElement;
  while (box && box !== document.body) {
    const heads = [...box.querySelectorAll('h1,h2,h3,h4')].filter(h => !el.contains(h) && (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (heads.length) return heads[heads.length - 1];
    if (box.tagName === 'DETAILS') { const sm = box.querySelector(':scope > summary'); if (sm) return sm.querySelector(':scope > span, :scope > b') || sm; }
    box = box.parentElement;
  }
  return null;
};
U.applyHelp = (root) => {
  const list = [...(root || document).querySelectorAll('.help')];
  if (root && root.classList && root.classList.contains('help')) list.unshift(root);
  list.forEach(el => {
    if (!el.isConnected || el._helpDone) return;
    el._helpDone = true;
    const html = el.innerHTML.trim().replace(/^—\s*/, '');
    const a = U._helpAnchor(el);
    if (!a) { el.outerHTML = U.info(html); return; }
    const ex = a.querySelector(':scope > .info-tip[data-auto]');
    if (ex) ex.querySelector('.info-src').insertAdjacentHTML('beforeend', '<br><br>' + html);
    else { a.insertAdjacentHTML('beforeend', ' ' + U.info(html).replace('<span class="info-tip"', '<span class="info-tip" data-auto')); }
    el.remove();
  });
};
new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.classList.contains('help') || n.querySelector('.help'))) U.applyHelp(n);
}).observe(document.documentElement, { childList: true, subtree: true });
