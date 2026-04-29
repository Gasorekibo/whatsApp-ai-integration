/**
 * Standalone Worker Process
 * Run this separately from the main server for horizontal scaling
 *
 * Usage:
 *   node src/workers/worker-process.js
 *   node src/workers/worker-process.js --worker-id=1
 *   node src/workers/worker-process.js --concurrency=10
 */

import dotenv from 'dotenv';
import { initRedis, closeRedis } from '../config/redis.config.js';
import { initQueues, closeQueues } from '../queues/bullmq.config.js';
import { initWorkerManager, getWorkerManager } from './manager.js';
import { initRateLimiter } from '../utils/global-rate-limiter.js';
import { initRetryHandler } from '../utils/gemini-retry-handler.js';
import { initQueueMonitor } from '../services/queue-monitor.service.js';
import logger from '../logger/logger.js';

dotenv.config();

// Parse command line arguments
const args = process.argv.slice(2);
const workerId = args.find(a => a.startsWith('--worker-id='))?.split('=')[1] || Math.random().toString(36).substring(7);
const chatConcurrency = parseInt(args.find(a => a.startsWith('--chat-concurrency='))?.split('=')[1] || process.env.CHAT_WORKER_CONCURRENCY || '5');
const whatsappConcurrency = parseInt(args.find(a => a.startsWith('--whatsapp-concurrency='))?.split('=')[1] || process.env.WHATSAPP_WORKER_CONCURRENCY || '10');

const isStandalone = true; // True if running as separate process

async function startWorkerProcess() {
  try {
    logger.info('=== Starting Standalone Worker Process ===', {
      workerId,
      chatConcurrency,
      whatsappConcurrency,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV
    });

    // Initialize Redis
    await initRedis();
    logger.info('Redis connected');

    // Initialize queues
    await initQueues();
    logger.info('Queues initialized');

    // Initialize rate limiter
    initRateLimiter({
      maxRequestsPerSecond: parseInt(process.env.GEMINI_MAX_RPS || '3'),
      maxBurstSize: parseInt(process.env.GEMINI_MAX_BURST || '5')
    });
    logger.info('Global rate limiter initialized');

    // Initialize retry handler
    initRetryHandler({
      maxRetries: parseInt(process.env.GEMINI_MAX_RETRIES || '5'),
      baseDelay: parseInt(process.env.GEMINI_BASE_DELAY || '1000'),
      maxDelay: parseInt(process.env.GEMINI_MAX_DELAY || '30000')
    });
    logger.info('Retry handler initialized');

    // Start workers
    const workerManager = initWorkerManager({
      chatWorkerConcurrency: chatConcurrency,
      whatsappWorkerConcurrency: whatsappConcurrency
    });

    await workerManager.startAll();
    logger.info('All workers started', {
      chatConcurrency,
      whatsappConcurrency
    });

    // Start monitoring
    initQueueMonitor({
      pollInterval: parseInt(process.env.QUEUE_MONITOR_INTERVAL || '30000')
    });
    logger.info('Queue monitoring started');

    logger.info('=== Worker Process Ready ===', {
      workerId,
      pid: process.pid,
      uptime: '0s'
    });

    // Health check interval
    setInterval(async () => {
      try {
        const stats = await workerManager.getStats();
        logger.info('Worker stats', { workerId, ...stats });
      } catch (error) {
        logger.error('Error getting worker stats', { error: error.message });
      }
    }, 60000); // Every 60 seconds

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received - graceful shutdown', { workerId });
      await gracefulShutdown();
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received - graceful shutdown', { workerId });
      await gracefulShutdown();
    });

    // Uncaught exception handler
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', {
        workerId,
        error: error.message,
        stack: error.stack?.substring(0, 500)
      });
      gracefulShutdown();
    });

    // Unhandled rejection handler
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', {
        workerId,
        reason: String(reason),
        promise: String(promise)
      });
    });
  } catch (error) {
    logger.error('Failed to start worker process', {
      workerId,
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

async function gracefulShutdown() {
  logger.info('Graceful shutdown initiated', { workerId });

  try {
    const workerManager = getWorkerManager();
    if (workerManager) {
      logger.info('Closing workers...', { workerId });
      await workerManager.closeAll();
    }

    logger.info('Closing queues...', { workerId });
    await closeQueues();

    logger.info('Closing Redis...', { workerId });
    await closeRedis();

    logger.info('Worker process shutdown complete', { workerId });
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { workerId, error: error.message });
    process.exit(1);
  }
}

// Start the worker
startWorkerProcess();
