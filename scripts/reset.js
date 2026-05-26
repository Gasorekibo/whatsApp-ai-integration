/**
 * scripts/reset.js
 *
 * Wipes the database completely and rebuilds from scratch.
 * USE ONLY IN DEVELOPMENT — never run against production.
 */
import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.env.NODE_ENV === 'production') {
  console.error('❌  Refusing to reset a production database. Aborting.');
  process.exit(1);
}

const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl });

const MIGRATIONS = [
  '008_rename_client_id_to_tenant_id.sql',
  '001_rls_policies.sql',
  '002_add_language_to_user_sessions.sql',
  '003_session_intent_state.sql',
  '004_create_client_general_info.sql',
  '005_create_form_tokens.sql',
  '006_add_require_deposit_before_booking.sql',
  '007_add_booking_types.sql',
];

async function reset() {
  await client.connect();
  console.log('✓ Connected to database\n');

  // ── 1. Drop all tables ──────────────────────────────────────────────────────
  console.log('Dropping all tables...');
  await client.query(`
    DROP TABLE IF EXISTS
      form_tokens,
      client_general_info,
      processed_messages,
      service_requests,
      content,
      employees,
      user_sessions,
      clients
    CASCADE;
  `);
  console.log('✓ All tables dropped\n');

  // ── 2. Recreate schema via Sequelize sync ───────────────────────────────────
  // Import here so dotenv is already loaded
  console.log('Recreating schema via Sequelize...');
  const { default: dbConfig } = await import('../src/models/index.js');
  await dbConfig.syncDatabase();
  console.log('✓ Schema recreated\n');

  // ── 3. Run migrations ───────────────────────────────────────────────────────
  console.log('Running migrations...');
  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(__dirname, '../src/migrations', file), 'utf8');
    await client.query(sql);
    console.log(`  ✓ ${file}`);
  }

  console.log('\n✅  Database reset complete. Ready for fresh testing.');
  await client.end();
  process.exit(0);
}

reset().catch(err => {
  console.error('\n❌  Reset failed:', err.message);
  client.end().catch(() => {});
  process.exit(1);
});
