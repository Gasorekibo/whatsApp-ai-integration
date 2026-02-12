const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function listModels() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // There isn't a direct listModels in the SDK, but we can try to fetch the models list via the REST endpoint directly using the SDK's internal fetch or just plain fetch.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await response.json();
        console.log("Models list:", JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error listing models:", error.message);
    }
}

listModels();
