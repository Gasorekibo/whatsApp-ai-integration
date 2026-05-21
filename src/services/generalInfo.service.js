import NodeCache from 'node-cache';
import { redisGet, redisSet, redisDel } from '../utils/redis.js';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';

// L1: in-process (1 hour TTL, fastest)
const l1 = new NodeCache({ stdTTL: 3600 });

const REDIS_TTL = 3600; // 1 hour L2
const KEY = (clientId) => `general:${clientId}`;

/**
 * Loads a client's general info.
 * Cache hierarchy: L1 node-cache → L2 Redis → DB
 * Returns null if no row exists yet for this client.
 */
export async function getClientGeneralInfo(clientId) {
  const key = KEY(clientId);

  // L1 hit
  const l1Hit = l1.get(key);
  if (l1Hit !== undefined) return l1Hit;

  // L2 hit
  const l2Hit = await redisGet(key);
  if (l2Hit !== undefined && l2Hit !== null) {
    l1.set(key, l2Hit);
    return l2Hit;
  }

  // DB fallback
  try {
    const row = await dbConfig.db.ClientGeneralInfo.findOne({ where: { clientId } });

    if (!row) {
      l1.set(key, null);
      await redisSet(key, null, REDIS_TTL);
      logger.debug('No general info row found for client', { clientId });
      return null;
    }

    const data = {
      businessName: row.businessName || null,
      industry:     row.industry     || null,
      description:  row.description  || null,
      phone:        row.phone        || null,
      whatsapp:     row.whatsapp     || null,
      email:        row.email        || null,
      website:      row.website      || null,
      location:     [row.address, row.area, row.city].filter(Boolean).join(', ') || null,
      mapsLink:     row.mapsLink     || null,
      hours:        row.hours        || {},
      faqs:         (row.faqs || []).map(f => ({ q: f.question, a: f.answer })),
    };

    l1.set(key, data);
    await redisSet(key, data, REDIS_TTL);
    logger.debug('General info loaded from DB', { clientId });
    return data;
  } catch (err) {
    logger.error('getClientGeneralInfo DB error', { clientId, error: err.message });
    return null;
  }
}

export async function invalidateGeneralInfoCache(clientId) {
  const key = KEY(clientId);
  l1.del(key);
  await redisDel(key);
}
