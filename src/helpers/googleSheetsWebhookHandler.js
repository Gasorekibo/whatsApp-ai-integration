const dotenv = require('dotenv');
const { syncServicesFromSheet } = require('../utils/googleSheets');
const {db}  = require('../models/index.js');
dotenv.config();

async function googleSheetsWebhookHandler(req, res) {
  try {
    const { spreadsheetId, verifyToken } = req.body;
    if (process.env.SHEETS_WEBHOOK_TOKEN && 
        verifyToken !== process.env.SHEETS_WEBHOOK_TOKEN) {
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid webhook token' 
      });
    }

    const sheetId = spreadsheetId || process.env.GOOGLE_SHEET_ID;
    
    if (!sheetId) {
      return res.status(400).json({ 
        success: false, 
        error: 'spreadsheetId required' 
      });
    }

    const employee = await db.Employee.findOne({ where: { email: process.env.EMPLOYEE_EMAIL } });
    if (!employee) {
      return res.status(404).json({ 
        success: false, 
        error: 'Employee not found' 
      });
    }

    const token = employee.getDecryptedToken();
    const result = await syncServicesFromSheet(sheetId, token);

    res.json(result);

  } catch (error) {
    console.error('❌ Webhook sync error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};
module.exports = { googleSheetsWebhookHandler };