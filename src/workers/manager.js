/**
 * Worker Manager
 * Starts and manages all worker processes
 */

import ChatMessageWorker from './chat-message.worker.js';
import WhatsAppSenderWorker from './whatsapp-sender.worker.js';
import { QUEUE_NAMES } from '../queues/bullmq.config.js';
import logger from '../logger/logger.js';

class WorkerManager {
  constructor(options = {}) {
    this.workers = {};
    this.options = {
      chatWorkerConcurrency: options.chatWorkerConcurrency || 5,
      whatsappWorkerConcurrency: options.whatsappWorkerConcurrency || 10,
      ...options
    };
  }

  /**
   * Start all workers
   */
  async startAll() {
    try {
      // Start chat message worker
      const chatWorker = new ChatMessageWorker(QUEUE_NAMES.CHAT_PROCESSING, {
        concurrency: this.options.chatWorkerConcurrency
      });
      await chatWorker.start();
      this.workers.chatWorker = chatWorker;

      // Start WhatsApp sender worker
      const whatsappWorker = new WhatsAppSenderWorker(QUEUE_NAMES.WHATSAPP_SENDER, {
        concurrency: this.options.whatsappWorkerConcurrency
      });
      await whatsappWorker.start();
      this.workers.whatsappWorker = whatsappWorker;

      logger.info('All workers started successfully', {
        workers: Object.keys(this.workers)
      });

      return this.workers;
    } catch (error) {
      logger.error('Failed to start workers', { error: error.message });
      await this.closeAll();
      throw error;
    }
  }

  /**
   * Close all workers
   */
  async closeAll() {
    try {
      for (const [name, worker] of Object.entries(this.workers)) {
        await worker.close();
        logger.info(`Worker closed: ${name}`);
      }
      this.workers = {};
    } catch (error) {
      logger.error('Error closing workers', { error: error.message });
    }
  }

  /**
   * Get all worker stats
   */
  async getStats() {
    const stats = {};
    for (const [name, worker] of Object.entries(this.workers)) {
      stats[name] = await worker.getStats();
    }
    return stats;
  }
}

// Singleton instance
let workerManager = null;

export function initWorkerManager(options = {}) {
  workerManager = new WorkerManager(options);
  return workerManager;
}

export function getWorkerManager() {
  if (!workerManager) {
    throw new Error('Worker manager not initialized. Call initWorkerManager() first.');
  }
  return workerManager;
}

export default { WorkerManager, initWorkerManager, getWorkerManager };
