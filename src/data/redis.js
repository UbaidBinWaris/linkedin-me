'use strict';
/**
 * redis.js — ioredis client singleton
 *
 * Used exclusively for distributed locking (SET NX PX).
 * Falls back to localhost:6379 if REDIS_URL is not set.
 */

const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  lazyConnect:          true,   // don't connect until first command
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 5) return null; // stop retrying after 5 attempts
    return Math.min(times * 200, 2000);
  },
  enableReadyCheck: true,
});

redis.on('connect',         () => console.log('[Redis] Connected'));
redis.on('ready',           () => console.log('[Redis] Ready'));
redis.on('reconnecting',    () => console.log('[Redis] Reconnecting...'));
redis.on('error', (err)     => console.error('[Redis] Error:', err.message));

module.exports = redis;
