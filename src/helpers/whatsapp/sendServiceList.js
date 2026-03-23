import googleSheet from '../../utils/googlesheets.js';
import { sendWhatsAppMessage } from './sendWhatsappMessage.js';
import dotenv from 'dotenv';
import logger from '../../logger/logger.js';
dotenv.config();
import i18next from '../../config/i18n.js';

export async function sendServiceList(to, locale = 'en') {
  const services = await googleSheet.getActiveServices();
  const t = i18next.getFixedT(locale);

  if (services.length === 0) {
    await sendWhatsAppMessage(to, t('no_services'));
    return;
  }

  const LIST_ROWS = services.map(s => ({
    id: s.id,
    title: s.short || s.name,
    description: s.details?.slice(0, 40) + "..." || `Professional ${s.name}`
  }));

  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: 'MOYOTECH Solutions' },
          body: { text: t('select_service_body') },
          footer: { text: t('select_service_footer') },
          action: {
            button: t('view_services'),
            sections: [{ title: t('our_services'), rows: LIST_ROWS }]
          }
        }
      })
    });
    const data = await res.json();

    if (!res.ok) {
      logger.error('Interactive list send failed', { data });
      let fallbackText = "Welcome to Moyo Tech! How can we help you today?\n\n";
      services.forEach((s, i) => {
        fallbackText += `${i + 1}. ${s.short || s.name}\n`;
      });
      fallbackText += "\nReply with a number to select a service!";
      await sendWhatsAppMessage(to, fallbackText);
    } else {
      logger.info('Service list sent successfully');
    }
    return data;
  } catch (err) {
    logger.error('sendServiceList error', { error: err.message });
  }
}