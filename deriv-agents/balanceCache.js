const config = require('./config');
const derivClient = require('./derivClient');
const stateStore = require('./state');

// Same in-memory-cache reasoning as the other two teams' balanceCache.js —
// avoids a network round-trip on every single trade decision.
let liveBalance = null;

async function ensureLiveBalance() {
  if (liveBalance === null) {
    liveBalance = await derivClient.getBalance();
  }
  return liveBalance;
}

async function resyncLiveBalance() {
  liveBalance = await derivClient.getBalance();
  return liveBalance;
}

function adjustLiveBalance(deltaQuote) {
  if (liveBalance !== null) liveBalance += deltaQuote;
}

async function getFreeBalance(state) {
  if (config.LIVE_TRADING_ENABLED && config.DERIV_API_TOKEN) {
    return ensureLiveBalance();
  }
  return stateStore.ensurePaperBalance(state);
}

module.exports = { getFreeBalance, adjustLiveBalance, resyncLiveBalance };
