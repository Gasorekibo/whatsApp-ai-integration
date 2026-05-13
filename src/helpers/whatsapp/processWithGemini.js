import dotenv from 'dotenv';
import getCalendarData from '../../utils/getCalendarData.js';
import dbConfig from '../../models/index.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { whatsappSessions } from '../../controllers/whatsappController.js';
import logger from '../../logger/logger.js';
import ragService from '../../services/rag.service.js';

dotenv.config();

import { DateTime } from 'luxon';

function toDisplay(date, timezone) {
  const dt = DateTime.fromJSDate(date).setZone(timezone);
  return {
    dayName: dt.toFormat('EEEE'),
    date:    dt.toFormat('LLLL d, yyyy'),
    time:    dt.toFormat('t')
  };
}

const MAX_HISTORY_TURNS = 10; // 10 user+assistant pairs = 20 entries

function getRecentHistory(history = []) {
  return history.slice(-(MAX_HISTORY_TURNS * 2));
}

// Intents and keywords that require live calendar data
const BOOKING_INTENTS  = new Set(['booking', 'payment']);
const BOOKING_KEYWORDS = /\b(book|appointment|schedule|slot|available|when|meet|consultation|reserve|free|time|date|session|tomorrow|today|morning|afternoon|evening|[0-9]+\s*(am|pm))\b/i;

function needsCalendar(intent, message, history = []) {
  if (BOOKING_INTENTS.has(intent)) return true;
  if (BOOKING_KEYWORDS.test(message)) return true;
  // If the recent conversation was about booking, keep loading calendar so context isn't lost
  return history.slice(-6).some(h => BOOKING_KEYWORDS.test(h.content));
}

const USE_RAG = process.env.USE_RAG !== 'false';

export async function processWithGemini(phoneNumber, message, history = [], userEmail = null, currentLanguage = null, clientConfig = {}) {
  const sanitizedPhone = `***${phoneNumber.slice(-4)}`;
  // ── Per-client configuration ──────────────────────────────────────────────
  const geminiKey = clientConfig.geminiApiKey;
  if (!geminiKey) throw new Error('processWithGemini: client is missing a Gemini API key');
  const genAI              = new GoogleGenerativeAI(geminiKey);
  const timezone           = clientConfig.timezone           || 'Africa/Kigali';
  const botName            = clientConfig.botName            || clientConfig.name || 'Our Company';
  const paymentRedirectUrl = clientConfig.paymentRedirectUrl || '';
  const depositAmount      = clientConfig.depositAmount      || 5000;
  const currency           = clientConfig.currency           || 'RWF';
  const namespace          = clientConfig.pineconeIndex || clientConfig.clientId || 'default';
  const clientId           = clientConfig.clientId           || null;
  const isNewUser          = clientConfig.isNewUser          || false;
  const userName           = clientConfig.userName           || null;

  logger.gemini('info', 'Processing request with Gemini from ' + sanitizedPhone, {
    phone: sanitizedPhone, messageLength: message.length,
    historyLength: history.length, hasUserEmail: !!userEmail, clientId, namespace
  });

  try {
    // ── Lazy calendar loader — fetches once per request, only when needed ──
    let _employee    = null;
    let _freeSlots   = null;
    let _currentDate = null;

    const loadEmployee = async () => {
      if (_employee !== null) return _employee;
      if (!clientId) throw new Error('Calendar not connected: no client ID');
      _employee = await dbConfig.db.Employee.findOne({ where: { clientId } });
      if (!_employee) throw new Error('Calendar not connected');
      return _employee;
    };

    const loadSlots = async () => {
      if (_freeSlots !== null) return _freeSlots;

      const emp   = await loadEmployee();
      const token = emp.getDecryptedToken();

      const t0       = Date.now();
      const calendar = await getCalendarData(emp.email, token);
      logger.info('Calendar data retrieved', {
        phone: sanitizedPhone, duration: Date.now() - t0,
        freeSlotsCount: calendar.freeSlots?.length || 0
      });

      const now      = new Date();
      const localNow = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
      _currentDate   = (() => { const d = toDisplay(now, timezone); return `${d.dayName}, ${d.date} at ${d.time}`; })();

      _freeSlots = calendar.freeSlots
        .map(s => {
          const start     = new Date(s.start);
          const end       = new Date(s.end);
          const slotStart = start > localNow ? start : localNow;
          return { start, end, slotStart };
        })
        .filter(({ slotStart, end }) => (end - slotStart) >= 60 * 60 * 1000)
        .map(({ slotStart, end }) => {
          const s = toDisplay(slotStart, timezone);
          const e = toDisplay(end, timezone);
          return {
            isoStart: slotStart.toISOString(),
            isoEnd:   end.toISOString(),
            display:  `${s.dayName}, ${s.date} at ${s.time}`,
            dayName:  s.dayName,
            date:     s.date,
            time:     `${s.time} - ${e.time}`
          };
        });

      return _freeSlots;
    };

    // ── Tool definitions ──────────────────────────────────────────────────
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'show_services',
            description: 'Show the list of available services to the user.'
          },
          {
            name: 'initiate_payment',
            description: 'Initiate a payment for a consultation booking.',
            parameters: {
              type: 'OBJECT',
              properties: {
                service: { type: 'STRING', description: 'The service name' },
                name:    { type: 'STRING', description: 'Customer name' },
                email:   { type: 'STRING', description: 'Customer email' },
                start:   { type: 'STRING', description: 'ISO start time of the slot' },
                details: { type: 'STRING', description: 'Service specific details' },
                company: { type: 'STRING', description: 'Company name (optional)' }
              },
              required: ['service', 'name', 'email', 'start']
            }
          },
          {
            name: 'save_inquiry',
            description: 'Save an inquiry when a user is interested but not ready to book.',
            parameters: {
              type: 'OBJECT',
              properties: {
                service:  { type: 'STRING' },
                name:     { type: 'STRING' },
                email:    { type: 'STRING' },
                details:  { type: 'STRING' },
                timeline: { type: 'STRING' },
                budget:   { type: 'STRING' }
              }
            }
          }
        ]
      }
    ];

    // ── Build prompt ──────────────────────────────────────────────────────
    let prompt;
    let detectedLanguage = 'en';
    let ragIntent        = 'general';

    if (USE_RAG) {
      try {
        const retrievedData = await ragService.retrieveContext(message, history, null, namespace, currentLanguage);
        detectedLanguage    = currentLanguage || retrievedData.language || 'en';
        ragIntent           = retrievedData.intent || 'general';

        // Only fetch calendar if this looks like a booking conversation (also checks recent history)
        const calendarNeeded = needsCalendar(ragIntent, message, history);
        logger.debug('Calendar needed check', { sanitizedPhone, ragIntent, calendarNeeded });

        const slots = calendarNeeded ? await loadSlots() : [];
        const slotDetails = slots.length
          ? slots.map((s, i) => `${i + 1}. ${s.dayName}, ${s.date} at ${s.time} (ISO: ${s.isoStart})`).join('\n')
          : 'No slots preloaded — if the user wants to book, call the show_services or initiate_payment tool.';

        const now       = calendarNeeded ? _currentDate : (() => { const d = toDisplay(new Date(), timezone); return `${d.dayName}, ${d.date} at ${d.time}`; })();
        const dynamicData = {
          availableSlots: slotDetails,
          currentDate:    now,
          depositInfo: `All consultations require a commitment deposit of ${depositAmount} ${currency} to confirm booking.`,
          ...(isNewUser && {
            welcomeContext: buildWelcomeContext(userName, botName)
          })
        };

        prompt = ragService.buildAugmentedPrompt(retrievedData, message, dynamicData, { botName, language: detectedLanguage });
        logger.info(`RAG retrieved ${retrievedData.relevantDocs} docs, intent=${ragIntent}, calendar=${calendarNeeded}`);
      } catch (ragError) {
        logger.warn('RAG retrieval failed, using fallback', { error: ragError.message });
        detectedLanguage = currentLanguage || await ragService.detectLanguage(message, history);
        const calendarNeeded = needsCalendar('general', message, history);
        const slots = calendarNeeded ? await loadSlots() : [];
        const slotDetails = slots.map((s, i) => `${i + 1}. ${s.dayName}, ${s.date} at ${s.time} (ISO: ${s.isoStart})`).join('\n');
        const now = calendarNeeded ? _currentDate : (() => { const d = toDisplay(new Date(), timezone); return `${d.dayName}, ${d.date} at ${d.time}`; })();
        prompt = buildFallbackPrompt(slotDetails, now, detectedLanguage, botName, depositAmount, currency, isNewUser, userName);
      }
    } else {
      detectedLanguage = currentLanguage || await ragService.detectLanguage(message, history);
      const calendarNeeded = needsCalendar('general', message, history);
      const slots = calendarNeeded ? await loadSlots() : [];
      const slotDetails = slots.map((s, i) => `${i + 1}. ${s.dayName}, ${s.date} at ${s.time} (ISO: ${s.isoStart})`).join('\n');
      const now = calendarNeeded ? _currentDate : (() => { const d = toDisplay(new Date(), timezone); return `${d.dayName}, ${d.date} at ${d.time}`; })();
      prompt = buildFallbackPrompt(slotDetails, now, detectedLanguage, botName, depositAmount, currency, isNewUser, userName);
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite', tools });
    const chat  = model.startChat({
      systemInstruction: { parts: [{ text: prompt }] },
      history: getRecentHistory(history).map(h => ({
        role:  h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.content }]
      }))
    });

    // Language enforcement is now in the system prompt — do NOT append inline tags to the
    // user message, as system-prompt instructions carry higher model weight.
    const messageToSend = message;

    let result   = await chat.sendMessage(messageToSend);
    let response = result.response;
    let text     = response.text();

    // ── Tool call loop ────────────────────────────────────────────────────
    while (response.candidates?.[0]?.content?.parts?.some(p => p.functionCall)) {
      const functionCalls = response.candidates[0].content.parts
        .filter(p => p.functionCall).map(p => p.functionCall);

      const toolResults = [];

      for (const call of functionCalls) {

        if (call.name === 'show_services') {
          // Fetch slots on-demand since user is heading toward booking
          const freeSlots = await loadSlots().catch(() => []);
          toolResults.push({
            functionResponse: { name: 'show_services', response: { success: true, message: 'Displaying services list to user.' } }
          });
          return { reply: null, showServices: true, showSlots: false, freeSlots, language: detectedLanguage };
        }

        if (call.name === 'initiate_payment') {
          const data           = call.args;
          const requestedStart = new Date(data.start);
          logger.info('initiate_payment tool called', { data });

          // Ensure slots are loaded before matching
          const freeSlots = await loadSlots().catch(() => []);
          const matchingSlot = freeSlots.find(slot =>
            Math.abs(new Date(slot.isoStart) - requestedStart) < 60000
          );

          if (!matchingSlot) {
            toolResults.push({ functionResponse: { name: 'initiate_payment', response: { success: false, error: 'Time slot no longer available.' } } });
            continue;
          }

          try {
            const safePrefix = (botName || 'deposit').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
            const tx_ref     = `${safePrefix}-${phoneNumber.replace(/\+/g, '')}-${Date.now()}`;

            await dbConfig.db.ServiceRequest.create({
              clientId,
              service:       data.service,
              name:          data.name,
              email:         data.email,
              phone:         phoneNumber,
              company:       data.company,
              details:       data.details,
              startTime:     matchingSlot.isoStart,
              endTime:       matchingSlot.isoEnd,
              txRef:         tx_ref,
              amount:        depositAmount,
              paymentStatus: 'pending',
              status:        'pending_payment'
            });

            const paymentRes = await fetch('https://api.flutterwave.com/v3/payments', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tx_ref,
                amount:        depositAmount,
                currency,
                redirect_url:  paymentRedirectUrl,
                customer:      { email: data.email || 'customer@example.com', phone_number: phoneNumber.replace('+', ''), name: data.name },
                customizations:{ title: `${botName} Consultation Deposit`, description: `Deposit for ${data.service} consultation` },
                meta:          { phone: phoneNumber, booking_details: JSON.stringify({ ...data, slotStart: matchingSlot.isoStart, slotEnd: matchingSlot.isoEnd, tx_ref }) }
              })
            });

            const paymentData = await paymentRes.json();
            toolResults.push(paymentData.status === 'success'
              ? { functionResponse: { name: 'initiate_payment', response: { success: true, paymentLink: paymentData.data.link } } }
              : { functionResponse: { name: 'initiate_payment', response: { success: false, error: 'Payment gateway error' } } }
            );
          } catch (e) {
            logger.error('Error in initiate_payment tool', { error: e.message });
            toolResults.push({ functionResponse: { name: 'initiate_payment', response: { success: false, error: e.message } } });
          }
        }

        if (call.name === 'save_inquiry') {
          try {
            await dbConfig.db.ServiceRequest.create({ ...call.args, clientId, phone: phoneNumber, status: 'new' });
            toolResults.push({ functionResponse: { name: 'save_inquiry', response: { success: true, message: 'Inquiry saved successfully.' } } });
          } catch (e) {
            toolResults.push({ functionResponse: { name: 'save_inquiry', response: { success: false, error: e.message } } });
          }
        }
      }

      result   = await chat.sendMessage(toolResults);
      response = result.response;
      text     = response.text();
    }

    const responseText = result.response.text();
    let parsedResult;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsedResult    = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch {
      parsedResult = { reply: responseText, language: detectedLanguage, showServices: false, showSlots: false };
    }

    return {
      reply:        parsedResult.reply || text || null,
      language:     parsedResult.language || detectedLanguage || 'en',
      showServices: parsedResult.showServices || false,
      showSlots:    parsedResult.showSlots    || false,
      freeSlots:    parsedResult.freeSlots    || []
    };

  } catch (err) {
    logger.error('Gemini processing error', { phone: sanitizedPhone, error: err.message, stack: err.stack, status: err.status });
    console.log(err)
    if (err.status === 429) return { reply: "🔄 We're experiencing high demand right now. Please try again in a moment or type 'menu' to see our services.", showServices: false, showSlots: false, freeSlots: [] };
    if (err.status === 503) return { reply: "⚠️ Our AI is currently busy. Please try again in a few seconds.", showServices: false, showSlots: false, freeSlots: [] };
    return { reply: "I'm having trouble connecting right now. Please try again in a moment!", showServices: false, showSlots: false, freeSlots: [] };
  }
}

function buildWelcomeContext(userName, botName) {
  const greeting = userName ? `Hello ${userName}` : 'Hello';
  return `FIRST-TIME USER — This is the user's very first message.
Your response MUST follow this structure:
1. Start with a warm personal greeting: "${greeting}, Welcome to ${botName}!"
2. In 1-2 sentences, briefly describe what ${botName} offers (draw from the RELEVANT INFORMATION section).
3. If the user asked a specific question in their message, answer it directly.
4. Close by inviting them to share how you can help: "How can I assist you today?"
Keep the entire reply friendly and concise.`;
}

function buildFallbackPrompt(slotDetails, currentDate, locale = 'en', botName = 'Our Company', depositAmount = 5000, currency = 'RWF', isNewUser = false, userName = null) {
  const welcomeSection = isNewUser ? `\n${buildWelcomeContext(userName, botName)}\n` : '';
  return `
You are a warm, professional AI assistant for ${botName}.

CRITICAL LANGUAGE RULE:
- ALWAYS respond in the SAME language as the user's CURRENT message.
- Supported: English (en), French (fr), Kinyarwanda (rw), Swahili (sw), German (de).
- NEVER default to English if the user's current message is in another language.
${welcomeSection}
CORE BEHAVIOR:
- Be friendly but brief and to-the-point
- Keep responses under 3 sentences unless asking follow-up questions

${slotDetails ? `AVAILABLE CONSULTATION SLOTS:\n${slotDetails}\n` : ''}
Current Date: ${currentDate}
${slotDetails ? `Deposit required to confirm booking: ${depositAmount} ${currency}` : ''}

OUTPUT FORMAT:
ALWAYS return your response in the following JSON format:
{
  "language": "iso_code",
  "reply": "your response text here"
}
`;
}
