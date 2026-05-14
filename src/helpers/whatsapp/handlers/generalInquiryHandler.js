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

function formatHours(hours) {
  if (!hours || typeof hours !== 'object' || Object.keys(hours).length === 0) return null;

  const entries = Object.entries(hours);

  // Onboarding flat format: { mon_fri: "9am–5pm", saturday: "10am–2pm", sunday: "Closed", notes: "..." }
  const FLAT_KEYS = new Set(['mon_fri', 'saturday', 'sunday', 'notes']);
  if (entries.some(([k]) => FLAT_KEYS.has(k))) {
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
