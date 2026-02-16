import logger from '../logger/logger.js';
import ragConfig from '../config/rag.config.js';

class ConfluenceClient {
    constructor() {
        this.config = ragConfig.sync.confluence;
        this.auth = Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64');
    }

    /**
     * Fetch pages from Confluence
     * @param {string} spaceKey - Optional space key override
     * @returns {Promise<Array>} - List of pages
     */
    async fetchPages(spaceKey = null) {
        const key = spaceKey || this.config.spaceKey;
        if (!key) {
            throw new Error('Confluence Space Key is required');
        }

        try {
            logger.info(`Fetching Confluence pages for space: ${key}`);
            const url = `${this.config.baseUrl}/rest/api/content?spaceKey=${key}&expand=body.storage,version`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${this.auth}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error('Confluence API error', { status: response.status, body: errorText });
                throw new Error(`Confluence API failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const pages = data.results || [];
            logger.info(`Fetched ${pages.length} pages from Confluence`);
            return pages;

        } catch (error) {
            console.log(error)
            logger.error('Error fetching Confluence pages', { error: error.message });
            throw error;
        }
    }
}

export default new ConfluenceClient();
