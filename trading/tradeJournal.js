const Redis = require('ioredis');

// Trade Journal Agent: logs every approved trade signal and tracks whether
// price has since hit its stop-loss or take-profit. Backed by Render's
// free Key-Value (Redis) instance — the whole log is kept as one JSON blob
// under a single key (trade volume here is a handful a day, so this is far
// simpler than a multi-key Redis schema and plenty fast at this scale).
const JOURNAL_KEY = 'deepsea:trade_journal';
// Only a week of history is wanted — trades older than this are dropped
// every time the journal is saved, so it never needs manual cleanup and
// never grows unbounded on the free tier's small memory budget.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

let client = null;
let clientUrl = null;

function getClient(env) {
  if (!env.REDIS_URL) return null;
  if (client && clientUrl === env.REDIS_URL) return client;
  if (client) client.disconnect();
  clientUrl = env.REDIS_URL;
  client = new Redis(clientUrl, { maxRetriesPerRequest: 2, connectTimeout: 5000 });
  client.on('error', err => console.error('Trade Journal Redis error:', err.message));
  return client;
}

async function loadTrades(env) {
  const redis = getClient(env);
  if (!redis) return [];
  try {
    const raw = await redis.get(JOURNAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Trade Journal load failed:', err.message);
    return [];
  }
}

async function saveTrades(env, trades) {
  const redis = getClient(env);
  if (!redis) return trades;
  const cutoff = Date.now() - RETENTION_MS;
  const pruned = trades.filter(t => t.openedAt >= cutoff);
  try {
    await redis.set(JOURNAL_KEY, JSON.stringify(pruned));
  } catch (err) {
    console.error('Trade Journal save failed:', err.message);
  }
  return pruned;
}

// Called on every genuinely new approved buy/sell signal (same trigger as
// the Telegram alert) — logs it as an "open" trade.
async function recordTrade(env, symbol, plan) {
  if (!plan.available || plan.data.action === 'hold') return;
  const trades = await loadTrades(env);
  trades.push({
    id: `${symbol}-${Date.now()}`,
    symbol,
    action: plan.data.action,
    entry: plan.data.entry,
    stopLoss: plan.data.stopLoss,
    takeProfit: plan.data.takeProfit,
    confidence: plan.data.confidence,
    riskRewardRatio: plan.data.riskRewardRatio,
    status: 'open',
    openedAt: Date.now(),
    closedAt: null
  });
  await saveTrades(env, trades);
}

// Called on every pipeline run for `symbol` — checks whether price has
// since crossed the stop-loss or take-profit of any still-open trade.
async function checkOpenTrades(env, symbol, currentPrice) {
  if (typeof currentPrice !== 'number') return;
  const trades = await loadTrades(env);
  let changed = false;
  for (const t of trades) {
    if (t.symbol !== symbol || t.status !== 'open') continue;
    if (t.action === 'buy') {
      if (currentPrice <= t.stopLoss) {
        t.status = 'stopped_out';
        t.closedAt = Date.now();
        changed = true;
      } else if (currentPrice >= t.takeProfit) {
        t.status = 'target_hit';
        t.closedAt = Date.now();
        changed = true;
      }
    } else if (t.action === 'sell') {
      if (currentPrice >= t.stopLoss) {
        t.status = 'stopped_out';
        t.closedAt = Date.now();
        changed = true;
      } else if (currentPrice <= t.takeProfit) {
        t.status = 'target_hit';
        t.closedAt = Date.now();
        changed = true;
      }
    }
  }
  if (changed) await saveTrades(env, trades);
}

async function getTradeLog(env) {
  const trades = await loadTrades(env);
  trades.sort((a, b) => b.openedAt - a.openedAt);
  return {
    trades,
    summary: {
      total: trades.length,
      open: trades.filter(t => t.status === 'open').length,
      targetHit: trades.filter(t => t.status === 'target_hit').length,
      stoppedOut: trades.filter(t => t.status === 'stopped_out').length
    }
  };
}

module.exports = { recordTrade, checkOpenTrades, getTradeLog };
