/* ═══════════ Poids des variantes (2026-10-02) ═══════════
   Poids d'une variante (g) : v.wAvg (+ v.wMin / v.wMax) saisis dans « Modifier la variante » ; sinon calculé :
     - variante au poids (mode 'gram') = sa valeur ; déclinaison « lot de N » = N × la variante de référence ;
     - sinon poids moyen par pièce du dernier tri terminé de ce produit (page Achats).
   (L'estimation du poids / du coût d'un colis Boxtal a été retirée le 2026-10-02 à la demande d'Antho : le poids des cartons et des
   sachets varie trop, les tarifs se consultent sur Boxtal.) Ce poids sert à documenter les produits (site, statistiques à venir). */
const Ship = {
  /* { avg, min, max, src } en grammes, ou null si inconnu */
  variantW(p, v, depth) {
    if (!p || !v || (depth || 0) > 2) return null;
    if (U.num(v.wAvg) > 0) { const a = U.num(v.wAvg); return { avg: a, min: U.num(v.wMin) > 0 ? U.num(v.wMin) : a, max: U.num(v.wMax) > 0 ? U.num(v.wMax) : a, src: 'fiche' }; }
    if (v.mode === 'gram' && U.num(v.value) > 0) { const g = U.num(v.value); return { avg: g, min: g, max: g, src: 'poids' }; }
    if (v.parentId && U.num(v.packQty) >= 2) {
      const par = (p.variants || []).find(x => x.id === v.parentId), w = this.variantW(p, par, (depth || 0) + 1), n = U.num(v.packQty);
      if (w) return { avg: w.avg * n, min: w.min * n, max: w.max * n, src: 'lot' };
    }
    const pc = typeof Achats !== 'undefined' ? Achats.avgPieceG(p.id) : 0;
    if (pc > 0 && v.mode !== 'vrac') { const n = v.mode === 'piece' && U.num(v.value) > 0 ? U.num(v.value) : 1; return { avg: pc * n, min: pc * n * 0.85, max: pc * n * 1.15, src: 'tri' }; }
    return null;
  }
};
