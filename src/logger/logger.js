import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.join(__dirname, '..', 'logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format to sanitize sensitive data
const sanitizeData = winston.format((info) => {
  const sanitized = { ...info };

  if (sanitized.refreshToken) sanitized.refreshToken = '***REDACTED***';
  if (sanitized.access_token) sanitized.access_token = '***REDACTED***';
  if (sanitized.apiKey) sanitized.apiKey = '***REDACTED***';
  if (sanitized.password) sanitized.password = '***REDACTED***';
  if (sanitized.GEMINI_API_KEY) sanitized.GEMINI_API_KEY = '***REDACTED***';
  if (sanitized.FLW_SECRET_KEY) sanitized.FLW_SECRET_KEY = '***REDACTED***';

  if (sanitized.email && typeof sanitized.email === 'string') {
    const [user, domain] = sanitized.email.split('@');
    if (user && domain) {
      sanitized.email = `${user.substring(0, 2)}***@${domain}`;
    }
  }

  if (sanitized.phone || sanitized.phoneNumber) {
    const phone = sanitized.phone || sanitized.phoneNumber;
    if (typeof phone === 'string' && phone.length > 4) {
      const masked = `***${phone.slice(-4)}`;
      sanitized.phone = masked;
      if (sanitized.phoneNumber) sanitized.phoneNumber = masked;
    }
  }

  if (sanitized.meta && typeof sanitized.meta === 'object') {
    if (sanitized.meta.booking_details) {
      try {
        const booking =
          typeof sanitized.meta.booking_details === 'string'
            ? JSON.parse(sanitized.meta.booking_details)
            : sanitized.meta.booking_details;

        if (booking.email) {
          const [user, domain] = booking.email.split('@');
          booking.email = `${user.substring(0, 2)}***@${domain}`;
        }

        sanitized.meta.booking_details = JSON.stringify(booking);
      } catch {
        // silently fail – logging must never crash the app
      }
    }
  }

  return sanitized;
});

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(
    ({ timestamp, level, message, requestId, service, category, ...meta }) => {
      let log = `${timestamp} [${level}]`;

      if (requestId) log += ` [${requestId}]`;
      if (category) log += ` [${category}]`;
      if (service && service !== 'whatsapp-ai-bot') log += ` [${service}]`;
      log += `: ${message}`;

      const metaKeys = Object.keys(meta).filter(
        (key) =>
          !['timestamp', 'level', 'message', 'requestId', 'service', 'category', 'environment'].includes(
            key
          )
      );

      if (metaKeys.length > 0) {
        log += `\n${JSON.stringify(meta, null, 2)}`;
      }

      return log;
    }
  )
);

const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  sanitizeData(),
  winston.format.json()
);

// Custom filter format - only logs matching a specific category
const categoryFilter = (category) => winston.format((info) => {
  return info.category === category ? info : false;
})();

// Multiple categories filter
const multipleCategoriesFilter = (...categories) => winston.format((info) => {
  return categories.includes(info.category) ? info : false;
})();

// Create the logger
const logger = winston.createLogger({
  level:
    process.env.LOG_LEVEL ||
    (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

  defaultMeta: {
    service: 'whatsapp-ai-bot',
    environment: process.env.NODE_ENV || 'development',
  },

  transports: [
    // Error log - all errors regardless of category
    new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      format: jsonFormat,
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),

    // Combined log - everything (general application logs without specific categories)
    new DailyRotateFile({
      filename: path.join(logsDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      format: jsonFormat,
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),

    // WhatsApp-specific logs only
    new DailyRotateFile({
      filename: path.join(logsDir, 'whatsapp-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      format: winston.format.combine(categoryFilter('whatsapp'), jsonFormat),
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),

    // Payment logs only
    new DailyRotateFile({
      filename: path.join(logsDir, 'payments-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      format: winston.format.combine(categoryFilter('payment'), jsonFormat),
      maxSize: '10m',
      maxFiles: '30d',
      zippedArchive: true,
    }),

    // API calls logs only (Gemini and other API calls)
    new DailyRotateFile({
      filename: path.join(logsDir, 'api-calls-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      format: winston.format.combine(
        multipleCategoriesFilter('api-call', 'gemini'),
        jsonFormat
      ),
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),
  ],

  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '14d',
      zippedArchive: true,
    }),
  ],

  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(logsDir, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '14d',
      zippedArchive: true,
    }),
  ],
});

// Console logging in non-production
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// Helper methods with category tagging
logger.whatsapp = (level, message, data = {}) => {
  logger.log(level, message, {
    ...data,
    category: 'whatsapp',
  });
};

logger.payment = (level, message, data = {}) => {
  logger.log(level, message, {
    ...data,
    category: 'payment',
  });
};

logger.apiCall = (level, message, data = {}) => {
  logger.log(level, message, {
    ...data,
    category: 'api-call',
  });
};

logger.gemini = (level, message, data = {}) => {
  logger.log(level, message, {
    ...data,
    category: 'gemini',
    service: 'gemini-ai',
  });
};

export default logger;