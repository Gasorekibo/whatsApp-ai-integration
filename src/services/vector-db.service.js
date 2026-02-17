import { Pinecone } from '@pinecone-database/pinecone';
import ragConfig from '../config/rag.config.js';
import logger from '../logger/logger.js';

/**
 * Enhanced Vector Database Service
 * Manages Pinecone vector database operations
 * Features:
 * - Robust error handling and retry logic
 * - Optimized batch operations
 * - Connection pooling and health checks
 * - Comprehensive validation
 * 
 * @version 2.0.0
 */

class VectorDBService {
    constructor() {
        this.client = null;
        this.index = null;
        this.isInitialized = false;
        this.config = ragConfig.vectorDB.pinecone;
        this.initializationPromise = null;

        // Statistics
        this.stats = {
            upserts: 0,
            queries: 0,
            deletes: 0,
            errors: 0,
            lastHealthCheck: null
        };
    }

    /**
     * Initialize Pinecone client and index
     */
    async initialize() {
        try {
            // Prevent multiple simultaneous initializations
            if (this.initializationPromise) {
                return await this.initializationPromise;
            }

            if (this.isInitialized) {
                return;
            }

            this.initializationPromise = this._performInitialization();
            await this.initializationPromise;
            this.initializationPromise = null;

        } catch (error) {
            this.initializationPromise = null;
            logger.error('Failed to initialize Vector DB', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Perform actual initialization
     * @private
     */
    async _performInitialization() {
        logger.info('Initializing Pinecone vector database', {
            indexName: this.config.indexName,
            dimension: this.config.dimensions,
            metric: this.config.metric
        });

        // Validate API key
        if (!this.config.apiKey) {
            throw new Error(
                'PINECONE_API_KEY not found in environment variables. ' +
                'Please set PINECONE_API_KEY (note: you may have a typo - PINECON vs PINECONE)'
            );
        }

        // Initialize Pinecone client
        this.client = new Pinecone({
            apiKey: this.config.apiKey
        });

        // Ensure index exists
        await this.ensureIndexExists();

        // Get index reference
        this.index = this.client.index(this.config.indexName);

        this.isInitialized = true;

        // Perform initial health check
        await this.healthCheck();

        logger.info('Successfully connected to Pinecone', {
            index: this.config.indexName,
            dimension: this.config.dimensions
        });
    }

    /**
     * Ensure index exists, create if not
     */
    async ensureIndexExists() {
        try {
            const { indexes } = await this.client.listIndexes();
            const indexExists = indexes?.some(idx => idx.name === this.config.indexName);

            if (!indexExists) {
                logger.info('Index does not exist, creating...', {
                    name: this.config.indexName,
                    dimension: this.config.dimensions
                });

                await this.client.createIndex({
                    name: this.config.indexName,
                    dimension: this.config.dimensions,
                    metric: this.config.metric,
                    spec: {
                        serverless: {
                            cloud: this.config.cloud,
                            region: this.config.region
                        }
                    }
                });

                // Wait for index to be ready
                await this._waitForIndexReady();

                logger.info('Index created successfully', {
                    name: this.config.indexName
                });
            } else {
                logger.info('Index already exists', {
                    name: this.config.indexName
                });

                // Verify index configuration
                await this._verifyIndexConfig();
            }
        } catch (error) {
            logger.error('Error ensuring index exists', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Wait for index to be ready
     * @private
     */
    async _waitForIndexReady() {
        logger.info('Waiting for index to be ready...');

        const maxAttempts = 120; // 2 minutes (increased from 60)
        const delayMs = 1000;
        let attempts = 0;

        while (attempts < maxAttempts) {
            try {
                const description = await this.client.describeIndex(this.config.indexName);

                if (description.status?.ready) {
                    logger.info('Index is ready', {
                        attempts: attempts + 1,
                        duration: `${attempts}s`
                    });
                    return;
                }

                attempts++;

                // Log progress every 10 seconds
                if (attempts % 10 === 0) {
                    logger.info('Still waiting for index...', {
                        attempts,
                        status: description.status?.state
                    });
                }

                await this._delay(delayMs);

            } catch (error) {
                logger.warn('Error checking index status', {
                    error: error.message,
                    attempts
                });

                attempts++;
                await this._delay(delayMs);
            }
        }

        throw new Error(`Index creation timed out after ${maxAttempts} attempts`);
    }

    /**
     * Verify index configuration matches expected config
     * @private
     */
    async _verifyIndexConfig() {
        try {
            const description = await this.client.describeIndex(this.config.indexName);

            const actualDimension = description.dimension;
            const expectedDimension = this.config.dimensions;

            if (actualDimension !== expectedDimension) {
                logger.error('Index dimension mismatch!', {
                    expected: expectedDimension,
                    actual: actualDimension,
                    indexName: this.config.indexName
                });

                throw new Error(
                    `Index dimension mismatch: expected ${expectedDimension}, ` +
                    `but index has ${actualDimension}. ` +
                    `Please delete the index or use a different index name.`
                );
            }

            logger.info('Index configuration verified', {
                dimension: actualDimension,
                metric: this.config.metric
            });

        } catch (error) {
            if (error.message.includes('dimension mismatch')) {
                throw error;
            }

            logger.warn('Could not verify index config', {
                error: error.message
            });
        }
    }

    /**
     * Upsert documents into vector database
     * @param {Array} documents - Array of {id, values, metadata}
     * @param {string} namespace - Optional namespace for organization
     */
    async upsertDocuments(documents, namespace = 'default') {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            // Validate input
            this._validateDocuments(documents);

            logger.info('Upserting documents', {
                count: documents.length,
                namespace
            });

            // Split into batches (Pinecone has limits)
            const batchSize = this.config.maxBatchSize || 100;
            const batches = this._createBatches(documents, batchSize);

            let successCount = 0;
            let errorCount = 0;

            // Process each batch with retry logic
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];

                logger.debug(`Upserting batch ${i + 1}/${batches.length}`, {
                    batchSize: batch.length,
                    namespace
                });

                try {
                    await this._upsertBatchWithRetry(batch, namespace);
                    successCount += batch.length;

                    // Small delay between batches to avoid rate limits
                    if (i < batches.length - 1) {
                        await this._delay(100);
                    }

                } catch (error) {
                    errorCount += batch.length;
                    logger.error(`Failed to upsert batch ${i + 1}`, {
                        error: error.message,
                        batchSize: batch.length
                    });

                    // Continue with remaining batches
                    // (you might want to throw here depending on requirements)
                }

                // Progress logging for large upserts
                if ((i + 1) % 10 === 0) {
                    logger.info('Upsert progress', {
                        processed: i + 1,
                        total: batches.length,
                        percentage: Math.round(((i + 1) / batches.length) * 100)
                    });
                }
            }

            this.stats.upserts += successCount;

            if (errorCount > 0) {
                this.stats.errors += errorCount;
                logger.warn('Some documents failed to upsert', {
                    success: successCount,
                    failed: errorCount
                });
            } else {
                logger.info('Successfully upserted all documents', {
                    count: successCount,
                    namespace
                });
            }

            return { success: successCount, failed: errorCount };

        } catch (error) {
            this.stats.errors++;
            logger.error('Error upserting documents', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Upsert a single batch with retry logic
     * @private
     */
    async _upsertBatchWithRetry(batch, namespace, retryCount = 0) {
        try {
            await this.index.namespace(namespace).upsert(batch);
        } catch (error) {
            const maxRetries = this.config.maxRetries || 3;

            if (retryCount < maxRetries) {
                const delay = (this.config.retryDelay || 1000) * Math.pow(2, retryCount);

                logger.warn(`Upsert failed, retrying (${retryCount + 1}/${maxRetries})`, {
                    error: error.message,
                    delay,
                    batchSize: batch.length
                });

                await this._delay(delay);
                return this._upsertBatchWithRetry(batch, namespace, retryCount + 1);
            }

            throw error;
        }
    }

    /**
     * Search for similar documents
     * @param {number[]} queryVector - Query embedding vector
     * @param {number} topK - Number of results to return
     * @param {object} filter - Metadata filter
     * @param {string} namespace - Namespace to search in
     * @returns {Promise<Array>} - Similar documents with scores
     */
    async searchSimilar(queryVector, topK = 5, filter = {}, namespace = 'default') {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            // Validate query vector
            this._validateQueryVector(queryVector);

            // Build query request
            const queryRequest = {
                vector: queryVector,
                topK: Math.min(topK, 100), // Pinecone max is 10000, but we limit for performance
                includeMetadata: ragConfig.retrieval.includeMetadata,
                includeValues: ragConfig.retrieval.includeValues
            };

            // Add filter if provided and non-empty
            if (filter && Object.keys(filter).length > 0) {
                queryRequest.filter = this._normalizeFilter(filter);
            }

            // Execute query with retry
            const results = await this._queryWithRetry(queryRequest, namespace);

            // Filter by minimum score
            const minScore = ragConfig.retrieval.minScore;
            const filteredResults = results.matches.filter(
                match => match.score >= minScore
            );

            // Deduplicate if enabled
            const finalResults = ragConfig.retrieval.deduplication.enabled
                ? this._deduplicateResults(filteredResults)
                : filteredResults;

            this.stats.queries++;

            logger.debug('Search completed', {
                total: results.matches.length,
                qualified: filteredResults.length,
                final: finalResults.length,
                minScore
            });

            return finalResults;

        } catch (error) {
            this.stats.errors++;
            logger.error('Error searching similar documents', {
                error: error.message,
                stack: error.stack,
                topK,
                namespace
            });
            throw error;
        }
    }

    /**
     * Query with retry logic
     * @private
     */
    async _queryWithRetry(queryRequest, namespace, retryCount = 0) {
        try {
            return await this.index.namespace(namespace).query(queryRequest);
        } catch (error) {
            const maxRetries = this.config.maxRetries || 3;

            if (retryCount < maxRetries) {
                const delay = (this.config.retryDelay || 1000) * Math.pow(2, retryCount);

                logger.warn(`Query failed, retrying (${retryCount + 1}/${maxRetries})`, {
                    error: error.message,
                    delay
                });

                await this._delay(delay);
                return this._queryWithRetry(queryRequest, namespace, retryCount + 1);
            }

            throw error;
        }
    }

    /**
     * Deduplicate search results based on similarity
     * @private
     */
    _deduplicateResults(results) {
        if (results.length <= 1) return results;

        const threshold = ragConfig.retrieval.deduplication.similarityThreshold;
        const deduplicated = [results[0]]; // Always keep the best match

        for (let i = 1; i < results.length; i++) {
            const current = results[i];
            let isDuplicate = false;

            for (const kept of deduplicated) {
                // Check if content is too similar
                if (this._areSimilar(current, kept, threshold)) {
                    isDuplicate = true;
                    break;
                }
            }

            if (!isDuplicate) {
                deduplicated.push(current);
            }
        }

        if (deduplicated.length < results.length) {
            logger.debug('Deduplication removed items', {
                original: results.length,
                deduplicated: deduplicated.length,
                removed: results.length - deduplicated.length
            });
        }

        return deduplicated;
    }

    /**
     * Check if two results are similar (for deduplication)
     * @private
     */
    _areSimilar(result1, result2, threshold) {
        // Compare content if available
        const content1 = result1.metadata?.content || '';
        const content2 = result2.metadata?.content || '';

        if (content1 && content2) {
            const similarity = this._calculateTextSimilarity(content1, content2);
            return similarity >= threshold;
        }

        return false;
    }

    /**
     * Calculate simple text similarity (Jaccard)
     * @private
     */
    _calculateTextSimilarity(text1, text2) {
        const words1 = new Set(text1.toLowerCase().split(/\s+/));
        const words2 = new Set(text2.toLowerCase().split(/\s+/));

        const intersection = new Set([...words1].filter(w => words2.has(w)));
        const union = new Set([...words1, ...words2]);

        return intersection.size / union.size;
    }

    /**
     * Delete documents by IDs
     * @param {string[]} ids - Array of document IDs to delete
     * @param {string} namespace - Namespace
     */
    async deleteDocuments(ids, namespace = 'default') {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            if (!Array.isArray(ids) || ids.length === 0) {
                throw new Error('IDs must be a non-empty array');
            }

            logger.info('Deleting documents', {
                count: ids.length,
                namespace
            });

            await this.index.namespace(namespace).deleteMany(ids);

            this.stats.deletes += ids.length;

            logger.info('Documents deleted successfully', {
                count: ids.length
            });

        } catch (error) {
            this.stats.errors++;
            logger.error('Error deleting documents', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Delete all documents in a namespace
     * @param {string} namespace - Namespace to clear
     */
    async deleteNamespace(namespace = 'default') {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            logger.warn('Clearing namespace', { namespace });

            await this.index.namespace(namespace).deleteAll();

            logger.info('Namespace cleared successfully', { namespace });

        } catch (error) {
            this.stats.errors++;
            logger.error('Error clearing namespace', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Get index statistics
     * @returns {Promise<object>} - Index stats
     */
    async getStats(namespace = 'default') {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            const stats = await this.index.describeIndexStats();

            return {
                totalVectors: stats.totalRecordCount || 0,
                dimension: stats.dimension,
                indexFullness: stats.indexFullness || 0,
                namespaces: stats.namespaces || {},
                namespace: stats.namespaces?.[namespace] || { recordCount: 0 },
                operationStats: this.stats
            };

        } catch (error) {
            logger.error('Error getting stats', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Fetch specific documents by IDs
     * @param {string[]} ids - Document IDs
     * @param {string} namespace - Namespace
     * @returns {Promise<object>} - Fetched documents
     */
    async fetchDocuments(ids, namespace = 'default') {
        try {
            if (!this.isInitialized) {
                await this.initialize();
            }

            if (!Array.isArray(ids) || ids.length === 0) {
                throw new Error('IDs must be a non-empty array');
            }

            const results = await this.index.namespace(namespace).fetch(ids);
            return results.records || {};

        } catch (error) {
            logger.error('Error fetching documents', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Perform health check
     * @returns {Promise<object>} - Health status
     */
    async healthCheck() {
        try {
            if (!this.isInitialized) {
                return {
                    status: 'uninitialized',
                    healthy: false
                };
            }

            const stats = await this.getStats();
            this.stats.lastHealthCheck = new Date().toISOString();

            return {
                status: 'healthy',
                healthy: true,
                totalVectors: stats.totalVectors,
                dimension: stats.dimension,
                lastCheck: this.stats.lastHealthCheck
            };

        } catch (error) {
            logger.error('Health check failed', {
                error: error.message
            });

            return {
                status: 'unhealthy',
                healthy: false,
                error: error.message,
                lastCheck: this.stats.lastHealthCheck
            };
        }
    }

    /**
     * Test the connection and basic operations
     * @returns {Promise<boolean>} - True if test passes
     */
    async testConnection() {
        try {
            logger.info('Testing Vector DB connection...');

            await this.initialize();
            const health = await this.healthCheck();

            if (!health.healthy) {
                throw new Error('Health check failed');
            }

            logger.info('Vector DB connection test successful', {
                totalVectors: health.totalVectors,
                dimension: health.dimension
            });

            return true;

        } catch (error) {
            logger.error('Vector DB connection test failed', {
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    /**
     * Validate documents before upsert
     * @private
     */
    _validateDocuments(documents) {
        if (!Array.isArray(documents) || documents.length === 0) {
            throw new Error('Documents must be a non-empty array');
        }

        const expectedDim = this.config.dimensions;

        for (let i = 0; i < documents.length; i++) {
            const doc = documents[i];

            if (!doc.id) {
                throw new Error(`Document at index ${i} missing id`);
            }

            if (!Array.isArray(doc.values)) {
                throw new Error(`Document ${doc.id} missing values array`);
            }

            if (doc.values.length !== expectedDim) {
                throw new Error(
                    `Document ${doc.id} has wrong dimension: ` +
                    `got ${doc.values.length}, expected ${expectedDim}`
                );
            }

            if (doc.values.some(v => !Number.isFinite(v))) {
                throw new Error(`Document ${doc.id} contains invalid values`);
            }

            if (!doc.metadata || typeof doc.metadata !== 'object') {
                logger.warn(`Document ${doc.id} missing metadata`);
            }
        }
    }

    /**
     * Validate query vector
     * @private
     */
    _validateQueryVector(vector) {
        const expectedDim = this.config.dimensions;

        if (!Array.isArray(vector)) {
            throw new Error('Query vector must be an array');
        }

        if (vector.length !== expectedDim) {
            throw new Error(
                `Query vector has wrong dimension: ` +
                `got ${vector.length}, expected ${expectedDim}`
            );
        }

        if (vector.some(v => !Number.isFinite(v))) {
            throw new Error('Query vector contains invalid values');
        }
    }

    /**
     * Normalize metadata filter for Pinecone
     * @private
     */
    _normalizeFilter(filter) {
        // Ensure filter follows Pinecone's format
        // Pinecone uses operators like $in, $eq, $ne, $gt, etc.
        return filter;
    }

    /**
     * Create batches from array
     * @private
     */
    _createBatches(items, batchSize) {
        const batches = [];
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }
        return batches;
    }

    /**
     * Delay helper
     * @private
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get operation statistics
     */
    getOperationStats() {
        return {
            ...this.stats,
            errorRate: this.stats.upserts + this.stats.queries > 0
                ? ((this.stats.errors / (this.stats.upserts + this.stats.queries)) * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    /**
     * Reset operation statistics
     */
    resetStats() {
        this.stats = {
            upserts: 0,
            queries: 0,
            deletes: 0,
            errors: 0,
            lastHealthCheck: this.stats.lastHealthCheck
        };
        logger.info('Statistics reset');
    }

    /**
     * Close connection (cleanup)
     */
    async close() {
        this.client = null;
        this.index = null;
        this.isInitialized = false;
        logger.info('Vector DB connection closed');
    }
}

// Export singleton instance
const vectorDBService = new VectorDBService();

export default vectorDBService;