import express from 'express';
const router = express.Router();
import initiateWhatsappMessage from '../controllers/initiateMessage.js';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';
import { invalidateClient } from '../services/clientService.js';

router.post('/template', async (req, res) => {
  const { templateName, clientId } = req.body;

  if (!clientId) return res.status(400).json({ error: "Missing 'clientId'" });
  if (!templateName) return res.status(400).json({ error: "Missing 'templateName'" });

  const client = await dbConfig.db.Client?.findByPk(clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const contacts = await fetch('http://localhost:3000/api/zoho/contacts')
    .then(response => response.json())
    .then(data => data.contacts)
    .catch(error => {
      logger.error('Error fetching contacts from ZOHO CRM', { error: error.message });
      return [];
    });

  const to = contacts.map(contact => contact.phone);
  if (!to?.length) return res.status(400).json({ error: 'No contacts found' });

  try {
    await to.forEach(async (phoneNumber) => {
      const username = [contacts.find(contact => contact.phone === phoneNumber)?.fullName] || ['Customer'];
      await initiateWhatsappMessage(phoneNumber, templateName, username, client);
    });
    res.json({ success: true, sent_to: to, template: templateName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await dbConfig.db.UserSession?.findAll();
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

router.get('/appointments', async (req, res) => {
  try {
    const appointments = await dbConfig.db.ServiceRequest?.findAll();
    res.json({ appointments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

router.get('/services', async (req, res) => {
  try {
    const where = {};
    if (req.query.clientId) where.clientId = req.query.clientId;
    const services = await dbConfig.db.Content?.findAll({ where });
    res.json(services || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
})

router.get('/clients', async (req, res) => {
  try {
    const clients = await dbConfig.db.Client?.findAll({ order: [['createdAt', 'DESC']] });
    res.json({ clients: clients || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/clients', async (req, res) => {
  try {
    const {
      name, email, phone, company,
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
    res.status(500).json({ error: error.message });
  }
});

router.put('/clients/:id', async (req, res) => {
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
      'confluenceBaseUrl', 'confluenceEmail', 'confluenceApiToken', 'confluenceSpaceKey'
    ];
    const updates = {};
    allowed.forEach(field => { if (req.body[field] !== undefined) updates[field] = req.body[field]; });

    client.set(updates);

    // Force-mark encrypted fields as changed so the beforeUpdate hook always re-encrypts them,
    // even when the incoming plaintext value matches what's already stored (e.g. a key that was
    // previously saved without going through the encryption hook).
    const encryptedFields = ['whatsappToken', 'geminiApiKey', 'pineconeApiKey', 'flutterwaveSecretKey', 'flutterwaveWebhookSecret', 'microsoftClientSecret', 'confluenceApiToken'];
    encryptedFields.forEach(f => { if (updates[f] !== undefined) client.changed(f, true); });

    await client.save();

    // Invalidate cache so next request gets fresh credentials
    if (client.whatsappBusinessId) invalidateClient(client.whatsappBusinessId);

    res.json({ client });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/employees', async (req, res) => {
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

