import embeddingService from './embedding.service.js';
import vectorDBService from './vector-db.service.js';
import documentProcessor from './document-processor.service.js';
import ragConfig from '../config/rag.config.js';
import logger from '../logger/logger.js';
import { getCacheConfig, getIntentConfig, getLanguageConfig } from '../utils/config-compatibility.helper.js';

/**
 * Enhanced RAG (Retrieval-Augmented Generation) Service
 * Orchestrates the complete RAG workflow:
 * - Query preprocessing and classification
 * - Context retrieval with relevance scoring
 * - Prompt augmentation and optimization
 * 
 * @version 2.0.0
 */

class RAGService {
    constructor() {
        this.initialized = false;

        // Cache for intent classification using compatibility helper
        const cacheConfig = getCacheConfig(ragConfig, 'intent');
        this.intentCache = cacheConfig.enabled ? new Map() : null;
        this.intentCacheConfig = cacheConfig;

        // Get intent and language configs
        this.intentConfig = getIntentConfig(ragConfig);
        this.languageConfig = getLanguageConfig(ragConfig);
    }

    /**
     * Initialize RAG service
     */
    async initialize() {
        try {
            if (this.initialized) {
                return;
            }

            logger.info('Initializing RAG service...');

            // Initialize dependencies
            await Promise.all([
                vectorDBService.initialize(),
                embeddingService.testConnection()
            ]);

            this.initialized = true;
            logger.info('RAG service initialized successfully');

        } catch (error) {
            logger.error('Failed to initialize RAG service', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Classify user intent and detect language from message using LLM
     * @param {string} message - User message
     * @param {Array} history - Conversation history for context
     * @returns {Promise<object>} - { intent, language }
     */
    async classifyQuery(message, history = []) {
        try {
            const normalizedMessage = message.trim().toLowerCase();

            // Check intent cache first
            if (this.intentCache?.has(normalizedMessage)) {
                logger.debug('Intent cache hit');
                const cached = this.intentCache.get(normalizedMessage);
                return cached;
            }

            // Quick pattern matching for common intents (always 'general' for now)
            const quickIntent = this._quickIntentCheck(normalizedMessage);
            if (quickIntent) {
                const result = { intent: quickIntent, language: this.detectLanguage(message) };
                this._cacheIntent(normalizedMessage, result);
                return result;
            }

            // Keyword-based intent detection
            const keywordIntent = this._detectIntentByKeywords(message);
            if (keywordIntent) {
                const result = { intent: keywordIntent, language: this.detectLanguage(message) };
                this._cacheIntent(normalizedMessage, result);
                return result;
            }

            // Use LLM for combined classification and language detection
            const classification = await this._classifyWithLLM(message, history);
            this._cacheIntent(normalizedMessage, classification);

            return classification;

        } catch (error) {
            logger.warn('Query classification failed, falling back', {
                error: error.message
            });
            return { intent: 'general', language: this.detectLanguage(message) };
        }
    }

    /**
     * Quick intent check using patterns
     * @private
     */
    _quickIntentCheck(message) {
        const patterns = this.intentConfig.quickPatterns;

        for (const [intent, pattern] of Object.entries(patterns)) {
            if (pattern.test(message)) {
                logger.debug('Quick intent match', { intent });
                return 'general'; // Most quick patterns are general
            }
        }

        return null;
    }

    /**
     * Detect intent by keywords
     * @private
     */
    _detectIntentByKeywords(message) {
        const keywords = this.intentConfig.keywords;
        const messageLower = message.toLowerCase();

        let bestIntent = null;
        let maxMatches = 0;

        for (const [intent, intentKeywords] of Object.entries(keywords)) {
            const matches = intentKeywords.filter(kw =>
                messageLower.includes(kw.toLowerCase())
            ).length;

            if (matches > maxMatches) {
                maxMatches = matches;
                bestIntent = intent;
            }
        }

        if (maxMatches > 0) {
            logger.debug('Keyword-based intent', {
                intent: bestIntent,
                matches: maxMatches
            });
            return bestIntent;
        }

        return null;
    }

    /**
     * Classify intent and language using LLM
     * @private
     */
    async _classifyWithLLM(message, history = []) {
        try {
            const model = embeddingService.genAI.getGenerativeModel({
                model: this.intentConfig.llm.model || "gemini-2.5-flash"
            });

            const categories = this.intentConfig.categories.join(', ');

            // Format history for context
            const historyContext = history.slice(-3).map(h =>
                `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`
            ).join('\n');

            const prompt = `Classify the following user message for a professional IT consultancy (Moyo Tech Solutions).
Categories: ${categories}
Supported Languages: en (English), fr (French), rw (Kinyarwanda), kis (Kiswahili), de (German), sw (Kiswahili)

${historyContext ? `Conversation Context (last 3 messages):\n${historyContext}\n` : ''}

User Message: "${message}"

Rules:
- booking: Scheduling, appointment requests, or consultation booking
- service_inquiry: Questions about offered services or technical capabilities
- faq: Pricing, location, hours, how things work
- payment: Payment methods, deposits, or fees
- support: Technical issues or help requests
- general: Greetings, small talk, or unclear intent

Respond ONLY with a JSON object. NO conversational text of any kind.
Example: {"intent": "general", "language": "en"}

JSON Output:`;

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0,
                    maxOutputTokens: 100,
                    responseMimeType: "application/json"
                }
            });

            const responseText = result.response.text();

            // Extract JSON block even more robustly
            let parsed;
            try {
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                const jsonToParse = jsonMatch ? jsonMatch[0] : responseText;
                parsed = JSON.parse(jsonToParse.trim());
            } catch (pErr) {
                logger.warn('LLM JSON parse error, using pattern fallback', { response: responseText });
                // Use history-based detection only — if history is empty we don't know the language yet
                const lang = history.length > 0 ? this.detectLanguage(message, history) : null;
                return { intent: 'general', language: lang };
            }

            // Validate response
            const intent = parsed.intent?.toLowerCase();
            const language = parsed.language?.toLowerCase();

            return {
                intent: this.intentConfig.categories.includes(intent) ? intent : 'general',
                language: ['en', 'fr', 'rw', 'kis', 'de', 'sw'].includes(language) ? language : null
            };
        } catch (error) {
            logger.error('LLM classification error', { error: error.message });
            const lang = history.length > 0 ? this.detectLanguage(message, history) : null;
            return { intent: 'general', language: lang };
        }
    }

    /**
     * Cache intent classification
     * @private
     */
    _cacheIntent(message, intent) {
        if (!this.intentCache) return;

        // Limit cache size
        if (this.intentCache.size >= this.intentCacheConfig.maxKeys) {
            const firstKey = this.intentCache.keys().next().value;
            this.intentCache.delete(firstKey);
        }

        this.intentCache.set(message, intent);
    }

    /**
     * Detect language from message (Pattern-based fallback)
     * @param {string} message - User message
     * @param {Array} history - Optional history for context
     * @returns {string} - Language code (en, fr, rw)
     */
    detectLanguage(message, history = []) {
        const patterns = this.languageConfig.patterns;
        const messageLower = message.toLowerCase();

        // 1. Check current message against patterns
        for (const [lang, regexList] of Object.entries(patterns)) {
            for (const regex of regexList) {
                if (regex.test(messageLower)) {
                    logger.debug('Language detected via patterns', { language: lang });
                    return lang;
                }
            }
        }

        // 2. Fallback to history — only read user messages to avoid AI response language bleeding back in
        if (history.length > 0) {
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'user' && history[i].language && history[i].language !== 'en') {
                    return history[i].language;
                }
            }
            // Second pass: accept any user language tag including 'en'
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'user' && history[i].language) {
                    return history[i].language;
                }
            }
        }

        // 3. Default language
        return this.languageConfig.defaultLanguage || 'en';
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
            if (!this.isInitialized) {
                await this.initialize();
            }

            // Validate query
            if (!this._validateQuery(userMessage)) {
                throw new Error('Invalid query');
            }

            const startTime = Date.now();

            // Classify intent and detect language (Unified LLM call)
            const classification = await this.classifyQuery(userMessage, conversationHistory);
            const { intent, language } = classification;

            logger.debug('Query classified', {
                intent,
                language,
                query: userMessage.substring(0, 50)
            });

            // Determine optimal topK based on intent
            const retrievalTopK = topK || this._getOptimalTopK(intent);

            // Preprocess query if needed
            const processedQuery = this._preprocessQuery(userMessage);

            // Translate query to English for retrieval — documents are stored in English only.
            // The original message is still used for the AI response language.
            const queryForEmbedding = language !== 'en'
                ? await this._translateQueryToEnglish(processedQuery, language)
                : processedQuery;

            // Generate query embedding
            const queryEmbedding = await embeddingService.generateEmbedding(
                queryForEmbedding,
                ragConfig.embedding.queryTaskType
            );

            // Build metadata filter based on intent and language
            const filter = this.buildMetadataFilter(intent, language);

            logger.debug('Searching vector DB', {
                topK: retrievalTopK,
                filter
            });

            // Search for similar documents
            const results = await vectorDBService.searchSimilar(
                queryEmbedding,
                retrievalTopK,
                filter
            );

            // Post-process and rank results
            const rankedResults = this._rankResults(results, intent, userMessage);

            // Extract and format context
            const context = this.formatContext(rankedResults);

            const latency = Date.now() - startTime;

            // Log retrieval details
            this._logRetrieval(userMessage, intent, rankedResults, latency);

            return {
                intent,
                language,
                context,
                results: rankedResults,
                relevantDocs: rankedResults.length,
                latency,
                metadata: {
                    topK: retrievalTopK,
                    filter,
                    avgScore: this._calculateAvgScore(rankedResults)
                }
            };

        } catch (error) {
            logger.error('RAG retrieval error', {
                error: error.message,
                stack: error.stack,
                query: userMessage?.substring(0, 50)
            });

            // Return fallback context — preserve detected language so the prompt still uses the right language
            return this._getFallbackContext(error, userMessage, conversationHistory);
        }
    }

    /**
     * Validate query
     * @private
     */
    _validateQuery(query) {
        if (!query || typeof query !== 'string') {
            logger.warn('Invalid query type');
            return false;
        }

        const trimmed = query.trim();

        if (trimmed.length < ragConfig?.query?.minQueryLength) {
            logger.warn('Query too short', { length: trimmed.length });
            return false;
        }

        if (trimmed.length > ragConfig?.query?.maxQueryLength) {
            logger.warn('Query too long', { length: trimmed.length });
            return false;
        }

        return true;
    }

    /**
     * Get optimal topK based on intent
     * @private
     */
    _getOptimalTopK(intent) {
        // Adjust retrieval amount based on intent
        const intentTopK = {
            booking: 3, // Focused retrieval
            service_inquiry: 5, // Standard
            faq: 4, // Specific answers
            payment: 3, // Focused
            support: 6, // Broader context
            general: 4
        };

        return intentTopK[intent] || ragConfig.retrieval.topK;
    }

    /**
     * Preprocess query
     * @private
     */
    _preprocessQuery(query) {
        let processed = query.trim();

        if (ragConfig?.query?.preprocessing?.lowercase) {
            // Don't lowercase for embeddings - they handle case
            // Just normalize whitespace
            processed = processed.replace(/\s+/g, ' ');
        }

        return processed;
    }

    /**
     * Rank results based on intent and relevance
     * @private
     */
    _rankResults(results, intent, query) {
        if (results.length === 0) return results;

        // Apply priority-based ranking
        const ranked = results.map(result => {
            let adjustedScore = result.score;

            // Boost score based on document priority
            const priority = result.metadata?.priority || 5;
            const priorityBoost = (priority / 10) * 0.1; // Max 10% boost
            adjustedScore += priorityBoost;

            // Intent-specific boosting
            if (intent === 'booking' && result.metadata?.type === 'booking_rule') {
                adjustedScore += 0.15;
            } else if (intent === 'service_inquiry' && result.metadata?.type === 'service') {
                adjustedScore += 0.1;
            } else if (intent === 'faq' && result.metadata?.type === 'faq') {
                adjustedScore += 0.12;
            }

            // Recency boost (if timestamp available)
            if (result.metadata?.updated_at) {
                const age = this._getDocumentAge(result.metadata.updated_at);
                if (age < 30) { // Less than 30 days old
                    adjustedScore += 0.05;
                }
            }

            return {
                ...result,
                originalScore: result.score,
                adjustedScore: Math.min(adjustedScore, 1.0) // Cap at 1.0
            };
        });

        // Sort by adjusted score
        ranked.sort((a, b) => b.adjustedScore - a.adjustedScore);

        // Limit to maxContextChunks
        const maxChunks = ragConfig.retrieval.maxContextChunks;
        return ranked.slice(0, maxChunks);
    }

    /**
     * Get document age in days
     * @private
     */
    _getDocumentAge(timestamp) {
        try {
            const docDate = new Date(timestamp);
            const now = new Date();
            const diffMs = now - docDate;
            return Math.floor(diffMs / (1000 * 60 * 60 * 24));
        } catch {
            return Infinity;
        }
    }

    /**
     * Calculate average score
     * @private
     */
    _calculateAvgScore(results) {
        if (results.length === 0) return 0;

        const sum = results.reduce((acc, r) => acc + r.score, 0);
        return (sum / results.length).toFixed(3);
    }

    /**
     * Log retrieval details
     * @private
     */
    _logRetrieval(query, intent, results, latency) {
        if (results.length > 0) {
            logger.info('RAG retrieval successful', {
                query: query.substring(0, 50),
                intent,
                retrieved: results.length,
                avgScore: this._calculateAvgScore(results),
                latency: `${latency}ms`,
                topResults: results.slice(0, 2).map(r => ({
                    id: r.id,
                    score: r.score.toFixed(3),
                    type: r.metadata?.type
                }))
            });
        } else {
            logger.warn('RAG found no relevant documents', {
                query: query.substring(0, 50),
                intent,
                latency: `${latency}ms`
            });
        }
    }

    /**
     * Build metadata filter based on intent and language
     * @param {string} intent - Classified intent
     * @param {string} language - Detected language
     * @returns {object} - Metadata filter
     */
    buildMetadataFilter(intent, _language) {
        const filter = {};

        // Map intent to document types
        const intentTypeMap = {
            booking: ['booking_rule', 'service'],
            service_inquiry: ['service', 'company_info'],
            faq: ['faq', 'company_info'],
            payment: ['booking_rule', 'faq'],
            support: ['faq', 'company_info', 'confluence'],
            general: [] // No type filter for general
        };

        const types = intentTypeMap[intent];

        if (types && types.length > 0) {
            // Pinecone filter format
            filter.type = { $in: types };
        }

        // All documents are stored in English — always retrieve English docs regardless of user's language.
        // Language filtering by user language would exclude all results since no non-English docs exist.
        filter.language = { $in: ['en'] };

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
        const byType = this._groupByType(results);

        // Format each type section
        for (const [type, docs] of Object.entries(byType)) {
            const typeLabel = this.getTypeLabel(type);
            contextParts.push(`\n${typeLabel}:`);

            docs.forEach((doc, index) => {
                const content = doc.metadata?.content || '';
                const title = doc.metadata?.title || '';

                // Include title if available
                if (title && type !== 'faq') {
                    contextParts.push(`\n${index + 1}. ${title}`);
                }

                contextParts.push(content);

                // Add separator between docs
                if (index < docs.length - 1) {
                    contextParts.push('---');
                }
            });
        }

        return contextParts.join('\n').trim();
    }

    /**
     * Group results by type
     * @private
     */
    _groupByType(results) {
        const byType = {};

        for (const result of results) {
            const type = result.metadata?.type || 'general';
            if (!byType[type]) {
                byType[type] = [];
            }
            byType[type].push(result);
        }

        return byType;
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
            confluence: 'KNOWLEDGE BASE',
            general: 'GENERAL INFORMATION'
        };

        return labels[type] || type.toUpperCase().replace('_', ' ');
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

        // Base instruction
        parts.push(this.getBaseInstruction(retrievedData.language, retrievedData.intent));
        parts.push('');

        // Retrieved context (most important)
        if (retrievedData.context) {
            parts.push('=== RELEVANT INFORMATION ===');
            parts.push(retrievedData.context);
            parts.push('');
        }

        // Dynamic data (always fresh)
        if (dynamicData.availableSlots) {
            parts.push('=== AVAILABLE CONSULTATION SLOTS ===');
            parts.push(dynamicData.availableSlots);
            parts.push('');
        }

        if (dynamicData.currentDate) {
            parts.push(`Current date/time: ${dynamicData.currentDate}`);
            parts.push('');
        }

        if (dynamicData.depositInfo) {
            parts.push('=== DEPOSIT REQUIREMENT ===');
            parts.push(dynamicData.depositInfo);
            parts.push('');
        }

        // Additional context hints
        if (retrievedData.relevantDocs === 0) {
            parts.push('Note: No specific information found in knowledge base for this query.');
            parts.push('');
        }

        return parts.join('\n');
    }

    /**
     * Get base instruction for the AI
     * @param {string} language - Target language
     * @param {string} intent - User intent
     * @returns {string} - Base instruction
     */
    getBaseInstruction(language, intent) {
        const langName = {
            en: 'English',
            fr: 'French',
            rw: 'Kinyarwanda',
            de: 'German',
            sw: 'Swahili',
            kis: 'Swahili'
        }[language] || null;

        const intentGuidance = {
            booking: 'Focus on booking process, available slots, and requirements.',
            service_inquiry: 'Provide detailed service information from the knowledge base.',
            faq: 'Answer common questions clearly and concisely.',
            payment: 'Explain payment terms, deposits, and pricing clearly.',
            support: 'Help resolve issues with clear, step-by-step guidance.',
            general: 'Be friendly and helpful.'
        }[intent] || 'Be helpful and professional.';

        const languageInstruction = langName
            ? `TARGET LANGUAGE: ${langName}\n- You MUST respond in ${langName}.\n- Only switch language if the user explicitly asks you to.`
            : `LANGUAGE: Detect the language of the user's message and respond in that exact language.\n- Supported: English, French, Kinyarwanda, German, Swahili.\n- Do NOT default to English — reply in whatever language the user wrote in.`;

        return `You are a professional AI assistant for Moyo Tech Solutions, a leading IT consultancy in Rwanda.

${languageInstruction}

CORE RULES:
- Use ONLY information from the "RELEVANT INFORMATION" section above
- Never invent or assume information not provided
- For bookings, use ONLY dates from "AVAILABLE CONSULTATION SLOTS"
- Keep responses concise (2-4 sentences) unless more detail is needed
- Be warm, professional, and customer-focused
- ${intentGuidance}

OUTPUT FORMAT:
ALWAYS return your response in the following JSON format:
{
  "language": "iso_code", // en, fr, rw, kis, de
  "reply": "your response text here"
}

Identify the language you actually used for the 'reply' in the 'language' field.
If information is not available, politely say so and offer to help with something else.`;
    }

    /**
     * Translate a non-English query to English for vector search.
     * The original query is preserved for the AI response language.
     * @param {string} query - User message in any language
     * @param {string} language - Detected language code
     * @returns {Promise<string>} - English translation, or original if translation fails
     * @private
     */
    async _translateQueryToEnglish(query, language) {
        try {
            const model = embeddingService.genAI.getGenerativeModel({
                model: 'gemini-2.0-flash'
            });

            const result = await model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{ text: `Translate the following message to English. Output ONLY the translated text, nothing else.\n\nMessage: ${query}` }]
                }],
                generationConfig: { temperature: 0, maxOutputTokens: 200 }
            });

            const translated = result.response.text().trim();
            logger.debug('Query translated for retrieval', { original: query, translated, language });
            return translated || query;
        } catch (err) {
            logger.warn('Query translation failed, using original', { error: err.message });
            return query;
        }
    }

    /**
     * Get fallback context on error
     * @private
     */
    _getFallbackContext(error, message = '', history = []) {
        const language = message ? this.detectLanguage(message, history) : 'en';
        return {
            intent: 'general',
            language,
            context: '',
            results: [],
            relevantDocs: 0,
            error: error.message,
            fallback: true
        };
    }

    /**
     * Get cache statistics
     * @returns {object} - Cache stats
     */
    getCacheStats() {
        return {
            embedding: embeddingService.getCacheStats(),
            intent: this.intentCache ? {
                enabled: true,
                size: this.intentCache.size,
                maxKeys: this.intentCacheConfig.maxKeys
            } : {
                enabled: false
            }
        };
    }

    /**
     * Get vector DB statistics
     * @returns {Promise<object>} - DB stats
     */
    async getVectorDBStats() {
        return await vectorDBService.getStats();
    }

    /**
     * Clear all caches
     */
    clearCaches() {
        embeddingService.clearCache();

        if (this.intentCache) {
            this.intentCache.clear();
        }

        logger.info('All RAG caches cleared');
    }

    /**
     * Get comprehensive service stats
     */
    async getServiceStats() {
        const [vectorStats, embeddingStats, cacheStats] = await Promise.all([
            this.getVectorDBStats(),
            Promise.resolve(embeddingService.getStats()),
            Promise.resolve(this.getCacheStats())
        ]);

        return {
            vector: vectorStats,
            embedding: embeddingStats,
            cache: cacheStats,
            initialized: this.initialized
        };
    }
}

// Export singleton instance
const ragService = new RAGService();

export default ragService;