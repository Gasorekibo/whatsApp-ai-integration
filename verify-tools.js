import { processWithGemini } from './src/helpers/whatsapp/processWithGemini.js';

async function test() {
    console.log('🧪 Starting Tool-Oriented Architecture Verification...');

    const phoneNumber = '+250788123456';
    let history = [];

    console.log('\n--- Scenario 1: General Inquiry ---');
    const res1 = await processWithGemini(phoneNumber, 'List all services you offer', history);
    if (res1.showServices) {
        console.log('✅ Success: Gemini triggered "show_services"');
    } else {
        console.log('❌ Failed: Expected showServices trigger.');
    }

    // Scenario 2: FAQ - Pricing
    console.log('\n--- Scenario 2: FAQ Pricing ---');
    const res2 = await processWithGemini(phoneNumber, 'How much does a consultation cost?', history);
    if (res2.reply && res2.reply.includes('deposit')) {
        console.log('✅ Success: FAQ context retrieved correctly.');
    }

    // Scenario 3: Booking Attempt (Incomplete)
    console.log('\n--- Scenario 3: Booking Intent (Missing Info) ---');
    const res3 = await processWithGemini(phoneNumber, 'I want to book a software development consultation', history);
    console.log('🤖 Agent reply:', res3.reply);
    // Agent should ask for name/email/time
    if (res3.reply && (res3.reply.toLowerCase().includes('name') || res3.reply.toLowerCase().includes('email') || res3.reply.toLowerCase().includes('when'))) {
        console.log('✅ Success: Agent asked for missing details.');
    }

    // Scenario 4: Full Booking Flow (Simulated)
    console.log('\n--- Scenario 4: Full Booking Flow ---');
    const fullMessage = 'My name is Gasore, email is gasore@example.com. I want to book Software Development for the first available slot you have listed.';
    const res4 = await processWithGemini(phoneNumber, fullMessage, history);

    if (res4.reply && res4.reply.includes('payment')) {
        console.log('✅ Success: Agent initiated payment or provided payment info.');
    } else {
        console.log('🤖 Agent reply:', res4.reply);
    }

    console.log('\n✨ Verification Complete.');
}

// Run the test
test().then(() => process.exit(0)).catch(err => {
    console.error('❌ Test Failed:', err);
    process.exit(1);
});
