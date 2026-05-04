import dbConfig from '../models/index.js';
import { sendWhatsAppMessage } from './whatsapp/sendWhatsappMessage.js';
import dotenv from 'dotenv';
import logger from '../logger/logger.js'
import { flutterwaveUtil } from '../utils/flutterwave.js';
import { bookingService } from '../services/booking.service.js';

dotenv.config();

function clientCredentials(client) {
  return {
    phoneNumberId: client?.whatsappBusinessId,
    token:         client?.getDecryptedWhatsappToken?.()
  };
}

async function paymentWebhookHandler(req, res) {
  const secretHash = process.env.FLW_WEBHOOK_SECRET;
  const signature = req.headers['verif-hash'];

  if (!signature || signature !== secretHash) {
    return res.status(401).end();
  }

  try {
    const payload = req.body;

    if (payload.event === 'charge.completed' && payload.data?.status === 'successful') {
      logger.payment('info', 'Received successful payment webhook', {
        tx_ref: payload.data.tx_ref,
        amount: payload.data.amount,
        currency: payload.data.currency,
        payment_type: payload.data.payment_type,
      });

      const meta = payload.meta || payload.meta_data;

      logger.payment('debug', 'Webhook Meta Data', { meta });

      if (!meta?.booking_details) {
        logger.payment('warn', 'Missing booking_details in webhook meta', { tx_ref: payload.data.tx_ref });
        return res.status(200).end();
      }

      let booking;
      try {
        booking = typeof meta.booking_details === 'string' ? JSON.parse(meta.booking_details) : meta.booking_details;
      } catch (e) {
        logger.payment('error', 'Failed to parse booking_details', { error: e.message, booking_details: meta.booking_details });
        return res.status(200).end();
      }

      logger.payment('info', 'Processing booking from webhook', { booking });
      let phone = meta.phone || booking.phone;
      const normalizedPhone = phone.toString().replace(/^\+/, '');

      let message;
      let success = false;
      let bookingError = null;
      let client = null;

      try {
        await dbConfig.db.sequelize.transaction(async (t) => {
          // 1. Find and update the ServiceRequest record
          const serviceRequest = await dbConfig.db.ServiceRequest.findOne({
            where: { txRef: payload.data.tx_ref },
            transaction: t
          });

          if (serviceRequest) {
            serviceRequest.paymentStatus = 'paid';
            serviceRequest.status = 'confirmed';
            await serviceRequest.save({ transaction: t });

            // Resolve the client so we can use its calendar and WhatsApp credentials
            if (serviceRequest.clientId) {
              client = await dbConfig.db.Client.findByPk(serviceRequest.clientId, { transaction: t });
            }
          }

          // 2. Create calendar booking on the client's dedicated calendar
          const bookingResult = await bookingService.bookMeeting({
            title: booking.title || `Consultation - ${booking.name}`,
            start: booking.slotStart || booking.start,
            end: booking.slotEnd || booking.end,
            attendeeEmail: booking.email,
            clientId: serviceRequest?.clientId || null,
            description: `Service: ${booking.service}\n` +
              `Phone: ${phone}\n` +
              `Company: ${booking.company || 'N/A'}\n` +
              `Details: ${booking.details || 'N/A'}\n` +
              `Deposit Paid: ${payload.data.amount} ${payload.data.currency}\n` +
              `Transaction Ref: ${payload.data.tx_ref}\n` +
              `Payment Method: ${payload.data.payment_type}`
          });
          logger.info('Booking result', { success: bookingResult.success });

          if (!bookingResult.success) {
            throw new Error("Booking service failed to confirm booking");
          }

          success = true;
        });
      } catch (transactionError) {
        bookingError = transactionError.message;
        logger.payment('error', 'Transaction failed during webhook processing', {
          tx_ref: payload.data.tx_ref,
          error: transactionError.message
        });

        // Initiate automated refund
        try {
          await flutterwaveUtil.refundTransaction(payload.data.id, payload.data.amount);

          // Update ServiceRequest status to reflect failed booking and refund
          await dbConfig.db.ServiceRequest.update(
            { paymentStatus: 'refunded', status: 'failed' },
            { where: { txRef: payload.data.tx_ref } }
          );
        } catch (refundError) {
          logger.payment('error', 'Auto-refund process failed', {
            tx_ref: payload.data.tx_ref,
            error: refundError.message
          });
        }

        success = false;
      }

      const start = new Date(booking.slotStart || booking.start);
      const displayDate = start.toLocaleString('en-US', {
        timeZone: 'Africa/Kigali',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });

      if (success) {
        message = `✅ *Booking Confirmed!*\n\n` +
          `Thank you ${booking.name}! Your deposit of *${payload.data.amount} ${payload.data.currency}* was successful.\n\n` +
          `📅 *Consultation Details:*\n` +
          `• Service: ${booking.service}\n` +
          `• Date & Time: ${displayDate}\n` +
          `• Duration: 1 hour\n\n` +
          `📧 Check your email (*${booking.email}*) for:\n` +
          `✓ Calendar invite\n` +
          `✓ Google Meet link\n` +
          `✓ Pre-consultation form\n\n` +
          `We can't wait to help you grow! 🚀\n\n` +
          `_Type 'menu' anytime to see our services again._`;
      } else {
        const errorReason = bookingError?.toLowerCase().includes('already booked') || bookingError?.toLowerCase().includes('taken')
          ? "the time slot was just taken"
          : "we encountered an issue finalizing your booking";

        message = `⚠️ *Payment Received*\n\n` +
          `Your deposit of ${payload.data.amount} ${payload.data.currency} was successful, but ${errorReason}.\n\n` +
          `Don't worry! Our team will:\n` +
          `✓ Process a full refund within 24 hours\n` +
          `✓ Contact you at ${booking.email} to reschedule\n\n` +
          `We apologize for the inconvenience!`;
      }

      await sendWhatsAppMessage(phone, message, clientCredentials(client));

    } else {
      // Payment not successful — look up client via tx_ref so we can send from the right number
      const meta = req.body.meta || req.body.meta_data;
      let failedClient = null;
      try {
        const sr = await dbConfig.db.ServiceRequest.findOne({ where: { txRef: req.body.data?.tx_ref } });
        if (sr?.clientId) failedClient = await dbConfig.db.Client.findByPk(sr.clientId);
      } catch (_) {}

      const failedPaymentMessage = `⚠️ *Payment Not Successful*\n\n` +
        `We noticed that your recent payment did not go through successfully.\n\n` +
        `Please try again or contact support if the issue persists.\n\n` +
        `Thank you!`;

      await sendWhatsAppMessage(meta?.phone, failedPaymentMessage, clientCredentials(failedClient));
    }

    res.status(200).json({ success: true });

  } catch (err) {
    logger.error('Payment Webhook Error', { error: err.message, stack: err.stack });
    res.status(200).json({ success: false, error: err.message });
  }
}

export default paymentWebhookHandler;
