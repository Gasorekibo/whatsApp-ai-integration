/**
 * BullMQ Queue Configuration
 * Defines job schemas and queue initialization for chat message processing
 */

import { Queue } from 'bullmq';
import { getRedisClient } from '../config/redis.config.js';
import logger from '../logger/logger.js';

// Job type constants
export const JOB_TYPES = {
  PROCESS_MESSAGE: 'process_message',
  SEND_WHATSAPP_MESSAGE: 'send_whatsapp_message',
  SYNC_DATA_SOURCE: 'sync_data_source'
};

// Queue names
export const QUEUE_NAMES = {
  CHAT_PROCESSING: 'chat-processing-queue',
  WHATSAPP_SENDER: 'whatsapp-sender-queue',
  DATA_SYNC: 'data-sync-queue'
};

let queues = {};

/**
 * Initialize all required queues
 */
export async function initQueues() {
  try {
    let redisClient;
    try {
      redisClient = getRedisClient();
    } catch (e) {
      logger.warn('Redis not available, queues disabled for local development');
      return {};
    }

    if (!redisClient) {
      logger.warn('Redis not available, queues disabled for local development');
      return {};
    }

    // Main chat processing queue
    queues[QUEUE_NAMES.CHAT_PROCESSING] = new Queue(QUEUE_NAMES.CHAT_PROCESSING, {
      connection: redisClient,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: {
          age: 3600 // Remove completed jobs after 1 hour
        },
        removeOnFail: {
          age: 86400 // Keep failed jobs for 24 hours for debugging
        }
      }
    });

    // WhatsApp sender queue (must be reliable, no early removal)
    queues[QUEUE_NAMES.WHATSAPP_SENDER] = new Queue(QUEUE_NAMES.WHATSAPP_SENDER, {
      connection: redisClient,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000
        },
        removeOnComplete: {
          age: 86400 // Keep for 24 hours
        }
      }
    });

    // Data sync queue
    queues[QUEUE_NAMES.DATA_SYNC] = new Queue(QUEUE_NAMES.DATA_SYNC, {
      connection: redisClient,
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      }
    });

    logger.info('All BullMQ queues initialized successfully', {
      queues: Object.keys(queues)
    });

    return queues;
  } catch (error) {
    logger.warn('Failed to initialize queues (continuing without async processing)', { error: error.message });
    return {};
  }
}

/**
 * Get a specific queue
 */
export function getQueue(queueName) {
  if (!queues[queueName]) {
    return null; // Return null instead of throwing for dev mode
  }
  return queues[queueName];
}

/**
 * Add job to chat processing queue
 * @param {object} data - Job data
 * @returns {Promise<string>} - Job ID
 */
export async function addChatProcessingJob(data) {
  try {
    const queue = getQueue(QUEUE_NAMES.CHAT_PROCESSING);

    if (!queue) {
      logger.warn('Chat processing queue not available, skipping job', { phoneNumber: data.phoneNumber });
      return null;
    }
    const job = await queue.add(JOB_TYPES.PROCESS_MESSAGE, data, {
      jobId: `${data.phoneNumber}-${Date.now()}` // Ensure unique job IDs
    });

    logger.info('Chat processing job queued', {
      jobId: job.id,
      phoneNumber: data.phoneNumber
    });

    return job.id;
  } catch (error) {
    logger.error('Failed to add chat processing job', { error: error.message });
    throw error;
  }
}

/**
 * Add job to WhatsApp sender queue
 */
export async function addWhatsAppSenderJob(data) {
  try {
    const queue = getQueue(QUEUE_NAMES.WHATSAPP_SENDER);
    const job = await queue.add(JOB_TYPES.SEND_WHATSAPP_MESSAGE, data, {
      jobId: `whatsapp-${data.phoneNumber}-${Date.now()}`
    });

    return job.id;
  } catch (error) {
    logger.error('Failed to add WhatsApp sender job', { error: error.message });
    throw error;
  }
}

/**
 * Close all queues
 */
export async function closeQueues() {
  try {
    for (const [name, queue] of Object.entries(queues)) {
      await queue.close();
      logger.info(`Queue closed: ${name}`);
    }
    queues = {};
  } catch (error) {
    logger.error('Error closing queues', { error: error.message });
  }
}

export default { initQueues, getQueue, addChatProcessingJob, addWhatsAppSenderJob, closeQueues };
