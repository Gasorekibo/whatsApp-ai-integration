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

general   — ANY question seeking information: FAQs, contact info, location, hours, website, documents required, eligibility, procedures, how something works, what to bring, policies, requirements, or detailed questions about a specific service/treatment/product. Also includes questions about EXTERNAL things not provided by this business (transport costs, taxi/motorbike fares, travel time, directions, nearby landmarks, parking fees charged by others, etc.)
services  — ONLY when the user explicitly wants to browse or see the full list of services/products (e.g. "show me your services", "what do you offer?", "list your packages", "what treatments are available?")
order     — wanting to book, schedule, or confirm an appointment WITH THIS BUSINESS; expressing intent to visit or come ("I'll come tomorrow", "I want to come on Thursday", "I'd like to visit", "book this service", "can I come", "I want that service"); paying for THIS BUSINESS's service; or checking booking/order status
handoff   — wanting to speak with a real human, agent, or staff member
unknown   — cannot clearly determine what the customer wants

Key rules:
- Think about what the user TRULY needs, not just what they literally said. Read between the lines.
- If the message is a specific question (starts with what, which, how, who, when, why, can, is, are, do, does) → prefer "general" UNLESS the question reveals they want to use a service (e.g. "can I come for a check-up?", "do you treat stomach pain?", "what do I need to bring for an appointment?") → those are "order".
- Any mention of a personal symptom, health problem, or desire for a treatment/check-up/consultation → "order".
- Expressions of intent to visit, come, or book ("I'll come", "I want to come", "I'd like to visit", "I want that service", "book for me") → always "order".
- Questions about external costs or logistics (motorbike fare, taxi price, travel time, bus routes, directions from a location) → always "general", never "order".
- Mentions of "pay" or "payment" alone do NOT mean "order" — only classify as "order" if the user is clearly paying for or booking this business's service.
- When in doubt between "general" and "order" — if the user seems to be moving toward using the business, lean toward "order".

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
