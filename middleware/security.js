const rateLimit = require('express-rate-limit');

// Brute-force protection on auth endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// Prevents spam-publishing of scripts.
const publishLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Publish limit reached. Please try again later.' },
});

// General API/browsing limiter.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// Limiter for the raw script fetch endpoint (executors polling loadstrings).
const rawFetchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Self-serve key generation (public /key/:id page) — generous but bounded,
// to stop someone scripting mass key creation.
const keyGenLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many keys requested. Please try again later.' },
});

// Runtime key validation — hit by the obfuscated loader itself every time
// a key-protected script runs, so this needs real headroom.
const keyValidateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  authLimiter,
  publishLimiter,
  generalLimiter,
  rawFetchLimiter,
  keyGenLimiter,
  keyValidateLimiter,
};
