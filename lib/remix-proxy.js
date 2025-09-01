// lib/remix-proxy.js

const REMIX_BACKEND_URL = process.env.REMIX_BACKEND_URL;
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;

async function createShopifyProduct(shopDomain, productData) {
  if (!REMIX_BACKEND_URL || !INTERNAL_API_SECRET) {
    throw new Error("Remix backend URL or internal secret is not configured.");
  }
  
  const endpoint = `${REMIX_BACKEND_URL}/api/proxy/create-product`;

  console.log(`[REMIX_PROXY] Forwarding product creation for ${shopDomain} to ${endpoint}`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${INTERNAL_API_SECRET}`,
    },
    body: JSON.stringify({
      shopDomain: shopDomain,
      product: productData,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[REMIX_PROXY] Failed to proxy product creation: ${response.status} ${response.statusText}`, errorBody);
    throw new Error(`Failed to proxy product creation: ${response.statusText}`);
  }

  return response.json();
}

module.exports = { createShopifyProduct };
