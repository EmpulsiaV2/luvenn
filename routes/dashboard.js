const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { publishLimiter, authLimiter } = require('../middleware/security');
const { generatePublicId, CATEGORIES, timeAgo, bumpPatchVersion } = require('../utils');
const { obfuscate } = require('../lib/obfuscate');

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

// Builds a 30-day zero-filled daily execution series for the chart.
async function buildExecutionSeries(userId) {
  const { rows } = await query(
    `SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS cnt
     FROM fetch_events
     WHERE user_id = $1 AND event_type = 'fetch' AND created_at >= now() - interval '29 days'
     GROUP BY day`,
    [userId]
  );
  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r.cnt]));

  const series = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    series.push({ date: d, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, count: byDay.get(key) || 0 });
  }
  return series;
}

// ---- Dashboard: overview + script table in one page ----
router.get('/dashboard', async (req, res, next) => {
  try {
    const { rows: statRows } = await query(
      `SELECT
         COUNT(*) AS script_count,
         COALESCE(SUM(views),0) AS total_views,
         COALESCE(SUM(fetches),0) AS total_fetches,
         COALESCE(SUM(blocked_attempts),0) AS total_blocked
       FROM scripts WHERE user_id = $1`,
      [req.user.id]
    );

    const { rows: scripts } = await query(
      `SELECT * FROM scripts WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );

    const series = await buildExecutionSeries(req.user.id);
    const monthTotal = series.reduce((sum, p) => sum + p.count, 0);

    res.render('account_dashboard', {
      title: 'Dashboard',
      stats: statRows[0],
      scripts,
      series,
      monthTotal,
      timeAgo,
    });
  } catch (err) {
    next(err);
  }
});

// ---- Add script ----
router.get('/dashboard/new', (req, res) => {
  const presetKey = req.query.key === '1';
  res.render('script_form', {
    title: 'Add script',
    mode: 'create',
    script: presetKey ? { has_key_system: true } : null,
    error: null,
    categories: CATEGORIES,
  });
});

router.post('/dashboard/new', publishLimiter, async (req, res, next) => {
  try {
    const data = sanitizeScriptInput(req.body);

    if (!data.title) {
      return res.render('script_form', { title: 'Add script', mode: 'create', script: req.body, error: 'A title is required.', categories: CATEGORIES });
    }
    if (!data.code || data.code.trim().length < 5) {
      return res.render('script_form', { title: 'Add script', mode: 'create', script: req.body, error: 'Script code cannot be empty.', categories: CATEGORIES });
    }
    if (data.code.length > 200000) {
      return res.render('script_form', { title: 'Add script', mode: 'create', script: req.body, error: 'Script is too large (max ~200KB).', categories: CATEGORIES });
    }

    let publicId = generatePublicId();
    for (let i = 0; i < 3; i++) {
      const clash = await query('SELECT 1 FROM scripts WHERE public_id = $1', [publicId]);
      if (clash.rows.length === 0) break;
      publicId = generatePublicId();
    }

    const protectedCode = obfuscate(data.code);

    await query(
      `INSERT INTO scripts (public_id, user_id, title, description, game_name, game_id, category, code, protected_code, version, has_key_system, key_link)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'0.0.1',$10,$11)`,
      [publicId, req.user.id, data.title, data.description, data.gameName, data.gameId, data.category, data.code, protectedCode, data.hasKeySystem, data.keyLink]
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
    if (!script || script.user_id !== req.user.id) {
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

    const protectedCode = obfuscate(data.code);
    const newVersion = bumpPatchVersion(req.script.version);

    await query(
      `UPDATE scripts SET title=$1, description=$2, game_name=$3, game_id=$4, category=$5, code=$6, protected_code=$7, version=$8, has_key_system=$9, key_link=$10, updated_at=now()
       WHERE id = $11`,
      [data.title, data.description, data.gameName, data.gameId, data.category, data.code, protectedCode, newVersion, data.hasKeySystem, data.keyLink, req.script.id]
    );

    res.redirect('/dashboard');
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

// ---- Profile ----
router.get('/dashboard/profile', (req, res) => {
  res.render('profile', { title: 'Profile', error: null, success: null });
});

router.post('/dashboard/profile/password', authLimiter, async (req, res, next) => {
  try {
    const { current_password, new_password, confirm_password } = req.body;

    if (!current_password || !new_password || !confirm_password) {
      return res.render('profile', { title: 'Profile', error: 'All fields are required.', success: null });
    }
    if (new_password.length < 8) {
      return res.render('profile', { title: 'Profile', error: 'New password must be at least 8 characters.', success: null });
    }
    if (new_password !== confirm_password) {
      return res.render('profile', { title: 'Profile', error: 'New passwords do not match.', success: null });
    }

    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const ok = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!ok) {
      return res.render('profile', { title: 'Profile', error: 'Current password is incorrect.', success: null });
    }

    const newHash = await bcrypt.hash(new_password, 12);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);

    res.render('profile', { title: 'Profile', error: null, success: 'Password updated.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
