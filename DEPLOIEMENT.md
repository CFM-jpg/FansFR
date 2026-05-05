# FansFR — Guide de déploiement Vercel

## Structure des fichiers API

```
src/app/api/
├── checkout/route.ts       → POST  Créer session Stripe Checkout
├── webhook/route.ts        → POST  Recevoir événements Stripe
├── send-email/route.ts     → POST  Envoyer emails via Resend
├── stock-alerts/route.ts   → POST/GET  Alertes retour en stock
├── relay-points/route.ts   → GET   Points relais Sendcloud
├── import-sheets/route.ts  → POST  Import catalogue Google Sheets
├── save-product/route.ts   → POST/GET/DELETE  CRUD produits (admin)
├── admin-stats/route.ts    → GET   Stats tableau de bord admin
├── products/route.ts       → GET   Catalogue public
└── orders/route.ts         → POST/GET  Commandes
```

---

## 1. Prérequis

- Compte [Vercel](https://vercel.com)
- Projet [Supabase](https://supabase.com) créé
- Compte [Stripe](https://stripe.com)
- Compte [Resend](https://resend.com)

---

## 2. Base de données Supabase

1. Ouvrir **Dashboard Supabase → SQL Editor**
2. Coller le contenu de `supabase-schema.sql`
3. Cliquer **Run**

---

## 3. Déployer sur Vercel

```bash
# 1. Installer Vercel CLI
npm i -g vercel

# 2. Initialiser le projet
cd fansfr
vercel

# 3. Ajouter les variables d'environnement
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add STRIPE_SECRET_KEY
vercel env add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
vercel env add STRIPE_WEBHOOK_SECRET
vercel env add RESEND_API_KEY
vercel env add RESEND_FROM
vercel env add SENDCLOUD_PUBLIC_KEY
vercel env add SENDCLOUD_SECRET_KEY
vercel env add GOOGLE_SHEETS_API_KEY
vercel env add ADMIN_SECRET_KEY
vercel env add NEXT_PUBLIC_SITE_URL

# 4. Déployer
vercel --prod
```

Ou via l'interface : **Vercel Dashboard → Settings → Environment Variables**

---

## 4. Configurer le Webhook Stripe

```bash
# En développement (écoute locale)
stripe listen --forward-to localhost:3000/api/webhook

# En production
# Dashboard Stripe → Développeurs → Webhooks → Ajouter un endpoint
# URL : https://votre-domaine.vercel.app/api/webhook
# Événements : checkout.session.completed, payment_intent.payment_failed
```

---

## 5. Adapter le frontend (fansfr_v3.html)

Remplacer les appels `sb.callEdgeFunction(...)` par des `fetch('/api/...')` :

### Checkout Stripe
```js
// Avant
const data = await sb.callEdgeFunction('create-checkout-session', payload);

// Après
const res = await fetch('/api/checkout', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
const data = await res.json();
```

### Envoyer un email
```js
// Avant
return sb.callEdgeFunction('send-email', { to, subject, html });

// Après
await fetch('/api/send-email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to, subject, type: 'custom', html })
});
```

### Alerte retour en stock
```js
// Avant
await sb.insert('stock_alerts', { email, product_name });

// Après
await fetch('/api/stock-alerts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, product_id: productId, product_name: productName })
});
```

### Points relais
```js
// Avant (fetch direct Sendcloud avec clés en clair)
const r = await fetch('https://servicepoints.sendcloud.sc/...');

// Après (proxy sécurisé)
const r = await fetch(`/api/relay-points?postal_code=${postalCode}`);
const data = await r.json();
renderRelayList(data.points);
```

### Import Google Sheets
```js
// Avant
const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${key}`);

// Après (clé Google côté serveur)
const r = await fetch('/api/import-sheets', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sheet_url: rawUrl })
});
```

### Charger le catalogue
```js
// Après (remplace loadProducts + query Supabase directe)
const r = await fetch('/api/products?sort=newest&limit=24');
const data = await r.json();
// data.products = tableau compatible avec PRODUCTS[]
```

---

## 6. Routes admin

Toutes les routes admin nécessitent le header :
```
x-admin-key: <valeur de ADMIN_SECRET_KEY>
```

| Endpoint | Méthode | Action |
|---|---|---|
| `/api/admin-stats` | GET | Dashboard complet |
| `/api/save-product` | POST | Créer/modifier produit |
| `/api/save-product` | GET | Lister produits avec marges |
| `/api/save-product` | DELETE | Supprimer produit |
| `/api/stock-alerts` | GET | Lister alertes en attente |
| `/api/stock-alerts` | POST `action=trigger` | Déclencher notifications |

---

## 7. Sécurité — checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` jamais dans le code côté client
- [ ] `STRIPE_SECRET_KEY` jamais exposé côté client
- [ ] `ADMIN_SECRET_KEY` généré avec `openssl rand -hex 32`
- [ ] Webhook Stripe vérifié par signature (`STRIPE_WEBHOOK_SECRET`)
- [ ] RLS activé sur toutes les tables Supabase
- [ ] `.env.local` dans `.gitignore`
