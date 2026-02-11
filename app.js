import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import bookMeetingHandler from './src/controllers/bookMeeting.js';
import oauth2Client from './src/utils/auth.js';
import { handleWebhook } from './src/controllers/whatsappController.js';
import adminRoutes from './src/routes/admin.js';
import paymentWebhookHandler from './src/helpers/paymentWebhookHandler.js';
import syncServicesHandler from './src/helpers/syncServicesHandler.js';
import googleSheetsWebhookHandler from './src/helpers/googleSheetsWebhookHandler.js';
import calendarDataHandler from './src/helpers/calendarDataHandler.js';
import { zohoAuthenticationRedirect } from './src/helpers/zoho/zohoAuthenticationRedirect.js';
import { zohoAuthCallbackHandler } from './src/helpers/zoho/zohoAuthCallbackHandler.js';
import { zohoGetAllContactsHandler } from './src/helpers/zoho/zohoGetAllContactsHandler.js';
import successfulPaymentPageHandler from './src/helpers/successfulPaymentPageHandler.js';
import knowledgeBaseRoutes from './src/routes/knowledge-base.js';
import dbConfig from './src/models/index.js';
import googleSheetServices from './src/utils/googlesheets.js';
import { googleAuthSuccessMessage, googleAuthFailureMessage } from './src/constants/constantMessages.js';
import { verifyWebhook } from './src/helpers/whatsapp/verifyWebHook.js';
import { syncServicesMicrosoftHandler } from './src/utils/syncServicesMicrosoftHandler.js';
import logger from './src/logger/logger.js';

const app = express();
const PORT = process.env.PORT || 3000;
logger.info('Starting WhatsApp AI Integration Application', {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: PORT,
  timestamp: new Date().toISOString()
});
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
app.use('/api', knowledgeBaseRoutes); // RAG knowledge base routes

// WhatsApp Webhook
app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhook);

// Google OAuth Routes
app.get('/auth', (req, res) => {
  logger.info('Google OAuth authentication initiated', {
    requestId: req.requestId,
    ip: req.ip
  });
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
  logger.info('Google OAuth callback received', {
    requestId: req.requestId,
    hasCode: !!code
  });
  const { code } = req.query;

  try {
    // Exchange authorization code for tokens
    const tokenStartTime = Date.now();
    const { tokens } = await oauth2Client.getToken(code);
    const tokenDuration = Date.now() - tokenStartTime;
    logger.info('OAuth tokens retrieved', {
      requestId: req.requestId,
      duration: tokenDuration,
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token
    });
    oauth2Client.setCredentials(tokens);

    // Fetch user info from Google
    const userInfoStartTime = Date.now();
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const userInfo = await userInfoRes.json();
    const userInfoDuration = Date.now() - userInfoStartTime;
    logger.info('Google user info retrieved', {
      requestId: req.requestId,
      duration: userInfoDuration,
      email: userInfo.email ? `${userInfo.email.substring(0, 3)}***` : 'none'
    });
    // Find or create employee (Sequelize)
    let employee = await dbConfig.db.Employee.findOne({
      where: { email: userInfo.email }
    });

    if (employee) {
      employee.name = userInfo.name;
      employee.email = userInfo.email;
      if (tokens.refresh_token) {
        employee.refreshToken = tokens.refresh_token;
      }

      await employee.save();
      logger.info('Employee record updated', {
        requestId: req.requestId,
        employeeId: employee.id,
        email: `${userInfo.email.substring(0, 3)}***`,
        hasNewRefreshToken: !!tokens.refresh_token
      });
      console.log('✅ Employee updated:', userInfo.email);
    } else {
      // Create new employee
      employee = await dbConfig.db.Employee.create({
        name: userInfo.name,
        email: userInfo.email,
        refreshToken: tokens.refresh_token || null
      });
      logger.info('New employee record created', {
        requestId: req.requestId,
        employeeId: employee.id,
        email: `${userInfo.email.substring(0, 3)}***`
      });
      console.log('✅ New employee created =============>:', userInfo);
    }

    // Success page
    res.send(googleAuthSuccessMessage(userInfo));
  } catch (err) {
    logger.error('Google OAuth callback error', {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack
    });
    console.error('❌ OAuth error:', err);
    res.status(500).send(googleAuthFailureMessage);
  }
});

// Zoho OAuth Routes
app.get('/auth/zoho', zohoAuthenticationRedirect);
app.get('/zoho/oauth/callback', zohoAuthCallbackHandler);
app.get('/api/zoho/contacts', zohoGetAllContactsHandler);
// Employee Routes
app.get('/employees', async (req, res) => {
  logger.info('Fetching all employees', {
    requestId: req.requestId
  });
  try {
    const employees = await dbConfig.db.Employee.findAll({
      attributes: ['id', 'name', 'email', 'createdAt'],
      order: [['createdAt', 'DESC']]
    });
    logger.info('Employees retrieved successfully', {
      requestId: req.requestId,
      count: employees.length
    });
    res.json({
      success: true,
      count: employees.length,
      employees
    });
  } catch (error) {
    logger.error('Error fetching employees', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Error fetching employees:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employees',
      error: error.message
    });
  }
});

app.post('/webhook/flutterwave', express.json(), paymentWebhookHandler);
app.get('/payment-success', successfulPaymentPageHandler);
app.post('/calendar-data', calendarDataHandler);

// Google Sheets Sync
app.post('/api/sync-services', syncServicesHandler);
app.post('/api/webhook/sheets-sync', googleSheetsWebhookHandler);
app.get('/api/sync-services/microsoft', async (req, res) => {
  logger.info('Microsoft services sync initiated', {
    requestId: req.requestId
  });
  try {
    const syncStartTime = Date.now();
    const services = await syncServicesMicrosoftHandler();
    const syncDuration = Date.now() - syncStartTime;
    logger.info('Microsoft services synced', {
      requestId: req.requestId,
      duration: syncDuration,
      servicesCount: services?.length || 0
    });
    let content = await dbConfig.db.Content.findOne()
    if (content) {
      content.services = services;
      content.updatedAt = new Date();
      await content.save();
      logger.info('Content updated with Microsoft services', {
        requestId: req.requestId,
        contentId: content.id
      });
    } else {
      content = await dbConfig.db.Content.create({
        services,
        updatedAt: new Date()
      });
      logger.info('New content created with Microsoft services', {
        requestId: req.requestId,
        contentId: content.id
      });
    }
    res.json({
      success: true,
      services: content.services
    });
  } catch (error) {
    logger.error('Microsoft services sync failed', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack
    });

    res.status(500).json({
      success: false,
      message: 'Failed to sync services from Microsoft',
      error: error.message
    });
  }
});
// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await dbConfig.db.sequelize.authenticate();
    logger.info('Health check passed', {
      requestId: req.requestId,
      database: 'connected'
    });
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Health check failed', {
      requestId: req.requestId,
      database: 'disconnected',
      error: error.message
    });
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
  logger.warn('Route not found', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    requestId: req.requestId,
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });
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
    logger.info('Initializing database connection');
    await dbConfig.syncDatabase({ alter: false });
    logger.info('Database synced successfully');

    logger.info('Initializing services from Google Sheets');
    await googleSheetServices.initializeServices();
    logger.info('Services initialized successfully');

    // Start server
    app.listen(PORT, () => {
      logger.info('Server started successfully', {
        port: PORT,
        nodeEnv: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
      });
      console.log(`🚀❤️‍🔥 Server running on port ${PORT}`);
    });

  } catch (error) {
    logger.error('Server initialization failed', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Server initialization failed:', error.message);
    console.error(error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('SIGINT received, initiating graceful shutdown');
  console.log('\n🛑 Shutting down gracefully...');

  try {
    await dbConfig.db.sequelize.close();
    logger.info('Database connections closed successfully');
    console.log('✅ Database connections closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, initiating graceful shutdown');
  console.log('\n🛑 SIGTERM received, shutting down...');

  try {
    await dbConfig.db.sequelize.close();
    logger.info('Database connections closed successfully');
    console.log('✅ Database connections closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

export default app;

