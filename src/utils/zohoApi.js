import dotenv from 'dotenv';
import logger from '../logger/logger.js';
dotenv.config();

const ZOHO_CONFIG = {
  clientId: process.env.ZOHO_CLIENT_ID,
  clientSecret: process.env.ZOHO_CLIENT_SECRET,
  refreshToken: process.env.ZOHO_REFRESH_TOKEN,
  accountsUrl: 'https://accounts.zoho.com',
  apiUrl: 'https://www.zohoapis.com/crm/v3'
};

let tokenCache = {
  accessToken: null,
  expiresAt: null
};

async function refreshZohoAccessToken() {
  try {
    const response = await fetch(
      `${ZOHO_CONFIG.accountsUrl}/oauth/v2/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: ZOHO_CONFIG.clientId,
          client_secret: ZOHO_CONFIG.clientSecret,
          refresh_token: ZOHO_CONFIG.refreshToken
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      throw new Error(`Zoho token refresh failed: ${data.error}`);
    }

    // Cache the new token
    tokenCache.accessToken = data.access_token;
    tokenCache.expiresAt = Date.now() + (data.expires_in * 1000) - 60000;
    logger.info('Zoho access token refreshed successfully');
    return data.access_token;
  } catch (error) {
    logger.error('Error refreshing Zoho token', { error: error.message });
    throw new Error(`Failed to refresh Zoho token: ${error.message}`);
  }
}

async function getValidZohoAccessToken() {
  if (!ZOHO_CONFIG.refreshToken) {
    throw new Error(
      'Zoho refresh token not found. Please set ZOHO_REFRESH_TOKEN in .env. ' +
      'Visit /auth/zoho to authorize and get the refresh token.'
    );
  }

  if (!ZOHO_CONFIG.clientId || !ZOHO_CONFIG.clientSecret) {
    throw new Error(
      'Zoho credentials missing. Please set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in .env'
    );
  }
  if (!tokenCache.accessToken || Date.now() >= tokenCache.expiresAt) {
    return await refreshZohoAccessToken();
  }

  return tokenCache.accessToken;
}

/**
 * Fetch all contacts from Zoho CRM
 * @param {number} page - Page number (default 1)
 * @param {number} perPage - Records per page (default 200, max 200)
 * @returns {Promise<Array>} Array of contact objects
 */
async function fetchZohoContacts(page = 1, perPage = 200) {
  try {
    const accessToken = await getValidZohoAccessToken();

    const url = new URL(`${ZOHO_CONFIG.apiUrl}/Contacts`);
    url.searchParams.append('page', page);
    url.searchParams.append('per_page', Math.min(perPage, 200));
    url.searchParams.append('fields', 'First_Name,Last_Name,Phone,Mobile,Email,id');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (data.status === 'error') {
      throw new Error(data.message || 'Zoho API error');
    }

    return data.data || [];
  } catch (error) {
    logger.error('Error fetching Zoho contacts', { error: error.message });
    throw error;
  }
}

/**
 * Search for contacts by phone number
 * @param {string} phoneNumber - Phone number to search for
 * @returns {Promise<Array>} Array of matching contacts
 */
async function searchZohoContactByPhone(phoneNumber) {
  try {
    const accessToken = await getValidZohoAccessToken();

    // Clean phone number (remove spaces, dashes, etc.)
    const cleanPhone = phoneNumber.replace(/[\s\-\(\)]/g, '');

    const url = new URL(`${ZOHO_CONFIG.apiUrl}/Contacts/search`);
    url.searchParams.append('criteria', `(Phone:equals:${cleanPhone})or(Mobile:equals:${cleanPhone})`);
    url.searchParams.append('fields', 'First_Name,Last_Name,Phone,Mobile,Email,id');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });


    if (response.status === 204) {
      return [];
    }

    const data = await response.json();

    if (data.status === 'error') {
      if (data.code === 'NO_DATA_FOUND') {
        return [];
      }
      throw new Error(data.message || 'Zoho API error');
    }

    return data.data || [];
  } catch (error) {
    logger.error('Error searching Zoho contact', { error: error.message });
    throw error;
  }
}

/**
 * Search for contacts by multiple criteria
 * @param {Object} criteria - Search criteria object
 * @returns {Promise<Array>} Array of matching contacts
 */
async function searchZohoContacts(criteria) {
  try {
    const accessToken = await getValidZohoAccessToken();

    // Build search criteria string
    const criteriaArray = [];

    if (criteria.firstName) {
      criteriaArray.push(`(First_Name:starts_with:${criteria.firstName})`);
    }
    if (criteria.lastName) {
      criteriaArray.push(`(Last_Name:starts_with:${criteria.lastName})`);
    }
    if (criteria.email) {
      criteriaArray.push(`(Email:equals:${criteria.email})`);
    }
    if (criteria.phone) {
      const cleanPhone = criteria.phone.replace(/[\s\-\(\)]/g, '');
      criteriaArray.push(`((Phone:equals:${cleanPhone})or(Mobile:equals:${cleanPhone}))`);
    }

    if (criteriaArray.length === 0) {
      throw new Error('At least one search criterion is required');
    }

    const criteriaString = criteriaArray.join('and');

    const url = new URL(`${ZOHO_CONFIG.apiUrl}/Contacts/search`);
    url.searchParams.append('criteria', criteriaString);
    url.searchParams.append('fields', 'First_Name,Last_Name,Phone,Mobile,Email,id');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 204) {
      return [];
    }

    const data = await response.json();

    if (data.status === 'error') {
      if (data.code === 'NO_DATA_FOUND') {
        return [];
      }
      throw new Error(data.message || 'Zoho API error');
    }

    return data.data || [];
  } catch (error) {
    logger.error('Error searching Zoho contacts', { error: error.message });
    throw error;
  }
}

/**
 * Get a specific contact by ID
 * @param {string} contactId - Zoho contact ID
 * @returns {Promise<Object>} Contact object
 */
async function getZohoContactById(contactId) {
  try {
    const accessToken = await getValidZohoAccessToken();

    const response = await fetch(
      `${ZOHO_CONFIG.apiUrl}/Contacts/${contactId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();

    if (data.status === 'error') {
      throw new Error(data.message || 'Zoho API error');
    }

    return data.data?.[0] || null;
  } catch (error) {
    logger.error('Error fetching Zoho contact by ID', { error: error.message });
    throw error;
  }
}

/**
 * Fetch all contacts with pagination (handles multiple pages automatically)
 * @param {number} maxPages - Maximum number of pages to fetch (default 5)
 * @returns {Promise<Array>} Array of all contacts
 */
async function fetchAllZohoContacts(maxPages = 5) {
  const allContacts = [];

  for (let page = 1; page <= maxPages; page++) {
    const contacts = await fetchZohoContacts(page, 200);

    if (contacts.length === 0) {
      break; // No more contacts
    }

    allContacts.push(...contacts);

    // If we got less than 200, we've reached the end
    if (contacts.length < 200) {
      break;
    }
  }

  return allContacts;
}

/**
 * Update a contact in Zoho CRM
 * @param {string} contactId - Contact ID to update
 * @param {Object} updateData - Data to update
 * @returns {Promise<Object>} Updated contact
 */
async function updateZohoContact(contactId, updateData) {
  try {
    const accessToken = await getValidZohoAccessToken();

    const response = await fetch(
      `${ZOHO_CONFIG.apiUrl}/Contacts/${contactId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: [updateData]
        })
      }
    );

    const data = await response.json();

    if (data.status === 'error') {
      throw new Error(data.message || 'Zoho API error');
    }

    return data.data?.[0] || null;
  } catch (error) {
    logger.error('Error updating Zoho contact', { error: error.message });
    throw error;
  }
}

export {
  getValidZohoAccessToken,
  fetchZohoContacts,
  searchZohoContactByPhone,
  searchZohoContacts,
  getZohoContactById,
  fetchAllZohoContacts,
  updateZohoContact
};