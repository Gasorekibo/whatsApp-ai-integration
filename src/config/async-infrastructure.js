/**
 * Application Initialization with Queue Infrastructure
 * Initialize Redis, BullMQ, Workers, Rate Limiter, and Monitoring
 */

import express from 'express';
import { initRedis, closeRedis } from './redis.config.js';
import { initQueues, closeQueues } from '../queues/bullmq.config.js';
import { initWorkerManager, getWorkerManager } from '../workers/manager.js';
import { initRateLimiter } from '../utils/global-rate-limiter.js';
import { initRetryHandler } from '../utils/gemini-retry-handler.js';
import { initQueueMonitor } from '../services/queue-monitor.service.js';
import logger from '../logger/logger.js';

/**
 * Initialize all async infrastructure
 * Call this on server startup
 */
export async function initializeAsyncInfrastructure() {
  try {
    logger.info('=== Initializing Async Infrastructure ===');

    // 1. Initialize Redis
    logger.info('Step 1: Initializing Redis...');
    await initRedis();

    // 2. Initialize BullMQ queues
    logger.info('Step 2: Initializing BullMQ queues...');
    await initQueues();

    // 3. Initialize global rate limiter
    logger.info('Step 3: Initializing global rate limiter...');
    initRateLimiter({
      maxRequestsPerSecond: parseInt(process.env.GEMINI_MAX_RPS || '3'),
      maxBurstSize: parseInt(process.env.GEMINI_MAX_BURST || '5')
    });

    // 4. Initialize retry handler
    logger.info('Step 4: Initializing retry handler...');
    initRetryHandler({
      maxRetries: parseInt(process.env.GEMINI_MAX_RETRIES || '5'),
      baseDelay: parseInt(process.env.GEMINI_BASE_DELAY || '1000'),
      maxDelay: parseInt(process.env.GEMINI_MAX_DELAY || '30000')
    });

    // 5. Start worker processes
    logger.info('Step 5: Starting worker processes...');
    const workerManager = initWorkerManager({
      chatWorkerConcurrency: parseInt(process.env.CHAT_WORKER_CONCURRENCY || '5'),
      whatsappWorkerConcurrency: parseInt(process.env.WHATSAPP_WORKER_CONCURRENCY || '10')
    });
    await workerManager.startAll();

    // 6. Start queue monitoring
    logger.info('Step 6: Starting queue monitoring...');
    initQueueMonitor({
      pollInterval: parseInt(process.env.QUEUE_MONITOR_INTERVAL || '30000')
    });

    logger.info('=== Async Infrastructure Initialized Successfully ===');
    return true;
  } catch (error) {
    logger.error('Failed to initialize async infrastructure', {
      error: error.message,
      stack: error.stack?.substring(0, 500)
    });
    throw error;
  }
}

/**
 * Graceful shutdown
 */
export async function shutdownAsyncInfrastructure() {
  try {
    logger.info('=== Shutting down async infrastructure ===');

    const workerManager = getWorkerManager();
    if (workerManager) {
      await workerManager.closeAll();
    }

    await closeQueues();
    await closeRedis();

    logger.info('=== Async infrastructure shut down successfully ===');
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
  }
}

/**
 * Health check endpoint
 * Returns status of queues, workers, and Redis
 */
export async function getSystemHealth() {
  try {
    const workerManager = getWorkerManager();
    const workerStats = await workerManager.getStats();

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      workers: workerStats,
      infrastructure: {
        redis: 'connected',
        queues: 'operational',
        rateLimiter: 'active'
      }
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

export default {
  initializeAsyncInfrastructure,
  shutdownAsyncInfrastructure,
  getSystemHealth
};
