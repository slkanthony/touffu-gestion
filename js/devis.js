/* ═══════════ Numéros de devis (2026-10-02) ═══════════
   Format AAMMJJ-N + lettre de version : « 261002-1A » = 1er devis du 02/10/2026, version A ; modifié → « 261002-1B », puis C…
   (N = compteur du jour : deux devis le même jour n'ont jamais le même numéro ; les numéros ne sont jamais réutilisés.)
   Règles (validées par Antho) :
   - le numéro est attribué quand le devis sort réellement de l'application (copie de l'image / du texte, mise en attente) ;
   - la lettre ne change QUE si le contenu a vraiment été modifié depuis la dernière version sortie (comparaison par empreinte) —
     « reprendre » sans rien changer garde la même lettre ;
   - on ne garde que la dernière version ; la lettre dit combien de fois il a été modifié ;
   - avant la sortie, l'écran affiche le numéro PRÉVU (pas de numéro gaspillé par de simples essais).
   État d'un devis : { base: '261002-1', rev: 1, hash: '…' }. Compteur : Store.state.meta.devisSeq[AAMMJJ]. */
const Devis = {
  ymd(d) { const x = d || new Date(); return String(x.getFullYear()).slice(2) + String(x.getMonth() + 1).padStart(2, '0') + String(x.getDate()).padStart(2, '0'); },
  peek() { const k = this.ymd(), m = Store.state.meta.devisSeq || {}; return k + '-' + ((m[k] || 0) + 1); },
  assign() { const k = this.ymd(), m = Store.state.meta; m.devisSeq = m.devisSeq || {}; m.devisSeq[k] = (m.devisSeq[k] || 0) + 1; Store.save('meta'); return k + '-' + m.devisSeq[k]; },
  letter(n) { let s = '', i = Math.max(1, Math.floor(n) || 1); while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; },
  hash(o) { const s = JSON.stringify(o); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); },
  blank(pre) { return { base: '', rev: 0, hash: '', pre: pre || '' }; },   // pre : préfixe du numéro (« P » = devis pro, 2026-10-03)
  /* numéro à AFFICHER : prévu tant que rien n'est sorti ; lettre suivante si le contenu a changé depuis la dernière sortie */
  show(st, h) { const p = (st && st.pre) || ''; if (!st || !st.base) return p + this.peek() + this.letter(1); return p + st.base + this.letter(h !== st.hash ? st.rev + 1 : st.rev); },
  /* à la SORTIE du devis (copie, mise en attente) : attribue / fait avancer la lettre, renvoie le numéro final */
  commit(st, h) {
    if (!st.base) { st.base = this.assign(); st.rev = 1; st.hash = h; }
    else if (h !== st.hash) { st.rev++; st.hash = h; }
    return (st.pre || '') + st.base + this.letter(st.rev);
  },
  no(st) { return st && st.base ? (st.pre || '') + st.base + this.letter(st.rev) : ''; }
};
