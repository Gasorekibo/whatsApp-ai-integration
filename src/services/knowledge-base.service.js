import vectorDBService from './vector-db.service.js';
import embeddingService from './embedding.service.js';
import documentProcessor from './document-processor.service.js';
import googleSheets from '../utils/googlesheets.js';
import { syncServicesMicrosoftHandler } from '../utils/syncServicesMicrosoftHandler.js';
import confluence from '../utils/confluence.js';
import ragConfig from '../config/rag.config.js';
import logger from '../logger/logger.js';

/**
 * Enhanced Knowledge Base Management Service
 * Manages the complete lifecycle of the knowledge base:
 * - Intelligent syncing from multiple sources
 * - Incremental updates and version tracking
 * - Batch processing with progress tracking
 * - Comprehensive error handling
 * 
 * @version 2.0.0
 */

class KnowledgeBaseService {
    constructor() {
        this.initialized = false;
        this.syncInProgress = false;
        this.lastSync = {
            googleSheets: null,
            microsoftExcel: null,
            confluence: null
        };
    }

    /**
     * Initialize the service
     */
    async initialize() {
        try {
            if (this.initialized) {
                return;
            }

            logger.info('Initializing Knowledge Base service...');

            await vectorDBService.initialize();
            
            this.initialized = true;

            logger.info('Knowledge Base service initialized');

        } catch (error) {
            logger.error('Failed to initialize KB service', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Sync services from Google Sheets
     * @returns {Promise<number>} - Number of services synced
     */
    async syncServicesFromSheets() {
        try {
            logger.info('Syncing services from Google Sheets');

            const services = await googleSheets.getActiveServices();

            if (!services || services.length === 0) {
                logger.warn('No services found in Google Sheets');
                return 0;
            }

            logger.info('Retrieved services from Google Sheets', {
                count: services.length
            });

            const result = await this.upsertServices(services, 'google-sheets');

            this.lastSync.googleSheets = new Date().toISOString();

            logger.info('Google Sheets sync complete', {
                services: services.length,
                chunks: result.success,
                failed: result.failed
            });

            return result.success;

        } catch (error) {
            logger.error('Error syncing from Google Sheets', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Sync services from Microsoft Excel
     * @returns {Promise<number>} - Number of services synced
     */
    async syncServicesFromMicrosoft() {
        try {
            logger.info('Syncing services from Microsoft Excel');

            const services = await syncServicesMicrosoftHandler();

            if (!services || services.length === 0) {
                logger.warn('No services found in Microsoft Excel');
                return 0;
            }

            logger.info('Retrieved services from Microsoft Excel', {
                count: services.length
            });

            const result = await this.upsertServices(services, 'microsoft-excel');

            this.lastSync.microsoftExcel = new Date().toISOString();

            logger.info('Microsoft Excel sync complete', {
                services: services.length,
                chunks: result.success,
                failed: result.failed
            });

            return result.success;

        } catch (error) {
            logger.error('Error syncing from Microsoft Excel', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Sync data from Confluence
     * @param {object} options - Sync options
     * @returns {Promise<number>} - Number of chunks synced
     */
    async syncFromConfluence(options = {}) {
        try {
            logger.info('Syncing data from Confluence');

            const confluenceConfig = ragConfig.sync.confluence;
            
            // Validate configuration
            if (!confluenceConfig.baseUrl || !confluenceConfig.apiToken) {
                throw new Error('Confluence configuration incomplete');
            }

            const pages = await confluence.fetchPages(
                options.spaceKey || confluenceConfig.spaceKey,
                options.maxPages || confluenceConfig.maxPages
            );

            if (!pages || pages.length === 0) {
                logger.warn('No pages found in Confluence');
                return 0;
            }

            logger.info('Retrieved pages from Confluence', {
                count: pages.length,
                spaceKey: options.spaceKey || confluenceConfig.spaceKey
            });

            // Process pages in batches
            const allChunks = [];
            const batchSize = 10; // Process 10 pages at a time
            
            for (let i = 0; i < pages.length; i += batchSize) {
                const pageBatch = pages.slice(i, i + batchSize);
                
                logger.debug(`Processing Confluence batch ${Math.floor(i / batchSize) + 1}`, {
                    pages: pageBatch.length
                });

                const batchChunks = documentProcessor.batchProcess(pageBatch, 'confluence');
                allChunks.push(...batchChunks);

                // Progress update
                if ((i + batchSize) % 50 === 0) {
                    logger.info('Confluence sync progress', {
                        processed: Math.min(i + batchSize, pages.length),
                        total: pages.length,
                        chunks: allChunks.length
                    });
                }
            }

            if (allChunks.length === 0) {
                logger.warn('No valid content extracted from Confluence pages');
                return 0;
            }

            logger.info('Generating embeddings for Confluence chunks', {
                chunks: allChunks.length
            });

            // Generate embeddings in batches
            const texts = allChunks.map(chunk => chunk.content);
            const embeddings = await embeddingService.generateBatchEmbeddings(
                texts,
                ragConfig.embedding.taskType
            );

            // Prepare documents for upsert
            const documents = allChunks.map((chunk, index) => ({
                id: chunk.id,
                values: embeddings[index],
                metadata: {
                    ...chunk.metadata,
                    content: chunk.content,
                    source: 'confluence',
                    synced_at: new Date().toISOString()
                }
            }));

            // Upsert to vector DB
            const result = await vectorDBService.upsertDocuments(documents, 'default');

            this.lastSync.confluence = new Date().toISOString();

            logger.info('Confluence sync complete', {
                pages: pages.length,
                chunks: result.success,
                failed: result.failed
            });

            return result.success;

        } catch (error) {
            logger.error('Error syncing from Confluence', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Upsert services into vector database
     * @param {Array} services - Service objects
     * @param {string} source - Data source name
     * @returns {Promise<object>} - Result summary
     */
    async upsertServices(services, source) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            logger.info('Processing services for upsert', {
                count: services.length,
                source
            });

            // Process services into chunks
            const chunks = documentProcessor.processServices(services);

            if (chunks.length === 0) {
                logger.warn('No chunks generated from services');
                return { success: 0, failed: 0 };
            }

            logger.info('Generating embeddings', { chunks: chunks.length });

            // Generate embeddings
            const texts = chunks.map(chunk => chunk.content);
            const embeddings = await embeddingService.generateBatchEmbeddings(
                texts,
                ragConfig.embedding.taskType
            );

            // Prepare documents for upsert
            const documents = chunks.map((chunk, index) => ({
                id: chunk.id,
                values: embeddings[index],
                metadata: {
                    ...chunk.metadata,
                    content: chunk.content,
                    source,
                    synced_at: new Date().toISOString()
                }
            }));

            logger.info('Upserting documents to vector DB', {
                count: documents.length
            });

            // Upsert to vector DB
            const result = await vectorDBService.upsertDocuments(documents, 'default');

            logger.info('Service upsert complete', {
                source,
                success: result.success,
                failed: result.failed
            });

            return result;

        } catch (error) {
            logger.error('Error upserting services', {
                error: error.message,
                stack: error.stack,
                source
            });
            throw error;
        }
    }

    /**
     * Add company information documents
     * @param {Array} documents - Company info documents [{id, title, content, language}]
     * @returns {Promise<number>} - Number of chunks added
     */
    async addCompanyInfo(documents) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            logger.info('Adding company info documents', {
                count: documents.length
            });

            const allChunks = [];

            for (const doc of documents) {
                const chunks = documentProcessor.processMarkdown(
                    doc.content,
                    'company_info',
                    {
                        id: doc.id,
                        title: doc.title,
                        language: doc.language || 'en'
                    }
                );

                allChunks.push(...chunks);
            }

            if (allChunks.length === 0) {
                logger.warn('No chunks generated from company info');
                return 0;
            }

            logger.info('Generating embeddings', { chunks: allChunks.length });

            // Generate embeddings
            const texts = allChunks.map(chunk => chunk.content);
            const embeddings = await embeddingService.generateBatchEmbeddings(
                texts,
                ragConfig.embedding.taskType
            );

            // Prepare for upsert
            const vectorDocs = allChunks.map((chunk, index) => ({
                id: chunk.id,
                values: embeddings[index],
                metadata: {
                    ...chunk.metadata,
                    content: chunk.content,
                    synced_at: new Date().toISOString()
                }
            }));

            await vectorDBService.upsertDocuments(vectorDocs, 'default');

            logger.info('Company info added successfully', {
                documents: documents.length,
                chunks: vectorDocs.length
            });

            return vectorDocs.length;

        } catch (error) {
            logger.error('Error adding company info', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Add FAQ documents
     * @param {Array} faqs - FAQ objects {question, answer, category}
     * @param {string} language - Language code
     * @returns {Promise<number>} - Number of FAQs added
     */
    async addFAQs(faqs, language = 'en') {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            logger.info('Adding FAQs', { count: faqs.length, language });

            const chunks = documentProcessor.processFAQs(faqs, { language });

            if (chunks.length === 0) {
                logger.warn('No chunks generated from FAQs');
                return 0;
            }

            // Generate embeddings
            const texts = chunks.map(chunk => chunk.content);
            const embeddings = await embeddingService.generateBatchEmbeddings(
                texts,
                ragConfig.embedding.taskType
            );

            // Prepare for upsert
            const vectorDocs = chunks.map((chunk, index) => ({
                id: chunk.id,
                values: embeddings[index],
                metadata: {
                    ...chunk.metadata,
                    content: chunk.content,
                    synced_at: new Date().toISOString()
                }
            }));

            await vectorDBService.upsertDocuments(vectorDocs, 'default');

            logger.info('FAQs added successfully', {
                faqs: faqs.length,
                chunks: vectorDocs.length
            });

            return vectorDocs.length;

        } catch (error) {
            logger.error('Error adding FAQs', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Add booking rules
     * @param {object} bookingInfo - Booking information
     * @returns {Promise<number>} - Number of rules added
     */
    async addBookingRules(bookingInfo) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            logger.info('Adding booking rules');

            const chunks = documentProcessor.processBookingRules(bookingInfo);

            if (chunks.length === 0) {
                logger.warn('No chunks generated from booking rules');
                return 0;
            }

            // Generate embeddings
            const texts = chunks.map(chunk => chunk.content);
            const embeddings = await embeddingService.generateBatchEmbeddings(
                texts,
                ragConfig.embedding.taskType
            );

            // Prepare for upsert
            const vectorDocs = chunks.map((chunk, index) => ({
                id: chunk.id,
                values: embeddings[index],
                metadata: {
                    ...chunk.metadata,
                    content: chunk.content,
                    synced_at: new Date().toISOString()
                }
            }));

            await vectorDBService.upsertDocuments(vectorDocs, 'default');

            logger.info('Booking rules added successfully', {
                chunks: vectorDocs.length
            });

            return vectorDocs.length;

        } catch (error) {
            logger.error('Error adding booking rules', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Delete documents by IDs
     * @param {string[]} ids - Document IDs to delete
     */
    async deleteDocuments(ids) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            await vectorDBService.deleteDocuments(ids, 'default');
            
            logger.info('Documents deleted', { count: ids.length });

        } catch (error) {
            logger.error('Error deleting documents', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Clear entire knowledge base
     */
    async clearKnowledgeBase() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            logger.warn('Clearing entire knowledge base');
            
            await vectorDBService.deleteNamespace('default');
            
            // Reset sync timestamps
            this.lastSync = {
                googleSheets: null,
                microsoftExcel: null,
                confluence: null
            };

            logger.info('Knowledge base cleared');

        } catch (error) {
            logger.error('Error clearing knowledge base', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Rebuild entire knowledge base from all sources
     * @param {object} options - Rebuild options
     * @returns {Promise<object>} - Summary of rebuild
     */
    async rebuildIndex(options = {}) {
        try {
            if (this.syncInProgress) {
                throw new Error('Sync already in progress');
            }

            this.syncInProgress = true;

            logger.info('Starting knowledge base rebuild', { options });

            const summary = {
                services: 0,
                companyInfo: 0,
                faqs: 0,
                bookingRules: 0,
                confluence: 0,
                errors: [],
                startTime: new Date().toISOString()
            };

            // Clear existing data unless incremental
            if (!options.incremental) {
                await this.clearKnowledgeBase();
            }

            // Sync from configured sources
            const syncTasks = [];

            if (ragConfig.sync.sources.googleSheets) {
                syncTasks.push(
                    this.syncServicesFromSheets()
                        .then(count => { summary.services += count; })
                        .catch(error => {
                            summary.errors.push(`Google Sheets: ${error.message}`);
                        })
                );
            }

            if (ragConfig.sync.sources.microsoftExcel) {
                syncTasks.push(
                    this.syncServicesFromMicrosoft()
                        .then(count => { summary.services += count; })
                        .catch(error => {
                            summary.errors.push(`Microsoft Excel: ${error.message}`);
                        })
                );
            }

            if (ragConfig.sync.sources.confluence) {
                syncTasks.push(
                    this.syncFromConfluence()
                        .then(count => { summary.confluence = count; })
                        .catch(error => {
                            summary.errors.push(`Confluence: ${error.message}`);
                        })
                );
            }

            // Wait for all syncs to complete
            await Promise.all(syncTasks);

            summary.endTime = new Date().toISOString();
            summary.duration = new Date(summary.endTime) - new Date(summary.startTime);

            this.syncInProgress = false;

            logger.info('Knowledge base rebuild complete', { summary });

            return summary;

        } catch (error) {
            this.syncInProgress = false;
            
            logger.error('Error rebuilding index', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Sync all sources incrementally
     * @returns {Promise<object>} - Sync summary
     */
    async syncAll() {
        return await this.rebuildIndex({ incremental: true });
    }

    /**
     * Get knowledge base statistics
     * @returns {Promise<object>} - KB stats
     */
    async getStats() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            const [vectorStats, embeddingStats, processorStats] = await Promise.all([
                vectorDBService.getStats(),
                Promise.resolve(embeddingService.getStats()),
                Promise.resolve(documentProcessor.getStats())
            ]);

            return {
                totalDocuments: vectorStats.totalVectors,
                namespaces: vectorStats.namespaces,
                indexFullness: vectorStats.indexFullness,
                dimension: vectorStats.dimension,
                lastSync: this.lastSync,
                syncInProgress: this.syncInProgress,
                embedding: embeddingStats,
                processor: processorStats,
                operations: vectorStats.operationStats
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
     * Health check
     * @returns {Promise<object>} - Health status
     */
    async healthCheck() {
        try {
            const [vectorHealth, embeddingHealth] = await Promise.all([
                vectorDBService.healthCheck(),
                embeddingService.testConnection()
            ]);

            const healthy = vectorHealth.healthy && embeddingHealth;

            return {
                status: healthy ? 'healthy' : 'degraded',
                healthy,
                vector: vectorHealth,
                embedding: { healthy: embeddingHealth },
                initialized: this.initialized,
                syncInProgress: this.syncInProgress,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            return {
                status: 'unhealthy',
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Get sync status
     */
    getSyncStatus() {
        return {
            inProgress: this.syncInProgress,
            lastSync: this.lastSync,
            sources: ragConfig.sync.sources
        };
    }
}

// Export singleton instance
const knowledgeBaseService = new KnowledgeBaseService();

export default knowledgeBaseService;