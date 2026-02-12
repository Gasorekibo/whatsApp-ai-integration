import dbConfig from '../models/index.js';
import paymentWebhookHandler from '../helpers/paymentWebhookHandler.js';
import dotenv from 'dotenv';
import { bookingService } from '../services/booking.service.js';

dotenv.config();

/**
 * MOCKING ServiceRequest and BookingService
 * We want to test the logic flow in paymentWebhookHandler
 */

async function runTest() {
    console.log('--- Starting Webhook Handler Test ---');

    // 1. Prepare a mock payload
    const txRef = `test-ref-${Date.now()}`;
    const mockPayload = {
        event: 'charge.completed',
        data: {
            status: 'successful',
            tx_ref: txRef,
            amount: 5000,
            currency: 'RWF',
            payment_type: 'card',
            id: 12345
        },
        meta: {
            phone: '250787929698',
            booking_details: JSON.stringify({
                name: 'Test User',
                email: 'test@example.com',
                service: 'Consultation',
                slotStart: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
                slotEnd: new Date(Date.now() + 86400000 + 3600000).toISOString()
            })
        }
    };

    const mockReq = {
        headers: {
            'verif-hash': process.env.FLW_WEBHOOK_SECRET
        },
        body: mockPayload
    };

    const mockRes = {
        status: (code) => {
            console.log('Response Status:', code);
            return {
                json: (data) => console.log('Response JSON:', data),
                end: () => console.log('Response Ended')
            };
        }
    };

    try {
        // 2. Create a dummy ServiceRequest to be found by the handler
        await dbConfig.db.ServiceRequest.create({
            txRef: txRef,
            amount: 5000,
            paymentStatus: 'pending',
            status: 'pending_payment',
            phone: '250787929698',
            email: 'test@example.com',
            name: 'Test User',
            service: 'Consultation'
        });

        console.log('✅ Created dummy ServiceRequest');

        // 3. Spy/Mock the bookingService (optional, but good to know it's called)
        // For now, we'll let it try to call Google API, but we expect it might fail if tokens are old.
        // That's actually GOOD for testing the error path!

        console.log('--- Executing Handler ---');
        await paymentWebhookHandler(mockReq, mockRes);
        console.log('--- Handler Execution Finished ---');

        // 4. Check database state
        const updatedRequest = await dbConfig.db.ServiceRequest.findOne({ where: { txRef: txRef } });
        console.log('Updated Request Status:', updatedRequest.status);
        console.log('Updated Payment Status:', updatedRequest.paymentStatus);

    } catch (error) {
        console.error('Test Error:', error);
    } finally {
        // Cleanup if needed
        // await dbConfig.db.ServiceRequest.destroy({ where: { txRef: txRef } });
        process.exit();
    }
}

runTest();
