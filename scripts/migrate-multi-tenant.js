/**
 * One-time migration: add multi-tenant columns to existing tables.
 * Safe to run multiple times — skips columns that already exist.
 *
 * Usage:  node scripts/migrate-multi-tenant.js
 */

import { Sequelize, DataTypes } from 'sequelize';
import dotenv from 'dotenv';
dotenv.config();

const sequelize = new Sequelize(process.env.PG_DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } }
});

const qi = sequelize.getQueryInterface();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function addColumnIfMissing(table, column, definition) {
  try {
    await qi.addColumn(table, column, definition);
    console.log(`  ✓ ${table}.${column} added`);
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log(`  – ${table}.${column} already exists, skipped`);
    } else {
      throw err;
    }
  }
}

async function addIndexIfMissing(table, fields, options) {
  try {
    await qi.addIndex(table, fields, options);
    console.log(`  ✓ index ${options.name} added`);
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log(`  – index ${options.name} already exists, skipped`);
    } else {
      throw err;
    }
  }
}

async function dropIndexIfExists(table, indexName) {
  try {
    await qi.removeIndex(table, indexName);
    console.log(`  ✓ old index ${indexName} dropped`);
  } catch (err) {
    // Index didn't exist — that's fine
    console.log(`  – index ${indexName} not found, skipped`);
  }
}

// ── Migration steps ───────────────────────────────────────────────────────────

async function run() {
  await sequelize.authenticate();
  console.log('Connected.\n');

  // ── 1. clients — per-client business config ──────────────────────────────
  console.log('clients table:');
  await addColumnIfMissing('clients', 'company_name',         { type: DataTypes.STRING,  allowNull: true });
  await addColumnIfMissing('clients', 'timezone',             { type: DataTypes.STRING,  allowNull: false, defaultValue: 'Africa/Kigali' });
  await addColumnIfMissing('clients', 'payment_redirect_url', { type: DataTypes.STRING,  allowNull: true });
  await addColumnIfMissing('clients', 'currency',             { type: DataTypes.STRING,  allowNull: false, defaultValue: 'RWF' });
  await addColumnIfMissing('clients', 'deposit_amount',       { type: DataTypes.INTEGER, allowNull: true });

  // ── 2. user_sessions — scope sessions per client ─────────────────────────
  console.log('\nuser_sessions table:');
  await addColumnIfMissing('user_sessions', 'client_id', { type: DataTypes.UUID, allowNull: true });

  // Drop the old single-column unique on phone (it blocks multi-tenant same number)
  await dropIndexIfExists('user_sessions', 'user_sessions_phone_key');
  // Also try the Sequelize-generated name variant
  await dropIndexIfExists('user_sessions', 'user_sessions_phone');

  await addIndexIfMissing('user_sessions', ['client_id', 'phone'], {
    unique: true,
    name: 'idx_user_sessions_client_phone'
  });

  // ── 3. service_requests — scope bookings per client ───────────────────────
  console.log('\nservice_requests table:');
  await addColumnIfMissing('service_requests', 'client_id', { type: DataTypes.UUID, allowNull: true });

  // ── 4. content — scope services/FAQs per client ───────────────────────────
  console.log('\ncontent table:');
  await addColumnIfMissing('content', 'client_id', { type: DataTypes.UUID, allowNull: true });

  // ── 5. processed_messages — scope deduplication per client ────────────────
  console.log('\nprocessed_messages table:');
  await addColumnIfMissing('processed_messages', 'client_id', { type: DataTypes.UUID, allowNull: true });

  // Drop the old single-column unique on message_id
  await dropIndexIfExists('processed_messages', 'processed_messages_message_id_key');
  await dropIndexIfExists('processed_messages', 'processed_messages_message_id');

  await addIndexIfMissing('processed_messages', ['client_id', 'message_id'], {
    unique: true,
    name: 'idx_processed_messages_client_msg'
  });

  // ── 6. employees — scope employees per client ─────────────────────────────
  console.log('\nemployees table:');
  await addColumnIfMissing('employees', 'client_id', { type: DataTypes.UUID, allowNull: true });

  // Drop the old single-column unique on email
  await dropIndexIfExists('employees', 'employees_email_key');
  await dropIndexIfExists('employees', 'employees_email');

  await addIndexIfMissing('employees', ['client_id', 'email'], {
    unique: true,
    name: 'idx_employees_client_email'
  });

  console.log('\nMigration complete.');
  await sequelize.close();
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
