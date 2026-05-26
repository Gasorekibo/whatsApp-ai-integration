/**
 * scripts/seed-tenant-credentials.js
 *
 * One-time script to populate WhatsApp credentials on tenant client records.
 * Run with: node --env-file=.env.clinic scripts/seed-tenant-credentials.js
 *           node --env-file=.env.resto  scripts/seed-tenant-credentials.js
 */

import 'dotenv/config';
import CryptoJS from 'crypto-js';
import pg from 'pg';

const { Client } = pg;

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const TENANT_ID      = process.env.TENANT_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

if (!ENCRYPTION_KEY || !TENANT_ID || !WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) {
  console.error('Missing required env vars. Make sure you ran with --env-file=.env.<tenant>');
  console.error({ ENCRYPTION_KEY: !!ENCRYPTION_KEY, TENANT_ID, WHATSAPP_TOKEN: !!WHATSAPP_TOKEN, WHATSAPP_PHONE_ID });
  process.exit(1);
}

const encryptedToken = CryptoJS.AES.encrypt(WHATSAPP_TOKEN, ENCRYPTION_KEY).toString();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

await client.connect();

const result = await client.query(
  `UPDATE clients
   SET whatsapp_business_id = $1,
       whatsapp_token       = $2,
       updated_at           = NOW()
   WHERE id = $3
   RETURNING id, name, whatsapp_business_id`,
  [WHATSAPP_PHONE_ID, encryptedToken, TENANT_ID]
);

if (result.rowCount === 0) {
  console.error(`No client found with id=${TENANT_ID}`);
} else {
  const row = result.rows[0];
  console.log(`Updated: ${row.name} (${row.id})`);
  console.log(`  whatsapp_business_id = ${row.whatsapp_business_id}`);
  console.log(`  whatsapp_token       = [encrypted]`);
}

await client.end();
