
const {db}  = require('../models/index.js');
const { sendWhatsAppMessage } = require('./whatsapp/sendWhatsappMessage.js');
require('dotenv').config();


 async function paymentWebhookHandler(req, res) {
  const secretHash = process.env.FLW_WEBHOOK_SECRET;
  const signature = req.headers['verif-hash'];

  if (!signature || signature !== secretHash) {

    return res.status(401).end();
  }


  try {
    const payload = req.body;

    if (payload.event === 'charge.completed' && payload.data?.status === 'successful') {
      const meta = payload.meta_data;
      

      if (!meta?.booking_details) {
        return res.status(200).end();
      }

      const booking = JSON.parse(meta.booking_details);
      let phone = meta.phone || booking.phone;;
      const normalizedPhone = phone.toString().replace(/^\+/, '');
      const session = await db.UserSession.findOne({ where: { phone: normalizedPhone } });
      
      if (!session) {
        try {
          const message = `✅ *Payment Received!*\n\n` +
                        `Your deposit of ${payload.data.amount} ${payload.data.currency} was successful.\n\n` +
                        `We're processing your booking now. You'll receive a confirmation email at ${booking.email} shortly.\n\n` +
                        `Thank you for choosing Moyo Tech Solutions! 🚀`;
          
          await sendWhatsAppMessage(phone, message);
        } catch (msgErr) {
          console.error('❌ Could not send message:', msgErr);
        }
        
        return res.status(200).end();
      }

      const startISO = booking.start;
      const endISO = booking.end;
      // Create calendar booking
      const bookRes = await fetch('http://localhost:3000/api/chat/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: booking.title || `Consultation - ${booking.name}`,
          start: startISO,  
          end: endISO,  
          attendeeEmail: booking.email,
          description: `Service: ${booking.service}\n` +
                      `Phone: ${phone}\n` +
                      `Company: ${booking.company || 'N/A'}\n` +
                      `Details: ${booking.details || 'N/A'}\n` +
                      `Deposit Paid: ${payload.data.amount} ${payload.data.currency}\n` +
                      `Transaction Ref: ${booking.tx_ref}\n` +
                      `Payment Method: ${payload.data.payment_type}`
        })
      });

      const result = await bookRes.json();
      const start = new Date(startISO);
      const displayDate = start.toLocaleString('en-US', { 
        timeZone: 'Africa/Kigali', 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: 'numeric', 
        minute: '2-digit' 
      });

      let message;
      if (result.success) {
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
        message = `⚠️ Payment Received\n\n` +
                  `Your deposit of ${payload.data.amount} ${payload.data.currency} was successful, but the time slot was just taken.\n\n` +
                  `Don't worry! Our team will:\n` +
                  `✓ Process a full refund within 24 hours\n` +
                  `✓ Contact you at ${booking.email} to reschedule\n\n` +
                  `We apologize for the inconvenience!`;
      }

      await sendWhatsAppMessage(phone, message);

    } else {
      // Payment not successful
      const failedPaymentMessage = `⚠️ *Payment Not Successful*\n\n` +
                                   `We noticed that your recent payment did not go through successfully.\n\n` +
                                   `Please try again or contact support if the issue persists.\n\n` +
                                   `Thank you!`;
      await sendWhatsAppMessage(meta.phone || 'Client', failedPaymentMessage);

    }

    res.status(200).json({ success: true });

  } catch (err) {
  console.log('Payment Webhook Error===========>:', err);
    res.status(200).json({ success: false, error: err.message });
  }
}
module.exports = { paymentWebhookHandler };