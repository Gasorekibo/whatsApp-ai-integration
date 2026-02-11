import logger from '../utils/logger.js';
import  { v4 as uuidv4 } from 'uuid';

const requestLogger = (req, res, next) => {
  const requestId = uuidv4();
  req.requestId = requestId;
  
  const startTime = Date.now();
  logger.info('Incoming HTTP request', {
    requestId,
    method: req.method,
    path: req.path,
    url: req.url,
    query: req.query,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent'),
    contentType: req.get('content-type'),
    // Log body for specific endpoints (avoid logging sensitive webhook data)
    body: shouldLogBody(req.path) ? sanitizeBody(req.body) : '[body not logged]',
    headers: sanitizeHeaders(req.headers)
  });
  
  // Capture original response methods
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  
  // Override res.json to log response
  res.json = function(body) {
    logResponse(body);
    return originalJson(body);
  };
  
  // Override res.send to log response
  res.send = function(body) {
    logResponse(body);
    return originalSend(body);
  };
  
  // Log response details
  function logResponse(body) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    
    const logLevel = statusCode >= 500 ? 'error' 
                   : statusCode >= 400 ? 'warn' 
                   : 'info';
    
    logger.log(logLevel, 'Outgoing HTTP response', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode,
      duration,
      responseSize: typeof body === 'string' ? body.length : JSON.stringify(body).length,
      // Only log response body for errors or specific paths
      response: shouldLogResponseBody(req.path, statusCode) ? sanitizeBody(body) : '[response not logged]'
    });
  }
  
  // Log on response finish (fallback for redirects, etc.)
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    if (res.statusCode >= 400 && !res.headersSent) {
      logger.warn('Request completed with error status', {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration
      });
    }
  });
  
  next();
};

/**
 * Determine if request body should be logged
 */
function shouldLogBody(path) {
  // Don't log body for webhook endpoints (too large and may contain sensitive data)
  const skipPaths = ['/webhook', '/webhook/flutterwave'];
  return !skipPaths.some(p => path.startsWith(p));
}

/**
 * Determine if response body should be logged
 */
function shouldLogResponseBody(path, statusCode) {
  // Log errors and specific endpoints
  if (statusCode >= 400) return true;
  
  const logPaths = ['/api/chat/book', '/auth', '/employees'];
  return logPaths.some(p => path.startsWith(p));
}

/**
 * Sanitize request/response body to remove sensitive data
 */
function sanitizeBody(body) {
  if (!body) return body;
  
  const sanitized = typeof body === 'string' ? body : JSON.parse(JSON.stringify(body));
  
  if (typeof sanitized === 'object') {
    // Remove sensitive fields
    const sensitiveFields = [
      'password', 'token', 'refreshToken', 'access_token', 
      'apiKey', 'secret', 'GEMINI_API_KEY', 'FLW_SECRET_KEY'
    ];
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '***REDACTED***';
      }
    });
    
    // Partially mask email
    if (sanitized.email && typeof sanitized.email === 'string') {
      const [user, domain] = sanitized.email.split('@');
      if (user && domain) {
        sanitized.email = `${user.substring(0, 2)}***@${domain}`;
      }
    }
    
    // Mask phone numbers
    if (sanitized.phone && typeof sanitized.phone === 'string') {
      sanitized.phone = `***${sanitized.phone.slice(-4)}`;
    }
  }
  
  return sanitized;
}

/**
 * Sanitize headers to remove sensitive authorization tokens
 */
function sanitizeHeaders(headers) {
  const sanitized = { ...headers };
  
  if (sanitized.authorization) {
    sanitized.authorization = '***REDACTED***';
  }
  
  if (sanitized.cookie) {
    sanitized.cookie = '***REDACTED***';
  }
  
  return sanitized;
}

export default requestLogger;