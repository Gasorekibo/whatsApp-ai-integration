import markdownIt from 'markdown-it';
import { GoogleGenerativeAI } from '@google/generative-ai';
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

        // In-process cache for Gemini heading classifications — avoids redundant API
        // calls when the same heading appears across multiple pages or sync runs.
        this._geminiClassifyCache = new Map();
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
                type: 'company_service',
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
            // Normalise legacy 'general' type to the canonical 'company_info'
            const resolvedType = type === 'general' ? 'company_info' : type;

            // Parse markdown to HTML then extract text
            const html = this.md.render(markdown);
            const text = this._stripHtml(html);

            // Get type-specific config
            const typeConfig = this.config[resolvedType] || this.config[type] || {};

            // Split into chunks
            const chunks = this._chunkText(text, resolvedType, typeConfig);

            return chunks.map((chunk, index) => ({
                id: this._generateId(resolvedType, metadata.id || metadata.title, index),
                content: chunk,
                metadata: {
                    type: resolvedType,
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
     * Process a Confluence page using H1-based semantic chunking.
     *
     * Each H1 heading defines a topic boundary. Everything under it — H2s, H3s,
     * paragraphs, lists, tables — stays together as one chunk so unrelated topics
     * are never mixed in the same vector.
     *
     * Classification is three-tier:
     *   1. Confluence page label (overrides all sections when a single valid label exists)
     *   2. Keyword matching on the H1 text
     *   3. Gemini fallback (only when keywords produce no match)
     *
     * @param {object} page - Confluence page object
     * @returns {Promise<Array>} - Processed chunks
     */
    async processConfluencePage(page) {
        try {
            const title    = page.title || 'Untitled';
            const body     = page.body?.storage?.value || '';
            const version  = page.version?.number || 1;
            const spaceKey = page.space?.key || '';
            const minWords = this.config.minChunkSize || 10;
            const confCfg  = this.config.confluence || {};
            const maxWords = confCfg.maxChunkSize || this.config.maxChunkSize;

            if (!body || this._stripHtml(body).trim().length < 50) {
                logger.warn('Confluence page too short or empty', { pageId: page.id, title });
                return [];
            }

            // Tier 1 — page-label override (one call per page, not per section)
            const labelType = this._classifyByLabel(page);

            // Split HTML on H1 boundaries only
            const sections  = this._splitByH1(body, title);
            const chunks    = [];

            for (let sIdx = 0; sIdx < sections.length; sIdx++) {
                const section   = sections[sIdx];
                const cleanText = this._stripHtml(section.html).trim();

                if (!cleanText) continue; // skip genuinely empty sections only

                // Three-tier classification
                const type = labelType
                    || this._classifyByKeyword(section.heading)
                    || await this._classifyWithGemini(section.heading, title);

                // Build priority — respect per-type config if present
                const priority = ragConfig.metadata.priorities[type]
                    || ragConfig.metadata.priorities.confluence
                    || ragConfig.metadata.priorities.company_info
                    || 5;

                // Extract any H2/H3 sub-headings for richer metadata
                const subHeadings = this._extractSubHeadings(section.html);

                // Prepend the H1 heading to the content so embedding captures topic context
                const contentWithHeading = section.heading
                    ? `${section.heading}\n\n${cleanText}`
                    : cleanText;

                // Sub-chunk when the section is too long; sub-chunks inherit the same type
                let subChunks;
                if (this._countWords(contentWithHeading) > maxWords) {
                    const pieces = this._chunkText(cleanText, 'confluence', confCfg);
                    subChunks = pieces.map((piece, i) =>
                        i === 0 && section.heading ? `${section.heading}\n\n${piece}` : piece
                    );
                } else {
                    subChunks = [contentWithHeading];
                }

                subChunks.forEach((chunk, cIdx) => {
                    chunks.push({
                        // Stable ID: consistent across re-syncs so Pinecone overwrites cleanly
                        id: `confluence-${page.id}-${sIdx}-${cIdx}`,
                        content: chunk,
                        metadata: {
                            type,
                            source:          'confluence',
                            page_id:         page.id,
                            page_title:      title,
                            section_heading: section.heading || title,
                            section_index:   sIdx,
                            chunk_index:     cIdx,
                            total_chunks:    subChunks.length,
                            sub_headings:    subHeadings,
                            version,
                            space:           spaceKey,
                            priority,
                            language:        'en',
                            updated_at:      new Date().toISOString()
                        }
                    });
                });
            }

            this.stats.chunks += chunks.length;
            logger.info('Confluence page processed', {
                pageId: page.id, title,
                sections: sections.length, chunks: chunks.length
            });

            return chunks;

        } catch (error) {
            this.stats.errors++;
            logger.error('Error processing Confluence page', { pageId: page.id, error: error.message });
            return [];
        }
    }

    /**
     * Split Confluence HTML on H1 tag boundaries only.
     * H2/H3 and all other content inside an H1 section stays together.
     * If no H1 exists, returns a single section using the page title as the heading.
     * @private
     */
    _splitByH1(html, pageTitle) {
        const h1Re    = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
        const h1s     = [];
        let   match;

        while ((match = h1Re.exec(html)) !== null) {
            h1s.push({
                index:    match.index,
                endIndex: match.index + match[0].length,
                heading:  this._stripHtml(match[1]).trim()
            });
        }

        // No H1s — treat entire page as one section, classified by page title
        if (h1s.length === 0) return [{ heading: pageTitle, html }];

        const sections = [];

        // Intro content before the first H1 (navigational disclaimers etc.) — attach to page title
        if (h1s[0].index > 0) {
            const introHtml = html.slice(0, h1s[0].index);
            if (this._stripHtml(introHtml).trim()) {
                sections.push({ heading: pageTitle, html: introHtml });
            }
        }

        for (let i = 0; i < h1s.length; i++) {
            const h         = h1s[i];
            const nextStart = h1s[i + 1]?.index ?? html.length;
            sections.push({
                heading: h.heading,
                html:    html.slice(h.endIndex, nextStart)
            });
        }

        return sections;
    }

    /**
     * Tier 1 — check if the page carries a single Confluence label that maps
     * directly to a valid metadata type. When found, every section on the page
     * inherits that type (skipping keyword and Gemini classification).
     * @private
     */
    _classifyByLabel(page) {
        const VALID = new Set(['company_info', 'company_service', 'booking_rule', 'payment_info', 'faq', 'support']);
        const labels = (page.metadata?.labels?.results || [])
            .map(l => (l.name || '').toLowerCase().trim())
            .filter(l => VALID.has(l));

        // Apply only when exactly one valid label is present — avoids ambiguity
        return labels.length === 1 ? labels[0] : null;
    }

    /**
     * Tier 2 — keyword matching on H1 heading text.
     * Expanded keyword set covers healthcare, IT, and general business domains.
     * Returns null when nothing matches (caller falls through to Tier 3).
     * @private
     */
    _classifyByKeyword(headingText) {
        const h = (headingText || '').toLowerCase();

        // More-specific types are checked first so a broad keyword (e.g. "service",
        // "solution") in a less-specific rule cannot steal headings that clearly belong
        // to a more-specific category (e.g. "About Us", "How to Access Services").
        const rules = [
            ['company_info',    /\babout\b|overview|mission|vision|history|contact|location|team|guideline|visitor|patient info/],
            ['booking_rule',    /booking|appointment|schedule|reservation|how to book|consultation|availability|\baccess\b|admission|how to access/],
            ['payment_info',    /payment|pricing|price|cost|fee|invoice|deposit|billing|rates|refund|cancellation|policy/],
            ['faq',             /faq|frequently asked|question|help|common/],
            ['support',         /support|troubleshoot|issue|problem|helpdesk|technical/],
            ['company_service', /service|offer|product|package|solution|what we do|our work|portfolio|department|care|treatment|therapy|surgery|program|unit|clinic/],
        ];

        for (const [type, regex] of rules) {
            if (regex.test(h)) return type;
        }
        return null;
    }

    /**
     * Tier 3 — Gemini fallback for headings that match no keyword.
     * Results are cached in-process so repeated headings cost only one API call.
     * Never throws — silently returns 'company_info' on any failure.
     * @private
     */
    async _classifyWithGemini(headingText, pageTitle) {
        const cacheKey = `${headingText}|||${pageTitle}`;
        if (this._geminiClassifyCache.has(cacheKey)) {
            return this._geminiClassifyCache.get(cacheKey);
        }

        const VALID   = new Set(['company_info', 'company_service', 'booking_rule', 'payment_info', 'faq', 'support']);
        const fallback = 'company_info';

        try {
            const apiKey = process.env.GEMINI_API_KEY;
            if (!apiKey) {
                logger.debug('_classifyWithGemini: no GEMINI_API_KEY, defaulting to company_info');
                return fallback;
            }

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash-lite',
                generationConfig: { temperature: 0, maxOutputTokens: 10 }
            });

            const prompt =
`Classify this section heading into exactly one category:
company_info | company_service | booking_rule | payment_info | faq | support

Section heading: "${headingText}"
Page title: "${pageTitle}"

Reply with one word only.`;

            const result = await model.generateContent(prompt);
            const raw    = result.response.text().trim().toLowerCase().replace(/[^a-z_]/g, '');
            const type   = VALID.has(raw) ? raw : fallback;

            this._geminiClassifyCache.set(cacheKey, type);
            logger.debug('_classifyWithGemini: classified', { headingText, type });
            return type;

        } catch (err) {
            logger.debug('_classifyWithGemini: failed, defaulting to company_info', { headingText, error: err.message });
            this._geminiClassifyCache.set(cacheKey, fallback);
            return fallback;
        }
    }

    /**
     * Extract sub-section names from a Confluence HTML block.
     *
     * Tries multiple extraction strategies in order of precision:
     * 1. H2/H3 headings — most explicit (standard Confluence page outline)
     * 2. <li> items that contain an em/en dash — "Service Name — description" lists
     * 3. <li> items with a <strong>/<b> lead — bolded service names in bullet lists
     *
     * @private
     */
    _extractSubHeadings(html) {
        const out = [];
        const seen = new Set();

        const add = (text) => {
            const t = text.trim();
            const key = t.toLowerCase();
            if (t && t.length < 100 && !seen.has(key)) { seen.add(key); out.push(t); }
        };

        // Strategy 1: explicit H2/H3 headings
        const hRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
        let m;
        while ((m = hRe.exec(html)) !== null) add(this._stripHtml(m[1]));

        if (out.length > 0) return out; // H2/H3 found — no need for fallback strategies

        // Strategy 2: <li> items with em/en dash pattern → text before the dash is the name
        const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
        while ((m = liRe.exec(html)) !== null) {
            const text = this._stripHtml(m[1]);
            const dashIdx = text.search(/\s[—–]\s/); // em dash or en dash with spaces
            if (dashIdx !== -1) {
                add(text.slice(0, dashIdx));
            } else {
                // Strategy 3: <li> with leading <strong>/<b> — take the bold text
                const boldM = m[1].match(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/i);
                if (boldM) add(this._stripHtml(boldM[1]));
            }
        }

        return out;
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

        // Flush the final accumulated chunk.
        // If it's too short to stand alone, merge it into the last chunk so no
        // content is silently dropped — a short trailing sentence is still useful.
        if (currentChunk.length > 0) {
            const tail = currentChunk.join(' ');
            if (currentWordCount >= minWords || chunks.length === 0) {
                chunks.push(tail);
            } else {
                // Append to the previous chunk rather than discarding
                chunks[chunks.length - 1] += ' ' + tail;
            }
        }

        // Only filter if the chunk is genuinely empty — never discard real content
        return chunks.filter(chunk => chunk.trim().length > 0);
    }

    /**
     * Split text into sentences
     * @private
     */
    _splitIntoSentences(text) {
        // Split on sentence-ending punctuation followed by whitespace, preserving
        // the punctuation at the end of each sentence so context is not lost.
        // Also splits on double-newlines (paragraph breaks).
        // Uses a lookahead so the delimiter character stays with the preceding sentence.
        const sentences = text
            .split(/(?<=[.!?])\s+|\n{2,}/)
            .map(s => s.trim())
            .filter(s => s.length > 0);

        return sentences;
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
     * Strip HTML tags and decode all HTML entities from text.
     * @private
     */
    _stripHtml(html) {
        const namedEntities = {
            nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
            mdash: '—', ndash: '–', hellip: '…',
            lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
            copy: '©', reg: '®', trade: '™',
            eacute: 'é', ecirc: 'ê', egrave: 'è', euml: 'ë',
            aacute: 'á', acirc: 'â', agrave: 'à', auml: 'ä', atilde: 'ã', aring: 'å',
            iacute: 'í', icirc: 'î', igrave: 'ì', iuml: 'ï',
            oacute: 'ó', ocirc: 'ô', ograve: 'ò', ouml: 'ö', otilde: 'õ',
            uacute: 'ú', ucirc: 'û', ugrave: 'ù', uuml: 'ü',
            ccedil: 'ç', ntilde: 'ñ', szlig: 'ß',
            Eacute: 'É', Aacute: 'Á', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
            euro: '€', pound: '£', yen: '¥',
            frac12: '½', frac14: '¼', frac34: '¾',
        };

        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            // Decode named HTML entities
            .replace(/&([a-zA-Z]+);/g, (_, name) => namedEntities[name] ?? _)
            // Decode decimal numeric entities (e.g. &#8211;)
            .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
            // Decode hex numeric entities (e.g. &#x2014;)
            .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
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
    async batchProcess(documents, type) {
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
                        // processConfluencePage is async (Gemini fallback classification)
                        chunks = await this.processConfluencePage(doc);
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