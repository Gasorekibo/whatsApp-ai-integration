const { Client } = require('@microsoft/microsoft-graph-client');
const { ClientSecretCredential } = require('@azure/identity');
const dotenv = require('dotenv');
dotenv.config();

const config = {
  clientId: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  tenantId: process.env.MICROSOFT_TENANT_ID,
  userEmail: process.env.MICROSOFT_USER_EMAIL
};

const credential = new ClientSecretCredential(
  config.tenantId,
  config.clientId,
  config.clientSecret
);

 const getAuthenticatedClient = () => {
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        return token.token;
      }
    }
  });
};

async function syncServicesMicrosoftHandler() {
  try {
    const client = getAuthenticatedClient();
    const driveId = process.env.MICROSOFT_DRIVE_ID;
    const itemId = process.env.MICROSOFT_ITEM_ID;
    const worksheetName = 'Services'; 
    const response = await client
      .api(`/drives/${driveId}/items/${itemId}/workbook/worksheets/${worksheetName}/usedRange`)
      .get();
    const rows = response.values;
     if (!rows || rows.length === 0) {
      return {
        success: false,
        message: 'No data found in the worksheet'
      };
    }
    const headers = rows[0];
    const data = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = row[index];
      });
      return obj;
    });
    return data;

  } catch (error) {
    console.error('❌ Microsoft Sheets sync error:', error);
    return { 
      success: false, 
      message: error.message,
      error: error.toString()
    };
  }
}

module.exports = {
  getAuthenticatedClient,
  syncServicesMicrosoftHandler
};


