import { google } from 'googleapis';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';

/**
 * Sync services from Google Sheet into the client's Content row.
 * @param {string} spreadsheetId
 * @param {string} refreshToken
 * @param {string|null} clientId - Tenant key; null = legacy single-tenant
 */
async function syncServicesFromSheet(spreadsheetId, refreshToken, clientId = null) {
  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const sheets   = google.sheets({ version: 'v4', auth: oauth2Client });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Services!A2:E',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return { success: false, message: 'No data found in sheet' };
    }

    const services = rows
      .filter(row => row[0])
      .map(row => ({
        id:      row[0]?.trim() || '',
        name:    row[1]?.trim() || '',
        short:   row[2]?.trim() || '',
        details: row[3]?.trim() || '',
        active:  row[4] == null || row[4] === '' ? true : (['true','1','yes'].includes(String(row[4]).toLowerCase()))
      }))
      .filter(s => s.id && s.name);

    // Find or create the Content row scoped to this client
    let content = await dbConfig.db.Content.findOne({ where: { clientId } });

    if (content) {
      content.services  = services;
      content.updatedAt = new Date();
      await content.save();
    } else {
      content = await dbConfig.db.Content.create({ clientId, services, updatedAt: new Date() });
    }

    return {
      success:  true,
      message:  `Successfully synced ${services.length} services`,
      services: content.services,
      syncedAt: new Date().toISOString()
    };

  } catch (error) {
    logger.error('Google Sheets sync error', { error: error.message });
    return { success: false, message: error.message, error: error.toString() };
  }
}

/**
 * Get active services for a specific client.
 * Falls back to default services if none found.
 * @param {string|null} clientId
 */
async function getActiveServices(clientId = null) {
  try {
    const content = await dbConfig.db.Content.findOne({ where: { clientId } });
    if (content?.services?.length > 0) {
      return content.services.filter(s => s.active !== false);
    }
    return [];
  } catch (error) {
    logger.error('Error fetching services', { error: error.message });
    return [];
  }
}

/**
 * Get all services (including inactive) for a specific client.
 * @param {string|null} clientId
 */
async function getAllServices(clientId = null) {
  try {
    const content = await dbConfig.db.Content.findOne({ where: { clientId } });
    if (content?.services?.length > 0) {
      return content.services;
    }
    return [];
  } catch (error) {
    logger.error('Error fetching all services', { error: error.message });
    return [];
  }
}

/**
 * Seed default services for a client if their Content row is empty.
 * @param {string|null} clientId
 */
async function initializeServices(clientId = null) {
  try {
    let content = await dbConfig.db.Content.findOne({ where: { clientId } });

    if (!content?.services?.length) {
      const defaultServices = getDefaultServices();
      if (content) {
        content.services  = defaultServices;
        content.updatedAt = new Date();
        await content.save();
      } else {
        await dbConfig.db.Content.create({ clientId, services: defaultServices, updatedAt: new Date() });
      }
      logger.info('Services initialized', { clientId });
    }
  } catch (error) {
    logger.error('Error initializing services', { error: error.message });
  }
}

export default { syncServicesFromSheet, getActiveServices, getAllServices, initializeServices };
