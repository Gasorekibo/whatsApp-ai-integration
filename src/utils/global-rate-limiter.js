/**
 * Global Rate Limiter for Gemini API
 * Ensures all worker processes respect global rate limits
 * Uses Redis for distributed state across multiple processes
 */

import { getRedisClient } from '../config/redis.config.js';
import logger from '../logger/logger.js';

export class GlobalGeminiRateLimiter {
  constructor(options = {}) {
    this.maxRequestsPerSecond = options.maxRequestsPerSecond || 3; // Conservative: 3 req/sec
    this.maxBurstSize = options.maxBurstSize || 5; // Allow small bursts
    this.windowSize = 1000; // 1 second window in ms
    this.keyPrefix = 'gemini-ratelimit:';
  }

  /**
   * Check if request is allowed and acquire token
   * Uses token bucket algorithm with Redis
   * @returns {Promise<{allowed: boolean, waitTime: number}>}
   */
  async acquire(label = 'default') {
    try {
      const redisClient = getRedisClient();
      const key = `${this.keyPrefix}${label}`;
      const now = Date.now();

      // Use Redis EVAL for atomic operation
      const script = `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local window_size = tonumber(ARGV[2])
        local max_requests = tonumber(ARGV[3])
        local max_burst = tonumber(ARGV[4])

        -- Get current window data [timestamp, count]
        local data = redis.call('GET', key)
        local window_start, count

        if not data then
          window_start = now
          count = 0
        else
          window_start, count = data:match('([^,]+),([^,]+)')
          window_start = tonumber(window_start)
          count = tonumber(count)
        end

        -- Reset if outside window
        if now - window_start >= window_size then
          window_start = now
          count = 0
        end

        -- Check if we can issue token
        local allowed = count < max_requests or count < max_burst

        if allowed then
          count = count + 1
          redis.call('SETEX', key, 2, window_start .. ',' .. count)
          return {1, 0}  -- {allowed, waitTime}
        else
          local wait_time = (window_start + window_size) - now
          return {0, wait_time}
        end
      `;

      const result = await redisClient.eval(
        script,
        { keys: [key], arguments: [now.toString(), this.windowSize.toString(), this.maxRequestsPerSecond.toString(), this.maxBurstSize.toString()] }
      );

      const allowed = result[0] === 1;
      const waitTime = result[1];

      if (!allowed) {
        logger.warn('Gemini rate limit exceeded', {
          label,
          waitTime: `${waitTime}ms`,
          limit: `${this.maxRequestsPerSecond}/sec`
        });
      }

      return { allowed, waitTime: waitTime || 0 };
    } catch (error) {
      logger.error('Rate limiter error', { error: error.message });
      // Fail open: if Redis fails, allow request
      return { allowed: true, waitTime: 0 };
    }
  }

  /**
   * Wait until request is allowed
   */
  async waitForToken(label = 'default', maxWaitTime = 30000) {
    const startTime = Date.now();

    while (true) {
      const { allowed, waitTime } = await this.acquire(label);

      if (allowed) {
        return;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed + waitTime > maxWaitTime) {
        throw new Error(`Rate limit wait exceeded ${maxWaitTime}ms`);
      }

      // Wait for the calculated time + small jitter
      const jitter = Math.random() * 100;
      await new Promise(resolve => setTimeout(resolve, Math.min(waitTime + jitter, 1000)));
    }
  }

  /**
   * Get current rate limit stats
   */
  async getStats(label = 'default') {
    try {
      const redisClient = getRedisClient();
      const key = `${this.keyPrefix}${label}`;
      const data = await redisClient.get(key);

      if (!data) {
        return { requests: 0, window: 0, limit: this.maxRequestsPerSecond };
      }

      const [windowStart, count] = data.split(',').map(Number);
      const windowRemaining = Math.max(0, this.windowSize - (Date.now() - windowStart));

      return {
        requests: count,
        limit: this.maxRequestsPerSecond,
        windowRemaining,
        allowNextRequest: count < this.maxRequestsPerSecond
      };
    } catch (error) {
      logger.error('Failed to get rate limiter stats', { error: error.message });
      return null;
    }
  }
}

// Singleton instance
let limiter = null;

export function initRateLimiter(options = {}) {
  limiter = new GlobalGeminiRateLimiter(options);
  logger.info('Global Gemini rate limiter initialized', {
    maxRequestsPerSecond: limiter.maxRequestsPerSecond,
    maxBurstSize: limiter.maxBurstSize
  });
  return limiter;
}

export function getRateLimiter() {
  if (!limiter) {
    throw new Error('Rate limiter not initialized. Call initRateLimiter() first.');
  }
  return limiter;
}

export default { GlobalGeminiRateLimiter, initRateLimiter, getRateLimiter };
