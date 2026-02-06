function successfulPaymentPageHandler(req, res) {
  res.send(`
    <html>
      <head>
        <title>Payment Successful</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            text-align: center;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 40px 20px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            margin-top: 50px;
          }
          .success-icon {
            font-size: 64px;
            color: #4CAF50;
            margin-bottom: 20px;
          }
          h1 {
            color: #333;
            margin-bottom: 10px;
          }
          p {
            color: #666;
            line-height: 1.6;
          }
          .highlight {
            background: #e8f5e9;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✅</div>
          <h1>Payment Successful!</h1>
          <p>Thank you for your deposit.</p>
          <div class="highlight">
            <p><strong>Your booking is being confirmed...</strong></p>
            <p>You'll receive a WhatsApp message with your booking details and Google Meet link shortly.</p>
          </div>
          <p style="margin-top: 30px; font-size: 14px; color: #999;">
            You can close this page now.
          </p>
        </div>
      </body>
    </html>
  `);
};
export default successfulPaymentPageHandler;