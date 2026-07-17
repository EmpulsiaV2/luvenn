// Run once: `node db/migrate.js` (or `npm run migrate`)
// Applies schema.sql to your Neon database. Safe to re-run (uses IF NOT EXISTS).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./index');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('[luvenn] Applying schema to database...');
  await pool.query(sql);
  console.log('[luvenn] Schema applied successfully.');
  await pool.end();
}

main().catch((err) => {
  console.error('[luvenn] Migration failed:', err);
  process.exit(1);
});
