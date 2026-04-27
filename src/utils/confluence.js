import logger from '../logger/logger.js';
import ragConfig from '../config/rag.config.js';

class ConfluenceClient {
    constructor() {
        this.defaultConfig = ragConfig.sync.confluence;
    }

    _buildAuth(config) {
        return Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    }

    /**
     * Fetch pages from Confluence.
     * @param {string|null} spaceKey - Space key override
     * @param {object|null} clientConfig - Per-client config { baseUrl, email, apiToken, spaceKey }; falls back to env defaults
     */
    async fetchPages(spaceKey = null, clientConfig = null) {
        const config = clientConfig || this.defaultConfig;
        const auth   = this._buildAuth(config);
        const key    = spaceKey || config.spaceKey;

        if (!key) throw new Error('Confluence Space Key is required');
        if (!config.baseUrl || !config.email || !config.apiToken) {
            throw new Error('Confluence credentials incomplete (baseUrl, email, apiToken required)');
        }

        try {
            logger.info(`Fetching Confluence pages for space: ${key}`, { baseUrl: config.baseUrl });
            const url = `${config.baseUrl}/rest/api/content?spaceKey=${key}&expand=body.storage,version`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${auth}`,
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
            logger.error('Error fetching Confluence pages', { error: error.message });
            throw error;
        }
    }
}

export default new ConfluenceClient();
