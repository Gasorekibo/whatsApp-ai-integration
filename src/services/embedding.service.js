import { GoogleGenerativeAI } from '@google/generative-ai';
import NodeCache from 'node-cache';
import ragConfig from '../config/rag.config.js';

/**
 * Embedding Service
 * Generates vector embeddings using Google's Gemini API
 * Includes caching for performance optimization
 */

class EmbeddingService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = ragConfig.embedding.model;
        this.cache = ragConfig.cache.enabled
            ? new NodeCache({
                stdTTL: ragConfig.cache.ttl,
                checkperiod: ragConfig.cache.checkPeriod,
                maxKeys: ragConfig.cache.maxKeys
            })
            : null;

        console.log('✅ Embedding service initialized with Gemini', this.model);
    }

    /**
     * Generate embedding for a single text
     * @param {string} text - Text to embed
     * @param {string} taskType - 'RETRIEVAL_DOCUMENT' or 'RETRIEVAL_QUERY'
     * @returns {Promise<number[]>} - Embedding vector (768 dimensions)
     */
    async generateEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
        try {
            if (!text || text.trim().length === 0) {
                throw new Error('Text cannot be empty');
            }

            // Check cache first
            const cacheKey = `${taskType}:${text}`;
            if (this.cache) {
                const cached = this.cache.get(cacheKey);
                if (cached) {
                    console.log('📦 Cache hit for embedding');
                    return cached;
                }
            }

            const model = this.genAI.getGenerativeModel({ model: this.model });
            const result = await model.embedContent({
                content: { parts: [{ text }] },
                taskType
            });

            const embedding = result.embedding.values;

            // Validate embedding
            if (!Array.isArray(embedding) || embedding.length !== ragConfig.embedding.dimensions) {
                throw new Error(`Invalid embedding dimension: ${embedding?.length}. Expected ${ragConfig.embedding.dimensions}`);
            }

            // Cache the result
            if (this.cache) {
                this.cache.set(cacheKey, embedding);
            }

            return embedding;
        } catch (error) {
            console.error('❌ Error generating embedding:', error.message);
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

            const batchSize = ragConfig.embedding.batchSize;
            const batches = [];

            // Split into batches
            for (let i = 0; i < texts.length; i += batchSize) {
                batches.push(texts.slice(i, i + batchSize));
            }

            console.log(`🔄 Processing ${texts.length} texts in ${batches.length} batches`);

            const allEmbeddings = [];

            // Process each batch
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                console.log(`Processing batch ${i + 1}/${batches.length} (${batch.length} texts)`);

                const batchPromises = batch.map(text => this.generateEmbedding(text, taskType));
                const batchEmbeddings = await Promise.all(batchPromises);

                allEmbeddings.push(...batchEmbeddings);

                // Rate limiting: wait 1 second between batches
                if (i < batches.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            console.log(`✅ Generated ${allEmbeddings.length} embeddings successfully`);
            return allEmbeddings;
        } catch (error) {
            console.error('❌ Error in batch embedding:', error.message);
            throw error;
        }
    }

    /**
     * Get cached embedding if available
     * @param {string} text - Text to check
     * @param {string} taskType - Task type
     * @returns {number[] | null} - Cached embedding or null
     */
    getCachedEmbedding(text, taskType = 'RETRIEVAL_DOCUMENT') {
        if (!this.cache) return null;
        const cacheKey = `${taskType}:${text}`;
        return this.cache.get(cacheKey) || null;
    }

    /**
     * Clear the embedding cache
     */
    clearCache() {
        if (this.cache) {
            this.cache.flushAll();
            console.log('🗑️ Embedding cache cleared');
        }
    }

    /**
     * Get cache statistics
     * @returns {object} - Cache stats
     */
    getCacheStats() {
        if (!this.cache) {
            return { enabled: false };
        }

        return {
            enabled: true,
            keys: this.cache.keys().length,
            hits: this.cache.getStats().hits,
            misses: this.cache.getStats().misses,
            size: this.cache.keys().length
        };
    }

    /**
     * Test the embedding service
     * @returns {Promise<boolean>} - True if test passes
     */
    async testConnection() {
        try {
            console.log('🧪 Testing embedding service...');
            const testText = 'This is a test sentence for embedding generation.';
            const embedding = await this.generateEmbedding(testText, 'RETRIEVAL_QUERY');

            console.log(`✅ Test successful! Generated ${embedding.length}D embedding`);
            return true;
        } catch (error) {
            console.error('❌ Test failed:', error.message);
            return false;
        }
    }
}

// Export singleton instance
const embeddingService = new EmbeddingService();

export default embeddingService;

