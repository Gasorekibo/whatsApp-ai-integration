import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS = [
  '008_rename_client_id_to_tenant_id.sql', // must run before 001 — policies reference tenant_id
  '001_rls_policies.sql',
  '002_add_language_to_user_sessions.sql',
  '003_session_intent_state.sql',
  '004_create_client_general_info.sql',
  '005_create_form_tokens.sql',
  '006_add_require_deposit_before_booking.sql',
  '007_add_booking_types.sql',
];

const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl });

async function run() {
  await client.connect();
  console.log('Connected to database');

  for (const file of MIGRATIONS) {
    const sql = readFileSync(join(__dirname, '../src/migrations', file), 'utf8');
    console.log(`Running ${file}...`);
    await client.query(sql);
    console.log(`  ✓ ${file} applied`);
  }

  await client.end();
  console.log('All migrations applied successfully');
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  client.end().catch(() => {});
  process.exit(1);
});
