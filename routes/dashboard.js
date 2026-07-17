const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { publishLimiter } = require('../middleware/security');
const { generatePublicId, CATEGORIES, timeAgo } = require('../utils');

const router = express.Router();
router.use(requireAuth);

function sanitizeScriptInput(body) {
  const title = String(body.title || '').trim().slice(0, 80);
  const description = String(body.description || '').trim().slice(0, 500);
  const gameName = String(body.game_name || '').trim().slice(0, 100);
  const gameId = String(body.game_id || '').trim().slice(0, 40);
  const category = CATEGORIES.includes(body.category) ? body.category : 'other';
  const code = String(body.code || '');
  const hasKeySystem = body.has_key_system === 'on' || body.has_key_system === 'true';
  const keyLink = hasKeySystem ? String(body.key_link || '').trim().slice(0, 300) : '';
  return { title, description, gameName, gameId, category, code, hasKeySystem, keyLink };
}

router.get('/dashboard', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM scripts WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.render('dashboard', { title: 'Dashboard', scripts: rows, timeAgo });
  } catch (err) {
    next(err);
  }
});

router.get('/dashboard/new', (req, res) => {
  res.render('script_form', { title: 'Publish a script', mode: 'create', script: null, error: null, categories: CATEGORIES });
});

router.post('/dashboard/new', publishLimiter, async (req, res, next) => {
  try {
    const data = sanitizeScriptInput(req.body);

    if (!data.title) {
      return res.render('script_form', { title: 'Publish a script', mode: 'create', script: req.body, error: 'A title is required.', categories: CATEGORIES });
    }
    if (!data.code || data.code.trim().length < 5) {
      return res.render('script_form', { title: 'Publish a script', mode: 'create', script: req.body, error: 'Script code cannot be empty.', categories: CATEGORIES });
    }
    if (data.code.length > 200000) {
      return res.render('script_form', { title: 'Publish a script', mode: 'create', script: req.body, error: 'Script is too large (max ~200KB).', categories: CATEGORIES });
    }

    let publicId = generatePublicId(10);
    // Extremely unlikely to collide, but guard anyway.
    for (let i = 0; i < 3; i++) {
      const clash = await query('SELECT 1 FROM scripts WHERE public_id = $1', [publicId]);
      if (clash.rows.length === 0) break;
      publicId = generatePublicId(10);
    }

    await query(
      `INSERT INTO scripts (public_id, user_id, title, description, game_name, game_id, category, code, has_key_system, key_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [publicId, req.user.id, data.title, data.description, data.gameName, data.gameId, data.category, data.code, data.hasKeySystem, data.keyLink]
    );

    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
});

async function loadOwnedScript(req, res, next) {
  try {
    const { rows } = await query('SELECT * FROM scripts WHERE id = $1', [req.params.id]);
    const script = rows[0];
    if (!script || (script.user_id !== req.user.id && !req.user.is_admin)) {
      return res.status(404).render('error', { title: 'Not found', message: 'Script not found.' });
    }
    req.script = script;
    next();
  } catch (err) {
    next(err);
  }
}

router.get('/dashboard/edit/:id', loadOwnedScript, (req, res) => {
  res.render('script_form', { title: 'Edit script', mode: 'edit', script: req.script, error: null, categories: CATEGORIES });
});

router.post('/dashboard/edit/:id', loadOwnedScript, async (req, res, next) => {
  try {
    const data = sanitizeScriptInput(req.body);

    if (!data.title) {
      return res.render('script_form', { title: 'Edit script', mode: 'edit', script: { ...req.script, ...req.body }, error: 'A title is required.', categories: CATEGORIES });
    }
    if (!data.code || data.code.trim().length < 5) {
      return res.render('script_form', { title: 'Edit script', mode: 'edit', script: { ...req.script, ...req.body }, error: 'Script code cannot be empty.', categories: CATEGORIES });
    }

    await query(
      `UPDATE scripts SET title=$1, description=$2, game_name=$3, game_id=$4, category=$5, code=$6, has_key_system=$7, key_link=$8, updated_at=now()
       WHERE id = $9`,
      [data.title, data.description, data.gameName, data.gameId, data.category, data.code, data.hasKeySystem, data.keyLink, req.script.id]
    );

    res.redirect('/script/' + req.script.public_id);
  } catch (err) {
    next(err);
  }
});

router.post('/dashboard/delete/:id', loadOwnedScript, async (req, res, next) => {
  try {
    await query('DELETE FROM scripts WHERE id = $1', [req.script.id]);
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
});

router.post('/dashboard/toggle-status/:id', loadOwnedScript, async (req, res, next) => {
  try {
    const newStatus = req.script.status === 'published' ? 'pending' : 'published';
    await query('UPDATE scripts SET status = $1 WHERE id = $2', [newStatus, req.script.id]);
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
