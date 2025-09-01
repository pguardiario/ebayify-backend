// routes/auth.js
const express = require('express');
const { shopifyApi } = require('@shopify/shopify-api');
const { PrismaClient } = require('@prisma/client');
const { encrypt } = require('../lib/crypto');

const router = express.Router();
const prisma = new PrismaClient();

// This is the entry point for the installation.
router.get('/begin', async (req, res) => {
    // Note: We get the 'shopify' object from res.locals, which we'll set up in index.js
    const shopify = res.locals.shopify;
    try {
        const authUrl = await shopify.auth.begin({
            shop: req.query.shop,
            callbackPath: '/auth/callback',
            isOnline: false, // Use offline access mode to get a permanent token
        });
        console.log(`[AUTH_BEGIN] Redirecting to: ${authUrl}`);
        res.redirect(authUrl);
    } catch (error)
 {
        console.error("Error during auth begin:", error);
        res.status(500).send(error.message);
    }
});

// Shopify redirects here after the user approves the app.
router.get('/callback', async (req, res) => {
    // Note: We get the 'shopify' object from res.locals
    const shopify = res.locals.shopify;
    try {
        const callback = await shopify.auth.callback({
            rawRequest: req,
            rawResponse: res,
        });

        const { session } = callback;
        const shopDomain = session.shop;
        const accessToken = session.accessToken;

        console.log(`[AUTH_CALLBACK] Received access token for ${shopDomain}`);
        
        const encryptedToken = encrypt(accessToken);

        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

        await prisma.shop.upsert({
            where: { shopDomain },
            update: { shopifyAccessToken: encryptedToken },
            create: {
                shopDomain: shopDomain,
                shopifyAccessToken: encryptedToken,
                quotaResetDate: thirtyDaysFromNow,
            },
        });

        console.log(`[AUTH_CALLBACK] Successfully stored token for ${shopDomain}`);

        const appUrl = await shopify.auth.getEmbeddedAppUrl({rawRequest: req, rawResponse: res});
        res.redirect(appUrl);

    } catch (error) {
        console.error("Error during auth callback:", error);
        res.status(500).send(error.message);
    }
});

module.exports = router;
