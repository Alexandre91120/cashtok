# Modifier les textes manuellement

Tous les textes du site sont dans un seul fichier : `public/index.html`. Pas besoin de savoir coder pour les changer — voici comment faire, étape par étape.

## 1. Ouvrir le fichier

- Installe un éditeur de texte gratuit (recommandé) : [VS Code](https://code.visualstudio.com) ou [Notepad++](https://notepad-plus-plus.org).
- Ouvre le dossier `cashtok` avec l'éditeur, puis ouvre `public/index.html`.
- (Tu peux aussi l'ouvrir avec le Bloc-notes Windows, mais VS Code est plus lisible.)

## 2. Trouver ce qu'il faut changer

Fais `Ctrl+F` dans l'éditeur pour chercher le symbole `…` — c'est un repère qui marque chaque endroit encore à remplir (nom du produit, prix, description, avis clients, contact...).

Exemple, dans le fichier tu verras :

```html
<div class="product-name">…</div>
```

Remplace uniquement ce qui est **entre** les balises `<...>` et `</...>`, sans toucher aux balises elles-mêmes :

```html
<div class="product-name">Mon Super Produit</div>
```

## 3. Les endroits à connaître en priorité

| Ce que tu veux changer | Où le trouver dans `index.html` |
|---|---|
| Titre principal (hero) | `<h1>Obtenez plus, sans effort inutile.</h1>` |
| Nom du produit | `<div class="product-name">…</div>` |
| Description du produit | `<div class="product-desc">…</div>` |
| Prix affiché | `<span class="amount">…</span>` |
| Ce qui est inclus (4 lignes) | les 4 `<li>…</li>` sous `included-list` |
| Avis clients | section `id="avis"` (⚠️ voir encadré ci-dessous) |
| Email de contact | tout en bas, `<a href="mailto:...">` |
| Copyright | `<div class="footer-bottom">© … CashTok...</div>` |

> ⚠️ **Important sur les avis clients** : n'invente pas de faux avis attribués à de fausses personnes présentées comme de vrais clients — c'est interdit par la loi (pratique commerciale trompeuse) et ça peut te causer de vrais problèmes légaux. Laisse cette section vide/masquée tant que tu n'as pas de vrais avis, ou retire simplement la section `id="avis"` du fichier.

## 4. Changer le prix (2 endroits à synchroniser)

Le prix apparaît à **deux endroits différents** qui doivent rester cohérents :

1. **Affichage visuel** — dans `public/index.html` :
   ```html
   <span class="amount">29</span>
   ```
2. **Montant réellement facturé** — dans le fichier `.env` (backend) :
   ```
   PRODUCT_PRICE_CENTS=2900
   ```
   (2900 = 29,00 €, c'est toujours en centimes)

Si tu changes l'un sans l'autre, le prix affiché ne correspondra pas au prix payé — pense toujours à modifier les deux.

## 5. Prévisualiser tes changements

Depuis le dossier `cashtok`, lance :

```bash
npm start
```

Ouvre ensuite `http://localhost:3000` dans ton navigateur pour voir le résultat. Recharge la page (`F5`) après chaque modification enregistrée.

## 6. Republier en ligne après modification

Une fois le site déjà en ligne (voir `TUTORIEL.md`, étapes 7-8, pour la mise en ligne initiale), pour publier une modification :

**Si tu utilises Git + Render (méthode recommandée) :**
```bash
git add .
git commit -m "Mise à jour des textes"
git push
```
Render redéploie automatiquement ton site en 1-2 minutes après le `push`.

**Si tu préfères sans Git**, dans le Dashboard Render tu peux aussi glisser-déposer/uploader les fichiers modifiés directement, selon l'option choisie à la création du service.

## Résumé express

1. Ouvre `public/index.html` dans VS Code
2. `Ctrl+F` → cherche `…`
3. Remplace le texte entre les balises
4. Si tu touches au prix, mets aussi à jour `.env`
5. `npm start` pour prévisualiser en local
6. `git push` (ou upload sur Render) pour publier le changement
