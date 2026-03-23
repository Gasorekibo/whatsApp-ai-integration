import i18next from '../config/i18n.js';
import googlesheets from '../utils/googlesheets.js';
import dbConfig from '../models/index.js';
import { sendWhatsAppMessage } from '../helpers/whatsapp/sendWhatsappMessage.js';
import { processWithGemini } from '../helpers/whatsapp/processWithGemini.js';
import dotenv from 'dotenv';
import { sendServiceList } from '../helpers/whatsapp/sendServiceList.js';
import { Op } from 'sequelize';
import logger from '../logger/logger.js';
import ragService from '../services/rag.service.js';
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
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value || value.statuses) {
      logger.whatsapp('debug', 'Webhook value missing or contains statuses', { requestId });
      return;
    }

    const msg = value.messages?.[0];
    if (!msg) {
      logger.whatsapp('debug', 'No messages found in webhook', { requestId });
      return;
    };
    const from = msg.from;
    const messageType = msg.type;
    const messageId = msg.id;

    logger.whatsapp('info', 'Processing WhatsApp message', {
      requestId,
      from: `***${from.slice(-4)}`,
      messageId,
      messageType,
      contactName: value.contacts?.[0]?.profile?.name
    });

    // Start Transaction
    await dbConfig.db.sequelize.transaction(async (t) => {
      // 1. Strict Message Deduplication
      try {
        const [processedMsg, created] = await dbConfig.db.ProcessedMessage.findOrCreate({
          where: { messageId },
          defaults: { messageId, processedAt: new Date() },
          transaction: t
        });

        if (!created) {
          logger.whatsapp('info', 'Deduplication: Message already processed, skipping', { requestId, messageId });
          return; 
        }
      } catch (dedupErr) {
        if (dedupErr.name === 'SequelizeUniqueConstraintError') {
          logger.whatsapp('info', 'Deduplication: Concurrency detected, message already being processed', { requestId, messageId });
          return;
        }
        throw dedupErr;
      }
      let [session, isNewUser] = await dbConfig.db.UserSession.findOrCreate({
        where: { phone: from },
        defaults: {
          name: value.contacts?.[0]?.profile?.name || 'Client',
          phone: from,
          history: [],
          state: { selectedService: null },
          lastAccess: new Date()
        },
        transaction: t
      });

      if (isNewUser) {
        logger.whatsapp('info', 'New user session created', {
          requestId,
          sessionId: session.id,
          from: `***${from.slice(-4)}`
        });
      } else {
        logger.whatsapp('info', 'Existing user session found', {
          requestId,
          sessionId: session.id,
          from: `***${from.slice(-4)}`
        });
        session.lastAccess = new Date();
        await session.save({ transaction: t });
      }

      // 3. Process Content (Inside Transaction)
      if (msg.type === 'text') {
        const text = msg.text.body.trim().toLowerCase();
        const originalText = msg.text.body.trim();
        
        // Default locale for new users or if not set
        let locale = 'en';

        logger.whatsapp('info', 'Text message received', {
          requestId,
          from: `***${from.slice(-4)}`,
          messageLength: originalText.length,
          isCommand: ['menu', 'restart'].includes(text),
          isNewUser
        });

        // SAFETY: Double-check if it's REALLY a new user flow
        const trulyNewUser = isNewUser && (!session.history || session.history.length === 0);

        if (trulyNewUser) {
          logger.whatsapp('info', 'Sending welcome message to new user', {
            requestId,
            from: `***${from.slice(-4)}`
          });
          // Detect language from the user's very first message
          locale = ragService.detectLanguage(originalText, []) || 'en';
          const t_new = i18next.getFixedT(locale);
          await sendWhatsAppMessage(from, t_new('welcome'));
          await sendServiceList(from, locale);
          return;
        }

        if (['menu', 'restart'].includes(text)) {
          logger.whatsapp('info', 'Resetting user session, User typed ' + text, {
            requestId,
            from: `***${from.slice(-4)}`,
            command: text
          });
          await sendServiceList(from, locale);
          session.history = [];
          session.state = { selectedService: null, pendingBooking: null };
          whatsappSessions.delete(from);
          await session.save({ transaction: t });
          return;
        }

        const userEmail = session.state.email || null;
        // Detect user's input language before processing (pattern-based, no LLM call)
        const userInputLanguage = ragService.detectLanguage(originalText, session.history) || 'en';
        const response = await processWithGemini(from, msg.text.body, session.history, userEmail);
        locale = response.language || userInputLanguage;

        if (response.showServices) {
          await sendServiceList(from, locale);
          session.history.push({ role: 'user', content: msg.text.body, language: userInputLanguage, timestamp: new Date() });
          session.history.push({ role: 'model', content: 'Service list shown', language: locale, timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
          return;
        }

        if (response.reply) {
          await sendWhatsAppMessage(from, response.reply);

          // Auto-extract email
          if (response.reply.includes('@') && !session.state.email) {
            const emailMatch = response.reply.match(/[\w.-]+@[\w.-]+\.\w+/);
            if (emailMatch) {
              session.state.email = emailMatch[0];
            }
          }

          session.history.push({ role: 'user', content: msg.text.body, language: userInputLanguage, timestamp: new Date() });
          session.history.push({ role: 'model', content: response.reply, language: locale, timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
        }
      }
      else if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
        const selectedId = msg.interactive.list_reply.id;
        const selectedTitle = msg.interactive.list_reply.title;

        logger.whatsapp('info', 'Interactive list selection received', {
          requestId,
          from: `***${from.slice(-4)}`,
          selectedId,
          selectedTitle
        });

        const services = await googlesheets.getActiveServices();
        const service = services.find(s => s.id === msg.interactive.list_reply.id);

        if (service) {
          const response = await processWithGemini(from, `I'm interested in ${service.name}. I'd like to learn more about this service.`, session.history);
          const locale = response.language || 'en';
          if (response.reply) await sendWhatsAppMessage(from, response.reply);

          session.state.selectedService = service.id;
          session.history.push({ role: 'user', content: `Selected: ${service.name}`, language: locale, timestamp: new Date() });
          session.history.push({ role: 'model', content: response.reply || 'Service selected', language: locale, timestamp: new Date() });
          session.changed('history', true);
          await session.save({ transaction: t });
        } else {
          // Use a default locale or tries to find from history
          const locale = 'en'; 
          const t_err = i18next.getFixedT(locale);
          await sendWhatsAppMessage(from, t_err('service_not_available'));
          await sendServiceList(from, locale);
        }
      } else {
        logger.whatsapp('info', 'Unsupported message type received', {
          requestId,
          from: `***${from.slice(-4)}`,
          messageType,
          messageId
        });
      }
    }); // End Transaction

  } catch (err) {
    logger.error('WhatsApp webhook error', {
      requestId,
      error: err.message,
      stack: err.stack,
      errorType: err.constructor.name
    });
    try {
      await sendWhatsAppMessage(req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from, "Sorry, something went wrong while processing your message. Please try again later.");
    } catch (sendErr) {
      logger.error('Error sending failure response', { error: sendErr.message });
    }
  }
};

// Cleanup old sessions
setInterval(async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    await dbConfig.db.UserSession.destroy({ where: { lastAccess: { [Op.lt]: cutoff } } });

    // ✅ Add this
    await dbConfig.db.ProcessedMessage.destroy({ where: { processedAt: { [Op.lt]: cutoff } } });

    whatsappSessions.clear();
  } catch (err) {
    logger.error('❌Session Cleanup error', { error: err.message });
  }
}, 60 * 60 * 1000);

export { handleWebhook };