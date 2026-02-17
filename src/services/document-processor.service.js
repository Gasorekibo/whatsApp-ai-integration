import markdownIt from 'markdown-it';
import ragConfig from '../config/rag.config.js';
import { getLanguageConfig } from '../utils/config-compatibility.helper.js';
import logger from '../logger/logger.js';

/**
 * Enhanced Document Processor Service
 * Processes and chunks documents for vector storage
 * Features:
 * - Smart sentence-aware chunking
 * - Type-specific processing strategies
 * - Better metadata extraction
 * - Validation and error handling
 * 
 * @version 2.0.0
 */

class DocumentProcessorService {
    constructor() {
        this.md = markdownIt();
        this.config = ragConfig.chunking;
        this.languageConfig = getLanguageConfig(ragConfig);

        // Statistics
        this.stats = {
            processed: 0,
            chunks: 0,
            errors: 0
        };
    }

    /**
     * Process service documents from Google Sheets/Excel
     * @param {Array} services - Array of service objects
     * @returns {Array} - Processed document chunks
     */
    processServices(services) {
        try {
            logger.info('Processing service documents', { count: services.length });

            const chunks = [];

            for (const [index, service] of services.entries()) {
                try {
                    const chunk = this._processService(service, index);

                    if (this._validateChunk(chunk)) {
                        chunks.push(chunk);
                    }
                } catch (error) {
                    this.stats.errors++;
                    logger.error('Error processing service', {
                        service: service.name || service.id,
                        error: error.message
                    });
                }
            }

            this.stats.processed += services.length;
            this.stats.chunks += chunks.length;

            logger.info('Service processing complete', {
                services: services.length,
                chunks: chunks.length,
                errors: this.stats.errors
            });

            return chunks;

        } catch (error) {
            logger.error('Error processing services', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Process a single service
     * @private
     */
    _processService(service, index) {
        const serviceConfig = this.config.service;

        // Extract fields (case-insensitive)
        const name = this._getField(service, ['name', 'service_name', 'title']);
        const details = this._getField(service, ['details', 'description', 'desc']);
        const category = this._getField(service, ['category', 'type']);
        const keywords = this._getField(service, ['keywords', 'tags']);
        const price = this._getField(service, ['price', 'cost', 'pricing']);

        // Build comprehensive content
        const content = this._buildServiceContent({
            name,
            details,
            category,
            keywords,
            price
        });

        // Generate unique ID
        const id = service.id ||
            service.service_id ||
            this._generateId('service', name, index);

        return {
            id,
            content,
            metadata: {
                type: 'service',
                service_id: id,
                service_name: name,
                category: category || 'general',
                priority: ragConfig.metadata.priorities.service,
                language: this._detectLanguage(content),
                updated_at: new Date().toISOString(),
                ...(keywords && { keywords: Array.isArray(keywords) ? keywords : [keywords] })
            }
        };
    }

    /**
     * Get field from object (case-insensitive)
     * @private
     */
    _getField(obj, possibleKeys) {
        for (const key of possibleKeys) {
            // Check exact match
            if (obj[key]) return obj[key];

            // Check case-insensitive
            const found = Object.keys(obj).find(k =>
                k.toLowerCase() === key.toLowerCase()
            );

            if (found && obj[found]) return obj[found];
        }
        return null;
    }

    /**
     * Build comprehensive service content
     * @private
     */
    _buildServiceContent({ name, details, category, keywords, price }) {
        const parts = [];

        if (name) {
            parts.push(`Service: ${name}`);
        }

        if (category) {
            parts.push(`Category: ${category}`);
        }

        if (details) {
            parts.push(`\nDescription: ${details}`);
        }

        if (price) {
            parts.push(`\nPricing: ${price}`);
        }

        if (keywords) {
            const keywordStr = Array.isArray(keywords)
                ? keywords.join(', ')
                : keywords;
            parts.push(`\nKeywords: ${keywordStr}`);
        }

        return parts.join('\n');
    }

    /**
     * Process markdown document into chunks
     * @param {string} markdown - Markdown content
     * @param {string} type - Document type
     * @param {object} metadata - Additional metadata
     * @returns {Array} - Document chunks
     */
    processMarkdown(markdown, type, metadata = {}) {
        try {
            // Parse markdown to HTML then extract text
            const html = this.md.render(markdown);
            const text = this._stripHtml(html);

            // Get type-specific config
            const typeConfig = this.config[type] || {};

            // Split into chunks
            const chunks = this._chunkText(text, type, typeConfig);

            return chunks.map((chunk, index) => ({
                id: this._generateId(type, metadata.id || metadata.title, index),
                content: chunk,
                metadata: {
                    type,
                    chunk_index: index,
                    total_chunks: chunks.length,
                    priority: ragConfig.metadata.priorities[type] || 5,
                    language: metadata.language || this._detectLanguage(chunk),
                    updated_at: new Date().toISOString(),
                    ...metadata
                }
            }));

        } catch (error) {
            this.stats.errors++;
            logger.error('Error processing markdown', {
                error: error.message,
                type
            });
            throw error;
        }
    }

    /**
     * Process FAQ documents
     * @param {Array} faqs - Array of {question, answer} objects
     * @param {object} metadata - Additional metadata
     * @returns {Array} - FAQ chunks
     */
    processFAQs(faqs, metadata = {}) {
        try {
            logger.info('Processing FAQ items', { count: faqs.length });

            const chunks = faqs.map((faq, index) => {
                const question = faq.question || faq.q || faq.Question;
                const answer = faq.answer || faq.a || faq.Answer;
                const category = faq.category || metadata.category || 'general';

                if (!question || !answer) {
                    logger.warn('Invalid FAQ item', { index });
                    return null;
                }

                return {
                    id: this._generateId('faq', category, index),
                    content: `Question: ${question}\n\nAnswer: ${answer}`,
                    metadata: {
                        type: 'faq',
                        category,
                        question,
                        priority: ragConfig.metadata.priorities.faq,
                        language: metadata.language || this._detectLanguage(answer),
                        updated_at: new Date().toISOString()
                    }
                };
            }).filter(Boolean); // Remove null entries

            this.stats.processed += faqs.length;
            this.stats.chunks += chunks.length;

            logger.info('FAQ processing complete', {
                faqs: faqs.length,
                chunks: chunks.length
            });

            return chunks;

        } catch (error) {
            this.stats.errors++;
            logger.error('Error processing FAQs', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Process booking rules and procedures
     * @param {object} bookingInfo - Booking information
     * @returns {Array} - Booking rule chunks
     */
    processBookingRules(bookingInfo) {
        try {
            const chunks = [];
            const bookingConfig = this.config.bookingRule || {};

            // Process each section
            const sections = [
                { key: 'payment', category: 'payment' },
                { key: 'process', category: 'process' },
                { key: 'slots', category: 'slots' },
                { key: 'cancellation', category: 'cancellation' },
                { key: 'requirements', category: 'requirements' }
            ];

            for (const section of sections) {
                if (bookingInfo[section.key]) {
                    const content = this._formatBookingContent(
                        section.key,
                        bookingInfo[section.key]
                    );

                    chunks.push({
                        id: `booking-${section.category}`,
                        content,
                        metadata: {
                            type: 'booking_rule',
                            category: section.category,
                            priority: ragConfig.metadata.priorities.booking_rule,
                            language: 'en',
                            updated_at: new Date().toISOString()
                        }
                    });
                }
            }

            this.stats.chunks += chunks.length;

            logger.info('Booking rules processed', { chunks: chunks.length });
            return chunks;

        } catch (error) {
            this.stats.errors++;
            logger.error('Error processing booking rules', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Format booking content
     * @private
     */
    _formatBookingContent(sectionKey, content) {
        const titles = {
            payment: 'Payment Requirements',
            process: 'Booking Process',
            slots: 'Slot Selection Rules',
            cancellation: 'Cancellation Policy',
            requirements: 'Booking Requirements'
        };

        const title = titles[sectionKey] || sectionKey;

        if (typeof content === 'string') {
            return `${title}:\n\n${content}`;
        }

        if (typeof content === 'object') {
            const parts = [`${title}:`];
            for (const [key, value] of Object.entries(content)) {
                parts.push(`\n${key}: ${value}`);
            }
            return parts.join('\n');
        }

        return `${title}:\n${JSON.stringify(content)}`;
    }

    /**
     * Process Confluence page
     * @param {object} page - Confluence page object
     * @returns {Array} - Processed chunks
     */
    processConfluencePage(page) {
        try {
            const title = page.title || 'Untitled';
            const body = page.body?.storage?.value || '';
            const version = page.version?.number || 1;
            const spaceKey = page.space?.key || '';

            // Convert HTML to text
            const textContent = this._stripHtml(body);

            if (!textContent || textContent.trim().length < 50) {
                logger.warn('Confluence page too short or empty', {
                    pageId: page.id,
                    title
                });
                return [];
            }

            // Get confluence-specific config
            const confluenceConfig = this.config.confluence || {};

            // Chunk the text
            const chunks = this._chunkText(
                textContent,
                'confluence',
                confluenceConfig
            );

            return chunks.map((chunk, index) => ({
                id: `confluence-${page.id}-${index}`,
                content: confluenceConfig.includePageTitle && index === 0
                    ? `${title}\n\n${chunk}`
                    : chunk,
                metadata: {
                    type: 'company_info',
                    source: 'confluence',
                    page_id: page.id,
                    title,
                    version,
                    space: spaceKey,
                    chunk_index: index,
                    total_chunks: chunks.length,
                    priority: ragConfig.metadata.priorities.confluence ||
                        ragConfig.metadata.priorities.company_info,
                    language: 'en',
                    updated_at: new Date().toISOString()
                }
            }));

        } catch (error) {
            this.stats.errors++;
            logger.error('Error processing Confluence page', {
                pageId: page.id,
                error: error.message
            });
            return [];
        }
    }

    /**
     * Smart text chunking with sentence awareness
     * @private
     */
    _chunkText(text, type, typeConfig = {}) {
        const maxWords = typeConfig.maxChunkSize || this.config.maxChunkSize;
        const minWords = this.config.minChunkSize;
        const overlap = typeConfig.overlap || this.config.overlap;

        // Split into sentences first
        const sentences = this._splitIntoSentences(text);

        if (sentences.length === 0) return [];

        const chunks = [];
        let currentChunk = [];
        let currentWordCount = 0;

        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const sentenceWords = this._countWords(sentence);

            // If single sentence is too long, split it
            if (sentenceWords > maxWords) {
                // Save current chunk if exists
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk.join(' '));
                    currentChunk = [];
                    currentWordCount = 0;
                }

                // Split long sentence by words
                const sentenceChunks = this._splitLongSentence(sentence, maxWords);
                chunks.push(...sentenceChunks);
                continue;
            }

            // Check if adding this sentence exceeds maxWords
            if (currentWordCount + sentenceWords > maxWords && currentChunk.length > 0) {
                // Save current chunk
                chunks.push(currentChunk.join(' '));

                // Start new chunk with overlap
                const overlapSentences = this._getOverlapSentences(
                    currentChunk,
                    overlap
                );
                currentChunk = [...overlapSentences, sentence];
                currentWordCount = this._countWords(currentChunk.join(' '));
            } else {
                // Add sentence to current chunk
                currentChunk.push(sentence);
                currentWordCount += sentenceWords;
            }
        }

        // Add last chunk if it meets minimum size
        if (currentChunk.length > 0 && currentWordCount >= minWords) {
            chunks.push(currentChunk.join(' '));
        }

        return chunks.filter(chunk => this._countWords(chunk) >= minWords);
    }

    /**
     * Split text into sentences
     * @private
     */
    _splitIntoSentences(text) {
        // Enhanced sentence splitting
        const delimiters = this.config.sentenceDelimiters || ['. ', '! ', '? ', '\n\n'];

        let sentences = [text];

        for (const delimiter of delimiters) {
            const newSentences = [];
            for (const sentence of sentences) {
                newSentences.push(...sentence.split(delimiter));
            }
            sentences = newSentences;
        }

        // Clean and filter
        return sentences
            .map(s => s.trim())
            .filter(s => s.length > 0);
    }

    /**
     * Split long sentence into chunks
     * @private
     */
    _splitLongSentence(sentence, maxWords) {
        const words = sentence.split(/\s+/);
        const chunks = [];

        for (let i = 0; i < words.length; i += maxWords) {
            chunks.push(words.slice(i, i + maxWords).join(' '));
        }

        return chunks;
    }

    /**
     * Get overlap sentences for continuity
     * @private
     */
    _getOverlapSentences(sentences, overlapWords) {
        const result = [];
        let wordCount = 0;

        // Add sentences from the end until we reach overlap word count
        for (let i = sentences.length - 1; i >= 0; i--) {
            const sentence = sentences[i];
            const sentenceWords = this._countWords(sentence);

            if (wordCount + sentenceWords <= overlapWords) {
                result.unshift(sentence);
                wordCount += sentenceWords;
            } else {
                break;
            }
        }

        return result;
    }

    /**
     * Count words in text
     * @private
     */
    _countWords(text) {
        return text.split(/\s+/).filter(w => w.length > 0).length;
    }

    /**
     * Strip HTML tags from text
     * @private
     */
    _stripHtml(html) {
        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Detect language from text
     * @private
     */
    _detectLanguage(text) {
        const patterns = this.languageConfig.patterns;
        const textLower = text.toLowerCase();

        for (const [lang, regexList] of Object.entries(patterns)) {
            for (const regex of regexList) {
                if (regex.test(textLower)) {
                    return lang;
                }
            }
        }

        return this.languageConfig.defaultLanguage;
    }

    /**
     * Generate unique document ID
     * @private
     */
    _generateId(type, identifier, index) {
        const timestamp = Date.now();
        const cleanId = identifier
            ? String(identifier).toLowerCase().replace(/[^a-z0-9]/g, '-')
            : timestamp;

        return `${type}-${cleanId}-${index}-${timestamp}`;
    }

    /**
     * Validate chunk
     * @private
     */
    _validateChunk(chunk) {
        if (!chunk || !chunk.id || !chunk.content || !chunk.metadata) {
            logger.warn('Invalid chunk structure', { chunk });
            return false;
        }

        if (chunk.content.trim().length < this.config.minChunkSize) {
            logger.warn('Chunk too short', { id: chunk.id });
            return false;
        }

        const requiredMetadata = ragConfig.metadata.required || [];
        for (const field of requiredMetadata) {
            if (!chunk.metadata[field]) {
                logger.warn('Missing required metadata', {
                    id: chunk.id,
                    field
                });
                return false;
            }
        }

        return true;
    }

    /**
     * Batch process multiple documents
     * @param {Array} documents - Array of documents
     * @param {string} type - Document type
     * @returns {Array} - Processed chunks
     */
    batchProcess(documents, type) {
        const allChunks = [];
        const errors = [];

        for (const [index, doc] of documents.entries()) {
            try {
                let chunks = [];

                switch (type) {
                    case 'service':
                        chunks = this.processServices([doc]);
                        break;

                    case 'faq':
                        chunks = this.processFAQs([doc]);
                        break;

                    case 'confluence':
                        chunks = this.processConfluencePage(doc);
                        break;

                    case 'markdown':
                        chunks = this.processMarkdown(
                            doc.content,
                            doc.type || 'general',
                            doc.metadata || {}
                        );
                        break;

                    default:
                        logger.warn('Unknown document type', { type });
                }

                allChunks.push(...chunks);

            } catch (error) {
                this.stats.errors++;
                errors.push({
                    index,
                    docId: doc.id || `document-${index}`,
                    error: error.message
                });

                logger.error('Error processing document in batch', {
                    index,
                    type,
                    error: error.message
                });
            }
        }

        if (errors.length > 0) {
            logger.warn('Batch processing completed with errors', {
                total: documents.length,
                successful: documents.length - errors.length,
                errors: errors.length
            });
        }

        return allChunks;
    }

    /**
     * Estimate token count
     * @param {string} text - Text to estimate
     * @returns {number} - Estimated tokens
     */
    estimateTokens(text) {
        // Rough estimate: 1 token ≈ 4 characters for English
        return Math.ceil(text.length / 4);
    }

    /**
     * Get processing statistics
     */
    getStats() {
        return {
            ...this.stats,
            errorRate: this.stats.processed > 0
                ? ((this.stats.errors / this.stats.processed) * 100).toFixed(2) + '%'
                : '0%',
            avgChunksPerDoc: this.stats.processed > 0
                ? (this.stats.chunks / this.stats.processed).toFixed(2)
                : 0
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            processed: 0,
            chunks: 0,
            errors: 0
        };
        logger.info('Document processor stats reset');
    }
}

// Export singleton instance
const documentProcessor = new DocumentProcessorService();

export default documentProcessor;