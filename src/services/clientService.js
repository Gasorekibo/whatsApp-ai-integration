import clientCache from '../utils/cache.js';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';

export async function resolveClient(phoneNumberId) {
  if (!phoneNumberId) return null;

  const cached = clientCache.get(phoneNumberId);
  if (cached) {
    logger.debug('Client resolved from cache', { phoneNumberId });
    return cached;
  }

  const client = await dbConfig.db.Client.findOne({
    where: { whatsappBusinessId: phoneNumberId }
  });

  if (!client) {
    logger.debug('No client record for phoneNumberId', { phoneNumberId });
    return null;
  }

  clientCache.set(phoneNumberId, client);
  logger.debug('Client cached after DB lookup', { clientId: client.id, phoneNumberId });
  return client;
}

export function invalidateClient(phoneNumberId) {
  if (phoneNumberId) {
    clientCache.invalidate(phoneNumberId);
    logger.debug('Client cache invalidated', { phoneNumberId });
  }
}
