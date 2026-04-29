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
        reconnectStrategy: (retries) => Math.min(retries * 50, 500)
      }
    });

    redisClient.on('error', (err) => {
      logger.error('Redis connection error', { error: err.message });
    });

    redisClient.on('connect', () => {
      logger.info('Redis connected successfully');
    });

    await redisClient.connect();
    return redisClient;
  } catch (error) {
    logger.error('Failed to initialize Redis', { error: error.message });
    throw error;
  }
}

export function getRedisClient() {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initRedis() first.');
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
