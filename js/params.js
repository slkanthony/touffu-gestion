/* ============================================================
   PARAMÈTRES — réglages, référentiels, import/export,
   instantanés restaurables, journal des mouvements.
   ============================================================ */
const Params = {
  _sachetsOpen: false,
  _abbrevOpen: false,
  _matAbbrevOpen: false,
  _consoAbbrevOpen: false,
  _varPresetsOpen: false,
  _financeOpen: false,
  _refsOpen: false,
  _fabOpen: false,
  _skuOpen: false,
  _importOpen: false,
  _varFilter: null,
  render() {
    const S = Store.state.settings;
    const vp = S.variantPresets || { gram: [], piece: [], size: [] };
    // Ordre déplaçable des blocs de Réglages financiers (↑↓). Stocké dans S.finOrder ; les blocs absents/nouveaux sont ajoutés à la fin.
    const finDef = ['general', 'amort', 'masti', 'acc', 'conso', 'paniers', 'events'];
    let finOrder = Array.isArray(S.finOrder) ? S.finOrder.filter(k => finDef.includes(k)) : [];
    finDef.forEach(k => { if (!finOrder.includes(k)) finOrder.push(k); });
    const finPos = k => finOrder.indexOf(k);
    const finTools = k => `<div style="text-align:right;margin-bottom:2px;"><button class="btn btn-ghost btn-sm" title="Monter ce bloc" onclick="Params.moveFin('${k}',-1)" ${finPos(k) === 0 ? 'disabled' : ''}>↑</button> <button class="btn btn-ghost btn-sm" title="Descendre ce bloc" onclick="Params.moveFin('${k}',1)" ${finPos(k) === finOrder.length - 1 ? 'disabled' : ''}>↓</button></div>`;
    App.mount(`
      <div class="view-title" style="justify-content:center;text-align:center;position:relative;">
        <div><h1>Paramètres</h1><span class="sub">réglages, données & sauvegardes</span></div>
        <button class="btn-ghost btn-sm" style="position:absolute;right:0;top:0;flex:0 0 auto;" onclick="Params.toggleTheme()" title="Basculer thème clair / sombre">${Theme.get() === 'dark' ? '☀️ Mode clair' : '🌙 Mode sombre'}</button>
      </div>

      <details class="fold card params-fold" ${this._financeOpen ? 'open' : ''} ontoggle="Params._financeOpen=this.open">
        <summary><h2 style="display:inline;">💶 Réglages financiers</h2></summary>
        <div class="fold-body">
        <div class="fin-blocks" style="display:flex;flex-direction:column;">
        <div class="fin-block" style="order:${finPos('general')}">${finTools('general')}
        <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">Général (commun à tout)</div>
        <div class="grid c3">
          <div class="fg"><label>TVA (%)</label><input id="p_vat" type="number" step="0.1" value="${S.vatRate}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>Commission SumUp (%)</label><input id="p_cb" type="number" step="0.01" value="${S.cardFeeRate}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>Commission Stripe (%)</label><input id="p_stripe" type="number" step="0.01" value="${S.stripeFeeRate}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
        </div>
        <label class="vat-toggle ${S.vatActive ? 'on' : ''}">
          <input type="checkbox" id="p_vatActive" ${S.vatActive ? 'checked' : ''} onchange="Params.toggleVatActive(this.checked)">
          <span class="vat-toggle-txt"><b>Je suis assujetti à la TVA</b> ${U.info("À cocher le jour venu. Les prix TTC affichés ne changent pas ; une fois coché, la TVA cesse d'être comptée comme bénéfice et passe en déduction dans la compta (Stats + Tableau de bord).")} <span class="badge ${S.vatActive ? 'ok' : 'info'}">${S.vatActive ? '✅ ACTIVÉ — TVA reversée (déduite du bénéfice)' : '⚪ DÉSACTIVÉ — TVA conservée dans le bénéfice'}</span></span></label>
        </div>
        <div class="fin-block" style="order:${finPos('amort')}">${finTools('amort')}
        <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">🛠️ Amortissement du matériel (tout l'atelier) ${U.info("Charge fixe de l'atelier (imprimante, extracteur, scelleuse…), déduite du <b>bénéfice net mensuel</b> global (Tableau de bord + Stats, ligne « Entretien matériel »), <b>pas</b> du prix d'un produit.<br><br>⚠️ En micro-entreprise, l'amortissement n'est pas déductible fiscalement : c'est un indicateur pour toi (savoir si l'activité est rentable une fois le matériel payé).<br><br><b>Année d'achat</b> : l'amortissement s'arrête tout seul une fois la durée écoulée.<br><b>Catégorie</b> : sert seulement à ton suivi, le montant reste déduit du bénéfice net global.")}</div>
        ${(() => {
          const items = Pricing.equipItems(); const nowY = new Date().getFullYear();
          const rows = items.map(e => {
            const yrs = U.num(e.years); const by = U.num(e.buyYear);
            const done = by > 0 && nowY >= by + yrs;
            const perYear = yrs > 0 && !done ? U.num(e.price) / yrs : 0;
            const cat = e.category || 'commun';
            return `<div class="frow" style="gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
              <input type="text" value="${U.esc(e.name || '')}" placeholder="Nom (ex : Imprimante UV, Scelleuse…)" style="flex:0 0 auto;width:190px;" onchange="Params.setUvEquip('${e.id}','name',this.value)">
              <select title="À quelle activité sert cet équipement (pour ton suivi — le calcul reste global)" style="flex:0 0 auto;width:130px;" onchange="Params.setUvEquip('${e.id}','category',this.value)">
                <option value="commun" ${cat === 'commun' ? 'selected' : ''}>Commun</option>
                <option value="mastication" ${cat === 'mastication' ? 'selected' : ''}>🥩 Mastication</option>
                <option value="accessoires" ${cat === 'accessoires' ? 'selected' : ''}>🐕 Accessoires</option>
              </select>
              <input type="number" step="1" min="0" value="${U.num(e.price) || ''}" placeholder="prix" title="Prix d'achat (€)" style="flex:0 0 auto;width:90px;text-align:center;" onchange="Params.setUvEquip('${e.id}','price',this.value)"><span class="muted">€ sur</span>
              <input type="number" step="1" min="0" value="${yrs || ''}" placeholder="5" title="Durée d'amortissement (années)" style="flex:0 0 auto;width:56px;text-align:center;" onchange="Params.setUvEquip('${e.id}','years',this.value)"><span class="muted">ans</span>
              <input type="number" step="1" min="2000" value="${by || ''}" placeholder="année achat" title="Année d'achat (facultatif) — arrête l'amortissement une fois le matériel payé" style="flex:0 0 auto;width:100px;text-align:center;" onchange="Params.setUvEquip('${e.id}','buyYear',this.value)">
              <span class="muted" style="min-width:96px;text-align:right;">${done ? '✅ amorti' : (perYear ? '= ' + U.eur(perYear) + '/an' : '—')}</span>
              <button class="btn btn-danger btn-sm" title="Retirer cet équipement" onclick="Params.delUvEquip('${e.id}')">🗑</button>
            </div>`;
          }).join('');
          const total = Pricing.equipAmortAnnual();
          const byCat = { mastication: 0, accessoires: 0, commun: 0 };
          items.forEach(e => { const yrs = U.num(e.years); if (yrs <= 0) return; const by = U.num(e.buyYear); if (by > 0 && nowY >= by + yrs) return; byCat[e.category || 'commun'] += U.num(e.price) / yrs; });
          const catParts = [];
          if (byCat.mastication) catParts.push(`🥩 mastication ${U.eur(byCat.mastication)}`);
          if (byCat.accessoires) catParts.push(`🐕 accessoires ${U.eur(byCat.accessoires)}`);
          if (byCat.commun) catParts.push(`commun ${U.eur(byCat.commun)}`);
          return `${rows || '<p class="muted" style="margin:2px 0;">Aucun équipement — ajoute ton imprimante UV, ton extracteur d\'air, ta scelleuse mastication…</p>'}
          <div style="margin-top:4px;"><button class="btn btn-ghost btn-sm" onclick="Params.addUvEquip()">＋ Ajouter un équipement</button></div>
          <p style="margin:8px 0 0;font-size:1.02rem;">Amortissement total : <b>${U.eur(total)}/an</b> <span class="muted">soit ${U.eur(Pricing.equipAmortMonthly())}/mois${catParts.length ? ' — ' + catParts.join(' · ') : ''}</span></p>`;
        })()}
        </div>

        <div class="fin-block" style="order:${finPos('masti')}">${finTools('masti')}
        <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">🥩 Mastication (achat-revente)</div>
        <div class="grid c3">
          <div class="fg"><label>Cotisations sociales (%) ${U.info('Taux URSSAF de la vente de marchandises (achat-revente) : mastication, et port encaissé.')}</label><input id="p_soc" type="number" step="0.1" value="${S.socialTaxRate}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>Décote paliers (%) ${U.info('Remise appliquée aux gros paliers (poids / lots) par défaut. Réglable aussi fiche par fiche dans Prix mastication.')}</label><input id="p_bulk" type="number" step="1" value="${S.bulkDiscount}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>Seuil coeff critique ${U.info('Sous ce coefficient, un badge « coeff critique » s\'affiche sur Prix mastication et Revente pro (mastication).')}</label><input id="p_thr" type="number" step="0.01" value="${S.b2bCoeffThreshold}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>Alerte DLUO (jours avant) ${U.info('Un lot passe en « proche péremption » ce nombre de jours avant sa DLUO (Stock, Tableau de bord).')}</label><input id="p_dluo" type="number" step="1" value="${S.dluoAlertDays}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
        </div>
        </div>
        <div class="fin-block" style="order:${finPos('acc')}">${finTools('acc')}
        <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">🐕 Accessoires (fait main)</div>
        <div class="grid c3">
          <div class="fg"><label>Taux main d'œuvre (€/h)</label><input id="p_labor" type="number" step="0.5" value="${S.laborRate}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>Cotisations fait main (%) ${U.info(`Les accessoires cousus main relèvent de l'artisanat (BIC prestation de services, 21,2 % par défaut), pas de la vente de marchandises (${U.pct(S.socialTaxRate)} pour la mastication). Utilisé dans le calcul de prix des accessoires et dans le bénéfice net du Tableau de bord.`)}</label><input id="p_soc_hm" type="number" step="0.1" value="${S.socialTaxRateHandmade ?? S.socialTaxRate}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>Seuil coeff critique ${U.info('Sous ce coefficient, un badge « coeff critique » s\'affiche sur la page Accessoires et Revente pro (accessoires).')}</label><input id="p_acc_thr" type="number" step="0.01" value="${S.accCoeffThreshold || 2}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
        </div>

        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin:14px 0 6px;">🖨️ Impression UV</div>
        <div class="frow" style="gap:28px;align-items:flex-end;flex-wrap:wrap;justify-content:center;">
          <div class="fg" style="margin:0;flex:0 0 auto;text-align:center;"><label>Cartouche d'encre — prix / volume</label>
            <div class="cost-split" style="margin:0 auto;"><input id="p_uv_price" type="number" step="0.01" value="${S.uvCartridgePrice ?? 42}" title="Prix de la cartouche (€)" onkeydown="if(event.key==='Enter')Params.saveSettings()"><span class="cost-split-sep">€ /</span><input id="p_uv_vol" type="number" step="1" value="${S.uvCartridgeVolume ?? 100}" title="Volume de la cartouche (ml)" onkeydown="if(event.key==='Enter')Params.saveSettings()"><span class="cost-split-sep">ml</span></div>
          </div>
        </div>
        <p class="muted" style="margin:4px 0 0;text-align:center;">Encre : <b>${U.eur(Pricing.uvInkPerMl())}/ml</b></p>

        <div class="frow" style="gap:28px;align-items:flex-end;flex-wrap:wrap;justify-content:center;margin-top:12px;">
          <div class="fg" style="margin:0;flex:0 0 auto;width:230px;text-align:center;"><label>+ Majoration entretien (%) ${U.info('Pourcentage ajouté au coût de l\'encre pour couvrir filtres, nettoyage et entretien. 0 = encre seule.')}</label><input id="p_uv_maint_pct" type="number" step="1" min="0" value="${U.num(S.uvMaintPct) || ''}" placeholder="0" style="text-align:center;" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
        </div>
        <p style="margin:8px 0 0;text-align:center;font-size:1.02rem;">Coût UV tout compris ${U.info("Renseigne les ml d'encre par accessoire dans sa fiche : le coût d'impression est alors intégré à son coût de revient (donc à sa marge et à son prix). La majoration reste optionnelle.")} : <b>${U.eur(Pricing.uvCostPerMl())}/ml</b> <span class="muted">(encre ${U.eur(Pricing.uvInkPerMl())}${U.num(S.uvMaintPct) ? ` + ${U.pct(U.num(S.uvMaintPct))} entretien = ${U.eur(Pricing.uvMaintPerMl())}` : ''})</span></p>

        ${(() => { const ma = Pricing.uvMaintenanceAnnual(); const _mh = U.num(S.uvMaintHoursPerYear); const _h = Math.floor(_mh); const _min = Math.round((_mh - _h) * 60); return `
        <div style="font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin:16px 0 6px;">🛠️ Entretien imprimante (charges annuelles) ${U.info("Charge fixe de la machine, déduite du <b>bénéfice net mensuel</b> (Tableau de bord → CA par mois, ligne « Entretien matériel »), pas du prix de chaque accessoire.<br><br>Main d'œuvre = temps total sur l'année. L'<b>amortissement</b> du matériel se règle dans « 🛠️ Amortissement du matériel ».")}</div>
        <div class="frow" style="gap:28px;align-items:flex-end;flex-wrap:wrap;justify-content:center;">
          <div class="fg" style="margin:0;flex:0 0 auto;text-align:center;"><label>Filtre — prix × changements/an</label>
            <div class="cost-split" style="margin:0 auto;"><input id="p_uv_filter_price" type="number" step="0.01" min="0" value="${U.num(S.uvFilterPrice) || ''}" placeholder="0" title="Prix d'un filtre (€)" onkeydown="if(event.key==='Enter')Params.saveSettings()"><span class="cost-split-sep">€ ×</span><input id="p_uv_filter_year" type="number" step="1" min="0" value="${U.num(S.uvFilterPerYear) || ''}" placeholder="0" title="Nombre de changements par an" onkeydown="if(event.key==='Enter')Params.saveSettings()"><span class="cost-split-sep">/an</span></div>
          </div>
          <div class="fg" style="margin:0;flex:0 0 auto;text-align:center;"><label>Nettoyage — prix × changements/an</label>
            <div class="cost-split" style="margin:0 auto;"><input id="p_uv_clean_price" type="number" step="0.01" min="0" value="${U.num(S.uvCleanPrice) || ''}" placeholder="0" title="Prix d'une cartouche de nettoyage (€)" onkeydown="if(event.key==='Enter')Params.saveSettings()"><span class="cost-split-sep">€ ×</span><input id="p_uv_clean_year" type="number" step="1" min="0" value="${U.num(S.uvCleanPerYear) || ''}" placeholder="0" title="Nombre de changements par an" onkeydown="if(event.key==='Enter')Params.saveSettings()"><span class="cost-split-sep">/an</span></div>
          </div>
          <div class="fg" style="margin:0;flex:0 0 auto;text-align:center;"><label>Main d'œuvre entretien / an (× ${U.eur(U.num(S.laborRate))}/h)</label>
            <div class="cost-split" style="margin:0 auto;"><input id="p_uv_maint_h" type="number" step="1" min="0" value="${_h || ''}" placeholder="0" title="Heures par an" onkeydown="if(event.key==='Enter')Params.saveSettings()"><span class="cost-split-sep">h</span><input id="p_uv_maint_min" type="number" step="5" min="0" max="59" value="${_min || ''}" placeholder="0" title="Minutes par an (en plus des heures)" onkeydown="if(event.key==='Enter')Params.saveSettings()"><span class="cost-split-sep">min</span></div>
          </div>
        </div>
        <p style="margin:8px 0 0;text-align:center;font-size:1.02rem;">Entretien imprimante : <b>${U.eur(ma.total)}/an</b> <span class="muted">soit ${U.eur(Pricing.uvMaintenanceMonthly())}/mois${ma.total ? ` — filtres ${U.eur(ma.filters)} + nettoyage ${U.eur(ma.clean)} + main d'œuvre ${U.eur(ma.labor)}` : ''}</span></p>`; })()}
        </div>
        <div class="fin-block" style="order:${finPos('conso')}">${finTools('conso')}
        <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">📦 Consommables ${U.info("Chaque fiche prix choisit son type d'étiquette (ex. « Élastique + étiquette » pour les cornes et bois naturels). Changer un coût ici recalcule toutes les fiches qui l'utilisent. Le vrac se règle fiche par fiche avec « Autre montant ».<br><br>● Défaut = type proposé pour les nouvelles fiches.")}</div>
        ${this.labelTypesHTML()}
        </div>
        <div class="fin-block" style="order:${finPos('paniers')}">${finTools('paniers')}
        <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">🛒 Paniers & livraison</div>
        <div class="grid c3">
          <div class="fg"><label>Frais de livraison facturés au client (€)</label><input id="p_shipping" type="number" step="0.01" value="${S.shippingCost ?? 6.8}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>Seuil livraison offerte (€) ${U.info("Sous ce seuil, une vente en ligne livrée est considérée comme facturée au client (frais ci-contre) ; au-dessus, offerte (à ta charge). Modifiable au cas par cas sur chaque vente dans l'historique des sorties.")}</label><input id="p_freethr" type="number" step="1" value="${S.freeShippingThreshold ?? 69}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
        </div>
        <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin:14px 0 8px;">💳 Paiement affiché sur le panier partagé ${U.info("Ce qui apparaît sous le total quand tu partages un panier à un client (fenêtre, image et texte copié). Chaque bloc n'apparaît que s'il est rempli. Tu peux le masquer au cas par cas dans la fenêtre « Partager ».")}</div>
        <div class="grid c3">
          <div class="fg"><label>Moyens de paiement acceptés</label>
            <div style="display:flex;gap:14px;flex-wrap:wrap;padding:6px 0;">
              <label style="display:inline-flex;align-items:center;gap:6px;"><input type="checkbox" id="p_pay_cash" onchange="Params.savePay()" ${S.payCash ? 'checked' : ''}> Espèces</label>
              <label style="display:inline-flex;align-items:center;gap:6px;"><input type="checkbox" id="p_pay_vir" onchange="Params.savePay()" ${S.payVirement ? 'checked' : ''}> Virement</label>
            </div>
            <input id="p_pay_other" onchange="Params.savePay()" value="${U.esc(S.payOther || '')}" placeholder="Autres (séparés par une virgule) : chèque, PayPal…" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>Titulaire du compte</label><input id="p_pay_holder" onchange="Params.savePay()" value="${U.esc(S.payHolder || '')}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>IBAN</label><input id="p_pay_iban" onchange="Params.savePay()" value="${U.esc(S.payIban || '')}" placeholder="FR76 …" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>BIC (option)</label><input id="p_pay_bic" onchange="Params.savePay()" value="${U.esc(S.payBic || '')}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg" style="grid-column:span 2;"><label>Message (option)</label><textarea id="p_pay_msg" onchange="Params.savePay()" class="note-area" rows="2" placeholder="Ex : Merci pour votre confiance 🐾">${U.esc(S.payMessage || '')}</textarea></div>
        </div>
        </div>
        <div class="fin-block" style="order:${finPos('events')}">${finTools('events')}
        <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">🚗 Événements & déplacements ${U.info("Sert à calculer les frais de déplacement de chaque événement (km aller-retour de sa fiche × consommation × prix du litre), pré-remplis au retour d'événement. Les fiches se gèrent dans Paramètres → Référentiels → Événements.")}</div>
        <div class="grid c3">
          <div class="fg"><label>Consommation du véhicule (L / 100 km)</label><input id="p_fuel_cons" type="number" step="0.1" value="${S.fuelConsumption ?? 7}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>Prix du carburant (€ / L)</label><input id="p_fuel_price" type="number" step="0.01" value="${S.fuelPrice ?? 1.85}" onkeydown="if(event.key==='Enter')Params.saveSettings()"></div>
          <div class="fg"><label>Coût carburant au km</label><span style="display:block;padding:8px 0;font-weight:600;">${U.eur(Store.fuelCostPerKm(), 3)} / km</span></div>
        </div>
        </div>
        </div>
        <button class="btn-cta mt" onclick="Params.saveSettings()">Enregistrer les réglages</button>
        </div>
      </details>

      <details class="fold card params-fold" ${this._refsOpen ? 'open' : ''} ontoggle="Params._refsOpen=this.open">
        <summary><h2 style="display:inline;">📋 Référentiels</h2> <span class="muted">(fournisseurs, viandes, catégories)</span></summary>
        <div class="fold-body">
          <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">Général (commun à tout)</div>
          <div class="grid c2">
            ${this.listCard('Fournisseurs', 'suppliers', S.suppliers.map(s => Store.supplierName(s.id)), true)}
            ${typeof Achats !== 'undefined' && !App.isViewer && !App.isTeam ? Achats.othersCard() : ''}
            ${this.eventsCard()}
          </div>

          <hr class="sep" style="border-style:dashed;margin:16px 0;">
          <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">🥩 Mastication</div>
          <div class="grid c2">
            ${this.listCard('Types de viande', 'meatTypes', S.meatTypes)}
            ${this.productTypesCard()}
          </div>

          <hr class="sep" style="border-style:dashed;margin:16px 0;">
          <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">🐕 Accessoires</div>
          <div class="grid c2">
            ${this.listCard('Types d\'accessoires', 'accCategories', S.accCategories)}
            ${this.listCard('Largeurs', 'widths', S.widths || [])}
            ${this.materialKindsCard()}
          </div>

          <hr class="sep" style="border-style:dashed;margin:16px 0;">
          <div style="font-size:.82rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gris);margin-bottom:8px;">📦 Consommables</div>
          <div class="grid c2">
            ${this.listCard('Catégories consommables', 'consCategories', S.consCategories)}
          </div>
        </div>
      </details>


      <details class="fold card params-fold" ${this._calcOpen ? 'open' : ''} ontoggle="Params._calcOpen=this.open">
        <summary><h2 style="display:inline;">🧮 Calculateur</h2> <span class="muted">(mode de référence par catégorie de matière)</span></summary>
        <div class="fold-body">
          ${this.calcModeCard()}
        </div>
      </details>

      <details class="fold card params-fold" ${this._fabOpen ? 'open' : ''} ontoggle="Params._fabOpen=this.open">
        <summary><h2 style="display:inline;">📐 Segments de fabrication</h2> <span class="muted">(accessoires — longueurs fixes)</span></summary>
        <div class="fold-body">
        <p class="muted help mb0">Longueurs fixes (sangle consommée, en m + cm) de chaque segment par type d'accessoire. Ces valeurs sont pré-remplies à la création d'un nouvel accessoire et utilisées pour le calcul "Sur mesure".</p>
        ${(S.accCategories || []).map((cat, ci) => {
          const d = (S.accFabDefaults || {})[cat] || { segments: [] };
          const segs = d.segments || [];
          const ce = U.esc(cat).replace(/&#39;/g, "\\'");
          return `<div class="card" style="margin-top:10px;padding:10px 14px;">
            <b>${U.esc(cat)}</b>
            ${segs.map((seg, i) => `<div class="frow mt" style="gap:10px;align-items:flex-end;">
              <div class="fg" style="flex:2;"><label><input value="${U.esc(seg.label)}" style="width:100%;" onchange="Params.setFabSeg('${ce}',${i},'label',this.value)"></label></div>
              <div class="fg" style="flex:0 0 auto;">${U.lenSplit(`pf_${ci}_${i}`, seg.value, { change: `Params.setFabSeg('${ce}',${i},'value',U.lenCm('pf_${ci}_${i}'))` })}</div>
              <div class="fg" style="flex:0;"><button class="btn-icon" onclick="Params.delFabSeg('${ce}',${i})" title="Supprimer">×</button></div>
            </div>`).join('')}
            <button class="btn-ghost btn-sm mt" onclick="Params.addFabSeg('${ce}')">＋ Ajouter un segment</button>
          </div>`;
        }).join('')}
        </div>
      </details>

      <details class="fold card params-fold" ${this._sachetsOpen ? 'open' : ''} ontoggle="Params._sachetsOpen=this.open">
        <summary><h2 style="display:inline;">📦 Sachets & blisters</h2> <span class="muted">(${S.sachets.length})</span></summary>
        <div class="fold-body">
        ${this._sachetGroupHTML(S.sachets, 'blister', 'Blisters', 'pour pièces & tailles')}
        ${this._sachetGroupHTML(S.sachets, 'sachet', 'Sachets', 'pour poids (grammes)')}
        <button class="btn-ghost btn-sm mt" onclick="Params.addSachet()">＋ Ajouter un sachet / blister</button>
        <hr class="sep">
        ${this._renderPackagingOverview()}
        </div>
      </details>

      <details class="fold card params-fold" ${this._varPresetsOpen ? 'open' : ''} ontoggle="Params._varPresetsOpen=this.open">
        <summary><h2 style="display:inline;">📐 Variantes</h2> <span class="muted">(paliers standards, normalisation & récupération)</span></summary>
        <div class="fold-body">
        <h3 style="margin:0 0 6px;text-align:center;">Paliers standards</h3>
        <p class="muted help mb0" style="text-align:center;">Paliers proposés automatiquement à la création d'un produit. Les variantes déjà utilisées sur tes produits existants sont listées en dessous — clique sur ＋ pour les ajouter aux paliers standards.</p>
        <div class="grid c3" style="gap:8px;margin-top:8px;">
          ${this.varPresetBlock('gram', 'Poids (grammes)', vp.gram || [], 'g')}
          ${this.varPresetBlock('piece', 'Pièces (lots)', vp.piece || [], 'pc')}
          ${this.varPresetBlock('size', 'Tailles', vp.size || [], '')}
        </div>
        ${this._renderFilteredProducts()}
        <h3 style="margin:16px 0 8px;">Variantes existantes sur tes produits</h3>
        <p class="muted help mb0">Variantes textuelles (pièces et tailles) trouvées sur tes produits mais pas encore dans les paliers standards. Clique sur ＋ pour les récupérer.</p>
        <div id="existing_variants_list" class="mt">${this._renderExistingVariants(vp)}</div>
        <hr class="sep">
        <h3 style="margin:0 0 8px;">Normaliser</h3>
        <p class="muted help mb0">Si une même variante existe écrite de plusieurs façons (ex: "100g" et "100G", "Lot 2" et "LOT 2"), uniformise-les ici. Les variantes identiques après renommage sont automatiquement fusionnées (leurs lots sont conservés).</p>
        <button class="btn-ghost btn-sm mt" onclick="Params.uppercaseAllVariants()">🔠 Tout mettre en MAJUSCULES</button>
        <div class="frow mt" style="align-items:flex-end;">
          <div class="fg"><label>Variante existante</label><select id="pv_old">${Stock.allVariantLabels().map(l => `<option>${U.esc(l)}</option>`).join('')}</select></div>
          <div class="fg"><label>Renommer en</label><input id="pv_new" placeholder="ex: 100G" onkeydown="if(event.key==='Enter')Params.renameVariantPrompt()"></div>
          <div class="fg" style="flex:0;"><button class="btn-ghost" onclick="Params.renameVariantPrompt()">Renommer partout</button></div>
        </div>
        </div>
      </details>

      <details class="fold card params-fold" ${this._skuOpen ? 'open' : ''} ontoggle="Params._skuOpen=this.open">
        <summary><h2 style="display:inline;">🏷️ SKU</h2> <span class="muted">gestion & régénération</span></summary>
        <div class="fold-body">
        <p class="muted help mb0">Les SKU sont générés automatiquement en abrégeant les noms de viande et en supprimant les mots inutiles (ex: <code>POU-AILES-DE-POULET-100G</code> → <code>AILES-POU-100G</code>). Tu peux aussi modifier chaque SKU individuellement.</p>
        <details class="fold" style="margin-top:8px;" ${this._abbrevOpen ? 'open' : ''} ontoggle="Params._abbrevOpen=this.open">
          <summary><b>Abréviations des viandes</b> <span class="muted">(cliquer pour configurer)</span></summary>
          <div class="fold-body">
            <div style="display:flex;flex-wrap:wrap;gap:6px;" id="sku_abbrev_list">
              ${(() => { const map = Pricing.meatAbbrevMap(); const slugs = {}; S.meatTypes.forEach(mt => slugs[mt] = Pricing.slugify(mt)); return S.meatTypes.slice().sort(U.sortFr).map(mt => { const abbr = (S.meatAbbrev || {})[mt] || map[slugs[mt]] || slugs[mt].substring(0,3); return `<span class="tag" style="display:inline-flex;gap:4px;align-items:center;">${U.esc(mt)} → <input style="width:50px;padding:2px 4px;text-transform:uppercase;" value="${U.esc(abbr)}" onchange="Params.setMeatAbbrev('${U.esc(mt).replace(/&#39;/g,"\\'")}',this.value)"></span>`; }).join(''); })()}
            </div>
          </div>
        </details>
        <details class="fold" style="margin-top:8px;" ${this._matAbbrevOpen ? 'open' : ''} ontoggle="Params._matAbbrevOpen=this.open">
          <summary><b>Abréviations des matières premières</b> <span class="muted">(cliquer pour configurer)</span></summary>
          <div class="fold-body">
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${(() => { const kinds = Object.keys(Stock.matKindLabel); const map = Pricing.matAbbrevMap(); return kinds.sort(U.sortFr).map(k => { const slug = Pricing.slugify(k); const abbr = (S.matAbbrev || {})[k] || map[slug] || slug.substring(0,3); return `<span class="tag" style="display:inline-flex;gap:4px;align-items:center;">${U.esc(Stock.matKindLabel[k] || k)} → <input style="width:50px;padding:2px 4px;text-transform:uppercase;" value="${U.esc(abbr)}" onchange="Params.setMatAbbrev('${U.esc(k).replace(/&#39;/g,"\\'")}',this.value)"></span>`; }).join(''); })()}
            </div>
            <button class="btn-ghost btn-sm mt" onclick="Params.regenMatSkus()">🔄 Régénérer les SKU matières</button>
          </div>
        </details>
        <details class="fold" style="margin-top:8px;" ${this._consoAbbrevOpen ? 'open' : ''} ontoggle="Params._consoAbbrevOpen=this.open">
          <summary><b>Abréviations des consommables</b> <span class="muted">(cliquer pour configurer)</span></summary>
          <div class="fold-body">
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${(() => { const cats = S.consCategories || []; const map = Pricing.consoAbbrevMap(); return cats.slice().sort(U.sortFr).map(c => { const slug = Pricing.slugify(c); const abbr = (S.consoAbbrev || {})[c] || map[slug] || slug.substring(0,3); return `<span class="tag" style="display:inline-flex;gap:4px;align-items:center;">${U.esc(c)} → <input style="width:50px;padding:2px 4px;text-transform:uppercase;" value="${U.esc(abbr)}" onchange="Params.setConsoAbbrev('${U.esc(c).replace(/&#39;/g,"\\'")}',this.value)"></span>`; }).join(''); })()}
            </div>
          </div>
        </details>
        <div class="toolbar mt" style="margin-bottom:8px;">
          <div class="fg" style="min-width:180px;"><input id="sku_all_search" placeholder="Rechercher un produit ou SKU…" oninput="Params.renderSkuAll()" onchange="U.refocus('sku_all_search')"></div>
          <div class="fg" style="min-width:120px;">${U.customSelect({ value: this._skuMeat, options: [{v:'all',l:'Toutes les viandes'}].concat(S.meatTypes.slice().sort(U.sortFr).map(mt => ({v:mt,l:mt}))), onPick: 'Params._setSkuMeat' })}</div>
        </div>
        <div id="sku_all_list">${this._renderSkuAll()}</div>
        <hr class="sep">
        <p class="muted help mb0">Si tu as importé le calculateur et le stock séparément, relie-les (par SKU puis par nom exact) pour que coûts, marges et valeurs remontent au tableau de bord. Pour tout le reste (noms différents, cas ambigus), utilise "✏️ Modifier le produit" dans Stock → "Lier au catalogue prix" : c'est toi qui choisis la bonne fiche dans la liste, rien n'est deviné automatiquement.</p>
        <button class="btn-ghost mt" onclick="Params.relink()">🔗 Relier stock ↔ catalogue (noms identiques)</button>
        <p class="muted help mb0 mt">Les produits déjà reliés se resynchronisent normalement tout seuls (à chaque enregistrement côté Prix mastication, ou à chaque modif de SKU). Ce bouton est un filet de sécurité : il force la resynchro de TOUS les produits déjà reliés (prix, variantes, SKU), au cas où l'un d'eux aurait été manqué.</p>
        <button class="btn-ghost mt" onclick="Params.resyncAllFromCatalog()">🔄 Resynchroniser tout (Stock ↔ Catalogue)</button>
        </div>
      </details>

      <details class="fold card params-fold" ${this._dupOpen ? 'open' : ''} ontoggle="Params._toggleDup(this)">
        <summary><h2 style="display:inline;">🔍 Contrôle des doublons</h2> <span class="muted">liaisons & liens fournisseur</span></summary>
        <div class="fold-body">${this._dupOpen ? this._renderDupCheck() : ''}</div>
      </details>



      <details class="fold card params-fold" ${this._importOpen ? 'open' : ''} ontoggle="Params._importOpen=this.open">
        <summary><h2 style="display:inline;">📥 Import & sauvegarde</h2></summary>
        <div class="fold-body">
        <p class="muted help mb0">Dépose n'importe quel fichier de données : l'app reconnaît toute seule s'il s'agit de ton ancien <b>calculateur de prix</b>, de ton ancienne <b>appli de stock</b> (toutes versions), ou d'une <b>sauvegarde</b> de cette application.</p>
        <input type="file" id="importFile" accept="application/json,.json" class="mt" onchange="Params._captureImportFile(this)">
      <p class="muted mt" id="importFileLabel" style="display:none"></p>
        <button class="btn-cta mt" onclick="Params.importAuto()">Importer le fichier (détection automatique)</button>
        <hr class="sep">
        <h3 style="margin:0 0 8px;">Exporter les produits et la configuration</h3>
        <div class="frow" style="margin-bottom:8px;">
          <div class="fg"><label>Type de stock à exporter</label><select id="exp_stock"><option value="all">Tout (Général + Événement)</option><option value="general">Général uniquement</option><option value="event">Événement uniquement</option></select></div>
        </div>
        <p class="muted mb0" style="font-size:.85rem;">Exporter tous les produits (Périssables + Non Périssables)</p>
        <div class="frow mt" style="gap:8px;">
          <button class="btn-ok" onclick="Params.exportProducts('all',true)">📥 Tous les produits (avec quantités)</button>
          <button class="btn-ghost" onclick="Params.exportProducts('all',false)">📥 Tous les produits (sans quantités)</button>
        </div>
        <p class="muted mb0 mt" style="font-size:.85rem;">Exporter par type de produit</p>
        <div class="frow mt" style="gap:8px;flex-wrap:wrap;">
          <button class="btn-cta" onclick="Params.exportProducts('perishable',true)">📥 Périssables (avec quantités)</button>
          <button class="btn-ghost" onclick="Params.exportProducts('perishable',false)">📥 Périssables (sans quantités)</button>
          <button class="btn-cta" onclick="Params.exportProducts('non-perishable',true)">📥 Non Périssables (avec quantités)</button>
          <button class="btn-ghost" onclick="Params.exportProducts('non-perishable',false)">📥 Non Périssables (sans quantités)</button>
        </div>
        <hr class="sep">
        <h3 style="margin:0 0 8px;">Importer des produits</h3>
        <div class="frow" style="gap:8px;">
          <button class="btn-danger" onclick="Params.importProducts('replace')">📤 Importer (Remplacer les données)</button>
          <button class="btn-ok" onclick="Params.importProducts('merge')">📤 Importer (Fusionner les quantités)</button>
        </div>
        <hr class="sep">
        <div class="frow">
          <div>
            <p class="muted mb0">Sauvegarde complète de toutes tes données (à conserver au chaud).</p>
            <button class="btn-ok mt" onclick="Params.exportAll()">⬇️ Exporter la sauvegarde</button>
          </div>
          <div>
            <p class="muted mb0">Besoin de forcer une restauration complète (remplace tout) ?</p>
            <input type="file" id="restoreFile" accept="application/json,.json" class="mt">
            <button class="btn-ghost mt" onclick="Params.importAll()">Restaurer (remplace tout)</button>
          </div>
        </div>
        </div>
      </details>

      <div class="grid c2">
        <div class="card params-card">
          <h2>🛟 Instantanés (retour arrière)</h2>
          <p class="muted help">Une sauvegarde automatique est prise chaque jour. Tu peux revenir à l'état d'un jour précédent — utile si un marché a mal tourné.</p>
          <div class="frow" style="gap:8px;flex-wrap:wrap;">
            <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Params.snapshotNow()">Prendre un instantané maintenant</button>
            <button class="btn-danger btn-sm" style="flex:0 0 auto;" onclick="Params.clearSnapshots()">🗑️ Effacer tous les instantanés</button>
          </div>
          <div class="frow mt" style="gap:8px;flex-wrap:wrap;align-items:flex-end;">
            <div class="fg" style="max-width:190px;margin:0;"><label>Conserver (jours)</label><input type="number" min="7" step="1" value="${U.num(S.snapRetentionDays) || 30}" onchange="Params.setSnapRetention(this.value)"></div>
            <button class="btn-ghost btn-sm" style="flex:0 0 auto;" onclick="Params.cleanupSnapshotsNow()">🧹 Nettoyer les plus anciens</button>
          </div>
          <p class="muted help" style="font-size:.8rem;">Un rappel mensuel te propose de télécharger une sauvegarde puis de supprimer les instantanés plus vieux que cette durée.</p>
          <div id="snapList" class="mt"><p class="muted">Chargement…</p></div>
        </div>
        <div class="card params-card">
          <h2>📓 Journal des mouvements</h2>
          ${(() => {
            const users = [...new Set(Store.state.journal.map(j => j.user || ''))];
            const hasUsers = users.some(u => u);
            return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
              <button class="btn-danger btn-sm" onclick="Params.clearJournal()">🗑️ Vider le journal</button>
              ${hasUsers ? `<div style="min-width:220px;">${U.customSelect({ value: this._journalUser || 'all', options: [{ v: 'all', l: 'Tous les utilisateurs' }].concat(users.map(u => ({ v: u || '_none', l: u || '— (non renseigné)' }))), onPick: 'Params._setJournalUser' })}</div>` : ''}
            </div>`;
          })()}
          <div class="table-wrap" style="max-height:340px; overflow-y:auto;"><table><tbody>
            ${Store.state.journal.filter(j => !this._journalUser || this._journalUser === 'all' || (j.user || '_none') === this._journalUser).slice(0, 100).map(j => `<tr>
              <td style="white-space:nowrap;" class="muted">${U.frDateTime(j.ts)}</td>
              <td style="white-space:nowrap;" class="muted">${U.esc(j.user || '—')}</td>
              <td>${U.esc(j.label)}</td>
              <td class="right">${j.undo ? `<button class="btn-ghost btn-sm" onclick="Params.undo('${j.id}')">Annuler</button>` : ''}</td>
            </tr>`).join('') || '<tr><td class="muted">Aucun mouvement.</td></tr>'}
          </tbody></table></div>
        </div>
      </div>

      ${Store.remote && App.role === 'admin' ? `<div class="card">
          <h2>👥 Connexions des utilisateurs</h2>
          <p class="muted" style="font-size:.85rem;">Chaque ouverture de l'appli (au plus une toutes les 30 min par appareil).</p>
          <div id="connList" class="muted">Chargement…</div>
        </div>` : ''}

      ${Store.remote ? `<div class="card">
          <p class="muted mb0">Connecté(e) : <b>${Store.session?.user?.email || ''}</b> &middot; ${App.isViewer ? 'Lecture seule' : App.isTeam ? 'Équipe (stock)' : 'Administrateur'}</p>
          <button class="btn-ghost mt" onclick="Store.logout()">Se déconnecter</button>
        </div>` : ''}
    `);
    this.loadSnaps();
    if (Store.remote && App.role === 'admin') this.loadConnexions();
  },

  _setJournalUser(v) { Params._journalUser = v; App.rerender(); },
  _connUser: 'all',
  _setConnUser(v) { Params._connUser = v; Params.loadConnexions(); },
  async loadConnexions() {
    const box = document.getElementById('connList'); if (!box) return;
    const { data, error } = await Store.sb.from('connexions').select('email,role,created_at').order('created_at', { ascending: false }).limit(300);
    if (error) { box.innerHTML = 'Le suivi des connexions n’est pas encore activé (table <code>connexions</code> à créer dans Supabase).'; return; }
    const rows = data || [];
    if (!rows.length) { box.innerHTML = 'Aucune connexion enregistrée pour l’instant.'; return; }
    const roleLbl = r => r === 'viewer' ? 'Lecture seule' : r === 'team' ? 'Équipe' : 'Admin';
    const users = [...new Set(rows.map(r => r.email))];
    const last = {}; const count = {};
    rows.forEach(r => { count[r.email] = (count[r.email] || 0) + 1; if (!last[r.email]) last[r.email] = r; });
    const shown = rows.filter(r => this._connUser === 'all' || r.email === this._connUser).slice(0, 100);
    box.classList.remove('muted');
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Utilisateur</th><th>Profil</th><th>Dernière connexion</th><th style="text-align:center;">Nb</th></tr></thead><tbody>
        ${users.map(u => `<tr><td>${U.esc(u)}</td><td>${roleLbl(last[u].role)}</td><td>${U.frDateTime(last[u].created_at)}</td><td style="text-align:center;">${count[u]}</td></tr>`).join('')}
      </tbody></table></div>
      <div style="margin:12px 0 8px;max-width:280px;">${U.customSelect({ value: this._connUser, options: [{ v: 'all', l: 'Tous les utilisateurs' }].concat(users.map(u => ({ v: u, l: u }))), onPick: 'Params._setConnUser' })}</div>
      <div class="table-wrap" style="max-height:300px;overflow-y:auto;"><table><tbody>
        ${shown.map(r => `<tr><td class="muted" style="white-space:nowrap;">${U.frDateTime(r.created_at)}</td><td>${U.esc(r.email)}</td><td class="muted">${roleLbl(r.role)}</td></tr>`).join('')}
      </tbody></table></div>`;
  },

  listCard(title, key, values, isSupplier) {
    return `<div style="padding:12px 0;border-bottom:1px solid var(--row-border);"><h3 style="margin:0 0 8px;">${U.esc(title)}</h3>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${values.slice().sort(U.sortFr).map(v => `<span class="tag" style="display:inline-flex;gap:6px;align-items:center;">
          ${U.esc(v)} <button class="btn-icon" style="padding:0;" onclick="Params.delItem('${key}','${U.esc(v).replace(/&#39;/g, "\\'")}',${!!isSupplier})">×</button></span>`).join('') || '<span class="muted">Vide</span>'}
      </div>
      <div class="frow mt"><input id="add_${key}" placeholder="Ajouter…" onkeydown="if(event.key==='Enter')Params.addItem('${key}',${!!isSupplier})"><button class="btn-ghost btn-sm" onclick="Params.addItem('${key}',${!!isSupplier})">＋</button></div>
    </div>`;
  },

  /* Référentiel « Événements » (2026-09-27) : noms de marchés/salons choisis dans une liste au
     retour d'événement (plus de faute de frappe). Renommer met à jour toutes les ventes liées. */
  eventsCard() {
    const list = Store.eventList();
    const used = n => Store.state.sales.filter(s => s.eventName === n).length;
    const enc = n => encodeURIComponent(n).replace(/'/g, '%27');
    return `<div style="padding:12px 0;border-bottom:1px solid var(--row-border);"><h3 style="margin:0 0 8px;">🎪 Événements <span class="muted" style="font-weight:400;font-size:.8rem;">(marchés, salons…)</span></h3>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${list.map(n => { const e = Store.eventInfo(n); const open = !!(this._evFicheOpen || {})[n]; const tc = Store.eventTravelCost(n);
          return `<details class="fold sachet-group" style="margin:0;" ${open ? 'open' : ''} ontoggle="(Params._evFicheOpen=Params._evFicheOpen||{})[decodeURIComponent('${enc(n)}')]=this.open">
          <summary style="cursor:pointer;padding:6px 0;"><b>${U.esc(n)}</b> <span class="muted" style="font-size:.78rem;">${used(n)} vente(s)${U.num(e.stand) ? ' · stand ' + U.eur(e.stand) : ''}${tc ? ' · trajet ' + U.eur(tc) : ''}${e.place ? ' · ' + U.esc(e.place) : ''}</span></summary>
          <div class="fold-body" style="padding:6px 0 10px;">
            <div class="grid c3">
              <div class="fg"><label>Nom</label><input value="${U.esc(n)}" onchange="Params.renameEvent('${enc(n)}',this.value)"></div>
              <div class="fg"><label>Lieu</label><input value="${U.esc(e.place || '')}" placeholder="ex : Lyon, place Bellecour" onchange="Params.setEventInfo('${enc(n)}','place',this.value)"></div>
              <div class="fg"><label>Prix du stand habituel (€)</label><input type="number" step="0.01" min="0" value="${e.stand ?? ''}" onchange="Params.setEventInfo('${enc(n)}','stand',this.value)"></div>
              <div class="fg"><label>Kilomètres aller-retour</label><input type="number" step="1" min="0" value="${e.km ?? ''}" onchange="Params.setEventInfo('${enc(n)}','km',this.value)"></div>
              <div class="fg"><label>Péages / parking (€)</label><input type="number" step="0.01" min="0" value="${e.tolls ?? ''}" onchange="Params.setEventInfo('${enc(n)}','tolls',this.value)"></div>
              <div class="fg"><label>Hébergement / autres (€)</label><input type="number" step="0.01" min="0" value="${e.other ?? ''}" onchange="Params.setEventInfo('${enc(n)}','other',this.value)"></div>
            </div>
            <div class="fg"><label>Note</label><textarea class="note-area" rows="1" placeholder="ex : installation 7h, prévoir tonnelle" onchange="Params.setEventInfo('${enc(n)}','note',this.value)">${U.esc(e.note || '')}</textarea></div>
            <p class="muted" style="font-size:.8rem;margin:4px 0;">🚗 Déplacement calculé : ${U.num(e.km)} km × ${String(U.num(Store.state.settings.fuelConsumption ?? 7)).replace(".", ",")} L/100 km × ${U.eur(U.num(Store.state.settings.fuelPrice ?? 1.85))}/L (soit ${U.eur(Store.fuelCostPerKm(), 3)}/km) + péages + autres = <b>${U.eur(tc)}</b> — pré-rempli au retour d'événement (modifiable).</p>
            <button class="btn-ghost btn-sm" onclick="Params.delEvent('${enc(n)}')">🗑️ Retirer cet événement</button>
          </div></details>`; }).join('') || '<span class="muted">Aucun événement.</span>'}
      </div>
      <div class="frow mt"><input id="add_event" placeholder="ex : Marché de Noël Lyon" onkeydown="if(event.key==='Enter')Params.addEvent()"><button class="btn-ghost btn-sm" onclick="Params.addEvent()">＋</button></div>
    </div>`;
  },
  setEventInfo(enc, key, val) {
    const n = decodeURIComponent(enc), S = Store.state.settings;
    S.eventInfo = S.eventInfo || {};
    const e = S.eventInfo[n] = S.eventInfo[n] || {};
    e[key] = (key === 'place' || key === 'note') ? String(val || '').trim() : (val === '' ? '' : U.num(val));
    if (!(S.events || []).includes(n)) (S.events = S.events || []).push(n);
    Store.save('settings'); App.rerender();
  },
  addEvent(name) {
    const n = String(name !== undefined ? name : U.val('add_event')).trim(); if (!n) return false;
    const S = Store.state.settings; S.events = S.events || [];
    if (Store.eventList().some(x => x.toLowerCase() === n.toLowerCase())) { if (name === undefined) U.toast('Cet événement existe déjà.', true); return Store.eventList().find(x => x.toLowerCase() === n.toLowerCase()); }
    S.events.push(n); Store.save('settings');
    if (name === undefined) App.rerender();
    return n;
  },
  async renameEvent(enc, val) {
    const old = decodeURIComponent(enc), n = String(val || '').trim();
    if (!n || n === old) return;
    if (Store.eventList().some(x => x !== old && x.toLowerCase() === n.toLowerCase()) && !await U.confirm('« ' + n + ' » existe déjà : fusionner les deux événements ?')) { App.rerender(); return; }
    const S = Store.state.settings; S.events = (S.events || []).filter(x => x !== old && x.toLowerCase() !== n.toLowerCase()); S.events.push(n);
    if (S.eventInfo && S.eventInfo[old]) { S.eventInfo[n] = Object.assign({}, S.eventInfo[old], S.eventInfo[n] || {}); delete S.eventInfo[old]; }
    let cnt = 0; Store.state.sales.forEach(s => { if (s.eventName === old) { s.eventName = n; cnt++; } });
    Store.save('settings', 'sales'); App.rerender();
    U.toast('Événement renommé' + (cnt ? ' (' + cnt + ' vente(s) mises à jour)' : '') + '.');
  },
  async delEvent(enc) {
    const n = decodeURIComponent(enc);
    const cnt = Store.state.sales.filter(s => s.eventName === n).length;
    if (cnt && !await U.confirm('« ' + n + ' » est utilisé par ' + cnt + ' vente(s). Le retirer de la liste enlève aussi ce nom de ces ventes (elles ne seront plus comptées dans les statistiques par événement). Continuer ?')) return;
    const S = Store.state.settings; S.events = (S.events || []).filter(x => x !== n);
    if (S.eventInfo) delete S.eventInfo[n];
    Store.state.sales.forEach(s => { if (s.eventName === n) s.eventName = ''; });
    Store.save('settings', 'sales'); App.rerender();
  },

  /* Types de produit (occupation/mastication, éducation/friandises + ajouts type
     complément alimentaire) — référentiel {value,label} utilisé par les tags produit
     dans Stock et le filtre « Type » des Paniers personnalisés. */
  productTypesCard() {
    const types = Store.productTypes();
    return `<div style="padding:12px 0;border-bottom:1px solid var(--row-border);"><h3 style="margin:0 0 8px;">Types de produit <span class="muted" style="font-weight:400;">(occupation, éducation, complément…)</span></h3>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${types.map(t => `<span class="tag" style="display:inline-flex;gap:6px;align-items:center;">
          ${U.esc(t.label)} <button class="btn-icon" style="padding:0;" onclick="Params.delProductType('${U.esc(t.value)}')">×</button></span>`).join('') || '<span class="muted">Vide</span>'}
      </div>
      <div class="frow mt"><input id="add_prodtype" placeholder="Ajouter un type…" onkeydown="if(event.key==='Enter')Params.addProductType()"><button class="btn-ghost btn-sm" onclick="Params.addProductType()">＋</button></div>
    </div>`;
  },
  addProductType() {
    const label = U.val('add_prodtype').trim(); if (!label) return;
    const S = Store.state.settings;
    if (!Array.isArray(S.productTypes)) S.productTypes = Store.productTypes().slice();
    if (S.productTypes.some(t => t.label.toLowerCase() === label.toLowerCase())) { U.toast('Déjà présent', true); return; }
    let value = (Pricing.slugify(label) || '').toLowerCase() || ('type-' + Date.now());
    while (S.productTypes.some(t => t.value === value)) value += '-2';
    S.productTypes.push({ value, label });
    Store.save('settings'); App.rerender();
  },
  async delProductType(value) {
    const S = Store.state.settings;
    if (!Array.isArray(S.productTypes)) S.productTypes = Store.productTypes().slice();
    const used = Store.state.stockM.some(p => (p.tags || {}).type === value || (p.variants || []).some(v => (v.tags || {}).type === value));
    if (used && !await U.confirm('Ce type est utilisé sur des produits. Le supprimer quand même ? (les produits concernés perdront ce type)')) return;
    S.productTypes = S.productTypes.filter(t => t.value !== value);
    Store.save('settings'); App.rerender();
  },

  /* Catégories de matières (sangle/bouclerie/autre + ajouts d'Antho : mousqueton, anneaux…)
     — référentiel {value,label} éditable, utilisé par les matières (Stock) et le calculateur.
     'sangle' garde son comportement rouleaux ; les autres catégories suivent leur unité (m/pièce). */
  materialKindsCard() {
    const kinds = Store.materialKinds();
    return `<div style="padding:12px 0;border-bottom:1px solid var(--row-border);"><h3 style="margin:0 0 8px;">Catégories de matières <span class="muted" style="font-weight:400;">(sangle, bouclerie, mousqueton…)</span></h3>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        ${kinds.map(k => `<span class="tag" style="display:inline-flex;gap:6px;align-items:center;">
          ${U.esc(k.label)} <button class="btn-icon" style="padding:0;" onclick="Params.delMaterialKind('${U.esc(k.value).replace(/&#39;/g, "\\'")}')">×</button></span>`).join('') || '<span class="muted">Vide</span>'}
      </div>
      <div class="frow mt"><input id="add_matkind" placeholder="Ajouter une catégorie…" onkeydown="if(event.key==='Enter')Params.addMaterialKind()"><button class="btn-ghost btn-sm" onclick="Params.addMaterialKind()">＋</button></div>
    </div>`;
  },
  addMaterialKind() {
    const label = U.val('add_matkind').trim(); if (!label) return;
    const S = Store.state.settings;
    if (!Array.isArray(S.materialKinds)) S.materialKinds = Store.materialKinds().slice();
    if (S.materialKinds.some(k => k.label.toLowerCase() === label.toLowerCase())) { U.toast('Déjà présent', true); return; }
    let value = (Pricing.slugify(label) || '').toLowerCase() || ('cat-' + Date.now());
    while (S.materialKinds.some(k => k.value === value)) value += '-2';
    S.materialKinds.push({ value, label });
    Store.save('settings'); App.rerender();
    U.toast('Catégorie « ' + label + ' » ajoutée.');
  },
  async delMaterialKind(value) {
    const S = Store.state.settings;
    if (!Array.isArray(S.materialKinds)) S.materialKinds = Store.materialKinds().slice();
    const used = Store.state.materials.some(m => (m.kind || 'autre') === value);
    if (used && !await U.confirm('Cette catégorie est utilisée par des matières. La supprimer quand même ? (les matières concernées gardent leur catégorie, mais elle n\'apparaîtra plus dans les listes tant qu\'aucune matière ne l\'utilise)')) return;
    S.materialKinds = S.materialKinds.filter(k => k.value !== value);
    if (S.calcRefMode) delete S.calcRefMode[value];
    Store.save('settings'); App.rerender();
  },

  /* 🧮 Calculateur : mode de référence par catégorie de matière (sangle/bouclerie/autre).
     'shared' = une référence partagée par largeur/type ; 'perItem' = une référence par article. */
  calcModeCard() {
    const kinds = Store.materialKinds();
    const perItem = kinds.filter(k => Store.calcRefMode(k.value) === 'perItem');
    const shared = kinds.filter(k => Store.calcRefMode(k.value) === 'shared');
    const chip = (k, target) => {
      const ke = U.esc(k.value).replace(/&#39;/g, "\\'");
      const lbl = `<span>${U.esc(k.label)}</span>`;
      const arrow = target === 'shared' ? '→' : '←';
      const title = target === 'shared' ? 'Déplacer vers « Partagée par largeur »' : 'Déplacer vers « Par article »';
      const btn = `<button class="btn-icon calc-move" title="${title}" onclick="Params.setCalcRefMode('${ke}','${target}')">${arrow}</button>`;
      return target === 'perItem'
        ? `<div class="calc-chip">${btn}${lbl}</div>`   // colonne de droite : flèche ← à gauche
        : `<div class="calc-chip">${lbl}${btn}</div>`;  // colonne de gauche : flèche → à droite
    };
    const empty = '<div class="muted" style="font-size:.8rem;padding:8px 2px;">Aucune catégorie</div>';
    return `<p class="muted help mb0">Range chaque catégorie de matière (gérée dans <b>Référentiels → Accessoires</b>) dans son mode, avec les flèches. <b>Par article</b> = une référence propre à chaque article (boucleries — un mousqueton sécurisé ≠ non sécurisé). <b>Partagée par largeur</b> = une seule saisie pour toutes les couleurs d'une même largeur (sangles).</p>
      <div class="calc-cols">
        <div class="calc-col"><h4>📦 Par article</h4>${perItem.map(k => chip(k, 'shared')).join('') || empty}</div>
        <div class="calc-col"><h4>📏 Partagée par largeur</h4>${shared.map(k => chip(k, 'perItem')).join('') || empty}</div>
      </div>`;
  },
  setCalcRefMode(kind, mode) {
    const S = Store.state.settings;
    if (!S.calcRefMode) S.calcRefMode = {};
    S.calcRefMode[kind] = mode;
    Store.save('settings'); App.rerender();
    U.toast('Mode du calculateur mis à jour pour « ' + (Stock.matKindLabel[kind] || kind) + ' ».');
  },

  /* Case « assujetti à la TVA » : prise en compte IMMÉDIATE (badge + colonne TVA
     des Stats/Tableau de bord basculent tout de suite), sans attendre « Enregistrer ». */
  toggleVatActive(checked) {
    Store.state.settings.vatActive = !!checked;
    Store.save('settings');
    App.rerender();
    U.toast(checked ? 'Assujetti à la TVA : la TVA est désormais déduite du bénéfice.' : 'Non assujetti : la TVA reste dans le bénéfice.');
  },

  /* Bascule thème clair/sombre — déplacé de la barre du haut vers Paramètres → Apparence. */
  toggleTheme() { Theme.toggle(); App.rerender(); },

  /* Amortissement matériel UV : liste d'équipements, chacun amorti indépendamment (prix ÷ durée).
     Édition en direct (onchange), migre l'ancien slot unique uvEquipPrice/uvEquipYears au 1er usage. */
  _uvEquipMigrate() {
    const S = Store.state.settings;
    if (!Array.isArray(S.uvEquip)) S.uvEquip = [];
    if (!S.uvEquip.length && U.num(S.uvEquipPrice) > 0) {
      S.uvEquip.push({ id: U.uid(), name: 'Imprimante UV', price: U.num(S.uvEquipPrice), years: U.num(S.uvEquipYears) || 5, buyYear: 0 });
    }
    S.uvEquipPrice = 0; S.uvEquipYears = 0; // legacy neutralisé une fois migré
  },
  addUvEquip() {
    this._uvEquipMigrate();
    Store.state.settings.uvEquip.push({ id: U.uid(), name: '', price: 0, years: 5, buyYear: 0 });
    Store.save('settings'); App.rerender();
  },
  setUvEquip(id, field, val) {
    this._uvEquipMigrate();
    const e = Store.state.settings.uvEquip.find(x => x.id === id); if (!e) return;
    e[field] = (field === 'name' || field === 'category') ? val : U.num(val);
    Store.save('settings'); App.rerender();
  },

  /* Réordonnancement des blocs de Réglages financiers (↑↓). L'ordre est stocké dans S.finOrder ; l'affichage suit via CSS flex `order`. */
  moveFin(key, dir) {
    const S = Store.state.settings;
    const def = ['general', 'amort', 'masti', 'acc', 'conso', 'paniers', 'events'];
    let order = (Array.isArray(S.finOrder) ? S.finOrder.filter(k => def.includes(k)) : []);
    def.forEach(k => { if (!order.includes(k)) order.push(k); });
    const i = order.indexOf(key), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    S.finOrder = order; Store.save('settings'); App.rerender();
  },
  delUvEquip(id) {
    this._uvEquipMigrate();
    Store.state.settings.uvEquip = Store.state.settings.uvEquip.filter(x => x.id !== id);
    Store.save('settings'); App.rerender();
  },

  /* Paiement affiché sur le panier partagé : enregistré dès qu'on quitte la case (rien à perdre si l'écran se redessine). */
  savePay() {
    const S = Store.state.settings;
    S.payCash = U.chk('p_pay_cash'); S.payVirement = U.chk('p_pay_vir'); S.payOther = U.val('p_pay_other');
    S.payHolder = U.val('p_pay_holder'); S.payIban = U.val('p_pay_iban'); S.payBic = U.val('p_pay_bic'); S.payMessage = U.val('p_pay_msg');
    Store.save('settings');
  },
  saveSettings() {
    const S = Store.state.settings;
    S.vatRate = U.numVal('p_vat'); S.socialTaxRate = U.numVal('p_soc'); S.socialTaxRateHandmade = U.numVal('p_soc_hm'); S.cardFeeRate = U.numVal('p_cb'); S.stripeFeeRate = U.numVal('p_stripe');
    if (document.getElementById('p_fuel_cons')) { S.fuelConsumption = U.numVal('p_fuel_cons'); S.fuelPrice = U.numVal('p_fuel_price'); }
    S.laborRate = U.numVal('p_labor'); S.bulkDiscount = U.numVal('p_bulk');
    S.b2bCoeffThreshold = U.numVal('p_thr'); S.accCoeffThreshold = U.numVal('p_acc_thr'); S.dluoAlertDays = U.numVal('p_dluo'); S.vatActive = U.chk('p_vatActive');
    S.uvCartridgePrice = U.numVal('p_uv_price'); S.uvCartridgeVolume = U.numVal('p_uv_vol'); S.uvMaintPct = U.numVal('p_uv_maint_pct');
    S.uvFilterPrice = U.numVal('p_uv_filter_price'); S.uvFilterPerYear = U.numVal('p_uv_filter_year');
    S.uvCleanPrice = U.numVal('p_uv_clean_price'); S.uvCleanPerYear = U.numVal('p_uv_clean_year');
    S.uvMaintHoursPerYear = U.numVal('p_uv_maint_h') + U.numVal('p_uv_maint_min') / 60;
    // L'amortissement matériel (S.uvEquip) est édité en direct dans sa liste (addUvEquip/setUvEquip/delUvEquip), pas ici.
    S.shippingCost = U.numVal('p_shipping'); S.freeShippingThreshold = U.numVal('p_freethr');
    if (document.getElementById('p_pay_iban')) {
      S.payCash = U.chk('p_pay_cash'); S.payVirement = U.chk('p_pay_vir'); S.payOther = U.val('p_pay_other');
      S.payHolder = U.val('p_pay_holder'); S.payIban = U.val('p_pay_iban'); S.payBic = U.val('p_pay_bic'); S.payMessage = U.val('p_pay_msg');
    }
    // recalcule les prix TTC du stock lié
    Store.state.catalogM.forEach(c => Stock.syncPricesFromCatalog(c.id));
    Store.log('paramètres', 'Réglages financiers mis à jour');
    Store.save('settings', 'stockM');
    U.toast('Réglages enregistrés.');
  },

  addItem(key, isSupplier) {
    const val = U.val('add_' + key).trim(); if (!val) return;
    const S = Store.state.settings;
    if (isSupplier) {
      if (S.suppliers.some(s => s.name.toLowerCase() === val.toLowerCase())) { U.toast('Déjà présent', true); return; }
      S.suppliers.push({ id: U.uid(), name: val });
    } else {
      if (S[key].some(x => x.toLowerCase() === val.toLowerCase())) { U.toast('Déjà présent', true); return; }
      S[key].push(val);
    }
    Store.save('settings'); App.rerender();
  },
  async delItem(key, val, isSupplier) {
    const S = Store.state.settings;
    if (isSupplier) {
      const s = S.suppliers.find(x => x.name === val);
      if (s && Store.state.catalogM.some(p => p.mainSupplierId === s.id)) {
        if (!await U.confirm('Ce fournisseur est utilisé. Le supprimer quand même ?')) return;
      }
      S.suppliers = S.suppliers.filter(x => x.name !== val);
    } else {
      S[key] = S[key].filter(x => x !== val);
    }
    Store.save('settings'); App.rerender();
  },

  _dimParts(dims) {
    if (!dims) return [];
    return String(dims).split(/[×*x]/i).map(part => {
      const m = part.trim().match(/([\d.]+)\s*(mm|cm|m)?/i);
      if (!m) return Infinity;
      let val = parseFloat(m[1]);
      const unit = (m[2] || '').toLowerCase();
      if (unit === 'cm') val *= 10;
      else if (unit === 'm') val *= 1000;
      return val;
    });
  },

  _dimSort(type) {
    return (a, b) => {
      const pa = this._dimParts(a.dims);
      const pb = this._dimParts(b.dims);
      if (type === 'blister') {
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const va = pa[i] ?? Infinity;
          const vb = pb[i] ?? Infinity;
          if (va !== vb) return va - vb;
        }
        return U.sortFr(a.dims || '', b.dims || '');
      }
      const va = pa.length ? pa.reduce((acc, v) => acc * v, 1) : Infinity;
      const vb = pb.length ? pb.reduce((acc, v) => acc * v, 1) : Infinity;
      if (va !== vb) return va - vb;
      return U.sortFr(a.dims || '', b.dims || '');
    };
  },

  _blisterDims(s) {
    if (!s.dims) return null;
    const parts = String(s.dims).split(/[×*x]/i);
    if (parts.length < 2) return null;
    const parse = (str) => {
      const m = str.trim().match(/([\d.]+)\s*(mm|cm|m)?/i);
      if (!m) return null;
      let val = parseFloat(m[1]);
      const unit = (m[2] || 'mm').toLowerCase();
      let mm = val;
      if (unit === 'cm') mm = val * 10;
      else if (unit === 'm') mm = val * 1000;
      return { val, unit, mm, str: m[1] + (m[2] || 'mm') };
    };
    const w = parse(parts[0]);
    const l = parse(parts[1]);
    if (!w || !l) return null;
    return { widthMm: w.mm, widthStr: w.str, lengthMm: l.mm, lengthStr: l.str };
  },

  _renameSachets() {
    const S = Store.state.settings;
    ['blister', 'sachet'].forEach(type => {
      const items = (S.sachets || []).filter(s => (s.type || 'sachet') === type);
      items.sort(this._dimSort(type));
      if (type === 'blister') {
        const rolls = S.blisterRolls || {};
        items.forEach(s => {
          const d = this._blisterDims(s);
          if (!d) { s.name = `Blister (${s.dims || '?'})`; return; }
          const roll = rolls[String(d.widthMm)];
          const conso = roll?.consumableId ? Store.state.consumables.find(c => c.id === roll.consumableId) : null;
          const prefix = conso ? conso.name : `Blister ${d.widthStr}`;
          s.name = `${prefix} — ${d.lengthStr}`;
        });
      } else {
        // Sachet lié à un consommable : nom + dimensions repris du consommable (lisible
        // partout : fiche prix, liste de choix, stats) — demande d'Antho 2026-09-26.
        items.forEach(s => {
          const conso = s.consumableId ? Store.state.consumables.find(c => c.id === s.consumableId) : null;
          if (conso) { s.name = conso.name || s.name; if (conso.dimensions) s.dims = conso.dimensions; }
        });
        items.sort(this._dimSort(type));
        let num = 0, lastDims = null, bisCount = 0;
        items.forEach(s => {
          if (s.consumableId && Store.state.consumables.some(c => c.id === s.consumableId)) return;
          const d = (s.dims || '').trim();
          if (d && d === lastDims) {
            bisCount++;
            s.name = `Sachet ${num} ${bisCount === 1 ? 'bis' : 'ter'}`;
          } else {
            num++; bisCount = 0; lastDims = d;
            s.name = `Sachet ${num}`;
          }
        });
      }
    });
    this._syncPackagingCosts();
  },

  _syncPackagingCosts() {
    const S = Store.state.settings;
    const rolls = S.blisterRolls || {};
    (S.sachets || []).forEach(s => {
      const type = s.type || 'sachet';
      if (type === 'blister') {
        const d = this._blisterDims(s);
        if (!d) return;
        const roll = rolls[String(d.widthMm)];
        if (!roll?.consumableId) return;
        const conso = Store.state.consumables.find(c => c.id === roll.consumableId);
        if (!conso || !U.num(conso.costUnit)) return;
        const unit = (conso.unit || 'm').toLowerCase();
        let len;
        if (unit === 'mm') len = d.lengthMm;
        else if (unit === 'cm') len = d.lengthMm / 10;
        else len = d.lengthMm / 1000;
        s.cost = Math.round(len * U.num(conso.costUnit) * 10000) / 10000;
      } else if (s.consumableId) {
        const conso = Store.state.consumables.find(c => c.id === s.consumableId);
        if (conso) s.cost = U.num(conso.costUnit);
      }
    });
  },

  _sachetTypeOpen: {},
  _blisterWidthOpen: {},
  _sachetGroupHTML(all, type, title, subtitle) {
    this._renameSachets();
    const items = all.filter(s => (s.type || 'sachet') === type).sort(this._dimSort(type));
    const isOpen = !!this._sachetTypeOpen[type];
    if (type === 'blister') return this._blisterGroupedHTML(items, isOpen);
    return `<details class="fold sachet-group" style="margin:10px 0;" ${isOpen ? 'open' : ''} ontoggle="Params._sachetTypeOpen['${type}']=this.open">
      <summary style="cursor:pointer;padding:8px 0;"><b style="font-size:1rem;color:var(--texte);">${title}</b> <span class="muted" style="font-size:.85rem;">(${items.length}) — ${subtitle}</span></summary>
      <div class="table-wrap"><table class="pack-table"><colgroup><col style="width:34%"><col style="width:28%"><col style="width:20%"><col></colgroup><thead><tr><th class="col-name">Nom</th><th>Dimensions</th><th class="num">Coût</th><th></th></tr></thead>
      <tbody>${items.map(s => {
        const conso = s.consumableId ? Store.state.consumables.find(c => c.id === s.consumableId) : null;
        return `<tr>
        <td class="col-name">${U.esc(s.name)}${conso ? ` <span class="badge ok" style="font-size:.7rem;" title="Lié à ${U.esc(conso.name)} — ${U.eur(conso.costUnit, 3)}/${U.esc(!conso.unit || conso.unit === 'pc' ? 'PCS' : conso.unit)}">🔗 lié</span>` : ''}</td>
        <td class="pack-dims">${U.esc(s.dims || '—')}</td>
        <td class="num">${conso
          ? U.eur(s.cost, 3) + ' <span class="muted" style="font-size:.75rem;">(auto)</span>'
          : `<input type="number" step="0.001" value="${s.cost}" style="width:80px;text-align:right;" onchange="Params.editSachetCost('${s.id}',this.value)">`}</td>
        <td class="right">
          <button class="btn-icon" onclick="Params.linkSachetConso('${s.id}')" title="${conso ? 'Modifier le lien' : 'Lier au consommable'}">${conso ? '✏️' : '🔗＋'}</button>
          ${conso ? `<button class="btn-icon" onclick="Params.unlinkSachetConso('${s.id}')" title="Délier">✕</button>` : ''}
          <button class="btn-icon" onclick="Params.delSachet('${s.id}')">🗑️</button>
        </td></tr>`;
      }).join('') || `<tr><td colspan="4" class="muted">Aucun sachet.</td></tr>`}
      </tbody></table></div>
    </details>`;
  },

  _blisterGroupedHTML(items, isOpen) {
    const S = Store.state.settings;
    const rolls = S.blisterRolls || {};
    const groups = {};
    items.forEach(s => {
      const d = this._blisterDims(s);
      const key = d ? String(d.widthMm) : 'other';
      const label = d ? d.widthStr : '?';
      if (!groups[key]) groups[key] = { label, key, items: [] };
      groups[key].items.push({ s, d });
    });
    const sorted = Object.values(groups).sort((a, b) => (parseInt(a.key) || 999999) - (parseInt(b.key) || 999999));
    return `<details class="fold sachet-group" style="margin:10px 0;" ${isOpen ? 'open' : ''} ontoggle="Params._sachetTypeOpen['blister']=this.open">
      <summary style="cursor:pointer;padding:8px 0;"><b style="font-size:1rem;color:var(--texte);">Blisters</b> <span class="muted" style="font-size:.85rem;">(${items.length}) — pour pièces & tailles</span></summary>
      ${sorted.map(g => {
        const roll = rolls[g.key];
        const conso = roll?.consumableId ? Store.state.consumables.find(c => c.id === roll.consumableId) : null;
        const isLinked = !!conso;
        const wOpen = !!this._blisterWidthOpen[g.key];
        const groupName = conso ? U.esc(conso.name) : `Blister ${U.esc(g.label)}`;
        return `<details class="fold" style="margin:4px 0 4px 8px;" ${wOpen ? 'open' : ''} ontoggle="Params._blisterWidthOpen['${g.key}']=this.open">
          <summary style="cursor:pointer;padding:6px 0;">
            <b>${groupName}</b> <span class="muted">(${g.items.length} longueur${g.items.length > 1 ? 's' : ''})</span>
            ${conso ? `<span class="badge ok" style="margin-left:8px;" title="Coût : ${U.eur(conso.costUnit)}/${U.esc(conso.unit||'m')}">🔗 lié</span>` : ''}
          </summary>
          <div class="table-wrap"><table class="pack-table"><colgroup><col style="width:40%"><col style="width:30%"><col></colgroup><thead><tr><th>Longueur</th><th class="num">Coût${isLinked ? ' <span class="muted" style="font-weight:normal;font-size:.75rem;">(auto)</span>' : ''}</th><th></th></tr></thead>
          <tbody>${g.items.map(({ s, d }) => `<tr>
            <td><input value="${d ? U.esc(d.lengthStr) : U.esc(s.dims || '')}" style="width:110px;" onchange="Params.editBlisterLength('${s.id}',this.value)"></td>
            <td class="num">${isLinked
              ? U.eur(s.cost, 3)
              : `<input type="number" step="0.001" value="${s.cost}" style="width:80px;text-align:right;" onchange="Params.editBlisterCost('${s.id}',this.value)">`}</td>
            <td class="right"><button class="btn-icon" onclick="Params.delSachet('${s.id}')">🗑️</button></td></tr>`).join('')}</tbody></table></div>
          <div style="margin:6px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button class="btn-ghost btn-sm" onclick="Params.addBlisterLength('${g.key}')">＋ Longueur</button>
            ${conso
              ? `<button class="btn-ghost btn-sm" onclick="Params.linkBlisterRoll('${g.key}')">✏️ Modifier le lien</button><button class="btn-ghost btn-sm" onclick="Params.unlinkBlisterRoll('${g.key}')">✕ Délier</button>`
              : `<button class="btn-ghost btn-sm" onclick="Params.linkBlisterRoll('${g.key}')">🔗＋ Lier au consommable</button>`}
          </div>
        </details>`;
      }).join('') || '<p class="muted">Aucun blister.</p>'}
    </details>`;
  },

  addSachet() {
    const existingWidths = [...new Set(
      Store.state.settings.sachets
        .filter(s => (s.type || 'sachet') === 'blister')
        .map(s => { const d = this._blisterDims(s); return d ? d.widthStr : null; })
        .filter(Boolean)
    )];
    const widthOpts = existingWidths.map(w => `<option value="${U.esc(w)}">${U.esc(w)}</option>`).join('');
    U.modal({
      title: 'Nouveau sachet / blister', okLabel: 'Ajouter',
      body: `<div class="fg"><label>Type</label><select id="sc_type" onchange="Params._toggleSachetFields()"><option value="sachet">Sachet</option><option value="blister">Blister</option></select></div>
      <div id="sc_sachet_fields"><div class="fg"><label>Dimensions</label><input id="sc_dims" placeholder="ex: 17×4×24"></div></div>
      <div id="sc_blister_fields" style="display:none;">
        <div class="fg"><label>Largeur du rouleau</label>
          <select id="sc_bwidth" onchange="document.getElementById('sc_bwidth_custom').style.display=this.value==='__new__'?'':'none'">
            ${widthOpts}
            <option value="__new__">Nouvelle largeur…</option>
          </select>
          <input id="sc_bwidth_custom" placeholder="ex: 200mm" style="display:${existingWidths.length ? 'none' : ''}; margin-top:4px;">
        </div>
        <div class="fg"><label>Longueur de découpe</label><input id="sc_blength" placeholder="ex: 25cm ou 1m"></div>
      </div>
      <div class="fg"><label>Coût (€)</label><input id="sc_cost" type="number" step="0.001"></div>`,
      onOk: () => {
        const type = U.val('sc_type');
        let dims;
        if (type === 'blister') {
          let width = U.val('sc_bwidth');
          if (width === '__new__' || !width) width = U.val('sc_bwidth_custom').trim();
          const length = U.val('sc_blength').trim();
          if (!width || !length) { U.toast('Largeur et longueur obligatoires', true); return false; }
          dims = width + '×' + length;
        } else {
          dims = U.val('sc_dims').trim();
          if (!dims) { U.toast('Dimensions obligatoires', true); return false; }
        }
        Store.state.settings.sachets.push({ id: U.uid(), name: '', type, cost: U.numVal('sc_cost'), dims });
        this._renameSachets();
        Store.save('settings'); U.closeModal(); App.rerender();
      }
    });
  },
  _toggleSachetFields() {
    const type = U.val('sc_type');
    const s = document.getElementById('sc_sachet_fields');
    const b = document.getElementById('sc_blister_fields');
    if (s) s.style.display = type === 'sachet' ? '' : 'none';
    if (b) b.style.display = type === 'blister' ? '' : 'none';
  },
  delSachet(id) {
    Store.state.settings.sachets = Store.state.settings.sachets.filter(s => String(s.id) !== String(id));
    this._renameSachets();
    Store.save('settings'); App.rerender();
  },
  /* Liste de choix d'un consommable dans une fenêtre (lier un sachet / un rouleau de blister) :
     même présentation que le choix du sachet du bloc 5 de Prix mastication (nom · dimensions · valeur),
     au lieu d'un <select> natif illisible. La valeur choisie va dans un champ caché #<id>. */
  _consoPickList(id, list, current, colC, headLabel) {
    const unitOf = c => (!c.unit || c.unit === 'pc') ? 'PCS' : c.unit;
    const sorted = list.slice().sort((a, b) => (Stock._dimVolume(Stock.consoDims(a)) - Stock._dimVolume(Stock.consoDims(b))) || U.sortFr(a.name, b.name));
    const row = (cid, a, b, c) => `<div class="pp-row${String(cid) === String(current || '') ? ' active' : ''}" data-v="${cid}" onclick="Params._pickConsoRow(this,'${id}')"><span class="pp-a">${a}</span><span class="pp-b">${b}</span><span class="pp-c">${c}</span></div>`;
    return `<input type="hidden" id="${id}" value="${U.esc(current || '')}">
      <div class="pp-list">
        ${row('', '<i>Aucun</i>', '', '')}
        <div class="pp-head">${headLabel}</div>
        ${sorted.map(c => row(c.id, U.esc(c.name), U.esc(Stock.consoDims(c) || '—'), colC(c, unitOf(c)))).join('')}
      </div>`;
  },
  _pickConsoRow(el, id) {
    el.parentElement.querySelectorAll('.pp-row').forEach(r => r.classList.toggle('active', r === el));
    const inp = document.getElementById(id); if (inp) inp.value = el.dataset.v || '';
  },
  linkBlisterRoll(widthKey) {
    const all = Store.state.consumables;
    if (!all.length) { U.toast('Aucun consommable en stock — ajoute d\'abord le rouleau dans Stock > Consommables.', true); return; }
    const consos = all.filter(c => c.category === 'Blisters');
    const list = consos.length ? consos : all;
    const S = Store.state.settings;
    const current = (S.blisterRolls || {})[widthKey]?.consumableId || '';
    const picker = this._consoPickList('bl_conso', list, current, (c, u) => `${U.qty(c.qty)} ${U.esc(u)}`, '🎞️ Rouleaux' + (consos.length ? '' : ' (tous les consommables)'));
    U.modal({
      title: 'Lier Blister ' + widthKey + 'mm au consommable', okLabel: 'Enregistrer',
      body: `<div class="fg"><label>Consommable (rouleau en stock)</label>${picker}</div>
      <p class="muted">Sélectionne le rouleau de blister correspondant dans le stock Consommables.<br>La longueur sera déduite du stock quand un lot utilisant ce blister est créé.${consos.length ? '' : ' <br>⚠️ Aucun consommable de catégorie « Blisters » trouvé — tous les consommables sont affichés.'}</p>`,
      onOk: () => {
        if (!S.blisterRolls) S.blisterRolls = {};
        const id = U.val('bl_conso');
        if (id) S.blisterRolls[widthKey] = { consumableId: id };
        else delete S.blisterRolls[widthKey];
        Store.save('settings'); U.closeModal(); App.rerender();
      }
    });
  },
  unlinkBlisterRoll(widthKey) {
    const S = Store.state.settings;
    if (S.blisterRolls) delete S.blisterRolls[widthKey];
    Store.save('settings'); App.rerender();
    U.toast('Lien consommable retiré.');
  },
  addBlisterLength(widthKey) {
    U.modal({
      title: 'Ajouter une longueur — Blister ' + widthKey + 'mm',
      okLabel: 'Ajouter',
      body: `<div class="fg"><label>Longueur de découpe</label><input id="bl_len" placeholder="ex: 30cm ou 1.5m"></div>`,
      onOk: () => {
        const len = U.val('bl_len').trim();
        if (!len) { U.toast('Longueur obligatoire', true); return false; }
        const dims = widthKey + 'mm×' + len;
        if (Store.state.settings.sachets.some(s => s.type === 'blister' && s.dims === dims)) { U.toast('Cette longueur existe déjà', true); return false; }
        Store.state.settings.sachets.push({ id: U.uid(), name: '', type: 'blister', cost: 0, dims });
        this._renameSachets();
        Store.save('settings'); U.closeModal(); App.rerender();
      }
    });
  },
  editBlisterLength(id, val) {
    const s = Store.state.settings.sachets.find(x => String(x.id) === String(id));
    if (!s) return;
    const d = this._blisterDims(s);
    if (!d) return;
    const newLen = val.trim();
    if (!newLen) return;
    s.dims = d.widthStr + '×' + newLen;
    this._renameSachets();
    Store.save('settings'); App.rerender();
  },
  editBlisterCost(id, val) {
    const s = Store.state.settings.sachets.find(x => String(x.id) === String(id));
    if (!s) return;
    s.cost = U.num(val);
    Store.save('settings');
  },
  linkSachetConso(id) {
    const s = Store.state.settings.sachets.find(x => String(x.id) === String(id));
    if (!s) return;
    const all = Store.state.consumables;
    if (!all.length) { U.toast('Aucun consommable en stock — ajoute d\'abord ce sachet dans Stock > Consommables.', true); return; }
    const consos = all.filter(c => c.category === 'Sachets');
    const list = consos.length ? consos : all;
    const current = s.consumableId || '';
    const picker = this._consoPickList('sac_conso', list, current, (c, u) => `${U.eur(c.costUnit, 3)} / ${U.esc(u)}`, '🛍️ Sachets' + (consos.length ? '' : ' (tous les consommables)'));
    U.modal({
      title: 'Lier ' + (s.name || 'ce sachet') + ' au consommable', okLabel: 'Enregistrer',
      body: `<div class="fg"><label>Consommable (sachet en stock)</label>${picker}</div>
      <p class="muted">Le coût de ce sachet reprendra automatiquement le coût / unité du consommable choisi.${consos.length ? '' : ' <br>⚠️ Aucun consommable de catégorie « Sachets » trouvé — tous les consommables sont affichés.'}</p>`,
      onOk: () => {
        const cid = U.val('sac_conso');
        if (cid) s.consumableId = cid; else delete s.consumableId;
        this._renameSachets();
        Store.save('settings'); U.closeModal(); App.rerender();
      }
    });
  },
  unlinkSachetConso(id) {
    const s = Store.state.settings.sachets.find(x => String(x.id) === String(id));
    if (!s) return;
    delete s.consumableId;
    Store.save('settings'); App.rerender();
    U.toast('Lien consommable retiré.');
  },
  editSachetCost(id, val) {
    const s = Store.state.settings.sachets.find(x => String(x.id) === String(id));
    if (!s) return;
    s.cost = U.num(val);
    Store.save('settings');
  },

  /* ---------- produits par conditionnement ---------- */
  _packagingOverviewOpen: false,
  _packagingFilter: 'all',
  _packagingDetail: null,

  _renderPackagingOverview() {
    const S = Store.state.settings;
    const cats = Store.state.catalogM || [];
    const sacMap = {};
    const unassignedList = [];
    cats.forEach(p => {
      (p.variants || []).forEach(v => {
        const sid = v.sachetId;
        if (!sid || sid === '0') { unassignedList.push({ p, v }); return; }
        if (!sacMap[sid]) sacMap[sid] = [];
        sacMap[sid].push({ p, v });
      });
    });
    const sachets = (S.sachets || []).slice();
    const blisters = sachets.filter(s => (s.type || 'sachet') === 'blister').sort(this._dimSort('blister'));
    const sachetList = sachets.filter(s => (s.type || 'sachet') === 'sachet').sort(this._dimSort('sachet'));

    const filter = this._packagingFilter || 'sachet';
    const isOpen = !!this._packagingOverviewOpen;
    const detailId = this._packagingDetail;
    const showEmpty = !!this._packagingShowEmpty;

    const tabBtn = (id, label, count) => {
      const active = filter === id;
      return `<a href="#" onclick="event.preventDefault();Params._packagingFilter='${id}';Params._packagingDetail=null;App.rerender();" style="text-decoration:${active?'none':'underline'};color:${id==='none'&&count?'var(--warn)':'var(--caramel)'};${active?'font-weight:700;':''}">${label} (${count})</a>`;
    };
    const sachetUsed = sachetList.filter(s => (sacMap[s.id]||[]).length > 0).length;
    const blisterUsed = blisters.filter(s => (sacMap[s.id]||[]).length > 0).length;

    let listHTML = '';
    const renderItems = (items, title) => {
      if (!items.length) return `<p class="muted" style="margin:6px 0;">Aucune variante.</p>`;
      return `<div class="table-wrap" style="max-height:400px;overflow:auto;"><table><thead><tr><th class="col-name">Produit</th><th>Variante</th><th></th></tr></thead>
        <tbody>${items.map(({ p, v }) => `<tr>
          <td class="col-name"><a href="#/catalogue/edit/${p.id}" style="color:var(--caramel-2);text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${U.esc(p.name)}</a></td>
          <td>${U.esc(v.label || v.value || '—')}</td>
          <td style="white-space:nowrap;"><a href="#/catalogue/edit/${p.id}" class="btn-ghost btn-sm" style="text-decoration:none;padding:2px 8px;">✏️</a></td>
        </tr>`).join('')}</tbody></table></div>`;
    };

    if (filter === 'none') {
      listHTML = renderItems(unassignedList);
    } else {
      const list = filter === 'blister' ? blisters : sachetList;
      const filtered = showEmpty ? list : list.filter(s => (sacMap[s.id]||[]).length > 0);
      const hiddenCount = list.length - list.filter(s => (sacMap[s.id]||[]).length > 0).length;
      if (!filtered.length) {
        listHTML = `<p class="muted" style="margin:6px 0;">Aucun ${filter === 'blister' ? 'blister' : 'sachet'} utilisé.</p>`;
      } else {
        listHTML = filtered.map(s => {
          const items = sacMap[s.id] || [];
          const count = items.length;
          const isActive = String(detailId) === String(s.id);
          return `<div style="margin:6px 0;border:1px solid var(--card-border);border-radius:8px;background:var(--card-bg);${isActive?'border-left:3px solid var(--caramel);':''}">
            <a href="#" onclick="event.preventDefault();Params._packagingDetail=${isActive ? 'null' : "'" + s.id + "'"};App.rerender();" style="color:var(--caramel-2);text-decoration:none;display:flex;align-items:center;gap:8px;padding:10px 14px;${!count?'opacity:.5;':''}" onmouseover="this.querySelector('b').style.textDecoration='underline'" onmouseout="this.querySelector('b').style.textDecoration='none'">
              <span style="font-size:.75rem;color:var(--caramel);transition:transform .15s;${isActive?'transform:rotate(90deg);':''}"">▸</span>
              <b style="flex:1;">${U.esc(s.name)}</b>
              <span class="badge info" style="font-size:.8rem;">${count} variante${count > 1 ? 's' : ''}</span>
            </a>
            ${isActive ? `<div style="padding:0 14px 10px 14px;border-top:1px solid var(--card-border);">${renderItems(items)}</div>` : ''}
          </div>`;
        }).join('');
        if (hiddenCount > 0 && !showEmpty) {
          listHTML += `<a href="#" onclick="event.preventDefault();Params._packagingShowEmpty=true;App.rerender();" class="muted" style="font-size:.8rem;margin-top:4px;display:inline-block;">${hiddenCount} sans variante — afficher</a>`;
        } else if (showEmpty && hiddenCount > 0) {
          listHTML += `<a href="#" onclick="event.preventDefault();Params._packagingShowEmpty=false;App.rerender();" class="muted" style="font-size:.8rem;margin-top:4px;display:inline-block;">Masquer les vides</a>`;
        }
      }
    }

    return `<details class="fold" style="margin-top:10px;" ${isOpen ? 'open' : ''} ontoggle="Params._packagingOverviewOpen=this.open">
      <summary style="cursor:pointer;padding:6px 0;"><b style="font-size:1rem;color:var(--texte);">📋 Produits par conditionnement</b></summary>
      <div style="display:flex;gap:16px;align-items:center;justify-content:center;flex-wrap:wrap;margin:12px 0;">
        ${tabBtn('sachet', 'Sachets', sachetUsed)} · ${tabBtn('blister', 'Blisters', blisterUsed)} · ${tabBtn('none', 'Non assigné', unassignedList.length)}
      </div>
      <div style="padding:0 8px;">
      ${listHTML}
      </div>
      ${filter !== 'none' ? this._renderMigrateBlock(sacMap) : ''}
    </details>`;
  },

  _renderMigrateBlock(sacMap) {
    const S = Store.state.settings;
    const sachets = S.sachets || [];
    if (sachets.length < 2) return '';

    const sachetList = sachets.filter(s => (s.type || 'sachet') === 'sachet').sort(this._dimSort('sachet'));
    const blisterList = sachets.filter(s => (s.type || 'sachet') === 'blister').sort(this._dimSort('blister'));
    const buildOpts = (excludeId) => {
      let html = '';
      if (sachetList.length) {
        html += '<optgroup label="Sachets">';
        sachetList.forEach(s => {
          if (String(s.id) === String(excludeId)) return;
          const cnt = (sacMap[s.id] || []).length;
          html += `<option value="${s.id}">${U.esc(s.name)}${cnt ? ' (' + cnt + ')' : ''}</option>`;
        });
        html += '</optgroup>';
      }
      if (blisterList.length) {
        html += '<optgroup label="Blisters">';
        blisterList.forEach(s => {
          if (String(s.id) === String(excludeId)) return;
          const cnt = (sacMap[s.id] || []).length;
          html += `<option value="${s.id}">${U.esc(s.name)}${cnt ? ' (' + cnt + ')' : ''}</option>`;
        });
        html += '</optgroup>';
      }
      html += '<optgroup label="—"><option value="0">Aucun (retirer)</option></optgroup>';
      return html;
    };

    const fromOpts = (() => {
      let html = '';
      if (sachetList.length) {
        html += '<optgroup label="Sachets">';
        sachetList.forEach(s => {
          const cnt = (sacMap[s.id] || []).length;
          html += `<option value="${s.id}">${U.esc(s.name)} (${cnt})</option>`;
        });
        html += '</optgroup>';
      }
      if (blisterList.length) {
        html += '<optgroup label="Blisters">';
        blisterList.forEach(s => {
          const cnt = (sacMap[s.id] || []).length;
          html += `<option value="${s.id}">${U.esc(s.name)} (${cnt})</option>`;
        });
        html += '</optgroup>';
      }
      return html;
    })();

    const firstId = sachetList[0]?.id || blisterList[0]?.id || '';
    return `<div style="margin-top:12px;padding:10px 14px;border:1.5px dashed var(--caramel);border-radius:8px;background:rgba(166,113,83,0.06);">
      <b style="font-size:.9rem;color:var(--caramel);">↔ Migrer un conditionnement</b>
      <div class="frow mt" style="align-items:flex-end;gap:10px;">
        <div class="fg"><label>Conditionnement actuel</label><select id="mig_from" onchange="Params._updateMigrateTo()">${fromOpts}</select></div>
        <div style="font-size:1.3rem;padding-bottom:6px;color:var(--caramel);">→</div>
        <div class="fg"><label>Nouveau conditionnement</label><select id="mig_to">${buildOpts(firstId)}</select></div>
        <div class="fg" style="flex:0;"><button class="btn-cta" onclick="Params.migratePackaging()">Migrer</button></div>
      </div>
      <p class="muted" style="margin:6px 0 0;font-size:.8rem;" id="mig_info"></p>
    </div>`;
  },

  _updateMigrateTo() {
    const fromId = U.val('mig_from');
    const S = Store.state.settings;
    const sachets = S.sachets || [];
    const sachetList = sachets.filter(s => (s.type || 'sachet') === 'sachet').sort(this._dimSort('sachet'));
    const blisterList = sachets.filter(s => (s.type || 'sachet') === 'blister').sort(this._dimSort('blister'));
    const cats = Store.state.catalogM || [];
    const sacMap = {};
    cats.forEach(p => (p.variants || []).forEach(v => {
      const sid = v.sachetId;
      if (sid && sid !== '0') { if (!sacMap[sid]) sacMap[sid] = []; sacMap[sid].push(v); }
    }));
    let html = '';
    if (sachetList.length) {
      html += '<optgroup label="Sachets">';
      sachetList.forEach(s => {
        if (String(s.id) === String(fromId)) return;
        const cnt = (sacMap[s.id] || []).length;
        html += `<option value="${s.id}">${U.esc(s.name)}${cnt ? ' (' + cnt + ')' : ''}</option>`;
      });
      html += '</optgroup>';
    }
    if (blisterList.length) {
      html += '<optgroup label="Blisters">';
      blisterList.forEach(s => {
        if (String(s.id) === String(fromId)) return;
        const cnt = (sacMap[s.id] || []).length;
        html += `<option value="${s.id}">${U.esc(s.name)}${cnt ? ' (' + cnt + ')' : ''}</option>`;
      });
      html += '</optgroup>';
    }
    html += '<optgroup label="—"><option value="0">Aucun (retirer)</option></optgroup>';
    const toEl = document.getElementById('mig_to');
    if (toEl) toEl.innerHTML = html;
  },

  async migratePackaging() {
    const fromId = U.val('mig_from');
    const toId = U.val('mig_to');
    if (!fromId) { U.toast('Sélectionne un conditionnement source.', true); return; }
    if (fromId === toId) { U.toast('Source et destination identiques.', true); return; }

    const S = Store.state.settings;
    const sachets = S.sachets || [];
    const from = sachets.find(s => String(s.id) === String(fromId));
    if (!from) return;

    const cats = Store.state.catalogM || [];
    let count = 0;
    cats.forEach(p => (p.variants || []).forEach(v => { if (String(v.sachetId) === String(fromId)) count++; }));
    if (!count) { U.toast('Aucune variante n\'utilise « ' + from.name + ' ».', true); return; }

    const toSac = toId === '0' ? null : sachets.find(s => String(s.id) === String(toId));
    const toLabel = toSac ? toSac.name : 'Aucun';

    if (!await U.confirm(`Migrer ${count} variante${count > 1 ? 's' : ''} de « ${from.name} » vers « ${toLabel} » ?`)) return;

    let migrated = 0;
    cats.forEach(p => {
      let touched = false;
      (p.variants || []).forEach(v => {
        if (String(v.sachetId) === String(fromId)) {
          if (!touched) { Store.commitSnapshot(Store.snapshot('catalogM', p), 'migrate', `Migration conditionnement : ${from.name}`); touched = true; }
          v.sachetId = toId;
          migrated++;
        }
      });
    });
    Store.save('catalogM');
    const entry = Store.log('settings', `${migrated} variante${migrated > 1 ? 's' : ''} migrée${migrated > 1 ? 's' : ''} de « ${from.name} » vers « ${toLabel} »`);
    U.toast(`${migrated} variante${migrated > 1 ? 's' : ''} migrée${migrated > 1 ? 's' : ''}.`, false, entry?.id);
    App.rerender();
  },

  /* ---------- import de l'ancien calculateur ---------- */
  /* ---------- import universel : détecte le format ---------- */
  _captureImportFile(input) {
    this._pendingImportFile = input.files && input.files[0] ? input.files[0] : null;
    const lbl = document.getElementById('importFileLabel');
    if (lbl) {
      if (this._pendingImportFile) { lbl.textContent = '✓ Fichier prêt : ' + this._pendingImportFile.name; lbl.style.display = ''; }
      else { lbl.style.display = 'none'; }
    }
  },

  importAuto() {
    const file = this._pendingImportFile || document.getElementById('importFile').files[0];
    if (!file) { U.toast('Choisis d\u2019abord un fichier à importer.', true); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch (e) { U.toast('Ce fichier n\u2019est pas un JSON lisible.', true); return; }
      const fmt = this.detectFormat(data);
      try {
        if (fmt === 'backup') {
          if (!await U.confirm('Ce fichier est une sauvegarde complète. La restaurer va REMPLACER toutes tes données actuelles. Continuer ?')) return;
          Store.state = Store.merge(data);
          Store.log('restauration', 'Restauration depuis une sauvegarde complète');
          Store.save(...Store.DOMAINS);
          U.toast('Sauvegarde restaurée.'); App.go('dashboard'); return;
        }
        if (fmt === 'calculator') {
          const r = this.mapPrixData(data);
          const nl = this.linkStockToCatalog();
          Store.log('import', `Import calculateur : ${r.products} produits`);
          Store.save('catalogM', 'stockM', 'consumables', 'settings');
          U.toast(`Calculateur importé : ${r.products} produits${r.blisters ? ', ' + r.blisters + ' conso blister' : ''}${nl ? `, ${nl} produits stock reliés` : ''}.`);
          App.go('catalogue'); return;
        }
        if (fmt === 'stock') {
          const existing = Store.state.stockM.length + Store.state.materials.length;
          if (existing > 0 && !await U.confirm(`Tu as déjà ${existing} article(s) en stock. Les produits déjà importés (même nom) seront mis à jour, les nouveaux ajoutés. Continuer ?`)) return;
          const r = this.mapStockData(data);
          const nl = this.linkStockToCatalog();
          Store.log('import', `Import stock : ${r.stockM} mastication + ${r.materials} matières + ${r.consumables} conso`);
          Store.save('stockM', 'materials', 'consumables', 'catalogM', 'settings');
          U.toast(`Stock importé : ${r.stockM} mastication, ${r.materials} matières, ${r.consumables} conso (${r.lots} lots)${nl ? ` · ${nl} reliés au catalogue` : ''}.`);
          App.go('stock'); return;
        }
        if (fmt === 'saleshistory') {
          if (!await U.confirm('Ce fichier est un HISTORIQUE DE VENTES de ton ancienne appli.\n\nIl sera ajout\u00e9 aux statistiques (ventes historiques, avec leur date d\'origine) SANS toucher \u00e0 ton stock actuel.\nLes prix sont estim\u00e9s d\'apr\u00e8s tes prix de vente ACTUELS (le fichier n\'en contient pas).\n\nContinuer ?')) return;
          const r = this.mapSalesHistory(data);
          Store.log('import', `Import historique de ventes : ${r.created} ticket(s), ${r.entries} lignes`);
          Store.save('sales');
          U.toast(`\ud83d\udcda Historique import\u00e9 : ${r.created} ticket(s) \u00b7 ${r.matched} ligne(s) reli\u00e9es \u00e0 un produit, ${r.unmatched} par nom seul${r.skipped ? `, ${r.skipped} d\u00e9j\u00e0 import\u00e9e(s)` : ''}. Stock NON touch\u00e9.`);
          App.go('stats'); return;
        }
        U.toast('Format non reconnu. Envoie-moi le fichier si besoin, je l\u2019ajouterai.', true);
      } catch (e) { U.toast('Import impossible : ' + e.message, true); }
    };
    reader.readAsText(file);
  },

  /* Relie les produits du stock au catalogue prix : par SKU d'abord, puis par nom.
     Fait remonter le SKU vers le catalogue (pour l'export WooCommerce) et
     permet au tableau de bord d'attacher quantités + coûts. */
  linkStockToCatalog() {
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    let linked = 0;
    Store.state.stockM.forEach(sp => {
      if (sp.catalogId && Store.state.catalogM.some(c => c.id === sp.catalogId)) return;
      let cat = null;
      for (const sv of sp.variants) {
        if (!sv.sku) continue;
        cat = Store.state.catalogM.find(c => (c.variants || []).some(x => x.sku && norm(x.sku) === norm(sv.sku)));
        if (cat) break;
      }
      if (!cat) cat = Store.state.catalogM.find(c => norm(c.name) === norm(sp.name));
      if (!cat) return;
      this.applyLink(sp, cat); linked++;
    });
    return linked;
  },

  /* Applique une liaison stock ↔ catalogue : id + variantes (par SKU puis par
     libellé/valeur), et pousse le nom/prix du catalogue vers la fiche stock
     (Stock.syncPricesFromCatalog, la même chose que fait "Modifier le produit"
     à la main) — sans ça, la fiche stock garde son ancien nom/prix même une
     fois reliée, ce qui ne réglerait pas le doublon visuel côté Dashboard. */
  applyLink(sp, cat) {
    const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const sameVar = (cv, sv) => {
      if ((cv.mode === 'gram' || cv.mode === 'piece') && sv.mode === cv.mode) return U.num(cv.value) === U.num(sv.value);
      return norm(cv.label || Pricing.labelVariant(cv)) === norm(sv.label || '');
    };
    sp.catalogId = cat.id;
    sp.variants.forEach(sv => {
      let cv = sv.sku ? (cat.variants || []).find(x => x.sku && norm(x.sku) === norm(sv.sku)) : null;
      if (!cv) cv = (cat.variants || []).find(x => sameVar(x, sv));
      if (cv) { sv.catalogVariantId = cv.id; if (sv.sku && !cv.sku) cv.sku = sv.sku; }
    });
    Stock.syncPricesFromCatalog(cat.id);
  },

  /* Liste des doublons : fiches prix liées à plusieurs produits stock + liens fournisseur
     partagés (mastication + consommables). Noms cliquables → produit dans le Stock. */
  /* Types d'étiquette (Réglages → Consommables) : nom + coût, ★ = type par défaut des nouvelles fiches prix. */
  labelTypesHTML() {
    const S = Store.state.settings, list = Store.labelTypes(), def = Store.labelDefault();
    const used = id => Store.state.catalogM.filter(p => p.labelTypeId === id).length;
    return `<div class="label-types">
      <div class="lt-row lt-head"><span>Défaut</span><span>Type d'étiquette</span><span>Coût (€)</span><span>Fiches</span><span></span></div>
      ${list.map(t => `<div class="lt-row">
        <span><input type="radio" name="lt_def" ${def && def.id === t.id ? 'checked' : ''} title="Type proposé pour les nouvelles fiches prix" onchange="Params.setLabelDefault('${t.id}')" style="width:18px;height:18px;"></span>
        <input value="${U.esc(t.name)}" onchange="Params.setLabelType('${t.id}','name',this.value)">
        <input type="number" step="0.001" min="0" value="${U.num(t.cost)}" onchange="Params.setLabelType('${t.id}','cost',this.value)">
        <span class="muted">${used(t.id)}</span>
        <button class="btn-icon" title="Supprimer ce type" onclick="Params.delLabelType('${t.id}')">🗑️</button>
      </div>`).join('')}
      <button class="btn-ghost btn-sm mt" onclick="Params.addLabelType()">＋ Ajouter un type d'étiquette</button>
    </div>`;
  },
  setLabelType(id, field, val) {
    const t = Store.labelType(id); if (!t) return;
    t[field] = field === 'cost' ? U.num(val) : (String(val).trim() || t.name);
    if (Store.state.settings.labelDefaultId === id && field === 'cost') Store.state.settings.labelCost = t.cost;
    Store.state.catalogM.forEach(p => { if (p.labelTypeId === id) p.labelCost = U.num(t.cost); });
    Store.save('settings', 'catalogM'); App.rerender();
  },
  setLabelDefault(id) {
    const S = Store.state.settings, t = Store.labelType(id); if (!t) return;
    S.labelDefaultId = id; S.labelCost = U.num(t.cost);
    Store.save('settings'); App.rerender();
  },
  addLabelType() {
    const S = Store.state.settings;
    S.labelTypes = Store.labelTypes(); S.labelTypes.push({ id: 'lt_' + U.uid(), name: 'Nouveau type', cost: 0 });
    Store.save('settings'); App.rerender();
  },
  async delLabelType(id) {
    const S = Store.state.settings, t = Store.labelType(id); if (!t) return;
    if (S.labelTypes.length <= 1) { U.toast('Garde au moins un type d\'étiquette.', true); return; }
    const users = Store.state.catalogM.filter(p => p.labelTypeId === id);
    if (!await U.confirm(`Supprimer « ${t.name} » ?` + (users.length ? `\n\n${users.length} fiche(s) prix l'utilisent : elles passeront sur « Autre montant » en gardant ${U.eur(t.cost)}.` : ''))) return;
    users.forEach(p => { p.labelTypeId = ''; p.labelCost = U.num(t.cost); });
    S.labelTypes = S.labelTypes.filter(x => x.id !== id);
    if (S.labelDefaultId === id) { S.labelDefaultId = S.labelTypes[0].id; S.labelCost = U.num(S.labelTypes[0].cost); }
    Store.save('settings', 'catalogM'); App.rerender();
  },
  _toggleDup(el) {   // contenu calculé à l'ouverture seulement (jamais de calcul inutile) : on le remplit au moment du dépliage
    this._dupOpen = el.open;
    if (el.open) { const body = el.querySelector(':scope > .fold-body'); if (body && !body.innerHTML.trim()) body.innerHTML = this._renderDupCheck(); }
  },
  _renderDupCheck() {
    const link = o => o.kind === 'C' ? `<a href="#/stock/conso">${U.esc(o.name)}</a> <span class="muted">(consommable)</span>`
      : o.kind === 'T' ? `<a href="#/stock/matieres">${U.esc(o.name)}</a> <span class="muted">(matière)</span>`
      : o.kind === 'P' ? `<a href="#/catalogue/edit/${o.id}">${U.esc(o.name)}</a> <span class="muted">(prix mastication)</span>`
      : `<a href="#/stock/mastication/${o.pId || o.id}">${U.esc(o.name)}</a>`;
    const byCat = {};
    Store.state.stockM.forEach(sp => { if (sp.catalogId) (byCat[sp.catalogId] = byCat[sp.catalogId] || []).push(sp); });
    const catDups = Object.entries(byCat).filter(([, l]) => l.length > 1).map(([cid, l]) => {
      const cat = Store.state.catalogM.find(c => c.id === cid);
      return { name: cat ? cat.name : '(fiche supprimée)', items: l.map(sp => ({ kind: 'M', id: sp.id, name: sp.name })) };
    }).sort((a, b) => U.sortFr(a.name, b.name));
    const ent = Stock.supplierEntries();
    const group = (list, norm) => { const g = {}; list.forEach(o => { const k = norm(o.val); if (k) (g[k] = g[k] || { url: o.val, items: [] }).items.push(o); }); return Object.values(g).filter(x => x.items.length > 1); };
    const urlDups = group(ent.urls, u => Stock.normUrl(u));
    const refDups = group(ent.refs, r => Stock.normRef(r));
    const siteDups = group(ent.siteUrls, u => Stock.normUrl(u));
    const table = (rows, head) => `<div class="table-wrap"><table><thead><tr><th>${head}</th><th>Produits concernés</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    const catHTML = catDups.length
      ? table(catDups.map(d => `<tr><td>${U.esc(d.name)}</td><td>${d.items.map(link).join(' · ')}</td></tr>`), 'Fiche prix')
      : '<p class="muted">✅ Aucune fiche prix liée à plusieurs produits.</p>';
    const urlHTML = urlDups.length
      ? table(urlDups.map(g => `<tr><td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${U.esc(g.url)}"><a href="${U.esc(g.url)}" target="_blank" rel="noopener">${U.esc(g.url)}</a></td><td>${g.items.map(link).join(' · ')}</td></tr>`), 'Lien fournisseur')
      : '<p class="muted">✅ Aucun lien fournisseur en double.</p>';
    const refHTML = refDups.length
      ? table(refDups.map(g => `<tr><td><span class="tag">${U.esc(g.url)}</span></td><td>${g.items.map(link).join(' · ')}</td></tr>`), 'Réf. fournisseur')
      : '<p class="muted">✅ Aucune référence fournisseur en double.</p>';
    const siteHTML = siteDups.length
      ? table(siteDups.map(g => `<tr><td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${U.esc(g.url)}"><a href="${U.esc(g.url)}" target="_blank" rel="noopener">${U.esc(g.url)}</a></td><td>${g.items.map(link).join(' · ')}</td></tr>`), 'Lien site Touffu')
      : '<p class="muted">✅ Aucun lien site Touffu en double.</p>';
    return `<p class="muted help mb0">Liens et réf. fournisseur : Prix mastication, matières premières et consommables. Liens site Touffu : produits du stock mastication. Les alertes ne bloquent rien : un doublon peut être voulu (ex. une page qui sert à plusieurs couleurs). Clique un nom pour ouvrir le produit et corriger.</p>
      <h3 class="mt">🔗 Fiches prix liées à plusieurs produits stock (${catDups.length})</h3>${catHTML}
      <h3 class="mt">🌐 Liens fournisseur en double (${urlDups.length})</h3>${urlHTML}
      <h3 class="mt">🏷️ Références fournisseur en double (${refDups.length})</h3>${refHTML}
      <h3 class="mt">🏠 Liens site Touffu en double (${siteDups.length})</h3>${siteHTML}`;
  },

  relink() {
    const n = this.linkStockToCatalog();
    Store.save('stockM', 'catalogM');
    U.toast(n ? `${n} produit(s) du stock reliés au catalogue.` : 'Aucune nouvelle liaison trouvée (déjà reliés ou noms différents).');
    App.rerender();
  },

  /* Filet de sécurité : force la resynchro (prix, variantes, SKU) de TOUS les produits
     stock DÉJÀ reliés à une fiche catalogue — jamais de nouvelle liaison ni de création
     de variante (Stock.syncPricesFromCatalog garde ses garde-fous habituels), juste un
     rattrapage en masse au cas où un produit aurait été manqué. Annulable en un clic. */
  async resyncAllFromCatalog() {
    const linked = Store.state.stockM.filter(p => p.catalogId && Store.state.catalogM.some(c => c.id === p.catalogId));
    if (!linked.length) { U.toast('Aucun produit relié au catalogue à resynchroniser.', true); return; }
    if (!await U.confirm(`Resynchroniser ${linked.length} produit(s) déjà reliés au catalogue prix (prix, variantes, SKU) ?`)) return;
    const snaps = linked.map(p => Store.snapshot('stockM', p));
    const catIds = [...new Set(linked.map(p => p.catalogId))];
    catIds.forEach(id => {
      const cat = Store.state.catalogM.find(c => c.id === id);
      if (cat) snaps.push(Store.snapshot('catalogM', cat));
    });
    catIds.forEach(id => Stock.syncPricesFromCatalog(id));
    const entry = Store.log('paramètres', `Resynchronisation globale Stock ↔ Catalogue : ${linked.length} produit(s), ${catIds.length} fiche(s) prix`, { type: 'restoreBatch', data: snaps });
    Store.save('stockM', 'catalogM');
    U.toast(`${linked.length} produit(s) resynchronisé(s).`, false, entry.id);
    App.rerender();
  },

  /* ---------- normalisation des variantes ---------- */
  /* Fusionne, au sein d'un même produit, les variantes qui partagent désormais le même
     libellé affiché (ex: après un renommage "100g" → "100G") : les lots sont regroupés. */
  mergeSameLabelVariants(p) {
    const seen = {};
    p.variants = p.variants.filter(v => {
      const key = Pricing.labelVariant(v);
      if (seen[key]) { seen[key].lots.push(...v.lots); return false; }
      seen[key] = v; return true;
    });
  },

  renameVariantEverywhere(oldLabel, newLabel) {
    if (!newLabel || oldLabel === newLabel) return 0;
    let count = 0;
    Store.state.stockM.forEach(p => {
      p.variants.forEach(v => { if (Pricing.labelVariant(v) === oldLabel) { v.label = newLabel; count++; } });
      this.mergeSameLabelVariants(p);
    });
    return count;
  },
  /* ---------- SKU ---------- */
  setMeatAbbrev(mt, val) {
    const S = Store.state.settings;
    if (!S.meatAbbrev) S.meatAbbrev = {};
    S.meatAbbrev[mt] = Pricing.slugify(val).substring(0, 6);
    Store.save('settings');
  },
  setMatAbbrev(kind, val) {
    const S = Store.state.settings;
    if (!S.matAbbrev) S.matAbbrev = {};
    S.matAbbrev[kind] = Pricing.slugify(val).substring(0, 6);
    Store.save('settings');
  },
  setFabSeg(cat, idx, field, val) {
    const S = Store.state.settings;
    if (!S.accFabDefaults) S.accFabDefaults = {};
    if (!S.accFabDefaults[cat]) S.accFabDefaults[cat] = { segments: [] };
    const segs = S.accFabDefaults[cat].segments;
    if (!segs[idx]) return;
    if (field === 'value') segs[idx].value = U.num(val);
    else segs[idx].label = val.trim();
    Store.save('settings');
  },

  addFabSeg(cat) {
    const S = Store.state.settings;
    if (!S.accFabDefaults) S.accFabDefaults = {};
    if (!S.accFabDefaults[cat]) S.accFabDefaults[cat] = { segments: [] };
    S.accFabDefaults[cat].segments.push({ label: 'Nouveau segment', value: 0 });
    Store.save('settings'); App.rerender();
  },

  delFabSeg(cat, idx) {
    const segs = Store.state.settings.accFabDefaults?.[cat]?.segments;
    if (!segs) return;
    segs.splice(idx, 1);
    Store.save('settings'); App.rerender();
  },

  async regenMatSkus() {
    const mats = Store.state.materials;
    const changed = [];
    mats.forEach(m => {
      const newSku = Pricing.autoSkuMat(m.name, m.kind, m.variant);
      if (m.sku !== newSku) { changed.push({ m, old: m.sku, new: newSku }); }
    });
    if (!changed.length) { U.toast('Tous les SKU matières sont déjà à jour.'); return; }
    if (!await U.confirm(`Régénérer ${changed.length} SKU matières ?`)) return;
    changed.forEach(c => { c.m.sku = c.new; });
    Store.log('paramètres', `${changed.length} SKU matières régénérés`);
    Store.save('materials'); App.rerender();
    U.toast(`${changed.length} SKU matières régénérés.`);
  },
  setConsoAbbrev(cat, val) {
    const S = Store.state.settings;
    if (!S.consoAbbrev) S.consoAbbrev = {};
    S.consoAbbrev[cat] = Pricing.slugify(val).substring(0, 6);
    Store.save('settings');
  },

  _sortPresets(items, mode) {
    if (mode === 'gram') return [...items].sort((a, b) => Number(a) - Number(b));
    if (mode === 'piece') {
      const nums = items.filter(v => typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v !== ''));
      const texts = items.filter(v => typeof v === 'string' && (isNaN(Number(v)) || v === ''));
      return [...nums].sort((a, b) => Number(a) - Number(b)).concat([...texts].sort(U.sortFr));
    }
    if (mode === 'size') return [...items].sort((a, b) => {
      const ia = Stock.SIZE_ORDER.indexOf(String(a).toUpperCase().trim());
      const ib = Stock.SIZE_ORDER.indexOf(String(b).toUpperCase().trim());
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return U.sortFr(a, b);
    });
    return [...items];
  },

  varPresetBlock(mode, title, items, suffix) {
    const sorted = this._sortPresets(items, mode);
    const isNum = v => typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v !== '');
    const display = v => {
      if (mode === 'gram') return Number(v) >= 1000 ? (Number(v) / 1000) + 'KG' : v + 'G';
      if (mode === 'piece') return isNum(v) ? v + ' pc' : U.esc(String(v).toUpperCase());
      return U.esc(String(v).toUpperCase());
    };
    const placeholder = mode === 'gram' ? 'ex: 750' : mode === 'piece' ? 'ex: 3 ou 12CM' : 'ex: XXL';
    return `<div style="text-align:center;">
      <b>${title}</b>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;justify-content:center;">
        ${sorted.map(v => { const dv = display(v), ev = U.esc(String(v)).replace(/&#39;/g,"\\'"); return `<span class="tag${this._varFilter === dv ? ' tag-active' : ''}" style="display:inline-flex;gap:4px;align-items:center;cursor:pointer;" onclick="Params.filterByPreset('${U.esc(dv).replace(/&#39;/g,"\\'")}')"><span>${dv}</span> <button class="btn-icon" style="font-size:11px;padding:0 2px;" onclick="event.stopPropagation();Params.delVarPreset('${mode}','${ev}')">×</button></span>`; }).join('') || '<span class="muted">Aucun palier.</span>'}
      </div>
      <div style="display:inline-flex;gap:4px;align-items:center;margin-top:6px;">
        <input id="vp_add_${mode}" placeholder="${placeholder}" style="width:100px;text-transform:${mode !== 'gram' ? 'uppercase' : 'none'};" onkeydown="if(event.key==='Enter'){event.preventDefault();Params.addVarPreset('${mode}')}">
        <button class="btn-ghost btn-sm" title="Ajouter ce palier" onclick="Params.addVarPreset('${mode}')">＋</button>
      </div>
    </div>`;
  },

  addVarPreset(mode) {
    const S = Store.state.settings;
    if (!S.variantPresets) S.variantPresets = { gram: [], piece: [], size: [] };
    const input = document.getElementById('vp_add_' + mode);
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;
    let val;
    if (mode === 'gram') {
      val = Number(raw);
      if (isNaN(val) || val <= 0) { U.toast('Entre un nombre valide.', true); return; }
    } else if (mode === 'piece') {
      val = isNaN(Number(raw)) || raw === '' ? raw.toUpperCase() : Number(raw);
      if (typeof val === 'number' && val <= 0) { U.toast('Entre un nombre valide.', true); return; }
    } else {
      val = raw.toUpperCase();
    }
    const list = S.variantPresets[mode] || [];
    const norm = v => String(v).toUpperCase().trim();
    if (list.some(v => norm(v) === norm(val))) { U.toast('Ce palier existe déjà.', true); return; }
    list.push(val);
    S.variantPresets[mode] = list;
    Store.save('settings');
    App.rerender();
  },

  delVarPreset(mode, val) {
    const S = Store.state.settings;
    if (!S.variantPresets?.[mode]) return;
    const norm = v => String(v).toUpperCase().trim();
    S.variantPresets[mode] = S.variantPresets[mode].filter(x => norm(x) !== norm(val));
    Store.save('settings');
    App.rerender();
  },

  _renderExistingVariants(vp) {
    const isNum = v => typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v !== '');
    const normSet = arr => new Set((arr || []).map(v => String(v).toUpperCase().trim()));
    const allPresets = new Set([...normSet(vp.gram), ...normSet(vp.piece), ...normSet(vp.size)]);
    const found = new Set();
    const collect = variants => (variants || []).forEach(v => {
      if (v.mode === 'gram' && isNum(v.value)) return;
      if (v.mode === 'piece' && isNum(v.value) && !v.label) return;
      const lb = (v.label || '').toUpperCase().trim();
      if (lb && !allPresets.has(lb)) found.add(lb);
    });
    Store.state.stockM.forEach(p => collect(p.variants));
    Store.state.catalogM.forEach(p => collect(p.variants));
    if (!found.size) return '<p class="muted">Toutes les variantes existantes sont déjà dans les paliers standards.</p>';
    return '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
      [...found].sort(U.sortFr).map(lb => {
        const elb = U.esc(lb).replace(/&#39;/g,"\\'");
        return `<span class="tag${this._varFilter === lb ? ' tag-active' : ''}" style="display:inline-flex;gap:4px;align-items:center;cursor:pointer;" onclick="Params.filterByPreset('${elb}')"><span>${U.esc(lb)}</span> <button class="btn-icon" style="font-size:11px;padding:0 2px;" onclick="event.stopPropagation();Params.adoptExistingVar('${elb}')">＋</button></span>`;
      }).join('') + '</div>';
  },

  _vfSort: 'meat', _vfSortDir: 'asc',
  filterByPreset(label) {
    if (this._varFilter !== label) { this._vfSort = 'meat'; this._vfSortDir = 'asc'; }
    this._varFilter = this._varFilter === label ? null : label;
    App.rerender();
  },
  setVfSort(key) {
    if (this._vfSort === key) this._vfSortDir = this._vfSortDir === 'asc' ? 'desc' : 'asc';
    else { this._vfSort = key; this._vfSortDir = 'asc'; }
    App.rerender();
  },

  _renderFilteredProducts() {
    const f = this._varFilter;
    if (!f) return '';
    const norm = s => String(s || '').toUpperCase().trim();
    const matches = [];
    Store.state.stockM.forEach(p => {
      const mv = p.variants.filter(v => norm(Pricing.labelVariant(v)) === norm(f));
      if (mv.length) matches.push({ name: p.name, source: 'Stock', meat: p.meatType || '', id: p.id, href: '#/stock/mastication/' + p.id });
    });
    Store.state.catalogM.forEach(p => {
      const mv = p.variants.filter(v => norm(Pricing.labelVariant(v)) === norm(f));
      if (mv.length) matches.push({ name: p.name, source: 'Catalogue', meat: p.meatType || '', id: p.id, href: '#/catalogue/edit/' + p.id });
    });
    const sk = this._vfSort, dir = this._vfSortDir === 'asc' ? 1 : -1;
    matches.sort((a, b) => {
      const va = (a[sk] || '').toLowerCase(), vb = (b[sk] || '').toLowerCase();
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    const sortHead = (key, label) => `<span class="sortable ${sk===key?'active':''}" onclick="Params.setVfSort('${key}')">${label} ${sk===key?(dir>0?'▲':'▼'):'⇕'}</span>`;
    return `<div class="card mt" style="border-left:4px solid var(--ok);padding:10px 14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <b>Produits utilisant « ${U.esc(f)} » (${matches.length})</b>
        <button class="btn-icon" onclick="Params._varFilter=null;App.rerender();" title="Fermer">✕</button>
      </div>
      ${matches.length ? `<div class="table-wrap" style="margin-top:8px;"><table class="tbl"><thead><tr><th class="col-name">${sortHead('name','Produit')}</th><th>${sortHead('meat','Viande')}</th><th>${sortHead('source','Source')}</th></tr></thead><tbody>` +
        matches.map(m => `<tr><td class="col-name"><a href="${m.href}" style="color:var(--caramel-2);text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${U.esc(m.name)}</a></td><td><span class="badge info">${U.esc(m.meat)}</span></td><td>${m.source}</td></tr>`).join('') +
        '</tbody></table></div>' : '<p class="muted mt">Aucun produit ne contient cette variante.</p>'}
    </div>`;
  },

  adoptExistingVar(label) {
    const esc = U.esc(label).replace(/&#39;/g, "\\'");
    U.modal({
      title: 'Ajouter « ' + label + ' »',
      body: `<p>Dans quel type de palier veux-tu placer cette variante ?</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
          <button class="btn-ok" onclick="Params._doAdopt('piece','${esc}')">Pièces (lots)</button>
          <button class="btn-ok" onclick="Params._doAdopt('size','${esc}')">Tailles</button>
        </div>`,
      hideOk: true
    });
  },

  _doAdopt(mode, label) {
    const S = Store.state.settings;
    if (!S.variantPresets) S.variantPresets = { gram: [], piece: [], size: [] };
    const list = S.variantPresets[mode] || [];
    const norm = v => String(v).toUpperCase().trim();
    if (list.some(v => norm(v) === norm(label))) { U.closeModal(); U.toast('Ce palier existe déjà.', true); return; }
    list.push(label);
    S.variantPresets[mode] = list;
    Store.save('settings');
    U.closeModal();
    U.toast(`« ${label} » ajouté aux ${mode === 'piece' ? 'Pièces' : 'Tailles'}.`);
    App.rerender();
  },

  _skuSort: 'name', _skuSortDir: 1, _skuView: 'all', _skuMeat: 'all',
  _setSkuMeat(val) { this._skuMeat = val; this.renderSkuAll(); },

  setSkuSort(key) {
    if (this._skuSort === key) this._skuSortDir *= -1;
    else { this._skuSort = key; this._skuSortDir = 1; }
    this.renderSkuAll();
  },

  setSkuView(view) {
    this._skuView = this._skuView === view ? 'all' : view;
    this.renderSkuAll();
  },

  _allSkuData() {
    const rows = [];
    Store.state.stockM.forEach(p => {
      (p.variants || []).forEach(v => {
        const vLabel = Pricing.skuVariantLabel(v);
        let suggested = Pricing.autoSku(p.name, p.meatType, vLabel);
        // Déclinaison (ex. 25CM LOT 2 ← 25CM) : SKU de sa taille + « -LOT<n> » → ROULEAUX-POR-25CM-LOT2
        // (avant : ROULEAUX-POR-LOT2, la taille était perdue et 12CM/25CM LOT 2 entraient en collision).
        const par = Stock.parentOf(p, v);
        if (par) {
          const parBase = (par.sku || '').trim() || Pricing.autoSku(p.name, p.meatType, Pricing.skuVariantLabel(par));
          if (parBase) suggested = parBase.toUpperCase() + '-LOT' + Stock.packQtyOf(v);
        }
        rows.push({ pId: p.id, vId: v.id, name: p.name, meat: p.meatType || '', variant: v.label || Pricing.labelVariant(v), sku: v.sku || '', suggested });
      });
    });
    // ⚠️ Dédoublonnage GLOBAL des suggestions : deux variantes distinctes ne doivent JAMAIS
    // proposer le même SKU. Sinon « Appliquer les suggestions » écrit deux fois la même valeur
    // et crée un doublon (ex. ROULEAUX 12CM/25CM LOT 2 → tous deux « LOT2 » ; Saucisse Poulet/Canard
    // → tous deux « 1PC », la viande n'entrant pas dans le SKU). Collision → suffixe -2, -3, …
    // On évite aussi de tomber sur le SKU réel d'une AUTRE variante (cas d'un apply filtré par viande).
    const skuOwners = new Map(); // SKU (majuscule) -> index de la ligne qui l'utilise réellement
    rows.forEach((r, i) => {
      if (!r.sku) return;
      const k = r.sku.toUpperCase();
      if (!skuOwners.has(k)) skuOwners.set(k, new Set());
      skuOwners.get(k).add(i);
    });
    const assigned = new Set();
    const conflicts = (cand, i) => {
      const k = cand.toUpperCase();
      if (assigned.has(k)) return true;                       // déjà pris par une autre suggestion
      const owners = skuOwners.get(k);
      // Bloque seulement si le SKU est le SKU réel UNIQUE d'une AUTRE ligne. Un SKU partagé par
      // plusieurs lignes (= le doublon qu'on résout) n'est pas réservé : la 1re assignation le récupère.
      if (owners && owners.size === 1 && !owners.has(i)) return true;
      return false;
    };
    rows.forEach((r, i) => {
      const base = r.suggested;
      if (!base) return;
      let candidate = base, n = 1;
      while (conflicts(candidate, i)) { n++; candidate = base + '-' + n; }
      assigned.add(candidate.toUpperCase());
      r.suggested = candidate;
    });
    return rows;
  },

  _filteredSkuData() {
    let rows = this._allSkuData();
    const searchEl = document.getElementById('sku_all_search');
    const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
    const meat = this._skuMeat || 'all';
    if (q) rows = rows.filter(r => U.has(r.name + ' ' + r.sku + ' ' + r.variant, q));
    if (meat !== 'all') rows = rows.filter(r => r.meat === meat);
    const dir = this._skuSortDir;
    const key = this._skuSort;
    rows.sort((a, b) => U.sortFr(a[key] || '', b[key] || '') * dir);
    return { rows, meat, q };
  },

  _renderSkuAll() {
    const { rows, meat } = this._filteredSkuData();
    const dir = this._skuSortDir;
    const sortHead = (k, label, extra) => {
      const active = this._skuSort === k;
      // ⇕ sur les colonnes inactives pour montrer qu'elles sont TOUTES triables (pas seulement Produit).
      return `<th class="sortable${active ? ' active' : ''}" style="cursor:pointer;${extra || ''}" onclick="Params.setSkuSort('${k}')">${label}${active ? (dir > 0 ? ' ▲' : ' ▼') : ' ⇕'}</th>`;
    };
    // Doublons détectés sur le SKU EFFECTIF (celui réellement utilisé = SKU saisi, sinon la suggestion),
    // PAS sur la suggestion seule — sinon corriger un SKU à la main ne le fait jamais sortir des doublons
    // (deux variantes peuvent partager la même suggestion mais avoir des SKU réels distincts).
    const skuKey = r => (r.sku || r.suggested || '').trim().toUpperCase();
    const dupes = {};
    rows.forEach(r => { const k = skuKey(r); if (k) dupes[k] = (dupes[k] || 0) + 1; });
    const dupeSkus = Object.entries(dupes).filter(([, c]) => c > 1);
    const allDupeRows = rows.filter(r => dupes[skuKey(r)] > 1);
    // « À mettre à jour » = SKU MANQUANT, EN DOUBLON, ou avec un « -1PC » redondant à normaliser.
    // Un SKU saisi à la main, unique et non redondant, est un choix DÉLIBÉRÉ valide (même s'il ne suit
    // pas la suggestion auto) : il ne doit ni être compté ni être écrasé.
    // Le « -1PC » redondant (ancien format auto d'une pièce) est le SEUL cas où un SKU non vide/non
    // doublon est quand même proposé à la normalisation — car c'est un SKU auto obsolète, pas un choix.
    const redundant1pc = r => r.sku && ['-1PC', '-UNITE', '-PIECE', '-1PIECE', '-PCS'].some(x => r.sku.trim().toUpperCase() === (r.suggested + x).toUpperCase());
    const needsSku = r => !r.sku || dupes[skuKey(r)] > 1 || redundant1pc(r);
    const allDiff = rows.filter(needsSku);
    const view = this._skuView;
    let display = rows;
    if (view === 'diff') display = allDiff;
    if (view === 'dupes') display = allDupeRows;
    if (!rows.length) return '<p class="muted mt">Aucun produit trouvé.</p>';
    const meatLabel = meat !== 'all' ? ` (${meat})` : '';
    const tabBtn = (id, label, count, color) => {
      const active = view === id;
      const c = color || 'var(--caramel)';
      return `<a href="#" onclick="event.preventDefault();Params.setSkuView('${id}')" style="text-decoration:${active?'none':'underline'};color:${c};${active?'font-weight:700;':''}">${label} (${count})</a>`;
    };
    return `<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:8px;">
        ${tabBtn('all', 'Tous', rows.length, '')} · ${tabBtn('diff', 'À mettre à jour', allDiff.length, '')}${dupeSkus.length ? ` · ${tabBtn('dupes', '⚠ Doublons', allDupeRows.length, 'var(--warn)')}` : ''}
      </div>
      ${!display.length ? `<p class="muted mt">${view === 'diff' ? 'Tous les SKU sont déjà à jour ✓' : 'Aucun doublon.'}</p>` : `<div class="table-wrap mt" style="max-height:500px;overflow:auto;">
      <table><thead><tr>${sortHead('name','Produit')}${sortHead('meat','Viande')}${sortHead('variant','Variante')}${sortHead('sku','SKU','text-align:center;')}<th>Suggestion</th></tr></thead>
      <tbody>${display.map(r => {
        const isDupe = dupes[skuKey(r)] > 1;
        const propose = (!r.sku || redundant1pc(r)) && !isDupe; // afficher la suggestion (vide ou -1PC redondant)
        return `<tr>
          <td>${U.esc(r.name)}</td>
          <td>${U.esc(r.meat) || '<span class="muted">—</span>'}</td>
          <td>${U.esc(r.variant)}</td>
          <td><input class="sku-input" value="${U.esc(r.sku)}" onchange="Params.setSkuDirect('${r.pId}','${r.vId}',this.value)" title="${U.esc(r.sku)}"></td>
          <td>${isDupe ? `<code class="muted" style="font-size:.75rem;">${U.esc(r.suggested)} <span style="color:var(--warn);">⚠ doublon</span></code>` : propose ? `<code class="muted" style="font-size:.75rem;">${U.esc(r.suggested)}</code>` : '<span class="pos" style="font-size:.75rem;">✓</span>'}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`}
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-top:10px;">
        <span class="muted">${display.length} variante(s) affichée(s)</span>
        ${allDiff.length ? `<button class="btn-ok" onclick="Params.applySkuRegen()" title="Ne touche QUE les SKU manquants ou en doublon — tes SKU personnalisés uniques ne sont pas modifiés.">Attribuer les SKU manquants / en doublon${meatLabel} (${allDiff.length})</button>` : ''}
      </div>`;
  },

  renderSkuAll() {
    const el = document.getElementById('sku_all_list');
    if (el) el.innerHTML = this._renderSkuAll();
  },

  setSkuDirect(pId, vId, val) {
    const p = Store.state.stockM.find(x => x.id === pId);
    if (!p) return;
    const v = p.variants?.find(x => x.id === vId);
    if (!v) return;
    const snap = Store.snapshot('stockM', p);
    v.sku = val.trim().toUpperCase();
    const cId = v.catalogId || p.catalogId;
    if (cId && v.catalogVariantId) {
      const cp = Store.state.catalogM.find(x => x.id === cId);
      const cv = cp?.variants?.find(x => x.id === v.catalogVariantId);
      if (cv) cv.sku = v.sku;
    }
    const entry = Store.commitSnapshot(snap, 'editSku', `SKU ${p.name} ${v.label || Pricing.labelVariant(v)} → ${v.sku}`);
    Store.save('stockM', 'catalogM');
    U.toast(`SKU modifié : ${v.sku}`, false, entry?.id);
    this.renderSkuAll();
  },

  async applySkuRegen() {
    const { rows } = this._filteredSkuData();
    // Même critère que « À mettre à jour » : on ne touche QUE les SKU manquants ou en doublon.
    // Les SKU personnalisés uniques (choix délibéré d'Antho) ne sont JAMAIS écrasés.
    const skuKey = r => (r.sku || r.suggested || '').trim().toUpperCase();
    const dupes = {};
    rows.forEach(r => { const k = skuKey(r); if (k) dupes[k] = (dupes[k] || 0) + 1; });
    const redundant1pc = r => r.sku && ['-1PC', '-UNITE', '-PIECE', '-1PIECE', '-PCS'].some(x => r.sku.trim().toUpperCase() === (r.suggested + x).toUpperCase());
    const diffRows = rows.filter(r => !r.sku || dupes[skuKey(r)] > 1 || redundant1pc(r));
    if (!diffRows.length) { U.toast('Aucun SKU manquant, en doublon ou à normaliser — rien à corriger.'); return; }
    const meat = this._skuMeat || 'all';
    const meatLabel = meat !== 'all' ? ` pour ${meat}` : '';
    if (!await U.confirm(`Attribuer/corriger ${diffRows.length} SKU${meatLabel} (manquants ou en doublon) ? Tes SKU déjà personnalisés (uniques) ne sont pas touchés.`)) return;
    const snaps = [];
    const touched = new Set();
    diffRows.forEach(r => {
      const p = Store.state.stockM.find(x => x.id === r.pId);
      if (!p) return;
      if (!touched.has(p.id)) { snaps.push(Store.snapshot('stockM', p)); touched.add(p.id); }
      const v = p.variants?.find(x => x.id === r.vId);
      if (v) v.sku = r.suggested;
    });
    let syncCount = 0;
    touched.forEach(pId => {
      const sp = Store.state.stockM.find(x => x.id === pId);
      if (!sp) return;
      sp.variants.forEach(sv => {
        const cId = sv.catalogId || sp.catalogId;
        if (!cId || !sv.catalogVariantId) return;
        const cp = Store.state.catalogM.find(x => x.id === cId);
        if (!cp) return;
        const cv = cp.variants.find(x => x.id === sv.catalogVariantId);
        if (cv && sv.sku && cv.sku !== sv.sku) { cv.sku = sv.sku; syncCount++; }
      });
    });
    const entry = Store.log('paramètres', `SKU attribués/corrigés${meatLabel} : ${diffRows.length} stock` + (syncCount ? ` + ${syncCount} propagés au catalogue prix` : ''), { type: 'restoreBatch', data: snaps });
    Store.save('stockM', 'catalogM');
    U.toast(`${diffRows.length} SKU attribués/corrigés${meatLabel}` + (syncCount ? `, ${syncCount} propagés au catalogue.` : '.'), false, entry?.id);
    this.renderSkuAll();
  },

  renameVariantPrompt() {
    const oldLabel = U.val('pv_old'), newLabel = U.val('pv_new').trim();
    if (!newLabel) { U.toast('Indique le nouveau nom.', true); return; }
    const n = this.renameVariantEverywhere(oldLabel, newLabel);
    if (!n) { U.toast('Aucune variante trouvée avec ce nom.', true); return; }
    Store.log('stock', `Variantes renommées : "${oldLabel}" → "${newLabel}" (${n})`);
    Store.save('stockM');
    U.toast(`${n} variante(s) renommée(s) et fusionnée(s) si besoin.`);
    App.rerender();
  },
  uppercaseAllVariants() {
    let changed = 0;
    const cleanGramLabel = v => {
      if (!v.label || v.mode !== 'gram') return;
      if (/^\d+(\.\d+)?\s*[gG]$/.test(v.label.trim()) || /^\d+(\.\d+)?\s*[kK][gG]$/.test(v.label.trim())) {
        v.label = ''; changed++;
      }
    };
    Store.state.stockM.forEach(p => {
      p.variants.forEach(v => {
        cleanGramLabel(v);
        if (v.label && v.label !== v.label.toUpperCase()) { v.label = v.label.toUpperCase(); changed++; }
      });
      this.mergeSameLabelVariants(p);
    });
    Store.state.catalogM.forEach(p => {
      p.variants.forEach(v => {
        cleanGramLabel(v);
        if (v.label && v.label !== v.label.toUpperCase()) { v.label = v.label.toUpperCase(); changed++; }
      });
    });
    Store.log('stock', `Variantes uniformisées en majuscules (${changed})`);
    Store.save('stockM'); Store.save('catalogM');
    U.toast(changed ? `${changed} variante(s) mise(s) en majuscules et fusionnée(s) si besoin.` : 'Toutes les variantes étaient déjà uniformes.');
    App.rerender();
  },

  detectFormat(data) {
    if (Array.isArray(data)) {
      // Historique de ventes de l'ancienne appli : lignes { date, productName, quantity, ... }
      if (data.length && data.some(x => x && x.productName && x.date && x.quantity !== undefined)) return 'saleshistory';
      // tableau brut : produits de stock (avec ou sans variantes) ou de calculateur
      if (data.some(x => x && (x.variants || x.lots || x.generalStock !== undefined || x.totalStock !== undefined || x.eventStock !== undefined))) return 'stock';
      if (data.some(x => x && x.inputState)) return 'calculator';
      return 'stock';
    }
    if (!data || typeof data !== 'object') return 'unknown';
    if (data.app === 'touffu-gestion' || data.stockM || data.catalogM || data.catalogA) return 'backup';
    if (Array.isArray(data.savedProducts)) return 'calculator';
    if (Array.isArray(data.products) || Array.isArray(data.items) || Array.isArray(data.stock)) return 'stock';
    if (Array.isArray(data.perishables) || Array.isArray(data.nonPerishables)) return 'stock';
    return 'unknown';
  },

  /* Importe l'HISTORIQUE DE VENTES de l'ancienne appli (tableau de lignes { date, productName,
     variantName, quantity, source }) → ventes historiques pour les STATS, SANS toucher au stock.
     Le fichier n'a pas de prix : on retrouve le prix de vente ACTUEL par correspondance nom+variante
     (choix d'Antho, ses prix ont peu bougé). Les lignes reliées portent aussi le pId (stats exactes
     par produit) ; les autres sont comptées par nom. Regroupé par (jour, source). Anti-doublon par id. */
  mapSalesHistory(data) {
    const norm = s => String(s || '').trim().toLowerCase();
    // index nom+variante → produit stock actuel (prix de vente TTC, pId, coût)
    const idx = {};
    Store.state.stockM.forEach(p => (p.variants || []).forEach(v => {
      const rec = { pId: p.id, vId: v.id, sku: v.sku || '', price: U.num(v.priceTTC), cost: U.num(v.costUnit) };
      idx[norm(p.name) + '|' + norm(Pricing.labelVariant(v))] = rec;
      if (v.label) idx[norm(p.name) + '|' + norm(v.label)] = rec;
    }));
    const seen = new Set();
    Store.state.sales.forEach(s => (s.sumupRefs || []).forEach(r => seen.add(r)));
    const groups = {};
    let matched = 0, unmatched = 0, skipped = 0;
    (data || []).forEach(e => {
      if (!e || !e.productName) return;
      if (e.id && seen.has(e.id)) { skipped++; return; }
      const ts = Date.parse(e.date); if (isNaN(ts)) return;
      const day = new Date(ts).toISOString().slice(0, 10);
      const src = e.source === 'event' ? 'event' : 'direct';   // 'standard'/autre → vente directe
      const gk = day + '|' + src;
      const g = groups[gk] || (groups[gk] = { ts, src, items: [], refs: [] });
      if (ts < g.ts) g.ts = ts;
      const qty = U.num(e.quantity) || 1;
      const m = idx[norm(e.productName) + '|' + norm(e.variantName)];
      if (m) matched++; else unmatched++;
      g.items.push({ kind: 'M', pId: m ? m.pId : '', vId: m ? m.vId : '', name: e.productName, variant: e.variantName || '', sku: m ? m.sku : '', qty, price: m ? m.price : 0, cost: m ? m.cost * qty : undefined });
      if (e.id) g.refs.push(e.id);
    });
    let created = 0;
    Object.values(groups).forEach(g => {
      const total = g.items.reduce((a, i) => a + i.price * i.qty, 0);
      const sale = { id: U.uid(), ts: g.ts, source: g.src, channel: 'direct', payment: '', delivery: 'clickcollect', customerName: '', items: g.items, total, cancelled: false, undoOps: [], sumupRefs: g.refs, fromImport: true, historical: true };
      Store.state.sales.unshift(sale); created++;
    });
    return { created, entries: (data || []).length, matched, unmatched, skipped };
  },

  /* Reconcilie la casse d'un type de viande importé (souvent en minuscules dans l'ancien
     calculateur, ex: "cornes") avec la liste canonique déjà connue (ex: "Cornes"), pour éviter
     de créer des doublons "Cornes" / "cornes" dans les réglages. */
  normMeatType(raw) {
    if (!raw) return 'Autre';
    const found = Store.state.settings.meatTypes.find(m => m.toLowerCase() === String(raw).toLowerCase());
    if (found) return found;
    return String(raw).replace(/\b\w/g, c => c.toUpperCase());
  },

  mapPrixData(data) {
    const S = Store.state.settings;
    let addedSup = 0, addedSac = 0;
    // sachets
    (data.sachets || []).forEach(sc => {
      if (!S.sachets.some(x => String(x.id) === String(sc.id))) {
        const entry = { id: sc.id, name: sc.name, cost: U.num(sc.cost), type: sc.type || 'sachet' };
        if ((sc.type || 'sachet') === 'blister' && !sc.dims) {
          const m = String(sc.name).match(/(\d+)\s*mm\s*[*×x]\s*([\d.]+)\s*(cm|m)\b/i);
          if (m) entry.dims = m[1] + 'mm×' + m[2] + m[3].toLowerCase();
        } else if (sc.dims) { entry.dims = sc.dims; }
        S.sachets.push(entry); addedSac++;
      }
    });
    // types de viande (la casse canonique du fichier, ex: "Cornes", prime sur celle des produits, ex: "cornes")
    (data.meatTypes || []).forEach(m => { if (!S.meatTypes.some(x => x.toLowerCase() === String(m).toLowerCase())) S.meatTypes.push(m); });
    // fournisseurs
    const supId = (name) => {
      if (!name) return '';
      let s = S.suppliers.find(x => x.name.toLowerCase() === String(name).toLowerCase());
      if (!s) { s = { id: U.uid(), name }; S.suppliers.push(s); addedSup++; }
      return s.id;
    };
    // produits
    const products = (data.savedProducts || []).map(op => {
      const s = op.inputState || {};
      const variants = [];
      if (s.resaleUnit === 'size') {
        (s.sizeConfigs || []).forEach(c => variants.push({
          id: U.uid(), mode: 'size', label: c.label, value: c.value,
          sachetId: (s.sizeSachetSelections?.[c.id]) || s.selectedSachet || '0',
          coeff: c.coeff || '', enabled: c.enabled !== false
        }));
      } else if (s.resaleUnit === 'gram') {
        [50, 100, 250, 500, 1000].forEach(g => variants.push({
          id: U.uid(), mode: 'gram', value: g,
          sachetId: (s.gramSachetSelections?.[g]) || s.selectedSachet || '0',
          coeff: (s.gramCoeffs?.[g]) || '', enabled: s.gramEnabled?.[g] !== false
        }));
      } else if (s.resaleUnit === 'piece') {
        [1, 2, 3, 4, 5].forEach(n => variants.push({
          id: U.uid(), mode: 'piece', value: n,
          sachetId: (s.pieceSachetSelections?.[n]) || s.selectedSachet || '0',
          coeff: (s.pieceCoeffs?.[n]) || '', enabled: s.pieceEnabled?.[n] !== false
        }));
      }
      const mainSupplierId = supId(op.supplier);
      return {
        id: op.id || U.uid(), name: op.name || 'Sans nom', meatType: this.normMeatType(op.meatType),
        mainSupplierId, coefficient: U.num(s.coefficient) || 2,
        labelCost: U.num(s.labelCost ?? S.labelCost),
        labelTypeId: (() => { const d = Store.labelDefault(); return d && Math.abs(U.num(s.labelCost ?? S.labelCost) - U.num(d.cost)) < 1e-9 ? d.id : ''; })(),
        suppliers: mainSupplierId ? [{
          id: U.uid(), supplierId: mainSupplierId,
          price: s.purchasePrice, taxType: s.purchaseTaxType || 'HT',
          unit: s.purchaseUnit === 'kilo' ? 'kilo' : 'piece',
          weight: U.num(s.purchaseWeight) || 1, quantity: U.num(s.purchaseQuantity) || 1,
          piecesPerKilo: s.piecesPerKilo || ''
        }] : [],
        variants
      };
    });
    // fusion (remplace si même id)
    products.forEach(p => {
      const idx = Store.state.catalogM.findIndex(x => x.id === p.id);
      if (idx >= 0) Store.state.catalogM[idx] = p; else Store.state.catalogM.push(p);
    });
    if (data.globalLabelCost) S.labelCost = U.num(data.globalLabelCost);
    // générer les consommables blister (un par largeur de rouleau)
    let addedBlisters = 0;
    const blistersByWidth = {};
    (S.sachets || []).filter(s => s.type === 'blister').forEach(s => {
      const d = this._blisterDims(s);
      if (!d) return;
      const key = String(d.widthMm);
      if (!blistersByWidth[key]) blistersByWidth[key] = [];
      blistersByWidth[key].push({ cost: U.num(s.cost), lengthM: d.lengthMm / 1000 });
    });
    if (!S.blisterRolls) S.blisterRolls = {};
    Object.keys(blistersByWidth).forEach(widthKey => {
      if (S.blisterRolls[widthKey]?.consumableId) return;
      const entries = blistersByWidth[widthKey];
      const longest = entries.reduce((a, b) => b.lengthM > a.lengthM ? b : a);
      const costPerM = longest.lengthM > 0 ? Math.round((longest.cost / longest.lengthM) * 10000) / 10000 : 0;
      const name = 'Rouleau blister ' + widthKey + 'mm';
      let conso = Store.state.consumables.find(c => c.name === name);
      if (!conso) {
        conso = { id: U.uid(), name, product: '', variant: '', category: 'Blisters', unit: 'm', qty: 0, low: 0, costUnit: costPerM };
        Store.state.consumables.push(conso);
        addedBlisters++;
      }
      S.blisterRolls[widthKey] = { consumableId: conso.id };
    });
    if (addedBlisters) { this._renameSachets(); Store.save('consumables'); }
    return { products: products.length, sachets: addedSac, suppliers: addedSup, blisters: addedBlisters };
  },

  inferStockMode(name) {
    const n = String(name || '').trim();
    let m;
    if ((m = n.match(/^(\d+(?:[.,]\d+)?)\s*G$/i))) return { mode: 'gram', value: U.num(m[1]), label: '' };
    if ((m = n.match(/^(\d+(?:[.,]\d+)?)\s*KG$/i))) return { mode: 'gram', value: U.num(m[1]) * 1000, label: '' };
    if (/^(PCS|PC|UNIT[EÉ]|PI[EÈ]CE)S?$/i.test(n)) return { mode: 'piece', value: 1, label: '' };
    if ((m = n.match(/LOT\s*(\d+)/i))) return { mode: 'piece', value: U.num(m[1]), label: '' };
    return { mode: 'size', value: '', label: n };   // S/M/L/XL, 30CM, "A", etc.
  },

  /* lecture tolérante d'un lot, quel que soit le nommage de l'ancienne version.
     ⚠️ Dans l'ancienne appli (Inventaire V7), qtyGeneral est le stock TOTAL physique et
     qtyEvent une réservation prise dedans (dispo local = qtyGeneral − qtyEvent). Notre modèle
     actuel utilise deux pools INDÉPENDANTS (général = local, événement = emmené en marché).
     Il faut donc convertir, sinon le stock local serait compté en double avec l'événement. */
  _readLot(l) {
    const g = (...keys) => { for (const k of keys) if (l[k] !== undefined && l[k] !== null && l[k] !== '') return l[k]; return undefined; };
    const totalLegacy = U.num(g('qtyGeneral', 'generalStock', 'qtyGen', 'general', 'stockGeneral', 'qty'));
    const eventLegacy = U.num(g('qtyEvent', 'eventStock', 'event', 'stockEvent', 'qtyEvt'));
    return {
      id: U.uid(),
      lotNumber: g('lotNumber', 'lot', 'numLot', 'batch', 'lotNo') || '',
      dluo: g('dluo', 'expiryDate', 'expiry', 'peremption', 'datePeremption', 'expiration') || '',
      qtyGeneral: Math.max(0, totalLegacy - eventLegacy),
      qtyEvent: eventLegacy,
      costUnit: U.num(g('pricePurchase', 'prixAchat', 'purchasePrice', 'cost', 'coutAchat'))
    };
  },
  _readVariant(v) {
    const g = (...keys) => { for (const k of keys) if (v[k] !== undefined && v[k] !== null && v[k] !== '') return v[k]; return undefined; };
    const name = g('name', 'label', 'nom', 'variantName') || '';
    const inf = this.inferStockMode(name);
    const nv = {
      id: U.uid(), catalogVariantId: '', label: inf.label || name, mode: inf.mode, value: inf.value,
      // SKU = identifiant stable (lien WooCommerce ↔ calcul de prix) ; réf = simple info fournisseur,
      // gardée à part car avec plusieurs fournisseurs elle n'a pas la même valeur pour tous.
      ref: g('ref', 'reference', 'refFournisseur') || '',
      sku: g('sku', 'SKU') || '',
      priceTTC: U.num(g('priceSale', 'priceVente', 'salePrice', 'prixVente', 'prix')),
      costUnit: U.num(g('pricePurchase', 'prixAchat', 'purchasePrice')),
      low: U.num(g('minStock', 'low', 'seuil', 'minThreshold')),
      lowEvent: U.num(g('minEventStock', 'lowEvent')),
      lots: []
    };
    let lots = v.lots || v.batches || [];
    if (!Array.isArray(lots) || !lots.length) {
      // pas de lots détaillés : reconstituer un lot depuis les champs de la variante
      const gen = U.num(g('qtyGeneral', 'generalStock', 'stockGeneral', 'totalStock', 'stock', 'qty'));
      const evt = U.num(g('qtyEvent', 'eventStock', 'stockEvent'));
      if (gen || evt || g('dluo', 'expiryDate', 'peremption')) {
        lots = [{ lotNumber: g('lotNumber', 'lot') || '', dluo: g('dluo', 'expiryDate', 'peremption') || '', qtyGeneral: gen, qtyEvent: evt, pricePurchase: nv.costUnit }];
      }
    }
    lots.forEach(l => nv.lots.push(this._readLot(l)));
    return nv;
  },

  mapStockData(raw) {
    const S = Store.state.settings;
    // normaliser : accepter tableau brut, {products:[...]}, {items:[...]}, ou format ancêtre {perishables,nonPerishables}
    const data = Array.isArray(raw) ? { products: raw } : raw;
    let products = data.products || data.items || data.stock || [];

    // format ancêtre : items à plat regroupés par nom en produits + variantes
    if (Array.isArray(data.perishables) || Array.isArray(data.nonPerishables)) {
      const map = {};
      const addFlat = (it, perish) => {
        const key = (perish ? 'P:' : 'N:') + String(it.name || '').toUpperCase().trim();
        if (!map[key]) map[key] = { name: it.name || 'Sans nom', type: it.meatType || it.type || it.category || 'Autre', isPerishable: perish, variants: [] };
        map[key].variants.push({ ...it, name: it.variant || it.variantName || it.name || '' });
      };
      (data.perishables || []).forEach(it => addFlat(it, true));
      (data.nonPerishables || []).forEach(it => addFlat(it, false));
      products = Object.values(map);
    }

    (data.config?.meatTypes || []).forEach(m => { if (!S.meatTypes.some(x => x.toLowerCase() === String(m).toLowerCase())) S.meatTypes.push(m); });
    (data.config?.categories || []).forEach(c => {
      const cl = String(c).toLowerCase();
      const bucket = /carton/.test(cl) ? S.consCategories : S.accCategories;
      if (!bucket.some(x => x.toLowerCase() === cl)) bucket.push(c);
    });

    const counts = { stockM: 0, materials: 0, consumables: 0, lots: 0 };
    const isConso = (t) => /carton|emballage|encre|étiquette|etiquette|sachet|blister/i.test(t);
    const isSangle = (t) => /sangle|biothane|biothène/i.test(t);
    const isBouclerie = (t) => /mousqueton|bouclerie|rivet|boucle|anneau|dé /i.test(t);

    products.forEach(p => {
      const type = p.type || p.meatType || p.category || 'Autre';
      // périssable : explicite, sinon déduit (une "catégorie" accessoire => non périssable)
      let perish = p.isPerishable;
      if (perish === undefined) perish = !(isConso(type) || isSangle(type) || isBouclerie(type) || /accessoire|sangle|carton|mousqueton/i.test(type));

      // variantes : présentes, sinon reconstruites depuis le produit lui-même (ancien format à plat)
      let variants = p.variants;
      if (!Array.isArray(variants) || !variants.length) variants = [{ name: p.variantName || '', ...p }];

      const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

      if (perish) {
        // même id que la source (ou même nom+type) : on remplace au lieu de dupliquer si ré-importé
        const pid = (p.id !== undefined && p.id !== null && p.id !== '') ? String(p.id) : U.uid();
        let existingIdx = Store.state.stockM.findIndex(x => x.id === pid);
        if (existingIdx < 0) existingIdx = Store.state.stockM.findIndex(x => norm(x.name) === norm(p.name) && norm(x.meatType) === norm(this.normMeatType(type)));
        const sp = { id: pid, catalogId: existingIdx >= 0 ? Store.state.stockM[existingIdx].catalogId : '', name: p.name || 'Sans nom', meatType: this.normMeatType(type), variants: [] };
        variants.forEach(v => { const nv = this._readVariant(v); counts.lots += nv.lots.length; sp.variants.push(nv); });
        if (existingIdx >= 0) Store.state.stockM[existingIdx] = sp; else Store.state.stockM.push(sp);
        counts.stockM++;
      } else {
        const multi = variants.length > 1;
        variants.forEach(v => {
          const nv = this._readVariant(v);
          const qty = nv.lots.reduce((a, l) => a + l.qtyGeneral + l.qtyEvent, 0);
          const label = multi ? (p.name + ' ' + (nv.label || '')).trim() : p.name;
          if (isConso(type)) {
            const idx = Store.state.consumables.findIndex(x => norm(x.name) === norm(label));
            const item = { id: idx >= 0 ? Store.state.consumables[idx].id : U.uid(), name: label, product: p.name || '', variant: multi ? (nv.label || '') : '', category: /carton/i.test(type) ? 'Cartons' : 'Autre', unit: 'pc', qty, low: nv.low, costUnit: nv.costUnit };
            if (idx >= 0) Store.state.consumables[idx] = item; else Store.state.consumables.push(item);
            counts.consumables++;
          } else {
            const kind = isSangle(type) ? 'sangle' : isBouclerie(type) ? 'bouclerie' : 'autre';
            const idx = Store.state.materials.findIndex(x => norm(x.name) === norm(label));
            const item = { id: idx >= 0 ? Store.state.materials[idx].id : U.uid(), name: label, product: p.name || '', variant: multi ? (nv.label || '') : '', kind, unit: kind === 'sangle' ? 'm' : 'piece', costUnit: nv.costUnit, qty, low: nv.low, sku: nv.sku };
            if (idx >= 0) Store.state.materials[idx] = item; else Store.state.materials.push(item);
            counts.materials++;
          }
        });
      }
    });
    return counts;
  },

  exportAll() {
    if (Store.hideSupplierInfo()) { U.toast('Export réservé à l’administrateur.', true); return; }
    const dump = { app: 'touffu-gestion', version: 1, exportedAt: new Date().toISOString() };
    Store.DOMAINS.forEach(d => dump[d] = Store.state[d]);
    U.download(`touffu-sauvegarde-${U.today()}.json`, JSON.stringify(dump, null, 2));
    U.toast('Sauvegarde téléchargée.');
  },
  exportProducts(scope, withQty) {
    if (Store.hideSupplierInfo()) { U.toast('Export réservé à l’administrateur.', true); return; }
    const stockMode = U.val('exp_stock') || 'all';
    const stripQty = (items) => items.map(p => {
      const cp = JSON.parse(JSON.stringify(p));
      (cp.variants || []).forEach(v => {
        (v.lots || []).forEach(l => {
          if (stockMode === 'general') l.qtyEvent = 0;
          else if (stockMode === 'event') l.qtyGeneral = 0;
          if (!withQty) { l.qtyGeneral = 0; l.qtyEvent = 0; }
        });
      });
      if ('qty' in cp) {
        if (!withQty) cp.qty = 0;
      }
      if ('stockGeneral' in cp) {
        if (stockMode === 'general' || !withQty) cp.stockEvent = 0;
        if (stockMode === 'event' || !withQty) cp.stockGeneral = 0;
      }
      return cp;
    });
    const dump = { app: 'touffu-gestion', version: 1, exportedAt: new Date().toISOString(), exportScope: scope, withQuantities: withQty, stockMode };
    if (scope === 'all' || scope === 'perishable') {
      dump.stockM = stripQty(Store.state.stockM);
      dump.catalogM = JSON.parse(JSON.stringify(Store.state.catalogM));
    }
    if (scope === 'all' || scope === 'non-perishable') {
      dump.materials = stripQty(Store.state.materials);
      dump.catalogA = stripQty(Store.state.catalogA);
      dump.consumables = stripQty(Store.state.consumables);
    }
    dump.settings = JSON.parse(JSON.stringify(Store.state.settings));
    const labels = { all: 'tous', perishable: 'perissables', 'non-perishable': 'non-perissables' };
    const suffix = labels[scope] + (withQty ? '-avec-qty' : '-sans-qty');
    U.download(`touffu-export-${suffix}-${U.today()}.json`, JSON.stringify(dump, null, 2));
    U.toast('Export téléchargé.');
  },
  async importProducts(mode) {
    const file = document.getElementById('importFile').files[0];
    if (!file) { U.toast('Choisis d\'abord un fichier à importer.', true); return; }
    const label = mode === 'replace' ? 'REMPLACER toutes les données par ce fichier' : 'FUSIONNER les quantités de ce fichier avec les données existantes';
    if (!await U.confirm(label + ' ?\nCette action est irréversible.')) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (mode === 'replace') {
          if (d.stockM) Store.state.stockM = d.stockM;
          if (d.catalogM) Store.state.catalogM = d.catalogM;
          if (d.materials) Store.state.materials = d.materials;
          if (d.catalogA) Store.state.catalogA = d.catalogA;
          if (d.consumables) Store.state.consumables = d.consumables;
          if (d.settings) Store.state.settings = { ...Store.state.settings, ...d.settings };
          Store.log('import', 'Import (remplacement) depuis un fichier d\'export');
        } else {
          const mergeList = (existing, incoming) => {
            incoming.forEach(item => {
              const match = existing.find(e => e.id === item.id || e.name === item.name);
              if (match) {
                (match.variants || []).forEach(v => {
                  const iv = (item.variants || []).find(x => x.id === v.id || x.label === v.label);
                  if (iv) (v.lots || []).forEach(l => {
                    const il = (iv.lots || []).find(x => x.id === l.id || x.lotNumber === l.lotNumber);
                    if (il) { l.qtyGeneral += il.qtyGeneral || 0; l.qtyEvent += il.qtyEvent || 0; }
                  });
                });
                if ('qty' in match && 'qty' in item) match.qty += item.qty;
                if ('stockGeneral' in match && 'stockGeneral' in item) { match.stockGeneral += item.stockGeneral; match.stockEvent += item.stockEvent; }
              }
            });
          };
          if (d.stockM) mergeList(Store.state.stockM, d.stockM);
          if (d.materials) mergeList(Store.state.materials, d.materials);
          if (d.catalogA) mergeList(Store.state.catalogA, d.catalogA);
          if (d.consumables) mergeList(Store.state.consumables, d.consumables);
          Store.log('import', 'Import (fusion des quantités) depuis un fichier d\'export');
        }
        Store.save(...Store.DOMAINS);
        U.toast(mode === 'replace' ? 'Données remplacées.' : 'Quantités fusionnées.');
        App.rerender();
      } catch (e) { U.toast('Fichier illisible : ' + e.message, true); }
    };
    reader.readAsText(file);
  },
  async importAll() {
    const file = document.getElementById('restoreFile').files[0];
    if (!file) { U.toast('Choisis un fichier de sauvegarde', true); return; }
    if (!await U.confirm('Remplacer TOUTES les données actuelles par cette sauvegarde ?')) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        Store.state = Store.merge(d);
        Store.log('restauration', 'Restauration depuis un fichier de sauvegarde');
        Store.save(...Store.DOMAINS);
        U.toast('Sauvegarde restaurée.'); App.go('dashboard');
      } catch (e) { U.toast('Fichier illisible : ' + e.message, true); }
    };
    reader.readAsText(file);
  },

  /* ---------- instantanés ---------- */
  async loadSnaps() {
    const days = await Store.listSnapshots();
    const box = document.getElementById('snapList'); if (!box) return;
    box.innerHTML = days.length ? days.map(d => `<div class="frow" style="align-items:center; margin-bottom:6px;">
      <span class="tag dluo-ok">${U.frDate(d)}</span>
      <button class="btn-ghost btn-sm" style="flex:0;" onclick="Store.restoreSnapshot('${d}')">Restaurer</button></div>`).join('')
      : '<p class="muted">Aucun instantané pour l\u2019instant.</p>';
  },
  async snapshotNow() { await Store.takeSnapshot(U.today()); this.loadSnaps(); },
  setSnapRetention(v) {
    Store.state.settings.snapRetentionDays = Math.max(7, Math.round(U.num(v)) || 30);
    Store.save('settings'); App.rerender();
  },
  async cleanupSnapshotsNow() {
    const days = U.num(Store.state.settings.snapRetentionDays) || 30;
    const old = await Store.oldSnapshotDays(days);
    if (!old.length) { U.toast('Aucun instantané de plus de ' + days + ' jours.'); return; }
    if (!await U.confirm(old.length + ' instantané(s) de plus de ' + days + ' jours vont être supprimés.\n\nTes données actuelles ne sont pas touchées. Pense à télécharger une sauvegarde avant (bouton « Exporter la sauvegarde »).\n\nContinuer ?')) return;
    await Store.purgeOldSnapshots(days);
    U.toast(old.length + ' ancien(s) instantané(s) supprimé(s).');
    this.loadSnaps();
  },
  async clearSnapshots() {
    if (!await U.confirm('Effacer TOUS les instantanés de retour arrière ?\n\nÇa supprime uniquement les sauvegardes automatiques quotidiennes accumulées — tes produits, stock et ventes actuels ne sont PAS touchés.\n\nUtile pour repartir propre à la mise en service. Action irréversible.')) return;
    await Store.clearSnapshots();
    U.toast('Tous les instantanés ont été effacés.');
    this.loadSnaps();
  },
  async clearJournal() {
    if (!await U.confirm('Vider le journal des mouvements ?\n\nÇa efface l\'historique des actions (et donc les boutons « Annuler » récents). Tes produits, stock et ventes ne sont PAS touchés.\n\nAction irréversible.')) return;
    Store.clearJournal();
    U.toast('Journal des mouvements vidé.');
    App.rerender();
  },

  _redo: [],
  /* Opération inverse (état actuel) d'une annulation de fiche(s) : sert à « refaire » (Ctrl+Y). Null si non supporté. */
  _inverse(u) {
    const cur = (domain, id) => { const f = (Store.state[domain] || []).find(x => x.id === id); return f ? JSON.parse(JSON.stringify(f)) : null; };
    if (u.type === 'restoreItem') return { type: 'restoreItem', data: { domain: u.data.domain, id: u.data.id, before: cur(u.data.domain, u.data.id) } };
    if (u.type === 'restoreBatch') return { type: 'restoreBatch', data: u.data.map(sn => ({ domain: sn.domain, id: sn.id, before: cur(sn.domain, sn.id) })) };
    if (u.type === 'deleteCreated') return { type: 'restoreItem', data: { domain: u.data.domain, id: u.data.id, before: cur(u.data.domain, u.data.id) } };
    return null;
  },
  _apply(u) {
    const one = (sn, doms) => {
      const arr = Store.state[sn.domain]; if (!Array.isArray(arr)) return;
      const idx = arr.findIndex(x => x.id === sn.id);
      if (sn.before === null) { if (idx >= 0) arr.splice(idx, 1); }
      else if (idx >= 0) arr[idx] = sn.before; else arr.push(sn.before);
      doms.add(sn.domain);
    };
    const doms = new Set();
    if (u.type === 'restoreItem') one(u.data, doms); else u.data.forEach(sn => one(sn, doms));
    Store.save(...doms);
  },
  /* Ctrl+Z : annule la dernière action annulable du journal. Ctrl+Y : refait la dernière action annulée (fiches uniquement). */
  undoLast() {
    const j = (Store.state.journal || []).find(x => x.undo && x.undo.type !== 'receive');
    if (!j) { U.toast('Rien à annuler.'); return; }
    this.undo(j.id);
  },
  redo() {
    const r = this._redo.pop();
    if (!r) { U.toast('Rien à refaire.'); return; }
    try {
      const inv = this._inverse(r.u);
      this._apply(r.u);
      Store.log('refaire', 'Refait : ' + r.label, inv);
      App.rerender();
      U.toast('Action refaite : ' + r.label);
    } catch (e) { U.toast('Impossible de refaire : ' + e.message, true); }
  },
  undo(journalId) {
    const j = Store.state.journal.find(x => x.id === journalId);
    if (!j || !j.undo) return;
    const u = j.undo;
    const inv = this._inverse(u);   // pour « refaire » (Ctrl+Y) : l'état tel qu'il est AVANT cette annulation
    try {
      if (u.type === 'sale') { Ventes.cancelSale(u.data.saleId); return; }
      if (u.type === 'setQty') { const l = Stock.findLot(u.data.pId, u.data.vId, u.data.lId); if (l) l.lot[u.data.field] = u.data.before; Store.save('stockM'); }
      if (u.type === 'setConsoQty') { const c = Store.state.consumables.find(x => x.id === u.data.id); if (c) c.qty = u.data.before; Store.save('consumables'); }
      if (u.type === 'lotTransfer') { const d = u.data; const l = Stock.findLot(d.pId, d.vId, d.lId); if (l) { if (d.dir === 'ge') { l.lot.qtyGeneral += d.n; l.lot.qtyEvent -= d.n; } else { l.lot.qtyEvent += d.n; l.lot.qtyGeneral -= d.n; } } Store.save('stockM'); }
      if (u.type === 'accTransfer') { const d = u.data; const a = Store.state.catalogA.find(x => x.id === d.accId); if (a) { if (d.dir === 'ge') { a.stockGeneral += d.n; a.stockEvent -= d.n; } else { a.stockEvent += d.n; a.stockGeneral -= d.n; } } Store.save('catalogA'); }
      if (u.type === 'fabricate') { const d = u.data; const a = Store.state.catalogA.find(x => x.id === d.accId); if (a) a.stockGeneral -= d.n; d.mats.forEach(m => { const mt = Store.material(m.id); if (mt) mt.qty += m.qty; }); Store.save('catalogA', 'materials'); }
      if (u.type === 'receive') { U.toast('Annule plutôt en supprimant la commande.', true); return; }
      if (u.type === 'b2bGlobalDiscount') {
        if (u.data.acc) { B2B.discountAcc = u.data.before; localStorage.setItem('touffu_b2bDiscountAcc', B2B.discountAcc); }
        else { B2B.discount = u.data.before; localStorage.setItem('touffu_b2bDiscount', B2B.discount); }
      }
      /* Générique (session du 2026-07-28) : restaure une fiche entière (produit stock,
         produit catalogue, accessoire, matière, consommable…) à son état d'avant la
         dernière modification — couvre nom/SKU/seuils/prix/variantes/lots en un seul
         mécanisme (voir Store.snapshot/commitSnapshot). Si la fiche a été supprimée
         entretemps par l'action elle-même, on la réinsère (couvre aussi "annuler une
         suppression", pas seulement "annuler une modification"). */
      if (u.type === 'restoreItem') {
        const arr = Store.state[u.data.domain];
        if (Array.isArray(arr)) {
          const idx = arr.findIndex(x => x.id === u.data.id);
          if (u.data.before === null) { if (idx >= 0) arr.splice(idx, 1); }
          else if (idx >= 0) arr[idx] = u.data.before; else arr.push(u.data.before);
        }
        Store.save(u.data.domain);
      }
      if (u.type === 'restoreBatch') {
        const domains = new Set();
        u.data.forEach(snap => {
          const arr = Store.state[snap.domain];
          if (Array.isArray(arr)) {
            const idx = arr.findIndex(x => x.id === snap.id);
            if (snap.before === null) { if (idx >= 0) arr.splice(idx, 1); }
            else if (idx >= 0) arr[idx] = snap.before; else arr.push(snap.before);
            domains.add(snap.domain);
          }
        });
        Store.save(...domains);
      }
      /* Annule une CRÉATION (pas de "before" possible puisque la fiche n'existait pas) :
         on la supprime simplement de son domaine. */
      if (u.type === 'deleteCreated') {
        Store.state[u.data.domain] = (Store.state[u.data.domain] || []).filter(x => x.id !== u.data.id);
        Store.save(u.data.domain);
      }
      if (u.type === 'unmergeProducts') {
        const d = u.data;
        const baseIdx = Store.state.catalogM.findIndex(p => p.id === d.baseId);
        if (baseIdx >= 0) Store.state.catalogM[baseIdx] = d.baseBefore;
        d.removed.forEach(r => {
          Store.state.catalogM.push(r.product);
          r.stockIds.forEach(sid => { const sp = Store.state.stockM.find(s => s.id === sid); if (sp) sp.catalogId = r.product.id; });
        });
        Store.save('catalogM', 'stockM');
      }
      if (u.type === 'bulkDeleteCatalog') {
        u.data.products.forEach(p => Store.state.catalogM.push(p));
        Store.save('catalogM');
      }
      if (u.type === 'resyncStock' || u.type === 'editStockProduct') {
        const p = Store.state.stockM.find(x => x.id === u.data.pId);
        if (p) {
          p.name = u.data.before.name; p.meatType = u.data.before.meatType;
          if (u.data.before.catalogId !== undefined) p.catalogId = u.data.before.catalogId;
          p.variants = u.data.before.variants;
        }
        Store.save('stockM');
      }
      if (u.type === 'createStockProduct') {
        Store.state.stockM = Store.state.stockM.filter(x => x.id !== u.data.pId);
        Store.save('stockM');
      }
      if (u.type === 'condition') {
        const d = u.data; const l = Stock.findLot(d.pId, d.vId, d.lId);
        if (l) { l.lot.qtyGeneral += d.fromG; l.lot.qtyEvent += (d.consumed - d.fromG); }
        const p = Store.state.stockM.find(x => x.id === d.pId);
        const tv = p?.variants.find(x => x.id === d.tvId);
        const dest = tv?.lots.find(x => x.id === d.destLotId);
        if (dest) dest.qtyGeneral -= d.n;
        (d.cons || []).forEach(cc => { const c = Store.state.consumables.find(x => x.id === cc.id); if (c) c.qty += cc.qty; });
        Store.save('stockM', 'consumables');
      }
      j.undo = null;
      if (inv) this._redo.push({ label: j.label, u: inv });
      Store.log('annulation', 'Annulation : ' + j.label);
      App.rerender();
      U.toast('Mouvement annulé.');
    } catch (e) { U.toast('Annulation impossible : ' + e.message, true); }
  }
};
