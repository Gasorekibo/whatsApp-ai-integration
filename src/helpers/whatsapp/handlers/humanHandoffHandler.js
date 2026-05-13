import logger from '../../../logger/logger.js';

const HANDOFF_MESSAGES = {
  en: "✅ I've connected you with our team. A team member will be with you shortly.\n\nType *menu* at any time to return to the main menu.",
  fr: "✅ Je vous ai mis en contact avec notre équipe. Un membre de l'équipe vous répondra sous peu.\n\nTapez *menu* à tout moment pour revenir au menu principal.",
  rw: "✅ Nakuvugishije n'itsinda ryacu. Umuntu w'itsinda azakuganiriza vuba.\n\nAndika *menu* igihe icyo ari cyo cyose kugira ngo usubire ku menu nyamukuru.",
  sw: "✅ Nimekuunganisha na timu yetu. Mwanachama wa timu atakujibu hivi karibuni.\n\nAndika *menu* wakati wowote kurudi kwenye menyu kuu.",
  de: "✅ Ich habe Sie mit unserem Team verbunden. Ein Teammitglied wird sich in Kürze bei Ihnen melden.\n\nGeben Sie jederzeit *menu* ein, um zum Hauptmenü zurückzukehren."
};

/**
 * Pauses AI for the session and notifies the user that a human will respond.
 *
 * @param {object} session     - Sequelize UserSession instance (will be saved)
 * @param {object} client      - Resolved Client instance
 * @param {string} from        - User's phone number
 * @param {Function} send      - (to, message) => Promise  helper from controller
 * @param {object} transaction - Sequelize transaction
 */
export async function handleHumanHandoff(session, client, from, send, transaction) {
  const language = session.language || 'en';

  session.state = {
    ...session.state,
    activeIntent:   'handoff',
    aiPaused:       true,
    pausedAt:       new Date().toISOString()
  };
  session.changed('state', true);
  await session.save({ transaction });

  logger.whatsapp('info', 'Human handoff initiated', {
    clientId: client?.id,
    from: `***${String(from).slice(-4)}`
  });

  await send(from, HANDOFF_MESSAGES[language] || HANDOFF_MESSAGES.en);

  // TODO: notify client staff via email / WhatsApp / Slack webhook
  // e.g. await notifyStaff(client, from, session.history);
}
