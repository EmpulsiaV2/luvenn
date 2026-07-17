const crypto = require('crypto');

// Short, URL-safe random id for public script links (e.g. /raw/aB3xK9qLmZ.lua)
function generatePublicId(len = 10) {
  return crypto
    .randomBytes(len)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, len);
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidUsername(u) {
  return typeof u === 'string' && USERNAME_RE.test(u);
}

function isValidEmail(e) {
  return typeof e === 'string' && e.length <= 255 && EMAIL_RE.test(e);
}

// Heuristic User-Agent check used by the "protection" layer on /raw/*.lua.
// Real browsers announce Mozilla/Chrome/Safari/Firefox/Edge tokens. Roblox
// executors typically send a short or absent UA, or an explicit "Roblox" token.
// This is not perfect (UA can be spoofed) — it's one layer, not the only one;
// the real gate is that raw script text is only useful with a valid loadstring
// URL, and every fetch is logged/rate-limited server-side.
const BROWSER_UA_PATTERNS = [/mozilla/i, /chrome/i, /safari/i, /firefox/i, /edg\//i, /opera/i, /msie/i, /trident/i];

function looksLikeBrowser(userAgent) {
  if (!userAgent) return false;
  return BROWSER_UA_PATTERNS.some((re) => re.test(userAgent));
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [name, secs] of units) {
    const val = Math.floor(seconds / secs);
    if (val >= 1) return `${val} ${name}${val > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

const CATEGORIES = ['universal', 'game-specific', 'gui', 'admin', 'other'];

module.exports = {
  generatePublicId,
  isValidUsername,
  isValidEmail,
  looksLikeBrowser,
  timeAgo,
  CATEGORIES,
};
