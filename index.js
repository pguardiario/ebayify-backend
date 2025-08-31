// index.js

// --- Imports ---
const express = require('express');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
const { nodeDefaults } = require('@shopify/shopify-api/adapters/node');
const cors = require('cors'); // <-- 1. IMPORT CORS


// --- Initializations ---
const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3014;
const FREE_QUOTA = 50;

// --- Shopify API Library Initialization ---
const shopify = shopifyApi({
  ...nodeDefaults,
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  // NOTE: The `scopes` property was re-added as it is required by the library's config validator.
  // It was the RegExp route that fixed the startup error.
  scopes: ['read_products'],
  hostName: process.env.HOST,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});


// --- EBAY TOKEN FUNCTION ---
async function getEbayToken() {
    const useSandbox = false;
    const clientId = process.env.EBAY_API_ID;
    const clientSecret = process.env.EBAY_API_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('eBay API credentials are not defined in .env file.');
    }

    const authUrl = useSandbox ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token' : 'https://api.ebay.com/identity/v1/oauth2/token';
    const encodedCredentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(authUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${encodedCredentials}`,
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error("Failed to get eBay token:", errorBody);
        throw new Error('Failed to get eBay token');
    }

    const data = await response.json();
    return data.access_token;
}

// --- Middleware ---
app.use(express.json());
const corsOptions = {
    origin: [
        'https://admin.shopify.com',
        new RegExp('^https://[a-zA-Z0-9-]+.myshopify.com$'),
    ],
};
app.use(cors(corsOptions));

// --- Shopify Authentication Middleware with Enhanced Logging ---
const verifyRequest = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            // --- NEW LOGGING ---
            console.warn(`[AUTH_MIDDLEWARE] Failed: Missing authorization header. IP: ${req.ip}`);
            return res.status(401).send('Unauthorized: Missing authorization header');
        }
        const token = authHeader.split(' ')[1];
        const session = await shopify.session.decodeSessionToken(token);
        req.shop = session.dest.replace('https://', '');

        // --- NEW LOGGING ---
        console.log(`[AUTH_MIDDLEWARE] Success: Verified request for shop: ${req.shop}`);
        return next();
    } catch (error) {
        // --- ENHANCED LOGGING ---
        console.error(`[AUTH_MIDDLEWARE] Error: Failed to validate session token. Reason: ${error.message}`);
        return res.status(401).send('Unauthorized: Invalid session token');
    }
};

// =================================================================
// --- NEW LOGGING MIDDLEWARE ---
// This will run for all API requests after authentication
// =================================================================
const logApiRequest = (req, res, next) => {
    console.log(`[API_REQUEST] Shop: ${req.shop} is requesting ${req.method} ${req.originalUrl}`);
    next();
};

// Protect all API routes and apply our new logger
app.use(/\/api\/(.*)/, verifyRequest, logApiRequest);


// --- Endpoint to Save Shop Settings ---
app.post('/api/save-settings', async (req, res) => {
    const shopDomain = req.shop;
    const { ebaySellerUsername } = req.body;

    if (!ebaySellerUsername) {
        return res.status(400).json({ error: 'eBay seller username is required.' });
    }

    try {
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        await prisma.shop.upsert({
            where: { shopDomain },
            update: { ebaySellerUsername },
            create: { shopDomain, ebaySellerUsername, quotaResetDate: thirtyDaysFromNow },
        });
        console.log(`[SAVE_SETTINGS] Successfully saved settings for shop: ${shopDomain}`);
        res.status(200).json({ success: true, message: "eBay seller username has been saved." });
    } catch (error) {
        // --- ENHANCED LOGGING ---
        console.error(`[SAVE_SETTINGS] Error for shop ${shopDomain}:`, error);
        res.status(500).json({ error: 'Failed to save settings.' });
    }
});

// --- "Passthrough" Lookup Endpoint ---
app.post('/api/ebay-lookup', async (req, res) => {
    const shopDomain = req.shop;
    const { limit = 50, offset = 0 } = req.body;

    try {
        let shop = await prisma.shop.findUnique({ where: { shopDomain } });

        if (!shop || !shop.ebaySellerUsername) {
            console.warn(`[EBAY_LOOKUP] Failed: Shop ${shopDomain} has not configured a seller username.`);
            return res.status(400).json({ error: 'eBay seller username is not configured.' });
        }

        // ... (Quota checking logic remains the same) ...
        if (new Date() > shop.quotaResetDate) {
            console.log(`[EBAY_LOOKUP] Resetting API quota for shop: ${shopDomain}`);
            const newResetDate = new Date();
            newResetDate.setDate(newResetDate.getDate() + 30);
            shop = await prisma.shop.update({
                where: { shopDomain },
                data: { apiLookupsUsed: 0, quotaResetDate: newResetDate },
            });
        }
        if (shop.apiLookupsUsed >= FREE_QUOTA) {
            console.warn(`[EBAY_LOOKUP] Quota exceeded for shop: ${shopDomain}`);
            return res.status(429).json({ error: 'Monthly free quota exceeded.' });
        }

        console.log(`[EBAY_LOOKUP] Fetching new eBay token for request from ${shopDomain}`);
        const ebayAccessToken = await getEbayToken();

        const params = new URLSearchParams({
            'filter': `sellers:{${shop.ebaySellerUsername}}`,
            'limit': limit,
            'offset': offset
        });

        const ebayApiUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;
        console.log(`[EBAY_LOOKUP] Proxying request for ${shopDomain} to ${ebayApiUrl}`);

        const response = await fetch(ebayApiUrl, {
            headers: {
                'Authorization': `Bearer ${ebayAccessToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorBody = await response.text();
            // --- ENHANCED LOGGING ---
            console.error(`[EBAY_LOOKUP] eBay API failed for shop ${shopDomain} with status: ${response.status}`, errorBody);
            throw new Error(`eBay API failed with status: ${response.status}`);
        }

        const ebayData = await response.json();

        await prisma.shop.update({
            where: { shopDomain },
            data: { apiLookupsUsed: { increment: 1 } },
        });

        console.log(`[EBAY_LOOKUP] Successfully served request for shop: ${shopDomain}. Items found: ${ebayData.itemSummaries?.length || 0}`);
        res.status(200).json(ebayData);

    } catch (error) {
        // --- ENHANCED LOGGING ---
        console.error(`[EBAY_LOOKUP] An error occurred for shop ${shopDomain}:`, error.message);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});


// --- Start The Server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});