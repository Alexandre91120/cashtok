# Tutoriel complet — Mettre CashTok en ligne

Ce projet est un starter complet : landing page + paiement Stripe (carte + Apple Pay) + reçu automatique par email + espace admin sécurisé (connexion + double authentification, codes promo, personnalisation couleur/police). Tout le contenu produit est en `…` — à toi de le remplacer avant publication.

Police du site : **Poppins**, avec les mêmes tailles de titres/boutons/texte sur toutes les pages (accueil, succès, annulation, mentions légales, CGV, confidentialité). La même mise en page (nav + bandeau + footer) est appliquée partout pour une identité visuelle cohérente sur tout le site.

## Contenu du projet

```
cashtok/
├── public/
│   ├── index.html          → page de vente
│   ├── success.html        → page après paiement réussi
│   ├── cancel.html         → page si paiement annulé
│   ├── mentions-legales.html
│   ├── cgv.html
│   ├── confidentialite.html
│   └── style.css
├── server.js                → backend (Stripe + email)
├── package.json
└── .env.example              → variables à copier dans .env
```

---

## Étape 1 — Installer les outils

1. Installe [Node.js](https://nodejs.org) (version 18+).
2. Installe les dépendances du projet :

```bash
npm install
```

---

## Étape 2 — Configurer Stripe

1. Connecte-toi à ton [Dashboard Stripe](https://dashboard.stripe.com).
2. Récupère tes clés API dans **Développeurs > Clés API** :
   - `Clé secrète` (commence par `sk_test_...` en mode test, `sk_live_...` en mode réel)
3. Active le **reçu automatique natif Stripe** (le plus simple, aucune configuration email requise) :
   - Dashboard > **Paramètres** > **Emails clients** > active "Envoyer les reçus par email pour les paiements réussis".
   - Avec ça seul, Stripe envoie déjà un reçu automatique à chaque client après achat.
4. (Optionnel, en plus) Pour un email de reçu **personnalisé à ta marque**, ce projet envoie aussi son propre email via le webhook — voir Étape 4.
5. Apple Pay et Google Pay apparaissent **automatiquement** dans Stripe Checkout, sans configuration supplémentaire, dès que le visiteur utilise un appareil/navigateur compatible (Safari/iPhone pour Apple Pay).

---

## Étape 3 — Remplir le fichier `.env`

Copie `.env.example` en `.env` :

```bash
cp .env.example .env
```

Remplis les valeurs :

```
STRIPE_SECRET_KEY=sk_test_...        → ta clé secrète Stripe
STRIPE_WEBHOOK_SECRET=whsec_...      → voir étape 4
DOMAIN=http://localhost:3000         → à remplacer par ton vrai domaine une fois en ligne
PRODUCT_NAME=...                     → nom de ton produit
PRODUCT_DESCRIPTION=...
PRODUCT_PRICE_CENTS=2900             → prix en centimes (2900 = 29,00 €)
CURRENCY=eur
SMTP_HOST=...                        → si tu veux le reçu email personnalisé (étape 4)
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
FROM_EMAIL=contact@tondomaine.com
```

⚠️ Ne jamais publier ce fichier `.env` publiquement (il est déjà exclu par `.gitignore`).

---

## Étape 4 — (Optionnel) Reçu email personnalisé + webhook

Le reçu natif Stripe (étape 2) suffit pour la plupart des cas. Si tu veux en plus un email à ta charte graphique, il faut connecter un webhook :

1. En local, teste avec le [Stripe CLI](https://stripe.com/docs/stripe-cli) :
   ```bash
   stripe listen --forward-to localhost:3000/webhook
   ```
   Il t'affiche un `whsec_...` à mettre dans `.env`.

2. En production, dans le Dashboard Stripe > **Développeurs > Webhooks > Ajouter un endpoint** :
   - URL : `https://tondomaine.com/webhook`
   - Événement à écouter : `checkout.session.completed`
   - Copie le "Signing secret" fourni → `STRIPE_WEBHOOK_SECRET`

3. Pour l'envoi SMTP, utilise par exemple :
   - Un compte Gmail avec un [mot de passe d'application](https://myaccount.google.com/apppasswords)
   - Ou un service dédié (Brevo, Mailgun, Resend, SendGrid...) — plus fiable pour du volume et évite le spam.

---

## Étape 5 — Tester en local

```bash
npm start
```

Ouvre `http://localhost:3000`. Clique sur "Payer maintenant" — Stripe Checkout s'ouvre. Utilise une [carte de test Stripe](https://stripe.com/docs/testing) :

```
Numéro : 4242 4242 4242 4242
Date : n'importe quelle date future
CVC : n'importe quel 3 chiffres
```

---

## Étape 6 — Remplacer les `…` par ton vrai contenu

Avant de publier, édite dans `public/index.html` :
- Le titre, sous-titre, badge du hero
- Les 3 avantages produit
- Le nom, la description, le prix et les points inclus de la carte tarif (assure-toi que `PRODUCT_PRICE_CENTS` dans `.env` correspond au prix affiché)
- Les avis clients (n'invente pas de faux avis attribués à de vraies personnes)
- La FAQ
- Le footer (email de contact, copyright)

Complète aussi `mentions-legales.html` et `cgv.html` avec tes vraies informations (nom/statut, SIRET, adresse, hébergeur). **C'est une obligation légale en France pour tout site marchand.**

---

## Étape 7 — Déployer en ligne

Option recommandée : **Render.com** (gratuit pour démarrer, simple pour une app Node.js).

1. Crée un dépôt Git (GitHub) avec ce projet (le `.env` ne sera pas inclus grâce au `.gitignore`).
2. Va sur [render.com](https://render.com) > **New > Web Service** > connecte ton dépôt GitHub.
3. Configure :
   - Build command : `npm install`
   - Start command : `npm start`
4. Dans **Environment**, ajoute toutes les variables de ton `.env` (clé Stripe, prix, SMTP...).
5. Render te donne une URL du type `https://cashtok.onrender.com`. Vérifie que tout fonctionne dessus.

*(Alternative : Railway.app, fonctionnement très similaire.)*

---

## Étape 8 — Acheter et brancher ton nom de domaine

1. Achète un domaine (ex: `cashtok.com`, `.io`, `.fr`) chez un registrar : [Namecheap](https://namecheap.com), [OVH](https://ovh.com), ou [Google Domains / Squarespace](https://domains.google).
2. Dans Render : **Settings > Custom Domain** > ajoute ton domaine.
3. Render te donne un enregistrement DNS à créer (CNAME ou A) → va le configurer chez ton registrar dans la zone DNS.
4. Attends la propagation DNS (quelques minutes à quelques heures). Render fournit le certificat HTTPS automatiquement.
5. Mets à jour la variable `DOMAIN` (dans Render > Environment) avec ta vraie URL `https://tondomaine.com`, puis redéploie.
6. Mets aussi à jour l'URL du webhook Stripe (étape 4) avec ce nouveau domaine.

---

## Étape 9 — Passer en paiement réel

1. Assure-toi que ton compte Stripe est **activé** pour les paiements live (vérification d'identité complétée dans le Dashboard).
2. Remplace dans `.env` (sur Render) :
   - `STRIPE_SECRET_KEY` par ta clé **live** (`sk_live_...`)
   - Recrée le webhook en mode live et remets à jour `STRIPE_WEBHOOK_SECRET`
3. Fais un vrai petit achat test à toi-même pour valider le parcours complet (paiement + reçu email).

---

## Étape 10 — Configurer la connexion admin (obligatoire)

Le site a un espace admin protégé par identifiants + code à 6 chiffres envoyé par email (double authentification). Sans cette config, personne — pas même toi — ne peut se connecter.

Dans `.env` :

```
ADMIN_USERNAME=archer.off
ADMIN_PASSWORD_HASH=...          → généré à l'étape suivante, jamais en clair
ADMIN_EMAIL=yamosama2@gmail.com   → reçoit le code à 6 chiffres à chaque connexion
SESSION_SECRET=...                → généré à l'étape suivante
```

1. **Génère le hash de ton mot de passe** (ne mets jamais le mot de passe en clair dans `.env`) :
   ```bash
   npm run hash-password -- "archer91120"
   ```
   Copie la ligne `ADMIN_PASSWORD_HASH=...` affichée dans ton `.env`. Si tu changes de mot de passe plus tard, relance cette commande avec le nouveau.

2. **Génère un `SESSION_SECRET`** (sert à sécuriser les connexions) :
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copie le résultat dans `SESSION_SECRET`. Ne le partage jamais, ne le commit jamais sur Git.

3. Assure-toi que `SMTP_HOST/PORT/USER/PASS/FROM_EMAIL` (étape 4) sont bien configurés — c'est ce qui permet d'envoyer le code de connexion à `ADMIN_EMAIL`.

4. **Mets `NODE_ENV=production`** une fois en ligne (sur Render/Replit, dans les variables d'environnement) — ça active les cookies sécurisés (HTTPS uniquement).

**Comment se connecter :** va sur `https://tondomaine.com/admin-login.html`, entre `archer.off` / ton mot de passe, reçois un code à 6 chiffres à `y*******2@gmail.com` (email masqué à l'affichage), entre le code → tu es redirigé vers `/admin.html`, ton tableau de bord.

- Le bouton "✏️ Éditer les textes" n'apparaît sur le site **que si tu es connecté**.
- Le code expire après 10 minutes. Tu peux en redemander un après 60 secondes d'attente (`Renvoyer le code`), il sera différent à chaque fois.
- Après 5 mauvais mots de passe, l'IP est bloquée 15 minutes. Après 5 mauvais codes, il faut se reconnecter.

---

## Étape 11 — Codes promo (-20%, 24h)

Depuis `/admin.html`, section **Code promo** :

1. Tape un nom de code (ex: `PROMO20`) → **Créer un nouveau code**. Il est créé **inactif** par défaut.
2. Clique **Activer** quand tu veux qu'il commence à fonctionner.
3. Pendant 24h à partir de sa création, toute personne qui a ce code peut l'entrer sur la page de paiement Stripe pour obtenir -20%. Le code n'est jamais affiché publiquement sur le site — tu le communiques toi-même (réseaux sociaux, message, etc.).
4. Passé 24h, le code arrête de fonctionner **automatiquement**, même si tu ne l'as jamais désactivé (c'est Stripe lui-même qui l'expire, pas juste notre site — plus fiable).
5. Un seul code peut être actif à la fois : en créer un nouveau désactive automatiquement l'ancien.
6. Le site affiche un petit bandeau "🎁 Un code promo est actif aujourd'hui" en haut de la page quand un code est actif, sans jamais révéler le code lui-même.

⚠️ Les codes promo créés en mode `sk_test_...` n'existent que côté Stripe test. Une fois passé en clé `sk_live_...` (étape 9), tu dois recréer un nouveau code — c'est normal, les deux environnements Stripe sont séparés.

---

## Étape 12 — Personnaliser l'apparence (couleur + police)

Toujours depuis `/admin.html`, section **Apparence du site** : choisis une couleur (dégradé recalculé automatiquement à partir d'elle) et une police parmi 5 styles proposés, clique **Appliquer** → changement visible immédiatement sur tout le site, sans redéploiement.

*(La mise en page / structure des sections, elle, reste dans le code — dis-moi si tu veux que je t'ajoute d'autres réglages visuels par la suite.)*

---

## Sécurité — ce qui est déjà en place

- Mot de passe admin **jamais stocké en clair** (hash bcrypt)
- Double authentification obligatoire (mot de passe + code à usage unique par email)
- Sessions signées, cookies `httpOnly` + `secure` (HTTPS) + `sameSite`
- Limitation des tentatives de connexion (anti brute-force) avec blocage temporaire
- En-têtes de sécurité HTTP (via Helmet)
- Toutes les routes de modification (textes, thème, codes promo) exigent une session admin valide côté serveur — impossible à contourner depuis le navigateur

**Ce que TU dois faire pour rester protégé :**
- Ne partage `ADMIN_USERNAME` / mot de passe / accès à `ADMIN_EMAIL` avec personne
- Ne commit jamais le fichier `.env` sur Git (déjà exclu par `.gitignore`)
- Change le mot de passe régulièrement (`npm run hash-password -- "nouveauMotDePasse"`)
- Vérifie que ton hébergeur sert bien le site en HTTPS avant de mettre `NODE_ENV=production`
- Si tu soupçonnes un accès non autorisé, change immédiatement `SESSION_SECRET` (ça déconnecte toutes les sessions actives) et ton mot de passe

---

## Checklist avant lancement

- [ ] Tous les `…` remplacés par du vrai contenu
- [ ] Prix affiché sur la page = `PRODUCT_PRICE_CENTS` dans `.env`
- [ ] Mentions légales et CGV complétées
- [ ] Clé Stripe live configurée
- [ ] Webhook live configuré et testé
- [ ] Nom de domaine branché en HTTPS
- [ ] Reçu email natif Stripe activé (et/ou email personnalisé testé)
- [ ] Achat test réel effectué avec succès
- [ ] `ADMIN_PASSWORD_HASH` et `SESSION_SECRET` générés et en place dans `.env`
- [ ] Connexion admin testée (identifiants + code reçu par email)
- [ ] `NODE_ENV=production` activé une fois en ligne (HTTPS)
