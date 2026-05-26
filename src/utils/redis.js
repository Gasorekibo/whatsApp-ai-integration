import Redis from 'ioredis';
import logger from '../logger/logger.js';

let client = null;

function buildClient() {
  // Support both REDIS_URL and individual REDIS_HOST/PORT/PASSWORD/DB vars
  const url = process.env.REDIS_URL;
  const opts = url
    ? { maxRetriesPerRequest: 1, enableReadyCheck: true, lazyConnect: true, connectTimeout: 5000 }
    : {
        host:             process.env.REDIS_HOST     || 'localhost',
        port:             parseInt(process.env.REDIS_PORT || '6379', 10),
        password:         process.env.REDIS_PASSWORD || undefined,
        db:               parseInt(process.env.REDIS_DB   || '0',    10),
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect:      true,
        connectTimeout:   5000,
      };

  const instance = url ? new Redis(url, opts) : new Redis(opts);

  instance.on('connect', () => logger.info('Redis connected'));
  instance.on('ready',   () => logger.info('Redis ready'));
  instance.on('error',   (err) => logger.warn('Redis error', { error: err.message }));
  instance.on('close',   () => logger.warn('Redis connection closed'));

  return instance;
}

export function getRedisClient() {
  if (!client) client = buildClient();
  return client;
}

export async function connectRedis() {
  try {
    await getRedisClient().connect();
    console.log('Connected to Redis');
  } catch (err) {
    logger.warn('Redis unavailable — caching disabled, app will continue without it', { error: err.message });
  }
}

export async function disconnectRedis() {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
  }
}

function isReady() {
  return client?.status === 'ready';
}

// ── Key namespacing ───────────────────────────────────────────────────────────
//
// Every Redis key must be prefixed with REDIS_PREFIX so keys from different
// tenant containers never collide on the shared Redis instance.
// Usage: rkey('msgdedup', messageId)  →  "resto-demo:msgdedup:abc123"
export const rkey = (...parts) => `${process.env.REDIS_PREFIX}:${parts.join(':')}`;

// ── Helpers (all swallow Redis errors — never crash the app) ──────────────────

export async function redisGet(key) {
  if (!isReady()) return null;
  try {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn('Redis GET error', { key, error: err.message });
    return null;
  }
}

export async function redisSet(key, value, ttlSeconds) {
  if (!isReady()) return;
  try {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await client.setex(key, ttlSeconds, serialized);
    } else {
      await client.set(key, serialized);
    }
  } catch (err) {
    logger.warn('Redis SET error', { key, error: err.message });
  }
}

export async function redisDel(...keys) {
  if (!isReady() || keys.length === 0) return;
  try {
    await client.del(...keys);
  } catch (err) {
    logger.warn('Redis DEL error', { keys, error: err.message });
  }
}

/**
 * Atomic SET NX EX — used for distributed locks and deduplication.
 * Returns:
 *   true  → key was set (first time / lock acquired)
 *   false → key already existed (duplicate / lock held by another instance)
 *   null  → Redis unavailable (caller decides what to do)
 */
export async function redisSetNx(key, value, ttlSeconds) {
  if (!isReady()) return null;
  try {
    const result = await client.set(key, value, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  } catch (err) {
    logger.warn('Redis SET NX error', { key, error: err.message });
    return null;
  }
}
