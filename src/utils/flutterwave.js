import fetch from 'node-fetch';
import logger from '../logger/logger.js';

/**
 * Flutterwave Utility Functions
 */
export const flutterwaveUtil = {
    /**
     * Refund a successful transaction
     * @param {string|number} transactionId - The Flutterwave transaction ID
     * @param {number} amount - Amount to refund
     * @returns {Promise<Object>} - API response
     */
    async refundTransaction(transactionId, amount) {
        try {
            logger.payment('info', 'Initiating automated refund', { transactionId, amount });

            const response = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/refund`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.FLW_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ amount })
            });

            const data = await response.json();

            if (data.status === 'success') {
                logger.payment('info', 'Refund initiated successfully', { transactionId, amount });
            } else {
                logger.error('Flutterwave refund failed', {
                    transactionId,
                    error: data.message,
                    data
                });
            }

            return data;
        } catch (error) {
            logger.error('Error calling Flutterwave refund API', {
                transactionId,
                error: error.message
            });
            throw error;
        }
    }
};

export default flutterwaveUtil;
