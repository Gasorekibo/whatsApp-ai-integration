import googlesheets from '../utils/googlesheets.js';
import  dbConfig  from '../models/index.js';
import { sendWhatsAppMessage } from '../helpers/whatsapp/sendWhatsappMessage.js';
import { processWithGemini } from '../helpers/whatsapp/processWithGemini.js';
import dotenv from 'dotenv';
import {sendServiceList} from '../helpers/whatsapp/sendServiceList.js';
import { Op } from 'sequelize';
import logger from '../logger/logger.js';
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
    if (!msg){
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
    let session = await dbConfig.db.UserSession.findOne({where:{ phone: from }});
    const isNewUser = !session;
    
    if (!session) {
       logger.whatsapp('info', 'Creating new user session', {
        requestId,
        from: `***${from.slice(-4)}`,
        contactName: value.contacts?.[0]?.profile?.name
      });
      session = await dbConfig.db.UserSession?.create({
        name: value.contacts?.[0]?.profile?.name || 'Client',
        phone: from,
        history: [],
        state: { selectedService: null },
        lastAccess: new Date()
      });
       logger.whatsapp('info', 'User session created', {
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
    }
      session.lastAccess = new Date();
      await session.save();

    if (msg.type === 'text') {
      const text = msg.text.body.trim().toLowerCase();
      const originalText = msg.text.body.trim();
      
      logger.whatsapp('info', 'Text message received', {
        requestId,
        from: `***${from.slice(-4)}`,
        messageLength: originalText.length,
        isCommand: ['menu', 'restart'].includes(text),
        isNewUser
      });
      if (isNewUser) {
        logger.whatsapp('info', 'Sending welcome message to new user', {
          requestId,
          from: `***${from.slice(-4)}`
        });
        await sendWhatsAppMessage(from, "👋 Welcome to *Moyo Tech Solutions*!\n\nWe're a leading IT consultancy in Rwanda, ready to help transform your business with cutting-edge technology solutions.\n\nLet me show you what we can do for you:");
        await sendServiceList(from);
        logger.whatsapp('info', 'Welcome message sent Successfully', {
          requestId,
          from: `***${from.slice(-4)}`
        });
        return;
      }
      
      if (['menu', 'restart'].includes(text)) {
        logger.whatsapp('info', 'Resetting user session, User typed ' + text, {
          requestId,
          from: `***${from.slice(-4)}`,
          command: text
        });
        await sendServiceList(from);
        session.history = [];
        session.state = { selectedService: null, pendingBooking: null };
        whatsappSessions.delete(from); 
        await session.save();
        logger.whatsapp('info', 'Session reset complete', {
          requestId,
          from: `***${from.slice(-4)}`
        });
        return;
      }

      const userEmail = session.state.email || null;
      logger.gemini('info', 'Sending message to Gemini'+ originalText, {
        requestId,
        from: `***${from.slice(-4)}`,
        messageLength: originalText.length,
        hasHistory: session.history?.length > 0,
        historyLength: session.history?.length || 0,
        userEmail: userEmail ? 'present' : 'none'
      });
      const geminiStartTime = Date.now();
      const response = await processWithGemini(from, msg.text.body, session.history, userEmail);
      const geminiDuration = Date.now() - geminiStartTime;

       logger.gemini('info', 'Gemini response received', {
        requestId,
        from: `***${from.slice(-4)}`,
        duration: geminiDuration,
        showServices: response.showServices,
        hasReply: !!response.reply,
        replyLength: response.reply?.length || 0
      });

      if (response.showServices) {
         logger.whatsapp('info', 'Showing service list As response from Gemini', {
          requestId,
          from: `***${from.slice(-4)}`
        });
        await sendServiceList(from);
        session.history.push({ role: 'user', content: msg.text.body, timestamp: new Date() });
        session.history.push({ role: 'model', content: 'Service list shown', timestamp: new Date() });
       session.changed('history', true);
       await session.save();
        return;
      }

      if (response.reply) {
        logger.whatsapp('info', 'Sending response to user', {
          requestId,
          from: `***${from.slice(-4)}`,
          replyLength: response.reply.length
        });
        await sendWhatsAppMessage(from, response.reply);

        // Auto-extract email
        if (response.reply.includes('@') && !session.state.email) {
          const emailMatch = response.reply.match(/[\w.-]+@[\w.-]+\.\w+/);
          if (emailMatch) {
            session.state.email = emailMatch[0];
            await session.save();
            logger.whatsapp('info', 'Email extracted from response', {
              requestId,
              from: `***${from.slice(-4)}`,
              email: `${emailMatch[0].substring(0, 3)}***`
            });
          }
        }

        session.history.push({ role: 'user', content: msg.text.body, timestamp: new Date() });
        session.history.push({ role: 'model', content: response.reply, timestamp: new Date() });
        session.changed('history', true);
        await session.save();
        logger.whatsapp('info', 'Conversation history updated', {
          requestId,
          from: `***${from.slice(-4)}`,
          newHistoryLength: session.history.length
        });
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
         logger.whatsapp('info', 'Service selected', {
          requestId,
          from: `***${from.slice(-4)}`,
          serviceId: service.id,
          serviceName: service.name
        });
        const response = await processWithGemini(from, `I'm interested in ${service.name}. I'd like to learn more about this service.`, session.history);
        if (response.reply) await sendWhatsAppMessage(from, response.reply);
        
        session.state.selectedService = service.id;
        session.history.push({ role: 'user', content: `Selected: ${service.name}`, timestamp: new Date() });
        session.history.push({ role: 'model', content: response.reply || 'Service selected', timestamp: new Date() });
        session.changed('history', true);
       await session.save();
       logger.whatsapp('info', 'Service selection processed Successfully', {
          requestId,
          from: `***${from.slice(-4)}`,
          serviceId: service.id
        });
      } else {
        logger.whatsapp('warn', 'Selected service not found', {
          requestId,
          from: `***${from.slice(-4)}`,
          selectedId,
          availableServices: services.length
        });
        await sendWhatsAppMessage(from, "Sorry, that service is no longer available. Let me show you our current services.");
        await sendServiceList(from);
      }
    } else {
      logger.whatsapp('info', 'Unsupported message type received', {
        requestId,
        from: `***${from.slice(-4)}`,
        messageType,
        messageId
      });
    }

  } catch (err) {

    logger.error('WhatsApp webhook error', {
      requestId,
      error: err.message,
      stack: err.stack,
      errorType: err.constructor.name
    });
    await sendWhatsAppMessage(req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from, "Sorry, something went wrong while processing your message. Please try again later.");
  }
};

// Cleanup old sessions
setInterval(async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    logger.info('Starting Old session cleanup', { cutoffTime: cutoff });
    await dbConfig.db.UserSession.destroy({ where: { lastAccess: { [Op.lt]: cutoff } } });
    whatsappSessions.clear();
  } catch (err) {
    logger.error('❌Session Cleanup error', {
      error: err.message,
      stack: err.stack,
      errorType: err.constructor.name
    });
  }
}, 60 * 60 * 1000);

export { handleWebhook };