// worker.js
require('dotenv').config();

const { Worker } = require('bullmq');
const { PrismaClient } = require('@prisma/client');
const { getEbayToken } = require('./lib/ebay-token-helper');
const { createShopifyProduct } = require('./lib/remix-proxy');
const { QUEUE_NAME, connectionOptions } = require('./lib/import-queue');

const prisma = new PrismaClient();

console.log(`Worker is connecting to Redis and listening for jobs on queue: "${QUEUE_NAME}"`);

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { shopDomain, ebaySellerUsername, total, importOptions } = job.data;
    console.log(`[WORKER] Starting import for ${shopDomain}. Total items: ${total}`);

    const PAGE_SIZE = 50;
    const totalPages = Math.ceil(total / PAGE_SIZE);

    for (let i = 0; i < totalPages; i++) {
      const offset = i * PAGE_SIZE;
      console.log(`[WORKER] Processing page ${i + 1}/${totalPages} for ${shopDomain}`);
      try {
        const ebayAccessToken = await getEbayToken();
        const params = new URLSearchParams({
          'q': 'a',
          'filter': `sellers:{${ebaySellerUsername}}`,
          'limit': PAGE_SIZE,
          'offset': offset,
        });

        const ebayApiUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;

        const response = await fetch(ebayApiUrl, {
          headers: { 'Authorization': `Bearer ${ebayAccessToken}` }
        });
        const ebayData = await response.json();

        if (ebayData.itemSummaries) {
          for (const item of ebayData.itemSummaries) {
            const productData = {
                title: item.title,
                body_html: item.shortDescription || 'Imported from eBay.',
                vendor: "Ebayify",
                product_type: "Imported",
                status: "draft",
                variants: [{ price: item.price.value, sku: item.itemId }],
                images: item.image ? [{ src: item.image.imageUrl }] : [],
            };
            await createShopifyProduct(shopDomain, productData);
          }
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
          // =================================================================
          // --- THIS IS THE KEY CHANGE ---
          // Log the entire error object, not just error.message, to get the full details.
          // =================================================================
          console.error(`[WORKER] Error processing page ${i + 1} for ${shopDomain}. Full error object:`, error);
      }
    }

    console.log(`[WORKER] Finished import for ${shopDomain}`);
  },
  {
    connection: connectionOptions,
    concurrency: 5,
  }
);

worker.on('completed', job => {
  console.log(`[WORKER] Job ${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.error(`[WORKER] Job ${job.id} has failed with error: ${err.message}`);
});