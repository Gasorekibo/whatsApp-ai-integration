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

    // clientId can be passed explicitly by the admin UI; falls back to null (legacy)
    const clientId = req?.body?.clientId || null;

    // Find the employee whose calendar/OAuth token will be used for the sync.
    // When clientId is provided we look up the client's own employee; otherwise
    // fall back to the global EMPLOYEE_EMAIL env variable.
    const employeeWhere = clientId
      ? { clientId }
      : { email: process.env.EMPLOYEE_EMAIL };

    const employee = await dbConfig.db.Employee.findOne({ where: employeeWhere });
    if (!employee) {
      return res.status(404).json({
        success: false,
        error: 'Employee not found for this client. Please authenticate at /auth'
      });
    }

    const token = employee.getDecryptedToken();
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No refresh token found. Please authenticate at /auth'
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
