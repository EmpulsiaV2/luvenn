const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { requireGuest } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const { isValidUsername, isValidEmail } = require('../utils');

const router = express.Router();

router.get('/register', requireGuest, (req, res) => {
  res.render('register', { title: 'Create account', error: null, values: {} });
});

router.post('/register', requireGuest, authLimiter, async (req, res, next) => {
  try {
    const { username, email, password, confirm_password, invite_code } = req.body;
    const values = { username, email };

    if (process.env.REQUIRE_INVITE_CODE === 'true') {
      if (!invite_code || invite_code !== process.env.INVITE_CODE) {
        return res.render('register', { title: 'Create account', error: 'Invalid invite code.', values });
      }
    }

    if (!isValidUsername(username)) {
      return res.render('register', {
        title: 'Create account',
        error: 'Username must be 3-20 characters: letters, numbers, underscores only.',
        values,
      });
    }
    if (!isValidEmail(email)) {
      return res.render('register', { title: 'Create account', error: 'Please enter a valid email address.', values });
    }
    if (!password || password.length < 8) {
      return res.render('register', { title: 'Create account', error: 'Password must be at least 8 characters.', values });
    }
    if (password !== confirm_password) {
      return res.render('register', { title: 'Create account', error: 'Passwords do not match.', values });
    }

    const usernameLower = username.toLowerCase();
    const emailLower = email.toLowerCase();

    const existing = await query(
      'SELECT id FROM users WHERE username_lower = $1 OR email = $2',
      [usernameLower, emailLower]
    );
    if (existing.rows.length > 0) {
      return res.render('register', { title: 'Create account', error: 'That username or email is already taken.', values });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { rows } = await query(
      `INSERT INTO users (username, username_lower, email, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING id, username, is_admin`,
      [username, usernameLower, emailLower, passwordHash]
    );

    const user = rows[0];
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      res.redirect('/dashboard');
    });
  } catch (err) {
    next(err);
  }
});

router.get('/login', requireGuest, (req, res) => {
  res.render('login', { title: 'Log in', error: null, next: req.query.next || '' });
});

router.post('/login', requireGuest, authLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const nextUrl = req.body.next || '';

    if (!username || !password) {
      return res.render('login', { title: 'Log in', error: 'Enter your username and password.', next: nextUrl });
    }

    const { rows } = await query(
      'SELECT id, password_hash, is_banned FROM users WHERE username_lower = $1',
      [String(username).toLowerCase()]
    );
    const user = rows[0];

    // Constant-shape response whether the user exists or not, to avoid
    // leaking which usernames are registered via timing/response differences.
    const dummyHash = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8gPpqoxbQ8gwzxV6cX7NGmz1Rp8YQm';
    const ok = await bcrypt.compare(password, user ? user.password_hash : dummyHash);

    if (!user || !ok) {
      return res.render('login', { title: 'Log in', error: 'Incorrect username or password.', next: nextUrl });
    }
    if (user.is_banned) {
      return res.render('login', { title: 'Log in', error: 'This account has been suspended.', next: nextUrl });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      const dest = nextUrl && nextUrl.startsWith('/') ? nextUrl : '/dashboard';
      res.redirect(dest);
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('luvenn.sid');
    res.redirect('/');
  });
});

module.exports = router;
