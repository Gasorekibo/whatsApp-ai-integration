/**
 * Config Compatibility Helper
 * Provides safe access to config values with fallbacks for both old and new structures
 */

/**
 * Safely get a nested config value with fallback
 * @param {object} config - Config object
 * @param {string} path - Dot-notation path (e.g., 'cache.embedding.ttl')
 * @param {*} defaultValue - Default value if not found
 * @returns {*} - Config value or default
 */
function getConfigValue(config, path, defaultValue) {
    const keys = path.split('.');
    let current = config;

    for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return defaultValue;
        }
    }

    return current !== undefined ? current : defaultValue;
}

/**
 * Get cache config with fallbacks
 * @param {object} ragConfig - RAG configuration object
 * @param {string} cacheType - 'embedding', 'intent', or 'query'
 * @returns {object} - Cache configuration
 */
export function getCacheConfig(ragConfig, cacheType) {
    // Try new structure first: cache.embedding.enabled
    const newStructure = ragConfig.cache?.[cacheType];
    if (newStructure && typeof newStructure === 'object') {
        return {
            enabled: newStructure.enabled !== false,
            ttl: newStructure.ttl || 86400,
            checkPeriod: newStructure.checkPeriod || newStructure.checkperiod || 3600,
            maxKeys: newStructure.maxKeys || 5000
        };
    }

    // Try old structure: cache.enabled, cache.ttl, etc.
    const oldStructure = ragConfig.cache;
    if (oldStructure && typeof oldStructure === 'object') {
        return {
            enabled: oldStructure.enabled !== false,
            ttl: oldStructure.ttl || 86400,
            checkPeriod: oldStructure.checkPeriod || oldStructure.checkperiod || 3600,
            maxKeys: oldStructure.maxKeys || 1000
        };
    }

    // Default fallback
    return {
        enabled: true,
        ttl: 86400,
        checkPeriod: 3600,
        maxKeys: cacheType === 'embedding' ? 5000 : 1000
    };
}

/**
 * Get rate limit config with fallbacks
 * @param {object} ragConfig - RAG configuration object
 * @returns {object} - Rate limit configuration
 */
export function getRateLimitConfig(ragConfig) {
    return {
        requestsPerMinute: getConfigValue(ragConfig, 'embedding.rateLimit.requestsPerMinute', 1500),
        requestsPerDay: getConfigValue(ragConfig, 'embedding.rateLimit.requestsPerDay', 50000),
        tokensPerMinute: getConfigValue(ragConfig, 'embedding.rateLimit.tokensPerMinute', 32000)
    };
}

/**
 * Get retry config with fallbacks
 * @param {object} ragConfig - RAG configuration object
 * @returns {object} - Retry configuration
 */
export function getRetryConfig(ragConfig) {
    return {
        maxRetries: getConfigValue(ragConfig, 'embedding.maxRetries', 3),
        retryDelay: getConfigValue(ragConfig, 'embedding.retryDelay', 2000),
        retryBackoff: getConfigValue(ragConfig, 'embedding.retryBackoff', 2)
    };
}

/**
 * Get intent config with fallbacks
 * @param {object} ragConfig - RAG configuration object
 * @returns {object} - Intent configuration
 */
export function getIntentConfig(ragConfig) {
    const quickPatterns = getConfigValue(ragConfig, 'intentClassification.quickPatterns', getConfigValue(ragConfig, 'intent.quickPatterns', {
        greeting: /^(hi|hello|hey|muraho|bonjour|salut|mwaramutse|bite)[\s\.,!?]*$/i,
        thanks: /^(thank|thanks|merci|urakoze|asante)[\s\.,!?]*$/i,
        yes: /^(yes|yeah|yep|yup|ok|okay|oui|ego)[\s\.,!?]*$/i,
        no: /^(no|nope|nah|non|oya)[\s\.,!?]*$/i
    }));

    let keywords = getConfigValue(ragConfig, 'intentClassification.intents', null);
    if (keywords && typeof keywords === 'object') {
        const mappedKeywords = {};
        for (const [intent, config] of Object.entries(keywords)) {
            mappedKeywords[intent] = config.keywords || [];
        }
        keywords = mappedKeywords;
    } else {
        keywords = getConfigValue(ragConfig, 'intent.keywords', {
            booking: ['book', 'schedule', 'appointment', 'consultation', 'meeting', 'reserve'],
            service_inquiry: ['service', 'offer', 'provide', 'do', 'capability', 'can you'],
            faq: ['price', 'cost', 'location', 'where', 'when', 'how much', 'hours'],
            payment: ['pay', 'payment', 'deposit', 'cost', 'price', 'fee']
        });
    }

    const llm = getConfigValue(ragConfig, 'intent.llm', {
        model: 'gemini-2.5-flash',
        temperature: 0.1,
        maxTokens: 50
    });

    const categories = getConfigValue(ragConfig, 'intentClassification.categories', getConfigValue(ragConfig, 'intent.categories', [
        'booking', 'service_inquiry', 'faq', 'general', 'payment', 'support'
    ]));

    return { quickPatterns, keywords, llm, categories };
}

/**
 * Get language config with fallbacks
 * @param {object} ragConfig - RAG configuration object
 * @returns {object} - Language configuration
 */
export function getLanguageConfig(ragConfig) {
    const patterns = getConfigValue(ragConfig, 'languageDetection.patterns', getConfigValue(ragConfig, 'language.patterns', {
        rw: [/\b(muraho|mwaramutse|mwiriwe|bite|ego|oya|urakoze|amakuru|ese)\b/i],
        fr: [/\b(bonjour|salut|merci|oui|non|comment|quel|quels|pourquoi|combien)\b/i]
    }));

    const defaultLanguage = getConfigValue(ragConfig, 'languageDetection.defaultLanguage', getConfigValue(ragConfig, 'language.defaultLanguage', 'en'));

    return { patterns, defaultLanguage };
}

export default {
    getConfigValue,
    getCacheConfig,
    getRateLimitConfig,
    getRetryConfig,
    getIntentConfig,
    getLanguageConfig
};