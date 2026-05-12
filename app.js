import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import bookMeetingHandler from './src/controllers/bookMeeting.js';
import oauth2Client from './src/utils/auth.js';
import { handleWebhook } from './src/controllers/whatsappController.js';
import adminRoutes from './src/routes/admin.js';
import monitoringRoutes from './src/routes/monitoring.js';
import authRoutes from './src/routes/auth.js';
import { authenticate, requireAdmin, setRLSContext } from './src/middlewares/auth.js';
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
import { connectRedis, disconnectRedis } from './src/utils/redis.js';

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

// Public API routes
app.post('/api/chat/book', bookMeetingHandler);
app.use('/api/auth', authRoutes);
app.post('/api/webhook/sheets-sync', googleSheetsWebhookHandler); // Google Sheets push (no auth)

// Auth-protected routes — setRLSContext runs after authenticate to wire per-request
// PostgreSQL session variables that RLS policies read.
app.use('/api/outreach/monitoring', authenticate, setRLSContext, requireAdmin, monitoringRoutes);
app.use('/api/outreach', authenticate, setRLSContext, adminRoutes);
app.use('/api', authenticate, setRLSContext, knowledgeBaseRoutes);

// WhatsApp Webhook
app.get('/webhook', verifyWebhook);
app.post('/webhook', handleWebhook);

// Google OAuth Routes
app.get('/auth', (req, res) => {
  logger.info('Google OAuth authentication initiated', {
    requestId: req.requestId,
    ip: req.ip
  });
  // Pass clientId through OAuth state — UUID is URL-safe so no encoding needed
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
    state: req.query.clientId || ''
  });
  res.redirect(url);
});

app.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  const clientId = (state && state.length > 0) ? state : null;

  if (!clientId) {
    logger.warn('Google OAuth callback missing clientId — rejecting', { requestId: req.requestId });
    return res.status(400).send('Missing clientId. Initiate OAuth via /auth?clientId=<uuid>');
  }

  logger.info('Google OAuth callback received', {
    requestId: req.requestId,
    hasCode: !!code
  });

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
    // Find or create employee — scoped to this client when clientId is present
    const employeeWhere = clientId
      ? { clientId, email: userInfo.email }
      : { email: userInfo.email };

    let employee = await dbConfig.db.Employee.findOne({ where: employeeWhere });

    if (employee) {
      employee.name = userInfo.name;
      if (tokens.refresh_token) employee.refreshToken = tokens.refresh_token;
      if (clientId && !employee.clientId) employee.clientId = clientId;
      await employee.save();
      logger.info('Employee record updated', {
        requestId: req.requestId,
        employeeId: employee.id,
        clientId,
        email: `${userInfo.email.substring(0, 3)}***`,
        hasNewRefreshToken: !!tokens.refresh_token
      });
    } else {
      employee = await dbConfig.db.Employee.create({
        name:         userInfo.name,
        email:        userInfo.email,
        clientId,
        refreshToken: tokens.refresh_token || null
      });
      logger.info('New employee record created', {
        requestId: req.requestId,
        employeeId: employee.id,
        clientId,
        email: `${userInfo.email.substring(0, 3)}***`
      });
    }

    // Success page
    const locale = req.query.lang || 'en';
    res.send(googleAuthSuccessMessage(userInfo, locale));
  } catch (err) {
    logger.error('Google OAuth callback error', {
      requestId: req.requestId,
      error: err.message,
      stack: err.stack
    });
    const locale = req.query.lang || 'en';
    res.status(500).send(googleAuthFailureMessage(locale));
  }
});

// Zoho OAuth Routes (admin-only — Zoho CRM is a global integration)
app.get('/auth/zoho', zohoAuthenticationRedirect);
app.get('/zoho/oauth/callback', zohoAuthCallbackHandler);
app.get('/api/zoho/contacts', authenticate, setRLSContext, requireAdmin, zohoGetAllContactsHandler);

// Calendar data — requires auth so clientId is always known
app.post('/calendar-data', authenticate, setRLSContext, calendarDataHandler);

app.post('/webhook/flutterwave', express.json(), paymentWebhookHandler);
app.get('/payment-success', successfulPaymentPageHandler);

// Google Sheets legacy sync (protected — admin or authenticated client)
app.post('/api/sync-services', authenticate, syncServicesHandler);
// Legacy redirect for Microsoft sync
app.get('/api/sync-services/microsoft', (req, res) => {
  res.status(301).json({ message: 'Use POST /api/kb/sync/microsoft with { clientId } in body' });
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

    logger.info('Database synced and RLS policies applied successfully');

    await connectRedis();

    // Start server
    app.listen(PORT, () => {
      logger.info('Server started successfully', {
        port: PORT,
        nodeEnv: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
      });
    });

  } catch (error) {
    logger.error('Server initialization failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
})();

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`${signal} received, initiating graceful shutdown`);
  try {
    await Promise.all([
      dbConfig.db.sequelize.close(),
      disconnectRedis(),
    ]);
    logger.info('Database and Redis connections closed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export default app;

