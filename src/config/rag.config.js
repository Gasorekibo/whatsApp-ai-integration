import dotenv from 'dotenv';
dotenv.config();   
/**
 * RAG Configuration for WhatsApp Chatbot
 * Defines settings for vector database, embeddings, and retrieval
 */

export default {
    // Vector Database Configuration
    vectorDB: {
        provider: process.env.VECTOR_DB_PROVIDER || 'pinecone',

        pinecone: {
            // Fix typo in .env: PINECON -> PINECONE
            apiKey: process.env.PINECON_API_KEY || process.env.PINECONE_API_KEY,
            environment: process.env.PINECONE_ENVIRONMENT || 'us-east-1',
            indexName: process.env.PINECON_INDEX_NAME || process.env.PINECONE_INDEX_NAME || 'moyo-tech-chatbot',
            dimension: 3072, // gemini-embedding-001 uses 3072
            metric: 'cosine',
            cloud: 'aws',
            region: 'us-east-1'
        },

        chromadb: {
            path: process.env.CHROMADB_PATH || './data/chromadb',
            collectionName: 'moyo-tech-kb'
        }
    },

    // Embedding Configuration
    embedding: {
        provider: 'gemini', // Using Google's Gemini embeddings (free with API key)
        // Valid models: gemini-embedding-001, text-embedding-004 (if available)
        model: process.env.EMBEDDING_MODEL || 'gemini-embedding-001',
        dimensions: 3072, // gemini-embedding-001 uses 3072
        batchSize: 100, // Max embeddings per batch request
        cache: {
            enabled: true,
            ttl: 86400, // 24 hours
            maxKeys: 1000
        },
        taskType: 'RETRIEVAL_DOCUMENT', // For documents
        queryTaskType: 'RETRIEVAL_QUERY' // For user queries
    },

    // Retrieval Configuration
    retrieval: {
        topK: 5, // Max chunks to retrieve per query
        minScore: 0.65, // Similarity threshold (0-1)
        includeMetadata: true,
        includeValues: false, // Don't return raw vectors

        // Context window budgets (in tokens)
        maxContextTokens: 1000, // Max tokens for retrieved context
        baseInstructionTokens: 300, // Reserved for base instruction
        dynamicDataTokens: 500 // Reserved for slots, date, etc.
    },

    // Document Chunking Strategy
    chunking: {
        maxChunkSize: 400, // Max words per chunk
        minChunkSize: 50, // Min words per chunk
        overlap: 50, // Overlapping words between chunks

        // Type-specific chunking
        service: {
            chunkByService: true, // One chunk per service
            includeDetails: true
        },

        companyInfo: {
            maxChunkSize: 300,
            semanticSplit: true // Split by semantic meaning
        },

        faq: {
            chunkByQA: true // One Q&A pair per chunk
        }
    },

    // Knowledge Base Metadata Schema
    metadata: {
        types: ['service', 'company_info', 'booking_rule', 'faq', 'general'],
        languages: ['en', 'fr', 'rw'], // English, French, Kinyarwanda
        priorities: {
            service: 10,
            booking_rule: 9,
            faq: 8,
            company_info: 7,
            general: 5
        }
    },

    // Cache Configuration
    cache: {
        enabled: true,
        ttl: 3600, // 1 hour in seconds
        checkPeriod: 600, // Check for expired items every 10 minutes
        maxKeys: 1000 // Max cached embeddings
    },

    // Sync Configuration
    sync: {
        autoSync: true,
        syncInterval: 3600000, // 1 hour in ms
        sources: {
            googleSheets: true,
            microsoftExcel: true,
            website: false // Enable when website is accessible
        }
    }
};
