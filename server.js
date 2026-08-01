require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const Stripe = require('stripe');
const multer = require('multer');
const PDFDocument = require('pdfkit');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
const IS_PROD = process.env.NODE_ENV === 'production';

const DOMAIN = process.env.DOMAIN || 'http://localhost:3000';
const PRODUCT_NAME = process.env.PRODUCT_NAME || '…';
const PRODUCT_DESCRIPTION = process.env.PRODUCT_DESCRIPTION || '…';
const PRODUCT_PRICE_CENTS = parseInt(process.env.PRODUCT_PRICE_CENTS || '0', 10);
const CURRENCY = process.env.CURRENCY || 'eur';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || '';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
// Adresse qui reçoit l'alerte + facture à chaque commande (peut différer de ADMIN_EMAIL, utilisée pour le code 2FA)
const ORDER_ALERT_EMAIL = process.env.ORDER_ALERT_EMAIL || ADMIN_EMAIL;

const DATA_DIR = path.join(__dirname, 'data');
const PROMO_PATH = path.join(DATA_DIR, 'promo.json');
const THEME_PATH = path.join(DATA_DIR, 'theme.json');
const REVIEWS_PATH = path.join(DATA_DIR, 'reviews.json');
const ORDERS_PATH = path.join(DATA_DIR, 'orders.json');
const CONTENT_PATH = path.join(__dirname, 'public', 'content.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ============================================================
// Sécurité de base
// ============================================================
app.set('trust proxy', 1); // nécessaire derrière Render/Replit pour cookies "secure" + IP réelle
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'unsafe-inline' requis car les pages utilisent des <script>/style inline ;
        // le site ne charge pas Stripe.js (redirection vers Stripe Checkout hébergé),
        // donc pas besoin d'autoriser *.stripe.com ici.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.use(cors());

app.use(
  session({
    name: 'cashtok.sid',
    secret: SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: 'lax',
      maxAge: 2 * 60 * 60 * 1000, // 2h
    },
  })
);

// Limiteurs anti brute-force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop de tentatives. Réessaie dans 15 minutes.',
});
const twoFaLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop de tentatives. Réessaie plus tard.',
});
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// ============================================================
// Stripe webhook (route brute AVANT express.json())
// ============================================================
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature invalide:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    try {
      recordOrder(session);
    } catch (err) {
      console.error("Erreur enregistrement de la commande:", err);
    }
    try {
      await sendReceiptEmail(session);
    } catch (err) {
      console.error('Erreur envoi du reçu email:', err);
    }
    try {
      await sendAdminOrderAlert(session);
    } catch (err) {
      console.error("Erreur envoi de l'alerte commande admin:", err);
    }
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// Auth admin — utilitaires
// ============================================================
const pending2FA = new Map(); // token -> { username, codeHash, expiresAt, lastSentAt, attempts }
const loginFailures = new Map(); // ip -> { count, lockedUntil }

function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  if (local.length <= 2) return `${local[0] || '*'}*@${domain}`;
  return `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}@${domain}`;
}

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

async function sendAdminCodeEmail(code) {
  if (process.env.DEBUG_2FA_LOG) console.log('[DEBUG 2FA CODE]', code);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await transporter.sendMail({
    from: process.env.FROM_EMAIL,
    to: ADMIN_EMAIL,
    subject: 'Ton code de connexion CashTok',
    html: `
      <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
        <h2 style="color:#1e4fd8;">Code de connexion</h2>
        <p>Voici ton code de vérification, valable 10 minutes :</p>
        <p style="font-size:32px; font-weight:800; letter-spacing:6px; color:#12275a;">${code}</p>
        <p style="color:#888; font-size:13px;">Si tu n'es pas à l'origine de cette tentative de connexion, ignore cet email.</p>
      </div>
    `,
  });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Non authentifié.' });
}

// ============================================================
// Auth admin — routes
// ============================================================

// Étape 1 : identifiants
app.post('/admin/login', loginLimiter, async (req, res) => {
  const ip = req.ip;
  const failure = loginFailures.get(ip);
  if (failure && failure.lockedUntil > Date.now()) {
    return res.status(429).json({ error: 'Trop de tentatives échouées. Réessaie plus tard.' });
  }

  const { username, password } = req.body || {};

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH || !ADMIN_EMAIL || !SESSION_SECRET) {
    return res.status(500).json({ error: "Authentification admin non configurée côté serveur (.env)." });
  }

  const usernameOk =
    typeof username === 'string' &&
    username.length === ADMIN_USERNAME.length &&
    crypto.timingSafeEqual(Buffer.from(username), Buffer.from(ADMIN_USERNAME));

  const passwordOk = typeof password === 'string' && (await bcrypt.compare(password, ADMIN_PASSWORD_HASH));

  if (!usernameOk || !passwordOk) {
    const current = loginFailures.get(ip) || { count: 0, lockedUntil: 0 };
    current.count += 1;
    if (current.count >= 5) {
      current.lockedUntil = Date.now() + 15 * 60 * 1000;
      current.count = 0;
    }
    loginFailures.set(ip, current);
    return res.status(401).json({ error: 'Identifiants invalides.' });
  }

  loginFailures.delete(ip);

  const token = crypto.randomBytes(24).toString('hex');
  const code = generateCode();
  pending2FA.set(token, {
    username,
    codeHash: hashCode(code),
    expiresAt: Date.now() + 10 * 60 * 1000,
    lastSentAt: Date.now(),
    attempts: 0,
  });

  res.cookie('pending_2fa', token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });

  try {
    await sendAdminCodeEmail(code);
  } catch (err) {
    console.error('Erreur envoi email 2FA:', err);
    return res.status(500).json({ error: "Impossible d'envoyer l'email de vérification." });
  }

  res.json({ ok: true, maskedEmail: maskEmail(ADMIN_EMAIL) });
});

// Étape 2 : code à 6 chiffres
app.post('/admin/verify-2fa', twoFaLimiter, (req, res) => {
  const token = req.cookies?.pending_2fa || parseCookie(req, 'pending_2fa');
  const entry = token ? pending2FA.get(token) : null;

  if (!entry) return res.status(401).json({ error: 'Session de connexion expirée. Reconnecte-toi.' });
  if (Date.now() > entry.expiresAt) {
    pending2FA.delete(token);
    return res.status(401).json({ error: 'Code expiré. Reconnecte-toi.' });
  }

  const { code } = req.body || {};
  const submittedHash = hashCode(String(code || ''));
  const valid =
    submittedHash.length === entry.codeHash.length &&
    crypto.timingSafeEqual(Buffer.from(submittedHash), Buffer.from(entry.codeHash));

  if (!valid) {
    entry.attempts += 1;
    if (entry.attempts >= 5) {
      pending2FA.delete(token);
      return res.status(401).json({ error: 'Trop de tentatives. Reconnecte-toi.' });
    }
    return res.status(401).json({ error: 'Code incorrect.' });
  }

  pending2FA.delete(token);
  res.clearCookie('pending_2fa');

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Erreur serveur.' });
    req.session.isAdmin = true;
    req.session.username = entry.username;
    res.json({ ok: true });
  });
});

// Renvoyer un nouveau code (cooldown 1 min)
app.post('/admin/resend-2fa', twoFaLimiter, async (req, res) => {
  const token = req.cookies?.pending_2fa || parseCookie(req, 'pending_2fa');
  const entry = token ? pending2FA.get(token) : null;

  if (!entry) return res.status(401).json({ error: 'Session de connexion expirée. Reconnecte-toi.' });

  const elapsed = Date.now() - entry.lastSentAt;
  if (elapsed < 60 * 1000) {
    return res.status(429).json({ error: 'Patiente avant de renvoyer un code.', secondsRemaining: Math.ceil((60 * 1000 - elapsed) / 1000) });
  }

  const code = generateCode();
  entry.codeHash = hashCode(code);
  entry.expiresAt = Date.now() + 10 * 60 * 1000;
  entry.lastSentAt = Date.now();
  entry.attempts = 0;

  try {
    await sendAdminCodeEmail(code);
  } catch (err) {
    console.error('Erreur renvoi email 2FA:', err);
    return res.status(500).json({ error: "Impossible d'envoyer l'email." });
  }

  res.json({ ok: true, maskedEmail: maskEmail(ADMIN_EMAIL) });
});

app.get('/admin/session-status', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Petit parseur de cookie de secours (au cas où le cookie n'est pas encore lu automatiquement)
function parseCookie(req, name) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

// ============================================================
// Contenu du site (textes modifiables visuellement)
// ============================================================
app.post('/save-content', requireAdmin, (req, res) => {
  try {
    fs.writeFileSync(CONTENT_PATH, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur écriture content.json:', err);
    res.status(500).json({ error: 'Erreur serveur lors de la sauvegarde.' });
  }
});

// ============================================================
// Upload d'images (mode édition visuel) — stocké sur Cloudinary
// (le disque de Render n'est pas persistant entre deux déploiements)
// ============================================================
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
      return cb(new Error('Format non supporté. Utilise JPG, PNG, WEBP ou GIF.'));
    }
    cb(null, true);
  },
});

function extractCloudinaryPublicId(url) {
  const match = String(url || '').match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+(?:\?.*)?$/);
  return match ? match[1] : null;
}

app.post('/admin/upload-image', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Échec de l'upload." });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier reçu.' });
    }
    if (!process.env.CLOUDINARY_CLOUD_NAME) {
      return res.status(500).json({ error: "Stockage d'images non configuré (variables CLOUDINARY_* manquantes)." });
    }

    const stream = cloudinary.uploader.upload_stream(
      { folder: 'cashtok', resource_type: 'image' },
      (error, result) => {
        if (error) {
          console.error('Erreur upload Cloudinary:', error);
          return res.status(500).json({ error: "Échec de l'upload vers le stockage d'images." });
        }
        res.json({ url: result.secure_url });
      }
    );
    stream.end(req.file.buffer);
  });
});

app.delete('/admin/upload-image', requireAdmin, async (req, res) => {
  const { url } = req.body || {};
  if (typeof url !== 'string' || !url.includes('res.cloudinary.com')) {
    return res.status(400).json({ error: 'URL invalide.' });
  }

  const publicId = extractCloudinaryPublicId(url);
  if (publicId) {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (err) {
      console.warn('Suppression Cloudinary échouée (image déjà supprimée ?):', err.message);
    }
  }
  res.json({ ok: true });
});

// ============================================================
// Thème (couleur + police)
// ============================================================
const FONT_PRESETS = {
  poppins: "'Poppins', 'Segoe UI', sans-serif",
  moderne: "'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, sans-serif",
  classique: "Georgia, 'Times New Roman', serif",
  elegant: "'Trebuchet MS', sans-serif",
  technique: "'Courier New', monospace",
  clean: "Verdana, Geneva, sans-serif",
};

function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

app.get('/theme.json', (req, res) => {
  const theme = readJsonSafe(THEME_PATH, { primaryColor: '#1e4fd8', font: 'poppins' });
  res.json({ ...theme, fontFamily: FONT_PRESETS[theme.font] || FONT_PRESETS.poppins, fontOptions: Object.keys(FONT_PRESETS) });
});

app.post('/admin/theme', requireAdmin, (req, res) => {
  const { primaryColor, font } = req.body || {};
  if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor || '')) {
    return res.status(400).json({ error: 'Couleur invalide (format hexadécimal attendu, ex: #1e4fd8).' });
  }
  if (!FONT_PRESETS[font]) {
    return res.status(400).json({ error: 'Police invalide.' });
  }
  fs.writeFileSync(THEME_PATH, JSON.stringify({ primaryColor, font }, null, 2), 'utf-8');
  res.json({ ok: true });
});

// ============================================================
// Codes promo (-20%, 24h, gérés via Stripe Promotion Codes)
// ============================================================
app.get('/promo-status', (req, res) => {
  const promo = readJsonSafe(PROMO_PATH, null);
  const active = !!(promo && promo.active && Date.now() < promo.expiresAt);
  res.json({ active });
});

app.get('/admin/promo', requireAdmin, (req, res) => {
  const promo = readJsonSafe(PROMO_PATH, null);
  if (!promo) return res.json({ promo: null });
  res.json({ promo: { ...promo, expired: Date.now() > promo.expiresAt } });
});

app.post('/admin/promo/create', requireAdmin, async (req, res) => {
  try {
    let { code, percentOff, durationHours } = req.body || {};
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
    if (code.length < 3) {
      return res.status(400).json({ error: 'Le code doit contenir au moins 3 caractères (lettres/chiffres).' });
    }

    const percent = Math.round(Number(percentOff));
    if (!Number.isInteger(percent) || percent < 1 || percent > 99) {
      return res.status(400).json({ error: 'Le pourcentage de réduction doit être un nombre entre 1 et 99.' });
    }

    const hours = Math.round(Number(durationHours));
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) {
      return res.status(400).json({ error: 'La durée doit être un nombre entre 1 et 720 heures (30 jours max).' });
    }

    // Désactive l'ancien code s'il existe encore
    const existing = readJsonSafe(PROMO_PATH, null);
    if (existing && existing.promotionCodeId) {
      try {
        await stripe.promotionCodes.update(existing.promotionCodeId, { active: false });
      } catch (err) {
        console.warn('Impossible de désactiver l\'ancien code (déjà expiré ?):', err.message);
      }
    }

    const coupon = await stripe.coupons.create({ percent_off: percent, duration: 'once' });
    const expiresAt = Date.now() + hours * 60 * 60 * 1000;
    const promotionCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code,
      active: false,
      expires_at: Math.floor(expiresAt / 1000),
    });

    const record = {
      code,
      couponId: coupon.id,
      promotionCodeId: promotionCode.id,
      active: false,
      createdAt: Date.now(),
      expiresAt,
      percentOff: percent,
      durationHours: hours,
    };
    fs.writeFileSync(PROMO_PATH, JSON.stringify(record, null, 2), 'utf-8');
    res.json({ ok: true, promo: record });
  } catch (err) {
    console.error('Erreur création code promo:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/promo/toggle', requireAdmin, async (req, res) => {
  try {
    const { active } = req.body || {};
    const promo = readJsonSafe(PROMO_PATH, null);
    if (!promo) return res.status(400).json({ error: 'Aucun code promo créé.' });
    if (Date.now() > promo.expiresAt) {
      return res.status(400).json({ error: 'Ce code a expiré (24h écoulées). Crée-en un nouveau.' });
    }

    await stripe.promotionCodes.update(promo.promotionCodeId, { active: !!active });
    promo.active = !!active;
    fs.writeFileSync(PROMO_PATH, JSON.stringify(promo, null, 2), 'utf-8');
    res.json({ ok: true, promo });
  } catch (err) {
    console.error('Erreur activation/désactivation code promo:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Avis clients (réservé aux acheteurs vérifiés)
// ============================================================
const reviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function hashSessionId(sessionId) {
  return crypto.createHash('sha256').update(sessionId).digest('hex');
}

app.get('/reviews', (req, res) => {
  const reviews = readJsonSafe(REVIEWS_PATH, []);
  const publicReviews = reviews
    .map(({ name, rating, comment, createdAt }) => ({ name, rating, comment, createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);
  res.json({ reviews: publicReviews });
});

app.post('/submit-review', reviewLimiter, async (req, res) => {
  try {
    const { sessionId, name, rating, comment } = req.body || {};

    if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) {
      return res.status(400).json({ error: 'Achat introuvable.' });
    }
    const cleanName = typeof name === 'string' ? name.trim().slice(0, 60) : '';
    const cleanComment = typeof comment === 'string' ? comment.trim().slice(0, 500) : '';
    const cleanRating = Math.round(Number(rating));

    if (!cleanName) return res.status(400).json({ error: 'Merci de renseigner un nom.' });
    if (!cleanComment) return res.status(400).json({ error: 'Merci de renseigner un avis.' });
    if (!Number.isInteger(cleanRating) || cleanRating < 1 || cleanRating > 5) {
      return res.status(400).json({ error: 'Note invalide.' });
    }

    // Vérifie auprès de Stripe que cette session correspond à un paiement réellement effectué
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
      return res.status(400).json({ error: 'Achat introuvable.' });
    }
    if (session.payment_status !== 'paid') {
      return res.status(403).json({ error: 'Seuls les clients ayant finalisé un achat peuvent laisser un avis.' });
    }

    const sessionHash = hashSessionId(sessionId);
    const reviews = readJsonSafe(REVIEWS_PATH, []);
    if (reviews.some((r) => r.sessionHash === sessionHash)) {
      return res.status(409).json({ error: 'Un avis a déjà été laissé pour cet achat.' });
    }

    reviews.push({
      name: cleanName,
      rating: cleanRating,
      comment: cleanComment,
      createdAt: Date.now(),
      sessionHash,
    });
    fs.writeFileSync(REVIEWS_PATH, JSON.stringify(reviews, null, 2), 'utf-8');

    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur soumission avis:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ============================================================
// Diagnostic de configuration (réservé à l'admin, aucune valeur exposée)
// ============================================================
app.get('/admin/config-status', requireAdmin, (req, res) => {
  const check = (name) => {
    const v = process.env[name];
    return !!v && v.trim() !== '' && !v.includes('...');
  };
  res.json({
    stripeSecretKey: check('STRIPE_SECRET_KEY'),
    stripeWebhookSecret: check('STRIPE_WEBHOOK_SECRET'),
    smtp: check('SMTP_HOST') && check('SMTP_USER') && check('SMTP_PASS'),
    cloudinary: check('CLOUDINARY_CLOUD_NAME') && check('CLOUDINARY_API_KEY') && check('CLOUDINARY_API_SECRET'),
    productDeliveryUrl: check('PRODUCT_DELIVERY_URL') && !process.env.PRODUCT_DELIVERY_URL.includes('A-REMPLACER'),
    orderAlertEmail: check('ORDER_ALERT_EMAIL'),
    nodeEnvProduction: process.env.NODE_ENV === 'production',
  });
});

// ============================================================
// Commandes — historique + notifications admin (réservé à l'admin)
// ============================================================
function recordOrder(session) {
  const orders = readJsonSafe(ORDERS_PATH, []);
  orders.push({
    id: session.id,
    amount: session.amount_total,
    customerEmail: session.customer_details?.email || 'inconnu',
    customerName: session.customer_details?.name || '',
    createdAt: Date.now(),
    viewed: false,
  });
  // garde un historique raisonnable
  const trimmed = orders.slice(-500);
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(trimmed, null, 2), 'utf-8');
}

app.get('/admin/orders', requireAdmin, (req, res) => {
  const orders = readJsonSafe(ORDERS_PATH, []);
  const sorted = [...orders].sort((a, b) => b.createdAt - a.createdAt);
  res.json({ orders: sorted, unviewedCount: sorted.filter((o) => !o.viewed).length });
});

app.post('/admin/orders/:id/mark-viewed', requireAdmin, (req, res) => {
  const orders = readJsonSafe(ORDERS_PATH, []);
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
  order.viewed = true;
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2), 'utf-8');
  res.json({ ok: true });
});

// ============================================================
// Paiement Stripe Checkout (carte + Apple Pay automatiques)
// ============================================================
app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Ne pas fixer payment_method_types : Stripe active automatiquement les moyens de
      // paiement les plus pertinents (carte, Apple Pay, Google Pay...) selon l'appareil du client.
      allow_promotion_codes: true,
      // Force la collecte du nom/prénom + adresse du client, nécessaire pour la facture
      billing_address_collection: 'required',
      line_items: [
        {
          price_data: {
            currency: CURRENCY,
            product_data: { name: PRODUCT_NAME, description: PRODUCT_DESCRIPTION },
            unit_amount: PRODUCT_PRICE_CENTS,
          },
          quantity: 1,
        },
      ],
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${DOMAIN}/cancel.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Erreur création session Stripe:', err);
    res.status(500).json({ error: err.message });
  }
});


// ============================================================
// Reçu email personnalisé après achat
// ============================================================
async function sendReceiptEmail(session) {
  const customerEmail = session.customer_details?.email;
  if (!customerEmail) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const amount = (session.amount_total / 100).toFixed(2);

  await transporter.sendMail({
    from: process.env.FROM_EMAIL,
    to: customerEmail,
    subject: `Votre reçu — ${PRODUCT_NAME}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#1e4fd8;">Merci pour votre achat !</h2>
        <p>Voici la confirmation de votre paiement :</p>
        <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding:8px 0;">Produit</td><td style="text-align:right;">${PRODUCT_NAME}</td></tr>
          <tr><td style="padding:8px 0;">Montant</td><td style="text-align:right;">${amount} €</td></tr>
          <tr><td style="padding:8px 0;">Référence</td><td style="text-align:right;">${session.id}</td></tr>
        </table>
        <p>Voici votre accès à la formation : <a href="${process.env.PRODUCT_DELIVERY_URL}">${process.env.PRODUCT_DELIVERY_URL}</a></p>
        <p style="color:#888; font-size:12px; margin-top:24px;">CashTok — support : ${process.env.FROM_EMAIL}</p>
      </div>
    `,
  });
}

// ============================================================
// Facture PDF générée automatiquement à chaque commande
// ============================================================
function generateInvoicePdf(session) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const amount = (session.amount_total / 100).toFixed(2);
    const date = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
    const customerEmail = session.customer_details?.email || 'N/A';
    const customerName = session.customer_details?.name || 'Non renseigné';

    doc.fontSize(20).fillColor('#1e4fd8').text('CashTok');
    doc.fontSize(10).fillColor('#666').text(process.env.FROM_EMAIL || '');
    doc.moveDown(2);

    doc.fontSize(16).fillColor('#000').text('Facture');
    doc.moveDown();

    doc.fontSize(10).fillColor('#333');
    doc.text(`Référence : ${session.id}`);
    doc.text(`Date : ${date}`);
    doc.text(`Client : ${customerName}`);
    doc.text(`Email : ${customerEmail}`);
    doc.moveDown();

    doc.fontSize(11).fillColor('#000');
    const tableTop = doc.y;
    doc.text('Description', 50, tableTop, { continued: true, width: 350 });
    doc.text('Montant', { align: 'right' });
    doc.moveTo(50, doc.y + 4).lineTo(545, doc.y + 4).stroke();
    doc.moveDown(0.5);

    doc.fontSize(10).fillColor('#333');
    doc.text(PRODUCT_NAME, 50, doc.y, { continued: true, width: 350 });
    doc.text(`${amount} €`, { align: 'right' });

    doc.moveDown(2);
    doc.fontSize(12).fillColor('#000').text(`Total payé : ${amount} €`, { align: 'right' });

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#888').text('Paiement traité de manière sécurisée par Stripe.');

    doc.end();
  });
}

// ============================================================
// Alerte admin — envoyée à chaque commande, avec la facture PDF jointe
// ============================================================
async function sendAdminOrderAlert(session) {
  if (!ORDER_ALERT_EMAIL) return;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const amount = (session.amount_total / 100).toFixed(2);
  const customerEmail = session.customer_details?.email || 'inconnu';
  const customerName = session.customer_details?.name || 'Non renseigné';
  const pdfBuffer = await generateInvoicePdf(session);

  await transporter.sendMail({
    from: process.env.FROM_EMAIL,
    to: ORDER_ALERT_EMAIL,
    subject: `🛒 Nouvelle commande — ${amount} €`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#1e4fd8;">Nouvelle commande reçue !</h2>
        <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding:8px 0;">Produit</td><td style="text-align:right;">${PRODUCT_NAME}</td></tr>
          <tr><td style="padding:8px 0;">Montant</td><td style="text-align:right;">${amount} €</td></tr>
          <tr><td style="padding:8px 0;">Client</td><td style="text-align:right;">${customerName}</td></tr>
          <tr><td style="padding:8px 0;">Email</td><td style="text-align:right;">${customerEmail}</td></tr>
          <tr><td style="padding:8px 0;">Référence</td><td style="text-align:right;">${session.id}</td></tr>
        </table>
        <p>La facture correspondante est jointe à cet email (PDF).</p>
      </div>
    `,
    attachments: [
      {
        filename: `facture-${session.id}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CashTok en écoute sur le port ${PORT}`));
