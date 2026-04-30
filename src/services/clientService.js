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
    logger.info('Client resolution failed: No record found for ID', { phoneNumberId });
    return null;
  }

  clientCache.set(phoneNumberId, client);
  logger.info('Client resolved and cached', { clientId: client.id, name: client.name, phoneNumberId });
  return client;
}

export function invalidateClient(phoneNumberId) {
  if (phoneNumberId) {
    clientCache.invalidate(phoneNumberId);
    logger.debug('Client cache invalidated', { phoneNumberId });
  }
}
