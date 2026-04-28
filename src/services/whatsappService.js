import { sendWhatsAppMessage } from '../helpers/whatsapp/sendWhatsappMessage.js';
import { transcribeWhatsAppAudio } from '../helpers/whatsapp/transcribeAudio.js';

function getCredentials(client) {
  if (!client) return null;
  return {
    token:         client.getDecryptedWhatsappToken?.() || null,
    phoneNumberId: client.whatsappBusinessId || null,
    geminiApiKey:  client.getDecryptedGeminiKey?.()    || null,
  };
}

export async function sendMessage({ client, to, message }) {
  return sendWhatsAppMessage(to, message, getCredentials(client));
}

export async function transcribeAudio({ client, mediaId, mimeType }) {
  return transcribeWhatsAppAudio(mediaId, mimeType, getCredentials(client));
}
