import clientCache from '../utils/cache.js';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';
import { redisGet, redisSet, redisDel } from '../utils/redis.js';

const CLIENT_REDIS_TTL = 5 * 60; // 5 minutes — matches in-memory TTL

export async function resolveClient(phoneNumberId) {
  if (!phoneNumberId) return null;

  // L1: in-memory (stores Sequelize instance with all methods)
  const inMemory = clientCache.get(phoneNumberId);
  if (inMemory) {
    logger.debug('Client resolved from L1 cache', { phoneNumberId });
    return inMemory;
  }

  // L2: Redis (stores just the primary key to avoid serialising encrypted fields)
  const redisKey = `client:pid:${phoneNumberId}`;
  const cachedId = await redisGet(redisKey);

  let client;
  if (cachedId) {
    // Fast PK lookup instead of index scan on whatsappBusinessId
    client = await dbConfig.db.Client.findByPk(cachedId);
    logger.debug('Client resolved via Redis L2 (PK lookup)', { phoneNumberId, clientId: cachedId });
  } else {
    client = await dbConfig.db.Client.findOne({
      where: { whatsappBusinessId: phoneNumberId }
    });
    logger.debug('Client resolved from DB', { phoneNumberId, clientId: client?.id });
  }

  if (!client) {
    logger.debug('No client record for phoneNumberId', { phoneNumberId });
    return null;
  }

  // Populate both caches
  await redisSet(redisKey, client.id, CLIENT_REDIS_TTL);
  clientCache.set(phoneNumberId, client);
  return client;
}

export async function invalidateClient(phoneNumberId) {
  if (!phoneNumberId) return;
  clientCache.invalidate(phoneNumberId);
  await redisDel(`client:pid:${phoneNumberId}`);
  logger.debug('Client cache invalidated (L1 + L2)', { phoneNumberId });
}
