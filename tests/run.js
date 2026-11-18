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
paniers([sp('a', 'Bois dur', { meat: 'Cerf', days: 200, tags: { resistance: 'tres-forte' } }), sp('b', 'Corne dure', { meat: 'Boeuf', days: 200, tags: { resistance: 'forte' } }), sp('c', 'Sabot dur', { meat: 'Buffle', days: 200, tags: { resistance: 'forte' } })], { client: 'Cliente Deux' }, [gros]);
eq('7e gros destructeur : 3 produits durs pour 15 €', build(15).sort(), ['Bois dur', 'Corne dure', 'Sabot dur']);
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
run(`Paniers.__pm = Paniers._popMult; Paniers.__lm = Paniers._learnMult; Paniers._popMult = () => 1; Paniers._learnMult = () => 1;`);
eq('9b même note qu\'un produit jamais acheté', run(`(() => { const c = Paniers.candidates(); const s = x => Paniers._itemScore(c.find(k => k.name === x), new Set(), {}, 1, Paniers._weights(), 1); return Math.abs(s('Produit C') - s('Produit D')) < 0.001; })()`), true);
run(`Paniers._popMult = Paniers.__pm; Paniers._learnMult = Paniers.__lm;`);
eq('9b budget pour 3 produits : ni A ni B', build(15).filter(n => n === 'Produit A' || n === 'Produit B').length, 0);
/* Même à date DÉPASSÉE, un produit acheté le mois dernier n'est pas reproposé (doublon). */
paniers([sp('a', 'Agneau A', { days: -5, meat: 'Boeuf' }), sp('d', 'Dinde D', { days: 200, meat: 'Dinde' })], { client: 'Cliente Habituée' }, [habituee]); run(`Store.state.sales = __v9;`);
eq('9c date dépassée mais achetée le mois dernier : écartée', build(5), ['Dinde D']);
/* … sauf s'il est ajouté à la main avant de générer (ligne verrouillée = base du panier). */
eq('9c ajouté à la main : il reste dans le panier', run(`Paniers._buildBasket(10, [{ pId: 'a', vId: 'av', lotId: 'al', name: 'Agneau A', meat: 'Boeuf', price: 5, qty: 1, locked: true }]).map(b => b.name).sort()`), ['Agneau A', 'Dinde D']);
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
eq('12d commande site : une seule proposition, JAMAIS sous le montant payé (Antho 2026-11-17)', gen('site').length === 1 && gen('site')[0] >= 9.995, true);
eq('12d commande site : le plus petit dépassement possible sans répéter un produit (4 + 4 + 2,5 = 10,50 €)', gen('site')[0], 10.5);
eq('12e lot à gagner : une seule proposition, jamais au-dessus', gen('lot').every(t => t <= 10.005) && gen('lot').length === 1, true);
/* Lot à gagner : à date égale, le plus fort coefficient d'abord ; une date dépassée passe quand même en premier. */
const lotSt = () => { const a = sp('a', 'Faible coeff', { days: 200, price: 4, meat: 'Boeuf' }), b = sp('b', 'Fort coeff', { days: 200, price: 4, meat: 'Canard' }), c = sp('c', 'Dépassé', { days: -3, price: 4, meat: 'Lapin' }); return [a, b, c]; };
paniers(lotSt(), { budget: 4, kind: 'lot' });
run(`Pricing._calcAllM = Pricing._calcAllM; Paniers.candidates = (orig => function (...a) { const out = orig.apply(this, a); out.forEach(c => { c.coeff = c.name === 'Fort coeff' ? 3 : c.name === 'Faible coeff' ? 1.2 : 2; }); return out; })(Paniers.candidates);`);
eq('12f lot : une date dépassée passe en premier', build(4), ['Dépassé']);
eq('12f lot : puis le plus fort coefficient', build(8).sort(), ['Dépassé', 'Fort coeff']);
run(`Paniers.kind = 'site';`);
eq('12g commande site : la date dépassée passe toujours, puis le plus fort coefficient', build(8).sort(), ['Dépassé', 'Fort coeff']);
run(`Paniers.kind = 'vente';`);
eq('12g vente (mix) : deux produits pour 8 €', build(8).sort().length, 2);

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

/* ══════════ 14. PANIERS : commande site = juste milieu ; compléter le panier (Antho 2026-11-17) ══════════ */
/* Date courte (20 j) à faible coefficient contre date lointaine à très fort coefficient : le lot prend la date courte d'office, la commande site pèse les deux. */
const mid = () => [sp('a', 'Court faible', { days: 20, price: 4, meat: 'Boeuf' }), sp('b', 'Loin fort', { days: 300, price: 4, meat: 'Canard' })];
const coefPatch = `Paniers.candidates = (orig => function (...a) { const out = orig.apply(this, a); out.forEach(c => { c.coeff = c.name === 'Loin fort' ? 4 : 1.1; }); return out; })(Paniers.candidates);`;
paniers(mid(), { kind: 'lot' }); run(coefPatch);
eq('14a lot : la date courte d\'office', build(4), ['Court faible']);
paniers(mid(), { kind: 'site' }); run(coefPatch);
eq('14a commande site : coefficients plus élevés (Antho 2026-11-18) — coeff 4 contre 1,1 passe devant une date à 20 j', build(4), ['Loin fort']);
paniers([sp('a', 'Court faible', { days: 60, price: 4, meat: 'Boeuf' }), sp('b', 'Loin fort', { days: 300, price: 4, meat: 'Canard' })], { kind: 'site' }); run(coefPatch);
eq('14a commande site : à 2 mois, le gros coefficient passe devant (juste milieu)', build(4), ['Loin fort']);
/* Compléter : les produits déjà là restent, on ajoute jusqu'au budget, jamais au-dessus. */
paniers([sp('a', 'A', { days: 200, price: 5, meat: 'Boeuf' }), sp('b', 'B', { days: 200, price: 3, meat: 'Canard' }), sp('c', 'C', { days: 200, price: 1, meat: 'Lapin' })], { budget: 10 });
run(`Paniers.render = function () {}; U.toast = function () {}; Paniers.basket = [{ pId: 'a', vId: 'av', lotId: 'al', name: 'A', meat: 'Boeuf', price: 5, qty: 1, locked: false }]; Paniers.complete();`);
eq('14b compléter : le produit déjà là reste (non verrouillé)', run(`Paniers.basket[0].name + ' ' + Paniers.basket[0].locked`), 'A false');
eq('14b compléter : tout ce qui rentre est ajouté (5 + 3 + 1), jamais au-dessus', run(`Paniers.basket.reduce((a, b) => a + b.price * b.qty, 0)`), 9);

/* ══════════ 15. PASTILLES : tailles « comme le produit » (Antho 2026-11-17) ══════════ */
/* Formats au gramme = même produit : les pastilles propres à une taille sont ignorées (d'office), sauf si Antho décoche. Tailles S/M/L : chacune garde les siennes. */
paniers([{ id: 'g', name: 'Poumon', meatType: 'Agneau', tags: { age: ['11+'] }, variants: [
  { id: 'g1', mode: 'gram', value: 50, priceTTC: 2, costUnit: 1, lots: [], tags: { age: ['0-3'] } },
  { id: 'g2', mode: 'gram', value: 100, priceTTC: 4, costUnit: 1, lots: [] }] },
  { id: 's', name: 'Bâton', meatType: 'Boeuf', tags: {}, variants: [
  { id: 's1', mode: 'size', value: 'S', label: 'S', priceTTC: 2, costUnit: 1, lots: [], tags: { age: ['0-3'] } },
  { id: 's2', mode: 'size', value: 'L', label: 'L', priceTTC: 4, costUnit: 1, lots: [] }] }]);
eq('15a au gramme : comme le produit d\'office', run(`Stock.sameTags(Store.state.stockM[0])`), true);
eq('15a au gramme : l\'âge propre à la taille est ignoré', run(`Stock.variantTags(Store.state.stockM[0], Store.state.stockM[0].variants[0])`), null);
eq('15b tailles S/L : chacune garde ses pastilles', run(`Stock.sameTags(Store.state.stockM[1])`), false);
eq('15b tailles S/L : âge propre gardé', run(`Stock.variantTags(Store.state.stockM[1], Store.state.stockM[1].variants[0]).age`), ['0-3']);
run(`Store.state.stockM[0].tags.sameAll = false;`);
eq('15c décoché par Antho : l\'âge de la taille revient', run(`Stock.variantTags(Store.state.stockM[0], Store.state.stockM[0].variants[0]).age`), ['0-3']);

/* ══════════ 16. PANIERS : grand chien, dents fragiles ; pastilles chiot ↔ sénior (Antho 2026-11-17) ══════════ */
paniers([sp('a', 'Pour tous', { days: 200, price: 4, meat: 'Agneau', tags: { gabarit: ['petit', 'moyen', 'grand'], resistance: 'forte' } }),
         sp('b', 'Pour les grands', { days: 200, price: 4, meat: 'Boeuf', tags: { gabarit: ['moyen', 'grand'], resistance: 'forte' } })], { gabaritInclude: ['grand'] });
eq('16a grand chien : le produit sans « Petit » passe devant', build(4), ['Pour les grands']);
run(`Paniers.gabaritInclude = ['moyen'];`);
run(`Paniers.__pm = Paniers._popMult; Paniers.__lm = Paniers._learnMult; Paniers._popMult = () => 1; Paniers._learnMult = () => 1;`);
eq('16a chien moyen : aucune préférence (pénalité nulle)', run(`Paniers._fitMult(Paniers.candidates().find(c => c.name === 'Pour tous'))`), 1);
run(`Paniers._popMult = Paniers.__pm; Paniers._learnMult = Paniers.__lm;`);
paniers([sp('a', 'Adulte seul', { days: 200, price: 4, meat: 'Agneau', tags: { age: ['11+'], resistance: 'faible' } }),
         sp('b', 'Sénior aussi', { days: 200, price: 4, meat: 'Boeuf', tags: { age: ['11+', 'senior'], resistance: 'faible' } })], { risks: { teeth: true } });
eq('16b dents fragiles : le produit « Sénior » passe devant', build(4), ['Sénior aussi']);
const ageG = `Stock._pastGroups().find(g => g.k === 'age')`;
eq('16c cocher 3-5 mois coche aussi Sénior', run(`Stock._pastToggle(${ageG}, [], '3-5')`), ['3-5', 'senior']);
eq('16c cocher Sénior coche aussi 0-3 et 3-5', run(`Stock._pastToggle(${ageG}, ['11+'], 'senior')`), ['11+', 'senior', '0-3', '3-5']);
eq('16c décocher Sénior ne recoche rien', run(`Stock._pastToggle(${ageG}, ['0-3', '3-5', 'senior'], 'senior')`), ['0-3', '3-5']);

/* ══════════ 17. PASTILLES : produits incomplets (Antho 2026-11-17) ══════════ */
paniers([{ id: 'n', name: 'Nerf', meatType: 'Agneau', tags: { resistance: 'moyenne', age: ['0-3'], gabarit: ['petit'] }, variants: [{ id: 'n1', mode: 'piece', value: 1, priceTTC: 3, costUnit: 1, lots: [] }] },
  { id: 'b', name: 'Bâton', meatType: 'Boeuf', tags: { hypo: 'non', resistance: 'forte', odeur: 'faible', gras: 'non', ramollit: 'non' }, variants: [
    { id: 's', mode: 'size', value: 'S', label: 'S', priceTTC: 3, costUnit: 1, lots: [], tags: { age: ['11+'], gabarit: ['petit'] } },
    { id: 'l', mode: 'size', value: 'L', label: 'L', priceTTC: 5, costUnit: 1, lots: [] }] }]);
eq('17a il manque odeur, gras, se ramollit (hypo = agneau par défaut)', run(`Stock.pastMissing(Store.state.stockM[0])`), ['odeur', 'gras', 'ramollit']);
eq('17b tailles réglées à part : la taille L sans âge est signalée', run(`Stock.pastMissing(Store.state.stockM[1])`), ['age']);
run(`Store.state.stockM[1].variants[1].tags = { age: ['11+'] };`);
eq('17b chaque taille a son âge (gabarit L déduit de la taille) : complet', run(`Stock.pastMissing(Store.state.stockM[1])`), []);
/* Tailles réglées à part : l'âge / le gabarit du PRODUIT ne comptent plus (Antho : « qui est prioritaire ? » → les tailles). */
run(`Store.state.stockM[1].tags.gabarit = ['petit', 'moyen', 'grand']; Store.state.stockM[1].tags.age = ['0-3'];`);
eq('17c gabarit du produit ignoré : la taille L garde le sien (L = moyen + grand)', run(`Paniers._mergeTags(Stock.effTags(Store.state.stockM[1]), Stock.variantTags(Store.state.stockM[1], Store.state.stockM[1].variants[1])).gabarit`), ['moyen', 'grand']);
eq('17c âge du produit ignoré', run(`Stock.effTags(Store.state.stockM[1]).age`), []);

/* ══════════ 18. PASTILLES : double-clic sur la partie grisée = toutes les tailles (Antho 2026-11-17) ══════════ */
paniers([{ id: 'm', name: 'Museau', meatType: 'Boeuf', tags: {}, variants: ['S', 'M', 'L'].map(z => ({ id: 'm' + z, mode: 'size', value: z, label: z, priceTTC: 3, costUnit: 1, lots: [] })) }]);
run(`Stock.render = Stock.renderM = function () {}; U.toast = function () {}; Store.save = function () {};`);
run(`Stock.setPastAllV('m', 'age', '11+');`);
eq('18a 11 mois + écrit sur les 3 tailles', run(`Store.state.stockM[0].variants.map(v => (v.tags.age || []).join())`), ['11+', '11+', '11+']);
run(`Stock.setPastAllV('m', 'age', '11+');`);
eq('18a re-double-clic : retiré partout', run(`Store.state.stockM[0].variants.map(v => !!(v.tags && v.tags.age))`), [false, false, false]);
run(`Stock.setPastAllV('m', 'age', '*');`);
eq('18b « Tous » : tous les âges sur chaque taille', run(`Store.state.stockM[0].variants.every(v => v.tags.age.length === 5)`), true);
eq('18c le gabarit déduit de chaque taille ne bouge pas', run(`Store.state.stockM[0].variants.map(v => Stock.variantTags(Store.state.stockM[0], v).gabarit.join())`), ['petit', 'moyen', 'moyen,grand']);

/* ══════════ 19. HYPOALLERGÉNIQUE par défaut (Antho 2026-11-17) ══════════ */
eq('19a autruche = oui', run(`Stock.hypoDefault('Autruche')`), 'oui');
eq('19a bœuf = non', run(`Stock.hypoDefault('Bœuf')`), 'non');
eq('19a chèvre = à vérifier (non renseigné)', run(`Stock.hypoDefault('Chèvre')`), '');
paniers([sp('a', 'Bœuf non', { days: 200, price: 4, meat: 'Boeuf' }), sp('b', 'Autruche oui', { days: 200, price: 4, meat: 'Autruche' })], { hypoOnly: true });
eq('19b « hypoallergénique uniquement » : le « non » ne passe plus', run(`Paniers.candidates().map(c => c.name)`), ['Autruche oui']);

/* ══════════ 20. PRODUITS JUMEAUX avec / sans poils (Antho 2026-11-17) ══════════ */
paniers([sp('a', 'Museaux de bœuf', { days: 200, price: 4, meat: 'Boeuf', tags: { resistance: 'moyenne', odeur: 'forte' } }),
         sp('b', 'Museaux de bœuf avec poils', { days: 200, price: 4, meat: 'Boeuf', tags: { poil: 'avec' } }),
         sp('c', 'Oreille de lapin', { days: 200, price: 4, meat: 'Lapin' })]);
run(`Stock.render = Stock.renderM = function () {}; U.toast = function () {}; Store.save = function () {};`);
eq('20a la paire est proposée', run(`Stock.twinSuggestions().map(g => g.map(p => p.id).join('+'))`), ['a+b']);
run(`Stock.linkTwin('a', 'b');`);
eq('20b liés dans les deux sens', run(`[Stock.twinIdOf('a'), Stock.twinIdOf('b')]`), ['b', 'a']);
eq('20b à la liaison, le jumeau vide reçoit les pastilles (pas le poil)', run(`[Store.state.stockM[1].tags.resistance, Store.state.stockM[1].tags.poil]`), ['moyenne', 'avec']);
run(`Stock.setPast('b', 'gras', 'peu');`);
eq('20c une pastille réglée sur l\'un suit sur l\'autre', run(`Store.state.stockM[0].tags.gras`), 'peu');
eq('20d jamais les deux dans le même panier', build(12).sort(), ['Museaux de bœuf', 'Oreille de lapin']);

/* ══════════ 21. STATS : avec ou sans poils (Antho 2026-11-17) ══════════ */
paniers([sp('a', 'Museaux', { days: 200, price: 4, meat: 'Boeuf' }), sp('b', 'Museaux avec poils', { days: 200, price: 5, meat: 'Boeuf', tags: { poil: 'avec' } })]);
run(`Stock.render = Stock.renderM = function () {}; U.toast = function () {}; Store.save = function () {}; Stock.linkTwin('a', 'b');`);
eq('21a quantités et CA par version', run(`(r => [r.name, r.sans.qty, r.avec.qty, r.avec.ca, Math.round(r.pctAvec)])(Stats._twinStats([{ items: [{ kind: 'M', pId: 'a', qty: 3, price: 4 }, { kind: 'M', pId: 'b', qty: 1, price: 5 }] }, { items: [{ kind: 'M', name: 'Museaux avec poils', qty: 1, price: 5 }] }])[0])`), ['Museaux', 3, 2, 10, 40]);

/* ══════════ 22. FRIANDISES D'ÉDUCATION : 5 pastilles masquées (Antho 2026-11-17) ══════════ */
paniers([sp('a', 'Saucisse', { days: 200, price: 4, meat: 'Boeuf', tags: { type: 'education', resistance: 'forte', age: ['11+'], gras: 'peu', hypo: 'non' } })], { resistanceInclude: ['faible'], ageInclude: ['0-3'] });
eq('22a jamais « incomplète » pour résistance / odeur / ramollit / âge / gabarit', run(`Stock.pastMissing(Store.state.stockM[0])`), []);
eq('22b la résistance et l\'âge saisis avant sont ignorés : proposée à un chiot', run(`Paniers.candidates().map(c => c.name)`), ['Saucisse']);
eq('22c valeurs gardées en réserve', run(`Store.state.stockM[0].tags.resistance`), 'forte');

/* ══════════ 23. ÂGE DU CHIEN : borne atteinte = tranche suivante (Antho 2026-11-17) ══════════ */
{ const born = m => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - m); return d.toISOString().slice(0, 10); };
  eq('23 4 mois révolus = 3-5 mois', run(`Paniers._dogAges({ birth: '${born(4)}' })`), ['3-5']);
  eq('23 5 mois révolus = 6-10 mois', run(`Paniers._dogAges({ birth: '${born(5)}' })`), ['6-10']);
  eq('23 10 mois révolus = 11 mois +', run(`Paniers._dogAges({ birth: '${born(10)}' })`), ['11+']);
  eq('23 2 mois = 0-3 mois', run(`Paniers._dogAges({ birth: '${born(2)}' })`), ['0-3']); }

/* ══════════ 24. PRODUITS CHAT SEUL : 6 pastilles masquées (Antho 2026-11-17) ══════════ */
paniers([sp('a', 'Bâtonnet', { days: 200, price: 4, meat: 'Bois Naturel', tags: { species: ['chat'] } }), sp('b', 'Mixte', { days: 200, price: 4, meat: 'Bois Naturel', tags: { species: ['chien', 'chat'] } })]);
eq('24a chat seul : rien à compléter sauf l\'hypo (déjà « non » d\'office)', run(`Stock.pastMissing(Store.state.stockM[0])`), []);
eq('24b chien + chat : pastilles toujours demandées', run(`Stock.pastMissing(Store.state.stockM[1]).length`), 6);

/* ══════════ 25. JUMEAUX de structures différentes : l'âge suit taille par taille (Antho 2026-11-17) ══════════ */
paniers([sp('a', 'Oreille de cerf', { days: 200, price: 4, meat: 'Cerf', tags: { age: ['11+'] } }),
  { id: 'b', name: 'Oreille de cerf avec poils', meatType: 'Cerf', tags: { poil: 'avec' }, variants: ['S', 'M'].map(z => ({ id: 'b' + z, mode: 'size', value: z, label: z, priceTTC: 4, costUnit: 1, lots: [], tags: { gabarit: [z === 'S' ? 'petit' : 'moyen'] } })) }]);
run(`Stock.render = Stock.renderM = function () {}; U.toast = function () {}; Store.save = function () {}; Store.state.stockM[0].twinId = 'b'; Store.state.stockM[1].twinId = 'a';`);
run(`Stock.setPast('a', 'age', '6-10');`);
eq('25a l\'âge du produit simple arrive sur chaque taille de l\'autre', run(`Store.state.stockM[1].variants.map(v => v.tags.age.join())`), ['11+,6-10', '11+,6-10']);
eq('25a le gabarit des tailles ne bouge pas', run(`Store.state.stockM[1].variants.map(v => v.tags.gabarit.join())`), ['petit', 'moyen']);
run(`Stock.setPastAllV('b', 'age', 'senior');`);
eq('25b dans l\'autre sens : toutes les tailles réunies sur le produit simple', run(`Store.state.stockM[0].tags.age.slice().sort()`), ['0-3', '11+', '3-5', '6-10', 'senior']);

/* ══════════ 26. PRODUITS LIÉS : pastille séparée (Antho 2026-11-17) ══════════ */
paniers([sp('a', 'Museau de chèvre', { days: 200, price: 4, meat: 'Chevre', tags: { resistance: 'moyenne', gras: 'peu' } }), sp('b', 'Museau de chèvre avec poils', { days: 200, price: 4, meat: 'Chevre', tags: { poil: 'avec', resistance: 'moyenne', gras: 'peu' } })]);
run(`Stock.render = Stock.renderM = function () {}; U.toast = function () {}; Store.save = function () {}; Store.state.stockM[0].twinId = 'b'; Store.state.stockM[1].twinId = 'a';`);
run(`Stock.toggleTwinFree('b', 'resistance'); Stock.setPast('b', 'resistance', 'forte'); Stock.setPast('b', 'gras', 'moyen');`);
eq('26a résistance séparée : l\'autre garde la sienne', run(`Store.state.stockM[0].tags.resistance`), 'moyenne');
eq('26a gras toujours commun', run(`Store.state.stockM[0].tags.gras`), 'moyen');
run(`Stock.toggleTwinFree('a', 'resistance');`);
eq('26b reliée depuis l\'autre : sa valeur est reprise', run(`[Store.state.stockM[1].tags.resistance, Stock.twinFree(Store.state.stockM[1]).length]`), ['moyenne', 0]);

/* ══════════ 27. VARIÉTÉ DU PANIER (Antho 2026-11-17) ══════════ */
eq('27a morceau : 1er mot, singulier, hareng = sprat', run(`[Paniers._cutKey("Oreilles d'agneaux"), Paniers._cutKey("Cou d'oie"), Paniers._cutKey('Sprat'), Paniers._cutKey('Trachée de bœuf')]`), ['oreille', 'cou', 'hareng', 'trachee']);
paniers([sp('a', 'Trachée d\'agneau', { days: 200, price: 2, meat: 'Agneau', tags: { resistance: 'faible' } }),
         sp('b', 'Trachée d\'autruche', { days: 200, price: 2, meat: 'Autruche', tags: { resistance: 'faible' } }),
         sp('c', 'Oreille d\'agneau', { days: 200, price: 2, meat: 'Agneau', tags: { resistance: 'faible' } }),
         sp('d', 'Oreille de bœuf', { days: 200, price: 2, meat: 'Boeuf', tags: { resistance: 'moyenne' } }),
         sp('e', 'Cou d\'oie', { days: 200, price: 2, meat: 'Oie', tags: { resistance: 'faible' } }),
         sp('f', 'Cou de dinde', { days: 200, price: 2, meat: 'Dinde', tags: { resistance: 'faible' } })], { maxPerProduct: 2 });
{ const b = build(8); 
  eq('27b 4 produits différents, jamais deux fois le même', new Set(b).size, 4);
  eq('27b jamais deux trachées ni deux cous de même dureté', [b.filter(n => /Trach/.test(n)).length <= 1, b.filter(n => /^Cou/.test(n)).length <= 1], [true, true]); }
eq('27c oreille d\'agneau (faible) + oreille de bœuf (moyenne) : pas trop proches', run(`Paniers._tooClose(Paniers.candidates().find(c => c.pId === 'd'), [{ pId: 'c', vId: 'cv' }])`), false);

/* ══════════ 28. PANIER : retiré / remplacé jamais remis, remplacer sans doublon (Antho 2026-11-18) ══════════ */
paniers([sp('a', 'Cou d\'oie', { days: 200, price: 2, meat: 'Oie', tags: { resistance: 'faible' } }), sp('b', 'Cou de dinde', { days: 200, price: 3, meat: 'Dinde', tags: { resistance: 'faible' } }),
         sp('c', 'Museau de bœuf', { days: 200, price: 5, meat: 'Boeuf', tags: { resistance: 'moyenne' } }), sp('d', 'Groin de porc', { days: 200, price: 2, meat: 'Porc', tags: { resistance: 'moyenne' } }),
         sp('e', 'Fletan', { days: 200, price: 5, meat: 'Poisson', tags: { resistance: 'faible' } })], { budget: 30 });
run(`Paniers.render = function () {}; U.toast = function () {}; Paniers._dropped = []; Paniers.basket = [
  { pId: 'b', vId: 'bv', lotId: 'bl', name: 'Cou de dinde', meat: 'Dinde', price: 3, qty: 1 }, { pId: 'a', vId: 'av', lotId: 'al', name: "Cou d'oie", meat: 'Oie', price: 2, qty: 1 }];`);
run(`Paniers.swapItem(0);`);
eq('28a remplacer « Cou de dinde » : ni un 2e « Cou d\'oie » ni un autre cou', run(`Paniers.basket.map(b => b.name).filter(n => /^Cou/.test(n)).length`), 1);
eq('28a le remplaçant est d un autre type (pas un cou)', run(`/^Cou/.test(Paniers.basket[0].name)`), false);
run(`Paniers.removeItem(Paniers.basket.findIndex(b => b.pId === 'a')); Paniers.complete();`);
eq('28b retiré puis « Compléter » : pas remis', run(`Paniers.basket.some(b => b.pId === 'a' || b.pId === 'b')`), false);

/* ══════════ 29. REMPLACER = un ou plusieurs produits pour le même budget (Antho 2026-11-18) ══════════ */
paniers([sp('a', 'Museau de bœuf', { days: 200, price: 6, meat: 'Boeuf', tags: { resistance: 'moyenne' } }), sp('b', 'Groin de porc', { days: 200, price: 3, meat: 'Porc', tags: { resistance: 'moyenne' } }),
         sp('c', 'Fletan', { days: 200, price: 3, meat: 'Poisson', tags: { resistance: 'faible' } }), sp('d', 'Queue de bœuf', { days: 200, price: 4, meat: 'Boeuf', tags: { resistance: 'moyenne' } })], { budget: 10 });
run(`Paniers.render = function () {}; U.toast = function () {}; Paniers._dropped = []; Paniers.basket = [
  { pId: 'a', vId: 'av', lotId: 'al', name: 'Museau de bœuf', meat: 'Boeuf', price: 6, qty: 1 }, { pId: 'd', vId: 'dv', lotId: 'dl', name: 'Queue de bœuf', meat: 'Boeuf', price: 4, qty: 1 }];`);
run(`Paniers.swapItem(0);`);
eq('29a museau (6 €) remplacé par deux produits à 3 €', run(`Paniers.basket.map(b => b.name).slice(0, 2).sort()`), ['Fletan', 'Groin de porc']);
eq('29a la queue de bœuf reste en dernier, le museau est parti', run(`[Paniers.basket[Paniers.basket.length - 1].name, Paniers.basket.some(b => b.pId === 'a')]`), ['Queue de bœuf', false]);
eq('29a total inchangé', run(`Paniers.basket.reduce((a, b) => a + b.price * b.qty, 0)`), 10);

/* ══════════ 30. CHIOT : taille actuelle estimée (Antho 2026-11-18) ══════════ */
{ const born = m => new Date(Date.now() - m * 30.44 * 86400000).toISOString().slice(0, 10);
  run(`Store.state.settings.breeds = [{ id: 'bc', name: 'Border collie', wMin: 14, wMax: 20 }, { id: 'lab', name: 'Labrador retriever', wMin: 25, wMax: 36 }, { id: 'chi', name: 'Chihuahua', wMin: 1, wMax: 3 }];`);
  eq('30a croisé moyen de 5,5 mois ≈ 11 kg → moyen', run(`(g => [g.cur, g.adult, g.kg])(Paniers._growGab({ birth: '${born(5.5)}', breeds: ['bc', 'lab'] }))`), ['moyen', 'moyen', 11]);
  eq('30a même chiot à 3 mois ≈ 6 kg → petit', run(`Paniers._growGab({ birth: '${born(3)}', breeds: ['bc', 'lab'] }).cur`), 'petit');
  eq('30a un an ou plus : taille adulte (rien à estimer)', run(`Paniers._growGab({ birth: '${born(13)}', breeds: ['bc', 'lab'] })`), null);
  eq('30b églefin (moyen, grand) trop gros pour un chiot qui grandit', run(`Paniers._tooBigForGrowing({ cur: 'moyen' }, { gabarit: ['moyen', 'grand'] })`), true);
  eq('30b merlan (petit, moyen) : ok', run(`Paniers._tooBigForGrowing({ cur: 'moyen' }, { gabarit: ['petit', 'moyen'] })`), false);
  paniers([sp('a', 'Eglefin', { days: 200, price: 5, meat: 'Poisson', tags: { gabarit: ['moyen', 'grand'], resistance: 'faible' } }),
           sp('b', 'Merlan', { days: 200, price: 4, meat: 'Poisson', tags: { gabarit: ['petit', 'moyen'], resistance: 'faible' } })], { client: 'Cliente Chiot' },
    [{ id: 'k1', name: 'Cliente Chiot', dogs: [{ id: 'dk', name: 'Brida', birth: born(5.5), breeds: ['bc', 'lab'] }] }]);
  run(`Store.state.settings.breeds = [{ id: 'bc', name: 'Border collie', wMin: 14, wMax: 20 }, { id: 'lab', name: 'Labrador retriever', wMin: 25, wMax: 36 }];`);
  eq('30c panier pour le chiot : le merlan oui, l\'églefin non', run(`Paniers.candidates().map(c => c.name)`), ['Merlan']); }

/* ══════════ 31. RETIRER UN PRODUIT = AUSSI SA VERSION AVEC / SANS POILS (Antho 2026-11-18) ══════════ */
paniers([sp('a', 'Patte de chevreuil', { days: 200, price: 4, meat: 'Chevreuil' }), sp('b', 'Patte de chevreuil avec poils', { days: 200, price: 4, meat: 'Chevreuil', tags: { poil: 'avec' } }),
         sp('c', 'Oreille de lapin', { days: 200, price: 3, meat: 'Lapin' }), sp('d', 'Museau de bœuf', { days: 200, price: 5, meat: 'Boeuf' })], { budget: 12 });
run(`Paniers.render = function () {}; U.toast = function () {}; Store.save = function () {}; Store.state.stockM[0].twinId = 'b'; Store.state.stockM[1].twinId = 'a'; Paniers._dropped = [];
  Paniers.basket = [{ pId: 'a', vId: 'av', lotId: 'al', name: 'Patte de chevreuil', meat: 'Chevreuil', price: 4, qty: 1 }]; Paniers.removeItem(0); Paniers.complete();`);
eq('31 patte retirée puis « Compléter » : ni elle ni sa version avec poils', run(`Paniers.basket.some(b => b.pId === 'a' || b.pId === 'b')`), false);

/* ══════════ 32. COMMANDE SITE : « Compléter » au plus juste (Antho 2026-11-18) ══════════ */
paniers([sp('a', 'Groin de porc', { days: 200, price: 2, meat: 'Porc' }), sp('b', 'Fromage a croquer', { days: 200, price: 11, meat: 'Fromages' }), sp('c', 'Museau de bœuf', { days: 200, price: 4.5, meat: 'Boeuf' })], { kind: 'site', budget: 40, maxPerProduct: 2 });
run(`Paniers.render = function () {}; U.toast = function () {}; Paniers._dropped = []; Paniers.basket = [
  { pId: 'a', vId: 'av', lotId: 'al', name: 'Groin de porc', meat: 'Porc', price: 2, qty: 1 }, { pId: 'c', vId: 'cv', lotId: 'cl', name: 'Museau de bœuf', meat: 'Boeuf', price: 4.5, qty: 1 },
  { pId: 'x', vId: 'xv', lotId: 'xl', name: 'Autre', meat: 'Agneau', price: 31.8, qty: 1, locked: true }]; Paniers.complete();`);
eq('32 il manque 1,70 € : un 2e groin (+0,30 €) plutôt que le fromage à 11 €', run(`Math.round(Paniers.basket.reduce((a, b) => a + b.price * b.qty, 0) * 100) / 100`), 40.3);

/* ══════════ 33. LOT DE 2 plutôt que 2 exemplaires ; synchro fiche stable (Antho 2026-11-18) ══════════ */
paniers([{ id: 'r', name: 'Rouleau de porc', meatType: 'Porc', tags: {}, variants: [
  { id: 'r25', mode: 'size', value: '25CM', label: '25CM', priceTTC: 4, costUnit: 1.76, lots: [{ id: 'r25l', lotNumber: 'L', dluo: '', qtyGeneral: 5, qtyEvent: 0 }] },
  { id: 'r25x2', mode: 'piece', value: 2, label: '25CM LOT 2', parentId: 'r25', packQty: 2, priceTTC: 7.5, costUnit: 3.43, lots: [{ id: 'r25x2l', lotNumber: 'L', dluo: '', qtyGeneral: 3, qtyEvent: 0 }] }] }], { maxPerProduct: 2 });
eq('33a 2 × 25CM → 1 × 25CM LOT 2', run(`(() => { const c = Paniers.candidates(); const b = [{ pId: 'r', vId: 'r25', lotId: 'r25l', name: 'Rouleau de porc', price: 4, qty: 2, family: c.find(x => x.vId === 'r25').family }]; const d = Paniers._packUp(b, c); return [b[0].vId, b[0].qty, d]; })()`), ['r25x2', 1, -0.5]);
/* Deux produits du stock reliés à la même fiche : la synchro ne doit pas changer la fiche à chaque passage. */
paniers([{ id: 'p1', name: 'Museau', meatType: 'Boeuf', catalogId: 'cat', tags: {}, variants: [{ id: 'v1', mode: 'piece', value: 1, sku: 'MUS-1', lots: [] }] },
         { id: 'p2', name: 'Museau poils', meatType: 'Boeuf', catalogId: 'cat', tags: {}, variants: [{ id: 'v2', mode: 'piece', value: 1, sku: 'MUS-2', lots: [] }] }]);
run(`Store.save = function () {}; Store.state.catalogM = [{ id: 'cat', name: 'Museau', meatType: 'Boeuf', coefficient: 2, suppliers: [], variants: [{ id: 'cv', mode: 'piece', value: 1, sku: 'X' }] }];`);
run(`Stock.syncPricesFromCatalog('cat');`);
eq('33b 2e passage : la fiche ne change plus', run(`Stock.syncPricesFromCatalog('cat')`), false);

/* ══════════ 34. QUANTITÉ BAISSÉE À LA MAIN = PLAFOND (Antho 2026-11-18) ══════════ */
paniers([sp('m', 'Merlan', { days: 200, price: 4, meat: 'Poisson' }), sp('g', 'Groin de porc', { days: 200, price: 2, meat: 'Porc' })], { kind: 'site', budget: 10, maxPerProduct: 2 });
run(`Paniers.render = function () {}; U.toast = function () {}; Paniers._dropped = []; Paniers._qtyCap = {}; Paniers.basket = [{ pId: 'm', vId: 'mv', lotId: 'ml', name: 'Merlan', meat: 'Poisson', price: 4, qty: 2 }]; Paniers.changeQty(0, -1); Paniers.complete();`);
eq('34 merlan baissé à 1 : « Compléter » ne le remet pas à 2', run(`Paniers.basket.filter(b => b.pId === 'm').reduce((a, b) => a + b.qty, 0)`), 1);

/* ══════════ 35. ÉCARTÉS GARDÉS AVEC LE BROUILLON / LE PANIER EN ATTENTE (Antho 2026-11-19) ══════════ */
paniers([sp('m', 'Merlan', { days: 200, price: 4, meat: 'Poisson' }), sp('g', 'Groin de porc', { days: 200, price: 2, meat: 'Porc' })]);
run(`Paniers._dropped = ['g']; Paniers._qtyCap = { m: 1 };`);
eq('35a panier en attente : écartés et plafonds rangés avec', run(`(d => [d.dropped, d.qtyCap.m])(Paniers._pendingData({}, 'Cliente', 1))`), [['g'], 1]);
run(`Paniers._dropped = []; Paniers._qtyCap = {}; Paniers._loadRec({ items: [], dropped: ['g'], qtyCap: { m: 1 }, name: 'Cliente' });`);
eq('35b « Reprendre » : retrouvés', run(`[Paniers._dropped, Paniers._qtyCap.m]`), [['g'], 1]);

/* ══════════ 36. OBJECTIF ÉCOULER + RAISONS DES DATES COURTES (Antho 2026-11-19) ══════════ */
paniers([sp('a', 'Court faible', { days: 20, price: 4, meat: 'Boeuf' }), sp('b', 'Loin fort', { days: 300, price: 4, meat: 'Canard' }), sp('c', 'Chat seul', { days: 10, price: 3, meat: 'Lapin', tags: { species: ['chat'] } })], { kind: 'site', priority: 'dluo' });
run(`Paniers.candidates = (orig => function (d) { const out = orig.call(this, d); out.forEach(c => { c.coeff = c.name === 'Loin fort' ? 4 : 1.1; }); return out; })(Paniers.candidates);`);
eq('36a commande site + « Écouler » : la date à 20 j passe devant le gros coefficient', build(4), ['Court faible']);
eq('36b raison donnée pour une date courte non retenue', run(`(r => r && r.reason)(Paniers._shortDates().find(r => r.p.id === 'c'))`), 'pour chat');

/* ══════════ 37. LE GÉNÉRATEUR APPREND D'ANTHO (étape 2, 2026-11-19) ══════════ */
paniers([sp('a', 'Oreille de lapin', { days: 200, price: 4, meat: 'Lapin' }), sp('b', 'Museau de bœuf', { days: 200, price: 4, meat: 'Boeuf' })]);
run(`Store.isAdmin = () => true; Store.save = function () {}; Paniers.render = function () {}; U.toast = function () {}; Store.state.panLearn = { p: {} }; Store.state.sales = [];`);
{ const pick1 = () => build(4)[0];
const first = pick1(), other = first === 'Oreille de lapin' ? 'b' : 'a', firstId = first === 'Oreille de lapin' ? 'a' : 'b';
run(`for (let i = 0; i < 3; i++) Paniers._learn('${firstId}', 'r');`);
eq('37a retiré 3 fois : il passe derrière', pick1() !== first, true);
run(`Paniers.forgetLearn('${firstId}');`);
eq('37b « Oublier » : retour à zéro', pick1(), first);
run(`for (let i = 0; i < 4; i++) Paniers._learn('${other}', 'a');`);
eq('37c ajouté à la main 4 fois : il passe devant', pick1() !== first, true);
eq('37d profil enregistré à part', run(`Object.keys(Store.state.panLearn.p['${other}']).sort()`), ['*', 'tout âge · toute taille']); }

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
