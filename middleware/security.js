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

module.exports = {
  authLimiter,
  publishLimiter,
  generalLimiter,
  rawFetchLimiter,
};
