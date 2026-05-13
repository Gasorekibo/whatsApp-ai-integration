import logger from '../../logger/logger.js';

/**
 * Shared helper for sending any WhatsApp interactive list message.
 * All interactive lists in the app go through this one function so the
 * Meta API call logic lives in exactly one place.
 *
 * @param {string} to           - Recipient phone number
 * @param {object} client       - Resolved Client Sequelize instance
 * @param {object} opts
 * @param {string} opts.header  - Header text (max 60 chars)
 * @param {string} opts.body    - Body text (max 1024 chars)
 * @param {string} opts.button  - Button label (max 20 chars)
 * @param {string} [opts.footer]- Footer text (max 60 chars)
 * @param {Array}  opts.sections- Array of { title, rows: [{ id, title, description? }] }
 */
export async function sendWhatsAppInteractiveList(to, client, { header, body, button, footer, sections }) {
  const phoneNumberId = client?.whatsappBusinessId;
  const token         = client?.getDecryptedWhatsappToken?.();

  if (!phoneNumberId || !token) {
    logger.error('sendWhatsAppInteractiveList: missing client credentials', { to: `***${String(to).slice(-4)}` });
    throw new Error('Client WhatsApp credentials are not configured');
  }

  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

  const interactive = {
    type:   'list',
    body:   { text: body },
    action: { button, sections }
  };

  if (header) interactive.header = { type: 'text', text: header };
  if (footer) interactive.footer = { text: footer };

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messaging_product: 'whatsapp', to, type: 'interactive', interactive })
    });

    const data = await res.json();
    if (!res.ok) {
      logger.error('sendWhatsAppInteractiveList failed', { status: res.status, data });
    }
    return data;
  } catch (err) {
    logger.error('sendWhatsAppInteractiveList error', { error: err.message });
  }
}
