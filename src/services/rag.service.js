import embeddingService from './embedding.service.js';
import vectorDBService from './vector-db.service.js';
import documentProcessor from './document-processor.service.js';
import ragConfig from '../config/rag.config.js';

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

            // Initialize vector DB and test connection
            await vectorDBService.initialize();
            await embeddingService.testConnection();

            this.initialized = true;
            console.log('✅ RAG service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize RAG service:', error.message);
            throw error;
        }
    }

    /**
     * Classify user intent from message using LLM
     * @param {string} message - User message
     * @returns {Promise<string>} - Intent type (booking, service_inquiry, faq, general)
     */
    async classifyIntent(message) {
        try {
            // Simple check for very short greetings to save API calls
            const greetingPatterns = /^(muraho|hello|hi|hey|hola|bonjour|salut)$/i;
            if (greetingPatterns.test(message.trim())) {
                return 'general';
            }

            const model = embeddingService.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            const prompt = `
                Classify the following user message into one of these categories:
                - booking: The user wants to schedule an appointment, meeting, or consultation.
                - service_inquiry: The user is asking about specific services, what we offer, or technical capabilities.
                - faq: The user is asking about pricing, location, how things work, or general company info.
                - general: Greetings, generic questions, or anything else.

                User Message: "${message}"

                Respond with ONLY the category name.
            `;

            const result = await model.generateContent(prompt);
            const response = await result.response;
            const intent = response.text().trim().toLowerCase();

            // Validate the result
            const validIntents = ['booking', 'service_inquiry', 'faq', 'general'];
            return validIntents.includes(intent) ? intent : 'general';
        } catch (error) {
            console.warn('⚠️ LLM Classification failed, falling back to general:', error.message);
            return 'general';
        }
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
            const intent = await this.classifyIntent(userMessage);
            const language = this.detectLanguage(userMessage);
            const retrievalTopK = topK || ragConfig.retrieval.topK;

            // console.log(`🔍 Intent: ${intent}, Language: ${language}`);

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

            // Log details for debugging
            if (results.length > 0) {
                console.log(`🔍 RAG retrieved ${results.length} docs for: "${userMessage?.slice(0, 30)}..."`);
                results.forEach((match, i) => {
                    console.log(`  [${i + 1}] Score: ${match.score.toFixed(4)} | Type: ${match.metadata?.type} | ID: ${match.id}`);
                });
            } else {
                console.log(`⚠️ RAG found no relevant docs for: "${userMessage?.slice(0, 30)}..."`);
            }

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
            console.error('❌ RAG Retrieval Error:', error.message);

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

        return parts.join('\n');
    }

    /**
     * Get minimal base instruction
     * @param {string} language - Target language
     * @returns {string} - Base instruction
     */
    getBaseInstruction(language) {
        return `You are a warm, professional AI assistant for Moyo Tech Solutions, a leading IT consultancy in Rwanda.

        CORE RULES:
        - Respond in ${language === 'rw' ? 'Kinyarwanda' : language === 'fr' ? 'French' : 'English'}
        - Be friendly but brief and to-the-point
        - Keep responses under 3 sentences unless needed
        - Use ONLY information provided in the RELEVANT INFORMATION section above
        - If a service is mentioned in RELEVANT INFORMATION, use its details strictly
        - For bookings, ONLY use dates from the AVAILABLE CONSULTATION SLOTS list
        - Never invent dates, times, or service details
        - Maintain a natural, professional tone`;
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

export default ragService;
