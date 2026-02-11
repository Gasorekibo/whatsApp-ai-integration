import vectorDBService from './vector-db.service.js';
import embeddingService from './embedding.service.js';
import documentProcessor from './document-processor.service.js';
import { getActiveServices } from '../utils/googlesheets.js';
import { syncServicesMicrosoftHandler } from '../utils/syncServicesMicrosoftHandler.js';
import ragConfig from '../config/rag.config.js';

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

            console.log('✅ Knowledge Base service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize KB service:', error.message);
            throw error;
        }
    }

    /**
     * Sync services from Google Sheets
     * @returns {Promise<number>} - Number of services synced
     */
    async syncServicesFromSheets() {
        try {
            console.log('🔄 Syncing services from Google Sheets...');

            const services = await getActiveServices();

            if (!services || services.length === 0) {
                console.warn('⚠️ No services found in Google Sheets');
                return 0;
            }

            await this.upsertServices(services, 'google-sheets');

            console.log(`✅ Synced ${services.length} services from Google Sheets`);
            return services.length;
        } catch (error) {
            console.error('❌ Error syncing from Google Sheets:', error.message);
            throw error;
        }
    }

    /**
     * Sync services from Microsoft Excel
     * @returns {Promise<number>} - Number of services synced
     */
    async syncServicesFromMicrosoft() {
        try {
            console.log('🔄 Syncing services from Microsoft Excel...');

            const services = await syncServicesMicrosoftHandler();

            if (!services || services.length === 0) {
                console.warn('⚠️ No services found in Microsoft Excel');
                return 0;
            }

            const upsertedServices = await this.upsertServices(services, 'microsoft-excel');

            console.log(`✅ Synced ${upsertedServices.length} services from Microsoft Excel`);
            console.log('upsertedServices',upsertedServices);
            return upsertedServices.length;
        } catch (error) {
            console.error('❌ Error syncing from Microsoft Excel:', error.message);
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

            console.log(`✅ Upserted ${documents.length} service documents`);
        } catch (error) {
            console.error('❌ Error upserting services:', error.message);
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

            console.log(`📝 Adding ${documents.length} company info documents...`);

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

            console.log(`✅ Added ${vectorDocs.length} company info chunks`);
        } catch (error) {
            console.error('❌ Error adding company info:', error.message);
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

            console.log(`📝 Adding ${faqs.length} FAQs...`);

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

            console.log(`✅ Added ${vectorDocs.length} FAQ documents`);
        } catch (error) {
            console.error('❌ Error adding FAQs:', error.message);
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

            console.log('📝 Adding booking rules...');

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

            console.log(`✅ Added ${vectorDocs.length} booking rule documents`);
        } catch (error) {
            console.error('❌ Error adding booking rules:', error.message);
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
            console.log(`✅ Deleted ${ids.length} documents`);
        } catch (error) {
            console.error('❌ Error deleting documents:', error.message);
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

            console.log('🗑️ Clearing entire knowledge base...');
            await vectorDBService.deleteNamespace('default');
            console.log('✅ Knowledge base cleared');
        } catch (error) {
            console.error('❌ Error clearing knowledge base:', error.message);
            throw error;
        }
    }

    /**
     * Rebuild entire knowledge base from all sources
     * @returns {Promise<object>} - Summary of rebuild
     */
    async rebuildIndex() {
        try {
            console.log('🔄 Rebuilding knowledge base...');
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

            console.log('✅ Knowledge base rebuild complete:', summary);
            return summary;
        } catch (error) {
            console.error('❌ Error rebuilding index:', error.message);
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
            console.error('❌ Error getting stats:', error.message);
            throw error;
        }
    }
}

// Export singleton instance
const knowledgeBaseService = new KnowledgeBaseService();

export default knowledgeBaseService;
