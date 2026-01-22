const dotenv = require('dotenv');
dotenv.config();

async function zohoAuthenticationRedirect(req, res) {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const redirectUri = process.env.ZOHO_REDIRECT_URI;
  
  if (!clientId || !redirectUri) {
    return res.status(500).send('Zoho OAuth credentials not configured in .env');
  }

  const authUrl = `https://accounts.zoho.com/oauth/v2/auth?` +
    `scope=ZohoCRM.modules.contacts.READ,ZohoCRM.modules.contacts.ALL,ZohoCRM.settings.ALL&` +
    `client_id=${clientId}&` +
    `response_type=code&` +
    `access_type=offline&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `prompt=consent`;
  
  res.redirect(authUrl);
}

module.exports = { zohoAuthenticationRedirect };