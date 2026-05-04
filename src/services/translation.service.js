import { GoogleGenerativeAI } from '@google/generative-ai';
import NodeCache from 'node-cache';
import dotenv from 'dotenv';
import logger from '../logger/logger.js';

dotenv.config();

// Cache for 24 hours to minimize API calls for the same language/services
const cache = new NodeCache({ stdTTL: 86400 });

class TranslationService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.supportedLanguages = {
            en: 'English',
            fr: 'French',
            rw: 'Kinyarwanda',
            de: 'German',
            sw: 'Swahili',
            kis: 'Swahili'
        };
    }

    /**
     * Translates a list of services into the target language.
     * Uses caching to avoid redundant LLM calls.
     * @param {Array} services - Array of service objects
     * @param {string} locale - Target language code (iso)
     * @returns {Promise<Array>} - Translated services
     */
    async translateServices(services, locale = 'en') {
        const targetLanguage = this.supportedLanguages[locale] || 'English';
        
        // Skip translation for English
        if (targetLanguage === 'English') return services;

        // Generate cache key based on locale and service IDs/Update timestamp
        const serviceIds = services.map(s => s.id).sort().join(',');
        const cacheKey = `services_${locale}_${serviceIds}`;
        
        const cached = cache.get(cacheKey);
        if (cached) {
            logger.debug('Using cached translated services', { locale });
            return cached;
        }

        try {
            logger.info('Translating services via Gemini', { locale, count: services.length });
            
            const model = this.genAI.getGenerativeModel({ 
                model: "gemini-2.5-flash-lite",
                generationConfig: { responseMimeType: "application/json" }
            });
            
            const prompt = `You are a professional translator for an IT consultancy (Moyo Tech Solutions).
Translate the following list of services into ${targetLanguage}.

RULES:
- Keep the "id" and "active" fields EXACTLY as they are.
- Translate "name", "short", and "details".
- Use professional, business-appropriate terminology in ${targetLanguage}.
- Return ONLY a valid JSON array of objects.

Services to translate:
${JSON.stringify(services, null, 2)}

JSON Output:`;

            const result = await model.generateContent(prompt);
            const responseText = result.response.text();
            
            // Robust JSON extraction
            let translated;
            try {
                const jsonMatch = responseText.match(/\[[\s\S]*\]/);
                const jsonToParse = jsonMatch ? jsonMatch[0] : responseText;
                translated = JSON.parse(jsonToParse);
            } catch (err) {
                logger.error('Failed to parse translation JSON', { response: responseText });
                return services;
            }

            // Validate translation vs original count
            if (Array.isArray(translated) && translated.length === services.length) {
                cache.set(cacheKey, translated);
                return translated;
            }

            logger.warn('Translated services count mismatch, using original', { 
                original: services.length, 
                translated: translated?.length 
            });
            return services;

        } catch (error) {
            logger.error('Service translation failed', { error: error.message, locale });
            return services;
        }
    }
}

export default new TranslationService();
