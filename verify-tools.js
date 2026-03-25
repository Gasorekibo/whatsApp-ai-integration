import { processWithGemini } from './src/helpers/whatsapp/processWithGemini.js';
import ragService from './src/services/rag.service.js';
 function test() {
    console.log('🚀 Starting Gemini Verification Test...')
        ;

       console.log(ragService.detectLanguage('bon après-midi', []));
 }

// Run the test
test()
