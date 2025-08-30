// index.js

// --- Imports ---
const express = require('express');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');

// --- Initializations ---
const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;
const FREE_QUOTA = 50;

// --- Shopify API Library Initialization ---
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: ['read_products'],
  hostName: 'your-ngrok-or-production-url.com',
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
});

// =================================================================
// --- EBAY TOKEN FUNCTION (Your provided, correct function) ---
// =================================================================
async function getEbayToken() {
    const useSandbox = false; // <-- PRODUCTION SWITCH
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

// --- Shopify Authentication Middleware ---
const verifyRequest = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).send('Unauthorized: Missing authorization header');
        }
        const token = authHeader.split(' ')[1];
        const session = await shopify.session.decodeSessionToken(token);
        req.shop = session.dest.replace('https://', '');
        return next();
    } catch (error) {
        console.error('Failed to validate session token:', error.message);
        return res.status(401).send('Unauthorized: Invalid session token');
    }
};

// Protect all API routes
app.use('/api/*', verifyRequest);

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
        res.status(200).json({ success: true, message: "eBay seller username has been saved." });
    } catch (error) {
        console.error('Error in save-settings:', error);
        res.status(500).json({ error: 'Failed to save settings.' });
    }
});

// --- The CORRECTED "Passthrough" Lookup Endpoint ---
app.post('/api/ebay-lookup', async (req, res) => {
    const shopDomain = req.shop;
    const { limit = 50, offset = 0 } = req.body;

    try {
        let shop = await prisma.shop.findUnique({ where: { shopDomain } });

        if (!shop || !shop.ebaySellerUsername) {
            return res.status(400).json({ error: 'eBay seller username is not configured.' });
        }

        // (Quota checking logic remains the same)
        if (new Date() > shop.quotaResetDate) {
            const newResetDate = new Date();
            newResetDate.setDate(newResetDate.getDate() + 30);
            shop = await prisma.shop.update({
                where: { shopDomain },
                data: { apiLookupsUsed: 0, quotaResetDate: newResetDate },
            });
        }
        if (shop.apiLookupsUsed >= FREE_QUOTA) {
            return res.status(429).json({ error: 'Monthly free quota exceeded.' });
        }

        // --- THE KEY CHANGE IS HERE ---
        // Step 1: Get a fresh application access token from eBay.
        const ebayAccessToken = await getEbayToken();

        // Step 2: Use that token to make the API call.
        const params = new URLSearchParams({
            'filter': `sellers:{${shop.ebaySellerUsername}}`,
            'limit': limit,
            'offset': offset
        });
        const ebayApiUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;

        const response = await fetch(ebayApiUrl, {
            headers: {
                'Authorization': `Bearer ${ebayAccessToken}`, // Use the freshly obtained token
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`eBay API failed with status: ${response.status}`, errorBody);
            throw new Error(`eBay API failed with status: ${response.status}`);
        }

        const ebayData = await response.json();

        // (Incrementing quota and sending response remains the same)
        await prisma.shop.update({
            where: { shopDomain },
            data: { apiLookupsUsed: { increment: 1 } },
        });

        res.status(200).json(ebayData);

    } catch (error) {
        console.error('An error occurred during ebay-lookup:', error.message);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

// --- Start The Server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});