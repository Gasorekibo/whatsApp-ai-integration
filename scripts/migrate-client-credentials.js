/**
 * Migration: add all per-client credential columns to the clients table.
 * Also provides a --fresh flag to wipe all tenant data for a clean start.
 *
 * NOTE: underscored:true is set in database config, so all column names here
 * must be snake_case to match what Sequelize generates.
 *
 * Usage:
 *   node scripts/migrate-client-credentials.js           # add columns only
 *   node scripts/migrate-client-credentials.js --fresh   # add columns + wipe data
 */

import { Sequelize, DataTypes } from 'sequelize';
import dotenv from 'dotenv';
dotenv.config();

const FRESH = process.argv.includes('--fresh');

const sequelize = new Sequelize(process.env.PG_DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }
});

const qi = sequelize.getQueryInterface();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function addCol(table, column, type) {
  try {
    await qi.addColumn(table, column, { type, allowNull: true });
    console.log(`  ✓ ${table}.${column}`);
  } catch (err) {
    if (err.message?.includes('already exists')) {
      console.log(`  – ${table}.${column} (already exists, skipped)`);
    } else {
      throw err;
    }
  }
}

async function dropCol(table, column) {
  try {
    await qi.removeColumn(table, column);
    console.log(`  🗑  dropped ${table}.${column}`);
  } catch {
    // column may not exist — ignore
  }
}

async function truncate(table) {
  await sequelize.query(`TRUNCATE TABLE "${table}" CASCADE`);
  console.log(`  🗑  ${table} cleared`);
}

// ── Migration ─────────────────────────────────────────────────────────────────

async function migrate() {
  await sequelize.authenticate();
  console.log('\n✅ Connected to database\n');

  // Drop old camelCase columns that the previous (broken) migration added
  console.log('▶ Removing old camelCase columns (if any)...');
  const stale = [
    'whatsappAccountId','whatsappWebhookVerifyToken','whatsappToNumber',
    'pineconeApiKey','pineconeIndexName','pineconeEnvironment',
    'flutterwaveSecretKey','flutterwaveWebhookSecret',
    'googleSheetId','googleSheetsWebhookToken',
    'microsoftClientId','microsoftObjectId','microsoftTenantId',
    'microsoftClientSecret','microsoftUserEmail','microsoftDriveId','microsoftItemId',
    'confluenceBaseUrl','confluenceEmail','confluenceApiToken','confluenceSpaceKey',
  ];
  for (const col of stale) await dropCol('clients', col);

  // ── WhatsApp extras ────────────────────────────────────────────────────────
  console.log('\n▶ WhatsApp extras');
  await addCol('clients', 'whatsapp_account_id',            DataTypes.STRING);
  await addCol('clients', 'whatsapp_webhook_verify_token',  DataTypes.STRING);
  await addCol('clients', 'whatsapp_to_number',             DataTypes.STRING);

  // ── AI / Pinecone ──────────────────────────────────────────────────────────
  console.log('\n▶ Pinecone');
  await addCol('clients', 'pinecone_api_key',      DataTypes.TEXT);
  await addCol('clients', 'pinecone_index_name',   DataTypes.STRING);
  await addCol('clients', 'pinecone_environment',  DataTypes.STRING);

  // ── Payments — Flutterwave ─────────────────────────────────────────────────
  console.log('\n▶ Flutterwave');
  await addCol('clients', 'flutterwave_secret_key',      DataTypes.TEXT);
  await addCol('clients', 'flutterwave_webhook_secret',  DataTypes.TEXT);

  // ── Google Sheets ──────────────────────────────────────────────────────────
  console.log('\n▶ Google Sheets');
  await addCol('clients', 'google_sheet_id',              DataTypes.STRING);
  await addCol('clients', 'google_sheets_webhook_token',  DataTypes.STRING);

  // ── Microsoft Excel ────────────────────────────────────────────────────────
  console.log('\n▶ Microsoft Excel');
  await addCol('clients', 'microsoft_client_id',      DataTypes.STRING);
  await addCol('clients', 'microsoft_object_id',      DataTypes.STRING);
  await addCol('clients', 'microsoft_tenant_id',      DataTypes.STRING);
  await addCol('clients', 'microsoft_client_secret',  DataTypes.TEXT);
  await addCol('clients', 'microsoft_user_email',     DataTypes.STRING);
  await addCol('clients', 'microsoft_drive_id',       DataTypes.STRING);
  await addCol('clients', 'microsoft_item_id',        DataTypes.STRING);

  // ── Confluence ─────────────────────────────────────────────────────────────
  console.log('\n▶ Confluence');
  await addCol('clients', 'confluence_base_url',   DataTypes.STRING);
  await addCol('clients', 'confluence_email',      DataTypes.STRING);
  await addCol('clients', 'confluence_api_token',  DataTypes.TEXT);
  await addCol('clients', 'confluence_space_key',  DataTypes.STRING);

  console.log('\n✅ Column migration complete\n');

  // ── Fresh start ────────────────────────────────────────────────────────────
  if (FRESH) {
    console.log('▶ --fresh flag detected — wiping all tenant data...\n');

    const tables = [
      'service_requests',
      'user_sessions',
      'processed_messages',
      'contents',
      'employees',
      'clients',
    ];

    for (const t of tables) {
      try {
        await truncate(t);
      } catch (err) {
        console.log(`  ⚠  ${t}: ${err.message}`);
      }
    }

    console.log('\n✅ All data wiped. Ready for fresh onboarding.\n');
  }
}

migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  });
