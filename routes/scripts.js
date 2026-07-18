const express = require('express');
const { query } = require('../db');
const { rawFetchLimiter } = require('../middleware/security');
const { looksLikeBrowser, timeAgo } = require('../utils');

const router = express.Router();

// ---- Marketing landing page ----
router.get('/', (req, res) => {
  res.render('home', { title: 'luvenn — protect your scripts' });
});

router.get('/docs', (req, res) => {
  res.render('docs', { title: 'Docs' });
});

router.get('/faq', (req, res) => {
  res.render('faq', { title: 'F.A.Q' });
});

// ---- Script / loader product page (humans) ----
router.get('/script/:publicId', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT scripts.*, users.username FROM scripts
       JOIN users ON users.id = scripts.user_id
       WHERE public_id = $1`,
      [req.params.publicId]
    );
    const script = rows[0];

    if (!script || (script.status !== 'published' && (!req.user || req.user.id !== script.user_id))) {
      return res.status(404).render('error', { title: 'Not found', message: 'That script does not exist or is no longer available.' });
    }

    query('UPDATE scripts SET views = views + 1 WHERE id = $1', [script.id]).catch(() => {});

    const loadstring = `loadstring(game:HttpGet("${process.env.SITE_URL || 'https://luvenn.xyz'}/files/v3/loaders/${script.public_id}.lua"))()`;

    res.render('script', {
      title: `${script.title} — luvenn`,
      script,
      loadstring,
      canManage: req.user && req.user.id === script.user_id,
      timeAgo,
    });
  } catch (err) {
    next(err);
  }
});

// ---- Loader endpoint: gated to non-browser (executor) User-Agents ----
// Mirrors Luarmor's URL shape: /files/v3/loaders/<id>.lua
router.get('/files/v3/loaders/:publicId.lua', rawFetchLimiter, async (req, res, next) => {
  try {
    const ua = req.get('User-Agent') || '';

    const { rows } = await query(
      `SELECT id, user_id, protected_code, status FROM scripts WHERE public_id = $1`,
      [req.params.publicId]
    );
    const script = rows[0];

    if (looksLikeBrowser(ua)) {
      if (script) {
        query('UPDATE scripts SET blocked_attempts = blocked_attempts + 1 WHERE id = $1', [script.id]).catch(() => {});
        query(
          `INSERT INTO fetch_events (user_id, script_id, event_type) VALUES ($1, $2, 'blocked')`,
          [script.user_id, script.id]
        ).catch(() => {});
      }
      return res.status(403).type('text/plain').send('403 Forbidden');
    }

    if (!script || script.status !== 'published') {
      return res.status(404).type('text/plain').send('-- script not found');
    }

    query('UPDATE scripts SET fetches = fetches + 1 WHERE id = $1', [script.id]).catch(() => {});
    query(
      `INSERT INTO fetch_events (user_id, script_id, event_type) VALUES ($1, $2, 'fetch')`,
      [script.user_id, script.id]
    ).catch(() => {});

    res.type('text/plain').send(script.protected_code);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
