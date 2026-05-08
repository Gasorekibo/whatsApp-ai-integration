import express from 'express';
const router = express.Router();
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';
import { invalidateClient } from '../services/clientService.js';
import { requireAdmin } from '../middlewares/auth.js';

// GET /services — authenticated users; clients see only their own services
router.get('/services', async (req, res) => {
  try {
    const where = {};
    if (req.user.role === 'client') {
      where.clientId = req.user.clientId;
    } else if (req.query.clientId) {
      where.clientId = req.query.clientId;
    }
    const services = await dbConfig.db.Content?.findAll({ where });
    res.json(services || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await dbConfig.db.UserSession?.findAll();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/appointments', async (req, res) => {
  try {
    const where = req.user.role === 'client' ? { clientId: req.user.clientId } : {};
    const appointments = await dbConfig.db.ServiceRequest?.findAll({ where, order: [['createdAt', 'DESC']] });
    res.json({ appointments: appointments || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/clients', async (req, res) => {
  try {
    if (req.user.role === 'client') {
      const client = await dbConfig.db.Client?.findByPk(req.user.clientId);
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
      name, email, phone, company, password,
      whatsappBusinessId, whatsappToken, whatsappAccountId, whatsappWebhookVerifyToken, whatsappToNumber,
      geminiApiKey, pineconeIndex, pineconeApiKey, pineconeIndexName, pineconeEnvironment,
      flutterwaveSecretKey, flutterwaveWebhookSecret,
      googleSheetId, googleSheetsWebhookToken,
      microsoftClientId, microsoftObjectId, microsoftTenantId, microsoftClientSecret, microsoftUserEmail, microsoftDriveId, microsoftItemId,
      confluenceBaseUrl, confluenceEmail, confluenceApiToken, confluenceSpaceKey,
      subscriptionPlan
    } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ error: 'name, email, and phone are required' });
    }

    const client = await dbConfig.db.Client.create({
      name, email, phone,
      company:                    company                    || null,
      password:                   password                   || null,
      subscriptionPlan:           subscriptionPlan           || 'message_only',
      whatsappBusinessId:         whatsappBusinessId         || null,
      whatsappToken:              whatsappToken              || null,
      whatsappAccountId:          whatsappAccountId          || null,
      whatsappWebhookVerifyToken: whatsappWebhookVerifyToken || null,
      whatsappToNumber:           whatsappToNumber           || null,
      geminiApiKey:               geminiApiKey               || null,
      pineconeIndex:              pineconeIndex              || null,
      pineconeApiKey:             pineconeApiKey             || null,
      pineconeIndexName:          pineconeIndexName          || null,
      pineconeEnvironment:        pineconeEnvironment        || null,
      flutterwaveSecretKey:       flutterwaveSecretKey       || null,
      flutterwaveWebhookSecret:   flutterwaveWebhookSecret   || null,
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
    res.status(500).json({ error: error?.errors[0]?.message || error.message });
  }
});

router.put('/clients/:id', requireAdmin, async (req, res) => {
  try {
    const client = await dbConfig.db.Client?.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const allowed = [
      'name', 'email', 'phone', 'company', 'timezone', 'currency', 'depositAmount', 'paymentRedirectUrl', 'companyName',
      'subscriptionPlan', 'subscriptionStatus', 'subscriptionEndDate', 'isActive', 'messageCount', 'maxMonthlyMessages',
      'whatsappBusinessId', 'whatsappToken', 'whatsappAccountId', 'whatsappWebhookVerifyToken', 'whatsappToNumber',
      'geminiApiKey', 'pineconeIndex', 'pineconeApiKey', 'pineconeIndexName', 'pineconeEnvironment',
      'flutterwaveSecretKey', 'flutterwaveWebhookSecret',
      'googleSheetId', 'googleSheetsWebhookToken',
      'microsoftClientId', 'microsoftObjectId', 'microsoftTenantId', 'microsoftClientSecret', 'microsoftUserEmail', 'microsoftDriveId', 'microsoftItemId',
      'confluenceBaseUrl', 'confluenceEmail', 'confluenceApiToken', 'confluenceSpaceKey',
      'password'
    ];
    const updates = {};
    allowed.forEach(field => { if (req.body[field] !== undefined) updates[field] = req.body[field]; });

    client.set(updates);

    // Force-mark encrypted fields as changed so the beforeUpdate hook always re-encrypts them,
    // even when the incoming plaintext value matches what's already stored.
    const encryptedFields = ['whatsappToken', 'geminiApiKey', 'pineconeApiKey', 'flutterwaveSecretKey', 'flutterwaveWebhookSecret', 'microsoftClientSecret', 'confluenceApiToken'];
    encryptedFields.forEach(f => { if (updates[f] !== undefined) client.changed(f, true); });

    await client.save();

    if (client.whatsappBusinessId) await invalidateClient(client.whatsappBusinessId);

    res.json({ client });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/employees', requireAdmin, async (req, res) => {
  try {
    const employees = await dbConfig.db.Employee?.findAll({
      attributes: ['id', 'name', 'email', 'createdAt'],
      order: [['createdAt', 'DESC']]
    });
    res.json({ employees: employees || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
