# Touffu Gestion — Stock & Prix

Application unifiée pour Touffu Shop : **tarification** (mastication + accessoires), **gestion de stock** (deux emplacements, lots, DLUO), **ventes marché**, **achats fournisseurs**, **revente pro** et **synthèses**. Tout en HTML/CSS/JS, aux couleurs de la marque.

---

## 1. Démarrer tout de suite (mode local, sans rien installer)

1. Dézippe le dossier.
2. Ouvre `index.html` dans ton navigateur (double-clic).
3. C'est prêt. Les données sont enregistrées **dans ce navigateur** (aucun compte requis).
4. Va dans **Paramètres → Import** et dépose n'importe quel fichier de données, puis clique **Importer le fichier (détection automatique)**. L'app reconnaît toute seule le format :
   - ton ancien **calculateur de prix** (`Prix_final.json`) → produits, sachets, coefficients ;
   - ton ancienne **appli de stock**, quelle que soit sa version (récente avec variantes/lots, ou plus ancienne à plat) → produits, lots, DLUO, quantités général/événement, SKU et prix de vente ;
   - une **sauvegarde** de cette application → restauration complète.

> Les imports sont complémentaires : le calculateur apporte tes coûts d'achat et coefficients, le stock apporte tes quantités réelles et tes SKU. Un produit du stock peut ensuite être **lié** à un produit du calculateur (Stock → Modifier → « Lier au catalogue ») pour récupérer coût de revient et marges — pas obligatoire pour démarrer. Importe **une seule fois** chaque fichier (une sécurité te prévient en cas de risque de doublon).

> En mode local, les données restent sur **cet appareil / ce navigateur**. Pour retrouver les mêmes données sur ton téléphone, ta tablette et ton PC en même temps, passe au mode nuage ci-dessous.

---

## 2. Mode nuage (synchro PC + téléphone + tablette) — recommandé pour les marchés

Gratuit avec Supabase (offre gratuite très largement suffisante ici — on ne stocke que du texte, **pas de photos**).

**Étape 1 — Créer le projet**
- Va sur https://supabase.com → *Start your project* → crée un compte → *New project*.
- Note le mot de passe de la base (tu peux le ranger de côté, on n'en a pas besoin dans l'app).

**Étape 2 — Créer les tables**
- Menu de gauche → **SQL Editor** → *New query*.
- Copie tout le contenu de `supabase_schema.sql`, colle-le, clique **Run**.

**Étape 3 — Récupérer tes clés**
- Menu → **Project Settings** (roue crantée) → **API**.
- Copie **Project URL** et la clé **anon public**.

**Étape 4 — Créer ton identifiant**
- Menu → **Authentication** → **Users** → *Add user* → *Create new user*.
- Mets ton email + un mot de passe. (Désactive la confirmation email dans Authentication → Providers → Email si besoin, pour te connecter tout de suite.)

**Étape 5 — Brancher l'application**
- Ouvre le fichier `js/config.js` avec un éditeur de texte.
- Colle tes deux valeurs entre les guillemets :

```js
window.TOUFFU_CONFIG = {
  SUPABASE_URL: "https://tonprojet.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGci...ta_cle_anon..."
};
```

- Enregistre, rouvre `index.html` : un écran de connexion apparaît. Connecte-toi avec l'identifiant de l'étape 4.

À partir de là, tous tes appareils qui ouvrent l'app avec le même `config.js` et le même identifiant partagent **les mêmes données en temps réel**.

---

## 3. Mettre l'app en ligne (pour l'ouvrir depuis n'importe où)

Le plus simple : **Netlify**.
1. Va sur https://app.netlify.com → *Add new site* → *Deploy manually*.
2. Glisse le dossier entier `touffu-gestion` dans la zone de dépôt.
3. Tu obtiens une adresse `https://ton-nom.netlify.app` à ouvrir sur mobile/tablette.

> Pense à ajouter cette page à l'écran d'accueil de ton téléphone (menu du navigateur → « Ajouter à l'écran d'accueil ») : elle s'ouvre alors comme une vraie application.

---

## 4. Comment l'app est organisée

- **Tableau de bord** — valeur du stock, alertes DLUO, stock bas, CA et frais CB sur 30 jours.
- **Ventes marché** — grille tactile → panier → **CB (SumUp)** ou **Espèces**. Le stock **événement** (ou général) se décrémente, en sortant d'abord les lots à la DLUO la plus proche. Chaque vente est annulable.
- **Stock** — Mastication (vrac → conditionnements, lots, DLUO, transferts général ⇄ événement, **conditionnement**) et Consommables (cartons, encre, étiquettes…).
- **Achats** — commandes fournisseurs : une saisie alimente le **coût de revient réel** (frais de port répartis), l'**historique de prix** et l'entrée en stock via *Réceptionner*. Bouton *Recommander* pour dupliquer une commande.
- **Prix mastication** — ton calculateur : variantes (poids / lots / tailles), coefficient, marge et **profit net**.
- **Accessoires** — matières (rouleaux de sangle au mètre, bouclerie à la pièce), fiches de fabrication (nomenclature + **temps de main d'œuvre**), coût de revient, **Fabriquer** (déduit les matières, ajoute au stock).
- **Revente pro (B2B)** — remise professionnelle en %, avec option **retrait de TVA** (affichage HT), marge pro affichée et **export CSV** du tarif.
- **Site (WooCommerce)** — relie l'app à ton site par le **SKU** et exporte un CSV prix + stock (voir section 7).
- **Synthèses** — par type de viande, par catégorie d'accessoire, et CA par mois avec frais CB déduits.
- **Paramètres** — TVA, cotisations, commission CB, main d'œuvre ; fournisseurs / viandes / catégories / sachets ; import/export ; **instantanés restaurables** et **journal des mouvements** (avec annulation).

---

## 5. Points importants sur tes réglages

- **TVA anticipée** : tant que la case *« Je suis assujetti à la TVA »* (Paramètres) est **décochée**, la TVA incluse dans tes prix est comptée comme **bénéfice**. Le jour de l'assujettissement, coche-la : **tes prix TTC ne changent pas**, mais la TVA cesse d'être comptée dans ton profit.
- **Commission CB** : déduite uniquement sur les ventes réellement encaissées en **CB**, dans les synthèses (taux réglable, 1,75 % par défaut).
- **Sauvegardes** : un **instantané** est pris automatiquement chaque jour ; tu peux revenir à l'état d'un jour précédent (Paramètres → Instantanés). Pense aussi à *Exporter la sauvegarde* de temps en temps.

---

## 7. Lien avec ton site WooCommerce

Le **SKU** (référence unique d'un produit sur ton site) est la clé commune entre l'app et WooCommerce. L'app calcule le **prix de vente** et suit le **stock** ; tu les envoies vers le site. Ton **coût d'achat et tes marges restent dans l'app** — WooCommerce n'en a pas besoin.

**Étape 1 — Renseigner les SKU**
- Sur ton site, chaque produit (et chaque variation : taille, poids…) a un SKU visible dans Produits → modifier → onglet Inventaire, ou colonne UGS/SKU.
- Dans l'app, reporte le même SKU : *Prix mastication → Modifier → colonne SKU* de chaque variante, et *Accessoires → Modifier → champ SKU*.
- L'onglet **Site (Woo)** liste les produits encore **sans SKU** : complète-les jusqu'à ce que la liste soit vide.

**Étape 2 — Exporter**
- Onglet **Site (Woo)** → choisis le stock à envoyer (général seul, ou général + événement) et ce que tu envoies (prix, stock).
- Clique **Exporter le CSV pour WooCommerce**.

**Étape 3 — Importer sur le site**
- WooCommerce → **Produits → Importer** → choisis le fichier CSV.
- Coche impérativement **« Mettre à jour les produits existants »** (sinon des doublons sont créés).
- Vérifie l'écran de correspondance des colonnes (SKU, Regular price, Stock), puis lance l'import. WooCommerce retrouve chaque produit par son SKU et ne modifie que les colonnes envoyées.

> Fais un premier essai sur 2-3 produits avant de tout envoyer. Garde à l'esprit : ici l'app est la **source** des prix et du stock qu'elle envoie vers le site. Pour les **ventes en ligne** (qui décrémentent le stock côté site), tu ajustes pour l'instant dans l'app, ou tu attends la synchro automatique ci-dessous.

**Synchronisation automatique (optionnel, plus tard)**
WooCommerce a une API REST. On ne peut pas l'appeler directement depuis l'app (les clés seraient exposées dans le navigateur, et les appels seraient bloqués). Le moyen propre est un petit relais côté serveur ; comme tu utilises déjà **Supabase**, ce relais peut être une **Supabase Edge Function** qui reçoit les données de l'app et les pousse vers WooCommerce (`GET /wp-json/wc/v3/products?sku=…` puis `PUT /wp-json/wc/v3/products/<id>` avec `regular_price` et `stock_quantity`). Les clés WooCommerce (consumer key/secret, créées dans WooCommerce → Réglages → Avancé → API REST) restent stockées côté serveur. À mettre en place quand tu voudras : en attendant, l'export CSV fait le travail.

---

## 8. Prévu pour plus tard (déjà anticipé dans la structure)

- **Codes-barres / scan** : chaque accessoire et variante peut recevoir une référence (`SKU`) ; la génération d'étiquettes A4 avec codes-barres et le scan en vente pourront être ajoutés sans refonte.
- **Import des ventes SumUp** : le module Ventes est prêt à recevoir un import de relevé (rapprochement des ventes CB) quand tu voudras t'y attaquer.

Bon courage Antho — et fais un câlin à Sayana. 🐺
