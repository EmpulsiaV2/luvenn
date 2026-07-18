require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const { pool } = require('./db');
const { loadUser } = require('./middleware/auth');
const { csrfToken, csrfProtect } = require('./middleware/csrf');
const { generalLimiter } = require('./middleware/security');

const authRoutes = require('./routes/auth');
const scriptRoutes = require('./routes/scripts');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- Security headers ----
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.urlencoded({ extended: false, limit: '250kb' }));
app.use(express.json({ limit: '250kb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '1d' : 0 }));

// ---- Sessions (stored in Postgres/Neon, not memory) ----
app.use(
  session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    name: 'luvenn.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    },
  })
);

app.use(generalLimiter);
app.use(loadUser);
app.use(csrfToken);

app.use((req, res, next) => {
  res.locals.siteName = process.env.SITE_NAME || 'luvenn';
  res.locals.siteUrl = process.env.SITE_URL || 'https://luvenn.xyz';
  res.locals.discordInvite = process.env.DISCORD_INVITE_URL || 'https://discord.gg/';
  res.locals.path = req.path;
  next();
});

// CSRF check applies to all POST/PUT/PATCH/DELETE EXCEPT the loader
// endpoint (that one is GET-only and unauthenticated by design, hit by
// game executors, not browsers submitting forms).
app.use(csrfProtect);

app.use(scriptRoutes);
app.use(authRoutes);
app.use(dashboardRoutes);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: "This page doesn't exist." });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Something went wrong',
    message: isProd ? 'An unexpected error occurred. Please try again.' : err.message,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[luvenn] Running on http://localhost:${PORT}`);
});
