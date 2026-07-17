const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('[luvenn] Missing DATABASE_URL environment variable. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[luvenn] Unexpected database error', err);
});

/**
 * Always use parameterized queries ($1, $2, ...) — never string-concatenate
 * user input into SQL. Every call site in this project follows that rule.
 */
async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
