import {getActiveServices} from '../utils/googlesheets.js';
import { db } from '../models/index.js';
import { sendWhatsAppMessage } from '../helpers/whatsapp/sendWhatsappMessage.js';
import { processWithGemini } from '../helpers/whatsapp/processWithGemini.js';
import dotenv from 'dotenv';
import {sendServiceList} from '../helpers/whatsapp/sendServiceList.js';
import { Op } from 'sequelize';
dotenv.config();

export const whatsappSessions = new Map();

const handleWebhook = async (req, res) => {
  res.status(200).send('OK');

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value || value.statuses) return;

    const msg = value.messages?.[0];
    if (!msg) return;
    const from = msg.from;
    let session = await db.UserSession.findOne({where:{ phone: from }});
    const isNewUser = !session;
    
    if (!session) {
      session = await db.UserSession?.create({
        name: value.contacts?.[0]?.profile?.name || 'Client',
        phone: from,
        history: [],
        state: { selectedService: null },
        lastAccess: new Date()
      });
    } 
      session.lastAccess = new Date();
      await session.save();

    if (msg.type === 'text') {
      const text = msg.text.body.trim().toLowerCase();
      
      if (isNewUser) {
        await sendWhatsAppMessage(from, "👋 Welcome to *Moyo Tech Solutions*!\n\nWe're a leading IT consultancy in Rwanda, ready to help transform your business with cutting-edge technology solutions.\n\nLet me show you what we can do for you:");
        await sendServiceList(from);
        return;
      }
      
      if (['menu', 'restart'].includes(text)) {
        await sendServiceList(from);
        session.history = [];
        session.state = { selectedService: null, pendingBooking: null };
        whatsappSessions.delete(from); 
        await session.save();
        return;
      }

      const userEmail = session.state.email || null;
      const response = await processWithGemini(from, msg.text.body, session.history, userEmail);

      if (response.showServices) {
        await sendServiceList(from);
        session.history.push({ role: 'user', content: msg.text.body, timestamp: new Date() });
        session.history.push({ role: 'model', content: 'Service list shown', timestamp: new Date() });
       session.changed('history', true);
       await session.save();
        return;
      }

      if (response.reply) {
        await sendWhatsAppMessage(from, response.reply);

        // Auto-extract email
        if (response.reply.includes('@') && !session.state.email) {
          const emailMatch = response.reply.match(/[\w.-]+@[\w.-]+\.\w+/);
          if (emailMatch) {
            session.state.email = emailMatch[0];
            await session.save();
          }
        }

        session.history.push({ role: 'user', content: msg.text.body, timestamp: new Date() });
        session.history.push({ role: 'model', content: response.reply, timestamp: new Date() });
        session.changed('history', true);
        await session.save();
      }
    }
    else if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
      const services = await getActiveServices();
      const service = services.find(s => s.id === msg.interactive.list_reply.id);
      
      if (service) {
        const response = await processWithGemini(from, `I'm interested in ${service.name}. I'd like to learn more about this service.`, session.history);
        if (response.reply) await sendWhatsAppMessage(from, response.reply);
        
        session.state.selectedService = service.id;
        session.history.push({ role: 'user', content: `Selected: ${service.name}`, timestamp: new Date() });
        session.history.push({ role: 'model', content: response.reply || 'Service selected', timestamp: new Date() });
        session.changed('history', true);
       await session.save();
      } else {
        await sendWhatsAppMessage(from, "Sorry, that service is no longer available. Let me show you our current services.");
        await sendServiceList(from);
      }
    }

  } catch (err) {
    console.error('❌ Webhook error:', err);
  }
};

// Cleanup old sessions
setInterval(async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    await db.UserSession.destroy({ where: { lastAccess: { [Op.lt]: cutoff } } });
    whatsappSessions.clear();
  } catch (err) {
    console.error('❌ Cleanup error:', err);
  }
}, 60 * 60 * 1000);
export { handleWebhook };