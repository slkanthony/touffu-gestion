/* ═══════════ Factures depuis un ticket de vente (Antho 2026-10-20) ═══════════
   Bouton « 🧾 Facture » dans le détail d'une vente (Ventes → Historique des sorties). On repart de zéro : numéro propre à l'appli,
   « F2026-0001 », suite chronologique SANS TROU (le numéro n'est attribué qu'à l'émission, jamais pour un simple aperçu), compteur par année
   (`meta.factureSeq[année]`). Une facture ÉMISE est figée dans la vente (`sale.invoice` = lignes, client et coordonnées du vendeur de ce jour-là) :
   modifier ensuite la vente ou les Paramètres ne change pas la facture. Elle ne se supprime pas (la vente non plus) ; une annulation de vente demande confirmation.
   Non assujetti à la TVA : pas de colonne TVA, mention « TVA non applicable, art. 293 B du CGI » (Pricing.vatMention()). Assujetti : la facture avec TVA n'est PAS
   encore gérée (même TODO que les devis) → l'émission est refusée plutôt que de sortir une facture fausse.
   Sortie : aperçu dans une fenêtre (iframe) + impression / PDF du navigateur. Coordonnées du vendeur : Paramètres → Réglages financiers → Facturation (settings.fa*). */
const Facture = {
  _sid: '', _d: null,
  _sale(id) { return (Store.state.sales || []).find(x => x.id === id) || null; },
  info() {
    const S = Store.state.settings;
    return { name: String(S.faName || '').trim(), legal: String(S.faLegal || '').trim(), address: String(S.faAddress || '').trim(), siret: String(S.faSiret || '').trim(),
      email: String(S.faEmail || '').trim(), phone: String(S.faPhone || '').trim(), terms: String(S.faTerms || '').trim(), penalties: String(S.faPenalties || '').trim(), note: String(S.faNote || '').trim() };
  },
  missing() { const i = this.info(); return [!i.name && 'ton nom', !i.address && 'ton adresse', !i.siret && 'ton SIRET'].filter(Boolean); },
  _fmt(y, n) { return 'F' + y + '-' + String(n).padStart(4, '0'); },
  peek() { const y = new Date().getFullYear(), m = Store.state.meta.factureSeq || {}; return this._fmt(y, (m[y] || 0) + 1); },
  assign() { const y = new Date().getFullYear(), m = Store.state.meta; m.factureSeq = m.factureSeq || {}; m.factureSeq[y] = (m.factureSeq[y] || 0) + 1; return this._fmt(y, m.factureSeq[y]); },
  _iso(ts) { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  _payTxt(s) { return { cash: 'espèces', stripe: 'carte bancaire (paiement en ligne)', virement: 'virement', sumup: 'carte bancaire' }[s.payment] || ''; },
  /* Lignes facturables d'une vente : sans les lignes internes (carte de remerciement, étiquette d'envoi…) ; livraison facturée au client en dernière ligne. */
  _lines(s) {
    const L = (s.items || []).filter(i => !i.auto && !(i.kind === 'C' && !U.num(i.price)) && U.num(i.qty) > 0).map(i => {
      const pk = U.num(i.pack) >= 2 ? U.num(i.pack) : 0;
      return { name: i.name, label: pk ? ('Lot de ' + pk + (i.label ? ' · ' + i.label : '')) : (i.kind === 'A' ? '' : (i.label || '')), det: i.det || [], qty: pk ? (U.num(i.packs) || U.num(i.qty) / pk) : U.num(i.qty), price: pk ? U.num(i.price) * pk : U.num(i.price) };
    });
    if (s.delivery === 'livraison' && s.shippingChargedToCustomer && U.num(s.shippingFeeCollected) > 0) L.push({ name: 'Frais de livraison', label: '', det: [], qty: 1, price: U.num(s.shippingFeeCollected) });
    if (U.num(s.balanceApplied) < 0) L.push({ name: 'Solde antérieur réglé', label: '', det: [], qty: 1, price: -U.num(s.balanceApplied) });
    return L;
  },
  /* Facture (émise ou à l'état d'aperçu) à partir de la vente et du brouillon du formulaire. */
  _inv(s) {
    const d = this._d, lines = this._lines(s), sum = lines.reduce((a, l) => a + Math.round(l.qty * l.price * 100) / 100, 0), credit = U.num(s.balanceApplied) > 0 ? U.num(s.balanceApplied) : 0;
    return { no: this.peek(), date: U.today(), saleDate: this._iso(s.ts), seller: this.info(),
      client: { name: String(d.name || '').trim(), address: String(d.address || '').trim(), siret: String(d.siret || '').trim(), email: String(d.email || '').trim() },
      lines, total: Math.round(sum * 100) / 100, credit, due: Math.round((sum - credit) * 100) / 100,
      paid: !!d.paid, paidMode: String(d.paidMode || '').trim(), paidDate: d.paidDate || this._iso(s.ts), pro: !!s.pro || !!String(d.siret || '').trim() };
  },
  /* Document complet (A4, noir sur blanc) — même HTML pour l'aperçu et l'impression. */
  html(inv) {
    const e = U.esc, eur = n => U.eur(n), nl = t => e(t).replace(/\n/g, '<br>'), sl = inv.seller || {}, cl = inv.client || {};
    const rows = inv.lines.map(l => `<tr><td><b>${e(l.name)}</b>${l.label ? ' — ' + e(l.label) : ''}${l.det && l.det.length ? `<div class="det">${l.det.map(e).join('<br>')}</div>` : ''}</td><td class="n">${U.qty(l.qty)}</td><td class="n">${eur(l.price)}</td><td class="n">${eur(Math.round(l.qty * l.price * 100) / 100)}</td></tr>`).join('');
    const S = Store.state.settings, iban = String(S.payIban || '').trim(), holder = String(S.payHolder || '').trim(), bic = String(S.payBic || '').trim();
    const pay = inv.paid
      ? `<p><b>Facture acquittée</b> — réglée le ${U.frDate(inv.paidDate)}${inv.paidMode ? ' par ' + e(inv.paidMode) : ''}.</p>`
      : `<p><b>Reste à régler : ${eur(inv.due)}</b>${sl.terms ? ' — ' + e(sl.terms) : ''}</p>${iban ? `<p>Par virement : ${holder ? e(holder) + ' · ' : ''}IBAN ${e(iban)}${bic ? ' · BIC ' + e(bic) : ''}<br>Merci d'indiquer le n° de facture en libellé.</p>` : ''}`;
    const mentions = [Pricing.vatMention(), inv.pro && sl.penalties ? sl.penalties : '', sl.note].filter(Boolean);
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Facture ${e(inv.no)}</title><style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 18px 22px; font: 13px/1.45 "Segoe UI", Arial, sans-serif; color: #111; background: #fff; }
      .top { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
      .top h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: .02em; }
      .seller b.nm { font-size: 15px; }
      .meta { text-align: right; }
      .cl { margin: 22px 0 18px 45%; padding: 10px 14px; border: 1px solid #bbb; border-radius: 6px; }
      .cl .t { font-size: 11px; text-transform: uppercase; color: #666; letter-spacing: .05em; }
      table { width: 100%; border-collapse: collapse; margin-top: 6px; }
      th { background: #eceef0; text-align: left; padding: 7px 8px; font-size: 12px; }
      td { padding: 7px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
      .n { text-align: right; white-space: nowrap; }
      th.n { text-align: right; }
      .det { font-size: 12px; color: #444; margin-top: 2px; line-height: 1.35; }
      .tot { margin: 14px 0 0 auto; width: 46%; }
      .tot div { display: flex; justify-content: space-between; padding: 4px 8px; }
      .tot .g { background: #eceef0; font-weight: 700; font-size: 15px; }
      .pay { margin-top: 18px; }
      .pay p { margin: 4px 0; }
      .legal { margin-top: 22px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 11px; color: #444; }
      .legal p { margin: 3px 0; }
      @media screen and (max-width: 560px) { body { padding: 12px; font-size: 12px; } .top { flex-direction: column; gap: 10px; } .meta { text-align: left; } .top h1 { font-size: 18px; } .cl { margin-left: 0; } .tot { width: 100%; } }   /* aperçu sur téléphone ; l'impression A4 ne change pas */
    </style></head><body>
      <div class="top">
        <div class="seller"><b class="nm">${e(sl.name || '')}</b>${sl.legal ? '<br>' + e(sl.legal) : ''}<br>${nl(sl.address || '')}${sl.siret ? '<br>SIRET : ' + e(sl.siret) : ''}${sl.email ? '<br>' + e(sl.email) : ''}${sl.phone ? ' · ' + e(sl.phone) : ''}</div>
        <div class="meta"><h1>FACTURE N° ${e(inv.no)}</h1>Date : ${U.frDate(inv.date)}<br>Date de la vente : ${U.frDate(inv.saleDate)}</div>
      </div>
      <div class="cl"><div class="t">Facturé à</div><b>${e(cl.name || '')}</b>${cl.address ? '<br>' + nl(cl.address) : ''}${cl.siret ? '<br>SIRET : ' + e(cl.siret) : ''}${cl.email ? '<br>' + e(cl.email) : ''}</div>
      <table><thead><tr><th>Désignation</th><th class="n">Quantité</th><th class="n">Prix unitaire</th><th class="n">Montant</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot">
        ${inv.credit > 0 ? `<div><span>Total</span><span>${eur(inv.total)}</span></div><div><span>Avoir déduit</span><span>− ${eur(inv.credit)}</span></div>` : ''}
        <div class="g"><span>${inv.credit > 0 ? 'Net à payer' : 'Total'}</span><span>${eur(inv.due)}</span></div>
      </div>
      <div class="pay">${pay}</div>
      <div class="legal">${mentions.map(m => `<p>${e(m)}</p>`).join('')}</div>
    </body></html>`;
  },

  /* ── Fenêtre ── */
  open(id) {
    const s = this._sale(id); if (!s) return;
    if (s.invoice) { this._show(s, s.invoice); return; }
    if (Pricing.vatActive()) { U.alert('La facture avec TVA (tu es passé « assujetti » dans les Paramètres) n\'est pas encore gérée par l\'appli : je préfère ne pas sortir une facture fausse. À faire en priorité si tu deviens assujetti.', '🧾 Facture'); return; }
    const c = Clients.find(s.customerName) || {};
    this._sid = id;
    this._d = { name: String(s.customerName || '').trim(), address: c.address || '', siret: c.siret || '', email: c.email || '', paid: true, paidMode: this._payTxt(s), paidDate: this._iso(s.ts) };
    const miss = this.missing(), fld = (label, k, ph, tag) => `<div class="fg" style="margin:0;"><label style="white-space:nowrap;">${label}</label>${tag === 'ta' ? `<textarea rows="3" style="width:100%;" placeholder="${ph}" oninput="Facture._set('${k}',this.value)">${U.esc(this._d[k])}</textarea>` : `<input type="text" style="width:100%;" value="${U.esc(this._d[k])}" placeholder="${ph}" oninput="Facture._set('${k}',this.value)">`}</div>`;
    const body = `${miss.length ? `<div class="badge warn" style="white-space:normal;margin-bottom:10px;">⚠️ Il manque ${miss.join(', ')} dans <a href="#/params" onclick="U.closeModal()">Paramètres → Réglages financiers → Facturation</a> : impossible d'émettre tant que ce n'est pas rempli.</div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px 12px;">
        ${fld('Client', 'name', 'nom ou entreprise')}${fld('SIRET (si entreprise)', 'siret', '14 chiffres — option')}${fld('Adresse', 'address', 'n°, rue, code postal, ville', 'ta')}${fld('Email', 'email', 'option')}
        <div class="fg" style="margin:0;"><label style="white-space:nowrap;">Règlement</label><label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" checked onchange="Facture._set('paid',this.checked)"> Déjà payée</label>${fld('Payée par', 'paidMode', 'carte, virement…')}</div>
      </div>
      <iframe id="fa_frame" style="width:100%;height:46vh;margin-top:12px;border:1px solid var(--card-border);border-radius:8px;background:#fff;"></iframe>
      <p class="muted" style="margin:6px 0 0;font-size:.82rem;">Aperçu : le n° ${U.esc(this.peek())} n'est attribué qu'à l'émission, puis la facture ne se modifie plus.</p>`;
    U.modal({ title: '🧾 Facture — ' + U.esc(U.frDateTime(s.ts)), body, wide: true, okLabel: '✅ Émettre la facture', onOk: () => { Facture.issue(); return false; } });
    this._refresh();
  },
  _set(k, v) { this._d[k] = v; clearTimeout(this._t); this._t = setTimeout(() => this._refresh(), 250); },
  _refresh() { const f = document.getElementById('fa_frame'), s = this._sale(this._sid); if (f && s) f.srcdoc = this.html(this._inv(s)); },
  _show(s, inv) {
    this._sid = s.id;
    U.modal({ title: '🧾 Facture ' + U.esc(inv.no), wide: true, okLabel: '🖨 Imprimer / PDF', onOk: () => { Facture.print(); return false; },
      body: `<iframe id="fa_frame" style="width:100%;height:62vh;border:1px solid var(--card-border);border-radius:8px;background:#fff;"></iframe><p class="muted" style="margin:6px 0 0;font-size:.82rem;">Facture émise le ${U.frDate(inv.date)} — elle ne peut plus être modifiée. « Imprimer / PDF » : choisis « Enregistrer au format PDF » pour l'envoyer par email.</p>` });
    document.getElementById('fa_frame').srcdoc = this.html(inv);
  },
  print() { const f = document.getElementById('fa_frame'); if (f && f.contentWindow) { f.contentWindow.focus(); f.contentWindow.print(); } },
  async issue() {
    const s = this._sale(this._sid); if (!s || s.invoice) return;
    const miss = this.missing(); if (miss.length) { U.toast('Il manque ' + miss.join(', ') + ' dans les Paramètres (Facturation).', true); return; }
    if (!String(this._d.name || '').trim()) { U.toast('Indique le nom du client.', true); return; }
    if (!this._lines(s).length) { U.toast('Aucune ligne à facturer.', true); return; }
    const inv = this._inv(s);
    if (!await U.confirm(`Émettre la facture ${inv.no} pour ${inv.client.name} (${U.eur(inv.due)}) ? Une fois émise, elle ne peut plus être modifiée ni supprimée.`, { okLabel: 'Émettre' })) return;
    inv.no = this.assign(); inv.ts = Date.now();
    s.invoice = inv;
    const c = Clients.find(inv.client.name);   // coordonnées gardées pour la prochaine facture de ce client
    if (c) { if (inv.client.address) c.address = inv.client.address; if (inv.client.siret) c.siret = inv.client.siret; if (inv.client.email && !c.email) c.email = inv.client.email; Store.save('clients'); }
    Store.log('facture', `Facture ${inv.no} — ${inv.client.name} — ${U.eur(inv.due)}`);
    Store.save('sales', 'meta');
    this._show(s, inv);
    if (typeof Ventes !== 'undefined' && /^#\/ventes/.test(location.hash)) Ventes.render();
    U.toast('Facture ' + inv.no + ' émise.');
  }
};
