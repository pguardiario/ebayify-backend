// lib/plans.js
const PLANS = {
  FREE: {
    name: 'Free',
    quota: 250, // Allows syncing up to 250 products per month
    price: 0,
  },
  PLUS: {
    name: 'Plus',
    quota: 2500, // Allows syncing up to 2,500 products per month
    price: 10,
  },
  PRO: {
    name: 'Pro',
    quota: 25000, // Allows syncing up to 25,000 products per month
    price: 25,
  },
};