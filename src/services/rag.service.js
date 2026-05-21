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
                model: "gemini-2.5-flash"
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
            model: 'gemini-2.5-flash',
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
    async retrieveContext(userMessage, conversationHistory = [], topK = null, namespace = 'default', knownLanguage = null) {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Validate query
            if (!this._validateQuery(userMessage)) {
                throw new Error('Invalid query');
            }

            const startTime = Date.now();

            // Classify intent — still needed for topK tuning and metadata filtering.
            // Language detection inside classifyQuery is skipped when the session language
            // is already known (passed via knownLanguage), saving a Gemini call.
            const classification = await this.classifyQuery(userMessage, conversationHistory);
            const intent = classification.intent;
            // Prefer the stored session language over anything RAG detected from the message.
            const language = knownLanguage || classification.language;

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

            // Drop results below the relevance threshold so Gemini cannot use
            // loosely-matched docs to hallucinate an answer. When nothing clears
            // the bar, relevantDocs=0 triggers the KNOWLEDGE BOUNDARY response.
            const MIN_SCORE = 0.70;
            const relevantResults = rankedResults.filter(r => (r.adjustedScore ?? r.score) >= MIN_SCORE);

            if (rankedResults.length > 0 && relevantResults.length === 0) {
                logger.info('RAG: all results below relevance threshold — treating as no context', {
                    topScore: rankedResults[0]?.adjustedScore?.toFixed(3),
                    threshold: MIN_SCORE
                });
            }

            // Extract and format context
            const context = this.formatContext(relevantResults);

            const latency = Date.now() - startTime;

            // Log retrieval details
            this._logRetrieval(userMessage, intent, relevantResults, latency);

            return {
                intent,
                language,
                context,
                results: relevantResults,
                relevantDocs: relevantResults.length,
                latency,
                metadata: {
                    topK: retrievalTopK,
                    filter,
                    avgScore: this._calculateAvgScore(relevantResults)
                }
            };

        } catch (error) {
            logger.error('RAG retrieval error', {
                error: error.message,
                stack: error.stack,
                query: userMessage?.substring(0, 50)
            });

            return await this._getFallbackContext(error, userMessage, conversationHistory, knownLanguage);
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

            // Intent-specific boosting (uses standardised type names)
            const t = result.metadata?.type;
            if (intent === 'booking'         && t === 'booking_rule')    adjustedScore += 0.15;
            else if (intent === 'service_inquiry' && t === 'company_service') adjustedScore += 0.10;
            else if (intent === 'faq'         && t === 'faq')            adjustedScore += 0.12;
            else if (intent === 'payment'     && t === 'payment_info')   adjustedScore += 0.15;

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
        const intentTypeMap = {
            general:         ['company_info'],
            service_inquiry: ['company_service', 'company_info'],
            booking:         ['booking_rule', 'company_service'],
            payment:         ['payment_info', 'booking_rule'],
            faq:             ['faq', 'company_info'],
            support:         ['support', 'faq', 'company_info'],
        };

        const types = intentTypeMap[intent] || intentTypeMap.general;
        return { type: { $in: types } };
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
            company_service: 'AVAILABLE SERVICES',
            company_info:    'COMPANY INFORMATION',
            booking_rule:    'BOOKING GUIDELINES',
            payment_info:    'PRICING & PAYMENT',
            faq:             'FREQUENTLY ASKED QUESTIONS',
            support:         'SUPPORT INFORMATION',
            general:         'GENERAL INFORMATION',
        };

        return labels[type] || type.toUpperCase().replace(/_/g, ' ');
    }

    /**
     * Query Pinecone for service documents and return structured service list.
     * Used as single source of truth for services — no Content table needed.
     * @param {string} namespace - Pinecone namespace (clientId or pineconeIndex)
     * @returns {Promise<Array<{id,name,short,details}>>}
     */
    /**
     * Return the full list of services for the WhatsApp interactive menu.
     *
     * Sources handled (all yield correct results without a re-sync):
     *
     * 1. Google Sheets / Excel chunks  — have `service_name` + `service_id` directly.
     * 2. Confluence single-service pages — H1 split → one chunk per service.
     *    After metadata normalisation these also carry `service_name`.
     * 3. Confluence overview pages — one H1 section contains all services as H2/H3.
     *    These chunks have NO individual `service_name` but DO carry `sub_headings`
     *    (extracted H2/H3 texts). We expand each sub_heading into its own entry so
     *    every service the client listed is visible in the menu.
     *
     * Deduplication is case-insensitive by resolved name so no service appears twice
     * regardless of how many chunks reference it.
     *
     * @param {string} namespace - client.pineconeIndex
     * @returns {Promise<Array<{id, name, short, details}>>}
     */
    async getServicesFromIndex(namespace = 'default') {
        try {
            await this.initialize();

            // Two phrasings maximise recall — domain-specific service names may
            // score poorly on one phrasing but well on the other.
            const [e1, e2] = await Promise.all([
                embeddingService.generateEmbedding(
                    'list all services treatments departments programs offered',
                    'RETRIEVAL_QUERY'
                ),
                embeddingService.generateEmbedding(
                    'what services products packages are available',
                    'RETRIEVAL_QUERY'
                ),
            ]);

            const filter = { type: { $in: ['company_service'] } };

            const [r1, r2] = await Promise.all([
                vectorDBService.searchSimilar(e1, 50, filter, namespace),
                vectorDBService.searchSimilar(e2, 50, filter, namespace),
            ]);

            // Merge both result sets; highest-score occurrence wins during dedup
            const allResults = [...r1, ...r2];

            // Map keyed by lowercase service name — first occurrence (best score) kept
            const byName = new Map();

            const addEntry = (name, meta, vectorId) => {
                const key = name.trim().toLowerCase();
                if (!name.trim() || byName.has(key)) return;

                // Extract a one-line description from the chunk content.
                // Strip the heading line if it was prepended, then take the first sentence.
                const rawContent  = meta.content || '';
                const headingLine = meta.section_heading || meta.service_name || '';
                const bodyText    = rawContent.startsWith(headingLine)
                    ? rawContent.slice(headingLine.length).trimStart()
                    : rawContent;
                const firstLine   = bodyText.split(/[.\n]/)[0].trim();
                const details     = firstLine.length > 8 ? firstLine : (meta.category || '');

                byName.set(key, {
                    id:      meta.service_id || vectorId,
                    name:    name.trim(),
                    short:   name.trim().length > 24
                        ? name.trim().slice(0, 23) + '…'
                        : name.trim(),
                    details: details.slice(0, 72),
                });
            };

            for (const r of allResults) {
                const meta = r.metadata || {};

                // ── Path 1: direct service_name (Sheets, Excel, normalised Confluence) ──
                if (meta.service_name) {
                    addEntry(meta.service_name, meta, r.id);
                    continue;
                }

                // ── Path 2: sub_headings populated during indexing (H2/H3 or <li>) ──────
                if (Array.isArray(meta.sub_headings) && meta.sub_headings.length > 0) {
                    for (const heading of meta.sub_headings) {
                        addEntry(heading, meta, `${r.id}-sub-${heading}`);
                    }
                    continue;
                }

                // ── Path 3: parse the flat content for "Service Name — description" ──────
                // Handles already-indexed Confluence pages that list services separated by
                // an em dash (—) or en dash (–) in plain text, e.g.:
                //   "Physiotherapy — Recovery of mobility, strength..."
                // No re-sync needed — works on the stored content string.
                const content = meta.content || '';
                const parsedServices = this._parseEmDashServices(content);
                if (parsedServices.length > 0) {
                    for (const svc of parsedServices) {
                        const key = svc.name.trim().toLowerCase();
                        if (!byName.has(key)) {
                            // ID must be safe for WhatsApp row IDs — alphanumeric + hyphens only
                            const safeSlug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                            byName.set(key, {
                                id:      `svc-${safeSlug}`,
                                name:    svc.name,
                                short:   svc.name.length > 24 ? svc.name.slice(0, 23) + '…' : svc.name,
                                details: svc.details.slice(0, 72),
                            });
                        }
                    }
                    continue;
                }

                // ── Path 4: final fallback — section heading or page title ───────────────
                const fallbackName = meta.section_heading || meta.page_title;
                if (fallbackName) addEntry(fallbackName, meta, r.id);
            }

            const services = [...byName.values()];
            logger.info('getServicesFromIndex resolved', { namespace, count: services.length });
            return services;

        } catch (error) {
            logger.warn('getServicesFromIndex failed', { namespace, error: error.message });
            return [];
        }
    }

    /**
     * Parse flat content text for services formatted as "Name — description" entries.
     *
     * Confluence pages often render service lists as plain text where each entry is
     * "{Service Name} — {one-sentence description}" separated by periods and spaces.
     * This parser handles both em dash (—, U+2014) and en dash (–, U+2013).
     *
     * Algorithm: split on the dash separator; the service name is the final
     * sentence-fragment before each dash, and the description is the sentence-
     * fragment that follows it (up to the start of the next service name).
     *
     * @param {string} content
     * @returns {Array<{name: string, details: string}>}
     * @private
     */
    _parseEmDashServices(content) {
        if (!content) return [];

        // Match "Some Words — description text" pattern (em or en dash, with spaces)
        const DASH_RE = /\s[—–]\s/;
        if (!DASH_RE.test(content)) return [];

        const services = [];
        const parts = content.split(DASH_RE);

        for (let i = 0; i < parts.length - 1; i++) {
            const beforeDash = parts[i];
            const afterDash  = parts[i + 1];

            // The service name is the last line/sentence of the preceding segment.
            // "Intro text. Service Name" → everything after the last '. '
            const lastPeriod  = beforeDash.lastIndexOf('. ');
            const lastNewline = beforeDash.lastIndexOf('\n');
            const cutAt = Math.max(
                lastPeriod  !== -1 ? lastPeriod  + 2 : 0,
                lastNewline !== -1 ? lastNewline  + 1 : 0
            );
            const name = beforeDash.slice(cutAt).trim();

            // Description: text before the last '. NextName' in the after-dash segment
            const nextPeriod = afterDash.lastIndexOf('. ');
            const details = (nextPeriod > 0
                ? afterDash.slice(0, nextPeriod + 1)
                : afterDash
            ).trim();

            if (!name || name.length > 80 || name.length < 2) continue;
            if (/^\d/.test(name)) continue;

            services.push({ name, details });
        }

        // ── Post-process: handle double-dash entries (e.g. "ENT — Ear, Nose and Throat — desc")
        // In this format a short acronym is followed by its expansion then the real description.
        // After splitting, the expansion text appears BOTH as a service name AND as a previous
        // service's details. We keep the longer (expanded) name and the real description.
        const detailsIndex = new Map();
        for (let i = 0; i < services.length; i++) {
            const key = services[i].details.trim().toLowerCase();
            if (key) detailsIndex.set(key, i);
        }

        return services.filter((svc, i) => {
            const nameKey = svc.name.trim().toLowerCase();
            if (detailsIndex.has(nameKey)) {
                // This name matches a previous entry's details — it's an expansion.
                // Promote the previous entry to use the longer name + real description.
                const prevIdx = detailsIndex.get(nameKey);
                services[prevIdx].name    = svc.name;
                services[prevIdx].short   = svc.name.length > 24 ? svc.name.slice(0, 23) + '…' : svc.name;
                services[prevIdx].details = svc.details.slice(0, 72);
                return false; // remove the expansion entry
            }
            return true;
        });
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

        // Base instruction — clientConfig.language (session preference) overrides RAG-detected language
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

        // First-time user welcome instructions (must come after context so AI has company info)
        if (dynamicData.welcomeContext) {
            parts.push('=== FIRST-TIME USER WELCOME ===');
            parts.push(dynamicData.welcomeContext);
            parts.push('');
        }

        // When Pinecone returned nothing, make the boundary explicit so the model
        // cannot justify using its training data to fill the gap.
        if (retrievedData.relevantDocs === 0) {
            parts.push('=== RELEVANT INFORMATION ===');
            parts.push('[EMPTY — the knowledge base returned no results for this query. You MUST NOT answer from general knowledge. Follow the KNOWLEDGE BOUNDARY rule above.]');
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
        // Resolved language: explicit override wins over RAG-detected language
        const resolvedLang = clientConfig.language || _language || 'en';

        const LANGUAGE_NAMES = {
            en: 'English',
            fr: 'French (Français)',
            rw: 'Kinyarwanda',
            sw: 'Kiswahili',
            de: 'German (Deutsch)'
        };
        const langName = LANGUAGE_NAMES[resolvedLang] || 'English';

        // Non-English users get an explicit directive at the very top — before any
        // RAG context — so the model sees it first and the English knowledge base
        // text cannot bias it toward an English response.
        const languageDirective = resolvedLang !== 'en'
            ? `⚠️ LANGUAGE REQUIREMENT — HIGHEST PRIORITY:
You MUST reply exclusively in ${langName} (${resolvedLang}).
The knowledge base sections below are written in English — read and understand them internally, then compose your entire reply in ${langName}.
Never write any part of your response in English. If a proper noun or technical term has no equivalent, keep it as-is — but the surrounding text must still be in ${langName}.

`
            : '';

        const intentGuidance = {
            booking: 'Focus on booking process, available slots, and requirements.',
            service_inquiry: 'Provide detailed service information from the knowledge base.',
            faq: 'Answer common questions clearly and concisely.',
            payment: 'Explain payment terms, deposits, and pricing clearly.',
            support: 'Help resolve issues with clear, step-by-step guidance.',
            general: 'Be friendly and helpful.'
        }[intent] || 'Be helpful and professional.';

        const botName = clientConfig.botName || 'our company';
        return `${languageDirective}You are a customer-facing representative of ${botName}. You speak AS ${botName} — use "we", "our", and "us" at all times.

🚫 IDENTITY RULE — NEVER BREAK:
Never describe yourself as an AI, bot, chatbot, or assistant.
Never say "I am an AI" or "as an AI". You are simply a representative of ${botName}.
If asked "are you a bot/AI?", deflect naturally: "I'm here to help with anything related to ${botName}."

🚫 KNOWLEDGE BOUNDARY — ABSOLUTE RULE:
You have NO general world knowledge. You are a blank slate.
Your ONLY source of facts is the "=== RELEVANT INFORMATION ===" section below.
If that section is empty OR does not directly address the user's specific question:
  → Do NOT guess, infer, or use anything you know from training data.
  → Respond warmly that you don't have that information, and invite them to ask something else or reach out to us directly.
    Example: "I'm sorry, I don't have details on that right now. Feel free to ask me about anything else, or you're welcome to contact our team directly for more help! 😊"
  → Keep the tone friendly and never leave the user without a clear next step.
This applies to ALL factual questions: location, pricing, hours, contacts, services, names — everything.

CONVERSATION RULES:
- Use conversation history ONLY to understand follow-up references (e.g. "tell me more about that", "what about the price?"). Never use it as a source of facts — facts come only from the knowledge base.
- For bookings, use ONLY dates from "=== AVAILABLE CONSULTATION SLOTS ===".
- Keep responses concise (2-4 sentences) unless more detail is genuinely needed.
- Be warm, professional, and customer-focused. ${intentGuidance}
- If the user's message is off-topic (weather, politics, personal questions), politely redirect: "I'm here to help with ${botName} services only."
- PSYCHOLOGICAL INTELLIGENCE — READ BETWEEN THE LINES: You are not a search engine. You are an intelligent assistant whose job is to understand what the user TRULY needs, not just what they literally say. Always ask yourself: "What is this person really trying to do?" Examples of what this means in practice:
  • Someone asking about location or directions → they are planning to visit → after answering, offer to show services or book an appointment
  • Someone mentioning a symptom, pain, or health concern → they need a service → immediately call show_services so they can find and book the right one
  • Someone asking "do you offer X?" → they are interested in X → if yes, call show_services; if no, tell them warmly and suggest what you DO offer that might help
  • Someone asking general questions that gradually move toward a specific need → recognize the trajectory and proactively guide them toward the next step
  • When in doubt about what the user wants → ask one clarifying question rather than giving a generic response
  Always connect the user's words to the action that best serves them. Never leave a user with just information when an action (showing services, booking) would serve them better.
- FOLLOW-UP QUESTION RULE: Always end your reply with a warm, relevant follow-up question or offer — no exceptions. This applies whether you just answered a factual question OR the user sent a short acknowledgment ("okay", "thanks", "got it", "that's great", "perfect", etc.). Never end with a dead-end statement like "We are glad we could assist you." — that closes the conversation. Instead keep the door open: "Is there anything else I can help you with?", "Would you like to book an appointment?", "Do you have any other questions about [topic]?". The only exception is when you are already mid-way through collecting information from the user (name, email, date, etc.).

OUTPUT FORMAT:
ALWAYS return your response in the following JSON format:
{
  "language": "${resolvedLang}",
  "reply": "your response text here in ${langName}"
}`;

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
                model: 'gemini-2.5-flash'
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
    async _getFallbackContext(error, message = '', history = [], knownLanguage = null) {
        // Use the session language if available — avoids a Gemini detection call on error paths.
        const language = knownLanguage || (message ? await this.detectLanguage(message, history) : 'en');
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