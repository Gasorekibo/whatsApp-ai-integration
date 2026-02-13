import markdownIt from 'markdown-it';
import ragConfig from '../config/rag.config.js';
import logger from '../logger/logger.js';

/**
 * Document Processor Service
 * Processes and chunks documents for vector storage
 * Handles different document types with specialized strategies
 */

class DocumentProcessorService {
    constructor() {
        this.md = markdownIt();
        this.config = ragConfig.chunking;
    }

    /**
     * Process service documents from Google Sheets/Excel
     * @param {Array} services - Array of service objects {id, name, details}
     * @returns {Array} - Processed document chunks
     */
    processServices(services) {
        try {
            logger.info('Processing service documents', { count: services.length });

            const chunks = services.map((service, index) => {
                // Create comprehensive text for embedding
                const content = this.buildServiceContent(service);

                return {
                    id: `service-${service.id || index}`,
                    content,
                    metadata: {
                        type: 'service',
                        service_id: service.id || `service-${index}`,
                        service_name: service.name,
                        priority: ragConfig.metadata.priorities.service,
                        language: 'en', // Default, can be detected
                        updated_at: new Date().toISOString()
                    }
                };
            });

            logger.info('Created service chunks', { count: chunks.length });
            return chunks;
        } catch (error) {
            logger.error('Error processing services', { error: error.message });
            throw error;
        }
    }

    /**
     * Build comprehensive service content for embedding
     * @param {object} service - Service object
     * @returns {string} - Formatted content
     */
    buildServiceContent(service) {
        // Handle case-insensitive keys (Name vs name, etc.)
        const name = service.name || service.Name || service.NAME;
        const details = service.details || service.Details || service.DETAILS || service.description;
        const category = service.category || service.Category || service.CATEGORY;
        const keywords = service.keywords || service.Keywords || service.KEYWORDS;

        const parts = [
            `Service: ${name}`,
        ];

        if (details) {
            parts.push(`Description: ${details}`);
        }

        if (category) {
            parts.push(`Category: ${category}`);
        }

        if (keywords) {
            parts.push(`Keywords: ${Array.isArray(keywords) ? keywords.join(', ') : keywords}`);
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
            const text = this.stripHtml(html);

            // Split into chunks based on type
            const chunks = this.chunkText(text, type);

            return chunks.map((chunk, index) => ({
                id: `${type}-${metadata.id || Date.now()}-${index}`,
                content: chunk,
                metadata: {
                    type,
                    chunk_index: index,
                    priority: ragConfig.metadata.priorities[type] || 5,
                    language: metadata.language || 'en',
                    updated_at: new Date().toISOString(),
                    ...metadata
                }
            }));
        } catch (error) {
            logger.error('Error processing markdown', { error: error.message });
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

            const chunks = faqs.map((faq, index) => ({
                id: `faq-${metadata.category || 'general'}-${index}`,
                content: `Q: ${faq.question}\nA: ${faq.answer}`,
                metadata: {
                    type: 'faq',
                    category: metadata.category || 'general',
                    question: faq.question,
                    priority: ragConfig.metadata.priorities.faq,
                    language: metadata.language || 'en',
                    updated_at: new Date().toISOString()
                }
            }));

            logger.info('Created FAQ chunks', { count: chunks.length });
            return chunks;
        } catch (error) {
            logger.error('Error processing FAQs', { error: error.message });
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

            // Payment rules
            if (bookingInfo.payment) {
                chunks.push({
                    id: 'booking-payment-rules',
                    content: this.formatBookingContent('Payment Rules', bookingInfo.payment),
                    metadata: {
                        type: 'booking_rule',
                        category: 'payment',
                        priority: ragConfig.metadata.priorities.booking_rule,
                        language: 'en',
                        updated_at: new Date().toISOString()
                    }
                });
            }

            // Booking process
            if (bookingInfo.process) {
                chunks.push({
                    id: 'booking-process',
                    content: this.formatBookingContent('Booking Process', bookingInfo.process),
                    metadata: {
                        type: 'booking_rule',
                        category: 'process',
                        priority: ragConfig.metadata.priorities.booking_rule,
                        language: 'en',
                        updated_at: new Date().toISOString()
                    }
                });
            }

            // Slot selection rules
            if (bookingInfo.slots) {
                chunks.push({
                    id: 'booking-slot-rules',
                    content: this.formatBookingContent('Slot Selection', bookingInfo.slots),
                    metadata: {
                        type: 'booking_rule',
                        category: 'slots',
                        priority: ragConfig.metadata.priorities.booking_rule,
                        language: 'en',
                        updated_at: new Date().toISOString()
                    }
                });
            }

            logger.info('Created booking rule chunks', { count: chunks.length });
            return chunks;
        } catch (error) {
            logger.error('Error processing booking rules', { error: error.message });
            throw error;
        }
    }

    /**
     * Format booking content
     * @param {string} title - Section title
     * @param {string|object} content - Content
     * @returns {string} - Formatted content
     */
    formatBookingContent(title, content) {
        if (typeof content === 'string') {
            return `${title}:\n${content}`;
        }

        const parts = [title + ':'];
        for (const [key, value] of Object.entries(content)) {
            parts.push(`${key}: ${value}`);
        }
        return parts.join('\n');
    }

    /**
     * Chunk text based on word count with overlap
     * @param {string} text - Text to chunk
     * @param {string} type - Document type
     * @returns {Array} - Text chunks
     */
    chunkText(text, type) {
        const words = text.split(/\s+/);
        const maxWords = this.config[type]?.maxChunkSize || this.config.maxChunkSize;
        const minWords = this.config.minChunkSize;
        const overlap = this.config.overlap;

        if (words.length <= maxWords) {
            return [text];
        }

        const chunks = [];
        let start = 0;

        while (start < words.length) {
            const end = Math.min(start + maxWords, words.length);
            const chunk = words.slice(start, end).join(' ');

            if (chunk.split(/\s+/).length >= minWords) {
                chunks.push(chunk);
            }

            start = end - overlap;

            // Prevent infinite loop
            if (start >= words.length - minWords) {
                break;
            }
        }

        return chunks;
    }

    /**
     * Strip HTML tags from text
     * @param {string} html - HTML content
     * @returns {string} - Plain text
     */
    stripHtml(html) {
        return html
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Estimate token count (rough approximation)
     * @param {string} text - Text to estimate
     * @returns {number} - Estimated tokens
     */
    estimateTokens(text) {
        // Rough estimate: 1 token ≈ 4 characters for English
        return Math.ceil(text.length / 4);
    }

    /**
     * Validate document structure
     * @param {object} doc - Document to validate
     * @returns {boolean} - True if valid
     */
    validateDocument(doc) {
        if (!doc.id || !doc.content || !doc.metadata) {
            return false;
        }

        if (!ragConfig.metadata.types.includes(doc.metadata.type)) {
            logger.warn('Unknown document type', { type: doc.metadata.type });
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

        for (const doc of documents) {
            try {
                let chunks;

                if (type === 'service') {
                    chunks = this.processServices([doc]);
                } else if (type === 'faq') {
                    chunks = this.processFAQs([doc]);
                } else {
                    chunks = this.processMarkdown(doc.content, type, doc.metadata);
                }

                allChunks.push(...chunks);
            } catch (error) {
                logger.error(`Error processing document ${doc.id}`, { error: error.message });
            }
        }

        return allChunks;
    }
}

// Export singleton instance
const documentProcessor = new DocumentProcessorService();

export default documentProcessor;
