/**
 * RAG Testing Script
 * Tests the retrieval and intent classification without needing WhatsApp
 * Usage: node src/scripts/test-rag.js "your query here"
 */

require('dotenv').config();
const ragService = require('../services/rag.service');

async function testQuery(query) {
    console.log('\n' + '='.repeat(50));
    console.log(`🔍 Testing Query: "${query}"`);
    console.log('='.repeat(50));

    try {
        // 1. Initialize RAG
        await ragService.initialize();

        // 2. Retrieve Context
        console.log('\n🔄 Retrieving context...');
        const result = await ragService.retrieveContext(query);

        // 3. Display Results
        console.log('\n📊 Results:');
        console.log(`- Intent: ${result.intent}`);
        console.log(`- Language: ${result.language}`);
        console.log(`- Relevant Docs Found: ${result.relevantDocs}`);

        if (result.relevantDocs > 0) {
            console.log('\n📄 Top Snippets:');
            result.results.slice(0, 3).forEach((match, i) => {
                console.log(`\n[${i + 1}] Score: ${match.score.toFixed(4)}`);
                console.log(`    Title: ${match.metadata.title || 'N/A'}`);
                console.log(`    Content: ${match.metadata.content.substring(0, 150)}...`);
            });
        } else {
            console.log('\n⚠️ No relevant documents found above threshold.');
        }

        // 4. Test Prompt Generation (Optional)
        console.log('\n📝 Augmented Prompt Preview (First 200 chars):');
        const dynamicData = {
            availableSlots: '1. Monday 10 AM\n2. Tuesday 2 PM',
            currentDate: new Date().toLocaleString(),
            depositInfo: '5000 RWF'
        };
        const prompt = ragService.buildAugmentedPrompt(result, query, dynamicData);
        console.log(prompt.substring(0, 200) + '...');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
    }
}

// Get query from command line arguments or use defaults
const query = process.argv[2];

if (query) {
    testQuery(query);
} else {
    // Run a suite of tests
    async function runSuite() {
        const tests = [
            "What services do you offer?",
            "How can I book a meeting?",
            "Tell me about SAP consulting",
            "Murahe, ese mukora iki?" // Kinyarwanda: Hello, what do you do?
        ];

        for (const t of tests) {
            await testQuery(t);
        }
    }
    runSuite();
}
