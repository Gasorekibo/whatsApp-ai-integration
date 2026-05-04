import i18next from '../config/i18n.js';
import googlesheets from '../utils/googlesheets.js';
import dbConfig from '../models/index.js';
import { Op } from 'sequelize';
import dotenv from 'dotenv';
import logger from '../logger/logger.js';
import ragService from '../services/rag.service.js';

import { extractWebhookPayload } from '../utils/extractors.js';
import { resolveClient } from '../services/clientService.js';
import { sendMessage, transcribeAudio } from '../services/whatsappService.js';
import { processAI } from '../services/aiService.js';
import { sendServiceList } from '../helpers/whatsapp/sendServiceList.js';

dotenv.config();

export const whatsappSessions = new Map();

const handleWebhook = async (req, res) => {
  const requestId = req.requestId || 'webhook-' + Date.now();
  res.status(200).send('OK');

  logger.whatsapp('info', 'WhatsApp webhook received', {
    requestId,
    hasBody: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : []
  });

  let client = null;
  try {
    const { phoneNumberId, message: msg, contact, statuses, value } = extractWebhookPayload(req.body);

    if (!value || statuses) {
      logger.whatsapp('debug', 'Webhook value missing or contains statuses', { requestId });
      return;
    }
    if (!msg) {
      logger.whatsapp('debug', 'No messages found in webhook', { requestId });
      return;
    }

    const from        = msg.from;
    const messageType = msg.type;
    const messageId   = msg.id;

    logger.whatsapp('info', 'Processing WhatsApp message', {
      requestId,
      from: `***${from.slice(-4)}`,
      messageId,
      messageType,
      phoneNumberId,
      contactName: contact?.profile?.name
    });

    // ── Resolve client BEFORE the transaction (uses in-memory cache) ──
    client = await resolveClient(phoneNumberId);

    if (client) {
      logger.whatsapp('debug', 'Client resolved', {
        requestId,
        clientId: client.id,
        subscriptionPlan:   client.subscriptionPlan,
        subscriptionStatus: client.subscriptionStatus
      });
    }

    // Helper bound to this request's client so call sites stay clean
    const send = (to, message) => sendMessage({ client, to, message });

    await dbConfig.db.sequelize.transaction(async (t) => {

      const clientId = client?.id || null;

      // 1. Strict message deduplication — scoped per client
      try {
        const [, created] = await dbConfig.db.ProcessedMessage.findOrCreate({
          where:    { messageId, clientId },
          defaults: { messageId, clientId, processedAt: new Date() },
          transaction: t
        });
        if (!created) {
          logger.whatsapp('info', 'Deduplication: message already processed', { requestId, messageId });
          return;
        }
      } catch (dedupErr) {
        if (dedupErr.name === 'SequelizeUniqueConstraintError') {
          logger.whatsapp('info', 'Deduplication: concurrency detected', { requestId, messageId });
          return;
        }
        throw dedupErr;
      }

      // 2. Find or create session — scoped per client so the same phone number
      //    across two different clients never shares conversation history
      let [session, isNewUser] = await dbConfig.db.UserSession.findOrCreate({
        where:    { phone: from, clientId },
        defaults: {
          name:       contact?.profile?.name || 'Client',
          phone:      from,
          clientId,
          history:    [],
          state:      { selectedService: null },
          lastAccess: new Date()
        },
        transaction: t
      });

      if (isNewUser) {
        logger.whatsapp('info', 'New user session created', { requestId, sessionId: session.id, from: `***${from.slice(-4)}` });
      } else {
        logger.whatsapp('info', 'Existing user session found', { requestId, sessionId: session.id, from: `***${from.slice(-4)}` });
        session.lastAccess = new Date();
        await session.save({ transaction: t });
      }

      // 3. Route by message type
      if (msg.type === 'text') {
        const text         = msg.text.body.trim().toLowerCase();
        const originalText = msg.text.body.trim();
        let locale;

        logger.whatsapp('info', 'Text message received', {
          requestId,
          from: `***${from.slice(-4)}`,
          messageLength: originalText.length,
          isCommand: ['menu', 'restart'].includes(text),
          isNewUser
        });

        const trulyNewUser = isNewUser && (!session.history || session.history.length === 0);

        if (trulyNewUser) {
          logger.whatsapp('info', 'Sending welcome message to new user', { requestId, from: `***${from.slice(-4)}` });
          locale = await ragService.detectLanguage(originalText, []);
          await sendServiceList(from, locale, client);
          session.history.push({ role: 'user',  content: msg.text.body, language: locale, timestamp: new Date() });
          session.history.push({ role: 'model', content: 'Service list shown', language: locale, timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
          return;
        }

        if (['menu', 'restart'].includes(text)) {
          logger.whatsapp('info', 'Resetting session — user typed ' + text, { requestId, from: `***${from.slice(-4)}` });
          const lastHistory = session.history?.slice().reverse().find(h => h.language);
          locale = lastHistory?.language || await ragService.detectLanguage(originalText, session.history);
          await sendServiceList(from, locale, client);
          session.history = [];
          session.state   = { selectedService: null, pendingBooking: null };
          whatsappSessions.delete(from);
          await session.save({ transaction: t });
          return;
        }

        const userEmail       = session.state.email || null;
        const userInputLang   = await ragService.detectCurrentLanguage(originalText);
        const response        = await processAI({ client, from, message: msg.text.body, history: session.history, userEmail, language: userInputLang });
        locale = response.language || userInputLang;

        if (response.showServices) {
          const serviceListLocale = session.history?.slice().reverse().find(h => h.role === 'user' && h.language)?.language || userInputLang;
          await sendServiceList(from, serviceListLocale, client);
          session.history.push({ role: 'user',  content: msg.text.body, language: userInputLang, timestamp: new Date() });
          session.history.push({ role: 'model', content: 'Service list shown', language: locale, timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
          return;
        }

        if (response.reply) {
          await send(from, response.reply);

          if (response.reply.includes('@') && !session.state.email) {
            const emailMatch = response.reply.match(/[\w.-]+@[\w.-]+\.\w+/);
            if (emailMatch) session.state.email = emailMatch[0];
          }

          session.history.push({ role: 'user',  content: msg.text.body, language: userInputLang, timestamp: new Date() });
          session.history.push({ role: 'model', content: response.reply, language: locale,       timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
        }

      } else if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
        const selectedId    = msg.interactive.list_reply.id;
        const selectedTitle = msg.interactive.list_reply.title;

        logger.whatsapp('info', 'Interactive list selection received', { requestId, from: `***${from.slice(-4)}`, selectedId, selectedTitle });

        const services = await googlesheets.getActiveServices(clientId);
        const service  = services.find(s => s.id === selectedId);

        if (service) {
          const historyLocale = session.history?.slice().reverse().find(h => h.role === 'user' && h.language)?.language || 'en';
          const response      = await processAI({ client, from, message: `I'm interested in ${service.name}. I'd like to learn more about this service.`, history: session.history, userEmail: null, language: historyLocale });
          const locale        = response.language || historyLocale;

          if (response.reply) await send(from, response.reply);

          session.state.selectedService = service.id;
          session.history.push({ role: 'user',  content: `Selected: ${service.name}`, language: locale, timestamp: new Date() });
          session.history.push({ role: 'model', content: response.reply || 'Service selected', language: locale, timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
        } else {
          const locale = session.history?.slice().reverse().find(h => h.role === 'user' && h.language)?.language || 'en';
          const t_err  = i18next.getFixedT(locale);
          await send(from, t_err('service_not_available'));
          await sendServiceList(from, locale, client);
        }

      } else if (msg.type === 'audio') {
        logger.whatsapp('info', 'Audio message received', { requestId, from: `***${from.slice(-4)}`, mediaId: msg.audio?.id });

        // Gate: voice requires message_and_voice plan
        if (client && !client.canUseVoice()) {
          logger.whatsapp('info', 'Voice rejected — plan does not include voice', { requestId, clientId: client.id, subscriptionPlan: client.subscriptionPlan });
          const locale  = session.history?.slice().reverse().find(h => h.language)?.language || 'en';
          const t_voice = i18next.getFixedT(locale);
          await send(from, t_voice('voice_not_on_plan', 'Voice messages are not available on your current plan. Please send a text message instead.'));
          return;
        }

        let transcribedText;
        try {
          transcribedText = await transcribeAudio({ client, mediaId: msg.audio.id, mimeType: msg.audio.mime_type || 'audio/ogg; codecs=opus' });
        } catch (transcribeErr) {
          logger.error('Audio transcription failed', { error: transcribeErr.message });
          const locale = session.history?.slice().reverse().find(h => h.language)?.language || 'en';
          const t_err  = i18next.getFixedT(locale);
          await send(from, t_err('audio_transcription_failed', "Sorry, I couldn't understand your voice message. Please try sending a text message instead."));
          return;
        }

        logger.whatsapp('info', 'Audio transcribed', { requestId, from: `***${from.slice(-4)}`, transcriptionLength: transcribedText.length });

        const userInputLang = await ragService.detectCurrentLanguage(transcribedText);
        const userEmail     = session.state.email || null;
        const response      = await processAI({ client, from, message: transcribedText, history: session.history, userEmail, language: userInputLang });
        const locale        = response.language || userInputLang;

        if (response.showServices) {
          const serviceListLocale = session.history?.slice().reverse().find(h => h.role === 'user' && h.language)?.language || userInputLang;
          await sendServiceList(from, serviceListLocale);
          session.history.push({ role: 'user',  content: `[Voice] ${transcribedText}`, language: userInputLang, timestamp: new Date() });
          session.history.push({ role: 'model', content: 'Service list shown',         language: locale,       timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
          return;
        }

        if (response.reply) {
          await send(from, response.reply);
          session.history.push({ role: 'user',  content: `[Voice] ${transcribedText}`, language: userInputLang, timestamp: new Date() });
          session.history.push({ role: 'model', content: response.reply,               language: locale,       timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
        }

      } else {
        logger.whatsapp('info', 'Unsupported message type', { requestId, from: `***${from.slice(-4)}`, messageType, messageId });
      }
    }); // end transaction

  } catch (err) {
    console.error('WhatsApp webhook error', err);
    logger.error('WhatsApp webhook error', { requestId, error: err.message, stack: err.stack, errorType: err.constructor.name });
    try {
      const from = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
      if (from) await sendMessage({ client, to: from, message: "We're sorry, something unexpected happened on our end while handling your message. Please try again in a moment, or type 'menu' to start over." });
    } catch (sendErr) {
      logger.error('Error sending failure response', { error: sendErr.message });
    }
  }
};

// Cleanup old sessions hourly
setInterval(async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    await dbConfig.db.UserSession.destroy({ where: { lastAccess:   { [Op.lt]: cutoff } } });
    await dbConfig.db.ProcessedMessage.destroy({ where: { processedAt: { [Op.lt]: cutoff } } });
    whatsappSessions.clear();
  } catch (err) {
    logger.error('Session cleanup error', { error: err.message });
  }
}, 60 * 60 * 1000);

export { handleWebhook };
