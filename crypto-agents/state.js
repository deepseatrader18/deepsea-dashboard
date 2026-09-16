const fs = require('fs');
const path = require('path');
const config = require('./config');

// Everything the risk guard and pipeline need to survive a restart:
// open positions, today's realized P/L, trade history, and per-symbol
// cooldowns. Kept as one small JSON file (trade volume here is a handful
// a day) instead of a database — same reasoning tradeJournal.js uses on
// the dashboard side.
function defaultState() {
  return {
    dayKey: null,
    dayStartBalance: null,
    realizedPnlToday: 0,
    totalRealizedPnl: 0, // all-time, across days — the number that actually answers "did paper trading work?"
    paperBalance: null, // simulated equity, only used when not reading a real Binance balance
    openPositions: {}, // symbol -> { qty, entryPrice, tpPrice, slPrice, ocoOrderListId, openedAt }
    cooldowns: {}, // symbol -> timestamp until which re-entry is blocked
    trades: [] // closed trade history, most recent last
  };
}

function load() {
  try {
    const raw = fs.readFileSync(config.STATE_FILE, 'utf8');
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

function save(state) {
  try {
    fs.mkdirSync(path.dirname(config.STATE_FILE), { recursive: true });
    fs.writeFileSync(config.STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('State save failed:', err.message);
  }
}

// Resets the daily P/L counter the first time this runs after local
// midnight, anchored to a fresh account balance snapshot so the loss cap
// is always measured against "today's starting capital", not a stale one.
function rolloverDayIfNeeded(state, currentBalance) {
  const todayKey = new Date().toISOString().slice(0, 10);
  if (state.dayKey !== todayKey) {
    state.dayKey = todayKey;
    state.dayStartBalance = currentBalance;
    state.realizedPnlToday = 0;
    save(state);
  }
  return state;
}

// Paper equity carried forward across restarts and days (unlike
// dayStartBalance, which resets every day for the loss-cap check) — this
// is what lets a multi-day paper run show real compounding results
// instead of resetting to the same starting number every morning.
function ensurePaperBalance(state) {
  if (state.paperBalance === null || state.paperBalance === undefined) {
    state.paperBalance = config.PAPER_STARTING_BALANCE;
  }
  return state.paperBalance;
}

module.exports = { load, save, rolloverDayIfNeeded, defaultState, ensurePaperBalance };
