/**
 * WhatsApp Sender Worker
 * Handles reliable message delivery with idempotency
 * Ensures messages are not duplicated even if job is retried
 */

import { Worker } from 'bullmq';
import { getRedisClient } from '../config/redis.config.js';
import { sendWhatsAppMessage } from '../helpers/whatsapp/sendWhatsappMessage.js';
import logger from '../logger/logger.js';

export class WhatsAppSenderWorker {
  constructor(queueName, options = {}) {
    this.queueName = queueName;
    this.concurrency = options.concurrency || 10; // Higher concurrency for sending
    this.lockDuration = options.lockDuration || 60000; // 60s per message
    this.worker = null;
    this.idempotencyKeyPrefix = 'whatsapp-sent:';
    this.deliveryTrackingPrefix = 'whatsapp-delivery:';
  }

  /**
   * Start the worker
   */
  async start() {
    try {
      const redisClient = getRedisClient();

      this.worker = new Worker(this.queueName, this.sendMessage.bind(this), {
        connection: redisClient,
        concurrency: this.concurrency,
        lockDuration: this.lockDuration,
        maxStalledCount: 3,
        visibilityWindow: 10000
      });

      this.worker.on('completed', (job) => {
        logger.info('WhatsApp message sent', {
          jobId: job.id,
          phoneNumber: job.data.phoneNumber
        });
      });

      this.worker.on('failed', (job, error) => {
        logger.error('WhatsApp send failed', {
          jobId: job.id,
          phoneNumber: job.data.phoneNumber,
          error: error.message,
          attempts: job.attemptsMade
        });
      });

      logger.info('WhatsApp sender worker started', {
        queue: this.queueName,
        concurrency: this.concurrency
      });
    } catch (error) {
      logger.error('Failed to start WhatsApp sender worker', { error: error.message });
      throw error;
    }
  }

  /**
   * Send message with idempotency guarantee
   */
  async sendMessage(job) {
    const { phoneNumber, message, language, jobId, clientId, isFallback } = job.data;
    const sanitizedPhone = `***${phoneNumber.slice(-4)}`;
    const idempotencyKey = `${this.idempotencyKeyPrefix}${jobId}:${phoneNumber}`;

    logger.info('Processing WhatsApp send job', {
      jobId: job.id,
      phoneNumber: sanitizedPhone,
      originalJobId: jobId,
      isFallback: !!isFallback
    });

    try {
      const redisClient = getRedisClient();

      // Check if already sent (idempotency check)
      const alreadySent = await redisClient.get(idempotencyKey);
      if (alreadySent) {
        logger.info('Message already sent (idempotent)', {
          jobId: job.id,
          phoneNumber: sanitizedPhone,
          sentAt: alreadySent
        });
        return {
          success: true,
          idempotent: true,
          message: 'Message already delivered'
        };
      }

      // Send message via WhatsApp
      const result = await sendWhatsAppMessage(phoneNumber, message);

      // Mark as sent
      const sentTimestamp = new Date().toISOString();
      await redisClient.setEx(
        idempotencyKey,
        86400 * 7, // 7-day TTL for idempotency tracking
        sentTimestamp
      );

      // Store delivery metadata for tracking
      const deliveryKey = `${this.deliveryTrackingPrefix}${jobId}`;
      await redisClient.setEx(
        deliveryKey,
        86400 * 30, // 30 days for analytics
        JSON.stringify({
          jobId,
          phoneNumber,
          messageLength: message.length,
          language,
          sentAt: sentTimestamp,
          isFallback: !!isFallback,
          clientId
        })
      );

      logger.info('WhatsApp message sent successfully', {
        jobId: job.id,
        phoneNumber: sanitizedPhone,
        result
      });

      return {
        success: true,
        idempotent: false,
        sentAt: sentTimestamp,
        result
      };
    } catch (error) {
      logger.error('Failed to send WhatsApp message', {
        jobId: job.id,
        phoneNumber: sanitizedPhone,
        error: error.message,
        attempts: job.attemptsMade
      });

      // After max retries, log failure but don't crash
      if (job.attemptsMade >= job.opts.attempts) {
        logger.error('WhatsApp send permanently failed (max retries)', {
          phoneNumber: sanitizedPhone,
          originalJobId: jobId
        });

        // Store failure record for investigation
        const redisClient = getRedisClient();
        const failureKey = `whatsapp-failed:${jobId}`;
        await redisClient.setEx(
          failureKey,
          86400 * 30, // 30 days retention
          JSON.stringify({
            jobId,
            phoneNumber,
            message,
            error: error.message,
            failedAt: new Date().toISOString(),
            attempts: job.attemptsMade
          })
        );
      }

      throw error; // Retry
    }
  }

  /**
   * Close the worker
   */
  async close() {
    if (this.worker) {
      await this.worker.close();
      logger.info('WhatsApp sender worker closed');
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

export default WhatsAppSenderWorker;
