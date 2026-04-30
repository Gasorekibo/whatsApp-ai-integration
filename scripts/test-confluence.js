import confluence from '../src/utils/confluence.js';
import dotenv from 'dotenv';
import logger from '../src/logger/logger.js';

dotenv.config();

// Mock logger to avoid cluttering actual logs during test script run
// or just let it log to console if logger is configured to do so
if (!logger.transports || logger.transports.length === 0) {
    logger.add(new winston.transports.Console({
        format: winston.format.simple(),
    }));
}

async function testConfluence() {
    console.log('--- Starting Confluence Integration Test ---');
    console.log(`Base URL: ${process.env.CONFLUENCE_BASE_URL}`);
    console.log(`Space Key: ${process.env.CONFLUENCE_SPACE_KEY}`);
    console.log(`Email: ${process.env.CONFLUENCE_EMAIL}`);

    try {
        console.log('\n1. Testing fetchPages...');
        const pages = await confluence.fetchPages();
        console.log(`✅ Successfully fetched ${pages.length} pages.`);

        if (pages.length > 0) {
            console.log('\n--- First Page Sample ---');
            const page = pages[0];
            console.log(`ID: ${page.id}`);
            console.log(`Title: ${page.title}`);
            console.log(`Version: ${page.version?.number}`);
            console.log(`Body length: ${page.body?.storage?.value?.length || 0}`);
        } else {
            console.warn('⚠️ No pages returned. Check if the space is empty or permissions are correct.');
        }

    } catch (error) {
        console.error('❌ Test Failed:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
    }
}

testConfluence();
