import dotenv from 'dotenv';
import { systemInstruction } from  '../../constants/constantMessages.js';
import googleSheets from '../../utils/googlesheets.js';
import { systemInstruction } from '../../constants/constantMessages.js';
import { getActiveServices } from '../../utils/googlesheets.js';
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
    const employee = await dbConfig.db.Employee.findOne({where: { email: EMPLOYEE_EMAIL }});
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

    let prompt;

    // RAG-based approach
    if (USE_RAG) {
      try {
        console.log('🤖 Using RAG for context retrieval...');

        // Retrieve relevant context using RAG
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
        console.error('⚠️ RAG failed, falling back to original prompt:', ragError.message);
        // Fallback to original approach
        prompt = buildFallbackPrompt(slotDetails, currentDate);
      }
    } else {
      // Original approach (fallback)
      console.log('📝 Using original prompt approach...');
      prompt = buildFallbackPrompt(slotDetails, currentDate);
    }

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

    logger.gemini('info', 'Sending message to Gemini API From processWithGemini', {
      phone: sanitizedPhone,
      messageLength: message.length
    });

    const geminiStartTime = Date.now();
    const result = await chat.sendMessage(message);
    const geminiDuration = Date.now() - geminiStartTime;
    const text = result.response.text();

    logger.gemini('info', 'Gemini API response received', {
      phone: sanitizedPhone,
      duration: geminiDuration,
      responseLength: text.length
    });

    const showServicesMatch = text.match(/===SHOW_SERVICES===/);
    const paymentMatch = text.match(/===INITIATE_PAYMENT===\s*(\{.*?\})/s);
    const saveMatch = text.match(/===SAVE_REQUEST===\s*(\{.*?\})/s);

    let reply = text
      .replace(/===SHOW_SERVICES===|===INITIATE_PAYMENT===\s*\{.*?\}|===SAVE_REQUEST===\s*\{.*?\}|```json|```/gi, '')
      .trim() || "I'm here to help! How can I assist you today?";

    if (showServicesMatch) {
       logger.gemini('info', 'Gemini requested to show services From processWithGemini', {
        phone: sanitizedPhone
      });
      return { reply: null, showServices: true, showSlots: false, freeSlots };
    }

    if (paymentMatch) {
       logger.payment('info', 'Payment initiation requested from processWithGemini', {
        phone: sanitizedPhone
      });
      try {
        const data = JSON.parse(paymentMatch[1]);
        const requestedStart = new Date(data.start);

        const matchingSlot = freeSlots.find(slot => {
          const slotStart = new Date(slot.isoStart);
          return Math.abs(slotStart - requestedStart) < 60000;
        });

        if (!matchingSlot) {
           logger.payment('warn', 'Requested time slot not available', {
            phone: sanitizedPhone,
            requestedTime: data.start,
            availableSlots: freeSlots.length
          });
          reply = "I apologize, but that time slot is no longer available. Here are the current available times:";
          return { reply, showServices: false, showSlots: true, freeSlots };
        }

        const tx_ref = `moyo-deposit-${phoneNumber.replace(/\+/g, '')}-${Date.now()}`;
        logger.payment('info', 'Initiating Flutterwave payment', {
          phone: sanitizedPhone,
          tx_ref,
          amount: process.env.DEPOSIT_AMOUNT,
          currency: process.env.CURRENCY,
          slotStart: matchingSlot.isoStart
        });
        const paymentApiStartTime = Date.now();
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
        const paymentApiDuration = Date.now() - paymentApiStartTime;
        const paymentResponse = await paymentApiResponse.json();
         logger.payment('info', 'Flutterwave API response received', {
          phone: sanitizedPhone,
          tx_ref,
          duration: paymentApiDuration,
          status: paymentResponse.status,
          hasLink: !!paymentResponse.data?.link
        });
        if (paymentResponse.status === "success") {
          const paymentLink = paymentResponse.data.link;
            logger.payment('info', 'Payment link generated successfully', {
            phone: sanitizedPhone,
            tx_ref,
            linkGenerated: true
          });
          reply = `Great! To secure your consultation slot, please pay a commitment deposit of *${process.env.DEPOSIT_AMOUNT} ${process.env.CURRENCY}*.\n\n` +
            `This ensures we're both serious about the meeting.\n\n` +
            `👉 *Tap to pay securely (Mobile Money or Card):*\n${paymentLink}\n\n` +
            `After payment, your booking will be automatically confirmed and you'll receive a Google Meet link via email.\n\n` +
            `Thank you for choosing Moyo Tech Solutions! 🚀`;
        } else {
          logger.payment('error', 'Flutterwave payment link generation failed', {
            phone: sanitizedPhone,
            tx_ref,
            flutterwaveResponse: paymentResponse
          });
          console.error('Flutterwave error:', paymentResponse);
          reply = "Sorry, I couldn't generate the payment link right now. Please try again in a moment.";
        }

        return { reply, showServices: false, showSlots: false, freeSlots };
      } catch (e) {
       logger.payment('error', 'Payment initiation error', {
          phone: sanitizedPhone,
          error: e.message,
          stack: e.stack
        });
        reply = "There was a technical issue preparing payment. Please try again shortly.";
        return { reply };
      }
    }

    if (saveMatch) {
      logger.info('Saving service request', {
        phone: sanitizedPhone
      });
      try {
        const data = JSON.parse(saveMatch[1]);
        await dbConfig.db.ServiceRequest.create({
          ...data,
          phone: data.phone || phoneNumber,
          status: 'new'
        });
         logger.info('Service request saved successfully', {
          phone: sanitizedPhone,
          service: data.service
        });
        reply += "\n\nYour inquiry has been saved. We'll follow up soon!";
      } catch (e) {
        logger.error('Save request error', {
          phone: sanitizedPhone,
          error: e.message,
          stack: e.stack
        });
        console.error('Save request error:', e);
      }
    }
      logger.gemini('info', 'Gemini processing completed', {
      phone: sanitizedPhone,
      replyLength: reply.length,
      showServices: false,
      showSlots: false
    });
    return { reply, showServices: false, showSlots: false, freeSlots };

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
    }else {
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
  const services = await getActiveServices();
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