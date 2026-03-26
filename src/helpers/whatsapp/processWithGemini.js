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
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const EMPLOYEE_EMAIL = process.env.EMPLOYEE_EMAIL;

import { DateTime } from 'luxon';

function toKigaliDisplay(date, locale = 'en') {
  const dt = DateTime.fromJSDate(date).setZone('Africa/Kigali').setLocale(locale);
  return {
    dayName: dt.toFormat('EEEE'),
    date: dt.toFormat('LLLL d, yyyy'),
    time: dt.toFormat('t')
  };
}

// Flag to enable/disable RAG (for gradual rollout)
const USE_RAG = process.env.USE_RAG !== 'false'; // Default to true

export async function processWithGemini(phoneNumber, message, history = [], userEmail = null, currentLanguage = null) {
  const sanitizedPhone = `***${phoneNumber.slice(-4)}`;

  logger.gemini('info', 'Processing request with Gemini from ' + sanitizedPhone, {
    phone: sanitizedPhone,
    messageLength: message.length,
    historyLength: history.length,
    hasUserEmail: !!userEmail
  });
  try {
    logger.debug('Fetching employee calendar data, From Process Gemini', {
      phone: sanitizedPhone,
      employeeEmail: EMPLOYEE_EMAIL
    });
    const employee = await dbConfig.db.Employee.findOne({ where: { email: EMPLOYEE_EMAIL } });
    if (!employee) {
      logger.error('Employee not found for calendar access', {
        phone: sanitizedPhone,
        employeeEmail: EMPLOYEE_EMAIL
      });
      throw new Error("Calendar not connected")
    };

    const token = employee.getDecryptedToken();
    const calendarStartTime = Date.now();
    const calendar = await getCalendarData(EMPLOYEE_EMAIL, token);
    const calendarDuration = Date.now() - calendarStartTime;
    logger.info('Calendar data retrieved', {
      phone: sanitizedPhone,
      duration: calendarDuration,
      freeSlotsCount: calendar.freeSlots?.length || 0
    });
    const now = new Date();
    const kigaliTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Kigali' }));

    // Minimum slot duration in milliseconds (60 minutes)
    const MIN_SLOT_DURATION_MS = 60 * 60 * 1000;

    const freeSlots = calendar.freeSlots
      .map(s => {
        const start = new Date(s.start);
        const end = new Date(s.end);
        const slotStart = start > kigaliTime ? start : kigaliTime;
        return { start, end, slotStart };
      })
      // Filter out slots where the adjusted start is at or past the end,
      // or where less than 30 minutes remain in the slot
      .filter(({ slotStart, end }) => (end - slotStart) >= MIN_SLOT_DURATION_MS)
      .map(({ slotStart, end }) => {
        const s = toKigaliDisplay(slotStart);
        const e = toKigaliDisplay(end);
        return {
          isoStart: slotStart.toISOString(),
          isoEnd: end.toISOString(),
          display: `${s.dayName}, ${s.date} at ${s.time}`,
          dayName: s.dayName,
          date: s.date,
          time: `${s.time} - ${e.time}`
        };
      });

    const services = await googleSheets.getActiveServices();
    logger.debug('Services loaded from ProcessWithGemini', {
      phone: sanitizedPhone,
      servicesCount: services.length
    });
    const servicesList = services.map(s =>
      `• ${s.name}${s.details ? ' - ' + s.details : ''}`
    ).join('\n');
    const slotDetails = freeSlots.map((s, i) =>
      `${i + 1}. ${s.dayName}, ${s.date} at ${s.time} (ISO: ${s.isoStart})`
    ).join('\n');

    const { dayName: cdDay, date: cdDate, time: cdTime } = toKigaliDisplay(now);
    const currentDate = `${cdDay}, ${cdDate} at ${cdTime}`;

    // --- TOOL DEFINITIONS ---
    const tools = [
      {
        functionDeclarations: [
          {
            name: "show_services",
            description: "Show the list of available services to the user."
          },
          {
            name: "initiate_payment",
            description: "Initiate a payment for a consultation booking.",
            parameters: {
              type: "OBJECT",
              properties: {
                service: { type: "STRING", description: "The service name" },
                name: { type: "STRING", description: "Customer name" },
                email: { type: "STRING", description: "Customer email" },
                start: { type: "STRING", description: "ISO start time of the slot" },
                details: { type: "STRING", description: "Service specific details" },
                company: { type: "STRING", description: "Company name (optional)" }
              },
              required: ["service", "name", "email", "start"]
            }
          },
          {
            name: "save_inquiry",
            description: "Save an inquiry when a user is interested but not ready to book.",
            parameters: {
              type: "OBJECT",
              properties: {
                service: { type: "STRING" },
                name: { type: "STRING" },
                email: { type: "STRING" },
                details: { type: "STRING" },
                timeline: { type: "STRING" },
                budget: { type: "STRING" }
              }
            }
          }
        ]
      }
    ];

    let prompt;
    let detectedLanguage = 'en';

    // RAG-based approach
    if (USE_RAG) {
      try {
        const retrievedData = await ragService.retrieveContext(message, history);
        // detectedLanguage is used only for the show_services early return.
        // The prompt itself instructs Gemini to auto-detect language from the current message,
        // so we don't inject detectedLanguage into the prompt anymore.
        detectedLanguage = currentLanguage || retrievedData.language || 'en';

        // Build dynamic data that changes frequently
        const dynamicData = {
          availableSlots: slotDetails,
          currentDate: currentDate,
          depositInfo: `All consultations require a commitment deposit of ${process.env.DEPOSIT_AMOUNT} ${process.env.CURRENCY} to confirm booking.`
        };

        // Build augmented prompt
        prompt = ragService.buildAugmentedPrompt(retrievedData, message, dynamicData);

        logger.info(`RAG retrieved ${retrievedData.relevantDocs} relevant documents`);
      } catch (ragError) {
        logger.warn('RAG retrieval failed, using fallback', { error: ragError.message });
        detectedLanguage = currentLanguage || await ragService.detectLanguage(message, history);
        prompt = await buildFallbackPrompt(slotDetails, currentDate, detectedLanguage);
      }
    } else {
      detectedLanguage = currentLanguage || await ragService.detectLanguage(message, history);
      prompt = await buildFallbackPrompt(slotDetails, currentDate, detectedLanguage);
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools: tools
    });

    // Always start a fresh chat to ensure the systemInstruction (prompt) 
    // is updated with the latest RAG context from this specific message.
    const chat = model.startChat({
      systemInstruction: { parts: [{ text: prompt }] },
      history: history.map(h => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.content }]
      }))
    });

    // Append the detected language as an in-message hint.
    // System instructions can be overridden by conversation history language momentum,
    // but an explicit hint inside the message itself is much harder for the model to ignore.
    const langNames = { en: 'English', fr: 'French', rw: 'Kinyarwanda', de: 'German', sw: 'Swahili', kis: 'Swahili' };
    const msgLangName = langNames[currentLanguage];
    const messageToSend = msgLangName
      ? `${message}\n\n[IMPORTANT: This message is in ${msgLangName}. You MUST respond ONLY in ${msgLangName}.]`
      : message;

    let result = await chat.sendMessage(messageToSend);
    let response = result.response;
    let text = response.text();

    // Loop to handle potential function calls
    while (response.candidates?.[0]?.content?.parts?.some(part => part.functionCall)) {
      const functionCalls = response.candidates[0].content.parts
        .filter(part => part.functionCall)
        .map(part => part.functionCall);

      const toolResults = [];

      for (const call of functionCalls) {

        if (call.name === "show_services") {
          logger.info('Show services tool called', { call });
          toolResults.push({
            functionResponse: {
              name: "show_services",
              response: { success: true, message: "Displaying services list to user." }
            }
          });
          // Return early to handle special UI response
          return { reply: null, showServices: true, showSlots: false, freeSlots, language: detectedLanguage };
        }

        if (call.name === "initiate_payment") {
          const data = call.args;
          logger.info('Initiating payment tool called', { data });
          const requestedStart = new Date(data.start);

          const matchingSlot = freeSlots.find(slot => {
            const slotStart = new Date(slot.isoStart);
            return Math.abs(slotStart - requestedStart) < 60000;
          });

          if (!matchingSlot) {
            const errorMsg = "Time slot no longer available.";
            toolResults.push({ functionResponse: { name: "initiate_payment", response: { success: false, error: errorMsg } } });
            continue;
          }

          try {
            const tx_ref = `moyo-deposit-${phoneNumber.replace(/\+/g, '')}-${Date.now()}`;
            const amount = parseInt(process.env.DEPOSIT_AMOUNT || 5000);

            // Create a ServiceRequest record to track this booking attempt
            await dbConfig.db.ServiceRequest.create({
              service: data.service,
              name: data.name,
              email: data.email,
              phone: phoneNumber,
              company: data.company,
              details: data.details,
              startTime: matchingSlot.isoStart,
              endTime: matchingSlot.isoEnd,
              txRef: tx_ref,
              amount: amount,
              paymentStatus: 'pending',
              status: 'pending_payment'
            });

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
                redirect_url: "https://goldenlion.group/ai/payment-success",
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

              toolResults.push({
                functionResponse: {
                  name: "initiate_payment",
                  response: { success: true, paymentLink: paymentResponse.data.link }
                }
              });
            } else {
              toolResults.push({ functionResponse: { name: "initiate_payment", response: { success: false, error: "Payment gateway error" } } });
            }
          } catch (e) {
            logger.error('Error in initiate_payment tool', { error: e.message, stack: e.stack });
            toolResults.push({ functionResponse: { name: "initiate_payment", response: { success: false, error: e.message } } });
          }
        }

        if (call.name === "save_inquiry") {
          try {
            await dbConfig.db.ServiceRequest.create({
              ...call.args,
              phone: phoneNumber,
              status: 'new'
            });
            toolResults.push({
              functionResponse: {
                name: "save_inquiry",
                response: { success: true, message: "Inquiry saved successfully." }
              }
            });
          } catch (e) {
            toolResults.push({ functionResponse: { name: "save_inquiry", response: { success: false, error: e.message } } });
          }
        }
      }

      // Send tool results back to Gemini to get the final textual response
      result = await chat.sendMessage(toolResults);
      response = result.response;
      text = response.text(); // Update text for next loop iteration or final parsing
    }

    const responseText = result.response.text();
    let parsedResult;

    try {
      // Try to find JSON block in case model added text around it
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const jsonToParse = jsonMatch ? jsonMatch[0] : responseText;
      parsedResult = JSON.parse(jsonToParse);
    } catch (parseErr) {
      logger.error('Gemini JSON parse error, attempting fallback', {
        error: parseErr.message,
        text: responseText.slice(0, 50) + '...'
      });
      // Fallback: Treat as plain text if it's not valid JSON
      parsedResult = {
        reply: responseText,
        language: detectedLanguage, // Use detectedLanguage as fallback
        showServices: false,
        showSlots: false
      };
    }

    // Final cleanup of the reply and language
    let finalReply = parsedResult.reply;
    let finalLanguage = parsedResult.language || detectedLanguage || 'en';

    // If Gemini failed to return a JSON with a reply, use the text it returned
    if (!finalReply && text) {
      finalReply = text;
    }

    return {
      reply: finalReply,
      language: finalLanguage,
      showServices: parsedResult.showServices || false,
      showSlots: parsedResult.showSlots || false,
      freeSlots: parsedResult.freeSlots || []
    };

  } catch (err) {
    logger.error("Gemini processing error", {
      phone: sanitizedPhone,
      error: err.message,
      stack: err.stack,
      errorType: err.constructor.name,
      status: err.status
    });
    if (err.status === 429) {
      logger.warn('Gemini rate limit exceeded', {
        phone: sanitizedPhone,
        status: 429
      });
      return {
        reply: "🔄 We're experiencing high demand right now. Please try again in a moment or type 'menu' to see our services.",
        showServices: false,
        showSlots: false,
        freeSlots: []
      };
    } else {
      logger.error('Gemini unexpected error', {
        phone: sanitizedPhone,
        status: err.status
      });
      return {
        reply: "I'm having trouble connecting right now. Please try again in a moment!",
        showServices: false,
        showSlots: false,
        freeSlots: []
      };
    }
  }
}

/**
 * Build fallback prompt using original approach
 * Used when RAG is disabled or fails
 */
async function buildFallbackPrompt(slotDetails, currentDate, locale = 'en') {
  const services = await dbConfig.db.Content.findOne();
  const servicesList = services ? services.services : 'Consultation services';

  return `
You are a warm, professional AI assistant for Moyo Tech Solutions — a leading IT consultancy in Rwanda.

CRITICAL LANGUAGE RULE:
- ALWAYS respond in the SAME language as the user's CURRENT message.
- Determine the language by reading ONLY the user's current message — do NOT use the conversation history.
- If the user writes in Kinyarwanda → respond in Kinyarwanda.
- If in French → respond in French. If in English → respond in English.
- Supported: English (en), French (fr), Kinyarwanda (rw), Swahili (sw), German (de).
- NEVER default to English if the user's current message is in another language.

CORE BEHAVIOR:
- Be friendly but brief and to-the-point
- Keep responses under 3 sentences unless asking follow-up questions
- Get straight to what the user needs

SERVICES WE OFFER:
${servicesList}

AVAILABLE CONSULTATION SLOTS:
${slotDetails}

Current Date: ${currentDate}

OUTPUT FORMAT:
ALWAYS return your response in the following JSON format:
{
  "language": "iso_code", // Language matching the user's current message: en, fr, rw, sw, or de
  "reply": "your response text here"
}

If information is not available, politely say so.
`;
}