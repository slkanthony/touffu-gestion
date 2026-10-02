/* ═══════════ Expédition : poids estimé d'un colis → tranche et prix (Boxtal / Mondial Relay) — 2026-10-02 ═══════════
   Poids d'une variante (g) : v.wAvg (+ v.wMin / v.wMax) saisis dans « Modifier la variante » ; sinon calculé :
     - variante au poids (mode 'gram') = sa valeur ; déclinaison « lot de N » = N × la variante de référence ;
     - sinon poids moyen par pièce du dernier tri terminé de ce produit (page Achats).
   Colis = Σ quantité × poids + carton habituel + poids d'un sachet par article (Paramètres → Expédition).
   Grille = settings.shipTiers [{maxG, priceHT}] (jusqu'à maxG grammes). Tu paies TTC et tu ne récupères pas la TVA → coût réel = HT × (1 + TVA).
   C'est une ESTIMATION (produits naturels) : si la fourchette chevauche deux tranches, on le dit → à peser. */
const Ship = {
  tiers() {
    const t = (Store.state.settings.shipTiers || []).map(x => ({ maxG: U.num(x.maxG), priceHT: U.num(x.priceHT) })).filter(x => x.maxG > 0);
    return t.sort((a, b) => a.maxG - b.maxG);
  },
  tierFor(g) { const t = this.tiers(); return t.find(x => g <= x.maxG) || t[t.length - 1] || null; },
  tierLabel(t) {
    const all = this.tiers(), i = all.findIndex(x => x.maxG === t.maxG), from = i > 0 ? all[i - 1].maxG : 0;
    const kg = g => g >= 1000 ? U.qty(g / 1000) + ' kg' : U.qty(g) + ' g';
    return (from ? 'de ' + kg(from) + ' à ' : 'jusqu\'à ') + kg(t.maxG);
  },
  ttc(ht) { return U.num(ht) * (1 + U.num(Store.state.settings.vatRate ?? 20) / 100); },
  fmtG(g) { return g >= 1000 ? U.qty(Math.round(g / 10) / 100) + ' kg' : Math.round(g) + ' g'; },

  /* Poids d'une variante : { avg, min, max, src } en grammes, ou null si inconnu */
  variantW(p, v, depth) {
    if (!p || !v || (depth || 0) > 2) return null;
    if (U.num(v.wAvg) > 0) { const a = U.num(v.wAvg); return { avg: a, min: U.num(v.wMin) > 0 ? U.num(v.wMin) : a, max: U.num(v.wMax) > 0 ? U.num(v.wMax) : a, src: 'fiche' }; }
    if (v.mode === 'gram' && U.num(v.value) > 0) { const g = U.num(v.value); return { avg: g, min: g, max: g, src: 'poids' }; }
    if (v.parentId && U.num(v.packQty) >= 2) {
      const par = (p.variants || []).find(x => x.id === v.parentId), w = this.variantW(p, par, (depth || 0) + 1), n = U.num(v.packQty);
      if (w) return { avg: w.avg * n, min: w.min * n, max: w.max * n, src: 'lot' };
    }
    const pc = typeof Achats !== 'undefined' ? Achats.avgPieceG(p.id) : 0;
    if (pc > 0 && v.mode !== 'vrac') { const n = v.mode === 'piece' && U.num(v.value) > 0 ? U.num(v.value) : 1; return { avg: pc * n, min: pc * n * 0.85, max: pc * n * 1.15, src: 'tri' }; }   // moyenne d'un lot : fourchette ±15 % par défaut
    return null;
  },

  /* lines = [{ pId, vId, qty }] */
  estimate(lines) {
    const S = Store.state.settings, missing = []; let avg = 0, min = 0, max = 0, n = 0, known = 0;
    (lines || []).forEach(l => {
      const q = U.num(l.qty); if (!(q > 0)) return;
      const p = (Store.state.stockM || []).find(x => x.id === l.pId), v = p && (p.variants || []).find(x => x.id === l.vId);
      n += q;
      const w = this.variantW(p, v);
      if (!w) { missing.push(p ? p.name + (v ? ' ' + Pricing.labelVariant(v) : '') : '?'); return; }
      known++; avg += q * w.avg; min += q * w.min; max += q * w.max;
    });
    if (!n) return null;
    const pack = U.num(S.shipBoxG) + U.num(S.shipBagG) * n;
    avg += pack; min += pack; max += pack;
    const t = this.tierFor(avg), tmin = this.tierFor(min), tmax = this.tierFor(max);
    return { avg, min, max, n, known, missing, pack, t, tmin, tmax, cross: !!(tmin && tmax && tmin.maxG !== tmax.maxG), complete: !missing.length && known > 0, ttc: t ? this.ttc(t.priceHT) : 0 };
  },
  /* Ligne d'information (interne : jamais sur le devis du client) */
  html(est) {
    if (!est) return '';
    if (!est.known) return `<div class="muted" style="font-size:.85rem;">📦 Poids du colis : aucun poids renseigné sur ces produits (Stock → ✏️ Modifier la variante → poids).</div>`;
    const eur = v => U.eur(v);
    return `<div style="font-size:.88rem;line-height:1.5;">📦 <b>Colis estimé : ${this.fmtG(est.avg)}</b> <span class="muted">(${Math.round(est.min) === Math.round(est.max) ? '' : this.fmtG(est.min) + ' à ' + this.fmtG(est.max) + ', '}${est.pack ? 'emballage compris' : 'sans emballage'})</span> → tranche ${est.t ? this.tierLabel(est.t) : '?'} → <b>${eur(est.ttc)} TTC</b> <span class="muted">(${eur(est.t ? est.t.priceHT : 0)} HT)</span>
      ${est.cross ? `<div class="warn-txt">⚠️ La fourchette touche deux tranches (${this.tierLabel(est.tmin)} / ${this.tierLabel(est.tmax)} : ${eur(this.ttc(est.tmin.priceHT))} à ${eur(this.ttc(est.tmax.priceHT))} TTC) : pèse le colis.</div>` : ''}
      ${est.missing.length ? `<div class="warn-txt">ℹ️ ${est.missing.length} article(s) sans poids, non comptés : ${est.missing.map(U.esc).join(', ')}.</div>` : ''}</div>`;
  }
};
