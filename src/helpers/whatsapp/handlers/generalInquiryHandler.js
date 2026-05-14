import { GoogleGenerativeAI } from '@google/generative-ai';
import { getClientGeneralInfo } from '../../../services/generalInfo.service.js';
import logger from '../../../logger/logger.js';

const LANGUAGE_NAMES = {
  en: 'English', fr: 'French', rw: 'Kinyarwanda', sw: 'Kiswahili', de: 'German'
};

/**
 * Handles general inquiries (contact info, hours, FAQs) using structured DB data
 * rather than Pinecone — faster, cheaper, language-agnostic.
 *
 * The keyword gate has been intentionally removed: Gemini itself decides whether
 * the business info can answer the question. If not, it says so and the caller
 * falls through to RAG. This makes the handler work in any language.
 *
 * @returns {string|null} - AI reply, or null if info is missing / Gemini fails
 */
export async function handleGeneralInquiry(userMessage, session, client) {
  const info = await getClientGeneralInfo(client.id);

  if (!info) {
    logger.debug('generalInquiryHandler: no general info in DB — falling through to RAG', { clientId: client.id });
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

Your job: answer the customer's question in ${langName} using ONLY the business information provided below.

Rules:
- If the business information clearly answers the question, reply concisely (1-3 sentences).
- If the question is about something NOT covered in the business information (e.g. booking, specific medical advice, pricing of individual services), reply with exactly the single word: FALLBACK
- Never invent information not present below.

Business information:
${infoText}

Customer question: ${userMessage}

Reply in ${langName}:`;

  try {
    const result = await model.generateContent(prompt);
    const reply  = result.response.text().trim();

    // Model signals it can't answer from structured data → let RAG handle it
    if (reply.toUpperCase() === 'FALLBACK') {
      logger.debug('generalInquiryHandler: model returned FALLBACK — routing to RAG', { clientId: client.id });
      return null;
    }

    logger.info('generalInquiryHandler: answered from DB info', { clientId: client.id, language: session.language });
    return reply;
  } catch (err) {
    logger.error('generalInquiryHandler: Gemini call failed', { error: err.message });
    return null;
  }
}

function formatHours(hours) {
  if (!hours || typeof hours !== 'object' || Object.keys(hours).length === 0) return null;

  const entries = Object.entries(hours);

  // Flat format has string values: { mon_fri: "9am–5pm", saturday: "Closed", ... }
  // mon_fri only exists in the flat format, so it's the definitive check.
  if (typeof hours.mon_fri === 'string') {
    const lines = ['Business hours:'];
    const labels = { mon_fri: 'Mon–Fri', saturday: 'Saturday', sunday: 'Sunday' };
    ['mon_fri', 'saturday', 'sunday'].forEach(k => {
      if (hours[k]) lines.push(`  ${labels[k]}: ${hours[k]}`);
    });
    if (hours.notes) lines.push(`  Note: ${hours.notes}`);
    return lines;
  }

  // Admin structured format: { monday: { status, from, to }, ... }
  const all24 = entries.every(([, d]) => d?.status === '24hrs');
  if (all24) return ['Business hours: Open 24/7'];

  const lines = ['Business hours:'];
  entries.forEach(([day, d]) => {
    const label = day.charAt(0).toUpperCase() + day.slice(1);
    if (!d || d.status === 'closed')  lines.push(`  ${label}: Closed`);
    else if (d.status === '24hrs')    lines.push(`  ${label}: Open 24 hours`);
    else if (d.from && d.to)         lines.push(`  ${label}: ${d.from} – ${d.to}`);
    else                              lines.push(`  ${label}: Open`);
  });
  return lines;
}

function formatInfoForPrompt(info) {
  const lines = [];
  if (info.businessName) lines.push(`Business name: ${info.businessName}`);
  if (info.industry)     lines.push(`Industry: ${info.industry}`);
  if (info.description)  lines.push(`About: ${info.description}`);
  if (info.phone)        lines.push(`Phone: ${info.phone}`);
  if (info.whatsapp)     lines.push(`WhatsApp: ${info.whatsapp}`);
  if (info.email)        lines.push(`Email: ${info.email}`);
  if (info.website)      lines.push(`Website: ${info.website}`);
  if (info.location)     lines.push(`Location: ${info.location}`);
  if (info.mapsLink)     lines.push(`Google Maps: ${info.mapsLink}`);
  const hoursLines = formatHours(info.hours);
  if (hoursLines) lines.push(...hoursLines);
  if (Array.isArray(info.faqs) && info.faqs.length > 0) {
    lines.push('FAQs:');
    info.faqs.forEach(f => lines.push(`  Q: ${f.q}\n  A: ${f.a}`));
  }
  return lines.join('\n') || 'No information available.';
}
