const { GoogleGenerativeAI } = require('@google/generative-ai');
const getCalendarData = require('../utils/getCalendarData');
const { getActiveServices } = require('../utils/googlesheets.js');
const {db}  = require('../models/index.js');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const EMPLOYEE_EMAIL = process.env.EMPLOYEE_EMAIL;

// ==================== CONFIG & STATE ====================

const whatsappSessions = new Map();

const systemInstruction = `
You are a warm, professional AI assistant for Moyo Tech Solutions — a leading IT consultancy in Rwanda.

SERVICES WE OFFER:
{{SERVICES_LIST}}

IMPORTANT RULES:
- The current date is {{CURRENT_DATE}}
- ONLY use dates from the AVAILABLE_SLOTS list below
- NEVER invent dates or times
- All consultations require a commitment deposit of {{DEPOSIT_AMOUNT}} {{CURRENCY}} to confirm the booking
- This deposit ensures both parties are serious about the meeting

CONVERSATION FLOW:
1. After service selection, ask smart follow-up questions
2. Collect: Name, Email, Company (optional), Timeline, Budget, service-specific details
3. When user picks a time and all details are ready:
   - Confirm the exact time exists in AVAILABLE_SLOTS
   - Output ONLY: ===INITIATE_PAYMENT=== followed by JSON with full booking info

AVAILABLE CONSULTATION SLOTS (ONLY THESE ARE VALID):
{{AVAILABLE_SLOTS}}

OUTPUT FORMATS (exact, no extra text):

When user asks for services:
===SHOW_SERVICES===

When user confirms a valid time and all info collected → trigger payment:
===INITIATE_PAYMENT===
{"service":"Web Development","title":"Consultation - John Doe","start":"2025-12-20T10:00:00+02:00","end":"2025-12-20T11:00:00+02:00","name":"John Doe","email":"john@example.com","phone":"+250788123456","company":"ABC Ltd","details":"Need e-commerce platform"}

When saving inquiry without booking:
===SAVE_REQUEST===
{"service":"App Development","name":"Jane","email":"jane@company.com","details":"Mobile delivery app","timeline":"3 months","budget":"$30k+"}
`;

const intentDetectionPrompt = `
You are an intent classifier. Analyze if the user wants to see the services list.

User wants to see services if they're asking about:
- What services/solutions are available
- What the company offers/provides
- Capabilities and offerings
- Service options
- What help is available
- Exploring services

Respond ONLY with:
"SHOW_SERVICES" if user wants to see services
"CONTINUE" if user wants to continue conversation

User message: "{{USER_MESSAGE}}"

Your response:`;

// ==================== WHATSAPP MESSAGING ====================

async function sendWhatsAppMessage(to, body) {
  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return data;
  } catch (err) {
    console.error('❌ Send message failed:', err.message);
  }
}

async function sendServiceList(to) {
  const services = await getActiveServices();
  
  if (services.length === 0) {
    await sendWhatsAppMessage(to, "Sorry, no services are currently available. Please contact us directly.");
    return;
  }

  const LIST_ROWS = services.map(s => ({
    id: s.id,
    title: s.short || s.name,
    description: s.details || `Professional ${s.name}`
  }));

  const url = `https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          header: { type: 'text', text: 'Moyo Tech Solutions' },
          body: { text: 'Welcome! Please select a service:' },
          footer: { text: "We're here to help you grow" },
          action: {
            button: 'View Services',
            sections: [{ title: 'Our Services', rows: LIST_ROWS }]
          }
        }
      })
    });
    const data = await res.json();
    
    if (!res.ok) {
      console.error('❌ Interactive list send failed:', data);
      let fallbackText = "Welcome to Moyo Tech! How can we help you today?\n\n";
      services.forEach((s, i) => {
        fallbackText += `${i + 1}. ${s.short || s.name}\n`;
      });
      fallbackText += "\nReply with a number to select a service!";
      await sendWhatsAppMessage(to, fallbackText);
    } else {
      console.log('✅ Service list sent successfully');
    }
    return data;
  } catch (err) {
    console.error('❌ sendServiceList error:', err);
  }
}

// ==================== GEMINI CHAT PROCESSOR ====================

async function processWithGemini(phoneNumber, message, history = [], userEmail = null) {
  try {
    const employee = await db.Employee.findOne({where: { email: EMPLOYEE_EMAIL }});
    if (!employee) throw new Error("Calendar not connected");

    const token = employee.getDecryptedToken();
    const calendar = await getCalendarData(EMPLOYEE_EMAIL, token);

    const now = new Date();
    const kigaliTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Kigali' }));

    const freeSlots = calendar.freeSlots.map(s => {
      const start = new Date(s.start);
      const end = new Date(s.end);
      const slotStart = start > kigaliTime ? start : kigaliTime;
      
      return {
        isoStart: slotStart.toISOString(),
        isoEnd: end.toISOString(),
        display: slotStart.toLocaleString('en-US', { 
          weekday: 'long',
          year: 'numeric',
          month: 'long', 
          day: 'numeric',
          hour: 'numeric', 
          minute: '2-digit',
          timeZone: 'Africa/Kigali' 
        }),
        dayName: slotStart.toLocaleString('en-US', { weekday: 'long', timeZone: 'Africa/Kigali' }),
        date: slotStart.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Kigali' }),
        time: `${slotStart.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Kigali' })} - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Kigali' })}`
      };
    });

    const services = await getActiveServices();
    const servicesList = services.map(s => 
      `• ${s.name}${s.details ? ' - ' + s.details : ''}`
    ).join('\n');

    const slotDetails = freeSlots.map((s, i) => 
      `${i + 1}. ${s.dayName}, ${s.date} at ${s.time} (ISO: ${s.isoStart})`
    ).join('\n');

    const currentDate = new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Africa/Kigali'
    });
    
    let prompt = systemInstruction
      .replace('{{SERVICES_LIST}}', servicesList)
      .replace('{{AVAILABLE_SLOTS}}', slotDetails)
      .replace('{{CURRENT_DATE}}', currentDate)
      .replace('{{DEPOSIT_AMOUNT}}', process.env.DEPOSIT_AMOUNT || '5,000')
      .replace('{{CURRENCY}}', process.env.CURRENCY || 'RWF');

    let chat = whatsappSessions.get(phoneNumber);
    if (!chat) {
      chat = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }).startChat({
        systemInstruction: { parts: [{ text: prompt }] },
        history: history.map(h => ({ 
          role: h.role === 'user' ? 'user' : 'model', 
          parts: [{ text: h.content }] 
        }))
      });
      whatsappSessions.set(phoneNumber, chat);
    }

    const result = await chat.sendMessage(message);
    const text = result.response.text();

    const showServicesMatch = text.match(/===SHOW_SERVICES===/);
    const paymentMatch = text.match(/===INITIATE_PAYMENT===\s*(\{.*?\})/s);
    const saveMatch = text.match(/===SAVE_REQUEST===\s*(\{.*?\})/s);

    let reply = text
      .replace(/===SHOW_SERVICES===|===INITIATE_PAYMENT===\s*\{.*?\}|===SAVE_REQUEST===\s*\{.*?\}|```json|```/gi, '')
      .trim() || "I'm here to help! How can I assist you today?";

    if (showServicesMatch) {
      return { reply: null, showServices: true, showSlots: false, freeSlots };
    }

    if (paymentMatch) {
      try {
        const data = JSON.parse(paymentMatch[1]);
        const requestedStart = new Date(data.start);

        const matchingSlot = freeSlots.find(slot => {
          const slotStart = new Date(slot.isoStart);
          return Math.abs(slotStart - requestedStart) < 60000;
        });

        if (!matchingSlot) {
          reply = "I apologize, but that time slot is no longer available. Here are the current available times:";
          return { reply, showServices: false, showSlots: true, freeSlots };
        }

        const tx_ref = `moyo-deposit-${phoneNumber.replace(/\+/g, '')}-${Date.now()}`;

        const paymentApiResponse = await fetch('https://api.flutterwave.com/v3/payments', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            tx_ref,
            amount: parseInt(process.env.DEPOSIT_AMOUNT || 5000),
            currency: process.env.CURRENCY || "RWF",
            redirect_url: "https://whatsapp-ai-integration.onrender.com/payment-success",
            customer: {
              email: data.email || "customer@example.com",
              phone_number: phoneNumber.replace('+', ''),
              name: data.name
            },
            customizations: {
              title: "Moyo Tech Consultation Deposit",
              description: `Deposit for ${data.service} consultation`
            },
            meta: {
              phone: phoneNumber,
              booking_details: JSON.stringify({
                ...data,
                slotStart: matchingSlot.isoStart,
                slotEnd: matchingSlot.isoEnd,
                tx_ref
              })
            }
          })
        });

        const paymentResponse = await paymentApiResponse.json();

        if (paymentResponse.status === "success") {
          const paymentLink = paymentResponse.data.link;

          reply = `Great! To secure your consultation slot, please pay a commitment deposit of *${process.env.DEPOSIT_AMOUNT} ${process.env.CURRENCY}*.\n\n` +
                  `This ensures we're both serious about the meeting.\n\n` +
                  `👉 *Tap to pay securely (Mobile Money or Card):*\n${paymentLink}\n\n` +
                  `After payment, your booking will be automatically confirmed and you'll receive a Google Meet link via email.\n\n` +
                  `Thank you for choosing Moyo Tech Solutions! 🚀`;
        } else {
          console.error('Flutterwave error:', paymentResponse);
          reply = "Sorry, I couldn't generate the payment link right now. Please try again in a moment.";
        }

        return { reply, showServices: false, showSlots: false, freeSlots };
      } catch (e) {
        console.error('❌ Payment initiation error:', e);
        reply = "There was a technical issue preparing payment. Please try again shortly.";
        return { reply };
      }
    }

    if (saveMatch) {
      try {
        const data = JSON.parse(saveMatch[1]);
        await db.ServiceRequest.create({
          ...data,
          phone: data.phone || phoneNumber,
          status: 'new'
        });
        reply += "\n\nYour inquiry has been saved. We'll follow up soon!";
      } catch (e) {
        console.error('Save request error:', e);
      }
    }

    return { reply, showServices: false, showSlots: false, freeSlots };

  } catch (err) {
    console.error("❌ Gemini error:", err);
    if (err.status === 429) {
      return { 
        reply: "🔄 We're experiencing high demand right now. Please try again in a moment or type 'menu' to see our services.",
        showServices: false,
        showSlots: false, 
        freeSlots: [] 
      };
    }else {
    return { 
      reply: "I'm having trouble connecting right now. Please try again in a moment!", 
      showServices: false,
      showSlots: false, 
      freeSlots: [] 
    };
  }
  }
}

// ==================== WEBHOOK HANDLERS ====================

const verifyWebhook = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    res.send(challenge);
  } else {
    res.sendStatus(403);
  }
};

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

module.exports = { verifyWebhook, handleWebhook, sendWhatsAppMessage };