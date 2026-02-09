const embeddingService = require('./embedding.service');
const vectorDBService = require('./vector-db.service');
const documentProcessor = require('./document-processor.service');
const ragConfig = require('../config/rag.config');

/**
 * RAG (Retrieval-Augmented Generation) Service
 * Orchestrates the complete RAG workflow:
 * - Query classification
 * - Context retrieval
 * - Prompt augmentation
 */

class RAGService {
    constructor() {
        this.initialized = false;
    }

    /**
     * Initialize RAG service
     */
    async initialize() {
        try {
            if (this.initialized) {
                return;
            }

            console.log('🚀 Initializing RAG service...');

            //Initialize vector DB
            await vectorDBService.initialize();

            // Test embedding service
            await embeddingService.testConnection();

            this.initialized = true;
            console.log('✅ RAG service initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize RAG service:', error.message);
            throw error;
        }
    }

    /**
     * Classify user intent from message
     * @param {string} message - User message
     * @returns {string} - Intent type
     */
    classifyIntent(message) {
        const lowerMsg = message.toLowerCase();

        // Service inquiry patterns
        const servicePatterns = [
            /what.*services?/i,
            /tell.*about/i,
            /interested in/i,
            /what.*do.*offer/i,
            /services?.*list/i,
            /ese.*mutanga/i, // Kinyarwanda: what do you offer
            /quels.*services/i // French: what services
        ];

        // Booking patterns
        const bookingPatterns = [
            /book/i,
            /appointment/i,
            /schedule/i,
            /meeting/i,
            /consultation/i,
            /time.*slot/i,
            /available/i,
            /monday|tuesday|wednesday|thursday|friday|saturday|sunday/i,
            /deposit/i,
            /payment/i
        ];

        // FAQ/General patterns
        const faqPatterns = [
            /how.*work/i,
            /what.*is/i,
            /why/i,
            /when/i,
            /where/i,
            /price|cost|pricing/i,
            /location/i,
            /contact/i
        ];

        // Check patterns in order of priority
        if (bookingPatterns.some(pattern => pattern.test(lowerMsg))) {
            return 'booking';
        }

        if (servicePatterns.some(pattern => pattern.test(lowerMsg))) {
            return 'service_inquiry';
        }

        if (faqPatterns.some(pattern => pattern.test(lowerMsg))) {
            return 'faq';
        }

        return 'general';
    }

    /**
     * Detect language from message
     * @param {string} message - User message
     * @returns {string} - Language code (en, fr, rw)
     */
    detectLanguage(message) {
        // Simple language detection based on keywords
        const kinyarwandaPatterns = [/muraho/i, /ese/i, /amakuru/i, /mwaramutse/i];
        const frenchPatterns = [/bonjour/i, /salut/i, /quels/i, /quel/i, /comment/i];

        if (kinyarwandaPatterns.some(p => p.test(message))) {
            return 'rw';
        }

        if (frenchPatterns.some(p => p.test(message))) {
            return 'fr';
        }

        return 'en';
    }

    /**
     * Retrieve relevant context for user message
     * @param {string} userMessage - User's message
     * @param {Array} conversationHistory - Previous messages
     * @param {number} topK - Number of results to retrieve
     * @returns {Promise<object>} - Retrieved context and metadata
     */
    async retrieveContext(userMessage, conversationHistory = [], topK = null) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Classify intent and detect language
            const intent = this.classifyIntent(userMessage);
            const language = this.detectLanguage(userMessage);
            const retrievalTopK = topK || ragConfig.retrieval.topK;

            console.log(`🔍 Intent: ${intent}, Language: ${language}`);

            // Generate query embedding
            const queryEmbedding = await embeddingService.generateEmbedding(
                userMessage,
                ragConfig.embedding.queryTaskType
            );

            // Build metadata filter based on intent and language
            const filter = this.buildMetadataFilter(intent, language);

            // Search for similar documents
            const results = await vectorDBService.searchSimilar(
                queryEmbedding,
                retrievalTopK,
                filter
            );

            // Extract and format context
            const context = this.formatContext(results);

            return {
                intent,
                language,
                context,
                results,
                relevantDocs: results.length
            };
        } catch (error) {
            console.error('❌ Error retrieving context:', error.message);

            // Return minimal context on error
            return {
                intent: 'general',
                language: 'en',
                context: '',
                results: [],
                relevantDocs: 0,
                error: error.message
            };
        }
    }

    /**
     * Build metadata filter based on intent and language
     * @param {string} intent - Classified intent
     * @param {string} language - Detected language
     * @returns {object} - Metadata filter
     */
    buildMetadataFilter(intent, language) {
        const filter = {};

        // Filter by intent-related types
        if (intent === 'service_inquiry') {
            filter.type = { $in: ['service', 'company_info'] };
        } else if (intent === 'booking') {
            filter.type = { $in: ['booking_rule', 'service'] };
        } else if (intent === 'faq') {
            filter.type = { $in: ['faq', 'company_info'] };
        }

        // Filter by language if not English (English is default/fallback)
        if (language !== 'en') {
            filter.language = { $in: [language, 'en'] };
        }

        return filter;
    }

    /**
     * Format retrieved context for prompt
     * @param {Array} results - Search results
     * @returns {string} - Formatted context
     */
    formatContext(results) {
        if (!results || results.length === 0) {
            return '';
        }

        const contextParts = [];

        // Group by type for better organization
        const byType = {};
        for (const result of results) {
            const type = result.metadata?.type || 'general';
            if (!byType[type]) {
                byType[type] = [];
            }
            byType[type].push(result);
        }

        // Format each type section
        for (const [type, docs] of Object.entries(byType)) {
            const typeLabel = this.getTypeLabel(type);
            contextParts.push(`${typeLabel}:`);

            for (const doc of docs) {
                contextParts.push(doc.metadata?.content || doc.id);
            }

            contextParts.push(''); // Empty line between sections
        }

        return contextParts.join('\\n').trim();
    }

    /**
     * Get human-readable label for document type
     * @param {string} type - Document type
     * @returns {string} - Type label
     */
    getTypeLabel(type) {
        const labels = {
            service: 'AVAILABLE SERVICES',
            company_info: 'COMPANY INFORMATION',
            booking_rule: 'BOOKING GUIDELINES',
            faq: 'FREQUENTLY ASKED QUESTIONS',
            general: 'GENERAL INFORMATION'
        };

        return labels[type] || type.toUpperCase();
    }

    /**
     * Build augmented prompt with retrieved context
     * @param {object} retrievedData - Data from retrieveContext
     * @param {string} userMessage - Current user message
     * @param {object} dynamicData - Dynamic data (slots, date, etc.)
     * @returns {string} - Complete augmented prompt
     */
    buildAugmentedPrompt(retrievedData, userMessage, dynamicData = {}) {
        const parts = [];

        // Base instruction (minimal)
        parts.push(this.getBaseInstruction(retrievedData.language));
        parts.push('');

        // Retrieved context
        if (retrievedData.context) {
            parts.push('RELEVANT INFORMATION:');
            parts.push(retrievedData.context);
            parts.push('');
        }

        // Dynamic data (always fresh)
        if (dynamicData.availableSlots) {
            parts.push('AVAILABLE CONSULTATION SLOTS:');
            parts.push(dynamicData.availableSlots);
            parts.push('');
        }

        if (dynamicData.currentDate) {
            parts.push(`Current date/time: ${dynamicData.currentDate}`);
            parts.push('');
        }

        if (dynamicData.depositInfo) {
            parts.push('DEPOSIT REQUIREMENT:');
            parts.push(dynamicData.depositInfo);
            parts.push('');
        }

        return parts.join('\\n');
    }

    /**
     * Get minimal base instruction
     * @param {string} language - Target language
     * @returns {string} - Base instruction
     */
    getBaseInstruction(language) {
        return `You are a professional AI assistant for Moyo Tech Solutions, an IT consultancy in Rwanda.

CORE RULES:
- Respond in ${language === 'rw' ? 'Kinyarwanda' : language === 'fr' ? 'French' : 'English'}
- Be concise and helpful (max 3 sentences unless needed)
- Use ONLY information provided in the context above
- For bookings, verify slots from AVAILABLE_SLOTS list only
- Never invent dates, times, or service details

OUTPUT COMMANDS:
- To show services list: Output ===SHOW_SERVICES===
- To initiate payment: Output ===INITIATE_PAYMENT=== followed by JSON
- To save inquiry: Output ===SAVE_REQUEST=== followed by JSON`;
    }

    /**
     * Get cache statistics
     * @returns {object} - Cache stats
     */
    getCacheStats() {
        return embeddingService.getCacheStats();
    }

    /**
     * Get vector DB statistics
     * @returns {Promise<object>} - DB stats
     */
    async getVectorDBStats() {
        return await vectorDBService.getStats();
    }
}

// Export singleton instance
const ragService = new RAGService();

module.exports = ragService;
