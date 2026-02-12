const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();
const ragConfig = require('../config/rag.config');

async function recreateIndex() {
    const apiKey = process.env.PINECON_API_KEY || process.env.PINECONE_API_KEY;
    const indexName = ragConfig.vectorDB.pinecone.indexName;
    const dimension = 3072; // Match gemini-embedding-001

    if (!apiKey) {
        console.error("❌ PINECON_API_KEY not found");
        return;
    }

    const pc = new Pinecone({ apiKey });

    console.log(`🔄 Checking index: ${indexName}...`);
    const { indexes } = await pc.listIndexes();
    const indexExists = indexes?.some(idx => idx.name === indexName);

    if (indexExists) {
        console.log(`🗑️ Deleting existing index: ${indexName} (due to dimension mismatch)...`);
        await pc.deleteIndex(indexName);
        console.log("⏳ Waiting for deletion to complete...");
        await new Promise(resolve => setTimeout(resolve, 10000));
    }

    console.log(`📝 Creating new index: ${indexName} with dimension ${dimension}...`);
    await pc.createIndex({
        name: indexName,
        dimension: dimension,
        metric: 'cosine',
        spec: {
            serverless: {
                cloud: 'aws',
                region: 'us-east-1'
            }
        }
    });

    console.log("⏳ Waiting for index to be ready...");
    let ready = false;
    while (!ready) {
        const desc = await pc.describeIndex(indexName);
        ready = desc.status?.ready;
        if (!ready) {
            process.stdout.write(".");
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    console.log("\n✅ Index recreated and ready!");
}

recreateIndex().catch(console.error);
