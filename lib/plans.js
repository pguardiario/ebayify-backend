// lib/plans.js

const PLANS = {
  FREE: {
    name: 'Free',
    quota: 50,
    price: 0,
  },
  PLUS: {
    name: 'Plus',
    quota: 500,
    price: 10,
  },
  PRO: {
    name: 'Pro',
    quota: 5000,
    price: 25,
  },
};

module.exports = { PLANS };

