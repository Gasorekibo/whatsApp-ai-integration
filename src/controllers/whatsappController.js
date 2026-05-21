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
import {
  handleOrderRouting, handleBookingTypeRouting, getClientBookingTypes,
  ORDER_PREFIX, BOOKING_TYPE_PREFIX,
  VALID_ORDER_TYPES, VALID_BOOKING_TYPES,
} from '../helpers/whatsapp/handlers/orderHandler.js';
import { handleHumanHandoff } from '../helpers/whatsapp/handlers/humanHandoffHandler.js';
import { handleGeneralInquiry } from '../helpers/whatsapp/handlers/generalInquiryHandler.js';
import { classifyIntent } from '../services/intentClassifier.service.js';
import {
  startBookingFlow, startRestaurantBookingFlow, startHotelBookingFlow,
  handleDaySelection, handleSlotSelection, handleBookingTextReply,
  showAvailableDays,
  DAY_PREFIX, SLOT_PREFIX, BOOKING_SVC_PREFIX,
  BOOKING_CONFIRM_BTN, BOOKING_CANCEL_BTN,
} from '../helpers/whatsapp/handlers/bookingHandler.js';

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
  // Handoff keywords must be explicit "I want a human" phrases.
  // Broad words like "team", "staff", "person" are intentionally excluded —
  // they appear in normal questions ("contact your team", "your staff hours").
  ['handoff',  /\b(talk to (?:a |an )?(human|agent|person|someone)|speak to (?:a |an )?(human|agent|person|someone)|connect me to|real (human|agent|person)|live (agent|support|chat)|representative|muntu|umuntu|msaada wa binadamu|menschlich|agente humano)\b/i],
  // order: English + French + Kinyarwanda (gufata, kuza, kwiza, naza, nshaka kuza, ndashaka) + Swahili (miadi, ninataka kuja, nataka) + German
  // NOTE: "pay/payment" intentionally omitted — too ambiguous (e.g. "how much do I pay for a motorbike").
  //       Payment-as-booking intent is handled by the Gemini classifier which has full context.
  ['order',    /\b(books?|appointments?|schedule|orders?|status|track|reservations?|slots?|consult(?:ation)?s?|come in|i('ll| will) come|want to come|i'd like to visit|gufata|kuza|kwiza|nshaka kuza|ndashaka kuza|rendez-vous|je veux venir|miadi|ninataka kuja|nataka kuja|termin|ich möchte kommen)\b/i],
  ['services', /\b(services?|products?|pric(?:e|ing)|costs?|offer|provide|serivisi|ubuvuzi|prix|huduma|leistung)\b/i],
  ['general',  /\b(contact|phone|email|address|location|hours|website|where are you|when are you|open|close|aho|amasaha|où|horaires|mahali|saa|standort|öffnungszeiten)\b/i],
];

function detectQuickIntent(text) {
  for (const [intent, regex] of QUICK_INTENT_MAP) {
    if (regex.test(text)) return intent;
  }
  return null;
}

// Phrases that are continuations of a conversation, not new intent signals.
// When a user has an active intent and sends one of these, route to AI normally.
const CONTINUATION_RE = /^(ok|okay|thanks|thank you|merci|murakoze|asante|danke|alright|great|got it|sure|yes|no|yep|nope|hi|hello|hey|good|perfect|understood|i see|noted|👍|😊|🙏|nice|cool|wow|really|interesting|oh|ah|hm+|lol|haha|neza|sawa|yego|oya|ndio|hapana|bien|d'accord|oui|non|ja|nein|ça va|super)[\s!.?]*$/i;

function isContinuation(text) {
  return CONTINUATION_RE.test(text.trim());
}

// Keywords that reset the session to the intent list — multilingual.
const RESTART_WORDS = new Set([
  'menu', 'restart', 'start', 'start over', 'reset',
  'retour', 'recommencer', 'accueil',           // French
  'tangira', 'subira', 'ongera',                // Kinyarwanda
  'anza', 'rudi', 'mwanzo',                    // Kiswahili
  'zurück', 'neustart', 'hauptmenü',           // German
]);

function isRestartCommand(text) {
  return RESTART_WORDS.has(text.toLowerCase().trim());
}

// How long (ms) a handoff can stay paused before AI auto-resumes.
const HANDOFF_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Prompt shown after user selects the "general inquiries" intent
const GENERAL_PROMPTS = {
  en: "Thank you for choosing General Inquiries. What would you like to know? Ask about our contact info, hours, location or FAQs.",
  fr: "Merci d’avoir choisi les demandes générales. Que souhaitez-vous savoir ? Posez des questions sur nos coordonnées, nos horaires, notre emplacement ou notre FAQ",
  rw: "Murakoze guhitamo ibibazo rusange. Ni iki wifuza kumenya? Baza ku makuru y’itumanaho, amasaha dukoreraho, aho duherereye cyangwa ibibazo bikunze kubazwa.",
  sw: "Asante kwa kuchagua Maswali ya Jumla. Ungependa kujua nini? Uliza kuhusu mawasiliano yetu, saa za kazi, eneo au maswali yanayoulizwa mara kwa mara (FAQs).",
  de: "Vielen Dank, dass Sie Allgemeine Anfragen gewählt haben. Was möchten Sie wissen? Fragen Sie nach unseren Kontaktdaten, Öffnungszeiten, Standort oder FAQs."
};

// Kick-off messages sent when an order sub-type is selected
const ORDER_TRIGGER = {
  booking: { en: "I'd like to book an appointment.", fr: "Je souhaite prendre rendez-vous.", rw: "Ndashaka gufata gahunda.", sw: "Ningependa kuweka miadi.", de: "Ich möchte einen Termin buchen." },
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

        // Reset intent state if the session has been idle for more than 2 hours.
        // Prevents stale activeIntent (e.g. 'order' with no sub-type) from persisting
        // across separate conversations.
        const SESSION_INTENT_TTL_MS = 2 * 60 * 60 * 1000;
        const idleMs = Date.now() - new Date(session.lastAccess).getTime();
        if (idleMs > SESSION_INTENT_TTL_MS) {
          session.state = {
            ...session.state,
            activeIntent:        null,
            activeOrderType:     null,
            booking:             null,
            selectedService:     null,
            selectedServiceName: null,
            aiPaused:            false,
            pausedAt:            null,
          };
          session.changed('state', true);
          logger.whatsapp('info', 'Session intent cleared after idle timeout', { requestId, idleMs });
        }

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
        // Greet new users before asking language preference
        if (isNewUser) {
          const userName   = contact?.profile?.name || session.name || 'there';
          const botName    = client?.botName || 'AI Assistant';
          const clientName = client?.name    || '';
          const greeting   = `Hello ${userName}! 👋\n\nI'm *${botName}*${clientName ? `, an AI assistant for *${clientName}*` : ''}.\nI'm glad to have you and ready to help! 🙂`;
          await send(from, greeting);
        }

        // Ignore the triggering message — intent list shown after language selection
        // gives the user a clean, structured starting point.
        session.state = { ...session.state, awaitingLanguage: true };
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

        session.language      = langCode;
        session.languageSetAt = new Date();
        session.state         = { ...session.state, awaitingLanguage: false };
        session.changed('state', true);
        await session.save({ transaction: t });

        logger.whatsapp('info', 'Language preference saved', { requestId, from: `***${from.slice(-4)}`, langCode });

        const t_lang = i18next.getFixedT(langCode);
        await send(from, t_lang('language_selected_confirmation'));
        await sendIntentList(from, client, langCode);

      } else if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
        // ── Reply-button tap (booking confirm / cancel) ─────────────────────
        const buttonId = msg.interactive.button_reply?.id;
        const locale   = session.language;

        logger.whatsapp('info', 'Button reply received', { requestId, from: `***${from.slice(-4)}`, buttonId });

        if (buttonId === BOOKING_CONFIRM_BTN || buttonId === BOOKING_CANCEL_BTN) {
          const activeOrderType = session.state.activeOrderType || null;
          const booking         = session.state.booking;

          if (activeOrderType === 'booking' && booking?.step === 'await_confirm') {
            const saveSession = async () => { session.changed('state', true); await session.save({ transaction: t }); };
            // Reuse the text handler — 'yes'/'no' are in the CONFIRM_YES/NO sets
            const syntheticText = buttonId === BOOKING_CONFIRM_BTN ? 'yes' : 'no';
            await handleBookingTextReply(from, client, session, syntheticText, locale, send, saveSession);
            await session.save({ transaction: t });
          } else {
            logger.whatsapp('warn', 'Booking button tapped outside confirm step — ignored', { requestId, buttonId });
          }
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

        } else if (selectedId.startsWith(BOOKING_TYPE_PREFIX)) {
          // ── Booking type selection (calendar / restaurant / hotel) ────────
          const bookingType = selectedId.slice(BOOKING_TYPE_PREFIX.length);

          if (!VALID_BOOKING_TYPES.includes(bookingType)) {
            logger.whatsapp('warn', 'Unknown booking type in list reply', { requestId, bookingType });
            await handleBookingTypeRouting(from, client, locale);
            return;
          }

          logger.whatsapp('info', 'Booking type selected', { requestId, bookingType, from: `***${from.slice(-4)}` });

          session.state = { ...session.state, activeIntent: 'order', activeOrderType: 'booking' };
          session.changed('state', true);
          await session.save({ transaction: t });
          const saveSession = async () => { session.changed('state', true); await session.save({ transaction: t }); };

          if (bookingType === 'restaurant') {
            await startRestaurantBookingFlow(from, client, session, locale, send, saveSession);
          } else if (bookingType === 'hotel') {
            await startHotelBookingFlow(from, client, session, locale, send, saveSession);
          } else {
            await startBookingFlow(from, client, session, locale, send, saveSession);
          }
          await session.save({ transaction: t });

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

          if (orderType === 'booking') {
            const bookingTypes = getClientBookingTypes(client);
            if (bookingTypes.length === 1) {
              // Auto-select the only type — no sub-menu needed
              const singleType  = bookingTypes[0];
              session.state     = { ...session.state, activeIntent: 'order', activeOrderType: 'booking' };
              session.changed('state', true);
              await session.save({ transaction: t });
              const saveSession = async () => { session.changed('state', true); await session.save({ transaction: t }); };
              if (singleType === 'restaurant') {
                await startRestaurantBookingFlow(from, client, session, locale, send, saveSession);
              } else if (singleType === 'hotel') {
                await startHotelBookingFlow(from, client, session, locale, send, saveSession);
              } else {
                await startBookingFlow(from, client, session, locale, send, saveSession);
              }
              await session.save({ transaction: t });
            } else {
              // Multiple types — show filtered sub-menu
              await handleBookingTypeRouting(from, client, locale);
              await session.save({ transaction: t });
            }
          } else {
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
          }

        } else if (selectedId.startsWith(DAY_PREFIX)) {
          // ── Calendar day selection (booking flow — step 1) ────────────────
          const dayIndex   = parseInt(selectedId.slice(DAY_PREFIX.length), 10);
          const saveSession = async () => { session.changed('state', true); await session.save({ transaction: t }); };
          await handleDaySelection(from, client, session, dayIndex, locale, send, saveSession);
          await session.save({ transaction: t });

        } else if (selectedId.startsWith(SLOT_PREFIX)) {
          // ── Calendar time-slot selection (booking flow — step 2) ──────────
          const slotIndex  = parseInt(selectedId.slice(SLOT_PREFIX.length), 10);
          const saveSession = async () => { session.changed('state', true); await session.save({ transaction: t }); };
          await handleSlotSelection(from, client, session, slotIndex, locale, send, saveSession);
          await session.save({ transaction: t });

        } else if (selectedId.startsWith(BOOKING_SVC_PREFIX)) {
          // ── Booking-flow service selection (interactive list, ≤ 10 services) ──
          const svcIndex  = parseInt(selectedId.slice(BOOKING_SVC_PREFIX.length), 10);
          const svcKey    = `services:${clientId}`;
          let   services  = await redisGet(svcKey);
          if (!services?.length) {
            const namespace = client?.pineconeIndex || clientId || 'default';
            services = await ragService.getServicesFromIndex(namespace);
            if (services?.length) await redisSet(svcKey, services, SERVICES_CACHE_TTL);
          }
          const pickedSvc = services?.[svcIndex];
          if (!pickedSvc) {
            logger.whatsapp('warn', 'bsvc index out of range', { requestId, svcIndex });
            await startBookingFlow(from, client, session, locale, send,
              async () => { session.changed('state', true); await session.save({ transaction: t }); });
            await session.save({ transaction: t });
          } else {
            const b = session.state.booking;
            if (b && session.state.activeOrderType === 'booking') {
              b.serviceName = pickedSvc.name;
              b.step        = 'await_day';
              session.changed('state', true);
              await session.save({ transaction: t });
              const saveSession = async () => { session.changed('state', true); await session.save({ transaction: t }); };
              await showAvailableDays(from, client, session, locale, send, saveSession);
              await session.save({ transaction: t });
            } else {
              // Stale tap outside booking flow — ignore
              logger.whatsapp('warn', 'bsvc tap ignored: not in booking flow', { requestId });
            }
          }

        } else {
          // ── Service list selection (existing logic) ───────────────────────
          const svcKey   = `services:${clientId}`;
          let   services = await redisGet(svcKey);
          if (!services?.length) {
            const namespace = client?.pineconeIndex || clientId || 'default';
            services = await ragService.getServicesFromIndex(namespace);
            if (services?.length) await redisSet(svcKey, services, SERVICES_CACHE_TTL);
          }
          // Match by ID (interactive list tap) or by name slug (plain-text fallback reply)
          const service = services?.find(s => s.id === selectedId)
            ?? services?.find(s => {
              const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
              return `svc-${slug}` === selectedId;
            });

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

            session.state.selectedService     = service.id;
            session.state.selectedServiceName = service.name;
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

        // menu / restart — always allowed, even during handoff (multilingual)
        if (isRestartCommand(text)) {
          logger.whatsapp('info', 'Resetting session — user typed ' + text, { requestId, from: `***${from.slice(-4)}` });
          session.history = [];
          session.state   = { selectedService: null, selectedServiceName: null, pendingBooking: null, booking: null, activeIntent: null, activeOrderType: null, aiPaused: false, pausedAt: null };
          session.changed('history', true);
          session.changed('state', true);
          whatsappSessions.delete(from);
          await session.save({ transaction: t });
          await sendIntentList(from, client, locale);
          return;
        }

        // During human handoff — drop messages silently (agent will reply manually).
        // Auto-resume AI if the handoff has been open too long with no agent response.
        if (aiPaused) {
          const pausedAt   = session.state.pausedAt ? new Date(session.state.pausedAt).getTime() : 0;
          const timedOut   = pausedAt && (Date.now() - pausedAt) > HANDOFF_TIMEOUT_MS;

          if (timedOut) {
            logger.whatsapp('info', 'Handoff timed out — resuming AI', { requestId, from: `***${from.slice(-4)}` });
            session.state = { ...session.state, aiPaused: false, pausedAt: null, activeIntent: null };
            session.changed('state', true);
            await session.save({ transaction: t });
            await sendIntentList(from, client, locale);
          } else {
            logger.whatsapp('info', 'Message dropped: AI paused for human handoff', { requestId, from: `***${from.slice(-4)}` });
          }
          return;
        }

        // Numeric reply — user typed a number to pick from the plain-text service list.
        // Only intercept when the user is actively in the services context; otherwise
        // numbers are just part of a normal conversation (e.g. "I'll come at 9").
        const numericMatch = /^\s*(\d{1,2})\s*$/.exec(originalText);
        if (numericMatch && activeIntent === 'services') {
          const svcKey   = `services:${clientId}`;
          let   services = await redisGet(svcKey);
          if (!services?.length) {
            const namespace = client?.pineconeIndex || clientId || 'default';
            services = await ragService.getServicesFromIndex(namespace);
            if (services?.length) await redisSet(svcKey, services, SERVICES_CACHE_TTL);
          }
          if (services?.length) {
            const idx     = parseInt(numericMatch[1], 10) - 1; // convert to 0-based
            const service = services[idx];
            if (service) {
              logger.whatsapp('info', 'Numeric service selection', { requestId, idx: idx + 1, service: service.name });
              // Force activeIntent to 'general' so processAI returns a descriptive
              // reply rather than triggering "show services list" again.
              const response = await processAI({
                client, from,
                message: `I'm interested in ${service.name}. I'd like to learn more about this service.`,
                history: session.history,
                userEmail: session.state.email || null,
                language: locale,
                activeIntent:    'general',
                activeOrderType: null
              });

              session.state.selectedService     = service.id;
              session.state.selectedServiceName = service.name;
              session.state.activeIntent        = 'services';
              session.changed('state', true);

              if (response.showServices) {
                // Shouldn't happen, but guard against infinite loop
                await send(from, `You selected: *${service.name}*. Please ask your question about this service.`);
                pushHistory(session, locale, originalText, service.name);
              } else if (response.reply) {
                await send(from, response.reply);
                pushHistory(session, locale, originalText, response.reply);
              } else {
                logger.whatsapp('warn', 'processAI returned no reply for numeric service selection', { requestId, service: service.name });
                await send(from, `You selected: *${service.name}*. How can I help you with this service?`);
                pushHistory(session, locale, originalText, service.name);
              }

              await session.save({ transaction: t });
              return;
            }
            // Number out of range — tell the user
            const t_n = i18next.getFixedT(locale);
            await send(from, t_n('invalid_service_number', { max: services.length }));
            await session.save({ transaction: t });
            return;
          }
        }

        // Booking flow intercept — handle all text while booking is in progress
        if (activeOrderType === 'booking' && session.state.booking) {
          const saveSession = async () => { session.changed('state', true); await session.save({ transaction: t }); };
          const handled = await handleBookingTextReply(from, client, session, originalText, locale, send, saveSession);
          if (handled) return;
        }

        // Continuations (greetings, acknowledgements) skip intent detection so
        // "okay thanks" or "👍" don't break an active conversation.
        const continuation = isContinuation(originalText);

        // Layer 1: fast English keyword detection
        const quickIntent = continuation ? null : detectQuickIntent(originalText);

        // Layer 2: Gemini classifier — runs when keyword detection found nothing,
        // the message is not a continuation, AND the session has no active intent.
        // Skipped mid-conversation (activeIntent set) so post-booking follow-ups
        // don't get falsely re-classified as 'order' and show the sub-menu again.
        // Genuine intent shifts mid-conversation are still caught by the keyword
        // layer (layer 1), which covers all supported languages.
        let classifiedIntent = null;
        if (!continuation && !quickIntent && !activeIntent) {
          classifiedIntent = await classifyIntent(originalText, client);
        }

        const resolvedNewIntent = quickIntent || classifiedIntent;

        // Allow any detected intent to override when:
        //   - it differs from the current intent, AND
        //   - either we're not in 'order' mode, OR the user hasn't picked a sub-type yet
        //     (meaning they haven't committed to the booking/payment/status flow), OR
        //   - the new intent is 'handoff' (always wins).
        const shouldOverride = resolvedNewIntent &&
                               resolvedNewIntent !== activeIntent &&
                               (activeIntent !== 'order' || !activeOrderType || resolvedNewIntent === 'handoff');

        // Still no intent after both layers → show list (genuinely ambiguous)
        if (!activeIntent && !resolvedNewIntent) {
          await sendIntentList(from, client, locale);
          return;
        }

        if (shouldOverride || (!activeIntent && resolvedNewIntent)) {
          session.state = { ...session.state, activeIntent: resolvedNewIntent, activeOrderType: null };
          session.changed('state', true);
          await session.save({ transaction: t });

          if (resolvedNewIntent === 'handoff') {
            await handleHumanHandoff(session, client, from, send, t);
            return;
          }
          if (resolvedNewIntent === 'order') {
            // If user already has a service selected, jump straight to booking — skip sub-menus
            if (session.state.selectedServiceName) {
              session.state.activeOrderType = 'booking';
              session.state.booking = {
                bookingType:   'calendar',
                step:          'await_day',
                serviceName:   session.state.selectedServiceName,
                name:          session.name || null,
                email:         session.state.email || null,
                phone:         from,
                slotStart:     null,
                slotEnd:       null,
                slotFormatted: null,
              };
              session.changed('state', true);
              await session.save({ transaction: t });
              const saveSession = async () => { session.changed('state', true); await session.save({ transaction: t }); };
              await startBookingFlow(from, client, session, locale, send, saveSession);
              await session.save({ transaction: t });
            } else {
              await handleOrderRouting(from, client, locale);
            }
            return;
          }
          if (resolvedNewIntent === 'services') {
            await sendServiceList(from, locale, client);
            return;
          }
          // general — fall through so the question is answered immediately,
          // not just after the user is told "you're now in general inquiries"
        }

        // Re-read after potential override
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
          activeIntent:         resolvedIntent,
          activeOrderType:      resolvedOrderType,
          isNewUser,
          userName:             session.name || null,
          selectedServiceName:  session.state.selectedServiceName || null,
        });

        if (response.showServices) {
          await sendServiceList(from, locale, client);
          pushHistory(session, locale, msg.text.body, 'Service list shown');
          await session.save({ transaction: t });
          return;
        }

        if (response.triggerBookingFlow) {
          // AI collected some booking info but couldn't select a real slot.
          // Pre-populate state and hand off to the structured booking handler.
          const prefill = response.bookingPrefill || {};
          session.state.booking = {
            bookingType:   'calendar',
            step:          'await_day',
            serviceName:   prefill.serviceName || session.state.selectedServiceName || null,
            name:          prefill.name        || session.name                      || null,
            email:         prefill.email       || session.state.email               || null,
            phone:         from,
            slotStart:     null,
            slotEnd:       null,
            slotFormatted: null,
          };
          session.state.activeOrderType = 'booking';
          session.changed('state', true);
          const saveSession = async () => { session.changed('state', true); await session.save({ transaction: t }); };
          await startBookingFlow(from, client, session, locale, send, saveSession);
          pushHistory(session, locale, msg.text.body, 'Booking flow started');
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

        if (response.triggerBookingFlow) {
          const prefill = response.bookingPrefill || {};
          session.state.booking = {
            bookingType:   'calendar',
            step:          'await_day',
            serviceName:   prefill.serviceName || session.state.selectedServiceName || null,
            name:          prefill.name        || session.name                      || null,
            email:         prefill.email       || session.state.email               || null,
            phone:         from,
            slotStart:     null,
            slotEnd:       null,
            slotFormatted: null,
          };
          session.state.activeOrderType = 'booking';
          session.changed('state', true);
          const saveSession = async () => { session.changed('state', true); await session.save({ transaction: t }); };
          await startBookingFlow(from, client, session, locale, send, saveSession);
          pushHistory(session, locale, `[Voice] ${transcribedText}`, 'Booking flow started');
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
      { history: [], state: { selectedService: null, activeIntent: null, activeOrderType: null, aiPaused: false, pausedAt: null } },
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
