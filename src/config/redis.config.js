/**
 * Redis Configuration
 * Centralized Redis connection setup for queue, caching, and rate limiting
 */

import redis from 'redis';
import logger from '../logger/logger.js';

let redisClient = null;

export async function initRedis() {
  if (redisClient) return redisClient;

  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 500),
        connectTimeout: 5000 // 5 second timeout
      }
    });

    // Don't log every error - it floods the logs
    redisClient.on('error', () => {
      // Silently fail - handled by timeout
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    // Add timeout for connection
    const connectionPromise = redisClient.connect();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Redis connection timeout')), 3000)
    );

    await Promise.race([connectionPromise, timeoutPromise]);
    return redisClient;
  } catch (error) {
    logger.warn('Redis initialization skipped - continuing without Redis', { error: error.message });
    redisClient = null;
    // Don't throw - allow app to continue without Redis for local dev
    return null;
  }
}

export function getRedisClient() {
  if (!redisClient) {
    return null; // Return null instead of throwing for dev mode
  }
  return redisClient;
}

export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis connection closed');
  }
}

export default { initRedis, getRedisClient, closeRedis };
