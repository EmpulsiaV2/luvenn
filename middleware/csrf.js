const crypto = require('crypto');

// Lightweight synchronizer-token CSRF protection tied to the session.
// A token is generated per session and must be echoed back on every
// state-changing (non-GET) request via a hidden form field named _csrf.
function csrfToken(req, res, next) {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfSecret;
  next();
}

function csrfProtect(req, res, next) {
  const safe = ['GET', 'HEAD', 'OPTIONS'];
  if (safe.includes(req.method)) return next();

  const sent = req.body && req.body._csrf;
  const expected = req.session && req.session.csrfSecret;
  const sentBuf = Buffer.from(String(sent || ''));
  const expectedBuf = Buffer.from(String(expected || ''));
  const valid =
    sent &&
    expected &&
    sentBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(sentBuf, expectedBuf);

  if (!valid) {
    return res.status(403).render('error', {
      title: 'Request blocked',
      message: 'Your session expired or the request could not be verified. Please go back and try again.',
    });
  }
  next();
}

module.exports = { csrfToken, csrfProtect };
