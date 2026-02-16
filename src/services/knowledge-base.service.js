import vectorDBService from './vector-db.service.js';
import embeddingService from './embedding.service.js';
import documentProcessor from './document-processor.service.js';
import googleSheets from '../utils/googlesheets.js';
import { syncServicesMicrosoftHandler } from '../utils/syncServicesMicrosoftHandler.js';
import ragConfig from '../config/rag.config.js';
import logger from '../logger/logger.js';
import confluence from '../utils/confluence.js';

/**
 * Knowledge Base Management Service
 * Manages the lifecycle of the knowledge base:
 * - Syncing from external sources
 * - Adding/updating/deleting documents
 * - Rebuilding the index
 */

class KnowledgeBaseService {
    constructor() {
        this.initialized = false;
    }

    /**
     * Initialize the service
     */
    async initialize() {
        try {
            if (this.initialized) {
                return;
            }

            await vectorDBService.initialize();
            this.initialized = true;

            logger.info('Knowledge Base service initialized');
        } catch (error) {
            logger.error('Failed to initialize KB service', { error: error.message });
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

            const upsertedDocs = await this.upsertServices(services, 'google-sheets');

            const count = upsertedDocs?.length || 0;
            logger.info(`Synced ${count} services from Google Sheets`);
            return count;
        } catch (error) {
            logger.error('Error syncing from Google Sheets', { error: error.message });
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

            const upsertedDocs = await this.upsertServices(services, 'microsoft-excel');

            const count = upsertedDocs?.length || 0;
            logger.info(`Synced ${count} services from Microsoft Excel`);
            return count;
        } catch (error) {
            logger.error('Error syncing from Microsoft Excel', { error: error.message });
            throw error;
        }
    }

    /**
     * Sync data from Confluence
     * @returns {Promise<number>} - Number of pages synced
     */
    async syncFromConfluence() {
        try {
            logger.info('Syncing data from Confluence');

            const pages = await confluence.fetchPages();

            if (!pages || pages.length === 0) {
                logger.warn('No pages found in Confluence');
                return 0;
            }

            // Process pages using document processor
            // We use 'confluence' type which triggers processConfluencePage in batchProcess
            const chunks = documentProcessor.batchProcess(pages, 'confluence');
            console.log('Confluence chunks', chunks)
            if (chunks.length === 0) {
                logger.warn('No valid content extracted from Confluence pages');
                return 0;
            }

            // Generate embeddings
            const texts = chunks.map(chunk => chunk.content);
            const embeddings = await embeddingService.generateBatchEmbeddings(
                texts,
                ragConfig.embedding.taskType
            );

            // Prepare for upsert
            const documents = chunks.map((chunk, index) => ({
                id: chunk.id,
                values: embeddings[index],
                metadata: {
                    ...chunk.metadata,
                    content: chunk.content, // Store content in metadata for retrieval
                    synced_at: new Date().toISOString()
                }
            }));
            // Upsert to vector DB
            await vectorDBService.upsertDocuments(documents, 'default'); // Using default namespace

            logger.info(`Synced ${documents.length} chunks from Confluence`);
            return documents.length;

        } catch (error) {
            logger.error('Error syncing from Confluence', { error: error.message });
            throw error;
        }
    }

    /**
     * Upsert services into vector database
     * @param {Array} services - Service objects
     * @param {string} source - Data source name
     */
    async upsertServices(services, source) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Process services into chunks
            const chunks = documentProcessor.processServices(services);

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
                    content: chunk.content, // Store content in metadata for retrieval
                    source,
                    synced_at: new Date().toISOString()
                }
            }));

            // Upsert to vector DB
            await vectorDBService.upsertDocuments(documents, 'default');

            logger.info(`Upserted ${documents.length} service documents from ${source}`);
            return documents;
        } catch (error) {
            logger.error('Error upserting services', { error: error.message });
            throw error;
        }
    }

    /**
     * Add company information documents
     * @param {Array} documents - Company info documents
     */
    async addCompanyInfo(documents) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            logger.info(`Adding ${documents.length} company info documents`);

            const processedDocs = [];

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

                processedDocs.push(...chunks);
            }

            // Generate embeddings
            const texts = processedDocs.map(chunk => chunk.content);
            const embeddings = await embeddingService.generateBatchEmbeddings(
                texts,
                ragConfig.embedding.taskType
            );

            // Prepare for upsert
            const vectorDocs = processedDocs.map((chunk, index) => ({
                id: chunk.id,
                values: embeddings[index],
                metadata: {
                    ...chunk.metadata,
                    content: chunk.content
                }
            }));

            await vectorDBService.upsertDocuments(vectorDocs, 'default');

            logger.info(`Added ${vectorDocs.length} company info chunks`);
        } catch (error) {
            logger.error('Error adding company info', { error: error.message });
            throw error;
        }
    }

    /**
     * Add FAQ documents
     * @param {Array} faqs - FAQ objects {question, answer, category}
     */
    async addFAQs(faqs, language = 'en') {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            logger.info(`Adding ${faqs.length} FAQs`);

            const chunks = documentProcessor.processFAQs(faqs, { language });

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
                    content: chunk.content
                }
            }));

            await vectorDBService.upsertDocuments(vectorDocs, 'default');

            logger.info(`Added ${vectorDocs.length} FAQ documents`);
        } catch (error) {
            logger.error('Error adding FAQs', { error: error.message });
            throw error;
        }
    }

    /**
     * Add booking rules
     * @param {object} bookingInfo - Booking information
     */
    async addBookingRules(bookingInfo) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            logger.info('Adding booking rules');

            const chunks = documentProcessor.processBookingRules(bookingInfo);

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
                    content: chunk.content
                }
            }));

            await vectorDBService.upsertDocuments(vectorDocs, 'default');

            logger.info(`Added ${vectorDocs.length} booking rule documents`);
        } catch (error) {
            logger.error('Error adding booking rules', { error: error.message });
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
            logger.info(`Deleted ${ids.length} documents`);
        } catch (error) {
            logger.error('Error deleting documents', { error: error.message });
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
            logger.info('Knowledge base cleared');
        } catch (error) {
            logger.error('Error clearing knowledge base', { error: error.message });
            throw error;
        }
    }

    /**
     * Rebuild entire knowledge base from all sources
     * @returns {Promise<object>} - Summary of rebuild
     */
    async rebuildIndex() {
        try {
            logger.info('Rebuilding knowledge base');
            const summary = {
                services: 0,
                companyInfo: 0,
                faqs: 0,
                bookingRules: 0,
                errors: []
            };

            // Clear existing data
            await this.clearKnowledgeBase();

            // Sync services from configured sources
            if (ragConfig.sync.sources.googleSheets) {
                try {
                    summary.services += await this.syncServicesFromSheets();
                } catch (error) {
                    summary.errors.push(`Google Sheets: ${error.message}`);
                }
            }

            if (ragConfig.sync.sources.microsoftExcel) {
                try {
                    summary.services += await this.syncServicesFromMicrosoft();
                } catch (error) {
                    summary.errors.push(`Microsoft Excel: ${error.message}`);
                }
            }

            logger.info('Knowledge base rebuild complete', { summary });
            return summary;
        } catch (error) {
            logger.error('Error rebuilding index', { error: error.message });
            throw error;
        }
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

            const vectorStats = await vectorDBService.getStats();
            const cacheStats = embeddingService.getCacheStats();

            return {
                totalDocuments: vectorStats.totalVectors,
                namespaces: vectorStats.namespaces,
                cache: cacheStats
            };
        } catch (error) {
            logger.error('Error getting stats', { error: error.message });
            throw error;
        }
    }
}

// Export singleton instance
const knowledgeBaseService = new KnowledgeBaseService();

export default knowledgeBaseService;
