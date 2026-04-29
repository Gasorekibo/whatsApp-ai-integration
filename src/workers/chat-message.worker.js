/**
 * Chat Message Worker
 * Processes messages through the full RAG + Gemini pipeline
 * Handles rate limiting, retries, and error recovery
 */

import { Worker } from 'bullmq';
import { getRedisClient } from '../config/redis.config.js';
import { getRateLimiter } from '../utils/global-rate-limiter.js';
import { getRetryHandler } from '../utils/gemini-retry-handler.js';
import ragService from '../services/rag.service.js';
import embeddingService from '../services/embedding.service.js';
import { processWithGemini } from '../helpers/whatsapp/processWithGemini.js';
import { sendWhatsAppMessage } from '../helpers/whatsapp/sendWhatsappMessage.js';
import { addWhatsAppSenderJob } from '../queues/bullmq.config.js';
import dbConfig from '../models/index.js';
import logger from '../logger/logger.js';

// Fallback response when system is busy
const FALLBACK_RESPONSE = {
  reply: "Sorry, our system is currently busy. Please try again in a few moments.",
  language: 'en',
  showServices: false,
  showSlots: false
};

export class ChatMessageWorker {
  constructor(queueName, options = {}) {
    this.queueName = queueName;
    this.concurrency = options.concurrency || 5; // Max 5 parallel workers
    this.lockDuration = options.lockDuration || 30000; // 30s job lock
    this.worker = null;
  }

  /**
   * Start the worker
   */
  async start() {
    try {
      const redisClient = getRedisClient();

      this.worker = new Worker(this.queueName, this.processJob.bind(this), {
        connection: redisClient,
        concurrency: this.concurrency,
        lockDuration: this.lockDuration,
        maxStalledCount: 2, // Re-run if stalled more than twice
        visibilityWindow: 5000 // Check for stalled jobs every 5s
      });

      // Event handlers
      this.worker.on('completed', (job) => {
        logger.info('Chat job completed', {
          jobId: job.id,
          phoneNumber: job.data.phoneNumber,
          duration: `${Date.now() - job.timestamp}ms`
        });
      });

      this.worker.on('failed', (job, error) => {
        logger.error('Chat job failed', {
          jobId: job.id,
          phoneNumber: job.data.phoneNumber,
          error: error.message,
          attempts: job.attemptsMade
        });
      });

      this.worker.on('error', (error) => {
        logger.error('Worker error', { error: error.message });
      });

      logger.info('Chat message worker started', {
        queue: this.queueName,
        concurrency: this.concurrency
      });
    } catch (error) {
      logger.error('Failed to start chat worker', { error: error.message });
      throw error;
    }
  }

  /**
   * Main job processor
   * This is where the actual chat processing happens
   */
  async processJob(job) {
    const { phoneNumber, message, history, userEmail, clientId, timestamp } = job.data;
    const sanitizedPhone = `***${phoneNumber.slice(-4)}`;

    logger.info('Processing chat job', {
      jobId: job.id,
      phoneNumber: sanitizedPhone,
      clientId,
      messageLength: message.length,
      queueWaitTime: `${Date.now() - timestamp}ms`
    });

    try {
      // Step 1: Acquire rate limit token
      const rateLimiter = getRateLimiter();
      logger.debug('Waiting for rate limit token', { phoneNumber: sanitizedPhone });
      await rateLimiter.waitForToken('gemini-main', 30000);

      // Step 2: Fetch client configuration
      const clientConfig = clientId
        ? await dbConfig.db.Client.findByPk(clientId).then(c => ({
            clientId: c?.id,
            companyName: c?.name,
            timezone: c?.timezone || 'Africa/Kigali',
            geminiApiKey: c?.getDecryptedGeminiKey?.(),
            paymentRedirectUrl: process.env.PAYMENT_REDIRECT_URL,
            depositAmount: process.env.DEPOSIT_AMOUNT || 5000,
            currency: process.env.CURRENCY || 'RWF'
          }))
        : {};

      // Step 3: Process message with full RAG pipeline
      const retryHandler = getRetryHandler();
      const response = await retryHandler.executeWithTimeout(
        () => processWithGemini(phoneNumber, message, history || [], userEmail, null, clientConfig),
        'chat-processing'
      );

      logger.info('Chat response generated', {
        jobId: job.id,
        phoneNumber: sanitizedPhone,
        hasResponse: !!response?.reply,
        language: response?.language
      });

      // Step 4: Store result in Redis for tracking
      const resultKey = `chat-result:${job.id}`;
      const redisClient = getRedisClient();
      await redisClient.setEx(
        resultKey,
        86400, // 24 hour TTL
        JSON.stringify({
          jobId: job.id,
          phoneNumber,
          response,
          timestamp: new Date().toISOString()
        })
      );

      // Step 5: Queue WhatsApp message sending (asynchronous, reliable retry)
      await addWhatsAppSenderJob({
        phoneNumber,
        message: response?.reply || FALLBACK_RESPONSE.reply,
        language: response?.language || 'en',
        jobId: job.id,
        clientId
      });

      return {
        success: true,
        jobId: job.id,
        message: 'Message processed and queued for sending',
        response
      };
    } catch (error) {
      logger.error('Chat job processing failed', {
        jobId: job.id,
        phoneNumber: sanitizedPhone,
        error: error.message,
        stack: error.stack?.substring(0, 500)
      });

      // Queue fallback response
      try {
        await addWhatsAppSenderJob({
          phoneNumber,
          message: FALLBACK_RESPONSE.reply,
          language: 'en',
          jobId: job.id,
          clientId,
          isFallback: true
        });
      } catch (fallbackError) {
        logger.error('Failed to queue fallback response', { error: fallbackError.message });
      }

      throw error; // Re-throw so BullMQ retries
    }
  }

  /**
   * Close the worker
   */
  async close() {
    if (this.worker) {
      await this.worker.close();
      logger.info('Chat message worker closed');
    }
  }

  /**
   * Get worker stats
   */
  async getStats() {
    if (!this.worker) return null;

    const counts = await this.worker.getCountsPerState();
    return {
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      delayed: counts.delayed,
      waiting: counts.waiting
    };
  }
}

export default ChatMessageWorker;
