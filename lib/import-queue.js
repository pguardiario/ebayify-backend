// lib/import-queue.js
require('dotenv').config();
const { Queue } = require('bullmq');

if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is not defined in your .env file.');
}

// =================================================================
// --- THE DEFINITIVE FIX ---
// Manually parse the REDIS_URL to create the connection object that ioredis expects.
// This is the most robust and explicit method.
// =================================================================
const redisUrl = new URL(process.env.REDIS_URL);

const connectionOptions = {
    host: redisUrl.hostname,
    port: parseInt(redisUrl.port, 10),
    password: redisUrl.password,
    // Upstash requires TLS, which is indicated by the 'rediss://' protocol.
    // ioredis needs the tls property to be an object to enable it.
    tls: redisUrl.protocol === 'rediss:' ? {} : undefined,
};

console.log('[QUEUE_CONFIG] Created Redis connection options:', {
    host: connectionOptions.host,
    port: connectionOptions.port,
    password: connectionOptions.password ? '******' : 'none',
    tls: !!connectionOptions.tls,
});

const QUEUE_NAME = 'import-jobs';

const importQueue = new Queue(QUEUE_NAME, { connection: connectionOptions });

module.exports = { importQueue, connectionOptions, QUEUE_NAME };