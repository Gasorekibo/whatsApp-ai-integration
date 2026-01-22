const dotenv = require('dotenv');
const { syncServicesFromSheet } = require('../utils/googleSheets');
const { db } = require('../models/index');

dotenv.config();

async function syncServicesHandler (req, res){
  try {
    const spreadsheetId = req?.body?.spreadsheetId || process.env.GOOGLE_SHEET_ID;
    if (!spreadsheetId) {
      return res.status(400).json({ 
        success: false, 
        error: 'spreadsheetId is required (in body or GOOGLE_SHEET_ID env variable)' 
      });
    }

    const employee = await db.Employee.findOne({ where: { email: process.env.EMPLOYEE_EMAIL } });
    if (!employee) {
      return res.status(404).json({ 
        success: false, 
        error: 'Employee not found. Please authenticate first at /auth' 
      });
    }

    const token = employee.getDecryptedToken();
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'No refresh token found. Please authenticate at /auth' 
      });
    }

    const result = await syncServicesFromSheet(spreadsheetId, token);
    res.json(result);

  } catch (error) {
    console.error('❌ Sync error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
};

module.exports = { syncServicesHandler };