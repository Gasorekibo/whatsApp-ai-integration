import express from 'express';
import dbConfig from '../models/index.js';
import { invalidateGeneralInfoCache } from '../services/generalInfo.service.js';
import knowledgeBaseService from '../services/knowledge-base.service.js';
import logger from '../logger/logger.js';

const router = express.Router();

// ── Token validation helper ───────────────────────────────────────────────────

async function resolveToken(token) {
  if (!token || token.length !== 64) return null;
  return dbConfig.db.FormToken.findOne({
    where: { token, expiresAt: { [dbConfig.db.Sequelize.Op.gt]: new Date() } },
    include: [{ model: dbConfig.db.Client, attributes: ['id', 'name', 'pineconeIndex'] }],
  });
}

// ── GET /api/onboarding/:token — return prefill data for the form ─────────────

router.get('/:token', async (req, res) => {
  const record = await resolveToken(req.params.token);
  if (!record) return res.status(410).json({ error: 'This link has expired or is invalid.' });

  let prefill = null;
  try {
    const existing = await dbConfig.db.ClientGeneralInfo.findOne({ where: { clientId: record.clientId } });
    if (existing) {
      prefill = {
        businessName: existing.businessName,
        industry:     existing.industry,
        description:  existing.description,
        phone:        existing.phone,
        whatsapp:     existing.whatsapp,
        email:        existing.email,
        website:      existing.website,
        address:      existing.address,
        area:         existing.area,
        city:         existing.city,
        mapsLink:     existing.mapsLink,
        hours:        existing.hours,
        faqs:         existing.faqs,
      };
    }
  } catch (_) { /* return null prefill on error */ }

  res.json({ clientName: record.Client.name, prefill });
});

// ── POST /api/onboarding/:token — save submitted form data ───────────────────

router.post('/:token', express.json(), async (req, res) => {
  const record = await resolveToken(req.params.token);
  if (!record) return res.status(410).json({ error: 'This link has expired or is invalid.' });

  const clientId = record.clientId;
  const body     = req.body;

  if (!body.businessName?.trim() || !body.phone?.trim()) {
    return res.status(400).json({ error: 'Business name and phone number are required.' });
  }

  const faqs = (body.faqs || []).filter(f => f.question?.trim() && f.answer?.trim());

  const updates = {
    businessName: body.businessName?.trim()  || null,
    industry:     body.industry?.trim()      || null,
    description:  body.description?.trim()   || null,
    phone:        body.phone?.trim()          || null,
    whatsapp:     body.whatsapp?.trim()       || null,
    email:        body.email?.trim()          || null,
    website:      body.website?.trim()        || null,
    address:      body.address?.trim()        || null,
    area:         body.area?.trim()           || null,
    city:         body.city?.trim()           || null,
    mapsLink:     body.mapsLink?.trim()       || null,
    hours:        body.hours  || {},
    faqs,
  };

  try {
    let info = await dbConfig.db.ClientGeneralInfo.findOne({ where: { clientId } });
    if (info) {
      await info.update(updates);
    } else {
      await dbConfig.db.ClientGeneralInfo.create({ clientId, ...updates });
    }
    await invalidateGeneralInfoCache(clientId);
    logger.info('Onboarding form submitted', { clientId });
    res.json({ success: true });

    // Sync general info into Pinecone in the background — don't block the response.
    const namespace = record.Client.pineconeIndex || String(clientId);
    knowledgeBaseService.syncGeneralInfo(clientId, namespace).catch(err =>
      logger.error('syncGeneralInfo failed after onboarding submit', { clientId, error: err.message })
    );
  } catch (err) {
    logger.error('Onboarding form save error', { clientId, error: err.message });
    res.status(500).json({ error: 'Something went wrong while saving. Please try again.' });
  }
});

export default router;
