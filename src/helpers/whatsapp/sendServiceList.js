import googleSheet from '../../utils/googlesheets.js';
import { sendWhatsAppMessage } from './sendWhatsappMessage.js';
import dotenv from 'dotenv';
import logger from '../../logger/logger.js';
dotenv.config();
import i18next from '../../config/i18n.js';
import translationService from '../../services/translation.service.js';

export async function sendServiceList(to, locale = 'en', client = null) {
  const clientId      = client?.id || null;
  const companyName   = client?.companyName || client?.name || 'Our Services';
  const phoneNumberId = client?.whatsappBusinessId;
  const token         = client?.getDecryptedWhatsappToken?.();

  if (!phoneNumberId || !token) {
    logger.error('sendServiceList: missing client credentials', { clientId });
    throw new Error('Client WhatsApp credentials are not configured');
  }

  let services = await googleSheet.getActiveServices(clientId);
  services = await translationService.translateServices(services, locale);

  const t = i18next.getFixedT(locale);

  if (services.length === 0) {
    await sendWhatsAppMessage(to, t('no_services'), { token, phoneNumberId });
    return;
  }

  const LIST_ROWS = services.map(s => ({
    id:          s.id,
    title:       (s.short || s.name).slice(0, 24),
    description: s.details?.slice(0, 40) + '...' || `Professional ${s.name}`
  }));

  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type:   'list',
          header: { type: 'text', text: companyName },
          body:   { text: t('select_service_body') },
          footer: { text: t('select_service_footer') },
          action: {
            button:   t('view_services'),
            sections: [{ title: t('our_services'), rows: LIST_ROWS }]
          }
        }
      })
    });

    const data = await res.json();

    if (!res.ok) {
      logger.error('Interactive list send failed', { data });
      let fallbackText = t('select_service_body') + '\n\n';
      services.forEach((s, i) => { fallbackText += `${i + 1}. ${s.short || s.name}\n`; });
      await sendWhatsAppMessage(to, fallbackText, { token, phoneNumberId });
    } else {
      logger.info('Service list sent successfully');
    }
    return data;
  } catch (err) {
    logger.error('sendServiceList error', { error: err.message });
  }
}
