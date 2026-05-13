import { GoogleGenerativeAI } from '@google/generative-ai';
import { getClientGeneralInfo } from '../../../services/generalInfo.service.js';
import logger from '../../../logger/logger.js';

const LANGUAGE_NAMES = {
  en: 'English', fr: 'French', rw: 'Kinyarwanda', sw: 'Kiswahili', de: 'German'
};

// Keywords that signal a general inquiry question answerable from the JSON file
const GENERAL_KEYWORDS = /\b(phone|number|contact|call|email|mail|location|address|where|office|find|hours|open|close|schedule|days|time|website|site|link|whatsapp|faq|deliver|payment|pay|method|accept)\b/i;

/**
 * Handles general inquiries (contact info, hours, FAQs) using the client's
 * general.json file rather than Pinecone — faster, cheaper, deterministic.
 *
 * @returns {string|null} - AI-formatted reply, or null if the question isn't
 *                          answerable from the JSON (caller should fall through to RAG)
 */
export async function handleGeneralInquiry(userMessage, session, client) {
  const info = await getClientGeneralInfo(client.id);

  if (!info) {
    logger.debug('generalInquiryHandler: no general.json — falling through to RAG', { clientId: client.id });
    return null;
  }

  // If the question doesn't look like a general-info question, let RAG handle it
  if (!GENERAL_KEYWORDS.test(userMessage)) {
    logger.debug('generalInquiryHandler: message not general-info type — falling through to RAG');
    return null;
  }

  const langName = LANGUAGE_NAMES[session.language] || 'English';
  const geminiKey = client.getDecryptedGeminiKey?.();
  if (!geminiKey) return null;

  const genAI = new GoogleGenerativeAI(geminiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: { temperature: 0, maxOutputTokens: 300 }
  });

  // Format info as readable text rather than raw JSON to keep the prompt short
  const infoText = formatInfoForPrompt(info);

  const prompt = `You are a customer-facing representative of ${client.botName || client.name}. Speak AS the company — use "we", "our", "us". Never say you are an AI or bot.
Answer the user's question in ${langName} using ONLY the business information below.
If the answer is not in the information provided, say you don't have that detail and suggest they contact us directly.
Keep your reply concise (1-3 sentences).

Business information:
${infoText}

User question: ${userMessage}

Reply in ${langName}:`;

  try {
    const result = await model.generateContent(prompt);
    const reply  = result.response.text().trim();
    logger.info('generalInquiryHandler: answered from JSON', { clientId: client.id, language: session.language });
    return reply;
  } catch (err) {
    logger.error('generalInquiryHandler: Gemini call failed', { error: err.message });
    return null; // fall through to RAG
  }
}

function formatInfoForPrompt(info) {
  const lines = [];
  if (info.phone)    lines.push(`Phone: ${info.phone}`);
  if (info.whatsapp) lines.push(`WhatsApp: ${info.whatsapp}`);
  if (info.email)    lines.push(`Email: ${info.email}`);
  if (info.location) lines.push(`Location: ${info.location}`);
  if (info.hours)    lines.push(`Business hours: ${info.hours}`);
  if (info.website)  lines.push(`Website: ${info.website}`);
  if (Array.isArray(info.faqs) && info.faqs.length > 0) {
    lines.push('FAQs:');
    info.faqs.forEach(f => lines.push(`  Q: ${f.q}\n  A: ${f.a}`));
  }
  return lines.join('\n') || 'No information available.';
}
