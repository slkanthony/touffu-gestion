/* ═══════════ Tests automatiques des CALCULS (audit 2026-11-16, chantier 3) ═══════════
   Lancer :   node tests/run.js      (depuis le dossier touffu-gestion ; aucun navigateur, aucune base, aucune donnée réelle)
   Charge les vrais fichiers de l'appli (utils, store, pricing, achats, accessoires, compta…) dans un faux navigateur minimal, pose des données
   FICTIVES en mémoire, puis compare chaque résultat à une valeur CALCULÉE À LA MAIN (le détail du calcul est en commentaire de chaque cas).
   Règle : toute modification d'une formule commence par ajouter ou adapter son test ici. Sortie : code 1 si un seul test échoue. */
process.env.TZ = 'Europe/Paris';   // les ventes sont datées en heure française (cas « vente à 00 h 30 le 1er du mois »)
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

/* ---------- faux navigateur : juste de quoi charger les fichiers sans erreur ---------- */
const noop = () => {};
const el = () => new Proxy(function () {}, { get: (t, k) => k === 'style' || k === 'classList' || k === 'dataset' ? el() : k === 'length' ? 0 : k === Symbol.iterator ? function* () {} : k === Symbol.toPrimitive ? () => '' : el(), apply: () => el(), set: () => true });
const store = {};
const sandbox = {
  console, setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop, URL, Blob: function () {}, Intl, Date, Math, JSON,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  navigator: { userAgent: 'node', onLine: true }, location: { hash: '', href: '', reload: noop }, indexedDB: {},
  document: { addEventListener: noop, removeEventListener: noop, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, createElement: () => el(), documentElement: el(), body: el(), head: el() },
  MutationObserver: function () { return { observe: noop, disconnect: noop }; }, ResizeObserver: function () { return { observe: noop, disconnect: noop }; }, IntersectionObserver: function () { return { observe: noop, disconnect: noop }; },
  addEventListener: noop, removeEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }), requestAnimationFrame: noop, getComputedStyle: () => ({})
};
['HTMLElement', 'Element', 'Node', 'HTMLSelectElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLDetailsElement'].forEach(n => {
  const C = function () {};
  ['value', 'selectedIndex', 'checked', 'open', 'valueAsNumber'].forEach(k => Object.defineProperty(C.prototype, k, { configurable: true, get() { return undefined; }, set() {} }));
  sandbox[n] = C;
});
sandbox.document.readyState = 'complete';
sandbox.window = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
const FILES = ['config', 'icons', 'utils', 'store', 'pricing', 'visite', 'catalogue', 'accessoires', 'stock', 'ventes', 'paniers', 'b2b', 'woo', 'params', 'achats', 'compta', 'ship', 'devis', 'facture', 'races', 'clients', 'partners', 'stats', 'calc', 'backup'];
FILES.forEach(f => { const p = path.join(root, 'js', f + '.js'); vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: 'js/' + f + '.js' }); });
const run = code => vm.runInContext(code, ctx);
run(`Store.__save = Store.save;`);   // le vrai enregistrement, remis en place pour les cas « deux appareils »

/* ---------- outils de test ---------- */
let ok = 0, ko = 0; const fails = [];
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.005 : tol);
function eq(label, got, want, tol) {
  const good = typeof want === 'number' ? (typeof got === 'number' && near(got, want, tol)) : JSON.stringify(got) === JSON.stringify(want);
  if (good) ok++; else { ko++; fails.push(`✗ ${label}\n    obtenu  : ${JSON.stringify(got)}\n    attendu : ${JSON.stringify(want)}`); }
}
/* Remet des données propres avant chaque groupe. `S` = réglages à surcharger. */
function reset(S) {
  run(`Store.state = Store.merge(null); Store.remote = false; Store.session = null; Store.save = function () {}; window.App = { isViewer: false, isTeam: false, role: 'admin', rerender() {} };`);
  const base = {
    vatRate: 20, vatActive: false, priceBaseHT: true, socialTaxRate: 12.3, socialTaxRateHandmade: 21.2, cardFeeRate: 1.75, stripeFeeRate: 1.5, bulkDiscount: 0,
    portRates: { mastication: 0, matiere: 0, conso: 0 }, b2bCoeffThreshold: 1, accCoeffThreshold: 2, accPriceStep: 0.5, laborRate: 20, labelCost: 0.05, labelTypes: [], labelDefaultId: '',
    suppliers: [{ id: 's1', name: 'Fournisseur test', types: ['mastication'] }], sachets: [{ id: 'sc', name: 'Sachet test', cost: 0.10, type: 'sachet' }], uvEquip: [], uvMaintPct: 0
  };
  sandbox.__S = Object.assign(base, S || {});
  run(`Object.assign(Store.state.settings, __S);`);
}
const prod = over => Object.assign({
  id: 'p1', name: 'Produit test', meatType: 'Boeuf', mainSupplierId: 's1', coefficient: 2, labelTypeId: '', labelCost: 0.05,
  suppliers: [{ id: 'l1', supplierId: 's1', price: 10, taxType: 'HT', vatRate: 10, unit: 'kilo', weight: 1, quantity: 1, piecesPerKilo: '' }],
  variants: [{ id: 'v1', mode: 'gram', value: 100, sachetId: 'sc', enabled: true }]
}, over || {});
function calcAll(p) { sandbox.__p = p; return run(`Pricing._calcAllM(__p, !!Store.state.settings.priceBaseHT)`); }
function saleProfit(s) { sandbox.__s = s; return run(`Pricing.saleProfit(__s)`); }

/* ══════════ 1. PRIX D'UNE VARIANTE (mastication) ══════════ */
/* Achat 10 € HT/kg, TVA d'achat 10 %, non assujetti → coût réel 11 €/kg. Variante 100 g + sachet 0,10 + étiquette 0,05.
   Coût réel = 1,10 + 0,10 + 0,05 = 1,25.  Coût HT (base du coefficient) = 1,00 + 0,10 + 0,05 = 1,15.
   Prix HT = 1,15 × 2 = 2,30 → TTC = 2,76 → arrondi à 0,10 € = 2,80.  HT réel = 2,80 / 1,2 = 2,3333. */
reset();
let c = calcAll(prod())[0];
eq('1a coût réel 100 g', c.cost, 1.25);
eq('1a coût HT (base du coefficient)', c.costHT, 1.15);
eq('1a prix TTC arrondi à 0,10', c.priceTTC, 2.8);
eq('1a prix HT', c.priceHT, 2.3333, 0.0001);
eq('1a marge = HT − coût réel', c.margin, 1.0833, 0.0001);
eq('1a bénéfice actuel = TTC − coût − 12,3 % du TTC', c.profitActuel, 2.8 - 1.25 - 2.8 * 0.123, 0.0001);   // 1,2056
eq('1a coefficient réel (HT ÷ coût réel)', c.effCoeff, 1.8667, 0.0001);
eq('1a prix non fixé', c.priceFixed, false);

/* Ancienne base (coefficient sur le coût TVA d'achat comprise) : 1,25 × 2 = 2,50 → TTC 3,00. */
reset({ priceBaseHT: false });
eq('1b ancienne base de prix', calcAll(prod())[0].priceTTC, 3.0);

/* Même achat saisi TTC : 11 € TTC à 10 % = 10 € HT → même prix. */
reset();
eq('1c fournisseur saisi en TTC', calcAll(prod({ suppliers: [{ id: 'l1', supplierId: 's1', price: 11, taxType: 'TTC', vatRate: 10, unit: 'kilo', weight: 1, quantity: 1 }] }))[0].priceTTC, 2.8);

/* Assujetti à la TVA : la TVA d'achat n'est plus un coût → coût réel = 1,15 ; le prix ne change pas. */
reset({ vatActive: true });
c = calcAll(prod())[0];
eq('1d assujetti : coût réel HT', c.cost, 1.15);
eq('1d assujetti : même prix TTC', c.priceTTC, 2.8);
eq('1d assujetti : marge', c.margin, 2.8 / 1.2 - 1.15, 0.0001);

/* Deux variantes, décote par palier 10 % : la 2e (250 g) → coût HT 2,50 + 0,15 = 2,65 ; HT = 2,65 × 2 × 0,9 = 4,77 → TTC 5,724 → 5,70. */
reset({ bulkDiscount: 10 });
let all = calcAll(prod({ variants: [{ id: 'v1', mode: 'gram', value: 100, sachetId: 'sc', enabled: true }, { id: 'v2', mode: 'gram', value: 250, sachetId: 'sc', enabled: true }] }));
eq('1e 1re variante sans décote', all[0].priceTTC, 2.8);
eq('1e 2e variante décote 10 %', all[1].priceTTC, 5.7);

/* Coefficient propre à la ligne (3) : 1,15 × 3 = 3,45 → TTC 4,14 → 4,10. Pas de décote. */
reset({ bulkDiscount: 10 });
eq('1f coefficient propre à la variante', calcAll(prod({ variants: [{ id: 'v1', mode: 'gram', value: 100, sachetId: 'sc', enabled: true, coeff: 3 }] }))[0].priceTTC, 4.1);

/* Prix fixé à la main : jamais arrondi, jamais recalculé. */
reset();
c = calcAll(prod({ variants: [{ id: 'v1', mode: 'gram', value: 100, sachetId: 'sc', enabled: true, priceTTCManual: 4.99 }] }))[0];
eq('1g prix fixé gardé tel quel', c.priceTTC, 4.99);
eq('1g prix fixé signalé', c.priceFixed, true);

/* Achat à la pièce : 6 € HT les 3 → 2 € HT pièce, TVA d'achat = taux global 20 %. Lot de 2 sans sachet :
   coût HT = 4,00 + 0,05 = 4,05 → HT 8,10 → TTC 9,72 → 9,70. Coût réel = 4,80 + 0,05 = 4,85. */
reset();
c = calcAll(prod({ suppliers: [{ id: 'l1', supplierId: 's1', price: 6, taxType: 'HT', unit: 'piece', weight: 1, quantity: 3 }], variants: [{ id: 'v1', mode: 'piece', value: 2, sachetId: '', enabled: true }] }))[0];
eq('1h achat à la pièce : coût réel du lot de 2', c.cost, 4.85);
eq('1h achat à la pièce : prix TTC', c.priceTTC, 9.7);

/* Achat au kilo, 20 pièces au kilo, vente par 2 pièces sans sachet : 2/20 kg = 1,00 € HT ; coût HT 1,05 → HT 2,10 → TTC 2,52 → 2,50. */
reset();
eq('1i pièces au kilo', calcAll(prod({ suppliers: [{ id: 'l1', supplierId: 's1', price: 10, taxType: 'HT', vatRate: 10, unit: 'kilo', weight: 1, quantity: 1, piecesPerKilo: 20 }], variants: [{ id: 'v1', mode: 'piece', value: 2, sachetId: '', enabled: true }] }))[0].priceTTC, 2.5);

/* Port à l'achat 10 % sur la mastication : coût HT = 1,00 + 0,10 + 0,05 + 0,10 (port) = 1,25 → HT 2,50 → TTC 3,00. */
reset({ portRates: { mastication: 10, matiere: 0, conso: 0 } });
eq('1j port à l\'achat 10 %', calcAll(prod())[0].priceTTC, 3.0);

/* ══════════ 2. ACCESSOIRE (fait main) ══════════ */
/* Matière 2 € HT/m, TVA d'achat 20 % (non assujetti → 2,40 réel), 1,5 m ; 30 min à 20 €/h = 10 € ; frais 1 €.
   Coût réel = 3,60 + 10 + 1 = 14,60. Coût HT = 3,00 + 10 + 1 = 14,00. Coefficient 2,5 → HT 35 → TTC 42,00 (pas de 0,50 €). */
reset();
run(`Store.state.materials = [{ id: 'm1', name: 'Sangle test', kind: 'sangle', unit: 'm', costUnit: 2, costTax: 'HT', costVat: 20, qty: 10, rolls: [{ id: 'r', qty: 10 }] }];
     Store.state.catalogA = [{ id: 'a1', name: 'Laisse test', category: 'Laisse', bom: [{ materialId: 'm1', qty: 1.5 }], laborMinutes: 30, extraCost: 1, coefficient: 2.5 }];`);
let a = run(`Pricing.accCalc(Store.state.catalogA[0])`);
eq('2a accessoire : coût matières réel', a.matCost, 3.6);
eq('2a accessoire : main d\'œuvre', a.laborCost, 10);
eq('2a accessoire : coût réel', a.cost, 14.6);
eq('2a accessoire : prix TTC', a.priceTTC, 42);
eq('2a accessoire : cotisations 21,2 % du HT', a.social, 35 * 0.212, 0.0001);
/* Arrondi au pas de 0,50 € : coefficient 2,53 → 14 × 2,53 × 1,2 = 42,504 → 42,50. */
run(`Store.state.catalogA[0].coefficient = 2.53;`);
eq('2b accessoire : arrondi à 0,50 €', run(`Pricing.accCalc(Store.state.catalogA[0])`).priceTTC, 42.5);

/* ══════════ 3. RÉSULTAT D'UNE VENTE ══════════ */
/* Carte SumUp, 2 × 5 € (coût total figé 3 €) : CA 10 ; frais 1,75 % = 0,175 ; cotisations 12,3 % = 1,23 ; net = 10 − 3 − 0,175 − 1,23 = 5,595. */
reset();
let r = saleProfit({ id: 's', ts: Date.now(), payment: 'sumup', items: [{ kind: 'M', pId: 'x', vId: 'y', price: 5, qty: 2, cost: 3 }] });
eq('3a vente carte : CA', r.ca, 10);
eq('3a vente carte : frais de paiement', r.fee, 0.175, 0.0001);
eq('3a vente carte : cotisations', r.cotis, 1.23, 0.0001);
eq('3a vente carte : bénéfice net', r.net, 5.595, 0.0001);
/* Espèces, accessoire 30 € (coût 10) : cotisations 21,2 % = 6,36 ; net = 13,64. */
r = saleProfit({ id: 's', ts: Date.now(), payment: 'cash', items: [{ kind: 'A', pId: 'zz', price: 30, qty: 1, cost: 10 }] });
eq('3b vente accessoire : cotisations fait main', r.cotis, 6.36, 0.0001);
eq('3b vente accessoire : bénéfice net', r.net, 13.64, 0.0001);
/* Événement : stand 20 + déplacement 5 + repas 10 = 35 ; 100 € de ventes (coût 40), espèces : net = 100 − 40 − 35 − 12,30 = 12,70. */
r = saleProfit({ id: 's', ts: Date.now(), payment: 'cash', eventFee: 20, travelCost: 5, mealFee: 10, items: [{ kind: 'M', pId: 'x', vId: 'y', price: 100, qty: 1, cost: 40 }] });
eq('3c vente événement : frais', r.eventFee, 35);
eq('3c vente événement : bénéfice net', r.net, 12.7, 0.0001);
/* Port encaissé 6 €, envoi payé 5 €, Stripe 1,5 % sur 26 € = 0,39 ; cotisations sur 20 + 6 = 26 × 12,3 % = 3,198 ; net = 20 − 8 + 6 − 0,39 − 5 − 3,198 = 9,412. */
r = saleProfit({ id: 's', ts: Date.now(), payment: 'stripe', shippingFeeCollected: 6, shippingCost: 5, items: [{ kind: 'M', pId: 'x', vId: 'y', price: 20, qty: 1, cost: 8 }] });
eq('3d vente en ligne : bénéfice net', r.net, 9.412, 0.0001);
/* Assujetti : 12 € TTC (coût 4), espèces. Cotisations sur le HT : 10 × 12,3 % = 1,23 ; TVA reversée 2 ; net = 12 − 4 − 1,23 − 2 = 4,77. */
reset({ vatActive: true });
r = saleProfit({ id: 's', ts: Date.now(), payment: 'cash', items: [{ kind: 'M', pId: 'x', vId: 'y', price: 12, qty: 1, cost: 4 }] });
eq('3e assujetti : TVA reversée', r.tva, 2, 0.0001);
eq('3e assujetti : bénéfice net', r.net, 4.77, 0.0001);
/* Vente annulée : ne compte pas. */
reset();
eq('3f vente annulée ignorée', saleProfit({ id: 's', ts: Date.now(), cancelled: true, payment: 'cash', items: [{ kind: 'M', price: 9, qty: 1, cost: 1 }] }).ca, 0);

/* ══════════ 4. COMPTA DU MOIS ══════════ */
/* Deux ventes ce mois-ci : carte 10 € (coût 3) et espèces 30 € accessoire (coût 10). Un achat d'outillage 24 € TTC ce mois-ci.
   Entrées 40 ; marge 27 ; frais de paiement 0,175 ; cotisations 1,23 + 6,36 = 7,59 ; dépenses 24.
   Résultat = 27 − 0,175 − 7,59 − 24 = −4,765.  Trésorerie : sorties = 24 + 0,175 + 7,59 = 31,765 ; solde = 8,235. */
reset();
const now = new Date(), mk = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'), day = mk + '-' + String(now.getDate()).padStart(2, '0');
sandbox.__now = now.getTime(); sandbox.__day = day;
run(`Store.state.sales = [
       { id: 'a', ts: __now, payment: 'sumup', items: [{ kind: 'M', pId: 'x', vId: 'y', price: 5, qty: 2, cost: 3 }] },
       { id: 'b', ts: __now, payment: 'cash', items: [{ kind: 'A', pId: 'zz', price: 30, qty: 1, cost: 10 }] }];
     Store.state.purchases = [{ id: 'f1', date: __day, supplierId: 's1', tax: 'TTC', lines: [{ id: 'l', cat: 'outillage', label: 'Outil test', qty: 1, price: 24 }] }];
     Compta.f.period = 'year';`);
let d = run(`Compta.data()`);
eq('4a compta : le mois courant est présent', d.months.includes(mk), true);
eq('4a compta : entrées du mois', d.M[mk].inc, 40);
eq('4a compta : marge brute', d.M[mk].marge, 27);
eq('4a compta : cotisations', d.M[mk].cotis, 7.59, 0.0001);
eq('4a compta : dépenses du mois', d.M[mk].expensed, 24);
eq('4a compta : bénéfice net', d.M[mk].net, -4.765, 0.0001);
eq('4a compta : achats payés (trésorerie)', d.M[mk].buyPaid, 24);
eq('4a compta : solde de trésorerie', d.M[mk].solde, 8.235, 0.0001);

/* Une vente à 00 h 30 le 1er du mois (heure française) appartient à CE mois, pas au précédent. */
const y = now.getFullYear(), first = new Date(y, 5, 1, 0, 30).getTime();   // 1er juin, 00 h 30
sandbox.__first = first;
eq('4b vente à 00 h 30 le 1er juin → mois de juin', run(`Compta.mk(__first)`), y + '-06');
eq('4b jour local d\'une vente à 00 h 30', run(`U.dayKey(__first)`), y + '-06-01');
eq('4b mois local d\'une vente à 23 h 30 le 31 mai', run(`U.monthKey(${new Date(y, 4, 31, 23, 30).getTime()})`), y + '-05');

/* Amortissement daté : machine 1 200 € sur 2 ans achetée en janvier de l'an dernier → 50 €/mois, de janv. N−1 à déc. N ; plus rien en janvier N+1. */
reset({ uvEquip: [{ id: 'e', name: 'Machine test', price: 1200, years: 2, buyDate: (y - 1) + '-01-15' }] });
eq('4c amortissement : mois d\'achat', run(`Compta._amortFor('${y - 1}-01')`), 50);
eq('4c amortissement : dernier mois', run(`Compta._amortFor('${y}-12')`), 50);
eq('4c amortissement : terminé ensuite', run(`Compta._amortFor('${y + 1}-01')`), 0);
eq('4c amortissement : rien avant l\'achat', run(`Compta._amortFor('${y - 2}-12')`), 0);

/* ══════════ 5. COPIE DU COMPTE VISITE : rien de sensible, mêmes prix ══════════ */
reset();
run(`Store.state.settings.payIban = 'IBANTEST'; Store.state.settings.suppliers[0].name = 'NOMSECRET';
     Store.state.catalogM = [${JSON.stringify(prod({ notes: 'NOTESECRETE', suppliers: [{ id: 'l1', supplierId: 's1', price: 10, taxType: 'HT', vatRate: 10, unit: 'kilo', weight: 1, quantity: 1, url: 'https://exemple.test/secret', ref: 'REFSECRETE' }] }))}];
     Store.state.sales = [{ id: 'a', ts: 1, payment: 'cash', customerName: 'CLIENTSECRET', items: [{ kind: 'M', price: 5, qty: 1, cost: 3.21 }] }];`);
const copy = JSON.stringify(run(`Visite.allKeys().map(k => Visite.wire(k))`));
eq('5 copie visite : aucune valeur sensible', ['IBANTEST', 'NOMSECRET', 'NOTESECRETE', 'REFSECRETE', 'CLIENTSECRET', 'exemple.test', '3.21'].filter(x => copy.includes(x)), []);
eq('5 copie visite : prix de vente figé identique', run(`Visite.catalogM()[0].variants[0].priceTTCManual`), 2.8);

/* ══════════ 7. GÉNÉRATEUR DE PANIERS : le raisonnement (Antho 2026-11-17) ══════════ */
const dayIso = n => { const d = new Date(Date.now() + n * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
/* Produit de stock fictif : une variante « pièce » à 5 €, un lot de 10. `o` = { meat, days (jours avant la date ; négatif = dépassée), tags, price, mode, value } */
const sp = (id, name, o) => ({ id, name, meatType: o.meat || 'Boeuf', tags: o.tags || {}, variants: [{ id: id + 'v', mode: o.mode || 'piece', value: o.value || 1, label: o.label || '', priceTTC: o.price || 5, costUnit: 2, lots: [{ id: id + 'l', lotNumber: 'L', dluo: o.days === undefined ? '' : dayIso(o.days), qtyGeneral: 10, qtyEvent: 0 }] }] });
function paniers(stock, cfg, clients) {
  reset();
  sandbox.__stock = stock; sandbox.__cfg = Object.assign({ budget: 10, livraison: 0, reduction: 0, nbChiens: 1, priority: 'mix', excludeMeats: [], excludeProducts: [], poilFilter: 'all', hypoOnly: false, resistanceInclude: ['faible', 'moyenne', 'forte', 'tres-forte', 'longue'], risks: { glouton: false, choke: false, teeth: false, surpoids: false, energique: false, tendre: false }, races: [], kind: 'vente', typeFilter: 'all', ageInclude: ['0-3', '3-5', '6-10', '11+', 'senior'], gabaritInclude: ['petit', 'moyen', 'grand'], odeurInclude: ['faible', 'moyenne', 'forte'], grasInclude: ['non', 'peu', 'moyen', 'gras'], maxPerProduct: 1, client: '', basket: [], proposals: null }, cfg || {});
  sandbox.__clients = clients || [];
  run(`Store.state.stockM = __stock; Store.state.clients = __clients; window.App.visitMode = false; Object.assign(Paniers, __cfg);`);
}
const build = budget => run(`Paniers._buildBasket(${budget}, [])`).map(b => b.name);
const cand = name => run(`Paniers.candidates()`).find(c => c.name === name);

/* 7a. Note de date : ne dépend plus de la date la plus lointaine du stock. */
eq('7a date dépassée = 1', run(`Paniers._dluoScore(-10)`), 1);
eq('7a à 30 jours = 0,9', run(`Paniers._dluoScore(30)`), 0.9);
eq('7a à 90 jours = 0,5', run(`Paniers._dluoScore(90)`), 0.5);
eq('7a à 6 mois = 0,2', run(`Paniers._dluoScore(180)`), 0.2);
eq('7a à 2 ans = 0,05', run(`Paniers._dluoScore(700)`), 0.05);
eq('7a sans date = 0,05', run(`Paniers._dluoScore(9999)`), 0.05);

/* 7b. Dates dépassées et courtes D'ABORD : budget 10 € = 2 produits à 5 € → les deux urgents, pas les autres. */
paniers([sp('a', 'Loin 1', { days: 400, meat: 'Canard' }), sp('b', 'Dépassé', { days: -15, meat: 'Boeuf' }), sp('c', 'Loin 2', { days: 300, meat: 'Lapin' }), sp('d', 'Court', { days: 20, meat: 'Cerf' }), sp('e', 'Moyen', { days: 80, meat: 'Dinde' })]);
eq('7b les 2 produits urgents passent en premier', build(10).sort(), ['Court', 'Dépassé']);
eq('7b puis le suivant par date (80 jours) quand le budget le permet', build(15).sort(), ['Court', 'Dépassé', 'Moyen']);
run(`Paniers.priority = 'coeff';`);
eq('7b priorité « rentabilité » : pas de passage forcé des urgents', build(10).length, 2);

/* 7c. Âge : tout coché = âge inconnu = aucune préférence (avant : tout panier noté comme pour un chiot). */
paniers([sp('a', 'Cerf dur', { meat: 'Cerf', days: 200 }), sp('b', 'Poulet', { meat: 'Poulet', days: 200 })]);
eq('7c adulte / âge inconnu : cerf neutre', run(`Paniers._meatAgePrefScore(Paniers.candidates().find(c => c.name === 'Cerf dur'))`), 0.5);
eq('7c adulte / âge inconnu : poulet neutre', run(`Paniers._meatAgePrefScore(Paniers.candidates().find(c => c.name === 'Poulet'))`), 0.5);
run(`Paniers.ageInclude = ['0-3'];`);
eq('7c chiot choisi : poulet favorisé', run(`Paniers._meatAgePrefScore(Paniers.candidates().find(c => c.name === 'Poulet'))`), 1);
eq('7c chiot choisi : cerf pénalisé', run(`Paniers._meatAgePrefScore(Paniers.candidates().find(c => c.name === 'Cerf dur'))`), 0.1);

/* 7d. Fiche du chien : âge, mâcheur, viandes aimées, produits déjà goûtés. */
const chiot = { id: 'c1', name: 'Cliente Test', dogs: [{ id: 'd1', name: 'Chiot Test', birth: dayIso(-60), gabarit: 'petit', chew: 'doux', meats: { Lapin: 'like' }, tried: [{ id: 't', name: 'Pas aimé', verdict: 'avoid' }, { id: 'u', name: 'Adoré', verdict: 'like' }] }] };
paniers([sp('a', 'Bois dur', { meat: 'Cerf', days: 200, tags: { resistance: 'tres-forte' } }), sp('b', 'Tendre', { meat: 'Lapin', days: 200, tags: { resistance: 'faible' } }), sp('c', 'Pas aimé', { meat: 'Boeuf', days: -5 }), sp('d', 'Adoré', { meat: 'Boeuf', days: 200 }), sp('e', 'Neutre', { meat: 'Dinde', days: 200, tags: { resistance: 'moyenne' } })], { client: 'Cliente Test' }, [chiot]);
eq('7d chiot de 2 mois : âge lu sur la fiche', cand('Tendre').ages, ['0-3']);
eq('7d chiot : produit très dur écarté', cand('Bois dur'), undefined);
eq('7d produit noté « pas aimé » écarté, même à date dépassée', cand('Pas aimé'), undefined);
eq('7d viande aimée repérée', cand('Tendre').liked, true);
eq('7d produit noté « aimé » repéré', cand('Adoré').liked, true);
eq('7d produit neutre', cand('Neutre').liked, false);
eq('7d mâcheur doux : tendre = 1', run(`Paniers._gabaritResistScore(Paniers.candidates().find(c => c.name === 'Tendre'))`), 1);
eq('7d mâcheur doux : résistance moyenne = 0,6', run(`Paniers._gabaritResistScore(Paniers.candidates().find(c => c.name === 'Neutre'))`), 0.6);
/* Gros destructeur adulte : le dur est favorisé, et la résistance souhaitée se coche toute seule en choisissant la cliente. */
const gros = { id: 'c2', name: 'Cliente Deux', dogs: [{ id: 'd2', name: 'Grand Test', birth: dayIso(-900), gabarit: 'grand', chew: 'gros', meats: {} }] };
paniers([sp('a', 'Bois dur', { meat: 'Cerf', days: 200, tags: { resistance: 'tres-forte' } }), sp('b', 'Tendre', { meat: 'Lapin', days: 200, tags: { resistance: 'faible' } })], {}, [gros]);
run(`Paniers.render = function () {}; U.toast = function () {}; Paniers.resistanceInclude = Paniers.resistanceInclude.filter(r => r !== 'longue'); Paniers.setClient('Cliente Deux');`);
eq('7d gros destructeur : résistance souhaitée réglée (mastication longue jamais d\'office)', run(`Paniers.resistanceInclude`), ['moyenne', 'forte', 'tres-forte']);
eq('7d gros destructeur : très dur = 1', run(`Paniers._gabaritResistScore(Paniers.candidates().find(c => c.name === 'Bois dur'))`), 1);
eq('7d gros destructeur : le tendre est écarté par la résistance', cand('Tendre'), undefined);
/* Gros destructeur : plusieurs produits durs dans le même panier (la limite « un seul produit dur » ne vaut que pour les autres chiens) → le budget est utilisé. */
paniers([sp('a', 'Dur 1', { meat: 'Cerf', days: 200, tags: { resistance: 'tres-forte' } }), sp('b', 'Dur 2', { meat: 'Boeuf', days: 200, tags: { resistance: 'forte' } }), sp('c', 'Dur 3', { meat: 'Buffle', days: 200, tags: { resistance: 'forte' } })], { client: 'Cliente Deux' }, [gros]);
eq('7e gros destructeur : 3 produits durs pour 15 €', build(15).sort(), ['Dur 1', 'Dur 2', 'Dur 3']);
paniers([sp('a', 'Dur 1', { meat: 'Cerf', days: 200, tags: { resistance: 'tres-forte' } }), sp('b', 'Dur 2', { meat: 'Boeuf', days: 200, tags: { resistance: 'forte' } }), sp('c', 'Tendre', { meat: 'Lapin', days: 200, tags: { resistance: 'faible' } })]);
eq('7e chien inconnu : un seul produit dur par panier', build(15).filter(n => n.startsWith('Dur')).length, 1);

/* ══════════ 8. PANIERS : le budget au plus près (Antho 2026-11-17) ══════════ */
const total = budget => run(`Paniers._buildBasket(${budget}, [])`).reduce((a, b) => a + b.price * b.qty, 0);
/* A et B urgents à 7 €, D à 6 € (100 j), E à 8 € (300 j), C à 9 € (400 j) ; budget 22 €, 1 exemplaire par produit.
   Choix normal : A + B (14) puis D (date plus proche que E) = 20 €, reste 2 €. Finition : D (6) remplacé par E (8) → 22 € pile. */
const st8 = () => [sp('a', 'A', { days: -5, price: 7, meat: 'Boeuf' }), sp('b', 'B', { days: 10, price: 7, meat: 'Canard' }), sp('c', 'C', { days: 400, price: 9, meat: 'Lapin' }), sp('d', 'D', { days: 100, price: 6, meat: 'Dinde' }), sp('e', 'E', { days: 300, price: 8, meat: 'Cerf' })];
paniers(st8());
eq('8a budget 22 € : total pile au budget', total(22), 22);
eq('8a … les deux urgents sont toujours là', build(22).filter(n => n === 'A' || n === 'B').length, 2);
eq('8a … composé de A, B et E', build(22).sort(), ['A', 'B', 'E']);
/* Jamais un produit urgent remplacé par un produit à date longue : budget 9 €, A (7 €, dépassé) reste, C (9 €, 400 j) ne le remplace pas. */
paniers([sp('a', 'A', { days: -5, price: 7 }), sp('c', 'C', { days: 400, price: 9, meat: 'Lapin' })]);
eq('8b un urgent n\'est jamais remplacé par une date longue', build(9), ['A']);
/* Jamais au-dessus du plafond, quel que soit le budget. */
paniers(st8());
eq('8c jamais au-dessus du budget (21 €)', total(21) <= 21.005, true);
eq('8c jamais au-dessus du budget (25 €)', total(25) <= 25.005, true);
/* Deux propositions : « pile budget » ≤ 30 €, « un peu au-dessus » entre 30 et 33 € (10 %). */
paniers([sp('a', 'A', { days: -5, price: 7, meat: 'Boeuf' }), sp('b', 'B', { days: 10, price: 7, meat: 'Canard' }), sp('c', 'C', { days: 400, price: 9, meat: 'Lapin' }), sp('d', 'D', { days: 100, price: 6, meat: 'Dinde' }), sp('e', 'E', { days: 300, price: 8, meat: 'Cerf' }), sp('f', 'F', { days: 200, price: 4.5, meat: 'Poulet' })], { budget: 30 });
run(`Paniers.render = function () {}; U.toast = function () {}; Paniers._generateNow();`);
const props = run(`Paniers.proposals`);
eq('8d deux propositions', !!props && props.length, 2);
if (props) {
  const t1 = props[0].reduce((a, b) => a + b.price * b.qty, 0), t2 = props[1].reduce((a, b) => a + b.price * b.qty, 0);
  eq('8d proposition 1 : jamais au-dessus de 30 €', t1 <= 30.005, true);
  eq('8d proposition 2 : au-dessus de 30 €', t2 > 30.005, true);
  eq('8d proposition 2 : au plus 33 € (+10 %)', t2 <= 33.005, true);
}

/* ══════════ 9. PANIERS : produits déjà achetés par la cliente (Antho 2026-11-17) ══════════ */
const habituee = { id: 'c9', name: 'Cliente Habituée', dogs: [{ id: 'd9', name: 'Chien Neuf', birth: dayIso(-900), meats: {}, tried: [] }] };
const st9 = () => [sp('a', 'Produit A', { days: 200, meat: 'Boeuf' }), sp('b', 'Produit B', { days: 200, meat: 'Canard' }), sp('c', 'Produit C', { days: 200, meat: 'Lapin' }), sp('d', 'Produit D', { days: 200, meat: 'Dinde' }), sp('e', 'Produit E', { days: 200, meat: 'Cerf' })];
/* A (avec identifiant) et B (ancienne vente, SANS identifiant) achetés il y a 30 jours ; C il y a 40 jours ; E il y a 400 jours ; D jamais ; une vente annulée ne compte pas. */
const vente9 = [{ id: 'old', ts: Date.now() - 40 * 86400000, payment: 'cash', customerName: 'cliente habituée', items: [{ kind: 'M', pId: 'c', vId: 'cv', name: 'Produit C', price: 4, qty: 1, cost: 1 }] },
  { id: 'tres', ts: Date.now() - 400 * 86400000, payment: 'cash', customerName: 'Cliente Habituée', items: [{ kind: 'M', pId: 'e', vId: 'ev', name: 'Produit E', price: 4, qty: 1, cost: 1 }] },
  { id: 'last', ts: Date.now() - 30 * 86400000, payment: 'cash', customerName: 'Cliente Habituée', items: [{ kind: 'M', pId: 'a', vId: 'av', name: 'Produit A', label: '', price: 4, qty: 2, cost: 1 }, { kind: 'M', name: 'Produit B', price: 4, qty: 1, cost: 1 }] },
  { id: 'ann', ts: Date.now() - 5 * 86400000, cancelled: true, payment: 'cash', customerName: 'Cliente Habituée', items: [{ kind: 'M', pId: 'd', vId: 'dv', name: 'Produit D', price: 5, qty: 1 }] }];
sandbox.__v9 = vente9;
paniers(st9(), { client: 'Cliente Habituée' }, [habituee]); run(`Store.state.sales = __v9;`);
eq('9a dernier panier = la dernière vente non annulée', run(`Paniers._lastSale().id`), 'last');
eq('9a jours depuis le dernier achat de chaque produit', run(`Paniers._boughtAgo()`), { c: 40, e: 400, a: 30, b: 30 });
eq('9b acheté il y a moins d\'un mois : plus proposé (A, et B retrouvé par le nom)', !cand('Produit A') && !cand('Produit B'), true);
eq('9b acheté il y a plus d\'un mois : proposé comme un produit nouveau', !!cand('Produit C'), true);
eq('9b même note qu\'un produit jamais acheté', run(`(() => { const c = Paniers.candidates(); const s = x => Paniers._itemScore(c.find(k => k.name === x), new Set(), {}, 1, Paniers._weights(), 1); return Math.abs(s('Produit C') - s('Produit D')) < 0.001; })()`), true);
eq('9b budget pour 3 produits : ni A ni B', build(15).filter(n => n === 'Produit A' || n === 'Produit B').length, 0);
/* Même à date DÉPASSÉE, un produit acheté le mois dernier n'est pas reproposé (doublon). */
paniers([sp('a', 'Produit A', { days: -5, meat: 'Boeuf' }), sp('d', 'Produit D', { days: 200, meat: 'Dinde' })], { client: 'Cliente Habituée' }, [habituee]); run(`Store.state.sales = __v9;`);
eq('9c date dépassée mais achetée le mois dernier : écartée', build(5), ['Produit D']);
/* … sauf s'il est ajouté à la main avant de générer (ligne verrouillée = base du panier). */
eq('9c ajouté à la main : il reste dans le panier', run(`Paniers._buildBasket(10, [{ pId: 'a', vId: 'av', lotId: 'al', name: 'Produit A', meat: 'Boeuf', price: 5, qty: 1, locked: true }]).map(b => b.name).sort()`), ['Produit A', 'Produit D']);
/* Refaire le dernier panier : mêmes produits et quantités, prix d'aujourd'hui, produit manquant signalé. */
paniers([sp('a', 'Produit A', { days: 200, price: 6 }), sp('c', 'Produit C', { days: 200 })], { client: 'Cliente Habituée' }, [habituee]); run(`Store.state.sales = __v9; Paniers.render = function () {}; U.toast = (m, e) => __msg.push(m);`);
sandbox.__msg = [];
run(`Paniers.redoLast()`);
eq('9e refaire : produit A ×2', run(`Paniers.basket.map(b => b.name + ' x' + b.qty)`), ['Produit A x2']);
eq('9e refaire : prix d\'aujourd\'hui', run(`Paniers.basket[0].price`), 6);
eq('9e refaire : produit B manquant signalé', /Produit B/.test(sandbox.__msg.join(' ')), true);
/* Voir le dernier panier : une fenêtre, sans toucher au panier en cours. */
sandbox.__modal = null; run(`U.modal = o => { __modal = o; }; Paniers.showLast();`);
eq('9f voir : fenêtre avec le contenu du dernier panier', !!sandbox.__modal && /Produit A/.test(sandbox.__modal.body) && /Produit B/.test(sandbox.__modal.body), true);
eq('9f voir : le panier en cours ne change pas', run(`Paniers.basket.length`), 1);

/* ══════════ 10. PANIERS : mastication longue (cornes, bois naturels) ══════════ */
paniers([sp('a', 'Corne test', { meat: 'Cornes', days: 200, tags: { resistance: 'longue' } }), sp('b', 'Tendre', { meat: 'Lapin', days: 200, tags: { resistance: 'faible' } })], {}, [chiot]);
run(`Paniers.client = 'Cliente Test';`);
eq('10a chiot de 2 mois : pas de mastication longue', cand('Corne test'), undefined);
paniers([sp('a', 'Corne test', { meat: 'Cornes', days: 200, tags: { resistance: 'longue' } }), sp('b', 'Bois test', { meat: 'Bois Naturel', days: 200, tags: { resistance: 'longue' } }), sp('c', 'Tendre', { meat: 'Lapin', days: 200, tags: { resistance: 'faible' } })]);
eq('10b chien inconnu : une seule mastication dure par panier', build(15).filter(n => n !== 'Tendre').length, 1);
paniers([sp('a', 'Corne test', { meat: 'Cornes', days: 200, tags: { resistance: 'longue' } })], {}, [gros]);
run(`Paniers.render = function () {}; U.toast = function () {}; Paniers.resistanceInclude = Paniers.resistanceInclude.filter(r => r !== 'longue'); Paniers.setClient('Cliente Deux');`);
eq('10c gros destructeur : mastication longue PAS cochée d\'office', run(`Paniers.resistanceInclude.includes('longue')`), false);
run(`Paniers.resistanceInclude.push('longue');`);
eq('10c gros destructeur : mastication longue très bien notée', run(`Paniers._gabaritResistScore(Paniers.candidates().find(c => c.name === 'Corne test'))`), 1);

/* ══════════ 11. PANIERS : particularités du chien et races (Antho 2026-11-17) ══════════ */
const sz = (id, name, label, o) => { const x = sp(id, name, o); x.variants[0].mode = 'size'; x.variants[0].label = label; x.variants[0].value = label; return x; };
const st11 = () => [sp('a', 'Peau', { days: 200, meat: 'Boeuf', tags: { ramollit: 'oui', resistance: 'moyenne' } }), sz('b', 'Bois', 'S', { days: 200, meat: 'Cerf', tags: { resistance: 'longue' } }),
  sz('c', 'Bois L', 'L', { days: 200, meat: 'Buffle', tags: { resistance: 'longue' } }), sp('d', 'Oreille grasse', { days: 200, meat: 'Porc', tags: { gras: 'gras', resistance: 'faible' } }),
  sp('e', 'Tendon', { days: 200, meat: 'Lapin', tags: { resistance: 'faible', gras: 'peu' } }), sp('f', 'Poisson', { days: 200, meat: 'Poisson', tags: { resistance: 'faible' } })];
const names11 = () => run(`Paniers.candidates().map(c => c.name).sort()`);
paniers(st11());
eq('11a sans particularité : tout est proposé', names11(), ['Bois', 'Bois L', 'Oreille grasse', 'Peau', 'Poisson', 'Tendon']);
run(`Paniers.risks.glouton = true;`);
eq('11b glouton : ni « se ramollit » ni petite taille', names11(), ['Bois L', 'Oreille grasse', 'Poisson', 'Tendon']);
run(`Paniers.gabaritInclude = ['petit'];`);
eq('11b glouton mais petit chien : la petite taille revient (la taille L est pour moyen / grand)', names11(), ['Bois', 'Oreille grasse', 'Poisson', 'Tendon']);
paniers(st11()); run(`Paniers.risks.teeth = true;`);
eq('11c dents fragiles : rien de dur', names11(), ['Oreille grasse', 'Peau', 'Poisson', 'Tendon']);
paniers(st11()); run(`Paniers.risks.surpoids = true;`);
eq('11d surpoids : rien de gras', names11(), ['Bois', 'Bois L', 'Peau', 'Poisson', 'Tendon']);
paniers(st11()); run(`Paniers.risks.energique = true;`);
eq('11e très énergique sans fiche : mastication longue très bien notée', run(`Paniers._gabaritResistScore(Paniers.candidates().find(c => c.name === 'Bois L'))`), 1);
/* Fiche chien avec une race : particularités et viandes à éviter de la race, cochées toutes seules. */
const racee = { id: 'c11', name: 'Cliente Race', dogs: [{ id: 'd11', name: 'Molosse Test', birth: dayIso(-1500), breeds: ['dogue-de-bordeaux'], meats: {}, tried: [] }] };
paniers(st11(), {}, [racee]);
run(`Store.state.settings.breeds = JSON.parse(JSON.stringify(RACES_DEFAULT)); Store.state.settings.breeds.find(r => r.id === 'dogue-de-bordeaux').avoidMeats = ['Poisson'];
     Paniers.render = function () {}; U.toast = function () {}; Paniers.setClient('Cliente Race');`);
eq('11f race molosse : glouton et risque d\'étouffement cochés', run(`Paniers.risks.glouton && Paniers.risks.choke`), true);
eq('11f race : viande à éviter écartée, « se ramollit » écarté', names11().includes('Poisson') || names11().includes('Peau'), false);
/* La fiche du chien l'emporte sur la race. */
const corr = JSON.parse(JSON.stringify(racee)); corr.dogs[0].glouton = 'non'; corr.dogs[0].choke = 'non';
paniers(st11(), {}, [corr]); run(`Store.state.settings.breeds = null; Paniers.render = function () {}; U.toast = function () {}; Paniers.setClient('Cliente Race');`);
eq('11g fiche « non glouton, pas de risque » : rien de coché', run(`Paniers.risks.glouton || Paniers.risks.choke`), false);

/* ══════════ 12. PANIERS : une mastication longue par panier, types de panier (Antho 2026-11-17) ══════════ */
const longs = () => [sp('a', 'Corne 1', { meat: 'Cornes', days: 200, tags: { resistance: 'longue' } }), sp('b', 'Corne 2', { meat: 'Buffle', days: 200, tags: { resistance: 'longue' } }), sp('c', 'Bois 3', { meat: 'Cerf', days: 200, tags: { resistance: 'longue' } }), sp('d', 'Tendre', { meat: 'Lapin', days: 200, tags: { resistance: 'faible' } })];
paniers(longs(), {}, [gros]); run(`Paniers.render = function () {}; U.toast = function () {}; Paniers.resistanceInclude = Paniers.resistanceInclude.filter(r => r !== 'longue'); Paniers.setClient('Cliente Deux'); Paniers.resistanceInclude.push('longue');`);
eq('12a gros destructeur : jamais deux mastications longues', build(20).filter(n => n !== 'Tendre').length, 1);
paniers(longs(), {}, [gros]); run(`Paniers.render = function () {}; U.toast = function () {}; Paniers.resistanceInclude = Paniers.resistanceInclude.filter(r => r !== 'longue'); Paniers.setClient('Cliente Deux');`);
eq('12b mastication longue décochée : aucune, même pour un chien très énergique', build(20).filter(n => n !== 'Tendre').length, 0);
/* Types de panier : budget 10 €, produits à 4 € → 8 € au plus près ; la vente propose aussi 12 € (≤ 11 €… non : +10 % = 11 €, donc pas de 2e) */
const kinds = () => [sp('a', 'A', { days: 200, price: 4, meat: 'Boeuf' }), sp('b', 'B', { days: 200, price: 4, meat: 'Canard' }), sp('c', 'C', { days: 200, price: 3, meat: 'Lapin' }), sp('d', 'D', { days: 200, price: 2.5, meat: 'Dinde' })];
const gen = k => { paniers(kinds(), { budget: 10, kind: k }); run(`Paniers.render = function () {}; U.toast = function () {}; Paniers._generateNow();`); const ps = run(`Paniers.proposals`) || [run(`Paniers.basket`)]; return ps.map(b => Math.round(b.reduce((a, x) => a + x.price * x.qty, 0) * 100) / 100); };
eq('12c vente : deux propositions (au plus près, puis au-dessus)', gen('vente').length, 2);
eq('12d commande site : une seule proposition, jamais au-dessus', gen('site').every(t => t <= 10.005) && gen('site').length === 1, true);
eq('12e lot à gagner : une seule proposition, jamais au-dessus', gen('lot').every(t => t <= 10.005) && gen('lot').length === 1, true);
/* Lot à gagner : à date égale, le plus fort coefficient d'abord ; une date dépassée passe quand même en premier. */
const lotSt = () => { const a = sp('a', 'Faible coeff', { days: 200, price: 4, meat: 'Boeuf' }), b = sp('b', 'Fort coeff', { days: 200, price: 4, meat: 'Canard' }), c = sp('c', 'Dépassé', { days: -3, price: 4, meat: 'Lapin' }); return [a, b, c]; };
paniers(lotSt(), { budget: 4, kind: 'lot' });
run(`Pricing._calcAllM = Pricing._calcAllM; Paniers.candidates = (orig => function () { const out = orig.call(this); out.forEach(c => { c.coeff = c.name === 'Fort coeff' ? 3 : c.name === 'Faible coeff' ? 1.2 : 2; }); return out; })(Paniers.candidates);`);
eq('12f lot : une date dépassée passe en premier', build(4), ['Dépassé']);
eq('12f lot : puis le plus fort coefficient', build(8).sort(), ['Dépassé', 'Fort coeff']);

/* ══════════ 13. PANIERS : « préfère le tendre », race sans fiche (Antho 2026-11-17) ══════════ */
const st13 = () => [sp('a', 'Dur', { days: 200, meat: 'Boeuf', tags: { resistance: 'forte' } }), sp('b', 'Tendre', { days: 200, meat: 'Lapin', tags: { resistance: 'faible' } }), sp('c', 'Moyen', { days: 200, meat: 'Dinde', tags: { resistance: 'moyenne' } })];
paniers(st13()); run(`Paniers.render = function () {}; U.toast = function () {}; Paniers.toggleRisk('energique'); Paniers.toggleRisk('tendre');`);
eq('13a « préfère le tendre » décoche « très énergique »', run(`Paniers.risks.energique`), false);
eq('13a « préfère le tendre » : rien de dur', names11().includes('Dur'), false);
eq('13a « préfère le tendre » : le tendre mieux noté que le moyen', run(`(() => { const c = Paniers.candidates(); return Paniers._gabaritResistScore(c.find(k => k.name === 'Tendre')) > Paniers._gabaritResistScore(c.find(k => k.name === 'Moyen')); })()`), true);
paniers(st13()); run(`Paniers.render = function () {}; U.toast = function () {}; Store.state.settings.breeds = JSON.parse(JSON.stringify(RACES_DEFAULT)); Store.state.settings.breeds.find(r => r.id === 'border-collie').avoidMeats = ['Dinde']; Paniers.resistanceInclude = ['faible', 'moyenne']; Paniers.addRace('border-collie');`);
eq('13b race choisie sans fiche : très énergique coché', run(`Paniers.risks.energique`), true);
eq('13b race : gabarit pré-rempli', run(`Paniers.gabaritInclude`), ['moyen']);
eq('13b race : résistance de gros mâcheur, sans mastication longue', run(`Paniers.resistanceInclude`), ['moyenne', 'forte', 'tres-forte']);
eq('13b race : viande à éviter ajoutée aux exclusions', run(`Paniers.excludeMeats`), ['Dinde']);
run(`Store.state.settings.breeds = null;`);

/* ══════════ 6. DEUX APPAREILS : numéros de version, rien n'est écrasé ══════════ */
/* Fausse base qui applique les mêmes règles que la fonction SQL app_state_put_many (voir supabase_versions_2026-11-16.sql). */
function fakeDb() {
  const rows = {}, log = { selects: [], puts: [] };
  const put = (k, data) => { rows[k] = { data: JSON.parse(JSON.stringify(data)), rev: rows[k] ? rows[k].rev + 1 : 1 }; return rows[k].rev; };
  const sb = {
    from() {
      return {
        async upsert(row) { log.puts.push('direct:' + row.key); put(row.key, row.data); return { error: null }; },
        select(cols) {
          const q = { cols, keys: null, in(col, list) { this.keys = list; return this; },
            then(res) {
              const ks = Object.keys(rows).filter(k => !q.keys || q.keys.includes(k));
              log.selects.push(cols === 'key,rev' ? 'revs' : ks.slice().sort().join(','));
              res({ data: ks.map(k => cols === 'key,rev' ? { key: k, rev: rows[k].rev } : { key: k, data: JSON.parse(JSON.stringify(rows[k].data)), rev: rows[k].rev }), error: null });
            } };
          return q;
        }
      };
    },
    async rpc(name, args) {
      if (name !== 'app_state_put_many') return { data: null, error: { message: 'fonction inconnue' } };
      const items = args.p_items, conflicts = items.filter(it => it.rev !== null && rows[it.key] && rows[it.key].rev !== it.rev).map(it => it.key);
      log.puts.push(items.map(it => it.key + '@' + it.rev).join(','));
      if (conflicts.length) return { data: { ok: false, conflicts }, error: null };
      const revs = {}; items.forEach(it => { revs[it.key] = put(it.key, it.data); });
      return { data: { ok: true, revs, denied: [] }, error: null };
    }
  };
  return { rows, log, sb, put };
}
async function twoDevices() {
  reset();
  const db = fakeDb(); sandbox.__db = db; sandbox.__alerts = [];
  const lot = q => [{ id: 'st', name: 'Produit test', variants: [{ id: 'sv', lots: [{ id: 'l', qtyGeneral: q, qtyEvent: 0 }] }] }];
  db.put('settings', run(`Store.state.settings`)); db.put('stockM', lot(10)); db.put('sales', []); db.put('journal', []); db.put('meta', {});
  run(`Store.state = null; Store._rev = {}; Store._dirty = new Set(); Store.sb = __db.sb; Store.remote = true; Store.session = { user: { email: 't@exemple.test', app_metadata: { role: 'admin' } } };
       Store.save = Store.__save; U.alert = (m, t) => { __alerts.push(t); }; U.toast = () => {}; window.App = { isViewer: false, isTeam: false, role: 'admin', rerender() {} };
       Visite.VER = 0; Visite._tried = true;`);   // copie « visite » neutralisée ici (testée au point 5)
  await run(`Store.loadRemote()`);
  eq('6a premier chargement : tout est lu', run(`Store.state.stockM[0].variants[0].lots[0].qtyGeneral`), 10);
  eq('6a numéros de version mémorisés', run(`Store._rev.stockM`), 1);

  /* Rien n'a changé ailleurs : le rechargement ne télécharge que les numéros. */
  db.log.selects.length = 0;
  eq('6b rechargement sans changement : rien de téléchargé', await run(`Store.loadRemote()`), false);
  eq('6b … une seule petite requête', db.log.selects, ['revs']);

  /* Un autre appareil modifie le stock : seul le stock est retéléchargé. */
  db.put('stockM', lot(7)); db.log.selects.length = 0;
  await run(`Store.loadRemote()`);
  eq('6c rechargement partiel : seulement la clé modifiée', db.log.selects, ['revs', 'stockM']);
  eq('6c … et sa nouvelle valeur est là', run(`Store.state.stockM[0].variants[0].lots[0].qtyGeneral`), 7);

  /* Enregistrement normal : la vente et le stock partent ensemble, les numéros avancent. */
  run(`Store.state.stockM[0].variants[0].lots[0].qtyGeneral = 6; Store.state.sales.push({ id: 'v1', ts: 1, items: [] }); Store.save('stockM', 'sales');`);
  await run(`Store.flush()`);
  eq('6d enregistrement normal : stock écrit', db.rows.stockM.data[0].variants[0].lots[0].qtyGeneral, 6);
  eq('6d … vente écrite', db.rows.sales.data.length, 1);
  eq('6d … numéro du stock avancé', run(`Store._rev.stockM`), 3);
  eq('6d … rien en attente', run(`Store._dirty.size`), 0);

  /* CONFLIT : pendant ce temps, l'autre appareil a enregistré une vente (v2). Ici on vend aussi (v3, stock 6 → 5) sans avoir rechargé.
     Avant : la liste des ventes d'ici écrasait v2. Maintenant : RIEN n'est écrit (ni la vente, ni le stock), l'écran reprend la version à jour. */
  db.put('sales', [{ id: 'v1', ts: 1, items: [] }, { id: 'v2', ts: 2, items: [] }]);
  run(`Store.state.stockM[0].variants[0].lots[0].qtyGeneral = 5; Store.state.sales.push({ id: 'v3', ts: 3, items: [] }); Store.save('stockM', 'sales');`);
  await run(`Store.flush()`);
  eq('6e conflit : la vente de l\'autre appareil est toujours en base', db.rows.sales.data.map(x => x.id), ['v1', 'v2']);
  eq('6e conflit : le stock n\'a PAS été écrit seul', db.rows.stockM.data[0].variants[0].lots[0].qtyGeneral, 6);
  eq('6e conflit : l\'écran reprend les ventes à jour', run(`Store.state.sales.map(x => x.id)`), ['v1', 'v2']);
  eq('6e conflit : l\'écran reprend le stock à jour', run(`Store.state.stockM[0].variants[0].lots[0].qtyGeneral`), 6);
  eq('6e conflit : message affiché', sandbox.__alerts.length, 1);
  eq('6e conflit : rien en attente', run(`Store._dirty.size`), 0);

  /* Après le rechargement, refaire l'action fonctionne. */
  run(`Store.state.stockM[0].variants[0].lots[0].qtyGeneral = 5; Store.state.sales.push({ id: 'v3', ts: 3, items: [] }); Store.save('stockM', 'sales');`);
  await run(`Store.flush()`);
  eq('6f action refaite : les 3 ventes sont en base', db.rows.sales.data.map(x => x.id), ['v1', 'v2', 'v3']);
  eq('6f action refaite : stock à 5', db.rows.stockM.data[0].variants[0].lots[0].qtyGeneral, 5);

  /* Coupure réseau : rien n'est perdu, tout reste en attente. */
  const rpc = db.sb.rpc; db.sb.rpc = async () => ({ data: null, error: { message: 'réseau' } });
  run(`Store.state.sales.push({ id: 'v4', ts: 4, items: [] }); Store.save('sales');`);
  const errLog = console.error; console.error = () => {};
  await run(`Store.flush()`);
  console.error = errLog;
  eq('6g coupure réseau : la vente reste en attente', run(`Store._dirty.has('sales')`), true);
  db.sb.rpc = rpc; await run(`Store.flush()`);
  eq('6g réseau revenu : la vente part', db.rows.sales.data.map(x => x.id), ['v1', 'v2', 'v3', 'v4']);

  /* Filet de sécurité : si la base refuse l'appel lui-même (fonction absente…), l'enregistrement repasse par l'ancien envoi et la cause est notée. */
  db.sb.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'fonction introuvable' } });
  run(`Store.state.sales.push({ id: 'v5', ts: 5, items: [] }); Store.save('sales');`);
  console.error = () => {}; await run(`Store.flush()`); console.error = errLog;
  eq('6i filet de sécurité : la vente est quand même enregistrée', db.rows.sales.data.map(x => x.id).includes('v5'), true);
  eq('6i filet de sécurité : la cause est notée', run(`Store.state.meta.putErr`), 'PGRST202 fonction introuvable');
  db.sb.rpc = rpc; await run(`Store.loadRemote()`); await run(`Store.flush()`);

  /* Le coffre du journal (copie calculée) part sans contrôle de version, avec le journal. */
  db.log.puts.length = 0;
  run(`Store.log('achat', 'Facture test', { type: 'restoreItem', data: { domain: 'purchases', id: 'f', before: { total: 1 } } });`);
  await run(`Store.flush()`);
  eq('6h coffre du journal envoyé sans contrôle', db.log.puts[0].split(',')[0], 'journalAdmin@null');
  eq('6h journal en base sans la copie d\'achat', db.rows.journal.data[0].undo.type, 'vault');
}

twoDevices().catch(e => { ko++; fails.push('✗ 6 deux appareils : ' + (e && e.stack || e)); }).then(() => {
  /* ---------- bilan ---------- */
  fails.forEach(f => console.log(f));
  console.log(`\n${ko ? '✗' : '✓'} ${ok} test(s) réussi(s), ${ko} en échec`);
  process.exit(ko ? 1 : 0);
});
