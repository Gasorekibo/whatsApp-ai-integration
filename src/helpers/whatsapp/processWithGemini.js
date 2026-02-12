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

// Flag to enable/disable RAG (for gradual rollout)
const USE_RAG = process.env.USE_RAG !== 'false'; // Default to true

export async function processWithGemini(phoneNumber, message, history = [], userEmail = null) {
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

    const currentDate = new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'Africa/Kigali'
    });

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

    // RAG-based approach
    if (USE_RAG) {
      try {
        const retrievedData = await ragService.retrieveContext(message, history);

        // Build dynamic data that changes frequently
        const dynamicData = {
          availableSlots: slotDetails,
          currentDate: currentDate,
          depositInfo: `All consultations require a commitment deposit of ${process.env.DEPOSIT_AMOUNT} ${process.env.CURRENCY} to confirm booking.`
        };

        // Build augmented prompt
        prompt = ragService.buildAugmentedPrompt(retrievedData, message, dynamicData);

        console.log(`✅ RAG retrieved ${retrievedData.relevantDocs} relevant documents`);
      } catch (ragError) {
        console.warn('⚠️ RAG retrieval failed, using fallback:', ragError.message);
        prompt = await buildFallbackPrompt(slotDetails, currentDate);
      }
    } else {
      prompt = await buildFallbackPrompt(slotDetails, currentDate);
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

    let result = await chat.sendMessage(message);
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
          console.log('============ SHOW SERVICES CALLED =============')
          toolResults.push({
            functionResponse: {
              name: "show_services",
              response: { success: true, message: "Displaying services list to user." }
            }
          });
          // Return early to handle special UI response
          return { reply: null, showServices: true, showSlots: false, freeSlots };
        }

        if (call.name === "initiate_payment") {
          console.log('============ INITIATE PAYMENT CALLED =============')
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
      text = response.text();
    }

    return { reply: text, showServices: false, showSlots: false, freeSlots };

  } catch (err) {
    logger.error("Gemini processing error", {
      phone: sanitizedPhone,
      error: err.message,
      stack: err.stack,
      errorType: err.constructor.name,
      status: err.status
    });
    console.error("❌ Gemini error:", err);
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
async function buildFallbackPrompt(slotDetails, currentDate) {
  const services = await googleSheets.getActiveServices();
  const servicesList = services.map(s =>
    `• ${s.name}${s.details ? ' - ' + s.details : ''}`
  ).join('\n');

  return systemInstruction
    .replace('{{SERVICES_LIST}}', servicesList)
    .replace('{{AVAILABLE_SLOTS}}', slotDetails)
    .replace('{{CURRENT_DATE}}', currentDate)
    .replace('{{DEPOSIT_AMOUNT}}', process.env.DEPOSIT_AMOUNT || '5,000')
    .replace('{{CURRENCY}}', process.env.CURRENCY || 'RWF');
}