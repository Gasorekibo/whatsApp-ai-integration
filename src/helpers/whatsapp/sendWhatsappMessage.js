
import dotenv from 'dotenv';
import logger from '../../logger/logger.js';
dotenv.config();
export async function sendWhatsAppMessage(to, body, credentials = null) {
  const phoneNumberId = credentials?.phoneNumberId;
  const token         = credentials?.token;

  if (!phoneNumberId || !token) {
    logger.error('sendWhatsAppMessage: missing client credentials', { to: `***${String(to).slice(-4)}` });
    throw new Error('Client WhatsApp credentials are not configured');
  }

  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return data;
  } catch (err) {
    logger.error('Send message failed', { error: err.message });
  }
}