import dotenv from 'dotenv';
import { systemInstruction } from  '../../constants/constantMessages.js';
import {getActiveServices} from '../../utils/googlesheets.js';
import getCalendarData from '../../utils/getCalendarData.js';
import { db } from '../../models/index.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { whatsappSessions } from '../../controllers/whatsappController.js';
dotenv.config();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const EMPLOYEE_EMAIL = process.env.EMPLOYEE_EMAIL;

export async function processWithGemini(phoneNumber, message, history = [], userEmail = null) {
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