const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { keyGenLimiter, keyValidateLimiter } = require('../middleware/security');
const { generateAccessKey, timeAgo } = require('../utils');

const router = express.Router();

const EXPIRY_OPTIONS = {
  never: null,
  '1d': '1 day',
  '7d': '7 days',
  '30d': '30 days',
};

// =============================================================
// Owner-side key management (requires login)
// =============================================================

router.get('/dashboard/key-scripts', requireAuth, async (req, res, next) => {
  try {
    const { rows: scripts } = await query(
      `SELECT scripts.*, 
         (SELECT COUNT(*) FROM access_keys WHERE access_keys.script_id = scripts.id) AS key_count,
         (SELECT COUNT(*) FROM access_keys WHERE access_keys.script_id = scripts.id AND status = 'active' AND (expires_at IS NULL OR expires_at > now())) AS active_key_count
       FROM scripts WHERE user_id = $1 AND has_key_system = TRUE ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.render('key_scripts', { title: 'Key scripts', scripts, timeAgo });
  } catch (err) {
    next(err);
  }
});

router.get('/dashboard/keys', requireAuth, async (req, res, next) => {
  try {
    const { rows: keys } = await query(
      `SELECT access_keys.*, scripts.title AS script_title, scripts.public_id AS script_public_id
       FROM access_keys
       JOIN scripts ON scripts.id = access_keys.script_id
       WHERE scripts.user_id = $1
       ORDER BY access_keys.created_at DESC LIMIT 300`,
      [req.user.id]
    );
    const { rows: keyScripts } = await query(
      `SELECT id, title FROM scripts WHERE user_id = $1 AND has_key_system = TRUE ORDER BY title`,
      [req.user.id]
    );
    res.render('keys', { title: 'Keys', keys, keyScripts, timeAgo });
  } catch (err) {
    next(err);
  }
});

router.post('/dashboard/keys/generate', requireAuth, keyGenLimiter, async (req, res, next) => {
  try {
    const scriptId = parseInt(req.body.script_id, 10);
    const note = String(req.body.note || '').trim().slice(0, 120);
    const expiry = Object.prototype.hasOwnProperty.call(EXPIRY_OPTIONS, req.body.expires) ? req.body.expires : 'never';

    const { rows } = await query('SELECT id FROM scripts WHERE id = $1 AND user_id = $2 AND has_key_system = TRUE', [scriptId, req.user.id]);
    if (!rows[0]) return res.redirect('/dashboard/keys');

    let keyValue = generateAccessKey();
    for (let i = 0; i < 3; i++) {
      const clash = await query('SELECT 1 FROM access_keys WHERE key_value = $1', [keyValue]);
      if (clash.rows.length === 0) break;
      keyValue = generateAccessKey();
    }

    const interval = EXPIRY_OPTIONS[expiry];
    if (interval) {
      await query(
        `INSERT INTO access_keys (script_id, key_value, note, expires_at) VALUES ($1, $2, $3, now() + $4::interval)`,
        [scriptId, keyValue, note, interval]
      );
    } else {
      await query(`INSERT INTO access_keys (script_id, key_value, note, expires_at) VALUES ($1, $2, $3, NULL)`, [scriptId, keyValue, note]);
    }

    res.redirect('/dashboard/keys');
  } catch (err) {
    next(err);
  }
});

router.post('/dashboard/keys/:id/revoke', requireAuth, async (req, res, next) => {
  try {
    await query(
      `UPDATE access_keys SET status = CASE WHEN status = 'active' THEN 'revoked' ELSE 'active' END
       WHERE id = $1 AND script_id IN (SELECT id FROM scripts WHERE user_id = $2)`,
      [req.params.id, req.user.id]
    );
    res.redirect('/dashboard/keys');
  } catch (err) {
    next(err);
  }
});

// =============================================================
// Public self-serve key page — no login required. A script owner
// shares /key/<public_id> instead of the loader link directly with
// people who need a key.
// =============================================================

router.get('/key/:publicId', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, title, public_id, has_key_system, status FROM scripts WHERE public_id = $1`,
      [req.params.publicId]
    );
    const script = rows[0];
    if (!script || !script.has_key_system || script.status !== 'published') {
      return res.status(404).render('error', { title: 'Not found', message: 'This script does not use a key system, or does not exist.' });
    }
    res.render('get_key', { title: `Get key — ${script.title}`, script, generatedKey: null, error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/key/:publicId/generate', keyGenLimiter, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, title, public_id, has_key_system, status FROM scripts WHERE public_id = $1`,
      [req.params.publicId]
    );
    const script = rows[0];
    if (!script || !script.has_key_system || script.status !== 'published') {
      return res.status(404).render('error', { title: 'Not found', message: 'This script does not use a key system, or does not exist.' });
    }

    let keyValue = generateAccessKey();
    for (let i = 0; i < 3; i++) {
      const clash = await query('SELECT 1 FROM access_keys WHERE key_value = $1', [keyValue]);
      if (clash.rows.length === 0) break;
      keyValue = generateAccessKey();
    }

    // Self-serve keys are valid for 24 hours by default.
    await query(
      `INSERT INTO access_keys (script_id, key_value, note, expires_at) VALUES ($1, $2, 'self-serve', now() + interval '24 hours')`,
      [script.id, keyValue]
    );

    res.render('get_key', { title: `Get key — ${script.title}`, script, generatedKey: keyValue, error: null });
  } catch (err) {
    next(err);
  }
});

// =============================================================
// Runtime validation — called by the obfuscated loader itself.
// Public, unauthenticated by design; returns plain text "valid"/"invalid"
// (no JSON parsing needed on the Lua side).
// =============================================================

router.get('/api/keys/validate', keyValidateLimiter, async (req, res, next) => {
  try {
    const publicId = String(req.query.script || '');
    const keyValue = String(req.query.key || '');

    if (!publicId || !keyValue) return res.type('text/plain').send('invalid');

    const { rows } = await query(
      `SELECT access_keys.id, access_keys.status, access_keys.expires_at
       FROM access_keys
       JOIN scripts ON scripts.id = access_keys.script_id
       WHERE scripts.public_id = $1 AND access_keys.key_value = $2`,
      [publicId, keyValue]
    );
    const key = rows[0];

    const valid = key && key.status === 'active' && (!key.expires_at || new Date(key.expires_at) > new Date());

    if (valid) {
      query('UPDATE access_keys SET uses = uses + 1, last_used_at = now() WHERE id = $1', [key.id]).catch(() => {});
    }

    res.type('text/plain').send(valid ? 'valid' : 'invalid');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
