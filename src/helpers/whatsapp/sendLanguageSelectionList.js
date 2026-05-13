import logger from '../../logger/logger.js';

// Languages offered in their native script so the user can recognise their own language
const LANGUAGE_ROWS = [
  { id: 'lang:en', title: '🇬🇧 English',      description: 'English (Recommended)' },
  { id: 'lang:fr', title: '🇫🇷 Français',     description: 'French / Français' },
  { id: 'lang:rw', title: '🇷🇼 Kinyarwanda',  description: 'Kinyarwanda' },
  { id: 'lang:sw', title: '🇰🇪 Kiswahili',    description: 'Swahili / Kiswahili' },
  { id: 'lang:de', title: '🇩🇪 Deutsch',      description: 'German / Deutsch' }
];

// Multilingual header/body — shown before we know the user's language
const HEADER_TEXT  = '🌐 Language / Langue / Ururimi';
const BODY_TEXT    = 'Please choose your preferred language.\nChoisissez votre langue.\nHitamo ururimi rwawe.\nChagua lugha yako.\nWählen Sie Ihre Sprache.';
const FOOTER_TEXT  = 'English is recommended ⭐';
const BUTTON_LABEL = 'Select Language';
const SECTION_TITLE = 'Available Languages';

export async function sendLanguageSelectionList(to, client) {
  const phoneNumberId = client?.whatsappBusinessId;
  const token         = client?.getDecryptedWhatsappToken?.();

  if (!phoneNumberId || !token) {
    logger.error('sendLanguageSelectionList: missing client credentials', { to: `***${String(to).slice(-4)}` });
    throw new Error('Client WhatsApp credentials are not configured');
  }

  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type:   'list',
          header: { type: 'text', text: HEADER_TEXT },
          body:   { text: BODY_TEXT },
          footer: { text: FOOTER_TEXT },
          action: {
            button:   BUTTON_LABEL,
            sections: [{ title: SECTION_TITLE, rows: LANGUAGE_ROWS }]
          }
        }
      })
    });

    const data = await res.json();
    if (!res.ok) {
      logger.error('Language selection list send failed', { data });
    } else {
      logger.info('Language selection list sent', { to: `***${String(to).slice(-4)}` });
    }
    return data;
  } catch (err) {
    console.error('Error sending language selection list:', err);
    logger.error('sendLanguageSelectionList error', { error: err.message });
  }
}

export const LANG_PREFIX  = 'lang:';
export const VALID_LANGS  = ['en', 'fr', 'rw', 'sw', 'de'];
export const LANGUAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
