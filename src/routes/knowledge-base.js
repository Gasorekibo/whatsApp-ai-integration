const express = require('express');
const knowledgeBaseService = require('../services/knowledge-base.service');
const ragService = require('../services/rag.service');
const router = express.Router();

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
        const count = await knowledgeBaseService.syncServicesFromSheets();

        res.json({
            success: true,
            message: 'Services synced from Google Sheets',
            count
        });
    } catch (error) {
        console.error('❌ Sync error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to sync services',
            error: error.message
        });
    }
});

// Sync services from Microsoft Excel
router.post('/kb/sync/microsoft', async (req, res) => {
    try {
        const count = await knowledgeBaseService.syncServicesFromMicrosoft();

        res.json({
            success: true,
            message: 'Services synced from Microsoft Excel',
            count
        });
    } catch (error) {
        console.error('❌ Sync error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to sync services',
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
        console.error('❌ Add company info error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add company info',
            error: error.message
        });
    }
});

// Add FAQs
router.post('/kb/faqs', authenticateAdmin, async (req, res) => {
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
        console.error('❌ Add FAQs error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add FAQs',
            error: error.message
        });
    }
});

// Add booking rules
router.post('/kb/booking-rules', authenticateAdmin, async (req, res) => {
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
        console.error('❌ Add booking rules error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add booking rules',
            error: error.message
        });
    }
});

// Rebuild entire knowledge base
router.post('/kb/rebuild', authenticateAdmin, async (req, res) => {
    try {
        const summary = await knowledgeBaseService.rebuildIndex();

        res.json({
            success: true,
            message: 'Knowledge base rebuilt successfully',
            summary
        });
    } catch (error) {
        console.error('❌ Rebuild error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to rebuild knowledge base',
            error: error.message
        });
    }
});

// Clear knowledge base
router.delete('/kb/clear', authenticateAdmin, async (req, res) => {
    try {
        await knowledgeBaseService.clearKnowledgeBase();

        res.json({
            success: true,
            message: 'Knowledge base cleared successfully'
        });
    } catch (error) {
        console.error('❌ Clear error:', error);
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
        console.error('❌ Search error:', error);
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
        console.error('❌ Stats error:', error);
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

module.exports = router;
