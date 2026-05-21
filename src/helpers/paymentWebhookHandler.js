import { sendWhatsAppMessage } from './whatsapp/sendWhatsappMessage.js';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';
import dotenv from 'dotenv';
// processSuccessfulPayment handles all the booking logic and is idempotent
import { processSuccessfulPayment } from './successfulPaymentPageHandler.js';

dotenv.config();

function clientCredentials(client) {
  return {
    phoneNumberId: client?.whatsappBusinessId,
    token:         client?.getDecryptedWhatsappToken?.()
  };
}

async function paymentWebhookHandler(req, res) {
  const signature  = req.headers['verif-hash'];
  const secretHash = process.env.FLW_WEBHOOK_SECRET;

  logger.payment('info', 'Flutterwave webhook received', {
    event:          req.body?.event,
    status:         req.body?.data?.status,
    tx_ref:         req.body?.data?.tx_ref,
    hasSignature:   !!signature,
    signatureMatch: signature === secretHash,
  });
  if (!signature || signature !== secretHash) {
    logger.payment('warn', 'Webhook signature mismatch — rejecting', {
      received: signature ? '(present but wrong)' : '(missing)',
    });
    return res.status(401).end();
  }

  // Acknowledge immediately
  res.status(200).json({ received: true });

  try {
    const payload = req.body;
    console.log('Received webhook payload:', JSON.stringify(payload, null, 2));

    if (payload.event === 'charge.completed' && payload.data?.status === 'successful') {
      const tx_ref         = payload.data.tx_ref;
      const transaction_id = payload.data.id?.toString();

      logger.payment('info', 'Webhook: processing successful payment', { tx_ref, transaction_id });

      const result = await processSuccessfulPayment(tx_ref, transaction_id);
      console.log('========> Result of processing payment:', JSON.stringify(result, null, 2));

      if (!result.success) {
        logger.payment('error', 'Webhook: booking failed', { tx_ref, error: result.error });

        // If calendar failed, attempt refund
        if (result.error === 'calendar_failed') {
          try {
            const { flutterwaveUtil } = await import('../utils/flutterwave.js');
            await flutterwaveUtil.refundTransaction(payload.data.id, payload.data.amount);
            await dbConfig.db.ServiceRequest.update(
              { paymentStatus: 'refunded', status: 'failed' },
              { where: { txRef: tx_ref } }
            );
            logger.payment('info', 'Webhook: refund initiated', { tx_ref });
          } catch (refundErr) {
            logger.payment('error', 'Webhook: refund failed', { error: refundErr.message });
          }

          // Notify user
          const { sr, client } = result;
          if (sr && client) {
            const phone = (sr.phone || '').replace(/^\+/, '');
            await sendWhatsAppMessage(phone,
              `⚠️ *Payment Received — Booking Pending*\n\nYour deposit was successful but we had trouble creating your calendar event. Our team will contact you at *${sr.email}* to reschedule or refund within 24 hours.`,
              clientCredentials(client)
            ).catch(() => {});
          }
        }
        return;
      }

      if (result.alreadyProcessed) {
        logger.payment('info', 'Webhook: already processed by redirect handler', { tx_ref });
        return;
      }

      // Webhook confirmed booking — redirect handler will also send the WhatsApp message,
      // but if redirect didn't fire (user closed browser), send it here.
      const { sr, client, meetLink, calLink } = result;
      if (!client || !sr) return;

      const start       = new Date(sr.startTime);
      const displayDate = isNaN(start.getTime()) ? 'your scheduled time' : start.toLocaleString('en-US', {
        timeZone: client.timezone || 'Africa/Kigali',
        weekday: 'long', year: 'numeric', month: 'long',
        day: 'numeric', hour: 'numeric', minute: '2-digit',
      });

      const lines = [
        `✅ *Booking Confirmed!*`,
        ``,
        `Your appointment has been booked successfully.`,
        ``,
        `📋 *Details:*`,
        `• Service:   ${sr.service}`,
        `• Date/Time: ${displayDate}`,
        `• Duration:  1 hour`,
      ];
      if (meetLink) lines.push(``, `🎥 *Google Meet:* ${meetLink}`);
      if (calLink)  lines.push(`📆 *Calendar:*    ${calLink}`);
      lines.push(``, `📧 A calendar invite has been sent to *${sr.email}*.`, ``, `_Type 'menu' anytime to restart._`);

      const phone = (sr.phone || '').replace(/^\+/, '');
      await sendWhatsAppMessage(phone, lines.join('\n'), clientCredentials(client));
      logger.payment('info', 'Webhook: WhatsApp confirmation sent', { tx_ref, phone });

    } else {
      logger.payment('info', 'Webhook: non-success event', {
        event: payload.event, status: payload.data?.status, tx_ref: payload.data?.tx_ref
      });
    }
  } catch (err) {
    logger.payment('error', 'Webhook: unhandled error', { error: err.message, stack: err.stack });
  }
}

export default paymentWebhookHandler;
