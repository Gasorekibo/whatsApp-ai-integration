/**
 * Queue Monitoring Service
 * Tracks queue health, latency, and system metrics
 */

import { getQueue } from '../queues/bullmq.config.js';
import { getRedisClient } from '../config/redis.config.js';
import logger from '../logger/logger.js';

export class QueueMonitor {
  constructor(options = {}) {
    this.pollInterval = options.pollInterval || 30000; // 30s
    this.metricsPrefix = 'queue-metrics:';
    this.isRunning = false;
  }

  /**
   * Start monitoring
   */
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.pollInterval = setInterval(() => this.collectMetrics(), this.pollInterval);
    logger.info('Queue monitor started', { pollInterval: `${this.pollInterval}ms` });
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.isRunning = false;
      logger.info('Queue monitor stopped');
    }
  }

  /**
   * Collect metrics from all queues
   */
  async collectMetrics() {
    try {
      const chatQueue = getQueue('chat-processing-queue');
      const whatsappQueue = getQueue('whatsapp-sender-queue');
      const redisClient = getRedisClient();

      // Get queue stats
      const chatStats = await chatQueue.getCountsPerState();
      const whatsappStats = await whatsappQueue.getCountsPerState();

      const metrics = {
        timestamp: new Date().toISOString(),
        chat: {
          waiting: chatStats.waiting || 0,
          active: chatStats.active || 0,
          completed: chatStats.completed || 0,
          failed: chatStats.failed || 0,
          delayed: chatStats.delayed || 0,
          totalWaiting: (chatStats.waiting || 0) + (chatStats.delayed || 0)
        },
        whatsapp: {
          waiting: whatsappStats.waiting || 0,
          active: whatsappStats.active || 0,
          completed: whatsappStats.completed || 0,
          failed: whatsappStats.failed || 0,
          delayed: whatsappStats.delayed || 0
        }
      };

      // Alert conditions
      const alerts = [];

      if (metrics.chat.totalWaiting > 100) {
        alerts.push({
          level: 'warning',
          message: `Chat queue backlog high: ${metrics.chat.totalWaiting} waiting`,
          metric: 'chat_queue_backlog'
        });
      }

      if (metrics.chat.failed > 50) {
        alerts.push({
          level: 'error',
          message: `High failure rate in chat queue: ${metrics.chat.failed} failed`,
          metric: 'chat_queue_failures'
        });
      }

      if (metrics.whatsapp.waiting > 200) {
        alerts.push({
          level: 'warning',
          message: `WhatsApp queue backlog: ${metrics.whatsapp.waiting} waiting`,
          metric: 'whatsapp_queue_backlog'
        });
      }

      // Store metrics in Redis for historical tracking
      const metricsKey = `${this.metricsPrefix}${Date.now()}`;
      await redisClient.setEx(metricsKey, 86400 * 7, JSON.stringify(metrics)); // 7-day retention

      // Log metrics
      logger.info('Queue metrics collected', metrics);

      // Log alerts
      if (alerts.length > 0) {
        alerts.forEach(alert => {
          if (alert.level === 'error') {
            logger.error(alert.message, { metric: alert.metric });
          } else {
            logger.warn(alert.message, { metric: alert.metric });
          }
        });
      }

      return { metrics, alerts };
    } catch (error) {
      logger.error('Failed to collect queue metrics', { error: error.message });
    }
  }

  /**
   * Get current queue health
   */
  async getHealth() {
    try {
      const chatQueue = getQueue('chat-processing-queue');
      const whatsappQueue = getQueue('whatsapp-sender-queue');

      const chatStats = await chatQueue.getCountsPerState();
      const whatsappStats = await whatsappQueue.getCountsPerState();

      const health = {
        timestamp: new Date().toISOString(),
        status: 'healthy',
        queues: {
          chat: {
            size: (chatStats.waiting || 0) + (chatStats.active || 0),
            stats: chatStats
          },
          whatsapp: {
            size: (whatsappStats.waiting || 0) + (whatsappStats.active || 0),
            stats: whatsappStats
          }
        }
      };

      // Determine overall health
      if (chatStats.failed > 100 || whatsappStats.failed > 100) {
        health.status = 'unhealthy';
      } else if ((chatStats.waiting || 0) > 500 || (whatsappStats.waiting || 0) > 500) {
        health.status = 'degraded';
      }

      return health;
    } catch (error) {
      logger.error('Failed to get queue health', { error: error.message });
      return { status: 'unknown', error: error.message };
    }
  }

  /**
   * Get historical metrics (last N minutes)
   */
  async getHistoricalMetrics(minutes = 60) {
    try {
      const redisClient = getRedisClient();
      const now = Date.now();
      const startTime = now - minutes * 60 * 1000;

      // Scan for metrics keys in the time range
      const keys = await redisClient.keys(`${this.metricsPrefix}*`);
      const filteredKeys = keys.filter(key => {
        const timestamp = parseInt(key.replace(this.metricsPrefix, ''));
        return timestamp >= startTime && timestamp <= now;
      });

      // Get all metrics
      const metrics = [];
      for (const key of filteredKeys) {
        const data = await redisClient.get(key);
        if (data) {
          metrics.push(JSON.parse(data));
        }
      }

      return metrics.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } catch (error) {
      logger.error('Failed to get historical metrics', { error: error.message });
      return [];
    }
  }
}

// Singleton instance
let monitor = null;

export function initQueueMonitor(options = {}) {
  monitor = new QueueMonitor(options);
  monitor.start();
  return monitor;
}

export function getQueueMonitor() {
  if (!monitor) {
    throw new Error('Queue monitor not initialized. Call initQueueMonitor() first.');
  }
  return monitor;
}

export default { QueueMonitor, initQueueMonitor, getQueueMonitor };
