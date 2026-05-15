import vectorDBService from './vector-db.service.js';
import embeddingService from './embedding.service.js';
import documentProcessor from './document-processor.service.js';
import googleSheets from '../utils/googlesheets.js';
import { syncServicesMicrosoftHandler } from '../utils/syncServicesMicrosoftHandler.js';
import confluence from '../utils/confluence.js';
import ragConfig from '../config/rag.config.js';
import logger from '../logger/logger.js';
import dbConfig from '../models/index.js';

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
    async syncServicesFromSheets(clientId = null, namespace = null) {
        try {
            namespace = namespace || clientId;
            if (!namespace) throw new Error('syncServicesFromSheets: namespace or clientId is required');
            logger.info('Syncing services from Google Sheets', { clientId, namespace });

            const services = await googleSheets.getAllServices(clientId);

            if (!services || services.length === 0) {
                logger.warn('No services found in Google Sheets');
                return 0;
            }

            logger.info('Retrieved services from Google Sheets', {
                count: services.length
            });

            await this._saveServicesToContentTable(services, clientId);
            const result = await this.upsertServices(services, 'google-sheets', namespace);

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
    async syncServicesFromMicrosoft(clientId = null, namespace = null) {
        try {
            namespace = namespace || clientId;
            if (!namespace) throw new Error('syncServicesFromMicrosoft: namespace or clientId is required');
            logger.info('Syncing services from Microsoft Excel', { clientId, namespace });

            let driveId = null;
            let itemId  = null;
            if (clientId) {
                const client = await dbConfig.db.Client.findOne({
                    where: { id: clientId },
                    attributes: ['microsoftDriveId', 'microsoftItemId']
                });
                driveId = client?.microsoftDriveId || null;
                itemId  = client?.microsoftItemId  || null;
            }

            const services = await syncServicesMicrosoftHandler(driveId, itemId);

            if (!services || services.length === 0) {
                logger.warn('No services found in Microsoft Excel');
                return 0;
            }

            logger.info('Retrieved services from Microsoft Excel', {
                count: services.length
            });

            await this._saveServicesToContentTable(services, clientId);
            const result = await this.upsertServices(services, 'microsoft-excel', namespace);

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
    async syncFromConfluence(options = {}, clientId = null) {
        try {
            logger.info('Syncing data from Confluence', { clientId });

            // Prefer per-client Confluence config stored in DB; fall back to env vars
            let clientConfluenceConfig = null;
            let clientNamespace        = options.namespace || null;
            if (clientId) {
                const client = await dbConfig.db.Client.findOne({
                    where: { id: clientId },
                    attributes: ['confluenceBaseUrl', 'confluenceEmail', 'confluenceApiToken', 'confluenceSpaceKey', 'pineconeIndex']
                });
                clientConfluenceConfig = client?.getConfluenceConfig?.() || null;
                clientNamespace        = clientNamespace || client?.pineconeIndex || clientId;
            }
            if (!clientNamespace) throw new Error('syncFromConfluence: namespace or clientId is required');

            const confluenceConfig = clientConfluenceConfig || ragConfig.sync.confluence;

            if (!confluenceConfig.baseUrl || !confluenceConfig.apiToken) {
                throw new Error('Confluence configuration incomplete — set credentials in the client edit form or .env');
            }

            const rawPages = await confluence.fetchPages(
                options.spaceKey || confluenceConfig.spaceKey,
                clientConfluenceConfig
            );

            if (!rawPages || rawPages.length === 0) {
                logger.warn('No pages found in Confluence');
                return 0;
            }

            // Skip template pages — they add noise and no client-facing knowledge
            const TEMPLATE_RE = /\btemplate\b/i;
            const pages = rawPages.filter(p => {
                if (TEMPLATE_RE.test(p.title || '')) {
                    logger.debug('Skipping Confluence template page', { pageId: p.id, title: p.title });
                    return false;
                }
                return true;
            });

            logger.info('Retrieved pages from Confluence', {
                total: rawPages.length,
                afterFilter: pages.length,
                skipped: rawPages.length - pages.length,
                spaceKey: options.spaceKey || confluenceConfig.spaceKey
            });

            if (pages.length === 0) {
                logger.warn('All pages were filtered out (templates)');
                return 0;
            }

            // Process pages in batches.
            // Before upserting each page's chunks, delete its previous vectors so
            // removed or renamed sections don't linger in the index.
            const allChunks = [];
            const batchSize = 10;

            for (let i = 0; i < pages.length; i += batchSize) {
                const pageBatch = pages.slice(i, i + batchSize);

                logger.debug(`Processing Confluence batch ${Math.floor(i / batchSize) + 1}`, {
                    pages: pageBatch.length
                });

                // Pre-delete existing vectors for each page in the batch so stale
                // sections from prior syncs don't remain in Pinecone.
                await Promise.all(
                    pageBatch.map(page =>
                        vectorDBService.deleteByMetadataFilter(
                            { page_id: { $eq: String(page.id) } },
                            clientNamespace
                        )
                    )
                );

                const batchChunks = await documentProcessor.batchProcess(pageBatch, 'confluence');
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

            // Upsert to vector DB — scoped to this client's Pinecone namespace
            const result = await vectorDBService.upsertDocuments(documents, clientNamespace);

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
    /**
     * Persist services into the PostgreSQL Content table so the WhatsApp
     * interactive service list reflects the synced data immediately.
     */
    async _saveServicesToContentTable(rawServices, clientId) {
        try {
            const getField = (obj, keys) => {
                for (const key of keys) {
                    if (obj[key] !== undefined && obj[key] !== '') return obj[key];
                    const found = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
                    if (found && obj[found] !== undefined && obj[found] !== '') return obj[found];
                }
                return null;
            };

            const services = rawServices.map((s, i) => ({
                id:      String(getField(s, ['id', 'service_id']) || `svc-${i + 1}`),
                name:    String(getField(s, ['name', 'service_name', 'title']) || `Service ${i + 1}`),
                short:   String(getField(s, ['short', 'name', 'service_name', 'title']) || `Service ${i + 1}`),
                details: String(getField(s, ['details', 'description', 'desc']) || ''),
                active:  ['true', '1', 'yes', true, 1].includes(getField(s, ['active', 'status']) ?? true)
            }));

            let content = await dbConfig.db.Content.findOne({ where: { clientId } });
            if (content) {
                content.services  = services;
                content.updatedAt = new Date();
                await content.save();
            } else {
                await dbConfig.db.Content.create({ clientId, services, updatedAt: new Date() });
            }

            logger.info('Services saved to Content table', { clientId, count: services.length });
        } catch (err) {
            logger.error('Failed to save services to Content table', { error: err.message, clientId });
        }
    }

    async upsertServices(services, source, namespace) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            if (!namespace) throw new Error('upsertServices: namespace is required');
            logger.info('Processing services for upsert', { count: services.length, source, namespace });

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

            // Upsert to vector DB — scoped to this client's Pinecone namespace
            const result = await vectorDBService.upsertDocuments(documents, namespace);

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
    async addCompanyInfo(documents, namespace) {
        try {
            if (!namespace) throw new Error('addCompanyInfo: namespace is required');
            if (!this.initialized) await this.initialize();

            logger.info('Adding company info documents', { count: documents.length, namespace });

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

            await vectorDBService.upsertDocuments(vectorDocs, namespace);

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
    async addFAQs(faqs, language = 'en', namespace) {
        try {
            if (!namespace) throw new Error('addFAQs: namespace is required');
            if (!this.initialized) await this.initialize();

            logger.info('Adding FAQs', { count: faqs.length, language, namespace });

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

            await vectorDBService.upsertDocuments(vectorDocs, namespace);

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
    async addBookingRules(bookingInfo, namespace) {
        try {
            if (!namespace) throw new Error('addBookingRules: namespace is required');
            if (!this.initialized) await this.initialize();

            logger.info('Adding booking rules', { namespace });

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

            await vectorDBService.upsertDocuments(vectorDocs, namespace);

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
    async deleteDocuments(ids, namespace) {
        try {
            if (!namespace) throw new Error('deleteDocuments: namespace is required');
            if (!this.initialized) await this.initialize();

            await vectorDBService.deleteDocuments(ids, namespace);
            
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
    async clearKnowledgeBase(namespace) {
        try {
            if (!namespace) throw new Error('clearKnowledgeBase: namespace is required');
            if (!this.initialized) await this.initialize();

            logger.warn('Clearing knowledge base', { namespace });

            await vectorDBService.deleteNamespace(namespace);
            
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
            if (!options.namespace && !options.clientId) {
                throw new Error('rebuildIndex: options.namespace or options.clientId is required');
            }
            if (this.syncInProgress) {
                throw new Error('Sync already in progress');
            }

            this.syncInProgress = true;
            const namespace = options.namespace || options.clientId;

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
                await this.clearKnowledgeBase(namespace);
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

    /**
     * Embed client_general_info (contacts, location, hours, FAQs) into Pinecone.
     * Uses deterministic IDs so re-syncing overwrites previous entries cleanly.
     *
     * @param {string|number} clientId
     * @param {string}        namespace - Client's Pinecone namespace
     * @returns {Promise<number>} Number of chunks successfully upserted
     */
    async syncGeneralInfo(clientId, namespace) {
        if (!namespace) throw new Error(`syncGeneralInfo: namespace is required (clientId=${clientId})`);
        if (!this.initialized) await this.initialize();

        const row = await dbConfig.db.ClientGeneralInfo.findOne({ where: { clientId } });
        if (!row) {
            logger.warn('syncGeneralInfo: no general info row found — skipping', { clientId });
            return 0;
        }

        const ts     = new Date().toISOString();
        const chunks = [];

        // ── Contact details chunk ───────────────────────────────────────────
        const contactLines = [];
        if (row.businessName) contactLines.push(`Business name: ${row.businessName}`);
        if (row.industry)     contactLines.push(`Industry: ${row.industry}`);
        if (row.description)  contactLines.push(`About: ${row.description}`);
        if (row.phone)        contactLines.push(`Phone: ${row.phone}`);
        if (row.whatsapp)     contactLines.push(`WhatsApp: ${row.whatsapp}`);
        if (row.email)        contactLines.push(`Email: ${row.email}`);
        if (row.website)      contactLines.push(`Website: ${row.website}`);

        if (contactLines.length > 0) {
            chunks.push({
                id:      `general-info-${clientId}-contact`,
                content: contactLines.join('\n'),
                metadata: { type: 'company_info', source: 'general_info', updated_at: ts }
            });
        }

        // ── Location chunk ──────────────────────────────────────────────────
        const locationLines = [];
        if (row.address)  locationLines.push(`Address: ${row.address}`);
        if (row.area)     locationLines.push(`Area: ${row.area}`);
        if (row.city)     locationLines.push(`City: ${row.city}`);
        if (row.mapsLink) locationLines.push(`Google Maps: ${row.mapsLink}`);

        if (locationLines.length > 0) {
            chunks.push({
                id:      `general-info-${clientId}-location`,
                content: locationLines.join('\n'),
                metadata: { type: 'company_info', source: 'general_info', updated_at: ts }
            });
        }

        // ── Hours chunk ─────────────────────────────────────────────────────
        const hoursText = this._formatHoursForEmbed(row.hours);
        if (hoursText) {
            chunks.push({
                id:      `general-info-${clientId}-hours`,
                content: hoursText,
                metadata: { type: 'company_info', source: 'general_info', updated_at: ts }
            });
        }

        // ── FAQ chunks (one per entry) ──────────────────────────────────────
        if (Array.isArray(row.faqs)) {
            row.faqs.forEach((faq, i) => {
                const q = faq.question || faq.q;
                const a = faq.answer   || faq.a;
                if (!q || !a) return;
                chunks.push({
                    id:      `general-info-${clientId}-faq-${i}`,
                    content: `Question: ${q}\nAnswer: ${a}`,
                    metadata: { type: 'faq', source: 'general_info', question: q, updated_at: ts }
                });
            });
        }

        if (chunks.length === 0) {
            logger.warn('syncGeneralInfo: nothing to embed', { clientId });
            return 0;
        }

        const texts      = chunks.map(c => c.content);
        const embeddings = await embeddingService.generateBatchEmbeddings(texts, ragConfig.embedding.taskType);

        const documents = chunks.map((chunk, i) => ({
            id:     chunk.id,
            values: embeddings[i],
            metadata: { ...chunk.metadata, content: chunk.content, synced_at: new Date().toISOString() }
        }));

        const result = await vectorDBService.upsertDocuments(documents, namespace);

        logger.info('syncGeneralInfo complete', { clientId, namespace, upserted: result.success });
        return result.success;
    }

    /**
     * Convert the hours object (admin structured or flat) to a readable text block.
     * Mirrors the logic in generalInquiryHandler so Pinecone and the DB handler agree.
     * @private
     */
    _formatHoursForEmbed(hours) {
        if (!hours || typeof hours !== 'object' || Object.keys(hours).length === 0) return null;

        const lines = ['Business hours:'];

        // Flat format: { mon_fri: "9am–5pm", saturday: "Closed", sunday: "Closed" }
        if (typeof hours.mon_fri === 'string') {
            const labels = { mon_fri: 'Mon–Fri', saturday: 'Saturday', sunday: 'Sunday' };
            ['mon_fri', 'saturday', 'sunday'].forEach(k => {
                if (hours[k]) lines.push(`  ${labels[k]}: ${hours[k]}`);
            });
            if (hours.notes) lines.push(`  Note: ${hours.notes}`);
            return lines.join('\n');
        }

        // Admin structured format: { monday: { status, from, to }, ... }
        const entries = Object.entries(hours);
        if (entries.every(([, d]) => d?.status === '24hrs')) return 'Business hours: Open 24/7';

        entries.forEach(([day, d]) => {
            const label = day.charAt(0).toUpperCase() + day.slice(1);
            if (!d || d.status === 'closed')  lines.push(`  ${label}: Closed`);
            else if (d.status === '24hrs')    lines.push(`  ${label}: Open 24 hours`);
            else if (d.from && d.to)         lines.push(`  ${label}: ${d.from}–${d.to}`);
            else                              lines.push(`  ${label}: Open`);
        });

        return lines.join('\n');
    }
}

// Export singleton instance
const knowledgeBaseService = new KnowledgeBaseService();

export default knowledgeBaseService;