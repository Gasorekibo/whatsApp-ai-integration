import dotenv from 'dotenv';
import { systemInstruction } from '../../constants/constantMessages.js';
import googleSheets from '../../utils/googlesheets.js';
import getCalendarData from '../../utils/getCalendarData.js';
import dbConfig from '../../models/index.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { whatsappSessions } from '../../controllers/whatsappController.js';
import logger from '../../logger/logger.js';
import ragService from '../../services/rag.service.js';

dotenv.config();

import { DateTime } from 'luxon';

function toDisplay(date, timezone, locale = 'en') {
  const dt = DateTime.fromJSDate(date).setZone(timezone).setLocale(locale);
  return {
    dayName: dt.toFormat('EEEE'),
    date:    dt.toFormat('LLLL d, yyyy'),
    time:    dt.toFormat('t')
  };
}

// Flag to enable/disable RAG (for gradual rollout)
const USE_RAG = process.env.USE_RAG !== 'false';

export async function processWithGemini(phoneNumber, message, history = [], userEmail = null, currentLanguage = null, clientConfig = {}) {
  const sanitizedPhone = `***${phoneNumber.slice(-4)}`;

  // ── Per-client configuration ──────────────────────────────────────────────
  const genAI             = new GoogleGenerativeAI(clientConfig.geminiApiKey || process.env.GEMINI_API_KEY);
  const timezone          = clientConfig.timezone          || 'Africa/Kigali';
  const companyName       = clientConfig.companyName       || process.env.COMPANY_NAME || 'Our Company';
  const paymentRedirectUrl = clientConfig.paymentRedirectUrl || process.env.PAYMENT_REDIRECT_URL || '';
  const depositAmount     = clientConfig.depositAmount     || parseInt(process.env.DEPOSIT_AMOUNT || 5000);
  const currency          = clientConfig.currency          || process.env.CURRENCY || 'RWF';
  const namespace         = clientConfig.pineconeIndex     || 'default';
  const clientId          = clientConfig.clientId          || null;

  logger.gemini('info', 'Processing request with Gemini from ' + sanitizedPhone, {
    phone: sanitizedPhone,
    messageLength: message.length,
    historyLength: history.length,
    hasUserEmail: !!userEmail,
    clientId,
    namespace
  });

  try {
    // ── Resolve the employee for this client's calendar ───────────────────
    const employeeWhere = clientId
      ? { clientId }
      : { email: process.env.EMPLOYEE_EMAIL };

    const employee = await dbConfig.db.Employee.findOne({ where: employeeWhere });
    if (!employee) {
      logger.error('No employee/calendar found for this client', { sanitizedPhone, clientId });
      throw new Error('Calendar not connected');
    }

    const token         = employee.getDecryptedToken();
    const calendarStart = Date.now();
    const calendar      = await getCalendarData(employee.email, token);
    logger.info('Calendar data retrieved', {
      phone: sanitizedPhone,
      duration: Date.now() - calendarStart,
      freeSlotsCount: calendar.freeSlots?.length || 0
    });

    const now        = new Date();
    const localNow   = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const MIN_MS     = 60 * 60 * 1000;

    const freeSlots = calendar.freeSlots
      .map(s => {
        const start     = new Date(s.start);
        const end       = new Date(s.end);
        const slotStart = start > localNow ? start : localNow;
        return { start, end, slotStart };
      })
      .filter(({ slotStart, end }) => (end - slotStart) >= MIN_MS)
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

    const services = await googleSheets.getActiveServices(clientId);
    logger.debug('Services loaded', { phone: sanitizedPhone, servicesCount: services.length });

    const servicesList = services.map(s =>
      `• ${s.name}${s.details ? ' - ' + s.details : ''}`
    ).join('\n');

    const slotDetails = freeSlots.map((s, i) =>
      `${i + 1}. ${s.dayName}, ${s.date} at ${s.time} (ISO: ${s.isoStart})`
    ).join('\n');

    const { dayName: cdDay, date: cdDate, time: cdTime } = toDisplay(now, timezone);
    const currentDate = `${cdDay}, ${cdDate} at ${cdTime}`;

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

    let prompt;
    let detectedLanguage = 'en';

    if (USE_RAG) {
      try {
        const retrievedData = await ragService.retrieveContext(message, history, null, namespace);
        detectedLanguage = currentLanguage || retrievedData.language || 'en';

        const dynamicData = {
          availableSlots: slotDetails,
          currentDate,
          depositInfo: `All consultations require a commitment deposit of ${depositAmount} ${currency} to confirm booking.`
        };

        prompt = ragService.buildAugmentedPrompt(retrievedData, message, dynamicData, { companyName });
        logger.info(`RAG retrieved ${retrievedData.relevantDocs} relevant documents`);
      } catch (ragError) {
        logger.warn('RAG retrieval failed, using fallback', { error: ragError.message });
        detectedLanguage = currentLanguage || await ragService.detectLanguage(message, history);
        prompt = buildFallbackPrompt(slotDetails, currentDate, detectedLanguage, companyName, depositAmount, currency);
      }
    } else {
      detectedLanguage = currentLanguage || await ragService.detectLanguage(message, history);
      prompt = buildFallbackPrompt(slotDetails, currentDate, detectedLanguage, companyName, depositAmount, currency);
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', tools });

    const chat = model.startChat({
      systemInstruction: { parts: [{ text: prompt }] },
      history: history.map(h => ({
        role:  h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.content }]
      }))
    });

    const langNames = { en: 'English', fr: 'French', rw: 'Kinyarwanda', de: 'German', sw: 'Swahili', kis: 'Swahili' };
    const msgLangName = langNames[currentLanguage];
    const messageToSend = msgLangName
      ? `${message}\n\n[IMPORTANT: This message is in ${msgLangName}. You MUST respond ONLY in ${msgLangName}.]`
      : message;

    let result   = await chat.sendMessage(messageToSend);
    let response = result.response;
    let text     = response.text();

    // ── Tool call loop ────────────────────────────────────────────────────
    while (response.candidates?.[0]?.content?.parts?.some(p => p.functionCall)) {
      const functionCalls = response.candidates[0].content.parts
        .filter(p => p.functionCall)
        .map(p => p.functionCall);

      const toolResults = [];

      for (const call of functionCalls) {

        if (call.name === 'show_services') {
          logger.info('show_services tool called', { call });
          toolResults.push({
            functionResponse: {
              name: 'show_services',
              response: { success: true, message: 'Displaying services list to user.' }
            }
          });
          return { reply: null, showServices: true, showSlots: false, freeSlots, language: detectedLanguage };
        }

        if (call.name === 'initiate_payment') {
          const data           = call.args;
          const requestedStart = new Date(data.start);
          logger.info('initiate_payment tool called', { data });

          const matchingSlot = freeSlots.find(slot =>
            Math.abs(new Date(slot.isoStart) - requestedStart) < 60000
          );

          if (!matchingSlot) {
            toolResults.push({ functionResponse: { name: 'initiate_payment', response: { success: false, error: 'Time slot no longer available.' } } });
            continue;
          }

          try {
            const safePrefix = (companyName || 'deposit').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
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
              headers: {
                'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                tx_ref,
                amount:       depositAmount,
                currency,
                redirect_url: paymentRedirectUrl,
                customer: {
                  email:        data.email || 'customer@example.com',
                  phone_number: phoneNumber.replace('+', ''),
                  name:         data.name
                },
                customizations: {
                  title:       `${companyName} Consultation Deposit`,
                  description: `Deposit for ${data.service} consultation`
                },
                meta: {
                  phone: phoneNumber,
                  booking_details: JSON.stringify({
                    ...data,
                    slotStart: matchingSlot.isoStart,
                    slotEnd:   matchingSlot.isoEnd,
                    tx_ref
                  })
                }
              })
            });

            const paymentData = await paymentRes.json();
            if (paymentData.status === 'success') {
              toolResults.push({
                functionResponse: {
                  name: 'initiate_payment',
                  response: { success: true, paymentLink: paymentData.data.link }
                }
              });
            } else {
              toolResults.push({ functionResponse: { name: 'initiate_payment', response: { success: false, error: 'Payment gateway error' } } });
            }
          } catch (e) {
            logger.error('Error in initiate_payment tool', { error: e.message, stack: e.stack });
            toolResults.push({ functionResponse: { name: 'initiate_payment', response: { success: false, error: e.message } } });
          }
        }

        if (call.name === 'save_inquiry') {
          try {
            await dbConfig.db.ServiceRequest.create({
              ...call.args,
              clientId,
              phone:  phoneNumber,
              status: 'new'
            });
            toolResults.push({
              functionResponse: {
                name: 'save_inquiry',
                response: { success: true, message: 'Inquiry saved successfully.' }
              }
            });
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
    logger.error('Gemini processing error', {
      phone: sanitizedPhone,
      error: err.message,
      stack: err.stack,
      status: err.status
    });

    if (err.status === 429) {
      return { reply: "🔄 We're experiencing high demand right now. Please try again in a moment or type 'menu' to see our services.", showServices: false, showSlots: false, freeSlots: [] };
    }
    if (err.status === 503) {
      return { reply: "⚠️ Our AI is currently busy. Please try again in a few seconds. If the issue persists, type 'menu' to see our services.", showServices: false, showSlots: false, freeSlots: [] };
    }
    return { reply: "I'm having trouble connecting right now. Please try again in a moment!", showServices: false, showSlots: false, freeSlots: [] };
  }
}

function buildFallbackPrompt(slotDetails, currentDate, locale = 'en', companyName = 'Our Company', depositAmount = 5000, currency = 'RWF') {
  return `
You are a warm, professional AI assistant for ${companyName}.

CRITICAL LANGUAGE RULE:
- ALWAYS respond in the SAME language as the user's CURRENT message.
- Determine the language by reading ONLY the user's current message.
- Supported: English (en), French (fr), Kinyarwanda (rw), Swahili (sw), German (de).
- NEVER default to English if the user's current message is in another language.

CORE BEHAVIOR:
- Be friendly but brief and to-the-point
- Keep responses under 3 sentences unless asking follow-up questions

AVAILABLE CONSULTATION SLOTS:
${slotDetails}

Current Date: ${currentDate}

Deposit required to confirm booking: ${depositAmount} ${currency}

OUTPUT FORMAT:
ALWAYS return your response in the following JSON format:
{
  "language": "iso_code",
  "reply": "your response text here"
}
`;
}
