import logger from '../logger/logger.js';

async function initiateWhatsappMessage(to, templateName, params = [], client = null) {
  const phoneNumberId = client?.whatsappBusinessId;
  const token         = client?.getDecryptedWhatsappToken?.();

  if (!phoneNumberId || !token) {
    logger.error('initiateWhatsappMessage: missing client credentials', { to: `***${String(to).slice(-4)}` });
    throw new Error('Client WhatsApp credentials are not configured');
  }

  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'header',
              parameters: params.map(text => ({ type: 'text', text }))
            }
          ]
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      logger.error('Sending initial message template failed.', { data });
      throw new Error('Template failed');
    }
    return data;
  } catch (err) {
    logger.error('Sending initial message template failed.', { error: err.message });
  }
}

export default initiateWhatsappMessage;