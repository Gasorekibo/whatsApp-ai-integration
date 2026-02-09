#!/usr/bin/env node

/**
 * RAG Setup Script
 * Initializes the RAG system and populates the knowledge base
 * Usage: node src/scripts/setup-rag.js
 */

require('dotenv').config();
const vectorDBService = require('../services/vector-db.service');
const embeddingService = require('../services/embedding.service');
const knowledgeBaseService = require('../services/knowledge-base.service');
const ragService = require('../services/rag.service');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    red: '\x1b[31m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
    console.log('\n' + '='.repeat(60));
    log(title, 'bright');
    console.log('='.repeat(60));
}

async function testConnections() {
    section('Step 1: Testing Connections');

    try {
        // Test embedding service
        log('Testing Gemini embedding service...', 'blue');
        const embeddingTest = await embeddingService.testConnection();

        if (!embeddingTest) {
            throw new Error('Embedding service test failed');
        }

        log('✅ Embedding service connected', 'green');

        // Test vector database
        log('\nTesting Pinecone vector database...', 'blue');
        const vectorDBTest = await vectorDBService.testConnection();

        if (!vectorDBTest) {
            throw new Error('Vector DB test failed');
        }

        log('✅ Vector database connected', 'green');

        return true;
    } catch (error) {
        log(`❌ Connection test failed: ${error.message}`, 'red');
        return false;
    }
}

async function initializeKnowledgeBase() {
    section('Step 2: Initializing Knowledge Base');

    try {
        log('Initializing knowledge base service...', 'blue');
        await knowledgeBaseService.initialize();
        log('✅ Knowledge base service initialized', 'green');

        return true;
    } catch (error) {
        log(`❌ Initialization failed: ${error.message}`, 'red');
        return false;
    }
}

async function createInitialDocuments() {
    section('Step 3: Creating Initial Documents');

    try {
        // Add company information
        log('\n📝 Adding company information...', 'blue');
        const companyDocs = [
            {
                id: 'about-moyo-tech',
                title: 'About Moyo Tech Solutions',
                content: `Moyo Tech Solutions is a leading IT consultancy based in Rwanda. We specialize in providing cutting-edge technology solutions to businesses across East Africa. Our team of expert consultants helps organizations transform their operations through innovative digital solutions.`,
                language: 'en'
            },
            {
                id: 'services-overview',
                title: 'Our Services',
                content: `We offer comprehensive IT consulting services including: Custom Software Development, SAP Implementation and Consulting, Cloud Solutions and Migration, IT Training and Certifications, Cybersecurity Services, and Digital Transformation Consulting. Each service is tailored to meet the unique needs of our clients.`,
                language: 'en'
            },
            {
                id: 'contact-info',
                title: 'Contact Information',
                content: `Moyo Tech Solutions is located in Kigali, Rwanda. You can reach us via email at hello@moyotech.solutions or through our WhatsApp chatbot. For consultation bookings, a commitment deposit is required to secure your slot.`,
                language: 'en'
            }
        ];

        await knowledgeBaseService.addCompanyInfo(companyDocs);
        log(`✅ Added ${companyDocs.length} company information documents`, 'green');

        // Add FAQs
        log('\n📝 Adding FAQ documents...', 'blue');
        const faqs = [
            {
                question: 'What services does Moyo Tech offer?',
                answer: 'We offer Custom Software Development, SAP Consulting, Cloud Solutions, IT Training, Cybersecurity Services, and Digital Transformation Consulting.',
                category: 'services'
            },
            {
                question: 'How do I book a consultation?',
                answer: 'Simply tell me what service you\'re interested in, choose an available time slot, and pay the commitment deposit. You\'ll receive a confirmation email with a Google Meet link.',
                category: 'booking'
            },
            {
                question: 'Why is a deposit required?',
                answer: 'The deposit ensures both parties are committed to the consultation. It helps us maintain high-quality, serious consultations and reduces no-shows.',
                category: 'booking'
            },
            {
                question: 'What payment methods do you accept?',
                answer: 'We accept payments via Mobile Money and credit/debit cards through our secure Flutterwave payment gateway.',
                category: 'payment'
            },
            {
                question: 'Can I get a refund if I cancel?',
                answer: 'Refund policies depend on when you cancel. Please contact us directly for specific refund requests.',
                category: 'payment'
            }
        ];

        await knowledgeBaseService.addFAQs(faqs, 'en');
        log(`✅ Added ${faqs.length} FAQ documents`, 'green');

        // Add booking rules
        log('\n📝 Adding booking rules...', 'blue');
        const bookingInfo = {
            payment: {
                'Deposit Amount': `${process.env.DEPOSIT_AMOUNT} ${process.env.CURRENCY}`,
                'Purpose': 'Commitment deposit to ensure both parties are serious about the meeting',
                'Payment Gateway': 'Flutterwave (Mobile Money and Cards accepted)',
                'When to Pay': 'Before booking confirmation'
            },
            process: {
                'Step 1': 'Select a service you\'re interested in',
                'Step 2': 'Provide your name, email, and project details',
                'Step 3': 'Choose an available time slot',
                'Step 4': 'Pay the commitment deposit',
                'Step 5': 'Receive confirmation email with Google Meet link'
            },
            slots: {
                'Availability': 'Slots are pulled from our live calendar',
                'Time Zone': 'All times are in Kigali timezone (CAT)',
                'Selection': 'Only choose from the available slots provided - do not request custom times',
                'Duration': 'Standard consultation is 1 hour'
            }
        };

        await knowledgeBaseService.addBookingRules(bookingInfo);
        log('✅ Added booking rule documents', 'green');

        return true;
    } catch (error) {
        log(`❌ Error creating documents: ${error.message}`, 'red');
        return false;
    }
}

async function syncServices() {
    section('Step 4: Syncing Services from Data Sources');

    try {
        let totalServices = 0;

        // Try Google Sheets
        if (process.env.GOOGLE_SHEET_ID) {
            try {
                log('📡 Syncing from Google Sheets...', 'blue');
                const count = await knowledgeBaseService.syncServicesFromSheets();
                totalServices += count;
                log(`✅ Synced ${count} services from Google Sheets`, 'green');
            } catch (error) {
                log(`⚠️ Google Sheets sync failed: ${error.message}`, 'yellow');
            }
        }

        // Try Microsoft Excel
        if (process.env.MICROSOFT_CLIENT_ID) {
            try {
                log('\n📡 Syncing from Microsoft Excel...', 'blue');
                const count = await knowledgeBaseService.syncServicesFromMicrosoft();
                totalServices += count;
                log(`✅ Synced ${count} services from Microsoft Excel`, 'green');
            } catch (error) {
                log(`⚠️ Microsoft Excel sync failed: ${error.message}`, 'yellow');
            }
        }

        if (totalServices === 0) {
            log('⚠️ Warning: No services were synced!', 'yellow');
            return false;
        }

        return true;
    } catch (error) {
        log(`❌ Service sync failed: ${error.message}`, 'red');
        return false;
    }
}

async function verifySetup() {
    section('Step 5: Verifying Setup');

    try {
        // Get statistics
        log('📊 Gathering statistics...', 'blue');
        const stats = await knowledgeBaseService.getStats();

        console.log('\nKnowledge Base Statistics:');
        console.log(`  Total Documents: ${stats.totalDocuments}`);
        console.log(`  Namespaces:`, stats.namespaces);

        const cacheStats = embeddingService.getCacheStats();
        console.log('\nEmbedding Cache Statistics:');
        console.log(`  Cache Enabled: ${cacheStats.enabled}`);
        if (cacheStats.enabled) {
            console.log(`  Cached Items: ${cacheStats.keys}`);
        }

        // Test RAG retrieval
        log('\n🧪 Testing RAG retrieval...', 'blue');
        await ragService.initialize();

        const testQueries = [
            'What services do you offer?',
            'How do I book a consultation?',
            'Tell me about SAP consulting'
        ];

        for (const query of testQueries) {
            log(`\nTest query: "${query}"`, 'blue');
            const result = await ragService.retrieveContext(query);
            log(`  Intent: ${result.intent}`, 'yellow');
            log(`  Language: ${result.language}`, 'yellow');
            log(`  Relevant Docs: ${result.relevantDocs}`, 'yellow');
        }

        log('\n✅ Verification complete!', 'green');
        return true;
    } catch (error) {
        log(`❌ Verification failed: ${error.message}`, 'red');
        return false;
    }
}

async function generateReport() {
    section('Setup Complete!');

    log('\n✅ RAG system is ready to use!', 'green');
    log('\nNext Steps:', 'bright');
    console.log('  1. The RAG system is enabled by default (USE_RAG=true)');
    console.log('  2. To disable RAG temporarily, set USE_RAG=false in .env');
    console.log('  3. Services will auto-sync from Google Sheets/Microsoft Excel');
    console.log('  4. Monitor your Pinecone dashboard for usage');
    console.log('  5. Use the knowledge base API endpoints to manage content');

    log('\nUseful Commands:', 'bright');
    console.log('  - Rebuild index: node src/scripts/rebuild-index.js');
    console.log('  - Test RAG: node src/scripts/test-rag.js');
    console.log('  - Clear cache: Use the admin API endpoints');
}

// Main execution
async function main() {
    console.clear();
    section('RAG System Setup for Moyo Tech WhatsApp Chatbot');

    log('\nThis script will:', 'bright');
    console.log('  ✓ Test connections to Gemini and Pinecone');
    console.log('  ✓ Initialize the knowledge base');
    console.log('  ✓ Create initial documents (company info, FAQs, booking rules)');
    console.log('  ✓ Sync services from Google Sheets/Microsoft Excel');
    console.log('  ✓ Verify the setup with test queries');

    console.log('\nStarting in 3 seconds...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
        // Step 1: Test connections
        const connectionsOk = await testConnections();
        if (!connectionsOk) {
            throw new Error('Connection tests failed. Please check your API keys and configuration.');
        }

        // Step 2: Initialize
        const initOk = await initializeKnowledgeBase();
        if (!initOk) {
            throw new Error('Knowledge base initialization failed.');
        }

        // Step 3: Create initial documents
        const docsOk = await createInitialDocuments();
        if (!docsOk) {
            throw new Error('Failed to create initial documents.');
        }

        // Step 4: Sync services
        const syncOk = await syncServices();
        if (!syncOk) {
            log('⚠️ Warning: Service sync had issues, but continuing...', 'yellow');
        }

        // Step 5: Verify
        const verifyOk = await verifySetup();
        if (!verifyOk) {
            throw new Error('Verification failed.');
        }

        // Generate final report
        await generateReport();

        process.exit(0);
    } catch (error) {
        section('Setup Failed');
        log(`\n❌ Error: ${error.message}`, 'red');
        console.log('\nPlease check:');
        console.log('  1. Your .env file has all required variables (GEMINI_API_KEY, PINECON_API_KEY)');
        console.log('  2. Your Pinecone API key is valid');
        console.log('  3. Your Google Sheets or Microsoft Excel integration is working');
        console.log('  4. You have internet connectivity');

        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { main };
