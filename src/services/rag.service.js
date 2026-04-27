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
                return this.intentCache.get(normalizedMessage);
            }

            // 1. Detect language cheaply via patterns (no Gemini call needed for common languages)
            const patternLanguage = await this.detectCurrentLanguage(message);

            // 2. Quick pattern-based intent check
            const quickIntent = this._quickIntentCheck(normalizedMessage);
            if (quickIntent) {
                // Use history language override only if pattern matched non-English
                const language = patternLanguage !== 'en'
                    ? patternLanguage
                    : (await this._languageFromHistory(history)) || patternLanguage;
                const result = { intent: quickIntent, language };
                this._cacheIntent(normalizedMessage, result);
                return result;
            }

            // 3. Keyword-based intent detection
            const keywordIntent = this._detectIntentByKeywords(message);
            if (keywordIntent) {
                const language = patternLanguage !== 'en'
                    ? patternLanguage
                    : (await this._languageFromHistory(history)) || patternLanguage;
                const result = { intent: keywordIntent, language };
                this._cacheIntent(normalizedMessage, result);
                return result;
            }

            // 4. LLM classification — ONE call returns both intent + language (saves a second Gemini call)
            const classification = await this._classifyWithLLM(message, history);
            // Override language with pattern result if LLM returned 'en' but patterns say otherwise
            if (patternLanguage !== 'en') classification.language = patternLanguage;
            this._cacheIntent(normalizedMessage, classification);

            return classification;

        } catch (error) {
            logger.warn('Query classification failed, falling back', { error: error.message });
            const language = await this.detectCurrentLanguage(message);
            return { intent: 'general', language };
        }
    }

    /**
     * Get most recent non-null language from history without calling Gemini.
     * @private
     */
    _languageFromHistory(history = []) {
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].role === 'user' && history[i].language) return history[i].language;
        }
        return null;
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
                model: this.intentConfig.llm.model || "gemini-2.0-flash-lite"
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

            const result = await this._geminiWithRetry(
                () => model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0,
                        maxOutputTokens: 100,
                        responseMimeType: "application/json"
                    }
                }),
                'intent-classification'
            );

            const responseText = result.response.text();

            // Extract JSON block even more robustly
            let parsed;
            try {
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                const jsonToParse = jsonMatch ? jsonMatch[0] : responseText;
                parsed = JSON.parse(jsonToParse.trim());
            } catch (pErr) {
                logger.warn('LLM JSON parse error, using Gemini language detection fallback', { response: responseText });
                const lang = await this.detectLanguage(message, history);
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
            const lang = await this.detectLanguage(message, history);
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
     * Detect language from the current message only, ignoring conversation history.
     * Uses curated patterns (excluding English false-positives like 'ego', 'bite', 'none'),
     * then falls back to Gemini.
     * @param {string} message - User message
     * @returns {Promise<string>} - Language code (en, fr, rw, sw, de)
     */
    async detectCurrentLanguage(message) {
        // Curated patterns: unique vocabulary only, excluding words that also exist in English
        // (e.g., 'ego', 'bite', 'none', 'oya', 'muri' are excluded to avoid false positives)
        const safePatterns = {
            rw: [
                /\b(muraho|mwaramutse|mwiriwe|urakoze|amakuru|yego|nonese|ndashaka|natwe|nagufasha|mbwira)\b/i,
                /\b(niba|kugira|cyane|kumenya|izihe|tubigenze|nsubiza|mukinyarwanda|ntabwo|ndimo|kumva)\b/i,
                /\b(murakoze|ubujyanama|amasaha|byinshi|serivisi|nimero|amafaranga|kubika|kugisha)\b/i,
                /\b(mukoresheje|ifatabuguzi|murakaza|munsi|dushobora|cyumweru|urikuvuga|kuwakane|naboneka)\b/i,
                /\b(kwishyura|mafaranga|noneho|aribyiza|ndumva|mwaramukanye|waramutse|murifuza)\b/i,
            ],
            fr: [
                /\b(bonjour|salut|merci|au revoir|comment|est-ce|quel|pourquoi|combien|notre|votre)\b/i,
                /\b(suis|sont|fait|faire|peux|pouvez|veut|voulez|quand|dans|cette|dont|nous)\b/i,
            ],
            de: [/\b(hallo|guten|morgen|danke|bitte|nein|wie|was|wer|warum|können|möchte|ich|sie|wir)\b/i],
            sw: [/\b(habari|karibu|asante|ndiyo|hapana|samahani|tafadhali|ninaweza|nataka|huduma|sawa)\b/i]
        };

        for (const [lang, patterns] of Object.entries(safePatterns)) {
            if (patterns.some(pattern => pattern.test(message))) {
                logger.debug('Language detected via pattern', { language: lang });
                return lang;
            }
        }
        // Fall back to Gemini for messages that don't match any patterns
        return await this._detectLanguageWithGemini(message);
    }

    /**
     * Detect language from message.
     * First checks conversation history for a known language tag,
     * then calls Gemini to identify the language if history has no tag.
     * @param {string} message - User message
     * @param {Array} history - Optional history for context
     * @returns {Promise<string>} - Language code (en, fr, rw, sw, de)
     */
    async detectLanguage(message, history = []) {
        // 1. Look in history for a language tag (user messages only)
        if (history.length > 0) {
            // First pass: prefer non-English to avoid defaulting to English when user switched
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'user' && history[i].language && history[i].language !== 'en') {
                    logger.debug('Language found in history (non-English)', { language: history[i].language });
                    return history[i].language;
                }
            }
            // Second pass: accept any language including 'en'
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === 'user' && history[i].language) {
                    logger.debug('Language found in history', { language: history[i].language });
                    return history[i].language;
                }
            }
        }

        // 2. No language in history — call Gemini to detect from the current message
        return await this._detectLanguageWithGemini(message);
    }

    /**
     * Use Gemini to detect the language of a message.
     * @param {string} message - User message
     * @returns {Promise<string>} - Language code
     * @private
     */
    async _detectLanguageWithGemini(message) {
    try {
        // 1. Initialize the model with System Instructions
        const model = embeddingService.genAI.getGenerativeModel({
            model: 'gemini-2.0-flash-lite',
            systemInstruction: "You are a language detection API. Identify if the message is primarily in English (en), French (fr), Kinyarwanda (rw), Swahili (sw), or German (de). Output ONLY the two-letter ISO code. For mixed-language messages (e.g., Kinyarwanda with English time formats), identify the DOMINANT non-English language. Only output 'en' if the message is clearly and primarily in English. Do not provide explanations.",
        });

        // 2. Set strict generation config
        const generationConfig = {
            temperature: 0.1,
            maxOutputTokens: 5,
            responseMimeType: "text/plain",
        };

        // 3. Send only the message text to the model
        const result = await this._geminiWithRetry(
            () => model.generateContent({
                contents: [{ role: 'user', parts: [{ text: message }] }],
                generationConfig,
            }),
            'language-detection'
        );

        // 4. Safely extract the text
        const response = await result.response;
        const lang = response.text().trim().toLowerCase();

        // 5. Validation logic
        const supported = ['en', 'fr', 'rw', 'sw', 'de'];
        
        // Use startsWith or substring to handle accidental trailing punctuation like "rw."
        const cleanedLang = lang.substring(0, 2);

        if (supported.includes(cleanedLang)) {
            logger.debug('Language detected successfully', { language: cleanedLang });
            return cleanedLang;
        }

        logger.warn('Gemini returned unsupported code', { raw: lang });
        return this.languageConfig.defaultLanguage || 'en';

    } catch (err) {
        logger.error('Gemini detection failed', { error: err.message });
        return this.languageConfig.defaultLanguage || 'en';
    }
}

    /**
     * Retrieve relevant context for user message
     * @param {string} userMessage - User's message
     * @param {Array} conversationHistory - Previous messages
     * @param {number} topK - Number of results to retrieve
     * @returns {Promise<object>} - Retrieved context and metadata
     */
    async retrieveContext(userMessage, conversationHistory = [], topK = null, namespace = 'default') {
        try {
            if (!this.initialized) {
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

            // Search for similar documents — scoped to this client's namespace
            const results = await vectorDBService.searchSimilar(
                queryEmbedding,
                retrievalTopK,
                filter,
                namespace
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
            return await this._getFallbackContext(error, userMessage, conversationHistory);
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
    buildAugmentedPrompt(retrievedData, userMessage, dynamicData = {}, clientConfig = {}) {
        const parts = [];

        // Base instruction
        parts.push(this.getBaseInstruction(retrievedData.language, retrievedData.intent, clientConfig));
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
    getBaseInstruction(_language, intent, clientConfig = {}) {
        const intentGuidance = {
            booking: 'Focus on booking process, available slots, and requirements.',
            service_inquiry: 'Provide detailed service information from the knowledge base.',
            faq: 'Answer common questions clearly and concisely.',
            payment: 'Explain payment terms, deposits, and pricing clearly.',
            support: 'Help resolve issues with clear, step-by-step guidance.',
            general: 'Be friendly and helpful.'
        }[intent] || 'Be helpful and professional.';

        const companyName = clientConfig.companyName || 'our company';
        return `You are a professional AI assistant for ${companyName}.

CRITICAL LANGUAGE RULE:
- ALWAYS respond in the SAME language as the user's CURRENT message.
- Determine the language by reading ONLY the user's current message — do NOT use the conversation history to decide.
- If the user writes in Kinyarwanda → respond in Kinyarwanda.
- If in French → respond in French. If in English → respond in English.
- Supported: English (en), French (fr), Kinyarwanda (rw), Swahili (sw), German (de).
- NEVER default to English if the user's current message is in another language.

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
  "language": "iso_code", // Language of your reply matching the user's current message: en, fr, rw, sw, or de
  "reply": "your response text here"
}

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
                model: 'gemini-2.0-flash-lite'
            });

            const result = await this._geminiWithRetry(
              () => model.generateContent({
                contents: [{
                    role: 'user',
                    parts: [{ text: `Translate the following message to English. Output ONLY the translated text, nothing else.\n\nMessage: ${query}` }]
                }],
                generationConfig: { temperature: 0, maxOutputTokens: 200 }
              }),
              'query-translation'
            );

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
    async _getFallbackContext(error, message = '', history = []) {
        const language = message ? await this.detectLanguage(message, history) : 'en';
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
     * Call a Gemini model with automatic retry on 503/429 rate-limit errors.
     * @param {Function} fn - Async function that makes the Gemini call
     * @param {string} label - Label for logging
     * @param {number} maxRetries
     * @private
     */
    async _geminiWithRetry(fn, label = 'gemini', maxRetries = 3) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err) {
                const isRateLimit = err.status === 503 || err.status === 429
                    || err.message?.includes('503') || err.message?.includes('429')
                    || err.message?.includes('overloaded') || err.message?.includes('quota');

                if (isRateLimit && attempt < maxRetries) {
                    const delay = 5000 * Math.pow(3, attempt); // 5s, 15s, 45s
                    logger.warn(`${label} rate-limited, retrying (${attempt + 1}/${maxRetries}) after ${delay}ms`);
                    await new Promise(r => setTimeout(r, delay));
                } else {
                    throw err;
                }
            }
        }
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