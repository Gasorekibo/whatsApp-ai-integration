import dotenv from 'dotenv';
import dbConfig from '../models/index.js';
import googleSheet from '../utils/googlesheets.js';
import logger from '../logger/logger.js';
import { redisDel } from '../utils/redis.js';
dotenv.config();

async function googleSheetsWebhookHandler(req, res) {
  try {
    const { spreadsheetId, verifyToken, clientId } = req.body;

    if (process.env.SHEETS_WEBHOOK_TOKEN &&
        verifyToken !== process.env.SHEETS_WEBHOOK_TOKEN) {
      return res.status(403).json({ success: false, error: 'Invalid webhook token' });
    }

    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId is required' });
    }

    const sheetId = spreadsheetId || process.env.GOOGLE_SHEET_ID;
    if (!sheetId) {
      return res.status(400).json({ success: false, error: 'spreadsheetId required' });
    }

    const employee = await dbConfig.db.Employee.findOne({ where: { clientId } });
    if (!employee) {
      return res.status(404).json({ success: false, error: 'No employee found for this client' });
    }

    const token = employee.getDecryptedToken();
    if (!token) {
      return res.status(401).json({ success: false, error: 'Employee has no calendar token' });
    }

    const result = await googleSheet.syncServicesFromSheet(sheetId, token, clientId);

    await redisDel(`services:${clientId}`);

    res.json(result);
  } catch (error) {
    logger.error('Webhook sync error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
}

export default googleSheetsWebhookHandler;
