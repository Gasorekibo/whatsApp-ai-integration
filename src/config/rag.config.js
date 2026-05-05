import dotenv from 'dotenv';
dotenv.config();
export default {
    // Vector Database Configuration
    vectorDB: {
        provider: process.env.VECTOR_DB_PROVIDER || 'pinecone',

        pinecone: {
            enabled: true,
            apiKey: process.env.PINECON_API_KEY || process.env.PINECONE_API_KEY,
            environment: process.env.PINECONE_ENVIRONMENT || 'us-east-1',
            indexName: process.env.PINECON_INDEX_NAME || process.env.PINECONE_INDEX_NAME || 'moyo-tech-chatbot',
            dimensions: 768, 
            metric: 'cosine',
            cloud: 'aws',
            region: 'us-east-1',
            maxRetries: 3,
            retryDelay: 1000, 
            timeout: 30000, 
            maxBatchSize: 100,
            upsertBatchSize: 100
        }
    },
    embedding: {
        provider: 'gemini',
        model: process.env.EMBEDDING_MODEL || 'gemini-embedding-001', 
        dimensions: 768,
        batchSize: 50, 
        maxConcurrentBatches: 3,
        
        // Retry configuration
        maxRetries: 3,
        retryDelay: 1000,
        retryBackoffMultiplier: 2, 
        
        // Rate limiting
        rateLimitPerMinute: 1500, 
        requestsPerSecond: 15, 
        
        cache: {
            enabled: true,
            ttl: 86400, 
            maxKeys: 5000, 
            useHashForLongKeys: true, 
            hashKeyThreshold: 200
        },
        taskType: 'RETRIEVAL_DOCUMENT',
        queryTaskType: 'RETRIEVAL_QUERY'
    },

    // Retrieval Configuration
    retrieval: {
        topK: 8, 
        minScore: 0.30, // Similarity threshold (0-1)
	maxContextChunks: 5,
        includeMetadata: true,
        includeValues: false,
        maxContextChunks: 5,
        deduplication: {
            enabled: false,
            similarityThreshold: 0.95
        },

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
        },
        deduplication: {
        enabled: false,           // turn on if you want automatic dedup
        similarityThreshold: 0.8  // similarity threshold for deduplication
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
	// Query Validation Configuration
   query: {
   	 minQueryLength: 3,
    	maxQueryLength: 1000,
    	preprocessing: {
        lowercase: false  // embeddings handle casing internally
    			}
},
    // Language Detection
    languageDetection: {
        enabled: true,
        defaultLanguage: 'en',
        supportedLanguages: ['en', 'fr', 'rw', 'de', 'sw'],
        
        // Use proper language detection library
        useFranc: true, // If you install 'franc' package
        fallbackToPatterns: true,
        
        patterns: {
            rw: [
                /\b(muraho|mwaramutse|mwiriwe|bite|ego|oya|urakoze|amakuru|ese)\b/i,
                /\b(yego|neza|nonese|ndashaka|muri|natwe|nagufasha|mbwira)\b/i,
                /\b(dore|niba|kugira|cyane|kumenya|mutanga|izihe|none|tubigenze)\b/i,
                /\b(nsubiza|mukinyarwanda|ntabwo|ndimo|kumva|ibyo|urikuvuga)\b/i,
                /\b(murakoze|inama|ubujyanama|amasaha|izina|sosiyete|mwakunda)\b/i,
                /\b(ndashaka|byinshi|kuri|serivisi|nimero|nimere)\b/i,
                /\b(kubika|kugisha|mukoresheje|ifatabuguzi|amafaranga)\b/i,
                /\b(murakaza|nagufasha|uyu|munsi|dushobora|gutera|imbere)\b/i,
                /\b(kwa|ku wa|mbere|kabiri|gatatu|kane|gatanu|cyumweru)\b/i
            ],
            fr: [
                /\b(bonjour|salut|merci|au revoir|comment|est-ce|quel|pourquoi|combien|nous|votre|notre|avec|pour)\b/i,
                /\b(suis|est|sont|fait|faire|peux|pouvez|veut|voulez|quand|dans|cette|qui|quoi|dont)\b/i,
                /\b(développement|logiciel|rdv|rendez-vous|horaires|prix|tarif| Rwanda)\b/i
            ],
            de: [/\b(hallo|guten|morgen|tag|abend|danke|bitte|ja|nein|wie|was|wer|warum|können|möchte|ich|sie|wir|ihr|sprechen|dienst)\b/i],
            sw: [/\b(habari|karibu|asante|ndiyo|hapana|samahani|tafadhali|ninaweza|nataka|kwa|hii|hiyo|huduma|bei|wapi|sijui|sawa)\b/i]
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
