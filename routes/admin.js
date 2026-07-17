const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { timeAgo } = require('../utils');

const router = express.Router();

// Every /admin* route requires an authenticated admin. There is no separate
// admin login page — if your account has is_admin = TRUE in the database,
// logging in normally on / is enough to reach this panel.
router.use('/admin', requireAdmin);

async function navCounts() {
  const { rows } = await query(`SELECT
      (SELECT COUNT(*) FROM scripts) AS scripts,
      (SELECT COUNT(*) FROM scripts WHERE has_key_system = TRUE) AS key_scripts,
      (SELECT COUNT(*) FROM users) AS users
  `);
  return rows[0];
}

router.get('/admin', async (req, res, next) => {
  try {
    const { rows: statRows } = await query(`SELECT
        (SELECT COUNT(*) FROM users) AS user_count,
        (SELECT COUNT(*) FROM users WHERE is_banned = TRUE) AS banned_count,
        (SELECT COUNT(*) FROM scripts) AS script_count,
        (SELECT COUNT(*) FROM scripts WHERE status = 'published') AS published_count,
        (SELECT COUNT(*) FROM scripts WHERE status = 'pending') AS pending_count,
        (SELECT COUNT(*) FROM scripts WHERE has_key_system = TRUE) AS key_count,
        (SELECT COALESCE(SUM(fetches),0) FROM scripts) AS total_fetches,
        (SELECT COALESCE(SUM(views),0) FROM scripts) AS total_views
    `);

    const recentScripts = await query(
      `SELECT scripts.*, users.username FROM scripts
       JOIN users ON users.id = scripts.user_id
       ORDER BY created_at DESC LIMIT 6`
    );

    const recentUsers = await query(
      `SELECT id, username, is_admin, is_banned, created_at FROM users
       ORDER BY created_at DESC LIMIT 6`
    );

    res.render('admin_dashboard', {
      title: 'Admin overview',
      active: 'overview',
      stats: statRows[0],
      scripts: recentScripts.rows,
      users: recentUsers.rows,
      navCounts: await navCounts(),
      timeAgo,
    });
  } catch (err) {
    next(err);
  }
});

async function scriptCounts() {
  const { rows } = await query(`SELECT
      (SELECT COUNT(*) FROM scripts) AS all_count,
      (SELECT COUNT(*) FROM scripts WHERE status = 'published') AS published_count,
      (SELECT COUNT(*) FROM scripts WHERE status = 'pending') AS pending_count,
      (SELECT COUNT(*) FROM scripts WHERE has_key_system = TRUE) AS key_count
  `);
  return rows[0];
}

router.get('/admin/scripts', async (req, res, next) => {
  try {
    const filter = req.query.filter;
    const params = [];
    let where = '';
    if (['published', 'pending', 'removed'].includes(filter)) {
      params.push(filter);
      where = 'WHERE status = $1';
    } else if (filter === 'key') {
      where = 'WHERE has_key_system = TRUE';
    }
    const { rows } = await query(
      `SELECT scripts.*, users.username FROM scripts
       JOIN users ON users.id = scripts.user_id
       ${where}
       ORDER BY created_at DESC LIMIT 300`,
      params
    );
    res.render('admin_scripts', {
      title: 'Admin — Scripts',
      active: 'scripts',
      scripts: rows,
      filter: filter || 'all',
      counts: await scriptCounts(),
      navCounts: await navCounts(),
      timeAgo,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/scripts/:id/status', async (req, res, next) => {
  try {
    const status = ['published', 'pending', 'removed'].includes(req.body.status) ? req.body.status : 'pending';
    await query('UPDATE scripts SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.redirect('back');
  } catch (err) {
    next(err);
  }
});

router.post('/admin/scripts/:id/feature', async (req, res, next) => {
  try {
    await query('UPDATE scripts SET featured = NOT featured WHERE id = $1', [req.params.id]);
    res.redirect('back');
  } catch (err) {
    next(err);
  }
});

router.post('/admin/scripts/:id/delete', async (req, res, next) => {
  try {
    await query('DELETE FROM scripts WHERE id = $1', [req.params.id]);
    res.redirect('back');
  } catch (err) {
    next(err);
  }
});

router.get('/admin/users', async (req, res, next) => {
  try {
    const filter = req.query.filter;
    let where = '';
    if (filter === 'banned') where = 'WHERE is_banned = TRUE';
    if (filter === 'admins') where = 'WHERE is_admin = TRUE';

    const { rows } = await query(
      `SELECT users.*, (SELECT COUNT(*) FROM scripts WHERE scripts.user_id = users.id) AS script_count
       FROM users ${where} ORDER BY created_at DESC LIMIT 300`
    );
    const { rows: countRows } = await query(`SELECT
        (SELECT COUNT(*) FROM users) AS all_count,
        (SELECT COUNT(*) FROM users WHERE is_banned = TRUE) AS banned_count,
        (SELECT COUNT(*) FROM users WHERE is_admin = TRUE) AS admin_count
    `);
    res.render('admin_users', {
      title: 'Admin — Users',
      active: 'users',
      users: rows,
      filter: filter || 'all',
      counts: countRows[0],
      navCounts: await navCounts(),
      timeAgo,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/admin/users/:id/ban', async (req, res, next) => {
  try {
    if (Number(req.params.id) === req.user.id) return res.redirect('back');
    await query('UPDATE users SET is_banned = NOT is_banned WHERE id = $1', [req.params.id]);
    res.redirect('back');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
