import dbConfig from '../models/index.js';
import { sendWhatsAppMessage } from './whatsapp/sendWhatsappMessage.js';
import { bookingService } from '../services/booking.service.js';
import logger from '../logger/logger.js';
import dotenv from 'dotenv';
dotenv.config();

function clientCredentials(client) {
  return {
    phoneNumberId: client?.whatsappBusinessId,
    token:         client?.getDecryptedWhatsappToken?.()
  };
}

// Verify the transaction directly with the Flutterwave API.
async function verifyTransaction(transactionId, secretKey) {
  const res  = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' }
  });
  const data = await res.json();
  return data;
}

// Core processing — idempotent (safe to call from both redirect and webhook).
async function processSuccessfulPayment(txRef, transactionId) {
  logger.payment('info', 'processSuccessfulPayment: START', { txRef, transactionId });

  // Find the pending ServiceRequest
  const sr = await dbConfig.db.ServiceRequest.findOne({ where: { txRef } });
  if (!sr) {
    logger.payment('warn', 'processSuccessfulPayment: ServiceRequest not found', { txRef });
    return { success: false, error: 'booking_not_found' };
  }

  logger.payment('info', 'processSuccessfulPayment: ServiceRequest found', {
    txRef,
    srId:          sr.id,
    paymentStatus: sr.paymentStatus,
    status:        sr.status,
    clientId:      sr.clientId,
    service:       sr.service,
    name:          sr.name,
    email:         sr.email,
    phone:         sr.phone,
    startTime:     sr.startTime,
    endTime:       sr.endTime,
  });

  // Idempotency — already processed (webhook or a previous redirect visit)
  if (sr.paymentStatus === 'paid') {
    logger.payment('info', 'processSuccessfulPayment: already processed (paymentStatus=paid)', { txRef });
    return { success: true, alreadyProcessed: true, sr };
  }

  // Resolve client for calendar + WhatsApp credentials
  const client = await dbConfig.db.Client.findByPk(sr.clientId);
  if (!client) {
    logger.payment('error', 'processSuccessfulPayment: client not found', { clientId: sr.clientId });
    return { success: false, error: 'client_not_found' };
  }

  logger.payment('info', 'processSuccessfulPayment: client found', {
    clientId:            client.id,
    clientName:          client.name,
    timezone:            client.timezone,
    whatsappBusinessId:  client.whatsappBusinessId,
    hasWhatsappToken:    !!client.getDecryptedWhatsappToken?.(),
  });

  // Verify with Flutterwave so we can't be spoofed via a direct browser visit
  const flwKey = client.getDecryptedFlutterwaveKey?.() || process.env.FLW_SECRET_KEY || '';
  logger.payment('info', 'processSuccessfulPayment: Flutterwave key check', {
    hasClientKey:      !!client.getDecryptedFlutterwaveKey?.(),
    hasFallbackEnvKey: !!process.env.FLW_SECRET_KEY,
    keyResolved:       !!flwKey,
  });

  if (!flwKey) {
    logger.payment('error', 'processSuccessfulPayment: no Flutterwave key available', { clientId: client.id });
    return { success: false, error: 'no_flw_key' };
  }

  if (transactionId) {
    try {
      logger.payment('info', 'processSuccessfulPayment: calling Flutterwave verify API', { transactionId });
      const verification = await verifyTransaction(transactionId, flwKey);
      logger.payment('info', 'processSuccessfulPayment: Flutterwave verification response', {
        txRef,
        httpStatus:  verification.status,
        dataStatus:  verification.data?.status,
        dataTxRef:   verification.data?.tx_ref,
        dataAmount:  verification.data?.amount,
        message:     verification.message,
      });
      if (verification.status !== 'success' || verification.data?.status !== 'successful') {
        logger.payment('warn', 'processSuccessfulPayment: verification did not pass', {
          txRef,
          verificationStatus:     verification.status,
          verificationDataStatus: verification.data?.status,
          message:                verification.message,
        });
        return { success: false, error: 'verification_failed' };
      }
      logger.payment('info', 'processSuccessfulPayment: Flutterwave verification PASSED', { txRef });
    } catch (err) {
      logger.payment('warn', 'processSuccessfulPayment: verification API call threw', {
        error: err.message,
        stack: err.stack,
      });
      // Don't block on network issues — continue using the txRef match as proof
    }
  } else {
    logger.payment('warn', 'processSuccessfulPayment: no transactionId — skipping Flutterwave verification', { txRef });
  }

  // Mark payment as paid immediately so concurrent calls don't double-book
  logger.payment('info', 'processSuccessfulPayment: running conditional UPDATE (pending → paid)', { txRef });
  const [updatedRows] = await dbConfig.db.ServiceRequest.update(
    { paymentStatus: 'paid', status: 'confirmed' },
    { where: { txRef, paymentStatus: 'pending' } }
  );
  logger.payment('info', 'processSuccessfulPayment: conditional UPDATE result', { txRef, updatedRows });

  // Re-fetch to confirm we won the race
  await sr.reload();
  logger.payment('info', 'processSuccessfulPayment: after reload', {
    txRef,
    paymentStatus: sr.paymentStatus,
    status:        sr.status,
  });

  if (sr.paymentStatus !== 'paid') {
    logger.payment('info', 'processSuccessfulPayment: lost race — another process already handled it', { txRef });
    return { success: true, alreadyProcessed: true, sr };
  }

  // Create Google Calendar event
  const bookingParams = {
    title:         `${sr.service} – ${sr.name}`,
    start:         sr.startTime,
    end:           sr.endTime,
    attendeeEmail: sr.email,
    clientId:      sr.clientId,
    description:
      `Service: ${sr.service}\nPhone: ${sr.phone}\n` +
      `Deposit paid. Transaction: ${txRef}`,
  };
  logger.payment('info', 'processSuccessfulPayment: calling bookingService.bookMeeting', bookingParams);

  const bookingResult = await bookingService.bookMeeting(bookingParams);

  logger.payment('info', 'processSuccessfulPayment: bookMeeting returned', {
    txRef,
    success:      bookingResult.success,
    error:        bookingResult.error,
    meetLink:     bookingResult.meetLink,
    calLink:      bookingResult.link,
    rawResult:    JSON.stringify(bookingResult),
  });

  if (!bookingResult.success) {
    // Revert status so the admin can retry / refund
    await dbConfig.db.ServiceRequest.update(
      { paymentStatus: 'paid', status: 'booking_failed' },
      { where: { txRef } }
    );
    logger.payment('error', 'processSuccessfulPayment: bookMeeting FAILED — status set to booking_failed', {
      txRef, bookingError: bookingResult.error,
    });
    return { success: false, error: 'calendar_failed', bookingError: bookingResult.error, sr, client };
  }

  await dbConfig.db.ServiceRequest.update(
    { status: 'confirmed' },
    { where: { txRef } }
  );

  logger.payment('info', 'processSuccessfulPayment: SUCCESS — calendar event created', {
    txRef,
    meetLink: bookingResult.meetLink,
    calLink:  bookingResult.link,
  });

  return {
    success:  true,
    sr,
    client,
    meetLink: bookingResult.meetLink || null,
    calLink:  bookingResult.link     || null,
  };
}

// ── Express handler ────────────────────────────────────────────────────────────

async function successfulPaymentPageHandler(req, res) {
  const { status, tx_ref, transaction_id } = req.query;

  logger.payment('info', 'Payment redirect hit', { status, tx_ref, transaction_id });
  console.log('Payment redirect query params:', JSON.stringify(req.query, null, 2));

  // Respond to the browser immediately with a clean page
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Payment Confirmation</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; text-align: center; background: #f5f5f5; }
    .card { background: #fff; padding: 40px 20px; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,.1); margin-top: 50px; }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { color: #333; margin-bottom: 8px; }
    p  { color: #666; line-height: 1.6; }
    .note { background: #e8f5e9; padding: 14px; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${status === 'successful' ? '✅' : '⚠️'}</div>
    <h1>${status === 'successful' ? 'Payment Successful!' : 'Payment Incomplete'}</h1>
    <p>${status === 'successful'
      ? 'Thank you for your deposit.'
      : 'Your payment did not complete. Please try again or contact support.'}</p>
    ${status === 'successful' ? `
    <div class="note">
      <p><strong>Your booking is being confirmed.</strong></p>
      <p>You'll receive a WhatsApp message with your appointment details shortly.</p>
    </div>` : ''}
    <p style="margin-top:28px;font-size:13px;color:#aaa">You can close this page.</p>
  </div>
</body>
</html>`);

  // Process after responding — don't hold up the browser
  if (status !== 'successful' || !tx_ref) {
    logger.payment('info', 'Payment redirect: non-successful status, skipping booking', { status, tx_ref });
    return;
  }

  try {
    const result = await processSuccessfulPayment(tx_ref, transaction_id);
    if (!result.success) {
      logger.payment('error', 'Payment redirect: processing failed', { tx_ref, error: result.error });
      return;
    }
    if (result.alreadyProcessed) return;

    const { sr, client, meetLink, calLink } = result;
    if (!client || !sr) return;

    // Format date
    const start = new Date(sr.startTime);
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
    logger.payment('info', 'Payment redirect: WhatsApp confirmation sent', { tx_ref, phone });

  } catch (err) {
    logger.payment('error', 'Payment redirect: unhandled error', { error: err.message, stack: err.stack, tx_ref });
  }
}

export { processSuccessfulPayment };
export default successfulPaymentPageHandler;
