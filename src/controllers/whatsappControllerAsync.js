/**
 * Async Webhook Controller (Queued Message Processing)
 * This refactored version queues messages instead of processing them synchronously
 * Webhook returns immediately while workers process in background
 */

import dotenv from 'dotenv';
import { addChatProcessingJob } from '../queues/bullmq.config.js';
import { extractWebhookPayload } from '../utils/extractors.js';
import { resolveClient } from '../services/clientService.js';
import { sendMessage } from '../services/whatsappService.js';
import { sendServiceList } from '../helpers/whatsapp/sendServiceList.js';
import ragService from '../services/rag.service.js';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';
import { processWithGemini } from '../helpers/whatsapp/processWithGemini.js';

dotenv.config();

export const whatsappSessions = new Map();

/**
 * Async webhook handler (QUEUED VERSION)
 * 1. Validate and deduplicate
 * 2. Create/update session
 * 3. Queue the message for async processing
 * 4. Return immediately (don't wait for processing)
 */
const handleWebhookAsync = async (req, res) => {
  const requestId = req.requestId || 'webhook-' + Date.now();

  // Return immediately to WhatsApp (must be <3s)
  res.status(200).send('OK');

  logger.whatsapp('info', 'WhatsApp webhook received (async)', {
    requestId,
    hasBody: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : []
  });

  try {
    const { phoneNumberId, message: msg, contact, statuses, value } = extractWebhookPayload(req.body);

    // Skip status updates and non-messages
    if (!value || statuses || !msg) {
      logger.whatsapp('debug', 'Skipping non-message webhook', { requestId });
      return;
    }

    const from = msg.from;
    const messageType = msg.type;
    const messageId = msg.id;

    logger.whatsapp('info', 'Queuing WhatsApp message', {
      requestId,
      from: `***${from.slice(-4)}`,
      messageId,
      messageType,
      phoneNumberId
    });

    // Resolve client
    const client = await resolveClient(phoneNumberId);
    const clientId = client?.id || null;

    // 1. Deduplication
    try {
      const [, created] = await dbConfig.db.ProcessedMessage.findOrCreate({
        where: { messageId, clientId },
        defaults: { messageId, clientId, processedAt: new Date() }
      });

      if (!created) {
        logger.whatsapp('info', 'Message already processed (duplicate)', { requestId, messageId });
        return;
      }
    } catch (dedupErr) {
      if (dedupErr.name === 'SequelizeUniqueConstraintError') {
        logger.whatsapp('info', 'Duplicate detected (race condition)', { requestId, messageId });
        return;
      }
      throw dedupErr;
    }

    // 2. Handle text messages
    if (msg.type === 'text') {
      const originalText = msg.text.body.trim();
      const text = originalText.toLowerCase();

      logger.whatsapp('info', 'Text message queued', {
        requestId,
        from: `***${from.slice(-4)}`,
        messageLength: originalText.length,
        isCommand: ['menu', 'restart'].includes(text)
      });

      // 3. Find or create session
      let [session, isNewUser] = await dbConfig.db.UserSession.findOrCreate({
        where: { phone: from, clientId },
        defaults: {
          name: contact?.profile?.name || 'Client',
          phone: from,
          clientId,
          history: [],
          state: { selectedService: null },
          lastAccess: new Date()
        }
      });

      // 4. Handle special cases SYNCHRONOUSLY (don't queue these)
      if (isNewUser && (!session.history || session.history.length === 0)) {
        // New user: send welcome + service list immediately
        logger.whatsapp('info', 'New user - sending welcome', { from: `***${from.slice(-4)}` });
        const locale = await ragService.detectCurrentLanguage(originalText);
        await sendServiceList(from, locale, client);
        session.history.push({
          role: 'user',
          content: originalText,
          language: locale,
          timestamp: new Date()
        });
        session.history.push({
          role: 'model',
          content: 'Service list shown',
          language: locale,
          timestamp: new Date()
        });
        session.changed('history', true);
        await session.save();
        return;
      }

      if (['menu', 'restart'].includes(text)) {
        // Menu reset: handle immediately
        logger.whatsapp('info', 'Menu command - resetting', { from: `***${from.slice(-4)}` });
        const lastHistory = session.history?.slice().reverse().find(h => h.language);
        const locale = lastHistory?.language || await ragService.detectCurrentLanguage(originalText);
        await sendServiceList(from, locale, client);
        session.history = [];
        session.state = { selectedService: null, pendingBooking: null };
        whatsappSessions.delete(from);
        await session.save();
        return;
      }

      // 5. Queue the message for async processing
      const userEmail = session.state.email || null;
      const userLanguage = await ragService.detectCurrentLanguage(originalText);

      try {
        const jobId = await addChatProcessingJob({
          phoneNumber: from,
          message: originalText,
          history: session.history || [],
          userEmail,
          language: userLanguage,
          clientId,
          contactName: contact?.profile?.name,
          timestamp: Date.now(),
          requestId
        });

        if (!jobId) {
          // Queue not available - process synchronously for local dev
          logger.whatsapp('info', 'Processing message synchronously (no queue)', {
            requestId,
            from: `***${from.slice(-4)}`
          });

          try {
            const result = await processWithGemini(from, originalText, session.history || [], userEmail, userLanguage, {
              clientId,
              geminiApiKey: client?.getDecryptedGeminiKey?.() || process.env.GEMINI_API_KEY,
              timezone: client?.timezone || 'Africa/Kigali',
              companyName: client?.companyName || process.env.COMPANY_NAME,
              paymentRedirectUrl: client?.paymentRedirectUrl || process.env.PAYMENT_REDIRECT_URL,
              depositAmount: client?.depositAmount || parseInt(process.env.DEPOSIT_AMOUNT || 5000),
              currency: client?.currency || process.env.CURRENCY,
              pineconeIndex: client?.pineconeIndex || client?.clientId
            });

            // Send response back to user
            if (result.reply) {
              await sendMessage({ client, to: from, message: result.reply });
            }

            // Update session with new history
            session.history.push({
              role: 'user',
              content: originalText,
              language: userLanguage,
              timestamp: new Date()
            });
            session.history.push({
              role: 'model',
              content: result.reply || 'Processing...',
              language: result.language || userLanguage,
              timestamp: new Date()
            });
            session.lastAccess = new Date();
            session.changed('history', true);
            await session.save();
          } catch (processError) {
            logger.error('Error processing message synchronously', {
              requestId,
              error: processError.message,
              from: `***${from.slice(-4)}`
            });
          }
        } else {
          logger.whatsapp('info', 'Message queued for processing', {
            requestId,
            from: `***${from.slice(-4)}`,
            jobId,
            queuePosition: 'async'
          });

          // Update session lastAccess but don't save response yet
          session.lastAccess = new Date();
          await session.save();
        }
      } catch (queueError) {
        logger.error('Failed to queue message', {
          requestId,
          error: queueError.message,
          from: `***${from.slice(-4)}`
        });

        // Queue failure is not critical - worker will handle if message fails
        // The message was already deduplicated, so don't retry
      }
    }
    // Add support for audio messages, media, etc. here if needed
  } catch (error) {
    logger.error('Webhook processing error', {
      requestId,
      error: error.message,
      stack: error.stack?.substring(0, 500)
    });
    // Don't throw - webhook must complete successfully
  }
};

export default { handleWebhookAsync, whatsappSessions };
