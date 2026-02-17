import { GoogleGenerativeAI } from '@google/generative-ai';
import NodeCache from 'node-cache';
import crypto from 'crypto';
import ragConfig from '../config/rag.config.js';
import logger from '../logger/logger.js';
import { getCacheConfig, getRateLimitConfig, getRetryConfig } from '../utils/config-compatibility.helper.js';

/**
 * Enhanced Embedding Service
 * Generates vector embeddings using Google's Gemini API
 * Features:
 * - Smart caching with hash-based keys
 * - Rate limiting and retry logic
 * - Batch processing with concurrency control
 * - Error recovery and fallbacks
 * 
 * @version 2.0.0
 */

class EmbeddingService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = ragConfig.embedding.model;

        // Initialize caches using compatibility helper
        const cacheConfig = getCacheConfig(ragConfig, 'embedding');

        this.embeddingCache = cacheConfig.enabled
            ? new NodeCache({
                stdTTL: cacheConfig.ttl,
                checkperiod: cacheConfig.checkPeriod,
                maxKeys: cacheConfig.maxKeys
            })
            : null;

        // Rate limiter state
        this.rateLimiter = {
            requests: [],
            tokens: [],
            lastReset: Date.now()
        };

        // Get rate limit config using helper
        this.rateLimit = getRateLimitConfig(ragConfig);

        // Get retry config using helper
        this.retryConfig = getRetryConfig(ragConfig);

        // Statistics
        this.stats = {
            totalRequests: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errors: 0,
            totalTokens: 0
        };

        logger.info('Embedding service initialized', {
            model: this.model,
            dimensions: ragConfig.embedding.dimensions,
            cacheEnabled: !!this.embeddingCache
        });
    }

    /**
     * Generate embedding for a single text
     * @param {string} text - Text to embed
     * @param {string} taskType - 'RETRIEVAL_DOCUMENT' or 'RETRIEVAL_QUERY'
     * @returns {Promise<number[]>} - Embedding vector (768 dimensions)
     */
    async generateEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
        try {
            if (!text || typeof text !== 'string' || text.trim().length === 0) {
                throw new Error('Text must be a non-empty string');
            }

            // Truncate very long texts
            const maxChars = 10000; // Gemini limit
            const truncatedText = text.length > maxChars
                ? text.substring(0, maxChars) + '...'
                : text;

            // Generate cache key using hash for long texts
            const cacheKey = this._generateCacheKey(truncatedText, taskType);

            // Check cache first
            if (this.embeddingCache) {
                const cached = this.embeddingCache.get(cacheKey);
                if (cached) {
                    this.stats.cacheHits++;
                    logger.debug('Embedding cache hit', { taskType });
                    return cached;
                }
                this.stats.cacheMisses++;
            }

            // Rate limiting check
            await this._checkRateLimit();

            // Generate embedding with retry logic
            const rawEmbedding = await this._generateWithRetry(truncatedText, taskType);

            // Handle dimension mismatch (Gemini embeddings support safe prefix truncation)
            const expectedDim = ragConfig.embedding.dimensions;
            const embedding = rawEmbedding.length > expectedDim
                ? rawEmbedding.slice(0, expectedDim)
                : rawEmbedding;

            // Validate embedding
            this._validateEmbedding(embedding);

            // Cache the result
            if (this.embeddingCache) {
                this.embeddingCache.set(cacheKey, embedding);
            }

            // Update stats
            this.stats.totalRequests++;
            this.stats.totalTokens += Math.ceil(truncatedText.length / 4);

            return embedding;

        } catch (error) {
            this.stats.errors++;
            logger.error('Error generating embedding', {
                error: error.message,
                stack: error.stack,
                textLength: text?.length
            });
            throw error;
        }
    }

    /**
     * Generate embeddings for multiple texts in batch
     * @param {string[]} texts - Array of texts to embed
     * @param {string} taskType - Task type for all embeddings
     * @returns {Promise<number[][]>} - Array of embedding vectors
     */
    async generateBatchEmbeddings(texts, taskType = 'RETRIEVAL_DOCUMENT') {
        try {
            if (!Array.isArray(texts) || texts.length === 0) {
                throw new Error('Texts must be a non-empty array');
            }

            // Filter out empty or invalid texts
            const validTexts = texts.filter(t =>
                t && typeof t === 'string' && t.trim().length > 0
            );

            if (validTexts.length === 0) {
                throw new Error('No valid texts to embed');
            }

            if (validTexts.length !== texts.length) {
                logger.warn('Some texts were invalid and filtered out', {
                    original: texts.length,
                    valid: validTexts.length
                });
            }

            const batchSize = ragConfig.embedding.batchSize;
            const batches = [];

            // Split into batches
            for (let i = 0; i < validTexts.length; i += batchSize) {
                batches.push(validTexts.slice(i, i + batchSize));
            }

            logger.info('Processing batch embeddings', {
                totalTexts: validTexts.length,
                batches: batches.length,
                batchSize
            });

            const allEmbeddings = [];
            let processedBatches = 0;

            // Process batches with controlled concurrency
            for (let i = 0; i < batches.length; i += ragConfig.embedding.maxConcurrentBatches) {
                const concurrentBatches = batches.slice(
                    i,
                    i + ragConfig.embedding.maxConcurrentBatches
                );

                // Process concurrent batches
                const batchPromises = concurrentBatches.map(async (batch, batchIndex) => {
                    const actualBatchIndex = i + batchIndex;
                    logger.debug(`Processing batch ${actualBatchIndex + 1}/${batches.length}`, {
                        batchSize: batch.length
                    });

                    // Check cache for each text in batch
                    const batchResults = await Promise.all(
                        batch.map(text => this.generateEmbedding(text, taskType))
                    );

                    processedBatches++;
                    return batchResults;
                });

                const batchEmbeddings = await Promise.all(batchPromises);
                allEmbeddings.push(...batchEmbeddings.flat());

                // Rate limiting: wait between batch groups
                if (i + ragConfig.embedding.maxConcurrentBatches < batches.length) {
                    await this._delay(ragConfig.embedding.batchDelay);
                }

                // Progress logging
                if (processedBatches % 5 === 0) {
                    logger.info('Batch progress', {
                        processed: processedBatches,
                        total: batches.length,
                        percentage: Math.round((processedBatches / batches.length) * 100)
                    });
                }
            }

            logger.info('Generated embeddings successfully', {
                count: allEmbeddings.length,
                cacheHitRate: this._getCacheHitRate()
            });

            return allEmbeddings;

        } catch (error) {
            logger.error('Error in batch embedding', {
                error: error.message,
                stack: error.stack,
                textsCount: texts?.length
            });
            throw error;
        }
    }

    /**
     * Generate embedding with retry logic
     * @private
     */
    async _generateWithRetry(text, taskType, retryCount = 0) {
        try {
            const model = this.genAI.getGenerativeModel({ model: this.model });

            const result = await model.embedContent({
                content: { parts: [{ text }] },
                taskType,
                // Request specific dimensionality if supported by the model version
                outputDimensionality: ragConfig.embedding.dimensions
            });

            return result.embedding.values;

        } catch (error) {
            if (retryCount < this.retryConfig.maxRetries) {
                const delay = this.retryConfig.retryDelay *
                    Math.pow(this.retryConfig.retryBackoff, retryCount);

                logger.warn(`Embedding failed, retrying (${retryCount + 1}/${this.retryConfig.maxRetries})`, {
                    error: error.message,
                    delay,
                    textLength: text.length
                });

                await this._delay(delay);
                return this._generateWithRetry(text, taskType, retryCount + 1);
            }

            throw error;
        }
    }

    /**
     * Validate embedding dimensions
     * @private
     */
    _validateEmbedding(embedding) {
        const expectedDim = ragConfig.embedding.dimensions;

        if (!Array.isArray(embedding)) {
            throw new Error('Embedding must be an array');
        }

        if (embedding.length !== expectedDim) {
            logger.warn('Embedding dimension discrepancy detected', {
                got: embedding.length,
                expected: expectedDim,
                model: this.model
            });
            throw new Error(
                `Invalid embedding dimension: got ${embedding.length}, expected ${expectedDim}`
            );
        }

        // Check for NaN or invalid values
        if (embedding.some(v => !Number.isFinite(v))) {
            throw new Error('Embedding contains invalid values (NaN or Infinity)');
        }
    }

    /**
     * Generate cache key (hash for long texts)
     * @private
     */
    _generateCacheKey(text, taskType) {
        const prefix = `emb:${taskType}`;

        // Use hash for long texts to avoid cache key size issues
        if (text.length > 200) {
            const hash = crypto
                .createHash('sha256')
                .update(text)
                .digest('hex')
                .substring(0, 16);
            return `${prefix}:${hash}`;
        }

        // Use text directly for short texts (better debugging)
        return `${prefix}:${text}`;
    }

    /**
     * Check rate limits and wait if necessary
     * @private
     */
    async _checkRateLimit() {
        const now = Date.now();
        const oneMinute = 60 * 1000;
        const oneDay = 24 * 60 * 60 * 1000;

        // Reset counters if needed
        if (now - this.rateLimiter.lastReset > oneDay) {
            this.rateLimiter.requests = [];
            this.rateLimiter.tokens = [];
            this.rateLimiter.lastReset = now;
        }

        // Remove old requests (older than 1 minute)
        this.rateLimiter.requests = this.rateLimiter.requests.filter(
            time => now - time < oneMinute
        );

        // Check if we're hitting rate limits
        const requestsPerMinute = this.rateLimiter.requests.length;
        const limit = this.rateLimit.requestsPerMinute;

        if (requestsPerMinute >= limit) {
            const oldestRequest = Math.min(...this.rateLimiter.requests);
            const waitTime = oneMinute - (now - oldestRequest) + 100; // +100ms buffer

            logger.warn('Rate limit approaching, throttling', {
                requestsPerMinute,
                limit,
                waitTime
            });

            await this._delay(waitTime);
        }

        // Record this request
        this.rateLimiter.requests.push(now);
    }

    /**
     * Delay helper
     * @private
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Calculate cache hit rate
     * @private
     */
    _getCacheHitRate() {
        const total = this.stats.cacheHits + this.stats.cacheMisses;
        return total > 0 ? (this.stats.cacheHits / total * 100).toFixed(2) : 0;
    }

    /**
     * Get cached embedding if available
     * @param {string} text - Text to check
     * @param {string} taskType - Task type
     * @returns {number[] | null} - Cached embedding or null
     */
    getCachedEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
        if (!this.embeddingCache) return null;

        const cacheKey = this._generateCacheKey(text, taskType);
        return this.embeddingCache.get(cacheKey) || null;
    }

    /**
     * Clear the embedding cache
     */
    clearCache() {
        if (this.embeddingCache) {
            this.embeddingCache.flushAll();
            logger.info('Embedding cache cleared');
        }
    }

    /**
     * Get cache statistics
     * @returns {object} - Cache stats
     */
    getCacheStats() {
        if (!this.embeddingCache) {
            return { enabled: false };
        }

        const cacheConfig = getCacheConfig(ragConfig, 'embedding');

        return {
            enabled: true,
            keys: this.embeddingCache.keys().length,
            hits: this.stats.cacheHits,
            misses: this.stats.cacheMisses,
            hitRate: this._getCacheHitRate() + '%',
            size: this.embeddingCache.keys().length,
            maxKeys: cacheConfig.maxKeys
        };
    }

    /**
     * Get service statistics
     * @returns {object} - Service stats
     */
    getStats() {
        return {
            ...this.stats,
            cacheHitRate: this._getCacheHitRate() + '%',
            errorRate: this.stats.totalRequests > 0
                ? (this.stats.errors / this.stats.totalRequests * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    /**
     * Test the embedding service
     * @returns {Promise<boolean>} - True if test passes
     */
    async testConnection() {
        try {
            logger.info('Testing embedding service...');

            const testText = 'This is a test sentence for embedding generation.';
            const embedding = await this.generateEmbedding(testText, 'RETRIEVAL_QUERY');

            const isValid =
                Array.isArray(embedding) &&
                embedding.length === ragConfig.embedding.dimensions &&
                embedding.every(v => Number.isFinite(v));

            if (!isValid) {
                throw new Error('Invalid embedding generated');
            }

            logger.info('Embedding service test successful', {
                dimensions: embedding.length,
                model: this.model
            });

            return true;

        } catch (error) {
            logger.error('Embedding service test failed', {
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    /**
     * Warm up cache with common queries (optional)
     * @param {string[]} commonQueries - Array of common queries
     */
    async warmupCache(commonQueries = []) {
        if (!this.embeddingCache || commonQueries.length === 0) {
            return;
        }

        logger.info('Warming up embedding cache', { count: commonQueries.length });

        try {
            await this.generateBatchEmbeddings(
                commonQueries,
                ragConfig.embedding.queryTaskType
            );

            logger.info('Cache warmup complete');
        } catch (error) {
            logger.warn('Cache warmup failed', { error: error.message });
        }
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            totalRequests: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errors: 0,
            totalTokens: 0
        };
        logger.info('Statistics reset');
    }
}

// Export singleton instance
const embeddingService = new EmbeddingService();

export default embeddingService;