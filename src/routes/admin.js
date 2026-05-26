import express from 'express';
import crypto from 'crypto';
const router = express.Router();
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';
import { getTenant } from '../services/clientService.js';
import { requireAdmin } from '../middlewares/auth.js';
import { invalidateGeneralInfoCache } from '../services/generalInfo.service.js';

// GET /services — authenticated users; clients see only their own services
router.get('/services', async (req, res) => {
  try {
    // RLS already filters by tenant_id via app.tenant_id session variable —
    // this WHERE is a belt-and-suspenders guard for non-RLS queries.
    const where = {};
    if (req.user.role === 'client') {
      where.tenantId = req.user.tenantId;
    }
    const services = await dbConfig.db.Content?.findAll({ where });
    res.json(services || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await dbConfig.db.UserSession?.findAll({
      include: [{
        model: dbConfig.db.Client,
        attributes: ['name'],
        required: false
      }],
      order: [['lastAccess', 'DESC']]
    });
    res.json({ users: users || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/appointments', async (req, res) => {
  try {
    const where = req.user.role === 'client' ? { tenantId: req.user.tenantId } : {};
    const appointments = await dbConfig.db.ServiceRequest?.findAll({ where, include: [{
        model: dbConfig.db.Client,
        attributes: ['name'],
        required: false
      }],
      order: [['createdAt', 'DESC']],
     });
    res.json({ appointments: appointments || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/clients', async (req, res) => {
  try {
    if (req.user.role === 'client') {
      const client = await dbConfig.db.Client?.findByPk(req.user.tenantId);
      return res.json({ clients: client ? [client] : [] });
    }
    const clients = await dbConfig.db.Client?.findAll({ order: [['createdAt', 'DESC']] });
    res.json({ clients: clients || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/clients', requireAdmin, async (req, res) => {
  try {
    const {
      // ── Core identity (required) ─────────────────────────────────────
      name, email, phone, password,
      // ── WhatsApp (required — system cannot route messages without these) ──
      whatsappBusinessId, whatsappToken,
      // ── Knowledge base (required — isolates each client's vector data) ──
      pineconeIndex,
      // ── Optional identity ────────────────────────────────────────────
      botName,
      // ── Optional WhatsApp extras ─────────────────────────────────────
      whatsappAccountId, whatsappWebhookVerifyToken,
      // ── Optional AI ──────────────────────────────────────────────────
      geminiApiKey, pineconeApiKey, pineconeIndexName, pineconeEnvironment,
      // ── Optional subscription & config ───────────────────────────────
      subscriptionPlan, timezone, currency, depositAmount, paymentRedirectUrl,
      requireDepositBeforeBooking, bookingTypes,
      // ── Optional payments ────────────────────────────────────────────
      flutterwaveSecretKey, flutterwaveWebhookSecret,
      // ── Optional knowledge base integrations ─────────────────────────
      googleSheetId, googleSheetsWebhookToken,
      microsoftClientId, microsoftObjectId, microsoftTenantId,
      microsoftClientSecret, microsoftUserEmail, microsoftDriveId, microsoftItemId,
      confluenceBaseUrl, confluenceEmail, confluenceApiToken, confluenceSpaceKey,
    } = req.body;

    // ── Required field validation ─────────────────────────────────────────
    // Every field here is load-bearing: omitting any one of them will cause
    // the bot to fail or produce incorrect behaviour for this client.
    const missing = [];

    // ── Identity & portal access ──────────────────────────────────────────
    if (!name?.trim())
      missing.push({ field: 'name',     message: 'Client name is required' });
    if (!email?.trim())
      missing.push({ field: 'email',    message: 'Email is required for portal login' });
    if (!phone?.trim())
      missing.push({ field: 'phone',    message: 'Phone number is required' });
    if (!password?.trim())
      missing.push({ field: 'password', message: 'Password is required so the client can log into the portal' });

    // ── Knowledge base ────────────────────────────────────────────────────
    if (!pineconeIndex?.trim())
      missing.push({ field: 'pineconeIndex', message: 'Pinecone namespace is required to isolate this client\'s knowledge base from other clients' });

    if (missing.length > 0) {
      return res.status(400).json({ error: 'Missing required fields', missing });
    }

    // ── Uniqueness pre-checks (return clean errors before DB constraint fires) ──
    const [existingEmail, existingPhone, existingWaId] = await Promise.all([
      dbConfig.db.Client.findOne({ where: { email } }),
      dbConfig.db.Client.findOne({ where: { phone } }),
      dbConfig.db.Client.findOne({ where: { whatsappBusinessId } })
    ]);

    const conflicts = [];
    if (existingEmail) conflicts.push({ field: 'email',              message: `Email '${email}' is already registered to another client` });
    if (existingPhone) conflicts.push({ field: 'phone',              message: `Phone '${phone}' is already registered to another client` });
    if (existingWaId)  conflicts.push({ field: 'whatsappBusinessId', message: `WhatsApp Business ID '${whatsappBusinessId}' is already assigned to another client` });

    if (conflicts.length > 0) {
      return res.status(409).json({ error: 'Conflict: duplicate values', conflicts });
    }

    const client = await dbConfig.db.Client.create({
      // ── Required: identity & portal ──────────────────────────────────
      name, email, phone, password,
      // ── Required: WhatsApp ───────────────────────────────────────────
      whatsappBusinessId, whatsappToken,
      // ── Required: AI ────────────────────────────────────────────────
      geminiApiKey,
      // ── Required: knowledge base ─────────────────────────────────────
      pineconeIndex,
      // ── Required: localisation & subscription ────────────────────────
      timezone, currency, subscriptionPlan,
      // ── Optional: identity extras ────────────────────────────────────
      botName:                    botName                    || null,
      // ── Optional: WhatsApp extras ────────────────────────────────────
      whatsappAccountId:          whatsappAccountId          || null,
      whatsappWebhookVerifyToken: whatsappWebhookVerifyToken || null,
      // ── Optional: AI extras (fall back to server-level env vars) ─────
      pineconeApiKey:             pineconeApiKey             || null,
      pineconeIndexName:          pineconeIndexName          || null,
      pineconeEnvironment:        pineconeEnvironment        || null,
      // ── Optional: booking & payment ──────────────────────────────────
      depositAmount:              depositAmount              || null,
      paymentRedirectUrl:         paymentRedirectUrl         || null,
      requireDepositBeforeBooking: requireDepositBeforeBooking ?? false,
      bookingTypes:               bookingTypes               || ['calendar'],
      flutterwaveSecretKey:       flutterwaveSecretKey       || null,
      flutterwaveWebhookSecret:   flutterwaveWebhookSecret   || null,
      // ── Optional: knowledge base integrations ────────────────────────
      googleSheetId:              googleSheetId              || null,
      googleSheetsWebhookToken:   googleSheetsWebhookToken   || null,
      microsoftClientId:          microsoftClientId          || null,
      microsoftObjectId:          microsoftObjectId          || null,
      microsoftTenantId:          microsoftTenantId          || null,
      microsoftClientSecret:      microsoftClientSecret      || null,
      microsoftUserEmail:         microsoftUserEmail         || null,
      microsoftDriveId:           microsoftDriveId           || null,
      microsoftItemId:            microsoftItemId            || null,
      confluenceBaseUrl:          confluenceBaseUrl          || null,
      confluenceEmail:            confluenceEmail            || null,
      confluenceApiToken:         confluenceApiToken         || null,
      confluenceSpaceKey:         confluenceSpaceKey         || null,
    });

    res.status(201).json({ client });
  } catch (error) {
    res.status(500).json({ error: error?.errors?.[0]?.message || error.message });
  }
});

router.put('/clients/:id', requireAdmin, async (req, res) => {
  try {
    const client = await dbConfig.db.Client?.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const allowed = [
      'name', 'email', 'phone', 'botName', 'timezone', 'currency', 'depositAmount', 'paymentRedirectUrl',
      'requireDepositBeforeBooking', 'bookingTypes',
      'subscriptionPlan', 'subscriptionStatus', 'subscriptionEndDate', 'isActive', 'messageCount', 'maxMonthlyMessages',
      'whatsappBusinessId', 'whatsappToken', 'whatsappAccountId', 'whatsappWebhookVerifyToken',
      'geminiApiKey', 'pineconeIndex', 'pineconeApiKey', 'pineconeIndexName', 'pineconeEnvironment',
      'flutterwaveSecretKey', 'flutterwaveWebhookSecret',
      'googleSheetId', 'googleSheetsWebhookToken',
      'microsoftClientId', 'microsoftObjectId', 'microsoftTenantId', 'microsoftClientSecret', 'microsoftUserEmail', 'microsoftDriveId', 'microsoftItemId',
      'confluenceBaseUrl', 'confluenceEmail', 'confluenceApiToken', 'confluenceSpaceKey',
      'password'
    ];

    // Fields whose DB value is encrypted — the GET response masks them as '__ENCRYPTED__'.
    // If the client sends back the sentinel (or an empty string), the admin did not
    // intend to change the key, so we must NOT overwrite the stored ciphertext.
    const encryptedFields = new Set([
      'whatsappToken', 'geminiApiKey', 'pineconeApiKey',
      'flutterwaveSecretKey', 'flutterwaveWebhookSecret',
      'microsoftClientSecret', 'confluenceApiToken',
    ]);

    const updates = {};
    allowed.forEach(field => {
      if (req.body[field] === undefined) return;
      if (encryptedFields.has(field)) {
        // Skip if the frontend sent back the masked sentinel or left the field blank
        const v = req.body[field];
        if (!v || v === '__ENCRYPTED__') return;
      }
      updates[field] = req.body[field];
    });

    client.set(updates);

    // Force-mark encrypted fields as changed so the beforeUpdate hook always re-encrypts
    // the new plaintext value — only when the admin actually supplied a new one.
    encryptedFields.forEach(f => { if (updates[f] !== undefined) client.changed(f, true); });

    await client.save();

    // No cache to invalidate — per-tenant containers read TENANT_ID from env.

    res.json({ client });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/employees', requireAdmin, async (req, res) => {
  try {
    const where = {};
    const employees = await dbConfig.db.Employee?.findAll({
      where,
      attributes: ['id', 'tenantId', 'name', 'email', 'createdAt'],
      include: [{ model: dbConfig.db.Client, attributes: ['name'], required: false }],
      order: [['createdAt', 'DESC']]
    });
    res.json({ employees: employees || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── General Info (read & write, scoped per client) ────────────────────────────

router.get('/general-info', async (req, res) => {
  try {
    const tenantId = req.user.role === 'client' ? req.user.tenantId : (req.query.tenantId || process.env.TENANT_ID);
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });

    const info = await dbConfig.db.ClientGeneralInfo.findOne({ where: { tenantId } });
    res.json({ info: info || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/general-info', async (req, res) => {
  try {
    const tenantId = req.user.role === 'client' ? req.user.tenantId : (req.body.tenantId || process.env.TENANT_ID);
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });

    const allowed = ['businessName', 'industry', 'description', 'phone', 'email',
                     'website', 'address', 'area', 'city', 'mapsLink', 'hours', 'faqs'];
    const updates = {};
    allowed.forEach(field => { if (req.body[field] !== undefined) updates[field] = req.body[field]; });

    let info = await dbConfig.db.ClientGeneralInfo.findOne({ where: { tenantId } });
    if (info) {
      await info.update(updates);
    } else {
      info = await dbConfig.db.ClientGeneralInfo.create({ tenantId, ...updates });
    }
    await invalidateGeneralInfoCache(tenantId);

    res.json({ info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Onboarding form token (generate / reuse) ──────────────────────────────────

router.post('/clients/:tenantId/form-token', requireAdmin, async (req, res) => {
  try {
    const { tenantId } = req.params;

    const client = await dbConfig.db.Client?.findByPk(tenantId);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Reuse an existing token that hasn't expired yet
    const existing = await dbConfig.db.FormToken.findOne({
      where: { tenantId, expiresAt: { [dbConfig.db.Sequelize.Op.gt]: new Date() } },
      order: [['createdAt', 'DESC']],
    });

    if (existing) {
      const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
      return res.json({ token: existing.token, url: `${baseUrl}/onboarding/${existing.token}`, expiresAt: existing.expiresAt });
    }

    await dbConfig.db.FormToken.destroy({ where: { tenantId } });

    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await dbConfig.db.FormToken.create({ token, tenantId, expiresAt });

    const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    logger.info('Form token generated', { tenantId, expiresAt });
    res.status(201).json({ token, url: `${baseUrl}/onboarding/${token}`, expiresAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
