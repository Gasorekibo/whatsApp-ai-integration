import express from 'express';
import knowledgeBaseService from '../services/knowledge-base.service.js';
import ragService from '../services/rag.service.js';
import logger from '../logger/logger.js';
import ragConfig from '../config/rag.config.js';
import dbConfig from '../models/index.js';
import googleSheets from '../utils/googlesheets.js';
const router = express.Router();

async function resolveNamespace(clientId) {
    if (!clientId) return 'default';
    const client = await dbConfig.db.Client.findOne({ where: { id: clientId }, attributes: ['pineconeIndex'] });
    return client?.pineconeIndex || clientId;
}

/**
 * Knowledge Base Admin API Routes
 * Provides endpoints for managing the RAG knowledge base
 */

// Middleware for authentication (add your own auth logic)
const authenticateAdmin = (req, res, next) => {
    // TODO: Implement proper authentication
    // For now, using a simple token check
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (token === process.env.ADMIN_API_TOKEN || process.env.NODE_ENV === 'development') {
        next();
    } else {
        res.status(401).json({
            success: false,
            message: 'Unauthorized'
        });
    }
};

// Sync services from Google Sheets
router.post('/kb/sync/sheets', async (req, res) => {
    try {
        const clientId = req.body?.clientId || null;

        // Resolve spreadsheet ID: request body → client's saved googleSheetId → server default
        let spreadsheetId = req.body?.spreadsheetId || null;
        if (!spreadsheetId && clientId) {
            const clientRow = await dbConfig.db.Client.findOne({ where: { id: clientId }, attributes: ['googleSheetId'] });
            spreadsheetId = clientRow?.googleSheetId || null;
        }
        spreadsheetId = spreadsheetId || process.env.GOOGLE_SHEET_ID;

        if (!spreadsheetId) {
            return res.status(400).json({
                success: false,
                message: 'No spreadsheet configured. Set a Google Sheet ID in the client settings or GOOGLE_SHEET_ID env var.'
            });
        }

        // Step 1 — find the employee OAuth token for this client
        const employeeWhere = clientId
            ? { clientId }
            : { email: process.env.EMPLOYEE_EMAIL };

        const employee = await dbConfig.db.Employee.findOne({ where: employeeWhere });
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'No Google account connected for this client. Use the 📅 Calendar button to connect one first.'
            });
        }

        const token = employee.getDecryptedToken();
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Google OAuth token missing. Reconnect the calendar via the 📅 Calendar button.'
            });
        }

        // Step 2 — pull from Google Sheets → save to Content table (PostgreSQL)
        logger.info('Calling syncServicesFromSheet', { spreadsheetId, clientId, hasToken: !!token });
        const sheetResult = await googleSheets.syncServicesFromSheet(spreadsheetId, token, clientId);
        logger.info('syncServicesFromSheet result', { success: sheetResult.success, message: sheetResult.message, serviceCount: sheetResult.services?.length ?? 'N/A' });

        if (!sheetResult.success) {
            return res.status(500).json({
                success: false,
                message: `Google Sheets read failed: ${sheetResult.message}`
            });
        }

        // Step 3 — push Content table services → Pinecone (RAG)
        const namespace = await resolveNamespace(clientId);
        logger.info('Pushing to Pinecone', { clientId, namespace });
        const count = await knowledgeBaseService.syncServicesFromSheets(clientId, namespace);

        res.json({
            success: true,
            message: `Synced ${sheetResult.services?.length || 0} services from Google Sheets`,
            dbCount:  sheetResult.services?.length || 0,
            ragChunks: count
        });
    } catch (error) {
        logger.error('Sync error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to sync services from Google Sheets',
            error: error.message
        });
    }
});

// Sync services from Microsoft Excel
router.post('/kb/sync/microsoft', async (req, res) => {
    try {
        const clientId = req.body?.clientId || null;
        const namespace = await resolveNamespace(clientId);
        const count = await knowledgeBaseService.syncServicesFromMicrosoft(clientId, namespace);
console.log('clientId:', clientId, 'namespace:', namespace, 'count:', count);
        res.json({
            success: true,
            message: 'Services synced from Microsoft Excel',
            count
        });
    } catch (error) {
        logger.error('Sync error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to sync services',
            error: error.message
        });
    }
});

/**
 * @route POST /api/kb/sync/confluence
 * @desc Sync data from Confluence
 * @access Private
 */
router.post('/kb/sync/confluence', async (req, res) => {
    try {
        logger.info('Syncing from Confluence requested via API');

        // Check if Confluence sync is enabled
        if (!ragConfig.sync.sources.confluence) {
            return res.status(400).json({
                success: false,
                message: 'Confluence sync is disabled in configuration'
            });
        }

        const clientId = req.body?.clientId || null;
        const namespace = await resolveNamespace(clientId);
        const count = await knowledgeBaseService.syncFromConfluence({ namespace }, clientId);

        res.json({
            success: true,
            message: `Successfully synced ${count} chunks from Confluence`,
            count
        });
    } catch (error) {
        console.log(error)
        logger.error('Confluence sync error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to sync from Confluence',
            error: error.message
        });
    }
});

// Add company information documents
router.post('/kb/company-info', authenticateAdmin, async (req, res) => {
    try {
        const { documents } = req.body;

        if (!Array.isArray(documents) || documents.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Documents array is required'
            });
        }

        await knowledgeBaseService.addCompanyInfo(documents);

        res.json({
            success: true,
            message: `Added ${documents.length} company info documents`
        });
    } catch (error) {
        logger.error('Add company info error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to add company info',
            error: error.message
        });
    }
});

// Add FAQs
router.post('/kb/faqs', async (req, res) => {
    try {
        const { faqs, language = 'en' } = req.body;

        if (!Array.isArray(faqs) || faqs.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'FAQs array is required'
            });
        }

        await knowledgeBaseService.addFAQs(faqs, language);

        res.json({
            success: true,
            message: `Added ${faqs.length} FAQs`
        });
    } catch (error) {
        logger.error('Add FAQs error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to add FAQs',
            error: error.message
        });
    }
});

// Add booking rules
router.post('/kb/booking-rules', async (req, res) => {
    try {
        const { bookingInfo } = req.body;

        if (!bookingInfo) {
            return res.status(400).json({
                success: false,
                message: 'bookingInfo object is required'
            });
        }

        await knowledgeBaseService.addBookingRules(bookingInfo);

        res.json({
            success: true,
            message: 'Booking rules added successfully'
        });
    } catch (error) {
        logger.error('Add booking rules error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to add booking rules',
            error: error.message
        });
    }
});

// Rebuild entire knowledge base
router.post('/kb/rebuild', async (req, res) => {
    try {
        const summary = await knowledgeBaseService.rebuildIndex();

        res.json({
            success: true,
            message: 'Knowledge base rebuilt successfully',
            summary
        });
    } catch (error) {
        logger.error('Rebuild error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to rebuild knowledge base',
            error: error.message
        });
    }
});

// Clear knowledge base
router.delete('/kb/clear', async (req, res) => {
    try {
        await knowledgeBaseService.clearKnowledgeBase();

        res.json({
            success: true,
            message: 'Knowledge base cleared successfully'
        });
    } catch (error) {
        logger.error('Clear error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to clear knowledge base',
            error: error.message
        });
    }
});

// Test semantic search
router.post('/kb/search', async (req, res) => {
    try {
        const { query, topK = 5 } = req.body;

        if (!query) {
            return res.status(400).json({
                success: false,
                message: 'Query is required'
            });
        }

        const result = await ragService.retrieveContext(query, [], topK);

        res.json({
            success: true,
            query,
            intent: result.intent,
            language: result.language,
            relevantDocs: result.relevantDocs,
            context: result.context,
            results: result.results.map(r => ({
                id: r.id,
                score: r.score,
                metadata: r.metadata
            }))
        });
    } catch (error) {
        logger.error('Search error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Search failed',
            error: error.message
        });
    }
});

// Get knowledge base statistics
router.get('/kb/stats', async (req, res) => {
    try {
        const stats = await knowledgeBaseService.getStats();
        const cacheStats = ragService.getCacheStats();

        res.json({
            success: true,
            stats: {
                ...stats,
                cache: cacheStats
            }
        });
    } catch (error) {
        logger.error('Stats error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to get stats',
            error: error.message
        });
    }
});

// Health check
router.get('/kb/health', async (req, res) => {
    try {
        const stats = await knowledgeBaseService.getStats();

        res.json({
            success: true,
            status: 'operational',
            totalDocuments: stats.totalDocuments,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            status: 'degraded',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

export default router;
