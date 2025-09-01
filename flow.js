- Merchant Clicks "Install App": When a merchant finds your app in the App Store and clicks "Install," Shopify initiates the OAuth 2.0 flow.
- Consent Screen: Shopify shows the merchant a screen that says, "Ebayify wants to..." and lists all the permissions (scopes) we need (e.g., "Write products," "Read products").
- Merchant Agrees: The merchant clicks "Install" on the consent screen.

- Backend Receives Code: Shopify redirects the merchant to the express app backend with a temporary authorization code.

- Backend Exchanges for Token: The Remix template's built-in Shopify library automatically takes this code, sends it back to Shopify, and exchanges it for a permanent, offline-access Admin API Access Token.
- Token is Saved: The template code then saves this token securely in your app's database (the dev.sqlite file, managed by Prisma), associated with the shop's domain.