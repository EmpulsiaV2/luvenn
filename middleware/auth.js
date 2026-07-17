const { query } = require('../db');

// Loads the logged-in user (if any) onto req.user / res.locals.user for every request.
// Also enforces bans: a banned user's session is killed immediately.
async function loadUser(req, res, next) {
  res.locals.user = null;
  req.user = null;

  if (!req.session || !req.session.userId) return next();

  try {
    const { rows } = await query(
      'SELECT id, username, email, is_admin, is_banned, bio, created_at FROM users WHERE id = $1',
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

// Requires an authenticated user whose account has is_admin = TRUE.
// There is no separate admin login flow — logging in normally on an
// admin account is enough. Non-admins get a 404 (not a 403/redirect) so
// the existence of the panel isn't revealed to regular users.
function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  if (!req.user.is_admin) {
    return res.status(404).render('error', { title: 'Not found', message: "This page doesn't exist." });
  }
  next();
}

module.exports = { loadUser, requireAuth, requireGuest, requireAdmin };
