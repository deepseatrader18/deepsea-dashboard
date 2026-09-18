const Redis = require('ioredis');

// Stores what the Crypto Team bridge (crypto-agents/, running on the
// owner's own VPS — Render can't reach Binance) reports in: the latest
// scanner/team status snapshot, and the closed-trade log. Same Redis
// key-value instance and one-JSON-blob-per-key approach as
// tradeJournal.js, for the same reason (trade volume is small, a single
// key is far simpler than a schema).
const STATUS_KEY = 'deepsea:crypto_status';
const TRADES_KEY = 'deepsea:crypto_trades';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TRADES_MAX = 500;

let client = null;
let clientUrl = null;
// In-memory fallback so this still works with no REDIS_URL configured
// (e.g. local/dev) — just doesn't survive a restart.
let memoryStatus = null;
let memoryTrades = [];

function getClient(env) {
  if (!env.REDIS_URL) return null;
  if (client && clientUrl === env.REDIS_URL) return client;
  if (client) client.disconnect();
  clientUrl = env.REDIS_URL;
  client = new Redis(clientUrl, { maxRetriesPerRequest: 2, connectTimeout: 5000 });
  client.on('error', err => console.error('Crypto Team store Redis error:', err.message));
  return client;
}

async function saveStatus(env, status) {
  memoryStatus = status;
  const redis = getClient(env);
  if (!redis) return;
  try {
    await redis.set(STATUS_KEY, JSON.stringify(status));
  } catch (err) {
    console.error('Crypto Team status save failed:', err.message);
  }
}

async function getStatus(env) {
  const redis = getClient(env);
  if (!redis) return memoryStatus;
  try {
    const raw = await redis.get(STATUS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Crypto Team status load failed:', err.message);
    return memoryStatus;
  }
}

async function loadTrades(env) {
  const redis = getClient(env);
  if (!redis) return memoryTrades;
  try {
    const raw = await redis.get(TRADES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Crypto Team trades load failed:', err.message);
    return memoryTrades;
  }
}

async function addTrade(env, trade) {
  const trades = await loadTrades(env);
  trades.push(trade);
  const cutoff = Date.now() - RETENTION_MS;
  const pruned = trades.filter(t => (t.closedAt || t.openedAt || 0) >= cutoff).slice(-TRADES_MAX);

  memoryTrades = pruned;
  const redis = getClient(env);
  if (!redis) return;
  try {
    await redis.set(TRADES_KEY, JSON.stringify(pruned));
  } catch (err) {
    console.error('Crypto Team trades save failed:', err.message);
  }
}

module.exports = { saveStatus, getStatus, loadTrades, addTrade };
