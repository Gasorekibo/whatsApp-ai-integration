import i18next from '../config/i18n.js';
import dbConfig from '../models/index.js';
import { Op } from 'sequelize';
import dotenv from 'dotenv';
import logger from '../logger/logger.js';
import ragService from '../services/rag.service.js';
import { redisSetNx, redisGet, redisSet } from '../utils/redis.js';

const SERVICES_CACHE_TTL = 60 * 60;

import { extractWebhookPayload } from '../utils/extractors.js';
import { resolveClient } from '../services/clientService.js';
import { sendMessage, transcribeAudio } from '../services/whatsappService.js';
import { processAI } from '../services/aiService.js';
import { sendServiceList } from '../helpers/whatsapp/sendServiceList.js';
import {
  sendLanguageSelectionList,
  LANG_PREFIX,
  VALID_LANGS,
  LANGUAGE_TTL_MS
} from '../helpers/whatsapp/sendLanguageSelectionList.js';

dotenv.config();

export const whatsappSessions = new Map();

function hasValidLanguage(session) {
  return (
    session.language &&
    session.languageSetAt &&
    Date.now() - new Date(session.languageSetAt).getTime() < LANGUAGE_TTL_MS
  );
}

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

    // ── Redis fast-path dedup — avoids opening a DB transaction for duplicates ──
    const clientId = client?.id || null;
    const dedupKey = `msgdedup:${messageId}:${clientId ?? 'null'}`;
    const redisDedup = await redisSetNx(dedupKey, '1', 300); // 5-min TTL
    if (redisDedup === false) {
      logger.whatsapp('info', 'Deduplication: message already processed (Redis)', { requestId, messageId });
      return;
    }
    // null → Redis unavailable, fall through to DB dedup below

    // Helper bound to this request's client so call sites stay clean
    const send = (to, message) => sendMessage({ client, to, message });

    await dbConfig.db.sequelize.transaction(async (t) => {

      // 1. DB deduplication — backup for when Redis is unavailable
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

      // 3. Language preference gate — runs before all message-type routing.
      //    A language selection interactive reply bypasses this gate so the user
      //    can complete the selection even if they first sent a text message.
      const isLangReply = msg.type === 'interactive' &&
                          msg.interactive?.type === 'list_reply' &&
                          msg.interactive.list_reply.id?.startsWith(LANG_PREFIX);

      if (!isLangReply && !hasValidLanguage(session)) {
        logger.whatsapp('info', 'No valid language preference — prompting selection', {
          requestId,
          from: `***${from.slice(-4)}`,
          hasLanguage: !!session.language,
          isExpired: session.languageSetAt
            ? Date.now() - new Date(session.languageSetAt).getTime() >= LANGUAGE_TTL_MS
            : false
        });
        // Preserve the user's first message so we can process it once they pick a language.
        const pendingContent = msg.type === 'text' ? msg.text?.body : null;
        session.state = { ...session.state, awaitingLanguage: true, pendingMessage: pendingContent };
        session.changed('state', true);
        await session.save({ transaction: t });
        await sendLanguageSelectionList(from, client);
        return;
      }

      // 4. Route by message type
      if (isLangReply) {
        // ── Language selection ──────────────────────────────────────────────
        const langCode = msg.interactive.list_reply.id.slice(LANG_PREFIX.length);

        if (!VALID_LANGS.includes(langCode)) {
          logger.whatsapp('warn', 'Unknown lang code in list reply', { requestId, langCode });
          await sendLanguageSelectionList(from, client);
          return;
        }

        const pendingMessage = session.state.pendingMessage || null;

        session.language      = langCode;
        session.languageSetAt = new Date();
        session.state         = { ...session.state, awaitingLanguage: false, pendingMessage: null };
        session.changed('state', true);
        await session.save({ transaction: t });

        logger.whatsapp('info', 'Language preference saved', { requestId, from: `***${from.slice(-4)}`, langCode });

        const t_lang = i18next.getFixedT(langCode);
        await send(from, t_lang('language_selected_confirmation'));

        if (pendingMessage?.trim()) {
          // Process the user's first message now that we know their language
          const userEmail = session.state.email || null;
          const response  = await processAI({ client, from, message: pendingMessage, history: session.history, userEmail, language: langCode });

          if (response.showServices) {
            await sendServiceList(from, langCode, client);
            session.history.push({ role: 'user',  content: pendingMessage,       language: langCode, timestamp: new Date() });
            session.history.push({ role: 'model', content: 'Service list shown', language: langCode, timestamp: new Date() });
          } else if (response.reply) {
            await send(from, response.reply);
            session.history.push({ role: 'user',  content: pendingMessage,  language: langCode, timestamp: new Date() });
            session.history.push({ role: 'model', content: response.reply,  language: langCode, timestamp: new Date() });
          } else {
            await sendServiceList(from, langCode, client);
          }
          session.changed('history', true);
          await session.save({ transaction: t });
        } else {
          await sendServiceList(from, langCode, client);
        }

      } else if (msg.type === 'text') {
        // ── Text message ────────────────────────────────────────────────────
        const text         = msg.text.body.trim().toLowerCase();
        const originalText = msg.text.body.trim();
        const locale       = session.language; // guaranteed valid by gate above

        logger.whatsapp('info', 'Text message received', {
          requestId,
          from: `***${from.slice(-4)}`,
          messageLength: originalText.length,
          isCommand: ['menu', 'restart'].includes(text),
          isNewUser,
          locale
        });

        if (['menu', 'restart'].includes(text)) {
          logger.whatsapp('info', 'Resetting session — user typed ' + text, { requestId, from: `***${from.slice(-4)}` });
          await sendServiceList(from, locale, client);
          session.history = [];
          session.state   = { selectedService: null, pendingBooking: null };
          whatsappSessions.delete(from);
          await session.save({ transaction: t });
          return;
        }

        const userEmail = session.state.email || null;
        const response  = await processAI({ client, from, message: msg.text.body, history: session.history, userEmail, language: locale });

        if (response.showServices) {
          await sendServiceList(from, locale, client);
          session.history.push({ role: 'user',  content: msg.text.body,       language: locale, timestamp: new Date() });
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

          session.history.push({ role: 'user',  content: msg.text.body,  language: locale, timestamp: new Date() });
          session.history.push({ role: 'model', content: response.reply, language: locale, timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
        }

      } else if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
        // ── Service list selection ──────────────────────────────────────────
        const selectedId    = msg.interactive.list_reply.id;
        const selectedTitle = msg.interactive.list_reply.title;
        const locale        = session.language;

        logger.whatsapp('info', 'Interactive list selection received', { requestId, from: `***${from.slice(-4)}`, selectedId, selectedTitle });

        const svcKey   = `services:${clientId}`;
        let   services = await redisGet(svcKey);
        if (!services?.length) {
          const namespace = client?.pineconeIndex || clientId || 'default';
          services = await ragService.getServicesFromIndex(namespace);
          if (services?.length) await redisSet(svcKey, services, SERVICES_CACHE_TTL);
        }
        const service = services?.find(s => s.id === selectedId);

        if (service) {
          const response = await processAI({ client, from, message: `I'm interested in ${service.name}. I'd like to learn more about this service.`, history: session.history, userEmail: null, language: locale });

          if (response.reply) await send(from, response.reply);

          session.state.selectedService = service.id;
          session.history.push({ role: 'user',  content: `Selected: ${service.name}`,          language: locale, timestamp: new Date() });
          session.history.push({ role: 'model', content: response.reply || 'Service selected', language: locale, timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
        } else {
          const t_err = i18next.getFixedT(locale);
          await send(from, t_err('service_not_available'));
          await sendServiceList(from, locale, client);
        }

      } else if (msg.type === 'audio') {
        // ── Voice message ───────────────────────────────────────────────────
        const locale = session.language;

        logger.whatsapp('info', 'Audio message received', { requestId, from: `***${from.slice(-4)}`, mediaId: msg.audio?.id });

        if (client && !client.canUseVoice()) {
          logger.whatsapp('info', 'Voice rejected — plan does not include voice', { requestId, clientId: client.id, subscriptionPlan: client.subscriptionPlan });
          const t_voice = i18next.getFixedT(locale);
          await send(from, t_voice('voice_not_on_plan', 'Voice messages are not available on your current plan. Please send a text message instead.'));
          return;
        }

        let transcribedText;
        try {
          transcribedText = await transcribeAudio({ client, mediaId: msg.audio.id, mimeType: msg.audio.mime_type || 'audio/ogg; codecs=opus' });
        } catch (transcribeErr) {
          logger.error('Audio transcription failed', { error: transcribeErr.message });
          const t_err = i18next.getFixedT(locale);
          await send(from, t_err('audio_transcription_failed', "Sorry, I couldn't understand your voice message. Please try sending a text message instead."));
          return;
        }

        logger.whatsapp('info', 'Audio transcribed', { requestId, from: `***${from.slice(-4)}`, transcriptionLength: transcribedText.length });

        const userEmail = session.state.email || null;
        const response  = await processAI({ client, from, message: transcribedText, history: session.history, userEmail, language: locale });

        if (response.showServices) {
          await sendServiceList(from, locale, client);
          session.history.push({ role: 'user',  content: `[Voice] ${transcribedText}`, language: locale, timestamp: new Date() });
          session.history.push({ role: 'model', content: 'Service list shown',         language: locale, timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
          return;
        }

        if (response.reply) {
          await send(from, response.reply);
          session.history.push({ role: 'user',  content: `[Voice] ${transcribedText}`, language: locale, timestamp: new Date() });
          session.history.push({ role: 'model', content: response.reply,               language: locale, timestamp: new Date() });
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

// Cleanup old sessions hourly — distributed lock prevents duplicate work across instances
setInterval(async () => {
  const lockAcquired = await redisSetNx('lock:session-cleanup', '1', 120); // 2-min lock
  if (lockAcquired === false) {
    logger.info('Session cleanup skipped: another instance is running it');
    return;
  }
  // null → Redis unavailable, proceed anyway (safe for single-instance deployments)

  // Clear conversation history for sessions inactive > 24 h — preserves language
  // preference (tiny fields) while reclaiming the large JSONB history blobs.
  const historyCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Destroy the full session row only after 8 days (just beyond the 7-day language TTL).
  const sessionCutoff = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  try {
    await dbConfig.db.UserSession.update(
      { history: [], state: { selectedService: null } },
      { where: { lastAccess: { [Op.lt]: historyCutoff }, history: { [Op.ne]: [] } } }
    );
    await dbConfig.db.UserSession.destroy({ where: { lastAccess: { [Op.lt]: sessionCutoff } } });
    await dbConfig.db.ProcessedMessage.destroy({ where: { processedAt: { [Op.lt]: historyCutoff } } });
    whatsappSessions.clear();
    logger.info('Session cleanup completed');
  } catch (err) {
    logger.error('Session cleanup error', { error: err.message });
  }
}, 60 * 60 * 1000);

export { handleWebhook };
