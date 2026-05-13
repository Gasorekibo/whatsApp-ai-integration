import { readFile } from 'fs/promises';
import { join } from 'path';
import NodeCache from 'node-cache';
import logger from '../logger/logger.js';

const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour — general info changes rarely

/**
 * Loads a client's general info JSON from disk.
 * File location: src/data/clients/{clientId}/general.json
 * Falls back to src/data/clients/default/general.json if not found.
 *
 * @param {string} clientId - The client UUID (used as the directory name)
 * @returns {object|null}   - Parsed general info, or null if not found
 */
export async function getClientGeneralInfo(clientId) {
  const key = `general:${clientId}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const candidates = [
    join(process.cwd(), 'src/data/clients', clientId, 'general.json'),
    join(process.cwd(), 'src/data/clients/default/general.json')
  ];

  for (const filePath of candidates) {
    try {
      const data = JSON.parse(await readFile(filePath, 'utf8'));
      cache.set(key, data);
      logger.debug('General info loaded', { clientId, filePath });
      return data;
    } catch {
      // file not found — try next
    }
  }

  logger.warn('No general.json found for client', { clientId });
  cache.set(key, null); // cache the miss to avoid repeated FS lookups
  return null;
}

export function invalidateGeneralInfoCache(clientId) {
  cache.del(`general:${clientId}`);
}
