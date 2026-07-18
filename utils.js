const crypto = require('crypto');

// Loader IDs look like Luarmor's: a 32-character lowercase hex string,
// e.g. 9b1237493f9953a3a353d2384fac0bba0
function generatePublicId() {
  return crypto.randomBytes(16).toString('hex');
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidUsername(u) {
  return typeof u === 'string' && USERNAME_RE.test(u);
}

function isValidEmail(e) {
  return typeof e === 'string' && e.length <= 255 && EMAIL_RE.test(e);
}

// Heuristic User-Agent check used by the loader endpoint. Real browsers
// announce Mozilla/Chrome/Safari/Firefox/Edge tokens. Roblox executors
// typically send a short or absent UA. Not unspoofable on its own — it's
// one layer, paired with unguessable 32-char IDs and rate limiting.
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

// Scripts start at 0.0.1 and bump their patch number on every edit,
// e.g. "0.0.1" -> "0.0.2" -> "0.0.3".
function bumpPatchVersion(version) {
  const parts = String(version || '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.join('.');
}

// Real access keys, e.g. LUVENN-8F2K-93QZ-4RXT
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
function generateAccessKey() {
  const group = () => Array.from({ length: 4 }, () => KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)]).join('');
  return `LUVENN-${group()}-${group()}-${group()}`;
}

const CATEGORIES = ['universal', 'game-specific', 'gui', 'admin', 'other'];

module.exports = {
  generatePublicId,
  isValidUsername,
  isValidEmail,
  looksLikeBrowser,
  timeAgo,
  bumpPatchVersion,
  generateAccessKey,
  CATEGORIES,
};
