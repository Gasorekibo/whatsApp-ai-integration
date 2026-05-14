import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../logger/logger.js';

const CLASSIFIABLE_INTENTS = new Set(['general', 'services', 'order', 'handoff']);

/**
 * Uses Gemini to classify a free-text message into one of the four intents.
 * Called only when keyword detection fails — adds ~1 fast API call.
 *
 * Returns one of: 'general' | 'services' | 'order' | 'handoff' | null
 * Returns null when the message is too ambiguous to classify confidently
 * (caller should fall back to showing the intent list).
 */
export async function classifyIntent(message, client) {
  const geminiKey = client?.getDecryptedGeminiKey?.();
  if (!geminiKey) return null;

  // Don't waste a call on very short messages — they're genuinely ambiguous
  if (message.trim().split(/\s+/).length < 2) return null;

  try {
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: { temperature: 0, maxOutputTokens: 10 },
    });

    const prompt = `You are an intent classifier for a WhatsApp business assistant.
Classify the customer message below into exactly ONE of these categories:

general   — questions about contact info, phone, email, location, address, business hours, website, FAQs
services  — questions about what services or products the business offers, pricing, availability
order     — wanting to book, schedule an appointment, make a payment, or check a booking/order status
handoff   — wanting to speak with a real human, agent, or staff member
unknown   — cannot clearly determine what the customer wants

Reply with ONLY the single word (no punctuation, no explanation).

Customer message: "${message.replace(/"/g, "'")}"

Intent:`;

    const raw    = (await model.generateContent(prompt)).response.text().trim().toLowerCase();
    const intent = raw.replace(/[^a-z]/g, '');

    if (CLASSIFIABLE_INTENTS.has(intent)) {
      logger.info('intentClassifier: classified', { intent, message: message.slice(0, 60) });
      return intent;
    }

    logger.debug('intentClassifier: unknown/ambiguous', { raw, message: message.slice(0, 60) });
    return null;
  } catch (err) {
    logger.warn('intentClassifier: Gemini call failed', { error: err.message });
    return null;
  }
}
