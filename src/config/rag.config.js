import dotenv from 'dotenv';
dotenv.config();

/**
 * RAG Configuration for WhatsApp Chatbot
 * Defines settings for vector database, embeddings, and retrieval
 * 
 * CHANGELOG:
 * - Fixed embedding dimensions (3072 -> 768)
 * - Added retry configuration
 * - Added hybrid search support
 * - Added reranking configuration
 * - Improved error handling settings
 */

export default {
    // Vector Database Configuration
    vectorDB: {
        provider: process.env.VECTOR_DB_PROVIDER || 'pinecone',

        pinecone: {
            apiKey: process.env.PINECON_API_KEY || process.env.PINECONE_API_KEY,
            environment: process.env.PINECONE_ENVIRONMENT || 'us-east-1',
            indexName: process.env.PINECON_INDEX_NAME || process.env.PINECONE_INDEX_NAME || 'moyo-tech-chatbot',
            dimensions: 768, // FIXED: gemini-embedding-001 produces 768-dimensional vectors, NOT 3072
            metric: 'cosine',
            cloud: 'aws',
            region: 'us-east-1',
            
            // Connection pool settings
            maxRetries: 3,
            retryDelay: 1000, // Base delay in ms
            timeout: 30000, // 30 seconds
            
            // Batch settings
            maxBatchSize: 100,
            upsertBatchSize: 100
        }
    },

    // Embedding Configuration
    embedding: {
        provider: 'gemini',
        model: process.env.EMBEDDING_MODEL || 'gemini-embedding-001', // Updated to newer model
        dimensions: 768, // FIXED: Correct dimension for Gemini embeddings
        batchSize: 50, // Reduced from 100 to be safer with API limits
        maxConcurrentBatches: 3, // Process max 3 batches concurrently
        
        // Retry configuration
        maxRetries: 3,
        retryDelay: 1000,
        retryBackoffMultiplier: 2, // Exponential backoff
        
        // Rate limiting
        rateLimitPerMinute: 1500, // Gemini API limit
        requestsPerSecond: 15, // Conservative rate limiting
        
        cache: {
            enabled: true,
            ttl: 86400, // 24 hours
            maxKeys: 5000, // Increased from 1000
            useHashForLongKeys: true, // Hash keys longer than 200 chars
            hashKeyThreshold: 200
        },
        taskType: 'RETRIEVAL_DOCUMENT',
        queryTaskType: 'RETRIEVAL_QUERY'
    },

    // Retrieval Configuration
    retrieval: {
        topK: 8, // Increased from 5 for better recall
        minScore: 0.65, // Similarity threshold (0-1)
        includeMetadata: true,
        includeValues: false,

        // Reranking configuration (optional but recommended)
        reranking: {
            enabled: false, // Enable when you have a reranker model
            topKBeforeRerank: 20, // Fetch more, then rerank
            finalTopK: 5
        },

        // Hybrid search (combine vector + keyword search)
        hybridSearch: {
            enabled: false, // Enable when needed
            alpha: 0.7, // Weight for vector search (0-1), 1 = pure vector
            keywordWeight: 0.3 // Weight for keyword search
        },

        // Context window budgets (in tokens)
        maxContextTokens: 2000, // Increased for more context
        baseInstructionTokens: 400,
        dynamicDataTokens: 600,
        
        // Query enhancement
        queryExpansion: {
            enabled: true,
            synonymsEnabled: true,
            maxExpansionTerms: 3
        }
    },

    // Document Chunking Strategy
    chunking: {
        maxChunkSize: 400, // words
        minChunkSize: 100, // Increased from 50 for better semantic coherence
        overlap: 100, // Increased overlap for better context

        // Type-specific chunking
        service: {
            chunkByService: true,
            includeDetails: true,
            maxChunkSize: 300 // Smaller for focused service info
        },

        companyInfo: {
            maxChunkSize: 400,
            minChunkSize: 100,
            semanticSplit: true,
            preserveParagraphs: true // Try to keep paragraphs intact
        },

        faq: {
            chunkByQA: true,
            includeContext: true // Include surrounding context
        },

        confluence: {
            maxChunkSize: 500,
            minChunkSize: 100,
            preserveHeaders: true,
            includePageTitle: true
        }
    },

    // Knowledge Base Metadata Schema
    metadata: {
        types: ['service', 'company_info', 'booking_rule', 'faq', 'general', 'confluence_page'],
        languages: ['en', 'fr', 'rw'],
        priorities: {
            service: 10,
            booking_rule: 9,
            faq: 8,
            company_info: 7,
            confluence_page: 6,
            general: 5
        },
        
        // Required fields for each document
        requiredFields: ['type', 'language', 'priority', 'content', 'updated_at'],
        
        // Searchable fields (for filtering)
        filterableFields: ['type', 'language', 'source', 'category']
    },

    // Cache Configuration
    cache: {
        enabled: true,
        ttl: 7200, // 2 hours (reduced from 1 hour for fresher data)
        checkPeriod: 300, // 5 minutes
        maxKeys: 5000, // Increased capacity
        enableStats: true
    },

    // Sync Configuration
    sync: {
        autoSync: true,
        syncInterval: 3600000, // 1 hour
        
        sources: {
            googleSheets: true,
            microsoftExcel: true,
            confluence: true,
            website: false
        },
        
        confluence: {
            baseUrl: process.env.CONFLUENCE_BASE_URL,
            email: process.env.CONFLUENCE_EMAIL,
            apiToken: process.env.CONFLUENCE_API_TOKEN,
            spaceKey: process.env.CONFLUENCE_SPACE_KEY,
            maxPages: 100, // Limit for initial sync
            batchSize: 10 // Process 10 pages at a time
        },
        
        // Sync error handling
        errorHandling: {
            continueOnError: true,
            maxConsecutiveErrors: 5,
            notifyOnError: true
        }
    },

    // Intent Classification
    intentClassification: {
        enabled: true,
        cacheResults: true,
        cacheTTL: 3600, // 1 hour
        
        intents: {
            booking: {
                keywords: ['book', 'schedule', 'appointment', 'meeting', 'consultation', 'reserve'],
                priority: 10
            },
            service_inquiry: {
                keywords: ['service', 'offer', 'provide', 'do you have', 'capabilities', 'what do you do'],
                priority: 9
            },
            faq: {
                keywords: ['price', 'cost', 'location', 'where', 'how much', 'payment'],
                priority: 8
            },
            general: {
                keywords: ['hello', 'hi', 'hey', 'help', 'thanks'],
                priority: 5
            }
        }
    },

    // Language Detection
    languageDetection: {
        enabled: true,
        defaultLanguage: 'en',
        supportedLanguages: ['en', 'fr', 'rw'],
        
        // Use proper language detection library
        useFranc: true, // If you install 'franc' package
        fallbackToPatterns: true,
        
        patterns: {
            rw: [/muraho/i, /ese/i, /amakuru/i, /mwaramutse/i, /urakoze/i],
            fr: [/bonjour/i, /salut/i, /merci/i, /au revoir/i, /comment/i]
        }
    },

    // Performance Monitoring
    monitoring: {
        enabled: true,
        logSlowQueries: true,
        slowQueryThreshold: 2000, // ms
        trackEmbeddingLatency: true,
        trackRetrievalLatency: true
    },

    // Error Handling
    errorHandling: {
        maxRetries: 3,
        retryDelay: 1000,
        exponentialBackoff: true,
        fallbackToCache: true,
        returnPartialResults: true // Return what we have even if some operations fail
    }
};