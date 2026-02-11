// const { Pinecone } = require('@pinecone-database/pinecone');
// const ragConfig = require('../config/rag.config');
import { Pinecone } from '@pinecone-database/pinecone';
import ragConfig from '../config/rag.config.js';

/**
 * Vector Database Service
 * Handles all interactions with Pinecone vector database
 * Provides semantic search, document storage, and retrieval
 */

class VectorDBService {
    constructor() {
        this.client = null;
        this.index = null;
        this.isInitialized = false;
        this.config = ragConfig.vectorDB.pinecone;
    }

    /**
     * Initialize Pinecone connection
     */
    async initialize() {
        try {
            if (this.isInitialized) {
                console.log('✅ Vector DB already initialized');
                return;
            }

            console.log('🔄 Initializing Pinecone vector database...');

            // Validate configuration
            if (!this.config.apiKey) {
                throw new Error('PINECONE_API_KEY or PINECON_API_KEY not found in environment');
            }

            // Initialize Pinecone client
            this.client = new Pinecone({
                apiKey: this.config.apiKey
            });

            // Get or create index
            await this.ensureIndexExists();

            // Get index reference
            this.index = this.client.index(this.config.indexName);

            this.isInitialized = true;
            console.log(`✅ Connected to Pinecone index: ${this.config.indexName}`);
        } catch (error) {
            console.error('❌ Failed to initialize Vector DB:', error.message);
            throw error;
        }
    }

    /**
     * Ensure the index exists, create if it doesn't
     */
    async ensureIndexExists() {
        try {
            // List existing indexes
            const { indexes } = await this.client.listIndexes();
            const indexExists = indexes?.some(idx => idx.name === this.config.indexName);

            if (!indexExists) {
                console.log(`📝 Creating new index: ${this.config.indexName}`);

                await this.client.createIndex({
                    name: this.config.indexName,
                    dimension: this.config.dimension,
                    metric: this.config.metric,
                    spec: {
                        serverless: {
                            cloud: this.config.cloud,
                            region: this.config.region
                        }
                    }
                });

                console.log('⏳ Waiting for index to be ready...');

                // Wait for index to be ready (can take up to 60 seconds)
                let ready = false;
                let attempts = 0;
                const maxAttempts = 60;

                while (!ready && attempts < maxAttempts) {
                    const description = await this.client.describeIndex(this.config.indexName);
                    ready = description.status?.ready;

                    if (!ready) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        attempts++;
                    }
                }

                if (!ready) {
                    throw new Error('Index creation timed out');
                }

                console.log('✅ Index created and ready');
            } else {
                console.log(`✅ Index ${this.config.indexName} already exists`);
            }
        } catch (error) {
            console.error('❌ Error ensuring index exists:', error.message);
            throw error;
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

            if (!Array.isArray(documents) || documents.length === 0) {
                throw new Error('Documents must be a non-empty array');
            }

            console.log(`📤 Upserting ${documents.length} documents to namespace: ${namespace}`);

            // Batch upsert (Pinecone has limits, so we batch)
            const batchSize = 100;
            const batches = [];

            for (let i = 0; i < documents.length; i += batchSize) {
                batches.push(documents.slice(i, i + batchSize));
            }

            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                console.log(`Upserting batch ${i + 1}/${batches.length} (${batch.length} vectors)`);

                await this.index.namespace(namespace).upsert(batch);
            }

            console.log(`✅ Successfully upserted ${documents.length} documents`);
        } catch (error) {
            console.error('❌ Error upserting documents:', error.message);
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

            if (!Array.isArray(queryVector) || queryVector.length !== this.config.dimension) {
                throw new Error(`Query vector must be ${this.config.dimension}D array`);
            }

            const queryRequest = {
                vector: queryVector,
                topK,
                includeMetadata: ragConfig.retrieval.includeMetadata,
                includeValues: ragConfig.retrieval.includeValues
            };

            // Add filter if provided
            if (Object.keys(filter).length > 0) {
                queryRequest.filter = filter;
            }

            const results = await this.index.namespace(namespace).query(queryRequest);

            // Filter by minimum score
            const filteredResults = results.matches.filter(
                match => match.score >= ragConfig.retrieval.minScore
            );

            console.log(`🔍 Found ${filteredResults.length}/${results.matches.length} results above threshold`);

            return filteredResults;
        } catch (error) {
            console.error('❌ Error searching similar documents:', error.message);
            throw error;
        }
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

            console.log(`🗑️ Deleting ${ids.length} documents from namespace: ${namespace}`);

            await this.index.namespace(namespace).deleteMany(ids);

            console.log('✅ Documents deleted successfully');
        } catch (error) {
            console.error('❌ Error deleting documents:', error.message);
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

            console.log(`🗑️ Clearing namespace: ${namespace}`);

            await this.index.namespace(namespace).deleteAll();

            console.log('✅ Namespace cleared successfully');
        } catch (error) {
            console.error('❌ Error clearing namespace:', error.message);
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
                namespace: stats.namespaces?.[namespace] || { recordCount: 0 }
            };
        } catch (error) {
            console.error('❌ Error getting stats:', error.message);
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

            const results = await this.index.namespace(namespace).fetch(ids);
            return results.records || {};
        } catch (error) {
            console.error('❌ Error fetching documents:', error.message);
            throw error;
        }
    }

    /**
     * Test the connection and basic operations
     * @returns {Promise<boolean>} - True if test passes
     */
    async testConnection() {
        try {
            console.log('🧪 Testing Vector DB connection...');

            await this.initialize();
            const stats = await this.getStats();

            console.log('✅ Connection test successful');
            console.log(`📊 Index has ${stats.totalVectors} vectors`);

            return true;
        } catch (error) {
            console.error('❌ Connection test failed:', error.message);
            return false;
        }
    }

    /**
     * Close connection (cleanup)
     */
    async close() {
        this.client = null;
        this.index = null;
        this.isInitialized = false;
        console.log('✅ Vector DB connection closed');
    }
}

// Export singleton instance
const vectorDBService = new VectorDBService();

export default vectorDBService;
