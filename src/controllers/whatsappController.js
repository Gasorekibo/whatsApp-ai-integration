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
import { sendIntentList, INTENT_PREFIX, VALID_INTENTS } from '../helpers/whatsapp/sendIntentList.js';
import { handleOrderRouting, ORDER_PREFIX, VALID_ORDER_TYPES } from '../helpers/whatsapp/handlers/orderHandler.js';
import { handleHumanHandoff } from '../helpers/whatsapp/handlers/humanHandoffHandler.js';
import { handleGeneralInquiry } from '../helpers/whatsapp/handlers/generalInquiryHandler.js';

dotenv.config();

export const whatsappSessions = new Map();

// ── Language preference helpers ───────────────────────────────────────────────

function hasValidLanguage(session) {
  return (
    session.language &&
    session.languageSetAt &&
    Date.now() - new Date(session.languageSetAt).getTime() < LANGUAGE_TTL_MS
  );
}

// ── Quick intent detection (keyword shortcuts bypass the intent list) ─────────

const QUICK_INTENT_MAP = [
  ['handoff',  /\b(human|agent|person|staff|team|talk to|speak to|representative)\b/i],
  ['order',    /\b(book|appointment|schedule|pay(?:ment)?|order|status|track|reservation)\b/i],
  ['services', /\b(services?|products?|pricing|price|cost|offer|provide)\b/i],
  ['general',  /\b(contact|phone|email|address|location|hours|website|where are you|when are you|open|close)\b/i],
];

function detectQuickIntent(text) {
  for (const [intent, regex] of QUICK_INTENT_MAP) {
    if (regex.test(text)) return intent;
  }
  return null;
}

// Prompt shown after user selects the "general inquiries" intent
const GENERAL_PROMPTS = {
  en: "What would you like to know? Ask about our contact info, hours, location, or FAQs.",
  fr: "Que souhaitez-vous savoir? Posez vos questions sur nos coordonnées, horaires ou FAQ.",
  rw: "Ni iki ushaka kumenya? Baza ibibazo ku turika, amasaha cyangwa ibibazo bikunze kubazwa.",
  sw: "Ungependa kujua nini? Uliza kuhusu mawasiliano, saa za kazi au maswali ya kawaida.",
  de: "Was möchten Sie wissen? Fragen Sie nach Kontaktdaten, Öffnungszeiten oder FAQs."
};

// Kick-off messages sent when an order sub-type is selected
const ORDER_TRIGGER = {
  booking: { en: "I'd like to book an appointment.", fr: "Je souhaite prendre rendez-vous.", rw: "Ndashaka gufata gahunda.", sw: "Ningependa kuweka miadi.", de: "Ich möchte einen Termin buchen." },
  payment: { en: "I'd like to make a payment.", fr: "Je souhaite effectuer un paiement.", rw: "Ndashaka gukora ubwishyu.", sw: "Ningependa kufanya malipo.", de: "Ich möchte eine Zahlung vornehmen." },
  status:  { en: "I'd like to check my order or booking status.", fr: "Je souhaite vérifier le statut de ma commande.", rw: "Ndashaka kureba aho iteka ryangye ryageze.", sw: "Ningependa kuangalia hali ya agizo langu.", de: "Ich möchte den Status meiner Bestellung prüfen." },
};

// ── History persistence helper ────────────────────────────────────────────────

function pushHistory(session, locale, userContent, modelContent) {
  session.history.push({ role: 'user',  content: userContent,  language: locale, timestamp: new Date() });
  session.history.push({ role: 'model', content: modelContent, language: locale, timestamp: new Date() });
  session.changed('history', true);
}

// ── Webhook handler ───────────────────────────────────────────────────────────

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

    client = await resolveClient(phoneNumberId);

    if (client) {
      logger.whatsapp('debug', 'Client resolved', {
        requestId,
        clientId: client.id,
        subscriptionPlan:   client.subscriptionPlan,
        subscriptionStatus: client.subscriptionStatus
      });
    }

    const clientId = client?.id || null;
    const dedupKey = `msgdedup:${messageId}:${clientId ?? 'null'}`;
    const redisDedup = await redisSetNx(dedupKey, '1', 300);
    if (redisDedup === false) {
      logger.whatsapp('info', 'Deduplication: message already processed (Redis)', { requestId, messageId });
      return;
    }

    const send = (to, message) => sendMessage({ client, to, message });

    await dbConfig.db.sequelize.transaction(async (t) => {

      // 1. DB deduplication
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

      // 2. Find or create session
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

      // 3. Language preference gate
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
        const pendingContent = msg.type === 'text' ? msg.text?.body : null;
        session.state = { ...session.state, awaitingLanguage: true, pendingMessage: pendingContent };
        session.changed('state', true);
        await session.save({ transaction: t });
        await sendLanguageSelectionList(from, client);
        return;
      }

      // 4. Route by message type / payload

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
          // Process the first message now that we know their language
          const userEmail = session.state.email || null;
          const response  = await processAI({ client, from, message: pendingMessage, history: session.history, userEmail, language: langCode, isNewUser });

          if (response.showServices) {
            await sendServiceList(from, langCode, client);
            pushHistory(session, langCode, pendingMessage, 'Service list shown');
          } else if (response.reply) {
            await send(from, response.reply);
            pushHistory(session, langCode, pendingMessage, response.reply);
          } else {
            await sendIntentList(from, client, langCode);
          }
          await session.save({ transaction: t });
        } else {
          await sendIntentList(from, client, langCode);
        }

      } else if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
        // ── Interactive list reply ──────────────────────────────────────────
        const selectedId    = msg.interactive.list_reply.id;
        const selectedTitle = msg.interactive.list_reply.title;
        const locale        = session.language;

        logger.whatsapp('info', 'Interactive list selection received', { requestId, from: `***${from.slice(-4)}`, selectedId, selectedTitle });

        if (selectedId.startsWith(INTENT_PREFIX)) {
          // ── Intent selection ──────────────────────────────────────────────
          const intent = selectedId.slice(INTENT_PREFIX.length);

          if (!VALID_INTENTS.includes(intent)) {
            logger.whatsapp('warn', 'Unknown intent in list reply', { requestId, intent });
            await sendIntentList(from, client, locale);
            return;
          }

          // Clear order sub-type when a fresh intent is picked
          session.state = { ...session.state, activeIntent: intent, activeOrderType: null, aiPaused: intent === 'handoff' };
          session.changed('state', true);

          if (intent === 'handoff') {
            await handleHumanHandoff(session, client, from, send, t);
            return;
          }

          if (intent === 'order') {
            await session.save({ transaction: t });
            await handleOrderRouting(from, client, locale);
            return;
          }

          if (intent === 'services') {
            await session.save({ transaction: t });
            await sendServiceList(from, locale, client);
            return;
          }

          // general — prompt the user to ask their question
          await session.save({ transaction: t });
          await send(from, GENERAL_PROMPTS[locale] || GENERAL_PROMPTS.en);

        } else if (selectedId.startsWith(ORDER_PREFIX)) {
          // ── Order sub-type selection ──────────────────────────────────────
          const orderType = selectedId.slice(ORDER_PREFIX.length);

          if (!VALID_ORDER_TYPES.includes(orderType)) {
            logger.whatsapp('warn', 'Unknown order type in list reply', { requestId, orderType });
            await handleOrderRouting(from, client, locale);
            return;
          }

          session.state = { ...session.state, activeIntent: 'order', activeOrderType: orderType };
          session.changed('state', true);
          await session.save({ transaction: t });

          const triggerMsg = ORDER_TRIGGER[orderType]?.[locale] || ORDER_TRIGGER[orderType]?.en;
          const userEmail  = session.state.email || null;
          const response   = await processAI({
            client, from, message: triggerMsg, history: session.history,
            userEmail, language: locale, activeIntent: 'order', activeOrderType: orderType
          });

          if (response.showServices) {
            await sendServiceList(from, locale, client);
            pushHistory(session, locale, triggerMsg, 'Service list shown');
          } else if (response.reply) {
            await send(from, response.reply);
            pushHistory(session, locale, triggerMsg, response.reply);
          }
          await session.save({ transaction: t });

        } else {
          // ── Service list selection (existing logic) ───────────────────────
          const svcKey   = `services:${clientId}`;
          let   services = await redisGet(svcKey);
          if (!services?.length) {
            const namespace = client?.pineconeIndex || clientId || 'default';
            services = await ragService.getServicesFromIndex(namespace);
            if (services?.length) await redisSet(svcKey, services, SERVICES_CACHE_TTL);
          }
          const service = services?.find(s => s.id === selectedId);

          if (service) {
            const activeIntent    = session.state.activeIntent    || null;
            const activeOrderType = session.state.activeOrderType || null;
            const response = await processAI({
              client, from,
              message: `I'm interested in ${service.name}. I'd like to learn more about this service.`,
              history: session.history,
              userEmail: null,
              language: locale,
              activeIntent,
              activeOrderType
            });

            if (response.reply) await send(from, response.reply);

            session.state.selectedService = service.id;
            pushHistory(session, locale, `Selected: ${service.name}`, response.reply || 'Service selected');
            await session.save({ transaction: t });
          } else {
            const t_err = i18next.getFixedT(locale);
            await send(from, t_err('service_not_available'));
            await sendIntentList(from, client, locale);
          }
        }

      } else if (msg.type === 'text') {
        // ── Text message ────────────────────────────────────────────────────
        const text         = msg.text.body.trim().toLowerCase();
        const originalText = msg.text.body.trim();
        const locale       = session.language;
        const activeIntent    = session.state.activeIntent    || null;
        const activeOrderType = session.state.activeOrderType || null;
        const aiPaused        = session.state.aiPaused        || false;

        logger.whatsapp('info', 'Text message received', {
          requestId,
          from: `***${from.slice(-4)}`,
          messageLength: originalText.length,
          activeIntent,
          activeOrderType,
          aiPaused,
          locale
        });

        // menu / restart — always allowed, even during handoff
        if (['menu', 'restart'].includes(text)) {
          logger.whatsapp('info', 'Resetting session — user typed ' + text, { requestId, from: `***${from.slice(-4)}` });
          session.history = [];
          session.state   = { selectedService: null, pendingBooking: null, activeIntent: null, activeOrderType: null, aiPaused: false };
          session.changed('state', true);
          whatsappSessions.delete(from);
          await session.save({ transaction: t });
          await sendIntentList(from, client, locale);
          return;
        }

        // During human handoff — drop messages silently (agent will reply manually)
        if (aiPaused) {
          logger.whatsapp('info', 'Message dropped: AI paused for human handoff', { requestId, from: `***${from.slice(-4)}` });
          return;
        }

        // No intent set — detect from keywords or show intent list
        if (!activeIntent) {
          const quickIntent = detectQuickIntent(originalText);
          if (quickIntent) {
            // Set intent in session and fall through to intent-specific routing below
            session.state = { ...session.state, activeIntent: quickIntent, activeOrderType: null };
            session.changed('state', true);
            await session.save({ transaction: t });

            if (quickIntent === 'handoff') {
              await handleHumanHandoff(session, client, from, send, t);
              return;
            }
            if (quickIntent === 'order') {
              await handleOrderRouting(from, client, locale);
              return;
            }
            // For general/services, fall through to processing below with the detected intent
          } else {
            await sendIntentList(from, client, locale);
            return;
          }
        }

        // Re-read activeIntent after potential quick-intent update
        const resolvedIntent    = session.state.activeIntent    || null;
        const resolvedOrderType = session.state.activeOrderType || null;

        const userEmail = session.state.email || null;

        // ── Route by active intent ──────────────────────────────────────────

        if (resolvedIntent === 'general') {
          // Try JSON file first; fall through to RAG if it can't answer
          const jsonReply = await handleGeneralInquiry(originalText, session, client);
          if (jsonReply) {
            await send(from, jsonReply);
            pushHistory(session, locale, originalText, jsonReply);
            await session.save({ transaction: t });
            return;
          }
          // Fall through to processAI (RAG will answer)
        }

        if (resolvedIntent === 'order' && !resolvedOrderType) {
          // User typed something without picking a sub-type — show sub-menu again
          await handleOrderRouting(from, client, locale);
          return;
        }

        const response = await processAI({
          client, from, message: msg.text.body,
          history: session.history,
          userEmail,
          language: locale,
          activeIntent:    resolvedIntent,
          activeOrderType: resolvedOrderType,
          isNewUser,
          userName: session.name || null
        });

        if (response.showServices) {
          await sendServiceList(from, locale, client);
          pushHistory(session, locale, msg.text.body, 'Service list shown');
          await session.save({ transaction: t });
          return;
        }

        if (response.reply) {
          await send(from, response.reply);

          if (response.reply.includes('@') && !session.state.email) {
            const emailMatch = response.reply.match(/[\w.-]+@[\w.-]+\.\w+/);
            if (emailMatch) session.state.email = emailMatch[0];
          }

          pushHistory(session, locale, msg.text.body, response.reply);
          await session.save({ transaction: t });
        }

      } else if (msg.type === 'audio') {
        // ── Voice message ───────────────────────────────────────────────────
        const locale          = session.language;
        const activeIntent    = session.state.activeIntent    || null;
        const activeOrderType = session.state.activeOrderType || null;
        const aiPaused        = session.state.aiPaused        || false;

        logger.whatsapp('info', 'Audio message received', { requestId, from: `***${from.slice(-4)}`, mediaId: msg.audio?.id });

        if (aiPaused) {
          logger.whatsapp('info', 'Audio dropped: AI paused for human handoff', { requestId, from: `***${from.slice(-4)}` });
          return;
        }

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
        const response  = await processAI({
          client, from, message: transcribedText,
          history: session.history,
          userEmail,
          language: locale,
          activeIntent,
          activeOrderType
        });

        if (response.showServices) {
          await sendServiceList(from, locale, client);
          pushHistory(session, locale, `[Voice] ${transcribedText}`, 'Service list shown');
          await session.save({ transaction: t });
          return;
        }

        if (response.reply) {
          await send(from, response.reply);
          pushHistory(session, locale, `[Voice] ${transcribedText}`, response.reply);
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
  const lockAcquired = await redisSetNx('lock:session-cleanup', '1', 120);
  if (lockAcquired === false) {
    logger.info('Session cleanup skipped: another instance is running it');
    return;
  }

  // Clear conversation history for sessions inactive > 24 h — preserves language preference
  const historyCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Destroy the full session row only after 8 days (just beyond the 7-day language TTL)
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
