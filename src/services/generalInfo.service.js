import NodeCache from 'node-cache';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';

const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour

/**
 * Loads a client's general info from the database.
 * Returns null if no row exists yet for this client.
 *
 * The returned object is normalised for use by generalInquiryHandler:
 *   phone, whatsapp, email, website, location (string), mapsLink,
 *   hours (JSONB object), faqs ([{ q, a }])
 */
export async function getClientGeneralInfo(clientId) {
  const key    = `general:${clientId}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  try {
    const row = await dbConfig.db.ClientGeneralInfo.findOne({ where: { clientId } });

    if (!row) {
      logger.debug('No general info row found for client', { clientId });
      cache.set(key, null);
      return null;
    }

    const data = {
      businessName: row.businessName || null,
      industry:     row.industry     || null,
      description:  row.description  || null,
      phone:        row.phone        || null,
      email:        row.email        || null,
      website:      row.website      || null,
      location:     [row.address, row.area, row.city].filter(Boolean).join(', ') || null,
      mapsLink:     row.mapsLink     || null,
      hours:        row.hours        || {},
      faqs:         (row.faqs || []).map(f => ({ q: f.question, a: f.answer })),
    };

    cache.set(key, data);
    logger.debug('General info loaded from DB', { clientId });
    return data;
  } catch (err) {
    logger.error('getClientGeneralInfo DB error', { clientId, error: err.message });
    cache.set(key, null);
    return null;
  }
}

export function invalidateGeneralInfoCache(clientId) {
  cache.del(`general:${clientId}`);
}
