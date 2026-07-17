const express = require('express');
const { query } = require('../db');
const { rawFetchLimiter } = require('../middleware/security');
const { looksLikeBrowser, timeAgo, CATEGORIES } = require('../utils');

const router = express.Router();

// ---- Homepage / browse ----
router.get('/', async (req, res, next) => {
  try {
    const search = (req.query.q || '').trim();
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;

    const conditions = [`status = 'published'`];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(title ILIKE $${params.length} OR game_name ILIKE $${params.length})`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    const where = conditions.join(' AND ');

    const featuredQ = query(
      `SELECT scripts.*, users.username FROM scripts
       JOIN users ON users.id = scripts.user_id
       WHERE status = 'published' AND featured = TRUE
       ORDER BY created_at DESC LIMIT 6`
    );

    const listQ = query(
      `SELECT scripts.*, users.username FROM scripts
       JOIN users ON users.id = scripts.user_id
       WHERE ${where}
       ORDER BY created_at DESC LIMIT 60`,
      params
    );

    const [featured, list] = await Promise.all([featuredQ, listQ]);

    res.render('home', {
      title: 'luvenn — Roblox script hub',
      scripts: list.rows,
      featured: featured.rows,
      search,
      category,
      categories: CATEGORIES,
      timeAgo,
    });
  } catch (err) {
    next(err);
  }
});

// ---- Script detail page (humans) ----
router.get('/script/:publicId', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT scripts.*, users.username FROM scripts
       JOIN users ON users.id = scripts.user_id
       WHERE public_id = $1`,
      [req.params.publicId]
    );
    const script = rows[0];

    if (!script || (script.status !== 'published' && (!req.user || (req.user.id !== script.user_id && !req.user.is_admin)))) {
      return res.status(404).render('error', { title: 'Not found', message: 'That script does not exist or is no longer available.' });
    }

    query('UPDATE scripts SET views = views + 1 WHERE id = $1', [script.id]).catch(() => {});

    const loadstring = `loadstring(game:HttpGet("${process.env.SITE_URL || 'https://luvenn.xyz'}/raw/${script.public_id}.lua"))()`;

    res.render('script', {
      title: `${script.title} — luvenn`,
      script,
      loadstring,
      timeAgo,
      canManage: req.user && (req.user.id === script.user_id || req.user.is_admin),
    });
  } catch (err) {
    next(err);
  }
});

// ---- Raw script serving: gated to non-browser (executor) User-Agents ----
router.get('/raw/:publicId.lua', rawFetchLimiter, async (req, res, next) => {
  try {
    const ua = req.get('User-Agent') || '';

    if (looksLikeBrowser(ua)) {
      return res.status(403).type('text/plain').send('403 Forbidden');
    }

    const { rows } = await query(
      `SELECT id, code, status FROM scripts WHERE public_id = $1`,
      [req.params.publicId]
    );
    const script = rows[0];

    if (!script || script.status !== 'published') {
      return res.status(404).type('text/plain').send('-- script not found');
    }

    query('UPDATE scripts SET fetches = fetches + 1 WHERE id = $1', [script.id]).catch(() => {});

    res.type('text/plain').send(script.code);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
