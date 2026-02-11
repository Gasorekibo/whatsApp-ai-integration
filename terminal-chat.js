import readline from 'readline';
import { processWithGemini } from './src/helpers/whatsapp/processWithGemini.js';
import dotenv from 'dotenv';

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});

const phoneNumber = '+250788123456';
let history = [];

console.log('🤖 Moyo Tech AI - Terminal Chat Interface');
console.log('Type "exit" or "quit" to stop. Type "clear" to reset history.');
console.log('------------------------------------------');

async function ask() {
    rl.question('👤 You: ', async (message) => {
        if (message.toLowerCase() === 'exit' || message.toLowerCase() === 'quit') {
            console.log('👋 Goodbye!');
            rl.close();
            return;
        }

        if (message.toLowerCase() === 'clear') {
            history = [];
            console.log('🧹 Chat history cleared.');
            ask();
            return;
        }

        try {
            console.log('⏳ Thinking...');
            const result = await processWithGemini(phoneNumber, message, history);

            let replyText = '';

            if (result.showServices) {
                replyText = '📱 [UI ACTION: SHOW SERVICES LIST]';
            } else if (result.showSlots) {
                replyText = '📱 [UI ACTION: SHOW AVAILABLE SLOTS]';
            } else {
                replyText = result.reply;
            }

            console.log(`🤖 Agent: ${replyText}`);

            // Update history (simplified for testing)
            history.push({ role: 'user', content: message });
            history.push({ role: 'assistant', content: replyText });

            // Keep history manageable
            if (history.length > 20) history = history.slice(-20);

        } catch (error) {
            console.error('❌ Error:', error.message);
        }

        ask();
    });
}

// Initial prompt
ask();
