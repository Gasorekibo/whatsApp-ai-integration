import logger from '../../logger/logger.js';

/**
 * Sends a WhatsApp interactive button message (reply buttons, up to 3).
 *
 * @param {string} to            - Recipient phone number
 * @param {object} client        - Resolved Client Sequelize instance
 * @param {object} opts
 * @param {string} opts.body     - Body text (max 1024 chars, required)
 * @param {string} [opts.header] - Header text (max 60 chars)
 * @param {string} [opts.footer] - Footer text (max 60 chars)
 * @param {Array}  opts.buttons  - Array of { id, title } — max 3
 */
export async function sendWhatsAppButtons(to, client, { body, header, footer, buttons }) {
  const phoneNumberId = client?.whatsappBusinessId;
  const token         = client?.getDecryptedWhatsappToken?.();

  if (!phoneNumberId || !token) {
    logger.error('sendWhatsAppButtons: missing client credentials', { to: `***${String(to).slice(-4)}` });
    throw new Error('Client WhatsApp credentials are not configured');
  }

  const interactive = {
    type:   'button',
    body:   { text: body },
    action: {
      buttons: buttons.slice(0, 3).map(b => ({
        type:  'reply',
        reply: { id: b.id, title: String(b.title).slice(0, 20) }
      }))
    }
  };

  if (header) interactive.header = { type: 'text', text: header };
  if (footer) interactive.footer = { text: footer };

  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messaging_product: 'whatsapp', to, type: 'interactive', interactive })
    });
    const data = await res.json();
    if (!res.ok) {
      logger.error('sendWhatsAppButtons failed', { status: res.status, data });
    }
    return data;
  } catch (err) {
    logger.error('sendWhatsAppButtons error', { error: err.message });
  }
}
