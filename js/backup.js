/* ═══════════ Sauvegarde hebdomadaire HORS Supabase (2026-11-16, audit A3) ═══════════
   Les instantanés quotidiens vivent dans le même projet Supabase que les données : si le projet tombe, tout tombe.
   Ici : une fois par semaine, à l'ouverture de l'appli (admin), la sauvegarde complète (même fichier que Paramètres → « Exporter la sauvegarde »)
   est écrite dans un DOSSIER DE L'ORDINATEUR choisi une fois par Antho (Documents\Touffu\Sauvegarde\Touffu Gestion).
   · Dossier : API « File System Access » (Chrome / Edge sur ordinateur, adresse https ou localhost seulement). Le dossier choisi est mémorisé
     dans IndexedDB (propre à ce navigateur). Ailleurs (téléphone, adresse http locale, Firefox) : téléchargement classique.
   · Date de la dernière sauvegarde externe : `meta.extBackup = { day, where }` (partagée entre appareils → l'alerte du Tableau de bord est la même partout).
   · Ménage du dossier : on garde les 12 dernières + la première de chaque mois ; seuls les fichiers `touffu-sauvegarde-AAAA-MM-JJ.json` sont concernés.
   Réservé à l'admin. Aucune donnée ne part ailleurs que sur le disque de l'ordinateur. */
const Backup = {
  EVERY: 7,          // jours entre deux sauvegardes
  KEEP: 12,          // sauvegardes récentes gardées (au-delà : seulement la première de chaque mois)
  RE: /^touffu-sauvegarde-(\d{4}-\d{2}-\d{2})\.json$/,
  _dir: null,        // dossier choisi (FileSystemDirectoryHandle), relu depuis IndexedDB
  _busy: false,

  allowed() { return !!(window.App && !App.isViewer && !App.isTeam); },
  supported() { return typeof window.showDirectoryPicker === 'function' && window.isSecureContext; },
  last() { return (Store.state.meta && Store.state.meta.extBackup) || null; },
  /* nombre de jours depuis la dernière sauvegarde externe (null = jamais) */
  age() { const l = this.last(); return l && l.day ? -U.daysTo(l.day) : null; },
  due() { const a = this.age(); return a === null || a >= this.EVERY; },
  fileName(day) { return `touffu-sauvegarde-${day || U.today()}.json`; },
  dump() {
    const d = { app: 'touffu-gestion', version: 1, exportedAt: new Date().toISOString() };
    Store.DOMAINS.forEach(k => d[k] = Store.state[k]);
    return JSON.stringify(d, null, 2);
  },
  mark(where) { const m = Store.state.meta || (Store.state.meta = {}); m.extBackup = { day: U.today(), where }; Store.save('meta'); },

  /* ---------- mémoire du dossier (IndexedDB : un « handle » de dossier ne se range pas dans localStorage) ---------- */
  _db() {
    return new Promise((ok, ko) => {
      const r = indexedDB.open('touffu_backup', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
    });
  },
  async _get() { const db = await this._db(); return new Promise((ok, ko) => { const q = db.transaction('kv').objectStore('kv').get('dir'); q.onsuccess = () => ok(q.result || null); q.onerror = () => ko(q.error); }); },
  async _set(h) { const db = await this._db(); return new Promise((ok, ko) => { const t = db.transaction('kv', 'readwrite'); if (h) t.objectStore('kv').put(h, 'dir'); else t.objectStore('kv').delete('dir'); t.oncomplete = () => ok(); t.onerror = () => ko(t.error); }); },
  async loadDir() {
    if (this._dir || !this.supported()) return this._dir;
    try { this._dir = await this._get(); } catch (e) { console.warn('sauvegarde : dossier illisible', e); }
    return this._dir;
  },
  /* 'granted' = on peut écrire sans rien demander ; 'prompt' = le navigateur redemandera (il faut un clic) */
  async _perm(ask) {
    if (!this._dir) return 'none';
    const o = { mode: 'readwrite' };
    let p = this._dir.queryPermission ? await this._dir.queryPermission(o) : 'granted';
    if (p !== 'granted' && ask && this._dir.requestPermission) p = await this._dir.requestPermission(o);
    return p;
  },

  /* ---------- actions ---------- */
  async chooseDir() {
    if (!this.supported()) { U.alert('Le dossier dédié fonctionne seulement sur ordinateur, avec Chrome ou Edge, par l\'adresse https de l\'appli. Ici, la sauvegarde se télécharge dans « Téléchargements ».'); return; }
    let h;
    try { h = await window.showDirectoryPicker({ id: 'touffu-sauvegarde', mode: 'readwrite', startIn: 'documents' }); }
    catch (e) { return; }   // fenêtre de choix fermée : rien ne change
    this._dir = h;
    try { await this._set(h); } catch (e) { console.warn(e); }
    await this.run(true);
  },
  async forgetDir() {
    if (!await U.confirm('Ne plus ranger les sauvegardes dans ce dossier ? Les fichiers déjà enregistrés ne sont pas supprimés.', { okLabel: 'Oublier le dossier' })) return;
    this._dir = null; try { await this._set(null); } catch (e) { console.warn(e); }
    this.refresh();
  },
  /* Écrit la sauvegarde du jour. `manual` = déclenché par un clic (le navigateur accepte alors de redemander l'autorisation, ou de télécharger). */
  async run(manual) {
    if (!this.allowed() || this._busy) return false;
    this._busy = true;
    try {
      await this.loadDir();
      if (this._dir) {
        const p = await this._perm(manual);
        if (p === 'granted') {
          const name = this.fileName(), fh = await this._dir.getFileHandle(name, { create: true }), w = await fh.createWritable();
          await w.write(this.dump()); await w.close();
          const removed = await this.prune();
          this.mark('dossier');
          U.toast(`Sauvegarde de la semaine rangée dans « ${this._dir.name} »` + (removed ? ` (${removed} ancienne(s) retirée(s)).` : '.'));
          this.refresh(); return true;
        }
        if (!manual) { this.refresh(); return false; }   // autorisation à redonner : l'alerte du Tableau de bord propose le bouton
        U.toast('Autorisation refusée : la sauvegarde n\'a pas été écrite dans le dossier.', true); return false;
      }
      if (!manual) { this.refresh(); return false; }     // pas de dossier : pas de téléchargement sans clic
      U.download(this.fileName(), this.dump());
      this.mark('telechargements');
      U.toast('Sauvegarde téléchargée (dossier « Téléchargements »).');
      this.refresh(); return true;
    } catch (e) {
      console.error(e); U.toast('Sauvegarde impossible : ' + (e.message || e), true); return false;
    } finally { this._busy = false; }
  },
  /* Ménage : garde les KEEP plus récentes ; parmi les plus anciennes, seulement la première de chaque mois. Renvoie le nombre de fichiers retirés. */
  pruneList(names) {
    const days = names.map(n => (n.match(this.RE) || [])[1]).filter(Boolean).sort().reverse();   // plus récent d'abord
    const old = days.slice(this.KEEP), firstOf = {};
    old.forEach(d => { const k = d.slice(0, 7); if (!firstOf[k] || d < firstOf[k]) firstOf[k] = d; });
    return old.filter(d => firstOf[d.slice(0, 7)] !== d).map(d => this.fileName(d));
  },
  async prune() {
    const names = [];
    for await (const e of this._dir.values()) if (e.kind === 'file' && this.RE.test(e.name)) names.push(e.name);
    const del = this.pruneList(names);
    for (const n of del) await this._dir.removeEntry(n);
    return del.length;
  },
  /* À l'ouverture de l'appli (admin) : sauvegarde silencieuse si elle est due et que le dossier est accessible. */
  async auto() {
    if (!this.allowed()) return;
    await this.loadDir();
    if (this.due() && !Store._modalOpen()) await this.run(false); else this.refresh();
  },
  refresh() {
    const v = window.App && App.current;
    if ((v === 'dashboard' || v === 'params') && !Store._modalOpen() && App.rerender) App.rerender();
  },

  /* ---------- affichage ---------- */
  lastTxt() {
    const l = this.last(); if (!l || !l.day) return 'jamais';
    const a = this.age();
    return U.frDate(l.day) + (a === 0 ? ' (aujourd\'hui)' : a === 1 ? ' (hier)' : ` (il y a ${a} jours)`) + (l.where === 'dossier' ? ', dans ton dossier' : ', dans Téléchargements');
  },
  /* Alerte du Tableau de bord : seulement quand la sauvegarde de la semaine n'a pas pu se faire toute seule. */
  dashAlert() {
    if (!this.allowed() || !this.due()) return '';
    const a = this.age(), txt = a === null ? 'Aucune sauvegarde hors Supabase pour l\'instant.' : `Dernière sauvegarde hors Supabase : il y a ${a} jours.`;
    const need = !this._dir && this.supported();
    return `<div class="card bk-alert"><span class="warn-txt">${txt}</span>
      <span class="bk-actions">${need ? '<button class="btn-ghost btn-sm" onclick="Backup.chooseDir()">Choisir mon dossier</button>' : ''}<button class="btn-cta btn-sm" onclick="Backup.run(true)">Sauvegarder maintenant</button></span></div>`;
  },
  /* Bloc de Paramètres → Import / export */
  paramsBlock() {
    if (!this.allowed()) return '';
    const dir = this._dir ? `<b>${U.esc(this._dir.name)}</b>` : this.supported() ? 'aucun (la sauvegarde va dans « Téléchargements »)' : 'indisponible sur cet appareil (la sauvegarde va dans « Téléchargements »)';
    return `<hr class="sep"><h3 class="bk-title">Sauvegarde automatique de la semaine <span class="muted help">Une fois par semaine, à l'ouverture de l'appli sur cet ordinateur, la sauvegarde complète est rangée toute seule dans le dossier choisi (conseil : Documents, Touffu, Sauvegarde, Touffu Gestion). Elle est gardée hors de Supabase : si la base tombe, tes données sont chez toi. Les 12 dernières sont gardées, puis une par mois. Le dossier se choisit une fois par ordinateur, avec Chrome ou Edge et l'adresse https.</span></h3>
      <p class="mb0">Dossier : ${dir}</p><p class="mb0">Dernière sauvegarde : ${this.lastTxt()}</p>
      <div class="frow bk-row mt">${this.supported() ? `<button class="btn-ghost fit" onclick="Backup.chooseDir()">${this._dir ? 'Changer de dossier' : 'Choisir mon dossier'}</button>` : ''}<button class="btn-cta fit" onclick="Backup.run(true)">Sauvegarder maintenant</button>${this._dir ? '<button class="btn-ghost fit" onclick="Backup.forgetDir()">Oublier le dossier</button>' : ''}</div>`;
  }
};
