// index.js

// --- Imports ---
const express = require('express');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
const { nodeDefaults } = require('@shopify/shopify-api/adapters/node');
const cors = require('cors'); // <-- 1. IMPORT CORS
const { PLANS } = require('./lib/plans'); // <-- 1. IMPORT YOUR PLANS
// const { createShopifyProduct } = require('./lib/remix-proxy'); // <-- 1. IMPORT PROXY FUNCTION


const crypto = require('crypto'); // Add this import
const { importQueue } = require('./lib/import-queue'); // Import the queue
const { getEbayToken } = require('./lib/ebay-token-helper'); // <-- ADD THIS LINE

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

app.use(cors());
app.use(express.json());

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

// --- Endpoint to fetch Settings ---
app.get('/api/settings', async (req, res) => {
    const shopDomain = req.shop;

    let shop = await prisma.shop.findFirst({
      where: { shopDomain },
    });

    res.status(200).json(shop);
});

app.get('/api/import-preview', async (req, res) => {
    const shopDomain = req.shop;
    console.log(`[IMPORT_PREVIEW] Received request for shop: ${shopDomain}`);

    try {
        const shop = await prisma.shop.findUnique({ where: { shopDomain } });

        if (!shop || !shop.ebaySellerUsername) {
            return res.status(400).json({ error: 'eBay seller username is not configured.' });
        }

        // We only need the first item to get a sample, so we fetch with a limit of 1.
        const ebayAccessToken = await getEbayToken();
        const params = new URLSearchParams({
            'q': 'e',

            'filter': `sellers:{${shop.ebaySellerUsername}}`,
            'limit': 1, // Only need one item for the sample
            'offset': 0
        });

        const ebayApiUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;

        console.info('ebayApiUrl')

        const response = await fetch(ebayApiUrl, {
            headers: {
                'Authorization': `Bearer ${ebayAccessToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`[IMPORT_PREVIEW] eBay API failed for shop ${shopDomain} with status: ${response.status}`, errorBody);
            throw new Error(`eBay API failed with status: ${response.status}`);
        }

        const ebayData = await response.json();

        // Check if there are any items to sample
        if (!ebayData.itemSummaries || ebayData.itemSummaries.length === 0) {
            return res.status(200).json({ totalItems: 0, sampleItem: null });
        }

        const firstItem = ebayData.itemSummaries[0];

        // Transform the data into the desired format
        const responsePayload = {
            totalItems: ebayData.total || 0,
            sampleItem: {
                title: firstItem.title,
                price: firstItem.price?.value || "N/A",
                imageUrl: firstItem.image?.imageUrl || "https://example.com/placeholder.jpg",
                category: firstItem.categories?.[0]?.categoryName || "Uncategorized",
            }
        };

        res.status(200).json(responsePayload);

    } catch (error) {
        console.error(`[IMPORT_PREVIEW] An error occurred for shop ${shopDomain}:`, error.message);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});

// --- "Passthrough" Lookup Endpoint (Now with dynamic quota) ---
app.post('/api/ebay-lookup', async (req, res) => {
    const shopDomain = req.shop;
    const { limit = 50, offset = 0 } = req.body;

    try {
        let shop = await prisma.shop.findUnique({ where: { shopDomain } });

        if (!shop || !shop.ebaySellerUsername) {
            return res.status(400).json({ error: 'eBay seller username is not configured.' });
        }

        // =================================================================
        // --- 3. DYNAMIC QUOTA LOGIC ---
        // =================================================================
        // Get the current plan from the shop's record. Default to FREE if something is wrong.
        const currentPlan = PLANS[shop.plan] || PLANS.FREE;
        const quotaLimit = currentPlan.quota;

        if (new Date() > shop.quotaResetDate) {
            const newResetDate = new Date();
            newResetDate.setDate(newResetDate.getDate() + 30);
            shop = await prisma.shop.update({
                where: { shopDomain },
                data: { apiLookupsUsed: 0, quotaResetDate: newResetDate },
            });
        }

        // Compare usage against the dynamic quota limit
        if (shop.apiLookupsUsed >= quotaLimit) {
            return res.status(429).json({
                error: `Monthly quota for your '${currentPlan.name}' plan exceeded.`,
                used: shop.apiLookupsUsed,
                limit: quotaLimit,
            });
        }

        const ebayAccessToken = await getEbayToken();

        const params = new URLSearchParams({
            'filter': `sellers:{${shop.ebaySellerUsername}}`,
            'limit': limit,
            'offset': offset
        });

        const ebayApiUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;

        const response = await fetch(ebayApiUrl, {
            headers: {
                'Authorization': `Bearer ${ebayAccessToken}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`eBay API failed with status: ` + response.status, errorBody);
            throw new Error(`eBay API failed with status: ` + response.status);
        }

        const ebayData = await response.json();

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

app.post('/api/begin-import', async (req, res) => {
    const shopDomain = req.shop;
    const importOptions = req.body; // { syncStrategy, sortOrder, etc. }

    console.log(`[BEGIN_IMPORT] Received request for shop: ${shopDomain}`);

    try {
        const shop = await prisma.shop.findUnique({ where: { shopDomain } });
        if (!shop || !shop.ebaySellerUsername) {
            return res.status(400).json({ error: 'eBay seller username is not configured.' });
        }

        // 1. Fetch the first page to get the total count
        const ebayAccessToken = await getEbayToken();
        const params = new URLSearchParams({
            'q': 'a',
            'filter': `sellers:{${shop.ebaySellerUsername}}`,
            'limit': 1,
        });
        const ebayApiUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;
        const response = await fetch(ebayApiUrl, {
            headers: { 'Authorization': `Bearer ${ebayAccessToken}` },
        });
        const ebayData = await response.json();
        const totalItems = ebayData.total || 0;

        if (totalItems === 0) {
            return res.status(200).json({ message: "No items found to import.", totalItems: 0 });
        }

        // 2. Create and add the job to the queue
        const jobId = crypto.randomUUID();
        const jobData = {
            shopDomain,
            ebaySellerUsername: shop.ebaySellerUsername,
            total: totalItems,
            importOptions,
        };
        await importQueue.add('import-job', jobData, { jobId });
        console.log(`[BEGIN_IMPORT] Job ${jobId} added to queue for ${shopDomain}`);

        // 3. Respond immediately to the client
        const estimatedMinutes = Math.ceil((totalItems / 50) * 0.5 / 60); // Rough estimate
        res.status(202).json({
            jobId: jobId,
            totalItems: totalItems,
            eta: `${estimatedMinutes} minutes`,
            message: `Import started for ${totalItems} items.`,
        });

    } catch (error) {
        console.error(`[BEGIN_IMPORT] Error for shop ${shopDomain}:`, error.message);
        res.status(500).json({ error: 'Failed to start import process.' });
    }
});

// --- Start The Server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});