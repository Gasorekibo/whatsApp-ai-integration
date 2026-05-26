import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';

// Returns the Client record for this container's tenant.
// TENANT_ID is set once at container startup via the environment variable —
// it never changes, so this is always a single-tenant lookup.
export async function getTenant() {
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) {
    logger.error('TENANT_ID env var is not set — cannot resolve tenant');
    return null;
  }

  try {
    const tenant = await dbConfig.db.Client.findByPk(tenantId);
    if (!tenant) logger.warn('Tenant record not found in DB', { tenantId });
    return tenant;
  } catch (err) {
    logger.error('getTenant DB lookup failed', { tenantId, error: err.message });
    return null;
  }
}
