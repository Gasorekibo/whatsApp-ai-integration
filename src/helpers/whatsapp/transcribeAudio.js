import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../../logger/logger.js';

dotenv.config();

export async function transcribeWhatsAppAudio(mediaId, mimeType = 'audio/ogg; codecs=opus', credentials = null) {
  const waToken   = credentials?.token;
  const geminiKey = credentials?.geminiApiKey;

  if (!waToken || !geminiKey) {
    throw new Error('transcribeWhatsAppAudio: missing client credentials (token or geminiApiKey)');
  }

  const genAI = new GoogleGenerativeAI(geminiKey);

  // Step 1: Resolve media URL from media ID
  const mediaMetaUrl = `https://graph.facebook.com/v22.0/${mediaId}`;
  const metaRes = await fetch(mediaMetaUrl, {
    headers: { Authorization: `Bearer ${waToken}` }
  });

  if (!metaRes.ok) {
    const body = await metaRes.text();
    throw new Error(`Failed to retrieve media metadata (${metaRes.status}): ${body}`);
  }

  const mediaMeta = await metaRes.json();
  const audioUrl = mediaMeta.url;

  if (!audioUrl) {
    throw new Error('No audio URL returned from WhatsApp media API');
  }

  // Step 2: Download audio bytes
  const audioRes = await fetch(audioUrl, {
    headers: { Authorization: `Bearer ${waToken}` }
  });

  if (!audioRes.ok) {
    const body = await audioRes.text();
    throw new Error(`Failed to download audio (${audioRes.status}): ${body}`);
  }

  const audioBuffer = await audioRes.arrayBuffer();
  const base64Audio = Buffer.from(audioBuffer).toString('base64');

  logger.info('Audio downloaded for transcription', {
    mediaId,
    mimeType,
    sizeBytes: audioBuffer.byteLength
  });

  // Step 3: Transcribe with Gemini
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });

  const result = await model.generateContent([
    {
      inlineData: {
        data: base64Audio,
        mimeType
      }
    },
    'Transcribe this voice message accurately. Return ONLY the transcribed text with no additional commentary, labels, or formatting.'
  ]);

  const transcription = result.response.text().trim();

  logger.info('Audio transcription complete', {
    mediaId,
    transcriptionLength: transcription.length
  });

  return transcription;
}
