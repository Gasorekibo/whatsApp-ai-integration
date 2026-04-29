/**
 * Gemini API Retry Handler
 * Implements robust retry logic with exponential backoff + jitter
 * Handles 503, 429, and transient errors gracefully
 */

import logger from '../logger/logger.js';

export class GeminiRetryHandler {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 5;
    this.baseDelay = options.baseDelay || 1000; // 1s
    this.maxDelay = options.maxDelay || 30000; // 30s
    this.jitterFactor = options.jitterFactor || 0.1; // 10% jitter
    this.timeoutMs = options.timeoutMs || 60000; // 60s total timeout
  }

  /**
   * Determine if error is retryable
   */
  isRetryableError(error) {
    const status = error.status || error.statusCode;
    const message = error.message || '';

    // Retryable status codes
    if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504) {
      return true;
    }

    // Retryable error messages
    const retryableMessages = [
      'high demand',
      'overloaded',
      'quota',
      'temporarily unavailable',
      'connection reset',
      'ECONNRESET',
      'ETIMEDOUT',
      'ERR_HTTP2_STREAM_DESTROYED'
    ];

    return retryableMessages.some(msg => message.toLowerCase().includes(msg));
  }

  /**
   * Calculate delay with exponential backoff + jitter
   */
  calculateDelay(attempt) {
    const exponentialDelay = this.baseDelay * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, this.maxDelay);
    const jitter = cappedDelay * this.jitterFactor * Math.random();
    return cappedDelay + jitter;
  }

  /**
   * Execute function with retries
   * @param {Function} fn - Async function to retry
   * @param {string} label - Label for logging
   * @returns {Promise} - Result of successful execution
   */
  async execute(fn, label = 'gemini-call') {
    let lastError = null;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable) {
          // Non-retryable error (e.g., 400, 401, 404)
          logger.error(`${label} failed (non-retryable)`, {
            status: error.status,
            message: error.message?.substring(0, 100),
            attempt: attempt + 1
          });
          throw error;
        }

        if (attempt >= this.maxRetries) {
          // Max retries exceeded
          logger.error(`${label} failed after ${this.maxRetries} retries`, {
            status: error.status,
            totalDuration: `${Date.now() - startTime}ms`
          });
          throw error;
        }

        // Calculate wait time
        const delay = this.calculateDelay(attempt);
        const totalElapsed = Date.now() - startTime;

        if (totalElapsed + delay > this.timeoutMs) {
          logger.error(`${label} exceeded total timeout`, {
            totalElapsed: `${totalElapsed}ms`,
            maxTimeout: `${this.timeoutMs}ms`
          });
          throw lastError;
        }

        logger.warn(`${label} retrying (${attempt + 1}/${this.maxRetries})`, {
          status: error.status,
          delay: `${Math.round(delay)}ms`,
          totalElapsed: `${totalElapsed}ms`
        });

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Execute with timeout wrapper
   */
  async executeWithTimeout(fn, label = 'gemini-call') {
    return Promise.race([
      this.execute(fn, label),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout after ${this.timeoutMs}ms`)), this.timeoutMs)
      )
    ]);
  }
}

// Singleton instance
let retryHandler = null;

export function initRetryHandler(options = {}) {
  retryHandler = new GeminiRetryHandler(options);
  logger.info('Gemini retry handler initialized', {
    maxRetries: retryHandler.maxRetries,
    baseDelay: `${retryHandler.baseDelay}ms`,
    maxDelay: `${retryHandler.maxDelay}ms`
  });
  return retryHandler;
}

export function getRetryHandler() {
  if (!retryHandler) {
    retryHandler = new GeminiRetryHandler();
  }
  return retryHandler;
}

export default { GeminiRetryHandler, initRetryHandler, getRetryHandler };
