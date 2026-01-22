require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bookMeetingHandler = require('./src/controllers/bookMeeting');
const { oauth2Client } = require('./src/utils/auth');
const { verifyWebhook, handleWebhook } = require('./src/controllers/whatsappController');
const { initializeServices } = require('./src/utils/googleSheets');
const adminRoutes = require('./src/routes/admin');
const { paymentWebhookHandler } = require('./src/helpers/paymentWebhookHandler');
const { syncServicesHandler } = require('./src/helpers/syncServicesHandler');
const { googleSheetsWebhookHandler } = require('./src/helpers/googleSheetsWebhookHandler');
const { calendarDataHandler } = require('./src/helpers/calendarDataHandler');
const { zohoAuthenticationRedirect } = require('./src/helpers/zoho/zohoAuthenticationRedirect');
const { zohoAuthCallbackHandler } = require('./src/helpers/zoho/zohoAuthCallbackHandler');
const { zohoGetAllContactsHandler } = require('./src/helpers/zoho/zohoGetAllContactsHandler');
const { successfulPaymentPageHandler } = require('./src/helpers/successfulPaymentPageHandler');
const { syncDatabase, db } = require('./src/models');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));

// Static files
app.use(express.static('src/public'));

// API Routes
app.post('/api/chat/book', bookMeetingHandler);
app.use('/api/outreach', adminRoutes);

// WhatsApp Webhook
app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhook);

// Google OAuth Routes
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ],
    prompt: 'consent',
  });
  res.redirect(url);
});

app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  
  try {
    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch user info from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const userInfo = await userInfoRes.json();

    // Find or create employee (Sequelize)
    let employee = await db.Employee.findOne({
      where: { email: userInfo.email }
    });

    if (employee) {
      employee.name = userInfo.name;
      employee.email = userInfo.email;
      if (tokens.refresh_token) {
        employee.refreshToken = tokens.refresh_token;
      }
      
      await employee.save();
      console.log('✅ Employee updated:', userInfo.email);
    } else {
      // Create new employee
      employee = await db.Employee.create({
        name: userInfo.name,
        email: userInfo.email,
        refreshToken: tokens.refresh_token || null
      });
      console.log('✅ New employee created =============>:', userInfo);
    }

    // Success page
    res.send(`
      <html>
        <head>
          <title>Authentication Success</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              max-width: 600px; 
              margin: 50px auto; 
              padding: 20px; 
              text-align: center; 
            }
            h2 { color: #4CAF50; }
            .info { 
              background: #f5f5f5; 
              padding: 15px; 
              border-radius: 8px; 
              margin: 20px 0; 
            }
            a {
              display: inline-block;
              margin-top: 20px;
              padding: 10px 20px;
              background: #4CAF50;
              color: white;
              text-decoration: none;
              border-radius: 5px;
            }
            a:hover {
              background: #45a049;
            }
          </style>
        </head>
        <body>
          <h2>✅ Authentication Successful!</h2>
          <div class="info">
            <p><strong>Connected as:</strong> ${userInfo.name}</p>
            <p><strong>Email:</strong> ${userInfo.email}</p>
          </div>
          <p>You can now use the sync services endpoint.</p>
          <a href="/">Go to Dashboard</a>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('❌ OAuth error:', err);
    res.status(500).send(`
      <html>
        <head>
          <title>Authentication Failed</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              max-width: 600px; 
              margin: 50px auto; 
              padding: 20px; 
              text-align: center; 
            }
            h2 { color: #f44336; }
            .error { 
              background: #ffebee; 
              padding: 15px; 
              border-radius: 8px; 
              margin: 20px 0; 
              color: #c62828;
            }
          </style>
        </head>
        <body>
          <h2>❌ Authentication Failed</h2>
          <div class="error">
            <p>There was an error during authentication.</p>
            <p>Please try again.</p>
          </div>
          <a href="/auth">Retry Authentication</a>
        </body>
      </html>
    `);
  }
});

// Zoho OAuth Routes
app.get('/auth/zoho', zohoAuthenticationRedirect);
app.get('/zoho/oauth/callback', zohoAuthCallbackHandler);
app.get('/api/zoho/contacts', zohoGetAllContactsHandler);
// Employee Routes
app.get('/employees', async (req, res) => {
  try {
    const employees = await db.Employee.findAll({ 
      attributes: ['id', 'name', 'email', 'createdAt'],
      order: [['createdAt', 'DESC']]
    });
    res.json({
      success: true,
      count: employees.length,
      employees
    });
  } catch (error) {
    console.error('❌ Error fetching employees:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employees',
      error: error.message
    });
  }
});

// Payment & Calendar Webhooks
app.post('/webhook/flutterwave', express.json(), paymentWebhookHandler);
app.get('/payment-success', successfulPaymentPageHandler);
app.post('/calendar-data', calendarDataHandler);

// Google Sheets Sync
app.post('/api/sync-services', syncServicesHandler);
app.post('/api/webhook/sheets-sync', googleSheetsWebhookHandler);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await db.sequelize.authenticate();
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Server initialization
(async () => {
  try {
    // Sync database with PostgreSQL
    console.log('🔄 Syncing database...');
    await syncDatabase({ alter: true }); // Use { force: true } only in dev to reset DB
    console.log('✅ Database synced successfully');

    // Initialize default services
    console.log('🔄 Initializing services...');
    await initializeServices();
    console.log('✅ Services initialized');

    // Start server
    app.listen(PORT, () => {
      console.log('════════════════════════════════════════');
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🗄️  Database: PostgreSQL (Sequelize)`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
      console.log('════════════════════════════════════════');
    });

  } catch (error) {
    console.error('❌ Server initialization failed:', error.message);
    console.error(error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  try {
    await db.sequelize.close();
    console.log('✅ Database connections closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 SIGTERM received, shutting down...');
  try {
    await db.sequelize.close();
    console.log('✅ Database connections closed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

module.exports = app;