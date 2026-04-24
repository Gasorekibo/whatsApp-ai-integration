import { processWithGemini } from '../helpers/whatsapp/processWithGemini.js';

export async function processAI({ client, from, message, history, userEmail, language }) {
  return processWithGemini(from, message, history, userEmail, language, {
    clientId:           client?.id                            || null,
    geminiApiKey:       client?.getDecryptedGeminiKey?.()    || null,
    pineconeIndex:      client?.pineconeIndex                 || null,
    companyName:        client?.companyName || client?.name  || null,
    timezone:           client?.timezone                      || null,
    paymentRedirectUrl: client?.paymentRedirectUrl            || null,
    currency:           client?.currency                      || null,
    depositAmount:      client?.depositAmount                 || null,
  });
}
