/**
 * scripts/router.js
 *
 * Local-only webhook router for multi-tenant testing.
 *
 * Runs on port 3000, receives a single ngrok webhook from Meta, then
 * forwards each request to the correct tenant instance based on:
 *   - POST /webhook → phoneNumberId in the payload
 *   - GET  /webhook → verifyToken in the query string
 *
 * Usage:
 *   node scripts/router.js
 *
 * Edit router.config.json to add/remove tenants.
 */

import express   from 'express';
import http      from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config    = JSON.parse(readFileSync(join(__dirname, '../router.config.json'), 'utf8'));

// ── Build lookup maps ─────────────────────────────────────────────────────────

const byPhoneId     = {};  // phoneNumberId → port
const byVerifyToken = {};  // verifyToken   → port

for (const tenant of config.tenants) {
  if (tenant.phoneNumberId) byPhoneId[tenant.phoneNumberId]     = tenant.port;
  if (tenant.verifyToken)   byVerifyToken[tenant.verifyToken]   = tenant.port;
  console.log(`  Tenant: ${tenant.name} | phone: ${tenant.phoneNumberId} | port: ${tenant.port}`);
}

// ── Proxy helper ──────────────────────────────────────────────────────────────

function forward(port, req, res, rawBody) {
  const body    = rawBody || '';
  const headers = { ...req.headers, host: `localhost:${port}` };
  if (body) headers['content-length'] = Buffer.byteLength(body);

  const proxyReq = http.request(
    { hostname: 'localhost', port, path: req.url, method: req.method, headers },
    proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', err => {
    console.error(`[router] Proxy error → port ${port}:`, err.message);
    if (!res.headersSent) res.status(502).send('Tenant instance not reachable');
  });

  if (body) proxyReq.write(body);
  proxyReq.end();
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();

// Capture raw body before JSON parsing so we can forward it unchanged
app.use((req, _res, next) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks).toString();
    try { req.body = JSON.parse(req.rawBody); } catch { req.body = {}; }
    next();
  });
});

// ── GET /webhook — Meta verification handshake ────────────────────────────────
app.get('/webhook', (req, res) => {
  const verifyToken = req.query['hub.verify_token'];
  const port        = byVerifyToken[verifyToken];

  if (!port) {
    console.warn(`[router] Unknown verify_token: "${verifyToken}"`);
    return res.status(403).send('Forbidden');
  }

  console.log(`[router] Verification → ${verifyToken} → port ${port}`);
  forward(port, req, res, '');
});

// ── POST /webhook — incoming WhatsApp messages ────────────────────────────────
app.post('/webhook', (req, res) => {
  const phoneNumberId = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;

  if (!phoneNumberId) {
    // Status updates and other non-message events may lack phone_number_id
    console.log('[router] No phoneNumberId in payload — returning 200');
    return res.status(200).send('OK');
  }

  const port = byPhoneId[phoneNumberId];

  if (!port) {
    console.warn(`[router] Unknown phoneNumberId: "${phoneNumberId}"`);
    return res.status(200).send('OK'); // Always 200 to Meta or it retries forever
  }

  console.log(`[router] ${phoneNumberId} → port ${port}`);
  forward(port, req, res, req.rawBody);
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = 3100;
app.listen(PORT, () => {
  console.log(`\n[router] Webhook router running on port ${PORT}`);
  console.log('[router] Waiting for incoming webhooks...\n');
});
