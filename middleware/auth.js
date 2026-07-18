const { query } = require('../db');

// Loads the logged-in user (if any) onto req.user / res.locals.user for every request.
// Also enforces bans: a banned user's session is killed immediately.
async function loadUser(req, res, next) {
  res.locals.user = null;
  req.user = null;

  if (!req.session || !req.session.userId) return next();

  try {
    const { rows } = await query(
      'SELECT id, username, email, is_banned, created_at FROM users WHERE id = $1',
      [req.session.userId]
    );
    const user = rows[0];

    if (!user || user.is_banned) {
      return req.session.destroy(() => next());
    }

    req.user = user;
    res.locals.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

function requireGuest(req, res, next) {
  if (req.user) return res.redirect('/dashboard');
  next();
}

module.exports = { loadUser, requireAuth, requireGuest };
