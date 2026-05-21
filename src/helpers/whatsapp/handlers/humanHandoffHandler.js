import logger from '../../../logger/logger.js';

const HANDOFF_MESSAGES = {
  en: "✅ I've notified our team — a team member will reach out to you shortly.\n\nIn the meantime, I'm still here if you have any other questions! 😊",
  fr: "✅ J'ai informé notre équipe — un membre vous contactera sous peu.\n\nEn attendant, je suis toujours là si vous avez d'autres questions ! 😊",
  rw: "✅ Natangarije itsinda ryacu — umuntu azakuganiriza vuba.\n\nMuri iki gihe, nkiriho niba ufite andi makuru ushaka kumenya! 😊",
  sw: "✅ Nimewaarifu timu yetu — mwanachama atakuwasiliana nawe hivi karibuni.\n\nKwa sasa, bado nipo hapa kama una maswali mengine! 😊",
  de: "✅ Ich habe unser Team benachrichtigt — ein Teammitglied wird sich in Kürze bei Ihnen melden.\n\nIn der Zwischenzeit bin ich noch für weitere Fragen da! 😊"
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
    activeIntent:   'general',  // Stay active — bot keeps responding while team is notified
    aiPaused:       false,
    pausedAt:       null
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
