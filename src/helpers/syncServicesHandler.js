import dotenv from 'dotenv';
import googlesheets from '../utils/googlesheets.js';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';

dotenv.config();

async function syncServicesHandler(req, res) {
  try {
    const spreadsheetId = req?.body?.spreadsheetId || process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return res.status(400).json({
        success: false,
        error: 'spreadsheetId is required (in body or GOOGLE_SHEET_ID env variable)'
      });
    }

    // For clients: always use their own clientId from the JWT — never trust the body.
    // For admins: accept an explicit clientId from the body.
    const isAdmin = req.user?.role === 'admin';
    const clientId = isAdmin
      ? (req.body?.clientId ?? null)
      : req.user?.clientId;

    if (!clientId) {
      return res.status(400).json({ success: false, error: 'clientId is required' });
    }

    const employee = await dbConfig.db.Employee.findOne({ where: { clientId } });
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'No employee found for this client. Please authenticate at /auth?clientId=' + clientId
      });
    }

    const token = employee.getDecryptedToken();
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No refresh token found. Please re-authenticate at /auth?clientId=' + clientId
      });
    }

    const result = await googlesheets.syncServicesFromSheet(spreadsheetId, token, clientId);
    res.json(result);
  } catch (error) {
    logger.error('Sync error', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
}

export default syncServicesHandler;
