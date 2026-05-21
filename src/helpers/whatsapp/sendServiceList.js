import { sendWhatsAppMessage } from './sendWhatsappMessage.js';
import dotenv from 'dotenv';
import logger from '../../logger/logger.js';
dotenv.config();
import i18next from '../../config/i18n.js';
import translationService from '../../services/translation.service.js';
import { redisGet, redisSet } from '../../utils/redis.js';
import ragService from '../../services/rag.service.js';

const SERVICES_CACHE_TTL = 60 * 60; // 1 hour

export async function sendServiceList(to, locale = 'en', client = null) {
  const clientId      = client?.id || null;
  const botName   = client?.botName || client?.name || 'Our Services';
  const phoneNumberId = client?.whatsappBusinessId;
  const token         = client?.getDecryptedWhatsappToken?.();

  if (!phoneNumberId || !token) {
    logger.error('sendServiceList: missing client credentials', { clientId });
    throw new Error('Client WhatsApp credentials are not configured');
  }

  // RAG (Pinecone) is the single source of truth — no Content table dependency
  const namespace  = client?.pineconeIndex || clientId || 'default';
  const servicesKey = `services:${clientId}`;

  let services = await redisGet(servicesKey);
  if (!services?.length) {
    services = await ragService.getServicesFromIndex(namespace);
    if (services?.length) await redisSet(servicesKey, services, SERVICES_CACHE_TTL);
  }
  services = await translationService.translateServices(services || [], locale);

  const t = i18next.getFixedT(locale);

  if (services.length === 0) {
    await sendWhatsAppMessage(to, t('no_services'), { token, phoneNumberId });
    return;
  }

  // WhatsApp interactive list hard limit is 10 rows total (across all sections).
  // When there are more than 10 services, skip the interactive list entirely and
  // send a numbered plain-text list — the text handler will intercept numeric replies.
  const INTERACTIVE_LIMIT = 10;

  if (services.length > INTERACTIVE_LIMIT) {
    let fallbackText = t('select_service_body') + '\n\n';
    services.forEach((s, i) => { fallbackText += `${i + 1}. ${s.short || s.name}\n`; });
    fallbackText += `\n${t('reply_with_number') || 'Reply with the number of the service you\'re interested in.'}`;
    await sendWhatsAppMessage(to, fallbackText, { token, phoneNumberId });
    logger.info('Service list sent as numbered text (> 10 items)', { count: services.length });
    return;
  }

  // ≤ 10 services — use the interactive list (single section, tappable rows)
  const toRow = (s) => ({
    id:          s.id,
    title:       (s.short || s.name).slice(0, 24),
    description: s.details?.trim()
      ? s.details.slice(0, 72)
      : `Tap to learn more`
  });

  const sections = [{
    title: t('our_services'),
    rows:  services.map(toRow)
  }];

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
          header: { type: 'text', text: botName },
          body:   { text: t('select_service_body') },
          footer: { text: t('select_service_footer') },
          action: {
            button:   t('view_services'),
            sections
          }
        }
      })
    });

    const data = await res.json();

    if (!res.ok) {
      logger.error('Interactive list send failed', { data });
      // Plain-text fallback — number every service so user can reply with a number
      let fallbackText = t('select_service_body') + '\n\n';
      services.forEach((s, i) => { fallbackText += `${i + 1}. ${s.short || s.name}\n`; });
      fallbackText += `\n${t('reply_with_number') || 'Reply with the number of the service you\'re interested in.'}`;
      await sendWhatsAppMessage(to, fallbackText, { token, phoneNumberId });
    } else {
      logger.info('Service list sent as interactive list', { count: services.length });
    }
    return data;
  } catch (err) {
    logger.error('sendServiceList error', { error: err.message });
  }
}
