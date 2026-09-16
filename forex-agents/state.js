const fs = require('fs');
const path = require('path');
const config = require('./config');

// Everything the risk guard and pipeline need to survive a restart, keyed
// by instrument (pair) since this team trades many pairs at once — mirrors
// crypto-agents/state.js's shape.
function defaultState() {
  return {
    dayKey: null,
    dayStartBalance: null,
    realizedPnlToday: 0,
    totalRealizedPnl: 0,
    paperBalance: null,
    openPositions: {}, // instrument -> position
    cooldowns: {}, // instrument -> timestamp until which re-entry is blocked
    lastSignalCandleTimes: {}, // instrument -> last candle time already evaluated (avoids re-signaling the same candle every poll)
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

function ensurePaperBalance(state) {
  if (state.paperBalance === null || state.paperBalance === undefined) {
    state.paperBalance = config.PAPER_STARTING_BALANCE;
  }
  return state.paperBalance;
}

function adjustPaperBalance(state, delta) {
  ensurePaperBalance(state);
  state.paperBalance += delta;
  return state.paperBalance;
}

module.exports = { load, save, rolloverDayIfNeeded, defaultState, ensurePaperBalance, adjustPaperBalance };
